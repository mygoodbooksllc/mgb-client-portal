-- =====================================================================
-- Self-test for workbench-1-core.sql.
--
-- Run it whole; it ends in ROLLBACK, so nothing it writes is kept and no
-- email is sent. It never talks to Asana and flips no switch. People are
-- picked at run time; no names or emails live here. A failed check raises.
--
-- Proves: anon cannot call; a client (non-staff) and a bookkeeper asking for
-- "everyone" get 42501; bad scope/source raise; task rows are assignee-only
-- for Mine, unassigned tasks show only in Everyone, tasks past the 7-day
-- window stay out; a review lands with its reviewer; a waiting message is
-- the bookkeeper's, and the backup sees it (covered_for) only while the
-- bookkeeper is out; an acknowledgement-only run clears once staff read it
-- and a question does not; "No reply needed" clears, undo restores, a new
-- client message reopens with a new key, and only the latest client message
-- can be marked; GL flags roll up per client-month and only once due, a
-- reviewed signoff becomes an approve row for the reviewer; a client upload
-- shows until "Mark checked" (firm-wide), undo restores, staff uploads never
-- show; an answered request lands with its asker; snooze is private, capped
-- at 30 days and lifts when the version changes; the state tables cannot be
-- written directly; no outbox row comes from any wb_* call.
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

-- wb_inbox as a user, through the authenticated role (like the app).
create temp table t_inbox (
  item_key text, source text, kind text, source_id text, version text, client_id text, client_name text, period text,
  title text, detail text, owner_email text, covered_for text, any_admin boolean, due_date date, waiting_since timestamptz,
  severity text, item_count integer, status text, snoozed_until timestamptz, cleared boolean, participant_email text, ref_id text
) on commit drop;
grant select, insert, delete on t_inbox to authenticated;
create or replace function pg_temp.inbox(p_email text, p_scope text default 'mine') returns void language plpgsql as $$
begin
  delete from t_inbox;
  perform pg_temp.as_user(p_email);
  set local role authenticated;
  insert into t_inbox select * from public.wb_inbox(p_scope, null, true);
  reset role;
  perform pg_temp.as_user(null);
end $$;
create or replace function pg_temp.has(p_key text) returns boolean language sql as $$
  select exists (select 1 from t_inbox where item_key = p_key)
$$;
create or replace function pg_temp.row(p_key text) returns t_inbox language sql as $$
  select * from t_inbox where item_key = p_key limit 1
$$;
-- Run one wb_* write as a user; returns its text result.
-- Every wb_* write must leave notification_outbox alone (no email).
create or replace function pg_temp.call(p_email text, p_sql text) returns text language plpgsql as $$
declare v text; n0 bigint := pg_temp.outbox();
begin
  perform pg_temp.as_user(p_email);
  set local role authenticated;
  execute p_sql into v;
  reset role;
  perform pg_temp.as_user(null);
  if pg_temp.outbox() <> n0 then raise exception 'SELF-TEST FAILED: % queued an email', p_sql; end if;
  return v;
exception when others then
  reset role;
  perform pg_temp.as_user(null);
  raise;
end $$;
create or replace function pg_temp.msg(p_key text, p_kind text, p_body text, p_min_ago int, p_attach text default null) returns uuid
language plpgsql as $$
declare v uuid;
begin
  insert into client_messages (client_id, participant_email, author_email, author_kind, body, internal, attachment_path, created_at)
  values ('wb-test-1', 'wb-test-contact@example.invalid',
          case when p_kind = 'client' then 'wb-test-contact@example.invalid' else pg_temp.ctx('bk1') end,
          p_kind, p_body, false, p_attach, now() - make_interval(mins => p_min_ago))
  returning id into v;
  insert into t_ctx values (p_key, v::text);
  return v;
end $$;

-- People: a1 = active admin; bk1 (bookkeeper), bk2 (backup) = active bookkeepers.
insert into t_ctx select 'a1', lower(email) from staff where active and role = 'admin' order by email limit 1;
insert into t_ctx select 'bk1', lower(email) from staff where active and role = 'bookkeeper' order by email limit 1;
insert into t_ctx select 'bk2', lower(email) from staff where active and role = 'bookkeeper' order by email offset 1 limit 1;
select pg_temp.ok(pg_temp.ctx('a1') is not null and pg_temp.ctx('bk1') is not null and pg_temp.ctx('bk2') is not null,
                  'test people found');
