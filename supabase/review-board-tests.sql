-- =====================================================================
-- Self-test for review-board.sql. Ends in ROLLBACK, so nothing it writes is
-- kept. Uses the test clients basic-test and grace-community, the internal
-- client, and a far-future period (2031-01) so real tasks never mix in.
-- People are picked at run time; no names or emails live in this file, and
-- no contact value is ever returned (the last select returns 'all ok').
-- Roles simulated: real admin, temp admin, bookkeeper, client user, anon.
-- =====================================================================
begin;

create temp table t_ctx (k text primary key, v text) on commit drop;
grant all on t_ctx to authenticated;
create or replace function pg_temp.ctx(p_k text) returns text language sql as $$ select v from t_ctx where k = p_k $$;
create or replace function pg_temp.as_user(p_email text, p_google boolean default true) returns void language sql as $$
  select set_config('request.jwt.claims',
    case when p_email is null then '' else json_build_object(
      'sub', gen_random_uuid(),
      'email', coalesce((select s.email from staff s where lower(s.email) = lower(p_email) limit 1), p_email),
      'role', 'authenticated',
      'app_metadata', case when p_google then json_build_object('provider', 'google') else json_build_object('provider', 'email') end)::text end, true);
$$;
create or replace function pg_temp.ok(p_cond boolean, p_what text) returns void language plpgsql as $$
begin
  if p_cond is not true then raise exception 'SELF-TEST FAILED: %', p_what; end if;
