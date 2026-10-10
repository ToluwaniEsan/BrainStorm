import { Suspense } from "react";

import { auth0 } from "@/lib/auth0";

async function AuthenticatedHome() {
  const session = await auth0.getSession();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background p-8 text-foreground">
      <h1 className="text-4xl font-semibold">BrainStorm</h1>
      {session ? (
        <div className="flex flex-col items-center gap-4">
          <p>
            Signed in as {session.user.name ?? session.user.email ?? "user"}.
          </p>
          <p className="text-sm text-zinc-500">
            Your Auth0 session is ready to request an access token for the API.
          </p>
          <a className="underline" href="/auth/logout">
            Log out
          </a>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4">
          <p>Sign in to continue.</p>
          <a
            className="rounded-md bg-foreground px-5 py-3 text-background"
            href="/auth/login"
          >
            Log in
          </a>
        </div>
      )}
    </main>
  );
}

export default function Home() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-background p-8 text-foreground">
          Loading...
        </main>
      }
    >
      <AuthenticatedHome />
    </Suspense>
  );
}
