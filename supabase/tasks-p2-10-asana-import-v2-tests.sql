-- =====================================================================
-- Self-test for tasks-p2-10-asana-import-v2.sql (S8b owner decisions).
--
-- Run it whole; it ends in ROLLBACK, so nothing it writes is kept (the
-- apply switch it turns on inside the transaction, the synthetic run, the
-- throwaway client, the tasks) and no email is sent. It never talks to
-- Asana. People are picked at run time; no names or emails live here.
-- A failed check raises and stops.
--
-- Proves: unassigned imported tasks stay unassigned (owner kept), a normal
-- insert still defaults the assignee, a non-owner cannot take a task by a
-- plain update, tk_claim_task can (and only on an unassigned task the
-- caller may see), no email for any of it, templates mirror the Asana
-- assignee/due rule and link the open task as the current period (the
-- generator then says "exists"), the cadence lock ignores that link and a
-- cadence change unlinks it, No team yet lists and assign_team hands the
-- parked tasks over, undo clears the links.
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
create or replace function pg_temp.outbox() returns bigint language sql as $$ select count(*) from notification_outbox $$;
create or replace function pg_temp.task(p_gid text) returns staff_reminders language sql as $$
  select * from staff_reminders where source = 'asana' and source_ref = p_gid
$$;
create or replace function pg_temp.tpl(p_gid text) returns task_templates language sql as $$
  select * from task_templates where source = 'asana' and source_ref = p_gid
$$;

-- People: a1, a2 = active admins (a2 is the fallback); bk1, bk2, bk3 = active non-admin staff.
insert into t_ctx select 'a1', lower(email) from staff where active and role = 'admin' order by email limit 1;
insert into t_ctx select 'a2', lower(email) from staff where active and role = 'admin' order by email offset 1 limit 1;
insert into t_ctx select 'bk1', lower(email) from staff where active and role = 'bookkeeper' order by email limit 1;
insert into t_ctx select 'bk2', lower(email) from staff where active and role = 'bookkeeper' order by email offset 1 limit 1;
insert into t_ctx select 'bk3', lower(email) from staff where active and role = 'bookkeeper' order by email offset 2 limit 1;
select pg_temp.ok(pg_temp.ctx('a1') is not null and pg_temp.ctx('a2') is not null and pg_temp.ctx('bk1') is not null
                  and pg_temp.ctx('bk2') is not null and pg_temp.ctx('bk3') is not null, 'test people found');
select pg_temp.ok(exists (select 1 from clients where id = 'basic-test' and test_only), 'test client basic-test exists');
select pg_temp.ok(public.tk_schema_version() = 10, 'schema version 10');
select pg_temp.ok(not exists (select 1 from tk_settings where key = 'asana_import_apply_enabled' and value = 'true'::jsonb),
                  'apply switch is not on in the live data');
select pg_temp.ok(not exists (select 1 from staff_reminders where source_ref like 's8b-test-%'), 'no leftover test gids');

-- Access inside the transaction only: bk1 and bk2 work basic-test, bk3 does not.
delete from staff_client_access where client_id = 'basic-test' and lower(staff_email) = pg_temp.ctx('bk3');
insert into staff_client_access (staff_email, client_id) values (pg_temp.ctx('bk1'), 'basic-test') on conflict do nothing;
insert into staff_client_access (staff_email, client_id) values (pg_temp.ctx('bk2'), 'basic-test') on conflict do nothing;
-- A throwaway client with no team (not test_only, so No team yet lists it).
insert into clients (id, name, org_type)
select 's8b-test-noteam', 'S8b test no-team client', org_type from clients where id = 'basic-test';
-- basic-test gets bk1 as its bookkeeper (the generator needs a role person)
update clients set assigned_bookkeeper_email = pg_temp.ctx('bk1') where id = 'basic-test';

-- Dates: a monthly due on the 20th of next month, a weekly due on a weekday.
insert into t_ctx values ('due_m', (date_trunc('month', (now() at time zone 'America/Chicago')::date) + interval '1 month 19 days')::date::text);
insert into t_ctx values ('due_w', ((date_trunc('week', (now() at time zone 'America/Chicago')::date) + interval '9 days')::date)::text);   -- next Wednesday

