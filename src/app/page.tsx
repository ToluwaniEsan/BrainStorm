import { cache, Suspense } from "react";

import { profile } from "@/db/schema";
import { auth0 } from "@/lib/auth0";
import { LiveDemo } from "@/components/live-demo/live-demo";
import { EmailInUseError, provisionUser, withUser, type Identity } from "@/lib/db";

// Test page. Signed out: a Log in button that goes to Auth0. Signed in: the
// Gemini Live demo, with a details panel showing what happened in Supabase.
// Plain arguments so React's per-request cache can match repeat calls.
const supabaseCheck = cache(async (sub: string, email?: string, name?: string, emailVerified?: boolean) => {
  const who: Identity = { email, name, emailVerified };
  // Same rules and call the API uses: only a verified email can be claimed,
  // then the sub, email and name are saved in app.users and the user's own
  // schema is created (safe to repeat).
  if (who.email && who.emailVerified !== true) {
    return { ok: false as const, error: "Verify your email address first, then sign in again." };
  }
  let schema: string;
  try {
    schema = await provisionUser(sub, who);
  } catch (err) {
    if (err instanceof EmailInUseError) return { ok: false as const, error: `${err.message}.` };
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
        <h1 className="text-4xl font-semibold">Clutter</h1>
        <p>Your creative helper</p>
        <a className="rounded-md bg-foreground px-5 py-3 text-background" href="/auth/login">
          Log in
        </a>
        <p className="max-w-md text-center text-sm text-zinc-500">
          Sign in to continue.
        </p>
      </main>
    );
  }

  const { sub, name, email } = session.user;
  const db = await supabaseCheck(sub, email, name, session.user.email_verified);

  return (
    <main className="flex min-h-screen flex-col items-center gap-8 bg-background p-6 text-foreground sm:p-10">
      <header className="flex w-full max-w-6xl items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Welcome to Clutter</h1>
          <p className="text-sm text-zinc-500">Signed in as {name ?? email ?? sub}</p>
        </div>
        <a className="text-sm underline" href="/auth/logout">
          Log out
        </a>
      </header>
      <LiveDemo />
      <details className="w-full max-w-6xl text-sm">
        <summary className="cursor-pointer text-zinc-500">
          Account check: {db.ok ? "saved in Supabase" : "Supabase problem"}
        </summary>
        <dl className="mt-3 flex flex-col gap-3 rounded-lg border border-zinc-300 p-5 dark:border-zinc-700">
          <Row label="Auth0 user" value={name ?? email ?? "(no name)"} />
          <Row label="Auth0 id (sub)" value={sub} />
          <Row label="Email" value={email ?? "(none from this login method)"} />
          {db.ok ? (
            <>
              <Row label="Supabase" value="Saved. Your id, email and name are in app.users." />
              <Row label="Your schema" value={db.schema} />
              <Row label="Profile row" value={db.profile} />
            </>
          ) : (
            <Row label="Supabase" value={`Failed: ${db.error}`} />
          )}
        </dl>
      </details>
    </main>
  );
}

export default function Page() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-background p-8 text-foreground">
          Loading 🤔...
        </main>
      }
    >
      <Home />
    </Suspense>
  );
}
