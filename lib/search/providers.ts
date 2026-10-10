import type { RawSearchResult } from "@/lib/policy/no-ghost";

export interface SearchProvider {
  readonly name: string;
  search(query: string, opts: { maxResults: number }): Promise<RawSearchResult[]>;
}

export class TavilySearchProvider implements SearchProvider {
  readonly name = "tavily";
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async search(query: string, opts: { maxResults: number }): Promise<RawSearchResult[]> {
    const res = await this.fetchImpl("https://api.tavily.com/search", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, max_results: opts.maxResults, search_depth: "basic", include_answer: false }),
    });
    if (!res.ok) throw new Error(`search provider error: ${res.status}`);
    const json = (await res.json()) as { results?: Array<{ title?: string; url?: string; content?: string }> };
    return (json.results ?? [])
      .filter((r) => typeof r.url === "string")
      .map((r) => ({ title: r.title ?? "", url: r.url as string, snippet: r.content ?? "" }));
  }
}

/** Null when no key is configured: the tool then reports "unavailable" instead of fabricating results. */
export function getSearchProvider(): SearchProvider | null {
  const key = process.env.SEARCH_API_KEY;
  if (!key) return null;
  const provider = (process.env.SEARCH_PROVIDER || "tavily").toLowerCase();
  if (provider === "tavily") return new TavilySearchProvider(key);
  console.warn(`[search] unsupported SEARCH_PROVIDER "${provider}"; assisted search disabled`);
  return null;
}
