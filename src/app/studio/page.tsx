import { redirect } from "next/navigation";
import { Suspense } from "react";

import { Studio } from "@/components/studio/studio";
import { auth0 } from "@/lib/auth0";

async function StudioPage() {
  const session = await auth0.getSession();
  if (!session) redirect("/auth/login?returnTo=/studio");
  return (
    <main className="c-shell">
      <div className="c-page">
        <h1 className="c-title">Studio</h1>
        <p className="c-lede">Every session you&apos;ve had, sorted into tracks. Search to pull an old rant back up.</p>
        <Studio />
      </div>
    </main>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<main className="c-shell"><div className="c-page"><p className="c-muted">Loading...</p></div></main>}>
      <StudioPage />
    </Suspense>
  );
}
