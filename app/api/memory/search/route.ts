import { z } from "zod";
import { authedRoute, readJson } from "@/lib/auth/route";
import { withUserDb } from "@/lib/db/user-db";
import { getEmbedder } from "@/lib/memory/embeddings";
import { retrieveMemory } from "@/lib/memory/retrieval";

export const runtime = "nodejs";

const Body = z.object({ query: z.string().min(1).max(1000), k: z.number().int().min(1).max(32).optional() });

export const POST = authedRoute(async ({ req, ctx, pool }) => {
  const { query, k } = Body.parse(await readJson(req));
  const hits = await withUserDb(pool, ctx, (db) => retrieveMemory(db, ctx, getEmbedder(), query, { k }));
  return Response.json({ hits });
});
