import "server-only";

// Reads a public GitHub repo (description, topics, languages, README) through
// the GitHub REST API. Returns null for anything that isn't github.com/owner/repo.
export async function readGithubRepo(url: string): Promise<{ title: string; text: string } | null> {
  const m = new URL(url).hostname === "github.com" ? new URL(url).pathname.match(/^\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/) : null;
  if (!m) return null;
  const [, owner, repo] = m;
  const gh = (path: string, accept = "application/vnd.github+json") =>
    fetch(`https://api.github.com/repos/${owner}/${repo}${path}`, {
      headers: { accept, "user-agent": "BrainStorm", ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) },
    });
  const info = await gh("");
  if (!info.ok) return null;
  const meta = (await info.json()) as {
    full_name: string; description: string | null; topics?: string[]; language: string | null;
    stargazers_count: number; pushed_at: string; homepage: string | null; fork: boolean;
  };
  const [langs, readme] = await Promise.all([
    gh("/languages").then((r) => (r.ok ? (r.json() as Promise<Record<string, number>>) : {})),
    gh("/readme", "application/vnd.github.raw").then((r) => (r.ok ? r.text() : "")),
  ]);
  const text = [
    `Repository: ${meta.full_name}${meta.fork ? " (fork)" : ""}`,
    meta.description && `Description: ${meta.description}`,
    `Languages: ${Object.keys(langs).join(", ") || meta.language || "unknown"}`,
    meta.topics?.length ? `Topics: ${meta.topics.join(", ")}` : "",
    `Stars: ${meta.stargazers_count}. Last push: ${meta.pushed_at}`,
    meta.homepage && `Homepage: ${meta.homepage}`,
    readme && `README:\n${readme.slice(0, 40_000)}`,
  ].filter(Boolean).join("\n");
  return { title: meta.full_name, text };
}
