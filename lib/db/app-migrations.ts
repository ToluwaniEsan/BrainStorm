import type { Pool } from "pg";

/**
 * Control-plane schema. `app` holds only the sub -> schema/role mapping and
 * deletion tombstones; per-user roles get no privileges on it.
 */
const APP_MIGRATIONS: string[] = [
  `
  CREATE SCHEMA IF NOT EXISTS app;
  REVOKE ALL ON SCHEMA app FROM PUBLIC;
  REVOKE CREATE ON SCHEMA public FROM PUBLIC;

  CREATE TABLE IF NOT EXISTS app.users (
    id             uuid PRIMARY KEY,
    auth0_sub      text NOT NULL UNIQUE,
    schema_name    text NOT NULL UNIQUE,
    role_name      text NOT NULL UNIQUE,
    schema_version integer NOT NULL DEFAULT 0,
    created_at     timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS app.account_tombstones (
    auth0_sub  text PRIMARY KEY,
    deleted_at timestamptz NOT NULL
  );
  `,
];

export async function migrateApp(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('brainstorm:app-migrations'))");
    const ext = await client.query("SELECT 1 FROM pg_extension WHERE extname = 'vector'");
    if (ext.rowCount === 0) {
      throw new Error(
        "pgvector extension missing: run `CREATE EXTENSION vector;` once as a superuser in this database",
      );
    }
    await client.query(`
      CREATE SCHEMA IF NOT EXISTS app;
      CREATE TABLE IF NOT EXISTS app.migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
    `);
    const { rows } = await client.query<{ v: number | null }>("SELECT max(version) AS v FROM app.migrations");
    const current = rows[0]?.v ?? 0;
    for (let v = current + 1; v <= APP_MIGRATIONS.length; v++) {
      await client.query(APP_MIGRATIONS[v - 1]);
      await client.query("INSERT INTO app.migrations (version) VALUES ($1)", [v]);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
