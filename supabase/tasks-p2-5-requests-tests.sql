-- =====================================================================
-- Self-test for tasks-p2-5-requests.sql (Ask client, S5).
--
-- Run it whole; it ends in ROLLBACK, so nothing it writes is kept and no
-- email is sent (S5 has no sender; every send is a dry run). It uses the
-- test clients basic-test and grace-community only. Inside the
-- transaction grace-community stands in for a real client (test_only off)
-- for the B1 and dry-run checks. People are picked at run time; no names
-- or emails of real people live in this file. Link-token values are random
-- bytes kept in a temp table and never selected or printed.
-- A failed check raises and stops the run.
-- =====================================================================
begin;

create temp table t_ctx (k text primary key, v text) on commit drop;
grant all on t_ctx to authenticated;

create or replace function pg_temp.ctx(p_k text) returns text language sql as $$ select v from t_ctx where k = p_k $$;
create or replace function pg_temp.hash(p_k text) returns bytea language sql as $$ select decode(v, 'hex') from t_ctx where k = p_k $$;
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
-- New random 32-byte hash, stored under a key (never returned).
create or replace function pg_temp.new_hash(p_k text) returns void language sql as $$
  insert into t_ctx values (p_k, encode(extensions.gen_random_bytes(32), 'hex'));
$$;
create or replace function pg_temp.issue(p_k text, p_req text, p_contact text, p_email text, p_mode text) returns void
language plpgsql as $$
begin
  perform pg_temp.new_hash('h_' || p_k);
  insert into t_ctx values ('t_' || p_k,
    public.tk_issue_request_token(pg_temp.ctx(p_req)::uuid, p_contact::uuid, p_email, pg_temp.hash('h_' || p_k),
                                  14, 'staff:self-test', true, p_mode)::text);
end $$;

-- People: a1 = admin (basic-test account manager), bk = an active bookkeeper
-- (given basic-test only), cm = an active grace-community portal user.
insert into t_ctx select 'a1', lower(c.account_manager_email) from clients c where c.id = 'basic-test';
insert into t_ctx select 'bk', lower(s.email) from staff s where s.active and s.role = 'bookkeeper' order by s.email limit 1;
insert into t_ctx select 'cm', lower(cu.email) from client_users cu
 where cu.client_id = 'grace-community' and cu.active order by cu.email limit 1;
select pg_temp.ok(exists (select 1 from staff s where lower(s.email) = pg_temp.ctx('a1') and s.active and s.role = 'admin')
                  and pg_temp.ctx('bk') is not null and pg_temp.ctx('cm') is not null,
                  'test people found');
insert into staff_client_access (staff_email, client_id)
select pg_temp.ctx('bk'), 'basic-test'
 where not exists (select 1 from staff_client_access where lower(staff_email) = pg_temp.ctx('bk') and client_id = 'basic-test');
delete from staff_client_access where lower(staff_email) = pg_temp.ctx('bk') and client_id = 'grace-community';
-- grace-community stands in for a real client from here on (rolled back).
update clients set test_only = false, is_internal = false where id = 'grace-community';
select pg_temp.ok(public.tk_schema_version() = 6, 'schema version 6');

-- 1. Legacy document requests (M13) -----------------------------------------
select pg_temp.ok(not exists (select 1 from client_doc_requests d join clients c on c.id = d.client_id
                               where not exists (select 1 from client_requests r where r.id = d.id and r.legacy_doc_request
                                                   and r.status = public.tk__legacy_status(d.status))),
                  'every legacy row (live client) copied with the same id and mapped status');
insert into client_doc_requests (client_id, title, status, requested_by_name) values ('basic-test', 'S5 legacy mirror', 'open', 'Self test');
insert into t_ctx select 'leg', id::text from client_doc_requests where title = 'S5 legacy mirror';
select pg_temp.ok((select legacy_doc_request and status = 'open' and kind = 'document' and needs_upload
                     from client_requests where id = pg_temp.ctx('leg')::uuid), 'new legacy row mirrored');