select pg_temp.ok(public.wb_schema_version() = 1, 'wb_schema_version = 1');

-- A test client: bk1 is the bookkeeper, bk2 the backup, a1 the reviewer.
insert into clients (id, name, org_type, test_only, assigned_bookkeeper_email)
select 'wb-test-1', 'WB test client', org_type, true, pg_temp.ctx('bk1') from clients where id = 'basic-test';
insert into client_profile (client_id, backup_bookkeeper_email, reviewer_email)
values ('wb-test-1', pg_temp.ctx('bk2'), pg_temp.ctx('a1'));
insert into staff_client_access (staff_email, client_id)
select s.email, 'wb-test-1' from staff s where lower(s.email) in (pg_temp.ctx('bk1'), pg_temp.ctx('bk2'))
on conflict do nothing;

-- 1. Access guards ---------------------------------------------------------
set local role anon;
select pg_temp.expect_err($$select * from public.wb_inbox()$$, 'permission denied', 'anon cannot execute wb_inbox');
reset role;
select pg_temp.as_user('wb-test-contact@example.invalid');
set local role authenticated;
select pg_temp.expect_err($$select * from public.wb_inbox()$$, 'wb_forbidden', 'a non-staff user gets 42501');
reset role;
select pg_temp.as_user(pg_temp.ctx('bk1'));
set local role authenticated;
select pg_temp.expect_err($$select * from public.wb_inbox('everyone')$$, 'wb_forbidden', 'a bookkeeper cannot ask for everyone');
select pg_temp.expect_err($$select * from public.wb_inbox('all')$$, 'wb_bad_scope', 'bad scope raises');
select pg_temp.expect_err($$select * from public.wb_inbox('mine', array['task','nope'])$$, 'wb_bad_source', 'bad source raises');
select pg_temp.expect_err($$insert into wb_item_state (staff_email, item_key) values ('x', 'task:task:x')$$, 'permission denied',
                          'wb_item_state cannot be written directly');
select pg_temp.expect_err($$update wb_thread_noreply set undone_at = now()$$, 'permission denied',
                          'wb_thread_noreply cannot be written directly');
select pg_temp.expect_err($$insert into client_file_checks (client_file_id, client_id, checked_by) values (gen_random_uuid(), 'wb-test-1', 'x')$$,
                          'permission denied', 'client_file_checks cannot be written directly');
reset role;
select pg_temp.as_user(null);
select pg_temp.ok(public.wb_is_ack('Thanks!') and public.wb_is_ack('ok, thank you.') and public.wb_is_ack('Got it 👍')
                  and public.wb_is_ack('  Sounds good  '), 'ack phrases match');
select pg_temp.ok(not public.wb_is_ack('Thanks? ') and not public.wb_is_ack('Thanks, can you send the file')
                  and not public.wb_is_ack('') and not public.wb_is_ack(null) and not public.wb_is_ack('okay but the March numbers look off'),
                  'questions and real messages are not acks');


-- 2. Tasks ------------------------------------------------------------------
create or replace function pg_temp.task(p_key text, p_to text, p_due date, p_status text default 'todo') returns uuid
language plpgsql as $$
declare v uuid;
begin
  perform set_config('mgb.tk_unassigned', case when p_to is null then 'on' else '' end, true);
  insert into staff_reminders (staff_email, assignee_email, text, client_id, due_date, visibility, kind, status)
  values (pg_temp.ctx('a1'), p_to, 'WB test ' || p_key, 'wb-test-1', p_due, 'shared', 'task', p_status)
  returning id into v;
  perform set_config('mgb.tk_unassigned', '', true);
  insert into t_ctx values (p_key, v::text);
  return v;
end $$;
select pg_temp.task('T_today', pg_temp.ctx('bk1'), pg_temp.d(0));
select pg_temp.task('T_late', pg_temp.ctx('bk1'), pg_temp.d(-3));
select pg_temp.task('T_far', pg_temp.ctx('bk1'), pg_temp.d(20));
select pg_temp.task('T_none', pg_temp.ctx('bk1'), null);
select pg_temp.task('T_unassigned', null, pg_temp.d(0));
select pg_temp.task('T_review', pg_temp.ctx('bk1'), pg_temp.d(30), 'ready_for_review');
insert into t_ctx select 'reviewer', lower(reviewer_email) from staff_reminders where id = pg_temp.id('T_review');

