import { migrateApp } from "../lib/db/app-migrations";
import { closePool, getPool } from "../lib/db/pool";
import { migrateAllUserSchemas } from "../lib/db/provision";

async function main() {
  const pool = getPool();
  await migrateApp(pool);
  const n = await migrateAllUserSchemas(pool);
  console.log(`app schema up to date; migrated ${n} user schema(s)`);
  await closePool();
}

main().catch(async (err) => {
  console.error(err);
  await closePool();
  process.exit(1);
});
