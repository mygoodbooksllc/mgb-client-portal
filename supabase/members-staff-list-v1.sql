-- Members area, step 2: the staff Members list (owner build plan 2026-10-31).
--
-- Spec: "members-staff-side-spec.md" sections 4, 5, 6 and 8 (website folder).
-- Critique: "Members Step 2 Critique.md" (website folder).
--
-- Adds:
--   members_support_staff   the members support permission. Only the owner
--                           changes it, through set_members_support(). Same
--                           pattern as internal_access (internal-company-profile.sql).
--   member_support_log      append-only log. Written only by the functions
--                           below. Readable by the owner (all rows) and by
--                           support staff (their own rows). Nobody can update,
--                           delete or truncate it, not even the service role
--                           (triggers refuse).
--   is_members_support()    active staff AND (the owner OR a permission row).
--   members_staff_me()      what the caller may do: { switch_on, is_owner,
--                           can_list, can_open }. Drives the Team tab.
--   members_staff_list()    account facts for every member. Real admins and
--                           support staff. No purchase rows, no files.
--   open_member(id, reason) support staff only. Writes customer.opened to the
--                           log in the same transaction, then returns the
--                           member's account facts. Staff without the
--                           permission get { ok: false } and a "denied" row.
--   set_members_support(email, allowed)   owner only; logged.
--   members_support_people()              owner only; the staff list with
--                                          who holds the permission.
--   tk__owner_only_key()    + 'members_staff_enabled' (the firm switch).
--
-- The firm switch: tk_settings.members_staff_enabled. No row is inserted, so
-- it is off. While it is off every function above answers only the owner;
-- everyone else is refused (or gets can_list = false), whatever their
-- browser's preview flag says. Only the owner can set it.
--
-- Placeholders until later steps: open requests are always 0 and support
-- access is always 'none' (steps 3 and 4).
--
-- Additive only. No existing table or policy changes. tk__owner_only_key is
-- recreated with every live key kept (re-read from production 2026-10-31).
-- Rollback: members-staff-list-v1-rollback.sql. Tests:
-- members-staff-list-v1-tests.sql (rolls back).

begin;

-- ---------------------------------------------------------------- tables
create table if not exists public.members_support_staff (
  staff_email text primary key,
  granted_by  text not null,
  granted_at  timestamptz not null default now()
);

create table if not exists public.member_support_log (
  id               bigint generated always as identity primary key,
  at               timestamptz not null default now(),
  actor_email      text not null check (actor_email = lower(actor_email) and length(actor_email) between 1 and 320),
  actor_kind       text not null check (actor_kind in ('staff', 'customer', 'system')),
  actor_first_name text check (actor_first_name is null or length(actor_first_name) <= 80),
  member_id        uuid,
  action           text not null check (action in (
                     'customer.opened', 'request.opened',
                     'grant.requested', 'grant.auto_approved', 'grant.approved', 'grant.denied',
                     'grant.ended', 'grant.revoked', 'grant.all_ended',
                     'item.viewed', 'item.view_denied',
                     'support_permission.granted', 'support_permission.removed',
                     'list.exported')),
  reason           text check (reason is null or length(reason) <= 500),
  grant_id         uuid,
  request_id       uuid,
  item_id          uuid,
  item_kind        text check (item_kind is null or length(item_kind) <= 40),
  outcome          text not null default 'ok' check (outcome in ('ok', 'denied')),
  details          jsonb not null default '{}'::jsonb check (pg_column_size(details) <= 2048)
);
create index if not exists member_support_log_at_idx     on public.member_support_log (at desc);
create index if not exists member_support_log_member_idx on public.member_support_log (member_id, at desc);
create index if not exists member_support_log_actor_idx  on public.member_support_log (actor_email, at desc);

alter table public.members_support_staff enable row level security;
alter table public.member_support_log    enable row level security;
revoke all on public.members_support_staff, public.member_support_log from public, anon, authenticated;
grant select on public.members_support_staff, public.member_support_log to authenticated;

-- Append-only, for everyone. RLS already gives signed-in users no update or
-- delete; these triggers also stop the service role and the SQL editor.
create or replace function public.member_support_log_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'member_support_log is append-only' using errcode = '42501';
end;
$$;
revoke all on function public.member_support_log_immutable() from public, anon, authenticated;

drop trigger if exists member_support_log_no_change on public.member_support_log;
create trigger member_support_log_no_change
  before update or delete on public.member_support_log
  for each row execute function public.member_support_log_immutable();
