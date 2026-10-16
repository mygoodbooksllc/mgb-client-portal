-- =====================================================================
-- Self-test for tasks-p2-6-tokens.sql (Ask client links, S6). Supersedes
-- tasks-p2-5-requests-tests.sql (S5's file uses the old token signatures
-- and writes client_doc_requests directly, which S6 forbids).
--
-- Run it whole; it ends in ROLLBACK, so nothing it writes is kept and no
-- email is sent (SQL never sends). Clients: basic-test and grace-community
-- (test clients). Inside the transaction grace-community stands in for a
-- real client (test_only off). One extra portal user and two contacts with
-- .invalid addresses are made up here and rolled back. Link-token values
-- are random bytes kept in a temp table and never selected or printed.
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
create or replace function pg_temp.new_hash(p_k text) returns void language sql as $$
  insert into t_ctx values (p_k, encode(extensions.gen_random_bytes(32), 'hex'));
$$;
-- Real (not test) link for a recipient; actor is the admin a1.
create or replace function pg_temp.issue(p_k text, p_req text, p_contact text, p_email text, p_mode text) returns void
language plpgsql as $$
begin
  perform pg_temp.new_hash('h_' || p_k);
  insert into t_ctx values ('t_' || p_k,
    public.tk_issue_request_token(pg_temp.ctx(p_req)::uuid, p_contact::uuid, p_email, pg_temp.hash('h_' || p_k),
                                  14, 'staff:' || pg_temp.ctx('a1'), false, p_mode)::text);
end $$;
create or replace function pg_temp.live(p_k text) returns boolean language sql as $$
  select revoked_at is null from tk_request_tokens where id = pg_temp.ctx('t_' || p_k)::uuid
$$;

-- People: a1 = admin (basic-test account manager), bk = an active bookkeeper
-- (basic-test only), cm = an active grace-community portal user, cm2 = a
-- made-up second portal user.
insert into t_ctx select 'a1', lower(c.account_manager_email) from clients c where c.id = 'basic-test';
insert into t_ctx select 'bk', lower(s.email) from staff s where s.active and s.role = 'bookkeeper' order by s.email limit 1;
insert into t_ctx select 'cm', lower(cu.email) from client_users cu
 where cu.client_id = 'grace-community' and cu.active order by cu.email limit 1;
insert into t_ctx values ('cm2', 's6-portal-two@example.invalid');
insert into client_users (email, client_id, name, role, active)
select pg_temp.ctx('cm2'), 'grace-community', 'S6 Portal Two', cu.role, true
  from client_users cu where lower(cu.email) = pg_temp.ctx('cm') and cu.client_id = 'grace-community';
select pg_temp.ok(exists (select 1 from staff s where lower(s.email) = pg_temp.ctx('a1') and s.active and s.role = 'admin')
                  and pg_temp.ctx('bk') is not null and pg_temp.ctx('cm') is not null
                  and exists (select 1 from client_users where email = pg_temp.ctx('cm2')),
                  'test people found');
insert into staff_client_access (staff_email, client_id)
select pg_temp.ctx('bk'), 'basic-test'
 where not exists (select 1 from staff_client_access where lower(staff_email) = pg_temp.ctx('bk') and client_id = 'basic-test');
delete from staff_client_access where lower(staff_email) = pg_temp.ctx('bk') and client_id = 'grace-community';
update clients set test_only = false, is_internal = false where id = 'grace-community';
select pg_temp.ok(public.tk_schema_version() >= 7, 'schema version 7 or later');
-- The owner turned Ask client emails live on 2026-10-16. These checks start
-- from off inside this transaction only; it ends in ROLLBACK, so the live
-- value (and its audit trail) is untouched.
select set_config('mgb.tk_owner_override', 'on', true);
update client_email_settings set client_request_enabled = false where id = true;
select set_config('mgb.tk_owner_override', '', true);
select pg_temp.ok(not (select client_request_enabled from client_email_settings limit 1), 'Ask-client email switch is off for this test');

-- 1. Old signatures gone, grants ------------------------------------------------------
select pg_temp.ok(to_regprocedure('public.tk_token_lookup(bytea)') is null
                  and to_regprocedure('public.tk_answer_request_by_token(bytea, text, jsonb, text)') is null
                  and to_regprocedure('public.tk_stop_nudges_by_token(bytea)') is null
                  and to_regprocedure('public.tk_client_request_send(uuid, text)') is null, 'superseded signatures dropped');
