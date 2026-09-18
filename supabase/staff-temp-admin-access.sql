-- Temporary, time-limited admin-page visibility for a bookkeeper. Builds on
-- staff-schema.sql, staff-admin-policies.sql (for is_active_staff_admin())
-- and client-notes.sql (for is_active_staff()). Run those first.
--
-- This table ONLY controls whether the three admin-only pages (Staff
-- Access, Client Roster, Developer Tools) are VISIBLE to a bookkeeper —
-- app.jsx checks staff_email = self AND expires_at > now(). It does NOT
-- grant any additional write privileges: the underlying RLS policies on
-- `staff` / `staff_client_access` / developer-tools RPCs still require
-- is_active_staff_admin() (role = 'admin'), so a bookkeeper who is only
-- temp-granted sees these pages read-only, and app.jsx hides the mutation
-- controls with an explanatory note rather than letting them silently fail
-- server-side. This is a deliberate, conservative choice — see
-- HANDOFF7.md for the reasoning; revisit if temp grants should ever allow
-- real admin mutations.
--
-- Run this once in the Supabase SQL editor. Safe to re-run.

create table if not exists staff_temp_admin_access (
  staff_email text primary key,
  granted_by text not null,
  granted_at timestamptz not null default now(),
  expires_at timestamptz not null,
  reason text
);

alter table staff_temp_admin_access enable row level security;

-- Any active staff member may read the full table (not just their own row):
-- the app needs to check "do I currently have a grant" cheaply, and the
-- data itself (who has temp access to what, until when) isn't sensitive
-- among staff — this mirrors how the `staff` roster itself is broadly
-- readable to signed-in staff for the login gate.
drop policy if exists "active staff can read temp admin access" on staff_temp_admin_access;
create policy "active staff can read temp admin access"
  on staff_temp_admin_access for select
  using (public.is_active_staff());

drop policy if exists "admins can manage temp admin access" on staff_temp_admin_access;
create policy "admins can manage temp admin access"
  on staff_temp_admin_access for all
  using (public.is_active_staff_admin())
  with check (public.is_active_staff_admin());

-- Optional helper, matching the is_active_staff()/is_active_staff_admin()
-- pattern, in case any RLS policy elsewhere ever wants to respect temp
-- grants too. Not currently referenced by any policy (see note above) —
-- app.jsx checks expires_at client-side for page visibility only.
create or replace function public.has_temp_admin_access(p_email text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from staff_temp_admin_access
    where staff_email = p_email
      and expires_at > now()
  );
$$;
