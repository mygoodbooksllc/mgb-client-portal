-- Client SOPs: a per-client standard operating procedure, split into
-- sections ("Bank & credit card feeds", "Monthly close steps", ...), so
-- another bookkeeper can step in and run the books.
--
-- Builds on staff-schema.sql (is_active_staff()) and
-- audit-hardening-client-scoping.sql (can_access_client()). Run those first.
--
-- Safe to re-run: `create table if not exists`, policies dropped before being
-- recreated, `create or replace function`, triggers dropped before being
-- recreated, and a guarded publication add.
--
-- Decisions (owner-approved):
--   * Anyone who can access the client (can_access_client: assigned
--     bookkeepers, plus admins) may read and edit its SOP.
--   * Every prior version is kept in client_sop_history.
--   * Clients never see SOPs: there is deliberately no client_users policy on
--     either table. Any future edit to this file must not add one.
--
-- Section templates (titles + hints) live in the app (CLIENT_SOP_SECTIONS in
-- app.jsx); a row only exists once someone writes a section.
--
-- What this does:
--   1. client_sops: one row per (client_id, section). `version` starts at 1
--      and goes up by one on every update.
--   2. client_sop_history: the OLD row on every update or delete, written by
--      an AFTER trigger (security definer, so nobody can insert or edit
--      history directly). history.sop_id is ON DELETE SET NULL rather than
--      cascade, so deleting a section keeps its history (the final version is
--      recorded with sop_id null; client_id + section still identify it).
--   3. A BEFORE trigger stamps updated_by from the JWT email (never trusted
--      from the browser; left alone when there is no JWT email, e.g. the
--      service role), updated_at = now(), version = old.version + 1, and pins
--      id / client_id / section / created_at on update.
--   4. save_client_sop(...): optimistic-concurrency save. Inserts when
--      p_expected_version is 0/null, otherwise updates only if the row is
--      still at p_expected_version. A lost race raises
--      errcode P0001, message 'sop_version_conflict' (the app shows "Updated
--      by X just now — review their version"). Security invoker: RLS applies.
--   5. RLS: is_active_staff() and can_access_client(client_id) for
--      select/insert/update/delete on client_sops; select only on history.
--   6. Both tables join the supabase_realtime publication (guarded).

-- ---------------------------------------------------------------------------
-- 1. client_sops
-- ---------------------------------------------------------------------------

create table if not exists public.client_sops (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,
  section text not null,
  title text,
  body text not null default '',
  sort int not null default 0,
  version int not null default 1,
  updated_by text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint client_sops_client_section_key unique (client_id, section)
);

-- ---------------------------------------------------------------------------
-- 2. client_sop_history
-- ---------------------------------------------------------------------------

create table if not exists public.client_sop_history (
  id uuid primary key default gen_random_uuid(),
  sop_id uuid references public.client_sops(id) on delete set null,
  client_id text not null,
  section text not null,
  title text,
  body text not null default '',
  version int not null,
  edited_by text,
  edited_at timestamptz,
  archived_at timestamptz not null default now()
);

create index if not exists client_sop_history_client_section_idx
  on public.client_sop_history (client_id, section, version desc);
create index if not exists client_sop_history_sop_idx
  on public.client_sop_history (sop_id);

-- ---------------------------------------------------------------------------
-- 3. Triggers
-- ---------------------------------------------------------------------------

create or replace function public.client_sops_stamp()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_email text := nullif(auth.jwt() ->> 'email', '');
begin
  if tg_op = 'UPDATE' then
    new.id := old.id;
    new.client_id := old.client_id;
    new.section := old.section;
    new.created_at := old.created_at;
    new.version := old.version + 1;
  else
    new.version := 1;
    new.created_at := now();
  end if;
  new.updated_at := now();
  if v_email is not null then
    new.updated_by := v_email;
  end if;
  return new;
end;
$$;

drop trigger if exists client_sops_stamp on public.client_sops;
create trigger client_sops_stamp
  before insert or update on public.client_sops
  for each row execute function public.client_sops_stamp();

-- Security definer so the archive insert succeeds without an insert policy on
-- client_sop_history (users can't write history directly).
create or replace function public.client_sops_archive()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into client_sop_history (
    sop_id, client_id, section, title, body, version, edited_by, edited_at
  ) values (
    case when tg_op = 'DELETE' then null else old.id end,
    old.client_id, old.section, old.title, old.body, old.version,
    old.updated_by, old.updated_at
  );
  return null;
end;
$$;

revoke all on function public.client_sops_archive() from public, anon, authenticated;
revoke all on function public.client_sops_stamp() from public, anon;

drop trigger if exists client_sops_archive on public.client_sops;
create trigger client_sops_archive
  after update or delete on public.client_sops
  for each row execute function public.client_sops_archive();

-- ---------------------------------------------------------------------------
-- 4. save_client_sop — optimistic concurrency
-- ---------------------------------------------------------------------------

create or replace function public.save_client_sop(
  p_client_id text,
  p_section text,
  p_title text,
  p_body text,
  p_expected_version int,
  p_sort int default 0
)
returns setof public.client_sops
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row client_sops%rowtype;
begin
  if coalesce(p_expected_version, 0) = 0 then
    insert into client_sops (client_id, section, title, body, sort)
      values (p_client_id, p_section, p_title, coalesce(p_body, ''), coalesce(p_sort, 0))
      on conflict (client_id, section) do nothing
      returning * into v_row;
  else
    update client_sops
      set title = p_title,
          body = coalesce(p_body, '')
      where client_id = p_client_id
        and section = p_section
        and version = p_expected_version
      returning * into v_row;
  end if;

  if v_row.id is null then
    -- Someone else created or saved this section first (or it isn't visible
    -- to this caller under RLS). The app re-reads the row and lets the user
    -- choose between their text and the latest version.
    raise exception 'sop_version_conflict' using errcode = 'P0001';
  end if;

  return next v_row;
end;
$$;

revoke all on function public.save_client_sop(text, text, text, text, int, int) from public, anon;
grant execute on function public.save_client_sop(text, text, text, text, int, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. RLS — staff with access to the client only; never clients.
-- ---------------------------------------------------------------------------

alter table public.client_sops enable row level security;
alter table public.client_sop_history enable row level security;

revoke all on public.client_sops from anon;
revoke all on public.client_sop_history from anon;
revoke insert, update, delete on public.client_sop_history from authenticated;

drop policy if exists "staff read client sops" on public.client_sops;
create policy "staff read client sops"
  on public.client_sops for select
  using (public.is_active_staff() and public.can_access_client(client_id));

drop policy if exists "staff insert client sops" on public.client_sops;
create policy "staff insert client sops"
  on public.client_sops for insert
  with check (public.is_active_staff() and public.can_access_client(client_id));

drop policy if exists "staff update client sops" on public.client_sops;
create policy "staff update client sops"
  on public.client_sops for update
  using (public.is_active_staff() and public.can_access_client(client_id))
  with check (public.is_active_staff() and public.can_access_client(client_id));

drop policy if exists "staff delete client sops" on public.client_sops;
create policy "staff delete client sops"
  on public.client_sops for delete
  using (public.is_active_staff() and public.can_access_client(client_id));

drop policy if exists "staff read client sop history" on public.client_sop_history;
create policy "staff read client sop history"
  on public.client_sop_history for select
  using (public.is_active_staff() and public.can_access_client(client_id));

-- ---------------------------------------------------------------------------
-- 6. Realtime (RLS still applies per subscriber; the app listens on a
--    private channel like client_private_notes does)
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    return;
  end if;
  foreach t in array array['client_sops', 'client_sop_history'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;
