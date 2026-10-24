-- =====================================================================
-- Self-test for slate-ix-copy.sql (tk_copy_tasks: Duplicate and Copy/Paste).
--
-- Run it whole after the migration. It ends in ROLLBACK, so nothing it
-- writes is kept. People and clients are picked at run time; no names or
-- emails live in this file. A failed check raises; no error is a pass.
-- The copies are made AS the app role (set local role authenticated), so
-- row level security and the triggers are exercised for real.
-- =====================================================================
begin;

-- People and clients: bk = a bookkeeper, other = an admin; c_in = a client
-- bk can open, c_out = one bk cannot.
select set_config('t.bk', (select lower(s.email) from staff s where s.active and s.role = 'bookkeeper'
  and exists (select 1 from clients c where public.tk_staff_has_client(lower(s.email), c.id)) order by s.email limit 1), true);
select set_config('t.other', (select lower(s.email) from staff s where s.active and s.role = 'admin' order by s.email limit 1), true);
select set_config('t.c_in', (select c.id from clients c where public.tk_staff_has_client(current_setting('t.bk'), c.id) order by c.id limit 1), true);
select set_config('t.c_out', (select c.id from clients c where not public.tk_staff_has_client(current_setting('t.bk'), c.id) order by c.id limit 1), true);
select set_config('t.floor', (select coalesce(max(id), 0)::text from notification_outbox), true);

do $$ begin
  if coalesce(current_setting('t.bk'), '') = '' or coalesce(current_setting('t.other'), '') = ''
     or coalesce(current_setting('t.c_in'), '') = '' or coalesce(current_setting('t.c_out'), '') = '' then
    raise exception 'SELF-TEST FAILED: test people or clients not found';
  end if;
  if has_function_privilege('anon', 'public.tk_copy_tasks(uuid[],jsonb)', 'execute')
     or not has_function_privilege('authenticated', 'public.tk_copy_tasks(uuid[],jsonb)', 'execute') then
    raise exception 'SELF-TEST FAILED: execute grants (anon must not, authenticated must)';
  end if;
  if (select prosecdef from pg_proc where oid = 'public.tk_copy_tasks(uuid[],jsonb)'::regprocedure) then
    raise exception 'SELF-TEST FAILED: tk_copy_tasks must be SECURITY INVOKER';
  end if;
  raise notice 'ok: shape';
end $$;

-- Sources (as the table owner): a recurring client task owned by bk and
-- assigned to someone else, with notes, a subtask and two checklist items
-- (one ticked); a private task of someone else; a no-client private task.
do $$
declare v uuid; v2 uuid; v3 uuid; v4 uuid;
begin
  insert into staff_reminders (staff_email, text, description, client_id, visibility, assignee_email, priority,
                               recurrence, series_id, due_date, status, section)
  values (current_setting('t.bk'), 'IX self-test source', 'the notes', current_setting('t.c_in'), 'shared',
          current_setting('t.other'), 'high', 'monthly', gen_random_uuid(), current_date + 3, 'in_progress', 'Setup')
  returning id into v;
  insert into staff_reminders (staff_email, text, client_id, visibility, parent_id, recurrence)
  values (current_setting('t.bk'), 'IX self-test subtask', current_setting('t.c_in'), 'shared', v, 'none') returning id into v2;
  insert into task_checklist_items (reminder_id, text, done, sort_order) values (v, 'one', true, 1), (v, 'two', false, 2);
  insert into staff_reminders (staff_email, text, visibility) values (current_setting('t.other'), 'IX self-test not yours', 'private') returning id into v3;
  insert into staff_reminders (staff_email, text, visibility) values (current_setting('t.bk'), 'IX self-test no client', 'private') returning id into v4;
  perform set_config('t.src', v::text, true);
  perform set_config('t.sub', v2::text, true);
  perform set_config('t.theirs', v3::text, true);
  perform set_config('t.plain', v4::text, true);
  -- 1b source: a shared client task of bk with a PRIVATE subtask owned by
  -- other and assigned to bk (bk can read it; nobody else on the client can)
  insert into staff_reminders (staff_email, text, client_id, visibility)
  values (current_setting('t.bk'), 'IX self-test parent of private', current_setting('t.c_in'), 'shared') returning id into v;
  insert into staff_reminders (staff_email, text, client_id, visibility, parent_id, assignee_email)
  values (current_setting('t.other'), 'IX self-test private subtask', current_setting('t.c_in'), 'private', v, current_setting('t.bk'));
  perform set_config('t.pparent', v::text, true);
