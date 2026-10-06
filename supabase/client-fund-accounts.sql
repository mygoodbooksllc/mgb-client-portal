-- client_fund_accounts: which QuickBooks balance-sheet accounts are funds,
-- and whether each is restricted (2026-10-06).
--
-- Status: Applied to production 2026-10-06
-- Safe to re-run.
--
-- Why: the Giving & Funds page (Fund Balances, Restricted / Unrestricted
-- Funds, Fund Activity) now reads fund balances from the synced QuickBooks
-- chart of accounts (qbo_accounts.current_balance). By default the portal
-- picks equity/asset accounts whose names contain "fund" or "restricted"
-- (never "Undeposited Funds"). Staff can override that per client in
-- Client details -> QuickBooks -> Fund accounts, ticking the accounts that
-- are funds and marking each restricted or unrestricted. One row per client;
-- no row = automatic detection.
--
-- accounts is a JSON array of { "name": text, "restricted": boolean }.
--
-- Read-only with respect to QuickBooks: this is a portal setting only and
-- nothing here is ever written back to QuickBooks.
--
-- RLS: same as client_giving_accounts. Staff read/write through
-- can_access_client; a signed-in client user reads their own client's row
-- only, so their Funds page uses the same accounts staff picked. No anon.

begin;

create table if not exists public.client_fund_accounts (
  client_id text primary key references public.clients(id) on delete cascade,
  accounts jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by text default (auth.jwt() ->> 'email'),
  constraint client_fund_accounts_accounts_is_array check (jsonb_typeof(accounts) = 'array')
);

alter table public.client_fund_accounts enable row level security;

drop policy if exists "staff read client_fund_accounts" on public.client_fund_accounts;
create policy "staff read client_fund_accounts" on public.client_fund_accounts
  for select to authenticated
  using ((select is_active_staff()) and can_access_client(client_id));

drop policy if exists "staff insert client_fund_accounts" on public.client_fund_accounts;
create policy "staff insert client_fund_accounts" on public.client_fund_accounts
  for insert to authenticated
  with check ((select is_active_staff()) and can_access_client(client_id));

drop policy if exists "staff update client_fund_accounts" on public.client_fund_accounts;
create policy "staff update client_fund_accounts" on public.client_fund_accounts
  for update to authenticated
  using ((select is_active_staff()) and can_access_client(client_id))
  with check ((select is_active_staff()) and can_access_client(client_id));

drop policy if exists "staff delete client_fund_accounts" on public.client_fund_accounts;
create policy "staff delete client_fund_accounts" on public.client_fund_accounts
  for delete to authenticated
  using ((select is_active_staff()) and can_access_client(client_id));

drop policy if exists "client reads own client_fund_accounts" on public.client_fund_accounts;
create policy "client reads own client_fund_accounts" on public.client_fund_accounts
  for select to authenticated
  using (exists (
    select 1 from client_users cu
    where cu.email = (auth.jwt() ->> 'email')
      and cu.client_id = client_fund_accounts.client_id
      and cu.active
  ));

revoke all on public.client_fund_accounts from anon;
grant select, insert, update, delete on public.client_fund_accounts to authenticated;

commit;
