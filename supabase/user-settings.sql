-- Settings page for staff and clients (owner request 2026-09-30).
-- Applied to production 2026-09-30 as migration user_settings (RLS tested:
-- own settings row only; clients read only their assigned bookkeeper's public
-- profile; clients can't update another organization).
--
-- Safe to re-run. Needs staff-schema.sql, client-users.sql, clients-roster.sql,
-- assigned-bookkeeper-email.sql, client-emails.sql, access-requests.sql and
-- audit-log.sql first.
--
-- 1. public.user_settings: one row per signed-in person (staff or client),
--    keyed by their JWT email (stamped by the guard trigger, same pattern as
--    user_board_layouts). settings is a small JSON object the app owns:
--      theme          "light" | "dark" | null (match my computer)
--      startPage      staff: "home" | "tasks" | "last-client"
--      signature      staff: plain-text email signature
--      notify         { email: { <key>: bool }, bell: { <key>: bool } }
--      name, phone    client profile (display only; sign-in email is fixed)
--      tour           client guided tour + setup checklist state
--                     (components/tour/Tour.jsx; added 2026-09-30, a JSON
--                     key only, so no schema change was needed)
--    The notification-emails and client-emails edge functions read it with
--    the service role to honor email preferences (see notification-emails.sql).
--    The browser keeps a localStorage copy as a cache (components/settings/
--    Settings.jsx, ST_store) and never writes while staff are in "View as" or
--    previewing the portal as a client user.
--
-- 2. public.staff_profiles: a staffer's public face (display name, title,
--    phone, photo). The staffer edits their own row. Clients never read the
--    table; they get only their assigned bookkeeper's fields through
--    bookkeeper_public_profile(client_id).
--
-- 3. Storage bucket staff-avatars (private, images <= 2 MB). Path
--    <staff email>/<file>. A staffer writes only their own folder; any active
--    staff member can read; a client can read only the folder of the
--    bookkeeper assigned to their organization. The app shows photos with
--    signed URLs.
--
-- 4. Client organization settings (full-access client users, the portal's
--    "main contact" role; client_users has no separate owner flag):
--      clients.org_address                       new column
--      client_email_prefs.summary_recipients     who gets the monthly summary
--                                                (null = everyone)
--    Read with client_org_settings(), changed only through
--    client_update_org_settings() (name, address, summary recipients; audit
--    logged as client.org_updated). Team list: client_org_team().
--    "Ask us to add someone": client_request_access() files a normal
--    access_requests row (token null) and drops a reminder on the assigned
--    staff, exactly like the public request link does.

-- ---------------------------------------------------------------------------
-- 1. user_settings
-- ---------------------------------------------------------------------------
create table if not exists public.user_settings (
  user_email text primary key default lower(auth.jwt() ->> 'email'),
  settings jsonb not null default '{}'::jsonb check (
    jsonb_typeof(settings) = 'object' and pg_column_size(settings) <= 16384
  ),
  updated_at timestamptz not null default now()
);

create or replace function public.user_settings_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.user_email := lower(auth.jwt() ->> 'email');
  if new.user_email is null or new.user_email = '' then
    raise exception 'user_settings: no signed-in email';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function public.user_settings_guard() from public, anon, authenticated;

drop trigger if exists user_settings_guard on public.user_settings;
create trigger user_settings_guard
  before insert or update on public.user_settings
  for each row execute function public.user_settings_guard();

alter table public.user_settings enable row level security;

drop policy if exists "own settings select" on public.user_settings;
create policy "own settings select" on public.user_settings
  for select to authenticated
  using (user_email = lower(auth.jwt() ->> 'email'));
drop policy if exists "own settings insert" on public.user_settings;
create policy "own settings insert" on public.user_settings
  for insert to authenticated
  with check (user_email = lower(auth.jwt() ->> 'email'));
drop policy if exists "own settings update" on public.user_settings;
create policy "own settings update" on public.user_settings
  for update to authenticated
  using (user_email = lower(auth.jwt() ->> 'email'))
  with check (user_email = lower(auth.jwt() ->> 'email'));
