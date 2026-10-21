-- =====================================================================
-- Slate month rhythm, slice 3: the eight monthly rhythm templates (2026-10-21)
-- Applied to production 2026-10-21 (migration slate_rhythm_3_templates); self-test
-- passed the same day. Dry-run generator output for the roster and every older
-- template is byte-identical before and after; close opt-in overlaps unchanged.
-- Run after supabase/slate-rhythm-2b-issue-gate.sql. Additive only.
-- Self-test: supabase/slate-rhythm-3-templates-tests.sql (rolls back).
-- Spec: docs/slate-rhythm-slice-3.md.
--
-- What it does
--   1. New columns:
--        task_templates.email_kind  text null, one of request / reports / maintenance
--        task_templates.description text null, at most 2000 characters
--        tk_template_sets.gate_key  text not null default 'standard_set_live',
--                                   one of standard_set_live / month_rhythm_enabled
--      Every existing row keeps its old meaning (no email kind, no description,
--      the standard switch).
--   2. A new template set "MGB Month Rhythm" (gate_key month_rhythm_enabled)
--      and its eight monthly templates, status active, due_rule firm_part,
--      close_key NULL. Identity is (set, source 'standard', source_ref
--      'month_rhythm:<n>_<part>') with a new partial unique index, so a re-run
--      inserts nothing.
--   3. Gate. A set's members reach real clients only when that set's switch
--      is on: tk__generate reads gate_key (2 anchors). For the rhythm set that is
--      month_rhythm_enabled; for every existing set it is still
--      standard_set_live. Named test / internal clients pass exactly as they
--      already do for sets and for firm_part rules (slice 2b). The close opt-in
--      never applies to the rhythm set (its close_key is NULL).
--   4. tk_settings_set_live_since: standard_set_live off -> on stamps
--      live_since on the sets it gates (all existing sets); month_rhythm_enabled
--      off -> on stamps the rhythm set. So rhythm tasks start from the day the
--      owner turns the switch on, never back-filled.
--   5. tk__issue_period: a new task also gets the template's description, and a
--      firm_part task gets section = the rhythm part label ("Check in",
--      "Send reports", "Follow up"). Every other template inserts NULL for both,
--      the column default, so its tasks are unchanged.
--   6. tk_save_template accepts "description" (insert and update). A payload
--      without it changes nothing.
--   7. tk_close_optin_status: the rhythm set's templates are not listed as
--      close overlaps while month_rhythm_enabled is off ("bank" in row 3 would
--      otherwise show on every client).
-- No new table, no RLS change (existing table policies cover the new columns),
-- no grant change (create or replace keeps ACLs), no cron change.
-- month_rhythm_enabled is owner-only and is never set here.
--
-- Rollback (in order):
--   a. swap each anchor pair below (to -> from) with pg_temp.patch_fn;
--   b. delete from task_templates t using tk_template_sets s
--        where t.template_set_id = s.id and s.name = 'MGB Month Rhythm'
--          and not exists (select 1 from task_template_issued i where i.template_id = t.id);
--      (if tasks were issued, retire instead: status 'retired', active false);
--      then delete the set if empty;
--   c. drop index task_templates_std_ref_uniq; drop the three columns.
-- =====================================================================

-- 1. Columns ---------------------------------------------------------------
alter table public.task_templates
  add column if not exists email_kind text
    constraint task_templates_email_kind_check check (email_kind is null or email_kind in ('request', 'reports', 'maintenance'));
alter table public.task_templates
  add column if not exists description text
    constraint task_templates_description_len check (description is null or char_length(description) <= 2000);
alter table public.tk_template_sets
  add column if not exists gate_key text not null default 'standard_set_live'
    constraint tk_template_sets_gate_key_check check (gate_key in ('standard_set_live', 'month_rhythm_enabled'));

comment on column public.task_templates.email_kind is
  'Slate month rhythm: which client email draft this template''s task offers (request, reports, maintenance). Set by seed only.';
comment on column public.task_templates.description is
  'Copied to staff_reminders.description when the generator makes a task.';
