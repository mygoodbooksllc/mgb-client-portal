-- =====================================================================
-- Self-test for tasks-p2-7-ooo.sql (out-of-office coverage) and its review
-- fixes in tasks-p2-9-ooo-fixes.sql (sections 11-16).
--
-- Run it whole; it ends in ROLLBACK, so nothing it writes is kept and no
-- email is sent (outbox rows vanish with the rollback). Tasks live on the
-- two test clients (basic-test, grace-community). People are picked at run
-- time; no names or emails live in this file. Dates are relative to today
-- (America/Chicago). A failed check raises and stops the run.
-- =====================================================================
begin;

create temp table t_ctx (k text primary key, v text) on commit drop;
grant select, insert on t_ctx to authenticated, anon;   -- the checks below run as those roles too

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
-- A task for p_staff (creator) assigned to p_to. Inserted as the migration owner.
create or replace function pg_temp.mk(p_key text, p_staff text, p_to text, p_client text, p_due date,
                                      p_recur text default 'none', p_vis text default 'shared') returns uuid
language plpgsql as $$
declare v uuid;
begin
  insert into staff_reminders (staff_email, assignee_email, text, client_id, due_date, recurrence, visibility, kind)
  values (p_staff, p_to, 'S7 test ' || p_key, p_client, p_due, p_recur, p_vis, 'task')
  returning id into v;
  insert into t_ctx values (p_key, v::text);
  return v;
end $$;
create or replace function pg_temp.who(p_key text) returns text language sql as $$
  select lower(coalesce(assignee_email, staff_email)) from staff_reminders where id = pg_temp.id(p_key);
$$;
create or replace function pg_temp.counts() returns text language sql as $$
  select (select count(*) from tk_ooo_reassignments)::text || '/' || (select count(*) from notification_outbox)::text || '/'
      || (select count(*) from tk_ooo_runs)::text || '/' || (select count(*) from tk_activity)::text || '/'
      || (select count(*) from staff_client_access_grants)::text;
$$;

-- People: bk1 (away), bk2 (backup), bk3 (not involved) = active bookkeepers; a1 = an active admin.
insert into t_ctx select 'bk1', lower(email) from staff where active and role = 'bookkeeper' order by email limit 1;
insert into t_ctx select 'bk2', lower(email) from staff where active and role = 'bookkeeper' order by email offset 1 limit 1;
insert into t_ctx select 'bk3', lower(email) from staff where active and role = 'bookkeeper' order by email offset 2 limit 1;
insert into t_ctx select 'a1', lower(email) from staff where active and role = 'admin' order by email limit 1;
select pg_temp.ok(pg_temp.ctx('bk1') is not null and pg_temp.ctx('bk2') is not null and pg_temp.ctx('bk3') is not null
                  and pg_temp.ctx('a1') is not null, 'test people found');
select pg_temp.ok(public.tk_schema_version() >= 8, 'schema version 8 or later');

-- Clients: basic-test has bk2 as backup (bk1 + bk2 have access); grace-community
-- has bk2 as backup but bk2 has no access there.
update clients set assigned_bookkeeper_email = pg_temp.ctx('bk1') where id = 'basic-test';
insert into client_profile (client_id, backup_bookkeeper_email) values ('basic-test', pg_temp.ctx('bk2'))
  on conflict (client_id) do update set backup_bookkeeper_email = excluded.backup_bookkeeper_email;
insert into client_profile (client_id, backup_bookkeeper_email) values ('grace-community', pg_temp.ctx('bk2'))
  on conflict (client_id) do update set backup_bookkeeper_email = excluded.backup_bookkeeper_email;
insert into staff_client_access (staff_email, client_id)
select x.e, x.c from (values (pg_temp.ctx('bk1'), 'basic-test'), (pg_temp.ctx('bk2'), 'basic-test'),
                             (pg_temp.ctx('bk1'), 'grace-community')) x(e, c)
 where not exists (select 1 from staff_client_access a where lower(a.staff_email) = x.e and a.client_id = x.c);
delete from staff_client_access where lower(staff_email) = pg_temp.ctx('bk2') and client_id = 'grace-community';
update staff_client_access_grants set status = 'revoked'
 where lower(staff_email) = pg_temp.ctx('bk2') and client_id = 'grace-community' and status in ('pending', 'approved');
select pg_temp.ok(not public.tk_staff_has_client(pg_temp.ctx('bk2'), 'grace-community'), 'setup: bk2 cannot open grace-community');

-- Time off W1: bk1, today .. today+6.
with w as (insert into staff_time_off (staff_email, starts_on, ends_on, note)
           values (pg_temp.ctx('bk1'), pg_temp.d(0), pg_temp.d(6), 'S7 test') returning id)
insert into t_ctx select 'W1', id::text from w;

