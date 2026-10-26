-- =====================================================================
-- Self-test for thread-menu.sql (docs/thread-menu-spec.md section 9).
--
-- Run it whole; it ends in ROLLBACK, so nothing it writes is kept and no
-- email is sent. People are picked at run time (an active admin and two
-- active bookkeepers); the test clients, contacts and tasks are made inside
-- the transaction. No names or emails of real people live here. A failed
-- check raises and stops the run.
--
-- Proves: anon can read neither table and call nothing; authenticated cannot
-- call the private helpers, write the state table or read the audit table;
-- a client member gets 42501 from every RPC and sees no state rows; a
-- bookkeeper with access can label (control characters stripped, 80 cap),
-- hide, mark done, snooze (no past, at most 30 days), pin, assign (active
-- staff with access only, lowercased) and log their own task; another client
-- is 42501 and Restore is admin-only; an admin restores; every write adds
-- exactly one audit row; Done copies a wb_thread_noreply marker from the
-- latest client message once, never claims a Desk marker; Reopen undoes
-- only Done's marker and Restore only Hide's, each handing it over instead
-- while the other state still holds; notification_outbox, client_messages and client_message_reads
-- are untouched; neither table is in any publication.
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
create or replace function pg_temp.audits() returns bigint language sql as $$ select count(*) from client_thread_audit $$;
create or replace function pg_temp.markers() returns bigint language sql as $$
  select count(*) from wb_thread_noreply where client_id in ('tm-test-1', 'tm-test-2')
$$;
create or replace function pg_temp.st(p_email text) returns client_thread_state language sql as $$
  select * from client_thread_state where client_id = 'tm-test-1' and participant_email = p_email
$$;

-- Run one RPC as a user through the authenticated role (like the app).
-- Every successful write adds exactly one audit row.
create or replace function pg_temp.call(p_email text, p_sql text) returns void language plpgsql as $$
declare n0 bigint := pg_temp.audits();
begin
  perform pg_temp.as_user(p_email);
  set local role authenticated;
  execute p_sql;
  reset role;
  perform pg_temp.as_user(null);
  if pg_temp.audits() <> n0 + 1 then raise exception 'SELF-TEST FAILED: % did not add exactly one audit row', p_sql; end if;
exception when others then
  reset role;
  perform pg_temp.as_user(null);
  raise;
end $$;
-- Run one RPC as a user and expect an error (no audit row may be added).
create or replace function pg_temp.call_err(p_email text, p_sql text, p_err text, p_what text) returns void language plpgsql as $$
declare n0 bigint := pg_temp.audits();
begin
  perform pg_temp.as_user(p_email);
  set local role authenticated;
  perform pg_temp.expect_err(p_sql, p_err, p_what);
  reset role;
  perform pg_temp.as_user(null);
  if pg_temp.audits() <> n0 then raise exception 'SELF-TEST FAILED: % added an audit row', p_what; end if;
end $$;
create or replace function pg_temp.msg(p_key text, p_client text, p_contact text, p_kind text, p_internal boolean, p_min_ago int)
returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into client_messages (client_id, participant_email, author_email, author_kind, body, internal, created_at)
  values (p_client, p_contact,
          case when p_kind = 'client' then p_contact else pg_temp.ctx('bk1') end,
          p_kind, 'thread menu test ' || p_key, p_internal, now() - make_interval(mins => p_min_ago))
  returning id into v;
  insert into t_ctx values (p_key, v::text);
  return v;
end $$;

-- People: a1 = active admin; bk1 = bookkeeper with access; bk2 = bookkeeper without.
insert into t_ctx select 'a1', lower(email) from staff where active and role = 'admin' order by email limit 1;
insert into t_ctx select 'bk1', lower(email) from staff where active and role = 'bookkeeper' order by email limit 1;
insert into t_ctx select 'bk2', lower(email) from staff where active and role = 'bookkeeper' order by email offset 1 limit 1;
select pg_temp.ok(pg_temp.ctx('a1') is not null and pg_temp.ctx('bk1') is not null and pg_temp.ctx('bk2') is not null,
                  'test people found');

