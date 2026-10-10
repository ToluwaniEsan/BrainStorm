import { searchEvents } from "@/db/schema";
import { withUser } from "@/lib/db";
import { api, int, readBody, str } from "@/lib/http";
import { requireUser } from "@/lib/session";
import { exaSearch } from "@/server/exa";

// Assisted web search. Per the no-ghost policy the app calls this only when
// the user is stuck and asks for help; triggerText records what they said.
export const POST = api(async (req: Request) => {
  const user = await requireUser();
  const b = await readBody(req);
  const query = str(b, "query", { required: true, max: 500 })!;
  const triggerText = str(b, "triggerText", { required: true, max: 2000 })!;
  const numResults = Math.min(Math.max(int(b, "numResults") ?? 5, 1), 10);
  const results = await exaSearch(query, numResults);
  await withUser(user.sub, (tx) =>
    tx.insert(searchEvents).values({ query, triggerText, resultUrls: results.map((r) => r.url) }),
  );
  return { results };
});
