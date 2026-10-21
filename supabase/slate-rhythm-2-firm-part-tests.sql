-- =====================================================================
-- Self-test for slate-rhythm-2-firm-part.sql (the firm_part due rule).
--
-- Run it whole after the migration; it ends in ROLLBACK, so nothing it writes
-- is kept (a test template, a month_rhythm row and the switch are written and
-- rolled back). The client is picked at run time; no names or emails live in
-- this file. A failed check raises and stops the run.
--
-- 1. The shared vectors (components/tasks/TK_recurrence.fixtures.js,
--    regenerate with: node components/tasks/TK_recurrenceLogic.test.js --sql-rhythm).
-- 2. Old-vs-new proof: verbatim copies of the pre-slice tk_due_rule_valid and
--    3-argument tk_resolve_due (from tasks-p2-1-calendar.sql) run against a
--    generated corpus; every rule that is not firm_part must get the same
--    answer from the new functions (both resolve forms).
-- 3. The 3-argument form follows the firm setting; the client hook returns it.
-- 4. The generator: nothing from a firm_part template while
--    month_rhythm_enabled is off; dates from the rhythm when on; skipped with
--    a warning when no rhythm can be read.
-- =====================================================================
begin;

create or replace function pg_temp.ok(p_cond boolean, p_what text) returns void language plpgsql as $$
begin
  if p_cond is not true then raise exception 'SELF-TEST FAILED: %', p_what; end if;
  raise notice 'ok: %', p_what;
end $$;

-- verbatim pre-slice copies (only the inner validator call is renamed)
create or replace function pg_temp.old_due_rule_valid(p_rule jsonb)
returns boolean
language sql
immutable
as $$
  select case
    when p_rule is null or jsonb_typeof(p_rule) = 'null' then true
    when jsonb_typeof(p_rule) <> 'object' then false
    else
      coalesce(
        (p_rule ->> 'type' <> 'offset' or public.tk__rule_int(p_rule, 'days', -90, 120, false))
        and (p_rule ->> 'type' not in ('business_day', 'day_of_month', 'eom', 'nth_weekday')
             or public.tk__rule_int(p_rule, 'month_offset', 0, 12, true))
        and (p_rule ->> 'type' not in ('day_of_month', 'nth_weekday')
             or p_rule -> 'roll' is null or jsonb_typeof(p_rule -> 'roll') = 'null'
             or (jsonb_typeof(p_rule -> 'roll') = 'string' and p_rule ->> 'roll' in ('next', 'prev', 'none')))
        and case p_rule ->> 'type'
          when 'offset' then true
          when 'business_day' then public.tk__rule_int(p_rule, 'n', 1, 23, false)
                                   or public.tk__rule_int(p_rule, 'n', -1, -1, false)
          when 'day_of_month' then public.tk__rule_int(p_rule, 'day', 1, 31, false)
          when 'eom' then public.tk__rule_int(p_rule, 'offset_bd', 0, 10, true)
          when 'nth_weekday' then (public.tk__rule_int(p_rule, 'n', 1, 5, false)
                                   or public.tk__rule_int(p_rule, 'n', -1, -1, false))
                                  and public.tk__rule_int(p_rule, 'dow', 1, 7, false)
          when 'weekday' then public.tk__rule_int(p_rule, 'dow', 1, 7, false)
          else false
        end,
      false)
  end;
$$;

create or replace function pg_temp.old_resolve_due(p_rule jsonb, p_period_start date, p_period_end date)
returns date
language plpgsql
stable
as $$
declare
  v_type text;
  v_target date;
  v_dim int;
  v_n int;
  v_dow int;
  d int;
  v_monday date;
