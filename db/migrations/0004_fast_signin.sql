-- Fast sign-in. register_user used to rebuild the user's whole schema on every
-- call (create/alter table, enable RLS, grants). Those statements take
-- exclusive locks on every one of the user's tables, so each page load queued
-- behind (and blocked) the user's own reads and writes: in pg_stat_statements
-- register_user averaged ~0.6 s and its advisory lock ~2.5 s, with waits up
-- to two minutes.
--
-- Now app.users remembers which schema version each user is on, and the DDL
-- only runs when that is behind. A normal sign-in or page load is one indexed
-- lookup and one update.
--
-- Also stops stuck connections from holding locks for minutes (bottom).
--
-- When a later migration changes the per-user schema: add the change to
-- app.upgrade_user and bump the version number below (both places).

-- Don't queue behind a stuck session: a waiting ALTER would block every
-- other query on app.users. Fail fast instead and rerun.
set local lock_timeout = '5s';

alter table app.users add column if not exists schema_version int not null default 0;

-- Same as 0003, with the version check.
create or replace function app.register_user(p_sub text, p_email text, p_name text, p_email_verified boolean)
returns text
language plpgsql security definer
set search_path = pg_catalog
as $fn$
declare
  current_version constant int := 1;
  s text;
  v int;
  e text := nullif(btrim(p_email), '');
begin
  if e is not null and exists (select from app.users where lower(email) = lower(e) and sub <> p_sub) then
    raise exception 'email already linked to another account' using errcode = 'BS409';
  end if;

  select schema_name, schema_version into s, v from app.users where sub = p_sub;
  if s is null or v < current_version then
    s := app.provision_user(p_sub);
    perform app.upgrade_user(p_sub);
    update app.users set schema_version = current_version where sub = p_sub;
  end if;

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

-- Everyone already registered was brought up to date by 0003.
update app.users set schema_version = 1 where schema_version < 1;

-- A request that dies mid-transaction (Vercel stops the function, the browser
-- navigates away) left its connection "idle in transaction" for minutes,
-- holding the user's locks, so every later page load for that user waited.
-- These end such a transaction after 15 s and make a query give up after
-- waiting 10 s for a lock, instead of hanging. They apply to new database
-- connections as the pooler opens them.
alter role brainstorm_app set idle_in_transaction_session_timeout = '15s';
alter role brainstorm_app set lock_timeout = '10s';
