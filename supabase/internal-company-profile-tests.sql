-- Internal company profile (clients.is_internal): lock + exclusion tests.
-- NOT a migration. Run AFTER internal-company-profile.sql has been applied, in
-- the Supabase SQL editor (or psql as postgres). Everything runs in one
-- transaction that ends in ROLLBACK, so no fixture survives. A failing check
-- is collected; the run ends by raising 'internal-company-profile tests FAILED:
-- ...' listing every failure, or with the notice '... all N passed'.
--
-- Personas are picked from the live staff table by role (no emails here):
--   owner    the active admin named in internal_access with is_owner (has the grant)
--   adm_no   another active admin WITHOUT the grant
--   bk_sca   a bookkeeper given a staff_client_access row on the internal client
--   bk_am    a bookkeeper set as the internal client's account manager
--   bk_temp  a bookkeeper with an active temp-admin grant
--   client_mgb / client_rc  portal users (@example.test fixtures) of the internal
--            client and of one real client
-- A "real client" (RC) is a throwaway fixture client created inside the
-- transaction. basic-test / grace-community are the test clients.

begin;

create temp table _icp (n serial, name text, ok boolean, detail text);
create temp table _who (k text primary key, email text);

create or replace function pg_temp.chk(p_name text, p_ok boolean, p_detail text default null)
returns void language plpgsql as $$
begin
  insert into _icp(name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail);
end $$;

create or replace function pg_temp.claims(p_email text)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    case when p_email is null then ''
         else json_build_object('email', p_email, 'role', 'authenticated', 'sub', gen_random_uuid(),
                'app_metadata', case when p_email like '%@example.test' then '{}'::json
                                     else json_build_object('provider', 'google', 'providers', json_build_array('google')) end)::text end,
    true);
end $$;

-- Run one scalar query as an authenticated user. Returns the value as text, or
-- 'ERR:<sqlstate>:<message>' when it raised (RLS WITH CHECK, no grant, own check).
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

-- Same, but as the table owner with the caller's claims (for internal helpers
-- that signed-in users are not allowed to call directly, e.g. st_my_client_user).
create or replace function pg_temp.as_jwt(p_email text, p_sql text)
returns text language plpgsql as $$
declare v text;
begin
  perform pg_temp.claims(p_email);
  begin
    execute p_sql into v;
    v := coalesce(v, 'null');
  exception when others then
    v := 'ERR:' || sqlstate || ':' || left(sqlerrm, 90);
  end;
  perform pg_temp.claims(null);
  return v;
end $$;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
insert into _who select 'owner', ia.staff_email from internal_access ia
  join staff s on s.email = ia.staff_email and s.role = 'admin' and s.active
 where ia.is_owner limit 1;
insert into _who select 'adm_no', s.email from staff s
 where s.role = 'admin' and s.active and s.email <> (select email from _who where k = 'owner')
   -- default is ON for every admin; the owner switches this one off below
 order by s.email limit 1;
with b as (select email, row_number() over (order by email) rn from staff where role = 'bookkeeper' and active)
insert into _who select case rn when 1 then 'bk_sca' when 2 then 'bk_am' else 'bk_temp' end, email
  from b where rn <= 3;
insert into _who values ('client_mgb', 'icp-client-mgb@example.test'), ('client_rc', 'icp-client-rc@example.test');

-- A throwaway real client (rolled back with everything else), so the checks
-- also work while the live database holds no real clients yet.
insert into clients (id, name, org_type, assigned_bookkeeper_email, account_manager_email)
  select 'icp-real-client', 'ICP Real Client', (select org_type from clients where id = 'mygoodbooks'),
         (select email from _who where k = 'bk_sca'), (select email from _who where k = 'bk_sca')
   where not exists (select 1 from clients where id = 'icp-real-client');
create temp table _rc as select id from clients where id = 'icp-real-client';

select pg_temp.claims((select email from _who where k = 'owner'));
select set_internal_access((select email from _who where k = 'adm_no'), false);
insert into staff_client_access (staff_email, client_id)
  select email, 'mygoodbooks' from _who where k = 'bk_sca' on conflict do nothing;
insert into staff_client_access (staff_email, client_id)
  select w.email, c.id from _who w, (select id from _rc union select 'grace-community') c
   where w.k = 'bk_sca' on conflict do nothing;
update clients set account_manager_email = (select email from _who where k = 'bk_am') where id = 'mygoodbooks';
insert into staff_temp_admin_access (staff_email, granted_by, expires_at)
  select email, (select email from _who where k = 'owner'), now() + interval '1 day' from _who where k = 'bk_temp'
  on conflict (staff_email) do update set expires_at = excluded.expires_at;
insert into client_users (email, client_id, name, role, active)
  values ('icp-client-rc@example.test', (select id from _rc), 'ICP Test B', 'Contact', true);
-- The portal-user trigger refuses an internal-client user, so switch it off for
-- this one fixture row (a legacy row that pre-dates the rule) and back on.
alter table client_users disable trigger client_users_no_internal;
insert into client_users (email, client_id, name, role, active)
  values ('icp-client-mgb@example.test', 'mygoodbooks', 'ICP Test A', 'Contact', true);
alter table client_users enable trigger client_users_no_internal;
select pg_temp.claims(null);

