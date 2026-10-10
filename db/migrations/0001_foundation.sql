-- BrainStorm database foundation: pgvector, roles, the user registry, and
-- per-user schema provisioning with forced row-level security.
-- Applied by `npm run db:migrate` as the Supabase `postgres` user over DIRECT_DATABASE_URL.

create extension if not exists vector with schema extensions;

-- Roles ---------------------------------------------------------------------
-- brainstorm_migrator owns every table, so RLS can be forced on everyone else.
-- brainstorm_app is what the running app logs in as (DATABASE_URL). It owns
-- nothing and has no BYPASSRLS, so the policies always apply to it.
-- Its password is set by hand in the SQL editor, never in this file.
do $$
begin
  if not exists (select from pg_roles where rolname = 'brainstorm_migrator') then
    create role brainstorm_migrator nologin;
  end if;
  if not exists (select from pg_roles where rolname = 'brainstorm_app') then
    create role brainstorm_app nologin noinherit;
  end if;
end $$;

grant brainstorm_migrator to current_user;

do $$
begin
  execute format('grant create on database %I to brainstorm_migrator', current_database());
end $$;

grant usage on schema extensions to brainstorm_migrator, brainstorm_app;

-- Registry ------------------------------------------------------------------
-- Maps each Auth0 `sub` to its schema. Only the functions below write it.
create schema if not exists app authorization brainstorm_migrator;
revoke all on schema app from public;

create table if not exists app.users (
  sub         text primary key,
  schema_name text not null unique,
  created_at  timestamptz not null default now()
);
alter table app.users owner to brainstorm_migrator;
revoke all on app.users from public;

-- Schema name is derived from the sub on the server, never taken from the client.
-- Must match schemaForSub() in src/lib/db.ts.
create or replace function app.schema_for(p_sub text) returns text
language sql immutable strict
set search_path = pg_catalog
as $$ select 'user_' || left(encode(sha256(convert_to(p_sub, 'UTF8')), 'hex'), 32) $$;
alter function app.schema_for(text) owner to brainstorm_migrator;

-- Provisioning ----------------------------------------------------------------
-- Creates (or upgrades) one user's schema. Safe to run again: every statement
-- is idempotent, so new tables added here reach existing users on next call.
create or replace function app.provision_user(p_sub text) returns text
language plpgsql security definer
set search_path = pg_catalog, extensions
as $fn$
declare
  s text := app.schema_for(p_sub);
  t text;
  tables text[] := array[
    'profile', 'projects', 'tasks', 'tracks', 'track_items', 'live_sessions',
    'transcripts', 'files', 'links', 'reflections', 'achievements',
    'search_events', 'memory_chunks'
  ];
