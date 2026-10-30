-- Client tab RLS: per-person tabs, the Basic tab list, org-hidden tabs and
-- funds-only scoping enforced on the server for the qbo_* client reads.
-- Portal blind-spot audit 2026-10-30, items 1.1 to 1.4.
-- Applied to production 2026-10-30 (migration client_tab_rls).
-- Follow-ups in client-tab-rls-2.sql (same day): search_path now
-- public, pg_temp on the helpers below (re-applied from this file); the
-- qbo_accounts client policy uses my_hidden_fund_account_ids() and
-- authenticated can no longer call my_hidden_fund_account_keys(). Run -2
-- after this file if this file is ever re-run.
--
-- Before this, every client SELECT policy on the qbo_* tables used
-- my_unscoped_client_ids(), which returns every org a login belongs to unless
-- it is category-scoped. So a tabs-only scoped login, a Basic-plan member, an
-- org with hidden tabs and a funds-only login could all read every qbo_* row
-- through PostgREST, whatever the UI showed them.
--
-- The rule now: a client login may read a table only if a page it can open
-- (resolveAccess in app.jsx) actually renders data from it. The tab set is
-- resolved exactly like resolveAccess:
--   * entitled = all client tab keys; Basic plan (clients.plan = 'basic')
--     keeps only BASIC_TAB_KEYS; payroll only with clients.payroll_add_on.
--   * orgAllowed = entitled minus clients.hidden_tabs ("dashboard" can never
--     be hidden: ALWAYS_VISIBLE_KEY).
--   * access <> 'scoped' (full) or Basic plan: every orgAllowed tab.
--   * scoped: dashboard, plus orgAllowed tabs in client_users.tabs (NULL tabs
--     = every orgAllowed tab), minus ORG_WIDE_TABS (bank, receivables,
--     reports, payroll) when categories is set.
--
-- Which page reads which table (traced through index.html loadQboData,
-- components/qbo/mapQboToClient.js and every client page):
--   Home on a non-Basic plan ALWAYS renders org-wide QuickBooks figures:
--     Pro, not throttled, not category-scoped: the Live Report
--       (dailyCloseFromClient) = accounts, transactions, monthly P&L, P&L
--       lines, budget lines, invoices, bills, fund accounts.
--     Otherwise DashboardPage = accounts, transactions (Recent activity),
--       monthly P&L, budget lines + P&L lines (budget rows and their types),
--       fund accounts. No invoices or bills.
--   Basic Home (BasicHome.jsx) renders no QuickBooks data.
--   Reports (every plan, incl. Basic): P&L, Balance Sheet and Budget vs
--     Actual PDFs = accounts, monthly P&L, P&L lines, budget lines, invoices,
--     bills, fund accounts. Never transactions.
--   Budget: budget lines, P&L lines, accounts, monthly P&L; the fallback
--     BudgetingToolPage also reads invoices and bills.
--   Bank: accounts, transactions.  Cash flow (receivables): invoices, bills.
--   Giving: donor gifts, donor gift pulls, giving-account settings (plus
--     accounts, P&L lines, transactions already covered above).
--   Messages, Documents, Payroll: no qbo_* data.
-- Category-scoped logins keep their existing per-category policy branches
-- unchanged (ScopedDashboardPage renders exactly those rows).
--
-- Funds-only scoping (access 'scoped', categories NULL, funds set): the UI
-- narrows the fund list (scopeClientData) on every page except the Pro Live
-- Report, which is built from the unscoped client and shows every fund. So
-- other funds' balance rows in qbo_accounts are hidden only when the login's
-- Home is NOT the Live Report (non-Pro plan, or premium_throttled). A "fund"
-- is exactly what mgbBuildQboFunds picks: the staff list in
-- client_fund_accounts, else active Equity/Asset accounts whose name matches
-- /\bfunds?\b|restricted/i and not /undeposited/i. Bank and credit card
-- accounts are never hidden (the Bank page and Home cash still show them).
-- Giving tables already excluded funds-only logins (my_unscoped_client_ids
-- (true)); that stays.
--
-- Staff read policies are untouched. Full-access logins resolve to every
-- tab, so nothing changes for them (and live data has 0 scoped logins and 0
-- active Basic members today).
--
-- org-hidden tabs: until now the "hide this tab for everyone" setting lived
-- only in the staff browser's localStorage (mygoodbooks_tab_config_v2), so a
-- client's own browser never saw it. clients.hidden_tabs is its server home;
-- it defaults to none hidden, so nothing changes until the UI writes to it
-- (deferred). Only admins can update clients (existing policy).
-- Done 2026-10-30 in client-tab-rls-3.sql (S3): the UI reads and writes
-- clients.hidden_tabs; the old browser setting is copied up once.

alter table public.clients
  add column if not exists hidden_tabs text[] not null default '{}'::text[];

alter table public.clients drop constraint if exists clients_hidden_tabs_known;
alter table public.clients
  add constraint clients_hidden_tabs_known
  check (hidden_tabs <@ array['dashboard','messages','budget','bank','receivables','giving','payroll','reports','documents']::text[]);

