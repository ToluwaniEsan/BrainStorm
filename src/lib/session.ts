import "server-only";
import { auth0 } from "./auth0";
import { EmailInUseError, provisionUser, schemaForSub } from "./db";
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
  const { name, email, picture } = session.user;
  // One account per email, so only an address Auth0 has verified can be claimed.
  if (email && session.user.email_verified !== true) {
    throw new HttpError(403, "Verify your email address first, then sign in again");
  }
  if ((provisioned.get(sub) ?? 0) < Date.now()) {
    try {
      await provisionUser(sub, { email, name, emailVerified: session.user.email_verified });
    } catch (err) {
      if (err instanceof EmailInUseError) throw new HttpError(409, err.message);
      throw err;
    }
    provisioned.set(sub, Date.now() + PROVISION_TTL_MS);
  }
  return { sub, schema: schemaForSub(sub), name, email, picture };
}

export async function optionalUser(): Promise<string | undefined> {
  return (await auth0.getSession())?.user?.sub;
}
