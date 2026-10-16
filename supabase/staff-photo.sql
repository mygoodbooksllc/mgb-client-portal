-- Staff profile photos: required upload, admin edit, history and uniform display.
-- Spec: docs/staff-photo-spec.md (Parts B, D). Applied to production 2026-10-16
-- as migration staff_photo. Safe to re-run.
--
--   staff_profiles.photo_path   stays the CURRENT-photo pointer (every reader keeps working)
--   staff_photo_versions        history: original / staff_crop / admin_edit (soft delete only)
--   staff_photo_exemptions      admin-only "Not required" switch
--   sp_* RPCs                   the only way photo_path changes (guard flag mgb.staff_photo_rpc)
--   storage staff-avatars       staff can add objects, nobody can update or delete them
--
-- Status is derived, never stored: missing / exempt / submitted ("Needs edit") /
-- edited ("Done"). The JS mirror is SP_deriveStatus (components/staff/staffPhotoLogic.js).

begin;

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
create table if not exists public.staff_photo_versions (
  id            uuid primary key default gen_random_uuid(),
  staff_email   text not null references public.staff(email) on update cascade,
  submission_id uuid not null,              -- groups one staff upload's original + crop
  kind          text not null check (kind in ('original','staff_crop','admin_edit')),
  storage_path  text not null unique check (char_length(storage_path) <= 300),
  uploaded_by   text not null,
  note          text check (note is null or char_length(note) <= 500),
  created_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  deleted_by    text,
  check (left(storage_path, char_length(staff_email) + 1) = staff_email || '/')
);
create index if not exists staff_photo_versions_email_idx
  on public.staff_photo_versions (staff_email, created_at desc);

create table if not exists public.staff_photo_exemptions (
  staff_email text primary key references public.staff(email) on update cascade on delete cascade,
  reason      text check (reason is null or char_length(reason) <= 300),
  set_by      text not null,
  set_at      timestamptz not null default now()
);

alter table public.staff_photo_versions enable row level security;
alter table public.staff_photo_exemptions enable row level security;

drop policy if exists "own or admin reads photo versions" on public.staff_photo_versions;
create policy "own or admin reads photo versions" on public.staff_photo_versions
  for select to authenticated
  using (lower(staff_email) = lower(auth.jwt() ->> 'email') or public.is_active_staff_admin());

drop policy if exists "admins read photo exemptions" on public.staff_photo_exemptions;
create policy "admins read photo exemptions" on public.staff_photo_exemptions
  for select to authenticated
  using (public.is_active_staff_admin());

-- No insert / update / delete policies: the sp_* RPCs write these tables.
revoke all on public.staff_photo_versions from anon;
revoke all on public.staff_photo_exemptions from anon;
revoke insert, update, delete, truncate on public.staff_photo_versions from authenticated;
revoke insert, update, delete, truncate on public.staff_photo_exemptions from authenticated;

-- ---------------------------------------------------------------------------
-- 2. staff_profiles_guard: photo_path changes only through the sp_* RPCs
--    (body copied from the live function; only the photo_path check changed)
-- ---------------------------------------------------------------------------
create or replace function public.staff_profiles_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_email text := lower(auth.jwt() ->> 'email');
begin
  if v_email is null or v_email = '' then
    raise exception 'staff_profiles: no signed-in email';
  end if;
  new.email := lower(coalesce(new.email, v_email));
  if new.email <> v_email and not public.is_active_staff_admin() then
    raise exception 'you can only edit your own profile' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.email <> old.email then
    raise exception 'profile email cannot change' using errcode = '22023';
  end if;
  -- Retired 2026-10-12: staff.name is the one name (set_my_staff_name).
  -- Ignored rather than rejected so an old open tab still saves title/phone.
  new.display_name := null;
  new.title := nullif(btrim(new.title), '');
  new.phone := nullif(btrim(new.phone), '');
  -- photo_path changes only through the sp_* RPCs (supabase/staff-photo.sql),
  -- which set mgb.staff_photo_rpc locally. Anything else is ignored rather than
  -- rejected, so an old open Settings tab still saves title and phone.
  if coalesce(current_setting('mgb.staff_photo_rpc', true), '') <> 'on' then
    if tg_op = 'UPDATE' then new.photo_path := old.photo_path; else new.photo_path := null; end if;
  end if;
  if new.photo_path is not null and left(new.photo_path, char_length(new.email) + 1) <> new.email || '/' then
    raise exception 'photo must be in the staff member''s own folder' using errcode = '22023';
  end if;
  if new.birthday is not null and (new.birthday < date '1900-01-01' or new.birthday > current_date) then
    raise exception 'birthday must be a past date' using errcode = '22023';
  end if;
  if new.start_date is not null and (new.start_date < date '1950-01-01' or new.start_date > current_date + 366) then
    raise exception 'start date is out of range' using errcode = '22023';
  end if;
  new.updated_at := now();
  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 3. Internal helpers (not callable by browsers)
