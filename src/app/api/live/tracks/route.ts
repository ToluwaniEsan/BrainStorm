import { FunctionCallingConfigMode, ThinkingLevel, type GenerateContentConfig } from "@google/genai";

import { replyTool, trackPrompt, trackTools } from "@/components/live-demo/tracks";
import { geminiModels, getGemini } from "@/lib/gemini";
import { api, HttpError, readBody } from "@/lib/http";
import { requireUser } from "@/lib/session";

// Set once the Flash model rejects the thinking settings, so later calls skip them.
let plainOnly = false;

// Turns the latest few seconds of live transcript into track changes.
// Gemini Live only acts when the speaker pauses, so a fast text model does
// the sorting while they're still talking. Nothing is saved here.
export const POST = api(async (req: Request) => {
  await requireUser();
  const b = (await readBody(req)) as { text?: unknown; earlier?: unknown; tracks?: unknown; active?: unknown };
  const text = typeof b.text === "string" ? b.text.trim().slice(0, 4000) : "";
  if (!text) throw new HttpError(400, "text is required");
  const earlier = typeof b.earlier === "string" ? b.earlier.slice(-1500) : "";
  const tracks = JSON.stringify(Array.isArray(b.tracks) ? b.tracks : []).slice(0, 20000);
  const active = typeof b.active === "string" ? b.active : "none";

  const contents =
    `Current tracks (JSON): ${tracks}\nActive track: ${active}\n` +
    (earlier ? `What they said just before (already filed): """${earlier}"""\n` : "") +
    `NEW words to file now: """${text}"""`;

  const base: GenerateContentConfig = {
    systemInstruction: trackPrompt,
    tools: [{ functionDeclarations: [...trackTools, replyTool] }],
    toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } },
  };
  const ai = getGemini();
  const thinking = { ...base, thinkingConfig: { includeThoughts: true, thinkingLevel: ThinkingLevel.LOW } };
  let res;
  if (plainOnly) res = await ai.models.generateContent({ model: geminiModels.flash, contents, config: base });
  else {
    try {
      res = await ai.models.generateContent({ model: geminiModels.flash, contents, config: thinking });
    } catch (err) {
      // Older Flash models don't take thinkingLevel; drop it if the retry works.
      console.warn("Track sorting with thinking failed, retrying without", err);
      res = await ai.models.generateContent({ model: geminiModels.flash, contents, config: base });
      plainOnly = true;
    }
  }

  const parts = res.candidates?.[0]?.content?.parts ?? [];
  return {
    calls: parts.filter((p) => p.functionCall?.name).map((p) => ({ name: p.functionCall!.name, args: p.functionCall!.args ?? {} })),
    thoughts: parts.filter((p) => p.thought && p.text).map((p) => p.text),
  };
});