drop policy if exists "own settings delete" on public.user_settings;
create policy "own settings delete" on public.user_settings
  for delete to authenticated
  using (user_email = lower(auth.jwt() ->> 'email'));

revoke all on public.user_settings from anon;
revoke truncate on public.user_settings from authenticated;
grant select, insert, update, delete on public.user_settings to authenticated;

-- ---------------------------------------------------------------------------
-- 2. staff_profiles
-- ---------------------------------------------------------------------------
create table if not exists public.staff_profiles (
  email text primary key references public.staff(email) on update cascade on delete cascade,
  display_name text check (display_name is null or char_length(display_name) between 1 and 120),
  title text check (title is null or char_length(title) <= 120),
  phone text check (phone is null or char_length(phone) <= 40),
  photo_path text check (photo_path is null or char_length(photo_path) <= 300),
  updated_at timestamptz not null default now()
);

create or replace function public.staff_profiles_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(auth.jwt() ->> 'email');
begin
  if v_email is null or v_email = '' then
    raise exception 'staff_profiles: no signed-in email';
  end if;
  new.email := v_email;
  new.display_name := nullif(btrim(new.display_name), '');
  new.title := nullif(btrim(new.title), '');
  new.phone := nullif(btrim(new.phone), '');
  -- A photo must sit in the staffer's own folder of the staff-avatars bucket.
  if new.photo_path is not null and left(new.photo_path, char_length(v_email) + 1) <> v_email || '/' then
    raise exception 'photo must be in your own folder' using errcode = '22023';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function public.staff_profiles_guard() from public, anon, authenticated;

drop trigger if exists staff_profiles_guard on public.staff_profiles;
create trigger staff_profiles_guard
  before insert or update on public.staff_profiles
  for each row execute function public.staff_profiles_guard();

alter table public.staff_profiles enable row level security;

drop policy if exists "staff read own profile" on public.staff_profiles;
create policy "staff read own profile" on public.staff_profiles
  for select to authenticated
  using (email = lower(auth.jwt() ->> 'email') and public.is_active_staff());
drop policy if exists "staff insert own profile" on public.staff_profiles;
create policy "staff insert own profile" on public.staff_profiles
  for insert to authenticated
  with check (email = lower(auth.jwt() ->> 'email') and public.is_active_staff());
drop policy if exists "staff update own profile" on public.staff_profiles;
create policy "staff update own profile" on public.staff_profiles
  for update to authenticated
  using (email = lower(auth.jwt() ->> 'email') and public.is_active_staff())
  with check (email = lower(auth.jwt() ->> 'email') and public.is_active_staff());

revoke all on public.staff_profiles from anon;
revoke truncate, delete on public.staff_profiles from authenticated;
grant select, insert, update on public.staff_profiles to authenticated;

-- The assigned bookkeeper's public card for one client. Callable by an active
-- member of that client's organization, or by staff who can open the client.
-- Returns nothing for anyone else, and nothing when no staffer is assigned.
create or replace function public.bookkeeper_public_profile(p_client_id text)
returns table (email text, name text, title text, phone text, photo_path text)
language sql
stable
security definer
set search_path = public
as $$
  select s.email,
         coalesce(p.display_name, s.name) as name,
         p.title, p.phone, p.photo_path
  from clients c
  join staff s on s.email = c.assigned_bookkeeper_email and s.active
  left join staff_profiles p on p.email = s.email
  where c.id = p_client_id
    and (
      exists (
        select 1 from client_users cu
        where lower(cu.email) = lower(auth.jwt() ->> 'email')
          and cu.client_id = c.id and cu.active
      )
      or (public.is_active_staff() and public.can_access_client(c.id))
    );