drop trigger if exists member_support_log_no_truncate on public.member_support_log;
create trigger member_support_log_no_truncate
  before truncate on public.member_support_log
  for each statement execute function public.member_support_log_immutable();

-- ---------------------------------------------------------------- helpers
-- The firm switch. Missing or anything but true = off.
create or replace function public.members_staff_switch_on()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((select s.value = 'true'::jsonb or s.value = '"true"'::jsonb
                     from public.tk_settings s where s.key = 'members_staff_enabled'), false);
$$;
revoke all on function public.members_staff_switch_on() from public, anon, authenticated;

-- Active staff AND (the owner OR a permission row). Deactivating a staff
-- member stops it at once.
create or replace function public.is_members_support()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_active_staff()
     and (public.is_internal_owner()
          or exists (select 1 from public.members_support_staff m
                      where m.staff_email = auth.jwt() ->> 'email'));
$$;
revoke all on function public.is_members_support() from public, anon;
grant execute on function public.is_members_support() to authenticated;

-- The key used to open a member: the profile's member_id, else the access
-- row's, else a CONFIRMED sign-in account with that email. Null = no sign-in
-- account yet (cannot be opened). Internal only.
create or replace function public.members__key_for_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select mp.member_id from public.member_profiles mp
      where mp.email = lower(p_email) and mp.deleted_at is null limit 1),
    (select ma.member_id from public.member_access ma
      where ma.email = lower(p_email) and ma.member_id is not null limit 1),
    (select u.id from auth.users u
      where lower(u.email) = lower(p_email) and u.email_confirmed_at is not null limit 1));
$$;
revoke all on function public.members__key_for_email(text) from public, anon, authenticated;

-- ---------------------------------------------------------------- policies
drop policy if exists members_support_staff_read on public.members_support_staff;
create policy members_support_staff_read on public.members_support_staff
  for select to authenticated
  using (public.is_active_staff());

drop policy if exists member_support_log_read on public.member_support_log;
create policy member_support_log_read on public.member_support_log
  for select to authenticated
  using (public.is_internal_owner()
         or (public.is_members_support() and actor_email = lower(auth.jwt() ->> 'email')));

-- ---------------------------------------------------------------- RPCs
create or replace function public.members_staff_me()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_on    boolean;
  v_owner boolean;
  v_sup   boolean;
  v_admin boolean;
begin
  if not public.is_active_staff() then
    return jsonb_build_object('switch_on', false, 'is_owner', false, 'can_list', false, 'can_open', false);
  end if;
  v_on    := public.members_staff_switch_on();
  v_owner := public.is_internal_owner();
  v_sup   := public.is_members_support();
  v_admin := public.is_active_staff_admin();
  return jsonb_build_object(
    'switch_on', v_on,
    'is_owner',  v_owner,
    'can_list',  (v_on or v_owner) and (v_admin or v_sup),
    'can_open',  (v_on or v_owner) and v_sup);
end;
$$;
revoke all on function public.members_staff_me() from public, anon;
grant execute on function public.members_staff_me() to authenticated;

