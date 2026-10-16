-- =====================================================================
-- Tasks Phase 2, slice S3: review loop and on-time metric.
-- Spec: docs/tasks-phase2-spec.md C3 + B (tk_settings)
--       (+ critique M3, M4, M5, M10, M14, R26; owner Q1, Q4, decision 8).
--
-- Safe to re-run, one transaction (apply_migration or begin/commit).
-- Nothing is dropped. Whole functions below are "create or replace" from
-- their live bodies (tasks-module-v1.sql et al.); the lines this slice
-- adds carry "-- tk p2 s3". Re-run this file after any older file that
-- defines the same function.
--
-- What changes:
--   1. staff_reminders gets reviewer_email, send_back_count, ready_at
--      (first entry), submitted_by / submitted_at (latest entry),
--      approved_by / approved_at, due_date_original and
--      waiting_before_due_minutes. client_profile gets reviewer_email
--      (an active admin, checked by a trigger).
--   2. Only tk_approve moves a task from ready_for_review to done
--      (transaction-local flag mgb.tk_approve), for admins and no-JWT
--      callers too. Nobody approves or sends back work they submitted or
--      are assigned (critique M3), and the assignee is locked while the
--      task is in review. Done diverts to review for admins too.
--   3. Server-owned review columns raise tk_server_owned instead of
--      reverting silently (R26). due_date_original follows due_date only
--      for admins (or the first time a due date is set).
--   4. Activity: exactly one row per review event (M4). Approve logs
--      review_approved (meta first_pass), Send back logs review_sent_back,
--      Withdraw logs review_withdrawn. tk_set_status no longer writes a
--      send_back comment.
--   5. waiting_client is NOT locked here (critique M14: that lock ships with
--      tk_ask_client in S5). Leaving it now also credits the wait to
--      waiting_before_due_minutes when the wait started before the
--      effective deadline (decision 8).
--   6. tk_review_stats and tk_on_time_stats (M5: open late tasks and tasks
--      deleted after their deadline count; only template tasks or tasks
--      someone else made count; submitted_on_time shows reviewer delay).
--   7. Outbox: staff_task_review_ready (task enters review; a month enters
--      'review'), staff_task_sent_back, staff_task_mention. Every enqueue
--      goes through tk__enqueue, which skips a kind the CHECK does not
--      allow yet (tasks-p2-3b-review-email-kinds.sql widens it after the
--      notification-emails deploy).
--   8. tk_settings (+ audit) with owner-only keys (M10), on_time_since.
--   9. tk_tasks view gains the review columns.
--  10. client_health: a month in 'review' (Ready for sign-off) is not
--      unfinished or late (S2 follow-up).
--
-- Reviewer (owner Q1, Q4): client_profile.reviewer_email, else the client's
-- account manager, if that person is an active admin. An admin's own task
-- with neither falls back to the Team Reviews default reviewer
-- (review_settings.default_reviewer_id). Otherwise null = any admin.
-- The submitter and the assignee are never the reviewer.
--
-- The live pg_default_acl hands anon and authenticated every privilege on
-- new tables and EXECUTE on new functions, so each new object starts from
-- "revoke all" and then gets exactly what it needs.
-- =====================================================================

-- 0. Helper: patch a live function body in place (same as S2) -----------
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

-- 1. Columns and indexes -------------------------------------------------
alter table public.staff_reminders add column if not exists reviewer_email text;
alter table public.staff_reminders add column if not exists send_back_count int not null default 0;
alter table public.staff_reminders add column if not exists ready_at timestamptz;
alter table public.staff_reminders add column if not exists submitted_by text;
alter table public.staff_reminders add column if not exists submitted_at timestamptz;
alter table public.staff_reminders add column if not exists approved_by text;
alter table public.staff_reminders add column if not exists approved_at timestamptz;
alter table public.staff_reminders add column if not exists due_date_original date;
alter table public.staff_reminders add column if not exists waiting_before_due_minutes int not null default 0;

alter table public.staff_reminders drop constraint if exists staff_reminders_send_back_count_check;
alter table public.staff_reminders add constraint staff_reminders_send_back_count_check check (send_back_count >= 0);
alter table public.staff_reminders drop constraint if exists staff_reminders_wait_before_due_check;
alter table public.staff_reminders add constraint staff_reminders_wait_before_due_check check (waiting_before_due_minutes >= 0);

create index if not exists staff_reminders_reviewer_status_idx
  on public.staff_reminders (reviewer_email, status) where deleted_at is null;
create index if not exists staff_reminders_in_review_idx
  on public.staff_reminders (status, ready_at) where status = 'ready_for_review' and deleted_at is null;

alter table public.client_profile add column if not exists reviewer_email text;

-- The app reads tasks through tk_tasks; the review columns go on the end
-- (create or replace view can only append). Same columns as tasks-module-v1.sql.
create or replace view public.tk_tasks with (security_invoker = true) as
select id, staff_email, text, due_date, done, created_at, client_id, priority, completed_at, kind,
       due_at, remind_at, recurrence, assignee_email, created_by, visibility, source, source_ref,
       status, status_changed_at, status_changed_by, status_before_wait, waiting_since, waiting_minutes,
       description, start_on, section, sort_key, parent_id, sop_section, review_required, series_id,
       updated_at, deleted_at, deleted_by, project_id, search_tsv,
       reviewer_email, send_back_count, ready_at, submitted_by, submitted_at,   -- tk p2 s3
       approved_by, approved_at, due_date_original, waiting_before_due_minutes
  from public.staff_reminders
 where deleted_at is null;
revoke all on public.tk_tasks from public, anon, authenticated;
grant select on public.tk_tasks to authenticated;

-- 2. tk_settings (+ audit), owner-only keys (critique M10) ---------------
create table if not exists public.tk_settings (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  value jsonb not null,
  updated_by text,
  updated_at timestamptz not null default now()
);
alter table public.tk_settings enable row level security;
revoke all on table public.tk_settings from public, anon, authenticated;
grant select, insert, update on table public.tk_settings to authenticated;
drop policy if exists "tk settings read" on public.tk_settings;
create policy "tk settings read" on public.tk_settings
  for select to authenticated using (public.is_active_staff());
drop policy if exists "tk settings admin insert" on public.tk_settings;
create policy "tk settings admin insert" on public.tk_settings
  for insert to authenticated with check (public.is_active_staff_admin());
drop policy if exists "tk settings admin update" on public.tk_settings;
create policy "tk settings admin update" on public.tk_settings
  for update to authenticated using (public.is_active_staff_admin()) with check (public.is_active_staff_admin());
-- no delete policy: settings are never deleted

