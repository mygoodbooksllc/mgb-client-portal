-- =====================================================================
-- Recurring templates vs the daily Asana import: no duplicate tasks (2026-11-02)
-- Applied to production 2026-11-02 (migration recurring_asana_overlap); self-test passed
-- (supabase/recurring-asana-overlap-tests.sql, rolled back).
-- Spec: docs/recurring-asana-overlap.md. Self-test: supabase/recurring-asana-overlap-tests.sql (rolls back).
--
-- Only Asana-mirrored templates (task_templates.source = 'asana') are affected. Nothing is turned
-- on here: no firm switch, no preview flag, no template status. Asana is never written to.
--
-- New helpers
--   tk__norm_title(text)                 title compare key (same as norm() in dailyImport.js)
--   tk__asana_match_days(kind)           window: week 3, month 13, quarter 44, year/calendar year 120
--   tk__asana_copy_for_period(...)       the open imported Asana copy a template period would adopt
--   tk__asana_cover_rows(client, since)  template periods (issued after the template was made) that
--                                        cover an Asana task: client, title key, window, anchor due
--   tk__asana_task_covered(client, title, due)
-- Anchors (pg_temp.patch_fn, each must match exactly once)
--   tk__issue_period      adopt the copy (or would_adopt / asana_copy_ambiguous / asana_copy_busy)
--   tk__generate          counts 'adopted', lists 'would_adopt' (new result keys only)
--   tk_issue_missed       generator lock; 'adopted' reads as 'exists' + adopted:true
--   tk_import_asana_apply generator lock; a covered task is skipped (template_covers_period, no map row)
-- Index: task_template_issued(reminder_id).
-- No table column, RLS, cron or data change.
--
-- Review fixes: supabase/recurring-asana-overlap-fix1.sql (applied after this file).
-- Rollback: supabase/recurring-asana-overlap-rollback.sql (swapping anchors here and re-running does NOT
-- work: patch_fn sees the old anchor still inside the patched body).
-- =====================================================================

-- ---------- helpers ----------

create or replace function public.tk__norm_title(p text)
returns text
language sql
immutable
parallel safe
set search_path = public
as $f$
  -- curly single quotes to ', no-break spaces to spaces, runs of whitespace to one space, trim, lower case
  select lower(btrim(regexp_replace(translate(coalesce(p, ''), E'‘’  ', E'\'\'  '), '\s+', ' ', 'g')));
$f$;

create or replace function public.tk__asana_match_days(p_kind text)
returns int
language sql
immutable
parallel safe
set search_path = public
as $f$
  -- under half the shortest gap between two periods (7, 28, 89, 365 days)
  select case p_kind when 'week' then 3 when 'month' then 13 when 'quarter' then 44
                     when 'year' then 120 when 'calendar_year' then 120 end;
$f$;

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

  -- Another Asana-mirrored template that is on (active or paused) for this client has the same title:
  -- the copy could belong to either, so neither adopts it.
  if exists (select 1 from task_templates o
              where o.id <> p_t.id and o.source = 'asana' and o.status = 'active'
                and p_client = any (o.client_ids)
                and public.tk__norm_title(o.title) in (v_t1, v_t2)) then
    return jsonb_build_object('status', 'ambiguous', 'reminder_id', v_id, 'due', v_cdue);
  end if;
  return jsonb_build_object('status', 'match', 'reminder_id', v_id, 'due', v_cdue,
                            'gap', abs(v_cdue - p_due), 'carried', v_cdue < p_due - v_n);
end
$f$;

