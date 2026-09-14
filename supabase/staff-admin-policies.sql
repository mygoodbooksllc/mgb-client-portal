-- Admin access for the in-app "Staff Access" page (components: app.jsx's
-- StaffAccessPage). Builds on supabase/staff-schema.sql — run that first if
-- you haven't (it creates the `staff` table and the "read own row" policy).
--
-- staff-schema.sql only lets a signed-in user read their OWN row, which is
-- enough for the login gate but not enough to list or edit the roster from
-- the browser. This adds ONE more policy: an active admin (their own `staff`
-- row has role = 'admin' and active = true) may select/insert/update/delete
-- ANY row.
--
-- This is enforced by Postgres itself, not by the app: the browser sends the
-- same Supabase client calls regardless of who's signed in, and it's this
-- policy — checked against the caller's own row every time — that decides
-- whether the read/write actually goes through. A non-admin who somehow
-- loaded the Staff Access page would still have every request rejected here.
--
-- Run this once in the Supabase SQL editor.

create policy "admins can manage staff"
  on staff for all
  using (
    exists (
      select 1 from staff s
      where s.email = auth.jwt() ->> 'email'
        and s.role = 'admin'
        and s.active = true
    )
  )
  with check (
    exists (
      select 1 from staff s
      where s.email = auth.jwt() ->> 'email'
        and s.role = 'admin'
        and s.active = true
    )
  );
