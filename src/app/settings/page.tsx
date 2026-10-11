import { redirect } from "next/navigation";
import { Suspense } from "react";

import { MotionSettings } from "@/components/prefs";
import { DeleteAccount } from "@/components/settings/delete-account";
import { LearningSetting } from "@/components/settings/learning-setting";
import { auth0 } from "@/lib/auth0";
import { PageLoading } from "@/components/loading";

async function Settings() {
  const session = await auth0.getSession();
  if (!session) redirect("/auth/login?returnTo=/settings");
  return (
    <main className="c-shell">
      <div className="c-page">
        <h1 className="c-title">Settings</h1>
        <p className="c-lede">How Clutter listens, talks and remembers.</p>
        <div className="c-stack">
          <section className="c-panel">
            <h2>Voice</h2>
            <div className="c-set">
              <div className="c-grow">
                <b>When Clutter speaks</b>
                <p className="c-muted">
                  Clutter listens quietly while you think out loud. It only answers when you turn to it, for example &ldquo;what do you
                  think?&rdquo; or &ldquo;do you feel me?&rdquo;, and then it asks grounding questions rather than cheering you on.
                </p>
              </div>
            </div>
          </section>

          <section className="c-panel">
            <h2>Learning</h2>
            <LearningSetting />
          </section>

          <section className="c-panel">
            <h2>Look and motion</h2>
            <MotionSettings />
          </section>

          <section className="c-panel">
            <h2>Privacy and data</h2>
            <div className="c-set">
              <div className="c-grow">
                <b>Recordings</b>
                <p className="c-muted">Audio is never stored. Only the words, and the tracks made from them, are saved to your Studio.</p>
              </div>
            </div>
            <div className="c-set">
              <div className="c-grow">
                <b>Account</b>
                <p className="c-muted">Signed in as {session.user.email ?? session.user.name}.</p>
              </div>
              <a href="/auth/logout" className="c-btn ghost">
                Log out
              </a>
            </div>
            <div className="c-set">
              <div className="c-grow">
                <b>Delete everything</b>
                <p className="c-muted">Removes your account and all your sessions, tracks, documents and learned facts.</p>
                <div style={{ marginTop: 10 }}>
                  <DeleteAccount />
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<PageLoading />}>
      <Settings />
    </Suspense>
  );
}
