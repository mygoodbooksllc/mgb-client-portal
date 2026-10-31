-- Applied to production 2026-10-28 (migration slateplus_rules). Self-tests
-- (supabase/slateplus-rules-tests.sql) pass live, rolled back; no advisor errors (only the usual
-- "authenticated can call this definer RPC" warnings for the five tk_rule_* RPCs, which check
-- full admin inside). The firm switch slateplus_enabled is still unset.
-- Slate plus: Rules (simple automations). Spec: docs/slateplus-rules-spec.md
-- Additive only: two new tables (tk_rules, tk_rule_runs), new RPCs, two AFTER triggers on
-- staff_reminders that return after one primary-key read of tk_settings while the firm switch
-- slateplus_enabled is not JSON true (it is unset today; this file never sets it), and one daily
-- cron job that returns 0 for the same reason. Rules also need their own owner-only 'enabled'
-- box (default false). One existing function is widened: tk_comments_before_write gains a
-- branch for a 'system' comment written while mgb.tk_rule = 'on' (every old input as before).
-- No emails, no bell notices. Re-runnable. Never deletes data.

-- 1. Tables ------------------------------------------------------------------
create or replace function public.tk__rule_pair_ok(p_trigger text, p_action text)
returns boolean language sql immutable set search_path to 'public' as $$
  select (p_trigger, p_action) in (
    ('section_moved', 'assign'), ('section_moved', 'set_due'), ('section_moved', 'comment'), ('section_moved', 'follow_up'),
    ('done', 'move_section'), ('done', 'comment'), ('done', 'follow_up'),
    ('overdue', 'assign'), ('overdue', 'move_section'), ('overdue', 'comment'),
    ('assigned', 'set_due'), ('assigned', 'move_section'), ('assigned', 'comment'));
$$;

create table if not exists public.tk_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  scope_kind text not null check (scope_kind in ('project', 'client')),
  project_id uuid references public.tk_projects(id) on delete cascade,
  client_id text references public.clients(id) on delete cascade,
  trigger_kind text not null check (trigger_kind in ('section_moved', 'done', 'overdue', 'assigned')),
  trigger_config jsonb not null default '{}'::jsonb,
  action_kind text not null check (action_kind in ('assign', 'set_due', 'move_section', 'comment', 'follow_up')),
  action_config jsonb not null default '{}'::jsonb,
  enabled boolean not null default false,
  enabled_at timestamptz,
  enabled_by text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_by text,
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by text,
  constraint tk_rules_scope_chk check (
    (scope_kind = 'project' and project_id is not null and client_id is null)
    or (scope_kind = 'client' and client_id is not null and project_id is null)),
  constraint tk_rules_pair_chk check (public.tk__rule_pair_ok(trigger_kind, action_kind)),
  constraint tk_rules_archived_off check (archived_at is null or not enabled)
);
create index if not exists tk_rules_live_project on public.tk_rules (trigger_kind, project_id)
  where enabled and archived_at is null;
create index if not exists tk_rules_live_client on public.tk_rules (trigger_kind, client_id)
  where enabled and archived_at is null;
alter table public.tk_rules enable row level security;
drop policy if exists "tk rules staff read" on public.tk_rules;
create policy "tk rules staff read" on public.tk_rules
  for select to authenticated
  using (public.is_active_staff() and (
    public.is_active_staff_admin()
    or (scope_kind = 'project' and public.tk_can_see_project(project_id))
    or (scope_kind = 'client' and public.can_access_client(client_id))));
revoke all on public.tk_rules from anon, authenticated;
grant select on public.tk_rules to authenticated;

create table if not exists public.tk_rule_runs (
  id bigint generated always as identity primary key,
  rule_id uuid not null references public.tk_rules(id) on delete cascade,
  task_id uuid not null references public.staff_reminders(id) on delete cascade,
  event_key text not null,
  trigger_kind text not null,
  action_kind text not null,
  outcome text not null check (outcome in ('pending', 'ok', 'noop', 'skipped', 'error')),
  detail text check (detail is null or char_length(detail) <= 500),
  from_value text,
  to_value text,
  created_task_id uuid,
  comment_id uuid,
  actor_email text,
  depth smallint not null default 0,
  created_at timestamptz not null default now(),
  constraint tk_rule_runs_once unique (rule_id, task_id, event_key)
);
create index if not exists tk_rule_runs_recent on public.tk_rule_runs (created_at desc);
create index if not exists tk_rule_runs_rule on public.tk_rule_runs (rule_id, created_at desc);
create index if not exists tk_rule_runs_task on public.tk_rule_runs (task_id);
alter table public.tk_rule_runs enable row level security;
drop policy if exists "tk rule runs admin read" on public.tk_rule_runs;
create policy "tk rule runs admin read" on public.tk_rule_runs
  for select to authenticated
  using (public.is_active_staff_admin() and public.tk_can_read_task(task_id));
revoke all on public.tk_rule_runs from anon, authenticated;
grant select on public.tk_rule_runs to authenticated;

-- 2. Small internals ----------------------------------------------------------
-- The firm switch. Missing or not JSON true = rules never run.
create or replace function public.tk__rules_live()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce((select public.tk__jsonb_bool(s.value) from public.tk_settings s where s.key = 'slateplus_enabled'), false);
$$;

