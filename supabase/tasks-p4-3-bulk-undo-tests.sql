-- =====================================================================
-- Self-test for tasks-p4-3-bulk-undo.sql (undo log + bulk actions).
--
-- Run it whole after the migration; it ends in ROLLBACK, so nothing it
-- writes is kept and no email is sent (queued rows never commit, so the
-- sender never sees them). Tasks live on the basic-test client or on no
-- client. People are picked at run time; no names or emails live in this
-- file. A failed check raises.
-- =====================================================================
begin;

create temp table t_ctx (k text primary key, v text) on commit drop;
create or replace function pg_temp.ctx(p_k text) returns text language sql as $$ select v from t_ctx where k = p_k $$;
create or replace function pg_temp.id(p_k text) returns uuid language sql as $$ select v::uuid from t_ctx where k = p_k $$;
create or replace function pg_temp.res(p_k text) returns jsonb language sql as $$ select v::jsonb from t_ctx where k = p_k $$;
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
-- the skip reason a result gave a task ('' when it was not skipped)
create or replace function pg_temp.reason(p_res text, p_task text) returns text language sql as $$
  select coalesce((select e ->> 'reason' from jsonb_array_elements(pg_temp.res(p_res) -> 'skipped') e
                    where e ->> 'id' = pg_temp.ctx(p_task)), '')
$$;
create or replace function pg_temp.has(p_res text, p_field text, p_task text) returns boolean language sql as $$
  select coalesce(pg_temp.res(p_res) -> p_field ? pg_temp.ctx(p_task), false)
$$;
create or replace function pg_temp.task(p_k text) returns staff_reminders language sql as $$
  select * from staff_reminders where id = pg_temp.id(p_k)
$$;
-- assignment emails queued for a task
create or replace function pg_temp.mails(p_k text) returns bigint language sql as $$
  select count(*) from notification_outbox where ref_id = pg_temp.ctx(p_k) and kind = 'staff_task_assigned'
$$;
-- a new task owned by the current JWT user
create or replace function pg_temp.mk(p_k text, p_owner text, p_client text, p_vis text, p_extra jsonb default '{}'::jsonb)
returns void language plpgsql as $$
declare v uuid;
begin
  perform pg_temp.as_user(pg_temp.ctx(p_owner));
  insert into staff_reminders (staff_email, text, client_id, visibility, review_required, recurrence, due_date)
  values (pg_temp.ctx(p_owner), 'P4-3 self-test ' || p_k, p_client, p_vis,
          coalesce((p_extra ->> 'review')::boolean, false), coalesce(p_extra ->> 'recurrence', 'none'),
          (p_extra ->> 'due')::date)
  returning id into v;
  insert into t_ctx values (p_k, v::text);
  perform pg_temp.as_user(null);
end $$;

-- 0. Shape -------------------------------------------------------------------
select pg_temp.ok(public.tk_schema_version() >= 12, 'schema version is 12 or later');
select pg_temp.ok(not has_function_privilege('anon', 'public.tk_bulk_complete(uuid[],date)', 'execute')
              and not has_function_privilege('anon', 'public.tk_bulk_reopen(uuid[],date)', 'execute')
              and not has_function_privilege('anon', 'public.tk_bulk_delete(uuid[])', 'execute')
              and not has_function_privilege('anon', 'public.tk_bulk_update(uuid[],jsonb)', 'execute')
              and not has_function_privilege('anon', 'public.tk_undo(uuid)', 'execute')
              and has_function_privilege('authenticated', 'public.tk_bulk_update(uuid[],jsonb)', 'execute')
              and has_function_privilege('authenticated', 'public.tk_undo(uuid)', 'execute'),
                  'no anon execute; staff (authenticated) can call the five RPCs');
select pg_temp.ok(not has_function_privilege('authenticated', 'public.tk__bulk_begin(uuid[])', 'execute')
              and not has_function_privilege('authenticated', 'public.tk__bulk_access(uuid)', 'execute')
              and not has_function_privilege('authenticated', 'public.tk__bulk_record(text,jsonb,bigint)', 'execute')
              and not has_function_privilege('authenticated', 'public.tk__bulk_reason(text)', 'execute')
              and not has_function_privilege('authenticated', 'public.tk__bulk_entry(staff_reminders,staff_reminders,uuid)', 'execute'),
                  'internal helpers not callable');
