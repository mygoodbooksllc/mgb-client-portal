-- QuickBooks *data* tables. Companion to qbo-connections.sql (connection
-- status), qbo-tokens.sql (encrypted OAuth tokens) and the qbo-sync Edge
-- Function (supabase/functions/qbo-sync/index.ts), which is the only writer.
--
-- APPLY ORDER: after qbo-connections.sql and after
-- audit-hardening-client-scoping.sql (this file's staff policies call
-- public.can_access_client(text), defined there).
--
-- Shape notes
-- -----------
-- Everything is keyed by `client_id text` — the same join key as every other
-- per-client table in this project (clients.id / CLIENTS[].id), NOT Intuit's
-- realmId. One MyGoodBooks client org maps to exactly one QuickBooks company
-- (qbo_connections.realm_id), so the realm never needs to be part of a key.
--
-- `qbo_id` is Intuit's own entity Id for the row, kept so a re-sync can be
-- idempotent and so a future drill-through can deep-link into QuickBooks.
-- The sync currently does delete-then-insert per client per table rather than
-- an upsert: QuickBooks is the system of record, a deleted invoice over there
-- must disappear over here, and reconciling deletions by diffing ids is more
-- moving parts than re-materializing ~hundreds of rows.
--
-- Money is `numeric`, never float — these are ledger amounts that get summed
-- and compared against QuickBooks' own totals.
--
-- RLS: two-tier, exactly the pattern in audit-hardening-client-scoping.sql.
--   * staff  -> public.can_access_client(client_id): admins see everything,
--               a bookkeeper sees only their assigned clients.
--   * client -> a client_users row matching the signed-in JWT's email, that
--               client_id, and active = true.
-- SELECT only, for both. There are deliberately NO write policies on any of
-- these tables: the only legitimate writer is the qbo-sync Edge Function,
-- which uses the service_role key and bypasses RLS entirely. A browser
-- session — staff or client — must never be able to fabricate or edit a
-- number that the UI presents as coming from QuickBooks.

-- ---------------------------------------------------------------------------
-- Chart of accounts (Account entity). Drives the Bank page's account cards.
-- ---------------------------------------------------------------------------
create table if not exists qbo_accounts (
  client_id text not null,
  qbo_id text not null,
  name text,
  account_type text,          -- Intuit AccountType, e.g. "Bank", "Credit Card"
  account_sub_type text,      -- e.g. "Checking", "Savings", "MoneyMarket"
  classification text,        -- Asset | Liability | Equity | Revenue | Expense
  current_balance numeric,
  currency text,
  active boolean,
  updated_at timestamptz not null default now(),
  primary key (client_id, qbo_id)
);

-- ---------------------------------------------------------------------------
-- Profit & Loss summarized by month. One row per client per month; the
-- trailing 12 months are what the dashboard's income/expense chart reads.
-- `month` is always the FIRST of the month (a date, not a timestamptz — a
-- P&L period has no time zone).
-- ---------------------------------------------------------------------------
create table if not exists qbo_monthly_pl (
  client_id text not null,
  month date not null,
  revenue numeric,
  expenses numeric,
  net numeric,
  updated_at timestamptz not null default now(),
  primary key (client_id, month)
);

-- ---------------------------------------------------------------------------
-- The same P&L, one row per account per month — the detail behind the totals
-- above, and the source of budget "actual" figures.
-- ---------------------------------------------------------------------------
create table if not exists qbo_pl_lines (
  client_id text not null,
  month date not null,
  account_name text not null,
  account_type text,          -- 'Income' | 'Expense' (which P&L section)
  amount numeric,
  primary key (client_id, month, account_name)
);