update client_doc_requests set status = 'uploaded', fulfilled_at = now() where id = pg_temp.ctx('leg')::uuid;
select pg_temp.ok((select status = 'answered' and answered_at is not null from client_requests where id = pg_temp.ctx('leg')::uuid),
                  'legacy update mirrored (uploaded -> answered)');

-- 2. Test tasks (as a1, signed in) ----------------------------------------------
select pg_temp.as_user(pg_temp.ctx('a1'));
set local role authenticated;
insert into staff_reminders (staff_email, assignee_email, text, client_id, due_date)
values (pg_temp.ctx('a1'), pg_temp.ctx('a1'), 'S5 self-test task A', 'grace-community', current_date + 20),
       (pg_temp.ctx('a1'), pg_temp.ctx('a1'), 'S5 self-test task B', 'grace-community', current_date + 20),
       (pg_temp.ctx('a1'), pg_temp.ctx('a1'), 'S5 self-test task C', 'grace-community', current_date + 20);
insert into t_ctx select 'task', id::text from staff_reminders where text = 'S5 self-test task A';
insert into t_ctx select 'task2', id::text from staff_reminders where text = 'S5 self-test task B';
insert into t_ctx select 'task3', id::text from staff_reminders where text = 'S5 self-test task C';
update staff_reminders set status = 'in_progress' where id = pg_temp.ctx('task')::uuid;

-- 3. M12: no direct writes ----------------------------------------------------------
select pg_temp.expect_err($q$insert into client_requests (client_id, title, prompt, asked_by) values ('grace-community', 'x', 'x', 'x')$q$,
                          'permission denied', 'staff cannot insert client_requests directly');
select pg_temp.expect_err($q$update client_requests set title = 'x' where client_id = 'basic-test'$q$,
                          'permission denied', 'staff cannot update client_requests directly');
select pg_temp.expect_err($q$insert into client_contacts (client_id, name, email) values ('grace-community', 'x', 'x@example.invalid')$q$,
                          'permission denied', 'staff cannot insert client_contacts directly');
select pg_temp.expect_err($q$select token_hash from tk_request_tokens$q$, 'permission denied', 'token_hash column not readable');
select pg_temp.ok((select count(*) > 0 from client_requests where client_id = 'basic-test' and legacy_doc_request),
                  'control: admin reads legacy rows');

-- 4. Contacts ---------------------------------------------------------------------------
insert into t_ctx values ('ct', public.tk_save_client_contact(null, 'grace-community', 'S5 Treasurer', 'S5-Treasurer@Example.invalid',
                                                              'treasurer', true, null)::text);
select pg_temp.ok((select email = 's5-treasurer@example.invalid' from client_contacts where id = pg_temp.ctx('ct')::uuid), 'contact saved, email lowercased');
insert into t_ctx values ('ct2', public.tk_save_client_contact(null, 'grace-community', 'S5 Board', 's5-board@example.invalid',
                                                               'board', true, null)::text);
select pg_temp.expect_err($q$select public.tk_save_client_contact(null, 'grace-community', 'Dup', 's5-treasurer@example.invalid')$q$,
                          'tk_contact_exists', 'duplicate contact refused');
select pg_temp.expect_err($q$select public.tk_save_client_contact(null, 'grace-community', 'Bad', 'not-an-email')$q$,
                          'tk_bad_contact', 'bad email refused');
select pg_temp.ok((select jsonb_array_length(public.tk_request_recipients('grace-community') -> 'contacts') = 2
                      and jsonb_array_length(public.tk_request_recipients('grace-community') -> 'portal') >= 1),
                  'recipients list has portal users and contacts');

-- 5. B1 control + ask ----------------------------------------------------------------
reset role;
insert into t_ctx select 'docs_before', count(*)::text from client_doc_requests;
insert into t_ctx select 'log_before', count(*)::text from client_email_log;
select pg_temp.as_user(pg_temp.ctx('a1'));
set local role authenticated;
select pg_temp.expect_err($q$select public.tk_ask_client('grace-community', null, 't', 'p', 'question', false, null, '{}', '{}')$q$,
                          'tk_no_recipients', 'ask without recipients refused');
