import { NextResponse, type NextRequest } from "next/server";

import { auth0 } from "@/lib/auth0";

// Every Vercel deploy gets its own one-off *.vercel.app address, and Auth0
// only accepts the addresses listed in its settings. So visitors on any other
// *.vercel.app address are sent to one stable address first. That address is
// APP_BASE_URL when set (the Auth0 SDK then also uses it for every callback
// and logout link), otherwise the branch's own alias from VERCEL_BRANCH_URL.
// Locally neither points at *.vercel.app, so nothing changes in development.
// Custom domains are left alone.
function stableHost(): string | undefined {
  const base = process.env.APP_BASE_URL?.split(",")[0]?.trim();
  if (base) {
    try {
      return new URL(base).host;
    } catch {
      return undefined;
    }
  }
  return process.env.VERCEL_BRANCH_URL;
}

function stableHostRedirect(request: NextRequest) {
  const stable = stableHost();
  const host = request.headers.get("host");
  if (!stable || !host || host === stable || !host.endsWith(".vercel.app")) return null;
  // Set the path on a URL that already has the stable host, so a path like
  // "//other.site" can't swap in a different host.
  const url = new URL(`https://${stable}`);
  url.pathname = request.nextUrl.pathname;
  url.search = request.nextUrl.search;
  return NextResponse.redirect(url, 308);
}

// Mounts the Auth0 routes (/auth/login, /auth/logout, /auth/callback, ...)
// and keeps the session cookie rolling on every request.
export async function proxy(request: NextRequest) {
  return stableHostRedirect(request) ?? (await auth0.middleware(request));
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
  ],
};
