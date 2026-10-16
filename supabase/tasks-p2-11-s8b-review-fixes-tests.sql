-- =====================================================================
-- Self-test for tasks-p2-11-s8b-review-fixes.sql.
--
-- Run it whole; it ends in ROLLBACK, so nothing it writes is kept and no
-- email is sent. It never talks to Asana and flips no switch. People are
-- picked at run time; no names or emails live here. A failed check raises.
--
-- Proves: an unassigned overdue task counts for nobody in staff_performance
-- or the weekly digest (an assigned one still does); the stats functions no
-- longer fall back to the owner; time off hands off only assigned tasks and
-- the return leaves an unassigned task unassigned; the default reviewer of
-- an unassigned task is never its owner; a recurring unassigned task rolls
-- forward unassigned; tk_import_assign_team refuses test clients and clients
-- with no imported tasks; no email from any of it.
-- =====================================================================
begin;

create temp table t_ctx (k text primary key, v text) on commit drop;
grant select, insert on t_ctx to authenticated, anon;

create or replace function pg_temp.ctx(p_k text) returns text language sql as $$ select v from t_ctx where k = p_k $$;
create or replace function pg_temp.id(p_k text) returns uuid language sql as $$ select v::uuid from t_ctx where k = p_k $$;
create or replace function pg_temp.as_user(p_email text) returns void language sql as $$
  select set_config('request.jwt.claims',
    case when p_email is null then '' else json_build_object(
      'sub', gen_random_uuid(),
      'email', coalesce((select s.email from staff s where lower(s.email) = lower(p_email) limit 1), p_email),
      'role', 'authenticated', 'app_metadata', json_build_object('provider', 'google'))::text end, true);
$$;
create or replace function pg_temp.ok(p_cond boolean, p_what text) returns void language plpgsql as $$
begin
  if p_cond is not true then raise exception 'SELF-TEST FAILED: %', p_what; end if;
  raise notice 'ok: %', p_what;
end $$;
create or replace function pg_temp.expect_err(p_sql text, p_err text, p_what text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if position(p_err in sqlerrm) > 0 then raise notice 'ok: % (%)', p_what, p_err; return; end if;
    raise exception 'SELF-TEST FAILED: % expected %, got %', p_what, p_err, sqlerrm;
  end;
  raise exception 'SELF-TEST FAILED: % expected %, but it succeeded', p_what, p_err;
end $$;
create or replace function pg_temp.d(p_days int) returns date language sql as $$
  select (now() at time zone 'America/Chicago')::date + p_days;
$$;
create or replace function pg_temp.outbox() returns bigint language sql as $$ select count(*) from notification_outbox $$;
-- p_to null = unassigned (inserted with the import/generator flag, as the table owner)
create or replace function pg_temp.mk(p_key text, p_owner text, p_to text, p_client text, p_due date,
                                      p_recur text default 'none', p_vis text default 'shared') returns uuid
language plpgsql as $$
declare v uuid;
begin
  perform set_config('mgb.tk_unassigned', case when p_to is null then 'on' else '' end, true);
  insert into staff_reminders (staff_email, assignee_email, text, client_id, due_date, recurrence, visibility, kind)
  values (p_owner, p_to, 'S8b11 test ' || p_key, p_client, p_due, p_recur, p_vis, 'task')
  returning id into v;
  perform set_config('mgb.tk_unassigned', '', true);
  insert into t_ctx values (p_key, v::text);
  return v;
end $$;
create or replace function pg_temp.row(p_key text) returns staff_reminders language sql as $$
  select * from staff_reminders where id = pg_temp.id(p_key)
$$;
-- staff_performance as an admin (through RLS, like the app)
create or replace function pg_temp.perf_overdue(p_admin text, p_email text) returns int language plpgsql as $$
declare v int;
begin
  perform pg_temp.as_user(p_admin);
  set local role authenticated;
  select coalesce(sum(tasks_overdue), 0) into v from public.staff_performance(30) where lower(email) = p_email;
  reset role;
  perform pg_temp.as_user(null);
  return v;
end $$;
create or replace function pg_temp.digest(p_email text, p_key text) returns int language sql as $$
  select coalesce(sum((x ->> p_key)::int), 0)::int
    from jsonb_array_elements(public.digest_weekly_data(date_trunc('week', current_date)::date - 7, current_date) -> 'scorecard') x
   where lower(x ->> 'staff_email') = p_email
$$;

-- People: a1, a2 = active admins; bk1 (owner / away), bk2 (backup) = active bookkeepers.
insert into t_ctx select 'a1', lower(email) from staff where active and role = 'admin' order by email limit 1;
insert into t_ctx select 'a2', lower(email) from staff where active and role = 'admin' order by email offset 1 limit 1;
insert into t_ctx select 'bk1', lower(email) from staff where active and role = 'bookkeeper' order by email limit 1;
insert into t_ctx select 'bk2', lower(email) from staff where active and role = 'bookkeeper' order by email offset 1 limit 1;
select pg_temp.ok(pg_temp.ctx('a1') is not null and pg_temp.ctx('a2') is not null and pg_temp.ctx('bk1') is not null
                  and pg_temp.ctx('bk2') is not null, 'test people found');
select pg_temp.ok(public.tk_schema_version() = 10, 'schema version still 10');
select pg_temp.ok(exists (select 1 from clients where id = 'basic-test' and test_only), 'test client basic-test exists');
insert into t_ctx values ('outbox0', pg_temp.outbox()::text);

-- 0. No live stats/hand-off function falls back to the owner any more
select pg_temp.ok(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('staff_performance', 'digest_weekly_data', 'tk_on_time_stats', 'tk_review_stats', 'tk__ooo_apply', 'tk__ooo_return')
     and pg_get_functiondef(p.oid) ~* 'coalesce\(\s*[a-z_]*\.?assignee_email\s*,\s*[a-z_]*\.?staff_email'),
  'stats and hand-off functions read the assignee only');
