-- Phase 1 of the auth plan: the "who is actually authorized" table.
--
-- Google Workspace's "Internal" OAuth mode only proves someone is *on* the
-- mygoodbooks.org domain — it says nothing about whether they should have
-- portal access (a future non-bookkeeping hire, a shared support inbox, etc).
-- This table is the real source of truth for staff access; Workspace login is
-- just how a person proves who they are before we check this table.
--
-- Run this once in the Supabase SQL editor after creating the project.

create table if not exists staff (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text not null,
  role text not null default 'bookkeeper' check (role in ('bookkeeper', 'admin')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Row Level Security: a signed-in user may only read their OWN staff row, to
-- check whether they're authorized and what their name/role is. Nobody can
-- read the whole roster or write to this table from the browser — that's an
-- admin task done from the Supabase dashboard (or a service-role script) for
-- now, until there's an actual staff-management UI.
alter table staff enable row level security;

create policy "staff can read own row"
  on staff for select
  using (auth.jwt() ->> 'email' = email);

-- Seed yourself as the first admin so the login gate has someone to let in.
-- Replace with your real Workspace email before running.
insert into staff (email, name, role)
values ('you@mygoodbooks.org', 'Your Name', 'admin')
on conflict (email) do nothing;
