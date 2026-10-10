import { z } from "zod";

const quote = z
  .string()
  .min(1)
  .max(2000)
  .describe("The user's exact recent words that justify this action. Required; never paraphrase the model's own ideas.");

export const toolSchemas = {
  track_create: z.object({
    title: z.string().min(1).max(120).describe("Short track title taken from the user's words."),
    first_item: z.string().max(2000).optional().describe("Optional first item, in the user's words."),
    user_quote: quote,
  }),
  track_append: z.object({
    body: z.string().min(1).max(2000).describe("The thought to add, quoting or tightly paraphrasing the user."),
    track_id: z.uuid().optional().describe("Target track; defaults to the active track."),
    user_quote: quote,
  }),
  track_switch: z.object({
    track_id: z.uuid().describe("Existing track the user returned to."),
    user_quote: quote,
  }),
  track_item_move: z.object({
    item_id: z.uuid(),
    to_track_id: z.uuid(),
    user_quote: quote,
  }),
  track_item_edit: z.object({
    item_id: z.uuid(),
    body: z.string().min(1).max(2000).describe("Revised text, from the user's correction/elaboration."),
    user_quote: quote,
  }),
  track_merge: z.object({
    source_track_id: z.uuid(),
    target_track_id: z.uuid(),
    user_quote: quote.describe("The user's words explicitly treating the two tracks as one."),
  }),
  memory_search: z.object({
    query: z.string().min(1).max(500).describe("What to recall from this user's own saved memory."),
  }),
  assisted_search: z.object({
    user_quote: quote.describe("The user's exact words saying they are stuck or asking you to look something up."),
    topic: z.string().min(1).max(300).describe("The specific sub-problem, in the user's terms."),
  }),
} as const;

export type ToolName = keyof typeof toolSchemas;
export const TOOL_NAMES = Object.keys(toolSchemas) as ToolName[];

const DESCRIPTIONS: Record<ToolName, string> = {
  track_create: "Create a new visible track for a theme the user just introduced that no existing track covers.",
  track_append: "Append a thought the user just said to the active (or given) track.",
  track_switch: "The user returned to an existing track; make it active so new items go there.",
  track_item_move: "Move an item to another track because the user re-filed that thought.",
  track_item_edit: "Revise an item because the user corrected or elaborated the same thought.",
  track_merge: "Merge two tracks ONLY when the user explicitly says they are the same thing.",
  memory_search: "Retrieve this user's own saved memory (profile, tracks, transcripts, linked repos).",
  assisted_search:
    "Grounded web lookup. ONLY when the user says they are stuck or explicitly asks you to search. Query is built from their past work.",
};

/** Function-tool definitions for the OpenAI Realtime session. */
export function realtimeToolDefinitions() {
  return TOOL_NAMES.map((name) => {
    const { $schema: _schema, ...parameters } = z.toJSONSchema(toolSchemas[name]) as Record<string, unknown>;
    void _schema;
    return { type: "function" as const, name, description: DESCRIPTIONS[name], parameters };
  });
}
