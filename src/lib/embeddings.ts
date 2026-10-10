import "server-only";
import { geminiModels, getGemini } from "./gemini";

// Must match the vector(768) column in memory_chunks.
export const EMBED_DIM = 768;

function normalize(v: number[]): number[] {
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n);
}

// gemini-embedding-001 only pre-normalizes its full 3072-dim output, so
// truncated 768-dim vectors are normalized here before cosine search.
// Sent in batches, since one embedding request takes at most 100 inputs.
const BATCH = 100;

export async function embed(texts: string[], kind: "document" | "query"): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH);
    const res = await getGemini().models.embedContent({
      model: geminiModels.embed,
      contents: batch,
      config: {
        outputDimensionality: EMBED_DIM,
        taskType: kind === "query" ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT",
      },
    });
    const vectors = res.embeddings?.map((e) => e.values ?? []) ?? [];
    if (vectors.length !== batch.length || vectors.some((v) => v.length !== EMBED_DIM)) {
      throw new Error("Unexpected embedding response");
    }
    out.push(...vectors.map(normalize));
  }
  return out;
}

// Splits text into roughly paragraph-sized chunks for embedding.
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