-- ---------------------------------------------------------------------------
create or replace function public.sp_status_for(p_email text)
returns table(status text, current_path text, current_kind text, original_path text, exempt boolean)
language sql stable security definer set search_path = public as $$
  with p as (select photo_path from staff_profiles where email = lower(p_email)),
       cur as (select v.kind from staff_photo_versions v, p
               where v.storage_path = p.photo_path and v.deleted_at is null),
       orig as (select v.storage_path from staff_photo_versions v
                where v.staff_email = lower(p_email) and v.kind = 'original' and v.deleted_at is null
                order by v.created_at desc limit 1),
       ex as (select exists (select 1 from staff_photo_exemptions e where e.staff_email = lower(p_email)) as x)
  select case
           when (select photo_path from p) is null then case when ex.x then 'exempt' else 'missing' end
           when (select kind from cur) = 'admin_edit' then 'edited'
           else 'submitted'
         end,
         (select photo_path from p), (select kind from cur), (select storage_path from orig), ex.x
  from ex;
$$;
revoke all on function public.sp_status_for(text) from public, anon, authenticated;

create or replace function public.sp_audit(p_action text, p_email text, p_details jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.audit_write(p_action, null, 'staff', lower(p_email), coalesce(p_details, '{}'::jsonb));
  insert into staff_audit_log (actor_email, action, target_email, detail)
  values (coalesce(lower(auth.jwt() ->> 'email'), 'system'), p_action, lower(p_email), p_details::text);
end $$;
revoke all on function public.sp_audit(text, text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. RPCs (all: security definer, signed-in only, no anon)
-- ---------------------------------------------------------------------------

-- The signed-in staffer's own photo status (gate + Settings).
create or replace function public.sp_my_photo_status()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me  text := lower(auth.jwt() ->> 'email');
  v_row record;
  v_new boolean;
begin
  if v_me is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if not public.is_active_staff() then
    return jsonb_build_object('status', 'none', 'required', false);
  end if;
  select * into v_row from public.sp_status_for(v_me);
  select (s.created_at > now() - interval '30 days') into v_new from staff s where s.email = v_me;
  return jsonb_build_object(
    'status', v_row.status,
    'required', v_row.status = 'missing',
    'current_path', v_row.current_path,
    'current_kind', v_row.current_kind,
    'original_path', v_row.original_path,
    'exempt', v_row.exempt,
    'is_new_hire', coalesce(v_new, false)
  );
end $$;

-- A staffer submits their own photo: an original (<= 2048 px) and a 512 px square crop.
create or replace function public.sp_submit_my_photo(p_original_path text, p_current_path text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me     text := lower(auth.jwt() ->> 'email');
  v_prev   text;
  v_sub    uuid := gen_random_uuid();
  v_prefix text;
begin
  if v_me is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if not public.is_active_staff() then
    raise exception 'only active staff can add a profile photo' using errcode = '42501';
  end if;
  v_prefix := v_me || '/';
  if p_original_path is null or p_current_path is null
     or left(p_original_path, char_length(v_prefix)) <> v_prefix
     or left(p_current_path, char_length(v_prefix)) <> v_prefix
     or substr(p_original_path, char_length(v_prefix) + 1) !~ '^original-[0-9]{10,16}\.jpg$'
     or substr(p_current_path, char_length(v_prefix) + 1) !~ '^current-[0-9]{10,16}\.jpg$' then
    raise exception 'photo files must be in your own folder with the expected names' using errcode = '22023';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'staff-avatars' and o.name = p_original_path)
     or not exists (select 1 from storage.objects o where o.bucket_id = 'staff-avatars' and o.name = p_current_path) then
    raise exception 'photo upload not found. Try again' using errcode = '22023';
  end if;
  if exists (select 1 from staff_photo_versions v where v.storage_path in (p_original_path, p_current_path)) then
    raise exception 'that photo was already submitted' using errcode = '22023';
  end if;

  select status into v_prev from public.sp_status_for(v_me);

  insert into staff_photo_versions (staff_email, submission_id, kind, storage_path, uploaded_by) values
    (v_me, v_sub, 'original',   p_original_path, v_me),
    (v_me, v_sub, 'staff_crop', p_current_path,  v_me);

  perform set_config('mgb.staff_photo_rpc', 'on', true);
  insert into staff_profiles (email, photo_path) values (v_me, p_current_path)
  on conflict (email) do update set photo_path = excluded.photo_path;
  perform set_config('mgb.staff_photo_rpc', 'off', true);

  insert into staff_onboarding_progress (staff_email, step_key, done_at)
  values (v_me, 'profile-photo', now())
  on conflict (staff_email, step_key) do update
    set done_at = coalesce(staff_onboarding_progress.done_at, now());

  perform public.sp_audit('staff_photo.submitted', v_me, jsonb_build_object('resubmit', v_prev = 'edited'));
  return public.sp_my_photo_status();
end $$;

-- Admin: every staff row with the derived photo status.
create or replace function public.sp_admin_photo_list()
returns table(email text, name text, role text, active boolean, status text, current_path text,
              current_kind text, original_path text, submitted_at timestamptz, edited_at timestamptz,
              edited_by text, exempt_reason text, is_new_hire boolean)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if auth.jwt() ->> 'email' is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if not public.is_active_staff_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  return query
  select s.email, s.name, s.role, s.active,
         st.status, st.current_path, st.current_kind, st.original_path,
         (select max(v.created_at) from staff_photo_versions v
           where v.staff_email = s.email and v.kind in ('staff_crop','original') and v.deleted_at is null),
         ed.created_at, ed.uploaded_by,
         (select e.reason from staff_photo_exemptions e where e.staff_email = s.email),
         (s.created_at > now() - interval '30 days')
  from staff s
  cross join lateral public.sp_status_for(s.email) st
  left join lateral (
    select v.created_at, v.uploaded_by from staff_photo_versions v
     where v.staff_email = s.email and v.kind = 'admin_edit' and v.deleted_at is null
     order by v.created_at desc limit 1
  ) ed on true
  order by s.active desc, s.name, s.email;
end $$;

-- Admin: non-deleted versions for one staffer, newest first.
create or replace function public.sp_admin_photo_history(p_staff_email text)
returns table(id uuid, submission_id uuid, kind text, storage_path text, uploaded_by text,
              note text, created_at timestamptz, is_current boolean)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if auth.jwt() ->> 'email' is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if not public.is_active_staff_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  return query
  select v.id, v.submission_id, v.kind, v.storage_path, v.uploaded_by, v.note, v.created_at,
         v.storage_path is not distinct from (select p.photo_path from staff_profiles p where p.email = lower(p_staff_email))
  from staff_photo_versions v
  where v.staff_email = lower(p_staff_email) and v.deleted_at is null
  order by v.created_at desc;
end $$;

-- Admin: make an edited PNG the staffer's current photo.
create or replace function public.sp_admin_replace_staff_photo(p_staff_email text, p_path text, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me     text := lower(auth.jwt() ->> 'email');
  v_target text := lower(p_staff_email);
  v_prefix text;
  v_sub    uuid;
begin
  if v_me is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if not public.is_active_staff_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  if not exists (select 1 from staff s where s.email = v_target) then
    raise exception 'unknown staff member' using errcode = '22023';
  end if;
  v_prefix := v_target || '/';
  if p_path is null or left(p_path, char_length(v_prefix)) <> v_prefix
     or substr(p_path, char_length(v_prefix) + 1) !~ '^edited-[0-9]{10,16}\.png$' then
    raise exception 'edited photo must be in the staff member''s folder with the expected name' using errcode = '22023';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'staff-avatars' and o.name = p_path) then
    raise exception 'photo upload not found. Try again' using errcode = '22023';
  end if;
  if exists (select 1 from staff_photo_versions v where v.storage_path = p_path) then
    raise exception 'that photo was already used' using errcode = '22023';
  end if;

  select v.submission_id into v_sub from staff_photo_versions v
   where v.staff_email = v_target and v.kind = 'original'
   order by v.deleted_at is not null, v.created_at desc limit 1;
  v_sub := coalesce(v_sub, gen_random_uuid());

  insert into staff_photo_versions (staff_email, submission_id, kind, storage_path, uploaded_by, note)
  values (v_target, v_sub, 'admin_edit', p_path, v_me, nullif(btrim(p_note), ''));

  perform set_config('mgb.staff_photo_rpc', 'on', true);
  insert into staff_profiles (email, photo_path) values (v_target, p_path)
  on conflict (email) do update set photo_path = excluded.photo_path;
  perform set_config('mgb.staff_photo_rpc', 'off', true);

  perform public.sp_audit('staff_photo.replaced', v_target, jsonb_build_object('path', p_path, 'note', nullif(btrim(p_note), '')));
  return jsonb_build_object('status', 'edited');
end $$;

-- Admin: show the staffer's own cropped square again (else their latest original).
create or replace function public.sp_admin_restore_staff_photo(p_staff_email text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me     text := lower(auth.jwt() ->> 'email');
  v_target text := lower(p_staff_email);
  v_path   text;
begin
  if v_me is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if not public.is_active_staff_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  if not exists (select 1 from staff s where s.email = v_target) then
    raise exception 'unknown staff member' using errcode = '22023';
  end if;

  select v.storage_path into v_path from staff_photo_versions v
   where v.staff_email = v_target and v.kind = 'staff_crop' and v.deleted_at is null
   order by v.created_at desc limit 1;
  if v_path is null then
    select v.storage_path into v_path from staff_photo_versions v
     where v.staff_email = v_target and v.kind = 'original' and v.deleted_at is null
     order by v.created_at desc limit 1;
  end if;
  if v_path is null then raise exception 'no original to restore' using errcode = '22023'; end if;

  perform set_config('mgb.staff_photo_rpc', 'on', true);
  insert into staff_profiles (email, photo_path) values (v_target, v_path)
  on conflict (email) do update set photo_path = excluded.photo_path;
  perform set_config('mgb.staff_photo_rpc', 'off', true);

  perform public.sp_audit('staff_photo.restored', v_target, jsonb_build_object('path', v_path));
  return jsonb_build_object('status', 'submitted');
end $$;

-- Admin: Not required switch (an exempt staffer with no photo never sees the gate).
create or replace function public.sp_admin_set_photo_exempt(p_staff_email text, p_exempt boolean, p_reason text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me     text := lower(auth.jwt() ->> 'email');
  v_target text := lower(p_staff_email);
begin
  if v_me is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if not public.is_active_staff_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  if not exists (select 1 from staff s where s.email = v_target) then
    raise exception 'unknown staff member' using errcode = '22023';
  end if;
  if coalesce(p_exempt, false) then
    insert into staff_photo_exemptions (staff_email, reason, set_by)
    values (v_target, nullif(btrim(p_reason), ''), v_me)
    on conflict (staff_email) do update
      set reason = excluded.reason, set_by = excluded.set_by, set_at = now();
    perform public.sp_audit('staff_photo.exempt_on', v_target, jsonb_build_object('reason', nullif(btrim(p_reason), '')));
  else
    delete from staff_photo_exemptions where staff_email = v_target;
    perform public.sp_audit('staff_photo.exempt_off', v_target, '{}'::jsonb);
  end if;
end $$;

-- Admin: soft-hide one history row (the storage object is never deleted).
create or replace function public.sp_admin_hide_photo_version(p_version_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me  text := lower(auth.jwt() ->> 'email');
  v_row staff_photo_versions%rowtype;
begin
  if v_me is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if not public.is_active_staff_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  select * into v_row from staff_photo_versions v where v.id = p_version_id and v.deleted_at is null;
  if not found then raise exception 'version not found' using errcode = '22023'; end if;
  if exists (select 1 from staff_profiles p where p.email = v_row.staff_email and p.photo_path = v_row.storage_path) then
    raise exception 'restore or replace first' using errcode = '22023';
  end if;
  if v_row.kind = 'original' and not exists (
       select 1 from staff_photo_versions v
        where v.staff_email = v_row.staff_email and v.kind = 'original'
          and v.deleted_at is null and v.id <> v_row.id) then
    raise exception 'the only original cannot be hidden' using errcode = '22023';
  end if;
  update staff_photo_versions set deleted_at = now(), deleted_by = v_me where id = v_row.id;
  perform public.sp_audit('staff_photo.version_hidden', v_row.staff_email,
    jsonb_build_object('version_id', v_row.id, 'kind', v_row.kind, 'path', v_row.storage_path));
end $$;

-- Admin: record that photos were downloaded (never blocks the download itself).
create or replace function public.sp_admin_log_photo_download(p_staff_emails text[], p_what text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me     text := lower(auth.jwt() ->> 'email');
  v_emails text[];
  v_email  text;
begin
  if v_me is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if not public.is_active_staff_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  if p_what is null or p_what not in ('original', 'current', 'zip') then
    raise exception 'unknown download type' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct lower(btrim(e))), '{}') into v_emails
    from unnest(coalesce(p_staff_emails, '{}')) e where btrim(coalesce(e, '')) <> '';
  if cardinality(v_emails) = 0 then return; end if;
  v_emails := v_emails[1:200];

  perform public.audit_write('staff_photo.downloaded', null, 'staff',
    case when cardinality(v_emails) > 1 then 'bulk' else v_emails[1] end,
    jsonb_build_object('emails', to_jsonb(v_emails), 'what', p_what));
  foreach v_email in array v_emails loop
    insert into staff_audit_log (actor_email, action, target_email, detail)
    values (v_me, 'staff_photo.downloaded', v_email, jsonb_build_object('what', p_what)::text);
  end loop;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'sp_my_photo_status()',
    'sp_submit_my_photo(text,text)',
    'sp_admin_photo_list()',
    'sp_admin_photo_history(text)',
    'sp_admin_replace_staff_photo(text,text,text)',
    'sp_admin_restore_staff_photo(text)',
    'sp_admin_set_photo_exempt(text,boolean,text)',
    'sp_admin_hide_photo_version(uuid)',
    'sp_admin_log_photo_download(text[],text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Storage: staff-avatars (objects are never updated or deleted)
-- ---------------------------------------------------------------------------
update storage.buckets set file_size_limit = 5242880,
  allowed_mime_types = array['image/png','image/jpeg','image/webp']
where id = 'staff-avatars';

drop policy if exists "staff update own avatar" on storage.objects;
drop policy if exists "staff delete own avatar" on storage.objects;

drop policy if exists "staff upload own avatar" on storage.objects;
create policy "staff upload own avatar" on storage.objects for insert to authenticated
with check (
  bucket_id = 'staff-avatars' and public.is_active_staff()
  and (storage.foldername(name))[1] = lower(auth.jwt() ->> 'email')
  and storage.filename(name) ~ '^(original|current)-[0-9]{10,16}\.jpg$'
);

drop policy if exists "admins upload edited staff photo" on storage.objects;
create policy "admins upload edited staff photo" on storage.objects for insert to authenticated
with check (
  bucket_id = 'staff-avatars' and public.is_active_staff_admin()
  -- objects.name, not bare name: inside the subquery a bare "name" binds to
  -- staff.name and the check never matches (fixed 2026-10-16 review).
  and exists (select 1 from public.staff s where s.email = (storage.foldername(objects.name))[1])
  and storage.filename(objects.name) ~ '^edited-[0-9]{10,16}\.png$'
);

-- Read: narrowed, never widened (decision B10).
create or replace function public.sp_can_read_avatar(p_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select
    -- own folder (originals, history)
    ((storage.foldername(p_name))[1] = lower(auth.jwt() ->> 'email') and public.is_active_staff())
    -- real admins: everything
    or public.is_active_staff_admin()
    -- active staff: anyone's CURRENT photo
    or (public.is_active_staff() and exists (select 1 from staff_profiles p where p.photo_path = p_name))
    -- client users: the current photo of their client's bookkeeper or account manager (unchanged audience)
    or exists (
      select 1 from client_users cu
      join clients c on c.id = cu.client_id
      join staff_profiles p on p.photo_path = p_name
        and p.email in (lower(c.assigned_bookkeeper_email), lower(c.account_manager_email))
      where lower(cu.email) = lower(auth.jwt() ->> 'email') and cu.active);
$$;
revoke all on function public.sp_can_read_avatar(text) from public, anon;
grant execute on function public.sp_can_read_avatar(text) to authenticated;

drop policy if exists "read staff avatars" on storage.objects;
create policy "read staff avatars" on storage.objects for select to authenticated
using (bucket_id = 'staff-avatars' and public.sp_can_read_avatar(name));

-- ---------------------------------------------------------------------------
-- 6. Onboarding step and backfill
-- ---------------------------------------------------------------------------
insert into public.staff_onboarding_steps (key, title, description, guide_slug, sort) values
  ('profile-photo', 'Add your profile photo',
   'A clear, recent photo of your face and shoulders. An admin tidies the background so every photo matches.',
   'profile-photo', 5)
on conflict (key) do nothing;

-- Existing photos become the staffer's submitted original (status "Needs edit").
insert into public.staff_photo_versions (staff_email, submission_id, kind, storage_path, uploaded_by, note)
select s.email, gen_random_uuid(), 'original', p.photo_path, s.email, 'Backfilled from the photo set before 2026-10-16'
from public.staff_profiles p
join public.staff s on s.email = p.email
where p.photo_path is not null
on conflict (storage_path) do nothing;

-- Tick the onboarding step for them. staff_onboarding_progress_guard_trg works
-- without a JWT (done_by keeps the value given), so it stays enabled.
insert into public.staff_onboarding_progress (staff_email, step_key, done_at, done_by)
select s.email, 'profile-photo', now(), 'system'
from public.staff_profiles p
join public.staff s on s.email = p.email
where p.photo_path is not null
on conflict (staff_email, step_key) do nothing;

commit;