-- Test clients: bk1 has access to tm-test-1 only.
insert into clients (id, name, org_type, test_only, assigned_bookkeeper_email)
select 'tm-test-1', 'TM test client', org_type, true, pg_temp.ctx('bk1') from clients where id = 'basic-test';
insert into clients (id, name, org_type, test_only)
select 'tm-test-2', 'TM test client 2', org_type, true from clients where id = 'basic-test';
insert into staff_client_access (staff_email, client_id)
select s.email, 'tm-test-1' from staff s where lower(s.email) = pg_temp.ctx('bk1')
on conflict do nothing;
-- An inactive staff member who still holds an access row (must not be assignable).
insert into staff (email, name, role, active) values ('tm-inactive-selftest@mygoodbooks.org', 'TM inactive', 'bookkeeper', false);
insert into staff_client_access (staff_email, client_id) values ('tm-inactive-selftest@mygoodbooks.org', 'tm-test-1');
-- A client member of tm-test-1.
insert into client_users (email, client_id, name, role) values ('tm-contact@example.invalid', 'tm-test-1', 'TM Contact', 'owner');

-- Threads. A: client, staff, client, internal note (latest public client message = a3).
select pg_temp.msg('a1m', 'tm-test-1', 'tm-contact@example.invalid', 'client', false, 40);
select pg_temp.msg('a2m', 'tm-test-1', 'tm-contact@example.invalid', 'staff', false, 30);
select pg_temp.msg('a3m', 'tm-test-1', 'tm-contact@example.invalid', 'client', false, 20);
select pg_temp.msg('a4m', 'tm-test-1', 'tm-contact@example.invalid', 'staff', true, 10);
-- B: one client message, already marked "No reply needed" on the Desk.
select pg_temp.msg('b1m', 'tm-test-1', 'tm-b@example.invalid', 'client', false, 15);
insert into wb_thread_noreply (client_id, participant_email, through_message_id, through_at, reason, marked_by)
select 'tm-test-1', 'tm-b@example.invalid', pg_temp.id('b1m'), created_at, 'no_reply_needed', pg_temp.ctx('bk1')
  from client_messages where id = pg_temp.id('b1m');
insert into t_ctx select 'b_marker', id::text from wb_thread_noreply where through_message_id = pg_temp.id('b1m');
-- C: staff-only thread (no client message, so no marker is ever made).
select pg_temp.msg('c1m', 'tm-test-1', 'tm-c@example.invalid', 'staff', false, 12);
-- Other client.
select pg_temp.msg('o1m', 'tm-test-2', 'tm-other@example.invalid', 'client', false, 5);
-- Tasks: one made by bk1 on tm-test-1, one by bk2 on tm-test-1, one by bk1 on tm-test-2.
with x as (insert into staff_reminders (staff_email, created_by, text, client_id, source)
           values (pg_temp.ctx('bk1'), pg_temp.ctx('bk1'), 'TM test task', 'tm-test-1', 'thread') returning id)
insert into t_ctx select 'task_mine', id::text from x;
with x as (insert into staff_reminders (staff_email, created_by, text, client_id, source)
           values (pg_temp.ctx('bk2'), pg_temp.ctx('bk2'), 'TM test task 2', 'tm-test-1', 'thread') returning id)
insert into t_ctx select 'task_theirs', id::text from x;
with x as (insert into staff_reminders (staff_email, created_by, text, client_id, source)
           values (pg_temp.ctx('bk1'), pg_temp.ctx('bk1'), 'TM test task 3', 'tm-test-2', 'thread') returning id)
insert into t_ctx select 'task_other', id::text from x;