begin
  if p_rule is null or jsonb_typeof(p_rule) = 'null' then
    return null;
  end if;
  if not pg_temp.old_due_rule_valid(p_rule) then
    raise exception 'invalid due rule' using errcode = '22023';
  end if;
  if p_period_start is null or p_period_end is null then
    return null;
  end if;
  v_type := p_rule ->> 'type';
  v_target := (date_trunc('month', p_period_end)
               + make_interval(months => coalesce((p_rule ->> 'month_offset')::int, 1)))::date;
  v_dim := extract(day from (v_target + interval '1 month' - interval '1 day'))::int;

  if v_type = 'offset' then
    return p_period_end + (p_rule ->> 'days')::int;
  elsif v_type = 'business_day' then
    return public.tk_business_day_of_month(v_target, (p_rule ->> 'n')::int);
  elsif v_type = 'day_of_month' then
    return public.tk_roll(v_target + (least((p_rule ->> 'day')::int, v_dim) - 1),
                          coalesce(p_rule ->> 'roll', 'next'));
  elsif v_type = 'eom' then
    return public.tk_add_business_days(public.tk_business_day_of_month(v_target, -1),
                                       -coalesce((p_rule ->> 'offset_bd')::int, 0));
  elsif v_type = 'nth_weekday' then
    v_n := (p_rule ->> 'n')::int;
    v_dow := (p_rule ->> 'dow')::int;
    if v_n = -1 then
      d := v_dim;
      while extract(isodow from v_target + (d - 1))::int <> v_dow loop
        d := d - 1;
      end loop;
    else
      d := 1;
      while extract(isodow from v_target + (d - 1))::int <> v_dow loop
        d := d + 1;
      end loop;
      d := d + 7 * (v_n - 1);
      if d > v_dim then
        d := d - 7; -- no 5th one this month: the last one
      end if;
    end if;
    return public.tk_roll(v_target + (d - 1), coalesce(p_rule ->> 'roll', 'none'));
  elsif v_type = 'weekday' then
    v_monday := p_period_start - (extract(isodow from p_period_start)::int - 1);
    return public.tk_roll(v_monday + ((p_rule ->> 'dow')::int - 1), 'next');
  end if;
  return null;
end;
$$;

