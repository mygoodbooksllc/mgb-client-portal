-- =====================================================================
-- Self-test for slateplus-rules.sql (Slate plus Rules).
-- Run whole after the migration: npx supabase db query --linked -f this file
-- (or paste into execute_sql). Ends in ROLLBACK; nothing it writes is kept,
-- including the slateplus_enabled switch it turns on to test the executor.
-- People/clients are picked at run time. A failed check raises; no error is a pass.
-- =====================================================================
begin;

select set_config('t.today', ((now() at time zone 'America/Chicago')::date)::text, true);
select set_config('t.own', (select lower(ia.staff_email) from internal_access ia join staff s on lower(s.email) = lower(ia.staff_email)
  where ia.is_owner and s.active and s.role = 'admin' order by 1 limit 1), true);
select set_config('t.bk', (select lower(s.email) from staff s where s.active and s.role = 'bookkeeper'
  and exists (select 1 from clients c where public.tk_staff_has_client(lower(s.email), c.id)
              and public.tk_staff_has_client(current_setting('t.own'), c.id)
              and exists (select 1 from staff a where a.active and a.role = 'admin' and lower(a.email) <> current_setting('t.own')
                          and public.tk_staff_has_client(lower(a.email), c.id)))
  order by s.email limit 1), true);
select set_config('t.c_in', (select c.id from clients c where public.tk_staff_has_client(current_setting('t.bk'), c.id)
  and public.tk_staff_has_client(current_setting('t.own'), c.id) and not coalesce(c.is_internal, false)
  and exists (select 1 from staff a where a.active and a.role = 'admin' and lower(a.email) <> current_setting('t.own')
              and public.tk_staff_has_client(lower(a.email), c.id))
  order by c.id limit 1), true);
select set_config('t.adm', (select lower(a.email) from staff a where a.active and a.role = 'admin' and lower(a.email) <> current_setting('t.own')
  and public.tk_staff_has_client(lower(a.email), current_setting('t.c_in')) order by 1 limit 1), true);

do $$ begin
  if coalesce(current_setting('t.own'), '') = '' or coalesce(current_setting('t.bk'), '') = ''
     or coalesce(current_setting('t.adm'), '') = '' or coalesce(current_setting('t.c_in'), '') = '' then
    raise exception 'SELF-TEST FAILED: test people or client not found';
  end if;
  if public.tk__rules_live() then raise exception 'SELF-TEST FAILED: firm switch is already on'; end if;
  if has_function_privilege('anon', 'public.tk_rule_save(jsonb)', 'execute')
     or not has_function_privilege('authenticated', 'public.tk_rule_save(jsonb)', 'execute')
     or not has_function_privilege('authenticated', 'public.tk_rule_dry_run(jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.tk__rule_fire(public.tk_rules,uuid,text,date)', 'execute')
     or has_function_privilege('authenticated', 'public.tk_rules_overdue_tick()', 'execute')
     or has_function_privilege('authenticated', 'public.tk__rule_do(public.tk_rules,public.staff_reminders,jsonb)', 'execute') then
    raise exception 'SELF-TEST FAILED: execute grants';
  end if;
  if has_table_privilege('anon', 'public.tk_rules', 'select')
     or has_table_privilege('authenticated', 'public.tk_rules', 'insert')
     or has_table_privilege('authenticated', 'public.tk_rules', 'update')
     or has_table_privilege('authenticated', 'public.tk_rule_runs', 'insert') then
    raise exception 'SELF-TEST FAILED: table grants';
  end if;
  if exists (select 1 from pg_class where relname in ('tk_rules', 'tk_rule_runs') and not relrowsecurity) then
    raise exception 'SELF-TEST FAILED: RLS off';
  end if;
  if (select count(*) from pg_trigger where tgname in ('tk_staff_reminders_zrules', 'tk_staff_reminders_zrules_ins')) <> 2
     or not exists (select 1 from cron.job where jobname = 'tk-rules-overdue-daily')
     or position('slate plus rules' in pg_get_functiondef('public.tk_comments_before_write()'::regprocedure)) = 0 then
    raise exception 'SELF-TEST FAILED: triggers, cron or comments branch missing';
  end if;
  if public.tk_rules_overdue_tick() <> 0 then raise exception 'SELF-TEST FAILED: tick ran while off'; end if;
  raise notice 'ok: shape, gate off';
