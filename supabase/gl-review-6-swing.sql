-- ============================================================================
-- GL Review: Month swing is month-dependent
-- ----------------------------------------------------------------------------
-- The new "swing" check (components/ledger/GLR_checks.js, swingHits) compares
-- the review month with the months before it, so, like recon_uncleared, a pull
-- that no longer produces the flag does not mean it is fixed (the next pull
-- reviews a later month). gl_review_mark_fixed must never auto-fix it.
--
-- This is the same function as in gl-review-1-core.sql with 'swing' added to
-- v_month_types. No table change; a new flag type needs no migration (the
-- flag_type check is a pattern) and CHECKS_VERSION stays 1.
--
-- Rollback: re-run gl_review_mark_fixed from gl-review-1-core.sql with
-- v_month_types back to array['recon_uncleared'] (that file already has the
-- swing version, so edit that one line first).
-- Re-run safe.
-- ============================================================================

create or replace function public.gl_review_mark_fixed(p_client_id text, p_pull_id uuid, p_checks_version int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := public.gl_review_require_staff(p_client_id);
  v_month_types text[] := array['recon_uncleared', 'swing'];
  p public.gl_review_pulls;
  v_rule int := 0;
  v_fixed int := 0;
begin
  select * into p from public.gl_review_pulls where client_id = p_client_id;
  if p.client_id is null or p_pull_id is null or p.pull_id is distinct from p_pull_id
     or p.pulled_by is distinct from v_email then
    return jsonb_build_object('status', 'stale', 'fixed', 0, 'cleared_by_rule', 0);
  end if;
  if p.status <> 'ok' or p.window_kind is distinct from 'rolling14'
     or p.window_start is null or p.window_end is null then
    raise exception 'Only a complete rolling 14-month pull can mark flags fixed.' using errcode = '22023';
  end if;
  if p_checks_version is null then
    raise exception 'checks_version is required.' using errcode = '22023';
  end if;

  update public.gl_review_flags g
     set status = 'cleared', cleared_reason = 'rule', cleared_by = 'rule', cleared_at = now()
   where g.client_id = p_client_id
     and g.status = 'open'
     and g.checks_version = p_checks_version
     and g.last_pull_id is distinct from p_pull_id
     and g.flag_type <> all (v_month_types)
     and g.period >= date_trunc('month', p.window_start)::date
     and g.period <= p.window_end
     and exists (select 1 from public.gl_review_rules r
                 where r.client_id = g.client_id and public.gl_review_rule_hides(r, g));
  get diagnostics v_rule = row_count;

  update public.gl_review_flags g
     set status = 'fixed', fixed_at = now(), fixed_by = 'system'
   where g.client_id = p_client_id
     and g.status = 'open'
     and g.checks_version = p_checks_version
     and g.last_pull_id is distinct from p_pull_id
     and g.flag_type <> all (v_month_types)
     and g.period >= date_trunc('month', p.window_start)::date
     and g.period <= p.window_end;
  get diagnostics v_fixed = row_count;

  return jsonb_build_object('status', 'ok', 'fixed', v_fixed, 'cleared_by_rule', v_rule);
end;
$$;
