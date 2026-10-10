# BrainStorm: tech stack by feature (2026-10-10)

This maps every feature to what it needs. It covers the creative brief, the user-grounded model doc, the fixes in [stack-review.md](stack-review.md), and Toluwani's decisions of 2026-10-10:

- Recordings are never stored by us. We work only on the live transcription, and audio is saved to the user's own device only if they ask.
- Isolation is by row-level security (RLS) keyed to the user's Auth0 ID.
- Users can connect their Adobe account so their portfolio feeds the model.
- A file, document and link reader understands pasted portfolio links and work.

Items marked *(verify)* come from my knowledge of a third-party service and should be confirmed in its current docs or with a quick spike.

## Shared foundation

| Layer | Choice | Notes |
| --- | --- | --- |
| Framework | **Next.js** (App Router) + **TypeScript** | One app for UI and API routes |
| Hosting | **Vercel** | Fits Next.js. Works because the browser holds the live voice connection (see feature 4). |
| Source | **GitHub** | Already decided |
| Auth | **Auth0** via `@auth0/nextjs-auth0`, GitHub social login enabled in Auth0 | Every API route verifies the session on the server |
| Database | **Supabase Postgres + pgvector**, connected directly with `DATABASE_URL` | No supabase-js, no Supabase Auth |
| Isolation | One schema per user (**decided**), RLS on every row keyed to the Auth0 `sub` | See "Database" below |
| Queries | **Drizzle** for queries, plus a small **raw-SQL migration runner** | Drizzle can't run migrations into per-user schemas |
| AI | **Gemini** via the `@google/genai` SDK: Live, Flash, Pro, embeddings | One provider |
| File storage | **Supabase Storage**, server-side only, path `users/{sub}/…` | Uploaded files only, never voice audio |
| Background work | Vercel `waitUntil` for embedding and ingest after a response | Add a queue only if it gets slow |
| Rate limits | **Upstash Redis** + `@upstash/ratelimit` | Per-user caps on live minutes, search and ingest |
| Secrets | Vercel environment variables | Auth0, Gemini, Exa, Adobe and DB keys |

### Database (decided 2026-10-10)
**One schema per user, with row-level security on every row.** Toluwani confirmed this on 2026-10-10.

- A small registry table, `app.users`, maps each Auth0 `sub` to its schema name (`user_<hash of sub>`). Only the server writes it.
- Each user's schema holds their full set of tables (profile, projects, tasks, tracks, files, links, memory chunks with pgvector). Every row carries `owner_sub`.
- No per-user Postgres roles. One app role, which does **not** own the tables, does all reads and writes.

How to make the RLS actually hold:

1. In every request, the server verifies the Auth0 session, then opens a transaction and runs `SET LOCAL app.sub = '<auth0 sub>'` and `SET LOCAL search_path = user_<id>`.
2. Every table gets the policy `USING (owner_sub = current_setting('app.sub'))`.
3. Turn on `FORCE ROW LEVEL SECURITY`. A migrator role owns the tables, because Postgres skips RLS for owners.
4. Generate the schema name on the server from the `sub`. Never take it from the client.
5. Account delete runs `DROP SCHEMA user_<id> CASCADE`, wipes the Storage prefix, revokes Adobe/GitHub tokens, and deletes the Auth0 user.

## Features

### 1. Sign-in and accounts
- **Auth0** Universal Login, GitHub social connection, `@auth0/nextjs-auth0` middleware guarding every app route.
- On first login, an API route creates `user_<id>` and runs migrations before anything else loads.
- Account deletion uses the **Auth0 Management API** plus the DB wipe above.

### 2. Profile and portfolio (introduce yourself)
- Next.js form and chat onboarding, written to `profile` and `achievement` tables.
- Anything typed, pasted, uploaded or connected (features 3 and 5) becomes portfolio memory with provenance.

### 3. Adobe account connection *(new)*
Goal: users connect Adobe and their creative work becomes part of their portfolio memory.

| Piece | Choice |
| --- | --- |
| Sign in with Adobe | **Adobe IMS OAuth 2.0**, set up as a project in the **Adobe Developer Console**. It's a separate "Connect Adobe" button, not an Auth0 login. |
| What we can read | **Creative Cloud Libraries API**: the user's libraries, assets, colours, type styles and thumbnails *(verify scopes and access)* |
| Behance / Adobe Portfolio | Behance stopped issuing new API keys years ago, and Adobe Portfolio has no public API *(verify)*. Read them through the **link reader** (feature 5): the user pastes their Behance or Portfolio URL. |
| Understanding the work | **Gemini** vision on thumbnails and project images, producing descriptions with medium, style and subject, stored as memory with `source_type: adobe` |
| Token storage | Adobe refresh token encrypted (AES-GCM, key in Vercel env) in the user's schema; revoked on disconnect or delete |
| Adobe in the build | Optional but good for this track: an **Adobe Express add-on** or **Firefly Services** feature. Check the track rules for what scores. |

### 4. Deep Thinking (live voice into tracks)
No audio is ever stored by us.