create table if not exists public.tk_settings_audit (
  id bigint generated always as identity primary key,
  key text not null,
  old_value jsonb,
  new_value jsonb,
  changed_by text,
  changed_at timestamptz not null default now()
);
alter table public.tk_settings_audit enable row level security;
revoke all on table public.tk_settings_audit from public, anon, authenticated;
grant select on table public.tk_settings_audit to authenticated;
drop policy if exists "tk settings audit admin read" on public.tk_settings_audit;
create policy "tk settings audit admin read" on public.tk_settings_audit
  for select to authenticated using (public.is_active_staff_admin());

-- Keys only the owner (internal_access.is_owner) may change. A no-JWT
-- caller (SQL editor, MCP) needs mgb.tk_owner_override = 'on', which is
-- audited like any other change.
create or replace function public.tk__owner_only_key(p_key text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_key in ('client_request_enabled', 'client_request_pilot', 'standard_set_live');
$$;

create or replace function public.tk_settings_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if tg_op = 'UPDATE' then
    new.key := old.key;
  end if;
  if public.tk__owner_only_key(new.key)
     and (tg_op = 'INSERT' or new.value is distinct from old.value)
     and not public.is_internal_owner()
     and coalesce(current_setting('mgb.tk_owner_override', true), '') <> 'on' then
    raise exception 'tk_owner_only' using errcode = '42501';
  end if;
  new.updated_by := coalesce(nullif(v_me, ''), 'system');
  new.updated_at := now();
  return new;
end $$;

create or replace function public.tk_settings_after_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.value is not distinct from old.value then
    return null;
  end if;
  insert into tk_settings_audit (key, old_value, new_value, changed_by)
  values (new.key, case when tg_op = 'UPDATE' then old.value end, new.value, new.updated_by);
  return null;
end $$;

drop trigger if exists tk_settings_before_write on public.tk_settings;
create trigger tk_settings_before_write before insert or update on public.tk_settings
  for each row execute function public.tk_settings_before_write();
drop trigger if exists tk_settings_after_write on public.tk_settings;
create trigger tk_settings_after_write after insert or update on public.tk_settings
  for each row execute function public.tk_settings_after_write();

-- The live client-request switch (S5 adds client_email_settings.
-- client_request_enabled). This guard is attached once that column exists,
-- so re-running this file after S5 protects it (critique M10).
create or replace function public.tk_guard_client_request_switch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  -- An inserted row compares against "off", so creating the settings row with
  -- the switch off (the column default) is not an owner-only change.
  v_old jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) -> 'client_request_enabled'
                      else 'false'::jsonb end;
  v_new jsonb := coalesce(to_jsonb(new) -> 'client_request_enabled', 'false'::jsonb);
begin
  if v_new is not distinct from v_old then
    return new;
  end if;
  if not public.is_internal_owner()
     and coalesce(current_setting('mgb.tk_owner_override', true), '') <> 'on' then
    raise exception 'tk_owner_only' using errcode = '42501';
  end if;
  insert into tk_settings_audit (key, old_value, new_value, changed_by)
  values ('client_email_settings.client_request_enabled', v_old, v_new,
          coalesce(nullif(lower(coalesce(auth.jwt() ->> 'email', '')), ''), 'system'));
  return new;
end $$;

do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'client_email_settings'
                and column_name = 'client_request_enabled') then
    execute 'drop trigger if exists tk_guard_client_request_switch on public.client_email_settings';
    execute 'create trigger tk_guard_client_request_switch before insert or update on public.client_email_settings
               for each row execute function public.tk_guard_client_request_switch()';
  end if;
end $$;

-- on_time_since: the S3 ship date; the first run wins.
insert into public.tk_settings (key, value)
values ('on_time_since', to_jsonb((now() at time zone 'America/Chicago')::date::text))
on conflict (key) do nothing;

-- 3. Reviewer resolution -------------------------------------------------
create or replace function public.tk__is_active_admin(p_email text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from staff s
                  where lower(s.email) = lower(btrim(coalesce(p_email, '')))
                    and s.active and s.role = 'admin');
$$;

