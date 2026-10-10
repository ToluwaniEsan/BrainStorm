import { eq } from "drizzle-orm";
import { links } from "@/db/schema";
import { withUser } from "@/lib/db";
import { HttpError, api, notFound, uuidParam } from "@/lib/http";
import { requireUser } from "@/lib/session";
import { exaContents } from "@/server/exa";
import { indexText } from "@/server/memory";

type Ctx = { params: Promise<{ id: string }> };

// Reads the page behind a user-added link through Exa and stores its text in
// memory, so reflective questions can cite it.
export const POST = api(async (_req: Request, { params }: Ctx) => {
  const user = await requireUser();
  const id = uuidParam((await params).id);
  const [link] = await withUser(user.sub, (tx) => tx.select().from(links).where(eq(links.id, id)));
  if (!link) notFound("Link not found");
  const page = await exaContents(link.url);
  if (!page?.text) throw new HttpError(422, "Couldn't read any text from that link");
  return withUser(user.sub, async (tx) => {
    const [row] = await tx
      .update(links)
      .set({ snapshot: page.text, title: link.title ?? page.title ?? null, fetchedAt: new Date() })
      .where(eq(links.id, id))
      .returning();
    const chunks = await indexText(tx, { sourceType: "link", sourceTable: "links", sourceId: id }, page.text!);
    return { ...row, chunks };
  });
});
