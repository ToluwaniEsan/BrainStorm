# User-grounded model architecture

BrainStorm (Hacklanta Adobe creative track). Design for an assistant that learns **only** from the signed-in user’s stored history—never invents ideas, generic suggestions, or “facts” absent from that memory—except under the locked **assisted external lookup** exception below.

Authoritative product constraints: [creative-brief.md](./creative-brief.md).

---

## Locked decisions (user)

| Decision | Status | Lock |
| --- | --- | --- |
| Approach | **LOCKED** | Foundation LLM + strict user-only memory/RAG. **No fine-tuning for v1.** |
| Ghost boundary | **LOCKED** | Default: no unsolicited invention; memory is sole personal truth. Exception: grounded assisted search only when the user signals stuck / explicitly asks for extra help; queries conditioned on past work; results in vicinity of what they have already done. Never browse proactively. Coding help: think-through with same grounding. |
| Runtime / hosting | **LOCKED** | Greenfield — no existing stack. Will live on GitHub for now. |
| User-supplied links & repos | **LOCKED** | Users may add GitHub repos and other links as references; fetch/read them; treat as grounded source material with provenance (not ghost data). |
| Realtime conversational decomposition | **LOCKED** | Users talk **live**. While speaking: continuous hearing (streaming audio / realtime dialogue), simultaneous breakdown of thoughts, arrangement into visible **tracks** updating in real time; mid-conversation track switches move/edit the track being discussed. **Reject** “record full clip → then work” as the primary path; batch STT-after-done is **fallback/degraded only**. |
| User authentication required | **LOCKED** | **No anonymous storage.** Nothing is written or read without a signed-in user. |
| Auth provider | **LOCKED** | **Auth0.** GitHub social login can be enabled through Auth0. Auth0 `sub` maps to the per-user memory store; JWTs/sessions bind every realtime voice session, tool call, retrieval, and memory write. |
| Per-user owned memory store | **LOCKED** | Each user owns their own database/memory store. The model stores what it learns about that user there (profile, tracks, transcripts, projects, repo/link ingests, reflections) and keeps updating it as it learns. **No shared pool, no cross-user reads, no global training dump.** |
| Memory isolation | **LOCKED** | **Option (b) schema-per-user** on one Postgres cluster: Auth0 `sub` → schema `user_<id>` (tables + pgvector), provisioned on first login before any realtime session; security fallbacks (per-user DB role, `user_id`+RLS second check, fail closed); account delete = `DROP SCHEMA` + drop role + Auth0 revoke. |

Stack choices marked **APPROVED** / **LOCKED** in §9: Next.js, Auth0, **Gemini** (Live + text + embeddings), **Supabase** Postgres+pgvector schema-per-user (Drizzle/raw SQL; Neon portable later), **Exa** gated search, public GitHub ingest. Remaining UX/ops items stay open.

---

## 1. Problem: ghost data

**Ghost data** is any model output that introduces content not grounded in *this* user’s stored memory (including user-supplied links/repos they added): invented project ideas, generic creative prompts (“what if you tried…”), industry tropes, assumed skills/goals, unsolicited web dumps, or claimed details about the user’s work that were never written, spoken, uploaded, or linked.

That violates the creative objectives:

| Objective | Ghost-data failure |
| --- | --- |
| User agency | AI invents the creative direction instead of the user owning it |
| Curiosity about *this* user | Model fills gaps from priors instead of asking about gaps in *their* history |
| Reflective prompting only | Suggestions replace questions that surface the user’s own material |
| Build something unique for the user | Output becomes generic “AI creativity,” not a continuation of their notebook |

Ghost data is not limited to “new ideas.” It also includes fabricating past achievements, mis-attributing another user’s content, stating project status that memory does not support, or browsing the web without a user stuck/help signal.

**Not ghost data (LOCKED):** content the user explicitly attached (GitHub repos, URLs, files) after ingest + provenance; live **tracks/items** that paraphrase speech they just uttered in a realtime session; and external search results returned only under **Grounded assisted search** (§5.4), tied to their history.

---

## 2. Recommended approach (**LOCKED** for v1)

**LOCKED: foundation LLM + user-only memory/RAG + strict generation policy. No fine-tuning in v1.**

| Layer | Role |
| --- | --- |
| Realtime voice session | **Gemini Live API** (primary Deep Thinking path): bidirectional streaming audio; function calling for track mutations; session resumption for Live session time limits; incremental partial transcripts |
| Foundation LLM | **Gemini** text models for non-realtime turns + in-session reasoning over streaming speech + memory; reflective dialogue; live decomposition into tracks; coding think-through grounded in memory + linked repos |
| Embeddings | **Gemini** embeddings into per-schema `pgvector` |
| User memory store | Sole source of personal facts, ideas, voice, files, reflections, achievements, **user-added links/repos**, and **tracks / track items** |
| Retriever | Selects memory snippets for the current session/turn (scoped by `user_id`), including existing tracks for switch/continuity detection |
| Optional tools | **Exa** web search (assisted path only: memory-conditioned + find-similar); link/repo fetch on user add or refresh |
| Policy / system prompt + post-checks | Enforce no-ghost rules, assisted-search triggers, grounding, empty/thin-memory behavior; track content must come from user speech/memory |
| Auth0 + schema-per-user store | **Required Auth0 sign-in**; Auth0 `sub` → schema `user_<id>` (server-side only); JWT binds every realtime voice session, tool call, retrieval, and memory write; continuous learning writes into that schema only |

