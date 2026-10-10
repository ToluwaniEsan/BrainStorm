// Confirms DATABASE_URL (and DIRECT_DATABASE_URL, if set) in .env.local reach Supabase Postgres.
// Usage: npm run check:db
import postgres from "postgres";

const targets = [
  ["DATABASE_URL", process.env.DATABASE_URL],
  ["DIRECT_DATABASE_URL", process.env.DIRECT_DATABASE_URL],
];
if (!targets[0][1]) {
  console.error("Set DATABASE_URL in .env.local first (see .env.example).");
  process.exit(1);
}

let failed = false;
for (const [name, url] of targets) {
  if (!url) {
    console.warn(`${name} is not set, skipping (needed later for migrations).`);
    continue;
  }
  const sql = postgres(url, { prepare: false, max: 1, connect_timeout: 15 });
  try {
    const [{ version }] = await sql`select version()`;
    const [vector] = await sql`select name from pg_available_extensions where name = 'vector'`;
    console.log(`${name} works: ${version.split(",")[0]}. pgvector ${vector ? "available" : "NOT available"}.`);
  } catch (err) {
    failed = true;
    console.error(`${name} failed: ${err instanceof Error ? err.message : err}`);
  } finally {
    await sql.end();
  }
}
process.exit(failed ? 1 : 0);
