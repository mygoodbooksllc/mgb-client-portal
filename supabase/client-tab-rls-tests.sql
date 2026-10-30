-- Tests for client-tab-rls.sql and client-tab-rls-2.sql. Run as postgres
-- (SQL editor / MCP). Everything happens inside one DO block that always
-- ends by raising an exception, so the synthetic client_users rows, the
-- synthetic accounts on the second org, the staff assignment and the plan /
-- hidden_tabs changes are all rolled back. No real login or data is created.
-- The exception message carries the JSON results; "fail" lists any check
-- that did not match.
--
-- client_users is keyed by email, so one login belongs to one org. The
-- "multi-org" cases emulate a person with a second membership through a
-- case-variant row (TABRLS-...): it must never widen or narrow what the real
-- (exact-email) login sees. tabrls-dup is the same trick on one org: a
-- scoped login with a full-access case-variant row must not get the Pro tools
-- (the old can_use_client_tools matched lower(email) and let it through).
--
-- Org B (3circle-church, no QuickBooks data) gets ten synthetic accounts and
-- the Pro plan so funds-only logins can be tested on auto-detected funds
-- (no client_fund_accounts row). Expected: Building Fund, Youth Funds
-- Reserve and Unrestricted Net Assets hidden (3 of 10); the active bank
-- "Building Fund Savings", Undeposited Funds, the inactive fund and the
-- income account stay.
--
-- Last run 2026-10-30 on grace-community (premium, payroll add-on): all pass.
do $$
declare
  v_org constant text := 'grace-community';
  v_b constant text := '3circle-church';
  v_cat text;
  v_res jsonb := '{}'::jsonb;
  v_fail text[] := '{}';
  v_tot jsonb := '{}'::jsonb;   -- org -> table -> total
  v_c jsonb;
  v_exp jsonb;
  v_case record;
  v_tables constant text[] := array['qbo_accounts','qbo_transactions','qbo_monthly_pl','qbo_pl_lines','qbo_budget_lines','qbo_invoices','qbo_bills','qbo_donor_gifts','qbo_donor_gift_pulls','client_fund_accounts','client_giving_accounts'];
  -- Pro tools tables and the tab group(s) that open each one
  v_tools constant jsonb := '{
    "client_budget_drafts":["budget"],
    "client_budget_draft_history":["budget"],
    "client_budget_comments":["budget"],
    "client_variance_notes":["budget","reports"],
    "client_report_summaries":["reports"],
    "client_report_templates":["reports"],
    "client_report_shares":["reports"],
    "client_branding":["reports"],
    "client_functional_map":["reports"]}'::jsonb;
  v_ids text[];
  v_keys_ok boolean;
  t text;
  n bigint;
  k text;
  o text;
