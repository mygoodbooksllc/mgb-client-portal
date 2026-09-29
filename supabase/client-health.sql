-- Client health score (owner request 2026-09-29).
--
-- Applied to production 2026-09-29 as migration client_health.
-- Safe to re-run.
--
-- client_health(p_default_fees jsonb default '{}')
--   One row per client the caller can access (can_access_client(), which
--   already lets admins see every client). Active staff only.
--   Returns score 0-100, band ('green' >= 80, 'amber' 50-79, 'red' < 50) and
--   reasons: [{key, label, points}] (points = what was deducted).
--
--   Deductions (start at 100, floor 0):
--     overdue       open staff_reminders on the client past due_date:
--                   10 each, max 30
--     qbo           no QuickBooks connection / not 'connected': 25
--                   connection error (last_error set): 25
--                   connected but last sync > 3 days ago: 10
--     inactive      no staff time in 30 days, neither in-app time
--                   (staff_app_time) nor QuickBooks Time entries
--                   (qbo_time_activities via qbo_customer_resolution): 20
--     close_late    the latest month whose close deadline has passed
--                   (month_close_settings.late_day of the following month)
--                   isn't done / n.a.: 20. Skipped if month-close.sql hasn't
--                   been applied (checked at run time with to_regclass).
--     margin        ADMINS ONLY (is_active_staff_admin()): trailing-90-day
--                   margin from client_profitability() below the target in
--                   profitability_settings: 15. Bookkeepers never get this
--                   reason or any margin number. p_default_fees is passed
--                   through to client_profitability() for tier-default fees.
--
-- SECURITY DEFINER so a bookkeeper's score reflects everyone's overdue tasks
-- and time on the client (RLS would otherwise hide colleagues' rows); the
-- row filter is can_access_client() and only aggregates are returned.

begin;

create or replace function public.client_health(p_default_fees jsonb default '{}'::jsonb)
returns table (client_id text, score int, band text, reasons jsonb)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_admin boolean := public.is_active_staff_admin();
  v_close jsonb := '{}'::jsonb;     -- client_id -> {period, status}
  v_margin jsonb := '{}'::jsonb;    -- client_id -> margin_pct (admins only)
  v_target numeric;
  v_late_day int;
  v_period date;
begin
  if not public.is_active_staff() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  -- Month close (optional table)
  if to_regclass('public.month_close') is not null then
    begin
      if to_regclass('public.month_close_settings') is not null then
        execute 'select late_day from public.month_close_settings limit 1' into v_late_day;
      end if;
      v_late_day := coalesce(v_late_day, 15);
      v_period := (date_trunc('month', current_date)
                   - case when extract(day from current_date) > v_late_day
                          then interval '1 month' else interval '2 months' end)::date;
      execute $q$
        select coalesce(jsonb_object_agg(c.id, jsonb_build_object(
                 'period', $1, 'status', coalesce(m.status, 'not_started'))), '{}'::jsonb)
          from public.clients c
          left join public.month_close m on m.client_id = c.id and m.period = $1
         where coalesce(m.status, 'not_started') not in ('done', 'na')
           and c.created_at < ($1 + interval '1 month')
      $q$ into v_close using v_period;
    exception when others then
      v_close := '{}'::jsonb;
    end;
  end if;

  -- Margin (admins only)
  if v_admin then
    begin
      select target_margin_pct into v_target from profitability_settings limit 1;
      select coalesce(jsonb_object_agg(p.client_id, p.margin_pct), '{}'::jsonb) into v_margin
        from public.client_profitability(current_date - 90, current_date, coalesce(p_default_fees, '{}'::jsonb)) p
       where p.margin_pct is not null;
    exception when others then
      v_margin := '{}'::jsonb;
    end;
  end if;

  return query
  with c as (
    select cl.id from clients cl where public.can_access_client(cl.id)
  ),
  overdue as (
    select r.client_id, count(*)::int n
      from staff_reminders r
     where r.done = false and r.client_id is not null
       and r.due_date is not null and r.due_date < current_date
     group by r.client_id
  ),
  app_time as (
    select t.client_id, sum(t.seconds) s
      from staff_app_time t
     where t.day >= current_date - 30
     group by t.client_id
  ),
  qbo_time as (
    select res.client_id, sum(a.minutes) m
      from qbo_time_activities a
      join qbo_customer_resolution res
        on res.realm_id = a.realm_id and res.qbo_customer_id = a.customer_qbo_id
     where a.txn_date >= current_date - 30 and res.client_id is not null
     group by res.client_id
  ),
  factors as (
    select c.id,
      case when coalesce(o.n, 0) > 0 then jsonb_build_object(
        'key', 'overdue', 'points', least(30, o.n * 10),
        'label', o.n || ' overdue task' || case when o.n = 1 then '' else 's' end) end f1,
      case
        when q.client_id is null then jsonb_build_object('key', 'qbo', 'points', 25, 'label', 'QuickBooks not connected')
        when q.last_error is not null and q.last_error <> '' then
          jsonb_build_object('key', 'qbo', 'points', 25, 'label', 'QuickBooks connection error')
        when coalesce(q.status, '') <> 'connected' then
          jsonb_build_object('key', 'qbo', 'points', 25, 'label', 'QuickBooks ' || coalesce(q.status, 'not connected'))
        when q.last_synced_at is null or q.last_synced_at < now() - interval '3 days' then
          jsonb_build_object('key', 'qbo_stale', 'points', 10, 'label',
            'QuickBooks last synced ' || coalesce(
              (current_date - q.last_synced_at::date) || ' days ago', 'never'))
      end f2,
      case when coalesce(apt.s, 0) = 0 and coalesce(qt.m, 0) = 0 then
        jsonb_build_object('key', 'inactive', 'points', 20, 'label', 'No staff time logged in 30 days') end f3,
      case when v_close ? c.id then jsonb_build_object('key', 'close_late', 'points', 20, 'label',
        to_char((v_close -> c.id ->> 'period')::date, 'FMMonth YYYY') || ' close is late ('
          || replace(v_close -> c.id ->> 'status', '_', ' ') || ')') end f4,
      case when v_admin and v_target is not null and v_margin ? c.id
                and (v_margin ->> c.id)::numeric < v_target then
        jsonb_build_object('key', 'margin', 'points', 15, 'label',
          'Margin ' || round((v_margin ->> c.id)::numeric) || '% (target ' || round(v_target) || '%)') end f5
    from c
    left join overdue o on o.client_id = c.id
    left join qbo_connections q on q.client_id = c.id
    left join app_time apt on apt.client_id = c.id
    left join qbo_time qt on qt.client_id = c.id
  ),
  scored as (
    select f.id,
      coalesce((select jsonb_agg(x) from unnest(array[f.f1, f.f2, f.f3, f.f4, f.f5]) x where x is not null),
               '[]'::jsonb) rs
    from factors f
  )
  select z.id, z.sc,
         case when z.sc >= 80 then 'green' when z.sc >= 50 then 'amber' else 'red' end,
         z.rs
    from (
      select s.id, s.rs,
             greatest(0, 100 - coalesce((select sum((e ->> 'points')::int)
                                          from jsonb_array_elements(s.rs) e), 0))::int sc
        from scored s
    ) z;
end;
$$;
revoke all on function public.client_health(jsonb) from public, anon;
grant execute on function public.client_health(jsonb) to authenticated;

commit;
