-- QuickBooks Time billing rates: internal-access grant holders only.
-- (MGB Home S2 review finding, owner decision 2026-11-02.)
-- Applied to production 2026-11-02 (Supabase MCP apply_migration
-- qbo_hourly_rate_lock, version 20261102210645; tests 54/54 live, rolled back).
--
-- Problem: qbo_time_activities.hourly_rate (QuickBooks Time billing rates)
-- was readable by every active admin, Jesse included, through a direct
-- PostgREST select (RLS policy "admins read qbo time activities" +
-- Supabase's default table-wide grants to anon/authenticated). Money must
-- only reach holders of the internal-access grant (public.can_view_internal()).
-- At the time of this fix every synced rate is 0, so nothing real leaked.
--
-- Fix (least invasive; no table, policy or app wording change):
-- 1. Column privileges. Revoke every table privilege from anon and
--    authenticated, then grant authenticated SELECT on every column EXCEPT
--    hourly_rate. Row access is unchanged (the admin RLS policy stays), so
--    Team › Hours, Capacity and the drill-down (which name their columns and
--    never select hourly_rate) keep working. A direct select of hourly_rate
--    (or select *) by any signed-in user now fails 42501. INSERT/UPDATE/
--    DELETE/TRUNCATE were never usable through RLS (no write policies), so
--    revoking them changes nothing in practice. service_role and postgres
--    keep full access: qbo-firm-sync (service role, writes through
--    qbo_firm_replace_time_window) and client-emails (service role, selects
--    minutes) are untouched. A column added to the table later is NOT
--    readable by authenticated until it is granted here (fails closed).
-- 2. qbo_hours_by_client / qbo_hours_by_staff were SECURITY INVOKER and read
--    the table with a.* (and qbo_hours_by_client multiplies hourly_rate for
--    billable_value). Under (1) they would raise 42501 for every caller, so
--    they become SECURITY DEFINER (owner postgres). Their bodies already
--    raise unless is_active_staff_admin(), and billable_value is already null
--    unless can_view_internal() (MGB Home S1), so they return exactly what
--    they returned before, money still only to grant holders. Done with
--    ALTER FUNCTION, not a body copy: a later CREATE OR REPLACE that drops
--    SECURITY DEFINER makes them raise 42501 for everyone (fails closed;
--    supabase/qbo-hourly-rate-lock-tests.sql checks prosecdef).
--    Every other reader of the table is already SECURITY DEFINER (internal_hours,
--    qbo_firm_status, qbo_my_client_hours(_monthly), staff_performance,
--    client_health, digest_weekly_data, qbo_firm_replace_time_window) and
--    none returns hourly_rate; client_profitability is INVOKER but names its
--    columns (no hourly_rate) and is grant-only anyway.
-- 3. qbo_time_activity_rates(p_from, p_to): the one way to read the rates now.
--    SECURITY DEFINER, raises 42501 unless is_active_staff_admin() and
--    can_view_internal(); 22023 on a bad range. Returns (realm_id, qbo_id,
--    txn_date, hourly_rate) per entry in the range. No app caller yet.
--
-- Safe to re-run. Tests: supabase/qbo-hourly-rate-lock-tests.sql (rolls back).
--
-- ROLLBACK (re-opens the exposure; run only to undo this file):
--   revoke select (realm_id, qbo_id, txn_date, name_of, employee_qbo_id,
--     employee_name, vendor_qbo_id, vendor_name, customer_qbo_id, customer_name,
--     minutes, billable_status, description, item_qbo_id, item_name, start_time,
--     end_time, qbo_last_updated, synced_at)
--     on public.qbo_time_activities from authenticated;
--   grant all on table public.qbo_time_activities to anon, authenticated;
--   alter function public.qbo_hours_by_client(date, date) security invoker;
--   alter function public.qbo_hours_by_staff(date, date) security invoker;
--   drop function if exists public.qbo_time_activity_rates(date, date);

begin;

-- 1. Column privileges ------------------------------------------------------
revoke all on table public.qbo_time_activities from anon, authenticated;
grant select (realm_id, qbo_id, txn_date, name_of,
              employee_qbo_id, employee_name, vendor_qbo_id, vendor_name,
              customer_qbo_id, customer_name, minutes, billable_status,
              description, item_qbo_id, item_name, start_time, end_time,
              qbo_last_updated, synced_at)
  on public.qbo_time_activities to authenticated;

-- 2. Hours RPCs keep working without column access ---------------------------
alter function public.qbo_hours_by_client(date, date) security definer;
alter function public.qbo_hours_by_staff(date, date) security definer;
revoke all on function public.qbo_hours_by_client(date, date) from public, anon;
revoke all on function public.qbo_hours_by_staff(date, date) from public, anon;
grant execute on function public.qbo_hours_by_client(date, date) to authenticated;
grant execute on function public.qbo_hours_by_staff(date, date) to authenticated;

-- 3. Grant-only rates read ---------------------------------------------------
create or replace function public.qbo_time_activity_rates(p_from date, p_to date)
returns table (realm_id text, qbo_id text, txn_date date, hourly_rate numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not (public.is_active_staff_admin() and public.can_view_internal()) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'invalid date range' using errcode = '22023';
  end if;
  return query
  select a.realm_id, a.qbo_id, a.txn_date, a.hourly_rate
    from public.qbo_time_activities a
   where a.txn_date between p_from and p_to
   order by a.txn_date, a.realm_id, a.qbo_id;
end;
$$;
revoke all on function public.qbo_time_activity_rates(date, date) from public, anon;
grant execute on function public.qbo_time_activity_rates(date, date) to authenticated;

commit;
