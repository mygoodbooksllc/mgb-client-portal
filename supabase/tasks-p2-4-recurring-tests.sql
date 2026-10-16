-- =====================================================================
-- Self-test for tasks-p2-4-hotfix-trigger-helpers.sql and
-- tasks-p2-4-recurring.sql (recurring engine).
--
-- Run it whole; it ends in ROLLBACK, so nothing it writes is kept and no
-- email is sent. Generator runs name a test client (basic-test or
-- grace-community); the one roster run (no client) must create nothing.
-- People are picked at run time; no names or emails live in this file.
-- The generator is called with p_today = 2026-10-15 so the expected
-- periods are fixed. A failed check raises and stops the run.
-- =====================================================================
begin;

create temp table t_ctx (k text primary key, v text) on commit drop;

create or replace function pg_temp.ctx(p_k text) returns text language sql as $$ select v from t_ctx where k = p_k $$;
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
-- Test template, inserted directly (as the migration owner) with a fixed activation date.
create or replace function pg_temp.mk(p_key text, p_cadence text, p_client text, p_rule jsonb, p_lead int,
                                      p_act date, p_basis text default 'calendar', p_status text default 'active',
                                      p_active boolean default true, p_checklist text[] default '{}')
returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into task_templates (title, cadence, due_offset_days, due_rule, lead_days, client_ids, plan_tiers, priority,
                              status, active, activated_at, period_basis, checklist)
  values ('S4 test ' || p_key, p_cadence, 10, p_rule, p_lead, array[p_client], '{}', 'normal',
          p_status, p_active, p_act::timestamptz + interval '12 hours', p_basis, p_checklist)
  returning id into v;
  insert into t_ctx values (p_key, v::text);
  return v;
end $$;
create or replace function pg_temp.counts() returns text language sql as $$
  select (select count(*) from task_template_issued)::text || '/' || (select count(*) from staff_reminders)::text || '/'
      || (select count(*) from tk_generator_runs)::text || '/' || (select count(*) from tk_generate_missed)::text
      || '/' || (select count(*) from month_close)::text || '/' || (select count(*) from task_checklist_items)::text;
$$;
create or replace function pg_temp.gen(p_client text) returns jsonb language sql as $$
  select public.tk_generate(date '2026-10-15', false, p_client);
$$;

-- People: a1 = an active admin, a2 = another active admin, bk = an active bookkeeper.
insert into t_ctx select 'a1', lower(c.account_manager_email) from clients c where c.id = 'basic-test';
insert into t_ctx select 'a2', lower(s.email) from staff s
 where s.active and s.role = 'admin' and lower(s.email) <> pg_temp.ctx('a1') order by s.email limit 1;
insert into t_ctx select 'bk', lower(s.email) from staff s where s.active and s.role = 'bookkeeper' order by s.email limit 1;
select pg_temp.ok(public.tk__is_active_admin(pg_temp.ctx('a1')) and pg_temp.ctx('a2') is not null and pg_temp.ctx('bk') is not null,
                  'test people found');
insert into staff_client_access (staff_email, client_id)
select pg_temp.ctx('bk'), 'basic-test'
 where not exists (select 1 from staff_client_access where lower(staff_email) = pg_temp.ctx('bk') and client_id = 'basic-test');
update client_profile set reviewer_email = null where client_id = 'basic-test';

-- 1. Hotfix: a signed-in bookkeeper can write tasks again (S3 leftover a) -----
select pg_temp.as_user(pg_temp.ctx('bk'));
set local role authenticated;
insert into staff_reminders (staff_email, assignee_email, text, client_id, review_required, due_date)
values (current_setting('request.jwt.claims')::json ->> 'email', current_setting('request.jwt.claims')::json ->> 'email',
        'S4 self-test hotfix task', 'basic-test', true, date '2026-10-20');
update staff_reminders set done = true where text = 'S4 self-test hotfix task';
reset role;
insert into t_ctx select 'h1', id::text from staff_reminders where text = 'S4 self-test hotfix task';
select pg_temp.ok((select status = 'ready_for_review' and not done and reviewer_email = pg_temp.ctx('a1')
                     from staff_reminders where id = pg_temp.ctx('h1')::uuid),
                  'role authenticated: insert + done=true works and diverts to review (trigger helpers callable)');

