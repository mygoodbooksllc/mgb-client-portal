-- Category / fund limits enforced in the database for limited client users
-- (2026-10-06).
--
-- Status: Applied to production 2026-10-06 (migration client_scope_rls).
-- Safe to re-run, but then re-run client-scope-rls-bank.sql too: that later
-- migration (client_scope_rls_bank) replaced the qbo_accounts policy below
-- to drop the Bank / Credit Card exception.
--
-- Before this, a client user's access limits (client_users.access = 'scoped'
-- with categories[] / funds[]) were applied only in the browser
-- (resolveAccess / scopeClientData in app.jsx). The client-tier SELECT
-- policies let any active client user read every QuickBooks row for their
-- organization. Now the same limits are enforced by RLS, mirroring the app:
--
--   Unscoped (sees every row for the org, as before):
--     access = 'full', OR the client is on the Basic plan (per-person limits
--     aren't part of Basic), OR categories is null (a tabs-only limited user
--     is on the normal dashboard where org-wide figures are expected).
--   Category-scoped (access = 'scoped', categories not null, not Basic):
--     qbo_budget_lines, qbo_pl_lines .... account_name is one of their categories
--     qbo_transactions ................. split_account is one of their categories
--                                        ("-Split-" counts as the category
--                                        "Split (several accounts)", as in
--                                        mapQboToClient.js categoryFor)
--     qbo_accounts ..................... name is one of their categories or
--                                        funds, OR the account is a Bank /
--                                        Credit Card account (the scoped
--                                        dashboard hangs the visible
--                                        transactions off these accounts, so
--                                        their names and balances stay
--                                        readable)
--     qbo_monthly_pl, qbo_invoices,
--     qbo_bills ........................ none (org-wide figures; the app
--                                        already empties these)
--     client_giving_accounts ........... none (QuickBooks giving is one
--                                        org-wide total; also hidden from
--                                        anyone with a funds list)
--     client_fund_accounts ............. only when they have a non-empty funds
--                                        list (the row is just fund account
--                                        names + restricted flags; balances
--                                        stay limited by qbo_accounts)
--   An empty categories list ({}) is still scoped and sees no category rows,
--   same as the app.
--
-- Staff policies ("staff read ..." etc.) and the full-access path are
-- unchanged. Policy names and roles are kept.
--
-- Side effect: client_milestone_stats() is SECURITY INVOKER, so for a
-- category-scoped client user it now counts only their visible rows. The
-- Milestone page is already hidden from them; staff are unaffected.
--
-- Helpers are STABLE SECURITY DEFINER with no row arguments, called as
-- (select fn())::text[] in the policies (the cast keeps "= any" treating it
-- as one array, not a subquery) so Postgres evaluates them once per query
-- (initplan) rather than per row. They only ever return the signed-in
-- user's own client ids / keys.

begin;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
-- Clients where the signed-in user sees everything. p_funds_too: also require
-- no funds list (client_giving_accounts, which the app hides from anyone with
-- categories or funds set).
create or replace function public.my_unscoped_client_ids(p_funds_too boolean default false)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(cu.client_id), '{}')
    from client_users cu
    join clients c on c.id = cu.client_id
   where cu.email = (auth.jwt() ->> 'email')
     and cu.active
     and (cu.access <> 'scoped'
          or c.plan = 'basic'
          or (cu.categories is null and (not p_funds_too or cu.funds is null)));
$$;

-- client_id || chr(31) || category for each category a scoped user may see.
create or replace function public.my_category_keys()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(cu.client_id || chr(31) || cat), '{}')
    from client_users cu
    join clients c on c.id = cu.client_id
    cross join lateral unnest(cu.categories) as cat
   where cu.email = (auth.jwt() ->> 'email')
     and cu.active
     and cu.access = 'scoped'
     and coalesce(c.plan, '') <> 'basic'
     and cu.categories is not null;
$$;

