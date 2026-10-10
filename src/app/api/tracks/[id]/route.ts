import { and, eq, inArray, ne } from "drizzle-orm";
import { memoryChunks, trackItems, tracks } from "@/db/schema";
import { lockForUser, withUser } from "@/lib/db";
import { api, bool, defined, int, notFound, optUuid, readBody, str, uuidParam } from "@/lib/http";
import { requireUser } from "@/lib/session";

type Ctx = { params: Promise<{ id: string }> };

// Rename, reorder, attach to a project, or switch to it (isActive: true).
export const PATCH = api(async (req: Request, { params }: Ctx) => {
  const user = await requireUser();
  const id = uuidParam((await params).id);
  const b = await readBody(req);
  const fields = defined({
    title: str(b, "title", { max: 300 }) ?? undefined,
    projectId: optUuid(b, "projectId"),
    sortOrder: int(b, "sortOrder"),
    isActive: bool(b, "isActive"),
  });
  return withUser(user.sub, async (tx) => {
    if (fields.isActive) await lockForUser(tx, "active-track");
    const [row] = await tx.update(tracks).set({ ...fields, updatedAt: new Date() }).where(eq(tracks.id, id)).returning();
    // Throwing here rolls back, so an unknown id changes nothing.
    if (!row) notFound("Track not found");
    if (fields.isActive) await tx.update(tracks).set({ isActive: false }).where(ne(tracks.id, id));
    return row;
  });
});

export const DELETE = api(async (_req: Request, { params }: Ctx) => {
  const user = await requireUser();
  const id = uuidParam((await params).id);
  const [row] = await withUser(user.sub, async (tx) => {
    const items = tx.select({ id: trackItems.id }).from(trackItems).where(eq(trackItems.trackId, id));
    await tx
      .delete(memoryChunks)
      .where(and(eq(memoryChunks.sourceTable, "track_items"), inArray(memoryChunks.sourceId, items)));
    return tx.delete(tracks).where(eq(tracks.id, id)).returning({ id: tracks.id });
  });
  return row ? { ok: true } : notFound("Track not found");
});
