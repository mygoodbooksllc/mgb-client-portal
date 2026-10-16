-- =====================================================================
-- Tasks Phase 2, S8: one-time import of OPEN Asana tasks (apply path, OFF).
-- Spec: docs/tasks-phase2-spec.md G (Asana import) + K row S8.
-- Dry run: scripts/asana-import/ (planner + report builder) and
-- docs/asana-import-dry-run-report.md. Nothing here imports anything by
-- itself: the tables start empty and the apply RPC refuses to run until
-- tk_settings.asana_import_apply_enabled = true (missing = off).
--
-- Owner decisions (OD7): open tasks only, no completed history; Asana users
-- with no active staff row go to a fallback staff address passed at apply
-- time; duplicate onboarding projects merge (newest wins, done by the
-- planner); map to existing clients only (a missing client skips the row).
--
-- Deviation from spec G: the plan is built by the pure JS planner
-- (scripts/asana-import/asanaImportPlan.js, node-tested) instead of a SQL
-- tk_import_asana_plan, so the dry run needed no database writes at all.
-- tk_import_asana_stage loads that plan into the import tables after the
-- owner has read the report.
--
-- What this file does (safe to re-run, nothing dropped):
--   1. tk_import_runs (one row per import batch), tk_import_plan_rows (the
--      staged plan), tk_asana_import_map (permanent: one row per Asana gid
--      and kind, with the run id; the re-run and rollback key). RLS on all
--      three, each starts from "revoke all"; admins read, nobody writes
--      directly.
--   2. Unique partial indexes on staff_reminders(source_ref) and
--      task_templates(source_ref) where source = 'asana' (no deleted_at
--      filter: an undone gid is never imported twice by accident).
--   3. notify_enqueue_task_assigned: no "assigned to you" email while
--      mgb.tk_import = 'on', and never for an INSERT with source 'asana'.
--   4. tk_import_asana_stage (admin): stage a plan as a 'planned' run.
--      tk_import_asana_apply (admin, switch on, typed confirm): create the
--      rows. tk_import_asana_undo (admin, typed confirm): roll a run back.
--   5. tk_schema_version() = 9.
--
-- Email: none. The import never writes notification_outbox (tested in
-- tasks-p2-8-asana-import-tests.sql, which runs as an admin JWT).
-- =====================================================================

-- Temporary helper (same as tasks-p2-7-ooo.sql).
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

-- 1. Tables -------------------------------------------------------------------
create table if not exists public.tk_import_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'asana' check (source = 'asana'),
  snapshot_at timestamptz,
  status text not null default 'planned' check (status in ('planned', 'applied', 'undone')),
  report jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  fallback_email text,
  created_by text,
  created_at timestamptz not null default now(),
  applied_by text,
  applied_at timestamptz,
  undone_by text,
  undone_at timestamptz
);
alter table public.tk_import_runs enable row level security;
revoke all on public.tk_import_runs from anon, authenticated;
grant select on public.tk_import_runs to authenticated;
drop policy if exists tk_import_runs_admin_read on public.tk_import_runs;
create policy tk_import_runs_admin_read on public.tk_import_runs
  for select to authenticated using (public.is_active_staff_admin());

create table if not exists public.tk_import_plan_rows (
  run_id uuid not null references public.tk_import_runs (id) on delete cascade,
  kind text not null check (kind in ('project', 'task', 'template')),
  asana_gid text not null check (length(asana_gid) between 1 and 120),
  seq int not null,
  payload jsonb not null,
  primary key (run_id, kind, asana_gid)
);
create index if not exists tk_import_plan_rows_seq on public.tk_import_plan_rows (run_id, kind, seq);
alter table public.tk_import_plan_rows enable row level security;
revoke all on public.tk_import_plan_rows from anon, authenticated;
grant select on public.tk_import_plan_rows to authenticated;
drop policy if exists tk_import_plan_rows_admin_read on public.tk_import_plan_rows;
create policy tk_import_plan_rows_admin_read on public.tk_import_plan_rows
  for select to authenticated using (public.is_active_staff_admin());