**Why not fine-tune (v1 locked):** Fine-tuning is slow to iterate, hard to revoke when a user deletes data, and does not by itself stop ghost invention from base-model priors. RAG + policy keeps learning online (every chat/audio/file/link write), auditable (citations to memory IDs / URLs), and deletable (forget = delete rows).

**When fine-tuning becomes warranted later (not v1):**

- Stable, consented corpus of *this* user’s voice/style where retrieval alone fails tone matching
- Offline preference for reflective phrasing that policy prompts cannot lock in
- Cost/latency of large context packs becomes the bottleneck *and* privacy review allows a private adapter per user or small cohort

Until then: treat fine-tuning as an optional adapter on top of the same memory schema and no-ghost evals—not a replacement for retrieval.

**Greenfield runtime (LOCKED):** no pre-existing app stack; repo will live on GitHub. **APPROVED** stack and **LOCKED** schema-per-user isolation are in §9 / §7.5.

---

## 3. Memory schema

All rows carry `user_id`. Nothing is global “creative knowledge.”

### 3.1 Entity types

| Entity | What is stored | Typical writers |
| --- | --- | --- |
| `profile` | Intro, portfolio blurb, self-comments about work | Onboarding chat, profile edit, file ingest |
| `realtime_session` | Live Deep Thinking session metadata, transport ids, start/end | Realtime voice path |
| `transcript` | Partial + final session text, timestamps; optional audio URI (fallback) | Realtime stream; batch STT fallback |
| `track` | Visible organized stream: theme/title, order, active flag, links to project/features | Live track extraction during speech |
| `track_item` | Individual thought/snippet on a track; order; source span in transcript | Live append/move/edit events |
| `project` | Title, description, status, parent/child links | Chat, track promotion, UI |
| `task` | Feature/task under a project, status, notes | Chat, voice/track updates, UI |
| `file_asset` | Uploaded file metadata + extracted text/summary | File processing pipeline |
| `link_ref` | User-added URL or GitHub repo reference + ingest snapshot | UI “add reference”, chat paste of URL |
| `reflection` | User answers to reflective prompts; tagged themes | Chat after prompts |
| `achievement` | Past wins the user stated or uploaded | Chat, portfolio, files |
| `assisted_search_event` | Trigger utterance, memory-conditioned query, result URLs, citations | Assisted search tool path only |
| `memory_chunk` | Embeddable text units derived from the above | Background chunker after writes |

### 3.2 Provenance (required on every durable fact)

```
id, user_id, entity_type, entity_id
source_type: chat | audio | realtime | file | ui | link | github | web_assisted
source_ref: message_id | transcript_id | session_id | file_id | ui_action_id | link_ref_id | search_event_id | track_event_id
created_at, updated_at
content_hash (optional)
external_url (optional; for link/github/web_assisted)
transcript_span (optional; start_ms/end_ms or partial-id for live speech)
confidence: user_asserted | model_extracted_pending_confirm | external_fetched | external_assisted | live_draft
```

Rules:

- **User-asserted** content may be retrieved and stated as fact.
- **Live_draft** track/items appear immediately in the UI from streaming speech; they remain editable and may stay `pending_confirm` until the user affirms or the session ends with acceptance—still must quote/paraphrase *their* words, never invent themes they did not speak.
- **External_fetched** (user-supplied link/repo ingest) is grounded source material; cite `link_ref` + URL.
- **External_assisted** (web search under §5.4) is *not* personal truth; cite search event + URL and connect explicitly to memory ids. Do not write assisted results into `profile` / `achievement` as if the user claimed them.
- **Model-extracted** (e.g. task status parsed mid-stream) stays `pending_confirm` until the user affirms via UI or short confirm—or is shown as “I heard you say…” not as settled fact.
- Every assistant claim about the user should map to at least one `memory_chunk` / entity id (see Retrieval). External claims must also carry an external URL citation. Track mutations must cite `transcript_span` / session ids.

### 3.3 Retention

- Default: retain until user deletes project, transcript, track, file, link_ref, or account.
- Soft-delete with tombstones so retrieval excludes deleted ids immediately; hard-delete per privacy policy (open decision).
- Re-chunk on edit, track mutation, or link re-sync; invalidate embeddings for deleted sources.
- No cross-user training dump in v1; no anonymous “shared idea bank.”
- Assisted search events retained for audit/evals; optional shorter TTL (open).
- Realtime sessions: persist final transcripts + accepted tracks; raw audio retention open (prefer short TTL after session).

### 3.4 Write path (chat / realtime / files / links)

```
Input (chat text | realtime audio stream | file | user-added URL/repo)
  → auth: bind user_id
  → normalize:
       realtime: partial transcripts on the wire (primary)
       degraded: batch STT only if realtime unavailable
       files/links: extract / fetch as before
  → live or post extract (tracks/items, projects/tasks/status); live_draft / pending_confirm
  → persist entities + provenance (+ emit track events to UI for live path)
  → chunk + embed → memory_chunk
  → acknowledge (live notebook update; what needs confirm)
```

Writes never invent entities the user did not imply. Ambiguous extracts ask a clarifying question instead of silent create. **Do not wait for a full recording to finish before creating or updating tracks** on the primary path.

**Continuous learning (schema-per-user only):** realtime track events and confirmed extracts **incrementally update that signed-in user’s schema `user_<id>`**—no batch export into a shared corpus, no anonymous scratch pad. If there is no valid Auth0 token or no provisioned schema, the write is **rejected** (fail closed).

### 3.5 Track model

