import { withUser } from "@/lib/db";
import { HttpError, api, optUuid, readBody, str } from "@/lib/http";
import { requireUser } from "@/lib/session";
import { indexText } from "@/server/memory";

// Indexes text the user supplied (chat, notes) into memory explicitly.
export const POST = api(async (req: Request) => {
  const user = await requireUser();
  const b = await readBody(req);
  const text = str(b, "text", { required: true, max: 100_000 })!;
  const sourceId = optUuid(b, "sourceId") ?? crypto.randomUUID();
  const src = {
    sourceType: str(b, "sourceType", { max: 40 }) ?? "chat",
    sourceTable: str(b, "sourceTable", { max: 60 }) ?? "chat",
    sourceId,
  };
  if (!src.sourceType || !src.sourceTable) throw new HttpError(400, "sourceType and sourceTable can't be empty");
  const chunks = await withUser(user.sub, (tx) => indexText(tx, src, text));
  return Response.json({ sourceId, chunks }, { status: 201 });
});
