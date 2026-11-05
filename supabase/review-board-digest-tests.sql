-- =====================================================================
-- Self-test for review-board-digest.sql. Ends in ROLLBACK, so nothing it
-- writes is kept (switch rows, tasks and digest rows included). Uses the test
-- clients basic-test and grace-community, the internal client, one real
-- client picked at run time, and a far-future period (2031-01) so real tasks
-- never fall in the window. People are picked at run time; no names or emails
-- live in this file. The last select returns 'all ok'.
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
create or replace function pg_temp.mk(p_client text, p_ref text, p_due date) returns uuid language plpgsql as $$
declare v uuid;
begin
  perform set_config('mgb.tk_generate', 'on', true);
  insert into staff_reminders (staff_email, assignee_email, text, client_id, due_date, source, template_id,
                               period_kind, period_start, status, description, visibility)
  select pg_temp.ctx('bk'), pg_temp.ctx('bk'), 'RBD ' || p_ref, p_client, p_due, 'template', t.id,
         'month', date '2031-01-01', 'todo', 'Body', 'shared'
    from task_templates t where t.source_ref = p_ref
  returning id into v;
  perform set_config('mgb.tk_generate', '', true);
  return v;
end $$;
create or replace function pg_temp.setting(p_key text, p_value jsonb) returns void language plpgsql as $$
begin
  perform set_config('mgb.tk_owner_override', 'on', true);
  delete from tk_settings where key = p_key;
  if p_value is not null then insert into tk_settings (key, value) values (p_key, p_value); end if;
  perform set_config('mgb.tk_owner_override', '', true);
end $$;
create or replace function pg_temp.run(p_today date) returns int language sql as $$
  select (public.rb_deadline_digest(p_today) ->> 'rows')::int $$;
create or replace function pg_temp.row1() returns tk_rhythm_notices language sql as $$
  select n from tk_rhythm_notices n
   where n.kind = 'deadline_digest' and n.recipient_email = pg_temp.ctx('a1') and n.period = '2031-01-01' and n.part = 'reports' $$;
grant execute on function pg_temp.ctx(text), pg_temp.ok(boolean, text), pg_temp.expect_err(text, text, text),
  pg_temp.as_user(text, boolean) to authenticated;

-- People and a real client ------------------------------------------------------
insert into t_ctx select 'a1', lower(s.email) from staff s where s.active and s.role = 'admin' order by s.email limit 1;
insert into t_ctx select 'bk', lower(s.email) from staff s where s.active and s.role = 'bookkeeper' order by s.email limit 1;
insert into t_ctx select 'real', c.id from clients c
 where not coalesce(c.test_only, false) and not coalesce(c.is_internal, false) and c.lost_at is null order by c.id limit 1;
select pg_temp.ok(pg_temp.ctx('a1') is not null and pg_temp.ctx('bk') is not null and pg_temp.ctx('real') is not null,
  'test people and client found');
select pg_temp.setting('reviewboard_digest_enabled', null);
select pg_temp.setting('reviewboard_digest_to', null);
select pg_temp.setting('month_rhythm_enabled', null);

-- Tasks: reports (due 2031-02-14) on two test clients and the internal client
insert into t_ctx values ('t1', pg_temp.mk('basic-test', 'month_rhythm:6_reports', date '2031-02-14')::text);
insert into t_ctx values ('t2', pg_temp.mk('grace-community', 'month_rhythm:6_reports', date '2031-02-14')::text);
insert into t_ctx values ('t3', pg_temp.mk('mygoodbooks', 'month_rhythm:6_reports', date '2031-02-14')::text);
select pg_temp.ok((select count(*) = 3 from staff_reminders where text like 'RBD %'), 'fixture tasks made');
insert into t_ctx select 'n0', count(*)::text from tk_rhythm_notices;

