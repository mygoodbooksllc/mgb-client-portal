-- =====================================================================
-- Self-test: client page drop, Phase 1 database
-- (supabase/client-page-drop-1-core.sql, spec docs/client-page-drop.md).
--
-- Covers: function and table grants (anon / authenticated can't run the
-- service-only helpers or write client_file_access), existing rows stay
-- 'everyone', an 'only' file (listed login sees it, unlisted doesn't), an
-- 'except' file (the reverse), staff see both, another org sees neither,
-- cross-org and client-mismatch list rows fail, the uploader rules, the
-- 50-person cap, non-shared / legacy rows can't be restricted, the atomic
-- insert RPC leaves no half row, client_file_set_access refuses a
-- non-uploader client (and everyone while the switch is off),
-- client_org_logins() never returns another org (empty while off), the
-- Documents-tab rule (resolveAccess semantics), the hardened
-- document_folder_items policy, the message-link trigger guard, and that
-- the account-manager upload email stays silent while its switch is off.
--
-- Run it whole; it ends in ROLLBACK, so nothing it writes is kept. It uses
-- the test clients grace-community and basic-test, with throwaway logins
-- (example.invalid) and throwaway client_files rows that live only inside
-- this transaction. It never writes tk_settings: checks that depend on the
-- firm switch read it once and expect the matching result. No names or
-- emails of real people live in this file; staff are picked at run time.
-- A failed check raises and stops the run.
-- =====================================================================
begin;

create temp table t_ctx (k text primary key, v text) on commit drop;
grant all on t_ctx to authenticated, anon, service_role;

create or replace function pg_temp.ctx(p_k text) returns text language sql as $$ select v from t_ctx where k = p_k $$;
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
    if position(p_err in sqlerrm) > 0 then raise notice 'ok: % (%)', p_what, p_err; return; end if;
    raise exception 'SELF-TEST FAILED: % expected %, got %', p_what, p_err, sqlerrm;
  end;
  raise exception 'SELF-TEST FAILED: % expected %, but it succeeded', p_what, p_err;
end $$;
-- Test file ids the current JWT can see through RLS.
create or replace function pg_temp.sees(p_key text) returns boolean language plpgsql as $$
declare n int;
begin
  execute 'select count(*) from public.client_files where id = $1::uuid' into n using pg_temp.ctx(p_key);
  return n = 1;
end $$;

-- ---------------------------------------------------------------------
-- 0. Grants (B1, S4)
-- ---------------------------------------------------------------------
select pg_temp.ok(
  not has_function_privilege(r, f, 'execute'),
  format('%s cannot execute %s', r, f))
from unnest(array['anon', 'authenticated']) r,
     unnest(array['public.cpd__on(text)', 'public.cpd__docs_tab_rule(text,text)',
                  'public.cfa_validate(uuid)', 'public.cfa__apply_access(uuid,text,text[],text)',
                  'public.cfa_insert_file_with_access(jsonb,text,text[])',
                  'public.cfa_guard()', 'public.cpd__notify_upload()']) f;
select pg_temp.ok(
  has_function_privilege('service_role', f, 'execute'),
  format('service_role can execute %s', f))
from unnest(array['public.cpd__on(text)', 'public.cpd__docs_tab_rule(text,text)',
                  'public.cfa_validate(uuid)', 'public.cfa__apply_access(uuid,text,text[],text)',
                  'public.cfa_insert_file_with_access(jsonb,text,text[])']) f;
select pg_temp.ok(
  not has_function_privilege('anon', f, 'execute') and has_function_privilege('authenticated', f, 'execute'),
  format('authenticated (not anon) can execute %s', f))
from unnest(array['public.client_file_login_ok(uuid,text)', 'public.client_docs_tab_ok(text)',
                  'public.client_file_set_access(uuid,text,text[],text)',
                  'public.client_org_logins()', 'public.client_page_drop_state()']) f;
select pg_temp.ok(not has_table_privilege('anon', 'public.client_file_access', 'select'), 'anon cannot read client_file_access');
select pg_temp.ok(has_table_privilege('authenticated', 'public.client_file_access', 'select'), 'authenticated can read client_file_access (RLS filters)');
select pg_temp.ok(
  not has_table_privilege('authenticated', 'public.client_file_access', p),
  format('authenticated cannot %s client_file_access', p))
from unnest(array['insert', 'update', 'delete', 'truncate']) p;
select pg_temp.ok((select relrowsecurity from pg_class where oid = 'public.client_file_access'::regclass), 'RLS on for client_file_access');
select pg_temp.ok(not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'client_file_access'),
                  'client_file_access is not in realtime');
