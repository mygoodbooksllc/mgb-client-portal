-- Phase 2: real client login. Builds on client-users.sql (client_users:
-- email/client_id/name/role/active — the sign-in allowlist). This adds the
-- columns that make a row also carry ACCESS, not just sign-in permission —
-- same shape UserAccessEditor/Access Request Form already read and write in
-- mock/session-local form, now durable per person.
--
-- Run client-users.sql first if you haven't. Run this once in the Supabase
-- SQL editor.

alter table client_users
  add column if not exists access text not null default 'full' check (access in ('full', 'scoped')),
  add column if not exists tabs text[],
  add column if not exists categories text[],
  add column if not exists funds text[],
  add column if not exists premium_throttled boolean not null default false;

-- A signed-in client can read (not write) their own row — ClientAuthGate
-- needs this to resolve who they are and what they can see. Staff-only
-- write policy already exists in client-users.sql
-- (is_active_staff_admin()); this only adds the client's own read.
drop policy if exists "client reads own row" on client_users;
create policy "client reads own row"
  on client_users for select
  using (email = auth.jwt() ->> 'email');
