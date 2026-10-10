import { desc } from "drizzle-orm";
import { achievements } from "@/db/schema";
import { withUser } from "@/lib/db";
import { HttpError, api, readBody, str } from "@/lib/http";
import { requireUser } from "@/lib/session";
import { indexQuietly } from "@/server/memory";

export const GET = api(async () => {
  const user = await requireUser();
  return withUser(user.sub, (tx) => tx.select().from(achievements).orderBy(desc(achievements.createdAt)));
});

// A past win the user stated themselves.
export const POST = api(async (req: Request) => {
  const user = await requireUser();
  const b = await readBody(req);
  const achievedOn = str(b, "achievedOn", { max: 10 });
  if (achievedOn && !/^\d{4}-\d{2}-\d{2}$/.test(achievedOn)) throw new HttpError(400, "achievedOn must be YYYY-MM-DD");
  const values = { title: str(b, "title", { required: true, max: 300 })!, detail: str(b, "detail"), achievedOn };
  const row = await withUser(user.sub, async (tx) => {
    const [a] = await tx.insert(achievements).values(values).returning();
    await indexQuietly(tx, { sourceType: "ui", sourceTable: "achievements", sourceId: a.id }, [a.title, a.detail].filter(Boolean).join("\n\n"));
    return a;
  });
  return Response.json(row, { status: 201 });
});
