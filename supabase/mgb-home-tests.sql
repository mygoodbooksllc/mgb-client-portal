-- MGB Home S1: tests for mgb-home-s1.sql (and the locks MGB Home relies on).
-- NOT a migration. Run AFTER mgb-home-s1.sql has been applied, in the Supabase
-- SQL editor (or psql as postgres). Everything runs in one transaction that
-- ends in ROLLBACK, so no fixture survives. A failing check is collected; the
-- run ends by raising 'mgb-home tests FAILED: ...' listing every failure, or
-- with the notice 'mgb-home tests: all N passed'.
--
-- Personas are picked from the live staff table by role (no emails here):
--   owner    the active admin named in internal_access with is_owner (has the grant)
--   adm_no   an active admin WITHOUT a grant row (if every admin has one, the
--            owner switches one off inside the transaction)
--   bk       an active bookkeeper
--
-- Fixtures use the year 1999 and the marker 'mh-test' so they never collide
-- with real rows.

begin;

create temp table _mh (n serial, name text, ok boolean, detail text);
create temp table _who (k text primary key, email text);

create or replace function pg_temp.chk(p_name text, p_ok boolean, p_detail text default null)
returns void language plpgsql as $$
begin
  insert into _mh(name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail);
end $$;

create or replace function pg_temp.claims(p_email text)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    case when p_email is null then ''
         else json_build_object('email', p_email, 'role', 'authenticated', 'sub', gen_random_uuid(),
                'app_metadata', json_build_object('provider', 'google', 'providers', json_build_array('google')))::text end,
    true);
end $$;

-- One scalar query as an authenticated user: the value as text, or
-- 'ERR:<sqlstate>:<message>' when it raised.
create or replace function pg_temp.probe(p_email text, p_sql text)
returns text language plpgsql as $$
declare v text;
begin
  perform pg_temp.claims(p_email);
  set local role authenticated;
  begin
    execute p_sql into v;
    v := coalesce(v, 'null');
  exception when others then
    v := 'ERR:' || sqlstate || ':' || left(sqlerrm, 90);
  end;
  reset role;
  perform pg_temp.claims(null);
  return v;
end $$;

-- Rows changed by one DML statement as an authenticated user ('ERR:...' when refused).
create or replace function pg_temp.dml(p_email text, p_sql text)
returns text language plpgsql as $$
declare n int;
begin
  perform pg_temp.claims(p_email);
  set local role authenticated;
  begin
    execute p_sql;
    get diagnostics n = row_count;
  exception when others then
    reset role;
    perform pg_temp.claims(null);
    return 'ERR:' || sqlstate;
  end;
  reset role;
  perform pg_temp.claims(null);
  return n::text;
end $$;

-- ---------------------------------------------------------------------------
-- Personas and fixtures
-- ---------------------------------------------------------------------------
insert into _who select 'owner', ia.staff_email from internal_access ia
  join staff s on s.email = ia.staff_email and s.role = 'admin' and s.active
 where ia.is_owner limit 1;
insert into _who select 'adm_no', s.email from staff s
 where s.role = 'admin' and s.active
   and not exists (select 1 from internal_access ia where ia.staff_email = s.email)
 order by s.email limit 1;
do $$
declare v text;
begin
  if not exists (select 1 from _who where k = 'adm_no') then
    select s.email into v from staff s
     where s.role = 'admin' and s.active and s.email <> (select email from _who where k = 'owner')
     order by s.email limit 1;
    perform pg_temp.claims((select email from _who where k = 'owner'));
    perform set_internal_access(v, false);
    perform pg_temp.claims(null);
    insert into _who values ('adm_no', v);
  end if;
end $$;
insert into _who select 'bk', email from staff where role = 'bookkeeper' and active order by email limit 1;

-- One hour of firm time in January 1999 at a 100/hour rate, no customer.
insert into qbo_time_activities (realm_id, qbo_id, txn_date, minutes, hourly_rate, billable_status)
  values (coalesce((select realm_id from qbo_time_activities limit 1), 'mh-test-realm'),
          'mh-test-1', date '1999-01-15', 60, 100, 'Billable');

-- An internal-only guide article, as the drafted mgb-home article would be.
delete from staff_guide where slug = 'mgb-home';
insert into staff_guide (slug, title, section, audience, body_md)
  values ('mgb-home', 'MGB Home', 'Admin', 'admin',
          'mhtestzqx MGB Home fixture article (rolled back).');

