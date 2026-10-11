import "server-only";
import { requireEnv } from "./env";

// Server-side xAI (Grok) calls. Importing this from a client component fails
// the build, which keeps XAI_API_KEY out of the browser bundle.

export const XAI_BASE = "https://api.x.ai/v1";

export const xaiModels = {
  // Realtime speech-to-speech for the voice mode.
  get voice() {
    return requireEnv("XAI_VOICE_MODEL");
  },
  // Quick calls made while the user talks: sorting into tracks, learning facts.
  get fast() {
    return requireEnv("XAI_FAST_MODEL");
  },
  // Slower, careful work: reading uploaded files, summarising the user.
  get text() {
    return requireEnv("XAI_TEXT_MODEL");
  },
};

export class XaiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "XaiError";
  }
}

export async function xaiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${requireEnv("XAI_API_KEY")}`);
  if (typeof init.body === "string") headers.set("content-type", "application/json");
  const res = await fetch(`${XAI_BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    throw new XaiError(readableError(await res.text().catch(() => "")), res.status);
  }
  return res;
}

// xAI's error body is JSON ({"error": "..."} or {"error": {"message": "..."}});
// keep just the readable part.
function readableError(raw: string): string {
  try {
    const e = JSON.parse(raw)?.error;
    const m = typeof e === "string" ? e : e?.message;
    if (typeof m === "string") return m.slice(0, 300);
  } catch {}
  return raw.slice(0, 300) || "no details";
}

type ContentPart =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string }
  | { type: "input_file"; file_id: string };

export type InputMessage = { role: "system" | "user" | "assistant"; content: string | ContentPart[] };

export type FunctionTool = { type: "function"; name: string; description: string; parameters: Record<string, unknown> };

type OutputItem = {
  type: string;
  name?: string;
  arguments?: string;
  content?: { type: string; text?: string }[];
  summary?: { text?: string }[];
};
export type XaiResponse = { output?: OutputItem[]; output_text?: string };

// One call to the Responses API.
export async function respond(body: {
  model: string;
  input: InputMessage[];
  tools?: FunctionTool[];
  tool_choice?: "auto" | "required" | "none";
  text?: { format: { type: "json_schema"; name: string; schema: Record<string, unknown>; strict?: boolean } };
}): Promise<XaiResponse> {
  const res = await xaiFetch("/responses", { method: "POST", body: JSON.stringify({ store: false, ...body }) });
  return res.json();
}

export function outputText(res: XaiResponse): string {
  if (typeof res.output_text === "string") return res.output_text.trim();
  return (res.output ?? [])
    .filter((o) => o.type === "message")
    .flatMap((o) => o.content ?? [])
    .map((c) => c.text ?? "")
    .join("")
    .trim();
}

export function functionCalls(res: XaiResponse): { name: string; args: Record<string, unknown> }[] {
  return (res.output ?? [])
    .filter((o) => o.type === "function_call" && o.name)
    .map((o) => {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(o.arguments || "{}");
      } catch {
        // A malformed call is dropped below by the caller's own checks.
      }
      return { name: o.name!, args };
    });
}

export function reasoningSummaries(res: XaiResponse): string[] {
  return (res.output ?? [])
    .filter((o) => o.type === "reasoning")
    .flatMap((o) => o.summary ?? [])
    .map((s) => s.text ?? "")
    .filter(Boolean);
}

// Short-lived secret so the browser can open the realtime voice socket
// directly (Vercel functions can't hold a long-lived socket). The real
// XAI_API_KEY never leaves the server.
export async function createVoiceToken() {
  const seconds = 600;
  const res = await xaiFetch("/realtime/client_secrets", {
    method: "POST",
    body: JSON.stringify({ expires_after: { seconds } }),
  });
  const body = (await res.json()) as { value?: string; expires_at?: number; client_secret?: { value?: string } };
  const token = body.value ?? body.client_secret?.value;
  if (!token) throw new Error("xAI returned no voice token");
  const expiresAt = new Date(body.expires_at ? body.expires_at * 1000 : Date.now() + seconds * 1000).toISOString();
  return { token, model: xaiModels.voice, expiresAt };
}
