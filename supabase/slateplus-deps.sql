-- Applied to production 2026-10-27, re-applied the same day with the review fixes (resume is
-- not a start, open-only full list, final-row ready trigger + lock, admin-only template unlink,
-- masked overridden_by). Self-tests pass live, rolled back; no advisor errors.
-- Second review pass, applied 2026-10-27: guard resume rule uses status_before_wait (no
-- todo -> waiting -> in progress hole); guard skips cascades (pg_trigger_depth() > 1, rhythm,
-- generator and close-sync flags); cycle walk recurses on id only (UNION, no depth cap); Ready
-- notice also fires when an open blocker is trashed and is re-sent (new id) after a re-block;
-- tk_dep_list masks the unreadable side's id and flags (new is_open column, so the function is
-- dropped and recreated); deps / events read policies need read rights on both sides;
-- tk_dep_my_notices masks an unreadable blocker id. tk_close_tick (tasks-p4-2-close-checklist.sql)
-- maps tk_blocked to plain words.
-- Slate plus: task dependencies ("Blocked by"). Spec: docs/slateplus-dependencies-spec.md
-- Additive only: three new tables, one nullable template column, new RPCs and three
-- triggers on staff_reminders that return at the first EXISTS probe while no
-- dependency rows exist (none exist today). One existing function is widened:
-- tk__bulk_reason gains a 'blocked' case (every old input maps exactly as before).
-- Re-runnable. Never deletes data.

-- 1. Tables ------------------------------------------------------------------
create table if not exists public.tk_task_deps (
  task_id uuid not null references public.staff_reminders(id) on delete cascade,
  blocker_id uuid not null references public.staff_reminders(id) on delete cascade,
  source text not null default 'manual' check (source in ('manual', 'template')),
  created_by text,
  created_at timestamptz not null default now(),
  overridden_at timestamptz,
  overridden_by text,
  primary key (task_id, blocker_id),
  check (task_id <> blocker_id)
);
create index if not exists tk_task_deps_blocker_idx on public.tk_task_deps (blocker_id);
alter table public.tk_task_deps enable row level security;
drop policy if exists "tk deps staff read" on public.tk_task_deps;
create policy "tk deps staff read" on public.tk_task_deps
  for select to authenticated
  using (public.is_active_staff() and public.tk_can_read_task(task_id) and public.tk_can_read_task(blocker_id));
revoke all on public.tk_task_deps from anon, authenticated;
grant select on public.tk_task_deps to authenticated;

create table if not exists public.tk_dep_events (
  id bigint generated always as identity primary key,
  task_id uuid not null references public.staff_reminders(id) on delete cascade,
  blocker_id uuid references public.staff_reminders(id) on delete set null,
  actor_email text,
  kind text not null check (kind in ('add', 'remove', 'override', 'template_link')),
  reason text check (reason is null or char_length(reason) <= 500),
  created_at timestamptz not null default now()
);
create index if not exists tk_dep_events_task_idx on public.tk_dep_events (task_id, created_at desc);
alter table public.tk_dep_events enable row level security;
drop policy if exists "tk dep events admin read" on public.tk_dep_events;
create policy "tk dep events admin read" on public.tk_dep_events
  for select to authenticated
  using (public.is_active_staff_admin() and public.tk_can_read_task(task_id)
         and (blocker_id is null or public.tk_can_read_task(blocker_id)));
revoke all on public.tk_dep_events from anon, authenticated;
grant select on public.tk_dep_events to authenticated;

create table if not exists public.tk_dep_notices (
  id uuid primary key default gen_random_uuid(),
  recipient_email text not null check (recipient_email = lower(recipient_email)),
  task_id uuid not null references public.staff_reminders(id) on delete cascade,
  blocker_id uuid references public.staff_reminders(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (task_id, recipient_email)
);
create index if not exists tk_dep_notices_recipient_idx on public.tk_dep_notices (recipient_email, created_at desc);
alter table public.tk_dep_notices enable row level security;
drop policy if exists "tk dep notices own read" on public.tk_dep_notices;
create policy "tk dep notices own read" on public.tk_dep_notices
  for select to authenticated
  using (public.is_active_staff() and recipient_email = lower(coalesce(auth.jwt() ->> 'email', '')));
revoke all on public.tk_dep_notices from anon, authenticated;
grant select on public.tk_dep_notices to authenticated;

-- Close order step on a recurring template (null = not chained, the default for all).
alter table public.task_templates add column if not exists dep_step smallint;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'task_templates_dep_step_range') then
    alter table public.task_templates add constraint task_templates_dep_step_range
      check (dep_step is null or (dep_step between 1 and 99));
  end if;
