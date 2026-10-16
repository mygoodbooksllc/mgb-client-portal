-- =====================================================================
-- Tasks Phase 2, slice S4: recurring engine.
-- Spec: docs/tasks-phase2-spec.md C4 + D (+ critique B3, B4, M2, M6, m1,
-- m3, m4, m11; owner Q7: 7-day grace, older missed periods are listed,
-- never created).
--
-- Safe to re-run, one transaction (apply_migration or begin/commit).
-- Nothing is dropped except policies and CHECKs that are re-created.
-- Run AFTER task-templates.sql and tasks-p2-1..3 (re-running
-- task-templates.sql would re-grant direct template writes; re-run this
-- file after it). Lines this slice adds to live function bodies carry
-- "-- tk p2 s4". Also needs tasks-p2-4-hotfix-trigger-helpers.sql.
--
-- What changes:
--   1. task_templates gains status (draft / active / retired), due_rule,
--      assignee_role, review_required, sop_section, estimate_minutes,
--      period_basis (calendar / fiscal, annual only), close_key,
--      template_set_id, activated_at, source / source_ref, updated_by;
--      cadence adds 'weekly'. New rows default to 'draft'. Writes go
--      through RPCs only (direct insert / update / delete revoked; never
--      deleted, critique m11: retire instead). Staff can read templates
--      for clients they can reach.
--   2. tk_template_sets, seeded with "MGB Standard Monthly Close": six
--      DRAFT templates (CLOSE_CHECKLIST keys). They generate nothing until
--      an admin activates them AND the owner sets standard_set_live, so
--      nothing doubles up with Asana tasks during the parallel run.
--   3. tk_client_template_overrides (per client: skip, or title / due
--      rule / assignee role / checklist / review override).
--   4. tk_generator_runs (run log, admin read) and tk_generate_missed
--      (periods past the 7-day grace, stored once, critique m4).
--   5. staff_reminders.template_id (+ tk_tasks view column).
--   6. tk__client_people: the internal people lookup with no JWT check
--      (critique B3); tk_client_people is the JWT-gated wrapper.
--   7. tk_generate (definer). Resolves assignee and access first, then
--      claims the ledger row and inserts the task in one block (critique
--      B4): a skip never burns a period and is retried next run. A dry
--      run (and tk_generate_preview) writes nothing at all. No emails:
--      generated tasks never send the assignment email (staff_task_batch
--      summaries wait for a later slice).
--   8. Template RPCs (admin): tk_save_template, tk_set_template_status,
--      tk_issue_missed, tk_dismiss_missed. Staff with client access:
--      tk_set_client_override, tk_generate_preview (own clients).
--   9. tt_generate_template_tasks / tt_generate_now become thin wrappers.
--  10. staff_reminders_before_write: mgb.tk_generate joins v_bypass
--      (critique M2). notify_enqueue_task_assigned skips under it.
--  11. tk_set_reviewer on a task already in review emails the new reviewer
--      (or every eligible admin when cleared) with the existing
--      staff_task_review_ready kind (S3 leftover b).
--  12. Cron task-templates-daily now runs select public.tk_generate().
--      Plain SQL job, no secret, nothing for the owner to paste.
--
-- Review fixes (2026-10-16), marked "review fix":
--   major 1: tk_template_sets.live_since, stamped when standard_set_live
--            turns on; real clients start at the later of activation and it.
--   major 2: tk_save_template refuses a new cadence / year basis once a
--            template has been on or made a task (tk_cadence_locked).
--   major 3: a non-admin's override save keeps an admin's "no approval".
--   major 4: tk_issue_missed links an existing task; the UI shows skips.
--   minors:  standard_set_live read leniently (tk__jsonb_bool, warning, run
--            still logged); dismissed / issued periods are not re-listed.
--
-- Test clients: a cron or roster run never touches test_only or internal
-- clients. Only a run that names one (p_client_id) reaches it.
--
-- The live pg_default_acl hands anon and authenticated every privilege on
-- new tables and EXECUTE on new functions, so each new object starts from
-- "revoke all" and then gets exactly what it needs.
-- =====================================================================

-- 0. Helper: patch a live function body in place (same as S2/S3) ---------
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

-- 1. Template sets ---------------------------------------------------------
create table if not exists public.tk_template_sets (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 1 and 120),
  is_standard boolean not null default false,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
alter table public.tk_template_sets enable row level security;
revoke all on table public.tk_template_sets from public, anon, authenticated;
grant select on table public.tk_template_sets to authenticated;
drop policy if exists "tk template sets staff read" on public.tk_template_sets;
create policy "tk template sets staff read" on public.tk_template_sets
  for select to authenticated using (public.is_active_staff());
-- S4 review fix (major 1): when the owner turns standard_set_live on, real
-- clients start from that moment, not from each template's activation (an
-- earlier activation on test clients must not flood real clients with
-- missed rows and overdue tasks). Stamped by tk_settings_set_live_since
-- below; staff read it, only definer code writes it.
alter table public.tk_template_sets add column if not exists live_since timestamptz;

