import "server-only";
import { asc, desc, eq, inArray } from "drizzle-orm";

import { liveSessions, trackItems, tracks, transcripts } from "@/db/schema";
import type { Tx } from "@/lib/db";
import { HttpError } from "@/lib/http";

// Studio: each Home session saved with the tracks it produced and what was
// said. A session's tracks are the ones whose thoughts carry its session_id;
// Clutter's own lines are stored in transcripts with the CLUTTER prefix.

export type StudioLine = { who: "you" | "clutter"; text: string };
export type StudioTrack = { title: string; items: string[] };
export type StudioSession = { id: string; startedAt: Date; endedAt: Date | null; tracks: StudioTrack[]; lines: StudioLine[] };

const CLUTTER = "[clutter] ";

export async function loadSessions(tx: Tx, only?: string): Promise<StudioSession[]> {
  const sessions = await tx
    .select()
    .from(liveSessions)
    .where(only ? eq(liveSessions.id, only) : undefined)
    .orderBy(desc(liveSessions.startedAt));
  if (!sessions.length) return [];
  const ids = sessions.map((s) => s.id);
  const items = await tx
    .select({ sessionId: trackItems.sessionId, trackId: tracks.id, title: tracks.title, body: trackItems.body })
    .from(trackItems)
    .innerJoin(tracks, eq(tracks.id, trackItems.trackId))
    .where(inArray(trackItems.sessionId, ids))
    .orderBy(asc(tracks.sortOrder), asc(tracks.createdAt), asc(trackItems.sortOrder), asc(trackItems.createdAt));
  const said = await tx
    .select({ sessionId: transcripts.sessionId, body: transcripts.body })
    .from(transcripts)
    .where(inArray(transcripts.sessionId, ids))
    .orderBy(asc(transcripts.spokenAt));

  return sessions
    .map((s) => {
      const byTrack = new Map<string, StudioTrack>();
      for (const i of items) {
        if (i.sessionId !== s.id) continue;
        const t = byTrack.get(i.trackId) ?? { title: i.title, items: [] };
        t.items.push(i.body);
        byTrack.set(i.trackId, t);
      }
      const lines = said
        .filter((l) => l.sessionId === s.id)
        .map((l): StudioLine => (l.body.startsWith(CLUTTER) ? { who: "clutter", text: l.body.slice(CLUTTER.length) } : { who: "you", text: l.body }));
      return { id: s.id, startedAt: s.startedAt, endedAt: s.endedAt, tracks: [...byTrack.values()], lines };
    })
    .filter((s) => s.tracks.length || s.lines.length);
}

// Removes a session's tracks (and with them their thoughts) and transcript.
async function clearSession(tx: Tx, id: string) {
  const owned = await tx.selectDistinct({ id: trackItems.trackId }).from(trackItems).where(eq(trackItems.sessionId, id));
  if (owned.length) await tx.delete(tracks).where(inArray(tracks.id, owned.map((t) => t.id)));
  await tx.delete(transcripts).where(eq(transcripts.sessionId, id));
}

// Saves the whole board for a session, replacing what was saved for it before
// (a session can be stopped and resumed, and is saved each time it stops).
export async function saveSession(tx: Tx, id: string | undefined, startedAt: Date | undefined, data: { tracks: StudioTrack[]; lines: StudioLine[] }) {
  let sessionId = id;
  if (sessionId) {
    const [found] = await tx.select({ id: liveSessions.id }).from(liveSessions).where(eq(liveSessions.id, sessionId));
    if (!found) throw new HttpError(404, "Session not found");
    await clearSession(tx, sessionId);
    await tx.update(liveSessions).set({ endedAt: new Date() }).where(eq(liveSessions.id, sessionId));
  } else {
    const [row] = await tx.insert(liveSessions).values({ startedAt, endedAt: new Date() }).returning({ id: liveSessions.id });
    sessionId = row.id;
  }

  for (const [n, t] of data.tracks.entries()) {
    const [track] = await tx.insert(tracks).values({ title: t.title, sortOrder: n }).returning({ id: tracks.id });
    if (t.items.length) {
      await tx.insert(trackItems).values(t.items.map((body, k) => ({ trackId: track.id, sessionId, body, sortOrder: k })));
    }
  }
  if (data.lines.length) {
    // Spaced a millisecond apart so they read back in order.
    const base = Date.now() - data.lines.length;
    await tx.insert(transcripts).values(
      data.lines.map((l, k) => ({
        sessionId: sessionId!,
        body: l.who === "clutter" ? `${CLUTTER}${l.text}` : l.text,
        isFinal: true,
        spokenAt: new Date(base + k),
      })),
    );
  }
  return sessionId;
}

export async function deleteSession(tx: Tx, id: string) {
  await clearSession(tx, id);
  const gone = await tx.delete(liveSessions).where(eq(liveSessions.id, id)).returning({ id: liveSessions.id });
  return gone.length > 0;
}

// Checks the body of a save request.
export function parseSave(b: Record<string, unknown>): { tracks: StudioTrack[]; lines: StudioLine[] } {
  const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  if (!Array.isArray(b.tracks) || b.tracks.length > 60) throw new HttpError(400, "tracks must be a list of up to 60");
  if (!Array.isArray(b.lines) || b.lines.length > 3000) throw new HttpError(400, "lines must be a list of up to 3000");
  const trackList = b.tracks.map((t) => {
    const o = (t ?? {}) as Record<string, unknown>;
    const items = Array.isArray(o.items) ? o.items.slice(0, 300).map((i) => text(i, 4000)).filter(Boolean) : [];
    return { title: text(o.title, 300) || "Untitled", items };
  });
  const lines = b.lines
    .map((l) => {
      const o = (l ?? {}) as Record<string, unknown>;
      return { who: o.who === "clutter" ? ("clutter" as const) : ("you" as const), text: text(o.text, 8000) };
    })
    .filter((l) => l.text);
  return { tracks: trackList, lines };
}
