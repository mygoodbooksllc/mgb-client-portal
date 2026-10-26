-- =====================================================================
-- Slate Repeat menu: an Asana-style custom repeat for one task and for a
-- "Custom schedule" template.
-- Browser/node twin: components/tasks/TK_repeatLogic.js (same dates for every
-- case in components/tasks/TK_repeat.fixtures.js; supabase/repeat-menu-tests.sql
-- runs them here).
--
-- Safe to re-run, one transaction (apply_migration or begin/commit). Nothing
-- is dropped except two CHECKs that are re-created wider. Lines this file adds
-- to live function bodies carry "-- repeat menu". It never reads or writes
-- tk_settings (month_rhythm_enabled stays exactly as the owner left it), and
-- every existing recurring template and task keeps its old path: the weekly /
-- monthly / quarterly / annual generator code is not touched, 'custom' is
-- additive.
--
-- What changes:
--   1. staff_reminders.recurrence_rule (jsonb) and recurrence 'custom';
--      task_templates.repeat_rule (jsonb) and cadence 'custom'.
--   2. Pure date functions: tk_repeat_valid, tk__repeat_raw_next,
--      tk_repeat_next, tk_repeat_series, tk_repeat_due_at, tk_repeat_more,
--      tk_repeat_advance.
--   3. complete_staff_item: a 'custom' task rolls to its next date (skip
--      weekends / firm holidays, end date, end after N, time of day).
--   4. A custom template makes one task per date: tk__generate_custom, called
--      from tk__generate (one block + continue), period kind 'occ'.
--   5. tk_save_template saves and checks repeat_rule; the tk_tasks view
--      exposes recurrence_rule.
-- =====================================================================

-- 0. Helper: patch a live function body in place (same as S2/S3/S4) ------
create or replace function pg_temp.patch_fn(p_sig text, p_from text, p_to text, p_expected int)
returns void
language plpgsql
as $f$
declare
  d text;
  n int;
begin
  d := pg_get_functiondef(p_sig::regprocedure);
  if position(p_to in d) > 0 then
    return;  -- already patched
  end if;
  n := (length(d) - length(replace(d, p_from, ''))) / length(p_from);
  if n <> p_expected then
    raise exception 'patch_fn %: expected % occurrence(s) of anchor %, found %', p_sig, p_expected, p_from, n;
  end if;
  execute replace(d, p_from, p_to);
end
$f$;

-- Same, for edits that only make sense together (an opened else needs its end if).
create or replace function pg_temp.patch_fn_all(p_sig text, p_from text[], p_to text[], p_expected int)
returns void
language plpgsql
as $f$
declare
  d text;
  n int;
  i int;
begin
  d := pg_get_functiondef(p_sig::regprocedure);
  if position(p_to[array_length(p_to, 1)] in d) > 0 then
    return;  -- already patched
  end if;
  for i in 1 .. array_length(p_from, 1) loop
    n := (length(d) - length(replace(d, p_from[i], ''))) / length(p_from[i]);
    if n <> p_expected then
      raise exception 'patch_fn_all %: expected % occurrence(s) of anchor %, found %', p_sig, p_expected, p_from[i], n;
    end if;
    d := replace(d, p_from[i], p_to[i]);
  end loop;
  execute d;
end
$f$;

-- 1. Columns ---------------------------------------------------------------
alter table public.staff_reminders add column if not exists recurrence_rule jsonb;
alter table public.task_templates add column if not exists repeat_rule jsonb;

-- 2. Pure date functions ----------------------------------------------------

-- A key's value, with JSON null read as absent.
create or replace function public.tk__rj(p jsonb, k text)
returns jsonb language sql immutable set search_path = public as $$
  select nullif(p -> k, 'null'::jsonb)
$$;

