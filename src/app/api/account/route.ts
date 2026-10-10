import { getSql } from "@/lib/db";
import { api } from "@/lib/http";
import { forgetUser, requireUser } from "@/lib/session";
import { deleteObjects, listPrefix } from "@/lib/supabase-storage";

// Deletes everything we hold for this user: their files in Storage, then their
// whole schema and registry row. The client then sends them to /auth/logout.
export const DELETE = api(async () => {
  const user = await requireUser();
  await deleteObjects(await listPrefix(`users/${user.schema}`));
  await getSql()`select app.delete_user(${user.sub})`;
  forgetUser(user.sub);
  return { ok: true, next: "/auth/logout" };
});
