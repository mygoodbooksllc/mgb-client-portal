-- Admins can read every staff task (owner decision 2026-09-29), for the
-- admin Team page: who has what open, overdue and completed. "Private" tasks
-- stay private from other bookkeepers, not from admins. Read-only: admins
-- don't get to edit someone else's private tasks through this.
-- time_entries already has "admins read all time entries".
-- Safe to re-run. Applied to production 2026-09-29.

drop policy if exists "admins read all reminders" on public.staff_reminders;
create policy "admins read all reminders" on public.staff_reminders
  for select using (public.is_active_staff_admin());
