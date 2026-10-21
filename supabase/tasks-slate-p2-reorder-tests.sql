-- =====================================================================
-- Self-test for tasks-slate-p2-reorder.sql (tk_reorder, manual order).
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
create or replace function pg_temp.key(p_k text) returns numeric language sql as $$
  select sort_key from staff_reminders where id = pg_temp.id(p_k)
$$;
create or replace function pg_temp.sec(p_k text) returns text language sql as $$
  select section from staff_reminders where id = pg_temp.id(p_k)
$$;
-- the ids of t_ctx keys, in order
create or replace function pg_temp.ids(p_keys text[]) returns uuid[] language sql as $$
  select array_agg(pg_temp.id(k) order by o) from unnest(p_keys) with ordinality u(k, o)
$$;
-- the t_ctx keys ordered the way TK_sortTasks orders them (keyed first, low to high)
create or replace function pg_temp.order_of(p_keys text[]) returns text language sql as $$
  select string_agg(k, ',' order by (pg_temp.key(k) is null), pg_temp.key(k), o)
    from unnest(p_keys) with ordinality u(k, o)
$$;
create or replace function pg_temp.mk(p_k text, p_owner text, p_project text default null, p_section text default null)
returns void language plpgsql as $$
declare v uuid;
begin
  perform pg_temp.as_user(pg_temp.ctx(p_owner));
  insert into staff_reminders (staff_email, text, client_id, visibility, recurrence, project_id, section)
  values (pg_temp.ctx(p_owner), 'P2 self-test ' || p_k, 'basic-test', 'shared', 'none',
          case when p_project is null then null else pg_temp.id(p_project) end, p_section)
  returning id into v;
  insert into t_ctx values (p_k, v::text);
  perform pg_temp.as_user(null);
end $$;

-- 0. Shape -------------------------------------------------------------------
select pg_temp.ok(not has_function_privilege('anon', 'public.tk_reorder(uuid,uuid,uuid,text,boolean,uuid[])', 'execute')
              and has_function_privilege('authenticated', 'public.tk_reorder(uuid,uuid,uuid,text,boolean,uuid[])', 'execute'),
                  'no anon execute; authenticated can call tk_reorder');
select pg_temp.ok((select p.prosecdef and coalesce(array_to_string(p.proconfig, ','), '') like '%search_path=public%'
                     from pg_proc p where p.oid = 'public.tk_reorder(uuid,uuid,uuid,text,boolean,uuid[])'::regprocedure),
                  'tk_reorder is security definer with search_path set');

-- People: a1 = basic-test's account manager (an admin), a2 = another admin
insert into t_ctx select 'a1', lower(c.account_manager_email) from clients c where c.id = 'basic-test';
insert into t_ctx select 'a2', lower(s.email) from staff s
 where s.active and s.role = 'admin' and lower(s.email) <> pg_temp.ctx('a1') order by s.email limit 1;
insert into t_ctx select 'bk', lower(s.email) from staff s where s.active and s.role = 'bookkeeper' order by s.email limit 1;
select pg_temp.ok(pg_temp.ctx('a1') is not null and pg_temp.ctx('a2') is not null and pg_temp.ctx('bk') is not null, 'test people found');

-- 1. Setup ---------------------------------------------------------------------
select pg_temp.as_user(pg_temp.ctx('a1'));
with p as (insert into tk_projects (name, kind, client_id, owner_email, sections)
           values ('P2 self-test', 'onboarding', 'basic-test', pg_temp.ctx('a1'), array['Alpha', 'Beta']) returning id)
insert into t_ctx select 'proj', id::text from p;
select pg_temp.as_user(null);

select pg_temp.mk('t1', 'a1', 'proj', 'Alpha');
select pg_temp.mk('t2', 'a1', 'proj', 'Alpha');
select pg_temp.mk('t3', 'a1', 'proj', 'Alpha');
select pg_temp.mk('t4', 'a1', 'proj', 'Alpha');
select pg_temp.mk('b1', 'a1', 'proj', 'Beta');
select pg_temp.mk('n1', 'a1');                     -- no project
select pg_temp.mk('k1', 'bk');                     -- the bookkeeper's own task
select pg_temp.mk('d1', 'a1');                     -- will be deleted
update staff_reminders set deleted_at = now() where id = pg_temp.id('d1');
insert into t_ctx values ('ghost', gen_random_uuid()::text);
select pg_temp.as_user(pg_temp.ctx('a2'));
insert into staff_reminders (staff_email, text, visibility) values (pg_temp.ctx('a2'), 'P2 self-test private', 'private');
select pg_temp.as_user(null);
insert into t_ctx select 'priv', id::text from staff_reminders where text = 'P2 self-test private' and lower(staff_email) = pg_temp.ctx('a2');
select pg_temp.ok(pg_temp.key('t1') is null and pg_temp.key('t4') is null, 'setup: new tasks have no key');

