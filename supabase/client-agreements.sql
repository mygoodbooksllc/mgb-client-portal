-- Client Agreements (docs/agreements-spec.md), 2026-10-28.
-- Applied to production 2026-10-28 via Supabase MCP apply_migration
-- (name: client_agreements). Additive only: a new table, three functions, one
-- trigger. Nothing about client_documents, client_files or Storage changes.
-- Self-test: client-agreements-tests.sql (rolls back).
--
-- Access, enforced here (not just in the UI):
--   * staff read with can_access_client(client_id) (admins, assigned staff,
--     live temporary grants), same as client_documents;
--   * only admins and the client's account manager (clients.
--     account_manager_email) insert or update; bookkeepers read only;
--   * nobody deletes: no DELETE grant, no DELETE policy (soft delete only);
--   * restore from trash is admin only (trigger);
--   * clients have NO policy on the table. They read through
--     client_agreements_mine(), which never returns staff_note, returns only
--     visible_to_client rows that aren't trashed, and only while the firm
--     switch tk_settings.agreements_client_enabled is true (code never sets it);
--   * anon gets nothing.

begin;

create table if not exists public.client_agreements (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,
  title text not null check (length(btrim(title)) between 1 and 200),
  agreement_type text not null default 'service_agreement'
    check (agreement_type in ('service_agreement', 'engagement_letter', 'addendum', 'nda', 'pricing_change', 'other')),
  status text not null default 'draft'
    check (status in ('draft', 'sent', 'signed', 'expired', 'terminated')),
  signed_on date,
  effective_on date,
  expires_on date,
  document_url text check (document_url is null or (document_url ~* '^https://[^\s]+$' and length(document_url) <= 2000)),
  client_file_id uuid references public.client_files(id) on delete set null,
  staff_note text check (staff_note is null or length(staff_note) <= 4000),
  visible_to_client boolean not null default false,
  client_can_sign boolean not null default false,
  created_by text,
  created_at timestamptz not null default now(),
  updated_by text,
  updated_at timestamptz not null default now(),
  trashed_at timestamptz,
  trashed_by text
);

create index if not exists client_agreements_client_idx on public.client_agreements (client_id, created_at desc);
create index if not exists client_agreements_expires_idx on public.client_agreements (expires_on) where trashed_at is null;

alter table public.client_agreements enable row level security;

-- Grants: no anon, no delete for anyone through the API.
revoke all on public.client_agreements from anon, public;
revoke delete, truncate on public.client_agreements from authenticated;
grant select, insert, update on public.client_agreements to authenticated;

-- Who may add and edit agreements for a client: admins, or the client's
-- account manager (who also needs normal access to the client).
create or replace function public.agreements_can_edit(p_client_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.can_access_client(p_client_id)
    and (
      public.is_active_staff_admin()
      or exists (
        select 1 from public.clients c
         where c.id = p_client_id
           and c.account_manager_email is not null
           and lower(c.account_manager_email) = lower(auth.jwt() ->> 'email')
      )
    ),
    false
  );
$$;
revoke all on function public.agreements_can_edit(text) from public, anon;
grant execute on function public.agreements_can_edit(text) to authenticated;

-- Same RESTRICTIVE lock every per-client table has (copied from client_documents).
drop policy if exists "internal company lock" on public.client_agreements;
create policy "internal company lock" on public.client_agreements
  as restrictive for all
  using ((client_id is null) or (client_id <> all ((select public.internal_blocked_ids())::text[])))
  with check ((client_id is null) or (client_id <> all ((select public.internal_blocked_ids())::text[])));

drop policy if exists "staff read assigned agreements" on public.client_agreements;
create policy "staff read assigned agreements" on public.client_agreements
  for select to authenticated
  using (public.can_access_client(client_id));

drop policy if exists "editors add agreements" on public.client_agreements;
create policy "editors add agreements" on public.client_agreements
  for insert to authenticated
  with check (public.agreements_can_edit(client_id));

drop policy if exists "editors update agreements" on public.client_agreements;
create policy "editors update agreements" on public.client_agreements
  for update to authenticated
  using (public.agreements_can_edit(client_id))
  with check (public.agreements_can_edit(client_id));