select pg_temp.expect_err($q$select public.tk_ask_client('grace-community', null, 't', 'p', 'question', false, null,
                             array['nobody-s5@example.invalid'], '{}')$q$, 'tk_bad_recipient', 'ask a non-member refused');
select pg_temp.expect_err(format($q$select public.tk_ask_client('grace-community', null, 't', 'p', 'question', false, %L, array[%L], '{}')$q$,
                                 current_date - 3, pg_temp.ctx('cm')), 'tk_bad_request', 'past due date refused');
select pg_temp.expect_err(format($q$select public.tk_ask_client('basic-test', %L, 't', 'p', 'question', false, null, '{}', array[%L]::uuid[])$q$,
                                 pg_temp.ctx('task'), pg_temp.ctx('ct')), 'tk_bad_recipient', 'contact from another client refused');
insert into t_ctx values ('req', public.tk_ask_client('grace-community', pg_temp.ctx('task')::uuid, 'S5 question', 'Please confirm the bank balance.',
                                                     'question', false, current_date + 7, array[pg_temp.ctx('cm')],
                                                     array[pg_temp.ctx('ct')::uuid])::text);
insert into t_ctx values ('req2', public.tk_ask_client('grace-community', pg_temp.ctx('task')::uuid, 'S5 statement', 'Upload the September statement.',
                                                      'document', true, null, array[pg_temp.ctx('cm')], '{}')::text);
reset role;
select pg_temp.ok((select count(*)::text from client_doc_requests) = pg_temp.ctx('docs_before'),
                  'B1: asking a real client writes no client_doc_requests row (doc-chaser never sees it)');
select pg_temp.ok((select count(*)::text from client_email_log) = pg_temp.ctx('log_before'), 'asking logs no email');
select pg_temp.ok((select status = 'waiting_client' and status_before_wait = 'in_progress' from staff_reminders where id = pg_temp.ctx('task')::uuid),
                  'ask moves the task to Waiting on client');
select pg_temp.ok((select count(*) = 2 from tk_activity where task_id = pg_temp.ctx('task')::uuid and kind = 'client_asked'),
                  'client_asked activity logged');
select pg_temp.ok((select count(*) = 0 from tk_request_tokens where request_id = pg_temp.ctx('req')::uuid), 'asking issues no link');

-- bk has no grace-community access
select pg_temp.as_user(pg_temp.ctx('bk'));
set local role authenticated;
select pg_temp.expect_err(format($q$select public.tk_ask_client('grace-community', %L, 't', 'p', 'question', false, null, array[%L], '{}')$q$,
                                 pg_temp.ctx('task'), pg_temp.ctx('cm')), 'tk_forbidden', 'bookkeeper without access cannot ask');
select pg_temp.expect_err(format($q$select public.tk_list_client_requests(%L)$q$, pg_temp.ctx('task')), 'tk_forbidden',
                          'bookkeeper without access cannot list');
select pg_temp.ok((select count(*) = 0 from client_requests where client_id = 'grace-community'), 'bookkeeper sees no grace-community requests');
select pg_temp.ok((select count(*) = 0 from public.tk_waiting_on_client(null) w where w.client_id = 'grace-community'),
                  'bookkeeper Waiting list leaves out grace-community');

-- 6. Waiting guard ---------------------------------------------------------------------
select pg_temp.as_user(pg_temp.ctx('a1'));
set local role authenticated;
select pg_temp.expect_err(format($q$update staff_reminders set status = 'in_progress' where id = %L$q$, pg_temp.ctx('task')),
                          'tk_has_open_requests', 'cannot leave Waiting with open requests');
select pg_temp.expect_err(format($q$update staff_reminders set done = true where id = %L$q$, pg_temp.ctx('task')),
                          'tk_has_open_requests', 'cannot finish a task with open requests');