-- 2. Refusals --------------------------------------------------------------------
select pg_temp.expect_err($$select public.tk_reorder(pg_temp.id('t1'), null, null)$$, 'tk_forbidden', 'signed out: refused');
select pg_temp.as_user(pg_temp.ctx('a1'));
select pg_temp.expect_err($$select public.tk_reorder(null)$$, 'tk_bad_patch', 'no task: refused');
select pg_temp.expect_err($$select public.tk_reorder(pg_temp.id('t1'), pg_temp.id('t1'), null)$$, 'tk_bad_patch', 'a task cannot sit next to itself');
select pg_temp.expect_err($$select public.tk_reorder(pg_temp.id('t1'), pg_temp.id('t2'), pg_temp.id('t2'))$$, 'tk_bad_patch', 'the same row above and below: refused');
select pg_temp.expect_err($$select public.tk_reorder(pg_temp.id('t1'), null, null, null, false, array(select gen_random_uuid() from generate_series(1, 501)))$$,
                          'tk_too_many', '501 ids in the order: refused');
select pg_temp.expect_err($$select public.tk_reorder(pg_temp.id('ghost'), null, null)$$, 'tk_forbidden', 'a missing task: refused');
select pg_temp.expect_err($$select public.tk_reorder(pg_temp.id('d1'), null, null)$$, 'tk_forbidden', 'a deleted task: refused');
select pg_temp.expect_err($$select public.tk_reorder(pg_temp.id('t1'), pg_temp.id('d1'), null)$$, 'tk_not_found', 'a deleted neighbor: refused');
select pg_temp.as_user(pg_temp.ctx('bk'));
select pg_temp.expect_err($$select public.tk_reorder(pg_temp.id('priv'), null, null)$$, 'tk_forbidden', 'a bookkeeper on someone else''s private task: refused');
select pg_temp.expect_err($$select public.tk_reorder(pg_temp.id('k1'), pg_temp.id('priv'), null)$$, 'tk_not_found', 'an unreadable neighbor: refused');
select pg_temp.as_user(pg_temp.ctx('a1'));
select pg_temp.expect_err($$select public.tk_reorder(pg_temp.id('t1'), null, pg_temp.id('ghost'))$$, 'tk_not_found', 'a missing neighbor: refused');
select pg_temp.expect_err($$select public.tk_reorder(pg_temp.id('t1'), null, null, 'Nope', true)$$, 'tk_bad_patch', 'a section the project lacks: refused');
select pg_temp.expect_err($$select public.tk_reorder(pg_temp.id('n1'), null, null, 'Alpha', true)$$, 'tk_bad_patch', 'a section on a task with no project: refused');
-- with no key above and no order to renumber, it refuses rather than guess
select pg_temp.expect_err($$select public.tk_reorder(pg_temp.id('t3'), pg_temp.id('t1'), null)$$, 'tk_bad_patch', 'no room and no order: refused');
select pg_temp.ok(pg_temp.key('t1') is null and pg_temp.key('t3') is null, 'refusals changed nothing');

-- 3. First move renumbers the prefix only ------------------------------------------
-- visible Alpha order: t1, t2, t3, t4 (all unkeyed). Move t4 between t1 and t2.
insert into t_ctx select 'r1', public.tk_reorder(pg_temp.id('t4'), pg_temp.id('t1'), pg_temp.id('t2'), null, false,
                                                 pg_temp.ids(array['t1', 't2', 't3', 't4']))::text;
select pg_temp.ok(pg_temp.key('t1') = 1024 and pg_temp.key('t4') = 2048 and pg_temp.key('t2') is null and pg_temp.key('t3') is null,
                  'renumber keys rows through the moved one; rows below stay unkeyed');
select pg_temp.ok(pg_temp.order_of(array['t1', 't2', 't3', 't4']) = 't1,t4,t2,t3', 'the order is t1, t4, t2, t3');
select pg_temp.ok((pg_temp.res('r1') ->> 'renormalized')::int = 1 and (pg_temp.res('r1') ->> 'sort_key')::numeric = 2048
              and jsonb_array_length(pg_temp.res('r1') -> 'rows') = 1, 'the result lists the renumbered row and the new key');

