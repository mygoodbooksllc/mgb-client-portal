-- Hours used per client, for the people assigned to that client.
-- Owner decision 2026-10-08 (staff navigation redesign): bookkeepers need to
-- see each client's allotted hours and where they stand, not just admins.
--
-- The budget itself (client_profile.monthly_hours_budget) was already
-- readable by any active staffer who can_access_client(); only the hours
-- USED were admin-only, because qbo_hours_by_client() is SECURITY INVOKER
-- over admin-only QuickBooks Time tables. This adds one narrow RPC: minutes
-- per client, for the caller's own clients, nothing else (no rates, no
-- billable value, no per-person split, no unmapped/ignored buckets).
-- qbo_hours_by_client() is unchanged and stays admin-only.

create or replace function public.qbo_my_client_hours(p_from date, p_to date)
returns table (client_id text, total_minutes bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not public.is_active_staff() then
    raise exception 'not authorized';
  end if;
  return query
  select r.client_id,
         sum(a.minutes)::bigint
  from qbo_time_activities a
  join qbo_customer_resolution r
    on r.realm_id = a.realm_id and r.qbo_customer_id = a.customer_qbo_id
  where a.txn_date between p_from and p_to
    and r.client_id is not null
    and coalesce(r.ignored, false) = false
    and public.can_access_client(r.client_id)
  group by r.client_id;
end;
$$;

revoke all on function public.qbo_my_client_hours(date, date) from public, anon;
grant execute on function public.qbo_my_client_hours(date, date) to authenticated;