update staff_reminders set status = 'waiting_client' where id = pg_temp.ctx('task3')::uuid;
update staff_reminders set status = 'todo' where id = pg_temp.ctx('task3')::uuid;
reset role;
select pg_temp.ok((select status = 'todo' from staff_reminders where id = pg_temp.ctx('task3')::uuid),
                  'control: a manual wait with no requests can be left');

-- 7. Client member reads (column grants) -------------------------------------------
select pg_temp.as_user(pg_temp.ctx('cm'));
set local role authenticated;
select pg_temp.expect_err($q$select recipient_emails from client_requests$q$, 'permission denied', 'client cannot read who else was asked');
select pg_temp.expect_err($q$select asked_by from client_requests$q$, 'permission denied', 'client cannot read asked_by');
select pg_temp.ok((select count(*) = 2 from client_requests where id in (pg_temp.ctx('req')::uuid, pg_temp.ctx('req2')::uuid)),
                  'client reads own requests');
select pg_temp.ok((select count(*) = 0 from client_requests where client_id = 'basic-test'), 'client sees no other client');
select pg_temp.ok((select count(*) = 2 from public.client_requests_for_client('grace-community') x
                    where x.id in (pg_temp.ctx('req')::uuid, pg_temp.ctx('req2')::uuid)), 'client list RPC returns both');
select pg_temp.expect_err($q$select * from public.client_requests_for_client('basic-test')$q$, 'tk_forbidden', 'client list of another client refused');
select pg_temp.expect_err(format($q$select public.tk_list_client_requests(%L)$q$, pg_temp.ctx('task')), 'tk_forbidden', 'client cannot use the staff list');
select pg_temp.expect_err(format($q$select public.tk_client_request_send(%L)$q$, pg_temp.ctx('req')), 'tk_forbidden', 'client cannot send');
select pg_temp.ok((select count(*) = 0 from client_contacts), 'client sees no contacts');

-- 8. Send = dry run ---------------------------------------------------------------------
select pg_temp.as_user(pg_temp.ctx('a1'));
set local role authenticated;
insert into t_ctx values ('send1', public.tk_client_request_send(pg_temp.ctx('req')::uuid, 'send')::text);
insert into t_ctx values ('prev1', public.tk_client_request_send(pg_temp.ctx('req')::uuid, 'preview')::text);
insert into t_ctx values ('nudge1', public.tk_client_request_send(pg_temp.ctx('req')::uuid, 'nudge')::text);
reset role;
select pg_temp.ok((pg_temp.ctx('send1')::jsonb ->> 'mode') = 'dry_run' and (pg_temp.ctx('send1')::jsonb ->> 'dry_run')::boolean
                  and jsonb_array_length(pg_temp.ctx('send1')::jsonb -> 'recipients') = 2, 'switch off: send is a dry run to 2 recipients');
select pg_temp.ok((select count(*) = 2 from client_email_log where request_ids @> array[pg_temp.ctx('req')::uuid]
                    and status = 'skipped' and reason = 'dry_run' and feature in ('client_request', 'client_request_nudge')),
                  'send + nudge log skipped dry runs; preview logs nothing');
select pg_temp.ok((select count(*) = 0 from tk_request_tokens where request_id = pg_temp.ctx('req')::uuid), 'dry run issues no link');
select pg_temp.ok((select nudge_count = 0 from client_requests where id = pg_temp.ctx('req')::uuid), 'dry-run nudge does not count');
update clients set test_only = true where id = 'grace-community';
select pg_temp.as_user(pg_temp.ctx('a1'));
set local role authenticated;
insert into t_ctx values ('send2', public.tk_client_request_send(pg_temp.ctx('req')::uuid, 'preview')::text);
reset role;
select pg_temp.ok((pg_temp.ctx('send2')::jsonb ->> 'mode') = 'test'
                  and (pg_temp.ctx('send2')::jsonb -> 'recipients') = jsonb_build_array(pg_temp.ctx('a1')),
                  'test client: copy goes only to the caller');