-- Snapshots AFTER the fixtures (their own triggers may queue mail; nothing after may).
insert into t_ctx select 'outbox', count(*)::text from notification_outbox;
insert into t_ctx select 'cm_hash', md5(coalesce(string_agg(m::text, '|' order by m.id), '')) from client_messages m;
insert into t_ctx select 'cmr_hash', md5(coalesce(string_agg(r::text, '|' order by r::text), '')) from client_message_reads r;

-- 1. anon -------------------------------------------------------------------
select pg_temp.as_user(null);
set local role anon;
select pg_temp.expect_err($$select * from public.client_thread_state$$, 'permission denied', 'anon cannot read client_thread_state');
select pg_temp.expect_err($$select * from public.client_thread_audit$$, 'permission denied', 'anon cannot read client_thread_audit');
select pg_temp.expect_err($$select public.thread_set_label('tm-test-1', 'tm-contact@example.invalid', 'x')$$, 'permission denied', 'anon cannot call thread_set_label');
select pg_temp.expect_err($$select public.thread_hide('tm-test-1', 'tm-contact@example.invalid')$$, 'permission denied', 'anon cannot call thread_hide');
select pg_temp.expect_err($$select public.thread_restore('tm-test-1', 'tm-contact@example.invalid')$$, 'permission denied', 'anon cannot call thread_restore');
select pg_temp.expect_err($$select public.thread_set_done('tm-test-1', 'tm-contact@example.invalid', true)$$, 'permission denied', 'anon cannot call thread_set_done');
select pg_temp.expect_err($$select public.thread_snooze('tm-test-1', 'tm-contact@example.invalid', now() + interval '1 day')$$, 'permission denied', 'anon cannot call thread_snooze');
select pg_temp.expect_err($$select public.thread_set_pin('tm-test-1', 'tm-contact@example.invalid', true)$$, 'permission denied', 'anon cannot call thread_set_pin');
select pg_temp.expect_err($$select public.thread_assign('tm-test-1', 'tm-contact@example.invalid', null)$$, 'permission denied', 'anon cannot call thread_assign');
select pg_temp.expect_err($$select public.thread_log_task('tm-test-1', 'tm-contact@example.invalid', gen_random_uuid())$$, 'permission denied', 'anon cannot call thread_log_task');
select pg_temp.expect_err($$select public.thread__guard('tm-test-1', 'tm-contact@example.invalid')$$, 'permission denied', 'anon cannot call thread__guard');
select pg_temp.expect_err($$select public.thread__mark_no_reply('tm-test-1', 'tm-contact@example.invalid')$$, 'permission denied', 'anon cannot call thread__mark_no_reply');
reset role;

-- 2. authenticated (a bookkeeper): no helpers, no direct writes, no audit reads
select pg_temp.as_user(pg_temp.ctx('bk1'));
set local role authenticated;
select pg_temp.expect_err($$select public.thread__guard('tm-test-1', 'tm-contact@example.invalid')$$, 'permission denied', 'authenticated cannot call thread__guard');
select pg_temp.expect_err($$select public.thread__mark_no_reply('tm-test-1', 'tm-contact@example.invalid')$$, 'permission denied', 'authenticated cannot call thread__mark_no_reply');
select pg_temp.expect_err($$select public.thread__row('tm-test-1', 'tm-contact@example.invalid')$$, 'permission denied', 'authenticated cannot call thread__row');
select pg_temp.expect_err($$select public.thread__audit('tm-test-1', 'tm-contact@example.invalid', 'pin', null, null, null)$$, 'permission denied', 'authenticated cannot call thread__audit');
select pg_temp.expect_err($$insert into public.client_thread_state (client_id, participant_email) values ('tm-test-1', 'tm-contact@example.invalid')$$, 'permission denied', 'state table cannot be inserted directly');
select pg_temp.expect_err($$update public.client_thread_state set label = 'x'$$, 'permission denied', 'state table cannot be updated directly');
select pg_temp.expect_err($$select * from public.client_thread_audit$$, 'permission denied', 'audit table cannot be read');
reset role;
select pg_temp.as_user(null);

