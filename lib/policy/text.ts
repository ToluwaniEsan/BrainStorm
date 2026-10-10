const STOPWORDS = new Set(
  `a an the and or but if then so of to in on at by for with from into onto about as is are was were be been
  being it its this that these those i me my mine we our you your he she they them their his her
  do does did doing have has had having not no yes just really very also too can could would should
  will shall may might must okay ok um uh like yeah well actually basically kind sort thing things
  going gonna want wanna let lets get got there here what which who whom when where why how all any
  some more most other such only own same than out up down over under again further once`
    .split(/\s+/)
    .filter(Boolean),
);

export function normalizeToken(tok: string): string {
  let t = tok.toLowerCase();
  if (t.length > 5 && t.endsWith("ing")) t = t.slice(0, -3);
  else if (t.length > 4 && t.endsWith("ed")) t = t.slice(0, -2);
  else if (t.length > 4 && /(?:x|z|ch|sh)es$/.test(t)) t = t.slice(0, -2);
  else if (t.length > 3 && t.endsWith("s") && !t.endsWith("ss")) t = t.slice(0, -1);
  return t;
}

/** Lowercased, lightly stemmed content words (stopwords and very short words removed). */
export function contentTokens(text: string): string[] {
  const words = text.toLowerCase().match(/[a-z0-9][a-z0-9+#.-]*/g) ?? [];
  const out: string[] = [];
  for (const w of words) {
    const clean = w.replace(/[.-]+$/, "");
    if (clean.length < 3 || STOPWORDS.has(clean)) continue;
    out.push(normalizeToken(clean));
  }
  return out;
}

export function tokenSet(text: string): Set<string> {
  return new Set(contentTokens(text));
}

/** Fraction of `candidate`'s content tokens that also appear in `source`. */
export function coverage(candidate: string, source: string | Set<string>): number {
  const cand = tokenSet(candidate);
  if (cand.size === 0) return 0;
  const src = typeof source === "string" ? tokenSet(source) : source;
  let hit = 0;
  for (const t of cand) if (src.has(t)) hit++;
  return hit / cand.size;
}

/** Symmetric overlap (Jaccard) between two texts' content tokens. */
export function jaccard(a: string, b: string): number {
  const A = tokenSet(a);
  const B = tokenSet(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}
