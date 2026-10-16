-- =====================================================================
-- Self-test for tasks-p2-8-asana-import.sql (Asana import apply path).
--
-- Run it whole; it ends in ROLLBACK, so nothing it writes is kept (the
-- switch it turns on, the synthetic run, the tasks) and no email is sent.
-- It never talks to Asana: the "plan" is a 2-task synthetic batch with
-- fake gids on the test client basic-test. People are picked at run time;
-- no names or emails live in this file. A failed check raises and stops.
--
-- Proves: admin-only, switch off blocks apply, typed confirm required,
-- no notification_outbox rows even when an admin applies (the trigger is
-- live: a normal admin-made task does enqueue), subtasks link to parents,
-- unknown users go to the fallback, missing clients skip, a second run of
-- the same plan creates nothing (idempotent), undo rolls the batch back.
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
create or replace function pg_temp.task(p_gid text) returns staff_reminders language sql as $$
  select * from staff_reminders where source = 'asana' and source_ref = p_gid
$$;

-- People: a1, a2 = active admins (a2 is the fallback); bk1 = active bookkeeper.
insert into t_ctx select 'a1', lower(email) from staff where active and role = 'admin' order by email limit 1;
insert into t_ctx select 'a2', lower(email) from staff where active and role = 'admin' order by email offset 1 limit 1;
insert into t_ctx select 'bk1', lower(email) from staff where active and role = 'bookkeeper' order by email limit 1;
select pg_temp.ok(pg_temp.ctx('a1') is not null and pg_temp.ctx('a2') is not null and pg_temp.ctx('bk1') is not null, 'test people found');
select pg_temp.ok(exists (select 1 from clients where id = 'basic-test' and test_only), 'test client basic-test exists');
select pg_temp.ok(public.tk_schema_version() = 9, 'schema version 9');
select pg_temp.ok(not exists (select 1 from tk_settings where key = 'asana_import_apply_enabled' and value = 'true'::jsonb),
                  'apply switch is not on in the live data');
select pg_temp.ok(not exists (select 1 from staff_reminders where source_ref like 's8-test-%'), 'no leftover test gids');

-- The synthetic plan (same shape buildDryRun.js --stage-json writes).
insert into t_ctx values ('rows', jsonb_build_array(
  jsonb_build_object('kind', 'project', 'asana_gid', 's8-test-p1', 'payload', jsonb_build_object(
    'name', 'S8 test internal project', 'kind', 'internal', 'client_id', null,
    'sections', jsonb_build_array('Now', 'Later'), 'members', jsonb_build_array(pg_temp.ctx('bk1')), 'owner_email', pg_temp.ctx('bk1'))),
  jsonb_build_object('kind', 'task', 'asana_gid', 's8-test-t1', 'payload', jsonb_build_object(
    'title', 'S8 test client task', 'description', 'Imported from Asana: https://app.asana.com/0/0/s8-test-t1',
    'client_id', 'basic-test', 'project_gid', null, 'parent_gid', null, 'section', 'Monthly',
    'due_date', ((now() at time zone 'America/Chicago')::date + 5)::text, 'status', 'in_progress', 'priority', 'normal',
    'visibility', 'shared', 'assignee_email', pg_temp.ctx('bk1'))),
  jsonb_build_object('kind', 'task', 'asana_gid', 's8-test-t2', 'payload', jsonb_build_object(
    'title', 'S8 test subtask, unknown Asana user', 'client_id', 'basic-test', 'parent_gid', 's8-test-t1',
    'status', 'todo', 'assignee_email', 'nobody@example.invalid')),
  jsonb_build_object('kind', 'task', 'asana_gid', 's8-test-t3', 'payload', jsonb_build_object(
    'title', 'S8 test internal project task', 'client_id', null, 'project_gid', 's8-test-p1', 'section', 'Now',
    'status', 'todo', 'visibility', 'shared', 'assignee_email', pg_temp.ctx('bk1'))),
  jsonb_build_object('kind', 'task', 'asana_gid', 's8-test-t4', 'payload', jsonb_build_object(
    'title', 'S8 test task for a client that does not exist', 'client_id', 's8-no-such-client',
    'status', 'todo', 'assignee_email', pg_temp.ctx('bk1'))),
  jsonb_build_object('kind', 'template', 'asana_gid', 's8-test-t1', 'payload', jsonb_build_object(
    'title', 'S8 test client task', 'cadence', 'monthly', 'client_id', 'basic-test',
    'checklist', jsonb_build_array('S8 test subtask, unknown Asana user')))
)::text);

