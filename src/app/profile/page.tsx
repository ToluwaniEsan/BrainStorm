import { redirect } from "next/navigation";
import { Suspense } from "react";

import { ProfileEditor } from "@/components/profile/profile-editor";
import { auth0 } from "@/lib/auth0";
import { PageLoading } from "@/components/loading";

async function Profile() {
  const session = await auth0.getSession();
  if (!session) redirect("/auth/login?returnTo=/profile");
  const { name, email } = session.user;
  return (
    <main className="c-shell">
      <div className="c-page">
        <ProfileEditor authName={name ?? ""} email={email ?? ""} />
      </div>
    </main>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<PageLoading />}>
      <Profile />
    </Suspense>
  );
}
