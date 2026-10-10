import "server-only";
import { requireEnv } from "./env";

// Exa web search and page contents. Server-only so EXA_API_KEY stays out of the browser.

export function exaFetch(path: "search" | "contents" | "findSimilar", body: unknown): Promise<Response> {
  return fetch(`https://api.exa.ai/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": requireEnv("EXA_API_KEY") },
    body: JSON.stringify(body),
  });
}
