import type { Pool } from "pg";
import { ZodError } from "zod";
import { getPool } from "@/lib/db/pool";
import type { UserContext } from "@/lib/db/provision";
import { auth0 } from "./auth0";
import { resolveUserContext } from "./context";
import { AuthError, BadRequestError, NotFoundError } from "./errors";

export interface AuthedRequest<P> {
  req: Request;
  ctx: UserContext;
  pool: Pool;
  params: P;
}

/** Resolves the caller's store from the Auth0 session cookie or throws. */
export async function requireUserContext(): Promise<UserContext> {
  const session = await auth0.getSession();
  return resolveUserContext(getPool(), session);
}

/**
 * Wraps an App Router handler so it only runs with a verified, server-derived
 * user context. Client-supplied user ids are never read.
 */
export function authedRoute<P = Record<string, never>>(
  handler: (args: AuthedRequest<P>) => Promise<Response>,
) {
  return async (req: Request, route?: { params?: Promise<P> }): Promise<Response> => {
    try {
      const ctx = await requireUserContext();
      const params = ((await route?.params) ?? {}) as P;
      return await handler({ req, ctx, pool: getPool(), params });
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export function errorResponse(err: unknown): Response {
  if (err instanceof AuthError) return Response.json({ error: err.code }, { status: err.status });
  if (err instanceof ZodError) {
    return Response.json({ error: "invalid_request", issues: err.issues }, { status: 400 });
  }
  if (err instanceof BadRequestError) {
    return Response.json({ error: err.code, detail: err.detail }, { status: 400 });
  }
  if (err instanceof NotFoundError) return Response.json({ error: err.code }, { status: 404 });
  console.error("[api] unhandled", err);
  return Response.json({ error: "internal_error" }, { status: 500 });
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new BadRequestError("invalid_json");
  }
}
