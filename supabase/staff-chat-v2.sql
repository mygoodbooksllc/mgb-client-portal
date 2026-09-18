-- Team Chat v2: any-to-any staff DMs, file attachments, edit/unsend, and
-- read receipts. Replaces the earlier staff-messages.sql, which only
-- supported one fixed thread per bookkeeper (bookkeeper <-> "any admin").
-- That model couldn't support two bookkeepers messaging each other about a
-- shared client, so this drops the old `staff_messages` table and rebuilds
-- around real conversations instead.
--
-- Builds on staff-schema.sql and staff-admin-policies.sql (for
-- is_active_staff()/is_active_staff_admin()). Run those first if you
-- haven't.
--
-- Run this once in the Supabase SQL editor. Safe to re-run.
-- NOTE: this drops the old staff_messages table. Any messages sent under
-- the old one-thread-per-bookkeeper model are not migrated — this is a
-- prototype, so that data was sample/test content, not something worth a
-- migration script.

drop table if exists staff_messages;

-- One row per 1:1 conversation. dm_key is the two participant emails,
-- lexically sorted and joined with "|" (e.g. "amy@mgb.com|joe@mgb.com"), so
-- "start a chat with X" can look up an existing conversation with a single
-- indexed equality check instead of a membership join.
create table if not exists staff_conversations (
  id uuid primary key default gen_random_uuid(),
  dm_key text unique not null,
  created_at timestamptz not null default now()
);

create table if not exists staff_conversation_members (
  conversation_id uuid not null references staff_conversations(id) on delete cascade,
  staff_email text not null,
  last_read_at timestamptz,
  primary key (conversation_id, staff_email)
);

create index if not exists staff_conversation_members_email_idx on staff_conversation_members (staff_email);

create table if not exists staff_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references staff_conversations(id) on delete cascade,
  author_email text not null,
  author_name text not null,
  author_role text not null,
  text text,
  attachment_name text,
  attachment_url text,
  attachment_size text,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz
);

create index if not exists staff_messages_conversation_idx on staff_messages (conversation_id, created_at);

alter table staff_conversations enable row level security;
alter table staff_conversation_members enable row level security;
alter table staff_messages enable row level security;

-- security definer so the staff_messages/staff_conversation_members
-- policies below can check membership without RLS on
-- staff_conversation_members recursing into itself.
-- set search_path = public is pinned here (security audit finding M5) --
-- every other security definer function in this repo has it, and leaving it
-- off a SECURITY DEFINER function lets a caller-controlled search_path
-- shadow `staff_conversation_members`/`auth` with objects of their own.
create or replace function public.is_conversation_member(conv_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from staff_conversation_members
    where conversation_id = conv_id
      and staff_email = auth.jwt() ->> 'email'
  );
$$;

