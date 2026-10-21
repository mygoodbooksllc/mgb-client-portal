-- =====================================================================
-- Self-test for slate-rhythm-2b-issue-gate.sql. Ends in ROLLBACK: the test
-- template and the settings it writes are not kept. The client is picked at
-- run time; no names or emails live in this file. A failed check raises.
-- =====================================================================
begin;

do $t$
declare
  v_client text;
  v_rule jsonb := '{"type":"firm_part","part":"reports","month_offset":1}';
  t task_templates%rowtype;
  t_old task_templates%rowtype;
  r jsonb;
  n_rem int;
  n_iss int;
begin
  select cl.id into v_client from clients cl
   where public.is_roster_client(cl) and not coalesce(cl.test_only, false) and not coalesce(cl.is_internal, false)
     and exists (select 1 from public.tk__client_people(cl.id) p where p.role = 'bookkeeper')
   order by cl.id limit 1;
  if v_client is null then raise exception 'SELF-TEST FAILED: no roster client with a bookkeeper'; end if;

  perform set_config('mgb.tk_owner_override', 'on', true);
  insert into tk_settings (key, value) values ('month_rhythm', public.tk_month_rhythm_default())
  on conflict (key) do update set value = excluded.value;
  insert into tk_settings (key, value) values ('month_rhythm_enabled', 'false')
  on conflict (key) do update set value = excluded.value;

  insert into task_templates (title, cadence, due_rule, lead_days, client_ids, status, active, activated_at)
  values ('Slice 2b self-test', 'monthly', v_rule, 40, array[v_client], 'active', true, now() - interval '200 days')
  returning * into t;
  select count(*) into n_rem from staff_reminders where template_id = t.id;
  select count(*) into n_iss from task_template_issued where template_id = t.id;

  -- 1. switch off, real write (the tk_issue_missed path): skipped, nothing written
  perform set_config('mgb.tk_generate', 'on', true);
  r := public.tk__issue_period(t, public.tk__template_eff(t, v_client), v_client, '2026-09-01', false);
  if r ->> 'status' <> 'skipped' or r ->> 'reason' <> 'rhythm_off' then
    raise exception 'SELF-TEST FAILED: switch off, real write gave %', r;
  end if;
  if (select count(*) from staff_reminders where template_id = t.id) <> n_rem
     or (select count(*) from task_template_issued where template_id = t.id) <> n_iss then
    raise exception 'SELF-TEST FAILED: switch off, a row was written';
  end if;
  raise notice 'ok: switch off, tk__issue_period writes nothing (rhythm_off)';

  -- 2. switch off, dry run (single-template preview path): not gated, dated by the rhythm
  r := public.tk__issue_period(t, public.tk__template_eff(t, v_client), v_client, '2026-09-01', true);
  if r ->> 'reason' in ('rhythm_off', 'no_rhythm') or (r ? 'due' and r ->> 'due' <> '2026-10-14') then
    raise exception 'SELF-TEST FAILED: switch off, dry run gave %', r;
  end if;
  raise notice 'ok: dry run not gated (%)', r ->> 'status';

  -- 3. switch on: dated by the rhythm
  update tk_settings set value = 'true' where key = 'month_rhythm_enabled';
  r := public.tk__issue_period(t, public.tk__template_eff(t, v_client), v_client, '2026-09-01', true);
  if r ->> 'reason' in ('rhythm_off', 'no_rhythm') or (r ? 'due' and r ->> 'due' <> '2026-10-14') then
    raise exception 'SELF-TEST FAILED: switch on, dry run gave %', r;
  end if;
  raise notice 'ok: switch on (%)', r ->> 'status';

  -- 4. no usable rhythm: skipped, no exception (real write and dry run)
  execute $f$create or replace function public.tk__rhythm_for_client(p_client text) returns jsonb
             language sql stable set search_path = public as 'select null::jsonb'$f$;
  r := public.tk__issue_period(t, public.tk__template_eff(t, v_client), v_client, '2026-09-01', false);
  if r ->> 'status' <> 'skipped' or r ->> 'reason' <> 'no_rhythm' then
    raise exception 'SELF-TEST FAILED: NULL rhythm, real write gave %', r;
  end if;
  r := public.tk__issue_period(t, public.tk__template_eff(t, v_client), v_client, '2026-09-01', true);
  if r ->> 'reason' is distinct from 'no_rhythm' then
    raise exception 'SELF-TEST FAILED: NULL rhythm, dry run gave %', r;
  end if;
  if (select count(*) from staff_reminders where template_id = t.id) <> n_rem then
    raise exception 'SELF-TEST FAILED: NULL rhythm, a row was written';
  end if;
  raise notice 'ok: no usable rhythm, skipped (no_rhythm), nothing written';

  -- 5. an old rule type is untouched by the switch and the hook
  update tk_settings set value = 'false' where key = 'month_rhythm_enabled';
  update task_templates set due_rule = '{"type":"day_of_month","day":15}' where id = t.id returning * into t_old;
  r := public.tk__issue_period(t_old, public.tk__template_eff(t_old, v_client), v_client, '2026-09-01', true);
  if r ->> 'reason' in ('rhythm_off', 'no_rhythm') or (r ? 'due' and r ->> 'due' <> '2026-10-15') then
    raise exception 'SELF-TEST FAILED: day_of_month gave %', r;
  end if;
  raise notice 'ok: day_of_month unchanged (%)', r ->> 'status';
  perform set_config('mgb.tk_generate', '', true);
end $t$;

select 'slate-rhythm-2b self-test passed' as result;
rollback;
