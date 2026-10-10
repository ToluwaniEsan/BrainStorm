import { profile } from "@/db/schema";
import { lockForUser, withUser } from "@/lib/db";
import { api, defined, readBody, str } from "@/lib/http";
import { requireUser } from "@/lib/session";
import { indexQuietly } from "@/server/memory";

export const GET = api(async () => {
  const user = await requireUser();
  const [p] = await withUser(user.sub, (tx) => tx.select().from(profile).limit(1));
  return p ?? null;
});

// Creates or updates the single profile row, then re-indexes it into memory.
export const PUT = api(async (req: Request) => {
  const user = await requireUser();
  const b = await readBody(req);
  const fields = defined({
    displayName: str(b, "displayName", { max: 200 }),
    intro: str(b, "intro"),
    portfolio: str(b, "portfolio"),
    aboutWork: str(b, "aboutWork"),
  });
  const row = await withUser(user.sub, async (tx) => {
    // The lock keeps two first saves from both inserting a profile row.
    await lockForUser(tx, "profile");
    const [existing] = await tx.select({ id: profile.id }).from(profile).limit(1);
    const [saved] = existing
      ? await tx.update(profile).set({ ...fields, updatedAt: new Date() }).returning()
      : await tx.insert(profile).values(fields).returning();
    return saved;
  });
  const text = [row.displayName, row.intro, row.portfolio, row.aboutWork].filter(Boolean).join("\n\n");
  await indexQuietly(user.sub, { sourceType: "ui", sourceTable: "profile", sourceId: row.id }, text);
  return row;
});
