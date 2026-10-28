-- =====================================================================
-- Self-test for tasks-p2-12-parked-minors.sql. Run it whole; it ends in
-- ROLLBACK, so nothing it writes is kept and no email is sent (outbox rows
-- vanish with the rollback). Tasks and periods live on the test clients
-- (basic-test, grace-community). People are picked at run time. The pilot
-- "all" row in section 4 exists only inside this transaction; no other
-- session ever sees it. A failed check raises and stops the run.
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
create or replace function pg_temp.d(p_days int) returns date language sql as $$
  select (now() at time zone 'America/Chicago')::date + p_days;
$$;
create or replace function pg_temp.who(p_key text) returns text language sql as $$
  select lower(coalesce(assignee_email, staff_email)) from staff_reminders where id = pg_temp.id(p_key);
$$;
create or replace function pg_temp.runs(p_key text) returns int language sql as $$
  select count(*)::int from tk_ooo_runs where time_off_id = pg_temp.id(p_key);
$$;

insert into t_ctx select 'bk1', lower(email) from staff where active and role = 'bookkeeper' order by email limit 1;
insert into t_ctx select 'bk2', lower(email) from staff where active and role = 'bookkeeper' order by email offset 1 limit 1;
insert into t_ctx select 'bk3', lower(email) from staff where active and role = 'bookkeeper' order by email offset 2 limit 1;
insert into t_ctx select 'a1', lower(email) from staff where active and role = 'admin' order by email limit 1;
select pg_temp.ok(pg_temp.ctx('bk1') is not null and pg_temp.ctx('bk2') is not null and pg_temp.ctx('bk3') is not null
                  and pg_temp.ctx('a1') is not null, 'test people found');

-- basic-test: bk1 owns it, bk2 is backup with access. grace-community: bk2 is
-- backup with no access (checked, not forced).
update clients set assigned_bookkeeper_email = pg_temp.ctx('bk1') where id = 'basic-test';
insert into client_profile (client_id, backup_bookkeeper_email) values ('basic-test', pg_temp.ctx('bk2'))
  on conflict (client_id) do update set backup_bookkeeper_email = excluded.backup_bookkeeper_email;
insert into staff_client_access (staff_email, client_id)
select x.e, x.c from (values (pg_temp.ctx('bk1'), 'basic-test'), (pg_temp.ctx('bk2'), 'basic-test')) x(e, c)
 where not exists (select 1 from staff_client_access a where lower(a.staff_email) = x.e and a.client_id = x.c);

with w as (insert into staff_time_off (staff_email, starts_on, ends_on, note)
           values (pg_temp.ctx('bk1'), pg_temp.d(0), pg_temp.d(6), 'P2-12 test') returning id)
insert into t_ctx select 'W1', id::text from w;

insert into staff_reminders (staff_email, assignee_email, text, client_id, due_date, kind, visibility)
values (pg_temp.ctx('bk1'), pg_temp.ctx('bk1'), 'P2-12 test T1', 'basic-test', pg_temp.d(2), 'task', 'shared');
insert into t_ctx select 'T1', id::text from staff_reminders where text = 'P2-12 test T1';

-- 1. Re-apply clears a stale in_review mark --------------------------------
select pg_temp.as_user(pg_temp.ctx('bk1'));
set local role authenticated;
select public.tk_apply_ooo(pg_temp.id('W1'), false);
reset role;
select pg_temp.ok(pg_temp.who('T1') = pg_temp.ctx('bk2'), '1: first hand-off moved T1 to the backup');

select set_config('mgb.tk_migrate', 'on', true);
update staff_reminders set status = 'ready_for_review', review_required = true, reviewer_email = pg_temp.ctx('a1')
 where id = pg_temp.id('T1');
select set_config('mgb.tk_migrate', '', true);

select pg_temp.as_user(pg_temp.ctx('bk1'));
set local role authenticated;
select public.tk_return_ooo(pg_temp.id('W1'), false);
reset role;
select pg_temp.ok(pg_temp.who('T1') = pg_temp.ctx('bk2'), '1: Hand back now left T1 (in review) with the backup');
select pg_temp.ok((select return_skipped_reason from tk_ooo_reassignments
                    where time_off_id = pg_temp.id('W1') and task_id = pg_temp.id('T1') and returned_at is null) = 'in_review',
                  '1: the open ledger row is marked in_review');

