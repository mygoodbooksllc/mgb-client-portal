-- qbo_invoices: customer id + email for per-customer payment reminders
-- (2026-09-30).
--
-- Status: Applied to production 2026-09-30
-- Safe to re-run. Depends on qbo-data.sql. Deploy qbo-sync v10 (or later)
-- after this file: v10 writes these two columns. Older versions still work
-- against the new columns (jsonb_populate_recordset leaves them NULL).
--
-- Why: the Live Report's Collections Queue (components/daily-close/
-- DailyClose.tsx) drafted ONE reminder email with a blank To: listing every
-- overdue customer's invoices, so sending it leaked other customers'
-- balances. Reminders are now drafted per customer, addressed to that
-- customer. qbo-sync reads the customer id from each open invoice's
-- CustomerRef and the address from QuickBooks Customer.PrimaryEmailAddr
-- (one Customer query per full read, only for customers with an open
-- invoice), falling back to the invoice's own BillEmail. Read-only against
-- QuickBooks; nothing is written back.
--
-- Stored on qbo_invoices (denormalized per invoice) rather than a new
-- qbo_customers table: only customers with an open invoice matter here, and
-- the existing staff (can_access_client) / client (own org via client_users)
-- read policies on qbo_invoices then cover the email with no new RLS, no new
-- qbo_replace_rows() allow-list entry and no new table for index.html to load.
-- New columns go at the end so qbo_replace_rows()'s
-- insert ... select * from jsonb_populate_recordset(...) lines up.

alter table public.qbo_invoices add column if not exists customer_id text;
alter table public.qbo_invoices add column if not exists customer_email text;

comment on column public.qbo_invoices.customer_id is
  'QuickBooks Customer Id from the invoice CustomerRef (qbo-sync v10+).';
comment on column public.qbo_invoices.customer_email is
  'Customer.PrimaryEmailAddr, else the invoice BillEmail; NULL when QuickBooks has none (qbo-sync v10+).';