-- 1. Shared vectors -----------------------------------------------------------
create temp table t_res (id text primary key, rule jsonb, rhythm jsonb, s date, e date, expected text) on commit drop;
insert into t_res (id, rule, rhythm, s, e, expected) values
      ('fp_checkin_sunday_next', '{"type":"firm_part","part":"check_in","month_offset":1}'::jsonb, '{"parts":[{"key":"check_in","label":"Check in","day":4},{"key":"reports","label":"Send reports","day":14},{"key":"follow_up","label":"Follow up","day":24}],"roll":"next"}'::jsonb, '2026-09-01'::date, '2026-09-30'::date, '2026-10-05'::text),
      ('fp_reports_wednesday', '{"type":"firm_part","part":"reports","month_offset":1}'::jsonb, '{"parts":[{"key":"check_in","label":"Check in","day":4},{"key":"reports","label":"Send reports","day":14},{"key":"follow_up","label":"Follow up","day":24}],"roll":"next"}'::jsonb, '2026-09-01'::date, '2026-09-30'::date, '2026-10-14'::text),
      ('fp_followup_saturday_next', '{"type":"firm_part","part":"follow_up","month_offset":1}'::jsonb, '{"parts":[{"key":"check_in","label":"Check in","day":4},{"key":"reports","label":"Send reports","day":14},{"key":"follow_up","label":"Follow up","day":24}],"roll":"next"}'::jsonb, '2026-09-01'::date, '2026-09-30'::date, '2026-10-26'::text),
      ('fp_followup_saturday_prev', '{"type":"firm_part","part":"follow_up","month_offset":1}'::jsonb, '{"parts":[{"key":"check_in","label":"Check in","day":4},{"key":"reports","label":"Send reports","day":14},{"key":"follow_up","label":"Follow up","day":24}],"roll":"prev"}'::jsonb, '2026-09-01'::date, '2026-09-30'::date, '2026-10-23'::text),
      ('fp_followup_saturday_none', '{"type":"firm_part","part":"follow_up","month_offset":1}'::jsonb, '{"parts":[{"key":"check_in","label":"Check in","day":4},{"key":"reports","label":"Send reports","day":14},{"key":"follow_up","label":"Follow up","day":24}],"roll":"none"}'::jsonb, '2026-09-01'::date, '2026-09-30'::date, '2026-10-24'::text),
      ('fp_no_month_offset_means_1', '{"type":"firm_part","part":"reports"}'::jsonb, '{"parts":[{"key":"check_in","label":"Check in","day":4},{"key":"reports","label":"Send reports","day":14},{"key":"follow_up","label":"Follow up","day":24}],"roll":"next"}'::jsonb, '2026-11-01'::date, '2026-11-30'::date, '2026-12-14'::text),
      ('fp_month_offset_null_means_1', '{"type":"firm_part","part":"reports","month_offset":null}'::jsonb, '{"parts":[{"key":"check_in","label":"Check in","day":4},{"key":"reports","label":"Send reports","day":14},{"key":"follow_up","label":"Follow up","day":24}],"roll":"next"}'::jsonb, '2026-11-01'::date, '2026-11-30'::date, '2026-12-14'::text),
      ('fp_month_offset_0', '{"type":"firm_part","part":"check_in","month_offset":0}'::jsonb, '{"parts":[{"key":"check_in","label":"Check in","day":4},{"key":"reports","label":"Send reports","day":14},{"key":"follow_up","label":"Follow up","day":24}],"roll":"next"}'::jsonb, '2026-10-01'::date, '2026-10-31'::date, '2026-10-05'::text),
      ('fp_thanksgiving_run', '{"type":"firm_part","part":"reports","month_offset":1}'::jsonb, '{"parts":[{"key":"check_in","label":"Check in","day":4},{"key":"reports","label":"Send reports","day":26},{"key":"follow_up","label":"Follow up","day":27}],"roll":"next"}'::jsonb, '2026-10-01'::date, '2026-10-31'::date, '2026-11-30'::text),
      ('fp_day_after_thanksgiving', '{"type":"firm_part","part":"follow_up","month_offset":1}'::jsonb, '{"parts":[{"key":"check_in","label":"Check in","day":4},{"key":"reports","label":"Send reports","day":26},{"key":"follow_up","label":"Follow up","day":27}],"roll":"next"}'::jsonb, '2026-10-01'::date, '2026-10-31'::date, '2026-11-30'::text),
      ('fp_christmas_eve_prev', '{"type":"firm_part","part":"reports","month_offset":1}'::jsonb, '{"parts":[{"key":"check_in","label":"Check in","day":3},{"key":"reports","label":"Send reports","day":24},{"key":"follow_up","label":"Follow up","day":28}],"roll":"prev"}'::jsonb, '2026-11-01'::date, '2026-11-30'::date, '2026-12-23'::text),
      ('fp_new_year_next', '{"type":"firm_part","part":"check_in","month_offset":1}'::jsonb, '{"parts":[{"key":"check_in","label":"Check in","day":1},{"key":"reports","label":"Send reports","day":14},{"key":"follow_up","label":"Follow up","day":24}],"roll":"next"}'::jsonb, '2026-12-01'::date, '2026-12-31'::date, '2027-01-04'::text),
      ('fp_good_friday_prev', '{"type":"firm_part","part":"check_in","month_offset":1}'::jsonb, '{"parts":[{"key":"check_in","label":"Check in","day":3},{"key":"reports","label":"Send reports","day":14},{"key":"follow_up","label":"Follow up","day":24}],"roll":"prev"}'::jsonb, '2026-03-01'::date, '2026-03-31'::date, '2026-04-02'::text),
      ('fp_quarter_offset_2', '{"type":"firm_part","part":"reports","month_offset":2}'::jsonb, '{"parts":[{"key":"check_in","label":"Check in","day":4},{"key":"reports","label":"Send reports","day":14},{"key":"follow_up","label":"Follow up","day":24}],"roll":"next"}'::jsonb, '2026-07-01'::date, '2026-09-30'::date, '2026-11-16'::text),
      ('fp_feb_28_sunday_none', '{"type":"firm_part","part":"follow_up","month_offset":1}'::jsonb, '{"parts":[{"key":"check_in","label":"Check in","day":4},{"key":"reports","label":"Send reports","day":14},{"key":"follow_up","label":"Follow up","day":28}],"roll":"none"}'::jsonb, '2027-01-01'::date, '2027-01-31'::date, '2027-02-28'::text),
      ('fp_juneteenth_monday', '{"type":"firm_part","part":"reports","month_offset":1}'::jsonb, '{"parts":[{"key":"check_in","label":"Check in","day":4},{"key":"reports","label":"Send reports","day":19},{"key":"follow_up","label":"Follow up","day":24}],"roll":"next"}'::jsonb, '2028-05-01'::date, '2028-05-31'::date, '2028-06-20'::text),
      ('fp_rule_roll_ignored', '{"type":"firm_part","part":"follow_up","month_offset":1,"roll":"prev"}'::jsonb, '{"parts":[{"key":"check_in","label":"Check in","day":4},{"key":"reports","label":"Send reports","day":14},{"key":"follow_up","label":"Follow up","day":24}],"roll":"next"}'::jsonb, '2026-09-01'::date, '2026-09-30'::date, '2026-10-26'::text),
      ('fp_rhythm_extra_fields', '{"type":"firm_part","part":"check_in","month_offset":1}'::jsonb, '{"parts":[{"key":"check_in","label":"Check in","day":4},{"key":"reports","label":"Send reports","day":14},{"key":"follow_up","label":"Follow up","day":24}],"roll":"next","note":"x"}'::jsonb, '2026-09-01'::date, '2026-09-30'::date, '2026-10-05'::text),
      ('fp_rhythm_no_labels', '{"type":"firm_part","part":"reports","month_offset":1}'::jsonb, '{"parts":[{"key":"check_in","day":5},{"key":"reports","day":15},{"key":"follow_up","day":25}],"roll":"next"}'::jsonb, '2026-09-01'::date, '2026-09-30'::date, '2026-10-15'::text),
      ('fp_month_offset_12', '{"type":"firm_part","part":"check_in","month_offset":12}'::jsonb, '{"parts":[{"key":"check_in","label":"Check in","day":4},{"key":"reports","label":"Send reports","day":14},{"key":"follow_up","label":"Follow up","day":24}],"roll":"next"}'::jsonb, '2026-09-01'::date, '2026-09-30'::date, '2027-09-07'::text),
      ('fp_err_rhythm_missing', '{"type":"firm_part","part":"reports","month_offset":1}'::jsonb, null::jsonb, '2026-09-01'::date, '2026-09-30'::date, 'error:tk_month_rhythm_missing'::text),
      ('fp_err_days_out_of_order', '{"type":"firm_part","part":"reports","month_offset":1}'::jsonb, '{"parts":[{"key":"check_in","label":"Check in","day":14},{"key":"reports","label":"Send reports","day":4},{"key":"follow_up","label":"Follow up","day":24}],"roll":"next"}'::jsonb, '2026-09-01'::date, '2026-09-30'::date, 'error:tk_month_rhythm_invalid: day_order'::text),
      ('fp_err_bad_roll', '{"type":"firm_part","part":"reports","month_offset":1}'::jsonb, '{"parts":[{"key":"check_in","label":"Check in","day":4},{"key":"reports","label":"Send reports","day":14},{"key":"follow_up","label":"Follow up","day":24}],"roll":"later"}'::jsonb, '2026-09-01'::date, '2026-09-30'::date, 'error:tk_month_rhythm_invalid: roll'::text),
      ('fp_err_day_29', '{"type":"firm_part","part":"follow_up","month_offset":1}'::jsonb, '{"parts":[{"key":"check_in","label":"Check in","day":4},{"key":"reports","label":"Send reports","day":14},{"key":"follow_up","label":"Follow up","day":29}],"roll":"next"}'::jsonb, '2026-09-01'::date, '2026-09-30'::date, 'error:tk_month_rhythm_invalid: part_day'::text),
      ('fp_err_two_parts', '{"type":"firm_part","part":"check_in","month_offset":1}'::jsonb, '{"parts":[{"key":"check_in","day":4},{"key":"reports","day":14}],"roll":"next"}'::jsonb, '2026-09-01'::date, '2026-09-30'::date, 'error:tk_month_rhythm_invalid: parts_count'::text),
      ('fp_err_rhythm_array', '{"type":"firm_part","part":"check_in","month_offset":1}'::jsonb, '[4,14,24]'::jsonb, '2026-09-01'::date, '2026-09-30'::date, 'error:tk_month_rhythm_invalid: not_object'::text),
      ('fp_err_bad_rule', '{"type":"firm_part","part":"middle","month_offset":1}'::jsonb, '{"parts":[{"key":"check_in","label":"Check in","day":4},{"key":"reports","label":"Send reports","day":14},{"key":"follow_up","label":"Follow up","day":24}],"roll":"next"}'::jsonb, '2026-09-01'::date, '2026-09-30'::date, 'error:invalid due rule'::text),
      ('fp_dom_ignores_null_rhythm', '{"type":"day_of_month","day":15}'::jsonb, null::jsonb, '2026-09-01'::date, '2026-09-30'::date, '2026-10-15'::text),
      ('fp_dom_ignores_bad_rhythm', '{"type":"day_of_month","day":15}'::jsonb, '{"parts":[{"key":"check_in","label":"Check in","day":14},{"key":"reports","label":"Send reports","day":4},{"key":"follow_up","label":"Follow up","day":24}],"roll":"later"}'::jsonb, '2026-09-01'::date, '2026-09-30'::date, '2026-10-15'::text),
      ('fp_bd_ignores_rhythm', '{"type":"business_day","n":10}'::jsonb, '{"parts":[{"key":"check_in","label":"Check in","day":4},{"key":"reports","label":"Send reports","day":14},{"key":"follow_up","label":"Follow up","day":24}],"roll":"next"}'::jsonb, '2026-09-01'::date, '2026-09-30'::date, '2026-10-15'::text),
      ('fp_weekday_ignores_rhythm', '{"type":"weekday","dow":5}'::jsonb, null::jsonb, '2026-12-28'::date, '2027-01-03'::date, '2027-01-04'::text),
      ('fp_null_rule_is_null', null::jsonb, '{"parts":[{"key":"check_in","label":"Check in","day":4},{"key":"reports","label":"Send reports","day":14},{"key":"follow_up","label":"Follow up","day":24}],"roll":"next"}'::jsonb, '2026-09-01'::date, '2026-09-30'::date, null::text);

