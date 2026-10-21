-- =====================================================================
-- Self-test for slate-rhythm-3-templates.sql. Ends in ROLLBACK: the switch,
-- the tasks and the template edits it makes are not kept. Clients and the
-- admin are picked at run time; no names or emails live in this file.
-- A failed check raises. Safe to re-run.
-- =====================================================================
begin;

do $t$
declare
  v_set uuid := (select id from tk_template_sets where name = 'MGB Month Rhythm');
  v_std_live timestamptz := (select live_since from tk_template_sets where name = 'MGB Standard Monthly Close');
  v_client text;
  v_test text;
  v_admin text;
  v_rhythm jsonb;
  v_ids uuid[];
  r jsonb;
  e jsonb;
  t task_templates%rowtype;
  n int;
  n2 int;
  v_new uuid;
begin
  -- 0. Shape: one set, eight templates, the expected email kinds
  if v_set is null then raise exception 'SELF-TEST FAILED: rhythm set missing'; end if;
  if (select gate_key from tk_template_sets where id = v_set) <> 'month_rhythm_enabled' then
    raise exception 'SELF-TEST FAILED: rhythm set gate_key';
  end if;
  select array_agg(id order by source_ref) into v_ids from task_templates where template_set_id = v_set;
  if cardinality(v_ids) <> 8 then raise exception 'SELF-TEST FAILED: % rhythm templates', cardinality(v_ids); end if;
  if (select string_agg(source_ref || '=' || coalesce(email_kind, '-') || '/' || (due_rule ->> 'part') || '/' || (due_rule ->> 'month_offset'),
                        ',' order by source_ref) from task_templates where template_set_id = v_set)
     <> 'month_rhythm:1_check_in=-/check_in/1,month_rhythm:2_check_in=request/check_in/1,month_rhythm:3_check_in=-/check_in/1,'
        'month_rhythm:4_check_in=-/check_in/1,month_rhythm:5_reports=-/reports/1,month_rhythm:6_reports=reports/reports/1,'
        'month_rhythm:7_follow_up=maintenance/follow_up/1,month_rhythm:8_follow_up=-/follow_up/1' then
    raise exception 'SELF-TEST FAILED: rhythm rows differ from the spec';
  end if;
  if exists (select 1 from task_templates where template_set_id = v_set
              and (cadence <> 'monthly' or status <> 'active' or not active or close_key is not null
                   or due_rule ->> 'type' <> 'firm_part' or description is null)) then
    raise exception 'SELF-TEST FAILED: a rhythm template has the wrong cadence, status, close key, rule or description';
  end if;
  if exists (select 1 from task_templates where email_kind is not null and template_set_id is distinct from v_set) then
    raise exception 'SELF-TEST FAILED: email_kind set outside the rhythm set';
  end if;
  if exists (select 1 from tk_template_sets where id <> v_set and gate_key <> 'standard_set_live') then
    raise exception 'SELF-TEST FAILED: an older set changed gate';
  end if;

  -- 1. Idempotent: the seed's guard finds every row
  select count(*) into n from (values ('month_rhythm:1_check_in'), ('month_rhythm:2_check_in'), ('month_rhythm:3_check_in'),
                                      ('month_rhythm:4_check_in'), ('month_rhythm:5_reports'), ('month_rhythm:6_reports'),
                                      ('month_rhythm:7_follow_up'), ('month_rhythm:8_follow_up')) v(ref)
   where not exists (select 1 from task_templates tt where tt.template_set_id = v_set and tt.source = 'standard' and tt.source_ref = v.ref);
  if n <> 0 then raise exception 'SELF-TEST FAILED: seed would insert % rows again', n; end if;
  begin
    insert into task_templates (title, cadence, template_set_id, source, source_ref, status, active)
    values ('dup', 'monthly', v_set, 'standard', 'month_rhythm:1_check_in', 'draft', true);
    raise exception 'SELF-TEST FAILED: duplicate source_ref accepted';
  exception when unique_violation then null;
  end;

  -- pick a roster client with a bookkeeper, and a named test client
  select cl.id into v_client from clients cl
   where public.is_roster_client(cl)
     and exists (select 1 from public.tk__client_people(cl.id) p where p.role = 'bookkeeper')
   order by cl.id limit 1;
  select cl.id into v_test from clients cl where coalesce(cl.test_only, false) order by cl.id limit 1;
  if v_client is null or v_test is null then raise exception 'SELF-TEST FAILED: no roster or test client'; end if;

  -- 2. Switch off (forced for this test): nothing for real clients, test clients still see them
  perform set_config('mgb.tk_owner_override', 'on', true);
  insert into tk_settings (key, value) values ('month_rhythm_enabled', 'false')
  on conflict (key) do update set value = excluded.value;
  r := public.tk__generate('2026-11-03', true, null, 40, 'selftest', null);
  if exists (select 1 from jsonb_array_elements(coalesce(r -> 'would_create', '[]') || coalesce(r -> 'upcoming', '[]')
                                                || coalesce(r -> 'skipped', '[]') || coalesce(r -> 'missed', '[]')) x
              where (x ->> 'template')::uuid = any (v_ids)) then
    raise exception 'SELF-TEST FAILED: switch off, roster dry run lists a rhythm template';
  end if;
  r := public.tk__generate('2026-11-03', true, v_client, 40, 'selftest', null);
  if exists (select 1 from jsonb_array_elements(coalesce(r -> 'would_create', '[]') || coalesce(r -> 'upcoming', '[]')
                                                || coalesce(r -> 'skipped', '[]') || coalesce(r -> 'missed', '[]')) x
              where (x ->> 'template')::uuid = any (v_ids)) then
    raise exception 'SELF-TEST FAILED: switch off, named roster client sees a rhythm template';
  end if;
  r := public.tk__generate('2026-11-03', true, v_test, 40, 'selftest', null);
  select count(*) into n from jsonb_array_elements(coalesce(r -> 'would_create', '[]') || coalesce(r -> 'upcoming', '[]')
                                                   || coalesce(r -> 'skipped', '[]')) x
   where (x ->> 'template')::uuid = any (v_ids) and x ->> 'period' = '2026-10-01';
  if n <> 8 then raise exception 'SELF-TEST FAILED: test client should see 8 rhythm tasks for October, saw %', n; end if;
  -- the issue point refuses a real write for a real client
  select * into t from task_templates where id = v_ids[1];
  perform set_config('mgb.tk_generate', 'on', true);
  r := public.tk__issue_period(t, public.tk__template_eff(t, v_client), v_client, '2026-10-01', false);
  if r ->> 'reason' is distinct from 'rhythm_off' then raise exception 'SELF-TEST FAILED: issue with switch off gave %', r; end if;

  -- 3. Switch on: the trigger stamps only the rhythm set
  update tk_template_sets set live_since = null where id = v_set;
  update tk_settings set value = 'true' where key = 'month_rhythm_enabled';
  if (select live_since from tk_template_sets where id = v_set) is null then
    raise exception 'SELF-TEST FAILED: switch on did not stamp the rhythm set';
  end if;
  if (select live_since from tk_template_sets where name = 'MGB Standard Monthly Close') is distinct from v_std_live then
    raise exception 'SELF-TEST FAILED: month rhythm switch stamped the standard set';
  end if;
  -- pretend the switch went on at the start of October so the dry run below has no floor
  update tk_template_sets set live_since = '2026-10-01 12:00-05' where id = v_set;
  update task_templates set activated_at = '2026-10-01 12:00-05' where id = any (v_ids);

  -- 4. Switch on: a real client gets the eight October tasks on the rhythm dates
  v_rhythm := public.tk__rhythm_for_client(v_client);
  r := public.tk__generate('2026-11-03', true, v_client, 40, 'selftest', null);
  select count(*) into n from jsonb_array_elements(coalesce(r -> 'would_create', '[]') || coalesce(r -> 'upcoming', '[]')
                                                   || coalesce(r -> 'skipped', '[]')) x
   where (x ->> 'template')::uuid = any (v_ids) and x ->> 'period' = '2026-10-01';
  if n <> 8 then raise exception 'SELF-TEST FAILED: switch on, roster client saw % October rhythm tasks (want 8)', n; end if;
  for e in select x from jsonb_array_elements(coalesce(r -> 'would_create', '[]') || coalesce(r -> 'upcoming', '[]')) x
            where (x ->> 'template')::uuid = any (v_ids) and x ->> 'period' = '2026-10-01'
  loop
    select * into t from task_templates where id = (e ->> 'template')::uuid;
    if (e ->> 'due')::date is distinct from public.tk_resolve_due(t.due_rule, '2026-10-01', '2026-10-31', v_rhythm) then
      raise exception 'SELF-TEST FAILED: % due % is not the rhythm date', t.source_ref, e ->> 'due';
    end if;
  end loop;

  -- 5. A real write: section = part label, description and checklist copied
  for t in select * from task_templates where id = any (v_ids) order by source_ref loop
    r := public.tk__issue_period(t, public.tk__template_eff(t, v_client), v_client, '2026-10-01', false);
    if r ->> 'status' not in ('created', 'exists') then
      raise exception 'SELF-TEST FAILED: issue % gave %', t.source_ref, r;
    end if;
  end loop;
  select count(*) into n from staff_reminders r join task_templates tt on tt.id = r.template_id
   where tt.id = any (v_ids) and r.client_id = v_client and r.period_start = '2026-10-01'
     and r.description = tt.description
     and r.section = (select coalesce(nullif(btrim(x ->> 'label'), ''),
                                      case x ->> 'key' when 'check_in' then 'Check in' when 'reports' then 'Send reports' else 'Follow up' end)
                        from jsonb_array_elements(v_rhythm -> 'parts') x where x ->> 'key' = tt.due_rule ->> 'part')
     and (select count(*) from task_checklist_items c where c.reminder_id = r.id) = cardinality(tt.checklist);
  if n <> 8 then raise exception 'SELF-TEST FAILED: % of 8 rhythm tasks have the right section, description and checklist', n; end if;

  -- 6. An ordinary template's task still gets no section or description
  insert into task_templates (title, cadence, due_rule, lead_days, client_ids, status, active, activated_at)
  values ('Slice 3 self-test', 'monthly', '{"type":"day_of_month","day":10,"month_offset":1}', 40, array[v_client],
          'active', true, now() - interval '200 days')
  returning * into t;
  r := public.tk__issue_period(t, public.tk__template_eff(t, v_client), v_client, '2026-10-01', false);
  if r ->> 'status' <> 'created' then raise exception 'SELF-TEST FAILED: ordinary issue gave %', r; end if;
  if exists (select 1 from staff_reminders where id = (r ->> 'reminder_id')::uuid
              and (section is not null or description is not null)) then
    raise exception 'SELF-TEST FAILED: ordinary task got a section or description';
  end if;

  -- 7. tk_save_template: description is optional; a payload without it keeps it
  select s.email into v_admin from staff s where s.role = 'admin' and s.active order by s.email limit 1;
  if v_admin is not null then
    perform set_config('request.jwt.claims',
                       jsonb_build_object('email', v_admin, 'app_metadata', jsonb_build_object('provider', 'google'))::text, true);
    v_new := public.tk_save_template(null, jsonb_build_object('title', 'Slice 3 save test', 'cadence', 'monthly'));
    if (select description from task_templates where id = v_new) is not null then
      raise exception 'SELF-TEST FAILED: description appeared from nowhere';
    end if;
    perform public.tk_save_template(v_new, jsonb_build_object('description', '  A note  '));
    if (select description from task_templates where id = v_new) is distinct from 'A note' then
      raise exception 'SELF-TEST FAILED: description not saved';
    end if;
    perform public.tk_save_template(v_new, jsonb_build_object('title', 'Slice 3 save test 2'));
    if (select description from task_templates where id = v_new) is distinct from 'A note' then
      raise exception 'SELF-TEST FAILED: description lost on a save without it';
    end if;
    perform public.tk_save_template(v_new, jsonb_build_object('description', ''));
    if (select description from task_templates where id = v_new) is not null then
      raise exception 'SELF-TEST FAILED: empty description not cleared';
    end if;
    -- a rhythm template stays editable (rule part change)
    perform public.tk_save_template(v_ids[1], jsonb_build_object('due_rule', '{"type":"firm_part","part":"reports","month_offset":1}'::jsonb));
    if (select due_rule ->> 'part' from task_templates where id = v_ids[1]) <> 'reports'
       or (select description from task_templates where id = v_ids[1]) is null then
      raise exception 'SELF-TEST FAILED: rhythm template edit';
    end if;
    perform set_config('request.jwt.claims', '', true);
  end if;

  raise notice 'slate rhythm s3 self-test passed (admin save checks %)', case when v_admin is null then 'skipped' else 'ran' end;
end
$t$;

rollback;
