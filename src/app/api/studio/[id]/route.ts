import { withUser } from "@/lib/db";
import { api, notFound, uuidParam } from "@/lib/http";
import { requireUser } from "@/lib/session";
import { deleteSession, loadSessions } from "@/server/studio";

type Ctx = { params: Promise<{ id: string }> };

// One saved session, for picking it back up on Home.
export const GET = api(async (_req: Request, { params }: Ctx) => {
  const user = await requireUser();
  const id = uuidParam((await params).id);
  const [found] = await withUser(user.sub, (tx) => loadSessions(tx, id));
  return found ?? notFound("Session not found");
});

// Deletes the session with its tracks and transcript.
export const DELETE = api(async (_req: Request, { params }: Ctx) => {
  const user = await requireUser();
  const id = uuidParam((await params).id);
  const gone = await withUser(user.sub, (tx) => deleteSession(tx, id));
  return gone ? { ok: true } : notFound("Session not found");
});
