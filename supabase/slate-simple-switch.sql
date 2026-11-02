-- Slate Stage B (docs/slate-stage-b-spec.md): owner-only firm switch
-- tk_settings.slatesimple_enabled. Adds the key to tk__owner_only_key so only
-- the owner can write it. No row is inserted: missing = off. Code never writes
-- it. Copied from the live definition (2026-11-02) plus one key.
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
                   'members_staff_enabled',
                   'create_menu_enabled',
                   'slatesimple_enabled');
$$;

notify pgrst, 'reload schema';