insert into t_ctx values ('rows', jsonb_build_array(
  -- unassigned, owner = the client's bookkeeper
  jsonb_build_object('kind', 'task', 'asana_gid', 's8b-test-u1', 'payload', jsonb_build_object(
    'title', 'S8b test unassigned monthly', 'client_id', 'basic-test', 'status', 'todo', 'visibility', 'shared',
    'due_date', pg_temp.ctx('due_m'), 'assignee_email', null, 'staff_email', pg_temp.ctx('bk1'))),
  -- assigned to bk1 (a named person)
  jsonb_build_object('kind', 'task', 'asana_gid', 's8b-test-u2', 'payload', jsonb_build_object(
    'title', 'S8b test assigned monthly', 'client_id', 'basic-test', 'status', 'todo', 'visibility', 'shared',
    'due_date', pg_temp.ctx('due_m'), 'assignee_email', pg_temp.ctx('bk1'), 'staff_email', pg_temp.ctx('bk1'))),
  -- weekly, assigned
  jsonb_build_object('kind', 'task', 'asana_gid', 's8b-test-u3', 'payload', jsonb_build_object(
    'title', 'S8b test weekly', 'client_id', 'basic-test', 'status', 'todo', 'visibility', 'shared',
    'due_date', pg_temp.ctx('due_w'), 'assignee_email', pg_temp.ctx('bk1'), 'staff_email', pg_temp.ctx('bk1'))),
  -- No team yet: unassigned, parked on the fallback
  jsonb_build_object('kind', 'task', 'asana_gid', 's8b-test-u4', 'payload', jsonb_build_object(
    'title', 'S8b test no-team task', 'client_id', 's8b-test-noteam', 'status', 'todo', 'visibility', 'shared',
    'assignee_email', null, 'staff_email', pg_temp.ctx('a2'))),
  -- assigned in Asana to someone who has left: the owner takes it
  jsonb_build_object('kind', 'task', 'asana_gid', 's8b-test-u5', 'payload', jsonb_build_object(
    'title', 'S8b test left-the-firm', 'client_id', 'basic-test', 'status', 'todo',
    'assignee_email', 'nobody@example.invalid', 'staff_email', pg_temp.ctx('bk1'))),
  jsonb_build_object('kind', 'template', 'asana_gid', 's8b-test-u1', 'payload', jsonb_build_object(
    'title', 'S8b test unassigned monthly', 'cadence', 'monthly', 'client_id', 'basic-test',
    'due_rule', jsonb_build_object('type', 'day_of_month', 'day', 20, 'month_offset', 1, 'roll', 'none'), 'lead_days', 14,
    'assignee_role', 'bookkeeper', 'assignee_email', null, 'leave_unassigned', true, 'instance_gid', 's8b-test-u1')),
  jsonb_build_object('kind', 'template', 'asana_gid', 's8b-test-u2', 'payload', jsonb_build_object(
    'title', 'S8b test assigned monthly', 'cadence', 'monthly', 'client_id', 'basic-test',
    'due_rule', jsonb_build_object('type', 'day_of_month', 'day', 20, 'month_offset', 1, 'roll', 'none'), 'lead_days', 14,
    'assignee_role', 'bookkeeper', 'assignee_email', pg_temp.ctx('bk1'), 'leave_unassigned', false, 'instance_gid', 's8b-test-u2')),
  jsonb_build_object('kind', 'template', 'asana_gid', 's8b-test-u3', 'payload', jsonb_build_object(
    'title', 'S8b test weekly', 'cadence', 'weekly', 'client_id', 'basic-test',
    'due_rule', jsonb_build_object('type', 'weekday', 'dow', 3), 'lead_days', 4,
    'assignee_role', 'bookkeeper', 'assignee_email', 'nobody@example.invalid', 'leave_unassigned', false, 'instance_gid', 's8b-test-u3'))
)::text);

