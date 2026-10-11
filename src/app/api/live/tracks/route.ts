import { replyTool, trackPrompt, trackTools } from "@/components/live-demo/tracks";
import { api, HttpError, readBody } from "@/lib/http";
import { requireUser } from "@/lib/session";
import { functionCalls, reasoningSummaries, respond, xaiModels } from "@/lib/xai";

// Turns the latest live transcript into track changes. The voice model only
// talks, so a fast text model does the sorting. Nothing is saved here.
export const POST = api(async (req: Request) => {
  await requireUser();
  const b = (await readBody(req)) as { text?: unknown; earlier?: unknown; tracks?: unknown; active?: unknown };
  const text = typeof b.text === "string" ? b.text.trim().slice(0, 4000) : "";
  if (!text) throw new HttpError(400, "text is required");
  const earlier = typeof b.earlier === "string" ? b.earlier.slice(-1500) : "";
  const tracks = JSON.stringify(Array.isArray(b.tracks) ? b.tracks : []).slice(0, 20000);
  const active = typeof b.active === "string" ? b.active : "none";

  const res = await respond({
    model: xaiModels.fast,
    input: [
      { role: "system", content: trackPrompt },
      {
        role: "user",
        content:
          `Current tracks (JSON): ${tracks}\nActive track: ${active}\n` +
          (earlier ? `What they said just before (already filed): """${earlier}"""\n` : "") +
          `NEW words to file now: """${text}"""`,
      },
    ],
    tools: [...trackTools, replyTool],
    tool_choice: "auto",
  });

  return { calls: functionCalls(res), thoughts: reasoningSummaries(res) };
});
