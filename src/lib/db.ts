import "server-only";
import { createHash } from "node:crypto";
import { sql as dsql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { requireEnv } from "./env";

// Drizzle has no API key of its own. It talks to Supabase Postgres through
// DATABASE_URL: the transaction pooler string (port 6543) logged in as the
// brainstorm_app role, which owns no tables and so is always held to RLS.
// The pooler doesn't support prepared statements, hence `prepare: false`, and a
// small per-instance pool keeps many Vercel instances under the pooler's client limit.

let client: postgres.Sql | undefined;
let database: PostgresJsDatabase | undefined;

export function getSql(): postgres.Sql {
  client ??= postgres(requireEnv("DATABASE_URL"), { prepare: false, max: 5 });
  return client;
}

export function getDb(): PostgresJsDatabase {
  database ??= drizzle(getSql());
  return database;
}

// Must match app.schema_for() in db/migrations/0001_foundation.sql.
export function schemaForSub(sub: string): string {
  return `user_${createHash("sha256").update(sub, "utf8").digest("hex").slice(0, 32)}`;
}

// Creates the user's schema on first sign-in (safe to call every time).
export type Identity = { email?: string | null; name?: string | null; emailVerified?: boolean | null };

// Thrown when the signed-in user's email already belongs to another account.
export class EmailInUseError extends Error {
  constructor() {
    super("This email is already linked to another BrainStorm account");
  }
}

// Registers the user (sub, email, name) and creates their schema on first
// sign-in; safe to call every time. Once the schema exists this is one lookup
// and one update, so it runs without a lock: a request that dies mid-call
// (a deploy, a closed tab) can leave its connection stuck for minutes, and if
// it held a lock every later sign-in for that user would time out behind it.
// Only if that fails (two first sign-ins racing to create the same schema)
// does it retry once under a per-sub lock, so they run one at a time.
export async function provisionUser(sub: string, who: Identity = {}): Promise<string> {
  const register = (locked: boolean) =>
    getSql().begin(async (tx) => {
      if (locked) await tx`select pg_advisory_xact_lock(hashtext(${"provision:" + sub}))`;
      return tx`select app.register_user(${sub}, ${who.email ?? null}, ${who.name ?? null},
        ${who.emailVerified ?? null}) as schema`;
    });
  try {
    const [row] = await register(false).catch((err) => {
      if ((err as { code?: string }).code === "BS409") throw err;
      return register(true);
    });
    return row.schema as string;
  } catch (err) {
    if ((err as { code?: string }).code === "BS409") throw new EmailInUseError();
    throw err;
  }
}

export type Tx = Parameters<Parameters<PostgresJsDatabase["transaction"]>[0]>[0];

// Runs fn in a transaction scoped to one signed-in user: app.sub drives RLS
// and search_path points at their schema. Pass the sub from the verified
// Auth0 session only, never from the client.
export function withUser<T>(sub: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return getDb().transaction(async (tx) => {
    await tx.execute(dsql`select set_config('app.sub', ${sub}, true),
      set_config('search_path', ${`${schemaForSub(sub)}, extensions`}, true)`);
    return fn(tx);
  });
}

// Serializes one kind of write for the current user until the transaction
// ends, e.g. so only one track can be made active at a time.
export async function lockForUser(tx: Tx, key: string) {
  await tx.execute(dsql`select pg_advisory_xact_lock(hashtext(current_setting('app.sub') || ${key}))`);
}