-- 1. Stage + apply as an admin (switch on only inside this transaction)
select pg_temp.as_user(pg_temp.ctx('a1'));
insert into t_ctx select 'run1', public.tk_import_asana_stage(now(), '{"test": true}'::jsonb, pg_temp.ctx('rows')::jsonb)::text;
select pg_temp.as_user(null);
insert into tk_settings (key, value) values ('asana_import_apply_enabled', 'true'::jsonb)
  on conflict (key) do update set value = 'true'::jsonb;
select pg_temp.as_user(pg_temp.ctx('a1'));
insert into t_ctx values ('outbox0', pg_temp.outbox()::text);
insert into t_ctx select 'res1', public.tk_import_asana_apply(pg_temp.id('run1'), 'IMPORT ' || left(pg_temp.ctx('run1'), 8), pg_temp.ctx('a2'))::text;
select pg_temp.ok((pg_temp.ctx('res1')::jsonb ->> 'tasks_created')::int = 5, 'five tasks created');
select pg_temp.ok((pg_temp.ctx('res1')::jsonb ->> 'tasks_unassigned')::int = 2, 'two left unassigned');
select pg_temp.ok((pg_temp.ctx('res1')::jsonb ->> 'templates_created')::int = 3, 'three draft templates');
select pg_temp.ok((pg_temp.ctx('res1')::jsonb ->> 'templates_linked')::int = 3, 'all three linked to their open task');
select pg_temp.ok(pg_temp.outbox() = pg_temp.ctx('outbox0')::bigint, 'the import queued no email');

-- 2. Unassigned stays unassigned; owner kept
select pg_temp.ok((pg_temp.task('s8b-test-u1')).assignee_email is null
                  and (pg_temp.task('s8b-test-u1')).is_unassigned
                  and lower((pg_temp.task('s8b-test-u1')).staff_email) = pg_temp.ctx('bk1'), 'unassigned task: no assignee, bookkeeper owns it');
select pg_temp.ok((pg_temp.task('s8b-test-u2')).assignee_email = pg_temp.ctx('bk1')
                  and not (pg_temp.task('s8b-test-u2')).is_unassigned, 'assigned task keeps its person');
select pg_temp.ok((pg_temp.task('s8b-test-u4')).assignee_email is null
                  and lower((pg_temp.task('s8b-test-u4')).staff_email) = pg_temp.ctx('a2'), 'no-team task parked on the fallback, unassigned');
select pg_temp.ok((pg_temp.task('s8b-test-u5')).assignee_email = pg_temp.ctx('bk1'), 'assignee who left: the owner takes it');
select pg_temp.ok(exists (select 1 from tk_tasks where id = (pg_temp.task('s8b-test-u1')).id and is_unassigned), 'tk_tasks exposes is_unassigned');
-- a normal insert (no import flag) still defaults the assignee to the owner
insert into staff_reminders (staff_email, text, kind, visibility) values (pg_temp.ctx('a1'), 'S8b test default', 'task', 'private');
select pg_temp.ok((select assignee_email from staff_reminders where text = 'S8b test default') = pg_temp.ctx('a1'),
                  'a normal new task is still assigned to its owner');
select pg_temp.ok(current_setting('mgb.tk_unassigned', true) is distinct from 'on', 'unassigned flag reset after apply');

-- 3. Templates mirror Asana and link the open task
select pg_temp.ok((pg_temp.tpl('s8b-test-u1')).leave_unassigned and (pg_temp.tpl('s8b-test-u1')).assignee_email is null
                  and (pg_temp.tpl('s8b-test-u1')).due_rule ->> 'day' = '20' and (pg_temp.tpl('s8b-test-u1')).lead_days = 14
                  and (pg_temp.tpl('s8b-test-u1')).status = 'draft' and not (pg_temp.tpl('s8b-test-u1')).active,
                  'unassigned template: left unassigned, due rule + lead days kept, draft and off');