-- 2. tk_set_reviewer on a task in review emails the new reviewer (S3 leftover b)
select pg_temp.as_user(pg_temp.ctx('a2'));
select public.tk_set_reviewer(pg_temp.ctx('h1')::uuid, pg_temp.ctx('a2'));
select pg_temp.ok((select count(*) = 1 from notification_outbox
                    where kind = 'staff_task_review_ready' and ref_id = pg_temp.ctx('h1') and recipient_email = pg_temp.ctx('a2')),
                  'new reviewer gets one review-ready email');
select public.tk_set_reviewer(pg_temp.ctx('h1')::uuid, pg_temp.ctx('a2'));
select pg_temp.ok((select count(*) = 1 from notification_outbox
                    where kind = 'staff_task_review_ready' and ref_id = pg_temp.ctx('h1') and recipient_email = pg_temp.ctx('a2')),
                  'same reviewer again: no second email');
insert into t_ctx select 'ob_before', count(*)::text from notification_outbox where kind = 'staff_task_review_ready' and ref_id = pg_temp.ctx('h1');
select public.tk_set_reviewer(pg_temp.ctx('h1')::uuid, null);
select pg_temp.ok((select count(*) > pg_temp.ctx('ob_before')::int and bool_and(recipient_email <> pg_temp.ctx('bk'))
                     from notification_outbox where kind = 'staff_task_review_ready' and ref_id = pg_temp.ctx('h1')),
                  'reviewer cleared: the admin pool is told, never the submitter');

-- 3. Setup for the generator --------------------------------------------------
select pg_temp.as_user(null);
update tk_settings set value = to_jsonb('2026-06-01'::text) where key = 'on_time_since';   -- missed list floor (m3)
insert into client_profile (client_id, fiscal_year_end) values ('basic-test', '06-30')
on conflict (client_id) do update set fiscal_year_end = excluded.fiscal_year_end;
select pg_temp.ok((select fiscal_year_end = '06-30' from client_profile where client_id = 'basic-test'), 'basic-test fiscal year end set');
update clients set assigned_bookkeeper_email = pg_temp.ctx('bk') where id = 'basic-test';
update clients set assigned_bookkeeper_email = null, account_manager_email = null where id = 'grace-community';
delete from staff_client_access where lower(staff_email) = pg_temp.ctx('bk') and client_id = 'grace-community';
delete from staff_client_access_grants where lower(staff_email) = pg_temp.ctx('bk') and client_id = 'grace-community';

select pg_temp.mk('T1', 'monthly', 'grace-community', '{"type":"offset","days":10}', 14, date '2026-01-01',
                  p_checklist => array['Pull statements', 'Match deposits']);
select pg_temp.mk('T2', 'quarterly', 'grace-community', '{"type":"offset","days":15}', 30, date '2026-01-01');
select pg_temp.mk('T5', 'weekly', 'grace-community', '{"type":"weekday","dow":5}', 3, date '2026-10-01');
select pg_temp.mk('T3', 'annually', 'basic-test', '{"type":"offset","days":120}', 30, date '2025-01-01', 'fiscal');
select pg_temp.mk('T4', 'annually', 'basic-test', '{"type":"day_of_month","day":20,"month_offset":10}', 30, date '2025-01-01');
select pg_temp.mk('T7', 'monthly', 'grace-community', '{"type":"offset","days":10}', 14, date '2026-01-01', p_active => false);
select pg_temp.mk('T8', 'monthly', 'grace-community', '{"type":"offset","days":10}', 14, date '2026-01-01', p_status => 'draft');
select pg_temp.mk('T9', 'monthly', 'grace-community', '{"type":"offset","days":10}', 14, date '2026-01-01', p_status => 'retired');

-- 4. Dry run writes nothing ---------------------------------------------------
insert into t_ctx values ('c0', pg_temp.counts());
insert into t_ctx select 'dry', public.tk_generate(date '2026-10-15', true, 'grace-community', 30)::text;
select pg_temp.ok(pg_temp.counts() = pg_temp.ctx('c0'), 'dry run: issued / tasks / runs / missed / periods / checklist unchanged');
select pg_temp.ok((pg_temp.ctx('dry')::jsonb ->> 'dry_run')::boolean and jsonb_array_length(pg_temp.ctx('dry')::jsonb -> 'missed') = 6,
                  'dry run lists the 6 missed periods (T1 May-Aug, T2 Q2, T5 wk of Sep 28)');