comment on column public.tk_template_sets.gate_key is
  'tk_settings key whose switch lets this set reach real clients: standard_set_live (default) or month_rhythm_enabled.';

create unique index if not exists task_templates_std_ref_uniq
  on public.task_templates (template_set_id, source_ref)
  where source = 'standard' and source_ref is not null;

-- 2. Seed: the set and its eight templates ---------------------------------
insert into public.tk_template_sets (name, is_standard, gate_key)
values ('MGB Month Rhythm', false, 'month_rhythm_enabled')
on conflict (name) do nothing;
update public.tk_template_sets set gate_key = 'month_rhythm_enabled'
 where name = 'MGB Month Rhythm' and gate_key <> 'month_rhythm_enabled';

insert into public.task_templates (title, cadence, due_offset_days, due_rule, lead_days, priority, status, active, activated_at,
                                   template_set_id, close_key, source, source_ref, sop_section, review_required,
                                   assignee_role, period_basis, plan_tiers, client_ids, checklist, description, email_kind)
select v.title, 'monthly', 10, jsonb_build_object('type', 'firm_part', 'part', v.part, 'month_offset', 1),
       v.lead, 'normal', 'active', true, now(), s.id, null, 'standard', v.ref, v.sop, false,
       'bookkeeper', 'calendar', '{}'::text[], '{}'::text[], v.checklist, v.descr, v.email
  from public.tk_template_sets s
  cross join (values
    ('month_rhythm:1_check_in', 'check_in', 3, null::text,
     'Check in with the client about last month',
     'A short check-in about last month, so nothing unusual surprises the close.',
     array['Anything unusual last month', 'New bank or card accounts', 'Large purchases', 'Staff changes'],
     null::text),
    ('month_rhythm:2_check_in', 'check_in', 3, null,
     'Ask for missing documents',
     'Ask the client for last month''s missing documents with an Ask client request, so they can upload them.',
     array['Bank statements', 'Card statements', 'Receipts', 'Payroll reports', 'Loan statements'],
     'request'),
    ('month_rhythm:3_check_in', 'check_in', 3, 'bank_feeds',
     'Categorize the bank feed through month end',
     'Close step 1. Work that needs no documents from the client.',
     array[]::text[],
     null),
    ('month_rhythm:4_check_in', 'check_in', 3, null,
     'Note what is still missing',
     'Add one line to the client Overview saying what is still missing, so the reports date shows who will get preliminary reports.',
     array[]::text[],
     null),
    ('month_rhythm:5_reports', 'reports', 10, 'monthly_close',
     'Finish the month with the documents received',
     'Close steps 2 to 5 with the documents received.',
     array['Reconcile bank accounts', 'Reconcile credit cards', 'Post payroll and journal entries', 'Review the reports'],
     null),
    ('month_rhythm:6_reports', 'reports', 10, 'reporting',
     'Send reports: full if complete, preliminary if documents are missing',
     'Close step 6. A preliminary send is labeled Preliminary and lists what is missing.',
     array[]::text[],
     'reports'),
    ('month_rhythm:7_follow_up', 'follow_up', 10, null,
     'Follow up on missing documents',
     'Second request to the client and their other contacts. Tell the account manager if this is the second month in a row.',
     array['Send the second request', 'Include the client''s other contacts', 'Tell the account manager if this is the second month in a row'],
     'maintenance'),
    ('month_rhythm:8_follow_up', 'follow_up', 10, 'reporting',
     'Finish and send full reports once documents arrive',
     'Replaces the preliminary reports. Then mark the month Ready for sign-off.',
     array['Finish the close with the new documents', 'Send the full reports', 'Mark the month Ready for sign-off'],
     null)
  ) v(ref, part, lead, sop, title, descr, checklist, email)
 where s.name = 'MGB Month Rhythm'
   and not exists (select 1 from public.task_templates t
                    where t.template_set_id = s.id and t.source = 'standard' and t.source_ref = v.ref);

-- 3 to 7. Function patches (anchor replace; already-patched is a no-op) ------
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

