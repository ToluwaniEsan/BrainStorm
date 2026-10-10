import { and, eq } from "drizzle-orm";
import { links, memoryChunks } from "@/db/schema";
import { withUser } from "@/lib/db";
import { api, notFound, uuidParam } from "@/lib/http";
import { requireUser } from "@/lib/session";

type Ctx = { params: Promise<{ id: string }> };

export const DELETE = api(async (_req: Request, { params }: Ctx) => {
  const user = await requireUser();
  const id = uuidParam((await params).id);
  const [row] = await withUser(user.sub, async (tx) => {
    await tx.delete(memoryChunks).where(and(eq(memoryChunks.sourceTable, "links"), eq(memoryChunks.sourceId, id)));
    return tx.delete(links).where(eq(links.id, id)).returning({ id: links.id });
  });
  return row ? { ok: true } : notFound("Link not found");
});
