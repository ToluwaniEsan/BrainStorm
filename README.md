# BrainStorm

A live voice thinking partner for the Hacklanta Adobe creative track. You talk; it breaks your thoughts into **tracks** that update as you speak, and it only ever draws on **your own** stored history. It does not invent ideas, there is no shared memory pool, and nothing is stored or read without an Auth0 sign-in.

This is the backend-first scaffold. The UI is deliberately minimal (sign in, start a live session, watch tracks update, add a GitHub repo, delete account).

## Stack

| Concern | Choice |
| --- | --- |
| App | Next.js 16 (App Router, TypeScript), `proxy.ts` for Auth0 |
| Auth | Auth0 via `@auth0/nextjs-auth0` v4; GitHub social login through Auth0 (`/auth/login?connection=github`) |
| Data | Postgres 16 + pgvector, raw SQL with `pg` |
| Isolation | Schema-per-user + per-user Postgres role + `user_id` RLS as a second check |
| Live voice | OpenAI Realtime over WebRTC with a server-minted ephemeral client secret |
| Embeddings | OpenAI `text-embedding-3-small` (1536 dims); deterministic hashing embedder in tests / when no key |
| Assisted search | Provider interface + Tavily implementation, behind the no-ghost gate |
| Tests | Vitest against a real Postgres |

## Setup

### 1. Postgres + pgvector

The app must connect as a **non-superuser** role with `CREATEROLE` that owns the database, because it creates one role and one schema per user. A superuser would bypass the grants the isolation model relies on.

Ubuntu/Debian:

```bash
sudo apt-get install -y postgresql postgresql-16-pgvector
sudo -u postgres psql <<'SQL'
CREATE ROLE brainstorm LOGIN PASSWORD 'brainstorm' CREATEROLE;
CREATE DATABASE brainstorm OWNER brainstorm;
CREATE DATABASE brainstorm_test OWNER brainstorm;
\c brainstorm
CREATE EXTENSION IF NOT EXISTS vector;
\c brainstorm_test
CREATE EXTENSION IF NOT EXISTS vector;
SQL
```

Docker alternative: `docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres pgvector/pgvector:pg16`, then run the same SQL as `postgres`.

### 2. Auth0

1. Create a **Regular Web Application**.
2. Allowed Callback URLs: `http://localhost:3000/auth/callback`. Allowed Logout URLs: `http://localhost:3000`.
3. Optional: enable **Authentication → Social → GitHub** and turn it on for the app.

### 3. Environment

```bash
cp .env.example .env.local   # fill in Auth0, DATABASE_URL, OPENAI_API_KEY, optionally SEARCH_API_KEY
npm install
npm run db:migrate           # control-plane schema (also runs automatically on server start)
npm run dev
```

### 4. Checks

```bash
npm run lint
npm run typecheck
npm test        # needs TEST_DATABASE_URL (defaults to postgres://brainstorm:brainstorm@localhost:5432/brainstorm_test)
```

CI (`.github/workflows/ci.yml`) runs the same three checks against a `pgvector/pgvector:pg16` service.

## How isolation works

```
Auth0 session cookie (verified + decrypted by the SDK)
  → resolveUserContext(): validate sub, reject tombstoned sessions
  → app.users: sub → { id, schema user_<hex>, role user_<hex>_rw }   (provisioned on first login, empty)
  → withUserDb(): BEGIN; SET LOCAL ROLE user_<hex>_rw;
                  search_path = user_<hex>, public; app.user_id = <id>
  → queries run with only that role's grants + RLS (user_id = app.user_id)
  → COMMIT; DISCARD ALL before the connection returns to the pool
```

