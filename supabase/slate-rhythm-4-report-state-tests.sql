-- =====================================================================
-- Self-test for slate-rhythm-4-report-state.sql (slice 4a). Ends in ROLLBACK.
-- Uses the test clients basic-test and grace-community only. People are
-- picked at run time; no names or emails of real people live in this file.
-- Real-role checks run as `authenticated` with JWT claims, like the app.
-- A failed check raises and stops the run; the last select returns 'all ok'.
-- Last run: 2026-10-21 against production, all ok, rolled back (verified no rows left).
-- =====================================================================
begin;

create temp table t_ctx (k text primary key, v text) on commit drop;
grant all on t_ctx to authenticated;
create or replace function pg_temp.ctx(p_k text) returns text language sql as $$ select v from t_ctx where k = p_k $$;
create or replace function pg_temp.as_user(p_email text, p_google boolean default true) returns void language sql as $$
  select set_config('request.jwt.claims',
    case when p_email is null then '' else json_build_object(
      'sub', gen_random_uuid(), 'email', p_email, 'role', 'authenticated',
      'app_metadata', case when p_google then json_build_object('provider', 'google') else json_build_object('provider', 'email') end)::text end, true);
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
grant execute on function pg_temp.ctx(text), pg_temp.ok(boolean, text), pg_temp.expect_err(text, text, text),
  pg_temp.as_user(text, boolean) to authenticated;

-- People: a1 = an active admin, bk = an active bookkeeper given basic-test
-- only, cm = an active grace-community portal user.
insert into t_ctx select 'a1', lower(s.email) from staff s where s.active and s.role = 'admin' order by s.email limit 1;
insert into t_ctx select 'bk', lower(s.email) from staff s where s.active and s.role = 'bookkeeper' order by s.email limit 1;
insert into t_ctx select 'cm', lower(cu.email) from client_users cu where cu.client_id = 'grace-community' and cu.active order by cu.email limit 1;
select pg_temp.ok(pg_temp.ctx('a1') is not null and pg_temp.ctx('bk') is not null and pg_temp.ctx('cm') is not null, 'test people found');
select pg_temp.ok(not exists (select 1 from staff s where lower(s.email) = pg_temp.ctx('cm')), 'client user is not staff');
insert into staff_client_access (staff_email, client_id)
select pg_temp.ctx('bk'), 'basic-test'
 where not exists (select 1 from staff_client_access where lower(staff_email) = pg_temp.ctx('bk') and client_id = 'basic-test');
delete from staff_client_access where lower(staff_email) = pg_temp.ctx('bk') and client_id = 'grace-community';
delete from staff_client_access_grants where lower(staff_email) = pg_temp.ctx('bk') and client_id = 'grace-community';
select set_config('mgb.tk_owner_override', 'on', true);
delete from tk_settings where key = 'month_rhythm_enabled';   -- switch off for this run (rolled back)
select set_config('mgb.tk_owner_override', '', true);

-- Fixture requests: one open on grace-community, one open on basic-test.
insert into client_requests (client_id, title, prompt, asked_by)
values ('grace-community', 'Statement for Operating', 'Please upload it', pg_temp.ctx('a1'));
insert into t_ctx select 'req_gc', id::text from client_requests where client_id = 'grace-community' and title = 'Statement for Operating' order by asked_at desc limit 1;
insert into client_requests (client_id, title, prompt, asked_by) values ('basic-test', 'Other client item', 'x', pg_temp.ctx('a1'));
insert into t_ctx select 'req_bt', id::text from client_requests where client_id = 'basic-test' and title = 'Other client item' order by asked_at desc limit 1;

-- 1. Staff writes ---------------------------------------------------------
set local role authenticated;
select pg_temp.as_user(pg_temp.ctx('a1'));
select pg_temp.expect_err($$select public.tk_set_report_state('grace-community', date '2026-09-01', 'preliminary', '[]')$$,
  'tk_report_missing_required', 'preliminary needs at least one item');
select pg_temp.expect_err($$select public.tk_set_report_state('grace-community', date '2026-09-01', 'partial', '[]')$$,
  'tk_bad_report_state', 'unknown state refused');
select public.tk_set_report_state('grace-community', date '2026-09-17', 'preliminary',
  jsonb_build_array(jsonb_build_object('label', '  Statement for Operating ', 'request_id', pg_temp.ctx('req_gc')),
                    jsonb_build_object('label', 'Other client item', 'request_id', pg_temp.ctx('req_bt')),
                    jsonb_build_object('label', '   '),
                    to_jsonb('Payroll report'::text)));