update clients set test_only = false where id = 'grace-community';
update client_email_settings set enabled = false;
select pg_temp.as_user(pg_temp.ctx('a1'));
set local role authenticated;
select pg_temp.expect_err(format($q$select public.tk_client_request_send(%L, 'send')$q$, pg_temp.ctx('req')), 'tk_email_off',
                          'client email off: send refused');
reset role;
update client_email_settings set enabled = true;

-- 9. Owner-only switch ----------------------------------------------------------------
do $$
declare v text;
begin
  for v in select lower(s.email) from staff s where s.active and s.role = 'admin' order by s.email loop
    perform pg_temp.as_user(v);
    if not public.is_internal_owner() then
      insert into t_ctx values ('na', v);
      exit;
    end if;
  end loop;
end $$;
select pg_temp.as_user(pg_temp.ctx('na'));
select pg_temp.expect_err($q$update client_email_settings set client_request_enabled = true$q$, 'tk_owner_only',
                          'an admin who is not the owner cannot turn on live Ask-client email');
update client_email_settings set reply_to = reply_to;
select pg_temp.ok((select not client_request_enabled from client_email_settings limit 1), 'control: other edits pass, switch stays off');

-- 10. Link tokens (service-only RPCs; no JWT) -------------------------------------------
select pg_temp.as_user(null);
select pg_temp.ok(not has_function_privilege('authenticated', 'public.tk_token_lookup(bytea)', 'execute')
                  and not has_function_privilege('anon', 'public.tk_answer_request_by_token(bytea, text, jsonb, text)', 'execute')
                  and not has_function_privilege('authenticated', 'public.tk_issue_request_token(uuid, uuid, text, bytea, int, text, boolean, text)', 'execute')
                  and has_function_privilege('service_role', 'public.tk_token_lookup(bytea)', 'execute'),
                  'token RPCs are service-only');
select pg_temp.issue('1', 'req', pg_temp.ctx('ct'), 's5-treasurer@example.invalid', 'send');
select pg_temp.issue('2', 'req', pg_temp.ctx('ct'), 's5-treasurer@example.invalid', 'nudge');
select pg_temp.ok((select count(*) = 2 from tk_request_tokens where request_id = pg_temp.ctx('req')::uuid and revoked_at is null),
                  'M9: a nudge link leaves the earlier link working');
select pg_temp.issue('3', 'req', pg_temp.ctx('ct'), 's5-treasurer@example.invalid', 'resend');
select pg_temp.ok((select count(*) = 2 from tk_request_tokens where id in (pg_temp.ctx('t_1')::uuid, pg_temp.ctx('t_2')::uuid)
                    and revoke_reason = 'reissued'), 'resend revokes earlier links');
select pg_temp.expect_err(format($q$select public.tk_issue_request_token(%L, %L, 'x@example.invalid', extensions.gen_random_bytes(32), 14, 'staff:x', true)$q$,
                                 pg_temp.ctx('req'), pg_temp.ctx('ct2')), 'tk_bad_recipient', 'contact not on the request refused');
select pg_temp.expect_err(format($q$select public.tk_issue_request_token(%L, null, 'x@example.invalid', extensions.gen_random_bytes(16), 14, 'staff:x', true)$q$,
                                 pg_temp.ctx('req')), 'tk_bad_request', 'short hash refused');
select pg_temp.expect_err(format($q$select public.tk_issue_request_token(%L, null, 'x@example.invalid', extensions.gen_random_bytes(32), 14, 'staff:x', true)$q$,
                                 pg_temp.ctx('leg')), 'tk_not_open', 'no links for legacy requests');
insert into t_ctx values ('look3', public.tk_token_lookup(pg_temp.hash('h_3'))::text);
select pg_temp.ok((pg_temp.ctx('look3')::jsonb ->> 'state') = 'ok'
                  and (select array_agg(k order by k) from jsonb_object_keys(pg_temp.ctx('look3')::jsonb -> 'view') k)
                      = array['asked_by_first_name', 'asked_on', 'client_display_name', 'due_date', 'expires_on', 'kind',
                              'needs_upload', 'prompt', 'status', 'title'],
                  'lookup returns only the view fields');
