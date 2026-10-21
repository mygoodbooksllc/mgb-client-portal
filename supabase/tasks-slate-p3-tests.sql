-- =====================================================================
-- Self-test for tasks-slate-p3-views-bulk.sql (named saved views, bulk
-- Status / Priority / Section and their undo).
--
-- Run it whole after the migration. It ends in ROLLBACK, so nothing it
-- writes is kept. People are picked at run time; no names or emails live
-- in this file. A failed check raises; a run with no error is a pass.
-- =====================================================================
begin;

create temp table t_ctx (k text primary key, v text) on commit drop;
create or replace function pg_temp.ctx(p_k text) returns text language sql as $$ select v from t_ctx where k = p_k $$;
create or replace function pg_temp.id(p_k text) returns uuid language sql as $$ select v::uuid from t_ctx where k = p_k $$;
create or replace function pg_temp.res(p_k text) returns jsonb language sql as $$ select v::jsonb from t_ctx where k = p_k $$;
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
create or replace function pg_temp.reason(p_res text, p_task text) returns text language sql as $$
  select coalesce((select e ->> 'reason' from jsonb_array_elements(pg_temp.res(p_res) -> 'skipped') e
                    where e ->> 'id' = pg_temp.ctx(p_task)), '')
$$;
create or replace function pg_temp.has(p_res text, p_task text) returns boolean language sql as $$
  select coalesce(pg_temp.res(p_res) -> 'done' ? pg_temp.ctx(p_task), false)
$$;
create or replace function pg_temp.task(p_k text) returns staff_reminders language sql as $$
  select * from staff_reminders where id = pg_temp.id(p_k)
$$;
-- a new task owned by p_owner (a t_ctx key), optionally in a project
create or replace function pg_temp.mk(p_k text, p_owner text, p_project text default null, p_review boolean default false)
returns void language plpgsql as $$
declare v uuid;
begin
  perform pg_temp.as_user(pg_temp.ctx(p_owner));
  insert into staff_reminders (staff_email, text, client_id, visibility, review_required, recurrence, project_id)
  values (pg_temp.ctx(p_owner), 'P3 self-test ' || p_k, 'basic-test', 'shared', p_review, 'none', case when p_project is null then null else pg_temp.id(p_project) end)
  returning id into v;
  insert into t_ctx values (p_k, v::text);
  perform pg_temp.as_user(null);
end $$;

-- 0. Shape -------------------------------------------------------------------
select pg_temp.ok(not has_table_privilege('anon', 'public.tk_saved_views', 'select')
              and not has_table_privilege('anon', 'public.tk_saved_views', 'insert')
              and has_table_privilege('authenticated', 'public.tk_saved_views', 'select')
              and not has_table_privilege('authenticated', 'public.tk_saved_views', 'truncate')
              and (select relrowsecurity from pg_class where oid = 'public.tk_saved_views'::regclass),
                  'saved views: RLS on, anon has nothing, authenticated cannot truncate');
select pg_temp.ok((select count(*) from pg_policies where tablename = 'tk_saved_views' and schemaname = 'public') = 4,
                  'saved views: four policies');
select pg_temp.ok(not has_table_privilege('authenticated', 'public.tk_field_ops', 'select')
              and not has_table_privilege('anon', 'public.tk_field_ops', 'select')
              and (select relrowsecurity from pg_class where oid = 'public.tk_field_ops'::regclass),
                  'field undo log: RLS on, no table access for the app');
select pg_temp.ok(not has_function_privilege('anon', 'public.tk_bulk_set(uuid[],jsonb,date)', 'execute')
              and not has_function_privilege('anon', 'public.tk_undo_fields(uuid)', 'execute')
              and has_function_privilege('authenticated', 'public.tk_bulk_set(uuid[],jsonb,date)', 'execute')
              and has_function_privilege('authenticated', 'public.tk_undo_fields(uuid)', 'execute'),
                  'no anon execute; staff can call tk_bulk_set and tk_undo_fields');

-- People: a1 = basic-test's account manager (an admin), a2 = another admin
insert into t_ctx select 'a1', lower(c.account_manager_email) from clients c where c.id = 'basic-test';
insert into t_ctx select 'a2', lower(s.email) from staff s
 where s.active and s.role = 'admin' and lower(s.email) <> pg_temp.ctx('a1') order by s.email limit 1;
insert into t_ctx select 'bk', lower(s.email) from staff s where s.active and s.role = 'bookkeeper' order by s.email limit 1;
select pg_temp.ok(pg_temp.ctx('a1') is not null and pg_temp.ctx('a2') is not null and pg_temp.ctx('bk') is not null, 'test people found');