-- 5. No assignee: skipped, period not burned -----------------------------------
insert into t_ctx select 'r1', pg_temp.gen('grace-community')::text;
select pg_temp.ok((pg_temp.ctx('r1')::jsonb ->> 'created')::int = 0, 'no assignee: nothing created');
select pg_temp.ok((select count(*) = 4 and bool_and(e ->> 'reason' = 'no_assignee')
                     from jsonb_array_elements(pg_temp.ctx('r1')::jsonb -> 'skipped') e),
                  'no assignee: 4 periods skipped with reason no_assignee');
select pg_temp.ok((select count(*) = 0 from task_template_issued where client_id = 'grace-community'), 'no assignee: no period claimed');
select pg_temp.ok((select count(*) = 6 from tk_generate_missed where client_id = 'grace-community'), 'missed periods stored once (6)');
select pg_temp.ok(split_part(pg_temp.counts(), '/', 3)::int = split_part(pg_temp.ctx('c0'), '/', 3)::int + 1
                  and (select trigger = 'cron' and created = 0 and ran_by is null from tk_generator_runs order by ran_at desc, id limit 1),
                  'run logged once (no JWT = cron)');

-- 6. Assignee without access: skipped, not claimed ------------------------------
-- Assigning a bookkeeper grants access (clients_bookkeeper_after_write) and removing
-- access clears the bookkeeper (sca_clear_assigned_bookkeeper), so no_access is tested
-- with the backup role, which has no auto-grant.
insert into client_profile (client_id, backup_bookkeeper_email) values ('grace-community', pg_temp.ctx('bk'))
on conflict (client_id) do update set backup_bookkeeper_email = excluded.backup_bookkeeper_email;
update task_templates set assignee_role = 'backup' where id in (select v::uuid from t_ctx where k in ('T1', 'T2', 'T5'));
insert into t_ctx select 'r2', pg_temp.gen('grace-community')::text;
select pg_temp.ok((pg_temp.ctx('r2')::jsonb ->> 'created')::int = 0
                  and (select count(*) = 4 and bool_and(e ->> 'reason' = 'no_access') from jsonb_array_elements(pg_temp.ctx('r2')::jsonb -> 'skipped') e),
                  'assignee without access: skipped no_access');
select pg_temp.ok((select count(*) = 0 from task_template_issued where client_id = 'grace-community'), 'no_access: no period claimed');

-- 7. Access granted: the same periods are created on the next run ---------------
update task_templates set assignee_role = 'bookkeeper' where id in (select v::uuid from t_ctx where k in ('T1', 'T2', 'T5'));
update client_profile set backup_bookkeeper_email = null where client_id = 'grace-community';
update clients set assigned_bookkeeper_email = pg_temp.ctx('bk') where id = 'grace-community';  -- also grants access
insert into t_ctx select 'r3', pg_temp.gen('grace-community')::text;
select pg_temp.ok((pg_temp.ctx('r3')::jsonb ->> 'created')::int = 4, 'retry after skips: 4 created (T1 Sep, T2 Q3, T5 x2)');
select pg_temp.ok((pg_temp.ctx('r3')::jsonb -> 'by_assignee' ->> pg_temp.ctx('bk'))::int = 4, 'by_assignee counts the bookkeeper');
select pg_temp.ok((select text = 'S4 test T1 · Sep 2026' and period_kind = 'month' and period_start = date '2026-09-01'
                          and due_date = date '2026-10-10' and due_date_original = date '2026-10-10' and start_on = date '2026-09-26'
                          and template_id = pg_temp.ctx('T1')::uuid and source = 'template' and assignee_email = pg_temp.ctx('bk')
                          and status = 'todo' and not done
                     from staff_reminders where template_id = pg_temp.ctx('T1')::uuid),
                  'T1 monthly: Sep 2026 inside the 7-day grace, due Oct 10, marker + period set');
