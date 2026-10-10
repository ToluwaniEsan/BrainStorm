import "server-only";
import { GoogleGenAI } from "@google/genai";

// Shared Gemini client. Importing this from a client component fails the build,
// which keeps GEMINI_API_KEY out of the browser bundle.

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Add it to .env.local (see .env.example) or to the Vercel project's environment variables.`,
    );
  }
  return value;
}

let client: GoogleGenAI | undefined;

export function getGemini(): GoogleGenAI {
  client ??= new GoogleGenAI({ apiKey: requireEnv("GEMINI_API_KEY") });
  return client;
}

export const geminiModels = {
  get live() {
    return requireEnv("GEMINI_LIVE_MODEL");
  },
  get flash() {
    return requireEnv("GEMINI_FLASH_MODEL");
  },
  get pro() {
    return requireEnv("GEMINI_PRO_MODEL");
  },
  get embed() {
    return requireEnv("GEMINI_EMBED_MODEL");
  },
};
