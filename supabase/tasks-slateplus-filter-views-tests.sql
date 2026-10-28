-- =====================================================================
-- Self-test for tasks-slateplus-filter-views.sql (Slate plus saved filter
-- sets). Run it whole after the migration. It ends in ROLLBACK, so nothing
-- it writes is kept. People are picked at run time; no names or emails live
-- in this file. A failed check raises; a run with no error is a pass.
-- Ran clean on production 2026-10-27 (rolled back).
-- =====================================================================
begin;

create temp table t_ctx (k text primary key, v text) on commit drop;
create or replace function pg_temp.ctx(p_k text) returns text language sql as $$ select v from t_ctx where k = p_k $$;
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

-- 0. Shape -------------------------------------------------------------------
select pg_temp.ok(not has_table_privilege('anon', 'public.tk_slate_filter_views', 'select')
              and not has_table_privilege('anon', 'public.tk_slate_filter_views', 'insert')
              and has_table_privilege('authenticated', 'public.tk_slate_filter_views', 'select')
              and not has_table_privilege('authenticated', 'public.tk_slate_filter_views', 'truncate')
              and (select relrowsecurity from pg_class where oid = 'public.tk_slate_filter_views'::regclass),
                  'RLS on, anon has nothing, authenticated cannot truncate');
select pg_temp.ok((select count(*) from pg_policies where tablename = 'tk_slate_filter_views' and schemaname = 'public') = 4
              and not exists (select 1 from pg_policies where tablename = 'tk_slate_filter_views' and 'anon' = any(roles)),
                  'four policies, none for anon');
select pg_temp.ok(not has_function_privilege('anon', 'public.tk_filter_view_set_default(uuid)', 'execute')
              and has_function_privilege('authenticated', 'public.tk_filter_view_set_default(uuid)', 'execute')
              and not (select prosecdef from pg_proc where oid = 'public.tk_filter_view_set_default(uuid)'::regprocedure),
                  'set default: no anon execute, security invoker');

-- People: s1, s2 = two active staff; cl = a client login email (not staff)
insert into t_ctx select 's1', lower(s.email) from staff s where s.active order by s.email limit 1;
insert into t_ctx select 's2', lower(s.email) from staff s where s.active and lower(s.email) <> pg_temp.ctx('s1') order by s.email limit 1;
insert into t_ctx values ('cl', 'slateplus-selftest-client@example.invalid');
select pg_temp.ok(pg_temp.ctx('s1') is not null and pg_temp.ctx('s2') is not null
              and not exists (select 1 from staff where lower(email) = pg_temp.ctx('cl')), 'test people found');

-- 1. Rules (as the table owner, trigger still runs) ------------------------------
select pg_temp.as_user(pg_temp.ctx('s1'));
insert into tk_slate_filter_views (owner_email, name, filters, position)
  values (pg_temp.ctx('s2'), '  Late   for Grace ', '{"q":"grace","status":"late"}', 1);
select pg_temp.ok((select count(*) from tk_slate_filter_views where owner_email = pg_temp.ctx('s1')) = 1
              and (select count(*) from tk_slate_filter_views where owner_email = pg_temp.ctx('s2')) = 0
              and exists (select 1 from tk_slate_filter_views where name = 'Late for Grace'),
                  'owner is stamped from the JWT; name trimmed and single-spaced');
select pg_temp.expect_err($$insert into tk_slate_filter_views (name, filters) values ('LATE FOR GRACE', '{}')$$,
                          'tk_slate_filter_views_owner_name_uq', 'a name repeats case-insensitively: refused');
select pg_temp.expect_err($$insert into tk_slate_filter_views (name, filters) values ('   ', '{}')$$,
                          'tk_slate_filter_views_name_check', 'blank name refused');
select pg_temp.expect_err($$insert into tk_slate_filter_views (name, filters) values (repeat('x', 61), '{}')$$,
                          'tk_slate_filter_views_name_check', '61-character name refused');
select pg_temp.expect_err($$insert into tk_slate_filter_views (name, filters) values ('Array', '[]')$$,
                          'tk_slate_filter_views_filters_check', 'filters must be a JSON object');
select pg_temp.expect_err($$insert into tk_slate_filter_views (name, filters) values ('Big', jsonb_build_object('q', repeat('x', 4100)))$$,
                          'tk_slate_filter_views_filters_check', 'filters over 4000 bytes refused');
insert into tk_slate_filter_views (name, filters) select 'Cap ' || g, '{}' from generate_series(1, 29) g;
select pg_temp.expect_err($$insert into tk_slate_filter_views (name, filters) values ('One too many', '{}')$$,
                          'tk_too_many_views', 'the 31st set is refused');
update tk_slate_filter_views set name = 'Renamed', owner_email = pg_temp.ctx('s2') where name = 'Late for Grace';
select pg_temp.ok((select owner_email = pg_temp.ctx('s1') and updated_at >= created_at
                     from tk_slate_filter_views where name = 'Renamed'), 'update cannot move a set to another owner');
