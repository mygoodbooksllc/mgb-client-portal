-- =====================================================================
-- Self-test for review-board-sent-read.sql. Ends in ROLLBACK. Uses the test
-- client basic-test and a far-future period (2031-01). People are picked at
-- run time; no names or emails live in this file and no contact value is
-- returned (the last select returns 'all ok').
-- =====================================================================
begin;

create temp table t_ctx (k text primary key, v text) on commit drop;
grant all on t_ctx to authenticated;
create or replace function pg_temp.ctx(p_k text) returns text language sql as $$ select v from t_ctx where k = p_k $$;
create or replace function pg_temp.as_user(p_email text) returns void language sql as $$
  select set_config('request.jwt.claims',
    case when p_email is null then '' else json_build_object(
      'sub', gen_random_uuid(),
      'email', coalesce((select s.email from staff s where lower(s.email) = lower(p_email) limit 1), p_email),
      'role', 'authenticated',
      'app_metadata', json_build_object('provider', 'google'))::text end, true);
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
grant execute on function pg_temp.ctx(text), pg_temp.ok(boolean, text), pg_temp.expect_err(text, text, text),
  pg_temp.as_user(text) to authenticated;

insert into t_ctx select 'admin', lower(s.email) from staff s where s.active and s.role = 'admin' order by s.email limit 1;
insert into t_ctx select 'bk', lower(s.email) from staff s where s.active and s.role = 'bookkeeper' order by s.email limit 1;
select pg_temp.ok(pg_temp.ctx('admin') is not null and pg_temp.ctx('bk') is not null, 'test people found');
-- The bookkeeper has no access to basic-test in this transaction.
delete from staff_client_access where lower(staff_email) = pg_temp.ctx('bk') and client_id = 'basic-test';
delete from staff_client_access_grants where lower(staff_email) = pg_temp.ctx('bk') and client_id = 'basic-test';

select set_config('mgb.tk_generate', 'on', true);
with r as (
  insert into staff_reminders (staff_email, assignee_email, text, client_id, due_date, source, template_id,
                               period_kind, period_start, status, description, visibility)
  select pg_temp.ctx('admin'), pg_temp.ctx('admin'), 'RBS reports', 'basic-test', date '2031-02-14', 'template', t.id,
         'month', date '2031-01-01', 'todo', 'Body', 'shared'
    from task_templates t where t.source_ref = 'month_rhythm:6_reports'
  returning id)
insert into t_ctx select 'task', r.id::text from r;
select set_config('mgb.tk_generate', '', true);
select pg_temp.ok(pg_temp.ctx('task') is not null, 'fixture task made');

-- 1. Grants unchanged
select pg_temp.ok(not has_function_privilege('anon', 'public.rb_draft_recipients(uuid)', 'execute'), 'anon cannot run rb_draft_recipients');
select pg_temp.ok(has_function_privilege('authenticated', 'public.rb_draft_recipients(uuid)', 'execute'), 'authenticated can run rb_draft_recipients');
select pg_temp.ok((select prosecdef and proconfig @> array['search_path=public'] from pg_proc where oid = 'public.rb_draft_recipients(uuid)'::regprocedure),
  'definer with search_path public');

set local role authenticated;

-- 2. Not marked: sent is null, every earlier key still there
select pg_temp.as_user(pg_temp.ctx('admin'));
select pg_temp.ok((select (d ? 'sent') and d -> 'sent' = 'null'::jsonb and (d ? 'contact') and (d ? 'contacts') and (d ? 'logins')
                          and (d ? 'staff') and d ->> 'client_id' = 'basic-test'
                     from (select public.rb_draft_recipients(pg_temp.ctx('task')::uuid) d) x), 'unmarked: sent null, keys kept');

-- 3. Marked: who and when come back
select public.rb_mark_email_sent(pg_temp.ctx('task')::uuid, 2);
select pg_temp.ok((select d -> 'sent' ->> 'by' = pg_temp.ctx('admin') and (d -> 'sent' ->> 'at') is not null and (d -> 'sent' ? 'by_name')
                     from (select public.rb_draft_recipients(pg_temp.ctx('task')::uuid) d) x), 'marked: sent by me with a time');

-- 4. Undo: back to null
select public.rb_unmark_email_sent(pg_temp.ctx('task')::uuid);
select pg_temp.ok((select d -> 'sent' = 'null'::jsonb from (select public.rb_draft_recipients(pg_temp.ctx('task')::uuid) d) x), 'undo: sent null');

-- 5. Access unchanged: bookkeeper without access, client session, no session
select pg_temp.as_user(pg_temp.ctx('bk'));
select pg_temp.expect_err(format('select public.rb_draft_recipients(%L::uuid)', pg_temp.ctx('task')), '42501', 'bookkeeper without access');
select pg_temp.as_user(null);
select pg_temp.expect_err(format('select public.rb_draft_recipients(%L::uuid)', pg_temp.ctx('task')), '42501', 'no session');

reset role;
select 'all ok' as result;
rollback;
