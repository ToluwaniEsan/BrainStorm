import { z } from "zod";
import { authedRoute, readJson } from "@/lib/auth/route";
import { withUserDb } from "@/lib/db/user-db";
import { endRealtimeSession } from "@/lib/realtime/session";

export const runtime = "nodejs";

const Body = z.object({ sessionId: z.uuid() });

export const POST = authedRoute(async ({ req, ctx, pool }) => {
  const { sessionId } = Body.parse(await readJson(req));
  await withUserDb(pool, ctx, (db) => endRealtimeSession(db, ctx, sessionId));
  return Response.json({ ok: true });
});
