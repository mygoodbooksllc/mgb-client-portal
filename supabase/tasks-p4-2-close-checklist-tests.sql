-- =====================================================================
-- Self-test for tasks-p4-2-close-checklist.sql (Close checklist linked to tasks).
--
-- Run it whole after the migration; it ends in ROLLBACK, so nothing it
-- writes is kept and no email is sent. It never touches standard_set_live.
-- The roster (cron) run uses basic-test, turned into a roster client only
-- inside this transaction; no real client is opted in. People are picked at
-- run time; no names or emails live in this file. A failed check raises.
-- =====================================================================
begin;

create temp table t_ctx (k text primary key, v text) on commit drop;
grant select on t_ctx to authenticated;   -- read by a step that runs as authenticated (13b)
create or replace function pg_temp.ctx(p_k text) returns text language sql as $$ select v from t_ctx where k = p_k $$;
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
-- the live task for basic-test, a month and a key
create or replace function pg_temp.task(p_period text, p_key text) returns uuid language sql as $$
  select id from staff_reminders where client_id = 'basic-test' and close_key = p_key and deleted_at is null
     and period_start = to_date(p_period || '-01', 'YYYY-MM-DD') limit 1;
$$;
create or replace function pg_temp.item(p_period text, p_key text) returns boolean language sql as $$
  select coalesce((select done from client_close_items where client_id = 'basic-test' and period = p_period and item_key = p_key), false);
$$;
create or replace function pg_temp.tick(p_who text, p_period text, p_key text, p_done boolean) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform pg_temp.as_user(pg_temp.ctx(p_who));
  v := public.tk_close_tick('basic-test', p_period, p_key, p_done);
  perform pg_temp.as_user(null);
  return v;
end $$;
create or replace function pg_temp.set_tasks(p_period text) returns bigint language sql as $$
  select count(*) from staff_reminders r join task_templates t on t.id = r.template_id
   where r.client_id = 'basic-test' and t.template_set_id is not null
     and r.period_start = to_date(p_period || '-01', 'YYYY-MM-DD') and r.deleted_at is null;
$$;

-- 0. Shape -------------------------------------------------------------------
select pg_temp.ok(public.tk_schema_version() >= 11, 'schema version is 11 or later');
select pg_temp.ok((select count(*) = 5 from task_templates t join tk_template_sets s on s.id = t.template_set_id and s.is_standard
                    where t.status = 'active' and t.active and t.close_key in ('bank_feed','bank_rec','card_rec','entries','review')),
                  'five linked standard-set members are on');
select pg_temp.ok((select bool_and(t.status = 'draft') from task_templates t join tk_template_sets s on s.id = t.template_set_id and s.is_standard
                    where t.close_key = 'sent'), '"sent" stays a draft');
select pg_temp.ok(coalesce(public.tk__jsonb_bool((select value from tk_settings where key = 'standard_set_live')), false) = false,
                  'standard_set_live is still off');
select pg_temp.ok((select count(*) = 0 from tk_client_close_optin o join clients c on c.id = o.client_id
                    where o.disabled_at is null and public.is_roster_client(c)), 'no real client is opted in');
select pg_temp.ok(not has_function_privilege('anon', 'public.tk_close_tick(text,text,text,boolean)', 'execute')
              and not has_function_privilege('anon', 'public.tk_set_close_optin(text,boolean,boolean)', 'execute')
              and not has_function_privilege('anon', 'public.tk_close_optin_status(text)', 'execute')
              and not has_function_privilege('authenticated', 'public.tk__close_sync(uuid)', 'execute')
              and not has_function_privilege('authenticated', 'public.tk__close_optin_floor(text)', 'execute')
              and not has_function_privilege('authenticated', 'public.tk__is_close_task_key(text)', 'execute'),
                  'no anon execute; internal helpers not callable');
select pg_temp.ok(not has_table_privilege('authenticated', 'public.tk_client_close_optin', 'insert')
              and not has_table_privilege('authenticated', 'public.tk_client_close_optin', 'update')
              and not has_table_privilege('anon', 'public.tk_client_close_optin', 'select'),
                  'opt-in table: authenticated reads only, anon nothing');
select pg_temp.ok((select prosecdef and proconfig::text like '%search_path=public%' from pg_proc
                    where oid = 'public.tk_close_tick(text,text,text,boolean)'::regprocedure), 'tk_close_tick is definer with search_path');

