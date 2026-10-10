import { z } from "zod";
import { authedRoute, readJson } from "@/lib/auth/route";
import { getEmbedder } from "@/lib/memory/embeddings";
import { handleToolCall } from "@/lib/realtime/tool-handler";
import { getSearchProvider } from "@/lib/search/providers";

export const runtime = "nodejs";

const Body = z.object({
  sessionId: z.uuid(),
  callId: z.string().min(1).max(200),
  name: z.string().min(1).max(64),
  arguments: z.union([z.string().max(20_000), z.record(z.string(), z.unknown())]),
  heard: z.object({ itemId: z.string().min(1).max(200), text: z.string().max(5000) }).nullish(),
});

export const POST = authedRoute(async ({ req, ctx, pool }) => {
  const body = Body.parse(await readJson(req));
  const result = await handleToolCall(pool, ctx, { embedder: getEmbedder(), searchProvider: getSearchProvider() }, body);
  return Response.json(result);
});
