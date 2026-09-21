-- Audit hardening, batch 2a: make "bookkeeper" a real tier in the database.
-- APPLIED LIVE via Supabase MCP apply_migration
-- (`scope_staff_client_tables_to_assignment`). Kept here so the repo records it.
--
-- The problem
-- -----------
-- Per-bookkeeper client assignment (staff_client_access) existed ONLY as a
-- browser-side .filter() over the CLIENTS array, in App's `visibleClients`.
-- Every per-client table's policy was a flat is_active_staff() — "are you on
-- the staff roster and active" — with no reference to assignment at all.
--
-- So any active bookkeeper, assigned to zero clients, could open devtools and
-- run:
--
--   await mgbSupabase.from('client_private_notes').select('*')
--
-- with no .eq() and no filter, and read every candid internal note about every
-- client in the firm. The same call worked against client_notes,
-- client_documents (every Drive link for every org), client_status_overrides,
-- qbo_connections, access_requests (every submitted person, email and role),
-- and access_request_links (every live invite token). Several of those
-- policies are FOR ALL, so writes and deletes too. Client-side filters are not
-- access control.
--
-- client_activity_log (client-activity-log.sql) already did this correctly.
-- This lifts its predicate into a shared helper and applies it everywhere it
-- was missing.
--
-- Deliberately NOT changed: `clients` itself keeps a broad staff-readable
-- policy. Every staffer needs the roster for name lookups, and clients-roster
-- .sql documents that as intentional.