end $$;
create or replace function pg_temp.expect_err(p_sql text, p_err text, p_what text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if position(p_err in sqlerrm) > 0 or sqlstate = p_err then return; end if;
    raise exception 'SELF-TEST FAILED: % expected %, got % (%)', p_what, p_err, sqlerrm, sqlstate;
  end;
  raise exception 'SELF-TEST FAILED: % expected %, but it succeeded', p_what, p_err;
end $$;
create or replace function pg_temp.mk(p_client text, p_ref text, p_assignee text, p_status text default 'todo') returns uuid language plpgsql as $$
declare v uuid;
begin
  perform set_config('mgb.tk_generate', 'on', true);
  insert into staff_reminders (staff_email, assignee_email, text, client_id, due_date, source, template_id,
                               period_kind, period_start, status, description, visibility)
  select pg_temp.ctx('bk'), p_assignee, 'RBT ' || p_ref, p_client, date '2031-02-14', 'template', t.id,
         'month', date '2031-01-01', p_status, 'Body', 'shared'
    from task_templates t where t.source_ref = p_ref
  returning id into v;
  perform set_config('mgb.tk_generate', '', true);
  return v;
end $$;
-- The board as the current user (runs inside the definer RPC).
create or replace function pg_temp.board() returns jsonb language sql as $$ select public.rb_board(date '2031-01-01') $$;
create or replace function pg_temp.crow(p_client text) returns jsonb language sql as $$
  select c from jsonb_array_elements(pg_temp.board() -> 'clients') c where c ->> 'client_id' = p_client $$;
create or replace function pg_temp.task(p_client text, p_part text) returns jsonb language sql as $$
  select t from jsonb_array_elements(pg_temp.crow(p_client) -> 'tasks') t where t ->> 'part' = p_part $$;
grant execute on function pg_temp.ctx(text), pg_temp.ok(boolean, text), pg_temp.expect_err(text, text, text),
  pg_temp.as_user(text, boolean), pg_temp.board(), pg_temp.crow(text), pg_temp.task(text, text) to authenticated;

-- People ---------------------------------------------------------------------
insert into t_ctx select 'admin', lower(s.email) from staff s
 where s.active and s.role = 'admin'
   and not exists (select 1 from internal_access ia where lower(ia.staff_email) = lower(s.email) and ia.is_owner)
 order by s.email limit 1;
insert into t_ctx select 'bk', lower(s.email) from staff s where s.active and s.role = 'bookkeeper' order by s.email limit 1;
insert into t_ctx select 'ta', lower(s.email) from staff s
 where s.active and s.role = 'bookkeeper' and lower(s.email) <> pg_temp.ctx('bk') order by s.email limit 1;
insert into t_ctx select 'cu', lower(cu.email) from client_users cu where cu.client_id = 'grace-community' and cu.active order by cu.email limit 1;
select pg_temp.ok(pg_temp.ctx('admin') is not null and pg_temp.ctx('bk') is not null and pg_temp.ctx('ta') is not null
                  and pg_temp.ctx('cu') is not null, 'test people found');

-- Access fixtures: admin has no internal access; bk sees basic-test only;
-- the temp admin sees grace-community only.
delete from internal_access where lower(staff_email) = pg_temp.ctx('admin');
delete from staff_client_access where lower(staff_email) in (pg_temp.ctx('bk'), pg_temp.ctx('ta'))
   and client_id in ('basic-test', 'grace-community', 'mygoodbooks');
delete from staff_client_access_grants where lower(staff_email) in (pg_temp.ctx('bk'), pg_temp.ctx('ta'))
   and client_id in ('basic-test', 'grace-community', 'mygoodbooks');
insert into staff_client_access (staff_email, client_id)
select s.email, 'basic-test' from staff s where lower(s.email) = pg_temp.ctx('bk') limit 1;
insert into staff_client_access (staff_email, client_id)
select s.email, 'grace-community' from staff s where lower(s.email) = pg_temp.ctx('ta') limit 1;
delete from staff_temp_admin_access where lower(staff_email) = pg_temp.ctx('ta');
insert into staff_temp_admin_access (staff_email, granted_by, expires_at)
select s.email, pg_temp.ctx('admin'), now() + interval '1 day' from staff s where lower(s.email) = pg_temp.ctx('ta') limit 1;

-- Contact fixtures (fake values only)
delete from client_org_profile where client_id in ('basic-test', 'grace-community');
insert into client_org_profile (client_id, contact_name, contact_email, contact_phone)
values ('basic-test', 'RBT Contact', 'RBT-Contact@Example.test', '555-0100');
insert into client_contacts (client_id, name, email, can_answer_requests, notes)
values ('basic-test', 'RBT Other', 'rbt-other@example.test', true, 'RBT secret note');
insert into client_email_recipients (client_id, email, opted_out_at)
select 'grace-community', pg_temp.ctx('cu'), now()
 where not exists (select 1 from client_email_recipients x where x.client_id = 'grace-community' and lower(x.email) = pg_temp.ctx('cu'));
update client_email_recipients set opted_out_at = now() where client_id = 'grace-community' and lower(email) = pg_temp.ctx('cu');

-- Task fixtures (period 2031-01)
insert into t_ctx values ('b2', pg_temp.mk('basic-test', 'month_rhythm:2_check_in', null)::text);
insert into t_ctx values ('b6', pg_temp.mk('basic-test', 'month_rhythm:6_reports', pg_temp.ctx('bk'))::text);
insert into t_ctx values ('b7', pg_temp.mk('basic-test', 'month_rhythm:7_follow_up', pg_temp.ctx('bk'))::text);
insert into t_ctx values ('b1', pg_temp.mk('basic-test', 'month_rhythm:1_check_in', pg_temp.ctx('bk'))::text);
insert into t_ctx values ('g2', pg_temp.mk('grace-community', 'month_rhythm:2_check_in', pg_temp.ctx('bk'))::text);
insert into t_ctx values ('i2', pg_temp.mk('mygoodbooks', 'month_rhythm:2_check_in', pg_temp.ctx('bk'))::text);
update staff_reminders set assignee_email = null where id = pg_temp.ctx('b2')::uuid;
select pg_temp.ok((select count(*) = 6 from staff_reminders where text like 'RBT %' and period_start = '2031-01-01'), 'fixture tasks made');
select pg_temp.ok((select assignee_email is null and staff_email is not null from staff_reminders where id = pg_temp.ctx('b2')::uuid),
  'fixture: check-in task unassigned with an owner');

-- Done by a staff member, and auto-closed by the system
select set_config('mgb.tk_actor', pg_temp.ctx('bk'), true);
update staff_reminders set status = 'done', done = true, completed_at = now() where id = pg_temp.ctx('b2')::uuid;
select set_config('mgb.tk_actor', 'system', true);
update staff_reminders set status = 'done', done = true, completed_at = now() where id = pg_temp.ctx('b7')::uuid;
select set_config('mgb.tk_actor', '', true);

-- 1. Grants -------------------------------------------------------------------
select pg_temp.ok(not has_function_privilege('anon', 'public.rb_board(date)', 'execute'), 'anon cannot run rb_board');
select pg_temp.ok(not has_function_privilege('anon', 'public.rb_draft_recipients(uuid)', 'execute'), 'anon cannot run rb_draft_recipients');
select pg_temp.ok(not has_function_privilege('anon', 'public.rb_mark_email_sent(uuid,integer)', 'execute')
                  and not has_function_privilege('anon', 'public.rb_unmark_email_sent(uuid)', 'execute'), 'anon cannot mark sent');
select pg_temp.ok(has_function_privilege('authenticated', 'public.rb_board(date)', 'execute')
                  and has_function_privilege('authenticated', 'public.rb_draft_recipients(uuid)', 'execute')
                  and has_function_privilege('authenticated', 'public.rb_mark_email_sent(uuid,integer)', 'execute')
                  and has_function_privilege('authenticated', 'public.rb_unmark_email_sent(uuid)', 'execute'),
  'authenticated can call the four RPCs (each guards itself)');
select pg_temp.ok(not has_function_privilege('authenticated', 'public.rb__require_admin()', 'execute')
                  and not has_function_privilege('anon', 'public.rb__require_admin()', 'execute')
                  and not has_function_privilege('authenticated', 'public.rb__main_contact(text)', 'execute'),
  'internal helpers are not callable');
select pg_temp.ok((select prosecdef and proconfig::text like '%search_path=public%' from pg_proc where oid = 'public.rb_board(date)'::regprocedure)
                  and (select prosecdef and proconfig::text like '%search_path=public%' from pg_proc where oid = 'public.rb_draft_recipients(uuid)'::regprocedure)
                  and (select prosecdef and proconfig::text like '%search_path=public%' from pg_proc where oid = 'public.rb_mark_email_sent(uuid,integer)'::regprocedure),
  'definer + search_path');
select pg_temp.ok(not has_table_privilege('anon', 'public.rb_email_sent', 'select')
                  and not has_table_privilege('authenticated', 'public.rb_email_sent', 'insert')
                  and has_table_privilege('authenticated', 'public.rb_email_sent', 'select'), 'rb_email_sent grants');

set local role authenticated;

-- 2. rb_board as a real admin (no internal access) -----------------------------
select pg_temp.as_user(pg_temp.ctx('admin'));
select pg_temp.ok(jsonb_array_length(pg_temp.board() -> 'clients')
                  = (select count(*) from clients c where (c.lost_at is null or c.lost_at > (now() at time zone 'America/Chicago')::date)
                                                      and not coalesce(c.is_internal, false)),
  'admin gets every current non-internal client');
select pg_temp.ok(pg_temp.crow('mygoodbooks') is null, 'no internal client without internal access');
select pg_temp.ok(pg_temp.crow('citymark-church') is null, 'lost client absent');
select pg_temp.ok((public.rb_board(null) ->> 'period')::date
                  = (date_trunc('month', (now() at time zone 'America/Chicago')::date) - interval '1 month')::date,
  'rb_board(null) = last month');
select pg_temp.ok((public.rb_board(date '2031-01-17') ->> 'period') = '2031-01-01', 'period truncated to month');
select pg_temp.ok(pg_temp.board() ? 'rhythm' and pg_temp.board() ? 'today', 'top-level keys');
select pg_temp.ok((pg_temp.crow('basic-test') -> 'approve') = 'null'::jsonb and pg_temp.crow('basic-test') ? 'approve',
  'approve slot reserved, null');
select pg_temp.ok((pg_temp.crow('basic-test') ->> 'test_only')::boolean, 'test client returned, flagged');
select pg_temp.ok(jsonb_array_length(pg_temp.crow('basic-test') -> 'tasks') = 3, 'three parts, the non-email row 1 ignored');
select pg_temp.ok(pg_temp.task('basic-test', 'check_in') ->> 'id' = pg_temp.ctx('b2')
                  and pg_temp.task('basic-test', 'reports') ->> 'id' = pg_temp.ctx('b6')
                  and pg_temp.task('basic-test', 'follow_up') ->> 'id' = pg_temp.ctx('b7'), 'parts map to the right tasks');
select pg_temp.ok((pg_temp.task('basic-test', 'check_in') -> 'assignee') = 'null'::jsonb
                  and pg_temp.task('basic-test', 'check_in') ->> 'owner' = pg_temp.ctx('bk'),
  'unassigned task: assignee null, owner kept separately');
select pg_temp.ok(pg_temp.task('basic-test', 'check_in') ->> 'status' = 'done'
                  and pg_temp.task('basic-test', 'check_in') ->> 'by' = pg_temp.ctx('bk')
                  and not (pg_temp.task('basic-test', 'check_in') ->> 'auto')::boolean
                  and pg_temp.task('basic-test', 'check_in') ->> 'by_name' is not null,
  'done by a staff member: by = that email');
select pg_temp.ok((pg_temp.task('basic-test', 'follow_up') ->> 'auto')::boolean
                  and pg_temp.task('basic-test', 'follow_up') ->> 'by' = 'system', 'auto-closed by the system');
select pg_temp.ok(pg_temp.task('basic-test', 'reports') ->> 'status' = 'todo'
                  and (pg_temp.task('basic-test', 'reports') -> 'by') = 'null'::jsonb
                  and pg_temp.task('basic-test', 'reports') ->> 'assignee' = pg_temp.ctx('bk')
                  and pg_temp.task('basic-test', 'reports') ->> 'due' = '2031-02-14'
                  and (pg_temp.task('basic-test', 'reports') -> 'sent') = 'null'::jsonb,
  'open task shape');
select pg_temp.ok(pg_temp.crow('basic-test') -> 'contact' ->> 'source' = 'profile'
                  and pg_temp.crow('basic-test') -> 'contact' ->> 'email' = 'rbt-contact@example.test'
                  and pg_temp.crow('basic-test') -> 'contact' ->> 'phone' = '555-0100', 'main contact from the org profile');
select pg_temp.ok(pg_temp.crow('grace-community') -> 'contact' ->> 'source' = 'login'
                  and pg_temp.crow('grace-community') -> 'contact' ->> 'email'
                      = (select lower(u.email) from client_users u where u.client_id = 'grace-community' and u.active
                          order by u.created_at, lower(u.email) limit 1),
  'no profile contact: first active login, source login');
select pg_temp.ok(jsonb_array_length(pg_temp.crow('grace-community') -> 'logins')
                  = (select count(*) from client_users where client_id = 'grace-community'), 'all logins listed, inactive too');
select pg_temp.ok(jsonb_typeof(pg_temp.crow('basic-test') -> 'people') = 'array'
                  and jsonb_typeof(pg_temp.crow('basic-test') -> 'logins') = 'array', 'people/logins are arrays');

-- With internal access, the internal client appears
reset role;
insert into internal_access (staff_email, is_owner) select s.email, false from staff s where lower(s.email) = pg_temp.ctx('admin') limit 1;
set local role authenticated;
select pg_temp.as_user(pg_temp.ctx('admin'));
select pg_temp.ok(pg_temp.crow('mygoodbooks') is not null, 'internal client shown with internal access');
reset role;
delete from internal_access where lower(staff_email) = pg_temp.ctx('admin');
set local role authenticated;

-- 3. rb_board refused for everyone else ----------------------------------------
select pg_temp.as_user(pg_temp.ctx('bk'));
select pg_temp.expect_err($$select public.rb_board(null)$$, '42501', 'bookkeeper refused');
select pg_temp.as_user(pg_temp.ctx('ta'));
select pg_temp.expect_err($$select public.rb_board(null)$$, '42501', 'temp admin refused');
select pg_temp.as_user(pg_temp.ctx('cu'), false);
select pg_temp.expect_err($$select public.rb_board(null)$$, '42501', 'client user refused');
select pg_temp.as_user(pg_temp.ctx('admin'), false);
select pg_temp.expect_err($$select public.rb_board(null)$$, '42501', 'admin email without Google sign-in refused');
select pg_temp.as_user(null);
select pg_temp.expect_err($$select public.rb_board(null)$$, '42501', 'no session refused');

-- 4. rb_draft_recipients ----------------------------------------------------------
select pg_temp.as_user(pg_temp.ctx('admin'));
select pg_temp.ok(public.rb_draft_recipients(pg_temp.ctx('b6')::uuid) -> 'contact' ->> 'source' = 'profile',
  'admin: main contact from the profile');
select pg_temp.ok((select bool_and(not (k ? 'notes')) and count(*) = 1
                     from jsonb_array_elements(public.rb_draft_recipients(pg_temp.ctx('b6')::uuid) -> 'contacts') k)
                  and position('RBT secret note' in public.rb_draft_recipients(pg_temp.ctx('b6')::uuid)::text) = 0,
  'contacts carry no notes');
select pg_temp.ok((public.rb_draft_recipients(pg_temp.ctx('b6')::uuid) -> 'contacts' -> 0 ->> 'can_answer')::boolean,
  'contact can_answer flag');
select pg_temp.ok(jsonb_typeof(public.rb_draft_recipients(pg_temp.ctx('b6')::uuid) -> 'staff') = 'array'
                  and jsonb_typeof(public.rb_draft_recipients(pg_temp.ctx('b6')::uuid) -> 'logins') = 'array', 'staff/logins arrays');
select pg_temp.ok((select bool_or((l ->> 'opted_out')::boolean)
                     from jsonb_array_elements(public.rb_draft_recipients(pg_temp.ctx('g2')::uuid) -> 'logins') l),
  'opted-out login flagged');
select pg_temp.ok(public.rb_draft_recipients(pg_temp.ctx('g2')::uuid) -> 'contact' ->> 'source' = 'login', 'login fallback in drafts');
select pg_temp.expect_err(format('select public.rb_draft_recipients(%L)', pg_temp.ctx('i2')), '42501',
  'admin without internal access refused on the internal client');
select pg_temp.expect_err($$select public.rb_draft_recipients(gen_random_uuid())$$, 'rb_not_found', 'unknown task');
-- Bookkeeper: allowed where they can read contacts today, refused elsewhere
select pg_temp.as_user(pg_temp.ctx('bk'));
select pg_temp.ok(public.rb_draft_recipients(pg_temp.ctx('b6')::uuid) ->> 'client_id' = 'basic-test',
  'bookkeeper with client access: allowed (same as today''s RLS)');
select pg_temp.expect_err(format('select public.rb_draft_recipients(%L)', pg_temp.ctx('g2')), '42501', 'bookkeeper, other client refused');
-- Temp admin: same as a bookkeeper (no admin powers here)
select pg_temp.as_user(pg_temp.ctx('ta'));
select pg_temp.expect_err(format('select public.rb_draft_recipients(%L)', pg_temp.ctx('b6')), '42501', 'temp admin, no client access refused');
select pg_temp.ok(public.rb_draft_recipients(pg_temp.ctx('g2')::uuid) ->> 'client_id' = 'grace-community',
  'temp admin with client access: allowed (same as today''s RLS)');
-- Client user: never
select pg_temp.as_user(pg_temp.ctx('cu'), false);
select pg_temp.expect_err(format('select public.rb_draft_recipients(%L)', pg_temp.ctx('g2')), '42501', 'client user refused');

-- 5. Mark sent ---------------------------------------------------------------------
select pg_temp.as_user(pg_temp.ctx('bk'));
select pg_temp.ok(public.rb_mark_email_sent(pg_temp.ctx('b6')::uuid, 999) ->> 'kind' = 'reports', 'bookkeeper marks own client');
select pg_temp.ok((select count(*) = 1 from rb_email_sent where task_id = pg_temp.ctx('b6')::uuid), 'bookkeeper reads the marker');
select pg_temp.expect_err(format('select public.rb_mark_email_sent(%L, 1)', pg_temp.ctx('g2')), '42501', 'bookkeeper, other client refused');
select pg_temp.expect_err(format('select public.rb_mark_email_sent(%L, 1)', pg_temp.ctx('b1')), 'rb_not_email_task', 'no email kind refused');
select pg_temp.as_user(pg_temp.ctx('cu'), false);
select pg_temp.expect_err(format('select public.rb_mark_email_sent(%L, 1)', pg_temp.ctx('g2')), '42501', 'client user cannot mark');
select pg_temp.ok((select count(*) = 0 from rb_email_sent), 'client user reads no markers');
select pg_temp.expect_err($$insert into rb_email_sent (task_id, client_id, kind, sent_by) select id, client_id, 'reports', 'x' from staff_reminders limit 1$$,
  'permission denied', 'no direct writes');
reset role;
select pg_temp.ok((select to_count = 50 and sent_by = pg_temp.ctx('bk') and kind = 'reports' from rb_email_sent
                    where task_id = pg_temp.ctx('b6')::uuid), 'marker row: clamped count, lowercase sender, derived kind');
set local role authenticated;
select pg_temp.as_user(pg_temp.ctx('admin'));
select pg_temp.ok(pg_temp.task('basic-test', 'reports') -> 'sent' ->> 'by' = pg_temp.ctx('bk')
                  and pg_temp.task('basic-test', 'reports') -> 'sent' ->> 'at' is not null, 'board shows the marker');
select pg_temp.ok(public.rb_mark_email_sent(pg_temp.ctx('b6')::uuid, 2) ->> 'by' = pg_temp.ctx('admin'), 'admin re-mark overwrites');
select pg_temp.as_user(pg_temp.ctx('bk'));
select public.rb_unmark_email_sent(pg_temp.ctx('b6')::uuid);
select pg_temp.ok((select count(*) = 0 from rb_email_sent where task_id = pg_temp.ctx('b6')::uuid), 'undo removes the marker');
select pg_temp.expect_err(format('select public.rb_unmark_email_sent(%L)', pg_temp.ctx('g2')), '42501', 'bookkeeper cannot undo other client');

reset role;

-- Client contacts (client-contacts.sql): a main contact row wins on the board
-- for a test client; contact_list never carries notes.
insert into client_contacts (client_id, name, email, is_main, notes)
values ('basic-test', 'RBT Main', 'rbt-main@example.test', true, 'RBT secret note');
set local role authenticated;
select pg_temp.as_user(pg_temp.ctx('admin'));
select pg_temp.ok(pg_temp.crow('basic-test') -> 'contact' ->> 'source' = 'main'
                  and pg_temp.crow('basic-test') -> 'contact' ->> 'email' = 'rbt-main@example.test',
                  'main contact row wins on the board');
select pg_temp.ok(jsonb_typeof(pg_temp.crow('basic-test') -> 'contact_list') = 'array'
                  and position('RBT secret note' in (pg_temp.crow('basic-test') -> 'contact_list')::text) = 0,
                  'contact_list present, never notes');
reset role;

select pg_temp.as_user(null);
select 'all ok' as result;
rollback;