-- Lenient jsonb -> boolean for settings: true / "true" / "on" / 1 ... ;
-- null when the value is not a yes or no (callers treat that as off and
-- log a warning instead of aborting the run).
create or replace function public.tk__jsonb_bool(p jsonb)
returns boolean
language sql
immutable
set search_path = public
as $$
  select case jsonb_typeof(p)
    when 'boolean' then (p #>> '{}')::boolean
    when 'number' then (p #>> '{}')::numeric <> 0
    when 'string' then case
      when lower(btrim(p #>> '{}')) in ('true', 't', 'yes', 'y', 'on', '1') then true
      when lower(btrim(p #>> '{}')) in ('false', 'f', 'no', 'n', 'off', '0', '') then false
    end
  end;
$$;

create or replace function public.tk_settings_set_live_since()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_on boolean := coalesce(public.tk__jsonb_bool(new.value), false);
  v_was boolean := case when tg_op = 'UPDATE' then coalesce(public.tk__jsonb_bool(old.value), false) else false end;
begin
  if new.key = 'standard_set_live' and v_on and not v_was then
    -- off -> on (again): real clients start now; paused months are neither made nor missed
    update tk_template_sets set live_since = now(), updated_at = now() where deleted_at is null;
  end if;
  return null;
end $$;
revoke all on function public.tk_settings_set_live_since() from public, anon, authenticated;
drop trigger if exists tk_settings_set_live_since on public.tk_settings;
create trigger tk_settings_set_live_since after insert or update on public.tk_settings
  for each row execute function public.tk_settings_set_live_since();
-- already live before this column existed: start from now (never backdate)
update public.tk_template_sets set live_since = now()
 where live_since is null and deleted_at is null
   and coalesce(public.tk__jsonb_bool((select s.value from public.tk_settings s where s.key = 'standard_set_live')), false);

-- 2. task_templates columns ----------------------------------------------
alter table public.task_templates add column if not exists template_set_id uuid references public.tk_template_sets(id);
-- Existing rows (none live at ship time) stay 'active'; new rows are drafts.
alter table public.task_templates add column if not exists status text not null default 'active';
alter table public.task_templates alter column status set default 'draft';
alter table public.task_templates add column if not exists due_rule jsonb;
alter table public.task_templates add column if not exists assignee_role text not null default 'bookkeeper';
alter table public.task_templates add column if not exists review_required boolean not null default false;
alter table public.task_templates add column if not exists sop_section text;
alter table public.task_templates add column if not exists estimate_minutes int;
alter table public.task_templates add column if not exists period_basis text not null default 'calendar';
alter table public.task_templates add column if not exists close_key text;
alter table public.task_templates add column if not exists activated_at timestamptz;
alter table public.task_templates add column if not exists source text not null default 'manual';
alter table public.task_templates add column if not exists source_ref text;
alter table public.task_templates add column if not exists updated_by text;

alter table public.task_templates drop constraint if exists task_templates_cadence;
alter table public.task_templates add constraint task_templates_cadence
  check (cadence in ('weekly', 'monthly', 'quarterly', 'annually'));
alter table public.task_templates drop constraint if exists task_templates_status_check;
alter table public.task_templates add constraint task_templates_status_check
  check (status in ('draft', 'active', 'retired'));
alter table public.task_templates drop constraint if exists task_templates_due_rule_check;
alter table public.task_templates add constraint task_templates_due_rule_check
  check (due_rule is null or public.tk_due_rule_valid(due_rule));
alter table public.task_templates drop constraint if exists task_templates_assignee_role_check;
alter table public.task_templates add constraint task_templates_assignee_role_check
  check (assignee_role in ('bookkeeper', 'backup', 'account_manager', 'reviewer'));
alter table public.task_templates drop constraint if exists task_templates_sop_section_check;
alter table public.task_templates add constraint task_templates_sop_section_check
  check (sop_section is null or sop_section in ('access', 'bank_feeds', 'monthly_close', 'payroll', 'bills_vendors', 'reporting', 'quirks'));
alter table public.task_templates drop constraint if exists task_templates_estimate_check;
alter table public.task_templates add constraint task_templates_estimate_check
  check (estimate_minutes is null or estimate_minutes between 1 and 10000);
alter table public.task_templates drop constraint if exists task_templates_period_basis_check;
alter table public.task_templates add constraint task_templates_period_basis_check
  check (period_basis in ('calendar', 'fiscal'));
alter table public.task_templates drop constraint if exists task_templates_close_key_check;
alter table public.task_templates add constraint task_templates_close_key_check
  check (close_key is null or close_key ~ '^[a-z][a-z0-9_]{0,39}$');
alter table public.task_templates drop constraint if exists task_templates_source_check;
alter table public.task_templates add constraint task_templates_source_check
  check (source in ('manual', 'asana', 'standard'));
alter table public.task_templates drop constraint if exists task_templates_set_clients_check;
alter table public.task_templates add constraint task_templates_set_clients_check
  check (cardinality(client_ids) <= 1 or template_set_id is null);
create unique index if not exists task_templates_set_close_key_uniq
  on public.task_templates (template_set_id, close_key) where template_set_id is not null and close_key is not null;

-- critique m3: an active template always has an activation date.
update public.task_templates set activated_at = coalesce(activated_at, created_at)
 where status = 'active' and activated_at is null;

-- Reads: admins see all; staff see firm-wide templates and ones for a
-- client they can reach. Writes: RPCs only (m11: no delete, retire).
drop policy if exists "admins manage task templates" on public.task_templates;
drop policy if exists "tk templates staff read" on public.task_templates;
create policy "tk templates staff read" on public.task_templates
  for select to authenticated using (
    public.is_active_staff_admin()
    or (public.is_active_staff()
        and (cardinality(client_ids) = 0
             or exists (select 1 from unnest(client_ids) u(cid) where public.can_access_client(u.cid)))));
revoke all on table public.task_templates from public, anon, authenticated;
grant select on table public.task_templates to authenticated;

drop policy if exists "tk issued staff read" on public.task_template_issued;
create policy "tk issued staff read" on public.task_template_issued
  for select to authenticated using (public.is_active_staff() and public.can_access_client(client_id));
revoke all on table public.task_template_issued from public, anon, authenticated;
grant select on table public.task_template_issued to authenticated;

-- 3. Per-client overrides -------------------------------------------------
create table if not exists public.tk_client_template_overrides (
  client_id text not null references public.clients(id),
  template_id uuid not null references public.task_templates(id),
  skip boolean not null default false,
  override jsonb not null default '{}'::jsonb check (jsonb_typeof(override) = 'object'),
  updated_by text,
  updated_at timestamptz not null default now(),
  primary key (client_id, template_id)
);
alter table public.tk_client_template_overrides enable row level security;
revoke all on table public.tk_client_template_overrides from public, anon, authenticated;
grant select on table public.tk_client_template_overrides to authenticated;
drop policy if exists "tk overrides staff read" on public.tk_client_template_overrides;
create policy "tk overrides staff read" on public.tk_client_template_overrides
  for select to authenticated using (public.is_active_staff() and public.can_access_client(client_id));

-- 4. Run log and missed periods --------------------------------------------
create table if not exists public.tk_generator_runs (
  id uuid primary key default gen_random_uuid(),
  ran_at timestamptz not null default now(),
  p_today date not null,
  trigger text not null check (trigger in ('cron', 'manual', 'preview')),
  dry_run boolean not null default false,
  ran_by text,
  created int not null default 0,
  skipped jsonb not null default '[]'::jsonb,
  missed jsonb not null default '[]'::jsonb,
  result jsonb not null default '{}'::jsonb
);
create index if not exists tk_generator_runs_ran_at_idx on public.tk_generator_runs (ran_at desc);
alter table public.tk_generator_runs enable row level security;
revoke all on table public.tk_generator_runs from public, anon, authenticated;
grant select on table public.tk_generator_runs to authenticated;
drop policy if exists "tk generator runs admin read" on public.tk_generator_runs;
create policy "tk generator runs admin read" on public.tk_generator_runs
  for select to authenticated using (public.is_active_staff_admin());

create table if not exists public.tk_generate_missed (
  template_id uuid not null references public.task_templates(id),
  client_id text not null references public.clients(id),
  period_start date not null,
  due_date date,
  label text,
  first_seen_at timestamptz not null default now(),
  dismissed_at timestamptz,
  dismissed_by text,
  issued_at timestamptz,
  issued_by text,
  reminder_id uuid,
  primary key (template_id, client_id, period_start)
);
create index if not exists tk_generate_missed_open_idx
  on public.tk_generate_missed (first_seen_at desc) where dismissed_at is null and issued_at is null;
alter table public.tk_generate_missed enable row level security;
revoke all on table public.tk_generate_missed from public, anon, authenticated;
grant select on table public.tk_generate_missed to authenticated;
drop policy if exists "tk missed admin read" on public.tk_generate_missed;
create policy "tk missed admin read" on public.tk_generate_missed
  for select to authenticated using (public.is_active_staff_admin());

-- 5. staff_reminders.template_id --------------------------------------------
alter table public.staff_reminders add column if not exists template_id uuid references public.task_templates(id);
create index if not exists staff_reminders_template_idx
  on public.staff_reminders (template_id, client_id) where template_id is not null;
-- backfill from the legacy source_ref '<tpl>:<client>:<YYYY-MM-DD>'
update public.staff_reminders r set template_id = t.id
  from public.task_templates t
 where r.source = 'template' and r.template_id is null
   and r.source_ref like t.id::text || ':%';

create or replace view public.tk_tasks with (security_invoker = true) as
select id, staff_email, text, due_date, done, created_at, client_id, priority, completed_at, kind,
       due_at, remind_at, recurrence, assignee_email, created_by, visibility, source, source_ref,
       status, status_changed_at, status_changed_by, status_before_wait, waiting_since, waiting_minutes,
       description, start_on, section, sort_key, parent_id, sop_section, review_required, series_id,
       updated_at, deleted_at, deleted_by, project_id, search_tsv,
       reviewer_email, send_back_count, ready_at, submitted_by, submitted_at,
       approved_by, approved_at, due_date_original, waiting_before_due_minutes,
       template_id, period_kind, period_start   -- tk p2 s4
  from public.staff_reminders
 where deleted_at is null;
revoke all on public.tk_tasks from public, anon, authenticated;
grant select on public.tk_tasks to authenticated;

-- 6. People lookup: internal (no JWT, critique B3) + gated wrapper -------
create or replace function public.tk__client_people(p_client text)
returns table(role text, email text, name text)
language sql
stable
security definer
set search_path = public
as $function$
  select x.r, lower(s.email), s.name
    from (values
      (1, 'bookkeeper', (select c.assigned_bookkeeper_email from clients c where c.id = p_client)),
      (2, 'backup', (select cp.backup_bookkeeper_email from client_profile cp where cp.client_id = p_client)),
      (3, 'account_manager', (select c.account_manager_email from clients c where c.id = p_client)),
      (4, 'reviewer', public.tk__default_reviewer(p_client, null))
    ) x(ord, r, em)
    join staff s on lower(s.email) = lower(x.em) and s.active
   where x.em is not null
   order by x.ord;
$function$;

create or replace function public.tk_client_people(p_client text)
returns table(role text, email text, name text)
language sql
stable
security definer
set search_path = public
as $function$
  select p.role, p.email, p.name
    from public.tk__client_people(p_client) p
   where public.is_active_staff()
     and public.can_access_client(p_client);
$function$;

-- 7. Period helpers ------------------------------------------------------
create or replace function public.tk__template_kind(p_cadence text, p_basis text)
returns text
language sql
immutable
set search_path = public
as $$
  select case p_cadence
    when 'weekly' then 'week'
    when 'monthly' then 'month'
    when 'quarterly' then 'quarter'      -- always calendar quarters (owner Q2, critique M6)
    when 'annually' then case when p_basis = 'fiscal' then 'year' else 'calendar_year' end
  end;
$$;

create or replace function public.tk__period_end(p_kind text, p_start date)
returns date
language sql
immutable
set search_path = public
as $$
  select case p_kind
    when 'week' then p_start + 6
    when 'month' then (p_start + interval '1 month' - interval '1 day')::date
    when 'quarter' then (p_start + interval '3 months' - interval '1 day')::date
    when 'year' then (p_start + interval '1 year' - interval '1 day')::date
    when 'calendar_year' then (p_start + interval '1 year' - interval '1 day')::date
  end;
$$;

-- Same labels as TK_periodLabel (TK_recurrenceLogic.js).
create or replace function public.tk__period_label(p_kind text, p_start date)
returns text
language sql
immutable
set search_path = public
as $$
  select case p_kind
    when 'week' then 'Wk of ' || to_char(p_start, 'Mon FMDD')
    when 'month' then to_char(p_start, 'Mon YYYY')
    when 'quarter' then 'Q' || extract(quarter from p_start)::int || ' ' || extract(year from p_start)::int
    when 'year' then 'FY ' || extract(year from public.tk__period_end('year', p_start))::int
    when 'calendar_year' then extract(year from p_start)::int::text
  end;
$$;

-- Effective settings for one template x client (override applied).
create or replace function public.tk__template_eff(p_t public.task_templates, p_client text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_o jsonb := '{}'::jsonb;
  v_skip boolean := false;
  v_fye text;
  v_rule jsonb;
  v_checklist jsonb;
begin
  select o.override, o.skip into v_o, v_skip
    from tk_client_template_overrides o where o.client_id = p_client and o.template_id = p_t.id;
  v_o := coalesce(v_o, '{}'::jsonb);
  select cp.fiscal_year_end into v_fye from client_profile cp where cp.client_id = p_client;
  v_rule := coalesce(case when jsonb_typeof(v_o -> 'due_rule') = 'object' and public.tk_due_rule_valid(v_o -> 'due_rule')
                          then v_o -> 'due_rule' end,
                     p_t.due_rule,
                     jsonb_build_object('type', 'offset', 'days', p_t.due_offset_days));
  v_checklist := case when jsonb_typeof(v_o -> 'checklist') = 'array' then v_o -> 'checklist'
                      else to_jsonb(coalesce(p_t.checklist, '{}'::text[])) end;
  return jsonb_build_object(
    'skip', coalesce(v_skip, false),
    'title', left(coalesce(nullif(btrim(v_o ->> 'title'), ''), p_t.title), 200),
    'rule', v_rule,
    'role', case when v_o ->> 'assignee_role' in ('bookkeeper', 'backup', 'account_manager', 'reviewer')
                 then v_o ->> 'assignee_role' else p_t.assignee_role end,
    'checklist', v_checklist,
    'review_required', coalesce(case when jsonb_typeof(v_o -> 'review_required') = 'boolean'
                                     then (v_o ->> 'review_required')::boolean end, p_t.review_required),
    'kind', public.tk__template_kind(p_t.cadence, p_t.period_basis),
    'fye', v_fye);
end $$;

-- 8. One period: resolve, then claim + insert together (critique B4) ----
-- Returns {status: 'created' | 'exists' | 'skipped' | 'would_create',
--          reason, assignee, reminder_id, due, label}.
-- p_dry_run: resolves only, writes nothing.
create or replace function public.tk__issue_period(p_t public.task_templates, p_eff jsonb, p_client text,
                                                   p_start date, p_dry_run boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind text := p_eff ->> 'kind';
  v_end date := public.tk__period_end(p_eff ->> 'kind', p_start);
  v_due date;
  v_label text := public.tk__period_label(p_eff ->> 'kind', p_start);
  v_role text := p_eff ->> 'role';
  v_to text;
  v_ref text := p_t.id::text || ':' || p_client || ':' || to_char(p_start, 'YYYY-MM-DD');
  v_id uuid;
  v_claimed boolean;
  v_pk text;
  v_items int;
begin
  v_due := public.tk_resolve_due(p_eff -> 'rule', p_start, v_end);
  if v_due is null then
    return jsonb_build_object('status', 'skipped', 'reason', 'bad_rule', 'label', v_label);
  end if;
  if exists (select 1 from task_template_issued i
              where i.template_id = p_t.id and i.client_id = p_client and i.period = p_start) then
    return jsonb_build_object('status', 'exists', 'due', v_due, 'label', v_label);
  end if;

  -- Assignee first (B4): the role, then bookkeeper, then account manager.
  select p.email into v_to from public.tk__client_people(p_client) p where p.role = v_role limit 1;
  if v_to is null then
    select p.email into v_to from public.tk__client_people(p_client) p where p.role = 'bookkeeper' limit 1;
  end if;
  if v_to is null then
    select p.email into v_to from public.tk__client_people(p_client) p where p.role = 'account_manager' limit 1;
  end if;
  if v_to is null then
    return jsonb_build_object('status', 'skipped', 'reason', 'no_assignee', 'due', v_due, 'label', v_label);
  end if;
  if not public.tk_staff_has_client(v_to, p_client) then
    return jsonb_build_object('status', 'skipped', 'reason', 'no_access', 'assignee', v_to, 'due', v_due, 'label', v_label);
  end if;
  if p_dry_run then
    return jsonb_build_object('status', 'would_create', 'assignee', v_to, 'due', v_due, 'label', v_label,
                              'start_on', v_due - p_t.lead_days);
  end if;

  -- Claim and insert in one block: a failure rolls both back.
  v_pk := case when v_kind in ('month', 'quarter', 'year') then v_kind end;   -- critique M6: week / calendar year have no period row
  begin
    insert into task_template_issued (template_id, client_id, period, reminder_id, assignee)
    values (p_t.id, p_client, p_start, null, v_to)
    on conflict do nothing
    returning true into v_claimed;
    if v_claimed is null then
      return jsonb_build_object('status', 'exists', 'due', v_due, 'label', v_label);
    end if;

    insert into staff_reminders (
      staff_email, assignee_email, text, client_id, priority, due_date, due_date_original, start_on,
      kind, recurrence, visibility, source, source_ref, template_id, series_id,
      period_kind, period_start, sop_section, review_required)
    values (
      v_to, v_to, (p_eff ->> 'title') || ' · ' || v_label, p_client, p_t.priority, v_due, v_due,
      v_due - p_t.lead_days,
      'task', 'none', 'shared', 'template', v_ref, p_t.id, md5(p_t.id::text || p_client)::uuid,
      v_pk, case when v_pk is not null then p_start end, p_t.sop_section,
      coalesce((p_eff ->> 'review_required')::boolean, false))
    on conflict (source_ref) where source = 'template' do nothing
    returning id into v_id;
    if v_id is null then
      -- a task with this key already exists (legacy run without a ledger row): point the claim at it
      select r.id into v_id from staff_reminders r where r.source = 'template' and r.source_ref = v_ref;
    else
      insert into task_checklist_items (reminder_id, text, sort_order)
      select v_id, left(btrim(x.item), 300), (x.ord - 1)::int
        from jsonb_array_elements_text(coalesce(p_eff -> 'checklist', '[]'::jsonb)) with ordinality as x(item, ord)
       where nullif(btrim(x.item), '') is not null and x.ord <= 50;
    end if;
    update task_template_issued set reminder_id = v_id
     where template_id = p_t.id and client_id = p_client and period = p_start;

    if v_pk is not null then
      begin
        insert into month_close (client_id, period_kind, period, status)
        values (p_client, v_pk, p_start, 'not_started')
        on conflict do nothing;
      exception when others then
        null;   -- the period row is a convenience; never lose the task over it
      end;
    end if;
  exception when others then
    -- claim and task roll back together; the period is retried next run
    return jsonb_build_object('status', 'skipped', 'reason', 'error', 'detail', left(sqlerrm, 200),
                              'due', v_due, 'label', v_label);
  end;
  return jsonb_build_object('status', 'created', 'assignee', v_to, 'reminder_id', v_id, 'due', v_due, 'label', v_label);
end $$;

-- 9. The generator ----------------------------------------------------------
-- p_only_template: preview one template (any status) as if activated today.
-- Dry runs only; tk_generate_preview passes it for admins.
create or replace function public.tk__generate(p_today date, p_dry_run boolean, p_client_id text,
                                               p_horizon_days int, p_trigger text, p_only_template uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := coalesce(p_today, (now() at time zone 'America/Chicago')::date);
  v_dry boolean := coalesce(p_dry_run, false) or p_only_template is not null;
  v_horizon int := greatest(coalesce(p_horizon_days, 0), 0);
  -- review fix (minor): a value that isn't a yes/no counts as off and is warned about, never aborts the run
  v_set_live_raw jsonb := (select value from tk_settings where key = 'standard_set_live');
  v_set_live boolean := coalesce(public.tk__jsonb_bool(v_set_live_raw), false);
  v_named_test boolean := false;
  v_live_since date;
  v_act_c date;
  -- critique m3: nothing due before on_time_since (S3 ship date) is listed as missed
  v_miss_floor date := (select (s.value #>> '{}')::date from tk_settings s where s.key = 'on_time_since');
  t public.task_templates%rowtype;
  v_set record;
  c record;
  v_eff jsonb;
  v_kind text;
  v_act date;
  v_start date;
  v_floor date;
  v_end date;
  v_due date;
  v_r jsonb;
  v_created int := 0;
  v_by jsonb := '{}'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_missed jsonb := '[]'::jsonb;
  v_would jsonb := '[]'::jsonb;
  v_upcoming jsonb := '[]'::jsonb;
  v_warn jsonb := '[]'::jsonb;
  v_n int := 0;
  v_max_hol date;
  v_result jsonb;
begin
  if p_client_id is not null then
    select coalesce(cl.test_only, false) or coalesce(cl.is_internal, false) into v_named_test
      from clients cl where cl.id = p_client_id;
    v_named_test := coalesce(v_named_test, false);
  end if;
  if not v_dry then
    perform pg_advisory_xact_lock(hashtext('tk_generate'));
    perform set_config('mgb.tk_generate', 'on', true);
  end if;

  for t in
    select tt.* from task_templates tt
     where (p_only_template is not null and tt.id = p_only_template)
        or (p_only_template is null and tt.active and tt.status = 'active')
     order by tt.created_at, tt.id
  loop
    v_live_since := null;
    if t.template_set_id is not null and p_only_template is null then
      select s.deleted_at, s.is_standard, s.live_since into v_set from tk_template_sets s where s.id = t.template_set_id;
      if v_set.deleted_at is not null then continue; end if;
      -- set members generate only when the owner turned the set on, or for a named test client
      if not v_set_live and not (p_client_id is not null and v_named_test) then continue; end if;
      v_live_since := (v_set.live_since at time zone 'America/Chicago')::date;   -- review fix (major 1)
    end if;
    v_act := case when p_only_template is not null then v_today
                  else coalesce((t.activated_at at time zone 'America/Chicago')::date,
                                (t.created_at at time zone 'America/Chicago')::date) end;
    -- review fix (major 1): a real client reaches a set member from the later of
    -- its activation and the moment the set went live; a named test client from activation.
    v_act_c := case when v_live_since is not null and not (p_client_id is not null and v_named_test)
                    then greatest(v_act, v_live_since) else v_act end;

    for c in
      select cl.id from clients cl
       where (case when p_client_id is not null then cl.id = p_client_id else public.is_roster_client(cl) end)
         and ((cardinality(t.plan_tiers) = 0 and cardinality(t.client_ids) = 0)
              or cl.plan = any (t.plan_tiers)
              or cl.id = any (t.client_ids))
       order by cl.id
    loop
      v_eff := public.tk__template_eff(t, c.id);
      if (v_eff ->> 'skip')::boolean then continue; end if;
      v_kind := v_eff ->> 'kind';
      v_floor := greatest(public.tk_period_start_for(v_kind, v_act_c, v_eff ->> 'fye'),
                          public.tk_period_start_for(v_kind, v_today - 365, v_eff ->> 'fye'));
      -- a period whose due date was before activation is neither created nor missed
      v_start := public.tk_period_start_for(v_kind, v_floor - 1, v_eff ->> 'fye');
      while v_start <= v_today + greatest(t.lead_days, v_horizon) + 130 loop
        v_end := public.tk__period_end(v_kind, v_start);
        v_due := public.tk_resolve_due(v_eff -> 'rule', v_start, v_end);
        if v_due is not null and v_due >= v_act_c then
          if v_due < v_today - 7 then
            -- owner Q7: past the 7-day grace -> listed, never created
            if (v_miss_floor is null or v_due >= v_miss_floor)
               and not exists (select 1 from task_template_issued i
                            where i.template_id = t.id and i.client_id = c.id and i.period = v_start)
               -- review fix (minor): a dismissed (or hand-made) period is not listed again
               and not exists (select 1 from tk_generate_missed m
                            where m.template_id = t.id and m.client_id = c.id and m.period_start = v_start
                              and (m.dismissed_at is not null or m.issued_at is not null)) then
              if jsonb_array_length(v_missed) < 300 then
                v_missed := v_missed || jsonb_build_object('template', t.id, 'title', v_eff ->> 'title', 'client', c.id,
                                                           'period', v_start, 'label', public.tk__period_label(v_kind, v_start), 'due', v_due);
              end if;
              if not v_dry then
                insert into tk_generate_missed (template_id, client_id, period_start, due_date, label)
                values (t.id, c.id, v_start, v_due, public.tk__period_label(v_kind, v_start))
                on conflict do nothing;
              end if;
            end if;
          elsif v_due - t.lead_days <= v_today then
            v_r := public.tk__issue_period(t, v_eff, c.id, v_start, v_dry);
            if v_r ->> 'status' = 'created' then
              v_created := v_created + 1;
              v_by := jsonb_set(v_by, array[v_r ->> 'assignee'], to_jsonb(coalesce((v_by ->> (v_r ->> 'assignee'))::int, 0) + 1));
            elsif v_r ->> 'status' = 'would_create' then
              if jsonb_array_length(v_would) < 500 then
                v_would := v_would || (v_r || jsonb_build_object('template', t.id, 'title', v_eff ->> 'title', 'client', c.id, 'period', v_start));
              end if;
            elsif v_r ->> 'status' = 'skipped' then
              if jsonb_array_length(v_skipped) < 300 then
                v_skipped := v_skipped || jsonb_build_object('template', t.id, 'title', v_eff ->> 'title', 'client', c.id,
                                                             'period', v_start, 'label', v_r ->> 'label', 'reason', v_r ->> 'reason',
                                                             'detail', v_r ->> 'detail');
              end if;
            end if;
          elsif v_dry and v_horizon > 0 and v_due - t.lead_days <= v_today + v_horizon then
            if not exists (select 1 from task_template_issued i
                            where i.template_id = t.id and i.client_id = c.id and i.period = v_start)
               and jsonb_array_length(v_upcoming) < 500 then
              v_upcoming := v_upcoming || jsonb_build_object('template', t.id, 'title', v_eff ->> 'title', 'client', c.id,
                                                             'period', v_start, 'label', public.tk__period_label(v_kind, v_start),
                                                             'due', v_due, 'start_on', v_due - t.lead_days);
            end if;
          end if;
        end if;
        v_start := v_end + 1;
        v_n := v_n + 1;
        exit when v_n > 200000;   -- runaway guard
      end loop;
    end loop;
  end loop;

  -- critique m1: business-day maths needs holidays a year ahead
  select max(h.day) into v_max_hol from tk_holidays h;
  if v_max_hol is null or v_max_hol < v_today + 365 then
    v_warn := v_warn || to_jsonb('Firm holidays run out on ' || coalesce(v_max_hol::text, 'never set') || '. Add next year''s holidays.'::text);
  end if;
  if v_set_live_raw is not null and public.tk__jsonb_bool(v_set_live_raw) is null then
    v_warn := v_warn || to_jsonb('The standard set switch has an unreadable value, so it counts as off. The owner can switch it again.'::text);
  end if;

  v_result := jsonb_build_object('created', v_created, 'by_assignee', v_by, 'skipped', v_skipped, 'missed', v_missed,
                                 'dry_run', v_dry, 'today', v_today, 'warnings', v_warn);
  if v_dry then
    v_result := v_result || jsonb_build_object('would_create', v_would, 'upcoming', v_upcoming);
  else
    insert into tk_generator_runs (p_today, trigger, dry_run, ran_by, created, skipped, missed, result)
    values (v_today, coalesce(p_trigger, 'cron'), false, nullif(lower(coalesce(auth.jwt() ->> 'email', '')), ''),
            v_created, v_skipped, v_missed, v_result - 'skipped' - 'missed');
    perform set_config('mgb.tk_generate', '', true);
  end if;
  return v_result;
end $$;

-- Public entry. No JWT (cron, SQL editor): any p_today. Signed in: active
-- admin only; a real run always uses today (Central).
create or replace function public.tk_generate(p_today date default null, p_dry_run boolean default false,
                                              p_client_id text default null, p_horizon_days int default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_ct date := (now() at time zone 'America/Chicago')::date;
begin
  if v_me = '' and auth.uid() is null then
    return public.tk__generate(coalesce(p_today, v_ct), p_dry_run, p_client_id, p_horizon_days, 'cron');
  end if;
  if not public.is_active_staff_admin() then
    raise exception 'tk_forbidden' using errcode = '42501';
  end if;
  if coalesce(p_dry_run, false) then
    return public.tk__generate(coalesce(p_today, v_ct), true, p_client_id, p_horizon_days, 'preview');
  end if;
  return public.tk__generate(v_ct, false, p_client_id, null, 'manual');
end $$;

-- Dry run with a horizon. A named client needs access; all clients or a
-- single template (any status) needs an admin. Writes nothing.
create or replace function public.tk_generate_preview(p_client_id text default null, p_days int default 30,
                                                      p_template_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_active_staff() then
    raise exception 'tk_forbidden' using errcode = '42501';
  end if;
  if (p_client_id is null or p_template_id is not null) and not public.is_active_staff_admin() then
    raise exception 'tk_forbidden' using errcode = '42501';
  end if;
  if p_client_id is not null and not public.can_access_client(p_client_id) then
    raise exception 'tk_forbidden' using errcode = '42501';
  end if;
  return public.tk__generate((now() at time zone 'America/Chicago')::date, true, p_client_id,
                             least(greatest(coalesce(p_days, 30), 0), 120), 'preview', p_template_id);
end $$;

-- Legacy names, same return type.
create or replace function public.tt_generate_template_tasks(p_today date default current_date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  v := public.tk_generate(p_today);
  return v || jsonb_build_object('skipped_no_assignee',
    (select count(*) from jsonb_array_elements(v -> 'skipped') e where e ->> 'reason' = 'no_assignee'));
end $$;

create or replace function public.tt_generate_now()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  if not public.is_active_staff_admin() then
    raise exception 'Only admins can generate template tasks' using errcode = '42501';
  end if;
  v := public.tk_generate();
  return v || jsonb_build_object('skipped_no_assignee',
    (select count(*) from jsonb_array_elements(v -> 'skipped') e where e ->> 'reason' = 'no_assignee'));
end $$;

-- 10. Template RPCs -------------------------------------------------------
-- Save (create or edit). Admin only. New templates start as drafts;
-- status and activation go through tk_set_template_status.
create or replace function public.tk_save_template(p_id uuid, p_tpl jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_id uuid := p_id;
  v_checklist text[];
  v_tiers text[];
  v_clients text[];
  v_rule jsonb;
  v_old task_templates%rowtype;   -- review fix (major 2)
begin
  if not public.is_active_staff_admin() then
    raise exception 'tk_forbidden' using errcode = '42501';
  end if;
  if p_tpl is null or jsonb_typeof(p_tpl) <> 'object' then
    raise exception 'tk_bad_template' using errcode = '22023';
  end if;
  v_checklist := array(select left(btrim(x), 300) from jsonb_array_elements_text(coalesce(p_tpl -> 'checklist', '[]'::jsonb)) x
                        where nullif(btrim(x), '') is not null);
  if cardinality(v_checklist) > 50 then
    raise exception 'tk_checklist_too_long' using errcode = '22023';
  end if;
  v_tiers := array(select x from jsonb_array_elements_text(coalesce(p_tpl -> 'plan_tiers', '[]'::jsonb)) x);
  v_clients := array(select x from jsonb_array_elements_text(coalesce(p_tpl -> 'client_ids', '[]'::jsonb)) x);
  v_rule := case when jsonb_typeof(p_tpl -> 'due_rule') = 'object' then p_tpl -> 'due_rule' end;
  if v_rule is not null and not public.tk_due_rule_valid(v_rule) then
    raise exception 'tk_bad_due_rule' using errcode = '22023';
  end if;

  if v_id is null then
    insert into task_templates (title, cadence, due_offset_days, due_rule, lead_days, plan_tiers, client_ids, priority,
                                checklist, assignee_role, review_required, sop_section, estimate_minutes, period_basis,
                                status, active, created_by, updated_by, source)
    values (btrim(p_tpl ->> 'title'), coalesce(p_tpl ->> 'cadence', 'monthly'),
            coalesce((p_tpl ->> 'due_offset_days')::int, 10), v_rule, coalesce((p_tpl ->> 'lead_days')::int, 14),
            v_tiers, v_clients, coalesce(p_tpl ->> 'priority', 'normal'), v_checklist,
            coalesce(p_tpl ->> 'assignee_role', 'bookkeeper'), coalesce((p_tpl ->> 'review_required')::boolean, false),
            nullif(p_tpl ->> 'sop_section', ''), nullif(p_tpl ->> 'estimate_minutes', '')::int,
            coalesce(p_tpl ->> 'period_basis', 'calendar'), 'draft', true, v_me, v_me, 'manual')
    returning id into v_id;
  else
    -- review fix (major 2): periods are keyed by their start date, so once a
    -- template has been on (or made a task) a new cadence or year basis would
    -- skip or double periods (monthly -> quarterly never makes Q4; calendar ->
    -- fiscal makes a second yearly task). Retire it and make a new one.
    select * into v_old from task_templates where id = v_id for update;
    if not found then
      raise exception 'tk_not_found' using errcode = 'P0002';
    end if;
    if (v_old.status <> 'draft' or v_old.activated_at is not null
        or exists (select 1 from task_template_issued i where i.template_id = v_id))
       and public.tk__template_kind(coalesce(p_tpl ->> 'cadence', v_old.cadence),
                                    coalesce(p_tpl ->> 'period_basis', v_old.period_basis))
           is distinct from public.tk__template_kind(v_old.cadence, v_old.period_basis) then
      raise exception 'tk_cadence_locked' using errcode = '22023';
    end if;
    update task_templates set
      title = btrim(coalesce(p_tpl ->> 'title', title)),
      cadence = coalesce(p_tpl ->> 'cadence', cadence),
      due_offset_days = coalesce((p_tpl ->> 'due_offset_days')::int, due_offset_days),
      due_rule = case when p_tpl ? 'due_rule' then v_rule else due_rule end,
      lead_days = coalesce((p_tpl ->> 'lead_days')::int, lead_days),
      plan_tiers = case when p_tpl ? 'plan_tiers' then v_tiers else plan_tiers end,
      client_ids = case when p_tpl ? 'client_ids' then v_clients else client_ids end,
      priority = coalesce(p_tpl ->> 'priority', priority),
      checklist = case when p_tpl ? 'checklist' then v_checklist else checklist end,
      assignee_role = coalesce(p_tpl ->> 'assignee_role', assignee_role),
      review_required = coalesce((p_tpl ->> 'review_required')::boolean, review_required),
      sop_section = case when p_tpl ? 'sop_section' then nullif(p_tpl ->> 'sop_section', '') else sop_section end,
      estimate_minutes = case when p_tpl ? 'estimate_minutes' then nullif(p_tpl ->> 'estimate_minutes', '')::int else estimate_minutes end,
      period_basis = coalesce(p_tpl ->> 'period_basis', period_basis),
      updated_by = v_me
     where id = v_id;
    if not found then
      raise exception 'tk_not_found' using errcode = 'P0002';
    end if;
  end if;
  return v_id;
end $$;

-- p_action: activate (draft/retired -> active, stamps activated_at),
-- pause / resume (the active switch; resume re-stamps activated_at so the
-- paused months are neither created nor listed as missed), retire,
-- draft (back to draft). Admin only.
create or replace function public.tk_set_template_status(p_id uuid, p_action text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_t task_templates%rowtype;
begin
  if not public.is_active_staff_admin() then
    raise exception 'tk_forbidden' using errcode = '42501';
  end if;
  select * into v_t from task_templates where id = p_id for update;
  if not found then
    raise exception 'tk_not_found' using errcode = 'P0002';
  end if;
  if p_action = 'activate' then
    update task_templates set status = 'active', active = true, activated_at = now(), updated_by = v_me where id = p_id;
  elsif p_action = 'pause' then
    update task_templates set active = false, updated_by = v_me where id = p_id;
  elsif p_action = 'resume' then
    update task_templates set active = true,
           activated_at = case when status = 'active' then now() else activated_at end, updated_by = v_me
     where id = p_id;
  elsif p_action = 'retire' then
    update task_templates set status = 'retired', updated_by = v_me where id = p_id;
  elsif p_action = 'draft' then
    update task_templates set status = 'draft', updated_by = v_me where id = p_id;
  else
    raise exception 'tk_bad_action' using errcode = '22023';
  end if;
  return (select jsonb_build_object('id', id, 'status', status, 'active', active, 'activated_at', activated_at)
            from task_templates where id = p_id);
end $$;

-- Per-client skip / override. Staff with access to the client.
create or replace function public.tk_set_client_override(p_client_id text, p_template_id uuid, p_skip boolean,
                                                         p_override jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_o jsonb := coalesce(p_override, '{}'::jsonb);
  k text;
  v_admin_review jsonb;   -- review fix (major 3)
begin
  if not public.is_active_staff() or not public.can_access_client(p_client_id) then
    raise exception 'tk_forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from task_templates where id = p_template_id) then
    raise exception 'tk_not_found' using errcode = 'P0002';
  end if;
  if jsonb_typeof(v_o) <> 'object' then
    raise exception 'tk_bad_override' using errcode = '22023';
  end if;
  for k in select jsonb_object_keys(v_o) loop
    if k not in ('title', 'due_rule', 'assignee_role', 'checklist', 'review_required') then
      raise exception 'tk_bad_override' using errcode = '22023';
    end if;
  end loop;
  if v_o ? 'due_rule' and not public.tk_due_rule_valid(v_o -> 'due_rule') then
    raise exception 'tk_bad_due_rule' using errcode = '22023';
  end if;
  if v_o ? 'assignee_role' and v_o ->> 'assignee_role' not in ('bookkeeper', 'backup', 'account_manager', 'reviewer') then
    raise exception 'tk_bad_override' using errcode = '22023';
  end if;
  if v_o ? 'title' and char_length(coalesce(v_o ->> 'title', '')) > 200 then
    raise exception 'tk_bad_override' using errcode = '22023';
  end if;
  if v_o ? 'checklist' and (jsonb_typeof(v_o -> 'checklist') <> 'array' or jsonb_array_length(v_o -> 'checklist') > 50) then
    raise exception 'tk_bad_override' using errcode = '22023';
  end if;
  if v_o ? 'review_required' and jsonb_typeof(v_o -> 'review_required') <> 'boolean' then
    raise exception 'tk_bad_override' using errcode = '22023';
  end if;
  -- only admins switch review off for a client. Review fix (major 3): when an
  -- admin already switched it off, a non-admin's save keeps that setting as
  -- it is (whatever the call sends), so they can still skip or change the rest.
  if not public.is_active_staff_admin() then
    select (o.override -> 'review_required') into v_admin_review
      from tk_client_template_overrides o
     where o.client_id = p_client_id and o.template_id = p_template_id;
    if v_admin_review = 'false'::jsonb then
      v_o := jsonb_set(v_o, '{review_required}', 'false'::jsonb);
    elsif v_o -> 'review_required' = 'false'::jsonb then
      raise exception 'tk_review_admin_only' using errcode = '42501';
    end if;
  end if;
  insert into tk_client_template_overrides (client_id, template_id, skip, override, updated_by, updated_at)
  values (p_client_id, p_template_id, coalesce(p_skip, false), v_o, lower(auth.jwt() ->> 'email'), now())
  on conflict (client_id, template_id) do update
    set skip = excluded.skip, override = excluded.override, updated_by = excluded.updated_by, updated_at = now();
end $$;

-- Missed periods: an admin creates one by hand, or dismisses it.
create or replace function public.tk_issue_missed(p_template_id uuid, p_client_id text, p_period_start date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_t task_templates%rowtype;
  v_r jsonb;
begin
  if not public.is_active_staff_admin() then
    raise exception 'tk_forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from tk_generate_missed m
                  where m.template_id = p_template_id and m.client_id = p_client_id and m.period_start = p_period_start
                    and m.dismissed_at is null and m.issued_at is null) then
    raise exception 'tk_not_found' using errcode = 'P0002';
  end if;
  select * into v_t from task_templates where id = p_template_id;
  if v_t.status = 'retired' then
    raise exception 'tk_template_retired' using errcode = '22023';
  end if;
  perform set_config('mgb.tk_generate', 'on', true);
  v_r := public.tk__issue_period(v_t, public.tk__template_eff(v_t, p_client_id), p_client_id, p_period_start, false);
  perform set_config('mgb.tk_generate', '', true);
  -- Review fix (major 4): 'created' and 'exists' close the row (an existing
  -- task is linked). 'skipped' leaves it open and the caller shows the reason.
  if v_r ->> 'status' = 'exists' and nullif(v_r ->> 'reminder_id', '') is null then
    v_r := v_r || jsonb_build_object('reminder_id',
             (select i.reminder_id from task_template_issued i
               where i.template_id = p_template_id and i.client_id = p_client_id and i.period = p_period_start));
  end if;
  if v_r ->> 'status' in ('created', 'exists') then
    update tk_generate_missed set issued_at = now(), issued_by = v_me,
           reminder_id = nullif(v_r ->> 'reminder_id', '')::uuid
     where template_id = p_template_id and client_id = p_client_id and period_start = p_period_start;
  end if;
  return v_r;
end $$;

create or replace function public.tk_dismiss_missed(p_template_id uuid, p_client_id text, p_period_start date)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_active_staff_admin() then
    raise exception 'tk_forbidden' using errcode = '42501';
  end if;
  update tk_generate_missed set dismissed_at = now(), dismissed_by = lower(auth.jwt() ->> 'email')
   where template_id = p_template_id and client_id = p_client_id and period_start = p_period_start
     and dismissed_at is null and issued_at is null;
end $$;

-- 11. Trigger edits ---------------------------------------------------------
-- critique M2: the generator's inserts bypass the client-write pins.
select pg_temp.patch_fn('public.staff_reminders_before_write()',
  $a$or coalesce(current_setting('mgb.tk_migrate', true),'') = 'on';$a$,
  $b$or coalesce(current_setting('mgb.tk_migrate', true),'') = 'on'
            or coalesce(current_setting('mgb.tk_generate', true),'') = 'on';   -- tk p2 s4 (critique M2)$b$, 1);

-- Generated tasks never send the one-by-one assignment email.
select pg_temp.patch_fn('public.notify_enqueue_task_assigned()',
  $a$  if coalesce(new.source, 'manual') = 'access_request' then$a$,
  $b$  if coalesce(current_setting('mgb.tk_generate', true), '') = 'on' then   -- tk p2 s4: no email per generated task
    return null;
  end if;
  if coalesce(new.source, 'manual') = 'access_request' then$b$, 1);

-- 12. tk_set_reviewer: a task already in review emails its new reviewer ---
create or replace function public.tk_set_reviewer(p_id uuid, p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(nullif(btrim(coalesce(p_email, '')), ''));
  v_row staff_reminders%rowtype;
  v_by text;   -- tk p2 s4
  v_to text;   -- tk p2 s4
  v_payload jsonb;   -- tk p2 s4
begin
  if coalesce(auth.jwt() ->> 'email', '') = '' or not public.is_active_staff_admin() then
    raise exception 'tk_forbidden' using errcode = '42501';
  end if;
  select * into v_row from staff_reminders r where r.id = p_id and r.deleted_at is null for update;
  if not found or not public.tk_can_edit_task(p_id) then
    raise exception 'tk_forbidden' using errcode = '42501';
  end if;
  if v_email is not null and (not public.tk__is_active_admin(v_email)
       or v_email = lower(coalesce(v_row.assignee_email, v_row.staff_email))
       or (v_row.status = 'ready_for_review' and v_email = lower(coalesce(v_row.submitted_by, '')))) then
    raise exception 'tk_bad_reviewer' using errcode = '22023';
  end if;
  update staff_reminders set reviewer_email = v_email where id = p_id;
  -- tk p2 s4 (S3 leftover b): already in review and the reviewer changed ->
  -- tell the new reviewer, or every eligible admin when cleared (same rule
  -- and email kind as tk_review_notify).
  if v_row.status = 'ready_for_review' and v_email is distinct from lower(v_row.reviewer_email) then   -- tk p2 s4
    select s.name into v_by from staff s where lower(s.email) = lower(coalesce(v_row.submitted_by, '')) and s.active;
    v_payload := jsonb_build_object('text', left(v_row.text, 200), 'due_date', v_row.due_date,
                                    'by', coalesce(v_by, 'A teammate'), 'kind', 'task');
    for v_to in
      select lower(s.email) from staff s
       where s.active and s.role = 'admin'
         and lower(s.email) is distinct from lower(coalesce(v_row.submitted_by, ''))
         and lower(s.email) is distinct from lower(coalesce(v_row.assignee_email, ''))
         and (v_email is null or lower(s.email) = v_email)
         and (v_row.client_id is null or public.tk_staff_has_client(s.email, v_row.client_id))
    loop
      perform public.tk__enqueue('staff_task_review_ready', v_to, v_row.client_id, v_row.id::text, v_payload);
    end loop;
  end if;   -- tk p2 s4
end $$;

-- 13. Standard close set (DRAFT; owner turns it on later) ----------------
insert into public.tk_template_sets (name, is_standard)
values ('MGB Standard Monthly Close', true)
on conflict (name) do nothing;

insert into public.task_templates (title, cadence, due_offset_days, due_rule, lead_days, priority, status, active,
                                   template_set_id, close_key, source, sop_section, review_required, plan_tiers, client_ids)
select v.title, 'monthly', 10, v.rule, v.lead, 'normal', 'draft', true, s.id, v.key, 'standard', v.sop, false,
       '{}'::text[], '{}'::text[]
  from public.tk_template_sets s
  cross join (values
    ('bank_feed', 'Categorize the bank feed',          '{"type":"business_day","n":5}'::jsonb,  7, 'bank_feeds'),
    ('bank_rec',  'Reconcile bank accounts',           '{"type":"business_day","n":8}'::jsonb,  7, 'monthly_close'),
    ('card_rec',  'Reconcile credit cards',            '{"type":"business_day","n":8}'::jsonb,  7, 'monthly_close'),
    ('entries',   'Post payroll and journal entries',  '{"type":"business_day","n":10}'::jsonb, 7, 'monthly_close'),
    ('review',    'Review the reports',                '{"type":"business_day","n":12}'::jsonb, 7, 'reporting'),
    ('sent',      'Send the reports to the client',    '{"type":"business_day","n":15}'::jsonb, 7, 'reporting')
  ) v(key, title, rule, lead, sop)
 where s.name = 'MGB Standard Monthly Close'
   and not exists (select 1 from public.task_templates t where t.template_set_id = s.id and t.close_key = v.key);

-- standard_set_live is an owner-only tk_settings key: not seeded here
-- (missing = off). The owner turns it on in Tasks › Recurring when ready.

-- 14. Cron: plain SQL, no secret ---------------------------------------------
select cron.unschedule(jobid) from cron.job where jobname in ('task-templates-daily');
select cron.schedule('task-templates-daily', '15 10 * * *', $$select public.tk_generate()$$);

-- 15. Schema probe -------------------------------------------------------
create or replace function public.tk_schema_version()
returns int
language sql
stable
set search_path = public
as $$ select 5 $$;

-- 16. Grants -------------------------------------------------------------
revoke all on function public.tk__jsonb_bool(jsonb) from public, anon, authenticated;
revoke all on function public.tk__client_people(text) from public, anon, authenticated;
revoke all on function public.tk_client_people(text) from public, anon, authenticated;
revoke all on function public.tk__template_kind(text, text) from public, anon, authenticated;
revoke all on function public.tk__period_end(text, date) from public, anon, authenticated;
revoke all on function public.tk__period_label(text, date) from public, anon, authenticated;
revoke all on function public.tk__template_eff(public.task_templates, text) from public, anon, authenticated;
revoke all on function public.tk__issue_period(public.task_templates, jsonb, text, date, boolean) from public, anon, authenticated;
revoke all on function public.tk__generate(date, boolean, text, int, text, uuid) from public, anon, authenticated;
revoke all on function public.tk_generate(date, boolean, text, int) from public, anon, authenticated;
revoke all on function public.tk_generate_preview(text, int, uuid) from public, anon, authenticated;
revoke all on function public.tt_generate_template_tasks(date) from public, anon, authenticated;
revoke all on function public.tt_generate_now() from public, anon, authenticated;
revoke all on function public.tk_save_template(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.tk_set_template_status(uuid, text) from public, anon, authenticated;
revoke all on function public.tk_set_client_override(text, uuid, boolean, jsonb) from public, anon, authenticated;
revoke all on function public.tk_issue_missed(uuid, text, date) from public, anon, authenticated;
revoke all on function public.tk_dismiss_missed(uuid, text, date) from public, anon, authenticated;
revoke all on function public.tk_set_reviewer(uuid, text) from public, anon, authenticated;
revoke all on function public.tk_schema_version() from public, anon, authenticated;

grant execute on function public.tk_client_people(text) to authenticated;
grant execute on function public.tk_generate(date, boolean, text, int) to authenticated;
grant execute on function public.tk_generate_preview(text, int, uuid) to authenticated;
grant execute on function public.tt_generate_now() to authenticated;
grant execute on function public.tk_save_template(uuid, jsonb) to authenticated;
grant execute on function public.tk_set_template_status(uuid, text) to authenticated;
grant execute on function public.tk_set_client_override(text, uuid, boolean, jsonb) to authenticated;
grant execute on function public.tk_issue_missed(uuid, text, date) to authenticated;
grant execute on function public.tk_dismiss_missed(uuid, text, date) to authenticated;
grant execute on function public.tk_set_reviewer(uuid, text) to authenticated;
grant execute on function public.tk_schema_version() to authenticated;
