-- Who's actually allowed to sign in as a client contact, and for which
-- organization. Builds on staff-admin-policies.sql (reuses
-- is_active_staff_admin()). Run that first if you haven't.
--
-- This is authentication data (who can log in as whom), not authorization —
-- CLIENTS[].users in data.js still owns *what* each person can see (tabs,
-- categories, funds), same as today. Phase 2's login gate will look someone
-- up here by email to find which client org and which of that org's mock
-- users they are, then app.jsx's existing access model takes over unchanged.
--
-- client_id is a plain text column, not a foreign key — there's no real
-- `clients` table yet (that's Phase 3, replacing data.js). It just has to
-- match one of CLIENTS[].id in data.js, checked in the app, not the database.
--
-- Run this once in the Supabase SQL editor, or via the Supabase MCP's
-- apply_migration.

create table if not exists client_users (
  email text primary key,
  client_id text not null,
  name text not null,
  role text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table client_users enable row level security;

-- Admin-only for now — there's no login gate reading this table yet, so
-- nobody but an admin managing the roster has any reason to touch it. Once
-- Phase 2's client login gate exists, add a policy letting a signed-in
-- client read (only) their own row, the same shape as staff-admin-policies.sql
-- gives staff.
drop policy if exists "admins can manage client users" on client_users;
create policy "admins can manage client users"
  on client_users for all
  using (public.is_active_staff_admin())
  with check (public.is_active_staff_admin());
