import { Type, type FunctionDeclaration } from "@google/genai";

// Tracks the model builds while the user talks. Nothing here is saved yet:
// this is a test of how Gemini Live splits speech into tracks.

export type Item = { id: string; text: string };
export type Track = { id: string; title: string; items: Item[] };
export type Board = { tracks: Track[]; active?: string; next: number };

export const emptyBoard: Board = { tracks: [], next: 1 };

const reason = {
  type: Type.STRING,
  description: "One short sentence: what in the user's words made you do this.",
};

export const trackTools: FunctionDeclaration[] = [
  {
    name: "create_track",
    description:
      "Start a new track when the user begins talking about a topic no existing track covers. Title comes from the user's own words.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING, description: "2-5 words, in the user's own wording." },
        first_thought: { type: Type.STRING, description: "The thought that started it, quoted or tightly paraphrased." },
        reason,
      },
      required: ["title", "first_thought", "reason"],
    },
  },
  {
    name: "add_to_track",
    description: "Add one thought the user just said to an existing track.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        track_id: { type: Type.STRING },
        thought: { type: Type.STRING, description: "Quote or tight paraphrase of what the user said. Never your own idea." },
        reason,
      },
      required: ["track_id", "thought", "reason"],
    },
  },
  {
    name: "switch_track",
    description: "The user went back to an earlier topic (e.g. 'going back to auth...'). Makes that track active.",
    parameters: {
      type: Type.OBJECT,
      properties: { track_id: { type: Type.STRING }, reason },
      required: ["track_id", "reason"],
    },
  },
  {
    name: "move_thought",
    description: "A thought was filed under the wrong track; move it.",
    parameters: {
      type: Type.OBJECT,
      properties: { item_id: { type: Type.STRING }, to_track_id: { type: Type.STRING }, reason },
      required: ["item_id", "to_track_id", "reason"],
    },
  },
  {
    name: "edit_thought",
    description: "The user corrected or refined something they said earlier; update that thought.",
    parameters: {
      type: Type.OBJECT,
      properties: { item_id: { type: Type.STRING }, text: { type: Type.STRING }, reason },
      required: ["item_id", "text", "reason"],
    },
  },
  {
    name: "merge_tracks",
    description: "Only when the user says two tracks are really the same thing. Moves every thought into one track.",
    parameters: {
      type: Type.OBJECT,
      properties: { from_track_id: { type: Type.STRING }, into_track_id: { type: Type.STRING }, reason },
      required: ["from_track_id", "into_track_id", "reason"],
    },
  },
];

export const systemInstruction = `You are BrainStorm's Deep Thinking listener. The user is thinking out loud.
Your job is to organise what THEY say into tracks (topics) using the tools, while they talk.

Rules:
- Never invent ideas, suggestions, features or inspiration. Only file the user's own words (quote or tight paraphrase).
- When a new topic starts, call create_track. When they add to a topic, call add_to_track on that track.
- Prefer an existing track over a near-duplicate. If they return to an earlier topic, call switch_track first.
- Use move_thought / edit_thought when they correct themselves; merge_tracks only when they say two topics are the same.
- Every tool call needs a short "reason" quoting the cue in their speech.
- Speak very little. A short acknowledgement is fine. If unsure which track they mean, ask one short question like "Are you back on <track>?".
- Do not answer with your own opinions or ideas unless the user directly asks you a question; then answer briefly.`;

type Args = Record<string, unknown>;
const str = (a: Args, k: string) => (typeof a[k] === "string" ? (a[k] as string).trim() : "");

// Applies one tool call. Returns the new board plus the response sent back
// to Gemini (always includes the current track list so it knows the ids).
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
      b.tracks.push({ id, title: str(args, "title") || "Untitled", items: [{ id: itemId, text: str(args, "first_thought") }] });
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
    items: t.items.map((i) => ({ item_id: i.id, text: i.text })),
  }));
  return { board: error ? board : b, result: error ? { ok: false, error, tracks } : { ok: true, ...created, tracks } };
}