-- Tasks. T1: created by the admin for bk1 (critique M2). T2: in review.
-- T3: due after the window. T4: private. T5: grace-community (backup has no
-- access). T6 weekly, T7 daily (roll-forward). T8: reassigned by hand later.
-- T9: done. T10: goes to review while covered. T11: control for the M2 pin.
select pg_temp.mk('T1', pg_temp.ctx('a1'), pg_temp.ctx('bk1'), 'basic-test', pg_temp.d(2));
select pg_temp.mk('T3', pg_temp.ctx('bk1'), pg_temp.ctx('bk1'), 'basic-test', pg_temp.d(10));
select pg_temp.mk('T4', pg_temp.ctx('bk1'), pg_temp.ctx('bk1'), null, pg_temp.d(2), 'none', 'private');
select pg_temp.mk('T5', pg_temp.ctx('bk1'), pg_temp.ctx('bk1'), 'grace-community', pg_temp.d(2));
select pg_temp.mk('T6', pg_temp.ctx('bk1'), pg_temp.ctx('bk1'), 'basic-test', pg_temp.d(1), 'weekly');
select pg_temp.mk('T7', pg_temp.ctx('bk1'), pg_temp.ctx('bk1'), 'basic-test', pg_temp.d(1), 'daily');
select pg_temp.mk('T8', pg_temp.ctx('bk1'), pg_temp.ctx('bk1'), 'basic-test', pg_temp.d(4));
select pg_temp.mk('T9', pg_temp.ctx('bk1'), pg_temp.ctx('bk1'), 'basic-test', pg_temp.d(3));
update staff_reminders set status = 'done' where id = pg_temp.id('T9');
select pg_temp.mk('T10', pg_temp.ctx('bk1'), pg_temp.ctx('bk1'), 'basic-test', pg_temp.d(5));
select pg_temp.mk('T11', pg_temp.ctx('a1'), pg_temp.ctx('bk1'), 'basic-test', pg_temp.d(20));
select set_config('mgb.tk_migrate', 'on', true);
insert into staff_reminders (staff_email, assignee_email, text, client_id, due_date, kind, status, review_required, reviewer_email)
values (pg_temp.ctx('bk1'), pg_temp.ctx('bk1'), 'S7 test T2', 'basic-test', pg_temp.d(3), 'task', 'ready_for_review', true, pg_temp.ctx('a1'));
select set_config('mgb.tk_migrate', '', true);
insert into t_ctx select 'T2', id::text from staff_reminders where text = 'S7 test T2';
select pg_temp.ok((select status from staff_reminders where id = pg_temp.id('T2')) = 'ready_for_review', 'setup: T2 in review');

-- Control (M2): without the OOO flag a non-admin cannot move a task an admin created.
select pg_temp.as_user(pg_temp.ctx('bk1'));
set local role authenticated;
update staff_reminders set assignee_email = pg_temp.ctx('bk2') where id = pg_temp.id('T11');
reset role;
select pg_temp.ok(pg_temp.who('T11') = pg_temp.ctx('bk1'), 'control: the non-owner pin keeps a direct reassign by bk1 (M2 precondition)');

-- 1. Dry run writes nothing --------------------------------------------------
insert into t_ctx values ('c0', pg_temp.counts());
select pg_temp.as_user(pg_temp.ctx('bk1'));
set local role authenticated;
insert into t_ctx select 'dry', public.tk_apply_ooo(pg_temp.id('W1'), true)::text;
reset role;
select pg_temp.ok(pg_temp.counts() = pg_temp.ctx('c0'), 'dry run: no ledger, outbox, run, activity or grant rows');
select pg_temp.ok(pg_temp.who('T1') = pg_temp.ctx('bk1'), 'dry run: nothing moved');
select pg_temp.ok((select array_agg(e ->> 'task_id' order by e ->> 'task_id') from jsonb_array_elements(pg_temp.ctx('dry')::jsonb -> 'move') e)
                  = (select array_agg(x order by x) from unnest(array[pg_temp.ctx('T1'), pg_temp.ctx('T6'), pg_temp.ctx('T7'),
                                                                     pg_temp.ctx('T8'), pg_temp.ctx('T10')]) x),
                  'dry run move set = T1, T6, T7, T8, T10 (not in review, not after the window, not done)');
select pg_temp.ok((select count(*) from jsonb_array_elements(pg_temp.ctx('dry')::jsonb -> 'skip') e
                    where e ->> 'reason' = 'private' and not (e ? 'title') and not (e ? 'task_id')) = 1,
                  'dry run skip: the private task is counted with no title or id');
select pg_temp.ok((select count(*) from jsonb_array_elements(pg_temp.ctx('dry')::jsonb -> 'skip') e
                    where e ->> 'task_id' = pg_temp.ctx('T5') and e ->> 'reason' = 'no_access') = 1,
                  'dry run skip: T5 no_access (backup cannot open grace-community)');
select pg_temp.ok(jsonb_array_length(pg_temp.ctx('dry')::jsonb -> 'skip') = 2, 'dry run skip set has exactly 2 rows');

-- 2. Who may call -------------------------------------------------------------
select pg_temp.as_user(pg_temp.ctx('bk1'));
set local role authenticated;
select pg_temp.expect_err(format($q$select public.tk_apply_ooo(%L, true, '{"basic-test":"x@y.z"}')$q$, pg_temp.ctx('W1')),
                          'tk_forbidden', 'a non-admin cannot pass overrides');
