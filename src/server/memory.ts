import "server-only";
import { and, cosineDistance, eq } from "drizzle-orm";
import { memoryChunks } from "@/db/schema";
import type { Tx } from "@/lib/db";
import { chunkText, embed } from "@/lib/embeddings";

export type MemorySource = { sourceType: string; sourceTable: string; sourceId: string };

// Replaces the memory chunks for one source row with fresh embeddings.
// Embeds before touching the database so a Gemini failure changes nothing.
export async function indexText(tx: Tx, src: MemorySource, text: string) {
  const chunks = chunkText(text);
  const vectors = await embed(chunks, "document");
  await tx
    .delete(memoryChunks)
    .where(and(eq(memoryChunks.sourceTable, src.sourceTable), eq(memoryChunks.sourceId, src.sourceId)));
  if (chunks.length === 0) return 0;
  await tx.insert(memoryChunks).values(chunks.map((body, i) => ({ ...src, body, embedding: vectors[i] })));
  return chunks.length;
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

// Indexing is a side effect of saving: if Gemini is down, the save still
// succeeds and the row is simply not searchable until it's edited again.
export async function indexQuietly(tx: Tx, src: MemorySource, text: string) {
  try {
    await indexText(tx, src, text);
  } catch (err) {
    console.error(`Memory indexing failed for ${src.sourceTable}`, err);
  }
}