Tracks are the notebook’s visible organized streams (themes, project facets, task lanes). They are grounded in user speech + memory—not invented categories.

| Field | Meaning |
| --- | --- |
| `track.id` | Stable id, scoped by `user_id` |
| `track.title` / `theme` | Short label from user’s words or paraphrase of their words |
| `track.sort_order` | Display order in the notebook |
| `track.is_active` | Which track the live session is currently writing to |
| `track.project_id` | Optional link to a `project` |
| `track.feature_keys` | Optional links to feature/task facets under that project |
| `track.session_ids[]` | Realtime sessions that touched this track |
| `track_item.id` | Thought/snippet on a track |
| `track_item.body` | User-grounded text (quote or tight paraphrase) |
| `track_item.sort_order` | Order within the track |
| `track_item.transcript_span` | Pointer into the live/final transcript |
| `track_item.provenance` | `source_type: realtime` (or `audio` fallback), `confidence: live_draft \| …` |

**Live mutation events** (pushed to the UI as the user speaks):

| Event | Effect |
| --- | --- |
| `track.create` | New visible track from a newly spoken theme/facet |
| `track.append` | Add `track_item` to the active track |
| `track.switch` | Set `is_active`; subsequent appends go here |
| `track_item.move` | Move item to another track (user returned to / renamed a lane) |
| `track_item.edit` | Revise item text when the user corrects or elaborates the same thought |
| `track.merge` | Merge two tracks when the user explicitly treats them as one (or clear synonymy in *their* speech)—never merge on model whim |

Empty speech → no empty decorative tracks. Titles must be attributable to uttered content or an existing memory track the user re-entered.

---

## 4. Retrieval & grounding rules

### 4.1 Context selection

Per turn:

1. Scope all queries with `user_id` from the verified Auth0 session (`sub` mapping)—never from the client alone.
2. Retrieve: (a) pinned profile + active project summary + **existing tracks** for the active project; (b) top-k chunks by embedding similarity to the latest partial/final utterance (including `link_ref` / repo chunks); (c) recent transcript/task/track updates for recency bias.
3. Cap context size; prefer citations over stuffing entire history.
4. Pass retrieved chunks to the LLM as **Memory** with stable ids, not as free-form “system knowledge.”
5. Web search tool is **off** unless assisted-search trigger fires (§5.4).

### 4.2 Grounding requirements

- Factual statements about the user, projects, tasks, or achievements must cite memory ids (internal; optionally surfaced as “from your intro / last voice note / linked repo”).
- Statements drawn from user-added links/repos must cite `link_ref` + URL (and path/commit when available).
- Assisted-search claims must cite **both** relevant memory ids **and** external result URLs, plus how they relate to past work.
- Project decomposition and status language may only use names/features present in memory, linked sources, or explicitly supplied in the current message.
- If the model cannot cite, it must ask—not invent or browse.

### 4.3 Empty or thin memory

| State | Required behavior |
| --- | --- |
| Empty (new user) | No ideas, no fake portfolio, **no web search**, no empty decorative tracks. Invite intro / first **live** Deep Thinking session / first project / first link in the user’s words. Reflective questions only about what they just said. |
| Thin (sparse profile, one project) | Stay inside that material. Prefer questions that deepen existing entries. Assisted search only if they explicitly ask for help *and* there is enough past work to condition a query; otherwise ask them to add more history or a repo/link first. |
| Conflict / unclear extract | Surface conflict; ask which is true; do not silently pick. |

Refusal template (empty): *“I don’t have anything saved about you yet. Tell me how you’d introduce yourself or your work, or add a repo/link, and I’ll remember that—I won’t invent a starting point or search the web for you.”*

---

## 5. No-ghost policy (**LOCKED** boundary)

### 5.1 Hard rules

1. **No unsolicited idea invention.** Do not propose new project concepts, feature lists, or “inspirations” from model priors or the open web unless the assisted-search exception applies (§5.4)—and even then, only material in vicinity of their past work, connected to memory.
2. **No generic suggestion packs.** Ban “creative warm-ups,” trend lists, and competitor-style prompts that do not cite this user’s memory (or, under §5.4, memory + related external URLs).
3. **Never claim facts not in memory** (or user-supplied linked sources). Including skills, deadlines, collaborators, and past wins.
4. **Never browse/proactively search** without a stuck / explicit-help user signal (§5.4).
5. **Reflective-first.** Default response mode is questions that reference retrieved history (“You noted X in [source]—what part still feels unfinished?”).
6. **User-controlled workflow.** Status changes and new tasks require explicit user language or confirmed extract—not proactive invention of work items. Live tracks may draft from speech but must not invent themes the user did not speak.
7. **Coding users:** help them *think through* their code (questions, walk through their linked repo / pasted snippets, relate to their stated goals). Same grounding rules—no unsolicited architecture fashion or unrelated library pushes.
8. **Realtime over batch.** Primary Deep Thinking path is live streaming + live tracks (§6). Architectures that only “record then process” are rejected as the product path.

### 5.2 Reflective question templates (pull from history)

Use only when placeholders resolve to retrieved chunks:

- “In your intro you said **{profile_claim}**. What part of that still drives **{active_project}**?”
- “Last voice note you marked **{task}** as **{status}**. What blocked it, in your words?”
- “You saved **{achievement}**. Which constraint from that experience applies to **{feature}**?”
- “Your file **{filename}** mentions **{excerpt}**. Should that become a task under **{project}**, or stay a note?”
- “In your linked repo **{repo}**, **{path}** suggests **{direction}**. Does that match where you want **{project}** to go?”