comment on column public.clients.hidden_tabs is
  'Client tab keys hidden for every login of this org (resolveAccess orgHiddenKeys). Enforced in qbo_* RLS via my_client_access(). dashboard is never hidden.';

-- One row per active membership of the caller, resolved like resolveAccess.
-- Internal helper: called only from the definer helpers below.
create or replace function public.my_client_access()
returns table (
  client_id text,
  tabs text[],
  is_basic boolean,
  live_home boolean,
  is_scoped boolean,
  cat_scoped boolean,
  fund_list text[],
  unscoped boolean,
  unscoped_no_funds boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with m as (
    select cu.client_id,
           -- resolveAccess: access || "full"; only 'scoped' narrows.
           (cu.access = 'scoped') is true as wants_scope,
           cu.tabs as user_tabs,
           cu.categories,
           cu.funds,
           coalesce(cu.premium_throttled, false) as throttled,
           c.plan,
           (c.plan = 'basic') is true as is_basic,
           coalesce(c.payroll_add_on, false) as payroll_add_on,
           coalesce(c.hidden_tabs, '{}'::text[]) as hidden
      from client_users cu
      join clients c on c.id = cu.client_id
     where cu.email = (auth.jwt() ->> 'email')
       and cu.active
  ),
  o as (
    select m.*,
           array(
             select t.k
               from unnest(array['dashboard','messages','budget','bank','receivables','giving','payroll','reports','documents']::text[])
                    with ordinality as t(k, n)
              where (not m.is_basic or t.k = any(array['dashboard','messages','reports','documents','payroll']::text[]))
                and (t.k <> 'payroll' or m.payroll_add_on)
                and (t.k = 'dashboard' or not (t.k = any(m.hidden)))
              order by t.n
           ) as org_allowed,
           -- Per-person access isn't part of Basic.
           (m.wants_scope and not m.is_basic) as scoped
      from m
  )
  select o.client_id,
         case
           when not o.scoped then o.org_allowed
           else array(
             select t.k
               from unnest(o.org_allowed) with ordinality as t(k, n)
              where t.k = 'dashboard'
                 or (t.k = any(coalesce(o.user_tabs, o.org_allowed))
                     and not (o.categories is not null
                              and t.k = any(array['bank','receivables','reports','payroll']::text[])))
              order by t.n
           )
         end as tabs,
         o.is_basic,
         -- showsLiveReport: Pro for this user and not category-scoped.
         (o.plan = 'premium' and not o.throttled
          and not (o.scoped and o.categories is not null)) as live_home,
         o.scoped as is_scoped,
         (o.scoped and o.categories is not null) as cat_scoped,
         case when o.scoped then o.funds end as fund_list,
         -- Same membership set as my_unscoped_client_ids(false) / (true).
         (not o.scoped or o.categories is null) as unscoped,
         (not o.scoped or (o.categories is null and o.funds is null)) as unscoped_no_funds
    from o;
$$;

-- Org ids where the caller can open p_tab (resolveAccess access.tabs).
create or replace function public.my_tab_client_ids(p_tab text)
returns text[]
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(a.client_id), '{}'::text[])
    from public.my_client_access() a
   where p_tab = any(a.tabs);
$$;

-- Org ids whose rows of p_dataset the caller may read through the unscoped
-- (non-category) policy branch. The tab map is documented at the top.
create or replace function public.my_qbo_read_client_ids(p_dataset text)
returns text[]
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(a.client_id), '{}'::text[])
    from public.my_client_access() a
   where case
     when p_dataset in ('qbo_accounts', 'qbo_monthly_pl', 'qbo_pl_lines', 'qbo_budget_lines', 'client_fund_accounts')
       -- non-Basic Home, or Reports / Budget / Bank / Cash flow / Giving
       then a.unscoped
            and (not a.is_basic
                 or a.tabs && array['reports','budget','bank','receivables','giving']::text[])
     when p_dataset = 'qbo_transactions'
       -- non-Basic Home (both versions), or Bank / Giving / Budget
       then a.unscoped
            and (not a.is_basic
                 or a.tabs && array['bank','giving','budget']::text[])
     when p_dataset in ('qbo_invoices', 'qbo_bills')
       -- the Pro Live Report Home, or Cash flow / Reports / Budget
       then a.unscoped
            and (a.live_home
                 or a.tabs && array['receivables','reports','budget']::text[])
     when p_dataset in ('qbo_donor_gifts', 'qbo_donor_gift_pulls', 'client_giving_accounts')
       -- Giving only; funds-scoped logins never get org-wide giving
       then a.unscoped_no_funds and 'giving' = any(a.tabs)
     else false
   end;
$$;

