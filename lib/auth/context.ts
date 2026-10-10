import type { Pool } from "pg";
import { ensureUserStore, type UserContext } from "@/lib/db/provision";
import { AuthError } from "./errors";

/** The subset of an Auth0 `SessionData` this module relies on. */
export interface SessionLike {
  user?: { sub?: unknown } | null;
  internal?: { createdAt?: unknown } | null;
}

// Auth0 subjects look like `auth0|abc`, `github|123`, `google-oauth2|...`.
const SUB_RE = /^[A-Za-z0-9_-]{1,64}\|[A-Za-z0-9._:@-]{1,192}$/;

/**
 * Resolves a verified Auth0 session (cookie decrypted by the SDK after OIDC
 * callback verification) to the user's private schema + role.
 * Anything unexpected is a denial: there is no anonymous or demo fallthrough.
 */
export async function resolveUserContext(
  pool: Pool,
  session: SessionLike | null | undefined,
): Promise<UserContext> {
  const sub = session?.user?.sub;
  if (typeof sub !== "string" || !SUB_RE.test(sub)) {
    throw new AuthError(401, "unauthenticated");
  }
  const issuedAt = session?.internal?.createdAt;
  if (typeof issuedAt !== "number" || !Number.isFinite(issuedAt)) {
    throw new AuthError(401, "unauthenticated");
  }

  let ctx: UserContext;
  try {
    const tomb = await pool.query<{ deleted_at: Date }>(
      "SELECT deleted_at FROM app.account_tombstones WHERE auth0_sub = $1",
      [sub],
    );
    const deletedAt = tomb.rows[0]?.deleted_at;
    if (deletedAt && issuedAt * 1000 <= deletedAt.getTime()) {
      throw new AuthError(401, "session_revoked");
    }
    ctx = await ensureUserStore(pool, sub);
  } catch (err) {
    if (err instanceof AuthError) throw err;
    console.error("[auth] store resolution failed", err);
    throw new AuthError(403, "store_unavailable");
  }

  if (ctx.auth0Sub !== sub) throw new AuthError(403, "store_mismatch");
  return ctx;
}
