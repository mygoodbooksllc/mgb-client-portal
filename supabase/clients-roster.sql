-- The client-org roster itself — id, name, org type, plan, payroll add-on
-- flag, and assigned bookkeeper — pulled out of data.js's hardcoded CLIENTS
-- array (Phase 3 of the roster/mock-data split; see HANDOFF7.md). Everything
-- else that used to live in that array (monthly numbers, budget, bank
-- accounts, funds, contributions, documents, threads, the mock `users`
-- "Preview As" roster, etc.) is explicitly OUT OF SCOPE here and stays put in
-- data.js as CLIENTS_MOCK_DATA, still mock, still keyed by the same `id`.
--
-- Not to be confused with client_users (supabase/client-users.sql) — that's
-- the real client-login roster (who can sign in as whom), admin-only to
-- read. This table is the org roster itself (which orgs exist at all) and
-- every staff member needs to read it (sidebar client picker, "Preview as",
-- client-name lookups throughout app.jsx) — see the broader select policy
-- below.
--
-- Builds on access-requests.sql (public.is_active_staff()) and
-- staff-admin-policies.sql (public.is_active_staff_admin()). Run those first
-- if you haven't.
--
-- Run this once in the Supabase SQL editor, or via the Supabase MCP's
-- apply_migration.

create table if not exists clients (
  id text primary key,
  name text not null,
  org_type text not null,
  plan text not null default 'standard' check (plan in ('standard', 'premium')),
  test_only boolean not null default false,
  payroll_add_on boolean not null default false,
  assigned_bookkeeper jsonb,
  created_at timestamptz not null default now()
);

alter table clients enable row level security;

-- Every staff member needs to read the roster (sidebar client picker,
-- "Preview as", client-name lookups all over the app) — broader than
-- client_users, which is admin-only even to read. Reuses is_active_staff(),
-- already defined in supabase/access-requests.sql.
drop policy if exists "staff can read clients" on clients;
create policy "staff can read clients"
  on clients for select
  using (public.is_active_staff());

-- Only an admin adds/edits an org — reuses is_active_staff_admin(), already
-- defined in supabase/staff-admin-policies.sql. No delete policy on purpose:
-- deleting a client org would orphan client_users/client_notes/every other
-- per-client table's client_id — out of scope for this pass. With RLS
-- enabled and no delete policy, a delete is denied at the database level
-- even if someone tried one directly.
drop policy if exists "admins can manage clients" on clients;
create policy "admins can manage clients"
  on clients for insert
  with check (public.is_active_staff_admin());
drop policy if exists "admins can update clients" on clients;
create policy "admins can update clients"
  on clients for update
  using (public.is_active_staff_admin())
  with check (public.is_active_staff_admin());

-- Seed with the 2 existing sample orgs' current roster values, transcribed
-- exactly from data.js as of this migration (grace-community's testOnly and
-- payrollAddOn were both `true`; new-hope had neither field at all, i.e.
-- both default to `false`).
insert into clients (id, name, org_type, plan, test_only, payroll_add_on, assigned_bookkeeper) values
  ('grace-community', '[TEST] Grace Community Church — Sample Profile', 'Church', 'premium', true, true, '{"name":"Alicia Fenwick","role":"Senior Bookkeeper","initials":"AF"}'::jsonb),
  ('new-hope', 'New Hope Fellowship', 'Church Plant', 'standard', false, false, '{"name":"Marcus Webb","role":"Bookkeeper","initials":"MW"}'::jsonb)
on conflict (id) do nothing;
