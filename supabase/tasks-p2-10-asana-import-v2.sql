-- =====================================================================
-- Tasks Phase 2, S8b: Asana import owner decisions (2026-10-16).
-- Builds on tasks-p2-8-asana-import.sql. Still OFF: the apply RPC keeps
-- refusing until tk_settings.asana_import_apply_enabled = true (not set).
--
-- Owner decisions carried here (the planner carries the rest):
--   OD7  Unassigned tasks stay unassigned. A task with no assignee is
--        "Unassigned"; anyone who can see it may claim it (tk_claim_task).
--        Every row still has an owner (staff_email): the client's
--        bookkeeper, else the team's, else the fallback.
--   OD6  Draft templates mirror Asana: due rule, lead days, the same
--        assignee (role, a named person, or left unassigned), and the open
--        Asana task is linked as the current period so switching a template
--        on never makes a second copy of it. Created OFF (draft).
--   OD4  "No team yet": clients with imported tasks and no bookkeeper.
--        tk_import_no_team_clients lists them; tk_import_assign_team gives
--        one a bookkeeper and hands the fallback-owned unassigned tasks over.
--
-- What this file does (safe to re-run, nothing dropped):
--   1. staff_reminders.is_unassigned (generated: assignee_email is null),
--      appended to the tk_tasks view.
--   2. staff_reminders_before_write: the two INSERT "assignee = owner"
--      defaults are skipped while mgb.tk_unassigned = 'on' (set only by the
--      import apply and the generator for leave_unassigned templates); the
--      non-owner assignee pin lets a claim through (mgb.tk_claim = 'on',
--      old assignee empty, new assignee = the caller).
--   3. tk_claim_task(id): the caller takes an open unassigned task they can
--      see. No email (self-assignment never emails).
--   4. task_templates.assignee_email + leave_unassigned; tk__issue_period
--      honors them; tk_save_template accepts and checks them.
--   5. tk_save_template cadence lock ignores the ledger row of a linked
--      Asana task on a draft (and unlinks it if the cadence changes).
--   6. tk_import_asana_apply v2: owner/assignee split, unassigned, template
--      mirroring + linking. tk_import_asana_undo also clears the links.
--   7. tk_import_no_team_clients(), tk_import_assign_team(client, email).
--   8. tk_schema_version() = 10.
-- Email: none from any of it (tested in tasks-p2-10-asana-import-v2-tests.sql).
-- =====================================================================

create or replace function pg_temp.patch_fn(p_sig text, p_from text, p_to text, p_expected int)
returns void language plpgsql as $f$
declare d text; n int;
begin
  d := pg_get_functiondef(p_sig::regprocedure);
  if position(p_to in d) > 0 then return; end if;
  n := (length(d) - length(replace(d, p_from, ''))) / length(p_from);
  if n <> p_expected then raise exception 'patch_fn %: expected % occurrence(s) of anchor %, found %', p_sig, p_expected, p_from, n; end if;
  execute replace(d, p_from, p_to);
end $f$;

-- 1. Unassigned flag ----------------------------------------------------------
alter table public.staff_reminders
  add column if not exists is_unassigned boolean generated always as (assignee_email is null) stored;

create or replace view public.tk_tasks with (security_invoker = true) as
 SELECT id, staff_email, text, due_date, done, created_at, client_id, priority, completed_at, kind, due_at, remind_at,
    recurrence, assignee_email, created_by, visibility, source, source_ref, status, status_changed_at, status_changed_by,
    status_before_wait, waiting_since, waiting_minutes, description, start_on, section, sort_key, parent_id, sop_section,
    review_required, series_id, updated_at, deleted_at, deleted_by, project_id, search_tsv, reviewer_email,
    send_back_count, ready_at, submitted_by, submitted_at, approved_by, approved_at, due_date_original,
    waiting_before_due_minutes, template_id, period_kind, period_start,
    is_unassigned   -- tk p2 s8b
   FROM staff_reminders
  WHERE (deleted_at IS NULL);