-- 1. Who may stage and apply
select pg_temp.as_user(pg_temp.ctx('bk1'));
select pg_temp.expect_err($$select public.tk_import_asana_stage(now(), '{}'::jsonb, pg_temp.ctx('rows')::jsonb)$$,
                          'tk_forbidden', 'a bookkeeper cannot stage');
select pg_temp.as_user(pg_temp.ctx('a1'));
insert into t_ctx select 'run1', public.tk_import_asana_stage(now(), '{"test": true}'::jsonb, pg_temp.ctx('rows')::jsonb)::text;
select pg_temp.ok((select status from tk_import_runs where id = pg_temp.id('run1')) = 'planned', 'admin staged a planned run');
select pg_temp.ok((select count(*) from tk_import_plan_rows where run_id = pg_temp.id('run1')) = 6, 'six plan rows staged');
select pg_temp.ok(not exists (select 1 from staff_reminders where source = 'asana' and source_ref like 's8-test-%'),
                  'staging creates no tasks');

-- 2. The switch, the confirm, the fallback
insert into t_ctx values ('confirm1', 'IMPORT ' || left(pg_temp.ctx('run1'), 8));
select pg_temp.expect_err($$select public.tk_import_asana_apply(pg_temp.id('run1'), pg_temp.ctx('confirm1'), pg_temp.ctx('a2'))$$,
                          'tk_import_disabled', 'apply refused while the switch is missing');
select pg_temp.as_user(null);
insert into tk_settings (key, value) values ('asana_import_apply_enabled', 'false'::jsonb)
  on conflict (key) do update set value = 'false'::jsonb;
select pg_temp.as_user(pg_temp.ctx('a1'));
select pg_temp.expect_err($$select public.tk_import_asana_apply(pg_temp.id('run1'), pg_temp.ctx('confirm1'), pg_temp.ctx('a2'))$$,
                          'tk_import_disabled', 'apply refused while the switch is false');
select pg_temp.as_user(null);
update tk_settings set value = 'true'::jsonb where key = 'asana_import_apply_enabled';
select pg_temp.as_user(pg_temp.ctx('a1'));
select pg_temp.expect_err($$select public.tk_import_asana_apply(pg_temp.id('run1'), 'IMPORT', pg_temp.ctx('a2'))$$,
                          'tk_import_confirm', 'wrong confirm text refused');
select pg_temp.expect_err($$select public.tk_import_asana_apply(pg_temp.id('run1'), pg_temp.ctx('confirm1'), 'nobody@example.invalid')$$,
                          'tk_import_fallback', 'fallback must be active staff');
select pg_temp.as_user(pg_temp.ctx('bk1'));
select pg_temp.expect_err($$select public.tk_import_asana_apply(pg_temp.id('run1'), pg_temp.ctx('confirm1'), pg_temp.ctx('a2'))$$,
                          'tk_forbidden', 'a bookkeeper cannot apply');
select pg_temp.as_user(pg_temp.ctx('bk1'));
select pg_temp.expect_err($$select public.tk_import_asana_undo(pg_temp.id('run1'), 'UNDO ' || left(pg_temp.ctx('run1'), 8))$$,
                          'tk_forbidden', 'a bookkeeper cannot undo');