-- 3. Client member: 42501 everywhere
select pg_temp.call_err('tm-contact@example.invalid', $$select public.thread_set_label('tm-test-1', 'tm-contact@example.invalid', 'x')$$, 'not_staff', 'client: label');
select pg_temp.call_err('tm-contact@example.invalid', $$select public.thread_hide('tm-test-1', 'tm-contact@example.invalid')$$, 'not_staff', 'client: hide');
select pg_temp.call_err('tm-contact@example.invalid', $$select public.thread_restore('tm-test-1', 'tm-contact@example.invalid')$$, 'not_staff', 'client: restore');
select pg_temp.call_err('tm-contact@example.invalid', $$select public.thread_set_done('tm-test-1', 'tm-contact@example.invalid', true)$$, 'not_staff', 'client: done');
select pg_temp.call_err('tm-contact@example.invalid', $$select public.thread_snooze('tm-test-1', 'tm-contact@example.invalid', now() + interval '1 day')$$, 'not_staff', 'client: snooze');
select pg_temp.call_err('tm-contact@example.invalid', $$select public.thread_set_pin('tm-test-1', 'tm-contact@example.invalid', true)$$, 'not_staff', 'client: pin');
select pg_temp.call_err('tm-contact@example.invalid', $$select public.thread_assign('tm-test-1', 'tm-contact@example.invalid', null)$$, 'not_staff', 'client: assign');
select pg_temp.call_err('tm-contact@example.invalid', $$select public.thread_log_task('tm-test-1', 'tm-contact@example.invalid', gen_random_uuid())$$, 'not_staff', 'client: log task');

-- 4. Bookkeeper with access
select pg_temp.call(pg_temp.ctx('bk1'), $$select public.thread_set_label('tm-test-1', 'TM-Contact@Example.invalid', E'  Year-end\n\tpayroll   question \u0007 ')$$);
select pg_temp.ok((pg_temp.st('tm-contact@example.invalid')).label = 'Year-end payroll question', 'label: control characters stripped, spaces collapsed, email lowercased');
select pg_temp.ok((pg_temp.st('tm-contact@example.invalid')).updated_by = pg_temp.ctx('bk1'), 'label: updated_by is the caller');
select pg_temp.call_err(pg_temp.ctx('bk1'), $$select public.thread_set_label('tm-test-1', 'tm-contact@example.invalid', repeat('x', 81))$$, 'bad_label', 'label: 81 characters refused');
select pg_temp.call(pg_temp.ctx('bk1'), $$select public.thread_set_label('tm-test-1', 'tm-contact@example.invalid', repeat('y', 80))$$);
select pg_temp.ok(char_length((pg_temp.st('tm-contact@example.invalid')).label) = 80, 'label: 80 characters kept');
select pg_temp.call(pg_temp.ctx('bk1'), $$select public.thread_set_label('tm-test-1', 'tm-contact@example.invalid', '   ')$$);
select pg_temp.ok((pg_temp.st('tm-contact@example.invalid')).label is null, 'label: blank clears');
select pg_temp.call_err(pg_temp.ctx('bk1'), $$select public.thread_set_label('tm-test-1', 'nobody@example.invalid', 'x')$$, 'no_thread', 'no thread for that email');
select pg_temp.call_err(pg_temp.ctx('bk1'), $$select public.thread_set_label('tm-test-1', '', 'x')$$, 'bad_email', 'blank email refused');
select pg_temp.call_err(pg_temp.ctx('bk1'), $$select public.thread_set_label('tm-test-2', 'tm-other@example.invalid', 'x')$$, 'no_client_access', 'other client: 42501');
select pg_temp.call_err(pg_temp.ctx('bk1'), $$select public.thread_hide('tm-test-2', 'tm-other@example.invalid')$$, 'no_client_access', 'other client: hide refused');
select pg_temp.call_err(pg_temp.ctx('bk2'), $$select public.thread_set_pin('tm-test-1', 'tm-contact@example.invalid', true)$$, 'no_client_access', 'bookkeeper without access: 42501');

