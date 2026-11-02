-- Self-test for supabase/recurring-asana-overlap.sql. Everything rolls back.
-- Uses the test client basic-test and throwaway templates/tasks (titles start with "ZZ overlap").
begin;
select set_config('mgb.tk_generate', 'on', true), set_config('mgb.tk_import', 'on', true),
       set_config('mgb.tk_actor', 'self-test', true),
       set_config('request.jwt.claims', '{"email":"holden@mygoodbooks.org","role":"authenticated","app_metadata":{"provider":"google","providers":["google"]}}', true);

do $t$
declare
  c text := 'basic-test';
  v_rule jsonb := '{"type":"day_of_month","day":15,"roll":"none","month_offset":0}';
  v_tpl task_templates;
  v_dup task_templates;
  v_wk task_templates;
  v_draft task_templates;
  v_eff jsonb;
  v_r jsonb;
  v_nov uuid;
  v_dec uuid;
  v_x uuid;
  v_sep uuid;
  v_out bigint;
  v_row staff_reminders;
  v_wstart date;
  v_wdue date;
begin
  -- an active Asana-mirrored monthly template (made yesterday, so its issued rows count as covers)
  insert into task_templates (title, cadence, client_ids, status, active, source, source_ref, created_by, due_rule,
                              lead_days, assignee_role, period_basis, created_at, activated_at)
  values ('ZZ overlap Reconcile checking', 'monthly', array[c], 'active', true, 'asana', 'zz-overlap-1',
          'holden@mygoodbooks.org', v_rule, 7, 'bookkeeper', 'calendar', now() - interval '1 day', now() - interval '1 day')
  returning * into v_tpl;
  v_eff := public.tk__template_eff(v_tpl, c);

  -- Nov 2026 period (due 2026-11-15): open Asana copy due 11-17, renamed only by spacing/case/curly quote
  insert into staff_reminders (staff_email, assignee_email, created_by, text, client_id, due_date, status, priority, kind,
                               visibility, source, source_ref)
  values ('holden@mygoodbooks.org', 'jesse@mygoodbooks.org', 'holden@mygoodbooks.org', E'zz  overlap reconcile CHECKING ',
          c, date '2026-11-17', 'todo', 'normal', 'task', 'shared', 'asana', 'zz-asana-nov')
  returning id into v_nov;

  -- 1. dry run says would_adopt and writes nothing
  v_r := public.tk__issue_period(v_tpl, v_eff, c, date '2026-11-01', true);
  if v_r ->> 'status' <> 'would_adopt' or (v_r ->> 'reminder_id')::uuid <> v_nov then
    raise exception 'SELF-TEST FAILED 1 dry run: %', v_r;
  end if;
  if exists (select 1 from task_template_issued where template_id = v_tpl.id) then
    raise exception 'SELF-TEST FAILED 1 dry run wrote an issued row';
  end if;

  -- 2. real run adopts: links the copy, changes nothing else, queues nothing
  select count(*) into v_out from notification_outbox;
  v_r := public.tk__issue_period(v_tpl, v_eff, c, date '2026-11-01', false);
  if v_r ->> 'status' <> 'adopted' or (v_r ->> 'reminder_id')::uuid <> v_nov then
    raise exception 'SELF-TEST FAILED 2 adopt: %', v_r;
  end if;
  select * into v_row from staff_reminders where id = v_nov;
  if v_row.template_id is distinct from v_tpl.id or v_row.period_kind is distinct from 'month'
     or v_row.period_start is distinct from date '2026-11-01' or v_row.due_date <> date '2026-11-17'
     or v_row.assignee_email <> 'jesse@mygoodbooks.org' or v_row.source <> 'asana' or v_row.source_ref <> 'zz-asana-nov'
     or v_row.text <> E'zz  overlap reconcile CHECKING ' or v_row.status <> 'todo' then
    raise exception 'SELF-TEST FAILED 2 copy changed: %', row_to_json(v_row);
  end if;
  if not exists (select 1 from task_template_issued
                  where template_id = v_tpl.id and client_id = c and period = date '2026-11-01' and reminder_id = v_nov
                    and assignee = 'jesse@mygoodbooks.org') then
    raise exception 'SELF-TEST FAILED 2 issued row missing';
  end if;
  if (select count(*) from staff_reminders where template_id = v_tpl.id) <> 1 then
    raise exception 'SELF-TEST FAILED 2 a second task was made';
  end if;
  if (select count(*) from notification_outbox) <> v_out then
    raise exception 'SELF-TEST FAILED 2 a notification was queued';
  end if;

  -- 3. idempotent: the next run sees the period as issued
  v_r := public.tk__issue_period(v_tpl, v_eff, c, date '2026-11-01', false);
  if v_r ->> 'status' <> 'exists' then
    raise exception 'SELF-TEST FAILED 3 re-run: %', v_r;
  end if;

  -- 4. import cover: an Asana task near the adopted copy's due date is covered; others are not
  if not public.tk__asana_task_covered(c, 'ZZ overlap Reconcile checking', date '2026-11-20') then
    raise exception 'SELF-TEST FAILED 4 cover in window';
  end if;
  if public.tk__asana_task_covered(c, 'ZZ overlap Reconcile checking', date '2026-12-15') then
    raise exception 'SELF-TEST FAILED 4 next period covered';
  end if;
  if public.tk__asana_task_covered(c, 'ZZ overlap Reconcile savings', date '2026-11-17')
     or public.tk__asana_task_covered('grace-community', 'ZZ overlap Reconcile checking', date '2026-11-17')
     or public.tk__asana_task_covered(c, 'ZZ overlap Reconcile checking', null) then
    raise exception 'SELF-TEST FAILED 4 other title/client/no due covered';
  end if;

  -- 5. Dec period (due 12-15): a done copy and a trashed copy are never adopted; out of window either
  insert into staff_reminders (staff_email, created_by, text, client_id, due_date, status, done, priority, kind, visibility, source, source_ref)
  values ('holden@mygoodbooks.org', 'holden@mygoodbooks.org', 'ZZ overlap Reconcile checking', c, date '2026-12-15',
          'done', true, 'normal', 'task', 'shared', 'asana', 'zz-asana-done');
  insert into staff_reminders (staff_email, created_by, text, client_id, due_date, status, priority, kind, visibility, source, source_ref)
  values ('holden@mygoodbooks.org', 'holden@mygoodbooks.org', 'ZZ overlap Reconcile checking', c, date '2026-12-14',
          'todo', 'normal', 'task', 'shared', 'asana', 'zz-asana-trash')
  returning id into v_x;
  update staff_reminders set deleted_at = now(), deleted_by = 'self-test' where id = v_x;
  insert into staff_reminders (staff_email, created_by, text, client_id, due_date, status, priority, kind, visibility, source, source_ref)
  values ('holden@mygoodbooks.org', 'holden@mygoodbooks.org', 'ZZ overlap Reconcile checking', c, date '2026-12-29',
          'todo', 'normal', 'task', 'shared', 'asana', 'zz-asana-far');
  v_r := public.tk__issue_period(v_tpl, v_eff, c, date '2026-12-01', true);
  if v_r ->> 'status' <> 'would_create' then
    raise exception 'SELF-TEST FAILED 5 done/trashed/far copy adopted: %', v_r;
  end if;

  -- 6. carry forward: the Nov task is done, so Asana's next copy due 11-25 (before Dec's window) is Dec's
  update staff_reminders set status = 'done', done = true, completed_at = now() where id = v_nov;
  insert into staff_reminders (staff_email, created_by, text, client_id, due_date, status, priority, kind, visibility, source, source_ref)
  values ('holden@mygoodbooks.org', 'holden@mygoodbooks.org', 'ZZ overlap Reconcile checking', c, date '2026-11-25',
          'todo', 'normal', 'task', 'shared', 'asana', 'zz-asana-carry')
  returning id into v_dec;
  v_r := public.tk__issue_period(v_tpl, v_eff, c, date '2026-12-01', true);
  if v_r ->> 'status' <> 'would_adopt' or (v_r ->> 'reminder_id')::uuid <> v_dec then
    raise exception 'SELF-TEST FAILED 6 carry forward: %', v_r;
  end if;
  -- ...but not while the Nov task is still open
  update staff_reminders set status = 'todo', done = false, completed_at = null where id = v_nov;
  v_r := public.tk__issue_period(v_tpl, v_eff, c, date '2026-12-01', true);
  if v_r ->> 'status' <> 'would_create' then
    raise exception 'SELF-TEST FAILED 6 carried past an open task: %', v_r;
  end if;
  update staff_reminders set status = 'done', done = true, completed_at = now() where id = v_nov;

  -- 7. two active templates, same title, same client: neither adopts; a draft twin does not count
  insert into task_templates (title, cadence, client_ids, status, active, source, source_ref, created_by, due_rule,
                              lead_days, assignee_role, period_basis, created_at, activated_at)
  values ('ZZ overlap reconcile  checking', 'weekly', array[c], 'active', true, 'asana', 'zz-overlap-2',
          'holden@mygoodbooks.org', '{"type":"weekday","dow":5}', 4, 'bookkeeper', 'calendar', now() - interval '1 day', now() - interval '1 day')
  returning * into v_dup;
  v_r := public.tk__issue_period(v_tpl, v_eff, c, date '2026-12-01', false);
  if v_r ->> 'status' <> 'skipped' or v_r ->> 'reason' <> 'asana_copy_ambiguous' then
    raise exception 'SELF-TEST FAILED 7 ambiguous: %', v_r;
  end if;
  if exists (select 1 from task_template_issued where template_id = v_tpl.id and period = date '2026-12-01') then
    raise exception 'SELF-TEST FAILED 7 ambiguous wrote an issued row';
  end if;
  update task_templates set status = 'draft', active = false where id = v_dup.id;
  v_r := public.tk__issue_period(v_tpl, v_eff, c, date '2026-12-01', true);
  if v_r ->> 'status' <> 'would_adopt' then
    raise exception 'SELF-TEST FAILED 7 draft twin blocked adoption: %', v_r;
  end if;

  -- 8. generator: a single-template preview lists would_adopt, and a real run counts adopted
  v_r := public.tk__generate(date '2026-12-10', true, c, 0, 'preview', v_tpl.id);
  if jsonb_array_length(coalesce(v_r -> 'would_adopt', '[]')) <> 1
     or (v_r -> 'would_adopt' -> 0 ->> 'reminder_id')::uuid <> v_dec
     or exists (select 1 from jsonb_array_elements(coalesce(v_r -> 'would_create', '[]')) w
                 where w ->> 'template' = v_tpl.id::text and w ->> 'period' = '2026-12-01') then
    raise exception 'SELF-TEST FAILED 8 preview: %', v_r;
  end if;
  v_r := public.tk__generate(date '2026-12-10', false, c, 0, 'manual');
  if (v_r ->> 'adopted')::int < 1
     or not exists (select 1 from task_template_issued where template_id = v_tpl.id and period = date '2026-12-01' and reminder_id = v_dec)
     or (select count(*) from staff_reminders where template_id = v_tpl.id and deleted_at is null) <> 2 then
    raise exception 'SELF-TEST FAILED 8 real run: %', v_r - 'skipped' - 'missed';
  end if;

  -- 9. weekly window is 3 days
  insert into task_templates (title, cadence, client_ids, status, active, source, source_ref, created_by, due_rule,
                              lead_days, assignee_role, period_basis, created_at, activated_at)
  values ('ZZ overlap Weekly deposits', 'weekly', array[c], 'active', true, 'asana', 'zz-overlap-3',
          'holden@mygoodbooks.org', '{"type":"weekday","dow":5}', 4, 'bookkeeper', 'calendar', now() - interval '1 day', now() - interval '1 day')
  returning * into v_wk;
  v_wstart := public.tk_period_start_for('week', date '2026-11-04', null);
  v_wdue := public.tk_resolve_due(v_wk.due_rule, v_wstart, public.tk__period_end('week', v_wstart));
  insert into staff_reminders (staff_email, created_by, text, client_id, due_date, status, priority, kind, visibility, source, source_ref)
  values ('holden@mygoodbooks.org', 'holden@mygoodbooks.org', 'ZZ overlap Weekly deposits', c, v_wdue + 4,
          'todo', 'normal', 'task', 'shared', 'asana', 'zz-asana-wk4');
  v_r := public.tk__issue_period(v_wk, public.tk__template_eff(v_wk, c), c, v_wstart, true);
  if v_r ->> 'status' <> 'would_create' then
    raise exception 'SELF-TEST FAILED 9 weekly +4 adopted: %', v_r;
  end if;
  insert into staff_reminders (staff_email, created_by, text, client_id, due_date, status, priority, kind, visibility, source, source_ref)
  values ('holden@mygoodbooks.org', 'holden@mygoodbooks.org', 'ZZ overlap Weekly deposits', c, v_wdue + 2,
          'todo', 'normal', 'task', 'shared', 'asana', 'zz-asana-wk2');
  v_r := public.tk__issue_period(v_wk, public.tk__template_eff(v_wk, c), c, v_wstart, true);
  if v_r ->> 'status' <> 'would_adopt' or v_r ->> 'copy_due' <> (v_wdue + 2)::text then
    raise exception 'SELF-TEST FAILED 9 weekly +2: %', v_r;
  end if;

  -- 10. drafts and the original import link never cover: an issued row written with the template
  insert into task_templates (title, cadence, client_ids, status, active, source, source_ref, created_by, due_rule,
                              lead_days, assignee_role, period_basis)
  values ('ZZ overlap Payroll check', 'monthly', array[c], 'draft', false, 'asana', 'zz-overlap-4',
          'holden@mygoodbooks.org', v_rule, 7, 'bookkeeper', 'calendar')
  returning * into v_draft;
  insert into staff_reminders (staff_email, created_by, text, client_id, due_date, status, priority, kind, visibility, source, source_ref, template_id)
  values ('holden@mygoodbooks.org', 'holden@mygoodbooks.org', 'ZZ overlap Payroll check', c, date '2026-11-15',
          'todo', 'normal', 'task', 'shared', 'asana', 'zz-asana-link', v_draft.id)
  returning id into v_x;
  insert into task_template_issued (template_id, client_id, period, reminder_id, assignee)
  values (v_draft.id, c, date '2026-11-01', v_x, 'holden@mygoodbooks.org');
  update task_templates set status = 'active', active = true, activated_at = now() where id = v_draft.id;
  if public.tk__asana_task_covered(c, 'ZZ overlap Payroll check', date '2026-11-15') then
    raise exception 'SELF-TEST FAILED 10 import-link row covered';
  end if;

  -- 11. a subtask copy is never adopted
  insert into staff_reminders (staff_email, created_by, text, client_id, due_date, status, priority, kind, visibility, source, source_ref, parent_id)
  values ('holden@mygoodbooks.org', 'holden@mygoodbooks.org', 'ZZ overlap Payroll check', c, date '2026-12-15',
          'todo', 'normal', 'task', 'shared', 'asana', 'zz-asana-sub', v_x);
  v_r := public.tk__issue_period(v_draft, public.tk__template_eff(v_draft, c), c, date '2026-12-01', true);
  if v_r ->> 'status' <> 'would_create' then
    raise exception 'SELF-TEST FAILED 11 subtask adopted: %', v_r;
  end if;

  -- 12. "Issue" on a missed period adopts an overdue copy and closes the row as linked
  insert into staff_reminders (staff_email, created_by, text, client_id, due_date, status, priority, kind, visibility, source, source_ref)
  values ('holden@mygoodbooks.org', 'holden@mygoodbooks.org', 'ZZ overlap Reconcile checking', c, date '2026-09-16',
          'todo', 'normal', 'task', 'shared', 'asana', 'zz-asana-sep')
  returning id into v_sep;
  insert into tk_generate_missed (template_id, client_id, period_start, due_date, label)
  values (v_tpl.id, c, date '2026-09-01', date '2026-09-15', 'Sep 2026');
  v_r := public.tk_issue_missed(v_tpl.id, c, date '2026-09-01');
  if v_r ->> 'status' <> 'exists' or not coalesce((v_r ->> 'adopted')::boolean, false)
     or (v_r ->> 'reminder_id')::uuid <> v_sep
     or not exists (select 1 from tk_generate_missed where template_id = v_tpl.id and period_start = date '2026-09-01'
                     and issued_at is not null and reminder_id = v_sep) then
    raise exception 'SELF-TEST FAILED 12 missed issue: %', v_r;
  end if;

  -- 13. a template that is not Asana-mirrored never adopts
  update task_templates set source = 'manual' where id = v_wk.id;
  select * into v_wk from task_templates where id = v_wk.id;
  v_r := public.tk__issue_period(v_wk, public.tk__template_eff(v_wk, c), c, v_wstart, true);
  if v_r ->> 'status' <> 'would_create' then
    raise exception 'SELF-TEST FAILED 13 firm template adopted: %', v_r;
  end if;

  -- 14. the apply re-checks covers and takes the generator lock
  if position('tk__asana_task_covered' in pg_get_functiondef('public.tk_import_asana_apply(uuid,text,text)'::regprocedure)) = 0
     or position('pg_advisory_xact_lock(hashtext(''tk_generate''))' in pg_get_functiondef('public.tk_import_asana_apply(uuid,text,text)'::regprocedure)) = 0
     or position('pg_advisory_xact_lock(hashtext(''tk_generate''))' in pg_get_functiondef('public.tk_issue_missed(uuid,text,date)'::regprocedure)) = 0
     or position('i2.reminder_id = r.id' in pg_get_functiondef('public.tk__issue_period(task_templates,jsonb,text,date,boolean)'::regprocedure)) = 0
     or position('tk__template_eff(o, p_client)' in pg_get_functiondef('public.tk__asana_copy_for_period(task_templates,jsonb,text,date,date)'::regprocedure)) = 0 then
    raise exception 'SELF-TEST FAILED 14 apply/missed patches missing';
  end if;

  raise notice 'recurring asana overlap self-test: all passed';
end
$t$;

rollback;