-- T2: a task a shortened time off left outside the dates, still in review
-- with the backup (open row marked in_review, due after the last day off).
insert into staff_reminders (staff_email, assignee_email, text, client_id, due_date, kind, visibility)
values (pg_temp.ctx('bk1'), pg_temp.ctx('bk2'), 'P2-12 test T2', 'basic-test', pg_temp.d(10), 'task', 'shared');
insert into t_ctx select 'T2', id::text from staff_reminders where text = 'P2-12 test T2';
insert into tk_ooo_reassignments (time_off_id, task_id, client_id, from_email, to_email, reason, reassigned_by, return_skipped_reason)
values (pg_temp.id('W1'), pg_temp.id('T2'), 'basic-test', pg_temp.ctx('bk1'), pg_temp.ctx('bk2'), 'backup', 'test', 'in_review');

select pg_temp.as_user(pg_temp.ctx('bk1'));
set local role authenticated;
select public.tk_apply_ooo(pg_temp.id('W1'), false);
reset role;
select pg_temp.ok((select return_skipped_reason from tk_ooo_reassignments
                    where time_off_id = pg_temp.id('W1') and task_id = pg_temp.id('T1') and returned_at is null) is null,
                  '1: re-apply cleared the in_review mark (row still open)');
select pg_temp.ok((select return_skipped_reason from tk_ooo_reassignments
                    where time_off_id = pg_temp.id('W1') and task_id = pg_temp.id('T2')) = 'in_review',
                  '1: re-apply keeps the mark on a task due outside the current dates');
update tk_ooo_reassignments set returned_at = now(), return_skipped_reason = 'closed'   -- close the test row so later checks ignore it
 where time_off_id = pg_temp.id('W1') and task_id = pg_temp.id('T2');
select pg_temp.ok((select count(*) from tk_ooo_runs
                    where time_off_id = pg_temp.id('W1') and action = 'apply' and (detail ->> 'kept_in_review')::int = 1) = 1
                  and (select count(*) from tk_ooo_runs where time_off_id = pg_temp.id('W1') and action = 'apply') = 2,
                  '1: two manual apply runs logged; only the re-apply notes kept_in_review = 1');

select set_config('mgb.tk_migrate', 'on', true);
update staff_reminders set status = 'in_progress' where id = pg_temp.id('T1');
select set_config('mgb.tk_migrate', '', true);
insert into t_ctx values ('runs_before_cron', pg_temp.runs('W1')::text);
select pg_temp.as_user(null);
select set_config('mgb.tk_ooo_waiting_only', 'on', true);
select public.tk__ooo_return(pg_temp.id('W1'), null, null, false, 'cron');
select set_config('mgb.tk_ooo_waiting_only', '', true);
select pg_temp.ok(pg_temp.who('T1') = pg_temp.ctx('bk2'), '1: after review ends the daily retry keeps T1 with the backup');
select pg_temp.ok(pg_temp.runs('W1') = pg_temp.ctx('runs_before_cron')::int, '6: that empty cron run logged nothing');

-- 1 (cron keeps the mark): a cron apply does not clear it.
update tk_ooo_reassignments set return_skipped_reason = 'in_review'
 where time_off_id = pg_temp.id('W1') and task_id = pg_temp.id('T1');
select public.tk__ooo_apply(pg_temp.id('W1'), false, '{}'::jsonb, 'cron', false);
select pg_temp.ok((select return_skipped_reason from tk_ooo_reassignments
                    where time_off_id = pg_temp.id('W1') and task_id = pg_temp.id('T1')) = 'in_review',
                  '1: a cron apply leaves the in_review mark (Hand back now still sticks)');
select pg_temp.ok(pg_temp.runs('W1') = pg_temp.ctx('runs_before_cron')::int, '6: a cron apply with nothing moved logs nothing');

-- 3. A manual return with nothing to hand back is logged -------------------
with w as (insert into staff_time_off (staff_email, starts_on, ends_on, note)
           values (pg_temp.ctx('bk3'), pg_temp.d(30), pg_temp.d(32), 'P2-12 test') returning id)
insert into t_ctx select 'W2', id::text from w;
select pg_temp.as_user(pg_temp.ctx('a1'));
set local role authenticated;
select public.tk_return_ooo(pg_temp.id('W2'), false);
reset role;
select pg_temp.ok((select count(*) from tk_ooo_runs where time_off_id = pg_temp.id('W2')
                     and action = 'return' and mode = 'manual' and moved = 0 and skipped = 0) = 1,
                  '3: manual return with nothing to hand back wrote one run row');
select pg_temp.as_user(null);
select public.tk__ooo_return(pg_temp.id('W2'), null, null, false, 'cron');
select pg_temp.ok(pg_temp.runs('W2') = 1, '6: a cron return with nothing to do logs nothing');

-- 2. Only this time off's denial blocks a new access request ---------------
select pg_temp.ok(not public.tk_staff_has_client(pg_temp.ctx('bk2'), 'grace-community'),
                  '2 setup: bk2 cannot open grace-community');
