-- =====================================================================
-- Self-test for slateplus-deps.sql (task dependencies, "Blocked by").
-- Run whole after the migration: npx supabase db query --linked -f this file.
-- Ends in ROLLBACK; nothing it writes is kept. People/clients are picked at
-- run time. A failed check raises; no error is a pass.
-- =====================================================================
begin;

select set_config('t.bk', (select lower(s.email) from staff s where s.active and s.role = 'bookkeeper'
  and exists (select 1 from clients c where public.tk_staff_has_client(lower(s.email), c.id)) order by s.email limit 1), true);
select set_config('t.adm', (select lower(s.email) from staff s where s.active and s.role = 'admin' order by s.email limit 1), true);
select set_config('t.c_in', (select c.id from clients c where public.tk_staff_has_client(current_setting('t.bk'), c.id)
  and public.tk_staff_has_client(current_setting('t.adm'), c.id) order by c.id limit 1), true);

do $$ begin
  if coalesce(current_setting('t.bk'), '') = '' or coalesce(current_setting('t.adm'), '') = '' or coalesce(current_setting('t.c_in'), '') = '' then
    raise exception 'SELF-TEST FAILED: test people or client not found';
  end if;
  if has_function_privilege('anon', 'public.tk_dep_add(uuid,uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.tk_dep_add(uuid,uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.tk__dep_link(uuid,uuid,text,text)', 'execute') then
    raise exception 'SELF-TEST FAILED: execute grants';
  end if;
  if has_table_privilege('anon', 'public.tk_task_deps', 'select')
     or has_table_privilege('authenticated', 'public.tk_task_deps', 'insert')
     or has_table_privilege('authenticated', 'public.tk_dep_notices', 'insert') then
    raise exception 'SELF-TEST FAILED: table grants';
  end if;
  if exists (select 1 from pg_class where relname in ('tk_task_deps', 'tk_dep_events', 'tk_dep_notices') and not relrowsecurity) then
    raise exception 'SELF-TEST FAILED: RLS off';
  end if;
  raise notice 'ok: shape';
end $$;

-- Tasks (as owner): A and A2 block B. B is the bookkeeper's, assigned to the admin.
do $$
declare a uuid; a2 uuid; b uuid; p uuid;
begin
  insert into staff_reminders (staff_email, assignee_email, text, client_id, kind, visibility, status, done)
  values (current_setting('t.bk'), current_setting('t.bk'), 'DEP self-test A', current_setting('t.c_in'), 'task', 'shared', 'todo', false) returning id into a;
  insert into staff_reminders (staff_email, assignee_email, text, client_id, kind, visibility, status, done)
  values (current_setting('t.bk'), current_setting('t.bk'), 'DEP self-test A2', current_setting('t.c_in'), 'task', 'shared', 'todo', false) returning id into a2;
  insert into staff_reminders (staff_email, assignee_email, text, client_id, kind, visibility, status, done)
  values (current_setting('t.bk'), current_setting('t.adm'), 'DEP self-test B', current_setting('t.c_in'), 'task', 'shared', 'todo', false) returning id into b;
  insert into staff_reminders (staff_email, assignee_email, text, client_id, kind, visibility, status, done)
  values (current_setting('t.adm'), current_setting('t.adm'), 'DEP self-test private', null, 'task', 'private', 'todo', false) returning id into p;
  perform set_config('t.a', a::text, true);
  perform set_config('t.a2', a2::text, true);
  perform set_config('t.b', b::text, true);
  perform set_config('t.p', p::text, true);
end $$;

-- As the bookkeeper.
select set_config('request.jwt.claims', json_build_object('email', current_setting('t.bk'), 'role', 'authenticated', 'app_metadata', json_build_object('provider', 'google'))::text, true);
set local role authenticated;

