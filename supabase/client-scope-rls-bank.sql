-- Bank and credit card accounts blocked for category-limited client users
-- (2026-10-06).
--
-- Status: Applied to production 2026-10-06 (migration client_scope_rls_bank).
-- Safe to re-run. Builds on client-scope-rls.sql (migration client_scope_rls).
--
-- client_scope_rls let a category-scoped client user (access = 'scoped',
-- categories not null, not on Basic) read every Bank and Credit Card row in
-- qbo_accounts for their organization, names and current balances included,
-- so the scoped dashboard could hang their visible transactions off those
-- accounts. The app never shows them bank balances (the Bank tab is in
-- ORG_WIDE_TABS), so the database now blocks those rows too:
--
--   qbo_accounts (category-scoped) ... only accounts whose name is one of
--                                      their categories or funds. A Bank /
--                                      Credit Card account is visible only if
--                                      it is literally one of those names.
--
-- Unchanged: full-access, Basic-plan and unscoped (tabs-only, categories
-- null) client users still read every row via my_unscoped_client_ids();
-- staff still read via "staff read qbo_accounts".
--
-- App effect: mapQboToClient.js builds client.bankAccounts only from Bank /
-- Credit Card rows in qbo_accounts and drops transactions whose account_name
-- has no such row. For a category-scoped user that means bankAccounts is
-- empty, so the scoped dashboard's "recent activity" list shows its empty
-- state instead of their transactions. Nothing crashes; the Bank tab,
-- Reconciliation, Cash Flow Pro and the Live Report are already hidden from
-- them.
--
-- Checked and already staff-only (no client-tier policy): qbo_account_status,
-- qbo_period_balances, close_checks, month_close, client_close_items,
-- month_close_settings (stale_bank_days). my_client_scope is security_invoker
-- and only returns the user's own client_users row. client_milestone_stats()
-- is SECURITY INVOKER and only reads qbo_accounts.account_type (no balances).
--
-- Not closed here: qbo_transactions.account_name on a scoped user's visible
-- rows is the bank / card register name (no balance). RLS can't hide a
-- single column; the app doesn't display it on the scoped dashboard.

begin;

drop policy if exists "client reads own qbo_accounts" on public.qbo_accounts;
create policy "client reads own qbo_accounts" on public.qbo_accounts
  for select
  using (client_id = any ((select public.my_unscoped_client_ids(false))::text[])
         or (client_id || chr(31) || name) = any ((select public.my_category_keys())::text[])
         or (client_id || chr(31) || name) = any ((select public.my_fund_keys())::text[]));

commit;
