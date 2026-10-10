import { profile } from "@/db/schema";
import { withUser } from "@/lib/db";
import { api } from "@/lib/http";
import { requireUser } from "@/lib/session";
import { liveInstruction } from "@/server/persona";

// The Live system instruction for the signed-in user, built from what
// BrainStorm knows about them. The browser passes it to Gemini Live.
export const GET = api(async () => {
  const user = await requireUser();
  const [p] = await withUser(user.sub, (tx) => tx.select().from(profile).limit(1));
  return {
    instruction: liveInstruction(p?.understanding ?? null, p?.displayName ?? user.name),
    learningEnabled: p?.learningEnabled ?? true,
  };
});