-- A view of an MGB Home page by the owner, logged against the internal company.
insert into usage_events (occurred_at, actor_email, actor_role, client_id, page, tab, kind)
  values (now() + interval '1 minute', (select email from _who where k = 'owner'), 'staff',
          (select id from clients where is_internal order by id limit 1), 'mgb-profitability', null, 'view');

do $$
begin
  perform pg_temp.chk('personas found: owner, adm_no, bk',
    (select count(*) from _who where email is not null) = 3,
    (select string_agg(k, ',') from _who));
  perform pg_temp.chk('adm_no is an active admin without the grant',
    exists (select 1 from staff s join _who w on w.email = s.email and w.k = 'adm_no'
             where s.role = 'admin' and s.active)
    and not exists (select 1 from internal_access ia join _who w on w.email = ia.staff_email and w.k = 'adm_no'));
  perform pg_temp.chk('an internal company exists', exists (select 1 from clients where is_internal));
  perform pg_temp.chk('no mgb_home_enabled switch row exists (missing = off)',
    not exists (select 1 from tk_settings where key = 'mgb_home_enabled'));
end $$;

-- ---------------------------------------------------------------------------
-- Checks
-- ---------------------------------------------------------------------------
do $$
declare
  own text := (select email from _who where k = 'owner');
  adm text := (select email from _who where k = 'adm_no');
  bk  text := (select email from _who where k = 'bk');
  v text;
