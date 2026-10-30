-- Tests for client-tab-rls.sql. Run as postgres (SQL editor / MCP).
-- Everything happens inside one DO block that always ends by raising an
-- exception, so the synthetic client_users rows and the plan / hidden_tabs
-- changes on the test org are rolled back. No real login or data is created.
-- The exception message carries the JSON results; "fail" lists any check
-- that did not match.
-- Last run 2026-10-30 on grace-community (premium, payroll add-on): all pass.
do $$
declare
  v_org constant text := 'grace-community';
  v_cat text;
  v_res jsonb := '{}'::jsonb;
  v_fail text[] := '{}';
  v_all jsonb;
  v_c jsonb;
  v_exp jsonb;
  v_case record;
  v_tables constant text[] := array['qbo_accounts','qbo_transactions','qbo_monthly_pl','qbo_pl_lines','qbo_budget_lines','qbo_invoices','qbo_bills','qbo_donor_gifts','qbo_donor_gift_pulls','client_fund_accounts','client_giving_accounts'];
  t text;
  n bigint;
  k text;
begin
  -- Org totals as postgres (RLS bypassed).
  v_all := '{}'::jsonb;
  foreach t in array v_tables loop
    execute format('select count(*) from public.%I where client_id = $1', t) into n using v_org;
    v_all := v_all || jsonb_build_object(t, n);
  end loop;
  select account_name into v_cat from public.qbo_pl_lines where client_id = v_org and coalesce(account_name,'') <> '' order by account_name limit 1;

  insert into public.client_users (email, client_id, name, role, active, access, tabs, categories, funds, premium_throttled) values
    ('tabrls-full@example.invalid',        v_org, 'T full',        'member', true, 'full',   null, null, null, false),
    ('tabrls-tabs-live@example.invalid',   v_org, 'T tabs live',   'member', true, 'scoped', array['dashboard','messages'], null, null, false),
    ('tabrls-tabs-thr@example.invalid',    v_org, 'T tabs thr',    'member', true, 'scoped', array['dashboard','messages'], null, null, true),
    ('tabrls-scoped-all@example.invalid',  v_org, 'T scoped all',  'member', true, 'scoped', null, null, null, true),
    ('tabrls-fund-thr@example.invalid',    v_org, 'T fund thr',    'member', true, 'scoped', null, null, array['Restricted - Missions'], true),
    ('tabrls-fund-live@example.invalid',   v_org, 'T fund live',   'member', true, 'scoped', null, null, array['Restricted - Missions'], false),
    ('tabrls-cat@example.invalid',         v_org, 'T cat',         'member', true, 'scoped', null, array[v_cat], null, false),
    ('tabrls-inactive@example.invalid',    v_org, 'T inactive',    'member', false, 'full',  null, null, null, false);

  -- Each phase: optional org change, then a list of (email, expected json).
  -- Expected values: 'all' = org total, a number = exact count.
  for v_case in
    select * from (values
      -- Pro org, nothing hidden
      (1, 'tabrls-full@example.invalid',       '{}'::jsonb),
      (1, 'tabrls-tabs-live@example.invalid',  '{"qbo_donor_gifts":0,"qbo_donor_gift_pulls":0,"client_giving_accounts":0}'::jsonb),
      (1, 'tabrls-tabs-thr@example.invalid',   '{"qbo_invoices":0,"qbo_bills":0,"qbo_donor_gifts":0,"qbo_donor_gift_pulls":0,"client_giving_accounts":0}'::jsonb),
      (1, 'tabrls-scoped-all@example.invalid', '{}'::jsonb),
      (1, 'tabrls-fund-thr@example.invalid',   '{"qbo_accounts":"all-hidden","qbo_donor_gifts":0,"qbo_donor_gift_pulls":0,"client_giving_accounts":0}'::jsonb),
      (1, 'tabrls-fund-live@example.invalid',  '{"qbo_donor_gifts":0,"qbo_donor_gift_pulls":0,"client_giving_accounts":0}'::jsonb),
      (1, 'tabrls-cat@example.invalid',        '"category"'::jsonb),
      (1, 'tabrls-inactive@example.invalid',   '"none"'::jsonb),
      -- Pro org with giving + receivables hidden for everyone
      (2, 'tabrls-full@example.invalid',       '{"qbo_donor_gifts":0,"qbo_donor_gift_pulls":0,"client_giving_accounts":0}'::jsonb),
      -- Basic org
      (3, 'tabrls-full@example.invalid',       '{"qbo_transactions":0,"qbo_donor_gifts":0,"qbo_donor_gift_pulls":0,"client_giving_accounts":0}'::jsonb),
      (3, 'tabrls-tabs-thr@example.invalid',   '{"qbo_transactions":0,"qbo_donor_gifts":0,"qbo_donor_gift_pulls":0,"client_giving_accounts":0}'::jsonb),
      (3, 'tabrls-fund-thr@example.invalid',   '{"qbo_transactions":0,"qbo_donor_gifts":0,"qbo_donor_gift_pulls":0,"client_giving_accounts":0}'::jsonb),
      (3, 'tabrls-cat@example.invalid',        '{"qbo_transactions":0,"qbo_donor_gifts":0,"qbo_donor_gift_pulls":0,"client_giving_accounts":0}'::jsonb),
      -- Basic org with Reports hidden: no page reads QuickBooks data
      (4, 'tabrls-full@example.invalid',       '"none"'::jsonb)
    ) as x(phase, email, expect)
    order by phase
  loop
    perform set_config('role', 'postgres', true);
    if v_case.phase = 2 then
      update public.clients set plan = 'premium', hidden_tabs = array['giving','receivables'] where id = v_org;
    elsif v_case.phase = 3 then
      update public.clients set plan = 'basic', hidden_tabs = '{}' where id = v_org;
    elsif v_case.phase = 4 then
      update public.clients set plan = 'basic', hidden_tabs = array['reports'] where id = v_org;
    end if;

    -- Expected counts (as postgres).
    v_exp := '{}'::jsonb;
    foreach t in array v_tables loop
      if jsonb_typeof(v_case.expect) = 'string' and v_case.expect #>> '{}' = 'none' then
        n := 0;
      elsif jsonb_typeof(v_case.expect) = 'string' and v_case.expect #>> '{}' = 'category' then
        n := case t
          when 'qbo_accounts' then (select count(*) from public.qbo_accounts where client_id = v_org and name = v_cat)
          when 'qbo_transactions' then (select count(*) from public.qbo_transactions where client_id = v_org
                 and (case when btrim(split_account) ~* '^-?split-?$' then 'Split (several accounts)' else btrim(split_account) end) = v_cat)
          when 'qbo_pl_lines' then (select count(*) from public.qbo_pl_lines where client_id = v_org and account_name = v_cat)
          when 'qbo_budget_lines' then (select count(*) from public.qbo_budget_lines where client_id = v_org and account_name = v_cat)
          else 0 end;
      elsif v_case.expect ? t and v_case.expect ->> t = 'all-hidden' then
        -- every account except the other staff-picked funds
        n := (select count(*) from public.qbo_accounts qa where qa.client_id = v_org
               and not exists (select 1 from public.client_fund_accounts cfa, jsonb_array_elements(cfa.accounts) p
                                where cfa.client_id = v_org and p ->> 'name' = qa.name and qa.name <> 'Restricted - Missions'));
      elsif v_case.expect ? t then
        n := (v_case.expect ->> t)::bigint;
      else
        n := (v_all ->> t)::bigint;
      end if;
      v_exp := v_exp || jsonb_build_object(t, n);
    end loop;

    -- Actual counts as the synthetic client.
    perform set_config('request.jwt.claims',
      json_build_object('email', v_case.email, 'role', 'authenticated',
                        'app_metadata', json_build_object('provider', 'email'))::text, true);
    perform set_config('role', 'authenticated', true);
    v_c := '{}'::jsonb;
    foreach t in array v_tables loop
      execute format('select count(*) from public.%I where client_id = $1', t) into n using v_org;
      v_c := v_c || jsonb_build_object(t, n);
    end loop;
    v_c := v_c || jsonb_build_object('tabs',
      (select jsonb_agg(x) from unnest(array['dashboard','messages','budget','bank','receivables','giving','payroll','reports','documents']) x
        where v_org = any(public.my_tab_client_ids(x))));
    perform set_config('role', 'postgres', true);

    foreach t in array v_tables loop
      if (v_c ->> t) is distinct from (v_exp ->> t) then
        v_fail := v_fail || format('phase %s %s %s: got %s want %s', v_case.phase, v_case.email, t, v_c ->> t, v_exp ->> t);
      end if;
    end loop;
    k := v_case.phase || ':' || split_part(v_case.email, '@', 1);
    v_res := v_res || jsonb_build_object(k, v_c);
  end loop;

  raise exception 'TABRLS_RESULT %', jsonb_build_object('fail', v_fail, 'org_totals', v_all, 'category', v_cat, 'cases', v_res)::text;
end $$;