end $$;

-- Test project + tasks (as owner of the database).
do $$
declare p uuid; a uuid; b uuid; c uuid; d uuid; e uuid; o uuid;
begin
  insert into tk_projects (name, kind, client_id, owner_email, sections, color)
  values ('RULES self-test', 'onboarding', current_setting('t.c_in'), current_setting('t.own'), array['Prep', 'Review', 'Wrap'], 'blue')
  returning id into p;
  insert into staff_reminders (staff_email, assignee_email, text, client_id, project_id, section, kind, visibility, status, done)
  values (current_setting('t.bk'), current_setting('t.bk'), 'RULES A', current_setting('t.c_in'), p, 'Prep', 'task', 'shared', 'todo', false) returning id into a;
  insert into staff_reminders (staff_email, assignee_email, text, client_id, project_id, section, kind, visibility, status, done)
  values (current_setting('t.bk'), current_setting('t.bk'), 'RULES B', current_setting('t.c_in'), p, 'Prep', 'task', 'shared', 'todo', false) returning id into b;
  insert into staff_reminders (staff_email, assignee_email, text, client_id, project_id, section, kind, visibility, status, done)
  values (current_setting('t.bk'), current_setting('t.bk'), 'RULES C', current_setting('t.c_in'), p, 'Prep', 'task', 'shared', 'todo', false) returning id into c;
  insert into staff_reminders (staff_email, assignee_email, text, client_id, project_id, section, kind, visibility, status, done, due_date)
  values (current_setting('t.bk'), current_setting('t.bk'), 'RULES D', current_setting('t.c_in'), p, 'Prep', 'task', 'shared', 'todo', false, current_date + 10) returning id into d;
  insert into staff_reminders (staff_email, assignee_email, text, client_id, project_id, section, kind, visibility, status, done, due_date)
  values (current_setting('t.bk'), current_setting('t.bk'), 'RULES E late', current_setting('t.c_in'), p, 'Prep', 'task', 'shared', 'todo', false, current_date - 3) returning id into e;
  insert into staff_reminders (staff_email, assignee_email, text, client_id, kind, visibility, status, done)
  values (current_setting('t.bk'), current_setting('t.bk'), 'RULES private', null, 'task', 'private', 'todo', false) returning id into o;
  perform set_config('t.p', p::text, true);
  perform set_config('t.a', a::text, true);
  perform set_config('t.b', b::text, true);
  perform set_config('t.c', c::text, true);
  perform set_config('t.d', d::text, true);
  perform set_config('t.e', e::text, true);
  perform set_config('t.o', o::text, true);
end $$;

