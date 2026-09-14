-- Which clients each bookkeeper can see. Builds on staff-schema.sql and
-- staff-admin-policies.sql (reuses is_active_staff_admin()). Run both of
-- those first.
--
-- Admins are NEVER restricted by this table — app.jsx only applies it to
-- staff with role = 'bookkeeper'. A bookkeeper with no rows here sees NO
-- clients until an admin checks at least one for them under Staff Access
-- (opt-in, not opt-out) — same default-safe direction as the scoped-user
-- funds fix.
--
-- Run this once in the Supabase SQL editor.

create table if not exists staff_client_access (
  staff_email text not null,
  client_id text not null,
  created_at timestamptz not null default now(),
  primary key (staff_email, client_id)
);

alter table staff_client_access enable row level security;

drop policy if exists "staff can read own client access" on staff_client_access;
create policy "staff can read own client access"
  on staff_client_access for select
  using (staff_email = auth.jwt() ->> 'email');

drop policy if exists "admins can manage client access" on staff_client_access;
create policy "admins can manage client access"
  on staff_client_access for all
  using (public.is_active_staff_admin())
  with check (public.is_active_staff_admin());
