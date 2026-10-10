import { asc, eq, inArray } from "drizzle-orm";
import { trackItems, tracks } from "@/db/schema";
import { lockForUser, withUser } from "@/lib/db";
import { api, bool, int, optUuid, readBody, str } from "@/lib/http";
import { requireUser } from "@/lib/session";

// Tracks with their items, optionally for one project (?projectId=).
export const GET = api(async (req: Request) => {
  const user = await requireUser();
  const projectId = optUuid({ projectId: new URL(req.url).searchParams.get("projectId") ?? undefined }, "projectId");
  return withUser(user.sub, async (tx) => {
    const rows = await tx
      .select()
      .from(tracks)
      .where(projectId ? eq(tracks.projectId, projectId) : undefined)
      .orderBy(asc(tracks.sortOrder), asc(tracks.createdAt));
    const items = rows.length
      ? await tx
          .select()
          .from(trackItems)
          .where(inArray(trackItems.trackId, rows.map((t) => t.id)))
          .orderBy(asc(trackItems.sortOrder), asc(trackItems.createdAt))
      : [];
    return rows.map((t) => ({ ...t, items: items.filter((i) => i.trackId === t.id) }));
  });
});

// track.create. If isActive, the new track becomes the only active one.
export const POST = api(async (req: Request) => {
  const user = await requireUser();
  const b = await readBody(req);
  const values = {
    title: str(b, "title", { required: true, max: 300 })!,
    projectId: optUuid(b, "projectId"),
    sortOrder: int(b, "sortOrder"),
    isActive: bool(b, "isActive"),
  };
  const [row] = await withUser(user.sub, async (tx) => {
    if (values.isActive) {
      await lockForUser(tx, "active-track");
      await tx.update(tracks).set({ isActive: false });
    }
    return tx.insert(tracks).values(values).returning();
  });
  return Response.json(row, { status: 201 });
});