-- 3. Apply as an admin: rows created, no email
select pg_temp.as_user(pg_temp.ctx('a1'));
insert into t_ctx values ('outbox0', pg_temp.outbox()::text);
insert into t_ctx select 'res1', public.tk_import_asana_apply(pg_temp.id('run1'), pg_temp.ctx('confirm1'), pg_temp.ctx('a2'))::text;
select pg_temp.ok((pg_temp.ctx('res1')::jsonb ->> 'tasks_created')::int = 3, 'three tasks created');
select pg_temp.ok((pg_temp.ctx('res1')::jsonb ->> 'projects_created')::int = 1, 'one project created');
select pg_temp.ok((pg_temp.ctx('res1')::jsonb ->> 'templates_created')::int = 1, 'one draft template created');
select pg_temp.ok((pg_temp.ctx('res1')::jsonb ->> 'skipped')::int = 1, 'the missing-client task skipped');
select pg_temp.ok(pg_temp.outbox() = pg_temp.ctx('outbox0')::bigint, 'the import queued no email');
select pg_temp.ok((select status from tk_import_runs where id = pg_temp.id('run1')) = 'applied', 'run marked applied');

select pg_temp.ok((pg_temp.task('s8-test-t1')).assignee_email = pg_temp.ctx('bk1')
                  and (pg_temp.task('s8-test-t1')).client_id = 'basic-test'
                  and (pg_temp.task('s8-test-t1')).status = 'in_progress'
                  and (pg_temp.task('s8-test-t1')).visibility = 'shared', 'client task mapped');
select pg_temp.ok((pg_temp.task('s8-test-t2')).parent_id = (pg_temp.task('s8-test-t1')).id, 'subtask linked to its parent');
select pg_temp.ok(lower((pg_temp.task('s8-test-t2')).staff_email) = pg_temp.ctx('a2')
                  and (pg_temp.task('s8-test-t2')).assignee_email = pg_temp.ctx('a2'), 'unknown Asana user went to the fallback');
select pg_temp.ok((pg_temp.task('s8-test-t3')).project_id = (select local_id::uuid from tk_asana_import_map where kind = 'project' and asana_gid = 's8-test-p1'),
                  'project task linked to the imported project');
select pg_temp.ok((pg_temp.task('s8-test-t4')).id is null, 'missing-client task not created');
select pg_temp.ok((select status from tk_asana_import_map where kind = 'task' and asana_gid = 's8-test-t4') = 'skipped', 'skip recorded in the map');
select pg_temp.ok(exists (select 1 from tk_project_members m join tk_asana_import_map x on x.local_id = m.project_id::text
                           where x.asana_gid = 's8-test-p1' and m.staff_email = pg_temp.ctx('bk1') and m.role = 'owner'),
                  'project owner is a member');
select pg_temp.ok((select status = 'draft' and not active and client_ids = array['basic-test'] and cardinality(checklist) = 1
                     from task_templates where source = 'asana' and source_ref = 's8-test-t1'), 'draft template is inactive');
select pg_temp.ok((select count(*) from tk_asana_import_map where run_id = pg_temp.id('run1')) = 6, 'every gid tagged with the run id');
select pg_temp.ok(exists (select 1 from tk_activity a where a.task_id = (pg_temp.task('s8-test-t1')).id
                            and a.kind = 'created' and a.actor_email = 'asana-import'), 'activity says asana-import');

-- 4. Idempotent: the same run cannot apply twice; a new run of the same plan creates nothing
select pg_temp.expect_err($$select public.tk_import_asana_apply(pg_temp.id('run1'), pg_temp.ctx('confirm1'), pg_temp.ctx('a2'))$$,
                          'tk_import_bad_run', 'an applied run cannot apply again');
