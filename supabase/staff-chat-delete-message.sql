-- Delete a Team Chat message (2026-10-06).
--
-- SUPERSEDED the same day by message-delete-24h.sql: delete is now limited to
-- 24 hours after sending and a deleted message disappears completely (no
-- placeholder). Re-running this file would drop the 24 hour check; run
-- message-delete-24h.sql after it.
--
-- The author of a message can delete it at any age. It's a soft delete: the
-- row stays, deleted_at / deleted_by are stamped and the text is cleared, and
-- everyone in the conversation sees "This message was deleted" in its place.
-- Attachment columns are left as they are (the app hides the file on a
-- deleted message; the object stays in the staff-chat-attachments bucket).
--
-- Why an RPC: the "author edits within 15m" UPDATE policy only covers the
-- first 15 minutes, and widening it would let authors rewrite old messages.
-- delete_staff_message() can only ever do this one thing.
--
-- Once deleted, a message is locked: a trigger refuses any further update,
-- so it can't be un-deleted or edited back in through the 15 minute policy.
--
-- Realtime: the update is an ordinary UPDATE on staff_messages, so the
-- existing postgres_changes subscription picks it up like an edit.
--
-- Applied to production 2026-10-06. Builds on staff-chat-v2.sql and
-- staff-chat-groups.sql. Safe to re-run.

begin;

alter table public.staff_messages
  add column if not exists deleted_by text;

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
  update staff_messages
     set deleted_at = now(),
         deleted_by = v_email,
         text = null
   where id = p_id;
end;
$$;
revoke all on function public.delete_staff_message(uuid) from public, anon;
grant execute on function public.delete_staff_message(uuid) to authenticated;

create or replace function public.staff_messages_lock_deleted()
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

drop trigger if exists staff_messages_lock_deleted on public.staff_messages;
create trigger staff_messages_lock_deleted
  before update on public.staff_messages
  for each row execute function public.staff_messages_lock_deleted();

commit;