select pg_temp.ok(not exists (select 1 from staff_client_access_grants g where g.client_id = 'grace-community'
                                and lower(g.staff_email) = pg_temp.ctx('bk2') and g.status in ('pending', 'approved')),
                  '2 setup: no pending or approved grant for bk2 there');
insert into staff_client_access_grants (client_id, staff_email, staff_name, reason, duration_days, status, requested_at)
values ('grace-community', pg_temp.ctx('bk2'), null, 'P2-12 test: some other request', 7, 'denied', now());
select public.tk__ooo_request_access((select o from staff_time_off o where o.id = pg_temp.id('W1')),
                                     pg_temp.ctx('bk2'), 'grace-community');
select pg_temp.ok((select count(*) from staff_client_access_grants g where g.client_id = 'grace-community'
                     and lower(g.staff_email) = pg_temp.ctx('bk2') and g.status = 'pending'
                     and g.reason like 'Covering for %(time off %') = 1,
                  '2: a denial for something else does not block the coverage request');
update staff_client_access_grants set status = 'denied'
 where client_id = 'grace-community' and lower(staff_email) = pg_temp.ctx('bk2') and status = 'pending'
   and reason like 'Covering for %(time off %';
insert into t_ctx select 'g_before', count(*)::text from staff_client_access_grants
 where client_id = 'grace-community' and lower(staff_email) = pg_temp.ctx('bk2');
select public.tk__ooo_request_access((select o from staff_time_off o where o.id = pg_temp.id('W1')),
                                     pg_temp.ctx('bk2'), 'grace-community');
select pg_temp.ok((select count(*) from staff_client_access_grants
                    where client_id = 'grace-community' and lower(staff_email) = pg_temp.ctx('bk2'))::text = pg_temp.ctx('g_before'),
                  '2: a denial of this time off''s request is not filed again');

-- 4. Internal client is never live ----------------------------------------
select set_config('mgb.tk_owner_override', 'on', true);
update client_email_settings set enabled = true, client_request_enabled = true;
insert into tk_settings (key, value) values ('client_request_pilot', '"all"'::jsonb)
  on conflict (key) do update set value = excluded.value;
select set_config('mgb.tk_owner_override', '', true);
insert into t_ctx select 'real', id from clients
 where not coalesce(test_only, false) and not coalesce(is_internal, false) order by id limit 1;
select pg_temp.ok(public.tk__request_send_mode(pg_temp.ctx('real')) = 'live', '4 control: a real client is live with pilot "all"');
select pg_temp.ok((select count(*) from clients where is_internal) >= 1, '4 setup: an internal client exists');
select pg_temp.ok(public.tk__request_send_mode(c.id) = 'dry_run', '4: internal client ' || c.id || ' is a dry run with pilot "all"')
  from clients c where c.is_internal;
select pg_temp.ok(public.tk__request_send_mode('basic-test') = 'test', '4: a test client still returns test');

-- 5. Period back to review: no duplicate notices --------------------------
select pg_temp.ok(not exists (select 1 from month_close where client_id = 'basic-test' and period = date '2019-01-01'),
                  '5 setup: no 2019-01 period on basic-test');
select pg_temp.as_user(pg_temp.ctx('bk1'));
insert into month_close (client_id, period, period_kind, status) values ('basic-test', date '2019-01-01', 'month', 'review');
insert into t_ctx select 'n1', count(*)::text from notification_outbox
 where kind = 'staff_task_review_ready' and ref_id = 'basic-test|month|2019-01-01';
select pg_temp.ok(pg_temp.ctx('n1')::int = (select count(*) from staff s where s.active and s.role = 'admin'),
                  '5: first ready notifies each active admin once');
update month_close set status = 'in_progress' where client_id = 'basic-test' and period = date '2019-01-01' and period_kind = 'month';
update month_close set status = 'review' where client_id = 'basic-test' and period = date '2019-01-01' and period_kind = 'month';
select pg_temp.ok((select count(*) from notification_outbox where kind = 'staff_task_review_ready'
                     and ref_id = 'basic-test|month|2019-01-01')::text = pg_temp.ctx('n1'),
                  '5: back to review the same day sends no duplicate');
select set_config('mgb.tk_signoff', 'on', true);
update month_close set status = 'in_progress', reopened_at = now() + interval '1 second', reopened_by = pg_temp.ctx('a1'),
       reopened_reason = 'P2-12 test'
 where client_id = 'basic-test' and period = date '2019-01-01' and period_kind = 'month';
