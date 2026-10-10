"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface TrackItem {
  id: string;
  body: string;
  confidence: string;
}
interface Track {
  id: string;
  title: string;
  isActive: boolean;
  items: TrackItem[];
}
interface TrackEvent {
  type: string;
  trackId: string;
  itemId?: string;
}

type Status = "idle" | "connecting" | "listening" | "hearing" | "error" | "degraded";

interface RealtimeEvent {
  type: string;
  item_id?: string;
  delta?: string;
  transcript?: string;
  item?: { type?: string; call_id?: string; name?: string; arguments?: string };
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.error ?? `HTTP ${res.status}`), { status: res.status, body: json });
  return json as T;
}

export default function DeepThinking() {
  const [status, setStatus] = useState<Status>("idle");
  const [tracks, setTracks] = useState<Track[]>([]);
  const [heard, setHeard] = useState("");
  const [log, setLog] = useState<string[]>([]);
  const [typed, setTyped] = useState("");
  const [linkUrl, setLinkUrl] = useState("");

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const heardRef = useRef<{ itemId: string; text: string } | null>(null);
  const turn = useRef({ responseOpen: false, inflight: 0, pending: false });

  const addLog = useCallback((line: string) => setLog((l) => [...l.slice(-60), line]), []);

  useEffect(() => {
    fetch("/api/tracks")
      .then((r) => (r.ok ? r.json() : { tracks: [] }))
      .then((j) => setTracks(j.tracks ?? []))
      .catch(() => {});
  }, []);

  const send = (event: unknown) => dcRef.current?.readyState === "open" && dcRef.current.send(JSON.stringify(event));

  const maybeContinue = () => {
    const t = turn.current;
    if (!t.responseOpen && t.inflight === 0 && t.pending) {
      t.pending = false;
      t.responseOpen = true;
      send({ type: "response.create" });
    }
  };

  const handleFunctionCall = async (callId: string, name: string, args: string) => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;
    turn.current.inflight++;
    let output: unknown = { ok: false, error: "client_error" };
    try {
      const result = await postJson<{ output: unknown; events: TrackEvent[]; tracks: Track[] }>("/api/realtime/tool", {
        sessionId,
        callId,
        name,
        arguments: args,
        heard: heardRef.current,
      });
      output = result.output;
      setTracks(result.tracks);
      for (const e of result.events) addLog(`${e.type} ${e.trackId.slice(0, 8)}${e.itemId ? ` item ${e.itemId.slice(0, 8)}` : ""}`);
      if (result.events.length === 0) addLog(`${name}: ${JSON.stringify(result.output).slice(0, 120)}`);
    } catch (err) {
      addLog(`tool ${name} failed: ${(err as Error).message}`);
    } finally {
      send({ type: "conversation.item.create", item: { type: "function_call_output", call_id: callId, output: JSON.stringify(output) } });
      turn.current.inflight--;
      turn.current.pending = true;
      maybeContinue();
    }
  };

  const onRealtimeEvent = (ev: RealtimeEvent) => {
    const sessionId = sessionIdRef.current;
    switch (ev.type) {
      case "input_audio_buffer.speech_started":
        setStatus("hearing");
        break;
      case "input_audio_buffer.speech_stopped":
        setStatus("listening");
        break;
      case "conversation.item.input_audio_transcription.delta": {
        if (!ev.item_id) break;
        const prev = heardRef.current?.itemId === ev.item_id ? heardRef.current.text : "";
        heardRef.current = { itemId: ev.item_id, text: prev + (ev.delta ?? "") };
        setHeard(heardRef.current.text);
        break;
      }
      case "conversation.item.input_audio_transcription.completed":
        if (ev.item_id && sessionId && ev.transcript) {
          heardRef.current = { itemId: ev.item_id, text: ev.transcript };
          setHeard(ev.transcript);
          postJson("/api/realtime/transcript", { sessionId, itemId: ev.item_id, text: ev.transcript, isFinal: true }).catch(
            (e) => addLog(`transcript save failed: ${e.message}`),
          );
        }
        break;
      case "response.created":
        turn.current.responseOpen = true;
        break;
      case "response.done":
        turn.current.responseOpen = false;
        maybeContinue();
        break;
      case "response.output_item.done":
        if (ev.item?.type === "function_call" && ev.item.call_id && ev.item.name) {
          void handleFunctionCall(ev.item.call_id, ev.item.name, ev.item.arguments ?? "{}");
        }
        break;
      case "error":
        addLog(`realtime error: ${JSON.stringify(ev).slice(0, 200)}`);
        break;
    }
  };

  const start = async () => {
    setStatus("connecting");
    try {
      const session = await postJson<{ sessionId: string; clientSecret: string; tracks: Track[] }>(
        "/api/realtime/session",
        {},
      );
      sessionIdRef.current = session.sessionId;
      setTracks(session.tracks);

      const pc = new RTCPeerConnection();
      pcRef.current = pc;
      const audio = new Audio();
      audio.autoplay = true;
      pc.ontrack = (e) => {
        audio.srcObject = e.streams[0];
      };
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      mic.getTracks().forEach((t) => pc.addTrack(t, mic));

      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;
      dc.onopen = () => setStatus("listening");
      dc.onmessage = (m) => {
        try {
          onRealtimeEvent(JSON.parse(m.data));
        } catch {
          /* ignore malformed frames */
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const sdpRes = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        body: offer.sdp,
        headers: { Authorization: `Bearer ${session.clientSecret}`, "Content-Type": "application/sdp" },
      });
      if (!sdpRes.ok) throw new Error(`realtime connect failed (${sdpRes.status})`);
      await pc.setRemoteDescription({ type: "answer", sdp: await sdpRes.text() });
      addLog(`session ${session.sessionId.slice(0, 8)} connected`);
    } catch (err) {
      const e = err as Error & { status?: number };
      setStatus(e.status === 503 ? "degraded" : "error");
      addLog(`start failed: ${e.message}`);
      stop();
    }
  };

  const stop = () => {
    const sessionId = sessionIdRef.current;
    if (sessionId) postJson("/api/realtime/end", { sessionId }).catch(() => {});
    pcRef.current?.getSenders().forEach((s) => s.track?.stop());
    pcRef.current?.close();
    pcRef.current = null;
    dcRef.current = null;
    sessionIdRef.current = null;
    turn.current = { responseOpen: false, inflight: 0, pending: false };
    setStatus((s) => (s === "error" || s === "degraded" ? s : "idle"));
  };

  const sendTyped = async () => {
    const sessionId = sessionIdRef.current;
    const text = typed.trim();
    if (!sessionId || !text) return;
    const itemId = `typed-${crypto.randomUUID()}`;
    await postJson("/api/realtime/transcript", { sessionId, itemId, text, isFinal: true });
    heardRef.current = { itemId, text };
    setHeard(text);
    send({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text }] } });
    send({ type: "response.create" });
    setTyped("");
  };

  const addLink = async () => {
    if (!linkUrl.trim()) return;
    try {
      const { link } = await postJson<{ link: { status: string; canonicalRepo: string | null; error: string | null; chunkIds: string[] } }>(
        "/api/links",
        { url: linkUrl },
      );
      addLog(
        link.status === "ready"
          ? `indexed ${link.canonicalRepo} (${link.chunkIds.length} chunks)`
          : `link saved, not indexed: ${link.error}`,
      );
      setLinkUrl("");
    } catch (err) {
      addLog(`link failed: ${(err as Error).message}`);
    }
  };

  const deleteAccount = async () => {
    if (!confirm("Delete your account and wipe everything BrainStorm has stored about you?")) return;
    const res = await fetch("/api/account", { method: "DELETE" });
    // /auth/logout is served by the Auth0 proxy, not a Next page, so it needs a full navigation.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    if (res.ok) window.location.href = "/auth/logout";
  };

  const live = status === "listening" || status === "hearing";

  return (
    <section>
      <div className="row panel">
        <button onClick={start} disabled={live || status === "connecting"}>
          Start live session
        </button>
        <button className="secondary" onClick={stop} disabled={!live}>
          Stop
        </button>
        <span className="muted">
          {status === "degraded" ? "Live voice unavailable (degraded mode)" : `Status: ${status}`}
        </span>
      </div>

      <p className="heard muted">{heard ? `Heard: “${heard}”` : live ? "Listening…" : ""}</p>

      {live && (
        <div className="row">
          <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Or type a thought" />
          <button className="secondary" onClick={sendTyped}>
            Send
          </button>
        </div>
      )}

      <div className="tracks">
        {tracks.length === 0 && <p className="muted">No tracks yet. They appear as you talk.</p>}
        {tracks.map((t) => (
          <div key={t.id} className={`panel track${t.isActive ? " active" : ""}`}>
            <h3>{t.title}</h3>
            <ul>
              {t.items.map((i) => (
                <li key={i.id}>
                  {i.body}
                  {i.confidence === "live_draft" && <span className="draft">draft</span>}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="row panel" style={{ marginTop: 16 }}>
        <input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://github.com/owner/repo" />
        <button className="secondary" onClick={addLink}>
          Add reference
        </button>
        <button className="danger" onClick={deleteAccount}>
          Delete account
        </button>
      </div>

      <div className="panel log" style={{ marginTop: 16 }}>
        {log.join("\n") || "Events will appear here."}
      </div>
    </section>
  );
}
