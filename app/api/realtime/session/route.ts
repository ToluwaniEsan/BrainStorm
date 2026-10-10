import { authedRoute } from "@/lib/auth/route";
import { RealtimeUnavailableError, startRealtimeSession } from "@/lib/realtime/session";

export const runtime = "nodejs";

export const POST = authedRoute(async ({ ctx, pool }) => {
  try {
    const started = await startRealtimeSession(pool, ctx);
    return Response.json(started, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof RealtimeUnavailableError) {
      return Response.json(
        { error: "realtime_unavailable", degraded: true, message: "OPENAI_API_KEY is not configured." },
        { status: 503 },
      );
    }
    throw err;
  }
});
