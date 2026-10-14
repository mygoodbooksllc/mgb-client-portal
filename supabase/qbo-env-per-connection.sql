-- QuickBooks: per-connection Intuit environment (sandbox vs production keys).
-- Idempotent: safe to run more than once.
--
-- Background
-- ----------
-- Intuit issues separate app keys for development (sandbox companies only)
-- and production (real companies only), and a refresh token only works with
-- the app that minted it. Until now every connect and every refresh used ONE
-- global key pair (QBO_CLIENT_ID / QBO_CLIENT_SECRET, plus a global QBO_ENV),
-- so a real client could not be connected while the Pro Test (sandbox)
-- connection kept working.
--
-- Now the environment is decided per connect, in the database, from
-- clients.test_only, stamped on the state row, carried by qbo-callback onto
-- qbo_connections.api_env (or qbo_firm_connection.api_env), and every later
-- token call uses that environment's keys (supabase/functions/_shared/
-- qbo-env.ts). The browser no longer builds the Intuit URL or writes state
-- rows: it calls the qbo-connect-start edge function, which calls the RPCs
-- below AS THE CALLER (so these checks are the real gate).
--
-- THE ENVIRONMENT RULE (authoritative; qbo-env.ts envForClient mirrors it):
--   client with test_only = true  -> 'sandbox'
--   client with test_only = false -> 'production'
--   the firm's own company        -> 'production'
--
-- Changes
-- -------
-- 1. api_env (nullable, CHECK sandbox|production) on qbo_connect_state and
--    qbo_firm_connect_state. NULL only on rows from before this file; the
--    callback treats NULL as sandbox/legacy keys (what the old flow used).
-- 2. public.qbo_env_for_client(boolean): the rule above.
-- 3. public.qbo_connect_start(p_client_id text) -> jsonb {token, api_env}.
--    Replaces the browser's direct INSERT into qbo_connect_state. Requires
--    is_active_staff() AND can_access_client(p_client_id) (the same check the
--    old "staff create qbo connect state" insert policy used, from
--    audit-hardening-client-scoping.sql). It never looks at qbo_connections,
--    so a connection in status 'error' (or any status) can't block a new
--    connect; a successful connect resets status/last_error in qbo-callback.
-- 4. public.qbo_firm_connect_start() -> jsonb {token, api_env:'production'}.
--    The old qbo_firm_connect_start(p_intuit_client_id text), which took the
--    Intuit client id from the browser and returned a finished URL, is
--    DELIBERATELY DROPPED: the Intuit client id now depends on the
--    environment and lives in edge-function secrets, so the edge function
--    builds the URL. Nothing should call the old signature after the
--    frontend in the same change ships.
-- 5. The browser's direct insert path is closed: the insert policy is dropped
--    and anon/authenticated lose every table privilege on both state tables.
--    Only the service role (qbo-callback, qbo-connect-start's cleanup) and
--    the SECURITY DEFINER RPCs touch them.
-- 6. created_at indexes for the cleanup deletes (the hourly cron job
--    'qbo-connect-state-cleanup' from audit2-qbo-state-hardening.sql is kept
--    as is; both RPCs also delete rows older than a day on each call).
--
-- Deploy order: apply THIS FILE FIRST (qbo-callback selects api_env from the
-- state rows), then deploy the edge functions, then the frontend. Between
-- this file and the new frontend, the old Connect buttons fail (their insert
-- / old RPC is gone) - nothing is half-connected, they just error.
--
-- Not changed: qbo_connections grants. Staff can still technically UPDATE
-- their clients' qbo_connections rows via the "staff manage qbo connections"
-- policy (the app never does). Flipping api_env there only makes that
-- connection's own refresh fail at Intuit; tokens never cross apps or clients.

-- ----------------------------------------------------------------------------
-- 1. api_env on the state tables
-- ----------------------------------------------------------------------------
alter table public.qbo_connect_state
  add column if not exists api_env text;
alter table public.qbo_firm_connect_state
  add column if not exists api_env text;

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'qbo_connect_state_api_env_check'
                    and conrelid = 'public.qbo_connect_state'::regclass) then
    alter table public.qbo_connect_state
      add constraint qbo_connect_state_api_env_check
      check (api_env in ('sandbox', 'production'));
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'qbo_firm_connect_state_api_env_check'
                    and conrelid = 'public.qbo_firm_connect_state'::regclass) then
    alter table public.qbo_firm_connect_state
      add constraint qbo_firm_connect_state_api_env_check
      check (api_env in ('sandbox', 'production'));
  end if;
