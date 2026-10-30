-- =====================================================================
-- Self-test: client page drop, Phase 2 database
-- (supabase/client-page-drop-2-staff.sql).
--
-- Covers: grants (anon can't run either function), staff rename (set,
-- reset to the original, same-as-original stores null, 200-char cap,
-- control characters cleaned, logged as 'renamed'), a new name refused
-- while the switch is off for the client (going back to the original name
-- still allowed), files in Trash and old Storage uploads refused, a client
-- login can't rename or read history, history returns only that file's
-- rows, the Desk inbox row shows "New file: <display name>" (wb_inbox run
-- as an admin), and a folder rename carries its files (ON UPDATE CASCADE).
--
-- Run it whole; it ends in ROLLBACK. Uses the test client grace-community
-- with throwaway rows that live only inside this transaction. The switch
-- rows (client_page_drop_enabled / _pilot) are written INSIDE this
-- transaction (owner override set locally and cleared right after, as in
-- client-page-drop-tests.sql section 7) and vanish at the ROLLBACK; no other
-- session ever sees them. A failed check raises and stops the run.
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

-- 0. Grants
select pg_temp.ok(
  not has_function_privilege('anon', f, 'execute') and has_function_privilege('authenticated', f, 'execute'),
  format('authenticated (not anon) can execute %s', f))
from unnest(array['public.client_file_rename(uuid,text)', 'public.client_file_access_history(uuid)']) f;
select pg_temp.ok(position('f.display_name' in pg_get_functiondef('public.wb_inbox(text,text[],boolean)'::regprocedure)) > 0,
                  'wb_inbox New file title reads display_name');

-- Setup
insert into t_ctx select 'ad', s.email from staff s where s.active and s.role = 'admin' order by s.email limit 1;
select pg_temp.ok(pg_temp.ctx('ad') is not null, 'found an active admin');
insert into client_users (email, client_id, name, role, active, access, tabs) values
  ('cpd2-a@example.invalid', 'grace-community', 'CPD2 A', 'Team member', true, 'full', null);
with ins as (
  insert into client_files (client_id, drive_file_id, name, year, doc_type, visibility, uploaded_by)
  values ('grace-community', 'cpd2-selftest-a-' || gen_random_uuid(), 'bank-statement.pdf', 2026, 'Other', 'shared', 'cpd2-a@example.invalid'),
         ('grace-community', 'cpd2-selftest-b-' || gen_random_uuid(), 'other.pdf', 2026, 'Other', 'shared', 'cpd2-a@example.invalid')
  returning id, name)
insert into t_ctx select split_part(name, '.', 1), id::text from ins;
insert into drive_file_events (action, ok, client_id, actor, detail) values
  ('upload', true, 'grace-community', 'cpd2-a@example.invalid', json_build_object('file_id', pg_temp.ctx('bank-statement'), 'access_mode', 'everyone')::text),
  ('upload', true, 'grace-community', 'cpd2-a@example.invalid', json_build_object('file_id', pg_temp.ctx('other'), 'access_mode', 'everyone')::text);

-- 1a. Switch OFF for this client (inside this transaction only): a new
--     name is refused, back to the original name is allowed.
select set_config('mgb.tk_owner_override', 'on', true);
insert into tk_settings (key, value) values ('client_page_drop_enabled', 'false'::jsonb)
on conflict (key) do update set value = excluded.value;
select set_config('mgb.tk_owner_override', '', true);
select pg_temp.ok(not public.cpd__on('grace-community'), 'switch off (this transaction only)');
select pg_temp.as_staff(pg_temp.ctx('ad'));
set local role authenticated;
select pg_temp.expect_err(format('select public.client_file_rename(%L::uuid, %L)', pg_temp.ctx('bank-statement'), 'New name'),
                          'feature_off', 'a new name waits for the switch');
select pg_temp.ok((public.client_file_rename(pg_temp.ctx('bank-statement')::uuid, '') ->> 'display_name') is null,
                  'going back to the original name works with the switch off');
reset role;

-- 1b. Switch ON for grace-community (inside this transaction only).
select set_config('mgb.tk_owner_override', 'on', true);
insert into tk_settings (key, value) values
  ('client_page_drop_enabled', 'true'::jsonb),
  ('client_page_drop_pilot', '["grace-community"]'::jsonb)
on conflict (key) do update set value = excluded.value;
select set_config('mgb.tk_owner_override', '', true);
select pg_temp.ok(public.cpd__on('grace-community'), 'switch on (this transaction only) for grace-community');

-- 1c. Staff rename
select pg_temp.as_staff(pg_temp.ctx('ad'));
set local role authenticated;
select pg_temp.ok((public.client_file_rename(pg_temp.ctx('bank-statement')::uuid, '  March  statement ') ->> 'display_name') = 'March  statement',
                  'staff rename trims and stores the display name');
