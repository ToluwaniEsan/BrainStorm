import "server-only";
import { exaFetch } from "@/lib/exa";

export type ExaResult = { title: string | null; url: string; text?: string; publishedDate?: string };

async function call(path: "search" | "contents", body: unknown) {
  const res = await exaFetch(path, body);
  if (!res.ok) throw new Error(`Exa ${path} failed: HTTP ${res.status}`);
  return (await res.json()) as { results?: ExaResult[] };
}

export async function exaSearch(query: string, numResults: number) {
  const { results = [] } = await call("search", {
    query,
    numResults,
    contents: { text: { maxCharacters: 1500 } },
  });
  return results.map(({ title, url, text, publishedDate }) => ({ title, url, text, publishedDate }));
}

export async function exaContents(url: string) {
  const { results = [] } = await call("contents", { urls: [url], text: { maxCharacters: 50_000 } });
  return results[0];
}