end $$;

-- 2. Internal helpers ------------------------------------------------------------
create or replace function public.tk__dep_open_count(p_task uuid)
returns integer language sql stable security definer set search_path to 'public' as $$
  select count(*)::int
    from tk_task_deps d join staff_reminders b on b.id = d.blocker_id
   where d.task_id = p_task and d.overridden_at is null
     and b.done = false and b.deleted_at is null;
$$;

-- true when linking p_task <- p_blocker would close a loop (p_blocker already
-- waits, directly or not, on p_task). Recurses on id only: UNION drops ids
-- already seen, so the walk ends on any graph (no depth cap needed) and each
-- task is visited once (PK index on task_id).
create or replace function public.tk__dep_would_cycle(p_task uuid, p_blocker uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  with recursive up(id) as (
    select p_blocker
    union
    select d.blocker_id from tk_task_deps d join up on d.task_id = up.id
  )
  select p_task = p_blocker or exists (select 1 from up where id = p_task);
$$;

-- Insert one link (no permission checks: callers check). Returns 'linked',
-- 'exists', 'cycle' or 'limit'.
create or replace function public.tk__dep_link(p_task uuid, p_blocker uuid, p_source text, p_by text)
returns text language plpgsql security definer set search_path to 'public' as $$
begin
  perform pg_advisory_xact_lock(hashtext('tk_task_deps'));
  if exists (select 1 from tk_task_deps where task_id = p_task and blocker_id = p_blocker) then
    return 'exists';
  end if;
  if public.tk__dep_would_cycle(p_task, p_blocker) then
    return 'cycle';
  end if;
  if (select count(*) from tk_task_deps where task_id = p_task) >= 20 then
    return 'limit';
  end if;
  insert into tk_task_deps (task_id, blocker_id, source, created_by)
  values (p_task, p_blocker, p_source, nullif(p_by, ''));
  insert into tk_dep_events (task_id, blocker_id, actor_email, kind)
  values (p_task, p_blocker, nullif(p_by, ''), case when p_source = 'template' then 'template_link' else 'add' end);
  return 'linked';
end $$;

-- 3. RPCs ------------------------------------------------------------------
create or replace function public.tk_dep_add(p_task uuid, p_blocker uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_me text := public.tk__me();
  v_r text;
begin
  if v_me = '' or not public.is_active_staff() then
    raise exception 'tk_forbidden' using errcode = '42501';
  end if;
  if p_task is null or p_blocker is null then
    raise exception 'tk_bad_input' using errcode = '22023';
  end if;
  if p_task = p_blocker then
    raise exception 'tk_dep_self: a task cannot wait on itself' using errcode = '22023';
  end if;
  if not public.tk_can_edit_task(p_task) or not public.tk_can_read_task(p_blocker) then
    raise exception 'tk_forbidden' using errcode = '42501';
  end if;
  if exists (select 1 from staff_reminders where id in (p_task, p_blocker) and deleted_at is not null) then
    raise exception 'tk_task_in_trash' using errcode = '22023';
  end if;
  v_r := public.tk__dep_link(p_task, p_blocker, 'manual', v_me);
  if v_r = 'cycle' then
    raise exception 'tk_dep_cycle: that task already waits on this one' using errcode = '22023';
  elsif v_r = 'limit' then
    raise exception 'tk_dep_limit: 20 blockers is the most for one task' using errcode = '22023';
  end if;
  return jsonb_build_object('ok', true, 'status', v_r, 'open', public.tk__dep_open_count(p_task));
end $$;

create or replace function public.tk_dep_remove(p_task uuid, p_blocker uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_me text := public.tk__me();
  v_n int;
begin
  if v_me = '' or not public.is_active_staff() or not public.tk_can_edit_task(p_task) then
    raise exception 'tk_forbidden' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('tk_task_deps'));
  -- Close order links (made from template steps) are removed by admins only;
  -- everyone else asks an admin to override.
  if not public.is_active_staff_admin() and exists (
    select 1 from tk_task_deps where task_id = p_task and blocker_id = p_blocker and source = 'template'
  ) then
    raise exception 'tk_forbidden: only an admin can remove a close order link' using errcode = '42501';
  end if;
  delete from tk_task_deps where task_id = p_task and blocker_id = p_blocker;
  get diagnostics v_n = row_count;
  if v_n > 0 then
    insert into tk_dep_events (task_id, blocker_id, actor_email, kind) values (p_task, p_blocker, v_me, 'remove');
  end if;
  return jsonb_build_object('ok', true, 'removed', v_n, 'open', public.tk__dep_open_count(p_task));
end $$;

create or replace function public.tk_dep_override(p_task uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_me text := public.tk__me();
  v_reason text := btrim(coalesce(p_reason, ''));
  v_ids uuid[];
begin
  if v_me = '' or not public.is_active_staff_admin() or not public.tk_can_read_task(p_task) then
    raise exception 'tk_forbidden' using errcode = '42501';
  end if;
  if char_length(v_reason) < 3 or char_length(v_reason) > 500 then
    raise exception 'tk_dep_reason: give a short reason (3 to 500 characters)' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('tk_task_deps'));
  with o as (
    update tk_task_deps d set overridden_at = now(), overridden_by = v_me
      from staff_reminders b
     where d.task_id = p_task and d.blocker_id = b.id and d.overridden_at is null
       and b.done = false and b.deleted_at is null
    returning d.blocker_id
  )
  select array_agg(blocker_id) into v_ids from o;
  if v_ids is not null then
    insert into tk_dep_events (task_id, blocker_id, actor_email, kind, reason)
    select p_task, x, v_me, 'override', v_reason from unnest(v_ids) x;
  end if;
  return jsonb_build_object('ok', true, 'overridden', coalesce(cardinality(v_ids), 0));
end $$;

-- Every dep the caller can see from at least one side. The side they cannot
-- read comes back fully masked: null id, text, client and flags (never leak a
-- task across books). is_open (blocker unfinished and not overridden) is the
-- only fact given about a hidden blocker, so the readable task still shows as
-- blocked. Return type changed in the second review pass: drop, then create.
drop function if exists public.tk_dep_list(uuid[]);
create function public.tk_dep_list(p_task_ids uuid[] default null)
returns table (
  task_id uuid, blocker_id uuid, source text, created_at timestamptz,
  overridden_at timestamptz, overridden_by text,
  task_text text, task_client_id text, task_done boolean, task_deleted boolean, task_readable boolean,
  blocker_text text, blocker_client_id text, blocker_done boolean, blocker_deleted boolean,
  blocker_status text, blocker_assignee text, blocker_due_date date, blocker_readable boolean,
  is_open boolean
)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not public.is_active_staff() then
    return;
  end if;
  return query
  select case when x.tr then d.task_id end, case when x.br then d.blocker_id end,
         d.source, d.created_at, d.overridden_at, case when x.tr then d.overridden_by end,
         case when x.tr then t.text end, case when x.tr then t.client_id end,
         case when x.tr then t.done end, case when x.tr then t.deleted_at is not null end, x.tr,
         case when x.br then b.text end, case when x.br then b.client_id end,
         case when x.br then b.done end, case when x.br then b.deleted_at is not null end,
         case when x.br then b.status end, case when x.br then b.assignee_email end,
         case when x.br then b.due_date end, x.br,
         (d.overridden_at is null and b.done = false and b.deleted_at is null)
    from tk_task_deps d
    join staff_reminders t on t.id = d.task_id
    join staff_reminders b on b.id = d.blocker_id
    cross join lateral (select public.tk_can_read_task(d.task_id) tr, public.tk_can_read_task(d.blocker_id) br) x
   where (p_task_ids is not null and (d.task_id = any (p_task_ids) or d.blocker_id = any (p_task_ids))
          or p_task_ids is null and t.done = false and t.deleted_at is null)
     and (x.tr or x.br)
   order by d.created_at desc
   limit 2000;
end $$;

create or replace function public.tk_dep_my_notices(p_days integer default 14)
returns table (id uuid, task_id uuid, blocker_id uuid, created_at timestamptz, task_text text, client_id text)
language sql stable security definer set search_path to 'public' as $$
  select n.id, n.task_id,
         case when n.blocker_id is not null and public.tk_can_read_task(n.blocker_id) then n.blocker_id end,
         n.created_at, left(r.text, 200), r.client_id
    from tk_dep_notices n join staff_reminders r on r.id = n.task_id
   where public.is_active_staff()
     and n.recipient_email = public.tk__me()
     and n.created_at > now() - make_interval(days => greatest(1, least(coalesce(p_days, 14), 60)))
     and r.deleted_at is null
     and r.done = false
     and public.tk_can_read_task(n.task_id)
   order by n.created_at desc
   limit 50;
$$;

create or replace function public.tk_set_template_dep_step(p_id uuid, p_step integer)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.is_active_staff_admin() then
    raise exception 'tk_forbidden' using errcode = '42501';
  end if;
  if p_step is not null and (p_step < 1 or p_step > 99) then
    raise exception 'tk_dep_step: step must be 1 to 99' using errcode = '22023';
  end if;
  update task_templates set dep_step = p_step where id = p_id;
  if not found then
    raise exception 'tk_not_found' using errcode = '22023';
  end if;
  return jsonb_build_object('ok', true, 'dep_step', p_step);
end $$;

-- 4. Triggers on staff_reminders -------------------------------------------
-- Guard: no done / start / send-for-review while an open blocker remains.
create or replace function public.tk_staff_reminders_zdeps_guard()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_n int;
begin
  if not ((new.done and not coalesce(old.done, false))
          or (new.status is distinct from old.status and new.status in ('in_progress', 'ready_for_review', 'done'))) then
    return new;
  end if;
  -- Back from review (send back, withdraw) is a resume, not a start. Back from
  -- waiting on the client is a resume only when it was in progress before the
  -- wait (status_before_wait); todo -> waiting -> in progress is a start.
  if new.status = 'in_progress' and not new.done
     and (old.status = 'ready_for_review'
          or (old.status = 'waiting_client' and old.status_before_wait = 'in_progress')) then
    return new;
  end if;
  -- Only direct writes are guarded. A cascade (an update made inside another
  -- trigger, the rhythm run, the generator, close sync / adopt) never aborts
  -- the caller's whole transaction.
  if pg_trigger_depth() > 1
     or coalesce(current_setting('mgb.tk_rhythm', true), '') = 'on'
     or coalesce(current_setting('mgb.tk_generate', true), '') = 'on'
     or coalesce(current_setting('mgb.tk_close', true), '') = 'on' then
    return new;
  end if;
  if not exists (select 1 from tk_task_deps where task_id = new.id) then
    return new;
  end if;
  -- cron, service role, token pages and client users are never stopped
  if public.tk__me() = '' or not public.is_active_staff() then
    return new;
  end if;
  v_n := public.tk__dep_open_count(new.id);
  if v_n > 0 then
    raise exception 'tk_blocked: Blocked by % unfinished task%', v_n, case when v_n = 1 then '' else 's' end
      using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists tk_staff_reminders_zdeps_guard on public.staff_reminders;
create trigger tk_staff_reminders_zdeps_guard
  before update of done, status on public.staff_reminders
  for each row execute function public.tk_staff_reminders_zdeps_guard();

-- Ready notice: one bell row when the last open blocker of a task is done or
-- trashed. A task blocked again and then freed again gets a fresh notice (the
-- row is upserted with a new id, so the bell shows it as unseen).
create or replace function public.tk_staff_reminders_zdeps_ready()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_me text := public.tk__me();
  v_d record;
  v_to text;
begin
  if not ((new.done and not coalesce(old.done, false))
          or (new.deleted_at is not null and old.deleted_at is null and not coalesce(old.done, false))) then
    return null;
  end if;
  if not exists (select 1 from tk_task_deps where blocker_id = new.id) then
    return null;
  end if;
  -- Two last blockers finished at once must not both see the other open.
  perform pg_advisory_xact_lock(hashtext('tk_task_deps'));
  for v_d in
    select r.id, r.assignee_email, r.staff_email, r.is_unassigned, r.client_id
      from tk_task_deps d join staff_reminders r on r.id = d.task_id
     where d.blocker_id = new.id and d.overridden_at is null
       and r.done = false and r.deleted_at is null
  loop
    if public.tk__dep_open_count(v_d.id) > 0 then continue; end if;
    if coalesce(v_d.is_unassigned, false) then continue; end if;
    v_to := lower(btrim(coalesce(v_d.assignee_email, v_d.staff_email, '')));
    if v_to = '' or v_to = v_me then continue; end if;
    if not exists (select 1 from staff s where lower(s.email) = v_to and s.active) then continue; end if;
    if v_d.client_id is not null and not public.tk_staff_has_client(v_to, v_d.client_id) then continue; end if;
    insert into tk_dep_notices (recipient_email, task_id, blocker_id)
    values (v_to, v_d.id, new.id)
    on conflict (task_id, recipient_email) do update
      set id = gen_random_uuid(), blocker_id = excluded.blocker_id, created_at = now();
  end loop;
  return null;
end $$;
drop trigger if exists tk_staff_reminders_zdeps_ready on public.staff_reminders;
create trigger tk_staff_reminders_zdeps_ready
  after update on public.staff_reminders
  for each row when ((new.done and not coalesce(old.done, false))
                     or (new.deleted_at is not null and old.deleted_at is null and not coalesce(old.done, false)))
  execute function public.tk_staff_reminders_zdeps_ready();

-- Template wiring: a task made from a template with a close order step waits on
-- the same client + period's tasks from the previous step in the same set, and
-- the next step's tasks (if already made) wait on it.
create or replace function public.tk_staff_reminders_zdeps_wire()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_t record;
  v_prev int;
  v_next int;
  v_x record;
begin
  select id, template_set_id, dep_step into v_t from task_templates where id = new.template_id;
  if not found or v_t.dep_step is null then
    return null;
  end if;
  if new.deleted_at is not null or new.period_start is null then
    return null;
  end if;
  select max(dep_step) into v_prev from task_templates
   where template_set_id is not distinct from v_t.template_set_id and dep_step < v_t.dep_step;
  select min(dep_step) into v_next from task_templates
   where template_set_id is not distinct from v_t.template_set_id and dep_step > v_t.dep_step;
  if v_prev is not null then
    for v_x in
      select r.id from staff_reminders r join task_templates tt on tt.id = r.template_id
       where tt.template_set_id is not distinct from v_t.template_set_id and tt.dep_step = v_prev
         and r.client_id is not distinct from new.client_id
         and r.period_kind is not distinct from new.period_kind and r.period_start = new.period_start
         and r.deleted_at is null and r.id <> new.id
    loop
      perform public.tk__dep_link(new.id, v_x.id, 'template', null);
    end loop;
  end if;
  if v_next is not null then
    for v_x in
      select r.id from staff_reminders r join task_templates tt on tt.id = r.template_id
       where tt.template_set_id is not distinct from v_t.template_set_id and tt.dep_step = v_next
         and r.client_id is not distinct from new.client_id
         and r.period_kind is not distinct from new.period_kind and r.period_start = new.period_start
         and r.deleted_at is null and r.id <> new.id
    loop
      perform public.tk__dep_link(v_x.id, new.id, 'template', null);
    end loop;
  end if;
  return null;
end $$;
drop trigger if exists tk_staff_reminders_zdeps_wire on public.staff_reminders;
create trigger tk_staff_reminders_zdeps_wire
  after insert on public.staff_reminders
  for each row when (new.template_id is not null)
  execute function public.tk_staff_reminders_zdeps_wire();

-- 5. Bulk skip reason (widened; every earlier input maps as before) ---------
create or replace function public.tk__bulk_reason(p_err text)
 returns text
 language sql
 immutable
 set search_path to 'public'
as $function$
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
    when p_err like '%tk_blocked%' then 'blocked'
    else 'error' end
$function$;

-- 6. Grants ----------------------------------------------------------------
revoke all on function public.tk__dep_open_count(uuid) from public, anon, authenticated;
revoke all on function public.tk__dep_would_cycle(uuid, uuid) from public, anon, authenticated;
revoke all on function public.tk__dep_link(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.tk_staff_reminders_zdeps_guard() from public, anon, authenticated;
revoke all on function public.tk_staff_reminders_zdeps_ready() from public, anon, authenticated;
revoke all on function public.tk_staff_reminders_zdeps_wire() from public, anon, authenticated;
revoke all on function public.tk_dep_add(uuid, uuid) from public, anon;
revoke all on function public.tk_dep_remove(uuid, uuid) from public, anon;
revoke all on function public.tk_dep_override(uuid, text) from public, anon;
revoke all on function public.tk_dep_list(uuid[]) from public, anon;
revoke all on function public.tk_dep_my_notices(integer) from public, anon;
revoke all on function public.tk_set_template_dep_step(uuid, integer) from public, anon;
grant execute on function public.tk_dep_add(uuid, uuid) to authenticated;
grant execute on function public.tk_dep_remove(uuid, uuid) to authenticated;
grant execute on function public.tk_dep_override(uuid, text) to authenticated;
grant execute on function public.tk_dep_list(uuid[]) to authenticated;
grant execute on function public.tk_dep_my_notices(integer) to authenticated;
grant execute on function public.tk_set_template_dep_step(uuid, integer) to authenticated;