select pg_temp.ok((public.client_file_rename(pg_temp.ctx('bank-statement')::uuid, 'a' || chr(10) || 'b') ->> 'display_name') = 'a b',
                  'control characters become spaces');
select pg_temp.ok((public.client_file_rename(pg_temp.ctx('bank-statement')::uuid, 'bank-statement.pdf') ->> 'display_name') is null,
                  'renaming back to the original name stores null');
select pg_temp.ok((public.client_file_rename(pg_temp.ctx('bank-statement')::uuid, 'Final name') ->> 'display_name') = 'Final name',
                  'rename again');
select pg_temp.expect_err(format('select public.client_file_rename(%L::uuid, %L)', pg_temp.ctx('bank-statement'), repeat('x', 201)),
                          'bad_display_name', '201 characters refused');
select pg_temp.ok((select count(*) from public.client_file_access_history(pg_temp.ctx('bank-statement')::uuid) where action = 'renamed') = 5,
                  'each rename is in the history');
select pg_temp.ok((select count(*) from public.client_file_access_history(pg_temp.ctx('bank-statement')::uuid) where action = 'upload') = 1,
                  'history has the upload row');
select pg_temp.ok(not exists (select 1 from public.client_file_access_history(pg_temp.ctx('bank-statement')::uuid)
                               where position(pg_temp.ctx('other') in detail) > 0),
                  'history never returns another file''s rows');
reset role;
select pg_temp.ok((select display_name from client_files where id = pg_temp.ctx('bank-statement')::uuid) = 'Final name',
                  'display_name saved');
select pg_temp.ok((select name from client_files where id = pg_temp.ctx('bank-statement')::uuid) = 'bank-statement.pdf',
                  'original name untouched');

-- 1d. Only live portal files: Trash and old Storage uploads are refused.
update client_files set trashed_at = now(), trashed_by = pg_temp.ctx('ad') where id = pg_temp.ctx('other')::uuid;
select pg_temp.as_staff(pg_temp.ctx('ad'));
set local role authenticated;
select pg_temp.expect_err(format('select public.client_file_rename(%L::uuid, %L)', pg_temp.ctx('other'), 'x'),
                          'bad_file', 'a file in Trash cannot be renamed');
reset role;
update client_files set trashed_at = null, trashed_by = null, legacy_path = 'grace-community/shared/cpd2-selftest.pdf'
 where id = pg_temp.ctx('other')::uuid;
select pg_temp.as_staff(pg_temp.ctx('ad'));
set local role authenticated;
select pg_temp.expect_err(format('select public.client_file_rename(%L::uuid, %L)', pg_temp.ctx('other'), 'x'),
                          'bad_file', 'an old Storage upload cannot be renamed');
reset role;
update client_files set legacy_path = null where id = pg_temp.ctx('other')::uuid;

-- 1e. The Desk inbox row shows the display name (wb_inbox as an admin).
select pg_temp.as_staff(pg_temp.ctx('ad'));
set local role authenticated;
select pg_temp.ok((select title from public.wb_inbox('everyone', array['doc'], true)
                    where source_id = pg_temp.ctx('bank-statement')) = 'New file: Final name',
                  'Desk inbox: New file: <display name>');
select pg_temp.ok((select title from public.wb_inbox('everyone', array['doc'], true)
                    where source_id = pg_temp.ctx('other')) = 'New file: other.pdf',
                  'Desk inbox: no display name falls back to the file name');
reset role;

-- 2. Clients can't
select pg_temp.as_client('cpd2-a@example.invalid');
set local role authenticated;
select pg_temp.expect_err(format('select public.client_file_rename(%L::uuid, %L)', pg_temp.ctx('other'), 'x'),
                          'forbidden', 'a client login cannot use the staff rename');
select pg_temp.expect_err(format('select * from public.client_file_access_history(%L::uuid)', pg_temp.ctx('other')),
                          'forbidden', 'a client login cannot read the history');
reset role;

-- 3. Folder rename carries its files (ON UPDATE CASCADE)
insert into document_folders (client_id, name, sort) values ('grace-community', 'cpd2 old folder', 900);
insert into document_folder_items (client_id, doc_key, folder) values ('grace-community', 'drive:' || pg_temp.ctx('other'), 'cpd2 old folder');
update document_folders set name = 'cpd2 new folder' where client_id = 'grace-community' and name = 'cpd2 old folder';
select pg_temp.ok((select folder from document_folder_items where client_id = 'grace-community' and doc_key = 'drive:' || pg_temp.ctx('other')) = 'cpd2 new folder',
                  'renaming a folder moves its files with it');

select pg_temp.ok(true, 'ALL CLIENT PAGE DROP PHASE 2 CHECKS PASSED');
rollback;
