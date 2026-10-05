-- Documents trash (owner request 2026-10-05).
--
-- Staff can move a client's document to Trash and restore it later. Nothing
-- is permanently deleted.
--
--   Uploaded files move from <client>/shared/... or <client>/internal/... to
--   <client>/trash/shared/... or <client>/trash/internal/..., and back on
--   restore. Client users can't read trash/.
--   Shared links (client_documents rows) get trashed_at set; client users
--   only see rows where it's null.
--
-- Builds on staff-only-documents.sql. Safe to re-run.

-- Storage move() needs UPDATE on the object. Staff only, and both the old
-- and new path must belong to a client they can access.
drop policy if exists "staff move client uploads" on storage.objects;
create policy "staff move client uploads" on storage.objects
  for update using (
    bucket_id = 'client-uploads'
    and public.is_active_staff()
    and public.can_access_client((storage.foldername(objects.name))[1])
  ) with check (
    bucket_id = 'client-uploads'
    and public.is_active_staff()
    and public.can_access_client((storage.foldername(objects.name))[1])
  );

drop policy if exists "client reads own uploads" on storage.objects;
create policy "client reads own uploads" on storage.objects
  for select using (
    bucket_id = 'client-uploads'
    and public.is_client_member((storage.foldername(objects.name))[1])
    and coalesce((storage.foldername(objects.name))[2], '') not in ('internal', 'trash')
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
    and coalesce((storage.foldername(objects.name))[2], '') not in ('internal', 'trash')
    and (
      coalesce((storage.foldername(objects.name))[2], '') <> 'messages'
      or (storage.foldername(objects.name))[3] = lower(auth.jwt() ->> 'email')
    )
  );

alter table public.client_documents add column if not exists trashed_at timestamptz;

drop policy if exists "client reads own documents" on public.client_documents;
create policy "client reads own documents" on public.client_documents
  for select using (
    trashed_at is null
    and exists (
      select 1 from public.client_users cu
      where cu.client_id = client_documents.client_id
        and cu.email = (auth.jwt() ->> 'email')
        and cu.active
    )
  );