-- 3a. tk__generate: read the set's gate key
select pg_temp.patch_fn('public.tk__generate(date,boolean,text,integer,text,uuid)',
$a$select s.deleted_at, s.is_standard, s.live_since into v_set from tk_template_sets s where s.id = t.template_set_id;$a$,
$b$select s.deleted_at, s.is_standard, s.live_since, s.gate_key into v_set from tk_template_sets s where s.id = t.template_set_id;   -- slate rhythm s3$b$, 1);

-- 3b. tk__generate: the set's own switch decides
select pg_temp.patch_fn('public.tk__generate(date,boolean,text,integer,text,uuid)',
$a$        if v_set_live then
$a$,
$b$        if (case when v_set.gate_key = 'month_rhythm_enabled' then v_rhythm_on else v_set_live end) then   -- slate rhythm s3: each set waits for its own switch
$b$, 1);

-- 4. tk_settings_set_live_since: each switch stamps the sets it gates
select pg_temp.patch_fn('public.tk_settings_set_live_since()',
$a$  if new.key = 'standard_set_live' and v_on and not v_was then
    -- off -> on (again): real clients start now; paused months are neither made nor missed
    update tk_template_sets set live_since = now(), updated_at = now() where deleted_at is null;
  end if;$a$,
$b$  if new.key in ('standard_set_live', 'month_rhythm_enabled') and v_on and not v_was then
    -- off -> on (again): real clients start now; paused months are neither made nor missed
    -- slate rhythm s3: only the sets this switch gates
    update tk_template_sets set live_since = now(), updated_at = now()
     where deleted_at is null and gate_key = new.key;
  end if;$b$, 1);

-- 5a. tk__issue_period: declare the part label
select pg_temp.patch_fn('public.tk__issue_period(task_templates,jsonb,text,date,boolean)',
$a$  v_cover text;   -- tk p2 s7
$a$,
$b$  v_cover text;   -- tk p2 s7
  v_section text;   -- slate rhythm s3: a firm_part task's part label
$b$, 1);

-- 5b. tk__issue_period: a firm_part task's section is the rhythm part label
select pg_temp.patch_fn('public.tk__issue_period(task_templates,jsonb,text,date,boolean)',
$a$    v_due := public.tk_resolve_due(p_eff -> 'rule', p_start, v_end, public.tk__rhythm_for_client(p_client));
$a$,
$b$    v_due := public.tk_resolve_due(p_eff -> 'rule', p_start, v_end, public.tk__rhythm_for_client(p_client));
    v_section := (select left(coalesce(nullif(btrim(x ->> 'label'), ''),
                                       case x ->> 'key' when 'check_in' then 'Check in'
                                                        when 'reports' then 'Send reports'
                                                        when 'follow_up' then 'Follow up' end), 60)
                    from jsonb_array_elements(public.tk__rhythm_for_client(p_client) -> 'parts') x
                   where x ->> 'key' = p_eff -> 'rule' ->> 'part'
                   limit 1);   -- slate rhythm s3
$b$, 1);

-- 5c. tk__issue_period: insert description and section
select pg_temp.patch_fn('public.tk__issue_period(task_templates,jsonb,text,date,boolean)',
$a$      period_kind, period_start, sop_section, review_required)
$a$,
$b$      period_kind, period_start, sop_section, review_required, description, section)   -- slate rhythm s3
$b$, 1);

select pg_temp.patch_fn('public.tk__issue_period(task_templates,jsonb,text,date,boolean)',
$a$      coalesce((p_eff ->> 'review_required')::boolean, false))
    on conflict (source_ref) where source = 'template' do nothing$a$,
$b$      coalesce((p_eff ->> 'review_required')::boolean, false),
      nullif(btrim(p_t.description), ''), v_section)   -- slate rhythm s3: NULL, NULL for every older template
    on conflict (source_ref) where source = 'template' do nothing$b$, 1);

-- 6. tk_save_template: description
select pg_temp.patch_fn('public.tk_save_template(uuid,jsonb)',
$a$                                status, active, created_by, updated_by, source)
$a$,
$b$                                status, active, created_by, updated_by, source, description)   -- slate rhythm s3
$b$, 1);

