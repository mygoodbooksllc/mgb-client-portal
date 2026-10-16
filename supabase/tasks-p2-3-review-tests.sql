-- =====================================================================
-- Self-test for tasks-p2-3-review.sql (review loop + on-time metric).
--
-- Run it whole; it ends in ROLLBACK, so nothing it writes is kept and no
-- email is sent (the outbox rows it makes are rolled back with the rest).
-- Uses test client basic-test and personal tasks only. People are picked
-- at run time (two active admins, one active bookkeeper); no names or
-- emails live in this file. A failed check raises and stops the run.
--
-- Note: it briefly disables staff_reminders_before_write inside the
-- transaction to back-date one waiting_since (now() is fixed inside one
-- transaction, so a real wait cannot pass). Run it at a quiet moment.
-- =====================================================================
begin;

create temp table t_ctx (k text primary key, v text) on commit drop;

create or replace function pg_temp.ctx(p_k text) returns text language sql as $$ select v from t_ctx where k = p_k $$;
create or replace function pg_temp.as_user(p_email text) returns void language sql as $$
  select set_config('request.jwt.claims',
    case when p_email is null then '' else json_build_object(
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

-- People: A1 = basic-test account manager (an active admin, the tier-2
-- reviewer); A2 = another active admin; BK = an active bookkeeper.
insert into t_ctx
select 'a1', lower(c.account_manager_email) from clients c where c.id = 'basic-test';
insert into t_ctx
select 'a2', lower(s.email) from staff s
 where s.active and s.role = 'admin' and lower(s.email) <> pg_temp.ctx('a1')
 order by s.email limit 1;
insert into t_ctx
select 'bk', lower(s.email) from staff s where s.active and s.role = 'bookkeeper' order by s.email limit 1;
select pg_temp.ok(public.tk__is_active_admin(pg_temp.ctx('a1')) and pg_temp.ctx('a2') is not null and pg_temp.ctx('bk') is not null,
                  'test people found');
-- No client-level reviewer on basic-test inside this run, so tier 2 (AM) applies.
update client_profile set reviewer_email = null where client_id = 'basic-test';
insert into staff_client_access (staff_email, client_id)
select pg_temp.ctx('bk'), 'basic-test'
 where not exists (select 1 from staff_client_access where staff_email = pg_temp.ctx('bk') and client_id = 'basic-test');
-- Let the outbox take the new kinds inside this run (tasks-p2-3b).
alter table public.notification_outbox drop constraint if exists notification_outbox_kind_check;
alter table public.notification_outbox add constraint notification_outbox_kind_check check (kind in (
  'staff_client_message', 'staff_doc_upload', 'staff_task_assigned', 'staff_feedback_status',
  'client_message', 'client_reports_ready', 'staff_tech_request',
  'handbook_sign_needed', 'handbook_countersign_needed',
  'staff_task_review_ready', 'staff_task_sent_back', 'staff_task_mention',
  'staff_task_client_answered', 'staff_task_batch'));

-- 1. A bookkeeper's review task ---------------------------------------------
select pg_temp.as_user(pg_temp.ctx('bk'));
with r as (
  insert into staff_reminders (staff_email, assignee_email, text, client_id, review_required, due_date)
  values (pg_temp.ctx('bk'), pg_temp.ctx('bk'), 'S3 self-test review task', 'basic-test', true, current_date + 5)
  returning id)
insert into t_ctx select 't1', r.id::text from r;
select pg_temp.ok(public.tk_set_status(pg_temp.ctx('t1')::uuid, 'done') = 'ready_for_review', 'done diverts to ready_for_review');
select pg_temp.ok((select reviewer_email = pg_temp.ctx('a1') and submitted_by = pg_temp.ctx('bk')
                          and ready_at is not null and submitted_at is not null and not done
                     from staff_reminders where id = pg_temp.ctx('t1')::uuid),
                  'entering review stamps submitted_by, ready_at and the AM as reviewer');
select pg_temp.ok((select count(*) = 1 from notification_outbox
                    where kind = 'staff_task_review_ready' and ref_id = pg_temp.ctx('t1') and recipient_email = pg_temp.ctx('a1')),
                  'review-ready email queued for the reviewer only');

-- 2. Who may not approve ----------------------------------------------------
select pg_temp.expect_err(format('select public.tk_approve(%L)', pg_temp.ctx('t1')), 'tk_forbidden', 'bookkeeper cannot approve');
select pg_temp.expect_err(format('select public.tk_send_back(%L, %L)', pg_temp.ctx('t1'), 'please fix'), 'tk_forbidden', 'bookkeeper cannot send back');
select pg_temp.expect_err(format('update staff_reminders set status = %L where id = %L', 'done', pg_temp.ctx('t1')), 'tk_needs_approval', 'bookkeeper direct update to done refused');
select pg_temp.expect_err(format('update staff_reminders set done = true where id = %L', pg_temp.ctx('t1')), 'tk_needs_approval', 'legacy done=true refused while in review');
select pg_temp.expect_err(format('update staff_reminders set send_back_count = 0, approved_at = now() where id = %L', pg_temp.ctx('t1')), 'tk_server_owned', 'server-owned review columns raise (R26)');
select pg_temp.expect_err(format('update staff_reminders set reviewer_email = %L where id = %L', pg_temp.ctx('bk'), pg_temp.ctx('t1')), 'tk_server_owned', 'bookkeeper cannot pick the reviewer');
select pg_temp.as_user(pg_temp.ctx('a1'));
select pg_temp.expect_err(format('update staff_reminders set status = %L where id = %L', 'done', pg_temp.ctx('t1')), 'tk_needs_approval', 'admin direct update to done refused');
select pg_temp.as_user(null);
select pg_temp.expect_err(format('update staff_reminders set status = %L where id = %L', 'done', pg_temp.ctx('t1')), 'tk_needs_approval', 'no-JWT direct update to done refused');
select pg_temp.as_user(pg_temp.ctx('a2'));
select pg_temp.expect_err(format('update staff_reminders set assignee_email = %L where id = %L', pg_temp.ctx('a2'), pg_temp.ctx('t1')), 'tk_in_review', 'no reassigning while in review');
select pg_temp.expect_err(format('select public.tk_set_reviewer(%L, %L)', pg_temp.ctx('t1'), pg_temp.ctx('bk')), 'tk_bad_reviewer', 'reviewer must be an admin, not the assignee');

-- 3. Send back --------------------------------------------------------------
select pg_temp.as_user(pg_temp.ctx('a1'));
select pg_temp.expect_err(format('select public.tk_send_back(%L, %L)', pg_temp.ctx('t1'), '  '), 'tk_reason_required', 'send back needs a reason');
select public.tk_send_back(pg_temp.ctx('t1')::uuid, 'Bank rec is off by $12 - please recheck.');
select pg_temp.ok((select status = 'in_progress' and send_back_count = 1 from staff_reminders where id = pg_temp.ctx('t1')::uuid), 'send back -> in_progress, count 1');
select pg_temp.ok((select count(*) = 1 from tk_activity where task_id = pg_temp.ctx('t1')::uuid and kind = 'review_sent_back'), 'one review_sent_back activity row');
select pg_temp.ok((select count(*) = 1 from tk_comments where task_id = pg_temp.ctx('t1')::uuid and kind = 'send_back'), 'one send_back comment');
select pg_temp.ok((select count(*) = 1 from notification_outbox where kind = 'staff_task_sent_back' and ref_id = pg_temp.ctx('t1') and recipient_email = pg_temp.ctx('bk')), 'sent-back email queued for the bookkeeper');

-- 4. Resubmit, withdraw, resubmit -------------------------------------------
select pg_temp.as_user(pg_temp.ctx('bk'));
insert into t_ctx select 't1_ready', ready_at::text from staff_reminders where id = pg_temp.ctx('t1')::uuid;
select pg_temp.ok(public.tk_ready_for_review(pg_temp.ctx('t1')::uuid) = 'ready_for_review', 'bookkeeper resubmits');
select pg_temp.ok((select ready_at::text = pg_temp.ctx('t1_ready') from staff_reminders where id = pg_temp.ctx('t1')::uuid), 'ready_at keeps the first submission');
select pg_temp.ok(public.tk_withdraw_review(pg_temp.ctx('t1')::uuid) = 'in_progress', 'bookkeeper withdraws');
select pg_temp.ok((select count(*) = 1 from tk_activity where task_id = pg_temp.ctx('t1')::uuid and kind = 'review_withdrawn'), 'withdraw logs review_withdrawn once');
select pg_temp.ok((select count(*) = 1 from tk_activity where task_id = pg_temp.ctx('t1')::uuid and kind = 'review_sent_back'), 'withdraw is not logged as a send back');
select pg_temp.ok(public.tk_set_status(pg_temp.ctx('t1')::uuid, 'done') = 'ready_for_review', 'resubmit through Done');

-- 5. Approve ----------------------------------------------------------------
select pg_temp.as_user(pg_temp.ctx('a1'));
select pg_temp.ok((public.tk_approve(pg_temp.ctx('t1')::uuid) ->> 'ok')::boolean, 'reviewer approves');
select pg_temp.ok((select status = 'done' and done and approved_by = pg_temp.ctx('a1') and approved_at is not null and completed_at is not null
                     from staff_reminders where id = pg_temp.ctx('t1')::uuid), 'approved: done, approved_by, completed_at');
select pg_temp.ok((select count(*) = 1 and bool_and((meta ->> 'first_pass') = 'false') from tk_activity
                    where task_id = pg_temp.ctx('t1')::uuid and kind = 'review_approved'), 'one review_approved row, first_pass false');
select pg_temp.ok((select count(*) = 0 from tk_activity where task_id = pg_temp.ctx('t1')::uuid and kind = 'status' and from_value = 'ready_for_review'),
                  'no duplicate plain status rows for review moves');
select pg_temp.as_user(pg_temp.ctx('bk'));
select pg_temp.expect_err(format('select public.tk_set_status(%L, %L)', pg_temp.ctx('t1'), 'todo'), 'tk_forbidden', 'bookkeeper cannot reopen approved work');

-- 6. No self-approval -------------------------------------------------------
-- 6a. An admin's own task diverts too, and the admin cannot approve it.
select pg_temp.as_user(pg_temp.ctx('a2'));
with r as (
  insert into staff_reminders (staff_email, assignee_email, text, client_id, review_required)
  values (pg_temp.ctx('a2'), pg_temp.ctx('a2'), 'S3 self-test admin task', 'basic-test', true)
  returning id)
insert into t_ctx select 't2', r.id::text from r;
select pg_temp.ok(public.tk_set_status(pg_temp.ctx('t2')::uuid, 'done') = 'ready_for_review', 'admin Done diverts to review too');
select pg_temp.expect_err(format('select public.tk_approve(%L)', pg_temp.ctx('t2')), 'tk_self_review', 'admin cannot approve own task');
select pg_temp.expect_err(format('select public.tk_set_status(%L, %L)', pg_temp.ctx('t2'), 'done'), 'tk_self_review', 'admin cannot approve own task through tk_set_status');
select pg_temp.ok((select reviewer_email is distinct from pg_temp.ctx('a2') from staff_reminders where id = pg_temp.ctx('t2')::uuid), 'reviewer is never the submitter');
-- 6b. Reassign path: an admin submits a bookkeeper's task, then cannot approve it.
with r as (
  insert into staff_reminders (staff_email, assignee_email, text, client_id, review_required)
  values (pg_temp.ctx('a2'), pg_temp.ctx('bk'), 'S3 self-test reassign task', 'basic-test', true)
  returning id)
insert into t_ctx select 't3', r.id::text from r;
update staff_reminders set assignee_email = pg_temp.ctx('a2') where id = pg_temp.ctx('t3')::uuid;   -- reassign to self first
select pg_temp.ok(public.tk_set_status(pg_temp.ctx('t3')::uuid, 'done') = 'ready_for_review', 'reassigned task submitted by the admin');
select pg_temp.expect_err(format('select public.tk_approve(%L)', pg_temp.ctx('t3')), 'tk_self_review', 'admin who reassigned to self and submitted cannot approve');
select pg_temp.as_user(null);
select pg_temp.expect_err(format('select public.tk_approve(%L)', pg_temp.ctx('t3')), 'tk_forbidden', 'no-JWT caller cannot approve');
select pg_temp.as_user(pg_temp.ctx('a1'));
select pg_temp.ok((public.tk_approve(pg_temp.ctx('t3')::uuid) ->> 'ok')::boolean, 'a second admin approves the admin-submitted task');

-- 7. @mention email ----------------------------------------------------------
select pg_temp.as_user(pg_temp.ctx('bk'));
insert into tk_comments (task_id, author_email, body)
values (pg_temp.ctx('t1')::uuid, '', 'Checked again, @' || split_part(pg_temp.ctx('a1'), '@', 1) || ' have a look');
select pg_temp.ok((select count(*) = 1 from notification_outbox where kind = 'staff_task_mention' and ref_id = pg_temp.ctx('t1') and recipient_email = pg_temp.ctx('a1')),
                  '@mention email queued');

-- 8. A month marked Ready for sign-off emails the other admins (S2 follow-up)
select pg_temp.as_user(pg_temp.ctx('a1'));
insert into month_close (client_id, period_kind, period, status)
values ('basic-test', 'month', date '2001-01-01', 'review');
select pg_temp.ok((select count(*) >= 1 and bool_and(recipient_email <> pg_temp.ctx('a1')) from notification_outbox
                    where kind = 'staff_task_review_ready' and ref_id = 'basic-test|month|2001-01-01'),
                  'month in review emails the other admins, not the one who marked it');

-- 9. On-time (decision 8 + M5) on personal tasks an admin made for BK -------
select pg_temp.as_user(pg_temp.ctx('a2'));
update tk_settings set value = to_jsonb((current_date - 30)::text) where key = 'on_time_since';
create temp table t_before on commit drop as
select coalesce((select eligible from public.tk_on_time_stats(current_date - 30, current_date, pg_temp.ctx('bk'))), 0) e,
       coalesce((select on_time from public.tk_on_time_stats(current_date - 30, current_date, pg_temp.ctx('bk'))), 0) o;
-- a. due tomorrow, done now: on time
-- b. due 3 days ago, done now: late
-- c. due 3 days ago, client wait began 5 days ago (before the deadline), done now: on time
-- d. due 3 days ago, client wait began 1 day ago (after the deadline), done now: late
-- e. due 3 days ago, still open: late
-- f. due 3 days ago, deleted now (after the deadline), open: late
-- g. due tomorrow, deleted now (before the deadline): not counted
-- h. BK's own task, due 3 days ago, done now: not counted (self-made)
-- i. due tomorrow, sent back once, approved now: on time
with r as (
  insert into staff_reminders (staff_email, assignee_email, text, due_date)
  select pg_temp.ctx('a2'), pg_temp.ctx('bk'), 'S3 on-time ' || x.k, current_date + x.d
    from (values ('a', 1), ('b', -3), ('c', -3), ('d', -3), ('e', -3), ('f', -3), ('g', 1)) x(k, d)
  returning id, text)
insert into t_ctx select 'ot_' || right(r.text, 1), r.id::text from r;
select pg_temp.as_user(pg_temp.ctx('bk'));
with r as (
  insert into staff_reminders (staff_email, assignee_email, text, due_date)
  values (pg_temp.ctx('bk'), pg_temp.ctx('bk'), 'S3 on-time h', current_date - 3) returning id)
insert into t_ctx select 'ot_h', r.id::text from r;
select pg_temp.as_user(pg_temp.ctx('a2'));
with r as (
  insert into staff_reminders (staff_email, assignee_email, text, due_date, review_required, client_id)
  values (pg_temp.ctx('a2'), pg_temp.ctx('bk'), 'S3 on-time i', current_date + 1, true, null) returning id)
insert into t_ctx select 'ot_i', r.id::text from r;
-- c and d: put into waiting_client, back-date the wait start, then leave it.
update staff_reminders set status = 'waiting_client' where id in (pg_temp.ctx('ot_c')::uuid, pg_temp.ctx('ot_d')::uuid);
alter table public.staff_reminders disable trigger staff_reminders_before_write;
update staff_reminders set waiting_since = now() - interval '5 days' where id = pg_temp.ctx('ot_c')::uuid;
update staff_reminders set waiting_since = now() - interval '1 day' where id = pg_temp.ctx('ot_d')::uuid;
alter table public.staff_reminders enable trigger staff_reminders_before_write;
update staff_reminders set status = 'in_progress' where id in (pg_temp.ctx('ot_c')::uuid, pg_temp.ctx('ot_d')::uuid);
select pg_temp.ok((select waiting_before_due_minutes = 5 * 24 * 60 from staff_reminders where id = pg_temp.ctx('ot_c')::uuid), 'wait that began before the deadline is credited in full');
select pg_temp.ok((select waiting_before_due_minutes = 0 and waiting_minutes = 24 * 60 from staff_reminders where id = pg_temp.ctx('ot_d')::uuid), 'wait that began after the deadline is not credited');
select public.tk_set_status(pg_temp.ctx('ot_' || k)::uuid, 'done') from unnest(array['a','b','c','d']) k;
select pg_temp.as_user(pg_temp.ctx('bk'));
select public.tk_set_status(pg_temp.ctx('ot_h')::uuid, 'done');
select pg_temp.ok(public.tk_set_status(pg_temp.ctx('ot_i')::uuid, 'done') = 'ready_for_review', 'i submitted');
select pg_temp.as_user(pg_temp.ctx('a2'));
select public.tk_send_back(pg_temp.ctx('ot_i')::uuid, 'One more look please');
select pg_temp.as_user(pg_temp.ctx('bk'));
select public.tk_ready_for_review(pg_temp.ctx('ot_i')::uuid);
select pg_temp.as_user(pg_temp.ctx('a2'));
select public.tk_approve(pg_temp.ctx('ot_i')::uuid);
update staff_reminders set deleted_at = now() where id in (pg_temp.ctx('ot_f')::uuid, pg_temp.ctx('ot_g')::uuid);
-- Expected: eligible a b c d e f i = 7 (g deleted early, h self-made); on time a c i = 3.
select pg_temp.ok((select s.eligible - b.e = 7 and s.on_time - b.o = 3
                     from public.tk_on_time_stats(current_date - 30, current_date, pg_temp.ctx('bk')) s, t_before b),
                  'tk_on_time_stats: 7 eligible, 3 on time (OD8, M5, soft-deleted, self-made)');
select pg_temp.as_user(pg_temp.ctx('bk'));
select pg_temp.ok(not exists (select 1 from public.tk_on_time_stats(current_date - 30, current_date, null) where staff_email <> pg_temp.ctx('bk')),
                  'a bookkeeper only sees their own on-time row');

-- 9b. Review stats read columns (test clients are left out, so this uses task i)
select pg_temp.as_user(pg_temp.ctx('a2'));
select pg_temp.ok((select approved >= 1 and sent_back >= 1 from public.tk_review_stats(current_date - 1, current_date, pg_temp.ctx('bk'))),
                  'tk_review_stats counts approvals and send backs');

-- 10. Owner-only setting (M10) ----------------------------------------------
insert into t_ctx
select 'nonowner', lower(s.email) from staff s
 where s.active and s.role = 'admin'
   and not exists (select 1 from internal_access ia where lower(ia.staff_email) = lower(s.email) and ia.is_owner)
 order by s.email limit 1;
select pg_temp.as_user(pg_temp.ctx('nonowner'));
select pg_temp.expect_err($q$insert into tk_settings (key, value) values ('client_request_enabled', 'true')$q$, 'tk_owner_only', 'only the owner flips owner-only switches');
select pg_temp.as_user(null);
select set_config('mgb.tk_owner_override', 'on', true);
insert into tk_settings (key, value) values ('standard_set_live', 'false') on conflict (key) do update set value = excluded.value;
select pg_temp.ok((select count(*) >= 1 from tk_settings_audit where key = 'standard_set_live'), 'owner override is audited');

select 'S3 self-test passed' as result;
rollback;
