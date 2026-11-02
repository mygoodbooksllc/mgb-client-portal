-- =====================================================================
-- Recurring templates vs the Asana import: review fixes (2026-11-02)
-- Runs after supabase/recurring-asana-overlap.sql. Applied to production 2026-11-02
-- (migration recurring_asana_overlap_fix1). Rollback: supabase/recurring-asana-overlap-rollback.sql.
--   1. tk__issue_period: the locking re-select checks every search condition again (same client,
--      source asana, top level, not linked to any issued row), not just open + unlinked.
--   2. tk__asana_copy_for_period: the ambiguity check also compares the other template's per-client
--      title (tk__template_eff), not only its base title.
-- =====================================================================

create or replace function public.tk__asana_copy_for_period(p_t task_templates, p_eff jsonb, p_client text,
                                                            p_start date, p_due date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $f$
declare
  v_kind text := p_eff ->> 'kind';
  v_n int := public.tk__asana_match_days(p_eff ->> 'kind');
  v_t1 text := public.tk__norm_title(p_eff ->> 'title');
  v_t2 text := public.tk__norm_title(p_t.title);
  v_lo date;
  v_prev_due date;
  v_prev_done boolean;
  v_id uuid;
  v_cdue date;
begin
  if p_t.source is distinct from 'asana' or v_n is null or p_due is null or p_client is null or p_start is null
     or v_t1 = '' then
    return jsonb_build_object('status', 'none');
  end if;
  v_lo := p_due - v_n;
  -- Carry forward: when the previous period's task is done, Asana's next copy (made on completion)
  -- may be due any time after that task's due date.
  select r.due_date, (r.status = 'done' or coalesce(r.done, false))
    into v_prev_due, v_prev_done
    from task_template_issued i
    join staff_reminders r on r.id = i.reminder_id
   where i.template_id = p_t.id and i.client_id = p_client
     and i.period = public.tk_period_start_for(v_kind, p_start - 1, p_eff ->> 'fye')
     and r.deleted_at is null;
  if coalesce(v_prev_done, false) and v_prev_due is not null and v_prev_due + 1 < v_lo then
    v_lo := v_prev_due + 1;
  end if;

  select r.id, r.due_date into v_id, v_cdue
    from staff_reminders r
   where r.client_id = p_client
     and r.source = 'asana'
     and r.template_id is null
     and r.deleted_at is null
     and r.parent_id is null
     and r.status <> 'done' and not coalesce(r.done, false)
     and r.due_date between v_lo and p_due + v_n
     and public.tk__norm_title(r.text) in (v_t1, v_t2)
     and not exists (select 1 from task_template_issued i where i.reminder_id = r.id)
   order by abs(r.due_date - p_due), r.due_date, r.created_at, r.id
   limit 1;
  if v_id is null then
    return jsonb_build_object('status', 'none');
  end if;

  -- Another Asana-mirrored template that is on (active or paused) for this client has the same title
  -- (base or per-client): the copy could belong to either, so neither adopts it.
  if exists (select 1 from task_templates o
              where o.id <> p_t.id and o.source = 'asana' and o.status = 'active'
                and p_client = any (o.client_ids)
                and (public.tk__norm_title(o.title) in (v_t1, v_t2)
                     or public.tk__norm_title(public.tk__template_eff(o, p_client) ->> 'title') in (v_t1, v_t2))) then
    return jsonb_build_object('status', 'ambiguous', 'reminder_id', v_id, 'due', v_cdue);
  end if;
  return jsonb_build_object('status', 'match', 'reminder_id', v_id, 'due', v_cdue,
                            'gap', abs(v_cdue - p_due), 'carried', v_cdue < p_due - v_n);
end
$f$;

revoke all on function public.tk__asana_copy_for_period(task_templates, jsonb, text, date, date) from public, anon, authenticated;
grant execute on function public.tk__asana_copy_for_period(task_templates, jsonb, text, date, date) to service_role;

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

-- tk__issue_period: the locking re-select checks every search condition again
select pg_temp.patch_fn('public.tk__issue_period(task_templates,jsonb,text,date,boolean)',
$a$         where r.id = (v_adopt ->> 'reminder_id')::uuid
           and r.template_id is null and r.deleted_at is null
           and r.status <> 'done' and not coalesce(r.done, false)
         for update skip locked;
$a$,
$b$         where r.id = (v_adopt ->> 'reminder_id')::uuid
           and r.template_id is null and r.deleted_at is null
           and r.status <> 'done' and not coalesce(r.done, false)
           and r.client_id = p_client and r.source = 'asana' and r.parent_id is null
           and not exists (select 1 from task_template_issued i2 where i2.reminder_id = r.id)
         for update skip locked;
$b$, 1);

do $c$
begin
  if position('i2.reminder_id = r.id' in pg_get_functiondef('public.tk__issue_period(task_templates,jsonb,text,date,boolean)'::regprocedure)) = 0
     or position('tk__template_eff(o, p_client)' in pg_get_functiondef('public.tk__asana_copy_for_period(task_templates,jsonb,text,date,date)'::regprocedure)) = 0 then
    raise exception 'recurring asana overlap fix1: patch missing';
  end if;
end
$c$;
