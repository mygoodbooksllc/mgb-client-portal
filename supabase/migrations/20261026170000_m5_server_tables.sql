-- Security audit findings M5, L2 and L5: tables the edge functions use for
-- rate limits and private error details. Only service_role reaches them:
-- RLS is on and there are no policies.
--
-- M5. qbo-sync throttled "Sync now" on last_synced_at, which only moves after
--     a successful sync, so failed attempts were never throttled. It now
--     throttles on last_sync_attempt_at and caps manual syncs per person per
--     day with qbo_manual_sync_attempts.
-- L2. invite-client-user had no rate limit; it now counts invite_attempts.
-- L5. Raw database and QuickBooks error text reached client users through
--     qbo_connections.last_error and qbo_sync_runs.detail. It now goes to
--     qbo_sync_errors, and the client-visible columns get a reference.
--
-- Apply before deploying the updated qbo-sync and invite-client-user
-- functions: both fail closed without these objects. Safe to re-run.

alter table public.qbo_connections
  add column if not exists last_sync_attempt_at timestamptz;

create table if not exists public.qbo_manual_sync_attempts (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,
  actor_email text not null,
  attempted_at timestamptz not null default now()
);
create index if not exists qbo_manual_sync_attempts_actor_idx
  on public.qbo_manual_sync_attempts (actor_email, attempted_at desc);

create table if not exists public.qbo_sync_errors (
  ref uuid primary key default gen_random_uuid(),
  client_id text,
  detail text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.invite_attempts (
  id uuid primary key default gen_random_uuid(),
  caller_email text not null,
  recipient_email text not null,
  created_at timestamptz not null default now()
);
create index if not exists invite_attempts_caller_idx
  on public.invite_attempts (caller_email, created_at desc);
create index if not exists invite_attempts_recipient_idx
  on public.invite_attempts (recipient_email, created_at desc);

alter table public.qbo_manual_sync_attempts enable row level security;
alter table public.qbo_sync_errors enable row level security;
alter table public.invite_attempts enable row level security;
