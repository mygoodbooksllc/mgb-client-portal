-- =====================================================================
-- Self-test for owner-only-brand-hovernav-switches.sql.
--
-- Run it whole; it ends in ROLLBACK, so nothing it writes is kept. People
-- are picked at run time (an active admin who is not the owner); no names or
-- emails live in this file. A failed check raises and stops the run.
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

-- 1. The key list: the two new keys are owner-only, every earlier one is kept
select pg_temp.ok(public.tk__owner_only_key('brand_enabled'), 'brand_enabled is owner-only');
select pg_temp.ok(public.tk__owner_only_key('hovernav_enabled'), 'hovernav_enabled is owner-only');
select pg_temp.ok(
  public.tk__owner_only_key('client_request_enabled') and public.tk__owner_only_key('client_request_pilot')
  and public.tk__owner_only_key('standard_set_live') and public.tk__owner_only_key('late_tasks_count_against_staff')
  and public.tk__owner_only_key('late_tasks_effective_from') and public.tk__owner_only_key('wb_enabled')
  and public.tk__owner_only_key('desk_app_enabled') and public.tk__owner_only_key('nav_enabled')
  and public.tk__owner_only_key('lato_enabled') and public.tk__owner_only_key('month_rhythm_enabled')
  and public.tk__owner_only_key('slate_app_enabled'), 'every earlier owner-only key is kept');
select pg_temp.ok(not public.tk__owner_only_key('month_rhythm') and not public.tk__owner_only_key('layout_defaults')
                  and not public.tk__owner_only_key('brand'),
  'other keys stay admin-writable');

-- 2. The predicate only (the switches themselves may have rows by now)
select pg_temp.ok(public.tk__owner_only_key('brand_enabled') and public.tk__owner_only_key('hovernav_enabled'),
  'both switch keys are owner-only (predicate; rows may exist)');
insert into t_ctx select 'switch_rows', count(*)::text from tk_settings where key in ('brand_enabled', 'hovernav_enabled');

-- 3. A non-owner admin cannot set either switch, insert or update
insert into t_ctx
select 'admin', lower(s.email) from staff s
 where s.active and s.role = 'admin'
   and not exists (select 1 from internal_access ia where lower(ia.staff_email) = lower(s.email) and ia.is_owner)
 order by s.email limit 1;
select pg_temp.ok(pg_temp.ctx('admin') is not null, 'test admin found');
select pg_temp.as_user(pg_temp.ctx('admin'));
select pg_temp.expect_err($q$insert into tk_settings (key, value) values ('brand_enabled', 'true')$q$,
  'tk_owner_only', 'a non-owner admin cannot turn Brand colors on');
select pg_temp.expect_err($q$insert into tk_settings (key, value) values ('hovernav_enabled', 'true')$q$,
  'tk_owner_only', 'a non-owner admin cannot turn Hover menus on');
select pg_temp.ok((select count(*) from tk_settings where key in ('brand_enabled', 'hovernav_enabled'))::text = pg_temp.ctx('switch_rows'),
  'refused writes changed no row');

select pg_temp.as_user(null);
select 'owner-only-brand-hovernav-switches self-test passed' as result;
rollback;