-- ---------------------------------------------------------------------------
-- 1. State and helpers
-- ---------------------------------------------------------------------------
do $$
declare v_rc text := (select id from _rc);
begin
  perform pg_temp.chk('fixtures: owner, adm_no, 3 bookkeepers, real client found',
    (select count(*) from _who where k in ('owner','adm_no','bk_sca','bk_am','bk_temp')) = 5 and v_rc is not null);
  perform pg_temp.chk('only the internal client has is_internal',
    (select count(*) from clients where is_internal) = 1 and (select is_internal from clients where id = 'mygoodbooks'));
  perform pg_temp.chk('internal client is NOT test_only (never reuse test_only)',
    not (select coalesce(test_only, false) from clients where id = 'mygoodbooks'));
  perform pg_temp.chk('internal_access: exactly one owner row (every other active admin has a default row)',
    (select count(*) from internal_access where is_owner) = 1);
  begin
    update clients set is_internal = true where id = 'basic-test';
    perform pg_temp.chk('a second internal client is refused (unique index)', false);
  exception when unique_violation then
    perform pg_temp.chk('a second internal client is refused (unique index)', true);
  end;
  perform pg_temp.chk('is_roster_client_id: internal=false, test clients=false, real=true, null=true',
    not public.is_roster_client_id('mygoodbooks') and not public.is_roster_client_id('basic-test')
    and not public.is_roster_client_id('grace-community') and public.is_roster_client_id(v_rc)
    and public.is_roster_client_id(null));
  perform pg_temp.chk('is_roster_client(row) agrees with the id variant',
    (select bool_and(public.is_roster_client(c) = public.is_roster_client_id(c.id)) from clients c));
end $$;

-- ---------------------------------------------------------------------------
-- 2. Lock coverage: every table with a client_id column has the restrictive policy
-- ---------------------------------------------------------------------------
do $$
declare v_missing text;
begin
  select string_agg(t.table_name, ', ') into v_missing
    from information_schema.tables t
   where t.table_schema = 'public' and t.table_type = 'BASE TABLE'
     and (t.table_name = 'clients' or exists (
           select 1 from information_schema.columns c
            where c.table_schema = 'public' and c.table_name = t.table_name and c.column_name = 'client_id'))
     and not exists (select 1 from pg_policies p
                      where p.schemaname = 'public' and p.tablename = t.table_name
                        and p.policyname = 'internal company lock' and p.permissive = 'RESTRICTIVE');
  perform pg_temp.chk('every table with client_id (and clients) has the restrictive internal lock', v_missing is null, v_missing);
end $$;

-- ---------------------------------------------------------------------------
-- 3. Reads by persona: clients row, can_access_client, and child data
-- ---------------------------------------------------------------------------
do $$
declare
  p record; allowed boolean; v_rc text := (select id from _rc);
  tx bigint := (select count(*) from qbo_transactions where client_id = 'mygoodbooks');
  fo bigint := (select count(*) from document_folders where client_id = 'mygoodbooks');
  fl bigint := (select count(*) from gl_review_flags where client_id = 'mygoodbooks');
  nt bigint := (select count(*) from client_internal_notes where client_id = 'mygoodbooks');