select pg_temp.ok((select count(*) = 2 from task_checklist_items ci join staff_reminders r on r.id = ci.reminder_id
                    where r.template_id = pg_temp.ctx('T1')::uuid), 'checklist copied');
select pg_temp.ok((select text = 'S4 test T2 · Q3 2026' and period_kind = 'quarter' and period_start = date '2026-07-01'
                     from staff_reminders where template_id = pg_temp.ctx('T2')::uuid), 'T2 quarterly: Q3 2026 (calendar quarter)');
select pg_temp.ok((select count(*) = 1 from month_close where client_id = 'grace-community' and period_kind = 'month' and period = date '2026-09-01')
                  and (select count(*) = 1 from month_close where client_id = 'grace-community' and period_kind = 'quarter' and period = date '2026-07-01'),
                  'period rows exist for the month and the quarter');
select pg_temp.ok((select array_agg(text order by due_date) = array['S4 test T5 · Wk of Oct 5', 'S4 test T5 · Wk of Oct 12']
                          and bool_and(period_kind is null and period_start is null)
                     from staff_reminders where template_id = pg_temp.ctx('T5')::uuid),
                  'T5 weekly: Oct 5 and Oct 12 weeks, no period row');
select pg_temp.ok((select count(*) = 0 from staff_reminders where template_id in (pg_temp.ctx('T7')::uuid, pg_temp.ctx('T8')::uuid, pg_temp.ctx('T9')::uuid)),
                  'paused, draft and retired templates create nothing');
select pg_temp.ok((select count(*) = 0 from notification_outbox where kind = 'staff_task_assigned'
                      and ref_id in (select id::text from staff_reminders where source = 'template')),
                  'generated tasks queue no assignment email');

-- 8. Idempotent re-run ---------------------------------------------------------
insert into t_ctx values ('c3', pg_temp.counts());
insert into t_ctx select 'r4', pg_temp.gen('grace-community')::text;
select pg_temp.ok((pg_temp.ctx('r4')::jsonb ->> 'created')::int = 0 and jsonb_array_length(pg_temp.ctx('r4')::jsonb -> 'skipped') = 0,
                  're-run: 0 created, 0 skipped');
select pg_temp.ok((select count(*) = 6 from tk_generate_missed where client_id = 'grace-community'), 're-run: missed rows not duplicated');
select pg_temp.ok(split_part(pg_temp.counts(), '/', 1) = split_part(pg_temp.ctx('c3'), '/', 1)
                  and split_part(pg_temp.counts(), '/', 2) = split_part(pg_temp.ctx('c3'), '/', 2), 're-run: no new tasks or claims');

-- 9. Annual: fiscal and calendar (basic-test) ----------------------------------
insert into t_ctx select 'r5', pg_temp.gen('basic-test')::text;
select pg_temp.ok((pg_temp.ctx('r5')::jsonb ->> 'created')::int = 2, 'basic-test: 2 annual tasks created');
select pg_temp.ok((select text = 'S4 test T3 · FY 2026' and period_kind = 'year' and period_start = date '2025-07-01'
                          and due_date = date '2026-10-28'
                     from staff_reminders where template_id = pg_temp.ctx('T3')::uuid),
                  'T3 fiscal year (FYE 06-30): FY 2026 from 2025-07-01, due Oct 28');
select pg_temp.ok((select count(*) = 1 from month_close where client_id = 'basic-test' and period_kind = 'year' and period = date '2025-07-01'),
                  'fiscal year period row created');
select pg_temp.ok((select text = 'S4 test T4 · 2025' and period_kind is null and period_start is null and due_date = date '2026-10-20'
                     from staff_reminders where template_id = pg_temp.ctx('T4')::uuid),
                  'T4 calendar year: 2025, due Oct 20, no period kind (M6)');
select pg_temp.ok((select count(*) = 0 from month_close where client_id = 'basic-test' and period = date '2025-01-01'),
                  'calendar year makes no period row');

-- 10. Missed: create one by hand, dismiss another --------------------------------
select pg_temp.as_user(pg_temp.ctx('a1'));
select pg_temp.ok((public.tk_issue_missed(pg_temp.ctx('T1')::uuid, 'grace-community', date '2026-05-01') ->> 'status') = 'created',
                  'admin creates a missed period');
