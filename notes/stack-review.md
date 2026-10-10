# Stack review: user-grounded model (2026-10-10)

Review of the stack in [user-grounded-model.md](../knowledge/user-grounded-model.md). Overall the choices are sound and fit the product. The problems are a few concrete errors that would quietly break the isolation or live-voice promises, some missing pieces, and scope.

Items marked *(verify)* are from my knowledge of these services and should be confirmed with a quick spike or the current docs before building on them.

## 1. Errors to fix in the design

### 1a. The RLS "second check" won't fire as written
Postgres skips row-level security for a table's **owner** unless the table has `FORCE ROW LEVEL SECURITY`. If first-login provisioning creates each user's tables *as that user's role*, the role owns them and the RLS check in §7.5 does nothing.

Fix: have the migrator role own every table, grant the per-user role only `SELECT/INSERT/UPDATE/DELETE`, and run `ALTER TABLE … FORCE ROW LEVEL SECURITY` anyway.

The doc also never says where `<bound id>` in the policy comes from. Set it per transaction (`SET LOCAL app.user_id = '…'`) and write the policy as `USING (user_id = current_setting('app.user_id'))`.

### 1b. Gemini embeddings vs pgvector index limit
`gemini-embedding-001` returns 3072 dimensions by default. pgvector's HNSW/IVFFlat indexes on the `vector` type cap at 2000 dimensions *(verify)*. Request `output_dimensionality: 768` (or 1536) up front, or use `halfvec`. Pick this before the first migration, because changing it later means re-embedding everything.

### 1c. "Tracks update while I'm still talking" may not happen with Live function calling alone
The Live model usually takes its turn, including any function calls, when voice activity detection decides you paused. It doesn't act mid-sentence *(verify with a spike)*. So tracks would update per pause, not continuously.

Recommended shape:
- Keep Gemini Live for the conversation and its **input transcription** (partial transcripts).
- Run a separate fast text model (Gemini Flash) over a rolling window of those partials every few seconds. It emits the `track.*` events.

That gives the doc's "writing with you" feel, keeps track logic testable as plain text in and events out, and makes the batch fallback the same code path.

### 1d. Drizzle doesn't do migrations into N dynamic schemas
Drizzle's migration tooling targets a fixed schema. Write a small raw-SQL migrator: versioned `.sql` files, and a `schema_migrations` table per `user_<id>`, applied on first login and on deploy. Drizzle is still fine for queries once `search_path` is set.

## 2. Missing pieces

| Gap | Recommendation |
| --- | --- |
| Hosting | **Vercel** for Next.js. It works because of 2a below. |
| Gemini Live auth | **2a.** The browser can't hold the Gemini API key, and serverless can't hold a long WebSocket. Use Gemini **ephemeral tokens**: the server mints one per session after verifying Auth0, the browser connects to Live directly, and track/memory writes go back through your authenticated API *(verify current token API)*. |
| Live session limits | Audio sessions and connections have short caps (minutes) *(verify current numbers)*. Session resumption plus context-window compression is in the doc. Also show a visible "reconnecting" state. |
| File storage | Not chosen. Use **Supabase Storage**, accessed only server-side with the service key under `users/{id}/` (it doesn't need Supabase Auth). |
| File processing | No pipeline. Send PDFs and images to Gemini directly (it reads them natively) to get text and summaries, then chunk and embed. Start with PDF, image, txt/md. |
| Background work | Chunking, embedding and repo ingest need somewhere to run. For a hackathon, inline plus `waitUntil` on Vercel is enough; add a queue later. |
| Cost/abuse limits | None. Add per-user caps on Live minutes, Exa calls and ingest size. |
| No-ghost enforcement | The "post-checks" in §2 aren't specified. Simplest: require the model to output cited memory ids, and reject or regenerate any claim about the user that has none. |
| Adobe | Nothing in the stack uses Adobe. Sponsor tracks often reward use of the sponsor's tools (for example an Adobe Express add-on or Firefly for portfolio visuals). Worth checking the track rules. |

## 3. Things that are right and worth keeping
- Auth0 instead of Supabase Auth, with no supabase-js data layer. The doc already avoids the usual clash.
- `SET LOCAL` per transaction, which is the correct pattern for Supabase's transaction pooler.
- Exa gated behind the stuck/help signal, with find-similar seeded by the user's repos.
- RAG instead of fine-tuning.
- Schema-per-user is defensible and a good judging story ("each user literally owns their store"). It costs build time, not correctness.

## 4. Hackathon scope: suggested build order
1. Auth0 wall, schema provisioning, raw-SQL migrator, forced RLS (fix 1a).
2. Live voice with ephemeral tokens, input transcription, and the Flash track extractor feeding the notebook UI (fix 1c).
3. Memory writes, embeddings at 768 dims (fix 1b), and reflective questions with citations.
4. Public GitHub/link ingest.
5. Exa assisted search.
6. Files, account delete, and the full eval suite.

If time is short, cut per-user Postgres roles first: keep schema-per-user + `search_path` + forced RLS. Isolation is still enforced twice. That relaxes a locked decision, though, so it's the user's call.

Seed a demo account with real history. A fresh account shows almost nothing by design.