-- 1. Saved views (RLS exercised as the real app role) ---------------------------
select pg_temp.as_user(pg_temp.ctx('a1'));
insert into tk_saved_views (scope, name, view, position)
  values ('slate', 'Mine due soon', '{"groupBy":"due","sort":null,"chip":"all"}', 1);
-- a client-supplied owner is ignored: the row belongs to the caller
insert into tk_saved_views (owner_email, scope, name, view, position)
  values (pg_temp.ctx('a2'), 'slate', ' Waiting  on clients ', '{"groupBy":"status","sort":null,"chip":"all"}', 2);
select pg_temp.ok((select count(*) from tk_saved_views where owner_email = pg_temp.ctx('a1') and scope = 'slate') = 2
              and (select count(*) from tk_saved_views where owner_email = pg_temp.ctx('a2')) = 0
              and exists (select 1 from tk_saved_views where name = 'Waiting on clients'),
                  'owner is stamped from the JWT; name is trimmed and single-spaced');
select pg_temp.expect_err($$insert into tk_saved_views (scope, name, view) values ('slate', 'MINE DUE SOON', '{}')$$,
                          'tk_saved_views_owner_scope_name_uq', 'a name repeats case-insensitively: refused');
select pg_temp.expect_err($$insert into tk_saved_views (scope, name, view) values ('slate', ' default ', '{}')$$,
                          'tk_name_reserved', '"Default" is reserved');
select pg_temp.expect_err($$insert into tk_saved_views (scope, name, view) values ('slate', '', '{}')$$,
                          'tk_saved_views_name_check', 'empty name refused');
select pg_temp.expect_err($$insert into tk_saved_views (scope, name, view) values ('slate', repeat('x', 61), '{}')$$,
                          'tk_saved_views_name_check', '61-character name refused');
select pg_temp.expect_err($$insert into tk_saved_views (scope, name, view) values ('slate', 'Array view', '[]')$$,
                          'tk_saved_views_view_check', 'a view must be a JSON object');
select pg_temp.expect_err($$insert into tk_saved_views (scope, name, view) values ('Bad Scope', 'x', '{}')$$,
                          'tk_saved_views_scope_check', 'scope shape enforced');
-- the cap: 30 per scope (2 exist)
insert into tk_saved_views (scope, name, view) select 'slate', 'Cap ' || g, '{}' from generate_series(1, 28) g;
select pg_temp.expect_err($$insert into tk_saved_views (scope, name, view) values ('slate', 'One too many', '{}')$$,
                          'tk_too_many_views', 'the 31st view in a scope is refused');
insert into tk_saved_views (scope, name, view) values ('desk', 'Other scope is separate', '{}');
select pg_temp.ok((select count(*) from tk_saved_views where scope = 'desk') = 1, 'the cap is per scope');
-- rename keeps the owner; the owner and scope never move
update tk_saved_views set name = 'Renamed', scope = 'desk', owner_email = pg_temp.ctx('a2') where name = 'Mine due soon';
select pg_temp.ok((select owner_email = pg_temp.ctx('a1') and scope = 'slate' and updated_at >= created_at
                     from tk_saved_views where name = 'Renamed'), 'update cannot move a view to another owner or scope');
select pg_temp.as_user(null);

-- a second person sees none of it and cannot change or delete it
select pg_temp.as_user(pg_temp.ctx('a2'));
insert into tk_saved_views (scope, name, view) values ('slate', 'Renamed', '{"groupBy":"none"}');   -- same name, other person: allowed
select pg_temp.ok((select count(*) from tk_saved_views where owner_email = pg_temp.ctx('a2')) = 1, 'the same name is fine for another person');
select pg_temp.as_user(null);

do $$
declare
  v_a2 text := pg_temp.ctx('a2');
  v_n bigint;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'email', v_a2, 'role', 'authenticated',
                     'app_metadata', json_build_object('provider', 'google'))::text, true);
  set local role authenticated;
  select count(*) into v_n from public.tk_saved_views;
  if v_n <> 1 then raise exception 'SELF-TEST FAILED: another person reads % saved views (expected only their own 1)', v_n; end if;
  update public.tk_saved_views set name = 'Hijack' where name <> 'Renamed';
  get diagnostics v_n = row_count;
  if v_n <> 0 then raise exception 'SELF-TEST FAILED: updated someone else''s view'; end if;
  delete from public.tk_saved_views where owner_email <> v_a2;
  get diagnostics v_n = row_count;
  if v_n <> 0 then raise exception 'SELF-TEST FAILED: deleted someone else''s view'; end if;
  begin
    insert into public.tk_saved_views (owner_email, scope, name, view) values ('someone.else@example.invalid', 'slate', 'Forged', '{}');
    if exists (select 1 from public.tk_saved_views where name = 'Forged' and owner_email <> v_a2) then
      raise exception 'SELF-TEST FAILED: forged owner kept';
    end if;
  end;
  reset role;
  raise notice 'ok: another person cannot read, update, delete or forge views';
