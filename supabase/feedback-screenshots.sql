-- Screenshots on staff bug reports / feedback (owner request 2026-09-30).
-- Applied to production 2026-09-30. Builds on supabase/staff-feedback.sql.
--
-- Staff can attach up to 3 images (png, jpeg, webp, gif; 10 MB each) in the
-- "Report a bug / feedback" modal (components/staff/Feedback.jsx). The app
-- picks the feedback row id up front, uploads the images to
--   feedback-screenshots/<author_email>/<feedback id>/<short id>-<file name>
-- and then inserts the staff_feedback row with
--   attachments = [{path, name, size, type}, ...]
-- Thumbnails are shown with 1-hour signed URLs (My feedback, admin Feedback
-- page).
--
-- Who can do what (bucket feedback-screenshots, private)
--   * active staff: upload into their own <email>/ folder, read their own files
--   * active admins: read every file, delete files
--   * nobody updates / overwrites a file (no update policy)
--
-- staff_feedback.attachments
--   * max 3 items, each {path, name, size, type}; path must sit under
--     <author_email>/<id>/, size <= 10 MB, type one of the four image types
--   * on insert the trigger checks each path really exists in the bucket
--   * locked after insert like the other sender columns (admins still only
--     change status / admin_note)

-- 1. Bucket -----------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('feedback-screenshots', 'feedback-screenshots', false, 10485760,
        array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "staff upload own feedback screenshots" on storage.objects;
create policy "staff upload own feedback screenshots" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'feedback-screenshots'
    and public.is_active_staff()
    and (storage.foldername(name))[1] = (auth.jwt() ->> 'email')
  );

drop policy if exists "staff read own feedback screenshots" on storage.objects;
create policy "staff read own feedback screenshots" on storage.objects
  for select to authenticated using (
    bucket_id = 'feedback-screenshots'
    and public.is_active_staff()
    and (storage.foldername(name))[1] = (auth.jwt() ->> 'email')
  );

drop policy if exists "admins read feedback screenshots" on storage.objects;
create policy "admins read feedback screenshots" on storage.objects
  for select to authenticated using (
    bucket_id = 'feedback-screenshots'
    and public.is_active_staff_admin()
  );

drop policy if exists "admins delete feedback screenshots" on storage.objects;
create policy "admins delete feedback screenshots" on storage.objects
  for delete to authenticated using (
    bucket_id = 'feedback-screenshots'
    and public.is_active_staff_admin()
  );

-- 2. staff_feedback.attachments ----------------------------------------------
create or replace function public.staff_feedback_attachments_ok(a jsonb, p_author text, p_id uuid)
returns boolean
language sql
immutable
set search_path = public
as $$
  select jsonb_typeof(a) = 'array'
     and jsonb_array_length(a) <= 3
     and not exists (
       select 1 from jsonb_array_elements(a) e
       where jsonb_typeof(e) <> 'object'
          or jsonb_typeof(e -> 'path') is distinct from 'string'
          or jsonb_typeof(e -> 'name') is distinct from 'string'
          or jsonb_typeof(e -> 'size') is distinct from 'number'
          or jsonb_typeof(e -> 'type') is distinct from 'string'
          or left(e ->> 'path', char_length(p_author || '/' || p_id::text || '/'))
               <> p_author || '/' || p_id::text || '/'
          or char_length(e ->> 'path') > 400
          or char_length(e ->> 'name') not between 1 and 255
          or (e ->> 'size')::numeric not between 1 and 10485760
          or (e ->> 'type') not in ('image/png', 'image/jpeg', 'image/webp', 'image/gif')
     );
$$;

alter table public.staff_feedback
  add column if not exists attachments jsonb not null default '[]'::jsonb;

alter table public.staff_feedback drop constraint if exists staff_feedback_attachments_check;
alter table public.staff_feedback add constraint staff_feedback_attachments_check
  check (public.staff_feedback_attachments_ok(attachments, author_email, id));

-- 3. Trigger: same as staff-feedback.sql plus attachments --------------------
create or replace function public.staff_feedback_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_path text;
begin
  if tg_op = 'INSERT' then
    new.author_email := auth.jwt() ->> 'email';
    new.status := 'new';
    new.admin_note := null;
    new.created_at := now();
    new.updated_at := now();
    new.attachments := coalesce(new.attachments, '[]'::jsonb);
    -- Every attachment must be a file already uploaded to the bucket.
    if jsonb_typeof(new.attachments) = 'array' then
      for v_path in select e ->> 'path' from jsonb_array_elements(new.attachments) e loop
        if v_path is null or not exists (
          select 1 from storage.objects o
          where o.bucket_id = 'feedback-screenshots' and o.name = v_path
        ) then
          raise exception 'attachment not uploaded: %', v_path using errcode = '22023';
        end if;
      end loop;
    end if;
    return new;
  end if;
  -- UPDATE: only status and admin_note may change.
  new.id := old.id;
  new.created_at := old.created_at;
  new.author_email := old.author_email;
  new.kind := old.kind;
  new.message := old.message;
  new.expected := old.expected;
  new.page := old.page;
  new.browser := old.browser;
  new.client_id := old.client_id;
  new.attachments := old.attachments;
  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function public.staff_feedback_guard() from public, anon, authenticated;
