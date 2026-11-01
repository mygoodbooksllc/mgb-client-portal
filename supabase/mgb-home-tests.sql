-- MGB Home S1 + S2: tests for mgb-home-s1.sql, mgb-home-s2.sql (and the locks
-- MGB Home relies on).
-- NOT a migration. Run AFTER both have been applied, in the Supabase
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

-- ===========================================================================
-- S2 (mgb-home-s2.sql): Overhead. internal_hours(), the internal customers
-- dropping out of the hours RPCs for every admin, and the mapping lock.
-- ===========================================================================
-- Fixtures, all in a test realm, February and March 1999:
--   customer mh-int  mapped to the internal client
--   customer mh-cli  mapped to an ordinary roster client
--   employee mh-e1   mapped to the owner (cost rate 50/hour from 1999-01-01)
--   employee mh-e2   not mapped to anyone (costed at the average rate, estimated)
--   t1  mh-e1  mh-int  1999-02-10  120 min  item Hours, "Team meeting"
--   t2  mh-e1  mh-cli  1999-02-11   60 min
--   t3  mh-e2  mh-int  1999-03-05   30 min  no description
--   t4  mh-e1  none    1999-03-06   15 min  (no customer)
-- Expected for the owner, 1999-02-01..1999-03-31: 150 internal minutes, cost
-- 100.00 (t1) + 25.00 (t3 at the 50 average, estimated) = 125.00; all minutes
-- 225; the owner's own share 120 of 195.
insert into qbo_customer_client_map (realm_id, qbo_customer_id, customer_name, client_id, manual)
  values ('mh-test-realm-s2', 'mh-int', 'mh-test internal', (select id from clients where is_internal order by id limit 1), true),
         ('mh-test-realm-s2', 'mh-cli', 'mh-test client',
          (select id from clients where not coalesce(is_internal, false) and public.is_roster_client_id(id) order by id limit 1), true);
