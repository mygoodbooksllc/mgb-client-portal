-- Client messages: stamp author_name on the server (2026-10-14)
-- Applied to production 2026-10-14.
--
-- Bug: client_messages.author_name came from the browser. RLS already pins
-- author_email (= the JWT email) and author_kind (staff vs client, and
-- internal notes are staff-only), but nothing checked the name, so any staff
-- member or client user could send a message that showed up as being from
-- someone else. notify_enqueue_message copies author_name into the
-- notification_outbox payload, so the staff "new client message" email
-- repeated the forged name. (The client "new message" email names the
-- assigned bookkeeper from clients, not author_name.)
--
-- Fix: BEFORE INSERT trigger client_messages_stamp_author sets author_name
-- from the directory, keyed on the row's author_email (which RLS ties to the
-- JWT for direct inserts, and which trusted SECURITY DEFINER code sets
-- itself: transaction_questions_notify, client_message_loop_in):
--   - author_kind 'staff'  -> staff.name (canonical, see staff-name-canonical.sql);
--                             signed in with no staff name -> the author_email.
--   - author_kind 'client' -> client_users.name for that client_id;
--                             signed in with no name -> null (the inbox then
--                             shows the person's email / thread name).
--   - An author_email that belongs to staff always gets staff.name, even on
--     a client-kind row (staff can add client_users rows, so a name typed
--     there for their own email must not work as a disguise).
--   - Not signed in (no JWT email and JWT role not authenticated/anon:
--     service role, SQL editor, cron): the supplied author_name is kept
--     (trusted backend), as audit_write falls back to 'system' rather than
--     failing.
-- A browser-supplied name is always overwritten, never rejected, so cached
-- old tabs that still send it keep working.
-- BEFORE UPDATE (same trigger): author_email, author_name and author_kind
-- can't change once a message exists (authenticated has no UPDATE grant; this
-- also covers service-role and SECURITY DEFINER updates such as the 24-hour
-- delete, which only sets deleted_at / deleted_by). To correct a name by
-- hand, disable the trigger in the same transaction.
-- Existing rows are not touched.
--
-- Depends on (verified live 2026-10-14): public.client_messages
-- (client-messages.sql, message-delete-24h.sql), public.staff (email, name),
-- public.client_users (email, client_id, name), auth.jwt().
-- Safe to re-run.

begin;

create or replace function public.client_messages_stamp_author()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_jwt_email text := nullif(btrim(auth.jwt() ->> 'email'), '');
  v_jwt_role text := coalesce(auth.jwt() ->> 'role', '');
  v_name text;
  v_staff_name text;
  v_is_staff boolean;
begin
  if tg_op = 'UPDATE' then
    new.author_email := old.author_email;
    new.author_name := old.author_name;
    new.author_kind := old.author_kind;
    return new;
  end if;

  select true, nullif(btrim(s.name), '') into v_is_staff, v_staff_name
    from staff s
   where lower(s.email) = lower(new.author_email)
   order by (s.email = new.author_email) desc
   limit 1;

  if new.author_kind = 'staff' or coalesce(v_is_staff, false) then
    -- A staff email always carries the staff name, even on a client-kind
    -- row: staff can add client_users rows for clients they work on, so a
    -- client_users.name typed for their own email must not become a
    -- disguise ("Jane Doe (Treasurer)").
    v_name := v_staff_name;
  elsif new.author_kind = 'client' then
    select nullif(btrim(cu.name), '') into v_name
      from client_users cu
     where lower(cu.email) = lower(new.author_email)
       and cu.client_id = new.client_id
     order by (cu.email = new.author_email) desc
     limit 1;
  end if;

  if v_name is not null then
    new.author_name := left(v_name, 120);
  elsif v_jwt_email is not null or v_jwt_role in ('authenticated', 'anon') then
    -- Signed in (even with a blank email claim): never keep the browser's label.
    new.author_name := case when new.author_kind = 'staff' or coalesce(v_is_staff, false)
                             then left(new.author_email, 120) end;
  else
    new.author_name := left(new.author_name, 120);
  end if;
  return new;
end;
$$;

-- Trigger functions never check the caller's EXECUTE privilege; revoking it
-- just removes the PostgREST RPC surface (see audit-hardening-function-grants.sql).
revoke all on function public.client_messages_stamp_author() from public, anon, authenticated;

drop trigger if exists client_messages_stamp_author on public.client_messages;
create trigger client_messages_stamp_author
  before insert or update on public.client_messages
  for each row execute function public.client_messages_stamp_author();

commit;
