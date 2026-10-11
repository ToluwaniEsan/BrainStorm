import { HttpError, api, readBody, str } from "@/lib/http";
import { requireUser } from "@/lib/session";
import { learnFromConversation } from "@/server/understanding";

// Learns lasting facts about the user from what they said in a Deep Thinking
// session. Does nothing when they turned learning off in their profile.
export const POST = api(async (req: Request) => {
  const user = await requireUser();
  const text = str(await readBody(req), "text", { required: true, max: 20_000 });
  if (!text?.trim()) throw new HttpError(400, "text is required");
  return { learned: await learnFromConversation(user.sub, text) };
});