select pg_temp.inbox(pg_temp.ctx('bk1'));
select pg_temp.ok(pg_temp.has('task:task:' || pg_temp.ctx('T_today')) and pg_temp.has('task:task:' || pg_temp.ctx('T_late')),
                  'bk1 sees own tasks due today and overdue');
select pg_temp.ok(not pg_temp.has('task:task:' || pg_temp.ctx('T_far')) and not pg_temp.has('task:task:' || pg_temp.ctx('T_none')),
                  'tasks past the 7-day window or with no due date stay in My Tasks');
select pg_temp.ok(not pg_temp.has('task:task:' || pg_temp.ctx('T_unassigned')), 'an unassigned task is nobody''s Mine');
select pg_temp.ok((pg_temp.row('task:task:' || pg_temp.ctx('T_today'))).owner_email = pg_temp.ctx('bk1')
                  and (pg_temp.row('task:task:' || pg_temp.ctx('T_today'))).version = 'todo|' || pg_temp.d(0)::text,
                  'task row carries owner and status|due version');
select pg_temp.inbox(pg_temp.ctx('bk2'));
select pg_temp.ok(not pg_temp.has('task:task:' || pg_temp.ctx('T_today')), 'bk2 does not see bk1''s task');
select pg_temp.inbox(pg_temp.ctx('a1'), 'everyone');
select pg_temp.ok(pg_temp.has('task:task:' || pg_temp.ctx('T_unassigned'))
                  and (pg_temp.row('task:task:' || pg_temp.ctx('T_unassigned'))).owner_email is null,
                  'admin Everyone shows the unassigned task with no owner');
select pg_temp.ok(pg_temp.has('review:task_review:' || pg_temp.ctx('T_review'))
                  and (pg_temp.row('review:task_review:' || pg_temp.ctx('T_review'))).due_date <= pg_temp.d(4),
                  'a review waits at most 2 business days, whatever the task due date');
select pg_temp.ok(pg_temp.ctx('reviewer') is null
                  or (pg_temp.row('review:task_review:' || pg_temp.ctx('T_review'))).owner_email = pg_temp.ctx('reviewer'),
                  'the review row belongs to its reviewer');

-- 3. Snooze -----------------------------------------------------------------
select pg_temp.call(pg_temp.ctx('bk1'), format($$select public.wb_snooze(%L, %L, now() + interval '90 days')::text$$,
                    'task:task:' || pg_temp.ctx('T_today'), 'todo|' || pg_temp.d(0)::text));
select pg_temp.inbox(pg_temp.ctx('bk1'));
select pg_temp.ok((pg_temp.row('task:task:' || pg_temp.ctx('T_today'))).snoozed_until between now() + interval '29 days' and now() + interval '30 days 1 minute',
                  'snooze is returned and capped at 30 days');
select pg_temp.ok((select count(*) = 0 from wb_item_state where staff_email = pg_temp.ctx('bk2')), 'control: bk2 has no state');
select pg_temp.as_user(pg_temp.ctx('bk2'));
set local role authenticated;
select pg_temp.ok((select count(*) = 0 from wb_item_state), 'bk2 cannot read bk1''s snoozes');
reset role;
select pg_temp.as_user(pg_temp.ctx('bk1'));
set local role authenticated;
select pg_temp.ok((select count(*) = 1 from wb_item_state), 'bk1 reads own snooze');
select pg_temp.expect_err($$select public.wb_snooze('task:task:x y', null, now() + interval '1 hour')$$, 'wb_bad_key', 'a bad key raises');
select pg_temp.expect_err($$select public.wb_snooze('task:task:x', null, now() - interval '1 hour')$$, 'wb_bad_until', 'a past snooze raises');
reset role;
select pg_temp.as_user(null);
update staff_reminders set due_date = pg_temp.d(1) where id = pg_temp.id('T_today');
select pg_temp.inbox(pg_temp.ctx('bk1'));
select pg_temp.ok((pg_temp.row('task:task:' || pg_temp.ctx('T_today'))).snoozed_until is null,
                  'a changed version lifts the snooze');
