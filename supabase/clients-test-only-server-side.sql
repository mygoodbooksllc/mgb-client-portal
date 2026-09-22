-- §171: stop serving [TEST] sample orgs to non-admin staff from the database,
-- not just from the browser. APPLIED LIVE via Supabase MCP apply_migration
-- (`clients_test_only_server_side`). Kept here so the repo records it.
--
-- App's `visibleClients` (app.jsx, ~line 17200) filters `c.testOnly` out for
-- anyone whose role isn't admin. That is a presentation filter: the rows
-- still crossed the wire, and
--
--   await mgbSupabase.from('clients').select('*')
--
-- in devtools handed any active bookkeeper every sample org anyway. Same
-- class of finding as audit-hardening-client-scoping.sql. Move the rule into
-- the select policy; the client-side filter stays as belt-and-braces (and
-- because CLIENTS is also fed by data.js today).
--
-- Only the STAFF policy is changed. "client reads own org"
-- (client-read-own-org.sql) deliberately does NOT carry the test_only
-- condition: a client contact provisioned against a sample org is being
-- deliberately given that org, and hiding it would just break their portal.

drop policy if exists "staff can read clients" on clients;
create policy "staff can read clients"
  on clients for select
  using (
    public.is_active_staff()
    and (not test_only or public.is_active_staff_admin())
  );
