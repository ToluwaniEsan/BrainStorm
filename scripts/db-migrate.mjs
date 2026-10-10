// Applies db/migrations/*.sql in order, once each, over DIRECT_DATABASE_URL.
// Usage: npm run db:migrate
import { readdir, readFile } from "node:fs/promises";
import postgres from "postgres";

const url = process.env.DIRECT_DATABASE_URL;
if (!url) {
  console.error("Set DIRECT_DATABASE_URL in .env.local first (see .env.example).");
  process.exit(1);
}

const dir = new URL("../db/migrations/", import.meta.url);
const sql = postgres(url, { max: 1, onnotice: () => {} });
try {
  await sql`create table if not exists public.brainstorm_migrations (name text primary key, applied_at timestamptz not null default now())`;
  await sql`revoke all on public.brainstorm_migrations from public, anon, authenticated`.catch(() => {});
  const done = new Set((await sql`select name from public.brainstorm_migrations`).map((r) => r.name));
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    if (done.has(file)) continue;
    const body = await readFile(new URL(file, dir), "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`insert into public.brainstorm_migrations (name) values (${file})`;
    });
    console.log(`Applied ${file}`);
  }
  console.log("Database is up to date.");
} catch (err) {
  console.error(`Migration failed: ${err instanceof Error ? err.message : err}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
