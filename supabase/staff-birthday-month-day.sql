-- staff-birthday-month-day.sql
--
-- Owner request 2026-10-27: stop asking staff for their birth year. Birthdays
-- are month and day only.
--
-- staff_profiles.birthday stays a `date` (no schema change). The app now saves
-- a placeholder year, 1904 (a leap year, so 29 Feb works), when it writes a
-- birthday; that year is not anyone's birth year. A year already stored from
-- before is left alone. Nothing shows or computes an age or year: the
-- celebrations, Today and the digest all use month + day (cel_next_occurrence
-- and birthday_md).
--
-- This file: staff_celebrations() no longer returns the stored date to admins
-- (its `birthday` column is now always null; the column stays so callers keep
-- working). Edited in place from the live definition; fails loudly if the live
-- text is not what we expect. Safe to re-run.
--
-- Applied to production 2026-10-27.
do $$
declare
  v_def text := pg_get_functiondef('public.staff_celebrations()'::regprocedure);
  v_new text;
begin
  if position('null::date,' in v_def) > 0 and position('case when me.adm then b.birthday end,' in v_def) = 0 then
    return; -- already applied
  end if;
  if position('case when me.adm then b.birthday end,' in v_def) = 0 then
    raise exception 'staff_celebrations(): live definition changed, review before patching';
  end if;
  v_new := replace(v_def, 'case when me.adm then b.birthday end,', 'null::date, -- stored year is never returned (month + day only)');
  execute v_new;
end;
$$;
