-- Pro sync cadence fallbacks: 60 / 120 minutes (follow-up to qbo-sync-hourly-cadence.sql,
-- commit 8b75cb5; owner decision 2026-10-14).
--
-- The settings row was moved to 60 (normal) / 120 (throttled), but two SQL
-- functions still fell back to the old 15 / 30 if the settings row or the
-- usage status were ever missing, which would have raised false "overdue"
-- Pro alerts (and made qbo-sync read a 15-minute Pro cadence, spending Intuit calls). This redefines them with the new fallbacks (bodies otherwise
-- identical to production):
--   public.qbo_usage_status()   no-settings-row fallback 15/30 -> 60/120
--   public.qbo_sync_health(boolean)  v_int default and coalesce 15 -> 60
-- Also re-asserts the column defaults (idempotent).
--
-- Depends on: qbo-usage-guard.sql (qbo_usage_settings, qbo_usage_month),
--             ops-alerting.sql (clients, qbo_connections, qbo_sync_runs),
--             qbo-sync-hourly-cadence.sql.
-- Re-runnable. Grants and search_path are unchanged (set search_path = public;
-- qbo_usage_status: authenticated + service_role; qbo_sync_health: service_role only).
-- Applied to production 2026-10-14 as migration qbo_sync_hourly_fallbacks.

alter table public.qbo_usage_settings alter column premium_interval_min   set default 60;
alter table public.qbo_usage_settings alter column throttled_interval_min set default 120;

create or replace function public.qbo_usage_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s            public.qbo_usage_settings%rowtype;
  v_month      date := public.qbo_usage_month();
  v_local      timestamp := now() at time zone 'America/Chicago';
  v_days       numeric;
  v_elapsed    numeric;
  v_calls      bigint;
  v_by_source  jsonb;
  v_projected  bigint;
  v_mode       text;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not public.is_active_staff() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  select * into s from public.qbo_usage_settings where id;
  if not found then
    s.monthly_cap := 500000;
    s.throttle_pct := 0.8;
    s.hard_stop_pct := 0.95;
    s.premium_interval_min := 60;
    s.throttled_interval_min := 120;
  end if;

  select coalesce(sum(calls), 0), coalesce(jsonb_object_agg(source, calls), '{}'::jsonb)
    into v_calls, v_by_source
    from public.qbo_api_usage where month = v_month;

  v_days := extract(day from (v_month + interval '1 month' - interval '1 day'));
  -- At least one day elapsed, so the first hours of a month don't project
  -- a handful of calls into millions.
  v_elapsed := greatest(extract(epoch from (v_local - v_month::timestamp)) / 86400.0, 1.0);
  v_projected := round(v_calls * v_days / least(v_elapsed, v_days));

  v_mode := case
    when v_calls >= s.hard_stop_pct * s.monthly_cap then 'stopped'
    when v_projected >= s.throttle_pct * s.monthly_cap then 'throttled'
    else 'normal'
  end;

  return jsonb_build_object(
    'month', v_month,
    'calls', v_calls,
    'by_source', v_by_source,
    'days_in_month', v_days,
    'days_elapsed', round(least(v_elapsed, v_days), 2),
    'projected', v_projected,
    'cap', s.monthly_cap,
    'throttle_pct', s.throttle_pct,
    'hard_stop_pct', s.hard_stop_pct,
    'mode', v_mode,
    'premium_interval_min', case when v_mode = 'normal' then s.premium_interval_min else s.throttled_interval_min end,
    'normal_interval_min', s.premium_interval_min,
    'throttled_interval_min', s.throttled_interval_min
  );
end;
$$;

revoke all on function public.qbo_usage_status() from public, anon;
grant execute on function public.qbo_usage_status() to authenticated, service_role;

create or replace function public.qbo_sync_health(p_include_test boolean default false)
returns table (
  client_id text,
  client_name text,
  plan text,
  test_only boolean,
  status text,
  connected_at timestamptz,
  last_synced_at timestamptz,
  last_error text,
  expected text,
  overdue boolean,
  overdue_2x boolean,
  errors_in_a_row integer,
  errors_7d integer,
  last_run_status text,
  last_run_at timestamptz,
  last_run_detail text,
  paused_by_usage boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_usage  jsonb;
  v_int    integer := 60;
  v_paused boolean := false;
  v_today  date := (now() at time zone 'America/Chicago')::date;
  v_d15    date;
  v_prev15 date;
begin
  begin
    v_usage := public.qbo_usage_status();
    v_int := coalesce((v_usage ->> 'premium_interval_min')::integer, 60);
    v_paused := coalesce(v_usage ->> 'mode', '') = 'stopped';
  exception when others then
    null;  -- usage status unavailable: assume the normal cadence
  end;
  -- The most recent 15th on or before today (Central), and the one before.
  v_d15 := case when extract(day from v_today) >= 15
                then date_trunc('month', v_today)::date + 14
                else (date_trunc('month', v_today) - interval '1 month')::date + 14 end;
  v_prev15 := (v_d15 - interval '1 month')::date;

  return query
  select
    q.client_id,
    c.name,
    c.plan,
    coalesce(c.test_only, false),
    q.status,
    q.connected_at,
    q.last_synced_at,
    q.last_error,
    case c.plan
      when 'basic' then 'monthly on the 15th'
      when 'standard' then 'weekly'
      else 'every ' || v_int || ' min'
    end,
    -- overdue
    q.status = 'connected' and case
      when q.last_synced_at is null then q.connected_at < now() - interval '1 hour'
      when c.plan = 'basic' then v_today > v_d15
        and (q.last_synced_at at time zone 'America/Chicago')::date < v_d15
      when c.plan = 'standard' then q.last_synced_at < now() - interval '7 days 1 hour'
      else q.last_synced_at < now() - make_interval(mins => v_int + 10)
    end,
    -- 2x overdue
    q.status = 'connected' and case
      when q.last_synced_at is null then q.connected_at < now() - interval '2 hours'
      when c.plan = 'basic' then v_today > v_d15
        and (q.last_synced_at at time zone 'America/Chicago')::date < v_prev15
      when c.plan = 'standard' then q.last_synced_at < now() - interval '14 days'
      else q.last_synced_at < now() - make_interval(mins => 2 * v_int + 5)
    end,
    coalesce(e.in_a_row, 0)::integer,
    coalesce(e.week, 0)::integer,
    lr.status,
    lr.started_at,
    lr.detail,
    v_paused
  from qbo_connections q
  join clients c on c.id = q.client_id
  left join lateral (
    select
      count(*) filter (
        where r.status = 'error'
          and r.started_at > coalesce(
            (select max(r2.started_at) from qbo_sync_runs r2
              where r2.client_id = q.client_id and r2.status = 'ok'),
            '-infinity'::timestamptz)
      ) as in_a_row,
      count(*) filter (where r.status = 'error' and r.started_at > now() - interval '7 days') as week
    from qbo_sync_runs r
    where r.client_id = q.client_id
  ) e on true
  left join lateral (
    select r.status, r.started_at, r.detail
    from qbo_sync_runs r
    where r.client_id = q.client_id
    order by r.started_at desc
    limit 1
  ) lr on true
  where p_include_test or not coalesce(c.test_only, false);
end;
$$;

revoke all on function public.qbo_sync_health(boolean) from public, anon, authenticated;
grant execute on function public.qbo_sync_health(boolean) to service_role;