select pg_temp.ok(public.tk__owner_only_key('client_page_drop_enabled') and public.tk__owner_only_key('client_page_drop_pilot')
                  and public.tk__owner_only_key('client_upload_notify_enabled')
                  and public.tk__owner_only_key('slateplus_enabled') and public.tk__owner_only_key('client_request_pilot'),
                  'new switch keys are owner-only and older keys are kept');

-- ---------------------------------------------------------------------
-- 1. Existing rows unchanged
-- ---------------------------------------------------------------------
select pg_temp.ok(not exists (select 1 from client_files where access_mode <> 'everyone'), 'every existing file is everyone');
select pg_temp.ok(not exists (select 1 from client_file_access), 'no access rows yet');

-- ---------------------------------------------------------------------
-- Setup (as the migration role)
-- ---------------------------------------------------------------------
insert into t_ctx select 'sw', case when public.cpd__on('grace-community') then 'on' else 'off' end;
insert into t_ctx select 'nsw', case when coalesce(public.tk__jsonb_bool((select value from tk_settings where key = 'client_upload_notify_enabled')), false) then 'on' else 'off' end;
select pg_temp.ok(true, 'page drop switch for grace-community: ' || pg_temp.ctx('sw') || ', upload email switch: ' || pg_temp.ctx('nsw'));
insert into t_ctx select 'ad', s.email from staff s where s.active and s.role = 'admin' order by s.email limit 1;
select pg_temp.ok(pg_temp.ctx('ad') is not null, 'found an active admin');

insert into client_users (email, client_id, name, role, active, access, tabs) values
  ('cpd-a@example.invalid', 'grace-community', 'CPD A', 'Team member', true, 'full', null),
  ('cpd-b@example.invalid', 'grace-community', 'CPD B', 'Team member', true, 'full', null),
  ('cpd-s@example.invalid', 'grace-community', 'CPD Scoped', 'Team member', true, 'scoped', array['dashboard']),
  ('cpd-t@example.invalid', 'grace-community', 'CPD Scoped Docs', 'Team member', true, 'scoped', array['dashboard', 'documents']),
  ('cpd-n@example.invalid', 'grace-community', 'CPD Scoped Null', 'Team member', true, 'scoped', null),
  ('cpd-off@example.invalid', 'grace-community', 'CPD Inactive', 'Team member', false, 'full', null),
  ('cpd-x@example.invalid', 'basic-test', 'CPD Other Org', 'Team member', true, 'full', null),
  ('cpd-bs@example.invalid', 'basic-test', 'CPD Basic Scoped', 'Team member', true, 'scoped', array['dashboard']);

with ins as (
  insert into client_files (client_id, drive_file_id, name, year, doc_type, visibility, uploaded_by)
  values ('grace-community', 'cpd-selftest-only-' || gen_random_uuid(), 'only.pdf', 2026, 'Other', 'shared', 'cpd-a@example.invalid'),
         ('grace-community', 'cpd-selftest-except-' || gen_random_uuid(), 'except.pdf', 2026, 'Other', 'shared', 'cpd-a@example.invalid'),
         ('grace-community', 'cpd-selftest-plain-' || gen_random_uuid(), 'plain.pdf', 2026, 'Other', 'shared', 'cpd-a@example.invalid'),
         ('grace-community', 'cpd-selftest-internal-' || gen_random_uuid(), 'internal.pdf', 2026, 'Other', 'internal', pg_temp.ctx('ad')),
         ('grace-community', 'cpd-selftest-staffonly-' || gen_random_uuid(), 'staffonly.pdf', 2026, 'Other', 'shared', pg_temp.ctx('ad'))
  returning id, name)
