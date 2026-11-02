-- =====================================================================
-- Rollback for the recurring-templates vs Asana-import guard (2026-11-02). NOT applied.
-- Undoes supabase/recurring-asana-overlap-fix1.sql, then supabase/recurring-asana-overlap.sql, in
-- reverse order, by putting each anchor's original text back (generated from those two files).
-- Leaves the helper functions and the index (unused afterwards). Also revert the dailyImport.js commit:
-- its context query calls tk__asana_cover_rows, which stays, so an un-reverted script still runs.
-- After a rollback, Asana tasks that were held back import the next morning and may duplicate
-- template tasks; trash or close the extras.
-- =====================================================================

create or replace function pg_temp.unpatch_fn(p_sig text, p_from text, p_to text)
returns void
language plpgsql
as $f$
declare
  d text;
  n int;
begin
  d := pg_get_functiondef(p_sig::regprocedure);
  n := (length(d) - length(replace(d, p_to, ''))) / length(p_to);
  if n = 0 then
    return;  -- already rolled back
  end if;
  if n <> 1 then
    raise exception 'unpatch_fn %: expected 1 occurrence of the patched text, found %', p_sig, n;
  end if;
  execute replace(d, p_to, p_from);
end
$f$;

select pg_temp.unpatch_fn('public.tk__issue_period(task_templates,jsonb,text,date,boolean)',
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
$b$);

select pg_temp.unpatch_fn('public.tk_import_asana_apply(uuid,text,text)',
$a$    v_project := null;
$a$,
$b$    if v_client is not null and nullif(p ->> 'parent_gid', '') is null   -- recurring asana overlap
       and public.tk__asana_task_covered(v_client, p ->> 'title', nullif(p ->> 'due_date', '')::date) then
      v_skips := v_skips || jsonb_build_object('kind', 'task', 'gid', r.asana_gid, 'reason', 'template_covers_period');
      v_n := jsonb_set(v_n, '{held_back_template}', to_jsonb(coalesce((v_n ->> 'held_back_template')::int, 0) + 1));
      continue;
    end if;
    v_project := null;
$b$);

select pg_temp.unpatch_fn('public.tk_import_asana_apply(uuid,text,text)',
$a$  perform set_config('mgb.tk_import', 'on', true);
$a$,
$b$  perform pg_advisory_xact_lock(hashtext('tk_generate'));   -- recurring asana overlap
  perform set_config('mgb.tk_import', 'on', true);
$b$);

select pg_temp.unpatch_fn('public.tk_issue_missed(uuid,text,date)',
$a$  if v_r ->> 'status' = 'exists' and nullif(v_r ->> 'reminder_id', '') is null then
$a$,
$b$  if v_r ->> 'status' = 'adopted' then   -- recurring asana overlap
    v_r := v_r || jsonb_build_object('status', 'exists', 'adopted', true);
  end if;
  if v_r ->> 'status' = 'exists' and nullif(v_r ->> 'reminder_id', '') is null then
$b$);

select pg_temp.unpatch_fn('public.tk_issue_missed(uuid,text,date)',
$a$  perform set_config('mgb.tk_generate', 'on', true);
  v_r := public.tk__issue_period($a$,
$b$  perform pg_advisory_xact_lock(hashtext('tk_generate'));   -- recurring asana overlap
  perform set_config('mgb.tk_generate', 'on', true);
  v_r := public.tk__issue_period($b$);

select pg_temp.unpatch_fn('public.tk__generate(date,boolean,text,integer,text,uuid)',
$a$    v_result := v_result || jsonb_build_object('would_create', v_would, 'upcoming', v_upcoming);
$a$,
$b$    v_result := v_result || jsonb_build_object('would_create', v_would, 'upcoming', v_upcoming,
                                               'would_adopt', v_would_adopt);   -- recurring asana overlap
$b$);

select pg_temp.unpatch_fn('public.tk__generate(date,boolean,text,integer,text,uuid)',
$a$                                 'dry_run', v_dry, 'today', v_today, 'warnings', v_warn);
$a$,
$b$                                 'dry_run', v_dry, 'today', v_today, 'warnings', v_warn,
                                 'adopted', v_adopted);   -- recurring asana overlap
$b$);

select pg_temp.unpatch_fn('public.tk__generate(date,boolean,text,integer,text,uuid)',
$a$            elsif v_r ->> 'status' = 'skipped' then
$a$,
$b$            elsif v_r ->> 'status' = 'adopted' then   -- recurring asana overlap
              v_adopted := v_adopted + 1;
            elsif v_r ->> 'status' = 'would_adopt' then   -- recurring asana overlap
              if jsonb_array_length(v_would_adopt) < 500 then
                v_would_adopt := v_would_adopt || (v_r || jsonb_build_object('template', t.id, 'title', v_eff ->> 'title', 'client', c.id, 'period', v_start));
              end if;
            elsif v_r ->> 'status' = 'skipped' then
$b$);

select pg_temp.unpatch_fn('public.tk__generate(date,boolean,text,integer,text,uuid)',
$a$  v_result jsonb;
begin
$a$,
$b$  v_result jsonb;
  v_adopted int := 0;   -- recurring asana overlap
  v_would_adopt jsonb := '[]'::jsonb;   -- recurring asana overlap
begin
$b$);

select pg_temp.unpatch_fn('public.tk__issue_period(task_templates,jsonb,text,date,boolean)',
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
$b$);

select pg_temp.unpatch_fn('public.tk__issue_period(task_templates,jsonb,text,date,boolean)',
$a$  v_section text;   -- slate rhythm s3: a firm_part task's part label
$a$,
$b$  v_section text;   -- slate rhythm s3: a firm_part task's part label
  v_adopt jsonb;   -- recurring asana overlap
  v_copy uuid;   -- recurring asana overlap
  v_copy_who text;   -- recurring asana overlap
$b$);

do $c$
declare
  s text;
begin
  foreach s in array array['public.tk__issue_period(task_templates,jsonb,text,date,boolean)',
                           'public.tk__generate(date,boolean,text,integer,text,uuid)',
                           'public.tk_issue_missed(uuid,text,date)',
                           'public.tk_import_asana_apply(uuid,text,text)'] loop
    if position('recurring asana overlap' in pg_get_functiondef(s::regprocedure)) > 0
       or position('i2.reminder_id = r.id' in pg_get_functiondef(s::regprocedure)) > 0 then
      raise exception 'rollback incomplete: % still patched', s;
    end if;
  end loop;
end
$c$;
