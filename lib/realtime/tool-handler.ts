import type { Pool } from "pg";
import { NotFoundError } from "@/lib/auth/errors";
import type { UserContext } from "@/lib/db/provision";
import { withUserDb, type UserDb } from "@/lib/db/user-db";
import { indexEntity } from "@/lib/memory/chunks";
import type { Embedder } from "@/lib/memory/embeddings";
import { retrieveMemory } from "@/lib/memory/retrieval";
import { findDuplicateTrack, isGroundedInSpeech } from "@/lib/policy/no-ghost";
import { runAssistedSearch } from "@/lib/search/assisted";
import type { SearchProvider } from "@/lib/search/providers";
import {
  appendItem,
  createTrack,
  editItem,
  getActiveTrackId,
  listTracks,
  mergeTracks,
  moveItem,
  recordTrackEvent,
  setActiveTrack,
  type MutationProvenance,
  type TrackEvent,
  type TrackView,
} from "@/lib/tracks/store";
import { TOOL_NAMES, toolSchemas, type ToolName } from "@/lib/tracks/tools";
import { recentUserSpeech, recordUserTranscript, requireActiveSession } from "./session";

export interface ToolCallInput {
  sessionId: string;
  callId: string;
  name: string;
  arguments: unknown;
  /** Latest in-progress transcript the client has heard (realtime transcription can lag tool calls). */
  heard?: { itemId: string; text: string } | null;
}

export interface ToolCallResult {
  output: Record<string, unknown>;
  events: TrackEvent[];
  tracks: TrackView[];
}

const MERGE_LANGUAGE = /\b(?:same (?:thing|track|idea)|merge|combine|one track|together|part of the same|basically the same)\b/i;

const NOT_GROUNDED = {
  ok: false,
  error: "not_grounded",
  hint: "That isn't attributable to what the user said. Do not invent; ask them a short question instead.",
};