select pg_temp.ok(
  (select bool_and(not has_function_privilege('authenticated', f, 'execute') and not has_function_privilege('anon', f, 'execute')
                   and has_function_privilege('service_role', f, 'execute'))
     from unnest(array['public.tk_token_lookup(bytea, text)', 'public.tk_token_gate(bytea, text)',
                       'public.tk_stage_request_file_by_token(bytea, jsonb, text)',
                       'public.tk_answer_request_by_token(bytea, text, uuid[], text)', 'public.tk_stop_nudges_by_token(bytea, text)',
                       'public.tk_rate_peek(text, int, int)', 'public.tk_request_send_claim(uuid, text, text, text, text[], text)',
                       'public.tk_request_send_finish(uuid, text, text, text[], text)', 'public.tk_nudge_plan()',
                       'public.tk_nudge_mark(uuid[])',
                       'public.tk_issue_request_token(uuid, uuid, text, bytea, int, text, boolean, text)']) f),
  'token, sender and nudge RPCs are service-only');
select pg_temp.ok(has_function_privilege('authenticated', 'public.tk_add_doc_request(text, text, text, date)', 'execute')
                  and not has_function_privilege('anon', 'public.tk_add_doc_request(text, text, text, date)', 'execute')
                  and has_function_privilege('authenticated', 'public.tk_client_request_send(uuid, text, text)', 'execute'),
                  'staff RPCs callable when signed in only');

-- 2. Trigger-only helpers (S4 leftover) -------------------------------------------------
select pg_temp.as_user(pg_temp.ctx('a1'));
set local role authenticated;
select pg_temp.ok(public.tk__trg_is_admin(pg_temp.ctx('a1')) = false
                  and public.tk__trg_default_reviewer('basic-test', '{}') is null,
                  'direct calls to the trigger helpers learn nothing');
insert into staff_reminders (staff_email, assignee_email, text, client_id, due_date)
values (pg_temp.ctx('a1'), pg_temp.ctx('a1'), 'S6 self-test task A', 'grace-community', current_date + 20),
       (pg_temp.ctx('a1'), pg_temp.ctx('a1'), 'S6 self-test task B', 'grace-community', current_date + 20);
insert into t_ctx select 'task', id::text from staff_reminders where text = 'S6 self-test task A';
insert into t_ctx select 'task2', id::text from staff_reminders where text = 'S6 self-test task B';
select pg_temp.ok(pg_temp.ctx('task') is not null, 'control: task writes (which use the helpers in a trigger) still work');

-- 3. client_doc_requests is read-only -----------------------------------------------------
select pg_temp.expect_err($q$insert into client_doc_requests (client_id, title, requested_by_name) values ('basic-test', 'x', 'x')$q$,
                          'permission denied', 'staff cannot insert client_doc_requests directly');
select pg_temp.expect_err($q$update client_doc_requests set title = title where client_id = 'basic-test'$q$,
                          'permission denied', 'staff cannot update client_doc_requests directly');
insert into t_ctx values ('doc', public.tk_add_doc_request('basic-test', 'S6 legacy doc', 'details', current_date + 5)::text);
insert into t_ctx values ('doc2', public.tk_add_doc_request('grace-community', 'S6 portal upload', null, null)::text);
select public.tk_set_doc_request_status(pg_temp.ctx('doc')::uuid, 'done');
select pg_temp.ok(current_setting('mgb.tk_legacy_write', true) = '', 'bypass flag cleared after the RPC');
select pg_temp.as_user(pg_temp.ctx('bk'));
select pg_temp.expect_err($q$select public.tk_add_doc_request('grace-community', 'x')$q$, 'tk_forbidden',
                          'bookkeeper without access cannot add a document request');
select pg_temp.expect_err(format($q$select public.tk_set_doc_request_status(%L, 'open')$q$, pg_temp.ctx('doc2')), 'tk_forbidden',
                          'bookkeeper without access cannot change one');