select pg_temp.ok((select issued_at is not null and reminder_id is not null from tk_generate_missed
                    where template_id = pg_temp.ctx('T1')::uuid and period_start = date '2026-05-01'), 'missed row marked issued');
select public.tk_dismiss_missed(pg_temp.ctx('T1')::uuid, 'grace-community', date '2026-06-01');
select pg_temp.ok((select dismissed_at is not null from tk_generate_missed
                    where template_id = pg_temp.ctx('T1')::uuid and period_start = date '2026-06-01'), 'admin dismisses a missed period');
select pg_temp.expect_err(format('select public.tk_issue_missed(%L, %L, %L)', pg_temp.ctx('T1'), 'grace-community', '2026-06-01'),
                          'tk_not_found', 'a dismissed period cannot be issued');
select pg_temp.as_user(pg_temp.ctx('bk'));
select pg_temp.expect_err(format('select public.tk_dismiss_missed(%L, %L, %L)', pg_temp.ctx('T1'), 'grace-community', '2026-07-01'),
                          'tk_forbidden', 'bookkeeper cannot dismiss');

-- 11. Standard set: off for real clients, on for a named test client ------------
select pg_temp.as_user(null);
select pg_temp.ok((select count(*) = 6 and bool_and(status = 'draft') from task_templates t join tk_template_sets s on s.id = t.template_set_id
                    where s.name = 'MGB Standard Monthly Close'), 'standard set: 6 templates, all draft');
update task_templates set status = 'active', activated_at = timestamptz '2026-10-01 12:00'
 where close_key = 'sent' and template_set_id = (select id from tk_template_sets where name = 'MGB Standard Monthly Close');
insert into t_ctx select 'r6', public.tk_generate(date '2026-10-15', false, null)::text;
select pg_temp.ok((pg_temp.ctx('r6')::jsonb ->> 'created')::int = 0 and jsonb_array_length(pg_temp.ctx('r6')::jsonb -> 'skipped') = 0,
                  'roster run while standard_set_live is off: nothing created for real clients');
insert into t_ctx select 'r7', pg_temp.gen('grace-community')::text;
select pg_temp.ok((select count(*) = 1 from staff_reminders r join task_templates t on t.id = r.template_id
                    where t.close_key = 'sent' and r.client_id = 'grace-community'),
                  'named test client: an active set member generates (Sep 2026 close)');

-- 12. Who may run what -----------------------------------------------------------
select pg_temp.as_user(pg_temp.ctx('bk'));
select pg_temp.expect_err($q$select public.tk_generate(null, false, 'basic-test')$q$, 'tk_forbidden', 'bookkeeper cannot run the generator');
select pg_temp.expect_err($q$select public.tk_generate_preview(null, 30)$q$, 'tk_forbidden', 'bookkeeper cannot preview all clients');
select pg_temp.expect_err($q$select public.tk_save_template(null, '{"title":"x"}')$q$, 'tk_forbidden', 'bookkeeper cannot save templates');
select pg_temp.expect_err(format('select public.tk_set_template_status(%L, %L)', pg_temp.ctx('T1'), 'pause'), 'tk_forbidden', 'bookkeeper cannot pause');
insert into t_ctx values ('c8', pg_temp.counts());
select pg_temp.ok((public.tk_generate_preview('basic-test', 60) ->> 'dry_run')::boolean, 'bookkeeper previews own client');
select pg_temp.ok(pg_temp.counts() = pg_temp.ctx('c8'), 'preview writes nothing');
select public.tk_set_client_override('grace-community', pg_temp.ctx('T7')::uuid, true, '{}');
select pg_temp.ok((public.tk__template_eff((select t from task_templates t where t.id = pg_temp.ctx('T7')::uuid), 'grace-community') ->> 'skip')::boolean,
                  'per-client skip saved by a bookkeeper with access');
select pg_temp.expect_err(format('select public.tk_set_client_override(%L, %L, false, %L)', 'grace-community', pg_temp.ctx('T7'), '{"review_required":false}'),
                          'tk_review_admin_only', 'only an admin turns review off for a client');
