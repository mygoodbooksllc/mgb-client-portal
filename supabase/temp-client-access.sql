-- Temporary client access (owner request 2026-09-29).
--
-- A bookkeeper can ask for access to a client they aren't assigned to, for
-- 1, 7 or 30 days, with a reason. An admin or one of the client's assigned
-- bookkeepers approves or denies it. Once approved, can_access_client() lets
-- the requester in until expires_at; after that it stops on its own. The
-- approver, an admin, or the requester can revoke it early.
--
-- All writes go through the RPCs below (no direct insert/update policies), so
-- nobody can approve their own request or stretch an expiry.
--
-- Builds on audit-hardening-client-scoping.sql (can_access_client) and
-- staff-schema.sql. Safe to re-run.
-- Applied to production 2026-09-29.

begin;

create table if not exists public.staff_client_access_grants (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,
  staff_email text not null,
  staff_name text,
  reason text not null check (length(reason) between 1 and 500),
  duration_days int not null check (duration_days in (1, 7, 30)),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'denied', 'revoked', 'cancelled')),
  requested_at timestamptz not null default now(),
  decided_by text,
  decided_at timestamptz,
  expires_at timestamptz
);
create index if not exists staff_client_access_grants_live_idx
  on public.staff_client_access_grants (staff_email, client_id)
  where status = 'approved';
create index if not exists staff_client_access_grants_client_idx
  on public.staff_client_access_grants (client_id, status);
-- One open request per person per client.
create unique index if not exists staff_client_access_grants_one_pending
  on public.staff_client_access_grants (client_id, staff_email)
  where status = 'pending';

alter table public.staff_client_access_grants enable row level security;
revoke all on public.staff_client_access_grants from anon;
revoke insert, update, delete on public.staff_client_access_grants from authenticated;

-- Approvers: admins, or staff permanently assigned to the client. (Not
-- can_access_client(), so a temporary grantee can't approve someone else.)
create or replace function public.can_approve_client_access(p_client_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_active_staff_admin()
      or (
        public.is_active_staff()
        and exists (
          select 1 from staff_client_access sca
          where sca.staff_email = auth.jwt() ->> 'email'
            and sca.client_id = p_client_id
        )
      );
$$;
revoke all on function public.can_approve_client_access(text) from public, anon;
grant execute on function public.can_approve_client_access(text) to authenticated;

drop policy if exists "read access grants" on public.staff_client_access_grants;
create policy "read access grants" on public.staff_client_access_grants
  for select using (
    staff_email = auth.jwt() ->> 'email'
    or public.can_approve_client_access(client_id)
  );

-- The single access check every per-client policy uses: now also true during
-- an approved, unexpired grant (for active staff only).
create or replace function public.can_access_client(p_client_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_active_staff_admin()
      or exists (
        select 1 from staff_client_access sca
        where sca.staff_email = auth.jwt() ->> 'email'
          and sca.client_id = p_client_id
      )
      or (
        public.is_active_staff()
        and exists (
          select 1 from staff_client_access_grants g
          where g.staff_email = auth.jwt() ->> 'email'
            and g.client_id = p_client_id
            and g.status = 'approved'
            and g.expires_at > now()
        )
      );
$$;
grant execute on function public.can_access_client(text) to anon, authenticated;

-- Ask for access.
create or replace function public.request_client_access(
  p_client_id text, p_reason text, p_days int
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := auth.jwt() ->> 'email';
  v_id uuid;
begin
  if not public.is_active_staff() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from clients where id = p_client_id) then
    raise exception 'unknown client' using errcode = '22023';
  end if;
  if public.can_access_client(p_client_id) then
    raise exception 'you already have access to this client' using errcode = '22023';
  end if;
  if p_days not in (1, 7, 30) then
    raise exception 'duration must be 1, 7 or 30 days' using errcode = '22023';
  end if;
  if coalesce(length(trim(p_reason)), 0) = 0 then
    raise exception 'give a reason' using errcode = '22023';
  end if;
  insert into staff_client_access_grants (client_id, staff_email, staff_name, reason, duration_days)
  values (
    p_client_id, v_email,
    (select name from staff where email = v_email),
    left(trim(p_reason), 500), p_days
  )
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.request_client_access(text, text, int) from public, anon;
grant execute on function public.request_client_access(text, text, int) to authenticated;

-- Approve (true) or deny (false) a pending request. Expiry starts at approval.
create or replace function public.decide_client_access(p_id uuid, p_approve boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  g staff_client_access_grants;
begin
  select * into g from staff_client_access_grants where id = p_id for update;
  if not found or g.status <> 'pending' then
    raise exception 'request is no longer pending' using errcode = '22023';
  end if;
  if not public.can_approve_client_access(g.client_id)
     or g.staff_email = auth.jwt() ->> 'email' then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update staff_client_access_grants
     set status = case when p_approve then 'approved' else 'denied' end,
         decided_by = auth.jwt() ->> 'email',
         decided_at = now(),
         expires_at = case when p_approve then now() + make_interval(days => g.duration_days) else null end
   where id = p_id;
end;
$$;
revoke all on function public.decide_client_access(uuid, boolean) from public, anon;
grant execute on function public.decide_client_access(uuid, boolean) to authenticated;

-- End early: the requester cancels a pending request or gives up a live grant;
-- an approver revokes a live grant.
create or replace function public.end_client_access(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  g staff_client_access_grants;
  v_self boolean;
begin
  select * into g from staff_client_access_grants where id = p_id for update;
  if not found or g.status not in ('pending', 'approved') then
    raise exception 'nothing to end' using errcode = '22023';
  end if;
  v_self := g.staff_email = auth.jwt() ->> 'email';
  if not (v_self or public.can_approve_client_access(g.client_id)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update staff_client_access_grants
     set status = case when g.status = 'pending' then 'cancelled' else 'revoked' end,
         decided_by = coalesce(decided_by, auth.jwt() ->> 'email'),
         decided_at = coalesce(decided_at, now()),
         expires_at = case when g.status = 'approved' then least(expires_at, now()) else expires_at end
   where id = p_id;
end;
$$;
revoke all on function public.end_client_access(uuid) from public, anon;
grant execute on function public.end_client_access(uuid) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public'
         and tablename = 'staff_client_access_grants'
     ) then
    alter publication supabase_realtime add table public.staff_client_access_grants;
  end if;
end;
$$;

commit;