reset role;
select pg_temp.as_user(pg_temp.ctx('bk3'));
set local role authenticated;
select pg_temp.expect_err(format($q$select public.tk_apply_ooo(%L, true)$q$, pg_temp.ctx('W1')),
                          'tk_forbidden', 'another bookkeeper cannot apply my time off');
select pg_temp.expect_err(format($q$select public.tk_return_ooo(%L)$q$, pg_temp.ctx('W1')),
                          'tk_forbidden', 'another bookkeeper cannot return my time off');
reset role;
select pg_temp.as_user(pg_temp.ctx('a1'));
set local role authenticated;
insert into t_ctx select 'dry_admin', public.tk_apply_ooo(pg_temp.id('W1'), true)::text;
reset role;
select pg_temp.ok((select (e ->> 'grant')::boolean from jsonb_array_elements(pg_temp.ctx('dry_admin')::jsonb -> 'move') e
                    where e ->> 'task_id' = pg_temp.ctx('T5')),
                  'admin dry run: T5 would move with access granted (M1)');

-- 3. Apply as the owner (non-admin) --------------------------------------------
insert into t_ctx select 'ob0', (select count(*) from notification_outbox)::text;
select pg_temp.as_user(pg_temp.ctx('bk1'));
set local role authenticated;
insert into t_ctx select 'ap1', public.tk_apply_ooo(pg_temp.id('W1'), false)::text;
reset role;
select pg_temp.ok(pg_temp.who('T1') = pg_temp.ctx('bk2')
                  and (select lower(staff_email) from staff_reminders where id = pg_temp.id('T1')) = pg_temp.ctx('a1'),
                  'M2: bk1 handed off a task an admin created; staff_email unchanged');
select pg_temp.ok(pg_temp.who('T6') = pg_temp.ctx('bk2') and pg_temp.who('T7') = pg_temp.ctx('bk2')
                  and pg_temp.who('T8') = pg_temp.ctx('bk2') and pg_temp.who('T10') = pg_temp.ctx('bk2'),
                  'T6, T7, T8, T10 moved to the backup');
select pg_temp.ok(pg_temp.who('T2') = pg_temp.ctx('bk1')
                  and (select status from staff_reminders where id = pg_temp.id('T2')) = 'ready_for_review',
                  'T2 in review untouched');
select pg_temp.ok(pg_temp.who('T3') = pg_temp.ctx('bk1') and pg_temp.who('T4') = pg_temp.ctx('bk1')
                  and pg_temp.who('T5') = pg_temp.ctx('bk1') and pg_temp.who('T9') = pg_temp.ctx('bk1'),
                  'after-window, private, no-access and done tasks stay');
select pg_temp.ok((select count(*) from tk_ooo_reassignments where time_off_id = pg_temp.id('W1') and reason = 'backup') = 5,
                  'ledger: 5 backup rows');
select pg_temp.ok((select count(*) from staff_client_access_grants where lower(staff_email) = pg_temp.ctx('bk2')
                    and client_id = 'grace-community' and status = 'pending') = 1,
                  'M1: non-admin apply asks for access (one pending grant), grants nothing');
select pg_temp.ok(exists (select 1 from tk_activity where task_id = pg_temp.id('T1') and kind = 'reassigned_ooo'
                            and meta ->> 'direction' = 'out' and meta ->> 'time_off_id' = pg_temp.ctx('W1')
                            and to_value = pg_temp.ctx('bk2'))
                  and not exists (select 1 from tk_activity where task_id = pg_temp.id('T1') and kind = 'assignee'),
                  'activity: reassigned_ooo with direction out');
select pg_temp.ok((select added_by from tk_followers where task_id = pg_temp.id('T1') and staff_email = pg_temp.ctx('bk2')) = 'ooo',
                  'the backup follows T1, marked ooo (m13)');
select pg_temp.ok((select count(*) from notification_outbox where id in (
                     select id from notification_outbox order by created_at desc limit 100)
                    and kind = 'staff_task_assigned' and ref_id in (pg_temp.ctx('T1'), pg_temp.ctx('T6'), pg_temp.ctx('T7'),
                                                                    pg_temp.ctx('T8'), pg_temp.ctx('T10'))
                    and recipient_email = pg_temp.ctx('bk2')) = 0,
                  'no per-task assigned email for OOO moves');
select pg_temp.ok((select count(*) from notification_outbox where kind = 'staff_task_batch'
                    and ref_id = 'ooo_out:' || pg_temp.ctx('W1') and recipient_email = pg_temp.ctx('bk2')
                    and client_id is null and jsonb_array_length(payload -> 'items') = 5
                    and payload ->> 'hash' like '#/tasks%') = 1,
                  'one summary to the backup with 5 items');
select pg_temp.ok((select count(*) from notification_outbox where kind = 'staff_task_batch'
                    and ref_id = 'ooo_owner_out:' || pg_temp.ctx('W1') and recipient_email = pg_temp.ctx('bk1')) = 1,
                  'one summary to the owner');
