import type { UserContext } from "@/lib/db/provision";
import type { UserDb } from "@/lib/db/user-db";
import type { Embedder } from "@/lib/memory/embeddings";
import { retrieveMemory, type MemoryHit } from "@/lib/memory/retrieval";
import {
  buildConditionedQuery,
  filterByVicinity,
  gateAssistedSearch,
  type VicinityResult,
} from "@/lib/policy/no-ghost";
import type { SearchProvider } from "./providers";

export type AssistedSearchOutcome =
  | { status: "not_triggered"; message: string }
  | { status: "blocked_thin_memory"; message: string }
  | { status: "unavailable"; message: string }
  | {
      status: "ok";
      eventId: string;
      framing: string;
      query: string;
      memoryCitations: Array<{ id: string; entityType: string; excerpt: string; externalUrl: string | null }>;
      results: VicinityResult[];
    };

/**
 * §5.4 grounded assisted search. The provider is never called unless the
 * user's own words carry a stuck/explicit-help signal AND related memory exists.
 */
export async function runAssistedSearch(input: {
  db: UserDb;
  ctx: UserContext;
  embedder: Embedder;
  provider: SearchProvider | null;
  sessionId: string | null;
  userQuote: string;
  topic: string;
}): Promise<AssistedSearchOutcome> {
  const { db, ctx } = input;
  const pre = gateAssistedSearch({ utterance: input.userQuote, memory: [] });
  if (!pre.allowed && pre.reason === "no_help_signal") {
    return {
      status: "not_triggered",
      message: "Web search stays off unless you say you're stuck or ask me to look something up.",
    };
  }

  const memory: MemoryHit[] = await retrieveMemory(db, ctx, input.embedder, `${input.topic}\n${input.userQuote}`, {
    k: 6,
    minScore: 0.15,
  });
  const gate = gateAssistedSearch({ utterance: input.userQuote, memory });
  if (!gate.allowed) {
    return { status: "blocked_thin_memory", message: gate.message ?? "Not enough past work to search from." };
  }
  if (!input.provider) {
    return { status: "unavailable", message: "Assisted search is not configured (SEARCH_API_KEY missing)." };
  }

  const conditioned = buildConditionedQuery(input.topic, gate.memory);
  const raw = await input.provider.search(conditioned.query, { maxResults: 10 });
  const results = filterByVicinity(raw, gate.memory, { max: 5 });

  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO assisted_search_events
       (user_id, session_id, trigger_utterance, signal_kind, query, memory_ids, result_urls, results, provider)
     VALUES ($1, $2, $3, $4, $5, $6::uuid[], $7::text[], $8, $9) RETURNING id`,
    [
      ctx.userId,
      input.sessionId,
      input.userQuote,
      gate.signal.kind,
      conditioned.query,
      conditioned.memoryIds,
      results.map((r) => r.url),
      JSON.stringify(results),
      input.provider.name,
    ],
  );

  return {
    status: "ok",
    eventId: rows[0].id,
    framing: `You said you're stuck on ${input.topic}. I looked for material near your past work—not random ideas.`,
    query: conditioned.query,
    memoryCitations: gate.memory.map((m) => ({
      id: m.id,
      entityType: m.entityType,
      excerpt: m.content.slice(0, 200),
      externalUrl: m.externalUrl,
    })),
    results,
  };
}
