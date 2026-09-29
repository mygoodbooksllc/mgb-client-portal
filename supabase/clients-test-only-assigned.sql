-- Test-only clients: an explicit assignment overrides the hide (owner report
-- 2026-09-29). clients-test-only-server-side.sql hid test_only orgs from every
-- non-admin, so a bookkeeper whose only assigned client was a test org (e.g.
-- the Pro Test Client) got the "no clients assigned" screen. Unassigned test
-- orgs stay hidden from non-admins; an admin checking one off for someone
-- under Staff Access now means they see it. Matches App's visibleClients.
-- Safe to re-run.

drop policy if exists "staff can read clients" on clients;
create policy "staff can read clients"
  on clients for select
  using (
    public.is_active_staff()
    and (
      not test_only
      or public.is_active_staff_admin()
      or exists (
        select 1 from staff_client_access sca
        where sca.staff_email = auth.jwt() ->> 'email'
          and sca.client_id = clients.id
      )
    )
  );
