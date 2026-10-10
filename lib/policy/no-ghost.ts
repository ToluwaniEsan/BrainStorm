import type { MemoryHit } from "@/lib/memory/retrieval";
import { contentTokens, coverage, jaccard, tokenSet } from "./text";

export const EMPTY_MEMORY_REFUSAL =
  "I don't have anything saved about you yet. Tell me how you'd introduce yourself or your work, " +
  "or add a repo/link, and I'll remember that—I won't invent a starting point or search the web for you.";

export const THIN_MEMORY_SEARCH_REFUSAL =
  "I can only look things up near work you've already told me about, and I don't have enough of that yet " +
  "for this topic. Describe what you've tried so far or add a repo/link, and I'll search from there.";

/* ---------------------------------------------------------------- grounding */

/**
 * True when `candidate` (a track title / item body / quote) is attributable to
 * what the user actually said. Track content may paraphrase but must reuse
 * their words, not model priors.
 */
export function isGroundedInSpeech(candidate: string, heard: string[], minCoverage = 0.6): boolean {
  const source = tokenSet(heard.join(" \n "));
  if (source.size === 0) return false;
  if (contentTokens(candidate).length === 0) return false;
  return coverage(candidate, source) >= minCoverage;
}

/* ------------------------------------------------------- assisted search gate */

