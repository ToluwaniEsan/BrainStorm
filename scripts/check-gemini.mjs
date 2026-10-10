// Confirms GEMINI_API_KEY and GEMINI_FLASH_MODEL in .env.local work.
// Usage: npm run check:gemini
import { GoogleGenAI } from "@google/genai";

const apiKey = process.env.GEMINI_API_KEY;
const model = process.env.GEMINI_FLASH_MODEL;
if (!apiKey || !model) {
  console.error("Set GEMINI_API_KEY and GEMINI_FLASH_MODEL in .env.local first (see .env.example).");
  process.exit(1);
}

try {
  const ai = new GoogleGenAI({ apiKey });
  const res = await ai.models.generateContent({ model, contents: "Reply with the single word: ok" });
  console.log(`Gemini key works. ${model} replied: ${res.text?.trim()}`);
} catch (err) {
  console.error(`Gemini call failed: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}
