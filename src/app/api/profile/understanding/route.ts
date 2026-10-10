import { api } from "@/lib/http";
import { requireUser } from "@/lib/session";
import { refreshUnderstanding } from "@/server/understanding";

// Rebuilds what BrainStorm understands about the user right now.
export const POST = api(async () => {
  const user = await requireUser();
  return { understanding: await refreshUnderstanding(user.sub) };
});
