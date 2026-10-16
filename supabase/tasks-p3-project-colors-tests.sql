-- =====================================================================
-- Self-test for tasks-p3-project-colors.sql.
--
-- Run it whole; it ends in ROLLBACK, so nothing it writes is kept and no
-- email is sent. It flips no switch. People are picked at run time; no names
-- or emails live here. A failed check raises.
--
-- Proves: every project has a valid color (the column is NOT NULL with a
-- palette check); a new project gets the least-used live color (a valid
-- color sent with the insert is kept, a bad one is replaced); a direct UPDATE
-- of the color is ignored; tk_project_set_color works for an admin and for the
-- project's owner, is refused for a stranger, an anonymous caller and an
-- unknown color, writes one audit row per real change and none for a no-op,
-- is refused on a trashed project; the admin list returns the color; anon
-- cannot execute the RPCs; no email.
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
create or replace function pg_temp.audit_n(p_action text, p_target uuid) returns bigint language sql as $$
  select count(*) from audit_log where action = p_action and target_id = p_target::text
$$;
create or replace function pg_temp.mkproj(p_key text, p_name text, p_as text, p_color text default null) returns uuid language plpgsql as $$
declare v uuid;
begin
  perform pg_temp.as_user(p_as);
  if p_color is null then
    insert into tk_projects (name, kind) values (p_name, 'internal') returning id into v;
  else
    insert into tk_projects (name, kind, color) values (p_name, 'internal', p_color) returning id into v;
  end if;
  perform pg_temp.as_user(null);
  insert into t_ctx values (p_key, v::text);
  return v;
end $$;
create or replace function pg_temp.color_of(p_key text) returns text language sql as $$
  select color from tk_projects where id = pg_temp.id(p_key)
$$;

-- People: a1 admin; bk1 (project owner), bk2 (stranger) bookkeepers.
insert into t_ctx select 'a1', lower(email) from staff where active and role = 'admin' order by email limit 1;
insert into t_ctx select 'bk1', lower(email) from staff where active and role = 'bookkeeper' order by email limit 1;
insert into t_ctx select 'bk2', lower(email) from staff where active and role = 'bookkeeper' order by email offset 1 limit 1;
select pg_temp.ok(pg_temp.ctx('a1') is not null and pg_temp.ctx('bk1') is not null and pg_temp.ctx('bk2') is not null, 'test people found');
insert into t_ctx values ('outbox0', pg_temp.outbox()::text);

-- 1. The column --------------------------------------------------------------------
select pg_temp.ok(not exists (select 1 from tk_projects where color is null), 'every project has a color');
select pg_temp.ok(not exists (select 1 from tk_projects where color <> all (array['blue','teal','green','amber','coral','pink','purple','navy','olive','gray'])),
                  'every color is in the palette');
select pg_temp.ok((select is_nullable = 'NO' from information_schema.columns where table_schema = 'public' and table_name = 'tk_projects' and column_name = 'color'),
                  'the column is NOT NULL');
-- (the guard trigger would swallow a plain UPDATE first, so open its door for this one statement)
select pg_temp.expect_err('do $x$ begin perform set_config(''mgb.tk_project_color'', ''on'', true); update tk_projects set color = ''magenta'' where id = (select id from tk_projects limit 1); end $x$',
                          'tk_projects_color_check', 'a color outside the palette is refused by the table');
select set_config('mgb.tk_project_color', '', true);

-- 2. New projects: least-used live color -----------------------------------------------
-- Make 'olive' the only color nobody uses among live projects by trashing, as
-- the table owner, every olive project inside this transaction.
select set_config('mgb.tk_project_trash', 'on', true);
update tk_projects set trashed_at = now(), trashed_by = 'selftest' where color = 'olive' and trashed_at is null;
select set_config('mgb.tk_project_trash', '', true);
select pg_temp.mkproj('PA', 'P3 color test A', pg_temp.ctx('bk1'));
select pg_temp.ok(pg_temp.color_of('PA') = 'olive', 'a new project takes the least-used live color (a color only trashed projects use counts as unused)');
select pg_temp.mkproj('PB', 'P3 color test B', pg_temp.ctx('bk1'), 'coral');
select pg_temp.ok(pg_temp.color_of('PB') = 'coral', 'a valid color sent with the insert is kept');
select pg_temp.mkproj('PC', 'P3 color test C', pg_temp.ctx('bk1'), 'not-a-color');
select pg_temp.ok(pg_temp.color_of('PC') = any (array['blue','teal','green','amber','coral','pink','purple','navy','olive','gray']),
                  'a bad color sent with the insert is replaced by a palette color');
select pg_temp.mkproj('PD', 'P3 color test D', pg_temp.ctx('a1'));

-- 3. A direct UPDATE of the color does nothing ----------------------------------------------
select pg_temp.as_user(pg_temp.ctx('bk1'));
update tk_projects set color = 'gray' where id = pg_temp.id('PB');
select pg_temp.as_user(null);
select pg_temp.ok(pg_temp.color_of('PB') = 'coral', 'a direct update by the owner is ignored');
update tk_projects set color = 'gray' where id = pg_temp.id('PB');
select pg_temp.ok(pg_temp.color_of('PB') = 'coral', 'a direct update with no caller identity is ignored too');

