-- Weekly audit W-20261019-2: tk_row_readable() returned true for a task's
-- owner before checking active staff, so a deactivated staffer could still
-- read their own tasks. The active-staff check now comes first. Everything
-- else is the live definition unchanged.

CREATE OR REPLACE FUNCTION public.tk_row_readable(p_id uuid, p_owner text, p_assignee text, p_client text, p_project uuid, p_visibility text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_inv boolean;
begin
  if v_me = '' then return false; end if;
  if p_client is not null and p_client = any (public.internal_blocked_ids()) then return false; end if;
  if not public.is_active_staff() then return false; end if;
  if lower(p_owner) = v_me then return true; end if;
  if public.is_active_staff_admin() then return true; end if;
  v_inv := lower(coalesce(p_assignee, '')) = v_me
           or exists (select 1 from tk_followers f where f.task_id = p_id and f.staff_email = v_me);
  if p_client is not null then
    return public.can_access_client(p_client) and (p_visibility = 'shared' or v_inv);
  end if;
  if p_project is not null then
    return public.tk_is_project_member(p_project) and (p_visibility = 'shared' or v_inv);
  end if;
  return v_inv;
end $function$;