-- People: a1 = basic-test's account manager (an admin), a2 = another admin, bk = a bookkeeper.
insert into t_ctx select 'a1', lower(c.account_manager_email) from clients c where c.id = 'basic-test';
insert into t_ctx select 'a2', lower(s.email) from staff s
 where s.active and s.role = 'admin' and lower(s.email) <> pg_temp.ctx('a1') order by s.email limit 1;
insert into t_ctx select 'bk', lower(s.email) from staff s where s.active and s.role = 'bookkeeper' order by s.email limit 1;
select pg_temp.ok(public.tk__is_active_admin(pg_temp.ctx('a1')) and pg_temp.ctx('a2') is not null and pg_temp.ctx('bk') is not null,
                  'test people found');

-- Setup (inside this transaction only) ----------------------------------------
insert into staff_client_access (staff_email, client_id)
select pg_temp.ctx('bk'), 'basic-test'
 where not exists (select 1 from staff_client_access where lower(staff_email) = pg_temp.ctx('bk') and client_id = 'basic-test');
update clients set assigned_bookkeeper_email = pg_temp.ctx('bk') where id = 'basic-test';
update client_profile set reviewer_email = null where client_id = 'basic-test';
update clients set test_only = false, is_internal = false where id = 'basic-test';   -- a roster client for the cron run
update tk_settings set value = to_jsonb('2026-06-01'::text) where key = 'on_time_since';   -- so a wrong floor would show as missed
update task_templates set activated_at = timestamptz '2026-09-01 12:00-05'
 where close_key in ('bank_feed','bank_rec','card_rec','entries','review')
   and template_set_id in (select id from tk_template_sets where is_standard);
delete from tk_client_close_optin where client_id = 'basic-test';
-- review fix (major 1): even with the "sent" template turned on, the opt-in never issues it
update task_templates set status = 'active', active = true, activated_at = timestamptz '2026-09-01 12:00-05'
 where close_key = 'sent' and template_set_id in (select id from tk_template_sets where is_standard);
select pg_temp.ok(public.tk__is_close_task_key('bank_feed') and not public.tk__is_close_task_key('sent')
              and not public.tk__is_close_task_key(null), 'the five-key helper');
select pg_temp.ok(public.is_roster_client((select c from clients c where c.id = 'basic-test')), 'basic-test is a roster client in this transaction');

-- 1. Setter: plain bookkeeper refused; account manager / admin allowed ------------
select pg_temp.as_user(pg_temp.ctx('bk'));
select pg_temp.expect_err($$select public.tk_set_close_optin('basic-test', true)$$, 'tk_forbidden', 'setter rejects a plain bookkeeper');
select pg_temp.ok((public.tk_close_optin_status('basic-test') ->> 'can_edit')::boolean = false, 'status: bookkeeper sees read-only');
select pg_temp.as_user(null);
select pg_temp.expect_err($$select public.tk_close_tick('basic-test', '2026-11', 'bank_feed', true)$$, 'tk_forbidden', 'tick needs a signed-in staff member');

select pg_temp.as_user(pg_temp.ctx('a1'));
select pg_temp.ok((public.tk_set_close_optin('basic-test', true) ->> 'enabled')::boolean, 'account manager turns it on');
select pg_temp.ok((public.tk_close_optin_status('basic-test') ->> 'can_edit')::boolean, 'status: account manager can edit');
select pg_temp.as_user(null);
update tk_client_close_optin set enabled_at = timestamptz '2026-10-16 12:00-05' where client_id = 'basic-test';
select pg_temp.ok(public.tk__close_optin_floor('basic-test') = date '2026-11-01', 'floor without "also this month" is next month');
-- A close month's tasks fall due early the next month: the November close is due in December.

-- 2. Cron run: only the opted-in client gets set tasks; no earlier missed rows ---------
insert into t_ctx select 'set_other_before', count(*)::text from staff_reminders r join task_templates t on t.id = r.template_id
 where t.template_set_id is not null and r.client_id <> 'basic-test';
insert into t_ctx select 'r1', public.tk__generate(date '2026-12-12', false, null, null, 'cron')::text;
select pg_temp.ok(pg_temp.set_tasks('2026-11') = 5, 'cron run: basic-test gets the 5 November close tasks');
select pg_temp.ok((select count(*) = 5 and count(distinct close_key) = 5 and bool_and(close_key in ('bank_feed','bank_rec','card_rec','entries','review'))
                     from staff_reminders where client_id = 'basic-test' and period_start = date '2026-11-01' and close_key is not null and deleted_at is null),
                  'each November task carries its close_key; no "sent" task');