select pg_temp.as_user(pg_temp.ctx('cm'));
select public.fulfill_doc_request(pg_temp.ctx('doc2')::uuid, 'grace-community/' || pg_temp.ctx('doc2') || '/s6.pdf', 's6.pdf');
reset role;
select pg_temp.ok((select status = 'done' and closed_at is not null from client_doc_requests where id = pg_temp.ctx('doc')::uuid)
                  and (select legacy_doc_request and status = public.tk__legacy_status('done') from client_requests where id = pg_temp.ctx('doc')::uuid),
                  'staff RPCs write the legacy table and the mirror follows');
select pg_temp.ok((select status = 'uploaded' from client_doc_requests where id = pg_temp.ctx('doc2')::uuid),
                  'control: a portal upload (fulfill_doc_request) still marks the request uploaded');
select pg_temp.expect_err($q$insert into client_doc_requests (client_id, title, requested_by_name) values ('basic-test', 'x', 'x')$q$,
                          'tk_legacy_read_only', 'even the owner role cannot write without the flag');
select set_config('mgb.tk_legacy_write', 'on', true);
delete from client_doc_requests where id = pg_temp.ctx('doc')::uuid;
select set_config('mgb.tk_legacy_write', '', true);
select pg_temp.ok((select deleted_at is not null from client_requests where id = pg_temp.ctx('doc')::uuid),
                  'a deleted legacy row is soft-deleted in client_requests');
select pg_temp.ok((select confrelid = 'public.client_requests'::regclass from pg_constraint
                    where conname = 'client_doc_chase_request_id_fkey'), 'chase FK points at client_requests');
select pg_temp.ok(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'client_requests'),
                  'client_requests is in the realtime publication');
select pg_temp.ok(exists (select 1 from cron.job where jobname = 'client-request-nudge' and schedule = '0 14 * * 1-5')
                  and position('client_request_nudge' in pg_get_functiondef('public.client_emails_cron(text)'::regprocedure)) > 0,
                  'nudge cron scheduled and whitelisted');

-- 4. Ask (contacts + two portal users) ------------------------------------------------------
select pg_temp.as_user(pg_temp.ctx('a1'));
set local role authenticated;
insert into t_ctx values ('ct', public.tk_save_client_contact(null, 'grace-community', 'S6 Treasurer', 's6-treasurer@example.invalid',
                                                              'treasurer', true, null)::text);
insert into t_ctx values ('req', public.tk_ask_client('grace-community', pg_temp.ctx('task')::uuid, 'S6 question', 'Please confirm the balance.',
                                                     'question', false, current_date + 7, array[pg_temp.ctx('cm'), pg_temp.ctx('cm2')],
                                                     array[pg_temp.ctx('ct')::uuid])::text);
insert into t_ctx values ('req2', public.tk_ask_client('grace-community', pg_temp.ctx('task')::uuid, 'S6 statement', 'Upload the statement.',
                                                      'document', true, null, array[pg_temp.ctx('cm')], '{}')::text);
insert into t_ctx values ('reqm', public.tk_ask_client('grace-community', pg_temp.ctx('task2')::uuid, 'S6 moved', 'p',
                                                      'question', false, null, array[pg_temp.ctx('cm')], '{}')::text);
reset role;

-- 5. STEP 1: per-recipient links -------------------------------------------------------------
select pg_temp.expect_err(format($q$select public.tk_issue_request_token(%L, null, 'stranger-s6@example.invalid', extensions.gen_random_bytes(32), 14, %L, false)$q$,
                                 pg_temp.ctx('req'), 'staff:' || pg_temp.ctx('a1')), 'tk_bad_recipient',
                          'a link for an address not on the request is refused (S5 major)');
select pg_temp.expect_err(format($q$select public.tk_issue_request_token(%L, null, %L, extensions.gen_random_bytes(32), 14, %L, false)$q$,
                                 pg_temp.ctx('req2'), pg_temp.ctx('cm2'), 'staff:' || pg_temp.ctx('a1')), 'tk_bad_recipient',
                          'a portal user on another request only is refused');
select pg_temp.expect_err(format($q$select public.tk_issue_request_token(%L, %L, 'stranger-s6@example.invalid', extensions.gen_random_bytes(32), 14, %L, false)$q$,
                                 pg_temp.ctx('req'), pg_temp.ctx('ct'), 'staff:' || pg_temp.ctx('a1')), 'tk_bad_recipient',
                          'a contact link must go to the contact''s own address');
