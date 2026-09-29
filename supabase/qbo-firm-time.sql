-- QuickBooks Time -> staff dashboard: the FIRM's own QuickBooks connection,
-- its TimeActivity rows, and the customer/employee mapping tables.
--
-- Applied to production 2026-09-29. Safe to re-run (if not exists / create or replace / drop
-- policy if exists / unschedule-if-exists), wrapped in one transaction.
--
-- Companion code:
--   supabase/functions/qbo-firm-sync/index.ts   (new; the only writer)
--   supabase/functions/qbo-callback/index.ts    (small additive branch: a
--     state token found in qbo_firm_connect_state is a firm connect)
--
-- APPLY ORDER: this file first, then deploy qbo-firm-sync, then redeploy
-- qbo-callback. Any order is harmless (the callback's firm branch just finds
-- no table/row and answers "invalid"; the cron just 404s until the function
-- exists), but nothing connects or syncs until all three are live.
--
-- ============================================================================
-- Design
-- ============================================================================
-- Staff track hours in QuickBooks Time (Workforce). QuickBooks Time pushes
-- approved timesheets into MyGoodBooks' OWN QuickBooks Online company as
-- TimeActivity entities. qbo-firm-sync pulls them here so admins can see hours
-- per client (is this client priced right?) and hours per staff member.
--
-- 1. Why a separate qbo_firm_connection table, not a reserved client_id in
--    qbo_connections:
--    * qbo-sync's cron sweeps EVERY connected qbo_connections row and would
--      pull the firm's P&L/AR/AP into qbo_accounts/qbo_monthly_pl/... under the
--      reserved id; qbo-refresh-token would also rotate its token, racing the
--      firm sync. Both would need special-casing.
--    * qbo_connections is readable/writable by any staffer that
--      can_access_client() the key, and qbo_disconnect()/qbo_sync "Sync now"
--      take an arbitrary client_id. Keeping the firm row out of that table is
--      the only way to guarantee the client-facing code can never list,
--      sync or disconnect it, without editing any of it.
--    So: a singleton qbo_firm_connection (status, no secrets, admin-readable)
--    + qbo_firm_tokens (RLS on, NO policies — service_role only), encrypted
--    exactly like qbo_tokens: pgcrypto pgp_sym_encrypt with the same
--    QBO_TOKEN_ENCRYPTION_KEY edge secret passed in per call, never stored.
--    qbo_store_tokens/qbo_get_tokens are hard-wired to qbo_tokens(client_id),
--    so qbo_firm_store_tokens/qbo_firm_get_tokens are line-for-line copies
--    pointed at the firm table. Same Intuit OAuth app, same
--    QBO_CLIENT_ID/QBO_CLIENT_SECRET, same redirect URI.
--
-- 2. Connect flow. qbo_firm_connect_start() (admin only) mints a 32-byte
--    random single-use state token server-side into qbo_firm_connect_state
--    (RLS on, NO policies — a bookkeeper cannot insert one, unlike
--    qbo_connect_state whose insert policy is open to staff) and returns the
--    Intuit authorize URL. Intuit redirects to the SAME qbo-callback. The
--    callback first consumes the token from qbo_connect_state exactly as today;
--    only if that finds nothing does it try qbo_firm_connect_state (same atomic
--    UPDATE ... WHERE used = false AND age < 15 min RETURNING). The client
--    path is byte-for-byte unchanged.
--
-- 3. Deletions: DATE-WINDOW REPLACE, not qbo_replace_rows and not CDC.
--    Each run fetches every TimeActivity with TxnDate >= window_start and, in
--    one transaction (qbo_firm_replace_time_window), deletes this realm's rows
--    with txn_date >= window_start and inserts the fresh set. Anything deleted
--    or re-dated in QuickBooks inside the window disappears here; history
--    older than the window is kept (it isn't re-fetched, so a whole-table
--    replace would wipe it). Windows:
--      * backfill / weekly full: 13 months (first of the month 13 months ago)
--        when last_full_sync_at is null or older than 7 days
--      * otherwise: rolling 60 days (late approvals and edits)
--    CDC was rejected: the existing sync doesn't use it, Intuit's CDC only
--    looks back 30 days, and it would still need a periodic full pull to
--    heal gaps. A 60-day re-pull is a handful of calls for a small firm.
--    Known gap: an entry older than 60 days edited/deleted in QBO is healed
--    at the next weekly 13-month pass, not the next hour.
--
-- 4. Mapping. qbo_customer_client_map (QBO customer -> clients.id) and
--    qbo_employee_staff_map (QBO Employee or Vendor -> staff.email).
--    * manual = true rows (set by an admin through the RPCs) are never touched
--      by the sync except for name/parent/active/email refreshes.
--    * ignored = true means "don't count this against any client/staff"
--      (the firm's own internal customer, a test employee, ...).
--    * Auto-match (only rows with manual = false and no mapping yet):
--        customers: lower(btrim(DisplayName or CompanyName)) =
--                   lower(btrim(clients.name)), exactly one non-test client
--        people:    lower(btrim(QBO email)) = lower(staff.email); failing
--                   that, an exact case-insensitive unique staff.name match
--    * Jobs / sub-customers: parent_qbo_id is stored. Resolution walks up the
--      parent chain to the nearest row that is mapped or ignored
--      (view qbo_customer_resolution); a job's own explicit mapping wins.
--
-- 5. Aggregation lives in SQL RPCs (qbo_hours_by_client / qbo_hours_by_staff)
--    rather than the browser, because the parent-chain rollup is a recursive
--    query, "unmapped" has to be computed identically everywhere, and the raw
--    table can hold tens of thousands of rows. Raw rows stay admin-readable
--    for drill-down.
--
-- Security: every table here is RLS-on. Admin-readable tables have exactly one
-- SELECT policy, is_active_staff_admin(). No table has an insert/update/delete
-- policy — writes are service_role (qbo-firm-sync, qbo-callback) or the
-- security-definer RPCs below, each of which checks is_active_staff_admin()
-- itself. No function or view returns a token.

begin;

-- ============================================================================
-- Connection (singleton), tokens, connect state
-- ============================================================================
create table if not exists public.qbo_firm_connection (
  id boolean primary key default true check (id),   -- exactly one row
  realm_id text,
  company_name text,
  status text not null default 'disconnected'
    check (status in ('disconnected', 'connected', 'error')),
  api_env text check (api_env in ('sandbox', 'production')),
  connected_by text,
  connected_at timestamptz,
  last_synced_at timestamptz,        -- last SUCCESSFUL sync
  last_full_sync_at timestamptz,     -- last successful 13-month pass
  last_attempt_at timestamptz,
  last_error text,
  sync_started_at timestamptz,       -- in-progress lock (stale after 10 min)
  updated_at timestamptz not null default now()
);
alter table public.qbo_firm_connection enable row level security;
drop policy if exists "admins read firm qbo connection" on public.qbo_firm_connection;
create policy "admins read firm qbo connection" on public.qbo_firm_connection
  for select using (public.is_active_staff_admin());

create table if not exists public.qbo_firm_tokens (
  id boolean primary key default true check (id)
    references public.qbo_firm_connection (id) on delete cascade,
  access_token bytea not null,
  refresh_token bytea not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);
alter table public.qbo_firm_tokens enable row level security;  -- NO policies

create table if not exists public.qbo_firm_connect_state (
  token text primary key,
  created_by text,
  created_at timestamptz not null default now(),
  used boolean not null default false
);
alter table public.qbo_firm_connect_state enable row level security;  -- NO policies

create table if not exists public.qbo_firm_sync_runs (
  id bigserial primary key,
  realm_id text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null check (status in ('ok', 'error')),
  window_from date,
  full_window boolean,
  trigger text,                      -- 'cron' | 'admin'
  detail text,
  counts jsonb
);
alter table public.qbo_firm_sync_runs enable row level security;
drop policy if exists "admins read firm sync runs" on public.qbo_firm_sync_runs;
create policy "admins read firm sync runs" on public.qbo_firm_sync_runs
  for select using (public.is_active_staff_admin());
create index if not exists qbo_firm_sync_runs_started_idx
  on public.qbo_firm_sync_runs (started_at desc);

-- ============================================================================
-- Data tables
-- ============================================================================
create table if not exists public.qbo_time_activities (
  realm_id text not null,
  qbo_id text not null,
  txn_date date not null,
  name_of text,                      -- 'Employee' | 'Vendor'
  employee_qbo_id text,
  employee_name text,
  vendor_qbo_id text,
  vendor_name text,
  customer_qbo_id text,
  customer_name text,
  minutes integer not null default 0,
  billable_status text,              -- Billable | NotBillable | HasBeenBilled
  hourly_rate numeric,
  description text,
  item_qbo_id text,
  item_name text,
  start_time timestamptz,
  end_time timestamptz,
  qbo_last_updated timestamptz,
  synced_at timestamptz not null default now(),
  primary key (realm_id, qbo_id)
);
create index if not exists qbo_time_activities_date_idx
  on public.qbo_time_activities (realm_id, txn_date);
create index if not exists qbo_time_activities_customer_idx
  on public.qbo_time_activities (realm_id, customer_qbo_id);
alter table public.qbo_time_activities enable row level security;
drop policy if exists "admins read qbo time activities" on public.qbo_time_activities;
create policy "admins read qbo time activities" on public.qbo_time_activities
  for select using (public.is_active_staff_admin());

create table if not exists public.qbo_customer_client_map (
  realm_id text not null,
  qbo_customer_id text not null,
  customer_name text,                -- QBO DisplayName
  company_name text,                 -- QBO CompanyName
  fully_qualified_name text,         -- "Parent:Job"
  parent_qbo_id text,                -- ParentRef for jobs / sub-customers
  is_job boolean not null default false,
  active boolean not null default true,
  client_id text references public.clients (id) on delete set null,
  ignored boolean not null default false,
  manual boolean not null default false,
  auto_matched boolean not null default false,
  updated_by text,
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz,
  primary key (realm_id, qbo_customer_id),
  check (not (ignored and client_id is not null))
);
create index if not exists qbo_customer_client_map_client_idx
  on public.qbo_customer_client_map (client_id);
alter table public.qbo_customer_client_map enable row level security;
drop policy if exists "admins read qbo customer map" on public.qbo_customer_client_map;
create policy "admins read qbo customer map" on public.qbo_customer_client_map
  for select using (public.is_active_staff_admin());

create table if not exists public.qbo_employee_staff_map (
  realm_id text not null,
  qbo_entity_type text not null check (qbo_entity_type in ('Employee', 'Vendor')),
  qbo_id text not null,
  display_name text,
  qbo_email text,
  active boolean not null default true,
  staff_email text,                  -- staff.email (no FK: staff is keyed by uuid)
  ignored boolean not null default false,
  manual boolean not null default false,
  auto_matched boolean not null default false,
  updated_by text,
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz,
  primary key (realm_id, qbo_entity_type, qbo_id),
  check (not (ignored and staff_email is not null))
);
create index if not exists qbo_employee_staff_map_staff_idx
  on public.qbo_employee_staff_map (staff_email);
alter table public.qbo_employee_staff_map enable row level security;
drop policy if exists "admins read qbo employee map" on public.qbo_employee_staff_map;
create policy "admins read qbo employee map" on public.qbo_employee_staff_map
  for select using (public.is_active_staff_admin());

-- ============================================================================
-- Token helpers (service_role only). Copies of qbo_store_tokens /
-- qbo_get_tokens (qbo-token-encryption.sql) for the firm singleton.
-- ============================================================================
create or replace function public.qbo_firm_store_tokens(
  p_access_token text,
  p_refresh_token text,
  p_expires_at timestamptz,
  p_key text
) returns void
language sql
security definer
set search_path = public, extensions
as $$
  insert into qbo_firm_connection (id) values (true) on conflict (id) do nothing;
  insert into qbo_firm_tokens (id, access_token, refresh_token, expires_at, updated_at)
  values (
    true,
    extensions.pgp_sym_encrypt(p_access_token, p_key)::bytea,
    extensions.pgp_sym_encrypt(p_refresh_token, p_key)::bytea,
    p_expires_at,
    now()
  )
  on conflict (id) do update set
    access_token = excluded.access_token,
    refresh_token = excluded.refresh_token,
    expires_at = excluded.expires_at,
    updated_at = now();
$$;

create or replace function public.qbo_firm_get_tokens(p_key text)
returns table (access_token text, refresh_token text, expires_at timestamptz)
language sql
security definer
set search_path = public, extensions
as $$
  select extensions.pgp_sym_decrypt(access_token, p_key),
         extensions.pgp_sym_decrypt(refresh_token, p_key),
         expires_at
  from qbo_firm_tokens
  where id = true;
$$;

revoke all on function public.qbo_firm_store_tokens(text, text, timestamptz, text) from public, anon, authenticated;
revoke all on function public.qbo_firm_get_tokens(text) from public, anon, authenticated;
grant execute on function public.qbo_firm_store_tokens(text, text, timestamptz, text) to service_role;
grant execute on function public.qbo_firm_get_tokens(text) to service_role;

-- Called by qbo-callback after a successful firm token exchange. A different
-- realm than before resets last_full_sync_at so the 13-month backfill runs.
create or replace function public.qbo_firm_mark_connected(
  p_realm_id text,
  p_api_env text,
  p_connected_by text
) returns void
language sql
security definer
set search_path = public
as $$
  insert into qbo_firm_connection (id) values (true) on conflict (id) do nothing;
  update qbo_firm_connection set
    last_full_sync_at = case when realm_id is distinct from p_realm_id then null
                             else last_full_sync_at end,
    company_name      = case when realm_id is distinct from p_realm_id then null
                             else company_name end,
    realm_id = p_realm_id,
    status = 'connected',
    api_env = case when p_api_env in ('sandbox', 'production') then p_api_env end,
    connected_by = p_connected_by,
    connected_at = now(),
    last_error = null,
    updated_at = now()
  where id = true;
$$;
revoke all on function public.qbo_firm_mark_connected(text, text, text) from public, anon, authenticated;
grant execute on function public.qbo_firm_mark_connected(text, text, text) to service_role;

-- ============================================================================
-- Auto-matching (internal; called by the upsert RPCs and set-mapping resets)
-- ============================================================================
create or replace function public.qbo_firm_auto_match(p_realm_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Customers -> clients, by trimmed case-insensitive name, only when exactly
  -- one non-test client carries that name.
  with names as (
    select lower(btrim(name)) nm, min(id) id, count(*) n
    from clients
    where coalesce(test_only, false) = false and name is not null
    group by lower(btrim(name))
  )
  update qbo_customer_client_map m
     set client_id = x.id, auto_matched = true, updated_at = now()
    from (
      select m2.realm_id, m2.qbo_customer_id, coalesce(a.id, b.id) as id
      from qbo_customer_client_map m2
      left join names a on a.n = 1 and a.nm = lower(btrim(m2.customer_name))
      left join names b on b.n = 1 and b.nm = lower(btrim(m2.company_name))
      where m2.realm_id = p_realm_id
    ) x
   where m.realm_id = x.realm_id and m.qbo_customer_id = x.qbo_customer_id
     and x.id is not null
     and not m.manual and not m.ignored and m.client_id is null;

  -- People -> staff by email.
  update qbo_employee_staff_map m
     set staff_email = s.email, auto_matched = true, updated_at = now()
    from staff s
   where m.realm_id = p_realm_id
     and not m.manual and not m.ignored and m.staff_email is null
     and m.qbo_email is not null
     and lower(btrim(m.qbo_email)) = lower(s.email);

  -- ...then by unique exact name (QBO employees often carry a personal email).
  with names as (
    select lower(btrim(name)) nm, min(email) email, count(*) n
    from staff where name is not null
    group by lower(btrim(name))
  )
  update qbo_employee_staff_map m
     set staff_email = n.email, auto_matched = true, updated_at = now()
    from names n
   where m.realm_id = p_realm_id
     and not m.manual and not m.ignored and m.staff_email is null
     and n.n = 1 and n.nm = lower(btrim(m.display_name));
end;
$$;
revoke all on function public.qbo_firm_auto_match(text) from public, anon, authenticated;
grant execute on function public.qbo_firm_auto_match(text) to service_role;

-- ============================================================================
-- Sync writers (service_role only)
-- ============================================================================
-- p_rows: [{qbo_customer_id, customer_name, company_name, fully_qualified_name,
--           parent_qbo_id, is_job, active}]
create or replace function public.qbo_firm_upsert_customers(p_realm_id text, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  if p_realm_id is null or jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' then
    raise exception 'qbo_firm_upsert_customers: bad arguments';
  end if;
  insert into qbo_customer_client_map as m (
    realm_id, qbo_customer_id, customer_name, company_name, fully_qualified_name,
    parent_qbo_id, is_job, active, last_seen_at, updated_at)
  -- distinct on: a duplicate id in p_rows would otherwise abort the whole
  -- upsert ("ON CONFLICT DO UPDATE command cannot affect row a second time").
  select distinct on (r.qbo_customer_id)
         p_realm_id, r.qbo_customer_id, r.customer_name, r.company_name,
         r.fully_qualified_name, r.parent_qbo_id, coalesce(r.is_job, false),
         coalesce(r.active, true), now(), now()
  from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(
    qbo_customer_id text, customer_name text, company_name text,
    fully_qualified_name text, parent_qbo_id text, is_job boolean, active boolean)
  where r.qbo_customer_id is not null
  order by r.qbo_customer_id
  on conflict (realm_id, qbo_customer_id) do update set
    customer_name = coalesce(excluded.customer_name, m.customer_name),
    company_name = coalesce(excluded.company_name, m.company_name),
    fully_qualified_name = coalesce(excluded.fully_qualified_name, m.fully_qualified_name),
    parent_qbo_id = excluded.parent_qbo_id,
    is_job = excluded.is_job,
    active = excluded.active,
    last_seen_at = now();
  get diagnostics n = row_count;
  perform qbo_firm_auto_match(p_realm_id);
  return n;
end;
$$;

-- p_rows: [{qbo_entity_type, qbo_id, display_name, qbo_email, active}]
create or replace function public.qbo_firm_upsert_people(p_realm_id text, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  if p_realm_id is null or jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' then
    raise exception 'qbo_firm_upsert_people: bad arguments';
  end if;
  insert into qbo_employee_staff_map as m (
    realm_id, qbo_entity_type, qbo_id, display_name, qbo_email, active,
    last_seen_at, updated_at)
  select distinct on (r.qbo_entity_type, r.qbo_id)
         p_realm_id, r.qbo_entity_type, r.qbo_id, r.display_name,
         nullif(btrim(r.qbo_email), ''), coalesce(r.active, true), now(), now()
  from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(
    qbo_entity_type text, qbo_id text, display_name text, qbo_email text, active boolean)
  where r.qbo_id is not null and r.qbo_entity_type in ('Employee', 'Vendor')
  order by r.qbo_entity_type, r.qbo_id
  on conflict (realm_id, qbo_entity_type, qbo_id) do update set
    display_name = coalesce(excluded.display_name, m.display_name),
    qbo_email = coalesce(excluded.qbo_email, m.qbo_email),
    active = excluded.active,
    last_seen_at = now();
  get diagnostics n = row_count;
  perform qbo_firm_auto_match(p_realm_id);
  return n;
end;
$$;

-- Date-window replace: delete this realm's rows dated >= p_from and insert the
-- fresh set, in one transaction. Every row must belong to p_realm_id and be
-- dated >= p_from (so nothing outside the window can be touched).
create or replace function public.qbo_firm_replace_time_window(
  p_realm_id text,
  p_from date,
  p_rows jsonb
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
  rows_in jsonb := coalesce(p_rows, '[]'::jsonb);
begin
  if p_realm_id is null or p_from is null or jsonb_typeof(rows_in) <> 'array' then
    raise exception 'qbo_firm_replace_time_window: bad arguments';
  end if;
  if exists (
    select 1 from jsonb_array_elements(rows_in) e
    where e ->> 'realm_id' is distinct from p_realm_id
       or (e ->> 'txn_date') is null
       or (e ->> 'txn_date')::date < p_from
  ) then
    raise exception 'qbo_firm_replace_time_window: row outside realm/window';
  end if;

  -- Also drop any incoming id that currently sits OUTSIDE the window (an
  -- entry re-dated forward into it), so the insert below never conflicts.
  delete from qbo_time_activities
   where realm_id = p_realm_id
     and (txn_date >= p_from
          or qbo_id in (select e ->> 'qbo_id' from jsonb_array_elements(rows_in) e));

  insert into qbo_time_activities (
    realm_id, qbo_id, txn_date, name_of, employee_qbo_id, employee_name,
    vendor_qbo_id, vendor_name, customer_qbo_id, customer_name, minutes,
    billable_status, hourly_rate, description, item_qbo_id, item_name,
    start_time, end_time, qbo_last_updated, synced_at)
  select distinct on (r.qbo_id)
         r.realm_id, r.qbo_id, r.txn_date, r.name_of, r.employee_qbo_id,
         r.employee_name, r.vendor_qbo_id, r.vendor_name, r.customer_qbo_id,
         r.customer_name, coalesce(r.minutes, 0), r.billable_status,
         r.hourly_rate, r.description, r.item_qbo_id, r.item_name,
         r.start_time, r.end_time, r.qbo_last_updated, now()
  from jsonb_to_recordset(rows_in) as r(
    realm_id text, qbo_id text, txn_date date, name_of text,
    employee_qbo_id text, employee_name text, vendor_qbo_id text,
    vendor_name text, customer_qbo_id text, customer_name text,
    minutes integer, billable_status text, hourly_rate numeric,
    description text, item_qbo_id text, item_name text,
    start_time timestamptz, end_time timestamptz, qbo_last_updated timestamptz)
  where r.qbo_id is not null
  order by r.qbo_id;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.qbo_firm_upsert_customers(text, jsonb) from public, anon, authenticated;
revoke all on function public.qbo_firm_upsert_people(text, jsonb) from public, anon, authenticated;
revoke all on function public.qbo_firm_replace_time_window(text, date, jsonb) from public, anon, authenticated;
grant execute on function public.qbo_firm_upsert_customers(text, jsonb) to service_role;
grant execute on function public.qbo_firm_upsert_people(text, jsonb) to service_role;
grant execute on function public.qbo_firm_replace_time_window(text, date, jsonb) to service_role;

-- ============================================================================
-- Customer resolution (jobs roll up to parents). security_invoker, so it is
-- exactly as readable as qbo_customer_client_map: admins only.
--   client_id / ignored   the nearest self-or-ancestor that is mapped/ignored
--   resolved_via_qbo_id   which row supplied that answer
--   root_*                top-most ancestor (where an unmapped job should be
--                         mapped, usually)
-- ============================================================================
create or replace view public.qbo_customer_resolution
with (security_invoker = on) as
with recursive anc as (
  select m.realm_id, m.qbo_customer_id as leaf_id, m.qbo_customer_id as anc_id,
         m.parent_qbo_id, m.client_id, m.ignored, 0 as depth
  from public.qbo_customer_client_map m
  union all
  select a.realm_id, a.leaf_id, p.qbo_customer_id, p.parent_qbo_id,
         p.client_id, p.ignored, a.depth + 1
  from anc a
  join public.qbo_customer_client_map p
    on p.realm_id = a.realm_id and p.qbo_customer_id = a.parent_qbo_id
  where a.depth < 10
)
select m.realm_id,
       m.qbo_customer_id,
       m.customer_name,
       m.fully_qualified_name,
       r.client_id,
       coalesce(r.ignored, false) as ignored,
       r.anc_id as resolved_via_qbo_id,
       root.anc_id as root_qbo_customer_id,
       rm.customer_name as root_customer_name
from public.qbo_customer_client_map m
left join lateral (
  select a.client_id, a.ignored, a.anc_id from anc a
  where a.realm_id = m.realm_id and a.leaf_id = m.qbo_customer_id
    and (a.client_id is not null or a.ignored)
  order by a.depth limit 1
) r on true
left join lateral (
  select a.anc_id from anc a
  where a.realm_id = m.realm_id and a.leaf_id = m.qbo_customer_id
  order by a.depth desc limit 1
) root on true
left join public.qbo_customer_client_map rm
  on rm.realm_id = m.realm_id and rm.qbo_customer_id = root.anc_id;

revoke all on public.qbo_customer_resolution from anon;
grant select on public.qbo_customer_resolution to authenticated;

-- ============================================================================
-- Admin RPCs for the UI
-- ============================================================================

-- Status. Always returns exactly one row. No tokens.
create or replace function public.qbo_firm_status()
returns table (
  connected boolean,
  status text,
  realm_id text,
  company_name text,
  api_env text,
  connected_by text,
  connected_at timestamptz,
  last_synced_at timestamptz,
  last_full_sync_at timestamptz,
  last_attempt_at timestamptz,
  last_error text,
  sync_in_progress boolean,
  activity_count bigint,
  earliest_txn_date date,
  latest_txn_date date,
  unmapped_customer_count bigint,
  unmapped_people_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not public.is_active_staff_admin() then
    raise exception 'not authorized';
  end if;
  return query
  select coalesce(c.status = 'connected', false),
         coalesce(c.status, 'disconnected'),
         c.realm_id, c.company_name, c.api_env, c.connected_by, c.connected_at,
         c.last_synced_at, c.last_full_sync_at, c.last_attempt_at, c.last_error,
         coalesce(c.sync_started_at > now() - interval '10 minutes', false),
         (select count(*) from qbo_time_activities),
         (select min(txn_date) from qbo_time_activities),
         (select max(txn_date) from qbo_time_activities),
         (select count(distinct (r.realm_id, r.qbo_customer_id))
            from qbo_customer_resolution r
            join qbo_time_activities t
              on t.realm_id = r.realm_id and t.customer_qbo_id = r.qbo_customer_id
           where r.client_id is null and not r.ignored),
         (select count(*) from qbo_employee_staff_map p
           where p.staff_email is null and not p.ignored
             and exists (
               select 1 from qbo_time_activities t
               where t.realm_id = p.realm_id
                 and coalesce(t.employee_qbo_id, t.vendor_qbo_id) = p.qbo_id
                 -- same Employee-else-Vendor rule qbo_hours_by_staff joins on
                 and p.qbo_entity_type = case when t.employee_qbo_id is not null
                                              then 'Employee' else 'Vendor' end))
  from (select 1) one
  left join qbo_firm_connection c on c.id = true;
end;
$$;

-- Start a firm connect. Pass the public Intuit app client id the browser
-- already has (window.QBO_CONFIG.clientId). Returns the authorize URL; open it
-- the same way connectQuickBooks() does.
create or replace function public.qbo_firm_connect_start(p_intuit_client_id text)
returns text
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_token text := encode(extensions.gen_random_bytes(32), 'hex');
  v_redirect text := 'https://xumsqmhccgfjnlmieqyu.supabase.co/functions/v1/qbo-callback';
begin
  if not public.is_active_staff_admin() then
    raise exception 'not authorized';
  end if;
  if p_intuit_client_id is null or p_intuit_client_id !~ '^[A-Za-z0-9]{10,100}$' then
    raise exception 'invalid Intuit client id';
  end if;
  -- Housekeeping instead of a cron job: tokens are dead after 15 minutes.
  delete from qbo_firm_connect_state where created_at < now() - interval '1 day';
  insert into qbo_firm_connect_state (token, created_by)
  values (v_token, auth.jwt() ->> 'email');
  return 'https://appcenter.intuit.com/connect/oauth2'
    || '?client_id=' || p_intuit_client_id
    || '&response_type=code'
    || '&scope=com.intuit.quickbooks.accounting'
    || '&redirect_uri=' || replace(replace(v_redirect, ':', '%3A'), '/', '%2F')
    || '&state=' || v_token;
end;
$$;

-- Disconnect: drops the tokens, keeps realm_id + synced history so the Team
-- page still shows past hours. (Like qbo_disconnect, it does not revoke the
-- grant at Intuit; do that from the QBO company's Apps page if needed.)
create or replace function public.qbo_firm_disconnect()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_active_staff_admin() then
    raise exception 'not authorized';
  end if;
  delete from qbo_firm_tokens where id = true;
  update qbo_firm_connection
     set status = 'disconnected', connected_at = null, last_error = null,
         updated_at = now()
   where id = true;
end;
$$;

-- Sync now: queues an async POST to qbo-firm-sync with the cron key and
-- {"force": true}. Poll qbo_firm_status() for the result. (The function also
-- accepts an admin's own JWT directly — supabase.functions.invoke
-- ('qbo-firm-sync') — which returns the result synchronously.)
create or replace function public.qbo_firm_sync_now()
returns bigint
language plpgsql
volatile
security definer
set search_path = public
as $$
declare v_id bigint;
begin
  if not public.is_active_staff_admin() then
    raise exception 'not authorized';
  end if;
  if not exists (select 1 from qbo_firm_connection where id = true and status <> 'disconnected') then
    raise exception 'The firm QuickBooks company is not connected';
  end if;
  select net.http_post(
    url := 'https://xumsqmhccgfjnlmieqyu.supabase.co/functions/v1/qbo-firm-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets
        where name = 'qbo_cron_key' limit 1
      )
    ),
    body := jsonb_build_object('force', true, 'trigger', 'admin'),
    timeout_milliseconds := 120000
  ) into v_id;
  return v_id;
end;
$$;

-- Set a customer mapping.
--   p_client_id set          -> map to that client (manual)
--   p_ignore = true          -> ignore (manual)
--   neither                  -> reset to automatic (re-runs auto-match; a job
--                               then rolls up to its parent)
-- p_realm_id defaults to the connected firm realm.
create or replace function public.qbo_set_customer_mapping(
  p_qbo_customer_id text,
  p_client_id text default null,
  p_ignore boolean default false,
  p_realm_id text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_realm text := coalesce(p_realm_id, (select realm_id from qbo_firm_connection where id = true));
begin
  if not public.is_active_staff_admin() then
    raise exception 'not authorized';
  end if;
  if v_realm is null then raise exception 'no firm realm'; end if;
  if p_client_id is not null and coalesce(p_ignore, false) then
    raise exception 'choose a client or ignore, not both';
  end if;
  if p_client_id is not null and not exists (select 1 from clients where id = p_client_id) then
    raise exception 'unknown client %', p_client_id;
  end if;
  update qbo_customer_client_map set
    client_id = p_client_id,
    ignored = coalesce(p_ignore, false),
    manual = (p_client_id is not null or coalesce(p_ignore, false)),
    auto_matched = false,
    updated_by = auth.jwt() ->> 'email',
    updated_at = now()
  where realm_id = v_realm and qbo_customer_id = p_qbo_customer_id;
  if not found then raise exception 'unknown QuickBooks customer %', p_qbo_customer_id; end if;
  if p_client_id is null and not coalesce(p_ignore, false) then
    perform qbo_firm_auto_match(v_realm);
  end if;
end;
$$;

-- Set an employee/vendor mapping. Same semantics; p_qbo_entity_type is
-- 'Employee' or 'Vendor'.
create or replace function public.qbo_set_employee_mapping(
  p_qbo_entity_type text,
  p_qbo_id text,
  p_staff_email text default null,
  p_ignore boolean default false,
  p_realm_id text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_realm text := coalesce(p_realm_id, (select realm_id from qbo_firm_connection where id = true));
  v_email text;
begin
  if not public.is_active_staff_admin() then
    raise exception 'not authorized';
  end if;
  if v_realm is null then raise exception 'no firm realm'; end if;
  if p_staff_email is not null and coalesce(p_ignore, false) then
    raise exception 'choose a staff member or ignore, not both';
  end if;
  if p_staff_email is not null then
    select email into v_email from staff where lower(email) = lower(btrim(p_staff_email));
    if v_email is null then raise exception 'unknown staff member %', p_staff_email; end if;
  end if;
  update qbo_employee_staff_map set
    staff_email = v_email,
    ignored = coalesce(p_ignore, false),
    manual = (v_email is not null or coalesce(p_ignore, false)),
    auto_matched = false,
    updated_by = auth.jwt() ->> 'email',
    updated_at = now()
  where realm_id = v_realm and qbo_entity_type = p_qbo_entity_type and qbo_id = p_qbo_id;
  if not found then raise exception 'unknown QuickBooks % %', p_qbo_entity_type, p_qbo_id; end if;
  if v_email is null and not coalesce(p_ignore, false) then
    perform qbo_firm_auto_match(v_realm);
  end if;
end;
$$;

-- Hours per client, inclusive date range. One row per:
--   bucket 'client'      a mapped client (jobs rolled up)
--   bucket 'unmapped'    per ROOT QBO customer that resolves to nothing
--   bucket 'ignored'     per QBO customer row that supplied the ignore
--   bucket 'no_customer' time with no CustomerRef (internal/admin time)
create or replace function public.qbo_hours_by_client(p_from date, p_to date)
returns table (
  bucket text,
  client_id text,
  client_name text,
  qbo_customer_id text,
  qbo_customer_name text,
  total_minutes bigint,
  total_hours numeric,
  billable_minutes bigint,
  billable_value numeric,          -- sum(hours * HourlyRate) where a rate is set
  entry_count bigint,
  staff_count bigint,
  first_date date,
  last_date date
)
language plpgsql
stable
security invoker
set search_path = public
as $$
#variable_conflict use_column
begin
  if not public.is_active_staff_admin() then
    raise exception 'not authorized';
  end if;
  return query
  with t as (
    select a.*,
           r.client_id as res_client_id,
           coalesce(r.ignored, false) as res_ignored,
           r.resolved_via_qbo_id,
           coalesce(r.root_qbo_customer_id, a.customer_qbo_id) as root_id,
           coalesce(r.root_customer_name, a.customer_name) as root_name,
           coalesce(a.employee_qbo_id, a.vendor_qbo_id) as person_id
    from qbo_time_activities a
    left join qbo_customer_resolution r
      on r.realm_id = a.realm_id and r.qbo_customer_id = a.customer_qbo_id
    where a.txn_date between p_from and p_to
  ), b as (
    select t.*,
           case when t.customer_qbo_id is null then 'no_customer'
                when t.res_client_id is not null then 'client'
                when t.res_ignored then 'ignored'
                else 'unmapped' end as bkt
    from t
  )
  select b.bkt,
         max(b.res_client_id),
         max(c.name),
         case when b.bkt = 'client' then null
              when b.bkt = 'ignored' then max(b.resolved_via_qbo_id)
              when b.bkt = 'unmapped' then max(b.root_id) end,
         case when b.bkt = 'client' then null
              when b.bkt = 'ignored' then max(im.customer_name)
              when b.bkt = 'unmapped' then max(b.root_name) end,
         sum(b.minutes)::bigint,
         round(sum(b.minutes) / 60.0, 2),
         sum(case when b.billable_status in ('Billable', 'HasBeenBilled') then b.minutes else 0 end)::bigint,
         round(sum(case when b.hourly_rate is not null then b.minutes / 60.0 * b.hourly_rate else 0 end), 2),
         count(*)::bigint,
         count(distinct b.person_id)::bigint,
         min(b.txn_date),
         max(b.txn_date)
  from b
  left join clients c on c.id = b.res_client_id
  left join qbo_customer_client_map im
    on im.realm_id = b.realm_id and im.qbo_customer_id = b.resolved_via_qbo_id
  group by b.bkt,
           case when b.bkt = 'client' then b.res_client_id
                when b.bkt = 'ignored' then b.resolved_via_qbo_id
                when b.bkt = 'unmapped' then b.root_id end
  order by 6 desc;
end;
$$;

-- Hours per staff member, inclusive date range. One row per:
--   bucket 'staff'      a mapped staff.email (Employee and Vendor records merged)
--   bucket 'unmapped'   per QBO Employee/Vendor with no staff mapping
--   bucket 'ignored'    per QBO Employee/Vendor marked ignored
--   bucket 'no_person'  time with neither EmployeeRef nor VendorRef
create or replace function public.qbo_hours_by_staff(p_from date, p_to date)
returns table (
  bucket text,
  staff_email text,
  staff_name text,
  qbo_entity_type text,
  qbo_person_id text,
  qbo_person_name text,
  total_minutes bigint,
  total_hours numeric,
  billable_minutes bigint,
  client_minutes bigint,           -- minutes that resolve to a mapped client
  unmapped_customer_minutes bigint,
  client_count bigint,
  entry_count bigint,
  first_date date,
  last_date date
)
language plpgsql
stable
security invoker
set search_path = public
as $$
#variable_conflict use_column
begin
  if not public.is_active_staff_admin() then
    raise exception 'not authorized';
  end if;
  return query
  with t as (
    select a.*,
           case when a.employee_qbo_id is not null then 'Employee'
                when a.vendor_qbo_id is not null then 'Vendor' end as etype,
           coalesce(a.employee_qbo_id, a.vendor_qbo_id) as pid,
           coalesce(a.employee_name, a.vendor_name) as pname,
           p.staff_email as sem,
           coalesce(p.ignored, false) as p_ignored,
           r.client_id as res_client_id,
           coalesce(r.ignored, false) as res_ignored
    from qbo_time_activities a
    left join qbo_employee_staff_map p
      on p.realm_id = a.realm_id
     and p.qbo_entity_type = case when a.employee_qbo_id is not null then 'Employee' else 'Vendor' end
     and p.qbo_id = coalesce(a.employee_qbo_id, a.vendor_qbo_id)
    left join qbo_customer_resolution r
      on r.realm_id = a.realm_id and r.qbo_customer_id = a.customer_qbo_id
    where a.txn_date between p_from and p_to
  ), b as (
    select t.*,
           case when t.pid is null then 'no_person'
                when t.sem is not null then 'staff'
                when t.p_ignored then 'ignored'
                else 'unmapped' end as bkt
    from t
  )
  select b.bkt,
         max(b.sem),
         max(s.name),
         case when b.bkt = 'staff' then null else max(b.etype) end,
         case when b.bkt = 'staff' then null else max(b.pid) end,
         max(b.pname),
         sum(b.minutes)::bigint,
         round(sum(b.minutes) / 60.0, 2),
         sum(case when b.billable_status in ('Billable', 'HasBeenBilled') then b.minutes else 0 end)::bigint,
         sum(case when b.res_client_id is not null then b.minutes else 0 end)::bigint,
         sum(case when b.customer_qbo_id is not null and b.res_client_id is null
                   and not b.res_ignored then b.minutes else 0 end)::bigint,
         count(distinct b.res_client_id)::bigint,
         count(*)::bigint,
         min(b.txn_date),
         max(b.txn_date)
  from b
  left join staff s on lower(s.email) = lower(b.sem)
  group by b.bkt,
           case when b.bkt = 'staff' then lower(b.sem) else b.etype || ':' || coalesce(b.pid, '') end
  order by 7 desc;
end;
$$;

revoke all on function public.qbo_firm_status() from public, anon;
revoke all on function public.qbo_firm_connect_start(text) from public, anon;
revoke all on function public.qbo_firm_disconnect() from public, anon;
revoke all on function public.qbo_firm_sync_now() from public, anon;
revoke all on function public.qbo_set_customer_mapping(text, text, boolean, text) from public, anon;
revoke all on function public.qbo_set_employee_mapping(text, text, text, boolean, text) from public, anon;
revoke all on function public.qbo_hours_by_client(date, date) from public, anon;
revoke all on function public.qbo_hours_by_staff(date, date) from public, anon;
grant execute on function public.qbo_firm_status() to authenticated;
grant execute on function public.qbo_firm_connect_start(text) to authenticated;
grant execute on function public.qbo_firm_disconnect() to authenticated;
grant execute on function public.qbo_firm_sync_now() to authenticated;
grant execute on function public.qbo_set_customer_mapping(text, text, boolean, text) to authenticated;
grant execute on function public.qbo_set_employee_mapping(text, text, text, boolean, text) to authenticated;
grant execute on function public.qbo_hours_by_client(date, date) to authenticated;
grant execute on function public.qbo_hours_by_staff(date, date) to authenticated;

-- ============================================================================
-- Cron. Same shape as qbo-sync-hourly (pg_net POST, Vault-held qbo_cron_key
-- bearer). Fires every 10 minutes at :07/:17/...; the function itself only
-- calls Intuit when the last good sync is 55+ minutes old (or never), so the
-- effective cadence is hourly and a fresh connection fills in within 10
-- minutes. The firm token is not in qbo_tokens, so qbo-refresh-tokens never
-- touches it and there is no rotation race.
-- ============================================================================
do $$
begin
  if exists (select 1 from cron.job where jobname = 'qbo-firm-sync') then
    perform cron.unschedule('qbo-firm-sync');
  end if;
end
$$;

select cron.schedule(
  'qbo-firm-sync',
  '7,17,27,37,47,57 * * * *',
  $cron$
  select net.http_post(
    url := 'https://xumsqmhccgfjnlmieqyu.supabase.co/functions/v1/qbo-firm-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets
        where name = 'qbo_cron_key' limit 1
      )
    ),
    body := '{"trigger":"cron"}'::jsonb,
    timeout_milliseconds := 120000
  );
  $cron$
);

commit;

-- Checks after applying:
--   select * from qbo_firm_status();                       -- as an admin
--   select * from cron.job where jobname = 'qbo-firm-sync';
--   select * from qbo_firm_sync_runs order by started_at desc limit 10;
-- To remove the schedule:  select cron.unschedule('qbo-firm-sync');