create table if not exists public.tk_asana_import_map (
  kind text not null check (kind in ('project', 'task', 'template')),
  asana_gid text not null check (length(asana_gid) between 1 and 120),
  local_table text not null check (local_table in ('tk_projects', 'staff_reminders', 'task_templates')),
  local_id text,                                  -- text: tk_projects/staff_reminders/task_templates ids are uuids today
  run_id uuid not null references public.tk_import_runs (id),
  status text not null check (status in ('created', 'merged', 'skipped', 'undone')),
  notes text,
  imported_at timestamptz not null default now(),
  primary key (kind, asana_gid)
);
create index if not exists tk_asana_import_map_run on public.tk_asana_import_map (run_id, kind);
alter table public.tk_asana_import_map enable row level security;
revoke all on public.tk_asana_import_map from anon, authenticated;
grant select on public.tk_asana_import_map to authenticated;
drop policy if exists tk_asana_import_map_admin_read on public.tk_asana_import_map;
create policy tk_asana_import_map_admin_read on public.tk_asana_import_map
  for select to authenticated using (public.is_active_staff_admin());

-- 2. One row per Asana gid ----------------------------------------------------
create unique index if not exists staff_reminders_asana_ref_uniq
  on public.staff_reminders (source_ref) where source = 'asana';
create unique index if not exists task_templates_asana_ref_uniq
  on public.task_templates (source_ref) where source = 'asana';

-- 3. No assignment email from an import ---------------------------------------
select pg_temp.patch_fn('public.notify_enqueue_task_assigned()',
$a$     or coalesce(current_setting('mgb.tk_ooo', true), '') in ('on', 'quiet') then   -- tk p2 s7: one OOO summary instead$a$,
$b$     or coalesce(current_setting('mgb.tk_ooo', true), '') in ('on', 'quiet')   -- tk p2 s7: one OOO summary instead
     or coalesce(current_setting('mgb.tk_import', true), '') = 'on' then   -- tk p2 s8: Asana import sends nothing$b$, 1);
select pg_temp.patch_fn('public.notify_enqueue_task_assigned()',
$a$  if coalesce(new.source, 'manual') = 'access_request' then$a$,
$b$  if coalesce(new.source, 'manual') = 'access_request'
     or (tg_op = 'INSERT' and new.source = 'asana') then   -- tk p2 s8$b$, 1);

-- 4. RPCs -----------------------------------------------------------------------
-- Who may run them: an active admin (Google sign-in), or a direct database
-- session with no JWT (SQL editor / migration role). anon has no EXECUTE.
create or replace function public.tk__import_caller()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if v_me <> '' then
    if not public.is_active_staff_admin() then
      raise exception 'tk_forbidden' using errcode = '42501';
    end if;
    return v_me;
  end if;
  if coalesce(auth.jwt() ->> 'role', '') in ('anon', 'authenticated') then
    raise exception 'tk_forbidden' using errcode = '42501';
  end if;
  return 'db:' || session_user;
end $$;