const STUCK_PATTERNS: RegExp[] = [
  /\bi(?:'m| am) (?:really |kind of |kinda |so )?stuck\b/i,
  /\bstuck on\b/i,
  /\bi(?:'m| am) (?:blocked|lost)\b/i,
  /\bblocked on\b/i,
  /\bi (?:don't|do not|dont) know how to\b/i,
  /\bi can(?:'t|not) figure out\b/i,
  /\bhit a wall\b/i,
];

const EXPLICIT_HELP_PATTERNS: RegExp[] = [
  /\b(?:search|look up|google)\b(?: for| up)?/i,
  /\bfind (?:me )?(?:some )?(?:examples?|docs|documentation|references?|resources?)\b/i,
  /\bhelp me find\b/i,
  /\bcan you (?:look|search)\b/i,
];

/** Vague creative asks never unlock browsing (§5.4: no proactive browse). */
const NOT_A_SIGNAL: RegExp[] = [
  /\binspire me\b/i,
  /\bgive me (?:some )?ideas\b/i,
  /\bwhat should i (?:build|make|do)\b/i,
  /\bsurprise me\b/i,
];

export type HelpSignal = { kind: "stuck" | "explicit_help"; matched: string } | null;

export function detectHelpSignal(utterance: string): HelpSignal {
  const text = utterance.trim();
  if (!text) return null;
  if (NOT_A_SIGNAL.some((re) => re.test(text)) && !STUCK_PATTERNS.some((re) => re.test(text))) return null;
  for (const re of STUCK_PATTERNS) {
    const m = text.match(re);
    if (m) return { kind: "stuck", matched: m[0] };
  }
  for (const re of EXPLICIT_HELP_PATTERNS) {
    const m = text.match(re);
    if (m) return { kind: "explicit_help", matched: m[0] };
  }
  return null;
}

export type SearchGate =
  | { allowed: true; signal: NonNullable<HelpSignal>; memory: MemoryHit[] }
  | { allowed: false; reason: "no_help_signal" | "thin_memory"; message?: string };

/** Personal history only; assisted-search rows never condition another search. */
const CONDITIONING_SOURCES = new Set(["chat", "audio", "realtime", "file", "ui", "link", "github"]);

export function gateAssistedSearch(input: {
  utterance: string;
  memory: MemoryHit[];
  minMemoryHits?: number;
}): SearchGate {
  const signal = detectHelpSignal(input.utterance);
  if (!signal) return { allowed: false, reason: "no_help_signal" };
  const usable = input.memory.filter((m) => CONDITIONING_SOURCES.has(m.sourceType));
  if (usable.length < (input.minMemoryHits ?? 1)) {
    return { allowed: false, reason: "thin_memory", message: THIN_MEMORY_SEARCH_REFUSAL };
  }
  return { allowed: true, signal, memory: usable };
}

/**
 * Builds the web query from the user's own terms: the stuck sub-problem plus
 * the most frequent content words in the memory that conditioned it.
 */
export function buildConditionedQuery(
  topic: string,
  memory: MemoryHit[],
  maxMemoryTerms = 6,
): { query: string; memoryIds: string[]; terms: string[] } {
  const topicTerms = [...new Set(contentTokens(topic))].slice(0, 8);
  const freq = new Map<string, number>();
  for (const hit of memory) {
    for (const t of new Set(contentTokens(hit.content))) freq.set(t, (freq.get(t) ?? 0) + 1);
  }
  const memoryTerms = [...freq.entries()]
    .filter(([t]) => !topicTerms.includes(t))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, maxMemoryTerms)
    .map(([t]) => t);
  const terms = [...topicTerms, ...memoryTerms];
  return { query: terms.join(" "), memoryIds: memory.map((m) => m.id), terms };
}

export interface RawSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface VicinityResult extends RawSearchResult {
  relatedMemoryIds: string[];
  sharedTerms: string[];
  vicinity: number;
}

const LISTICLE_RE = /\b(?:top|best)\s+\d+\b|\b\d+\s+(?:ideas|ways|tips|tricks)\b|\bideas for\b/i;

/** Keeps only results that share concrete terms with the user's past work. */
export function filterByVicinity(
  results: RawSearchResult[],
  memory: MemoryHit[],
  opts: { minShared?: number; max?: number } = {},
): VicinityResult[] {
  const minShared = opts.minShared ?? 2;
  const memTokens = memory.map((m) => ({ id: m.id, tokens: tokenSet(m.content) }));
  const kept: VicinityResult[] = [];
  for (const r of results) {
    if (!/^https?:\/\//i.test(r.url)) continue;
    if (LISTICLE_RE.test(r.title)) continue;
    const rTokens = tokenSet(`${r.title} ${r.snippet}`);
    const shared = new Set<string>();
    const related: string[] = [];
    for (const m of memTokens) {
      let n = 0;
      for (const t of rTokens) {
        if (m.tokens.has(t)) {
          shared.add(t);
          n++;
        }
      }
      if (n > 0) related.push(m.id);
    }
    if (shared.size < minShared || related.length === 0) continue;
    kept.push({ ...r, relatedMemoryIds: related, sharedTerms: [...shared].sort(), vicinity: shared.size / Math.max(rTokens.size, 1) });
  }
  return kept.sort((a, b) => b.sharedTerms.length - a.sharedTerms.length).slice(0, opts.max ?? 5);
}

/* ---------------------------------------------------------- track switching */

const SWITCH_CUES: RegExp[] = [
  /\b(?:going|go|get|getting|coming|come) back to\b/i,
  /\bback to (?:the )?\b/i,
  /\breturning to\b/i,
  /\banyway,? (?:about|on)\b/i,
  /\bon the [\w\s-]{1,40}? (?:part|lane|track|side|piece)\b/i,
  /\bswitch(?:ing)? (?:to|over to)\b/i,
];

export interface TrackLike {
  id: string;
  title: string;
  isActive?: boolean;
  items?: Array<{ body: string }>;
}

export type SwitchDecision =
  | { action: "switch"; trackId: string; reason: "speech_cue" | "semantic"; score: number }
  | { action: "stay" }
  | { action: "ask"; trackId: string; question: string };

function trackScore(utterance: string, t: TrackLike): number {
  const titleCov = coverage(t.title, utterance);
  const body = [t.title, ...(t.items ?? []).map((i) => i.body)].join(" ");
  return Math.max(titleCov, jaccard(utterance, body) * 2);
}

/**
 * Speech-cue + lexical-continuity switch detection over *existing* tracks.
 * Never proposes a new track; ambiguous cases become a one-beat question.
 */
export function detectTrackSwitch(utterance: string, tracks: TrackLike[]): SwitchDecision {
  if (tracks.length === 0) return { action: "stay" };
  const cue = SWITCH_CUES.some((re) => re.test(utterance));
  const scored = tracks
    .map((t) => ({ t, score: trackScore(utterance, t) }))
    .sort((a, b) => b.score - a.score);
  const best = scored[0];
  const runnerUp = scored[1]?.score ?? 0;
  if (best.t.isActive) return { action: "stay" };
  if (cue && best.score >= 0.5) return { action: "switch", trackId: best.t.id, reason: "speech_cue", score: best.score };
  if (cue && best.score > 0) {
    return { action: "ask", trackId: best.t.id, question: `Are you back on "${best.t.title}"?` };
  }
  if (!cue && best.score >= 0.75 && best.score - runnerUp >= 0.25) {
    return { action: "switch", trackId: best.t.id, reason: "semantic", score: best.score };
  }
  return { action: "stay" };
}

/** Existing track that a "new" title duplicates, if any (prefer existing over near-duplicates). */
export function findDuplicateTrack(title: string, tracks: TrackLike[]): TrackLike | null {
  let best: TrackLike | null = null;
  let bestScore = 0;
  for (const t of tracks) {
    const s = Math.max(jaccard(title, t.title), Math.min(coverage(title, t.title), coverage(t.title, title)));
    if (s > bestScore) {
      best = t;
      bestScore = s;
    }
  }
  return bestScore >= 0.6 ? best : null;
}

/* ------------------------------------------------------------ output checks */

const GENERIC_IDEA_PATTERNS: RegExp[] = [
  /\bwhat if you tried\b/i,
  /\bhere are (?:some|a few) ideas\b/i,
  /\byou could (?:also )?(?:build|make|try)\b/i,
  /\bcreative warm-?up\b/i,
  /\btrending\b/i,
  /\bhow about (?:building|making)\b/i,
];

/** Post-check for assistant text: flags generic idea-pack phrasing (§8 regression n-grams). */
export function findGhostPhrases(text: string): string[] {
  return GENERIC_IDEA_PATTERNS.filter((re) => re.test(text)).map((re) => re.source);
}
