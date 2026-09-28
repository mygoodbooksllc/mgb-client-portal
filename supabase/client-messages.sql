-- Real client messaging (owner request 2026-09-28): replaces the sample
-- threads in data.js for the unified staff inbox and the client Messages page.
--
-- One private thread per person at an organization, identified by
-- (client_id, participant_email): a client user sees only their own thread
-- with MyGoodBooks, never a colleague's. Staff who can access the client see
-- every thread for it. Staff can also leave internal notes in a thread
-- (internal = true); clients never see those rows.
--
-- Attachments go in the existing client-uploads bucket under
-- <client_id>/messages/<participant>/..., which that bucket's policies
-- (staff-client-tools.sql) already allow for staff and the org's client users.
--
-- Builds on staff-schema.sql, audit-hardening-client-scoping.sql,
-- client-users.sql and pro-budget-reports.sql (is_client_member). Safe to re-run.
-- Applied to production 2026-09-28.

begin;

create table if not exists public.client_messages (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,
  participant_email text not null check (participant_email = lower(participant_email)),
  author_email text not null,
  author_name text,
  author_kind text not null check (author_kind in ('staff', 'client')),
  body text not null default '' check (length(body) <= 8000),
  internal boolean not null default false,
  attachment_path text,
  attachment_name text check (attachment_name is null or length(attachment_name) <= 255),
  created_at timestamptz not null default now(),
  check (length(body) > 0 or attachment_path is not null),
  check (not internal or author_kind = 'staff'),
  check (attachment_path is null or attachment_path like client_id || '/messages/%')
);
create index if not exists client_messages_thread_idx
  on public.client_messages (client_id, participant_email, created_at);
create index if not exists client_messages_recent_idx
  on public.client_messages (created_at desc);
alter table public.client_messages enable row level security;
revoke all on public.client_messages from anon;
revoke update, delete on public.client_messages from authenticated;

drop policy if exists "staff read client messages" on public.client_messages;
create policy "staff read client messages" on public.client_messages
  for select using (public.is_active_staff() and public.can_access_client(client_id));

drop policy if exists "staff write client messages" on public.client_messages;
create policy "staff write client messages" on public.client_messages
  for insert with check (
    public.is_active_staff()
    and public.can_access_client(client_id)
    and author_kind = 'staff'
    and author_email = auth.jwt() ->> 'email'
  );

drop policy if exists "client reads own thread" on public.client_messages;
create policy "client reads own thread" on public.client_messages
  for select using (
    not internal
    and participant_email = lower(auth.jwt() ->> 'email')
    and public.is_client_member(client_id)
  );

drop policy if exists "client writes own thread" on public.client_messages;
create policy "client writes own thread" on public.client_messages
  for insert with check (
    not internal
    and author_kind = 'client'
    and author_email = auth.jwt() ->> 'email'
    and participant_email = lower(auth.jwt() ->> 'email')
    and public.is_client_member(client_id)
  );

-- Read markers: one row per reader per thread.
create table if not exists public.client_message_reads (
  client_id text not null,
  participant_email text not null,
  reader_email text not null,
  last_read_at timestamptz not null default now(),
  primary key (client_id, participant_email, reader_email)
);
alter table public.client_message_reads enable row level security;
revoke all on public.client_message_reads from anon;

drop policy if exists "read markers" on public.client_message_reads;
create policy "read markers" on public.client_message_reads
  for all using (
    (public.is_active_staff() and public.can_access_client(client_id))
    or (participant_email = lower(auth.jwt() ->> 'email') and public.is_client_member(client_id))
  )
  with check (
    reader_email = auth.jwt() ->> 'email'
    and (
      (public.is_active_staff() and public.can_access_client(client_id))
      or (participant_email = lower(auth.jwt() ->> 'email') and public.is_client_member(client_id))
    )
  );

do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    return;
  end if;
  foreach t in array array['client_messages', 'client_message_reads'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;

commit;