select pg_temp.ok(not has_table_privilege('authenticated', 'public.tk_undo_ops', 'select')
              and not has_table_privilege('authenticated', 'public.tk_undo_ops', 'insert')
              and not has_table_privilege('anon', 'public.tk_undo_ops', 'select')
              and (select relrowsecurity from pg_class where oid = 'public.tk_undo_ops'::regclass),
                  'undo log: RLS on, no table access for the app');
select pg_temp.ok((select bool_and(prosecdef and proconfig::text like '%search_path=public%') from pg_proc
                    where oid in ('public.tk_bulk_complete(uuid[],date)'::regprocedure, 'public.tk_bulk_reopen(uuid[],date)'::regprocedure,
                                  'public.tk_bulk_delete(uuid[])'::regprocedure, 'public.tk_bulk_update(uuid[],jsonb)'::regprocedure,
                                  'public.tk_undo(uuid)'::regprocedure)), 'all five RPCs are definer with search_path');
select pg_temp.ok((select prosrc like '%mgb.tk_ooo%' and prosrc like '%mgb.tk_generate%' and prosrc like '%mgb.tk_import%'
                      and prosrc like '%tk_staff_has_client%' and prosrc like '%access_request%'
                      and prosrc like '%mgb.tk_bulk%' and prosrc like '%mgb.tk_rollforward%' and prosrc like '%mgb.tk_undo%'
                     from pg_proc where oid = 'public.notify_enqueue_task_assigned()'::regprocedure),
                  'assignment trigger keeps every live guard and adds the three P4-3 flags');

-- People: a1 = basic-test's account manager (an admin), a2 = another admin,
-- bk = a bookkeeper with basic-test access, bk2 = a bookkeeper without it.
insert into t_ctx select 'a1', lower(c.account_manager_email) from clients c where c.id = 'basic-test';
insert into t_ctx select 'a2', lower(s.email) from staff s
 where s.active and s.role = 'admin' and lower(s.email) <> pg_temp.ctx('a1') order by s.email limit 1;
insert into t_ctx select 'bk', lower(s.email) from staff s where s.active and s.role = 'bookkeeper' order by s.email limit 1;
insert into t_ctx select 'bk2', lower(s.email) from staff s
 where s.active and s.role = 'bookkeeper' and lower(s.email) <> pg_temp.ctx('bk') order by s.email limit 1;
select pg_temp.ok(public.tk__is_active_admin(pg_temp.ctx('a1')) and pg_temp.ctx('a2') is not null
              and pg_temp.ctx('bk') is not null and pg_temp.ctx('bk2') is not null, 'test people found');
insert into t_ctx select 'other_client', c.id from clients c where c.id <> 'basic-test' and not coalesce(c.is_internal, false) order by c.id limit 1;

-- Setup (inside this transaction only)
insert into staff_client_access (staff_email, client_id)
select pg_temp.ctx('bk'), 'basic-test'
 where not exists (select 1 from staff_client_access where lower(staff_email) = pg_temp.ctx('bk') and client_id = 'basic-test');
delete from staff_client_access where lower(staff_email) = pg_temp.ctx('bk2') and client_id = 'basic-test';
delete from staff_client_access_grants where lower(staff_email) = pg_temp.ctx('bk2') and client_id = 'basic-test';
update clients set test_only = true, is_internal = false where id = 'basic-test';
select pg_temp.ok(not public.tk_staff_has_client(pg_temp.ctx('bk2'), 'basic-test') and public.tk_staff_has_client(pg_temp.ctx('bk'), 'basic-test'),
                  'bk reaches basic-test, bk2 does not');

-- 1. Cap and bad input -------------------------------------------------------------
select pg_temp.as_user(pg_temp.ctx('bk'));
select pg_temp.expect_err($$select public.tk_bulk_complete(array(select gen_random_uuid() from generate_series(1, 101)))$$,
                          'tk_too_many', '101 ids refused');
select pg_temp.ok(coalesce(public.tk_bulk_complete(array(select gen_random_uuid() from generate_series(1, 100))) ->> 'op_id', '') = '',
                  '100 unknown ids: accepted, nothing done, no op');
select pg_temp.expect_err($$select public.tk_bulk_update(array[gen_random_uuid()], '{"assignee_email":"x","due_date":null}')$$,
                          'tk_bad_patch', 'two actions in one patch refused');
