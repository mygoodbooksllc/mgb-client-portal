-- =====================================================================
-- Tasks Phase 3, Manage projects: review fixes (2026-10-16).
-- Builds on tasks-p3-manage-projects.sql. Safe to re-run. No transaction
-- control (apply_migration wraps it). Nothing is ever deleted here.
--
--  1. (MEDIUM) A task that went to the trash WITH its project could be
--     pulled out by one statement:
--       update staff_reminders set project_id = null, deleted_at = null where id = <task>
--     (the old guard only blocked an undelete when the new project was not
--     null). Now, outside the trash / restore RPCs, a task whose
--     trashed_with_project is set cannot be undeleted or moved to another
--     project (error tk_task_in_trash). Other columns are left alone on
--     purpose: staff offboarding and time-off hand-offs reassign people on
--     every not-done task, deleted or not, and a hard refusal would abort
--     them. The task stays hidden (deleted_at stays set), so a reassigned
--     trashed task is still invisible everywhere.
--  2. (MEDIUM) tk_project_task_counts(project): open / done / other
--     people's task counts for the "Move to trash" confirm, for an admin or
--     a project manager (the project row itself carries no counts).
--  3. (LOW) tk_import_asana_apply and tk_import_assign_team ignore trashed
--     projects when they look a project up by name / client. Recreated from
--     the LIVE definition with one added condition each, nothing else.
--  4. (LOW) Restoring into a name that an active project already uses now
--     says tk_restore_name_taken (its own message) instead of tk_name_taken.
-- =====================================================================

-- 1. Guard on tasks ------------------------------------------------------
create or replace function public.tk_staff_reminders_trash_guard()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_in_rpc boolean := coalesce(current_setting('mgb.tk_project_trash', true), '') = 'on';
begin
  if tg_op = 'INSERT' then
    if not v_in_rpc then new.trashed_with_project := null; end if;
  else
    -- a task that went to the trash with its project stays put: no undelete
    -- and no move, in any form, except through the restore RPC
    if old.trashed_with_project is not null and not v_in_rpc
       and (new.deleted_at is null or new.project_id is distinct from old.project_id) then
      raise exception 'tk_task_in_trash' using errcode = '22023';
    end if;
    if not v_in_rpc then new.trashed_with_project := old.trashed_with_project; end if;
  end if;
  -- a live task may not sit in a trashed project (insert, move, or an undelete)
  if new.deleted_at is null and new.project_id is not null
     and (tg_op = 'INSERT' or new.project_id is distinct from old.project_id or old.deleted_at is not null)
     and exists (select 1 from public.tk_projects p where p.id = new.project_id and p.trashed_at is not null) then
    raise exception 'tk_project_trashed' using errcode = '22023';
  end if;
  -- an undelete clears the marker
  if new.deleted_at is null then new.trashed_with_project := null; end if;
  return new;
end $$;
revoke all on function public.tk_staff_reminders_trash_guard() from public, anon, authenticated;

-- 2. Counts for the trash confirm ------------------------------------------
create or replace function public.tk_project_task_counts(p_project uuid)
returns table (open_tasks integer, done_tasks integer, other_tasks integer)
language plpgsql security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_me text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  perform public.tk__project_gate(p_project);   -- admin or project manager only
  return query
  select (count(*) filter (where s.status <> 'done'))::int,
         (count(*) filter (where s.status = 'done'))::int,
         (count(*) filter (where lower(coalesce(s.assignee_email, s.staff_email, '')) <> v_me))::int
    from public.staff_reminders s
   where s.project_id = p_project and s.deleted_at is null;
end $$;
revoke all on function public.tk_project_task_counts(uuid) from public, anon;
grant execute on function public.tk_project_task_counts(uuid) to authenticated;

-- 3. Restore: its own message on a name clash --------------------------------
create or replace function public.tk_project_restore(p_project uuid)
returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  v_p public.tk_projects;
  v_n integer;
begin
  v_p := public.tk__project_gate(p_project);
  if v_p.trashed_at is null then
    return 0;   -- not in the trash
  end if;
  if (v_p.trashed_at < now() - interval '30 days') and not public.is_active_staff_admin() then
    raise exception 'tk_trash_expired' using errcode = '42501';
  end if;
  perform set_config('mgb.tk_project_trash', 'on', true);
  begin
    update public.tk_projects
       set trashed_at = null, trashed_by = null, trash_expired_at = null
     where id = p_project;
  exception when unique_violation then
    perform set_config('mgb.tk_project_trash', '', true);
    raise exception 'tk_restore_name_taken' using errcode = '23505';
  end;
  update public.staff_reminders
     set deleted_at = null, trashed_with_project = null
   where trashed_with_project = p_project;
  get diagnostics v_n = row_count;
  perform set_config('mgb.tk_project_trash', '', true);
  perform public.audit_write('tk_project.restored', v_p.client_id, 'tk_project', p_project::text,
                             jsonb_build_object('name', v_p.name, 'tasks_restored', v_n,
                                                'was_expired', v_p.trashed_at < now() - interval '30 days'));
  return v_n;
end $$;
revoke all on function public.tk_project_restore(uuid) from public, anon;
grant execute on function public.tk_project_restore(uuid) to authenticated;

-- 4. Asana import: ignore trashed projects ---------------------------------------
-- Takes the LIVE definition and adds one condition to each function. If the
-- text it looks for is gone it stops loudly instead of guessing.
do $do$
declare
  v text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'tk_import_asana_apply';
  if v is null then raise exception 'tk_import_asana_apply not found'; end if;
  if position('trashed_at is null' in v) = 0 then
    v_new := replace(v, 'lower(btrim(p ->> ''name'')) and archived_at is null',
                        'lower(btrim(p ->> ''name'')) and archived_at is null and trashed_at is null');
    if v_new = v then raise exception 'tk_import_asana_apply: expected project lookup not found'; end if;
    execute v_new;
  end if;

  select pg_get_functiondef(p.oid) into v
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'tk_import_assign_team';
  if v is null then raise exception 'tk_import_assign_team not found'; end if;
  if position('trashed_at is null' in v) = 0 then
    v_new := replace(v, 't.client_id = p_client_id and t.archived_at is null',
                        't.client_id = p_client_id and t.archived_at is null and t.trashed_at is null');
    if v_new = v then raise exception 'tk_import_assign_team: expected project lookup not found'; end if;
    execute v_new;
  end if;
end $do$;
