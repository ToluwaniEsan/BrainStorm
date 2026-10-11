-- What BrainStorm learns about each user. Additive.
--  * profile.learning_enabled: when false, nothing new is learned from
--    conversations; only what the user gives directly is used.
--  * profile.understanding: a short summary of the user, rebuilt from their
--    profile, links, files and learned facts.
--  * user_facts: things learned about the user, each with where it came from,
--    so they can see and delete every one.
-- app.upgrade_user adds these to a user's schema; register_user calls it on
-- every sign-in, and this migration runs it once for every existing user.

create or replace function app.upgrade_user(p_sub text) returns void
language plpgsql security definer
set search_path = pg_catalog
as $fn$
declare
  s text := app.schema_for(p_sub);
begin
  execute format($t$
    alter table %1$I.profile
      add column if not exists learning_enabled boolean not null default true,
      add column if not exists understanding text,
      add column if not exists understanding_updated_at timestamptz;
    create table if not exists %1$I.user_facts (
      id uuid primary key default gen_random_uuid(),
      owner_sub text not null default current_setting('app.sub', true) check (owner_sub = %2$L),
      fact text not null,
      source_type text not null,
      source_id uuid,
      created_at timestamptz not null default now()
    );
  $t$, s, p_sub);
  execute format('alter table %I.user_facts enable row level security', s);
  execute format('alter table %I.user_facts force row level security', s);
  if not exists (select from pg_policies where schemaname = s and tablename = 'user_facts' and policyname = 'owner_only') then
    execute format(
      'create policy owner_only on %I.user_facts for all to brainstorm_app
         using (owner_sub = current_setting(''app.sub'', true))
         with check (owner_sub = current_setting(''app.sub'', true))', s);
  end if;
  execute format('grant select, insert, update, delete on %I.user_facts to brainstorm_app', s);
end
$fn$;
alter function app.upgrade_user(text) owner to brainstorm_migrator;
revoke all on function app.upgrade_user(text) from public;

-- Same as 0002, plus the upgrade step.
create or replace function app.register_user(p_sub text, p_email text, p_name text, p_email_verified boolean)
returns text
language plpgsql security definer
set search_path = pg_catalog
as $fn$
declare
  s text;
  e text := nullif(btrim(p_email), '');
begin
  if e is not null and exists (select from app.users where lower(email) = lower(e) and sub <> p_sub) then
    raise exception 'email already linked to another account' using errcode = 'BS409';
  end if;

  s := app.provision_user(p_sub);
  perform app.upgrade_user(p_sub);
  begin
    update app.users
       set email = e, name = nullif(btrim(p_name), ''), email_verified = p_email_verified, last_login_at = now()
     where sub = p_sub;
  exception
    when unique_violation then
      raise exception 'email already linked to another account' using errcode = 'BS409';
  end;
  return s;
end
$fn$;
alter function app.register_user(text, text, text, boolean) owner to brainstorm_migrator;
revoke all on function app.register_user(text, text, text, boolean) from public;
grant execute on function app.register_user(text, text, text, boolean) to brainstorm_app;

-- Existing users get the new columns and table now.
do $$
declare r record;
begin
  for r in select sub from app.users loop
    perform app.provision_user(r.sub);
    perform app.upgrade_user(r.sub);
  end loop;
end $$;
