import { EMBEDDING_DIMENSIONS } from "@/lib/db/user-migrations";
import { contentTokens } from "@/lib/policy/text";

export interface Embedder {
  readonly name: string;
  embed(texts: string[]): Promise<number[][]>;
}

export class OpenAIEmbedder implements Embedder {
  readonly name: string;
  constructor(
    private readonly apiKey: string,
    private readonly model = process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small",
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.name = `openai:${model}`;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const res = await this.fetchImpl("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.model, input: texts, dimensions: EMBEDDING_DIMENSIONS }),
    });
    if (!res.ok) throw new Error(`embedding request failed: ${res.status}`);
    const json = (await res.json()) as { data: Array<{ embedding: number[]; index: number }> };
    return json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
  }
}

/**
 * Deterministic lexical embedder (feature hashing over content tokens).
 * Used in tests and as an explicit dev fallback when no OpenAI key is set.
 */
export class HashEmbedder implements Embedder {
  readonly name = "hash-lexical";

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => hashEmbed(t));
  }
}

function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function hashEmbed(text: string): number[] {
  const v = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  for (const tok of contentTokens(text)) {
    const h = fnv1a(tok);
    v[h % EMBEDDING_DIMENSIONS] += (h & 0x80000000) === 0 ? 1 : -1;
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  if (norm === 0) {
    v[0] = 1;
    return v;
  }
  return v.map((x) => x / norm);
}

export function getEmbedder(): Embedder {
  const key = process.env.OPENAI_API_KEY;
  return key ? new OpenAIEmbedder(key) : new HashEmbedder();
}

export function toVectorLiteral(v: number[]): string {
  return `[${v.join(",")}]`;
}
