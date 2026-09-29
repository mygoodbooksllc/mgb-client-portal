-- Assigned bookkeeper linked to a real staff member (owner request 2026-09-29).
--
-- Applied to production 2026-09-29 as migration assigned_bookkeeper_email.
-- Safe to re-run. Needs clients-roster.sql, staff-schema.sql and
-- staff-client-access.sql first.
--
-- clients.assigned_bookkeeper is display JSON ({name, role, initials}) typed
-- by hand on the Client Roster page, so nothing could reliably tell which
-- staff member it meant. clients.assigned_bookkeeper_email now references
-- staff(email) and is the source of truth; the JSON column stays for
-- backward compatibility (older readers, the client-facing "your bookkeeper"
-- card) and is kept in step by the trigger below.
--
-- Relationship with staff_client_access (the table that actually grants a
-- staffer access to a client through RLS / visibleClients):
--   * the assigned bookkeeper is always one of the people with access:
--     setting assigned_bookkeeper_email inserts their staff_client_access row
--     if it's missing;
--   * removing that person's staff_client_access row (Team page, Staff
--     Access, offboarding) clears assigned_bookkeeper_email, since a
--     bookkeeper who can't open the client can't be its bookkeeper;
--   * other people can still have access without being "the" bookkeeper.
--
-- Backfill (2026-09-29): exact, case-insensitive match of
-- assigned_bookkeeper->>'name' to an active staff.name. Nothing matched on
-- production: the three test clients name "Marcus Webb" (basic-test,
-- new-hope) and "Alicia Fenwick" (grace-community), sample names with no
-- staff row. Those keep their display name and a null email until an admin
-- picks a real person.

begin;

alter table public.clients
  add column if not exists assigned_bookkeeper_email text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'clients_assigned_bookkeeper_email_fkey') then
    alter table public.clients
      add constraint clients_assigned_bookkeeper_email_fkey
      foreign key (assigned_bookkeeper_email) references public.staff(email)
      on update cascade on delete set null;
  end if;
end;
$$;

create index if not exists clients_assigned_bookkeeper_email_idx
  on public.clients (assigned_bookkeeper_email);

-- Keep the email lower-case and the display JSON in step with the staff row.
create or replace function public.clients_bookkeeper_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  new.assigned_bookkeeper_email := lower(nullif(trim(new.assigned_bookkeeper_email), ''));
  if tg_op = 'UPDATE' and new.assigned_bookkeeper_email is not distinct from old.assigned_bookkeeper_email then
    return new;
  end if;
  if new.assigned_bookkeeper_email is null then
    -- Explicitly unassigned (was set before): drop the stale display name.
    if tg_op = 'UPDATE' and old.assigned_bookkeeper_email is not null then
      new.assigned_bookkeeper := null;
    end if;
    return new;
  end if;
  select s.name into v_name from staff s where s.email = new.assigned_bookkeeper_email;
  v_name := coalesce(nullif(trim(v_name), ''), split_part(new.assigned_bookkeeper_email, '@', 1));
  new.assigned_bookkeeper := coalesce(new.assigned_bookkeeper, '{}'::jsonb)
    || jsonb_build_object(
         'name', v_name,
         'email', new.assigned_bookkeeper_email,
         'role', coalesce(nullif(new.assigned_bookkeeper ->> 'role', ''), 'Bookkeeper'),
         'initials', upper(left(split_part(v_name, ' ', 1), 1) || left(split_part(v_name, ' ', 2), 1)));
  return new;
end;
$$;

drop trigger if exists clients_bookkeeper_before_write on public.clients;
create trigger clients_bookkeeper_before_write
  before insert or update of assigned_bookkeeper_email, assigned_bookkeeper on public.clients
  for each row execute function public.clients_bookkeeper_before_write();

-- The assigned bookkeeper always has access to the client.
create or replace function public.clients_bookkeeper_after_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.assigned_bookkeeper_email is not null
     and (tg_op = 'INSERT' or new.assigned_bookkeeper_email is distinct from old.assigned_bookkeeper_email) then
    insert into staff_client_access (staff_email, client_id)
    values (new.assigned_bookkeeper_email, new.id)
    on conflict do nothing;
  end if;
  return null;
end;
$$;

drop trigger if exists clients_bookkeeper_after_write on public.clients;
create trigger clients_bookkeeper_after_write
  after insert or update of assigned_bookkeeper_email on public.clients
  for each row execute function public.clients_bookkeeper_after_write();

-- Losing access means no longer being the assigned bookkeeper.
create or replace function public.sca_clear_assigned_bookkeeper()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update clients set assigned_bookkeeper_email = null
   where id = old.client_id and assigned_bookkeeper_email = lower(old.staff_email);
  return null;
end;
$$;

drop trigger if exists sca_clear_assigned_bookkeeper on public.staff_client_access;
create trigger sca_clear_assigned_bookkeeper
  after delete on public.staff_client_access
  for each row execute function public.sca_clear_assigned_bookkeeper();

-- Trigger functions only; nobody calls these directly.
revoke execute on function public.clients_bookkeeper_before_write() from public, anon, authenticated;
revoke execute on function public.clients_bookkeeper_after_write() from public, anon, authenticated;
revoke execute on function public.sca_clear_assigned_bookkeeper() from public, anon, authenticated;

-- Backfill: exact, case-insensitive name match to one active staff member.
update public.clients c
   set assigned_bookkeeper_email = s.email
  from public.staff s
 where c.assigned_bookkeeper_email is null
   and s.active
   and nullif(trim(c.assigned_bookkeeper ->> 'name'), '') is not null
   and lower(trim(s.name)) = lower(trim(c.assigned_bookkeeper ->> 'name'))
   and (select count(*) from public.staff s2
         where s2.active and lower(trim(s2.name)) = lower(trim(c.assigned_bookkeeper ->> 'name'))) = 1;

commit;
