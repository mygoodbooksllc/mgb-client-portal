-- Retire and delete Team Chat groups (owner request 2026-09-28).
--
-- Retire: any member of a group can retire it. It drops out of everyone's
-- inbox, keeps its history, and becomes read-only (no new messages). Any
-- member can restore it.
-- Delete: an admin (is_active_staff_admin) can permanently delete a group
-- that is already retired, with its messages and memberships. Files it had
-- attached stay in the staff-chat-attachments bucket (SQL can't remove
-- storage files cleanly); they're unreachable once the conversation is gone.
--
-- DMs can't be retired or deleted. Builds on staff-chat-v2.sql,
-- staff-chat-groups.sql and audit-hardening-chat-membership.sql. Safe to re-run.

begin;

alter table public.staff_conversations
  add column if not exists retired_at timestamptz,
  add column if not exists retired_by text;

-- Retired groups are read-only: the send policy now also requires a live
-- conversation. (Same body as audit-hardening-chat-membership.sql's, plus
-- the retired check.)
create or replace function public.conversation_is_live(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from staff_conversations
    where id = p_conversation_id and retired_at is null
  );
$$;
revoke all on function public.conversation_is_live(uuid) from public, anon;
grant execute on function public.conversation_is_live(uuid) to authenticated;

drop policy if exists "members send messages" on public.staff_messages;
create policy "members send messages" on public.staff_messages
  for insert with check (
    author_email = auth.jwt() ->> 'email'
    and public.is_conversation_member(conversation_id)
    and public.conversation_is_live(conversation_id)
  );

-- Retire (p_retire = true) or restore (false). Members only, groups only.
create or replace function public.set_staff_group_retired(p_id uuid, p_retire boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.is_active_staff() and public.is_conversation_member(p_id)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from staff_conversations where id = p_id and is_group) then
    raise exception 'only groups can be retired' using errcode = '22023';
  end if;
  update staff_conversations
     set retired_at = case when p_retire then now() else null end,
         retired_by = case when p_retire then auth.jwt() ->> 'email' else null end
   where id = p_id;
end;
$$;
revoke all on function public.set_staff_group_retired(uuid, boolean) from public, anon;
grant execute on function public.set_staff_group_retired(uuid, boolean) to authenticated;

-- Permanent delete: admins only, and only a group that's already retired.
create or replace function public.delete_staff_group(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_active_staff_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not exists (
    select 1 from staff_conversations
    where id = p_id and is_group and retired_at is not null
  ) then
    raise exception 'retire the group before deleting it' using errcode = '22023';
  end if;
  delete from staff_messages where conversation_id = p_id;
  delete from staff_conversation_members where conversation_id = p_id;
  delete from staff_conversations where id = p_id;
end;
$$;
revoke all on function public.delete_staff_group(uuid) from public, anon;
grant execute on function public.delete_staff_group(uuid) to authenticated;

commit;
