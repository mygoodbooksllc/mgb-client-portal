-- =====================================================================
-- Self-test for supabase/repeat-menu.sql (the Slate Repeat menu).
--
-- Run it whole, AFTER repeat-menu.sql; it ends in ROLLBACK, so nothing it
-- writes is kept and no email is sent. Part A runs the date vectors shared with
-- components/tasks/TK_repeat.fixtures.js (the node test checks the same ones;
-- regenerate the rows below with
--   node components/tasks/TK_repeatLogic.test.js --sql).
-- Parts B-E use the basic-test client only. People are picked at run time.
-- A failed check raises and stops the run. Never touches tk_settings.
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

-- A. Date vectors (the same rows the JS twin checks) ----------------------------
do $a$
declare
  r record;
  v_bad text := '';
  v_n int := 0;
begin
  for r in select d from unnest(array[date '2026-09-07', date '2026-11-26', date '2026-11-27', date '2026-12-24',
                                      date '2026-12-25', date '2027-01-01', date '2027-01-18']) d loop
    if public.tk_is_business_day(r.d) then v_bad := v_bad || ' holiday-missing:' || r.d; end if;
  end loop;
  for r in select * from (values
      ('next 1: daily', '{"v":1,"interval":1,"skip":false,"end":{"type":"never"},"freq":"daily"}'::jsonb, date '2026-10-26', date '2026-10-26', date '2026-10-27'),
      ('next 2: daily every 3', '{"v":1,"interval":3,"skip":false,"end":{"type":"never"},"freq":"daily"}'::jsonb, date '2026-10-26', date '2026-10-26', date '2026-10-29'),
      ('next 3: daily skip weekend', '{"v":1,"interval":1,"skip":true,"end":{"type":"never"},"freq":"daily"}'::jsonb, date '2026-10-30', date '2026-10-30', date '2026-11-02'),
      ('next 4: daily skip Thanksgiving', '{"v":1,"interval":1,"skip":true,"end":{"type":"never"},"freq":"daily"}'::jsonb, date '2026-11-25', date '2026-11-25', date '2026-11-30'),
      ('next 5: daily overdue catches up', '{"v":1,"interval":1,"skip":false,"end":{"type":"never"},"freq":"daily"}'::jsonb, date '2026-10-01', date '2026-10-26', date '2026-10-26'),
      ('next 6: daily skip, today Saturday', '{"v":1,"interval":1,"skip":true,"end":{"type":"never"},"freq":"daily"}'::jsonb, date '2026-10-01', date '2026-10-24', date '2026-10-26'),
      ('next 7: weekly default day', '{"v":1,"interval":1,"skip":false,"end":{"type":"never"},"freq":"weekly"}'::jsonb, date '2026-10-26', date '2026-10-26', date '2026-11-02'),
      ('next 8: weekly Mon Wed Fri, from Mon', '{"v":1,"interval":1,"skip":false,"end":{"type":"never"},"freq":"weekly","dows":[1,3,5]}'::jsonb, date '2026-10-26', date '2026-10-26', date '2026-10-28'),
      ('next 9: weekly Mon Wed Fri, from Fri', '{"v":1,"interval":1,"skip":false,"end":{"type":"never"},"freq":"weekly","dows":[1,3,5]}'::jsonb, date '2026-10-30', date '2026-10-30', date '2026-11-02'),
      ('next 10: weekly every 2, Tue Thu, from Tue', '{"v":1,"interval":2,"skip":false,"end":{"type":"never"},"freq":"weekly","dows":[2,4]}'::jsonb, date '2026-10-27', date '2026-10-27', date '2026-10-29'),
      ('next 11: weekly every 2, Tue Thu, from Thu', '{"v":1,"interval":2,"skip":false,"end":{"type":"never"},"freq":"weekly","dows":[2,4]}'::jsonb, date '2026-10-29', date '2026-10-29', date '2026-11-10'),
      ('next 12: weekly every 2, default day', '{"v":1,"interval":2,"skip":false,"end":{"type":"never"},"freq":"weekly"}'::jsonb, date '2026-10-26', date '2026-10-26', date '2026-11-09'),
      ('next 13: weekly Saturday skip', '{"v":1,"interval":1,"skip":true,"end":{"type":"never"},"freq":"weekly","dows":[6]}'::jsonb, date '2026-10-31', date '2026-10-31', date '2026-11-09'),
      ('next 14: weekly Mon and Sat, skip', '{"v":1,"interval":1,"skip":true,"end":{"type":"never"},"freq":"weekly","dows":[1,6]}'::jsonb, date '2026-10-26', date '2026-10-26', date '2026-11-02'),
      ('next 15: weekly across the new year', '{"v":1,"interval":1,"skip":false,"end":{"type":"never"},"freq":"weekly"}'::jsonb, date '2026-12-30', date '2026-12-30', date '2027-01-06'),
      ('next 16: monthly 31st into Feb', '{"v":1,"interval":1,"skip":false,"end":{"type":"never"},"freq":"monthly","by":"dom","day":31}'::jsonb, date '2026-01-31', date '2026-01-31', date '2026-02-28'),
      ('next 17: monthly 31st into leap Feb', '{"v":1,"interval":1,"skip":false,"end":{"type":"never"},"freq":"monthly","by":"dom","day":31}'::jsonb, date '2028-01-31', date '2028-01-31', date '2028-02-29'),
      ('next 18: monthly 30th from Feb 28', '{"v":1,"interval":1,"skip":false,"end":{"type":"never"},"freq":"monthly","by":"dom","day":30}'::jsonb, date '2026-02-28', date '2026-02-28', date '2026-03-30'),
      ('next 19: monthly 29th into non-leap Feb', '{"v":1,"interval":1,"skip":false,"end":{"type":"never"},"freq":"monthly","by":"dom","day":29}'::jsonb, date '2027-01-29', date '2027-01-29', date '2027-02-28'),
      ('next 20: monthly 31st across the new year', '{"v":1,"interval":1,"skip":false,"end":{"type":"never"},"freq":"monthly","by":"dom","day":31}'::jsonb, date '2026-12-31', date '2026-12-31', date '2027-01-31'),
      ('next 21: quarterly on the 15th', '{"v":1,"interval":3,"skip":false,"end":{"type":"never"},"freq":"monthly","by":"dom","day":15}'::jsonb, date '2026-11-15', date '2026-11-15', date '2027-02-15'),
      ('next 22: monthly 2nd Tuesday', '{"v":1,"interval":1,"skip":false,"end":{"type":"never"},"freq":"monthly","by":"nth","n":2,"dow":2}'::jsonb, date '2026-10-13', date '2026-10-13', date '2026-11-10'),
      ('next 23: monthly last Friday', '{"v":1,"interval":1,"skip":false,"end":{"type":"never"},"freq":"monthly","by":"nth","n":-1,"dow":5}'::jsonb, date '2026-10-30', date '2026-10-30', date '2026-11-27'),
      ('next 24: monthly 4th Thursday skips Thanksgiving', '{"v":1,"interval":1,"skip":true,"end":{"type":"never"},"freq":"monthly","by":"nth","n":4,"dow":4}'::jsonb, date '2026-10-22', date '2026-10-22', date '2026-11-30'),
      ('next 25: monthly last day, Jan to Feb', '{"v":1,"interval":1,"skip":false,"end":{"type":"never"},"freq":"monthly","by":"last"}'::jsonb, date '2026-01-31', date '2026-01-31', date '2026-02-28'),
      ('next 26: monthly last day, leap Feb to Mar', '{"v":1,"interval":1,"skip":false,"end":{"type":"never"},"freq":"monthly","by":"last"}'::jsonb, date '2028-02-29', date '2028-02-29', date '2028-03-31'),
      ('next 27: monthly last day, Apr to May', '{"v":1,"interval":1,"skip":false,"end":{"type":"never"},"freq":"monthly","by":"last"}'::jsonb, date '2026-04-30', date '2026-04-30', date '2026-05-31'),
      ('next 28: monthly last day skip, Saturday Oct 31', '{"v":1,"interval":1,"skip":true,"end":{"type":"never"},"freq":"monthly","by":"last"}'::jsonb, date '2026-10-31', date '2026-10-31', date '2026-11-30'),
      ('next 29: monthly last day skip, Nov to Dec', '{"v":1,"interval":1,"skip":true,"end":{"type":"never"},"freq":"monthly","by":"last"}'::jsonb, date '2026-11-30', date '2026-11-30', date '2026-12-31'),
      ('next 30: monthly overdue catches up', '{"v":1,"interval":1,"skip":false,"end":{"type":"never"},"freq":"monthly","by":"dom","day":15}'::jsonb, date '2026-05-15', date '2026-10-26', date '2026-11-15'),
      ('next 31: yearly Feb 29 into Feb 28', '{"v":1,"interval":1,"skip":false,"end":{"type":"never"},"freq":"yearly","by":"dom","day":29}'::jsonb, date '2028-02-29', date '2028-02-29', date '2029-02-28'),
      ('next 32: yearly Feb 28 holds the 29th rule', '{"v":1,"interval":1,"skip":false,"end":{"type":"never"},"freq":"yearly","by":"dom","day":29}'::jsonb, date '2029-02-28', date '2029-02-28', date '2030-02-28'),
      ('next 33: every 2 years', '{"v":1,"interval":2,"skip":false,"end":{"type":"never"},"freq":"yearly","by":"dom","day":15}'::jsonb, date '2026-03-15', date '2026-03-15', date '2028-03-15'),
      ('next 34: ends on a date, one more', '{"v":1,"interval":1,"skip":false,"end":{"type":"on","date":"2026-10-27"},"freq":"daily"}'::jsonb, date '2026-10-26', date '2026-10-26', date '2026-10-27'),
      ('next 35: ends on a date, finished', '{"v":1,"interval":1,"skip":false,"end":{"type":"on","date":"2026-10-27"},"freq":"daily"}'::jsonb, date '2026-10-27', date '2026-10-27', null::date),
      ('next 36: ends on a date, skip pushes past it', '{"v":1,"interval":1,"skip":true,"end":{"type":"on","date":"2026-10-31"},"freq":"daily"}'::jsonb, date '2026-10-30', date '2026-10-30', null::date),
      ('next 37: bad interval', '{"v":1,"interval":0,"skip":false,"end":{"type":"never"},"freq":"daily"}'::jsonb, date '2026-10-26', date '2026-10-26', null::date),
      ('next 38: bad frequency', '{"v":1,"interval":1,"skip":false,"end":{"type":"never"},"freq":"hourly"}'::jsonb, date '2026-10-26', date '2026-10-26', null::date)
  ) as v(name, rule, base, today, expected) loop
    v_n := v_n + 1;
    if public.tk_repeat_next(r.rule, r.base, r.today) is distinct from r.expected then
      v_bad := v_bad || E'\n  ' || r.name || ' -> ' || coalesce(public.tk_repeat_next(r.rule, r.base, r.today)::text, 'null');
    end if;
  end loop;
  for r in select * from (values
      ('series 1: weekly Mon Wed', '{"v":1,"interval":1,"skip":false,"end":{"type":"never"},"freq":"weekly","dows":[1,3]}'::jsonb, date '2026-10-26', date '2026-11-09', array[date '2026-10-26', date '2026-10-28', date '2026-11-02', date '2026-11-04', date '2026-11-09']),
      ('series 2: monthly 31st, five times', '{"v":1,"interval":1,"skip":false,"end":{"type":"count","n":5},"freq":"monthly","by":"dom","day":31}'::jsonb, date '2026-01-31', date '2027-12-31', array[date '2026-01-31', date '2026-02-28', date '2026-03-31', date '2026-04-30', date '2026-05-31']),
      ('series 3: every other day, skip, no duplicates', '{"v":1,"interval":2,"skip":true,"end":{"type":"never"},"freq":"daily"}'::jsonb, date '2026-10-30', date '2026-11-10', array[date '2026-10-30', date '2026-11-02', date '2026-11-03', date '2026-11-05', date '2026-11-09']),
      ('series 4: weekly, three times', '{"v":1,"interval":1,"skip":false,"end":{"type":"count","n":3},"freq":"weekly"}'::jsonb, date '2026-10-26', date '2027-12-31', array[date '2026-10-26', date '2026-11-02', date '2026-11-09']),
      ('series 5: last day until a date', '{"v":1,"interval":1,"skip":false,"end":{"type":"on","date":"2027-01-31"},"freq":"monthly","by":"last"}'::jsonb, date '2026-10-31', date '2028-12-31', array[date '2026-10-31', date '2026-11-30', date '2026-12-31', date '2027-01-31']),
      ('series 6: quarterly', '{"v":1,"interval":3,"skip":false,"end":{"type":"never"},"freq":"monthly","by":"dom","day":15}'::jsonb, date '2026-11-15', date '2027-12-31', array[date '2026-11-15', date '2027-02-15', date '2027-05-15', date '2027-08-15', date '2027-11-15']),
      ('series 7: 25th, skip, Christmas', '{"v":1,"interval":1,"skip":true,"end":{"type":"never"},"freq":"monthly","by":"dom","day":25}'::jsonb, date '2026-12-25', date '2027-02-28', array[date '2026-12-28', date '2027-01-25', date '2027-02-25']),
      ('series 8: yearly Feb 29', '{"v":1,"interval":1,"skip":false,"end":{"type":"never"},"freq":"yearly","by":"dom","day":29}'::jsonb, date '2028-02-29', date '2032-12-31', array[date '2028-02-29', date '2029-02-28', date '2030-02-28', date '2031-02-28', date '2032-02-29']),
      ('series 9: daily skip, count 4', '{"v":1,"interval":1,"skip":true,"end":{"type":"count","n":4},"freq":"daily"}'::jsonb, date '2026-10-30', date '2027-01-01', array[date '2026-10-30', date '2026-11-02', date '2026-11-03', date '2026-11-04']),
      ('series 10: start before the pattern', '{"v":1,"interval":1,"skip":false,"end":{"type":"never"},"freq":"weekly","dows":[3]}'::jsonb, date '2026-10-26', date '2026-11-12', array[date '2026-10-28', date '2026-11-04', date '2026-11-11'])
  ) as v(name, rule, s, e, expected) loop
    v_n := v_n + 1;
    if public.tk_repeat_series(r.rule, r.s, r.e) is distinct from r.expected then
      v_bad := v_bad || E'\n  ' || r.name || ' -> ' || coalesce(public.tk_repeat_series(r.rule, r.s, r.e)::text, 'null');
    end if;
  end loop;
  for r in select * from (values
      ('due 1: Chicago, day before DST starts', date '2026-03-07', '09:00', 'America/Chicago', '2026-03-07T15:00:00.000Z'::timestamptz),
      ('due 2: Chicago, DST starts', date '2026-03-08', '09:00', 'America/Chicago', '2026-03-08T14:00:00.000Z'::timestamptz),
      ('due 3: Chicago, day before DST ends', date '2026-10-31', '09:00', 'America/Chicago', '2026-10-31T14:00:00.000Z'::timestamptz),
      ('due 4: Chicago, DST ends', date '2026-11-01', '09:00', 'America/Chicago', '2026-11-01T15:00:00.000Z'::timestamptz),
      ('due 5: Chicago, time that does not exist', date '2026-03-08', '02:30', 'America/Chicago', '2026-03-08T08:30:00.000Z'::timestamptz),
      ('due 6: Chicago, time that happens twice', date '2026-11-01', '01:30', 'America/Chicago', '2026-11-01T07:30:00.000Z'::timestamptz),
      ('due 7: New York, DST starts', date '2026-03-08', '09:00', 'America/New_York', '2026-03-08T13:00:00.000Z'::timestamptz),
      ('due 8: New York, day before', date '2026-03-07', '09:00', 'America/New_York', '2026-03-07T14:00:00.000Z'::timestamptz),
      ('due 9: late evening lands on the next UTC day', date '2026-10-26', '23:30', 'America/Chicago', '2026-10-27T04:30:00.000Z'::timestamptz)
  ) as v(name, d, t, tz, expected) loop
    v_n := v_n + 1;
    if public.tk_repeat_due_at(r.d, r.t, r.tz) is distinct from r.expected then
      v_bad := v_bad || E'\n  ' || r.name || ' -> ' || coalesce(public.tk_repeat_due_at(r.d, r.t, r.tz)::text, 'null');
    end if;
  end loop;
  if v_bad <> '' then raise exception 'SELF-TEST FAILED (date vectors):%', v_bad; end if;
  raise notice 'ok: % date vectors match the JS twin', v_n;
