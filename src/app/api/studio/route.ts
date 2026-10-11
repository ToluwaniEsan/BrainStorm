import { withUser } from "@/lib/db";
import { HttpError, api, optUuid, readBody, str } from "@/lib/http";
import { requireUser } from "@/lib/session";
import { loadSessions, parseSave, saveSession } from "@/server/studio";

// Studio: past sessions with their tracks and transcript, newest first.
export const GET = api(async () => {
  const user = await requireUser();
  return withUser(user.sub, (tx) => loadSessions(tx));
});

// Saves the Home board when a session stops. Pass id to replace an earlier
// save of the same session.
export const POST = api(async (req: Request) => {
  const user = await requireUser();
  const b = await readBody(req);
  const id = optUuid(b, "id") ?? undefined;
  const at = str(b, "startedAt", { max: 40 });
  const startedAt = at ? new Date(at) : undefined;
  if (startedAt && Number.isNaN(startedAt.getTime())) throw new HttpError(400, "startedAt must be an ISO date-time");
  const data = parseSave(b);
  const saved = await withUser(user.sub, (tx) => saveSession(tx, id, startedAt, data));
  return Response.json({ id: saved }, { status: id ? 200 : 201 });
});