insert into t_ctx select split_part(name, '.', 1), id::text from ins;
insert into client_files (client_id, drive_file_id, name, year, doc_type, visibility, uploaded_by, legacy_path)
values ('grace-community', 'cpd-selftest-legacy-' || gen_random_uuid(), 'legacy.pdf', 2026, 'Other', 'shared', 'cpd-a@example.invalid',
        'grace-community/cpd-selftest-legacy-' || gen_random_uuid());
insert into t_ctx select 'legacy', id::text from client_files where name = 'legacy.pdf' and drive_file_id like 'cpd-selftest-legacy-%';

select pg_temp.ok(public.cfa__apply_access(pg_temp.ctx('only')::uuid, 'only', '{}', 'cpd-a@example.invalid') = 1,
                  'only with an empty list from a client uploader: uploader force-added');
select pg_temp.ok((select array_agg(email) from client_file_access where file_id = pg_temp.ctx('only')::uuid) = array['cpd-a@example.invalid'],
                  'only list is exactly the uploader');
select pg_temp.ok(public.cfa__apply_access(pg_temp.ctx('except')::uuid, 'except', array[' CPD-B@example.invalid '], 'cpd-a@example.invalid') = 1,
                  'except list normalized (trim + lower case)');
select pg_temp.ok(public.cfa__apply_access(pg_temp.ctx('staffonly')::uuid, 'only', array['cpd-b@example.invalid'], pg_temp.ctx('ad')) = 1,
                  'S3: a staff-uploaded file may be only-listed without the uploader');
select pg_temp.ok((select access_mode from client_files where id = pg_temp.ctx('only')::uuid) = 'only'
                  and (select access_mode from client_files where id = pg_temp.ctx('except')::uuid) = 'except',
                  'modes stored');

-- ---------------------------------------------------------------------
-- 2. Rule checks (service-side)
-- ---------------------------------------------------------------------
select pg_temp.expect_err(format($q$select public.cfa__apply_access(%L::uuid, 'except', array['cpd-a@example.invalid'], 'x')$q$, pg_temp.ctx('plain')),
                          'bad_access_list', 'except cannot list the client uploader');
select pg_temp.expect_err(format($q$select public.cfa__apply_access(%L::uuid, 'only', array['cpd-x@example.invalid'], 'x')$q$, pg_temp.ctx('plain')),
                          'bad_access_list', 'another org''s login is refused');
select pg_temp.expect_err(format($q$select public.cfa__apply_access(%L::uuid, 'only', array['cpd-off@example.invalid'], 'x')$q$, pg_temp.ctx('plain')),
                          'bad_access_list', 'an inactive login is refused');
select pg_temp.expect_err(format($q$select public.cfa__apply_access(%L::uuid, 'only', array['nobody@example.invalid'], 'x')$q$, pg_temp.ctx('plain')),
                          'bad_access_list', 'an unknown email is refused');
select pg_temp.expect_err(format($q$select public.cfa__apply_access(%L::uuid, 'except', (select array_agg('p' || g || '@example.invalid') from generate_series(1, 51) g), 'x')$q$, pg_temp.ctx('plain')),
                          'bad_access_list', 'more than 50 people refused');
select pg_temp.expect_err(format($q$select public.cfa__apply_access(%L::uuid, 'sometimes', '{}', 'x')$q$, pg_temp.ctx('plain')),
                          'bad_access_mode', 'unknown mode refused');
select pg_temp.expect_err(format($q$select public.cfa__apply_access(%L::uuid, 'only', array['cpd-b@example.invalid'], 'x')$q$, pg_temp.ctx('internal')),
                          'bad_access_mode', 'a staff-only (internal) file cannot carry a rule');
select pg_temp.expect_err(format($q$select public.cfa__apply_access(%L::uuid, 'only', array['cpd-b@example.invalid'], 'x')$q$, pg_temp.ctx('legacy')),
                          'bad_access_mode', 'S6: a legacy-path file cannot carry a rule');
select pg_temp.expect_err(format($q$update client_files set access_mode = 'only' where id = %L::uuid$q$, pg_temp.ctx('internal')),
                          'client_files_access_mode_shared_check', 'check constraint blocks a rule on a non-shared row');
