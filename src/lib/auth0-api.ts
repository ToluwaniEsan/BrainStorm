import "server-only";

import { auth0 } from "@/lib/auth0";

export async function callAuth0Api(path: string, init: RequestInit = {}) {
  const baseUrl = process.env.AUTH0_API_BASE_URL;
  const audience = process.env.AUTH0_AUDIENCE;

  if (!baseUrl) {
    throw new Error("AUTH0_API_BASE_URL is required to call the protected API.");
  }

  if (!audience) {
    throw new Error("AUTH0_AUDIENCE is required to call the protected API.");
  }

  if (!path || path.startsWith("/") || path.startsWith("\\")) {
    throw new Error("API paths must be relative to AUTH0_API_BASE_URL.");
  }

  const base = new URL(baseUrl);
  if (base.protocol !== "https:" && base.hostname !== "localhost") {
    throw new Error("AUTH0_API_BASE_URL must use HTTPS outside localhost.");
  }

  const baseDirectory = base.pathname.endsWith("/")
    ? base.pathname
    : `${base.pathname}/`;
  const endpoint = new URL(path, `${base.origin}${baseDirectory}`);

  if (
    endpoint.origin !== base.origin ||
    !endpoint.pathname.startsWith(baseDirectory)
  ) {
    throw new Error("API path must stay within AUTH0_API_BASE_URL.");
  }

  const { token } = await auth0.getAccessToken({
    audience,
    ...(process.env.AUTH0_API_SCOPE
      ? { scope: process.env.AUTH0_API_SCOPE }
      : {}),
  });

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);

  return fetch(endpoint, {
    ...init,
    headers,
    cache: "no-store",
  });
}