select pg_temp.ok((pg_temp.tpl('s8b-test-u2')).assignee_email = pg_temp.ctx('bk1') and not (pg_temp.tpl('s8b-test-u2')).leave_unassigned,
                  'person template names the person');
select pg_temp.ok((pg_temp.tpl('s8b-test-u3')).assignee_email is null and (pg_temp.tpl('s8b-test-u3')).assignee_role = 'bookkeeper',
                  'template naming someone who left falls back to the role');
select pg_temp.ok((pg_temp.task('s8b-test-u2')).template_id = (pg_temp.tpl('s8b-test-u2')).id
                  and (pg_temp.task('s8b-test-u2')).period_kind = 'month'
                  and (pg_temp.task('s8b-test-u2')).period_start = (date_trunc('month', pg_temp.ctx('due_m')::date) - interval '1 month')::date,
                  'monthly task linked as last month''s period');
select pg_temp.ok((pg_temp.task('s8b-test-u3')).template_id = (pg_temp.tpl('s8b-test-u3')).id
                  and exists (select 1 from task_template_issued i where i.template_id = (pg_temp.tpl('s8b-test-u3')).id
                                and i.period = date_trunc('week', pg_temp.ctx('due_w')::date)::date),
                  'weekly task linked to its week');
insert into t_ctx select 'gen_u2', public.tk__issue_period(pg_temp.tpl('s8b-test-u2'), public.tk__template_eff(pg_temp.tpl('s8b-test-u2'), 'basic-test'),
                                                           'basic-test', (pg_temp.task('s8b-test-u2')).period_start, true)::text;
select pg_temp.ok(pg_temp.ctx('gen_u2')::jsonb ->> 'status' = 'exists', 'generator sees the linked period as already issued');
insert into t_ctx select 'gen_next', public.tk__issue_period(pg_temp.tpl('s8b-test-u2'), public.tk__template_eff(pg_temp.tpl('s8b-test-u2'), 'basic-test'),
                                                             'basic-test', pg_temp.ctx('due_m')::date - 19, true)::text;
select pg_temp.ok(pg_temp.ctx('gen_next')::jsonb ->> 'status' = 'would_create'
                  and pg_temp.ctx('gen_next')::jsonb ->> 'assignee' = pg_temp.ctx('bk1'), 'the next period would go to the named person');
-- the generator really leaves a leave_unassigned template's task unassigned
update task_templates set status = 'active', active = true where id = (pg_temp.tpl('s8b-test-u1')).id;
insert into t_ctx select 'gen_u1', public.tk__issue_period(pg_temp.tpl('s8b-test-u1'), public.tk__template_eff(pg_temp.tpl('s8b-test-u1'), 'basic-test'),
                                                           'basic-test', pg_temp.ctx('due_m')::date - 19, false)::text;
select pg_temp.ok(pg_temp.ctx('gen_u1')::jsonb ->> 'status' = 'created', 'generator issued the next unassigned period');
select pg_temp.ok((select assignee_email is null and staff_email is not null from staff_reminders r
                    join task_template_issued i on i.reminder_id = r.id
                   where i.template_id = (pg_temp.tpl('s8b-test-u1')).id and i.period = pg_temp.ctx('due_m')::date - 19),
                  'generated task for a leave-unassigned template has no assignee');
select pg_temp.ok(current_setting('mgb.tk_unassigned', true) is distinct from 'on', 'unassigned flag reset after the generator');
update task_templates set status = 'draft', active = false where id = (pg_temp.tpl('s8b-test-u1')).id;
select pg_temp.ok(pg_temp.outbox() = pg_temp.ctx('outbox0')::bigint, 'still no email');

-- 4. Claim
select pg_temp.as_user(pg_temp.ctx('bk2'));
set local role authenticated;
do $$ begin
  update staff_reminders set assignee_email = pg_temp.ctx('bk2') where id = (pg_temp.task('s8b-test-u1')).id;
