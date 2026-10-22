-- =====================================================================
-- Slate: change a client's bookkeeper from the client list header
-- (owner request 2026-10-22; spec docs/slate-change-bookkeeper.md).
--
-- tk_change_bookkeeper(client, new_email, move_open_tasks default true):
-- an admin swaps the bookkeeper of a client that already has one. It only
-- updates clients.assigned_bookkeeper_email (the column the Client Roster
-- edit writes); the existing triggers in assigned-bookkeeper-email.sql
-- refresh the display JSON and grant the new bookkeeper staff_client_access.
-- The new bookkeeper joins the client's live projects. With move_open_tasks,
-- the old bookkeeper's open shared tasks on that client that are on them or
-- on nobody move to the new one (in-review and private tasks stay; tasks
-- anyone else owns or is on are never touched). The old bookkeeper keeps
-- their access. One audit_log row (client.bookkeeper_changed).
--
-- Email: none (mgb.tk_import guard, as in tk_import_assign_team).
-- tk_schema_version is not changed. Safe to re-run; nothing dropped.
-- Self-test: supabase/slate-change-bookkeeper-tests.sql (ends in ROLLBACK).
-- Applied to production 2026-10-22 (self-test green first; anon has no EXECUTE).
-- =====================================================================

create or replace function public.tk_change_bookkeeper(p_client_id text, p_new_email text, p_move_open_tasks boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_by text := public.tk__import_caller();   -- active admin (or a direct database session), else tk_forbidden
  v_new text := lower(btrim(coalesce(p_new_email, '')));
  v_old text;
  v_moved int := 0;
  v_review int := 0;
  v_projects int := 0;
begin
  if not exists (select 1 from staff s where lower(s.email) = v_new and s.active) then
    raise exception 'tk_bad_assignee' using errcode = '22023';
  end if;
  select lower(nullif(btrim(coalesce(c.assigned_bookkeeper_email, '')), '')) into v_old
    from clients c
   where c.id = p_client_id and not coalesce(c.is_internal, false)
     for update;
  if not found then
    raise exception 'tk_not_found' using errcode = 'P0002';
  end if;
  if v_old is null then
    raise exception 'tk_no_team' using errcode = '22023';   -- no bookkeeper yet: Assign team
  end if;
  if v_old = v_new then
    raise exception 'tk_same_bookkeeper' using errcode = '22023';
  end if;

  -- clients_bookkeeper_before_write fills the display JSON; _after_write grants access
  update clients set assigned_bookkeeper_email = v_new where id = p_client_id;

  insert into tk_project_members (project_id, staff_email, role, added_by)
  select t.id, v_new, 'member', v_by
    from tk_projects t where t.client_id = p_client_id and t.archived_at is null and t.trashed_at is null
  on conflict do nothing;
  get diagnostics v_projects = row_count;

  if coalesce(p_move_open_tasks, true) then
    select count(*) into v_review
      from staff_reminders r
     where r.client_id = p_client_id and r.deleted_at is null and r.status = 'ready_for_review'
       and coalesce(r.kind, 'task') = 'task' and coalesce(r.visibility, 'shared') <> 'private'
       and lower(r.staff_email) = v_old
       and (r.assignee_email is null or lower(r.assignee_email) = v_old);

    perform set_config('mgb.offboarding', 'on', true);   -- the owner column moves (live revert bypass)
    perform set_config('mgb.tk_import', 'on', true);     -- and nobody is emailed
    update staff_reminders r
       set staff_email = v_new,
           assignee_email = case when r.assignee_email is null then null else v_new end
     where r.client_id = p_client_id and r.deleted_at is null
       and r.status not in ('done', 'ready_for_review')   -- in review stays with the old bookkeeper (as time off does)
       and coalesce(r.kind, 'task') = 'task' and coalesce(r.visibility, 'shared') <> 'private'
       and lower(r.staff_email) = v_old
       and (r.assignee_email is null or lower(r.assignee_email) = v_old);
    get diagnostics v_moved = row_count;
    perform set_config('mgb.offboarding', '', true);
    perform set_config('mgb.tk_import', '', true);
  end if;

  perform public.audit_write('client.bookkeeper_changed', p_client_id, 'client', p_client_id,
    jsonb_build_object('from', v_old, 'to', v_new, 'tasks_moved', v_moved));

  return jsonb_build_object('client_id', p_client_id, 'old_bookkeeper', v_old, 'bookkeeper', v_new,
                            'tasks_moved', v_moved, 'tasks_in_review', v_review,
                            'projects_joined', v_projects, 'by', v_by);
end $$;

-- Grants ------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'public.tk_change_bookkeeper(text, text, boolean)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
