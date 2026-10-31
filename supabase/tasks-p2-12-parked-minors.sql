-- =====================================================================
-- Tasks Phase 2: the parked minors (S7 out-of-office, Ask client, period
-- review notices). Built from the LIVE function bodies of 2026-10-27, not
-- from older repo copies. Additive: CREATE OR REPLACE only, same signatures,
-- no table, column, grant, switch or data change. Safe to re-run.
-- tk_schema_version() stays 12 (nothing in the UI gates on this).
--
-- 1  Stale in_review mark on re-apply (tk__ooo_apply). A Hand back now (or
--    shorter dates) leaves a task that is in review with the backup and marks
--    its open ledger row in_review; the daily job then hands it back once the
--    review ends. If the person then runs Hand my tasks to backups again,
--    that mark was kept, so the task still went home mid time off. A manual
--    (non-cron) apply now clears the in_review mark on this time off's open
--    rows for tasks due inside its current dates: the task stays with the
--    backup and comes back when the time off ends, like everything else
--    handed off (a task a shortened time off left outside the dates still
--    goes home once its review ends). Cron applies leave the mark
--    (Hand back now still sticks). The run log notes how many were kept.
-- 2  tk__ooo_request_access: a denial only blocks a new request when it was
--    for THIS time off's coverage request ("Covering for ... (time off <its
--    dates>)", filed on or after the time off was created). Before, any denial
--    for that backup and client since the time off was created blocked it.
-- 3  Manual return always logged (tk__ooo_return). Manual, edit and cancel
--    runs now always write a tk_ooo_runs row, even when nothing was left to
--    hand back (the S7 fix file promised this; a manual Hand back now with
--    nothing to return wrote no row).
-- 4  tk__request_send_mode: the MGB internal client is never 'live', even
--    with client_request_pilot = "all" (it is a dry run, as the UI already
--    treats it). Test clients still return 'test' first.
-- 5  tk_period_review_notify: a month (quarter, year) going back to review
--    no longer re-sends "ready for review" to every admin. A person who got
--    the notice for that same period in the last 24 hours is skipped, unless
--    an admin reopened the period after that notice (a reopen is a real
--    send-back, so the next "ready" notifies again) or the period's last
--    write before this one was by another active admin (sent back from
--    review). Undone notices don't count.
-- 6  tk_ooo_runs daily noise. Already mostly fixed by tasks-p2-9 minor b
--    (a cron apply with only skips, and a cron return with only in-review
--    waits, log nothing). The one remaining repeat: a cron return whose only
--    news is the same error rows as its last return run logged an identical
--    row every day. It now logs an error run only when the errors changed.
--
-- No emails are sent by this file. Nothing here flips a switch:
-- ooo_auto_apply, asana_import_apply_enabled and client_request_pilot are
-- untouched.
--
-- Self-test: tasks-p2-12-parked-minors-tests.sql (ends in ROLLBACK).
-- Applied to production 2026-10-27 (migration tasks_p2_12_parked_minors);
-- self-test passed live the same day.
-- =====================================================================

