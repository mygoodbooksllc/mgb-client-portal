-- =====================================================================
-- Self-test for slate-rhythm-1-settings.sql (month rhythm setting).
--
-- Run it whole; it ends in ROLLBACK, so nothing it writes is kept. People
-- are picked at run time (an active admin who is not the owner, an active
-- bookkeeper); no names or emails live in this file. A failed check raises
-- and stops the run. The vectors below are the ones in
-- components/tasks/TK_rhythm.fixtures.js (the node test checks they match).
-- =====================================================================
begin;

create temp table t_ctx (k text primary key, v text) on commit drop;
create or replace function pg_temp.ctx(p_k text) returns text language sql as $$ select v from t_ctx where k = p_k $$;
create or replace function pg_temp.as_user(p_email text) returns void language sql as $$
  select set_config('request.jwt.claims',
    case when p_email is null then '' else json_build_object(
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

-- 1. Shared vectors -----------------------------------------------------------
create temp table t_vec (id text primary key, j text, problem text) on commit drop;
insert into t_vec (id, j, problem) values
('r01_default', '{"parts":[{"key":"check_in","label":"Check in","day":4},{"key":"reports","label":"Send reports","day":14},{"key":"follow_up","label":"Follow up","day":24}],"roll":"next"}', null),
('r02_no_labels', '{"parts":[{"key":"check_in","day":3},{"key":"reports","day":12},{"key":"follow_up","day":20}],"roll":"prev"}', null),
('r03_roll_none', '{"parts":[{"key":"check_in","day":1},{"key":"reports","day":2},{"key":"follow_up","day":28}],"roll":"none"}', null),
('r04_float_int', '{"parts":[{"key":"check_in","day":4.0},{"key":"reports","day":14},{"key":"follow_up","day":24}],"roll":"next"}', null),
('r05_extra_fields', '{"parts":[{"key":"check_in","day":4,"note":"x"},{"key":"reports","day":14},{"key":"follow_up","day":24}],"roll":"next","v":2}', null),
('r06_array', '[1,2,3]', 'not_object'),
('r07_string', '"4,14,24"', 'not_object'),
('r08_no_parts', '{"roll":"next"}', 'parts_missing'),
('r09_parts_object', '{"parts":{"check_in":4},"roll":"next"}', 'parts_missing'),
('r10_two_parts', '{"parts":[{"key":"check_in","day":4},{"key":"reports","day":14}],"roll":"next"}', 'parts_count'),
('r11_four_parts', '{"parts":[{"key":"check_in","day":4},{"key":"reports","day":14},{"key":"follow_up","day":24},{"key":"follow_up","day":26}],"roll":"next"}', 'parts_count'),
('r12_wrong_key', '{"parts":[{"key":"check_in","day":4},{"key":"report","day":14},{"key":"follow_up","day":24}],"roll":"next"}', 'part_key'),
('r13_key_order', '{"parts":[{"key":"reports","day":4},{"key":"check_in","day":14},{"key":"follow_up","day":24}],"roll":"next"}', 'part_key'),
('r14_part_not_object', '{"parts":[4,14,24],"roll":"next"}', 'part_key'),
('r15_day_string', '{"parts":[{"key":"check_in","day":"4"},{"key":"reports","day":14},{"key":"follow_up","day":24}],"roll":"next"}', 'part_day'),
('r16_day_zero', '{"parts":[{"key":"check_in","day":0},{"key":"reports","day":14},{"key":"follow_up","day":24}],"roll":"next"}', 'part_day'),
('r17_day_29', '{"parts":[{"key":"check_in","day":4},{"key":"reports","day":14},{"key":"follow_up","day":29}],"roll":"next"}', 'part_day'),
('r18_day_fraction', '{"parts":[{"key":"check_in","day":4.5},{"key":"reports","day":14},{"key":"follow_up","day":24}],"roll":"next"}', 'part_day'),
('r19_day_missing', '{"parts":[{"key":"check_in"},{"key":"reports","day":14},{"key":"follow_up","day":24}],"roll":"next"}', 'part_day'),
('r20_equal_days', '{"parts":[{"key":"check_in","day":14},{"key":"reports","day":14},{"key":"follow_up","day":24}],"roll":"next"}', 'day_order'),
('r21_desc_days', '{"parts":[{"key":"check_in","day":4},{"key":"reports","day":24},{"key":"follow_up","day":14}],"roll":"next"}', 'day_order'),
('r22_label_empty', '{"parts":[{"key":"check_in","label":"  ","day":4},{"key":"reports","day":14},{"key":"follow_up","day":24}],"roll":"next"}', 'label'),
('r23_label_number', '{"parts":[{"key":"check_in","label":7,"day":4},{"key":"reports","day":14},{"key":"follow_up","day":24}],"roll":"next"}', 'label'),
('r24_label_long', '{"parts":[{"key":"check_in","label":"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx","day":4},{"key":"reports","day":14},{"key":"follow_up","day":24}],"roll":"next"}', 'label'),
('r25_no_roll', '{"parts":[{"key":"check_in","day":4},{"key":"reports","day":14},{"key":"follow_up","day":24}]}', 'roll'),
('r26_bad_roll', '{"parts":[{"key":"check_in","day":4},{"key":"reports","day":14},{"key":"follow_up","day":24}],"roll":"weekend"}', 'roll'),
('r27_null', 'null', 'not_object'),
-- r28-r33 added by slate-rhythm-1b-label-parity.sql (label blanks, code-point length)
('r28_label_bom', '{"parts":[{"key":"check_in","label":"\ufeff","day":4},{"key":"reports","day":14},{"key":"follow_up","day":24}],"roll":"next"}', 'label'),
('r29_label_nel', '{"parts":[{"key":"check_in","label":"\u0085","day":4},{"key":"reports","day":14},{"key":"follow_up","day":24}],"roll":"next"}', 'label'),
('r30_label_nbsp', '{"parts":[{"key":"check_in","label":"\u00a0","day":4},{"key":"reports","day":14},{"key":"follow_up","day":24}],"roll":"next"}', 'label'),
('r31_label_zwsp_word', '{"parts":[{"key":"check_in","label":"\u200bCheck","day":4},{"key":"reports","day":14},{"key":"follow_up","day":24}],"roll":"next"}', null),
('r32_label_emoji_40', '{"parts":[{"key":"check_in","label":"\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00","day":4},{"key":"reports","day":14},{"key":"follow_up","day":24}],"roll":"next"}', null),
('r33_label_emoji_41', '{"parts":[{"key":"check_in","label":"\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00","day":4},{"key":"reports","day":14},{"key":"follow_up","day":24}],"roll":"next"}', 'label');

do $$
declare r record; got text;
begin
  for r in select * from t_vec order by id loop
    got := public.tk_month_rhythm_problem(r.j::jsonb);
    if got is distinct from r.problem then
      raise exception 'SELF-TEST FAILED: vector % expected %, got %', r.id, coalesce(r.problem, 'null'), coalesce(got, 'null');
    end if;
  end loop;
end $$;
select pg_temp.ok((select count(*) = 33 from t_vec), 'all 33 shared vectors agree with tk_month_rhythm_problem');
select pg_temp.ok(public.tk_month_rhythm_problem(null) = 'not_object', 'SQL null is not_object');
select pg_temp.ok(public.tk_month_rhythm_problem(public.tk_month_rhythm_default()) is null, 'the default is valid');

-- 2. No row: the reader falls back to 4/14/24, roll next -----------------------
delete from tk_settings where key = 'month_rhythm';   -- inside this rolled-back run only
select pg_temp.ok(public.tk_month_rhythm() = public.tk_month_rhythm_default(), 'missing row -> default');
select pg_temp.ok((public.tk_month_rhythm() #>> '{parts,1,day}') = '14' and public.tk_month_rhythm() ->> 'roll' = 'next', 'default is 14th for reports, roll next');

-- People
insert into t_ctx
select 'admin', lower(s.email) from staff s
 where s.active and s.role = 'admin'
   and not exists (select 1 from internal_access ia where lower(ia.staff_email) = lower(s.email) and ia.is_owner)
 order by s.email limit 1;
insert into t_ctx
select 'bk', lower(s.email) from staff s where s.active and s.role = 'bookkeeper' order by s.email limit 1;
select pg_temp.ok(pg_temp.ctx('admin') is not null and pg_temp.ctx('bk') is not null, 'test people found');

-- 3. Admin writes a valid rhythm; it is audited and read back ----------------
select pg_temp.as_user(pg_temp.ctx('admin'));
insert into t_ctx select 'audit0', count(*)::text from tk_settings_audit where key = 'month_rhythm';
insert into tk_settings (key, value)
values ('month_rhythm', '{"parts":[{"key":"check_in","label":"Check in","day":5},{"key":"reports","label":"Send reports","day":15},{"key":"follow_up","label":"Follow up","day":25}],"roll":"next"}')
on conflict (key) do update set value = excluded.value;
select pg_temp.ok((select count(*) from tk_settings_audit where key = 'month_rhythm') = pg_temp.ctx('audit0')::int + 1, 'admin save is audited');
select pg_temp.ok((select changed_by from tk_settings_audit where key = 'month_rhythm' order by id desc limit 1) = pg_temp.ctx('admin'), 'audit names the admin');
select pg_temp.ok((public.tk_month_rhythm() #>> '{parts,0,day}') = '5', 'reader returns the stored value');

-- 4. Invalid writes are refused, on insert and update -------------------------
select pg_temp.expect_err($q$update tk_settings set value = '{"parts":[{"key":"check_in","day":14},{"key":"reports","day":4},{"key":"follow_up","day":24}],"roll":"next"}' where key = 'month_rhythm'$q$,
  'tk_month_rhythm_invalid: day_order', 'update with days out of order is refused');
select pg_temp.expect_err($q$update tk_settings set value = '{"parts":[{"key":"check_in","day":4},{"key":"reports","day":14},{"key":"follow_up","day":31}],"roll":"next"}' where key = 'month_rhythm'$q$,
  'tk_month_rhythm_invalid: part_day', 'day 31 is refused');
select pg_temp.expect_err($q$update tk_settings set value = '"4,14,24"' where key = 'month_rhythm'$q$,
  'tk_month_rhythm_invalid: not_object', 'a string is refused');
-- key rename attempt: the existing trigger pins the key, so the guard reads old.key
select pg_temp.expect_err($q$update tk_settings set key = 'zz_rhythm_test', value = '{"roll":"next"}' where key = 'month_rhythm'$q$,
  'tk_month_rhythm_invalid: parts_missing', 'renaming the key does not dodge the guard');
select pg_temp.ok((public.tk_month_rhythm() #>> '{parts,0,day}') = '5', 'refused writes left the value alone');
-- other keys are not affected by the guard
insert into tk_settings (key, value) values ('zz_rhythm_test', '"anything"') on conflict (key) do update set value = excluded.value;
select pg_temp.ok(exists (select 1 from tk_settings where key = 'zz_rhythm_test'), 'other keys are not validated');
-- a row inserted invalid is refused too
delete from tk_settings where key = 'month_rhythm';
select pg_temp.expect_err($q$insert into tk_settings (key, value) values ('month_rhythm', '{"parts":[],"roll":"next"}')$q$,
  'tk_month_rhythm_invalid: parts_count', 'insert of an invalid value is refused');

-- 5. The firm switch is owner-only ---------------------------------------------
select pg_temp.expect_err($q$insert into tk_settings (key, value) values ('month_rhythm_enabled', 'true')$q$,
  'tk_owner_only', 'only the owner flips month_rhythm_enabled');
select pg_temp.ok(public.tk__owner_only_key('month_rhythm_enabled') and not public.tk__owner_only_key('month_rhythm'),
  'switch owner-only; the rhythm itself is admin write');
select pg_temp.ok(public.tk__owner_only_key('lato_enabled') and public.tk__owner_only_key('wb_enabled')
                  and public.tk__owner_only_key('late_tasks_count_against_staff'), 'earlier owner-only keys kept');

-- 6. RLS: a bookkeeper cannot write the rhythm (runs as the authenticated role)
select pg_temp.as_user(pg_temp.ctx('bk'));
set local role authenticated;
do $$
begin
  begin
    insert into public.tk_settings (key, value) values ('month_rhythm', public.tk_month_rhythm_default());
    perform set_config('mgb.t_bk_write', 'allowed', true);
  exception when others then
    perform set_config('mgb.t_bk_write', 'refused: ' || sqlerrm, true);
  end;
  perform set_config('mgb.t_bk_read', coalesce(public.tk_month_rhythm() ->> 'roll', '<null>'), true);
end $$;
reset role;
select pg_temp.ok(current_setting('mgb.t_bk_write', true) like 'refused:%row-level security%', 'bookkeeper write refused by RLS');
select pg_temp.ok(current_setting('mgb.t_bk_read', true) = 'next', 'bookkeeper reads the rhythm (default here)');

select pg_temp.as_user(null);
select 'slate-rhythm-1 self-test passed' as result;
rollback;
