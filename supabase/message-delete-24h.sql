-- Delete a message within 24 hours, and it disappears completely
-- (owner decision 2026-10-06). Applied to production 2026-10-06 as migration
-- message_delete_24h.
--
-- Replaces the "delete at any age, leave a 'This message was deleted'
-- placeholder" rule from staff-chat-delete-message.sql, and adds the same
-- Delete to the client <-> staff Messages thread (client_messages).
--
-- Both tables: the author of a message can delete it for 24 hours after
-- sending. It's still a soft delete: the row stays, deleted_at / deleted_by
-- are stamped and the text is cleared. The apps filter deleted rows out of
-- every read (threads, previews, unread counts, Seen, the bell, search), so
-- for everyone it's as if the message was never sent. Attachment columns and
-- storage objects are left as they are. Once deleted, a row is locked by a
-- trigger: it can't be edited or un-deleted.
--
-- Team chat (staff_messages): delete_staff_message() now refuses a message
-- older than 24 hours. Author and member checks are unchanged.
--
-- Client messages (client_messages): new deleted_at / deleted_by columns and
-- delete_client_message(p_id). The caller must be the author (author_email
-- matches their JWT email) and still have access: active staff with
-- can_access_client() for a staff message or internal note, or the client
-- user whose own thread it is (is_client_member) for a client message. Any
-- notification email still queued for the message is skipped, so nobody is
-- emailed about a message that no longer exists. client_team_profiles()
-- ignores deleted messages, so a deleted reply doesn't add its author to the
-- client's team list.
--
-- RLS: the client SELECT policy is deliberately left as it is. A deleted
-- row's text is already cleared, and adding "deleted_at is null" there would
-- stop Realtime delivering the delete itself to the client (Realtime checks
-- the new row against RLS), so their open thread would keep showing the
-- message until it reloaded.
--
-- Realtime: both deletes are ordinary UPDATEs on tables already in the
-- supabase_realtime publication; the apps listen for UPDATE as well as INSERT.
--
-- Builds on staff-chat-delete-message.sql, client-messages.sql,
-- notification-emails.sql and account-manager.sql. Safe to re-run.

begin;

-- ---------------------------------------------------------------------------
-- Team chat: 24 hour limit
-- ---------------------------------------------------------------------------
create or replace function public.delete_staff_message(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := auth.jwt() ->> 'email';
  v_msg staff_messages%rowtype;
begin
  select * into v_msg from staff_messages where id = p_id;
  if not found
     or v_email is null
     or v_msg.author_email <> v_email
     or not public.is_conversation_member(v_msg.conversation_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_msg.deleted_at is not null then
    return;
  end if;
  if v_msg.created_at < now() - interval '24 hours' then
    raise exception 'You can only delete a message within 24 hours of sending it.'
      using errcode = '42501';
  end if;
  update staff_messages
     set deleted_at = now(),
         deleted_by = v_email,
         text = null
   where id = p_id;
end;
$$;
revoke all on function public.delete_staff_message(uuid) from public, anon;
grant execute on function public.delete_staff_message(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Client messages: soft delete columns
-- ---------------------------------------------------------------------------
alter table public.client_messages
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by text;

-- A deleted message has no text (and may have no attachment).
alter table public.client_messages drop constraint if exists client_messages_check;
alter table public.client_messages add constraint client_messages_check
  check (deleted_at is not null or length(body) > 0 or attachment_path is not null);

create or replace function public.delete_client_message(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(auth.jwt() ->> 'email');
  v_msg client_messages%rowtype;
begin
  select * into v_msg from client_messages where id = p_id;
  if not found
     or v_email is null
     or lower(v_msg.author_email) <> v_email
     or not (
       (v_msg.author_kind = 'staff'
         and public.is_active_staff()
         and public.can_access_client(v_msg.client_id))
       or (v_msg.author_kind = 'client'
         and not v_msg.internal
         and v_msg.participant_email = v_email
         and public.is_client_member(v_msg.client_id))
     ) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_msg.deleted_at is not null then
    return;
  end if;
  if v_msg.created_at < now() - interval '24 hours' then
    raise exception 'You can only delete a message within 24 hours of sending it.'
      using errcode = '42501';
  end if;
  update client_messages
     set deleted_at = now(),
         deleted_by = v_email,
         body = ''
   where id = p_id;
  -- Don't email anyone about it if the 5-minute notification run hasn't
  -- picked it up yet.
  update notification_outbox
     set processed_at = now(),
         status = 'skipped',
         reason = 'message deleted'
   where ref_id = p_id::text
     and processed_at is null
     and kind in ('staff_client_message', 'client_message');
end;
$$;
revoke all on function public.delete_client_message(uuid) from public, anon;
grant execute on function public.delete_client_message(uuid) to authenticated;

create or replace function public.client_messages_lock_deleted()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.deleted_at is not null then
    raise exception 'this message was deleted' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists client_messages_lock_deleted on public.client_messages;
create trigger client_messages_lock_deleted
  before update on public.client_messages
  for each row execute function public.client_messages_lock_deleted();

-- ---------------------------------------------------------------------------
-- client_team_profiles: a deleted reply doesn't count (otherwise as in
-- account-manager.sql)
-- ---------------------------------------------------------------------------
create or replace function public.client_team_profiles(p_client_id text)
returns table(email text, name text, title text, phone text, photo_path text, is_account_manager boolean, is_bookkeeper boolean)
language sql
stable security definer
set search_path = public
as $$
  with c as (
    select cl.id, lower(cl.account_manager_email) as am, lower(cl.assigned_bookkeeper_email) as bk
    from clients cl
    where cl.id = p_client_id
      and (
        public.is_client_member(cl.id)
        or (public.is_active_staff() and public.can_access_client(cl.id))
      )
  ),
  people as (
    select c.am as email from c where c.am is not null
    union
    select c.bk from c where c.bk is not null
    union
    select lower(m.author_email)
    from client_messages m, c
    where m.client_id = c.id
      and m.author_kind = 'staff'
      and not m.internal
      and m.deleted_at is null
      and (
        m.participant_email = lower(auth.jwt() ->> 'email')
        or (public.is_active_staff() and public.can_access_client(c.id))
      )
  )
  select s.email,
         coalesce(p.display_name, s.name) as name,
         p.title, p.phone, p.photo_path,
         s.email = c.am as is_account_manager,
         s.email = c.bk as is_bookkeeper
  from people x
  cross join c
  join staff s on s.email = x.email
  left join staff_profiles p on p.email = s.email
  where s.active or s.email in (c.am, c.bk);
$$;

commit;
