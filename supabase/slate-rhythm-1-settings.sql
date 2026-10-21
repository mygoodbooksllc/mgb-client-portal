-- =====================================================================
-- Slate month rhythm, slice 1: the firm rhythm setting (2026-10-21)
-- Applied to production 2026-10-21 (migration slate_rhythm_1_settings);
-- self-test passed the same day.
-- The label rule in tk_month_rhythm_problem was tightened for JS parity by
-- supabase/slate-rhythm-1b-label-parity.sql (applied 2026-10-21); if you
-- re-run this file, run that one again afterwards.
-- Spec: docs/slate-rhythm-slice-1.md, docs/slate-month-rhythm.md
--
-- tk_settings key 'month_rhythm' (admin write through the existing RLS
-- policies; every change audited into tk_settings_audit by the existing
-- tk_settings_after_write trigger):
--   {"parts":[{"key":"check_in","label":"Check in","day":4},
--             {"key":"reports","label":"Send reports","day":14},
--             {"key":"follow_up","label":"Follow up","day":24}],
--    "roll":"next"}
-- No row is seeded: missing means that default.
--
-- Adds (all new, nothing existing changes except the owner-only key list):
--   tk_month_rhythm_default()      the default value
--   tk_month_rhythm_problem(jsonb) first problem code, or null when valid
--                                  (same rules and order as TK_rhythmProblem in
--                                  components/tasks/TK_rhythmLogic.js; shared
--                                  vectors in TK_rhythm.fixtures.js)
--   tk_month_rhythm()              stored value when valid, default when the
--                                  row is missing, NULL when invalid (fail closed)
--   trigger tk_settings_check_month_rhythm  refuses an invalid month_rhythm
--                                  write (tk_month_rhythm_invalid: <code>)
--   tk__owner_only_key             + 'month_rhythm_enabled' (the firm switch;
--                                  code never sets it; owner only)
--
-- Re-runnable. Rollback: drop trigger tk_settings_check_month_rhythm, drop the
-- four functions above, re-run supabase/owner-only-lato-switch.sql.
-- Self-test: supabase/slate-rhythm-1-settings-tests.sql (rolls back).
-- =====================================================================

-- 1. Default --------------------------------------------------------------
create or replace function public.tk_month_rhythm_default()
returns jsonb
language sql
immutable
set search_path = public
as $$
  select '{"parts":[{"key":"check_in","label":"Check in","day":4},{"key":"reports","label":"Send reports","day":14},{"key":"follow_up","label":"Follow up","day":24}],"roll":"next"}'::jsonb
$$;

-- 2. Validator (problem code or null) --------------------------------------
create or replace function public.tk_month_rhythm_problem(p jsonb)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_keys text[] := array['check_in', 'reports', 'follow_up'];
  v_part jsonb;
  v_day numeric;
  v_prev numeric := 0;
  v_label text;
  i int;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    return 'not_object';
  end if;
  if jsonb_typeof(p -> 'parts') is distinct from 'array' then
    return 'parts_missing';
  end if;
  if jsonb_array_length(p -> 'parts') <> 3 then
    return 'parts_count';
  end if;
  for i in 0..2 loop
    v_part := (p -> 'parts') -> i;
    if jsonb_typeof(v_part) <> 'object'
       or jsonb_typeof(v_part -> 'key') is distinct from 'string'
       or (v_part ->> 'key') <> v_keys[i + 1] then
      return 'part_key';
    end if;
    if jsonb_typeof(v_part -> 'day') is distinct from 'number' then
      return 'part_day';
    end if;
    v_day := (v_part ->> 'day')::numeric;
    if v_day <> trunc(v_day) or not (v_day between 1 and 28) then
      return 'part_day';
    end if;
    if v_day <= v_prev then
      return 'day_order';
    end if;
    v_prev := v_day;
    if v_part ? 'label' then
      if jsonb_typeof(v_part -> 'label') <> 'string' then
        return 'label';
      end if;
      v_label := v_part ->> 'label';
      if v_label ~ '^\s*$' or char_length(v_label) > 40 then
        return 'label';
      end if;
    end if;
  end loop;
  if jsonb_typeof(p -> 'roll') is distinct from 'string'
     or (p ->> 'roll') not in ('next', 'prev', 'none') then
    return 'roll';
  end if;
  return null;
end $$;

-- 3. Reader for later slices (security invoker: RLS on tk_settings applies) --
create or replace function public.tk_month_rhythm()
returns jsonb
language sql
stable
set search_path = public
as $$
  select case
    when s.key is null then public.tk_month_rhythm_default()
    when public.tk_month_rhythm_problem(s.value) is null then s.value
    else null
  end
  from (select 1) one
  left join public.tk_settings s on s.key = 'month_rhythm'
$$;

revoke all on function public.tk_month_rhythm_default() from public, anon;
revoke all on function public.tk_month_rhythm_problem(jsonb) from public, anon;
revoke all on function public.tk_month_rhythm() from public, anon;
grant execute on function public.tk_month_rhythm_default() to authenticated;
grant execute on function public.tk_month_rhythm_problem(jsonb) to authenticated;
grant execute on function public.tk_month_rhythm() to authenticated;

-- 4. Write guard: a separate trigger, the existing ones are untouched. On
--    UPDATE it reads old.key, because tk_settings_before_write pins the key
--    (new.key := old.key) and BEFORE triggers fire in name order.
create or replace function public.tk_settings_check_month_rhythm()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_key text := case when tg_op = 'UPDATE' then old.key else new.key end;
  v_problem text;
begin
  if v_key = 'month_rhythm' then
    v_problem := public.tk_month_rhythm_problem(new.value);
    if v_problem is not null then
      raise exception 'tk_month_rhythm_invalid: %', v_problem using errcode = '22023';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists tk_settings_check_month_rhythm on public.tk_settings;
create trigger tk_settings_check_month_rhythm before insert or update on public.tk_settings
  for each row execute function public.tk_settings_check_month_rhythm();

-- 5. Owner-only keys: + month_rhythm_enabled (keep every live key; the list
--    was last set by owner-only-lato-switch.sql).
create or replace function public.tk__owner_only_key(p_key text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_key in ('client_request_enabled', 'client_request_pilot', 'standard_set_live',
                   'late_tasks_count_against_staff', 'late_tasks_effective_from',
                   'wb_enabled', 'desk_app_enabled', 'nav_enabled', 'lato_enabled',
                   'month_rhythm_enabled');
$$;

notify pgrst, 'reload schema';
