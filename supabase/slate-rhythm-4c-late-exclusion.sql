-- =====================================================================
-- Slate month rhythm, slice 4c: waiting and preliminary-month tasks never
-- count as late (owner rule, NOT gated by the rhythm switch).
-- Applied to production 2026-10-21 (migration slate_rhythm_4c_late_exclusion). Self-test: slate-rhythm-4c-late-exclusion-tests.sql (all ok before and after apply). Grace simulated: overdue 176 -> 176, health red 33 -> 33, on-time eligible 0 -> 0.
-- Spec: docs/slate-rhythm-slice-4.md (f). Additive only.
-- Self-test: supabase/slate-rhythm-4c-late-exclusion-tests.sql (rolls back).
--
-- tk_late_excused(status, client_id, period_kind, period_start) is true when
--   the task is waiting on the client, or
--   the task has a month period and that client month is 'preliminary' in
--   tk_report_state.
-- Quarter, year and no-period tasks are only excused while waiting.
--
-- Anchor patches (each adds one "and not tk_late_excused(...)"):
--   staff_performance(integer,jsonb)   tk.overdue filter + where   (2)
--   client_health(jsonb)               overdue CTE                 (1)
--   digest_weekly_data(date,date)      tasks_overdue               (1)
--   tk_on_time_stats(date,date,text)   base CTE (leaves eligible)  (1)
-- JS mirror: TK_lateExcused / TK_taskMonth in components/tasks/TK_logic.js.
--
-- Rollback: reverse each replace below (the p_to text back to p_from), then
--   drop function public.tk_late_excused(text, text, text, date).
-- =====================================================================

create or replace function pg_temp.patch_fn(p_sig text, p_from text, p_to text, p_expected int)
returns void language plpgsql as $f$
declare d text; n int;
begin
  d := pg_get_functiondef(p_sig::regprocedure);
  if position(p_to in d) > 0 then return; end if;
  n := (length(d) - length(replace(d, p_from, ''))) / length(p_from);
  if n <> p_expected then raise exception 'patch_fn %: expected % occurrence(s) of anchor %, found %', p_sig, p_expected, p_from, n; end if;
  execute replace(d, p_from, p_to);
end $f$;

-- Security invoker and plain SQL so the planner can inline it. Every caller
-- is a SECURITY DEFINER function, so it reads tk_report_state as the owner.
create or replace function public.tk_late_excused(p_status text, p_client text, p_period_kind text, p_period_start date)
returns boolean
language sql
stable
set search_path to 'public'
as $$
  select coalesce(p_status, '') = 'waiting_client'
      or (p_client is not null and p_period_kind = 'month' and p_period_start is not null
          and exists (select 1 from public.tk_report_state s
                       where s.client_id = p_client
                         and s.period = date_trunc('month', p_period_start)::date
                         and s.state = 'preliminary'));
$$;
revoke all on function public.tk_late_excused(text, text, text, date) from public, anon;
grant execute on function public.tk_late_excused(text, text, text, date) to authenticated;

select pg_temp.patch_fn('public.staff_performance(integer,jsonb)',
  $a$r.status <> 'waiting_client'$a$,
  $b$r.status <> 'waiting_client' and not public.tk_late_excused(r.status, r.client_id, r.period_kind, r.period_start)$b$, 2);

select pg_temp.patch_fn('public.client_health(jsonb)',
  $a$and r.deleted_at is null and r.status <> 'waiting_client'   -- tk v1$a$,
  $b$and r.deleted_at is null and r.status <> 'waiting_client' and not public.tk_late_excused(r.status, r.client_id, r.period_kind, r.period_start)   -- tk v1$b$, 1);

select pg_temp.patch_fn('public.digest_weekly_data(date,date)',
  $a$and t.deleted_at is null and t.status <> 'waiting_client'$a$,
  $b$and t.deleted_at is null and t.status <> 'waiting_client' and not public.tk_late_excused(t.status, t.client_id, t.period_kind, t.period_start)$b$, 1);

select pg_temp.patch_fn('public.tk_on_time_stats(date,date,text)',
  $a$       and (v_who is null or lower(r.assignee_email) = v_who)
  ), d as ($a$,
  $b$       and (v_who is null or lower(r.assignee_email) = v_who)
       and not public.tk_late_excused(r.status, r.client_id, r.period_kind, r.period_start)   -- tk rhythm s4
  ), d as ($b$, 1);

do $$
declare s text;
begin
  foreach s in array array['public.staff_performance(integer,jsonb)', 'public.client_health(jsonb)',
                           'public.digest_weekly_data(date,date)', 'public.tk_on_time_stats(date,date,text)'] loop
    if position('tk_late_excused' in pg_get_functiondef(s::regprocedure)) = 0 then
      raise exception 'late exclusion missing in %', s;
    end if;
  end loop;
end $$;