end $$;

-- 1. Duplicate in place, as bk through the app role ------------------------
select set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'email', current_setting('t.bk'),
  'role', 'authenticated', 'app_metadata', json_build_object('provider', 'google'))::text, true);
set local role authenticated;
do $$
declare r jsonb; cp staff_reminders%rowtype; v_copy uuid; n int;
begin
  r := public.tk_copy_tasks(array[current_setting('t.src')::uuid, current_setting('t.src')::uuid, current_setting('t.theirs')::uuid], null);
  if jsonb_array_length(r -> 'copies') <> 1 then raise exception 'SELF-TEST FAILED: one copy expected (deduped), got %', r; end if;
  if (r -> 'skipped' -> 0 ->> 'reason') <> 'no_access' then raise exception 'SELF-TEST FAILED: someone else''s private task must be no_access, got %', r; end if;
  v_copy := (r -> 'copies' -> 0 ->> 'id')::uuid;
  select * into cp from staff_reminders where id = v_copy;
  if cp.id is null then raise exception 'SELF-TEST FAILED: copy not readable by its owner'; end if;
  if lower(cp.staff_email) <> current_setting('t.bk') or cp.text <> 'IX self-test source' or cp.description <> 'the notes'
     or cp.assignee_email <> current_setting('t.other') or cp.priority <> 'high' or cp.client_id <> current_setting('t.c_in')
     or cp.section is distinct from 'Setup' or cp.visibility <> 'shared' then
    raise exception 'SELF-TEST FAILED: kept fields wrong: %', row_to_json(cp);
  end if;
  if cp.status <> 'todo' or cp.done or cp.completed_at is not null or cp.recurrence <> 'none' or cp.series_id is not null
     or cp.template_id is not null or cp.period_kind is not null or cp.close_key is not null or cp.due_date is not null
     or cp.source <> 'manual' or cp.source_ref is not null then
    raise exception 'SELF-TEST FAILED: fresh status / no recurring links: %', row_to_json(cp);
  end if;
  select count(*) into n from staff_reminders where parent_id = v_copy and deleted_at is null;
  if n <> 1 or jsonb_array_length(r -> 'copies' -> 0 -> 'subtasks') <> 1 then raise exception 'SELF-TEST FAILED: one subtask copied, got %', n; end if;
  select count(*) into n from task_checklist_items where reminder_id = v_copy and not done;
  if n <> 2 then raise exception 'SELF-TEST FAILED: checklist copied unchecked, got % open', n; end if;
  perform set_config('t.copy', v_copy::text, true);
  perform set_config('t.copysub', r -> 'copies' -> 0 -> 'subtasks' ->> 0, true);
  raise notice 'ok: duplicate keeps title, notes, assignee, subtasks, checklist; fresh status; no recurring links';
end $$;

-- 1b. A private subtask stays private on the copy (slate-ix-copy-2) ---------
do $$
declare r jsonb; cp staff_reminders%rowtype;
begin
  r := public.tk_copy_tasks(array[current_setting('t.pparent')::uuid], null);
  if jsonb_array_length(r -> 'copies') <> 1 then raise exception 'SELF-TEST FAILED: parent of private not copied: %', r; end if;
  if jsonb_array_length(r -> 'copies' -> 0 -> 'subtasks') = 1 then
    select * into cp from staff_reminders where id = (r -> 'copies' -> 0 -> 'subtasks' ->> 0)::uuid;
    if cp.visibility <> 'private' then
      raise exception 'SELF-TEST FAILED: private subtask widened to % on the copy', cp.visibility;
    end if;
    perform set_config('t.pcase', 'private subtask copied as private', true);
    raise notice 'ok: a private subtask the caller can read is copied as private';
  else
    perform set_config('t.pcase', 'private subtask not readable, not copied', true);
    raise notice 'ok: the private subtask is not readable by the caller, so it is not copied';
  end if;
end $$;