-- One row per (issued period, title key). Only periods issued after the template was made count:
-- the 2026-10-16 import link wrote its rows in the same transaction that made the template
-- (issued_at = created_at), and those stay out, so drafts and the original links never hold back
-- an Asana task (critique M1). Anchor = the period task's original due date (the rule due for a
-- generated task, the Asana due for an adopted copy).
create or replace function public.tk__asana_cover_rows(p_client text, p_since date)
returns table (client_id text, title_norm text, match_days int, anchor_due date, template_id uuid, period date)
language sql
stable
security definer
set search_path = public
as $f$
  select distinct i.client_id, x.tn, public.tk__asana_match_days(e.eff ->> 'kind'),
         coalesce(r.due_date_original, r.due_date), i.template_id, i.period
    from task_template_issued i
    join task_templates t on t.id = i.template_id
    join staff_reminders r on r.id = i.reminder_id
    cross join lateral (select public.tk__template_eff(t, i.client_id) as eff) e
    cross join lateral unnest(array[public.tk__norm_title(e.eff ->> 'title'), public.tk__norm_title(t.title)]) as x(tn)
   where t.source = 'asana'
     and t.activated_at is not null
     and i.issued_at > t.created_at
     and r.deleted_at is null
     and (p_client is null or i.client_id = p_client)
     and coalesce(r.due_date_original, r.due_date) >= p_since
     and public.tk__asana_match_days(e.eff ->> 'kind') is not null
     and x.tn <> '';
$f$;

create or replace function public.tk__asana_task_covered(p_client text, p_title text, p_due date)
returns boolean
language sql
stable
security definer
set search_path = public
as $f$
  select p_client is not null and p_due is not null
     and exists (select 1 from public.tk__asana_cover_rows(p_client, p_due - 130) c
                  where c.title_norm = public.tk__norm_title(p_title)
                    and abs(p_due - c.anchor_due) <= c.match_days);
$f$;

revoke all on function public.tk__norm_title(text) from public, anon, authenticated;
revoke all on function public.tk__asana_match_days(text) from public, anon, authenticated;
revoke all on function public.tk__asana_copy_for_period(task_templates, jsonb, text, date, date) from public, anon, authenticated;
revoke all on function public.tk__asana_cover_rows(text, date) from public, anon, authenticated;
revoke all on function public.tk__asana_task_covered(text, text, date) from public, anon, authenticated;
grant execute on function public.tk__norm_title(text) to service_role;
grant execute on function public.tk__asana_match_days(text) to service_role;
grant execute on function public.tk__asana_copy_for_period(task_templates, jsonb, text, date, date) to service_role;
grant execute on function public.tk__asana_cover_rows(text, date) to service_role;
grant execute on function public.tk__asana_task_covered(text, text, date) to service_role;
-- The daily import's context query may run as the CLI read-only role.
do $g$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_read_only_user') then
    execute 'grant execute on function public.tk__asana_cover_rows(text, date) to supabase_read_only_user';
  end if;
end
$g$;

create index if not exists task_template_issued_reminder_idx
  on public.task_template_issued (reminder_id) where reminder_id is not null;

-- ---------- anchor patches ----------

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

-- tk__issue_period: declarations
select pg_temp.patch_fn('public.tk__issue_period(task_templates,jsonb,text,date,boolean)',
$a$  v_section text;   -- slate rhythm s3: a firm_part task's part label
$a$,
$b$  v_section text;   -- slate rhythm s3: a firm_part task's part label
  v_adopt jsonb;   -- recurring asana overlap
  v_copy uuid;   -- recurring asana overlap
  v_copy_who text;   -- recurring asana overlap
$b$, 1);

