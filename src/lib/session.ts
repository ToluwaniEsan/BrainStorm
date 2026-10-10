import "server-only";
import { auth0 } from "./auth0";
import { provisionUser, schemaForSub } from "./db";
import { HttpError } from "./http";

// Subs this server instance provisioned recently. Entries expire so an
// account deleted through another instance gets its schema back on next use.
const provisioned = new Map<string, number>();
const PROVISION_TTL_MS = 5 * 60_000;

export function forgetUser(sub: string) {
  provisioned.delete(sub);
}

export type User = { sub: string; schema: string; name?: string; email?: string; picture?: string };

// Every API route starts here: no Auth0 session, no data (fail closed).
export async function requireUser(): Promise<User> {
  const session = await auth0.getSession();
  const sub = session?.user?.sub;
  if (!sub) throw new HttpError(401, "Sign in first");
  if ((provisioned.get(sub) ?? 0) < Date.now()) {
    await provisionUser(sub);
    provisioned.set(sub, Date.now() + PROVISION_TTL_MS);
  }
  const { name, email, picture } = session.user;
  return { sub, schema: schemaForSub(sub), name, email, picture };
}

export async function optionalUser(): Promise<string | undefined> {
  return (await auth0.getSession())?.user?.sub;
}
