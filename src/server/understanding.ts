import "server-only";
import { desc, eq } from "drizzle-orm";
import { achievements, files, links, profile, userFacts } from "@/db/schema";
import { lockForUser, withUser } from "@/lib/db";
import { outputText, respond, xaiModels } from "@/lib/xai";
import { indexQuietly } from "./memory";

// BrainStorm's picture of one user, built only from what they gave us (profile,
// links, files, achievements) and, when learning is on, what they said in
// conversations. Never from anything invented (no-ghost policy).

const clip = (s: string | null | undefined, n: number) => (s ? (s.length > n ? `${s.slice(0, n)}…` : s) : "");

async function profileRow(sub: string) {
  return withUser(sub, async (tx) => {
    await lockForUser(tx, "profile");
    const [p] = await tx.select().from(profile).limit(1);
    return p ?? (await tx.insert(profile).values({}).returning())[0];
  });
}

export async function learningEnabled(sub: string): Promise<boolean> {
  return (await profileRow(sub)).learningEnabled;
}

// Rebuilds profile.understanding from everything the user has given us.
export async function refreshUnderstanding(sub: string): Promise<string | null> {
  const p = await profileRow(sub);
  const [ls, fs, as, facts] = await withUser(sub, (tx) =>
    Promise.all([
      tx.select().from(links).orderBy(desc(links.createdAt)).limit(20),
      tx.select({ filename: files.filename, text: files.extractedText }).from(files).orderBy(desc(files.createdAt)).limit(10),
      tx.select().from(achievements).orderBy(desc(achievements.createdAt)).limit(20),
      tx.select().from(userFacts).orderBy(desc(userFacts.createdAt)).limit(80),
    ]),
  );
  const sources = [
    p.displayName && `Name: ${p.displayName}`,
    p.intro && `Intro (their words): ${clip(p.intro, 2000)}`,
    p.aboutWork && `About their work (their words): ${clip(p.aboutWork, 2000)}`,
    p.portfolio && `Portfolio note: ${clip(p.portfolio, 1000)}`,
    ...ls.map((l) => `Link [${l.kind}] ${l.title ?? ""} ${l.url}\n${clip(l.snapshot, 3000) || "(not read yet)"}`),
    ...fs.map((f) => `File ${f.filename}\n${clip(f.text, 3000) || "(no text)"}`),
    ...as.map((a) => `Achievement: ${a.title}${a.detail ? ` - ${clip(a.detail, 500)}` : ""}`),
    ...facts.map((f) => `Said in a ${f.sourceType}: ${f.fact}`),
  ].filter(Boolean);
  if (sources.length === 0) return null;

  const res = await respond({
    model: xaiModels.text,
    input: [
      {
        role: "system",
        content: `Summarise who this person is for an assistant that will talk with them. Use ONLY the material given.
Write short sections: "Who they are", "What they have actually done" (concrete work with the source, e.g. "repo X", "portfolio"),
"Skills shown by evidence", "What they say they want / are working on", "Gaps or open questions" (claims or goals with no evidence yet).
Never guess or add anything not in the material. Under 300 words. Plain text.`,
      },
      { role: "user", content: sources.join("\n\n---\n\n") },
    ],
  });
  const understanding = outputText(res) || null;
  await withUser(sub, (tx) =>
    tx.update(profile).set({ understanding, understandingUpdatedAt: new Date() }).where(eq(profile.id, p.id)),
  );
  return understanding;
}

// Pulls durable facts about the user out of what they said. Only when they
// left learning on. Returns the facts saved.
export async function learnFromConversation(sub: string, text: string): Promise<string[]> {
  if (!text.trim() || !(await learningEnabled(sub))) return [];
  const known = await withUser(sub, (tx) =>
    tx.select({ fact: userFacts.fact }).from(userFacts).orderBy(desc(userFacts.createdAt)).limit(80),
  );
  const res = await respond({
    model: xaiModels.fast,
    input: [
      {
        role: "system",
        content: `Extract lasting facts about the speaker from what they said: their goals, projects, skills they say they have,
experience, preferences, constraints, people or tools they work with. Only what they clearly said about themselves, in short
third-person sentences ("Wants to launch a podcast by spring"). No guesses, no opinions, nothing already known, no passing moods.
Return an empty list if there is nothing lasting.`,
      },
      {
        role: "user",
        content: `Already known:\n${known.map((k) => `- ${k.fact}`).join("\n") || "(nothing)"}\n\nWhat they just said:\n"""${text.slice(0, 12000)}"""`,
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "facts",
        strict: true,
        schema: {
          type: "object",
          properties: { facts: { type: "array", items: { type: "string" } } },
          required: ["facts"],
          additionalProperties: false,
        },
      },
    },
  });
  let facts: string[] = [];
  try {
    facts = (JSON.parse(outputText(res) || "{}").facts ?? []).filter((f: unknown) => typeof f === "string" && f.trim()).slice(0, 20);
  } catch {
    return [];
  }
  if (facts.length === 0) return [];
  const rows = await withUser(sub, (tx) =>
    tx.insert(userFacts).values(facts.map((fact) => ({ fact: fact.trim().slice(0, 500), sourceType: "conversation" }))).returning(),
  );
  await Promise.all(
    rows.map((r) => indexQuietly(sub, { sourceType: "learned", sourceTable: "user_facts", sourceId: r.id }, r.fact)),
  );
  await refreshUnderstanding(sub);
  return facts;
}

// Logged, never thrown: runs after the response is sent.
export function refreshLater(sub: string) {
  return refreshUnderstanding(sub).catch((err) => console.error("Refreshing understanding failed", err));
}
