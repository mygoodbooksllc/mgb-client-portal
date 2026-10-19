-- Staff photo paths for every active staff member (so avatars can show
-- teammates' photos). Additive and safe to re-run. Applied to production 2026-10-20
-- as migration staff_photo_paths.
--
-- Storage already lets any active staff member read anyone's CURRENT photo
-- (sp_can_read_avatar in staff-photo.sql). What was missing is a way to learn
-- the path: staff_profiles is readable only by its owner, and sp_admin_photo_list
-- is admin only. This returns only the current-photo pointer, name and email of
-- active staff, to active staff. No originals, history, status or exemptions.

create or replace function public.sp_staff_photo_paths()
returns table(email text, name text, current_path text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if auth.jwt() ->> 'email' is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if not public.is_active_staff() then
    raise exception 'staff only' using errcode = '42501';
  end if;
  return query
  select lower(s.email), s.name, p.photo_path
    from public.staff s
    join public.staff_profiles p on lower(p.email) = lower(s.email)
   where s.active and p.photo_path is not null and p.photo_path <> '';
end $$;

revoke all on function public.sp_staff_photo_paths() from public, anon;
grant execute on function public.sp_staff_photo_paths() to authenticated;