select set_config('mgb.tk_signoff', 'off', true);
update month_close set status = 'review' where client_id = 'basic-test' and period = date '2019-01-01' and period_kind = 'month';
select pg_temp.ok((select count(*) from notification_outbox where kind = 'staff_task_review_ready'
                     and ref_id = 'basic-test|month|2019-01-01') = 2 * pg_temp.ctx('n1')::int,
                  '5: after an admin reopen, the next ready notifies again');
-- An admin moves it out of review (a send-back); the next ready notifies.
select pg_temp.as_user(pg_temp.ctx('a1'));
update month_close set status = 'in_progress' where client_id = 'basic-test' and period = date '2019-01-01' and period_kind = 'month';
select pg_temp.as_user(pg_temp.ctx('bk1'));
update month_close set status = 'review' where client_id = 'basic-test' and period = date '2019-01-01' and period_kind = 'month';
select pg_temp.ok((select count(*) from notification_outbox where kind = 'staff_task_review_ready'
                     and ref_id = 'basic-test|month|2019-01-01') = 3 * pg_temp.ctx('n1')::int,
                  '5: after an admin sends it back from review, the next ready notifies again');
select pg_temp.as_user(null);

-- 6. A cron return repeating the same error logs once ----------------------
-- Last on purpose: the test trigger locks staff_reminders writes until the
-- rollback a moment later.
with w as (insert into staff_time_off (staff_email, starts_on, ends_on, note)
           values (pg_temp.ctx('bk3'), pg_temp.d(-5), pg_temp.d(-2), 'P2-12 test') returning id)
insert into t_ctx select 'W3', id::text from w;
insert into staff_reminders (staff_email, assignee_email, text, client_id, due_date, kind, visibility)
values (pg_temp.ctx('bk3'), pg_temp.ctx('bk2'), 'P2-12 test T3', 'basic-test', pg_temp.d(-3), 'task', 'shared');
insert into t_ctx select 'T3', id::text from staff_reminders where text = 'P2-12 test T3';
insert into tk_ooo_reassignments (time_off_id, task_id, client_id, from_email, to_email, reason, reassigned_by)
values (pg_temp.id('W3'), pg_temp.id('T3'), 'basic-test', pg_temp.ctx('bk3'), pg_temp.ctx('bk2'), 'backup', 'test');
create function public.tk__p212_selftest_fail() returns trigger language plpgsql as $$
begin
  if new.id = (select v::uuid from t_ctx where k = 'T3')
     and coalesce(current_setting('mgb.tk_ooo_meta', true), '') like '%"back"%' then
    raise exception 'P2-12 test failure';
  end if;
  return new;
end $$;
create trigger tk__p212_selftest_fail before update on staff_reminders
  for each row execute function public.tk__p212_selftest_fail();
select public.tk__ooo_return(pg_temp.id('W3'), null, null, false, 'cron');
select pg_temp.ok(pg_temp.runs('W3') = 1, '6: first cron return with an error logs one row');
select pg_temp.ok(pg_temp.who('T3') = pg_temp.ctx('bk2'), '6 setup: the failed hand-back left T3 with the backup');
update tk_ooo_runs set created_at = now() - interval '1 minute' where time_off_id = pg_temp.id('W3');
select public.tk__ooo_return(pg_temp.id('W3'), null, null, false, 'cron');
select pg_temp.ok(pg_temp.runs('W3') = 1, '6: the same error the next day logs nothing new');
select set_config('mgb.tk_migrate', 'on', true);
insert into staff_reminders (staff_email, assignee_email, text, client_id, due_date, kind, visibility, status, review_required, reviewer_email)
values (pg_temp.ctx('bk3'), pg_temp.ctx('bk2'), 'P2-12 test T4', 'basic-test', pg_temp.d(-3), 'task', 'shared', 'ready_for_review', true, pg_temp.ctx('a1'));
select set_config('mgb.tk_migrate', '', true);
insert into t_ctx select 'T4', id::text from staff_reminders where text = 'P2-12 test T4';
insert into tk_ooo_reassignments (time_off_id, task_id, client_id, from_email, to_email, reason, reassigned_by)
values (pg_temp.id('W3'), pg_temp.id('T4'), 'basic-test', pg_temp.ctx('bk3'), pg_temp.ctx('bk2'), 'backup', 'test');
select public.tk__ooo_return(pg_temp.id('W3'), null, null, false, 'cron');
select pg_temp.ok(pg_temp.runs('W3') = 2, '6: a changed set (error plus a task in review) logs a new row');
select public.tk__ooo_return(pg_temp.id('W3'), null, null, false, 'cron');
select pg_temp.ok(pg_temp.runs('W3') = 2, '6: and repeating that set logs nothing new');

select pg_temp.ok(true, 'ALL P2-12 CHECKS PASSED (rolling back)');
rollback;
