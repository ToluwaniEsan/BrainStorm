import { NotFoundError } from "@/lib/auth/errors";
import type { UserDb } from "@/lib/db/user-db";
import type { UserContext } from "@/lib/db/provision";
import type { Confidence, SourceType } from "@/lib/db/user-migrations";

export type TrackEventType =
  | "track.create"
  | "track.append"
  | "track.switch"
  | "track_item.move"
  | "track_item.edit"
  | "track.merge";

export interface TrackItemView {
  id: string;
  trackId: string;
  body: string;
  sortOrder: number;
  confidence: string;
}

export interface TrackView {
  id: string;
  title: string;
  sortOrder: number;
  isActive: boolean;
  items: TrackItemView[];
}

export interface TrackEvent {
  type: TrackEventType;
  trackId: string;
  itemId?: string;
  fromTrackId?: string;
  title?: string;
  body?: string;
}

export interface MutationProvenance {
  sessionId: string | null;
  sourceType: SourceType;
  confidence: Confidence;
  transcriptSpan: Record<string, unknown> | null;
}

export async function listTracks(db: UserDb, ctx: UserContext): Promise<TrackView[]> {
  const tracks = await db.query<{ id: string; title: string; sort_order: number; is_active: boolean }>(
    `SELECT id, title, sort_order, is_active FROM tracks
      WHERE user_id = $1 AND deleted_at IS NULL ORDER BY sort_order, created_at`,
    [ctx.userId],
  );
  const items = await db.query<{ id: string; track_id: string; body: string; sort_order: number; confidence: string }>(
    `SELECT id, track_id, body, sort_order, confidence FROM track_items
      WHERE user_id = $1 AND deleted_at IS NULL ORDER BY sort_order, created_at`,
    [ctx.userId],
  );
  return tracks.rows.map((t) => ({
    id: t.id,
    title: t.title,
    sortOrder: t.sort_order,
    isActive: t.is_active,
    items: items.rows
      .filter((i) => i.track_id === t.id)
      .map((i) => ({ id: i.id, trackId: i.track_id, body: i.body, sortOrder: i.sort_order, confidence: i.confidence })),
  }));
}

export async function requireTrack(db: UserDb, ctx: UserContext, trackId: string) {
  const { rows } = await db.query<{ id: string; title: string; is_active: boolean }>(
    "SELECT id, title, is_active FROM tracks WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL",
    [trackId, ctx.userId],
  );
  if (!rows[0]) throw new NotFoundError("track_not_found");
  return rows[0];
}

export async function requireItem(db: UserDb, ctx: UserContext, itemId: string) {
  const { rows } = await db.query<{ id: string; track_id: string; body: string }>(
    "SELECT id, track_id, body FROM track_items WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL",
    [itemId, ctx.userId],
  );
  if (!rows[0]) throw new NotFoundError("item_not_found");
  return rows[0];
}

export async function getActiveTrackId(db: UserDb, ctx: UserContext): Promise<string | null> {
  const { rows } = await db.query<{ id: string }>(
    "SELECT id FROM tracks WHERE user_id = $1 AND is_active AND deleted_at IS NULL",
    [ctx.userId],
  );
  return rows[0]?.id ?? null;
}

async function touchSession(db: UserDb, ctx: UserContext, trackId: string, sessionId: string | null) {
  if (!sessionId) return;
  await db.query(
    `UPDATE tracks SET session_ids = array_append(session_ids, $3::uuid), updated_at = now()
      WHERE id = $1 AND user_id = $2 AND NOT ($3::uuid = ANY(session_ids))`,
    [trackId, ctx.userId, sessionId],
  );
}

export async function setActiveTrack(db: UserDb, ctx: UserContext, trackId: string, prov: MutationProvenance) {
  await requireTrack(db, ctx, trackId);
  await db.query("UPDATE tracks SET is_active = false WHERE user_id = $1 AND is_active", [ctx.userId]);
  await db.query("UPDATE tracks SET is_active = true, updated_at = now() WHERE id = $1 AND user_id = $2", [
    trackId,
    ctx.userId,
  ]);
  await touchSession(db, ctx, trackId, prov.sessionId);
}

