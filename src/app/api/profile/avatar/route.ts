import { HttpError, api } from "@/lib/http";
import { requireUser } from "@/lib/session";
import { deleteObjects, storageBucket, storageFetch } from "@/lib/supabase-storage";

// The user's profile photo, kept in their own Storage folder (so deleting the
// account removes it too). No database column: it exists or it doesn't.
const MAX_BYTES = 4 * 1024 * 1024;
const path = (schema: string) => `users/${schema}/avatar/photo`;
const objectUrl = (schema: string) => `object/${storageBucket()}/${path(schema)}`;

// Only plain raster images, checked by their first bytes, so nothing else
// can be served back from this address.
function imageType(b: Uint8Array): string | null {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return null;
}

export const GET = api(async () => {
  const user = await requireUser();
  const res = await storageFetch(objectUrl(user.schema));
  // Storage answers 400 or 404 for a missing object.
  if (res.status === 400 || res.status === 404) throw new HttpError(404, "No profile photo");
  if (!res.ok) throw new Error(`Supabase Storage download failed: HTTP ${res.status}`);
  const data = new Uint8Array(await res.arrayBuffer());
  const type = imageType(data);
  if (!type) throw new HttpError(404, "No profile photo");
  return new Response(data, {
    headers: { "content-type": type, "cache-control": "private, no-cache", "x-content-type-options": "nosniff" },
  });
});

// multipart/form-data with a "file" field: PNG, JPEG or WebP up to 4 MB.
// Replaces any earlier photo.
export const PUT = api(async (req: Request) => {
  const user = await requireUser();
  const form = await req.formData().catch(() => {
    throw new HttpError(400, "Send multipart/form-data with a file field");
  });
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "file is required");
  if (file.size === 0 || file.size > MAX_BYTES) throw new HttpError(413, "Photo must be under 4 MB");
  const data = await file.arrayBuffer();
  const type = imageType(new Uint8Array(data));
  if (!type) throw new HttpError(415, "Use a PNG, JPEG or WebP image");
  const res = await storageFetch(objectUrl(user.schema), {
    method: "POST",
    body: data,
    headers: { "content-type": type, "x-upsert": "true" },
  });
  if (!res.ok) throw new Error(`Supabase Storage upload failed: HTTP ${res.status} ${await res.text()}`);
  return { ok: true };
});

export const DELETE = api(async () => {
  const user = await requireUser();
  await deleteObjects([path(user.schema)]);
  return { ok: true };
});