select pg_temp.ok((select view_count = 1 and first_viewed_at is not null from tk_request_tokens where id = pg_temp.ctx('t_3')::uuid),
                  'view counted');
select pg_temp.ok((public.tk_token_lookup(pg_temp.hash('h_1')) ->> 'state') = 'revoked', 'revoked link says revoked');
select pg_temp.ok((public.tk_token_lookup(extensions.gen_random_bytes(32)) ->> 'state') = 'invalid', 'unknown link says invalid');
select pg_temp.issue('4', 'req', pg_temp.ctx('ct'), 's5-treasurer@example.invalid', 'nudge');
select pg_temp.issue('5', 'req', pg_temp.ctx('ct'), 's5-treasurer@example.invalid', 'nudge');
select pg_temp.issue('6', 'req', pg_temp.ctx('ct'), 's5-treasurer@example.invalid', 'nudge');
select pg_temp.issue('7', 'req', pg_temp.ctx('ct'), 's5-treasurer@example.invalid', 'nudge');
select pg_temp.issue('8', 'req', pg_temp.ctx('ct'), 's5-treasurer@example.invalid', 'nudge');
select pg_temp.ok((select count(*) = 5 from tk_request_tokens where request_id = pg_temp.ctx('req')::uuid and contact_id = pg_temp.ctx('ct')::uuid
                    and revoked_at is null)
                  and (select revoke_reason = 'cap' from tk_request_tokens where id = pg_temp.ctx('t_3')::uuid),
                  'cap: at most 5 live links per contact, oldest revoked');
-- expired (portal-user link, no contact)
select pg_temp.issue('x', 'req', null, pg_temp.ctx('cm'), 'send');
update tk_request_tokens set expires_at = now() - interval '1 minute' where id = pg_temp.ctx('t_x')::uuid;
select pg_temp.ok((public.tk_token_lookup(pg_temp.hash('h_x')) ->> 'state') = 'expired', 'expired link says expired');
select pg_temp.ok((public.tk_answer_request_by_token(pg_temp.hash('h_x'), 'late', null, 'iphash') ->> 'error') = 'expired',
                  'expired link cannot answer');
-- rate limit buckets
select pg_temp.ok(public.tk_rate_hit('s5-self-test', 60, 2) and public.tk_rate_hit('s5-self-test', 60, 2)
                  and not public.tk_rate_hit('s5-self-test', 60, 2), 'rate limit: third hit in the window refused');
-- stop reminders
select public.tk_stop_nudges_by_token(pg_temp.hash('h_8'));
select pg_temp.ok((select nudge_paused from client_requests where id = pg_temp.ctx('req')::uuid), 'stop link pauses reminders');

-- answer by link (req; req2 still open so the task keeps waiting)
insert into t_ctx select 'outbox_before', count(*)::text from notification_outbox where kind = 'staff_task_client_answered';
select pg_temp.ok((public.tk_answer_request_by_token(pg_temp.hash('h_8'), 'Balance confirmed.', null, 'iphash') ->> 'ok')::boolean,
                  'answer by link works with no sign-in');
select pg_temp.ok((select status = 'answered' and answered_via = 'link' and answered_by = 'contact:' || pg_temp.ctx('ct')
                     from client_requests where id = pg_temp.ctx('req')::uuid), 'request answered via link');
select pg_temp.ok((select count(*) = 1 from tk_comments where task_id = pg_temp.ctx('task')::uuid and kind = 'client_reply'
                    and author_email = 'contact:' || pg_temp.ctx('ct') and body like 'Answer to "S5 question"%'),
                  'B2: client_reply comment written for the contact');
select pg_temp.ok((select count(*) = 0 from tk_request_tokens where request_id = pg_temp.ctx('req')::uuid and revoked_at is null
                    and answered_at is null), 'other links revoked once answered');
select pg_temp.ok((public.tk_answer_request_by_token(pg_temp.hash('h_7'), 'again', null, 'iphash') ->> 'error') = 'answered_already',
                  'second answer refused');
