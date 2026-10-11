# CLAUDE, stop touching my css!

# Features
* Minimalist design
  *	4 button menu bar
*	Deep Thinking AI that accepts audio conversations
* Memory capability
*	Organized thoughts/ideas tracking
*	Project Visualization
*	Project decomposition for distinct features
*	User Authentication
*	Sleek and modern Animation
  *	Cool tones
  *	Shifting gradients of bubbles similar to Gemini but full screen
  *	Menu bar: shifting gradients not same to background (translucent appearance with added shadows on the edges)
* Personalized and versatile creative experience 
*	File processing

# Tools:
* Next
* Auth0
* gemini
* Supabase
* Drizzle
* Exa
This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Local setup

1. `npm install`
2. Copy `.env.example` to `.env.local` and fill in the values. `.env.local` is git-ignored, so keys never reach the repo.
   For Supabase, follow [db/README.md](db/README.md): it runs `npm run db:migrate` and sets up the app's database role.
3. Run the checks for the keys you've filled in:
   - `npm run check:gemini` confirms the Gemini key and model id.
   - `npm run check:db` confirms both Supabase Postgres connection strings (and that pgvector is available).
   - `npm run check:storage` confirms the Supabase secret key and that the private uploads bucket exists.
   - `npm run check:exa` confirms the Exa key with one small search.
4. `npm run dev`

On Vercel, add the same variables under Project → Settings → Environment Variables and mark the keys Sensitive. `DIRECT_DATABASE_URL` is only needed where migrations run.

All service code lives in `src/lib` and is server-only (`import "server-only"`), so keys can't end up in the browser bundle:

| File | Service | Env vars |
| --- | --- | --- |
| `gemini.ts` | Gemini | `GEMINI_API_KEY`, `GEMINI_*_MODEL` |
| `db.ts` | Supabase Postgres through Drizzle, one schema per user with RLS | `DATABASE_URL` (app), `DIRECT_DATABASE_URL` (migrations) |
| `supabase-storage.ts` | Supabase Storage (uploaded files) | `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_STORAGE_BUCKET` |
| `exa.ts` | Exa search and page contents | `EXA_API_KEY` |

Drizzle has no API key of its own; it uses the Supabase Postgres connection string. We don't use supabase-js or Supabase Auth (Auth0 handles sign-in).

## Backend API

Every route below needs an Auth0 session (401 otherwise) and only ever sees the
signed-in user's own schema. The first call provisions that schema.

| Route | Methods | What it does |
| --- | --- | --- |
| `/api/health` | GET | Public. Which services are configured and reachable (no values). |
| `/api/me` | GET | Signed-in user and their profile. |
| `/api/profile` | GET, PUT | Read or save the profile (including `learningEnabled`). |
| `/api/projects`, `/api/projects/:id`, `/api/projects/:id/tasks`, `/api/tasks/:id` | CRUD | Projects, sub-projects and tasks. |
| `/api/tracks`, `/api/tracks/:id`, `/api/tracks/:id/items`, `/api/track-items/:id` | CRUD | Deep Thinking tracks and their items (move an item by PATCHing `trackId`). |
| `/api/live/token` | POST | One-use Gemini Live token for the browser socket. |
| `/api/live/context` | GET | Gemini Live instructions for this user, built from what Clutter understands about them. |
| `/api/live/tracks` | POST | Gemini Flash sorts new transcript text into track changes and says if the user asked for a reply. |
| `/api/live/learn` | POST | Saves lasting facts about the user from what they said (skipped when learning is off). |
| `/api/facts`, `/api/facts/:id` | GET, DELETE | What Clutter learned from conversations; the user can forget any of it. |
| `/api/profile/understanding` | POST | Rebuilds the summary of the user from their profile, links, files and learned facts. |
| `/api/live/sessions`, `/api/live/sessions/:id`, `/api/live/sessions/:id/transcripts` | GET, POST, PATCH | Voice sessions and their text transcripts (no audio is stored). |
| `/api/memory`, `/api/memory/search?q=` | POST, GET | Index text into memory; semantic search over the user's own memory. |
| `/api/search` | POST | Exa search, only when the user is stuck and asks (`query` + `triggerText`). |
| `/api/links`, `/api/links/:id`, `/api/links/:id/fetch` | GET, POST, DELETE | Saved links; fetch reads GitHub repos via the GitHub API and other pages via Exa, then indexes them. |
| `/api/files`, `/api/files/:id` | GET, POST, DELETE | Uploads (10 MB max) to private Storage; text is extracted (PDF, Word, text, images) and indexed. |
| `/api/reflections`, `/api/achievements` | GET, POST | The user's own answers and past wins. |
| `/api/account` | DELETE | Deletes the user's files, schema and registry row. |
