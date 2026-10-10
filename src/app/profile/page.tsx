import { redirect } from "next/navigation";
import { Suspense } from "react";

import { Nav } from "@/components/nav";
import { ProfileEditor } from "@/components/profile/profile-editor";
import { auth0 } from "@/lib/auth0";

async function Profile() {
  const session = await auth0.getSession();
  if (!session) redirect("/auth/login?returnTo=/profile");
  const { name, email } = session.user;
  return (
    <main className="flex min-h-screen flex-col items-center gap-8 bg-background p-6 text-foreground sm:p-10">
      <Nav current="/profile" />
      <ProfileEditor authName={name ?? ""} email={email ?? ""} />
    </main>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<main className="flex min-h-screen items-center justify-center p-8">Loading...</main>}>
      <Profile />
    </Suspense>
  );
}
