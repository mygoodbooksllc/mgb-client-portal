-- MGB Home S1 to S6: tests for mgb-home-s1.sql, mgb-home-s2.sql,
-- mgb-home-s3.sql, mgb-home-s6.sql (and the locks MGB Home relies on; S4 adds
-- no SQL, only the reads behind the Firm books card and the firm Profit & Loss).
-- NOT a migration. Run AFTER all of them have been applied, in the Supabase
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
  q   text := $q$select public.internal_hours(date '1999-02-01', date '1999-03-31', 'staff')::text$q$;
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
    not has_function_privilege('anon', 'public.internal_hours(date,date,text)', 'execute'));
  perform pg_temp.chk('internal_hours: security definer',
    (select prosecdef from pg_proc where oid = 'public.internal_hours(date,date,text)'::regprocedure));
  v := pg_temp.probe(own, $q$select public.internal_hours(date '1999-03-31', date '1999-02-01', 'staff')::text$q$);
  perform pg_temp.chk('internal_hours: reversed range refused 22023', v like 'ERR:22023:%', v);
  v := pg_temp.probe(own, $q$select public.internal_hours(date '1990-01-01', date '1999-03-31', 'staff')::text$q$);
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

-- ===========================================================================
-- S3 (mgb-home-s3.sql): Cost rates. firm_cost_basis (RLS, stamp, audit),
-- the cost basis on client_profitability / internal_hours, and people no
-- longer on staff counted as "former" instead of "estimated".
-- ===========================================================================
-- Fixtures, in the S2 test realm, April 1999 (the owner's rate is 50/hour,
-- the only rate on file before 2026, so the firm average is 50 too):
--   employee mh-e3   QuickBooks mapping ignored (left the firm, no login)
--   t5  mh-e1  mh-int  1999-04-05  60 min
--   t6  mh-e3  mh-int  1999-04-06  60 min   former
--   t7  mh-e2  mh-int  1999-04-07  30 min   unmapped, estimated
--   t8  mh-e3  mh-cli  1999-04-08  60 min   former
--   t9  mh-e1  mh-cli  1999-04-09  60 min
-- Firm cost basis rows (entered by the owner below): 1999-04-06 staff 40 /
-- full 70 (uplift 30), 1999-04-08 staff 40 / full 80 (uplift 40). t5 is
-- before the first row and uses it.
-- Expected, staff basis: internal 150 min, cost 50 + 50 + 25 = 125,
--   estimated 30 min / 25, former 60 min / 50; client mh-cli 120 min, cost 100,
--   former 60, estimated 0.
-- Full basis: internal 80 + 80 + 40 = 200 (estimated 40, former 80); client
--   mh-cli 90 + 90 = 180.
-- Guard: the delete below wipes the owner's real basis unless it is rolled
-- back. SAVEPOINT errors outside an explicit transaction block (begin at the
-- top), so a stray run without it stops here.
savepoint mh_tx_guard;
release savepoint mh_tx_guard;
delete from firm_cost_basis;  -- rolled back; lets the "no basis yet" checks run even after the owner enters values
insert into qbo_employee_staff_map (realm_id, qbo_entity_type, qbo_id, display_name, staff_email, ignored, manual)
  values ('mh-test-realm-s2', 'Employee', 'mh-e3', 'mh-test gone', null, true, true);
insert into qbo_time_activities (realm_id, qbo_id, txn_date, minutes, employee_qbo_id, employee_name,
                                 customer_qbo_id, customer_name, item_name, description, billable_status)
  values ('mh-test-realm-s2', 'mh-test-s3-5', date '1999-04-05', 60, 'mh-e1', 'mh-test owner',  'mh-int', 'mh-test internal', 'Hours', 'Admin', 'NotBillable'),
         ('mh-test-realm-s2', 'mh-test-s3-6', date '1999-04-06', 60, 'mh-e3', 'mh-test gone',   'mh-int', 'mh-test internal', 'Hours', 'Admin', 'NotBillable'),
         ('mh-test-realm-s2', 'mh-test-s3-7', date '1999-04-07', 30, 'mh-e2', 'mh-test helper', 'mh-int', 'mh-test internal', 'Hours', 'Admin', 'NotBillable'),
         ('mh-test-realm-s2', 'mh-test-s3-8', date '1999-04-08', 60, 'mh-e3', 'mh-test gone',   'mh-cli', 'mh-test client',   'Hours', null,    'Billable'),
         ('mh-test-realm-s2', 'mh-test-s3-9', date '1999-04-09', 60, 'mh-e1', 'mh-test owner',  'mh-cli', 'mh-test client',   'Hours', null,    'Billable');

