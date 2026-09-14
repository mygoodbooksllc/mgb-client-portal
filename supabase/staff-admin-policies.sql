-- Admin access for the in-app "Staff Access" page (components: app.jsx's
-- StaffAccessPage). Builds on supabase/staff-schema.sql — run that first if
-- you haven't (it creates the `staff` table and the "read own row" policy).
--
-- staff-schema.sql only lets a signed-in user read their OWN row, which is
-- enough for the login gate but not enough to list or edit the roster from
-- the browser. This adds a policy: an active admin (their own `staff` row
-- has role = 'admin' and active = true) may select/insert/update/delete ANY
-- row.
--
-- This is enforced by Postgres itself, not by the app: the browser sends the
-- same Supabase client calls regardless of who's signed in, and it's this
-- policy that decides whether the read/write actually goes through. A
-- non-admin who somehow loaded the Staff Access page would still have every
-- request rejected here.
--
-- IMPORTANT: the admin check can't be a plain subquery on `staff` inside a
-- policy ON `staff` — evaluating that subquery re-triggers the same policy
-- on itself, and Postgres errors with "infinite recursion detected in
-- policy for relation staff" (this surfaces in the app as every staff
-- lookup failing, including the login gate's own check). The fix is a
-- SECURITY DEFINER function: it runs as the function's owner, which bypasses
-- RLS for its own internal query, so the recursion never starts.
--
-- Run this once in the Supabase SQL editor. Safe to re-run.

drop policy if exists "admins can manage staff" on staff;

create or replace function public.is_active_staff_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from staff
    where email = auth.jwt() ->> 'email'
      and role = 'admin'
      and active = true
  );
$$;

create policy "admins can manage staff"
  on staff for all
  using (public.is_active_staff_admin())
  with check (public.is_active_staff_admin());
