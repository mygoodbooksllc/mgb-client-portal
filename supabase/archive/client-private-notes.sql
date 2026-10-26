-- Applied live via Supabase MCP apply_migration (name: client_private_notes).
--
-- A per-client staff scratchpad: free-form entries like "always double-check
-- their payroll timing" or "owner is prickly about fees" — never client-
-- facing. This is NOT the same as:
--   - client_notes (client-notes.sql): a single shared free-text scratchpad
--     per client, one row per client_id, for handoff context between staff.
--   - client_documents (client-documents.sql): file links, readable by the
--     client themselves via a client_users join.
--   - staff_messages / client-facing chat: visible to the client.
--   - staff_reminders: private to one staff member, not client-specific.
-- client_private_notes holds multiple timestamped, attributed entries per
-- client, and — unlike every table above except staff_reminders — is never
-- readable by a client under any policy. There is deliberately no
-- "client reads own X" policy here.
--
-- Run this once in the Supabase SQL editor (after staff-schema.sql, which
-- defines is_active_staff()).

create table if not exists client_private_notes (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,
  text text not null,
  author_email text not null,
  author_name text not null,
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

alter table client_private_notes enable row level security;

-- Staff-only, full stop. No client_users join anywhere in this file — that
-- omission is intentional and is what keeps these notes off-limits to
-- clients. Any future edit to this file must not add one.
drop policy if exists "staff manage private notes" on client_private_notes;
create policy "staff manage private notes"
  on client_private_notes for all
  using (is_active_staff())
  with check (is_active_staff());