-- As a non-owner admin: save rules; switching on is refused.
select set_config('request.jwt.claims', json_build_object('email', current_setting('t.adm'), 'role', 'authenticated', 'app_metadata', json_build_object('provider', 'google'))::text, true);
set local role authenticated;
do $$
declare r jsonb; v_id text;
begin
  r := public.tk_rule_save(jsonb_build_object('name', 'Bad pair', 'scope_kind', 'project', 'project_id', current_setting('t.p'),
        'trigger_kind', 'section_moved', 'trigger_config', jsonb_build_object('section', 'Review'),
        'action_kind', 'move_section', 'action_config', jsonb_build_object('section', 'Wrap')));
  if (r ->> 'ok')::boolean or r ->> 'problem' not like '%does not go%' then raise exception 'SELF-TEST FAILED: bad pair %', r; end if;
  r := public.tk_rule_save(jsonb_build_object('name', 'Bad section', 'scope_kind', 'project', 'project_id', current_setting('t.p'),
        'trigger_kind', 'section_moved', 'trigger_config', jsonb_build_object('section', 'Nope'),
        'action_kind', 'comment', 'action_config', jsonb_build_object('text', 'x')));
  if (r ->> 'ok')::boolean then raise exception 'SELF-TEST FAILED: bad section saved'; end if;
  -- R1: moved to Review -> assign the non-owner admin
  r := public.tk_rule_save(jsonb_build_object('name', 'Review to admin', 'scope_kind', 'project', 'project_id', current_setting('t.p'),
        'trigger_kind', 'section_moved', 'trigger_config', jsonb_build_object('section', 'Review'),
        'action_kind', 'assign', 'action_config', jsonb_build_object('email', upper(current_setting('t.adm')))));
  if not (r ->> 'ok')::boolean or (r -> 'rule' ->> 'enabled')::boolean then raise exception 'SELF-TEST FAILED: save R1 %', r; end if;
  perform set_config('t.r1', r -> 'rule' ->> 'id', true);
  -- R2: assigned to the admin -> due in 3 days
  r := public.tk_rule_save(jsonb_build_object('name', 'Due on assign', 'scope_kind', 'client', 'client_id', current_setting('t.c_in'),
        'trigger_kind', 'assigned', 'trigger_config', jsonb_build_object('email', current_setting('t.adm')),
        'action_kind', 'set_due', 'action_config', jsonb_build_object('days', 3, 'business', false)));
  perform set_config('t.r2', r -> 'rule' ->> 'id', true);
  -- R3: done -> comment; R4: done -> follow-up for the admin (who then gets R2 at depth 1)
  r := public.tk_rule_save(jsonb_build_object('name', 'Done note', 'scope_kind', 'project', 'project_id', current_setting('t.p'),
        'trigger_kind', 'done', 'action_kind', 'comment', 'action_config', jsonb_build_object('text', 'Closed out.')));
  perform set_config('t.r3', r -> 'rule' ->> 'id', true);
  r := public.tk_rule_save(jsonb_build_object('name', 'Done follow-up', 'scope_kind', 'project', 'project_id', current_setting('t.p'),
        'trigger_kind', 'done', 'action_kind', 'follow_up',
        'action_config', jsonb_build_object('title', 'RULES follow-up', 'days', 5, 'assignee', current_setting('t.adm'))));
  perform set_config('t.r4', r -> 'rule' ->> 'id', true);
  -- R5: overdue -> move to Wrap
  r := public.tk_rule_save(jsonb_build_object('name', 'Late to Wrap', 'scope_kind', 'project', 'project_id', current_setting('t.p'),
        'trigger_kind', 'overdue', 'action_kind', 'move_section', 'action_config', jsonb_build_object('section', 'Wrap')));
  perform set_config('t.r5', r -> 'rule' ->> 'id', true);
  r := public.tk_rule_set_enabled(current_setting('t.r1')::uuid, true);
  if (r ->> 'ok')::boolean then raise exception 'SELF-TEST FAILED: non-owner switched a rule on'; end if;
  -- Dry run of a saved rule and of a draft: plans, writes nothing.
  r := public.tk_rule_dry_run(jsonb_build_object('id', current_setting('t.r5')));
  if not (r ->> 'ok')::boolean or (r ->> 'total')::int <> 1 or r -> 'matches' -> 0 ->> 'outcome' <> 'do'
     or (r ->> 'live')::boolean then raise exception 'SELF-TEST FAILED: dry run overdue %', r; end if;
  r := public.tk_rule_dry_run(jsonb_build_object('scope_kind', 'project', 'project_id', current_setting('t.p'),
        'trigger_kind', 'section_moved', 'trigger_config', jsonb_build_object('section', 'Prep'),
        'action_kind', 'assign', 'action_config', jsonb_build_object('email', current_setting('t.bk'))));
  if (r ->> 'total')::int <> 5 or (r -> 'counts' ->> 'noop')::int <> 5 then raise exception 'SELF-TEST FAILED: draft dry run %', r; end if;
  raise notice 'ok: save, validation, non-owner enable refused, dry run';
end $$;

-- As the owner: switch rules on.
select set_config('request.jwt.claims', json_build_object('email', current_setting('t.own'), 'role', 'authenticated', 'app_metadata', json_build_object('provider', 'google'))::text, true);
do $$
declare r jsonb;
begin
  r := public.tk_rule_set_enabled(current_setting('t.r1')::uuid, true);
  if not (r ->> 'ok')::boolean or not (r -> 'rule' ->> 'enabled')::boolean then raise exception 'SELF-TEST FAILED: owner enable %', r; end if;
  perform public.tk_rule_set_enabled(current_setting('t.r2')::uuid, true);
  perform public.tk_rule_set_enabled(current_setting('t.r3')::uuid, true);
  perform public.tk_rule_set_enabled(current_setting('t.r4')::uuid, true);
  perform public.tk_rule_set_enabled(current_setting('t.r5')::uuid, true);
