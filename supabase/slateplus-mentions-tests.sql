-- =====================================================================
-- Self-test for slateplus-mentions.sql (tk_mention_candidates + the
-- owner-only slateplus_enabled key).
--
-- Run it whole; it ends in ROLLBACK, so nothing it writes is kept and no
-- email is sent. Uses test client basic-test, the internal company
-- (mygoodbooks) and personal tasks only. People are picked at run time; no
-- names or emails live in this file. A failed check raises and stops the run.
-- =====================================================================
begin;

create temp table t_ctx (k text primary key, v text) on commit drop;
create or replace function pg_temp.ctx(p_k text) returns text language sql as $$ select v from t_ctx where k = p_k $$;
create or replace function pg_temp.as_user(p_email text) returns void language sql as $$
  select set_config('request.jwt.claims',
    case when p_email is null then '' else json_build_object(
      'email', coalesce((select s.email from staff s where lower(s.email) = lower(p_email) limit 1), p_email),
      'role', 'authenticated', 'app_metadata', json_build_object('provider', 'google'))::text end, true);
$$;
create or replace function pg_temp.ok(p_cond boolean, p_what text) returns void language plpgsql as $$
begin
  if p_cond is not true then raise exception 'SELF-TEST FAILED: %', p_what; end if;
  raise notice 'ok: %', p_what;
end $$;
-- candidates for a task as a person (array, sorted)
create or replace function pg_temp.cands(p_as text, p_task text) returns text[] language plpgsql as $$
declare v text[];
begin
  perform pg_temp.as_user(p_as);
  select coalesce(array_agg(c.email order by c.email), '{}') into v from public.tk_mention_candidates(p_task::uuid) c;
  perform pg_temp.as_user(null);
  return v;
end $$;

-- People: OWN = the owner (internal access); ADM_NO = an active admin with no
-- internal_access row; BK1 / BK2 / BK3 = three active bookkeepers; OFF = BK3
-- made inactive later in the run.
insert into t_ctx select 'own', lower(ia.staff_email) from internal_access ia where ia.is_owner limit 1;
insert into t_ctx select 'adm_no', lower(s.email) from staff s
 where s.active and s.role = 'admin'
   and not exists (select 1 from internal_access ia where lower(ia.staff_email) = lower(s.email))
 order by s.email limit 1;
insert into t_ctx select 'bk1', lower(s.email) from staff s where s.active and s.role = 'bookkeeper' order by s.email limit 1;
insert into t_ctx select 'bk2', lower(s.email) from staff s where s.active and s.role = 'bookkeeper' order by s.email offset 1 limit 1;
insert into t_ctx select 'bk3', lower(s.email) from staff s where s.active and s.role = 'bookkeeper' order by s.email offset 2 limit 1;
select pg_temp.ok(pg_temp.ctx('own') is not null and pg_temp.ctx('bk1') is not null
                  and pg_temp.ctx('bk2') is not null and pg_temp.ctx('bk3') is not null, 'test people found');

-- ADM_NO: if every admin holds internal access, take one away inside this run.
do $$
begin
  if pg_temp.ctx('adm_no') is null then
    insert into t_ctx select 'adm_no', lower(ia.staff_email) from internal_access ia
      join staff s on lower(s.email) = lower(ia.staff_email)
     where not ia.is_owner and s.active and s.role = 'admin' order by 1 limit 1;
    delete from internal_access where lower(staff_email) = pg_temp.ctx('adm_no');
  end if;
end $$;
select pg_temp.ok(pg_temp.ctx('adm_no') is not null, 'admin without internal access found');

-- Client access on basic-test: BK1 and BK3 yes, BK2 no.
delete from staff_client_access where client_id = 'basic-test' and lower(staff_email) = pg_temp.ctx('bk2');
delete from staff_client_access_grants where client_id = 'basic-test' and lower(staff_email) = pg_temp.ctx('bk2');
insert into staff_client_access (staff_email, client_id)
select x, 'basic-test' from unnest(array[pg_temp.ctx('bk1'), pg_temp.ctx('bk3')]) x
 where not exists (select 1 from staff_client_access a where a.staff_email = x and a.client_id = 'basic-test');

-- Tasks (inserted without a login, as the other self-tests do).
select pg_temp.as_user(null);
with t as (
  insert into staff_reminders (staff_email, assignee_email, text, client_id, due_date, visibility)
  values (pg_temp.ctx('bk1'), pg_temp.ctx('bk1'), 'spm shared client task', 'basic-test', current_date + 3, 'shared')
  returning id)
insert into t_ctx select 't1', id::text from t;
with t as (
  insert into staff_reminders (staff_email, assignee_email, text, client_id, due_date, visibility)
  values (pg_temp.ctx('own'), pg_temp.ctx('own'), 'spm internal task', 'mygoodbooks', current_date + 3, 'shared')
  returning id)
insert into t_ctx select 't2', id::text from t;
with t as (
  insert into staff_reminders (staff_email, assignee_email, text, client_id, due_date, visibility)
  values (pg_temp.ctx('bk1'), pg_temp.ctx('bk1'), 'spm private personal task', null, current_date + 3, 'private')
  returning id)