create or replace function public.can_access_client(p_client_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_active_staff_admin()
      or exists (
        select 1 from staff_client_access sca
        where sca.staff_email = auth.jwt() ->> 'email'
          and sca.client_id = p_client_id
      );
$$;

-- RLS policies are evaluated as the CALLING role, so the browser roles must be
-- able to execute this or every policy below fails closed and the app stops
-- working entirely. SECURITY DEFINER is what stops the function's own read of
-- staff_client_access from being filtered by that table's RLS.
grant execute on function public.can_access_client(text) to anon, authenticated;

-- client_notes
drop policy if exists "active staff can read client notes" on client_notes;
drop policy if exists "active staff can write client notes" on client_notes;
create policy "staff read assigned client notes" on client_notes
  for select using (public.can_access_client(client_id));
create policy "staff write assigned client notes" on client_notes
  for all using (public.can_access_client(client_id))
  with check (public.can_access_client(client_id));

-- client_private_notes (internal staff-only commentary — the file's own
-- example of its contents is "owner is prickly about fees")
drop policy if exists "staff manage private notes" on client_private_notes;
create policy "staff manage private notes" on client_private_notes
  for all using (public.can_access_client(client_id))
  with check (public.can_access_client(client_id));

-- client_documents: the STAFF policy only. The separate "client reads own
-- documents" policy (a client_users join on client_id + email + active) was
-- already correct and is left exactly as it is.
drop policy if exists "staff manage documents" on client_documents;
create policy "staff manage documents" on client_documents
  for all using (public.can_access_client(client_id))
  with check (public.can_access_client(client_id));

-- client_status_overrides
drop policy if exists "active staff can read status overrides" on client_status_overrides;
drop policy if exists "active staff can write status overrides" on client_status_overrides;
create policy "staff read assigned status overrides" on client_status_overrides
  for select using (public.can_access_client(client_id));
create policy "staff write assigned status overrides" on client_status_overrides
  for all using (public.can_access_client(client_id))
  with check (public.can_access_client(client_id));

-- qbo_connections
drop policy if exists "staff manage qbo connections" on qbo_connections;
create policy "staff manage qbo connections" on qbo_connections
  for all using (public.can_access_client(client_id))
  with check (public.can_access_client(client_id));

-- qbo_connect_state: previously any staffer could mint a connect-state token
-- bound to any client_id, attributing a QuickBooks connection to a client they
-- do not manage.
drop policy if exists "staff create qbo connect state" on qbo_connect_state;
create policy "staff create qbo connect state" on qbo_connect_state
  for insert with check (public.can_access_client(client_id));

-- access_requests. submit_access_request() is SECURITY DEFINER and bypasses
-- RLS, so the anonymous submission path is unaffected by this change.
drop policy if exists "staff read requests" on access_requests;
drop policy if exists "staff write requests" on access_requests;
drop policy if exists "staff update requests" on access_requests;
create policy "staff read assigned requests" on access_requests
  for select using (public.can_access_client(client_id));
create policy "staff write assigned requests" on access_requests
  for insert with check (public.can_access_client(client_id));
create policy "staff update assigned requests" on access_requests
  for update using (public.can_access_client(client_id))
  with check (public.can_access_client(client_id));

-- access_request_links: these rows hold LIVE invite tokens. Any staffer could
-- read every outstanding token for every client in the firm.
drop policy if exists "staff read links" on access_request_links;
drop policy if exists "staff write links" on access_request_links;
drop policy if exists "staff update links" on access_request_links;
create policy "staff read assigned links" on access_request_links
  for select using (public.can_access_client(client_id));
create policy "staff write assigned links" on access_request_links
  for insert with check (public.can_access_client(client_id));
create policy "staff update assigned links" on access_request_links
  for update using (public.can_access_client(client_id))
  with check (public.can_access_client(client_id));

-- enterprise_upgrade_requests
drop policy if exists "staff read upgrade requests" on enterprise_upgrade_requests;
drop policy if exists "staff write upgrade requests" on enterprise_upgrade_requests;
drop policy if exists "staff update upgrade requests" on enterprise_upgrade_requests;
create policy "staff read assigned upgrade requests" on enterprise_upgrade_requests
  for select using (public.can_access_client(client_id));
create policy "staff write assigned upgrade requests" on enterprise_upgrade_requests
  for insert with check (public.can_access_client(client_id));
create policy "staff update assigned upgrade requests" on enterprise_upgrade_requests
  for update using (public.can_access_client(client_id))
  with check (public.can_access_client(client_id));

-- qbo_disconnect() authenticated the caller but never authorized them against
-- the client_id they passed. It is SECURITY DEFINER, so it reaches qbo_tokens
-- — a table with RLS and no policies, deliberately unreachable from the
-- browser — and deleted from it on a fully caller-controlled parameter. Any
-- active staffer, assigned to nothing, could destroy any org's QuickBooks
-- tokens; because Intuit rotates refresh tokens on every use that is not
-- recoverable by retry, a human has to re-run the whole OAuth consent flow.
-- Looped over the roster it took QuickBooks down for the entire firm in one
-- call.
create or replace function public.qbo_disconnect(p_client_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_access_client(p_client_id) then
    raise exception 'not authorized';
  end if;
  delete from qbo_tokens where client_id = p_client_id;
  update qbo_connections
  set status = 'disconnected',
      realm_id = null,
      connected_at = null,
      last_error = null,
      updated_at = now()
  where client_id = p_client_id;
end;
$$;

revoke all on function public.qbo_disconnect(text) from public, anon;
grant execute on function public.qbo_disconnect(text) to authenticated;

-- Verify (expect scoped = policies, still_flat = 0 for every row):
--   select tablename, count(*) as policies,
--     count(*) filter (where coalesce(qual,'')||coalesce(with_check,'')
--       like '%can_access_client%') as scoped,
--     count(*) filter (where coalesce(qual,'')||coalesce(with_check,'')
--       ~ 'is_active_staff\(\)') as still_flat
--   from pg_policies where schemaname='public'
--     and tablename in ('client_notes','client_private_notes','client_documents',
--       'client_status_overrides','qbo_connections','qbo_connect_state',
--       'access_requests','access_request_links','enterprise_upgrade_requests')
--   group by 1 order by 1;
-- (client_documents shows scoped = 1 of 2: the second policy is the client
-- self-read, which is correctly not assignment-scoped.)