end
$$;

create index if not exists qbo_connect_state_created_at_idx
  on public.qbo_connect_state (created_at);
create index if not exists qbo_firm_connect_state_created_at_idx
  on public.qbo_firm_connect_state (created_at);

-- ----------------------------------------------------------------------------
-- 2. The rule
-- ----------------------------------------------------------------------------
create or replace function public.qbo_env_for_client(p_test_only boolean)
returns text
language sql
immutable
set search_path = public
as $$
  -- Only an explicit true is a test client; NULL is treated as real.
  select case when p_test_only is true then 'sandbox' else 'production' end;
$$;

-- ----------------------------------------------------------------------------
-- 3. Client connect start
-- ----------------------------------------------------------------------------
create or replace function public.qbo_connect_start(p_client_id text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_token text;
  v_test_only boolean;
  v_env text;
begin
  -- Same gate as the old insert policy (is_active_staff + can_access_client),
  -- checked BEFORE looking the client up, so an outsider learns nothing
  -- about which client ids exist.
  if not public.is_active_staff() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_client_id is null or btrim(p_client_id) = '' or length(p_client_id) > 200 then
    raise exception 'invalid client id' using errcode = '22023';
  end if;
  if not public.can_access_client(p_client_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select c.test_only into v_test_only from public.clients c where c.id = p_client_id;
  if not found then
    raise exception 'unknown client' using errcode = 'P0002';
  end if;
  v_env := public.qbo_env_for_client(v_test_only);

  -- Housekeeping (the hourly cron does the same): tokens are dead after
  -- 15 minutes in qbo-callback anyway.
  delete from public.qbo_connect_state where created_at < now() - interval '1 day';

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  -- created_by is also stamped by the stamp_author trigger from the same JWT.
  insert into public.qbo_connect_state (token, client_id, created_by, api_env)
  values (v_token, p_client_id, auth.jwt() ->> 'email', v_env);

  return jsonb_build_object('token', v_token, 'api_env', v_env);
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. Firm connect start (replaces qbo_firm_connect_start(text))
-- ----------------------------------------------------------------------------
drop function if exists public.qbo_firm_connect_start(text);

create or replace function public.qbo_firm_connect_start()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_token text;
  -- The firm's own QuickBooks company is always a real company.
  v_env constant text := 'production';
begin
  if not public.is_active_staff_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  delete from public.qbo_firm_connect_state where created_at < now() - interval '1 day';
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.qbo_firm_connect_state (token, created_by, api_env)
  values (v_token, auth.jwt() ->> 'email', v_env);
  return jsonb_build_object('token', v_token, 'api_env', v_env);
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. Close the browser's direct path
-- ----------------------------------------------------------------------------
drop policy if exists "staff create qbo connect state" on public.qbo_connect_state;
revoke all on table public.qbo_connect_state from public, anon, authenticated;
revoke all on table public.qbo_firm_connect_state from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Grants
-- ----------------------------------------------------------------------------
revoke all on function public.qbo_env_for_client(boolean) from public, anon;
revoke all on function public.qbo_connect_start(text) from public, anon;
revoke all on function public.qbo_firm_connect_start() from public, anon;
grant execute on function public.qbo_env_for_client(boolean) to authenticated;
grant execute on function public.qbo_connect_start(text) to authenticated;
grant execute on function public.qbo_firm_connect_start() to authenticated;
