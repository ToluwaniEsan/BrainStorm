# Gemini integration: prompt and steps (2026-10-10)

Built from [stack-by-feature.md](stack-by-feature.md), [stack-review.md](stack-review.md) and [user-grounded-model.md](../knowledge/user-grounded-model.md), checked against the Gemini API docs on 2026-10-10.

**Model names in the docs are inconsistent right now.** The models page lists `gemini-3.8-live` (voice), `gemini-3.8-flash`, `gemini-3.1-pro-preview` and `gemini-embedding-001`. The Live and tools pages still show older preview models, and one says async (non-blocking) function calls aren't supported on every Live model. Confirm on the models page and in AI Studio before hard-coding anything, and keep model ids in env vars.

---

## Part 1: prompt to paste into Gemini

```
I'm building a web app called BrainStorm for a hackathon (Adobe creative track) and I want you to guide me step by step through the Gemini integration. Please use the current Gemini API and the @google/genai JavaScript SDK, and tell me if anything I describe is outdated or won't work.

WHAT THE APP IS
A personal thinking and project tool for creatives. The user talks out loud in a "Deep Thinking" mode, and while they speak their thoughts are split into visible "tracks" (lanes/themes, like columns in a notebook). The AI asks short reflective questions based ONLY on the user's own stored history. It never invents ideas, suggestions or inspiration ("no ghost data" policy).

STACK (already decided)
- Next.js (App Router) + TypeScript, hosted on Vercel
- Auth0 for sign-in (@auth0/nextjs-auth0); every API route checks the session
- Postgres with pgvector, one schema per user plus row-level security keyed to the Auth0 user id. Provider may change, so keep Gemini code independent of the database.
- Gemini for everything AI: Live API (voice), text models, embeddings

WHAT I NEED FROM GEMINI
1. Live voice (Deep Thinking)
   - Browser mic via getUserMedia + AudioWorklet producing 16 kHz 16-bit PCM, streamed to the Gemini Live API.
   - The browser connects to Live DIRECTLY. My Vercel server never sees audio and never gives the API key to the browser. The server checks Auth0, then mints a short-lived EPHEMERAL TOKEN (authTokens.create, with liveConnectConstraints locking model, system instruction and tools on the server side).
   - Input audio transcription on, so I get partial transcripts while the user is talking.
   - The Live model replies by voice with brief reflective questions only.
   - Session resumption (sessionResumption handle, handle goAway) and contextWindowCompression with a sliding window, so a session can run past the ~10 minute connection limit, with a visible "reconnecting" state.
   - Audio is NEVER stored on any server. Only the transcription is used.

2. Tracks
   - Track events: track.create, track.append, track.switch, track_item.move, track_item.edit, track.merge.
   - Plan A: a separate fast text model (Gemini Flash) runs every few seconds over the rolling transcript window plus current tracks, and returns those events as structured JSON (responseSchema). My API route saves them and returns them to the UI.
   - Plan B / optional: Live function calling (functionDeclarations, toolCall, sendToolResponse) for the same events, ideally NON_BLOCKING so the conversation doesn't pause. Tell me which current Live models support that.
   - Track titles must come from the user's own words. Prefer an existing track over a near-duplicate; if unsure, ask "Are you back on X?".

3. Memory and embeddings
   - gemini-embedding-001 (or current equivalent) with outputDimensionality 768 so it fits a pgvector HNSW index. Normalize vectors if the docs say I must at reduced dimensions.
   - Every track, reflection, file and link is chunked, embedded and stored with provenance.

4. Reflective questions (no-ghost)
   - Gemini text (Pro for deep turns, Flash for quick ones) with structured output where every claim about the user must include the memory ids it came from. My server rejects or regenerates any uncited claim.
   - If memory is empty, the AI does not suggest ideas; it invites the user to introduce themselves or start a session.

5. Files and links
   - Send PDFs and images straight to Gemini for text and descriptions; Gemini vision on Adobe Creative Cloud asset thumbnails.

HOW I WANT YOU TO HELP
- Go one step at a time, in this order: (a) API key + SDK setup and a hello-world text call from a Next.js route, (b) ephemeral token route, (c) browser Live connection with mic streaming and input transcription, (d) session resumption + compression, (e) Flash track extractor with JSON schema, (f) embeddings, (g) reflective questions with citations, (h) file/image understanding.
- For each step give me: the exact current model id, the files to create, the code, and how to test it before moving on.
- Point out rate limits, session limits, pricing traps and anything that only works in preview or on certain models.
- Don't change the stack or suggest other AI providers. Ask me before assuming anything about my database.
```

---

## Part 2: steps

Each step ends with something you can test before moving on.

