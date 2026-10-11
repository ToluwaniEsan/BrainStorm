import { desc } from "drizzle-orm";
import { files, links, profile } from "@/db/schema";
import { withUser } from "@/lib/db";
import { api } from "@/lib/http";
import { requireUser } from "@/lib/session";
import { liveInstruction, profilePrimer, type Material } from "@/server/persona";

// Caps on what goes into the Live instruction: enough of a resume or a
// portfolio page to quote specifics, without crowding out the conversation.
const PER_SOURCE = 6000;
const TOTAL = 16000;

// The Live system instruction for the signed-in user, built from what
// Clutter knows about them. The browser passes it to Gemini Live.
export const GET = api(async () => {
  const user = await requireUser();
  const [p, fs, ls] = await withUser(user.sub, (tx) =>
    Promise.all([
      tx.select().from(profile).limit(1).then((r) => r[0]),
      tx.select({ filename: files.filename, text: files.extractedText }).from(files).orderBy(desc(files.createdAt)).limit(10),
      tx.select().from(links).orderBy(desc(links.createdAt)).limit(10),
    ]),
  );

  const material: Material[] = [];
  let budget = TOTAL;
  const add = (label: string, text: string | null | undefined) => {
    const t = text?.trim();
    if (!t || budget <= 0) return;
    const clipped = t.slice(0, Math.min(PER_SOURCE, budget));
    budget -= clipped.length;
    material.push({ label, text: clipped.length < t.length ? `${clipped}…` : clipped });
  };
  add("Their intro (their words)", p?.intro);
  add("About their work (their words)", p?.aboutWork);
  add("Portfolio note (their words)", p?.portfolio);
  for (const f of fs) add(`Document they uploaded: ${f.filename}`, f.text);
  for (const l of ls) add(`Link they added (${l.kind}): ${l.title ? `${l.title}, ` : ""}${l.url}`, l.snapshot);

  return {
    instruction: liveInstruction(p?.understanding ?? null, p?.displayName ?? user.name, material),
    primer: profilePrimer(material),
    learningEnabled: p?.learningEnabled ?? true,
    sources: { documents: fs.filter((f) => f.text?.trim()).length, links: ls.filter((l) => l.snapshot?.trim()).length },
  };
});
