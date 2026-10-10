import { desc } from "drizzle-orm";
import { projects } from "@/db/schema";
import { withUser } from "@/lib/db";
import { api, optUuid, readBody, str } from "@/lib/http";
import { requireUser } from "@/lib/session";

export const GET = api(async () => {
  const user = await requireUser();
  return withUser(user.sub, (tx) => tx.select().from(projects).orderBy(desc(projects.updatedAt)));
});

export const POST = api(async (req: Request) => {
  const user = await requireUser();
  const b = await readBody(req);
  const values = {
    title: str(b, "title", { required: true, max: 300 })!,
    description: str(b, "description"),
    status: str(b, "status", { max: 40 }) ?? undefined,
    parentId: optUuid(b, "parentId"),
  };
  const [row] = await withUser(user.sub, (tx) => tx.insert(projects).values(values).returning());
  return Response.json(row, { status: 201 });
});
