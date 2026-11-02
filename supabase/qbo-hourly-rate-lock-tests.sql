-- Tests for supabase/qbo-hourly-rate-lock.sql (QuickBooks Time billing rates
-- readable only by internal-access grant holders).
-- NOT a migration. Run AFTER it has been applied, in the Supabase SQL editor
-- (or psql as postgres). One transaction ending in ROLLBACK, so no fixture
-- survives. Ends by raising 'hourly-rate-lock tests FAILED: ...' listing every
-- failure, or with the notice 'hourly-rate-lock tests: all N passed'.
--
-- Personas come from the live staff table by role (no emails here):
--   owner    active admin in internal_access with is_owner (has the grant)
--   adm_no   active admin WITHOUT a grant row (Jesse-like; if every admin has
--            one, the owner switches one off inside the transaction)
--   bk       an active bookkeeper
-- Fixtures: realm 'hr-test-realm', June 1998, marker 'hr-test'.

begin;

create temp table _hr (n serial, name text, ok boolean, detail text);
create temp table _who (k text primary key, email text);

create or replace function pg_temp.chk(p_name text, p_ok boolean, p_detail text default null)
returns void language plpgsql as $$
begin
  insert into _hr(name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail);
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

-- Same as probe, as the anon role.
create or replace function pg_temp.probe_anon(p_sql text)
returns text language plpgsql as $$
declare v text;
begin
  perform pg_temp.claims(null);
  set local role anon;
  begin
    execute p_sql into v;
    v := coalesce(v, 'null');
  exception when others then
    v := 'ERR:' || sqlstate || ':' || left(sqlerrm, 90);
  end;
  reset role;
  return v;
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

-- One hour of billable firm time on 1998-06-15 at 100/hour, no customer.
insert into qbo_time_activities (realm_id, qbo_id, txn_date, minutes, hourly_rate, billable_status,
                                 employee_qbo_id, employee_name, description, item_name)
  values ('hr-test-realm', 'hr-test-1', date '1998-06-15', 60, 100, 'Billable',
          'hr-test-e1', 'hr-test person', 'hr-test entry', 'Hours');

do $$
declare
  own text := (select email from _who where k = 'owner');
  adm text := (select email from _who where k = 'adm_no');
  bk  text := (select email from _who where k = 'bk');
  rng text := $r$date '1998-06-01', date '1998-06-30'$r$;
  v text;