-- Is this JSON value a whole number in [lo, hi]?
create or replace function public.tk__rj_int(p jsonb, lo int, hi int)
returns boolean language sql immutable set search_path = public as $$
  select p is not null and jsonb_typeof(p) = 'number'
     and (p #>> '{}')::numeric = floor((p #>> '{}')::numeric)
     and (p #>> '{}')::numeric between lo and hi
$$;

-- A 'YYYY-MM-DD' JSON string as a date; null when it is not a real date.
create or replace function public.tk__rj_date(p jsonb)
returns date language plpgsql immutable set search_path = public as $$
declare
  d date;
begin
  if p is null or jsonb_typeof(p) <> 'string' or (p #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$' then
    return null;
  end if;
  d := (p #>> '{}')::date;
  if to_char(d, 'YYYY-MM-DD') <> (p #>> '{}') then
    return null;
  end if;
  return d;
exception when others then
  return null;
end $$;

-- The rule shape (see TK_repeatLogic.js for the schema).
create or replace function public.tk_repeat_valid(p jsonb)
returns boolean language plpgsql immutable set search_path = public as $$
declare
  v jsonb;
  x jsonb;
  e jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return false; end if;
  v := public.tk__rj(p, 'freq');
  if v is null or jsonb_typeof(v) <> 'string' or (v #>> '{}') not in ('daily', 'weekly', 'monthly', 'yearly') then return false; end if;
  v := public.tk__rj(p, 'interval');
  if v is not null and not public.tk__rj_int(v, 1, 99) then return false; end if;
  v := public.tk__rj(p, 'dows');
  if v is not null then
    if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) > 7 then return false; end if;
    for x in select * from jsonb_array_elements(v) loop
      if not public.tk__rj_int(x, 1, 7) then return false; end if;
    end loop;
  end if;
  v := public.tk__rj(p, 'by');
  if v is not null and (jsonb_typeof(v) <> 'string' or (v #>> '{}') not in ('dom', 'nth', 'last')) then return false; end if;
  v := public.tk__rj(p, 'day');
  if v is not null and not public.tk__rj_int(v, 1, 31) then return false; end if;
  if (p ->> 'by') = 'nth' then
    v := public.tk__rj(p, 'n');
    if not (public.tk__rj_int(v, 1, 4) or public.tk__rj_int(v, -1, -1)) then return false; end if;
    if not public.tk__rj_int(public.tk__rj(p, 'dow'), 1, 7) then return false; end if;
  end if;
  v := public.tk__rj(p, 'skip');
  if v is not null and jsonb_typeof(v) <> 'boolean' then return false; end if;
  v := public.tk__rj(p, 'time');
  if v is not null and (jsonb_typeof(v) <> 'string' or (v #>> '{}') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') then return false; end if;
  v := public.tk__rj(p, 'tz');
  if v is not null and (jsonb_typeof(v) <> 'string' or length(v #>> '{}') > 64 or (v #>> '{}') !~ '^[A-Za-z0-9_+/-]+$') then return false; end if;
  v := public.tk__rj(p, 'start');
  if v is not null and public.tk__rj_date(v) is null then return false; end if;
  v := public.tk__rj(p, 'seen');
  if v is not null and not public.tk__rj_int(v, 1, 100000) then return false; end if;
  e := public.tk__rj(p, 'end');
  if e is not null then
    if jsonb_typeof(e) <> 'object' then return false; end if;
    if (e ->> 'type') = 'never' then return true; end if;
    if (e ->> 'type') = 'on' then return public.tk__rj_date(e -> 'date') is not null; end if;
    if (e ->> 'type') = 'count' then return public.tk__rj_int(e -> 'n', 1, 999); end if;
    return false;
  end if;
  return true;
end $$;

-- First pattern date strictly after p_after, counting from p_anchor (the phase
-- of "every N" and the default day / weekday / month). No weekend skipping.
create or replace function public.tk__repeat_raw_next(p jsonb, p_anchor date, p_after date)
returns date language plpgsql immutable set search_path = public as $$
declare
  n int := coalesce((p ->> 'interval')::int, 1);
  v_freq text := p ->> 'freq';
  v_by text := coalesce(p ->> 'by', 'dom');
  k int;
  dows int[];
  week0 date;
  w int;
  tries int;
  dw int;
  d date;
  step int;
  a_idx int;
  idx int;
  y int;
  mo int;
  dim int;
  v_day int;
  v_first date;
  v_off int;
  cand date;
  a_day int := extract(day from p_anchor)::int;
  t int;
begin
  if v_freq = 'daily' then
    if p_after < p_anchor then return p_anchor; end if;
    k := (p_after - p_anchor) / n + 1;
    return p_anchor + k * n;
  end if;

  if v_freq = 'weekly' then
    select array_agg(x::int order by x::int) into dows from jsonb_array_elements_text(coalesce(public.tk__rj(p, 'dows'), '[]'::jsonb)) x;
    if dows is null or cardinality(dows) = 0 then
      dows := array[extract(isodow from p_anchor)::int];
    end if;
    week0 := p_anchor - (extract(isodow from p_anchor)::int - 1);
    w := greatest(0, ((p_after - (extract(isodow from p_after)::int - 1)) - week0) / 7);
    w := w - (w % n);
    for tries in 0..599 loop
      foreach dw in array dows loop
        d := week0 + w * 7 + dw - 1;
        if d > p_after then return d; end if;
      end loop;
      w := w + n;
    end loop;
    return null;
  end if;

  -- monthly / yearly
  step := case when v_freq = 'yearly' then 12 * n else n end;
  a_idx := extract(year from p_anchor)::int * 12 + extract(month from p_anchor)::int - 1;
  k := greatest(0, ((extract(year from p_after)::int * 12 + extract(month from p_after)::int - 1 - a_idx) / step) - 1);
  for t in 0..599 loop
    idx := a_idx + k * step;
    y := idx / 12;
    mo := (idx % 12) + 1;
    v_first := make_date(y, mo, 1);
    dim := extract(day from (v_first + interval '1 month' - interval '1 day'))::int;
    if v_by = 'last' then
      v_day := dim;
    elsif v_by = 'nth' then
      v_off := ((p ->> 'dow')::int - extract(isodow from v_first)::int + 7) % 7;
      if (p ->> 'n')::int = -1 then
        v_day := 1 + v_off;
        while v_day + 7 <= dim loop v_day := v_day + 7; end loop;
      else
        v_day := 1 + v_off + 7 * ((p ->> 'n')::int - 1);
        if v_day > dim then v_day := v_day - 7; end if;
      end if;
    else
      v_day := least(coalesce((p ->> 'day')::int, a_day), dim);
    end if;
    cand := make_date(y, mo, v_day);
    if cand > p_after then return cand; end if;
    k := k + 1;
  end loop;
  return null;
end $$;

-- Is this date past the rule's "on a date" end?
create or replace function public.tk__repeat_past_end(p jsonb, p_day date)
returns boolean language sql immutable set search_path = public as $$
  select coalesce((p -> 'end' ->> 'type') = 'on' and p_day > public.tk__rj_date(p -> 'end' -> 'date'), false)
$$;

-- The next date after a finished task (p_base is its due date) that is on or
-- after p_today, or null when the series has ended. "After N times" is the
-- caller's: see tk_repeat_more.
create or replace function public.tk_repeat_next(p jsonb, p_base date, p_today date)
returns date language plpgsql stable set search_path = public as $$
declare
  v_floor date := coalesce(p_today, p_base);
  v_raw date := p_base;
  d date;
  i int;
begin
  if not public.tk_repeat_valid(p) or p_base is null then return null; end if;
  for i in 1..600 loop
    v_raw := public.tk__repeat_raw_next(p, p_base, v_raw);
    if v_raw is null then return null; end if;
    d := case when coalesce((p ->> 'skip')::boolean, false) then public.tk_roll(v_raw, 'next') else v_raw end;
    if d > p_base and d >= v_floor then
      if public.tk__repeat_past_end(p, d) then return null; end if;
      return d;
    end if;
    if public.tk__repeat_past_end(p, v_raw) then return null; end if;
  end loop;
  return null;
end $$;

-- Dates from the rule's start (or p_start) up to and including p_to, oldest
-- first. p_from hides earlier dates but still counts them toward an "after N
-- times" end. At most p_max dates.
create or replace function public.tk_repeat_series(p jsonb, p_start date, p_to date, p_from date default null, p_max int default 1000)
returns date[] language plpgsql stable set search_path = public as $$
declare
  v_out date[] := '{}';
  v_anchor date := coalesce(public.tk__rj_date(public.tk__rj(p, 'start')), p_start);
  v_cap_count int := case when (p -> 'end' ->> 'type') = 'count' then (p -> 'end' ->> 'n')::int end;
  v_raw date;
  v_last date;
  v_seen int := 0;
  d date;
  i int;
begin
  if not public.tk_repeat_valid(p) or v_anchor is null or p_to is null then return v_out; end if;
  v_raw := public.tk__repeat_raw_next(p, v_anchor, v_anchor - 1);
  for i in 0..2399 loop
    exit when v_raw is null or cardinality(v_out) >= coalesce(p_max, 1000) or (v_cap_count is not null and v_seen >= v_cap_count);
    d := case when coalesce((p ->> 'skip')::boolean, false) then public.tk_roll(v_raw, 'next') else v_raw end;
    exit when public.tk__repeat_past_end(p, d) or d > p_to;
    if v_last is null or d > v_last then
      v_seen := v_seen + 1;
      v_last := d;
      if p_from is null or d >= p_from then
        v_out := v_out || d;
      end if;
    end if;
    v_raw := public.tk__repeat_raw_next(p, v_anchor, v_raw);
  end loop;
  return v_out;
end $$;

-- 'YYYY-MM-DD' + 'HH:MM' wall clock in a zone -> instant (DST-proof: Postgres
-- uses the offset from before a spring-forward gap).
create or replace function public.tk_repeat_due_at(p_day date, p_time text, p_tz text)
returns timestamptz language plpgsql stable set search_path = public as $$
begin
  return (p_day + p_time::time)::timestamp at time zone coalesce(nullif(p_tz, ''), 'America/Chicago');
exception when others then
  return (p_day + p_time::time)::timestamp at time zone 'America/Chicago';
end $$;

-- "After N times": made so far (seen, 1 when absent) is still under the cap.
create or replace function public.tk_repeat_more(p jsonb)
returns boolean language sql immutable set search_path = public as $$
  select case when (p -> 'end' ->> 'type') = 'count'
              then coalesce((p ->> 'seen')::int, 1) < (p -> 'end' ->> 'n')::int
              else true end
$$;

-- The rule for the task that follows: same rule, seen + 1.
create or replace function public.tk_repeat_advance(p jsonb)
returns jsonb language sql immutable set search_path = public as $$
  select jsonb_set(p, '{seen}', to_jsonb(coalesce((p ->> 'seen')::int, 1) + 1))
$$;

revoke all on function public.tk__rj(jsonb, text) from public, anon;
revoke all on function public.tk__rj_int(jsonb, int, int) from public, anon;
revoke all on function public.tk__rj_date(jsonb) from public, anon;
revoke all on function public.tk_repeat_valid(jsonb) from public, anon;
revoke all on function public.tk__repeat_raw_next(jsonb, date, date) from public, anon;
revoke all on function public.tk__repeat_past_end(jsonb, date) from public, anon;
revoke all on function public.tk_repeat_next(jsonb, date, date) from public, anon;
revoke all on function public.tk_repeat_series(jsonb, date, date, date, int) from public, anon;
revoke all on function public.tk_repeat_due_at(date, text, text) from public, anon;
revoke all on function public.tk_repeat_more(jsonb) from public, anon;
revoke all on function public.tk_repeat_advance(jsonb) from public, anon;
grant execute on function public.tk__rj(jsonb, text) to authenticated;
grant execute on function public.tk__rj_int(jsonb, int, int) to authenticated;
grant execute on function public.tk__rj_date(jsonb) to authenticated;
grant execute on function public.tk_repeat_valid(jsonb) to authenticated;
grant execute on function public.tk__repeat_raw_next(jsonb, date, date) to authenticated;
grant execute on function public.tk__repeat_past_end(jsonb, date) to authenticated;
grant execute on function public.tk_repeat_next(jsonb, date, date) to authenticated;
grant execute on function public.tk_repeat_series(jsonb, date, date, date, int) to authenticated;
grant execute on function public.tk_repeat_due_at(date, text, text) to authenticated;
grant execute on function public.tk_repeat_more(jsonb) to authenticated;
grant execute on function public.tk_repeat_advance(jsonb) to authenticated;

-- 3. CHECKs -----------------------------------------------------------------
alter table public.staff_reminders drop constraint if exists staff_reminders_recurrence_check;
alter table public.staff_reminders add constraint staff_reminders_recurrence_check
  check (recurrence = any (array['none', 'daily', 'weekly', 'monthly', 'month_end', 'custom']));
alter table public.staff_reminders drop constraint if exists staff_reminders_recurrence_rule_chk;
alter table public.staff_reminders add constraint staff_reminders_recurrence_rule_chk
  check (recurrence_rule is null or public.tk_repeat_valid(recurrence_rule)) not valid;
alter table public.staff_reminders drop constraint if exists staff_reminders_custom_has_rule_chk;
alter table public.staff_reminders add constraint staff_reminders_custom_has_rule_chk
  check (recurrence <> 'custom' or recurrence_rule is not null) not valid;
alter table public.staff_reminders validate constraint staff_reminders_recurrence_rule_chk;
alter table public.staff_reminders validate constraint staff_reminders_custom_has_rule_chk;

alter table public.task_templates drop constraint if exists task_templates_cadence;
alter table public.task_templates add constraint task_templates_cadence
  check (cadence = any (array['weekly', 'monthly', 'quarterly', 'annually', 'custom']));
alter table public.task_templates drop constraint if exists task_templates_repeat_rule_chk;
alter table public.task_templates add constraint task_templates_repeat_rule_chk
  check (repeat_rule is null or public.tk_repeat_valid(repeat_rule)) not valid;
alter table public.task_templates drop constraint if exists task_templates_custom_has_rule_chk;
alter table public.task_templates add constraint task_templates_custom_has_rule_chk
  check (cadence <> 'custom' or (repeat_rule is not null and repeat_rule ? 'start' and public.tk__rj_date(repeat_rule -> 'start') is not null)) not valid;
alter table public.task_templates validate constraint task_templates_repeat_rule_chk;
alter table public.task_templates validate constraint task_templates_custom_has_rule_chk;

-- 4. tk_tasks view: add recurrence_rule at the end ---------------------------
do $do$
declare
  d text := pg_get_viewdef('public.tk_tasks'::regclass);
begin
  if position('recurrence_rule' in d) = 0 then
    if position(E'    close_key\n   FROM staff_reminders' in d) = 0 then
      raise exception 'tk_tasks view: expected anchor not found (another change moved close_key)';
    end if;
    execute 'create or replace view public.tk_tasks with (security_invoker = true) as '
      || replace(rtrim(d, ';'), E'    close_key\n   FROM staff_reminders', E'    close_key,\n    recurrence_rule\n   FROM staff_reminders');
    grant select on public.tk_tasks to authenticated;
  end if;
end $do$;

-- 5. Period kind 'occ' (one date) -------------------------------------------
select pg_temp.patch_fn('public.tk__template_kind(text, text)',
  E'    when ''weekly'' then ''week''\n',
  E'    when ''weekly'' then ''week''\n    when ''custom'' then ''occ''   -- repeat menu\n', 1);
select pg_temp.patch_fn('public.tk__period_end(text, date)',
  E'    when ''week'' then p_start + 6\n',
  E'    when ''week'' then p_start + 6\n    when ''occ'' then p_start   -- repeat menu\n', 1);
select pg_temp.patch_fn('public.tk__period_label(text, date)',
  E'    when ''week'' then ''Wk of '' || to_char(p_start, ''Mon FMDD'')\n',
  E'    when ''week'' then ''Wk of '' || to_char(p_start, ''Mon FMDD'')\n    when ''occ'' then to_char(p_start, ''Mon FMDD, YYYY'')   -- repeat menu\n', 1);

-- 6. complete_staff_item: roll a 'custom' task ------------------------------
select pg_temp.patch_fn_all('public.complete_staff_item(uuid, boolean, date)',
  array[
    E'  i int := 0;\n',
    E'  v_base := coalesce(v_row.due_date, v_today);\n  v_next := v_base;\n  loop\n',
    E'    exit when i >= 400;\n  end loop;\n',
    E'  if v_row.due_at is null then\n    v_due_at := v_next::timestamp at time zone ''UTC'';\n',
    E'    kind, recurrence, assignee_email, created_by, visibility, source, source_ref,\n',
    E'    v_row.client_id, v_row.priority, v_row.kind, v_row.recurrence,\n'],
  array[
    E'  i int := 0;\n  v_rule jsonb;   -- repeat menu\n  v_new_rule jsonb;   -- repeat menu\n',
    E'  v_base := coalesce(v_row.due_date, v_today);\n  v_next := v_base;\n  if v_row.recurrence = ''custom'' then   -- repeat menu: a custom rule picks its own next date\n    v_rule := v_row.recurrence_rule;\n    if v_rule is null or not public.tk_repeat_valid(v_rule) or not public.tk_repeat_more(v_rule) then\n      return null;\n    end if;\n    v_next := public.tk_repeat_next(v_rule, v_base, v_today);\n    if v_next is null then\n      return null;\n    end if;\n    v_new_rule := public.tk_repeat_advance(v_rule);\n  else\n  loop\n',
    E'    exit when i >= 400;\n  end loop;\n  end if;   -- repeat menu\n',
    E'  if v_row.recurrence = ''custom'' and (v_rule ->> ''time'') is not null then   -- repeat menu: time of day\n    v_due_at := public.tk_repeat_due_at(v_next, v_rule ->> ''time'', v_rule ->> ''tz'');\n  elsif v_row.due_at is null then\n    v_due_at := v_next::timestamp at time zone ''UTC'';\n',
    E'    kind, recurrence, recurrence_rule, assignee_email, created_by, visibility, source, source_ref,   -- repeat menu\n',
    E'    v_row.client_id, v_row.priority, v_row.kind, v_row.recurrence, v_new_rule,   -- repeat menu\n'], 1);

-- 7. A custom template: one task per date ------------------------------------
create or replace function public.tk__generate_custom(
  t public.task_templates, p_eff jsonb, p_client text, p_act date, p_today date,
  p_horizon int, p_dry boolean, p_miss_floor date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rule jsonb := t.repeat_rule;
  v_dates date[];
  d date;
  v_label text;
  r jsonb;
  v_created int := 0;
  v_by jsonb := '{}'::jsonb;
  v_would jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_missed jsonb := '[]'::jsonb;
  v_upcoming jsonb := '[]'::jsonb;
begin
  if v_rule is not null and public.tk_repeat_valid(v_rule) and public.tk__rj_date(v_rule -> 'start') is not null then
    v_dates := public.tk_repeat_series(v_rule, null, p_today + greatest(t.lead_days, p_horizon),
                                       greatest(p_act, p_today - 365), 1000);
    foreach d in array v_dates loop
      v_label := public.tk__period_label('occ', d);
      if d < p_today - 7 then
        -- past the 7-day grace -> listed, never created (same as the other cadences)
        if (p_miss_floor is null or d >= p_miss_floor)
           and not exists (select 1 from task_template_issued i
                            where i.template_id = t.id and i.client_id = p_client and i.period = d)
           and not exists (select 1 from tk_generate_missed m
                            where m.template_id = t.id and m.client_id = p_client and m.period_start = d
                              and (m.dismissed_at is not null or m.issued_at is not null)) then
          if jsonb_array_length(v_missed) < 100 then
            v_missed := v_missed || jsonb_build_object('template', t.id, 'title', p_eff ->> 'title', 'client', p_client,
                                                       'period', d, 'label', v_label, 'due', d);
          end if;
          if not p_dry then
            insert into tk_generate_missed (template_id, client_id, period_start, due_date, label)
            values (t.id, p_client, d, d, v_label)
            on conflict do nothing;
          end if;
        end if;
      elsif d - t.lead_days <= p_today then
        r := public.tk__issue_period(t, p_eff, p_client, d, p_dry);
        if r ->> 'status' = 'created' then
          v_created := v_created + 1;
          v_by := jsonb_set(v_by, array[r ->> 'assignee'], to_jsonb(coalesce((v_by ->> (r ->> 'assignee'))::int, 0) + 1));
        elsif r ->> 'status' = 'would_create' then
          if jsonb_array_length(v_would) < 100 then
            v_would := v_would || (r || jsonb_build_object('template', t.id, 'title', p_eff ->> 'title', 'client', p_client, 'period', d));
          end if;
        elsif r ->> 'status' = 'skipped' then
          if jsonb_array_length(v_skipped) < 100 then
            v_skipped := v_skipped || jsonb_build_object('template', t.id, 'title', p_eff ->> 'title', 'client', p_client,
                                                         'period', d, 'label', r ->> 'label', 'reason', r ->> 'reason',
                                                         'detail', r ->> 'detail');
          end if;
        end if;
      elsif p_dry and p_horizon > 0 and d - t.lead_days <= p_today + p_horizon then
        if not exists (select 1 from task_template_issued i
                        where i.template_id = t.id and i.client_id = p_client and i.period = d)
           and jsonb_array_length(v_upcoming) < 100 then
          v_upcoming := v_upcoming || jsonb_build_object('template', t.id, 'title', p_eff ->> 'title', 'client', p_client,
                                                         'period', d, 'label', v_label, 'due', d, 'start_on', d - t.lead_days);
        end if;
      end if;
    end loop;
  end if;
  return jsonb_build_object('created', v_created, 'by', v_by, 'would', v_would, 'skipped', v_skipped,
                            'missed', v_missed, 'upcoming', v_upcoming);
end $$;
revoke all on function public.tk__generate_custom(public.task_templates, jsonb, text, date, date, int, boolean, date) from public, anon, authenticated;

select pg_temp.patch_fn('public.tk__generate(date, boolean, text, integer, text, uuid)',
  E'      v_kind := v_eff ->> ''kind'';\n',
  E'      v_kind := v_eff ->> ''kind'';\n      if v_kind = ''occ'' then   -- repeat menu: a custom schedule makes one task per date\n        v_r := public.tk__generate_custom(t, v_eff, c.id, v_act_c, v_today, v_horizon, v_dry, v_miss_floor);\n        v_created := v_created + (v_r ->> ''created'')::int;\n        v_by := v_by || coalesce((select jsonb_object_agg(e.key, coalesce((v_by ->> e.key)::int, 0) + e.value::int)\n                                    from jsonb_each_text(v_r -> ''by'') e), ''{}''::jsonb);\n        v_would := v_would || (v_r -> ''would'');\n        v_skipped := v_skipped || (v_r -> ''skipped'');\n        v_missed := v_missed || (v_r -> ''missed'');\n        v_upcoming := v_upcoming || (v_r -> ''upcoming'');\n        continue;\n      end if;\n', 1);

-- 8. tk_save_template: save and check repeat_rule ------------------------------
select pg_temp.patch_fn('public.tk_save_template(uuid, jsonb)',
  E'  v_old task_templates%rowtype;   -- review fix (major 2)\n',
  E'  v_old task_templates%rowtype;   -- review fix (major 2)\n  v_cad text;   -- repeat menu\n  v_rrule jsonb;   -- repeat menu\n', 1);
select pg_temp.patch_fn('public.tk_save_template(uuid, jsonb)',
  E'    raise exception ''tk_bad_due_rule'' using errcode = ''22023'';\n  end if;\n',
  E'    raise exception ''tk_bad_due_rule'' using errcode = ''22023'';\n  end if;\n  v_cad := coalesce(p_tpl ->> ''cadence'', (select x.cadence from task_templates x where x.id = p_id), ''monthly'');   -- repeat menu\n  v_rrule := null;\n  if v_cad = ''custom'' then\n    v_rrule := case when p_tpl ? ''repeat_rule'' then (case when jsonb_typeof(p_tpl -> ''repeat_rule'') = ''object'' then p_tpl -> ''repeat_rule'' end)\n                    else (select x.repeat_rule from task_templates x where x.id = p_id) end;\n    if v_rrule is null or not public.tk_repeat_valid(v_rrule) or public.tk__rj_date(v_rrule -> ''start'') is null then\n      raise exception ''tk_bad_repeat_rule'' using errcode = ''22023'';\n    end if;\n  end if;\n', 1);
select pg_temp.patch_fn('public.tk_save_template(uuid, jsonb)',
  E'status, active, created_by, updated_by, source, description)   -- slate rhythm s3\n',
  E'status, active, created_by, updated_by, source, description, repeat_rule)   -- slate rhythm s3, repeat menu\n', 1);
select pg_temp.patch_fn('public.tk_save_template(uuid, jsonb)',
  E'2000))   -- slate rhythm s3\n    returning id into v_id;',
  E'2000), v_rrule)   -- slate rhythm s3, repeat menu\n    returning id into v_id;', 1);
select pg_temp.patch_fn('public.tk_save_template(uuid, jsonb)',
  E'      updated_by = v_me\n     where id = v_id;',
  E'      repeat_rule = v_rrule,   -- repeat menu\n      updated_by = v_me\n     where id = v_id;', 1);
select pg_temp.patch_fn('public.tk_save_template(uuid, jsonb)',
  E'  return v_id;\nend $function$',
  E'  if v_cad = \'custom\' then   -- repeat menu: a custom schedule is due on its own date\n    update task_templates set due_rule = jsonb_build_object(\'type\', \'offset\', \'days\', 0) where id = v_id;\n  end if;\n  return v_id;\nend $function$', 1);
