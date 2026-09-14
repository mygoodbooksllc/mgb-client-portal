-- Personal reminders for the bookkeeper homepage. Entirely private per
-- staffer — unlike staff/staff_client_access, there's no admin-override
-- policy here at all: nobody, not even an admin, can read or write another
-- person's reminders from the browser.
--
-- Run this once in the Supabase SQL editor.

create table if not exists staff_reminders (
  id uuid primary key default gen_random_uuid(),
  staff_email text not null,
  text text not null,
  due_date date,
  done boolean not null default false,
  created_at timestamptz not null default now()
);

alter table staff_reminders enable row level security;

drop policy if exists "staff manage own reminders" on staff_reminders;
create policy "staff manage own reminders"
  on staff_reminders for all
  using (staff_email = auth.jwt() ->> 'email')
  with check (staff_email = auth.jwt() ->> 'email');