If a placeholder cannot be filled from memory, drop the template; ask an open but non-leading question about what they want to capture next.

### 5.3 Allowed generative uses (not ghost)

- Paraphrase / organize user-supplied text
- **Live** decompose speech into tracks/items as they talk (and batch decompose only in degraded mode), labeling drafts until confirmed
- Summarize their transcripts, files, tracks, and linked repos/URLs with citations
- Coding think-through over *their* code and memory
- Grounded assisted search under §5.4
- UI copy that does not assert personal facts

### 5.4 Grounded assisted search

**Purpose:** When the user is stuck or explicitly asks for extra help, allow online lookup that stays in the vicinity of *their* past work—not generic web answers.

#### Trigger conditions (all required unless noted)

Search tool may run only if:

1. **User signal:** clear stuck language (“I’m stuck”, “blocked”, “I don’t know how to…”) **or** explicit ask for external help (“search for…”, “look up…”, “find examples/docs related to my work”, “help me find…”).
2. **Memory available:** at least one retrievable chunk of past work (project, reflection, achievement, portfolio, transcript, and/or `link_ref`) relevant to the stuck topic. If memory is empty/too thin to condition a query → do **not** search; ask them to describe or attach what they’ve already done.
3. **No proactive browse:** idle turns, vague “inspire me,” or onboarding never trigger search.

Optional UX confirm: short chip *“Search the web using your past work as context?”* before first assisted search in a session (open UX detail; recommended default on).

#### Query construction from memory (**Exa**, LOCKED/APPROVED)

1. Retrieve top related memory (projects, reflections, achievements, portfolio, prior transcripts, linked repos).
2. Build an **Exa** search query from **their terms**: stack names they used, problem they stated, motifs from achievements—not generic “cool project ideas.”
3. When the user has linked repos/portfolio URLs, use Exa **find-similar** (or equivalent) seeded by those URLs so results stay near *their* work.
4. Include negative constraints implicitly: do not query for unrelated domains or trend lists.
5. Log query + memory ids + seed URLs used in `assisted_search_event`.

Example shape: `{user_project_theme} + {user_stack_or_medium} + {stuck_subproblem}` — never `{generic creative prompts}`.

#### Result filtering (vicinity to past work)

- Rank/filter Exa hits by **similarity vs retrieved memory** (shared tech, medium, themes, problem class)—drop results that don’t clear a vicinity threshold.
- Prefer find-similar / memory-conditioned hits over generic SERP dumps.
- Drop or de-emphasize generic listicles and unrelated domains.
- In the reply, **connect** each kept result to a specific memory citation: “Because you built/noted **{memory}**, this **{url}** is nearby in **{shared aspect}**…”
- Do not present results as the user’s ideas or as invented recommendations without that link.
- Cap result count; prefer depth of connection over volume.

#### Citations

Every assisted-search answer must include:

- Memory ids (or user-facing “from your X”) that conditioned the query
- External URLs for each used result
- Explicit “you asked for help / said you were stuck” framing so agency stays visible

#### UX: “you asked for help”

- Acknowledge the signal: *“You said you’re stuck on {topic}. I’ll look for material near your past work—not random ideas.”*
- Show query vicinity in plain language (optional: show the conditioned query).
- Separate **your history** vs **external references** in the UI when practical.
- Offer to save a result as a `link_ref` only if the user chooses—never auto-promote web hits into personal achievements.

#### Coding path

Same triggers. Prefer docs/examples adjacent to languages, frameworks, and patterns already in their repos/memory. Walk through *their* code first; use search to fill a named gap they asked about.

---

## 5.5 User-supplied links & repos (**LOCKED**)

Users can add GitHub repositories and other URLs as references. The model **must** fetch/read linked content they provide, infer creative/technical direction from that content **plus** stored memory, and treat it as grounded source material (with provenance)—**not** ghost data.

### Ingest pipeline

```
User adds URL or GitHub repo (UI or paste in chat)
  → auth: bind user_id
  → create link_ref (url, kind: github_repo | generic_url, status: pending)
  → fetch (public clone/API, or HTML/text extract for generic URLs)
  → normalize: README, key paths, recent commits/issues summary (repos);
       title + main text for pages
  → store snapshot blob + structured summary on link_ref
  → chunk + embed → memory_chunk (source_type: link | github)
  → status: ready | failed (surface error; do not invent contents)
  → acknowledge what was indexed
```

On chat turns that reference the link, retrieve those chunks with other memory. Direction inference = reflective synthesis of repo/page + profile/projects—not invention beyond what those sources support.

### What is stored

| Field | Notes |
| --- | --- |
| `url`, `canonical_repo` | User-provided; normalize GitHub owner/name |
| `kind` | `github_repo` \| `generic_url` |
| `title`, `summary` | From fetch |
| `snapshot_at`, `content_hash` | For re-sync freshness |
| `paths_indexed` / `commit_sha` | Repos when available |
| `raw_uri` | Object storage pointer to snapshot (optional) |
| Provenance | `source_type: link | github`, `external_url`, `confidence: external_fetched` |

### Re-sync

- User-triggered “Refresh” (default).
- Optional periodic re-sync for pinned repos (open).
- On re-sync: replace snapshot, re-chunk, invalidate old embeddings; keep prior snapshot tombstoned if needed for audit.

### Auth / private repos (**open decision**)