-- client_id || chr(31) || fund account name for a scoped user's funds list.
create or replace function public.my_fund_keys()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(cu.client_id || chr(31) || f), '{}')
    from client_users cu
    join clients c on c.id = cu.client_id
    cross join lateral unnest(cu.funds) as f
   where cu.email = (auth.jwt() ->> 'email')
     and cu.active
     and cu.access = 'scoped'
     and coalesce(c.plan, '') <> 'basic'
     and cu.funds is not null;
$$;

revoke all on function public.my_unscoped_client_ids(boolean) from public, anon;
revoke all on function public.my_category_keys() from public, anon;
revoke all on function public.my_fund_keys() from public, anon;
grant execute on function public.my_unscoped_client_ids(boolean) to authenticated;
grant execute on function public.my_category_keys() to authenticated;
grant execute on function public.my_fund_keys() to authenticated;

-- ---------------------------------------------------------------------------
-- Client-tier SELECT policies
-- ---------------------------------------------------------------------------
drop policy if exists "client reads own qbo_budget_lines" on public.qbo_budget_lines;
create policy "client reads own qbo_budget_lines" on public.qbo_budget_lines
  for select
  using (client_id = any ((select public.my_unscoped_client_ids(false))::text[])
         or (client_id || chr(31) || account_name) = any ((select public.my_category_keys())::text[]));

drop policy if exists "client reads own qbo_pl_lines" on public.qbo_pl_lines;
create policy "client reads own qbo_pl_lines" on public.qbo_pl_lines
  for select
  using (client_id = any ((select public.my_unscoped_client_ids(false))::text[])
         or (client_id || chr(31) || account_name) = any ((select public.my_category_keys())::text[]));

drop policy if exists "client reads own qbo_transactions" on public.qbo_transactions;
create policy "client reads own qbo_transactions" on public.qbo_transactions
  for select
  using (client_id = any ((select public.my_unscoped_client_ids(false))::text[])
         or (client_id || chr(31) ||
             case when btrim(split_account) ~* '^-?split-?$' then 'Split (several accounts)'
                  else btrim(split_account) end) = any ((select public.my_category_keys())::text[]));

drop policy if exists "client reads own qbo_accounts" on public.qbo_accounts;
create policy "client reads own qbo_accounts" on public.qbo_accounts
  for select
  using (client_id = any ((select public.my_unscoped_client_ids(false))::text[])
         or (account_type in ('Bank', 'Credit Card')
             and client_id = any (array(select split_part(k, chr(31), 1)
                                          from unnest(public.my_category_keys()) k)))
         or (client_id || chr(31) || name) = any ((select public.my_category_keys())::text[])
         or (client_id || chr(31) || name) = any ((select public.my_fund_keys())::text[]));

drop policy if exists "client reads own qbo_monthly_pl" on public.qbo_monthly_pl;
create policy "client reads own qbo_monthly_pl" on public.qbo_monthly_pl
  for select
  using (client_id = any ((select public.my_unscoped_client_ids(false))::text[]));

drop policy if exists "client reads own qbo_invoices" on public.qbo_invoices;
create policy "client reads own qbo_invoices" on public.qbo_invoices
  for select
  using (client_id = any ((select public.my_unscoped_client_ids(false))::text[]));

drop policy if exists "client reads own qbo_bills" on public.qbo_bills;
create policy "client reads own qbo_bills" on public.qbo_bills
  for select
  using (client_id = any ((select public.my_unscoped_client_ids(false))::text[]));

drop policy if exists "client reads own client_giving_accounts" on public.client_giving_accounts;
create policy "client reads own client_giving_accounts" on public.client_giving_accounts
  for select to authenticated
  using (client_id = any ((select public.my_unscoped_client_ids(true))::text[]));

drop policy if exists "client reads own client_fund_accounts" on public.client_fund_accounts;
create policy "client reads own client_fund_accounts" on public.client_fund_accounts
  for select to authenticated
  using (client_id = any ((select public.my_unscoped_client_ids(false))::text[])
         or client_id = any (array(select split_part(k, chr(31), 1)
                                   from unnest(public.my_fund_keys()) k)));

commit;