-- 1 + 6 (apply side unchanged) -----------------------------------------
CREATE OR REPLACE FUNCTION public.tk__ooo_apply(p_time_off_id uuid, p_dry_run boolean, p_overrides jsonb, p_mode text, p_can_grant boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_kept int := 0;   -- tk p2 minors (1)
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
     where lower(x.assignee_email) = v_owner   -- tk p2 s8b fix: assigned only (an unassigned task is nobody's to hand off)
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
         where id = r.id and lower(assignee_email) = v_owner
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
    -- tk p2 minors (1): a manual re-apply means "keep my cover". A task an
    -- earlier return left with the backup because it was in review would
    -- otherwise go home once its review ends; clear that mark so it stays
    -- with the backup and comes back when the time off ends. The cron (only
    -- when auto apply is on) keeps the mark, so Hand back now still sticks.
    -- Only tasks due inside the current dates: one a shortened time off left
    -- outside them still goes home once its review ends.
    if p_mode <> 'cron' then
      update tk_ooo_reassignments l set return_skipped_reason = null
        from staff_reminders x
       where l.time_off_id = t.id and l.returned_at is null and l.return_skipped_reason = 'in_review'
         and x.id = l.task_id and x.due_date between t.starts_on and t.ends_on;
      get diagnostics v_kept = row_count;
    end if;
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
              jsonb_build_object('skips', v_log)
                || case when v_kept > 0 then jsonb_build_object('kept_in_review', v_kept) else '{}'::jsonb end);
    end if;
  end if;

  return jsonb_build_object('dry_run', p_dry_run, 'time_off_id', t.id, 'owner', v_owner, 'owner_name', v_owner_name,
                            'starts_on', t.starts_on, 'ends_on', t.ends_on, 'move', v_move, 'skip', v_skips);
end $function$;

-- 2 ----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tk__ooo_request_access(p_time_off staff_time_off, p_to text, p_client text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_name text;
  v_away text;
  v_span int;
  v_reason text;
begin
  if exists (select 1 from staff_client_access_grants g
              where g.client_id = p_client and lower(g.staff_email) = p_to
                and (g.status = 'pending' or (g.status = 'approved' and g.expires_at > now()))) then
    return;
  end if;
  select s.name into v_name from staff s where lower(s.email) = p_to;
  select coalesce(s.name, p_time_off.staff_email) into v_away from staff s where lower(s.email) = lower(p_time_off.staff_email);
  v_reason := left('Covering for ' || coalesce(v_away, p_time_off.staff_email) || ' (time off ' ||
                   to_char(p_time_off.starts_on, 'Mon DD') || ' to ' || to_char(p_time_off.ends_on, 'Mon DD') || ')', 500);
  -- tk p2 s7 fix (minor a), narrowed by tk p2 minors (2): an admin said no
  -- to the coverage request filed for THIS time off (its dates; the name is
  -- left out so a renamed person still matches); don't ask again. A denial
  -- for anything else no longer blocks it.
  if exists (select 1 from staff_client_access_grants g
              where g.client_id = p_client and lower(g.staff_email) = p_to
                and g.status = 'denied' and g.requested_at >= p_time_off.created_at
                and g.reason like 'Covering for % (time off ' || to_char(p_time_off.starts_on, 'Mon DD')
                                  || ' to ' || to_char(p_time_off.ends_on, 'Mon DD') || ')') then
    return;
  end if;
  v_span := greatest(1, p_time_off.ends_on - greatest(p_time_off.starts_on, (now() at time zone 'America/Chicago')::date) + 1);
  insert into staff_client_access_grants (client_id, staff_email, staff_name, reason, duration_days, status)
  values (p_client, p_to, v_name, v_reason,
          case when v_span <= 1 then 1 when v_span <= 7 then 7 else 30 end,
          'pending');
end $function$;

-- 3 + 6 ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tk__ooo_return(p_time_off_id uuid, p_keep_from date, p_keep_to date, p_dry_run boolean, p_mode text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_detail jsonb;   -- tk p2 minors (6)
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
    v_cur := lower(l.assignee_email);   -- tk p2 s8b fix: assigned only; an emptied task is "changed", never re-assigned
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
    v_detail := jsonb_build_object('left', (select coalesce(jsonb_agg(e - 'title'), '[]'::jsonb) from jsonb_array_elements(v_left) e));
    -- tk p2 s7 fix (minor b): a cron run where only in-review tasks wait logs nothing.
    -- tk p2 minors (3): manual, edit and cancel runs always log, even with
    -- nothing to hand back. (6): a cron run whose only news is the same
    -- error rows as the last return run for this time off logs nothing new.
    if jsonb_array_length(v_back) > 0
       or p_mode <> 'cron'
       or exists (select 1 from jsonb_array_elements(v_left) e where e ->> 'reason' not in ('in_review', 'error'))
       or (exists (select 1 from jsonb_array_elements(v_left) e where e ->> 'reason' = 'error')
           and v_detail is distinct from (select x.detail from tk_ooo_runs x
                                           where x.time_off_id = p_time_off_id and x.action = 'return'
                                           order by x.created_at desc limit 1)) then
      insert into tk_ooo_runs (time_off_id, action, mode, actor, moved, skipped, detail)
      values (p_time_off_id, 'return', p_mode, v_actor, jsonb_array_length(v_back), jsonb_array_length(v_left), v_detail);
    end if;
  end if;
  return jsonb_build_object('dry_run', p_dry_run, 'time_off_id', p_time_off_id, 'returned', v_back, 'left', v_left);
end $function$;

-- 4 ----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tk__request_send_mode(p_client_id text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_on boolean;
  v_live boolean;
  v_test boolean;
  v_internal boolean;
  v_pilot jsonb;
begin
  select enabled, client_request_enabled into v_on, v_live from client_email_settings limit 1;
  if not coalesce(v_on, false) then
    return 'off';
  end if;
  select test_only, is_internal into v_test, v_internal from clients where id = p_client_id;
  if coalesce(v_test, false) then
    return 'test';
  end if;
  -- tk p2 minors (4): MGB itself is never emailed as a client, even with the
  -- pilot set to "all" (the Client emails card already leaves it out).
  if coalesce(v_internal, false) then
    return 'dry_run';
  end if;
  select value into v_pilot from tk_settings where key = 'client_request_pilot';
  if not coalesce(v_live, false)
     or not (v_pilot = '"all"'::jsonb
             or (jsonb_typeof(v_pilot) = 'array' and v_pilot ? p_client_id)) then
    return 'dry_run';
  end if;
  return 'live';
end $function$;

-- 5 ----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tk_period_review_notify()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_me text := lower(coalesce(nullif(auth.jwt() ->> 'email', ''), new.updated_by, ''));
  v_by text;
  v_to text;
  v_rev text;
  v_payload jsonb;
  v_ref text;
  v_since timestamptz;
  v_sent_back boolean;
begin
  if new.status is distinct from 'review' then
    return null;
  end if;
  if tg_op = 'UPDATE' and old.status is not distinct from 'review' then
    return null;
  end if;
  select s.name into v_by from staff s where lower(s.email) = v_me and s.active;
  v_rev := case when public.tk__is_active_admin(new.reviewer_email) then lower(new.reviewer_email) end;
  if v_rev = v_me then v_rev := null; end if;
  v_payload := jsonb_build_object('kind', 'period', 'period', new.period, 'period_kind', coalesce(new.period_kind, 'month'),
                                  'by', coalesce(v_by, 'A teammate'));
  v_ref := new.client_id || '|' || coalesce(new.period_kind, 'month') || '|' || new.period::text;
  -- tk p2 minors (5): back to review within a day re-notifies nobody who
  -- already has this period's notice, unless an admin reopened it since.
  -- An admin who moved it out of review (a send-back) is someone else's
  -- last write: then the next ready always notifies.
  v_since := greatest(now() - interval '24 hours', coalesce(new.reopened_at, '-infinity'::timestamptz));
  v_sent_back := tg_op = 'UPDATE' and public.tk__is_active_admin(old.updated_by)
                 and lower(coalesce(old.updated_by, '')) <> v_me;
  for v_to in
    select lower(s.email) from staff s
     where s.active and s.role = 'admin'
       and lower(s.email) <> v_me
       and (v_rev is null or lower(s.email) = v_rev)
       and (coalesce(v_sent_back, false) or not exists (select 1 from notification_outbox o
                        where o.kind = 'staff_task_review_ready'
                          and o.recipient_email = lower(s.email)
                          and o.ref_id = v_ref
                          and o.created_at >= v_since
                          and coalesce(o.reason, '') <> 'undone'))
  loop
    perform public.tk__enqueue('staff_task_review_ready', v_to, new.client_id, v_ref, v_payload);
  end loop;
  return null;
end $function$;