end $$;

-- anon reads nothing (no grant at all)
do $$
declare v_ok boolean := false;
begin
  perform set_config('request.jwt.claims', '', true);
  set local role anon;
  begin
    perform count(*) from public.tk_saved_views;
  exception when insufficient_privilege then v_ok := true;
  end;
  reset role;
  if not v_ok then raise exception 'SELF-TEST FAILED: anon could read tk_saved_views'; end if;
  raise notice 'ok: anon cannot read saved views';
end $$;

-- delete own
select pg_temp.as_user(pg_temp.ctx('a1'));
delete from tk_saved_views where name = 'Renamed' and owner_email = pg_temp.ctx('a1');
select pg_temp.ok(not exists (select 1 from tk_saved_views where name = 'Renamed' and owner_email = pg_temp.ctx('a1')), 'owner deletes their own view');
select pg_temp.as_user(null);

-- 2. Bulk setup ----------------------------------------------------------------
select pg_temp.as_user(pg_temp.ctx('a1'));
with p as (insert into tk_projects (name, kind, client_id, owner_email, sections)
           values ('P3 self-test', 'onboarding', 'basic-test', pg_temp.ctx('a1'), array['Alpha', 'Beta']) returning id)
insert into t_ctx select 'proj', id::text from p;
with p as (insert into tk_projects (name, kind, client_id, owner_email, sections)
           values ('P3 self-test two', 'onboarding', 'basic-test', pg_temp.ctx('a1'), array['Gamma']) returning id)
insert into t_ctx select 'proj2', id::text from p;
select pg_temp.as_user(null);

select pg_temp.mk('p1', 'a1', 'proj');
select pg_temp.mk('p2', 'a1', 'proj');
select pg_temp.mk('p3', 'a1', 'proj');
select pg_temp.mk('q1', 'a1', 'proj2');
select pg_temp.mk('n1', 'a1');                    -- no project
select pg_temp.mk('rv', 'a1', null, true);        -- review required
select pg_temp.mk('dn', 'a1');                    -- will be done
insert into t_ctx values ('ghost', gen_random_uuid()::text);
-- a task of the other admin that is private: a1 cannot reach it
select pg_temp.as_user(pg_temp.ctx('a2'));
insert into staff_reminders (staff_email, text, visibility) values (pg_temp.ctx('a2'), 'P3 self-test private', 'private')
  returning id;
select pg_temp.as_user(null);
insert into t_ctx select 'priv', id::text from staff_reminders where text = 'P3 self-test private' and lower(staff_email) = pg_temp.ctx('a2');

select pg_temp.as_user(pg_temp.ctx('a1'));
select public.complete_staff_item(pg_temp.id('rv'), true, null);          -- goes to ready_for_review
select public.complete_staff_item(pg_temp.id('dn'), true, null);          -- done
select pg_temp.as_user(null);
select pg_temp.ok((pg_temp.task('p1')).status = 'todo' and (pg_temp.task('p1')).priority = 'normal'
              and (pg_temp.task('rv')).status = 'ready_for_review' and (pg_temp.task('dn')).status = 'done',
                  'setup: new tasks are todo/normal; one in review, one done');

-- 3. Bad patches and signed-out -------------------------------------------------
select pg_temp.as_user(pg_temp.ctx('a1'));
select pg_temp.expect_err($$select public.tk_bulk_set(array[gen_random_uuid()], '{"status":"done"}')$$, 'tk_bad_patch', 'done is not a bulk status here');
select pg_temp.expect_err($$select public.tk_bulk_set(array[gen_random_uuid()], '{"status":"ready_for_review"}')$$, 'tk_bad_patch', 'ready_for_review is not bulk');
select pg_temp.expect_err($$select public.tk_bulk_set(array[gen_random_uuid()], '{"priority":"urgent"}')$$, 'tk_bad_patch', 'unknown priority refused');
select pg_temp.expect_err($$select public.tk_bulk_set(array[gen_random_uuid()], '{"priority":"high","status":"todo"}')$$, 'tk_bad_patch', 'two keys refused');
select pg_temp.expect_err($$select public.tk_bulk_set(array[gen_random_uuid()], '{}')$$, 'tk_bad_patch', 'empty patch refused');
select pg_temp.expect_err($$select public.tk_bulk_set(array[gen_random_uuid()], '{"section":5}')$$, 'tk_bad_patch', 'section must be text or null');
select pg_temp.expect_err($$select public.tk_bulk_set(array[gen_random_uuid()], '{"due_date":"2026-11-01"}')$$, 'tk_bad_patch', 'unknown key refused');
select pg_temp.expect_err($$select public.tk_bulk_set(array(select gen_random_uuid() from generate_series(1, 101)), '{"priority":"low"}')$$, 'tk_too_many', '101 ids refused');
select pg_temp.as_user(null);
select pg_temp.expect_err($$select public.tk_bulk_set(array[gen_random_uuid()], '{"priority":"low"}')$$, 'tk_forbidden', 'needs a signed-in staff member');

