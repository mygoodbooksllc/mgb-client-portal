-- My Tasks v2: tasks + reminders, due times, recurrence, and opt-in sharing
-- with a client's team.
--
-- Builds on staff-reminders.sql (the table + "staff manage own reminders"),
-- access-requests.sql / client-notes.sql (is_active_staff()) and
-- audit-hardening-client-scoping.sql (can_access_client()). Run those first.
--
-- Safe to re-run: every column is `add column if not exists`, every
-- constraint/policy/trigger is dropped-if-exists before being recreated, and
-- the backfills only touch rows that are still null.
--
-- Owner decisions encoded here:
--   * Items are PRIVATE by default. Only the owner (staff_email) sees a
--     private row -- admins included. Unchanged from v1.
--   * An item can be flipped to visibility = 'shared', which requires a
--     client_id. Any ACTIVE staffer who can_access_client(client_id) -- the
--     client's assigned staff, plus admins (can_access_client already returns
--     true for them) -- can then read it and check it off.
--   * Client-portal users get nothing: is_active_staff() is false for them
--     and they have no staff_client_access rows.
--
-- The app keeps writing due_date alongside due_at so older code paths
-- (Home's reminders card before this ships, submit_access_request) keep
-- working; the trigger below also keeps the two in sync for any writer that
-- only sets one of them.
--
-- Convention for due_at: a date-only item is stored at midnight UTC of its
-- due_date (that's also what the backfill writes). The app treats an exact
-- 00:00:00 UTC due_at as "no time set" and nudges a user-picked time that
-- happens to land exactly on midnight UTC by one second.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

alter table staff_reminders
  add column if not exists kind text not null default 'task',
  add column if not exists due_at timestamptz,
  add column if not exists remind_at timestamptz,
  add column if not exists recurrence text not null default 'none',
  add column if not exists assignee_email text,
  add column if not exists created_by text,
  add column if not exists visibility text not null default 'private',
  add column if not exists source text not null default 'manual',
  add column if not exists source_ref text;

alter table staff_reminders drop constraint if exists staff_reminders_kind_check;
alter table staff_reminders
  add constraint staff_reminders_kind_check
  check (kind in ('task', 'reminder'));

alter table staff_reminders drop constraint if exists staff_reminders_recurrence_check;
alter table staff_reminders
  add constraint staff_reminders_recurrence_check
  check (recurrence in ('none', 'daily', 'weekly', 'monthly', 'month_end'));

alter table staff_reminders drop constraint if exists staff_reminders_visibility_check;
alter table staff_reminders
  add constraint staff_reminders_visibility_check
  check (visibility in ('private', 'shared'));

-- Sharing is "with this client's team", so a shared item needs a client.
alter table staff_reminders drop constraint if exists staff_reminders_shared_needs_client;
alter table staff_reminders
  add constraint staff_reminders_shared_needs_client
  check (visibility = 'private' or client_id is not null);

-- ---------------------------------------------------------------------------
-- Backfills (only rows still null / still at the default)
-- ---------------------------------------------------------------------------

update staff_reminders
  set due_at = (due_date::timestamp at time zone 'UTC')
  where due_at is null and due_date is not null;

update staff_reminders set assignee_email = staff_email where assignee_email is null;
update staff_reminders set created_by = staff_email where created_by is null;

-- Reminders dropped by submit_access_request (access-request-notify-
-- bookkeeper.sql) before this migration existed.
update staff_reminders
  set source = 'access_request', source_ref = coalesce(source_ref, client_id)
  where source = 'manual' and text like 'New access request from %';

-- ---------------------------------------------------------------------------
-- Write-time trigger: defaults, due_date <-> due_at sync, source tagging,
-- and ownership lock for non-owners editing a shared row.
-- ---------------------------------------------------------------------------

create or replace function public.staff_reminders_before_write()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_caller text := coalesce(auth.jwt() ->> 'email', '');
begin
  if tg_op = 'INSERT' then
    new.assignee_email := coalesce(new.assignee_email, new.staff_email);
    new.created_by := coalesce(new.created_by, nullif(v_caller, ''), new.staff_email);

    -- submit_access_request inserts on a staffer's behalf (security definer,
    -- called by the client), so the caller is never the row's owner. Tag
    -- those without editing that function; a staffer typing the same words
    -- into their own list stays 'manual'.
    if new.source = 'manual'
       and v_caller is distinct from new.staff_email
       and new.text like 'New access request from %' then
      new.source := 'access_request';
      new.source_ref := coalesce(new.source_ref, new.client_id);
    end if;

    if new.due_at is null and new.due_date is not null then
      new.due_at := new.due_date::timestamp at time zone 'UTC';
    elsif new.due_date is null and new.due_at is not null then
      new.due_date := (new.due_at at time zone 'UTC')::date;
    end if;
    return new;
  end if;

  -- UPDATE
  -- Someone other than the owner (a teammate or admin on a shared row) may
  -- work the item -- check it off, reword it, move the date -- but can't
  -- take it over, re-point it at another client, or make it private.
  if v_caller is distinct from old.staff_email then
    new.staff_email := old.staff_email;
    new.created_by := old.created_by;
    new.client_id := old.client_id;
    new.visibility := old.visibility;
  end if;

  -- Old code paths only know due_date; old rows only know due_at after the
  -- backfill. Whichever one changed on its own drags the other along.
  if new.due_date is distinct from old.due_date
     and new.due_at is not distinct from old.due_at then
    new.due_at := case when new.due_date is null then null
                       else new.due_date::timestamp at time zone 'UTC' end;
  elsif new.due_at is distinct from old.due_at
     and new.due_date is not distinct from old.due_date then
    new.due_date := case when new.due_at is null then null
                         else (new.due_at at time zone 'UTC')::date end;
  end if;
  return new;
end;
$$;

drop trigger if exists staff_reminders_before_write on staff_reminders;
create trigger staff_reminders_before_write
  before insert or update on staff_reminders
  for each row execute function public.staff_reminders_before_write();

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------

alter table staff_reminders enable row level security;

-- Owner: full access to their own rows, private or shared (unchanged).
drop policy if exists "staff manage own reminders" on staff_reminders;
create policy "staff manage own reminders"
  on staff_reminders for all
  using (staff_email = auth.jwt() ->> 'email')
  with check (staff_email = auth.jwt() ->> 'email');

-- Team: read + update SHARED rows for clients you can access. Never private
-- rows, never another client's. No insert/delete for non-owners.
drop policy if exists "staff read shared client reminders" on staff_reminders;
create policy "staff read shared client reminders"
  on staff_reminders for select
  to authenticated
  using (
    visibility = 'shared'
    and client_id is not null
    and public.is_active_staff()
    and public.can_access_client(client_id)
  );

drop policy if exists "staff update shared client reminders" on staff_reminders;
create policy "staff update shared client reminders"
  on staff_reminders for update
  to authenticated
  using (
    visibility = 'shared'
    and client_id is not null
    and public.is_active_staff()
    and public.can_access_client(client_id)
  )
  with check (
    visibility = 'shared'
    and client_id is not null
    and public.is_active_staff()
    and public.can_access_client(client_id)
  );

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

create index if not exists staff_reminders_staff_open_idx
  on staff_reminders (staff_email, done, due_date);
create index if not exists staff_reminders_shared_client_idx
  on staff_reminders (client_id)
  where visibility = 'shared';

-- ---------------------------------------------------------------------------
-- Realtime: let My Tasks / Home / the sidebar badge refresh live. Realtime
-- applies the policies above per subscriber, and the app subscribes on a
-- private channel (covered by audit2-realtime-private-channels.sql's
-- "staff read realtime" policy). Guarded so re-running doesn't error.
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'staff_reminders'
     ) then
    alter publication supabase_realtime add table public.staff_reminders;
  end if;
end;
$$;