-- A job under mh-int with no mapping of its own: it reaches the internal
-- client only through its parent (the review's sub-customer case).
insert into qbo_customer_client_map (realm_id, qbo_customer_id, customer_name, client_id, parent_qbo_id, manual)
  values ('mh-test-realm-s2', 'mh-int-job', 'mh-test internal:job', null, 'mh-int', false);
insert into qbo_employee_staff_map (realm_id, qbo_entity_type, qbo_id, display_name, staff_email, manual)
  values ('mh-test-realm-s2', 'Employee', 'mh-e1', 'mh-test owner', (select email from _who where k = 'owner'), true);
insert into staff_cost_rates (staff_email, effective_from, hourly_cost, updated_by)
  values (lower((select email from _who where k = 'owner')), date '1999-01-01', 50, 'mh-test');
insert into qbo_time_activities (realm_id, qbo_id, txn_date, minutes, employee_qbo_id, employee_name,
                                 customer_qbo_id, customer_name, item_name, description, billable_status)
  values ('mh-test-realm-s2', 'mh-test-s2-1', date '1999-02-10', 120, 'mh-e1', 'mh-test owner', 'mh-int', 'mh-test internal', 'Hours', 'Team meeting', 'NotBillable'),
         ('mh-test-realm-s2', 'mh-test-s2-2', date '1999-02-11',  60, 'mh-e1', 'mh-test owner', 'mh-cli', 'mh-test client',   'Hours', 'Client work',  'Billable'),
         ('mh-test-realm-s2', 'mh-test-s2-3', date '1999-03-05',  30, 'mh-e2', 'mh-test helper', 'mh-int', 'mh-test internal', 'Hours', null,           'NotBillable'),
         ('mh-test-realm-s2', 'mh-test-s2-4', date '1999-03-06',  15, 'mh-e1', 'mh-test owner', null,     null,               null,    null,           'NotBillable');

do $$
declare
  own text := (select email from _who where k = 'owner');
  adm text := (select email from _who where k = 'adm_no');
  bk  text := (select email from _who where k = 'bk');
  q   text := $q$select public.internal_hours(date '1999-02-01', date '1999-03-31')::text$q$;
  v text;
  j jsonb;
begin
  perform pg_temp.chk('S2 fixture: a roster client exists for mh-cli',
    exists (select 1 from qbo_customer_client_map where qbo_customer_id = 'mh-cli' and client_id is not null));

  -- 1. internal_hours: refused without the grant.
  v := pg_temp.probe(adm, q);
  perform pg_temp.chk('internal_hours: refused 42501 for adm_no', v like 'ERR:42501:%', v);
  v := pg_temp.probe(bk, q);
  perform pg_temp.chk('internal_hours: refused 42501 for a bookkeeper', v like 'ERR:42501:%', v);
  v := pg_temp.probe(null, q);
  perform pg_temp.chk('internal_hours: refused 42501 with no jwt', v like 'ERR:42501:%', v);
  perform pg_temp.chk('internal_hours: anon has no execute',
    not has_function_privilege('anon', 'public.internal_hours(date,date)', 'execute'));
  perform pg_temp.chk('internal_hours: security definer',
    (select prosecdef from pg_proc where oid = 'public.internal_hours(date,date)'::regprocedure));
  v := pg_temp.probe(own, $q$select public.internal_hours(date '1999-03-31', date '1999-02-01')::text$q$);
  perform pg_temp.chk('internal_hours: reversed range refused 22023', v like 'ERR:22023:%', v);
  v := pg_temp.probe(own, $q$select public.internal_hours(date '1990-01-01', date '1999-03-31')::text$q$);
  perform pg_temp.chk('internal_hours: range over 3 years refused 22023', v like 'ERR:22023:%', v);

  -- 2. internal_hours for the owner: minutes, cost, share, months, lines.
  v := pg_temp.probe(own, q);
  perform pg_temp.chk('internal_hours: runs for owner', v not like 'ERR:%', left(v, 120));
  if v not like 'ERR:%' then
    j := v::jsonb;
    perform pg_temp.chk('internal_hours: total minutes 150', (j->'totals'->>'minutes') = '150', j->'totals'->>'minutes');
    perform pg_temp.chk('internal_hours: total cost 125.00', (j->'totals'->>'cost')::numeric = 125, j->'totals'->>'cost');
    perform pg_temp.chk('internal_hours: estimated cost 25.00 (unmapped person at the average)',
      (j->'totals'->>'estimated_cost')::numeric = 25, j->'totals'->>'estimated_cost');
    perform pg_temp.chk('internal_hours: estimated minutes 30', (j->'totals'->>'estimated_minutes') = '30', j->'totals'->>'estimated_minutes');
    perform pg_temp.chk('internal_hours: all minutes 225', (j->'totals'->>'all_minutes') = '225', j->'totals'->>'all_minutes');
    perform pg_temp.chk('internal_hours: no-customer minutes 15', (j->'totals'->>'no_customer_minutes') = '15', j->'totals'->>'no_customer_minutes');
    perform pg_temp.chk('internal_hours: 2 people', (j->'totals'->>'people') = '2', j->'totals'->>'people');
    perform pg_temp.chk('internal_hours: rates_set true', (j->>'rates_set') = 'true', j->>'rates_set');
    perform pg_temp.chk('internal_hours: owner row 120 of 195, cost 100, not estimated',
      exists (select 1 from jsonb_array_elements(j->'people') p
               where p->>'staff_email' = lower(own) and (p->>'minutes') = '120' and (p->>'all_minutes') = '195'
                 and (p->>'cost')::numeric = 100 and (p->>'estimated') = 'false'),
      (j->'people')::text);
    perform pg_temp.chk('internal_hours: unmapped person 30 min, estimated, not mapped',
      exists (select 1 from jsonb_array_elements(j->'people') p
               where p->>'name' = 'mh-test helper' and (p->>'minutes') = '30' and (p->>'estimated') = 'true'
                 and (p->>'mapped') = 'false' and (p->>'cost')::numeric = 25),
      (j->'people')::text);
    perform pg_temp.chk('internal_hours: months Feb 120 / Mar 30',
      jsonb_array_length(j->'months') = 2
      and (j->'months'->0->>'month') = '1999-02-01' and (j->'months'->0->>'minutes') = '120'
      and (j->'months'->1->>'month') = '1999-03-01' and (j->'months'->1->>'minutes') = '30',
      (j->'months')::text);
    perform pg_temp.chk('internal_hours: 2 lines, top is "Team meeting" 120 min',
      jsonb_array_length(j->'lines') = 2
      and (j->'lines'->0->>'description') = 'Team meeting' and (j->'lines'->0->>'minutes') = '120'
      and (j->'lines'->0->>'item') = 'Hours',
      (j->'lines')::text);
    perform pg_temp.chk('internal_hours: no revenue or rate keys in the answer',
      v not ilike '%revenue%' and v not ilike '%hourly_rate%' and v not ilike '%billable%');
  end if;

  -- 3. Hours RPCs: internal customers drop out for every admin.
  v := pg_temp.probe(adm, $q$select sum(total_minutes) from public.qbo_hours_by_client(date '1999-02-01', date '1999-03-31')$q$);
  perform pg_temp.chk('qbo_hours_by_client: adm_no total excludes internal time (60 + 15)', v = '75', v);
  v := pg_temp.probe(adm, $q$select count(*) from public.qbo_hours_by_client(date '1999-02-01', date '1999-03-31') where bucket = 'unmapped'$q$);
  perform pg_temp.chk('qbo_hours_by_client: adm_no sees no unmapped bucket for internal time', v = '0', v);
  v := pg_temp.probe(own, $q$select sum(total_minutes) from public.qbo_hours_by_client(date '1999-02-01', date '1999-03-31')$q$);
  perform pg_temp.chk('qbo_hours_by_client: owner gets the same total', v = '75', v);
  v := pg_temp.probe(adm, $q$select sum(unmapped_customer_minutes) from public.qbo_hours_by_staff(date '1999-02-01', date '1999-03-31')$q$);
  perform pg_temp.chk('qbo_hours_by_staff: adm_no counts no internal time as unmapped customer', v = '0', v);
  v := pg_temp.probe(adm, $q$select sum(client_minutes) from public.qbo_hours_by_staff(date '1999-02-01', date '1999-03-31')$q$);
  perform pg_temp.chk('qbo_hours_by_staff: adm_no client minutes 60', v = '60', v);
  v := pg_temp.probe(adm, $q$select sum(total_minutes) from public.qbo_hours_by_staff(date '1999-02-01', date '1999-03-31')$q$);
  perform pg_temp.chk('qbo_hours_by_staff: adm_no still sees every logged minute (225)', v = '225', v);
  v := pg_temp.probe(own, $q$select sum(unmapped_customer_minutes) from public.qbo_hours_by_staff(date '1999-02-01', date '1999-03-31')$q$);
  perform pg_temp.chk('qbo_hours_by_staff: owner counts no internal time as unmapped', v = '0', v);

  -- 4. qbo_internal_customers: ids only, admins only.
  v := pg_temp.probe(adm, $q$select count(*) from public.qbo_internal_customers() where qbo_customer_id = 'mh-int'$q$);
  perform pg_temp.chk('qbo_internal_customers: answers adm_no (ids only)', v = '1', v);
  v := pg_temp.probe(bk, $q$select count(*) from public.qbo_internal_customers()$q$);
  perform pg_temp.chk('qbo_internal_customers: nothing for a bookkeeper', v = '0', v);
  perform pg_temp.chk('qbo_internal_customers: anon has no execute',
    not has_function_privilege('anon', 'public.qbo_internal_customers()', 'execute'));
  v := pg_temp.probe(adm, $q$select count(*) from public.qbo_customer_client_map where qbo_customer_id = 'mh-int'$q$);
  perform pg_temp.chk('qbo_customer_client_map: internal row still hidden from adm_no', v = '0', v);

  -- 5. qbo_set_customer_mapping: an internal-mapped customer needs the grant.
  v := pg_temp.probe(adm, $q$select public.qbo_set_customer_mapping('mh-int', null, false, 'mh-test-realm-s2')::text$q$);
  perform pg_temp.chk('qbo_set_customer_mapping: adm_no reset of internal row refused', v like 'ERR:%', v);
  v := pg_temp.probe(adm, $q$select public.qbo_set_customer_mapping('mh-int', null, true, 'mh-test-realm-s2')::text$q$);
  perform pg_temp.chk('qbo_set_customer_mapping: adm_no ignore of internal row refused', v like 'ERR:%', v);
  v := pg_temp.probe(adm, format($q$select public.qbo_set_customer_mapping('mh-int', %L, false, 'mh-test-realm-s2')::text$q$,
         (select client_id from qbo_customer_client_map where qbo_customer_id = 'mh-cli')));
  perform pg_temp.chk('qbo_set_customer_mapping: adm_no remap of internal row refused', v like 'ERR:%', v);
  perform pg_temp.chk('internal row unchanged after adm_no attempts',
    exists (select 1 from qbo_customer_client_map m join clients c on c.id = m.client_id and c.is_internal
             where m.realm_id = 'mh-test-realm-s2' and m.qbo_customer_id = 'mh-int' and not m.ignored and m.manual));
  v := pg_temp.probe(adm, format($q$select public.qbo_set_customer_mapping('mh-cli', %L, false, 'mh-test-realm-s2')::text$q$,
         (select client_id from qbo_customer_client_map where qbo_customer_id = 'mh-cli')));
  perform pg_temp.chk('qbo_set_customer_mapping: adm_no still maps ordinary customers', v not like 'ERR:%', v);
  v := pg_temp.probe(own, format($q$select public.qbo_set_customer_mapping('mh-int', %L, false, 'mh-test-realm-s2')::text$q$,
         (select id from clients where is_internal order by id limit 1)));
  perform pg_temp.chk('qbo_set_customer_mapping: owner can still change the internal row', v not like 'ERR:%', v);

  v := pg_temp.probe(adm, $q$select public.qbo_set_customer_mapping('mh-int-job', null, true, 'mh-test-realm-s2')::text$q$);
  perform pg_temp.chk('qbo_set_customer_mapping: adm_no ignore of a job under the internal row refused', v like 'ERR:%', v);
  v := pg_temp.probe(adm, format($q$select public.qbo_set_customer_mapping('mh-int-job', %L, false, 'mh-test-realm-s2')::text$q$,
         (select client_id from qbo_customer_client_map where qbo_customer_id = 'mh-cli')));
  perform pg_temp.chk('qbo_set_customer_mapping: adm_no map of a job under the internal row refused', v like 'ERR:%', v);
  perform pg_temp.chk('job under the internal row unchanged',
    exists (select 1 from qbo_customer_client_map where realm_id = 'mh-test-realm-s2' and qbo_customer_id = 'mh-int-job'
             and client_id is null and not ignored));
  v := pg_temp.probe(own, $q$select public.qbo_set_customer_mapping('mh-int-job', null, true, 'mh-test-realm-s2')::text$q$);
  perform pg_temp.chk('qbo_set_customer_mapping: owner can still ignore a job under the internal row', v not like 'ERR:%', v);

  -- 6. Actions logged on an MGB Home page (client_id null, as MGB_track does)
  --    land on the internal client, so adm_no never reads them.
  v := pg_temp.dml(own, $q$insert into public.usage_events (actor_email, actor_role, client_id, page, kind, detail)
         values ((auth.jwt()->>'email'), 'staff', null, 'mgb-overhead', 'action', 'mh-test')$q$);
  perform pg_temp.chk('usage_events: owner action on an mgb page is logged', v = '1', v);
  v := pg_temp.probe(adm, $q$select count(*) from public.usage_events where page like 'mgb-%'$q$);
  perform pg_temp.chk('usage_events: adm_no reads no mgb-* row (views or actions)', v = '0', v);
  v := pg_temp.probe(own, $q$select count(*) from public.usage_events where page = 'mgb-overhead' and detail = 'mh-test'$q$);
  perform pg_temp.chk('usage_events: owner reads the action', v = '1', v);
  perform pg_temp.chk('usage_events: no mgb-* row without a client',
    not exists (select 1 from usage_events where page like 'mgb-%' and client_id is null));

  -- 6b. Help views of the internal-only articles, and actions naming them,
  --     are filed under the internal client too; ordinary help stays open.
  v := pg_temp.dml(own, $q$insert into public.usage_events (actor_email, actor_role, client_id, page, tab, kind, detail)
         values ((auth.jwt()->>'email'), 'staff', null, 'help', 'mgb-home', 'view', 'mh-test-help')$q$);
  perform pg_temp.chk('usage_events: owner help view of mgb-home is logged', v = '1', v);
  v := pg_temp.dml(own, $q$insert into public.usage_events (actor_email, actor_role, client_id, page, kind, detail)
         values ((auth.jwt()->>'email'), 'staff', null, 'today', 'action', 'help-page:profitability')$q$);
  perform pg_temp.chk('usage_events: owner help-page:profitability action is logged', v = '1', v);
  v := pg_temp.dml(own, $q$insert into public.usage_events (actor_email, actor_role, client_id, page, kind, detail)
         values ((auth.jwt()->>'email'), 'staff', null, 'today', 'action', 'guide-search:mh-test overhead')$q$);
  perform pg_temp.chk('usage_events: owner guide search for overhead is logged', v = '1', v);
  v := pg_temp.probe(adm, $q$select count(*) from public.usage_events
         where (page = 'help' and tab in ('mgb-home', 'profitability')) or detail ~ '^help-page:(mgb-home|profitability)$'
            or detail = 'guide-search:mh-test overhead'$q$);
  perform pg_temp.chk('usage_events: adm_no reads no internal-article view, help-page or grant-holder search', v = '0', v);
  v := pg_temp.probe(own, $q$select count(*) from public.usage_events where detail in ('mh-test-help', 'help-page:profitability', 'guide-search:mh-test overhead')$q$);
  perform pg_temp.chk('usage_events: owner reads all three', v::int >= 3, v);
  v := pg_temp.dml(own, $q$insert into public.usage_events (actor_email, actor_role, client_id, page, tab, kind, detail)
         values ((auth.jwt()->>'email'), 'staff', null, 'help', 'whats-new', 'view', 'mh-test-open')$q$);
  v := pg_temp.probe(adm, $q$select count(*) from public.usage_events where detail = 'mh-test-open'$q$);
  perform pg_temp.chk('usage_events: an ordinary help view stays readable by adm_no', v = '1', v);
  v := pg_temp.dml(adm, $q$insert into public.usage_events (actor_email, actor_role, client_id, page, kind, detail)
         values ((auth.jwt()->>'email'), 'staff', null, 'today', 'action', 'guide-search:mh-test overhead adm')$q$);
  v := pg_temp.probe(adm, $q$select count(*) from public.usage_events where detail = 'guide-search:mh-test overhead adm'$q$);
  perform pg_temp.chk('usage_events: adm_no own guide search stays readable to them', v = '1', v);

  -- 7. The live clock-in customer is mapped to the internal client (spec OQ5).
  perform pg_temp.chk('live: "My Good Books (Clock-in Option)" maps to the internal client',
    exists (select 1 from qbo_customer_client_map m join clients c on c.id = m.client_id and c.is_internal
             where m.realm_id = (select realm_id from qbo_firm_connection where id = true)
               and m.customer_name = 'My Good Books (Clock-in Option)'));
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
