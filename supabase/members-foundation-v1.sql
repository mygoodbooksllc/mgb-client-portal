-- Members area foundation, step 1 (owner build plan 2026-10-31).
--
-- Website members area (/members/ on mygoodbooks.org) signs in against this
-- same Supabase project. This file adds what the sign-in and the
-- members-file edge function need:
--
--   member_access     what each person may open (client / course / kit)
--   member_profiles   one row per person with members access
--   member_purchases  Stripe purchases (written only by the future webhook)
--   trigger on client_users  an active roster row gives a 'client' row;
--                     deactivating or deleting removes it again
--   storage bucket 'members'  private, no storage policies at all, so only
--                     the members-file edge function (service role) reads it
--
-- Security model (see "Members Step 1 Critique.md" in the website folder):
--   * A signed-in person reads only their own rows (confirmed email only).
--   * No insert / update / delete policy and no write grant for anon or
--     authenticated. Writes come only from the service role or the
--     security-definer trigger below.
--   * The trigger only ever writes access='client', source='client_roster',
--     with the email taken from the client_users row itself.
--   * Staff and admins get nothing here. Step 2 adds a checked list function.
--
-- Additive only: no existing table, policy or function is changed. Rollback:
-- members-foundation-v1-rollback.sql. Tests: members-foundation-v1-tests.sql.
-- Applied to production 2026-10-31 (migration members_foundation_v1). The
-- backfill added the 2 active roster rows. Review fix applied the same day as
-- migration members_foundation_v1_fix_1: member_jwt_email() now requires a
-- confirmed auth.users row matching auth.uid(); policies match on that email
-- only; the trigger links member_id only to confirmed users. This file shows
-- the final state.

begin;

-- ---------------------------------------------------------------- helper
-- The caller's email, only if their auth.users row is CONFIRMED and matches
-- both auth.uid() and the JWT email. An unconfirmed account that registered
-- someone else's address, or a stale JWT after an email change, gets null.
create or replace function public.member_jwt_email()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select lower(u.email) from auth.users u
   where u.id = auth.uid() and u.email_confirmed_at is not null
     and lower(u.email) = lower(nullif(trim(coalesce(auth.jwt() ->> 'email', '')), ''))
   limit 1;
$$;
revoke all on function public.member_jwt_email() from public, anon;
grant execute on function public.member_jwt_email() to authenticated;

-- ---------------------------------------------------------------- tables
create table if not exists public.member_access (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(email) and length(email) between 3 and 320),
  member_id uuid,
  access text not null check (access in ('client', 'course', 'kit')),
  source text not null check (source in ('client_roster', 'stripe', 'manual', 'network')),
  granted_at timestamptz not null default now(),
  expires_at timestamptz,
  is_test boolean not null default false,
  unique (email, access, source)
);
create index if not exists member_access_email_idx on public.member_access (email);
create index if not exists member_access_member_id_idx on public.member_access (member_id);

create table if not exists public.member_profiles (
  member_id uuid primary key,
  email text not null unique check (email = lower(email)),
  display_name text check (display_name is null or length(display_name) <= 200),
  church_name text check (church_name is null or length(church_name) <= 200),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  is_test boolean not null default false
);

create table if not exists public.member_purchases (
  id uuid primary key default gen_random_uuid(),
  member_id uuid,
  email text not null check (email = lower(email)),
  stripe_session_id text unique,
  product text not null check (product in ('kit', 'course', 'bundle', 'add_kit', 'network_planter')),
  amount_cents integer not null check (amount_cents >= 0),
  status text not null default 'paid' check (status in ('paid', 'refunded', 'disputed')),
  paid_at timestamptz,
  refunded_at timestamptz,
  created_at timestamptz not null default now(),
  is_test boolean not null default false
);
create index if not exists member_purchases_email_idx on public.member_purchases (email);
create index if not exists member_purchases_member_id_idx on public.member_purchases (member_id);

-- ---------------------------------------------------------------- RLS
alter table public.member_access    enable row level security;
alter table public.member_profiles  enable row level security;
alter table public.member_purchases enable row level security;

revoke all on public.member_access, public.member_profiles, public.member_purchases
  from public, anon, authenticated;
grant select on public.member_access, public.member_profiles, public.member_purchases
  to authenticated;

drop policy if exists member_access_read_own on public.member_access;
create policy member_access_read_own on public.member_access
  for select to authenticated
  using (email = public.member_jwt_email());

drop policy if exists member_profiles_read_own on public.member_profiles;
create policy member_profiles_read_own on public.member_profiles
  for select to authenticated
  using (email = public.member_jwt_email());

drop policy if exists member_purchases_read_own on public.member_purchases;
create policy member_purchases_read_own on public.member_purchases
  for select to authenticated
  using (email = public.member_jwt_email());

-- ------------------------------------------- client_users -> member_access
create or replace function public.member_access_sync_client_roster()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old text;
  v_new text;
  v_uid uuid;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    v_old := lower(trim(old.email));
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    v_new := lower(trim(new.email));
  end if;

  -- Remove the old address's roster row when the row is deleted, its email
  -- changed, or it is no longer active. Only roster-granted client rows.
  if tg_op = 'DELETE' or (tg_op = 'UPDATE' and v_old is distinct from v_new) then
    delete from public.member_access
     where email = v_old and access = 'client' and source = 'client_roster';
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    if new.active then
      select u.id into v_uid from auth.users u
       where lower(u.email) = v_new and u.email_confirmed_at is not null limit 1;
      insert into public.member_access (email, member_id, access, source)
      values (v_new, v_uid, 'client', 'client_roster')
      on conflict (email, access, source) do nothing;
    else
      delete from public.member_access
       where email = v_new and access = 'client' and source = 'client_roster';
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.member_access_sync_client_roster() from public, anon, authenticated;

drop trigger if exists client_users_member_access_sync on public.client_users;
create trigger client_users_member_access_sync
  after insert or update of active, email or delete on public.client_users
  for each row execute function public.member_access_sync_client_roster();

-- Backfill: every active roster row today gets its 'client' row.
insert into public.member_access (email, member_id, access, source)
select lower(trim(cu.email)),
       (select u.id from auth.users u where lower(u.email) = lower(trim(cu.email)) and u.email_confirmed_at is not null limit 1),
       'client', 'client_roster'
  from public.client_users cu
 where cu.active
on conflict (email, access, source) do nothing;

-- ---------------------------------------------------------------- storage
-- Private. No storage.objects policies are added, so anon and authenticated
-- cannot list, read or write it. Only the service role (edge function) can.
insert into storage.buckets (id, name, public, file_size_limit)
values ('members', 'members', false, 52428800)
on conflict (id) do nothing;

commit;
