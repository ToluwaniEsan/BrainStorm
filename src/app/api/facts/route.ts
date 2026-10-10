import { desc } from "drizzle-orm";
import { userFacts } from "@/db/schema";
import { withUser } from "@/lib/db";
import { api } from "@/lib/http";
import { requireUser } from "@/lib/session";

// Everything BrainStorm learned about the user, newest first.
export const GET = api(async () => {
  const user = await requireUser();
  return withUser(user.sub, (tx) => tx.select().from(userFacts).orderBy(desc(userFacts.createdAt)));
});
