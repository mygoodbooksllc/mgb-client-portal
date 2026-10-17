-- =====================================================================
-- Tasks grace period: late tasks do not count against staff (2026-10-17)
--
-- Owner rule: until the full Slate (Tasks) rollout, probably next quarter,
-- late or overdue tasks must not hurt a bookkeeper's scores or reports.
-- This is a grace period, not a removal: one owner-only switch turns the
-- counting on later.
--
--   tk_settings 'late_tasks_count_against_staff'  true/false, default FALSE
--   tk_settings 'late_tasks_effective_from'       'YYYY-MM-DD', set when the
--                                                  switch is turned on
--
-- When the switch is OFF (the default):
--   * staff_performance: tasks are left out of the Tasks-and-deadlines
--     input. That input becomes filing deadlines on time (deadlines are NOT
--     tasks and keep counting). With no filings the input is null and the
--     other inputs are re-weighted, exactly as for any missing input.
--     tasks_done / tasks_overdue return 0.
--   * client_health: factor "overdue tasks" is 0.
--   * digest_weekly_data: scorecard tasks_overdue is 0 and late_counts_on
--     is false, so the weekly email drops the overdue figure.
--   * tk_on_time_stats: returns no rows.
-- When ON: only tasks whose due date is on or after the effective-from date
-- can count as overdue, so the imported backlog never punishes anyone
-- retroactively. Done tasks keep counting as before.
--
-- Only the owner can change either key (tk_set_late_tasks_count). Every
-- change is written to tk_settings_audit by the existing trigger.
-- Re-runnable. Patches the live function bodies in place (see README).
-- =====================================================================

-- 1. Owner-only keys ---------------------------------------------------
create or replace function public.tk__owner_only_key(p_key text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_key in ('client_request_enabled', 'client_request_pilot', 'standard_set_live',
                   'late_tasks_count_against_staff', 'late_tasks_effective_from');
$$;

-- 2. Seed the switch OFF (the grace period is on) ------------------------
select set_config('mgb.tk_owner_override', 'on', true);
insert into public.tk_settings (key, value)
values ('late_tasks_count_against_staff', 'false'::jsonb)
on conflict (key) do nothing;
select set_config('mgb.tk_owner_override', '', true);

-- 3. The single read point -------------------------------------------------
-- Returns the date from which late tasks count, or NULL while the grace
-- period is on (switch off). Every penalizing computation reads this.
create or replace function public.tk_late_count_from()
returns date
language sql
stable
security definer
set search_path = public
as $$
  select case
    when coalesce((select (s.value #>> '{}') in ('true', 't', '1', 'on')
                     from public.tk_settings s where s.key = 'late_tasks_count_against_staff'), false)
    then coalesce(
           (select nullif(s.value #>> '{}', '')::date from public.tk_settings s where s.key = 'late_tasks_effective_from'),
           (select (s.updated_at at time zone 'America/Chicago')::date from public.tk_settings s where s.key = 'late_tasks_count_against_staff'))
  end;
$$;
revoke all on function public.tk_late_count_from() from public, anon;
grant execute on function public.tk_late_count_from() to authenticated;

-- 4. Owner-only switch: sets the effective-from date atomically ------------
create or replace function public.tk_set_late_tasks_count(p_on boolean)
returns date
language plpgsql
security definer
set search_path = public
as $$
declare
  v_was boolean;
begin
  if not public.is_internal_owner() then
    raise exception 'tk_owner_only' using errcode = '42501';
  end if;
  select coalesce((s.value #>> '{}') in ('true', 't', '1', 'on'), false) into v_was
    from public.tk_settings s where s.key = 'late_tasks_count_against_staff';
  v_was := coalesce(v_was, false);
  if p_on and not v_was then
    insert into public.tk_settings (key, value)
    values ('late_tasks_effective_from', to_jsonb(to_char(now() at time zone 'America/Chicago', 'YYYY-MM-DD')))
    on conflict (key) do update set value = excluded.value;
  end if;
  if not coalesce(p_on, false) then
    -- clear the old start date so a later flip by any other route cannot reuse it
    insert into public.tk_settings (key, value) values ('late_tasks_effective_from', to_jsonb(''::text))
    on conflict (key) do update set value = excluded.value;
  end if;
  insert into public.tk_settings (key, value)
  values ('late_tasks_count_against_staff', to_jsonb(coalesce(p_on, false)))
  on conflict (key) do update set value = excluded.value;
  return public.tk_late_count_from();
end $$;
revoke all on function public.tk_set_late_tasks_count(boolean) from public, anon;
grant execute on function public.tk_set_late_tasks_count(boolean) to authenticated;

-- 5. Patch the live functions in place ---------------------------------------
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

-- 5a. staff_performance: tasks are left out while the grace period is on.
select pg_temp.patch_fn('public.staff_performance(integer,jsonb)',
  '  v_late int := coalesce(',
  '  v_lf date := public.tk_late_count_from();   -- tk grace: null = late tasks do not count' || chr(10) || '  v_late int := coalesce(', 1);
select pg_temp.patch_fn('public.staff_performance(integer,jsonb)',
  'coalesce(r.done, false) and r.completed_at >= v_from',
  'v_lf is not null and coalesce(r.done, false) and r.completed_at >= v_from', 2);
select pg_temp.patch_fn('public.staff_performance(integer,jsonb)',
  'not coalesce(r.done, false) and r.due_date < current_date',
  'v_lf is not null and not coalesce(r.done, false) and r.due_date >= v_lf and r.due_date < current_date', 2);

-- 5b. client_health: the "overdue tasks" factor is 0 during the grace period.
select pg_temp.patch_fn('public.client_health(jsonb)',
  'r.due_date is not null and r.due_date < current_date',
  'r.due_date is not null and public.tk_late_count_from() is not null and r.due_date >= public.tk_late_count_from() and r.due_date < current_date', 1);

-- 5c. weekly digest scorecard: no overdue figure during the grace period.
select pg_temp.patch_fn('public.digest_weekly_data(date,date)',
  'and coalesce(t.due_date, (t.due_at at time zone ''America/New_York'')::date) < p_today',
  'and public.tk_late_count_from() is not null and coalesce(t.due_date, (t.due_at at time zone ''America/New_York'')::date) >= public.tk_late_count_from() and coalesce(t.due_date, (t.due_at at time zone ''America/New_York'')::date) < p_today', 1);
select pg_temp.patch_fn('public.digest_weekly_data(date,date)',
  ') as tasks_overdue   -- tk v1',
  ') as tasks_overdue,   -- tk v1' || chr(10) || '             (public.tk_late_count_from() is not null) as late_counts_on   -- tk grace', 1);

-- 5d. On-time stats: nothing while the grace period is on; afterwards only
--     tasks that came due on or after the effective-from date.
select pg_temp.patch_fn('public.tk_on_time_stats(date,date,text)',
  '  v_since := coalesce(v_since, ''-infinity''::timestamptz);',
  '  if public.tk_late_count_from() is null then return; end if;   -- tk grace' || chr(10) ||
  '  v_since := coalesce(v_since, ''-infinity''::timestamptz);', 1);
select pg_temp.patch_fn('public.tk_on_time_stats(date,date,text)',
  '     where r.due_date_original is not null' || chr(10),
  '     where r.due_date_original is not null' || chr(10) ||
  '       and r.due_date_original >= public.tk_late_count_from()   -- tk grace: only tasks due on or after the start date' || chr(10), 1);

notify pgrst, 'reload schema';