create index if not exists staff_reminders_unassigned_open_idx
  on public.staff_reminders (client_id, due_date) where assignee_email is null and deleted_at is null and status <> 'done';

-- 2. Trigger ------------------------------------------------------------------
select pg_temp.patch_fn('public.staff_reminders_before_write()',
$a$    new.assignee_email := coalesce(new.assignee_email, new.staff_email);
$a$,
$b$    if coalesce(current_setting('mgb.tk_unassigned', true), '') <> 'on' then   -- tk p2 s8b: import / generator may leave it empty
      new.assignee_email := coalesce(new.assignee_email, new.staff_email);
    end if;
$b$, 1);
select pg_temp.patch_fn('public.staff_reminders_before_write()',
$a$    new.assignee_email := coalesce(new.assignee_email, lower(new.staff_email));
$a$,
$b$    if coalesce(current_setting('mgb.tk_unassigned', true), '') <> 'on' then   -- tk p2 s8b
      new.assignee_email := coalesce(new.assignee_email, lower(new.staff_email));
    end if;
$b$, 1);
select pg_temp.patch_fn('public.staff_reminders_before_write()',
$a$    new.assignee_email := old.assignee_email;
$a$,
$b$    if not (coalesce(current_setting('mgb.tk_claim', true), '') = 'on'   -- tk p2 s8b: tk_claim_task only
            and old.assignee_email is null and new.assignee_email = v_me) then
      new.assignee_email := old.assignee_email;
    end if;
$b$, 1);

-- 3. Claim --------------------------------------------------------------------
create or replace function public.tk_claim_task(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_r staff_reminders;
begin
  if v_me = '' or not public.is_active_staff() then
    raise exception 'tk_forbidden' using errcode = '42501';
  end if;
  select * into v_r from staff_reminders where id = p_id and deleted_at is null for update;
  if not found or not public.tk_row_readable(v_r.id, v_r.staff_email, v_r.assignee_email, v_r.client_id, v_r.project_id, v_r.visibility) then
    raise exception 'tk_not_found' using errcode = 'P0002';
  end if;
  if v_r.assignee_email is not null then
    raise exception 'tk_already_assigned' using errcode = '22023';
  end if;
  if v_r.status not in ('todo', 'in_progress', 'waiting_client') then
    raise exception 'tk_bad_transition' using errcode = '22023';
  end if;
  if v_r.client_id is not null and not public.tk_staff_has_client(v_me, v_r.client_id) then
    raise exception 'tk_forbidden' using errcode = '42501';
  end if;
  perform set_config('mgb.tk_claim', 'on', true);
  update staff_reminders set assignee_email = v_me where id = p_id;
  perform set_config('mgb.tk_claim', '', true);
  return jsonb_build_object('id', p_id, 'assignee_email', v_me);
end $$;

-- 4. Template assignee --------------------------------------------------------
alter table public.task_templates add column if not exists assignee_email text;
alter table public.task_templates add column if not exists leave_unassigned boolean not null default false;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'task_templates_assignee_one_way') then
    alter table public.task_templates add constraint task_templates_assignee_one_way
      check (not (leave_unassigned and assignee_email is not null));
  end if;
end $$;