end $a$;

select pg_temp.ok(public.tk_repeat_series('{"freq":"weekly","dows":[1],"start":"2026-10-05"}'::jsonb, null, date '2026-12-31', date '2026-11-01') =
                  array[date '2026-11-02', date '2026-11-09', date '2026-11-16', date '2026-11-23', date '2026-11-30', date '2026-12-07',
                        date '2026-12-14', date '2026-12-21', date '2026-12-28'],
                  'series: p_from hides earlier dates');
select pg_temp.ok(public.tk_repeat_series('{"freq":"weekly","start":"2026-10-05","end":{"type":"count","n":3}}'::jsonb, null, date '2027-12-31', date '2026-10-19') =
                  array[date '2026-10-19'],
                  'series: p_from still counts earlier dates toward "after N times"');
select pg_temp.ok(public.tk_repeat_valid('{"freq":"daily"}'::jsonb) and not public.tk_repeat_valid('{"freq":"daily","interval":0}'::jsonb)
                  and not public.tk_repeat_valid('{"freq":"weekly","dows":[0]}'::jsonb) and not public.tk_repeat_valid('[]'::jsonb)
                  and not public.tk_repeat_valid('{"freq":"daily","time":"24:00"}'::jsonb)
                  and not public.tk_repeat_valid('{"freq":"daily","end":{"type":"on","date":"2026-02-30"}}'::jsonb)
                  and not public.tk_repeat_valid('{"freq":"monthly","by":"nth","n":5,"dow":1}'::jsonb)
                  and not public.tk_repeat_valid('{"freq":"daily","tz":"x; drop table y"}'::jsonb),
                  'tk_repeat_valid: good and bad rules');
