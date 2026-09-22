-- "Sync now" for staff AND clients (supabase/functions/qbo-sync/index.ts,
-- mode (b)). Two additive changes, both safe to apply before or after the
-- function is deployed:
--
-- 1. qbo_connections.sync_started_at — the per-connection "a sync is in
--    progress" lock. qbo-sync takes it with a conditional UPDATE ... RETURNING
--    (null or older than 5 minutes = free) and clears it when the run ends.
--    The function fails open if this column is missing, so deploy order
--    doesn't matter; until it exists only the 60-second throttle applies.
--
-- 2. A SELECT policy letting an active client user read their OWN org's
--    qbo_connections row. Every other qbo_* table already has the matching
--    "client reads own …" policy (qbo-data.sql), but qbo_connections only had
--    the staff one — so index.html's loadQboData() saw no connection for a
--    client login, never mapped their real numbers, and the header never
--    showed them the Live pill (or, now, the Sync now button). Read-only;
--    writes stay staff-only via "staff manage qbo connections".
--    Columns a client can now see for their own org: client_id, realm_id,
--    connected_by (a staff email), connected_at, status, last_synced_at,
--    last_error, updated_at, api_env, sync_started_at. Tokens live in
--    qbo_tokens and are unaffected.

alter table qbo_connections
  add column if not exists sync_started_at timestamptz;

drop policy if exists "client reads own qbo connection" on qbo_connections;
create policy "client reads own qbo connection" on qbo_connections
  for select using (
    exists (
      select 1 from client_users cu
      where cu.email = auth.jwt() ->> 'email'
        and cu.client_id = qbo_connections.client_id
        and cu.active
    )
  );