create temp table t_vec (id text primary key, rule jsonb, valid boolean) on commit drop;
insert into t_vec (id, rule, valid) values
      ('frv_checkin', '{"type":"firm_part","part":"check_in","month_offset":1}'::jsonb, true),
      ('frv_reports_no_offset', '{"type":"firm_part","part":"reports"}'::jsonb, true),
      ('frv_followup_offset0', '{"type":"firm_part","part":"follow_up","month_offset":0}'::jsonb, true),
      ('frv_offset12', '{"type":"firm_part","part":"reports","month_offset":12}'::jsonb, true),
      ('frv_offset_null', '{"type":"firm_part","part":"reports","month_offset":null}'::jsonb, true),
      ('frv_extra_roll_ignored', '{"type":"firm_part","part":"reports","roll":"sideways"}'::jsonb, true),
      ('frv_no_part', '{"type":"firm_part","month_offset":1}'::jsonb, false),
      ('frv_part_null', '{"type":"firm_part","part":null}'::jsonb, false),
      ('frv_part_unknown', '{"type":"firm_part","part":"middle"}'::jsonb, false),
      ('frv_part_case', '{"type":"firm_part","part":"Check_in"}'::jsonb, false),
      ('frv_part_number', '{"type":"firm_part","part":1}'::jsonb, false),
      ('frv_part_array', '{"type":"firm_part","part":["reports"]}'::jsonb, false),
      ('frv_part_label', '{"type":"firm_part","part":"Send reports"}'::jsonb, false),
      ('frv_offset13', '{"type":"firm_part","part":"reports","month_offset":13}'::jsonb, false),
      ('frv_offset_neg', '{"type":"firm_part","part":"reports","month_offset":-1}'::jsonb, false),
      ('frv_offset_fraction', '{"type":"firm_part","part":"reports","month_offset":1.5}'::jsonb, false),
      ('frv_offset_string', '{"type":"firm_part","part":"reports","month_offset":"1"}'::jsonb, false),
      ('frv_type_typo', '{"type":"firm_parts","part":"reports"}'::jsonb, false),
      ('frv_type_case', '{"type":"Firm_part","part":"reports"}'::jsonb, false);

