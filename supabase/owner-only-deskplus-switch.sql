-- Firm-wide switch for the Desk additions (tk_settings.deskplus_enabled) is
-- owner-only, like wb_enabled, nav_enabled, brand_enabled and
-- org_profile_enabled. Additive: recreates tk__owner_only_key with every live
-- key kept (re-read from production right before applying; the list was last
-- set by client-org-profile.sql) plus the one new key.
-- No row is inserted: a missing row means off for everyone. Only the owner
-- turns it on, with one SQL line, never from the app. The app reads it in
-- components/workbench/WB_plus.js and never writes it.
--
-- Applied to production 2026-10-25 (project xumsqmhccgfjnlmieqyu).

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
                   'deskplus_enabled');
$$;

notify pgrst, 'reload schema';
