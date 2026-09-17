-- Internal staff messaging: a bookkeeper's private line to management,
-- separate from client conversations (which live in mock data, not
-- Supabase — see data.js's `threads`). One thread per bookkeeper, keyed by
-- their own email regardless of who's actually writing into it; any active
-- admin can read and reply to any bookkeeper's thread (there's no single
-- "the account manager" role in `staff` — every admin can pick one up), but
-- a bookkeeper only ever sees their own.
--
-- Builds on staff-schema.sql and staff-admin-policies.sql (for
-- is_active_staff_admin()) and client-notes.sql (for is_active_staff()).
-- Run those first if you haven't.
--
-- Run this once in the Supabase SQL editor. Safe to re-run.

create table if not exists staff_messages (
  id uuid primary key default gen_random_uuid(),
  staff_email text not null,
  author_email text not null,
  author_name text not null,
  author_role text not null,
  text text not null,
  created_at timestamptz not null default now()
);

create index if not exists staff_messages_staff_email_idx on staff_messages (staff_email, created_at);

alter table staff_messages enable row level security;

-- A bookkeeper reads/writes only their own thread; an admin reads/writes
-- any thread. Either way, the row's author_email has to match whoever is
-- actually signed in -- nobody can post a message as someone else.
drop policy if exists "read own or any as admin" on staff_messages;
create policy "read own or any as admin"
  on staff_messages for select
  using (
    staff_email = auth.jwt() ->> 'email'
    or public.is_active_staff_admin()
  );

drop policy if exists "write own or any as admin" on staff_messages;
create policy "write own or any as admin"
  on staff_messages for insert
  with check (
    author_email = auth.jwt() ->> 'email'
    and (
      staff_email = auth.jwt() ->> 'email'
      or public.is_active_staff_admin()
    )
  );