do $$
declare r jsonb; ok boolean;
begin
  r := public.tk_dep_add(current_setting('t.b')::uuid, current_setting('t.a')::uuid);
  if r ->> 'status' <> 'linked' or (r ->> 'open')::int <> 1 then raise exception 'SELF-TEST FAILED: add %', r; end if;
  r := public.tk_dep_add(current_setting('t.b')::uuid, current_setting('t.a2')::uuid);
  if (r ->> 'open')::int <> 2 then raise exception 'SELF-TEST FAILED: add 2 %', r; end if;
  r := public.tk_dep_add(current_setting('t.b')::uuid, current_setting('t.a')::uuid);
  if r ->> 'status' <> 'exists' then raise exception 'SELF-TEST FAILED: idempotent add %', r; end if;
  ok := false;
  begin perform public.tk_dep_add(current_setting('t.a')::uuid, current_setting('t.b')::uuid);
  exception when others then ok := sqlerrm like 'tk_dep_cycle%'; end;
  if not ok then raise exception 'SELF-TEST FAILED: cycle not refused'; end if;
  ok := false;
  begin perform public.tk_dep_add(current_setting('t.a')::uuid, current_setting('t.a')::uuid);
  exception when others then ok := sqlerrm like 'tk_dep_self%'; end;
  if not ok then raise exception 'SELF-TEST FAILED: self not refused'; end if;
  -- bk cannot read the admin's private task
  ok := false;
  begin perform public.tk_dep_add(current_setting('t.b')::uuid, current_setting('t.p')::uuid);
  exception when others then ok := sqlerrm like 'tk_forbidden%'; end;
  if not ok then raise exception 'SELF-TEST FAILED: unreadable blocker not refused'; end if;
  -- direct writes are not allowed
  ok := false;
  begin insert into tk_task_deps (task_id, blocker_id) values (current_setting('t.a')::uuid, current_setting('t.a2')::uuid);
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'SELF-TEST FAILED: direct insert allowed'; end if;
  raise notice 'ok: add, idempotent, cycle, self, unreadable, no direct insert';
end $$;

do $$
declare ok boolean; r jsonb; n int;
begin
  ok := false;
  begin update staff_reminders set done = true, status = 'done' where id = current_setting('t.b')::uuid;
  exception when others then ok := sqlerrm like 'tk_blocked: Blocked by 2 unfinished tasks%'; end;
  if not ok then raise exception 'SELF-TEST FAILED: done not guarded'; end if;
  ok := false;
  begin perform public.tk_set_status(current_setting('t.b')::uuid, 'in_progress', null, current_date);
  exception when others then ok := sqlerrm like 'tk_blocked%'; end;
  if not ok then raise exception 'SELF-TEST FAILED: start not guarded'; end if;
  r := public.tk_bulk_complete(array[current_setting('t.b')::uuid], current_date);
  if coalesce(r::text, '') not like '%blocked%' then raise exception 'SELF-TEST FAILED: bulk skip reason %', r; end if;
  select count(*) into n from staff_reminders where id = current_setting('t.b')::uuid and done;
  if n <> 0 then raise exception 'SELF-TEST FAILED: bulk completed a blocked task'; end if;
  -- waiting on client is not guarded
  perform public.tk_set_status(current_setting('t.b')::uuid, 'waiting_client', null, current_date);
  perform public.tk_set_status(current_setting('t.b')::uuid, 'todo', null, current_date);
  raise notice 'ok: guard on done, start, bulk; waiting allowed';
end $$;

