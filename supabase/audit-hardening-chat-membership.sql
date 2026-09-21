-- Audit hardening, batch 2b: close the Team Chat private-DM hole.
-- APPLIED LIVE via Supabase MCP apply_migration, in three steps
-- (`scope_chat_membership_and_attachments`,
--  `fix_membership_seed_check_to_bypass_rls`,
--  `seed_check_requires_no_message_history`).
-- This file is the FINAL state, with the wrong intermediate step documented
-- below because the mistake is worth not repeating.
--
-- The exploit
-- -----------
-- Three statements, available to any active bookkeeper with no admin rights
-- and no client assignments:
--
--   1. select * from staff_conversation_members
--        The SELECT policy was a bare is_active_staff(), so this returned
--        every conversation id in the firm and who was in it. Pick the
--        admins' DM.
--
--   2. insert into staff_conversation_members (conversation_id, staff_email)
--      values ('<that conversation>', '<my own email>')
--        The INSERT policy's "staff_email = auth.jwt() ->> 'email'" branch
--        passed this. The policy's comment described the intent as "a staff
--        member may only insert their own membership row" — but inserting
--        YOUR OWN row into SOMEONE ELSE'S conversation is precisely the
--        attack. Nothing checked that the caller had any relationship to the
--        target conversation.
--
--   3. is_conversation_member() now returns true, so "members read messages"
--      hands over the complete history of that DM, attachments included.
--
-- A second, independent path: the UPDATE policy pinned staff_email but not
-- conversation_id, so an existing membership row of your own could simply be
-- re-homed onto any target conversation.
--
-- THE TRAP (worth reading before editing any policy in this file)
-- --------------------------------------------------------------
-- The first attempt at the fix wrote the "is this conversation new?" test as
-- an inline subquery:
--
--   with check (is_active_staff() and not exists (
--     select 1 from staff_conversation_members m
--     where m.conversation_id = staff_conversation_members.conversation_id))
--
-- That does not work, and it fails OPEN. A subquery inside a policy expression
-- is itself subject to that table's RLS. Since the SELECT policy is now
-- is_conversation_member(conversation_id), an attacker who is not yet a member
-- sees ZERO rows from that subquery, `not exists` evaluates to TRUE, and the
-- insert is permitted — the original exploit still worked while appearing
-- fixed. Any existence check inside a policy has to go through a SECURITY
-- DEFINER function, the same way is_conversation_member() already does.
-- Verified empirically against a faithful mirror of this table before and
-- after the correction.

-- (1) Stop the free enumeration that makes step 1 of the exploit cost nothing.
-- Compatible with every existing query in app.jsx: loadConversations filters
-- on staff_email = me and then .in()s over those same conversation ids,
-- loadMessages reads the members of the active conversation, and markRead
-- updates the caller's own row — all of them conversations the caller belongs
-- to.
drop policy if exists "active staff read memberships" on staff_conversation_members;
create policy "members read memberships" on staff_conversation_members
  for select using (public.is_conversation_member(conversation_id));

-- (2) A conversation is seedable only while it has neither members nor
-- messages.
--
-- "No members" alone is not enough: staff_conversation_members still carries a
-- DELETE policy, so both sides of a DM could remove themselves, leaving a
-- member-less conversation with a full message history that anyone could then
-- seed themselves into. (The app never deletes membership rows today — every
-- call site is a select, insert, or last_read_at update — so that path is
-- latent, but the policy should not depend on that staying true.)
--
-- This is compatible with how conversations are actually created: both
-- openWith() (1:1 DM) and createGroup() insert every member row in a SINGLE
-- multi-row INSERT. A STABLE SECURITY DEFINER function uses the calling
-- query's snapshot, which does not include rows being inserted by that same
-- statement, so all rows in the batch see an unused conversation and pass,
-- while a later insert into a populated one is rejected. Both halves were
-- verified before applying.
create or replace function public.conversation_is_unused(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
      select 1 from staff_conversation_members m
      where m.conversation_id = p_conversation_id
    )
    and not exists (
      select 1 from staff_messages msg
      where msg.conversation_id = p_conversation_id
    );
$$;

grant execute on function public.conversation_is_unused(uuid) to anon, authenticated;

