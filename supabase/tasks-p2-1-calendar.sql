-- =====================================================================
-- Tasks Phase 2, slice S1: the business calendar.
-- Spec: docs/tasks-phase2-spec.md C1 (+ critique m1, m2).
--
-- Safe to re-run. No transaction control (apply_migration wraps it).
-- Additive only: one new table, new functions, and tk_schema_version()
-- returns 2. Nothing is dropped, truncated or deleted.
--
-- The live pg_default_acl hands anon and authenticated every privilege on
-- new tables and EXECUTE on new functions, so each object starts from
-- "revoke all" and then gets exactly what it needs.
--
-- JS mirror: components/tasks/TK_recurrenceLogic.js. Both must agree on
-- every case in components/tasks/TK_recurrence.fixtures.js. The holiday
-- seed and the selftest values below are generated from that file:
--   node components/tasks/TK_recurrenceLogic.test.js --sql
--
-- Holidays are seeded through 2028 only (critique m1). Past that, business
-- day math treats holidays as working days until the owner adds more rows.
-- The S4 generator adds a run-log warning when max(day) < today + 365.
-- =====================================================================

-- 1. tk_holidays ------------------------------------------------------
create table if not exists public.tk_holidays (
  day date primary key,
  name text not null check (char_length(name) between 1 and 120),
  firm_closed boolean not null default true,
  created_by text default lower(coalesce(auth.jwt() ->> 'email', '')),
  created_at timestamptz not null default now()
);

alter table public.tk_holidays enable row level security;
revoke all on table public.tk_holidays from public, anon, authenticated;
grant select, insert, update on table public.tk_holidays to authenticated;

-- No delete grant: switch a day off with firm_closed = false instead.
drop policy if exists "tk holidays read" on public.tk_holidays;
create policy "tk holidays read" on public.tk_holidays for select to authenticated
  using (public.is_active_staff());
drop policy if exists "tk holidays admin insert" on public.tk_holidays;
create policy "tk holidays admin insert" on public.tk_holidays for insert to authenticated
  with check (public.is_active_staff_admin());
drop policy if exists "tk holidays admin update" on public.tk_holidays;
create policy "tk holidays admin update" on public.tk_holidays for update to authenticated
  using (public.is_active_staff_admin()) with check (public.is_active_staff_admin());

-- Seed: US Federal Reserve bank holidays 2026-2028 (Saturday holidays are
-- not observed; Sunday ones move to Monday) plus the owner's firm days
-- (Q6): Good Friday, the day after Thanksgiving, Christmas Eve. Existing
-- rows are never touched, so owner edits survive a re-run.
insert into public.tk_holidays (day, name, created_by) 
select v.day, v.name, 'seed' from (values
  (date '2026-01-01', 'New Year''s Day'),
  (date '2026-01-19', 'Martin Luther King Jr. Day'),
  (date '2026-02-16', 'Presidents Day'),
  (date '2026-04-03', 'Good Friday (firm)'),
  (date '2026-05-25', 'Memorial Day'),
  (date '2026-06-19', 'Juneteenth'),
  (date '2026-09-07', 'Labor Day'),
  (date '2026-10-12', 'Columbus Day'),
  (date '2026-11-11', 'Veterans Day'),
  (date '2026-11-26', 'Thanksgiving'),
  (date '2026-11-27', 'Day after Thanksgiving (firm)'),
  (date '2026-12-24', 'Christmas Eve (firm)'),
  (date '2026-12-25', 'Christmas Day'),
  (date '2027-01-01', 'New Year''s Day'),
  (date '2027-01-18', 'Martin Luther King Jr. Day'),
  (date '2027-02-15', 'Presidents Day'),
  (date '2027-03-26', 'Good Friday (firm)'),
  (date '2027-05-31', 'Memorial Day'),
  (date '2027-07-05', 'Independence Day (observed)'),
  (date '2027-09-06', 'Labor Day'),
  (date '2027-10-11', 'Columbus Day'),
  (date '2027-11-11', 'Veterans Day'),
  (date '2027-11-25', 'Thanksgiving'),
  (date '2027-11-26', 'Day after Thanksgiving (firm)'),
  (date '2027-12-24', 'Christmas Eve (firm)'),
  (date '2028-01-17', 'Martin Luther King Jr. Day'),
  (date '2028-02-21', 'Presidents Day'),
  (date '2028-04-14', 'Good Friday (firm)'),
  (date '2028-05-29', 'Memorial Day'),
  (date '2028-06-19', 'Juneteenth'),
  (date '2028-07-04', 'Independence Day'),
  (date '2028-09-04', 'Labor Day'),
  (date '2028-10-09', 'Columbus Day'),
  (date '2028-11-23', 'Thanksgiving'),
  (date '2028-11-24', 'Day after Thanksgiving (firm)'),
  (date '2028-12-25', 'Christmas Day')
) as v(day, name)
on conflict (day) do nothing;