-- 4. Priority --------------------------------------------------------------------
select pg_temp.as_user(pg_temp.ctx('a1'));
update staff_reminders set priority = 'high' where id = pg_temp.id('p3');
insert into t_ctx select 'r1', public.tk_bulk_set(array[pg_temp.id('p1'), pg_temp.id('p2'), pg_temp.id('p3'), pg_temp.id('priv'), pg_temp.id('ghost')], '{"priority":"high"}')::text;
select pg_temp.ok(pg_temp.has('r1', 'p1') and pg_temp.has('r1', 'p2') and (pg_temp.task('p1')).priority = 'high' and (pg_temp.task('p2')).priority = 'high',
                  'priority: two tasks set to high');
select pg_temp.ok(pg_temp.reason('r1', 'p3') = 'no_change' and pg_temp.has('r1', 'priv') and pg_temp.reason('r1', 'ghost') = 'no_access',
                  'priority: already-high is no_change; an admin reaches another person''s private task; an unknown id is no_access');
select pg_temp.ok((pg_temp.res('r1') ->> 'kind') = 'set_priority' and (pg_temp.res('r1') ->> 'op_id') is not null, 'priority: kind and op id returned');
insert into t_ctx select 'u1', public.tk_undo_fields((pg_temp.res('r1') ->> 'op_id')::uuid)::text;
select pg_temp.ok((pg_temp.task('p1')).priority = 'normal' and (pg_temp.task('p2')).priority = 'normal' and (pg_temp.task('p3')).priority = 'high'
              and pg_temp.has('u1', 'p1') and pg_temp.has('u1', 'p2'),
                  'priority undo restores each task to what it was');
select pg_temp.expect_err(format($$select public.tk_undo_fields(%L)$$, pg_temp.res('r1') ->> 'op_id'), 'tk_undo_used', 'undo works once');
-- a bookkeeper cannot reach another person's private task
select pg_temp.as_user(pg_temp.ctx('bk'));
insert into t_ctx select 'rb', public.tk_bulk_set(array[pg_temp.id('priv')], '{"priority":"high"}')::text;
select pg_temp.ok(pg_temp.reason('rb', 'priv') = 'no_access' and (pg_temp.task('priv')).priority = 'normal', 'priority: a non-owner non-admin gets no_access on a private task');
select pg_temp.as_user(pg_temp.ctx('a1'));
-- changed since: someone edits after the bulk set
insert into t_ctx select 'r2', public.tk_bulk_set(array[pg_temp.id('p1'), pg_temp.id('p2')], '{"priority":"low"}')::text;
update staff_reminders set priority = 'high' where id = pg_temp.id('p2');
insert into t_ctx select 'u2', public.tk_undo_fields((pg_temp.res('r2') ->> 'op_id')::uuid)::text;
select pg_temp.ok((pg_temp.task('p1')).priority = 'normal' and pg_temp.reason('u2', 'p2') = 'changed_since' and (pg_temp.task('p2')).priority = 'high',
                  'priority undo skips a task changed since (changed_since) and restores the rest');
select pg_temp.as_user(null);
-- someone else's op, and an expired op
select pg_temp.as_user(pg_temp.ctx('a1'));
insert into t_ctx select 'r3', public.tk_bulk_set(array[pg_temp.id('p1')], '{"priority":"low"}')::text;
select pg_temp.as_user(pg_temp.ctx('a2'));
select pg_temp.expect_err(format($$select public.tk_undo_fields(%L)$$, pg_temp.res('r3') ->> 'op_id'), 'tk_not_found', 'another person cannot undo it');
select pg_temp.as_user(null);
update tk_field_ops set expires_at = now() - interval '1 minute' where id = (pg_temp.res('r3') ->> 'op_id')::uuid;
select pg_temp.as_user(pg_temp.ctx('a1'));
select pg_temp.expect_err(format($$select public.tk_undo_fields(%L)$$, pg_temp.res('r3') ->> 'op_id'), 'tk_undo_expired', 'an old undo is refused');
select pg_temp.as_user(null);

