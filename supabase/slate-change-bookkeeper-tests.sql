-- =====================================================================
-- Self-test for slate-change-bookkeeper.sql (tk_change_bookkeeper).
--
-- Run it whole; it ends in ROLLBACK, so nothing it writes is kept (the
-- throwaway clients, the project, the tasks, the access rows, the audit
-- row) and no email is sent. People are picked at run time; no names or
-- emails live here. A failed check raises and stops.
--
-- Proves: only admins may run it; unknown or inactive staff, a missing or
-- internal client, a client with no bookkeeper and the same person are
-- refused; the bookkeeper changes through the clients triggers (display
-- JSON, staff_client_access for the new one, the old one keeps theirs);
-- the new bookkeeper joins the client's projects; only the old
-- bookkeeper's open shared tasks that are on them or on nobody move
-- (third-person assignee, third-person owner, done, private, in review and
-- other clients stay); move_open_tasks = false moves nothing; no email;
-- the guards are reset; one audit row; anon cannot execute.
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
create or replace function pg_temp.outbox() returns bigint language sql as $$ select count(*) from notification_outbox $$;
create or replace function pg_temp.task(p_key text) returns staff_reminders language sql as $$
  select * from staff_reminders where id = (select v::uuid from t_ctx where k = p_key)
$$;
-- One task on a client, written as a direct database session (no JWT). An
-- empty assignee stays empty (mgb.tk_unassigned, as the import does).
create or replace function pg_temp.mk(p_key text, p_client text, p_owner text, p_assignee text, p_status text, p_visibility text)
returns void language plpgsql as $$
declare v uuid;
begin
  perform set_config('mgb.tk_unassigned', case when p_assignee is null then 'on' else '' end, true);
  insert into staff_reminders (staff_email, assignee_email, text, client_id, kind, visibility, status, review_required)
  values (p_owner, p_assignee, 'Change bookkeeper test ' || p_key, p_client, 'task', p_visibility, p_status, false)
  returning id into v;
  perform set_config('mgb.tk_unassigned', '', true);
  insert into t_ctx values (p_key, v::text);
end $$;

-- People: a1 = active admin; bk1 (old), bk2 (new), bk3 (someone else) = active non-admin staff.
insert into t_ctx select 'a1', lower(email) from staff where active and role = 'admin' order by email limit 1;
insert into t_ctx select 'bk1', lower(email) from staff where active and role = 'bookkeeper' order by email limit 1;
insert into t_ctx select 'bk2', lower(email) from staff where active and role = 'bookkeeper' order by email offset 1 limit 1;
insert into t_ctx select 'bk3', lower(email) from staff where active and role = 'bookkeeper' order by email offset 2 limit 1;
insert into t_ctx select 'inactive', lower(email) from staff where not active order by email limit 1;
insert into t_ctx select 'internal', id from clients where is_internal limit 1;
select pg_temp.ok(pg_temp.ctx('a1') is not null and pg_temp.ctx('bk1') is not null
                  and pg_temp.ctx('bk2') is not null and pg_temp.ctx('bk3') is not null, 'test people found');
select pg_temp.ok(not exists (select 1 from clients where id like 'cbk-test-%'), 'no leftover test clients');

-- Throwaway clients (as a direct database session): X and Z have bk1 as bookkeeper, Y has none.
insert into clients (id, name, org_type)
select x.id, x.name, (select org_type from clients where org_type is not null limit 1)
  from (values ('cbk-test-x', 'Change bookkeeper test X'), ('cbk-test-y', 'Change bookkeeper test Y'),
               ('cbk-test-z', 'Change bookkeeper test Z')) x(id, name);
update clients set assigned_bookkeeper_email = pg_temp.ctx('bk1') where id in ('cbk-test-x', 'cbk-test-z');
select pg_temp.ok((select count(*) = 2 from staff_client_access where client_id in ('cbk-test-x', 'cbk-test-z')
                     and lower(staff_email) = pg_temp.ctx('bk1')), 'setup: bk1 has access to X and Z');
select pg_temp.ok(not exists (select 1 from staff_client_access where client_id like 'cbk-test-%'
                                and lower(staff_email) = pg_temp.ctx('bk2')), 'setup: bk2 has no access yet');
insert into tk_projects (name, kind, client_id, color)
select 'Change bookkeeper test project', p.kind, 'cbk-test-x', p.color
  from tk_projects p where p.client_id is not null order by p.created_at limit 1
