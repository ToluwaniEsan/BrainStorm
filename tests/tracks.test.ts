import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserContext } from "@/lib/db/provision";
import { withUserDb } from "@/lib/db/user-db";
import { retrieveMemory } from "@/lib/memory/retrieval";
import { EMPTY_MEMORY_REFUSAL } from "@/lib/policy/no-ghost";
import { handleToolCall } from "@/lib/realtime/tool-handler";
import type { TrackView } from "@/lib/tracks/store";
import { embedder, newUser, pool, say, setupDb, startSession, teardownDb } from "./helpers";

const deps = { embedder, searchProvider: null };
let seq = 0;

function call(ctx: UserContext, sessionId: string, name: string, args: unknown, heard?: string) {
  return handleToolCall(pool(), ctx, deps, {
    sessionId,
    callId: `call-${++seq}`,
    name,
    arguments: JSON.stringify(args),
    heard: heard ? { itemId: `partial-${seq}`, text: heard } : null,
  });
}

const byTitle = (tracks: TrackView[], title: string) => tracks.find((t) => t.title.toLowerCase().includes(title));

beforeAll(setupDb);
afterAll(teardownDb);

describe("live track mutations from realtime tool calls", () => {
  let A: UserContext;
  let sessionId: string;
  let onboardingId: string;
  let authId: string;
  let tracks: TrackView[];

  beforeAll(async () => {
    A = await newUser("tracks");
    const captured: { instructions?: string } = {};
    const s = await startSession(A, captured);
    sessionId = s.sessionId;
    expect(captured.instructions).toContain(EMPTY_MEMORY_REFUSAL);
    expect(s.tracks).toEqual([]);
  });

  it("creates a track during the stream, from the user's own words", async () => {
    await say(A, sessionId, "I want to start with the onboarding flow for new users");
    const r = await call(A, sessionId, "track_create", {
      title: "Onboarding flow",
      first_item: "start with onboarding for new users",
      user_quote: "start with the onboarding flow for new users",
    });
    expect(r.output.ok).toBe(true);
    expect(r.events.map((e) => e.type)).toEqual(["track.create", "track.append"]);
    onboardingId = r.output.track_id as string;
    expect(r.tracks).toHaveLength(1);
    expect(r.tracks[0].isActive).toBe(true);
  });

  it("refuses a ghost track the user never spoke about", async () => {
    const r = await call(A, sessionId, "track_create", {
      title: "Blockchain NFT marketplace",
      user_quote: "you should add an NFT marketplace",
    });
    expect(r.output).toMatchObject({ ok: false, error: "not_grounded" });
    expect(r.events).toEqual([]);
    expect(r.tracks).toHaveLength(1);
  });

  it("grounds against the in-progress partial when the final transcript lags the tool call", async () => {
    const r = await call(
      A,
      sessionId,
      "track_create",
      { title: "Auth part", first_item: "GitHub login for the auth part", user_quote: "the auth part needs GitHub login" },
      "separately the auth part needs GitHub login",
    );
    expect(r.output.ok).toBe(true);
    authId = r.output.track_id as string;
    tracks = r.tracks;
    expect(byTitle(tracks, "auth")?.isActive).toBe(true);
    expect(byTitle(tracks, "onboarding")?.isActive).toBe(false);
  });

  it("switches back to an earlier track and appends there", async () => {
    await say(A, sessionId, "going back to the onboarding flow, the welcome screen should be really short");
    const sw = await call(A, sessionId, "track_switch", {
      track_id: onboardingId,
      user_quote: "going back to the onboarding flow",
    });
    expect(sw.events[0]).toMatchObject({ type: "track.switch", trackId: onboardingId });
    const ap = await call(A, sessionId, "track_append", {
      body: "welcome screen should be really short",
      user_quote: "the welcome screen should be really short",
    });
    expect(ap.events[0]).toMatchObject({ type: "track.append", trackId: onboardingId });
    expect(byTitle(ap.tracks, "onboarding")?.items.map((i) => i.body)).toContain("welcome screen should be really short");
  });

  it("prefers the existing track over creating a near-duplicate", async () => {
    await say(A, sessionId, "onboarding flow again");
    const r = await call(A, sessionId, "track_create", { title: "onboarding flow", user_quote: "onboarding flow again" });
    expect(r.output).toMatchObject({ ok: true, reused_existing_track: true, track_id: onboardingId });
    expect(r.events[0].type).toBe("track.switch");
    expect(r.tracks).toHaveLength(2);
  });

  it("moves and edits items when the user re-files or corrects a thought", async () => {
    await say(A, sessionId, "actually the GitHub login belongs with onboarding, and make it GitHub or email login");
    const item = byTitle(tracks, "auth")!.items[0];
    const mv = await call(A, sessionId, "track_item_move", {
      item_id: item.id,
      to_track_id: onboardingId,
      user_quote: "the GitHub login belongs with onboarding",
    });
    expect(mv.events[0]).toMatchObject({ type: "track_item.move", fromTrackId: authId, trackId: onboardingId });
    const ed = await call(A, sessionId, "track_item_edit", {
      item_id: item.id,
      body: "GitHub or email login",
      user_quote: "make it GitHub or email login",
    });
    expect(ed.events[0].type).toBe("track_item.edit");
    const moved = byTitle(ed.tracks, "onboarding")!.items.find((i) => i.id === item.id);
    expect(moved?.body).toBe("GitHub or email login");
  });

  it("only merges when the user explicitly treats tracks as one", async () => {
    await say(A, sessionId, "the auth part and onboarding flow");
    const refused = await call(A, sessionId, "track_merge", {
      source_track_id: authId,
      target_track_id: onboardingId,
      user_quote: "the auth part and onboarding flow",
    });
    expect(refused.output).toMatchObject({ ok: false, error: "merge_requires_explicit_user_request" });

    await say(A, sessionId, "honestly auth and onboarding are basically the same thing, merge them");
    const ok = await call(A, sessionId, "track_merge", {
      source_track_id: authId,
      target_track_id: onboardingId,
      user_quote: "auth and onboarding are basically the same thing, merge them",
    });
    expect(ok.events[0]).toMatchObject({ type: "track.merge", fromTrackId: authId, trackId: onboardingId });
    expect(ok.tracks.map((t) => t.id)).toEqual([onboardingId]);
  });

  it("persists every mutation as a track_event with provenance", async () => {
    const { rows } = await withUserDb(pool(), A, (db) =>
      db.query("SELECT event_type, source_type, confidence, transcript_span, user_quote, tool_call_id FROM track_events ORDER BY created_at"),
    );
    expect(rows.map((r) => r.event_type)).toEqual([
      "track.create",
      "track.append",
      "track.create",
      "track.append",
      "track.switch",
      "track.append",
      "track.switch",
      "track_item.move",
      "track_item.edit",
      "track.merge",
    ]);
    for (const r of rows) {
      expect(r.source_type).toBe("realtime");
      expect(r.confidence).toBe("live_draft");
      expect(r.transcript_span.session_id).toBe(sessionId);
      expect(r.user_quote).toBeTruthy();
      expect(r.tool_call_id).toMatch(/^call-/);
    }
  });

  it("indexes track items into this user's memory for retrieval", async () => {
    const hits = await withUserDb(pool(), A, (db) => retrieveMemory(db, A, embedder, "welcome screen short"));
    expect(hits[0]).toMatchObject({ entityType: "track_item", sourceType: "realtime" });
  });

  it("rejects unknown tools and invalid arguments without mutating", async () => {
    const unknown = await call(A, sessionId, "drop_database", {});
    expect(unknown.output).toMatchObject({ ok: false, error: "unknown_tool" });
    const invalid = await call(A, sessionId, "track_switch", { track_id: "not-a-uuid", user_quote: "x" });
    expect(invalid.output).toMatchObject({ ok: false, error: "invalid_arguments" });
    expect(unknown.events).toEqual([]);
    expect(invalid.events).toEqual([]);
  });

  it("reopening a session loads existing tracks into the instructions for switch detection", async () => {
    const captured: { instructions?: string } = {};
    await startSession(A, captured);
    expect(captured.instructions).toContain(`[track:${onboardingId}]`);
    expect(captured.instructions).not.toContain(EMPTY_MEMORY_REFUSAL);
  });

  it("another user cannot use A's session or touch A's tracks", async () => {
    const B = await newUser("tracks-b");
    await expect(call(B, sessionId, "track_switch", { track_id: onboardingId, user_quote: "x" })).rejects.toMatchObject({
      code: "session_not_found",
    });
    const bSession = await startSession(B);
    await say(B, bSession.sessionId, "going back to the onboarding flow");
    const r = await call(B, bSession.sessionId, "track_switch", {
      track_id: onboardingId,
      user_quote: "going back to the onboarding flow",
    });
    expect(r.output).toMatchObject({ ok: false, error: "track_not_found" });
    expect(r.tracks).toEqual([]);
  });
});