select pg_temp.expect_err(format($q$insert into client_file_access (file_id, client_id, email, created_by) values (%L::uuid, 'grace-community', 'cpd-x@example.invalid', 't')$q$, pg_temp.ctx('only')),
                          'bad_access_list', 'cfa_guard: cross-org email insert fails');
select pg_temp.expect_err(format($q$insert into client_file_access (file_id, client_id, email, created_by) values (%L::uuid, 'basic-test', 'cpd-x@example.invalid', 't')$q$, pg_temp.ctx('only')),
                          'client mismatch', 'cfa_guard: client_id must match the file');
select pg_temp.expect_err(format($q$delete from client_file_access where file_id = %L::uuid; select public.cfa_validate(%L::uuid)$q$, pg_temp.ctx('only'), pg_temp.ctx('only')),
                          'bad_access_list', 'cfa_validate: only with an empty list is refused');
select pg_temp.ok((select count(*) from client_file_access where file_id = pg_temp.ctx('only')::uuid) = 1, 'failed validate rolled back its delete');

-- Atomic insert: a bad list leaves no client_files row behind.
set local role service_role;
select pg_temp.expect_err($q$select public.cfa_insert_file_with_access(jsonb_build_object(
    'client_id', 'grace-community', 'drive_file_id', 'cpd-selftest-atomic-bad', 'name', 'bad.pdf', 'year', 2026,
    'doc_type', 'Other', 'visibility', 'shared', 'uploaded_by', 'cpd-a@example.invalid'),
    'except', array['cpd-x@example.invalid'])$q$, 'bad_access_list', 'atomic insert refuses another org''s login');
reset role;
select pg_temp.ok(not exists (select 1 from client_files where drive_file_id = 'cpd-selftest-atomic-bad'), 'atomic insert left no half row');
set local role service_role;
insert into t_ctx select 'atomic', (public.cfa_insert_file_with_access(jsonb_build_object(
    'client_id', 'grace-community', 'drive_file_id', 'cpd-selftest-atomic-ok', 'name', 'ok.pdf', 'display_name', '  Board  minutes ',
    'year', 2026, 'doc_type', 'Reports', 'visibility', 'shared', 'uploaded_by', 'CPD-A@example.invalid'),
    'only', array['cpd-b@example.invalid'])).id::text;
reset role;
select pg_temp.ok((select access_mode = 'only' and display_name = 'Board  minutes' and uploaded_by = 'cpd-a@example.invalid' from client_files where id = pg_temp.ctx('atomic')::uuid),
                  'atomic insert stored mode, trimmed display name, lower-case uploader');
select pg_temp.ok((select array_agg(email order by email) from client_file_access where file_id = pg_temp.ctx('atomic')::uuid)
                  = array['cpd-a@example.invalid', 'cpd-b@example.invalid'], 'atomic insert list includes the uploader');
select pg_temp.ok(pg_temp.ctx('nsw') = 'on' or not exists (select 1 from notification_outbox where ref_id = pg_temp.ctx('atomic')),
                  'no account-manager email while client_upload_notify_enabled is off');

-- ---------------------------------------------------------------------
-- 3. RLS: who sees what
-- ---------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_client('cpd-a@example.invalid');
select pg_temp.ok(pg_temp.sees('only') and pg_temp.sees('except') and pg_temp.sees('plain') and not pg_temp.sees('staffonly'),
                  'A (listed on only, not excluded) sees only + except + plain, not the staff only-list');
select pg_temp.ok(not pg_temp.sees('internal'), 'A never sees an internal file');
select pg_temp.ok((select count(*) from client_file_access where file_id = pg_temp.ctx('only')::uuid) = 1, 'uploader A reads its own file''s list');
select pg_temp.ok(public.client_file_login_ok(pg_temp.ctx('only')::uuid, 'only') and not public.client_file_login_ok(pg_temp.ctx('only')::uuid, 'bogus'),
                  'login_ok answers for the caller; unknown mode fails closed');

select pg_temp.as_client('cpd-b@example.invalid');
select pg_temp.ok(not pg_temp.sees('only') and not pg_temp.sees('except') and pg_temp.sees('plain') and pg_temp.sees('staffonly'),
                  'B (unlisted on only, excluded on except) sees plain + the staff only-list file');
