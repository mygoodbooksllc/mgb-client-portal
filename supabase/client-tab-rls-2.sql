-- Client tab RLS, part 2: review follow-ups on client-tab-rls.sql (1f0ff4c).
-- Applied to production 2026-10-30 (migration client_tab_rls_2).
-- Additive: policy names and roles are kept (ALTER POLICY), no data changes.
-- Tests: supabase/client-tab-rls-tests.sql (rolled back).
--
-- S1  Staff read policies on the seven qbo_* tables called
--     can_access_client(client_id) bare, so it ran once per row for every
--     session, client logins included (42 ms for 105 transactions). They now
--     check (select is_active_staff()) first, as client_fund_accounts already
--     does. Same result: can_access_client is false unless the caller is
--     active staff (its admin branch is a subset of is_active_staff), so the
--     AND changes nothing but the cost.
--
-- S2  can_use_client_tools (the Pro budget and board-packet tables) only
--     required an active full-access membership. The client branch now also
--     requires, like the page that uses each table (app.jsx showsBudgetingTool
--     / showsReportBuilder: access.premiumForUser):
--       * the org on Pro (clients.plan = 'premium') and the login not
--         premium_throttled;
--       * the org in my_tab_client_ids for the table's tab, so a tab hidden
--         for the org (clients.hidden_tabs) closes its tables too:
--           budget:  client_budget_drafts, client_budget_draft_history,
--                    client_budget_comments (components/pro/ProBudget.jsx)
--           budget or reports: client_variance_notes (ProBudget and the
--                    Budget vs Actual commentary in components/pro/ProReports.jsx)
--           reports: client_report_summaries, client_report_templates,
--                    client_report_shares, client_branding,
--                    client_functional_map (ProReports.jsx)
--     The membership match is now exact on the JWT email (as is_client_member
--     and my_client_access already are). The old lower() match let a
--     case-variant duplicate row with access 'full' open the tools for a
--     scoped login of the same org.
--     The one-argument can_use_client_tools(text) stays (save/delete variance
--     note and delete budget comment RPCs call it) and now means "budget or
--     reports". Staff branch unchanged.
--
-- S4  my_hidden_fund_account_keys() returned client_id || chr(31) || name of
--     the other funds a funds-only login must not see, and authenticated could
--     call it through /rpc, so it leaked exactly those names. The qbo_accounts
--     policy now uses my_hidden_fund_account_ids(), which returns
--     client_id || chr(31) || qbo_id (QuickBooks' opaque account id) for the
--     same rows, and authenticated can no longer execute the old function.
--     Not fixed here (needs a UI change): the client_fund_accounts row a
--     funds-only login reads still lists every staff-picked fund by name
--     (accounts jsonb); mgbBuildQboFunds needs that list to know what a fund
--     is. See the report for the change needed.
--
-- S5  search_path = public, pg_temp on every definer helper from
--     client-tab-rls.sql and the new ones here.

-- ---------------------------------------------------------------- S5
alter function public.my_client_access() set search_path = public, pg_temp;
alter function public.my_tab_client_ids(text) set search_path = public, pg_temp;
alter function public.my_qbo_read_client_ids(text) set search_path = public, pg_temp;
alter function public.my_hidden_fund_account_keys() set search_path = public, pg_temp;

-- ---------------------------------------------------------------- S1
alter policy "staff read qbo_accounts" on public.qbo_accounts
  using ((select public.is_active_staff()) and public.can_access_client(client_id));
alter policy "staff read qbo_transactions" on public.qbo_transactions
  using ((select public.is_active_staff()) and public.can_access_client(client_id));
alter policy "staff read qbo_monthly_pl" on public.qbo_monthly_pl
  using ((select public.is_active_staff()) and public.can_access_client(client_id));
alter policy "staff read qbo_pl_lines" on public.qbo_pl_lines
  using ((select public.is_active_staff()) and public.can_access_client(client_id));
alter policy "staff read qbo_budget_lines" on public.qbo_budget_lines
  using ((select public.is_active_staff()) and public.can_access_client(client_id));
alter policy "staff read qbo_invoices" on public.qbo_invoices
  using ((select public.is_active_staff()) and public.can_access_client(client_id));
alter policy "staff read qbo_bills" on public.qbo_bills
  using ((select public.is_active_staff()) and public.can_access_client(client_id));

-- ---------------------------------------------------------------- S2
-- p_tabs: the client tab keys whose page uses the table (any one is enough).
create or replace function public.can_use_client_tools(p_client_id text, p_tabs text[])
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select (public.is_active_staff() and public.can_access_client(p_client_id))
      or (public.is_client_member(p_client_id)
          and exists (
            select 1
              from public.client_users cu
              join public.clients c on c.id = cu.client_id
             where cu.email = (auth.jwt() ->> 'email')
               and cu.client_id = p_client_id
               and cu.active
               and cu.access = 'full'
               -- premiumForUser: Pro org, not throttled for this person
               and c.plan = 'premium'
               and not coalesce(cu.premium_throttled, false))
          and exists (
            select 1
              from public.my_client_access() a
             where a.client_id = p_client_id
               and a.tabs && p_tabs));
$$;

create or replace function public.can_use_client_tools(p_client_id text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.can_use_client_tools(p_client_id, array['budget', 'reports']::text[]);
$$;

revoke all on function public.can_use_client_tools(text, text[]) from public, anon;
grant execute on function public.can_use_client_tools(text, text[]) to authenticated, service_role;
revoke all on function public.can_use_client_tools(text) from public, anon;
grant execute on function public.can_use_client_tools(text) to authenticated, service_role;

alter policy "client tools budget drafts" on public.client_budget_drafts
  using (public.can_use_client_tools(client_id, array['budget']::text[]))
  with check (public.can_use_client_tools(client_id, array['budget']::text[]));

alter policy "client tools budget history read" on public.client_budget_draft_history
  using (public.can_use_client_tools(client_id, array['budget']::text[]));
alter policy "client tools budget history write" on public.client_budget_draft_history
  with check (public.can_use_client_tools(client_id, array['budget']::text[]));

alter policy "client tools budget comments add" on public.client_budget_comments
  with check (public.can_use_client_tools(client_id, array['budget']::text[]));
alter policy "client tools budget comments read" on public.client_budget_comments
  using (public.can_use_client_tools(client_id, array['budget']::text[])
         and (deleted_at is null or public.is_active_staff_admin()));

alter policy "client tools variance notes add" on public.client_variance_notes
  with check (public.can_use_client_tools(client_id, array['budget', 'reports']::text[]));
alter policy "client tools variance notes change" on public.client_variance_notes
  using (public.can_use_client_tools(client_id, array['budget', 'reports']::text[]))
  with check (public.can_use_client_tools(client_id, array['budget', 'reports']::text[]));
alter policy "client tools variance notes read" on public.client_variance_notes
  using (public.can_use_client_tools(client_id, array['budget', 'reports']::text[])
         and (deleted_at is null or public.is_active_staff_admin()));

alter policy "client tools report summaries" on public.client_report_summaries
  using (public.can_use_client_tools(client_id, array['reports']::text[]))
  with check (public.can_use_client_tools(client_id, array['reports']::text[]));
alter policy "client tools report templates" on public.client_report_templates
  using (public.can_use_client_tools(client_id, array['reports']::text[]))
  with check (public.can_use_client_tools(client_id, array['reports']::text[]));
alter policy "client tools report shares" on public.client_report_shares
  using (public.can_use_client_tools(client_id, array['reports']::text[]))
  with check (public.can_use_client_tools(client_id, array['reports']::text[])
              and expires_at <= now() + interval '90 days');
alter policy "client tools branding" on public.client_branding
  using (public.can_use_client_tools(client_id, array['reports']::text[]))
  with check (public.can_use_client_tools(client_id, array['reports']::text[]));
alter policy "client tools functional map" on public.client_functional_map
  using (public.can_use_client_tools(client_id, array['reports']::text[]))
  with check (public.can_use_client_tools(client_id, array['reports']::text[]));

-- ---------------------------------------------------------------- S4
-- Same rows as my_hidden_fund_account_keys(), keyed by QuickBooks account id
-- so calling it through /rpc names nothing.
create or replace function public.my_hidden_fund_account_ids()
returns text[]
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(qa.client_id || chr(31) || qa.qbo_id), '{}'::text[])
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

revoke all on function public.my_hidden_fund_account_ids() from public, anon;
grant execute on function public.my_hidden_fund_account_ids() to authenticated, service_role;

alter policy "client reads own qbo_accounts" on public.qbo_accounts
  using (
    ((client_id = any ((select public.my_qbo_read_client_ids('qbo_accounts'))::text[]))
      and (((client_id || chr(31)) || qbo_id) = any ((select public.my_hidden_fund_account_ids())::text[])) is not true)
    or (((client_id || chr(31)) || name) = any ((select public.my_category_keys())::text[]))
    or (((client_id || chr(31)) || name) = any ((select public.my_fund_keys())::text[]))
  );

-- No policy uses the name-keyed version any more; keep it for service_role only.
revoke all on function public.my_hidden_fund_account_keys() from public, anon, authenticated;
grant execute on function public.my_hidden_fund_account_keys() to service_role;
