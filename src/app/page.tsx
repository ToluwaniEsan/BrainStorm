import { cache, Suspense } from "react";

import { profile } from "@/db/schema";
import { auth0 } from "@/lib/auth0";
import { provisionUser, withUser } from "@/lib/db";

// Test page for the sign-in flow. Signed out: a Log in button that goes to
// Auth0. Signed in: "Welcome", plus what happened in Supabase for this user.
const supabaseCheck = cache(async (sub: string) => {
  // Same call the API makes on first use: registers the sub in app.users
  // and creates the user's own schema (safe to repeat).
  let schema: string;
  try {
    schema = await provisionUser(sub);
  } catch (err) {
    console.error("Supabase sign-up failed", err);
    return { ok: false as const, error: message(err) };
  }
  // Separate step: the user is already saved even if this read fails.
  try {
    const [p] = await withUser(sub, (tx) => tx.select().from(profile).limit(1));
    return { ok: true as const, schema, profile: p ? "Yes" : "Not yet (made on first edit)" };
  } catch (err) {
    console.error("Profile read failed", err);
    return { ok: true as const, schema, profile: `Read failed: ${message(err)}` };
  }
});

function message(err: unknown) {
  return err instanceof Error ? err.message : "Unknown error";
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:gap-4">
      <dt className="w-40 shrink-0 text-zinc-500">{label}</dt>
      <dd className="break-all font-mono text-sm">{value}</dd>
    </div>
  );
}

async function Home() {
  const session = await auth0.getSession();

  if (!session) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background p-8 text-foreground">
        <h1 className="text-4xl font-semibold">BrainStorm</h1>
        <p>Sign in to continue.</p>
        <a className="rounded-md bg-foreground px-5 py-3 text-background" href="/auth/login">
          Log in
        </a>
        <p className="max-w-md text-center text-sm text-zinc-500">
          Log in sends you to Auth0 (/auth/login). Auth0 returns you to /auth/callback, which sets
          your session cookie and brings you back here.
        </p>
      </main>
    );
  }

  const { sub, name, email } = session.user;
  const db = await supabaseCheck(sub);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-background p-8 text-foreground">
      <h1 className="text-5xl font-semibold">Welcome</h1>
      <dl className="flex w-full max-w-xl flex-col gap-3 rounded-lg border border-zinc-300 p-5 dark:border-zinc-700">
        <Row label="Auth0 user" value={name ?? email ?? "(no name)"} />
        <Row label="Auth0 id (sub)" value={sub} />
        {db.ok ? (
          <>
            <Row label="Supabase" value="Saved. You're in app.users." />
            <Row label="Your schema" value={db.schema} />
            <Row label="Profile row" value={db.profile} />
          </>
        ) : (
          <Row label="Supabase" value={`Failed: ${db.error}`} />
        )}
      </dl>
      <a className="underline" href="/auth/logout">
        Log out
      </a>
    </main>
  );
}

export default function Page() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-background p-8 text-foreground">
          Loading...
        </main>
      }
    >
      <Home />
    </Suspense>
  );
}
