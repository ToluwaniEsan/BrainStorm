import { after } from "next/server";
import { eq } from "drizzle-orm";
import { links } from "@/db/schema";
import { withUser } from "@/lib/db";
import { HttpError, api, notFound, uuidParam } from "@/lib/http";
import { requireUser } from "@/lib/session";
import { exaContents } from "@/server/exa";
import { readGithubRepo } from "@/server/github";
import { indexQuietly } from "@/server/memory";
import { refreshLater } from "@/server/understanding";

type Ctx = { params: Promise<{ id: string }> };

// Reads what's behind a user-added link (GitHub repos through the GitHub API,
// everything else through Exa), stores its text in memory so reflective
// questions can cite it, and refreshes what BrainStorm understands about them.
export const POST = api(async (_req: Request, { params }: Ctx) => {
  const user = await requireUser();
  const id = uuidParam((await params).id);
  const [link] = await withUser(user.sub, (tx) => tx.select().from(links).where(eq(links.id, id)));
  if (!link) notFound("Link not found");
  const page = (await readGithubRepo(link.url).catch(() => null)) ?? (await exaContents(link.url));
  if (!page?.text) throw new HttpError(422, "Couldn't read any text from that link");
  // The snapshot is saved on its own, so a Gemini outage doesn't lose the page.
  const [row] = await withUser(user.sub, (tx) =>
    tx
      .update(links)
      .set({ snapshot: page.text, title: link.title ?? page.title ?? null, fetchedAt: new Date() })
      .where(eq(links.id, id))
      .returning(),
  );
  if (!row) notFound("Link not found");
  const indexed = await indexQuietly(user.sub, { sourceType: "link", sourceTable: "links", sourceId: id }, page.text);
  after(() => refreshLater(user.sub));
  return { ...row, indexed };
});
