import { asc, eq } from "drizzle-orm";
import { transcripts } from "@/db/schema";
import { withUser } from "@/lib/db";
import { HttpError, api, bool, readBody, str, uuidParam } from "@/lib/http";
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
  // spokenAt (ISO time from the client) keeps segments in speech order even
  // when their requests arrive out of order; it defaults to arrival time.
  const at = str(b, "spokenAt", { max: 40 });
  const spokenAt = at ? new Date(at) : undefined;
  if (spokenAt && Number.isNaN(spokenAt.getTime())) throw new HttpError(400, "spokenAt must be an ISO date-time");
  const values = { sessionId, body: str(b, "body", { required: true })!, isFinal: bool(b, "isFinal"), spokenAt };
  const [row] = await withUser(user.sub, (tx) => tx.insert(transcripts).values(values).returning());
  if (row.isFinal) await indexQuietly(user.sub, { sourceType: "realtime", sourceTable: "transcripts", sourceId: row.id }, row.body);
  return Response.json(row, { status: 201 });
});
