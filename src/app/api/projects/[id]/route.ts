import { asc, eq } from "drizzle-orm";
import { projects, tasks, tracks } from "@/db/schema";
import { withUser } from "@/lib/db";
import { api, defined, notFound, optUuid, readBody, str, uuidParam } from "@/lib/http";
import { requireUser } from "@/lib/session";

type Ctx = { params: Promise<{ id: string }> };

// One project with its tasks and tracks (Studio view).
export const GET = api(async (_req: Request, { params }: Ctx) => {
  const user = await requireUser();
  const id = uuidParam((await params).id);
  return withUser(user.sub, async (tx) => {
    const [project] = await tx.select().from(projects).where(eq(projects.id, id));
    if (!project) notFound("Project not found");
    const [taskRows, trackRows] = await Promise.all([
      tx.select().from(tasks).where(eq(tasks.projectId, id)).orderBy(asc(tasks.sortOrder), asc(tasks.createdAt)),
      tx.select().from(tracks).where(eq(tracks.projectId, id)).orderBy(asc(tracks.sortOrder)),
    ]);
    return { ...project, tasks: taskRows, tracks: trackRows };
  });
});

export const PATCH = api(async (req: Request, { params }: Ctx) => {
  const user = await requireUser();
  const id = uuidParam((await params).id);
  const b = await readBody(req);
  const fields = defined({
    title: str(b, "title", { max: 300 }) ?? undefined,
    description: str(b, "description"),
    status: str(b, "status", { max: 40 }) ?? undefined,
    parentId: optUuid(b, "parentId"),
  });
  const [row] = await withUser(user.sub, (tx) =>
    tx.update(projects).set({ ...fields, updatedAt: new Date() }).where(eq(projects.id, id)).returning(),
  );
  return row ?? notFound("Project not found");
});

export const DELETE = api(async (_req: Request, { params }: Ctx) => {
  const user = await requireUser();
  const id = uuidParam((await params).id);
  const [row] = await withUser(user.sub, (tx) => tx.delete(projects).where(eq(projects.id, id)).returning({ id: projects.id }));
  return row ? { ok: true } : notFound("Project not found");
});