-- Guard: stamps, immutable fields, admin-only restore, admin-only
-- client_can_sign, Drive file must belong to the same client. Only applies to
-- browser callers (role authenticated); the SQL editor / service role pass.
create or replace function public.client_agreements_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(nullif(auth.jwt() ->> 'email', ''));
  v_admin boolean;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'authenticated' then
    return new;
  end if;
  v_admin := public.is_active_staff_admin();

  new.title := btrim(new.title);
  new.document_url := nullif(btrim(coalesce(new.document_url, '')), '');
  new.staff_note := nullif(btrim(coalesce(new.staff_note, '')), '');

  if new.client_file_id is not null and not exists (
    select 1 from public.client_files f where f.id = new.client_file_id and f.client_id = new.client_id
  ) then
    raise exception 'That file belongs to a different client.' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    new.created_by := v_email;
    new.created_at := now();
    new.updated_by := v_email;
    new.updated_at := now();
    new.trashed_at := null;
    new.trashed_by := null;
    if new.client_can_sign and not v_admin then
      raise exception 'Only an admin can change client signing.' using errcode = '42501';
    end if;
    return new;
  end if;

  -- UPDATE
  if new.client_id is distinct from old.client_id
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'An agreement can''t be moved to another client.' using errcode = '42501';
  end if;
  if old.trashed_at is not null and not v_admin then
    raise exception 'Only an admin can restore or change an agreement in the trash.' using errcode = '42501';
  end if;
  if new.client_can_sign is distinct from old.client_can_sign and not v_admin then
    raise exception 'Only an admin can change client signing.' using errcode = '42501';
  end if;
  if new.trashed_at is not null and old.trashed_at is null then
    new.trashed_at := now();
    new.trashed_by := v_email;
  elsif new.trashed_at is null then
    new.trashed_by := null;
  end if;
  new.updated_by := v_email;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.client_agreements_guard() from public, anon, authenticated;

drop trigger if exists client_agreements_guard on public.client_agreements;
create trigger client_agreements_guard
  before insert or update on public.client_agreements
  for each row execute function public.client_agreements_guard();

-- The firm switch, read server side (clients can't read tk_settings).
create or replace function public.agreements__client_enabled()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select case
      when jsonb_typeof(s.value) = 'boolean' then (s.value)::text = 'true'
      when jsonb_typeof(s.value) = 'string' then (s.value #>> '{}') = 'true'
      when jsonb_typeof(s.value) = 'number' then (s.value)::text = '1'
      when jsonb_typeof(s.value) = 'object' then coalesce((s.value ->> 'on') = 'true', false)
      else false end
      from public.tk_settings s where s.key = 'agreements_client_enabled'
  ), false);
$$;
revoke all on function public.agreements__client_enabled() from public, anon, authenticated;

-- Client read: safe columns only, visible + untrashed only, own org only,
-- only while the switch is on. Staff with access get the same list as a
-- preview (exactly what the client would see) plus the switch state.
create or replace function public.client_agreements_mine(p_client_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_enabled boolean := public.agreements__client_enabled();
  v_member boolean;
  v_staff boolean;
  v_rows jsonb;
begin
  if coalesce(auth.jwt() ->> 'email', '') = '' or p_client_id is null then
    return jsonb_build_object('enabled', false, 'agreements', '[]'::jsonb);
  end if;
  v_member := public.is_client_member(p_client_id);
  v_staff := not v_member and public.is_active_staff() and public.can_access_client(p_client_id);
  if not v_member and not v_staff then
    return jsonb_build_object('enabled', false, 'agreements', '[]'::jsonb);
  end if;
  if v_member and not v_enabled then
    return jsonb_build_object('enabled', false, 'agreements', '[]'::jsonb);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', a.id,
           'title', a.title,
           'agreement_type', a.agreement_type,
           'status', a.status,
           'signed_on', a.signed_on,
           'effective_on', a.effective_on,
           'expires_on', a.expires_on,
           'document_url', a.document_url,
           'client_file_id', a.client_file_id
         ) order by coalesce(a.signed_on, a.effective_on, a.created_at::date) desc, a.created_at desc), '[]'::jsonb)
    into v_rows
    from public.client_agreements a
   where a.client_id = p_client_id
     and a.visible_to_client
     and a.trashed_at is null
     and not exists (select 1 from public.clients ic where ic.id = a.client_id and ic.is_internal);
  return jsonb_build_object('enabled', v_enabled, 'preview', v_staff, 'agreements', v_rows);
end;
$$;
revoke all on function public.client_agreements_mine(text) from public, anon;
grant execute on function public.client_agreements_mine(text) to authenticated;

-- What the signed-in staffer may do on one client's Agreements card.
create or replace function public.agreements_staff_perms(p_client_id text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'can_read', coalesce(public.can_access_client(p_client_id), false),
    'can_edit', public.agreements_can_edit(p_client_id),
    'is_admin', coalesce(public.is_active_staff_admin(), false) and coalesce(public.can_access_client(p_client_id), false),
    'client_enabled', public.agreements__client_enabled()
  );
$$;
revoke all on function public.agreements_staff_perms(text) from public, anon;
grant execute on function public.agreements_staff_perms(text) to authenticated;

commit;