-- tk__issue_period: adopt the open Asana copy before choosing an assignee
select pg_temp.patch_fn('public.tk__issue_period(task_templates,jsonb,text,date,boolean)',
$a$
  select p.email into v_to from public.tk__client_people(p_client) p where p.role = v_role limit 1;
$a$,
$b$
  -- recurring asana overlap: an Asana-mirrored template takes the open imported Asana copy for this
  -- period as its task. Only template_id / period_kind / period_start change on the copy.
  if p_t.source = 'asana' and v_kind in ('week', 'month', 'quarter', 'year', 'calendar_year') then
    v_adopt := public.tk__asana_copy_for_period(p_t, p_eff, p_client, p_start, v_due);
    if v_adopt ->> 'status' = 'ambiguous' then
      return jsonb_build_object('status', 'skipped', 'reason', 'asana_copy_ambiguous', 'due', v_due, 'label', v_label,
                                'detail', 'Another active template has the same title. Retire one of them.');
    elsif v_adopt ->> 'status' = 'match' then
      if p_dry_run then
        return jsonb_build_object('status', 'would_adopt', 'reminder_id', v_adopt ->> 'reminder_id', 'due', v_due,
                                  'copy_due', v_adopt ->> 'due', 'label', v_label);
      end if;
      begin
        select r.id, coalesce(r.assignee_email, r.staff_email) into v_copy, v_copy_who
          from staff_reminders r
         where r.id = (v_adopt ->> 'reminder_id')::uuid
           and r.template_id is null and r.deleted_at is null
           and r.status <> 'done' and not coalesce(r.done, false)
         for update skip locked;
        if v_copy is null then
          return jsonb_build_object('status', 'skipped', 'reason', 'asana_copy_busy', 'due', v_due, 'label', v_label);
        end if;
        insert into task_template_issued (template_id, client_id, period, reminder_id, assignee)
        values (p_t.id, p_client, p_start, v_copy, v_copy_who)
        on conflict do nothing
        returning true into v_claimed;
        if v_claimed is null then
          return jsonb_build_object('status', 'exists', 'due', v_due, 'label', v_label);
        end if;
        update staff_reminders
           set template_id = p_t.id,
               period_kind = case when v_kind in ('month', 'quarter', 'year') then v_kind end,
               period_start = case when v_kind in ('month', 'quarter', 'year') then p_start end
         where id = v_copy;
        if v_kind in ('month', 'quarter', 'year') then
          begin
            insert into month_close (client_id, period_kind, period, status)
            values (p_client, v_kind, p_start, 'not_started')
            on conflict do nothing;
          exception when others then
            null;
          end;
        end if;
      exception when others then
        return jsonb_build_object('status', 'skipped', 'reason', 'error', 'detail', left(sqlerrm, 200),
                                  'due', v_due, 'label', v_label);
      end;
      return jsonb_build_object('status', 'adopted', 'assignee', v_copy_who, 'reminder_id', v_copy, 'due', v_due,
                                'copy_due', v_adopt ->> 'due', 'label', v_label);
    end if;
  end if;

  select p.email into v_to from public.tk__client_people(p_client) p where p.role = v_role limit 1;
$b$, 1);

-- tk__generate: declarations
select pg_temp.patch_fn('public.tk__generate(date,boolean,text,integer,text,uuid)',
$a$  v_result jsonb;
begin
$a$,
$b$  v_result jsonb;
  v_adopted int := 0;   -- recurring asana overlap
  v_would_adopt jsonb := '[]'::jsonb;   -- recurring asana overlap
begin
$b$, 1);

-- tk__generate: count adoptions
select pg_temp.patch_fn('public.tk__generate(date,boolean,text,integer,text,uuid)',
$a$            elsif v_r ->> 'status' = 'skipped' then
$a$,
$b$            elsif v_r ->> 'status' = 'adopted' then   -- recurring asana overlap
              v_adopted := v_adopted + 1;
            elsif v_r ->> 'status' = 'would_adopt' then   -- recurring asana overlap
              if jsonb_array_length(v_would_adopt) < 500 then
                v_would_adopt := v_would_adopt || (v_r || jsonb_build_object('template', t.id, 'title', v_eff ->> 'title', 'client', c.id, 'period', v_start));
              end if;
            elsif v_r ->> 'status' = 'skipped' then
$b$, 1);

-- tk__generate: result keys
select pg_temp.patch_fn('public.tk__generate(date,boolean,text,integer,text,uuid)',
$a$                                 'dry_run', v_dry, 'today', v_today, 'warnings', v_warn);
$a$,
$b$                                 'dry_run', v_dry, 'today', v_today, 'warnings', v_warn,
                                 'adopted', v_adopted);   -- recurring asana overlap
$b$, 1);

select pg_temp.patch_fn('public.tk__generate(date,boolean,text,integer,text,uuid)',
$a$    v_result := v_result || jsonb_build_object('would_create', v_would, 'upcoming', v_upcoming);
$a$,
$b$    v_result := v_result || jsonb_build_object('would_create', v_would, 'upcoming', v_upcoming,
                                               'would_adopt', v_would_adopt);   -- recurring asana overlap
$b$, 1);

