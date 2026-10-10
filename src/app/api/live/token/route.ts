import { api } from "@/lib/http";
import { createLiveToken } from "@/lib/gemini-live";
import { requireUser } from "@/lib/session";

// Browser calls this right before connecting to Gemini Live.
export const POST = api(async () => {
  await requireUser();
  return createLiveToken();
});
