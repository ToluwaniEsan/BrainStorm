import type { NextRequest } from "next/server";

import { auth0 } from "@/lib/auth0";

// Mounts the Auth0 routes (/auth/login, /auth/logout, /auth/callback, ...)
// and keeps the session cookie rolling on every request.
export async function proxy(request: NextRequest) {
  return await auth0.middleware(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
  ],
};
