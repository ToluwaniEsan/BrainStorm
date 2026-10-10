import "server-only";
import { requireEnv } from "./env";

// Supabase Storage holds uploaded files only. We call its REST API from the
// server with the secret key, so there is no supabase-js and no browser access.

export const storageBucket = () => requireEnv("SUPABASE_STORAGE_BUCKET");

export function storageFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const key = requireEnv("SUPABASE_SECRET_KEY");
  const headers = new Headers(init.headers);
  headers.set("apikey", key);
  // Legacy service_role keys are JWTs and also need the Authorization header.
  if (key.startsWith("eyJ")) headers.set("Authorization", `Bearer ${key}`);
  return fetch(`${requireEnv("SUPABASE_URL")}/storage/v1/${path.replace(/^\//, "")}`, { ...init, headers });
}

async function ok(res: Response, what: string) {
  if (!res.ok) throw new Error(`Supabase Storage ${what} failed: HTTP ${res.status} ${await res.text()}`);
  return res;
}

const objectPath = (path: string) => `object/${storageBucket()}/${path.split("/").map(encodeURIComponent).join("/")}`;

export async function putObject(path: string, body: ArrayBuffer, contentType: string) {
  await ok(
    await storageFetch(objectPath(path), { method: "POST", body, headers: { "content-type": contentType, "x-upsert": "false" } }),
    "upload",
  );
}

export async function getObject(path: string): Promise<Response> {
  return ok(await storageFetch(objectPath(path)), "download");
}

export async function deleteObjects(paths: string[]) {
  if (paths.length === 0) return;
  await ok(
    await storageFetch(`object/${storageBucket()}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prefixes: paths }),
    }),
    "delete",
  );
}

// Every object path under a prefix (nested one level: users/<schema>/<fileId>/<name>).
export async function listPrefix(prefix: string): Promise<string[]> {
  const list = async (p: string) => {
    const res = await ok(
      await storageFetch(`object/list/${storageBucket()}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prefix: p, limit: 1000 }),
      }),
      "list",
    );
    return (await res.json()) as { name: string; id: string | null }[];
  };
  const out: string[] = [];
  for (const entry of await list(prefix)) {
    const full = `${prefix}/${entry.name}`;
    if (entry.id) out.push(full);
    else for (const child of await list(full)) if (child.id) out.push(`${full}/${child.name}`);
  }
  return out;
}
