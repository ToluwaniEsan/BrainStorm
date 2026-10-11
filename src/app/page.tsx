import { cache, Suspense } from "react";
import "./globals.css";

import { profile } from "@/db/schema";
import { auth0 } from "@/lib/auth0";
import { LiveDemo } from "@/components/live-demo/live-demo";
import { EmailInUseError, provisionUser, withUser, type Identity } from "@/lib/db";

// Home. Signed out: a Log in button that goes to Auth0. Signed in: the voice
// mode (LiveDemo).
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

async function Home() {
  const session = await auth0.getSession();

  if (!session) {
    return (
      <main className="c-shell">
        <div className="c-landing">
          <h1>CLUTTER</h1>
          <p className="c-muted">Think out loud. Clutter sorts what you say into tracks.</p>
          <a className="c-btn" href="/auth/login">
            Log in
          </a>
        </div>
      </main>
    );
  }

  const { sub, name, email } = session.user;
  // Makes sure the user's own space exists in Supabase before they talk.
  const db = await supabaseCheck(sub, email, name, session.user.email_verified);

  return (
    <main className="c-shell">
      {!db.ok && (
        <p className="c-status error" style={{ position: "fixed", top: 84, left: 16, right: 16, zIndex: 30, textAlign: "center" }}>
          Couldn&apos;t set up your account: {db.error}
        </p>
      )}
      <LiveDemo />
    </main>
  );
}

export default function Page() {
  return (
    <Suspense
      fallback={
        <main className="c-shell">
          <div className="c-landing">
            <p className="c-muted">Loading...</p>
          </div>
        </main>
      }
    >
      <Home />
    </Suspense>
  );
}
