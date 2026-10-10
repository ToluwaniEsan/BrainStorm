import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/auth0", () => ({ auth0: { getSession: vi.fn() } }));

import { DELETE as deleteAccount } from "@/app/api/account/route";
import { GET as getLinks, POST as postLink } from "@/app/api/links/route";
import { POST as memorySearch } from "@/app/api/memory/search/route";
import { POST as endSession } from "@/app/api/realtime/end/route";
import { POST as startSession } from "@/app/api/realtime/session/route";
import { POST as toolCall } from "@/app/api/realtime/tool/route";
import { POST as transcript } from "@/app/api/realtime/transcript/route";
import { GET as getTracks } from "@/app/api/tracks/route";
import { auth0 } from "@/lib/auth/auth0";
import type { SessionLike } from "@/lib/auth/context";
import { countUsers, newSub, newUser, sessionFor, setupDb, teardownDb } from "./helpers";

const getSession = vi.mocked(auth0.getSession);
const asSession = (s: SessionLike | null) => s as Awaited<ReturnType<typeof auth0.getSession>>;

const post = (body: unknown) =>
  new Request("http://localhost/api", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
const get = () => new Request("http://localhost/api");

beforeAll(setupDb);
afterAll(teardownDb);
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.OPENAI_API_KEY;
});

describe("every API route denies signed-out callers", () => {
  const routes: Array<[string, () => Promise<Response>]> = [
    ["POST /api/realtime/session", () => startSession(post({}))],
    ["POST /api/realtime/tool", () => toolCall(post({ sessionId: crypto.randomUUID(), callId: "c", name: "track_create", arguments: "{}" }))],
    ["POST /api/realtime/transcript", () => transcript(post({ sessionId: crypto.randomUUID(), itemId: "i", text: "hi", isFinal: true }))],
    ["POST /api/realtime/end", () => endSession(post({ sessionId: crypto.randomUUID() }))],
    ["GET /api/tracks", () => getTracks(get())],
    ["GET /api/links", () => getLinks(get())],
    ["POST /api/links", () => postLink(post({ url: "https://github.com/ada/loom" }))],
    ["POST /api/memory/search", () => memorySearch(post({ query: "anything" }))],
    ["DELETE /api/account", () => deleteAccount(new Request("http://localhost/api", { method: "DELETE" }))],
  ];

  it.each(routes)("%s → 401, nothing stored", async (_name, invoke) => {
    getSession.mockResolvedValue(null);
    const before = await countUsers();
    const res = await invoke();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthenticated" });
    expect(await countUsers()).toBe(before);
  });
});

describe("authenticated flow through the HTTP layer", () => {
  it("mints a realtime session, ignores client-supplied user ids, and wipes on delete", async () => {
    const victim = await newUser("route-victim");
    const sub = newSub("route-a");
    const session = sessionFor(sub, Math.floor(Date.now() / 1000) - 5);
    getSession.mockResolvedValue(asSession(session));

    const noKey = await startSession(post({}));
    expect(noKey.status).toBe(503);
    expect(await noKey.json()).toMatchObject({ error: "realtime_unavailable", degraded: true });

    process.env.OPENAI_API_KEY = "sk-test";
    const fetchMock = vi.fn(async () =>
      Response.json({ value: "ek_test_123", expires_at: 1_900_000_000 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const res = await startSession(post({ userId: victim.userId }));
    expect(res.status).toBe(200);
    const started = await res.json();
    expect(started.clientSecret).toBe("ek_test_123");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/realtime/client_secrets");
    const sent = JSON.parse(String(init.body));
    expect(sent.session.type).toBe("realtime");
    expect(sent.session.tools.map((t: { name: string }) => t.name)).toContain("track_switch");
    vi.unstubAllGlobals();
    delete process.env.OPENAI_API_KEY;

    const t = await transcript(
      post({ sessionId: started.sessionId, itemId: "i1", text: "let's map the loom exporter", isFinal: true, userId: victim.userId }),
    );
    expect(t.status).toBe(200);

    const tool = await toolCall(
      post({
        sessionId: started.sessionId,
        callId: "c1",
        name: "track_create",
        arguments: JSON.stringify({ title: "Loom exporter", user_quote: "map the loom exporter" }),
        userId: victim.userId,
      }),
    );
    expect(tool.status).toBe(200);
    const body = await tool.json();
    expect(body.events[0].type).toBe("track.create");

    getSession.mockResolvedValue(asSession(sessionFor(victim.auth0Sub)));
    const victimTracks = await (await getTracks(get())).json();
    expect(victimTracks.tracks).toEqual([]);
    const crossSession = await toolCall(
      post({ sessionId: started.sessionId, callId: "c2", name: "track_switch", arguments: "{}" }),
    );
    expect(crossSession.status).toBe(404);

    getSession.mockResolvedValue(asSession(session));
    expect((await (await getTracks(get())).json()).tracks).toHaveLength(1);

    const del = await deleteAccount(new Request("http://localhost/api", { method: "DELETE" }));
    expect(del.status).toBe(200);
    const after = await getTracks(get());
    expect(after.status).toBe(401);
    expect(await after.json()).toEqual({ error: "session_revoked" });
  });

  it("rejects malformed bodies with 400", async () => {
    const sub = newSub("route-bad");
    getSession.mockResolvedValue(asSession(sessionFor(sub)));
    const res = await toolCall(post({ sessionId: "nope" }));
    expect(res.status).toBe(400);
  });
});
