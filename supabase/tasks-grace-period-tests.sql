-- =====================================================================
-- Self-test for tasks-grace-period.sql.
--
-- Run it whole; it ends in ROLLBACK, so nothing it writes is kept and no
-- email is sent. People are picked at run time; no names or emails live
-- here. A failed check raises; the last statement lists every check.
--
-- Proves: the switch defaults OFF; only the owner can change it; while OFF,
-- overdue tasks (including the imported Asana ones) move no score:
-- staff_performance tasks_overdue/tasks_done are 0 and adding overdue and
-- done tasks changes nobody's score, client_health has no overdue-task
-- factor, the digest scorecard has no overdue count, tk_on_time_stats
-- returns nothing; filing deadlines still count (deadlines_total is not
-- zeroed). Flipping ON sets the effective-from date: the old backlog still
-- counts for nobody, a task that comes due after the date does, and flipping
-- OFF again restores the grace period. Every change is audited.
-- =====================================================================
begin;

create temp table t_ctx (k text primary key, v text) on commit drop;
create temp table t_res (n serial, what text) on commit drop;
grant select, insert on t_ctx to authenticated, anon;
grant all on t_res to authenticated, anon;
grant usage on sequence t_res_n_seq to authenticated, anon;

create or replace function pg_temp.ctx(p_k text) returns text language sql as $$ select v from t_ctx where k = p_k $$;
create or replace function pg_temp.as_user(p_email text) returns void language sql as $$
  select set_config('request.jwt.claims',
    case when p_email is null then '' else json_build_object(
      'sub', gen_random_uuid(), 'email', p_email,
      'role', 'authenticated', 'app_metadata', json_build_object('provider', 'google'))::text end, true);
$$;
create or replace function pg_temp.ok(p_cond boolean, p_what text) returns void language plpgsql as $$
begin
  if p_cond is not true then raise exception 'SELF-TEST FAILED: %', p_what; end if;
  insert into t_res (what) values (p_what);
