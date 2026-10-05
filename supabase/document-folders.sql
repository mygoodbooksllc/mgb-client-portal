-- Shared document folders + Delete forever (owner request 2026-10-05).
--
-- Folders on the Documents page used to live in each browser's
-- localStorage, so a client and their bookkeeper (or two staff) saw
-- different folders. They now live here, per client, so everyone sees the
-- same ones. Every client starts with five default folders.
--
--   document_folders       one row per folder name
--   document_folder_items  which folder each document is in, keyed the
--                          same way the app keys documents:
--                            file:<stored>            client-visible upload
--                            file:internal/<stored>   staff-only upload
--                            link:<client_documents.id>
--                            sample:<name>            prototype sample docs
--
-- Client users can manage folders like before, but never see or file
-- staff-only keys. Staff with access to the client can do everything.
--
-- Also lets staff delete for good, but only items already in Trash:
-- files under <client>/trash/ and links with trashed_at set. Trash itself
-- never empties on its own (owner: keep Trash forever).
--
-- Builds on document-trash.sql. Safe to re-run.

create table if not exists public.document_folders (
  client_id  text not null references public.clients(id) on delete cascade,
  name       text not null check (length(btrim(name)) between 1 and 60),
  sort       int not null default 0,
  created_at timestamptz not null default now(),
  created_by text default (auth.jwt() ->> 'email'),
  primary key (client_id, name)
);

create table if not exists public.document_folder_items (
  client_id  text not null,
  doc_key    text not null check (length(doc_key) between 1 and 400),
  folder     text not null,
  updated_at timestamptz not null default now(),
  updated_by text default (auth.jwt() ->> 'email'),
  primary key (client_id, doc_key),
  foreign key (client_id, folder) references public.document_folders(client_id, name)
    on delete cascade on update cascade
);

alter table public.document_folders enable row level security;
alter table public.document_folder_items enable row level security;

drop policy if exists "staff manage document folders" on public.document_folders;
create policy "staff manage document folders" on public.document_folders
  for all using (public.is_active_staff() and public.can_access_client(client_id))
  with check (public.is_active_staff() and public.can_access_client(client_id));

drop policy if exists "client manages own document folders" on public.document_folders;
create policy "client manages own document folders" on public.document_folders
  for all using (public.is_client_member(client_id))
  with check (public.is_client_member(client_id));

drop policy if exists "staff manage document folder items" on public.document_folder_items;
create policy "staff manage document folder items" on public.document_folder_items
  for all using (public.is_active_staff() and public.can_access_client(client_id))
  with check (public.is_active_staff() and public.can_access_client(client_id));

drop policy if exists "client manages own document folder items" on public.document_folder_items;
create policy "client manages own document folder items" on public.document_folder_items
  for all using (public.is_client_member(client_id) and doc_key not like 'file:internal/%')
  with check (public.is_client_member(client_id) and doc_key not like 'file:internal/%');

grant select, insert, update, delete on public.document_folders to authenticated;
grant select, insert, update, delete on public.document_folder_items to authenticated;

-- Default folders: for every existing client now, and each new client.
create or replace function public.seed_document_folders(p_client_id text)
returns void language sql security definer set search_path = public as $$
  insert into public.document_folders (client_id, name, sort, created_by)
  select p_client_id, d.name, d.sort, 'default'
  from (values
    ('Bank statements', 1),
    ('Financial statements', 2),
    ('Tax', 3),
    ('Receipts', 4),
    ('Payroll', 5)
  ) as d(name, sort)
  on conflict do nothing;
$$;
revoke all on function public.seed_document_folders(text) from public, anon, authenticated;

create or replace function public.seed_document_folders_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.seed_document_folders(new.id);
  return new;
end;
$$;
revoke all on function public.seed_document_folders_trigger() from public, anon, authenticated;

drop trigger if exists seed_document_folders on public.clients;
create trigger seed_document_folders after insert on public.clients
  for each row execute function public.seed_document_folders_trigger();

-- Backfill clients that have no folders at all. (Re-running this would
-- re-add defaults for a client whose folders were all deleted.)
select public.seed_document_folders(c.id)
from public.clients c
where not exists (select 1 from public.document_folders f where f.client_id = c.id);

-- Delete forever: staff, Trash only.
drop policy if exists "staff delete trashed uploads" on storage.objects;
create policy "staff delete trashed uploads" on storage.objects
  for delete using (
    bucket_id = 'client-uploads'
    and public.is_active_staff()
    and public.can_access_client((storage.foldername(objects.name))[1])
    and (storage.foldername(objects.name))[2] = 'trash'
  );
