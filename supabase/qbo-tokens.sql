-- Applied live via Supabase MCP apply_migration (name: qbo_tokens).
-- RLS enabled with NO policies: unreachable via the anon/authenticated
-- (publishable) key used in the browser. Only the qbo-callback Edge
-- Function's service_role key (which bypasses RLS entirely) can read or
-- write this table.
create table if not exists qbo_tokens (
  client_id text primary key references qbo_connections (client_id) on delete cascade,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table qbo_tokens enable row level security;
