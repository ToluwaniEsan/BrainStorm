import type { Pool, PoolClient } from "pg";
import { assertUserRole, assertUserSchema, ident } from "./identifiers";
import type { UserContext } from "./provision";

export type UserDb = Pick<PoolClient, "query">;

/**
 * Runs `fn` in a transaction that has switched to the user's own Postgres
 * role, with `search_path` pinned to their schema and `app.user_id` set for
 * RLS. Settings are LOCAL, so pooled connections never leak identity.
 */
export async function withUserDb<T>(
  pool: Pool,
  ctx: UserContext,
  fn: (db: UserDb) => Promise<T>,
): Promise<T> {
  const schema = assertUserSchema(ctx.schema);
  const role = assertUserRole(ctx.role);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL ROLE ${ident(role)}`);
    await client.query(
      "SELECT set_config('search_path', $1, true), set_config('app.user_id', $2, true)",
      [`${ident(schema)}, public`, ctx.userId],
    );
    const result = await fn({ query: client.query.bind(client) as PoolClient["query"] });
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    await releaseClean(client);
  }
}

/**
 * A non-LOCAL `SET` that committed would otherwise survive on the pooled
 * connection, so reset all session state; destroy the connection if that fails.
 */
async function releaseClean(client: PoolClient): Promise<void> {
  try {
    await client.query("DISCARD ALL");
    client.release();
  } catch (err) {
    client.release(err instanceof Error ? err : true);
  }
}
