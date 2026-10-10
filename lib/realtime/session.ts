import type { Pool } from "pg";
import { NotFoundError } from "@/lib/auth/errors";
import type { UserContext } from "@/lib/db/provision";
import { withUserDb, type UserDb } from "@/lib/db/user-db";
import { indexEntity } from "@/lib/memory/chunks";
import type { Embedder } from "@/lib/memory/embeddings";
import { loadSessionMemory } from "@/lib/memory/retrieval";
import { buildRealtimeInstructions } from "@/lib/policy/instructions";
import { listTracks, type TrackView } from "@/lib/tracks/store";
import { realtimeToolDefinitions } from "@/lib/tracks/tools";
import { mintRealtimeClientSecret, type RealtimeSecret } from "./openai";

export class RealtimeUnavailableError extends Error {
  constructor() {
    super("realtime_unavailable");
    this.name = "RealtimeUnavailableError";
  }
}

export interface StartedSession {
  sessionId: string;
  clientSecret: string;
  expiresAt: number;
  model: string;
  tracks: TrackView[];
}

export async function startRealtimeSession(
  pool: Pool,
  ctx: UserContext,
  deps: { apiKey?: string; mint?: typeof mintRealtimeClientSecret } = {},
): Promise<StartedSession> {
  const apiKey = deps.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) throw new RealtimeUnavailableError();
  const mint = deps.mint ?? mintRealtimeClientSecret;

  const { sessionId, memory, tracks } = await withUserDb(pool, ctx, async (db) => {
    const memory = await loadSessionMemory(db, ctx);
    const tracks = await listTracks(db, ctx);
    const { rows } = await db.query<{ id: string }>(
      "INSERT INTO realtime_sessions (user_id, mode, model) VALUES ($1, 'realtime', $2) RETURNING id",
      [ctx.userId, process.env.OPENAI_REALTIME_MODEL || "gpt-realtime"],
    );
    return { sessionId: rows[0].id, memory, tracks };
  });

  let secret: RealtimeSecret;
  try {
    secret = await mint({
      apiKey,
      instructions: buildRealtimeInstructions(memory),
      tools: realtimeToolDefinitions(),
    });
  } catch (err) {
    await withUserDb(pool, ctx, (db) =>
      db.query("UPDATE realtime_sessions SET status = 'ended', ended_at = now() WHERE id = $1 AND user_id = $2", [
        sessionId,
        ctx.userId,
      ]),
    );
    throw err;
  }
  return { sessionId, clientSecret: secret.value, expiresAt: secret.expiresAt, model: secret.model, tracks };
}

export async function requireActiveSession(db: UserDb, ctx: UserContext, sessionId: string): Promise<void> {
  const { rows } = await db.query<{ status: string }>(
    "SELECT status FROM realtime_sessions WHERE id = $1 AND user_id = $2",
    [sessionId, ctx.userId],
  );
  if (!rows[0] || rows[0].status !== "active") throw new NotFoundError("session_not_found");
}

/**
 * Persists a user transcript fragment. Partial fragments arrive while the user
 * is still talking; finals replace them and are indexed into memory.
 * Assistant speech is never stored as memory.
 */
export async function recordUserTranscript(
  db: UserDb,
  ctx: UserContext,
  embedder: Embedder | null,
  input: { sessionId: string; itemId: string; text: string; isFinal: boolean; startMs?: number; endMs?: number },
): Promise<string | null> {
  const text = input.text.trim();
  if (!text) return null;
  const { rows } = await db.query<{ id: string; is_final: boolean }>(
    `INSERT INTO transcripts (user_id, session_id, item_id, speaker, text, is_final, start_ms, end_ms,
                              source_type, source_ref, confidence, transcript_span)
     VALUES ($1, $2::uuid, $3, 'user', $4, $5, $6, $7, 'realtime', $2::text, $8, $9)
     ON CONFLICT (session_id, item_id) WHERE item_id IS NOT NULL DO UPDATE
       SET text = CASE WHEN transcripts.is_final AND NOT EXCLUDED.is_final THEN transcripts.text ELSE EXCLUDED.text END,
           is_final = transcripts.is_final OR EXCLUDED.is_final,
           confidence = CASE WHEN transcripts.is_final OR EXCLUDED.is_final THEN 'user_asserted' ELSE 'live_draft' END,
           updated_at = now()
     RETURNING id, is_final`,
    [
      ctx.userId,
      input.sessionId,
      input.itemId,
      text,
      input.isFinal,
      input.startMs ?? null,
      input.endMs ?? null,
      input.isFinal ? "user_asserted" : "live_draft",
      JSON.stringify({ session_id: input.sessionId, item_id: input.itemId, start_ms: input.startMs, end_ms: input.endMs }),
    ],
  );
  const row = rows[0];
  if (input.isFinal && row.is_final && embedder) {
    await indexEntity(db, ctx, embedder, {
      type: "transcript",
      id: row.id,
      text,
      provenance: {
        sourceType: "realtime",
        sourceRef: input.sessionId,
        confidence: "user_asserted",
        transcriptSpan: { session_id: input.sessionId, transcript_id: row.id },
      },
    });
  }
  return row.id;
}

export async function recentUserSpeech(db: UserDb, ctx: UserContext, sessionId: string, limit = 25) {
  const { rows } = await db.query<{ id: string; text: string }>(
    `SELECT id, text FROM transcripts
      WHERE user_id = $1 AND session_id = $2 AND speaker = 'user' AND deleted_at IS NULL
      ORDER BY created_at DESC LIMIT $3`,
    [ctx.userId, sessionId, limit],
  );
  return rows.reverse();
}

export async function endRealtimeSession(db: UserDb, ctx: UserContext, sessionId: string): Promise<void> {
  const { rowCount } = await db.query(
    "UPDATE realtime_sessions SET status = 'ended', ended_at = now() WHERE id = $1 AND user_id = $2 AND status = 'active'",
    [sessionId, ctx.userId],
  );
  if (!rowCount) throw new NotFoundError("session_not_found");
}