-- ---------------------------------------------------------------------------
-- Budget vs. actual. `budgeted` comes from QuickBooks' Budget entity
-- (BudgetDetail rows); `actual` is joined in by the sync from qbo_pl_lines
-- for the same month + account, because Intuit's Budget entity carries no
-- actuals of its own.
-- ---------------------------------------------------------------------------
create table if not exists qbo_budget_lines (
  client_id text not null,
  fiscal_year int,
  month date not null,
  account_name text not null,
  budgeted numeric,
  actual numeric,
  primary key (client_id, month, account_name)
);

-- ---------------------------------------------------------------------------
-- Open A/R. Only invoices with a non-zero balance are synced — a paid
-- invoice is history, and the receivables page is a "who owes us" view.
-- ---------------------------------------------------------------------------
create table if not exists qbo_invoices (
  client_id text not null,
  qbo_id text not null,
  customer_name text,
  txn_date date,
  due_date date,
  total numeric,
  balance numeric,
  status text,                -- 'open' | 'overdue', computed at sync time
  updated_at timestamptz not null default now(),
  primary key (client_id, qbo_id)
);

-- ---------------------------------------------------------------------------
-- Open A/P. Same rule as invoices: balance > 0 only.
-- ---------------------------------------------------------------------------
create table if not exists qbo_bills (
  client_id text not null,
  qbo_id text not null,
  vendor_name text,
  txn_date date,
  due_date date,
  total numeric,
  balance numeric,
  status text,
  updated_at timestamptz not null default now(),
  primary key (client_id, qbo_id)
);

-- ---------------------------------------------------------------------------
-- Recent register activity, from the TransactionList report (last 90 days).
-- txn_type is part of the key because Intuit's entity Ids are only unique
-- WITHIN a type — Invoice 42 and Payment 42 are different transactions.
-- ---------------------------------------------------------------------------
create table if not exists qbo_transactions (
  client_id text not null,
  qbo_id text not null,
  txn_type text not null,
  txn_date date,
  account_name text,
  name text,                  -- customer/vendor/payee, Intuit's "Name" column
  memo text,
  amount numeric,
  updated_at timestamptz not null default now(),
  primary key (client_id, txn_type, qbo_id)
);

-- ---------------------------------------------------------------------------
-- Sync audit trail. One row per client per qbo-sync attempt, success or
-- failure, so "the numbers look stale" is answerable without reading Edge
-- Function logs (which deliberately contain no QuickBooks data at all).
-- `detail` holds a short message — never an Intuit response body.
-- ---------------------------------------------------------------------------
create table if not exists qbo_sync_runs (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null check (status in ('ok', 'error')),
  detail text,
  counts jsonb
);

create index if not exists qbo_sync_runs_client_started_idx
  on qbo_sync_runs (client_id, started_at desc);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table qbo_accounts       enable row level security;
alter table qbo_monthly_pl     enable row level security;
alter table qbo_pl_lines       enable row level security;
alter table qbo_budget_lines   enable row level security;
alter table qbo_invoices       enable row level security;
alter table qbo_bills          enable row level security;
alter table qbo_transactions   enable row level security;
alter table qbo_sync_runs      enable row level security;

-- qbo_accounts
drop policy if exists "staff read qbo accounts" on qbo_accounts;
create policy "staff read qbo accounts" on qbo_accounts
  for select using (public.can_access_client(client_id));
drop policy if exists "client reads own qbo accounts" on qbo_accounts;
create policy "client reads own qbo accounts" on qbo_accounts
  for select using (
    exists (
      select 1 from client_users cu
      where cu.email = auth.jwt() ->> 'email'
        and cu.client_id = qbo_accounts.client_id
        and cu.active
    )
  );

-- qbo_monthly_pl
drop policy if exists "staff read qbo monthly pl" on qbo_monthly_pl;
create policy "staff read qbo monthly pl" on qbo_monthly_pl
  for select using (public.can_access_client(client_id));
drop policy if exists "client reads own qbo monthly pl" on qbo_monthly_pl;
create policy "client reads own qbo monthly pl" on qbo_monthly_pl
  for select using (
    exists (
      select 1 from client_users cu
      where cu.email = auth.jwt() ->> 'email'
        and cu.client_id = qbo_monthly_pl.client_id
        and cu.active
    )
  );