-- 1. Gates: switch off / list missing / empty / wrong type -> nothing written ---------
select pg_temp.ok(pg_temp.run(date '2031-02-15') = 0, 'switch missing: 0 rows');
select pg_temp.ok(public.rb_deadline_digest(date '2031-02-15') ->> 'skipped' = 'off', 'switch missing: skipped off');
select pg_temp.setting('reviewboard_digest_to', jsonb_build_array(pg_temp.ctx('a1')));
select pg_temp.setting('reviewboard_digest_enabled', 'false'::jsonb);
select pg_temp.ok(pg_temp.run(date '2031-02-15') = 0, 'switch false: 0 rows');
select pg_temp.setting('reviewboard_digest_enabled', 'true'::jsonb);
select pg_temp.setting('reviewboard_digest_to', null);
select pg_temp.ok(pg_temp.run(date '2031-02-15') = 0, 'list missing: 0 rows');
select pg_temp.setting('reviewboard_digest_to', '[]'::jsonb);
select pg_temp.ok(pg_temp.run(date '2031-02-15') = 0, 'list empty: 0 rows');
select pg_temp.setting('reviewboard_digest_to', to_jsonb(pg_temp.ctx('a1')));
select pg_temp.ok(pg_temp.run(date '2031-02-15') = 0, 'list not an array: 0 rows');
select pg_temp.ok((select count(*)::text = pg_temp.ctx('n0') from tk_rhythm_notices), 'gates wrote nothing');

-- 2. On: duplicate (any case), non-admin and unknown emails -> one row per part ------
select pg_temp.setting('reviewboard_digest_to',
  jsonb_build_array(pg_temp.ctx('a1'), upper(pg_temp.ctx('a1')), ' ' || pg_temp.ctx('a1') || ' ',
                    pg_temp.ctx('bk'), 'nobody-rbd@example.test'));
select pg_temp.ok(pg_temp.run(date '2031-02-15') = 1, 'first run: one row (one part, one recipient)');
select pg_temp.ok((select count(*) = 1 from tk_rhythm_notices where kind = 'deadline_digest' and period = '2031-01-01'),
  'duplicate emails give one row; non-admin and unknown ignored');
select pg_temp.ok((pg_temp.row1()).counts = '{"total":3,"done":0,"not_needed":0,"open":3,"test_tasks":3,"test":true}'::jsonb,
  'counts: test and internal clients counted, test flag on');
select pg_temp.ok((pg_temp.row1()).task_id is null and (pg_temp.row1()).client_id is null and (pg_temp.row1()).updated_at is not null,
  'digest row shape');
insert into t_ctx select 'id', (pg_temp.row1()).id::text;
insert into t_ctx select 'created', (pg_temp.row1()).created_at::text;
select pg_temp.ok(pg_temp.run(date '2031-02-15') = 0, 'unchanged re-run writes nothing');

-- 3. Status changes refresh the same row ----------------------------------------
select set_config('mgb.tk_actor', pg_temp.ctx('bk'), true);
update staff_reminders set status = 'done', done = true, completed_at = now() where id = pg_temp.ctx('t1')::uuid;
select set_config('mgb.tk_actor', 'system', true);
update staff_reminders set status = 'done', done = true, completed_at = now() where id = pg_temp.ctx('t2')::uuid;
select set_config('mgb.tk_actor', '', true);
select pg_temp.ok(pg_temp.run(date '2031-02-16') = 1, 'second run: one row updated');
select pg_temp.ok((pg_temp.row1()).id::text = pg_temp.ctx('id') and (pg_temp.row1()).created_at::text = pg_temp.ctx('created'),
  'same row id, created_at kept');
select pg_temp.ok((pg_temp.row1()).counts = '{"total":3,"done":2,"not_needed":1,"open":1,"test_tasks":3,"test":true}'::jsonb,
  'counts updated: done includes not needed');

-- 4. A real client joins: test flag off, test tasks still counted ----------------
insert into t_ctx values ('t4', pg_temp.mk(pg_temp.ctx('real'), 'month_rhythm:6_reports', date '2031-02-14')::text);
select pg_temp.ok(pg_temp.run(date '2031-02-16') = 1, 'real client task refreshes the row');
select pg_temp.ok((pg_temp.row1()).counts = '{"total":4,"done":2,"not_needed":1,"open":2,"test_tasks":3,"test":false}'::jsonb,
  'mixed: total 4, test_tasks 3, test false');

-- 5. Rhythm switch on: test-client tasks are still counted (owner decision) -------
select pg_temp.setting('month_rhythm_enabled', 'true'::jsonb);
select pg_temp.ok(pg_temp.run(date '2031-02-16') = 0, 'rhythm on: same counts, nothing rewritten');
select pg_temp.ok(((pg_temp.row1()).counts ->> 'total')::int = 4, 'rhythm on: test clients still counted');
select pg_temp.setting('month_rhythm_enabled', null);

