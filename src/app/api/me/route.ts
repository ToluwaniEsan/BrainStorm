import { profile } from "@/db/schema";
import { withUser } from "@/lib/db";
import { api } from "@/lib/http";
import { requireUser } from "@/lib/session";

// Signed-in user plus their profile. First call provisions their schema.
export const GET = api(async () => {
  const user = await requireUser();
  const [p] = await withUser(user.sub, (tx) => tx.select().from(profile).limit(1));
  return { user: { name: user.name, email: user.email, picture: user.picture }, profile: p ?? null };
});
