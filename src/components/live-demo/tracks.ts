// Tracks the model builds while the user talks. Nothing here is saved yet:
// this is a test of how Grok splits speech into tracks.

export type Item = { id: string; text: string };
// summary: where their thinking on the track stands now, rewritten by the
// sorter as thoughts land. people: who else they said is there with them.
export type Track = { id: string; title: string; summary?: string; items: Item[] };
export type Board = { tracks: Track[]; active?: string; next: number; people?: string[] };

export const emptyBoard: Board = { tracks: [], next: 1 };

// Function tools in the xAI Responses API shape (plain JSON Schema).
type Tool = { type: "function"; name: string; description: string; parameters: Record<string, unknown> };

const summary = {
  type: "string",
  description:
    "1-2 sentences on where their thinking on this track stands now, covering all its thoughts, in their own terms (what they decided, what's still open, any conditions). Nothing they didn't say.",
};

const reason = {
  type: "string",
  description: "One short sentence: what in the user's words made you do this.",
};

export const trackTools: Tool[] = [
  {
    type: "function",
    name: "create_track",
    description:
      "Start a new track when the user begins talking about a topic no existing track covers. Title comes from the user's own words.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "2-5 words, in the user's own wording." },
        first_thought: { type: "string", description: "The point that started it, as a short summary (a few words to one line)." },
        more_thoughts: {
          type: "array",
          items: { type: "string" },
          description: "Any further points from the NEW words that belong in this new track, each a short summary.",
        },
        summary,
        reason,
      },
      required: ["title", "first_thought", "summary", "reason"],
    },
  },
  {
    type: "function",
    name: "add_to_track",
    description: "Add one thought the user just said to an existing track.",
    parameters: {
      type: "object",
      properties: {
        track_id: { type: "string" },
        thought: { type: "string", description: "Short summary of the point they made (a few words to one line). Never your own idea." },
        reason,
      },
      required: ["track_id", "thought", "reason"],
    },
  },
  {
    type: "function",
    name: "update_summary",
    description: "Rewrite a track's summary after its thoughts changed, so it reflects everything on the track now.",
    parameters: {
      type: "object",
      properties: { track_id: { type: "string" }, summary, reason },
      required: ["track_id", "summary", "reason"],
    },
  },
  {
    type: "function",
    name: "note_people",
    description:
      "The user says other people are with them or joining (\"Sam is here\", \"I'm presenting to the judges\", \"my teammate just joined\"). Records who is there.",
    parameters: {
      type: "object",
      properties: {
        people: {
          type: "array",
          items: { type: "string" },
          description: "Each person or group as they named them (\"Sam\", \"the judges\").",
        },
        reason,
      },
      required: ["people", "reason"],
    },
  },
  {
    type: "function",
    name: "switch_track",
    description:
      "The user came back to a topic an existing track already covers, in any wording (\"going back to auth...\", or just talking about that subject again). Makes that track active.",
    parameters: {
      type: "object",
      properties: { track_id: { type: "string" }, reason },
      required: ["track_id", "reason"],
    },
  },
  {
    type: "function",
    name: "move_thought",
    description: "A thought was filed under the wrong track; move it.",
    parameters: {
      type: "object",
      properties: { item_id: { type: "string" }, to_track_id: { type: "string" }, reason },
      required: ["item_id", "to_track_id", "reason"],
    },
  },
  {
    type: "function",
    name: "edit_thought",
    description: "The user corrected or refined something they said earlier; update that thought.",
    parameters: {
      type: "object",
      properties: { item_id: { type: "string" }, text: { type: "string" }, reason },
      required: ["item_id", "text", "reason"],
    },
  },
  {
    type: "function",
    name: "merge_tracks",
    description: "Only when the user says two tracks are really the same thing. Moves every thought into one track.",
    parameters: {
      type: "object",
      properties: { from_track_id: { type: "string" }, into_track_id: { type: "string" }, reason },
      required: ["from_track_id", "into_track_id", "reason"],
    },
  },
];

// For the text model that sorts the transcript into tracks.
export const trackPrompt = `You sort a person's think-out-loud speech into tracks (topics) while they talk.
You get the current tracks, what they said just before, and the NEW words. File only the NEW words, using the tools.

Rules:
- File the point, not the transcript. Each thought is a short summary of what they meant (a few words to one line, like a
  note someone would jot down), keeping their key terms and names. Drop filler, repetition and side remarks, and boil several sentences about the
  same point down to one thought. Keep real uncertainty or conditions short ("maybe X", "X if Y"): never turn a
  possibility into a decision.
- Never invent ideas, suggestions, features or inspiration. Summarise only what they said; add nothing of your own.
- Before you create a track, check EVERY existing track's title and summary, not just the active one. If the NEW words are
  about a subject any track already covers, even in different words or after a long detour, they are going back to it:
  switch_track to it, then add_to_track there. Only create_track for a subject no track covers.
- New topic: create_track (put every NEW thought for it in first_thought / more_thoughts, and give it a summary).
- Summaries: after you add, edit, move or merge thoughts on an existing track, call update_summary once for each track that
  changed, rewriting its summary to cover all its thoughts as they stand now. A track with no summary gets one the next time
  you touch it.
- Use move_thought / edit_thought when they correct themselves; merge_tracks only when they say two topics are the same.
- One idea per thought. If they repeat or rephrase a point already on a track, don't add it again (use edit_thought if
  they sharpened it). Skip filler ("um", "so yeah", "testing") and
  questions aimed at the assistant ("what do you think?").
- They may be presenting or demoing to other people. Keep filing the substance of what they say about their ideas or work;
  skip pure presentation patter ("let me show you", "as you can see", greetings).
- People: when they say someone is with them or joining, call note_people. When they relay or quote someone else's view,
  start that thought with the person's name ("Sam: launch on campus first").
- Every call needs a short "reason" quoting the cue in their speech.
- If the NEW words hold no real thought, make no calls (note_people and reply_to_user still apply).
- Also call reply_to_user when the NEW words turn to the assistant (named Clutter) for a response in any wording: "what do
  you think?", "do you feel me?", "right?", "does that make sense?", "be honest", "Clutter, ...", a question aimed at it,
  or asking it to say or do something ("say hi to the judges", "introduce yourself", "tell them what you do", "I want to
  show you off"). Not for rhetorical questions they're asking themselves, and not when they only mention Clutter while
  talking to someone else about it.`;