-- client_id || chr(31) || name of the fund accounts a funds-only login must
-- not see (other funds), mirroring mgbBuildQboFunds + scopeClientData.
create or replace function public.my_hidden_fund_account_keys()
returns text[]
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(qa.client_id || chr(31) || qa.name), '{}'::text[])
    from public.my_client_access() a
    join public.qbo_accounts qa on qa.client_id = a.client_id
    left join public.client_fund_accounts cfa
           on cfa.client_id = a.client_id
          and jsonb_typeof(cfa.accounts) = 'array'
   where a.is_scoped
     and not a.cat_scoped
     and a.fund_list is not null
     and not a.live_home
     and qa.name is not null
     and not (qa.name = any(a.fund_list))
     and not (qa.account_type in ('Bank', 'Credit Card') and qa.active is distinct from false)
     and case
       when cfa.client_id is not null then exists (
         select 1
           from jsonb_array_elements(cfa.accounts) p
          where jsonb_typeof(p) = 'object'
            and p ->> 'name' = qa.name)
       else qa.name <> ''
            and qa.active is distinct from false
            and case
                  when coalesce(qa.classification, '') <> '' then qa.classification in ('Equity', 'Asset')
                  else coalesce(qa.account_type, '') ~* '(equity|asset|bank)'
                end
            and qa.name ~* '\yfunds?\y|restricted'
            and qa.name !~* 'undeposited'
     end;
$$;

-- Grants: same shape as my_unscoped_client_ids (postgres, authenticated,
-- service_role; never anon or PUBLIC). my_client_access is internal only.
revoke all on function public.my_client_access() from public, anon, authenticated;
grant execute on function public.my_client_access() to service_role;
revoke all on function public.my_tab_client_ids(text) from public, anon;
grant execute on function public.my_tab_client_ids(text) to authenticated, service_role;
revoke all on function public.my_qbo_read_client_ids(text) from public, anon;
grant execute on function public.my_qbo_read_client_ids(text) to authenticated, service_role;
revoke all on function public.my_hidden_fund_account_keys() from public, anon;
grant execute on function public.my_hidden_fund_account_keys() to authenticated, service_role;

-- Client SELECT policies. ALTER POLICY keeps each policy's name and roles;
-- only the unscoped branch changes. Category and fund-key branches are as
-- before. Staff policies are not touched.
alter policy "client reads own qbo_accounts" on public.qbo_accounts
  using (
    ((client_id = any ((select public.my_qbo_read_client_ids('qbo_accounts'))::text[]))
      and (((client_id || chr(31)) || name) = any ((select public.my_hidden_fund_account_keys())::text[])) is not true)
    or (((client_id || chr(31)) || name) = any ((select public.my_category_keys())::text[]))
    or (((client_id || chr(31)) || name) = any ((select public.my_fund_keys())::text[]))
  );

alter policy "client reads own qbo_transactions" on public.qbo_transactions
  using (
    (client_id = any ((select public.my_qbo_read_client_ids('qbo_transactions'))::text[]))
    or (((client_id || chr(31)) ||
         case
           when btrim(split_account) ~* '^-?split-?$' then 'Split (several accounts)'::text
           else btrim(split_account)
         end) = any ((select public.my_category_keys())::text[]))
  );

alter policy "client reads own qbo_monthly_pl" on public.qbo_monthly_pl
  using (client_id = any ((select public.my_qbo_read_client_ids('qbo_monthly_pl'))::text[]));

alter policy "client reads own qbo_pl_lines" on public.qbo_pl_lines
  using (
    (client_id = any ((select public.my_qbo_read_client_ids('qbo_pl_lines'))::text[]))
    or (((client_id || chr(31)) || account_name) = any ((select public.my_category_keys())::text[]))
  );

alter policy "client reads own qbo_budget_lines" on public.qbo_budget_lines
  using (
    (client_id = any ((select public.my_qbo_read_client_ids('qbo_budget_lines'))::text[]))
    or (((client_id || chr(31)) || account_name) = any ((select public.my_category_keys())::text[]))
  );

alter policy "client reads own qbo_invoices" on public.qbo_invoices
  using (client_id = any ((select public.my_qbo_read_client_ids('qbo_invoices'))::text[]));

alter policy "client reads own qbo_bills" on public.qbo_bills
  using (client_id = any ((select public.my_qbo_read_client_ids('qbo_bills'))::text[]));

alter policy "client reads own qbo_donor_gifts" on public.qbo_donor_gifts
  using (client_id = any ((select public.my_qbo_read_client_ids('qbo_donor_gifts'))::text[]));

alter policy "client reads own qbo_donor_gift_pulls" on public.qbo_donor_gift_pulls
  using (client_id = any ((select public.my_qbo_read_client_ids('qbo_donor_gift_pulls'))::text[]));

alter policy "client reads own client_giving_accounts" on public.client_giving_accounts
  using (client_id = any ((select public.my_qbo_read_client_ids('client_giving_accounts'))::text[]));

alter policy "client reads own client_fund_accounts" on public.client_fund_accounts
  using (
    (client_id = any ((select public.my_qbo_read_client_ids('client_fund_accounts'))::text[]))
    or (client_id = any (array(select split_part(k.k, chr(31), 1) from unnest(public.my_fund_keys()) k(k))))
  );
