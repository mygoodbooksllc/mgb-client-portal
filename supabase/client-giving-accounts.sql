-- client_giving_accounts: which QuickBooks income accounts count as giving
-- (2026-10-06).
--
-- Status: Applied to production 2026-10-06
-- Safe to re-run.
--
-- Why: the Giving page now reads tithes and offerings from the synced
-- QuickBooks P&L (qbo_pl_lines) and transactions (qbo_transactions). By
-- default the portal picks Income accounts whose names look like giving
-- (tithe, offering, contribution, donation, giving, pledge, gift). Staff can
-- override that per client in Client details -> QuickBooks by ticking the
-- accounts that count. One row per client; no row = automatic detection.
--
-- Read-only with respect to QuickBooks: this is a portal setting only and
-- nothing here is ever written back to QuickBooks.
--
-- RLS: staff read/write through can_access_client (same as the qbo_* staff
-- policies); a signed-in client user reads their own client's row only (same
-- client_users pattern as the qbo_* client policies) so their Giving page
-- uses the same accounts staff picked. No anon access.

begin;

create table if not exists public.client_giving_accounts (
  client_id text primary key references public.clients(id) on delete cascade,
  account_names text[] not null default '{}',
  updated_at timestamptz not null default now(),
  updated_by text default (auth.jwt() ->> 'email')
);

alter table public.client_giving_accounts enable row level security;

drop policy if exists "staff read client_giving_accounts" on public.client_giving_accounts;
create policy "staff read client_giving_accounts" on public.client_giving_accounts
  for select to authenticated
  using ((select is_active_staff()) and can_access_client(client_id));

drop policy if exists "staff insert client_giving_accounts" on public.client_giving_accounts;
create policy "staff insert client_giving_accounts" on public.client_giving_accounts
  for insert to authenticated
  with check ((select is_active_staff()) and can_access_client(client_id));

drop policy if exists "staff update client_giving_accounts" on public.client_giving_accounts;
create policy "staff update client_giving_accounts" on public.client_giving_accounts
  for update to authenticated
  using ((select is_active_staff()) and can_access_client(client_id))
  with check ((select is_active_staff()) and can_access_client(client_id));

drop policy if exists "staff delete client_giving_accounts" on public.client_giving_accounts;
create policy "staff delete client_giving_accounts" on public.client_giving_accounts
  for delete to authenticated
  using ((select is_active_staff()) and can_access_client(client_id));

drop policy if exists "client reads own client_giving_accounts" on public.client_giving_accounts;
create policy "client reads own client_giving_accounts" on public.client_giving_accounts
  for select to authenticated
  using (exists (
    select 1 from client_users cu
    where cu.email = (auth.jwt() ->> 'email')
      and cu.client_id = client_giving_accounts.client_id
      and cu.active
  ));

revoke all on public.client_giving_accounts from anon;
grant select, insert, update, delete on public.client_giving_accounts to authenticated;

commit;
