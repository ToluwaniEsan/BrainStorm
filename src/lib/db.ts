import "server-only";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { requireEnv } from "./env";

// Drizzle has no API key of its own. It talks to Supabase Postgres through
// DATABASE_URL, the transaction pooler string (port 6543), which suits
// serverless functions on Vercel. The pooler doesn't support prepared
// statements, hence `prepare: false`.

let sql: postgres.Sql | undefined;
let database: PostgresJsDatabase | undefined;

export function getSql(): postgres.Sql {
  sql ??= postgres(requireEnv("DATABASE_URL"), { prepare: false });
  return sql;
}

export function getDb(): PostgresJsDatabase {
  database ??= drizzle(getSql());
  return database;
}