-- Security audit finding H1: this used to be `using (is_active_staff())`,
-- which let any active staff member enumerate every conversation (including
-- other people's private DMs) via a plain select. Narrowed to only the
-- conversations they're actually a member of.
-- Live fix (2026-09-18, applied via apply_migration
-- fix_staff_conversations_select_for_creation): the H1 hardening below
-- narrowed this to is_conversation_member(id) only, which broke group/DM
-- creation — createGroup()/openWith() do `.insert({...}).select("id")`, and
-- Postgres checks RETURNING rows against the SELECT policy. At insert time
-- the new conversation has zero members yet (membership rows are inserted
-- in a second statement right after), so the row-back failed silently.
-- Fix: also allow reading a conversation that currently has no members at
-- all (mid-creation). An empty conversation has no messages and nothing to
-- leak, so this doesn't reopen H1's enumeration concern (reading OTHER
-- staff's already-populated DMs).
drop policy if exists "active staff read conversations" on staff_conversations;
create policy "active staff read conversations"
  on staff_conversations for select
  using (
    public.is_active_staff()
    and (
      public.is_conversation_member(id)
      or not exists (
        select 1 from staff_conversation_members m
        where m.conversation_id = staff_conversations.id
      )
    )
  );

drop policy if exists "active staff create conversations" on staff_conversations;
create policy "active staff create conversations"
  on staff_conversations for insert
  with check (public.is_active_staff());

-- Membership rows aren't sensitive on their own (just "these two people have
-- a DM"), so any active staff member can read one.
drop policy if exists "active staff read memberships" on staff_conversation_members;
create policy "active staff read memberships"
  on staff_conversation_members for select
  using (public.is_active_staff());

-- Security audit finding H1: this used to be `with check (is_active_staff())`
-- with no restriction on WHOSE membership row was being inserted, so any
-- active staff member could add themself (or anyone) to any DM, including
-- ones they weren't invited to. Now a staff member may only insert their own
-- membership row, OR seed the other participants of a conversation that has
-- no members yet (the moment a new conversation is created) -- which is
-- exactly what openWith()/createGroup() in app.jsx need: insert the
-- creator's own row first (allowed, self), then the other participants
-- (allowed, conversation is still empty), both before anything reads the
-- conversation back.
drop policy if exists "active staff create memberships" on staff_conversation_members;
create policy "active staff create memberships"
  on staff_conversation_members for insert
  with check (
    public.is_active_staff()
    and (
      staff_email = auth.jwt() ->> 'email'
      or not exists (
        select 1 from staff_conversation_members m
        where m.conversation_id = staff_conversation_members.conversation_id
      )
    )
  );

-- last_read_at (read receipts) can only be stamped by the member themselves.
drop policy if exists "self update own membership" on staff_conversation_members;
create policy "self update own membership"
  on staff_conversation_members for update
  using (staff_email = auth.jwt() ->> 'email')
  with check (staff_email = auth.jwt() ->> 'email');

-- Security audit finding H1: lets a staff member leave a thread.
drop policy if exists "self delete own membership" on staff_conversation_members;
create policy "self delete own membership"
  on staff_conversation_members for delete
  using (staff_email = auth.jwt() ->> 'email');

drop policy if exists "members read messages" on staff_messages;
create policy "members read messages"
  on staff_messages for select
  using (public.is_conversation_member(conversation_id));

drop policy if exists "members send messages" on staff_messages;
create policy "members send messages"
  on staff_messages for insert
  with check (
    author_email = auth.jwt() ->> 'email'
    and public.is_conversation_member(conversation_id)
  );

-- Security audit finding M1: author_name/author_role used to be whatever
-- the client sent on insert, and RLS only ever validated author_email --
-- so any active staff member could send a message that displayed as coming
-- from a different name/role than their own. This trigger overwrites both
-- from the `staff` table server-side on every insert, so the client-sent
-- values (still accepted for backwards compatibility, just ignored) can
-- never be trusted or displayed.
create or replace function public.staff_messages_set_author_from_staff()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select name, role into new.author_name, new.author_role
  from staff where email = new.author_email;
  return new;
end;
$$;

drop trigger if exists staff_messages_set_author on staff_messages;
create trigger staff_messages_set_author
  before insert on staff_messages
  for each row execute function public.staff_messages_set_author_from_staff();

-- Edit/unsend: only the author, and only within 5 seconds of sending.
-- Unsend is a soft delete (deleted_at set) rather than a real delete, so a
-- "Message removed" state is possible later if ever wanted -- today the
-- client just filters deleted_at is null out of the thread.
drop policy if exists "author edits within 5s" on staff_messages;
create policy "author edits within 5s"
  on staff_messages for update
  using (author_email = auth.jwt() ->> 'email' and created_at > now() - interval '5 seconds')
  with check (author_email = auth.jwt() ->> 'email');

-- Realtime: live-push new messages, edits/unsends, and read-receipt updates
-- into any open conversation.
alter publication supabase_realtime add table staff_messages;
alter publication supabase_realtime add table staff_conversation_members;

-- Storage bucket for chat attachments.
--
-- Security audit finding C1 (CRITICAL): this bucket used to be created with
-- public: true and had a select policy of `using (bucket_id = '...')` with
-- no auth check at all -- meaning anyone holding the published anon key
-- could list AND download every attachment ever sent in Team Chat, with no
-- session required. Flipped to private, and the select policy now requires
-- an active staff session. The app now mints short-lived signed URLs at
-- render time (via createSignedUrl) instead of calling getPublicUrl(), and
-- stores the storage *path* (not a public URL) in attachment_url.
--
-- NOTE: objects uploaded before this fix were exposed to anyone with the
-- anon key for however long they existed -- that exposure already happened
-- and can't be undone by this migration. See HANDOFF7.md §105.
insert into storage.buckets (id, name, public)
values ('staff-chat-attachments', 'staff-chat-attachments', false)
on conflict (id) do update set public = false;

drop policy if exists "active staff upload chat attachments" on storage.objects;
create policy "active staff upload chat attachments"
  on storage.objects for insert
  with check (bucket_id = 'staff-chat-attachments' and public.is_active_staff());

drop policy if exists "anyone reads chat attachments" on storage.objects;
drop policy if exists "active staff read chat attachments" on storage.objects;
create policy "active staff read chat attachments"
  on storage.objects for select
  using (bucket_id = 'staff-chat-attachments' and public.is_active_staff());
