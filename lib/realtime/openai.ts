export interface RealtimeSecret {
  value: string;
  expiresAt: number;
  model: string;
}

export interface MintOptions {
  apiKey: string;
  instructions: string;
  tools: unknown[];
  fetchImpl?: typeof fetch;
  ttlSeconds?: number;
}

/**
 * Mints a short-lived OpenAI Realtime client secret for one authenticated
 * user's session. The browser uses it to open WebRTC directly; the standard
 * API key never leaves the server.
 */
export async function mintRealtimeClientSecret(opts: MintOptions): Promise<RealtimeSecret> {
  const model = process.env.OPENAI_REALTIME_MODEL || "gpt-realtime";
  const fetchImpl = opts.fetchImpl ?? fetch;
  const res = await fetchImpl("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      expires_after: { anchor: "created_at", seconds: opts.ttlSeconds ?? 600 },
      session: {
        type: "realtime",
        model,
        instructions: opts.instructions,
        tools: opts.tools,
        tool_choice: "auto",
        audio: {
          input: {
            transcription: { model: process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe" },
            turn_detection: { type: "server_vad", silence_duration_ms: 500 },
          },
          output: { voice: process.env.OPENAI_REALTIME_VOICE || "marin" },
        },
      },
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`realtime client secret request failed: ${res.status} ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as { value?: string; expires_at?: number };
  if (!json.value) throw new Error("realtime client secret missing in response");
  return { value: json.value, expiresAt: json.expires_at ?? Math.floor(Date.now() / 1000) + 600, model };
}