insert into t_ctx select 't3', id::text from t;
insert into tk_followers (task_id, staff_email, added_by)
values (pg_temp.ctx('t3')::uuid, pg_temp.ctx('bk2'), pg_temp.ctx('bk1')) on conflict do nothing;

-- 1. No login, a non-staff login: nothing
select pg_temp.ok(cardinality(pg_temp.cands(null, pg_temp.ctx('t1'))) = 0, 'no login: no candidates');
select pg_temp.ok(cardinality(pg_temp.cands('someone-outside@example.com', pg_temp.ctx('t1'))) = 0,
  'non-staff (client) login: no candidates');

-- 2. Shared client task as BK1: admins + BK3, never the caller, never BK2 (no client access)
select pg_temp.ok(not (pg_temp.ctx('bk1') = any (pg_temp.cands(pg_temp.ctx('bk1'), pg_temp.ctx('t1')))), 'caller is never listed');
select pg_temp.ok(not (pg_temp.ctx('bk2') = any (pg_temp.cands(pg_temp.ctx('bk1'), pg_temp.ctx('t1')))), 'staff without the client are left out');
select pg_temp.ok(pg_temp.ctx('bk3') = any (pg_temp.cands(pg_temp.ctx('bk1'), pg_temp.ctx('t1'))), 'staff with the client are listed');
select pg_temp.ok(pg_temp.ctx('own') = any (pg_temp.cands(pg_temp.ctx('bk1'), pg_temp.ctx('t1'))), 'admins are listed on a client task');
select pg_temp.ok(cardinality(pg_temp.cands(pg_temp.ctx('bk2'), pg_temp.ctx('t1'))) = 0, 'a caller who cannot read the task gets nothing');

-- 3. Inactive staff are left out
update staff set active = false where lower(email) = pg_temp.ctx('bk3');
select pg_temp.ok(not (pg_temp.ctx('bk3') = any (pg_temp.cands(pg_temp.ctx('bk1'), pg_temp.ctx('t1')))), 'inactive staff are left out');
update staff set active = true where lower(email) = pg_temp.ctx('bk3');

-- 4. Internal company task: only admins with internal access; never bookkeepers
select pg_temp.ok(not (pg_temp.ctx('adm_no') = any (pg_temp.cands(pg_temp.ctx('own'), pg_temp.ctx('t2')))),
  'internal task: an admin without internal access is left out');
select pg_temp.ok(not (pg_temp.ctx('bk1') = any (pg_temp.cands(pg_temp.ctx('own'), pg_temp.ctx('t2')))),
  'internal task: bookkeepers are left out');
select pg_temp.ok((select bool_and(public.tk_staff_has_client(x, 'mygoodbooks')) is not false
                     from unnest(pg_temp.cands(pg_temp.ctx('own'), pg_temp.ctx('t2'))) x),
  'internal task: everyone listed holds internal access');
select pg_temp.ok(cardinality(pg_temp.cands(pg_temp.ctx('adm_no'), pg_temp.ctx('t2'))) = 0,
  'internal task: an admin without internal access gets nothing');

-- 5. Private personal task: a follower (not an editor) sees only people already involved
select pg_temp.ok(pg_temp.ctx('bk1') = any (pg_temp.cands(pg_temp.ctx('bk2'), pg_temp.ctx('t3'))), 'private: the owner is listed for a follower');
select pg_temp.ok(not (pg_temp.ctx('bk3') = any (pg_temp.cands(pg_temp.ctx('bk2'), pg_temp.ctx('t3')))),
  'private: an uninvolved bookkeeper is left out when a non-editor comments');
select pg_temp.ok(pg_temp.ctx('bk3') = any (pg_temp.cands(pg_temp.ctx('bk1'), pg_temp.ctx('t3'))),
  'private: the editor can mention anyone (the mention adds a follower)');
select pg_temp.ok(cardinality(pg_temp.cands(pg_temp.ctx('bk3'), pg_temp.ctx('t3'))) = 0, 'private: an outsider gets nothing');

-- 6. A deleted task: nothing
update staff_reminders set deleted_at = now() where id = pg_temp.ctx('t1')::uuid;
select pg_temp.ok(cardinality(pg_temp.cands(pg_temp.ctx('own'), pg_temp.ctx('t1'))) = 0, 'deleted task: no candidates');

-- 7. Grants and the switch
select pg_temp.ok(not has_function_privilege('anon', 'public.tk_mention_candidates(uuid)', 'execute'), 'anon cannot call it');
select pg_temp.ok(has_function_privilege('authenticated', 'public.tk_mention_candidates(uuid)', 'execute'), 'staff can call it');
select pg_temp.ok(public.tk__owner_only_key('slateplus_enabled'), 'slateplus_enabled is owner-only');
select pg_temp.ok(public.tk__owner_only_key('threadmenu_enabled') and public.tk__owner_only_key('deskplus_enabled')
                  and public.tk__owner_only_key('wb_enabled') and public.tk__owner_only_key('client_request_pilot'),
  'earlier owner-only keys are kept');
select pg_temp.ok(not exists (select 1 from tk_settings where key = 'slateplus_enabled'), 'no slateplus_enabled row (off)');

select pg_temp.as_user(null);
select 'slateplus-mentions self-test passed' as result;
rollback;
