-- =====================================================================
-- Self-test for security-hardening-2026-10-27.sql.
--
-- Run it whole; it ends in ROLLBACK, so nothing it writes is kept. The
-- client and staff it uses are picked at run time; the test people are
-- made-up addresses on the reserved .invalid domain. A failed check raises;
-- the last statement lists every check that passed.
--
-- Proves:
--   1. anon/authenticated hold no privilege on qbo_tokens/qbo_firm_tokens
--      and get "permission denied" on select; service_role still reads; the
--      token RPCs are still postgres-owned SECURITY DEFINER and callable by
--      service_role only.
--   2. access_link_client: a live 32+ char token still resolves for anon;
--      a live short token no longer does; grants unchanged.
--   3. conversation_has_members / conversation_is_unused: anon cannot
--      execute, authenticated and service_role can; an active staff member
--      still reads staff_conversations without error.
--   5. is_roster_client / cel_next_occurrence have a pinned search_path.
--   6. tk_projects: a project owner who is not active staff no longer sees
--      it; an active staff owner still does.
--   7. client_files: request files are visible to full-access users and to
--      limited users named on the request, not to other limited users;
--      shared files stay visible to all members.
-- =====================================================================
begin;

create temp table t_ctx (k text primary key, v text) on commit drop;
create temp table t_res (n serial, what text) on commit drop;
grant select, insert on t_ctx to authenticated, anon, service_role;
grant all on t_res to authenticated, anon, service_role;
grant usage on sequence t_res_n_seq to authenticated, anon, service_role;

create or replace function pg_temp.ctx(p_k text) returns text language sql as $$ select v from t_ctx where k = p_k $$;
create or replace function pg_temp.as_user(p_email text, p_google boolean default true) returns void language sql as $$
  select set_config('request.jwt.claims',
    case when p_email is null then '' else json_build_object(
      'sub', gen_random_uuid(), 'email', p_email, 'role', 'authenticated',
      'app_metadata', case when p_google then json_build_object('provider', 'google')
                           else json_build_object('provider', 'email') end)::text end, true);
$$;
create or replace function pg_temp.ok(p_cond boolean, p_what text) returns void language plpgsql as $$
begin
  if p_cond is not true then raise exception 'SELF-TEST FAILED: %', p_what; end if;
  insert into t_res (what) values (p_what);