-- Stage a plan built by scripts/asana-import/buildDryRun.js (--stage-json).
-- p_rows: [{kind, asana_gid, payload}, ...] in apply order (projects, then
-- tasks parents first, then templates). Writes only the import tables.
create or replace function public.tk_import_asana_stage(p_snapshot_at timestamptz, p_report jsonb, p_rows jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_by text := public.tk__import_caller();
  v_run uuid;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'tk_bad_request' using errcode = '22023';
  end if;
  insert into tk_import_runs (snapshot_at, report, created_by)
  values (p_snapshot_at, coalesce(p_report, '{}'::jsonb), v_by)
  returning id into v_run;
  insert into tk_import_plan_rows (run_id, kind, asana_gid, seq, payload)
  select v_run, r.value ->> 'kind', r.value ->> 'asana_gid', r.ord::int, r.value -> 'payload'
    from jsonb_array_elements(p_rows) with ordinality as r(value, ord);
  return v_run;
end $$;

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
  v_n jsonb := jsonb_build_object('projects_created', 0, 'projects_merged', 0, 'tasks_created', 0,
                                  'templates_created', 0, 'already_imported', 0, 'skipped', 0);
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
    v_owner := lower(coalesce(p ->> 'assignee_email', ''));
    if not exists (select 1 from staff where lower(email) = v_owner and active) then v_owner := v_fallback; end if;
    insert into staff_reminders (staff_email, assignee_email, created_by, text, description, client_id, project_id, parent_id,
                                 section, due_date, start_on, status, priority, kind, visibility, source, source_ref)
    values (v_owner, v_owner, v_creator,
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
  end loop;

  -- Draft recurring templates (status draft, inactive; an admin confirms each one)
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
    insert into task_templates (title, cadence, client_ids, checklist, status, active, source, source_ref, created_by)
    values (left(btrim(p ->> 'title'), 200), p ->> 'cadence', array[v_client],
            coalesce((select array_agg(left(c, 200)) from (select jsonb_array_elements_text(p -> 'checklist') c limit 50) x), '{}'),
            'draft', false, 'asana', r.asana_gid, v_creator)
    returning id into v_id;
    insert into tk_asana_import_map values ('template', r.asana_gid, 'task_templates', v_id::text, p_run, 'created', null);
    v_n := jsonb_set(v_n, '{templates_created}', to_jsonb((v_n ->> 'templates_created')::int + 1));
  end loop;

  v_n := v_n || jsonb_build_object('skips', v_skips);
  update tk_import_runs
     set status = 'applied', applied_by = v_by, applied_at = now(), fallback_email = v_fallback, result = v_n
   where id = p_run;
  perform set_config('mgb.tk_import', '', true);
  perform set_config('mgb.tk_actor', '', true);
  return v_n;
end $$;

-- Roll a run back: soft-delete its tasks, archive its projects, retire its
-- draft templates, mark its map rows undone. Undone gids stay in the map, so
-- a later apply never re-creates them (clear them by hand to re-import).
-- Works with the apply switch off, so a rollback is never blocked.
create or replace function public.tk_import_asana_undo(p_run uuid, p_confirm text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_by text := public.tk__import_caller();
  v_run tk_import_runs;
  v_tasks int; v_projects int; v_templates int;
begin
  if p_run is null or p_confirm is distinct from 'UNDO ' || left(p_run::text, 8) then
    raise exception 'tk_import_confirm' using errcode = '22023';
  end if;
  select * into v_run from tk_import_runs where id = p_run for update;
  if not found or v_run.status <> 'applied' then
    raise exception 'tk_import_bad_run' using errcode = '22023';
  end if;
  perform set_config('mgb.tk_import', 'on', true);
  perform set_config('mgb.tk_actor', 'asana-import', true);

  update staff_reminders s set deleted_at = now()
    from tk_asana_import_map m
   where m.run_id = p_run and m.kind = 'task' and m.status = 'created'
     and s.id = m.local_id::uuid and s.deleted_at is null;
  get diagnostics v_tasks = row_count;
  update tk_projects t set archived_at = now()
    from tk_asana_import_map m
   where m.run_id = p_run and m.kind = 'project' and m.status = 'created'
     and t.id = m.local_id::uuid and t.archived_at is null;
  get diagnostics v_projects = row_count;
  update task_templates t set status = 'retired', active = false
    from tk_asana_import_map m
   where m.run_id = p_run and m.kind = 'template' and m.status = 'created'
     and t.id = m.local_id::uuid;
  get diagnostics v_templates = row_count;
  update tk_asana_import_map set status = 'undone', notes = coalesce(notes || '; ', '') || 'undone ' || now()::date
   where run_id = p_run and status in ('created', 'merged');
  update tk_import_runs set status = 'undone', undone_by = v_by, undone_at = now() where id = p_run;
  perform set_config('mgb.tk_import', '', true);
  perform set_config('mgb.tk_actor', '', true);
  return jsonb_build_object('tasks_deleted', v_tasks, 'projects_archived', v_projects, 'templates_retired', v_templates);
end $$;

-- Grants ------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'public.tk_import_asana_stage(timestamptz, jsonb, jsonb)',
    'public.tk_import_asana_apply(uuid, text, text)',
    'public.tk_import_asana_undo(uuid, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  execute 'revoke all on function public.tk__import_caller() from public, anon, authenticated';
end $$;

-- 5. Version --------------------------------------------------------------------
create or replace function public.tk_schema_version()
returns integer
language sql
stable
set search_path = public
as $$ select 9 $$;