select pg_temp.ok((select count(*) from notification_outbox where kind = 'staff_task_batch'
                    and payload::text like '%S7 test T4%') = 0, 'the private task title is in no email');

-- 4. Idempotent ------------------------------------------------------------------
insert into t_ctx values ('c1', pg_temp.counts());
select pg_temp.as_user(null);
select public.tk_ooo_daily();
select pg_temp.ok(split_part(pg_temp.counts(), '/', 1) = split_part(pg_temp.ctx('c1'), '/', 1)
                  and split_part(pg_temp.counts(), '/', 2) = split_part(pg_temp.ctx('c1'), '/', 2),
                  'daily job re-run: no new ledger rows, no new email');
select pg_temp.ok((select count(*) from staff_client_access_grants where lower(staff_email) = pg_temp.ctx('bk2')
                    and client_id = 'grace-community' and status = 'pending') = 1, 'access request not duplicated');

-- 5. Who can see the ledger ---------------------------------------------------
select pg_temp.as_user(pg_temp.ctx('bk2'));
set local role authenticated;
select pg_temp.ok((select count(*) from public.tk_my_coverage()) = 5 and (select count(*) from tk_ooo_reassignments) = 5,
                  'the backup sees their 5 covered tasks');
select pg_temp.ok((select count(*) from tk_ooo_runs) = 0, 'run log is admin-only');
reset role;
select pg_temp.as_user(pg_temp.ctx('bk3'));
set local role authenticated;
select pg_temp.ok((select count(*) from public.tk_my_coverage()) = 0 and (select count(*) from tk_ooo_reassignments) = 0,
                  'someone else sees none');
reset role;
select pg_temp.as_user(null);
set local role anon;
select pg_temp.expect_err('select * from public.tk_my_coverage()', 'permission denied', 'anon cannot call tk_my_coverage');
reset role;

-- 6. Hand changes, roll-forward, review -------------------------------------
select pg_temp.as_user(pg_temp.ctx('a1'));
set local role authenticated;
update staff_reminders set assignee_email = pg_temp.ctx('a1') where id = pg_temp.id('T8');
reset role;
select pg_temp.ok(pg_temp.who('T8') = pg_temp.ctx('a1'), 'setup: admin moved T8 by hand');

select pg_temp.as_user(pg_temp.ctx('bk2'));
set local role authenticated;
insert into t_ctx select 'T6n', public.complete_staff_item(pg_temp.id('T6'), true, pg_temp.d(0))::text;
insert into t_ctx select 'T7n', public.complete_staff_item(pg_temp.id('T7'), true, pg_temp.d(0))::text;
reset role;
select pg_temp.ok(pg_temp.who('T6n') = pg_temp.ctx('bk1')
                  and (select due_date from staff_reminders where id = pg_temp.id('T6n')) > pg_temp.d(6),
                  'roll-forward past the time off goes back to the owner');
select pg_temp.ok(not exists (select 1 from tk_followers where task_id = pg_temp.id('T6n') and staff_email = pg_temp.ctx('bk2') and added_by = 'ooo'),
                  'the backup does not follow the rolled-home task');
select pg_temp.ok(pg_temp.who('T7n') = pg_temp.ctx('bk2')
                  and exists (select 1 from tk_ooo_reassignments where task_id = pg_temp.id('T7n') and reason = 'rollforward'
                                and returned_at is null),
                  'roll-forward inside the time off stays with the backup (rollforward ledger row)');
select pg_temp.ok((select count(*) from notification_outbox where kind = 'staff_task_assigned'
                    and ref_id in (pg_temp.ctx('T6n'), pg_temp.ctx('T7n'))) = 0, 'no per-task email on roll-forward');

select set_config('mgb.tk_migrate', 'on', true);
update staff_reminders set status = 'ready_for_review', review_required = true, reviewer_email = pg_temp.ctx('a1')
 where id = pg_temp.id('T10');
select set_config('mgb.tk_migrate', '', true);

-- 7. Cancel returns ---------------------------------------------------------
select pg_temp.as_user(pg_temp.ctx('bk1'));
set local role authenticated;
update staff_time_off set cancelled_at = now() where id = pg_temp.id('W1');
reset role;
select pg_temp.ok(pg_temp.who('T1') = pg_temp.ctx('bk1') and pg_temp.who('T7n') = pg_temp.ctx('bk1'),
                  'cancel: open covered tasks are back with the owner');
select pg_temp.ok(not exists (select 1 from tk_followers where task_id = pg_temp.id('T1') and staff_email = pg_temp.ctx('bk2')),
                  'cancel: the follower OOO added is removed (m13)');
select pg_temp.ok(pg_temp.who('T8') = pg_temp.ctx('a1')
                  and (select return_skipped_reason from tk_ooo_reassignments where task_id = pg_temp.id('T8')) = 'changed',
                  'cancel: a task reassigned by hand is left alone');
select pg_temp.ok((select return_skipped_reason from tk_ooo_reassignments where task_id = pg_temp.id('T6')) = 'closed',
                  'cancel: a done task is closed in the ledger');