begin
  perform pg_temp.chk('seed data exists to make the denials meaningful (tx/folders/flags > 0)', tx > 0 and fo > 0 and fl > 0,
    tx || '/' || fo || '/' || fl);
  for p in select k, email from _who where k in ('owner','adm_no','bk_sca','bk_am','bk_temp','client_mgb') loop
    allowed := (p.k = 'owner');
    perform pg_temp.chk(p.k || ': clients row',
      pg_temp.probe(p.email, 'select count(*) from clients where id = ''mygoodbooks''') = case when allowed then '1' else '0' end);
    perform pg_temp.chk(p.k || ': can_access_client',
      pg_temp.probe(p.email, 'select public.can_access_client(''mygoodbooks'')::text') = allowed::text);
    perform pg_temp.chk(p.k || ': can_view_internal',
      pg_temp.probe(p.email, 'select public.can_view_internal()::text') = allowed::text);
    perform pg_temp.chk(p.k || ': qbo_transactions',
      pg_temp.probe(p.email, 'select count(*) from qbo_transactions where client_id = ''mygoodbooks''') = case when allowed then tx::text else '0' end);
    perform pg_temp.chk(p.k || ': document_folders',
      pg_temp.probe(p.email, 'select count(*) from document_folders where client_id = ''mygoodbooks''') = case when allowed then fo::text else '0' end);
    perform pg_temp.chk(p.k || ': gl_review_flags',
      pg_temp.probe(p.email, 'select count(*) from gl_review_flags where client_id = ''mygoodbooks''') = case when allowed then fl::text else '0' end);
    perform pg_temp.chk(p.k || ': month_close / client_internal_notes via RLS',
      pg_temp.probe(p.email, 'select count(*) from client_internal_notes where client_id = ''mygoodbooks''') = case when allowed then nt::text else '0' end);
  end loop;
  -- A write into the internal client's data is refused too (WITH CHECK).
  perform pg_temp.chk('adm_no: cannot insert a folder for the internal client',
    pg_temp.probe((select email from _who where k = 'adm_no'),
      'with x as (insert into document_folders (client_id, name) values (''mygoodbooks'', ''icp'') returning 1) select count(*) from x') like 'ERR:%');
  -- Nothing else changed: admins still see test + real clients, bookkeepers their own, portal users their org.
  perform pg_temp.chk('adm_no: still sees the real client and both test clients',
    pg_temp.probe((select email from _who where k = 'adm_no'),
      'select count(*) from clients where id in (''' || v_rc || ''', ''basic-test'', ''grace-community'')') = '3');
  perform pg_temp.chk('adm_no: can_access_client(real client) still true',
    pg_temp.probe((select email from _who where k = 'adm_no'), 'select public.can_access_client(''' || v_rc || ''')::text') = 'true');
  perform pg_temp.chk('bk_sca: still reaches the real client she is assigned',
    pg_temp.probe((select email from _who where k = 'bk_sca'), 'select public.can_access_client(''' || v_rc || ''')::text') = 'true');
  perform pg_temp.chk('client_rc: still reads their own org',
    pg_temp.probe((select email from _who where k = 'client_rc'), 'select count(*) from clients where id = ''' || v_rc || '''') = '1');
  perform pg_temp.chk('temp admin is still NOT an admin in the database (so the lock holds)',
    pg_temp.probe((select email from _who where k = 'bk_temp'), 'select public.is_active_staff_admin()::text') = 'false');
end $$;

-- ---------------------------------------------------------------------------
-- 4. Granting: owner-only, nobody can self-grant
-- ---------------------------------------------------------------------------
do $$
declare
  p record; adm text := (select email from _who where k = 'adm_no'); own text := (select email from _who where k = 'owner');
  bk text := (select email from _who where k = 'bk_sca'); v text;
  tx bigint := (select count(*) from qbo_transactions where client_id = 'mygoodbooks');
begin
  for p in select k, email from _who where k in ('adm_no','bk_sca','bk_am','bk_temp','client_mgb') loop
    perform pg_temp.chk(p.k || ': set_internal_access(self, true) refused',
      pg_temp.probe(p.email, 'select public.set_internal_access(''' || p.email || ''', true)::text') like 'ERR:42501%');
    perform pg_temp.chk(p.k || ': direct INSERT into internal_access refused',
      pg_temp.probe(p.email, 'with x as (insert into internal_access (staff_email) values (''' || p.email || ''') returning 1) select count(*) from x') like 'ERR:42501%');
    perform pg_temp.chk(p.k || ': direct UPDATE of internal_access refused',
      pg_temp.probe(p.email, 'with x as (update internal_access set is_owner = true returning 1) select count(*) from x') like 'ERR:42501%');
    perform pg_temp.chk(p.k || ': direct DELETE from internal_access refused',
      pg_temp.probe(p.email, 'with x as (delete from internal_access returning 1) select count(*) from x') like 'ERR:42501%');
  end loop;
  perform pg_temp.chk('internal_access unchanged by all self-grant attempts (default rows only, opted-out admin still off)',
    (select count(*) from internal_access) = (select count(*) from staff where role = 'admin' and active and email <> adm));
  perform pg_temp.chk('bk_sca / client cannot read the grant list (0 rows or no access)',
    pg_temp.probe(bk, 'select count(*) from internal_access') in ('0')
    and pg_temp.probe((select email from _who where k = 'client_mgb'), 'select count(*) from internal_access') in ('0')
       or pg_temp.probe((select email from _who where k = 'client_mgb'), 'select count(*) from internal_access') like 'ERR:%');

  -- Owner grants an admin.
  v := pg_temp.probe(own, 'select public.set_internal_access(''' || adm || ''', true)::text');
  perform pg_temp.chk('owner can grant an admin', v not like 'ERR:%', v);
  perform pg_temp.chk('granted admin now sees the internal clients row',
    pg_temp.probe(adm, 'select count(*) from clients where id = ''mygoodbooks''') = '1');
  perform pg_temp.chk('granted admin now sees qbo_transactions',
    pg_temp.probe(adm, 'select count(*) from qbo_transactions where client_id = ''mygoodbooks''') = tx::text);
  perform pg_temp.chk('a granted admin cannot pass it on (not the owner)',
    pg_temp.probe(adm, 'select public.set_internal_access(''' || bk || ''', true)::text') like 'ERR:42501%');
  perform pg_temp.chk('owner sees the whole grant list; a granted admin sees only own (1); a bookkeeper 0',
    pg_temp.probe(own, 'select count(*) from internal_access') = (select count(*) from internal_access)::text
    and pg_temp.probe(adm, 'select count(*) from internal_access') = '1'
    and pg_temp.probe(bk, 'select count(*) from internal_access') = '0');
  perform pg_temp.chk('owner cannot grant a bookkeeper (admins only)',
    pg_temp.probe(own, 'select public.set_internal_access(''' || bk || ''', true)::text') like 'ERR:22023%');
  perform pg_temp.chk('owner cannot grant someone who is not staff',
    pg_temp.probe(own, 'select public.set_internal_access(''nobody@example.test'', true)::text') like 'ERR:22023%');
  perform pg_temp.chk('the owner row cannot be revoked',
    pg_temp.probe(own, 'select public.set_internal_access(''' || own || ''', false)::text') like 'ERR:22023%');

  -- Demotion removes the grant (and it does not return on re-promotion).
  perform pg_temp.claims(own);
  update staff set role = 'bookkeeper' where email = adm;
  perform pg_temp.chk('demoting a granted admin removes the grant',
    not exists (select 1 from internal_access where staff_email = adm));
  update staff set role = 'admin' where email = adm;
  perform pg_temp.claims(null);
  perform pg_temp.chk('re-promoted admin (not opted out) gets access again by default',
    pg_temp.probe(adm, 'select count(*) from clients where id = ''mygoodbooks''') = '1');

  -- Owner revokes.
  perform pg_temp.probe(own, 'select public.set_internal_access(''' || adm || ''', true)::text');
  v := pg_temp.probe(own, 'select public.set_internal_access(''' || adm || ''', false)::text');
  perform pg_temp.chk('owner can revoke', v not like 'ERR:%' and
    pg_temp.probe(adm, 'select public.can_view_internal()::text') = 'false', v);
  perform pg_temp.chk('grant and revoke are audited',
    (select count(*) from audit_log where action in ('internal_access.granted','internal_access.revoked')
        and at > now() - interval '1 hour') >= 2);
end $$;

-- ---------------------------------------------------------------------------
-- 5. Rollups leave test + internal clients out
-- ---------------------------------------------------------------------------
do $$
declare
  own text := (select email from _who where k = 'owner'); bk text := (select email from _who where k = 'bk_sca');
  v_rc text := (select id from _rc);
  d jsonb; hit text := '"(mygoodbooks|basic-test|grace-community)"';
  perf0 text; perf1 text; perf2 text; sc0 numeric; sc1 numeric; sc2 numeric;
  ws date := date_trunc('week', current_date)::date - 7;
  v text;
begin
  -- weekly digest payload
  d := public.digest_weekly_data(ws, current_date);
  perform pg_temp.chk('digest_weekly_data: no test/internal client id anywhere in the payload', d::text !~ hit);
  perform pg_temp.chk('digest_weekly_data: revenue counts roster clients only',
    (d -> 'revenue' ->> 'active_clients')::int = (select count(*) from clients c where public.is_roster_client(c)));
  perform pg_temp.chk('digest_needs_attention(false/true): no internal client',
    public.digest_needs_attention(false)::text !~ '"mygoodbooks"' and public.digest_needs_attention(true)::text !~ '"mygoodbooks"');
  perform pg_temp.chk('digest_fee_suggestions(true): no internal client', public.digest_fee_suggestions(true)::text !~ '"mygoodbooks"');

  -- tasks tied to test / internal clients stay out of performance + scorecard
  perform pg_temp.claims(own);
  perf0 := pg_temp.probe(own, 'select coalesce(sum(tasks_overdue), 0) from staff_performance(30)');
  sc0 := (select coalesce(sum((x ->> 'tasks_overdue')::int), 0)
            from jsonb_array_elements(public.digest_weekly_data(ws, current_date) -> 'scorecard') x);
  perform pg_temp.claims(own);
  insert into staff_reminders (staff_email, assignee_email, text, client_id, due_date, visibility)
    values (bk, bk, 'icp overdue (internal client)', 'mygoodbooks', current_date - 3, 'shared'),
           (bk, bk, 'icp overdue (test client)', 'grace-community', current_date - 3, 'shared');
  perform pg_temp.claims(null);
  perf1 := pg_temp.probe(own, 'select coalesce(sum(tasks_overdue), 0) from staff_performance(30)');
  sc1 := (select coalesce(sum((x ->> 'tasks_overdue')::int), 0)
            from jsonb_array_elements(public.digest_weekly_data(ws, current_date) -> 'scorecard') x);
  perform pg_temp.chk('staff_performance: overdue tasks on test/internal clients not counted', perf1 = perf0, perf0 || ' -> ' || perf1);
  perform pg_temp.chk('digest scorecard: overdue tasks on test/internal clients not counted', sc1 = sc0, sc0 || ' -> ' || sc1);
  perform pg_temp.claims(own);
  insert into staff_reminders (staff_email, assignee_email, text, client_id, due_date, visibility)
    values (bk, bk, 'icp overdue (real client control)', v_rc, current_date - 3, 'shared');
  perform pg_temp.claims(null);
  perf2 := pg_temp.probe(own, 'select coalesce(sum(tasks_overdue), 0) from staff_performance(30)');
  sc2 := (select coalesce(sum((x ->> 'tasks_overdue')::int), 0)
            from jsonb_array_elements(public.digest_weekly_data(ws, current_date) -> 'scorecard') x);
  perform pg_temp.chk('staff_performance: an overdue task on a real client IS counted (control)', perf2::numeric = perf0::numeric + 1, perf0 || ' -> ' || perf2);
  perform pg_temp.chk('digest scorecard: an overdue task on a real client IS counted (control)', sc2 = sc0 + 1, sc0 || ' -> ' || sc2);

  -- usage stats
  insert into usage_events (actor_email, actor_role, client_id, page, kind)
    values ('icp@example.test', 'staff', 'grace-community', 'zz-icp-hidden', 'view'),
           ('icp@example.test', 'staff', 'mygoodbooks', 'zz-icp-hidden', 'view'),
           ('icp@example.test', 'staff', v_rc, 'zz-icp-shown', 'view');
  v := pg_temp.probe(own, 'select (public.usage_summary(30) -> ''pages'')::text');
  perform pg_temp.chk('usage_summary: page views on test/internal clients are left out, real ones kept',
    v like '%zz-icp-shown%' and v not like '%zz-icp-hidden%', left(v, 60));
  perform pg_temp.chk('usage_summary: quiet_clients lists no test/internal client',
    pg_temp.probe(own, 'select (public.usage_summary(30) -> ''quiet_clients'')::text') !~ '"id": "(mygoodbooks|basic-test|grace-community)"');

  -- money / hours / health / response-time rollups
  perform pg_temp.chk('client_profitability: no test/internal client',
    pg_temp.probe(own, 'select count(*) from client_profitability(current_date - 90, current_date) where client_id in (''mygoodbooks'',''basic-test'',''grace-community'')') = '0');
  perform pg_temp.chk('client_profitability: real client still listed (control)',
    pg_temp.probe(own, 'select count(*) from client_profitability(current_date - 90, current_date) where client_id = ''' || v_rc || '''') = '1');
  perform pg_temp.chk('client_health: internal client dropped, test client still listed per-client (control)',
    pg_temp.probe(own, 'select count(*) from client_health() where client_id = ''mygoodbooks''') = '0'
    and pg_temp.probe(own, 'select count(*) from client_health() where client_id = ''grace-community''') = '1');
  perform pg_temp.chk('client_reply_times: no test/internal client',
    pg_temp.probe(own, 'select (public.client_reply_times(current_date - 365, current_date))::text') !~ hit);
  perform pg_temp.chk('qbo_hours_by_client: no test/internal client',
    pg_temp.probe(own, 'select count(*) from qbo_hours_by_client(current_date - 3650, current_date) where client_id in (''mygoodbooks'',''basic-test'',''grace-community'')') = '0');
  perform pg_temp.chk('qbo_hours_by_staff runs',
    pg_temp.probe(own, 'select count(*) from qbo_hours_by_staff(current_date - 3650, current_date)') !~ '^ERR');
  perform pg_temp.chk('coverage_overview: no test/internal client',
    pg_temp.probe(own, 'select (public.coverage_overview(current_date - 60, current_date + 60))::text') !~ hit);
  v := pg_temp.probe(own, 'select public.grant_coverage_access(gen_random_uuid(), ''mygoodbooks'')::text');
  perform pg_temp.chk('grant_coverage_access refuses the internal client', v like 'ERR:22023:Coverage access is not available%', v);
  perform pg_temp.chk('ops_health_problems runs', (select count(*) from public.ops_health_problems()) >= 0);
  perform public.qbo_firm_auto_match('icp-no-such-realm');
  perform pg_temp.chk('qbo_firm_auto_match runs', true);
