-- =====================================================================
-- Slate month rhythm, slice 2: the firm_part due rule (2026-10-21)
-- Applied to production 2026-10-21 (migration slate_rhythm_2_firm_part);
-- self-test passed the same day. Before and after the apply, every template's
-- single-template preview (755, two dates), the test clients' runs and the
-- roster dry run gave byte-identical generator output.
-- Spec: docs/slate-rhythm-slice-2.md, docs/slate-month-rhythm.md
-- Self-test: supabase/slate-rhythm-2-firm-part-tests.sql (rolls back).
--
-- New due rule type, additive:
--   { "type": "firm_part", "part": "check_in" | "reports" | "follow_up",
--     "month_offset": 0..12 (optional, default 1) }
-- It resolves as day_of_month with that part's day and the rhythm's roll.
-- JS twin: TK_dueRuleValid / TK_resolveDue in components/tasks/TK_recurrenceLogic.js
-- (shared vectors: TK_RECURRENCE_RHYTHM_CASES / _RULE_VECTORS in
-- components/tasks/TK_recurrence.fixtures.js).
--
-- Changes:
--   tk_due_rule_valid(jsonb)        + firm_part (2 small edits; every other
--                                   input gives the same answer as before,
--                                   proved by the self-test against a verbatim
--                                   copy of the old function). Still IMMUTABLE:
--                                   it backs the task_templates_due_rule_check
--                                   CHECK constraint.
--   tk_resolve_due(jsonb,date,date) + one early branch: firm_part uses the firm
--                                   rhythm (tk_month_rhythm()). Nothing else in
--                                   the body changes.
--   tk_resolve_due(jsonb,date,date,jsonb)  NEW. The rhythm is passed in
--                                   (already merged client over firm). Other
--                                   rule types ignore it and return exactly the
--                                   3-argument result. Fails closed:
--                                   tk_month_rhythm_missing / tk_month_rhythm_invalid: <code>.
--   tk__rhythm_for_client(text)     NEW. Slice 5 hook: today it returns the firm
--                                   rhythm; slice 5 puts the client's override
--                                   (client_profile) in front of it. NULL = no
--                                   usable rhythm.
--   tk__generate                    patched (4 anchors): a firm_part template is
--                                   skipped unless tk_settings.month_rhythm_enabled
--                                   is on (a named test client or a single-template
--                                   preview may still try it); its due date uses
--                                   the client's rhythm; no usable rhythm =
--                                   that client is skipped and the run gets one
--                                   warning (other templates carry on). Every
--                                   other template takes the same call as before.
--   tk__issue_period                patched (1 anchor): firm_part uses
--                                   tk__rhythm_for_client(client); other rules
--                                   take the same call as before.
-- No table, no RLS change, no data written. No firm_part template exists, and
-- the template editor does not offer the type (TK_TPL_RULES_BY_CADENCE).
--
-- Rollback: restore tk_due_rule_valid and the 3-argument tk_resolve_due from
-- supabase/tasks-p2-1-calendar.sql (only after removing any firm_part rules,
-- or the CHECK constraint's rows would no longer pass), re-run the anchors
-- below in reverse, drop tk_resolve_due(jsonb,date,date,jsonb) and
-- tk__rhythm_for_client(text).
-- =====================================================================

-- Temporary helper (same as tasks-p2-7-ooo.sql).
create or replace function pg_temp.patch_fn(p_sig text, p_from text, p_to text, p_expected int)
returns void
language plpgsql
as $f$
declare
  d text;
  n int;
begin
  d := pg_get_functiondef(p_sig::regprocedure);
  if position(p_to in d) > 0 then
    return;  -- already patched
  end if;
  n := (length(d) - length(replace(d, p_from, ''))) / length(p_from);
  if n <> p_expected then
    raise exception 'patch_fn %: expected % occurrence(s) of anchor %, found %', p_sig, p_expected, p_from, n;
  end if;
  execute replace(d, p_from, p_to);
end
$f$;

-- 0. Guard: only replace the versions this file was written against --------
do $g$
declare
  v_valid text := (select md5(prosrc) from pg_proc where oid = 'public.tk_due_rule_valid(jsonb)'::regprocedure);
  v_res text := (select prosrc from pg_proc where oid = 'public.tk_resolve_due(jsonb,date,date)'::regprocedure);
begin
  if v_valid <> 'e4e81157c7f2c9f838592ccce19051e9'
     and position('slate rhythm s2' in (select prosrc from pg_proc where oid = 'public.tk_due_rule_valid(jsonb)'::regprocedure)) = 0 then
    raise exception 'tk_due_rule_valid changed since tasks-p2-1-calendar.sql (md5 %); rebase this migration', v_valid;
  end if;
  if md5(v_res) <> '2fa304c2e4f5d74a7b0b9f8eb0553208' and position('slate rhythm s2' in v_res) = 0 then
    raise exception 'tk_resolve_due(jsonb,date,date) changed since tasks-p2-1-calendar.sql; rebase this migration';
  end if;
  if to_regprocedure('public.tk_month_rhythm()') is null or to_regprocedure('public.tk_month_rhythm_problem(jsonb)') is null then
    raise exception 'run slate-rhythm-1-settings.sql first';
  end if;
end
$g$;

-- 1. The validator (same rules as TK_dueRuleValid) -----------------------------
create or replace function public.tk_due_rule_valid(p_rule jsonb)
returns boolean
language sql
immutable
set search_path = public
as $$
  select case
    when p_rule is null or jsonb_typeof(p_rule) = 'null' then true
    when jsonb_typeof(p_rule) <> 'object' then false
    else
      coalesce(
        (p_rule ->> 'type' <> 'offset' or public.tk__rule_int(p_rule, 'days', -90, 120, false))
        and (p_rule ->> 'type' not in ('business_day', 'day_of_month', 'eom', 'nth_weekday', 'firm_part')
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
          -- slate rhythm s2: the day and the roll come from the month rhythm, not the rule
          when 'firm_part' then jsonb_typeof(p_rule -> 'part') = 'string'
                                and p_rule ->> 'part' in ('check_in', 'reports', 'follow_up')
          else false
        end,
      false)
  end;
$$;

-- 2. The rhythm a client's firm_part tasks use --------------------------------
-- Slice 5 hook: replace this body with the client's override (client_profile,
-- same shape as month_rhythm) in front of the firm rhythm, e.g.
--   select coalesce(<client override merged over the firm value, when valid>,
--                   public.tk_month_rhythm())
-- NULL means no usable rhythm (fail closed). Callers: tk__generate,
-- tk__issue_period. Runs as the caller (both are SECURITY DEFINER).
create or replace function public.tk__rhythm_for_client(p_client text)
returns jsonb
language sql
stable
set search_path = public
as $$
  select public.tk_month_rhythm();
$$;

-- 3. Resolve with a rhythm (4 arguments) ---------------------------------------
-- Same order as TK_resolveDue: null rule -> null; bad rule -> 'invalid due
-- rule'; missing period -> null; then (firm_part only) the rhythm.
create or replace function public.tk_resolve_due(p_rule jsonb, p_period_start date, p_period_end date, p_rhythm jsonb)
returns date
language plpgsql
stable
set search_path = public
as $$
declare
  v_problem text;
  v_day int;
begin
  if p_rule is null or jsonb_typeof(p_rule) <> 'object' or p_rule ->> 'type' is distinct from 'firm_part' then
    return public.tk_resolve_due(p_rule, p_period_start, p_period_end);   -- every other rule: exactly as before
  end if;
  if not public.tk_due_rule_valid(p_rule) then
    raise exception 'invalid due rule' using errcode = '22023';
  end if;
  if p_period_start is null or p_period_end is null then
    return null;
  end if;
  if p_rhythm is null or jsonb_typeof(p_rhythm) = 'null' then
    raise exception 'tk_month_rhythm_missing' using errcode = '22023',
      hint = 'A firm_part due date needs the month rhythm (Settings, Firm settings, Month rhythm).';
  end if;
  v_problem := public.tk_month_rhythm_problem(p_rhythm);
  if v_problem is not null then
    raise exception 'tk_month_rhythm_invalid: %', v_problem using errcode = '22023';
  end if;
  select (p ->> 'day')::numeric::int into v_day
    from jsonb_array_elements(p_rhythm -> 'parts') p
   where p ->> 'key' = p_rule ->> 'part';
  return public.tk_resolve_due(
    jsonb_build_object('type', 'day_of_month', 'day', v_day,
                       'month_offset', coalesce((p_rule ->> 'month_offset')::numeric::int, 1),
                       'roll', p_rhythm ->> 'roll'),
    p_period_start, p_period_end);
end;
$$;

-- 4. Resolve (3 arguments): one early firm_part branch, the rest unchanged -----
create or replace function public.tk_resolve_due(p_rule jsonb, p_period_start date, p_period_end date)
returns date
language plpgsql
stable
set search_path = public
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
  if not public.tk_due_rule_valid(p_rule) then
    raise exception 'invalid due rule' using errcode = '22023';
  end if;
  if p_period_start is null or p_period_end is null then
    return null;
  end if;
  -- slate rhythm s2: firm_part takes its day and roll from the firm month rhythm
  -- (tk_month_rhythm; fails closed when it is unreadable). Callers that know the
  -- client use the 4-argument form with tk__rhythm_for_client(client).
  if p_rule ->> 'type' = 'firm_part' then
    return public.tk_resolve_due(p_rule, p_period_start, p_period_end, public.tk_month_rhythm());
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

-- 5. The generator ------------------------------------------------------------
select pg_temp.patch_fn('public.tk__generate(date,boolean,text,integer,text,uuid)',
$a$  v_max_hol date;
$a$,
$b$  v_max_hol date;
  v_rhythm jsonb;   -- slate rhythm s2
  v_rhythm_on boolean := coalesce(public.tk__jsonb_bool((select value from tk_settings where key = 'month_rhythm_enabled')), false);
  v_rhythm_skipped int := 0;
$b$, 1);

select pg_temp.patch_fn('public.tk__generate(date,boolean,text,integer,text,uuid)',
$a$      v_kind := v_eff ->> 'kind';
$a$,
$b$      v_kind := v_eff ->> 'kind';
      -- slate rhythm s2: firm_part takes its day from the client's month rhythm
      -- (tk__rhythm_for_client; slice 5 adds the client override). Nothing is made
      -- from one until the owner turns on month_rhythm_enabled (a named test client
      -- or a single-template preview may still try it). No usable rhythm: skip this
      -- client, one warning for the run.
      v_rhythm := null;
      if v_eff -> 'rule' ->> 'type' = 'firm_part' then
        if not (v_rhythm_on or p_only_template is not null or (p_client_id is not null and v_named_test)) then
          continue;
        end if;
        v_rhythm := public.tk__rhythm_for_client(c.id);
        if v_rhythm is null or public.tk_month_rhythm_problem(v_rhythm) is not null then
          v_rhythm_skipped := v_rhythm_skipped + 1;
          continue;
        end if;
      end if;
$b$, 1);

select pg_temp.patch_fn('public.tk__generate(date,boolean,text,integer,text,uuid)',
$a$        v_due := public.tk_resolve_due(v_eff -> 'rule', v_start, v_end);
$a$,
$b$        v_due := case when v_rhythm is null then public.tk_resolve_due(v_eff -> 'rule', v_start, v_end)
                      else public.tk_resolve_due(v_eff -> 'rule', v_start, v_end, v_rhythm) end;   -- slate rhythm s2
$b$, 1);

select pg_temp.patch_fn('public.tk__generate(date,boolean,text,integer,text,uuid)',
$a$  v_result := jsonb_build_object('created', v_created,$a$,
$b$  if v_rhythm_skipped > 0 then   -- slate rhythm s2
    v_warn := v_warn || to_jsonb('Month rhythm tasks were skipped because the month rhythm setting could not be read. An admin can save it again in Settings.'::text);
  end if;
  v_result := jsonb_build_object('created', v_created,$b$, 1);

select pg_temp.patch_fn('public.tk__issue_period(task_templates,jsonb,text,date,boolean)',
$a$  v_due := public.tk_resolve_due(p_eff -> 'rule', p_start, v_end);
$a$,
$b$  v_due := case when p_eff -> 'rule' ->> 'type' = 'firm_part'   -- slate rhythm s2: raises tk_month_rhythm_* without one
                then public.tk_resolve_due(p_eff -> 'rule', p_start, v_end, public.tk__rhythm_for_client(p_client))
                else public.tk_resolve_due(p_eff -> 'rule', p_start, v_end) end;
$b$, 1);

-- 6. Grants (same as the 3-argument form; the client hook is internal) ----------
revoke all on function public.tk_resolve_due(jsonb, date, date, jsonb) from public, anon, authenticated;
grant execute on function public.tk_resolve_due(jsonb, date, date, jsonb) to authenticated;
revoke all on function public.tk__rhythm_for_client(text) from public, anon, authenticated;

-- 7. Checks -----------------------------------------------------------------
do $c$
declare
  n int;
begin
  select count(*) into n from task_templates where due_rule is not null and not public.tk_due_rule_valid(due_rule);
  if n > 0 then raise exception 'slate rhythm s2: % template rule(s) no longer pass', n; end if;
  select count(*) into n from tk_client_template_overrides
   where jsonb_typeof(override -> 'due_rule') = 'object' and not public.tk_due_rule_valid(override -> 'due_rule');
  if n > 0 then raise exception 'slate rhythm s2: % override rule(s) no longer pass', n; end if;
  select count(*) into n from public.tk_recurrence_selftest();
  if n > 0 then raise exception 'slate rhythm s2: tk_recurrence_selftest has % failure(s)', n; end if;
  if position('slate rhythm s2' in pg_get_functiondef('public.tk__generate(date,boolean,text,integer,text,uuid)'::regprocedure)) = 0
     or position('slate rhythm s2' in pg_get_functiondef('public.tk__issue_period(task_templates,jsonb,text,date,boolean)'::regprocedure)) = 0 then
    raise exception 'slate rhythm s2: generator patch missing';
  end if;
end
$c$;

notify pgrst, 'reload schema';
