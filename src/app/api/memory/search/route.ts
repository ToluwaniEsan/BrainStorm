import { withUser } from "@/lib/db";
import { HttpError, api } from "@/lib/http";
import { requireUser } from "@/lib/session";
import { searchMemory } from "@/server/memory";

// Word search over this user's own memory only (?q=...&limit=8).
export const GET = api(async (req: Request) => {
  const user = await requireUser();
  const params = new URL(req.url).searchParams;
  const q = params.get("q")?.trim();
  if (!q) throw new HttpError(400, "q is required");
  const limit = Math.min(Math.max(Number(params.get("limit")) || 8, 1), 50);
  return withUser(user.sub, (tx) => searchMemory(tx, q, limit));
});