-- Snooze
select pg_temp.call_err(pg_temp.ctx('bk1'), $$select public.thread_snooze('tm-test-1', 'tm-contact@example.invalid', now() - interval '1 minute')$$, 'bad_snooze', 'snooze: past refused');
select pg_temp.call_err(pg_temp.ctx('bk1'), $$select public.thread_snooze('tm-test-1', 'tm-contact@example.invalid', now() + interval '31 days')$$, 'bad_snooze', 'snooze: more than 30 days refused');
select pg_temp.call(pg_temp.ctx('bk1'), $$select public.thread_snooze('tm-test-1', 'tm-contact@example.invalid', now() + interval '2 days')$$);
select pg_temp.ok((pg_temp.st('tm-contact@example.invalid')).snoozed_until > now() and (pg_temp.st('tm-contact@example.invalid')).snoozed_at is not null
                  and (pg_temp.st('tm-contact@example.invalid')).snoozed_by = pg_temp.ctx('bk1'), 'snooze: set with who and when');
select pg_temp.call(pg_temp.ctx('bk1'), $$select public.thread_snooze('tm-test-1', 'tm-contact@example.invalid', null)$$);
select pg_temp.ok((pg_temp.st('tm-contact@example.invalid')).snoozed_until is null, 'unsnooze clears');
select pg_temp.ok((select action from client_thread_audit where client_id = 'tm-test-1' order by at desc, id desc limit 1) is not null, 'audit rows written');

-- Pin
select pg_temp.call(pg_temp.ctx('bk1'), $$select public.thread_set_pin('tm-test-1', 'tm-contact@example.invalid', true)$$);
select pg_temp.ok((pg_temp.st('tm-contact@example.invalid')).pinned_at is not null, 'pin sets pinned_at');
select pg_temp.call(pg_temp.ctx('bk1'), $$select public.thread_set_pin('tm-test-1', 'tm-contact@example.invalid', false)$$);
select pg_temp.ok((pg_temp.st('tm-contact@example.invalid')).pinned_at is null, 'unpin clears');

-- Assign
select pg_temp.call_err(pg_temp.ctx('bk1'), $$select public.thread_assign('tm-test-1', 'tm-contact@example.invalid', 'tm-inactive-selftest@mygoodbooks.org')$$, 'bad_assignee', 'assign: inactive staff refused');
select pg_temp.call_err(pg_temp.ctx('bk1'), format($q$select public.thread_assign('tm-test-1', 'tm-contact@example.invalid', %L)$q$, pg_temp.ctx('bk2')), 'bad_assignee', 'assign: staff without access refused');
select pg_temp.call_err(pg_temp.ctx('bk1'), $$select public.thread_assign('tm-test-1', 'tm-contact@example.invalid', 'tm-contact@example.invalid')$$, 'bad_assignee', 'assign: non-staff refused');
select pg_temp.call(pg_temp.ctx('bk1'), format($q$select public.thread_assign('tm-test-1', 'tm-contact@example.invalid', %L)$q$, '  ' || upper(pg_temp.ctx('bk1')) || ' '));
select pg_temp.ok((pg_temp.st('tm-contact@example.invalid')).assignee_email = pg_temp.ctx('bk1'), 'assign: mixed case lowercased');
select pg_temp.call(pg_temp.ctx('bk1'), format($q$select public.thread_assign('tm-test-1', 'tm-contact@example.invalid', %L)$q$, pg_temp.ctx('a1')));
select pg_temp.ok((pg_temp.st('tm-contact@example.invalid')).assignee_email = pg_temp.ctx('a1'), 'assign: an admin is assignable');
select pg_temp.call(pg_temp.ctx('bk1'), $$select public.thread_assign('tm-test-1', 'tm-contact@example.invalid', '')$$);
select pg_temp.ok((pg_temp.st('tm-contact@example.invalid')).assignee_email is null, 'assign: blank clears');

