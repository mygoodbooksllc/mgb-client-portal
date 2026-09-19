-- Periodic in-app feedback survey (app.jsx's FeedbackSurveyModal): a
-- lightweight "what's your favorite tab, what's frustrating you" prompt
-- shown occasionally to staff and client-portal users alike, so product
-- decisions can be informed by direct feedback, not just the usage_events
-- view-count data (see usage-events.sql). Builds on access-requests.sql
-- (is_active_staff_admin()).
--
-- Run this once in the Supabase SQL editor, or via the Supabase MCP's
-- apply_migration.

create table if not exists feature_feedback (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  actor_email text,
  actor_role text not null check (actor_role in ('staff', 'client')),
  client_id text,
  overall_rating smallint check (overall_rating between 1 and 5),
  favorite_feature text,
  friction_text text,
  comments text
);

create index if not exists feature_feedback_created_at_idx
  on feature_feedback (created_at desc);

alter table feature_feedback enable row level security;

-- Write: any signed-in staff or client member can submit their own
-- feedback. No update/delete policy — append-only, same stance as
-- usage_events/client_activity_log/staff_audit_log.
drop policy if exists "signed-in users can submit feedback" on feature_feedback;
create policy "signed-in users can submit feedback"
  on feature_feedback for insert
  with check (auth.role() = 'authenticated');

-- Read: admins only.
drop policy if exists "admins can read feedback" on feature_feedback;
create policy "admins can read feedback"
  on feature_feedback for select
  using (public.is_active_staff_admin());

revoke update, delete on feature_feedback from anon, authenticated;
