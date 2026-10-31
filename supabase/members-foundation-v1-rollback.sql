-- Rollback for members-foundation-v1.sql. Written 2026-10-31 BEFORE applying.
-- NOT run. Run only on the owner's say-so. Order matters: the trigger goes
-- first, so staff roster saves never depend on the members tables.
--
-- 1. Edge function (from a terminal):
--      npx --yes supabase@latest functions delete members-file --project-ref xumsqmhccgfjnlmieqyu
-- 2. Bucket files: empty the 'members' bucket in the dashboard (Storage) first.
--    The bucket delete below refuses if any object is still in it.
-- 3. Then run this file.

begin;

drop trigger if exists client_users_member_access_sync on public.client_users;
drop function if exists public.member_access_sync_client_roster();

drop table if exists public.member_purchases;
drop table if exists public.member_profiles;
drop table if exists public.member_access;
drop function if exists public.member_jwt_email();

do $$
begin
  if exists (select 1 from storage.objects where bucket_id = 'members') then
    raise exception 'members bucket still has files; empty it in the dashboard first';
  end if;
  delete from storage.buckets where id = 'members';
end $$;

commit;