select pg_temp.expect_err(format($q$select public.tk_issue_request_token(%L, null, %L, extensions.gen_random_bytes(32), 14, %L, true)$q$,
                                 pg_temp.ctx('req'), pg_temp.ctx('a1'), 'staff:' || pg_temp.ctx('a1')), 'tk_bad_recipient',
                          'a test link on a real client is refused');
select pg_temp.issue('b1', 'req', null, pg_temp.ctx('cm2'), 'send');
select pg_temp.issue('c1', 'req', pg_temp.ctx('ct'), 's6-treasurer@example.invalid', 'send');
select pg_temp.issue('a1', 'req', null, pg_temp.ctx('cm'), 'send');
select pg_temp.issue('a2', 'req', null, pg_temp.ctx('cm'), 'nudge');
select pg_temp.issue('a3', 'req', null, pg_temp.ctx('cm'), 'nudge');
select pg_temp.issue('a4', 'req', null, pg_temp.ctx('cm'), 'nudge');
select pg_temp.issue('a5', 'req', null, pg_temp.ctx('cm'), 'nudge');
select pg_temp.issue('a6', 'req', null, pg_temp.ctx('cm'), 'nudge');
select pg_temp.ok(not pg_temp.live('a1') and pg_temp.live('a2') and pg_temp.live('a6'),
                  'cap: the 6th link to one portal user retires that user''s oldest');
select pg_temp.ok(pg_temp.live('b1') and pg_temp.live('c1'), 'cap is per recipient: other people''s links stay live');
select pg_temp.issue('a7', 'req', null, pg_temp.ctx('cm'), 'resend');
select pg_temp.ok(not pg_temp.live('a2') and not pg_temp.live('a6') and pg_temp.live('a7'), 'resend retires that recipient''s links');
select pg_temp.ok(pg_temp.live('b1') and pg_temp.live('c1'), 'resend leaves other recipients'' links alone');
-- test links: only on a test client, only to the caller
update clients set test_only = true where id = 'grace-community';
select pg_temp.expect_err(format($q$select public.tk_issue_request_token(%L, null, %L, extensions.gen_random_bytes(32), 14, %L, true)$q$,
                                 pg_temp.ctx('req'), pg_temp.ctx('cm'), 'staff:' || pg_temp.ctx('a1')), 'tk_bad_recipient',
                          'a test copy cannot go to the client');
select pg_temp.ok(public.tk_issue_request_token(pg_temp.ctx('req')::uuid, pg_temp.ctx('ct')::uuid, pg_temp.ctx('a1'),
                                                extensions.gen_random_bytes(32), 14, 'staff:' || pg_temp.ctx('a1'), true, 'send') is not null,
                  'control: a test copy to the caller is allowed on a test client');
update clients set test_only = false where id = 'grace-community';

