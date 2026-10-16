-- =====================================================================
-- Self-test for tasks-h0-private-visibility.sql.
--
-- Run it whole; it ends in ROLLBACK, so nothing it writes is kept and no
-- email is sent. People are picked at run time; no names or emails live
-- here. A failed check raises.
--
-- Proves, on a throwaway test client where A and B both have access:
--   tk_waiting_on_client
--   - B never gets the text, id, owner, status or due date of A's private
--     task, with or without a client filter; a request on A's private task
--     still shows to B with every task field null; a private task waiting
--     with no request is not returned to B at all.
--   - Shared tasks and task-less requests show to B as before.
--   - Existing rules still let people in: A (owner), an admin, B as the
--     assignee of a private task, B as a follower of a private task.
--   - With B given access to every client that holds a private task, no
--     row carries a private task B cannot read (covers the live one).
--   - The result columns are unchanged.
--   client_health
--   - B's "overdue tasks" count skips A's private overdue task; A and the
--     admin still count it.
--   tk_search (audited, unchanged): B cannot find A's private task.
--   Neither function is executable by anon.
-- =====================================================================
begin;

create temp table t_ctx (k text primary key, v text) on commit drop;
grant select, insert on t_ctx to authenticated, anon;

create or replace function pg_temp.ctx(p_k text) returns text language sql as $$ select v from t_ctx where k = p_k $$;
create or replace function pg_temp.id(p_k text) returns uuid language sql as $$ select v::uuid from t_ctx where k = p_k $$;
create or replace function pg_temp.as_user(p_email text) returns void language sql as $$
  select set_config('request.jwt.claims',
    case when p_email is null then '' else json_build_object(
      'sub', gen_random_uuid(),
      'email', coalesce((select s.email from staff s where lower(s.email) = lower(p_email) limit 1), p_email),
      'role', 'authenticated', 'app_metadata', json_build_object('provider', 'google'))::text end, true);
$$;
create or replace function pg_temp.ok(p_cond boolean, p_what text) returns void language plpgsql as $$
begin
  if p_cond is not true then raise exception 'SELF-TEST FAILED: %', p_what; end if;
  raise notice 'ok: %', p_what;
