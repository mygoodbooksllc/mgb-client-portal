-- =====================================================================
-- Self-test for slate-rhythm-4b-daily.sql (slice 4d/4e). Ends in ROLLBACK.
-- Test clients basic-test and grace-community only; people picked at run
-- time. A failed check raises; the last select returns 'all ok'. Last run 2026-10-21: all ok, rolled back.
-- =====================================================================
begin;

create temp table t_ctx (k text primary key, v text) on commit drop;
grant all on t_ctx to authenticated;
create or replace function pg_temp.ctx(p_k text) returns text language sql as $$ select v from t_ctx where k = p_k $$;
create or replace function pg_temp.as_user(p_email text, p_google boolean default true) returns void language sql as $$
  select set_config('request.jwt.claims',
    case when p_email is null then '' else json_build_object(
      'sub', gen_random_uuid(), 'email', p_email, 'role', 'authenticated',
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
    if position(p_err in sqlerrm) > 0 then return; end if;
    raise exception 'SELF-TEST FAILED: % expected %, got %', p_what, p_err, sqlerrm;
  end;
  raise exception 'SELF-TEST FAILED: % expected %, but it succeeded', p_what, p_err;
end $$;
create or replace function pg_temp.mk(p_client text, p_ref text, p_text text, p_status text default 'todo') returns uuid language plpgsql as $$
declare v uuid;
begin
  perform set_config('mgb.tk_generate', 'on', true);
  insert into staff_reminders (staff_email, assignee_email, text, client_id, due_date, source, template_id, period_kind, period_start, status, description)
  select pg_temp.ctx('bk'), pg_temp.ctx('bk'), p_text, p_client, date '2026-10-24', 'template', t.id, 'month', date '2026-09-01', p_status, 'Body'
    from task_templates t where t.source_ref = p_ref
  returning id into v;
  perform set_config('mgb.tk_generate', '', true);
  return v;
end $$;
create or replace function pg_temp.try(p_sql text) returns void language plpgsql as $$
begin
  begin execute p_sql; exception when others then null; end;
end $$;
grant execute on function pg_temp.ctx(text), pg_temp.ok(boolean, text), pg_temp.expect_err(text, text, text),
  pg_temp.as_user(text, boolean), pg_temp.try(text) to authenticated;

insert into t_ctx select 'bk', lower(s.email) from staff s where s.active and s.role = 'bookkeeper' order by s.email limit 1;
insert into t_ctx select 'am', lower(s.email) from staff s where s.active order by (s.role = 'admin') desc, s.email limit 1;
insert into t_ctx select 'cm', lower(cu.email) from client_users cu where cu.client_id = 'grace-community' and cu.active order by cu.email limit 1;
select pg_temp.ok(pg_temp.ctx('bk') is not null and pg_temp.ctx('am') is not null and pg_temp.ctx('cm') is not null, 'test people found');
update clients set account_manager_email = pg_temp.ctx('am') where id = 'basic-test';
update clients set account_manager_email = null where id = 'grace-community';
select set_config('mgb.tk_owner_override', 'on', true);
delete from tk_settings where key = 'month_rhythm_enabled';
select set_config('mgb.tk_owner_override', '', true);
update clients set test_only = false where id = 'grace-community';   -- acts as a real client

-- Both clients: September and August preliminary.
insert into tk_report_state (client_id, period, state, missing, set_by) values
  ('basic-test', '2026-09-01', 'preliminary', '[{"label":"Bank statement","request_id":null}]', 'self-test'),
  ('basic-test', '2026-08-01', 'preliminary', '[{"label":"Bank statement","request_id":null}]', 'self-test'),
  ('grace-community', '2026-09-01', 'preliminary', '[{"label":"Bank statement","request_id":null}]', 'self-test'),
  ('grace-community', '2026-08-01', 'preliminary', '[{"label":"Bank statement","request_id":null}]', 'self-test');
insert into t_ctx values ('b7', pg_temp.mk('basic-test', 'month_rhythm:7_follow_up', 'ST b7')::text);
insert into t_ctx values ('b8', pg_temp.mk('basic-test', 'month_rhythm:8_follow_up', 'ST b8')::text);
insert into t_ctx values ('bw', pg_temp.mk('basic-test', 'month_rhythm:8_follow_up', 'ST bw waiting', 'waiting_client')::text);
insert into t_ctx values ('g7', pg_temp.mk('grace-community', 'month_rhythm:7_follow_up', 'ST g7')::text);
insert into t_ctx values ('g8', pg_temp.mk('grace-community', 'month_rhythm:8_follow_up', 'ST g8')::text);
select pg_temp.ok((select count(*) = 5 from staff_reminders where text like 'ST %'), 'fixture tasks made');
-- An open request on basic-test blocks the auto-complete.
insert into client_requests (client_id, title, prompt, asked_by) values ('basic-test', 'ST open item', 'x', pg_temp.ctx('am'));
insert into t_ctx select 'outbox0', count(*)::text from notification_outbox;

-- 1. Switch off ------------------------------------------------------------
select pg_temp.ok((public.tk_rhythm_daily(date '2026-10-24') ->> 'emails')::int = 0, 'switch off: no emails');
select pg_temp.ok((select count(*) = 0 from tk_rhythm_notices where client_id = 'grace-community'), 'switch off: real client gets no notice');
select pg_temp.ok((select status = 'todo' and description = 'Body' from staff_reminders where id = pg_temp.ctx('g7')::uuid),
  'switch off: real client task untouched');
select pg_temp.ok((select status = 'todo' from staff_reminders where id = pg_temp.ctx('g8')::uuid), 'switch off: real client row 8 untouched');
select pg_temp.ok((select count(*) = 1 and bool_and(recipient_email = pg_temp.ctx('am')) from tk_rhythm_notices where client_id = 'basic-test'),
  'test client: account manager gets one notice');
select pg_temp.ok((select description = 'Second month in a row. Body' from staff_reminders where id = pg_temp.ctx('b7')::uuid),
  'row 7 description gets the prefix');
select pg_temp.ok((select count(*)::text = pg_temp.ctx('outbox0') from notification_outbox), 'switch off: outbox unchanged');
select pg_temp.ok((select status = 'todo' from staff_reminders where id = pg_temp.ctx('b7')::uuid), 'open request: row 7 stays open');
select pg_temp.ok((select status = 'todo' from staff_reminders where id = pg_temp.ctx('b8')::uuid), 'open request: row 8 stays open');

-- 2. Idempotent ---------------------------------------------------------------
select pg_temp.ok((public.tk_rhythm_daily(date '2026-10-24') ->> 'notices')::int = 0, 'second run: no new notices');
select pg_temp.ok((select description = 'Second month in a row. Body' from staff_reminders where id = pg_temp.ctx('b7')::uuid),
  'prefix added once');

-- 3. Nothing outstanding -------------------------------------------------------
update client_requests set status = 'answered' where client_id = 'basic-test' and title = 'ST open item';
update tk_report_state set state = 'none', missing = '[]' where client_id = 'basic-test' and period = '2026-09-01';
select pg_temp.ok((public.tk_rhythm_daily(date '2026-10-24') ->> 'completed')::int = 2, 'two tasks completed');
select pg_temp.ok((select status = 'done' and done and completed_at is not null from staff_reminders where id = pg_temp.ctx('b7')::uuid), 'row 7 done');
select pg_temp.ok((select status = 'done' and done from staff_reminders where id = pg_temp.ctx('b8')::uuid), 'row 8 done');
select pg_temp.ok((select status = 'waiting_client' from staff_reminders where id = pg_temp.ctx('bw')::uuid), 'waiting task untouched');
select pg_temp.ok((select count(*) = 2 and bool_and(author_email = 'system' and kind = 'system' and body = 'Nothing outstanding')
                     from tk_comments where task_id in (pg_temp.ctx('b7')::uuid, pg_temp.ctx('b8')::uuid)),
  'system note on each');
select pg_temp.ok((select state = 'none' from tk_report_state where client_id = 'basic-test' and period = '2026-09-01'),
  'auto-completed row 8 does not mark the month full');
select pg_temp.ok((public.tk_rhythm_daily(date '2026-10-24') ->> 'completed')::int = 0, 'third run completes nothing');
select pg_temp.ok((select count(*) = 2 from tk_comments where task_id in (pg_temp.ctx('b7')::uuid, pg_temp.ctx('b8')::uuid)), 'no duplicate notes');
select pg_temp.ok(current_setting('mgb.tk_rhythm', true) = '' and current_setting('mgb.tk_generate', true) = ''
                  and current_setting('mgb.tk_actor', true) = '', 'flags cleared');

-- 4. Row 8 waits while the month is preliminary -------------------------------
reset role;
insert into t_ctx values ('b8b', pg_temp.mk('basic-test', 'month_rhythm:8_follow_up', 'ST b8b')::text);
update tk_report_state set state = 'preliminary', missing = '[{"label":"x","request_id":null}]' where client_id = 'basic-test' and period = '2026-09-01';
select pg_temp.ok((public.tk_rhythm_daily(date '2026-10-24') ->> 'completed')::int = 0, 'preliminary month: row 8 not auto-completed');
select pg_temp.ok((select status = 'todo' from staff_reminders where id = pg_temp.ctx('b8b')::uuid), 'row 8 still open');

-- 5. Switch on, real client, no account manager -> admins, email queued -------
select set_config('mgb.tk_owner_override', 'on', true);
insert into tk_settings (key, value) values ('month_rhythm_enabled', 'true'::jsonb);
select set_config('mgb.tk_owner_override', '', true);
insert into client_requests (client_id, title, prompt, asked_by) values ('grace-community', 'ST grace item', 'x', pg_temp.ctx('am'));
select public.tk_rhythm_daily(date '2026-10-24');
select pg_temp.ok((select count(*) = (select count(*) from staff where active and role = 'admin') and count(*) > 0
                     from tk_rhythm_notices where task_id = pg_temp.ctx('g7')::uuid),
  'no account manager: every active admin gets a notice');
select pg_temp.ok((select count(*) from notification_outbox where kind = 'staff_task_batch' and ref_id = 'rhythm_second:' || pg_temp.ctx('g7'))
                  = (select count(*) from tk_rhythm_notices where task_id = pg_temp.ctx('g7')::uuid),
  'switch on: one email per notice');
select pg_temp.ok((select bool_and(payload ->> 'hash' ~ '^#/tasks/my\?item=task:[0-9a-f-]{36}$' and octet_length(payload::text) < 4096
                                   and payload ->> 'title' not like '%!%')
                     from notification_outbox where ref_id = 'rhythm_second:' || pg_temp.ctx('g7')),
  'email payload shape');
select pg_temp.ok((select status = 'todo' from staff_reminders where id = pg_temp.ctx('g7')::uuid), 'open request: grace row 7 open');
select pg_temp.ok((select count(*) = 0 from notification_outbox where ref_id = 'rhythm_second:' || pg_temp.ctx('b7')),
  'test client never emails');

-- 6. Who reads notices ---------------------------------------------------------
set local role authenticated;
select pg_temp.as_user(pg_temp.ctx('am'));
select pg_temp.ok((select count(*) >= 1 from tk_rhythm_notices) and (select bool_and(recipient_email = pg_temp.ctx('am')) from tk_rhythm_notices),
  'staff read only their own notices');
select pg_temp.expect_err($$insert into tk_rhythm_notices (recipient_email, client_id, period, task_id) values ('x', 'basic-test', '2026-09-01', gen_random_uuid())$$,
  'permission denied', 'staff cannot write notices');
select pg_temp.expect_err($$select public.tk_rhythm_daily()$$, 'permission denied', 'staff cannot run the job');
select pg_temp.as_user(pg_temp.ctx('cm'), false);
select pg_temp.ok((select count(*) = 0 from tk_rhythm_notices), 'client reads no notices');
select pg_temp.as_user(pg_temp.ctx('bk'));
select pg_temp.try($$insert into tk_comments (task_id, body, kind) select id, 'x', 'system' from staff_reminders where text = 'ST b8b'$$);
select set_config('mgb.tk_rhythm', 'on', true);   -- even with the job flag set, a signed-in person never writes as system
select pg_temp.try($$insert into tk_comments (task_id, body, kind) select id, 'x', 'system' from staff_reminders where text = 'ST b8b'$$);
select set_config('mgb.tk_rhythm', '', true);
reset role;
select pg_temp.ok((select count(*) = 0 from tk_comments where author_email = 'system' and body = 'x'), 'staff cannot write as system');

select 'all ok' as result;
rollback;