end $$;
create or replace function pg_temp.expect_err(p_sql text, p_err text, p_what text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if position(p_err in sqlerrm) > 0 then insert into t_res (what) values (p_what); return; end if;
    raise exception 'SELF-TEST FAILED: % expected %, got %', p_what, p_err, sqlerrm;
  end;
  raise exception 'SELF-TEST FAILED: % expected %, but it succeeded', p_what, p_err;
end $$;
create or replace function pg_temp.d(p_days int) returns date language sql as $$
  select (now() at time zone 'America/Chicago')::date + p_days;
$$;
-- one person's staff_performance row, as an admin through RLS (like the app)
create or replace function pg_temp.perf(p_admin text, p_email text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform pg_temp.as_user(p_admin);
  set local role authenticated;
  select to_jsonb(p) into v from public.staff_performance(30) p where lower(p.email) = p_email;
  reset role;
  perform pg_temp.as_user(null);
  return v;
end $$;
create or replace function pg_temp.od_reasons() returns int language plpgsql as $$
declare v int;
begin
  perform pg_temp.as_user(pg_temp.ctx('a1'));
  set local role authenticated;
  select count(*)::int into v from public.client_health() h, jsonb_array_elements(h.reasons) f where f ->> 'key' = 'overdue';
  reset role;
  perform pg_temp.as_user(null);
  return v;
end $$;
create or replace function pg_temp.digest_overdue(p_email text) returns int language sql as $$
  select coalesce(sum((x ->> 'tasks_overdue')::int), 0)::int
    from jsonb_array_elements(public.digest_weekly_data(date_trunc('week', current_date)::date - 7, current_date) -> 'scorecard') x
   where lower(x ->> 'staff_email') = p_email
$$;
create or replace function pg_temp.mk(p_who text, p_due date, p_src text default 'manual', p_done boolean default false) returns void language plpgsql as $$
begin
  insert into staff_reminders (staff_email, assignee_email, text, due_date, kind, source, done, completed_at, status)
  values (p_who, p_who, 'Grace test', p_due, 'task', p_src, p_done, case when p_done then now() end, case when p_done then 'done' else 'todo' end);
end $$;
create or replace function pg_temp.owner_set(p_owner text, p_on boolean) returns date language plpgsql as $$
declare v date;
begin
  perform pg_temp.as_user(p_owner);
  set local role authenticated;
  v := public.tk_set_late_tasks_count(p_on);
  reset role;
  perform pg_temp.as_user(null);
  return v;
end $$;

-- People: a1 = an active admin, o1 = the owner, bk1 = a person on the Performance list.
insert into t_ctx select 'a1', lower(email) from staff where active and role = 'admin' order by email limit 1;
do $$ declare e text; begin
  for e in select lower(email) from staff where active and role = 'admin' order by email loop
    perform pg_temp.as_user(e);
    if public.is_internal_owner() then insert into t_ctx values ('o1', e); exit; end if;
  end loop;
  perform pg_temp.as_user(null);
end $$;
select pg_temp.ok(pg_temp.ctx('a1') is not null and pg_temp.ctx('o1') is not null, 'admin and owner found');

-- Start from the default (test setup only, rolled back).
select set_config('mgb.tk_owner_override', 'on', true);
insert into public.tk_settings (key, value) values ('late_tasks_count_against_staff', 'false'::jsonb)
  on conflict (key) do update set value = 'false'::jsonb;
select set_config('mgb.tk_owner_override', '', true);

do $$ declare v_a text := pg_temp.ctx('a1'); v_e text; begin
  perform pg_temp.as_user(v_a);
  set local role authenticated;
  select lower(p.email) into v_e from public.staff_performance(30) p order by p.email limit 1;
  reset role;
  perform pg_temp.as_user(null);
  insert into t_ctx values ('bk1', v_e);
end $$;
select pg_temp.ok(pg_temp.ctx('bk1') is not null, 'person for the score checks found');

-- 1. Default and permissions
select pg_temp.ok(public.tk_late_count_from() is null, 'switch is OFF: no effective date');
select pg_temp.ok(public.tk__owner_only_key('late_tasks_count_against_staff') and public.tk__owner_only_key('late_tasks_effective_from'),
                  'both keys are owner-only');
select pg_temp.as_user(pg_temp.ctx('a1'));
set local role authenticated;
select pg_temp.expect_err($q$update public.tk_settings set value = 'true'::jsonb where key = 'late_tasks_count_against_staff'$q$,
                          'tk_owner_only', 'direct write by a non-owner is refused') where not public.is_internal_owner();
reset role;
select pg_temp.as_user(null);
do $$ declare e text; begin
  select lower(s.email) into e from staff s where s.active and lower(s.email) <> pg_temp.ctx('o1') order by s.email limit 1;
  perform pg_temp.as_user(e);
  set local role authenticated;
  begin
    perform public.tk_set_late_tasks_count(true);
    raise exception 'SELF-TEST FAILED: a non-owner flipped the switch';
  exception when others then
    if position('tk_owner_only' in sqlerrm) = 0 then raise; end if;
  end;
  reset role;
  perform pg_temp.as_user(null);
  insert into t_res (what) values ('a non-owner cannot flip the switch');
end $$;

-- 2. OFF: overdue and done tasks move no score
insert into t_ctx values ('p0', pg_temp.perf(pg_temp.ctx('a1'), pg_temp.ctx('bk1'))::text);
insert into t_ctx values ('od0', pg_temp.od_reasons()::text);
select pg_temp.ok((pg_temp.ctx('p0')::jsonb ->> 'tasks_overdue')::int = 0 and (pg_temp.ctx('p0')::jsonb ->> 'tasks_done')::int = 0,
                  'OFF: the imported backlog gives tasks_overdue = 0 and tasks_done = 0');
select pg_temp.ok(pg_temp.ctx('od0')::int = 0, 'OFF: client health has no overdue-task factor');
select pg_temp.mk(pg_temp.ctx('bk1'), pg_temp.d(-3), 'manual');
select pg_temp.mk(pg_temp.ctx('bk1'), pg_temp.d(-40), 'asana');
select pg_temp.mk(pg_temp.ctx('bk1'), pg_temp.d(-1), 'manual', true);
select pg_temp.ok(pg_temp.perf(pg_temp.ctx('a1'), pg_temp.ctx('bk1')) = pg_temp.ctx('p0')::jsonb,
                  'OFF: adding overdue and done tasks changes nothing in the row (score, tasks_pct, deadlines)');
select pg_temp.ok(pg_temp.digest_overdue(pg_temp.ctx('bk1')) = 0, 'OFF: the digest scorecard shows no overdue tasks');
select pg_temp.ok(not exists (select 1 from jsonb_array_elements(public.digest_weekly_data(date_trunc('week', current_date)::date - 7, current_date) -> 'scorecard') x
                              where (x ->> 'late_counts_on')::boolean), 'OFF: the digest says late counts are off');
select pg_temp.as_user(pg_temp.ctx('a1'));
set local role authenticated;
select pg_temp.ok(not exists (select 1 from public.tk_on_time_stats(current_date - 90, current_date, null)), 'OFF: on-time stats are empty');
reset role;
select pg_temp.as_user(null);
select pg_temp.ok((pg_temp.ctx('p0')::jsonb ->> 'deadlines_total') is not null, 'filing deadlines are still reported (not tasks)');

-- 3. Flip ON as the owner: effective date is today, the old backlog still counts for nobody
insert into t_ctx values ('eff', pg_temp.owner_set(pg_temp.ctx('o1'), true)::text);
select pg_temp.ok(pg_temp.ctx('eff')::date = pg_temp.d(0), 'ON: effective-from date is today');
select pg_temp.ok((select value #>> '{}' from tk_settings where key = 'late_tasks_effective_from') = to_char(pg_temp.d(0), 'YYYY-MM-DD'),
                  'ON: the effective-from key was written');
select pg_temp.ok((pg_temp.perf(pg_temp.ctx('a1'), pg_temp.ctx('bk1')) ->> 'tasks_overdue')::int = 0,
                  'ON, effective today: every earlier-due task (imported or not) still counts for nobody');
select pg_temp.ok(pg_temp.od_reasons() = 0, 'ON, effective today: client health still has no overdue factor');
select pg_temp.ok(exists (select 1 from tk_settings_audit where key = 'late_tasks_count_against_staff' and new_value = 'true'::jsonb),
                  'the flip is audited');

-- 4. Move the effective date back 10 days (test only): a task due after it counts, older ones do not
select set_config('mgb.tk_owner_override', 'on', true);
update public.tk_settings set value = to_jsonb(to_char(pg_temp.d(-10), 'YYYY-MM-DD')) where key = 'late_tasks_effective_from';
select set_config('mgb.tk_owner_override', '', true);
select pg_temp.ok(public.tk_late_count_from() = pg_temp.d(-10), 'ON: tk_late_count_from returns the effective date');
select pg_temp.ok((pg_temp.perf(pg_temp.ctx('a1'), pg_temp.ctx('bk1')) ->> 'tasks_overdue')::int >= 1,
                  'ON: a task that came due after the effective date counts');
select pg_temp.ok(pg_temp.od_reasons() >= 0, 'ON: client health runs');
insert into t_ctx values ('p_on', (pg_temp.perf(pg_temp.ctx('a1'), pg_temp.ctx('bk1')) ->> 'tasks_overdue'));
select pg_temp.mk(pg_temp.ctx('bk1'), pg_temp.d(-40), 'manual');
select pg_temp.ok((pg_temp.perf(pg_temp.ctx('a1'), pg_temp.ctx('bk1')) ->> 'tasks_overdue') = pg_temp.ctx('p_on'),
                  'ON: a task due before the effective date adds nothing');
select pg_temp.mk(pg_temp.ctx('bk1'), pg_temp.d(-2), 'manual');
select pg_temp.ok((pg_temp.perf(pg_temp.ctx('a1'), pg_temp.ctx('bk1')) ->> 'tasks_overdue')::int = pg_temp.ctx('p_on')::int + 1,
                  'ON: one more task due after the date adds exactly one');
select pg_temp.ok(pg_temp.digest_overdue(pg_temp.ctx('bk1')) >= 1, 'ON: the digest scorecard shows overdue tasks again');

-- 4b. On-time stats: a backlog task (due before the date) finished after the switch-on does not count
create or replace function pg_temp.eligible(p_admin text, p_who text) returns int language plpgsql as $$
declare v int;
begin
  perform pg_temp.as_user(p_admin);
  set local role authenticated;
  select coalesce(sum(o.eligible), 0)::int into v from public.tk_on_time_stats(current_date - 90, current_date + 1, p_who) o;
  reset role;
  perform pg_temp.as_user(null);
  return v;
end $$;
insert into t_ctx values ('el0', pg_temp.eligible(pg_temp.ctx('a1'), pg_temp.ctx('bk1'))::text);
select pg_temp.mk(pg_temp.ctx('bk1'), pg_temp.d(-40), 'manual', true);
select pg_temp.ok(pg_temp.eligible(pg_temp.ctx('a1'), pg_temp.ctx('bk1')) = pg_temp.ctx('el0')::int,
                  'ON: a task due before the start date but finished after it adds nothing to on-time stats');

-- 5. Flip OFF again
select pg_temp.owner_set(pg_temp.ctx('o1'), false);
select pg_temp.ok(public.tk_late_count_from() is null, 'OFF again: grace period restored');
select pg_temp.ok((pg_temp.perf(pg_temp.ctx('a1'), pg_temp.ctx('bk1')) ->> 'tasks_overdue')::int = 0, 'OFF again: no overdue counted');
select pg_temp.ok(coalesce((select value #>> '{}' from tk_settings where key = 'late_tasks_effective_from'), '') = '', 'OFF again: the old start date is cleared');

select jsonb_agg(what order by n) as passed from t_res;
rollback;
