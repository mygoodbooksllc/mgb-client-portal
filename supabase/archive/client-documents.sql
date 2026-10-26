-- Applied live via Supabase MCP apply_migration (name: client_documents).
-- Metadata only, by design: Supabase never holds the actual file, just a
-- pointer to where it already lives in the client's Google Drive.
create table if not exists client_documents (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,
  name text not null,
  drive_url text not null,
  category text,
  added_by text,
  created_at timestamptz not null default now()
);

alter table client_documents enable row level security;

drop policy if exists "staff manage documents" on client_documents;
create policy "staff manage documents"
  on client_documents for all
  using (is_active_staff())
  with check (is_active_staff());

drop policy if exists "client reads own documents" on client_documents;
create policy "client reads own documents"
  on client_documents for select
  using (
    exists (
      select 1 from client_users cu
      where cu.client_id = client_documents.client_id
        and cu.email = auth.jwt() ->> 'email'
        and cu.active
    )
  );
