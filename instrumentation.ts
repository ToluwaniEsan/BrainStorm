export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !process.env.DATABASE_URL) return;
  const { getPool } = await import("./lib/db/pool");
  const { migrateApp } = await import("./lib/db/app-migrations");
  await migrateApp(getPool());
}