-- 2. Paste targets ------------------------------------------------------------
do $$
declare r jsonb; cp staff_reminders%rowtype;
begin
  -- another section of the same client: allowed, section set
  r := public.tk_copy_tasks(array[current_setting('t.src')::uuid], jsonb_build_object('section', '  Wrap up '));
  select * into cp from staff_reminders where id = (r -> 'copies' -> 0 ->> 'id')::uuid;
  if cp.section is distinct from 'Wrap up' or cp.client_id <> current_setting('t.c_in') or cp.parent_id is not null then
    raise exception 'SELF-TEST FAILED: paste into a section: %', r;
  end if;
  -- another client: refused (moves between clients are out of scope)
  r := public.tk_copy_tasks(array[current_setting('t.src')::uuid], jsonb_build_object('client_id', current_setting('t.c_out')));
  if jsonb_array_length(r -> 'copies') <> 0 or (r -> 'skipped' -> 0 ->> 'reason') <> 'other_client' then
    raise exception 'SELF-TEST FAILED: another client must be other_client, got %', r;
  end if;
  -- a subtask cannot be pasted elsewhere; it can be duplicated in place
  r := public.tk_copy_tasks(array[current_setting('t.sub')::uuid], jsonb_build_object('section', 'X'));
  if (r -> 'skipped' -> 0 ->> 'reason') <> 'subtask' then raise exception 'SELF-TEST FAILED: subtask paste: %', r; end if;
  r := public.tk_copy_tasks(array[current_setting('t.sub')::uuid], null);
  select * into cp from staff_reminders where id = (r -> 'copies' -> 0 ->> 'id')::uuid;
  if cp.parent_id is distinct from current_setting('t.src')::uuid then raise exception 'SELF-TEST FAILED: subtask duplicate stays under its parent: %', r; end if;
  -- a no-client task pasted onto a client bk cannot open: refused by the trigger
  r := public.tk_copy_tasks(array[current_setting('t.plain')::uuid], jsonb_build_object('client_id', current_setting('t.c_out')));
  if (r -> 'skipped' -> 0 ->> 'reason') <> 'no_access' then raise exception 'SELF-TEST FAILED: unreachable client must be no_access, got %', r; end if;
  -- a no-client private copy stays private
  r := public.tk_copy_tasks(array[current_setting('t.plain')::uuid], null);
  select * into cp from staff_reminders where id = (r -> 'copies' -> 0 ->> 'id')::uuid;
  if cp.visibility <> 'private' or cp.client_id is not null then raise exception 'SELF-TEST FAILED: private copy: %', r; end if;
  -- too many
  begin
    perform public.tk_copy_tasks(array(select gen_random_uuid() from generate_series(1, 51)), null);
    raise exception 'SELF-TEST FAILED: 51 ids accepted';
  exception when others then
    if sqlerrm not like '%tk_too_many%' then raise; end if;
  end;
  raise notice 'ok: paste rules (section, other client, subtask, client access, private, cap)';
end $$;

-- 3. Undo archives the copy (tk_bulk_delete, the same soft delete as Delete)
do $$
declare r jsonb;
begin
  r := public.tk_bulk_delete(array[current_setting('t.copy')::uuid, current_setting('t.copysub')::uuid]);
  if jsonb_array_length(r -> 'done') <> 2 then raise exception 'SELF-TEST FAILED: undo of a copy: %', r; end if;
  raise notice 'ok: undo archives the copy and its subtask';
end $$;
reset role;

-- 4. No emails and nothing hard deleted ------------------------------------
do $$
declare n int;
begin
  select count(*) into n from notification_outbox o
   where o.id > current_setting('t.floor')::bigint and o.kind = 'staff_task_assigned'
     and o.ref_id in (select id::text from staff_reminders where text like 'IX self-test%' and lower(staff_email) = current_setting('t.bk')
                         and created_at = now() and id <> current_setting('t.src')::uuid and id <> current_setting('t.sub')::uuid);
  if n <> 0 then raise exception 'SELF-TEST FAILED: % assignment emails queued for copies', n; end if;
  select count(*) into n from staff_reminders where id = current_setting('t.copy')::uuid and deleted_at is not null;
  if n <> 1 then raise exception 'SELF-TEST FAILED: the undone copy must still exist, archived'; end if;
  raise notice 'ok: no assignment emails for copies; the undone copy is archived, not deleted';
end $$;

select 'slate-ix copy self-test passed' as result, current_setting('t.pcase', true) as private_subtask_case;
rollback;