begin
  perform pg_temp.chk('owner: can_view_internal() true',   pg_temp.probe(own, 'select public.can_view_internal()') = 'true');
  perform pg_temp.chk('adm_no: can_view_internal() false', pg_temp.probe(adm, 'select public.can_view_internal()') = 'false');

  -- 1. qbo_hours_by_client: hours for any admin, money only with the grant.
  v := pg_temp.probe(adm, $q$select sum(total_minutes) from public.qbo_hours_by_client(date '1999-01-01', date '1999-01-31')$q$);
  perform pg_temp.chk('qbo_hours_by_client: adm_no still gets hours', v = '60', v);
  v := pg_temp.probe(adm, $q$select count(*) from public.qbo_hours_by_client(date '1999-01-01', date '1999-01-31') where billable_value is not null$q$);
  perform pg_temp.chk('qbo_hours_by_client: billable_value null for adm_no', v = '0', v);
  v := pg_temp.probe(adm, $q$select sum(billable_minutes) from public.qbo_hours_by_client(date '1999-01-01', date '1999-01-31')$q$);
  perform pg_temp.chk('qbo_hours_by_client: billable hours kept for adm_no', v = '60', v);
  v := pg_temp.probe(own, $q$select sum(billable_value) from public.qbo_hours_by_client(date '1999-01-01', date '1999-01-31')$q$);
  perform pg_temp.chk('qbo_hours_by_client: owner gets billable_value', v = '100.00', v);
  v := pg_temp.probe(bk, $q$select count(*) from public.qbo_hours_by_client(date '1999-01-01', date '1999-01-31')$q$);
  perform pg_temp.chk('qbo_hours_by_client: refused for a bookkeeper', v like 'ERR:%', v);

  -- 2. Profitability RPC stays refused without the grant.
  v := pg_temp.probe(adm, $q$select count(*) from public.client_profitability(current_date - 30, current_date, '{}'::jsonb)$q$);
  perform pg_temp.chk('client_profitability(): refused for adm_no', v like 'ERR:42501:%', v);
  v := pg_temp.probe(own, $q$select count(*) from public.client_profitability(current_date - 30, current_date, '{}'::jsonb)$q$);
  perform pg_temp.chk('client_profitability(): runs for owner', v not like 'ERR:%', v);

  -- 3. Firm switch mgb_home_enabled: owner-only, never written by adm_no.
  perform pg_temp.chk('tk__owner_only_key(mgb_home_enabled) true', public.tk__owner_only_key('mgb_home_enabled'));
  perform pg_temp.chk('owner-only list kept (threadmenu_enabled)', public.tk__owner_only_key('threadmenu_enabled'));
  perform pg_temp.chk('owner-only list kept (client_upload_notify_enabled)', public.tk__owner_only_key('client_upload_notify_enabled'));
  perform pg_temp.chk('ordinary key is not owner-only', not public.tk__owner_only_key('mh_test_plain_key'));
  v := pg_temp.dml(adm, $q$insert into public.tk_settings (key, value) values ('mgb_home_enabled', 'true'::jsonb)$q$);
  perform pg_temp.chk('tk_settings mgb_home_enabled insert: refused for adm_no', v like 'ERR:%', v);
  perform pg_temp.chk('no switch row after adm_no insert', not exists (select 1 from tk_settings where key = 'mgb_home_enabled'));
  v := pg_temp.probe(adm, $q$select count(*) from public.tk_settings where key = 'mgb_home_enabled'$q$);
  perform pg_temp.chk('tk_settings mgb_home_enabled: adm_no reads nothing', v = '0', v);

  -- 4. Staff guide: the mgb-home article only with the grant.
  v := pg_temp.probe(adm, $q$select count(*) from public.staff_guide where slug = 'mgb-home'$q$);
  perform pg_temp.chk('staff_guide: adm_no cannot read mgb-home', v = '0', v);
  v := pg_temp.probe(adm, $q$select count(*) from public.search_staff_guide('mhtestzqx')$q$);
  perform pg_temp.chk('search_staff_guide: no mgb-home hit for adm_no', v = '0', v);
  v := pg_temp.probe(adm, $q$select count(*) from public.staff_guide where slug = 'profitability'$q$);
  perform pg_temp.chk('staff_guide: profitability still hidden from adm_no', v = '0', v);
  v := pg_temp.probe(adm, $q$select count(*) from public.staff_guide where slug = 'admin-guide'$q$);
  perform pg_temp.chk('staff_guide: adm_no still reads other admin articles', v = '1', v);
  v := pg_temp.probe(adm, $q$select count(*) from public.staff_guide where body_md ilike '%MGB Home%' or title ilike '%MGB Home%'$q$);
  perform pg_temp.chk('staff_guide: no article adm_no can read names MGB Home', v = '0', v);
  v := pg_temp.probe(own, $q$select count(*) from public.staff_guide where slug = 'mgb-home'$q$);
  perform pg_temp.chk('staff_guide: owner reads mgb-home', v = '1', v);
  v := pg_temp.probe(own, $q$select count(*) from public.search_staff_guide('mhtestzqx') where slug = 'mgb-home'$q$);
  perform pg_temp.chk('search_staff_guide: owner finds mgb-home', v = '1', v);
  v := pg_temp.probe(own, $q$select count(*) from public.staff_guide where slug = 'profitability'$q$);
  perform pg_temp.chk('staff_guide: owner still reads profitability', v = '1', v);

  -- 5. Usage stats: MGB Home page views stay hidden from adm_no.
  v := pg_temp.probe(adm, $q$select count(*) from public.usage_events where page = 'mgb-profitability'$q$);
  perform pg_temp.chk('usage_events: adm_no cannot read MGB Home views', v = '0', v);
  v := pg_temp.probe(own, $q$select count(*) from public.usage_events where page = 'mgb-profitability'$q$);
  perform pg_temp.chk('usage_events: owner reads MGB Home views', v not like 'ERR:%' and v::int >= 1, v);
  v := pg_temp.probe(adm, $q$select (public.usage_summary(30)::text like '%mgb-%')::text$q$);
  perform pg_temp.chk('usage_summary: no mgb-* page for adm_no', v = 'false', v);
  v := pg_temp.probe(adm, format($q$select coalesce(public.staff_last_seen(%L)->'last_view'->>'page', 'none')$q$, own));
  perform pg_temp.chk('staff_last_seen: adm_no never sees an MGB Home page as last view', v not like 'mgb-%' and v not like 'ERR:%', v);
  v := pg_temp.probe(own, format($q$select public.staff_last_seen(%L)->'last_view'->>'page'$q$, own));
  perform pg_temp.chk('staff_last_seen: owner sees own MGB Home last view', v = 'mgb-profitability', v);
end $$;

do $$
declare bad text;
begin
  select string_agg(name || coalesce(' [' || detail || ']', ''), E'\n  ') into bad from _mh where not ok;
  if bad is not null then
    raise exception E'mgb-home tests FAILED:\n  %', bad;
  end if;
  raise notice 'mgb-home tests: all % passed', (select count(*) from _mh);
end $$;

rollback;
