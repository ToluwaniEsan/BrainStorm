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