select pg_temp.ok(pg_temp.set_tasks('2026-10') = 0, 'opt-in mid-month: no October close tasks');
select pg_temp.ok((select count(*) = 0 from staff_reminders r join task_templates t on t.id = r.template_id
                    where r.client_id = 'basic-test' and t.close_key = 'sent'), 'opt-in never issues "sent", even with its template on');
select pg_temp.ok((select count(*) = 0 from tk_generate_missed m join task_templates t on t.id = m.template_id
                    where m.client_id = 'basic-test' and t.template_set_id is not null), 'the floor writes no earlier missed rows');
select pg_temp.ok((select count(*)::text from staff_reminders r join task_templates t on t.id = r.template_id
                    where t.template_set_id is not null and r.client_id <> 'basic-test') = pg_temp.ctx('set_other_before'),
                  'cron run: no other client gets set tasks');
select pg_temp.ok((select count(*) = 5 from tk_tasks where client_id = 'basic-test' and close_key is not null), 'tk_tasks shows close_key');

-- 3. Idempotent ---------------------------------------------------------------
insert into t_ctx select 'r2', public.tk__generate(date '2026-12-12', false, null, null, 'cron')::text;
select pg_temp.ok(pg_temp.set_tasks('2026-11') = 5 and (pg_temp.ctx('r2')::jsonb ->> 'created')::int = 0, 're-run creates nothing');
insert into t_ctx select 'r3', public.tk__generate(date '2026-11-12', false, null, null, 'cron')::text;
select pg_temp.ok(pg_temp.set_tasks('2026-10') = 0, 'run while the October close is due, "also this month" off: still no October tasks');

-- 3b. Already on: "also this month" can still be added, never silently dropped ----------
select pg_temp.as_user(pg_temp.ctx('a1'));
select public.tk_set_close_optin('basic-test', true, true);
select pg_temp.ok((select include_current_month and disabled_at is null from tk_client_close_optin where client_id = 'basic-test'),
                  'already on: "also this month" is honored');
select public.tk_set_close_optin('basic-test', true, false);
select pg_temp.ok((select include_current_month from tk_client_close_optin where client_id = 'basic-test'),
                  'already on: turning it on again without the box keeps "also this month"');
select pg_temp.as_user(null);

-- 4. "Also this month" ------------------------------------------------------------
select pg_temp.as_user(pg_temp.ctx('a1'));
select public.tk_set_close_optin('basic-test', false);
select pg_temp.ok((select disabled_at is not null from tk_client_close_optin where client_id = 'basic-test'), 'turn off is soft (row kept)');
select pg_temp.ok(pg_temp.set_tasks('2026-11') = 5, 'turning off keeps existing tasks');
select public.tk_set_close_optin('basic-test', true, true);
select pg_temp.as_user(null);
select pg_temp.ok((select disabled_at is null and include_current_month from tk_client_close_optin where client_id = 'basic-test'),
                  'turning back on clears the off stamp and keeps "also this month"');
update tk_client_close_optin set enabled_at = timestamptz '2026-10-16 12:00-05' where client_id = 'basic-test';
select pg_temp.ok(public.tk__close_optin_floor('basic-test') = date '2026-10-01', 'floor with "also this month" is this month');
-- review fix (major 2): October's steps were ticked before any task existed
insert into client_close_items (client_id, period, item_key, done)
select 'basic-test', '2026-10', k, true from unnest(array['bank_feed','bank_rec','card_rec','entries','review']) k
on conflict (client_id, period, item_key) do update set done = true;
select public.tk__generate(date '2026-11-12', false, null, null, 'cron');
select pg_temp.ok(pg_temp.set_tasks('2026-10') >= 3, '"also this month": October close tasks are created');
select pg_temp.ok((select count(*) filter (where status <> 'done') = 0 and count(*) >= 3
                     from staff_reminders where client_id = 'basic-test' and period_start = date '2026-10-01'
                      and close_key is not null and deleted_at is null), 'a task made for an already-ticked step starts done');
select pg_temp.ok((select count(*) >= 3 from tk_activity a join staff_reminders r on r.id = a.task_id
                    where r.client_id = 'basic-test' and r.period_start = date '2026-10-01' and a.kind = 'close_checklist'
                      and (a.meta ->> 'adopted')::boolean), 'adopting a ticked step is logged');
