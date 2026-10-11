import { connection, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { storageBucket, storageFetch } from "@/lib/supabase-storage";
import { xaiFetch, xaiModels } from "@/lib/xai";

// Public wiring check: says which services are configured and reachable,
// never any values. Exa is only checked for a key, since each call costs credits.
// Missing variable names are reported (names aren't secret, values never leave).
type Check = { configured: boolean; missing?: string[]; ok?: boolean; error?: string };

function env(...names: string[]): Check {
  const missing = names.filter((n) => !process.env[n]);
  return missing.length ? { configured: false, missing } : { configured: true };
}

async function probe(check: Check, fn: () => Promise<unknown>): Promise<Check> {
  if (!check.configured) return check;
  try {
    await fn();
    return { configured: true, ok: true };
  } catch (err) {
    // Error text can echo hostnames, so only the class of failure and its HTTP status go out.
    const status = (err as { status?: unknown })?.status;
    const name = err instanceof Error ? err.name : "Error";
    return { configured: true, ok: false, error: typeof status === "number" ? `${name} ${status}` : name };
  }
}

export async function GET() {
  await connection();
  const [database, storage, xai] = await Promise.all([
    probe(env("DATABASE_URL"), async () => {
      const [row] = await getSql()`select current_user as role, to_regprocedure('app.upgrade_user(text)') is not null as ready`;
      if (row.role !== "brainstorm_app") throw new Error("wrong role");
      if (!row.ready) throw new Error("not migrated");
    }),
    probe(env("SUPABASE_URL", "SUPABASE_SECRET_KEY", "SUPABASE_STORAGE_BUCKET"), async () => {
      const res = await storageFetch(`bucket/${storageBucket()}`);
      if (!res.ok) throw Object.assign(new Error("Storage check failed"), { status: res.status });
    }),
    probe(env("XAI_API_KEY", "XAI_VOICE_MODEL", "XAI_FAST_MODEL", "XAI_TEXT_MODEL"), async () => {
      await xaiFetch(`/models/${encodeURIComponent(xaiModels.fast)}`);
    }),
  ]);
  const checks = {
    auth0: env("AUTH0_DOMAIN", "AUTH0_CLIENT_ID", "AUTH0_CLIENT_SECRET", "AUTH0_SECRET"),
    database,
    storage,
    xai,
    exa: env("EXA_API_KEY"),
  };
  const healthy = Object.values(checks).every((c: Check) => c.configured && c.ok !== false);
  return NextResponse.json({ healthy, checks }, { status: healthy ? 200 : 503, headers: { "cache-control": "no-store" } });
}
