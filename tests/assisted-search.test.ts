import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { UserContext } from "@/lib/db/provision";
import { withUserDb } from "@/lib/db/user-db";
import type { RawSearchResult } from "@/lib/policy/no-ghost";
import { handleToolCall } from "@/lib/realtime/tool-handler";
import { runAssistedSearch } from "@/lib/search/assisted";
import type { SearchProvider } from "@/lib/search/providers";
import { embedder, newUser, pool, remember, say, setupDb, startSession, teardownDb } from "./helpers";

const RESULTS: RawSearchResult[] = [
  {
    title: "Audio-reactive WebGL shaders in p5.js",
    url: "https://example.org/p5-webgl-audio-shaders",
    snippet: "Use FFT audio analysis to drive fragment shaders in a p5.js visualizer.",
  },
  { title: "Top 10 creative coding ideas", url: "https://example.org/top-10", snippet: "Trending ideas for p5.js visualizer projects" },
  { title: "Best sourdough recipes", url: "https://example.org/bread", snippet: "Flour water salt yeast." },
];

function fakeProvider() {
  const search = vi.fn(async () => RESULTS);
  const provider: SearchProvider = { name: "fake", search };
  return { provider, search };
}

function run(ctx: UserContext, provider: SearchProvider | null, userQuote: string, topic: string) {
  return withUserDb(pool(), ctx, (db) =>
    runAssistedSearch({ db, ctx, embedder, provider, sessionId: null, userQuote, topic }),
  );
}

beforeAll(setupDb);
afterAll(teardownDb);

describe("grounded assisted search gate", () => {
  let rich: UserContext;
  let empty: UserContext;

  beforeAll(async () => {
    rich = await newUser("search-rich");
    empty = await newUser("search-empty");
    await remember(rich, "I'm building a p5.js audio visualizer that uses WebGL fragment shaders driven by FFT audio analysis.");
  });

  it("does not search without a stuck / explicit-help signal, even with rich memory", async () => {
    const { provider, search } = fakeProvider();
    const out = await run(rich, provider, "tell me about my audio visualizer", "audio visualizer");
    expect(out.status).toBe("not_triggered");
    expect(search).not.toHaveBeenCalled();
  });

  it("treats vague 'inspire me' as no signal", async () => {
    const { provider, search } = fakeProvider();
    const out = await run(rich, provider, "inspire me with something cool", "visualizer");
    expect(out.status).toBe("not_triggered");
    expect(search).not.toHaveBeenCalled();
  });

  it("blocks search when the user is stuck but memory is empty", async () => {
    const { provider, search } = fakeProvider();
    const out = await run(empty, provider, "I'm stuck on shaders", "audio reactive shaders");
    expect(out.status).toBe("blocked_thin_memory");
    expect(search).not.toHaveBeenCalled();
  });

  it("reports unavailable instead of inventing results when no provider is configured", async () => {
    const out = await run(rich, null, "I'm stuck on the shader audio part", "audio reactive WebGL shaders");
    expect(out.status).toBe("unavailable");
  });

  it("searches with the user's terms, keeps only nearby results, cites memory + URLs, and logs the event", async () => {
    const { provider, search } = fakeProvider();
    const out = await run(rich, provider, "I'm stuck on making the shaders react to audio", "audio reactive WebGL shaders");
    expect(out.status).toBe("ok");
    if (out.status !== "ok") return;

    const query = (search.mock.calls[0] as unknown as [string])[0];
    expect(query).toMatch(/shader/);
    expect(query).toMatch(/p5\.j|visualizer|fft/);

    expect(out.results.map((r) => r.url)).toEqual(["https://example.org/p5-webgl-audio-shaders"]);
    const citedIds = out.memoryCitations.map((m) => m.id);
    expect(citedIds.length).toBeGreaterThan(0);
    for (const r of out.results) {
      expect(r.relatedMemoryIds.length).toBeGreaterThan(0);
      for (const id of r.relatedMemoryIds) expect(citedIds).toContain(id);
    }
    expect(out.framing).toMatch(/stuck/);

    const { rows } = await withUserDb(pool(), rich, (db) =>
      db.query("SELECT signal_kind, query, memory_ids, result_urls FROM assisted_search_events WHERE id = $1", [out.eventId]),
    );
    expect(rows[0]).toMatchObject({ signal_kind: "stuck", query, result_urls: ["https://example.org/p5-webgl-audio-shaders"] });
    expect(rows[0].memory_ids).toEqual(citedIds);
  });

  it("via the realtime tool, a help quote the user never said does not unlock search", async () => {
    const { provider, search } = fakeProvider();
    const s = await startSession(rich);
    await say(rich, s.sessionId, "the visualizer colors look fine today");
    const r = await handleToolCall(pool(), rich, { embedder, searchProvider: provider }, {
      sessionId: s.sessionId,
      callId: "c1",
      name: "assisted_search",
      arguments: { user_quote: "I'm stuck, please search for shader tutorials", topic: "shaders" },
    });
    expect(r.output).toMatchObject({ ok: false, error: "not_grounded" });
    expect(search).not.toHaveBeenCalled();
  });
});