select pg_temp.ok((select bool_and(done) from client_close_items where client_id = 'basic-test' and period = '2026-10'), 'October steps stay ticked');
select pg_temp.ok(coalesce(current_setting('mgb.tk_close', true), '') = '', 'flag reset after adopting');
select pg_temp.ok((select count(*) = 0 from tk_generate_missed m join task_templates t on t.id = m.template_id
                    where m.client_id = 'basic-test' and t.template_set_id is not null and m.period_start < date '2026-10-01'),
                  '"also this month": nothing before October is missed');

-- 5. Duplicate close task -> skipped -----------------------------------------------
with x as (
  insert into task_templates (title, cadence, due_offset_days, due_rule, lead_days, client_ids, plan_tiers, priority,
                              status, active, activated_at, close_key)
  values ('P4-2 dup bank feed', 'monthly', 10, '{"type":"offset","days":5}', 7, array['basic-test'], '{}', 'normal',
          'draft', true, timestamptz '2026-09-01 12:00-05', 'bank_feed')
  returning id)
insert into t_ctx select 'dup', id::text from x;
insert into t_ctx select 'dup_r', public.tk__issue_period(t, public.tk__template_eff(t, 'basic-test'), 'basic-test', date '2026-11-01', false)::text
  from task_templates t where t.id = pg_temp.ctx('dup')::uuid;
select pg_temp.ok(pg_temp.ctx('dup_r')::jsonb ->> 'status' = 'skipped' and pg_temp.ctx('dup_r')::jsonb ->> 'reason' = 'close_dup',
                  'a duplicate close task returns skipped / close_dup');
select pg_temp.ok((select count(*) = 1 from staff_reminders where client_id = 'basic-test' and period_start = date '2026-11-01'
                    and close_key = 'bank_feed' and deleted_at is null), 'still one bank_feed task for November');
select pg_temp.ok((select count(*) = 0 from task_template_issued where template_id = pg_temp.ctx('dup')::uuid), 'the duplicate claimed no period');

-- 6. close_key is server-owned -----------------------------------------------------
update staff_reminders set close_key = 'entries' where id = pg_temp.task('2026-11', 'bank_feed');
select pg_temp.ok((select close_key = 'bank_feed' from staff_reminders where id = pg_temp.task('2026-11', 'bank_feed')), 'close_key cannot be rewritten');
insert into staff_reminders (staff_email, assignee_email, text, client_id, due_date, close_key)
values (pg_temp.ctx('bk'), pg_temp.ctx('bk'), 'P4-2 hand task', 'basic-test', date '2026-11-10', 'bank_rec');
select pg_temp.ok((select close_key is null from staff_reminders where text = 'P4-2 hand task'), 'a hand-made task never gets a close_key');
-- moving a close task to another month, or making it a subtask, unlinks it
insert into t_ctx select 'oct1', id::text from staff_reminders where client_id = 'basic-test' and period_start = date '2026-10-01'
   and close_key is not null and deleted_at is null order by close_key limit 1;
insert into t_ctx select 'oct2', id::text from staff_reminders where client_id = 'basic-test' and period_start = date '2026-10-01'
   and close_key is not null and deleted_at is null order by close_key offset 1 limit 1;
insert into t_ctx select 'oct3', id::text from staff_reminders where client_id = 'basic-test' and period_start = date '2026-10-01'
   and close_key is not null and deleted_at is null order by close_key offset 2 limit 1;
update staff_reminders set period_start = date '2026-09-01' where id = pg_temp.ctx('oct1')::uuid;
select pg_temp.ok((select close_key is null from staff_reminders where id = pg_temp.ctx('oct1')::uuid), 'moved to another month: close_key cleared');
update staff_reminders set parent_id = pg_temp.task('2026-11', 'bank_feed') where id = pg_temp.ctx('oct2')::uuid;
select pg_temp.ok((select close_key is null from staff_reminders where id = pg_temp.ctx('oct2')::uuid), 'made a subtask: close_key cleared');

-- 7. Tick a todo task -> done, and back ---------------------------------------------
insert into t_ctx values ('bf', pg_temp.task('2026-11', 'bank_feed')::text);
insert into t_ctx select 't1', pg_temp.tick('bk', '2026-11', 'bank_feed', true)::text;
select pg_temp.ok(pg_temp.ctx('t1')::jsonb ->> 'status' = 'done' and (pg_temp.ctx('t1')::jsonb ->> 'linked_task_id') = pg_temp.ctx('bf'),
                  'tick on todo: task done');
