import "server-only";
import { auth0 } from "./auth0";
import { provisionUser, schemaForSub } from "./db";
import { HttpError } from "./http";

// Subs whose schema this server instance has already provisioned.
const provisioned = new Set<string>();

export type User = { sub: string; schema: string; name?: string; email?: string; picture?: string };

// Every API route starts here: no Auth0 session, no data (fail closed).
export async function requireUser(): Promise<User> {
  const session = await auth0.getSession();
  const sub = session?.user?.sub;
  if (!sub) throw new HttpError(401, "Sign in first");
  if (!provisioned.has(sub)) {
    await provisionUser(sub);
    provisioned.add(sub);
  }
  const { name, email, picture } = session.user;
  return { sub, schema: schemaForSub(sub), name, email, picture };
}

export async function optionalUser(): Promise<string | undefined> {
  return (await auth0.getSession())?.user?.sub;
}
