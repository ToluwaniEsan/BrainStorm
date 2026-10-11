import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { memoryChunks } from "@/db/schema";
import { withUser, type Tx } from "@/lib/db";

export type MemorySource = { sourceType: string; sourceTable: string; sourceId: string };

// Source tables whose rows own their chunks. Chunks for these are only
// written while the row still exists, so a delete racing an index can't
// leave orphans behind.
const OWNED = new Set(["profile", "user_facts", "files", "links", "reflections", "achievements", "transcripts", "track_items"]);

export function clearMemory(tx: Tx, src: Pick<MemorySource, "sourceTable" | "sourceId">) {
  return tx
    .delete(memoryChunks)
    .where(and(eq(memoryChunks.sourceTable, src.sourceTable), eq(memoryChunks.sourceId, src.sourceId)));
}

// Splits text into roughly paragraph-sized chunks for search.
export function chunkText(text: string, max = 1500): string[] {
  const parts = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let cur = "";
  for (const p of parts) {
    for (let i = 0; i < p.length; i += max) {
      const piece = p.slice(i, i + max);
      if (cur && cur.length + piece.length + 2 > max) {
        chunks.push(cur);
        cur = "";
      }
      cur = cur ? `${cur}\n\n${piece}` : piece;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

// Replaces the memory chunks for one source row. Call it after the row's own
// transaction commits; the chunks are written in a transaction of their own.
// xAI has no embeddings API, so chunks are found by Postgres full-text search
// and the embedding column stays empty.
export async function indexText(sub: string, src: MemorySource, text: string) {
  const chunks = chunkText(text);
  return withUser(sub, async (tx) => {
    await clearMemory(tx, src);
    if (chunks.length === 0) return 0;
    if (OWNED.has(src.sourceTable)) {
      const rows = await tx.execute(sql`select 1 from ${sql.identifier(src.sourceTable)} where id = ${src.sourceId}`);
      if (rows.length === 0) return 0;
    }
    await tx.insert(memoryChunks).values(chunks.map((body) => ({ ...src, body })));
    return chunks.length;
  });
}

// Full-text search: a chunk matches if it shares any meaningful word with the
// query (stemmed, so "projects" finds "project"), best matches first.
export async function searchMemory(tx: Tx, query: string, limit = 8) {
  const words = [...new Set(query.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [])].slice(0, 30);
  if (words.length === 0) return [];
  const q = sql`to_tsquery('english', ${words.join(" | ")})`;
  const doc = sql`to_tsvector('english', ${memoryChunks.body})`;
  const rank = sql<number>`ts_rank(${doc}, ${q})`;
  return tx
    .select({
      id: memoryChunks.id,
      body: memoryChunks.body,
      sourceType: memoryChunks.sourceType,
      sourceTable: memoryChunks.sourceTable,
      sourceId: memoryChunks.sourceId,
      rank,
    })
    .from(memoryChunks)
    .where(sql`${doc} @@ ${q}`)
    .orderBy(desc(rank))
    .limit(limit);
}

// Indexing is a side effect of saving: if it fails, the save still stands.
// The row's old chunks are dropped so search never returns outdated text;
// it becomes searchable again on its next edit. Returns whether it indexed.
export async function indexQuietly(sub: string, src: MemorySource, text: string): Promise<boolean> {
  try {
    await indexText(sub, src, text);
    return true;
  } catch (err) {
    console.error(`Memory indexing failed for ${src.sourceTable}`, err);
    await withUser(sub, (tx) => clearMemory(tx, src)).catch((e) => console.error("Clearing stale memory failed", e));
    return false;
  }
}