begin
  perform pg_temp.chk('personas found: owner, adm_no, bk',
    (select count(*) from _who where email is not null) = 3,
    (select string_agg(k, ',') from _who));
  perform pg_temp.chk('owner: can_view_internal() true',   pg_temp.probe(own, 'select public.can_view_internal()') = 'true');
  perform pg_temp.chk('adm_no: can_view_internal() false', pg_temp.probe(adm, 'select public.can_view_internal()') = 'false');
  perform pg_temp.chk('adm_no: is an active admin', pg_temp.probe(adm, 'select public.is_active_staff_admin()') = 'true');

  -- 1. Privileges on the table.
  perform pg_temp.chk('authenticated: no SELECT on hourly_rate',
    not has_column_privilege('authenticated', 'public.qbo_time_activities', 'hourly_rate', 'select'));
  perform pg_temp.chk('authenticated: no table-wide SELECT',
    not has_table_privilege('authenticated', 'public.qbo_time_activities', 'select'));
  perform pg_temp.chk('authenticated: SELECT on minutes and txn_date kept',
    has_column_privilege('authenticated', 'public.qbo_time_activities', 'minutes', 'select')
    and has_column_privilege('authenticated', 'public.qbo_time_activities', 'txn_date', 'select'));
  perform pg_temp.chk('authenticated: every other column readable',
    not exists (select 1 from information_schema.columns c
                 where c.table_schema = 'public' and c.table_name = 'qbo_time_activities'
                   and c.column_name <> 'hourly_rate'
                   and not has_column_privilege('authenticated', 'public.qbo_time_activities', c.column_name, 'select')),
    (select string_agg(c.column_name, ',') from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = 'qbo_time_activities' and c.column_name <> 'hourly_rate'
        and not has_column_privilege('authenticated', 'public.qbo_time_activities', c.column_name, 'select')));
  perform pg_temp.chk('authenticated: no write privilege on any column',
    not has_any_column_privilege('authenticated', 'public.qbo_time_activities', 'insert')
    and not has_any_column_privilege('authenticated', 'public.qbo_time_activities', 'update')
    and not has_table_privilege('authenticated', 'public.qbo_time_activities', 'delete')
    and not has_table_privilege('authenticated', 'public.qbo_time_activities', 'truncate'));
  perform pg_temp.chk('anon: no privilege on the table at all',
    not has_any_column_privilege('anon', 'public.qbo_time_activities', 'select')
    and not has_table_privilege('anon', 'public.qbo_time_activities', 'select'));
  perform pg_temp.chk('service_role: still reads hourly_rate',
    has_column_privilege('service_role', 'public.qbo_time_activities', 'hourly_rate', 'select')
    and has_table_privilege('service_role', 'public.qbo_time_activities', 'insert'));
  perform pg_temp.chk('no view exposes the table',
    not exists (select 1 from information_schema.view_table_usage where table_name = 'qbo_time_activities'));

  -- 2. Jesse-like admin cannot read the rate directly.
  v := pg_temp.probe(adm, $q$select hourly_rate::text from public.qbo_time_activities where qbo_id = 'hr-test-1'$q$);
  perform pg_temp.chk('adm_no: select hourly_rate refused 42501', v like 'ERR:42501:%', v);
  v := pg_temp.probe(adm, $q$select count(*) from (select * from public.qbo_time_activities where qbo_id = 'hr-test-1') x$q$);
  perform pg_temp.chk('adm_no: select * refused 42501', v like 'ERR:42501:%', v);
  v := pg_temp.probe(adm, $q$select row_to_json(a)::text from public.qbo_time_activities a where qbo_id = 'hr-test-1'$q$);
  perform pg_temp.chk('adm_no: whole-row read refused 42501', v like 'ERR:42501:%', v);
  v := pg_temp.probe(adm, $q$select count(*) from public.qbo_time_activities where hourly_rate > 0$q$);
  perform pg_temp.chk('adm_no: filtering on hourly_rate refused 42501', v like 'ERR:42501:%', v);
  v := pg_temp.probe(adm, $q$select sum(minutes / 60.0 * hourly_rate)::text from public.qbo_time_activities$q$);
  perform pg_temp.chk('adm_no: computing with hourly_rate refused 42501', v like 'ERR:42501:%', v);
  v := pg_temp.probe(adm, $q$with r as (update public.qbo_time_activities set hourly_rate = 1 where qbo_id = 'hr-test-1' returning 1) select count(*) from r$q$);
  perform pg_temp.chk('adm_no: update hourly_rate refused', v like 'ERR:%', v);
  v := pg_temp.probe_anon($q$select count(*) from public.qbo_time_activities$q$);
  perform pg_temp.chk('anon: any read refused', v like 'ERR:42501:%', v);

  -- 3. ... nor through any RPC.
  v := pg_temp.probe(adm, format('select count(*) from public.qbo_time_activity_rates(%s)', rng));
  perform pg_temp.chk('qbo_time_activity_rates: refused 42501 for adm_no', v like 'ERR:42501:%', v);
  v := pg_temp.probe(bk, format('select count(*) from public.qbo_time_activity_rates(%s)', rng));
  perform pg_temp.chk('qbo_time_activity_rates: refused 42501 for a bookkeeper', v like 'ERR:42501:%', v);
  v := pg_temp.probe(null, format('select count(*) from public.qbo_time_activity_rates(%s)', rng));
  perform pg_temp.chk('qbo_time_activity_rates: refused 42501 with no jwt', v like 'ERR:42501:%', v);
  perform pg_temp.chk('qbo_time_activity_rates: anon has no execute',
    not has_function_privilege('anon', 'public.qbo_time_activity_rates(date,date)', 'execute'));
  v := pg_temp.probe(adm, format('select count(*) from public.qbo_hours_by_client(%s) where billable_value is not null', rng));
  perform pg_temp.chk('qbo_hours_by_client: billable_value null for adm_no', v = '0', v);
  v := pg_temp.probe(adm, format('select count(*) from public.client_profitability(%s, %L::jsonb)', rng, '{}'));
  perform pg_temp.chk('client_profitability: still refused for adm_no', v like 'ERR:42501:%', v);
  v := pg_temp.probe(adm, format('select public.internal_hours(%s)::text', rng));
  perform pg_temp.chk('internal_hours: still refused for adm_no', v like 'ERR:42501:%', v);
  perform pg_temp.chk('no INVOKER function in public reads hourly_rate',
    not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and not p.prosecdef and p.prokind = 'f'
                   and pg_get_functiondef(p.oid) ilike '%hourly_rate%'),
    (select string_agg(p.proname, ',') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and not p.prosecdef and p.prokind = 'f'
        and pg_get_functiondef(p.oid) ilike '%hourly_rate%'));
  perform pg_temp.chk('no SECURITY DEFINER function a non-grant caller can run returns hourly_rate by name',
    not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.prosecdef and p.prokind = 'f'
                   and has_function_privilege('authenticated', p.oid, 'execute')
                   and pg_get_function_result(p.oid) ilike '%hourly_rate%'
                   and p.proname <> 'qbo_time_activity_rates'),
    (select string_agg(p.proname, ',') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef and p.prokind = 'f'
        and has_function_privilege('authenticated', p.oid, 'execute')
        and pg_get_function_result(p.oid) ilike '%hourly_rate%' and p.proname <> 'qbo_time_activity_rates'));

  -- 4. The grant holder can read the rate (through the RPC) and the money.
  v := pg_temp.probe(own, format($q$select hourly_rate::text from public.qbo_time_activity_rates(%s) where qbo_id = 'hr-test-1'$q$, rng));
  perform pg_temp.chk('qbo_time_activity_rates: owner reads 100', v = '100', v);
  v := pg_temp.probe(own, format('select count(*) from public.qbo_time_activity_rates(%s)', rng));
  perform pg_temp.chk('qbo_time_activity_rates: owner gets exactly the range (1 row)', v = '1', v);
  v := pg_temp.probe(own, $q$select count(*) from public.qbo_time_activity_rates(date '1998-06-30', date '1998-06-01')$q$);
  perform pg_temp.chk('qbo_time_activity_rates: reversed range refused 22023', v like 'ERR:22023:%', v);
  v := pg_temp.probe(own, format('select sum(billable_value)::text from public.qbo_hours_by_client(%s)', rng));
  perform pg_temp.chk('qbo_hours_by_client: owner gets billable_value 100.00', v = '100.00', v);
  v := pg_temp.probe(own, $q$select hourly_rate::text from public.qbo_time_activities where qbo_id = 'hr-test-1'$q$);
  perform pg_temp.chk('owner: direct column read also refused (RPC is the only path)', v like 'ERR:42501:%', v);

  -- 5. Hours-only features keep working for adm_no.
  v := pg_temp.probe(adm, $q$select txn_date::text from public.qbo_time_activities order by txn_date desc limit 1$q$);
  perform pg_temp.chk('adm_no: newest txn_date (Hours / Capacity "synced through") works', v not like 'ERR:%', v);
  v := pg_temp.probe(adm, $q$select count(*) from (
         select qbo_id, txn_date, name_of, employee_qbo_id, employee_name, vendor_qbo_id, vendor_name,
                customer_qbo_id, customer_name, minutes, billable_status, description, item_name
           from public.qbo_time_activities where qbo_id = 'hr-test-1') x$q$);
  perform pg_temp.chk('adm_no: drill-down columns (TP_Q_ACT_COLS) readable', v = '1', v);
  v := pg_temp.probe(adm, $q$select count(*) from (
         select realm_id, customer_qbo_id, minutes, item_qbo_id, start_time, end_time, qbo_last_updated, synced_at
           from public.qbo_time_activities where qbo_id = 'hr-test-1') x$q$);
  perform pg_temp.chk('adm_no: remaining non-money columns readable', v = '1', v);
  v := pg_temp.probe(adm, format('select sum(total_minutes)::text from public.qbo_hours_by_client(%s)', rng));
  perform pg_temp.chk('qbo_hours_by_client: adm_no gets 60 minutes', v = '60', v);
  v := pg_temp.probe(adm, format('select sum(billable_minutes)::text from public.qbo_hours_by_client(%s)', rng));
  perform pg_temp.chk('qbo_hours_by_client: adm_no gets billable minutes', v = '60', v);
  v := pg_temp.probe(adm, format('select sum(total_minutes)::text from public.qbo_hours_by_staff(%s)', rng));
  perform pg_temp.chk('qbo_hours_by_staff: adm_no gets 60 minutes', v = '60', v);
  v := pg_temp.probe(bk, format('select count(*) from public.qbo_hours_by_client(%s)', rng));
  perform pg_temp.chk('qbo_hours_by_client: still refused for a bookkeeper', v like 'ERR:%', v);
  v := pg_temp.probe(bk, format('select count(*) from public.qbo_hours_by_staff(%s)', rng));
  perform pg_temp.chk('qbo_hours_by_staff: still refused for a bookkeeper', v like 'ERR:%', v);
  v := pg_temp.probe(null, format('select count(*) from public.qbo_hours_by_client(%s)', rng));
  perform pg_temp.chk('qbo_hours_by_client: refused with no jwt', v like 'ERR:%', v);
  v := pg_temp.probe(bk, $q$select count(*) from public.qbo_time_activities$q$);
  perform pg_temp.chk('bookkeeper: direct table read returns no rows (RLS)', v = '0', v);
  v := pg_temp.probe(bk, format('select count(*) from public.qbo_my_client_hours(%s)', rng));
  perform pg_temp.chk('qbo_my_client_hours: bookkeeper still runs', v not like 'ERR:%', v);
  v := pg_temp.probe(bk, 'select count(*) from public.qbo_my_client_hours_monthly(6)');
  perform pg_temp.chk('qbo_my_client_hours_monthly: bookkeeper still runs', v not like 'ERR:%', v);
  v := pg_temp.probe(adm, 'select count(*) from public.qbo_firm_status()');
  perform pg_temp.chk('qbo_firm_status: adm_no still runs', v not like 'ERR:%', v);
  v := pg_temp.probe(adm, $q$select count(*) from public.staff_performance(30, '{}'::jsonb)$q$);
  perform pg_temp.chk('staff_performance: adm_no still runs', v not like 'ERR:%', v);
  v := pg_temp.probe(adm, $q$select count(*) from public.client_health('{}'::jsonb)$q$);
  perform pg_temp.chk('client_health: adm_no still runs', v not like 'ERR:%', v);
  v := pg_temp.probe(own, format('select count(*) from public.client_profitability(%s, %L::jsonb)', rng, '{}'));
  perform pg_temp.chk('client_profitability: owner still runs', v not like 'ERR:%', v);
  v := pg_temp.probe(own, format('select public.internal_hours(%s)::text', rng));
  perform pg_temp.chk('internal_hours: owner still runs', v not like 'ERR:%', left(v, 90));

  -- 6. The hours RPCs stay SECURITY DEFINER (a CREATE OR REPLACE without it
  --    would make them raise 42501 for everyone).
  perform pg_temp.chk('qbo_hours_by_client: security definer',
    (select prosecdef from pg_proc where oid = 'public.qbo_hours_by_client(date,date)'::regprocedure));
  perform pg_temp.chk('qbo_hours_by_staff: security definer',
    (select prosecdef from pg_proc where oid = 'public.qbo_hours_by_staff(date,date)'::regprocedure));
  perform pg_temp.chk('qbo_time_activity_rates: security definer, search_path pinned',
    (select prosecdef and array_to_string(proconfig, ',') like '%search_path=public%'
       from pg_proc where oid = 'public.qbo_time_activity_rates(date,date)'::regprocedure));
  perform pg_temp.chk('hours RPCs: anon has no execute',
    not has_function_privilege('anon', 'public.qbo_hours_by_client(date,date)', 'execute')
    and not has_function_privilege('anon', 'public.qbo_hours_by_staff(date,date)', 'execute'));
end $$;

do $$
declare bad text;
begin
  select string_agg(name || coalesce(' [' || detail || ']', ''), E'\n  ') into bad from _hr where not ok;
  if bad is not null then
    raise exception E'hourly-rate-lock tests FAILED:\n  %', bad;
  end if;
  raise notice 'hourly-rate-lock tests: all % passed', (select count(*) from _hr);
end $$;

rollback;
