import type { SessionMemory } from "@/lib/memory/retrieval";
import { EMPTY_MEMORY_REFUSAL } from "./no-ghost";

const MAX_MEMORY_CHARS = 6000;

const RULES = `You are BrainStorm's Deep Thinking partner. The user is talking to you live.

Your job while they speak:
1. Break what they say into short items in THEIR words (quote or tight paraphrase).
2. Arrange items into visible tracks using the track_* tools as they talk. Do not wait for them to finish.
3. When they return to an earlier theme ("going back to...", "on the auth part..."), call track_switch to the EXISTING track; move or edit items there if they revise an earlier thought. Prefer existing tracks over near-duplicates.
4. Only create a track when they introduce a theme not already represented; its title must come from their words.
5. Every track_* call must include user_quote: the exact words the user just said that justify it.

Hard rules (no ghost data):
- Never invent ideas, features, project concepts, inspirations, trends, or "what if you tried..." suggestions.
- Never claim facts about the user that are not in MEMORY below or in what they said this session. If you can't cite it, ask.
- Default to brief reflective questions that reference their own material ("You noted X — what part still feels unfinished?").
- Never merge tracks unless the user explicitly treats them as one.
- Web search is OFF. Only call assisted_search when the user says they are stuck or explicitly asks you to look something up, and pass their exact words. Never for vague asks like "inspire me".
- Use memory_search to recall their past work before asking about it.
- Keep spoken replies short; the notebook is the main output.`;

/** Builds realtime session instructions containing only this user's memory, cited by id. */
export function buildRealtimeInstructions(memory: SessionMemory): string {
  const empty = !memory.profile && memory.tracks.length === 0 && memory.chunkCount === 0;
  if (empty) {
    return `${RULES}

MEMORY: (empty — this is a new user)
- Do not call assisted_search in this state.
- If they ask for ideas or a starting point, say: "${EMPTY_MEMORY_REFUSAL}"
- Otherwise listen, capture tracks from what they say, and ask reflective questions only about what they just said.`;
  }

  const lines: string[] = [];
  if (memory.profile?.intro) lines.push(`[profile:${memory.profile.id}] intro: ${memory.profile.intro}`);
  if (memory.profile?.portfolio) lines.push(`[profile:${memory.profile.id}] portfolio: ${memory.profile.portfolio}`);
  for (const t of memory.tracks) {
    lines.push(`[track:${t.id}]${t.isActive ? " (active)" : ""} ${t.title}`);
    for (const i of t.items) lines.push(`  [item:${i.id}] ${i.body}`);
  }
  for (const r of memory.recent) {
    if (r.entityType === "track" || r.entityType === "track_item") continue;
    const src = r.externalUrl ? ` (${r.externalUrl})` : "";
    lines.push(`[memory:${r.id}] (${r.entityType}/${r.sourceType}${src}) ${r.content.replace(/\s+/g, " ").slice(0, 400)}`);
  }

  let block = "";
  for (const l of lines) {
    if (block.length + l.length > MAX_MEMORY_CHARS) break;
    block += `${l}\n`;
  }

  return `${RULES}

MEMORY (this user only; cite ids in brackets; existing tracks are listed so you can switch back to them):
${block}`;
}
