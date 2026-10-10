"use client";

import { EndSensitivity, GoogleGenAI, Modality, type LiveServerMessage, type Session } from "@google/genai";
import { useEffect, useRef, useState } from "react";

import { Player, startMic, type Mic } from "./audio";
import { applyTool, emptyBoard, liveInstruction, type Board } from "./tracks";

type Status = "idle" | "connecting" | "listening" | "error";
type LogEntry = { id: number; at: string; kind: "tool" | "thought" | "info" | "error"; title: string; detail?: string };
type Line = { id: number; who: "you" | "gemini"; text: string };

// Demo of BrainStorm's Deep Thinking voice mode. The browser gets a one-time
// token from /api/live/token and talks to Gemini Live directly for
// transcription and voice. Every couple of seconds the new transcript goes to
// /api/live/tracks, where Gemini Flash sorts it into tracks with tool calls.
// (Gemini Live itself only acts when the speaker pauses.) Nothing is saved.
export function LiveDemo() {
  const [status, setStatus] = useState<Status>("idle");
  const [board, setBoard] = useState<Board>(emptyBoard);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [interim, setInterim] = useState("");
  const [level, setLevel] = useState(0);
  const [typed, setTyped] = useState("");

  const boardRef = useRef<Board>(emptyBoard);
  const session = useRef<Session | null>(null);
  const mic = useRef<Mic | null>(null);
  const player = useRef<Player | null>(null);
  const seq = useRef(0);
  const turn = useRef<{ you?: number; gemini?: number }>({});
  const wanted = useRef(false); // false once the user presses stop
  const pending = useRef(""); // transcript not yet sorted into tracks
  const filed = useRef(""); // transcript already sorted, for context
  const sorting = useRef(false);

  const addLog = (kind: LogEntry["kind"], title: string, detail?: string) =>
    setLog((l) => [{ id: ++seq.current, at: new Date().toLocaleTimeString(), kind, title, detail }, ...l].slice(0, 200));

  // Appends streamed transcript text to the current line for that speaker.
  const appendLine = (who: Line["who"], text: string) => {
    const key = who === "you" ? "you" : "gemini";
    const current = turn.current[key];
    if (current === undefined) {
      const id = ++seq.current;
      turn.current[key] = id;
      setLines((ls) => [...ls, { id, who, text }]);
    } else {
      setLines((ls) => ls.map((l) => (l.id === current ? { ...l, text: l.text + text } : l)));
    }
  };

  function onMessage(msg: LiveServerMessage) {
    const sc = msg.serverContent;
    if (sc) {
      if (sc.interimInputTranscription?.text) setInterim(sc.interimInputTranscription.text);
      if (sc.inputTranscription?.text) {
        setInterim("");
        turn.current.gemini = undefined;
        appendLine("you", sc.inputTranscription.text);
        pending.current += sc.inputTranscription.text;
      }
      if (sc.outputTranscription?.text) {
        turn.current.you = undefined;
        appendLine("gemini", sc.outputTranscription.text);
      }
      for (const part of sc.modelTurn?.parts ?? []) {
        if (part.thought && part.text) addLog("thought", "Gemini's reasoning", part.text);
        else if (part.inlineData?.data && part.inlineData.mimeType?.startsWith("audio/")) player.current?.play(part.inlineData.data);
      }
      if (sc.interrupted) player.current?.clear();
      if (sc.turnComplete) {
        turn.current = {};
        void sortPending();
      }
    }

    if (msg.goAway) addLog("info", "Gemini will end this session soon", `Time left: ${msg.goAway.timeLeft ?? "?"}`);
  }

  // Sends the transcript gathered since the last call to Gemini Flash and
  // applies the track changes it returns. One request at a time.
  async function sortPending() {
    const text = pending.current.trim();
    if (!text || sorting.current) return;
    sorting.current = true;
    pending.current = "";
    try {
      const b = boardRef.current;
      const res = await fetch("/api/live/tracks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text,
          earlier: filed.current.slice(-1500),
          active: b.active,
          tracks: b.tracks.map((t) => ({ track_id: t.id, title: t.title, items: t.items.map((i) => ({ item_id: i.id, text: i.text })) })),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Track request failed (${res.status})`);
      filed.current += ` ${text}`;
      for (const t of (body.thoughts ?? []) as string[]) addLog("thought", "Gemini's reasoning", t);
      for (const call of (body.calls ?? []) as { name: string; args: Record<string, unknown> }[]) {
        const { board: next, result } = applyTool(boardRef.current, call.name, call.args);
        boardRef.current = next;
        const { reason, ...rest } = call.args;
        addLog(
          result.ok ? "tool" : "error",
          `${call.name}(${Object.entries(rest).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(", ")})`,
          [typeof reason === "string" ? `Why: ${reason}` : "", result.ok ? "" : String(result.error)].filter(Boolean).join("\n"),
        );
      }
      setBoard(boardRef.current);
      if (!body.calls?.length) addLog("info", "No track change", `For: "${text}"`);
    } catch (err) {
      // Keep the words so the next round tries them again.
      pending.current = `${text} ${pending.current}`.slice(-4000);
      addLog("error", "Sorting into tracks failed", (err as Error).message);
    } finally {
      sorting.current = false;
    }
  }

  async function connect(withThoughts: boolean): Promise<Session> {
    const res = await fetch("/api/live/token", { method: "POST" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? `Token request failed (${res.status})`);
    addLog("info", "Got a one-time Gemini token", `Model: ${body.model}`);

    const ai = new GoogleGenAI({ apiKey: body.token, httpOptions: { apiVersion: "v1alpha" } });
    // Resolves once Gemini accepts the settings; rejects if it closes first.
    let ready = false;
    let settle: { ok: () => void; fail: (e: Error) => void } = { ok() {}, fail() {} };
    const setup = new Promise<void>((ok, fail) => (settle = { ok, fail }));
    const timer = setTimeout(() => settle.fail(new Error("Gemini did not answer in time")), 15_000);
    const sess = await ai.live.connect({
      model: body.model,
      config: {
        responseModalities: [Modality.AUDIO],
        systemInstruction: liveInstruction,
        // End a turn soon after the speaker pauses, so the final transcript
        // arrives sooner.
        realtimeInputConfig: {
          automaticActivityDetection: { endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_HIGH, silenceDurationMs: 400 },
        },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        ...(withThoughts ? { thinkingConfig: { includeThoughts: true } } : {}),
      },
      callbacks: {
        onmessage: (m) => {
          if (m.setupComplete && !ready) {
            ready = true;
            settle.ok();
          }
          onMessage(m);
        },
        onerror: (e) => addLog("error", "Connection error", e.message),
        onclose: (e) => {
          if (!ready) settle.fail(new Error(e.reason || `Gemini closed the connection (code ${e.code})`));
          else if (session.current === sess) {
            addLog("info", "Session ended", e.reason || `code ${e.code}`);
            stop();
          }
        },
      },
    });
    try {
      await setup;
    } catch (err) {
      sess.close();
      throw err;
    } finally {
      clearTimeout(timer);
    }
    return sess;
  }

  async function start() {
    setStatus("connecting");
    wanted.current = true;
    try {
      player.current = new Player();
      let sess: Session;
      try {
        sess = await connect(true);
      } catch (err) {
        // Some Live models don't accept the "show thoughts" setting; retry without it.
        addLog("info", "Retrying without model thoughts", (err as Error).message);
        sess = await connect(false);
      }
      if (!wanted.current) {
        sess.close();
        return;
      }
      session.current = sess;
      addLog("info", "Connected to Gemini Live. Start talking.");
      const m = await startMic((data) =>
        session.current?.sendRealtimeInput({ audio: { data, mimeType: "audio/pcm;rate=16000" } }),
      );
      if (!wanted.current) {
        m.stop();
        return;
      }
      mic.current = m;
      setStatus("listening");
    } catch (err) {
      addLog("error", "Could not start", (err as Error).message);
      stop();
      setStatus("error");
    }
  }

  function stop() {
    wanted.current = false;
    mic.current?.stop();
    mic.current = null;
    const s = session.current;
    session.current = null;
    s?.close();
    player.current?.close();
    player.current = null;
    setLevel(0);
    setStatus((st) => (st === "error" ? st : "idle"));
    void sortPending(); // file whatever was said last
  }

  function sendTyped(e: React.FormEvent) {
    e.preventDefault();
    const text = typed.trim();
    if (!text || !session.current) return;
    turn.current.gemini = undefined;
    appendLine("you", `${text} (typed)`);
    pending.current += ` ${text}`;
    session.current.sendRealtimeInput({ text });
    setTyped("");
  }

  function reset() {
    boardRef.current = emptyBoard;
    pending.current = "";
    filed.current = "";
    setBoard(emptyBoard);
    setLog([]);
    setLines([]);
  }

  // While listening, sort new words into tracks every two seconds, so tracks
  // grow while the user is still talking.
  useEffect(() => {
    if (status !== "listening") return;
    const timer = setInterval(() => void sortPending(), 2000);
    return () => clearInterval(timer);
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mic level ring while listening.
  useEffect(() => {
    if (status !== "listening") return;
    let raf = 0;
    const tick = () => {
      setLevel(mic.current?.level() ?? 0);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [status]);

  // Close everything if the page is left mid-session.
  useEffect(() => () => stop(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const listening = status === "listening";

  return (
    <div className="flex w-full max-w-6xl flex-col gap-6">
      <section className="flex flex-col items-center gap-3">
        <button
          onClick={listening || status === "connecting" ? stop : start}
          aria-label={listening ? "Stop listening" : "Start talking to Gemini"}
          className={`flex h-24 w-24 items-center justify-center rounded-full text-white transition ${
            listening ? "bg-red-600" : status === "connecting" ? "bg-zinc-500" : "bg-blue-600 hover:bg-blue-700"
          }`}
          style={{ boxShadow: listening ? `0 0 0 ${4 + level * 28}px rgba(220,38,38,0.25)` : undefined }}
        >
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            {listening ? (
              <rect x="7" y="7" width="10" height="10" rx="1" fill="currentColor" />
            ) : (
              <>
                <rect x="9" y="3" width="6" height="11" rx="3" />
                <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
              </>
            )}
          </svg>
        </button>
        <p className="text-sm text-zinc-500">
          {status === "idle" && "Tap the mic and think out loud. Gemini sorts what you say into tracks."}
          {status === "connecting" && "Connecting to Gemini Live..."}
          {listening && "Listening..."}
          {status === "error" && "Something went wrong. See the log below, then try again."}
        </p>
        {listening && (
          <form onSubmit={sendTyped} className="flex w-full max-w-md gap-2">
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="Or type a thought"
              className="flex-1 rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700"
            />
            <button className="rounded-md border border-zinc-300 px-3 text-sm dark:border-zinc-700">Send</button>
          </form>
        )}
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Tracks</h2>
          <button onClick={reset} className="text-sm text-zinc-500 underline">
            Clear
          </button>
        </div>
        {board.tracks.length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
            No tracks yet. They appear here as Gemini files what you say.
          </p>
        ) : (
          <div className="flex gap-4 overflow-x-auto pb-2">
            {board.tracks.map((t) => (
              <div
                key={t.id}
                className={`w-64 shrink-0 rounded-lg border p-3 ${
                  board.active === t.id ? "border-blue-500 ring-2 ring-blue-500/30" : "border-zinc-300 dark:border-zinc-700"
                }`}
              >
                <div className="mb-2 flex items-baseline justify-between gap-2">
                  <h3 className="font-medium">{t.title}</h3>
                  <span className="font-mono text-xs text-zinc-500">{t.id}</span>
                </div>
                <ul className="flex flex-col gap-2 text-sm">
                  {t.items.map((i) => (
                    <li key={i.id} className="rounded bg-zinc-100 p-2 dark:bg-zinc-900">
                      {i.text}
                      <span className="ml-1 font-mono text-xs text-zinc-500">{i.id}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-6 md:grid-cols-2">
        <section>
          <h2 className="mb-2 text-lg font-semibold">Transcript</h2>
          <div className="flex h-80 flex-col gap-2 overflow-y-auto rounded-lg border border-zinc-300 p-3 text-sm dark:border-zinc-700">
            {lines.length === 0 && <p className="text-zinc-500">What you say and what Gemini says back shows up here.</p>}
            {lines.map((l) => (
              <p key={l.id}>
                <span className={`font-medium ${l.who === "you" ? "text-blue-600" : "text-purple-600"}`}>
                  {l.who === "you" ? "You" : "Gemini"}:
                </span>{" "}
                {l.text}
              </p>
            ))}
            {listening && interim && <p className="italic text-zinc-500">{interim}</p>}
          </div>
        </section>
        <section>
          <h2 className="mb-2 text-lg font-semibold">Track changes and reasoning</h2>
          <ol className="flex h-80 flex-col gap-2 overflow-y-auto rounded-lg border border-zinc-300 p-3 text-sm dark:border-zinc-700">
            {log.length === 0 && <p className="text-zinc-500">Every tool call Gemini makes, and why, shows up here.</p>}
            {log.map((e) => (
              <li key={e.id} className="border-b border-zinc-200 pb-2 last:border-0 dark:border-zinc-800">
                <div className="flex gap-2">
                  <span className="shrink-0 font-mono text-xs text-zinc-500">{e.at}</span>
                  <span
                    className={`break-all font-mono text-xs ${
                      e.kind === "error" ? "text-red-600" : e.kind === "tool" ? "text-blue-600" : e.kind === "thought" ? "text-purple-600" : ""
                    }`}
                  >
                    {e.title}
                  </span>
                </div>
                {e.detail && <p className="mt-1 whitespace-pre-wrap text-zinc-600 dark:text-zinc-400">{e.detail}</p>}
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}
