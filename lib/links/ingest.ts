import type { Pool } from "pg";
import { BadRequestError } from "@/lib/auth/errors";
import type { UserContext } from "@/lib/db/provision";
import { withUserDb } from "@/lib/db/user-db";
import { indexEntity, sha256 } from "@/lib/memory/chunks";
import type { Embedder } from "@/lib/memory/embeddings";
import { fetchGithubSnapshot, parseGithubRepoUrl, summarizeSnapshot } from "./github";

export interface LinkRefView {
  id: string;
  url: string;
  kind: "github_repo" | "generic_url";
  canonicalRepo: string | null;
  title: string | null;
  status: "pending" | "ready" | "failed";
  error: string | null;
  chunkIds: string[];
}

/**
 * User adds a reference link. GitHub repos are fetched via the public REST API
 * and indexed into the user's memory with `external_fetched` provenance.
 * On failure the link stays as an unindexed reference; contents are never guessed.
 * Generic URLs are stored as references only (fetching them is not implemented yet).
 */
export async function ingestLink(
  pool: Pool,
  ctx: UserContext,
  deps: { embedder: Embedder; fetchImpl?: typeof fetch; githubToken?: string },
  rawUrl: string,
): Promise<LinkRefView> {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new BadRequestError("invalid_url");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new BadRequestError("invalid_url");
  const gh = parseGithubRepoUrl(url.toString());
  const kind = gh ? "github_repo" : "generic_url";

  const linkId = await withUserDb(pool, ctx, async (db) => {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO link_refs (user_id, url, kind, canonical_repo, status, source_type, source_ref, confidence, external_url)
       VALUES ($1, $2, $3, $4, 'pending', $5, NULL, 'user_asserted', $2) RETURNING id`,
      [ctx.userId, url.toString(), kind, gh ? `${gh.owner}/${gh.repo}` : null, gh ? "github" : "link"],
    );
    return rows[0].id;
  });

  if (!gh) {
    await withUserDb(pool, ctx, (db) =>
      db.query("UPDATE link_refs SET status = 'failed', error = $3, updated_at = now() WHERE id = $1 AND user_id = $2", [
        linkId,
        ctx.userId,
        "Saved as a reference. Fetching non-GitHub pages is not supported yet.",
      ]),
    );
    return {
      id: linkId,
      url: url.toString(),
      kind,
      canonicalRepo: null,
      title: null,
      status: "failed",
      error: "Saved as a reference. Fetching non-GitHub pages is not supported yet.",
      chunkIds: [],
    };
  }

  try {
    const snap = await fetchGithubSnapshot(gh, {
      fetchImpl: deps.fetchImpl,
      token: deps.githubToken ?? process.env.GITHUB_TOKEN ?? undefined,
    });
    const summary = summarizeSnapshot(snap);
    const chunkIds = await withUserDb(pool, ctx, async (db) => {
      await db.query(
        `UPDATE link_refs SET status = 'ready', error = NULL, title = $3, summary = $4, canonical_repo = $5,
                commit_sha = $6, paths_indexed = $7::text[], snapshot = $8, snapshot_at = now(),
                content_hash = $9, confidence = 'external_fetched', updated_at = now()
          WHERE id = $1 AND user_id = $2`,
        [
          linkId,
          ctx.userId,
          snap.canonicalRepo,
          summary,
          snap.canonicalRepo,
          snap.commitSha,
          snap.paths,
          JSON.stringify(snap),
          sha256(`${summary}\n${snap.readme ?? ""}`),
        ],
      );
      const text = snap.readme ? `${summary}\n\nREADME:\n\n${snap.readme}` : summary;
      return indexEntity(db, ctx, deps.embedder, {
        type: "link_ref",
        id: linkId,
        text,
        provenance: {
          sourceType: "github",
          sourceRef: linkId,
          confidence: "external_fetched",
          externalUrl: snap.htmlUrl,
        },
      });
    });
    return {
      id: linkId,
      url: url.toString(),
      kind,
      canonicalRepo: snap.canonicalRepo,
      title: snap.canonicalRepo,
      status: "ready",
      error: null,
      chunkIds,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "fetch failed";
    await withUserDb(pool, ctx, (db) =>
      db.query("UPDATE link_refs SET status = 'failed', error = $3, updated_at = now() WHERE id = $1 AND user_id = $2", [
        linkId,
        ctx.userId,
        message.slice(0, 300),
      ]),
    );
    return {
      id: linkId,
      url: url.toString(),
      kind,
      canonicalRepo: `${gh.owner}/${gh.repo}`,
      title: null,
      status: "failed",
      error: message,
      chunkIds: [],
    };
  }
}

export async function listLinks(pool: Pool, ctx: UserContext) {
  return withUserDb(pool, ctx, async (db) => {
    const { rows } = await db.query(
      `SELECT id, url, kind, canonical_repo, title, status, error, snapshot_at
         FROM link_refs WHERE user_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC`,
      [ctx.userId],
    );
    return rows;
  });
}