-- qbo_pl_lines
drop policy if exists "staff read qbo pl lines" on qbo_pl_lines;
create policy "staff read qbo pl lines" on qbo_pl_lines
  for select using (public.can_access_client(client_id));
drop policy if exists "client reads own qbo pl lines" on qbo_pl_lines;
create policy "client reads own qbo pl lines" on qbo_pl_lines
  for select using (
    exists (
      select 1 from client_users cu
      where cu.email = auth.jwt() ->> 'email'
        and cu.client_id = qbo_pl_lines.client_id
        and cu.active
    )
  );

-- qbo_budget_lines
drop policy if exists "staff read qbo budget lines" on qbo_budget_lines;
create policy "staff read qbo budget lines" on qbo_budget_lines
  for select using (public.can_access_client(client_id));
drop policy if exists "client reads own qbo budget lines" on qbo_budget_lines;
create policy "client reads own qbo budget lines" on qbo_budget_lines
  for select using (
    exists (
      select 1 from client_users cu
      where cu.email = auth.jwt() ->> 'email'
        and cu.client_id = qbo_budget_lines.client_id
        and cu.active
    )
  );

-- qbo_invoices
drop policy if exists "staff read qbo invoices" on qbo_invoices;
create policy "staff read qbo invoices" on qbo_invoices
  for select using (public.can_access_client(client_id));
drop policy if exists "client reads own qbo invoices" on qbo_invoices;
create policy "client reads own qbo invoices" on qbo_invoices
  for select using (
    exists (
      select 1 from client_users cu
      where cu.email = auth.jwt() ->> 'email'
        and cu.client_id = qbo_invoices.client_id
        and cu.active
    )
  );

-- qbo_bills
drop policy if exists "staff read qbo bills" on qbo_bills;
create policy "staff read qbo bills" on qbo_bills
  for select using (public.can_access_client(client_id));
drop policy if exists "client reads own qbo bills" on qbo_bills;
create policy "client reads own qbo bills" on qbo_bills
  for select using (
    exists (
      select 1 from client_users cu
      where cu.email = auth.jwt() ->> 'email'
        and cu.client_id = qbo_bills.client_id
        and cu.active
    )
  );

-- qbo_transactions
drop policy if exists "staff read qbo transactions" on qbo_transactions;
create policy "staff read qbo transactions" on qbo_transactions
  for select using (public.can_access_client(client_id));
drop policy if exists "client reads own qbo transactions" on qbo_transactions;
create policy "client reads own qbo transactions" on qbo_transactions
  for select using (
    exists (
      select 1 from client_users cu
      where cu.email = auth.jwt() ->> 'email'
        and cu.client_id = qbo_transactions.client_id
        and cu.active
    )
  );

-- qbo_sync_runs. Clients can read their own too: "last synced 3 hours ago"
-- is the client-facing promise the Live pill makes, and an honest failure
-- state ("we couldn't reach QuickBooks") is better than a silently stale
-- number. `detail` is written as a short human message for exactly this
-- reason — never an Intuit payload.
drop policy if exists "staff read qbo sync runs" on qbo_sync_runs;
create policy "staff read qbo sync runs" on qbo_sync_runs
  for select using (public.can_access_client(client_id));
drop policy if exists "client reads own qbo sync runs" on qbo_sync_runs;
create policy "client reads own qbo sync runs" on qbo_sync_runs
  for select using (
    exists (
      select 1 from client_users cu
      where cu.email = auth.jwt() ->> 'email'
        and cu.client_id = qbo_sync_runs.client_id
        and cu.active
    )
  );

-- Verification after applying:
--   select tablename, policyname, cmd from pg_policies
--   where tablename like 'qbo_%' order by tablename, policyname;