-- tk_issue_missed: one writer at a time with the generator and the import
select pg_temp.patch_fn('public.tk_issue_missed(uuid,text,date)',
$a$  perform set_config('mgb.tk_generate', 'on', true);
  v_r := public.tk__issue_period($a$,
$b$  perform pg_advisory_xact_lock(hashtext('tk_generate'));   -- recurring asana overlap
  perform set_config('mgb.tk_generate', 'on', true);
  v_r := public.tk__issue_period($b$, 1);

-- tk_issue_missed: an adopted copy closes the row like an existing task
select pg_temp.patch_fn('public.tk_issue_missed(uuid,text,date)',
$a$  if v_r ->> 'status' = 'exists' and nullif(v_r ->> 'reminder_id', '') is null then
$a$,
$b$  if v_r ->> 'status' = 'adopted' then   -- recurring asana overlap
    v_r := v_r || jsonb_build_object('status', 'exists', 'adopted', true);
  end if;
  if v_r ->> 'status' = 'exists' and nullif(v_r ->> 'reminder_id', '') is null then
$b$, 1);

-- tk_import_asana_apply: one writer at a time with the generator
select pg_temp.patch_fn('public.tk_import_asana_apply(uuid,text,text)',
$a$  perform set_config('mgb.tk_import', 'on', true);
$a$,
$b$  perform pg_advisory_xact_lock(hashtext('tk_generate'));   -- recurring asana overlap
  perform set_config('mgb.tk_import', 'on', true);
$b$, 1);

-- tk_import_asana_apply: a task a template period already covers is held back (no map row)
select pg_temp.patch_fn('public.tk_import_asana_apply(uuid,text,text)',
$a$    v_project := null;
$a$,
$b$    if v_client is not null and nullif(p ->> 'parent_gid', '') is null   -- recurring asana overlap
       and public.tk__asana_task_covered(v_client, p ->> 'title', nullif(p ->> 'due_date', '')::date) then
      v_skips := v_skips || jsonb_build_object('kind', 'task', 'gid', r.asana_gid, 'reason', 'template_covers_period');
      v_n := jsonb_set(v_n, '{held_back_template}', to_jsonb(coalesce((v_n ->> 'held_back_template')::int, 0) + 1));
      continue;
    end if;
    v_project := null;
$b$, 1);

-- ---------- verify ----------

do $c$
declare
  d text;
begin
  d := pg_get_functiondef('public.tk__issue_period(task_templates,jsonb,text,date,boolean)'::regprocedure);
  if (length(d) - length(replace(d, 'recurring asana overlap', ''))) / length('recurring asana overlap') <> 4 then
    raise exception 'recurring asana overlap: tk__issue_period patch count wrong';
  end if;
  d := pg_get_functiondef('public.tk__generate(date,boolean,text,integer,text,uuid)'::regprocedure);
  if (length(d) - length(replace(d, 'recurring asana overlap', ''))) / length('recurring asana overlap') <> 6 then
    raise exception 'recurring asana overlap: tk__generate patch count wrong';
  end if;
  d := pg_get_functiondef('public.tk_issue_missed(uuid,text,date)'::regprocedure);
  if (length(d) - length(replace(d, 'recurring asana overlap', ''))) / length('recurring asana overlap') <> 2 then
    raise exception 'recurring asana overlap: tk_issue_missed patch count wrong';
  end if;
  d := pg_get_functiondef('public.tk_import_asana_apply(uuid,text,text)'::regprocedure);
  if (length(d) - length(replace(d, 'recurring asana overlap', ''))) / length('recurring asana overlap') <> 2 then
    raise exception 'recurring asana overlap: tk_import_asana_apply patch count wrong';
  end if;
  if public.tk__norm_title(E'  Reconcile  ‘Checking’  · X ') <> 'reconcile ''checking'' · x' then
    raise exception 'recurring asana overlap: tk__norm_title wrong (%)', public.tk__norm_title(E'  Reconcile  ‘Checking’  · X ');
  end if;
  -- nothing was turned on: no Asana-mirrored template is active
  if exists (select 1 from task_templates where source = 'asana' and (status <> 'draft' or active)) then
    raise notice 'recurring asana overlap: note, an Asana-mirrored template is already on';
  end if;
end
$c$;