end $$;

-- Template tasks are not generated for test / internal clients.
do $$
declare v_rc text := (select id from _rc); v_t uuid; n_bad bigint; n_rc bigint;
begin
  perform pg_temp.claims((select email from _who where k = 'owner'));
  -- templates default to draft since Tasks p2 S4; this control needs one that is on
  insert into task_templates (title, cadence, due_offset_days, lead_days, client_ids, active, status, activated_at)
    values ('icp template', 'monthly', 0, 40, array['mygoodbooks','basic-test','grace-community', v_rc], true, 'active', now())
    returning id into v_t;
  perform public.tt_generate_template_tasks(current_date);
  select count(*) into n_bad from task_template_issued where template_id = v_t and client_id in ('mygoodbooks','basic-test','grace-community');
  select count(*) into n_rc from task_template_issued where template_id = v_t and client_id = v_rc;
  perform pg_temp.claims(null);
  perform pg_temp.chk('tt_generate_template_tasks: nothing issued for test/internal clients', n_bad = 0, n_bad::text);
  perform pg_temp.chk('tt_generate_template_tasks: still issued for the real client (control)', n_rc >= 1, n_rc::text);
end $$;

-- ---------------------------------------------------------------------------
-- 6. The patched function bodies contain the exclusion (and kept their grants)
-- ---------------------------------------------------------------------------
do $$
declare r record; d text;
begin
  for r in select * from (values
    ('public.audit_row_change()', 'is_internal'),
    ('public.digest_fee_suggestions(boolean)', 'is_roster_client'),
    ('public.digest_needs_attention(boolean)', 'is_internal'),
    ('public.digest_weekly_data(date,date)', 'is_roster_client'),
    ('public.staff_performance(integer,jsonb)', 'is_roster_client_id'),
    ('public.usage_summary(integer)', 'is_roster_client_id'),
    ('public.qbo_firm_auto_match(text)', 'is_roster_client'),
    ('public.client_health(jsonb)', 'is_internal'),
    ('public.client_profitability(date,date,jsonb)', 'is_roster_client'),
    ('public.client_reply_times(date,date)', 'is_roster_client_id'),
    ('public.qbo_hours_by_client(date,date)', 'is_roster_client_id'),
    ('public.qbo_hours_by_staff(date,date)', 'is_roster_client_id'),
    ('public.tt_generate_template_tasks(date)', 'is_roster_client'),
    ('public.ops_health_problems()', 'is_roster_client'),
    ('public.coverage_overview(date,date)', 'is_roster_client'),
    ('public.grant_coverage_access(uuid,text)', 'is_internal'),
    ('public.request_client_access(text,text,integer)', 'can_view_internal'),
    ('public.tk_row_readable(uuid,text,text,text,uuid,text)', 'internal_blocked_ids'),
    ('public.tk_staff_has_client(text,text)', 'internal_access'),
    ('public.can_access_client(text)', 'can_view_internal'),
    ('public.can_approve_client_access(text)', 'can_view_internal'),
    ('public.tk_can_edit_task(uuid)', 'internal_blocked_ids'),
    ('public.is_client_member(text)', 'is_internal'),
    ('public.st_my_client_user()', 'is_internal'),
    ('public.offboard_staff_preview(text)', 'internal_blocked_ids'),
    ('public.qbo_set_customer_mapping(text,text,boolean,text)', 'can_view_internal')) as t(sig, needle)
  loop
    d := pg_get_functiondef(r.sig::regprocedure);
    perform pg_temp.chk('function patched: ' || r.sig, position(r.needle in d) > 0);
  end loop;
  perform pg_temp.chk('QuickBooks key/env functions untouched (no internal logic added)',
    pg_get_functiondef('public.qbo_connect_start(text)'::regprocedure) !~ 'is_internal'
    and pg_get_functiondef('public.qbo_env_for_client(boolean)'::regprocedure) !~ 'is_internal');
