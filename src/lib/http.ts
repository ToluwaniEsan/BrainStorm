import "server-only";
import { ApiError } from "@google/genai";
import { connection, NextResponse } from "next/server";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// Postgres errors that mean "bad input" rather than "server broke".
const BAD_INPUT_CODES = new Set(["22P02", "22003", "22007", "22008", "23503", "23514", "23502", "22001"]);

function pgCode(err: unknown): string | undefined {
  for (let e = err as { code?: unknown; cause?: unknown } | undefined; e; e = e.cause as typeof e) {
    if (typeof e.code === "string") return e.code;
  }
  return undefined;
}

// Wraps a route handler: returns JSON, maps HttpError and bad-input DB errors
// to 4xx, and hides everything else behind a 500.
export function api<A extends unknown[]>(fn: (...args: A) => Promise<unknown>) {
  return async (...args: A): Promise<Response> => {
    // Opt out of prerendering: every API response is per-request.
    await connection();
    try {
      const result = await fn(...args);
      return result instanceof Response ? result : NextResponse.json(result ?? { ok: true });
    } catch (err) {
      if (err instanceof HttpError) return NextResponse.json({ error: err.message }, { status: err.status });
      if (BAD_INPUT_CODES.has(pgCode(err) ?? "")) {
        return NextResponse.json({ error: "Invalid or unknown reference in request" }, { status: 400 });
      }
      console.error(err);
      // A Gemini API failure (quota, bad request, model unavailable): say so,
      // with Gemini's own status and message, so it can be fixed from the page.
      if (err instanceof ApiError) {
        return NextResponse.json({ error: `Gemini error ${err.status}: ${geminiMessage(err.message)}` }, { status: 502 });
      }
      return NextResponse.json({ error: "Internal error" }, { status: 500 });
    }
  };
}

// Gemini puts its JSON error body in the message; keep just the readable part.
function geminiMessage(raw: string): string {
  try {
    const m = JSON.parse(raw.slice(raw.indexOf("{")))?.error?.message;
    if (typeof m === "string") return m.slice(0, 300);
  } catch {}
  return raw.slice(0, 300);
}

export function notFound(what = "Not found"): never {
  throw new HttpError(404, what);
}

export async function readBody(req: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new HttpError(400, "Expected a JSON body");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "Expected a JSON object");
  return body as Record<string, unknown>;
}

// Small validators. Each returns undefined when the key is absent so PATCH
// bodies can pass only what changes.
type Opts = { required?: boolean; max?: number };

export function str(b: Record<string, unknown>, key: string, { required = false, max = 20_000 }: Opts = {}) {
  const v = b[key];
  if (v === undefined || v === null) {
    if (required) throw new HttpError(400, `${key} is required`);
    return v === null ? null : undefined;
  }
  if (typeof v !== "string") throw new HttpError(400, `${key} must be a string`);
  const t = v.trim();
  if (required && !t) throw new HttpError(400, `${key} is required`);
  if (t.length > max) throw new HttpError(400, `${key} is too long (max ${max})`);
  return t;
}

export function int(b: Record<string, unknown>, key: string) {
  const v = b[key];
  if (v === undefined) return undefined;
  if (typeof v !== "number" || !Number.isInteger(v) || v < -2_147_483_648 || v > 2_147_483_647) {
    throw new HttpError(400, `${key} must be a whole number`);
  }
  return v;
}

export function bool(b: Record<string, unknown>, key: string) {
  const v = b[key];
  if (v === undefined) return undefined;
  if (typeof v !== "boolean") throw new HttpError(400, `${key} must be true or false`);
  return v;
}

export function strList(b: Record<string, unknown>, key: string, max = 50) {
  const v = b[key];
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.length > max || !v.every((x) => typeof x === "string" && x.length <= 200)) {
    throw new HttpError(400, `${key} must be a list of up to ${max} short strings`);
  }
  return v.map((x: string) => x.trim()).filter(Boolean);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function uuidParam(id: string): string {
  if (!UUID.test(id)) notFound();
  return id;
}

export function optUuid(b: Record<string, unknown>, key: string) {
  const v = b[key];
  if (v === undefined || v === null) return v as undefined | null;
  if (typeof v !== "string" || !UUID.test(v)) throw new HttpError(400, `${key} must be an id`);
  return v;
}

// Drops undefined keys so Drizzle's .set() only touches what was sent.
export function defined<T extends Record<string, unknown>>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