select pg_temp.ok(not exists (select 1 from client_file_access where file_id in (pg_temp.ctx('only')::uuid, pg_temp.ctx('except')::uuid)),
                  'B cannot read the lists of files it did not upload');
select pg_temp.ok(not exists (select 1 from client_file_access where file_id = pg_temp.ctx('staffonly')::uuid),
                  'B cannot read the list of a staff-uploaded file, even one it is on');
select pg_temp.expect_err(format($q$insert into client_file_access (file_id, client_id, email, created_by) values (%L::uuid, 'grace-community', 'cpd-b@example.invalid', 'b')$q$, pg_temp.ctx('only')),
                          'permission denied', 'a client cannot write client_file_access');

select pg_temp.as_client('cpd-x@example.invalid');
select pg_temp.ok(not pg_temp.sees('only') and not pg_temp.sees('except') and not pg_temp.sees('plain'), 'another org sees none of them');
select pg_temp.ok(not exists (select 1 from client_file_access), 'another org reads no access rows');

select pg_temp.as_client('cpd-s@example.invalid');
select pg_temp.ok(pg_temp.sees('plain') = (pg_temp.ctx('sw') = 'off'),
                  'scoped login without the Documents tab: sees shared files only while the switch is off');

select pg_temp.as_staff(pg_temp.ctx('ad'));
select pg_temp.ok(pg_temp.sees('only') and pg_temp.sees('except') and pg_temp.sees('plain') and pg_temp.sees('internal'),
                  'staff see every file, whatever the rule');
select pg_temp.ok((select count(*) from client_file_access where file_id in (pg_temp.ctx('only')::uuid, pg_temp.ctx('except')::uuid)) = 2,
                  'staff read the lists');
reset role;

select pg_temp.no_jwt();
set local role anon;
select pg_temp.expect_err('select 1 from public.client_file_access', 'permission denied', 'anon cannot read client_file_access');
select pg_temp.expect_err('select public.client_org_logins()', 'permission denied', 'anon cannot call client_org_logins');
select pg_temp.expect_err($q$select public.client_file_set_access(gen_random_uuid(), 'everyone', '{}')$q$, 'permission denied', 'anon cannot call client_file_set_access');
reset role;

-- ---------------------------------------------------------------------
-- 4. Documents-tab rule (S1, resolveAccess semantics)
-- ---------------------------------------------------------------------
select pg_temp.ok(public.cpd__docs_tab_rule('cpd-a@example.invalid', 'grace-community'), 'full access = every tab');
select pg_temp.ok(not public.cpd__docs_tab_rule('cpd-s@example.invalid', 'grace-community'), 'scoped without documents = no');
select pg_temp.ok(public.cpd__docs_tab_rule('cpd-t@example.invalid', 'grace-community'), 'scoped with documents = yes');
select pg_temp.ok(public.cpd__docs_tab_rule('cpd-n@example.invalid', 'grace-community'), 'scoped with tabs NULL = every tab');
select pg_temp.ok(public.cpd__docs_tab_rule('cpd-bs@example.invalid', 'basic-test'), 'Basic plan = every tab, even scoped');
select pg_temp.ok(not public.cpd__docs_tab_rule('cpd-off@example.invalid', 'grace-community'), 'inactive login = no');
select pg_temp.ok(not public.cpd__docs_tab_rule('cpd-x@example.invalid', 'grace-community'), 'another org''s login = no');

-- ---------------------------------------------------------------------
-- 5. Client-facing RPCs
-- ---------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_client('cpd-b@example.invalid');
select pg_temp.expect_err(format($q$select public.client_file_set_access(%L::uuid, 'everyone', '{}')$q$, pg_temp.ctx('only')),
                          'forbidden', 'set_access from a non-uploader client fails');
select pg_temp.as_client('cpd-x@example.invalid');
select pg_temp.expect_err(format($q$select public.client_file_set_access(%L::uuid, 'everyone', '{}')$q$, pg_temp.ctx('only')),
                          'forbidden', 'set_access from another org fails');