-- 4. Who may set a color --------------------------------------------------------------------------
select pg_temp.as_user(pg_temp.ctx('bk2'));
select pg_temp.expect_err($$select public.tk_project_set_color(pg_temp.id('PB'), 'teal')$$, 'tk_forbidden', 'stranger cannot set a color');
select pg_temp.as_user(null);
select pg_temp.expect_err($$select public.tk_project_set_color(pg_temp.id('PB'), 'teal')$$, 'tk_forbidden', 'no caller identity is refused');
select pg_temp.ok(pg_temp.color_of('PB') = 'coral', 'the refused calls changed nothing');
select pg_temp.ok(not has_function_privilege('anon', 'public.tk_project_set_color(uuid,text)', 'execute')
                  and not has_function_privilege('anon', 'public.tk_admin_list_projects()', 'execute')
                  and has_function_privilege('authenticated', 'public.tk_project_set_color(uuid,text)', 'execute')
                  and not has_function_privilege('authenticated', 'public.tk_projects_color_guard()', 'execute'),
                  'anon cannot execute the RPCs; the guard is not callable from the API');

select pg_temp.as_user(pg_temp.ctx('bk1'));
select pg_temp.ok(public.tk_project_set_color(pg_temp.id('PB'), '  Teal ') = 'teal', 'the owner sets a color (trimmed, lower-cased)');
select pg_temp.expect_err($$select public.tk_project_set_color(pg_temp.id('PB'), 'magenta')$$, 'tk_bad_color', 'an unknown color is refused');
select pg_temp.expect_err($$select public.tk_project_set_color(pg_temp.id('PB'), '')$$, 'tk_bad_color', 'a blank color is refused');
select pg_temp.expect_err($$select public.tk_project_set_color(pg_temp.id('PB'), null)$$, 'tk_bad_color', 'a null color is refused');
select pg_temp.as_user(null);
select pg_temp.ok(pg_temp.color_of('PB') = 'teal', 'the color changed');
select pg_temp.ok(pg_temp.audit_n('tk_project.color_set', pg_temp.id('PB')) = 1
                  and exists (select 1 from audit_log where action = 'tk_project.color_set' and target_id = pg_temp.id('PB')::text
                              and details ->> 'from' = 'coral' and details ->> 'to' = 'teal'),
                  'one audit row records the change (from and to)');

select pg_temp.as_user(pg_temp.ctx('bk1'));
select pg_temp.ok(public.tk_project_set_color(pg_temp.id('PB'), 'teal') = 'teal', 'setting the same color is fine');
select pg_temp.as_user(null);
select pg_temp.ok(pg_temp.audit_n('tk_project.color_set', pg_temp.id('PB')) = 1, 'a no-op writes no second audit row');

select pg_temp.as_user(pg_temp.ctx('a1'));
select pg_temp.ok(public.tk_project_set_color(pg_temp.id('PB'), 'purple') = 'purple', 'an admin sets a color on someone else''s project');
select pg_temp.ok(public.tk_project_set_color(pg_temp.id('PD'), 'pink') = 'pink', 'an admin sets a color on their own project');
select pg_temp.as_user(null);
select pg_temp.ok(pg_temp.audit_n('tk_project.color_set', pg_temp.id('PB')) = 2, 'two real changes, two audit rows');

-- 5. Trashed projects keep their color and cannot be recolored ---------------------------------------
select pg_temp.as_user(pg_temp.ctx('a1'));
select public.tk_project_trash(pg_temp.id('PD'));
select pg_temp.expect_err($$select public.tk_project_set_color(pg_temp.id('PD'), 'gray')$$, 'tk_project_trashed', 'a trashed project cannot be recolored');
select pg_temp.ok((select color = 'pink' and state = 'trashed' from public.tk_admin_list_projects() where id = pg_temp.id('PD')),
                  'the admin list returns the color, trashed rows included');
select pg_temp.ok(public.tk_project_restore(pg_temp.id('PD')) = 0 and pg_temp.color_of('PD') = 'pink', 'restore keeps the color');
select pg_temp.ok((select color = 'purple' from public.tk_admin_list_projects() where id = pg_temp.id('PB')), 'the admin list returns an active project''s color');
select pg_temp.as_user(pg_temp.ctx('bk1'));
select pg_temp.expect_err($$select * from public.tk_admin_list_projects()$$, 'tk_forbidden', 'the list is still admin only');
select pg_temp.as_user(null);

-- 6. The earlier RPCs still work and leave the color alone -------------------------------------------
select pg_temp.as_user(pg_temp.ctx('bk1'));
select pg_temp.ok(public.tk_project_rename(pg_temp.id('PB'), 'P3 color test B2') = 'P3 color test B2', 'rename still works');
select pg_temp.ok(public.tk_project_archive(pg_temp.id('PB'), true) = 'archived', 'archive still works');
select pg_temp.as_user(null);
select pg_temp.ok(pg_temp.color_of('PB') = 'purple', 'rename and archive leave the color alone');

-- 7. No email from any of it
select pg_temp.ok(pg_temp.outbox() = pg_temp.ctx('outbox0')::bigint, 'no email was queued');

select 'Project colors self-test: all checks passed' as result;
rollback;