-- Log task
select pg_temp.call(pg_temp.ctx('bk1'), format($q$select public.thread_log_task('tm-test-1', 'tm-contact@example.invalid', %L::uuid)$q$, pg_temp.ctx('task_mine')));
select pg_temp.ok(exists (select 1 from client_thread_audit where action = 'task' and to_value ->> 'task_id' = pg_temp.ctx('task_mine')), 'log task: audit has the task id');
select pg_temp.call_err(pg_temp.ctx('bk1'), format($q$select public.thread_log_task('tm-test-1', 'tm-contact@example.invalid', %L::uuid)$q$, pg_temp.ctx('task_theirs')), 'bad_task', 'log task: someone else''s task refused');
select pg_temp.call_err(pg_temp.ctx('bk1'), format($q$select public.thread_log_task('tm-test-1', 'tm-contact@example.invalid', %L::uuid)$q$, pg_temp.ctx('task_other')), 'bad_task', 'log task: task on another client refused');

-- 5. Done, Hide and the Desk markers
insert into t_ctx select 'm0', pg_temp.markers()::text;
select pg_temp.call(pg_temp.ctx('bk1'), $$select public.thread_set_done('tm-test-1', 'tm-contact@example.invalid', true)$$);
select pg_temp.ok(pg_temp.markers() = pg_temp.ctx('m0')::bigint + 1, 'done: one marker inserted');
insert into t_ctx select 'a_marker', (pg_temp.st('tm-contact@example.invalid')).done_marker_id::text;
select pg_temp.ok(exists (select 1 from wb_thread_noreply n join client_messages m on m.id = n.through_message_id
                            where n.id = pg_temp.id('a_marker') and m.id = pg_temp.id('a3m')
                              and n.through_at = m.created_at and n.participant_email = m.participant_email
                              and n.client_id = m.client_id and n.reason = 'no_reply_needed' and n.marked_by = pg_temp.ctx('bk1')
                              and n.undone_at is null),
                  'done: marker copied from the latest public client message (not the internal note or staff reply)');
select pg_temp.ok((select marker_id from client_thread_audit where action = 'done' order by at desc, id desc limit 1) = pg_temp.id('a_marker'),
                  'done: audit row carries the marker id');
select pg_temp.call(pg_temp.ctx('bk1'), $$select public.thread_set_done('tm-test-1', 'tm-contact@example.invalid', true)$$);
select pg_temp.ok(pg_temp.markers() = pg_temp.ctx('m0')::bigint + 1, 'second done: no new marker');
select pg_temp.ok((pg_temp.st('tm-contact@example.invalid')).done_marker_id = pg_temp.id('a_marker'), 'second done: keeps its marker');
select pg_temp.call(pg_temp.ctx('bk1'), $$select public.thread_hide('tm-test-1', 'tm-contact@example.invalid')$$);
select pg_temp.ok(pg_temp.markers() = pg_temp.ctx('m0')::bigint + 1
                  and (pg_temp.st('tm-contact@example.invalid')).hide_marker_id is null, 'hide after done: no new marker, none claimed');
select pg_temp.ok((pg_temp.st('tm-contact@example.invalid')).hidden_at is not null
                  and (pg_temp.st('tm-contact@example.invalid')).hidden_by = pg_temp.ctx('bk1'), 'hide: hidden_at and hidden_by set');
select pg_temp.call_err(pg_temp.ctx('bk1'), $$select public.thread_restore('tm-test-1', 'tm-contact@example.invalid')$$, 'admin_only', 'restore: a bookkeeper gets 42501');
select pg_temp.call(pg_temp.ctx('bk1'), $$select public.thread_set_done('tm-test-1', 'tm-contact@example.invalid', false)$$);
select pg_temp.ok((select undone_at is null from wb_thread_noreply where id = pg_temp.id('a_marker'))
                  and (pg_temp.st('tm-contact@example.invalid')).hide_marker_id = pg_temp.id('a_marker'),
                  'reopen while hidden: hands its marker to Hide (the Desk row stays off)');
