// Confirms EXA_API_KEY in .env.local works with one tiny search.
// Usage: npm run check:exa
const apiKey = process.env.EXA_API_KEY;
if (!apiKey) {
  console.error("Set EXA_API_KEY in .env.local first (see .env.example).");
  process.exit(1);
}

try {
  const res = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey },
    body: JSON.stringify({ query: "Adobe creative tools", numResults: 1 }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const { results } = await res.json();
  console.log(`Exa key works. Top result: ${results?.[0]?.url ?? "(none)"}`);
} catch (err) {
  console.error(`Exa call failed: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}
