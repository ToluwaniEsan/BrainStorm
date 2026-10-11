import { after } from "next/server";
import { eq } from "drizzle-orm";
import { userFacts } from "@/db/schema";
import { withUser } from "@/lib/db";
import { api, notFound, uuidParam } from "@/lib/http";
import { requireUser } from "@/lib/session";
import { clearMemory } from "@/server/memory";
import { refreshLater } from "@/server/understanding";

type Ctx = { params: Promise<{ id: string }> };

// Forgets one learned fact, including its memory chunks.
export const DELETE = api(async (_req: Request, { params }: Ctx) => {
  const user = await requireUser();
  const id = uuidParam((await params).id);
  const [row] = await withUser(user.sub, async (tx) => {
    await clearMemory(tx, { sourceTable: "user_facts", sourceId: id });
    return tx.delete(userFacts).where(eq(userFacts.id, id)).returning();
  });
  if (!row) notFound("Fact not found");
  after(() => refreshLater(user.sub));
  return { ok: true };
});
