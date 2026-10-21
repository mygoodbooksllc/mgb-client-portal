-- =====================================================================
-- Self-test for slate-rhythm-4c-late-exclusion.sql (slice 4f). Ends in ROLLBACK. Last run 2026-10-21: all ok (pre and post apply).
-- Works before or after the migration is applied: it captures every late
-- number with grace simulated (late counts on from 2026-01-01), applies the
-- patches inside the transaction (a no-op once applied), captures again and
-- proves the output is identical on today's production data. Then it adds
-- fixture tasks on grace-community (made a real client for the run) and
-- proves waiting and preliminary-month tasks never count while every other
-- task still does. The last select returns the before/after totals.
-- =====================================================================
begin;

create temp table t_ctx (k text primary key, v text) on commit drop;
create or replace function pg_temp.ctx(p_k text) returns text language sql as $$ select v from t_ctx where k = p_k $$;
create or replace function pg_temp.ok(p_cond boolean, p_what text) returns void language plpgsql as $$
begin
  if p_cond is not true then raise exception 'SELF-TEST FAILED: %', p_what; end if;
end $$;
create or replace function pg_temp.mk(p_text text, p_status text, p_kind text, p_start date) returns uuid language plpgsql as $$
declare v uuid;
begin
  perform set_config('mgb.tk_generate', 'on', true);
  insert into staff_reminders (staff_email, assignee_email, created_by, text, client_id, due_date, due_date_original, source, period_kind, period_start, status)
  values (pg_temp.ctx('a1'), pg_temp.ctx('bk'), pg_temp.ctx('a1'), p_text, 'grace-community', current_date - 3, current_date - 3, 'template', p_kind, p_start, p_status)
  returning id into v;
  perform set_config('mgb.tk_generate', '', true);
  return v;
end $$;

insert into t_ctx select 'a1', lower(s.email) from staff s where s.active and s.role = 'admin' order by s.email limit 1;
insert into t_ctx select 'bk', lower(s.email) from staff s where s.active and s.role = 'bookkeeper' order by s.email limit 1;
select pg_temp.ok(pg_temp.ctx('a1') is not null and pg_temp.ctx('bk') is not null, 'test people found');
select set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'email', pg_temp.ctx('a1'), 'role', 'authenticated',
  'app_metadata', json_build_object('provider', 'google'))::text, true);
select pg_temp.ok(public.is_active_staff_admin(), 'running as an admin');

-- Grace simulated: late tasks count from 2026-01-01 (rolled back).
select set_config('mgb.tk_owner_override', 'on', true);
delete from tk_settings where key in ('late_tasks_count_against_staff', 'late_tasks_effective_from');
insert into tk_settings (key, value) values ('late_tasks_count_against_staff', 'true'::jsonb), ('late_tasks_effective_from', '"2026-01-01"'::jsonb);
select set_config('mgb.tk_owner_override', '', true);
select pg_temp.ok(public.tk_late_count_from() = date '2026-01-01', 'late counts on for the run');

-- Before -------------------------------------------------------------------
create temp table b_sp on commit drop as select * from public.staff_performance(30);
create temp table b_ch on commit drop as select * from public.client_health();
create temp table b_dg on commit drop as select public.digest_weekly_data(date_trunc('week', current_date)::date, current_date) j;
create temp table b_ot on commit drop as select * from public.tk_on_time_stats(date '2026-01-01', current_date);

-- Patches (no-op once the migration is applied) ------------------------------
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


-- After, same data ------------------------------------------------------------
create temp table a_sp on commit drop as select * from public.staff_performance(30);
create temp table a_ch on commit drop as select * from public.client_health();
create temp table a_dg on commit drop as select public.digest_weekly_data(date_trunc('week', current_date)::date, current_date) j;
create temp table a_ot on commit drop as select * from public.tk_on_time_stats(date '2026-01-01', current_date);
select pg_temp.ok((select count(*) = 0 from (select * from b_sp except all select * from a_sp) x)
              and (select count(*) = 0 from (select * from a_sp except all select * from b_sp) x), 'staff_performance identical');
select pg_temp.ok((select count(*) = 0 from (select * from b_ch except all select * from a_ch) x)
              and (select count(*) = 0 from (select * from a_ch except all select * from b_ch) x), 'client_health identical');
select pg_temp.ok((select b.j = a.j from b_dg b, a_dg a), 'digest_weekly_data identical');
select pg_temp.ok((select count(*) = 0 from (select * from b_ot except all select * from a_ot) x)
              and (select count(*) = 0 from (select * from a_ot except all select * from b_ot) x), 'tk_on_time_stats identical');
insert into t_ctx select 'prod_overdue', coalesce(sum(tasks_overdue), 0)::text from a_sp;
insert into t_ctx select 'prod_eligible', coalesce(sum(eligible), 0)::text from a_ot;
insert into t_ctx select 'prod_red', count(*)::text from a_ch where band = 'red';

-- Unit checks -------------------------------------------------------------------
select pg_temp.ok(public.tk_late_excused('waiting_client', null, null, null), 'waiting is excused');
select pg_temp.ok(not public.tk_late_excused('todo', 'grace-community', 'month', date '2026-08-01'), 'no report state: not excused');
select pg_temp.ok(not public.tk_late_excused(null, null, null, null), 'nulls: not excused');