select pg_temp.ok(position('r.assignee_email is not null' in pg_get_functiondef('public.tk_on_time_stats(date,date,text)'::regprocedure)) > 0
                  and position('r.assignee_email is not null' in pg_get_functiondef('public.tk_review_stats(date,date,text)'::regprocedure)) > 0,
                  'on-time and review stats leave unassigned tasks out');

-- 1. MAJOR 1: an unassigned overdue task counts for nobody --------------------
insert into t_ctx values ('perf0', pg_temp.perf_overdue(pg_temp.ctx('a1'), pg_temp.ctx('bk1'))::text);
insert into t_ctx values ('dg_open0', pg_temp.digest(pg_temp.ctx('bk1'), 'tasks_open')::text);
insert into t_ctx values ('dg_over0', pg_temp.digest(pg_temp.ctx('bk1'), 'tasks_overdue')::text);
select pg_temp.mk('U1', pg_temp.ctx('bk1'), null, null, pg_temp.d(-3), 'none', 'private');
select pg_temp.mk('U2', pg_temp.ctx('bk1'), null, null, pg_temp.d(-5), 'none', 'private');
select pg_temp.ok((pg_temp.row('U1')).assignee_email is null and lower((pg_temp.row('U1')).staff_email) = pg_temp.ctx('bk1'),
                  'setup: unassigned task owned by bk1');
select pg_temp.ok(pg_temp.perf_overdue(pg_temp.ctx('a1'), pg_temp.ctx('bk1')) = pg_temp.ctx('perf0')::int,
                  'staff_performance: unassigned overdue tasks do not count for their owner');
select pg_temp.ok(pg_temp.digest(pg_temp.ctx('bk1'), 'tasks_open') = pg_temp.ctx('dg_open0')::int
                  and pg_temp.digest(pg_temp.ctx('bk1'), 'tasks_overdue') = pg_temp.ctx('dg_over0')::int,
                  'weekly digest: unassigned tasks are not the owner''s open or overdue');
select pg_temp.mk('A1', pg_temp.ctx('bk1'), pg_temp.ctx('bk1'), null, pg_temp.d(-3), 'none', 'private');
select pg_temp.ok(pg_temp.perf_overdue(pg_temp.ctx('a1'), pg_temp.ctx('bk1')) = pg_temp.ctx('perf0')::int + 1,
                  'control: an assigned overdue task still counts in staff_performance');
select pg_temp.ok(pg_temp.digest(pg_temp.ctx('bk1'), 'tasks_overdue') = pg_temp.ctx('dg_over0')::int + 1
                  and pg_temp.digest(pg_temp.ctx('bk1'), 'tasks_open') = pg_temp.ctx('dg_open0')::int + 1,
                  'control: an assigned overdue task still counts in the digest');

-- 2. MAJOR 2: time off hands off assigned tasks only -------------------------
update clients set assigned_bookkeeper_email = pg_temp.ctx('bk1') where id = 'basic-test';
insert into client_profile (client_id, backup_bookkeeper_email) values ('basic-test', pg_temp.ctx('bk2'))
  on conflict (client_id) do update set backup_bookkeeper_email = excluded.backup_bookkeeper_email;
