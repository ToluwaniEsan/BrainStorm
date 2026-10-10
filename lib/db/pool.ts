import { Pool } from "pg";

declare global {
  var __brainstormPool: Pool | undefined;
}

/**
 * Admin pool. Connects as the app's owner role (non-superuser, CREATEROLE).
 * Never run user-scoped queries on it directly: go through `withUserDb`.
 */
export function getPool(): Pool {
  if (!globalThis.__brainstormPool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is not set");
    globalThis.__brainstormPool = new Pool({ connectionString, max: 10 });
  }
  return globalThis.__brainstormPool;
}

export async function closePool(): Promise<void> {
  const pool = globalThis.__brainstormPool;
  globalThis.__brainstormPool = undefined;
  await pool?.end();
}
