-- Staff tools for viewing a client (owner request 2026-09-27): the Client
-- overview page, document requests, the month-end close checklist, internal
-- notes on anything, "sent to client" history, and the data those need.
--
-- Builds on staff-schema.sql (is_active_staff), audit-hardening-client-
-- scoping.sql (can_access_client), client-users.sql, time-entries.sql and
-- usage-events.sql. Safe to re-run. Applied to production 2026-09-27.
--
--   1. client_profile        key dates, backup bookkeeper, target hourly rate
--   2. client_doc_requests   staff ask a client for a document; the client
--                            uploads into it (bucket client-uploads)
--   3. client_close_items    month-end close checklist, one row per item/month
--   4. client_internal_notes staff-only notes pinned to a transaction, budget
--                            line, report or the client as a whole
--   5. client_sent_items     what was sent to the client, and when
--   6. read access for the overview: staff can read time entries and page
--      views for clients they can access (admins already could)
--   7. upgrade requests can ask for the Payroll add-on (requested_plan
--      'payroll'), from the Payroll page a client without it sees

begin;

-- ---------------------------------------------------------------------------
-- 1. client_profile
-- ---------------------------------------------------------------------------
create table if not exists public.client_profile (
  client_id text primary key,
  fiscal_year_end text,                 -- e.g. "12-31"
  form_990_due date,
  filing_1099_due date,
  board_meeting text,                   -- free text, e.g. "2nd Tuesday monthly"
  launch_date date,                     -- church plants
  backup_bookkeeper_email text,
  target_hourly_rate numeric check (target_hourly_rate is null or target_hourly_rate >= 0),
  updated_by text,
  updated_at timestamptz not null default now()
);
alter table public.client_profile enable row level security;
revoke all on public.client_profile from anon;
drop policy if exists "staff manage client profile" on public.client_profile;
create policy "staff manage client profile" on public.client_profile
  for all using (public.is_active_staff() and public.can_access_client(client_id))
  with check (public.is_active_staff() and public.can_access_client(client_id));

-- ---------------------------------------------------------------------------
-- 2. client_doc_requests + storage
-- ---------------------------------------------------------------------------
create table if not exists public.client_doc_requests (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,
  title text not null check (length(title) between 1 and 200),
  details text check (details is null or length(details) <= 2000),
  due_date date,
  status text not null default 'open' check (status in ('open', 'uploaded', 'done', 'cancelled')),
  requested_by text,
  requested_by_name text,
  created_at timestamptz not null default now(),
  file_path text,
  file_name text,
  uploaded_by text,
  fulfilled_at timestamptz,
  closed_at timestamptz
);
create index if not exists client_doc_requests_client_idx
  on public.client_doc_requests (client_id, created_at desc);
alter table public.client_doc_requests enable row level security;
revoke all on public.client_doc_requests from anon;

drop policy if exists "staff manage doc requests" on public.client_doc_requests;
create policy "staff manage doc requests" on public.client_doc_requests
  for all using (public.is_active_staff() and public.can_access_client(client_id))
  with check (public.is_active_staff() and public.can_access_client(client_id));

drop policy if exists "client reads own doc requests" on public.client_doc_requests;
create policy "client reads own doc requests" on public.client_doc_requests
  for select using (
    exists (
      select 1 from client_users cu
      where cu.email = auth.jwt() ->> 'email'
        and cu.client_id = client_doc_requests.client_id
        and cu.active
    )
  );

