import { eq } from "drizzle-orm";
import { liveSessions } from "@/db/schema";
import { withUser } from "@/lib/db";
import { api, notFound, uuidParam } from "@/lib/http";
import { requireUser } from "@/lib/session";

type Ctx = { params: Promise<{ id: string }> };

// Ends the session.
export const PATCH = api(async (_req: Request, { params }: Ctx) => {
  const user = await requireUser();
  const id = uuidParam((await params).id);
  const [row] = await withUser(user.sub, (tx) =>
    tx.update(liveSessions).set({ endedAt: new Date() }).where(eq(liveSessions.id, id)).returning(),
  );
  return row ?? notFound("Session not found");
});