select pg_temp.ok((select status = 'done' from staff_reminders where id = pg_temp.ctx('bf')::uuid) and pg_temp.item('2026-11', 'bank_feed'),
                  'task done and checklist item ticked');
select pg_temp.ok((select count(*) = 1 from tk_activity where task_id = pg_temp.ctx('bf')::uuid and kind = 'close_checklist'
                    and meta ->> 'item_key' = 'bank_feed' and (meta ->> 'done')::boolean), 'activity: "Close checklist updated" logged');
select pg_temp.ok((select done_by = pg_temp.ctx('bk') from client_close_items where client_id = 'basic-test' and period = '2026-11' and item_key = 'bank_feed'),
                  'checklist item stamped with who ticked it');
select pg_temp.ok(coalesce(current_setting('mgb.tk_close', true), '') = '', 'mgb.tk_close flag is reset after the sync');
insert into t_ctx select 't2', pg_temp.tick('bk', '2026-11', 'bank_feed', true)::text;
select pg_temp.ok(pg_temp.ctx('t2')::jsonb ->> 'status' = 'unchanged' and (pg_temp.ctx('t2')::jsonb ->> 'done')::boolean, 'tick on done: no change');
insert into t_ctx select 't3', pg_temp.tick('bk', '2026-11', 'bank_feed', false)::text;
select pg_temp.ok(pg_temp.ctx('t3')::jsonb ->> 'status' = 'reopened'
              and (select status = 'todo' from staff_reminders where id = pg_temp.ctx('bf')::uuid)
              and not pg_temp.item('2026-11', 'bank_feed'), 'untick on done (not approved): task reopened, item unticked');
-- the mgb.tk_close flag never leaks out of a failed sync
alter table client_close_items add constraint p42_selftest_fail
  check (not (client_id = 'basic-test' and period = '2026-11' and item_key = 'bank_feed' and done)) not valid;
select pg_temp.expect_err($$select pg_temp.tick('bk', '2026-11', 'bank_feed', true)$$, 'p42_selftest_fail', 'a failing sync raises');
select pg_temp.as_user(null);
alter table client_close_items drop constraint p42_selftest_fail;
select pg_temp.ok(coalesce(current_setting('mgb.tk_close', true), '') = '', 'flag reset after a failed sync');
select pg_temp.ok((select status = 'todo' from staff_reminders where id = pg_temp.ctx('bf')::uuid), 'the failed tick left the task unchanged');
select pg_temp.as_user(pg_temp.ctx('bk'));
select pg_temp.expect_err($$select public.tk_close_tick('basic-test', '2026-11', 'sent', true)$$, 'tk_bad_input', 'tick refuses "sent" (it keeps its own writer)');
select pg_temp.expect_err($$select public.tk_close_tick('basic-test', '2026-13', 'bank_feed', true)$$, 'tk_bad_input', 'tick refuses a month 13');
select pg_temp.as_user(null);

-- 8. Review required -> ready_for_review, checklist stays unticked -----------------------
update staff_reminders set review_required = true where id in (pg_temp.task('2026-11', 'bank_rec'), pg_temp.task('2026-11', 'entries'));
insert into t_ctx values ('br', pg_temp.task('2026-11', 'bank_rec')::text);
insert into t_ctx select 't4', pg_temp.tick('bk', '2026-11', 'bank_rec', true)::text;
select pg_temp.ok(pg_temp.ctx('t4')::jsonb ->> 'status' = 'review' and pg_temp.ctx('t4')::jsonb ->> 'message' = 'Sent for review',
                  'tick on a review task: "Sent for review"');
select pg_temp.ok((select status = 'ready_for_review' from staff_reminders where id = pg_temp.ctx('br')::uuid)
              and not pg_temp.item('2026-11', 'bank_rec'), 'task in review; checklist stays unticked');
insert into t_ctx select 't5', pg_temp.tick('bk', '2026-11', 'bank_rec', true)::text;
select pg_temp.ok(pg_temp.ctx('t5')::jsonb ->> 'message' = 'In review'
              and (select status = 'ready_for_review' from staff_reminders where id = pg_temp.ctx('br')::uuid), 'tick on ready_for_review: message, no change');