-- 2. Calendar functions -----------------------------------------------
-- tk_is_business_day is SECURITY DEFINER (critique m2): it reads only
-- tk_holidays, and every caller (staff, client JWT paths, cron) must get
-- the same dates whatever their own RLS lets them read.
create or replace function public.tk_is_business_day(p_day date)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_day is not null
     and extract(isodow from p_day) < 6
     and not exists (select 1 from public.tk_holidays h where h.day = p_day and h.firm_closed);
$$;

-- n business days after (n > 0) or before (n < 0) p_day. n = 0 returns
-- p_day when it is a business day, else the next one.
create or replace function public.tk_add_business_days(p_day date, p_n int)
returns date
language plpgsql
stable
set search_path = public
as $$
declare
  d date := p_day;
  v_left int;
  v_step int;
begin
  if p_day is null or p_n is null then
    return null;
  end if;
  if abs(p_n) > 400 then
    raise exception 'business day offset out of range' using errcode = '22023';
  end if;
  if p_n = 0 then
    while not public.tk_is_business_day(d) loop
      d := d + 1;
    end loop;
    return d;
  end if;
  v_step := case when p_n < 0 then -1 else 1 end;
  v_left := abs(p_n);
  while v_left > 0 loop
    d := d + v_step;
    if public.tk_is_business_day(d) then
      v_left := v_left - 1;
    end if;
  end loop;
  return d;
end;
$$;

-- The Nth business day of the month holding p_month. n = -1 is the last
-- business day. A month with fewer than n business days returns its last.
-- Any other n returns null.
create or replace function public.tk_business_day_of_month(p_month date, p_n int)
returns date
language plpgsql
stable
set search_path = public
as $$
declare
  v_first date;
  v_last date;
  v_last_bd date;
  d date;
  c int := 0;
begin
  if p_month is null or p_n is null or not (p_n >= 1 or p_n = -1) then
    return null;
  end if;
  v_first := date_trunc('month', p_month)::date;
  v_last := (v_first + interval '1 month' - interval '1 day')::date;
  v_last_bd := v_last;
  while not public.tk_is_business_day(v_last_bd) loop
    v_last_bd := v_last_bd - 1;
  end loop;
  if p_n = -1 then
    return v_last_bd;
  end if;
  d := v_first;
  while d <= v_last loop
    if public.tk_is_business_day(d) then
      c := c + 1;
      if c = p_n then
        return d;
      end if;
    end if;
    d := d + 1;
  end loop;
  return v_last_bd;
end;
$$;

create or replace function public.tk_roll(p_day date, p_mode text)
returns date
language plpgsql
stable
set search_path = public
as $$
declare
  d date := p_day;
  v_mode text := coalesce(p_mode, 'none');