select pg_temp.ok(pg_temp.who('T10') = pg_temp.ctx('bk2')
                  and (select returned_at is null and return_skipped_reason = 'in_review'
                         from tk_ooo_reassignments where task_id = pg_temp.id('T10')),
                  'cancel: a task in review stays with the backup and waits');
select pg_temp.ok(exists (select 1 from tk_activity where task_id = pg_temp.id('T1') and kind = 'reassigned_ooo'
                            and meta ->> 'direction' = 'back' and to_value = pg_temp.ctx('bk1')),
                  'activity: reassigned_ooo with direction back');
select pg_temp.ok((select count(*) from notification_outbox where kind = 'staff_task_batch'
                    and ref_id = 'ooo_owner_back:' || pg_temp.ctx('W1') and recipient_email = pg_temp.ctx('bk1')) = 1
                  and (select count(*) from notification_outbox where kind = 'staff_task_batch'
                    and ref_id = 'ooo_back:' || pg_temp.ctx('W1') and recipient_email = pg_temp.ctx('bk2')) = 1,
                  'cancel: one summary each to owner and backup');

-- 8. Daily job retries the one in review -------------------------------------
select pg_temp.as_user(null);
select public.tk_ooo_daily();
select pg_temp.ok(pg_temp.who('T10') = pg_temp.ctx('bk2'), 'daily: still in review, still with the backup');
select set_config('mgb.tk_migrate', 'on', true);
update staff_reminders set status = 'todo' where id = pg_temp.id('T10');
select set_config('mgb.tk_migrate', '', true);
select public.tk_ooo_daily();
select pg_temp.ok(pg_temp.who('T10') = pg_temp.ctx('bk1')
                  and (select returned_at is not null from tk_ooo_reassignments where task_id = pg_temp.id('T10')),
                  'daily: sent back from review, so it goes home');
select pg_temp.ok((select count(*) from tk_ooo_reassignments where time_off_id = pg_temp.id('W1') and returned_at is null) = 0,
                  'W1 ledger fully closed');

-- 9. Generator + shortened window --------------------------------------------
with w as (insert into staff_time_off (staff_email, starts_on, ends_on, note)
           values (pg_temp.ctx('bk1'), pg_temp.d(0), pg_temp.d(10), 'S7 test 2') returning id)
insert into t_ctx select 'W2', id::text from w;
with t as (insert into task_templates (title, cadence, due_offset_days, due_rule, lead_days, client_ids, plan_tiers, priority,
                                       status, active, activated_at, period_basis, checklist, assignee_role)
           values ('S7 test weekly', 'weekly', 0, '{"type":"weekday","dow":5}', 3, array['basic-test'], '{}', 'normal',
                   'active', true, now() - interval '30 days', 'calendar', '{}', 'bookkeeper') returning id)
insert into t_ctx select 'TPL', id::text from t;
update client_profile set backup_bookkeeper_email = null where client_id = 'grace-community';
select pg_temp.ok((select o_skip from public.tk__ooo_cover(pg_temp.ctx('bk1'), 'grace-community', pg_temp.d(3), null)) = 'no_backup',
                  'cover: a client without a backup is no_backup');
update client_profile set backup_bookkeeper_email = pg_temp.ctx('bk2') where client_id = 'grace-community';
select pg_temp.ok((select o_skip from public.tk__ooo_cover(pg_temp.ctx('bk2'), 'basic-test', pg_temp.d(3), null)) = 'self',
                  'cover: the backup going away is self');
with w as (insert into staff_time_off (staff_email, starts_on, ends_on, note)
           values (pg_temp.ctx('bk2'), pg_temp.d(3), pg_temp.d(3), 'S7 test away') returning id)
insert into t_ctx select 'WB', id::text from w;
select pg_temp.ok((select o_skip from public.tk__ooo_cover(pg_temp.ctx('bk1'), 'basic-test', pg_temp.d(3), null)) = 'backup_away'
                  and (select o_skip from public.tk__ooo_cover(pg_temp.ctx('bk1'), 'basic-test', pg_temp.d(4), null)) is null,
                  'cover: a backup who is out that day is backup_away (control: the next day is fine)');
update staff_time_off set cancelled_at = now() where id = pg_temp.id('WB');
select set_config('mgb.tk_generate', 'on', true);
insert into t_ctx select 'g_out', public.tk__issue_period(t, public.tk__template_eff(t, 'basic-test'), 'basic-test',
                                                          date_trunc('week', pg_temp.d(21))::date, false)::text
  from task_templates t where t.id = pg_temp.id('TPL');
insert into t_ctx select 'g_in', public.tk__issue_period(t, public.tk__template_eff(t, 'basic-test'), 'basic-test',
                                                         date_trunc('week', pg_temp.d(7))::date, false)::text
  from task_templates t where t.id = pg_temp.id('TPL');
select set_config('mgb.tk_generate', '', true);
select pg_temp.ok(pg_temp.ctx('g_out')::jsonb ->> 'status' = 'created' and pg_temp.ctx('g_out')::jsonb ->> 'covered_by' is null
                  and pg_temp.ctx('g_out')::jsonb ->> 'assignee' = pg_temp.ctx('bk1'),
                  'control: generator period due after the time off goes to the bookkeeper');