select pg_temp.as_user(null);
delete from tk_slate_filter_views where name like 'Cap %' and owner_email = pg_temp.ctx('s1') and name not in ('Cap 1', 'Cap 2');
select pg_temp.as_user(pg_temp.ctx('s1'));
select pg_temp.expect_err($$insert into tk_slate_filter_views (name, is_default) values ('Cap 1b', true); insert into tk_slate_filter_views (name, is_default) values ('Cap 1c', true)$$,
                          'tk_slate_filter_views_one_default_uq', 'only one default per person');
select pg_temp.as_user(null);
insert into t_ctx select 'v1', id::text from tk_slate_filter_views where name = 'Renamed' and owner_email = pg_temp.ctx('s1');
insert into t_ctx select 'v2', id::text from tk_slate_filter_views where name = 'Cap 1' and owner_email = pg_temp.ctx('s1');
-- s2's own set, same name as s1's: allowed
select pg_temp.as_user(pg_temp.ctx('s2'));
insert into tk_slate_filter_views (name, filters) values ('Renamed', '{"assignee":"me"}');
select pg_temp.as_user(null);
insert into t_ctx select 'w1', id::text from tk_slate_filter_views where owner_email = pg_temp.ctx('s2') and name = 'Renamed';
select pg_temp.ok(pg_temp.ctx('w1') is not null, 'the same name is fine for another person');

-- 2. RLS as the real app role -----------------------------------------------------
do $$
declare
  v_s1 text := pg_temp.ctx('s1');
  v_v1 uuid := pg_temp.ctx('v1')::uuid;
  v_v2 uuid := pg_temp.ctx('v2')::uuid;
  v_w1 uuid := pg_temp.ctx('w1')::uuid;
  v_n bigint;
begin
  perform pg_temp.as_user(v_s1);
  set local role authenticated;
  select count(*) into v_n from public.tk_slate_filter_views;
  if v_n <> 3 then raise exception 'SELF-TEST FAILED: s1 reads % sets (expected own 3)', v_n; end if;
  update public.tk_slate_filter_views set name = 'Hijack' where id = v_w1;
  get diagnostics v_n = row_count;
  if v_n <> 0 then raise exception 'SELF-TEST FAILED: updated someone else''s set'; end if;
  delete from public.tk_slate_filter_views where id = v_w1;
  get diagnostics v_n = row_count;
  if v_n <> 0 then raise exception 'SELF-TEST FAILED: deleted someone else''s set'; end if;
  -- set default: mine works, switches, clears; someone else's is not found
  perform public.tk_filter_view_set_default(v_v1);
  perform public.tk_filter_view_set_default(v_v2);
  select count(*) into v_n from public.tk_slate_filter_views where is_default;
  if v_n <> 1 or not (select is_default from public.tk_slate_filter_views where id = v_v2) then
    raise exception 'SELF-TEST FAILED: set default did not switch to the second set';
  end if;
  begin
    perform public.tk_filter_view_set_default(v_w1);
    raise exception 'SELF-TEST FAILED: set default on someone else''s set succeeded';
  exception when others then
    if position('tk_not_found' in sqlerrm) = 0 then raise; end if;
  end;
  perform public.tk_filter_view_set_default(null);
  select count(*) into v_n from public.tk_slate_filter_views where is_default;
  if v_n <> 0 then raise exception 'SELF-TEST FAILED: null did not clear my default'; end if;
  perform public.tk_filter_view_set_default(v_v2);
  reset role;
  raise notice 'ok: RLS owner-only read/update/delete; set default switch, clear and not-found';
end $$;
select pg_temp.ok((select is_default from tk_slate_filter_views where id = pg_temp.ctx('w1')::uuid) = false
              and (select name from tk_slate_filter_views where id = pg_temp.ctx('w1')::uuid) = 'Renamed',
                  's2''s set untouched by s1');

-- a non-staff login (a client) sees and writes nothing; anon has no access at all
do $$
declare v_n bigint;
begin
  perform pg_temp.as_user(pg_temp.ctx('cl'));
  set local role authenticated;
  select count(*) into v_n from public.tk_slate_filter_views;
  if v_n <> 0 then raise exception 'SELF-TEST FAILED: a client reads % sets', v_n; end if;
  begin
    insert into public.tk_slate_filter_views (name, filters) values ('client try', '{}');
    raise exception 'SELF-TEST FAILED: a client inserted a set';
  exception when insufficient_privilege then null;
  end;
  reset role;
  perform pg_temp.as_user(null);
  set local role anon;
  begin
    select count(*) into v_n from public.tk_slate_filter_views;
    raise exception 'SELF-TEST FAILED: anon read the table';
  exception when insufficient_privilege then null;
  end;
  reset role;
  raise notice 'ok: clients and anon see and write nothing';
end $$;

rollback;
