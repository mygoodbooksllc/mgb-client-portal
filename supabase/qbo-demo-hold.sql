-- QuickBooks demo hold (2026-10-30).
--
-- The Pro Test Client (grace-community) is linked to a QuickBooks SANDBOX
-- company (a landscaping business). qbo-sync replaces that client's rows in
-- the qbo_* mirror tables every full sync, so any hand-loaded demo data would
-- be wiped within a day.
--
-- A hold row makes the two write paths the sync uses (qbo_replace_rows and
-- qbo_replace_donor_gifts) skip that client: nothing is deleted or inserted,
-- and the function returns 0. Everything else about the client (token refresh,
-- connection status, last_synced_at, close checks) keeps running.
--
-- Additive and reversible: delete the client's row from qbo_demo_holds and
-- the next sync repopulates from QuickBooks. Only a service-role or SQL
-- editor session can touch the table (RLS on, no policies, no grants for anon or authenticated).
--
-- Keep holds for demo / test clients only. A held client's QuickBooks data
-- never refreshes.

create table if not exists public.qbo_demo_holds (
  client_id  text primary key,
  note       text,
  created_at timestamptz not null default now(),
  created_by text
);
alter table public.qbo_demo_holds enable row level security;
revoke all on public.qbo_demo_holds from anon, authenticated;

-- One-time copy of what the sandbox sync had loaded, taken before a hold
-- replaces it, so nothing is lost.
create table if not exists public.qbo_demo_hold_backup (
  client_id    text not null,
  table_name   text not null,
  rows         jsonb not null,
  backed_up_at timestamptz not null default now(),
  primary key (client_id, table_name)
);
alter table public.qbo_demo_hold_backup enable row level security;
revoke all on public.qbo_demo_hold_backup from anon, authenticated;

-- qbo_replace_rows: body identical to the previous version except for the
-- hold check right after `begin`.
create or replace function public.qbo_replace_rows(p_table text, p_client_id text, p_rows jsonb)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  n integer;
  rows_in jsonb := coalesce(p_rows, '[]'::jsonb);
begin
  if exists (select 1 from public.qbo_demo_holds h where h.client_id = p_client_id) then
    return 0;
  end if;
  if p_table not in (
    'qbo_accounts', 'qbo_monthly_pl', 'qbo_pl_lines', 'qbo_budget_lines',
    'qbo_invoices', 'qbo_bills', 'qbo_transactions',
    'qbo_account_status', 'qbo_period_balances'
  ) then
    raise exception 'qbo_replace_rows: table % not allowed', p_table;
  end if;
  if jsonb_typeof(rows_in) <> 'array' then
    raise exception 'qbo_replace_rows: rows must be a JSON array';
  end if;
  if exists (
    select 1 from jsonb_array_elements(rows_in) e
    where e ->> 'client_id' is distinct from p_client_id
  ) then
    raise exception 'qbo_replace_rows: row client_id mismatch';
  end if;

  select coalesce(jsonb_agg(
           case when e ? 'updated_at' then e
                else e || jsonb_build_object('updated_at', now()) end
         ), '[]'::jsonb)
    into rows_in
    from jsonb_array_elements(rows_in) e;

  execute format('delete from %I where client_id = $1', p_table)
    using p_client_id;
  execute format(
    'insert into %I select * from jsonb_populate_recordset(null::%I, $1)',
    p_table, p_table
  ) using rows_in;
  get diagnostics n = row_count;
  return n;
end;
$function$;

-- qbo_replace_donor_gifts: body identical except for the hold check.
create or replace function public.qbo_replace_donor_gifts(p_client_id text, p_year integer, p_rows jsonb)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  n integer;
  rows_in jsonb := coalesce(p_rows, '[]'::jsonb);
begin
  if exists (select 1 from public.qbo_demo_holds h where h.client_id = p_client_id) then
    -- keep the pull marked fresh so the sync does not re-call Intuit every run
    update public.qbo_donor_gift_pulls set pulled_at = now()
      where client_id = p_client_id and year = p_year;
    return 0;
  end if;
  if p_year is null or p_year not between 2000 and 2100 then
    raise exception 'qbo_replace_donor_gifts: bad year';
  end if;
  if jsonb_typeof(rows_in) <> 'array' then
    raise exception 'qbo_replace_donor_gifts: rows must be a JSON array';
  end if;
  if exists (
    select 1 from jsonb_array_elements(rows_in) e
    where e ->> 'client_id' is distinct from p_client_id
       or (e ->> 'year')::integer is distinct from p_year
  ) then
    raise exception 'qbo_replace_donor_gifts: row client_id / year mismatch';
  end if;

  select coalesce(jsonb_agg(
           case when e ? 'updated_at' then e
                else e || jsonb_build_object('updated_at', now()) end
         ), '[]'::jsonb)
    into rows_in
    from jsonb_array_elements(rows_in) e;

  delete from public.qbo_donor_gifts where client_id = p_client_id and year = p_year;
  insert into public.qbo_donor_gifts
    select * from jsonb_populate_recordset(null::public.qbo_donor_gifts, rows_in);
  get diagnostics n = row_count;

  insert into public.qbo_donor_gift_pulls as p (client_id, year, pulled_at, row_count)
  values (p_client_id, p_year, now(), n)
  on conflict (client_id, year)
  do update set pulled_at = excluded.pulled_at, row_count = excluded.row_count;

  return n;
end;
$function$;

revoke all on function public.qbo_replace_rows(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.qbo_replace_rows(text, text, jsonb) to service_role;
revoke all on function public.qbo_replace_donor_gifts(text, integer, jsonb) from public, anon, authenticated;
grant execute on function public.qbo_replace_donor_gifts(text, integer, jsonb) to service_role;
