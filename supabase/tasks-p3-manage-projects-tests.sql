-- =====================================================================
-- Self-test for tasks-p3-manage-projects.sql.
--
-- Run it whole; it ends in ROLLBACK, so nothing it writes is kept and no
-- email is sent. It never talks to Asana and flips no switch. People are
-- picked at run time; no names or emails live here. A failed check raises.
--
-- Proves: rename / archive / unarchive / trash / restore are admin or
-- project-manager only (a stranger and an anonymous caller are refused); the
-- admin list is admin only; trash hides the project and its tasks from every
-- direct read and from staff_performance, keeps a task deleted on its own
-- deleted after a restore, refuses new live tasks and single undeletes while
-- trashed, refuses while an Ask-client request is unfinished, never forges
-- through the API, and nothing is ever removed (30 days only marks
-- "expired", an admin can still restore it); same name as a trashed project
-- is allowed, restore into a taken name is refused; every action is in the
-- audit log; no email.
--
-- Review fixes (tasks-p3-manage-projects-fixes.sql): a trashed task cannot be
-- undeleted or moved by one UPDATE (project_id null + deleted_at null), other
-- columns of it can still change (offboarding / hand-off), the task counts
-- RPC for the trash confirm, restore into a taken name has its own error,
-- the Asana import functions ignore trashed projects.
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
create or replace function pg_temp.d(p_days int) returns date language sql as $$
  select (now() at time zone 'America/Chicago')::date + p_days;
$$;
create or replace function pg_temp.outbox() returns bigint language sql as $$ select count(*) from notification_outbox $$;
-- a task as the table owner with no caller identity (like a cron or the import)
create or replace function pg_temp.mk(p_key text, p_owner text, p_project uuid, p_due date default null, p_status text default 'todo') returns uuid
language plpgsql as $$
declare v uuid;
begin
  insert into staff_reminders (staff_email, assignee_email, text, project_id, due_date, visibility, kind, status)
  values (p_owner, p_owner, 'P3 manage test ' || p_key, p_project, p_due,
          case when p_project is null then 'private' else 'shared' end, 'task', p_status)
  returning id into v;
  insert into t_ctx values (p_key, v::text);
  return v;
end $$;
create or replace function pg_temp.row(p_key text) returns staff_reminders language sql as $$
  select * from staff_reminders where id = pg_temp.id(p_key)
$$;
create or replace function pg_temp.mkproj(p_key text, p_name text, p_as text) returns uuid language plpgsql as $$
declare v uuid;
begin
  perform pg_temp.as_user(p_as);
  insert into tk_projects (name, kind) values (p_name, 'internal') returning id into v;
  perform pg_temp.as_user(null);
  insert into t_ctx values (p_key, v::text);
  return v;
end $$;
create or replace function pg_temp.perf_overdue(p_admin text, p_email text) returns int language plpgsql as $$
declare v int;
begin
  perform pg_temp.as_user(p_admin);
  set local role authenticated;
  select coalesce(sum(tasks_overdue), 0) into v from public.staff_performance(30) where lower(email) = p_email;
  reset role;
  perform pg_temp.as_user(null);
  return v;
end $$;
-- how many rows of tk_projects / staff_reminders the caller can read, through RLS like the app
create or replace function pg_temp.see_proj(p_who text, p_id uuid) returns int language plpgsql as $$
declare v int;
begin
  perform pg_temp.as_user(p_who);
  set local role authenticated;
  select count(*) into v from tk_projects where id = p_id;
  reset role;
  perform pg_temp.as_user(null);
  return v;
end $$;
create or replace function pg_temp.see_task(p_who text, p_id uuid) returns int language plpgsql as $$
declare v int;
begin
  perform pg_temp.as_user(p_who);
  set local role authenticated;
  select count(*) into v from staff_reminders where id = p_id and deleted_at is null;
  reset role;
  perform pg_temp.as_user(null);
  return v;
end $$;
create or replace function pg_temp.audit_n(p_action text, p_target uuid) returns bigint language sql as $$
  select count(*) from audit_log where action = p_action and target_id = p_target::text
$$;