select pg_temp.patch_fn('public.tk_save_template(uuid,jsonb)',
$a$            coalesce(p_tpl ->> 'period_basis', 'calendar'), 'draft', true, v_me, v_me, 'manual')
$a$,
$b$            coalesce(p_tpl ->> 'period_basis', 'calendar'), 'draft', true, v_me, v_me, 'manual',
            left(nullif(btrim(p_tpl ->> 'description'), ''), 2000))   -- slate rhythm s3
$b$, 1);

select pg_temp.patch_fn('public.tk_save_template(uuid,jsonb)',
$a$      period_basis = coalesce(p_tpl ->> 'period_basis', period_basis),
      updated_by = v_me$a$,
$b$      period_basis = coalesce(p_tpl ->> 'period_basis', period_basis),
      description = case when p_tpl ? 'description' then left(nullif(btrim(p_tpl ->> 'description'), ''), 2000)
                         else description end,   -- slate rhythm s3
      updated_by = v_me$b$, 1);

-- 7. tk_close_optin_status: hide the rhythm set from overlaps while its switch is off
select pg_temp.patch_fn('public.tk_close_optin_status(text)',
$a$     and not exists (select 1 from public.tk_template_sets s where s.id = t.template_set_id and s.is_standard)
$a$,
$b$     and not exists (select 1 from public.tk_template_sets s where s.id = t.template_set_id and s.is_standard)
     and not exists (select 1 from public.tk_template_sets s   -- slate rhythm s3
                      where s.id = t.template_set_id and s.gate_key = 'month_rhythm_enabled'
                        and not coalesce(public.tk__jsonb_bool((select value from tk_settings where key = 'month_rhythm_enabled')), false))
$b$, 1);

-- 8. Post-checks ------------------------------------------------------------
do $c$
declare
  v_set uuid := (select id from public.tk_template_sets where name = 'MGB Month Rhythm');
  n int;
begin
  if v_set is null then raise exception 'slate rhythm s3: set missing'; end if;
  select count(*) into n from public.task_templates where template_set_id = v_set;
  if n <> 8 then raise exception 'slate rhythm s3: expected 8 rhythm templates, found %', n; end if;
  if exists (select 1 from public.tk_template_sets where name <> 'MGB Month Rhythm' and gate_key <> 'standard_set_live') then
    raise exception 'slate rhythm s3: an older set changed gate';
  end if;
  if (select count(*) from public.task_templates where email_kind is not null) <> 3 then
    raise exception 'slate rhythm s3: expected 3 templates with an email kind';
  end if;
  if position('slate rhythm s3' in pg_get_functiondef('public.tk__generate(date,boolean,text,integer,text,uuid)'::regprocedure)) = 0
     or position('slate rhythm s3' in pg_get_functiondef('public.tk__issue_period(task_templates,jsonb,text,date,boolean)'::regprocedure)) = 0
     or position('slate rhythm s3' in pg_get_functiondef('public.tk_settings_set_live_since()'::regprocedure)) = 0
     or position('slate rhythm s3' in pg_get_functiondef('public.tk_save_template(uuid,jsonb)'::regprocedure)) = 0
     or position('slate rhythm s3' in pg_get_functiondef('public.tk_close_optin_status(text)'::regprocedure)) = 0 then
    raise exception 'slate rhythm s3: a function patch is missing';
  end if;
  if exists (select 1 from pg_proc
              where oid in ('public.tk__generate(date,boolean,text,integer,text,uuid)'::regprocedure,
                            'public.tk__issue_period(task_templates,jsonb,text,date,boolean)'::regprocedure,
                            'public.tk_settings_set_live_since()'::regprocedure,
                            'public.tk_save_template(uuid,jsonb)'::regprocedure,
                            'public.tk_close_optin_status(text)'::regprocedure)
                and not prosecdef) then
    raise exception 'slate rhythm s3: a patched function lost SECURITY DEFINER';
  end if;
end
$c$;
