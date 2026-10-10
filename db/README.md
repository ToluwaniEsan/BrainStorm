# Supabase setup

This sets Supabase up the way the plan describes: pgvector, one schema per user,
forced row-level security keyed to the Auth0 `sub`, an app role that owns
nothing, and a private Storage bucket. Supabase Auth and supabase-js aren't used.

## 1. Create the project (dashboard)

1. New project. Pick the region closest to your Vercel region (e.g. East US for `iad1`).
2. Set a strong **database password** and keep it in your password manager. It goes into `DIRECT_DATABASE_URL`.
3. Optional hardening: Project Settings → Data API → turn the Data API off. The app never uses it.

## 2. Point the migrator at the database

In `.env.local`, set `DIRECT_DATABASE_URL`: Connect (top bar) → Connection String →
**Session pooler** (port 5432), with your database password filled in.

## 3. Run the migrations

```bash
npm run db:migrate
```

`db/migrations/0001_foundation.sql` creates:

- the `vector` extension in the `extensions` schema
- `brainstorm_migrator` (owns every table) and `brainstorm_app` (what the app logs in as; owns nothing, so RLS always applies)
- `app.users`, the registry mapping each Auth0 `sub` to `user_<hash>`
- `app.provision_user(sub)`, which builds a user's schema and tables with `FORCE ROW LEVEL SECURITY` and an `owner_sub` policy; the app calls it on first sign-in
- `app.delete_user(sub)` for account deletion
- the private `uploads` Storage bucket

It's safe to run again.

## 4. Give the app role a password (SQL editor)

Open SQL Editor and run this once, with a new long random password (not your database password):

```sql
alter role brainstorm_app with login password 'PASTE-A-NEW-PASSWORD';
```

Keep that password out of git and chat.

## 5. Point the app at the database

In `.env.local` and Vercel, set `DATABASE_URL` to the **Transaction pooler** string (port 6543),
changing the user to `brainstorm_app.<project-ref>` and the password to the one from step 4:

```
postgresql://brainstorm_app.<project-ref>:<app-password>@<pooler-host>:6543/postgres
```

## 6. Check it

```bash
npm run check:db       # both URLs connect; DATABASE_URL must be brainstorm_app
npm run check:storage  # secret key works, uploads bucket exists and is private
```

## How a request uses it

`src/lib/db.ts`: `provisionUser(sub)` on sign-in, then `withUser(sub, tx => ...)`
for every query. It sets `app.sub` and `search_path` for that transaction only.
Rows another user tries to read come back empty, and inserts into someone
else's schema are rejected.
