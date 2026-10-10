import { desc } from "drizzle-orm";
import { reflections } from "@/db/schema";
import { withUser } from "@/lib/db";
import { api, readBody, str, strList } from "@/lib/http";
import { requireUser } from "@/lib/session";
import { indexQuietly } from "@/server/memory";

export const GET = api(async () => {
  const user = await requireUser();
  return withUser(user.sub, (tx) => tx.select().from(reflections).orderBy(desc(reflections.createdAt)));
});

// A reflective question and the user's own answer.
export const POST = api(async (req: Request) => {
  const user = await requireUser();
  const b = await readBody(req);
  const values = {
    question: str(b, "question", { required: true, max: 2000 })!,
    answer: str(b, "answer"),
    themes: strList(b, "themes"),
  };
  const [row] = await withUser(user.sub, (tx) => tx.insert(reflections).values(values).returning());
  if (row.answer) {
    await indexQuietly(user.sub, { sourceType: "chat", sourceTable: "reflections", sourceId: row.id }, `${row.question}\n\n${row.answer}`);
  }
  return Response.json(row, { status: 201 });
});