exception when others then null;   -- refused outright is fine too
end $$;
reset role;
-- past RLS too (table owner, same JWT): the trigger pin still holds the assignee
update staff_reminders set assignee_email = pg_temp.ctx('bk2') where id = (pg_temp.task('s8b-test-u1')).id;
select pg_temp.ok((pg_temp.task('s8b-test-u1')).assignee_email is null, 'a plain update cannot take someone else''s task');
select pg_temp.as_user(pg_temp.ctx('bk3'));
select pg_temp.expect_err(format('select public.tk_claim_task(%L)', (pg_temp.task('s8b-test-u1')).id), 'tk_not_found',
                          'staff without the client cannot claim');
select pg_temp.as_user(pg_temp.ctx('bk2'));
set local role authenticated;
select public.tk_claim_task((pg_temp.task('s8b-test-u1')).id);
reset role;
select pg_temp.ok((pg_temp.task('s8b-test-u1')).assignee_email = pg_temp.ctx('bk2')
                  and lower((pg_temp.task('s8b-test-u1')).staff_email) = pg_temp.ctx('bk1'), 'claimed: assignee is the claimer, owner unchanged');
select pg_temp.ok(pg_temp.outbox() = pg_temp.ctx('outbox0')::bigint, 'claiming sends no email');
select pg_temp.expect_err(format('select public.tk_claim_task(%L)', (pg_temp.task('s8b-test-u1')).id), 'tk_already_assigned',
                          'an assigned task cannot be claimed');
select pg_temp.expect_err(format('select public.tk_claim_task(%L)', (pg_temp.task('s8b-test-u2')).id), 'tk_already_assigned',
                          'someone else''s task cannot be claimed');
select pg_temp.ok(current_setting('mgb.tk_claim', true) is distinct from 'on', 'claim flag reset');
select pg_temp.as_user(null);
select pg_temp.expect_err(format('select public.tk_claim_task(%L)', (pg_temp.task('s8b-test-u4')).id), 'tk_forbidden',
                          'no JWT, no claim');

-- 5. Template editing: assignee checks; the Asana link does not lock the cadence; a change unlinks it
select pg_temp.as_user(pg_temp.ctx('a1'));
select pg_temp.expect_err(format('select public.tk_save_template(%L, %L::jsonb)', (pg_temp.tpl('s8b-test-u2')).id,
                                 '{"assignee_email": "nobody@example.invalid"}'), 'tk_bad_assignee', 'template assignee must be active staff');
select public.tk_save_template((pg_temp.tpl('s8b-test-u2')).id, '{"leave_unassigned": true}'::jsonb);
select pg_temp.ok((pg_temp.tpl('s8b-test-u2')).leave_unassigned and (pg_temp.tpl('s8b-test-u2')).assignee_email is null, 'switch to leave unassigned');
select public.tk_save_template((pg_temp.tpl('s8b-test-u2')).id, jsonb_build_object('assignee_email', pg_temp.ctx('bk2')));
select pg_temp.ok(not (pg_temp.tpl('s8b-test-u2')).leave_unassigned and (pg_temp.tpl('s8b-test-u2')).assignee_email = pg_temp.ctx('bk2'), 'switch to a named person');
select public.tk_save_template((pg_temp.tpl('s8b-test-u2')).id, '{"assignee_email": ""}'::jsonb);
select pg_temp.ok((pg_temp.tpl('s8b-test-u2')).assignee_email is null and not (pg_temp.tpl('s8b-test-u2')).leave_unassigned, 'switch back to the role');
select public.tk_save_template((pg_temp.tpl('s8b-test-u2')).id, '{"cadence": "quarterly"}'::jsonb);
select pg_temp.ok((pg_temp.tpl('s8b-test-u2')).cadence = 'quarterly', 'linked draft can still change cadence');
select pg_temp.ok((pg_temp.task('s8b-test-u2')).template_id is null and (pg_temp.task('s8b-test-u2')).period_start is null
                  and not exists (select 1 from task_template_issued where template_id = (pg_temp.tpl('s8b-test-u2')).id),
                  'cadence change unlinked the Asana task');
