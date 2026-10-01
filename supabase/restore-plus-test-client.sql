-- Removed from production 2026-10-01 at the owner's request (test client not
-- needed for now). Run this to bring "new-hope" back exactly as it was.
-- It had no users, QuickBooks connection, messages, documents or close data;
-- only the client row and one staff access row.
insert into public.clients (id, name, org_type, plan, test_only, payroll_add_on,
  assigned_bookkeeper, created_at, assigned_bookkeeper_email, entity_type, org_address)
values ('new-hope', 'Plus Test Client', 'Church Plant', 'premium', true, false,
  '{"name":"Gillian Gray","role":"Bookkeeper","email":"gillian@mygoodbooks.org","initials":"GG"}'::jsonb,
  '2026-09-19 04:58:28.914407+00', 'gillian@mygoodbooks.org', 'nonprofit', null)
on conflict (id) do nothing;

insert into public.staff_client_access (staff_email, client_id, created_at)
values ('gillian@mygoodbooks.org', 'new-hope', '2026-09-30 02:30:56.408455+00')
on conflict do nothing;
