-- Audit hardening, batch 3: the staff table accepted any email address.
--
-- app.jsx's addStaff() refuses anything that doesn't end in
-- "@mygoodbooks.org", and the Google OAuth client is set to "Internal" for
-- that Workspace domain, so an outside address could never actually sign in.
-- But the database itself had no such rule: the insert policy only asks
-- whether the caller is an active staff admin, so an admin using the REST API
-- directly (or a bug in a future code path) could add a row for any address
-- at all. Because is_active_staff() — the predicate half the RLS policies in
-- this project are built on — matches purely on the JWT email, a staff row
-- for an address outside the domain is a standing grant waiting for whoever
-- controls that mailbox.
--
-- This makes the client-side check in addStaff() the friendly error and the
-- constraint the enforcement, the same split as the attachment limits.
--
-- Note the anchors and the escaped dot: '^[^@]+@mygoodbooks\.org$' rejects
-- "me@mygoodbooks.org.attacker.com" and "me@mygoodbooksXorg", which an
-- unanchored or unescaped pattern would let through.

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'staff_email_domain'
  ) then
    alter table staff
      add constraint staff_email_domain
      check (email ~* '^[^@]+@mygoodbooks\.org$');
  end if;
end
$$;