$$;
revoke all on function public.bookkeeper_public_profile(text) from public, anon;
grant execute on function public.bookkeeper_public_profile(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. staff-avatars bucket
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('staff-avatars', 'staff-avatars', false, 2097152,
        array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "staff upload own avatar" on storage.objects;
create policy "staff upload own avatar" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'staff-avatars'
    and public.is_active_staff()
    and (storage.foldername(name))[1] = lower(auth.jwt() ->> 'email')
  );

drop policy if exists "staff update own avatar" on storage.objects;
create policy "staff update own avatar" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'staff-avatars'
    and public.is_active_staff()
    and (storage.foldername(name))[1] = lower(auth.jwt() ->> 'email')
  )
  with check (
    bucket_id = 'staff-avatars'
    and (storage.foldername(name))[1] = lower(auth.jwt() ->> 'email')
  );

drop policy if exists "staff delete own avatar" on storage.objects;
create policy "staff delete own avatar" on storage.objects
  for delete to authenticated using (
    bucket_id = 'staff-avatars'
    and public.is_active_staff()
    and (storage.foldername(name))[1] = lower(auth.jwt() ->> 'email')
  );

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
          and c.assigned_bookkeeper_email = (storage.foldername(objects.name))[1]
      )
    )
  );

-- ---------------------------------------------------------------------------
-- 4. Client organization settings
-- ---------------------------------------------------------------------------
alter table public.clients
  add column if not exists org_address text;
alter table public.clients drop constraint if exists clients_org_address_len;
alter table public.clients add constraint clients_org_address_len
  check (org_address is null or char_length(org_address) <= 500);

alter table public.client_email_prefs
  add column if not exists summary_recipients text[];
alter table public.client_email_prefs drop constraint if exists client_email_prefs_summary_recipients_len;
alter table public.client_email_prefs add constraint client_email_prefs_summary_recipients_len
  check (summary_recipients is null or cardinality(summary_recipients) <= 100);

-- The caller's own client_users row, when it's active. Internal helper.
create or replace function public.st_my_client_user()
returns public.client_users
language sql
stable
security definer
set search_path = public
as $$
  select * from client_users
  where lower(email) = lower(auth.jwt() ->> 'email') and active
  limit 1;
$$;
revoke all on function public.st_my_client_user() from public, anon, authenticated;

-- Organization details for the signed-in client (any active member may read
-- the name/address; the recipients list is included for everyone so the
-- Notifications tab can say whether they're on it).
create or replace function public.client_org_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  me client_users;
  v jsonb;
begin
  me := st_my_client_user();
  if me.email is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'client_id', c.id,
    'name', c.name,
    'address', c.org_address,
    'summary_recipients', to_jsonb(p.summary_recipients),
    'can_edit', coalesce(me.access, 'full') = 'full'
  ) into v
  from clients c
  left join client_email_prefs p on p.client_id = c.id
  where c.id = me.client_id;
  return v;
end;
$$;
revoke all on function public.client_org_settings() from public, anon;
grant execute on function public.client_org_settings() to authenticated;