-- 5. Status ----------------------------------------------------------------------
select pg_temp.as_user(pg_temp.ctx('a1'));
insert into t_ctx select 's1', public.tk_bulk_set(array[pg_temp.id('p1'), pg_temp.id('p2'), pg_temp.id('rv'), pg_temp.id('dn')], '{"status":"in_progress"}')::text;
select pg_temp.ok(pg_temp.has('s1', 'p1') and pg_temp.has('s1', 'p2') and (pg_temp.task('p1')).status = 'in_progress',
                  'status: tasks move to in_progress');
select pg_temp.ok(pg_temp.reason('s1', 'rv') = 'in_review' and pg_temp.reason('s1', 'dn') = 'done_use_reopen'
              and (pg_temp.task('rv')).status = 'ready_for_review' and (pg_temp.task('dn')).status = 'done',
                  'status: a task in review and a done task are skipped with their reasons and untouched');
insert into t_ctx select 's2', public.tk_bulk_set(array[pg_temp.id('p1')], '{"status":"in_progress"}')::text;
select pg_temp.ok(pg_temp.reason('s2', 'p1') = 'no_change' and (pg_temp.res('s2') ->> 'op_id') is null, 'status: same status is no_change and logs no op');
insert into t_ctx select 's3', public.tk_bulk_set(array[pg_temp.id('p1')], '{"status":"waiting_client"}')::text;
select pg_temp.ok((pg_temp.task('p1')).status = 'waiting_client', 'status: waiting_client');
insert into t_ctx select 'su3', public.tk_undo_fields((pg_temp.res('s3') ->> 'op_id')::uuid)::text;
select pg_temp.ok((pg_temp.task('p1')).status = 'in_progress', 'status undo restores the earlier status');
insert into t_ctx select 'su1', public.tk_undo_fields((pg_temp.res('s1') ->> 'op_id')::uuid)::text;
select pg_temp.ok((pg_temp.task('p1')).status = 'todo' and (pg_temp.task('p2')).status = 'todo', 'status undo of the first run: back to todo');
select pg_temp.as_user(null);

-- 6. Section ---------------------------------------------------------------------
select pg_temp.as_user(pg_temp.ctx('a1'));
insert into t_ctx select 'c1', public.tk_bulk_set(array[pg_temp.id('p1'), pg_temp.id('p2'), pg_temp.id('q1'), pg_temp.id('n1')], '{"section":"alpha"}')::text;
select pg_temp.ok(pg_temp.has('c1', 'p1') and pg_temp.has('c1', 'p2') and (pg_temp.task('p1')).section = 'Alpha',
                  'section: matched without regard to case and stored as the project spells it');
select pg_temp.ok(pg_temp.reason('c1', 'q1') = 'section_missing' and pg_temp.reason('c1', 'n1') = 'no_project'
              and (pg_temp.task('q1')).section is null and (pg_temp.task('n1')).section is null,
                  'section: a project without it is section_missing; no project is no_project');
insert into t_ctx select 'c2', public.tk_bulk_set(array[pg_temp.id('p1'), pg_temp.id('p3')], '{"section":"Alpha"}')::text;
select pg_temp.ok(pg_temp.reason('c2', 'p1') = 'no_change' and pg_temp.has('c2', 'p3'), 'section: already there is no_change');
insert into t_ctx select 'c3', public.tk_bulk_set(array[pg_temp.id('p1'), pg_temp.id('n1')], '{"section":null}')::text;
select pg_temp.ok(pg_temp.has('c3', 'p1') and (pg_temp.task('p1')).section is null and pg_temp.reason('c3', 'n1') = 'no_change',
                  'section: null clears (any project); nothing to clear is no_change');
insert into t_ctx select 'cu3', public.tk_undo_fields((pg_temp.res('c3') ->> 'op_id')::uuid)::text;
select pg_temp.ok((pg_temp.task('p1')).section = 'Alpha', 'section undo puts the cleared section back');
insert into t_ctx select 'cu1', public.tk_undo_fields((pg_temp.res('c1') ->> 'op_id')::uuid)::text;
select pg_temp.ok((pg_temp.task('p2')).section is null, 'section undo: p2 restored to no section');
select pg_temp.as_user(null);

select 'P3 self-test passed' as result;
rollback;