do $$
declare
  own text := (select email from _who where k = 'owner');
  adm text := (select email from _who where k = 'adm_no');
  bk  text := (select email from _who where k = 'bk');
  cli text := (select client_id from qbo_customer_client_map where realm_id = 'mh-test-realm-s2' and qbo_customer_id = 'mh-cli');
  ih  text := $q$select public.internal_hours(date '1999-04-01', date '1999-04-30', %L)::text$q$;
  cp  text := $q$select row_to_json(p)::text from public.client_profitability(date '1999-04-01', date '1999-04-30', '{}'::jsonb, %L) p where p.client_id = %L$q$;
  v text;
  j jsonb;
begin
  -- 1. Signatures: the old ones are gone, the new ones are not for anon.
  perform pg_temp.chk('S3 signatures: old client_profitability(date,date,jsonb) dropped',
    to_regprocedure('public.client_profitability(date,date,jsonb)') is null);
  perform pg_temp.chk('S3 signatures: old internal_hours(date,date) dropped',
    to_regprocedure('public.internal_hours(date,date)') is null);
  perform pg_temp.chk('S3 signatures: anon has no execute on either',
    not has_function_privilege('anon', 'public.client_profitability(date,date,jsonb,text)', 'execute')
    and not has_function_privilege('anon', 'public.internal_hours(date,date,text)', 'execute'));
  perform pg_temp.chk('S3 signatures: client_profitability stays security invoker',
    not (select prosecdef from pg_proc where oid = 'public.client_profitability(date,date,jsonb,text)'::regprocedure));

  -- 2. firm_cost_basis: grant holders only, every command.
  perform pg_temp.chk('firm_cost_basis: RLS on',
    (select relrowsecurity from pg_class where oid = 'public.firm_cost_basis'::regclass));
  perform pg_temp.chk('firm_cost_basis: anon has no table privilege',
    not has_table_privilege('anon', 'public.firm_cost_basis', 'select')
    and not has_table_privilege('anon', 'public.firm_cost_basis', 'insert'));

  v := pg_temp.probe(own, format(ih, 'full'));
  perform pg_temp.chk('internal_hours full: refused 22023 while no basis is set', v like 'ERR:22023:%', v);
  v := pg_temp.probe(own, format(cp, 'full', cli));
  perform pg_temp.chk('client_profitability full: refused 22023 while no basis is set', v like 'ERR:22023:%', v);

  v := pg_temp.dml(adm, $q$insert into public.firm_cost_basis (effective_from, staff_rate, full_rate) values (date '1999-04-06', 1, 2)$q$);
  perform pg_temp.chk('firm_cost_basis: adm_no insert refused', v like 'ERR:%', v);
  v := pg_temp.dml(bk, $q$insert into public.firm_cost_basis (effective_from, staff_rate, full_rate) values (date '1999-04-06', 1, 2)$q$);
  perform pg_temp.chk('firm_cost_basis: bookkeeper insert refused', v like 'ERR:%', v);
  v := pg_temp.dml(null, $q$insert into public.firm_cost_basis (effective_from, staff_rate, full_rate) values (date '1999-04-06', 1, 2)$q$);
  perform pg_temp.chk('firm_cost_basis: no-jwt insert refused', v like 'ERR:%', v);
  v := pg_temp.dml(own, $q$insert into public.firm_cost_basis (effective_from, staff_rate, full_rate) values (date '1999-04-06', 50, 40)$q$);
  perform pg_temp.chk('firm_cost_basis: full below staff refused (check)', v = 'ERR:23514', v);
  v := pg_temp.dml(own, $q$insert into public.firm_cost_basis (effective_from, staff_rate, full_rate, note, updated_by)
         values (date '1999-04-06', 40, 70, 'mh-test', 'spoof@example.com'), (date '1999-04-08', 40, 80, 'mh-test', null)$q$);
  perform pg_temp.chk('firm_cost_basis: owner inserts 2 rows', v = '2', v);
  perform pg_temp.chk('firm_cost_basis: updated_by is the signed-in owner, never what was sent',
    (select bool_and(updated_by = lower(own)) from firm_cost_basis where note = 'mh-test'),
    (select string_agg(coalesce(updated_by, 'null'), ',') from firm_cost_basis where note = 'mh-test'));

  v := pg_temp.probe(adm, $q$select count(*) from public.firm_cost_basis$q$);
  perform pg_temp.chk('firm_cost_basis: adm_no reads nothing', v = '0', v);
  v := pg_temp.probe(bk, $q$select count(*) from public.firm_cost_basis$q$);
  perform pg_temp.chk('firm_cost_basis: bookkeeper reads nothing', v = '0', v);
  v := pg_temp.probe(own, $q$select count(*) from public.firm_cost_basis where note = 'mh-test'$q$);
  perform pg_temp.chk('firm_cost_basis: owner reads both rows', v = '2', v);
  v := pg_temp.dml(adm, $q$update public.firm_cost_basis set full_rate = 999 where note = 'mh-test'$q$);
  perform pg_temp.chk('firm_cost_basis: adm_no update touches nothing', v = '0' or v like 'ERR:%', v);
  v := pg_temp.dml(adm, $q$delete from public.firm_cost_basis where note = 'mh-test'$q$);
  perform pg_temp.chk('firm_cost_basis: adm_no delete touches nothing', v = '0' or v like 'ERR:%', v);
  perform pg_temp.chk('firm_cost_basis: rows unchanged after adm_no attempts',
    (select count(*) from firm_cost_basis where note = 'mh-test' and full_rate in (70, 80)) = 2);

  -- 3. Audit: firm_cost.* rows exist and only grant holders read them.
  perform pg_temp.chk('audit: firm_cost.set written for both rows',
    (select count(*) from audit_log where action = 'firm_cost.set' and target_id in ('1999-04-06', '1999-04-08')) = 2);
  v := pg_temp.probe(adm, $q$select count(*) from public.audit_log where action like 'firm_cost.%'$q$);
  perform pg_temp.chk('audit: adm_no reads no firm_cost row', v = '0', v);
  v := pg_temp.probe(own, $q$select count(*) from public.audit_log where action = 'firm_cost.set' and target_id in ('1999-04-06', '1999-04-08')$q$);
  perform pg_temp.chk('audit: owner reads the firm_cost rows', v = '2', v);

  -- 4. Basis argument checks and refusals.
  v := pg_temp.probe(own, format(ih, 'bogus'));
  perform pg_temp.chk('internal_hours: unknown basis refused 22023', v like 'ERR:22023:%', v);
  v := pg_temp.probe(own, format(cp, 'bogus', cli));
  perform pg_temp.chk('client_profitability: unknown basis refused 22023', v like 'ERR:22023:%', v);
  v := pg_temp.probe(adm, format(ih, 'full'));
  perform pg_temp.chk('internal_hours full: refused 42501 for adm_no', v like 'ERR:42501:%', v);
  v := pg_temp.probe(adm, format(cp, 'full', cli));
  perform pg_temp.chk('client_profitability full: refused 42501 for adm_no', v like 'ERR:42501:%', v);
  v := pg_temp.probe(bk, format(cp, 'staff', cli));
  perform pg_temp.chk('client_profitability: refused 42501 for a bookkeeper', v like 'ERR:42501:%', v);

  -- 5. internal_hours, staff basis: former is not estimated.
  v := pg_temp.probe(own, format(ih, 'staff'));
  perform pg_temp.chk('internal_hours staff: runs for owner', v not like 'ERR:%', left(v, 120));
  if v not like 'ERR:%' then
    j := v::jsonb;
    perform pg_temp.chk('internal_hours staff: 150 min, cost 125', (j->'totals'->>'minutes') = '150' and (j->'totals'->>'cost')::numeric = 125, (j->'totals')::text);
    perform pg_temp.chk('internal_hours staff: estimated 30 min / 25 (unmapped helper only)',
      (j->'totals'->>'estimated_minutes') = '30' and (j->'totals'->>'estimated_cost')::numeric = 25, (j->'totals')::text);
    perform pg_temp.chk('internal_hours staff: former 60 min / 50',
      (j->'totals'->>'former_minutes') = '60' and (j->'totals'->>'former_cost')::numeric = 50, (j->'totals')::text);
    perform pg_temp.chk('internal_hours staff: basis echoed', (j->>'basis') = 'staff', j->>'basis');
    perform pg_temp.chk('internal_hours staff: person who left is former, not estimated',
      exists (select 1 from jsonb_array_elements(j->'people') p
               where p->>'name' = 'mh-test gone' and (p->>'former') = 'true' and (p->>'estimated') = 'false'
                 and (p->>'cost')::numeric = 50),
      (j->'people')::text);
    perform pg_temp.chk('internal_hours staff: unmapped current person still estimated',
      exists (select 1 from jsonb_array_elements(j->'people') p
               where p->>'name' = 'mh-test helper' and (p->>'estimated') = 'true' and (p->>'former') = 'false'),
      (j->'people')::text);
  end if;

  -- 6. internal_hours, full basis: rate + firm uplift at the entry date.
  v := pg_temp.probe(own, format(ih, 'full'));
  perform pg_temp.chk('internal_hours full: runs for owner', v not like 'ERR:%', left(v, 120));
  if v not like 'ERR:%' then
    j := v::jsonb;
    perform pg_temp.chk('internal_hours full: cost 200 (80 + 80 + 40)', (j->'totals'->>'cost')::numeric = 200, (j->'totals')::text);
    perform pg_temp.chk('internal_hours full: estimated 40, former 80',
      (j->'totals'->>'estimated_cost')::numeric = 40 and (j->'totals'->>'former_cost')::numeric = 80, (j->'totals')::text);
    perform pg_temp.chk('internal_hours full: minutes unchanged (150)', (j->'totals'->>'minutes') = '150', (j->'totals')::text);
    perform pg_temp.chk('internal_hours full: basis echoed', (j->>'basis') = 'full', j->>'basis');
  end if;

  -- 7. client_profitability per client, both bases.
  v := pg_temp.probe(own, format(cp, 'staff', cli));
  perform pg_temp.chk('client_profitability staff: runs for owner', v not like 'ERR:%' and v <> 'null', left(v, 160));
  if v not like 'ERR:%' and v <> 'null' then
    j := v::jsonb;
    perform pg_temp.chk('client_profitability staff: 120 min, cost 100',
      (j->>'total_minutes') = '120' and (j->>'cost')::numeric = 100, v);
    perform pg_temp.chk('client_profitability staff: former 60 min, nothing estimated',
      (j->>'former_minutes') = '60' and (j->>'former_cost')::numeric = 50
      and (j->>'estimated_minutes') = '0' and (j->>'estimated_cost')::numeric = 0, v);
    perform pg_temp.chk('client_profitability staff: per-person former flag',
      exists (select 1 from jsonb_array_elements(j->'staff_costs') s
               where s->>'staff_name' = 'mh-test gone' and (s->>'former') = 'true' and (s->>'estimated') = 'false'), v);
    perform pg_temp.chk('client_profitability staff: basis column', (j->>'basis') = 'staff', v);
  end if;
  v := pg_temp.probe(own, format(cp, 'full', cli));
  perform pg_temp.chk('client_profitability full: runs for owner', v not like 'ERR:%' and v <> 'null', left(v, 160));
  if v not like 'ERR:%' and v <> 'null' then
    j := v::jsonb;
    perform pg_temp.chk('client_profitability full: cost 180 (90 + 90)', (j->>'cost')::numeric = 180, v);
    perform pg_temp.chk('client_profitability full: basis column', (j->>'basis') = 'full', v);
  end if;
  v := pg_temp.probe(own, $q$select count(*) from public.client_profitability(date '1999-04-01', date '1999-04-30')$q$);
  perform pg_temp.chk('client_profitability: 2-arg named-style call still works (default basis)', v not like 'ERR:%' and v::int > 0, v);
  v := pg_temp.probe(own, $q$select count(*) from public.client_health()$q$);
  perform pg_temp.chk('client_health: still runs (positional 3-arg client_profitability call)', v not like 'ERR:%', v);

  -- 8. Cost rates page usage is filed under the internal client.
  v := pg_temp.dml(own, $q$insert into public.usage_events (actor_email, actor_role, client_id, page, kind, detail)
         values ((auth.jwt()->>'email'), 'staff', null, 'mgb-costs', 'action', 'mh-test-s3')$q$);
  perform pg_temp.chk('usage_events: owner action on Cost rates logged', v = '1', v);
  v := pg_temp.dml(own, $q$insert into public.usage_events (actor_email, actor_role, client_id, page, kind, detail)
         values ((auth.jwt()->>'email'), 'staff', null, 'today', 'action', 'cmdk-go:#/internal/costs')$q$);
  perform pg_temp.chk('usage_events: owner action naming #/internal/costs logged', v = '1', v);
  v := pg_temp.dml(own, $q$insert into public.usage_events (actor_email, actor_role, client_id, page, kind, detail)
         values ((auth.jwt()->>'email'), 'staff', null, 'today', 'action', 'guide-search:mh-test cost rate')$q$);
  v := pg_temp.probe(adm, $q$select count(*) from public.usage_events
         where detail in ('mh-test-s3', 'cmdk-go:#/internal/costs', 'guide-search:mh-test cost rate')$q$);
  perform pg_temp.chk('usage_events: adm_no reads none of the Cost rates rows', v = '0', v);
  v := pg_temp.probe(own, $q$select count(*) from public.usage_events
         where detail in ('mh-test-s3', 'cmdk-go:#/internal/costs', 'guide-search:mh-test cost rate')$q$);
  perform pg_temp.chk('usage_events: owner reads all three', v = '3', v);

  -- 9. Rates: adm_no never reads one; no rate row for anyone off staff.
  v := pg_temp.probe(adm, $q$select count(*) from public.staff_cost_rates$q$);
  perform pg_temp.chk('staff_cost_rates: adm_no reads nothing', v = '0', v);
  perform pg_temp.chk('live: every stored rate belongs to a staff row (no rows for people who left)',
    not exists (select 1 from staff_cost_rates r
                 where coalesce(r.updated_by, '') <> 'mh-test'
                   and not exists (select 1 from staff s where lower(s.email) = lower(r.staff_email))));
