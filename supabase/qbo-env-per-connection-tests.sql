-- QuickBooks per-connection environment: RLS and RPC security tests.
-- NOT a migration. Run in the Supabase SQL editor (or psql as postgres) on a
-- branch or staging project AFTER qbo-env-per-connection.sql is applied.
-- Everything runs inside one transaction that ends in ROLLBACK, so no fixture
-- survives. Each check raises 'FAIL n: ...' on failure; a clean run ends with
-- the notice 'qbo-env tests: all passed' and then rolls back.
--
-- Identity switching: `set local role authenticated|anon` plus
-- request.jwt.claims (what auth.jwt() reads), and `reset role` back to
-- postgres for fixtures and for reading the state tables (which no longer
-- grant anything to anon/authenticated). Tokens minted as a user are passed
-- back to the postgres checks through transaction-local settings
-- (qbotest.*), never printed.
--
-- Fixtures (all qbotest-*; staff emails must be @mygoodbooks.org because of
-- the staff_email_domain CHECK, and staff claims carry app_metadata google
-- because is_active_staff() requires jwt_has_google()):
--   qbotest-test   client, test_only = true   -> sandbox
--   qbotest-real   client, test_only = false  -> production; has an
--                  existing qbo_connections row in status 'error'
--   qbotest-other  client the bookkeeper has no access to
--   qbotest-bk@mygoodbooks.org        bookkeeper with access to -test and -real
--   qbotest-off@mygoodbooks.org       inactive bookkeeper with access to -test
--   qbotest-admin@mygoodbooks.org     admin
--   qbotest-client@example.test    portal user of qbotest-real (not staff)

begin;

-- ===========================================================================
-- Fixtures (as postgres)
-- ===========================================================================
insert into public.clients (id, name, org_type, test_only) values
  ('qbotest-test', 'QBO Env Test (sandbox)', 'nonprofit', true),
  ('qbotest-real', 'QBO Env Test (real)', 'nonprofit', false),
  ('qbotest-other', 'QBO Env Test (other)', 'nonprofit', false);
insert into public.staff (email, name, role, active) values
  ('qbotest-bk@mygoodbooks.org', 'QBO Bookkeeper', 'bookkeeper', true),
  ('qbotest-off@mygoodbooks.org', 'QBO Inactive', 'bookkeeper', false),
  ('qbotest-admin@mygoodbooks.org', 'QBO Admin', 'admin', true);
insert into public.staff_client_access (staff_email, client_id) values
  ('qbotest-bk@mygoodbooks.org', 'qbotest-test'),
  ('qbotest-bk@mygoodbooks.org', 'qbotest-real'),
  ('qbotest-off@mygoodbooks.org', 'qbotest-test');
insert into public.client_users (email, client_id, name, role, active) values
  ('qbotest-client@example.test', 'qbotest-real', 'QBO Client', 'admin', true);
-- A connection stuck in 'error' from an earlier failed attempt.
insert into public.qbo_connections (client_id, status, last_error) values
  ('qbotest-real', 'error', 'token exchange failed (400)')
  on conflict (client_id) do update set status = 'error', last_error = excluded.last_error;

do $$
begin
  -- 0. Schema: the old browser-supplied-client-id firm RPC is gone, the
  --    insert policy is gone, and the rule function is right.
  if to_regprocedure('public.qbo_firm_connect_start(text)') is not null then
    raise exception 'FAIL 0a: qbo_firm_connect_start(text) still exists';
  end if;
  if exists (select 1 from pg_policies where tablename = 'qbo_connect_state'
              and policyname = 'staff create qbo connect state') then
    raise exception 'FAIL 0b: insert policy still present';
  end if;
  if public.qbo_env_for_client(true) <> 'sandbox'
     or public.qbo_env_for_client(false) <> 'production'
     or public.qbo_env_for_client(null) <> 'production' then
    raise exception 'FAIL 0c: qbo_env_for_client rule is wrong';
  end if;
  begin
    insert into public.qbo_connect_state (token, client_id, api_env) values ('qbotest-bad-env', 'qbotest-test', 'dev');
    raise exception 'FAIL 0d: api_env accepted a value other than sandbox/production';
  exception when check_violation then null; end;
end
$$;