select pg_temp.ok((pg_temp.st('tm-contact@example.invalid')).done_at is null and (pg_temp.st('tm-contact@example.invalid')).done_marker_id is null,
                  'reopen: done cleared');
select pg_temp.ok((select to_value from client_thread_audit where action = 'reopen' order by at desc, id desc limit 1)
                  = jsonb_build_object('handed_marker', pg_temp.id('a_marker')), 'reopen: audit says the marker was handed over');
select pg_temp.call(pg_temp.ctx('a1'), $$select public.thread_restore('tm-test-1', 'tm-contact@example.invalid')$$);
select pg_temp.ok((pg_temp.st('tm-contact@example.invalid')).hidden_at is null
                  and (pg_temp.st('tm-contact@example.invalid')).hide_marker_id is null, 'restore: an admin restores');
select pg_temp.ok((select undone_at is not null and undone_by = pg_temp.ctx('a1') from wb_thread_noreply where id = pg_temp.id('a_marker')),
                  'restore: undoes the marker Hide holds');

-- Hide after the marker was undone: a fresh marker, claimed by the state row.
select pg_temp.call(pg_temp.ctx('bk1'), $$select public.thread_hide('tm-test-1', 'tm-contact@example.invalid')$$);
select pg_temp.ok(pg_temp.markers() = pg_temp.ctx('m0')::bigint + 2
                  and (pg_temp.st('tm-contact@example.invalid')).hide_marker_id is not null
                  and (pg_temp.st('tm-contact@example.invalid')).hide_marker_id <> pg_temp.id('a_marker')
                  and (pg_temp.st('tm-contact@example.invalid')).done_marker_id is null,
                  'hide: a fresh marker when none is live, kept apart from Done');
insert into t_ctx select 'a_marker2', (pg_temp.st('tm-contact@example.invalid')).hide_marker_id::text;
select pg_temp.call(pg_temp.ctx('bk1'), $$select public.thread_set_done('tm-test-1', 'tm-contact@example.invalid', true)$$);
select pg_temp.ok((pg_temp.st('tm-contact@example.invalid')).done_marker_id is null
                  and pg_temp.markers() = pg_temp.ctx('m0')::bigint + 2, 'done while hidden: no new marker, none claimed');
select pg_temp.call(pg_temp.ctx('bk1'), $$select public.thread_set_done('tm-test-1', 'tm-contact@example.invalid', false)$$);
select pg_temp.ok((select undone_at is null from wb_thread_noreply where id = pg_temp.id('a_marker2')),
                  'reopen: leaves the marker Hide made alone');
select pg_temp.call(pg_temp.ctx('a1'), $$select public.thread_restore('tm-test-1', 'tm-contact@example.invalid')$$);
select pg_temp.ok((select undone_at is not null from wb_thread_noreply where id = pg_temp.id('a_marker2')),
                  'restore (Undo of Hide): undoes the marker Hide made');
-- Hide, then Done, then Restore while still done: the marker passes to Done; Reopen then undoes it.
select pg_temp.call(pg_temp.ctx('bk1'), $$select public.thread_hide('tm-test-1', 'tm-contact@example.invalid')$$);
insert into t_ctx select 'a_marker3', (pg_temp.st('tm-contact@example.invalid')).hide_marker_id::text;
select pg_temp.call(pg_temp.ctx('bk1'), $$select public.thread_set_done('tm-test-1', 'tm-contact@example.invalid', true)$$);
select pg_temp.call(pg_temp.ctx('a1'), $$select public.thread_restore('tm-test-1', 'tm-contact@example.invalid')$$);
select pg_temp.ok((select undone_at is null from wb_thread_noreply where id = pg_temp.id('a_marker3'))
                  and (pg_temp.st('tm-contact@example.invalid')).done_marker_id = pg_temp.id('a_marker3')
                  and (pg_temp.st('tm-contact@example.invalid')).hide_marker_id is null,
                  'restore while done: hands the marker to Done (the Desk row stays off)');