do $v$
declare
  r record;
  v_got text;
  v_bad text := '';
  n int := 0;
begin
  for r in select * from t_res order by id loop
    begin
      v_got := public.tk_resolve_due(r.rule, r.s, r.e, r.rhythm)::text;
    exception when others then
      v_got := 'error:' || sqlerrm;
    end;
    if v_got is distinct from r.expected then
      v_bad := v_bad || format(' %s: expected %s, got %s;', r.id, coalesce(r.expected, 'null'), coalesce(v_got, 'null'));
    end if;
    n := n + 1;
  end loop;
  for r in select * from t_vec order by id loop
    if public.tk_due_rule_valid(r.rule) is distinct from r.valid then
      v_bad := v_bad || format(' %s: expected valid=%s;', r.id, r.valid);
    end if;
    n := n + 1;
  end loop;
  if v_bad <> '' then raise exception 'SELF-TEST FAILED: vectors:%', v_bad; end if;
  raise notice 'ok: % shared vectors', n;
end $v$;

select pg_temp.ok((select count(*) from t_res) >= 25 and (select count(*) from t_vec) >= 15, 'vector tables loaded');
select pg_temp.ok(not exists (select 1 from public.tk_recurrence_selftest()), 'tk_recurrence_selftest: all old calendar fixtures pass');

-- 2. Old vs new -----------------------------------------------------------------
create temp table t_corpus (rule jsonb) on commit drop;
with ty(t) as (values ('"offset"'), ('"business_day"'), ('"day_of_month"'), ('"eom"'), ('"nth_weekday"'),
                      ('"weekday"'), ('"firm_part"'), ('"monthly"'), ('""'), ('5'), (null)),
     k(k) as (values ('days'), ('n'), ('day'), ('dow'), ('offset_bd'), ('month_offset'), ('roll'), ('part')),
     v(v) as (values ('null'), ('-91'), ('-90'), ('-2'), ('-1'), ('0'), ('1'), ('1.0'), ('1.5'), ('2'), ('5'), ('7'), ('8'),
                     ('10'), ('11'), ('12'), ('13'), ('23'), ('24'), ('28'), ('31'), ('32'), ('120'), ('121'), ('"5"'),
                     ('"next"'), ('"prev"'), ('"none"'), ('"later"'), ('true'), ('"reports"'), ('"check_in"'), ('[1]'), ('{}')),
     kv as (select k.k, v.v from k cross join v),
     base as (select case when t is null then '{}'::jsonb else jsonb_build_object('type', t::jsonb) end as b from ty)