end $$;

-- ===========================================================================
-- S4: Firm books polish. No new SQL; the Home Firm books card reads
-- month_close, close_checks, qbo_connections, qbo_sync_runs and
-- month_close_settings, and the firm Profit & Loss reads the internal
-- client's QuickBooks rows (qbo_monthly_pl, qbo_pl_lines: client.monthly and
-- the P&L PDF). Every client_id table stays behind the internal
-- company lock: adm_no and bk read none of the firm's rows, the owner reads
-- them all. Live rows (counted as postgres), nothing written.
-- ===========================================================================
do $$
declare
  own text := (select email from _who where k = 'owner');
  adm text := (select email from _who where k = 'adm_no');
  bk  text := (select email from _who where k = 'bk');
  iid text := (select id from clients where is_internal order by id limit 1);
  t   text;
  v   text;
  n   bigint;
begin
  perform pg_temp.chk('S4: an internal client exists', iid is not null, iid);
  foreach t in array array['month_close', 'close_checks', 'qbo_connections', 'qbo_sync_runs', 'qbo_account_status',
                             'qbo_monthly_pl', 'qbo_pl_lines'] loop
    if to_regclass('public.' || t) is null then
      perform pg_temp.chk('S4 ' || t || ': table exists', false);
      continue;
    end if;
    execute format('select count(*) from public.%I where client_id = %L', t, iid) into n;
    v := pg_temp.probe(own, format('select count(*) from public.%I where client_id = %L', t, iid));
    perform pg_temp.chk('S4 ' || t || ': owner reads every firm row (' || n || ')', v = n::text, v);
    v := pg_temp.probe(adm, format('select count(*) from public.%I where client_id = %L', t, iid));
    perform pg_temp.chk('S4 ' || t || ': adm_no reads no firm row', v = '0', v);
    v := pg_temp.probe(bk, format('select count(*) from public.%I where client_id = %L', t, iid));
    perform pg_temp.chk('S4 ' || t || ': bookkeeper reads no firm row', v = '0', v);
  end loop;
  -- The card's late day is plain staff config (no money): every staff reads it.
  v := pg_temp.probe(bk, $q$select count(*) from public.month_close_settings$q$);
  perform pg_temp.chk('S4 month_close_settings: bookkeeper reads the late day', v <> '0' and v not like 'ERR:%', v);
  -- Sync now for the firm: adm_no can't touch the firm connection row.
  v := pg_temp.dml(adm, format($q$update public.qbo_connections set updated_at = updated_at where client_id = %L$q$, iid));
  perform pg_temp.chk('S4 qbo_connections: adm_no updates no firm row', v = '0' or v like 'ERR:%', v);