insert into t_ctx select 't6', pg_temp.tick('a2', '2026-11', 'bank_rec', false)::text;
select pg_temp.ok(pg_temp.ctx('t6')::jsonb ->> 'status' = 'blocked'
              and (select status = 'ready_for_review' from staff_reminders where id = pg_temp.ctx('br')::uuid), 'untick in review by someone else: message only');
insert into t_ctx select 't7', pg_temp.tick('bk', '2026-11', 'bank_rec', false)::text;
select pg_temp.ok(pg_temp.ctx('t7')::jsonb ->> 'status' = 'withdrawn'
              and (select status = 'in_progress' from staff_reminders where id = pg_temp.ctx('br')::uuid), 'untick in review by the submitter: pulled back');

-- 9. Waiting on the client -> message, no change ----------------------------------
update staff_reminders set status = 'waiting_client' where id = pg_temp.task('2026-11', 'card_rec');
insert into t_ctx select 't8', pg_temp.tick('bk', '2026-11', 'card_rec', true)::text;
select pg_temp.ok(pg_temp.ctx('t8')::jsonb ->> 'message' = 'Waiting on the client. Close the request first.'
              and (select status = 'waiting_client' from staff_reminders where id = pg_temp.task('2026-11', 'card_rec'))
              and not pg_temp.item('2026-11', 'card_rec'), 'tick on waiting_client: message, no change');

-- 10. Approved task: only an admin reopens ---------------------------------------
insert into t_ctx values ('en', pg_temp.task('2026-11', 'entries')::text);
select pg_temp.tick('bk', '2026-11', 'entries', true);
select pg_temp.as_user(pg_temp.ctx('a1'));
select public.tk_approve(pg_temp.ctx('en')::uuid, null);
select pg_temp.as_user(null);
select pg_temp.ok((select status = 'done' and approved_at is not null from staff_reminders where id = pg_temp.ctx('en')::uuid)
              and pg_temp.item('2026-11', 'entries'), 'approval ticks the checklist item');
insert into t_ctx select 't9', pg_temp.tick('bk', '2026-11', 'entries', false)::text;
select pg_temp.ok(pg_temp.ctx('t9')::jsonb ->> 'message' = 'Ask an admin to reopen'
              and (select status = 'done' from staff_reminders where id = pg_temp.ctx('en')::uuid)
              and pg_temp.item('2026-11', 'entries'), 'untick an approved task as a non-admin: "Ask an admin", no change');
insert into t_ctx select 't10', pg_temp.tick('a2', '2026-11', 'entries', false)::text;
select pg_temp.ok(pg_temp.ctx('t10')::jsonb ->> 'status' = 'reopened' and not pg_temp.item('2026-11', 'entries'), 'an admin can reopen it');

-- 11. Status changes outside the checklist sync it ---------------------------------
select pg_temp.as_user(pg_temp.ctx('bk'));
select public.tk_set_status(pg_temp.task('2026-11', 'review'), 'done');
select pg_temp.as_user(null);
select pg_temp.ok(pg_temp.item('2026-11', 'review'), 'task done from the Tasks page ticks the item');
select pg_temp.ok(coalesce(current_setting('mgb.tk_close', true), '') = '', 'flag reset after the trigger');

-- 12. Direct writes: linked refused, unlinked and "sent" still direct ------------------
select pg_temp.as_user(pg_temp.ctx('bk'));
set local role authenticated;
select pg_temp.expect_err($$update client_close_items set done = false where client_id = 'basic-test' and period = '2026-11' and item_key = 'review'$$,
                          'tk_use_close_tick', 'direct update of a linked item is refused');
select pg_temp.expect_err($$insert into client_close_items (client_id, period, item_key, done) values ('basic-test', '2026-11', 'card_rec', true)$$,
                          'tk_use_close_tick', 'direct insert of a linked item is refused');
insert into client_close_items (client_id, period, item_key, done) values ('basic-test', '2026-11', 'sent', true)
on conflict (client_id, period, item_key) do update set done = excluded.done;
insert into client_close_items (client_id, period, item_key, done) values ('basic-test', '2026-09', 'bank_feed', true)
on conflict (client_id, period, item_key) do update set done = excluded.done;
reset role;
select pg_temp.as_user(null);
select pg_temp.ok(pg_temp.item('2026-11', 'sent') and pg_temp.item('2026-09', 'bank_feed'), '"sent" and a month with no task still write directly');
insert into t_ctx select 't11', pg_temp.tick('bk', '2026-12', 'bank_feed', true)::text;
select pg_temp.ok(pg_temp.ctx('t11')::jsonb ->> 'status' = 'saved' and pg_temp.item('2026-12', 'bank_feed'), 'tick with no linked task saves the item');