-- Fixtures ----------------------------------------------------------------------
update clients set test_only = false where id = 'grace-community';
insert into tk_report_state (client_id, period, state, missing, set_by) values
  ('grace-community', '2026-08-01', 'preliminary', '[{"label":"Bank statement","request_id":null}]', 'self-test'),
  ('grace-community', '2026-07-01', 'preliminary', '[{"label":"Bank statement","request_id":null}]', 'self-test'),
  ('grace-community', '2026-09-01', 'full', '[]', 'self-test');
select pg_temp.ok(public.tk_late_excused('todo', 'grace-community', 'month', date '2026-08-15'), 'preliminary month is excused');
select pg_temp.ok(not public.tk_late_excused('todo', 'grace-community', 'month', date '2026-09-01'), 'full month is not excused');
select pg_temp.ok(not public.tk_late_excused('todo', 'grace-community', 'quarter', date '2026-07-01'), 'quarter period is not excused');
select pg_temp.ok(not public.tk_late_excused('todo', 'basic-test', 'month', date '2026-08-01'), 'other client is not excused');
create temp table b2_sp on commit drop as select * from public.staff_performance(30);
create temp table b2_ch on commit drop as select * from public.client_health();
create temp table b2_dg on commit drop as select public.digest_weekly_data(date_trunc('week', current_date)::date, current_date) j;
create temp table b2_ot on commit drop as select * from public.tk_on_time_stats(date '2026-01-01', current_date);
select pg_temp.mk('LX normal', 'todo', 'month', date '2026-09-01');        -- counts
select pg_temp.mk('LX quarter', 'in_progress', 'quarter', date '2026-07-01'); -- counts
select pg_temp.mk('LX none', 'todo', null, null);                          -- counts
select pg_temp.mk('LX waiting', 'waiting_client', 'month', date '2026-09-01'); -- never
select pg_temp.mk('LX prelim', 'todo', 'month', date '2026-08-01');          -- never
select pg_temp.mk('LX prelim wait', 'waiting_client', 'month', date '2026-07-01'); -- never
select pg_temp.ok((select count(*) = 6 from staff_reminders where text like 'LX %'), 'fixtures made');

select pg_temp.ok((select coalesce((select tasks_overdue from public.staff_performance(30) where email = pg_temp.ctx('bk')), 0)
                        - coalesce((select tasks_overdue from b2_sp where email = pg_temp.ctx('bk')), 0)) = 3,
  'staff_performance: only the 3 ordinary late tasks count');
select pg_temp.ok((select count(*) = 0 from (select email, tasks_overdue, tasks_done from b2_sp where email <> pg_temp.ctx('bk')
                                             except all select email, tasks_overdue, tasks_done from public.staff_performance(30) where email <> pg_temp.ctx('bk')) x),
  'staff_performance: everyone else unchanged');
select pg_temp.ok((select (h.reasons::text like '%3 overdue tasks%') from public.client_health() h where h.client_id = 'grace-community'),
  'client_health: 3 overdue tasks for the client');
select pg_temp.ok((select count(*) = 0 from (select * from b2_ch where client_id <> 'grace-community'
                                             except all select * from public.client_health() where client_id <> 'grace-community') x),
  'client_health: other clients unchanged');
select pg_temp.ok((select (x ->> 'tasks_overdue')::int from jsonb_array_elements(public.digest_weekly_data(date_trunc('week', current_date)::date, current_date) -> 'scorecard') x
                    where x ->> 'staff_email' = pg_temp.ctx('bk'))
                  - (select (x ->> 'tasks_overdue')::int from b2_dg, jsonb_array_elements(b2_dg.j -> 'scorecard') x
                    where x ->> 'staff_email' = pg_temp.ctx('bk')) = 3,
  'digest: only the 3 ordinary late tasks count');
select pg_temp.ok((select coalesce((select eligible from public.tk_on_time_stats(date '2026-01-01', current_date) where staff_email = pg_temp.ctx('bk')), 0)
                        - coalesce((select eligible from b2_ot where staff_email = pg_temp.ctx('bk')), 0)) = 3,
  'on-time: only the 3 ordinary tasks are eligible (all late)');
select pg_temp.ok((select coalesce((select on_time from public.tk_on_time_stats(date '2026-01-01', current_date) where staff_email = pg_temp.ctx('bk')), 0)
                        = coalesce((select on_time from b2_ot where staff_email = pg_temp.ctx('bk')), 0)),
  'on-time: none of them on time');
select pg_temp.ok((select count(*) = 0 from (select * from b2_ot where staff_email <> pg_temp.ctx('bk')
                                             except all select * from public.tk_on_time_stats(date '2026-01-01', current_date) where staff_email <> pg_temp.ctx('bk')) x),
  'on-time: everyone else unchanged');

select jsonb_build_object('result', 'all ok',
  'production_with_grace_simulated', jsonb_build_object(
    'tasks_overdue_total_before', (select coalesce(sum(tasks_overdue), 0) from b_sp),
    'tasks_overdue_total_after', pg_temp.ctx('prod_overdue')::int,
    'on_time_eligible_before', (select coalesce(sum(eligible), 0) from b_ot),
    'on_time_eligible_after', pg_temp.ctx('prod_eligible')::int,
    'health_red_before', (select count(*) from b_ch where band = 'red'),
    'health_red_after', pg_temp.ctx('prod_red')::int)) as result;
rollback;