begin
  if p_day is null then
    return null;
  end if;
  if v_mode = 'none' then
    return p_day;
  end if;
  if v_mode not in ('next', 'prev') then
    raise exception 'roll must be next, prev or none' using errcode = '22023';
  end if;
  while not public.tk_is_business_day(d) loop
    d := d + case when v_mode = 'next' then 1 else -1 end;
  end loop;
  return d;
end;
$$;

-- Same rules as TK_dueRuleValid (JS). null is valid (legacy offset).
create or replace function public.tk__rule_int(p_rule jsonb, p_key text, p_lo int, p_hi int, p_optional boolean)
returns boolean
language sql
immutable
set search_path = public
as $$
  select case
    when p_rule -> p_key is null or jsonb_typeof(p_rule -> p_key) = 'null' then p_optional
    when jsonb_typeof(p_rule -> p_key) <> 'number' then false
    else (p_rule ->> p_key)::numeric = trunc((p_rule ->> p_key)::numeric)
         and (p_rule ->> p_key)::numeric between p_lo and p_hi
  end;
$$;

create or replace function public.tk_due_rule_valid(p_rule jsonb)
returns boolean
language sql
immutable
set search_path = public
as $$
  select case
    when p_rule is null or jsonb_typeof(p_rule) = 'null' then true
    when jsonb_typeof(p_rule) <> 'object' then false
    else
      coalesce(
        (p_rule ->> 'type' <> 'offset' or public.tk__rule_int(p_rule, 'days', -90, 120, false))
        and (p_rule ->> 'type' not in ('business_day', 'day_of_month', 'eom', 'nth_weekday')
             or public.tk__rule_int(p_rule, 'month_offset', 0, 12, true))
        and (p_rule ->> 'type' not in ('day_of_month', 'nth_weekday')
             or p_rule -> 'roll' is null or jsonb_typeof(p_rule -> 'roll') = 'null'
             or (jsonb_typeof(p_rule -> 'roll') = 'string' and p_rule ->> 'roll' in ('next', 'prev', 'none')))
        and case p_rule ->> 'type'
          when 'offset' then true
          when 'business_day' then public.tk__rule_int(p_rule, 'n', 1, 23, false)
                                   or public.tk__rule_int(p_rule, 'n', -1, -1, false)
          when 'day_of_month' then public.tk__rule_int(p_rule, 'day', 1, 31, false)
          when 'eom' then public.tk__rule_int(p_rule, 'offset_bd', 0, 10, true)
          when 'nth_weekday' then (public.tk__rule_int(p_rule, 'n', 1, 5, false)
                                   or public.tk__rule_int(p_rule, 'n', -1, -1, false))
                                  and public.tk__rule_int(p_rule, 'dow', 1, 7, false)
          when 'weekday' then public.tk__rule_int(p_rule, 'dow', 1, 7, false)
          else false
        end,
      false)
  end;
$$;

-- The due date for one period. A null rule returns null: the caller falls
-- back to the legacy due_offset_days ({type:'offset', days}). month_offset
-- counts from the month the period ends in (default 1 = the month after).
create or replace function public.tk_resolve_due(p_rule jsonb, p_period_start date, p_period_end date)
returns date
language plpgsql
stable
set search_path = public
as $$
declare
  v_type text;
  v_target date;
  v_dim int;
  v_n int;
  v_dow int;
  d int;
  v_monday date;