-- the generator: a named person (if still active with access) beats the role
select pg_temp.patch_fn('public.tk__issue_period(task_templates,jsonb,text,date,boolean)',
$a$  if v_to is null then
    return jsonb_build_object('status', 'skipped', 'reason', 'no_assignee',$a$,
$b$  if p_t.assignee_email is not null   -- tk p2 s8b: the person the template names (Asana mirror)
     and exists (select 1 from staff s where lower(s.email) = lower(p_t.assignee_email) and s.active)
     and public.tk_staff_has_client(lower(p_t.assignee_email), p_client) then
    v_to := lower(p_t.assignee_email);
  end if;
  if v_to is null then
    return jsonb_build_object('status', 'skipped', 'reason', 'no_assignee',$b$, 1);
select pg_temp.patch_fn('public.tk__issue_period(task_templates,jsonb,text,date,boolean)',
$a$  if v_away is not null then$a$,
$b$  if v_away is not null and not p_t.leave_unassigned then   -- tk p2 s8b: nobody to cover for$b$, 1);
select pg_temp.patch_fn('public.tk__issue_period(task_templates,jsonb,text,date,boolean)',
$a$    perform set_config('mgb.tk_ooo', case when v_cover is not null then 'quiet' else '' end, true);   -- tk p2 s7$a$,
$b$    perform set_config('mgb.tk_ooo', case when v_cover is not null then 'quiet' else '' end, true);   -- tk p2 s7
    perform set_config('mgb.tk_unassigned', case when p_t.leave_unassigned then 'on' else '' end, true);   -- tk p2 s8b$b$, 1);
select pg_temp.patch_fn('public.tk__issue_period(task_templates,jsonb,text,date,boolean)',
$a$      v_to, coalesce(v_cover, v_to), (p_eff ->> 'title')$a$,
$b$      v_to, case when p_t.leave_unassigned then null else coalesce(v_cover, v_to) end, (p_eff ->> 'title')$b$, 1);
select pg_temp.patch_fn('public.tk__issue_period(task_templates,jsonb,text,date,boolean)',
$a$    perform set_config('mgb.tk_ooo', '', true);   -- tk p2 s7$a$,
$b$    perform set_config('mgb.tk_ooo', '', true);   -- tk p2 s7
    perform set_config('mgb.tk_unassigned', '', true);   -- tk p2 s8b$b$, 1);

-- tk_save_template: accept assignee_email / leave_unassigned
select pg_temp.patch_fn('public.tk_save_template(uuid,jsonb)',
$a$  if v_rule is not null and not public.tk_due_rule_valid(v_rule) then
    raise exception 'tk_bad_due_rule' using errcode = '22023';
  end if;
$a$,
$b$  if v_rule is not null and not public.tk_due_rule_valid(v_rule) then
    raise exception 'tk_bad_due_rule' using errcode = '22023';
  end if;
  if nullif(btrim(p_tpl ->> 'assignee_email'), '') is not null   -- tk p2 s8b
     and not exists (select 1 from staff s where lower(s.email) = lower(btrim(p_tpl ->> 'assignee_email')) and s.active) then
    raise exception 'tk_bad_assignee' using errcode = '22023';
  end if;
$b$, 1);
select pg_temp.patch_fn('public.tk_save_template(uuid,jsonb)',
$a$      assignee_role = coalesce(p_tpl ->> 'assignee_role', assignee_role),
$a$,
$b$      assignee_role = coalesce(p_tpl ->> 'assignee_role', assignee_role),
      assignee_email = case when p_tpl ? 'assignee_email' then lower(nullif(btrim(p_tpl ->> 'assignee_email'), ''))
                            when coalesce((p_tpl ->> 'leave_unassigned')::boolean, false) then null
                            else assignee_email end,   -- tk p2 s8b
      leave_unassigned = case when nullif(btrim(p_tpl ->> 'assignee_email'), '') is not null then false
                              else coalesce((p_tpl ->> 'leave_unassigned')::boolean, leave_unassigned) end,   -- tk p2 s8b
$b$, 1);

select pg_temp.patch_fn('public.tk_save_template(uuid,jsonb)',
$a$    returning id into v_id;
  else
$a$,
$b$    returning id into v_id;
    update task_templates   -- tk p2 s8b
       set assignee_email = lower(nullif(btrim(p_tpl ->> 'assignee_email'), '')),
           leave_unassigned = nullif(btrim(p_tpl ->> 'assignee_email'), '') is null
                              and coalesce((p_tpl ->> 'leave_unassigned')::boolean, false)
     where id = v_id;
  else
$b$, 1);

-- 5. Cadence lock: a linked Asana task alone does not lock a draft
select pg_temp.patch_fn('public.tk_save_template(uuid,jsonb)',
$a$        or exists (select 1 from task_template_issued i where i.template_id = v_id))$a$,
$b$        or exists (select 1 from task_template_issued i left join staff_reminders r on r.id = i.reminder_id
                    where i.template_id = v_id and r.source is distinct from 'asana'))   -- tk p2 s8b$b$, 1);