select pg_temp.expect_err($$select public.tk_bulk_update(array[gen_random_uuid()], '{"client_id":"x"}')$$,
                          'tk_bad_patch', 'client_id is not a bulk key');
select pg_temp.expect_err($$select public.tk_bulk_update(array[gen_random_uuid()], '{"due_shift_days":0}')$$,
                          'tk_bad_patch', 'a zero-day shift refused');
select pg_temp.expect_err($$select public.tk_bulk_update(array[gen_random_uuid()], '{"assignee_email":"nobody@example.invalid"}')$$,
                          'tk_bad_assignee', 'assignee must be active staff');
select pg_temp.as_user(null);
select pg_temp.expect_err($$select public.tk_bulk_complete(array[gen_random_uuid()])$$, 'tk_forbidden', 'needs a signed-in staff member');

-- 2. Bulk complete ----------------------------------------------------------------
select pg_temp.mk('t1', 'bk', 'basic-test', 'shared');
select pg_temp.mk('t2', 'bk', 'basic-test', 'shared');
select pg_temp.mk('t3', 'bk', 'basic-test', 'shared', '{"review":true}');
select pg_temp.mk('t4', 'bk', 'basic-test', 'shared', '{"review":true}');
select pg_temp.mk('t5', 'bk', 'basic-test', 'shared');
select pg_temp.mk('t6', 'bk', null, 'private');
select pg_temp.mk('t7', 'bk', 'basic-test', 'shared', '{"recurrence":"monthly","due":"2026-10-15"}');
select pg_temp.mk('t9', 'bk', 'basic-test', 'shared', '{"recurrence":"weekly","due":"2026-10-14"}');
select pg_temp.mk('t8', 'a2', null, 'private');
select pg_temp.mk('tb', 'bk', 'basic-test', 'shared', '{"recurrence":"weekly","due":"2026-10-14"}');
insert into t_ctx values ('ghost', gen_random_uuid()::text);
-- t4 in review, t5 waiting on client, t6 done, t2 in progress
select pg_temp.as_user(pg_temp.ctx('bk'));
select public.complete_staff_item(pg_temp.id('t4'), true, null);
update staff_reminders set status = 'waiting_client' where id = pg_temp.id('t5');
select public.complete_staff_item(pg_temp.id('t6'), true, null);
update staff_reminders set status = 'in_progress' where id = pg_temp.id('t2');
select pg_temp.as_user(null);
select pg_temp.ok((pg_temp.task('t4')).status = 'ready_for_review' and (pg_temp.task('t5')).status = 'waiting_client'
              and (pg_temp.task('t6')).status = 'done', 'setup: review, waiting and done rows');
-- per-row isolation: copying tb's checklist into its next copy fails (a test-only trigger)
insert into task_checklist_items (reminder_id, text, sort_order) values (pg_temp.id('tb'), 'P4-3 boom', 0);
create function public.tk_p43_selftest_boom() returns trigger language plpgsql as $$
begin
  if new.text = 'P4-3 boom' and new.reminder_id <> pg_temp.id('tb') then raise exception 'p43 boom'; end if;
  return new;
end $$;
create trigger tk_p43_selftest_boom before insert on task_checklist_items
  for each row execute function public.tk_p43_selftest_boom();

select pg_temp.as_user(pg_temp.ctx('bk'));
insert into t_ctx select 'r1', public.tk_bulk_complete(array[
  pg_temp.id('t1'), pg_temp.id('t2'), pg_temp.id('t3'), pg_temp.id('t4'), pg_temp.id('t5'), pg_temp.id('t6'),
  pg_temp.id('t7'), pg_temp.id('t8'), pg_temp.id('ghost'), pg_temp.id('tb'), pg_temp.id('t9'), pg_temp.id('t1')]::uuid[])::text;
select pg_temp.as_user(null);
drop trigger tk_p43_selftest_boom on task_checklist_items;
drop function public.tk_p43_selftest_boom();
insert into t_ctx values ('op1', pg_temp.res('r1') ->> 'op_id');

select pg_temp.ok(pg_temp.has('r1', 'done', 't1') and pg_temp.has('r1', 'done', 't2') and pg_temp.has('r1', 'done', 't7')
              and pg_temp.has('r1', 'done', 't9') and jsonb_array_length(pg_temp.res('r1') -> 'done') = 4,
                  'complete: t1, t2, t7, t9 done (duplicate id counted once)');