returning id;
insert into t_ctx select 'proj', id::text from tk_projects where client_id = 'cbk-test-x';
select pg_temp.ok(pg_temp.ctx('proj') is not null, 'setup: X has a project');

-- Tasks on X
select pg_temp.mk('t_unassigned', 'cbk-test-x', pg_temp.ctx('bk1'), null, 'todo', 'shared');            -- moves, stays unassigned
select pg_temp.mk('t_self', 'cbk-test-x', pg_temp.ctx('bk1'), pg_temp.ctx('bk1'), 'in_progress', 'shared');   -- moves
select pg_temp.mk('t_waiting', 'cbk-test-x', pg_temp.ctx('bk1'), pg_temp.ctx('bk1'), 'waiting_client', 'shared');   -- moves
select pg_temp.mk('t_third_assignee', 'cbk-test-x', pg_temp.ctx('bk1'), pg_temp.ctx('bk3'), 'todo', 'shared');   -- stays
select pg_temp.mk('t_third_owner', 'cbk-test-x', pg_temp.ctx('bk3'), pg_temp.ctx('bk1'), 'todo', 'shared');     -- stays
select pg_temp.mk('t_third_owner_un', 'cbk-test-x', pg_temp.ctx('bk3'), null, 'todo', 'shared');             -- stays
select pg_temp.mk('t_done', 'cbk-test-x', pg_temp.ctx('bk1'), pg_temp.ctx('bk1'), 'done', 'shared');          -- stays
select pg_temp.mk('t_private', 'cbk-test-x', pg_temp.ctx('bk1'), pg_temp.ctx('bk1'), 'todo', 'private');      -- stays
select pg_temp.mk('t_review', 'cbk-test-x', pg_temp.ctx('bk1'), pg_temp.ctx('bk1'), 'ready_for_review', 'shared');   -- stays, counted
-- Same person on another client: stays
select pg_temp.mk('t_other_client', 'cbk-test-z', pg_temp.ctx('bk1'), pg_temp.ctx('bk1'), 'todo', 'shared');
select pg_temp.ok((pg_temp.task('t_unassigned')).assignee_email is null and (pg_temp.task('t_self')).assignee_email = pg_temp.ctx('bk1')
                  and (pg_temp.task('t_review')).status = 'ready_for_review' and (pg_temp.task('t_done')).status = 'done',
                  'setup: tasks as intended');
insert into t_ctx values ('outbox0', pg_temp.outbox()::text);
insert into t_ctx values ('audit0', (select count(*) from audit_log where action = 'client.bookkeeper_changed' and client_id like 'cbk-test-%')::text);

-- 1. Who may run it
select pg_temp.as_user(pg_temp.ctx('bk1'));
select pg_temp.expect_err($$select public.tk_change_bookkeeper('cbk-test-x', pg_temp.ctx('bk2'))$$, 'tk_forbidden',
                          'a bookkeeper cannot change the bookkeeper');
select pg_temp.as_user(pg_temp.ctx('bk2'));
select pg_temp.expect_err($$select public.tk_change_bookkeeper('cbk-test-x', pg_temp.ctx('bk2'), false)$$, 'tk_forbidden',
                          'nor make themselves the bookkeeper');
select pg_temp.ok(not has_function_privilege('anon', 'public.tk_change_bookkeeper(text, text, boolean)', 'execute'), 'anon cannot execute');
select pg_temp.ok(has_function_privilege('authenticated', 'public.tk_change_bookkeeper(text, text, boolean)', 'execute'), 'authenticated may call it (admin check inside)');
select pg_temp.ok(not has_function_privilege('public', 'public.tk_change_bookkeeper(text, text, boolean)', 'execute'), 'not granted to public');

-- 2. Refusals (as an admin)
select pg_temp.as_user(pg_temp.ctx('a1'));
select pg_temp.expect_err($$select public.tk_change_bookkeeper('cbk-test-x', 'nobody@example.invalid')$$, 'tk_bad_assignee', 'unknown person');
select pg_temp.expect_err($$select public.tk_change_bookkeeper('cbk-test-x', '')$$, 'tk_bad_assignee', 'empty person');
do $$ begin
  if pg_temp.ctx('inactive') is not null then
    perform pg_temp.expect_err(format('select public.tk_change_bookkeeper(%L, %L)', 'cbk-test-x', pg_temp.ctx('inactive')),
                               'tk_bad_assignee', 'inactive staff');
  else
    raise notice 'skip: no inactive staff to try';
  end if;