begin
  if p_rule is null or jsonb_typeof(p_rule) = 'null' then
    return null;
  end if;
  if not public.tk_due_rule_valid(p_rule) then
    raise exception 'invalid due rule' using errcode = '22023';
  end if;
  if p_period_start is null or p_period_end is null then
    return null;
  end if;
  v_type := p_rule ->> 'type';
  v_target := (date_trunc('month', p_period_end)
               + make_interval(months => coalesce((p_rule ->> 'month_offset')::int, 1)))::date;
  v_dim := extract(day from (v_target + interval '1 month' - interval '1 day'))::int;

  if v_type = 'offset' then
    return p_period_end + (p_rule ->> 'days')::int;
  elsif v_type = 'business_day' then
    return public.tk_business_day_of_month(v_target, (p_rule ->> 'n')::int);
  elsif v_type = 'day_of_month' then
    return public.tk_roll(v_target + (least((p_rule ->> 'day')::int, v_dim) - 1),
                          coalesce(p_rule ->> 'roll', 'next'));
  elsif v_type = 'eom' then
    return public.tk_add_business_days(public.tk_business_day_of_month(v_target, -1),
                                       -coalesce((p_rule ->> 'offset_bd')::int, 0));
  elsif v_type = 'nth_weekday' then
    v_n := (p_rule ->> 'n')::int;
    v_dow := (p_rule ->> 'dow')::int;
    if v_n = -1 then
      d := v_dim;
      while extract(isodow from v_target + (d - 1))::int <> v_dow loop
        d := d - 1;
      end loop;
    else
      d := 1;
      while extract(isodow from v_target + (d - 1))::int <> v_dow loop
        d := d + 1;
      end loop;
      d := d + 7 * (v_n - 1);
      if d > v_dim then
        d := d - 7; -- no 5th one this month: the last one
      end if;
    end if;
    return public.tk_roll(v_target + (d - 1), coalesce(p_rule ->> 'roll', 'none'));
  elsif v_type = 'weekday' then
    v_monday := p_period_start - (extract(isodow from p_period_start)::int - 1);
    return public.tk_roll(v_monday + ((p_rule ->> 'dow')::int - 1), 'next');
  end if;
  return null;
end;
$$;

-- Period start for a kind, with the fiscal year end passed in ('MM-DD' or
-- 'M/D'; anything else means 12-31). Quarters are calendar quarters (owner
-- Q2); 'year' is the fiscal year (critique M6). S2's tk_period_start wraps
-- this with the client's client_profile.fiscal_year_end.
create or replace function public.tk_period_start_for(p_kind text, p_day date, p_fiscal_year_end text)
returns date
language plpgsql
immutable
set search_path = public
as $$
declare
  v_m text[];
  v_end_month int := 12;
  v_start_month int;
begin
  if p_day is null then
    return null;
  end if;
  if p_kind = 'week' then
    return p_day - (extract(isodow from p_day)::int - 1);
  elsif p_kind = 'month' then
    return date_trunc('month', p_day)::date;
  elsif p_kind = 'quarter' then
    return date_trunc('quarter', p_day)::date;
  elsif p_kind = 'calendar_year' then
    return date_trunc('year', p_day)::date;
  elsif p_kind = 'year' then
    v_m := regexp_match(coalesce(p_fiscal_year_end, ''), '^\s*(\d{1,2})[-/](\d{1,2})\s*$');
    if v_m is not null and v_m[1]::int between 1 and 12 then
      v_end_month := v_m[1]::int;
    end if;
    v_start_month := (v_end_month % 12) + 1;
    return make_date(case when extract(month from p_day)::int >= v_start_month
                          then extract(year from p_day)::int
                          else extract(year from p_day)::int - 1 end,
                     v_start_month, 1);
  end if;
  raise exception 'unknown period kind %', p_kind using errcode = '22023';
end;
$$;

