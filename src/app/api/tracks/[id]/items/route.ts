import { trackItems } from "@/db/schema";
import { withUser } from "@/lib/db";
import { api, int, optUuid, readBody, str, uuidParam } from "@/lib/http";
import { requireUser } from "@/lib/session";
import { indexQuietly } from "@/server/memory";

type Ctx = { params: Promise<{ id: string }> };

// track.append: a thought the user just said, added to this track.
export const POST = api(async (req: Request, { params }: Ctx) => {
  const user = await requireUser();
  const trackId = uuidParam((await params).id);
  const b = await readBody(req);
  const values = {
    trackId,
    body: str(b, "body", { required: true })!,
    sessionId: optUuid(b, "sessionId"),
    sortOrder: int(b, "sortOrder"),
    confidence: str(b, "confidence", { max: 40 }) ?? undefined,
  };
  const row = await withUser(user.sub, async (tx) => {
    const [item] = await tx.insert(trackItems).values(values).returning();
    await indexQuietly(tx, { sourceType: "realtime", sourceTable: "track_items", sourceId: item.id }, item.body);
    return item;
  });
  return Response.json(row, { status: 201 });
});
