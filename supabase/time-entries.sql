-- Time tracking: hours (stored as minutes) logged per bookkeeper per client.
-- Applied live via Supabase MCP apply_migration (name: time_entries).
--
-- No billing system exists in this app yet (QuickBooks Connect only
-- establishes an OAuth connection, it doesn't sync invoicing data), so this
-- is purely a logging/utilization data layer for now. UI (a log-time form,
-- a per-client or per-staff summary, etc.) is a separate, subsequent task
-- for another agent/session to build on top of this table.
--
-- Design decisions:
--
-- * minutes (integer), not an interval/duration type: simplest for a React
--   frontend to do basic math with (sum, divide by 60 for hours, etc.)
--   without dealing with Postgres interval parsing/formatting.
--
-- * client_id is plain `text not null` with NO foreign key, matching the
--   pattern already used by client_documents/client_notes/access-requests:
--   there is no real `clients` table in Postgres, CLIENTS lives in the
--   frontend's data.js, so client_id here is just expected to match a
--   CLIENTS[].id value by convention, not by DB constraint.
--
-- * entry_date is the day the work was actually done (defaults to today,
--   but editable), separate from created_at which is when the row was
--   logged -- lets someone log yesterday's time without it being misdated.
--
-- * billable boolean (default true): nothing reads/filters on this yet, but
--   it's a near-free column to add now so a future billing/reporting
--   feature can distinguish billable vs. non-billable time without a
--   migration later.
--
-- * RLS: private per-bookkeeper like staff_reminders (staff can only
--   select/insert/update/delete their OWN rows, matched on
--   staff_email = auth.jwt()->>'email') -- nobody should be able to log
--   time as someone else or edit another person's logged hours.
--
--   BUT unlike staff_reminders, admins also get a read-all policy: an admin
--   plausibly needs firm-wide utilization visibility (who's logging time on
--   which clients) even though this app doesn't have a dedicated reporting
--   UI yet. This mirrors the read-scoped half of the staff_client_access
--   pattern, not the staff-admin "can manage everything" pattern.
--
--   Write access (insert/update/delete) stays self-only even for admins --
--   an admin editing or deleting someone else's logged time is a can of
--   worms nobody asked for, so it's deliberately not supported here.
--
-- No aggregate view/function: with a small per-client/per-staff row count,
-- summing minutes client-side in React (the same useMemo-based rollup
-- pattern already used elsewhere in app.jsx, e.g. monthly/budget totals) is
-- simpler and more consistent with the rest of the codebase than
-- maintaining a DB view. Revisit if a firm-wide report over ALL staff's
-- entries (which an admin can now read) turns out to need real aggregation.
--
-- Run this once in the Supabase SQL editor. Safe to re-run.

create table if not exists time_entries (
  id uuid primary key default gen_random_uuid(),
  staff_email text not null,
  client_id text not null,
  minutes integer not null check (minutes > 0),
  description text,
  entry_date date not null default current_date,
  created_at timestamptz not null default now(),
  billable boolean not null default true
);

alter table time_entries enable row level security;

-- Self-only read/write, same shape as staff_reminders.
drop policy if exists "staff manage own time entries" on time_entries;
create policy "staff manage own time entries"
  on time_entries for all
  using (staff_email = auth.jwt() ->> 'email')
  with check (staff_email = auth.jwt() ->> 'email');

-- Admins can additionally READ every staffer's entries (firm-wide
-- utilization visibility). Uses the existing is_active_staff_admin()
-- SECURITY DEFINER function from supabase/staff-admin-policies.sql --
-- must be applied first. No admin write-all policy: see comments above.
drop policy if exists "admins read all time entries" on time_entries;
create policy "admins read all time entries"
  on time_entries for select
  using (public.is_active_staff_admin());
