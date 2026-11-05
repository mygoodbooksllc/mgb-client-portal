-- =====================================================================
-- Self-test: client contacts in the org profile
-- (supabase/client-contacts.sql, spec docs/client-contacts-spec.md
-- section 11, tests 1-17, plus the Q2 override: the token-revoke trigger is
-- a no-op while the gate is off).
--
-- Run it whole; it ends in ROLLBACK, so nothing it writes is kept. It uses
-- the test clients grace-community (active full-access login) and
-- basic-test, plus a throwaway client cc-selftest made inside the
-- transaction. grace-community stands in for a real client (test_only off)
-- in section 1 only. It never writes tk_settings. Staff are picked at run
-- time; every contact value here is fake (example.invalid).
-- A failed check raises and stops the run.
-- =====================================================================
begin;

create temp table t_ctx (k text primary key, v text) on commit drop;
grant all on t_ctx to authenticated, anon;

create or replace function pg_temp.ctx(p_k text) returns text language sql as $$ select v from t_ctx where k = p_k $$;
create or replace function pg_temp.put(p_k text, p_v text) returns void language sql as $$
  insert into t_ctx values (p_k, p_v) on conflict (k) do update set v = excluded.v $$;
create or replace function pg_temp.as_staff(p_email text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid(), 'email', p_email, 'role', 'authenticated',
    'app_metadata', json_build_object('provider', 'google'))::text, true);
$$;
create or replace function pg_temp.as_client(p_email text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid(), 'email', p_email, 'role', 'authenticated',
    'app_metadata', json_build_object('provider', 'email'))::text, true);
$$;
create or replace function pg_temp.no_jwt() returns void language sql as $$
  select set_config('request.jwt.claims', '', true);
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
    if position(p_err in sqlerrm) > 0 or sqlstate = p_err then raise notice 'ok: % (%)', p_what, p_err; return; end if;
    raise exception 'SELF-TEST FAILED: % expected %, got % (%)', p_what, p_err, sqlerrm, sqlstate;
  end;
  raise exception 'SELF-TEST FAILED: % expected %, but it succeeded', p_what, p_err;