begin
  if p_sub is null or length(p_sub) = 0 then
    raise exception 'sub is required';
  end if;

  insert into app.users (sub, schema_name) values (p_sub, s) on conflict (sub) do nothing;
  execute format('create schema if not exists %I authorization brainstorm_migrator', s);
  execute format('revoke all on schema %I from public', s);
  execute format('grant usage on schema %I to brainstorm_app', s);

  -- Every table carries owner_sub, filled from the per-request app.sub setting.
  -- If app.sub isn't set the insert fails (fail closed), and the check pins
  -- each schema to its one owner so no other user's rows can land in it.
  execute format($t$
    create table if not exists %1$I.profile (
      id uuid primary key default gen_random_uuid(),
      owner_sub text not null default current_setting('app.sub', true) check (owner_sub = %2$L),
      display_name text, intro text, portfolio text, about_work text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create table if not exists %1$I.projects (
      id uuid primary key default gen_random_uuid(),
      owner_sub text not null default current_setting('app.sub', true) check (owner_sub = %2$L),
      parent_id uuid references %1$I.projects(id) on delete set null,
      title text not null, description text, status text not null default 'active',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create table if not exists %1$I.tasks (
      id uuid primary key default gen_random_uuid(),
      owner_sub text not null default current_setting('app.sub', true) check (owner_sub = %2$L),
      project_id uuid not null references %1$I.projects(id) on delete cascade,
      title text not null, notes text, status text not null default 'todo',
      tech_stack text[] not null default '{}', sort_order int not null default 0,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create table if not exists %1$I.live_sessions (
      id uuid primary key default gen_random_uuid(),
      owner_sub text not null default current_setting('app.sub', true) check (owner_sub = %2$L),
      project_id uuid references %1$I.projects(id) on delete set null,
      started_at timestamptz not null default now(), ended_at timestamptz
    );
    create table if not exists %1$I.transcripts (
      id uuid primary key default gen_random_uuid(),
      owner_sub text not null default current_setting('app.sub', true) check (owner_sub = %2$L),
      session_id uuid not null references %1$I.live_sessions(id) on delete cascade,
      body text not null, is_final boolean not null default false,
      spoken_at timestamptz not null default now()
    );
    create table if not exists %1$I.tracks (
      id uuid primary key default gen_random_uuid(),
      owner_sub text not null default current_setting('app.sub', true) check (owner_sub = %2$L),
      project_id uuid references %1$I.projects(id) on delete set null,
      title text not null, sort_order int not null default 0,
      is_active boolean not null default false,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create table if not exists %1$I.track_items (
      id uuid primary key default gen_random_uuid(),
      owner_sub text not null default current_setting('app.sub', true) check (owner_sub = %2$L),
      track_id uuid not null references %1$I.tracks(id) on delete cascade,
      session_id uuid references %1$I.live_sessions(id) on delete set null,
      body text not null, sort_order int not null default 0,
      confidence text not null default 'live_draft',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create table if not exists %1$I.files (
      id uuid primary key default gen_random_uuid(),
      owner_sub text not null default current_setting('app.sub', true) check (owner_sub = %2$L),
      filename text not null, mime_type text not null, size_bytes bigint,
      storage_path text not null, compression text, extracted_text text, summary text,
      created_at timestamptz not null default now()
    );
    create table if not exists %1$I.links (
      id uuid primary key default gen_random_uuid(),
      owner_sub text not null default current_setting('app.sub', true) check (owner_sub = %2$L),
      url text not null, kind text not null default 'web', title text,
      snapshot text, fetched_at timestamptz,
      created_at timestamptz not null default now()
    );
    create table if not exists %1$I.reflections (
      id uuid primary key default gen_random_uuid(),
      owner_sub text not null default current_setting('app.sub', true) check (owner_sub = %2$L),
      question text not null, answer text, themes text[] not null default '{}',
      created_at timestamptz not null default now()
    );
    create table if not exists %1$I.achievements (
      id uuid primary key default gen_random_uuid(),
      owner_sub text not null default current_setting('app.sub', true) check (owner_sub = %2$L),
      title text not null, detail text, achieved_on date,
      created_at timestamptz not null default now()
    );
    create table if not exists %1$I.search_events (
      id uuid primary key default gen_random_uuid(),
      owner_sub text not null default current_setting('app.sub', true) check (owner_sub = %2$L),
      trigger_text text not null, query text not null,
      result_urls text[] not null default '{}',
      created_at timestamptz not null default now()
    );
    -- 768-dim gemini-embedding-001 vectors; source_* points back at the row
    -- the text came from (provenance).
    create table if not exists %1$I.memory_chunks (
      id uuid primary key default gen_random_uuid(),
      owner_sub text not null default current_setting('app.sub', true) check (owner_sub = %2$L),
      source_type text not null, source_table text not null, source_id uuid not null,
      body text not null, embedding extensions.vector(768),
      created_at timestamptz not null default now()
    );
    create index if not exists memory_chunks_embedding_idx
      on %1$I.memory_chunks using hnsw (embedding extensions.vector_cosine_ops);
  $t$, s, p_sub);

  foreach t in array tables loop
    execute format('alter table %I.%I enable row level security', s, t);
    execute format('alter table %I.%I force row level security', s, t);
    if not exists (select from pg_policies where schemaname = s and tablename = t and policyname = 'owner_only') then
      execute format(
        'create policy owner_only on %I.%I for all to brainstorm_app
           using (owner_sub = current_setting(''app.sub'', true))
           with check (owner_sub = current_setting(''app.sub'', true))', s, t);
    end if;
    execute format('grant select, insert, update, delete on %I.%I to brainstorm_app', s, t);
  end loop;

  return s;
end
$fn$;
alter function app.provision_user(text) owner to brainstorm_migrator;

-- Account delete: drops the schema and the registry row. Storage files and
-- Auth0/Adobe tokens are cleaned up by the app.
create or replace function app.delete_user(p_sub text) returns void
language plpgsql security definer
set search_path = pg_catalog
as $fn$
begin
  execute format('drop schema if exists %I cascade', app.schema_for(p_sub));
  delete from app.users where sub = p_sub;
end
$fn$;
alter function app.delete_user(text) owner to brainstorm_migrator;

revoke all on function app.schema_for(text), app.provision_user(text), app.delete_user(text) from public;
grant usage on schema app to brainstorm_app;
grant execute on function app.schema_for(text), app.provision_user(text), app.delete_user(text) to brainstorm_app;

-- Storage ---------------------------------------------------------------------
-- Private bucket for uploaded files (never voice audio). Only the server, with
-- the secret key, reads or writes it. Skipped on plain Postgres without Storage.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public)
    values ('uploads', 'uploads', false)
    on conflict (id) do update set public = false;
  end if;
end $$;