-- People: a1, a2 admins; bk1 (project owner), bk2 (stranger) bookkeepers.
insert into t_ctx select 'a1', lower(email) from staff where active and role = 'admin' order by email limit 1;
insert into t_ctx select 'a2', lower(email) from staff where active and role = 'admin' order by email offset 1 limit 1;
insert into t_ctx select 'bk1', lower(email) from staff where active and role = 'bookkeeper' order by email limit 1;
insert into t_ctx select 'bk2', lower(email) from staff where active and role = 'bookkeeper' order by email offset 1 limit 1;
select pg_temp.ok(pg_temp.ctx('a1') is not null and pg_temp.ctx('a2') is not null and pg_temp.ctx('bk1') is not null
                  and pg_temp.ctx('bk2') is not null, 'test people found');
insert into t_ctx values ('outbox0', pg_temp.outbox()::text);

-- 0. Setup --------------------------------------------------------------------
select pg_temp.mkproj('P1', 'P3 manage test Alpha', pg_temp.ctx('bk1'));
select pg_temp.mkproj('P2', 'P3 manage test Beta', pg_temp.ctx('a1'));
select pg_temp.ok(exists (select 1 from tk_projects where id = pg_temp.id('P1') and lower(owner_email) = pg_temp.ctx('bk1')),
                  'setup: P1 owned by bk1');
insert into t_ctx values ('perf0', pg_temp.perf_overdue(pg_temp.ctx('a1'), pg_temp.ctx('bk1'))::text);
select pg_temp.mk('T1', pg_temp.ctx('bk1'), pg_temp.id('P1'), pg_temp.d(-4));            -- open, overdue, assigned to bk1
select pg_temp.mk('T2', pg_temp.ctx('bk1'), pg_temp.id('P1'), null, 'done');              -- done
select pg_temp.mk('T3', pg_temp.ctx('bk1'), pg_temp.id('P1'));                            -- deleted on its own before the trash
select pg_temp.mk('T4', pg_temp.ctx('bk1'), pg_temp.id('P2'));                            -- control: other project
select pg_temp.mk('T5', pg_temp.ctx('bk1'), null);                                        -- control: no project
update staff_reminders set deleted_at = now() where id = pg_temp.id('T3');
select pg_temp.ok(pg_temp.perf_overdue(pg_temp.ctx('a1'), pg_temp.ctx('bk1')) = pg_temp.ctx('perf0')::int + 1,
                  'setup: the overdue task counts in staff_performance');
select pg_temp.ok(pg_temp.see_task(pg_temp.ctx('bk1'), pg_temp.id('T1')) = 1, 'setup: bk1 sees T1');

-- 1. Who may act ------------------------------------------------------------------
select pg_temp.as_user(pg_temp.ctx('bk2'));
select pg_temp.expect_err($$select public.tk_project_rename(pg_temp.id('P1'), 'Nope')$$, 'tk_forbidden', 'stranger cannot rename');
select pg_temp.expect_err($$select public.tk_project_archive(pg_temp.id('P1'), true)$$, 'tk_forbidden', 'stranger cannot archive');
select pg_temp.expect_err($$select public.tk_project_trash(pg_temp.id('P1'))$$, 'tk_forbidden', 'stranger cannot trash');
select pg_temp.expect_err($$select public.tk_project_restore(pg_temp.id('P1'))$$, 'tk_forbidden', 'stranger cannot restore');
select pg_temp.expect_err($$select * from public.tk_admin_list_projects()$$, 'tk_forbidden', 'stranger cannot open the admin list');
select pg_temp.as_user(pg_temp.ctx('bk1'));
select pg_temp.expect_err($$select * from public.tk_admin_list_projects()$$, 'tk_forbidden', 'an owner who is not an admin cannot open the admin list');
select pg_temp.as_user(null);
select pg_temp.expect_err($$select public.tk_project_trash(pg_temp.id('P1'))$$, 'tk_forbidden', 'no caller identity is refused');
select pg_temp.expect_err($$select * from public.tk_admin_list_projects()$$, 'tk_forbidden', 'no caller identity is refused (list)');
select pg_temp.ok(not has_function_privilege('anon', 'public.tk_project_trash(uuid)', 'execute')
                  and not has_function_privilege('anon', 'public.tk_project_restore(uuid)', 'execute')
                  and not has_function_privilege('anon', 'public.tk_project_rename(uuid,text)', 'execute')
                  and not has_function_privilege('anon', 'public.tk_project_archive(uuid,boolean)', 'execute')
                  and not has_function_privilege('anon', 'public.tk_admin_list_projects()', 'execute')
                  and not has_function_privilege('authenticated', 'public.tk__project_gate(uuid)', 'execute')
                  and not has_function_privilege('authenticated', 'public.tk__projects_mark_expired()', 'execute'),
                  'anon cannot execute the RPCs; the helpers are not callable from the API');