create or replace function public.members_staff_list()
returns table (
  member_key           uuid,
  email                text,
  display_name         text,
  church_name          text,
  access               text[],
  sources              text[],
  since                timestamptz,
  access_ends          timestamptz,
  last_sign_in_at      timestamptz,
  purchases_count      integer,
  purchases_paid_cents bigint,
  refunds_count        integer,
  open_requests        integer,
  support_status       text,
  is_test              boolean,
  is_client            boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
begin
  if not ((public.members_staff_switch_on() or public.is_internal_owner())
          and (public.is_active_staff_admin() or public.is_members_support())) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  return query
  with e as (
    select distinct lower(x.em) as em from (
      select ma.email as em from public.member_access ma
      union select mp.email from public.member_profiles mp where mp.deleted_at is null
      union select pu.email from public.member_purchases pu
    ) x
  )
  select
    k.key,
    e.em,
    prof.display_name,
    prof.church_name,
    coalesce(acc.access, '{}'::text[]),
    coalesce(acc.sources, '{}'::text[]),
    acc.since,
    acc.access_ends,
    u.last_sign_in_at,
    coalesce(pur.n, 0)::integer,
    coalesce(pur.paid, 0)::bigint,
    coalesce(pur.refunds, 0)::integer,
    0,
    'none'::text,
    (coalesce(acc.t, false) or coalesce(prof.is_test, false) or coalesce(pur.t, false)
       or exists (select 1 from public.client_users cu join public.clients c on c.id = cu.client_id
                   where lower(cu.email) = e.em and coalesce(c.test_only, false))),
    coalesce(acc.is_client, false)
  from e
  cross join lateral (select public.members__key_for_email(e.em) as key) k
  left join lateral (
    select mp.display_name, mp.church_name, mp.is_test
      from public.member_profiles mp
     where mp.email = e.em and mp.deleted_at is null
     limit 1) prof on true
  left join lateral (
    select
      array_agg(distinct ma.access order by ma.access) filter (where ma.expires_at is null or ma.expires_at > now()) as access,
      array_agg(distinct ma.source order by ma.source) filter (where ma.expires_at is null or ma.expires_at > now()) as sources,
      min(ma.granted_at) as since,
      -- Only when every live row ends (network planters); otherwise null.
      case when bool_and(ma.expires_at is not null) filter (where ma.expires_at is null or ma.expires_at > now())
           then max(ma.expires_at) filter (where ma.expires_at > now()) end as access_ends,
      bool_or(ma.is_test) as t,
      bool_or(ma.access = 'client' and (ma.expires_at is null or ma.expires_at > now())) as is_client
      from public.member_access ma
     where ma.email = e.em) acc on true
  left join lateral (
    select count(*) as n,
           sum(pu.amount_cents) filter (where pu.status = 'paid') as paid,
           count(*) filter (where pu.status in ('refunded', 'disputed')) as refunds,
           bool_or(pu.is_test) as t
      from public.member_purchases pu
     where pu.email = e.em) pur on true
  left join auth.users u on u.id = k.key
  order by lower(coalesce(prof.display_name, e.em));
end;
$$;
revoke all on function public.members_staff_list() from public, anon;
grant execute on function public.members_staff_list() to authenticated;

create or replace function public.open_member(p_member_id uuid, p_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_me     text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_reason text := btrim(coalesce(p_reason, ''));
  v_first  text;
  v_email  text;
  v_log    bigint;
begin
  if not public.is_active_staff() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_member_id is null then
    raise exception 'Pick a customer to open.' using errcode = '22023';
  end if;
  if length(v_reason) < 3 or length(v_reason) > 500 then
    raise exception 'A reason of 3 to 500 characters is required.' using errcode = '22023';
  end if;

  select nullif(split_part(btrim(s.name), ' ', 1), '') into v_first
    from public.staff s where s.email = auth.jwt() ->> 'email' limit 1;

  -- The member this key belongs to (same rule as the list).
  select x.em into v_email from (
    select ma.email as em from public.member_access ma
    union select mp.email from public.member_profiles mp where mp.deleted_at is null
    union select pu.email from public.member_purchases pu
  ) x
  where public.members__key_for_email(x.em) = p_member_id
  limit 1;

  -- Staff without the permission (or anyone but the owner while the firm
  -- switch is off): nothing returned; the attempt is logged as denied.
  if not ((public.members_staff_switch_on() or public.is_internal_owner()) and public.is_members_support()) then
    if v_email is not null then
      insert into public.member_support_log (actor_email, actor_kind, actor_first_name, member_id, action, reason, outcome)
      values (v_me, 'staff', left(v_first, 80), p_member_id, 'customer.opened', v_reason, 'denied');
    end if;
    return jsonb_build_object('ok', false, 'error', 'not_allowed');
  end if;

  if v_email is null then
    raise exception 'That customer was not found.' using errcode = 'P0002';
  end if;

  -- Log first. If this insert fails, the whole call fails and nothing is returned.
  insert into public.member_support_log (actor_email, actor_kind, actor_first_name, member_id, action, reason, outcome)
  values (v_me, 'staff', left(v_first, 80), p_member_id, 'customer.opened', v_reason, 'ok')
  returning id into v_log;

  return jsonb_build_object(
    'ok', true,
    'log_id', v_log,
    'opened_at', now(),
    'account', jsonb_build_object(
      'member_id', p_member_id,
      'email', v_email,
      'display_name', (select mp.display_name from public.member_profiles mp where mp.email = v_email and mp.deleted_at is null limit 1),
      'church_name',  (select mp.church_name  from public.member_profiles mp where mp.email = v_email and mp.deleted_at is null limit 1),
      'profile_created_at', (select mp.created_at from public.member_profiles mp where mp.email = v_email and mp.deleted_at is null limit 1),
      'last_sign_in_at', (select u.last_sign_in_at from auth.users u where u.id = p_member_id),
      'is_client', exists (select 1 from public.member_access ma where ma.email = v_email and ma.access = 'client')),
    'access', coalesce((
      select jsonb_agg(jsonb_build_object(
               'access', ma.access, 'source', ma.source, 'granted_at', ma.granted_at,
               'expires_at', ma.expires_at, 'live', (ma.expires_at is null or ma.expires_at > now()))
             order by ma.granted_at)
        from public.member_access ma where ma.email = v_email), '[]'::jsonb),
    'purchases', coalesce((
      select jsonb_agg(jsonb_build_object(
               'product', pu.product, 'amount_cents', pu.amount_cents, 'status', pu.status,
               'paid_at', pu.paid_at, 'refunded_at', pu.refunded_at, 'receipt', pu.stripe_session_id)
             order by coalesce(pu.paid_at, pu.created_at) desc)
        from public.member_purchases pu where pu.email = v_email), '[]'::jsonb),
    'open_requests', 0,
    'support_status', 'none');
end;
$$;
revoke all on function public.open_member(uuid, text) from public, anon;
grant execute on function public.open_member(uuid, text) to authenticated;

-- Owner-only. The owner always holds the permission (is_members_support) and
-- cannot be changed here, so nobody can lock the owner out by accident.
create or replace function public.set_members_support(p_email text, p_allowed boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_me     text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_first  text;
  v_target text;
  v_n      integer := 0;
begin
  if not public.is_internal_owner() then
    raise exception 'Only the owner can change who can open members.' using errcode = '42501';
  end if;
  if p_allowed is null then
    raise exception 'Say yes or no.' using errcode = '22023';
  end if;
  select s.email into v_target from public.staff s
   where lower(s.email) = lower(btrim(coalesce(p_email, ''))) and s.active
   limit 1;
  if v_target is null then
    raise exception 'That person is not an active staff member.' using errcode = '22023';
  end if;
  if exists (select 1 from public.internal_access ia where ia.staff_email = v_target and ia.is_owner) then
    raise exception 'The owner always has it.' using errcode = '22023';
  end if;

  if p_allowed then
    insert into public.members_support_staff (staff_email, granted_by)
    values (v_target, v_me)
    on conflict (staff_email) do nothing;
  else
    delete from public.members_support_staff where staff_email = v_target;
  end if;
  get diagnostics v_n = row_count;

  if v_n > 0 then
    select nullif(split_part(btrim(s.name), ' ', 1), '') into v_first
      from public.staff s where s.email = auth.jwt() ->> 'email' limit 1;
    insert into public.member_support_log (actor_email, actor_kind, actor_first_name, action, details)
    values (v_me, 'staff', left(v_first, 80),
            case when p_allowed then 'support_permission.granted' else 'support_permission.removed' end,
            jsonb_build_object('staff_email', lower(v_target)));
  end if;
  return jsonb_build_object('staff_email', v_target, 'allowed', p_allowed, 'changed', v_n > 0);
end;
$$;
revoke all on function public.set_members_support(text, boolean) from public, anon;
grant execute on function public.set_members_support(text, boolean) to authenticated;

-- Owner-only: active staff and who holds the permission (for the owner card).
create or replace function public.members_support_people()
returns table (email text, name text, role text, allowed boolean, is_owner boolean)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
begin
  if not public.is_internal_owner() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
  select s.email, s.name, s.role,
         (o.is_owner is true) or exists (select 1 from public.members_support_staff m where m.staff_email = s.email),
         coalesce(o.is_owner, false)
    from public.staff s
    left join public.internal_access o on o.staff_email = s.email
   where s.active
   order by (o.is_owner is true) desc, s.name;
end;
$$;
revoke all on function public.members_support_people() from public, anon;
grant execute on function public.members_support_people() to authenticated;

-- ---------------------------------------------------------------- firm switch
-- Every live key kept (read from production 2026-10-31) plus members_staff_enabled.
create or replace function public.tk__owner_only_key(p_key text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_key in ('mgb_home_enabled', 'client_request_enabled', 'client_request_pilot', 'standard_set_live',
                   'late_tasks_count_against_staff', 'late_tasks_effective_from',
                   'wb_enabled', 'desk_app_enabled', 'nav_enabled', 'lato_enabled',
                   'month_rhythm_enabled', 'slate_app_enabled',
                   'brand_enabled', 'hovernav_enabled',
                   'org_profile_enabled',
                   'deskplus_enabled',
                   'threadmenu_enabled',
                   'slateplus_enabled',
                   'client_page_drop_enabled', 'client_page_drop_pilot',
                   'client_upload_notify_enabled',
                   'members_area_open',
                   'members_staff_enabled');
$$;

commit;

notify pgrst, 'reload schema';