-- 3. Selftest: the shared fixtures, failures only ----------------------
-- Admin only (no JWT = SQL editor / MCP, allowed). Assumes the seeded
-- holidays above; an owner edit to one of those days shows up here.
create or replace function public.tk_recurrence_selftest()
returns table (case_id text, expected date, got date)
language plpgsql
stable
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.is_active_staff_admin() then
    raise exception 'Only admins can run the calendar selftest' using errcode = '42501';
  end if;
  return query
  with f(id, fn, rule, a, b, n, t1, t2, expected) as (
    values
      ('offset_15', 'resolve', '{"type":"offset","days":15}'::jsonb, '2026-09-01'::date, '2026-09-30'::date, null::int, null::text, null::text, date '2026-10-15'),
      ('offset_neg5', 'resolve', '{"type":"offset","days":-5}'::jsonb, '2026-09-01'::date, '2026-09-30'::date, null::int, null::text, null::text, date '2026-09-25'),
      ('offset_120_year_end', 'resolve', '{"type":"offset","days":120}'::jsonb, '2026-09-01'::date, '2026-09-30'::date, null::int, null::text, null::text, date '2027-01-28'),
      ('bd1_oct', 'resolve', '{"type":"business_day","n":1}'::jsonb, '2026-09-01'::date, '2026-09-30'::date, null::int, null::text, null::text, date '2026-10-01'),
      ('bd1_dec', 'resolve', '{"type":"business_day","n":1}'::jsonb, '2026-11-01'::date, '2026-11-30'::date, null::int, null::text, null::text, date '2026-12-01'),
      ('bd1_jan_new_year', 'resolve', '{"type":"business_day","n":1}'::jsonb, '2026-12-01'::date, '2026-12-31'::date, null::int, null::text, null::text, date '2027-01-04'),
      ('bd5_jan_new_year', 'resolve', '{"type":"business_day","n":5}'::jsonb, '2025-12-01'::date, '2025-12-31'::date, null::int, null::text, null::text, date '2026-01-08'),
      ('bd10_skips_columbus', 'resolve', '{"type":"business_day","n":10}'::jsonb, '2026-09-01'::date, '2026-09-30'::date, null::int, null::text, null::text, date '2026-10-15'),
      ('bd_last_oct', 'resolve', '{"type":"business_day","n":-1}'::jsonb, '2026-09-01'::date, '2026-09-30'::date, null::int, null::text, null::text, date '2026-10-30'),
      ('bd_last_nov', 'resolve', '{"type":"business_day","n":-1}'::jsonb, '2026-10-01'::date, '2026-10-31'::date, null::int, null::text, null::text, date '2026-11-30'),
      ('bd_last_dec', 'resolve', '{"type":"business_day","n":-1}'::jsonb, '2026-11-01'::date, '2026-11-30'::date, null::int, null::text, null::text, date '2026-12-31'),
      ('bd23_feb_short_month', 'resolve', '{"type":"business_day","n":23}'::jsonb, '2026-01-01'::date, '2026-01-31'::date, null::int, null::text, null::text, date '2026-02-27'),
      ('bd3_same_month', 'resolve', '{"type":"business_day","n":3,"month_offset":0}'::jsonb, '2026-02-01'::date, '2026-02-28'::date, null::int, null::text, null::text, date '2026-02-04'),
      ('bd1_quarter_offset2', 'resolve', '{"type":"business_day","n":1,"month_offset":2}'::jsonb, '2026-07-01'::date, '2026-09-30'::date, null::int, null::text, null::text, date '2026-11-02'),
      ('bd3_good_friday', 'resolve', '{"type":"business_day","n":3,"month_offset":0}'::jsonb, '2026-04-01'::date, '2026-04-30'::date, null::int, null::text, null::text, date '2026-04-06'),
      ('bd15_quarter_q4', 'resolve', '{"type":"business_day","n":15}'::jsonb, '2026-10-01'::date, '2026-12-31'::date, null::int, null::text, null::text, date '2027-01-25'),
      ('dom15', 'resolve', '{"type":"day_of_month","day":15}'::jsonb, '2026-09-01'::date, '2026-09-30'::date, null::int, null::text, null::text, date '2026-10-15'),
      ('dom31_feb_clamp_next', 'resolve', '{"type":"day_of_month","day":31}'::jsonb, '2026-01-01'::date, '2026-01-31'::date, null::int, null::text, null::text, date '2026-03-02'),
      ('dom31_feb_clamp_prev', 'resolve', '{"type":"day_of_month","day":31,"roll":"prev"}'::jsonb, '2026-01-01'::date, '2026-01-31'::date, null::int, null::text, null::text, date '2026-02-27'),
      ('dom29_leap_none', 'resolve', '{"type":"day_of_month","day":29,"roll":"none"}'::jsonb, '2028-01-01'::date, '2028-01-31'::date, null::int, null::text, null::text, date '2028-02-29'),
      ('dom29_feb_nonleap', 'resolve', '{"type":"day_of_month","day":29}'::jsonb, '2027-01-01'::date, '2027-01-31'::date, null::int, null::text, null::text, date '2027-03-01'),
      ('dom19_juneteenth_monday', 'resolve', '{"type":"day_of_month","day":19}'::jsonb, '2028-05-01'::date, '2028-05-31'::date, null::int, null::text, null::text, date '2028-06-20'),
      ('dom18_sunday_then_mlk', 'resolve', '{"type":"day_of_month","day":18}'::jsonb, '2025-12-01'::date, '2025-12-31'::date, null::int, null::text, null::text, date '2026-01-20'),
      ('dom4_july_observed_next', 'resolve', '{"type":"day_of_month","day":4}'::jsonb, '2027-06-01'::date, '2027-06-30'::date, null::int, null::text, null::text, date '2027-07-06'),
      ('dom4_july_prev', 'resolve', '{"type":"day_of_month","day":4,"roll":"prev"}'::jsonb, '2027-06-01'::date, '2027-06-30'::date, null::int, null::text, null::text, date '2027-07-02'),
      ('eom0_oct', 'resolve', '{"type":"eom","offset_bd":0}'::jsonb, '2026-09-01'::date, '2026-09-30'::date, null::int, null::text, null::text, date '2026-10-30'),
      ('eom5_dec_holidays', 'resolve', '{"type":"eom","offset_bd":5}'::jsonb, '2026-11-01'::date, '2026-11-30'::date, null::int, null::text, null::text, date '2026-12-22'),
      ('eom1_thanksgiving', 'resolve', '{"type":"eom","offset_bd":1}'::jsonb, '2026-10-01'::date, '2026-10-31'::date, null::int, null::text, null::text, date '2026-11-25'),
      ('eom_default_same_month', 'resolve', '{"type":"eom","month_offset":0}'::jsonb, '2026-02-01'::date, '2026-02-28'::date, null::int, null::text, null::text, date '2026-02-27'),
      ('nth2_tue', 'resolve', '{"type":"nth_weekday","n":2,"dow":2}'::jsonb, '2026-09-01'::date, '2026-09-30'::date, null::int, null::text, null::text, date '2026-10-13'),
      ('nth_last_fri', 'resolve', '{"type":"nth_weekday","n":-1,"dow":5}'::jsonb, '2026-09-01'::date, '2026-09-30'::date, null::int, null::text, null::text, date '2026-10-30'),
      ('nth5_mon_none_falls_back', 'resolve', '{"type":"nth_weekday","n":5,"dow":1}'::jsonb, '2026-01-01'::date, '2026-01-31'::date, null::int, null::text, null::text, date '2026-02-23'),
      ('nth3_mon_holiday_no_roll', 'resolve', '{"type":"nth_weekday","n":3,"dow":1}'::jsonb, '2025-12-01'::date, '2025-12-31'::date, null::int, null::text, null::text, date '2026-01-19'),
      ('nth3_mon_holiday_roll_next', 'resolve', '{"type":"nth_weekday","n":3,"dow":1,"roll":"next"}'::jsonb, '2025-12-01'::date, '2025-12-31'::date, null::int, null::text, null::text, date '2026-01-20'),
      ('nth4_thu_thanksgiving', 'resolve', '{"type":"nth_weekday","n":4,"dow":4,"month_offset":0}'::jsonb, '2026-11-01'::date, '2026-11-30'::date, null::int, null::text, null::text, date '2026-11-26'),
      ('wk_fri_new_year', 'resolve', '{"type":"weekday","dow":5}'::jsonb, '2026-12-28'::date, '2027-01-03'::date, null::int, null::text, null::text, date '2027-01-04'),
      ('wk_wed_year_end', 'resolve', '{"type":"weekday","dow":3}'::jsonb, '2026-12-28'::date, '2027-01-03'::date, null::int, null::text, null::text, date '2026-12-30'),
      ('wk_thu_thanksgiving', 'resolve', '{"type":"weekday","dow":4}'::jsonb, '2026-11-23'::date, '2026-11-29'::date, null::int, null::text, null::text, date '2026-11-30'),
      ('wk_mon', 'resolve', '{"type":"weekday","dow":1}'::jsonb, '2027-12-27'::date, '2028-01-02'::date, null::int, null::text, null::text, date '2027-12-27'),
      ('wk_fri_christmas_eve', 'resolve', '{"type":"weekday","dow":5}'::jsonb, '2027-12-20'::date, '2027-12-26'::date, null::int, null::text, null::text, date '2027-12-27'),
      ('fy_jun_990', 'resolve', '{"type":"day_of_month","day":15,"month_offset":5}'::jsonb, '2026-07-01'::date, '2027-06-30'::date, null::int, null::text, null::text, date '2027-11-15'),
      ('fy_sep_sunday', 'resolve', '{"type":"day_of_month","day":15,"month_offset":2}'::jsonb, '2025-10-01'::date, '2026-09-30'::date, null::int, null::text, null::text, date '2026-11-16'),
      ('add1_thanksgiving', 'add_bd', null::jsonb, '2026-11-25'::date, null::date, 1, null::text, null::text, date '2026-11-30'),
      ('add_neg1_thanksgiving', 'add_bd', null::jsonb, '2026-11-30'::date, null::date, -1, null::text, null::text, date '2026-11-25'),
      ('add0_weekend', 'add_bd', null::jsonb, '2026-12-26'::date, null::date, 0, null::text, null::text, date '2026-12-28'),
      ('add2_christmas', 'add_bd', null::jsonb, '2026-12-23'::date, null::date, 2, null::text, null::text, date '2026-12-29'),
      ('add_neg1_new_year', 'add_bd', null::jsonb, '2027-01-04'::date, null::date, -1, null::text, null::text, date '2026-12-31'),
      ('add10_columbus', 'add_bd', null::jsonb, '2026-10-14'::date, null::date, 10, null::text, null::text, date '2026-10-28'),
      ('add_neg1_unseeded_2025', 'add_bd', null::jsonb, '2026-01-02'::date, null::date, -1, null::text, null::text, date '2025-12-31'),
      ('bdom1_feb', 'bdom', null::jsonb, '2026-02-10'::date, null::date, 1, null::text, null::text, date '2026-02-02'),
      ('bdom1_jan_2028_sat_new_year', 'bdom', null::jsonb, '2028-01-05'::date, null::date, 1, null::text, null::text, date '2028-01-03'),
      ('bdom_last_may', 'bdom', null::jsonb, '2026-05-01'::date, null::date, -1, null::text, null::text, date '2026-05-29'),
      ('roll_jul3_2026_open', 'roll', null::jsonb, '2026-07-03'::date, null::date, null::int, 'next'::text, null::text, date '2026-07-03'),
      ('roll_prev_thanksgiving', 'roll', null::jsonb, '2026-11-26'::date, null::date, null::int, 'prev'::text, null::text, date '2026-11-25'),
      ('roll_none_holiday', 'roll', null::jsonb, '2026-12-25'::date, null::date, null::int, 'none'::text, null::text, date '2026-12-25'),
      ('ps_quarter_nov', 'pstart', null::jsonb, '2026-11-15'::date, null::date, null::int, 'quarter'::text, '06-30'::text, date '2026-10-01'),
      ('ps_quarter_mar31', 'pstart', null::jsonb, '2026-03-31'::date, null::date, null::int, 'quarter'::text, null::text, date '2026-01-01'),
      ('ps_year_jun_fye_before', 'pstart', null::jsonb, '2026-05-10'::date, null::date, null::int, 'year'::text, '06-30'::text, date '2025-07-01'),
      ('ps_year_jun_fye_first_day', 'pstart', null::jsonb, '2026-07-01'::date, null::date, null::int, 'year'::text, '06-30'::text, date '2026-07-01'),
      ('ps_year_default_dec', 'pstart', null::jsonb, '2026-12-31'::date, null::date, null::int, 'year'::text, ''::text, date '2026-01-01'),
      ('ps_year_slash_sep', 'pstart', null::jsonb, '2026-02-14'::date, null::date, null::int, 'year'::text, '9/30'::text, date '2025-10-01'),
      ('ps_year_garbage', 'pstart', null::jsonb, '2026-02-14'::date, null::date, null::int, 'year'::text, 'garbage'::text, date '2026-01-01'),
      ('ps_year_jan_fye', 'pstart', null::jsonb, '2026-01-15'::date, null::date, null::int, 'year'::text, '01-31'::text, date '2025-02-01'),
      ('ps_month', 'pstart', null::jsonb, '2026-02-28'::date, null::date, null::int, 'month'::text, null::text, date '2026-02-01')
  ),
  r as (
    select f.id, f.expected,
           case f.fn
             when 'resolve' then public.tk_resolve_due(f.rule, f.a, f.b)
             when 'add_bd' then public.tk_add_business_days(f.a, f.n)
             when 'bdom' then public.tk_business_day_of_month(f.a, f.n)
             when 'roll' then public.tk_roll(f.a, f.t1)
             when 'pstart' then public.tk_period_start_for(f.t1, f.a, f.t2)
           end as got
      from f
  )
  select r.id, r.expected, r.got from r where r.got is distinct from r.expected order by r.id;
