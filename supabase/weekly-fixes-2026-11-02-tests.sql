-- Self-test for supabase/migrations/20261102120000_weekly_fixes_2026_11_02.sql.
-- Runs on a SCRATCH Postgres only (never production): it creates stub tables
-- and helper functions shaped like the live ones, applies the migration twice
-- (idempotency), then checks each rule. Expect: failures = 0.
--   createdb t && psql -d t -f supabase/weekly-fixes-2026-11-02-tests.sql

create role anon; create role authenticated; create role service_role;
create schema auth;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true),''),'{}')::jsonb $$;
set search_path=public;
create table clients(id text primary key, name text, plan text default 'premium', hidden_tabs text[], is_internal boolean default false);
create table client_users(email text, client_id text, active boolean default true, access text default 'full', tabs text[], categories text[]);
create table client_files(id uuid primary key, client_id text, visibility text, participant_email text, client_request_id uuid, access_mode text default 'everyone', trashed_at timestamptz);
create table client_file_access(file_id uuid, client_id text, email text);
create table client_requests(id uuid primary key, client_id text, deleted_at timestamptz, recipient_emails text[]);
create table tk_settings(key text primary key, value jsonb);
create table staff(email text primary key, active boolean, role text);
create table staff_client_access(staff_email text, client_id text);
create table client_thread_state(client_id text, participant_email text, hidden_at timestamptz, hidden_by text, hide_marker_id uuid, updated_at timestamptz, updated_by text);
create table usage_events(id bigint, actor_email text, actor_role text, client_id text, view_as boolean default false);
alter table usage_events enable row level security;
create policy "signed-in users can log their own usage" on usage_events for insert to authenticated with check (true);
create table tk_projects(id uuid primary key, client_id text, sections text[], trashed_at timestamptz);
create table tk_rules(id uuid primary key, name text, scope_kind text, project_id uuid, client_id text, trigger_kind text, trigger_config jsonb, action_kind text, action_config jsonb, enabled boolean, archived_at timestamptz);
alter table tk_rules enable row level security;
create policy "tk rules staff read" on tk_rules for select to authenticated using (true);
create table client_agreements(id uuid, client_id text, title text, agreement_type text, status text, signed_on date, effective_on date, expires_on date, document_url text, client_file_id uuid, created_at timestamptz default now(), visible_to_client boolean, trashed_at timestamptz);
create function tk__jsonb_bool(j jsonb) returns boolean language sql immutable as $$ select case when jsonb_typeof(j)='boolean' then j::text::boolean else false end $$;
create function cpd__on(p_client_id text) returns boolean language sql stable as $$ select coalesce(tk__jsonb_bool((select value from tk_settings where key='client_page_drop_enabled')),false) $$;
create function is_client_member(p text) returns boolean language sql stable as $$ select exists(select 1 from client_users cu where cu.email=auth.jwt()->>'email' and cu.client_id=p and cu.active) $$;
create function client_docs_tab_ok(p text) returns boolean language sql stable as $$ select true $$;
create function agreements__client_enabled() returns boolean language sql stable as $$ select true $$;
create function is_active_staff() returns boolean language sql stable as $$ select exists(select 1 from staff where email=auth.jwt()->>'email' and active) $$;
create function is_active_staff_admin() returns boolean language sql stable as $$ select exists(select 1 from staff where email=auth.jwt()->>'email' and active and role='admin') $$;
create function can_access_client(p text) returns boolean language sql stable as $$ select is_active_staff_admin() or exists(select 1 from staff_client_access where staff_email=auth.jwt()->>'email' and client_id=p) $$;
create function thread__guard(c text, e text) returns text language sql as $$ select lower(e) $$;
create function thread__row(c text, e text) returns client_thread_state language sql as $$ select * from client_thread_state where client_id=c and participant_email=e $$;
create function thread__mark_no_reply(c text, e text) returns uuid language sql as $$ select null::uuid $$;
create function thread__audit(c text, e text, a text, f jsonb, t jsonb, m uuid) returns void language sql as $$ select $$;
create function tk_can_see_project(p uuid) returns boolean language sql stable as $$ select true $$;
create function tk__rule_pair_ok(a text, b text) returns boolean language sql as $$ select true $$;
create function tk_staff_has_client(e text, c text) returns boolean language sql as $$ select true $$;
create function tk__rule_int(j jsonb) returns int language sql as $$ select (j#>>'{}')::int $$;
-- live (pre-fix) definition of cpd__docs_tab_rule, so the replacement is tested over an existing function
create function cpd__docs_tab_rule(p_email text, p_client_id text) returns boolean language sql stable as $$ select true $$;

\i supabase/migrations/20261102120000_weekly_fixes_2026_11_02.sql
\i supabase/migrations/20261102120000_weekly_fixes_2026_11_02.sql

\set ON_ERROR_STOP 1
insert into clients values ('a','A','premium',null,false),('b','B','premium','{documents}',false),('mgb','MGB','premium',null,true);
insert into client_users(email,client_id,access,tabs) values ('pat@a.org','a','full',null),('lim@a.org','a','limited','{reports}'),('bo@b.org','b','full',null),('in@mgb.org','mgb','full',null);
insert into client_users(email,client_id,active) values ('old@a.org','a',false);
insert into tk_settings values ('client_page_drop_enabled','true');
insert into client_files values
 ('00000000-0000-0000-0000-000000000001','a','shared',null,null,'everyone',null),
 ('00000000-0000-0000-0000-000000000002','a','shared',null,null,'only',null),
 ('00000000-0000-0000-0000-000000000003','a','shared',null,null,'everyone',now()),
 ('00000000-0000-0000-0000-000000000004','a','internal',null,null,'everyone',null),
 ('00000000-0000-0000-0000-000000000005','a','message','pat@a.org',null,'everyone',null),
 ('00000000-0000-0000-0000-000000000006','b','shared',null,null,'everyone',null),
 ('00000000-0000-0000-0000-000000000007','mgb','shared',null,null,'everyone',null),
 ('00000000-0000-0000-0000-000000000008','a','request',null,'00000000-0000-0000-0000-0000000000a1','everyone',null) ;
insert into client_requests values ('00000000-0000-0000-0000-0000000000a1','a',null,'{lim@a.org}');
insert into client_file_access values ('00000000-0000-0000-0000-000000000002','a','pat@a.org');
create temp table r(label text, got boolean, want boolean);
insert into r values
 ('shared everyone, full login', client_file_download_ok('00000000-0000-0000-0000-000000000001','pat@a.org'), true),
 ('shared, email case/space', client_file_download_ok('00000000-0000-0000-0000-000000000001',' PAT@a.org '), true),
 ('shared, limited login without documents tab', client_file_download_ok('00000000-0000-0000-0000-000000000001','lim@a.org'), false),
 ('shared, inactive login', client_file_download_ok('00000000-0000-0000-0000-000000000001','old@a.org'), false),
 ('shared, other org', client_file_download_ok('00000000-0000-0000-0000-000000000001','bo@b.org'), false),
 ('only-list, on list', client_file_download_ok('00000000-0000-0000-0000-000000000002','pat@a.org'), true),
 ('only-list, off list', client_file_download_ok('00000000-0000-0000-0000-000000000002','x@a.org'), false),
 ('trashed', client_file_download_ok('00000000-0000-0000-0000-000000000003','pat@a.org'), false),
 ('internal note file', client_file_download_ok('00000000-0000-0000-0000-000000000004','pat@a.org'), false),
 ('message, participant', client_file_download_ok('00000000-0000-0000-0000-000000000005','pat@a.org'), true),
 ('message, other login', client_file_download_ok('00000000-0000-0000-0000-000000000005','lim@a.org'), false),
 ('org hides documents tab', client_file_download_ok('00000000-0000-0000-0000-000000000006','bo@b.org'), false),
 ('internal company file', client_file_download_ok('00000000-0000-0000-0000-000000000007','in@mgb.org'), false),
 ('request, recipient', client_file_download_ok('00000000-0000-0000-0000-000000000008','lim@a.org'), true),
 ('request, full login', client_file_download_ok('00000000-0000-0000-0000-000000000008','pat@a.org'), true),
 ('request, not recipient', client_file_download_ok('00000000-0000-0000-0000-000000000008','bo@b.org'), false),
 ('docs rule hidden tab', cpd__docs_tab_rule('bo@b.org','b'), false),
 ('docs rule normal', cpd__docs_tab_rule('pat@a.org','a'), true);
-- privileges
insert into r values ('authenticated cannot execute', has_function_privilege('authenticated','client_file_download_ok(uuid,text)','EXECUTE'), false),
 ('anon cannot execute', has_function_privilege('anon','client_file_download_ok(uuid,text)','EXECUTE'), false),
 ('service_role can execute', has_function_privilege('service_role','client_file_download_ok(uuid,text)','EXECUTE'), true);
-- rule caller check
insert into staff values ('adm@mgb.org',true,'admin'),('s@mgb.org',true,'staff');
insert into staff_client_access values ('s@mgb.org','a');
select set_config('request.jwt.claims','{"email":"s@mgb.org"}',false);
insert into r values ('rule on own client ok', tk__rule_problem(row('00000000-0000-0000-0000-0000000000c1','R','client',null,'a','done','{}','comment','{"text":"hi"}',false,null)::tk_rules) is null, true),
 ('rule on other client refused', tk__rule_problem(row('00000000-0000-0000-0000-0000000000c1','R','client',null,'b','done','{}','comment','{"text":"hi"}',false,null)::tk_rules) = 'You can''t open this client.', true);
-- thread_hide
insert into client_thread_state(client_id,participant_email) values ('a','pat@a.org'),('b','bo@b.org');
insert into staff values ('tmp@mgb.org',true,'staff');
select set_config('request.jwt.claims','{"email":"tmp@mgb.org"}',false);
do $$ begin perform thread_hide('a','pat@a.org'); insert into r values ('temp-grant staff hide refused', false, true); exception when others then insert into r values ('temp-grant staff hide refused', sqlerrm='no_client_access', true); end $$;
select set_config('request.jwt.claims','{"email":"s@mgb.org"}',false);
do $$ begin perform thread_hide('a','pat@a.org'); insert into r values ('assigned staff hide ok', true, true); exception when others then insert into r values ('assigned staff hide ok', false, true); end $$;
select set_config('request.jwt.claims','{"email":"adm@mgb.org"}',false);
do $$ begin perform thread_hide('b','bo@b.org'); insert into r values ('admin hide ok', true, true); exception when others then insert into r values ('admin hide ok', false, true); end $$;
-- policies text
insert into r select 'view_as clause in policy', with_check like '%view_as%is_active_staff_admin()%', true from pg_policies where policyname='signed-in users can log their own usage';
insert into r select 'tk_rules policy has client check', qual like '%can_access_client%' and qual not like '%is_active_staff_admin%', true from pg_policies where policyname='tk rules staff read';
select label, got, want, case when got is not distinct from want then 'ok' else 'FAIL' end from r;
select count(*) filter (where got is distinct from want) as failures from r;