function parseArgs(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

export async function handleToolCall(
  pool: Pool,
  ctx: UserContext,
  deps: { embedder: Embedder; searchProvider: SearchProvider | null },
  input: ToolCallInput,
): Promise<ToolCallResult> {
  return withUserDb(pool, ctx, async (db) => {
    await requireActiveSession(db, ctx, input.sessionId);
    if (input.heard?.text) {
      await recordUserTranscript(db, ctx, null, {
        sessionId: input.sessionId,
        itemId: input.heard.itemId,
        text: input.heard.text,
        isFinal: false,
      });
    }

    const events: TrackEvent[] = [];
    let output: Record<string, unknown>;
    try {
      output = await dispatch(db, ctx, deps, input, events);
    } catch (err) {
      if (err instanceof NotFoundError) output = { ok: false, error: err.code };
      else throw err;
    }
    return { output, events, tracks: await listTracks(db, ctx) };
  });
}

async function dispatch(
  db: UserDb,
  ctx: UserContext,
  deps: { embedder: Embedder; searchProvider: SearchProvider | null },
  input: ToolCallInput,
  events: TrackEvent[],
): Promise<Record<string, unknown>> {
  if (!TOOL_NAMES.includes(input.name as ToolName)) return { ok: false, error: "unknown_tool" };
  const name = input.name as ToolName;
  const parsed = toolSchemas[name].safeParse(parseArgs(input.arguments));
  if (!parsed.success) return { ok: false, error: "invalid_arguments", issues: parsed.error.issues.slice(0, 5) };

  const speech = await recentUserSpeech(db, ctx, input.sessionId);
  const heard = speech.map((s) => s.text);
  const span = (quote: string) => ({
    session_id: input.sessionId,
    transcript_ids: speech.slice(-3).map((s) => s.id),
    quote,
  });
  const prov = (quote: string): MutationProvenance => ({
    sessionId: input.sessionId,
    sourceType: "realtime",
    confidence: "live_draft",
    transcriptSpan: span(quote),
  });
  const grounded = (text: string, min = 0.6) => isGroundedInSpeech(text, heard, min);

  const emit = async (event: TrackEvent, quote: string | null, p: MutationProvenance, payload?: Record<string, unknown>) => {
    await recordTrackEvent(db, ctx, event, p, { userQuote: quote, toolCallId: input.callId, payload });
    events.push(event);
  };
  const indexItem = (id: string, body: string, p: MutationProvenance) =>
    indexEntity(db, ctx, deps.embedder, {
      type: "track_item",
      id,
      text: body,
      provenance: { sourceType: p.sourceType, sourceRef: p.sessionId, confidence: p.confidence, transcriptSpan: p.transcriptSpan },
    });

  switch (name) {
    case "track_create": {
      const a = parsed.data as { title: string; first_item?: string; user_quote: string };
      if (!grounded(a.user_quote) || !grounded(a.title, 0.5)) return NOT_GROUNDED;
      if (a.first_item && !grounded(a.first_item, 0.5)) return NOT_GROUNDED;
      const p = prov(a.user_quote);
      const existing = await listTracks(db, ctx);
      const dup = findDuplicateTrack(a.title, existing);
      let trackId: string;
      if (dup) {
        trackId = dup.id;
        await setActiveTrack(db, ctx, trackId, p);
        await emit({ type: "track.switch", trackId, title: dup.title }, a.user_quote, p, { deduplicatedFrom: a.title });
      } else {
        trackId = await createTrack(db, ctx, a.title, p);
        await indexEntity(db, ctx, deps.embedder, {
          type: "track",
          id: trackId,
          text: a.title,
          provenance: { sourceType: "realtime", sourceRef: input.sessionId, confidence: "live_draft", transcriptSpan: p.transcriptSpan },
        });
        await emit({ type: "track.create", trackId, title: a.title.trim() }, a.user_quote, p);
      }
      let itemId: string | undefined;
      if (a.first_item) {
        itemId = await appendItem(db, ctx, trackId, a.first_item, p);
        await indexItem(itemId, a.first_item, p);
        await emit({ type: "track.append", trackId, itemId, body: a.first_item.trim() }, a.user_quote, p);
      }
      return { ok: true, track_id: trackId, item_id: itemId, reused_existing_track: Boolean(dup) };
    }

    case "track_append": {
      const a = parsed.data as { body: string; track_id?: string; user_quote: string };
      if (!grounded(a.user_quote) || !grounded(a.body, 0.5)) return NOT_GROUNDED;
      const p = prov(a.user_quote);
      const trackId = a.track_id ?? (await getActiveTrackId(db, ctx));
      if (!trackId) return { ok: false, error: "no_active_track", hint: "Create a track from the user's words first." };
      const itemId = await appendItem(db, ctx, trackId, a.body, p);
      await indexItem(itemId, a.body, p);
      await emit({ type: "track.append", trackId, itemId, body: a.body.trim() }, a.user_quote, p);
      return { ok: true, track_id: trackId, item_id: itemId };
    }

    case "track_switch": {
      const a = parsed.data as { track_id: string; user_quote: string };
      if (!grounded(a.user_quote)) return NOT_GROUNDED;
      const p = prov(a.user_quote);
      await setActiveTrack(db, ctx, a.track_id, p);
      await emit({ type: "track.switch", trackId: a.track_id }, a.user_quote, p);
      return { ok: true, active_track_id: a.track_id };
    }

    case "track_item_move": {
      const a = parsed.data as { item_id: string; to_track_id: string; user_quote: string };
      if (!grounded(a.user_quote)) return NOT_GROUNDED;
      const p = prov(a.user_quote);
      const { fromTrackId } = await moveItem(db, ctx, a.item_id, a.to_track_id);
      await emit({ type: "track_item.move", trackId: a.to_track_id, itemId: a.item_id, fromTrackId }, a.user_quote, p);
      return { ok: true };
    }

    case "track_item_edit": {
      const a = parsed.data as { item_id: string; body: string; user_quote: string };
      if (!grounded(a.user_quote) || !grounded(a.body, 0.5)) return NOT_GROUNDED;
      const p = prov(a.user_quote);
      const { trackId, previousBody } = await editItem(db, ctx, a.item_id, a.body, p);
      await indexItem(a.item_id, a.body, p);
      await emit({ type: "track_item.edit", trackId, itemId: a.item_id, body: a.body.trim() }, a.user_quote, p, { previousBody });
      return { ok: true };
    }

    case "track_merge": {
      const a = parsed.data as { source_track_id: string; target_track_id: string; user_quote: string };
      if (!grounded(a.user_quote) || !MERGE_LANGUAGE.test(a.user_quote)) {
        return { ok: false, error: "merge_requires_explicit_user_request" };
      }
      const p = prov(a.user_quote);
      await mergeTracks(db, ctx, a.source_track_id, a.target_track_id);
      await emit({ type: "track.merge", trackId: a.target_track_id, fromTrackId: a.source_track_id }, a.user_quote, p);
      return { ok: true, track_id: a.target_track_id };
    }

    case "memory_search": {
      const a = parsed.data as { query: string };
      const hits = await retrieveMemory(db, ctx, deps.embedder, a.query, { k: 6 });
      if (hits.length === 0) {
        return { ok: true, memory: [], note: "Nothing saved matches. Ask the user; do not fill the gap yourself." };
      }
      return {
        ok: true,
        memory: hits.map((h) => ({
          id: h.id,
          entity_type: h.entityType,
          source_type: h.sourceType,
          external_url: h.externalUrl,
          excerpt: h.content.slice(0, 500),
        })),
      };
    }

    case "assisted_search": {
      const a = parsed.data as { user_quote: string; topic: string };
      if (!grounded(a.user_quote)) return NOT_GROUNDED;
      const outcome = await runAssistedSearch({
        db,
        ctx,
        embedder: deps.embedder,
        provider: deps.searchProvider,
        sessionId: input.sessionId,
        userQuote: a.user_quote,
        topic: a.topic,
      });
      return { ok: outcome.status === "ok", ...outcome };
    }
  }
}