end $$;


-- ---------------------------------------------------------------------------
-- 5b. Review follow-ups: task write paths, client portal, offboarding preview,
--     ops alerts, QBO mapping, helper grants, email rename
-- ---------------------------------------------------------------------------
-- ---------------------------------------------------------------------------
-- 7. Default ON for admins, owner can switch OFF (section 6 of the migration)
-- ---------------------------------------------------------------------------
do $$
declare
  own text := (select email from _who where k = 'owner');
  adm text := (select email from _who where k = 'adm_no');
  bk  text := (select email from _who where k = 'bk_sca');
  other text := (select s.email from staff s join internal_access ia on ia.staff_email = s.email
                  where s.role = 'admin' and s.active and s.email <> own and s.email <> adm limit 1);
begin
  perform pg_temp.chk('default-on: every active admin except the opted-out one has a row',
    not exists (select 1 from staff s where s.role = 'admin' and s.active and s.email <> adm
                  and not exists (select 1 from internal_access ia where ia.staff_email = s.email)));
  perform pg_temp.chk('default-on: the opted-out admin has no access and cannot see the client',
    not exists (select 1 from internal_access where staff_email = adm)
    and pg_temp.probe(adm, 'select count(*)::text from clients where id = ''mygoodbooks''') = '0');
  perform pg_temp.chk('default-on: another admin (not opted out) sees MGB',
    other is null or pg_temp.probe(other, 'select count(*)::text from clients where id = ''mygoodbooks''') = '1');
  perform pg_temp.chk('default-on: a non-owner cannot switch anyone on',
    pg_temp.probe(adm, format('select set_internal_access(%L, true)::text', adm)) like 'ERR:42501%');
  perform pg_temp.claims(own);
  perform set_internal_access(adm, true);
  perform pg_temp.chk('owner can switch an admin back on',
    exists (select 1 from internal_access where staff_email = adm)
    and not exists (select 1 from internal_access_optout where staff_email = adm));
  perform set_internal_access(adm, false);
  perform pg_temp.claims(null);
  perform pg_temp.chk('owner can switch an admin off (remembered)',
    not exists (select 1 from internal_access where staff_email = adm)
    and exists (select 1 from internal_access_optout where staff_email = adm));
  update staff set role = 'admin' where email = bk;
  perform pg_temp.chk('a newly promoted admin gets access by default',
    exists (select 1 from internal_access where staff_email = bk));
  update staff set role = 'bookkeeper' where email = bk;
  perform pg_temp.chk('a demoted admin loses the row',
    not exists (select 1 from internal_access where staff_email = bk));
  update staff set role = 'bookkeeper' where email = adm;
  update staff set role = 'admin' where email = adm;
  perform pg_temp.chk('an opted-out admin stays off after demote + promote',
    not exists (select 1 from internal_access where staff_email = adm));
  perform pg_temp.chk('bookkeeper / temp admin still see nothing',
    pg_temp.probe((select email from _who where k = 'bk_temp'), 'select count(*)::text from clients where id = ''mygoodbooks''') = '0');
