-- =====================================================================
-- Self-test for slateplus-profile2.sql (spec docs/slateplus-profile2-spec.md
-- section 7.1, tests 1-15).
--
-- Run it whole AFTER the migration is applied (or splice the migration in at
-- the @@MIGRATION@@ marker to test it before applying). It ends in ROLLBACK:
-- nothing it writes is kept (throwaway staff, clients, HR rows, tasks,
-- comments, projects, SOPs, profile rows, teams). The throwaway staff use
-- tkp2-*@mygoodbooks.org (the staff email rule) and the client login
-- @example.invalid; no real person's data is changed or printed.
-- A failed check raises 'SELF-TEST FAILED: ...' and stops. Each passing
-- check bumps the tkp2.ok counter; the last select prints the count.
-- =====================================================================
begin;
-- @@MIGRATION@@

create temp table t_ctx (k text primary key, v text) on commit drop;
grant select on t_ctx to authenticated, anon;

create or replace function pg_temp.ctx(p_k text) returns text language sql as $$ select v from t_ctx where k = p_k $$;
create or replace function pg_temp.id(p_k text) returns uuid language sql as $$ select v::uuid from t_ctx where k = p_k $$;
create or replace function pg_temp.as_user(p_email text) returns void language sql as $$
  select set_config('request.jwt.claims',
    case when p_email is null then '' else json_build_object(
      'sub', gen_random_uuid(), 'email', p_email,
      'role', 'authenticated', 'app_metadata', json_build_object('provider', 'google'))::text end, true);
$$;
create or replace function pg_temp.ok(p_cond boolean, p_what text) returns void language plpgsql as $$
begin
  if p_cond is not true then raise exception 'SELF-TEST FAILED: %', p_what; end if;
  perform set_config('tkp2.ok', (coalesce(nullif(current_setting('tkp2.ok', true), ''), '0')::int + 1)::text, true);
  raise notice 'ok: %', p_what;