-- Complete blockers: one notice for the admin (assignee), once.
do $$
declare n int;
begin
  perform public.tk_set_status(current_setting('t.a')::uuid, 'done', null, current_date);
  select count(*) into n from tk_dep_notices where task_id = current_setting('t.b')::uuid;
  if n <> 0 then raise exception 'SELF-TEST FAILED: notice before the last blocker'; end if;
  perform public.tk_set_status(current_setting('t.a2')::uuid, 'done', null, current_date);
  if (select count(*)::int from public.tk_dep_list(array[current_setting('t.b')::uuid]) l where l.task_id = current_setting('t.b')::uuid and l.overridden_at is null and not l.blocker_done and not l.blocker_deleted) <> 0 then raise exception 'SELF-TEST FAILED: still blocked'; end if;
  perform public.tk_set_status(current_setting('t.a2')::uuid, 'todo', null, current_date);
  if (select count(*)::int from public.tk_dep_list(array[current_setting('t.b')::uuid]) l where l.task_id = current_setting('t.b')::uuid and l.overridden_at is null and not l.blocker_done and not l.blocker_deleted) <> 1 then raise exception 'SELF-TEST FAILED: reopen does not re-block'; end if;
  perform public.tk_set_status(current_setting('t.a2')::uuid, 'done', null, current_date);
  raise notice 'ok: unblock, reopen re-blocks';
end $$;

reset role;
do $$
declare n int;
begin
  select count(*) into n from tk_dep_notices where task_id = current_setting('t.b')::uuid and recipient_email = current_setting('t.adm');
  if n <> 1 then raise exception 'SELF-TEST FAILED: expected exactly one notice, got %', n; end if;
  select count(*) into n from notification_outbox where ref_id = current_setting('t.b') and created_at = now() and kind ilike '%ready%';
  if n <> 0 then raise exception 'SELF-TEST FAILED: an email was queued'; end if;
  raise notice 'ok: exactly one in-app notice, no email';
end $$;

-- Override: bookkeeper refused, admin allowed and logged.
do $$
begin
  perform public.tk_set_status(current_setting('t.a')::uuid, 'todo', null, current_date);
end $$;
select set_config('request.jwt.claims', json_build_object('email', current_setting('t.bk'), 'role', 'authenticated', 'app_metadata', json_build_object('provider', 'google'))::text, true);
set local role authenticated;
do $$
declare ok boolean := false;
begin
  begin perform public.tk_dep_override(current_setting('t.b')::uuid, 'testing override');
  exception when others then ok := sqlerrm like 'tk_forbidden%'; end;
  if not ok then raise exception 'SELF-TEST FAILED: bookkeeper override allowed'; end if;
  if (select count(*) from public.tk_dep_list(array[current_setting('t.b')::uuid])) <> 2 then
    raise exception 'SELF-TEST FAILED: bk list count';
  end if;
end $$;
select set_config('request.jwt.claims', json_build_object('email', current_setting('t.adm'), 'role', 'authenticated', 'app_metadata', json_build_object('provider', 'google'))::text, true);
do $$
declare r jsonb;
begin
  -- admin links the private task, then bk must see it masked
  perform public.tk_dep_add(current_setting('t.b')::uuid, current_setting('t.p')::uuid);
  r := public.tk_dep_override(current_setting('t.b')::uuid, 'month already reviewed');
  if (r ->> 'overridden')::int <> 2 then raise exception 'SELF-TEST FAILED: override count %', r; end if;
  if (select count(*)::int from public.tk_dep_list(array[current_setting('t.b')::uuid]) l where l.task_id = current_setting('t.b')::uuid and l.overridden_at is null and not l.blocker_done and not l.blocker_deleted) <> 0 then raise exception 'SELF-TEST FAILED: override did not clear'; end if;
end $$;
select set_config('request.jwt.claims', json_build_object('email', current_setting('t.bk'), 'role', 'authenticated', 'app_metadata', json_build_object('provider', 'google'))::text, true);
do $$
declare v text; rd boolean;
begin
  select blocker_text, blocker_readable into v, rd from public.tk_dep_list(array[current_setting('t.b')::uuid]) where blocker_id = current_setting('t.p')::uuid;
  if v is not null or rd then raise exception 'SELF-TEST FAILED: private blocker title leaked'; end if;
  update staff_reminders set done = true, status = 'done' where id = current_setting('t.b')::uuid;
  raise notice 'ok: override admin only, masked title, done after override';
end $$;

