import "server-only";

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Add it to .env.local (see .env.example) or to the Vercel project's environment variables.`,
    );
  }
  return value;
}