// Not a track change: tells the page the user wants Clutter to answer.
export const replyTool: Tool = {
  type: "function",
  name: "reply_to_user",
  description: "The user just turned to the assistant (Clutter) for a response, an opinion, or to say or do something.",
  parameters: { type: "object", properties: { reason }, required: ["reason"] },
};

type Args = Record<string, unknown>;
const str = (a: Args, k: string) => (typeof a[k] === "string" ? (a[k] as string).trim() : "");

// Applies one tool call. Returns the new board plus the response sent back
// to the model (always includes the current track list so it knows the ids).
export function applyTool(board: Board, name: string, args: Args): { board: Board; result: Record<string, unknown> } {
  let b: Board = { ...board, tracks: board.tracks.map((t) => ({ ...t, items: [...t.items] })) };
  const track = (id: string) => b.tracks.find((t) => t.id === id);
  const findItem = (id: string) => {
    for (const t of b.tracks) {
      const i = t.items.findIndex((x) => x.id === id);
      if (i >= 0) return { t, i };
    }
  };
  const newId = (p: string) => `${p}${b.next++}`;
  let error: string | undefined;
  let created: Record<string, string> = {};

  switch (name) {
    case "create_track": {
      const id = newId("t");
      const itemId = newId("i");
      const more = Array.isArray(args.more_thoughts) ? args.more_thoughts.filter((t): t is string => typeof t === "string" && !!t.trim()) : [];
      b.tracks.push({
        id,
        title: str(args, "title") || "Untitled",
        summary: str(args, "summary") || undefined,
        items: [{ id: itemId, text: str(args, "first_thought") }, ...more.map((t) => ({ id: newId("i"), text: t.trim() }))],
      });
      b.active = id;
      created = { track_id: id, item_id: itemId };
      break;
    }
    case "add_to_track": {
      const t = track(str(args, "track_id"));
      if (!t) error = "Unknown track_id";
      else {
        const itemId = newId("i");
        t.items.push({ id: itemId, text: str(args, "thought") });
        b.active = t.id;
        created = { item_id: itemId };
      }
      break;
    }
    case "update_summary": {
      const t = track(str(args, "track_id"));
      if (!t) error = "Unknown track_id";
      else t.summary = str(args, "summary") || t.summary;
      break;
    }
    case "note_people": {
      const named = Array.isArray(args.people) ? args.people.filter((p): p is string => typeof p === "string" && !!p.trim()).map((p) => p.trim()) : [];
      if (!named.length) error = "people must list at least one name";
      else {
        const known = b.people ?? [];
        b.people = [...known, ...named.filter((p) => !known.some((k) => k.toLowerCase() === p.toLowerCase()))];
      }
      break;
    }
    case "switch_track": {
      const t = track(str(args, "track_id"));
      if (!t) error = "Unknown track_id";
      else b.active = t.id;
      break;
    }
    case "move_thought": {
      const found = findItem(str(args, "item_id"));
      const to = track(str(args, "to_track_id"));
      if (!found || !to) error = "Unknown item_id or to_track_id";
      else to.items.push(...found.t.items.splice(found.i, 1));
      break;
    }
    case "edit_thought": {
      const found = findItem(str(args, "item_id"));
      if (!found) error = "Unknown item_id";
      else found.t.items[found.i] = { ...found.t.items[found.i], text: str(args, "text") };
      break;
    }
    case "merge_tracks": {
      const from = track(str(args, "from_track_id"));
      const into = track(str(args, "into_track_id"));
      if (!from || !into || from === into) error = "Need two different, existing track ids";
      else {
        into.items.push(...from.items);
        b = { ...b, tracks: b.tracks.filter((t) => t !== from), active: into.id };
      }
      break;
    }
    default:
      error = `Unknown tool ${name}`;
  }

  const tracks = (error ? board : b).tracks.map((t) => ({
    track_id: t.id,
    title: t.title,
    summary: t.summary ?? "",
    items: t.items.map((i) => ({ item_id: i.id, text: i.text })),
  }));
  return { board: error ? board : b, result: error ? { ok: false, error, tracks } : { ok: true, ...created, tracks } };
}