set local role authenticated;
do $$ begin
  begin
    insert into public.task_templates (title, cadence) values ('direct', 'monthly');
    raise exception 'SELF-TEST FAILED: direct template insert allowed';
  exception when insufficient_privilege then raise notice 'ok: direct template insert refused'; end;
  begin
    delete from public.task_templates;
    raise exception 'SELF-TEST FAILED: template delete allowed';
  exception when insufficient_privilege then raise notice 'ok: template delete refused (m11)'; end;
end $$;
reset role;

-- 13. Admin: save, activate, run (no assignment emails) ------------------------
select pg_temp.as_user(pg_temp.ctx('a1'));
insert into t_ctx select 'T6', public.tk_save_template(null, jsonb_build_object(
  'title', 'S4 test T6', 'cadence', 'monthly', 'due_rule', '{"type":"offset","days":10}'::jsonb, 'lead_days', 30,
  'client_ids', jsonb_build_array('grace-community'), 'checklist', jsonb_build_array('one')))::text;
select pg_temp.ok((select status = 'draft' and activated_at is null and created_by = pg_temp.ctx('a1') from task_templates where id = pg_temp.ctx('T6')::uuid),
                  'tk_save_template creates a draft');
select pg_temp.ok((public.tk_generate_preview(null, 30, pg_temp.ctx('T6')::uuid) ->> 'dry_run')::boolean, 'admin previews a draft');
select pg_temp.ok((select count(*) = 0 from staff_reminders where template_id = pg_temp.ctx('T6')::uuid), 'draft preview created nothing');
select public.tk_set_template_status(pg_temp.ctx('T6')::uuid, 'activate');
select pg_temp.ok((select status = 'active' and active and activated_at is not null from task_templates where id = pg_temp.ctx('T6')::uuid),
                  'activate stamps activated_at');
update task_templates set activated_at = timestamptz '2026-10-01 12:00' where id = pg_temp.ctx('T6')::uuid;   -- fixed for the check below
insert into t_ctx select 'r8', public.tk_generate(null, false, 'grace-community')::text;
select pg_temp.ok((pg_temp.ctx('r8')::jsonb ->> 'created')::int >= 1, 'admin manual run creates T6');
select pg_temp.ok((select count(*) = 0 from notification_outbox o join staff_reminders r on o.ref_id = r.id::text
                    where o.kind = 'staff_task_assigned' and r.template_id = pg_temp.ctx('T6')::uuid),
                  'admin manual run queues no assignment email');
select pg_temp.ok((select count(*) = 1 from tk_generator_runs where trigger = 'manual' and ran_by = pg_temp.ctx('a1')), 'manual run logged with the admin');
select pg_temp.ok(coalesce(current_setting('mgb.tk_generate', true), '') = '', 'generator flag cleared after the run');

-- 14. Review fixes (2026-10-16) ----------------------------------------------------
-- major 2: cadence / year basis locked once a template has been on
select pg_temp.expect_err(format('select public.tk_save_template(%L, %L)', pg_temp.ctx('T6'), '{"cadence":"quarterly"}'),
                          'tk_cadence_locked', 'active template: cadence change refused');
select pg_temp.expect_err(format('select public.tk_save_template(%L, %L)', pg_temp.ctx('T3'), '{"period_basis":"calendar"}'),
                          'tk_cadence_locked', 'active annual template: fiscal -> calendar refused');
select public.tk_save_template(pg_temp.ctx('T6')::uuid, '{"title":"S4 test T6 renamed","cadence":"monthly","period_basis":"fiscal"}');
select pg_temp.ok((select title = 'S4 test T6 renamed' and cadence = 'monthly' from task_templates where id = pg_temp.ctx('T6')::uuid),
                  'active template: title edit (same cadence, basis irrelevant for monthly) still saves');
insert into t_ctx select 'D1', public.tk_save_template(null, '{"title":"S4 test D1","cadence":"monthly","due_rule":{"type":"offset","days":10}}')::text;
select public.tk_save_template(pg_temp.ctx('D1')::uuid, '{"cadence":"quarterly"}');
select pg_temp.ok((select cadence = 'quarterly' from task_templates where id = pg_temp.ctx('D1')::uuid), 'a never-on draft can still change cadence');
select public.tk_set_template_status(pg_temp.ctx('D1')::uuid, 'retire');
select public.tk_set_template_status(pg_temp.ctx('D1')::uuid, 'draft');
select pg_temp.ok((select status = 'draft' from task_templates where id = pg_temp.ctx('D1')::uuid), 'retired -> back to draft');
select public.tk_set_template_status(pg_temp.ctx('D1')::uuid, 'activate');
select public.tk_set_template_status(pg_temp.ctx('D1')::uuid, 'retire');
select public.tk_set_template_status(pg_temp.ctx('D1')::uuid, 'draft');
select pg_temp.expect_err(format('select public.tk_save_template(%L, %L)', pg_temp.ctx('D1'), '{"cadence":"monthly"}'),
                          'tk_cadence_locked', 'a draft that was on once keeps its cadence');

