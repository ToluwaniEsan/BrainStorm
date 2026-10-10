import { z } from "zod";
import { authedRoute, readJson } from "@/lib/auth/route";
import { withUserDb } from "@/lib/db/user-db";
import { getEmbedder } from "@/lib/memory/embeddings";
import { recordUserTranscript, requireActiveSession } from "@/lib/realtime/session";

export const runtime = "nodejs";

const Body = z.object({
  sessionId: z.uuid(),
  itemId: z.string().min(1).max(200),
  text: z.string().max(10_000),
  isFinal: z.boolean(),
  startMs: z.number().int().nonnegative().optional(),
  endMs: z.number().int().nonnegative().optional(),
});

export const POST = authedRoute(async ({ req, ctx, pool }) => {
  const body = Body.parse(await readJson(req));
  const id = await withUserDb(pool, ctx, async (db) => {
    await requireActiveSession(db, ctx, body.sessionId);
    return recordUserTranscript(db, ctx, getEmbedder(), body);
  });
  return Response.json({ id });
});
