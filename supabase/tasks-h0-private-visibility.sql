-- =====================================================================
-- Workbench Hub H0: private tasks stay private on the server.
-- Spec: docs/workbench-hub-spec.md (H0, R3). Self-test:
-- supabase/tasks-h0-private-visibility-tests.sql (ends in ROLLBACK).
--
-- Re-runnable. Both bodies start from the live definitions
-- (pg_get_functiondef, 2026-10-16) and change only the visibility check.
-- Grants are untouched (create or replace keeps the ACL: authenticated
-- yes, anon no). security definer + search_path = public as before.
--
-- The rule is the one every other task reader uses (tasks RLS "tk read
-- tasks", tk_search, wb_inbox for non-admins, tk_can_read_task):
--   public.tk_row_readable(id, staff_email, assignee_email, client_id,
--                          project_id, visibility)
-- = owner; or admin; or (client access and (shared, or assignee/follower)).
--
-- 1. tk_waiting_on_client (#/tasks/waiting, client strip later):
--    - open requests: the request row stays (it is the client's business),
--      but task_id, title, assignee_email, task_status and due_date are null
--      when the caller cannot read the linked task.
--    - tasks waiting with no request: the row is dropped when the caller
--      cannot read the task.
--    Column shape unchanged.
-- 2. client_health: the "N overdue tasks" factor counts a private task only
--    for people who can read it (so the count does not reveal it).
--    Shared tasks count exactly as before.
-- =====================================================================

-- 1. tk_waiting_on_client ---------------------------------------------------
create or replace function public.tk_waiting_on_client(p_client_id text default null::text)
 returns table(task_id uuid, title text, client_id text, client_name text, assignee_email text, task_status text, due_date date, request_id uuid, request_title text, request_kind text, asked_at timestamp with time zone, asked_by text, business_days_waiting integer, nudge_count integer, last_nudged_at timestamp with time zone, nudge_paused boolean, no_reply boolean, recipients integer)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_max int := public.tk__setting_int('nudge_max', 4, 0, 20);
  v_today date := (now() at time zone 'America/Chicago')::date;
begin
  if not public.is_active_staff() then
    raise exception 'tk_forbidden' using errcode = '42501';
  end if;
  return query
  -- tk h0: task fields only when the caller can read the task
  select case when v.ok then s.id end, case when v.ok then s.text end, r.client_id, c.name,
         case when v.ok then s.assignee_email end, case when v.ok then s.status end, case when v.ok then s.due_date end,
         r.id, r.title, r.kind, r.asked_at,
         r.asked_by, public.tk__business_days_since((r.asked_at at time zone 'America/Chicago')::date, v_today),
         r.nudge_count, r.last_nudged_at, r.nudge_paused, r.nudge_count >= v_max,
         cardinality(r.recipient_emails) + cardinality(r.contact_ids)
    from client_requests r
    join clients c on c.id = r.client_id
    left join staff_reminders s on s.id = r.task_id and s.deleted_at is null
    cross join lateral (
      select s.id is not null
             and public.tk_row_readable(s.id, s.staff_email, s.assignee_email, s.client_id, s.project_id, s.visibility) as ok
    ) v
   where r.status = 'open' and r.deleted_at is null and not r.legacy_doc_request
     and (p_client_id is null or r.client_id = p_client_id)
     and public.can_access_client(r.client_id)
  union all
  select s.id, s.text, s.client_id, c.name, s.assignee_email, s.status, s.due_date, null, null, null, s.waiting_since,
         null, public.tk__business_days_since((s.waiting_since at time zone 'America/Chicago')::date, v_today),
         0, null, false, false, 0
    from staff_reminders s
    join clients c on c.id = s.client_id
   where s.status = 'waiting_client' and s.deleted_at is null
     and (p_client_id is null or s.client_id = p_client_id)
     and public.can_access_client(s.client_id)
     and public.tk_row_readable(s.id, s.staff_email, s.assignee_email, s.client_id, s.project_id, s.visibility)   -- tk h0
     and not exists (select 1 from client_requests r where r.task_id = s.id and r.status = 'open'
                        and r.deleted_at is null and not r.legacy_doc_request)
   order by 11 nulls last
   limit 500;
end $function$;

-- 2. client_health: patch the live body in place (anchor must match once) ----
create or replace function pg_temp.patch_fn_multi(p_sig text, p_marker text, p_edits jsonb)
returns void language plpgsql as $f$
declare d text; e jsonb; v_from text; v_to text; n int;
begin
  d := pg_get_functiondef(p_sig::regprocedure);
  if position(p_marker in d) > 0 then return; end if;
  for e in select * from jsonb_array_elements(p_edits) loop
    v_from := e ->> 0; v_to := e ->> 1;
    n := (length(d) - length(replace(d, v_from, ''))) / length(v_from);
    if n <> (e ->> 2)::int then
      raise exception 'patch_fn_multi %: expected % occurrence(s) of anchor %, found %', p_sig, e ->> 2, v_from, n;
    end if;
    d := replace(d, v_from, v_to);
  end loop;
  if position(p_marker in d) = 0 then
    raise exception 'patch_fn_multi %: marker % missing after the edits', p_sig, p_marker;
  end if;
  execute d;
end $f$;

select pg_temp.patch_fn_multi('public.client_health(jsonb)', 'tk h0: private', jsonb_build_array(
  jsonb_build_array(
    'and r.deleted_at is null and r.status <> ''waiting_client''   -- tk v1' || chr(10) || '     group by r.client_id',
    'and r.deleted_at is null and r.status <> ''waiting_client''   -- tk v1' || chr(10)
      || '       and (r.visibility = ''shared'''
      || ' or public.tk_row_readable(r.id, r.staff_email, r.assignee_email, r.client_id, r.project_id, r.visibility))'
      || '   -- tk h0: private tasks count only for people who can read them' || chr(10)
      || '     group by r.client_id', 1)
));

-- Checks: the new rule is in place, nothing else about access moved.
do $$
declare d text;
begin
  d := pg_get_functiondef('public.tk_waiting_on_client(text)'::regprocedure);
  if position('tk_row_readable' in d) = 0 or position('security definer' in lower(d)) = 0
     or position('search_path to ''public''' in lower(d)) = 0 then
    raise exception 'tk h0: tk_waiting_on_client body check failed';
  end if;
  d := pg_get_functiondef('public.client_health(jsonb)'::regprocedure);
  if position('tk h0: private' in d) = 0 then
    raise exception 'tk h0: client_health patch missing';
  end if;
  if has_function_privilege('anon', 'public.tk_waiting_on_client(text)', 'execute')
     or has_function_privilege('anon', 'public.client_health(jsonb)', 'execute') then
    raise exception 'tk h0: anon can execute';
  end if;
  if not has_function_privilege('authenticated', 'public.tk_waiting_on_client(text)', 'execute')
     or not has_function_privilege('authenticated', 'public.client_health(jsonb)', 'execute') then
    raise exception 'tk h0: authenticated lost execute';
  end if;
end $$;