-- major 4: a skipped issue leaves the row open; an existing task closes it
update clients set assigned_bookkeeper_email = null where id = 'grace-community';
select pg_temp.ok((public.tk_issue_missed(pg_temp.ctx('T1')::uuid, 'grace-community', date '2026-07-01') ->> 'status') = 'skipped',
                  'issue with nobody to assign: status skipped, not raised');
select pg_temp.ok((select issued_at is null and dismissed_at is null from tk_generate_missed
                    where template_id = pg_temp.ctx('T1')::uuid and client_id = 'grace-community' and period_start = date '2026-07-01'),
                  'skipped issue: missed row stays open');
update clients set assigned_bookkeeper_email = pg_temp.ctx('bk') where id = 'grace-community';
insert into task_template_issued (template_id, client_id, period, reminder_id, assignee)
values (pg_temp.ctx('T1')::uuid, 'grace-community', date '2026-08-01', pg_temp.ctx('h1')::uuid, pg_temp.ctx('bk'));
select pg_temp.ok((public.tk_issue_missed(pg_temp.ctx('T1')::uuid, 'grace-community', date '2026-08-01') ->> 'reminder_id') = pg_temp.ctx('h1'),
                  'issue when the period already has a task: exists, linked');
select pg_temp.ok((select issued_at is not null and reminder_id = pg_temp.ctx('h1')::uuid from tk_generate_missed
                    where template_id = pg_temp.ctx('T1')::uuid and client_id = 'grace-community' and period_start = date '2026-08-01'),
                  'exists: missed row closed and linked to the task');

-- minor: dismissed periods are not listed again
select pg_temp.as_user(null);
insert into t_ctx select 'r9', public.tk_generate(date '2026-10-15', true, 'grace-community', 0)::text;
select pg_temp.ok((select count(*) = 0 from jsonb_array_elements(pg_temp.ctx('r9')::jsonb -> 'missed') e
                    where e ->> 'template' = pg_temp.ctx('T1') and e ->> 'period' in ('2026-05-01', '2026-06-01', '2026-08-01')),
                  'dismissed and hand-made periods are not re-listed');

-- major 3: a bookkeeper can skip / change a template an admin set to "no approval"
select pg_temp.as_user(pg_temp.ctx('a1'));
select public.tk_set_client_override('grace-community', pg_temp.ctx('T2')::uuid, false, '{"review_required":false,"title":"Admin title"}');
select pg_temp.as_user(pg_temp.ctx('bk'));
select public.tk_set_client_override('grace-community', pg_temp.ctx('T2')::uuid, true, '{"title":"BK title"}');
select pg_temp.ok((select skip and override ->> 'title' = 'BK title' and override -> 'review_required' = 'false'::jsonb
                     from tk_client_template_overrides where client_id = 'grace-community' and template_id = pg_temp.ctx('T2')::uuid),
                  'bookkeeper skip + title save keeps the admin''s no-approval');
select public.tk_set_client_override('grace-community', pg_temp.ctx('T2')::uuid, false, '{"review_required":false}');
select public.tk_set_client_override('grace-community', pg_temp.ctx('T2')::uuid, false, '{"review_required":true}');
select pg_temp.ok((select not skip and override -> 'review_required' = 'false'::jsonb
                     from tk_client_template_overrides where client_id = 'grace-community' and template_id = pg_temp.ctx('T2')::uuid),
                  'bookkeeper resend (false or true) leaves the admin''s setting as it is');