end $$;
select pg_temp.expect_err($$select public.tk_change_bookkeeper('cbk-test-missing', pg_temp.ctx('bk2'))$$, 'tk_not_found', 'missing client');
do $$ begin
  if pg_temp.ctx('internal') is not null then
    perform pg_temp.expect_err(format('select public.tk_change_bookkeeper(%L, %L)', pg_temp.ctx('internal'), pg_temp.ctx('bk2')),
                               'tk_not_found', 'MGB (internal) is refused');
  else
    raise notice 'skip: no internal client';
  end if;
end $$;
select pg_temp.expect_err($$select public.tk_change_bookkeeper('cbk-test-y', pg_temp.ctx('bk2'))$$, 'tk_no_team', 'no bookkeeper yet: Assign team');
select pg_temp.expect_err($$select public.tk_change_bookkeeper('cbk-test-x', upper(pg_temp.ctx('bk1')))$$, 'tk_same_bookkeeper', 'same person (any case)');
select pg_temp.ok((select assigned_bookkeeper_email from clients where id = 'cbk-test-x') = pg_temp.ctx('bk1')
                  and (select assigned_bookkeeper_email from clients where id = 'cbk-test-y') is null, 'refusals changed nothing');
select pg_temp.ok((select count(*) from audit_log where action = 'client.bookkeeper_changed' and client_id like 'cbk-test-%') = pg_temp.ctx('audit0')::bigint,
                  'refusals wrote no audit row');

-- 3. Change X from bk1 to bk2, moving tasks (as the authenticated role, like the app)
set local role authenticated;
insert into t_ctx select 'res', public.tk_change_bookkeeper('cbk-test-x', pg_temp.ctx('bk2'))::text;
reset role;
select pg_temp.ok((pg_temp.ctx('res')::jsonb ->> 'old_bookkeeper') = pg_temp.ctx('bk1')
                  and (pg_temp.ctx('res')::jsonb ->> 'bookkeeper') = pg_temp.ctx('bk2')
                  and (pg_temp.ctx('res')::jsonb ->> 'client_id') = 'cbk-test-x'
                  and (pg_temp.ctx('res')::jsonb ->> 'by') = pg_temp.ctx('a1'), 'result names old, new, client and admin');
select pg_temp.ok((pg_temp.ctx('res')::jsonb ->> 'tasks_moved')::int = 3, 'three tasks moved');
select pg_temp.ok((pg_temp.ctx('res')::jsonb ->> 'tasks_in_review')::int = 1, 'one in review counted, not moved');
select pg_temp.ok((pg_temp.ctx('res')::jsonb ->> 'projects_joined')::int = 1, 'joined one project');
select pg_temp.ok((select assigned_bookkeeper_email = pg_temp.ctx('bk2') and assigned_bookkeeper ->> 'email' = pg_temp.ctx('bk2')
                     from clients where id = 'cbk-test-x'), 'client shows the new bookkeeper (display JSON too)');
select pg_temp.ok(exists (select 1 from staff_client_access where client_id = 'cbk-test-x' and lower(staff_email) = pg_temp.ctx('bk2')),
                  'new bookkeeper got client access (trigger)');
select pg_temp.ok(exists (select 1 from staff_client_access where client_id = 'cbk-test-x' and lower(staff_email) = pg_temp.ctx('bk1')),
                  'old bookkeeper keeps client access');
select pg_temp.ok(exists (select 1 from tk_project_members where project_id = pg_temp.id('proj') and staff_email = pg_temp.ctx('bk2') and role = 'member'),
                  'new bookkeeper is a project member');
-- moved
select pg_temp.ok(lower((pg_temp.task('t_unassigned')).staff_email) = pg_temp.ctx('bk2') and (pg_temp.task('t_unassigned')).assignee_email is null,
                  'unassigned task: new owner, still unassigned');
select pg_temp.ok(lower((pg_temp.task('t_self')).staff_email) = pg_temp.ctx('bk2') and (pg_temp.task('t_self')).assignee_email = pg_temp.ctx('bk2')
                  and (pg_temp.task('t_self')).status = 'in_progress', 'self-assigned task: owner and assignee moved, status kept');
select pg_temp.ok(lower((pg_temp.task('t_waiting')).staff_email) = pg_temp.ctx('bk2') and (pg_temp.task('t_waiting')).assignee_email = pg_temp.ctx('bk2')
                  and (pg_temp.task('t_waiting')).status = 'waiting_client', 'waiting task moved, still waiting');
