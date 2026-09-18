-- Personal reminders/task list for the bookkeeper homepage and "My Tasks"
-- page. Entirely private per staffer — unlike staff/staff_client_access,
-- there's no admin-override policy here at all: nobody, not even an admin,
-- can read or write another person's tasks from the browser.
--
-- Run this once in the Supabase SQL editor. Safe to re-run: the alter/policy
-- statements are idempotent.

create table if not exists staff_reminders (
  id uuid primary key default gen_random_uuid(),
  staff_email text not null,
  text text not null,
  due_date date,
  done boolean not null default false,
  created_at timestamptz not null default now(),
  -- Optional link to a client (text, same convention as
  -- client_notes.client_id — clients live in app config, not a Postgres
  -- table), a priority for sorting, and a completion timestamp so "done"
  -- carries a when, not just a boolean.
  client_id text,
  priority text not null default 'normal',
  completed_at timestamptz
);

alter table staff_reminders
  add column if not exists client_id text,
  add column if not exists priority text not null default 'normal',
  add column if not exists completed_at timestamptz;

alter table staff_reminders
  drop constraint if exists staff_reminders_priority_check;
alter table staff_reminders
  add constraint staff_reminders_priority_check
  check (priority in ('low', 'normal', 'high'));

update staff_reminders set completed_at = created_at where done and completed_at is null;

alter table staff_reminders enable row level security;

drop policy if exists "staff manage own reminders" on staff_reminders;
create policy "staff manage own reminders"
  on staff_reminders for all
  using (staff_email = auth.jwt() ->> 'email')
  with check (staff_email = auth.jwt() ->> 'email');
