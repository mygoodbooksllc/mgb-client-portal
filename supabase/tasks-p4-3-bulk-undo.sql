-- =====================================================================
-- Tasks Phase 4, slice P4-3: undo log + bulk actions
-- (Phase 4 spec 2.3; critique B2, M2, M3).
--
-- Re-runnable. Apply it whole. What it does:
--   1. tk_undo_ops: one row per action a person can undo for 10 minutes
--      (the tasks it touched, their values before, the roll-forward rows it
--      made and the emails it queued). RLS on, no policies, no grants: only
--      the functions below read or write it. Each bulk call first deletes
--      the caller's own rows older than 1 day (log rows, not user data).
--   2. tk_bulk_complete / tk_bulk_reopen / tk_bulk_delete / tk_bulk_update
--      (assignee, project, due date or a due shift). Up to 100 tasks; each
--      task runs in its own exception block, so one bad row never stops the
--      rest; every skipped task comes back with a reason code. Complete
--      never approves anyone's work: ready_for_review and waiting_client
--      rows are skipped, review-required rows go to review (critique B2).
--      Single-row actions (a tick, a delete, a reassign) call the same
--      functions with one id, so they can be undone too.
--   3. tk_undo(op): the same person, within 10 minutes, once. A task that
--      changed since is skipped ("changed_since"). Undoing a complete
--      reopens the task and soft-deletes the roll-forward copy only when
--      nobody touched it. Queued emails not sent yet are marked
--      skipped/undone; ones already sent are named back to the caller.
--      Review fixes (applied as migration tasks_p4_3_review_fixes, which
--      re-created tk__bulk_entry and tk_undo only): undoing a reassign drops
--      the follower row the reassign added; undoing a first due date set by
--      a non-admin puts due_date_original back; review-ready emails count as
--      already sent.
--   4. notify_enqueue_task_assigned (from the LIVE body) also stays quiet
--      under mgb.tk_bulk (the bulk call queues its own, with the extra
--      test/internal-client rule), mgb.tk_rollforward (a roll-forward copy
--      is not a new assignment; critique M2) and mgb.tk_undo.
--   5. tk_schema_version 12.
-- Reason codes (mapped to plain words in TK_viewLogic.js TK_bulkReasonText):
--   no_access, deleted, in_trash, in_review, waiting_client, already_done,
--   not_done, approved_admin_only, owner_only, assignee_no_access,
--   project_client, project_archived, project_trashed, no_due_date,
--   no_change, has_open_requests, bad_transition, changed_since, error.
-- =====================================================================

-- 1. The undo log ---------------------------------------------------------
create table if not exists public.tk_undo_ops (
  id uuid primary key default gen_random_uuid(),
  actor_email text not null,
  kind text not null check (kind in ('complete','reopen','delete','reassign','move_project','set_due')),
  task_ids uuid[] not null,
  before jsonb not null,
  spawned_ids uuid[] not null default '{}',
  outbox_ids bigint[] not null default '{}',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '10 minutes',
  undone_at timestamptz
);
create index if not exists tk_undo_ops_actor_idx on public.tk_undo_ops (actor_email, created_at);
alter table public.tk_undo_ops enable row level security;
revoke all on table public.tk_undo_ops from public, anon, authenticated;

-- 2. Internal helpers (not callable by the app) ---------------------------

-- Checks the caller, caps and de-duplicates the ids (order kept), cleans the
-- caller's old log rows.
create or replace function public.tk__bulk_begin(p_ids uuid[])
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_ids uuid[];
begin
  if v_me = '' or not public.is_active_staff() then
    raise exception 'tk_forbidden' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_ids), 0) > 100 then
    raise exception 'tk_too_many' using errcode = '22023';
  end if;
  select coalesce(array_agg(s.x order by s.o), '{}'::uuid[]) into v_ids
    from (select u.x, min(u.o) as o
            from unnest(coalesce(p_ids, '{}'::uuid[])) with ordinality as u(x, o)
           where u.x is not null
           group by u.x) s;
  delete from public.tk_undo_ops where actor_email = v_me and created_at < now() - interval '1 day';
  return v_ids;
