-- Profitability is internal-only: tests for profitability-internal-only.sql.
-- NOT a migration. Run AFTER profitability-internal-only.sql has been applied,
-- in the Supabase SQL editor (or psql as postgres). Everything runs in one
-- transaction that ends in ROLLBACK, so no fixture survives. A failing check is
-- collected; the run ends by raising 'profitability-internal-only tests FAILED:
-- ...' listing every failure, or with the notice '... all N passed'.
--
-- Personas are picked from the live staff table by role (no emails here):
--   owner    the active admin named in internal_access with is_owner (has the grant)
--   adm_no   an active admin WITHOUT a grant row (if every admin has one, the
--            owner switches one off inside the transaction)
--   bk       an active bookkeeper (never sees any of it)

begin;

create temp table _pio (n serial, name text, ok boolean, detail text);
create temp table _who (k text primary key, email text);

create or replace function pg_temp.chk(p_name text, p_ok boolean, p_detail text default null)
returns void language plpgsql as $$
begin
  insert into _pio(name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail);
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

-- Run one scalar query as an authenticated user. Returns the value as text, or
-- 'ERR:<sqlstate>:<message>' when it raised (RLS WITH CHECK, own check).
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

-- Rows changed by one DML statement run as an authenticated user ('ERR:...' when refused).
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
-- Fixtures
-- ---------------------------------------------------------------------------
insert into _who select 'owner', ia.staff_email from internal_access ia
  join staff s on s.email = ia.staff_email and s.role = 'admin' and s.active
 where ia.is_owner limit 1;
insert into _who select 'adm_no', s.email from staff s
 where s.role = 'admin' and s.active
   and not exists (select 1 from internal_access ia where ia.staff_email = s.email)
 order by s.email limit 1;
-- Every admin has the grant: the owner switches one off (rolled back).
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

-- Known rows to look for (rolled back).
insert into client_fees (client_id, monthly_fee, updated_by)
  values ('basic-test', 123.45, 'pio-test')
  on conflict (client_id) do update set monthly_fee = excluded.monthly_fee;
insert into staff_cost_rates (staff_email, effective_from, hourly_cost, updated_by)
  values ((select email from _who where k = 'bk'), date '1999-01-01', 11.11, 'pio-test')
  on conflict (staff_email, effective_from) do update set hourly_cost = excluded.hourly_cost;
insert into audit_log (actor_email, action, client_id, details)
  values ('pio-test', 'client_fee.set', 'basic-test', '{"monthly_fee":123.45}'::jsonb),
         ('pio-test', 'cost_rate.set', null, '{"hourly_cost":11.11}'::jsonb),
         ('pio-test', 'profitability.target_changed', null, '{"target_margin_pct":40}'::jsonb),
         ('pio-test', 'pio.other', null, '{}'::jsonb);
insert into saved_quotes (client_id, prospect_name, assumptions, created_by)
  values ('basic-test', 'pio quote', '{"target_margin_pct":40}'::jsonb, 'pio-test');

do $$
begin
  perform pg_temp.chk('personas found: owner, adm_no, bk',
    (select count(*) from _who where email is not null) = 3,
    (select string_agg(k, ',') from _who));
  perform pg_temp.chk('adm_no is an active admin without the grant',
    exists (select 1 from staff s join _who w on w.email = s.email and w.k = 'adm_no'
             where s.role = 'admin' and s.active)
    and not exists (select 1 from internal_access ia join _who w on w.email = ia.staff_email and w.k = 'adm_no'));
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
  who text;
