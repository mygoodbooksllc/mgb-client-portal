-- Applied live via Supabase MCP apply_migration (name: qbo_connections).
-- Connection status only — never stores OAuth tokens. Real tokens belong in
-- an Edge Function's secrets / Supabase Vault once the Intuit Developer app
-- exists, not in a table any staff RLS policy can read.
create table if not exists qbo_connections (
  client_id text primary key,
  realm_id text,
  connected_by text,
  connected_at timestamptz,
  status text not null default 'disconnected' check (status in ('disconnected', 'connected', 'error')),
  last_synced_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);

alter table qbo_connections enable row level security;

drop policy if exists "staff manage qbo connections" on qbo_connections;
create policy "staff manage qbo connections"
  on qbo_connections for all
  using (is_active_staff())
  with check (is_active_staff());