select pg_temp.ok(not exists (select 1 from public.client_org_logins() l where l.email not like '%@example.invalid' or l.email in ('cpd-a@example.invalid', 'cpd-b@example.invalid')),
                  'client_org_logins() never returns grace-community logins to another org');
select pg_temp.as_client('cpd-a@example.invalid');
select pg_temp.ok((select count(*) from public.client_org_logins() l
                    where not exists (select 1 from client_users cu where lower(cu.email) = l.email and cu.client_id = 'grace-community' and cu.active)) = 0,
                  'client_org_logins() returns only active logins of the caller''s org');
select pg_temp.ok((public.client_page_drop_state() ->> 'eligible')::boolean, 'state: client login is eligible');
select pg_temp.as_staff(pg_temp.ctx('ad'));
select pg_temp.ok(not (public.client_page_drop_state() ->> 'eligible')::boolean, 'state: staff are not eligible');
reset role;

-- Switch-dependent (the switch is never written here).
set local role authenticated;
select pg_temp.as_client('cpd-a@example.invalid');
select case when pg_temp.ctx('sw') = 'off' then pg_temp.expect_err(
         format($q$select public.client_file_set_access(%L::uuid, 'everyone', '{}')$q$, pg_temp.ctx('only')),
         'feature_off', 'switch off: the uploader cannot change access') end;
select case when pg_temp.ctx('sw') = 'off' then pg_temp.ok(
         (select count(*) from public.client_org_logins()) = 0 and not (public.client_page_drop_state() ->> 'enabled')::boolean,
         'switch off: client_org_logins() is empty and state.enabled is false') end;
select pg_temp.as_staff(pg_temp.ctx('ad'));
select case when pg_temp.ctx('sw') = 'off' then pg_temp.expect_err(
         format($q$select public.client_file_set_access(%L::uuid, 'everyone', '{}')$q$, pg_temp.ctx('only')),
         'feature_off', 'switch off: staff cannot change access either') end;
select case when pg_temp.ctx('sw') = 'on' then pg_temp.ok(
         (public.client_file_set_access(pg_temp.ctx('except')::uuid, 'everyone', '{}') ->> 'access_mode') = 'everyone',
         'switch on: staff can reset a rule to everyone') end;
reset role;

-- ---------------------------------------------------------------------
-- 6. S7: document_folder_items + message-link trigger
-- ---------------------------------------------------------------------
insert into document_folders (client_id, name, created_by) values ('grace-community', 'CPD selftest folder', 'selftest');
insert into document_folder_items (client_id, doc_key, folder)
values ('grace-community', 'drive:' || pg_temp.ctx('only'), 'CPD selftest folder'),
       ('grace-community', 'drive:' || pg_temp.ctx('internal'), 'CPD selftest folder'),
       ('grace-community', 'link:cpd-selftest', 'CPD selftest folder');
set local role authenticated;
select pg_temp.as_client('cpd-b@example.invalid');
select pg_temp.ok((select count(*) from document_folder_items where folder = 'CPD selftest folder') = 1,
                  'B sees only the link item, not drive: items for files it cannot read');
select pg_temp.expect_err(format($q$insert into document_folder_items (client_id, doc_key, folder) values ('grace-community', 'drive:%s', 'CPD selftest folder')$q$, pg_temp.ctx('except')),
                          'row-level security', 'B cannot file a drive: item for a file it cannot read');
select pg_temp.as_client('cpd-a@example.invalid');
select pg_temp.ok((select count(*) from document_folder_items where folder = 'CPD selftest folder') = 2,
                  'A sees the link item and its readable only-file item (not the internal one)');
insert into document_folder_items (client_id, doc_key, folder)
values ('grace-community', 'drive:' || pg_temp.ctx('plain'), 'CPD selftest folder');
select pg_temp.ok((select count(*) from document_folder_items where folder = 'CPD selftest folder') = 3,
                  'A can file a readable drive: item');
reset role;
select pg_temp.ok(position($q$visibility = 'message'$q$ in pg_get_functiondef('public.client_messages_link_drive_file'::regproc)) > 0,
                  'message-link trigger only links message (or internal-note) files');

select 'Client page drop self-test passed';
rollback;
