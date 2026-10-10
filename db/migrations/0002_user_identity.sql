-- Stores each user's email and name next to their Auth0 sub, and allows one
-- account per email (case-insensitive). Additive: app.provision_user(sub)
-- keeps working, so older code runs unchanged until it switches to
-- app.register_user.

alter table app.users
  add column if not exists email          text,
  add column if not exists name           text,
  add column if not exists email_verified boolean,
  add column if not exists last_login_at  timestamptz;

create unique index if not exists users_email_key on app.users (lower(email)) where email is not null;

-- Registers (or refreshes) a signed-in user. Refuses, before creating
-- anything, when the email already belongs to a different sub. The app only
-- passes emails Auth0 has verified, so nobody can claim someone else's address.
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
  begin
    update app.users
       set email = e, name = nullif(btrim(p_name), ''), email_verified = p_email_verified, last_login_at = now()
     where sub = p_sub;
  exception
    -- Two first logins with the same email at the same moment: the index catches it.
    when unique_violation then
      raise exception 'email already linked to another account' using errcode = 'BS409';
  end;
  return s;
end
$fn$;
alter function app.register_user(text, text, text, boolean) owner to brainstorm_migrator;
revoke all on function app.register_user(text, text, text, boolean) from public;
grant execute on function app.register_user(text, text, text, boolean) to brainstorm_app;
