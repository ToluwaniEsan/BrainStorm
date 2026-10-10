import { auth0 } from "@/lib/auth/auth0";
import DeepThinking from "./components/DeepThinking";

export default async function Home() {
  const session = await auth0.getSession();

  if (!session) {
    return (
      <main className="center">
        <h1>BrainStorm</h1>
        <p className="muted">A thinking partner grounded only in your own work. Sign in to start.</p>
        <div className="row">
          <a className="button" href="/auth/login?connection=github">
            Sign in with GitHub
          </a>
          <a className="button secondary" href="/auth/login">
            Other sign-in
          </a>
        </div>
      </main>
    );
  }

  return (
    <main>
      <header className="row spread">
        <h1>BrainStorm</h1>
        <div className="row">
          <span className="muted">{session.user.name ?? session.user.email}</span>
          <a className="button secondary" href="/auth/logout">
            Sign out
          </a>
        </div>
      </header>
      <DeepThinking />
    </main>
  );
}
