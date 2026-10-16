-- =====================================================================
-- Tasks Phase 2, S7 review fixes: out-of-office hand-off.
-- Run after tasks-p2-7-ooo.sql (and S8). Safe to re-run; nothing dropped.
-- No schema change and no new UI gate, so tk_schema_version() stays 9
-- (same as the S4 hotfix file).
--
-- MAJOR 1  Phase 2 apply is manual (spec C7 "Apply is manual", Q5). The daily
--          job only hands tasks off when tk_settings.ooo_auto_apply is
--          exactly true; a missing row now means OFF. Seeds the row as false.
--          Manual apply (Hand my tasks to backups / Hand off tasks) unchanged.
-- MAJOR 2  Re-apply after a hand-back: the apply filter skipped any task with a
--          ledger row for the time off, even a returned one, so a second
--          manual hand-off never moved it again. Now only an OPEN ledger row
--          (returned_at is null) skips the task, and the move reopens the
--          returned row (one row per time off and task, unique key kept).
--          A cron apply (only when auto apply is on) still never re-takes a
--          task that was handed back, so Hand back now sticks.
-- minor a  A denied access request is not filed again for the same time off
--          (any denial requested on or after the time off was created).
-- minor b  tk_ooo_runs: a cron run logs a row only when something changed
--          (apply: a task moved; return: a task returned or a ledger row
--          closed). Manual, edit and cancel runs always log.
-- minor c  The daily job no longer hands tasks back while the time off is
--          still running. Before, a task whose due date the backup moved past
--          the last day off went straight back to the person who is away.
--          Now it stays with the backup and comes back after the last day off
--          like everything else. Shortening the dates still returns at once
--          (the time-off trigger). While a time off runs, the daily job only
--          retries tasks an earlier return (Hand back now, shorter dates) left
--          with the backup because they were in review.
-- minor d  Moving a whole time off later (new first day and new last day both
--          later) that has not started under the new dates hands every task
--          back at once; the person runs Hand my tasks to backups again
--          nearer the time. Before, tasks due in the overlap stayed with the
--          backup and tasks in the new days never moved. A window that has
--          already started keeps the old behavior (tasks now outside it come
--          home; re-apply picks up the new days).
--          Hand-back emails from an edit or cancel say the time off changed
--          instead of "Welcome back".
-- =====================================================================

-- MAJOR 1: explicit off switch (a later owner choice is kept on re-run).
insert into public.tk_settings (key, value)
values ('ooo_auto_apply', 'false'::jsonb)
on conflict (key) do nothing;

-- minor a ---------------------------------------------------------------------
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
  -- tk p2 s7 fix (minor a): an admin said no for this time off; don't ask again.
  if exists (select 1 from staff_client_access_grants g
              where g.client_id = p_client and lower(g.staff_email) = p_to
                and g.status = 'denied' and g.requested_at >= p_time_off.created_at) then
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

-- MAJOR 2 + minor b: apply ------------------------------------------------------
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
       -- tk p2 s7 fix (MAJOR 2): an open ledger row skips the task; a returned
       -- one does not, except for the cron (Hand back now sticks).
       and not exists (select 1 from tk_ooo_reassignments l
                        where l.time_off_id = t.id and l.task_id = x.id
                          and (l.returned_at is null or p_mode = 'cron'))
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
        -- tk p2 s7 fix (MAJOR 2): reopen a returned row instead of skipping.
        insert into tk_ooo_reassignments (time_off_id, task_id, client_id, from_email, to_email, reason, reassigned_by)
        values (t.id, r.id, r.client_id, v_owner, v_to,
                case when v_override is not null then 'manual' else 'backup' end, v_actor)
        on conflict (time_off_id, task_id) do update
          set client_id = excluded.client_id, from_email = excluded.from_email, to_email = excluded.to_email,
              reason = excluded.reason, reassigned_at = now(), reassigned_by = excluded.reassigned_by,
              returned_at = null, returned_by = null, return_skipped_reason = null
          where tk_ooo_reassignments.returned_at is not null;
        if not found then
          raise exception 'tk_changed';   -- an open row appeared meanwhile; undo this move
        end if;
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
    -- tk p2 s7 fix (minor b): a cron run with only skips logs nothing.
    if jsonb_array_length(v_move) > 0 or p_mode <> 'cron' then
      insert into tk_ooo_runs (time_off_id, action, mode, actor, moved, skipped, detail)
      values (t.id, 'apply', p_mode, v_actor, jsonb_array_length(v_move), jsonb_array_length(v_log),
              jsonb_build_object('skips', v_log));
    end if;
  end if;

  return jsonb_build_object('dry_run', p_dry_run, 'time_off_id', t.id, 'owner', v_owner, 'owner_name', v_owner_name,
                            'starts_on', t.starts_on, 'ends_on', t.ends_on, 'move', v_move, 'skip', v_skips);
end $$;