create or replace function public.tk__rule_today()
returns date language sql stable set search_path to 'public' as $$
  select (now() at time zone 'America/Chicago')::date;
$$;

-- A background job is writing (generator, rhythm, OOO, import, migrate, close, undo,
-- offboarding, roll-forward). Rules ignore those changes.
create or replace function public.tk__rules_background()
returns boolean language sql stable set search_path to 'public' as $$
  select coalesce(current_setting('mgb.tk_generate', true), '') = 'on'
      or coalesce(current_setting('mgb.tk_rhythm', true), '') = 'on'
      or coalesce(current_setting('mgb.tk_ooo', true), '') in ('on', 'quiet')
      or coalesce(current_setting('mgb.tk_import', true), '') = 'on'
      or coalesce(current_setting('mgb.tk_migrate', true), '') = 'on'
      or coalesce(current_setting('mgb.tk_close', true), '') = 'on'
      or coalesce(current_setting('mgb.tk_undo', true), '') = 'on'
      or coalesce(current_setting('mgb.offboarding', true), '') = 'on'
      or coalesce(current_setting('mgb.tk_rollforward', true), '') = 'on';
$$;

create or replace function public.tk__rule_int(p jsonb)
returns integer language sql immutable set search_path to 'public' as $$
  select case
    when jsonb_typeof(p) = 'number' and (p #>> '{}') ~ '^-?\d{1,6}$' then (p #>> '{}')::int
    when jsonb_typeof(p) = 'string' and btrim(p #>> '{}') ~ '^-?\d{1,6}$' then btrim(p #>> '{}')::int
  end;
$$;

create or replace function public.tk__rule_staff_name(p_email text)
returns text language sql stable security definer set search_path to 'public' as $$
  select coalesce((select s.name from public.staff s where lower(s.email) = lower(p_email) limit 1), p_email);
$$;

-- Build a clean rule row from browser input: only known keys, trimmed, lower-case emails.
create or replace function public.tk__rule_from_json(p jsonb)
returns public.tk_rules language plpgsql stable set search_path to 'public' as $$
declare
  r public.tk_rules;
  v_t jsonb := coalesce(p -> 'trigger_config', '{}'::jsonb);
  v_a jsonb := coalesce(p -> 'action_config', '{}'::jsonb);
  v_s text;
begin
  if jsonb_typeof(v_t) <> 'object' then v_t := '{}'::jsonb; end if;
  if jsonb_typeof(v_a) <> 'object' then v_a := '{}'::jsonb; end if;
  r.id := case when coalesce(p ->> 'id', '') ~* '^[0-9a-f-]{36}$' then (p ->> 'id')::uuid end;
  r.name := nullif(btrim(coalesce(p ->> 'name', '')), '');
  r.scope_kind := nullif(btrim(coalesce(p ->> 'scope_kind', '')), '');
  r.project_id := case when r.scope_kind = 'project' and coalesce(p ->> 'project_id', '') ~* '^[0-9a-f-]{36}$'
                       then (p ->> 'project_id')::uuid end;
  r.client_id := case when r.scope_kind = 'client' then nullif(btrim(coalesce(p ->> 'client_id', '')), '') end;
  r.trigger_kind := nullif(btrim(coalesce(p ->> 'trigger_kind', '')), '');
  r.action_kind := nullif(btrim(coalesce(p ->> 'action_kind', '')), '');
  r.trigger_config := case r.trigger_kind
    when 'section_moved' then jsonb_build_object('section', nullif(btrim(coalesce(v_t ->> 'section', '')), ''))
    when 'assigned' then case when nullif(btrim(coalesce(v_t ->> 'email', '')), '') is null then '{}'::jsonb
                              else jsonb_build_object('email', lower(btrim(v_t ->> 'email'))) end
    else '{}'::jsonb end;
  v_s := lower(nullif(btrim(coalesce(v_a ->> 'assignee', '')), ''));
  r.action_config := case r.action_kind
    when 'assign' then jsonb_build_object('email', lower(nullif(btrim(coalesce(v_a ->> 'email', '')), '')))
    when 'set_due' then jsonb_build_object('days', public.tk__rule_int(v_a -> 'days'),
                                           'business', coalesce(public.tk__jsonb_bool(v_a -> 'business'), false))
    when 'move_section' then jsonb_build_object('section', nullif(btrim(coalesce(v_a ->> 'section', '')), ''))
    when 'comment' then jsonb_build_object('text', nullif(btrim(coalesce(v_a ->> 'text', '')), ''))
    when 'follow_up' then jsonb_build_object('title', nullif(btrim(coalesce(v_a ->> 'title', '')), ''),
                                             'days', public.tk__rule_int(v_a -> 'days'),
                                             'assignee', coalesce(v_s, 'same'))
    else '{}'::jsonb end;
  r.enabled := false;
  return r;
end $$;

-- Why a rule can't be saved or switched on (null = fine). Mirrors TKRU_validate.
create or replace function public.tk__rule_problem(r public.tk_rules)
returns text language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_p record;
  v_client text;
  v_s text;
  v_n int;
  v_e text;
begin
  if r.name is null or char_length(r.name) > 80 then return 'Give the rule a name (up to 80 characters).'; end if;
  if r.scope_kind = 'project' then
    select p.id, p.client_id, p.sections, p.trashed_at into v_p from public.tk_projects p where p.id = r.project_id;
    if not found then return 'Pick a project.'; end if;
    if v_p.trashed_at is not null then return 'That project is in the trash.'; end if;
    v_client := v_p.client_id;
  elsif r.scope_kind = 'client' then
    if r.client_id is null or not exists (select 1 from public.clients c where c.id = r.client_id) then return 'Pick a client.'; end if;
    v_client := r.client_id;
  else
    return 'Pick a project or a client.';
  end if;
  if r.trigger_kind is null or r.trigger_kind not in ('section_moved', 'done', 'overdue', 'assigned') then return 'Pick when the rule runs.'; end if;
  if r.action_kind is null or r.action_kind not in ('assign', 'set_due', 'move_section', 'comment', 'follow_up') then return 'Pick what the rule does.'; end if;
  if not public.tk__rule_pair_ok(r.trigger_kind, r.action_kind) then return 'That action does not go with that trigger.'; end if;
  if r.trigger_kind = 'section_moved' then
    if r.scope_kind <> 'project' then return 'Section rules need a project.'; end if;
    v_s := r.trigger_config ->> 'section';
    if v_s is null or not (v_s = any (v_p.sections)) then return 'Pick a section of the project.'; end if;
  end if;
  if r.trigger_kind = 'assigned' and (r.trigger_config ->> 'email') is not null
     and not exists (select 1 from public.staff s where lower(s.email) = r.trigger_config ->> 'email' and s.active) then
    return 'Pick an active teammate (or anyone).';
  end if;
  if r.action_kind = 'assign' then
    v_e := r.action_config ->> 'email';
    if v_e is null or not exists (select 1 from public.staff s where lower(s.email) = v_e and s.active) then return 'Pick an active teammate to assign.'; end if;
    if v_client is not null and not public.tk_staff_has_client(v_e, v_client) then return 'That person can''t open this client.'; end if;
  elsif r.action_kind = 'set_due' then
    v_n := public.tk__rule_int(r.action_config -> 'days');
    if v_n is null or v_n < 0 or v_n > 365 then return 'Days must be 0 to 365.'; end if;
  elsif r.action_kind = 'move_section' then
    if r.scope_kind <> 'project' then return 'Moving to a section needs a project.'; end if;
    v_s := r.action_config ->> 'section';
    if v_s is null or not (v_s = any (v_p.sections)) then return 'Pick a section of the project.'; end if;
  elsif r.action_kind = 'comment' then
    v_s := r.action_config ->> 'text';
    if v_s is null or char_length(v_s) > 1000 then return 'Write the comment (up to 1000 characters).'; end if;
  elsif r.action_kind = 'follow_up' then
    v_s := r.action_config ->> 'title';
    if v_s is null or char_length(v_s) > 200 then return 'Write the follow-up title (up to 200 characters).'; end if;
    if r.action_config ? 'days' and r.action_config -> 'days' <> 'null'::jsonb then
      v_n := public.tk__rule_int(r.action_config -> 'days');
      if v_n is null or v_n < 0 or v_n > 365 then return 'Days must be 0 to 365.'; end if;
    end if;
    v_e := coalesce(r.action_config ->> 'assignee', 'same');
    if v_e <> 'same' then
      if not exists (select 1 from public.staff s where lower(s.email) = v_e and s.active) then return 'Pick an active teammate for the follow-up.'; end if;
      if v_client is not null and not public.tk_staff_has_client(v_e, v_client) then return 'That person can''t open this client.'; end if;
    end if;
  end if;
  return null;
end $$;

-- What the rule would do to one task: {outcome: do|noop|skipped, would, from, to, due}.
-- Shared by Dry run and the executor. Reads only.
create or replace function public.tk__rule_plan(r public.tk_rules, t public.staff_reminders, p_day date)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_e text;
  v_d date;
  v_n int;
  v_s text;
  v_secs text[];
begin
  if t.id is null or t.deleted_at is not null then
    return jsonb_build_object('outcome', 'skipped', 'would', 'Task is in the trash.');
  end if;
  if r.action_kind = 'assign' then
    v_e := r.action_config ->> 'email';
    if t.done then return jsonb_build_object('outcome', 'skipped', 'would', 'Task is done.'); end if;
    if t.status = 'ready_for_review' then return jsonb_build_object('outcome', 'skipped', 'would', 'Task is in review.'); end if;
    if not exists (select 1 from public.staff s where lower(s.email) = v_e and s.active) then
      return jsonb_build_object('outcome', 'skipped', 'would', 'That person is no longer active.');
    end if;
    if t.client_id is not null and not public.tk_staff_has_client(v_e, t.client_id) then
      return jsonb_build_object('outcome', 'skipped', 'would', 'That person can''t open this client.');
    end if;
    if lower(coalesce(t.assignee_email, '')) = v_e then
      return jsonb_build_object('outcome', 'noop', 'would', 'Already assigned to ' || public.tk__rule_staff_name(v_e) || '.', 'from', t.assignee_email, 'to', v_e);
    end if;
    return jsonb_build_object('outcome', 'do', 'from', t.assignee_email, 'to', v_e,
      'would', 'Assign ' || public.tk__rule_staff_name(v_e)
               || case when t.assignee_email is null then '' else ' (now ' || public.tk__rule_staff_name(t.assignee_email) || ')' end || '.');
  elsif r.action_kind = 'set_due' then
    if t.done then return jsonb_build_object('outcome', 'skipped', 'would', 'Task is done.'); end if;
    v_n := coalesce(public.tk__rule_int(r.action_config -> 'days'), 0);
    v_d := case when coalesce(public.tk__jsonb_bool(r.action_config -> 'business'), false)
                then public.tk_add_business_days(p_day, v_n) else p_day + v_n end;
    if t.due_date is not distinct from v_d then
      return jsonb_build_object('outcome', 'noop', 'would', 'Already due ' || to_char(v_d, 'Mon FMDD') || '.', 'from', t.due_date, 'to', v_d);
    end if;
    return jsonb_build_object('outcome', 'do', 'from', t.due_date, 'to', v_d,
      'would', 'Set due ' || to_char(v_d, 'Mon FMDD')
               || case when t.due_date is null then '' else ' (now ' || to_char(t.due_date, 'Mon FMDD') || ')' end || '.');
  elsif r.action_kind = 'move_section' then
    v_s := r.action_config ->> 'section';
    select p.sections into v_secs from public.tk_projects p where p.id = t.project_id;
    if t.project_id is null or v_secs is null or not (v_s = any (v_secs)) then
      return jsonb_build_object('outcome', 'skipped', 'would', 'Section no longer in the project.');
    end if;
    if t.section is not distinct from v_s then
      return jsonb_build_object('outcome', 'noop', 'would', 'Already in ' || v_s || '.', 'from', t.section, 'to', v_s);
    end if;
    return jsonb_build_object('outcome', 'do', 'from', t.section, 'to', v_s,
      'would', 'Move to ' || v_s || case when t.section is null then '' else ' (now ' || t.section || ')' end || '.');
  elsif r.action_kind = 'comment' then
    return jsonb_build_object('outcome', 'do', 'to', left(r.action_config ->> 'text', 200),
      'would', 'Post a System comment.');
  elsif r.action_kind = 'follow_up' then
    if t.project_id is not null and exists (select 1 from public.tk_projects p where p.id = t.project_id and p.trashed_at is not null) then
      return jsonb_build_object('outcome', 'skipped', 'would', 'Project is in the trash.');
    end if;
    v_e := coalesce(r.action_config ->> 'assignee', 'same');
    if v_e = 'same' then v_e := lower(coalesce(t.assignee_email, t.staff_email)); end if;
    if not exists (select 1 from public.staff s where lower(s.email) = v_e and s.active) then
      return jsonb_build_object('outcome', 'skipped', 'would', 'The follow-up''s person is no longer active.');
    end if;
    if t.client_id is not null and not public.tk_staff_has_client(v_e, t.client_id) then
      return jsonb_build_object('outcome', 'skipped', 'would', 'The follow-up''s person can''t open this client.');
    end if;
    v_n := public.tk__rule_int(r.action_config -> 'days');
    v_d := case when v_n is null then null else p_day + v_n end;
    return jsonb_build_object('outcome', 'do', 'to', r.action_config ->> 'title', 'assignee', v_e, 'due', v_d,
      'would', 'Add follow-up "' || (r.action_config ->> 'title') || '" for ' || public.tk__rule_staff_name(v_e)
               || case when v_d is null then '' else ', due ' || to_char(v_d, 'Mon FMDD') end || '.');
  end if;
  return jsonb_build_object('outcome', 'skipped', 'would', 'Unknown action.');
end $$;

-- Carry out a planned 'do'. Called only by tk__rule_fire with the bypass flags set.
create or replace function public.tk__rule_do(r public.tk_rules, t public.staff_reminders, p_plan jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_id uuid;
begin
  if r.action_kind = 'assign' then
    update public.staff_reminders set assignee_email = p_plan ->> 'to' where id = t.id;
  elsif r.action_kind = 'set_due' then
    update public.staff_reminders set due_date = (p_plan ->> 'to')::date where id = t.id;
    if t.due_date_original is not null then   -- a rule never moves the on-time baseline
      update public.staff_reminders set due_date_original = t.due_date_original
       where id = t.id and due_date_original is distinct from t.due_date_original;
    end if;
  elsif r.action_kind = 'move_section' then
    update public.staff_reminders set section = p_plan ->> 'to' where id = t.id;
  elsif r.action_kind = 'comment' then
    insert into public.tk_comments (task_id, author_email, body, kind)
    values (t.id, 'system', 'Rule ' || r.name || ': ' || (r.action_config ->> 'text'), 'system')
    returning id into v_id;
    return jsonb_build_object('comment_id', v_id);
  elsif r.action_kind = 'follow_up' then
    insert into public.staff_reminders (staff_email, assignee_email, text, client_id, project_id, kind, visibility,
                                        status, done, priority, source, source_ref, created_by, due_date, due_date_original)
    values (t.staff_email, p_plan ->> 'assignee', p_plan ->> 'to', t.client_id, t.project_id, 'task', t.visibility,
            'todo', false, 'normal', 'rule', r.id::text, coalesce(r.created_by, t.staff_email),
            (p_plan ->> 'due')::date, (p_plan ->> 'due')::date)
    returning id into v_id;
    return jsonb_build_object('created_task_id', v_id);
  end if;
  return '{}'::jsonb;
end $$;

-- One rule on one task for one event. Loop guard, one run per event key, logged.
create or replace function public.tk__rule_fire(r public.tk_rules, p_task uuid, p_event text, p_day date)
returns text language plpgsql security definer set search_path to 'public' as $$
declare
  v_depth int := coalesce(nullif(current_setting('mgb.tk_rule_depth', true), '')::int, 0);
  v_fired text := coalesce(current_setting('mgb.tk_rule_fired', true), '');
  v_t public.staff_reminders;
  v_run bigint;
  v_out text;
  v_detail text;
  v_plan jsonb;
  v_res jsonb := '{}'::jsonb;
  s_depth text; s_fired text; s_gen text; s_actor text; s_rule text;
begin
  select * into v_t from public.staff_reminders where id = p_task;
  if not found then return 'gone'; end if;
  if v_depth >= 2 then
    v_out := 'skipped'; v_detail := 'Loop guard: too many rules in a row.';
  elsif position(',' || r.id::text || ',' in v_fired) > 0 then
    v_out := 'skipped'; v_detail := 'Loop guard: this rule already ran for this change.';
  end if;
  insert into public.tk_rule_runs (rule_id, task_id, event_key, trigger_kind, action_kind, outcome, detail, actor_email, depth)
  values (r.id, p_task, left(p_event, 200), r.trigger_kind, r.action_kind, coalesce(v_out, 'pending'), v_detail,
          coalesce(nullif(public.tk__me(), ''), 'system'), v_depth)
  on conflict (rule_id, task_id, event_key) do nothing
  returning id into v_run;
  if v_run is null then return 'duplicate'; end if;
  if v_out is not null then return v_out; end if;

  v_plan := public.tk__rule_plan(r, v_t, p_day);
  if v_plan ->> 'outcome' <> 'do' then
    update public.tk_rule_runs
       set outcome = v_plan ->> 'outcome', detail = left(v_plan ->> 'would', 500),
           from_value = v_plan ->> 'from', to_value = v_plan ->> 'to'
     where id = v_run;
    return v_plan ->> 'outcome';
  end if;

  s_depth := current_setting('mgb.tk_rule_depth', true);
  s_fired := current_setting('mgb.tk_rule_fired', true);
  s_gen := current_setting('mgb.tk_generate', true);
  s_actor := current_setting('mgb.tk_actor', true);
  s_rule := current_setting('mgb.tk_rule', true);
  perform set_config('mgb.tk_rule_depth', (v_depth + 1)::text, true);
  perform set_config('mgb.tk_rule_fired', case when v_fired = '' then ',' else v_fired end || r.id::text || ',', true);
  perform set_config('mgb.tk_generate', 'on', true);
  perform set_config('mgb.tk_actor', 'system', true);
  perform set_config('mgb.tk_rule', 'on', true);
  begin
    v_res := public.tk__rule_do(r, v_t, v_plan);
    v_out := 'ok';
    v_detail := left(v_plan ->> 'would', 500);
  exception when others then
    v_out := 'error';
    v_detail := left('Error: ' || sqlerrm, 500);
  end;
  perform set_config('mgb.tk_rule_depth', coalesce(s_depth, ''), true);
  perform set_config('mgb.tk_rule_fired', coalesce(s_fired, ''), true);
  perform set_config('mgb.tk_generate', coalesce(s_gen, ''), true);
  perform set_config('mgb.tk_actor', coalesce(s_actor, ''), true);
  perform set_config('mgb.tk_rule', coalesce(s_rule, ''), true);

  update public.tk_rule_runs
     set outcome = v_out, detail = v_detail,
         from_value = v_plan ->> 'from', to_value = v_plan ->> 'to',
         created_task_id = nullif(v_res ->> 'created_task_id', '')::uuid,
         comment_id = nullif(v_res ->> 'comment_id', '')::uuid
   where id = v_run;
  return v_out;
end $$;

-- 3. Executor triggers -----------------------------------------------------------
create or replace function public.tk_staff_reminders_zrules()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_r public.tk_rules;
  v_depth int;
  v_day date;
  v_tx text;
begin
  if not public.tk__rules_live() then return null; end if;   -- firm switch off: nothing else runs
  if new.kind <> 'task' or new.visibility <> 'shared' or new.parent_id is not null or new.deleted_at is not null then
    return null;
  end if;
  v_depth := coalesce(nullif(current_setting('mgb.tk_rule_depth', true), '')::int, 0);
  if v_depth = 0 and public.tk__rules_background() then return null; end if;
  v_day := public.tk__rule_today();
  v_tx := txid_current()::text;

  if tg_op = 'UPDATE' and new.section is distinct from old.section and new.section is not null and new.project_id is not null then
    for v_r in
      select * from public.tk_rules r
       where r.enabled and r.archived_at is null and r.trigger_kind = 'section_moved'
         and r.scope_kind = 'project' and r.project_id = new.project_id
         and r.trigger_config ->> 'section' = new.section
       order by r.created_at
    loop
      begin
        perform public.tk__rule_fire(v_r, new.id, 'section_moved:' || v_tx || ':' || new.section, v_day);
      exception when others then raise warning 'tk rule % failed: %', v_r.id, sqlerrm;
      end;
    end loop;
  end if;

  if tg_op = 'UPDATE' and new.done and not coalesce(old.done, false) then
    for v_r in
      select * from public.tk_rules r
       where r.enabled and r.archived_at is null and r.trigger_kind = 'done'
         and ((r.scope_kind = 'project' and r.project_id = new.project_id)
              or (r.scope_kind = 'client' and r.client_id = new.client_id))
       order by r.created_at
    loop
      begin
        perform public.tk__rule_fire(v_r, new.id, 'done:' || v_tx, v_day);
      exception when others then raise warning 'tk rule % failed: %', v_r.id, sqlerrm;
      end;
    end loop;
  end if;

  if new.assignee_email is not null
     and (tg_op = 'INSERT' or new.assignee_email is distinct from old.assignee_email) then
    for v_r in
      select * from public.tk_rules r
       where r.enabled and r.archived_at is null and r.trigger_kind = 'assigned'
         and ((r.scope_kind = 'project' and r.project_id = new.project_id)
              or (r.scope_kind = 'client' and r.client_id = new.client_id))
         and (r.trigger_config ->> 'email' is null or r.trigger_config ->> 'email' = lower(new.assignee_email))
       order by r.created_at
    loop
      begin
        perform public.tk__rule_fire(v_r, new.id, 'assigned:' || v_tx || ':' || lower(new.assignee_email), v_day);
      exception when others then raise warning 'tk rule % failed: %', v_r.id, sqlerrm;
      end;
    end loop;
  end if;
  return null;
end $$;

drop trigger if exists tk_staff_reminders_zrules on public.staff_reminders;
create trigger tk_staff_reminders_zrules
  after update on public.staff_reminders
  for each row
  when (new.deleted_at is null and (old.section is distinct from new.section
        or (new.done and not coalesce(old.done, false))
        or old.assignee_email is distinct from new.assignee_email))
  execute function public.tk_staff_reminders_zrules();
drop trigger if exists tk_staff_reminders_zrules_ins on public.staff_reminders;
create trigger tk_staff_reminders_zrules_ins
  after insert on public.staff_reminders
  for each row
  when (new.assignee_email is not null and new.deleted_at is null)
  execute function public.tk_staff_reminders_zrules();

-- Overdue: once a day, once per task per due date, only due dates on or after the day the
-- rule was switched on, at most 200 tasks per rule per run.
create or replace function public.tk_rules_overdue_tick()
returns integer language plpgsql security definer set search_path to 'public' as $$
declare
  v_r public.tk_rules;
  v_t record;
  v_n int := 0;
  v_day date := public.tk__rule_today();
begin
  if not public.tk__rules_live() then return 0; end if;
  for v_r in
    select * from public.tk_rules r
     where r.enabled and r.archived_at is null and r.trigger_kind = 'overdue'
     order by r.created_at
  loop
    for v_t in
      select t.id, t.due_date from public.staff_reminders t
       where t.kind = 'task' and t.visibility = 'shared' and t.parent_id is null and t.deleted_at is null
         and not t.done and t.status <> 'ready_for_review'
         and t.due_date < v_day
         and t.due_date >= (coalesce(v_r.enabled_at, now()) at time zone 'America/Chicago')::date
         and ((v_r.scope_kind = 'project' and t.project_id = v_r.project_id)
              or (v_r.scope_kind = 'client' and t.client_id = v_r.client_id))
         and not exists (select 1 from public.tk_rule_runs x
                          where x.rule_id = v_r.id and x.task_id = t.id and x.event_key = 'overdue:' || t.due_date::text)
       order by t.due_date, t.id
       limit 200
    loop
      begin
        perform public.tk__rule_fire(v_r, v_t.id, 'overdue:' || v_t.due_date::text, v_day);
        v_n := v_n + 1;
      exception when others then raise warning 'tk rule % failed: %', v_r.id, sqlerrm;
      end;
    end loop;
  end loop;
  return v_n;
end $$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'tk-rules-overdue-daily') then
    perform cron.unschedule('tk-rules-overdue-daily');
  end if;
  perform cron.schedule('tk-rules-overdue-daily', '50 11 * * *', 'select public.tk_rules_overdue_tick();');
end $$;

-- 4. RPCs (full admins) ---------------------------------------------------------
create or replace function public.tk_rule_save(p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_me text := public.tk__me();
  r public.tk_rules;
  v_old public.tk_rules;
  v_problem text;
begin
  if v_me = '' or not public.is_active_staff_admin() then
    raise exception 'tk_forbidden' using errcode = '42501';
  end if;
  r := public.tk__rule_from_json(coalesce(p, '{}'::jsonb));
  v_problem := public.tk__rule_problem(r);
  if v_problem is not null then
    return jsonb_build_object('ok', false, 'problem', v_problem);
  end if;
  if r.id is null then
    insert into public.tk_rules (name, scope_kind, project_id, client_id, trigger_kind, trigger_config,
                                 action_kind, action_config, enabled, created_by, updated_by)
    values (r.name, r.scope_kind, r.project_id, r.client_id, r.trigger_kind, r.trigger_config,
            r.action_kind, r.action_config, false, v_me, v_me)
    returning * into r;
  else
    select * into v_old from public.tk_rules where id = r.id for update;
    if not found then raise exception 'tk_not_found' using errcode = 'P0002'; end if;
    if v_old.archived_at is not null then
      return jsonb_build_object('ok', false, 'problem', 'Restore the rule before editing it.');
    end if;
    update public.tk_rules
       set name = r.name, scope_kind = r.scope_kind, project_id = r.project_id, client_id = r.client_id,
           trigger_kind = r.trigger_kind, trigger_config = r.trigger_config,
           action_kind = r.action_kind, action_config = r.action_config,
           enabled = case when public.is_internal_owner() then enabled else false end,
           updated_by = v_me, updated_at = now()
     where id = r.id
     returning * into r;
  end if;
  return jsonb_build_object('ok', true, 'rule', to_jsonb(r));
end $$;

create or replace function public.tk_rule_set_enabled(p_id uuid, p_on boolean)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_me text := public.tk__me();
  r public.tk_rules;
  v_problem text;
begin
  if v_me = '' or not public.is_active_staff_admin() then
    raise exception 'tk_forbidden' using errcode = '42501';
  end if;
  select * into r from public.tk_rules where id = p_id for update;
  if not found then raise exception 'tk_not_found' using errcode = 'P0002'; end if;
  if coalesce(p_on, false) then
    if not public.is_internal_owner() then
      return jsonb_build_object('ok', false, 'problem', 'Only the owner can switch a rule on.');
    end if;
    if r.archived_at is not null then
      return jsonb_build_object('ok', false, 'problem', 'Restore the rule first.');
    end if;
    v_problem := public.tk__rule_problem(r);
    if v_problem is not null then return jsonb_build_object('ok', false, 'problem', v_problem); end if;
    update public.tk_rules
       set enabled = true, enabled_at = case when enabled then enabled_at else now() end,
           enabled_by = case when enabled then enabled_by else v_me end, updated_at = now()
     where id = p_id returning * into r;
  else
    update public.tk_rules set enabled = false, updated_by = v_me, updated_at = now()
     where id = p_id returning * into r;
  end if;
  return jsonb_build_object('ok', true, 'rule', to_jsonb(r));
end $$;

create or replace function public.tk_rule_archive(p_id uuid, p_archived boolean default true)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_me text := public.tk__me();
  r public.tk_rules;
begin
  if v_me = '' or not public.is_active_staff_admin() then
    raise exception 'tk_forbidden' using errcode = '42501';
  end if;
  update public.tk_rules
     set archived_at = case when coalesce(p_archived, true) then coalesce(archived_at, now()) end,
         archived_by = case when coalesce(p_archived, true) then coalesce(archived_by, v_me) end,
         enabled = false, updated_by = v_me, updated_at = now()
   where id = p_id returning * into r;
  if r.id is null then raise exception 'tk_not_found' using errcode = 'P0002'; end if;
  return jsonb_build_object('ok', true, 'rule', to_jsonb(r));
end $$;

-- Dry run: what a saved rule (p.id) or an unsaved draft would do now. Writes nothing.
create or replace function public.tk_rule_dry_run(p jsonb)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  r public.tk_rules;
  v_problem text;
  v_day date := public.tk__rule_today();
  v_t public.staff_reminders;
  v_plan jsonb;
  v_matches jsonb := '[]'::jsonb;
  v_total int := 0;
  v_counts jsonb := jsonb_build_object('do', 0, 'noop', 0, 'skipped', 0);
begin
  if public.tk__me() = '' or not public.is_active_staff_admin() then
    raise exception 'tk_forbidden' using errcode = '42501';
  end if;
  if coalesce(p ->> 'id', '') ~* '^[0-9a-f-]{36}$' and not (p ? 'trigger_kind') then
    select * into r from public.tk_rules where id = (p ->> 'id')::uuid;
    if not found then raise exception 'tk_not_found' using errcode = 'P0002'; end if;
  else
    r := public.tk__rule_from_json(coalesce(p, '{}'::jsonb));
    r.name := coalesce(r.name, 'Draft');
    r.id := coalesce(r.id, '00000000-0000-0000-0000-000000000000'::uuid);
  end if;
  v_problem := public.tk__rule_problem(r);
  if v_problem is not null then
    return jsonb_build_object('ok', false, 'problem', v_problem);
  end if;
  for v_t in
    select t.* from public.staff_reminders t
     where t.kind = 'task' and t.visibility = 'shared' and t.parent_id is null and t.deleted_at is null
       and ((r.scope_kind = 'project' and t.project_id = r.project_id)
            or (r.scope_kind = 'client' and t.client_id = r.client_id))
       and case r.trigger_kind
             when 'section_moved' then not t.done and t.section = r.trigger_config ->> 'section'
             when 'done' then t.done and t.completed_at >= now() - interval '14 days'
             when 'assigned' then not t.done and t.assignee_email is not null
                                  and (r.trigger_config ->> 'email' is null or t.assignee_email = r.trigger_config ->> 'email')
             when 'overdue' then not t.done and t.status <> 'ready_for_review' and t.due_date < v_day
             else false end
     order by t.due_date nulls last, t.updated_at desc
     limit 500
  loop
    v_plan := public.tk__rule_plan(r, v_t, v_day);
    v_total := v_total + 1;
    v_counts := jsonb_set(v_counts, array[v_plan ->> 'outcome'], to_jsonb(coalesce((v_counts ->> (v_plan ->> 'outcome'))::int, 0) + 1));
    if jsonb_array_length(v_matches) < 25 then
      v_matches := v_matches || jsonb_build_array(jsonb_build_object(
        'task_id', v_t.id, 'text', left(v_t.text, 200), 'client_id', v_t.client_id,
        'outcome', v_plan ->> 'outcome', 'would', v_plan ->> 'would',
        'from', v_plan ->> 'from', 'to', v_plan ->> 'to'));
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'problem', null, 'live', public.tk__rules_live(),
    'enabled', coalesce(r.enabled, false), 'total', v_total, 'capped', v_total >= 500,
    'counts', v_counts, 'matches', v_matches);
end $$;

create or replace function public.tk_rule_recent_runs(p_rule uuid default null, p_limit integer default 50)
returns table (id bigint, rule_id uuid, rule_name text, task_id uuid, task_text text, client_id text,
               trigger_kind text, action_kind text, outcome text, detail text, from_value text, to_value text,
               created_task_id uuid, comment_id uuid, depth smallint, created_at timestamptz)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if public.tk__me() = '' or not public.is_active_staff_admin() then
    raise exception 'tk_forbidden' using errcode = '42501';
  end if;
  return query
    select x.id, x.rule_id, ru.name, x.task_id,
           case when public.tk_can_read_task(x.task_id) then left(t.text, 200) end,
           case when public.tk_can_read_task(x.task_id) then t.client_id end,
           x.trigger_kind, x.action_kind, x.outcome, x.detail,
           case when public.tk_can_read_task(x.task_id) then x.from_value end,
           case when public.tk_can_read_task(x.task_id) then x.to_value end,
           x.created_task_id, x.comment_id, x.depth, x.created_at
      from public.tk_rule_runs x
      join public.tk_rules ru on ru.id = x.rule_id
      left join public.staff_reminders t on t.id = x.task_id
     where p_rule is null or x.rule_id = p_rule
     order by x.created_at desc, x.id desc
     limit least(greatest(coalesce(p_limit, 50), 1), 200);
end $$;

-- 5. Widen tk_comments_before_write: a System comment from a rule ------------------
do $$
declare
  v_def text := pg_get_functiondef('public.tk_comments_before_write()'::regprocedure);
  v_anchor text := '    -- tk rhythm s4: a system note from the month rhythm daily job';
  v_branch text := '    -- slate plus rules: a System comment written by a rule (tk__rule_do)
    if new.kind = ''system'' and coalesce(current_setting(''mgb.tk_rule'', true), '''') = ''on'' then
      new.author_email := ''system'';
      new.mentions := ''{}'';
      new.created_at := now();
      new.edited_at := null; new.edited_by := null; new.deleted_at := null; new.deleted_by := null;
      return new;
    end if;
';
begin
  if position('slate plus rules: a System comment' in v_def) > 0 then
    return;   -- already widened
  end if;
  if (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor) <> 1 then
    raise exception 'tk_comments_before_write anchor not found exactly once';
  end if;
  execute replace(v_def, v_anchor, v_branch || v_anchor);
end $$;

-- 6. Grants ------------------------------------------------------------------------
revoke all on function public.tk__rule_pair_ok(text, text) from public, anon, authenticated;
revoke all on function public.tk__rules_live() from public, anon, authenticated;
revoke all on function public.tk__rule_today() from public, anon, authenticated;
revoke all on function public.tk__rules_background() from public, anon, authenticated;
revoke all on function public.tk__rule_int(jsonb) from public, anon, authenticated;
revoke all on function public.tk__rule_staff_name(text) from public, anon, authenticated;
revoke all on function public.tk__rule_from_json(jsonb) from public, anon, authenticated;
revoke all on function public.tk__rule_problem(public.tk_rules) from public, anon, authenticated;
revoke all on function public.tk__rule_plan(public.tk_rules, public.staff_reminders, date) from public, anon, authenticated;
revoke all on function public.tk__rule_do(public.tk_rules, public.staff_reminders, jsonb) from public, anon, authenticated;
revoke all on function public.tk__rule_fire(public.tk_rules, uuid, text, date) from public, anon, authenticated;
revoke all on function public.tk_staff_reminders_zrules() from public, anon, authenticated;
revoke all on function public.tk_rules_overdue_tick() from public, anon, authenticated;
revoke all on function public.tk_rule_save(jsonb) from public, anon;
revoke all on function public.tk_rule_set_enabled(uuid, boolean) from public, anon;
revoke all on function public.tk_rule_archive(uuid, boolean) from public, anon;
revoke all on function public.tk_rule_dry_run(jsonb) from public, anon;
revoke all on function public.tk_rule_recent_runs(uuid, integer) from public, anon;
grant execute on function public.tk_rule_save(jsonb) to authenticated;
grant execute on function public.tk_rule_set_enabled(uuid, boolean) to authenticated;
grant execute on function public.tk_rule_archive(uuid, boolean) to authenticated;
grant execute on function public.tk_rule_dry_run(jsonb) to authenticated;
grant execute on function public.tk_rule_recent_runs(uuid, integer) to authenticated;