select pg_temp.call(pg_temp.ctx('bk1'), format($$select public.wb_snooze(%L, %L, now() + interval '1 day')::text$$,
                    'task:task:' || pg_temp.ctx('T_today'), 'todo|' || pg_temp.d(1)::text));
select pg_temp.call(pg_temp.ctx('bk1'), format($$select public.wb_unsnooze(%L)::text$$, 'task:task:' || pg_temp.ctx('T_today')));
select pg_temp.inbox(pg_temp.ctx('bk1'));
select pg_temp.ok((pg_temp.row('task:task:' || pg_temp.ctx('T_today'))).snoozed_until is null, 'unsnooze clears it');

-- 4. Messages ---------------------------------------------------------------
select pg_temp.msg('M_staff', 'staff', 'Here is your packet.', 120);
select pg_temp.msg('M_q1', 'client', 'Can you send the March statements?', 60);
select pg_temp.msg('M_q2', 'client', 'Also the 990 draft.', 50);
select pg_temp.inbox(pg_temp.ctx('bk1'));
select pg_temp.ok(pg_temp.has('message:message:' || pg_temp.ctx('M_q1')), 'a waiting thread is keyed by the first client message of the run');
select pg_temp.ok((pg_temp.row('message:message:' || pg_temp.ctx('M_q1'))).item_count = 2
                  and (pg_temp.row('message:message:' || pg_temp.ctx('M_q1'))).ref_id = pg_temp.ctx('M_q2')
                  and (pg_temp.row('message:message:' || pg_temp.ctx('M_q1'))).owner_email = pg_temp.ctx('bk1'),
                  'message row: 2 waiting, points at the latest, owned by the bookkeeper');
select pg_temp.inbox(pg_temp.ctx('bk2'));
select pg_temp.ok(not pg_temp.has('message:message:' || pg_temp.ctx('M_q1')), 'the backup does not see it while bk1 is in');
insert into staff_time_off (staff_email, starts_on, ends_on) values (pg_temp.ctx('bk1'), pg_temp.d(-1), pg_temp.d(1));
select pg_temp.inbox(pg_temp.ctx('bk2'));
select pg_temp.ok((pg_temp.row('message:message:' || pg_temp.ctx('M_q1'))).covered_for = pg_temp.ctx('bk1'),
                  'the backup sees it as covered while bk1 is out');
update staff_time_off set cancelled_at = now() where staff_email = pg_temp.ctx('bk1') and starts_on = pg_temp.d(-1);
select pg_temp.expect_err(format('select pg_temp.call(%L, %L)', pg_temp.ctx('bk1'), format('select public.wb_mark_no_reply(%L)::text', pg_temp.ctx('M_q1'))),
                          'wb_not_latest', 'only the latest client message can be marked');
select pg_temp.call(pg_temp.ctx('bk2'), format($$select public.wb_mark_no_reply(%L)::text$$, pg_temp.ctx('M_q2')));
insert into t_ctx select 'NR1', id::text from wb_thread_noreply where through_message_id = pg_temp.id('M_q2');
select pg_temp.ok(pg_temp.call(pg_temp.ctx('bk1'), format($$select public.wb_mark_no_reply(%L)::text$$, pg_temp.ctx('M_q2'))) = pg_temp.ctx('NR1'),
                  'marking twice is idempotent');
select pg_temp.inbox(pg_temp.ctx('bk1'));
select pg_temp.ok(not pg_temp.has('message:message:' || pg_temp.ctx('M_q1')), 'No reply needed clears it firm-wide');
select pg_temp.call(pg_temp.ctx('bk1'), format($$select public.wb_undo_no_reply(%L)::text$$, pg_temp.ctx('NR1')));
select pg_temp.inbox(pg_temp.ctx('bk1'));
select pg_temp.ok(pg_temp.has('message:message:' || pg_temp.ctx('M_q1')), 'undo brings the same item back');
select pg_temp.call(pg_temp.ctx('bk1'), format($$select public.wb_mark_no_reply(%L)::text$$, pg_temp.ctx('M_q2')));
select pg_temp.msg('M_q3', 'client', 'One more thing, the payroll report.', 10);
select pg_temp.inbox(pg_temp.ctx('bk1'));
select pg_temp.ok(not pg_temp.has('message:message:' || pg_temp.ctx('M_q1')) and pg_temp.has('message:message:' || pg_temp.ctx('M_q3')),
                  'a new client message after the marker opens a new item');