end $$;
create or replace function pg_temp.errtext(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end $$;
-- A complete client payload with a given main email (null = no email).
create or replace function pg_temp.pl(p_email text, p_extra jsonb default '{}'::jsonb) returns jsonb language sql as $$
  select jsonb_build_object(
    'card_name', 'CC Selftest Church',
    'org_type', 'Church',
    'established_unknown', true,
    'gift_same_as_org', false,
    'gift_address', '1 Test Way, Testville, TN 37000',
    'receiver_name', 'Front Desk',
    'courier_phone', '615-555-0100',
    'contact_name', 'CC Main',
    'contact_email', p_email,
    'contact_phone', '615-555-0101',
    'fiscal_year_end', '12-31') || p_extra;
$$;
create or replace function pg_temp.save(p jsonb) returns jsonb language sql as $$ select public.client_org_profile_save(p) $$;
-- Definer so ids resolve the same under a client or staff JWT (RLS would hide rows).
create or replace function pg_temp.cid(p_client text, p_email text) returns uuid language sql security definer as $$
  select id from client_contacts where client_id = p_client and email = lower(p_email) and deleted_at is null $$;
-- A request + open link for one contact (as the migration role).
create or replace function pg_temp.tok(p_contact uuid) returns uuid language plpgsql as $$
declare v_req uuid; v_tok uuid; v_client text; v_email text;
begin
  select client_id, email into v_client, v_email from client_contacts where id = p_contact;
  insert into client_requests (client_id, title, prompt, asked_by, contact_ids)
  values (v_client, 'CC selftest', 'CC selftest prompt', 'selftest', array[p_contact]) returning id into v_req;
  insert into tk_request_tokens (request_id, contact_id, recipient_email, token_hash, created_by, expires_at)
  values (v_req, p_contact, v_email, sha256(convert_to(gen_random_uuid()::text, 'UTF8')), 'selftest', now() + interval '1 day')
  returning id into v_tok;
  return v_tok;
end $$;
create or replace function pg_temp.open_tok(p_tok uuid) returns boolean language sql as $$
  select revoked_at is null from tk_request_tokens where id = p_tok $$;
create or replace function pg_temp.reason(p_tok uuid) returns text language sql as $$
  select revoke_reason from tk_request_tokens where id = p_tok $$;
create or replace function pg_temp.people(p_client text) returns jsonb language sql as $$ select public.cc__people(p_client) $$;
create or replace function pg_temp.entry(p_client text, p_email text) returns jsonb language sql as $$
  select x from jsonb_array_elements(public.cc__people(p_client)) x where x ->> 'email' = lower(p_email) $$;
-- The pre-migration rb__main_contact body, inline (gate-off comparison).
create or replace function pg_temp.old_main(p_client text) returns jsonb language sql as $$
  select coalesce(
    (select jsonb_build_object('name', nullif(btrim(o.contact_name), ''),
                               'email', lower(nullif(btrim(o.contact_email), '')),
                               'phone', nullif(btrim(o.contact_phone), ''),
                               'source', 'profile')
       from client_org_profile o
      where o.client_id = p_client
        and (nullif(btrim(o.contact_name), '') is not null or nullif(btrim(o.contact_email), '') is not null)),
    (select jsonb_build_object('name', u.name, 'email', lower(u.email), 'phone', null, 'source', 'login')
       from client_users u
      where u.client_id = p_client and u.active
      order by u.created_at, lower(u.email)
      limit 1));
$$;

do $$ begin
  execute format('grant usage on schema %s to authenticated, anon', pg_my_temp_schema()::regnamespace);
  execute format('grant execute on all functions in schema %s to authenticated, anon', pg_my_temp_schema()::regnamespace);
end $$;

-- ---------------------------------------------------------------------
-- Setup (as the migration role)
-- ---------------------------------------------------------------------
select pg_temp.ok(not coalesce(public.tk__jsonb_bool((select value from tk_settings where key = 'org_contacts_enabled')), false),
                  'firm switch org_contacts_enabled is off (built hidden)');
select pg_temp.ok(public.tk__owner_only_key('org_contacts_enabled') and public.tk__owner_only_key('org_profile_enabled')
                  and public.tk__owner_only_key('reviewboard_digest_to') and public.tk__owner_only_key('wb_enabled')
                  and not public.tk__owner_only_key('month_rhythm'),
                  'org_contacts_enabled is owner-only; older keys kept');

insert into t_ctx select 'cu', lower(email) from client_users
 where client_id = 'grace-community' and active and coalesce(access, 'full') = 'full' order by email limit 1;
insert into t_ctx select 'ad', s.email from staff s
 where s.active and s.role = 'admin'
   and not exists (select 1 from internal_access ia where lower(ia.staff_email) = lower(s.email) and ia.is_owner)
 order by s.email limit 1;
insert into t_ctx select 'bk', s.email from staff s where s.active and s.role = 'bookkeeper' order by s.email limit 1;
insert into t_ctx select 'nb', s.email from staff s
 where s.active and s.role <> 'admin' and lower(s.email) <> lower(pg_temp.ctx('bk'))
 order by s.email limit 1;
insert into t_ctx select 'ta', s.email from staff s
 where s.active and s.role <> 'admin' and lower(s.email) not in (lower(pg_temp.ctx('bk')), lower(pg_temp.ctx('nb')))
 order by s.email limit 1;
select pg_temp.ok(pg_temp.ctx('cu') is not null and pg_temp.ctx('ad') is not null and pg_temp.ctx('bk') is not null
                  and pg_temp.ctx('nb') is not null and pg_temp.ctx('ta') is not null, 'test people found');

-- Access: admin has no internal access; bk and ta reach grace-community and
-- basic-test; nb has only an expired grant on grace-community; ta is a temp admin.
delete from internal_access where lower(staff_email) = lower(pg_temp.ctx('ad'));
delete from staff_client_access where lower(staff_email) in (lower(pg_temp.ctx('bk')), lower(pg_temp.ctx('nb')), lower(pg_temp.ctx('ta')))
   and client_id in ('basic-test', 'grace-community', 'mygoodbooks');
delete from staff_client_access_grants where lower(staff_email) in (lower(pg_temp.ctx('bk')), lower(pg_temp.ctx('nb')), lower(pg_temp.ctx('ta')))
   and client_id in ('basic-test', 'grace-community', 'mygoodbooks');
update clients set assigned_bookkeeper_email = null
 where id in ('basic-test', 'grace-community')
   and lower(coalesce(assigned_bookkeeper_email, '')) in (lower(pg_temp.ctx('nb')));
update clients set account_manager_email = null
 where id in ('basic-test', 'grace-community')
   and lower(coalesce(account_manager_email, '')) in (lower(pg_temp.ctx('nb')));
insert into staff_client_access (staff_email, client_id)
select pg_temp.ctx('bk'), x from unnest(array['grace-community', 'basic-test']) x;
insert into staff_client_access (staff_email, client_id)
select pg_temp.ctx('ta'), x from unnest(array['grace-community', 'basic-test']) x;
insert into staff_client_access_grants (client_id, staff_email, staff_name, reason, duration_days, status, decided_by, decided_at, expires_at)
values ('grace-community', pg_temp.ctx('nb'), 'CC test', 'CC self-test expired grant', 1, 'approved', pg_temp.ctx('ad'),
        now() - interval '3 days', now() - interval '2 days');
delete from staff_temp_admin_access where lower(staff_email) = lower(pg_temp.ctx('ta'));
insert into staff_temp_admin_access (staff_email, granted_by, expires_at)
values (pg_temp.ctx('ta'), pg_temp.ctx('ad'), now() + interval '1 day');

-- Throwaway client (test_only) with its own login and no client_profile row.
insert into clients (id, name, org_type, test_only) values ('cc-selftest', 'CC Selftest', 'Church', true);
insert into client_users (email, client_id, name, role, active, access)
values ('cc-login@example.invalid', 'cc-selftest', 'CC Login', 'Team member', true, 'full');

delete from client_org_profile where client_id in ('grace-community', 'basic-test', 'cc-selftest');
insert into t_ctx select 'gc0', count(*)::text from client_contacts where client_id = 'grace-community' and deleted_at is null;
insert into t_ctx select 'audit0', coalesce(max(id), 0)::text from audit_log;

-- ---------------------------------------------------------------------
-- 15/16. Grants, helpers, triggers
-- ---------------------------------------------------------------------
select pg_temp.ok(not has_function_privilege('anon', f, 'execute') and not has_function_privilege('authenticated', f, 'execute'),
                  'helper not callable by anon/authenticated: ' || f)
  from unnest(array['public.cc__people(text)', 'public.op__contacts_on(text)', 'public.cc__materialize(text)',
                    'public.cc__lock(text)', 'public.cc__email_ok(text)', 'public.cc__stamp_fn()',
                    'public.cc__revoke_on_change_fn()', 'public.rb__main_contact(text)']) f;
select pg_temp.ok(not has_function_privilege('anon', 'public.staff_client_contact_save(text,jsonb,boolean)', 'execute')
                  and has_function_privilege('authenticated', 'public.staff_client_contact_save(text,jsonb,boolean)', 'execute'),
                  'staff_client_contact_save: authenticated only');
select pg_temp.ok(not has_function_privilege('anon', f, 'execute') and has_function_privilege('authenticated', f, 'execute'),
                  'replaced RPC keeps its grants: ' || f)
  from unnest(array['public.rb_board(date)', 'public.rb_draft_recipients(uuid)', 'public.staff_client_org_profile(text)',
                    'public.client_org_profile_mine()', 'public.client_org_profile_save(jsonb)',
                    'public.tk_request_recipients(text)']) f;
select pg_temp.ok((select provolatile = 's' from pg_proc where oid = 'public.staff_client_org_profile(text)'::regprocedure),
                  'staff_client_org_profile stays STABLE (View-as read list)');
select pg_temp.ok((select count(*) = 2 from pg_trigger where tgrelid = 'public.client_contacts'::regclass
                    and tgname in ('cc__stamp', 'cc__revoke_on_change') and not tgisinternal), 'both triggers installed');
select pg_temp.ok((select prosecdef and proconfig::text like '%search_path=public%' from pg_proc
                    where oid = 'public.staff_client_contact_save(text,jsonb,boolean)'::regprocedure), 'staff RPC: definer + search_path');

-- ---------------------------------------------------------------------
-- 2. anon, scoped users, staff on the client save
-- ---------------------------------------------------------------------
select pg_temp.no_jwt();
set local role anon;
select pg_temp.expect_err($q$select public.staff_client_contact_save('grace-community', '{}'::jsonb, false)$q$, '42501', 'anon: staff save');
select pg_temp.expect_err($q$select public.client_org_profile_save('{}'::jsonb)$q$, '42501', 'anon: client save');
select pg_temp.expect_err($q$select public.client_org_profile_mine()$q$, '42501', 'anon: mine');
select pg_temp.expect_err($q$select public.staff_client_org_profile('grace-community')$q$, '42501', 'anon: staff card');
select pg_temp.expect_err($q$select public.rb_board(null)$q$, '42501', 'anon: board');
select pg_temp.expect_err($q$select public.rb_draft_recipients(gen_random_uuid())$q$, '42501', 'anon: drafts');
select pg_temp.expect_err($q$select public.tk_request_recipients('grace-community')$q$, '42501', 'anon: request recipients');
select pg_temp.expect_err($q$select public.cc__people('grace-community')$q$, '42501', 'anon: cc__people');
reset role;
insert into client_users (email, client_id, name, role, active, access)
values ('cc-scoped@example.invalid', 'grace-community', 'CC Scoped', 'Team member', true, 'scoped');
set local role authenticated;
select pg_temp.as_client('cc-scoped@example.invalid');
select pg_temp.ok(public.client_org_profile_mine() = '{"eligible": false}'::jsonb, 'scoped user: {eligible:false}');
select pg_temp.expect_err($q$select pg_temp.save(pg_temp.pl('cc-main@example.invalid'))$q$, '42501', 'scoped user cannot save');
select pg_temp.as_staff(pg_temp.ctx('ad'));
select pg_temp.expect_err($q$select pg_temp.save(pg_temp.pl('cc-main@example.invalid'))$q$, '42501', 'staff JWT cannot use the client save');
select pg_temp.expect_err($q$select public.cc__people('grace-community')$q$, '42501', 'authenticated: cc__people refused');
reset role;

-- ---------------------------------------------------------------------
-- 1. Gate off (grace-community stands in for a real client)
-- ---------------------------------------------------------------------
update clients set test_only = false where id = 'grace-community';
select pg_temp.ok(not public.op__contacts_on('grace-community') and public.op__contacts_on('basic-test')
                  and public.op__contacts_on('cc-selftest'), 'gate: off for a real client, on for test clients');
insert into client_contacts (client_id, name, email, can_answer_requests) values
  ('grace-community', 'CC Off A', 'cc-off-a@example.invalid', true),
  ('grace-community', 'CC Off B', 'cc-off-b@example.invalid', true);
set local role authenticated;
select pg_temp.as_client(pg_temp.ctx('cu'));
select pg_temp.ok((select (j ->> 'eligible')::boolean and j -> 'contacts_enabled' = 'false'::jsonb
                          and not (j ? 'people') and not (j ? 'main_prefill')
                   from public.client_org_profile_mine() j), 'gate off: mine() has contacts_enabled false, no people');
select pg_temp.save(pg_temp.pl('cc-gateoff@example.invalid', jsonb_build_object(
  'greeting_name', 'Hi Jim,',
  'people', jsonb_build_object('upsert', jsonb_build_array(jsonb_build_object('name', 'X', 'email', 'cc-x@example.invalid')),
                               'remove', jsonb_build_array('not-a-uuid')))));
reset role;
select pg_temp.ok((select count(*)::text from client_contacts where client_id = 'grace-community' and deleted_at is null)
                  = (pg_temp.ctx('gc0')::int + 2)::text
                  and not exists (select 1 from client_contacts where email in ('cc-x@example.invalid', 'cc-gateoff@example.invalid')),
                  'gate off: save ignores people and does not mirror the main contact');
select pg_temp.ok((select greeting_name is null and completed_at is not null from client_org_profile where client_id = 'grace-community'),
                  'gate off: greeting ignored; profile saved and complete');
select pg_temp.ok(public.rb__main_contact('grace-community') = pg_temp.old_main('grace-community')
                  and not (public.rb__main_contact('grace-community') ? 'title'),
                  'gate off: rb__main_contact identical to the old body');
select pg_temp.ok(public.rb__main_contact('mygoodbooks') is not distinct from pg_temp.old_main('mygoodbooks'),
                  'gate off: rb__main_contact identical with no contact at all');
update client_org_profile set greeting_name = 'Stored Greeting' where client_id = 'grace-community';
set local role authenticated;
select pg_temp.as_staff(pg_temp.ctx('ad'));
select pg_temp.put('card_off', public.staff_client_org_profile('grace-community')::text);
reset role;
select pg_temp.ok((pg_temp.ctx('card_off')::jsonb -> 'profile')
                  = (select to_jsonb(o) - 'client_id' - 'greeting_name' from client_org_profile o where o.client_id = 'grace-community')
                  and (pg_temp.ctx('card_off')::jsonb -> 'contacts_enabled') = 'false'::jsonb,
                  'gate off: staff card profile is byte-identical (greeting_name stripped)');
update client_org_profile set greeting_name = null where client_id = 'grace-community';
set local role authenticated;
select pg_temp.as_client(pg_temp.ctx('cu'));
select pg_temp.expect_err($q$select pg_temp.save(pg_temp.pl('cc-gateoff@example.invalid', jsonb_build_object('pad', repeat('x', 20000))))$q$,
  'payload is too large', 'gate off: 16 KB cap kept');
select pg_temp.save(pg_temp.pl(null));
reset role;
select pg_temp.ok((select completed_at is not null from client_org_profile where client_id = 'grace-community'),
                  'gate off: phone-only main contact still completes');
-- Q2 override: with the gate off, the trigger is a no-op (today's behavior).
insert into t_ctx values ('t_offa', pg_temp.tok(pg_temp.cid('grace-community', 'cc-off-a@example.invalid'))::text);
insert into t_ctx values ('t_offb', pg_temp.tok(pg_temp.cid('grace-community', 'cc-off-b@example.invalid'))::text);
set local role authenticated;
select pg_temp.as_staff(pg_temp.ctx('ad'));
select public.tk_save_client_contact(pg_temp.cid('grace-community', 'cc-off-a@example.invalid'), 'grace-community',
                                     'CC Off A', 'cc-off-a2@example.invalid', null, true, null);
reset role;
select pg_temp.ok(pg_temp.open_tok(pg_temp.ctx('t_offa')::uuid),
                  'Q2 override: gate off, tk_save_client_contact email change leaves the link open');
select pg_temp.ok((select edited_at is not null and updated_by = lower(pg_temp.ctx('ad'))
                     from client_contacts where email = 'cc-off-a2@example.invalid'), 'cc__stamp stamps edited_at and updated_by');
-- Staff RPC with the gate off: preview only for a real admin.
set local role authenticated;
select pg_temp.as_staff(pg_temp.ctx('bk'));
select pg_temp.expect_err($q$select public.staff_client_contact_save('grace-community', '{"name":"CC P","email":"cc-p@example.invalid"}'::jsonb, true)$q$,
  'cc_off', 'gate off: bookkeeper with p_preview refused');
select pg_temp.as_staff(pg_temp.ctx('ta'));
select pg_temp.expect_err($q$select public.staff_client_contact_save('grace-community', '{"name":"CC P","email":"cc-p@example.invalid"}'::jsonb, true)$q$,
  'cc_off', 'gate off: temp admin with p_preview refused');
select pg_temp.as_staff(pg_temp.ctx('ad'));
select pg_temp.expect_err($q$select public.staff_client_contact_save('grace-community', '{"name":"CC P","email":"cc-p@example.invalid"}'::jsonb, false)$q$,
  'cc_off', 'gate off: admin without p_preview refused');
select public.staff_client_contact_save('grace-community',
  jsonb_build_object('id', pg_temp.cid('grace-community', 'cc-off-a2@example.invalid'), 'name', 'CC Off A',
                     'email', 'cc-off-a3@example.invalid', 'can_answer', true), true);
reset role;
select pg_temp.ok(not pg_temp.open_tok(pg_temp.ctx('t_offa')::uuid) and pg_temp.reason(pg_temp.ctx('t_offa')::uuid) = 'contact_retired'
                  and pg_temp.open_tok(pg_temp.ctx('t_offb')::uuid),
                  'gate off: admin preview email change revokes only that contact''s link');
update clients set test_only = true where id = 'grace-community';

-- ---------------------------------------------------------------------
-- 3/4. Gate on: client save, crafted payloads, validation
-- ---------------------------------------------------------------------
insert into client_contacts (client_id, name, email, notes) values ('basic-test', 'CC Foreign', 'cc-foreign@example.invalid', 'CC secret note');
set local role authenticated;
select pg_temp.as_client(pg_temp.ctx('cu'));
select pg_temp.ok((public.client_org_profile_mine() -> 'contacts_enabled') = 'true'::jsonb, 'gate on: contacts_enabled true');
select pg_temp.save(pg_temp.pl('CC-Main@Example.invalid', jsonb_build_object(
  'greeting_name', 'Hi Jim,',
  'client_id', 'basic-test',
  'people', jsonb_build_object('upsert', jsonb_build_array(
    jsonb_build_object('name', 'CC Other 1', 'email', 'cc-o1@example.invalid', 'title', 'Treasurer',
                       'gets_monthly_emails', true, 'can_answer', true),
    jsonb_build_object('name', 'CC Other 2', 'email', 'cc-o2@example.invalid', 'gets_monthly_emails', false, 'can_answer', true))))));
reset role;
select pg_temp.ok((select count(*) = 1 from client_contacts where client_id = 'grace-community' and is_main and deleted_at is null)
                  and (select source = 'client' and gets_monthly_emails and can_answer_requests and name = 'CC Main'
                         from client_contacts where id = pg_temp.cid('grace-community', 'cc-main@example.invalid') and is_main),
                  'mirror: one main row, lowercased, monthly on, source client');
select pg_temp.ok((select title = 'Treasurer' and gets_monthly_emails and can_answer_requests and source = 'client' and not is_main
                     from client_contacts where id = pg_temp.cid('grace-community', 'cc-o1@example.invalid')),
                  'client-added person saved with title and ticks');
select pg_temp.ok(not exists (select 1 from client_org_profile where client_id = 'basic-test'), 'client_id in the payload ignored');
select pg_temp.ok((select greeting_name = 'Jim' from client_org_profile where client_id = 'grace-community'), 'greeting "Hi Jim," stored as "Jim"');
set local role authenticated;
select pg_temp.as_client(pg_temp.ctx('cu'));
select pg_temp.expect_err(format($q$select pg_temp.save(pg_temp.pl('cc-main@example.invalid', '{"people":{"upsert":[{"id":"%s","name":"X","email":"cc-x1@example.invalid"}]}}'))$q$,
  pg_temp.cid('basic-test', 'cc-foreign@example.invalid')), 'people_id', 'upsert: another client''s id refused');
select pg_temp.expect_err(format($q$select pg_temp.save(pg_temp.pl('cc-main@example.invalid', '{"people":{"remove":["%s"]}}'))$q$,
  pg_temp.cid('basic-test', 'cc-foreign@example.invalid')), 'people_id', 'remove: another client''s id refused');
select pg_temp.expect_err($q$select pg_temp.save(pg_temp.pl('cc-main@example.invalid', '{"people":{"remove":["nope"]}}'))$q$,
  'people_id', 'remove: a non-uuid refused');
select pg_temp.expect_err(format($q$select pg_temp.save(pg_temp.pl('cc-main@example.invalid', '{"people":{"upsert":[{"id":"%s","name":"X","email":"cc-x2@example.invalid"}]}}'))$q$,
  pg_temp.cid('grace-community', 'cc-main@example.invalid')), 'people_id', 'upsert: the main row''s id refused');
select pg_temp.expect_err(format($q$select pg_temp.save(pg_temp.pl('cc-main@example.invalid', '{"people":{"remove":["%s"]}}'))$q$,
  pg_temp.cid('grace-community', 'cc-main@example.invalid')), 'people_remove_main', 'remove: the main row refused');
select pg_temp.save(pg_temp.pl('cc-main@example.invalid', jsonb_build_object('people', jsonb_build_object('upsert', jsonb_build_array(
  jsonb_build_object('id', pg_temp.cid('grace-community', 'cc-o1@example.invalid'), 'name', 'CC Other 1', 'email', 'cc-o1@example.invalid',
                     'title', 'Treasurer', 'gets_monthly_emails', true, 'can_answer', true,
                     'is_main', true, 'source', 'staff', 'role', 'pastor', 'notes', 'CC sneaky', 'client_id', 'basic-test',
                     'created_by', 'x', 'edited_at', '2000-01-01'))))));
reset role;
select pg_temp.ok((select not is_main and source = 'client' and role is null and notes is null and client_id = 'grace-community'
                     from client_contacts where id = pg_temp.cid('grace-community', 'cc-o1@example.invalid')),
                  'ignored entry keys (is_main, source, role, notes, client_id) leave the row unchanged');
set local role authenticated;
select pg_temp.as_client(pg_temp.ctx('cu'));
select pg_temp.expect_err($q$select pg_temp.save(pg_temp.pl('cc-main@example.invalid', '{"people":{"upsert":[{"name":"A","email":"cc-d@example.invalid"},{"name":"B","email":"CC-D@example.invalid"}]}}'))$q$,
  'people_email_duplicate', 'duplicate emails in the payload refused');
select pg_temp.expect_err($q$select pg_temp.save(pg_temp.pl('cc-main@example.invalid', '{"people":{"upsert":[{"name":"A","email":"cc-main@example.invalid"}]}}'))$q$,
  'people_email_duplicate', 'email equal to the main contact refused');
select pg_temp.ok(position('cc-main@' in pg_temp.errtext($q$select pg_temp.save(pg_temp.pl('cc-main@example.invalid', '{"people":{"upsert":[{"name":"A","email":"cc-main@example.invalid"}]}}'))$q$)) = 0
                  and position('cc-bad' in pg_temp.errtext($q$select pg_temp.save(pg_temp.pl('cc-main@example.invalid', '{"people":{"upsert":[{"name":"A","email":"cc-bad?x@example.invalid"}]}}'))$q$)) = 0,
                  'errors never contain the email value');
select pg_temp.expect_err(format('select pg_temp.save(pg_temp.pl(%L, %L::jsonb))', 'cc-main@example.invalid',
                                 jsonb_build_object('people', jsonb_build_object('upsert', jsonb_build_array(
                                   jsonb_build_object('name', 'A', 'email', 'cc' || ch || 'q@example.invalid'))))),
                          'not a valid email', 'people email with ' || ch || ' refused')
  from unnest(array['?', '&', ',', '%', '#', '<', '>', '"']) ch;
select pg_temp.expect_err($q$select pg_temp.save(pg_temp.pl('cc-main?bcc=x@example.invalid'))$q$,
  'contact_email is not a valid', 'main contact email with ? refused under the gate');
select pg_temp.expect_err(format('select pg_temp.save(pg_temp.pl(%L, %L::jsonb))', 'cc-main@example.invalid',
  jsonb_build_object('people', jsonb_build_object('upsert', jsonb_build_array(jsonb_build_object('name', 'A' || chr(10) || 'B', 'email', 'cc-n@example.invalid'))))),
  'cannot have', 'name with a newline refused');
select pg_temp.expect_err(format('select pg_temp.save(pg_temp.pl(%L, %L::jsonb))', 'cc-main@example.invalid',
  jsonb_build_object('people', jsonb_build_object('upsert', jsonb_build_array(jsonb_build_object('name', 'A', 'title', 'T' || chr(10), 'email', 'cc-n@example.invalid'))))),
  'cannot have', 'title with a newline refused');
select pg_temp.expect_err(format('select pg_temp.save(pg_temp.pl(%L, %L::jsonb))', 'cc-main@example.invalid',
  jsonb_build_object('greeting_name', 'Jim' || chr(10) || 'Bob')), 'cannot have', 'greeting with a newline refused');

-- ---------------------------------------------------------------------
-- 5. Mirror moves the main contact; 6. caps
-- ---------------------------------------------------------------------
select pg_temp.save(pg_temp.pl('cc-main2@example.invalid'));
reset role;
select pg_temp.ok((select count(*) = 1 from client_contacts where client_id = 'grace-community' and is_main and deleted_at is null)
                  and pg_temp.cid('grace-community', 'cc-main2@example.invalid') = (select id from client_contacts
                        where client_id = 'grace-community' and is_main and deleted_at is null)
                  and (select not is_main and gets_monthly_emails from client_contacts
                        where id = pg_temp.cid('grace-community', 'cc-main@example.invalid')),
                  'changing the main email moves is_main; the old row stays live as other');
-- 26 live rows: the cap counts only increases
insert into client_contacts (client_id, name, email)
select 'grace-community', 'CC Pad ' || g, 'cc-pad' || g || '@example.invalid'
  from generate_series(1, 30) g
 where (select count(*) from client_contacts where client_id = 'grace-community' and deleted_at is null) + g <= 26;
select pg_temp.ok((select count(*) = 26 from client_contacts where client_id = 'grace-community' and deleted_at is null), 'fixture: 26 live rows');
set local role authenticated;
select pg_temp.as_client(pg_temp.ctx('cu'));
select pg_temp.save(pg_temp.pl('cc-main2@example.invalid', '{"card_name":"CC Renamed"}'));
select pg_temp.ok(true, 'cap: a client with 26 rows can still save other fields');
select pg_temp.expect_err($q$select pg_temp.save(pg_temp.pl('cc-main2@example.invalid', '{"people":{"upsert":[{"name":"A","email":"cc-over@example.invalid"}]}}'))$q$,
  'people_limit', 'cap: adding a 27th person refused');
select pg_temp.save(pg_temp.pl('cc-main2@example.invalid', jsonb_build_object('pad', repeat('x', 20000))));
select pg_temp.ok(true, 'gate on: 24 KB cap allows a 20 KB payload');
select pg_temp.expect_err($q$select pg_temp.save(pg_temp.pl('cc-main2@example.invalid', jsonb_build_object('pad', repeat('x', 30000))))$q$,
  'payload is too large', 'gate on: 24 KB cap');
reset role;
update client_contacts set deleted_at = now() where client_id = 'grace-community' and email like 'cc-pad%';

-- ---------------------------------------------------------------------
-- 7. Tokens through the trigger, every writer (gate on)
-- ---------------------------------------------------------------------
insert into client_contacts (client_id, name, email, can_answer_requests) values
  ('grace-community', 'CC T3', 'cc-t3@example.invalid', true),
  ('grace-community', 'CC T4', 'cc-t4@example.invalid', true);
insert into t_ctx values ('t1', pg_temp.tok(pg_temp.cid('grace-community', 'cc-o1@example.invalid'))::text);
insert into t_ctx values ('t2', pg_temp.tok(pg_temp.cid('grace-community', 'cc-o2@example.invalid'))::text);
set local role authenticated;
select pg_temp.as_client(pg_temp.ctx('cu'));
select pg_temp.save(pg_temp.pl('cc-main2@example.invalid', jsonb_build_object('people', jsonb_build_object('upsert', jsonb_build_array(
  jsonb_build_object('id', pg_temp.cid('grace-community', 'cc-o1@example.invalid'), 'name', 'CC Other 1', 'email', 'cc-o1@example.invalid',
                     'title', 'Treasurer', 'gets_monthly_emails', true, 'can_answer', false))))));
reset role;
select pg_temp.ok(not pg_temp.open_tok(pg_temp.ctx('t1')::uuid) and pg_temp.open_tok(pg_temp.ctx('t2')::uuid),
                  'client save, can_answer off: only that contact''s link revoked');
insert into t_ctx values ('t1b', pg_temp.tok(pg_temp.cid('grace-community', 'cc-o1@example.invalid'))::text);
set local role authenticated;
select pg_temp.as_client(pg_temp.ctx('cu'));
select pg_temp.save(pg_temp.pl('cc-main2@example.invalid', jsonb_build_object('people', jsonb_build_object('remove',
  jsonb_build_array(pg_temp.cid('grace-community', 'cc-o1@example.invalid'))))));
reset role;
select pg_temp.ok(not pg_temp.open_tok(pg_temp.ctx('t1b')::uuid) and pg_temp.open_tok(pg_temp.ctx('t2')::uuid)
                  and not exists (select 1 from client_contacts where client_id = 'grace-community' and email = 'cc-o1@example.invalid' and deleted_at is null),
                  'client save, remove: soft delete revokes only that contact''s link');
insert into t_ctx values ('t3', pg_temp.tok(pg_temp.cid('grace-community', 'cc-t3@example.invalid'))::text);
set local role authenticated;
select pg_temp.as_staff(pg_temp.ctx('ad'));
select public.staff_client_contact_save('grace-community', jsonb_build_object('id', pg_temp.cid('grace-community', 'cc-o2@example.invalid'),
  'name', 'CC Other 2', 'email', 'cc-o2b@example.invalid'), false);
reset role;
select pg_temp.ok(not pg_temp.open_tok(pg_temp.ctx('t2')::uuid) and pg_temp.reason(pg_temp.ctx('t2')::uuid) = 'contact_retired'
                  and pg_temp.open_tok(pg_temp.ctx('t3')::uuid), 'staff RPC email change: only that contact''s link revoked');
insert into t_ctx values ('t4', pg_temp.tok(pg_temp.cid('grace-community', 'cc-t4@example.invalid'))::text);
set local role authenticated;
select pg_temp.as_staff(pg_temp.ctx('ad'));
select public.tk_save_client_contact(pg_temp.cid('grace-community', 'cc-t3@example.invalid'), 'grace-community',
                                     'CC T3', 'cc-t3b@example.invalid', null, true, null);
reset role;
select pg_temp.ok(not pg_temp.open_tok(pg_temp.ctx('t3')::uuid) and pg_temp.open_tok(pg_temp.ctx('t4')::uuid),
                  'tk_save_client_contact email change (gate on): only that contact''s link revoked');
set local role authenticated;
select pg_temp.as_staff(pg_temp.ctx('ad'));
select public.tk_retire_client_contact(pg_temp.cid('grace-community', 'cc-t4@example.invalid'));
reset role;
select pg_temp.ok(not pg_temp.open_tok(pg_temp.ctx('t4')::uuid) and pg_temp.reason(pg_temp.ctx('t4')::uuid) = 'contact_retired'
                  and (select count(*) = 0 from tk_request_tokens where revoked_at is not null and contact_id is null
                         and revoke_reason = 'contact_retired'),
                  'tk_retire_client_contact revokes; no contact-less token was ever revoked');

-- ---------------------------------------------------------------------
-- 8. Greeting fill-blank under a client JWT
-- ---------------------------------------------------------------------
insert into client_profile (client_id) values ('grace-community');
insert into t_ctx select 'cp0', (to_jsonb(cp) - 'greeting_name')::text from client_profile cp where client_id = 'grace-community';
set local role authenticated;
select pg_temp.as_client(pg_temp.ctx('cu'));
select pg_temp.save(pg_temp.pl('cc-main2@example.invalid', '{"greeting_name":"Hello Pastor Jim:"}'));
reset role;
select pg_temp.ok((select greeting_name = 'Pastor Jim' from client_profile where client_id = 'grace-community')
                  and (select (to_jsonb(cp) - 'greeting_name')::text from client_profile cp where client_id = 'grace-community') = pg_temp.ctx('cp0')
                  and (select greeting_name = 'Pastor Jim' from client_org_profile where client_id = 'grace-community'),
                  'blank client_profile greeting filled; no other client_profile column changed');
set local role authenticated;
select pg_temp.as_client(pg_temp.ctx('cu'));
select pg_temp.save(pg_temp.pl('cc-main2@example.invalid', '{"greeting_name":"Dear Jimmy"}'));
reset role;
select pg_temp.ok((select greeting_name = 'Pastor Jim' from client_profile where client_id = 'grace-community')
                  and (select greeting_name = 'Jimmy' from client_org_profile where client_id = 'grace-community'),
                  'existing client_profile greeting left alone');
set local role authenticated;
select pg_temp.as_staff(pg_temp.ctx('ad'));
select pg_temp.ok((select (j -> 'greeting' ->> 'mismatch')::boolean and j -> 'contacts_enabled' = 'true'::jsonb
                          and (j -> 'profile' ->> 'greeting_name') = 'Jimmy'
                   from public.staff_client_org_profile('grace-community') j), 'staff card: greeting mismatch flagged');
select pg_temp.as_client('cc-login@example.invalid');
select pg_temp.save(pg_temp.pl('cc-sel-main@example.invalid', '{"greeting_name":"Hi Sam"}'));
reset role;
select pg_temp.ok(not exists (select 1 from client_profile where client_id = 'cc-selftest'), 'no client_profile row: nothing inserted');

-- ---------------------------------------------------------------------
-- 9/10/17. cc__people and rb__main_contact
-- ---------------------------------------------------------------------
insert into client_contacts (client_id, name, email, title) values ('grace-community', 'CC Dup Login', pg_temp.ctx('cu'), 'Board');
insert into client_email_recipients (client_id, email, opted_out_at) values ('grace-community', 'cc-opt@example.invalid', now());
insert into client_contacts (client_id, name, email) values ('grace-community', 'CC Opted', 'cc-opt@example.invalid');
select pg_temp.ok((select count(*) = 1 from jsonb_array_elements(pg_temp.people('grace-community')) x where x ->> 'email' = pg_temp.ctx('cu'))
                  and pg_temp.entry('grace-community', pg_temp.ctx('cu')) ->> 'source' = 'contact',
                  'dedupe by email: a contact that is also a login appears once, as contact');
select pg_temp.ok((pg_temp.people('grace-community') -> 0 ->> 'source') = 'main'
                  and (select count(*) = 0 from jsonb_array_elements(pg_temp.people('grace-community')) x where x ->> 'source' = 'profile'),
                  'main row first; no profile entry while a main row exists');
select pg_temp.ok((pg_temp.entry('grace-community', 'cc-opt@example.invalid') ->> 'opted_out')::boolean,
                  'opted-out non-login contact flagged');
-- rb__main_contact order on cc-selftest: login, contact (monthly), profile, main
delete from client_org_profile where client_id = 'cc-selftest';
update client_contacts set deleted_at = now() where client_id = 'cc-selftest';
select pg_temp.ok(public.rb__main_contact('cc-selftest') ->> 'source' = 'login', 'main contact: login when nothing else');
insert into client_contacts (client_id, name, email, gets_monthly_emails, title) values ('cc-selftest', 'CC Monthly', 'cc-monthly@example.invalid', true, 'Clerk');
select pg_temp.ok(public.rb__main_contact('cc-selftest') ->> 'source' = 'contact'
                  and public.rb__main_contact('cc-selftest') ->> 'title' = 'Clerk', 'main contact: monthly contact before login');
insert into client_org_profile (client_id, contact_name, contact_email, contact_phone) values ('cc-selftest', 'CC Prof', 'cc-prof@example.invalid', '555-0199');
select pg_temp.ok(public.rb__main_contact('cc-selftest') ->> 'source' = 'profile'
                  and public.rb__main_contact('cc-selftest') ->> 'phone' = '555-0199', 'main contact: profile before contacts');
insert into client_contacts (client_id, name, email, is_main) values ('cc-selftest', 'CC Row Main', 'cc-rowmain@example.invalid', true);
select pg_temp.ok(public.rb__main_contact('cc-selftest') ->> 'source' = 'main'
                  and public.rb__main_contact('cc-selftest') -> 'phone' = 'null'::jsonb,
                  'main contact: main row first; profile phone not attached to a different email');

-- 5 (cont). Materialize and resurrection
update client_contacts set deleted_at = now() where client_id = 'cc-selftest';
set local role authenticated;
select pg_temp.as_staff(pg_temp.ctx('ad'));
select public.staff_client_contact_save('cc-selftest', '{"name":"CC New Main","email":"cc-newmain@example.invalid","is_main":true}'::jsonb, false);
reset role;
select pg_temp.ok((select not is_main and gets_monthly_emails and source = 'client' and deleted_at is null
                     from client_contacts where client_id = 'cc-selftest' and email = 'cc-prof@example.invalid' and deleted_at is null)
                  and (select is_main from client_contacts where id = pg_temp.cid('cc-selftest', 'cc-newmain@example.invalid')),
                  'materialize: profile person became a row, then demoted when staff made someone else main');
select pg_temp.ok((pg_temp.entry('cc-selftest', 'cc-prof@example.invalid') ->> 'phone') = '555-0199'
                  and pg_temp.entry('cc-selftest', 'cc-newmain@example.invalid') -> 'phone' = 'null'::jsonb,
                  'profile phone follows the profile email only');
set local role authenticated;
select pg_temp.as_staff(pg_temp.ctx('ad'));
select public.tk_retire_client_contact(pg_temp.cid('grace-community', 'cc-main2@example.invalid'));
select pg_temp.as_client(pg_temp.ctx('cu'));
select pg_temp.ok((select j -> 'main_prefill' = '{"name": null, "email": null, "phone": null}'::jsonb
                   from public.client_org_profile_mine() j), 'resurrection: main row retired by staff, prefill blank');
reset role;
select pg_temp.ok((select count(*) = 0 from jsonb_array_elements(pg_temp.people('grace-community')) x
                    where x ->> 'source' = 'profile' or x ->> 'email' = 'cc-main2@example.invalid'),
                  'resurrection: no profile entry for a removed person');

-- ---------------------------------------------------------------------
-- 11. Staff RPC access
-- ---------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_staff(pg_temp.ctx('bk'));
select pg_temp.ok((public.staff_client_contact_save('grace-community', '{"name":"CC BK","email":"cc-bk@example.invalid","role":"treasurer","notes":"CC staff note"}'::jsonb, false) ->> 'id') is not null,
                  'assigned bookkeeper can add a contact');
select pg_temp.as_staff(pg_temp.ctx('ad'));
select pg_temp.ok((public.staff_client_contact_save('grace-community', '{"name":"CC AD","email":"cc-ad@example.invalid","is_main":true,"gets_monthly_emails":true}'::jsonb, false) ->> 'id') is not null,
                  'admin can add a main contact');
select pg_temp.expect_err(format($q$select public.staff_client_contact_save('grace-community', '{"id":"%s","name":"CC AD","email":"cc-ad@example.invalid","is_main":false}'::jsonb, false)$q$,
  pg_temp.cid('grace-community', 'cc-ad@example.invalid')), 'cc_need_main', 'unsetting the only main refused');
select pg_temp.expect_err($q$select public.staff_client_contact_save('grace-community', '{"name":"CC Dup","email":"CC-AD@example.invalid"}'::jsonb, false)$q$,
  'tk_contact_exists', 'duplicate live email refused');
select pg_temp.expect_err(format($q$select public.staff_client_contact_save('grace-community', '{"id":"%s","name":"X","email":"cc-x9@example.invalid"}'::jsonb, false)$q$,
  pg_temp.cid('basic-test', 'cc-foreign@example.invalid')), 'tk_not_found', 'id from another client refused');
select pg_temp.expect_err($q$select public.staff_client_contact_save('grace-community', '{"name":"CC Bad","email":"cc-bad?x@example.invalid"}'::jsonb, false)$q$,
  'tk_bad_contact', 'staff RPC: strict email check');
select pg_temp.expect_err($q$select public.staff_client_contact_save('mygoodbooks', '{"name":"CC Int","email":"cc-int@example.invalid"}'::jsonb, true)$q$,
  '42501', 'internal client lock holds');
select pg_temp.as_staff(pg_temp.ctx('nb'));
select pg_temp.expect_err($q$select public.staff_client_contact_save('grace-community', '{"name":"CC NB","email":"cc-nb@example.invalid"}'::jsonb, false)$q$,
  '42501', 'staff with only an expired grant refused');
reset role;
select pg_temp.ok((select count(*) = 1 from client_contacts where client_id = 'grace-community' and is_main and deleted_at is null)
                  and (select source = 'staff' and role = 'treasurer' from client_contacts where id = pg_temp.cid('grace-community', 'cc-bk@example.invalid')),
                  'one main row; staff rows marked staff');

-- ---------------------------------------------------------------------
-- 12/13. Audit details hold no emails; notes never leave
-- ---------------------------------------------------------------------
select pg_temp.ok(not exists (select 1 from audit_log where id > pg_temp.ctx('audit0')::bigint
                                and action in ('client.contacts_updated', 'staff.client_contact_saved', 'client.org_profile_updated')
                                and details::text like '%@%')
                  and exists (select 1 from audit_log where id > pg_temp.ctx('audit0')::bigint and action = 'client.contacts_updated')
                  and exists (select 1 from audit_log where id > pg_temp.ctx('audit0')::bigint and action = 'staff.client_contact_saved'),
                  'audit details carry counts and field names only');
with r as (
  insert into staff_reminders (staff_email, text, client_id, due_date)
  values (pg_temp.ctx('ad'), 'CC selftest task', 'grace-community', date '2031-02-14')
  returning id)
insert into t_ctx select 'task', id::text from r;
update client_contacts set notes = 'CC secret note' where client_id = 'grace-community' and deleted_at is null;
select pg_temp.ok(position('CC secret note' in pg_temp.people('grace-community')::text) = 0, 'notes absent: cc__people');
set local role authenticated;
select pg_temp.as_staff(pg_temp.ctx('ad'));
select pg_temp.ok(position('CC secret note' in public.rb_board(null)::text) = 0, 'notes absent: rb_board');
select pg_temp.ok(jsonb_typeof((select c -> 'contact_list' from jsonb_array_elements(public.rb_board(null) -> 'clients') c
                                 where c ->> 'client_id' = 'grace-community')) = 'array', 'rb_board carries contact_list');
select pg_temp.ok(position('CC secret note' in (public.rb_draft_recipients(pg_temp.ctx('task')::uuid) -> 'contact_list')::text) = 0
                  and jsonb_typeof(public.rb_draft_recipients(pg_temp.ctx('task')::uuid) -> 'contact_list') = 'array',
                  'notes absent: rb_draft_recipients contact_list');
select pg_temp.ok(position('CC secret note' in (public.staff_client_org_profile('grace-community') - 'contacts')::text) = 0,
                  'notes absent: staff card contact_list');
select pg_temp.as_client(pg_temp.ctx('cu'));
select pg_temp.ok(position('CC secret note' in public.client_org_profile_mine()::text) = 0, 'notes absent: client mine()');
reset role;

-- ---------------------------------------------------------------------
-- 14. Import stamp: mgb.cc_import keeps edited_at
-- ---------------------------------------------------------------------
insert into t_ctx select 'ed0', edited_at::text from client_contacts where id = pg_temp.cid('grace-community', 'cc-bk@example.invalid');
select set_config('mgb.cc_import', '1', true);
update client_contacts set title = 'Imported' where id = pg_temp.cid('grace-community', 'cc-bk@example.invalid');
insert into client_contacts (client_id, name, email) values ('grace-community', 'CC Imp', 'cc-imp@example.invalid');
select set_config('mgb.cc_import', '', true);
select pg_temp.ok((select edited_at = pg_temp.ctx('ed0')::timestamptz and title = 'Imported' from client_contacts where id = pg_temp.cid('grace-community', 'cc-bk@example.invalid'))
                  and (select edited_at is null from client_contacts where id = pg_temp.cid('grace-community', 'cc-imp@example.invalid')),
                  'import writes leave edited_at alone');

select 'all ok';
rollback;
