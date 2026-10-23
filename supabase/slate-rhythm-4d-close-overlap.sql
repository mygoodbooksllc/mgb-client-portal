-- =====================================================================
-- Slate month rhythm 4d: the month rhythm replaces the close set's task-making (2026-10-23)
-- Spec: docs/slate-rhythm-close-overlap.md ("before flip" item a).
-- Self-test: supabase/slate-rhythm-4d-close-overlap-tests.sql (rolls back).
--
-- Problem: rhythm rows 3, 5 and 6 do the same work as the standard close set's
-- steps (bank_feed; bank_rec, card_rec, entries, review; sent). A client that had
-- both would get two tasks for one step on two different dates.
--
-- Decision: once the owner turns on month_rhythm_enabled, the rhythm makes a real
-- client's month-end tasks. The standard close set's five step templates stop
-- issuing for any client the rhythm covers (opted in, set live, or neither).
-- The Close checklist (close_checks) keeps working by hand; 'sent' was never issued.
-- With the switch off nothing changes (dry-run md5s below). Named test clients
-- keep getting both, so the owner can still compare them.
--
-- Adds (additive):
--   tk__rhythm_covers_client(text)  true when an active rhythm-set template reaches
--                                   the client and is not skipped for it
--   tk__generate                    PATCH: skip the close set's step templates for
--                                   a covered real client while the rhythm is on
--   tk_close_optin_status           PATCH: rhythm templates are never listed as an
--                                   overlap; new key rhythm_replaces (bool)
--
-- Dry-run md5 (roster, horizon 40) before and after, switch off:
--   2026-10-23 8b68541931a5d70df57b889a17b4c412  2026-11-03 3a735998cb7bbeb5b77643aa850ff3c1
--   2026-11-14 678ffec28beab2e79a02eb86258a495b  2026-12-04 bfc739d96e9a2b40682f71ccc904219e
--
-- Re-runnable. Rollback: swap each anchor pair below (to -> from) with
-- pg_temp.patch_fn, then drop function public.tk__rhythm_covers_client(text).
-- =====================================================================

create or replace function public.tk__rhythm_covers_client(p_client text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.task_templates t
      join public.tk_template_sets s on s.id = t.template_set_id
                                    and s.gate_key = 'month_rhythm_enabled'
                                    and s.deleted_at is null
      join public.clients cl on cl.id = p_client
     where t.active and t.status = 'active'
       and ((cardinality(t.plan_tiers) = 0 and cardinality(t.client_ids) = 0)
            or cl.plan = any (t.plan_tiers) or cl.id = any (t.client_ids))
       and not coalesce((public.tk__template_eff(t, p_client) ->> 'skip')::boolean, false));
$$;
revoke all on function public.tk__rhythm_covers_client(text) from public, anon, authenticated;

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

-- 1. tk__generate: the rhythm replaces the close steps for a covered real client
select pg_temp.patch_fn('public.tk__generate(date,boolean,text,integer,text,uuid)',
$a$        v_optin := public.tk__close_optin_floor(c.id);
$a$,
$b$        v_optin := public.tk__close_optin_floor(c.id);
        -- slate rhythm 4d: with the month rhythm on, it makes a covered real client's month-end
        -- tasks, so the standard close set's five steps stop issuing (Close checklist stays by hand)
        if v_rhythm_on and v_set.is_standard and public.tk__is_close_task_key(t.close_key)
           and not (p_client_id is not null and v_named_test)
           and public.tk__rhythm_covers_client(c.id) then
          continue;
        end if;
$b$, 1);

-- 2. tk_close_optin_status: rhythm templates are never an overlap
select pg_temp.patch_fn('public.tk_close_optin_status(text)',
$a$     and not exists (select 1 from public.tk_template_sets s   -- slate rhythm s3
                      where s.id = t.template_set_id and s.gate_key = 'month_rhythm_enabled'
                        and not coalesce(public.tk__jsonb_bool((select value from tk_settings where key = 'month_rhythm_enabled')), false))
$a$,
$b$     and not exists (select 1 from public.tk_template_sets s   -- slate rhythm 4d: the rhythm replaces the steps, never an overlap
                      where s.id = t.template_set_id and s.gate_key = 'month_rhythm_enabled')
$b$, 1);

-- 3. tk_close_optin_status: say when the rhythm makes this client's month-end tasks
select pg_temp.patch_fn('public.tk_close_optin_status(text)',
$a$    'overlaps', v_overlap);
$a$,
$b$    'overlaps', v_overlap,
    'rhythm_replaces', coalesce(public.tk__jsonb_bool((select value from tk_settings where key = 'month_rhythm_enabled')), false)
                       and public.tk__rhythm_covers_client(p_client_id));   -- slate rhythm 4d
$b$, 1);

do $post$
begin
  if position('slate rhythm 4d' in pg_get_functiondef('public.tk__generate(date,boolean,text,integer,text,uuid)'::regprocedure)) = 0
     or position('rhythm_replaces' in pg_get_functiondef('public.tk_close_optin_status(text)'::regprocedure)) = 0 then
    raise exception 'slate rhythm 4d: patch did not land';
  end if;
end $post$;