select pg_temp.ok((select status = 'waiting_client' from staff_reminders where id = pg_temp.ctx('task')::uuid),
                  'task keeps waiting while another request is open');

-- 11. Portal answer (req2) --------------------------------------------------------------
select pg_temp.as_user(pg_temp.ctx('bk'));
set local role authenticated;
select pg_temp.expect_err(format($q$select public.tk_answer_client_request(%L, 'x')$q$, pg_temp.ctx('req2')), 'tk_forbidden',
                          'non-member cannot answer');
select pg_temp.as_user(pg_temp.ctx('cm'));
set local role authenticated;
select pg_temp.expect_err(format($q$select public.tk_answer_client_request(%L, '  ')$q$, pg_temp.ctx('req2')), 'tk_reply_required',
                          'empty answer with no files refused');
select public.tk_answer_client_request(pg_temp.ctx('req2')::uuid, 'Statement is on its way.');
reset role;
select pg_temp.ok((select status = 'answered' and answered_via = 'portal' from client_requests where id = pg_temp.ctx('req2')::uuid),
                  'portal answer saved');
select pg_temp.ok((select count(*) = 1 from tk_comments where task_id = pg_temp.ctx('task')::uuid and kind = 'client_reply'
                    and author_email = 'client:' || pg_temp.ctx('cm')), 'B2: client_reply comment written for the portal user');
select pg_temp.ok((select status = 'in_progress' from staff_reminders where id = pg_temp.ctx('task')::uuid),
                  'last answer resumes the task to its earlier status');
select pg_temp.ok((select count(*) >= 1 from tk_activity where task_id = pg_temp.ctx('task')::uuid and kind = 'client_answered'
                    and actor_email = 'client:' || pg_temp.ctx('cm')), 'client_answered activity names the client');
select pg_temp.ok((select count(*) - pg_temp.ctx('outbox_before')::int = 2 from notification_outbox
                    where kind = 'staff_task_client_answered'), 'assignee notice queued for each client answer');
select pg_temp.ok(current_setting('mgb.tk_request', true) = '' and current_setting('mgb.tk_actor', true) = '', 'flags cleared');

-- 12. Accept, cancel, record, legacy, attempts ------------------------------------------
select pg_temp.as_user(pg_temp.ctx('a1'));
set local role authenticated;
select public.tk_accept_client_request(pg_temp.ctx('req2')::uuid);
insert into t_ctx values ('req3', public.tk_ask_client('grace-community', pg_temp.ctx('task2')::uuid, 'S5 cancel me', 'p', 'approval',
                                                      false, null, array[pg_temp.ctx('cm')], '{}')::text);
select pg_temp.expect_err(format($q$select public.tk_accept_client_request(%L)$q$, pg_temp.ctx('req3')), 'tk_not_answered',
                          'cannot accept an open request');
select public.tk_cancel_client_request(pg_temp.ctx('req3')::uuid, 'Asked by phone instead');
select pg_temp.expect_err(format($q$select public.tk_cancel_client_request(%L)$q$, pg_temp.ctx('req3')), 'tk_not_open', 'cancel twice refused');
select pg_temp.expect_err(format($q$select public.tk_cancel_client_request(%L)$q$, pg_temp.ctx('leg')), 'tk_legacy_request',
                          'legacy requests stay in the Documents panel');
insert into t_ctx values ('req4', public.tk_ask_client('grace-community', pg_temp.ctx('task2')::uuid, 'S5 phone answer', 'p', 'question',
                                                      false, null, array[pg_temp.ctx('cm')], '{}')::text);
insert into t_ctx values ('req5', public.tk_ask_client('grace-community', null, 'S5 no task', 'p', 'question',
                                                      false, null, '{}', array[pg_temp.ctx('ct2')::uuid])::text);
reset role;
select pg_temp.ok((select status = 'accepted' and accepted_at is not null from client_requests where id = pg_temp.ctx('req2')::uuid), 'accepted');
select pg_temp.ok((select status = 'cancelled' and cancel_reason is not null from client_requests where id = pg_temp.ctx('req3')::uuid)
                  and (select count(*) = 1 from tk_comments where task_id = pg_temp.ctx('task2')::uuid and kind = 'system'),
                  'cancel saved with a system note');