end $$;

do $$
declare
  own text := (select email from _who where k = 'owner'); adm text := (select email from _who where k = 'adm_no');
  bk text := (select email from _who where k = 'bk_sca'); cl text := (select email from _who where k = 'client_mgb');
  clr text := (select email from _who where k = 'client_rc'); v_rc text := (select id from _rc);
  t_int uuid := (select id from staff_reminders where text = 'icp overdue (internal client)');
  t_rc uuid := (select id from staff_reminders where text = 'icp overdue (real client control)');
  c_int uuid; v text;
begin
  perform pg_temp.chk('fixture tasks exist', t_int is not null and t_rc is not null);
  -- a comment on the internal task and one on the real-client task
  perform pg_temp.claims(own);
  perform set_config('mgb.tk_rpc', 'on', true);
  insert into tk_comments (task_id, author_email, body, kind) values (t_int, own, 'icp comment', 'comment') returning id into c_int;
  perform set_config('mgb.tk_rpc', '', true);
  perform pg_temp.claims(null);

  -- admin WITHOUT the grant: every task write path on an internal-client task is refused
  perform pg_temp.chk('adm_no: tk_can_edit_task(internal task) false',
    pg_temp.probe(adm, 'select public.tk_can_edit_task(''' || t_int || ''')::text') = 'false');
  perform pg_temp.chk('adm_no: tk_can_read_task(internal task) false',
    pg_temp.probe(adm, 'select public.tk_can_read_task(''' || t_int || ''')::text') = 'false');
  perform pg_temp.chk('adm_no: cannot attach a link to an internal task',
    pg_temp.probe(adm, 'with x as (insert into tk_attachments (task_id, kind, name, url) values (''' || t_int || ''', ''link'', ''icp'', ''https://example.test/x'') returning 1) select count(*) from x') like 'ERR:%');
  perform pg_temp.chk('adm_no: tk_set_status refused',
    pg_temp.probe(adm, 'select public.tk_set_status(''' || t_int || ''', ''in_progress'')') like 'ERR:42501%');
  perform pg_temp.chk('adm_no: complete_staff_item refused',
    pg_temp.probe(adm, 'select public.complete_staff_item(''' || t_int || ''', true)::text') like 'ERR:42501%');
  perform pg_temp.chk('adm_no: tk_add_follower refused (other person and self)',
    pg_temp.probe(adm, 'select public.tk_add_follower(''' || t_int || ''', ''' || bk || ''')::text') like 'ERR:42501%'
    and pg_temp.probe(adm, 'select public.tk_add_follower(''' || t_int || ''', ''' || adm || ''')::text') like 'ERR:42501%');
  perform pg_temp.chk('adm_no: cannot edit another person''s comment on an internal task',
    pg_temp.probe(adm, 'with x as (update tk_comments set body = ''hijack'' where id = ''' || c_int || ''' returning 1) select count(*) from x') = '0');
  perform pg_temp.chk('adm_no: tk_search does not return the internal task',
    pg_temp.probe(adm, 'select count(*) from tk_search(''icp'', 50) where client_id = ''mygoodbooks''') = '0');
  perform pg_temp.chk('bk_sca (assigned to internal client): cannot edit internal task',
    pg_temp.probe(bk, 'select public.tk_can_edit_task(''' || t_int || ''')::text') = 'false');
  -- controls: same actions on a real-client task still work for that admin
  perform pg_temp.chk('adm_no: still edits a real-client task (control)',
    pg_temp.probe(adm, 'select public.tk_can_edit_task(''' || t_rc || ''')::text') = 'true');
  -- the owner (holds the grant) keeps full use
  perform pg_temp.chk('owner: tk_can_edit_task / read on internal task true',
    pg_temp.probe(own, 'select public.tk_can_edit_task(''' || t_int || ''')::text') = 'true'
    and pg_temp.probe(own, 'select public.tk_can_read_task(''' || t_int || ''')::text') = 'true');
  perform pg_temp.chk('owner: can attach a link to an internal task',
    pg_temp.probe(own, 'with x as (insert into tk_attachments (task_id, kind, name, url) values (''' || t_int || ''', ''link'', ''icp'', ''https://example.test/x'') returning 1) select count(*) from x') = '1');
  v := pg_temp.probe(own, 'select public.tk_set_status(''' || t_int || ''', ''in_progress'')');
  perform pg_temp.chk('owner: tk_set_status works on internal task', v = 'in_progress', v);
  v := pg_temp.probe(own, 'select public.tk_add_follower(''' || t_int || ''', ''' || own || ''')::text');
  perform pg_temp.chk('owner: tk_add_follower works', v in ('true', 'false'), v);
  v := pg_temp.probe(own, 'select coalesce(public.complete_staff_item(''' || t_int || ''', true)::text, ''done'')');
  perform pg_temp.chk('owner: complete_staff_item works on internal task', v not like 'ERR:%', v);
  perform pg_temp.chk('owner: edits own comment on internal task',
    pg_temp.probe(own, 'with x as (update tk_comments set body = ''icp edit'' where id = ''' || c_int || ''' returning 1) select count(*) from x') = '1');

  -- client portal: nothing for the internal client, real clients unchanged
  perform pg_temp.chk('client_mgb: is_client_member(internal) false',
    pg_temp.probe(cl, 'select public.is_client_member(''mygoodbooks'')::text') = 'false');
  perform pg_temp.chk('client_mgb: st_my_client_user() empty',
    pg_temp.as_jwt(cl, 'select (public.st_my_client_user()).email') = 'null',
    pg_temp.as_jwt(cl, 'select (public.st_my_client_user()).email'));
  perform pg_temp.chk('client_mgb: can_use_client_tools(internal) false',
    pg_temp.probe(cl, 'select public.can_use_client_tools(''mygoodbooks'')::text') in ('false', 'null'));
  perform pg_temp.chk('client_mgb: client_org_settings / team return nothing or are refused',
    pg_temp.probe(cl, 'select count(*) from public.client_org_team(''mygoodbooks'')') in ('0') 
    or pg_temp.probe(cl, 'select count(*) from public.client_org_team(''mygoodbooks'')') like 'ERR:%');
  perform pg_temp.chk('client_rc: is_client_member(real) true, st_my_client_user() found (control)',
    pg_temp.probe(clr, 'select public.is_client_member(''' || v_rc || ''')::text') = 'true'
    and pg_temp.as_jwt(clr, 'select (public.st_my_client_user()).email') = clr);
  begin
    insert into client_users (email, client_id, name, role, active) values ('icp-x@example.test', 'mygoodbooks', 'x', 'Contact', true);
    perform pg_temp.chk('client_users insert for the internal client refused', false);
  exception when others then
    perform pg_temp.chk('client_users insert for the internal client refused', sqlstate = '22023', sqlstate);
  end;
  begin
    update client_users set client_id = 'mygoodbooks' where email = clr;
    perform pg_temp.chk('moving a portal user onto the internal client refused', false);
  exception when others then
    perform pg_temp.chk('moving a portal user onto the internal client refused', sqlstate = '22023', sqlstate);
  end;

  -- offboarding preview
  perform pg_temp.chk('offboard_staff_preview: owner still sees the internal assignment',
    pg_temp.probe(own, 'select (public.offboard_staff_preview(''' || bk || '''))::text') like '%"client_id": "mygoodbooks"%');
  perform pg_temp.chk('offboard_staff_preview: admin without the grant does not',
    pg_temp.probe(adm, 'select (public.offboard_staff_preview(''' || bk || '''))::text') not like '%"client_id": "mygoodbooks"%'
    and pg_temp.probe(adm, 'select (public.offboard_staff_preview(''' || bk || '''))::text') not like 'ERR:%');
  perform pg_temp.chk('offboard_staff_preview: real-client assignment still listed for that admin (control)',
    pg_temp.probe(adm, 'select (public.offboard_staff_preview(''' || bk || '''))::text') like '%' || v_rc || '%');

  -- ops alerts
  insert into ops_alert_state (key, title, detail, last_alerted_at)
    values ('icp_test:mygoodbooks', 'ICP internal alert', 'x', now()), ('icp_test:' || v_rc, 'ICP control alert', 'x', now());
  perform pg_temp.chk('ops_alert_state: owner sees the internal alert row',
    pg_temp.probe(own, 'select count(*) from ops_alert_state where key like ''icp_test:%''') = '2');
  perform pg_temp.chk('ops_alert_state: admin without the grant sees only the real-client row',
    pg_temp.probe(adm, 'select count(*) from ops_alert_state where key = ''icp_test:mygoodbooks''') = '0'
    and pg_temp.probe(adm, 'select count(*) from ops_alert_state where key = ''icp_test:' || v_rc || '''') = '1');
  perform pg_temp.chk('ops_alert_state: bookkeeper still reads nothing (control)',
    pg_temp.probe(bk, 'select count(*) from ops_alert_state') = '0');
  perform pg_temp.chk('digest_needs_attention: internal alert title left out, real one kept',
    public.digest_needs_attention(true)::text not like '%ICP internal alert%'
    and public.digest_needs_attention(true)::text like '%ICP control alert%');

  -- QuickBooks customer mapping onto the internal client
  perform pg_temp.chk('qbo_set_customer_mapping: admin without the grant cannot map to the internal client',
    pg_temp.probe(adm, 'select public.qbo_set_customer_mapping(''icp-none'', ''mygoodbooks'', false, ''icp-realm'')::text') like 'ERR:%not authorized%');
  v := pg_temp.probe(own, 'select public.qbo_set_customer_mapping(''icp-none'', ''mygoodbooks'', false, ''icp-realm'')::text');
  perform pg_temp.chk('qbo_set_customer_mapping: the owner passes the check (fails later on the fake customer)',
    v like '%unknown QuickBooks customer%', v);

  -- helper grants
  perform pg_temp.chk('is_roster_client_id: anon cannot execute; signed-in and service can',
    not has_function_privilege('anon', 'public.is_roster_client_id(text)', 'execute')
    and has_function_privilege('authenticated', 'public.is_roster_client_id(text)', 'execute')
    and has_function_privilege('service_role', 'public.is_roster_client_id(text)', 'execute'));

  -- staff email rename keeps the grant (and the owner row) attached
  perform pg_temp.probe(own, 'select public.set_internal_access(''' || adm || ''', true)::text');
  begin
    -- staff_profiles refuses an email change (its own rule, and staff.email
    -- cascades into it), so a rename cannot happen through the app. Disable
    -- that guard for this transaction to prove the grant still follows.
    alter table staff_profiles disable trigger user;
    perform pg_temp.claims(own);
    update staff set email = 'icp-renamed@mygoodbooks.org' where email = adm;
    perform pg_temp.claims(null);
    perform pg_temp.chk('email rename: the grant moves with the staff row',
      exists (select 1 from internal_access where staff_email = 'icp-renamed@mygoodbooks.org')
      and not exists (select 1 from internal_access where staff_email = adm));
    update staff set email = 'icp-owner-renamed@mygoodbooks.org' where email = own;
    perform pg_temp.chk('email rename: the owner row follows too',
      exists (select 1 from internal_access where staff_email = 'icp-owner-renamed@mygoodbooks.org' and is_owner));
  exception when others then
    perform pg_temp.chk('email rename test ran', false, sqlstate || ' ' || sqlerrm);
  end;
end $$;

do $$
declare bad text;
begin
  select string_agg(name || coalesce(' [' || detail || ']', ''), E'\n  ') into bad from _icp where not ok;
  if bad is not null then
    raise exception E'internal-company-profile tests FAILED:\n  %', bad;
  end if;
  raise notice 'internal-company-profile tests: all % passed', (select count(*) from _icp);
end $$;

rollback;