select pg_temp.ok(public.tk_repeat_more('{"freq":"daily","end":{"type":"count","n":2}}'::jsonb)
                  and not public.tk_repeat_more(public.tk_repeat_advance('{"freq":"daily","end":{"type":"count","n":2}}'::jsonb))
                  and public.tk_repeat_more('{"freq":"daily"}'::jsonb),
                  'tk_repeat_more / tk_repeat_advance: count ends');

-- People: a1 = the test client's account manager (an admin); bk = a bookkeeper.
insert into t_ctx select 'a1', lower(c.account_manager_email) from clients c where c.id = 'basic-test';
insert into t_ctx select 'bk', lower(s.email) from staff s where s.active and s.role = 'bookkeeper' order by s.email limit 1;
select pg_temp.ok(public.tk__is_active_admin(pg_temp.ctx('a1')) and pg_temp.ctx('bk') is not null, 'test people found');

-- B. Constraints -----------------------------------------------------------------
do $b$
begin
  begin
    insert into staff_reminders (staff_email, assignee_email, text, client_id, due_date, recurrence)
    values ('x@example.com', null, 'x', 'basic-test', date '2026-10-26', 'custom');
    raise exception 'custom without a rule should have been refused';
  exception when check_violation then
    raise notice 'ok: recurrence custom needs a rule';
  end;
  begin
    insert into task_templates (title, cadence, due_offset_days, lead_days, plan_tiers, client_ids, priority, status, active, period_basis, repeat_rule)
    values ('x', 'custom', 0, 3, '{}', array['basic-test'], 'normal', 'draft', true, 'calendar', '{"freq":"daily"}'::jsonb);
    raise exception 'custom template without a start date should have been refused';
  exception when check_violation then
    raise notice 'ok: custom template needs a start date';
  end;
