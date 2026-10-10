import { after } from "next/server";
import { desc } from "drizzle-orm";
import { files } from "@/db/schema";
import { withUser } from "@/lib/db";
import { HttpError, api } from "@/lib/http";
import { requireUser } from "@/lib/session";
import { deleteObjects, putObject } from "@/lib/supabase-storage";
import { extractText } from "@/server/extract";
import { indexQuietly } from "@/server/memory";
import { refreshLater } from "@/server/understanding";

const MAX_BYTES = 10 * 1024 * 1024;

export const GET = api(async () => {
  const user = await requireUser();
  return withUser(user.sub, (tx) =>
    tx
      .select({
        id: files.id, filename: files.filename, mimeType: files.mimeType, sizeBytes: files.sizeBytes,
        summary: files.summary, createdAt: files.createdAt,
      })
      .from(files)
      .orderBy(desc(files.createdAt)),
  );
});

// multipart/form-data with a "file" field. Stores the original in the private
// bucket under the user's own prefix, then extracts text into memory.
export const POST = api(async (req: Request) => {
  const user = await requireUser();
  const form = await req.formData().catch(() => {
    throw new HttpError(400, "Send multipart/form-data with a file field");
  });
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "file is required");
  if (file.size === 0 || file.size > MAX_BYTES) throw new HttpError(413, "File must be between 1 byte and 10 MB");

  const id = crypto.randomUUID();
  const filename = file.name.replace(/[^\w.\- ]+/g, "_").slice(0, 200) || "upload";
  const mimeType = file.type || "application/octet-stream";
  const storagePath = `users/${user.schema}/${id}/${filename}`;
  const data = await file.arrayBuffer();
  await putObject(storagePath, data, mimeType);

  let extracted: string | null = null;
  try {
    extracted = await extractText(data, mimeType);
  } catch (err) {
    console.error("Text extraction failed", err);
  }

  let row;
  try {
    [row] = await withUser(user.sub, (tx) =>
      tx.insert(files).values({ id, filename, mimeType, sizeBytes: file.size, storagePath, extractedText: extracted }).returning(),
    );
  } catch (err) {
    // No row means no way to find the object later, so remove it now.
    await deleteObjects([storagePath]).catch((e) => console.error("Cleaning up upload failed", e));
    throw err;
  }
  if (extracted) {
    await indexQuietly(user.sub, { sourceType: "file", sourceTable: "files", sourceId: id }, extracted);
    after(() => refreshLater(user.sub));
  }
  return Response.json({ ...row, extractedText: undefined, hasText: Boolean(extracted) }, { status: 201 });
});