insert into t_ctx select 'run2', public.tk_import_asana_stage(now(), '{}'::jsonb, pg_temp.ctx('rows')::jsonb)::text;
insert into t_ctx select 'res2', public.tk_import_asana_apply(pg_temp.id('run2'), 'IMPORT ' || left(pg_temp.ctx('run2'), 8), pg_temp.ctx('a2'))::text;
select pg_temp.ok((pg_temp.ctx('res2')::jsonb ->> 'tasks_created')::int = 0
                  and (pg_temp.ctx('res2')::jsonb ->> 'projects_created')::int = 0
                  and (pg_temp.ctx('res2')::jsonb ->> 'templates_created')::int = 0
                  and (pg_temp.ctx('res2')::jsonb ->> 'already_imported')::int = 6, 'second run of the same plan created nothing');
select pg_temp.ok((select count(*) from staff_reminders where source = 'asana' and source_ref like 's8-test-%') = 3, 'still exactly three imported tasks');
select pg_temp.ok(pg_temp.outbox() = pg_temp.ctx('outbox0')::bigint, 'second run queued no email');

-- 5. The suppression is the import flag, not a dead trigger: a normal admin-made task does enqueue
insert into staff_reminders (staff_email, assignee_email, text, kind, visibility)
values (pg_temp.ctx('a1'), pg_temp.ctx('bk1'), 'S8 test control task', 'task', 'private');
select pg_temp.ok(pg_temp.outbox() = pg_temp.ctx('outbox0')::bigint + 1, 'control: a normal assignment still emails');
insert into t_ctx values ('outbox1', pg_temp.outbox()::text);

-- 6. Undo (rollback of the batch)
select pg_temp.expect_err($$select public.tk_import_asana_undo(pg_temp.id('run1'), 'UNDO')$$, 'tk_import_confirm', 'undo needs the typed confirm');
select pg_temp.as_user(null);
update tk_settings set value = 'false'::jsonb where key = 'asana_import_apply_enabled';
select pg_temp.as_user(pg_temp.ctx('a1'));
insert into t_ctx select 'undo1', public.tk_import_asana_undo(pg_temp.id('run1'), 'UNDO ' || left(pg_temp.ctx('run1'), 8))::text;
select pg_temp.ok((pg_temp.ctx('undo1')::jsonb ->> 'tasks_deleted')::int = 3
                  and (pg_temp.ctx('undo1')::jsonb ->> 'projects_archived')::int = 1
                  and (pg_temp.ctx('undo1')::jsonb ->> 'templates_retired')::int = 1, 'undo works with the switch off');
select pg_temp.ok(not exists (select 1 from staff_reminders where source = 'asana' and source_ref like 's8-test-%' and deleted_at is null),
                  'imported tasks are soft-deleted');
select pg_temp.ok((select archived_at is not null from tk_projects where id = (select local_id::uuid from tk_asana_import_map where kind = 'project' and asana_gid = 's8-test-p1')),
                  'imported project archived');
select pg_temp.ok((select status = 'retired' and not active from task_templates where source = 'asana' and source_ref = 's8-test-t1'), 'draft template retired');
select pg_temp.ok(not exists (select 1 from tk_asana_import_map where run_id = pg_temp.id('run1') and status in ('created', 'merged')), 'map rows marked undone');
select pg_temp.ok((select status from tk_import_runs where id = pg_temp.id('run1')) = 'undone', 'run marked undone');
select pg_temp.ok(pg_temp.outbox() = pg_temp.ctx('outbox1')::bigint, 'undo queued no email');
select pg_temp.expect_err($$select public.tk_import_asana_undo(pg_temp.id('run1'), 'UNDO ' || left(pg_temp.ctx('run1'), 8))$$,
                          'tk_import_bad_run', 'a run undoes once');

-- 7. Nobody writes the import tables directly (as the API role, with an admin JWT)
set local role authenticated;
select pg_temp.expect_err($$insert into tk_import_runs (status) values ('planned')$$, 'permission denied', 'no direct insert into tk_import_runs');
select pg_temp.expect_err($$delete from tk_asana_import_map$$, 'permission denied', 'no direct delete from tk_asana_import_map');
select pg_temp.ok((select count(*) from tk_import_runs) >= 2, 'an admin can read the runs');
reset role;

select 'S8 self-test: all checks passed' as result;
rollback;