begin
  -- Sanity: helper functions answer as expected for each persona.
  perform pg_temp.chk('owner: can_view_internal() true',  pg_temp.probe(own, 'select public.can_view_internal()') = 'true');
  perform pg_temp.chk('adm_no: is_active_staff_admin() true', pg_temp.probe(adm, 'select public.is_active_staff_admin()') = 'true');
  perform pg_temp.chk('adm_no: can_view_internal() false', pg_temp.probe(adm, 'select public.can_view_internal()') = 'false');

  -- Reads: zero rows for adm_no and bk; owner sees them.
  foreach who in array array[adm, bk] loop
    v := pg_temp.probe(who, 'select count(*) from public.client_fees');
    perform pg_temp.chk('client_fees: zero rows for ' || who, v = '0', v);
    v := pg_temp.probe(who, 'select count(*) from public.staff_cost_rates');
    perform pg_temp.chk('staff_cost_rates: zero rows for ' || who, v = '0', v);
    v := pg_temp.probe(who, 'select count(*) from public.profitability_settings');
    perform pg_temp.chk('profitability_settings: zero rows for ' || who, v = '0', v);
    v := pg_temp.probe(who, 'select count(*) from public.saved_quotes');
    perform pg_temp.chk('saved_quotes: zero rows for ' || who, v = '0', v);
    v := pg_temp.probe(who, $q$select count(*) from public.audit_log where action ~ '^(client_fee|cost_rate|profitability)\.'$q$);
    perform pg_temp.chk('audit_log fee/rate/target rows: zero for ' || who, v = '0', v);
    v := pg_temp.probe(who, 'select public.client_profitability(current_date - 30, current_date)');
    perform pg_temp.chk('client_profitability(): refused for ' || who, v like 'ERR:42501:%', v);
    v := pg_temp.probe(who, 'select public.quote_inputs()::text');
    perform pg_temp.chk('quote_inputs(): refused for ' || who, v like 'ERR:42501:%', v);
  end loop;

  v := pg_temp.probe(adm, $q$select count(*) from public.audit_log where actor_email = 'pio-test' and action = 'pio.other'$q$);
  perform pg_temp.chk('audit_log: adm_no still reads other actions', v = '1', v);

  v := pg_temp.probe(adm, $q$select count(*) from public.client_health('{}'::jsonb) h, jsonb_array_elements(coalesce(h.reasons, '[]'::jsonb)) r
                             where r->>'key' = 'margin' or r::text ilike '%margin%'$q$);
  perform pg_temp.chk('client_health(): no margin factor for adm_no', v = '0', v);
  v := pg_temp.probe(own, $q$select count(*) from public.client_health('{}'::jsonb)$q$);
  perform pg_temp.chk('client_health(): runs for owner', v not like 'ERR:%' and v::int > 0, v);

  -- Staff guide: the Profitability article (and its search hit) only with the grant.
  v := pg_temp.probe(adm, $q$select count(*) from public.staff_guide where slug = 'profitability'$q$);
  perform pg_temp.chk('staff_guide: adm_no cannot read profitability', v = '0', v);
  v := pg_temp.probe(adm, $q$select count(*) from public.search_staff_guide('profitability margin') where slug = 'profitability'$q$);
  perform pg_temp.chk('search_staff_guide: no profitability hit for adm_no', v = '0', v);
  v := pg_temp.probe(adm, $q$select count(*) from public.staff_guide where slug = 'admin-guide'$q$);
  perform pg_temp.chk('staff_guide: adm_no still reads other admin articles', v = '1', v);
  v := pg_temp.probe(own, $q$select count(*) from public.staff_guide where slug = 'profitability'$q$);
  perform pg_temp.chk('staff_guide: owner reads profitability', v = '1', v);

  -- Writes: refused (WITH CHECK) or no row touched for adm_no.
  v := pg_temp.dml(adm, $q$insert into public.client_fees (client_id, monthly_fee) values ('grace-community', 1)$q$);
  perform pg_temp.chk('client_fees insert: refused for adm_no', v like 'ERR:%', v);
  v := pg_temp.dml(adm, $q$update public.client_fees set monthly_fee = 1 where client_id = 'basic-test'$q$);
  perform pg_temp.chk('client_fees update: 0 rows for adm_no', v = '0', v);
  v := pg_temp.dml(adm, $q$delete from public.client_fees where client_id = 'basic-test'$q$);
  perform pg_temp.chk('client_fees delete: 0 rows for adm_no', v = '0', v);
  v := pg_temp.dml(adm, format($q$insert into public.staff_cost_rates (staff_email, effective_from, hourly_cost) values (%L, date '1999-02-01', 1)$q$, bk));
  perform pg_temp.chk('staff_cost_rates insert: refused for adm_no', v like 'ERR:%', v);
  v := pg_temp.dml(adm, $q$update public.staff_cost_rates set hourly_cost = 1$q$);
  perform pg_temp.chk('staff_cost_rates update: 0 rows for adm_no', v = '0', v);
  v := pg_temp.dml(adm, $q$delete from public.staff_cost_rates$q$);
  perform pg_temp.chk('staff_cost_rates delete: 0 rows for adm_no', v = '0', v);
  v := pg_temp.dml(adm, $q$update public.profitability_settings set target_margin_pct = 1$q$);
  perform pg_temp.chk('profitability_settings update: 0 rows for adm_no', v = '0', v);
  perform pg_temp.chk('fixtures untouched after adm_no writes',
    (select monthly_fee from client_fees where client_id = 'basic-test') = 123.45
    and (select hourly_cost from staff_cost_rates where staff_email = bk and effective_from = date '1999-01-01') = 11.11
    and (select target_margin_pct from profitability_settings limit 1) <> 1);

  -- Owner (has the grant) keeps full access.
  v := pg_temp.probe(own, $q$select count(*) from public.client_fees where client_id = 'basic-test'$q$);
  perform pg_temp.chk('client_fees: owner reads', v = '1', v);
  v := pg_temp.probe(own, 'select count(*) from public.staff_cost_rates');
  perform pg_temp.chk('staff_cost_rates: owner reads', v not like 'ERR:%' and v::int > 0, v);
  v := pg_temp.probe(own, 'select count(*) from public.profitability_settings');
  perform pg_temp.chk('profitability_settings: owner reads', v = '1', v);
  v := pg_temp.probe(own, $q$select count(*) from public.audit_log where actor_email = 'pio-test'$q$);
  perform pg_temp.chk('audit_log: owner reads fee/rate/target rows', v = '4', v);
  v := pg_temp.probe(own, $q$select count(*) from public.saved_quotes where created_by = 'pio-test'$q$);
  perform pg_temp.chk('saved_quotes: owner reads', v = '1', v);
  v := pg_temp.probe(own, 'select count(*) from public.client_profitability(current_date - 30, current_date)');
  perform pg_temp.chk('client_profitability(): owner gets rows', v not like 'ERR:%' and v::int > 0, v);
  v := pg_temp.probe(own, $q$select (public.quote_inputs() ? 'target_margin_pct')::text$q$);
  perform pg_temp.chk('quote_inputs(): owner gets a result', v not like 'ERR:%', v);
  v := pg_temp.dml(own, $q$update public.client_fees set monthly_fee = 200 where client_id = 'basic-test'$q$);
  perform pg_temp.chk('client_fees update: owner changes 1 row', v = '1', v);
  v := pg_temp.dml(own, $q$update public.profitability_settings set target_margin_pct = target_margin_pct$q$);
  perform pg_temp.chk('profitability_settings update: owner changes 1 row', v = '1', v);
end $$;

do $$
declare bad text;
begin
  select string_agg(name || coalesce(' [' || detail || ']', ''), E'\n  ') into bad from _pio where not ok;
  if bad is not null then
    raise exception E'profitability-internal-only tests FAILED:\n  %', bad;
  end if;
  raise notice 'profitability-internal-only tests: all % passed', (select count(*) from _pio);
end $$;

rollback;
