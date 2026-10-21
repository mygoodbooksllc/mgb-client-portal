-- =====================================================================
-- Slate month rhythm, slice 1b: label rule parity (2026-10-21, review fix)
-- Applied to production 2026-10-21 (migration slate_rhythm_1b_label_parity);
-- self-test supabase/slate-rhythm-1-settings-tests.sql passed the same day.
-- Run AFTER supabase/slate-rhythm-1-settings.sql (re-running that file puts
-- the old label rule back; run this one again afterwards).
--
-- Why: the label check in tk_month_rhythm_problem used the regex class \s
-- and char_length, while TK_rhythmProblem (components/tasks/TK_rhythmLogic.js)
-- used String.trim() and UTF-16 length. They disagreed on a few labels
-- (U+FEFF, U+0085, and labels with emoji: 21 emoji passed in SQL, failed in
-- JS). Both now use the same explicit blank set and count code points. Only
-- the label check changes; every other rule, and the order of checks, is as
-- in slate-rhythm-1-settings.sql. Shared vectors r28-r33 in
-- TK_rhythm.fixtures.js cover it.
--
-- Also: the trigger function tk_settings_check_month_rhythm loses the default
-- PUBLIC execute grant, like the other tk_settings trigger functions (a
-- trigger function can't be called directly anyway; this is tidiness).
--
-- Re-runnable. Rollback: re-run the tk_month_rhythm_problem block of
-- supabase/slate-rhythm-1-settings.sql.
-- =====================================================================

create or replace function public.tk_month_rhythm_problem(p jsonb)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_keys text[] := array['check_in', 'reports', 'follow_up'];
  -- Blank characters (same set as TK_RHYTHM_BLANK_RE in TK_rhythmLogic.js):
  -- tab, LF, VT, FF, CR, space, U+0085, U+00A0, U+1680, U+2000-U+200B,
  -- U+2028, U+2029, U+202F, U+205F, U+3000, U+FEFF.
  v_blank text := '^[' || E'\t\n\x0b\f\r ' || U&'\0085\00A0\1680\2000-\200B\2028\2029\202F\205F\3000\FEFF' || ']*$';
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
      if v_label ~ v_blank or char_length(v_label) > 40 then
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

revoke all on function public.tk_month_rhythm_problem(jsonb) from public, anon;
grant execute on function public.tk_month_rhythm_problem(jsonb) to authenticated;

revoke all on function public.tk_settings_check_month_rhythm() from public, anon, authenticated;

notify pgrst, 'reload schema';
