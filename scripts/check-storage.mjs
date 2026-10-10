// Confirms SUPABASE_URL, SUPABASE_SECRET_KEY and SUPABASE_STORAGE_BUCKET in .env.local work.
// Usage: npm run check:storage
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
const bucket = process.env.SUPABASE_STORAGE_BUCKET;
if (!url || !key || !bucket) {
  console.error("Set SUPABASE_URL, SUPABASE_SECRET_KEY and SUPABASE_STORAGE_BUCKET in .env.local first (see .env.example).");
  process.exit(1);
}

const headers = { apikey: key };
if (key.startsWith("eyJ")) headers.Authorization = `Bearer ${key}`;

try {
  const res = await fetch(`${url.replace(/\/$/, "")}/storage/v1/bucket`, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const buckets = await res.json();
  const found = buckets.find((b) => b.name === bucket);
  if (!found) {
    console.error(`Supabase key works, but there is no bucket named "${bucket}". Create it (private) in Storage.`);
    process.exit(1);
  }
  console.log(`Supabase Storage works. Bucket "${bucket}" exists and is ${found.public ? "PUBLIC (make it private)" : "private"}.`);
} catch (err) {
  console.error(`Supabase Storage call failed: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}
