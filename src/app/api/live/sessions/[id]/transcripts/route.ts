import { asc, eq } from "drizzle-orm";
import { transcripts } from "@/db/schema";
import { withUser } from "@/lib/db";
import { api, bool, readBody, str, uuidParam } from "@/lib/http";
import { requireUser } from "@/lib/session";
import { indexQuietly } from "@/server/memory";

type Ctx = { params: Promise<{ id: string }> };

export const GET = api(async (_req: Request, { params }: Ctx) => {
  const user = await requireUser();
  const sessionId = uuidParam((await params).id);
  return withUser(user.sub, (tx) =>
    tx.select().from(transcripts).where(eq(transcripts.sessionId, sessionId)).orderBy(asc(transcripts.spokenAt)),
  );
});

// Live input transcription text. Only final segments go into memory.
export const POST = api(async (req: Request, { params }: Ctx) => {
  const user = await requireUser();
  const sessionId = uuidParam((await params).id);
  const b = await readBody(req);
  const values = { sessionId, body: str(b, "body", { required: true })!, isFinal: bool(b, "isFinal") };
  const row = await withUser(user.sub, async (tx) => {
    const [t] = await tx.insert(transcripts).values(values).returning();
    if (t.isFinal) await indexQuietly(tx, { sourceType: "realtime", sourceTable: "transcripts", sourceId: t.id }, t.body);
    return t;
  });
  return Response.json(row, { status: 201 });
});
