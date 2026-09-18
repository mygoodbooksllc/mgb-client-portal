-- Applied live via Supabase MCP apply_migration (name: qbo_connect_state).
-- Unpredictable, single-use OAuth state tokens, so the QuickBooks connect
-- flow's `state` param can't be guessed/replayed to attribute a connection
-- to the wrong client (Intuit's app review tests for this class of CSRF).
create table if not exists qbo_connect_state (
  token text primary key,
  client_id text not null,
  created_at timestamptz not null default now(),
  used boolean not null default false
);

alter table qbo_connect_state enable row level security;

drop policy if exists "staff create qbo connect state" on qbo_connect_state;
create policy "staff create qbo connect state"
  on qbo_connect_state for insert
  with check (is_active_staff());