- The `app` schema (the sub-to-schema map and tombstones) is not readable by any per-user role.
- Each user schema is owned by the admin role. The user role gets `USAGE` plus `SELECT/INSERT/UPDATE/DELETE` on its own tables only, with no `CREATE` anywhere.
- Every table has `user_id` with `FORCE ROW LEVEL SECURITY`. An unset `app.user_id` matches nothing, so it fails closed.
- Every query also filters `user_id = $ctx.userId`. Ids from the client or the model are only looked up inside the caller's schema.
- Schema and role names are checked against strict regexes before they are interpolated into SQL.
- Account delete (`DELETE /api/account`) runs `DROP SCHEMA … CASCADE` (rows, vectors, HNSW index), then `DROP ROLE`, removes the mapping, and writes a tombstone. Sessions issued before the tombstone get `401 session_revoked`; signing in again gets a fresh, empty store.

**Known limit:** `SET LOCAL ROLE` guards against mistakes in our own query code (a missing filter, the wrong schema, a stale context). It is not a boundary against arbitrary injected SQL. Postgres lets the pool's login role switch to any role it is a member of, so injected SQL could run `SET ROLE` / `RESET ROLE`. All SQL here is parameterized. If we need stronger separation later, the options are per-user LOGIN credentials or separate databases (option (c) in the model doc).

## Live session flow

1. `POST /api/realtime/session`: authed. Creates a `realtime_sessions` row in the user's schema, loads that user's memory pack (profile, existing tracks, recent chunks), builds no-ghost instructions, and mints an OpenAI Realtime client secret (10 min) with the track tools. The standard API key never reaches the browser.
2. The browser opens WebRTC to OpenAI with the ephemeral secret. Mic audio streams in; partial and final transcripts stream back.
3. `POST /api/realtime/transcript`: user transcript fragments are persisted. Finals are indexed into memory. Assistant speech is never stored as memory.
4. When the model calls a tool, the browser forwards it to `POST /api/realtime/tool` along with the in-progress transcript, because realtime transcription can lag behind tool calls. The server:
   - checks that the session belongs to the caller;
   - validates arguments with zod;
   - requires `user_quote` to be grounded in what the user actually said, and the title/body to be grounded too;
   - applies `create / append / switch / move / edit / merge` (an existing track is reused instead of creating a near-duplicate; merge requires explicit merge language);
   - writes a `track_events` row with provenance (`source_type=realtime`, `confidence=live_draft`, `transcript_span`, `user_quote`, `tool_call_id`) and indexes the item text;
   - returns the tool output plus the updated tracks, which the UI renders immediately.
5. `memory_search` retrieves from the caller's schema only. `assisted_search` is gated (see below).

## No-ghost policy (`lib/policy/no-ghost.ts`)

- `isGroundedInSpeech`: track content must reuse the user's own words.
- `detectHelpSignal` / `gateAssistedSearch`: search runs only on stuck or explicit-help language **and** when relevant personal memory exists. Vague asks like "inspire me" never count, and prior web results never count as personal memory.
- `buildConditionedQuery`: the query is built from the stuck topic plus the user's own memory terms.
- `filterByVicinity`: keeps only results that share concrete terms with their memory, drops listicles, and links each result to memory ids. Every search is logged in `assisted_search_events`.
- `detectTrackSwitch` / `findDuplicateTrack`: switch detection uses speech cues plus lexical continuity over **existing** tracks. Ambiguous cases ask instead of creating a track.
- `buildRealtimeInstructions`: when memory is empty, the instructions use the refusal template and forbid search.

## Status

Works end to end in tests (real Postgres, external APIs faked): provisioning, isolation, track mutations with provenance, retrieval, gated search, GitHub ingest, and account wipe.

Needs real keys to run live: Auth0 sign-in, the OpenAI Realtime session and WebRTC audio, OpenAI embeddings, Tavily search, and higher GitHub rate limits.

Not built yet:

- Batch-STT degraded fallback. `/api/realtime/session` returns `503 { degraded: true }` when OpenAI isn't configured.
- Generic (non-GitHub) URL fetching. These links are saved as unindexed references.
- Private repos.
- Revoking Auth0 sessions through the Management API on account delete. Today the app writes a tombstone and logs the user out.
- Server-side post-check of assistant speech (`findGhostPhrases` exists but isn't wired to the stream).
- Profile/onboarding UI.
- The full visual design.
