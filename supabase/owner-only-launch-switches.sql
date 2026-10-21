-- Launch switches for the Desk, MGB Desk window and left sidebar are owner-only
-- (same list as the client-request and late-task settings). Applied 2026-10-21.
CREATE OR REPLACE FUNCTION public.tk__owner_only_key(p_key text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select p_key in ('client_request_enabled', 'client_request_pilot', 'standard_set_live',
                   'late_tasks_count_against_staff', 'late_tasks_effective_from',
                   'wb_enabled', 'desk_app_enabled', 'nav_enabled');
$function$;
