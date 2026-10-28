-- =====================================================================
-- Self-test for supabase/slateplus-workload.sql (Slate plus workload strip).
-- Run it whole, AFTER the migration; it ends in ROLLBACK, so the two test
-- tasks it adds are never kept. People are picked at run time. A failed check
-- raises and stops the run. Never touches tk_settings.
-- =====================================================================
begin;

create or replace function pg_temp.as_user(p_email text) returns void language sql as $$
  select set_config('request.jwt.claims',
    case when p_email is null then '' else json_build_object(
      'sub', gen_random_uuid(), 'email', p_email,
      'role', 'authenticated', 'app_metadata', json_build_object('provider', 'google'))::text end, true);
$$;
create or replace function pg_temp.ok(p_cond boolean, p_what text) returns void language plpgsql as $$
begin
  if p_cond is not true then raise exception 'SELF-TEST FAILED: %', p_what; end if;
  raise notice 'ok: %', p_what;
end $$;

do $t$
declare
  v_admin text; v_plain text; v_am text; v_active int; v_n int; v_me int;
  r record; r2 record; v_failed boolean;
begin
  select lower(email) into v_admin from staff where active and role = 'admin' order by email limit 1;
  select lower(s.email) into v_plain from staff s
   where s.active and s.role <> 'admin'
     and not exists (select 1 from clients c where lower(c.account_manager_email) = lower(s.email)
                       and not coalesce(c.is_internal, false) and not coalesce(c.test_only, false))
   order by s.email limit 1;
  select lower(s.email) into v_am from staff s
   where s.active and s.role <> 'admin'
     and exists (select 1 from clients c where lower(c.account_manager_email) = lower(s.email)
                   and not coalesce(c.is_internal, false) and not coalesce(c.test_only, false))
   order by s.email limit 1;
  select count(*) into v_active from staff where active;
  perform pg_temp.ok(v_admin is not null and v_plain is not null, 'found an admin and a plain staff member');

  -- 1. Shape: counts only, no client or task fields.
  perform pg_temp.ok(pg_get_function_result('public.tk_slateplus_workload()'::regprocedure) =
    'TABLE(staff_id uuid, email text, name text, role text, is_me boolean, open_count integer, due_week integer, late_count integer, week_start date, week_end date)',
    'result columns are counts only');
  perform pg_temp.ok(not has_function_privilege('anon', 'public.tk_slateplus_workload()', 'execute'), 'anon cannot execute');
  perform pg_temp.ok(has_function_privilege('authenticated', 'public.tk_slateplus_workload()', 'execute'), 'authenticated can execute');

  -- 2. Admin sees every active staff member, exactly one is_me.
  perform pg_temp.as_user(v_admin);
  select count(*), count(*) filter (where is_me) into v_n, v_me from public.tk_slateplus_workload();
  perform pg_temp.ok(v_n = v_active and v_me = 1, 'admin sees all ' || v_active || ' active staff');
  perform pg_temp.ok(not exists (select 1 from public.tk_slateplus_workload() w
                                  where (w.late_count is null) <> (public.tk_late_count_from() is null)),
    'late_count is null exactly while late tasks do not count');
  perform pg_temp.ok(not exists (select 1 from public.tk_slateplus_workload() w
                                  where w.due_week > w.open_count or w.open_count < 0 or w.week_end - w.week_start <> 6
                                     or extract(isodow from w.week_start) <> 1),
    'due_week <= open, week is Monday..Sunday');

  -- 3. Plain staff sees only their own row.
  perform pg_temp.as_user(v_plain);
  select count(*), count(*) filter (where is_me) into v_n, v_me from public.tk_slateplus_workload();
  perform pg_temp.ok(v_n = 1 and v_me = 1, 'plain staff sees only themselves');

  -- 4. Account manager (if any non-admin AM exists) sees everyone.
  if v_am is not null then
    perform pg_temp.as_user(v_am);
    select count(*) into v_n from public.tk_slateplus_workload();
    perform pg_temp.ok(v_n = v_active, 'account manager sees all active staff');
  end if;

  -- 5. Not signed in / not staff: refused.
  perform pg_temp.as_user(null);
  v_failed := false;
  begin perform * from public.tk_slateplus_workload(); exception when insufficient_privilege then v_failed := true; end;
  perform pg_temp.ok(v_failed, 'no session is refused');
  perform pg_temp.as_user('nobody-' || gen_random_uuid() || '@example.com');
  v_failed := false;
  begin perform * from public.tk_slateplus_workload(); exception when insufficient_privilege then v_failed := true; end;
  perform pg_temp.ok(v_failed, 'non-staff email is refused');

  -- 6. Counting rules: a shared task on a real client due today counts (open + this
  --    week); a private one counts only on the owner's own row; a task on a
  --    test client never counts.
  perform pg_temp.as_user(v_admin);
  select * into r from public.tk_slateplus_workload() w where w.email = v_plain;
  perform set_config('mgb.tk_selftest', '1', true);
  insert into staff_reminders (staff_email, assignee_email, text, due_date, done, kind, status, visibility, client_id)
  select v_plain, v_plain, '[selftest] workload shared', (now() at time zone 'America/Chicago')::date, false, 'task', 'todo', 'shared', c.id
    from clients c where not coalesce(c.test_only, false) and not coalesce(c.is_internal, false) order by c.id limit 1;
  insert into staff_reminders (staff_email, assignee_email, text, due_date, done, kind, status, visibility)
  values (v_plain, v_plain, '[selftest] workload private', (now() at time zone 'America/Chicago')::date, false, 'task', 'todo', 'private');
  if exists (select 1 from clients where test_only and not coalesce(is_internal, false)) then
    insert into staff_reminders (staff_email, assignee_email, text, due_date, done, kind, status, visibility, client_id)
    select v_plain, v_plain, '[selftest] workload test client', (now() at time zone 'America/Chicago')::date, false, 'task', 'todo', 'shared', c.id
      from clients c where c.test_only and not coalesce(c.is_internal, false) order by c.id limit 1;
  end if;
  select * into r2 from public.tk_slateplus_workload() w where w.email = v_plain;
  perform pg_temp.ok(r2.open_count = r.open_count + 1 and r2.due_week = r.due_week + 1,
    'admin view: shared task counts once; private and test-client tasks do not');
  perform pg_temp.as_user(v_plain);
  select * into r2 from public.tk_slateplus_workload() w where w.is_me;
  perform pg_temp.ok(r2.open_count >= r.open_count + 2, 'own row counts own private task');
end $t$;

rollback;