end $b$;

-- C. Completing a custom task ----------------------------------------------------------
select pg_temp.as_user(pg_temp.ctx('a1'));
create or replace function pg_temp.mk_task(p_key text, p_due date, p_rule jsonb, p_due_at timestamptz default null) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into staff_reminders (staff_email, assignee_email, text, client_id, due_date, due_at, recurrence, recurrence_rule)
  values (pg_temp.ctx('a1'), pg_temp.ctx('a1'), 'Repeat test ' || p_key, 'basic-test', p_due, p_due_at, 'custom', p_rule)
  returning id into v;
  insert into t_ctx values (p_key, v::text);
  return v;
end $$;

select pg_temp.mk_task('C1', date '2026-10-26', '{"v":1,"freq":"weekly","interval":1,"dows":[1,3],"skip":false,"end":{"type":"never"}}'::jsonb);
insert into t_ctx select 'C1n', public.complete_staff_item(pg_temp.ctx('C1')::uuid, true, date '2026-10-26')::text;
select pg_temp.ok((select due_date = date '2026-10-28' and recurrence = 'custom' and recurrence_rule ->> 'seen' = '2' and not done
                     from staff_reminders where id = pg_temp.ctx('C1n')::uuid),
                  'complete: Mon/Wed task rolls Mon -> Wed with seen = 2');
