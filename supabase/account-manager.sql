-- Account manager per client (owner request 2026-10-04, "Option A").
--
-- NOT applied yet. Safe to re-run. Needs staff-schema.sql,
-- clients-roster.sql, staff-client-access.sql, assigned-bookkeeper-email.sql,
-- client-messages.sql, user-settings.sql and notification-emails.sql first.
--
-- What and why
--   Clients message one thread with the MyGoodBooks team. Jesse Smithwick
--   (jesse@mygoodbooks.org) is the account manager and main contact; the
--   assigned bookkeeper steps in when needed. Until now every staffer with
--   access to a client got an email for every client message.
--
--   1. clients.account_manager (display name) and
--      clients.account_manager_email (lower case, references staff(email)),
--      mirroring assigned_bookkeeper / assigned_bookkeeper_email. Default for
--      new clients and backfill for existing ones: Jesse. The name is kept in
--      step with staff.name by a trigger. A non-admin account manager gets
--      staff_client_access (admins can already open every client); losing
--      that access clears the field, like the bookkeeper.
--   2. Notifications (notify_enqueue_message, replaces the version in
--      notification-emails.sql):
--        * a client message emails the account manager only (kind
--          staff_client_message). If the client has no active account
--          manager it falls back to everyone with access, as before;
--        * a staff message (reply or internal note) that @mentions the
--          assigned bookkeeper (@First, @First Last or @emailname) emails the
--          bookkeeper;
--        * client_message_loop_in(client, participant): the inbox's "Loop in
--          bookkeeper" button. Emails the bookkeeper and leaves an internal
--          note in the thread ("Looped in ...").
--      Loop-ins and mentions reuse kind staff_client_message (same Settings
--      key, email.client_message) with payload.loop_in = true, so the
--      outbox and email-log check constraints don't change and an edge
--      function that hasn't been redeployed still sends them (as a generic
--      "new message" email). The redeployed function words them as a
--      loop-in / mention.
--   3. client_team_profiles(client): public face (name, title, phone,
--      photo) of the client's account manager, assigned bookkeeper, and any
--      staffer who has written in the caller's thread. For the client
--      Dashboard's "Your account manager" card and the name + title on staff
--      replies in the client's Messages page. Clients still never read
--      staff_profiles directly.
--   4. staff-avatars: a client can also read their account manager's photo.

begin;

-- ---------------------------------------------------------------------------
-- 1. Columns, default and backfill
-- ---------------------------------------------------------------------------
alter table public.clients
  add column if not exists account_manager text,
  add column if not exists account_manager_email text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'clients_account_manager_email_fkey') then
    alter table public.clients
      add constraint clients_account_manager_email_fkey
      foreign key (account_manager_email) references public.staff(email)
      on update cascade on delete set null;
  end if;
end;
$$;

create index if not exists clients_account_manager_email_idx
  on public.clients (account_manager_email);

-- Lower-case email; name follows the staff row.
create or replace function public.clients_account_manager_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  new.account_manager_email := lower(nullif(trim(new.account_manager_email), ''));
  if tg_op = 'UPDATE' and new.account_manager_email is not distinct from old.account_manager_email then
    return new;
  end if;
  if new.account_manager_email is null then
    new.account_manager := null;
    return new;
  end if;
  select s.name into v_name from staff s where s.email = new.account_manager_email;
  new.account_manager := coalesce(nullif(trim(v_name), ''), split_part(new.account_manager_email, '@', 1));
  return new;
end;
$$;

drop trigger if exists clients_account_manager_before_write on public.clients;
create trigger clients_account_manager_before_write
  before insert or update of account_manager_email on public.clients
  for each row execute function public.clients_account_manager_before_write();

-- A non-admin account manager needs access to open the client and its thread.
create or replace function public.clients_account_manager_after_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.account_manager_email is not null
     and (tg_op = 'INSERT' or new.account_manager_email is distinct from old.account_manager_email)
     and not exists (select 1 from staff s where s.email = new.account_manager_email and s.role = 'admin') then
    insert into staff_client_access (staff_email, client_id)
    values (new.account_manager_email, new.id)
    on conflict do nothing;
  end if;
  return null;
end;
$$;

drop trigger if exists clients_account_manager_after_write on public.clients;
create trigger clients_account_manager_after_write
  after insert or update of account_manager_email on public.clients
  for each row execute function public.clients_account_manager_after_write();

-- Losing access means no longer being the account manager (admins never
-- have rows here, so this only affects non-admin account managers).
create or replace function public.sca_clear_account_manager()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update clients set account_manager_email = null
   where id = old.client_id and account_manager_email = lower(old.staff_email);
  return null;