-- Clients attach their upload through this function only (no direct update).
create or replace function public.fulfill_doc_request(p_id uuid, p_path text, p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := nullif(auth.jwt() ->> 'email', '');
  v_client text;
begin
  select client_id into v_client from client_doc_requests where id = p_id;
  if v_client is null or v_email is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not (
    (public.is_active_staff() and public.can_access_client(v_client))
    or exists (select 1 from client_users cu
               where cu.email = v_email and cu.client_id = v_client and cu.active)
  ) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_path is null or p_path not like v_client || '/' || p_id::text || '/%' then
    raise exception 'bad path' using errcode = '22023';
  end if;
  update client_doc_requests
     set status = 'uploaded',
         file_path = p_path,
         file_name = left(coalesce(p_name, ''), 255),
         uploaded_by = v_email,
         fulfilled_at = now()
   where id = p_id and status in ('open', 'uploaded');
end;
$$;
revoke all on function public.fulfill_doc_request(uuid, text, text) from public, anon;
grant execute on function public.fulfill_doc_request(uuid, text, text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('client-uploads', 'client-uploads', false, 26214400,
        array['application/pdf', 'image/png', 'image/jpeg', 'image/heic', 'text/csv', 'text/plain',
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              'application/vnd.ms-excel',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do nothing;

-- Paths are <client_id>/<request_id>/<file name>.
drop policy if exists "staff read client uploads" on storage.objects;
create policy "staff read client uploads" on storage.objects
  for select using (
    bucket_id = 'client-uploads'
    and public.is_active_staff()
    and public.can_access_client((storage.foldername(name))[1])
  );
drop policy if exists "staff write client uploads" on storage.objects;
create policy "staff write client uploads" on storage.objects
  for insert with check (
    bucket_id = 'client-uploads'
    and public.is_active_staff()
    and public.can_access_client((storage.foldername(name))[1])
  );
drop policy if exists "client reads own uploads" on storage.objects;
create policy "client reads own uploads" on storage.objects
  for select using (
    bucket_id = 'client-uploads'
    and exists (select 1 from client_users cu
                where cu.email = auth.jwt() ->> 'email'
                  and cu.active
                  and cu.client_id = (storage.foldername(name))[1])
  );
drop policy if exists "client uploads own files" on storage.objects;
create policy "client uploads own files" on storage.objects
  for insert with check (
    bucket_id = 'client-uploads'
    and exists (select 1 from client_users cu
                where cu.email = auth.jwt() ->> 'email'
                  and cu.active
                  and cu.client_id = (storage.foldername(name))[1])
  );

-- ---------------------------------------------------------------------------
-- 3. client_close_items
-- ---------------------------------------------------------------------------
create table if not exists public.client_close_items (
  client_id text not null,
  period text not null check (period ~ '^[0-9]{4}-[0-9]{2}$'),   -- the month being closed
  item_key text not null check (length(item_key) between 1 and 60),
  done boolean not null default false,
  done_by text,
  done_at timestamptz,
  primary key (client_id, period, item_key)
);
alter table public.client_close_items enable row level security;
revoke all on public.client_close_items from anon;
drop policy if exists "staff manage close items" on public.client_close_items;
create policy "staff manage close items" on public.client_close_items
  for all using (public.is_active_staff() and public.can_access_client(client_id))
  with check (public.is_active_staff() and public.can_access_client(client_id));

-- ---------------------------------------------------------------------------
-- 4. client_internal_notes (never visible to clients)
-- ---------------------------------------------------------------------------
create table if not exists public.client_internal_notes (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,
  target_type text not null check (target_type in ('transaction', 'budget', 'report', 'general')),
  target_key text not null check (length(target_key) between 1 and 300),
  target_label text check (target_label is null or length(target_label) <= 300),
  body text not null check (length(body) between 1 and 4000),
  author_email text,
  author_name text,
  created_at timestamptz not null default now()
);
create index if not exists client_internal_notes_client_idx
  on public.client_internal_notes (client_id, created_at desc);
alter table public.client_internal_notes enable row level security;
revoke all on public.client_internal_notes from anon;
drop policy if exists "staff manage internal notes" on public.client_internal_notes;
create policy "staff manage internal notes" on public.client_internal_notes
  for all using (public.is_active_staff() and public.can_access_client(client_id))
  with check (public.is_active_staff() and public.can_access_client(client_id));

-- ---------------------------------------------------------------------------
-- 5. client_sent_items
-- ---------------------------------------------------------------------------
create table if not exists public.client_sent_items (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,
  item_type text not null default 'report' check (item_type in ('report', 'statement', 'other')),
  item_key text not null check (length(item_key) between 1 and 100),
  item_label text,
  period_label text,
  note text check (note is null or length(note) <= 500),
  sent_by text,
  sent_by_name text,
  sent_at timestamptz not null default now()
);
create index if not exists client_sent_items_client_idx
  on public.client_sent_items (client_id, sent_at desc);
alter table public.client_sent_items enable row level security;
revoke all on public.client_sent_items from anon;
drop policy if exists "staff manage sent items" on public.client_sent_items;
create policy "staff manage sent items" on public.client_sent_items
  for all using (public.is_active_staff() and public.can_access_client(client_id))
  with check (public.is_active_staff() and public.can_access_client(client_id));

-- ---------------------------------------------------------------------------
-- 6. Overview read access
-- ---------------------------------------------------------------------------
drop policy if exists "staff read client time entries" on public.time_entries;
create policy "staff read client time entries" on public.time_entries
  for select using (
    client_id is not null and public.is_active_staff() and public.can_access_client(client_id)
  );

drop policy if exists "staff read client usage events" on public.usage_events;
create policy "staff read client usage events" on public.usage_events
  for select using (
    client_id is not null and public.is_active_staff() and public.can_access_client(client_id)
  );

-- ---------------------------------------------------------------------------
-- 7. Payroll add-on requests
-- ---------------------------------------------------------------------------
alter table public.enterprise_upgrade_requests
  drop constraint if exists enterprise_upgrade_requests_requested_plan_check;
alter table public.enterprise_upgrade_requests
  add constraint enterprise_upgrade_requests_requested_plan_check
  check (requested_plan is null or requested_plan in ('standard', 'premium', 'payroll'));

create or replace function public.request_enterprise_upgrade(
  p_client_id text,
  p_requested_by text,
  p_plan text default null
)
returns enterprise_upgrade_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_open_count integer;
  v_row enterprise_upgrade_requests;
begin
  if p_client_id is null or length(trim(p_client_id)) = 0 then
    raise exception 'invalid_client_id' using errcode = 'P0001';
  end if;

  if auth.jwt() ->> 'email' is null then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;

  if not (
    public.can_access_client(p_client_id)
    or exists (
      select 1 from client_users cu
      where cu.email = auth.jwt() ->> 'email'
        and cu.client_id = p_client_id
        and cu.active
    )
  ) then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;

  if p_requested_by is not null and length(p_requested_by) > 200 then
    raise exception 'requested_by_too_long' using errcode = 'P0001';
  end if;

  if p_plan is not null and p_plan not in ('standard', 'premium', 'payroll') then
    raise exception 'invalid_plan' using errcode = 'P0001';
  end if;

  select count(*) into v_open_count
  from enterprise_upgrade_requests
  where client_id = p_client_id and status = 'new';

  if v_open_count >= 5 then
    raise exception 'too_many_open_requests' using errcode = 'P0001';
  end if;

  insert into enterprise_upgrade_requests (client_id, requested_by, requested_plan)
  values (p_client_id, p_requested_by, p_plan)
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.request_enterprise_upgrade(text, text, text) from public, anon;
grant execute on function public.request_enterprise_upgrade(text, text, text) to authenticated;

commit;
