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
export async function provisionUser(sub: string): Promise<string> {
  const [row] = await getSql()`select app.provision_user(${sub}) as schema`;
  return row.schema as string;
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
