import { z } from "zod";
import { authedRoute, readJson } from "@/lib/auth/route";
import { ingestLink, listLinks } from "@/lib/links/ingest";
import { getEmbedder } from "@/lib/memory/embeddings";

export const runtime = "nodejs";

const Body = z.object({ url: z.string().min(1).max(2000) });

export const GET = authedRoute(async ({ ctx, pool }) => {
  return Response.json({ links: await listLinks(pool, ctx) });
});

export const POST = authedRoute(async ({ req, ctx, pool }) => {
  const { url } = Body.parse(await readJson(req));
  const link = await ingestLink(pool, ctx, { embedder: getEmbedder() }, url);
  return Response.json({ link }, { status: link.status === "ready" ? 201 : 202 });
});