select pg_temp.ok((select count(*) = 1 from tk_report_state where client_id = 'grace-community' and period = '2026-09-01' and state = 'preliminary'),
  'admin sets preliminary; period normalized to the first');
select pg_temp.ok((select missing = jsonb_build_array(
                      jsonb_build_object('label', 'Statement for Operating', 'request_id', pg_temp.ctx('req_gc')),
                      jsonb_build_object('label', 'Other client item', 'request_id', null),
                      jsonb_build_object('label', 'Payroll report', 'request_id', null))
                     from tk_report_state where client_id = 'grace-community' and period = '2026-09-01'),
  'labels trimmed, blank dropped, other client request id nulled');
select public.tk_set_report_state('grace-community', date '2026-08-01', 'full', '[{"label":"ignored"}]');
select pg_temp.ok((select missing = '[]'::jsonb from tk_report_state where client_id = 'grace-community' and period = '2026-08-01'),
  'full stores no missing items');
select pg_temp.expect_err($$insert into tk_report_state (client_id, period, state) values ('basic-test', '2026-09-01', 'full')$$,
  'permission denied', 'staff cannot insert directly');
select pg_temp.expect_err($$update tk_report_state set state = 'none' where client_id = 'grace-community'$$,
  'permission denied', 'staff cannot update directly');

-- 2. A bookkeeper without access ------------------------------------------
select pg_temp.as_user(pg_temp.ctx('bk'));
select pg_temp.expect_err($$select public.tk_set_report_state('grace-community', date '2026-09-01', 'full', '[]')$$,
  'tk_forbidden', 'bookkeeper without access cannot write');
select pg_temp.ok((select count(*) = 0 from tk_report_state where client_id = 'grace-community'),
  'bookkeeper without access reads no rows');
select public.tk_set_report_state('basic-test', date '2026-09-01', 'preliminary', '[{"label":"Bank statement"}]');
select pg_temp.ok((select count(*) = 1 from tk_report_state where client_id = 'basic-test'), 'bookkeeper with access writes and reads');

-- 3. The client user --------------------------------------------------------
select pg_temp.as_user(pg_temp.ctx('cm'), false);
select pg_temp.ok((select count(*) = 0 from tk_report_state), 'client reads no table rows');
select pg_temp.ok((select count(*) = 0 from tk_report_state_audit), 'client reads no audit rows');
select pg_temp.ok((select count(*) = 0 from staff_reminders), 'client reads no tasks (staff_reminders)');
select pg_temp.ok((select count(*) = 0 from tk_tasks), 'client reads no tasks (tk_tasks)');
select pg_temp.expect_err($$select public.tk_set_report_state('grace-community', date '2026-09-01', 'full', '[]')$$,
  'tk_forbidden', 'client cannot write');
select pg_temp.expect_err($$insert into tk_report_state (client_id, period, state) values ('grace-community', '2026-07-01', 'full')$$,
  'permission denied', 'client cannot insert');
select pg_temp.expect_err($$select * from public.tk_client_report_state('basic-test')$$,
  'tk_forbidden', 'client cannot read another client');
select pg_temp.ok((select count(*) = 2 from public.tk_client_report_state('grace-community')),
  'client reads own rows (test client, switch off)');
select pg_temp.ok((select missing = jsonb_build_array(
                      jsonb_build_object('label', 'Statement for Operating', 'request_id', pg_temp.ctx('req_gc')),
                      jsonb_build_object('label', 'Other client item', 'request_id', null),
                      jsonb_build_object('label', 'Payroll report', 'request_id', null))
                     from public.tk_client_report_state('grace-community') where period = '2026-09-01'),
  'client sees labels and the open request id only');
select pg_temp.ok((select bool_and((select count(*) from jsonb_object_keys(to_jsonb(r)) k) = 3)
                     from public.tk_client_report_state('grace-community') r),
  'client rows carry period, state, missing only');
reset role;

-- An answered request no longer links.
update client_requests set status = 'answered' where id = pg_temp.ctx('req_gc')::uuid;
set local role authenticated;
select pg_temp.as_user(pg_temp.ctx('cm'), false);
select pg_temp.ok((select missing -> 0 -> 'request_id' = 'null'::jsonb from public.tk_client_report_state('grace-community') where period = '2026-09-01'),
  'answered request id is hidden');