-- ===========================================================================
-- anon
-- ===========================================================================
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$
begin
  -- 1. anon can't call either RPC or touch either table.
  begin
    perform public.qbo_connect_start('qbotest-test');
    raise exception 'FAIL 1a: anon called qbo_connect_start';
  exception when insufficient_privilege then null; end;
  begin
    perform public.qbo_firm_connect_start();
    raise exception 'FAIL 1b: anon called qbo_firm_connect_start';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.qbo_connect_state (token, client_id) values ('qbotest-anon', 'qbotest-test');
    raise exception 'FAIL 1c: anon inserted into qbo_connect_state';
  exception when insufficient_privilege then null; end;
  begin
    perform 1 from public.qbo_connect_state limit 1;
    raise exception 'FAIL 1d: anon can select qbo_connect_state';
  exception when insufficient_privilege then null; end;
end
$$;
reset role;

-- ===========================================================================
-- Non-staff (portal user of qbotest-real)
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"email":"qbotest-client@example.test","role":"authenticated","app_metadata":{"provider":"google","providers":["google"]}}', true);
do $$
begin
  -- 2. A client user can't start a connect, even for their own org.
  begin
    perform public.qbo_connect_start('qbotest-real');
    raise exception 'FAIL 2a: non-staff called qbo_connect_start';
  exception when insufficient_privilege then null; end;
  begin
    perform public.qbo_firm_connect_start();
    raise exception 'FAIL 2b: non-staff called qbo_firm_connect_start';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.qbo_connect_state (token, client_id) values ('qbotest-client', 'qbotest-real');
    raise exception 'FAIL 2c: non-staff inserted into qbo_connect_state';
  exception when insufficient_privilege then null; end;
end
$$;
reset role;

-- ===========================================================================
-- Inactive staff
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"email":"qbotest-off@mygoodbooks.org","role":"authenticated","app_metadata":{"provider":"google","providers":["google"]}}', true);
do $$
begin
  -- 3. Inactive staff are refused even with a staff_client_access row
  --    (can_access_client's sca branch doesn't check active; is_active_staff does).
  begin
    perform public.qbo_connect_start('qbotest-test');
    raise exception 'FAIL 3: inactive staff called qbo_connect_start';
  exception when insufficient_privilege then null; end;
end
$$;
reset role;

-- ===========================================================================
-- Bookkeeper
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"email":"qbotest-bk@mygoodbooks.org","role":"authenticated","app_metadata":{"provider":"google","providers":["google"]}}', true);
do $$
declare v jsonb;
begin
  -- 4. Direct insert is gone (the old browser path), for a client they CAN access.
  begin
    insert into public.qbo_connect_state (token, client_id) values ('qbotest-direct', 'qbotest-test');
    raise exception 'FAIL 4a: staff direct insert into qbo_connect_state allowed';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.qbo_firm_connect_state (token) values ('qbotest-direct-firm');
    raise exception 'FAIL 4b: staff direct insert into qbo_firm_connect_state allowed';
  exception when insufficient_privilege then null; end;
  begin
    update public.qbo_connect_state set used = false;
    raise exception 'FAIL 4c: staff update of qbo_connect_state allowed';
  exception when insufficient_privilege then null; end;

  -- 5. No access to qbotest-other -> refused (same rule as the old insert policy).
  begin
    perform public.qbo_connect_start('qbotest-other');
    raise exception 'FAIL 5a: bookkeeper started a connect for a client they cannot access';
  exception when insufficient_privilege then null; end;
  -- An unknown id is also just "not authorized" for a non-admin (no oracle).
  begin
    perform public.qbo_connect_start('qbotest-does-not-exist');
    raise exception 'FAIL 5b: unknown client id not refused';
  exception when insufficient_privilege then null; end;
  begin
    perform public.qbo_connect_start(null);
    raise exception 'FAIL 5c: null client id accepted';
  exception when sqlstate '22023' then null; end;

  -- 6. test_only client -> sandbox.
  v := public.qbo_connect_start('qbotest-test');
  if v ->> 'api_env' is distinct from 'sandbox' then raise exception 'FAIL 6a: test client got %', v ->> 'api_env'; end if;
  if coalesce(v ->> 'token', '') !~ '^[0-9a-f]{64}$' then raise exception 'FAIL 6b: token shape'; end if;
  perform set_config('qbotest.tok_sandbox', v ->> 'token', true);

  -- 7. Real client whose connection is in status 'error' -> production, not blocked.
  v := public.qbo_connect_start('qbotest-real');
  if v ->> 'api_env' is distinct from 'production' then raise exception 'FAIL 7a: real client got %', v ->> 'api_env'; end if;
  perform set_config('qbotest.tok_real', v ->> 'token', true);
  -- Twice in a row is fine (a retry after closing the Intuit tab).
  v := public.qbo_connect_start('qbotest-real');
  if v ->> 'api_env' is distinct from 'production' then raise exception 'FAIL 7b: retry got %', v ->> 'api_env'; end if;
  if v ->> 'token' = current_setting('qbotest.tok_real') then raise exception 'FAIL 7c: token reused'; end if;

  -- 8. Firm connect is admin-only.
  begin
    perform public.qbo_firm_connect_start();
    raise exception 'FAIL 8: bookkeeper called qbo_firm_connect_start';
  exception when insufficient_privilege then null; end;