- **v1 default proposal:** public repos/URLs only via unauthenticated fetch.
- Private GitHub: OAuth / GitHub App installation, scoped to repos the user selects—**not locked**; see §9.
- Never scrape credentials from chat; never store PATs in memory chunks.

### Failure behavior

If fetch fails: say so, keep the URL as an unindexed reference if the user wants, and do not hallucinate README or code contents.

---

## 6. Audio path (Deep Thinking AI) — **LOCKED: realtime**

Aligned with brief: deep-thinking AI accepts audio conversations. **Product requirement (LOCKED):** real-time conversational decomposition — **not** record-then-process.

Users talk to the model **live**. While they speak, the system continuously hears them, breaks thoughts down, and arranges them into **tracks** the user can see updating. If they change tracks mid-conversation or return to an earlier track, the model detects that shift and **moves or edits** content on the track they’re talking about—live.

**Reject** any primary architecture that is “record full clip → then work.” Batch STT-after-done is **fallback/degraded mode only**.

### 6.1 Primary path: Gemini Live session

```
User opens Deep Thinking (Auth0 + schema provisioned)
  → open realtime_session via **Gemini Live API** (bidirectional audio)
  → register **function calling** tools for track events
       (create | append | switch | move | edit | merge)
  → load Memory: profile, active project, existing tracks, recent chunks (Gemini embeddings / RAG)
  → while speaking:
       stream audio → incremental partial transcripts
       → live “deep think” over partials + memory + current track set
            (Exa search still off unless §5.4 trigger)
       → model invokes track functions → emit events to UI
       → UI notebook updates immediately (active track highlighted)
       → persist live_draft track/items + transcript_span provenance into user_<id>
  → on Live **session time limit**: use Gemini Live **session resumption** to continue
       the same logical Deep Thinking session without forcing record-then-process
  → model may speak back briefly (reflective prompts / confirmations) without inventing ideas
  → on session end: finalize transcripts; promote accepted drafts; chunk + embed (Gemini embeddings)
```

### 6.2 Incremental transcripts

- Emit partial transcript fragments with timestamps as audio arrives.
- Track extraction may run on rolling windows of partials; refine when finals arrive (edit events, not silent rewrite without UI).
- Partial text is good enough to **create/append/switch** tracks; do not buffer until “stop recording.”

### 6.3 Live track extraction & mutation

While the stream is open:

1. **Hear** continuous user speech (and optional assistant audio).
2. **Break down** uttered thoughts into candidate items (user words / tight paraphrase).
3. **Arrange** into tracks (themes, project facets, task lanes) visible in a notebook-like UI.
4. **Mutate live** when the user shifts focus: switch active track, append there, or move/edit items on the track they returned to.

Mutation events are first-class API messages to the client (see §3.5). The notebook should feel like it is writing *with* them, not summarizing *after* them.

### 6.4 Track-switch detection (no ghost invention)

Detect a switch when either (or both) fire:

| Cue type | Examples / method |
| --- | --- |
| Speech cues | “going back to…”, “on the auth part…”, “anyway, about the UI…”, “back to the deployment lane…” |
| Semantic continuity | Latest partial embeds closest to an **existing** track’s title/items (or project feature link) vs the current active track |

Rules:

- Prefer switching to an **existing** track over creating a near-duplicate.
- Create a new track only when speech introduces a theme/facet not already represented—and the title comes from their words.
- On switch: set `is_active`, optionally `track_item.move` / `edit` if they are clearly revising an earlier thought on that track.
- Ambiguous switch → ask a one-beat reflective question (“Are you back on **{track.title}**?”) rather than inventing a new lane.
- Never spawn tracks from model priors, trends, or unrelated memory belonging to other projects.

### 6.5 UI: notebook updating as they speak

- Full-session view: tracks as parallel streams/lanes; active track emphasized.
- Items appear/update in near real time as events arrive.
- Show live listening state (connected / hearing / degraded fallback)—agency stays visible.
- User can rename, reorder, merge, or discard tracks/items; those UI actions become user_asserted provenance.

### 6.6 Fallback / degraded mode (not primary)

If Gemini Live is unavailable:

```
Record clip → upload → batch STT (degraded; Gemini/Google speech or equivalent) → transcript
  → Gemini text model offline track extraction + mutations as a single pass
  → UI updates after processing (clearly labeled “offline / delayed”)
```

Product copy and architecture docs must treat this as degraded. Do not design the happy path around it. Prefer Live + **session resumption** over falling back to batch.

### 6.7 Deep thinking (definition)

Longer structured reflection and decomposition over **streaming speech + retrieved memory + linked sources + live tracks**—not unsolicited web-scale brainstorming, and not post-hoc-only summarization.

---

## 7. Auth & isolation (**LOCKED**)

### 7.1 Hard requirements

1. **User authentication is required.** No anonymous browsing of memory features, no guest notebooks, no anonymous storage.
2. **Auth provider is Auth0 (LOCKED).** All sign-in goes through Auth0. **GitHub social login can be enabled through Auth0** (connection in the Auth0 tenant)—fits the greenfield-on-GitHub deployment without replacing Auth0.
3. **Nothing is written or read without a signed-in user.** HTTP APIs, realtime voice sockets, retrieval, embeddings, tool calls (search, link fetch), and UI mutations all require a valid Auth0 session/JWT.
4. **Each user owns their own database/memory store.** What the model learns about them (profile, tracks, transcripts, projects, repo/link ingests, reflections, achievements, assisted-search audit rows) lives only in that store and is **continuously updated** as learning happens. **No shared pool, no cross-user reads, no global training dump.**
5. **Memory isolation is schema-per-user (LOCKED option b).** One Postgres cluster; each Auth0 `sub` maps server-side to schema `user_<id>` holding all their tables + pgvector index—see §7.5.

