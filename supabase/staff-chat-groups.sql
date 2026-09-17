-- Team Chat: group threads + a realistic edit/unsend window.
-- Run after staff-chat-v2.sql. Safe to re-run.
--
-- Fixes two things reported against the live app:
-- 1. "I message Gillian and Jeff gets it too" — this was actually a client-
--    side race in StaffMessagesPage (openWith), not a data/RLS issue, and is
--    fixed there. This migration only adds group-thread support.
-- 2. "Editing a sent message doesn't change it" — the edit/unsend RLS window
--    was 5 seconds, which routinely expired before Save was even clicked.
--    Widened to 15 minutes (CHAT_EDIT_WINDOW_MS in app.jsx — keep both in sync).

alter table staff_conversations
  add column if not exists is_group boolean not null default false,
  add column if not exists title text;

-- dm_key only makes sense for a 1:1 — a group conversation has no natural
-- two-party key, so the column has to become optional before it can be null
-- for one. The uniqueness guarantee that used to sit on the plain "not null
-- unique" column moves to a partial index that only applies to 1:1 rows.
alter table staff_conversations alter column dm_key drop not null;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'staff_conversations_dm_key_key'
      and conrelid = 'staff_conversations'::regclass
  ) then
    alter table staff_conversations drop constraint staff_conversations_dm_key_key;
  end if;
end $$;

create unique index if not exists staff_conversations_dm_key_unique
  on staff_conversations (dm_key)
  where not is_group;

drop policy if exists "author edits within 5s" on staff_messages;
drop policy if exists "author edits within 15m" on staff_messages;
create policy "author edits within 15m"
  on staff_messages for update
  using (author_email = auth.jwt() ->> 'email' and created_at > now() - interval '15 minutes')
  with check (author_email = auth.jwt() ->> 'email');