### A. Setup
1. Create a Gemini API key in Google AI Studio. Put it in `.env.local` as `GEMINI_API_KEY` and in Vercel env vars. Never prefix it with `NEXT_PUBLIC_`.
2. `npm i @google/genai`. Add env vars for model ids: `GEMINI_LIVE_MODEL`, `GEMINI_FLASH_MODEL`, `GEMINI_PRO_MODEL`, `GEMINI_EMBED_MODEL`.
3. Make `lib/gemini.ts` that creates one server-side `GoogleGenAI` client.
4. Test: a protected route `/api/ai/ping` that checks Auth0 and returns a one-line Flash response.

### B. Ephemeral token route
5. `POST /api/live/token`: verify the Auth0 session, apply a per-user rate limit, then `client.authTokens.create({ config: { uses: 1, expireTime, newSessionExpireTime, liveConnectConstraints: { model, config } } })`. Put the system instruction (reflective-only, no ghost ideas), transcription, resumption and compression settings inside the constraints so the browser can't change them.
6. Return only `token.name`. Test: signed-out request gets 401; signed-in gets a token.

### C. Live voice in the browser
7. Mic capture: `getUserMedia` → `AudioWorklet` that downsamples to 16 kHz mono 16-bit PCM, base64 chunks.
8. `new GoogleGenAI({ apiKey: token.name })` in the browser, then `ai.live.connect({ model, config, callbacks })` and stream chunks with `session.sendRealtimeInput({ audio: { data, mimeType: 'audio/pcm;rate=16000' } })`.
9. Turn on input transcription and show partial text live on screen. Play the model's audio replies (24 kHz PCM out) through Web Audio.
10. Test: talk for a minute; text appears as you speak and the model asks a short question when you pause.

### D. Long sessions
11. Store the latest `sessionResumptionUpdate.newHandle` when `resumable` is true. On `goAway` or close, fetch a new token and reconnect with `sessionResumption: { handle }`. Show "reconnecting".
12. Enable `contextWindowCompression: { slidingWindow: {} }`.
13. Test: a 15+ minute session survives at least one reconnect without losing tracks.

### E. Track builder
14. Define the track event JSON schema (create, append, switch, move, edit, merge) in one shared TypeScript file.
15. `POST /api/tracks`: input is the last ~30–60 s of transcript, the current tracks and the session id. Call Flash with `responseMimeType: 'application/json'` and `responseSchema`. Validate (e.g. zod), save, return events.
16. Browser calls it every few seconds while speech is coming in, and applies events to the notebook UI.
17. Add switch detection: speech cues in the prompt, plus embedding similarity against existing track titles (step F).
18. Test with fixed transcripts (unit tests): topic switches, coming back to an old track, no near-duplicate tracks.
19. Optional: try Live function calling for the same events in a spike. Only keep it if the chosen Live model supports non-blocking calls and it updates fast enough.

### F. Embeddings and memory
20. `lib/embed.ts`: `embedContent` with `outputDimensionality: 768`; normalize. Decide this before the first migration (changing later means re-embedding everything).
21. Embed every saved track item, reflection, file chunk and link chunk with provenance. Run it after the response with Vercel `waitUntil`.
22. Retrieval helper: top-k by cosine similarity inside the user's own schema only. Keep it behind one interface so the database choice doesn't touch Gemini code.
23. Test: two users' data never shows up in each other's retrieval.

### G. Reflective questions (no-ghost)
24. `POST /api/reflect`: retrieve memory, then Pro (or Flash) with structured output `{ question, claims: [{ text, memory_ids[] }] }`.
25. Server check: drop or regenerate any claim with no valid memory id from this user. Empty memory returns an invite, never an idea.
26. Feed the latest grounded memory into the Live session as context so its spoken questions are grounded too.
27. Test with the design doc §8 traps: "give me an idea" with empty memory must not invent anything.

### H. Files, images, Adobe
28. PDFs and images straight to Gemini (inline data or the Files API for big ones) for text plus a short description; then chunk and embed (step F).
29. Gemini vision on Adobe CC asset thumbnails once the Adobe connection exists.

### I. Guardrails before demo
30. Per-user caps on Live minutes and calls (Upstash). Log token usage.
31. Fallback: if Live fails, browser Web Speech API feeds the same `/api/tracks` route, labeled degraded.
32. Run the eval script (fabrication trap, isolation, signed-out 401, live-track timing).

## Things to verify as you go
- Current Live model id and whether it supports non-blocking function calls.
- Exact transcription config field name in the current SDK (`inputAudioTranscription`).
- Ephemeral tokens need the `v1beta` API; check the SDK default.
- Whether reduced-dimension embeddings need manual normalization.
- Free-tier rate limits on Live sessions for the demo.
