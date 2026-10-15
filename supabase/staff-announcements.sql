-- Launch announcements for staff (owner request 2026-10-15): when something
-- new ships, each staffer gets one quiet notice and a 1-minute tour the next
-- time they visit. The registry of launches lives in the app
-- (components/tour/announcements.js); this file only holds each person's
-- answer. Applied 2026-10-15. Safe to re-run.
--
-- Needs staff-schema.sql, access-requests.sql (is_active_staff()) and
-- staff-admin-policies.sql (is_active_staff_admin()) first.
--
-- 1. public.staff_announcements: one row per (staffer, announcement id).
--      status        seen | later | toured | dismissed
--                    seen = shown and ignored (it comes back next visit);
--                    later = "Later" pressed (comes back next visit, at most
--                    3 times, then the app counts it as dismissed);
--                    toured = finished or skipped the tour; dismissed = Skip.
--      later_count   how many times Later was pressed (0 to 3).
--      first_seen_at when the notice first showed. Never changes.
--    The key column is stamped from the JWT email by a guard trigger, so a
--    staffer can only ever write their own rows. The browser keeps a
--    localStorage copy only to avoid a flicker; this table always wins.
-- 2. staff_announcement_report(): admins only. One row per active staffer per
--    announcement they have a row for (a staffer with none appears once with
--    a null announcement_id), for the Usage Stats "Announcements" card.

create table if not exists public.staff_announcements (
  staff_email text not null default lower(auth.jwt() ->> 'email'),
  announcement_id text not null check (announcement_id ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  status text not null default 'seen' check (status in ('seen', 'later', 'toured', 'dismissed')),
  later_count integer not null default 0 check (later_count between 0 and 3),
  first_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (staff_email, announcement_id)
);

create or replace function public.staff_announcements_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.staff_email := lower(auth.jwt() ->> 'email');
    if new.staff_email is null or new.staff_email = '' then
      raise exception 'staff_announcements: no signed-in email';
    end if;
  else
    -- A row never changes owner, id or first-seen time.
    new.staff_email := old.staff_email;
    new.announcement_id := old.announcement_id;
    new.first_seen_at := old.first_seen_at;
    -- A late or stale save (an offline retry, a second tab) never takes an
    -- answer back: Later counts only go up, and a finished or skipped
    -- notice stays that way.
    new.later_count := greatest(old.later_count, new.later_count);
    if old.status in ('toured', 'dismissed') and new.status in ('seen', 'later') then
      new.status := old.status;
    end if;
    if old.status = 'toured' then
      new.status := 'toured';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function public.staff_announcements_guard() from public, anon, authenticated;

drop trigger if exists staff_announcements_guard on public.staff_announcements;
create trigger staff_announcements_guard
  before insert or update on public.staff_announcements
  for each row execute function public.staff_announcements_guard();

alter table public.staff_announcements enable row level security;

drop policy if exists "own announcements select" on public.staff_announcements;
create policy "own announcements select" on public.staff_announcements
  for select to authenticated
  using (public.is_active_staff() and staff_email = lower(auth.jwt() ->> 'email'));
drop policy if exists "own announcements insert" on public.staff_announcements;
create policy "own announcements insert" on public.staff_announcements
  for insert to authenticated
  with check (public.is_active_staff() and staff_email = lower(auth.jwt() ->> 'email'));
drop policy if exists "own announcements update" on public.staff_announcements;
create policy "own announcements update" on public.staff_announcements
  for update to authenticated
  using (public.is_active_staff() and staff_email = lower(auth.jwt() ->> 'email'))
  with check (public.is_active_staff() and staff_email = lower(auth.jwt() ->> 'email'));

-- No delete: a staffer's answer is a record. Nothing for anon.
revoke all on public.staff_announcements from public, anon;
revoke truncate, delete, references, trigger on public.staff_announcements from authenticated;
grant select, insert, update on public.staff_announcements to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Admin report
-- ---------------------------------------------------------------------------
create or replace function public.staff_announcement_report()
returns table (
  staff_email text,
  staff_name text,
  staff_role text,
  staff_created_at timestamptz,
  announcement_id text,
  status text,
  later_count integer,
  first_seen_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_active_staff_admin() then
    raise exception 'staff_announcement_report: admins only' using errcode = '42501';
  end if;
  return query
    select lower(s.email), s.name, s.role, s.created_at,
           a.announcement_id, a.status, a.later_count, a.first_seen_at, a.updated_at
      from public.staff s
      left join public.staff_announcements a on a.staff_email = lower(s.email)
     where s.active
     order by s.name, a.announcement_id;
end;
$$;
revoke all on function public.staff_announcement_report() from public, anon;
grant execute on function public.staff_announcement_report() to authenticated;
