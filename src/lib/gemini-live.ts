import "server-only";
import { GoogleGenAI } from "@google/genai";
import { geminiModels } from "./gemini";
import { requireEnv } from "./env";

// Short-lived, single-use token so the browser can open the Gemini Live
// socket directly (Vercel functions can't hold a long-lived socket). The real
// GEMINI_API_KEY never leaves the server.
export async function createLiveToken() {
  const ai = new GoogleGenAI({ apiKey: requireEnv("GEMINI_API_KEY"), httpOptions: { apiVersion: "v1alpha" } });
  const now = Date.now();
  const expireTime = new Date(now + 30 * 60_000).toISOString();
  const token = await ai.authTokens.create({
    config: {
      uses: 1,
      expireTime,
      newSessionExpireTime: new Date(now + 60_000).toISOString(),
      liveConnectConstraints: { model: geminiModels.live },
      httpOptions: { apiVersion: "v1alpha" },
    },
  });
  if (!token.name) throw new Error("Gemini returned no token");
  return { token: token.name, model: geminiModels.live, expiresAt: expireTime };
}
