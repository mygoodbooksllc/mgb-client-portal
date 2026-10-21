-- Firm-wide switches for Brand colors (tk_settings.brand_enabled) and Hover menus
-- (tk_settings.hovernav_enabled) are owner-only, like wb_enabled, nav_enabled and
-- lato_enabled. Additive: recreates tk__owner_only_key with every live key kept
-- (the list was last set by owner-only-slate-app.sql) plus the two new ones.
-- No row is inserted: a missing row means off for everyone. Only the owner turns
-- them on, with one SQL line, never from the app.
--
-- Applied to production 2026-10-21 (project xumsqmhccgfjnlmieqyu).

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
                   'brand_enabled', 'hovernav_enabled');
$$;

notify pgrst, 'reload schema';