select pg_temp.call(pg_temp.ctx('bk1'), $$select public.thread_set_done('tm-test-1', 'tm-contact@example.invalid', false)$$);
select pg_temp.ok((select undone_at is not null from wb_thread_noreply where id = pg_temp.id('a_marker3')),
                  'reopen: undoes the handed-over marker');

-- Thread B: the Desk marker is never claimed.
select pg_temp.call(pg_temp.ctx('bk1'), $$select public.thread_set_done('tm-test-1', 'tm-b@example.invalid', true)$$);
select pg_temp.ok((pg_temp.st('tm-b@example.invalid')).done_marker_id is null, 'done: an existing Desk marker is not claimed');
select pg_temp.ok(pg_temp.markers() = pg_temp.ctx('m0')::bigint + 3, 'done on a Desk-marked thread: no new marker');
select pg_temp.call(pg_temp.ctx('bk1'), $$select public.thread_set_done('tm-test-1', 'tm-b@example.invalid', false)$$);
select pg_temp.ok((select undone_at is null from wb_thread_noreply where id = pg_temp.id('b_marker')), 'reopen: leaves the Desk marker alone');

-- Thread C: staff-only, so Done makes no marker.
select pg_temp.call(pg_temp.ctx('bk1'), $$select public.thread_set_done('tm-test-1', 'tm-c@example.invalid', true)$$);
select pg_temp.ok((pg_temp.st('tm-c@example.invalid')).done_at is not null and (pg_temp.st('tm-c@example.invalid')).done_marker_id is null
                  and pg_temp.markers() = pg_temp.ctx('m0')::bigint + 3, 'done without a client message: no marker');

-- 6. Reads through RLS
select pg_temp.as_user('tm-contact@example.invalid');
set local role authenticated;
select pg_temp.ok((select count(*) from public.client_thread_state) = 0, 'client member reads no state rows');
reset role;
select pg_temp.as_user(pg_temp.ctx('bk2'));
set local role authenticated;
select pg_temp.ok((select count(*) from public.client_thread_state where client_id = 'tm-test-1') = 0, 'bookkeeper without access reads no state rows');
reset role;
select pg_temp.as_user(pg_temp.ctx('bk1'));
set local role authenticated;
select pg_temp.ok((select count(*) from public.client_thread_state where client_id = 'tm-test-1') = 3, 'bookkeeper with access reads the rows');
reset role;
select pg_temp.as_user(null);

-- 7. Nothing else touched, nothing published
select pg_temp.ok((select count(*) from notification_outbox)::text = pg_temp.ctx('outbox'), 'no email queued');
select pg_temp.ok((select md5(coalesce(string_agg(m::text, '|' order by m.id), '')) from client_messages m) = pg_temp.ctx('cm_hash'), 'client_messages unchanged');
select pg_temp.ok((select md5(coalesce(string_agg(r::text, '|' order by r::text), '')) from client_message_reads r) = pg_temp.ctx('cmr_hash'), 'client_message_reads unchanged');
select pg_temp.ok(not exists (select 1 from pg_publication_tables where tablename in ('client_thread_state', 'client_thread_audit')),
                  'neither table is in any publication');
select pg_temp.ok(not exists (select 1 from pg_policies where tablename = 'client_thread_state' and cmd in ('INSERT', 'UPDATE', 'DELETE')),
                  'no write policy on client_thread_state');
select pg_temp.ok(not exists (select 1 from pg_policies where tablename = 'client_thread_audit'), 'no policy on client_thread_audit');

select 'thread-menu self-test passed' as result;
rollback;