select pg_temp.ok(pg_temp.ctx('g_in')::jsonb ->> 'status' = 'created'
                  and pg_temp.ctx('g_in')::jsonb ->> 'covered_by' = pg_temp.ctx('bk2'),
                  'generator period due inside the time off goes to the backup');
insert into t_ctx select 'G', pg_temp.ctx('g_in')::jsonb ->> 'reminder_id';
select pg_temp.ok(pg_temp.who('G') = pg_temp.ctx('bk2')
                  and (select lower(staff_email) from staff_reminders where id = pg_temp.id('G')) = pg_temp.ctx('bk1')
                  and exists (select 1 from tk_ooo_reassignments where task_id = pg_temp.id('G') and reason = 'generator'
                                and time_off_id = pg_temp.id('W2')),
                  'generator: owner kept as staff_email, generator ledger row');
select pg_temp.ok((select count(*) from notification_outbox where kind = 'staff_task_assigned' and ref_id = pg_temp.ctx('G')) = 0,
                  'generator: no per-task email');
select pg_temp.as_user(pg_temp.ctx('bk1'));
set local role authenticated;
update staff_time_off set ends_on = (select due_date from staff_reminders where id = pg_temp.id('G')) - 1
 where id = pg_temp.id('W2');
reset role;
select pg_temp.ok(pg_temp.who('G') = pg_temp.ctx('bk1'), 'shortened time off: the task now outside it goes home');

-- 10. Admin apply grants access (M1) -----------------------------------------
with w as (insert into staff_time_off (staff_email, starts_on, ends_on, note)
           values (pg_temp.ctx('bk1'), pg_temp.d(0), pg_temp.d(6), 'S7 test 3') returning id)
insert into t_ctx select 'W3', id::text from w;
select pg_temp.as_user(pg_temp.ctx('a1'));
set local role authenticated;
insert into t_ctx select 'ap3', public.tk_apply_ooo(pg_temp.id('W3'), false)::text;
reset role;
select pg_temp.ok(pg_temp.who('T5') = pg_temp.ctx('bk2')
                  and public.tk_staff_has_client(pg_temp.ctx('bk2'), 'grace-community')
                  and (select expires_at <= now() + interval '31 days' from staff_client_access_grants
                        where lower(staff_email) = pg_temp.ctx('bk2') and client_id = 'grace-community' and status = 'approved'),
                  'admin apply: access granted (capped) and T5 moved');
select pg_temp.as_user(pg_temp.ctx('bk1'));
set local role authenticated;
insert into t_ctx select 'rt3', public.tk_return_ooo(pg_temp.id('W3'))::text;
reset role;
select pg_temp.ok(pg_temp.who('T5') = pg_temp.ctx('bk1') and pg_temp.who('T1') = pg_temp.ctx('bk1'),
                  'return now: everything back with the owner');

-- ===== tasks-p2-9-ooo-fixes.sql =================================================
select set_config('mgb.tk_ooo_waiting_only', '', true);
update staff_time_off set cancelled_at = now() where id = pg_temp.id('W2');   -- one bk1 window (W3) from here on

-- 11. MAJOR 1: auto apply is off unless set to true ---------------------------
select pg_temp.ok((select value from tk_settings where key = 'ooo_auto_apply') = 'false'::jsonb,
                  'MAJOR 1: ooo_auto_apply is seeded as false');
select pg_temp.mk('T12', pg_temp.ctx('bk1'), pg_temp.ctx('bk1'), 'basic-test', pg_temp.d(3));
select pg_temp.as_user(null);
select pg_temp.ok((public.tk_ooo_daily() ->> 'auto_apply')::boolean = false and pg_temp.who('T12') = pg_temp.ctx('bk1'),
                  'MAJOR 1: switch false, the daily job moves nothing');
delete from tk_settings where key = 'ooo_auto_apply';
select pg_temp.ok((public.tk_ooo_daily() ->> 'auto_apply')::boolean = false and pg_temp.who('T12') = pg_temp.ctx('bk1'),
                  'MAJOR 1: no row means off');
insert into tk_settings (key, value) values ('ooo_auto_apply', 'true'::jsonb);
select pg_temp.ok((public.tk_ooo_daily() ->> 'auto_apply')::boolean = true and pg_temp.who('T12') = pg_temp.ctx('bk2'),
                  'MAJOR 1: switch true, the daily job hands W3 tasks off (control)');
update tk_settings set value = 'false'::jsonb where key = 'ooo_auto_apply';
select pg_temp.ok(pg_temp.who('T1') = pg_temp.ctx('bk1'),
                  'MAJOR 2 (cron): a task handed back by Hand back now is not re-taken by the daily job');

-- 12. MAJOR 2: a manual re-apply moves handed-back tasks again ----------------
insert into t_ctx select 'n3', (select count(*) from tk_ooo_reassignments where time_off_id = pg_temp.id('W3'))::text;
insert into t_ctx select 'r0', (select count(*) from tk_ooo_runs)::text;
select public.tk__ooo_apply(pg_temp.id('W3'), false, '{}'::jsonb, 'cron', false);
select pg_temp.ok(pg_temp.who('T1') = pg_temp.ctx('bk1')
                  and (select count(*) from tk_ooo_runs)::text = pg_temp.ctx('r0'),
                  'minor b: a cron apply that moves nothing logs no run');