end $$;
create or replace function pg_temp.expect_err(p_sql text, p_err text, p_what text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if position(p_err in sqlerrm) > 0 then raise notice 'ok: % (%)', p_what, p_err; return; end if;
    raise exception 'SELF-TEST FAILED: % expected %, got %', p_what, p_err, sqlerrm;
  end;
  raise exception 'SELF-TEST FAILED: % expected %, but it succeeded', p_what, p_err;
end $$;

-- tk_waiting_on_client as a user, through the authenticated role (like the app).
create temp table t_w (
  task_id uuid, title text, client_id text, client_name text, assignee_email text, task_status text, due_date date,
  request_id uuid, request_title text, request_kind text, asked_at timestamptz, asked_by text, business_days_waiting integer,
  nudge_count integer, last_nudged_at timestamptz, nudge_paused boolean, no_reply boolean, recipients integer
) on commit drop;
grant select, insert, delete on t_w to authenticated;
create or replace function pg_temp.wait(p_email text, p_client text) returns void language plpgsql as $$
begin
  delete from t_w;
  perform pg_temp.as_user(p_email);
  set local role authenticated;
  insert into t_w select * from public.tk_waiting_on_client(p_client);
  reset role;
  perform pg_temp.as_user(null);
end $$;
create or replace function pg_temp.has_task(p_key text) returns boolean language sql as $$
  select exists (select 1 from t_w where task_id = pg_temp.id(p_key))
$$;
create or replace function pg_temp.req(p_key text) returns t_w language sql as $$
  select * from t_w where request_id = pg_temp.id(p_key) limit 1
$$;
create or replace function pg_temp.secret_text() returns boolean language sql as $$
  select exists (select 1 from t_w where title like 'H0 secret%')
$$;
-- client_health "overdue" label for the test client, as a user.
create temp table t_h (label text) on commit drop;
grant select, insert, delete on t_h to authenticated;
create or replace function pg_temp.overdue(p_email text) returns text language plpgsql as $$
declare v text;
begin
  delete from t_h;
  perform pg_temp.as_user(p_email);
  set local role authenticated;
  insert into t_h
  select e ->> 'label' from public.client_health() h, jsonb_array_elements(h.reasons) e
   where h.client_id = 'h0-test-1' and e ->> 'key' = 'overdue';
  reset role;
  perform pg_temp.as_user(null);
  select label into v from t_h limit 1;
  return coalesce(v, 'none');
end $$;
create or replace function pg_temp.search_hits(p_email text, p_q text) returns int language plpgsql as $$
declare n int;
begin
  perform pg_temp.as_user(p_email);
  set local role authenticated;
  select count(*) into n from public.tk_search(p_q, 50) x where x.task_text like 'H0 secret%';
  reset role;
  perform pg_temp.as_user(null);
  return n;
end $$;

-- People: a1 = active admin; A, B = two active bookkeepers (not admins).
insert into t_ctx select 'a1', lower(email) from staff where active and role = 'admin' order by email limit 1;
insert into t_ctx select 'A', lower(email) from staff where active and role = 'bookkeeper' order by email limit 1;
insert into t_ctx select 'B', lower(email) from staff where active and role = 'bookkeeper' order by email offset 1 limit 1;
select pg_temp.ok(pg_temp.ctx('a1') is not null and pg_temp.ctx('A') is not null and pg_temp.ctx('B') is not null,
                  'test people found');

-- Shape guard: the result columns did not change.
select pg_temp.ok(pg_get_function_result('public.tk_waiting_on_client(text)'::regprocedure)
  = 'TABLE(task_id uuid, title text, client_id text, client_name text, assignee_email text, task_status text, due_date date, '
    'request_id uuid, request_title text, request_kind text, asked_at timestamp with time zone, asked_by text, '
    'business_days_waiting integer, nudge_count integer, last_nudged_at timestamp with time zone, nudge_paused boolean, '
    'no_reply boolean, recipients integer)', 'tk_waiting_on_client columns unchanged');

-- Access guards.
set local role anon;
select pg_temp.expect_err($$select * from public.tk_waiting_on_client(null)$$, 'permission denied', 'anon cannot execute tk_waiting_on_client');
select pg_temp.expect_err($$select * from public.client_health()$$, 'permission denied', 'anon cannot execute client_health');
reset role;

-- A test client: A and B both have access.
insert into clients (id, name, org_type, test_only, assigned_bookkeeper_email)
select 'h0-test-1', 'H0 test client', org_type, true, pg_temp.ctx('A') from clients where id = 'basic-test';
insert into staff_client_access (staff_email, client_id)
select s.email, 'h0-test-1' from staff s where lower(s.email) in (pg_temp.ctx('A'), pg_temp.ctx('B'))
on conflict do nothing;

create or replace function pg_temp.task(p_key text, p_owner text, p_to text, p_vis text, p_status text, p_due date)
returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into staff_reminders (staff_email, assignee_email, text, client_id, due_date, visibility, kind, status)
  values (p_owner, p_to, case when p_vis = 'private' then 'H0 secret ' else 'H0 shared ' end || p_key,
          'h0-test-1', p_due, p_vis, 'task', p_status)
  returning id into v;
  insert into t_ctx values (p_key, v::text);
  return v;
end $$;
create or replace function pg_temp.ask(p_key text, p_task text, p_title text) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into client_requests (client_id, task_id, kind, title, prompt, asked_by)
  values ('h0-test-1', pg_temp.id(p_task), 'question', p_title, 'H0 prompt', pg_temp.ctx('A'))
  returning id into v;
  insert into t_ctx values (p_key, v::text);
  return v;
end $$;

select pg_temp.task('P_wait',   pg_temp.ctx('A'),  pg_temp.ctx('A'), 'private', 'waiting_client', current_date + 10);
select pg_temp.task('P_req',    pg_temp.ctx('A'),  pg_temp.ctx('A'), 'private', 'waiting_client', current_date + 10);
select pg_temp.task('P_follow', pg_temp.ctx('A'),  pg_temp.ctx('A'), 'private', 'waiting_client', current_date + 10);
select pg_temp.task('P_mine',   pg_temp.ctx('a1'), pg_temp.ctx('B'), 'private', 'waiting_client', current_date + 10);
select pg_temp.task('S_wait',   pg_temp.ctx('A'),  pg_temp.ctx('A'), 'shared',  'waiting_client', current_date + 10);
select pg_temp.task('S_req',    pg_temp.ctx('A'),  pg_temp.ctx('A'), 'shared',  'waiting_client', current_date + 10);
select pg_temp.task('P_late',   pg_temp.ctx('A'),  pg_temp.ctx('A'), 'private', 'todo', current_date - 3);
select pg_temp.task('S_late',   pg_temp.ctx('A'),  pg_temp.ctx('A'), 'shared',  'todo', current_date - 3);
select pg_temp.ask('R_priv',   'P_req',  'H0 ask on a private task');
select pg_temp.ask('R_shared', 'S_req',  'H0 ask on a shared task');
select pg_temp.ask('R_none',   'none',   'H0 ask with no task');
insert into tk_followers (task_id, staff_email, added_by) values (pg_temp.id('P_follow'), pg_temp.ctx('B'), pg_temp.ctx('A'))
on conflict do nothing;
select pg_temp.ok((select count(*) = 5 from staff_reminders where client_id = 'h0-test-1' and visibility = 'private'),
                  'private test tasks stayed private on insert');

-- 1. B (client access, not owner) -----------------------------------------------
select pg_temp.wait(pg_temp.ctx('B'), 'h0-test-1');
select pg_temp.ok(not pg_temp.has_task('P_wait') and not pg_temp.has_task('P_req') and not pg_temp.has_task('P_late'),
                  'B gets no id of A''s private tasks');
select pg_temp.ok(not exists (select 1 from t_w where title like 'H0 secret%'
                               and task_id not in (pg_temp.id('P_follow'), pg_temp.id('P_mine'))),
                  'B gets no text of A''s private tasks');
select pg_temp.ok((pg_temp.req('R_priv')).request_id is not null
                  and (pg_temp.req('R_priv')).request_title = 'H0 ask on a private task'
                  and (pg_temp.req('R_priv')).task_id is null and (pg_temp.req('R_priv')).title is null
                  and (pg_temp.req('R_priv')).assignee_email is null and (pg_temp.req('R_priv')).task_status is null
                  and (pg_temp.req('R_priv')).due_date is null,
                  'B still sees the request on A''s private task, with every task field null');
select pg_temp.ok(pg_temp.has_task('S_wait') and (pg_temp.req('R_shared')).task_id = pg_temp.id('S_req')
                  and (pg_temp.req('R_shared')).title = 'H0 shared S_req'
                  and (pg_temp.req('R_shared')).assignee_email = pg_temp.ctx('A'),
                  'B sees shared tasks and their requests as before');
select pg_temp.ok((pg_temp.req('R_none')).request_id is not null and (pg_temp.req('R_none')).task_id is null,
                  'B sees a task-less request');
select pg_temp.ok(pg_temp.has_task('P_follow'), 'B follows a private task, so B sees it (existing rule)');
select pg_temp.ok(pg_temp.has_task('P_mine'), 'B is the assignee of a private task, so B sees it (existing rule)');
select pg_temp.ok((select count(*) from t_w) = 6, 'B gets exactly 6 rows (S_wait, R_shared, R_none, R_priv, P_follow, P_mine)');

select pg_temp.wait(pg_temp.ctx('B'), null);
select pg_temp.ok(not pg_temp.has_task('P_wait') and not pg_temp.has_task('P_req')
                  and not exists (select 1 from t_w where title in ('H0 secret P_wait', 'H0 secret P_req')),
                  'B with no client filter gets none of A''s private tasks either');
select pg_temp.ok((pg_temp.req('R_priv')).request_id is not null and (pg_temp.req('R_priv')).task_id is null,
                  'B with no client filter still gets the request, task fields null');

-- 2. A (owner) and the admin --------------------------------------------------------
select pg_temp.wait(pg_temp.ctx('A'), 'h0-test-1');
select pg_temp.ok(pg_temp.has_task('P_wait') and (pg_temp.req('R_priv')).task_id = pg_temp.id('P_req')
                  and (pg_temp.req('R_priv')).title = 'H0 secret P_req'
                  and (pg_temp.req('R_priv')).task_status = 'waiting_client',
                  'A (owner) sees own private tasks with their text');
select pg_temp.ok(not pg_temp.has_task('P_mine'), 'A does not see the admin''s private task assigned to B');
select pg_temp.wait(pg_temp.ctx('a1'), 'h0-test-1');
select pg_temp.ok(pg_temp.has_task('P_wait') and pg_temp.has_task('P_mine')
                  and (pg_temp.req('R_priv')).task_id = pg_temp.id('P_req'),
                  'an admin still sees private tasks (existing tasks RLS rule)');

-- 3. Every client that holds a private task (covers the live one) ------------------
insert into staff_client_access (staff_email, client_id)
select distinct (select s.email from staff s where lower(s.email) = pg_temp.ctx('B')), r.client_id
  from staff_reminders r
 where r.visibility = 'private' and r.client_id is not null and r.deleted_at is null
on conflict do nothing;
select pg_temp.wait(pg_temp.ctx('B'), null);
select pg_temp.ok(not exists (
  select 1 from t_w w join staff_reminders r on r.id = w.task_id
   where r.visibility = 'private'
     and lower(r.staff_email) <> pg_temp.ctx('B')
     and lower(coalesce(r.assignee_email, '')) <> pg_temp.ctx('B')
     and not exists (select 1 from tk_followers f where f.task_id = r.id and lower(f.staff_email) = pg_temp.ctx('B'))),
  'with access to every client holding a private task, B gets none B cannot read');
select pg_temp.ok(not exists (
  select 1 from t_w w join client_requests q on q.id = w.request_id join staff_reminders r on r.id = q.task_id
   where r.visibility = 'private' and w.title is not distinct from r.text
     and lower(r.staff_email) <> pg_temp.ctx('B')
     and lower(coalesce(r.assignee_email, '')) <> pg_temp.ctx('B')
     and not exists (select 1 from tk_followers f where f.task_id = r.id and lower(f.staff_email) = pg_temp.ctx('B'))),
  'no request row carries the text of a private task B cannot read');

-- 4. client_health overdue count --------------------------------------------------
select pg_temp.ok(pg_temp.overdue(pg_temp.ctx('B')) = '1 overdue task', 'B''s overdue count skips A''s private task');
select pg_temp.ok(pg_temp.overdue(pg_temp.ctx('A')) = '2 overdue tasks', 'A''s overdue count includes A''s private task');
select pg_temp.ok(pg_temp.overdue(pg_temp.ctx('a1')) = '2 overdue tasks', 'the admin''s overdue count includes it');

-- 5. tk_search (audited, unchanged) -------------------------------------------------
select pg_temp.ok(pg_temp.search_hits(pg_temp.ctx('B'), 'H0 secret P_late') = 0, 'B cannot find A''s private task');
select pg_temp.ok(pg_temp.search_hits(pg_temp.ctx('A'), 'H0 secret P_late') >= 1, 'A finds own private task');

rollback;