insert into t_corpus (rule)
select b from base
union all select b || jsonb_build_object(a.k, a.v::jsonb) from base cross join kv a
union all select b || jsonb_build_object(a.k, a.v::jsonb, c.k, c.v::jsonb)
  from base cross join kv a cross join kv c where a.k < c.k
union all select x::jsonb from (values ('[]'), ('"x"'), ('1'), ('true'), ('null'), ('[{"type":"offset","days":1}]')) s(x)
union all select null
union all select due_rule from task_templates
union all select override -> 'due_rule' from tk_client_template_overrides where override ? 'due_rule';

do $p$
declare
  n_all int;
  n_diff int;
  n_fp_new int;
  r record;
begin
  select count(*) into n_all from t_corpus;
  select count(*) into n_diff from t_corpus
   where (rule ->> 'type' is distinct from 'firm_part' or jsonb_typeof(rule) <> 'object')
     and pg_temp.old_due_rule_valid(rule) is distinct from public.tk_due_rule_valid(rule);
  if n_diff > 0 then
    select rule into r from t_corpus
     where (rule ->> 'type' is distinct from 'firm_part' or jsonb_typeof(rule) <> 'object')
       and pg_temp.old_due_rule_valid(rule) is distinct from public.tk_due_rule_valid(rule) limit 1;
    raise exception 'SELF-TEST FAILED: tk_due_rule_valid changed for % non-firm_part input(s), e.g. %', n_diff, r.rule;
  end if;
  -- firm_part: the old function refused every one; the new one accepts exactly the valid shapes
  select count(*) into n_fp_new from t_corpus where rule ->> 'type' = 'firm_part' and public.tk_due_rule_valid(rule);
  if exists (select 1 from t_corpus where rule ->> 'type' = 'firm_part' and pg_temp.old_due_rule_valid(rule)) then
    raise exception 'SELF-TEST FAILED: the old validator accepted a firm_part rule';
  end if;
  raise notice 'ok: validator identical on % corpus inputs (% firm_part shapes now valid)', n_all, n_fp_new;
end $p$;

-- Resolve: every old-valid rule from a sample of the corpus plus all live rules, over 8 periods.
create temp table t_rules on commit drop as
select distinct rule from t_corpus
 where rule is not null and pg_temp.old_due_rule_valid(rule) and rule ->> 'type' is distinct from 'firm_part'
   and (abs(hashtext(rule::text)) % 25 = 0
        or rule in (select due_rule from task_templates where due_rule is not null));
create temp table t_periods (s date, e date) on commit drop;
insert into t_periods values ('2026-09-01', '2026-09-30'), ('2026-11-01', '2026-11-30'), ('2026-12-01', '2026-12-31'),
  ('2027-01-01', '2027-01-31'), ('2028-01-01', '2028-01-31'), ('2026-07-01', '2026-09-30'), ('2026-12-28', '2027-01-03'),
  ('2026-07-01', '2027-06-30');

-- Errors count as answers: a rule such as {"type":"day_of_month","day":1.0} passes the
-- validator but has always raised in the ::int cast (pre-existing); it must still raise
-- the same way.
create or replace function pg_temp.res_old(p_rule jsonb, s date, e date) returns text language plpgsql as $$
begin
  return pg_temp.old_resolve_due(p_rule, s, e)::text;
exception when others then
  return 'error:' || sqlerrm;
end $$;
create or replace function pg_temp.res_new(p_rule jsonb, s date, e date, p_four boolean, p_rhythm jsonb) returns text language plpgsql as $$
begin
  if p_four then
    return public.tk_resolve_due(p_rule, s, e, p_rhythm)::text;
  end if;
  return public.tk_resolve_due(p_rule, s, e)::text;
exception when others then
  return 'error:' || sqlerrm;
end $$;

do $q$
declare
  n int;
  n_err int;
  n_diff int;