-- Used by the staff_conversations read policy below, which needs "has anyone
-- joined yet" rather than the stricter "never used" test.
create or replace function public.conversation_has_members(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from staff_conversation_members m
    where m.conversation_id = p_conversation_id
  );
$$;

grant execute on function public.conversation_has_members(uuid) to anon, authenticated;

drop policy if exists "active staff create memberships" on staff_conversation_members;
drop policy if exists "seed memberships on new conversations" on staff_conversation_members;
create policy "seed memberships on new conversations" on staff_conversation_members
  for insert with check (
    public.is_active_staff()
    and public.conversation_is_unused(conversation_id)
  );

-- (3) Pin conversation_id on update. This path exists for read receipts
-- (markRead sets last_read_at on the caller's own row); it must not be usable
-- to move that row into a conversation the caller is not in.
drop policy if exists "self update own membership" on staff_conversation_members;
create policy "self update own membership" on staff_conversation_members
  for update
  using (staff_email = auth.jwt() ->> 'email')
  with check (
    staff_email = auth.jwt() ->> 'email'
    and public.is_conversation_member(conversation_id)
  );

-- (4) staff_conversations read policy had the same inline-subquery-under-RLS
-- flaw. Its "or the conversation has no members" escape hatch exists so an
-- INSERT ... .select() can read back a conversation it just created, before
-- the member rows exist — but written inline it meant a non-member saw zero
-- member rows, the test passed, and every conversation row in the firm
-- (including group titles) was readable.
drop policy if exists "active staff read conversations" on staff_conversations;
create policy "active staff read conversations" on staff_conversations
  for select using (
    public.is_active_staff()
    and (
      public.is_conversation_member(id)
      or not public.conversation_has_members(id)
    )
  );

-- (5) staff_messages UPDATE validated only the author, never the columns. A
-- message could be re-homed into a DM the author is not in
-- (set conversation_id = ...), or have its 15-minute edit window made
-- permanent (set created_at = now() + interval '1 year').
drop policy if exists "author edits within 15m" on staff_messages;
create policy "author edits within 15m" on staff_messages
  for update
  using (
    author_email = auth.jwt() ->> 'email'
    and created_at > now() - interval '15 minutes'
  )
  with check (
    author_email = auth.jwt() ->> 'email'
    and created_at > now() - interval '15 minutes'
    and public.is_conversation_member(conversation_id)
  );

-- (6) Chat attachments. The bucket is private and the app mints short-lived
-- signed URLs at render time (both correct, from the earlier C1 fix), but the
-- storage policy checked only "are you staff", not "are you in this
-- conversation" — and SELECT on storage.objects also permits LISTING. So any
-- bookkeeper could list '<any conversation id>' and then sign and download
-- every file ever attached to any internal DM.
--
-- Upload paths are '<conversation_id>/<timestamp>-<sanitised name>', so the
-- conversation id is the first path segment. The helper parses it defensively
-- rather than casting inline: a malformed or legacy object name returns false
-- instead of raising, which would otherwise error the entire policy
-- evaluation.
create or replace function public.chat_attachment_member(p_object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_conv uuid;
begin
  begin
    v_conv := split_part(p_object_name, '/', 1)::uuid;
  exception
    when others then return false;
  end;
  return public.is_conversation_member(v_conv);
end;
$$;

grant execute on function public.chat_attachment_member(text) to anon, authenticated;

drop policy if exists "active staff read chat attachments" on storage.objects;
create policy "members read chat attachments" on storage.objects
  for select using (
    bucket_id = 'staff-chat-attachments'
    and public.chat_attachment_member(name)
  );

drop policy if exists "active staff upload chat attachments" on storage.objects;
create policy "members upload chat attachments" on storage.objects
  for insert with check (
    bucket_id = 'staff-chat-attachments'
    and public.chat_attachment_member(name)
  );

-- Verify (expect false, then true):
--   select public.conversation_is_unused(
--            (select conversation_id from staff_conversation_members limit 1))
--            as populated_conv_seedable,
--          public.conversation_is_unused(gen_random_uuid())
--            as new_conv_seedable;
--
-- Still open, deliberately: staff_temp_admin_access remains readable by all
-- active staff (documented as intentional in staff-temp-admin-access.sql), and
-- the `clients` roster remains broadly staff-readable (clients-roster.sql).