begin
  -- Second org: Pro, with synthetic accounts and no fund list.
  update public.clients set plan = 'premium', hidden_tabs = '{}' where id = v_b;
  insert into public.qbo_accounts (client_id, qbo_id, name, account_type, classification, active, current_balance) values
    (v_b, 'tabrls-1',  'Restricted - Missions',       'Equity',              'Equity',  true,  100),
    (v_b, 'tabrls-2',  'Building Fund',               'Equity',              'Equity',  true,  200),
    (v_b, 'tabrls-3',  'Youth Funds Reserve',         'Other Current Asset', 'Asset',   true,  300),
    (v_b, 'tabrls-4',  'Unrestricted Net Assets',     'Equity',              'Equity',  true,  400),
    (v_b, 'tabrls-5',  'Operating Checking',          'Bank',                'Asset',   true,  500),
    (v_b, 'tabrls-6',  'Building Fund Savings',       'Bank',                'Asset',   true,  600),
    (v_b, 'tabrls-7',  'Undeposited Funds',           'Other Current Asset', 'Asset',   true,  700),
    (v_b, 'tabrls-8',  'Old Fund',                    'Equity',              'Equity',  false, 0),
    (v_b, 'tabrls-9',  'Office Supplies',             'Expense',             'Expense', true,  0),
    (v_b, 'tabrls-10', 'Mission Fund Income',         'Income',              'Revenue', true,  0);

  -- A bookkeeper assigned to the org (staff path must be unchanged).
  insert into public.staff_client_access (staff_email, client_id)
  values ('gillian@mygoodbooks.org', v_org) on conflict do nothing;

  -- Org totals as postgres (RLS bypassed).
  foreach o in array array[v_org, v_b] loop
    v_c := '{}'::jsonb;
    foreach t in array v_tables loop
      execute format('select count(*) from public.%I where client_id = $1', t) into n using o;
      v_c := v_c || jsonb_build_object(t, n);
    end loop;
    for t in select jsonb_object_keys(v_tools) loop
      if t in ('client_budget_comments', 'client_variance_notes') then
        execute format('select count(*) from public.%I where client_id = $1 and deleted_at is null', t) into n using o;
      else
        execute format('select count(*) from public.%I where client_id = $1', t) into n using o;
      end if;
      v_c := v_c || jsonb_build_object(t, n);
    end loop;
    v_tot := v_tot || jsonb_build_object(o, v_c);
  end loop;
  select account_name into v_cat from public.qbo_pl_lines where client_id = v_org and coalesce(account_name,'') <> '' order by account_name limit 1;

  insert into public.client_users (email, client_id, name, role, active, access, tabs, categories, funds, premium_throttled) values
    ('tabrls-full@example.invalid',        v_org, 'T full',        'member', true, 'full',   null, null, null, false),
    ('tabrls-full-thr@example.invalid',    v_org, 'T full thr',    'member', true, 'full',   null, null, null, true),
    ('tabrls-tabs-live@example.invalid',   v_org, 'T tabs live',   'member', true, 'scoped', array['dashboard','messages'], null, null, false),
    ('tabrls-tabs-thr@example.invalid',    v_org, 'T tabs thr',    'member', true, 'scoped', array['dashboard','messages'], null, null, true),
    ('tabrls-rep-live@example.invalid',    v_org, 'T rep live',    'member', true, 'scoped', array['reports'], null, null, false),
    ('tabrls-rep-thr@example.invalid',     v_org, 'T rep thr',     'member', true, 'scoped', array['reports'], null, null, true),
    ('tabrls-scoped-all@example.invalid',  v_org, 'T scoped all',  'member', true, 'scoped', null, null, null, true),
    ('tabrls-fund-thr@example.invalid',    v_org, 'T fund thr',    'member', true, 'scoped', null, null, array['Restricted - Missions'], true),
    ('tabrls-fund-live@example.invalid',   v_org, 'T fund live',   'member', true, 'scoped', null, null, array['Restricted - Missions'], false),
    ('tabrls-cat@example.invalid',         v_org, 'T cat',         'member', true, 'scoped', null, array[v_cat], null, false),
    ('tabrls-catfund@example.invalid',     v_org, 'T cat fund',    'member', true, 'scoped', null, array[v_cat], array['Restricted - Missions'], false),
    ('tabrls-inactive@example.invalid',    v_org, 'T inactive',    'member', false, 'full',  null, null, null, false),
    -- "multi-org": full on A + funds-only on B, and the reverse
    ('tabrls-multi1@example.invalid',      v_org, 'T multi1',      'member', true, 'scoped', null, null, array['Restricted - Missions'], true),
    ('TABRLS-MULTI1@example.invalid',      v_b,   'T multi1 B',    'member', true, 'full',   null, null, null, false),
    ('tabrls-multi2@example.invalid',      v_org, 'T multi2',      'member', true, 'full',   null, null, null, false),
    ('TABRLS-MULTI2@example.invalid',      v_b,   'T multi2 B',    'member', true, 'scoped', null, null, array['Restricted - Missions'], true),
    -- same org, case-variant full row
    ('tabrls-dup@example.invalid',         v_org, 'T dup',         'member', true, 'scoped', null, null, array['Restricted - Missions'], true),
    ('TABRLS-DUP@example.invalid',         v_org, 'T dup full',    'member', true, 'full',   null, null, null, false),
    -- Pro funds-only on auto-detected funds (org B)
    ('tabrls-b-auto-thr@example.invalid',  v_b,   'T B auto thr',  'member', true, 'scoped', null, null, array['Restricted - Missions'], true),
    ('tabrls-b-auto-live@example.invalid', v_b,   'T B auto live', 'member', true, 'scoped', null, null, array['Restricted - Missions'], false);

  -- Each phase: optional org change, then (org, email, JWT provider, expected).
  -- Expected qbo_* values: absent = org total, a number = exact count,
  -- "all-hidden" = every account except the other staff-picked funds.
  -- String expectations: "none" (everything 0), "category", "catfund".
  -- "tools": tab groups whose Pro tools tables are readable (absent = none).
  for v_case in
    select * from (values
      -- Pro org, nothing hidden
      (1, 'A', 'tabrls-full@example.invalid',        'email',  '{"tools":["budget","reports"]}'::jsonb),
      (1, 'A', 'tabrls-full-thr@example.invalid',    'email',  '{}'::jsonb),
      (1, 'A', 'tabrls-tabs-live@example.invalid',   'email',  '{"qbo_donor_gifts":0,"qbo_donor_gift_pulls":0,"client_giving_accounts":0}'::jsonb),
      (1, 'A', 'tabrls-tabs-thr@example.invalid',    'email',  '{"qbo_invoices":0,"qbo_bills":0,"qbo_donor_gifts":0,"qbo_donor_gift_pulls":0,"client_giving_accounts":0}'::jsonb),
      (1, 'A', 'tabrls-rep-live@example.invalid',    'email',  '{"qbo_donor_gifts":0,"qbo_donor_gift_pulls":0,"client_giving_accounts":0}'::jsonb),
      (1, 'A', 'tabrls-rep-thr@example.invalid',     'email',  '{"qbo_donor_gifts":0,"qbo_donor_gift_pulls":0,"client_giving_accounts":0}'::jsonb),
      (1, 'A', 'tabrls-scoped-all@example.invalid',  'email',  '{}'::jsonb),
      (1, 'A', 'tabrls-fund-thr@example.invalid',    'email',  '{"qbo_accounts":"all-hidden","qbo_donor_gifts":0,"qbo_donor_gift_pulls":0,"client_giving_accounts":0}'::jsonb),
      (1, 'A', 'tabrls-fund-live@example.invalid',   'email',  '{"qbo_donor_gifts":0,"qbo_donor_gift_pulls":0,"client_giving_accounts":0}'::jsonb),
      (1, 'A', 'tabrls-cat@example.invalid',         'email',  '"category"'::jsonb),
      (1, 'A', 'tabrls-catfund@example.invalid',     'email',  '"catfund"'::jsonb),
      (1, 'A', 'tabrls-inactive@example.invalid',    'email',  '"none"'::jsonb),
      (1, 'A', 'tabrls-multi1@example.invalid',      'email',  '{"qbo_accounts":"all-hidden","qbo_donor_gifts":0,"qbo_donor_gift_pulls":0,"client_giving_accounts":0}'::jsonb),
      (1, 'B', 'tabrls-multi1@example.invalid',      'email',  '"none"'::jsonb),
      (1, 'A', 'tabrls-multi2@example.invalid',      'email',  '{"tools":["budget","reports"]}'::jsonb),
      (1, 'B', 'tabrls-multi2@example.invalid',      'email',  '"none"'::jsonb),
      (1, 'A', 'tabrls-dup@example.invalid',         'email',  '{"qbo_accounts":"all-hidden","qbo_donor_gifts":0,"qbo_donor_gift_pulls":0,"client_giving_accounts":0}'::jsonb),
      (1, 'B', 'tabrls-b-auto-thr@example.invalid',  'email',  '{"qbo_accounts":7}'::jsonb),
      (1, 'B', 'tabrls-b-auto-live@example.invalid', 'email',  '{}'::jsonb),
      (1, 'A', 'gillian@mygoodbooks.org',            'google', '{"tools":["budget","reports"]}'::jsonb),
      (1, 'A', 'nobody-tabrls@example.invalid',      'email',  '"none"'::jsonb),
      -- Pro org with giving + receivables hidden for everyone
      (2, 'A', 'tabrls-full@example.invalid',        'email',  '{"qbo_donor_gifts":0,"qbo_donor_gift_pulls":0,"client_giving_accounts":0,"tools":["budget","reports"]}'::jsonb),
      (2, 'A', 'tabrls-rep-thr@example.invalid',     'email',  '{"qbo_donor_gifts":0,"qbo_donor_gift_pulls":0,"client_giving_accounts":0}'::jsonb),
      -- Pro org with Budget hidden: board packet tools only
      (3, 'A', 'tabrls-full@example.invalid',        'email',  '{"tools":["reports"]}'::jsonb),
      (3, 'A', 'gillian@mygoodbooks.org',            'google', '{"tools":["budget","reports"]}'::jsonb),
      -- Pro org with Reports hidden: budget tools only; tabs-only [reports]
      -- is left with Home, which on a throttled login has no invoices/bills
      (4, 'A', 'tabrls-full@example.invalid',        'email',  '{"tools":["budget"]}'::jsonb),
      (4, 'A', 'tabrls-rep-thr@example.invalid',     'email',  '{"qbo_invoices":0,"qbo_bills":0,"qbo_donor_gifts":0,"qbo_donor_gift_pulls":0,"client_giving_accounts":0}'::jsonb),
      -- Basic org
      (5, 'A', 'tabrls-full@example.invalid',        'email',  '{"qbo_transactions":0,"qbo_donor_gifts":0,"qbo_donor_gift_pulls":0,"client_giving_accounts":0}'::jsonb),
      (5, 'A', 'tabrls-tabs-thr@example.invalid',    'email',  '{"qbo_transactions":0,"qbo_donor_gifts":0,"qbo_donor_gift_pulls":0,"client_giving_accounts":0}'::jsonb),
      (5, 'A', 'tabrls-fund-thr@example.invalid',    'email',  '{"qbo_transactions":0,"qbo_donor_gifts":0,"qbo_donor_gift_pulls":0,"client_giving_accounts":0}'::jsonb),
      (5, 'A', 'tabrls-cat@example.invalid',         'email',  '{"qbo_transactions":0,"qbo_donor_gifts":0,"qbo_donor_gift_pulls":0,"client_giving_accounts":0}'::jsonb),
      -- Basic org with Reports hidden: no page reads QuickBooks data
      (6, 'A', 'tabrls-full@example.invalid',        'email',  '"none"'::jsonb)
    ) as x(phase, org, email, prov, expect)
    order by phase
  loop
    perform set_config('role', 'postgres', true);
    o := case v_case.org when 'A' then v_org else v_b end;
    if v_case.phase = 2 then
      update public.clients set plan = 'premium', hidden_tabs = array['giving','receivables'] where id = v_org;
    elsif v_case.phase = 3 then
      update public.clients set plan = 'premium', hidden_tabs = array['budget'] where id = v_org;
    elsif v_case.phase = 4 then
      update public.clients set plan = 'premium', hidden_tabs = array['reports'] where id = v_org;
    elsif v_case.phase = 5 then
      update public.clients set plan = 'basic', hidden_tabs = '{}' where id = v_org;
    elsif v_case.phase = 6 then
      update public.clients set plan = 'basic', hidden_tabs = array['reports'] where id = v_org;
    end if;

    -- Expected counts (as postgres).
    v_exp := '{}'::jsonb;
    foreach t in array v_tables loop
      if jsonb_typeof(v_case.expect) = 'string' and v_case.expect #>> '{}' = 'none' then
        n := 0;
      elsif jsonb_typeof(v_case.expect) = 'string' then
        -- category / catfund (catfund adds the login's own fund account and
        -- the fund list row)
        n := case t
          when 'qbo_accounts' then (select count(*) from public.qbo_accounts where client_id = o
                 and (name = v_cat or (v_case.expect #>> '{}' = 'catfund' and name = 'Restricted - Missions')))
          when 'qbo_transactions' then (select count(*) from public.qbo_transactions where client_id = o
                 and (case when btrim(split_account) ~* '^-?split-?$' then 'Split (several accounts)' else btrim(split_account) end) = v_cat)
          when 'qbo_pl_lines' then (select count(*) from public.qbo_pl_lines where client_id = o and account_name = v_cat)
          when 'qbo_budget_lines' then (select count(*) from public.qbo_budget_lines where client_id = o and account_name = v_cat)
          when 'client_fund_accounts' then case when v_case.expect #>> '{}' = 'catfund' then (v_tot -> o ->> t)::bigint else 0 end
          else 0 end;
      elsif v_case.expect ? t and v_case.expect ->> t = 'all-hidden' then
        -- every account except the other staff-picked funds
        n := (select count(*) from public.qbo_accounts qa where qa.client_id = o
               and not exists (select 1 from public.client_fund_accounts cfa, jsonb_array_elements(cfa.accounts) p
                                where cfa.client_id = o and p ->> 'name' = qa.name and qa.name <> 'Restricted - Missions'));
      elsif v_case.expect ? t then
        n := (v_case.expect ->> t)::bigint;
      else
        n := (v_tot -> o ->> t)::bigint;
      end if;
      v_exp := v_exp || jsonb_build_object(t, n);
    end loop;
    for t in select jsonb_object_keys(v_tools) loop
      n := case
        when jsonb_typeof(v_case.expect) = 'object' and v_case.expect ? 'tools'
             and exists (select 1 from jsonb_array_elements_text(v_case.expect -> 'tools') g
                          where v_tools -> t ? g)
          then (v_tot -> o ->> t)::bigint
        else 0 end;
      v_exp := v_exp || jsonb_build_object(t, n);
    end loop;

    -- Actual counts as the session.
    perform set_config('request.jwt.claims',
      json_build_object('email', v_case.email, 'role', 'authenticated',
                        'app_metadata', json_build_object('provider', v_case.prov,
                                                          'providers', json_build_array(v_case.prov)))::text, true);
    perform set_config('role', 'authenticated', true);
    v_c := '{}'::jsonb;
    foreach t in array v_tables loop
      execute format('select count(*) from public.%I where client_id = $1', t) into n using o;
      v_c := v_c || jsonb_build_object(t, n);
    end loop;
    for t in select jsonb_object_keys(v_tools) loop
      execute format('select count(*) from public.%I where client_id = $1', t) into n using o;
      v_c := v_c || jsonb_build_object(t, n);
    end loop;
    v_c := v_c || jsonb_build_object('tabs',
      (select jsonb_agg(x) from unnest(array['dashboard','messages','budget','bank','receivables','giving','payroll','reports','documents']) x
        where o = any(public.my_tab_client_ids(x))));

    -- S4: the name-keyed helper is closed to logins; the id-keyed one names nothing.
    v_ids := null;
    if v_case.phase = 1 and v_case.email in ('tabrls-fund-thr@example.invalid', 'tabrls-b-auto-thr@example.invalid') then
      begin
        perform public.my_hidden_fund_account_keys();
        v_keys_ok := false;
      exception when insufficient_privilege then
        v_keys_ok := true;
      end;
      v_ids := public.my_hidden_fund_account_ids();
    end if;
    perform set_config('role', 'postgres', true);

    if v_ids is not null then
      if not v_keys_ok then
        v_fail := v_fail || format('phase 1 %s: my_hidden_fund_account_keys() still callable', v_case.email);
      end if;
      -- every entry is <org> chr(31) <an existing qbo_id>, never a name
      if exists (select 1 from unnest(v_ids) x
                  where not exists (select 1 from public.qbo_accounts qa
                                     where x = qa.client_id || chr(31) || qa.qbo_id)
                     or exists (select 1 from public.qbo_accounts qa
                                 where qa.client_id = o and position(qa.name in x) > 0)) then
        v_fail := v_fail || format('phase 1 %s: hidden ids expose names or unknown ids', v_case.email);
      end if;
      if cardinality(v_ids) <> (v_tot -> o ->> 'qbo_accounts')::bigint - (v_c ->> 'qbo_accounts')::bigint then
        v_fail := v_fail || format('phase 1 %s: %s hidden ids for %s hidden rows', v_case.email,
          cardinality(v_ids), (v_tot -> o ->> 'qbo_accounts')::bigint - (v_c ->> 'qbo_accounts')::bigint);
      end if;
      v_c := v_c || jsonb_build_object('hidden_ids', cardinality(v_ids), 'keys_rpc_denied', v_keys_ok);
    end if;

    for t in select jsonb_object_keys(v_exp) loop
      if (v_c ->> t) is distinct from (v_exp ->> t) then
        v_fail := v_fail || format('phase %s %s %s %s: got %s want %s', v_case.phase, v_case.org, v_case.email, t, v_c ->> t, v_exp ->> t);
      end if;
    end loop;
    k := v_case.phase || ':' || v_case.org || ':' || split_part(v_case.email, '@', 1);
    v_res := v_res || jsonb_build_object(k, v_c);
  end loop;

  raise exception 'TABRLS_RESULT %', jsonb_build_object('fail', v_fail, 'org_totals', v_tot, 'category', v_cat, 'cases', v_res)::text;
end $$;
