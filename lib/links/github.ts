export interface GithubRepoRef {
  owner: string;
  repo: string;
}

const NAME_RE = /^[A-Za-z0-9_.-]{1,100}$/;

export function parseGithubRepoUrl(input: string): GithubRepoRef | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.hostname !== "github.com" && url.hostname !== "www.github.com") return null;
  const [owner, rawRepo] = url.pathname.split("/").filter(Boolean);
  if (!owner || !rawRepo) return null;
  const repo = rawRepo.replace(/\.git$/, "");
  if (!NAME_RE.test(owner) || !NAME_RE.test(repo)) return null;
  return { owner, repo };
}

export interface GithubSnapshot {
  canonicalRepo: string;
  htmlUrl: string;
  description: string | null;
  defaultBranch: string;
  language: string | null;
  topics: string[];
  commitSha: string | null;
  readme: string | null;
  paths: string[];
  recentCommits: Array<{ sha: string; message: string }>;
}

export class GithubFetchError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "GithubFetchError";
  }
}

/** Public, unauthenticated-by-default GitHub REST fetch of README, tree and recent commits. */
export async function fetchGithubSnapshot(
  ref: GithubRepoRef,
  opts: { fetchImpl?: typeof fetch; token?: string; maxPaths?: number } = {},
): Promise<GithubSnapshot> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const base = `https://api.github.com/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}`;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "brainstorm-ingest",
  };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;

  const get = async (path: string, accept?: string) => {
    const res = await fetchImpl(`${base}${path}`, { headers: accept ? { ...headers, Accept: accept } : headers });
    return res;
  };

  const repoRes = await get("");
  if (!repoRes.ok) {
    throw new GithubFetchError(
      repoRes.status === 404 ? "Repository not found or not public" : `GitHub API error ${repoRes.status}`,
      repoRes.status,
    );
  }
  const repo = (await repoRes.json()) as {
    full_name: string;
    html_url: string;
    description: string | null;
    default_branch: string;
    language: string | null;
    topics?: string[];
    private?: boolean;
  };
  if (repo.private) throw new GithubFetchError("Private repositories are not supported yet");

  const [readmeRes, commitsRes] = await Promise.all([
    get("/readme", "application/vnd.github.raw+json"),
    get(`/commits?per_page=10&sha=${encodeURIComponent(repo.default_branch)}`),
  ]);
  const readme = readmeRes.ok ? (await readmeRes.text()).slice(0, 60_000) : null;
  const commits = commitsRes.ok
    ? ((await commitsRes.json()) as Array<{ sha: string; commit: { message: string } }>)
    : [];
  const commitSha = commits[0]?.sha ?? null;

  let paths: string[] = [];
  if (commitSha) {
    const treeRes = await get(`/git/trees/${commitSha}?recursive=1`);
    if (treeRes.ok) {
      const tree = (await treeRes.json()) as { tree?: Array<{ path: string; type: string }> };
      paths = (tree.tree ?? [])
        .filter((t) => t.type === "blob")
        .map((t) => t.path)
        .slice(0, opts.maxPaths ?? 300);
    }
  }

  return {
    canonicalRepo: repo.full_name,
    htmlUrl: repo.html_url,
    description: repo.description,
    defaultBranch: repo.default_branch,
    language: repo.language,
    topics: repo.topics ?? [],
    commitSha,
    readme,
    paths,
    recentCommits: commits.map((c) => ({ sha: c.sha, message: c.commit.message.split("\n")[0].slice(0, 200) })),
  };
}

export function summarizeSnapshot(s: GithubSnapshot): string {
  const lines = [
    `Repository ${s.canonicalRepo} (${s.htmlUrl})`,
    s.description ? `Description: ${s.description}` : null,
    s.language ? `Primary language: ${s.language}` : null,
    s.topics.length ? `Topics: ${s.topics.join(", ")}` : null,
    s.paths.length ? `Files (${s.paths.length} indexed): ${s.paths.slice(0, 80).join(", ")}` : null,
    s.recentCommits.length ? `Recent commits: ${s.recentCommits.map((c) => c.message).join(" | ")}` : null,
  ];
  return lines.filter(Boolean).join("\n");
}