insert into staff_client_access (staff_email, client_id)
select x.e, 'basic-test' from (values (pg_temp.ctx('bk1')), (pg_temp.ctx('bk2'))) x(e)
 where not exists (select 1 from staff_client_access a where lower(a.staff_email) = x.e and a.client_id = 'basic-test');
with w as (insert into staff_time_off (staff_email, starts_on, ends_on, note)
           values (pg_temp.ctx('bk1'), pg_temp.d(0), pg_temp.d(6), 'S8b11 test') returning id)
insert into t_ctx select 'W1', id::text from w;
select pg_temp.mk('OA', pg_temp.ctx('bk1'), pg_temp.ctx('bk1'), 'basic-test', pg_temp.d(2));
select pg_temp.mk('OU', pg_temp.ctx('bk1'), null, 'basic-test', pg_temp.d(2));
select pg_temp.as_user(pg_temp.ctx('bk1'));
set local role authenticated;
insert into t_ctx select 'dry', public.tk_apply_ooo(pg_temp.id('W1'), true)::text;
insert into t_ctx select 'ap', public.tk_apply_ooo(pg_temp.id('W1'), false)::text;
reset role;
select pg_temp.ok(not exists (select 1 from jsonb_array_elements(pg_temp.ctx('dry')::jsonb -> 'move') e where e ->> 'task_id' = pg_temp.ctx('OU'))
                  and not exists (select 1 from jsonb_array_elements(pg_temp.ctx('dry')::jsonb -> 'skip') e where e ->> 'task_id' = pg_temp.ctx('OU')),
                  'preview: the unassigned task is not listed at all');
select pg_temp.ok(lower((pg_temp.row('OA')).assignee_email) = pg_temp.ctx('bk2'), 'apply: the assigned task went to the backup');
select pg_temp.ok((pg_temp.row('OU')).assignee_email is null
                  and not exists (select 1 from tk_ooo_reassignments where task_id = pg_temp.id('OU')),
                  'apply: the unassigned task stays unassigned, no ledger row');
select pg_temp.as_user(pg_temp.ctx('bk1'));
set local role authenticated;
insert into t_ctx select 'rt', public.tk_return_ooo(pg_temp.id('W1'))::text;
reset role;
select pg_temp.as_user(null);
select pg_temp.ok(lower((pg_temp.row('OA')).assignee_email) = pg_temp.ctx('bk1'), 'return: the assigned task came back');
select pg_temp.ok((pg_temp.row('OU')).assignee_email is null, 'return: the unassigned task is still unassigned');

-- 3. Default reviewer of an unassigned task is never its owner -------------------
insert into client_profile (client_id, reviewer_email) values ('basic-test', pg_temp.ctx('a1'))
  on conflict (client_id) do update set reviewer_email = excluded.reviewer_email;
select pg_temp.as_user(pg_temp.ctx('a2'));
select set_config('mgb.tk_unassigned', 'on', true);
select set_config('mgb.tk_migrate', 'on', true);
insert into staff_reminders (staff_email, assignee_email, text, client_id, due_date, kind, status, review_required)
values (pg_temp.ctx('a1'), null, 'S8b11 test R1', 'basic-test', pg_temp.d(3), 'task', 'ready_for_review', true);
select set_config('mgb.tk_migrate', '', true);
select set_config('mgb.tk_unassigned', '', true);
select pg_temp.as_user(null);
insert into t_ctx select 'R1', id::text from staff_reminders where text = 'S8b11 test R1';
select pg_temp.ok((pg_temp.row('R1')).status = 'ready_for_review' and (pg_temp.row('R1')).assignee_email is null,
                  'setup: unassigned task in review');
select pg_temp.ok(lower(coalesce((pg_temp.row('R1')).reviewer_email, '')) <> pg_temp.ctx('a1'),
                  'the client reviewer who owns the unassigned task is skipped as default reviewer');
-- control: an assigned task owned by a1 keeps a1 as its default reviewer
select pg_temp.as_user(pg_temp.ctx('a2'));
select set_config('mgb.tk_migrate', 'on', true);
insert into staff_reminders (staff_email, assignee_email, text, client_id, due_date, kind, status, review_required)
values (pg_temp.ctx('a1'), pg_temp.ctx('bk1'), 'S8b11 test R2', 'basic-test', pg_temp.d(3), 'task', 'ready_for_review', true);
select set_config('mgb.tk_migrate', '', true);
select pg_temp.as_user(null);
select pg_temp.ok((select lower(reviewer_email) from staff_reminders where text = 'S8b11 test R2') = pg_temp.ctx('a1'),
                  'control: on an assigned task the owner can still be the reviewer');