-- 2. Rename and archive by the project owner ---------------------------------------
select pg_temp.as_user(pg_temp.ctx('bk1'));
select pg_temp.ok(public.tk_project_rename(pg_temp.id('P1'), '  P3 manage test Alpha 2  ') = 'P3 manage test Alpha 2', 'owner renames (trimmed)');
select pg_temp.expect_err($$select public.tk_project_rename(pg_temp.id('P1'), '   ')$$, 'tk_bad_name', 'a blank name is refused');
select pg_temp.expect_err($$select public.tk_project_rename(pg_temp.id('P1'), repeat('x', 121))$$, 'tk_bad_name', 'a 121-character name is refused');
select pg_temp.as_user(pg_temp.ctx('a1'));
select pg_temp.expect_err($$select public.tk_project_rename(pg_temp.id('P2'), 'p3 MANAGE test alpha 2')$$, 'tk_name_taken',
                          'a taken name is refused (case-insensitive)');
select pg_temp.as_user(pg_temp.ctx('bk1'));
select pg_temp.ok(public.tk_project_archive(pg_temp.id('P1'), true) = 'archived', 'owner archives');
select pg_temp.ok(exists (select 1 from tk_projects where id = pg_temp.id('P1') and archived_at is not null), 'the project is archived');
select pg_temp.ok(public.tk_project_archive(pg_temp.id('P1'), false) = 'active', 'owner unarchives');
select pg_temp.ok(exists (select 1 from tk_projects where id = pg_temp.id('P1') and archived_at is null), 'the project is active again');
select pg_temp.as_user(null);
select pg_temp.ok(pg_temp.audit_n('tk_project.renamed', pg_temp.id('P1')) = 1
                  and pg_temp.audit_n('tk_project.archived', pg_temp.id('P1')) = 1
                  and pg_temp.audit_n('tk_project.unarchived', pg_temp.id('P1')) = 1, 'rename, archive, unarchive are audited');

-- 3. The admin list ----------------------------------------------------------------------
select pg_temp.as_user(pg_temp.ctx('a1'));
select pg_temp.ok((select open_tasks = 1 and done_tasks = 1 and trashed_tasks = 0 and state = 'active' and open_requests = 0
                     from public.tk_admin_list_projects() where id = pg_temp.id('P1')),
                  'admin list: P1 active with 1 open and 1 done task (the individually deleted one is not counted)');
select pg_temp.as_user(null);

