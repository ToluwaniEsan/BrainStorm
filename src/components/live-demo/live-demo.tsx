"use client";

import { useEffect, useRef, useState } from "react";

import { Player, startMic, type Mic } from "./audio";
import { connectVoice, errorText, type VoiceEvent, type VoiceSession } from "./grok-voice";
import { applyTool, emptyBoard, type Board } from "./tracks";
import { Wave } from "./wave";

type Status = "idle" | "connecting" | "listening" | "error";
type LogEntry = { id: number; at: string; kind: "tool" | "thought" | "info" | "error"; title: string; detail?: string };
type Line = { id: number; who: "you" | "clutter"; text: string };

// Fast check for the obvious ways of asking Clutter for a response. Anything
// subtler ("do you feel me?") is caught by the track sorter's reply_to_user call.
const INVITE =
  /\b(what do you think|what'?s your (take|opinion|view)|what is your (take|opinion|view)|any (thoughts|ideas|feedback)|your thoughts|thoughts on (that|this)|what should i|do you think|(do|can) you (feel|see|get) me|you feel me|you know what i mean|does (that|this) make sense|be honest|am i (crazy|wrong|right)|can you (help|tell me|ask me)|help me (think|out)|talk to me|hey (clutter|brainstorm)|over to you)\b/i;

// While Clutter's reply waits for a verdict on whether the user asked for it.
const HOLD_MS = 6000;

// Track card colours, pastel takes on the Adobe app colours (see clutter.css).
const TRACK_COLORS = ["--c-ps", "--c-ai", "--c-ae", "--c-id", "--c-dw", "--c-lr", "--c-xd", "--c-pr", "--c-ac"];

// Clutter's Home: the voice mode. Tapping the mic fades it out and draws a
// wave where the wordmark was, which moves with your voice; once the first
// track appears the wave rises and the tracks line up under it; stopping
// brings the mic back at the top. Each stopped session is saved to Studio.
//
// How it works: the browser gets a short-lived secret from /api/live/token and
// talks to Grok's realtime voice API directly for transcription and voice,
// with instructions built from what Clutter knows about the user
// (/api/live/context). New transcript goes to /api/live/tracks, where a fast
// Grok text model sorts it into tracks and says whether the user asked for a
// reply. Grok answers every pause, so its voice is held and only plays when
// they did. What the user said goes to /api/live/learn (if learning is on).
export function LiveDemo() {
  const [status, setStatus] = useState<Status>("idle");
  const [board, setBoard] = useState<Board>(emptyBoard);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [interim, setInterim] = useState("");
  const level = useRef(0);
  const [typed, setTyped] = useState("");
  const [details, setDetails] = useState(false);
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);

  const boardRef = useRef<Board>(emptyBoard);
  const session = useRef<VoiceSession | null>(null);
  const mic = useRef<Mic | null>(null);
  const player = useRef<Player | null>(null);
  const seq = useRef(0);
  const turn = useRef<{ you?: number; clutter?: number }>({});
  const wanted = useRef(false); // false once the user presses stop
  const pending = useRef(""); // transcript not yet sorted into tracks
  const filed = useRef(""); // transcript already sorted, for context
  const sorting = useRef(false);
  const sortRetryAt = useRef(0); // after a failed sort, wait until this time before trying again
  const sortBackoff = useRef(0);
  // Reply gate. "idle": Clutter hasn't spoken since the user did. "holding":
  // it started a reply nobody has confirmed was asked for, so it's buffered.
  // "allowed": play it. "muted": drop it.
  const gate = useRef<"idle" | "holding" | "allowed" | "muted">("idle");
  const held = useRef<{ audio: string[]; text: string; done: boolean; items: string[] }>({ audio: [], text: "", done: false, items: [] });
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const invitedNext = useRef(false); // the user's latest words asked for a reply
  const spokeSinceUser = useRef(false);
  const nudged = useRef(false); // nudged Live once since the user last spoke
  const userTail = useRef(""); // the user's latest words since Clutter last finished, for the invite check
  const unlearned = useRef(""); // what the user said that /api/live/learn hasn't seen
  const linesRef = useRef<Line[]>([]);
  linesRef.current = lines;
  const studioId = useRef<string | undefined>(undefined); // this board's saved Studio session
  const startedAt = useRef<string | undefined>(undefined);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const savedKey = useRef(""); // what Studio last got, to skip saves with no change

  const flash = (text: string, error = false) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ text, error });
    toastTimer.current = setTimeout(() => setToast(null), error ? 6000 : 3500);
  };

  const addLog = (kind: LogEntry["kind"], title: string, detail?: string) =>
    setLog((l) => [{ id: ++seq.current, at: new Date().toLocaleTimeString(), kind, title, detail }, ...l].slice(0, 200));

  // Appends streamed transcript text to the current line for that speaker.
  const appendLine = (who: Line["who"], text: string) => {
    const key = who === "you" ? "you" : "clutter";
    const current = turn.current[key];
    if (current === undefined) {
      const id = ++seq.current;
      turn.current[key] = id;
      setLines((ls) => [...ls, { id, who, text }]);
    } else {
      setLines((ls) => ls.map((l) => (l.id === current ? { ...l, text: l.text + text } : l)));
    }
  };

  function showReply(text: string) {
    turn.current.you = undefined;
    appendLine("clutter", text);
  }

  function release() {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    const h = held.current;
    h.audio.forEach((a) => player.current?.play(a));
    if (h.text) showReply(h.text);
    held.current = { audio: [], text: "", done: false, items: [] };
    gate.current = h.done ? "idle" : "allowed";
  }

  function mute(why: string) {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    const wasDone = held.current.done;
    // Stop it and take it out of the conversation, so Clutter doesn't build
    // on a reply the user never heard.
    session.current?.dropReply(held.current.items, !wasDone);
    held.current = { audio: [], text: "", done: false, items: [] };
    gate.current = wasDone ? "idle" : "muted";
    // The user never heard it, so a request Flash confirms later still needs a nudge.
    spokeSinceUser.current = false;
    addLog("info", "Muted a reply you didn't ask for", why);
  }

  // Asks the voice model to answer now (used when the track sorter spots a
  // request for a reply after the voice reply was already dropped).
  function nudge() {
    if (nudged.current) return; // once per thing they said
    nudged.current = true;
    invitedNext.current = true;
    session.current?.sendText("(I'm asking for your response to what I just said. Reply now, briefly.)", true);
  }

  function onUserWords(text: string) {
    pending.current += text;
    unlearned.current += text;
    spokeSinceUser.current = false;
    nudged.current = false;
    // A new user turn ends any reply that was muted, so the next one can be heard.
    if (gate.current === "muted") gate.current = "idle";
    // Transcripts arrive in pieces ("what do you" + " think?"), so check the recent run.
    userTail.current = `${userTail.current}${text}`.slice(-200);
    if (INVITE.test(userTail.current)) invitedNext.current = true;
    if (unlearned.current.length > 3000) void learn();
  }

  // One chunk of Clutter's reply (audio and/or its transcript), through the gate.
  function onReply(audio: string | undefined, text: string, itemId: unknown) {
    spokeSinceUser.current = true;
    if (gate.current === "idle") {
      if (invitedNext.current) gate.current = "allowed";
      else {
        // Not obviously asked for: hold it while the track sorter checks the user's words.
        gate.current = "holding";
        holdTimer.current = setTimeout(() => mute("No request for a reply was found in time."), HOLD_MS);
        void sortPending();
      }
    }
    if (gate.current === "allowed") {
      if (audio) player.current?.play(audio);
      if (text) showReply(text);
    } else if (gate.current === "holding") {
      if (audio) held.current.audio.push(audio);
      held.current.text += text;
      if (typeof itemId === "string" && !held.current.items.includes(itemId)) held.current.items.push(itemId);
    }
  }

  function onEvent(e: VoiceEvent) {
    switch (e.type) {
      case "conversation.item.input_audio_transcription.updated":
        setInterim(String(e.transcript ?? ""));
        break;
      case "conversation.item.input_audio_transcription.completed": {
        setInterim("");
        const text = String(e.transcript ?? "").trim();
        if (!text) break;
        turn.current.clutter = undefined;
        appendLine("you", ` ${text}`);
        onUserWords(` ${text}`);
        // The transcript can land after Clutter has started a (held) reply.
        if (gate.current === "holding") {
          if (invitedNext.current) release();
          else void sortPending();
        }
        break;
      }
      case "response.output_audio.delta":
        if (typeof e.delta === "string") onReply(e.delta, "", e.item_id);
        break;
      case "response.output_audio_transcript.delta":
        if (typeof e.delta === "string") onReply(undefined, e.delta, e.item_id);
        break;
      case "input_audio_buffer.speech_started":
        // The user talked over Clutter: stop playback. A held or muted reply
        // is abandoned; whatever comes next is judged afresh.
        player.current?.clear();
        if (gate.current === "holding") {
          if (holdTimer.current) clearTimeout(holdTimer.current);
          session.current?.dropReply(held.current.items, !held.current.done);
          held.current = { audio: [], text: "", done: false, items: [] };
        }
        if (gate.current === "holding" || gate.current === "muted") gate.current = "idle";
        break;
      case "response.done":
        turn.current = {};
        // An invite only counts for the turn it was said in.
        userTail.current = "";
        if (gate.current === "holding") {
          held.current.done = true;
          // They asked while this reply was held: it is the answer, so play it now.
          if (invitedNext.current) {
            release();
            invitedNext.current = false;
          }
        } else if (invitedNext.current && !spokeSinceUser.current && !nudged.current) {
          // They asked, but Clutter's reply was dropped or empty: ask it once to answer.
          nudge();
        } else {
          gate.current = "idle";
          invitedNext.current = false;
        }
        void sortPending();
        break;
      case "error":
        addLog("error", "Voice error", errorText(e));
        break;
    }
  }

  // Sends what the user said to /api/live/learn, which saves lasting facts
  // about them (only if they left learning on in their profile).
  async function learn() {
    const text = unlearned.current.trim();
    if (!text) return;
    unlearned.current = "";
    try {
      const res = await fetch("/api/live/learn", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Learning failed (${res.status})`);
      if (body.learned?.length) addLog("info", "Learned about you", (body.learned as string[]).map((f) => `• ${f}`).join("\n"));
    } catch (err) {
      addLog("error", "Learning from this session failed", (err as Error).message);
    }
  }

  // Sends the transcript gathered since the last call to the track sorter and
  // applies the track changes it returns. One request at a time.
  async function sortPending() {
    const text = pending.current.trim();
    if (!text || sorting.current || Date.now() < sortRetryAt.current) return;
    sorting.current = true;
    pending.current = "";
    let wantsReply = false;
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
      sortBackoff.current = 0;
      filed.current += ` ${text}`;
      for (const t of (body.thoughts ?? []) as string[]) addLog("thought", "Clutter's reasoning", t);
      let changed = false;
      for (const call of (body.calls ?? []) as { name: string; args: Record<string, unknown> }[]) {
        const { reason, ...rest } = call.args;
        const why = typeof reason === "string" ? `Why: ${reason}` : "";
        if (call.name === "reply_to_user") {
          wantsReply = true;
          addLog("tool", "You asked Clutter for a response", why);
          continue;
        }
        changed = true;
        const { board: next, result } = applyTool(boardRef.current, call.name, call.args);
        boardRef.current = next;
        addLog(
          result.ok ? "tool" : "error",
          `${call.name}(${Object.entries(rest).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(", ")})`,
          [why, result.ok ? "" : String(result.error)].filter(Boolean).join("\n"),
        );
      }
      setBoard(boardRef.current);
      if (!changed) addLog("info", "No track change", `For: "${text}"`);
    } catch (err) {
      // Keep the words so the next round tries them again.
      pending.current = `${text} ${pending.current}`.slice(-4000);
      // Back off (4 s, 8 s, ... up to 30 s) instead of retrying on every event.
      sortBackoff.current = Math.min(sortBackoff.current ? sortBackoff.current * 2 : 4000, 30_000);
      sortRetryAt.current = Date.now() + sortBackoff.current;
      addLog("error", "Sorting into tracks failed", (err as Error).message);
    } finally {
      sorting.current = false;
    }

    if (wantsReply) {
      if (gate.current === "holding") release();
      else if (!spokeSinceUser.current || gate.current === "muted") nudge();
      // Otherwise Clutter already answered (its reply was heard); nothing more to allow.
    } else if (gate.current === "holding") {
      // Words not yet checked may still hold the request; check them first.
      if (pending.current.trim() && Date.now() >= sortRetryAt.current) void sortPending();
      else if (!pending.current.trim()) mute("Clutter only speaks when you turn to it for a response.");
    }
  }

  async function connect(extras: { captions: boolean }): Promise<VoiceSession> {
    const res = await fetch("/api/live/token", { method: "POST" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? `Token request failed (${res.status})`);
    addLog("info", "Got a short-lived voice token", `Model: ${body.model}`);

    const ctx = await fetch("/api/live/context").then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (!ctx) addLog("error", "Couldn't load what Clutter knows about you", "Clutter starts without it.");
    else {
      const { documents = 0, links = 0 } = ctx.sources ?? {};
      addLog("info", "Clutter has your profile", `${documents} document${documents === 1 ? "" : "s"} and ${links} link${links === 1 ? "" : "s"} it can read.`);
      if (!ctx.learningEnabled) addLog("info", "Learning is off", "Clutter uses only what's in your profile.");
    }
    const systemInstruction: string =
      ctx?.instruction ?? "Your name is Clutter. Stay silent unless the user asks for your response. Then answer briefly and ask a grounding follow-up question.";

    const sess = await connectVoice({
      token: body.token,
      model: body.model,
      voice: body.voice ?? "eve",
      instructions: systemInstruction,
      captions: extras.captions,
      onEvent,
      onClose: (reason) => {
        if (session.current === sess) {
          addLog("info", "Session ended", reason);
          stop();
        }
      },
    });
    // Put their documents and links into the conversation itself; voice models
    // follow that more reliably than a long system instruction.
    if (ctx?.primer) sess.sendText(ctx.primer, false);
    return sess;
  }

  async function start() {
    setStatus("connecting");
    wanted.current = true;
    startedAt.current ??= new Date().toISOString();
    try {
      player.current = new Player();
      // Live captions need a transcription setting the API may reject, so
      // retry without them.
      const attempts = [{ captions: true }, { captions: false }];
      let sess: VoiceSession | undefined;
      for (const [i, extras] of attempts.entries()) {
        try {
          sess = await connect(extras);
          break;
        } catch (err) {
          if (i === attempts.length - 1) throw err;
          addLog("info", "Voice service rejected a setting, retrying with fewer", (err as Error).message);
        }
      }
      if (!sess) throw new Error("Could not connect");
      if (!wanted.current) {
        sess.close();
        return;
      }
      session.current = sess;
      addLog("info", "Connected to Clutter. Start talking.");
      const m = await startMic((data) => session.current?.sendAudio(data));
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
    level.current = 0;
    setStatus((st) => (st === "error" ? st : "idle"));
    void sortPending().then(() => save()); // file whatever was said last, then save to Studio
    void learn();
    if (holdTimer.current) clearTimeout(holdTimer.current);
    gate.current = "idle";
    held.current = { audio: [], text: "", done: false, items: [] };
  }

  // What would be saved to Studio right now.
  const snapshot = () => ({
    id: studioId.current,
    startedAt: startedAt.current,
    tracks: boardRef.current.tracks.map((t) => ({ title: t.title, items: t.items.map((i) => i.text) })),
    lines: linesRef.current.map((l) => ({ who: l.who === "you" ? "you" : "clutter", text: l.text })),
  });

  // Saves the board and transcript to Studio, replacing this board's earlier
  // save. Saves run one after another, so the first one's id is known before
  // the next. `final` (on stop) waits for a running track sort, then says so.
  function save(final = true): Promise<void> {
    saveQueue.current = saveQueue.current.then(async () => {
      if (final) for (let i = 0; i < 75 && sorting.current; i++) await new Promise((r) => setTimeout(r, 200));
      const data = snapshot();
      if (!data.tracks.length && !data.lines.length) return;
      const key = JSON.stringify(data);
      if (key === savedKey.current && !final) return;
      try {
        const res = await fetch("/api/studio", { method: "POST", headers: { "content-type": "application/json" }, body: key });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? `Saving failed (${res.status})`);
        studioId.current = body.id;
        savedKey.current = JSON.stringify({ ...data, id: body.id });
        const n = data.tracks.length;
        if (final) flash(`Saved to Studio${n ? ` with ${n} track${n === 1 ? "" : "s"}` : ""}`);
      } catch (err) {
        addLog("error", "Saving to Studio failed", (err as Error).message);
        if (final) flash("Couldn't save this session to Studio. Open Details for why.", true);
      }
    });
    return saveQueue.current;
  }

  function sendTyped(e: React.FormEvent) {
    e.preventDefault();
    const text = typed.trim();
    if (!text || !session.current) return;
    turn.current.clutter = undefined;
    appendLine("you", ` ${text} (typed)`);
    onUserWords(` ${text}`);
    session.current.sendText(text, true);
    setTyped("");
  }

  // Starts a fresh board; the last one stays saved in Studio.
  function reset() {
    boardRef.current = emptyBoard;
    pending.current = "";
    filed.current = "";
    unlearned.current = "";
    studioId.current = undefined;
    startedAt.current = undefined;
    savedKey.current = "";
    setBoard(emptyBoard);
    setLog([]);
    setLines([]);
    if (window.location.search) window.history.replaceState(null, "", "/");
  }

  // "Pick this back up" in Studio opens Home with ?session=<id>: load that
  // session's tracks and transcript so talking continues where it left off.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("session");
    if (!id) return;
    let alive = true;
    fetch(`/api/studio/${encodeURIComponent(id)}`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? `Couldn't open that session (${res.status})`);
        return body as { id: string; startedAt: string; tracks: { title: string; items: string[] }[]; lines: { who: "you" | "clutter"; text: string }[] };
      })
      .then((saved) => {
        if (!alive) return;
        let next = 1;
        const tracks = saved.tracks.map((t) => ({
          id: `t${next++}`,
          title: t.title,
          items: t.items.map((text) => ({ id: `i${next++}`, text })),
        }));
        boardRef.current = { tracks, next, active: tracks.at(-1)?.id };
        filed.current = saved.lines.filter((l) => l.who === "you").map((l) => l.text).join(" ").slice(-1500);
        studioId.current = saved.id;
        startedAt.current = saved.startedAt;
        setBoard(boardRef.current);
        setLines(saved.lines.map((l) => ({ id: ++seq.current, who: l.who === "you" ? "you" : "clutter", text: l.text })));
      })
      .catch((err) => alive && flash((err as Error).message, true));
    return () => {
      alive = false;
    };
  }, []);

  // While listening, sort new words into tracks every two seconds, so tracks
  // grow while the user is still talking.
  useEffect(() => {
    if (status !== "listening") return;
    const timer = setInterval(() => void sortPending(), 2000);
    return () => clearInterval(timer);
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  // While talking, keep Studio up to date every 20 seconds, so a closed tab
  // or a dropped connection never loses the discussion.
  useEffect(() => {
    if (status !== "listening") return;
    const timer = setInterval(() => void save(false), 20_000);
    // Last chance when the page is closed mid-session.
    const leaving = () => {
      const data = snapshot();
      if (data.tracks.length || data.lines.length) navigator.sendBeacon("/api/studio", new Blob([JSON.stringify(data)], { type: "application/json" }));
    };
    window.addEventListener("pagehide", leaving);
    return () => {
      clearInterval(timer);
      window.removeEventListener("pagehide", leaving);
    };
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mic level for the wave while listening.
  useEffect(() => {
    if (status !== "listening") return;
    let raf = 0;
    const tick = () => {
      level.current = mic.current?.level() ?? 0;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [status]);

  // Close everything if the page is left mid-session.
  useEffect(() => () => stop(), []); // eslint-disable-line react-hooks/exhaustive-deps


  const listening = status === "listening";
  const live = listening || status === "connecting";
  const phase = live ? (board.tracks.length ? "tracks" : "wave") : board.tracks.length ? "ended" : "idle";

  // While a session runs or its tracks are on screen, the background colour
  // gathers in a little toward the wave (clutter.css watches this attribute).
  useEffect(() => {
    if (phase === "idle") delete document.body.dataset.clutterSession;
    else document.body.dataset.clutterSession = "";
  }, [phase]);
  useEffect(() => () => void delete document.body.dataset.clutterSession, []);

  const last = lines.at(-1);
  const caption =
    status === "connecting" ? (
      "Connecting to Clutter..."
    ) : listening && interim ? (
      <>
        <b>You:</b> {interim}
      </>
    ) : last ? (
      <>
        <b>{last.who === "you" ? "You" : "Clutter"}:</b> {last.text.slice(-220)}
      </>
    ) : (
      "Listening..."
    );

  return (
    <div className="c-home" data-phase={phase}>
      <div className="c-mark">
        <h1>CLUTTER</h1>
        <p>Say it messy. Clutter sorts it.</p>
      </div>

      <div className="c-stage">
        <Wave level={level} on={live} compact={phase === "tracks" || phase === "ended"} />
        <div className="c-under">
          <p className="c-caption" aria-live="polite">{live && caption}</p>
          {live && (
            <div className="c-controls">
              {listening && (
                <form onSubmit={sendTyped} className="c-type">
                  <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Or type a thought" aria-label="Type a thought" />
                  <button className="c-pill-btn">Send</button>
                </form>
              )}
              <button className="c-pill-btn" onClick={stop}>
                End session
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="c-tracks">
        <div className="c-track-grid">
          {board.tracks.map((t, n) => (
            <article
              key={t.id}
              className={`c-card${live && board.active === t.id ? " active" : ""}`}
              style={{ "--c": `var(${TRACK_COLORS[n % TRACK_COLORS.length]})` } as React.CSSProperties}
            >
              <h3>
                <i />
                {t.title}
              </h3>
              <ul>
                {t.items.map((i) => (
                  <li key={i.id}>{i.text}</li>
                ))}
              </ul>
              <div className="c-card-meta">
                {t.items.length} thought{t.items.length === 1 ? "" : "s"}
                {live && board.active === t.id ? " · talking about this now" : ""}
              </div>
            </article>
          ))}
        </div>
      </div>

      <div className="c-mic-wrap">
        <button
          className="c-mic"
          onClick={() => void start()}
          disabled={live}
          aria-label={phase === "ended" ? "Keep talking" : "Start talking to Clutter"}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <rect x="9" y="3" width="6" height="11" rx="3" />
            <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" />
          </svg>
        </button>
        <div className="c-mic-hint">{status === "error" ? "Couldn't start. Open Details for why." : "Tap to start a session"}</div>
      </div>

      <div className={`c-toast${toast ? " show" : ""}${toast?.error ? " error" : ""}`} role="status">
        {toast?.text}
      </div>

      {details && (
        <div className="c-drawer c-panel">
          <section>
            <h2>Transcript</h2>
            <div className="c-transcript">
              {lines.length === 0 && <p className="c-note">What you say and what Clutter says back shows up here.</p>}
              {lines.map((l) => (
                <p key={l.id}>
                  <b>{l.who === "you" ? "You" : "Clutter"}:</b> {l.text}
                </p>
              ))}
              {listening && interim && <p className="c-note">{interim}</p>}
            </div>
          </section>
          <section>
            <h2>What Clutter did</h2>
            <ol>
              {log.length === 0 && <li className="c-note">Track changes, Clutter&apos;s reasoning and any errors show up here.</li>}
              {log.map((e) => (
                <li key={e.id}>
                  <span className="c-note">{e.at}</span> <span className={`c-log-title ${e.kind}`}>{e.title}</span>
                  {e.detail && <pre>{e.detail}</pre>}
                </li>
              ))}
            </ol>
          </section>
        </div>
      )}
      <div className="c-corner">
        <button className="c-pill-btn" onClick={() => setDetails((d) => !d)} aria-expanded={details}>
          {details ? "Hide details" : "Details"}
          {!details && log.some((e) => e.kind === "error") ? " ⚠︎" : ""}
        </button>
        {phase === "ended" && (
          <button className="c-pill-btn" onClick={reset}>
            New session
          </button>
        )}
      </div>
    </div>
  );
}