insert into t_ctx select 'outbox_mid', count(*)::text from notification_outbox where kind = 'staff_task_client_answered';
select pg_temp.as_user(pg_temp.ctx('a1'));
set local role authenticated;
select public.tk_record_client_answer(pg_temp.ctx('req4')::uuid, 'She said yes on the phone.');
reset role;
select pg_temp.ok((select answered_via = 'staff' from client_requests where id = pg_temp.ctx('req4')::uuid)
                  and (select status = 'todo' from staff_reminders where id = pg_temp.ctx('task2')::uuid)
                  and (select count(*)::text from notification_outbox where kind = 'staff_task_client_answered') = pg_temp.ctx('outbox_mid'),
                  'staff-recorded answer resumes the task and sends no notice');
-- answer attempts cap (req5, contact ct2)
select pg_temp.issue('9', 'req5', pg_temp.ctx('ct2'), 's5-board@example.invalid', 'send');
select public.tk_answer_request_by_token(pg_temp.hash('h_9'), repeat('x', 4001), null, 'iphash');
select public.tk_answer_request_by_token(pg_temp.hash('h_9'), repeat('x', 4001), null, 'iphash');
select public.tk_answer_request_by_token(pg_temp.hash('h_9'), repeat('x', 4001), null, 'iphash');
select pg_temp.ok((public.tk_answer_request_by_token(pg_temp.hash('h_9'), 'ok now', null, 'iphash') ->> 'error') = 'rate_limited',
                  'a link allows at most 3 answer attempts');
-- retire a contact revokes its links
select pg_temp.as_user(pg_temp.ctx('a1'));
set local role authenticated;
select public.tk_retire_client_contact(pg_temp.ctx('ct2')::uuid);
reset role;
select pg_temp.ok((select revoke_reason = 'contact_retired' from tk_request_tokens where id = pg_temp.ctx('t_9')::uuid),
                  'retiring a contact revokes its links');

-- 13. Staff lists --------------------------------------------------------------------------
select pg_temp.as_user(pg_temp.ctx('a1'));
set local role authenticated;
insert into t_ctx values ('list', public.tk_list_client_requests(pg_temp.ctx('task')::uuid)::text);
insert into t_ctx select 'wait', count(*)::text from public.tk_waiting_on_client('grace-community') w where w.request_id = pg_temp.ctx('req5')::uuid;
reset role;
select pg_temp.ok(jsonb_array_length(pg_temp.ctx('list')::jsonb) = 2 and position('token_hash' in pg_temp.ctx('list')) = 0,
                  'drawer list returns the task''s requests and no hashes');
select pg_temp.ok(pg_temp.ctx('wait') = '1', 'Waiting list shows an open request with no task');

-- 14. Append-only events, coverage helper -------------------------------------------------
select pg_temp.expect_err($q$update tk_request_token_events set event = 'view'$q$, 'tk_append_only', 'events cannot be edited');
select pg_temp.expect_err($q$delete from tk_request_token_events$q$, 'tk_append_only', 'events cannot be deleted');
select pg_temp.ok(not has_function_privilege('authenticated', 'public.tk__grant_coverage(uuid, text)', 'execute')
                  and not has_function_privilege('anon', 'public.tk__grant_coverage(uuid, text)', 'execute'),
                  'M1: tk__grant_coverage is internal');
select pg_temp.as_user(pg_temp.ctx('bk'));
select pg_temp.expect_err($q$select public.tk__grant_coverage(gen_random_uuid(), 'basic-test')$q$, 'tk_forbidden',
                          'M1: coverage refuses a non-admin caller');
select pg_temp.as_user(pg_temp.ctx('a1'));
select pg_temp.expect_err($q$select public.tk__grant_coverage(gen_random_uuid(), 'basic-test')$q$, 'tk_bad_request',
                          'control: an admin passes the check and reaches validation');

select 'S5 self-test passed';
rollback;