select pg_temp.ok(pg_temp.has('r1', 'review', 't3') and (pg_temp.task('t3')).status = 'ready_for_review',
                  'review-required row sent for review');
select pg_temp.ok(pg_temp.reason('r1', 't4') = 'in_review' and (pg_temp.task('t4')).status = 'ready_for_review'
              and (pg_temp.task('t4')).approved_at is null, 'a row in review is skipped and never approved');
select pg_temp.ok(pg_temp.reason('r1', 't5') = 'waiting_client' and (pg_temp.task('t5')).status = 'waiting_client', 'waiting on client skipped');
select pg_temp.ok(pg_temp.reason('r1', 't6') = 'already_done', 'done skipped');
select pg_temp.ok(pg_temp.reason('r1', 't8') = 'no_access' and not (pg_temp.task('t8')).done, 'someone else''s private task: no_access, untouched');
select pg_temp.ok(pg_temp.reason('r1', 'ghost') = 'no_access', 'unknown id: no_access');
select pg_temp.ok(pg_temp.reason('r1', 'tb') = 'error' and (pg_temp.task('tb')).status = 'todo'
              and (pg_temp.task('tb')).recurrence = 'weekly', 'one row failing mid-way is rolled back alone; the rest went through');
select pg_temp.ok((select count(*) = 2 from tk_undo_ops o, unnest(o.spawned_ids) s where o.id = pg_temp.id('op1'))
              and jsonb_array_length(pg_temp.res('r1') -> 'spawned') = 2, 'both roll-forward ids captured');
insert into t_ctx select 'sp7', s.id::text from staff_reminders s where s.text = 'P4-3 self-test t7'
   and s.id <> pg_temp.id('t7') and s.deleted_at is null;
insert into t_ctx select 'sp9', s.id::text from staff_reminders s where s.text = 'P4-3 self-test t9'
   and s.id <> pg_temp.id('t9') and s.deleted_at is null;
select pg_temp.ok(pg_temp.res('r1') -> 'spawned' ? pg_temp.ctx('sp7') and (pg_temp.task('t7')).recurrence = 'none',
                  'the next copy is the spawned id; the original stops recurring');
select pg_temp.ok(pg_temp.mails('sp7') = 0 and pg_temp.mails('sp9') = 0, 'roll-forward copies queue no assignment email');
select pg_temp.ok((select actor_email = pg_temp.ctx('bk') and kind = 'complete' and cardinality(task_ids) = 5
                     and expires_at > now() and undone_at is null from tk_undo_ops where id = pg_temp.id('op1')),
                  'op logged for the caller: 5 tasks, 10-minute window');

-- 3. Undo of the complete -----------------------------------------------------------
-- t2 changed since; t9's next copy got a subtask (touched)
select pg_temp.as_user(pg_temp.ctx('bk'));
update staff_reminders set due_date = date '2026-12-01' where id = pg_temp.id('t2');
insert into staff_reminders (staff_email, text, client_id, visibility, parent_id)
values (pg_temp.ctx('bk'), 'P4-3 self-test subtask', 'basic-test', 'shared', pg_temp.id('sp9'));
select pg_temp.as_user(pg_temp.ctx('a2'));
select pg_temp.expect_err(format('select public.tk_undo(%L)', pg_temp.ctx('op1')), 'tk_not_found', 'someone else cannot undo it');
select pg_temp.as_user(pg_temp.ctx('bk'));
insert into t_ctx select 'u1', public.tk_undo(pg_temp.id('op1'))::text;
select pg_temp.ok(pg_temp.has('u1', 'done', 't1') and (pg_temp.task('t1')).status = 'todo' and not (pg_temp.task('t1')).done,
                  'undo: t1 back to to do');
select pg_temp.ok(pg_temp.has('u1', 'done', 't3') and (pg_temp.task('t3')).status = 'todo', 'undo: t3 back out of review');
select pg_temp.ok(pg_temp.reason('u1', 't2') = 'changed_since' and (pg_temp.task('t2')).status = 'done', 'changed since: skipped, left done');
select pg_temp.ok((pg_temp.task('t7')).status = 'todo' and (pg_temp.task('t7')).recurrence = 'monthly'
              and (pg_temp.task('sp7')).deleted_at is not null, 'untouched next copy removed; the original recurs again');