begin
  select count(*), count(*) filter (where pg_temp.res_old(rule, p.s, p.e) like 'error:%')
    into n, n_err from t_rules cross join t_periods p;
  select count(*) into n_diff
    from t_rules cross join t_periods p
   where pg_temp.res_old(rule, p.s, p.e) is distinct from pg_temp.res_new(rule, p.s, p.e, false, null)
      or pg_temp.res_old(rule, p.s, p.e) is distinct from pg_temp.res_new(rule, p.s, p.e, true, null)
      or pg_temp.res_old(rule, p.s, p.e) is distinct from pg_temp.res_new(rule, p.s, p.e, true, public.tk_month_rhythm_default())
      or pg_temp.res_old(rule, p.s, p.e) is distinct from pg_temp.res_new(rule, p.s, p.e, true, '{"parts":[],"roll":"x"}'::jsonb);
  if n_diff > 0 then
    raise exception 'SELF-TEST FAILED: tk_resolve_due changed for % old rule/period pair(s)', n_diff;
  end if;
  raise notice 'ok: tk_resolve_due (3 and 4 arguments) identical to the old one on % rule/period pairs (% raise in both)', n, n_err;
end $q$;

select pg_temp.ok((select count(*) from t_rules) >= 200, 'resolve sample is large enough');
select pg_temp.ok(public.tk_resolve_due(null, '2026-09-01', '2026-09-30', public.tk_month_rhythm_default()) is null
                  and public.tk_resolve_due('null'::jsonb, '2026-09-01', '2026-09-30', null) is null, 'null rule is null with a rhythm');

-- 3. The 3-argument form and the client hook follow the firm setting ------------------
insert into tk_settings (key, value)
values ('month_rhythm', '{"parts":[{"key":"check_in","day":5},{"key":"reports","day":15},{"key":"follow_up","day":25}],"roll":"prev"}')
on conflict (key) do update set value = excluded.value;
select pg_temp.ok(public.tk_resolve_due('{"type":"firm_part","part":"reports"}', '2026-09-01', '2026-09-30') = '2026-10-15'
                  and public.tk_resolve_due('{"type":"firm_part","part":"follow_up"}', '2026-09-01', '2026-09-30') = '2026-10-23',
                  '3-argument firm_part uses the firm setting (15th; 25th Sunday rolls back to Friday)');
select pg_temp.ok(public.tk__rhythm_for_client('any-client') = public.tk_month_rhythm(), 'client hook returns the firm rhythm (slice 5 adds overrides)');
select pg_temp.ok(not has_function_privilege('authenticated', 'public.tk__rhythm_for_client(text)', 'execute')
                  and not has_function_privilege('anon', 'public.tk__rhythm_for_client(text)', 'execute')
                  and has_function_privilege('authenticated', 'public.tk_resolve_due(jsonb,date,date,jsonb)', 'execute')
                  and not has_function_privilege('anon', 'public.tk_resolve_due(jsonb,date,date,jsonb)', 'execute'),
                  'grants: hook internal, 4-argument resolve for signed-in users only');
select pg_temp.ok((select provolatile = 'i' from pg_proc where oid = 'public.tk_due_rule_valid(jsonb)'::regprocedure),
                  'tk_due_rule_valid is still immutable (CHECK constraint)');

-- 4. The generator --------------------------------------------------------------------
create temp table t_ctx (k text primary key, v text) on commit drop;
insert into t_ctx
select 'client', cl.id from clients cl
 where public.is_roster_client(cl) and not coalesce(cl.test_only, false) and not coalesce(cl.is_internal, false)
   and exists (select 1 from public.tk__client_people(cl.id) p where p.role = 'bookkeeper')
 order by cl.id limit 1;
select pg_temp.ok((select count(*) from t_ctx) = 1, 'picked a roster client with a bookkeeper');

insert into tk_settings (key, value) values ('month_rhythm', public.tk_month_rhythm_default())
on conflict (key) do update set value = excluded.value;   -- the test template is checked against this
select set_config('mgb.tk_owner_override', 'on', true);
insert into tk_settings (key, value) values ('month_rhythm_enabled', 'false')
on conflict (key) do update set value = excluded.value;

create or replace function pg_temp.hits(r jsonb, p_tpl uuid) returns setof jsonb language sql as $$
  select e from jsonb_each(r) l(k, v), jsonb_array_elements(case when jsonb_typeof(l.v) = 'array' then l.v else '[]' end) e
   where l.k in ('would_create', 'upcoming', 'skipped', 'missed', 'created') and e ->> 'template' = p_tpl::text
$$;
-- dates the generator listed for the template, each checked against the given rhythm; returns how many were checked
create or replace function pg_temp.check_dues(r jsonb, p_tpl uuid, p_rule jsonb, p_rhythm jsonb) returns int language plpgsql as $$
declare e jsonb; n int := 0; v_p date; v_want date;
begin
  for e in select * from pg_temp.hits(r, p_tpl) loop
    if e ? 'due' and e ? 'period' then
      v_p := (e ->> 'period')::date;
      v_want := public.tk_resolve_due(p_rule, v_p, (v_p + interval '1 month' - interval '1 day')::date, p_rhythm);
      if (e ->> 'due')::date is distinct from v_want then
        raise exception 'SELF-TEST FAILED: generator due % for period %, expected %', e ->> 'due', v_p, v_want;
      end if;
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

