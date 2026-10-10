import { desc } from "drizzle-orm";
import { liveSessions } from "@/db/schema";
import { withUser } from "@/lib/db";
import { api, optUuid, readBody } from "@/lib/http";
import { requireUser } from "@/lib/session";

export const GET = api(async () => {
  const user = await requireUser();
  return withUser(user.sub, (tx) => tx.select().from(liveSessions).orderBy(desc(liveSessions.startedAt)).limit(50));
});

// Starts a Deep Thinking session record (optionally tied to a project).
export const POST = api(async (req: Request) => {
  const user = await requireUser();
  const b = await readBody(req).catch(() => ({}));
  const [row] = await withUser(user.sub, (tx) =>
    tx.insert(liveSessions).values({ projectId: optUuid(b, "projectId") }).returning(),
  );
  return Response.json(row, { status: 201 });
});
