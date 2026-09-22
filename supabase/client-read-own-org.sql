-- §171: let a signed-in CLIENT read their own organization's row in
-- `clients`. APPLIED LIVE via Supabase MCP apply_migration
-- (`client_read_own_org`). Kept here so the repo records it.
--
-- The problem
-- -----------
-- `clients` had exactly one select policy: is_active_staff() (see
-- clients-roster.sql). Phase 2's client portal (ClientAuthGate ->
-- ClientPortalGuard) signs a client contact in against client_users, but
-- that person is not staff, so every read of `clients` came back empty for
-- them. Today the portal papers over that by reading the org's name/plan out
-- of data.js's CLIENTS_MOCK_DATA, which stops working the moment the roster
-- is the only source of truth.
--
-- The fix: a second, narrow select policy. A client contact sees exactly the
-- one org their active client_users row points at — never the roster. The
-- staff policy is untouched and still stands on its own (policies of the
-- same command OR together).
--
-- Note the direction of the join: client_users is read from inside a policy
-- on `clients`, and client_users' own "client reads own row" policy
-- (client-auth-phase2.sql) already lets that same person read that same row,
-- so this needs no SECURITY DEFINER helper and leaks nothing extra.

drop policy if exists "client reads own org" on clients;
create policy "client reads own org"
  on clients for select
  using (
    exists (
      select 1 from client_users cu
      where cu.email = auth.jwt() ->> 'email'
        and cu.client_id = clients.id
        and cu.active
    )
  );