end $$;

-- ===========================================================================
-- S6 (mgb-home-s6.sql): Capacity. capacity_inputs() (grant holders only),
-- cost_contract_clients and staff_cost_allocations (RLS on every command,
-- stamp, audit, internal company lock), the seeds, and usage filing.
-- Fixture: the S2/S3 April 1999 rows. The owner marks the mh-cli client as a
-- contract (rolled back), so the owner's April has 60 contract minutes of 120.
-- Seed checks run first, before the owner writes test rows.
-- ===========================================================================
do $$
declare
  own text := (select email from _who where k = 'owner');
  adm text := (select email from _who where k = 'adm_no');
  bk  text := (select email from _who where k = 'bk');
  cli text := (select client_id from qbo_customer_client_map where realm_id = 'mh-test-realm-s2' and qbo_customer_id = 'mh-cli');
  ci  text := $q$select public.capacity_inputs(date '1999-04-01', date '1999-04-30', %L)::text$q$;
  t   text;
  v   text;
  n   bigint;
  j   jsonb;
begin
  -- 1. Seeds (live rows): IHH is the one contract, Carmen 100% IHH, no
  --    fallback seed and no row for Jesse or the adm_no persona.
  perform pg_temp.chk('S6 seed: IHH is a contract client',
    exists (select 1 from cost_contract_clients where client_id = 'illumination-health-home' and label = 'IHH'));
  perform pg_temp.chk('S6 seed: Carmen fixed 100% IHH',
    exists (select 1 from staff_cost_allocations al join staff s on lower(s.email) = al.staff_email
             where s.name ilike 'Carmen%Delacruz%' and al.client_id = 'illumination-health-home'
               and al.method = 'fixed' and al.share = 1));
  perform pg_temp.chk('S6 seed: no fallback row seeded',
    not exists (select 1 from staff_cost_allocations where method = 'fallback'));
  perform pg_temp.chk('S6 seed: no allocation row for Jesse or adm_no',
    not exists (select 1 from staff_cost_allocations al
                 where al.staff_email = lower(adm)
                    or al.staff_email in (select lower(s.email) from staff s where s.name ilike 'Jesse%')));

  -- 2. capacity_inputs: grant holders only; bad input refused.
  perform pg_temp.chk('S6 capacity_inputs: anon has no execute',
    not has_function_privilege('anon', 'public.capacity_inputs(date,date,text,jsonb)', 'execute'));
  v := pg_temp.probe(adm, format(ci, 'staff'));
  perform pg_temp.chk('S6 capacity_inputs: refused 42501 for adm_no', v like 'ERR:42501:%', v);
  v := pg_temp.probe(adm, format(ci, 'full'));
  perform pg_temp.chk('S6 capacity_inputs: refused 42501 for adm_no (full basis)', v like 'ERR:42501:%', v);
  v := pg_temp.probe(bk, format(ci, 'staff'));
  perform pg_temp.chk('S6 capacity_inputs: refused 42501 for a bookkeeper', v like 'ERR:42501:%', v);
  v := pg_temp.probe(own, format(ci, 'bogus'));
  perform pg_temp.chk('S6 capacity_inputs: unknown basis refused 22023', v like 'ERR:22023:%', v);
  v := pg_temp.probe(own, $q$select public.capacity_inputs(date '1999-04-30', date '1999-04-01')::text$q$);
  perform pg_temp.chk('S6 capacity_inputs: reversed range refused 22023', v like 'ERR:22023:%', v);
  v := pg_temp.probe(own, $q$select public.capacity_inputs(date '1999-01-01', date '2003-01-01')::text$q$);
  perform pg_temp.chk('S6 capacity_inputs: range over 3 years refused 22023', v like 'ERR:22023:%', v);
  v := pg_temp.probe(own, format(ci, 'full'));
  perform pg_temp.chk('S6 capacity_inputs: owner runs the full basis (S3 basis rows in place)', v not like 'ERR:%', left(v, 120));

  -- 3. The two tables: RLS, no anon, the restrictive lock, grant holders only.
  foreach t in array array['cost_contract_clients', 'staff_cost_allocations'] loop
    perform pg_temp.chk('S6 ' || t || ': RLS on',
      (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass));
    perform pg_temp.chk('S6 ' || t || ': anon has no table privilege',
      not has_table_privilege('anon', 'public.' || t, 'select') and not has_table_privilege('anon', 'public.' || t, 'insert'));
    perform pg_temp.chk('S6 ' || t || ': RESTRICTIVE internal company lock',
      exists (select 1 from pg_policies where schemaname = 'public' and tablename = t
                and policyname = 'internal company lock' and permissive = 'RESTRICTIVE'));
    execute format('select count(*) from public.%I', t) into n;
    v := pg_temp.probe(own, format('select count(*) from public.%I', t));
    perform pg_temp.chk('S6 ' || t || ': owner reads every row (' || n || ')', v = n::text, v);
    v := pg_temp.probe(adm, format('select count(*) from public.%I', t));
    perform pg_temp.chk('S6 ' || t || ': adm_no reads no row', v = '0', v);
    v := pg_temp.probe(bk, format('select count(*) from public.%I', t));
    perform pg_temp.chk('S6 ' || t || ': bookkeeper reads no row', v = '0', v);
  end loop;

  v := pg_temp.dml(adm, format($q$insert into public.cost_contract_clients (client_id, label) values (%L, 'mh-test')$q$, cli));
  perform pg_temp.chk('S6 cost_contract_clients: adm_no insert refused', v like 'ERR:%', v);
  v := pg_temp.dml(bk, format($q$insert into public.cost_contract_clients (client_id, label) values (%L, 'mh-test')$q$, cli));
  perform pg_temp.chk('S6 cost_contract_clients: bookkeeper insert refused', v like 'ERR:%', v);
  v := pg_temp.dml(adm, $q$insert into public.staff_cost_allocations (staff_email, client_id, share, effective_from)
         values ('mh-test@example.invalid', 'illumination-health-home', 0.5, date '1999-04-01')$q$);
  perform pg_temp.chk('S6 staff_cost_allocations: adm_no insert refused', v like 'ERR:%', v);
  v := pg_temp.dml(bk, $q$insert into public.staff_cost_allocations (staff_email, client_id, share, effective_from)
         values ('mh-test@example.invalid', 'illumination-health-home', 0.5, date '1999-04-01')$q$);
  perform pg_temp.chk('S6 staff_cost_allocations: bookkeeper insert refused', v like 'ERR:%', v);
  v := pg_temp.dml(adm, $q$update public.staff_cost_allocations set share = 0.5$q$);
  perform pg_temp.chk('S6 staff_cost_allocations: adm_no updates no row', v = '0' or v like 'ERR:%', v);
  v := pg_temp.dml(adm, $q$delete from public.staff_cost_allocations$q$);
  perform pg_temp.chk('S6 staff_cost_allocations: adm_no deletes no row', v = '0' or v like 'ERR:%', v);
  v := pg_temp.dml(adm, $q$delete from public.cost_contract_clients$q$);
  perform pg_temp.chk('S6 cost_contract_clients: adm_no deletes no row', v = '0' or v like 'ERR:%', v);
  perform pg_temp.chk('S6 seeds unchanged after adm_no attempts',
    exists (select 1 from cost_contract_clients where client_id = 'illumination-health-home')
    and exists (select 1 from staff_cost_allocations where client_id = 'illumination-health-home' and method = 'fixed' and share = 1));

  -- 4. The owner writes: stamped, audited, checks enforced.
  v := pg_temp.dml(own, format($q$insert into public.cost_contract_clients (client_id, label) values (%L, 'MHT')$q$, cli));
  perform pg_temp.chk('S6 cost_contract_clients: owner insert', v = '1', v);
  perform pg_temp.chk('S6 cost_contract_clients: updated_by stamped with the owner',
    (select updated_by from cost_contract_clients where client_id = cli) = lower(own));
  v := pg_temp.dml(own, format($q$insert into public.staff_cost_allocations (staff_email, client_id, share, method, effective_from)
         values (%L, %L, 0.25, 'fallback', date '1999-04-01')$q$, 'MH-Test-Upper@Example.Invalid', cli));
  perform pg_temp.chk('S6 staff_cost_allocations: mixed-case email refused (UI lower-cases first)', v = 'ERR:23514', v);
  v := pg_temp.dml(own, format($q$insert into public.staff_cost_allocations (staff_email, client_id, share, method, effective_from)
         values (%L, %L, 0.25, 'fallback', date '1999-04-01')$q$, lower(own), cli));
  perform pg_temp.chk('S6 staff_cost_allocations: owner insert', v = '1', v);
  perform pg_temp.chk('S6 staff_cost_allocations: updated_by stamped with the owner',
    exists (select 1 from staff_cost_allocations where staff_email = lower(own) and client_id = cli
              and method = 'fallback' and updated_by = lower(own)));
  v := pg_temp.dml(own, format($q$insert into public.staff_cost_allocations (staff_email, client_id, share, effective_from)
         values (%L, %L, 1.5, date '1999-05-01')$q$, own, cli));
  perform pg_temp.chk('S6 staff_cost_allocations: share over 1 refused', v like 'ERR:%', v);
  v := pg_temp.dml(own, format($q$insert into public.staff_cost_allocations (staff_email, client_id, share, method, effective_from)
         values (%L, %L, 0.5, 'bogus', date '1999-05-01')$q$, own, cli));
  perform pg_temp.chk('S6 staff_cost_allocations: unknown method refused', v like 'ERR:%', v);
  v := pg_temp.dml(own, $q$insert into public.staff_cost_allocations (staff_email, client_id, share, effective_from)
         values ('mh-test@example.invalid', 'mh-test-not-a-contract', 0.5, date '1999-05-01')$q$);
  perform pg_temp.chk('S6 staff_cost_allocations: client must be a contract client', v like 'ERR:%', v);

  perform pg_temp.chk('S6 audit: cost_contract.set written',
    exists (select 1 from audit_log where action = 'cost_contract.set' and target_id = cli));
  perform pg_temp.chk('S6 audit: cost_alloc.set written',
    exists (select 1 from audit_log where action = 'cost_alloc.set' and target_id = lower(own)
              and details ->> 'method' = 'fallback'));
  v := pg_temp.probe(adm, $q$select count(*) from public.audit_log where action ~ '^(cost_contract|cost_alloc)\.'$q$);
  perform pg_temp.chk('S6 audit: adm_no reads no cost_contract / cost_alloc row', v = '0', v);
  v := pg_temp.probe(own, format($q$select count(*) from public.audit_log
         where (action = 'cost_contract.set' and target_id = %L) or (action = 'cost_alloc.set' and target_id = %L)$q$, cli, lower(own)));
  perform pg_temp.chk('S6 audit: owner reads both', v::int >= 2, v);

  -- 5. capacity_inputs with the fixture (April 1999, staff basis).
  v := pg_temp.probe(own, format(ci, 'staff'));
  perform pg_temp.chk('S6 capacity_inputs: owner runs it', v not like 'ERR:%', left(v, 120));
  if v not like 'ERR:%' then
    j := v::jsonb;
    perform pg_temp.chk('S6 capacity_inputs: every key present',
      j ?& array['from', 'to', 'basis', 'rates_set', 'months', 'contracts', 'allocations', 'people',
                 'person_months', 'clients', 'work'], left(v, 200));
    perform pg_temp.chk('S6 capacity_inputs: one month, 30 covered days',
      jsonb_array_length(j -> 'months') = 1 and (j -> 'months' -> 0 ->> 'covered_days') = '30',
      (j -> 'months')::text);
    perform pg_temp.chk('S6 capacity_inputs: the test contract is listed',
      exists (select 1 from jsonb_array_elements(j -> 'contracts') c where c ->> 'client_id' = cli));
    perform pg_temp.chk('S6 capacity_inputs: the fallback row is listed',
      exists (select 1 from jsonb_array_elements(j -> 'allocations') a
               where a ->> 'staff_email' = lower(own) and a ->> 'client_id' = cli and a ->> 'method' = 'fallback'));
    perform pg_temp.chk('S6 capacity_inputs: owner April 120 minutes, 60 on the contract',
      exists (select 1 from jsonb_array_elements(j -> 'person_months') p
               where p ->> 'key' = lower(own) and p ->> 'month' = '1999-04-01'
                 and p ->> 'minutes' = '120' and p -> 'contract_minutes' ->> cli = '60'),
      (select string_agg(p::text, ' ') from jsonb_array_elements(j -> 'person_months') p where p ->> 'key' = lower(own)));
    perform pg_temp.chk('S6 capacity_inputs: unmapped helper is estimated, gone person is former',
      exists (select 1 from jsonb_array_elements(j -> 'person_months') p
               where p ->> 'key' = 'unmapped:mh-test helper' and (p ->> 'estimated')::boolean)
      and exists (select 1 from jsonb_array_elements(j -> 'person_months') p
               where p ->> 'key' = 'unmapped:mh-test gone' and (p ->> 'former')::boolean),
      (select string_agg(p::text, ' ') from jsonb_array_elements(j -> 'person_months') p where p ->> 'key' like 'unmapped:%'));
    perform pg_temp.chk('S6 capacity_inputs: the internal client never appears in clients or work',
      not exists (select 1 from jsonb_array_elements(j -> 'clients') c join clients x on x.id = c ->> 'client_id' and x.is_internal)
      and not exists (select 1 from jsonb_array_elements(j -> 'work') w join clients x on x.id = w ->> 'client_id' and x.is_internal));
    perform pg_temp.chk('S6 capacity_inputs: the contract client carries its contract flag',
      exists (select 1 from jsonb_array_elements(j -> 'clients') c where c ->> 'client_id' = cli and (c ->> 'contract')::boolean));
  end if;

  -- 6. Usage: Capacity views, palette jumps and grant-holder searches are
  --    filed under the internal client, so adm_no never reads them.
  v := pg_temp.dml(own, $q$insert into public.usage_events (actor_email, actor_role, client_id, page, kind, detail)
         values ((auth.jwt()->>'email'), 'staff', null, 'mgb-capacity', 'view', 'mh-test-cap-view')$q$);
  perform pg_temp.chk('S6 usage_events: owner view of mgb-capacity is logged', v = '1', v);
  v := pg_temp.dml(own, $q$insert into public.usage_events (actor_email, actor_role, client_id, page, kind, detail)
         values ((auth.jwt()->>'email'), 'staff', null, 'today', 'action', 'cmdk-go:#/internal/capacity')$q$);
  perform pg_temp.chk('S6 usage_events: owner palette jump to capacity is logged', v = '1', v);
  v := pg_temp.dml(own, $q$insert into public.usage_events (actor_email, actor_role, client_id, page, kind, detail)
         values ((auth.jwt()->>'email'), 'staff', null, 'today', 'action', 'guide-search:mh-test capacity')$q$);
  perform pg_temp.chk('S6 usage_events: owner guide search for capacity is logged', v = '1', v);
  v := pg_temp.probe(adm, $q$select count(*) from public.usage_events
         where detail in ('mh-test-cap-view', 'cmdk-go:#/internal/capacity', 'guide-search:mh-test capacity')$q$);
  perform pg_temp.chk('S6 usage_events: adm_no reads none of the three', v = '0', v);
  v := pg_temp.probe(own, $q$select count(*) from public.usage_events
         where detail in ('mh-test-cap-view', 'cmdk-go:#/internal/capacity', 'guide-search:mh-test capacity')$q$);
  perform pg_temp.chk('S6 usage_events: owner reads all three', v::int >= 3, v);
  perform pg_temp.chk('S6 usage_events: none of them lack a client',
    not exists (select 1 from usage_events where client_id is null
                  and detail in ('mh-test-cap-view', 'cmdk-go:#/internal/capacity', 'guide-search:mh-test capacity')));
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
