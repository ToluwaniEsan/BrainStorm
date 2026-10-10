import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BadRequestError } from "@/lib/auth/errors";
import type { UserContext } from "@/lib/db/provision";
import { withUserDb } from "@/lib/db/user-db";
import { parseGithubRepoUrl } from "@/lib/links/github";
import { ingestLink } from "@/lib/links/ingest";
import { retrieveMemory } from "@/lib/memory/retrieval";
import { embedder, newUser, pool, setupDb, teardownDb } from "./helpers";

function fakeGithub(opts: { missing?: boolean } = {}): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    if (opts.missing) return json({ message: "Not Found" }, 404);
    if (url.endsWith("/repos/ada/loom")) {
      return json({
        full_name: "ada/loom",
        html_url: "https://github.com/ada/loom",
        description: "Weaving pattern generator",
        default_branch: "main",
        language: "TypeScript",
        topics: ["textiles", "generative"],
        private: false,
      });
    }
    if (url.endsWith("/readme")) {
      return new Response("# Loom\n\nGenerates jacquard weaving drafts from SVG motifs. Exports WIF files for floor looms.");
    }
    if (url.includes("/commits?")) return json([{ sha: "abc123", commit: { message: "Add WIF exporter\n\nbody" } }]);
    if (url.includes("/git/trees/abc123")) {
      return json({ tree: [{ path: "src/wif.ts", type: "blob" }, { path: "src", type: "tree" }] });
    }
    return json({}, 404);
  }) as typeof fetch;
}

beforeAll(setupDb);
afterAll(teardownDb);

describe("parseGithubRepoUrl", () => {
  it.each([
    ["https://github.com/ada/loom", { owner: "ada", repo: "loom" }],
    ["https://github.com/ada/loom.git", { owner: "ada", repo: "loom" }],
    ["https://www.github.com/ada/loom/tree/main/src", { owner: "ada", repo: "loom" }],
    ["https://gitlab.com/ada/loom", null],
    ["https://github.com/ada", null],
    ["javascript:alert(1)", null],
    ["not a url", null],
  ])("%s", (input, expected) => {
    expect(parseGithubRepoUrl(input)).toEqual(expected);
  });
});

describe("GitHub link ingest", () => {
  let A: UserContext;
  let B: UserContext;

  beforeAll(async () => {
    A = await newUser("gh-a");
    B = await newUser("gh-b");
  });

  it("fetches a public repo into the user's memory with provenance", async () => {
    const link = await ingestLink(pool(), A, { embedder, fetchImpl: fakeGithub() }, "https://github.com/ada/loom");
    expect(link).toMatchObject({ status: "ready", canonicalRepo: "ada/loom", kind: "github_repo" });
    expect(link.chunkIds.length).toBeGreaterThan(0);

    const { rows } = await withUserDb(pool(), A, (db) =>
      db.query("SELECT commit_sha, paths_indexed, confidence FROM link_refs WHERE id = $1", [link.id]),
    );
    expect(rows[0]).toMatchObject({ commit_sha: "abc123", paths_indexed: ["src/wif.ts"], confidence: "external_fetched" });

    const hits = await withUserDb(pool(), A, (db) => retrieveMemory(db, A, embedder, "jacquard weaving drafts WIF"));
    expect(hits[0]).toMatchObject({
      entityType: "link_ref",
      entityId: link.id,
      sourceType: "github",
      confidence: "external_fetched",
      externalUrl: "https://github.com/ada/loom",
    });
  });

  it("another user's retrieval never sees the ingested repo", async () => {
    const hits = await withUserDb(pool(), B, (db) =>
      retrieveMemory(db, B, embedder, "jacquard weaving drafts WIF", { minScore: -1 }),
    );
    expect(hits).toEqual([]);
  });

  it("on fetch failure keeps an unindexed reference and invents nothing", async () => {
    const link = await ingestLink(pool(), A, { embedder, fetchImpl: fakeGithub({ missing: true }) }, "https://github.com/ada/ghost");
    expect(link.status).toBe("failed");
    expect(link.error).toMatch(/not found/i);
    const { rows } = await withUserDb(pool(), A, (db) =>
      db.query("SELECT count(*)::int AS n FROM memory_chunks WHERE entity_id = $1", [link.id]),
    );
    expect(rows[0].n).toBe(0);
  });

  it("stores generic URLs as references without fetching", async () => {
    const link = await ingestLink(pool(), A, { embedder, fetchImpl: fakeGithub() }, "https://example.com/post");
    expect(link).toMatchObject({ kind: "generic_url", status: "failed", chunkIds: [] });
  });

  it("rejects non-http URLs", async () => {
    await expect(ingestLink(pool(), A, { embedder }, "file:///etc/passwd")).rejects.toBeInstanceOf(BadRequestError);
  });
});