select pg_temp.ok((pg_temp.task('t9')).status = 'todo' and (pg_temp.task('t9')).recurrence = 'none'
              and (pg_temp.task('sp9')).deleted_at is null and pg_temp.res('u1') -> 'spawned_kept' ? pg_temp.ctx('sp9'),
                  'touched next copy kept; the series goes on there');
select pg_temp.ok((pg_temp.res('u1') ->> 'spawned_removed')::int = 1, 'one copy removed');
select pg_temp.expect_err(format('select public.tk_undo(%L)', pg_temp.ctx('op1')), 'tk_undo_used', 'undo works once');
select pg_temp.as_user(null);

-- 4. Expired op --------------------------------------------------------------------
select pg_temp.as_user(pg_temp.ctx('bk'));
insert into t_ctx select 'r2', public.tk_bulk_delete(array[pg_temp.id('t1')])::text;
select pg_temp.as_user(null);
update tk_undo_ops set expires_at = now() - interval '1 second' where id = (pg_temp.res('r2') ->> 'op_id')::uuid;
select pg_temp.as_user(pg_temp.ctx('bk'));
select pg_temp.expect_err(format('select public.tk_undo(%L)', pg_temp.res('r2') ->> 'op_id'), 'tk_undo_expired', 'expired op refused');
select pg_temp.as_user(null);

-- 5. Delete + undo -------------------------------------------------------------------
select pg_temp.as_user(pg_temp.ctx('bk'));
insert into t_ctx select 'r3', public.tk_bulk_delete(array[pg_temp.id('t3'), pg_temp.id('t1'), pg_temp.id('t8')])::text;
select pg_temp.ok(pg_temp.has('r3', 'done', 't3') and (pg_temp.task('t3')).deleted_at is not null
              and pg_temp.reason('r3', 't1') in ('deleted', 'no_access') and pg_temp.reason('r3', 't8') = 'no_access',
                  'delete: soft, already deleted and private rows skipped');
insert into t_ctx select 'u3', public.tk_undo((pg_temp.res('r3') ->> 'op_id')::uuid)::text;
select pg_temp.ok((pg_temp.task('t3')).deleted_at is null, 'undo delete restores the task');
select pg_temp.as_user(null);

-- 6. Reassign: owner only, review, client access, emails -------------------------------
select pg_temp.mk('r_own', 'a1', 'basic-test', 'shared');
select pg_temp.mk('r_noc', 'a1', null, 'private');
select pg_temp.mk('r_bk', 'bk', 'basic-test', 'shared');
select pg_temp.as_user(pg_temp.ctx('bk'));
insert into t_ctx select 'r4', public.tk_bulk_update(array[pg_temp.id('r_own'), pg_temp.id('t4')], jsonb_build_object('assignee_email', pg_temp.ctx('bk')))::text;
select pg_temp.ok(pg_temp.reason('r4', 'r_own') = 'owner_only' and (pg_temp.task('r_own')).assignee_email = pg_temp.ctx('a1'),
                  'a non-owner cannot reassign someone else''s task');
select pg_temp.ok(pg_temp.reason('r4', 't4') = 'in_review', 'a task in review is not reassigned');
select pg_temp.as_user(null);

-- test client: no email; bk2 has no access to basic-test: skipped
select pg_temp.as_user(pg_temp.ctx('a1'));
insert into t_ctx select 'r5', public.tk_bulk_update(array[pg_temp.id('r_own')], jsonb_build_object('assignee_email', pg_temp.ctx('bk')))::text;
select pg_temp.ok(pg_temp.has('r5', 'done', 'r_own') and (pg_temp.task('r_own')).assignee_email = pg_temp.ctx('bk')
              and pg_temp.mails('r_own') = 0, 'reassign on a test client: done, no email');
insert into t_ctx select 'r6', public.tk_bulk_update(array[pg_temp.id('r_bk')], jsonb_build_object('assignee_email', pg_temp.ctx('bk2')))::text;
select pg_temp.ok(pg_temp.reason('r6', 'r_bk') = 'assignee_no_access' and (pg_temp.task('r_bk')).assignee_email = pg_temp.ctx('bk'),
                  'reassign to someone who cannot open the client: skipped');
