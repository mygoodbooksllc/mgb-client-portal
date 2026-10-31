-- Applied live via Supabase MCP apply_migration (name: client_status_overrides).
--
-- Manual health-status override per client, for the red/yellow/green status
-- dot shown in the sidebar's client picker and on the Bookkeeper Home "Your
-- clients" card. Most of the time that dot is computed on the fly in the
-- frontend from data already in CLIENTS (budget overrun, overdue
-- payables/receivables — see clientHealthSignal() in app.jsx), which needs
-- no table at all. This table exists only for the part that can't be
-- computed: a subjective call like "needs follow-up" or a status a staff
-- member wants to set/clear by hand. When a row exists for a client, it
-- takes precedence over the computed signal.
--
-- Builds on staff-schema.sql (is_active_staff()). Run that first if you
-- haven't.
--
-- Run this once in the Supabase SQL editor.

create table if not exists client_status_overrides (
  client_id text primary key,
  status text not null check (status in ('green', 'yellow', 'red')),
  note text,
  set_by text,
  updated_at timestamptz not null default now()
);

alter table client_status_overrides enable row level security;

drop policy if exists "active staff can read status overrides" on client_status_overrides;
create policy "active staff can read status overrides"
  on client_status_overrides for select
  using (public.is_active_staff());

drop policy if exists "active staff can write status overrides" on client_status_overrides;
create policy "active staff can write status overrides"
  on client_status_overrides for all
  using (public.is_active_staff())
  with check (public.is_active_staff());