-- A client-side (non-staff) caller sees nothing.
select set_config('request.jwt.claims', json_build_object('email', 'someone@example.com', 'role', 'authenticated', 'app_metadata', json_build_object('provider', 'google'))::text, true);
do $$ begin
  if (select count(*) from public.tk_dep_list(null)) <> 0 or (select count(*) from public.tk_dep_my_notices(14)) <> 0
     or (select count(*) from tk_task_deps) <> 0 then
    raise exception 'SELF-TEST FAILED: non-staff can see deps';
  end if;
  raise notice 'ok: non-staff see nothing';
end $$;
reset role;

-- Cron / no user: guard is skipped.
select set_config('request.jwt.claims', '', true);
do $$
begin
  update staff_reminders set done = false, status = 'todo' where id = current_setting('t.a')::uuid;
  update tk_task_deps set overridden_at = null where task_id = current_setting('t.b')::uuid;
  update staff_reminders set done = false, status = 'todo' where id = current_setting('t.b')::uuid;
  update staff_reminders set done = true, status = 'done' where id = current_setting('t.b')::uuid;
  raise notice 'ok: no signed-in staff = no guard';
exception when others then
  raise exception 'SELF-TEST FAILED: guard fired without a user: %', sqlerrm;
end $$;

-- Template wiring (insert order both ways, parallel steps, other client ignored).
do $$
declare s uuid; t1 uuid; t1b uuid; t2 uuid; x1 uuid; x1b uuid; x2 uuid; y2 uuid; n int; cl2 text;
begin
  insert into tk_template_sets (name) values ('DEP self-test set') returning id into s;
  insert into task_templates (title, cadence, template_set_id, status, active, dep_step)
  values ('DEP step 1', 'monthly', s, 'draft', false, 1) returning id into t1;
  insert into task_templates (title, cadence, template_set_id, status, active, dep_step)
  values ('DEP step 1b', 'monthly', s, 'draft', false, 1) returning id into t1b;
  insert into task_templates (title, cadence, template_set_id, status, active, dep_step)
  values ('DEP step 2', 'monthly', s, 'draft', false, 2) returning id into t2;
  select id into cl2 from clients where id <> current_setting('t.c_in') order by id limit 1;
  -- step 2 first, then step 1 and 1b
  insert into staff_reminders (staff_email, assignee_email, text, client_id, kind, visibility, status, done, template_id, period_kind, period_start, source)
  values (current_setting('t.bk'), current_setting('t.bk'), 'DEP gen 2', current_setting('t.c_in'), 'task', 'shared', 'todo', false, t2, 'month', '2026-09-01', 'template') returning id into x2;
  insert into staff_reminders (staff_email, assignee_email, text, client_id, kind, visibility, status, done, template_id, period_kind, period_start, source)
  values (current_setting('t.bk'), current_setting('t.bk'), 'DEP gen 1', current_setting('t.c_in'), 'task', 'shared', 'todo', false, t1, 'month', '2026-09-01', 'template') returning id into x1;
  insert into staff_reminders (staff_email, assignee_email, text, client_id, kind, visibility, status, done, template_id, period_kind, period_start, source)
  values (current_setting('t.bk'), current_setting('t.bk'), 'DEP gen 1b', current_setting('t.c_in'), 'task', 'shared', 'todo', false, t1b, 'month', '2026-09-01', 'template') returning id into x1b;
  -- same step 2 for another client and another month: must not link to x1
  insert into staff_reminders (staff_email, assignee_email, text, client_id, kind, visibility, status, done, template_id, period_kind, period_start, source)
  values (current_setting('t.bk'), current_setting('t.bk'), 'DEP gen 2 other', cl2, 'task', 'shared', 'todo', false, t2, 'month', '2026-09-01', 'template') returning id into y2;
  select count(*) into n from tk_task_deps where task_id = x2 and blocker_id in (x1, x1b) and source = 'template';
  if n <> 2 then raise exception 'SELF-TEST FAILED: template wiring %', n; end if;
  select count(*) into n from tk_task_deps where task_id = y2;
  if n <> 0 then raise exception 'SELF-TEST FAILED: wired across clients'; end if;
  select count(*) into n from tk_task_deps where task_id in (x1, x1b);
  if n <> 0 then raise exception 'SELF-TEST FAILED: step 1 should not wait'; end if;
  raise notice 'ok: template wiring';