select pg_temp.as_user(pg_temp.ctx('bk1'));
set local role authenticated;
insert into t_ctx select 'ap12', public.tk_apply_ooo(pg_temp.id('W3'), false)::text;
reset role;
select pg_temp.ok(pg_temp.who('T1') = pg_temp.ctx('bk2') and pg_temp.who('T5') = pg_temp.ctx('bk2'),
                  'MAJOR 2: re-apply moves T1 and T5 again');
select pg_temp.ok((select count(*) from tk_ooo_reassignments where time_off_id = pg_temp.id('W3'))::text = pg_temp.ctx('n3')
                  and (select returned_at is null and return_skipped_reason is null and reassigned_by = pg_temp.ctx('bk1')
                         from tk_ooo_reassignments where time_off_id = pg_temp.id('W3') and task_id = pg_temp.id('T1')),
                  'MAJOR 2: the returned ledger row is reopened, no duplicate rows');
select pg_temp.ok((select count(*) from tk_ooo_runs)::int = pg_temp.ctx('r0')::int + 1, 'minor b: a manual apply logs a run');
select pg_temp.as_user(pg_temp.ctx('bk1'));
set local role authenticated;
select public.tk_apply_ooo(pg_temp.id('W3'), false);
reset role;
select pg_temp.ok((select count(*) from tk_ooo_runs)::int = pg_temp.ctx('r0')::int + 2
                  and exists (select 1 from tk_ooo_runs where time_off_id = pg_temp.id('W3') and action = 'apply'
                                 and mode = 'manual' and moved = 0),
                  'minor b: a manual apply that moves nothing still logs');

-- 13. minor b (return): a cron return with only in-review tasks logs nothing ---
select set_config('mgb.tk_migrate', 'on', true);
update staff_reminders set status = 'ready_for_review', review_required = true, reviewer_email = pg_temp.ctx('a1')
 where id in (select task_id from tk_ooo_reassignments where time_off_id = pg_temp.id('W3') and returned_at is null);
select set_config('mgb.tk_migrate', '', true);
insert into t_ctx select 'r1', (select count(*) from tk_ooo_runs)::text;
select pg_temp.as_user(null);
select public.tk__ooo_return(pg_temp.id('W3'), null, null, false, 'cron');
select pg_temp.ok((select count(*) from tk_ooo_runs)::text = pg_temp.ctx('r1')
                  and pg_temp.who('T1') = pg_temp.ctx('bk2')
                  and (select return_skipped_reason from tk_ooo_reassignments
                        where time_off_id = pg_temp.id('W3') and task_id = pg_temp.id('T1')) = 'in_review',
                  'minor b: cron return, everything in review: no run row, tasks wait');

-- 14. minor c: a running window only retries tasks left waiting on review -----
select set_config('mgb.tk_migrate', 'on', true);
update staff_reminders set status = 'todo' where id = pg_temp.id('T1');
select set_config('mgb.tk_migrate', '', true);
select public.tk_ooo_daily();
select pg_temp.ok(pg_temp.who('T1') = pg_temp.ctx('bk1') and pg_temp.who('T5') = pg_temp.ctx('bk2'),
                  'minor c: daily hands back T1 once out of review; T5 (still in review) waits');
select pg_temp.as_user(pg_temp.ctx('bk1'));
set local role authenticated;
select public.tk_apply_ooo(pg_temp.id('W3'), false);
reset role;
select pg_temp.ok(pg_temp.who('T1') = pg_temp.ctx('bk2'), 'setup: T1 with the backup again');
select set_config('mgb.tk_migrate', 'on', true);
update staff_reminders set due_date = pg_temp.d(9) where id = pg_temp.id('T1');   -- past W3's last day (d6)
select set_config('mgb.tk_migrate', '', true);
select pg_temp.as_user(null);
select public.tk_ooo_daily();
select pg_temp.ok(pg_temp.who('T1') = pg_temp.ctx('bk2')
                  and (select returned_at is null from tk_ooo_reassignments
                        where time_off_id = pg_temp.id('W3') and task_id = pg_temp.id('T1')),
                  'minor c: due date moved past the last day off: stays with the backup while the owner is out');

-- 15. minor a: a denied access request is not filed again ---------------------
update staff_client_access_grants set status = 'revoked'
 where lower(staff_email) = pg_temp.ctx('bk2') and client_id = 'grace-community' and status = 'approved';
update staff_client_access_grants set status = 'cancelled'
 where lower(staff_email) = pg_temp.ctx('bk2') and client_id = 'grace-community' and status = 'pending';
select pg_temp.ok(not public.tk_staff_has_client(pg_temp.ctx('bk2'), 'grace-community'), 'setup: bk2 cannot open grace-community again');
select public.tk__ooo_request_access(o, pg_temp.ctx('bk2'), 'grace-community') from staff_time_off o where o.id = pg_temp.id('W3');
select pg_temp.ok((select count(*) from staff_client_access_grants where lower(staff_email) = pg_temp.ctx('bk2')
                    and client_id = 'grace-community' and status = 'pending') = 1, 'setup: one access request');