select pg_temp.patch_fn('public.tk_save_template(uuid,jsonb)',
$a$      raise exception 'tk_cadence_locked' using errcode = '22023';
    end if;
$a$,
$b$      raise exception 'tk_cadence_locked' using errcode = '22023';
    end if;
    if public.tk__template_kind(coalesce(p_tpl ->> 'cadence', v_old.cadence),
                                coalesce(p_tpl ->> 'period_basis', v_old.period_basis))
       is distinct from public.tk__template_kind(v_old.cadence, v_old.period_basis) then   -- tk p2 s8b: unlink the Asana task
      update staff_reminders r set template_id = null, period_kind = null, period_start = null
        from task_template_issued i where i.template_id = v_id and r.id = i.reminder_id;
      delete from task_template_issued where template_id = v_id;
    end if;
$b$, 1);

-- 6. Apply v2 -------------------------------------------------------------------
create or replace function public.tk_import_asana_apply(p_run uuid, p_confirm text, p_fallback_email text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_by text := public.tk__import_caller();
  v_run tk_import_runs;
  v_fallback text := lower(btrim(coalesce(p_fallback_email, '')));
  v_creator text;
  r record;
  p jsonb;
  v_id uuid;
  v_project uuid;
  v_parent uuid;
  v_client text;
  v_owner text;
  v_assignee text;
  v_rule jsonb;
  v_kind text;
  v_rid uuid;
  v_due date;
  v_start date;
  v_r staff_reminders;
  v_n jsonb := jsonb_build_object('projects_created', 0, 'projects_merged', 0, 'tasks_created', 0, 'tasks_unassigned', 0,
                                  'templates_created', 0, 'templates_linked', 0, 'already_imported', 0, 'skipped', 0);
  v_skips jsonb := '[]'::jsonb;
begin
  if coalesce((select value from tk_settings where key = 'asana_import_apply_enabled'), 'false'::jsonb) <> 'true'::jsonb then
    raise exception 'tk_import_disabled' using errcode = '42501';
  end if;
  if p_run is null or p_confirm is distinct from 'IMPORT ' || left(p_run::text, 8) then
    raise exception 'tk_import_confirm' using errcode = '22023';
  end if;
  select * into v_run from tk_import_runs where id = p_run for update;
  if not found or v_run.status <> 'planned' then
    raise exception 'tk_import_bad_run' using errcode = '22023';
  end if;
  if not exists (select 1 from staff where lower(email) = v_fallback and active) then
    raise exception 'tk_import_fallback' using errcode = '22023';
  end if;
  v_creator := case when v_by like 'db:%' then v_fallback else v_by end;

  perform set_config('mgb.tk_import', 'on', true);
  perform set_config('mgb.tk_actor', 'asana-import', true);
  perform set_config('mgb.tk_unassigned', 'on', true);   -- s8b: unassigned stays unassigned

  -- Projects
  for r in select * from tk_import_plan_rows where run_id = p_run and kind = 'project' order by seq loop
    p := r.payload;
    if exists (select 1 from tk_asana_import_map where kind = 'project' and asana_gid = r.asana_gid) then
      v_n := jsonb_set(v_n, '{already_imported}', to_jsonb((v_n ->> 'already_imported')::int + 1));
      continue;
    end if;
    v_client := nullif(p ->> 'client_id', '');
    if (p ->> 'kind') = 'onboarding' and (v_client is null or not exists (select 1 from clients where id = v_client)) then
      insert into tk_asana_import_map values ('project', r.asana_gid, 'tk_projects', null, p_run, 'skipped', 'client_missing');
      v_skips := v_skips || jsonb_build_object('kind', 'project', 'gid', r.asana_gid, 'reason', 'client_missing');
      v_n := jsonb_set(v_n, '{skipped}', to_jsonb((v_n ->> 'skipped')::int + 1));
      continue;
    end if;
    if (p ->> 'kind') <> 'onboarding' then v_client := null; end if;
    v_owner := lower(coalesce(p ->> 'owner_email', ''));
    if not exists (select 1 from staff where lower(email) = v_owner and active) then v_owner := v_fallback; end if;
    select id into v_id from tk_projects
     where coalesce(client_id, '') = coalesce(v_client, '') and lower(name) = lower(btrim(p ->> 'name')) and archived_at is null
     limit 1;
    if v_id is not null then
      insert into tk_asana_import_map values ('project', r.asana_gid, 'tk_projects', v_id::text, p_run, 'merged', 'same name already in the portal');
      v_n := jsonb_set(v_n, '{projects_merged}', to_jsonb((v_n ->> 'projects_merged')::int + 1));
    else
      insert into tk_projects (name, kind, client_id, owner_email, sections)
      values (left(btrim(p ->> 'name'), 120), case when v_client is null then 'internal' else 'onboarding' end, v_client, v_owner,
              coalesce((select array_agg(left(s, 60)) from (select jsonb_array_elements_text(p -> 'sections') s limit 30) x), '{}'))
      returning id into v_id;
      insert into tk_asana_import_map values ('project', r.asana_gid, 'tk_projects', v_id::text, p_run, 'created', null);
      v_n := jsonb_set(v_n, '{projects_created}', to_jsonb((v_n ->> 'projects_created')::int + 1));
    end if;
    insert into tk_project_members (project_id, staff_email, role, added_by)
    select v_id, s.email, case when s.email = v_owner then 'owner' else 'member' end, 'asana-import'
      from staff s
     where s.active and s.email = lower(s.email)
       and (s.email = v_owner or s.email in (select lower(jsonb_array_elements_text(coalesce(p -> 'members', '[]'::jsonb)))))
    on conflict do nothing;
  end loop;

  -- Tasks (staged parents first)
  for r in select * from tk_import_plan_rows where run_id = p_run and kind = 'task' order by seq loop
    p := r.payload;
    if exists (select 1 from tk_asana_import_map where kind = 'task' and asana_gid = r.asana_gid)
       or exists (select 1 from staff_reminders where source = 'asana' and source_ref = r.asana_gid) then
      v_n := jsonb_set(v_n, '{already_imported}', to_jsonb((v_n ->> 'already_imported')::int + 1));
      continue;
    end if;
    v_client := nullif(p ->> 'client_id', '');
    if v_client is not null and not exists (select 1 from clients where id = v_client) then
      insert into tk_asana_import_map values ('task', r.asana_gid, 'staff_reminders', null, p_run, 'skipped', 'client_missing');
      v_skips := v_skips || jsonb_build_object('kind', 'task', 'gid', r.asana_gid, 'reason', 'client_missing');
      v_n := jsonb_set(v_n, '{skipped}', to_jsonb((v_n ->> 'skipped')::int + 1));
      continue;
    end if;
    v_project := null;
    if nullif(p ->> 'project_gid', '') is not null then
      select nullif(local_id, '')::uuid into v_project from tk_asana_import_map
       where kind = 'project' and asana_gid = regexp_replace(p ->> 'project_gid', '^tracker:', '') and status in ('created', 'merged');
      if v_project is null then
        insert into tk_asana_import_map values ('task', r.asana_gid, 'staff_reminders', null, p_run, 'skipped', 'project_not_imported');
        v_skips := v_skips || jsonb_build_object('kind', 'task', 'gid', r.asana_gid, 'reason', 'project_not_imported');
        v_n := jsonb_set(v_n, '{skipped}', to_jsonb((v_n ->> 'skipped')::int + 1));
        continue;
      end if;
    end if;
    v_parent := null;
    if nullif(p ->> 'parent_gid', '') is not null then
      select nullif(local_id, '')::uuid into v_parent from tk_asana_import_map
       where kind = 'task' and asana_gid = p ->> 'parent_gid' and status = 'created';
      if v_parent is null then
        insert into tk_asana_import_map values ('task', r.asana_gid, 'staff_reminders', null, p_run, 'skipped', 'parent_not_imported');
        v_skips := v_skips || jsonb_build_object('kind', 'task', 'gid', r.asana_gid, 'reason', 'parent_not_imported');
        v_n := jsonb_set(v_n, '{skipped}', to_jsonb((v_n ->> 'skipped')::int + 1));
        continue;
      end if;
    end if;
    -- s8b: owner (staff_email) and assignee are separate. An empty assignee stays empty.
    v_assignee := lower(nullif(btrim(coalesce(p ->> 'assignee_email', '')), ''));
    v_owner := lower(coalesce(nullif(btrim(p ->> 'staff_email'), ''), v_assignee, ''));
    if not exists (select 1 from staff where lower(email) = v_owner and active) then v_owner := v_fallback; end if;
    if v_assignee is not null and not exists (select 1 from staff where lower(email) = v_assignee and active) then
      v_assignee := v_owner;   -- left since the snapshot: the owner takes it (S8 rule)
    end if;
    insert into staff_reminders (staff_email, assignee_email, created_by, text, description, client_id, project_id, parent_id,
                                 section, due_date, start_on, status, priority, kind, visibility, source, source_ref)
    values (v_owner, v_assignee, v_creator,
            left(coalesce(nullif(btrim(p ->> 'title'), ''), 'Untitled Asana task'), 200),
            left(p ->> 'description', 5000),
            v_client, v_project, v_parent,
            left(nullif(btrim(p ->> 'section'), ''), 60),
            nullif(p ->> 'due_date', '')::date,
            nullif(p ->> 'start_on', '')::date,
            case when p ->> 'status' in ('todo', 'in_progress', 'waiting_client') then p ->> 'status' else 'todo' end,
            case when p ->> 'priority' in ('low', 'normal', 'high') then p ->> 'priority' else 'normal' end,
            'task',
            case when v_client is not null or v_project is not null then coalesce(nullif(p ->> 'visibility', ''), 'shared') else 'private' end,
            'asana', r.asana_gid)
    returning id into v_id;
    insert into tk_asana_import_map values ('task', r.asana_gid, 'staff_reminders', v_id::text, p_run, 'created', null);
    v_n := jsonb_set(v_n, '{tasks_created}', to_jsonb((v_n ->> 'tasks_created')::int + 1));
    if v_assignee is null then
      v_n := jsonb_set(v_n, '{tasks_unassigned}', to_jsonb((v_n ->> 'tasks_unassigned')::int + 1));
    end if;
  end loop;

  -- Draft recurring templates mirroring Asana (status draft, inactive; an admin confirms each one)
  for r in select * from tk_import_plan_rows where run_id = p_run and kind = 'template' order by seq loop
    p := r.payload;
    if exists (select 1 from tk_asana_import_map where kind = 'template' and asana_gid = r.asana_gid)
       or exists (select 1 from task_templates where source = 'asana' and source_ref = r.asana_gid) then
      v_n := jsonb_set(v_n, '{already_imported}', to_jsonb((v_n ->> 'already_imported')::int + 1));
      continue;
    end if;
    v_client := nullif(p ->> 'client_id', '');
    if v_client is null or not exists (select 1 from clients where id = v_client)
       or coalesce(p ->> 'cadence', '') not in ('weekly', 'monthly', 'quarterly', 'annually') then
      insert into tk_asana_import_map values ('template', r.asana_gid, 'task_templates', null, p_run, 'skipped', 'client_missing_or_bad_cadence');
      v_n := jsonb_set(v_n, '{skipped}', to_jsonb((v_n ->> 'skipped')::int + 1));
      continue;
    end if;
    v_rule := case when jsonb_typeof(p -> 'due_rule') = 'object' and public.tk_due_rule_valid(p -> 'due_rule') then p -> 'due_rule' end;
    v_assignee := lower(nullif(btrim(coalesce(p ->> 'assignee_email', '')), ''));
    if v_assignee is not null and not exists (select 1 from staff where lower(email) = v_assignee and active) then
      v_assignee := null;   -- the role decides instead
    end if;
    insert into task_templates (title, cadence, client_ids, checklist, status, active, source, source_ref, created_by,
                                due_rule, lead_days, assignee_role, assignee_email, leave_unassigned, period_basis)
    values (left(btrim(p ->> 'title'), 200), p ->> 'cadence', array[v_client],
            coalesce((select array_agg(left(c, 200)) from (select jsonb_array_elements_text(p -> 'checklist') c limit 50) x), '{}'),
            'draft', false, 'asana', r.asana_gid, v_creator,
            v_rule,
            least(90, greatest(0, coalesce(nullif(p ->> 'lead_days', '')::int, 14))),
            case when p ->> 'assignee_role' in ('bookkeeper', 'backup', 'account_manager', 'reviewer') then p ->> 'assignee_role' else 'bookkeeper' end,
            case when coalesce((p ->> 'leave_unassigned')::boolean, false) then null else v_assignee end,
            coalesce((p ->> 'leave_unassigned')::boolean, false),
            'calendar')
    returning id into v_id;
    insert into tk_asana_import_map values ('template', r.asana_gid, 'task_templates', v_id::text, p_run, 'created', null);
    v_n := jsonb_set(v_n, '{templates_created}', to_jsonb((v_n ->> 'templates_created')::int + 1));

    -- Link the open Asana task as this template's current period, so turning the template on skips it.
    v_rid := null;
    select nullif(m.local_id, '')::uuid into v_rid from tk_asana_import_map m
     where m.kind = 'task' and m.asana_gid = coalesce(nullif(p ->> 'instance_gid', ''), r.asana_gid) and m.status = 'created';
    if v_rid is not null and v_rule is not null then
      select * into v_r from staff_reminders where id = v_rid and deleted_at is null;
      v_due := v_r.due_date;
      if v_r.id is not null and v_due is not null and v_r.template_id is null and v_r.client_id = v_client then
        v_kind := public.tk__template_kind(p ->> 'cadence', 'calendar');
        select x.s into v_start
          from (select distinct public.tk_period_start_for(v_kind, d::date, null) s
                  from generate_series(v_due - 400, v_due, interval '1 day') d) x
         where public.tk_resolve_due(v_rule, x.s, public.tk__period_end(v_kind, x.s)) = v_due
            or (v_kind = 'week' and public.tk_resolve_due(v_rule, x.s, public.tk__period_end(v_kind, x.s)) between v_due and v_due + 2)
         order by x.s desc
         limit 1;
        if v_start is not null then
          insert into task_template_issued (template_id, client_id, period, reminder_id, assignee)
          values (v_id, v_client, v_start, v_rid, coalesce(v_r.assignee_email, v_r.staff_email))
          on conflict do nothing;
          update staff_reminders
             set template_id = v_id,
                 period_kind = case when v_kind in ('month', 'quarter', 'year') then v_kind end,
                 period_start = case when v_kind in ('month', 'quarter', 'year') then v_start end
           where id = v_rid;
          v_n := jsonb_set(v_n, '{templates_linked}', to_jsonb((v_n ->> 'templates_linked')::int + 1));
        end if;
      end if;
    end if;
  end loop;

  v_n := v_n || jsonb_build_object('skips', v_skips);
  update tk_import_runs
     set status = 'applied', applied_by = v_by, applied_at = now(), fallback_email = v_fallback, result = v_n
   where id = p_run;
  perform set_config('mgb.tk_import', '', true);
  perform set_config('mgb.tk_actor', '', true);
  perform set_config('mgb.tk_unassigned', '', true);
  return v_n;
end $$;

-- undo also clears the template links (the ledger rows of its templates)
select pg_temp.patch_fn('public.tk_import_asana_undo(uuid,text)',
$a$  update task_templates t set status = 'retired', active = false$a$,
$b$  delete from task_template_issued i using tk_asana_import_map m   -- tk p2 s8b
   where m.run_id = p_run and m.kind = 'template' and m.status = 'created' and i.template_id = m.local_id::uuid;
  update task_templates t set status = 'retired', active = false$b$, 1);

-- 7. No team yet ------------------------------------------------------------------
-- Clients with open imported Asana tasks and no assigned bookkeeper.
create or replace function public.tk_import_no_team_clients()
returns table (client_id text, client_name text, open_tasks int, unassigned_tasks int)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.tk__import_caller();
  return query
  select c.id, c.name, count(*)::int, count(*) filter (where r.assignee_email is null)::int
    from clients c
    join staff_reminders r on r.client_id = c.id and r.source = 'asana' and r.deleted_at is null and r.status <> 'done'
   where nullif(btrim(coalesce(c.assigned_bookkeeper_email, '')), '') is null
     and not coalesce(c.test_only, false) and not coalesce(c.is_internal, false)
   group by c.id, c.name
   order by c.name;
end $$;

-- Give a No-team-yet client its bookkeeper. Sets clients.assigned_bookkeeper_email
-- (the existing trigger grants staff_client_access), adds the bookkeeper to the
-- client's projects, and hands the client's open imported tasks that the import
-- parked on the fallback with nobody assigned over to the bookkeeper as owner.
-- They stay unassigned (claimable); assigned tasks are not touched.
create or replace function public.tk_import_assign_team(p_client_id text, p_bookkeeper_email text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_by text := public.tk__import_caller();
  v_bk text := lower(btrim(coalesce(p_bookkeeper_email, '')));
  v_name text;
  v_moved int := 0;
  v_projects int := 0;
begin
  select s.name into v_name from staff s where lower(s.email) = v_bk and s.active;
  if v_name is null then
    raise exception 'tk_bad_assignee' using errcode = '22023';
  end if;
  if not exists (select 1 from clients c where c.id = p_client_id and not coalesce(c.is_internal, false)) then
    raise exception 'tk_not_found' using errcode = 'P0002';
  end if;
  if exists (select 1 from clients c where c.id = p_client_id
              and nullif(btrim(coalesce(c.assigned_bookkeeper_email, '')), '') is not null
              and lower(c.assigned_bookkeeper_email) <> v_bk) then
    raise exception 'tk_has_team' using errcode = '22023';   -- only for No team yet clients; change a team on the client page
  end if;
  -- clients_bookkeeper_before_write fills the display JSON; _after_write grants access
  update clients set assigned_bookkeeper_email = v_bk where id = p_client_id;

  insert into tk_project_members (project_id, staff_email, role, added_by)
  select t.id, v_bk, 'member', 'asana-import'
    from tk_projects t where t.client_id = p_client_id and t.archived_at is null
  on conflict do nothing;
  get diagnostics v_projects = row_count;

  perform set_config('mgb.offboarding', 'on', true);   -- the owner column moves (live revert bypass)
  perform set_config('mgb.tk_import', 'on', true);     -- and nobody is emailed
  update staff_reminders r
     set staff_email = v_bk
   where r.client_id = p_client_id and r.source = 'asana' and r.deleted_at is null and r.status <> 'done'
     and r.assignee_email is null
     and lower(r.staff_email) in (select lower(x.fallback_email) from tk_import_runs x
                                   where x.status = 'applied' and x.fallback_email is not null)
     and lower(r.staff_email) <> v_bk;
  get diagnostics v_moved = row_count;
  perform set_config('mgb.offboarding', '', true);
  perform set_config('mgb.tk_import', '', true);
  return jsonb_build_object('client_id', p_client_id, 'bookkeeper', v_bk, 'tasks_moved', v_moved,
                            'projects_joined', v_projects, 'by', v_by);
end $$;

-- Grants ------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'public.tk_claim_task(uuid)',
    'public.tk_import_no_team_clients()',
    'public.tk_import_assign_team(text, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- 8. Version --------------------------------------------------------------------
create or replace function public.tk_schema_version()
returns integer
language sql
stable
set search_path = public
as $$ select 10 $$;