end;
$$;

drop trigger if exists sca_clear_account_manager on public.staff_client_access;
create trigger sca_clear_account_manager
  after delete on public.staff_client_access
  for each row execute function public.sca_clear_account_manager();

revoke execute on function public.clients_account_manager_before_write() from public, anon, authenticated;
revoke execute on function public.clients_account_manager_after_write() from public, anon, authenticated;
revoke execute on function public.sca_clear_account_manager() from public, anon, authenticated;

-- Default and backfill to Jesse, only if his staff row exists (the foreign
-- key would reject the value otherwise).
do $$
declare
  v_name text;
begin
  select name into v_name from public.staff where email = 'jesse@mygoodbooks.org';
  if not found then
    raise notice 'account-manager.sql: no staff row for jesse@mygoodbooks.org; no default or backfill set';
    return;
  end if;
  v_name := coalesce(nullif(trim(v_name), ''), 'Jesse Smithwick');
  execute format('alter table public.clients alter column account_manager_email set default %L', 'jesse@mygoodbooks.org');
  execute format('alter table public.clients alter column account_manager set default %L', v_name);
  update public.clients
     set account_manager_email = 'jesse@mygoodbooks.org'
   where account_manager_email is null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Notifications
-- ---------------------------------------------------------------------------
-- Does this message body @mention this staffer? Matches @First, @First Last
-- (display name or staff name) and @emailname, case-insensitively, as a
-- whole word.
create or replace function public.am_body_mentions(p_body text, p_email text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_names text[];
  v_n text;
  v_tok text;
begin
  if p_body is null or position('@' in p_body) = 0 or p_email is null then
    return false;
  end if;
  select array_remove(array[
           nullif(trim(s.name), ''),
           nullif(split_part(trim(s.name), ' ', 1), ''),
           nullif(trim(p.display_name), ''),
           nullif(split_part(trim(p.display_name), ' ', 1), ''),
           split_part(s.email, '@', 1)
         ], null)
    into v_names
    from staff s
    left join staff_profiles p on p.email = s.email
   where s.email = lower(p_email);
  if v_names is null then
    return false;
  end if;
  foreach v_n in array v_names loop
    v_tok := regexp_replace(v_n, '([^A-Za-z0-9 ])', '\\\1', 'g');
    if length(v_n) >= 2 and p_body ~* ('(^|[^A-Za-z0-9])@' || v_tok || '($|[^A-Za-z0-9])') then
      return true;
    end if;
  end loop;
  return false;
end;
$$;
revoke execute on function public.am_body_mentions(text, text) from public, anon, authenticated;

create or replace function public.notify_enqueue_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_am text;
  v_bk text;
begin
  select lower(c.account_manager_email), lower(c.assigned_bookkeeper_email)
    into v_am, v_bk
    from clients c where c.id = new.client_id;

  if new.author_kind = 'client' then
    if v_am is not null and exists (select 1 from staff s where s.email = v_am and s.active) then
      insert into notification_outbox (kind, recipient_email, client_id, ref_id, payload)
      values ('staff_client_message', v_am, new.client_id, new.id::text,
              jsonb_build_object('author_name', left(coalesce(new.author_name, new.author_email), 120)));
    else
      -- No active account manager: everyone with access, as before.
      insert into notification_outbox (kind, recipient_email, client_id, ref_id, payload)
      select 'staff_client_message', lower(sca.staff_email), new.client_id, new.id::text,
             jsonb_build_object('author_name', left(coalesce(new.author_name, new.author_email), 120))
      from staff_client_access sca
      join staff s on lower(s.email) = lower(sca.staff_email) and s.active
      where sca.client_id = new.client_id;
    end if;
    return null;
  end if;

  -- Staff message: the client is emailed about replies (never notes) ...
  if not new.internal and new.participant_email is not null then
    insert into notification_outbox (kind, recipient_email, client_id, ref_id, payload)
    values ('client_message', lower(new.participant_email), new.client_id, new.id::text,
            jsonb_build_object('author_name', left(coalesce(new.author_name, 'Your bookkeeper'), 120)));
  end if;

  -- ... and the assigned bookkeeper about an @mention (reply or note).
  if v_bk is not null
     and v_bk <> lower(new.author_email)
     and exists (select 1 from staff s where s.email = v_bk and s.active)
     and public.am_body_mentions(new.body, v_bk) then
    insert into notification_outbox (kind, recipient_email, client_id, ref_id, payload)
    values ('staff_client_message', v_bk, new.client_id, new.id::text,
            jsonb_build_object(
              'loop_in', true,
              'mention', true,
              'internal', new.internal,
              'by', left(coalesce(new.author_name, new.author_email), 120),
              'author_name', left(coalesce(new.author_name, new.author_email), 120)));
  end if;
  return null;
end;
$$;
revoke execute on function public.notify_enqueue_message() from public, anon, authenticated;
drop trigger if exists notify_enqueue_message on public.client_messages;
create trigger notify_enqueue_message
  after insert on public.client_messages
  for each row execute function public.notify_enqueue_message();

-- "Loop in bookkeeper" from the staff inbox. Returns the bookkeeper's name.
create or replace function public.client_message_loop_in(p_client_id text, p_participant_email text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text := lower(auth.jwt() ->> 'email');
  v_me_name text;
  v_bk text;
  v_bk_name text;
  v_part text := lower(trim(p_participant_email));
begin
  if not (public.is_active_staff() and public.can_access_client(p_client_id)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select lower(c.assigned_bookkeeper_email) into v_bk from clients c where c.id = p_client_id;
  if v_bk is null then
    raise exception 'This client has no assigned bookkeeper' using errcode = '22023';
  end if;
  select s.name into v_bk_name from staff s where s.email = v_bk and s.active;
  if v_bk_name is null then
    raise exception 'The assigned bookkeeper is not an active staff member' using errcode = '22023';
  end if;
  if v_bk = v_me then
    raise exception 'You are the assigned bookkeeper' using errcode = '22023';
  end if;
  if v_part is null or v_part = '' or not exists (
    select 1 from client_messages m where m.client_id = p_client_id and m.participant_email = v_part
    union all
    select 1 from client_users cu where cu.client_id = p_client_id and lower(cu.email) = v_part
  ) then
    raise exception 'Unknown conversation' using errcode = '22023';
  end if;
  select s.name into v_me_name from staff s where s.email = v_me;

  -- A visible record in the thread for staff (internal: clients never see it).
  insert into client_messages (client_id, participant_email, author_email, author_name, author_kind, body, internal)
  values (p_client_id, v_part, v_me, coalesce(v_me_name, v_me), 'staff', 'Looped in ' || v_bk_name || '.', true);

  -- One pending loop-in email per bookkeeper and conversation is enough.
  if not exists (
    select 1 from notification_outbox o
     where o.kind = 'staff_client_message' and o.recipient_email = v_bk
       and o.client_id = p_client_id and o.processed_at is null
       and o.payload ->> 'loop_in' = 'true' and o.payload ->> 'participant' = v_part
  ) then
    insert into notification_outbox (kind, recipient_email, client_id, ref_id, payload)
    values ('staff_client_message', v_bk, p_client_id, null,
            jsonb_build_object(
              'loop_in', true,
              'by', left(coalesce(v_me_name, v_me), 120),
              'author_name', left(coalesce(v_me_name, v_me), 120),
              'participant', v_part));
  end if;
  return v_bk_name;
end;
$$;
revoke all on function public.client_message_loop_in(text, text) from public, anon;
grant execute on function public.client_message_loop_in(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Public profiles of a client's team
-- ---------------------------------------------------------------------------
create or replace function public.client_team_profiles(p_client_id text)
returns table (email text, name text, title text, phone text, photo_path text,
               is_account_manager boolean, is_bookkeeper boolean)
language sql
stable
security definer
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
    -- Staff who wrote in the caller's own thread (a client), or in any of
    -- this client's threads (staff). Internal notes don't count.
    select lower(m.author_email)
    from client_messages m, c
    where m.client_id = c.id
      and m.author_kind = 'staff'
      and not m.internal
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
revoke all on function public.client_team_profiles(text) from public, anon;
grant execute on function public.client_team_profiles(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. staff-avatars: a client can read their bookkeeper's and account
--    manager's photo (replaces the policy in user-settings.sql).
-- ---------------------------------------------------------------------------
drop policy if exists "read staff avatars" on storage.objects;
create policy "read staff avatars" on storage.objects
  for select to authenticated using (
    bucket_id = 'staff-avatars'
    and (
      public.is_active_staff()
      or exists (
        select 1
        from public.client_users cu
        join public.clients c on c.id = cu.client_id
        where lower(cu.email) = lower(auth.jwt() ->> 'email')
          and cu.active
          and (storage.foldername(objects.name))[1] in (c.assigned_bookkeeper_email, c.account_manager_email)
      )
    )
  );

commit;