select pg_temp.msg('M_reply', 'staff', 'On it.', 5);
select pg_temp.inbox(pg_temp.ctx('bk1'));
select pg_temp.ok(not exists (select 1 from t_inbox where kind = 'message' and client_id = 'wb-test-1'), 'a staff reply clears the thread');
-- acknowledgement-only run: clears once a staff member has read it; a question does not
select pg_temp.msg('M_ack', 'client', 'Thanks so much!', 4);
select pg_temp.inbox(pg_temp.ctx('bk1'));
select pg_temp.ok(pg_temp.has('message:message:' || pg_temp.ctx('M_ack')), 'an unread thank-you still shows');
insert into client_message_reads (client_id, participant_email, reader_email, last_read_at)
values ('wb-test-1', 'wb-test-contact@example.invalid', pg_temp.ctx('bk2'), now())
on conflict (client_id, participant_email, reader_email) do update set last_read_at = excluded.last_read_at;
select pg_temp.inbox(pg_temp.ctx('bk1'));
select pg_temp.ok(not pg_temp.has('message:message:' || pg_temp.ctx('M_ack')), 'a read thank-you clears');
select pg_temp.msg('M_ackq', 'client', 'ok but is the 990 filed?', 3);
select pg_temp.inbox(pg_temp.ctx('bk1'));
select pg_temp.ok(pg_temp.has('message:message:' || pg_temp.ctx('M_ack')), 'a question after it reopens the run (read or not)');

-- 5. Ledger review ----------------------------------------------------------
insert into gl_review_flags (client_id, period, txn_key, flag_type, severity, why, first_period, checks_version, status)
values ('wb-test-1', date_trunc('month', pg_temp.d(-40))::date, 'wbt-1', 'wb_test', 'high', 'test', date_trunc('month', pg_temp.d(-40))::date, 1, 'open'),
       ('wb-test-1', date_trunc('month', pg_temp.d(-40))::date, 'wbt-2', 'wb_test', 'medium', 'test', date_trunc('month', pg_temp.d(-40))::date, 1, 'open'),
       ('wb-test-1', date_trunc('month', pg_temp.d(-40))::date, 'wbt-3', 'wb_test', 'low', 'test', date_trunc('month', pg_temp.d(-40))::date, 1, 'open'),
       ('wb-test-1', date_trunc('month', pg_temp.d(40))::date, 'wbt-4', 'wb_test', 'high', 'test', date_trunc('month', pg_temp.d(40))::date, 1, 'open');
insert into t_ctx values ('P_old', to_char(pg_temp.d(-40), 'YYYY-MM')), ('P_new', to_char(pg_temp.d(40), 'YYYY-MM'));
select pg_temp.inbox(pg_temp.ctx('bk1'));
select pg_temp.ok((pg_temp.row('gl:gl_flags:wb-test-1|' || pg_temp.ctx('P_old'))).item_count = 2
                  and (pg_temp.row('gl:gl_flags:wb-test-1|' || pg_temp.ctx('P_old'))).severity = 'high'
                  and (pg_temp.row('gl:gl_flags:wb-test-1|' || pg_temp.ctx('P_old'))).detail = '2 open (1 high)',
                  'one GL row per client-month: high + medium count, low ignored');
select pg_temp.ok(not pg_temp.has('gl:gl_flags:wb-test-1|' || pg_temp.ctx('P_new')), 'a month not yet due stays out');
insert into gl_review_signoffs (client_id, period, status, reviewed_by, reviewed_at)
values ('wb-test-1', date_trunc('month', pg_temp.d(-40))::date, 'reviewed', pg_temp.ctx('bk1'), now());
select pg_temp.inbox(pg_temp.ctx('bk1'));
select pg_temp.ok(not pg_temp.has('gl:gl_flags:wb-test-1|' || pg_temp.ctx('P_old')), 'a reviewed month leaves the bookkeeper''s list');
select pg_temp.inbox(pg_temp.ctx('a1'));
select pg_temp.ok(pg_temp.has('gl:gl_approve:wb-test-1|' || pg_temp.ctx('P_old')), 'the reviewer gets an approve row');

