-- Rollback for members-area-gate-v1.sql (the members_area_open switch).
--
-- NOT run. Written 2026-10-31 before the migration was applied.
-- Roll back members-staff-list-v1.sql FIRST if it is applied (its rollback
-- leaves members_area_open in the owner-only list; this file removes it).
--
-- WARNING: undoing the gate re-opens the members area to every member with an
-- access row (the step 1 behavior). Redeploy members-file from the commit
-- before the gate (eb26ee3) as well, or the function keeps refusing everyone
-- (members_area_gate_for will no longer exist, and the function fails closed).

begin;

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
                   'client_upload_notify_enabled');
$$;

select set_config('mgb.tk_owner_override', 'on', true);
delete from public.tk_settings where key = 'members_area_open';

drop policy if exists member_access_area_gate    on public.member_access;
drop policy if exists member_profiles_area_gate  on public.member_profiles;
drop policy if exists member_purchases_area_gate on public.member_purchases;

drop function if exists public.members_area_gate_for(text);
drop function if exists public.members_area_open_for_me();
drop function if exists public.members_area_switch_on();
drop table if exists public.members_area_allowlist;

commit;

notify pgrst, 'reload schema';