export async function createTrack(
  db: UserDb,
  ctx: UserContext,
  title: string,
  prov: MutationProvenance,
): Promise<string> {
  const { rows: ord } = await db.query<{ n: number }>(
    "SELECT COALESCE(max(sort_order), -1) + 1 AS n FROM tracks WHERE user_id = $1",
    [ctx.userId],
  );
  await db.query("UPDATE tracks SET is_active = false WHERE user_id = $1 AND is_active", [ctx.userId]);
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO tracks (user_id, title, sort_order, is_active, session_ids, source_type, source_ref, confidence, transcript_span)
     VALUES ($1, $2, $3, true, $4::uuid[], $5, $6, $7, $8) RETURNING id`,
    [
      ctx.userId,
      title.trim(),
      ord[0].n,
      prov.sessionId ? [prov.sessionId] : [],
      prov.sourceType,
      prov.sessionId,
      prov.confidence,
      prov.transcriptSpan ? JSON.stringify(prov.transcriptSpan) : null,
    ],
  );
  return rows[0].id;
}

export async function appendItem(
  db: UserDb,
  ctx: UserContext,
  trackId: string,
  body: string,
  prov: MutationProvenance,
): Promise<string> {
  await requireTrack(db, ctx, trackId);
  const { rows: ord } = await db.query<{ n: number }>(
    "SELECT COALESCE(max(sort_order), -1) + 1 AS n FROM track_items WHERE user_id = $1 AND track_id = $2",
    [ctx.userId, trackId],
  );
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO track_items (user_id, track_id, body, sort_order, source_type, source_ref, confidence, transcript_span)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [
      ctx.userId,
      trackId,
      body.trim(),
      ord[0].n,
      prov.sourceType,
      prov.sessionId,
      prov.confidence,
      prov.transcriptSpan ? JSON.stringify(prov.transcriptSpan) : null,
    ],
  );
  await touchSession(db, ctx, trackId, prov.sessionId);
  return rows[0].id;
}

export async function moveItem(db: UserDb, ctx: UserContext, itemId: string, toTrackId: string) {
  const item = await requireItem(db, ctx, itemId);
  await requireTrack(db, ctx, toTrackId);
  const { rows: ord } = await db.query<{ n: number }>(
    "SELECT COALESCE(max(sort_order), -1) + 1 AS n FROM track_items WHERE user_id = $1 AND track_id = $2",
    [ctx.userId, toTrackId],
  );
  await db.query(
    "UPDATE track_items SET track_id = $3, sort_order = $4, updated_at = now() WHERE id = $1 AND user_id = $2",
    [itemId, ctx.userId, toTrackId, ord[0].n],
  );
  return { fromTrackId: item.track_id };
}

export async function editItem(db: UserDb, ctx: UserContext, itemId: string, body: string, prov: MutationProvenance) {
  const item = await requireItem(db, ctx, itemId);
  await db.query(
    `UPDATE track_items SET body = $3, confidence = $4, transcript_span = COALESCE($5, transcript_span), updated_at = now()
      WHERE id = $1 AND user_id = $2`,
    [itemId, ctx.userId, body.trim(), prov.confidence, prov.transcriptSpan ? JSON.stringify(prov.transcriptSpan) : null],
  );
  return { trackId: item.track_id, previousBody: item.body };
}

export async function mergeTracks(db: UserDb, ctx: UserContext, sourceId: string, targetId: string) {
  if (sourceId === targetId) throw new NotFoundError("cannot_merge_into_self");
  const source = await requireTrack(db, ctx, sourceId);
  await requireTrack(db, ctx, targetId);
  const { rows: ord } = await db.query<{ n: number }>(
    "SELECT COALESCE(max(sort_order), -1) + 1 AS n FROM track_items WHERE user_id = $1 AND track_id = $2",
    [ctx.userId, targetId],
  );
  await db.query(
    `UPDATE track_items SET track_id = $3, sort_order = sort_order + $4, updated_at = now()
      WHERE user_id = $1 AND track_id = $2`,
    [ctx.userId, sourceId, targetId, ord[0].n],
  );
  await db.query(
    `UPDATE tracks SET merged_into = $3, deleted_at = now(), is_active = false, updated_at = now()
      WHERE id = $2 AND user_id = $1`,
    [ctx.userId, sourceId, targetId],
  );
  if (source.is_active) {
    await db.query("UPDATE tracks SET is_active = true WHERE id = $1 AND user_id = $2", [targetId, ctx.userId]);
  }
}

export async function recordTrackEvent(
  db: UserDb,
  ctx: UserContext,
  event: TrackEvent,
  prov: MutationProvenance,
  extra: { userQuote: string | null; toolCallId: string | null; payload?: Record<string, unknown> },
) {
  await db.query(
    `INSERT INTO track_events
       (user_id, session_id, event_type, track_id, item_id, payload, user_quote, tool_call_id,
        source_type, source_ref, confidence, transcript_span)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      ctx.userId,
      prov.sessionId,
      event.type,
      event.trackId,
      event.itemId ?? null,
      JSON.stringify({ ...event, ...(extra.payload ?? {}) }),
      extra.userQuote,
      extra.toolCallId,
      prov.sourceType,
      prov.sessionId,
      prov.confidence,
      prov.transcriptSpan ? JSON.stringify(prov.transcriptSpan) : null,
    ],
  );
}
