-- Realtime for client users on their own message thread, plus client
-- storage and attachment fixes (2026-09-28). Applied to production 2026-09-28.
--
-- client-messages.sql puts client_messages in the supabase_realtime
-- publication, but a client user still can't subscribe: the app joins
-- private channels only (audit2-realtime-private-channels.sql), and the only
-- realtime.messages policies there are for active staff. Joining a private
-- channel checks realtime.messages RLS for the topic, so a client's join is
-- refused and their Messages page falls back to polling every 30 seconds.
--
-- This lets a signed-in user join exactly one topic, "client-msgs-<their own
-- lowercased JWT email>", which is what SI_useClientMessaging in
-- components/inbox/StaffInbox.jsx subscribes to. It grants read only (no
-- insert, so no broadcasting), and the postgres_changes rows delivered on it
-- are still filtered by client_messages' own RLS: a client only ever receives
-- their own, non-internal thread.
--
-- Builds on audit2-realtime-private-channels.sql and client-messages.sql.
-- Safe to re-run.

drop policy if exists "client reads own message topic" on realtime.messages;
create policy "client reads own message topic"
  on realtime.messages for select
  to authenticated
  using (realtime.topic() = 'client-msgs-' || lower(auth.jwt() ->> 'email'));

-- ---------------------------------------------------------------------------
-- Client storage policies (client-uploads bucket)
-- ---------------------------------------------------------------------------
-- Bug fix: the versions in staff-client-tools.sql wrote
-- storage.foldername(name) inside a subquery on client_users, which has its
-- own "name" column, so "name" meant the person's name, not the file path.
-- Real client users could neither upload nor read. is_client_member() avoids
-- the ambiguity (and the RLS-inside-a-policy trap).
--
-- Also: message attachments live under <client_id>/messages/<email>/, and a
-- client user may only read or write their own folder there, not a
-- colleague's private thread files.
drop policy if exists "client reads own uploads" on storage.objects;
create policy "client reads own uploads" on storage.objects
  for select using (
    bucket_id = 'client-uploads'
    and public.is_client_member((storage.foldername(objects.name))[1])
    and (
      coalesce((storage.foldername(objects.name))[2], '') <> 'messages'
      or (storage.foldername(objects.name))[3] = lower(auth.jwt() ->> 'email')
    )
  );
drop policy if exists "client uploads own files" on storage.objects;
create policy "client uploads own files" on storage.objects
  for insert with check (
    bucket_id = 'client-uploads'
    and public.is_client_member((storage.foldername(objects.name))[1])
    and (
      coalesce((storage.foldername(objects.name))[2], '') <> 'messages'
      or (storage.foldername(objects.name))[3] = lower(auth.jwt() ->> 'email')
    )
  );

-- A client's message may only point at a file in their own messages folder.
drop policy if exists "client writes own thread" on public.client_messages;
create policy "client writes own thread" on public.client_messages
  for insert with check (
    not internal
    and author_kind = 'client'
    and author_email = auth.jwt() ->> 'email'
    and participant_email = lower(auth.jwt() ->> 'email')
    and public.is_client_member(client_id)
    and (attachment_path is null
         or attachment_path like client_id || '/messages/' || participant_email || '/%')
  );
