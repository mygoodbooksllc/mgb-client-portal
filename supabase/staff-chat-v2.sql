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
create or replace function public.is_conversation_member(conv_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from staff_conversation_members
    where conversation_id = conv_id
      and staff_email = auth.jwt() ->> 'email'
  );
$$;

drop policy if exists "active staff read conversations" on staff_conversations;
create policy "active staff read conversations"
  on staff_conversations for select
  using (public.is_active_staff());

drop policy if exists "active staff create conversations" on staff_conversations;
create policy "active staff create conversations"
  on staff_conversations for insert
  with check (public.is_active_staff());

-- Membership rows aren't sensitive on their own (just "these two people have
-- a DM"), so any active staff member can add one -- needed because starting
-- a new conversation means inserting the OTHER person's member row too, not
-- just your own.
drop policy if exists "active staff read memberships" on staff_conversation_members;
create policy "active staff read memberships"
  on staff_conversation_members for select
  using (public.is_active_staff());

drop policy if exists "active staff create memberships" on staff_conversation_members;
create policy "active staff create memberships"
  on staff_conversation_members for insert
  with check (public.is_active_staff());

-- last_read_at (read receipts) can only be stamped by the member themselves.
drop policy if exists "self update own membership" on staff_conversation_members;
create policy "self update own membership"
  on staff_conversation_members for update
  using (staff_email = auth.jwt() ->> 'email')
  with check (staff_email = auth.jwt() ->> 'email');

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

-- Storage bucket for chat attachments. Public read (internal tool, no
-- sensitive-client-data posture beyond what's already true of this
-- prototype) so the client can render/download via a plain public URL
-- instead of juggling signed URLs.
insert into storage.buckets (id, name, public)
values ('staff-chat-attachments', 'staff-chat-attachments', true)
on conflict (id) do nothing;

drop policy if exists "active staff upload chat attachments" on storage.objects;
create policy "active staff upload chat attachments"
  on storage.objects for insert
  with check (bucket_id = 'staff-chat-attachments' and public.is_active_staff());

drop policy if exists "anyone reads chat attachments" on storage.objects;
create policy "anyone reads chat attachments"
  on storage.objects for select
  using (bucket_id = 'staff-chat-attachments');
