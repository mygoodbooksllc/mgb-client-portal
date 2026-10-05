-- Staff-only documents (owner request 2026-10-05: page-wide file drop).
--
-- Staff can drop a file anywhere on a client's pages and choose whether the
-- client can see it. Files the client can see go where they always have,
-- client-uploads/<client_id>/shared/. Staff-only files go under
-- client-uploads/<client_id>/internal/, and this script keeps client users
-- from reading or writing that folder. Staff policies are unchanged
-- ("staff read/write client uploads": active staff with access to the
-- client).
--
-- Replaces the two client policies from client-messages-realtime.sql, keeping
-- their messages-folder rule exactly as it was. Safe to re-run.

drop policy if exists "client reads own uploads" on storage.objects;
create policy "client reads own uploads" on storage.objects
  for select using (
    bucket_id = 'client-uploads'
    and public.is_client_member((storage.foldername(objects.name))[1])
    and coalesce((storage.foldername(objects.name))[2], '') <> 'internal'
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
    and coalesce((storage.foldername(objects.name))[2], '') <> 'internal'
    and (
      coalesce((storage.foldername(objects.name))[2], '') <> 'messages'
      or (storage.foldername(objects.name))[3] = lower(auth.jwt() ->> 'email')
    )
  );