-- major 1 + minor: live_since and a lenient standard_set_live
select pg_temp.as_user(null);
select set_config('mgb.tk_owner_override', 'on', true);
insert into tk_settings (key, value) values ('standard_set_live', 'false') on conflict (key) do update set value = excluded.value;
insert into tk_settings (key, value) values ('standard_set_live', 'true') on conflict (key) do update set value = excluded.value;
select pg_temp.ok((select live_since >= now() - interval '1 minute' from tk_template_sets where name = 'MGB Standard Monthly Close'),
                  'turning the set live stamps live_since');
update tk_template_sets set live_since = timestamptz '2026-12-01 12:00-06' where name = 'MGB Standard Monthly Close';
insert into tk_settings (key, value) values ('standard_set_live', '"true"') on conflict (key) do update set value = excluded.value;
select pg_temp.ok((select live_since = timestamptz '2026-12-01 12:00-06' from tk_template_sets where name = 'MGB Standard Monthly Close'),
                  'already on ("true" string): live_since kept');
-- basic-test stands in for a real client (flags cleared inside this rolled-back
-- transaction; dry runs only, so nothing is made or sent for it).
update clients set test_only = false, is_internal = false where id = 'basic-test';
insert into t_ctx values ('real', 'basic-test');
select pg_temp.ok((select public.is_roster_client(cl) from clients cl where cl.id = pg_temp.ctx('real')), 'stand-in real client is on the roster');
update tk_template_sets set live_since = null where name = 'MGB Standard Monthly Close';
insert into t_ctx select 'r10a', public.tk_generate(date '2026-12-01', true, pg_temp.ctx('real'), 0)::text;
select pg_temp.ok((select count(*) >= 1 from jsonb_array_elements(pg_temp.ctx('r10a')::jsonb -> 'missed') e
                    where e ->> 'template' = (select id::text from task_templates where close_key = 'sent'
                                               and template_set_id = (select id from tk_template_sets where name = 'MGB Standard Monthly Close'))),
                  'control: without live_since a real client would list periods from activation as missed');
update tk_template_sets set live_since = timestamptz '2026-12-01 12:00-06' where name = 'MGB Standard Monthly Close';
insert into t_ctx select 'r10', public.tk_generate(date '2026-12-01', true, pg_temp.ctx('real'), 0)::text;
select pg_temp.ok((select count(*) = 0 from jsonb_array_elements(pg_temp.ctx('r10')::jsonb -> 'missed') e
                    where e ->> 'template' = (select id::text from task_templates where close_key = 'sent'
                                               and template_set_id = (select id from tk_template_sets where name = 'MGB Standard Monthly Close'))),
                  'set live Dec 1 (activated Oct 1): a real client gets no missed periods from before live (dry run)');
update clients set test_only = true where id = 'basic-test';
insert into t_ctx select 'r11', public.tk_generate(date '2026-12-01', true, 'grace-community', 0)::text;
select pg_temp.ok((select count(*) >= 1 from jsonb_array_elements(pg_temp.ctx('r11')::jsonb -> 'missed') e
                    where e ->> 'template' = (select id::text from task_templates where close_key = 'sent'
                                               and template_set_id = (select id from tk_template_sets where name = 'MGB Standard Monthly Close'))
                      and e ->> 'period' = '2026-10-01'),
                  'a named test client still starts from activation (Oct 2026 close listed as missed)');
insert into tk_settings (key, value) values ('standard_set_live', '"maybe"') on conflict (key) do update set value = excluded.value;
insert into t_ctx values ('c14', pg_temp.counts());
insert into t_ctx select 'r12', public.tk_generate(date '2026-10-15', false, null)::text;
select pg_temp.ok((pg_temp.ctx('r12')::jsonb ->> 'created')::int = 0
                  and (pg_temp.ctx('r12')::jsonb -> 'warnings')::text like '%unreadable value%',
                  'unreadable standard_set_live: run completes, counts as off, warns');
select pg_temp.ok(split_part(pg_temp.counts(), '/', 3)::int = split_part(pg_temp.ctx('c14'), '/', 3)::int + 1
                  and split_part(pg_temp.counts(), '/', 2) = split_part(pg_temp.ctx('c14'), '/', 2),
                  'unreadable standard_set_live: run still logged, no tasks made');
select set_config('mgb.tk_owner_override', '', true);

select 'S4 self-test passed' as result;
rollback;