-- 6. Documents --------------------------------------------------------------
insert into client_files (client_id, drive_file_id, name, year, visibility, uploaded_by, uploaded_at)
values ('wb-test-1', 'wb-test-drive-1', 'WB test receipts.pdf', 2026, 'shared', 'wb-test-contact@example.invalid', now()),
       ('wb-test-1', 'wb-test-drive-2', 'WB test staff file.pdf', 2026, 'shared', pg_temp.ctx('bk1'), now());
insert into t_ctx select 'F1', id::text from client_files where drive_file_id = 'wb-test-drive-1';
insert into t_ctx select 'F2', id::text from client_files where drive_file_id = 'wb-test-drive-2';
select pg_temp.inbox(pg_temp.ctx('bk1'));
select pg_temp.ok(pg_temp.has('doc:doc_upload:' || pg_temp.ctx('F1')) and not pg_temp.has('doc:doc_upload:' || pg_temp.ctx('F2')),
                  'a client upload shows; a staff upload does not');
select pg_temp.call(pg_temp.ctx('bk2'), format($$select public.wb_mark_file_checked(%L, 'filed')::text$$, pg_temp.ctx('F1')));
insert into t_ctx select 'FC1', id::text from client_file_checks where client_file_id = pg_temp.id('F1') and undone_at is null;
select pg_temp.ok(pg_temp.call(pg_temp.ctx('bk1'), format($$select public.wb_mark_file_checked(%L)::text$$, pg_temp.ctx('F1'))) = pg_temp.ctx('FC1'),
                  'mark checked is idempotent');
select pg_temp.inbox(pg_temp.ctx('bk1'));
select pg_temp.ok(not pg_temp.has('doc:doc_upload:' || pg_temp.ctx('F1')), 'mark checked clears it for everyone');
select pg_temp.call(pg_temp.ctx('bk1'), format($$select public.wb_undo_file_checked(%L)::text$$, pg_temp.ctx('FC1')));
select pg_temp.inbox(pg_temp.ctx('bk1'));
select pg_temp.ok(pg_temp.has('doc:doc_upload:' || pg_temp.ctx('F1')), 'undo brings the upload back');
select pg_temp.expect_err(format('select pg_temp.call(%L, %L)', 'wb-test-contact@example.invalid',
                                 format('select public.wb_mark_file_checked(%L)::text', pg_temp.ctx('F1'))),
                          'wb_forbidden', 'a non-staff user cannot mark a file');

-- 7. Client requests (S5) ---------------------------------------------------
insert into client_requests (client_id, kind, title, prompt, status, asked_by, answered_at, reply, task_id)
values ('wb-test-1', 'question', 'WB test question', 'Which account?', 'answered', pg_temp.ctx('a1'), now(), 'Checking', pg_temp.id('T_far'));
insert into t_ctx select 'R1', id::text from client_requests where title = 'WB test question';
select pg_temp.inbox(pg_temp.ctx('bk1'));
select pg_temp.ok(pg_temp.has('task:client_answered:' || pg_temp.ctx('R1'))
                  and (pg_temp.row('task:client_answered:' || pg_temp.ctx('R1'))).ref_id = pg_temp.ctx('T_far'),
                  'an answered request goes to the linked task''s assignee');
update staff_reminders set deleted_at = now() where id = pg_temp.id('T_far');
select pg_temp.inbox(pg_temp.ctx('bk1'));
select pg_temp.ok(not pg_temp.has('task:client_answered:' || pg_temp.ctx('R1')), 'a request whose task is trashed stays out');

-- 8. The inbox stays fast (every wb_* call above already proved it queues no email)
do $$
declare t0 timestamptz; ms numeric;
begin
  perform pg_temp.as_user(pg_temp.ctx('a1'));
  set local role authenticated;
  t0 := clock_timestamp();
  perform count(*) from public.wb_inbox('everyone', null, true);
  ms := extract(epoch from clock_timestamp() - t0) * 1000;
  reset role;
  perform pg_temp.as_user(null);
  raise notice 'wb_inbox(everyone) took % ms', round(ms);
  perform pg_temp.ok(ms < 1500, 'wb_inbox(everyone) finishes well under the bound');
end $$;

select 'Workbench core self-test: all checks passed' as result;
rollback;
