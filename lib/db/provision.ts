import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { assertUserRole, assertUserSchema, ident, namesForUserId } from "./identifiers";
import { LATEST_USER_SCHEMA_VERSION, migrateUserSchema } from "./user-migrations";

/** Server-side binding of a verified Auth0 subject to its private store. */
export interface UserContext {
  readonly userId: string;
  readonly auth0Sub: string;
  readonly schema: string;
  readonly role: string;
}

interface UserRow {
  id: string;
  auth0_sub: string;
  schema_name: string;
  role_name: string;
  schema_version: number;
}

function toContext(row: UserRow): UserContext {
  return Object.freeze({
    userId: row.id,
    auth0Sub: row.auth0_sub,
    schema: assertUserSchema(row.schema_name),
    role: assertUserRole(row.role_name),
  });
}

async function inTx<T>(pool: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Finds or provisions the user's schema + role for a verified Auth0 `sub`.
 * First login creates an empty store: no seed rows, no ghost data.
 */
export async function ensureUserStore(pool: Pool, auth0Sub: string): Promise<UserContext> {
  const existing = await pool.query<UserRow>(
    "SELECT id, auth0_sub, schema_name, role_name, schema_version FROM app.users WHERE auth0_sub = $1",
    [auth0Sub],
  );
  if (existing.rows[0] && existing.rows[0].schema_version >= LATEST_USER_SCHEMA_VERSION) {
    return toContext(existing.rows[0]);
  }

  return inTx(pool, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('brainstorm:provision:' || $1))", [auth0Sub]);
    const locked = await client.query<UserRow>(
      "SELECT id, auth0_sub, schema_name, role_name, schema_version FROM app.users WHERE auth0_sub = $1",
      [auth0Sub],
    );
    let row = locked.rows[0];

    if (!row) {
      const id = randomUUID();
      const { schema, role } = namesForUserId(id);
      const s = ident(schema);
      const r = ident(role);
      await client.query(`CREATE ROLE ${r} NOLOGIN NOINHERIT NOCREATEDB NOCREATEROLE`);
      // Admin needs SET (not INHERIT) membership so it can act as the user role per request.
      await client.query(`GRANT ${r} TO CURRENT_USER WITH INHERIT FALSE, SET TRUE`);
      await client.query(`CREATE SCHEMA ${s}`);
      await client.query(`REVOKE ALL ON SCHEMA ${s} FROM PUBLIC`);
      await client.query(`GRANT USAGE ON SCHEMA ${s} TO ${r}`);
      const inserted = await client.query<UserRow>(
        `INSERT INTO app.users (id, auth0_sub, schema_name, role_name, schema_version)
         VALUES ($1, $2, $3, $4, 0)
         RETURNING id, auth0_sub, schema_name, role_name, schema_version`,
        [id, auth0Sub, schema, role],
      );
      row = inserted.rows[0];
    }

    const version = await migrateUserSchema(client, row.schema_name, row.role_name, row.schema_version);
    if (version !== row.schema_version) {
      await client.query("UPDATE app.users SET schema_version = $2 WHERE id = $1", [row.id, version]);
    }
    return toContext({ ...row, schema_version: version });
  });
}

/**
 * Account delete: drops the user's schema (all tables, vectors, indexes) and
 * role, removes the mapping, and tombstones the sub so sessions issued before
 * now are refused.
 */
export async function deleteUserStore(pool: Pool, ctx: UserContext): Promise<void> {
  const s = ident(assertUserSchema(ctx.schema));
  const r = ident(assertUserRole(ctx.role));
  await inTx(pool, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('brainstorm:provision:' || $1))", [ctx.auth0Sub]);
    await client.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`);
    await client.query(`DROP ROLE IF EXISTS ${r}`);
    await client.query("DELETE FROM app.users WHERE id = $1", [ctx.userId]);
    await client.query(
      `INSERT INTO app.account_tombstones (auth0_sub, deleted_at) VALUES ($1, clock_timestamp())
       ON CONFLICT (auth0_sub) DO UPDATE SET deleted_at = EXCLUDED.deleted_at`,
      [ctx.auth0Sub],
    );
  });
}

/** Fan-out migration for every provisioned user (used by `npm run db:migrate`). */
export async function migrateAllUserSchemas(pool: Pool): Promise<number> {
  const { rows } = await pool.query<{ auth0_sub: string }>(
    "SELECT auth0_sub FROM app.users WHERE schema_version < $1",
    [LATEST_USER_SCHEMA_VERSION],
  );
  for (const row of rows) await ensureUserStore(pool, row.auth0_sub);
  return rows.length;
}