reset role;

-- A real client with the switch off sees nothing; on, sees its rows.
update clients set test_only = false where id = 'grace-community';
set local role authenticated;
select pg_temp.as_user(pg_temp.ctx('cm'), false);
select pg_temp.ok((select count(*) = 0 from public.tk_client_report_state('grace-community')), 'real client, switch off: no rows');
select pg_temp.as_user(pg_temp.ctx('a1'));
select pg_temp.ok((select count(*) = 2 from public.tk_client_report_state('grace-community')), 'staff still see them');
reset role;
select set_config('mgb.tk_owner_override', 'on', true);
insert into tk_settings (key, value) values ('month_rhythm_enabled', 'true'::jsonb);
select set_config('mgb.tk_owner_override', '', true);
set local role authenticated;
select pg_temp.as_user(pg_temp.ctx('cm'), false);
select pg_temp.ok((select count(*) = 2 from public.tk_client_report_state('grace-community')), 'real client, switch on: rows');
select pg_temp.as_user(null);
select pg_temp.expect_err($$select * from public.tk_client_report_state('grace-community')$$, 'tk_forbidden', 'no JWT: refused');
reset role;
select set_config('mgb.tk_owner_override', 'on', true);
delete from tk_settings where key = 'month_rhythm_enabled';
select set_config('mgb.tk_owner_override', '', true);

-- 4. Audit trail -----------------------------------------------------------
select pg_temp.ok((select count(*) = 3 from tk_report_state_audit where client_id in ('grace-community', 'basic-test') and changed_at >= now()),
  'one audit row per write');
select pg_temp.ok((select bool_and(changed_by <> 'system') from tk_report_state_audit where changed_at >= now()), 'audit names the staff member');

-- 5. Row 8 done -> full ------------------------------------------------------
select set_config('mgb.tk_generate', 'on', true);
insert into staff_reminders (staff_email, assignee_email, text, client_id, due_date, source, template_id, period_kind, period_start)
select pg_temp.ctx('bk'), pg_temp.ctx('bk'), 'Self-test row 8', 'basic-test', date '2026-10-24', 'template', t.id, 'month', date '2026-09-01'
  from task_templates t where t.source_ref = 'month_rhythm:8_follow_up';
insert into staff_reminders (staff_email, assignee_email, text, client_id, due_date, source, template_id, period_kind, period_start)
select pg_temp.ctx('bk'), pg_temp.ctx('bk'), 'Self-test row 7', 'basic-test', date '2026-10-24', 'template', t.id, 'month', date '2026-09-01'
  from task_templates t where t.source_ref = 'month_rhythm:7_follow_up';
select set_config('mgb.tk_generate', '', true);
insert into t_ctx select 'r8', id::text from staff_reminders where text = 'Self-test row 8' and client_id = 'basic-test';
insert into t_ctx select 'r7', id::text from staff_reminders where text = 'Self-test row 7' and client_id = 'basic-test';
update staff_reminders set status = 'done' where id = pg_temp.ctx('r7')::uuid;
select pg_temp.ok((select state = 'preliminary' from tk_report_state where client_id = 'basic-test' and period = '2026-09-01'),
  'row 7 done leaves the state alone');
select set_config('mgb.tk_rhythm', 'on', true);
update staff_reminders set status = 'done' where id = pg_temp.ctx('r8')::uuid;
select pg_temp.ok((select state = 'preliminary' from tk_report_state where client_id = 'basic-test' and period = '2026-09-01'),
  'auto-complete of row 8 does not claim full');
select set_config('mgb.tk_rhythm', '', true);
update staff_reminders set status = 'todo' where id = pg_temp.ctx('r8')::uuid;
set local role authenticated;
select pg_temp.as_user(pg_temp.ctx('bk'));
update staff_reminders set status = 'done' where id = pg_temp.ctx('r8')::uuid;
reset role;
select pg_temp.ok((select state = 'full' and missing = '[]'::jsonb and set_by = pg_temp.ctx('bk')
                     from tk_report_state where client_id = 'basic-test' and period = '2026-09-01'),
  'row 8 done by staff sets full');
select pg_temp.ok((select status = 'done' from staff_reminders where id = pg_temp.ctx('r8')::uuid), 'row 8 is done');

select 'all ok' as result;
rollback;