end $$;
create or replace function pg_temp.expect_err(p_sql text, p_err text, p_what text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if position(p_err in sqlerrm) > 0 then insert into t_res (what) values (p_what); return; end if;
    raise exception 'SELF-TEST FAILED: % expected %, got %', p_what, p_err, sqlerrm;
  end;
  raise exception 'SELF-TEST FAILED: % expected %, but it succeeded', p_what, p_err;
end $$;
-- file names in a client's client_files that p_email can see through RLS
create or replace function pg_temp.files_seen(p_email text) returns text language plpgsql as $$
declare v text;
begin
  perform pg_temp.as_user(p_email, false);
  set local role authenticated;
  select string_agg(name, ',' order by name) into v from public.client_files
   where client_id = pg_temp.ctx('client') and name like 'sec-test-%';
  reset role;
  perform pg_temp.as_user(null);
  return coalesce(v, '');
end $$;
grant execute on all functions in schema pg_temp to authenticated, anon, service_role;

-- ---------------------------------------------------------------------
-- Context
-- ---------------------------------------------------------------------
insert into t_ctx values
  ('client', (select id from clients where not coalesce(is_internal, false) and not coalesce(test_only, false) order by id limit 1)),
  ('staff',  (select lower(email) from staff where active and email = lower(email)
              order by (role = 'admin'), email limit 1));
select pg_temp.ok(pg_temp.ctx('client') is not null and pg_temp.ctx('staff') is not null, 'context: a roster client and an active staff member found');

-- ---------------------------------------------------------------------
-- 1. QBO token tables
-- ---------------------------------------------------------------------
select pg_temp.ok(not exists (
  select 1 from (values ('anon'), ('authenticated')) r(role),
                (values ('public.qbo_tokens'), ('public.qbo_firm_tokens')) t(tbl),
                (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) p(priv)
   where has_table_privilege(r.role, t.tbl, p.priv)), '1: anon and authenticated hold no privilege on either token table');
select pg_temp.ok(has_table_privilege('service_role', 'public.qbo_tokens', 'SELECT,INSERT,UPDATE,DELETE')
              and has_table_privilege('service_role', 'public.qbo_firm_tokens', 'SELECT,INSERT,UPDATE,DELETE'),
                  '1: service_role keeps full access to both token tables');

select pg_temp.as_user(null);
set local role anon;
select pg_temp.expect_err('select count(*) from public.qbo_tokens', 'permission denied', '1: anon select on qbo_tokens is denied');
select pg_temp.expect_err('select count(*) from public.qbo_firm_tokens', 'permission denied', '1: anon select on qbo_firm_tokens is denied');
reset role;
select pg_temp.as_user(pg_temp.ctx('staff'));
set local role authenticated;
select pg_temp.expect_err('select count(*) from public.qbo_tokens', 'permission denied', '1: signed-in staff select on qbo_tokens is denied');
select pg_temp.expect_err('select count(*) from public.qbo_firm_tokens', 'permission denied', '1: signed-in staff select on qbo_firm_tokens is denied');
reset role;
select pg_temp.as_user(null);
set local role service_role;
select pg_temp.ok((select count(*) >= 0 from public.qbo_tokens) and (select count(*) >= 0 from public.qbo_firm_tokens), '1: service_role still reads both token tables');
reset role;

select pg_temp.ok(not exists (
  select 1 from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.oid in ('public.qbo_get_tokens(text,text)'::regprocedure,
                   'public.qbo_store_tokens(text,text,text,timestamptz,text)'::regprocedure,
                   'public.qbo_firm_get_tokens(text)'::regprocedure,
                   'public.qbo_firm_store_tokens(text,text,timestamptz,text)'::regprocedure)
     and (not p.prosecdef or pg_get_userbyid(p.proowner) <> 'postgres'
          or not has_function_privilege('service_role', p.oid, 'EXECUTE')
          or has_function_privilege('anon', p.oid, 'EXECUTE')
          or has_function_privilege('authenticated', p.oid, 'EXECUTE'))),
  '1: token RPCs stay postgres-owned SECURITY DEFINER, service_role only');

-- ---------------------------------------------------------------------
-- 2. access_link_client
-- ---------------------------------------------------------------------
insert into access_request_links (token, client_id, active, expires_at)
values (repeat('a', 40) || 'sectest', pg_temp.ctx('client'), true, now() + interval '1 day'),
       ('shortsectest', pg_temp.ctx('client'), true, now() + interval '1 day');
select pg_temp.as_user(null);
set local role anon;
select pg_temp.ok(public.access_link_client(repeat('a', 40) || 'sectest') = pg_temp.ctx('client'), '2: a live 32+ char token still resolves for anon');
select pg_temp.ok(public.access_link_client('shortsectest') is null, '2: a live short token no longer resolves');
select pg_temp.ok(public.access_link_client('') is null and public.access_link_client(null) is null, '2: empty and null tokens resolve to nothing');
reset role;
select pg_temp.ok(has_function_privilege('anon', 'public.access_link_client(text)', 'EXECUTE')
              and has_function_privilege('authenticated', 'public.access_link_client(text)', 'EXECUTE')
              and (select prosecdef and provolatile = 's' from pg_proc where oid = 'public.access_link_client(text)'::regprocedure),
                  '2: access_link_client keeps its grants, SECURITY DEFINER and STABLE');

-- ---------------------------------------------------------------------
-- 3. conversation helpers
-- ---------------------------------------------------------------------
select pg_temp.ok(not has_function_privilege('anon', 'public.conversation_has_members(uuid)', 'EXECUTE')
              and not has_function_privilege('anon', 'public.conversation_is_unused(uuid)', 'EXECUTE'),
                  '3: anon cannot execute the conversation helpers');
select pg_temp.ok(has_function_privilege('authenticated', 'public.conversation_has_members(uuid)', 'EXECUTE')
              and has_function_privilege('authenticated', 'public.conversation_is_unused(uuid)', 'EXECUTE')
              and has_function_privilege('service_role', 'public.conversation_has_members(uuid)', 'EXECUTE')
              and has_function_privilege('service_role', 'public.conversation_is_unused(uuid)', 'EXECUTE'),
                  '3: authenticated and service_role keep EXECUTE (policies need it)');
select pg_temp.as_user(pg_temp.ctx('staff'));
set local role authenticated;
select pg_temp.ok((select count(*) >= 0 from public.staff_conversations), '3: active staff still read staff_conversations without error');
reset role;
select pg_temp.as_user(null);

-- ---------------------------------------------------------------------
-- 5. pinned search_path
-- ---------------------------------------------------------------------
select pg_temp.ok((select proconfig @> array['search_path=public, pg_temp'] from pg_proc where oid = 'public.is_roster_client(public.clients)'::regprocedure)
              and (select proconfig @> array['search_path=public, pg_temp'] from pg_proc where oid = 'public.cel_next_occurrence(date,date)'::regprocedure),
                  '5: is_roster_client and cel_next_occurrence have search_path = public, pg_temp');
select pg_temp.ok(public.cel_next_occurrence(date '2000-12-25', date '2026-10-27') = date '2026-12-25', '5: cel_next_occurrence still computes the next anniversary');

-- ---------------------------------------------------------------------
-- 6. tk_projects owner branch needs active staff
-- ---------------------------------------------------------------------
select pg_temp.as_user(null);
insert into tk_projects (name, kind, color, owner_email) values ('sec-test ghost', 'internal', 'gray', 'ghost.sectest@mygoodbooks.org');
insert into tk_projects (name, kind, color, owner_email) values ('sec-test staff', 'internal', 'gray', pg_temp.ctx('staff'));
select pg_temp.as_user('ghost.sectest@mygoodbooks.org');
set local role authenticated;
select pg_temp.ok(not exists (select 1 from public.tk_projects where name = 'sec-test ghost'), '6: an owner who is not active staff no longer sees the project');
reset role;
select pg_temp.as_user(pg_temp.ctx('staff'));
set local role authenticated;
select pg_temp.ok(exists (select 1 from public.tk_projects where name = 'sec-test staff'), '6: an active staff owner still sees the project');
reset role;
select pg_temp.as_user(null);

-- ---------------------------------------------------------------------
-- 7. client_files request files for limited users
-- ---------------------------------------------------------------------
insert into client_users (email, client_id, name, role, active, access) values
  ('full.sectest@example.invalid', pg_temp.ctx('client'), 'Sec Test Full', 'Contact', true, 'full'),
  ('lim.sectest@example.invalid',  pg_temp.ctx('client'), 'Sec Test Lim',  'Contact', true, 'scoped'),
  ('lim2.sectest@example.invalid', pg_temp.ctx('client'), 'Sec Test Lim2', 'Contact', true, 'scoped');
with r as (
  insert into client_requests (client_id, kind, title, prompt, asked_by, recipient_emails, needs_upload)
  values (pg_temp.ctx('client'), 'document', 'sec-test request', 'sec-test prompt', 'sec-test', array['LIM.sectest@example.invalid'], true)
  returning id)
insert into t_ctx select 'req', id::text from r;
insert into client_files (client_id, drive_file_id, name, year, visibility, client_request_id) values
  (pg_temp.ctx('client'), 'sec-test-drive-1', 'sec-test-req-linked',   2026, 'request', pg_temp.ctx('req')::uuid),
  (pg_temp.ctx('client'), 'sec-test-drive-2', 'sec-test-req-unlinked', 2026, 'request', null),
  (pg_temp.ctx('client'), 'sec-test-drive-3', 'sec-test-shared',       2026, 'shared',  null),
  (pg_temp.ctx('client'), 'sec-test-drive-4', 'sec-test-internal',     2026, 'internal', null);

select pg_temp.ok(pg_temp.files_seen('full.sectest@example.invalid') = 'sec-test-req-linked,sec-test-req-unlinked,sec-test-shared',
                  '7: full-access user sees every request file and shared files, not internal');
select pg_temp.ok(pg_temp.files_seen('lim.sectest@example.invalid') = 'sec-test-req-linked,sec-test-shared',
                  '7: limited user named on the request sees that request''s file and shared files only');
select pg_temp.ok(pg_temp.files_seen('lim2.sectest@example.invalid') = 'sec-test-shared',
                  '7: limited user not on the request sees shared files only');
select pg_temp.ok(pg_temp.files_seen('nobody.sectest@example.invalid') = '',
                  '7: a non-member sees nothing');
select pg_temp.ok(not has_function_privilege('anon', 'public.client_file_request_visible(text,uuid)', 'EXECUTE')
              and has_function_privilege('authenticated', 'public.client_file_request_visible(text,uuid)', 'EXECUTE'),
                  '7: the request-file helper is not callable by anon');
-- a recipient on a deleted request loses the file
update client_requests set deleted_at = now() where id = pg_temp.ctx('req')::uuid;
select pg_temp.ok(pg_temp.files_seen('lim.sectest@example.invalid') = 'sec-test-shared',
                  '7: once the request is deleted its limited recipient no longer sees the file');

select jsonb_agg(what order by n) as passed from t_res;
rollback;
