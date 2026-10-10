import { desc } from "drizzle-orm";
import { links } from "@/db/schema";
import { withUser } from "@/lib/db";
import { HttpError, api, readBody, str } from "@/lib/http";
import { requireUser } from "@/lib/session";

export const GET = api(async () => {
  const user = await requireUser();
  return withUser(user.sub, (tx) => tx.select().from(links).orderBy(desc(links.createdAt)));
});

// A link the user added (portfolio, repo, article). Fetch its text with
// POST /api/links/:id/fetch.
export const POST = api(async (req: Request) => {
  const user = await requireUser();
  const b = await readBody(req);
  const url = str(b, "url", { required: true, max: 2000 })!;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new HttpError(400, "url must be a valid URL");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) throw new HttpError(400, "url must be http or https");
  const kind = str(b, "kind", { max: 40 }) ?? (parsed.hostname === "github.com" ? "github" : "web");
  const [row] = await withUser(user.sub, (tx) =>
    tx.insert(links).values({ url: parsed.toString(), kind, title: str(b, "title", { max: 300 }) }).returning(),
  );
  return Response.json(row, { status: 201 });
});
