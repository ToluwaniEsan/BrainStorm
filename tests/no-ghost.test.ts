import { describe, expect, it } from "vitest";
import type { MemoryHit } from "@/lib/memory/retrieval";
import { buildRealtimeInstructions } from "@/lib/policy/instructions";
import {
  EMPTY_MEMORY_REFUSAL,
  buildConditionedQuery,
  detectHelpSignal,
  detectTrackSwitch,
  filterByVicinity,
  findDuplicateTrack,
  findGhostPhrases,
  gateAssistedSearch,
  isGroundedInSpeech,
} from "@/lib/policy/no-ghost";
import { realtimeToolDefinitions } from "@/lib/tracks/tools";

const hit = (id: string, content: string, sourceType = "chat"): MemoryHit => ({
  id,
  entityType: "reflection",
  entityId: id,
  content,
  sourceType,
  sourceRef: null,
  confidence: "user_asserted",
  externalUrl: null,
  score: 0.8,
});

describe("detectHelpSignal", () => {
  it.each([
    ["I'm stuck on the shader part", "stuck"],
    ["honestly I am kind of stuck here", "stuck"],
    ["I don't know how to export WIF files", "stuck"],
    ["I'm blocked on deploys", "stuck"],
    ["can you look up how p5 handles FFT", "explicit_help"],
    ["search for examples of jacquard drafts", "explicit_help"],
    ["help me find docs related to my loom repo", "explicit_help"],
  ])("%s → %s", (utterance, kind) => {
    expect(detectHelpSignal(utterance)?.kind).toBe(kind);
  });

  it.each(["inspire me", "give me some ideas for a new project", "what should I build next", "the colors look good", ""])(
    "no signal: %s",
    (utterance) => {
      expect(detectHelpSignal(utterance)).toBeNull();
    },
  );
});

describe("gateAssistedSearch", () => {
  it("requires a signal", () => {
    expect(gateAssistedSearch({ utterance: "tell me more", memory: [hit("1", "loom project")] })).toMatchObject({
      allowed: false,
      reason: "no_help_signal",
    });
  });
  it("requires personal memory (prior web results don't count)", () => {
    expect(
      gateAssistedSearch({ utterance: "I'm stuck", memory: [hit("1", "some web page", "web_assisted")] }),
    ).toMatchObject({ allowed: false, reason: "thin_memory" });
  });
  it("allows when both hold", () => {
    expect(gateAssistedSearch({ utterance: "I'm stuck", memory: [hit("1", "loom project")] }).allowed).toBe(true);
  });
});

describe("isGroundedInSpeech", () => {
  const heard = ["I want the onboarding flow to feel calm", "and the auth part needs GitHub login"];
  it("accepts quotes and tight paraphrases of what was said", () => {
    expect(isGroundedInSpeech("Onboarding flow", heard)).toBe(true);
    expect(isGroundedInSpeech("GitHub login for auth", heard)).toBe(true);
  });
  it("rejects themes the user never spoke", () => {
    expect(isGroundedInSpeech("NFT marketplace", heard)).toBe(false);
    expect(isGroundedInSpeech("gamified onboarding with leaderboards and badges", heard)).toBe(false);
  });
  it("rejects everything when nothing was heard", () => {
    expect(isGroundedInSpeech("onboarding", [])).toBe(false);
  });
});

describe("buildConditionedQuery", () => {
  it("uses the stuck topic plus the user's own memory terms", () => {
    const q = buildConditionedQuery("export WIF files", [
      hit("m1", "Loom generates jacquard weaving drafts from SVG motifs"),
      hit("m2", "jacquard loom project in TypeScript"),
    ]);
    expect(q.query.startsWith("export wif file")).toBe(true);
    expect(q.terms).toContain("jacquard");
    expect(q.terms).toContain("loom");
    expect(q.memoryIds).toEqual(["m1", "m2"]);
    expect(q.query).not.toMatch(/idea|inspiration|trend/);
  });
});

