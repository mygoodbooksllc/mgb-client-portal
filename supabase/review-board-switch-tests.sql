-- =====================================================================
-- Self-test for review-board-switch.sql.
--
-- Run it whole; it ends in ROLLBACK, so nothing it writes is kept. People
-- are picked at run time (an active admin who is not the owner); no names or
-- emails live in this file. A failed check raises and stops the run; the last
-- select returns 'all ok'.
-- =====================================================================
begin;

create temp table t_ctx (k text primary key, v text) on commit drop;
grant all on t_ctx to authenticated;
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
end $$;
create or replace function pg_temp.expect_err(p_sql text, p_err text, p_what text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if position(p_err in sqlerrm) > 0 then return; end if;
    raise exception 'SELF-TEST FAILED: % expected %, got %', p_what, p_err, sqlerrm;
  end;
  raise exception 'SELF-TEST FAILED: % expected %, but it succeeded', p_what, p_err;
end $$;
grant execute on function pg_temp.ctx(text), pg_temp.ok(boolean, text), pg_temp.expect_err(text, text, text) to authenticated;

-- 1. The three new keys are owner-only
select pg_temp.ok(public.tk__owner_only_key('reviewboard_enabled'), 'reviewboard_enabled is owner-only');
select pg_temp.ok(public.tk__owner_only_key('reviewboard_digest_enabled'), 'reviewboard_digest_enabled is owner-only');
select pg_temp.ok(public.tk__owner_only_key('reviewboard_digest_to'), 'reviewboard_digest_to is owner-only');

-- 2. Every earlier key (the live list read before the change, 26 keys) is kept
select pg_temp.ok((select bool_and(public.tk__owner_only_key(k)) and count(*) = 26 from unnest(array[
  'mgb_home_enabled','client_request_enabled','client_request_pilot','standard_set_live',
  'late_tasks_count_against_staff','late_tasks_effective_from','wb_enabled','desk_app_enabled',
  'nav_enabled','lato_enabled','month_rhythm_enabled','slate_app_enabled','brand_enabled',
  'hovernav_enabled','org_profile_enabled','deskplus_enabled','threadmenu_enabled',
  'slateplus_enabled','client_page_drop_enabled','client_page_drop_pilot',
  'client_upload_notify_enabled','members_area_open','members_staff_enabled',
  'create_menu_enabled','slatesimple_enabled','desk_peek_enabled']) k),
  'every earlier owner-only key is kept');
select pg_temp.ok(not public.tk__owner_only_key('month_rhythm') and not public.tk__owner_only_key('layout_defaults')
                  and not public.tk__owner_only_key('reviewboard') and not public.tk__owner_only_key('wb_gl_due_bday'),
  'other keys stay admin-writable');

-- 3. No switch row exists (missing = off)
select pg_temp.ok((select count(*) = 0 from tk_settings
                    where key in ('reviewboard_enabled','reviewboard_digest_enabled','reviewboard_digest_to')),
  'no row for the three keys');

-- 4. A non-owner admin cannot set any of them
insert into t_ctx
select 'admin', lower(s.email) from staff s
 where s.active and s.role = 'admin'
   and not exists (select 1 from internal_access ia where lower(ia.staff_email) = lower(s.email) and ia.is_owner)
 order by s.email limit 1;
select pg_temp.ok(pg_temp.ctx('admin') is not null, 'test admin found');
set local role authenticated;
select pg_temp.as_user(pg_temp.ctx('admin'));
select pg_temp.expect_err($q$insert into tk_settings (key, value) values ('reviewboard_enabled', 'true')$q$,
  'tk_owner_only', 'a non-owner admin cannot turn the Review board on');
select pg_temp.expect_err($q$insert into tk_settings (key, value) values ('reviewboard_digest_enabled', 'true')$q$,
  'tk_owner_only', 'a non-owner admin cannot turn the digest on');
select pg_temp.expect_err($q$insert into tk_settings (key, value) values ('reviewboard_digest_to', '["x@example.test"]')$q$,
  'tk_owner_only', 'a non-owner admin cannot set the digest list');
reset role;
select pg_temp.as_user(null);
select pg_temp.ok((select count(*) = 0 from tk_settings
                    where key in ('reviewboard_enabled','reviewboard_digest_enabled','reviewboard_digest_to')),
  'refused writes changed no row');

select 'all ok' as result;
rollback;
