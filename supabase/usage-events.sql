-- Client-side usage tracking: one row per page view, staff and client
-- portal alike, so "Usage Stats" (app.jsx's UsageStatsPage) can rank pages
-- most-to-least used instead of guessing from anecdote. Deliberately
-- coarse — page views only, no click-level event stream — since the goal
-- is "what needs work vs. what's dead weight", not a full analytics
-- pipeline. Builds on access-requests.sql (is_active_staff_admin()).
--
-- Run this once in the Supabase SQL editor, or via the Supabase MCP's
-- apply_migration.

create table if not exists usage_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_email text,
  actor_role text not null check (actor_role in ('staff', 'client')),
  client_id text,
  page text not null
);

create index if not exists usage_events_page_idx
  on usage_events (page, occurred_at desc);
create index if not exists usage_events_occurred_at_idx
  on usage_events (occurred_at desc);

alter table usage_events enable row level security;

-- Write: any signed-in staff or client member can log their own page views.
-- No update/delete policy at all — this is an append-only log, same stance
-- as client_activity_log/staff_audit_log.
drop policy if exists "signed-in users can log their own usage" on usage_events;
create policy "signed-in users can log their own usage"
  on usage_events for insert
  with check (auth.role() = 'authenticated');

-- Read: admins only. Regular bookkeepers don't need this (it's a product
-- decision surface, not a per-client operational one), and clients never
-- see it at all — no client_users policy, mirroring client_private_notes.
drop policy if exists "admins can read usage events" on usage_events;
create policy "admins can read usage events"
  on usage_events for select
  using (public.is_active_staff_admin());

revoke update, delete on usage_events from anon, authenticated;