end $$;

-- As the bookkeeper, firm switch still off: nothing fires.
select set_config('request.jwt.claims', json_build_object('email', current_setting('t.bk'), 'role', 'authenticated', 'app_metadata', json_build_object('provider', 'google'))::text, true);
do $$
declare ok boolean := false; n int;
begin
  update staff_reminders set section = 'Review' where id = current_setting('t.a')::uuid;
  if (select assignee_email from staff_reminders where id = current_setting('t.a')::uuid) <> current_setting('t.bk') then
    raise exception 'SELF-TEST FAILED: rule fired with the firm switch off';
  end if;
  -- RLS: the bookkeeper reads rules of a client they can open, no runs, can't write.
  select count(*) into n from tk_rules where id in (current_setting('t.r1')::uuid, current_setting('t.r2')::uuid);
  if n <> 2 then raise exception 'SELF-TEST FAILED: bk reads % rules', n; end if;
  begin perform public.tk_rule_save(jsonb_build_object('name', 'x'));
  exception when others then ok := sqlerrm like 'tk_forbidden%'; end;
  if not ok then raise exception 'SELF-TEST FAILED: bk saved a rule'; end if;
  ok := false;
  begin perform public.tk_rule_dry_run(jsonb_build_object('id', current_setting('t.r1')));
  exception when others then ok := sqlerrm like 'tk_forbidden%'; end;
  if not ok then raise exception 'SELF-TEST FAILED: bk dry run'; end if;
  ok := false;
  begin update tk_rules set enabled = true where id = current_setting('t.r1')::uuid;
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'SELF-TEST FAILED: bk direct update allowed'; end if;
  raise notice 'ok: inert with the switch off; bk read-only';
end $$;
reset role;
select count(*) as runs_while_off from tk_rule_runs where rule_id = current_setting('t.r1')::uuid;
do $$ begin
  if exists (select 1 from tk_rule_runs where rule_id = current_setting('t.r1')::uuid) then raise exception 'SELF-TEST FAILED: run logged while off'; end if;
end $$;

-- Firm switch on (inside this transaction only; rolled back at the end).
select set_config('mgb.tk_owner_override', 'on', true);
insert into tk_settings (key, value, updated_by) values ('slateplus_enabled', 'true'::jsonb, 'self-test')
on conflict (key) do update set value = excluded.value;
select set_config('mgb.tk_owner_override', '', true);

select set_config('request.jwt.claims', json_build_object('email', current_setting('t.bk'), 'role', 'authenticated', 'app_metadata', json_build_object('provider', 'google'))::text, true);
set local role authenticated;
do $$
declare v record;
begin
  -- R1 on B: moved to Review -> assigned to the admin (pins would revert a bk reassign; the rule wins).
  -- That assignment starts R2 (depth 1): due in 3 days.
  update staff_reminders set section = 'Review' where id = current_setting('t.b')::uuid;
  select assignee_email, due_date, due_date_original into v from staff_reminders where id = current_setting('t.b')::uuid;
  if v.assignee_email <> current_setting('t.adm') then raise exception 'SELF-TEST FAILED: R1 did not assign (%)', v.assignee_email; end if;
  if v.due_date is distinct from current_setting('t.today')::date + 3 then raise exception 'SELF-TEST FAILED: R2 chain due %', v.due_date; end if;
  -- D has a baseline: R2 moves the due date but not the baseline.
  update staff_reminders set section = 'Review' where id = current_setting('t.d')::uuid;
  select due_date, due_date_original into v from staff_reminders where id = current_setting('t.d')::uuid;
  if v.due_date is distinct from current_setting('t.today')::date + 3 or v.due_date_original is distinct from current_date + 10 then
    raise exception 'SELF-TEST FAILED: baseline moved (% / %)', v.due_date, v.due_date_original;
  end if;
  -- C done -> R3 comment + R4 follow-up (assigned to the admin -> R2 at depth 1).
  update staff_reminders set status = 'done' where id = current_setting('t.c')::uuid;
  -- A background job's change does not fire rules.
  perform set_config('mgb.tk_generate', 'on', true);
  update staff_reminders set section = 'Prep' where id = current_setting('t.a')::uuid;
  update staff_reminders set section = 'Review' where id = current_setting('t.a')::uuid;
  perform set_config('mgb.tk_generate', '', true);
  if (select assignee_email from staff_reminders where id = current_setting('t.a')::uuid) <> current_setting('t.bk') then
    raise exception 'SELF-TEST FAILED: rule fired on a background change';
  end if;
  -- Private task never matches (no scope), and the bk still can't read runs.
  if exists (select 1 from tk_rule_runs) then raise exception 'SELF-TEST FAILED: bk reads runs'; end if;
  raise notice 'ok: assign, chain, baseline kept, background skipped';