-- Team members of the caller's organization. Full-access members only.
create or replace function public.client_org_team()
returns table (email text, name text, role text, access text, active boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  me client_users;
begin
  me := st_my_client_user();
  if me.email is null or coalesce(me.access, 'full') <> 'full' then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
    select cu.email, cu.name, cu.role, coalesce(cu.access, 'full'), cu.active
    from client_users cu
    where cu.client_id = me.client_id
    order by cu.active desc, cu.name;
end;
$$;
revoke all on function public.client_org_team() from public, anon;
grant execute on function public.client_org_team() to authenticated;

-- Updates ONLY the organization's name, address and monthly-summary
-- recipients, for the caller's own organization, and only for a full-access
-- member. Recipients must be active members of the same organization.
create or replace function public.client_update_org_settings(
  p_name text,
  p_address text,
  p_summary_recipients text[]
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me client_users;
  v_old clients;
  v_name text := nullif(btrim(p_name), '');
  v_addr text := nullif(btrim(p_address), '');
  v_rcpt text[];
  v_old_rcpt text[];
begin
  me := st_my_client_user();
  if me.email is null or coalesce(me.access, 'full') <> 'full' then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_name is null or char_length(v_name) > 200 then
    raise exception 'organization name must be 1-200 characters' using errcode = '22023';
  end if;
  if v_addr is not null and char_length(v_addr) > 500 then
    raise exception 'address is too long' using errcode = '22023';
  end if;
  if p_summary_recipients is not null then
    select array_agg(distinct lower(r)) into v_rcpt
    from unnest(p_summary_recipients) r
    where exists (
      select 1 from client_users cu
      where cu.client_id = me.client_id and cu.active and lower(cu.email) = lower(r)
    );
    v_rcpt := coalesce(v_rcpt, '{}'::text[]);
  end if;

  select * into v_old from clients where id = me.client_id for update;
  select summary_recipients into v_old_rcpt from client_email_prefs where client_id = me.client_id;

  update clients set name = v_name, org_address = v_addr where id = me.client_id;
  insert into client_email_prefs (client_id, summary_recipients, updated_at, updated_by)
  values (me.client_id, v_rcpt, now(), lower(me.email))
  on conflict (client_id) do update
    set summary_recipients = excluded.summary_recipients,
        updated_at = now(),
        updated_by = excluded.updated_by;

  perform audit_write('client.org_updated', me.client_id, 'client', me.client_id,
    jsonb_build_object(
      'by', lower(me.email),
      'name', jsonb_build_object('from', v_old.name, 'to', v_name),
      'address', jsonb_build_object('from', v_old.org_address, 'to', v_addr),
      'summary_recipients', jsonb_build_object('from', to_jsonb(v_old_rcpt), 'to', to_jsonb(v_rcpt))
    ));
  return client_org_settings();
end;
$$;
revoke all on function public.client_update_org_settings(text, text, text[]) from public, anon;
grant execute on function public.client_update_org_settings(text, text, text[]) to authenticated;

-- "Ask us to add someone" from inside the portal. Same effect as the public
-- request link: an access_requests row (token null, so no link is used up)
-- and a high-priority reminder for every staffer assigned to the client.
-- At most 10 unreviewed requests per organization.
create or replace function public.client_request_access(
  p_name text,
  p_email text,
  p_role text,
  p_access text,
  p_note text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me client_users;
  v_id uuid;
  v_client_name text;
  v_name text := nullif(btrim(p_name), '');
  v_email text := lower(nullif(btrim(p_email), ''));
  v_role text := left(coalesce(nullif(btrim(p_role), ''), 'Team member'), 120);
  v_access text := case when p_access = 'scoped' then 'scoped' else 'full' end;
begin
  me := st_my_client_user();
  if me.email is null or coalesce(me.access, 'full') <> 'full' then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_name is null or char_length(v_name) > 120 then
    raise exception 'name is required' using errcode = '22023';
  end if;
  if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 254 then
    raise exception 'a valid email is required' using errcode = '22023';
  end if;
  if (select count(*) from access_requests where client_id = me.client_id and not reviewed) >= 10 then
    raise exception 'too many pending requests; your bookkeeper will review them soon' using errcode = 'P0001';
  end if;

  insert into access_requests (client_id, token, submitted_by_name, submitted_by_email, people)
  values (
    me.client_id, null, me.name, lower(me.email),
    jsonb_build_array(jsonb_build_object(
      'name', v_name, 'email', v_email, 'role', v_role, 'access', v_access,
      'tabs', null, 'categories', null,
      'note', left(nullif(btrim(p_note), ''), 500)
    ))
  )
  returning id into v_id;

  select name into v_client_name from clients where id = me.client_id;
  insert into staff_reminders (staff_email, text, client_id, priority, due_date)
  select sca.staff_email,
         'New access request from ' || me.name || ' at ' ||
           coalesce(v_client_name, me.client_id) || ' — review it under Manage access.',
         me.client_id, 'high', current_date
  from staff_client_access sca
  where sca.client_id = me.client_id;

  return v_id;
end;
$$;
revoke all on function public.client_request_access(text, text, text, text, text) from public, anon;
grant execute on function public.client_request_access(text, text, text, text, text) to authenticated;
