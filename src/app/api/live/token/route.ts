import { api } from "@/lib/http";
import { requireUser } from "@/lib/session";
import { createVoiceToken } from "@/lib/xai";

// Browser calls this right before connecting to Grok's realtime voice.
export const POST = api(async () => {
  await requireUser();
  return createVoiceToken();
});
