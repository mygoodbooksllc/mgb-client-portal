-- Tasks + notes v3: categorised dated notes, note -> task linking, and a
-- server-side "complete this item" that works for shared recurring tasks.
--
-- Builds on client-private-notes.sql, client-notes.sql,
-- staff-reminders-v2.sql, and audit-hardening-client-scoping.sql
-- (can_access_client()). Run those first.
--
-- Safe to re-run: `add column if not exists`, constraints dropped before
-- being recreated, `create or replace function`, and guarded publication adds.
--
-- What this does:
--   1. client_private_notes.category ('general' | 'status' | 'handoff' |
--      'call' | 'meeting') and linked_task_id -> staff_reminders(id), set null
--      when the task is deleted. Existing policy ("staff manage private
--      notes": can_access_client(client_id) for ALL) is unchanged, so anyone
--      who can access the client can edit, pin, link, or delete a note.
--   2. client_private_notes and client_notes join the realtime publication,
--      so My Tasks, Home, and Client details refresh when a teammate edits.
--   3. complete_staff_item(p_id, p_done, p_today): the one way to check an item
--      off. It fixes a gap in v2: a teammate completing a SHARED recurring
--      task couldn't insert the next occurrence, because RLS only lets the
--      owner insert rows as themselves. The function checks the caller could
--      update the row under the v2 policies, then inserts the next occurrence
--      as the ORIGINAL owner.

-- ---------------------------------------------------------------------------
-- 1. client_private_notes: category + linked task
-- ---------------------------------------------------------------------------

alter table client_private_notes
  add column if not exists category text not null default 'general',
  add column if not exists linked_task_id uuid;

alter table client_private_notes drop constraint if exists client_private_notes_category_check;
alter table client_private_notes
  add constraint client_private_notes_category_check
  check (category in ('general', 'status', 'handoff', 'call', 'meeting'));

alter table client_private_notes drop constraint if exists client_private_notes_linked_task_id_fkey;
alter table client_private_notes
  add constraint client_private_notes_linked_task_id_fkey
  foreign key (linked_task_id) references staff_reminders(id) on delete set null;

create index if not exists client_private_notes_client_created_idx
  on client_private_notes (client_id, created_at desc);
create index if not exists client_private_notes_linked_task_idx
  on client_private_notes (linked_task_id)
  where linked_task_id is not null;

-- ---------------------------------------------------------------------------
-- 2. Realtime (RLS still applies per subscriber; the app listens on a
--    private channel like staff_reminders does)
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    return;
  end if;
  foreach t in array array['client_private_notes', 'client_notes'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. complete_staff_item
-- ---------------------------------------------------------------------------
--
-- Permission: the caller may act only if they could UPDATE the row under the
-- staff_reminders policies, i.e.
--   * they own it (staff_email = jwt email), OR
--   * it is shared, has a client, is_active_staff(), and
--     can_access_client(client_id).
-- Anyone else gets "not found" (same answer as a missing row, so it doesn't
-- reveal private rows exist).
--
-- Date rules match the app's nextRecurrenceYmd():
--   daily +1 day, weekly +7 days, monthly same day next month clamped to the
--   month's length, month_end last day of next month. The next date keeps
--   moving forward until it is on/after "today" so an overdue series doesn't
--   spawn another overdue row. p_today is the caller's local date (the app
--   passes it); it defaults to the server's current_date.
--
-- due_at: the date-only sentinel (midnight UTC of due_date) stays a sentinel
-- on the new date; a real time is shifted by the same number of days.
-- remind_at is shifted by the same number of days as the due date.
--
-- The finished row gets recurrence = 'none' so un-checking and re-checking it
-- can't spawn a duplicate; the series (recurrence) moves to the new row.
-- Returns the new row's id, or null when nothing was spawned.

create or replace function public.complete_staff_item(
  p_id uuid,
  p_done boolean,
  p_today date default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller text := coalesce(auth.jwt() ->> 'email', '');
  v_row staff_reminders%rowtype;
  v_today date := coalesce(p_today, current_date);
  v_base date;
  v_next date;
  v_days int;
  v_due_at timestamptz;
  v_remind_at timestamptz;
  v_new_id uuid;
  i int := 0;
begin
  if v_caller = '' then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select * into v_row from staff_reminders where id = p_id for update;
  if not found
     or not (
       v_row.staff_email = v_caller
       or (
         v_row.visibility = 'shared'
         and v_row.client_id is not null
         and public.is_active_staff()
         and public.can_access_client(v_row.client_id)
       )
     ) then
    raise exception 'item not found' using errcode = 'P0002';
  end if;

  -- Un-checking, or checking a one-off item: just flip it.
  if not p_done or coalesce(v_row.recurrence, 'none') = 'none' or v_row.done then
    update staff_reminders
      set done = p_done,
          completed_at = case when p_done then coalesce(completed_at, now()) else null end
      where id = p_id;
    return null;
  end if;

  update staff_reminders
    set done = true, completed_at = now(), recurrence = 'none'
    where id = p_id;

  v_base := coalesce(v_row.due_date, v_today);
  v_next := v_base;
  loop
    v_next := case v_row.recurrence
      when 'daily' then v_next + 1
      when 'weekly' then v_next + 7
      when 'monthly' then
        -- same day next month, clamped (Jan 31 -> Feb 28/29)
        (date_trunc('month', v_next) + interval '1 month')::date
          + least(
              extract(day from v_next)::int,
              extract(day from (date_trunc('month', v_next) + interval '2 month' - interval '1 day'))::int
            ) - 1
      when 'month_end' then
        (date_trunc('month', v_next) + interval '2 month' - interval '1 day')::date
      else null
    end;
    exit when v_next is null or v_next >= v_today;
    i := i + 1;
    exit when i >= 400;
  end loop;

  if v_next is null then
    return null;
  end if;

  v_days := v_next - v_base;

  if v_row.due_at is null then
    v_due_at := v_next::timestamp at time zone 'UTC';
  elsif v_row.due_date is not null
        and v_row.due_at = (v_row.due_date::timestamp at time zone 'UTC') then
    v_due_at := v_next::timestamp at time zone 'UTC';
  else
    v_due_at := v_row.due_at + make_interval(days => v_days);
  end if;

  v_remind_at := case when v_row.remind_at is null then null
                      else v_row.remind_at + make_interval(days => v_days) end;

  insert into staff_reminders (
    staff_email, text, due_date, due_at, remind_at, client_id, priority,
    kind, recurrence, assignee_email, created_by, visibility, source, source_ref
  ) values (
    v_row.staff_email, v_row.text, v_next, v_due_at, v_remind_at,
    v_row.client_id, v_row.priority, v_row.kind, v_row.recurrence,
    coalesce(v_row.assignee_email, v_row.staff_email),
    coalesce(v_row.created_by, v_row.staff_email),
    v_row.visibility, v_row.source, v_row.source_ref
  )
  returning id into v_new_id;

  return v_new_id;
end;
$$;

revoke all on function public.complete_staff_item(uuid, boolean, date) from public, anon;
grant execute on function public.complete_staff_item(uuid, boolean, date) to authenticated;