end $$;

-- Templates without a step and tasks without deps behave as before.
do $$
declare n int;
begin
  select count(*) into n from task_templates where dep_step is not null and title not like 'DEP step%';
  if n <> 0 then raise exception 'SELF-TEST FAILED: existing templates have a step'; end if;
  if public.tk__bulk_reason('tk_in_review x') <> 'in_review' or public.tk__bulk_reason('boom') <> 'error'
     or public.tk__bulk_reason('tk_blocked: Blocked by 1 unfinished task') <> 'blocked' then
    raise exception 'SELF-TEST FAILED: bulk reason mapping';
  end if;
  raise notice 'ok: inert for existing data';
end $$;

-- Review follow-ups: resume is not a start; a status-only completion still
-- notifies; close order links are removed by admins only.
do $$
declare q uuid; r uuid; x1 uuid; x2 uuid;
begin
  insert into staff_reminders (staff_email, assignee_email, text, client_id, kind, visibility, status, done)
  values (current_setting('t.bk'), current_setting('t.bk'), 'DEP self-test Q', current_setting('t.c_in'), 'task', 'shared', 'todo', false) returning id into q;
  insert into staff_reminders (staff_email, assignee_email, text, client_id, kind, visibility, status, done)
  values (current_setting('t.bk'), current_setting('t.adm'), 'DEP self-test R', current_setting('t.c_in'), 'task', 'shared', 'ready_for_review', false) returning id into r;
  perform public.tk__dep_link(r, q, 'manual', null);
  select id into x1 from staff_reminders where text = 'DEP gen 1';
  select id into x2 from staff_reminders where text = 'DEP gen 2';
  perform set_config('t.q', q::text, true);
  perform set_config('t.r', r::text, true);
  perform set_config('t.x1', x1::text, true);
  perform set_config('t.x2', x2::text, true);
end $$;
select set_config('request.jwt.claims', json_build_object('email', current_setting('t.bk'), 'role', 'authenticated', 'app_metadata', json_build_object('provider', 'google'))::text, true);
set local role authenticated;
do $$
declare ok boolean := false;
begin
  -- back from review to in progress (send back / withdraw) is allowed
  update staff_reminders set status = 'in_progress' where id = current_setting('t.r')::uuid;
  update staff_reminders set status = 'waiting_client' where id = current_setting('t.r')::uuid;
  update staff_reminders set status = 'in_progress' where id = current_setting('t.r')::uuid;
  begin perform public.tk_dep_remove(current_setting('t.x2')::uuid, current_setting('t.x1')::uuid);
  exception when others then ok := sqlerrm like 'tk_forbidden: only an admin%'; end;
  if not ok then raise exception 'SELF-TEST FAILED: bookkeeper removed a close order link'; end if;
  -- status-only completion of the last blocker
  update staff_reminders set status = 'done' where id = current_setting('t.q')::uuid;
  raise notice 'ok: resume allowed, template link admin-only';
exception when others then
  if sqlerrm like 'SELF-TEST FAILED%' then raise; end if;
  raise exception 'SELF-TEST FAILED: review follow-ups: %', sqlerrm;
end $$;
reset role;
do $$
begin
  if (select count(*) from tk_dep_notices where task_id = current_setting('t.r')::uuid and recipient_email = current_setting('t.adm')) <> 1 then
    raise exception 'SELF-TEST FAILED: status-only completion sent no notice (done=%)',
      (select done from staff_reminders where id = current_setting('t.q')::uuid);
  end if;
  raise notice 'ok: status-only completion notifies';
end $$;

select 'slateplus deps self-test passed' as result;
rollback;