-- Internal: no JWT check (callers are definer triggers and RPCs).
-- p_exclude: the assignee and submitter, never their own reviewer. With an
-- admin among them, the Team Reviews default reviewer is the last resort
-- (owner Q4: a second admin reviews an admin's work).
create or replace function public.tk__default_reviewer(p_client text, p_exclude text[])
returns text
language sql
stable
security definer
set search_path = public
as $$
  select x.e
    from (
      select 1 as o, lower(cp.reviewer_email) as e from client_profile cp where p_client is not null and cp.client_id = p_client
      union all
      select 2, lower(c.account_manager_email) from clients c where p_client is not null and c.id = p_client
      union all
      select 3, lower(s.email) from review_settings rs join staff s on s.id = rs.default_reviewer_id
       where exists (select 1 from unnest(coalesce(p_exclude, '{}'::text[])) u(x) where public.tk__is_active_admin(u.x))
    ) x
   where x.e is not null
     and public.tk__is_active_admin(x.e)
     and not (x.e = any (coalesce(array(select lower(u) from unnest(p_exclude) u where u is not null), '{}'::text[])))
   order by x.o
   limit 1;
$$;

create or replace function public.client_profile_reviewer_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.reviewer_email := lower(nullif(btrim(new.reviewer_email), ''));
  if tg_op = 'UPDATE' and new.reviewer_email is not distinct from old.reviewer_email then
    return new;
  end if;
  if tg_op = 'INSERT' and new.reviewer_email is null then
    return new;
  end if;
  if coalesce(auth.jwt() ->> 'email', '') <> '' and not public.is_active_staff_admin() then
    raise exception 'tk_forbidden' using errcode = '42501';
  end if;
  if new.reviewer_email is not null and not public.tk__is_active_admin(new.reviewer_email) then
    raise exception 'tk_bad_reviewer' using errcode = '22023';
  end if;
  return new;
end $$;

drop trigger if exists client_profile_reviewer_guard on public.client_profile;
create trigger client_profile_reviewer_guard before insert or update on public.client_profile
  for each row execute function public.client_profile_reviewer_guard();

-- tk_client_people gains the 'reviewer' role (client-level reviewer only).
create or replace function public.tk_client_people(p_client text)
returns table(role text, email text, name text)
language sql
stable
security definer
set search_path = public
as $function$
  select x.r, s.email, s.name
    from (values
      (1, 'bookkeeper', (select c.assigned_bookkeeper_email from clients c where c.id = p_client)),
      (2, 'backup', (select cp.backup_bookkeeper_email from client_profile cp where cp.client_id = p_client)),
      (3, 'account_manager', (select c.account_manager_email from clients c where c.id = p_client)),
      (4, 'reviewer', public.tk__default_reviewer(p_client, null))   -- tk p2 s3
    ) x(ord, r, em)
    join staff s on lower(s.email) = lower(x.em) and s.active
   where x.em is not null
     and public.is_active_staff()
     and public.can_access_client(p_client)
   order by x.ord;
$function$;

-- 4. Outbox helper -------------------------------------------------------
-- Skips (never fails the caller) when the kind is not in the CHECK yet or
-- the payload is too large; tasks-p2-3b widens the CHECK after deploy.
create or replace function public.tk__enqueue(p_kind text, p_to text, p_client text, p_ref text, p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_to is null or btrim(p_to) = '' then
    return;
  end if;
  begin
    insert into notification_outbox (kind, recipient_email, client_id, ref_id, payload)
    values (p_kind, lower(btrim(p_to)), p_client, p_ref, coalesce(p_payload, '{}'::jsonb));
  exception when check_violation then
    null;
  end;
end $$;

-- 5. staff_reminders BEFORE trigger (live body + S3 blocks) ---------------
create or replace function public.staff_reminders_before_write()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_caller text := coalesce(auth.jwt() ->> 'email', '');
  v_me text; v_bypass boolean; v_admin boolean; v_roll boolean; v_p record;   -- tk v1
  v_flag text := coalesce(current_setting('mgb.tk_approve', true), '');   -- tk p2 s3
  v_migrate boolean := coalesce(current_setting('mgb.tk_migrate', true), '') = 'on';   -- tk p2 s3
  v_deadline timestamptz;   -- tk p2 s3
begin
  if tg_op = 'INSERT' then
    new.assignee_email := coalesce(new.assignee_email, new.staff_email);
    new.created_by := coalesce(new.created_by, nullif(v_caller, ''), new.staff_email);

    if new.source = 'manual'
       and v_caller is distinct from new.staff_email
       and new.text like 'New access request from %' then
      new.source := 'access_request';
      new.source_ref := coalesce(new.source_ref, new.client_id);
    end if;

    if new.due_at is null and new.due_date is not null then
      new.due_at := new.due_date::timestamp at time zone 'UTC';
    elsif new.due_date is null and new.due_at is not null then
      new.due_date := (new.due_at at time zone 'UTC')::date;
    end if;
    -- tk v1: the live early "return new;" stood here; it is removed so the tk v1 blocks also run on INSERT
  end if;

  if tg_op = 'UPDATE' then   -- tk v1 (the live revert and UPDATE due sync were UPDATE-only by position)
  if v_caller is distinct from old.staff_email
     and coalesce(current_setting('mgb.offboarding', true), '') <> 'on' then
    new.staff_email := old.staff_email;
    new.created_by := old.created_by;
    new.client_id := old.client_id;
    new.visibility := old.visibility;
  end if;

  if new.due_date is distinct from old.due_date
     and new.due_at is not distinct from old.due_at then
    new.due_at := case when new.due_date is null then null
                       else new.due_date::timestamp at time zone 'UTC' end;
  elsif new.due_at is distinct from old.due_at
     and new.due_date is not distinct from old.due_date then
    new.due_date := case when new.due_at is null then null
                         else (new.due_at at time zone 'UTC')::date end;
  end if;
  end if;   -- tk v1 (closes if tg_op = 'UPDATE')

  -- tk v1 --------------------------------------------------------------
  v_me      := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_bypass  := coalesce(current_setting('mgb.offboarding', true),'') = 'on'
            or coalesce(current_setting('mgb.tk_migrate', true),'') = 'on';
            -- mgb.tk_rpc is NOT a bypass here; it only matters to the tk_comments and tk_attachments triggers
  v_admin   := v_me <> '' and public.is_active_staff_admin();
  v_roll    := tg_op = 'INSERT' and coalesce(current_setting('mgb.tk_rollforward', true),'') = 'on';
            -- set by complete_staff_item around its next-occurrence insert only (D10)

  -- 1. emails and created_by (both operations)
  new.assignee_email := lower(nullif(btrim(new.assignee_email), ''));
  new.section := nullif(btrim(new.section), '');   -- '' clears the section instead of failing staff_reminders_section_len
  if tg_op = 'INSERT' then
    new.assignee_email := coalesce(new.assignee_email, lower(new.staff_email));
    if v_me <> '' and v_me = lower(new.staff_email) and public.is_active_staff() then
      new.created_by := v_me;              -- otherwise the live coalesce stands (template cron, access requests, roll-forward)
    end if;
  end if;

  -- 2. non-owner pins (UPDATE; next to the live revert; admins may reassign and move)
  if tg_op = 'UPDATE' and v_me <> '' and v_me <> lower(old.staff_email) and not v_bypass and not v_admin then
    new.assignee_email := old.assignee_email;
    new.project_id     := old.project_id;
    new.parent_id      := old.parent_id;
  end if;
  if tg_op = 'UPDATE' and not v_bypass then
    new.created_by := old.created_by;      -- server-owned, owners included
  end if;
  if tg_op = 'UPDATE' and old.review_required and not new.review_required and not (v_admin or v_bypass) then
    new.review_required := true;           -- only admins switch the review gate off
  end if;

  -- 2b. tk p2 s3: review columns. Server-owned ones raise instead of
  -- reverting (R26); the stamps below are this trigger's own writes.
  if tg_op = 'UPDATE' and v_flag = '' and not v_bypass then   -- tk p2 s3
    if new.send_back_count is distinct from old.send_back_count
       or new.ready_at is distinct from old.ready_at
       or new.submitted_by is distinct from old.submitted_by
       or new.submitted_at is distinct from old.submitted_at
       or new.approved_by is distinct from old.approved_by
       or new.approved_at is distinct from old.approved_at
       or new.waiting_before_due_minutes is distinct from old.waiting_before_due_minutes then
      raise exception 'tk_server_owned' using errcode = '42501';
    end if;
    if new.reviewer_email is distinct from old.reviewer_email and not v_admin then
      raise exception 'tk_server_owned' using errcode = '42501';   -- admins use tk_set_reviewer
    end if;
    if new.due_date_original is distinct from old.due_date_original and not v_admin then
      raise exception 'tk_server_owned' using errcode = '42501';
    end if;
  end if;
  if tg_op = 'INSERT' and not v_bypass then   -- tk p2 s3
    new.send_back_count := 0; new.ready_at := null; new.submitted_by := null; new.submitted_at := null;
    new.approved_by := null; new.approved_at := null; new.waiting_before_due_minutes := 0;
    new.due_date_original := new.due_date;
    if not v_admin then new.reviewer_email := null; end if;
  end if;
  if tg_op = 'UPDATE' and new.due_date is distinct from old.due_date
     and new.due_date_original is not distinct from old.due_date_original
     and (v_admin or v_bypass or old.due_date_original is null) then   -- tk p2 s3
    new.due_date_original := new.due_date;   -- only admins move the on-time baseline (first value excepted)
  end if;
  new.reviewer_email := lower(nullif(btrim(new.reviewer_email), ''));   -- tk p2 s3
  -- M3: no reassigning while in review (Withdraw first), except offboarding
  if tg_op = 'UPDATE' and old.status = 'ready_for_review'
     and new.assignee_email is distinct from old.assignee_email
     and v_flag = '' and not v_bypass then   -- tk p2 s3
    raise exception 'tk_in_review' using errcode = '22023';
  end if;

  -- 3. project sync (both operations; tk_project_info is definer, so a non-member's lookup still works)
  if new.project_id is not null then
    select * into v_p from public.tk_project_info(new.project_id);
    if not v_p.found then raise exception 'tk_project_missing' using errcode = '23503'; end if;
    if (tg_op = 'INSERT' or new.project_id is distinct from old.project_id)
       and v_me <> '' and not v_bypass and not v_admin and not v_roll then
      if v_p.client_id is null and not public.tk_is_project_member(new.project_id) then
        raise exception 'tk_not_project_member' using errcode = '42501';
      end if;
      if v_p.client_id is not null and not public.can_access_client(v_p.client_id) then
        raise exception 'tk_forbidden' using errcode = '42501';   -- onboarding project of a client the caller cannot reach
      end if;
      if v_p.archived then
        raise exception 'tk_project_archived' using errcode = '22023';
      end if;
    end if;
    if v_p.client_id is not null then new.client_id := v_p.client_id; end if;
  end if;

  -- 3b. fix 1: direct writes from the API (role anon or authenticated, not
  -- a definer RPC, cron or bypass) need active staff to insert, and need
  -- client access to put a task on a client or move it to another client.
  -- Definer RPCs (access requests, roll-forward) run as their owner, so
  -- current_user is not anon or authenticated there and they pass.
  if current_user in ('anon', 'authenticated') and not v_bypass and not v_roll then
    if tg_op = 'INSERT' and not public.is_active_staff() then
      raise exception 'tk_forbidden' using errcode = '42501';
    end if;
    if new.client_id is not null and not v_admin
       and (tg_op = 'INSERT' or new.client_id is distinct from old.client_id)
       and not public.can_access_client(new.client_id) then
      raise exception 'tk_forbidden' using errcode = '42501';
    end if;
  end if;

  -- 4. status <-> done (both operations)
  if tg_op = 'INSERT' then
    if new.done then new.status := 'done'; end if;
  elsif new.status is not distinct from old.status and new.done is distinct from old.done then
    new.status := case when new.done then 'done' when old.status = 'done' then 'todo' else old.status end;
  end if;
  if new.status = 'done' and (tg_op = 'INSERT' or old.status not in ('done', 'ready_for_review'))
     and new.review_required and not v_bypass then   -- tk p2 s3: admins and no-JWT callers divert too
    new.status := 'ready_for_review';      -- review gate: legacy done=true writes divert too
  end if;
  if tg_op = 'UPDATE' and old.status = 'ready_for_review' and new.status = 'done'
     and v_flag <> 'approve' and not v_migrate then   -- tk p2 s3 (M3): only tk_approve
    raise exception 'tk_needs_approval' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.status is distinct from old.status
     and old.status = 'done' and new.status in ('waiting_client','ready_for_review') then
    raise exception 'tk_bad_transition' using errcode = '22023';
  end if;
  if tg_op = 'UPDATE' and old.status = 'done' and new.status <> 'done' and old.approved_at is not null
     and v_me <> '' and not v_admin and not v_bypass then   -- tk p2 s3: approved work reopens by an admin
    raise exception 'tk_forbidden' using errcode = '42501';
  end if;
  new.done := (new.status = 'done');       -- ready_for_review never syncs done=true
  if new.done and (tg_op = 'INSERT' or not old.done) then
    new.completed_at := case when v_bypass then coalesce(new.completed_at, now()) else now() end;   -- tk p2 s3: no back-dating
  elsif new.done then new.completed_at := old.completed_at;   -- UPDATE where both stay done keeps the original time
  else new.completed_at := null; end if;
  if tg_op = 'UPDATE' and old.status = 'done' and new.status <> 'done' then   -- tk p2 s3
    new.approved_by := null; new.approved_at := null;
  end if;
  -- tk p2 s3: entering review stamps the round and the reviewer
  if new.status = 'ready_for_review' and (tg_op = 'INSERT' or old.status <> 'ready_for_review') then
    new.review_required := true;
    new.ready_at := coalesce(case when tg_op = 'UPDATE' then old.ready_at end, now());
    new.submitted_at := now();
    new.submitted_by := coalesce(nullif(v_me, ''), new.assignee_email, lower(new.staff_email));
    if new.reviewer_email is null or new.reviewer_email in (new.assignee_email, new.submitted_by)
       or not public.tk__is_active_admin(new.reviewer_email) then   -- a reviewer who left is re-resolved
      new.reviewer_email := public.tk__default_reviewer(new.client_id, array[new.assignee_email, new.submitted_by]);
    end if;
  end if;
  if new.reviewer_email is not null
     and (tg_op = 'INSERT' or new.reviewer_email is distinct from old.reviewer_email)
     and not public.tk__is_active_admin(new.reviewer_email) then   -- tk p2 s3
    raise exception 'tk_bad_reviewer' using errcode = '22023';
  end if;

  -- 5. waiting bookkeeping, status stamps, server-owned columns (both operations)
  if tg_op = 'UPDATE' then
    new.waiting_minutes := old.waiting_minutes; new.waiting_since := old.waiting_since;
    new.status_before_wait := old.status_before_wait; new.series_id := coalesce(old.series_id, new.series_id);
    new.status_changed_at := old.status_changed_at; new.status_changed_by := old.status_changed_by;
    new.deleted_by := old.deleted_by; new.created_at := old.created_at;
  else
    new.waiting_minutes := 0; new.waiting_since := null; new.status_before_wait := null; new.deleted_by := null;
  end if;
  if new.status = 'waiting_client' and (tg_op = 'INSERT' or old.status <> 'waiting_client') then
    new.status_before_wait := case when tg_op = 'INSERT' then 'todo' else old.status end;
    new.waiting_since := now();
  elsif tg_op = 'UPDATE' and old.status = 'waiting_client' and new.status <> 'waiting_client' then
    new.waiting_minutes := coalesce(old.waiting_minutes,0)
      + greatest(0, floor(extract(epoch from now() - coalesce(old.waiting_since, now())) / 60))::int;
    -- tk p2 s3 (decision 8): a wait that started before the effective deadline moves the deadline by all of it
    v_deadline := case when new.due_date_original is not null
                       then ((new.due_date_original + 1)::timestamp at time zone 'America/Chicago')
                            + make_interval(mins => coalesce(old.waiting_before_due_minutes, 0)) end;
    if v_deadline is not null and old.waiting_since is not null and old.waiting_since < v_deadline then
      new.waiting_before_due_minutes := coalesce(old.waiting_before_due_minutes, 0)
        + greatest(0, floor(extract(epoch from now() - old.waiting_since) / 60))::int;
    end if;
    new.waiting_since := null;
  end if;
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    new.status_changed_at := now(); new.status_changed_by := nullif(v_me, '');
  end if;
  if tg_op = 'UPDATE' then new.updated_at := now(); end if;
  if tg_op = 'UPDATE' and new.deleted_at is not null and old.deleted_at is null then new.deleted_by := nullif(v_me,'');
  elsif tg_op = 'UPDATE' and new.deleted_at is null then new.deleted_by := null; end if;
  -- tk v1 blocks end ------------------------------------------------

  return new;
end;
$function$;

-- 6. Activity: one row per review event (critique M4) --------------------
alter table public.tk_activity drop constraint if exists tk_activity_kind_check;
alter table public.tk_activity add constraint tk_activity_kind_check check (kind in (
  'created','status','assignee','due','priority','section','comment',
  'review_approved','review_sent_back','client_asked','client_answered',
  'reassigned_ooo','imported','deleted','restored','moved','period_signed_off',
  'review_withdrawn','reviewer'));

create or replace function public.tk_staff_reminders_activity()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_actor text := coalesce(nullif(current_setting('mgb.tk_actor', true), ''),   -- tk p2 s5 (B2)
                            nullif(lower(coalesce(auth.jwt() ->> 'email', '')), ''), 'system');
  v_flag text := coalesce(current_setting('mgb.tk_approve', true), '');   -- tk p2 s3
begin
  if coalesce(current_setting('mgb.tk_migrate', true), '') = 'on' then
    return null;
  end if;
  if tg_op = 'INSERT' then
    insert into tk_activity (task_id, actor_email, kind, to_value, meta)
    values (new.id, v_actor, 'created', new.status, jsonb_build_object('source', new.source));
    return null;
  end if;
  if new.status is distinct from old.status then
    -- tk p2 s3: the review kinds come from the flag tk_approve / tk_send_back set
    insert into tk_activity (task_id, actor_email, kind, from_value, to_value, meta)
    values (new.id, v_actor,
            case when old.status = 'ready_for_review' and new.status = 'done' then 'review_approved'
                 when old.status = 'ready_for_review' and v_flag = 'send_back' then 'review_sent_back'
                 when old.status = 'ready_for_review' then 'review_withdrawn'
                 else 'status' end,
            old.status, new.status,
            case when old.status = 'ready_for_review' and new.status = 'done'
                   then jsonb_build_object('first_pass', new.send_back_count = 0, 'send_backs', new.send_back_count)
                 when old.status = 'ready_for_review' and v_flag = 'send_back'
                   then jsonb_build_object('send_backs', new.send_back_count)
                 when new.status = 'ready_for_review'
                   then jsonb_build_object('reviewer', new.reviewer_email)
                 else '{}'::jsonb end);   -- tk_activity.meta is not null
  end if;
  if new.reviewer_email is distinct from old.reviewer_email and new.status is not distinct from old.status then   -- tk p2 s3
    insert into tk_activity (task_id, actor_email, kind, from_value, to_value)
    values (new.id, v_actor, 'reviewer', old.reviewer_email, new.reviewer_email);
  end if;
  if new.assignee_email is distinct from old.assignee_email then
    insert into tk_activity (task_id, actor_email, kind, from_value, to_value)
    values (new.id, v_actor, 'assignee', old.assignee_email, new.assignee_email);
  end if;
  if new.due_date is distinct from old.due_date then
    insert into tk_activity (task_id, actor_email, kind, from_value, to_value)
    values (new.id, v_actor, 'due', old.due_date::text, new.due_date::text);
  end if;
  if new.priority is distinct from old.priority then
    insert into tk_activity (task_id, actor_email, kind, from_value, to_value)
    values (new.id, v_actor, 'priority', old.priority, new.priority);
  end if;
  if new.section is distinct from old.section then
    insert into tk_activity (task_id, actor_email, kind, from_value, to_value)
    values (new.id, v_actor, 'section', old.section, new.section);
  end if;
  if new.client_id is distinct from old.client_id or new.project_id is distinct from old.project_id then
    insert into tk_activity (task_id, actor_email, kind, meta)
    values (new.id, v_actor, 'moved', jsonb_build_object(
      'from_client', old.client_id, 'to_client', new.client_id,
      'from_project', old.project_id, 'to_project', new.project_id));
  end if;
  if new.deleted_at is not null and old.deleted_at is null then
    insert into tk_activity (task_id, actor_email, kind) values (new.id, v_actor, 'deleted');
  elsif new.deleted_at is null and old.deleted_at is not null then
    insert into tk_activity (task_id, actor_email, kind) values (new.id, v_actor, 'restored');
  end if;
  return null;
end $function$;

-- 7. Review-ready email (task enters review) -----------------------------
create or replace function public.tk_review_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_by text;
  v_to text;
  v_payload jsonb;
begin
  if new.deleted_at is not null or new.status <> 'ready_for_review' then
    return null;
  end if;
  if tg_op = 'UPDATE' and old.status = 'ready_for_review' then
    return null;
  end if;
  select s.name into v_by from staff s where lower(s.email) = lower(coalesce(new.submitted_by, '')) and s.active;
  v_payload := jsonb_build_object('text', left(new.text, 200), 'due_date', new.due_date,
                                  'by', coalesce(v_by, 'A teammate'), 'kind', 'task');
  for v_to in
    select lower(s.email) from staff s
     where s.active and s.role = 'admin'
       and lower(s.email) is distinct from lower(coalesce(new.submitted_by, ''))
       and lower(s.email) is distinct from lower(coalesce(new.assignee_email, ''))
       and (new.reviewer_email is null or lower(s.email) = new.reviewer_email)
       and (new.client_id is null or public.tk_staff_has_client(s.email, new.client_id))
  loop
    perform public.tk__enqueue('staff_task_review_ready', v_to, new.client_id, new.id::text, v_payload);
  end loop;
  return null;
end $$;

drop trigger if exists tk_review_notify on public.staff_reminders;
create trigger tk_review_notify after insert or update on public.staff_reminders   -- not "update of status": Done writes done=true and the BEFORE trigger sets status
  for each row execute function public.tk_review_notify();

-- 8. Month marked Ready for sign-off -> admins (S2 follow-up) -----------
create or replace function public.tk_period_review_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text := lower(coalesce(nullif(auth.jwt() ->> 'email', ''), new.updated_by, ''));
  v_by text;
  v_to text;
  v_rev text;
  v_payload jsonb;
begin
  if new.status is distinct from 'review' then
    return null;
  end if;
  if tg_op = 'UPDATE' and old.status is not distinct from 'review' then
    return null;
  end if;
  select s.name into v_by from staff s where lower(s.email) = v_me and s.active;
  v_rev := case when public.tk__is_active_admin(new.reviewer_email) then lower(new.reviewer_email) end;
  if v_rev = v_me then v_rev := null; end if;
  v_payload := jsonb_build_object('kind', 'period', 'period', new.period, 'period_kind', coalesce(new.period_kind, 'month'),
                                  'by', coalesce(v_by, 'A teammate'));
  for v_to in
    select lower(s.email) from staff s
     where s.active and s.role = 'admin'
       and lower(s.email) <> v_me
       and (v_rev is null or lower(s.email) = v_rev)
  loop
    perform public.tk__enqueue('staff_task_review_ready', v_to, new.client_id,
                               new.client_id || '|' || coalesce(new.period_kind, 'month') || '|' || new.period::text, v_payload);
  end loop;
  return null;
end $$;

drop trigger if exists tk_period_review_notify on public.month_close;
create trigger tk_period_review_notify after insert or update on public.month_close
  for each row execute function public.tk_period_review_notify();

-- 9. @mention email (tk_comments AFTER INSERT, staff comments only) ------
-- Client replies (S5, critique B2) use other kinds and are left alone.
create or replace function public.tk_comments_notify_mentions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_t record;
  v_by text;
  v_to text;
begin
  if new.kind is distinct from 'comment' or new.mentions is null or cardinality(new.mentions) = 0 then
    return null;
  end if;
  select r.text, r.client_id into v_t from staff_reminders r where r.id = new.task_id and r.deleted_at is null;
  if not found then
    return null;
  end if;
  select s.name into v_by from staff s where lower(s.email) = lower(coalesce(new.author_email, '')) and s.active;
  for v_to in
    select distinct lower(m) from unnest(new.mentions) m
     where m is not null and lower(m) <> lower(coalesce(new.author_email, ''))
  loop
    if not exists (select 1 from staff s where lower(s.email) = v_to and s.active) then continue; end if;
    if v_t.client_id is not null and not public.tk_staff_has_client(v_to, v_t.client_id) then continue; end if;
    perform public.tk__enqueue('staff_task_mention', v_to, v_t.client_id, new.task_id::text,
      jsonb_build_object('text', left(v_t.text, 200), 'by', coalesce(v_by, 'A teammate'), 'excerpt', left(new.body, 300)));
  end loop;
  return null;
end $$;

drop trigger if exists tk_comments_notify_mentions on public.tk_comments;
create trigger tk_comments_notify_mentions after insert on public.tk_comments
  for each row execute function public.tk_comments_notify_mentions();

-- 10. Review RPCs ---------------------------------------------------------
-- Shared checks for approve / send back: admin, not the assignee or the
-- submitter (critique M3), task in review.
create or replace function public.tk__review_target(p_id uuid)
returns public.staff_reminders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_row staff_reminders%rowtype;
begin
  if v_me = '' or not public.is_active_staff_admin() then
    raise exception 'tk_forbidden' using errcode = '42501';
  end if;
  select * into v_row from staff_reminders r where r.id = p_id and r.deleted_at is null for update;
  if not found or not public.tk_can_edit_task(p_id) then
    raise exception 'tk_forbidden' using errcode = '42501';
  end if;
  if v_row.status <> 'ready_for_review' then
    raise exception 'tk_bad_transition' using errcode = '22023';
  end if;
  if v_me = lower(coalesce(v_row.assignee_email, v_row.staff_email))
     or v_me = lower(coalesce(v_row.submitted_by, '')) then
    raise exception 'tk_self_review' using errcode = '42501';
  end if;
  return v_row;
end $$;

create or replace function public.tk_ready_for_review(p_id uuid, p_note text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from text;
  v_out text;
begin
  if not public.tk_can_edit_task(p_id) then
    raise exception 'tk_forbidden' using errcode = '42501';
  end if;
  select r.status into v_from from staff_reminders r where r.id = p_id and r.deleted_at is null for update;
  if not found then
    raise exception 'tk_forbidden' using errcode = '42501';
  end if;
  if v_from not in ('todo', 'in_progress', 'waiting_client') then
    raise exception 'tk_bad_transition' using errcode = '22023';
  end if;
  update staff_reminders set status = 'ready_for_review' where id = p_id;
  if btrim(coalesce(p_note, '')) <> '' then
    perform set_config('mgb.tk_rpc', 'on', true);
    insert into tk_comments (task_id, author_email, body, kind) values (p_id, '', left(btrim(p_note), 2000), 'system');
    perform set_config('mgb.tk_rpc', '', true);
  end if;
  select r.status into v_out from staff_reminders r where r.id = p_id;
  return v_out;
end $$;

create or replace function public.tk_approve(p_id uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_row staff_reminders%rowtype;
  v_next uuid;
begin
  v_row := public.tk__review_target(p_id);
  perform set_config('mgb.tk_approve', 'approve', true);
  update staff_reminders set approved_by = v_me, approved_at = now() where id = p_id;
  v_next := public.complete_staff_item(p_id, true, null);   -- review -> done, series roll-forward
  if btrim(coalesce(p_note, '')) <> '' then
    perform set_config('mgb.tk_rpc', 'on', true);
    insert into tk_comments (task_id, author_email, body, kind) values (p_id, '', left(btrim(p_note), 2000), 'system');
    perform set_config('mgb.tk_rpc', '', true);
  end if;
  perform set_config('mgb.tk_approve', '', true);
  return jsonb_build_object('ok', true, 'next_id', v_next);
end $$;

create or replace function public.tk_send_back(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_row staff_reminders%rowtype;
  v_by text;
  v_to text;
begin
  if char_length(v_reason) < 3 or char_length(v_reason) > 2000 then
    raise exception 'tk_reason_required' using errcode = '22023';
  end if;
  v_row := public.tk__review_target(p_id);
  perform set_config('mgb.tk_approve', 'send_back', true);
  update staff_reminders set status = 'in_progress', send_back_count = send_back_count + 1 where id = p_id;
  perform set_config('mgb.tk_approve', '', true);
  perform set_config('mgb.tk_rpc', 'on', true);
  insert into tk_comments (task_id, author_email, body, kind) values (p_id, '', v_reason, 'send_back');
  perform set_config('mgb.tk_rpc', '', true);
  select s.name into v_by from staff s where lower(s.email) = lower(coalesce(auth.jwt() ->> 'email', '')) and s.active;
  for v_to in
    select distinct lower(e) from unnest(array[v_row.assignee_email, v_row.submitted_by]) e
     where e is not null and e <> ''
  loop
    if not exists (select 1 from staff s where lower(s.email) = v_to and s.active) then continue; end if;
    if v_row.client_id is not null and not public.tk_staff_has_client(v_to, v_row.client_id) then continue; end if;
    perform public.tk__enqueue('staff_task_sent_back', v_to, v_row.client_id, p_id::text,
      jsonb_build_object('text', left(v_row.text, 200), 'by', coalesce(v_by, 'Your reviewer'), 'reason', left(v_reason, 600)));
  end loop;
end $$;

create or replace function public.tk_withdraw_review(p_id uuid, p_note text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from text;
begin
  if not public.tk_can_edit_task(p_id) then
    raise exception 'tk_forbidden' using errcode = '42501';
  end if;
  select r.status into v_from from staff_reminders r where r.id = p_id and r.deleted_at is null for update;
  if not found then
    raise exception 'tk_forbidden' using errcode = '42501';
  end if;
  if v_from <> 'ready_for_review' then
    raise exception 'tk_bad_transition' using errcode = '22023';
  end if;
  update staff_reminders set status = 'in_progress' where id = p_id;   -- activity: review_withdrawn
  if btrim(coalesce(p_note, '')) <> '' then
    perform set_config('mgb.tk_rpc', 'on', true);
    insert into tk_comments (task_id, author_email, body, kind) values (p_id, '', left(btrim(p_note), 2000), 'system');
    perform set_config('mgb.tk_rpc', '', true);
  end if;
  return 'in_progress';
end $$;

create or replace function public.tk_set_reviewer(p_id uuid, p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(nullif(btrim(coalesce(p_email, '')), ''));
  v_row staff_reminders%rowtype;
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
end $$;

-- tk_set_status: ready_for_review -> done is tk_approve; ready_for_review ->
-- todo/in_progress is Withdraw (review_withdrawn). No send_back comment here
-- any more (critique M4); Send back is tk_send_back.
create or replace function public.tk_set_status(p_id uuid, p_status text, p_note text default null, p_today date default null)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_from text;
  v_out text;
begin
  if p_status is null or p_status not in ('todo','in_progress','waiting_client','ready_for_review','done') then
    raise exception 'tk_bad_status' using errcode = '22023';
  end if;
  if not public.tk_can_edit_task(p_id) then
    raise exception 'tk_forbidden' using errcode = '42501';
  end if;
  select r.status into v_from from staff_reminders r where r.id = p_id and r.deleted_at is null for update;
  if not found then
    raise exception 'tk_forbidden' using errcode = '42501';
  end if;
  if v_from = p_status or (v_from = 'done' and p_status in ('waiting_client', 'ready_for_review')) then
    raise exception 'tk_bad_transition' using errcode = '22023';
  end if;
  if v_from = 'ready_for_review' and p_status = 'done' then   -- tk p2 s3
    perform public.tk_approve(p_id, p_note);
    select r.status into v_out from staff_reminders r where r.id = p_id;
    return v_out;
  end if;
  if p_status = 'done' then
    perform public.complete_staff_item(p_id, true, p_today);   -- the review gate may divert it
  elsif v_from = 'done' and p_status = 'todo' then
    perform public.complete_staff_item(p_id, false, p_today);
  else
    update staff_reminders set status = p_status where id = p_id;
  end if;
  if btrim(coalesce(p_note, '')) <> '' then
    perform set_config('mgb.tk_rpc', 'on', true);
    insert into tk_comments (task_id, author_email, body, kind) values (p_id, '', left(btrim(p_note), 2000), 'system');   -- tk p2 s3
    perform set_config('mgb.tk_rpc', '', true);
  end if;
  select r.status into v_out from staff_reminders r where r.id = p_id;
  return v_out;
end $function$;

-- 11. Stats --------------------------------------------------------------
-- Review stats from columns, not activity counts (critique M4). Window:
-- approvals with approved_at in [p_from, p_to] (Chicago days); sent_back
-- sums send_back_count over those plus unapproved tasks first submitted in
-- the window. open_in_review is the current count. Credit: the assignee.
create or replace function public.tk_review_stats(p_from date, p_to date, p_email text default null)
returns table(staff_email text, approved int, first_pass int, sent_back int, avg_hours_in_review numeric, open_in_review int)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_who text := lower(nullif(btrim(coalesce(p_email, '')), ''));
  v_lo timestamptz := (p_from::timestamp at time zone 'America/Chicago');
  v_hi timestamptz := ((p_to + 1)::timestamp at time zone 'America/Chicago');
begin
  if v_me = '' or not public.is_active_staff() then
    return;
  end if;
  if not public.is_active_staff_admin() then
    v_who := v_me;
  end if;
  return query
  with t as (
    select lower(coalesce(r.assignee_email, r.staff_email)) as who, r.*
      from staff_reminders r
      left join clients c on c.id = r.client_id
     where r.deleted_at is null
       and r.ready_at is not null
       and coalesce(c.test_only, false) = false
       and (r.client_id is null or not (r.client_id = any (public.internal_blocked_ids())))
       and (v_who is null or lower(coalesce(r.assignee_email, r.staff_email)) = v_who)
  )
  select t.who,
         count(*) filter (where t.approved_at >= v_lo and t.approved_at < v_hi)::int,
         count(*) filter (where t.approved_at >= v_lo and t.approved_at < v_hi and t.send_back_count = 0)::int,
         coalesce(sum(t.send_back_count) filter (where (t.approved_at >= v_lo and t.approved_at < v_hi)
                                                   or (t.approved_at is null and t.ready_at >= v_lo and t.ready_at < v_hi)), 0)::int,
         round((avg(extract(epoch from t.approved_at - coalesce(t.submitted_at, t.ready_at)) / 3600.0)
                  filter (where t.approved_at >= v_lo and t.approved_at < v_hi))::numeric, 1),
         count(*) filter (where t.status = 'ready_for_review')::int
    from t
   group by t.who
  having count(*) filter (where (t.approved_at >= v_lo and t.approved_at < v_hi)
                             or (t.ready_at >= v_lo and t.ready_at < v_hi)
                             or t.status = 'ready_for_review') > 0
   order by t.who;
end $$;

-- On-time (decision 8 + critique M5). America/Chicago.
--   deadline = end of due_date_original + waiting_before_due_minutes, plus a
--   wait still running that started before it.
--   Counted: done tasks (by completed_at in the window), open tasks past the
--   deadline (late, by deadline in the window), and tasks deleted after the
--   deadline (done ones by completed_at, open ones late). A task deleted
--   before its deadline is not counted.
--   Only template tasks or tasks someone else created; never asana imports
--   or access requests; never test clients; nothing before on_time_since.
--   submitted_on_time: first Ready for review at or before the deadline
--   (shows reviewer delay without changing decision 8).
create or replace function public.tk_on_time_stats(p_from date, p_to date, p_email text default null)
returns table(staff_email text, eligible int, on_time int, rate numeric, avg_hours_late numeric,
              excluded_wait_hours numeric, submitted_on_time int)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_who text := lower(nullif(btrim(coalesce(p_email, '')), ''));
  v_lo timestamptz := (p_from::timestamp at time zone 'America/Chicago');
  v_hi timestamptz := ((p_to + 1)::timestamp at time zone 'America/Chicago');
  v_since timestamptz;
begin
  if v_me = '' or not public.is_active_staff() then
    return;
  end if;
  if not public.is_active_staff_admin() then
    v_who := v_me;
  end if;
  select ((s.value #>> '{}')::date::timestamp at time zone 'America/Chicago') into v_since
    from tk_settings s where s.key = 'on_time_since';
  v_since := coalesce(v_since, '-infinity'::timestamptz);
  return query
  with base as (
    select lower(coalesce(r.assignee_email, r.staff_email)) as who,
           r.status, r.completed_at, r.deleted_at, r.ready_at, r.waiting_before_due_minutes,
           ((r.due_date_original + 1)::timestamp at time zone 'America/Chicago')
             + make_interval(mins => r.waiting_before_due_minutes) as dl0,
           r.waiting_since
      from staff_reminders r
      left join clients c on c.id = r.client_id
     where r.due_date_original is not null
       and coalesce(c.test_only, false) = false
       and (r.client_id is null or not (r.client_id = any (public.internal_blocked_ids())))
       and coalesce(r.source, 'manual') not in ('asana', 'access_request')
       and (r.source = 'template' or lower(coalesce(r.created_by, '')) <> lower(coalesce(r.assignee_email, r.staff_email)))
       and (v_who is null or lower(coalesce(r.assignee_email, r.staff_email)) = v_who)
  ), d as (
    select b.*,
           b.dl0 + case when b.status = 'waiting_client' and b.waiting_since is not null and b.waiting_since < b.dl0
                        then now() - b.waiting_since else interval '0' end as dl
      from base b
  ), e as (
    select d.*,
           case when d.status = 'done' then d.completed_at else d.dl end as at_time,
           case when d.status = 'done' then d.completed_at
                when d.deleted_at is not null then d.deleted_at
                else now() end as end_time
      from d
     where (d.deleted_at is null or d.deleted_at > d.dl)
       and (d.status = 'done' or d.dl < now())
  )
  select e.who,
         count(*)::int,
         count(*) filter (where e.status = 'done' and e.completed_at <= e.dl)::int,
         round(count(*) filter (where e.status = 'done' and e.completed_at <= e.dl)::numeric / nullif(count(*), 0), 3),
         round((avg(extract(epoch from e.end_time - e.dl) / 3600.0)
                  filter (where not (e.status = 'done' and e.completed_at <= e.dl)))::numeric, 1),
         round(coalesce(sum(e.waiting_before_due_minutes), 0)::numeric / 60.0, 1),
         count(*) filter (where e.ready_at is not null and e.ready_at <= e.dl)::int
    from e
   where e.at_time >= greatest(v_lo, v_since) and e.at_time < v_hi
   group by e.who
   order by e.who;
end $$;

-- 12. Backfill (first run; later runs find nothing to do) ----------------
do $$
begin
  perform set_config('mgb.tk_migrate', 'on', true);
  update public.staff_reminders
     set due_date_original = due_date
   where due_date_original is null and due_date is not null;
  update public.staff_reminders
     set ready_at = coalesce(status_changed_at, updated_at, now()),
         submitted_at = coalesce(status_changed_at, updated_at, now()),
         submitted_by = lower(coalesce(status_changed_by, assignee_email, staff_email))
   where status = 'ready_for_review' and ready_at is null;
  perform set_config('mgb.tk_migrate', '', true);
end $$;

-- 13. client_health: a month in 'review' is not unfinished (S2 follow-up) -
select pg_temp.patch_fn('public.client_health(jsonb)',
  $a$coalesce(m.status, 'not_started') not in ('done', 'na')$a$,
  $b$coalesce(m.status, 'not_started') not in ('done', 'na', 'review')$b$, 1);

-- 14. Schema probe -------------------------------------------------------
create or replace function public.tk_schema_version()
returns int
language sql
stable
set search_path = public
as $$ select 4 $$;

-- 15. Grants -------------------------------------------------------------
revoke all on function public.tk__owner_only_key(text) from public, anon, authenticated;
revoke all on function public.tk_settings_before_write() from public, anon, authenticated;
revoke all on function public.tk_settings_after_write() from public, anon, authenticated;
revoke all on function public.tk_guard_client_request_switch() from public, anon, authenticated;
revoke all on function public.tk__is_active_admin(text) from public, anon, authenticated;
revoke all on function public.tk__default_reviewer(text, text[]) from public, anon, authenticated;
revoke all on function public.client_profile_reviewer_guard() from public, anon, authenticated;
revoke all on function public.tk__enqueue(text, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.tk_review_notify() from public, anon, authenticated;
revoke all on function public.tk_period_review_notify() from public, anon, authenticated;
revoke all on function public.tk_comments_notify_mentions() from public, anon, authenticated;
revoke all on function public.tk__review_target(uuid) from public, anon, authenticated;
revoke all on function public.tk_ready_for_review(uuid, text) from public, anon, authenticated;
revoke all on function public.tk_approve(uuid, text) from public, anon, authenticated;
revoke all on function public.tk_send_back(uuid, text) from public, anon, authenticated;
revoke all on function public.tk_withdraw_review(uuid, text) from public, anon, authenticated;
revoke all on function public.tk_set_reviewer(uuid, text) from public, anon, authenticated;
revoke all on function public.tk_set_status(uuid, text, text, date) from public, anon, authenticated;
revoke all on function public.tk_review_stats(date, date, text) from public, anon, authenticated;
revoke all on function public.tk_on_time_stats(date, date, text) from public, anon, authenticated;
revoke all on function public.tk_client_people(text) from public, anon, authenticated;
revoke all on function public.tk_schema_version() from public, anon, authenticated;

grant execute on function public.tk_ready_for_review(uuid, text) to authenticated;
grant execute on function public.tk_approve(uuid, text) to authenticated;
grant execute on function public.tk_send_back(uuid, text) to authenticated;
grant execute on function public.tk_withdraw_review(uuid, text) to authenticated;
grant execute on function public.tk_set_reviewer(uuid, text) to authenticated;
grant execute on function public.tk_set_status(uuid, text, text, date) to authenticated;
grant execute on function public.tk_review_stats(date, date, text) to authenticated;
grant execute on function public.tk_on_time_stats(date, date, text) to authenticated;
grant execute on function public.tk_client_people(text) to authenticated;
grant execute on function public.tk_schema_version() to authenticated;
