// Confirms XAI_API_KEY and XAI_FAST_MODEL in .env.local work.
// Usage: npm run check:xai
const apiKey = process.env.XAI_API_KEY;
const model = process.env.XAI_FAST_MODEL;
if (!apiKey || !model) {
  console.error("Set XAI_API_KEY and XAI_FAST_MODEL in .env.local first (see .env.example).");
  process.exit(1);
}

try {
  const res = await fetch("https://api.x.ai/v1/responses", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ model, input: [{ role: "user", content: "Reply with the single word: ok" }] }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(body).slice(0, 300)}`);
  const text =
    body.output_text ??
    (body.output ?? []).flatMap((o) => o.content ?? []).map((c) => c.text ?? "").join("");
  console.log(`xAI key works. ${model} replied: ${String(text).trim()}`);
} catch (err) {
  console.error(`xAI call failed: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}