| Piece | Choice |
| --- | --- |
| Microphone | Browser `getUserMedia` + an **AudioWorklet** that converts to 16 kHz PCM |
| Live connection | Browser connects **directly to Gemini Live** using a short-lived **ephemeral token** the server mints after checking Auth0 *(verify current token API)*. Our servers never see audio. |
| Transcription | Gemini Live **input transcription** gives partial text while the user speaks |
| Talking back | The Live model asks brief reflective questions by voice |
| Track builder | Every few seconds the browser sends the latest transcript window plus current tracks to `/api/tracks`. **Gemini Flash** with structured JSON output returns `create`, `append`, `switch`, `move`, `edit` and `merge` events. The server saves them and returns them for the UI. |
| Switch detection | Speech cues in the prompt, plus **pgvector** similarity of the latest text to existing tracks |
| Long sessions | Live **session resumption** + context-window compression, with a visible "reconnecting" state |
| Save recording (opt-in) | **MediaRecorder** in the browser records alongside. On "save", it downloads to the user's device (File System Access API on desktop, a normal download on phones). Nothing is uploaded. |
| Fallback | If Live is down, the browser's **Web Speech API** gives rough live transcription into the same track builder, labeled degraded. This keeps the no-upload rule. |

### 5. File, document and link reader *(expanded)*
Users paste portfolio links, upload work or attach documents, and the model understands and relates to them.

| Input | How it's read |
| --- | --- |
| Web pages (portfolio sites, Behance, articles) | **Exa `/contents`**: we already pay for Exa, and it returns clean page text from a URL *(verify it handles JS-heavy portfolio sites)*. Images on the page go to Gemini vision. |
| GitHub repos | **GitHub REST API**: README, file tree, key files, recent commits. Public repos first. |
| PDFs, images | Sent straight to **Gemini** (reads them natively) for text and a description |
| Word (.docx) | **mammoth** to extract text, then Gemini |
| Slides, video, audio files | Gemini file input *(verify formats and size limits)*. Video is a stretch goal. |
| Relating it to the user | After extraction, **Gemini Pro** writes a short "what this is and how it connects to your profile and projects" summary. It only cites the source and existing memory. |
| Storage (decided) | Keep **both** the extracted text (chunked into memory) and the **compressed original** in Supabase Storage |
| Compression | Images: **sharp** to high-quality WebP (about 85 quality, roughly 25–35% smaller than JPEG, unverified). PDFs and text files: lossless **Brotli** before upload. Already-compressed formats (.docx, .pptx, .zip, video): store as-is, since they barely shrink. Keep the original filename and type in metadata so downloads come back in the right format. |

### 6. Memory and learning
- **gemini-embedding-001** at **768 dimensions** (pgvector indexes cap at 2000) *(verify)*.
- **pgvector HNSW** index inside each user schema.
- Every write (track, reflection, file, link, Adobe asset) is chunked, embedded and stored with provenance.

### 7. Reflective questioning (the no-ghost AI)
- **Gemini Pro** for deep text turns, Flash for quick ones.
- **Structured output** forces every claim about the user to carry memory ids. The server drops or regenerates any uncited claim.
- Question templates come from the design doc (§5.2) and are filled only from retrieved memory.

### 8. Project decomposition and visualization
- **Gemini** structured output turns tracks and notes into project, feature and task rows, saved as drafts until the user confirms.
- Notebook/lanes view: plain React + **dnd-kit** for drag, reorder and merge.
- Map view (optional): **React Flow** for project, feature and task graphs.

### 9. Assisted search (only when stuck)
- **Exa** `search` with queries built from the user's own terms, and `findSimilar` seeded by their repo and portfolio URLs.
- Results filtered by embedding similarity to their memory before showing.

### 10. Look and feel
| Need | Choice |
| --- | --- |
| Styling | **Tailwind CSS** with a cool-tone palette |
| Full-screen shifting gradient bubbles | A small **WebGL fragment shader** (raw WebGL, or `@react-three/fiber` if we want more). It can react to mic volume during Deep Thinking. |
| Translucent 4-button menu bar | CSS `backdrop-filter: blur()` + its own animated gradient + edge shadows |
| Animation | **Motion** (formerly Framer Motion) for page and track transitions |
| Icons | **lucide-react** |
| Mobile | Responsive web app, installable as a **PWA**. Mic works in mobile browsers over HTTPS. |

### 11. Testing and quality
- **Vitest** for unit tests (RLS, track event logic, citation checks).
- **Playwright** for end-to-end runs (sign-in wall, two users can't see each other).
- A small eval script with fixed transcripts and the "must not invent" checks from the design doc (§8).

## Accounts and keys needed
Auth0 tenant · Google AI Studio (Gemini) key · Supabase project · Exa key · Adobe Developer Console project · Vercel project · Upstash Redis · GitHub repo.

## Menu bar (4 buttons, decided 2026-10-10)
1. **Home** (main page after sign-in, where Deep Thinking and live tracks happen). Working name "BrainStorm"; Toluwani may rename it after a famous creative. Icon to come.
2. **Studio** (formerly "History"; doubles as Projects): nothing is ever "past" for a creative. It shows projects, their tracks, and the timestamped sessions that touched each track (a "By date" toggle gives the timeline). "Continue" reopens the project on Home with its tracks and memory loaded, so new speech keeps editing the same tracks.
3. **Profile**: the user's profile, portfolio, uploaded documents and connected accounts. Settings is meant to live here eventually.
4. **Settings** (placeholder): holds the fourth slot until a better fourth button is chosen.

## Still open
- The app name and Home icon.
- The permanent fourth button.
- Which Adobe feature, if any, goes into the build for judging.
