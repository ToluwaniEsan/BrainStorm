import { authedRoute } from "@/lib/auth/route";
import { deleteUserStore } from "@/lib/db/provision";

export const runtime = "nodejs";

/** Full wipe: drops the user's schema + role; client then hits /auth/logout to clear the Auth0 session. */
export const DELETE = authedRoute(async ({ ctx, pool }) => {
  await deleteUserStore(pool, ctx);
  return Response.json({ deleted: true, logoutUrl: "/auth/logout" });
});