select pg_temp.as_user(null);
update clients set test_only = false where id = 'basic-test';   -- a real-looking client, this transaction only
select pg_temp.mk('m1', 'a1', 'basic-test', 'shared');
-- bk already followed r_noc before the reassign: undo must keep that row
insert into tk_followers (task_id, staff_email, added_by, added_at)
values (pg_temp.id('r_noc'), pg_temp.ctx('bk'), pg_temp.ctx('a1'), now() - interval '1 hour') on conflict do nothing;
select pg_temp.as_user(pg_temp.ctx('a1'));
insert into t_ctx select 'r7', public.tk_bulk_update(array[pg_temp.id('m1'), pg_temp.id('r_noc')], jsonb_build_object('assignee_email', pg_temp.ctx('bk')))::text;
select pg_temp.as_user(null);
select pg_temp.ok(pg_temp.mails('m1') = 1 and pg_temp.mails('r_noc') = 1, 'one normal assignment email per task (client and no-client)');
select pg_temp.ok((select cardinality(outbox_ids) = 2 from tk_undo_ops where id = (pg_temp.res('r7') ->> 'op_id')::uuid),
                  'the op holds both queued emails');
-- only one client may be internal: hand the flag to basic-test for a moment
insert into t_ctx select 'internal', id from clients where is_internal and id <> 'basic-test' limit 1;
update clients set is_internal = false where id = pg_temp.ctx('internal');
update clients set is_internal = true where id = 'basic-test';
select pg_temp.mk('m2', 'a1', 'basic-test', 'shared');
select pg_temp.as_user(pg_temp.ctx('a1'));
select public.tk_bulk_update(array[pg_temp.id('m2')], jsonb_build_object('assignee_email', pg_temp.ctx('a2')));
select pg_temp.as_user(null);
select pg_temp.ok(pg_temp.mails('m2') = 0, 'internal client: no bulk email');
update clients set is_internal = false where id = 'basic-test';
update clients set is_internal = true where id = pg_temp.ctx('internal');

select pg_temp.ok(exists (select 1 from tk_followers where task_id = pg_temp.id('m1') and lower(staff_email) = pg_temp.ctx('bk')),
                  'the new assignee follows the task');

-- race: the sender already sent m1's email; r_noc's is still queued
update notification_outbox set status = 'sent', processed_at = now()
 where ref_id = pg_temp.ctx('m1') and kind = 'staff_task_assigned';
select pg_temp.as_user(pg_temp.ctx('a1'));
insert into t_ctx select 'u7', public.tk_undo((pg_temp.res('r7') ->> 'op_id')::uuid)::text;
select pg_temp.as_user(null);
select pg_temp.ok((pg_temp.task('m1')).assignee_email = pg_temp.ctx('a1') and (pg_temp.task('r_noc')).assignee_email = pg_temp.ctx('a1'),
                  'undo reassign puts both back');
select pg_temp.ok((select status = 'skipped' and reason = 'undone' and processed_at is not null from notification_outbox
                    where ref_id = pg_temp.ctx('r_noc') and kind = 'staff_task_assigned'), 'unsent email marked skipped/undone');
select pg_temp.ok((select status = 'sent' from notification_outbox where ref_id = pg_temp.ctx('m1') and kind = 'staff_task_assigned')
              and jsonb_array_length(pg_temp.res('u7') -> 'already_emailed') = 1 and (pg_temp.res('u7') ->> 'emails_cancelled')::int = 1,
                  'sent email stays sent and is named back');
select pg_temp.ok(pg_temp.mails('m1') = 1 and pg_temp.mails('r_noc') = 1, 'undo queues no new email');
select pg_temp.ok(not exists (select 1 from tk_followers where task_id = pg_temp.id('m1') and lower(staff_email) = pg_temp.ctx('bk')),
                  'undo reassign drops the follower row the reassign added');
select pg_temp.ok(exists (select 1 from tk_followers where task_id = pg_temp.id('r_noc') and lower(staff_email) = pg_temp.ctx('bk'))
              and exists (select 1 from tk_followers where task_id = pg_temp.id('m1') and lower(staff_email) = pg_temp.ctx('a1')),
                  'undo keeps an older follower row and the owner''s row');

-- 7. The assignment trigger: each flag still suppresses -------------------------------
select pg_temp.mk('n1', 'a1', 'basic-test', 'shared');
create or replace function pg_temp.assign_with(p_flag text, p_val text, p_to text) returns bigint language plpgsql as $$
declare v bigint;
begin
  perform pg_temp.as_user(pg_temp.ctx('a1'));
  if p_flag is not null then perform set_config(p_flag, p_val, true); end if;
  update staff_reminders set assignee_email = pg_temp.ctx(p_to) where id = pg_temp.id('n1');
  if p_flag is not null then perform set_config(p_flag, '', true); end if;
  update staff_reminders set assignee_email = pg_temp.ctx('a1') where id = pg_temp.id('n1');   -- self-assign back: no email
  perform pg_temp.as_user(null);
  return pg_temp.mails('n1');
