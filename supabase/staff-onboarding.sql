-- New-hire onboarding checklist (owner request 2026-10-07). Staff only.
--
-- Applied to production 2026-10-07 as migration staff_onboarding.
-- Safe to re-run.
--
--   staff_onboarding_steps     the checklist every staff member works
--                              through. Admins add, edit, reorder and retire
--                              steps (active = false; never deleted). A step
--                              can point at a Staff guide article
--                              (guide_slug).
--   staff_onboarding_progress  one row per person per step they ticked.
--                              done_at null = unticked again. done_by is
--                              stamped server-side. The reserved step key
--                              '__dismissed' records "Hide this card" on Home.
--
-- RLS: every active staff member reads the step list; admins write it. Each
-- person reads and writes their own progress; admins read and write anyone's.
-- No deletes on either table. Clients can't see any of it.

create table if not exists public.staff_onboarding_steps (
  key         text primary key,
  title       text not null,
  description text,
  guide_slug  text,
  sort        integer not null default 100,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  text,
  constraint staff_onboarding_steps_key_format check (key ~ '^[a-z0-9_-]{1,40}$'),
  constraint staff_onboarding_steps_title_len check (length(trim(title)) between 1 and 120),
  constraint staff_onboarding_steps_desc_len check (description is null or length(description) <= 500),
  constraint staff_onboarding_steps_slug_format check (guide_slug is null or guide_slug ~ '^[a-z0-9-]{1,80}$')
);

insert into public.staff_onboarding_steps (key, title, description, guide_slug, sort) values
  ('getting-started', 'Read Getting started', 'How the portal is laid out and where things live.', 'getting-started', 10),
  ('google-access', 'Set up Google account access', 'Sign in with your mygoodbooks.org Google account and make sure you can open the shared client Drive.', null, 20),
  ('finding-a-client', 'Find a client', 'Use the client picker and search to open a client.', 'finding-a-client', 30),
  ('inbox', 'Learn the Inbox', 'Reply to client messages and see what''s waiting.', 'inbox', 40),
  ('my-tasks', 'Set up My Tasks', 'Add a reminder and a task so you know how they work.', 'my-tasks', 50),
  ('month-end-close', 'Learn month-end close', 'The close checklist and the Close tracker.', 'month-end-close', 60),
  ('client-sops', 'Read a client SOP', 'How each client''s books are run, and how to keep the SOP current.', 'client-sops', 70),
  ('shadow-month-end', 'Shadow a client month-end', 'Sit in on a teammate''s close for one client from start to finish.', null, 80),
  ('quarterly-reviews', 'Read about quarterly reviews', 'How your quarterly review works and what to expect.', 'quarterly-reviews', 90)
on conflict (key) do nothing;

alter table public.staff_onboarding_steps enable row level security;

drop policy if exists "staff read onboarding checklist" on public.staff_onboarding_steps;
create policy "staff read onboarding checklist" on public.staff_onboarding_steps
  for select to authenticated using (public.is_active_staff());

drop policy if exists "admins add onboarding checklist steps" on public.staff_onboarding_steps;
create policy "admins add onboarding checklist steps" on public.staff_onboarding_steps
  for insert to authenticated with check (public.is_active_staff_admin());

drop policy if exists "admins edit onboarding checklist steps" on public.staff_onboarding_steps;
create policy "admins edit onboarding checklist steps" on public.staff_onboarding_steps
  for update to authenticated
  using (public.is_active_staff_admin()) with check (public.is_active_staff_admin());

revoke all on public.staff_onboarding_steps from anon;
revoke delete, truncate on public.staff_onboarding_steps from authenticated;
grant select, insert, update on public.staff_onboarding_steps to authenticated;

create or replace function public.staff_onboarding_steps_stamp()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    new.key := old.key;
    new.created_at := old.created_at;
  end if;
  new.title := trim(new.title);
  new.description := nullif(trim(coalesce(new.description, '')), '');
  new.guide_slug := nullif(trim(coalesce(new.guide_slug, '')), '');
  new.updated_at := now();
  new.updated_by := coalesce(lower(auth.jwt() ->> 'email'), new.updated_by);
  return new;
end;
$$;
revoke all on function public.staff_onboarding_steps_stamp() from public, anon, authenticated;

drop trigger if exists staff_onboarding_steps_stamp_trg on public.staff_onboarding_steps;
create trigger staff_onboarding_steps_stamp_trg
  before insert or update on public.staff_onboarding_steps
  for each row execute function public.staff_onboarding_steps_stamp();

create table if not exists public.staff_onboarding_progress (
  staff_email text not null,
  step_key    text not null,
  done_at     timestamptz,
  done_by     text,
  primary key (staff_email, step_key)
);

alter table public.staff_onboarding_progress enable row level security;

drop policy if exists "own or admin reads onboarding progress" on public.staff_onboarding_progress;
create policy "own or admin reads onboarding progress" on public.staff_onboarding_progress
  for select to authenticated
  using (public.is_active_staff()
         and (staff_email = lower(auth.jwt() ->> 'email') or public.is_active_staff_admin()));

drop policy if exists "own or admin adds onboarding progress" on public.staff_onboarding_progress;
create policy "own or admin adds onboarding progress" on public.staff_onboarding_progress
  for insert to authenticated
  with check (public.is_active_staff()
              and (staff_email = lower(auth.jwt() ->> 'email') or public.is_active_staff_admin()));

drop policy if exists "own or admin updates onboarding progress" on public.staff_onboarding_progress;
create policy "own or admin updates onboarding progress" on public.staff_onboarding_progress
  for update to authenticated
  using (public.is_active_staff()
         and (staff_email = lower(auth.jwt() ->> 'email') or public.is_active_staff_admin()))
  with check (public.is_active_staff()
              and (staff_email = lower(auth.jwt() ->> 'email') or public.is_active_staff_admin()));

revoke all on public.staff_onboarding_progress from anon;
revoke delete, truncate on public.staff_onboarding_progress from authenticated;
grant select, insert, update on public.staff_onboarding_progress to authenticated;

-- Lowercases the email, checks the step exists (or is '__dismissed') and the
-- person is staff, freezes the keys on update, and stamps done_by.
create or replace function public.staff_onboarding_progress_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    new.staff_email := old.staff_email;
    new.step_key := old.step_key;
  else
    new.staff_email := lower(trim(new.staff_email));
    if new.step_key <> '__dismissed'
       and not exists (select 1 from staff_onboarding_steps s where s.key = new.step_key) then
      raise exception 'unknown onboarding step' using errcode = '22023';
    end if;
    if not exists (select 1 from staff s where lower(s.email) = new.staff_email) then
      raise exception 'not a staff member' using errcode = '22023';
    end if;
  end if;
  if new.done_at is null then
    new.done_by := null;
  elsif tg_op = 'INSERT' or old.done_at is null then
    new.done_at := now();
    new.done_by := coalesce(lower(auth.jwt() ->> 'email'), new.done_by);
  else
    new.done_at := old.done_at;
    new.done_by := old.done_by;
  end if;
  return new;
end;
$$;
revoke all on function public.staff_onboarding_progress_guard() from public, anon, authenticated;

drop trigger if exists staff_onboarding_progress_guard_trg on public.staff_onboarding_progress;
create trigger staff_onboarding_progress_guard_trg
  before insert or update on public.staff_onboarding_progress
  for each row execute function public.staff_onboarding_progress_guard();