update staff_client_access_grants set status = 'denied', decided_at = now()
 where lower(staff_email) = pg_temp.ctx('bk2') and client_id = 'grace-community' and status = 'pending';
select pg_temp.mk('T13', pg_temp.ctx('bk1'), pg_temp.ctx('bk1'), 'grace-community', pg_temp.d(4));
select pg_temp.as_user(pg_temp.ctx('bk1'));
set local role authenticated;
insert into t_ctx select 'ap15', public.tk_apply_ooo(pg_temp.id('W3'), false)::text;
reset role;
select pg_temp.as_user(null);
select public.tk__ooo_request_access(o, pg_temp.ctx('bk2'), 'grace-community') from staff_time_off o where o.id = pg_temp.id('W3');
select pg_temp.ok(pg_temp.who('T13') = pg_temp.ctx('bk1')
                  and exists (select 1 from jsonb_array_elements(pg_temp.ctx('ap15')::jsonb -> 'skip') e
                               where e ->> 'task_id' = pg_temp.ctx('T13') and e ->> 'reason' = 'no_access')
                  and (select count(*) from staff_client_access_grants where lower(staff_email) = pg_temp.ctx('bk2')
                        and client_id = 'grace-community' and status = 'pending') = 0,
                  'minor a: after a denial, apply and the daily path file no new request');
update staff_client_access_grants g set requested_at = o.created_at - interval '1 day'
  from staff_time_off o
 where o.id = pg_temp.id('W3') and lower(g.staff_email) = pg_temp.ctx('bk2') and g.client_id = 'grace-community'
   and g.status = 'denied';
select public.tk__ooo_request_access(o, pg_temp.ctx('bk2'), 'grace-community') from staff_time_off o where o.id = pg_temp.id('W3');
select pg_temp.ok((select count(*) from staff_client_access_grants where lower(staff_email) = pg_temp.ctx('bk2')
                    and client_id = 'grace-community' and status = 'pending') = 1,
                  'minor a (control): a denial from before this time off does not block a new request');

-- 16. minor d: moving a whole time off later ----------------------------------
update staff_time_off set cancelled_at = now() where id = pg_temp.id('W3');
select pg_temp.mk('T14', pg_temp.ctx('bk1'), pg_temp.ctx('bk1'), 'basic-test', pg_temp.d(3));
with w as (insert into staff_time_off (staff_email, starts_on, ends_on, note)
           values (pg_temp.ctx('bk1'), pg_temp.d(2), pg_temp.d(5), 'S7 test 5') returning id)
insert into t_ctx select 'W5', id::text from w;
select pg_temp.as_user(pg_temp.ctx('bk1'));
set local role authenticated;
select public.tk_apply_ooo(pg_temp.id('W5'), false);
reset role;
select pg_temp.ok(pg_temp.who('T14') = pg_temp.ctx('bk2'), 'setup: T14 handed off for W5');
insert into t_ctx select 'ob16', (select count(*) from notification_outbox)::text;
select pg_temp.as_user(pg_temp.ctx('bk1'));
set local role authenticated;
update staff_time_off set starts_on = pg_temp.d(3), ends_on = pg_temp.d(9) where id = pg_temp.id('W5');
reset role;
select pg_temp.ok(pg_temp.who('T14') = pg_temp.ctx('bk1')
                  and (select count(*) from tk_ooo_reassignments where time_off_id = pg_temp.id('W5') and returned_at is null
                         and coalesce(return_skipped_reason, '') <> 'in_review') = 0,
                  'minor d: moved later, not started: every task comes home (even one due in the new dates)');
select pg_temp.ok(exists (select 1 from notification_outbox where kind = 'staff_task_batch'
                           and ref_id = 'ooo_owner_back:' || pg_temp.ctx('W5') and recipient_email = pg_temp.ctx('bk1')
                           and payload ->> 'title' like 'Time off changed:%'),
                  'minor d: the owner email says the time off changed (not Welcome back)');
update staff_time_off set cancelled_at = now() where id = pg_temp.id('W5');
with w as (insert into staff_time_off (staff_email, starts_on, ends_on, note)
           values (pg_temp.ctx('bk1'), pg_temp.d(-2), pg_temp.d(4), 'S7 test 6') returning id)
insert into t_ctx select 'W6', id::text from w;
select pg_temp.as_user(pg_temp.ctx('bk1'));
set local role authenticated;
select public.tk_apply_ooo(pg_temp.id('W6'), false);
update staff_time_off set starts_on = pg_temp.d(-1), ends_on = pg_temp.d(9) where id = pg_temp.id('W6');
reset role;
select pg_temp.ok(pg_temp.who('T14') = pg_temp.ctx('bk2'),
                  'minor d (control): a started time off moved later keeps tasks still inside it with the backup');

select 'S7 self-test passed (with S7 fixes)' as result;
rollback;