do $g$
declare
  v_client text := (select v from t_ctx where k = 'client');
  v_rule jsonb := '{"type":"firm_part","part":"reports","month_offset":1}';
  v_tpl uuid;
  r jsonb;
  n int;
begin
  insert into task_templates (title, cadence, due_rule, lead_days, client_ids, status, active, activated_at)
  values ('Slice 2 self-test', 'monthly', v_rule, 40, array[v_client], 'active', true, now() - interval '200 days')
  returning id into v_tpl;

  -- switch off: the cron path and a named real client list nothing for it
  r := public.tk__generate('2026-10-01', true, null, 60, 'self-test');
  if exists (select 1 from pg_temp.hits(r, v_tpl)) then
    raise exception 'SELF-TEST FAILED: firm_part template listed while month_rhythm_enabled is off';
  end if;
  r := public.tk__generate('2026-10-01', true, v_client, 60, 'self-test');
  if exists (select 1 from pg_temp.hits(r, v_tpl)) then
    raise exception 'SELF-TEST FAILED: firm_part template listed for a real client while the switch is off';
  end if;
  raise notice 'ok: switch off, the generator lists nothing from a firm_part template';

  -- switch off, single-template preview: allowed (dry run only), dates from the rhythm
  r := public.tk__generate('2026-10-01', true, null, 60, 'self-test', v_tpl);
  n := pg_temp.check_dues(r, v_tpl, v_rule, public.tk_month_rhythm());
  if n < 1 or (r ->> 'dry_run')::boolean is not true then
    raise exception 'SELF-TEST FAILED: single-template preview listed % dated row(s)', n;
  end if;
  raise notice 'ok: single-template preview works with the switch off (% rows, dry run)', n;

  -- switch on: listed, dates follow the default rhythm, then a changed firm rhythm
  update tk_settings set value = 'true' where key = 'month_rhythm_enabled';
  r := public.tk__generate('2026-10-01', true, null, 60, 'self-test');
  n := pg_temp.check_dues(r, v_tpl, v_rule, public.tk_month_rhythm_default());
  if n < 1 then raise exception 'SELF-TEST FAILED: switch on, nothing listed for the firm_part template'; end if;
  if not exists (select 1 from pg_temp.hits(r, v_tpl) e where e ->> 'due' = '2026-10-14') then
    raise exception 'SELF-TEST FAILED: switch on, September reports not due 2026-10-14 (default rhythm)';
  end if;
  raise notice 'ok: switch on, % rows dated by the default rhythm', n;

  update tk_settings
     set value = '{"parts":[{"key":"check_in","day":5},{"key":"reports","day":15},{"key":"follow_up","day":25}],"roll":"prev"}'
   where key = 'month_rhythm';
  r := public.tk__generate('2026-10-01', true, null, 60, 'self-test');
  n := pg_temp.check_dues(r, v_tpl, v_rule, public.tk_month_rhythm());
  if n < 1 or not exists (select 1 from pg_temp.hits(r, v_tpl) e where e ->> 'due' = '2026-10-15') then
    raise exception 'SELF-TEST FAILED: changed firm rhythm not used by the generator';
  end if;
  raise notice 'ok: generator follows the saved firm rhythm (% rows)', n;

  -- no usable rhythm: skipped with one warning, the rest of the run goes on
  execute $f$create or replace function public.tk__rhythm_for_client(p_client text) returns jsonb
             language sql stable set search_path = public as 'select null::jsonb'$f$;
  r := public.tk__generate('2026-10-01', true, null, 60, 'self-test');
  if exists (select 1 from pg_temp.hits(r, v_tpl)) then
    raise exception 'SELF-TEST FAILED: listed a firm_part task with no usable rhythm';
  end if;
  if position('Month rhythm tasks were skipped' in coalesce(r ->> 'warnings', '')) = 0 then
    raise exception 'SELF-TEST FAILED: no warning when the rhythm could not be read: %', r -> 'warnings';
  end if;
  if (select count(*) from jsonb_array_elements(r -> 'warnings') w where w::text like '%Month rhythm tasks were skipped%') <> 1 then
    raise exception 'SELF-TEST FAILED: expected exactly one rhythm warning';
  end if;
  raise notice 'ok: no usable rhythm, skipped with one warning';
end $g$;

select 'slate-rhythm-2 self-test passed' as result;
rollback;