-- not moved
select pg_temp.ok(lower((pg_temp.task('t_third_assignee')).staff_email) = pg_temp.ctx('bk1') and (pg_temp.task('t_third_assignee')).assignee_email = pg_temp.ctx('bk3'),
                  'task assigned to a third person untouched');
select pg_temp.ok(lower((pg_temp.task('t_third_owner')).staff_email) = pg_temp.ctx('bk3') and (pg_temp.task('t_third_owner')).assignee_email = pg_temp.ctx('bk1'),
                  'task owned by a third person untouched');
select pg_temp.ok(lower((pg_temp.task('t_third_owner_un')).staff_email) = pg_temp.ctx('bk3') and (pg_temp.task('t_third_owner_un')).assignee_email is null,
                  'unassigned task owned by a third person untouched');
select pg_temp.ok(lower((pg_temp.task('t_done')).staff_email) = pg_temp.ctx('bk1') and (pg_temp.task('t_done')).assignee_email = pg_temp.ctx('bk1'),
                  'done task untouched');
select pg_temp.ok(lower((pg_temp.task('t_private')).staff_email) = pg_temp.ctx('bk1') and (pg_temp.task('t_private')).assignee_email = pg_temp.ctx('bk1'),
                  'private task untouched');
select pg_temp.ok(lower((pg_temp.task('t_review')).staff_email) = pg_temp.ctx('bk1') and (pg_temp.task('t_review')).assignee_email = pg_temp.ctx('bk1')
                  and (pg_temp.task('t_review')).status = 'ready_for_review', 'in-review task untouched');
select pg_temp.ok(lower((pg_temp.task('t_other_client')).staff_email) = pg_temp.ctx('bk1'), 'other client''s task untouched');
-- side effects
select pg_temp.ok(pg_temp.outbox() = pg_temp.ctx('outbox0')::bigint, 'no email queued');
select pg_temp.ok(coalesce(current_setting('mgb.offboarding', true), '') <> 'on'
                  and coalesce(current_setting('mgb.tk_import', true), '') <> 'on', 'guards reset');
select pg_temp.ok((select count(*) from audit_log where action = 'client.bookkeeper_changed' and client_id = 'cbk-test-x'
                     and lower(actor_email) = pg_temp.ctx('a1') and details ->> 'from' = pg_temp.ctx('bk1')
                     and details ->> 'to' = pg_temp.ctx('bk2') and (details ->> 'tasks_moved')::int = 3) = 1, 'one audit row');
select pg_temp.ok(exists (select 1 from tk_activity where task_id = pg_temp.id('t_self') and kind = 'assignee'
                            and to_value = pg_temp.ctx('bk2') and actor_email = pg_temp.ctx('a1')), 'task activity shows the admin reassigned it');
select pg_temp.expect_err($$select public.tk_change_bookkeeper('cbk-test-x', pg_temp.ctx('bk2'))$$, 'tk_same_bookkeeper', 'running it again is refused');

-- 4. move_open_tasks = false: the bookkeeper changes, tasks stay
insert into t_ctx select 'res_z', public.tk_change_bookkeeper('cbk-test-z', pg_temp.ctx('bk2'), false)::text;
select pg_temp.ok((pg_temp.ctx('res_z')::jsonb ->> 'tasks_moved')::int = 0 and (pg_temp.ctx('res_z')::jsonb ->> 'projects_joined')::int = 0,
                  'nothing moved when the box is off');
select pg_temp.ok((select assigned_bookkeeper_email from clients where id = 'cbk-test-z') = pg_temp.ctx('bk2'), 'Z has the new bookkeeper');
select pg_temp.ok(lower((pg_temp.task('t_other_client')).staff_email) = pg_temp.ctx('bk1')
                  and (pg_temp.task('t_other_client')).assignee_email = pg_temp.ctx('bk1'), 'Z task stays with the old bookkeeper');
select pg_temp.ok(pg_temp.outbox() = pg_temp.ctx('outbox0')::bigint, 'still no email');

-- 5. A direct database session (no JWT) may run it, like the other admin tools
select pg_temp.as_user(null);
insert into t_ctx select 'res_db', public.tk_change_bookkeeper('cbk-test-z', pg_temp.ctx('bk1'), false)::text;
select pg_temp.ok((pg_temp.ctx('res_db')::jsonb ->> 'by') like 'db:%', 'database session recorded as db:');

select 'Change bookkeeper self-test: all checks passed' as result;
rollback;