end
$$;
reset role;

-- ===========================================================================
-- Admin
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"email":"qbotest-admin@mygoodbooks.org","role":"authenticated","app_metadata":{"provider":"google","providers":["google"]}}', true);
do $$
declare v jsonb;
begin
  -- 9. Firm -> production.
  v := public.qbo_firm_connect_start();
  if v ->> 'api_env' is distinct from 'production' then raise exception 'FAIL 9a: firm got %', v ->> 'api_env'; end if;
  if coalesce(v ->> 'token', '') !~ '^[0-9a-f]{64}$' then raise exception 'FAIL 9b: firm token shape'; end if;
  perform set_config('qbotest.tok_firm', v ->> 'token', true);

  -- 10. Admin reaches any client; an unknown client is P0002 for an admin.
  v := public.qbo_connect_start('qbotest-other');
  if v ->> 'api_env' is distinct from 'production' then raise exception 'FAIL 10a: admin/other got %', v ->> 'api_env'; end if;
  begin
    perform public.qbo_connect_start('qbotest-does-not-exist');
    raise exception 'FAIL 10b: admin started a connect for an unknown client';
  exception when sqlstate 'P0002' then null; end;
end
$$;
reset role;

-- ===========================================================================
-- Rows written (as postgres)
-- ===========================================================================
do $$
declare r record;
begin
  select * into r from public.qbo_connect_state where token = current_setting('qbotest.tok_sandbox');
  if not found then raise exception 'FAIL 11a: sandbox state row missing'; end if;
  if r.client_id <> 'qbotest-test' or r.api_env <> 'sandbox' or r.used
     or r.created_by is distinct from 'qbotest-bk@mygoodbooks.org' then
    raise exception 'FAIL 11b: sandbox state row wrong (client %, env %, used %, by %)',
      r.client_id, r.api_env, r.used, r.created_by;
  end if;

  select * into r from public.qbo_connect_state where token = current_setting('qbotest.tok_real');
  if not found or r.client_id <> 'qbotest-real' or r.api_env <> 'production' then
    raise exception 'FAIL 11c: production state row wrong';
  end if;

  select * into r from public.qbo_firm_connect_state where token = current_setting('qbotest.tok_firm');
  if not found or r.api_env <> 'production' or r.created_by is distinct from 'qbotest-admin@mygoodbooks.org' then
    raise exception 'FAIL 11d: firm state row wrong';
  end if;

  -- The 'error' connection was not touched by connect start (qbo-callback
  -- resets status/last_error only on a successful exchange).
  if (select status from public.qbo_connections where client_id = 'qbotest-real') <> 'error' then
    raise exception 'FAIL 11e: connect start changed the connection row';
  end if;

  -- Nothing was written for refused callers.
  if exists (select 1 from public.qbo_connect_state
              where client_id in ('qbotest-does-not-exist')
                 or token in ('qbotest-anon', 'qbotest-client', 'qbotest-direct')) then
    raise exception 'FAIL 11f: a refused call left a state row';
  end if;
end
$$;

do $$ begin raise notice 'qbo-env tests: all passed'; end $$;

rollback;