-- 6. Lookup, gate, stop (ip_hash logged; stop needs a good link) -----------------------------
-- (a check that reads a function's own writes runs as a separate statement: one statement sees one snapshot)
insert into t_ctx values ('lk', public.tk_token_lookup(pg_temp.hash('h_a7'), 's6-ip') ->> 'state');
select pg_temp.ok(pg_temp.ctx('lk') = 'ok'
                  and exists (select 1 from tk_request_token_events where token_id = pg_temp.ctx('t_a7')::uuid
                                and event = 'view' and ip_hash = 's6-ip'), 'lookup logs the view with ip_hash');
insert into t_ctx values ('lk2', public.tk_token_lookup(extensions.gen_random_bytes(32), 's6-ip-bad') ->> 'state');
select pg_temp.ok(pg_temp.ctx('lk2') = 'invalid'
                  and exists (select 1 from tk_request_token_events where event = 'invalid' and ip_hash = 's6-ip-bad'),
                  'an unknown link logs invalid with ip_hash');
select pg_temp.ok((public.tk_token_lookup(pg_temp.hash('h_a1'), 's6-ip') -> 'view') = jsonb_build_object('asked_by_first_name',
                    (select nullif(split_part(btrim(coalesce(s.name, '')), ' ', 1), '') from staff s where lower(s.email) = pg_temp.ctx('a1'))),
                  'a retired link shows only the asker''s first name');
-- Stop reminders (S6 review): still works on a used, expired or replaced link
-- (stopping is harmless and the link proves who it is); not on an unknown
-- link or one staff revoked on purpose.
update tk_request_tokens set expires_at = now() - interval '1 minute' where id = pg_temp.ctx('t_b1')::uuid;
insert into t_ctx values ('stop_exp', public.tk_stop_nudges_by_token(pg_temp.hash('h_b1'), 's6-ip')::text);
select pg_temp.ok((pg_temp.ctx('stop_exp')::jsonb ->> 'ok')::boolean
                  and (select nudge_paused from client_requests where id = pg_temp.ctx('req')::uuid),
                  'an expired link can still stop reminders');
update client_requests set nudge_paused = false where id = pg_temp.ctx('req')::uuid;
update tk_request_tokens set revoked_at = now(), revoke_reason = 'staff' where id = pg_temp.ctx('t_b1')::uuid;
select pg_temp.ok((public.tk_stop_nudges_by_token(pg_temp.hash('h_b1'), 's6-ip') ->> 'error') = 'revoked'
                  and (public.tk_stop_nudges_by_token(extensions.gen_random_bytes(32), 's6-ip') ->> 'error') = 'invalid'
                  and not (select nudge_paused from client_requests where id = pg_temp.ctx('req')::uuid),
                  'a staff-revoked or unknown link cannot stop reminders');
select pg_temp.ok((public.tk_token_gate(pg_temp.hash('h_a1'), 's6-ip') ->> 'state') = 'revoked'
                  and (public.tk_token_gate(extensions.gen_random_bytes(32), 's6-ip') ->> 'state') = 'invalid',
                  'gate refuses bad links before any upload');

-- 7. Answer attempts (empty answer counts) ------------------------------------------------------
select pg_temp.ok((public.tk_answer_request_by_token(pg_temp.hash('h_c1'), '   ', null, 's6-ip') ->> 'error') = 'reply_required',
                  'empty answer refused');
select pg_temp.ok((select answer_attempts = 1 from tk_request_tokens where id = pg_temp.ctx('t_c1')::uuid),
                  'the refused empty answer still counts as an attempt');
select pg_temp.ok((public.tk_answer_request_by_token(pg_temp.hash('h_c1'), 'x', array[gen_random_uuid()], 's6-ip') ->> 'error') = 'bad_request',
                  'a file id this link did not upload is refused');
select pg_temp.ok((public.tk_answer_request_by_token(pg_temp.hash('h_c1'), repeat('x', 4001), null, 's6-ip') ->> 'error') = 'bad_request'
                  and (public.tk_answer_request_by_token(pg_temp.hash('h_c1'), 'ok', null, 's6-ip') ->> 'error') = 'rate_limited',
                  'three attempts, then the link is locked');
select pg_temp.ok((public.tk_token_gate(pg_temp.hash('h_c1'), 's6-ip') ->> 'state') = 'rate_limited', 'gate also refuses a locked link');
-- Per-person stop (S6 review): a reminder lists several requests but carries
-- one stop link, so it pauses every open request on the client that lists
-- that person. req3 is a second ask to the contact ct.
select pg_temp.as_user(pg_temp.ctx('a1'));
set local role authenticated;
insert into t_ctx values ('req3', public.tk_ask_client('grace-community', pg_temp.ctx('task')::uuid, 'S6 second ask', 'Second question.',
                                                      'question', false, null, array[pg_temp.ctx('cm2')], array[pg_temp.ctx('ct')::uuid])::text);
reset role;
-- c1 (contact ct, on req) is locked for answers; it can still stop reminders.
insert into t_ctx values ('stop', public.tk_stop_nudges_by_token(pg_temp.hash('h_c1'), 's6-ip')::text);
select pg_temp.ok((pg_temp.ctx('stop')::jsonb ->> 'ok')::boolean and (pg_temp.ctx('stop')::jsonb ->> 'paused')::int = 2
                  and (select bool_and(nudge_paused) from client_requests where id in (pg_temp.ctx('req')::uuid, pg_temp.ctx('req3')::uuid))
                  and exists (select 1 from tk_request_token_events where token_id = pg_temp.ctx('t_c1')::uuid and event = 'stop_nudges'
                                and ip_hash = 's6-ip'),
                  'one stop link pauses every open request on the client that lists the person, logged with ip_hash');
select pg_temp.ok(not (select bool_or(nudge_paused) from client_requests where id in (pg_temp.ctx('req2')::uuid, pg_temp.ctx('reqm')::uuid)),
                  'control: requests that do not list that person keep their reminders');
insert into t_ctx values ('ans', public.tk_answer_request_by_token(pg_temp.hash('h_a7'), 'Balance confirmed.', null, 's6-ip') ->> 'ok');
select pg_temp.ok(pg_temp.ctx('ans')::boolean
                  and (select status = 'answered' and answered_via = 'link' and answered_by = 'contact:' || pg_temp.ctx('cm')
                         from client_requests where id = pg_temp.ctx('req')::uuid), 'a portal user''s link answers');

-- 8. Upload staging (req2 needs an upload) -----------------------------------------------------
select pg_temp.issue('d1', 'req2', null, pg_temp.ctx('cm'), 'send');
select pg_temp.ok((public.tk_token_gate(pg_temp.hash('h_d1'), 's6-ip') ->> 'files_left')::int = 5
                  and (public.tk_token_gate(pg_temp.hash('h_d1'), 's6-ip') ->> 'client_id') = 'grace-community',
                  'gate: good link has room for 5 files');
select pg_temp.ok((public.tk_stage_request_file_by_token(pg_temp.hash('h_d1'),
                     jsonb_build_object('drive_file_id', 'S6selftestDriveFile01', 'name', 'big.pdf', 'mime', 'application/pdf',
                                        'size', 26214401, 'year', 2026, 'doc_type', 'Bank Statements'), 's6-ip') ->> 'error') = 'bad_request',
                  'over 25 MB refused');
select pg_temp.ok((public.tk_stage_request_file_by_token(pg_temp.hash('h_d1'),
                     jsonb_build_object('drive_file_id', '../etc', 'name', 'a.pdf', 'mime', 'application/pdf', 'size', 10), 's6-ip') ->> 'error') = 'bad_request',
                  'odd Drive id refused');
insert into t_ctx values ('f1', public.tk_stage_request_file_by_token(pg_temp.hash('h_d1'),
                     jsonb_build_object('drive_file_id', 'S6selftestDriveFile01', 'drive_folder_id', 'S6selftestFolder', 'name', 'sept.pdf',
                                        'mime', 'application/pdf', 'size', 1234, 'year', 2026, 'doc_type', 'Bank Statements'), 's6-ip') ->> 'file_id');
select pg_temp.ok((select client_id = 'grace-community' and visibility = 'request' and uploaded_by = 'contact:' || pg_temp.ctx('cm')
                     and client_request_id = pg_temp.ctx('req2')::uuid and request_id is null
                     from client_files where id = pg_temp.ctx('f1')::uuid), 'staged file linked to the request');
select pg_temp.ok((public.tk_stage_request_file_by_token(pg_temp.hash('h_c1'),
                     jsonb_build_object('drive_file_id', 'S6selftestDriveFile02', 'name', 'a.pdf', 'mime', 'application/pdf', 'size', 10), 's6-ip') ->> 'error')
                    in ('answered_already', 'revoked', 'rate_limited'),
                  'a link for an answered request cannot upload');
insert into t_ctx values ('ans2', public.tk_answer_request_by_token(pg_temp.hash('h_d1'), null, array[pg_temp.ctx('f1')::uuid], 's6-ip') ->> 'ok');
select pg_temp.ok(pg_temp.ctx('ans2')::boolean
                  and (select status = 'answered' from client_requests where id = pg_temp.ctx('req2')::uuid),
                  'files with no note count as an answer');
select pg_temp.ok((select count(*) = 1 from public.client_requests_for_client('grace-community') x
                    where x.id = pg_temp.ctx('req2')::uuid and x.file_count = 1 and not x.legacy),
                  'client list shows the file count and legacy flag');

-- reply_required counts only this link's own files (S6 review): cm uploads to
-- a request shared with cm2; cm2's empty answer is still refused.
select pg_temp.as_user(pg_temp.ctx('a1'));
set local role authenticated;
insert into t_ctx values ('req4', public.tk_ask_client('grace-community', pg_temp.ctx('task')::uuid, 'S6 shared upload', 'Upload the form.',
                                                      'document', true, null, array[pg_temp.ctx('cm'), pg_temp.ctx('cm2')], '{}')::text);
reset role;
select pg_temp.issue('e1', 'req4', null, pg_temp.ctx('cm'), 'send');
select pg_temp.issue('e2', 'req4', null, pg_temp.ctx('cm2'), 'send');
insert into t_ctx values ('f4', public.tk_stage_request_file_by_token(pg_temp.hash('h_e1'),
                     jsonb_build_object('drive_file_id', 'S6selftestDriveFile04', 'name', 'form.pdf', 'mime', 'application/pdf',
                                        'size', 99, 'year', 2026, 'doc_type', 'Tax forms'), 's6-ip') ->> 'file_id');
select pg_temp.ok((public.tk_answer_request_by_token(pg_temp.hash('h_e2'), null, null, 's6-ip') ->> 'error') = 'reply_required'
                  and (select status = 'open' from client_requests where id = pg_temp.ctx('req4')::uuid),
                  'someone else''s upload does not answer for this link');
insert into t_ctx values ('ans4', public.tk_answer_request_by_token(pg_temp.hash('h_e1'), null, null, 's6-ip') ->> 'ok');
select pg_temp.ok(pg_temp.ctx('ans4')::boolean and (select status = 'answered' from client_requests where id = pg_temp.ctx('req4')::uuid),
                  'control: the uploader''s own file counts as the answer');

-- 9. Staff list follows the task's current client --------------------------------------------
update client_requests set client_id = 'basic-test' where id = pg_temp.ctx('reqm')::uuid;
select pg_temp.as_user(pg_temp.ctx('a1'));
set local role authenticated;
insert into t_ctx values ('list2', public.tk_list_client_requests(pg_temp.ctx('task2')::uuid)::text);
insert into t_ctx values ('list1', public.tk_list_client_requests(pg_temp.ctx('task')::uuid)::text);
reset role;
select pg_temp.ok(jsonb_array_length(pg_temp.ctx('list2')::jsonb) = 0, 'a request on another client is left out of the task list');
select pg_temp.ok(jsonb_array_length(pg_temp.ctx('list1')::jsonb) = 4, 'control: the task''s own requests are listed');
update client_requests set client_id = 'grace-community' where id = pg_temp.ctx('reqm')::uuid;

-- 10. Sender ------------------------------------------------------------------------------------------
insert into t_ctx select 'log_before', count(*)::text from client_email_log;
select pg_temp.as_user(pg_temp.ctx('a1'));
set local role authenticated;
insert into t_ctx values ('prev', public.tk_client_request_send(pg_temp.ctx('reqm')::uuid, 'preview')::text);
insert into t_ctx values ('send', public.tk_client_request_send(pg_temp.ctx('reqm')::uuid, 'send')::text);
select pg_temp.expect_err(format($q$select public.tk_client_request_send(%L, 'resend', 'stranger-s6@example.invalid')$q$, pg_temp.ctx('reqm')),
                          'tk_bad_recipient', 'resend to someone not on the request refused');
insert into t_ctx values ('resend', public.tk_client_request_send(pg_temp.ctx('reqm')::uuid, 'resend', pg_temp.ctx('cm'))::text);
reset role;
select pg_temp.ok((pg_temp.ctx('prev')::jsonb ->> 'mode') = 'dry_run' and not (pg_temp.ctx('prev')::jsonb ->> 'needs_sender')::boolean
                  and (pg_temp.ctx('prev')::jsonb -> 'targets' -> 0 ->> 'type') = 'portal', 'preview: dry run plan, typed targets');
select pg_temp.ok((pg_temp.ctx('send')::jsonb ->> 'dry_run')::boolean and not (pg_temp.ctx('send')::jsonb ->> 'needs_sender')::boolean
                  and (pg_temp.ctx('resend')::jsonb -> 'recipients') = jsonb_build_array(pg_temp.ctx('cm')),
                  'switch off: sends are dry runs; resend targets one person');
select pg_temp.ok((select count(*) - pg_temp.ctx('log_before')::int = 2 from client_email_log) and
                  (select count(*) = 2 from client_email_log where request_ids @> array[pg_temp.ctx('reqm')::uuid]
                     and status = 'skipped' and reason = 'dry_run'), 'dry runs logged as skipped; preview logs nothing');
select pg_temp.ok((select count(*) = 0 from tk_request_tokens where request_id = pg_temp.ctx('reqm')::uuid), 'dry run issues no link');
select pg_temp.expect_err(format($q$select public.tk_request_send_claim(%L, 'send', 'staff:x', 'live', '{}', 's')$q$, pg_temp.ctx('reqm')),
                          'tk_mode_changed', 'the sender cannot claim a live send while the switch is off');
update clients set test_only = true where id = 'grace-community';
select pg_temp.as_user(pg_temp.ctx('a1'));
set local role authenticated;
insert into t_ctx values ('tsend', public.tk_client_request_send(pg_temp.ctx('reqm')::uuid, 'send')::text);
reset role;
select pg_temp.ok((pg_temp.ctx('tsend')::jsonb ->> 'mode') = 'test' and (pg_temp.ctx('tsend')::jsonb ->> 'needs_sender')::boolean
                  and (pg_temp.ctx('tsend')::jsonb -> 'recipients') = jsonb_build_array(pg_temp.ctx('a1')),
                  'test client: the edge sender sends one copy, to the caller');
insert into t_ctx values ('claim', public.tk_request_send_claim(pg_temp.ctx('reqm')::uuid, 'send', 'staff:' || pg_temp.ctx('a1'), 'test',
                                                               array[pg_temp.ctx('a1')], 'S6 test')::text);
select public.tk_request_send_finish(pg_temp.ctx('claim')::uuid, 'sent', null, array[pg_temp.ctx('a1')], 'self-test');
select pg_temp.ok((select status = 'sent' and trigger = 'test' from client_email_log where id = pg_temp.ctx('claim')::uuid),
                  'claim + finish record a test send');
select public.tk_request_send_finish(pg_temp.ctx('claim')::uuid, 'error', 'late', null, null);
select pg_temp.ok((select status = 'sent' from client_email_log where id = pg_temp.ctx('claim')::uuid), 'a finished claim cannot be rewritten');
update clients set test_only = false where id = 'grace-community';

-- 11. Nudges ---------------------------------------------------------------------------------------------
update client_requests set asked_at = now() - interval '10 days' where id = pg_temp.ctx('reqm')::uuid;
select pg_temp.ok(exists (select 1 from jsonb_array_elements(public.tk_nudge_plan()) g, jsonb_array_elements(g -> 'items') i
                           where i ->> 'request_id' = pg_temp.ctx('reqm') and g ->> 'mode' = 'dry_run'
                             and g -> 'recipient' ->> 'email' = pg_temp.ctx('cm')), 'due request planned (dry run)');
update client_requests set nudge_paused = true where id = pg_temp.ctx('reqm')::uuid;
select pg_temp.ok(not exists (select 1 from jsonb_array_elements(public.tk_nudge_plan()) g, jsonb_array_elements(g -> 'items') i
                               where i ->> 'request_id' = pg_temp.ctx('reqm')), 'paused request not planned');
update client_requests set nudge_paused = false, nudge_count = public.tk__setting_int('nudge_max', 4, 0, 20) - 1
 where id = pg_temp.ctx('reqm')::uuid;
insert into t_ctx select 'ob', count(*)::text from notification_outbox where kind = 'staff_task_batch';
select pg_temp.ok(public.tk_nudge_mark(array[pg_temp.ctx('reqm')::uuid]) = 1 and public.tk_nudge_mark(array[pg_temp.ctx('reqm')::uuid]) = 0,
                  'a request is counted once a day');
select pg_temp.ok((select count(*) - pg_temp.ctx('ob')::int = 1 from notification_outbox where kind = 'staff_task_batch'),
                  'the last reminder tells the assignee');
select pg_temp.ok(not exists (select 1 from jsonb_array_elements(public.tk_nudge_plan()) g, jsonb_array_elements(g -> 'items') i
                               where i ->> 'request_id' = pg_temp.ctx('reqm')), 'no reminders past the cap');

-- 12. Append-only events -------------------------------------------------------------------------------
select pg_temp.expect_err($q$truncate tk_request_token_events$q$, 'tk_append_only', 'events cannot be truncated');
select pg_temp.expect_err($q$delete from tk_request_token_events$q$, 'tk_append_only', 'events cannot be deleted');
select pg_temp.ok(not exists (select 1 from tk_request_token_events where detail::text ~ '@'),
                  'no email address in event details');
select pg_temp.ok(current_setting('mgb.tk_request', true) = '' and coalesce(current_setting('mgb.tk_legacy_write', true), '') = '',
                  'flags cleared');

select 'S6 self-test passed';
rollback;
