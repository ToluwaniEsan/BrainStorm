import "server-only";
import { and, cosineDistance, eq, sql } from "drizzle-orm";
import { memoryChunks } from "@/db/schema";
import { withUser, type Tx } from "@/lib/db";
import { chunkText, embed } from "@/lib/embeddings";

export type MemorySource = { sourceType: string; sourceTable: string; sourceId: string };

// Source tables whose rows own their chunks. Chunks for these are only
// written while the row still exists, so a delete racing an index can't
// leave orphans behind.
const OWNED = new Set(["profile", "files", "links", "reflections", "achievements", "transcripts", "track_items"]);

export function clearMemory(tx: Tx, src: Pick<MemorySource, "sourceTable" | "sourceId">) {
  return tx
    .delete(memoryChunks)
    .where(and(eq(memoryChunks.sourceTable, src.sourceTable), eq(memoryChunks.sourceId, src.sourceId)));
}

// Replaces the memory chunks for one source row with fresh embeddings. Call it
// after the row's own transaction commits: Gemini runs with no database
// connection held, and the chunks are written in a transaction of their own.
export async function indexText(sub: string, src: MemorySource, text: string) {
  const chunks = chunkText(text);
  const vectors = await embed(chunks, "document");
  return withUser(sub, async (tx) => {
    await clearMemory(tx, src);
    if (chunks.length === 0) return 0;
    if (OWNED.has(src.sourceTable)) {
      const rows = await tx.execute(sql`select 1 from ${sql.identifier(src.sourceTable)} where id = ${src.sourceId}`);
      if (rows.length === 0) return 0;
    }
    await tx.insert(memoryChunks).values(chunks.map((body, i) => ({ ...src, body, embedding: vectors[i] })));
    return chunks.length;
  });
}

export async function searchMemory(tx: Tx, query: string, limit = 8) {
  const [q] = await embed([query], "query");
  const distance = cosineDistance(memoryChunks.embedding, q);
  return tx
    .select({
      id: memoryChunks.id,
      body: memoryChunks.body,
      sourceType: memoryChunks.sourceType,
      sourceTable: memoryChunks.sourceTable,
      sourceId: memoryChunks.sourceId,
      distance,
    })
    .from(memoryChunks)
    .orderBy(distance)
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
