import { NextResponse, type NextRequest } from "next/server";

import { auth0 } from "@/lib/auth0";

// Every Vercel deploy gets its own one-off *.vercel.app address, and Auth0
// only accepts the addresses listed in its settings. So visitors on any other
// *.vercel.app address are sent to the branch's stable one (for main:
// brainstorm-git-main-…vercel.app). VERCEL_BRANCH_URL is set by Vercel; it is
// unset locally, so nothing changes in development. Custom domains are left alone.
function stableHostRedirect(request: NextRequest) {
  const stable = process.env.VERCEL_BRANCH_URL;
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