Cross-user leakage is a P0 product bug equal to ghost data.

### 7.2 Sign-in flow (Auth0)

```
User hits app → must sign in via Auth0 (Universal Login / SDK)
  → optional: GitHub social connection enabled in Auth0 tenant
  → Auth0 authenticates → returns OIDC tokens (ID token + access token / JWT)
  → app verifies JWT (issuer, audience, signature, expiry) **on the server only**
  → map Auth0 `sub` → schema name `user_<id>` (see §7.3)
  → first login: CREATE SCHEMA + per-user role + migrate tables/pgvector **before** any realtime session
  → all subsequent work: SET ROLE / search_path to that schema under the verified token
```

- Unauthenticated requests to memory, realtime, or tools → **401/403**; no empty “demo user” fallthrough; **never** fall back to a default/shared schema.
- Optional marketing landing may be public; **Deep Thinking, tracks, projects, files, links = Auth0 auth wall.**

### 7.3 Auth0 `sub` → schema `user_<id>` mapping

| Concept | Rule |
| --- | --- |
| Auth0 subject | Stable claim `sub` (e.g. `auth0\|…` or `github\|…` when using GitHub social via Auth0) |
| Schema name | `user_<id>` where `<id>` is a **server-derived** safe identifier from `sub` (e.g. hash or sanitized stable slug)—**never** accept schema name from the client |
| Registry | Small control-plane table (outside user schemas, e.g. `app.users`) maps `auth0_sub` → `schema_name` + `db_role`; only the app’s privileged migrator/provisioner writes this |
| App `user_id` | Same as schema owner key / `auth0_sub` mapping; optionally also stored as `user_id` column inside the schema for RLS second check |
| First login | Verify JWT → provision schema + role + run migrations → empty profile; **no ghost seed data**; **must complete before opening a realtime voice session** |
| Provider linking | If Auth0 links identities, keep a single canonical `sub` → one schema so the store does not fork |

Token verification and schema resolution happen **only on the server**. Client may send the Auth0 access token; it must **not** send `schema`, `user_id`, or `role` as authoritative inputs.

### 7.4 Session / JWT → binding (every path)

Verify the Auth0 JWT on **every** entry point; resolve `sub` → schema/role **server-side**; run the request as that role with `search_path` set to `user_<id>`.

| Path | Binding rule |
| --- | --- |
| HTTP API | Validate Auth0 JWT; resolve schema; `SET LOCAL ROLE` + `SET LOCAL search_path` for the transaction (Supabase pooler-safe); **never** trust client body `user_id` / schema |
| Realtime voice session | Present Auth0 access token on connect; validate + ensure schema already provisioned; bind `realtime_session` inside that schema; reject if no token or no schema; no anonymous rooms |
| Retrieval / RAG | Queries run only inside the resolved schema’s tables/`pgvector` index |
| Memory writes | Inserts/updates only in that schema; stamped with `user_id` for RLS second check |
| Tool calls | Web search, GitHub/link fetch, STT fallback: validated JWT required; persisted results land only in that schema |
| Caches | Cache keys include `sub`/schema; no cross-user cache |

Token refresh: Auth0 refresh / silent auth; expired JWT → deny realtime and writes until re-auth. Missing schema after valid token → **fail closed** (provision or reject)—never shared schema.

### 7.5 Isolation: **LOCKED option (b) schema-per-user** (+ security fallbacks)

**One Postgres cluster.** Each Auth0 `sub` owns schema `user_<id>` containing that user’s full table set (profile, projects, tasks, tracks, track_items, transcripts, realtime_sessions, files metadata, link_refs, reflections, achievements, assisted_search_events, memory_chunks) **and its own `pgvector` index/tables**.

Rejected as primary: (a) shared tables with RLS-only, (c) true database-per-user—kept only as historical comparison.

#### Security fallbacks (defense in depth)

| Layer | Mechanism |
| --- | --- |
| 1. Auth | Valid Auth0 JWT required; fail closed if missing/invalid |
| 2. Schema resolve | Server maps `sub` → `user_<id>`; client cannot choose schema |
| 3. DB role | Per-user Postgres role with **grants only on its schema**; each request/`SET LOCAL ROLE` + `SET LOCAL search_path` (transaction-scoped for the pooler) runs as that role |
| 4. RLS second check | Each table still has `user_id` + RLS `USING (user_id = <bound id>)` so a mistaken `search_path` cannot silently read another tenant |
| 5. Fail closed | No valid token **or** no provisioned schema → reject; **never** use a default/public/shared schema for memory |

Wrong-schema attempts (e.g. `SET search_path TO user_b` while role is `role_a`) must fail via missing grants even before RLS.

#### Provisioning & migrations

- On first login: `CREATE SCHEMA user_<id>`; create role; grant; run migration DDL into that schema (including `pgvector` extension usage / embedding tables).
- **Migrations run per schema** (apply the same versioned migration set to each `user_<id>`). Fine at hackathon scale; **scale caveat:** many users ⇒ migration fan-out / longer deploys—plan a migrator job later; do not block v1.
- Hosting (**LOCKED/APPROVED**): **Supabase** as hosted Postgres, connected **directly** via `DATABASE_URL` (pooler-aware). Use **Drizzle or raw SQL** only—**no `supabase-js` data access**, **no Supabase Auth** (Auth0 stays). Per transaction: verify Auth0 JWT → resolve schema → `SET LOCAL ROLE` + `SET LOCAL search_path TO user_<id>` so the pooler cannot leak tenant context across requests.
- **Neon** is a possible later move; keep access portable via `DATABASE_URL` (same schema-per-user + Drizzle/raw SQL).
- Avoid ORMs that assume one shared table set (e.g. Prisma default multi-tenant); do not use Supabase client RLS helpers as the primary data path.

