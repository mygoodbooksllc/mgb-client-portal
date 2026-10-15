-- staff_missing_auth() security and behaviour tests.
-- NOT a migration. Run in the Supabase SQL editor (or psql as postgres)
-- AFTER staff-auth-repair.sql is applied. Everything runs inside one
-- transaction that ends in ROLLBACK, so no fixture survives (including the
-- auth.users row made in step 5). Each check raises 'FAIL n: ...' on
-- failure; a clean run ends with the notice
-- 'staff-auth-repair tests: all passed' and then rolls back.
--
-- Identity switching as in qbo-env-per-connection-tests.sql: `set local
-- role authenticated|anon` plus request.jwt.claims (what auth.jwt() reads),
-- and `reset role` back to postgres for fixtures. Staff claims carry
-- app_metadata google because is_active_staff_admin() requires
-- jwt_has_google().
--
-- Fixtures (all zz-authfix-*, @mygoodbooks.org because of the
-- staff_email_domain CHECK; none has an auth.users row):
--   zz-authfix-test@mygoodbooks.org    active bookkeeper, no sign-in account
--   zz-authfix-off@mygoodbooks.org     inactive bookkeeper, no account
--   zz-authfix-admin@mygoodbooks.org   active admin (the caller)
--   zz-authfix-bk@mygoodbooks.org      active bookkeeper (non-admin caller)

begin;

insert into public.staff (email, name, role, active) values
  ('zz-authfix-test@mygoodbooks.org', 'ZZ Authfix Test', 'bookkeeper', true),
  ('zz-authfix-off@mygoodbooks.org', 'ZZ Authfix Off', 'bookkeeper', false),
  ('zz-authfix-admin@mygoodbooks.org', 'ZZ Authfix Admin', 'admin', true),
  ('zz-authfix-bk@mygoodbooks.org', 'ZZ Authfix Bookkeeper', 'bookkeeper', true);

do $$
begin
  -- 0. Grants: anon can't execute, authenticated can, it's SECURITY DEFINER.
  if has_function_privilege('anon', 'public.staff_missing_auth()', 'execute') then
    raise exception 'FAIL 0a: anon can execute staff_missing_auth()';
  end if;
  if not has_function_privilege('authenticated', 'public.staff_missing_auth()', 'execute') then
    raise exception 'FAIL 0b: authenticated cannot execute staff_missing_auth()';
  end if;
  if not (select prosecdef from pg_proc where oid = 'public.staff_missing_auth()'::regprocedure) then
    raise exception 'FAIL 0c: staff_missing_auth() is not SECURITY DEFINER';
  end if;
end
$$;

-- 1. anon: no execute grant.
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$
begin
  begin
    perform * from public.staff_missing_auth();
    raise exception 'FAIL 1: anon ran staff_missing_auth()';
  exception when insufficient_privilege then null;
  end;
end
$$;

-- 2. An active bookkeeper (signed in with Google) is refused.
reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"role":"authenticated","email":"zz-authfix-bk@mygoodbooks.org","app_metadata":{"provider":"google","providers":["google"]}}', true);
do $$
begin
  begin
    perform * from public.staff_missing_auth();
    raise exception 'FAIL 2: a bookkeeper ran staff_missing_auth()';
  exception when insufficient_privilege then null;
  end;
end
$$;

-- 3. jwt_has_google() means "Google has EVER been linked to this account"
--    (it checks app_metadata.providers), not "this session is Google".
--    Note: Supabase puts every linked provider in that list, so an admin who
--    has used Google once and is now in an email-code session carries
--    provider "email", providers ["email","google"] and IS allowed (3a).
--    Only an account Google was never linked to is refused (3b). That's the
--    same rule as is_active_staff_admin() everywhere else.
select set_config('request.jwt.claims',
  '{"role":"authenticated","email":"zz-authfix-admin@mygoodbooks.org","app_metadata":{"provider":"email","providers":["email","google"]}}', true);
do $$
begin
  perform * from public.staff_missing_auth();  -- raises if refused
exception when insufficient_privilege then
  raise exception 'FAIL 3a: admin with Google linked (email-code session) was refused';
end
$$;

select set_config('request.jwt.claims',
  '{"role":"authenticated","email":"zz-authfix-admin@mygoodbooks.org","app_metadata":{"provider":"email","providers":["email"]}}', true);
do $$
begin
  begin
    perform * from public.staff_missing_auth();
    raise exception 'FAIL 3b: an admin account Google was never linked to ran staff_missing_auth()';
  exception when insufficient_privilege then null;
  end;
end
$$;

-- 4. The admin (Google) sees the active test row, not the inactive one.
select set_config('request.jwt.claims',
  '{"role":"authenticated","email":"zz-authfix-admin@mygoodbooks.org","app_metadata":{"provider":"google","providers":["google"]}}', true);
do $$
begin
  if not exists (select 1 from public.staff_missing_auth()
                  where email = 'zz-authfix-test@mygoodbooks.org'
                    and name = 'ZZ Authfix Test' and role = 'bookkeeper') then
    raise exception 'FAIL 4a: admin does not see zz-authfix-test as missing a sign-in account';
  end if;
  if exists (select 1 from public.staff_missing_auth()
              where email = 'zz-authfix-off@mygoodbooks.org') then
    raise exception 'FAIL 4b: an inactive staff row was listed';
  end if;
end
$$;

-- 5. Once a matching auth.users row exists (different case), it's gone.
reset role;
insert into auth.users (id, aud, role, email)
values (gen_random_uuid(), 'authenticated', 'authenticated', 'ZZ-AuthFix-Test@MyGoodBooks.org');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"role":"authenticated","email":"zz-authfix-admin@mygoodbooks.org","app_metadata":{"provider":"google","providers":["google"]}}', true);
do $$
begin
  if exists (select 1 from public.staff_missing_auth()
              where email = 'zz-authfix-test@mygoodbooks.org') then
    raise exception 'FAIL 5: still listed after a (case-different) auth.users row exists';
  end if;
  if not exists (select 1 from public.staff_missing_auth()
                  where email = 'zz-authfix-bk@mygoodbooks.org') then
    raise exception 'FAIL 5b: other missing staff disappeared too';
  end if;
  raise notice 'staff-auth-repair tests: all passed';
end
$$;

rollback;