-- 6. Window: due day .. +9 days; other parts wait for their own window ------------
select pg_temp.ok(pg_temp.run(date '2031-02-13') = 0, 'day before the due date: nothing new');
select pg_temp.ok(pg_temp.run(date '2031-02-24') = 0, 'ten days after: out of the window');
insert into t_ctx values ('t5', pg_temp.mk('basic-test', 'month_rhythm:7_follow_up', date '2031-02-24')::text);
select pg_temp.ok(pg_temp.run(date '2031-02-24') = 1, 'follow-up window opens on its due day');
select pg_temp.ok((select count(*) = 2 from tk_rhythm_notices where kind = 'deadline_digest' and period = '2031-01-01'
                     and part in ('reports', 'follow_up')), 'one row per part');

-- 7. Lost clients are not counted --------------------------------------------------
update clients set lost_at = date '2031-01-01' where id = pg_temp.ctx('real');
select pg_temp.ok(pg_temp.run(date '2031-02-16') = 1, 'lost client drops out');
select pg_temp.ok(((pg_temp.row1()).counts ->> 'total')::int = 3 and ((pg_temp.row1()).counts ->> 'test')::boolean,
  'lost client not counted');

-- 8. Table shape: old kind unchanged, bad digest rows refused ------------------------
insert into tk_rhythm_notices (recipient_email, client_id, period, task_id)
values (pg_temp.ctx('a1'), 'basic-test', '2031-01-01', pg_temp.ctx('t1')::uuid);
select pg_temp.ok((select kind = 'second_preliminary' and part is null from tk_rhythm_notices where task_id = pg_temp.ctx('t1')::uuid),
  'old second_preliminary insert still works');
select pg_temp.expect_err($$insert into tk_rhythm_notices (recipient_email, period, kind) values ('x@example.test', '2031-01-01', 'second_preliminary')$$,
  'tk_rhythm_notices_shape', 'second_preliminary without a task refused');
select pg_temp.expect_err($$insert into tk_rhythm_notices (recipient_email, period, kind, part) values ('x@example.test', '2031-01-01', 'deadline_digest', 'reports')$$,
  'tk_rhythm_notices_shape', 'digest without counts refused');
select pg_temp.expect_err($$insert into tk_rhythm_notices (recipient_email, period, kind, part, counts) values ('x@example.test', '2031-01-01', 'deadline_digest', '14th', '{}')$$,
  'tk_rhythm_notices_shape', 'digest with a day as part refused');
select pg_temp.expect_err(format('insert into tk_rhythm_notices (recipient_email, period, kind, part, counts, task_id) values (%L, %L, %L, %L, %L, %L)',
                                 'x@example.test', '2031-01-01', 'deadline_digest', 'reports', '{}', pg_temp.ctx('t1')),
  'tk_rhythm_notices_shape', 'digest with a task refused');
select pg_temp.expect_err($$insert into tk_rhythm_notices (recipient_email, period, kind, part, counts) values ('x@example.test', '2031-01-01', 'other', 'reports', '{}')$$,
  'tk_rhythm_notices_kind_check', 'unknown kind refused');

-- 9. Who can run it and who reads the rows ------------------------------------------
select pg_temp.ok(not has_function_privilege('authenticated', 'public.rb_deadline_digest(date)', 'execute')
                  and not has_function_privilege('anon', 'public.rb_deadline_digest(date)', 'execute'),
  'authenticated and anon cannot run the digest');
set local role authenticated;
select pg_temp.as_user(pg_temp.ctx('a1'));
select pg_temp.ok((select count(*) >= 2 and bool_and(recipient_email = pg_temp.ctx('a1'))
                     from tk_rhythm_notices where kind = 'deadline_digest'), 'recipient reads own digest rows');
select pg_temp.expect_err($$select public.rb_deadline_digest()$$, 'permission denied', 'staff cannot run the digest');
select pg_temp.as_user(pg_temp.ctx('bk'));
select pg_temp.ok((select count(*) = 0 from tk_rhythm_notices where kind = 'deadline_digest'), 'others read no digest rows');
reset role;
select pg_temp.as_user(null);

-- 10. Cron job ---------------------------------------------------------------------
select pg_temp.ok((select count(*) = 1 and bool_and(schedule = '50 10 * * *' and command like '%rb_deadline_digest()%' and active)
                     from cron.job where jobname = 'review-board-digest'), 'cron job scheduled 50 10 * * *');

select 'all ok' as result;
rollback;
