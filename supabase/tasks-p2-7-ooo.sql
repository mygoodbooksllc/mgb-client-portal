-- =====================================================================
-- Tasks Phase 2, S7: out-of-office coverage (hand tasks to backups).
-- Spec: docs/tasks-phase2-spec.md C7 + H (Coverage) + K row S7.
-- Critique fixes applied here: B3 (internal tk__client_people), M1 (only an
-- admin apply grants access; others get a pending grant row), M2 (mgb.tk_ooo
-- is a before_write bypass), m13 (return removes the followers OOO added),
-- m14 (the daily job returns ended windows; changed tasks are left alone).
--
-- Owner decisions: the backup comes from client_profile.backup_bookkeeper_email
-- (no fallback to anyone else); only tasks DUE INSIDE the window move; tasks in
-- Ready for review stay where they are; everything is reversible; admin
-- sign-off is unchanged (reviewer_email is never touched here).
--
-- What this file does (safe to re-run, nothing dropped):
--   1. tk_ooo_reassignments (the ledger: one row per moved task per time off)
--      and tk_ooo_runs (one row per apply/return run, skips included).
--      RLS on both, each starts from "revoke all"; no direct writes.
--   2. Trigger patches: mgb.tk_ooo bypasses the non-owner assignee pin (M2),
--      silences the per-task "assigned to you" email ('on' or 'quiet'),
--      marks followers it adds (added_by = 'ooo') and logs 'reassigned_ooo'.
--   3. tk__ooo_cover (who covers), tk__ooo_apply, tk__ooo_return (internal),
--      tk_apply_ooo / tk_return_ooo / tk_my_coverage (staff RPCs).
--   4. staff_time_off AFTER UPDATE trigger: cancel returns everything; a
--      shorter window returns the tasks now outside it.
--   5. tk_ooo_daily() + cron 'tk-ooo-daily' 11:00 UTC: applies windows that
--      have started (tk_settings.ooo_auto_apply, default on) and returns
--      windows that ended or were cancelled.
--   6. Generator: a task due while its assignee is away goes to the backup.
--      Roll-forward: a covered repeating task rolls to the owner once the
--      next due date is past the time off.
--
-- Email: staff only, existing kind staff_task_batch (one summary per person
-- per run; each person's task_batch setting is honored at send time). No
-- client email. Private tasks (no client, or visibility private) never move
-- and their titles never appear in a preview or a summary.
-- =====================================================================

-- Temporary helper (same as tasks-p2-4-hotfix-trigger-helpers.sql).
create or replace function pg_temp.patch_fn(p_sig text, p_from text, p_to text, p_expected int)
returns void
language plpgsql
as $f$
declare
  d text;
  n int;
begin
  d := pg_get_functiondef(p_sig::regprocedure);
  if position(p_to in d) > 0 then
    return;  -- already patched
  end if;
  n := (length(d) - length(replace(d, p_from, ''))) / length(p_from);
  if n <> p_expected then
    raise exception 'patch_fn %: expected % occurrence(s) of anchor %, found %', p_sig, p_expected, p_from, n;
  end if;
  execute replace(d, p_from, p_to);
end
$f$;

-- 1. Tables -------------------------------------------------------------------
create table if not exists public.tk_ooo_reassignments (
  id uuid primary key default gen_random_uuid(),
  time_off_id uuid not null references public.staff_time_off(id),
  task_id uuid not null references public.staff_reminders(id) on delete cascade,
  client_id text,
  from_email text not null check (from_email = lower(from_email)),
  to_email text not null check (to_email = lower(to_email)),
  reason text not null check (reason in ('backup', 'manual', 'generator', 'rollforward')),
  reassigned_at timestamptz not null default now(),
  reassigned_by text,
  returned_at timestamptz,
  returned_by text,
  return_skipped_reason text check (return_skipped_reason is null
                                    or return_skipped_reason in ('closed', 'changed', 'in_review', 'owner_inactive')),
  unique (time_off_id, task_id)
);
create index if not exists tk_ooo_reassignments_open_task on public.tk_ooo_reassignments (task_id) where returned_at is null;
create index if not exists tk_ooo_reassignments_open_to on public.tk_ooo_reassignments (to_email) where returned_at is null;
create index if not exists tk_ooo_reassignments_open_from on public.tk_ooo_reassignments (from_email) where returned_at is null;

alter table public.tk_ooo_reassignments enable row level security;
revoke all on public.tk_ooo_reassignments from anon, authenticated;
grant select on public.tk_ooo_reassignments to authenticated;
drop policy if exists tk_ooo_reassignments_read on public.tk_ooo_reassignments;
create policy tk_ooo_reassignments_read on public.tk_ooo_reassignments
  for select to authenticated
  using (public.is_active_staff()
         and (public.is_active_staff_admin()
              or lower(coalesce(auth.jwt() ->> 'email', '')) in (from_email, to_email)));

-- One row per run. detail holds ids and reasons only (no task titles).
create table if not exists public.tk_ooo_runs (
  id uuid primary key default gen_random_uuid(),
  time_off_id uuid references public.staff_time_off(id),
  action text not null check (action in ('apply', 'return')),
  mode text not null check (mode in ('manual', 'cron', 'edit', 'cancel')),
  actor text,
  moved int not null default 0,
  skipped int not null default 0,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists tk_ooo_runs_time_off on public.tk_ooo_runs (time_off_id, created_at desc);
alter table public.tk_ooo_runs enable row level security;
revoke all on public.tk_ooo_runs from anon, authenticated;
grant select on public.tk_ooo_runs to authenticated;
drop policy if exists tk_ooo_runs_admin_read on public.tk_ooo_runs;
create policy tk_ooo_runs_admin_read on public.tk_ooo_runs
  for select to authenticated
  using (public.is_active_staff_admin());

-- 2. Trigger patches ----------------------------------------------------------
-- M2: an OOO move is a bypass, so a non-admin owner can hand off a task an
-- admin created for them (staff_email = the admin).
select pg_temp.patch_fn('public.staff_reminders_before_write()',
$a$            or coalesce(current_setting('mgb.tk_generate', true),'') = 'on';   -- tk p2 s4 (critique M2)$a$,
$b$            or coalesce(current_setting('mgb.tk_generate', true),'') = 'on'   -- tk p2 s4 (critique M2)
            or coalesce(current_setting('mgb.tk_ooo', true),'') = 'on';   -- tk p2 s7 (critique M2)$b$, 1);

-- No per-task "assigned to you" email; OOO sends one summary per person.
select pg_temp.patch_fn('public.notify_enqueue_task_assigned()',
$a$  if coalesce(current_setting('mgb.tk_generate', true), '') = 'on' then   -- tk p2 s4: no email per generated task$a$,
$b$  if coalesce(current_setting('mgb.tk_generate', true), '') = 'on'   -- tk p2 s4: no email per generated task
     or coalesce(current_setting('mgb.tk_ooo', true), '') in ('on', 'quiet') then   -- tk p2 s7: one OOO summary instead$b$, 1);

-- m13: followers added by an OOO move are marked so the return can remove them.
select pg_temp.patch_fn('public.tk_staff_reminders_autofollow()',
$a$  select new.id, s.email, nullif(lower(coalesce(auth.jwt() ->> 'email', '')), '')$a$,
$b$  select new.id, s.email,
         case when coalesce(current_setting('mgb.tk_ooo', true), '') in ('on', 'quiet') then 'ooo'   -- tk p2 s7 (m13)
              else nullif(lower(coalesce(auth.jwt() ->> 'email', '')), '') end$b$, 1);

-- An OOO move logs 'reassigned_ooo' with {direction, time_off_id}.
select pg_temp.patch_fn('public.tk_staff_reminders_activity()',
$a$    insert into tk_activity (task_id, actor_email, kind, from_value, to_value)
    values (new.id, v_actor, 'assignee', old.assignee_email, new.assignee_email);$a$,
$b$    insert into tk_activity (task_id, actor_email, kind, from_value, to_value, meta)   -- tk p2 s7
    values (new.id, v_actor,
            case when coalesce(current_setting('mgb.tk_ooo', true), '') = 'on' then 'reassigned_ooo' else 'assignee' end,
            old.assignee_email, new.assignee_email,
            case when coalesce(current_setting('mgb.tk_ooo', true), '') = 'on'
                 then coalesce(nullif(current_setting('mgb.tk_ooo_meta', true), '')::jsonb, '{}'::jsonb)
                 else '{}'::jsonb end);$b$, 1);

-- 3. Who covers ---------------------------------------------------------------
-- o_to: the person who takes the task; o_skip: why not (o_to may still be set
-- for no_access, so the caller can grant or request access).
create or replace function public.tk__ooo_cover(p_owner text, p_client text, p_due date, p_override text default null,
                                                out o_to text, out o_skip text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_client is null or exists (select 1 from clients c where c.id = p_client and c.is_internal) then
    o_skip := 'private';
    return;
  end if;
  if nullif(btrim(coalesce(p_override, '')), '') is not null then
    select lower(s.email) into o_to from staff s where lower(s.email) = lower(btrim(p_override)) and s.active;
  else
    select p.email into o_to from public.tk__client_people(p_client) p where p.role = 'backup' limit 1;
  end if;
  if o_to is null then
    o_skip := 'no_backup';
    return;
  end if;
  if o_to = lower(p_owner) then
    o_to := null;
    o_skip := 'self';
    return;
  end if;
  if exists (select 1 from staff_time_off o
              where lower(o.staff_email) = o_to and o.cancelled_at is null
                and coalesce(p_due, (now() at time zone 'America/Chicago')::date) between o.starts_on and o.ends_on) then
    o_skip := 'backup_away';
    return;
  end if;
  if not public.tk_staff_has_client(o_to, p_client) then
    o_skip := 'no_access';
  end if;
end $$;

-- Non-admin path (M1): ask an admin for access instead of granting it. One
-- open request per backup and client.
create or replace function public.tk__ooo_request_access(p_time_off staff_time_off, p_to text, p_client text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_away text;
  v_span int;
begin
  if exists (select 1 from staff_client_access_grants g
              where g.client_id = p_client and lower(g.staff_email) = p_to
                and (g.status = 'pending' or (g.status = 'approved' and g.expires_at > now()))) then
    return;
  end if;
  select s.name into v_name from staff s where lower(s.email) = p_to;
  select coalesce(s.name, p_time_off.staff_email) into v_away from staff s where lower(s.email) = lower(p_time_off.staff_email);
  v_span := greatest(1, p_time_off.ends_on - greatest(p_time_off.starts_on, (now() at time zone 'America/Chicago')::date) + 1);
  insert into staff_client_access_grants (client_id, staff_email, staff_name, reason, duration_days, status)
  values (p_client, p_to, v_name,
          left('Covering for ' || coalesce(v_away, p_time_off.staff_email) || ' (time off ' ||
               to_char(p_time_off.starts_on, 'Mon DD') || ' to ' || to_char(p_time_off.ends_on, 'Mon DD') || ')', 500),
          case when v_span <= 1 then 1 when v_span <= 7 then 7 else 30 end,
          'pending');
end $$;

-- Outbox payloads are capped at 4 KB: at most 12 lines, then "and N more".
create or replace function public.tk__ooo_items(p_items jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select coalesce((select jsonb_agg(left(e #>> '{}', 150) order by o)
                     from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality x(e, o)
                    where o <= 12), '[]'::jsonb)
         || case when jsonb_array_length(coalesce(p_items, '[]'::jsonb)) > 12
                 then jsonb_build_array(format('and %s more', jsonb_array_length(p_items) - 12))
                 else '[]'::jsonb end;
$$;

-- 4. Apply --------------------------------------------------------------------
-- p_mode: manual (an RPC call) or cron. p_can_grant: the caller is an admin
-- (M1). Dry run writes nothing and returns {move:[...], skip:[...]}.
create or replace function public.tk__ooo_apply(p_time_off_id uuid, p_dry_run boolean, p_overrides jsonb,
                                                p_mode text, p_can_grant boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t staff_time_off;
  r record;
  v_today date := (now() at time zone 'America/Chicago')::date;
  v_owner text;
  v_owner_name text;
  v_actor text := coalesce(nullif(lower(coalesce(auth.jwt() ->> 'email', '')), ''), 'system');
  v_override text;
  v_to text;
  v_skip text;
  v_grant boolean;
  v_move jsonb := '[]'::jsonb;
  v_skips jsonb := '[]'::jsonb;
  v_log jsonb := '[]'::jsonb;
  v_per jsonb := '{}'::jsonb;   -- backup -> [titles]
  v_owner_items jsonb := '[]'::jsonb;
  v_name text;
  k text;
  v_n int;
begin
  select * into t from staff_time_off where id = p_time_off_id;
  if not found then
    raise exception 'tk_not_found' using errcode = 'P0002';
  end if;
  v_owner := lower(t.staff_email);
  select coalesce(s.name, v_owner) into v_owner_name from staff s where lower(s.email) = v_owner;
  if t.cancelled_at is not null or t.ends_on < v_today then
    return jsonb_build_object('dry_run', p_dry_run, 'inactive', true, 'move', '[]'::jsonb, 'skip', '[]'::jsonb);
  end if;

  for r in
    select x.id, x.text, x.client_id, x.due_date, x.visibility, c.name as client_name
      from staff_reminders x
      left join clients c on c.id = x.client_id
     where lower(coalesce(x.assignee_email, x.staff_email)) = v_owner
       and x.deleted_at is null
       and x.status in ('todo', 'in_progress', 'waiting_client')
       and x.due_date between t.starts_on and t.ends_on
       and not exists (select 1 from tk_ooo_reassignments l where l.time_off_id = t.id and l.task_id = x.id)
     order by x.due_date, x.id
  loop
    if r.client_id is null or coalesce(r.visibility, 'shared') = 'private' then
      v_skips := v_skips || jsonb_build_object('reason', 'private', 'due', r.due_date);
      v_log := v_log || jsonb_build_object('task_id', r.id, 'reason', 'private');
      continue;
    end if;
    v_override := nullif(btrim(coalesce(p_overrides ->> r.client_id, '')), '');
    select o_to, o_skip into v_to, v_skip from public.tk__ooo_cover(v_owner, r.client_id, r.due_date, v_override);
    v_grant := false;
    if v_skip = 'no_access' and p_can_grant and v_override is null then
      if p_dry_run then
        v_skip := null;
        v_grant := true;   -- the apply will give the backup access for the time off
      else
        begin
          perform public.tk__grant_coverage(t.id, r.client_id);
        exception when others then
          null;
        end;
        if public.tk_staff_has_client(v_to, r.client_id) then
          v_skip := null;
          v_grant := true;
        end if;
      end if;
    end if;
    if v_skip = 'private' then
      v_skips := v_skips || jsonb_build_object('reason', 'private', 'due', r.due_date);
      v_log := v_log || jsonb_build_object('task_id', r.id, 'reason', 'private');
      continue;
    end if;
    select s.name into v_name from staff s where lower(s.email) = v_to;
    if v_skip is not null then
      if v_skip = 'no_access' and not p_dry_run and not p_can_grant then
        perform public.tk__ooo_request_access(t, v_to, r.client_id);
      end if;
      v_skips := v_skips || jsonb_build_object('task_id', r.id, 'title', left(r.text, 200), 'client_id', r.client_id,
                                               'client_name', r.client_name, 'due', r.due_date, 'reason', v_skip,
                                               'to', v_to, 'to_name', v_name);
      v_log := v_log || jsonb_build_object('task_id', r.id, 'client_id', r.client_id, 'reason', v_skip);
      continue;
    end if;

    if not p_dry_run then
      begin
        perform set_config('mgb.tk_ooo', 'on', true);
        perform set_config('mgb.tk_ooo_meta',
          jsonb_build_object('direction', 'out', 'time_off_id', t.id, 'from', v_owner)::text, true);
        update staff_reminders set assignee_email = v_to
         where id = r.id and lower(coalesce(assignee_email, staff_email)) = v_owner
           and status in ('todo', 'in_progress', 'waiting_client');
        if not found then
          raise exception 'tk_changed';
        end if;
        insert into tk_ooo_reassignments (time_off_id, task_id, client_id, from_email, to_email, reason, reassigned_by)
        values (t.id, r.id, r.client_id, v_owner, v_to,
                case when v_override is not null then 'manual' else 'backup' end, v_actor);
        perform set_config('mgb.tk_ooo', '', true);
        perform set_config('mgb.tk_ooo_meta', '', true);
      exception when others then
        perform set_config('mgb.tk_ooo', '', true);
        perform set_config('mgb.tk_ooo_meta', '', true);
        v_skips := v_skips || jsonb_build_object('task_id', r.id, 'title', left(r.text, 200), 'client_id', r.client_id,
                                                 'client_name', r.client_name, 'due', r.due_date, 'reason', 'error');
        v_log := v_log || jsonb_build_object('task_id', r.id, 'reason', 'error', 'detail', left(sqlerrm, 120));
        continue;
      end;
      v_per := jsonb_set(v_per, array[v_to],
                         coalesce(v_per -> v_to, '[]'::jsonb)
                           || to_jsonb(left(r.text, 160) || coalesce(' · ' || r.client_name, '') || ' · due ' || to_char(r.due_date, 'Mon DD')));
      v_owner_items := v_owner_items
        || to_jsonb(left(r.text, 160) || coalesce(' · ' || r.client_name, '') || ' → ' || coalesce(v_name, v_to));
    end if;
    v_move := v_move || jsonb_build_object('task_id', r.id, 'title', left(r.text, 200), 'client_id', r.client_id,
                                           'client_name', r.client_name, 'due', r.due_date, 'to', v_to,
                                           'to_name', v_name, 'grant', v_grant,
                                           'reason', case when v_override is not null then 'manual' else 'backup' end);
  end loop;

  if not p_dry_run then
    for k in select jsonb_object_keys(v_per) loop
      v_n := jsonb_array_length(v_per -> k);
      perform public.tk__enqueue('staff_task_batch', k, null, 'ooo_out:' || t.id::text,
        jsonb_build_object(
          'title', left(format('Covering for %s: %s task%s', v_owner_name, v_n, case when v_n = 1 then '' else 's' end), 120),
          'intro', format('%s is out %s to %s. These tasks are yours until they are back; they go back to %s automatically afterwards.',
                          v_owner_name, to_char(t.starts_on, 'Mon DD'), to_char(t.ends_on, 'Mon DD'), v_owner_name),
          'items', public.tk__ooo_items(v_per -> k),
          'hash', '#/tasks'));
    end loop;
    if jsonb_array_length(v_owner_items) > 0 then
      v_n := jsonb_array_length(v_owner_items);
      perform public.tk__enqueue('staff_task_batch', v_owner, null, 'ooo_owner_out:' || t.id::text,
        jsonb_build_object(
          'title', left(format('%s task%s handed to backups for your time off', v_n, case when v_n = 1 then '' else 's' end), 120),
          'intro', format('Your time off %s to %s: these tasks went to the client''s backup bookkeeper. They come back to you when it ends.',
                          to_char(t.starts_on, 'Mon DD'), to_char(t.ends_on, 'Mon DD')),
          'items', public.tk__ooo_items(v_owner_items),
          'hash', '#/tasks'));
    end if;
    if jsonb_array_length(v_move) > 0 or jsonb_array_length(v_log) > 0 then
      insert into tk_ooo_runs (time_off_id, action, mode, actor, moved, skipped, detail)
      values (t.id, 'apply', p_mode, v_actor, jsonb_array_length(v_move), jsonb_array_length(v_log),
              jsonb_build_object('skips', v_log));
    end if;
  end if;

  return jsonb_build_object('dry_run', p_dry_run, 'time_off_id', t.id, 'owner', v_owner, 'owner_name', v_owner_name,
                            'starts_on', t.starts_on, 'ends_on', t.ends_on, 'move', v_move, 'skip', v_skips);
end $$;

-- 5. Return -------------------------------------------------------------------
-- Gives back every open ledger row of a time off, or (p_keep_from/p_keep_to
-- set) only the tasks now due outside that window. Done or deleted tasks are
-- closed; a task someone reassigned since is left alone ('changed'); a task in
-- Ready for review stays and is retried on the next run.
create or replace function public.tk__ooo_return(p_time_off_id uuid, p_keep_from date, p_keep_to date,
                                                 p_dry_run boolean, p_mode text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  l record;
  v_actor text := coalesce(nullif(lower(coalesce(auth.jwt() ->> 'email', '')), ''), 'system');
  v_back jsonb := '[]'::jsonb;
  v_left jsonb := '[]'::jsonb;
  v_per_owner jsonb := '{}'::jsonb;
  v_per_backup jsonb := '{}'::jsonb;
  v_item text;
  v_cur text;
  v_from_name text;
  v_owner_label text;
  k text;
  v_n int;
begin
  for l in
    select x.id as lid, x.from_email, x.to_email, x.time_off_id, r.id as task_id, r.text, r.status, r.deleted_at,
           r.due_date, r.assignee_email, r.staff_email, c.name as client_name
      from tk_ooo_reassignments x
      join staff_reminders r on r.id = x.task_id
      left join clients c on c.id = r.client_id
     where x.time_off_id = p_time_off_id and x.returned_at is null
       and (p_keep_from is null or r.due_date is null or r.due_date < p_keep_from or r.due_date > p_keep_to)
     order by r.due_date, r.id
  loop
    v_cur := lower(coalesce(l.assignee_email, l.staff_email));
    v_item := left(l.text, 160) || coalesce(' · ' || l.client_name, '');
    if l.deleted_at is not null or l.status = 'done' then
      if not p_dry_run then
        update tk_ooo_reassignments set returned_at = now(), returned_by = v_actor, return_skipped_reason = 'closed'
         where id = l.lid;
      end if;
      v_left := v_left || jsonb_build_object('task_id', l.task_id, 'reason', 'closed');
      continue;
    end if;
    if v_cur is distinct from l.to_email then
      if not p_dry_run then
        update tk_ooo_reassignments set returned_at = now(), returned_by = v_actor, return_skipped_reason = 'changed'
         where id = l.lid;
      end if;
      v_left := v_left || jsonb_build_object('task_id', l.task_id, 'reason', 'changed');
      continue;
    end if;
    if l.status = 'ready_for_review' then
      if not p_dry_run then
        update tk_ooo_reassignments set return_skipped_reason = 'in_review' where id = l.lid;
      end if;
      v_left := v_left || jsonb_build_object('task_id', l.task_id, 'reason', 'in_review', 'title', left(l.text, 200));
      continue;
    end if;
    if not exists (select 1 from staff s where lower(s.email) = l.from_email and s.active) then
      if not p_dry_run then
        update tk_ooo_reassignments set returned_at = now(), returned_by = v_actor, return_skipped_reason = 'owner_inactive'
         where id = l.lid;
      end if;
      v_left := v_left || jsonb_build_object('task_id', l.task_id, 'reason', 'owner_inactive');
      continue;
    end if;
    if not p_dry_run then
      begin
        perform set_config('mgb.tk_ooo', 'on', true);
        perform set_config('mgb.tk_ooo_meta',
          jsonb_build_object('direction', 'back', 'time_off_id', l.time_off_id, 'from', l.to_email)::text, true);
        update staff_reminders set assignee_email = l.from_email where id = l.task_id;
        delete from tk_followers f where f.task_id = l.task_id and f.staff_email = l.to_email and f.added_by = 'ooo';
        update tk_ooo_reassignments set returned_at = now(), returned_by = v_actor, return_skipped_reason = null
         where id = l.lid;
        perform set_config('mgb.tk_ooo', '', true);
        perform set_config('mgb.tk_ooo_meta', '', true);
      exception when others then
        perform set_config('mgb.tk_ooo', '', true);
        perform set_config('mgb.tk_ooo_meta', '', true);
        v_left := v_left || jsonb_build_object('task_id', l.task_id, 'reason', 'error', 'detail', left(sqlerrm, 120));
        continue;
      end;
      v_per_owner := jsonb_set(v_per_owner, array[l.from_email],
                               coalesce(v_per_owner -> l.from_email, '[]'::jsonb) || to_jsonb(v_item));
      v_per_backup := jsonb_set(v_per_backup, array[l.to_email],
                                coalesce(v_per_backup -> l.to_email, '[]'::jsonb)
                                  || to_jsonb(v_item || ' → ' || coalesce((select s.name from staff s where lower(s.email) = l.from_email), l.from_email)));
    end if;
    v_back := v_back || jsonb_build_object('task_id', l.task_id, 'title', left(l.text, 200), 'client_name', l.client_name,
                                           'due', l.due_date, 'to', l.from_email);
  end loop;

  if not p_dry_run then
    for k in select jsonb_object_keys(v_per_owner) loop
      v_n := jsonb_array_length(v_per_owner -> k);
      perform public.tk__enqueue('staff_task_batch', k, null, 'ooo_owner_back:' || p_time_off_id::text,
        jsonb_build_object(
          'title', left(format('Welcome back: %s task%s returned to you', v_n, case when v_n = 1 then '' else 's' end), 120),
          'intro', 'Your backups handed these tasks back. Check each one''s comments and activity for anything that happened while you were out.',
          'items', public.tk__ooo_items(v_per_owner -> k),
          'hash', '#/tasks'));
    end loop;
    for k in select jsonb_object_keys(v_per_backup) loop
      v_n := jsonb_array_length(v_per_backup -> k);
      perform public.tk__enqueue('staff_task_batch', k, null, 'ooo_back:' || p_time_off_id::text,
        jsonb_build_object(
          'title', left(format('%s covered task%s handed back', v_n, case when v_n = 1 then '' else 's' end), 120),
          'intro', 'The time off you covered has ended, so these tasks went back to their owner. Thanks for covering.',
          'items', public.tk__ooo_items(v_per_backup -> k),
          'hash', '#/tasks'));
    end loop;
    if jsonb_array_length(v_back) > 0 or jsonb_array_length(v_left) > 0 then
      insert into tk_ooo_runs (time_off_id, action, mode, actor, moved, skipped, detail)
      values (p_time_off_id, 'return', p_mode, v_actor, jsonb_array_length(v_back), jsonb_array_length(v_left),
              jsonb_build_object('left', (select coalesce(jsonb_agg(e - 'title'), '[]'::jsonb) from jsonb_array_elements(v_left) e)));
    end if;
  end if;
  return jsonb_build_object('dry_run', p_dry_run, 'time_off_id', p_time_off_id, 'returned', v_back, 'left', v_left);
end $$;

-- 6. Staff RPCs ---------------------------------------------------------------
-- The time-off owner or an admin. Only admins pass overrides {client_id: email}.
create or replace function public.tk_apply_ooo(p_time_off_id uuid, p_dry_run boolean default true,
                                               p_overrides jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t staff_time_off;
  v_me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_admin boolean;
begin
  if v_me = '' or not public.is_active_staff() then
    raise exception 'tk_forbidden' using errcode = '42501';
  end if;
  v_admin := public.is_active_staff_admin();
  select * into t from staff_time_off where id = p_time_off_id;
  if not found or (lower(t.staff_email) <> v_me and not v_admin) then
    raise exception 'tk_forbidden' using errcode = '42501';
  end if;
  if p_overrides is not null and jsonb_typeof(p_overrides) <> 'object' then
    raise exception 'tk_bad_request' using errcode = '22023';
  end if;
  if not v_admin and coalesce(p_overrides, '{}'::jsonb) <> '{}'::jsonb then
    raise exception 'tk_forbidden' using errcode = '42501';
  end if;
  if t.cancelled_at is not null or t.ends_on < (now() at time zone 'America/Chicago')::date then
    raise exception 'tk_bad_request' using errcode = '22023';
  end if;
  return public.tk__ooo_apply(p_time_off_id, coalesce(p_dry_run, true), coalesce(p_overrides, '{}'::jsonb), 'manual', v_admin);
end $$;

create or replace function public.tk_return_ooo(p_time_off_id uuid, p_dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t staff_time_off;
  v_me text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if v_me = '' or not public.is_active_staff() then
    raise exception 'tk_forbidden' using errcode = '42501';
  end if;
  select * into t from staff_time_off where id = p_time_off_id;
  if not found or (lower(t.staff_email) <> v_me and not public.is_active_staff_admin()) then
    raise exception 'tk_forbidden' using errcode = '42501';
  end if;
  return public.tk__ooo_return(p_time_off_id, null, null, coalesce(p_dry_run, false), 'manual');
end $$;

-- Open coverage the caller is part of (admins: all). Ids, people and dates
-- only; the caller reads task details through staff_reminders RLS.
create or replace function public.tk_my_coverage()
returns table (time_off_id uuid, task_id uuid, client_id text, from_email text, from_name text,
               to_email text, to_name text, reason text, starts_on date, ends_on date,
               reassigned_at timestamptz, return_skipped_reason text)
language sql
stable
security definer
set search_path = public
as $$
  select l.time_off_id, l.task_id, l.client_id, l.from_email, fs.name, l.to_email, ts.name, l.reason,
         o.starts_on, o.ends_on, l.reassigned_at, l.return_skipped_reason
    from tk_ooo_reassignments l
    join staff_time_off o on o.id = l.time_off_id
    left join staff fs on lower(fs.email) = l.from_email
    left join staff ts on lower(ts.email) = l.to_email
   where l.returned_at is null
     and public.is_active_staff()
     and (public.is_active_staff_admin()
          or lower(coalesce(auth.jwt() ->> 'email', '')) in (l.from_email, l.to_email))
   order by l.reassigned_at desc
   limit 2000;
$$;

-- 7. Time-off edits -----------------------------------------------------------
create or replace function public.tk_staff_time_off_after_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from tk_ooo_reassignments l where l.time_off_id = new.id and l.returned_at is null) then
    return null;
  end if;
  begin
    if new.cancelled_at is not null and old.cancelled_at is null then
      perform public.tk__ooo_return(new.id, null, null, false, 'cancel');
    elsif new.starts_on > old.starts_on or new.ends_on < old.ends_on then
      perform public.tk__ooo_return(new.id, new.starts_on, new.ends_on, false, 'edit');
    end if;
  exception when others then
    raise warning 'tk ooo return on time-off edit failed: %', sqlerrm;   -- the daily job retries
  end;
  return null;
end $$;

drop trigger if exists tk_staff_time_off_after_update on public.staff_time_off;
create trigger tk_staff_time_off_after_update
  after update on public.staff_time_off
  for each row execute function public.tk_staff_time_off_after_update();

-- 8. Daily job ----------------------------------------------------------------
create or replace function public.tk_ooo_daily()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'America/Chicago')::date;
  t record;
  v_auto boolean;
  v_applied int := 0;
  v_returned int := 0;
  v_errors int := 0;
begin
  -- Returns first: ended or cancelled windows, then tasks now outside a shortened one.
  for t in
    select o.* from staff_time_off o
     where exists (select 1 from tk_ooo_reassignments l where l.time_off_id = o.id and l.returned_at is null)
  loop
    begin
      if t.cancelled_at is not null or t.ends_on < v_today then
        perform public.tk__ooo_return(t.id, null, null, false, 'cron');
      else
        perform public.tk__ooo_return(t.id, t.starts_on, t.ends_on, false, 'cron');
      end if;
      v_returned := v_returned + 1;
    exception when others then
      v_errors := v_errors + 1;
      raise warning 'tk_ooo_daily return %: %', t.id, sqlerrm;
    end;
  end loop;

  select coalesce((select value #>> '{}' from tk_settings where key = 'ooo_auto_apply'), 'true') <> 'false' into v_auto;
  if v_auto then
    for t in
      select o.* from staff_time_off o
       where o.cancelled_at is null and o.starts_on <= v_today and o.ends_on >= v_today
         and exists (select 1 from staff s where lower(s.email) = lower(o.staff_email) and s.active)
    loop
      begin
        perform public.tk__ooo_apply(t.id, false, '{}'::jsonb, 'cron', false);
        v_applied := v_applied + 1;
      exception when others then
        v_errors := v_errors + 1;
        raise warning 'tk_ooo_daily apply %: %', t.id, sqlerrm;
      end;
    end loop;
  end if;
  return jsonb_build_object('applied_windows', v_applied, 'returned_windows', v_returned, 'errors', v_errors,
                            'auto_apply', v_auto);
end $$;

select cron.unschedule(jobid) from cron.job where jobname = 'tk-ooo-daily';
select cron.schedule('tk-ooo-daily', '0 11 * * *', $$select public.tk_ooo_daily();$$);

-- 9. Generator: a task due while its assignee is away goes to the backup ------
select pg_temp.patch_fn('public.tk__issue_period(task_templates, jsonb, text, date, boolean)',
$a$  v_items int;
begin$a$,
$b$  v_items int;
  v_away uuid;   -- tk p2 s7
  v_cover text;   -- tk p2 s7
begin$b$, 1);

select pg_temp.patch_fn('public.tk__issue_period(task_templates, jsonb, text, date, boolean)',
$a$  if p_dry_run then
    return jsonb_build_object('status', 'would_create'$a$,
$b$  -- tk p2 s7: the assignee is out on the due date (time off already started) -> the backup takes it
  select o.id into v_away from staff_time_off o
   where lower(o.staff_email) = v_to and o.cancelled_at is null and v_due between o.starts_on and o.ends_on
     and o.starts_on <= (now() at time zone 'America/Chicago')::date
   limit 1;
  if v_away is not null then
    select c.o_to into v_cover from public.tk__ooo_cover(v_to, p_client, v_due, null) c where c.o_skip is null;
  end if;
  if p_dry_run then
    return jsonb_build_object('status', 'would_create'$b$, 1);

select pg_temp.patch_fn('public.tk__issue_period(task_templates, jsonb, text, date, boolean)',
$a$                              'start_on', v_due - p_t.lead_days);$a$,
$b$                              'start_on', v_due - p_t.lead_days, 'covered_by', v_cover);   -- tk p2 s7$b$, 1);

select pg_temp.patch_fn('public.tk__issue_period(task_templates, jsonb, text, date, boolean)',
$a$      v_to, v_to, (p_eff ->> 'title')$a$,
$b$      v_to, coalesce(v_cover, v_to), (p_eff ->> 'title')$b$, 1);

select pg_temp.patch_fn('public.tk__issue_period(task_templates, jsonb, text, date, boolean)',
$a$    insert into staff_reminders (
      staff_email, assignee_email, text, client_id, priority, due_date, due_date_original, start_on,$a$,
$b$    perform set_config('mgb.tk_ooo', case when v_cover is not null then 'quiet' else '' end, true);   -- tk p2 s7
    insert into staff_reminders (
      staff_email, assignee_email, text, client_id, priority, due_date, due_date_original, start_on,$b$, 1);

select pg_temp.patch_fn('public.tk__issue_period(task_templates, jsonb, text, date, boolean)',
$a$    else
      insert into task_checklist_items (reminder_id, text, sort_order)$a$,
$b$    else
      if v_cover is not null then   -- tk p2 s7
        insert into tk_ooo_reassignments (time_off_id, task_id, client_id, from_email, to_email, reason, reassigned_by)
        values (v_away, v_id, p_client, v_to, v_cover, 'generator', 'system')
        on conflict do nothing;
      end if;
      insert into task_checklist_items (reminder_id, text, sort_order)$b$, 1);

select pg_temp.patch_fn('public.tk__issue_period(task_templates, jsonb, text, date, boolean)',
$a$    update task_template_issued set reminder_id = v_id$a$,
$b$    perform set_config('mgb.tk_ooo', '', true);   -- tk p2 s7
    update task_template_issued set reminder_id = v_id$b$, 1);

select pg_temp.patch_fn('public.tk__issue_period(task_templates, jsonb, text, date, boolean)',
$a$  return jsonb_build_object('status', 'created', 'assignee', v_to, 'reminder_id', v_id, 'due', v_due, 'label', v_label);$a$,
$b$  return jsonb_build_object('status', 'created', 'assignee', v_to, 'reminder_id', v_id, 'due', v_due, 'label', v_label,
                            'covered_by', v_cover);   -- tk p2 s7$b$, 1);

-- 10. Roll-forward: a covered repeating task --------------------------------
-- Next due date still inside the time off: the new task stays with the backup
-- (and gets its own ledger row). Past it: the new task goes to the owner.
select pg_temp.patch_fn('public.complete_staff_item(uuid, boolean, date)',
$a$  v_status text;   -- tk v1$a$,
$b$  v_status text;   -- tk v1
  v_assignee text;   -- tk p2 s7
  v_ooo_id uuid;   -- tk p2 s7
  v_ooo_off uuid;   -- tk p2 s7
  v_ooo_from text;   -- tk p2 s7
  v_ooo_to text;   -- tk p2 s7
  v_ooo_mode text;   -- tk p2 s7: stay | home$b$, 1);

select pg_temp.patch_fn('public.complete_staff_item(uuid, boolean, date)',
$a$  perform set_config('mgb.tk_rollforward', 'on', true);   -- tk v1$a$,
$b$  -- tk p2 s7: covered task -> the next one stays with the backup or goes home
  v_assignee := lower(coalesce(v_row.assignee_email, v_row.staff_email));
  select l.id, l.time_off_id, l.from_email, l.to_email into v_ooo_id, v_ooo_off, v_ooo_from, v_ooo_to
    from tk_ooo_reassignments l
   where l.task_id = p_id and l.returned_at is null and l.to_email = v_assignee
   order by l.reassigned_at desc
   limit 1;
  if v_ooo_id is not null then
    if exists (select 1 from staff_time_off o where o.id = v_ooo_off and o.cancelled_at is null
                 and v_next between o.starts_on and o.ends_on) then
      v_ooo_mode := 'stay';
    elsif exists (select 1 from staff s where lower(s.email) = v_ooo_from and s.active) then
      v_ooo_mode := 'home';
      v_assignee := v_ooo_from;
    end if;
    perform set_config('mgb.tk_ooo', 'quiet', true);   -- no per-task email; not a bypass
  end if;
  perform set_config('mgb.tk_rollforward', 'on', true);   -- tk v1$b$, 1);

select pg_temp.patch_fn('public.complete_staff_item(uuid, boolean, date)',
$a$    coalesce(v_row.assignee_email, v_row.staff_email),
$a$,
$b$    coalesce(v_assignee, v_row.assignee_email, v_row.staff_email),   -- tk p2 s7
$b$, 1);

select pg_temp.patch_fn('public.complete_staff_item(uuid, boolean, date)',
$a$  perform set_config('mgb.tk_rollforward', '', true);   -- tk v1$a$,
$b$  perform set_config('mgb.tk_rollforward', '', true);   -- tk v1
  perform set_config('mgb.tk_ooo', '', true);   -- tk p2 s7
  if v_ooo_mode = 'stay' then   -- tk p2 s7
    insert into tk_ooo_reassignments (time_off_id, task_id, client_id, from_email, to_email, reason, reassigned_by)
    values (v_ooo_off, v_new_id, v_row.client_id, v_ooo_from, v_ooo_to, 'rollforward', lower(v_caller))
    on conflict do nothing;
  end if;$b$, 1);

select pg_temp.patch_fn('public.complete_staff_item(uuid, boolean, date)',
$a$  return v_new_id;$a$,
$b$  if v_ooo_mode = 'home' then   -- tk p2 s7 (m13): the backup stops following the next one
    delete from tk_followers f where f.task_id = v_new_id and f.staff_email = v_ooo_to and f.added_by = 'ooo';
  end if;
  return v_new_id;$b$, 1);

-- 11. Grants ------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'public.tk_apply_ooo(uuid, boolean, jsonb)',
    'public.tk_return_ooo(uuid, boolean)',
    'public.tk_my_coverage()'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  foreach f in array array[
    'public.tk__ooo_cover(text, text, date, text)',
    'public.tk__ooo_items(jsonb)',
    'public.tk__ooo_request_access(staff_time_off, text, text)',
    'public.tk__ooo_apply(uuid, boolean, jsonb, text, boolean)',
    'public.tk__ooo_return(uuid, date, date, boolean, text)',
    'public.tk_ooo_daily()',
    'public.tk_staff_time_off_after_update()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;

create or replace function public.tk_schema_version()
returns integer
language sql
stable
set search_path = public
as $$ select 8 $$;