-- minor b + d (email wording): return ------------------------------------------
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
  v_changed boolean := p_mode in ('edit', 'cancel');   -- tk p2 s7 fix: the dates changed, not "welcome back"
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
       -- tk p2 s7 fix (minor c): the daily retry of a running window only
       -- looks at tasks an earlier return left waiting on review.
       and (coalesce(current_setting('mgb.tk_ooo_waiting_only', true), '') <> 'on'
            or x.return_skipped_reason = 'in_review')
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
          'title', left(case when v_changed
                             then format('Time off changed: %s task%s back with you', v_n, case when v_n = 1 then '' else 's' end)
                             else format('Welcome back: %s task%s returned to you', v_n, case when v_n = 1 then '' else 's' end) end, 120),
          'intro', case when v_changed
                        then 'Your time off was changed or cancelled, so these tasks came back from your backups. If you still need cover, use Hand my tasks to backups under your time off.'
                        else 'Your backups handed these tasks back. Check each one''s comments and activity for anything that happened while you were out.' end,
          'items', public.tk__ooo_items(v_per_owner -> k),
          'hash', '#/tasks'));
    end loop;
    for k in select jsonb_object_keys(v_per_backup) loop
      v_n := jsonb_array_length(v_per_backup -> k);
      perform public.tk__enqueue('staff_task_batch', k, null, 'ooo_back:' || p_time_off_id::text,
        jsonb_build_object(
          'title', left(format('%s covered task%s handed back', v_n, case when v_n = 1 then '' else 's' end), 120),
          'intro', case when v_changed
                        then 'The time off you were covering was changed or cancelled, so these tasks went back to their owner.'
                        else 'The time off you covered has ended, so these tasks went back to their owner. Thanks for covering.' end,
          'items', public.tk__ooo_items(v_per_backup -> k),
          'hash', '#/tasks'));
    end loop;
    -- tk p2 s7 fix (minor b): a cron run where only in-review tasks wait logs nothing.
    if jsonb_array_length(v_back) > 0
       or (p_mode <> 'cron' and jsonb_array_length(v_left) > 0)
       or exists (select 1 from jsonb_array_elements(v_left) e where e ->> 'reason' <> 'in_review') then
      insert into tk_ooo_runs (time_off_id, action, mode, actor, moved, skipped, detail)
      values (p_time_off_id, 'return', p_mode, v_actor, jsonb_array_length(v_back), jsonb_array_length(v_left),
              jsonb_build_object('left', (select coalesce(jsonb_agg(e - 'title'), '[]'::jsonb) from jsonb_array_elements(v_left) e)));
    end if;
  end if;
  return jsonb_build_object('dry_run', p_dry_run, 'time_off_id', p_time_off_id, 'returned', v_back, 'left', v_left);
end $$;

-- minor d: moving a whole time off later ---------------------------------------
create or replace function public.tk_staff_time_off_after_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'America/Chicago')::date;
begin
  if not exists (select 1 from tk_ooo_reassignments l where l.time_off_id = new.id and l.returned_at is null) then
    return null;
  end if;
  begin
    if new.cancelled_at is not null and old.cancelled_at is null then
      perform public.tk__ooo_return(new.id, null, null, false, 'cancel');
    elsif new.starts_on > old.starts_on and new.ends_on > old.ends_on and new.starts_on > v_today then
      -- tk p2 s7 fix (minor d): moved later and not started under the new
      -- dates -> everything comes home; hand off again nearer the time.
      perform public.tk__ooo_return(new.id, null, null, false, 'edit');
    elsif new.starts_on > old.starts_on or new.ends_on < old.ends_on then
      perform public.tk__ooo_return(new.id, new.starts_on, new.ends_on, false, 'edit');
    end if;
  exception when others then
    raise warning 'tk ooo return on time-off edit failed: %', sqlerrm;   -- the daily job returns it once the time off ends
  end;
  return null;
end $$;

-- MAJOR 1 + minor c: daily job --------------------------------------------------
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
  -- Returns: cancelled windows and windows whose last day has passed (spec
  -- C7). A running window is left alone (minor c): a task the backup moved
  -- past the last day off comes back with the rest when the time off ends.
  for t in
    select o.* from staff_time_off o
     where (o.cancelled_at is not null or o.ends_on < v_today)
       and exists (select 1 from tk_ooo_reassignments l where l.time_off_id = o.id and l.returned_at is null)
  loop
    begin
      perform public.tk__ooo_return(t.id, null, null, false, 'cron');
      v_returned := v_returned + 1;
    exception when others then
      v_errors := v_errors + 1;
      raise warning 'tk_ooo_daily return %: %', t.id, sqlerrm;
    end;
  end loop;
  -- A running window: only retry tasks an earlier return (Hand back now, a
  -- shortened time off) left with the backup because they were in review.
  for t in
    select o.* from staff_time_off o
     where o.cancelled_at is null and o.ends_on >= v_today
       and exists (select 1 from tk_ooo_reassignments l where l.time_off_id = o.id and l.returned_at is null
                     and l.return_skipped_reason = 'in_review')
  loop
    begin
      perform set_config('mgb.tk_ooo_waiting_only', 'on', true);
      perform public.tk__ooo_return(t.id, null, null, false, 'cron');
      perform set_config('mgb.tk_ooo_waiting_only', '', true);
      v_returned := v_returned + 1;
    exception when others then
      perform set_config('mgb.tk_ooo_waiting_only', '', true);
      v_errors := v_errors + 1;
      raise warning 'tk_ooo_daily retry %: %', t.id, sqlerrm;
    end;
  end loop;

  -- MAJOR 1: apply is manual in Phase 2; the cron applies only when the
  -- owner sets ooo_auto_apply to true (missing = off).
  select coalesce((select value #>> '{}' from tk_settings where key = 'ooo_auto_apply'), 'false') = 'true' into v_auto;
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

-- Grants (create or replace keeps them; restated for a fresh database) ----------
do $$
declare f text;
begin
  foreach f in array array[
    'public.tk__ooo_request_access(staff_time_off, text, text)',
    'public.tk__ooo_apply(uuid, boolean, jsonb, text, boolean)',
    'public.tk__ooo_return(uuid, date, date, boolean, text)',
    'public.tk_ooo_daily()',
    'public.tk_staff_time_off_after_update()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;
