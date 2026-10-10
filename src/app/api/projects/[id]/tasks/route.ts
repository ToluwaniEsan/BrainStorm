import { asc, eq } from "drizzle-orm";
import { tasks } from "@/db/schema";
import { withUser } from "@/lib/db";
import { api, int, readBody, str, strList, uuidParam } from "@/lib/http";
import { requireUser } from "@/lib/session";

type Ctx = { params: Promise<{ id: string }> };

export const GET = api(async (_req: Request, { params }: Ctx) => {
  const user = await requireUser();
  const projectId = uuidParam((await params).id);
  return withUser(user.sub, (tx) =>
    tx.select().from(tasks).where(eq(tasks.projectId, projectId)).orderBy(asc(tasks.sortOrder), asc(tasks.createdAt)),
  );
});

export const POST = api(async (req: Request, { params }: Ctx) => {
  const user = await requireUser();
  const projectId = uuidParam((await params).id);
  const b = await readBody(req);
  const values = {
    projectId,
    title: str(b, "title", { required: true, max: 300 })!,
    notes: str(b, "notes"),
    status: str(b, "status", { max: 40 }) ?? undefined,
    techStack: strList(b, "techStack"),
    sortOrder: int(b, "sortOrder"),
  };
  const [row] = await withUser(user.sub, (tx) => tx.insert(tasks).values(values).returning());
  return Response.json(row, { status: 201 });
});
