import "server-only";
import { GoogleGenAI } from "@google/genai";
import { requireEnv } from "./env";

// Shared Gemini client. Importing this from a client component fails the build,
// which keeps GEMINI_API_KEY out of the browser bundle.

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
