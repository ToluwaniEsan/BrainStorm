import { eq } from "drizzle-orm";
import { tasks } from "@/db/schema";
import { withUser } from "@/lib/db";
import { api, defined, int, notFound, readBody, str, strList, uuidParam } from "@/lib/http";
import { requireUser } from "@/lib/session";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = api(async (req: Request, { params }: Ctx) => {
  const user = await requireUser();
  const id = uuidParam((await params).id);
  const b = await readBody(req);
  const fields = defined({
    title: str(b, "title", { max: 300 }) ?? undefined,
    notes: str(b, "notes"),
    status: str(b, "status", { max: 40 }) ?? undefined,
    techStack: strList(b, "techStack"),
    sortOrder: int(b, "sortOrder"),
  });
  const [row] = await withUser(user.sub, (tx) =>
    tx.update(tasks).set({ ...fields, updatedAt: new Date() }).where(eq(tasks.id, id)).returning(),
  );
  return row ?? notFound("Task not found");
});

export const DELETE = api(async (_req: Request, { params }: Ctx) => {
  const user = await requireUser();
  const id = uuidParam((await params).id);
  const [row] = await withUser(user.sub, (tx) => tx.delete(tasks).where(eq(tasks.id, id)).returning({ id: tasks.id }));
  return row ? { ok: true } : notFound("Task not found");
});