-- 3b. Counts for the trash confirm (open / done / other people's)
select pg_temp.as_user(pg_temp.ctx('bk1'));
select pg_temp.ok((select open_tasks = 1 and done_tasks = 1 and other_tasks = 0 from public.tk_project_task_counts(pg_temp.id('P1'))),
                  'counts: the owner sees 1 open, 1 done, none belonging to other people');
select pg_temp.expect_err($$select * from public.tk_project_task_counts(pg_temp.id('P2'))$$, 'tk_forbidden', 'counts: a non-manager is refused');
select pg_temp.as_user(pg_temp.ctx('a1'));
select pg_temp.ok((select open_tasks = 1 and done_tasks = 1 and other_tasks = 2 from public.tk_project_task_counts(pg_temp.id('P1'))),
                  'counts: an admin sees the same tasks as other people''s');
select pg_temp.as_user(null);
select pg_temp.expect_err($$select * from public.tk_project_task_counts(pg_temp.id('P1'))$$, 'tk_forbidden', 'counts: no caller identity is refused');
select pg_temp.ok(not has_function_privilege('anon', 'public.tk_project_task_counts(uuid)', 'execute'), 'counts: anon cannot execute');

-- 4. Trash ---------------------------------------------------------------------------------------
select pg_temp.as_user(pg_temp.ctx('bk1'));
select pg_temp.ok(public.tk_project_trash(pg_temp.id('P1')) = 2, 'owner trashes P1; two live tasks went with it');
select pg_temp.ok(public.tk_project_trash(pg_temp.id('P1')) = 0, 'trashing again does nothing');
select pg_temp.as_user(null);
select pg_temp.ok(pg_temp.see_proj(pg_temp.ctx('bk1'), pg_temp.id('P1')) = 0
                  and pg_temp.see_proj(pg_temp.ctx('a1'), pg_temp.id('P1')) = 0, 'the trashed project is hidden from its owner and from admins');
select pg_temp.ok(pg_temp.see_proj(pg_temp.ctx('a1'), pg_temp.id('P2')) = 1, 'control: another project is still visible');
select pg_temp.ok(pg_temp.see_task(pg_temp.ctx('bk1'), pg_temp.id('T1')) = 0 and pg_temp.see_task(pg_temp.ctx('a1'), pg_temp.id('T2')) = 0,
                  'its tasks are hidden from every list');
select pg_temp.ok(pg_temp.see_task(pg_temp.ctx('bk1'), pg_temp.id('T4')) = 1 and pg_temp.see_task(pg_temp.ctx('bk1'), pg_temp.id('T5')) = 1,
                  'control: tasks in other projects and without a project are untouched');
select pg_temp.ok((pg_temp.row('T1')).trashed_with_project = pg_temp.id('P1') and (pg_temp.row('T2')).trashed_with_project = pg_temp.id('P1')
                  and (pg_temp.row('T1')).deleted_at is not null
                  and (pg_temp.row('T3')).trashed_with_project is null and (pg_temp.row('T3')).deleted_at is not null,
                  'tasks hidden with the project are marked; the one deleted earlier is not');
select pg_temp.ok(pg_temp.perf_overdue(pg_temp.ctx('a1'), pg_temp.ctx('bk1')) = pg_temp.ctx('perf0')::int,
                  'staff_performance no longer counts the trashed project''s overdue task');
select pg_temp.ok(exists (select 1 from tk_projects where id = pg_temp.id('P1') and trashed_by = pg_temp.ctx('bk1') and trashed_at is not null)
                  and (select count(*) from staff_reminders where project_id = pg_temp.id('P1')) = 3,
                  'nothing was removed: the project row and all 3 task rows are still there');
select pg_temp.ok(pg_temp.audit_n('tk_project.trashed', pg_temp.id('P1')) = 1, 'trash is audited');
select pg_temp.as_user(pg_temp.ctx('a1'));
select pg_temp.ok((select state = 'trashed' and trashed_tasks = 2 and open_tasks = 0 and trash_expires_at > now() + interval '29 days'
                     from public.tk_admin_list_projects() where id = pg_temp.id('P1')),
                  'admin list shows P1 as trashed, 2 tasks inside, 30 days to go');
select pg_temp.expect_err($$select public.tk_project_rename(pg_temp.id('P1'), 'Other')$$, 'tk_project_trashed', 'a trashed project cannot be renamed');
select pg_temp.expect_err($$select public.tk_project_archive(pg_temp.id('P1'), true)$$, 'tk_project_trashed', 'a trashed project cannot be archived');
select pg_temp.as_user(null);
select pg_temp.expect_err($$select pg_temp.mk('T6', pg_temp.ctx('bk1'), pg_temp.id('P1'))$$, 'tk_project_trashed', 'no new live task in a trashed project');
select pg_temp.expect_err($$update staff_reminders set deleted_at = null where id = pg_temp.id('T1')$$, 'tk_task_in_trash',
                          'a task of a trashed project cannot be undeleted on its own');
select pg_temp.expect_err($$update staff_reminders set project_id = pg_temp.id('P1'), deleted_at = null where id = pg_temp.id('T5')$$, 'tk_project_trashed',
                          'a task cannot be moved into a trashed project');
-- review fix: the exact statement that used to slip through (project cleared AND undeleted at once)
select pg_temp.expect_err($$update staff_reminders set project_id = null, deleted_at = null where id = pg_temp.id('T1')$$, 'tk_task_in_trash',
                          'a trashed task cannot be pulled out with project_id = null and deleted_at = null');
select pg_temp.expect_err($$update staff_reminders set project_id = pg_temp.id('P2') where id = pg_temp.id('T2')$$, 'tk_task_in_trash',
                          'a trashed task cannot be moved to another project');
select pg_temp.expect_err($$update staff_reminders set deleted_at = null, trashed_with_project = null where id = pg_temp.id('T2')$$, 'tk_task_in_trash',
                          'a trashed task cannot be undeleted while clearing its marker');
select pg_temp.ok((pg_temp.row('T1')).deleted_at is not null and (pg_temp.row('T1')).project_id = pg_temp.id('P1')
                  and (pg_temp.row('T1')).trashed_with_project = pg_temp.id('P1'), 'the refused statements changed nothing');
-- other columns still change (offboarding / hand-off reassign every not-done task); the task stays hidden
update staff_reminders set assignee_email = pg_temp.ctx('bk2') where id = pg_temp.id('T1');
select pg_temp.ok((pg_temp.row('T1')).assignee_email = pg_temp.ctx('bk2') and (pg_temp.row('T1')).deleted_at is not null
                  and (pg_temp.row('T1')).trashed_with_project = pg_temp.id('P1'),
                  'a reassignment of a trashed task still works and keeps it hidden and marked');
update staff_reminders set assignee_email = pg_temp.ctx('bk1') where id = pg_temp.id('T1');
-- the Asana import functions ignore trashed projects
select pg_temp.ok(position('trashed_at is null' in pg_get_functiondef('public.tk_import_assign_team(text,text)'::regprocedure)) > 0,
                  'tk_import_assign_team ignores trashed projects');
select pg_temp.ok((select position('archived_at is null and trashed_at is null' in pg_get_functiondef(p.oid)) > 0
                     from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'tk_import_asana_apply'),
                  'tk_import_asana_apply ignores trashed projects');
-- the API cannot forge or clear the trash columns
select pg_temp.as_user(pg_temp.ctx('a1'));
set local role authenticated;
update tk_projects set trashed_at = now() where id = pg_temp.id('P2');
reset role;
select pg_temp.as_user(null);
select pg_temp.ok((select trashed_at is null from tk_projects where id = pg_temp.id('P2')), 'a direct API update cannot trash a project');
update staff_reminders set trashed_with_project = pg_temp.id('P2') where id = pg_temp.id('T4');
select pg_temp.ok((select trashed_with_project is null from staff_reminders where id = pg_temp.id('T4')), 'trashed_with_project cannot be set outside the RPCs');

-- 5. A same-name project can be made while the old one is in the trash; restore into a taken name is refused
select pg_temp.mkproj('P3', 'P3 manage test Alpha 2', pg_temp.ctx('a2'));
select pg_temp.ok(pg_temp.id('P3') is not null, 'a new project may reuse the name of a trashed one');
select pg_temp.as_user(pg_temp.ctx('a1'));
select pg_temp.expect_err($$select public.tk_project_restore(pg_temp.id('P1'))$$, 'tk_restore_name_taken', 'restore into a taken name is refused (its own error)');
select pg_temp.as_user(null);
update tk_projects set name = 'P3 manage test Gamma' where id = pg_temp.id('P3');

-- 6. Restore ----------------------------------------------------------------------------------------------
select pg_temp.as_user(pg_temp.ctx('bk2'));
select pg_temp.expect_err($$select public.tk_project_restore(pg_temp.id('P1'))$$, 'tk_forbidden', 'a stranger cannot restore');
select pg_temp.as_user(pg_temp.ctx('bk1'));
select pg_temp.ok(public.tk_project_restore(pg_temp.id('P1')) = 2, 'the owner restores P1; two tasks came back');
select pg_temp.ok(public.tk_project_restore(pg_temp.id('P1')) = 0, 'restoring again does nothing');
select pg_temp.as_user(null);
select pg_temp.ok(pg_temp.see_proj(pg_temp.ctx('bk1'), pg_temp.id('P1')) = 1, 'P1 is visible again');
select pg_temp.ok(pg_temp.see_task(pg_temp.ctx('bk1'), pg_temp.id('T1')) = 1 and (pg_temp.row('T2')).deleted_at is null
                  and (pg_temp.row('T1')).trashed_with_project is null, 'its tasks are back');
select pg_temp.ok((pg_temp.row('T3')).deleted_at is not null, 'the task deleted on its own stays deleted');
select pg_temp.ok(pg_temp.perf_overdue(pg_temp.ctx('a1'), pg_temp.ctx('bk1')) = pg_temp.ctx('perf0')::int + 1,
                  'staff_performance counts the overdue task again');
select pg_temp.ok(pg_temp.audit_n('tk_project.restored', pg_temp.id('P1')) = 1, 'restore is audited');

-- 7. An unfinished Ask-client request blocks the trash ---------------------------------------------------------
do $$
declare v_t uuid := pg_temp.id('T1'); v_c text;
begin
  select id into v_c from clients order by id limit 1;
  insert into client_requests (client_id, task_id, kind, title, prompt, asked_by)
  values (v_c, v_t, 'question', 'P3 manage test', 'P3 manage test question', pg_temp.ctx('bk1'));
end $$;
select pg_temp.as_user(pg_temp.ctx('a1'));
select pg_temp.ok((select open_requests = 1 from public.tk_admin_list_projects() where id = pg_temp.id('P1')), 'admin list counts the unfinished request');
select pg_temp.expect_err($$select public.tk_project_trash(pg_temp.id('P1'))$$, 'tk_has_open_requests', 'trash is refused while a client request is unfinished');
select pg_temp.as_user(null);
select pg_temp.ok((pg_temp.row('T1')).deleted_at is null and exists (select 1 from tk_projects where id = pg_temp.id('P1') and trashed_at is null),
                  'the refused trash changed nothing');
update client_requests set status = 'cancelled', cancelled_at = now() where task_id = pg_temp.id('T1');

-- 8. 30 days only marks "expired"; an admin can still restore -----------------------------------------------------
select pg_temp.as_user(pg_temp.ctx('a1'));
select public.tk_project_trash(pg_temp.id('P1'));
select pg_temp.as_user(null);
select set_config('mgb.tk_project_trash', 'on', true);
update tk_projects set trashed_at = now() - interval '31 days' where id = pg_temp.id('P1');
select set_config('mgb.tk_project_trash', '', true);
select pg_temp.as_user(pg_temp.ctx('a1'));
select pg_temp.ok((select state = 'expired' and trash_expired and trashed_tasks = 2 from public.tk_admin_list_projects() where id = pg_temp.id('P1')),
                  'after 30 days the list says expired');
select pg_temp.as_user(null);
select pg_temp.ok(exists (select 1 from tk_projects where id = pg_temp.id('P1') and trash_expired_at is not null)
                  and pg_temp.audit_n('tk_project.trash_expired', pg_temp.id('P1')) = 1
                  and (select count(*) from staff_reminders where project_id = pg_temp.id('P1')) = 3,
                  'expiry only marks it (audited once); every row is still there');
select pg_temp.as_user(pg_temp.ctx('bk1'));
select pg_temp.expect_err($$select public.tk_project_restore(pg_temp.id('P1'))$$, 'tk_trash_expired', 'an owner who is not an admin cannot restore after 30 days');
select pg_temp.as_user(pg_temp.ctx('a1'));
select pg_temp.ok(public.tk_project_restore(pg_temp.id('P1')) = 2, 'an admin can still restore after 30 days');
select pg_temp.as_user(null);
select pg_temp.ok(exists (select 1 from tk_projects where id = pg_temp.id('P1') and trashed_at is null and trash_expired_at is null), 'restored project is clean');

-- 9. No email from any of it
select pg_temp.ok(pg_temp.outbox() = pg_temp.ctx('outbox0')::bigint, 'no email was queued');

select 'Manage projects self-test: all checks passed' as result;
rollback;
