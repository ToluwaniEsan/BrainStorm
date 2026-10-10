import { redirect } from "next/navigation";
import { Suspense } from "react";

import { Nav } from "@/components/nav";
import { DeleteAccount } from "@/components/settings/delete-account";
import { auth0 } from "@/lib/auth0";

const card = "flex w-full max-w-3xl flex-col gap-3 rounded-xl border border-zinc-300 bg-white/80 p-5 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950/70 dark:text-zinc-100";

async function Settings() {
  const session = await auth0.getSession();
  if (!session) redirect("/auth/login?returnTo=/settings");
  return (
    <main className="flex min-h-screen flex-col items-center gap-8 bg-background p-6 text-foreground sm:p-10">
      <Nav current="/settings" />
      <h1 className="w-full max-w-3xl text-2xl font-semibold">Settings</h1>

      <section className={card}>
        <h2 className="text-lg font-semibold">Voice</h2>
        <p className="text-sm">
          Clutter listens quietly while you think out loud. It only answers when you turn to it, for example
          &ldquo;what do you think?&rdquo; or &ldquo;do you feel me?&rdquo;. Recordings are never stored: only the text of what you say is used.
        </p>
      </section>

      <section className={card}>
        <h2 className="text-lg font-semibold">Learning</h2>
        <p className="text-sm">
          Whether Clutter learns about you from your conversations, and everything it has learned, is on your{" "}
          <a href="/profile" className="underline">profile</a>.
        </p>
      </section>

      <section className={card}>
        <h2 className="text-lg font-semibold">Account</h2>
        <p className="text-sm">Signed in as {session.user.email ?? session.user.name}.</p>
        <a href="/auth/logout" className="self-start underline">Log out</a>
        <DeleteAccount />
      </section>
    </main>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<main className="flex min-h-screen items-center justify-center p-8">Loading...</main>}>
      <Settings />
    </Suspense>
  );
}