-- 13. A soft-deleted task unlinks ---------------------------------------------------
update staff_reminders set deleted_at = now(), deleted_by = 'self-test' where id = pg_temp.task('2026-11', 'review');
select pg_temp.as_user(pg_temp.ctx('bk'));
set local role authenticated;
update client_close_items set done = false where client_id = 'basic-test' and period = '2026-11' and item_key = 'review';
reset role;
select pg_temp.as_user(null);
select pg_temp.ok(not pg_temp.item('2026-11', 'review'), 'after a soft delete the item writes directly');

-- 13b. Project trash and restore: a trashed task unlinks, a restored one syncs back -----
insert into tk_projects (name, kind, client_id, color) values ('P4-2 self-test project', 'onboarding', 'basic-test', 'gray')
on conflict do nothing;
insert into t_ctx select 'proj', id::text from tk_projects where client_id = 'basic-test' and kind = 'onboarding' and trashed_at is null
 order by (name = 'P4-2 self-test project') desc, created_at limit 1;
update staff_reminders set project_id = pg_temp.ctx('proj')::uuid where id = pg_temp.ctx('oct3')::uuid;
select pg_temp.ok((select close_key is not null and status = 'done' from staff_reminders where id = pg_temp.ctx('oct3')::uuid),
                  'a close task moved into the client''s project keeps its link');
insert into t_ctx select 'oct3k', close_key from staff_reminders where id = pg_temp.ctx('oct3')::uuid;
select pg_temp.as_user(pg_temp.ctx('a1'));
select public.tk_project_trash(pg_temp.ctx('proj')::uuid);
select pg_temp.as_user(null);
select pg_temp.as_user(pg_temp.ctx('bk'));
set local role authenticated;
update client_close_items set done = false where client_id = 'basic-test' and period = '2026-10' and item_key = pg_temp.ctx('oct3k');
reset role;
select pg_temp.as_user(null);
select pg_temp.ok(not coalesce((select done from client_close_items where client_id = 'basic-test' and period = '2026-10'
                                   and item_key = pg_temp.ctx('oct3k')), true), 'trashed with its project: the step writes directly');
select pg_temp.as_user(pg_temp.ctx('a1'));
select public.tk_project_restore(pg_temp.ctx('proj')::uuid);
select pg_temp.as_user(null);
select pg_temp.ok((select done from client_close_items where client_id = 'basic-test' and period = '2026-10'
                    and item_key = pg_temp.ctx('oct3k')), 'restored: the step follows its done task again');

-- 14. Turned off: future months stop, existing tasks stay ----------------------------
select pg_temp.as_user(pg_temp.ctx('a1'));
select public.tk_set_close_optin('basic-test', false);
select pg_temp.as_user(null);
select public.tk__generate(date '2027-01-13', false, null, null, 'cron');
select pg_temp.ok(pg_temp.set_tasks('2026-12') = 0 and pg_temp.set_tasks('2026-11') = 4, 'off: no December tasks; November kept (one deleted above)');

-- 15. Overlap warning -------------------------------------------------------------
update task_templates set status = 'active', activated_at = now() where id = pg_temp.ctx('dup')::uuid;
select pg_temp.as_user(pg_temp.ctx('a1'));
select pg_temp.ok((select count(*) = 1 from jsonb_array_elements(public.tk_close_optin_status('basic-test') -> 'overlaps') e
                    where e ->> 'id' = pg_temp.ctx('dup')), 'status lists an overlapping recurring template');
select pg_temp.as_user(null);

-- 16. Real clients unchanged ------------------------------------------------------
update clients set test_only = true where id = 'basic-test';
select pg_temp.ok((select count(*) = 0
                     from (select public.tk__generate(null, true, null, 60, 'preview') r) x,
                          jsonb_array_elements(x.r -> 'would_create') e
                     join task_templates t on t.id = (e ->> 'template')::uuid
                    where t.template_set_id is not null or e ->> 'client' = 'basic-test'),
                  'roster dry run (no opted-in client): no set task and nothing for the test client would be created');

select 'P4-2 SELF-TEST PASSED' as result;
rollback;