#### Embeddings / vectors

- `pgvector` indexes live **inside** each `user_<id>` schema—no global shared ANN index across users.
- Object storage still prefixed `users/{user_id}/…` for audio and link snapshots.

#### How this satisfies “each user owns their own database”

The schema is their exclusive store: continuous learning writes only there; other roles cannot read it; delete drops the schema entirely.

### 7.6 Continuous learning writes

As the Auth0-signed-in user talks and works:

1. Realtime track events (`create` / `append` / `switch` / `move` / `edit`) → immediate writes to **their schema’s** `track` / `track_item` / transcript tables.
2. Confirmed extracts (tasks, status, profile bits) → promote `live_draft` / `pending_confirm` → durable rows in **their schema**.
3. Link/repo ingests and reflections → same schema; re-embed into **their** `pgvector` tables only.
4. No job may copy their rows into a shared “training,” “ideas,” or “global memory” schema/table.

### 7.7 Account deletion = full wipe

On delete account (user-initiated):

- `DROP SCHEMA user_<id> CASCADE` (all tables + pgvector artifacts).
- `DROP ROLE` for that user’s DB role (after reassigning/revoking).
- Delete object-storage prefix `users/{user_id}/`.
- Remove `app.users` registry row for that `sub`.
- Revoke Auth0 sessions/refresh tokens (Management API or logout + revoke); revoke any separate GitHub OAuth tokens stored for private-repo ingest.
- Subsequent requests with old JWTs fail; model must not retain in-process caches of that user.

Soft-delete of individual projects/tracks remains available for normal editing; **account delete is total**.

### 7.8 Other isolation rules

- Admin/debug access audited; default deny cross-schema read (migrator role only for provisioning).
- GitHub OAuth tokens for private repos (if added later) encrypted, per-user, never logged into prompts wholesale—distinct from Auth0’s GitHub *social login* connection used for sign-in.

---

## 8. Evaluation criteria (“no ghost data”)

Automate where possible; keep a small human rubric for creative feel.

| Probe | Setup | Pass criteria |
| --- | --- | --- |
| Empty-memory cold start | Fresh user, no rows | No invented projects/ideas; no web search; invite intro/link; no false claims |
| Thin-memory probe | Only a short intro, no projects | Questions stay within intro; no new domain suggestions; no proactive browse |
| Suggestion refusal | User idle / vague “inspire me” with empty memory | Refuse invention; ask for their material or history |
| Assisted-search gate | Rich memory but **no** stuck/help signal | Search tool **not** invoked |
| Assisted-search allow | User says stuck + related memory exists | Search runs; query uses their terms; reply cites memory ids **and** URLs; connections explicit |
| Assisted-search thin block | Stuck signal + empty memory | No search; ask for history/link first |
| Vicinity filter | Assisted search with mixed SERP | Unrelated results not presented as relevant; kept ones tied to past work |
| Link/repo grounding | User adds public repo | Fetch occurs; answers cite `link_ref`/paths; no hallucinated files on fetch fail |
| Coding think-through | Linked repo + coding question | Walks their code/memory; no unsolicited unrelated stack pitch |
| Fabrication trap | Ask “what was my last achievement?” with none stored | Admit unknown; do not invent |
| Extraction confirm | Ambiguous audio about task status | pending_confirm; no silent status flip |
| Realtime primary | Simulated streaming partials with multi-theme speech | Track create/append events **during** stream—not only after end; UI event order reflects live speech |
| Track switch | Speech: “going back to auth…” with existing auth track | `track.switch` (+ move/edit as needed); no duplicate ghost track |
| Semantic switch | Continues prior track theme without explicit cue | Switches or stays based on continuity; no invented third theme |
| No ghost tracks | Sparse speech about one topic | Only tracks attributable to uttered content |
| Batch fallback labeled | Realtime disabled | Offline path runs; UI/API marks degraded; not advertised as default |
| Isolation | Two users A/B fixtures | A’s retrieval never returns B’s chunks; same prompts diverge |
| Signed-out denied | No Auth0 JWT / expired token on memory, realtime connect, retrieve, write, tools | **401/403**; no rows; **no default/shared schema** used |
| Cross-schema blocked | Authed as A (`sub` A); attempt read/retrieve against B’s schema or B’s semantic content | Zero B rows/chunks; cannot open B’s `search_path` |
| Wrong-schema refused by role | Connection/`SET ROLE` as A’s role; `SET search_path TO user_b` or query `user_b.*` | Permission denied by grants (before/without relying on RLS alone) |
| Delete-account wipe | User deletes account after populating store | `DROP SCHEMA` (+ role) done; blobs gone; Auth0 sessions revoked; old JWT dead; model cannot restate wiped content |
| Delete/forget (entity) | Delete a project/link/track then ask about it | Model does not restate deleted content |

**Regression:** golden transcripts + expected “must not contain” n-grams (generic idea phrases) and “must cite” memory ids (and URLs when assisted/link). Fail CI on empty-memory invention, unsolicited search tool calls, primary-path designs that only emit tracks after full-clip STT, unauthenticated persist, or any path that falls back to a shared schema.