select pg_temp.ok((select recurrence = 'none' and done from staff_reminders where id = pg_temp.ctx('C1')::uuid), 'complete: the finished task stops repeating');

select pg_temp.mk_task('C2', date '2026-10-05', '{"v":1,"freq":"weekly","interval":1,"dows":[1],"skip":false}'::jsonb);
insert into t_ctx select 'C2n', public.complete_staff_item(pg_temp.ctx('C2')::uuid, true, date '2026-10-26')::text;
select pg_temp.ok((select due_date = date '2026-10-26' from staff_reminders where id = pg_temp.ctx('C2n')::uuid), 'complete: an overdue weekly task catches up to the first Monday on or after today');

select pg_temp.mk_task('C3', date '2026-10-26', '{"v":1,"freq":"daily","interval":1,"skip":false,"end":{"type":"count","n":2}}'::jsonb);
insert into t_ctx select 'C3n', public.complete_staff_item(pg_temp.ctx('C3')::uuid, true, date '2026-10-26')::text;
select pg_temp.ok(pg_temp.ctx('C3n') is not null and (select due_date = date '2026-10-27' and recurrence_rule ->> 'seen' = '2' from staff_reminders where id = pg_temp.ctx('C3n')::uuid), 'count end: first completion makes the second task');
insert into t_ctx select 'C3m', coalesce(public.complete_staff_item(pg_temp.ctx('C3n')::uuid, true, date '2026-10-27')::text, 'none');
select pg_temp.ok(pg_temp.ctx('C3m') = 'none', 'count end: the second completion makes no third task');

