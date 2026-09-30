-- Intuit API usage counter and throttle guard (QBO features plan, Phase 1,
-- owner decision 2026-09-30).
--
-- Status: Applied to production 2026-09-30
-- Safe to re-run. Depends on staff-schema.sql (is_active_staff,
-- is_active_staff_admin), month-close.sql (month_close_before_write, reused
-- as the stamping trigger) and qbo-sync-cron-1min.sql (job qbo-sync-hourly).
--
-- Why: Intuit meters QuickBooks Online read calls. The free Builder tier
-- allows 500,000 a month, and a single Pro client synced every minute used
-- about 280,000 on its own.
--
--   qbo_api_usage        one row per calendar month (US Central) per source
--                        ('qbo-sync', 'qbo-firm-sync', 'estimate'). Only
--                        QuickBooks Accounting API calls are counted; OAuth
--                        token calls aren't metered by Intuit and aren't
--                        counted here.
--   qbo_usage_settings   one row: the monthly cap (500,000), the throttle
--                        threshold (0.80 of the cap, on the month-end
--                        projection), the hard-stop threshold (0.95 of the
--                        cap, on calls actually made), and the Pro cadence in
--                        minutes (15 normally, 30 when throttled). Admins edit.
--   qbo_usage_add()      SECURITY DEFINER, service_role only. The edge
--                        functions call it once per run with the number of
--                        Intuit calls that run made.
--   qbo_usage_status()   SECURITY DEFINER, active staff and service_role.
--                        Month-to-date calls, a straight-line projection to
--                        month end, and the mode:
--                          normal     Pro syncs every premium_interval_min
--                          throttled  projection >= throttle_pct x cap:
--                                     Pro syncs every throttled_interval_min
--                          stopped    calls >= hard_stop_pct x cap: scheduled
--                                     syncs stop; Sync now still works
--                        A new month starts a new row, so the mode recovers by
--                        itself on the 1st.
--
-- Also moves the qbo-sync-hourly cron from every minute to every 5 minutes
-- ('2-59/5', still off the token refresher's :00/:15/:30/:45). With Pro on a
-- 15-minute cadence a per-minute tick only burned Edge Function invocations.
--
-- RLS: admins read usage and settings; admins update settings. No browser
-- writes to qbo_api_usage at all.

create table if not exists public.qbo_api_usage (
  month      date   not null,
  source     text   not null,
  calls      bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (month, source),
  constraint qbo_api_usage_month_first check (month = date_trunc('month', month)::date),
  constraint qbo_api_usage_source_len check (length(source) between 1 and 40),
  constraint qbo_api_usage_calls_nonneg check (calls >= 0)
);

alter table public.qbo_api_usage enable row level security;

drop policy if exists "admins read qbo api usage" on public.qbo_api_usage;
create policy "admins read qbo api usage" on public.qbo_api_usage
  for select to authenticated
  using ((select public.is_active_staff_admin()));

revoke all on public.qbo_api_usage from anon, authenticated;
grant select on public.qbo_api_usage to authenticated;

create table if not exists public.qbo_usage_settings (
  id                     boolean primary key default true,
  monthly_cap            integer not null default 500000,
  throttle_pct           numeric(4,3) not null default 0.800,
  hard_stop_pct          numeric(4,3) not null default 0.950,
  premium_interval_min   integer not null default 15,
  throttled_interval_min integer not null default 30,
  updated_by             text,
  updated_at             timestamptz not null default now(),
  constraint qbo_usage_settings_singleton check (id),
  constraint qbo_usage_settings_cap check (monthly_cap between 1000 and 100000000),
  constraint qbo_usage_settings_pcts check (
    throttle_pct > 0 and throttle_pct <= 1 and hard_stop_pct > 0 and hard_stop_pct <= 1
    and throttle_pct <= hard_stop_pct
  ),
  constraint qbo_usage_settings_intervals check (
    premium_interval_min between 5 and 1440
    and throttled_interval_min between premium_interval_min and 1440
  )
);

insert into public.qbo_usage_settings (id) values (true) on conflict (id) do nothing;

alter table public.qbo_usage_settings enable row level security;

drop policy if exists "admins read qbo usage settings" on public.qbo_usage_settings;
create policy "admins read qbo usage settings" on public.qbo_usage_settings
  for select to authenticated
  using ((select public.is_active_staff_admin()));

drop policy if exists "admins update qbo usage settings" on public.qbo_usage_settings;
create policy "admins update qbo usage settings" on public.qbo_usage_settings
  for update to authenticated
  using ((select public.is_active_staff_admin()))
  with check ((select public.is_active_staff_admin()));

drop trigger if exists qbo_usage_settings_before_write on public.qbo_usage_settings;
create trigger qbo_usage_settings_before_write
  before update on public.qbo_usage_settings
  for each row execute function public.month_close_before_write();

revoke all on public.qbo_usage_settings from anon, authenticated;
grant select, update on public.qbo_usage_settings to authenticated;

-- The usage month, in US Central like the rest of the app's schedules.
create or replace function public.qbo_usage_month(p_at timestamptz default now())
returns date
language sql
stable
set search_path = public
as $$
  select date_trunc('month', p_at at time zone 'America/Chicago')::date;
$$;

create or replace function public.qbo_usage_add(p_source text, p_calls integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_calls is null or p_calls <= 0 then
    return;
  end if;
  if p_calls > 100000 then
    raise exception 'qbo_usage_add: % calls in one run is not plausible', p_calls;
  end if;
  if p_source is null or length(p_source) not between 1 and 40 then
    raise exception 'qbo_usage_add: bad source';
  end if;
  insert into public.qbo_api_usage as u (month, source, calls, updated_at)
  values (public.qbo_usage_month(), p_source, p_calls, now())
  on conflict (month, source)
  do update set calls = u.calls + excluded.calls, updated_at = now();
end;
$$;

revoke all on function public.qbo_usage_add(text, integer) from public, anon, authenticated;
grant execute on function public.qbo_usage_add(text, integer) to service_role;

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
    s.premium_interval_min := 15;
    s.throttled_interval_min := 30;
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

revoke all on function public.qbo_usage_month(timestamptz) from public, anon;
grant execute on function public.qbo_usage_month(timestamptz) to authenticated, service_role;

-- One-time estimate for the month the counter was installed in, so the first
-- month isn't shown as near zero. Each successful qbo-sync run made 6 reads
-- (accounts, P&L, budget, invoices, bills, transaction list); a failed run is
-- counted as 1. Only inserted if the month has no estimate yet.
insert into public.qbo_api_usage (month, source, calls)
select public.qbo_usage_month(), 'estimate',
       coalesce(sum(case when status = 'ok' then 6 else 1 end), 0)
  from public.qbo_sync_runs
 where started_at >= (public.qbo_usage_month()::timestamp at time zone 'America/Chicago')
on conflict (month, source) do nothing;

-- Cron: every 5 minutes instead of every minute. Pro's 15-minute cadence is
-- decided in qbo-sync (isDueForPlan); the tick only has to be finer than it.
select cron.alter_job(jobid, schedule := '2-59/5 * * * *')
  from cron.job
 where jobname = 'qbo-sync-hourly';