end $$;
select pg_temp.ok(pg_temp.assign_with('mgb.tk_generate', 'on', 'bk') = 0, 'generator flag suppresses (and self-assign sends nothing)');
select pg_temp.ok(pg_temp.assign_with('mgb.tk_ooo', 'quiet', 'bk') = 0, 'OOO flag suppresses');
select pg_temp.ok(pg_temp.assign_with('mgb.tk_import', 'on', 'bk') = 0, 'import flag suppresses');
select pg_temp.ok(pg_temp.assign_with('mgb.tk_bulk', 'on', 'bk') = 0, 'tk_bulk flag suppresses');
select pg_temp.ok(pg_temp.assign_with('mgb.tk_rollforward', 'on', 'bk') = 0, 'tk_rollforward flag suppresses');
select pg_temp.ok(pg_temp.assign_with('mgb.tk_undo', 'on', 'bk') = 0, 'tk_undo flag suppresses');
select pg_temp.ok(pg_temp.assign_with(null, null, 'bk2') = 0, 'no email to someone who cannot open the client');
select pg_temp.ok(pg_temp.assign_with(null, null, 'bk') = 1, 'a plain reassign still emails');

-- 8. Move to a project ---------------------------------------------------------------
select pg_temp.as_user(pg_temp.ctx('a1'));
with p as (insert into tk_projects (name, kind, client_id, owner_email) values ('P4-3 self-test', 'onboarding', 'basic-test', pg_temp.ctx('a1')) returning id)
insert into t_ctx select 'proj', id::text from p;
with p as (insert into tk_projects (name, kind, client_id, owner_email) values ('P4-3 self-test other', 'onboarding', pg_temp.ctx('other_client'), pg_temp.ctx('a1')) returning id)
insert into t_ctx select 'proj2', id::text from p;
select pg_temp.as_user(null);
select pg_temp.as_user(pg_temp.ctx('bk'));
insert into t_ctx select 'r8', public.tk_bulk_update(array[pg_temp.id('r_bk'), pg_temp.id('m2')], jsonb_build_object('project_id', pg_temp.ctx('proj')))::text;
select pg_temp.ok(pg_temp.has('r8', 'done', 'r_bk') and (pg_temp.task('r_bk')).project_id = pg_temp.id('proj')
              and (pg_temp.task('r_bk')).client_id = 'basic-test', 'owner moves a task into a project; client unchanged');
select pg_temp.ok(pg_temp.reason('r8', 'm2') = 'owner_only' and (pg_temp.task('m2')).project_id is null, 'a non-owner cannot move');
select pg_temp.as_user(pg_temp.ctx('a1'));
insert into t_ctx select 'r9', public.tk_bulk_update(array[pg_temp.id('m2')], jsonb_build_object('project_id', pg_temp.ctx('proj2')))::text;
select pg_temp.ok(pg_temp.reason('r9', 'm2') = 'project_client' and (pg_temp.task('m2')).client_id = 'basic-test',
                  'bulk never moves a task to another client''s project');
select pg_temp.as_user(pg_temp.ctx('bk'));
insert into t_ctx select 'u8', public.tk_undo((pg_temp.res('r8') ->> 'op_id')::uuid)::text;
select pg_temp.ok((pg_temp.task('r_bk')).project_id is null, 'undo move takes it out again');
select pg_temp.as_user(null);
update tk_projects set archived_at = now() where id = pg_temp.id('proj');
select pg_temp.as_user(pg_temp.ctx('bk'));
select pg_temp.expect_err(format($$select public.tk_bulk_update(array[%L::uuid], jsonb_build_object('project_id', %L))$$,
                                 pg_temp.ctx('r_bk'), pg_temp.ctx('proj')), 'tk_project_archived', 'archived project refused');
select pg_temp.as_user(null);