select pg_temp.mk_task('C4', date '2026-10-26', '{"v":1,"freq":"daily","interval":1,"skip":false,"end":{"type":"on","date":"2026-10-26"}}'::jsonb);
select pg_temp.ok(public.complete_staff_item(pg_temp.ctx('C4')::uuid, true, date '2026-10-26') is null, 'end date: nothing after the last day');

select pg_temp.mk_task('C5', date '2026-11-25', '{"v":1,"freq":"daily","interval":1,"skip":true}'::jsonb);
insert into t_ctx select 'C5n', public.complete_staff_item(pg_temp.ctx('C5')::uuid, true, date '2026-11-25')::text;
select pg_temp.ok((select due_date = date '2026-11-30' from staff_reminders where id = pg_temp.ctx('C5n')::uuid), 'skip: Wed before Thanksgiving -> next Monday');

select pg_temp.mk_task('C6', date '2026-10-31', '{"v":1,"freq":"daily","interval":1,"skip":false,"time":"09:00","tz":"America/Chicago"}'::jsonb, timestamptz '2026-10-31 14:00:00+00');
insert into t_ctx select 'C6n', public.complete_staff_item(pg_temp.ctx('C6')::uuid, true, date '2026-10-31')::text;
select pg_temp.ok((select due_date = date '2026-11-01' and due_at = timestamptz '2026-11-01 15:00:00+00' from staff_reminders where id = pg_temp.ctx('C6n')::uuid),
                  'time of day: 9:00 AM Chicago stays 9:00 AM after the clocks change');

insert into staff_reminders (staff_email, assignee_email, text, client_id, due_date, recurrence)
values (pg_temp.ctx('a1'), pg_temp.ctx('a1'), 'Repeat test legacy', 'basic-test', date '2026-01-31', 'monthly');
insert into t_ctx select 'L1', id::text from staff_reminders where text = 'Repeat test legacy';
insert into t_ctx select 'L1n', public.complete_staff_item(pg_temp.ctx('L1')::uuid, true, date '2026-01-31')::text;
select pg_temp.ok((select due_date = date '2026-02-28' and recurrence = 'monthly' and recurrence_rule is null from staff_reminders where id = pg_temp.ctx('L1n')::uuid),
                  'legacy monthly: unchanged (Jan 31 -> Feb 28, no rule)');

