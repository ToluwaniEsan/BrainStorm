import type { UserDb } from "@/lib/db/user-db";
import type { UserContext } from "@/lib/db/provision";
import { toVectorLiteral, type Embedder } from "./embeddings";

export interface MemoryHit {
  id: string;
  entityType: string;
  entityId: string;
  content: string;
  sourceType: string;
  sourceRef: string | null;
  confidence: string;
  externalUrl: string | null;
  score: number;
}

interface HitRow {
  id: string;
  entity_type: string;
  entity_id: string;
  content: string;
  source_type: string;
  source_ref: string | null;
  confidence: string;
  external_url: string | null;
  score: number;
}

/**
 * Top-k memory chunks for `query`, from the caller's own schema only.
 * The `user_id` predicate is redundant with schema grants and RLS on purpose.
 */
export async function retrieveMemory(
  db: UserDb,
  ctx: UserContext,
  embedder: Embedder,
  query: string,
  opts: { k?: number; minScore?: number } = {},
): Promise<MemoryHit[]> {
  const text = query.trim();
  if (!text) return [];
  const k = Math.min(Math.max(opts.k ?? 8, 1), 32);
  const minScore = opts.minScore ?? 0.2;
  const [vec] = await embedder.embed([text]);
  const { rows } = await db.query<HitRow>(
    `SELECT id, entity_type, entity_id, content, source_type, source_ref, confidence, external_url,
            1 - (embedding <=> $1::vector) AS score
       FROM memory_chunks
      WHERE user_id = $2 AND deleted_at IS NULL
      ORDER BY embedding <=> $1::vector
      LIMIT $3`,
    [toVectorLiteral(vec), ctx.userId, k],
  );
  return rows
    .map((r) => ({
      id: r.id,
      entityType: r.entity_type,
      entityId: r.entity_id,
      content: r.content,
      sourceType: r.source_type,
      sourceRef: r.source_ref,
      confidence: r.confidence,
      externalUrl: r.external_url,
      score: Number(r.score),
    }))
    .filter((h) => h.score >= minScore);
}

export interface SessionMemory {
  profile: { id: string; intro: string | null; portfolio: string | null } | null;
  tracks: Array<{ id: string; title: string; isActive: boolean; items: Array<{ id: string; body: string }> }>;
  recent: MemoryHit[];
  chunkCount: number;
}

/** Context pack loaded when a live session opens: profile, existing tracks, recent memory. */
export async function loadSessionMemory(db: UserDb, ctx: UserContext): Promise<SessionMemory> {
  const profile = await db.query<{ id: string; intro: string | null; portfolio: string | null }>(
    "SELECT id, intro, portfolio FROM profile WHERE user_id = $1 ORDER BY created_at LIMIT 1",
    [ctx.userId],
  );
  const tracks = await db.query<{ id: string; title: string; is_active: boolean }>(
    `SELECT id, title, is_active FROM tracks
      WHERE user_id = $1 AND deleted_at IS NULL ORDER BY sort_order, created_at LIMIT 30`,
    [ctx.userId],
  );
  const items = await db.query<{ id: string; track_id: string; body: string }>(
    `SELECT id, track_id, body FROM track_items
      WHERE user_id = $1 AND deleted_at IS NULL ORDER BY sort_order, created_at`,
    [ctx.userId],
  );
  const recent = await db.query<HitRow>(
    `SELECT id, entity_type, entity_id, content, source_type, source_ref, confidence, external_url, 1 AS score
       FROM memory_chunks WHERE user_id = $1 AND deleted_at IS NULL
      ORDER BY created_at DESC LIMIT 12`,
    [ctx.userId],
  );
  const count = await db.query<{ n: string }>(
    "SELECT count(*) AS n FROM memory_chunks WHERE user_id = $1 AND deleted_at IS NULL",
    [ctx.userId],
  );
  return {
    profile: profile.rows[0] ?? null,
    tracks: tracks.rows.map((t) => ({
      id: t.id,
      title: t.title,
      isActive: t.is_active,
      items: items.rows.filter((i) => i.track_id === t.id).slice(-8).map((i) => ({ id: i.id, body: i.body })),
    })),
    recent: recent.rows.map((r) => ({
      id: r.id,
      entityType: r.entity_type,
      entityId: r.entity_id,
      content: r.content,
      sourceType: r.source_type,
      sourceRef: r.source_ref,
      confidence: r.confidence,
      externalUrl: r.external_url,
      score: 1,
    })),
    chunkCount: Number(count.rows[0]?.n ?? 0),
  };
}
