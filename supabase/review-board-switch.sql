-- Review board (docs/review-board-spec.md section 2): three owner-only
-- switches in tk_settings.
--   reviewboard_enabled          jsonb true/false  (firm switch for the board + email extras)
--   reviewboard_digest_enabled   jsonb true/false  (Deadline digest job)
--   reviewboard_digest_to        jsonb array of emails (digest recipients, compared lowercase)
-- Additive: recreates tk__owner_only_key with every live key kept (re-read
-- from production with pg_get_functiondef right before applying, 2026-11-05:
-- 26 keys ending desk_peek_enabled) plus the three new keys. No row is
-- inserted: a missing row means off for everyone. Only the owner turns them
-- on, with SQL, never from the app.
--
-- Applied to production 2026-11-05 (project xumsqmhccgfjnlmieqyu, migration reviewboard_1_owner_keys).

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
                   'slatesimple_enabled',
                   'desk_peek_enabled',
                   'reviewboard_enabled', 'reviewboard_digest_enabled', 'reviewboard_digest_to');
$$;

notify pgrst, 'reload schema';
