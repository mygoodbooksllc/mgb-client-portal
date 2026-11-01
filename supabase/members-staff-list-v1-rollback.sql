-- Rollback for members-staff-list-v1.sql (members step 2, staff Members list).
--
-- NOT run. Written 2026-10-31 before the migration was applied. Run by hand in
-- the SQL editor only if the owner decides to undo step 2.
--
-- WARNING: dropping member_support_log loses every row in it. If real staff
-- have opened real customers, export the table first:
--   select * from public.member_support_log order by id;
--
-- Order: the owner-only key list first (back to the exact list that was live
-- before step 2, which already includes members_area_open from
-- members-area-gate-v1.sql; that gate stays in place), then the functions, then the two tables. The log's
-- triggers and their function go with the table. The firm switch row is
-- removed only if it exists (it needs the owner override, like any
-- owner-only key).

begin;

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
                   'members_area_open');
$$;

select set_config('mgb.tk_owner_override', 'on', true);
delete from public.tk_settings where key = 'members_staff_enabled';

drop function if exists public.members_staff_me();
drop function if exists public.members_staff_list();
drop function if exists public.open_member(uuid, text);
drop function if exists public.set_members_support(text, boolean);
drop function if exists public.members_support_people();
drop function if exists public.is_members_support();
drop function if exists public.members_staff_switch_on();
drop function if exists public.members__key_for_email(text);

drop table if exists public.member_support_log;
drop function if exists public.member_support_log_immutable();
drop table if exists public.members_support_staff;

commit;

notify pgrst, 'reload schema';