insert into t_ctx select 'newtpl', public.tk_save_template(null, jsonb_build_object('title', 'S8b test new', 'cadence', 'monthly',
                                                                                   'assignee_email', pg_temp.ctx('bk1')))::text;
select pg_temp.ok((select assignee_email = pg_temp.ctx('bk1') and not leave_unassigned from task_templates where id = pg_temp.id('newtpl')),
                  'new template saves its named person');

-- 6. No team yet
select pg_temp.as_user(pg_temp.ctx('bk1'));
select pg_temp.expect_err($$select * from public.tk_import_no_team_clients()$$, 'tk_forbidden', 'a bookkeeper cannot list No team yet');
select pg_temp.expect_err($$select public.tk_import_assign_team('s8b-test-noteam', pg_temp.ctx('bk2'))$$, 'tk_forbidden', 'a bookkeeper cannot assign a team');
select pg_temp.as_user(pg_temp.ctx('a1'));
select pg_temp.ok((select open_tasks = 1 and unassigned_tasks = 1 from public.tk_import_no_team_clients() where client_id = 's8b-test-noteam'),
                  'No team yet lists the client');
select pg_temp.ok(not exists (select 1 from public.tk_import_no_team_clients() where client_id = 'basic-test'), 'test clients are not listed');
select pg_temp.expect_err($$select public.tk_import_assign_team('s8b-test-noteam', 'nobody@example.invalid')$$, 'tk_bad_assignee', 'team must be active staff');
insert into t_ctx select 'team1', public.tk_import_assign_team('s8b-test-noteam', pg_temp.ctx('bk2'))::text;
select pg_temp.ok((pg_temp.ctx('team1')::jsonb ->> 'tasks_moved')::int = 1, 'one parked task handed over');
select pg_temp.ok(lower((pg_temp.task('s8b-test-u4')).staff_email) = pg_temp.ctx('bk2') and (pg_temp.task('s8b-test-u4')).assignee_email is null,
                  'bookkeeper owns it now; still unassigned (claimable)');
select pg_temp.ok((select assigned_bookkeeper_email = pg_temp.ctx('bk2') and assigned_bookkeeper ->> 'email' = pg_temp.ctx('bk2')
                     from clients where id = 's8b-test-noteam'), 'client shows its bookkeeper');
select pg_temp.ok(exists (select 1 from staff_client_access where client_id = 's8b-test-noteam' and lower(staff_email) = pg_temp.ctx('bk2')),
                  'bookkeeper got client access');
select pg_temp.ok(not exists (select 1 from public.tk_import_no_team_clients() where client_id = 's8b-test-noteam'), 'client left No team yet');
select pg_temp.expect_err($$select public.tk_import_assign_team('s8b-test-noteam', pg_temp.ctx('bk1'))$$, 'tk_has_team',
                          'a client with a team is changed on the client page instead');
select pg_temp.ok(pg_temp.outbox() = pg_temp.ctx('outbox0')::bigint, 'assigning a team sends no email');

-- 7. Undo clears the links
insert into t_ctx select 'undo1', public.tk_import_asana_undo(pg_temp.id('run1'), 'UNDO ' || left(pg_temp.ctx('run1'), 8))::text;
select pg_temp.ok((pg_temp.ctx('undo1')::jsonb ->> 'tasks_deleted')::int = 5 and (pg_temp.ctx('undo1')::jsonb ->> 'templates_retired')::int = 3, 'undo ran');
select pg_temp.ok(not exists (select 1 from task_template_issued i join tk_asana_import_map m on m.local_id = i.template_id::text
                               where m.run_id = pg_temp.id('run1') and m.kind = 'template'), 'undo removed the template ledger rows');

-- 8. Grants
select pg_temp.ok(not has_function_privilege('anon', 'public.tk_claim_task(uuid)', 'execute'), 'anon cannot claim');
select pg_temp.ok(not has_function_privilege('anon', 'public.tk_import_assign_team(text, text)', 'execute'), 'anon cannot assign a team');

select 'S8b self-test: all checks passed' as result;
rollback;