describe("filterByVicinity", () => {
  const memory = [hit("m1", "Loom generates jacquard weaving drafts and exports WIF files")];
  it("keeps results that share concrete terms and ties them to memory ids", () => {
    const out = filterByVicinity(
      [
        { title: "WIF file format for jacquard looms", url: "https://a.org/wif", snippet: "Weaving Information File spec" },
        { title: "10 ideas for weekend projects", url: "https://b.org/ideas", snippet: "jacquard loom WIF" },
        { title: "Kubernetes autoscaling", url: "https://c.org/k8s", snippet: "pods and nodes" },
        { title: "jacquard WIF", url: "ftp://d.org/x", snippet: "" },
      ],
      memory,
    );
    expect(out.map((r) => r.url)).toEqual(["https://a.org/wif"]);
    expect(out[0].relatedMemoryIds).toEqual(["m1"]);
    expect(out[0].sharedTerms).toEqual(expect.arrayContaining(["jacquard", "wif"]));
  });
});

describe("detectTrackSwitch", () => {
  const tracks = [
    { id: "t-onb", title: "Onboarding flow", isActive: false, items: [{ body: "welcome screen should be short" }] },
    { id: "t-auth", title: "Auth part", isActive: true, items: [{ body: "GitHub login" }] },
  ];
  it("switches on a speech cue to an existing track", () => {
    expect(detectTrackSwitch("ok going back to the onboarding flow", tracks)).toMatchObject({
      action: "switch",
      trackId: "t-onb",
      reason: "speech_cue",
    });
  });
  it("switches on strong semantic continuity without a cue", () => {
    expect(detectTrackSwitch("the onboarding flow welcome screen should be short", tracks)).toMatchObject({
      action: "switch",
      trackId: "t-onb",
      reason: "semantic",
    });
  });
  it("stays when the active track is the best match", () => {
    expect(detectTrackSwitch("back to GitHub login on the auth part", tracks)).toEqual({ action: "stay" });
  });
  it("asks when a cue is present but the target is ambiguous", () => {
    expect(detectTrackSwitch("going back to the welcome bit", tracks)).toMatchObject({ action: "ask", trackId: "t-onb" });
  });
  it("never invents a new track for unrelated speech", () => {
    expect(detectTrackSwitch("I had pasta for lunch", tracks)).toEqual({ action: "stay" });
  });
});

describe("findDuplicateTrack", () => {
  const tracks = [{ id: "t1", title: "Onboarding flow" }];
  it("matches near-duplicates", () => {
    expect(findDuplicateTrack("the onboarding flow", tracks)?.id).toBe("t1");
  });
  it("does not match distinct themes", () => {
    expect(findDuplicateTrack("Deployment pipeline", tracks)).toBeNull();
  });
});

describe("findGhostPhrases", () => {
  it("flags generic idea-pack phrasing", () => {
    expect(findGhostPhrases("What if you tried building a habit tracker?")).not.toEqual([]);
    expect(findGhostPhrases("Here are some ideas for your next app")).not.toEqual([]);
  });
  it("allows reflective questions about the user's own material", () => {
    expect(findGhostPhrases("You noted the welcome screen should be short — what makes it feel long now?")).toEqual([]);
  });
});

describe("realtime instructions", () => {
  it("empty memory: refusal template, no search, no seeded tracks", () => {
    const text = buildRealtimeInstructions({ profile: null, tracks: [], recent: [], chunkCount: 0 });
    expect(text).toContain(EMPTY_MEMORY_REFUSAL);
    expect(text).toContain("Do not call assisted_search");
    expect(text).not.toMatch(/\[track:/);
  });
  it("includes only the provided user's memory, cited by id", () => {
    const text = buildRealtimeInstructions({
      profile: { id: "p1", intro: "I weave and code", portfolio: null },
      tracks: [{ id: "t1", title: "Loom exporter", isActive: true, items: [{ id: "i1", body: "WIF export" }] }],
      recent: [hit("m1", "jacquard drafts")],
      chunkCount: 3,
    });
    expect(text).toContain("[profile:p1] intro: I weave and code");
    expect(text).toContain("[track:t1] (active) Loom exporter");
    expect(text).toContain("[item:i1] WIF export");
    expect(text).toContain("[memory:m1]");
  });
});

describe("realtime tool definitions", () => {
  it("every track mutation requires the user's quote", () => {
    const defs = realtimeToolDefinitions();
    for (const d of defs.filter((d) => d.name.startsWith("track"))) {
      expect((d.parameters as { required: string[] }).required).toContain("user_quote");
    }
    expect(defs.map((d) => d.name)).toEqual(
      expect.arrayContaining(["track_create", "track_append", "track_switch", "track_item_move", "track_item_edit", "track_merge"]),
    );
  });
});
