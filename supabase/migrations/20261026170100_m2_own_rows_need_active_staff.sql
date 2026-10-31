-- Security audit finding M2: a deactivated staffer kept full access to their
-- own tasks/reminders and time entries, because those policies only compared
-- staff_email with the login email. They now also need is_active_staff().
-- Only the "own rows" policies change; the team's Tasks policies
-- ("tk read tasks", "tk edit tasks") and the shared-reminder policies already
-- check active staff and are left alone.

alter policy "staff manage own reminders" on public.staff_reminders
  to authenticated
  using (staff_email = (auth.jwt() ->> 'email') and public.is_active_staff())
  with check (staff_email = (auth.jwt() ->> 'email') and public.is_active_staff());

alter policy "staff manage own time entries" on public.time_entries
  to authenticated
  using (staff_email = (auth.jwt() ->> 'email') and public.is_active_staff())
  with check (staff_email = (auth.jwt() ->> 'email') and public.is_active_staff());
