-- =====================================================================
-- Slate month rhythm, slice 2b: firm_part gate at the one write point (2026-10-21)
-- Applied to production 2026-10-21 (migration slate_rhythm_2b_issue_gate);
-- self-test passed the same day, and the slice 2 self-test still passes.
-- Run after supabase/slate-rhythm-2-firm-part.sql. Review fix, additive.
-- Self-test: supabase/slate-rhythm-2b-issue-gate-tests.sql (rolls back).
--
-- Why: slice 2 gates firm_part templates inside tk__generate only. The other
-- caller of tk__issue_period, tk_issue_missed (admin "Issue" on a missed
-- period), had no switch check, and a NULL rhythm from tk__rhythm_for_client
-- raised out of tk__issue_period (outside its exception block) instead of
-- returning a skip.
--
-- Change (1 anchor in tk__issue_period, the slice 2 firm_part line):
--   firm_part, real write (not a dry run), month_rhythm_enabled off, client is
--   not test_only / is_internal  -> {status: skipped, reason: rhythm_off}
--   firm_part, rhythm NULL or invalid -> {status: skipped, reason: no_rhythm}
--   firm_part otherwise -> tk_resolve_due(rule, start, end, tk__rhythm_for_client(client)),
--   same as slice 2.
-- Every other rule type takes exactly the same call as before. tk__generate
-- already applies the same gate and rhythm check before it calls
-- tk__issue_period, so its output does not change (checked: dry-run generator
-- output byte-identical before and after on two dates).
-- tk_issue_missed leaves the missed row open on 'skipped' and shows the reason.
-- No table, RLS, grant or cron change.
--
-- Rollback: re-run the anchor in reverse (swap the two texts below).
-- =====================================================================

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

select pg_temp.patch_fn('public.tk__issue_period(task_templates,jsonb,text,date,boolean)',
$a$  v_due := case when p_eff -> 'rule' ->> 'type' = 'firm_part'   -- slate rhythm s2: raises tk_month_rhythm_* without one
                then public.tk_resolve_due(p_eff -> 'rule', p_start, v_end, public.tk__rhythm_for_client(p_client))
                else public.tk_resolve_due(p_eff -> 'rule', p_start, v_end) end;
$a$,
$b$  if p_eff -> 'rule' ->> 'type' = 'firm_part' then   -- slate rhythm s2b: same gate as tk__generate, for every caller
    if not p_dry_run
       and not coalesce(public.tk__jsonb_bool((select value from tk_settings where key = 'month_rhythm_enabled')), false)
       and not exists (select 1 from clients cl
                        where cl.id = p_client and (coalesce(cl.test_only, false) or coalesce(cl.is_internal, false))) then
      return jsonb_build_object('status', 'skipped', 'reason', 'rhythm_off', 'label', v_label);
    end if;
    if public.tk__rhythm_for_client(p_client) is null
       or public.tk_month_rhythm_problem(public.tk__rhythm_for_client(p_client)) is not null then
      return jsonb_build_object('status', 'skipped', 'reason', 'no_rhythm', 'label', v_label);
    end if;
    v_due := public.tk_resolve_due(p_eff -> 'rule', p_start, v_end, public.tk__rhythm_for_client(p_client));
  else
    v_due := public.tk_resolve_due(p_eff -> 'rule', p_start, v_end);
  end if;
$b$, 1);

do $c$
declare
  d text := pg_get_functiondef('public.tk__issue_period(task_templates,jsonb,text,date,boolean)'::regprocedure);
begin
  if position('slate rhythm s2b' in d) = 0 then
    raise exception 'slate rhythm s2b: tk__issue_period patch missing';
  end if;
  if position('raises tk_month_rhythm_* without one' in d) > 0 then
    raise exception 'slate rhythm s2b: old slice 2 line still present';
  end if;
  if (select prosecdef from pg_proc where oid = 'public.tk__issue_period(task_templates,jsonb,text,date,boolean)'::regprocedure) is not true then
    raise exception 'slate rhythm s2b: tk__issue_period lost SECURITY DEFINER';
  end if;
end
$c$;
