-- Monthly hours history per client, for the 6-month average (owner request
-- 2026-11-02). Same guard pattern as qbo_my_client_hours
-- (client-hours-for-bookkeepers.sql): security definer, active staff only,
-- only clients the caller can access (can_access_client is true for admins,
-- so one RPC serves everyone). Minutes only: no rates, billable value or
-- per-person split. Returns the p_months COMPLETE calendar months before the
-- current month (clamped to 1..12); months with no time are simply absent.
-- Additive: new function only.
-- Applied to production 2026-11-02.

create or replace function public.qbo_my_client_hours_monthly(p_months int default 6)
returns table (client_id text, month date, total_minutes bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_end date := date_trunc('month', current_date)::date;
  v_start date := (date_trunc('month', current_date) - make_interval(months => greatest(1, least(coalesce(p_months, 6), 12))))::date;
begin
  if not public.is_active_staff() then
    raise exception 'not authorized';
  end if;
  return query
  select r.client_id,
         date_trunc('month', a.txn_date)::date as month,
         sum(a.minutes)::bigint
  from qbo_time_activities a
  join qbo_customer_resolution r
    on r.realm_id = a.realm_id and r.qbo_customer_id = a.customer_qbo_id
  where a.txn_date >= v_start
    and a.txn_date < v_end
    and r.client_id is not null
    and coalesce(r.ignored, false) = false
    and public.can_access_client(r.client_id)
  group by r.client_id, date_trunc('month', a.txn_date)::date;
end;
$$;

revoke all on function public.qbo_my_client_hours_monthly(int) from public, anon;
grant execute on function public.qbo_my_client_hours_monthly(int) to authenticated;
