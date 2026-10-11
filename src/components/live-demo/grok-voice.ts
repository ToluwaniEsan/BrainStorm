// Browser side of Grok's realtime voice API (wss://api.x.ai/v1/realtime).
// The page authenticates with a short-lived secret from /api/live/token,
// passed as a WebSocket subprotocol, so the real API key stays on the server.

export type VoiceEvent = { type: string; [k: string]: unknown };

export type VoiceSession = {
  // Base64 16 kHz 16-bit mono PCM from the mic.
  sendAudio: (base64: string) => void;
  // A user text message; `respond` asks for a reply to it straight away.
  sendText: (text: string, respond: boolean) => void;
  // Removes these reply items from the conversation, so the model doesn't
  // remember saying what nobody heard; `cancel` also stops a reply in progress.
  dropReply: (itemIds: string[], cancel: boolean) => void;
  close: () => void;
};

type Options = {
  token: string;
  model: string;
  voice: string;
  instructions: string;
  // Live captions of the user's speech while they talk. Off on the retry if
  // the API rejects the setting.
  captions: boolean;
  onEvent: (e: VoiceEvent) => void;
  onClose: (reason: string) => void;
};

// Opens the socket and resolves once Grok accepts the session settings.
export function connectVoice(o: Options): Promise<VoiceSession> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`wss://api.x.ai/v1/realtime?model=${encodeURIComponent(o.model)}`, [
      `xai-client-secret.${o.token}`,
    ]);
    let settled = false;
    let live = false; // settled successfully: events and closes go to the page
    const send = (e: Record<string, unknown>) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(e));
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ws.close();
      reject(err);
    };
    const timer = setTimeout(() => fail(new Error("Clutter did not answer in time")), 15_000);

    const session: VoiceSession = {
      sendAudio: (audio) => send({ type: "input_audio_buffer.append", audio }),
      sendText(text, respond) {
        send({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text }] } });
        if (respond) send({ type: "response.create" });
      },
      dropReply(itemIds, cancel) {
        if (cancel) send({ type: "response.cancel" });
        for (const id of itemIds) send({ type: "conversation.item.delete", item_id: id });
      },
      close: () => ws.close(),
    };

    ws.onopen = () =>
      send({
        type: "session.update",
        session: {
          instructions: o.instructions,
          voice: o.voice,
          turn_detection: { type: "server_vad" },
          audio: {
            input: {
              format: { type: "audio/pcm", rate: 16000 },
              ...(o.captions ? { transcription: { model: "grok-transcribe" } } : {}),
            },
            // A touch quicker than normal speech, so Clutter sounds lively.
            output: { format: { type: "audio/pcm", rate: 24000 }, speed: 1.12 },
          },
        },
      });
    ws.onmessage = (m) => {
      let e: VoiceEvent;
      try {
        e = JSON.parse(String(m.data));
      } catch {
        return;
      }
      if (!settled && e.type === "session.updated") {
        settled = live = true;
        clearTimeout(timer);
        resolve(session);
      } else if (!settled && e.type === "error") fail(new Error(errorText(e)));
      else if (live) o.onEvent(e);
    };
    ws.onerror = () => fail(new Error("Couldn't connect to Clutter's voice"));
    ws.onclose = (e) => {
      if (!settled) fail(new Error(e.reason || `Clutter closed the connection (code ${e.code})`));
      else if (live) o.onClose(e.reason || `code ${e.code}`);
    };
  });
}

export function errorText(e: VoiceEvent): string {
  const err = e.error as { message?: unknown } | string | undefined;
  if (typeof err === "string") return err;
  if (err && typeof err.message === "string") return err.message;
  return JSON.stringify(e).slice(0, 300);
}