-- 9. Due dates -------------------------------------------------------------------------
select pg_temp.mk('d1', 'bk', 'basic-test', 'shared', '{"due":"2026-10-20"}');
update staff_reminders set due_at = timestamptz '2026-10-20 15:30+00' where id = pg_temp.id('d1');
select pg_temp.mk('d2', 'bk', 'basic-test', 'shared');
select pg_temp.as_user(pg_temp.ctx('bk'));
insert into t_ctx select 'r10', public.tk_bulk_update(array[pg_temp.id('d1'), pg_temp.id('d2')], '{"due_shift_days":3}')::text;
select pg_temp.ok((pg_temp.task('d1')).due_date = date '2026-10-23' and (pg_temp.task('d1')).due_at = timestamptz '2026-10-23 15:30+00',
                  'shift moves the date and keeps the time');
select pg_temp.ok(pg_temp.reason('r10', 'd2') = 'no_due_date', 'no due date: skipped');
insert into t_ctx select 'u10', public.tk_undo((pg_temp.res('r10') ->> 'op_id')::uuid)::text;
select pg_temp.ok((pg_temp.task('d1')).due_date = date '2026-10-20' and (pg_temp.task('d1')).due_at = timestamptz '2026-10-20 15:30+00',
                  'undo restores date and time');
insert into t_ctx select 'r11', public.tk_bulk_update(array[pg_temp.id('d2')], '{"due_date":"2026-11-02"}')::text;
select pg_temp.ok((pg_temp.task('d2')).due_date = date '2026-11-02', 'set a due date');
select pg_temp.ok((pg_temp.task('d2')).due_date_original = date '2026-11-02', 'a first due date also sets the original date');
insert into t_ctx select 'u11', public.tk_undo((pg_temp.res('r11') ->> 'op_id')::uuid)::text;
select pg_temp.ok((pg_temp.task('d2')).due_date is null and (pg_temp.task('d2')).due_date_original is null
              and coalesce(current_setting('mgb.tk_migrate', true), '') = '',
                  'a non-admin undo of a first due date clears the original too, and drops the bypass flag');
select pg_temp.as_user(null);

-- 10. Reopen: approved rows need an admin; undo puts the approval back --------------------
select pg_temp.mk('ap', 'bk', 'basic-test', 'shared', '{"review":true}');
select set_config('mgb.tk_migrate', 'on', true);
update staff_reminders set status = 'done', approved_by = pg_temp.ctx('a1'), approved_at = now() - interval '1 day',
                           completed_at = now() - interval '1 day'
 where id = pg_temp.id('ap');
select set_config('mgb.tk_migrate', '', true);
select pg_temp.as_user(pg_temp.ctx('bk'));
insert into t_ctx select 'r12', public.tk_bulk_reopen(array[pg_temp.id('ap'), pg_temp.id('d2')])::text;
select pg_temp.ok(pg_temp.reason('r12', 'ap') = 'approved_admin_only' and pg_temp.reason('r12', 'd2') = 'not_done',
                  'reopen: approved needs an admin; open rows skipped');
select pg_temp.as_user(pg_temp.ctx('a1'));
insert into t_ctx select 'r13', public.tk_bulk_reopen(array[pg_temp.id('ap')])::text;
select pg_temp.ok((pg_temp.task('ap')).status = 'todo' and (pg_temp.task('ap')).approved_at is null, 'admin reopens an approved task');
insert into t_ctx select 'u13', public.tk_undo((pg_temp.res('r13') ->> 'op_id')::uuid)::text;
select pg_temp.ok((pg_temp.task('ap')).status = 'done' and (pg_temp.task('ap')).approved_by = pg_temp.ctx('a1')
              and (pg_temp.task('ap')).completed_at < now() - interval '23 hours', 'undo reopen: done again, approval and finish time back');
select pg_temp.as_user(null);
select pg_temp.ok((select count(*) = 1 from tk_activity where task_id = pg_temp.id('ap') and kind = 'status' and meta ->> 'undo' = 'true'),
                  'undo reopen leaves an activity line');

-- 11. Cleanup of the caller's old log rows ----------------------------------------------
update tk_undo_ops set created_at = now() - interval '2 days' where id = pg_temp.id('op1');
select pg_temp.as_user(pg_temp.ctx('bk'));
select public.tk_bulk_complete(array[]::uuid[]);
select pg_temp.as_user(null);
select pg_temp.ok(not exists (select 1 from tk_undo_ops where id = pg_temp.id('op1'))
              and exists (select 1 from tk_undo_ops where actor_email = pg_temp.ctx('a1')), 'old rows of the caller cleaned; others kept');

select 'P4-3 SELF-TEST PASSED' as result;
rollback;
