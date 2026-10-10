import { after } from "next/server";
import { eq } from "drizzle-orm";
import { files } from "@/db/schema";
import { withUser } from "@/lib/db";
import { api, notFound, uuidParam } from "@/lib/http";
import { requireUser } from "@/lib/session";
import { deleteObjects, getObject } from "@/lib/supabase-storage";
import { clearMemory } from "@/server/memory";
import { refreshLater } from "@/server/understanding";

type Ctx = { params: Promise<{ id: string }> };

// Downloads the original file (?meta=1 returns its record and extracted text).
export const GET = api(async (req: Request, { params }: Ctx) => {
  const user = await requireUser();
  const id = uuidParam((await params).id);
  const [f] = await withUser(user.sub, (tx) => tx.select().from(files).where(eq(files.id, id)));
  if (!f) notFound("File not found");
  if (new URL(req.url).searchParams.get("meta")) return f;
  const obj = await getObject(f.storagePath);
  return new Response(obj.body, {
    headers: {
      "content-type": f.mimeType,
      "content-disposition": `attachment; filename="${encodeURIComponent(f.filename)}"`,
      "cache-control": "private, no-store",
    },
  });
});

export const DELETE = api(async (_req: Request, { params }: Ctx) => {
  const user = await requireUser();
  const id = uuidParam((await params).id);
  const [f] = await withUser(user.sub, (tx) => tx.select().from(files).where(eq(files.id, id)));
  if (!f) notFound("File not found");
  // Object first: if that fails the row stays, so the delete can be retried.
  await deleteObjects([f.storagePath]);
  await withUser(user.sub, async (tx) => {
    await clearMemory(tx, { sourceTable: "files", sourceId: id });
    await tx.delete(files).where(eq(files.id, id));
  });
  after(() => refreshLater(user.sub));
  return { ok: true };
});