end $$;
reset role;

do $$
declare v record; n int; f uuid; o text;
begin
  select count(*) into n from tk_rule_runs where rule_id = current_setting('t.r1')::uuid and task_id = current_setting('t.b')::uuid and outcome = 'ok' and depth = 0;
  if n <> 1 then raise exception 'SELF-TEST FAILED: R1 run row %', n; end if;
  select count(*) into n from tk_rule_runs where rule_id = current_setting('t.r2')::uuid and task_id = current_setting('t.b')::uuid and outcome = 'ok' and depth = 1;
  if n <> 1 then raise exception 'SELF-TEST FAILED: R2 chain run row %', n; end if;
  if not exists (select 1 from tk_activity where task_id = current_setting('t.b')::uuid and kind = 'assignee' and actor_email = 'system') then
    raise exception 'SELF-TEST FAILED: activity actor not System';
  end if;
  if exists (select 1 from notification_outbox where ref_id in (current_setting('t.b'), current_setting('t.d')) and created_at = now()) then
    raise exception 'SELF-TEST FAILED: an email was queued';
  end if;
  select * into v from tk_comments where task_id = current_setting('t.c')::uuid and kind = 'system';
  if v.id is null or v.author_email <> 'system' or v.body <> 'Rule Done note: Closed out.' or cardinality(v.mentions) <> 0 then
    raise exception 'SELF-TEST FAILED: System comment %', v;
  end if;
  select created_task_id into f from tk_rule_runs where rule_id = current_setting('t.r4')::uuid and task_id = current_setting('t.c')::uuid and outcome = 'ok';
  select * into v from staff_reminders where id = f;
  if v.id is null or v.source <> 'rule' or v.source_ref <> current_setting('t.r4') or v.assignee_email <> current_setting('t.adm')
     or v.project_id <> current_setting('t.p')::uuid or v.status <> 'todo'
     or v.due_date is distinct from current_setting('t.today')::date + 3   -- R2 reset it on the follow-up's assignment (depth 1)
     or v.due_date_original is distinct from current_setting('t.today')::date + 5 then
    raise exception 'SELF-TEST FAILED: follow-up %', row_to_json(v);
  end if;
  if not exists (select 1 from tk_rule_runs where rule_id = current_setting('t.r2')::uuid and task_id = f and depth = 1 and outcome = 'ok') then
    raise exception 'SELF-TEST FAILED: follow-up insert did not chain';
  end if;
  -- Idempotent: the same event key again is a duplicate.
  select event_key into o from tk_rule_runs where rule_id = current_setting('t.r1')::uuid and task_id = current_setting('t.b')::uuid;
  if public.tk__rule_fire((select r from tk_rules r where r.id = current_setting('t.r1')::uuid), current_setting('t.b')::uuid, o, current_date) <> 'duplicate' then
    raise exception 'SELF-TEST FAILED: not idempotent';
  end if;
  -- Loop guard: depth 2 and a rule already in the chain are skipped and logged.
  perform set_config('mgb.tk_rule_depth', '2', true);
  if public.tk__rule_fire((select r from tk_rules r where r.id = current_setting('t.r3')::uuid), current_setting('t.a')::uuid, 'test:depth', current_date) <> 'skipped' then
    raise exception 'SELF-TEST FAILED: depth guard';
  end if;
  perform set_config('mgb.tk_rule_depth', '1', true);
  perform set_config('mgb.tk_rule_fired', ',' || current_setting('t.r3') || ',', true);
  if public.tk__rule_fire((select r from tk_rules r where r.id = current_setting('t.r3')::uuid), current_setting('t.a')::uuid, 'test:fired', current_date) <> 'skipped' then
    raise exception 'SELF-TEST FAILED: fired-list guard';
  end if;
  perform set_config('mgb.tk_rule_depth', '', true);
  perform set_config('mgb.tk_rule_fired', '', true);
  if (select count(*) from tk_rule_runs where task_id = current_setting('t.a')::uuid and outcome = 'skipped' and detail like 'Loop guard%') <> 2 then
    raise exception 'SELF-TEST FAILED: loop guard rows';
  end if;
  -- Overdue: E (due 3 days ago) is before the switch-on day, so not touched...
  if public.tk_rules_overdue_tick() <> 0 then raise exception 'SELF-TEST FAILED: overdue flooded old late tasks'; end if;
  -- ...until the rule is treated as switched on a week ago. Then once per due date.
  update tk_rules set enabled_at = now() - interval '7 days' where id = current_setting('t.r5')::uuid;
  if public.tk_rules_overdue_tick() <> 1 then raise exception 'SELF-TEST FAILED: overdue tick'; end if;
  if (select section from staff_reminders where id = current_setting('t.e')::uuid) <> 'Wrap' then raise exception 'SELF-TEST FAILED: overdue move'; end if;
  if public.tk_rules_overdue_tick() <> 0 then raise exception 'SELF-TEST FAILED: overdue ran twice'; end if;
  raise notice 'ok: runs logged, System actor, no email, comment, follow-up chain, idempotent, loop guard, overdue';