-- 4. Midpoint, top and bottom ------------------------------------------------------
-- t3 to the top (above t1)
insert into t_ctx select 'r2', public.tk_reorder(pg_temp.id('t3'), null, pg_temp.id('t1'))::text;
select pg_temp.ok(pg_temp.key('t3') = 0 and (pg_temp.res('r2') ->> 'renormalized')::int = 0, 'to the top: the key above the first row, no renumber');
-- t2 between t1 (1024) and t4 (2048): midpoint
select public.tk_reorder(pg_temp.id('t2'), pg_temp.id('t1'), pg_temp.id('t4'));
select pg_temp.ok(pg_temp.key('t2') = 1536, 'between two keyed rows: the midpoint');
select pg_temp.ok(pg_temp.order_of(array['t1', 't2', 't3', 't4']) = 't3,t1,t2,t4', 'the order is t3, t1, t2, t4');
-- t3 to the bottom (below t4)
select public.tk_reorder(pg_temp.id('t3'), pg_temp.id('t4'), null);
select pg_temp.ok(pg_temp.key('t3') = 3072 and pg_temp.order_of(array['t1', 't2', 't3', 't4']) = 't1,t2,t4,t3', 'to the bottom: the key after the last row');

-- 5. Too close: renumber -------------------------------------------------------------
update staff_reminders set sort_key = 1536.0000001 where id = pg_temp.id('t4');   -- squeeze t4 up against t2
select pg_temp.as_user(pg_temp.ctx('a1'));
insert into t_ctx select 'r3', public.tk_reorder(pg_temp.id('t3'), pg_temp.id('t2'), pg_temp.id('t4'), null, false,
                                                 pg_temp.ids(array['t1', 't2', 't3', 't4']))::text;
select pg_temp.ok(pg_temp.key('t1') = 1024 and pg_temp.key('t2') = 2048 and pg_temp.key('t3') = 3072 and pg_temp.key('t4') = 4096,
                  'no room between neighbors: the group is renumbered 1024 apart');
select pg_temp.ok((pg_temp.res('r3') ->> 'renormalized')::int = 2, 'only rows whose key changed are written');
-- a row the caller cannot write (here a deleted one) in the order is skipped, not written
update staff_reminders set sort_key = 2048.0000001 where id = pg_temp.id('t3');
insert into t_ctx select 'r4', public.tk_reorder(pg_temp.id('t1'), pg_temp.id('t2'), pg_temp.id('t3'), null, false,
                                                 pg_temp.ids(array['d1', 't1', 't2', 't3', 't4']))::text;
select pg_temp.ok((pg_temp.res('r4') ->> 'skipped')::int = 1, 'a row the caller cannot write is skipped and counted');
select pg_temp.ok(pg_temp.key('d1') is null and pg_temp.key('priv') is null, 'the skipped row kept no key');
select pg_temp.ok(pg_temp.order_of(array['t1', 't2', 't3', 't4']) = 't2,t1,t3,t4', 'the order is t2, t1, t3, t4');

-- 6. Section change inside the project ----------------------------------------------
insert into t_ctx select 'r5', public.tk_reorder(pg_temp.id('t4'), null, pg_temp.id('b1'), 'beta', true)::text;
select pg_temp.ok(pg_temp.sec('t4') = 'Beta' and pg_temp.res('r5') ->> 'section' = 'Beta', 'into another section: matched case-insensitively');
select public.tk_reorder(pg_temp.id('t4'), null, null, null, true);
select pg_temp.ok(pg_temp.sec('t4') is null, 'a null section clears it');
select public.tk_reorder(pg_temp.id('t4'), null, null);
select pg_temp.ok(pg_temp.sec('t4') is null and (select project_id = pg_temp.id('proj') from staff_reminders where id = pg_temp.id('t4')),
                  'without p_set_section the section is untouched; the project never changes');
select pg_temp.ok(not exists (select 1 from tk_activity where task_id = pg_temp.id('t1') and (kind ilike '%sort%' or coalesce(meta::text, '') ilike '%sort_key%')),
                  'no sort_key rows in the activity log');
select pg_temp.as_user(null);

select 'P2 SELF-TEST PASSED' as result;
rollback;
