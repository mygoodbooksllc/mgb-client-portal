-- Members area gate: nobody but the owner reaches any part of the members
-- area until the owner says go (owner requirement 2026-10-31, step 2's first
-- deliverable).
--
-- The switch: tk_settings.members_area_open. No row is inserted, so it is
-- OFF. It is an owner-only key (tk__owner_only_key), so only the owner can set
-- it; clients cannot read or write tk_settings at all, and admins are refused
-- by the existing tk_settings_before_write trigger.
--
-- While it is OFF:
--   * RESTRICTIVE select policies on member_access, member_profiles and
--     member_purchases return nothing to any signed-in person whose confirmed
--     email (member_jwt_email()) is not in members_area_allowlist. Restrictive
--     policies are ANDed with the step 1 "read own" policies, which are left
--     exactly as they are.
--   * members-file asks members_area_gate_for(email) (service role only) and
--     answers 403 to every caller, signed in or not, except an allowlisted
--     email.
--   * The roster trigger keeps writing member_access rows (staff saves are
--     never blocked); nobody outside the allowlist can read them.
--
-- members_area_allowlist: seeded with the owner's email only (the
-- internal_access row with is_owner). No grants and no policies: only the
-- SQL editor / service role can change it. Tests add throwaway emails inside a
-- rolled-back transaction.
--
-- Staff-side functions (members-staff-list-v1.sql) are SECURITY DEFINER and
-- are not affected by this gate; they have their own owner-only switch.
--
-- Additive only. Rollback: members-area-gate-v1-rollback.sql.
-- Tests: members-area-gate-v1-tests.sql (rolls back).

begin;

create table if not exists public.members_area_allowlist (
  email    text primary key check (email = lower(email) and length(email) between 3 and 320),
  note     text,
  added_at timestamptz not null default now()
);
alter table public.members_area_allowlist enable row level security;
revoke all on public.members_area_allowlist from public, anon, authenticated;

insert into public.members_area_allowlist (email, note)
select lower(ia.staff_email), 'owner'
  from public.internal_access ia
 where ia.is_owner
on conflict (email) do nothing;

-- The switch. Missing or anything but true = off.
create or replace function public.members_area_switch_on()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((select s.value = 'true'::jsonb or s.value = '"true"'::jsonb
                     from public.tk_settings s where s.key = 'members_area_open'), false);
$$;
revoke all on function public.members_area_switch_on() from public, anon, authenticated;

-- For RLS: the switch is on, or the caller's CONFIRMED email is allowlisted.
create or replace function public.members_area_open_for_me()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.members_area_switch_on()
      or exists (select 1 from public.members_area_allowlist a
                  where a.email = public.member_jwt_email());
$$;
revoke all on function public.members_area_open_for_me() from public, anon;
grant execute on function public.members_area_open_for_me() to authenticated;

-- For the members-file edge function (service role only). p_email is the
-- caller's confirmed email as resolved by auth.getUser, or null.
create or replace function public.members_area_gate_for(p_email text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'open', public.members_area_switch_on(),
    'allowed', public.members_area_switch_on()
               or exists (select 1 from public.members_area_allowlist a
                           where p_email is not null and a.email = lower(btrim(p_email))));
$$;
revoke all on function public.members_area_gate_for(text) from public, anon, authenticated;
grant execute on function public.members_area_gate_for(text) to service_role;

drop policy if exists member_access_area_gate on public.member_access;
create policy member_access_area_gate on public.member_access
  as restrictive for select to authenticated
  using (public.members_area_open_for_me());

drop policy if exists member_profiles_area_gate on public.member_profiles;
create policy member_profiles_area_gate on public.member_profiles
  as restrictive for select to authenticated
  using (public.members_area_open_for_me());

drop policy if exists member_purchases_area_gate on public.member_purchases;
create policy member_purchases_area_gate on public.member_purchases
  as restrictive for select to authenticated
  using (public.members_area_open_for_me());

-- Owner-only key list: every live key kept (read from production 2026-10-31)
-- plus members_area_open.
create or replace function public.tk__owner_only_key(p_key text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_key in ('client_request_enabled', 'client_request_pilot', 'standard_set_live',
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
                   'members_area_open');
$$;

commit;

notify pgrst, 'reload schema';