end $$;

-- Can the caller act on this task? null = yes, else a reason code.
create or replace function public.tk__bulk_access(p_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r record;
begin
  select x.id, x.deleted_at, x.trashed_with_project into r from public.staff_reminders x where x.id = p_id;
  if not found or not public.tk_can_edit_task(p_id) or not public.tk_can_read_task(p_id) then
    return 'no_access';
  end if;
  if r.trashed_with_project is not null then return 'in_trash'; end if;
  if r.deleted_at is not null then return 'deleted'; end if;
  return null;
end $$;

-- An error message from the triggers -> a reason code.
create or replace function public.tk__bulk_reason(p_err text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_err like '%tk_in_review%' or p_err like '%tk_needs_approval%' then 'in_review'
    when p_err like '%tk_has_open_requests%' then 'has_open_requests'
    when p_err like '%tk_task_in_trash%' then 'in_trash'
    when p_err like '%tk_project_trashed%' then 'project_trashed'
    when p_err like '%tk_project_archived%' then 'project_archived'
    when p_err like '%tk_owner_only%' then 'owner_only'
    when p_err like '%tk_project_client%' then 'project_client'
    when p_err like '%tk_bad_transition%' then 'bad_transition'
    when p_err like '%tk_forbidden%' or p_err like '%tk_not_project_member%'
      or p_err like '%item not found%' or p_err like '%tk_project_missing%' then 'no_access'
    else 'error' end
$$;

-- One undo entry: the values before, plus what the row looked like after.
create or replace function public.tk__bulk_entry(b public.staff_reminders, a public.staff_reminders, p_spawned uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'id', b.id, 'status', b.status, 'assignee_email', b.assignee_email, 'project_id', b.project_id,
    'due_date', b.due_date, 'due_at', b.due_at, 'due_date_original', b.due_date_original,
    'recurrence', b.recurrence, 'deleted_at', b.deleted_at, 'completed_at', b.completed_at,
    'approved_by', b.approved_by, 'approved_at', b.approved_at,
    'updated_at_after', a.updated_at, 'spawned', p_spawned,
    'after', jsonb_build_object('status', a.status, 'assignee_email', a.assignee_email,
                                'project_id', a.project_id, 'due_date', a.due_date, 'deleted_at', a.deleted_at,
                                'due_date_original', a.due_date_original))
$$;

-- Writes the log row (or nothing when no task changed) and returns its id.
-- The op's emails are the assignment and review-ready rows queued during
-- this call for these tasks (ids above the floor read at the start).
create or replace function public.tk__bulk_record(p_kind text, p_entries jsonb, p_floor bigint)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
  v_spawned uuid[];
  v_out bigint[];
  v_id uuid;
begin
  if p_entries is null or jsonb_array_length(p_entries) = 0 then
    return null;
  end if;
  select array_agg((e ->> 'id')::uuid),
         coalesce(array_agg((e ->> 'spawned')::uuid) filter (where e ->> 'spawned' is not null), '{}'::uuid[])
    into v_ids, v_spawned
    from jsonb_array_elements(p_entries) e;
  select coalesce(array_agg(o.id order by o.id), '{}'::bigint[]) into v_out
    from public.notification_outbox o
   where o.id > p_floor
     and o.kind in ('staff_task_assigned', 'staff_task_review_ready')
     and o.ref_id = any (select x::text from unnest(v_ids) x);
  insert into public.tk_undo_ops (actor_email, kind, task_ids, before, spawned_ids, outbox_ids)
  values (lower(coalesce(auth.jwt() ->> 'email', '')), p_kind, v_ids, p_entries, v_spawned, v_out)
  returning id into v_id;
  return v_id;
end $$;

revoke all on function public.tk__bulk_begin(uuid[]) from public, anon, authenticated;
revoke all on function public.tk__bulk_access(uuid) from public, anon, authenticated;
revoke all on function public.tk__bulk_reason(text) from public, anon, authenticated;
revoke all on function public.tk__bulk_entry(public.staff_reminders, public.staff_reminders, uuid) from public, anon, authenticated;
revoke all on function public.tk__bulk_record(text, jsonb, bigint) from public, anon, authenticated;

-- 3. Bulk complete ----------------------------------------------------------
create or replace function public.tk_bulk_complete(p_ids uuid[], p_today date default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
  v_id uuid;
  r public.staff_reminders%rowtype;
  a public.staff_reminders%rowtype;
  v_reason text;
  v_spawn uuid;
  v_floor bigint;
  v_done jsonb := '[]'::jsonb;
  v_review jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_spawned jsonb := '[]'::jsonb;
  v_entries jsonb := '[]'::jsonb;
begin
  v_ids := public.tk__bulk_begin(p_ids);
  select coalesce(max(o.id), 0) into v_floor from public.notification_outbox o;
  foreach v_id in array v_ids loop
    v_reason := public.tk__bulk_access(v_id);
    if v_reason is null then
      select * into r from public.staff_reminders x where x.id = v_id;
      v_reason := case r.status
        when 'done' then 'already_done'
        when 'ready_for_review' then 'in_review'            -- never approve someone's work here
        when 'waiting_client' then 'waiting_client'
        else null end;
    end if;
    if v_reason is null then
      begin
        v_spawn := public.complete_staff_item(v_id, true, p_today);   -- review-required rows divert to review
        select * into a from public.staff_reminders x where x.id = v_id;
        if a.status not in ('done', 'ready_for_review') then
          raise exception 'tk_bad_transition';
        end if;
        v_entries := v_entries || jsonb_build_array(public.tk__bulk_entry(r, a, v_spawn));
        if a.status = 'done' then
          v_done := v_done || to_jsonb(v_id::text);
        else
          v_review := v_review || to_jsonb(v_id::text);
        end if;
        if v_spawn is not null then
          v_spawned := v_spawned || to_jsonb(v_spawn::text);
        end if;
      exception when others then
        v_reason := public.tk__bulk_reason(sqlerrm);
      end;
    end if;
    if v_reason is not null then
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('id', v_id, 'reason', v_reason));
    end if;
  end loop;
  return jsonb_build_object('op_id', public.tk__bulk_record('complete', v_entries, v_floor),
                            'done', v_done, 'review', v_review, 'skipped', v_skipped, 'spawned', v_spawned);
end $$;

-- 4. Bulk reopen (done -> to do) --------------------------------------------
create or replace function public.tk_bulk_reopen(p_ids uuid[], p_today date default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
  v_id uuid;
  r public.staff_reminders%rowtype;
  a public.staff_reminders%rowtype;
  v_reason text;
  v_admin boolean := public.is_active_staff_admin();
  v_floor bigint;
  v_done jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_entries jsonb := '[]'::jsonb;
begin
  v_ids := public.tk__bulk_begin(p_ids);
  select coalesce(max(o.id), 0) into v_floor from public.notification_outbox o;
  foreach v_id in array v_ids loop
    v_reason := public.tk__bulk_access(v_id);
    if v_reason is null then
      select * into r from public.staff_reminders x where x.id = v_id;
      if r.status <> 'done' then
        v_reason := 'not_done';
      elsif r.approved_at is not null and not v_admin then
        v_reason := 'approved_admin_only';
      end if;
    end if;
    if v_reason is null then
      begin
        perform public.complete_staff_item(v_id, false, p_today);
        select * into a from public.staff_reminders x where x.id = v_id;
        if a.status = 'done' then
          raise exception 'tk_bad_transition';
        end if;
        v_entries := v_entries || jsonb_build_array(public.tk__bulk_entry(r, a, null));
        v_done := v_done || to_jsonb(v_id::text);
      exception when others then
        v_reason := public.tk__bulk_reason(sqlerrm);
      end;
    end if;
    if v_reason is not null then
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('id', v_id, 'reason', v_reason));
    end if;
  end loop;
  return jsonb_build_object('op_id', public.tk__bulk_record('reopen', v_entries, v_floor),
                            'done', v_done, 'skipped', v_skipped);
end $$;

-- 5. Bulk delete (soft) -------------------------------------------------------
create or replace function public.tk_bulk_delete(p_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
  v_id uuid;
  r public.staff_reminders%rowtype;
  a public.staff_reminders%rowtype;
  v_reason text;
  v_floor bigint;
  v_done jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_entries jsonb := '[]'::jsonb;
begin
  v_ids := public.tk__bulk_begin(p_ids);
  select coalesce(max(o.id), 0) into v_floor from public.notification_outbox o;
  foreach v_id in array v_ids loop
    v_reason := public.tk__bulk_access(v_id);
    if v_reason is null then
      begin
        select * into r from public.staff_reminders x where x.id = v_id;
        update public.staff_reminders set deleted_at = now() where id = v_id;   -- soft delete; subtasks stay
        select * into a from public.staff_reminders x where x.id = v_id;
        if a.deleted_at is null then
          raise exception 'tk_forbidden';
        end if;
        v_entries := v_entries || jsonb_build_array(public.tk__bulk_entry(r, a, null));
        v_done := v_done || to_jsonb(v_id::text);
      exception when others then
        v_reason := public.tk__bulk_reason(sqlerrm);
      end;
    end if;
    if v_reason is not null then
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('id', v_id, 'reason', v_reason));
    end if;
  end loop;
  return jsonb_build_object('op_id', public.tk__bulk_record('delete', v_entries, v_floor),
                            'done', v_done, 'skipped', v_skipped);
end $$;

-- 6. Bulk update: reassign, move to a project, due date ----------------------
-- p_patch holds exactly one of: {"assignee_email": "..."},
-- {"project_id": "<uuid>" | null}, {"due_date": "YYYY-MM-DD" | null},
-- {"due_shift_days": n} (n between -365 and 365, not 0).
create or replace function public.tk_bulk_update(p_ids uuid[], p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_admin boolean := public.is_active_staff_admin();
  v_ids uuid[];
  v_id uuid;
  r public.staff_reminders%rowtype;
  a public.staff_reminders%rowtype;
  v_reason text;
  v_floor bigint;
  v_kind text;
  v_groups int;
  v_to text;
  v_by_name text;
  v_proj uuid;
  v_p_client text;
  v_p record;
  v_due date;
  v_shift int;
  v_new_due date;
  v_done jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_entries jsonb := '[]'::jsonb;
begin
  -- the patch: known keys only, exactly one action
  if p_patch is null or jsonb_typeof(p_patch) <> 'object'
     or exists (select 1 from jsonb_object_keys(p_patch) k
                 where k not in ('assignee_email', 'project_id', 'due_date', 'due_shift_days')) then
    raise exception 'tk_bad_patch' using errcode = '22023';
  end if;
  v_groups := (p_patch ? 'assignee_email')::int + (p_patch ? 'project_id')::int
            + ((p_patch ? 'due_date') or (p_patch ? 'due_shift_days'))::int;
  if v_groups <> 1 or ((p_patch ? 'due_date') and (p_patch ? 'due_shift_days')) then
    raise exception 'tk_bad_patch' using errcode = '22023';
  end if;
  v_ids := public.tk__bulk_begin(p_ids);

  if p_patch ? 'assignee_email' then
    v_kind := 'reassign';
    select lower(s.email) into v_to from public.staff s
     where s.active and lower(s.email) = lower(btrim(coalesce(p_patch ->> 'assignee_email', '')));
    if v_to is null then
      raise exception 'tk_bad_assignee' using errcode = '22023';   -- must be active staff
    end if;
    select s.name into v_by_name from public.staff s where lower(s.email) = v_me and s.active;
  elsif p_patch ? 'project_id' then
    v_kind := 'move_project';
    begin
      v_proj := nullif(p_patch ->> 'project_id', '')::uuid;
    exception when others then
      raise exception 'tk_bad_patch' using errcode = '22023';
    end;
    if v_proj is not null then
      select p.id, p.client_id, p.archived_at, p.trashed_at into v_p from public.tk_projects p where p.id = v_proj;
      if not found or not public.tk_can_see_project(v_proj) then
        raise exception 'tk_project_missing' using errcode = '42501';
      end if;
      if v_p.trashed_at is not null then
        raise exception 'tk_project_trashed' using errcode = '22023';
      end if;
      if v_p.archived_at is not null then
        raise exception 'tk_project_archived' using errcode = '22023';
      end if;
      v_p_client := v_p.client_id;
    end if;
  else
    v_kind := 'set_due';
    begin
      if p_patch ? 'due_shift_days' then
        v_shift := (p_patch ->> 'due_shift_days')::int;
      else
        v_due := nullif(p_patch ->> 'due_date', '')::date;
      end if;
    exception when others then
      raise exception 'tk_bad_patch' using errcode = '22023';
    end;
    if p_patch ? 'due_shift_days' and (v_shift is null or v_shift = 0 or v_shift not between -365 and 365) then
      raise exception 'tk_bad_patch' using errcode = '22023';
    end if;
  end if;

  select coalesce(max(o.id), 0) into v_floor from public.notification_outbox o;
  foreach v_id in array v_ids loop
    v_reason := public.tk__bulk_access(v_id);
    if v_reason is null then
      select * into r from public.staff_reminders x where x.id = v_id;
      if v_kind = 'reassign' then
        if r.status = 'ready_for_review' then v_reason := 'in_review';
        elsif lower(coalesce(r.assignee_email, '')) = v_to then v_reason := 'no_change';
        elsif lower(r.staff_email) <> v_me and not v_admin then v_reason := 'owner_only';
        elsif r.client_id is not null and not public.tk_staff_has_client(v_to, r.client_id) then v_reason := 'assignee_no_access';
        end if;
      elsif v_kind = 'move_project' then
        if r.project_id is not distinct from v_proj then v_reason := 'no_change';
        elsif lower(r.staff_email) <> v_me and not v_admin then v_reason := 'owner_only';
        elsif v_p_client is not null and v_p_client is distinct from r.client_id then
          v_reason := 'project_client';   -- bulk never changes a task's client
        end if;
      else
        v_new_due := case when v_shift is not null then r.due_date + v_shift else v_due end;
        if v_shift is not null and r.due_date is null then v_reason := 'no_due_date';
        elsif r.due_date is not distinct from v_new_due then v_reason := 'no_change';
        end if;
      end if;
    end if;
    if v_reason is null then
      begin
        if v_kind = 'reassign' then
          perform set_config('mgb.tk_bulk', 'on', true);   -- the trigger stays quiet; this call queues the email below
          update public.staff_reminders set assignee_email = v_to where id = v_id;
          perform set_config('mgb.tk_bulk', '', true);
          select * into a from public.staff_reminders x where x.id = v_id;
          if a.assignee_email is distinct from v_to then
            raise exception 'tk_owner_only';
          end if;
          -- the same guards as notify_enqueue_task_assigned, plus no test or internal clients
          if not a.done and v_to <> v_me and v_by_name is not null
             and coalesce(a.source, 'manual') <> 'access_request'
             and (a.client_id is null
                  or (public.tk_staff_has_client(v_to, a.client_id)
                      and not exists (select 1 from public.clients c
                                       where c.id = a.client_id and (coalesce(c.test_only, false) or coalesce(c.is_internal, false))))) then
            perform public.tk__enqueue('staff_task_assigned', v_to, a.client_id, a.id::text,
              jsonb_build_object('text', left(a.text, 200), 'due_date', a.due_date, 'by', v_by_name));
          end if;
        elsif v_kind = 'move_project' then
          update public.staff_reminders set project_id = v_proj where id = v_id;
          select * into a from public.staff_reminders x where x.id = v_id;
          if a.project_id is distinct from v_proj then
            raise exception 'tk_owner_only';
          end if;
          if a.client_id is distinct from r.client_id then
            raise exception 'tk_project_client';
          end if;
        else
          update public.staff_reminders
             set due_date = v_new_due,
                 due_at = case when v_shift is not null and r.due_at is not null
                               then r.due_at + make_interval(days => v_shift) else due_at end   -- a shift keeps the time
           where id = v_id;
          select * into a from public.staff_reminders x where x.id = v_id;
          if a.due_date is distinct from v_new_due then
            raise exception 'tk_forbidden';
          end if;
        end if;
        v_entries := v_entries || jsonb_build_array(public.tk__bulk_entry(r, a, null));
        v_done := v_done || to_jsonb(v_id::text);
      exception when others then
        v_reason := public.tk__bulk_reason(sqlerrm);
      end;
    end if;
    if v_reason is not null then
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('id', v_id, 'reason', v_reason));
    end if;
  end loop;
  return jsonb_build_object('op_id', public.tk__bulk_record(v_kind, v_entries, v_floor),
                            'kind', v_kind, 'done', v_done, 'skipped', v_skipped);
end $$;

-- 7. Undo -------------------------------------------------------------------
create or replace function public.tk_undo(p_op uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  o public.tk_undo_ops%rowtype;
  e jsonb;
  v_id uuid;
  r public.staff_reminders%rowtype;
  s public.staff_reminders%rowtype;
  v_reason text;
  v_sp uuid;
  v_keep_series boolean;
  v_orig_back boolean;
  v_admin boolean := public.is_active_staff_admin();
  v_done jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_kept jsonb := '[]'::jsonb;
  v_removed int := 0;
  v_cancelled int := 0;
  v_emailed jsonb;
begin
  if v_me = '' or not public.is_active_staff() then
    raise exception 'tk_forbidden' using errcode = '42501';
  end if;
  select * into o from public.tk_undo_ops x where x.id = p_op for update;
  if not found or o.actor_email <> v_me then
    raise exception 'tk_not_found' using errcode = '42501';   -- someone else's op looks missing
  end if;
  if o.undone_at is not null then
    raise exception 'tk_undo_used' using errcode = '22023';
  end if;
  if now() > o.expires_at then
    raise exception 'tk_undo_expired' using errcode = '22023';
  end if;
  update public.tk_undo_ops set undone_at = now() where id = p_op;

  perform set_config('mgb.tk_undo', 'on', true);   -- no assignment email for putting a task back
  for e in select * from jsonb_array_elements(o.before) loop
    v_id := (e ->> 'id')::uuid;
    v_reason := null;
    begin
      select * into r from public.staff_reminders x where x.id = v_id for update;
      if not found or not public.tk_can_edit_task(v_id) or not public.tk_can_read_task(v_id) then
        v_reason := 'no_access';
      elsif r.updated_at is distinct from (e ->> 'updated_at_after')::timestamptz
         or r.status is distinct from (e -> 'after' ->> 'status')
         or r.assignee_email is distinct from (e -> 'after' ->> 'assignee_email')
         or r.project_id is distinct from (e -> 'after' ->> 'project_id')::uuid
         or r.due_date is distinct from (e -> 'after' ->> 'due_date')::date
         or (r.deleted_at is null) <> (e -> 'after' ->> 'deleted_at' is null) then
        v_reason := 'changed_since';
      elsif o.kind = 'complete' then
        v_keep_series := false;
        v_sp := (e ->> 'spawned')::uuid;
        if v_sp is not null then
          select * into s from public.staff_reminders x where x.id = v_sp and x.deleted_at is null;
          if found then
            if s.updated_at = s.created_at
               and not exists (select 1 from public.tk_comments c where c.task_id = v_sp and c.deleted_at is null)
               and not exists (select 1 from public.staff_reminders k where k.parent_id = v_sp and k.deleted_at is null)
               and not exists (select 1 from public.task_checklist_items c
                                where c.reminder_id = v_sp
                                  and (c.done or c.created_at <> s.created_at or c.updated_at <> c.created_at)) then
              update public.staff_reminders set deleted_at = now() where id = v_sp;
              v_removed := v_removed + 1;
            else
              v_kept := v_kept || to_jsonb(v_sp::text);
              v_keep_series := true;   -- the series goes on in the kept copy
            end if;
          end if;
        end if;
        update public.staff_reminders
           set status = e ->> 'status',
               recurrence = case when v_keep_series then recurrence else coalesce(e ->> 'recurrence', recurrence) end
         where id = v_id;   -- done -> back; ready_for_review -> back (a withdraw)
      elsif o.kind = 'reopen' then
        -- put it back exactly as it was (done, with its finish time and any
        -- approval); a plain status write would go back through review
        perform set_config('mgb.tk_migrate', 'on', true);
        update public.staff_reminders
           set status = 'done',
               completed_at = (e ->> 'completed_at')::timestamptz,
               approved_by = e ->> 'approved_by',
               approved_at = (e ->> 'approved_at')::timestamptz
         where id = v_id;
        perform set_config('mgb.tk_migrate', '', true);
        insert into public.tk_activity (task_id, actor_email, kind, from_value, to_value, meta)
        values (v_id, v_me, 'status', r.status, 'done', jsonb_build_object('undo', true));
      elsif o.kind = 'delete' then
        update public.staff_reminders set deleted_at = null where id = v_id;
      elsif o.kind = 'reassign' then
        update public.staff_reminders set assignee_email = e ->> 'assignee_email' where id = v_id;
        -- the autofollow trigger made the new assignee a follower; take that
        -- back (it would still let them read the task and get its notices),
        -- unless they were already following, own the task or had it before
        delete from public.tk_followers f
         where f.task_id = v_id
           and lower(f.staff_email) = lower(e -> 'after' ->> 'assignee_email')
           and f.added_at >= o.created_at
           and lower(f.staff_email) <> lower(coalesce(r.staff_email, ''))
           and lower(f.staff_email) <> lower(coalesce(e ->> 'assignee_email', ''));
      elsif o.kind = 'move_project' then
        update public.staff_reminders set project_id = (e ->> 'project_id')::uuid where id = v_id;
      elsif o.kind = 'set_due' then
        -- due_date_original: an admin gets the old value back; for anyone
        -- else it goes back only when this op set it (it was empty before
        -- and still holds what the op wrote). The trigger owns the column,
        -- so that one write runs with mgb.tk_migrate.
        v_orig_back := v_admin
          or (e ->> 'due_date_original' is null
              and r.due_date_original is not distinct from
                  coalesce((e -> 'after' ->> 'due_date_original')::date, (e -> 'after' ->> 'due_date')::date));
        if v_orig_back and not v_admin then
          perform set_config('mgb.tk_migrate', 'on', true);
        end if;
        update public.staff_reminders
           set due_date = (e ->> 'due_date')::date,
               due_at = (e ->> 'due_at')::timestamptz,
               due_date_original = case when v_orig_back then (e ->> 'due_date_original')::date else due_date_original end
         where id = v_id;
        perform set_config('mgb.tk_migrate', '', true);
      end if;
    exception when others then
      v_reason := public.tk__bulk_reason(sqlerrm);
    end;
    if v_reason is null then
      v_done := v_done || to_jsonb(v_id::text);
    else
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('id', v_id, 'reason', v_reason));
    end if;
  end loop;
  perform set_config('mgb.tk_undo', '', true);

  -- emails not sent yet are dropped; sent ones stay sent and are named back
  with x as (
    update public.notification_outbox n
       set status = 'skipped', reason = 'undone', processed_at = now()
     where n.id = any (o.outbox_ids) and n.status is null and n.processed_at is null
    returning 1)
  select count(*) into v_cancelled from x;
  select coalesce(jsonb_agg(distinct coalesce(st.name, n.recipient_email)), '[]'::jsonb) into v_emailed
    from public.notification_outbox n
    left join public.staff st on lower(st.email) = n.recipient_email
   where n.id = any (o.outbox_ids) and n.status = 'sent'
     and n.kind in ('staff_task_assigned', 'staff_task_review_ready');

  return jsonb_build_object('op_id', o.id, 'kind', o.kind, 'done', v_done, 'skipped', v_skipped,
                            'spawned_removed', v_removed, 'spawned_kept', v_kept,
                            'emails_cancelled', v_cancelled, 'already_emailed', v_emailed);
end $$;

revoke all on function public.tk_bulk_complete(uuid[], date) from public, anon;
grant execute on function public.tk_bulk_complete(uuid[], date) to authenticated;
revoke all on function public.tk_bulk_reopen(uuid[], date) from public, anon;
grant execute on function public.tk_bulk_reopen(uuid[], date) to authenticated;
revoke all on function public.tk_bulk_delete(uuid[]) from public, anon;
grant execute on function public.tk_bulk_delete(uuid[]) to authenticated;
revoke all on function public.tk_bulk_update(uuid[], jsonb) from public, anon;
grant execute on function public.tk_bulk_update(uuid[], jsonb) to authenticated;
revoke all on function public.tk_undo(uuid) from public, anon;
grant execute on function public.tk_undo(uuid) to authenticated;

-- 8. Assignment email trigger (LIVE body + the P4-3 flags) --------------------
create or replace function public.notify_enqueue_task_assigned()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_by text := lower(coalesce(nullif(auth.jwt() ->> 'email', ''), new.created_by, ''));
  v_by_name text;
begin
  if new.deleted_at is not null then return null; end if;   -- tk v1
  if new.done or new.assignee_email is null then
    return null;
  end if;
  if tg_op = 'UPDATE' and lower(new.assignee_email) is not distinct from lower(old.assignee_email) then
    return null;
  end if;
  if coalesce(current_setting('mgb.tk_generate', true), '') = 'on'   -- tk p2 s4: no email per generated task
     or coalesce(current_setting('mgb.tk_ooo', true), '') in ('on', 'quiet')   -- tk p2 s7: one OOO summary instead
     or coalesce(current_setting('mgb.tk_import', true), '') = 'on'   -- tk p2 s8: Asana import sends nothing
     or coalesce(current_setting('mgb.tk_bulk', true), '') = 'on'   -- tk p4-3: the bulk call queues its own
     or coalesce(current_setting('mgb.tk_rollforward', true), '') = 'on'   -- tk p4-3 (critique M2): next copy is not a new assignment
     or coalesce(current_setting('mgb.tk_undo', true), '') = 'on' then   -- tk p4-3: putting a task back sends nothing
    return null;
  end if;
  if coalesce(new.source, 'manual') = 'access_request'
     or (tg_op = 'INSERT' and new.source = 'asana') then   -- tk p2 s8
    return null;
  end if;
  if v_by = '' or v_by = lower(new.assignee_email) then
    return null;
  end if;
  select name into v_by_name from staff where lower(email) = v_by and active;
  if v_by_name is null then
    return null;
  end if;
  -- fix 1: no email about a client task to someone who cannot open that client (D3)
  if new.client_id is not null and not public.tk_staff_has_client(new.assignee_email, new.client_id) then
    return null;
  end if;
  insert into notification_outbox (kind, recipient_email, client_id, ref_id, payload)
  values ('staff_task_assigned', lower(new.assignee_email), new.client_id, new.id::text,
          jsonb_build_object('text', left(new.text, 200), 'due_date', new.due_date, 'by', v_by_name));
  return null;
end;
$function$;

-- 9. schema version ----------------------------------------------------------
create or replace function public.tk_schema_version()
returns integer
language sql
stable
set search_path = public
as $$ select 12 $$;