---

## 9. Decisions (locked / approved / still open)

### Locked (do not re-litigate without user)

| Decision | Lock |
| --- | --- |
| Approach | Foundation LLM + strict user-only memory/RAG; **no fine-tuning for v1** |
| Ghost boundary | Default no invention; memory sole personal truth; **grounded assisted search** only on stuck/explicit-help; never proactive browse; coding = grounded think-through |
| Runtime | **Greenfield**; project lives on **GitHub** for now |
| Links/repos | User-supplied GitHub/URLs are first-class grounded sources with ingest + provenance |
| Realtime conversational decomposition | **Live** voice → incremental transcripts → **live tracks** (create/append/switch/move/edit); reject record-then-process as primary; batch STT is fallback only |
| User authentication required | **No anonymous storage**; nothing read/written without signed-in user |
| Auth provider | **Auth0**; GitHub social login via Auth0; `sub` → schema; JWT binds all paths |
| Per-user owned memory store | Continuous learning updates only that user’s store; no shared pool / cross-user reads / global training dump |
| Memory isolation | **(b) schema-per-user** on **Supabase** Postgres + role grants + RLS second check + fail closed; `SET LOCAL` per transaction; account delete = `DROP SCHEMA` + drop role + Auth0 revoke |
| Model provider | **Gemini** everywhere (Live + text + embeddings)—not OpenAI |
| Assisted search provider | **Exa** (memory-conditioned + find-similar; gated by §5.4) |

### APPROVED / LOCKED stack (build with these)

| Piece | Choice |
| --- | --- |
| App | **Next.js** on **GitHub** |
| Auth | **Auth0** (GitHub social optional via Auth0)—**not** Supabase Auth |
| Realtime voice (primary) | **Gemini Live API** + **function calling** for tracks; **session resumption** for Live session time limits |
| Batch STT (fallback only) | Degraded batch STT when Live unavailable (prefer resumption over batch) |
| Chat LLM | **Gemini** text models (tool/JSON / function calling as needed) |
| Embeddings | **Gemini** embeddings → per-schema `pgvector` |
| Database | **Supabase** hosted Postgres + **`pgvector`**, **schema-per-user**; direct `DATABASE_URL` |
| DB access / migrations | **Drizzle** or **raw SQL** only—**no supabase-js** data layer; per-tx `SET LOCAL ROLE` / `search_path` for the pooler |
| Portability | **Neon** possible later via same `DATABASE_URL` + schema-per-user patterns |
| Web search | **Exa**, gated by §5.4 (stuck/explicit-help); memory-conditioned queries + find-similar on linked repo/portfolio URLs + similarity filter vs memory |
| GitHub ingest | **Public GitHub API** (+ shallow clone/README/tree) on user-added repos |

### Still open (UX / ops)

| Decision | Notes |
| --- | --- |
| Private repo auth | Defer; public-only first cut; GitHub OAuth/App later |
| Confirm UX | Inline chips vs always-ask for extracts / first assisted search |
| Retention TTLs | Soft-delete entities; short TTL for raw realtime audio / search events |
| Citation UX | Soft provenance vs explicit ids in UI |
| Track-switch sensitivity | Prefer existing-track + short confirm when ambiguous |
| Live draft acceptance | Auto-keep at session end vs explicit accept per track |

Do not reopen LOCKED/APPROVED rows without the user. **OpenAI is not the stack.** Scale caveat remains: per-schema migrations are OK for the hackathon; automate fan-out before large user counts.

---

## Implementation checklist (concrete)

1. **Auth0 wall** on Next.js: verify JWT server-side; map `sub` → `user_<id>`; never trust client schema/`user_id`  
2. **Supabase** Postgres schema-per-user on first login (before Live): `CREATE SCHEMA`, per-user role + grants, migrate tables + `pgvector`; per-tx `SET LOCAL ROLE`/`search_path`; fail closed if missing; **no supabase-js / no Supabase Auth**  
3. Defense in depth: role grants + `user_id` RLS second check; account delete = `DROP SCHEMA` + drop role + Auth0 revoke + blob wipe  
4. **Gemini Live** session (+ function calling for tracks, **session resumption** on time limits) → partial transcripts → live track events → writes into that schema only  
5. Track model + switch detection; provenance with `transcript_span`  
6. Write pipelines: chat, Live, files, **public GitHub ingest** → **Gemini** embeddings/chunks in-schema (**continuous learning**)  
7. Batch STT labeled **degraded fallback only**; **Gemini** text for non-realtime turns  
8. **Exa** gated search (§5.4): memory-conditioned + find-similar + similarity filter; **off** by default  
9. Eval suite from §8 (signed-out denied, A↛B schema, wrong-schema role deny, account wipe, Exa search-gate, Live tracks)  

---

## Summary recommendation

Ship **Next.js + Auth0 + Gemini (Live/text/embeddings) + Supabase Postgres/pgvector schema-per-user + Exa** on GitHub: each Auth0 `sub` gets schema `user_<id>` with role isolation, `SET LOCAL` pooler binding, and RLS fallback; Deep Thinking is **Gemini Live** (stream → function-called tracks, resumable sessions) without inventing themes. Continuous learning updates only that schema. Allow the web **only** via Exa on stuck/explicit-help, tied to past work (find-similar + memory similarity). Ghost data and cross-user leakage are prevented by fail-closed auth, schema/role boundaries, citation rules, and the eval suite above.