-- 4. A recurring unassigned task rolls forward unassigned -----------------------
select pg_temp.mk('RU', pg_temp.ctx('bk1'), null, 'basic-test', pg_temp.d(1), 'weekly');
select pg_temp.mk('RA', pg_temp.ctx('bk1'), pg_temp.ctx('bk1'), 'basic-test', pg_temp.d(1), 'weekly');
select pg_temp.as_user(pg_temp.ctx('bk1'));
insert into t_ctx select 'RU_next', public.complete_staff_item(pg_temp.id('RU'), true, null)::text;
insert into t_ctx select 'RA_next', public.complete_staff_item(pg_temp.id('RA'), true, null)::text;
select pg_temp.as_user(null);
select pg_temp.ok(pg_temp.ctx('RU_next') is not null and (pg_temp.row('RU_next')).assignee_email is null
                  and lower((pg_temp.row('RU_next')).staff_email) = pg_temp.ctx('bk1')
                  and (pg_temp.row('RU_next')).due_date = pg_temp.d(8),
                  'next copy of a recurring unassigned task is unassigned, same owner, a week later');
select pg_temp.ok(lower((pg_temp.row('RA_next')).assignee_email) = pg_temp.ctx('bk1'), 'control: an assigned series keeps its assignee');
select pg_temp.ok(current_setting('mgb.tk_unassigned', true) is distinct from 'on', 'unassigned flag reset after roll-forward');
-- and a plain new task is still assigned to its owner after that
insert into staff_reminders (staff_email, text, kind, visibility) values (pg_temp.ctx('a1'), 'S8b11 test default', 'task', 'private');
select pg_temp.ok((select lower(assignee_email) from staff_reminders where text = 'S8b11 test default') = pg_temp.ctx('a1'),
                  'a normal new task still defaults to its owner');

-- 5. tk_import_assign_team: real imported clients only ----------------------------
insert into clients (id, name, org_type) select 's8b11-test-plain', 'S8b11 test plain client', org_type from clients where id = 'basic-test';
insert into clients (id, name, org_type) select 's8b11-test-asana', 'S8b11 test imported client', org_type from clients where id = 'basic-test';
select set_config('mgb.tk_import', 'on', true);
select set_config('mgb.tk_unassigned', 'on', true);
insert into staff_reminders (staff_email, assignee_email, text, client_id, kind, visibility, source, source_ref)
values (pg_temp.ctx('a2'), null, 'S8b11 test imported', 's8b11-test-asana', 'task', 'shared', 'asana', 's8b11-test-1');
select set_config('mgb.tk_unassigned', '', true);
select set_config('mgb.tk_import', '', true);
select pg_temp.as_user(pg_temp.ctx('a1'));
select pg_temp.expect_err($$select public.tk_import_assign_team('basic-test', pg_temp.ctx('bk2'))$$, 'tk_not_found', 'a test client is refused');
select pg_temp.expect_err($$select public.tk_import_assign_team('s8b11-test-plain', pg_temp.ctx('bk2'))$$, 'tk_not_found',
                          'a client with no imported tasks is refused');
select pg_temp.ok((public.tk_import_assign_team('s8b11-test-asana', pg_temp.ctx('bk2')) ->> 'bookkeeper') = pg_temp.ctx('bk2'),
                  'an imported client with no team gets its bookkeeper');
select pg_temp.as_user(null);

-- 6. No email about any unassigned task (the hand-off email for the assigned one is expected)
select pg_temp.ok(not exists (select 1 from notification_outbox o
                               where o.created_at >= now()
                                 and (o.payload::text ~ 'S8b11 test (U1|U2|OU|RU|imported)'
                                      or o.ref_id in (pg_temp.ctx('U1'), pg_temp.ctx('U2'), pg_temp.ctx('OU'), pg_temp.ctx('RU'),
                                                      coalesce(pg_temp.ctx('RU_next'), '-')))),
                  'no email about the unassigned tasks');
select pg_temp.ok(exists (select 1 from notification_outbox o where o.created_at >= now() and o.payload::text like '%S8b11 test OA%'),
                  'control: the hand-off email for the assigned task was queued (and is rolled back)');

select 'S8b review fixes self-test: all checks passed' as result;
rollback;
