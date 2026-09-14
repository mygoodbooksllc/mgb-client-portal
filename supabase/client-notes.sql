-- Shared bookkeeper notes per client (e.g. "waiting on March bank
-- statement", "flagged for QuickBooks migration") -- for handing context to
-- a colleague, not just yourself. Unlike staff_reminders (private per
-- person), any active staff member can read and write these: they're about
-- a client, not a person, and whoever picks up a client next should see
-- what the last person left.
--
-- Builds on staff-schema.sql. Run that first if you haven't.
--
-- Run this once in the Supabase SQL editor.

create or replace function public.is_active_staff()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from staff
    where email = auth.jwt() ->> 'email'
      and active = true
  );
$$;

create table if not exists client_notes (
  client_id text primary key,
  note text not null default '',
  updated_by text,
  updated_at timestamptz not null default now()
);

alter table client_notes enable row level security;

drop policy if exists "active staff can read client notes" on client_notes;
create policy "active staff can read client notes"
  on client_notes for select
  using (public.is_active_staff());

drop policy if exists "active staff can write client notes" on client_notes;
create policy "active staff can write client notes"
  on client_notes for all
  using (public.is_active_staff())
  with check (public.is_active_staff());
