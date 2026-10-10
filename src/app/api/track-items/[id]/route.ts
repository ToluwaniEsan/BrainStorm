import { eq } from "drizzle-orm";
import { trackItems } from "@/db/schema";
import { withUser } from "@/lib/db";
import { api, defined, int, notFound, optUuid, readBody, str, uuidParam } from "@/lib/http";
import { requireUser } from "@/lib/session";
import { clearMemory, indexQuietly } from "@/server/memory";

type Ctx = { params: Promise<{ id: string }> };

// track_item.edit / track_item.move (send trackId to move it).
export const PATCH = api(async (req: Request, { params }: Ctx) => {
  const user = await requireUser();
  const id = uuidParam((await params).id);
  const b = await readBody(req);
  const fields = defined({
    body: str(b, "body") ?? undefined,
    trackId: optUuid(b, "trackId") ?? undefined,
    sortOrder: int(b, "sortOrder"),
    confidence: str(b, "confidence", { max: 40 }) ?? undefined,
  });
  const [item] = await withUser(user.sub, (tx) =>
    tx.update(trackItems).set({ ...fields, updatedAt: new Date() }).where(eq(trackItems.id, id)).returning(),
  );
  if (!item) notFound("Item not found");
  // Re-index on any body change, including clearing it (that drops its chunks).
  if (fields.body !== undefined) {
    await indexQuietly(user.sub, { sourceType: "realtime", sourceTable: "track_items", sourceId: item.id }, item.body);
  }
  return item;
});

export const DELETE = api(async (_req: Request, { params }: Ctx) => {
  const user = await requireUser();
  const id = uuidParam((await params).id);
  const [row] = await withUser(user.sub, async (tx) => {
    await clearMemory(tx, { sourceTable: "track_items", sourceId: id });
    return tx.delete(trackItems).where(eq(trackItems.id, id)).returning({ id: trackItems.id });
  });
  return row ? { ok: true } : notFound("Item not found");
});
