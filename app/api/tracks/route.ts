import { authedRoute } from "@/lib/auth/route";
import { withUserDb } from "@/lib/db/user-db";
import { listTracks } from "@/lib/tracks/store";

export const runtime = "nodejs";

export const GET = authedRoute(async ({ ctx, pool }) => {
  const tracks = await withUserDb(pool, ctx, (db) => listTracks(db, ctx));
  return Response.json({ tracks });
});