end $$;
-- Runs p_sql; it must fail with SQLSTATE p_state.
create or replace function pg_temp.expect_state(p_sql text, p_state text, p_what text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlstate = p_state then perform pg_temp.ok(true, p_what || ' (' || p_state || ')'); return; end if;
    raise exception 'SELF-TEST FAILED: % expected %, got % %', p_what, p_state, sqlstate, sqlerrm;
  end;
  raise exception 'SELF-TEST FAILED: % expected %, but it succeeded', p_what, p_state;
end $$;
-- Runs p_sql (an update/delete) and returns how many rows it touched.
create or replace function pg_temp.rows(p_sql text) returns int language plpgsql as $$
declare n int;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
end $$;
-- One task written as a direct database session; an empty assignee stays empty.
create or replace function pg_temp.mk(p_key text, p_owner text, p_assignee text, p_text text,
                                      p_client text, p_vis text, p_status text, p_due date)
returns void language plpgsql as $$
declare v uuid;
begin
  perform set_config('mgb.tk_unassigned', case when p_assignee is null then 'on' else '' end, true);
  insert into staff_reminders (staff_email, assignee_email, text, client_id, kind, visibility, status, due_date)
  values (p_owner, p_assignee, p_text, p_client, 'task', p_vis, coalesce(p_status, 'todo'), p_due)
  returning id into v;
  perform set_config('mgb.tk_unassigned', '', true);
  insert into t_ctx values (p_key, v::text);
end $$;

-- ---------------------------------------------------------------------
-- Fixtures (direct database session, no JWT)
-- ---------------------------------------------------------------------
select pg_temp.as_user(null);
select pg_temp.ok(not exists (select 1 from staff where email like 'tkp2-%@%'), 'no leftover test staff');
select pg_temp.ok(not exists (select 1 from clients where id like 'tkp2-%'), 'no leftover test clients');

insert into staff (email, name, role, active) values
  ('tkp2-a@mygoodbooks.org', 'Tkp Alpha', 'bookkeeper', true),
  ('tkp2-b@mygoodbooks.org', 'Tkp Bravo', 'bookkeeper', true),
  ('tkp2-c@mygoodbooks.org', 'Tkp Charlie', 'admin', true),
  ('tkp2-e@mygoodbooks.org', 'Tkp Echo', 'bookkeeper', true),
  ('tkp2-z@mygoodbooks.org', 'Tkp Zulu', 'bookkeeper', false);
select pg_temp.ok(exists (select 1 from internal_access where staff_email = 'tkp2-c@mygoodbooks.org'),
                  'setup: admin C has internal access');

-- Only one internal client may exist (clients_one_internal), so the tests use
-- the firm's existing internal client and never change it.
create or replace function pg_temp.int_client() returns text language sql stable as
  $$ select id from clients where is_internal order by id limit 1 $$;
select pg_temp.ok(pg_temp.int_client() is not null, 'setup: an internal client exists');
insert into clients (id, name, org_type, is_internal, test_only, account_manager, account_manager_email)
select x.id, x.name, (select org_type from clients where org_type is not null limit 1), x.internal, x.test, null, null
  from (values ('tkp2-x', 'Pelican Bakery Tkp', false, false),
               ('tkp2-y', 'Yonder Farm Tkp', false, false),
               ('tkp2-t', 'Trial Only Tkp', false, true)) x(id, name, internal, test);
insert into staff_client_access (staff_email, client_id) values
  ('tkp2-a@mygoodbooks.org', 'tkp2-x'), ('tkp2-a@mygoodbooks.org', pg_temp.int_client()), ('tkp2-a@mygoodbooks.org', 'tkp2-t');
select pg_temp.ok(not exists (select 1 from staff_client_access where staff_email = 'tkp2-b@mygoodbooks.org'),
                  'setup: B has no client access');

-- Shared tasks need a client or project (staff_reminders_shared_needs_client),
-- so the shared workload tasks sit on Y, which A and B cannot open.
-- HR: B and E and Z report to C; A reports to E (E has ended, so A shows no manager)
insert into staff_hr_records (staff_email, manager_email, end_date, legal_name, personal_phone, address, notes) values
  ('tkp2-b@mygoodbooks.org', 'tkp2-c@mygoodbooks.org', null, 'Secret Legal B', '555-0100', '1 Hidden St', 'private note'),
  ('tkp2-e@mygoodbooks.org', 'tkp2-c@mygoodbooks.org', current_date - 30, null, null, null, null),
  ('tkp2-z@mygoodbooks.org', 'tkp2-c@mygoodbooks.org', null, null, null, null, null),
  ('tkp2-a@mygoodbooks.org', 'tkp2-e@mygoodbooks.org', null, null, null, null, null);

-- Projects P1 (on X) and P2 (on X, trashed)
insert into tk_projects (name, kind, client_id, color)
select v.n, p.kind, 'tkp2-x', p.color
  from (values ('Tkp project one'), ('Tkp project two')) v(n)
 cross join (select kind, color from tk_projects where client_id is not null order by created_at limit 1) p;
insert into t_ctx select 'p1', id::text from tk_projects where name = 'Tkp project one';
insert into t_ctx select 'p2', id::text from tk_projects where name = 'Tkp project two';
select set_config('mgb.tk_project_trash', 'on', true);
update tk_projects set trashed_at = now() where id = pg_temp.id('p2');
select set_config('mgb.tk_project_trash', '', true);
select pg_temp.ok((select trashed_at is not null from tk_projects where id = pg_temp.id('p2')), 'setup: P2 trashed');

-- SOPs on X and Y
insert into client_sops (client_id, section, title, body, sort, version)
values ('tkp2-x', 'Close', 'Tkp X sop', 'body', 0, 1), ('tkp2-y', 'Close', 'Tkp Y sop', 'body', 0, 1);
insert into t_ctx select 'sopx', id::text from client_sops where client_id = 'tkp2-x' and title = 'Tkp X sop';
insert into t_ctx select 'sopy', id::text from client_sops where client_id = 'tkp2-y' and title = 'Tkp Y sop';

-- Search tasks
select pg_temp.mk('zebra',   'tkp2-a@mygoodbooks.org', 'tkp2-a@mygoodbooks.org', 'Zebra reconcile',  null,     'private', null, null);
select pg_temp.mk('bank',    'tkp2-a@mygoodbooks.org', 'tkp2-a@mygoodbooks.org', 'Bank Reconcile',   null,     'private', null, null);
select pg_temp.mk('walrus',  'tkp2-c@mygoodbooks.org', 'tkp2-c@mygoodbooks.org', 'Walrus ledger review', 'tkp2-x', 'shared', null, null);
select pg_temp.mk('monthly', 'tkp2-c@mygoodbooks.org', 'tkp2-c@mygoodbooks.org', 'Monthly close',    'tkp2-x', 'shared',  null, null);
select pg_temp.mk('bx',      'tkp2-b@mygoodbooks.org', 'tkp2-b@mygoodbooks.org', 'Beta checklist',   'tkp2-x', 'shared',  null, null);
select pg_temp.mk('qhost',   'tkp2-a@mygoodbooks.org', 'tkp2-a@mygoodbooks.org', 'Alpha private host', null,   'private', null, null);
select pg_temp.mk('narwhal', 'tkp2-c@mygoodbooks.org', 'tkp2-c@mygoodbooks.org', 'Narwhal internal', pg_temp.int_client(), 'shared',  null, null);
select pg_temp.mk('ocelot',  'tkp2-a@mygoodbooks.org', 'tkp2-a@mygoodbooks.org', 'Ocelot gone',      null,     'private', null, null);
update staff_reminders set deleted_at = now() where id = pg_temp.id('ocelot');
select pg_temp.ok((select deleted_at is not null from staff_reminders where id = pg_temp.id('ocelot')), 'setup: Ocelot deleted');
select pg_temp.mk('yak' || g, 'tkp2-a@mygoodbooks.org', 'tkp2-a@mygoodbooks.org', 'Yak shave ' || g, null, 'private', null, null)
  from generate_series(1, 27) g;
-- comment with "quokka" on A's private task (author stamped from the JWT)
select pg_temp.as_user('tkp2-a@mygoodbooks.org');
insert into tk_comments (task_id, body) values (pg_temp.id('qhost'), 'note about the quokka invoice');
select pg_temp.as_user(null);

-- Workload tasks (Monday of this week, America/Chicago)
insert into t_ctx values ('ws', date_trunc('week', (now() at time zone 'America/Chicago')::date)::date::text);
create or replace function pg_temp.ws() returns date language sql as $$ select v::date from t_ctx where k = 'ws' $$;
select pg_temp.mk('w0',    'tkp2-a@mygoodbooks.org', 'tkp2-a@mygoodbooks.org', 'Wk zero',   'tkp2-y',     'shared',  null, pg_temp.ws() + 1);
select pg_temp.mk('w1',    'tkp2-a@mygoodbooks.org', 'tkp2-a@mygoodbooks.org', 'Wk one',    null,     'private', null, pg_temp.ws() + 8);
select pg_temp.mk('w3',    'tkp2-a@mygoodbooks.org', 'tkp2-a@mygoodbooks.org', 'Wk three',  'tkp2-x', 'shared',  null, pg_temp.ws() + 22);
select pg_temp.mk('wfar',  'tkp2-a@mygoodbooks.org', 'tkp2-a@mygoodbooks.org', 'Wk far',    'tkp2-y',     'shared',  null, pg_temp.ws() + 40);
select pg_temp.mk('wwait', 'tkp2-a@mygoodbooks.org', 'tkp2-a@mygoodbooks.org', 'Wk wait',   'tkp2-y',     'shared',  'waiting_client', pg_temp.ws() + 1);
select pg_temp.mk('wdone', 'tkp2-a@mygoodbooks.org', 'tkp2-a@mygoodbooks.org', 'Wk done',   'tkp2-y',     'shared',  null, pg_temp.ws() + 1);
update staff_reminders set done = true, status = 'done' where id = pg_temp.id('wdone');
select pg_temp.mk('wdel',  'tkp2-a@mygoodbooks.org', 'tkp2-a@mygoodbooks.org', 'Wk deleted', 'tkp2-y',    'shared',  null, pg_temp.ws() + 1);
update staff_reminders set deleted_at = now() where id = pg_temp.id('wdel');
select pg_temp.mk('wtest', 'tkp2-a@mygoodbooks.org', 'tkp2-a@mygoodbooks.org', 'Wk test client', 'tkp2-t', 'shared', null, pg_temp.ws() + 1);
select pg_temp.mk('wint',  'tkp2-a@mygoodbooks.org', 'tkp2-a@mygoodbooks.org', 'Wk internal', pg_temp.int_client(), 'shared', null, pg_temp.ws() + 1);
select pg_temp.mk('bpriv', 'tkp2-b@mygoodbooks.org', 'tkp2-b@mygoodbooks.org', 'Wk B private', null,   'private', null, pg_temp.ws() + 1);
select pg_temp.mk('bshr',  'tkp2-b@mygoodbooks.org', 'tkp2-b@mygoodbooks.org', 'Wk B shared',  'tkp2-y',   'shared',  null, pg_temp.ws() + 2);
select pg_temp.mk('u1',    'tkp2-c@mygoodbooks.org', null, 'Wk unassigned on X', 'tkp2-x', 'shared',  null, pg_temp.ws() + 1);
select pg_temp.mk('u2',    'tkp2-c@mygoodbooks.org', null, 'Wk unassigned private', null,  'private', null, pg_temp.ws() + 1);
select pg_temp.mk('u3',    'tkp2-c@mygoodbooks.org', null, 'Wk unassigned waiting', 'tkp2-x', 'shared', 'waiting_client', pg_temp.ws() + 1);
select pg_temp.ok((select count(*) = 3 from staff_reminders where id in (pg_temp.id('u1'), pg_temp.id('u2'), pg_temp.id('u3'))
                     and assignee_email is null), 'setup: three unassigned tasks');

-- ---------------------------------------------------------------------
-- 1. Shape
-- ---------------------------------------------------------------------
do $$
begin
  perform pg_temp.ok((select bool_and(c.relrowsecurity) from pg_class c
                       where c.oid in ('public.tk_staff_profile_prefs'::regclass, 'public.tk_staff_teams'::regclass,
                                       'public.tk_staff_team_members'::regclass)), 'RLS on for all three tables');
  perform pg_temp.ok((select count(*) = 4 from pg_policies where schemaname = 'public' and tablename = 'tk_staff_profile_prefs'),
                     'profile prefs has exactly 4 policies');
  perform pg_temp.ok((select count(*) = 4 from pg_policies where schemaname = 'public' and tablename = 'tk_staff_teams')
                 and (select count(*) = 3 from pg_policies where schemaname = 'public' and tablename = 'tk_staff_team_members'),
                     'teams 4 policies, members 3 (no update)');
  perform pg_temp.ok(not exists (select 1 from information_schema.role_table_grants
                                  where table_schema = 'public' and grantee in ('anon', 'PUBLIC')
                                    and table_name in ('tk_staff_profile_prefs', 'tk_staff_teams', 'tk_staff_team_members')),
                     'anon has no table privilege');
  perform pg_temp.ok(not exists (select 1 from information_schema.role_table_grants
                                  where table_schema = 'public' and grantee = 'authenticated'
                                    and table_name in ('tk_staff_profile_prefs', 'tk_staff_teams', 'tk_staff_team_members')
                                    and privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER')),
                     'authenticated has no truncate/references/trigger');
  perform pg_temp.ok(not has_table_privilege('authenticated', 'public.tk_staff_team_members', 'UPDATE'),
                     'authenticated cannot update team members');
  perform pg_temp.ok((select bool_and(p.prosecdef and p.provolatile = 's'
                                      and p.proconfig @> array['search_path=public']
                                      and not has_function_privilege('anon', p.oid, 'EXECUTE')
                                      and has_function_privilege('authenticated', p.oid, 'EXECUTE'))
                        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                       where n.nspname = 'public'
                         and p.proname in ('tk_profile_card', 'tk_search_prefix', 'tk_slateplus_workload_weeks'))
                 and (select count(*) = 3 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                       where n.nspname = 'public'
                         and p.proname in ('tk_profile_card', 'tk_search_prefix', 'tk_slateplus_workload_weeks')),
                     'three RPCs: definer, stable, search_path=public, anon no execute, authenticated execute');
  perform pg_temp.ok((select bool_and(not p.prosecdef and p.proconfig @> array['search_path=public'])
                        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                       where n.nspname = 'public'
                         and p.proname in ('tk_staff_profile_prefs_guard', 'tk_staff_teams_guard', 'tk_staff_team_members_guard')),
                     'trigger functions are invoker with search_path=public');
  -- 11. result shape of the search RPC
  perform pg_temp.ok((select array_agg(a.n order by a.o) from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
                             unnest(p.proargnames, p.proargmodes) with ordinality a(n, m, o)
                       where n.nspname = 'public' and p.proname = 'tk_search_prefix' and a.m = 't')
                     = array['task_id','task_text','kind','client_id','project_id','status','due_date','done','match','snippet','rank'],
                     'tk_search_prefix output columns are exactly the documented list');
end $$;

-- ---------------------------------------------------------------------
-- 2-5, 14. Profile prefs RLS and validation
-- ---------------------------------------------------------------------
do $$
declare v record; n int;
begin
  -- 2. A inserts with owner B -> stored as A
  perform pg_temp.as_user('tkp2-a@mygoodbooks.org');
  set local role authenticated;
  insert into tk_staff_profile_prefs (owner_email, status_line, share)
  values ('tkp2-b@mygoodbooks.org', '  Working on close  ', '{"focus":true,"bogus":true}');
  reset role;
  select * into v from tk_staff_profile_prefs where owner_email = 'tkp2-a@mygoodbooks.org';
  perform pg_temp.ok(found and not exists (select 1 from tk_staff_profile_prefs where owner_email = 'tkp2-b@mygoodbooks.org'),
                     'A insert with owner B is stored as A');
  perform pg_temp.ok(v.status_line = 'Working on close' and v.status_set_at is not null, 'status trimmed, status_set_at stamped');
  perform pg_temp.ok(v.share = '{"status":true,"about":true,"focus":true,"pins":false,"favorites":false,"time":true}'::jsonb,
                     'share: given key kept, missing keys default, unknown key dropped');

  -- 3. B inserts own row; A sees only own; A cannot update/delete B
  perform pg_temp.as_user('tkp2-b@mygoodbooks.org');
  set local role authenticated;
  insert into tk_staff_profile_prefs (owner_email, status_line, bio, skills, working_hours, focus_quarter, focus_goals,
                                      pinned_client_ids, pinned_project_ids, favorites, section_order, hidden_sections)
  values ('tkp2-b@mygoodbooks.org', 'Heads down on audits', 'I like reconciliations', array['Payroll', ' payroll ', 'Grants', ''],
          'Mon-Thu 8-4', '2026-Q4', '[{"text":"Ship close","done":false,"x":1},{"text":"Train Echo"}]',
          array['tkp2-x', 'tkp2-y', 'tkp2-x'], array[pg_temp.id('p1'), pg_temp.id('p2'), pg_temp.id('p1')],
          jsonb_build_array(jsonb_build_object('kind', 'sop', 'sop_id', pg_temp.ctx('sopy'), 'client_id', 'tkp2-y', 'label', 'Y close'),
                            jsonb_build_object('kind', 'sop', 'sop_id', pg_temp.ctx('sopx'), 'client_id', 'tkp2-x', 'label', 'X close'),
                            jsonb_build_object('kind', 'link', 'url', 'https://example.org/guide', 'label', 'Guide')),
          array['header','tasks','focus','tasks'], array['about','about']);
  reset role;
  select * into v from tk_staff_profile_prefs where owner_email = 'tkp2-b@mygoodbooks.org';
  perform pg_temp.ok(v.skills = array['Payroll','Grants'], 'skills trimmed, blanks dropped, de-duplicated any case');
  perform pg_temp.ok(v.focus_goals = '[{"text":"Ship close","done":false},{"text":"Train Echo","done":false}]'::jsonb,
                     'goals: extra keys dropped, done defaults false');
  perform pg_temp.ok(v.pinned_client_ids = array['tkp2-x','tkp2-y'] and v.pinned_project_ids = array[pg_temp.id('p1'), pg_temp.id('p2')],
                     'pins de-duplicated in order');
  perform pg_temp.ok(v.section_order = array['header','tasks','focus'] and v.hidden_sections = array['about'],
                     'section keys de-duplicated');

  perform pg_temp.as_user('tkp2-a@mygoodbooks.org');
  set local role authenticated;
  select count(*) into n from tk_staff_profile_prefs;
  perform pg_temp.ok(n = 1 and (select owner_email from tk_staff_profile_prefs) = 'tkp2-a@mygoodbooks.org', 'A selects only own row');
  perform pg_temp.ok(pg_temp.rows($q$update tk_staff_profile_prefs set bio = 'hacked' where owner_email = 'tkp2-b@mygoodbooks.org'$q$) = 0,
                     'A update of B touches 0 rows');
  perform pg_temp.ok(pg_temp.rows($q$delete from tk_staff_profile_prefs where owner_email = 'tkp2-b@mygoodbooks.org'$q$) = 0,
                     'A delete of B touches 0 rows');
  -- owner and created_at frozen on update
  update tk_staff_profile_prefs set owner_email = 'tkp2-b@mygoodbooks.org', created_at = now() - interval '9 days', bio = 'Hi';
  reset role;
  perform pg_temp.ok((select count(*) = 1 from tk_staff_profile_prefs where owner_email = 'tkp2-a@mygoodbooks.org' and bio = 'Hi'
                         and created_at > now() - interval '1 hour'), 'update cannot move the row or change created_at');
  perform pg_temp.ok((select bio from tk_staff_profile_prefs where owner_email = 'tkp2-b@mygoodbooks.org') = 'I like reconciliations',
                     'B row untouched');

  -- 4. admin C: own only, no override
  perform pg_temp.as_user('tkp2-c@mygoodbooks.org');
  set local role authenticated;
  insert into tk_staff_profile_prefs (owner_email) values ('tkp2-c@mygoodbooks.org');
  perform pg_temp.ok((select count(*) = 1 and bool_and(owner_email = 'tkp2-c@mygoodbooks.org') from tk_staff_profile_prefs),
                     'admin C selects only own row');
  perform pg_temp.ok(pg_temp.rows($q$update tk_staff_profile_prefs set bio = 'x' where owner_email = 'tkp2-b@mygoodbooks.org'$q$) = 0,
                     'admin C update of B touches 0 rows');
  reset role;

  -- 5. validation (as A on own row) -> 22023
  perform pg_temp.as_user('tkp2-a@mygoodbooks.org');
  set local role authenticated;
  perform pg_temp.expect_state($q$update tk_staff_profile_prefs set status_line = repeat('s', 141)$q$, '22023', 'status 141 chars');
  perform pg_temp.expect_state($q$update tk_staff_profile_prefs set focus_goals = '[{"text":"a"},{"text":"b"},{"text":"c"},{"text":"d"}]'$q$,
                               '22023', '4 goals');
  perform pg_temp.expect_state($q$update tk_staff_profile_prefs set focus_goals = '[{"text":"   "}]'$q$, '22023', 'empty goal');
  perform pg_temp.expect_state($q$update tk_staff_profile_prefs set skills = (select array_agg('s' || g) from generate_series(1, 13) g)$q$,
                               '22023', '13 skills');
  perform pg_temp.expect_state($q$update tk_staff_profile_prefs set skills = array[repeat('k', 41)]$q$, '22023', 'skill 41 chars');
  perform pg_temp.expect_state($q$update tk_staff_profile_prefs set favorites = '[{"kind":"link","url":"javascript:alert(1)","label":"x"}]'$q$,
                               '22023', 'javascript: link');
  perform pg_temp.expect_state($q$update tk_staff_profile_prefs set favorites = '[{"kind":"link","url":"http://example.org","label":"x"}]'$q$,
                               '22023', 'http:// link');
  perform pg_temp.expect_state($q$update tk_staff_profile_prefs set favorites = '[{"kind":"link","url":"https://a.org/<script>","label":"x"}]'$q$,
                               '22023', 'link with <');
  perform pg_temp.expect_state($q$update tk_staff_profile_prefs set favorites = '[{"kind":"sop","sop_id":"nope","client_id":"tkp2-x","label":"x"}]'$q$,
                               '22023', 'sop favorite with a bad id');
  perform pg_temp.expect_state($q$update tk_staff_profile_prefs set favorites = '[{"kind":"link","url":"https://a.org","label":""}]'$q$,
                               '22023', 'favorite without a label');
  perform pg_temp.expect_state($q$update tk_staff_profile_prefs set favorites = (select jsonb_agg(jsonb_build_object('kind','link','url','https://a.org/' || g,'label','l')) from generate_series(1, 21) g)$q$,
                               '22023', '21 favorites');
  perform pg_temp.expect_state($q$update tk_staff_profile_prefs set section_order = array['header','bogus']$q$, '22023', 'unknown section key');
  perform pg_temp.expect_state($q$update tk_staff_profile_prefs set hidden_sections = array['tasks']$q$, '22023', 'hiding tasks');
  perform pg_temp.expect_state($q$update tk_staff_profile_prefs set hidden_sections = array['header']$q$, '22023', 'hiding header');
  perform pg_temp.expect_state($q$update tk_staff_profile_prefs set focus_quarter = '2026-Q5'$q$, '22023', 'bad quarter');
  perform pg_temp.expect_state($q$update tk_staff_profile_prefs set bio = repeat('b', 601)$q$, '22023', 'bio 601 chars');
  perform pg_temp.expect_state($q$update tk_staff_profile_prefs set share = '{"pins":"yes"}'$q$, '22023', 'share value not boolean');
  -- 14. time zones
  perform pg_temp.expect_state($q$update tk_staff_profile_prefs set time_zone = 'CST'$q$, '22023', 'time zone CST');
  perform pg_temp.expect_state($q$update tk_staff_profile_prefs set time_zone = 'EST'$q$, '22023', 'time zone EST');
  perform pg_temp.expect_state($q$update tk_staff_profile_prefs set time_zone = '+05:00'$q$, '22023', 'time zone +05:00');
  perform pg_temp.expect_state($q$update tk_staff_profile_prefs set time_zone = 'Etc/GMT+5'$q$, '22023', 'time zone Etc/GMT+5');
  perform pg_temp.expect_state($q$update tk_staff_profile_prefs set time_zone = 'Mars/Base'$q$, '22023', 'time zone Mars/Base');
  update tk_staff_profile_prefs set time_zone = 'America/Phoenix';
  update tk_staff_profile_prefs set time_zone = 'America/Chicago', status_line = '   ';
  reset role;
  select * into v from tk_staff_profile_prefs where owner_email = 'tkp2-a@mygoodbooks.org';
  perform pg_temp.ok(v.time_zone = 'America/Chicago', 'America/Phoenix and America/Chicago accepted');
  perform pg_temp.ok(v.status_line is null and v.status_set_at is null, 'blank status clears status and status_set_at');
end $$;

-- ---------------------------------------------------------------------
-- 6-9, 13, 14. tk_profile_card
-- ---------------------------------------------------------------------
do $$
declare j jsonb;
begin
  -- 6. default share: status + about present; focus, pins, favorites null
  perform pg_temp.as_user('tkp2-a@mygoodbooks.org');
  set local role authenticated;
  j := public.tk_profile_card('  tkp2-B@mygoodbooks.org ');
  reset role;
  perform pg_temp.ok(j ->> 'email' = 'tkp2-b@mygoodbooks.org' and (j ->> 'is_self')::boolean = false, 'card for B as A');
  perform pg_temp.ok(j ->> 'status_line' = 'Heads down on audits' and j ->> 'bio' = 'I like reconciliations'
                     and j -> 'skills' = '["Payroll","Grants"]'::jsonb and j ->> 'working_hours' = 'Mon-Thu 8-4',
                     'status and about shown by default');
  perform pg_temp.ok(jsonb_typeof(j -> 'focus_goals') = 'null' and jsonb_typeof(j -> 'focus_quarter') = 'null'
                     and jsonb_typeof(j -> 'pinned_client_ids') = 'null' and jsonb_typeof(j -> 'pinned_project_ids') = 'null'
                     and jsonb_typeof(j -> 'favorites') = 'null', 'focus, pins, favorites null by default');
  perform pg_temp.ok(j -> 'section_order' = '["header","tasks","focus"]'::jsonb and j -> 'hidden_sections' = '["about"]'::jsonb,
                     'layout always returned');
  perform pg_temp.ok(not exists (select 1 from jsonb_object_keys(j) k where k like 'default%' or k in ('share', 'has_row', 'updated_at')),
                     'no default_*, share or private bookkeeping keys for others');
  -- 14. no time zone set for B -> nothing filled in
  perform pg_temp.ok(jsonb_typeof(j -> 'time_zone') = 'null', 'B unset zone -> no time_zone on the card');
  -- 13. org: B reports to C; no HR columns beyond the relation
  perform pg_temp.ok(j #>> '{org,manager,email}' = 'tkp2-c@mygoodbooks.org' and j #>> '{org,manager,name}' = 'Tkp Charlie'
                     and j #> '{org,reports}' = '[]'::jsonb, 'org: B manager is C, no reports');
  perform pg_temp.ok(position('Secret Legal' in j::text) = 0 and position('555-0100' in j::text) = 0
                     and position('Hidden St' in j::text) = 0 and position('private note' in j::text) = 0
                     and not exists (select 1 from jsonb_object_keys(j) k
                                      where k ~ '(legal_name|personal_|address|emergency_|notes|schedule|work_location|end_date|hire_date)'),
                     'card carries no other HR column');

  -- 7/8. B shares pins, favorites and focus
  perform pg_temp.as_user('tkp2-b@mygoodbooks.org');
  set local role authenticated;
  update tk_staff_profile_prefs set share = share || '{"pins":true,"favorites":true,"focus":true}', time_zone = 'America/Phoenix';
  reset role;
  perform pg_temp.as_user('tkp2-a@mygoodbooks.org');
  set local role authenticated;
  j := public.tk_profile_card('tkp2-b@mygoodbooks.org');
  reset role;
  perform pg_temp.ok(j -> 'pinned_client_ids' = '["tkp2-x"]'::jsonb, 'A sees pinned client X only (no access to Y)');
  perform pg_temp.ok(j -> 'pinned_project_ids' = jsonb_build_array(pg_temp.ctx('p1')), 'A sees P1, never trashed P2');
  perform pg_temp.ok(jsonb_array_length(j -> 'favorites') = 2
                     and not exists (select 1 from jsonb_array_elements(j -> 'favorites') f where f ->> 'sop_id' = pg_temp.ctx('sopy'))
                     and exists (select 1 from jsonb_array_elements(j -> 'favorites') f where f ->> 'sop_id' = pg_temp.ctx('sopx'))
                     and exists (select 1 from jsonb_array_elements(j -> 'favorites') f where f ->> 'kind' = 'link'),
                     'A: SOP on Y dropped, SOP on X and link kept');
  perform pg_temp.ok(j -> 'focus_goals' is not null and j ->> 'focus_quarter' = '2026-Q4', 'focus shown once shared');
  perform pg_temp.ok(j ->> 'time_zone' = 'America/Phoenix', 'zone shown when share.time is on');

  perform pg_temp.as_user('tkp2-c@mygoodbooks.org');
  set local role authenticated;
  j := public.tk_profile_card('tkp2-b@mygoodbooks.org');
  reset role;
  perform pg_temp.ok(j -> 'pinned_client_ids' = '["tkp2-x","tkp2-y"]'::jsonb, 'admin C sees pinned X and Y');
  perform pg_temp.ok(j -> 'pinned_project_ids' = jsonb_build_array(pg_temp.ctx('p1')), 'admin C never sees trashed P2');
  perform pg_temp.ok(jsonb_array_length(j -> 'favorites') = 3, 'admin C sees all three favorites');

  -- 14. share.time off -> no zone for others
  perform pg_temp.as_user('tkp2-b@mygoodbooks.org');
  set local role authenticated;
  update tk_staff_profile_prefs set share = share || '{"time":false}';
  j := public.tk_profile_card('tkp2-b@mygoodbooks.org');
  reset role;
  perform pg_temp.ok((j ->> 'is_self')::boolean and j ->> 'time_zone' = 'America/Phoenix' and j -> 'share' ->> 'time' = 'false'
                     and j -> 'pinned_project_ids' = jsonb_build_array(pg_temp.ctx('p1'), pg_temp.ctx('p2')),
                     'self card returns the whole own row');
  perform pg_temp.as_user('tkp2-a@mygoodbooks.org');
  set local role authenticated;
  j := public.tk_profile_card('tkp2-b@mygoodbooks.org');
  reset role;
  perform pg_temp.ok(jsonb_typeof(j -> 'time_zone') = 'null', 'share.time off -> A sees no time_zone');

  -- 13. org for C and A
  perform pg_temp.as_user('tkp2-a@mygoodbooks.org');
  set local role authenticated;
  j := public.tk_profile_card('tkp2-c@mygoodbooks.org');
  perform pg_temp.ok(j #> '{org,reports}' = '[{"email":"tkp2-b@mygoodbooks.org","name":"Tkp Bravo"}]'::jsonb,
                     'C reports: only B (ended E and inactive Z never appear)');
  perform pg_temp.ok(jsonb_typeof(j #> '{org,manager}') = 'null', 'C has no manager');
  j := public.tk_profile_card('tkp2-a@mygoodbooks.org');
  perform pg_temp.ok((j ->> 'is_self')::boolean and jsonb_typeof(j #> '{org,manager}') = 'null',
                     'A manager is ended E -> no manager shown');
  perform pg_temp.expect_state($q$select count(*) from staff_hr_records$q$, '42501', 'A still cannot read staff_hr_records directly');
  -- 9. unknown and inactive targets
  perform pg_temp.ok(public.tk_profile_card('nobody@example.invalid') is null, 'unknown target -> null');
  perform pg_temp.ok(public.tk_profile_card('tkp2-z@mygoodbooks.org') is null, 'inactive target -> null');
  perform pg_temp.ok(public.tk_profile_card(null) is null, 'null target -> null');
  reset role;
end $$;

-- ---------------------------------------------------------------------
-- 9. Client login K and anon
-- ---------------------------------------------------------------------
do $$
declare n int;
begin
  perform pg_temp.as_user('tkp2-k@example.invalid');
  set local role authenticated;
  perform pg_temp.ok((select count(*) from tk_staff_profile_prefs) = 0, 'K: profile prefs select 0 rows');
  perform pg_temp.expect_state($q$insert into tk_staff_profile_prefs (owner_email) values ('tkp2-k@example.invalid')$q$, '42501',
                               'K: insert refused by RLS');
  perform pg_temp.ok(public.tk_profile_card('tkp2-b@mygoodbooks.org') is null, 'K: profile card null');
  perform pg_temp.ok((select count(*) from public.tk_search_prefix('zebra', 25)) = 0, 'K: search no rows');
  perform pg_temp.expect_state($q$select * from public.tk_slateplus_workload_weeks()$q$, '42501', 'K: workload weeks refused');
  perform pg_temp.ok((select count(*) from tk_staff_teams) = 0 and (select count(*) from tk_staff_team_members) = 0,
                     'K: teams read nothing');
  perform pg_temp.expect_state($q$insert into tk_staff_teams (name) values ('K team')$q$, '42501', 'K: team insert refused');
  reset role;

  perform pg_temp.as_user(null);
  set local role anon;
  perform pg_temp.expect_state($q$select count(*) from tk_staff_profile_prefs$q$, '42501', 'anon: prefs permission denied');
  perform pg_temp.expect_state($q$select count(*) from tk_staff_teams$q$, '42501', 'anon: teams permission denied');
  perform pg_temp.expect_state($q$select count(*) from tk_staff_team_members$q$, '42501', 'anon: members permission denied');
  perform pg_temp.expect_state($q$select public.tk_profile_card('tkp2-b@mygoodbooks.org')$q$, '42501', 'anon: card permission denied');
  perform pg_temp.expect_state($q$select * from public.tk_search_prefix('zebra', 5)$q$, '42501', 'anon: search permission denied');
  perform pg_temp.expect_state($q$select * from public.tk_slateplus_workload_weeks()$q$, '42501', 'anon: workload weeks permission denied');
  reset role;
end $$;

-- ---------------------------------------------------------------------
-- 10. tk_search_prefix
-- ---------------------------------------------------------------------
do $$
declare n int; v record;
begin
  perform pg_temp.as_user('tkp2-b@mygoodbooks.org');
  set local role authenticated;
  perform pg_temp.ok(not exists (select 1 from public.tk_search_prefix('zeb', 25) s where s.task_id = pg_temp.id('zebra')),
                     'B: no hit on A private task');
  perform pg_temp.ok(not exists (select 1 from public.tk_search_prefix('walrus', 25)), 'B: no hit on shared task on X (no access)');
  perform pg_temp.ok(not exists (select 1 from public.tk_search_prefix('pelic', 25)), 'B: client-name hit on X not shown (even own task)');
  perform pg_temp.ok(not exists (select 1 from public.tk_search_prefix('quokka', 25)), 'B: comment on unreadable task not shown');
  perform pg_temp.ok(exists (select 1 from public.tk_search_prefix('beta', 25) s where s.task_id = pg_temp.id('bx') and s.match = 'title'),
                     'B: own task by title');
  reset role;

  perform pg_temp.as_user('tkp2-a@mygoodbooks.org');
  set local role authenticated;
  select * into v from public.tk_search_prefix('zeb', 25) s where s.task_id = pg_temp.id('zebra');
  perform pg_temp.ok(found and v.match = 'title' and v.rank = 1 and v.kind = 'task', 'A: own private task hit by title');
  perform pg_temp.ok(exists (select 1 from public.tk_search_prefix('walrus', 25) s where s.task_id = pg_temp.id('walrus')),
                     'A: shared task on X hit');
  select * into v from public.tk_search_prefix('pelic', 25) s where s.task_id = pg_temp.id('monthly');
  perform pg_temp.ok(found and v.match = 'client' and v.rank = 2, 'A: client-name hit on X');
  perform pg_temp.ok(exists (select 1 from public.tk_search_prefix('pelic', 25) s where s.task_id = pg_temp.id('bx')),
                     'A: B''s shared task on X found by client name (A has access)');
  select * into v from public.tk_search_prefix('quokka', 25) s where s.task_id = pg_temp.id('qhost');
  perform pg_temp.ok(found and v.match = 'comment' and v.rank = 4 and v.snippet like '%quokka%', 'A: comment hit on own task');
  perform pg_temp.ok(not exists (select 1 from public.tk_search_prefix('narwhal', 25)), 'A: internal client task hidden (no internal access)');
  perform pg_temp.ok(not exists (select 1 from public.tk_search_prefix('ocelot', 25)), 'A: deleted task never found');
  perform pg_temp.ok(exists (select 1 from public.tk_search_prefix('recon', 25) s where s.task_id = pg_temp.id('bank'))
                 and exists (select 1 from public.tk_search_prefix('RECON', 25) s where s.task_id = pg_temp.id('zebra')),
                     'prefix rule: recon hits Bank Reconcile, any case');
  perform pg_temp.ok(not exists (select 1 from public.tk_search_prefix('concile', 25)), 'prefix rule: concile does not hit');
  perform pg_temp.ok(exists (select 1 from public.tk_search_prefix('bank rec', 25) s where s.task_id = pg_temp.id('bank'))
                 and not exists (select 1 from public.tk_search_prefix('bank zebra', 25)), 'terms are AND');
  perform pg_temp.ok((select count(*) from public.tk_search_prefix('%', 25)) = 0
                 and (select count(*) from public.tk_search_prefix('_', 25)) = 0
                 and (select count(*) from public.tk_search_prefix('a', 25)) = 0
                 and (select count(*) from public.tk_search_prefix('', 25)) = 0
                 and (select count(*) from public.tk_search_prefix(null, 25)) = 0
                 and (select count(*) from public.tk_search_prefix(repeat('y', 201), 25)) = 0,
                     'wildcards, one char, empty, null and 201 chars -> zero rows, no error');
  perform pg_temp.ok((select count(*) from public.tk_search_prefix('yak', 0)) = 1, 'p_limit 0 -> 1 row');
  perform pg_temp.ok((select count(*) from public.tk_search_prefix('yak', 999)) = 25, 'p_limit 999 -> 25 rows');
  perform pg_temp.ok((select count(*) from public.tk_search_prefix('yak')) = 12, 'default limit 12');
  reset role;

  perform pg_temp.as_user('tkp2-c@mygoodbooks.org');
  set local role authenticated;
  perform pg_temp.ok(exists (select 1 from public.tk_search_prefix('narwhal', 25) s where s.task_id = pg_temp.id('narwhal')),
                     'C (internal access): internal client task found');
  perform pg_temp.ok(not exists (select 1 from public.tk_search_prefix('ocelot gone', 25) s where s.task_id = pg_temp.id('ocelot')),
                     'C: deleted task never found');
  reset role;
end $$;

-- ---------------------------------------------------------------------
-- 12. Teams
-- ---------------------------------------------------------------------
do $$
declare v_team uuid; n int;
begin
  -- A (non-admin) cannot write
  perform pg_temp.as_user('tkp2-a@mygoodbooks.org');
  set local role authenticated;
  perform pg_temp.expect_state($q$insert into tk_staff_teams (name) values ('A team')$q$, '42501', 'A: team insert refused');
  reset role;

  -- C (admin) can
  perform pg_temp.as_user('tkp2-c@mygoodbooks.org');
  set local role authenticated;
  insert into tk_staff_teams (name, description, color, created_by) values ('  Close   crew ', ' Month end ', 'sage', 'someone@else')
  returning id into v_team;
  insert into tk_staff_team_members (team_id, staff_email, added_by) values (v_team, ' tkp2-B@mygoodbooks.org ', 'someone@else');
  insert into tk_staff_team_members (team_id, staff_email) values (v_team, 'tkp2-a@mygoodbooks.org');
  perform pg_temp.expect_state(format($q$insert into tk_staff_team_members (team_id, staff_email) values (%L, 'tkp2-z@mygoodbooks.org')$q$, v_team),
                               '22023', 'inactive member refused');
  perform pg_temp.expect_state(format($q$insert into tk_staff_team_members (team_id, staff_email) values (%L, 'nobody@example.invalid')$q$, v_team),
                               '22023', 'unknown member refused');
  perform pg_temp.expect_state($q$insert into tk_staff_teams (name) values ('CLOSE CREW')$q$, '23505', 'duplicate team name (any case)');
  perform pg_temp.expect_state($q$insert into tk_staff_teams (name, color) values ('Painted', 'red; x')$q$, '23514', 'color outside the palette');
  update tk_staff_teams set name = 'Close crew', created_by = 'x@y' where id = v_team;
  reset role;
  perform pg_temp.ok((select name = 'Close crew' and description = 'Month end' and created_by = 'tkp2-c@mygoodbooks.org'
                       from tk_staff_teams where id = v_team), 'team trimmed, created_by stamped from JWT and frozen');
  perform pg_temp.ok((select count(*) = 2 and bool_and(added_by = 'tkp2-c@mygoodbooks.org')
                       from tk_staff_team_members where team_id = v_team)
                 and exists (select 1 from tk_staff_team_members where team_id = v_team and staff_email = 'tkp2-b@mygoodbooks.org'),
                     'members lowercased, added_by stamped');
  insert into t_ctx values ('team', v_team::text);

  -- A and B read both; A update/delete touch nothing
  perform pg_temp.as_user('tkp2-a@mygoodbooks.org');
  set local role authenticated;
  perform pg_temp.ok((select count(*) from tk_staff_teams where id = v_team) = 1
                 and (select count(*) from tk_staff_team_members where team_id = v_team) = 2, 'A reads team and members');
  perform pg_temp.ok(pg_temp.rows(format($q$update tk_staff_teams set name = 'Hijack' where id = %L$q$, v_team)) = 0,
                     'A team update touches 0 rows');
  perform pg_temp.ok(pg_temp.rows(format($q$delete from tk_staff_teams where id = %L$q$, v_team)) = 0, 'A team delete touches 0 rows');
  perform pg_temp.ok(pg_temp.rows(format($q$delete from tk_staff_team_members where team_id = %L$q$, v_team)) = 0,
                     'A member delete touches 0 rows');
  perform pg_temp.expect_state(format($q$insert into tk_staff_team_members (team_id, staff_email) values (%L, 'tkp2-e@mygoodbooks.org')$q$, v_team),
                               '42501', 'A member insert refused');
  perform pg_temp.expect_state(format($q$update tk_staff_team_members set staff_email = 'tkp2-e@mygoodbooks.org' where team_id = %L$q$, v_team),
                               '42501', 'member update not granted');
  -- teams on the card
  perform pg_temp.ok(public.tk_profile_card('tkp2-b@mygoodbooks.org') -> 'teams'
                     = jsonb_build_array(jsonb_build_object('id', v_team, 'name', 'Close crew', 'color', 'sage')), 'B card lists the team');
  reset role;
  perform pg_temp.as_user('tkp2-b@mygoodbooks.org');
  set local role authenticated;
  perform pg_temp.ok((select count(*) from tk_staff_teams where id = v_team) = 1, 'B reads the team');
  reset role;

  -- archived teams drop off the card; C can delete
  perform pg_temp.as_user('tkp2-c@mygoodbooks.org');
  set local role authenticated;
  update tk_staff_teams set archived_at = now() where id = v_team;
  perform pg_temp.ok(public.tk_profile_card('tkp2-b@mygoodbooks.org') -> 'teams' = '[]'::jsonb, 'archived team not on the card');
  perform pg_temp.ok(pg_temp.rows(format($q$delete from tk_staff_team_members where team_id = %L and staff_email = 'tkp2-a@mygoodbooks.org'$q$, v_team)) = 1,
                     'C removes a member');
  perform pg_temp.ok(pg_temp.rows(format($q$delete from tk_staff_teams where id = %L$q$, v_team)) = 1, 'C deletes the team');
  reset role;
  perform pg_temp.ok(not exists (select 1 from tk_staff_team_members where team_id = v_team), 'members cascade with the team');
end $$;

-- ---------------------------------------------------------------------
-- 15. tk_slateplus_workload_weeks
-- ---------------------------------------------------------------------
do $$
declare v_ws date := pg_temp.ws(); n int; v_open int; v_active int;
begin
  perform pg_temp.ok(extract(isodow from v_ws) = 1, 'week start is a Monday');

  -- A (not admin, not AM): own rows + Unassigned rows only
  perform pg_temp.as_user('tkp2-a@mygoodbooks.org');
  set local role authenticated;
  create temp table t_w on commit drop as select * from public.tk_slateplus_workload_weeks();
  select w.open_count into v_open from public.tk_slateplus_workload() w where w.email = 'tkp2-a@mygoodbooks.org';
  reset role;
  perform pg_temp.ok((select count(*) from t_w) = 10, 'A gets 5 own rows + 5 Unassigned rows');
  perform pg_temp.ok((select count(*) from t_w where not is_unassigned and email = 'tkp2-a@mygoodbooks.org' and is_me) = 5
                 and (select count(*) from t_w where is_unassigned and email is null and staff_id is null and name = 'Unassigned') = 5,
                     'A rows are own (is_me) and Unassigned');
  perform pg_temp.ok((select array_agg(week_start order by week_start) from t_w where not is_unassigned and week_start is not null)
                     = array[v_ws, v_ws + 7, v_ws + 14, v_ws + 21], 'exactly 4 Monday weeks');
  perform pg_temp.ok((select array_agg(due_count order by week_start) from t_w where not is_unassigned and week_start is not null)
                     = array[1, 1, 0, 1], 'A counts: own private counted; waiting, done, deleted, test, internal, far never');
  perform pg_temp.ok((select due_count from t_w where not is_unassigned and week_start is null) = v_open,
                     'A all-dates row = the strip open count');
  perform pg_temp.ok((select array_agg(due_count order by week_start) from t_w where is_unassigned and week_start is not null)
                     = array[1, 0, 0, 0]
                 and (select due_count from t_w where is_unassigned and week_start is null) = 1,
                     'A Unassigned: only the readable shared one on X (not private, not waiting)');
  drop table t_w;

  -- B: own week 0 = shared one only; Unassigned zero (no X access)
  perform pg_temp.as_user('tkp2-b@mygoodbooks.org');
  set local role authenticated;
  create temp table t_w on commit drop as select * from public.tk_slateplus_workload_weeks();
  reset role;
  perform pg_temp.ok((select count(*) from t_w) = 10 and (select due_count from t_w where not is_unassigned and week_start = v_ws) = 2,
                     'B own week 0 counts own private and shared');
  perform pg_temp.ok((select coalesce(sum(due_count), 0) from t_w where is_unassigned) = 0, 'B Unassigned: nothing readable');
  drop table t_w;

  -- C (admin): everyone; B's private task not counted for C
  select count(*) into v_active from staff where active;
  perform pg_temp.as_user('tkp2-c@mygoodbooks.org');
  set local role authenticated;
  create temp table t_w on commit drop as select * from public.tk_slateplus_workload_weeks();
  reset role;
  perform pg_temp.ok((select count(distinct email) from t_w where not is_unassigned) = v_active
                 and (select count(*) from t_w) = v_active * 5 + 5, 'admin C sees every active staff member, 5 rows each');
  perform pg_temp.ok((select count(*) from t_w where is_me) = 5 and (select bool_and(email = 'tkp2-c@mygoodbooks.org') from t_w where is_me),
                     'exactly C is_me');
  perform pg_temp.ok((select due_count from t_w where email = 'tkp2-b@mygoodbooks.org' and week_start = v_ws) = 1,
                     'C: B''s private task never counted');
  perform pg_temp.ok((select due_count from t_w where email = 'tkp2-a@mygoodbooks.org' and week_start = v_ws + 7) = 0,
                     'C: A''s private week-1 task never counted');
  perform pg_temp.ok((select due_count from t_w where is_unassigned and week_start = v_ws)
                     >= 2, 'C Unassigned counts both readable unassigned (shared + private by C), not waiting');
  perform pg_temp.ok(not exists (select 1 from t_w where email like 'tkp2-z%'), 'inactive Z not listed');
  -- Unassigned "open" (all dates) and week 0 = a direct count of the same
  -- rules over the rows tk_row_readable gives C (review: real RPC output).
  select count(*) into n
    from staff_reminders r left join clients c on c.id = r.client_id
   where r.done = false and r.deleted_at is null
     and (coalesce(r.is_unassigned, false) or r.assignee_email is null)
     and coalesce(r.status, 'todo') not in ('done', 'waiting_client')
     and (r.client_id is null or (c.id is not null and coalesce(c.is_internal, false) = false and coalesce(c.test_only, false) = false));
  perform pg_temp.ok((select due_count from t_w where is_unassigned and week_start is null) = n,
                     'C Unassigned open = direct count of open readable unassigned (admin reads all)');
  perform pg_temp.ok((select due_count from t_w where is_unassigned and week_start is null)
                     >= (select coalesce(sum(due_count), 0) from t_w where is_unassigned and week_start is not null),
                     'C Unassigned open >= the 4 dated weeks together');
  perform pg_temp.ok((select due_count from t_w where is_unassigned and week_start = v_ws)
                     = (select count(*) from staff_reminders r left join clients c on c.id = r.client_id
                         where r.done = false and r.deleted_at is null
                           and (coalesce(r.is_unassigned, false) or r.assignee_email is null)
                           and coalesce(r.status, 'todo') not in ('done', 'waiting_client')
                           and (r.client_id is null or (c.id is not null and coalesce(c.is_internal, false) = false and coalesce(c.test_only, false) = false))
                           and r.due_date between v_ws and v_ws + 6),
                     'C Unassigned week 0 = direct count');
  drop table t_w;

  -- A's Unassigned open = direct count over rows tk_row_readable gives A
  perform pg_temp.as_user('tkp2-a@mygoodbooks.org');
  select count(*) into n
    from staff_reminders r left join clients c on c.id = r.client_id
   where r.done = false and r.deleted_at is null
     and (coalesce(r.is_unassigned, false) or r.assignee_email is null)
     and coalesce(r.status, 'todo') not in ('done', 'waiting_client')
     and (r.client_id is null or (c.id is not null and coalesce(c.is_internal, false) = false and coalesce(c.test_only, false) = false))
     and public.tk_row_readable(r.id, r.staff_email, r.assignee_email, r.client_id, r.project_id, r.visibility);
  set local role authenticated;
  perform pg_temp.ok((select w.due_count from public.tk_slateplus_workload_weeks() w where w.is_unassigned and w.week_start is null) = n,
                     'A Unassigned open = direct count of what A can read');
  reset role;

  -- Account manager E (AM of X): everyone's counts, people set identical to
  -- tk_slateplus_workload, B's private task still hidden, Unassigned only
  -- what E can read.
  perform pg_temp.as_user(null);
  update clients set account_manager_email = 'tkp2-e@mygoodbooks.org' where id = 'tkp2-x';
  perform pg_temp.as_user('tkp2-e@mygoodbooks.org');
  set local role authenticated;
  create temp table t_w on commit drop as select * from public.tk_slateplus_workload_weeks();
  perform pg_temp.ok((select array_agg(e order by e) from (select distinct email e from t_w where not is_unassigned) d)
                     = (select array_agg(lower(w.email) order by lower(w.email)) from public.tk_slateplus_workload() w),
                     'AM E: people = exactly tk_slateplus_workload people');
  perform pg_temp.ok((select count(distinct email) from t_w where not is_unassigned) = v_active, 'AM E sees every active staff member');
  perform pg_temp.ok((select due_count from t_w where email = 'tkp2-b@mygoodbooks.org' and week_start = v_ws) = 1,
                     'AM E: B''s private task never counted');
  perform pg_temp.ok((select bool_and(w2.due_count = w.open_count)
                        from t_w w2 join public.tk_slateplus_workload() w on lower(w.email) = w2.email
                       where not w2.is_unassigned and w2.week_start is null),
                     'AM E: every all-dates row = the strip open count');
  reset role;
  select count(*) into n
    from staff_reminders r left join clients c on c.id = r.client_id
   where r.done = false and r.deleted_at is null
     and (coalesce(r.is_unassigned, false) or r.assignee_email is null)
     and coalesce(r.status, 'todo') not in ('done', 'waiting_client')
     and (r.client_id is null or (c.id is not null and coalesce(c.is_internal, false) = false and coalesce(c.test_only, false) = false))
     and public.tk_row_readable(r.id, r.staff_email, r.assignee_email, r.client_id, r.project_id, r.visibility);
  perform pg_temp.ok((select due_count from t_w where is_unassigned and week_start is null) = n,
                     format('AM E: Unassigned open = only what E can read (rpc %s, direct %s)',
                            (select due_count from t_w where is_unassigned and week_start is null), n));
  drop table t_w;
end $$;

-- ---------------------------------------------------------------------
-- 16. Review additions: search on a followed private task, notes snippet
-- only for readable rows, admin cannot read another person's prefs row
-- through the table, and no SECURITY DEFINER helper is left executable by anon.
-- ---------------------------------------------------------------------
do $$
declare v record;
begin
  perform pg_temp.as_user('tkp2-b@mygoodbooks.org');
  set local role authenticated;
  perform pg_temp.ok(not exists (select 1 from public.tk_search_prefix('alpha private host', 25)),
                     'B: A''s private task never found by title words');
  perform pg_temp.ok(not exists (select 1 from public.tk_search_prefix('wk unassigned', 25) s where s.task_id = pg_temp.id('u2')),
                     'B: C''s private unassigned task never found');
  reset role;
  perform pg_temp.as_user('tkp2-c@mygoodbooks.org');
  set local role authenticated;
  perform pg_temp.ok((select count(*) from tk_staff_profile_prefs where owner_email <> 'tkp2-c@mygoodbooks.org') = 0,
                     'admin C cannot read anyone else''s prefs row');
  perform pg_temp.ok(pg_temp.rows($q$delete from tk_staff_profile_prefs where owner_email = 'tkp2-b@mygoodbooks.org'$q$) = 0,
                     'admin C delete of B touches 0 rows');
  reset role;
  perform pg_temp.ok(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                                  where n.nspname = 'public' and p.prosecdef
                                    and p.proname in ('tk__profile_section_keys', 'tk__profile_fixed_sections', 'tk__tz_ok',
                                                      'tk_staff_profile_prefs_guard', 'tk_staff_teams_guard', 'tk_staff_team_members_guard')),
                     'helpers and triggers are not SECURITY DEFINER');
end $$;

-- ---------------------------------------------------------------------
select 'SELF-TEST PASSED' as result, current_setting('tkp2.ok', true)::int as checks_passed;
rollback;