end;
$$;

-- 4. Schema probe -------------------------------------------------------
create or replace function public.tk_schema_version()
returns integer
language sql immutable
set search_path = public
as $$ select 2; $$;

-- 5. Grants ---------------------------------------------------------------
revoke all on function public.tk_is_business_day(date) from public, anon, authenticated;
revoke all on function public.tk_add_business_days(date, int) from public, anon, authenticated;
revoke all on function public.tk_business_day_of_month(date, int) from public, anon, authenticated;
revoke all on function public.tk_roll(date, text) from public, anon, authenticated;
revoke all on function public.tk__rule_int(jsonb, text, int, int, boolean) from public, anon, authenticated;
revoke all on function public.tk_due_rule_valid(jsonb) from public, anon, authenticated;
revoke all on function public.tk_resolve_due(jsonb, date, date) from public, anon, authenticated;
revoke all on function public.tk_period_start_for(text, date, text) from public, anon, authenticated;
revoke all on function public.tk_recurrence_selftest() from public, anon, authenticated;
revoke all on function public.tk_schema_version() from public, anon;
grant execute on function public.tk_is_business_day(date) to authenticated;
grant execute on function public.tk_add_business_days(date, int) to authenticated;
grant execute on function public.tk_business_day_of_month(date, int) to authenticated;
grant execute on function public.tk_roll(date, text) to authenticated;
grant execute on function public.tk__rule_int(jsonb, text, int, int, boolean) to authenticated;
grant execute on function public.tk_due_rule_valid(jsonb) to authenticated;
grant execute on function public.tk_resolve_due(jsonb, date, date) to authenticated;
grant execute on function public.tk_period_start_for(text, date, text) to authenticated;
grant execute on function public.tk_recurrence_selftest() to authenticated;
grant execute on function public.tk_schema_version() to authenticated;