end $$;

-- Admin reads runs; non-owner edit switches a rule off; archive.
select set_config('request.jwt.claims', json_build_object('email', current_setting('t.adm'), 'role', 'authenticated', 'app_metadata', json_build_object('provider', 'google'))::text, true);
set local role authenticated;
do $$
declare r jsonb; n int;
begin
  select count(*) into n from public.tk_rule_recent_runs(null, 50);
  if n < 6 then raise exception 'SELF-TEST FAILED: recent runs %', n; end if;
  if (select count(*) from tk_rule_runs) < 6 then raise exception 'SELF-TEST FAILED: admin reads runs'; end if;
  r := public.tk_rule_save(jsonb_build_object('id', current_setting('t.r3'), 'name', 'Done note 2', 'scope_kind', 'project', 'project_id', current_setting('t.p'),
        'trigger_kind', 'done', 'action_kind', 'comment', 'action_config', jsonb_build_object('text', 'Closed.')));
  if (r -> 'rule' ->> 'enabled')::boolean then raise exception 'SELF-TEST FAILED: non-owner edit kept it on'; end if;
  r := public.tk_rule_set_enabled(current_setting('t.r1')::uuid, false);
  if (r -> 'rule' ->> 'enabled')::boolean then raise exception 'SELF-TEST FAILED: admin switch off'; end if;
  r := public.tk_rule_archive(current_setting('t.r2')::uuid, true);
  if (r -> 'rule' ->> 'enabled')::boolean or r -> 'rule' ->> 'archived_at' is null then raise exception 'SELF-TEST FAILED: archive'; end if;
  raise notice 'ok: recent runs, edit switches off, admin off, archive';
end $$;

-- A non-staff caller sees nothing.
select set_config('request.jwt.claims', json_build_object('email', 'someone@example.com', 'role', 'authenticated', 'app_metadata', json_build_object('provider', 'google'))::text, true);
do $$ begin
  if exists (select 1 from tk_rules) or exists (select 1 from tk_rule_runs) then raise exception 'SELF-TEST FAILED: outsider reads rules'; end if;
  raise notice 'ok: outsider sees nothing';
end $$;
reset role;

select 'ALL RULES SELF-TESTS PASSED' as result;
rollback;
