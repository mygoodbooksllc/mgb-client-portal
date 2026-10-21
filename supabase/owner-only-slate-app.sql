-- Slate app (S1, preview): the firm-wide switch tk_settings.slate_app_enabled is
-- owner-only, like wb_enabled, desk_app_enabled, nav_enabled, lato_enabled and
-- month_rhythm_enabled. Additive: recreates tk__owner_only_key with every live
-- key kept (the list was last set by slate-rhythm-1-settings.sql) plus the new one.
-- No row is inserted: a missing slate_app_enabled row means off for everyone.
-- Only the owner turns it on, with one SQL line, never from the app.
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
                   'month_rhythm_enabled', 'slate_app_enabled');
$$;

notify pgrst, 'reload schema';