-- D. Saving a custom template --------------------------------------------------------------
select pg_temp.as_user(pg_temp.ctx('a1'));
insert into t_ctx select 'T1', public.tk_save_template(null, jsonb_build_object(
  'title', 'Repeat test template', 'cadence', 'custom', 'lead_days', 3, 'client_ids', jsonb_build_array('basic-test'),
  'repeat_rule', jsonb_build_object('v', 1, 'freq', 'weekly', 'interval', 1, 'dows', jsonb_build_array(1), 'skip', false,
                                    'start', '2026-10-19', 'end', jsonb_build_object('type', 'never'))))::text;
select pg_temp.ok((select cadence = 'custom' and repeat_rule ->> 'freq' = 'weekly' and due_rule ->> 'days' = '0'
                     from task_templates where id = pg_temp.ctx('T1')::uuid), 'tk_save_template: saves a custom schedule');
do $d$
begin
  begin
    perform public.tk_save_template(null, jsonb_build_object('title', 'Bad', 'cadence', 'custom', 'lead_days', 3,
      'client_ids', jsonb_build_array('basic-test'), 'repeat_rule', jsonb_build_object('freq', 'weekly', 'interval', 0, 'start', '2026-10-19')));
    raise exception 'bad rule should have been refused';
  exception when others then
    if position('tk_bad_repeat_rule' in sqlerrm) = 0 then raise; end if;
    raise notice 'ok: tk_save_template refuses a bad rule';
  end;
end $d$;

-- E. The generator ------------------------------------------------------------------------------
select pg_temp.as_user(null);
update clients set assigned_bookkeeper_email = pg_temp.ctx('bk') where id = 'basic-test';
update task_templates set status = 'active', active = true, activated_at = timestamptz '2026-10-01 12:00-05'
 where id = pg_temp.ctx('T1')::uuid;
-- a monthly template made the old way must still generate the old way
with q as (
  insert into task_templates (title, cadence, due_offset_days, due_rule, lead_days, client_ids, plan_tiers, priority, status, active, activated_at, period_basis)
  values ('Repeat test monthly', 'monthly', 10, '{"type":"offset","days":10}', 14, array['basic-test'], '{}', 'normal', 'active', true, timestamptz '2026-10-01 12:00-05', 'calendar')
  returning id)
insert into t_ctx select 'M1', id::text from q;

insert into t_ctx select 'dry', public.tk_generate(date '2026-10-26', true, 'basic-test', 0)::text;
select pg_temp.ok((select count(*) = 2 from jsonb_array_elements(pg_temp.ctx('dry')::jsonb -> 'would_create') e
                    where e ->> 'template' = pg_temp.ctx('T1')),
                  'dry run: the custom template would make Oct 19 and Oct 26 (Nov 2 is not due yet)');
select pg_temp.ok((select count(*) = 0 from task_template_issued where template_id = pg_temp.ctx('T1')::uuid), 'dry run writes nothing');

insert into t_ctx select 'run', public.tk_generate(date '2026-10-26', false, 'basic-test', 0)::text;
select pg_temp.ok((select array_agg(i.period order by i.period) = array[date '2026-10-19', date '2026-10-26']
                     from task_template_issued i where i.template_id = pg_temp.ctx('T1')::uuid and i.client_id = 'basic-test'),
                  'run: one period per occurrence date');
select pg_temp.ok((select array_agg(r.due_date order by r.due_date) = array[date '2026-10-19', date '2026-10-26']
                     from staff_reminders r join task_template_issued i on i.reminder_id = r.id
                    where i.template_id = pg_temp.ctx('T1')::uuid),
                  'run: each task is due on its occurrence date');
insert into t_ctx select 'run2', public.tk_generate(date '2026-10-26', false, 'basic-test', 0)::text;
select pg_temp.ok((select count(*) = 2 from task_template_issued where template_id = pg_temp.ctx('T1')::uuid), 'run again: nothing duplicated');
insert into t_ctx select 'run3', public.tk_generate(date '2026-10-30', false, 'basic-test', 0)::text;
select pg_temp.ok((select array_agg(period order by period) = array[date '2026-10-19', date '2026-10-26', date '2026-11-02']
                     from task_template_issued where template_id = pg_temp.ctx('T1')::uuid),
                  'later run: Nov 2 is issued once it is within 3 days');
select pg_temp.ok((select count(*) >= 1 from task_template_issued where template_id = pg_temp.ctx('M1')::uuid),
                  'the monthly template still issues its period');

select 'REPEAT MENU SELF-TEST PASSED' as result;
rollback;
