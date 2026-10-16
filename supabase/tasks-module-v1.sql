-- NOTE: tk_tasks, staff_reminders_before_write, tk_set_status, tk_staff_reminders_activity and tk_client_people (where defined here) are superseded by tasks-p2-3-review.sql; re-run that file after this one.
-- =====================================================================
-- Tasks module, Phase 1 (tk v1). Spec: docs/tasks-phase1-spec.md Part D.
--
-- Safe to re-run. No transaction control (apply_migration wraps it).
-- Nothing is dropped, truncated or deleted. Every new table has RLS on
-- and exact grants: the live pg_default_acl hands anon and authenticated
-- every privilege on new tables, views and sequences and EXECUTE on new
-- functions, so each new object starts from "revoke all" and then gets
-- only what Part D lists.
--
-- New rule for this repo: a CHECK added to an existing table is added
-- "not valid" and then validated, so the add never blocks on a long scan
-- and a re-run is a no-op.
--
-- Non-additive changes, each with its data-preservation note:
--   1. staff_reminders_shared_needs_client is replaced by a strictly
--      wider CHECK (adds "or project_id is not null"). Every existing
--      row passed the old rule, so every row passes the new one.
--   2. staff_reminders_before_write is rewritten (D6). Every live
--      statement is kept verbatim. The only edits: the INSERT branch
--      loses its early "return new;", and the live revert plus the
--      UPDATE due sync are wrapped in "if tg_op = 'UPDATE'" (they were
--      UPDATE-only by position before). New lines are marked tk v1.
--   3. complete_staff_item and the reader functions client_health,
--      digest_weekly_data, staff_performance and offboard_staff_preview
--      get create or replace with the same signatures, security and
--      grants. The bodies are the live bodies (matched by md5 of
--      prosrc on 2026-10-11) with tk v1 edits only. offboard_staff and
--      tt_generate_template_tasks need no change (D13) and are not
--      recreated.
--   4. notify_enqueue_task_assigned gets create or replace with one
--      added early return for soft-deleted rows.
--   5. A new BEFORE DELETE trigger on staff_reminders turns deletes from
--      signed-in users into soft deletes (D9). It removes nothing; it
--      keeps rows that a delete would have removed.
--
-- Notes:
--   - The pasted digest_weekly_data body contains "truncate" of its own
--     session temp tables (_dg_*). That is live code, unchanged, and
--     never touches a real table.
--   - tk_project_info also answers for server callers with no signed-in
--     user (cron, service role, this migration), so a server write on a
--     project task does not fail the D6 project check. Signed-in callers
--     still need is_active_staff().
--   - tk_projects: non-admin managers cannot change open_to_staff on
--     update either (the insert already forces it false for them).
--   - DEPLOY WINDOW (spec Part G item 12). Once this file is applied,
--     every signed-in DELETE on staff_reminders becomes a soft delete
--     (D9). The live app still hard-deletes and does not filter
--     deleted_at, and the notification-emails and client-emails edge
--     functions read staff_reminders with no deleted_at filter. Until
--     those two functions and the app ship, a deleted task stays in
--     Today, the bell and the Overview card, can still get a "due today"
--     email and can still show in the client value report. Apply this
--     file, deploy notification-emails and client-emails, and ship the
--     app in one window with no gap.
--   - Moving a client task into an internal project: the live revert
--     keeps client_id for anyone but the task owner, admins included,
--     so an admin's move leaves the task on the client as well as in the
--     project (spec Part H). The owner clears the client to take it off.
--   - Archived projects: on insert, or on a move into an archived
--     project, D6 raises 22023 tk_project_archived for signed-in
--     non-admins. Edits to tasks already in the project still work.
--   - fix 1 (migration tasks_module_v1_fix_1, code review): a direct
--     API insert into staff_reminders needs is_active_staff(), and putting
--     a task on a client (insert, or the owner moving client_id) needs
--     can_access_client() unless the caller is an admin. Definer RPCs
--     (access requests, roll-forward), cron and bypass writes are exempt
--     because current_user is then the function owner, not anon or
--     authenticated. tk_can_edit_task checks is_active_staff() before the
--     owner test, and tk_attachments_before_write refuses non-staff
--     inserts, so a non-staff owner cannot attach, upload or set status.
--     notify_enqueue_task_assigned skips the email when the assignee
--     cannot open the task's client. tk_project_info hides client_id and
--     archived from callers who cannot see the project. tk_comments gets
--     edited_by. A former editor can soft-remove their own attachment only
--     while they can still read the task.
-- =====================================================================


-- D1. New columns on staff_reminders ----------------------------------
alter table public.staff_reminders
  add column if not exists status text not null default 'todo',
  add column if not exists status_changed_at timestamptz,
  add column if not exists status_changed_by text,
  add column if not exists status_before_wait text,
  add column if not exists waiting_since timestamptz,
  add column if not exists waiting_minutes integer not null default 0,
  add column if not exists description text,
  add column if not exists start_on date,
  add column if not exists section text,
  add column if not exists sort_key numeric,
  add column if not exists parent_id uuid references public.staff_reminders(id) on delete set null,
  add column if not exists sop_section text,
  add column if not exists review_required boolean not null default false,
  add column if not exists series_id uuid,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by text;
-- project_id is added in D3, after tk_projects exists.

do $$
declare
  v_checks text[][] := array[
    array['staff_reminders_status_check',
          'check (status in (''todo'',''in_progress'',''waiting_client'',''ready_for_review'',''done''))'],
    array['staff_reminders_status_before_wait_check',
          'check (status_before_wait is null or status_before_wait in (''todo'',''in_progress'',''waiting_client'',''ready_for_review''))'],
    array['staff_reminders_sop_section_check',
          'check (sop_section is null or sop_section in (''access'',''bank_feeds'',''monthly_close'',''payroll'',''bills_vendors'',''reporting'',''quirks''))'],
    array['staff_reminders_description_len',
          'check (description is null or char_length(description) <= 5000)'],
    array['staff_reminders_section_len',
          'check (section is null or char_length(section) between 1 and 60)']
  ];
  i int;
begin
  for i in 1 .. array_length(v_checks, 1) loop
    if not exists (select 1 from pg_constraint
                    where conrelid = 'public.staff_reminders'::regclass and conname = v_checks[i][1]) then
      execute format('alter table public.staff_reminders add constraint %I %s not valid', v_checks[i][1], v_checks[i][2]);
    end if;
    execute format('alter table public.staff_reminders validate constraint %I', v_checks[i][1]);
  end loop;
end $$;


-- D2. tk_projects and tk_project_members ------------------------------
create table if not exists public.tk_projects (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  kind text not null default 'internal' check (kind in ('internal','onboarding')),
  client_id text references public.clients(id) on update cascade,
  owner_email text,
  open_to_staff boolean not null default false,
  sections text[] not null default '{}' check (cardinality(sections) <= 30),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tk_projects_client_kind check ((kind = 'onboarding') = (client_id is not null))
);
-- unique per client (onboarding) or per the internal scope (client_id null),
-- so two clients can each have "Onboarding"
create unique index if not exists tk_projects_name_uniq
  on public.tk_projects (coalesce(client_id, ''), lower(name)) where archived_at is null;

create table if not exists public.tk_project_members (
  project_id uuid not null references public.tk_projects(id) on delete cascade,
  staff_email text not null references public.staff(email) on update cascade on delete cascade
    check (staff_email = lower(staff_email)),
  role text not null default 'member' check (role in ('member','owner')),
  added_by text,
  added_at timestamptz not null default now(),
  primary key (project_id, staff_email)
);
create index if not exists tk_project_members_email_idx on public.tk_project_members (staff_email);

alter table public.tk_projects enable row level security;
alter table public.tk_project_members enable row level security;
revoke all on public.tk_projects from anon, authenticated;
revoke all on public.tk_project_members from anon, authenticated;
grant select, insert, update on public.tk_projects to authenticated;
grant select, insert, update, delete on public.tk_project_members to authenticated;

create or replace function public.tk_is_project_member(p_project uuid)
returns boolean
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_me text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if v_me = '' or not public.is_active_staff() then
    return false;
  end if;
  return exists (select 1 from public.tk_project_members m
                  where m.project_id = p_project and m.staff_email = v_me)
      or exists (select 1 from public.tk_projects p
                  where p.id = p_project and p.open_to_staff);
end $$;

create or replace function public.tk_can_see_project(p_project uuid)
returns boolean
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_p record;
begin
  if v_me = '' or not public.is_active_staff() then
    return false;
  end if;
  if public.is_active_staff_admin() then
    return true;
  end if;
  select p.owner_email, p.client_id into v_p from public.tk_projects p where p.id = p_project;
  if not found then
    return false;
  end if;
  return lower(coalesce(v_p.owner_email, '')) = v_me
      or public.tk_is_project_member(p_project)
      or (v_p.client_id is not null and public.can_access_client(v_p.client_id));
end $$;

create or replace function public.tk_can_manage_project(p_project uuid)
returns boolean
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_me text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if v_me = '' or not public.is_active_staff() then
    return false;
  end if;
  if public.is_active_staff_admin() then
    return true;
  end if;
  -- open_to_staff never grants manage
  return exists (select 1 from public.tk_projects p
                  where p.id = p_project and lower(coalesce(p.owner_email, '')) = v_me)
      or exists (select 1 from public.tk_project_members m
                  where m.project_id = p_project and m.staff_email = v_me and m.role = 'owner');
end $$;

-- fix 1: client_id and archived come back only to server callers and to
-- staff who can see the project (tk_can_see_project); anyone else gets
-- found plus nulls, so a known uuid never reveals a project's client.
create or replace function public.tk_project_info(p_project uuid, out found boolean, out client_id text, out archived boolean)
language sql stable security definer
set search_path = public
as $$
  select p.id is not null,
         case when s.srv or (p.id is not null and public.tk_can_see_project(p.id)) then p.client_id end,
         coalesce((s.srv or (p.id is not null and public.tk_can_see_project(p.id))) and p.archived_at is not null, false)
    from (select coalesce(auth.jwt() ->> 'email', '') = ''
                 and coalesce(auth.jwt() ->> 'role', '') not in ('anon', 'authenticated') as srv) s
    left join public.tk_projects p
      on p.id = p_project
     and (public.is_active_staff() or s.srv);
$$;

revoke all on function public.tk_is_project_member(uuid) from public, anon;
revoke all on function public.tk_can_see_project(uuid) from public, anon;
revoke all on function public.tk_can_manage_project(uuid) from public, anon;
revoke all on function public.tk_project_info(uuid) from public, anon;
grant execute on function public.tk_is_project_member(uuid) to authenticated;
grant execute on function public.tk_can_see_project(uuid) to authenticated;
grant execute on function public.tk_can_manage_project(uuid) to authenticated;
grant execute on function public.tk_project_info(uuid) to authenticated;

-- BEFORE INSERT (definer): non-admins get a forced owner and open_to_staff = false
create or replace function public.tk_projects_before_insert()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_me text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  new.name := btrim(new.name);
  new.created_at := now();
  new.updated_at := now();
  if v_me <> '' and not public.is_active_staff_admin() then
    new.owner_email := nullif(v_me, '');
    new.open_to_staff := false;
  else
    new.owner_email := coalesce(lower(nullif(btrim(new.owner_email), '')), nullif(v_me, ''));
  end if;
  return new;
end $$;

-- BEFORE UPDATE (invoker): pins
create or replace function public.tk_projects_before_update()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_me text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  new.id := old.id;
  new.created_at := old.created_at;
  new.name := btrim(new.name);
  if v_me <> '' and not public.is_active_staff_admin() then
    new.kind := old.kind;
    new.client_id := old.client_id;
    new.owner_email := old.owner_email;
    new.open_to_staff := old.open_to_staff;
  else
    new.owner_email := lower(nullif(btrim(new.owner_email), ''));
  end if;
  new.updated_at := now();
  return new;
end $$;

-- AFTER INSERT (definer): the creator becomes an owner member
create or replace function public.tk_projects_after_insert()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_me text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if v_me <> '' then
    insert into public.tk_project_members (project_id, staff_email, role, added_by)
    select new.id, s.email, 'owner', v_me
      from public.staff s
     where lower(s.email) = v_me and s.active and s.email = lower(s.email)
    on conflict do nothing;
  end if;
  return null;
end $$;

-- BEFORE INSERT on members: lowercase, stamp, active staff only
create or replace function public.tk_project_members_before_insert()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  new.staff_email := lower(btrim(new.staff_email));
  new.added_by := coalesce(nullif(lower(coalesce(auth.jwt() ->> 'email', '')), ''), new.added_by);
  new.added_at := now();
  if not exists (select 1 from public.staff s where s.email = new.staff_email and s.active) then
    raise exception 'tk_member_inactive' using errcode = '22023';
  end if;
  return new;
end $$;

-- BEFORE UPDATE on members (invoker): only the role can change
create or replace function public.tk_project_members_before_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.project_id := old.project_id;
  new.staff_email := old.staff_email;
  new.added_by := old.added_by;
  new.added_at := old.added_at;
  return new;
end $$;

revoke all on function public.tk_projects_before_insert() from public, anon, authenticated;
revoke all on function public.tk_project_members_before_update() from public, anon, authenticated;
revoke all on function public.tk_projects_before_update() from public, anon, authenticated;
revoke all on function public.tk_projects_after_insert() from public, anon, authenticated;
revoke all on function public.tk_project_members_before_insert() from public, anon, authenticated;

drop trigger if exists tk_projects_before_insert on public.tk_projects;
create trigger tk_projects_before_insert before insert on public.tk_projects
  for each row execute function public.tk_projects_before_insert();
drop trigger if exists tk_projects_before_update on public.tk_projects;
create trigger tk_projects_before_update before update on public.tk_projects
  for each row execute function public.tk_projects_before_update();
drop trigger if exists tk_projects_after_insert on public.tk_projects;
create trigger tk_projects_after_insert after insert on public.tk_projects
  for each row execute function public.tk_projects_after_insert();
drop trigger if exists tk_project_members_before_insert on public.tk_project_members;
create trigger tk_project_members_before_insert before insert on public.tk_project_members
  for each row execute function public.tk_project_members_before_insert();
drop trigger if exists tk_project_members_before_update on public.tk_project_members;
create trigger tk_project_members_before_update before update on public.tk_project_members
  for each row execute function public.tk_project_members_before_update();

-- Policies. The owner test sits in the select policy itself so that
-- insert ... returning works before the AFTER trigger adds the member row.
drop policy if exists "tk projects read" on public.tk_projects;
create policy "tk projects read" on public.tk_projects for select to authenticated
  using (owner_email = lower(coalesce(auth.jwt() ->> 'email', '')) or public.tk_can_see_project(id));
drop policy if exists "tk projects insert" on public.tk_projects;
create policy "tk projects insert" on public.tk_projects for insert to authenticated
  with check (public.is_active_staff() and (kind = 'internal' or public.can_access_client(client_id)));
drop policy if exists "tk projects update" on public.tk_projects;
create policy "tk projects update" on public.tk_projects for update to authenticated
  using (public.tk_can_manage_project(id)) with check (public.tk_can_manage_project(id));

drop policy if exists "tk members read" on public.tk_project_members;
create policy "tk members read" on public.tk_project_members for select to authenticated
  using (public.tk_can_see_project(project_id));
drop policy if exists "tk members insert" on public.tk_project_members;
create policy "tk members insert" on public.tk_project_members for insert to authenticated
  with check (public.tk_can_manage_project(project_id));
drop policy if exists "tk members update" on public.tk_project_members;
create policy "tk members update" on public.tk_project_members for update to authenticated
  using (public.tk_can_manage_project(project_id)) with check (public.tk_can_manage_project(project_id));
drop policy if exists "tk members delete" on public.tk_project_members;
create policy "tk members delete" on public.tk_project_members for delete to authenticated
  using (public.tk_can_manage_project(project_id) or staff_email = lower(coalesce(auth.jwt() ->> 'email', '')));

-- Seed: four internal projects, no owner, no members. A re-run never
-- changes open_to_staff on a row that already exists.
insert into public.tk_projects (name, kind, open_to_staff)
select v.name, 'internal', v.open_to_staff
  from (values ('SOPs', true), ('Directors', false), ('Owners', false), ('90 Day', true)) v(name, open_to_staff)
 where not exists (select 1 from public.tk_projects p
                    where p.client_id is null and lower(p.name) = lower(v.name));


-- D3. staff_reminders.project_id, plus the CHECK swap ------------------
alter table public.staff_reminders
  add column if not exists project_id uuid references public.tk_projects(id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.staff_reminders'::regclass
                    and conname = 'staff_reminders_shared_needs_client'
                    and pg_get_constraintdef(oid) like '%project_id%') then
    -- strictly wider rule: every existing row still passes
    alter table public.staff_reminders drop constraint if exists staff_reminders_shared_needs_client;
    alter table public.staff_reminders add constraint staff_reminders_shared_needs_client
      check (visibility = 'private' or client_id is not null or project_id is not null) not valid;
  end if;
  alter table public.staff_reminders validate constraint staff_reminders_shared_needs_client;
end $$;


-- D4. Indexes on staff_reminders --------------------------------------
create index if not exists staff_reminders_tk_assignee_idx
  on public.staff_reminders (assignee_email, done, due_date) where deleted_at is null;
create index if not exists staff_reminders_tk_project_idx
  on public.staff_reminders (project_id) where project_id is not null;
create index if not exists staff_reminders_tk_parent_idx
  on public.staff_reminders (parent_id) where parent_id is not null;
create index if not exists staff_reminders_tk_updated_idx
  on public.staff_reminders (updated_at);
create index if not exists staff_reminders_tk_client_idx
  on public.staff_reminders (client_id) where deleted_at is null;
alter table public.staff_reminders add column if not exists search_tsv tsvector generated always as
  (setweight(to_tsvector('english', coalesce("text", '')), 'A')
   || setweight(to_tsvector('english', coalesce(description, '')), 'B')) stored;
create index if not exists staff_reminders_tk_search_idx on public.staff_reminders using gin (search_tsv);


-- D5. Access helpers ---------------------------------------------------
-- Internal mirror of can_access_client for any email (live body, with
-- every jwt-email compare replaced by lower(...) = lower(p_email)).
create or replace function public.tk_staff_has_client(p_email text, p_client text)
returns boolean
language plpgsql stable security definer
set search_path = public
as $$
begin
  return exists (
        select 1 from staff s
        where lower(s.email) = lower(p_email)
          and s.active
          and s.role = 'admin'
      )
      or exists (
        select 1 from staff_client_access sca
        where lower(sca.staff_email) = lower(p_email)
          and sca.client_id = p_client
      )
      or (
        exists (select 1 from staff s where lower(s.email) = lower(p_email) and s.active)
        and exists (
          select 1 from staff_client_access_grants g
          where lower(g.staff_email) = lower(p_email)
            and g.client_id = p_client
            and g.status = 'approved'
            and g.expires_at > now()
        )
      );
end $$;

-- "Could this person reach the task's container?"
create or replace function public.tk_task_scope_ok(p_task uuid, p_email text)
returns boolean
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_e text := lower(coalesce(p_email, ''));
  v_r record;
begin
  if v_e = '' or not exists (select 1 from staff s where lower(s.email) = v_e and s.active) then
    return false;
  end if;
  select r.staff_email, r.client_id, r.project_id into v_r from staff_reminders r where r.id = p_task;
  if not found then
    return false;
  end if;
  if lower(v_r.staff_email) = v_e
     or exists (select 1 from staff s where lower(s.email) = v_e and s.active and s.role = 'admin') then
    return true;
  end if;
  if v_r.client_id is not null then
    return public.tk_staff_has_client(v_e, v_r.client_id);
  end if;
  if v_r.project_id is not null then
    return exists (select 1 from tk_project_members m where m.project_id = v_r.project_id and m.staff_email = v_e)
        or exists (select 1 from tk_projects p where p.id = v_r.project_id and p.open_to_staff);
  end if;
  -- no client and no project: an editor chooses to share it through
  -- tk_add_follower; mentions by a non-editor never add followers (D8)
  return true;
end $$;

create or replace function public.tk_row_readable(p_id uuid, p_owner text, p_assignee text, p_client text, p_project uuid, p_visibility text)
returns boolean
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_inv boolean;
begin
  if v_me = '' then return false; end if;
  if lower(p_owner) = v_me then return true; end if;
  if not public.is_active_staff() then return false; end if;
  if public.is_active_staff_admin() then return true; end if;
  v_inv := lower(coalesce(p_assignee, '')) = v_me
           or exists (select 1 from tk_followers f where f.task_id = p_id and f.staff_email = v_me);
  if p_client is not null then
    return public.can_access_client(p_client) and (p_visibility = 'shared' or v_inv);
  end if;
  if p_project is not null then
    return public.tk_is_project_member(p_project) and (p_visibility = 'shared' or v_inv);
  end if;
  return v_inv;
end $$;

create or replace function public.tk_can_read_task(p_id uuid)
returns boolean
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_r record;
begin
  select r.id, r.staff_email, r.assignee_email, r.client_id, r.project_id, r.visibility
    into v_r from staff_reminders r where r.id = p_id;
  if not found then
    return false;
  end if;
  -- deleted rows follow the same rule
  return public.tk_row_readable(v_r.id, v_r.staff_email, v_r.assignee_email, v_r.client_id, v_r.project_id, v_r.visibility);
end $$;

create or replace function public.tk_can_edit_task(p_id uuid)
returns boolean
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_r record;
begin
  select r.id, r.staff_email, r.assignee_email, r.client_id, r.project_id, r.visibility
    into v_r from staff_reminders r where r.id = p_id;
  if not found or v_me = '' then
    return false;
  end if;
  if not public.is_active_staff() then return false; end if;   -- fix 1: staff first, even for the owner
  if lower(v_r.staff_email) = v_me then return true; end if;
  if public.is_active_staff_admin() then return true; end if;
  if lower(coalesce(v_r.assignee_email, '')) = v_me
     and public.tk_row_readable(v_r.id, v_r.staff_email, v_r.assignee_email, v_r.client_id, v_r.project_id, v_r.visibility) then
    return true;
  end if;
  if v_r.visibility = 'shared' and v_r.client_id is not null and public.can_access_client(v_r.client_id) then
    return true;
  end if;
  if v_r.visibility = 'shared' and v_r.client_id is null and v_r.project_id is not null
     and public.tk_is_project_member(v_r.project_id) then
    return true;
  end if;
  -- followers can read and comment, not edit
  return false;
end $$;

create or replace function public.tk_path_task_id(p_name text)
returns uuid
language sql immutable
set search_path = public
as $$
  select case when split_part(coalesce(p_name, ''), '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then split_part(p_name, '/', 1)::uuid end;
$$;

create or replace function public.tk_schema_version()
returns integer
language sql immutable
set search_path = public
as $$ select 1; $$;

revoke all on function public.tk_staff_has_client(text, text) from public, anon, authenticated;
revoke all on function public.tk_task_scope_ok(uuid, text) from public, anon, authenticated;
revoke all on function public.tk_row_readable(uuid, text, text, text, uuid, text) from public, anon;
revoke all on function public.tk_can_read_task(uuid) from public, anon;
revoke all on function public.tk_can_edit_task(uuid) from public, anon;
revoke all on function public.tk_path_task_id(text) from public, anon;
revoke all on function public.tk_schema_version() from public, anon;
grant execute on function public.tk_row_readable(uuid, text, text, text, uuid, text) to authenticated;
grant execute on function public.tk_can_read_task(uuid) to authenticated;
grant execute on function public.tk_can_edit_task(uuid) to authenticated;
grant execute on function public.tk_path_task_id(text) to authenticated;
grant execute on function public.tk_schema_version() to authenticated;


-- D6. Rewrite staff_reminders_before_write (live body + tk v1) ---------
CREATE OR REPLACE FUNCTION public.staff_reminders_before_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_caller text := coalesce(auth.jwt() ->> 'email', '');
  v_me text; v_bypass boolean; v_admin boolean; v_roll boolean; v_p record;   -- tk v1
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
  if new.status = 'done' and (tg_op = 'INSERT' or old.status <> 'done')
     and new.review_required and v_me <> '' and not (v_admin or v_bypass) then
    new.status := 'ready_for_review';      -- review gate: legacy done=true writes divert too; admins approve through v_admin
  end if;
  if tg_op = 'UPDATE' and new.status is distinct from old.status
     and old.status = 'done' and new.status in ('waiting_client','ready_for_review') then
    raise exception 'tk_bad_transition' using errcode = '22023';
  end if;
  new.done := (new.status = 'done');       -- ready_for_review never syncs done=true
  if new.done and (tg_op = 'INSERT' or not old.done) then new.completed_at := coalesce(new.completed_at, now());
  elsif new.done then new.completed_at := old.completed_at;   -- UPDATE where both stay done keeps the original time
  else new.completed_at := null; end if;

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
revoke all on function public.staff_reminders_before_write() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_trigger
                  where tgrelid = 'public.staff_reminders'::regclass
                    and tgname = 'staff_reminders_before_write' and not tgisinternal) then
    create trigger staff_reminders_before_write before insert or update on public.staff_reminders
      for each row execute function public.staff_reminders_before_write();
  end if;
end $$;


-- D8. Child tables ---------------------------------------------------
create table if not exists public.tk_followers (
  task_id uuid not null references public.staff_reminders(id) on delete cascade,
  staff_email text not null references public.staff(email) on update cascade on delete cascade
    check (staff_email = lower(staff_email)),
  added_by text,
  added_at timestamptz not null default now(),
  primary key (task_id, staff_email)
);
create index if not exists tk_followers_email_idx on public.tk_followers (staff_email);

create table if not exists public.tk_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.staff_reminders(id) on delete cascade,
  author_email text not null,
  body text not null check (char_length(btrim(body)) between 1 and 5000),
  mentions text[] not null default '{}',
  kind text not null default 'comment' check (kind in ('comment','send_back','client_reply','system')),
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  deleted_by text,
  tsv tsvector generated always as (to_tsvector('english', coalesce(body, ''))) stored
);
-- fix 1: who last changed the body (an admin can edit someone else's comment)
alter table public.tk_comments add column if not exists edited_by text;
create index if not exists tk_comments_task_idx on public.tk_comments (task_id, created_at);
create index if not exists tk_comments_mentions_idx on public.tk_comments using gin (mentions);
create index if not exists tk_comments_tsv_idx on public.tk_comments using gin (tsv);

create table if not exists public.tk_activity (
  id bigserial primary key,
  task_id uuid not null references public.staff_reminders(id) on delete cascade,
  actor_email text not null,
  kind text not null check (kind in ('created','status','assignee','due','priority','section','comment','review_approved',
    'review_sent_back','client_asked','client_answered','reassigned_ooo','imported','deleted','restored','moved')),
  from_value text,
  to_value text,
  meta jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists tk_activity_task_idx on public.tk_activity (task_id, created_at);

create table if not exists public.tk_attachments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.staff_reminders(id) on delete cascade,
  kind text not null check (kind in ('file','drive','link')),
  client_file_id uuid references public.client_files(id) on delete set null,
  storage_path text,
  url text check (url is null or (url ~* '^https://' and char_length(url) <= 2000)),
  name text not null check (char_length(name) between 1 and 255),
  size bigint check (size is null or size >= 0),
  mime text,
  added_by text,
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by text,
  constraint tk_attachments_shape check (
    (kind = 'link' and url is not null) or (kind = 'file' and storage_path is not null) or (kind = 'drive'))
);
create index if not exists tk_attachments_task_idx on public.tk_attachments (task_id);
create index if not exists tk_attachments_client_file_idx
  on public.tk_attachments (client_file_id) where client_file_id is not null;

alter table public.tk_followers enable row level security;
alter table public.tk_comments enable row level security;
alter table public.tk_activity enable row level security;
alter table public.tk_attachments enable row level security;
revoke all on public.tk_followers from anon, authenticated;
revoke all on public.tk_comments from anon, authenticated;
revoke all on public.tk_activity from anon, authenticated;
revoke all on public.tk_attachments from anon, authenticated;
revoke all on sequence public.tk_activity_id_seq from anon, authenticated;
grant select, insert, delete on public.tk_followers to authenticated;
grant select, insert, update on public.tk_comments to authenticated;
grant select on public.tk_activity to authenticated;
grant select, insert, update on public.tk_attachments to authenticated;


-- D8. Child-table policies and triggers --------------------------------
-- tk_followers
drop policy if exists "tk followers read" on public.tk_followers;
create policy "tk followers read" on public.tk_followers for select to authenticated
  using (public.tk_can_read_task(task_id));
drop policy if exists "tk followers insert self" on public.tk_followers;
create policy "tk followers insert self" on public.tk_followers for insert to authenticated
  with check (staff_email = lower(coalesce(auth.jwt() ->> 'email', '')) and public.tk_can_read_task(task_id));
drop policy if exists "tk followers delete" on public.tk_followers;
create policy "tk followers delete" on public.tk_followers for delete to authenticated
  using (staff_email = lower(coalesce(auth.jwt() ->> 'email', '')) or public.tk_can_edit_task(task_id));

-- tk_parse_mentions (internal)
create or replace function public.tk_parse_mentions(p_body text, p_task uuid)
returns text[]
language sql stable security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct s.email), '{}') from public.staff s
  where s.active
    and lower(split_part(s.email, '@', 1)) in (
      select rtrim(lower(m[1]), '.') from regexp_matches(coalesce(p_body, ''), '(?:^|[^A-Za-z0-9_.])@([A-Za-z0-9._-]{2,64})', 'g') m)
    and public.tk_task_scope_ok(p_task, s.email);
$$;
revoke all on function public.tk_parse_mentions(text, uuid) from public, anon, authenticated;

-- tk_comments
drop policy if exists "tk comments read" on public.tk_comments;
create policy "tk comments read" on public.tk_comments for select to authenticated
  using (public.tk_can_read_task(task_id));
drop policy if exists "tk comments insert" on public.tk_comments;
create policy "tk comments insert" on public.tk_comments for insert to authenticated
  with check (public.tk_can_read_task(task_id));
drop policy if exists "tk comments update" on public.tk_comments;
create policy "tk comments update" on public.tk_comments for update to authenticated
  using ((lower(author_email) = lower(coalesce(auth.jwt() ->> 'email', '')) and public.tk_can_read_task(task_id))
         or public.is_active_staff_admin())
  with check ((lower(author_email) = lower(coalesce(auth.jwt() ->> 'email', '')) and public.tk_can_read_task(task_id))
              or public.is_active_staff_admin());

create or replace function public.tk_comments_before_write()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_me text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if tg_op = 'INSERT' then
    new.author_email := v_me;
    if v_me = '' or not public.is_active_staff() then
      raise exception 'tk_forbidden' using errcode = '42501';
    end if;
    if new.kind is distinct from 'comment' and coalesce(current_setting('mgb.tk_rpc', true), '') <> 'on' then
      new.kind := 'comment';
    end if;
    new.mentions := array_remove(public.tk_parse_mentions(new.body, new.task_id), new.author_email);
    new.created_at := now();
    new.edited_at := null;
    new.edited_by := null;   -- fix 1
    new.deleted_at := null;
    new.deleted_by := null;
  else
    new.id := old.id;
    new.task_id := old.task_id;
    new.author_email := old.author_email;
    new.kind := old.kind;
    new.created_at := old.created_at;
    -- always recompute, so a client-sent mentions array never survives
    new.mentions := array_remove(public.tk_parse_mentions(new.body, new.task_id), new.author_email);
    new.edited_at := case when new.body is distinct from old.body then now() else old.edited_at end;
    new.edited_by := case when new.body is distinct from old.body then nullif(v_me, '') else old.edited_by end;   -- fix 1
    if new.deleted_at is not null and old.deleted_at is not null then
      new.deleted_at := old.deleted_at;
    end if;
    new.deleted_by := case when new.deleted_at is not null and old.deleted_at is null then nullif(v_me, '')
                           when new.deleted_at is null then null
                           else old.deleted_by end;
  end if;
  return new;
end $$;

create or replace function public.tk_comments_follow()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_new text[];
begin
  if tg_op = 'INSERT' then
    insert into tk_followers (task_id, staff_email, added_by)
    select new.task_id, s.email, nullif(v_me, '')
      from staff s
     where lower(s.email) = lower(new.author_email) and s.active and s.email = lower(s.email)
    on conflict do nothing;
    v_new := new.mentions;
  else
    select coalesce(array_agg(x), '{}') into v_new
      from unnest(new.mentions) x
     where not (x = any (coalesce(old.mentions, '{}')));
  end if;
  -- a mention adds a follower only when the author can edit the task
  if cardinality(v_new) > 0 and public.tk_can_edit_task(new.task_id) then
    insert into tk_followers (task_id, staff_email, added_by)
    select new.task_id, s.email, nullif(v_me, '')
      from staff s
     where s.email = any (v_new) and s.active and s.email = lower(s.email)
    on conflict do nothing;
  end if;
  return null;
end $$;

revoke all on function public.tk_comments_before_write() from public, anon, authenticated;
revoke all on function public.tk_comments_follow() from public, anon, authenticated;
drop trigger if exists tk_comments_before_write on public.tk_comments;
create trigger tk_comments_before_write before insert or update on public.tk_comments
  for each row execute function public.tk_comments_before_write();
drop trigger if exists tk_comments_follow on public.tk_comments;
create trigger tk_comments_follow after insert or update of body on public.tk_comments
  for each row execute function public.tk_comments_follow();

-- tk_activity (written only by the definer trigger)
drop policy if exists "tk activity read" on public.tk_activity;
create policy "tk activity read" on public.tk_activity for select to authenticated
  using (public.tk_can_read_task(task_id));

create or replace function public.tk_staff_reminders_activity()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_actor text := coalesce(nullif(lower(coalesce(auth.jwt() ->> 'email', '')), ''), 'system');
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
    insert into tk_activity (task_id, actor_email, kind, from_value, to_value)
    values (new.id, v_actor,
            case when old.status = 'ready_for_review' and new.status = 'done' then 'review_approved'
                 when old.status = 'ready_for_review' and new.status in ('in_progress', 'todo') then 'review_sent_back'
                 else 'status' end,
            old.status, new.status);
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
end $$;
revoke all on function public.tk_staff_reminders_activity() from public, anon, authenticated;
drop trigger if exists tk_staff_reminders_activity on public.staff_reminders;
create trigger tk_staff_reminders_activity after insert or update on public.staff_reminders
  for each row execute function public.tk_staff_reminders_activity();

-- tk_attachments
drop policy if exists "tk attachments read" on public.tk_attachments;
create policy "tk attachments read" on public.tk_attachments for select to authenticated
  using (public.tk_can_read_task(task_id));
drop policy if exists "tk attachments insert" on public.tk_attachments;
create policy "tk attachments insert" on public.tk_attachments for insert to authenticated
  with check (public.tk_can_edit_task(task_id) and kind in ('link', 'file'));
drop policy if exists "tk attachments update" on public.tk_attachments;
create policy "tk attachments update" on public.tk_attachments for update to authenticated
  using (public.tk_can_edit_task(task_id)
         or (lower(added_by) = lower(coalesce(auth.jwt() ->> 'email', '')) and public.tk_can_read_task(task_id)))   -- fix 1
  with check (public.tk_can_edit_task(task_id)
              or (lower(added_by) = lower(coalesce(auth.jwt() ->> 'email', '')) and public.tk_can_read_task(task_id)));

create or replace function public.tk_attachments_before_write()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_client text;
begin
  if tg_op = 'INSERT' then
    if v_me = '' or not public.is_active_staff() then   -- fix 1: staff only, even on the owner's own task
      raise exception 'tk_forbidden' using errcode = '42501';
    end if;
    new.added_by := nullif(v_me, '');
    new.created_at := now();
    new.removed_at := null;
    new.removed_by := null;
    if new.kind = 'file' then
      select r.client_id into v_client from staff_reminders r where r.id = new.task_id;
      if new.storage_path is null or new.storage_path not like new.task_id::text || '/%'
         or v_client is not null then
        raise exception 'tk_use_drive' using errcode = '22023';   -- client tasks attach from Drive
      end if;
    elsif new.kind = 'drive' then
      if coalesce(current_setting('mgb.tk_rpc', true), '') <> 'on' then
        raise exception 'tk_use_rpc' using errcode = '22023';     -- only tk_attach_client_file adds drive rows
      end if;
    end if;
  else
    new.id := old.id;
    new.task_id := old.task_id;
    new.kind := old.kind;
    new.client_file_id := old.client_file_id;
    new.storage_path := old.storage_path;
    new.url := old.url;
    new.name := old.name;
    new.size := old.size;
    new.mime := old.mime;
    new.added_by := old.added_by;
    new.created_at := old.created_at;
    new.removed_by := case when new.removed_at is not null and old.removed_at is null then nullif(v_me, '')
                           when new.removed_at is null then null
                           else old.removed_by end;
  end if;
  return new;
end $$;
revoke all on function public.tk_attachments_before_write() from public, anon, authenticated;
drop trigger if exists tk_attachments_before_write on public.tk_attachments;
create trigger tk_attachments_before_write before insert or update on public.tk_attachments
  for each row execute function public.tk_attachments_before_write();

create or replace function public.tk_attach_client_file(p_task uuid, p_file uuid)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_f record;
  v_task_client text;
  v_id uuid;
begin
  if not public.tk_can_edit_task(p_task) then
    raise exception 'tk_forbidden' using errcode = '42501';
  end if;
  select f.id, f.client_id, f.name, f.size, f.mime into v_f
    from client_files f where f.id = p_file and f.trashed_at is null;
  if not found then
    raise exception 'tk_forbidden' using errcode = '42501';
  end if;
  select r.client_id into v_task_client from staff_reminders r where r.id = p_task;
  if v_task_client is distinct from v_f.client_id then
    raise exception 'tk_wrong_client' using errcode = '22023';
  end if;
  if not public.can_access_client(v_f.client_id) then
    raise exception 'tk_forbidden' using errcode = '42501';
  end if;
  perform set_config('mgb.tk_rpc', 'on', true);
  insert into tk_attachments (task_id, kind, client_file_id, name, size, mime)
  values (p_task, 'drive', v_f.id, left(v_f.name, 255), v_f.size, v_f.mime)
  returning id into v_id;
  perform set_config('mgb.tk_rpc', '', true);
  return v_id;
end $$;
revoke all on function public.tk_attach_client_file(uuid, uuid) from public, anon;
grant execute on function public.tk_attach_client_file(uuid, uuid) to authenticated;

-- Auto-follow: owner and assignee
create or replace function public.tk_staff_reminders_autofollow()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.deleted_at is not null then
    return null;
  end if;
  insert into tk_followers (task_id, staff_email, added_by)
  select new.id, s.email, nullif(lower(coalesce(auth.jwt() ->> 'email', '')), '')
    from staff s
   where s.active and s.email = lower(s.email)
     and s.email in (lower(new.staff_email), lower(coalesce(new.assignee_email, '')))
  on conflict do nothing;
  return null;
end $$;
revoke all on function public.tk_staff_reminders_autofollow() from public, anon, authenticated;
drop trigger if exists tk_staff_reminders_autofollow on public.staff_reminders;
create trigger tk_staff_reminders_autofollow after insert or update of assignee_email on public.staff_reminders
  for each row execute function public.tk_staff_reminders_autofollow();

create or replace function public.tk_add_follower(p_task uuid, p_email text)
returns boolean
language plpgsql security definer
set search_path = public
as $$
declare
  v_me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_e text := lower(btrim(coalesce(p_email, '')));
  v_n int;
begin
  if not (public.tk_can_edit_task(p_task)
          or (v_e = v_me and v_me <> '' and public.tk_can_read_task(p_task))) then
    raise exception 'tk_forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from staff s where s.email = v_e and s.active)
     or not public.tk_task_scope_ok(p_task, v_e) then
    raise exception 'tk_follower_no_access' using errcode = '42501';
  end if;
  insert into tk_followers (task_id, staff_email, added_by)
  values (p_task, v_e, nullif(v_me, ''))
  on conflict do nothing;
  get diagnostics v_n = row_count;
  return v_n > 0;
end $$;
revoke all on function public.tk_add_follower(uuid, text) from public, anon;
grant execute on function public.tk_add_follower(uuid, text) to authenticated;


-- D7. Backfill (after D8 so tk_followers exists) -----------------------
do $$
begin
  perform set_config('mgb.tk_migrate', 'on', true);
  update public.staff_reminders set status = 'done' where done and status <> 'done';
  update public.staff_reminders set assignee_email = lower(assignee_email)
   where assignee_email <> lower(assignee_email);
  insert into public.tk_followers (task_id, staff_email, added_by)
  select r.id, s.email, null
    from public.staff_reminders r
    join public.staff s
      on s.active and s.email = lower(s.email)
     and lower(s.email) in (lower(r.staff_email), lower(coalesce(r.assignee_email, '')))
  on conflict do nothing;
  perform set_config('mgb.tk_migrate', '', true);
end $$;


-- D9. New policies on existing tables, and the soft-delete trigger ------
drop policy if exists "tk read tasks" on public.staff_reminders;
create policy "tk read tasks" on public.staff_reminders for select to authenticated
  using (public.tk_row_readable(id, staff_email, assignee_email, client_id, project_id, visibility));
drop policy if exists "tk edit tasks" on public.staff_reminders;
create policy "tk edit tasks" on public.staff_reminders for update to authenticated
  using (public.tk_can_edit_task(id)) with check (public.tk_can_edit_task(id));
drop policy if exists "tk edit checklist" on public.task_checklist_items;
create policy "tk edit checklist" on public.task_checklist_items for all to authenticated
  using (public.tk_can_edit_task(reminder_id)) with check (public.tk_can_edit_task(reminder_id));

create or replace function public.tk_staff_reminders_soft_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(auth.jwt() ->> 'email','') = ''                                  -- service role, cron, SQL editor
     or coalesce(current_setting('mgb.tk_hard_delete', true),'') = 'on' then   -- deliberate hard delete
    return old;
  end if;
  update public.staff_reminders set deleted_at = coalesce(deleted_at, now()) where id = old.id;
  return null;                                                                 -- skip the delete; children stay
end $$;
revoke all on function public.tk_staff_reminders_soft_delete() from public, anon, authenticated;
drop trigger if exists tk_staff_reminders_soft_delete on public.staff_reminders;
create trigger tk_staff_reminders_soft_delete before delete on public.staff_reminders
  for each row execute function public.tk_staff_reminders_soft_delete();


-- D10. RPCs --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_staff_item(p_id uuid, p_done boolean, p_today date DEFAULT NULL::date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_caller text := coalesce(auth.jwt() ->> 'email', '');
  v_row staff_reminders%rowtype;
  v_today date := coalesce(p_today, current_date);
  v_base date;
  v_next date;
  v_days int;
  v_due_at timestamptz;
  v_remind_at timestamptz;
  v_new_id uuid;
  i int := 0;
  v_status text;   -- tk v1
begin
  if v_caller = '' then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select * into v_row from staff_reminders where id = p_id for update;
  if not found or v_row.deleted_at is not null or not public.tk_can_edit_task(p_id) then   -- tk v1: one edit rule (D5); a deleted series stays deleted
    raise exception 'item not found' using errcode = '42501';   -- tk v1: live message, errcode 42501
  end if;

  if not p_done or coalesce(v_row.recurrence, 'none') = 'none' or v_row.done then
    update staff_reminders
      set done = p_done,
          completed_at = case when p_done then coalesce(completed_at, now()) else null end,
          series_id = coalesce(series_id, id)   -- tk v1
      where id = p_id;
    return null;
  end if;

  -- tk v1: complete first; the D6 trigger maps status and may divert to review
  update staff_reminders
    set done = true, completed_at = now(), series_id = coalesce(series_id, id)   -- tk v1
    where id = p_id
    returning status into v_status;   -- tk v1
  if v_status is distinct from 'done' then   -- tk v1: sent for review; roll forward on approval
    return null;   -- tk v1
  end if;   -- tk v1
  update staff_reminders set recurrence = 'none' where id = p_id;   -- tk v1

  v_base := coalesce(v_row.due_date, v_today);
  v_next := v_base;
  loop
    v_next := case v_row.recurrence
      when 'daily' then v_next + 1
      when 'weekly' then v_next + 7
      when 'monthly' then
        (date_trunc('month', v_next) + interval '1 month')::date
          + least(
              extract(day from v_next)::int,
              extract(day from (date_trunc('month', v_next) + interval '2 month' - interval '1 day'))::int
            ) - 1
      when 'month_end' then
        (date_trunc('month', v_next) + interval '2 month' - interval '1 day')::date
      else null
    end;
    exit when v_next is null or v_next >= v_today;
    i := i + 1;
    exit when i >= 400;
  end loop;

  if v_next is null then
    return null;
  end if;

  v_days := v_next - v_base;

  if v_row.due_at is null then
    v_due_at := v_next::timestamp at time zone 'UTC';
  elsif v_row.due_date is not null
        and v_row.due_at = (v_row.due_date::timestamp at time zone 'UTC') then
    v_due_at := v_next::timestamp at time zone 'UTC';
  else
    v_due_at := v_row.due_at + make_interval(days => v_days);
  end if;

  v_remind_at := case when v_row.remind_at is null then null
                      else v_row.remind_at + make_interval(days => v_days) end;

  perform set_config('mgb.tk_rollforward', 'on', true);   -- tk v1
  insert into staff_reminders (
    staff_email, text, due_date, due_at, remind_at, client_id, priority,
    kind, recurrence, assignee_email, created_by, visibility, source, source_ref,
    description, section, project_id, sop_section, review_required, parent_id, sort_key,   -- tk v1
    series_id, status, done, start_on   -- tk v1
  ) values (
    v_row.staff_email, v_row.text, v_next, v_due_at, v_remind_at,
    v_row.client_id, v_row.priority, v_row.kind, v_row.recurrence,
    coalesce(v_row.assignee_email, v_row.staff_email),
    coalesce(v_row.created_by, v_row.staff_email),
    v_row.visibility, v_row.source,
    case when v_row.source = 'template' then null else v_row.source_ref end,   -- tk v1
    v_row.description, v_row.section, v_row.project_id, v_row.sop_section,   -- tk v1
    v_row.review_required, v_row.parent_id, v_row.sort_key,   -- tk v1
    coalesce(v_row.series_id, v_row.id), 'todo', false,   -- tk v1
    case when v_row.start_on is not null and v_row.due_date is not null
         then v_row.start_on + v_days end   -- tk v1
  )
  returning id into v_new_id;
  perform set_config('mgb.tk_rollforward', '', true);   -- tk v1

  -- tk v1: copy the checklist, unchecked
  insert into task_checklist_items (reminder_id, text, done, sort_order, created_by)
  select v_new_id, c.text, false, c.sort_order, c.created_by
    from task_checklist_items c
   where c.reminder_id = p_id;

  -- tk v1: copy the followers (active, lowercase staff rows only)
  insert into tk_followers (task_id, staff_email, added_by)
  select v_new_id, s.email, f.added_by
    from tk_followers f
    join staff s on s.email = f.staff_email and s.active and s.email = lower(s.email)
   where f.task_id = p_id
  on conflict do nothing;

  return v_new_id;
end;
$function$;
revoke all on function public.complete_staff_item(uuid, boolean, date) from public, anon;
grant execute on function public.complete_staff_item(uuid, boolean, date) to authenticated;

-- p_today: the caller's local date, passed to complete_staff_item for the roll-forward catch-up
create or replace function public.tk_set_status(p_id uuid, p_status text, p_note text default null, p_today date default null)
returns text
language plpgsql security definer
set search_path = public
as $$
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
  if p_status = 'done' then
    perform public.complete_staff_item(p_id, true, p_today);   -- the review gate may divert it
  elsif v_from = 'done' and p_status = 'todo' then
    perform public.complete_staff_item(p_id, false, p_today);
  else
    update staff_reminders set status = p_status where id = p_id;
  end if;
  if btrim(coalesce(p_note, '')) <> '' then
    perform set_config('mgb.tk_rpc', 'on', true);
    insert into tk_comments (task_id, author_email, body, kind)
    values (p_id, '', p_note,
            case when v_from = 'ready_for_review' and p_status in ('in_progress', 'todo') then 'send_back' else 'system' end);
    perform set_config('mgb.tk_rpc', '', true);
  end if;
  select r.status into v_out from staff_reminders r where r.id = p_id;
  return v_out;
end $$;
revoke all on function public.tk_set_status(uuid, text, text, date) from public, anon;
grant execute on function public.tk_set_status(uuid, text, text, date) to authenticated;

-- Definer on purpose: @@ is not leakproof, so under invoker RLS the planner
-- could not use staff_reminders_tk_search_idx. Access is filtered explicitly.
create or replace function public.tk_search(q text, p_limit int default 20)
returns table(task_id uuid, task_text text, client_id text, project_id uuid, status text,
              due_date date, match text, snippet text, rank real)
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_q tsquery;
begin
  if not public.is_active_staff() then
    return;
  end if;
  if q is null or btrim(q) = '' or char_length(q) > 200 then
    return;
  end if;
  v_q := websearch_to_tsquery('english', q);
  return query
  with hits as (
    select r.id as h_id, r."text" as h_text, r.client_id as h_client, r.project_id as h_project,
           r.status as h_status, r.due_date as h_due, 'task'::text as h_match,
           left(coalesce(r.description, ''), 140) as h_snippet, ts_rank(r.search_tsv, v_q) as h_rank
      from staff_reminders r
     where r.deleted_at is null
       and r.search_tsv @@ v_q
       and public.tk_row_readable(r.id, r.staff_email, r.assignee_email, r.client_id, r.project_id, r.visibility)
    union all
    select r.id, r."text", r.client_id, r.project_id, r.status, r.due_date, 'comment'::text,
           left(c.body, 140), ts_rank(c.tsv, v_q)
      from tk_comments c
      join staff_reminders r on r.id = c.task_id
     where c.deleted_at is null
       and r.deleted_at is null
       and c.tsv @@ v_q
       and public.tk_row_readable(r.id, r.staff_email, r.assignee_email, r.client_id, r.project_id, r.visibility)
  ),
  best as (
    select distinct on (h.h_id) h.* from hits h order by h.h_id, h.h_rank desc
  )
  select b.h_id, b.h_text, b.h_client, b.h_project, b.h_status, b.h_due, b.h_match, b.h_snippet, b.h_rank
    from best b
   order by b.h_rank desc, b.h_due nulls last
   limit least(greatest(coalesce(p_limit, 20), 1), 50);
end $$;
revoke all on function public.tk_search(text, int) from public, anon;
grant execute on function public.tk_search(text, int) to authenticated;

create or replace function public.tk_client_people(p_client text)
returns table(role text, email text, name text)
language sql stable security definer
set search_path = public
as $$
  select x.r, s.email, s.name
    from (values
      (1, 'bookkeeper', (select c.assigned_bookkeeper_email from clients c where c.id = p_client)),
      (2, 'backup', (select cp.backup_bookkeeper_email from client_profile cp where cp.client_id = p_client)),
      (3, 'account_manager', (select c.account_manager_email from clients c where c.id = p_client))
    ) x(ord, r, em)
    join staff s on lower(s.email) = lower(x.em) and s.active
   where x.em is not null
     and public.is_active_staff()
     and public.can_access_client(p_client)
   order by x.ord;
$$;
revoke all on function public.tk_client_people(text) from public, anon;
grant execute on function public.tk_client_people(text) to authenticated;

create or replace function public.tk_assignable_staff(p_client text default null, p_project uuid default null)
returns table(email text, name text, role text, can_see boolean)
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_scope_client text := p_client;
  v_open boolean := false;
begin
  if not public.is_active_staff() then
    return;
  end if;
  if p_client is not null and not public.can_access_client(p_client) then
    return;
  end if;
  if p_project is not null and not public.tk_can_see_project(p_project) then
    return;
  end if;
  if p_client is null and p_project is not null then
    -- an onboarding project's tasks take the project's client
    select p.client_id, p.open_to_staff into v_scope_client, v_open from tk_projects p where p.id = p_project;
  end if;
  return query
  select s.email, s.name, s.role,
         case when v_scope_client is not null then public.tk_staff_has_client(s.email, v_scope_client)
              when p_project is not null then
                s.role = 'admin' or coalesce(v_open, false)
                or exists (select 1 from tk_project_members m
                            where m.project_id = p_project and m.staff_email = lower(s.email))
              else true end
    from staff s
   where s.active
   order by s.name;
end $$;
revoke all on function public.tk_assignable_staff(text, uuid) from public, anon;
grant execute on function public.tk_assignable_staff(text, uuid) to authenticated;


-- D11. View tk_tasks ---------------------------------------------------
create or replace view public.tk_tasks with (security_invoker = true) as
  select * from public.staff_reminders where deleted_at is null;
revoke all on public.tk_tasks from anon, authenticated;
grant select on public.tk_tasks to authenticated;


-- D12. Storage ---------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('task-files', 'task-files', false, 26214400, array[
  'application/pdf','image/png','image/jpeg','image/gif','image/webp','text/csv','text/plain',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do update set public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.tk_can_upload_task_file(p_name text)
returns boolean
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_id uuid := public.tk_path_task_id(p_name);
begin
  if v_id is null or not public.tk_can_edit_task(v_id) then
    return false;
  end if;
  -- client tasks attach from the client's Drive instead (tk_attach_client_file)
  return exists (select 1 from staff_reminders r
                  where r.id = v_id and r.client_id is null and r.deleted_at is null);
end $$;
revoke all on function public.tk_can_upload_task_file(text) from public, anon;
grant execute on function public.tk_can_upload_task_file(text) to authenticated;

drop policy if exists "tk task files read" on storage.objects;
create policy "tk task files read" on storage.objects for select to authenticated
  using (bucket_id = 'task-files' and public.tk_can_read_task(public.tk_path_task_id(name)));
drop policy if exists "tk task files insert" on storage.objects;
create policy "tk task files insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'task-files' and public.tk_can_upload_task_file(name));
-- No update or delete policy: files stay, only the attachment row is soft-removed.


-- D13. Server-side readers: deleted and waiting tasks -------------------
CREATE OR REPLACE FUNCTION public.client_health(p_default_fees jsonb DEFAULT '{}'::jsonb)
 RETURNS TABLE(client_id text, score integer, band text, reasons jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
declare
  v_admin boolean := public.is_active_staff_admin();
  v_close jsonb := '{}'::jsonb;
  v_margin jsonb := '{}'::jsonb;
  v_target numeric;
  v_late_day int;
  v_period date;
begin
  if not public.is_active_staff() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  if to_regclass('public.month_close') is not null then
    begin
      if to_regclass('public.month_close_settings') is not null then
        execute 'select late_day from public.month_close_settings limit 1' into v_late_day;
      end if;
      v_late_day := coalesce(v_late_day, 15);
      v_period := (date_trunc('month', current_date)
                   - case when extract(day from current_date) > v_late_day
                          then interval '1 month' else interval '2 months' end)::date;
      execute $q$
        select coalesce(jsonb_object_agg(c.id, jsonb_build_object(
                 'period', $1, 'status', coalesce(m.status, 'not_started'))), '{}'::jsonb)
          from public.clients c
          left join public.month_close m on m.client_id = c.id and m.period_kind = 'month' and m.period = $1
         where coalesce(m.status, 'not_started') not in ('done', 'na')
           and c.created_at < ($1 + interval '1 month')
      $q$ into v_close using v_period;
    exception when others then
      v_close := '{}'::jsonb;
    end;
  end if;

  if v_admin then
    begin
      select target_margin_pct into v_target from profitability_settings limit 1;
      select coalesce(jsonb_object_agg(p.client_id, p.margin_pct), '{}'::jsonb) into v_margin
        from public.client_profitability(current_date - 90, current_date, coalesce(p_default_fees, '{}'::jsonb)) p
       where p.margin_pct is not null;
    exception when others then
      v_margin := '{}'::jsonb;
    end;
  end if;

  return query
  with c as (
    select cl.id from clients cl where public.can_access_client(cl.id)
  ),
  overdue as (
    select r.client_id, count(*)::int n
      from staff_reminders r
     where r.done = false and r.client_id is not null
       and r.due_date is not null and r.due_date < current_date
       and r.deleted_at is null and r.status <> 'waiting_client'   -- tk v1
     group by r.client_id
  ),
  app_time as (
    select t.client_id, sum(t.seconds) s
      from staff_app_time t
     where t.day >= current_date - 30
     group by t.client_id
  ),
  qbo_time as (
    select res.client_id, sum(a.minutes) m
      from qbo_time_activities a
      join qbo_customer_resolution res
        on res.realm_id = a.realm_id and res.qbo_customer_id = a.customer_qbo_id
     where a.txn_date >= current_date - 30 and res.client_id is not null
     group by res.client_id
  ),
  docs as (
    select d.client_id, count(*)::int n
      from client_doc_requests d
     where d.status = 'open' and d.due_date is not null and d.due_date < current_date
     group by d.client_id
  ),
  msgs as (
    select m.client_id, lower(m.participant_email) pe, m.author_kind, m.created_at
      from client_messages m
     where m.deleted_at is null and coalesce(m.internal, false) = false
  ),
  waiting as (
    select w.client_id, max(w.hours) hours
      from (
        select t.client_id,
               extract(epoch from (now() - min(t.created_at))) / 3600.0 hours
          from msgs t
         where t.author_kind = 'client'
           and t.created_at > coalesce((select max(s2.created_at) from msgs s2
                                         where s2.client_id = t.client_id and s2.pe = t.pe
                                           and s2.author_kind = 'staff'), '-infinity'::timestamptz)
         group by t.client_id, t.pe
      ) w
     group by w.client_id
  ),
  month_hours as (
    select res.client_id, sum(a.minutes) / 60.0 h
      from qbo_time_activities a
      join qbo_customer_resolution res
        on res.realm_id = a.realm_id and res.qbo_customer_id = a.customer_qbo_id
     where v_admin and a.txn_date >= date_trunc('month', current_date)::date
       and res.client_id is not null
     group by res.client_id
  ),
  sops as (
    select * from public.client_sop_status()
  ),
  factors as (
    select c.id,
      case when coalesce(o.n, 0) > 0 then jsonb_build_object(
        'key', 'overdue', 'points', least(30, o.n * 10),
        'label', o.n || ' overdue task' || case when o.n = 1 then '' else 's' end) end f1,
      case
        when q.client_id is null then jsonb_build_object('key', 'qbo', 'points', 25, 'label', 'QuickBooks not connected')
        when q.last_error is not null and q.last_error <> '' then
          jsonb_build_object('key', 'qbo', 'points', 25, 'label', 'QuickBooks connection error')
        when coalesce(q.status, '') <> 'connected' then
          jsonb_build_object('key', 'qbo', 'points', 25, 'label', 'QuickBooks ' || coalesce(q.status, 'not connected'))
        when q.last_synced_at is null or q.last_synced_at < now() - interval '3 days' then
          jsonb_build_object('key', 'qbo_stale', 'points', 10, 'label',
            'QuickBooks last synced ' || coalesce(
              (current_date - q.last_synced_at::date) || ' days ago', 'never'))
      end f2,
      case when coalesce(apt.s, 0) = 0 and coalesce(qt.m, 0) = 0 then
        jsonb_build_object('key', 'inactive', 'points', 20, 'label', 'No staff time logged in 30 days') end f3,
      case when v_close ? c.id then jsonb_build_object('key', 'close_late', 'points', 20, 'label',
        to_char((v_close -> c.id ->> 'period')::date, 'FMMonth YYYY') || ' close is late ('
          || replace(v_close -> c.id ->> 'status', '_', ' ') || ')') end f4,
      case when v_admin and v_target is not null and v_margin ? c.id
                and (v_margin ->> c.id)::numeric < v_target then
        jsonb_build_object('key', 'margin', 'points', 15, 'label',
          'Margin ' || round((v_margin ->> c.id)::numeric) || '% (target ' || round(v_target) || '%)') end f5,
      case when coalesce(dq.n, 0) > 0 then jsonb_build_object(
        'key', 'doc_overdue', 'points', least(15, dq.n * 5),
        'label', dq.n || ' overdue document request' || case when dq.n = 1 then '' else 's' end) end f6,
      case when wt.hours > 24 then jsonb_build_object('key', 'client_wait', 'points', 10, 'label',
        'Client waiting on a reply for ' || case when wt.hours >= 48 then floor(wt.hours / 24) || ' days'
                                                 else floor(wt.hours) || ' hours' end) end f7,
      case when v_admin and cp.monthly_hours_budget is not null and coalesce(mh.h, 0) > cp.monthly_hours_budget then
        jsonb_build_object('key', 'hours_over', 'points', 10, 'label',
          'Over hours budget (' || round(mh.h, 1) || ' of ' || round(cp.monthly_hours_budget, 1) || ' h this month)') end f8,
      case
        when sp.client_id is null or sp.filled * 2 < sp.total then
          jsonb_build_object('key', 'sop', 'points', 5, 'label',
            case when coalesce(sp.filled, 0) = 0 then 'No SOP written yet'
                 else 'SOP only ' || sp.filled || ' of ' || sp.total || ' sections filled' end)
        when sp.last_touched < now() - interval '180 days' then
          jsonb_build_object('key', 'sop', 'points', 5, 'label',
            'SOP not reviewed in ' || (current_date - sp.last_touched::date) || ' days')
      end f9
    from c
    left join overdue o on o.client_id = c.id
    left join qbo_connections q on q.client_id = c.id
    left join app_time apt on apt.client_id = c.id
    left join qbo_time qt on qt.client_id = c.id
    left join docs dq on dq.client_id = c.id
    left join waiting wt on wt.client_id = c.id
    left join month_hours mh on mh.client_id = c.id
    left join client_profile cp on cp.client_id = c.id
    left join sops sp on sp.client_id = c.id
  ),
  scored as (
    select f.id,
      coalesce((select jsonb_agg(x) from unnest(array[f.f1, f.f2, f.f3, f.f4, f.f5, f.f6, f.f7, f.f8, f.f9]) x where x is not null),
               '[]'::jsonb) rs
    from factors f
  )
  select z.id, z.sc,
         case when z.sc >= 80 then 'green' when z.sc >= 50 then 'amber' else 'red' end,
         z.rs
    from (
      select s.id, s.rs,
             least(100, greatest(0, 100 - coalesce((select sum((e ->> 'points')::int)
                                          from jsonb_array_elements(s.rs) e), 0)))::int sc
        from scored s
    ) z;
end;
$function$;

CREATE OR REPLACE FUNCTION public.digest_weekly_data(p_week_start date, p_today date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  ws date := p_week_start;
  we date := p_week_start + 6;
  w4_from date := p_week_start - 21;
  base_from date := p_week_start - 21 - 91;
  base_to date := p_week_start - 22;
  pr_from date := we - 89;
  pr_months numeric := 90 / 30.44;
  v_target numeric;
  v_avg_rate numeric;
  v_firm record;
  v_caps jsonb := '{}'::jsonb;
  v_has_caps boolean := false;
  v_out jsonb := '{}'::jsonb;
begin
  if p_week_start is null or p_today is null then
    raise exception 'digest_weekly_data: bad arguments';
  end if;

  select * into v_firm from qbo_firm_connection where id = true;
  select coalesce(target_margin_pct, 40) into v_target from profitability_settings where id = true;
  v_target := coalesce(v_target, 40);
  select avg(r.hourly_cost) into v_avg_rate from (
    select distinct on (staff_email) hourly_cost from staff_cost_rates
    where effective_from <= we order by staff_email, effective_from desc) r;

  if to_regclass('public.staff_capacity') is not null then
    begin
      execute 'select coalesce(jsonb_object_agg(lower(staff_email), weekly_target_hours), ''{}''::jsonb)
               from public.staff_capacity where weekly_target_hours is not null'
        into v_caps;
      v_has_caps := true;
    exception when others then
      v_caps := '{}'::jsonb;
    end;
  end if;

  v_out := jsonb_build_object(
    'week_start', ws, 'week_end', we, 'today', p_today,
    'target_margin_pct', v_target,
    'firm_qbo', jsonb_build_object(
      'status', coalesce(v_firm.status, 'disconnected'),
      'company_name', v_firm.company_name,
      'last_synced_at', v_firm.last_synced_at,
      'last_error', v_firm.last_error),
    'has_capacity_table', v_has_caps
  );

  create temp table if not exists _dg_client_time (client_id text, txn_date date, minutes int) on commit drop;
  truncate _dg_client_time;
  insert into _dg_client_time
  select r.client_id, a.txn_date, a.minutes
  from qbo_time_activities a
  join qbo_customer_resolution r
    on r.realm_id = a.realm_id and r.qbo_customer_id = a.customer_qbo_id
  join clients c on c.id = r.client_id and coalesce(c.test_only, false) = false
  where a.txn_date >= least(base_from, pr_from, p_today - 30);

  v_out := v_out || jsonb_build_object('scope_creep', coalesce((
    select jsonb_agg(x order by x.ratio desc) from (
      select c.id as client_id, c.name as client_name,
             round(coalesce(s.week_min, 0) / 60.0, 1) as week_hours,
             round(s.base_min / 13.0 / 60.0, 1) as base_week_hours,
             round(coalesce(s.w4_min, 0) * 30.44 / 28 / 60.0, 1) as pace_month_hours,
             round(s.base_min * 30.44 / 91 / 60.0, 1) as base_month_hours,
             (coalesce(s.week_min, 0) >= s.base_min / 13.0 * 1.5 and coalesce(s.week_min, 0) - s.base_min / 13.0 >= 120) as week_flag,
             (coalesce(s.w4_min, 0) * 30.44 / 28 >= s.base_min * 30.44 / 91 * 1.5
               and coalesce(s.w4_min, 0) * 30.44 / 28 - s.base_min * 30.44 / 91 >= 120) as month_flag,
             round(greatest(coalesce(s.week_min, 0) / (s.base_min / 13.0),
                            (coalesce(s.w4_min, 0) / 28.0) / (s.base_min / 91.0)), 2) as ratio
      from (
        select client_id,
               sum(minutes) filter (where txn_date between ws and we) as week_min,
               sum(minutes) filter (where txn_date between w4_from and we) as w4_min,
               sum(minutes) filter (where txn_date between base_from and base_to) as base_min
        from _dg_client_time group by client_id
      ) s
      join clients c on c.id = s.client_id
      where s.base_min > 0
        and ((coalesce(s.week_min, 0) >= s.base_min / 13.0 * 1.5 and coalesce(s.week_min, 0) - s.base_min / 13.0 >= 120)
          or (coalesce(s.w4_min, 0) * 30.44 / 28 >= s.base_min * 30.44 / 91 * 1.5
              and coalesce(s.w4_min, 0) * 30.44 / 28 - s.base_min * 30.44 / 91 >= 120))
    ) x), '[]'::jsonb));

  v_out := v_out || jsonb_build_object('price_review', coalesce((
    select jsonb_agg(x order by x.margin_pct asc) from (
      select c.id as client_id, c.name as client_name, f.monthly_fee,
             round(k.cost / pr_months, 2) as monthly_cost,
             round(k.minutes / 60.0 / pr_months, 1) as monthly_hours,
             round((f.monthly_fee * pr_months - k.cost) / nullif(f.monthly_fee * pr_months, 0) * 100, 1) as margin_pct,
             round(k.cost / pr_months / (1 - v_target / 100.0), 0) as suggested_fee,
             k.estimated
      from client_fees f
      join clients c on c.id = f.client_id and coalesce(c.test_only, false) = false
      join lateral (
        select sum(a.minutes) as minutes,
               sum(a.minutes / 60.0 * coalesce(
                 (select sc.hourly_cost from staff_cost_rates sc
                   where sc.staff_email = lower(p.staff_email) and sc.effective_from <= a.txn_date
                   order by sc.effective_from desc limit 1), v_avg_rate)) as cost,
               bool_or(p.staff_email is null or not exists (
                 select 1 from staff_cost_rates sc
                  where sc.staff_email = lower(p.staff_email) and sc.effective_from <= a.txn_date)) as estimated
        from qbo_time_activities a
        join qbo_customer_resolution r
          on r.realm_id = a.realm_id and r.qbo_customer_id = a.customer_qbo_id
        left join qbo_employee_staff_map p
          on p.realm_id = a.realm_id
         and p.qbo_entity_type = case when a.employee_qbo_id is not null then 'Employee' else 'Vendor' end
         and p.qbo_id = coalesce(a.employee_qbo_id, a.vendor_qbo_id)
        where r.client_id = c.id and a.txn_date between pr_from and we
      ) k on k.cost is not null and k.minutes > 0
      where v_target < 100
        and f.monthly_fee * pr_months > 0
        and (f.monthly_fee * pr_months - k.cost) / (f.monthly_fee * pr_months) * 100 < v_target
    ) x), '[]'::jsonb),
    'price_review_no_fee_count', (
      select count(*) from clients c
      where coalesce(c.test_only, false) = false
        and not exists (select 1 from client_fees f where f.client_id = c.id)),
    'price_review_has_rates', exists (select 1 from staff_cost_rates));

  v_out := v_out || jsonb_build_object('revenue', (
    select jsonb_build_object(
      'mrr', coalesce(sum(f.monthly_fee), 0),
      'active_clients', count(*),
      'clients_with_fee', count(f.client_id),
      'projection_3m', coalesce(sum(f.monthly_fee), 0) * 3,
      'added', coalesce(jsonb_agg(jsonb_build_object('client_id', c.id, 'client_name', c.name,
                                                     'created_at', c.created_at))
                        filter (where c.created_at >= now() - interval '7 days'), '[]'::jsonb))
    from clients c
    left join client_fees f on f.client_id = c.id
    where coalesce(c.test_only, false) = false));

  v_out := v_out || jsonb_build_object('late_payers', coalesce((
    select jsonb_agg(x order by x.days_overdue desc, x.balance desc) from (
      select i.doc_number, i.customer_name, i.txn_date, i.due_date, i.total_amt, i.balance,
             (p_today - i.due_date) as days_overdue,
             r.client_id, c.name as client_name
      from qbo_firm_invoices i
      left join qbo_customer_resolution r
        on r.realm_id = i.realm_id and r.qbo_customer_id = i.customer_qbo_id
      left join clients c on c.id = r.client_id
      where i.balance > 0 and i.due_date < p_today
        and coalesce(c.test_only, false) = false
        and not coalesce(r.ignored, false)
    ) x), '[]'::jsonb),
    'open_invoice_count', (select count(*) from qbo_firm_invoices where balance > 0),
    'invoices_synced_at', (select max(synced_at) from qbo_firm_invoices));

  create temp table if not exists _dg_staff_qbo (email text, d date, minutes int) on commit drop;
  truncate _dg_staff_qbo;
  insert into _dg_staff_qbo
  select lower(p.staff_email), a.txn_date, sum(a.minutes)
  from qbo_time_activities a
  join qbo_employee_staff_map p
    on p.realm_id = a.realm_id
   and p.qbo_entity_type = case when a.employee_qbo_id is not null then 'Employee' else 'Vendor' end
   and p.qbo_id = coalesce(a.employee_qbo_id, a.vendor_qbo_id)
  where a.txn_date between ws and we and p.staff_email is not null
  group by 1, 2;

  create temp table if not exists _dg_staff_app (email text, d date, seconds int) on commit drop;
  truncate _dg_staff_app;
  insert into _dg_staff_app
  select lower(staff_email), day, sum(seconds)
  from staff_app_time where day between ws and we
  group by 1, 2;

  v_out := v_out || jsonb_build_object('timesheet_gaps', coalesce((
    select jsonb_agg(x order by x.staff_name) from (
      select s.email as staff_email, coalesce(s.name, s.email) as staff_name,
             coalesce((select jsonb_agg(d.d::date order by d.d)
                       from generate_series(ws, ws + 4, interval '1 day') d(d)
                       where not exists (select 1 from _dg_staff_qbo q
                                         where q.email = lower(s.email) and q.d = d.d::date and q.minutes > 0)),
                      '[]'::jsonb) as no_qbo_weekdays,
             coalesce((select jsonb_agg(jsonb_build_object('day', a.d, 'app_minutes', round(a.seconds / 60.0)) order by a.d)
                       from _dg_staff_app a
                       where a.email = lower(s.email) and a.seconds >= 300
                         and not exists (select 1 from _dg_staff_qbo q
                                         where q.email = a.email and q.d = a.d and q.minutes > 0)),
                      '[]'::jsonb) as app_without_qbo
      from staff s
      where s.active
    ) x
    where jsonb_array_length(x.no_qbo_weekdays) > 0 or jsonb_array_length(x.app_without_qbo) > 0
  ), '[]'::jsonb));

  v_out := v_out || jsonb_build_object('scorecard', coalesce((
    select jsonb_agg(x order by x.staff_name) from (
      select s.email as staff_email, coalesce(s.name, s.email) as staff_name, s.role,
             round(coalesce((select sum(minutes) from _dg_staff_qbo q where q.email = lower(s.email)), 0) / 60.0, 1) as qbo_hours,
             coalesce((v_caps ->> lower(s.email))::numeric, 35) as target_hours,
             (v_caps ? lower(s.email)) as target_set,
             round(coalesce((select sum(seconds) from _dg_staff_app a where a.email = lower(s.email)), 0) / 3600.0, 1) as app_hours,
             (select count(*) from staff_reminders t
               where lower(coalesce(t.assignee_email, t.staff_email)) = lower(s.email)
                 and t.done and (t.completed_at at time zone 'America/New_York')::date between ws and we
                 and t.deleted_at is null) as tasks_done,   -- tk v1
             (select count(*) from staff_reminders t
               where lower(coalesce(t.assignee_email, t.staff_email)) = lower(s.email)
                 and not t.done
                 and t.deleted_at is null) as tasks_open,   -- tk v1
             (select count(*) from staff_reminders t
               where lower(coalesce(t.assignee_email, t.staff_email)) = lower(s.email)
                 and not t.done
                 and coalesce(t.due_date, (t.due_at at time zone 'America/New_York')::date) < p_today
                 and t.deleted_at is null and t.status <> 'waiting_client') as tasks_overdue   -- tk v1
      from staff s
      where s.active
    ) x), '[]'::jsonb));

  v_out := v_out || jsonb_build_object('stale_clients', coalesce((
    select jsonb_agg(x order by x.client_name) from (
      select c.id as client_id, c.name as client_name,
             (select max(day) from staff_app_time a where a.client_id = c.id) as last_app_day,
             (select max(txn_date) from _dg_client_time t where t.client_id = c.id) as last_qbo_day
      from clients c
      where coalesce(c.test_only, false) = false
        and not exists (select 1 from staff_app_time a where a.client_id = c.id and a.day >= p_today - 30 and a.seconds > 0)
        and not exists (select 1 from _dg_client_time t where t.client_id = c.id and t.txn_date >= p_today - 30 and t.minutes > 0)
    ) x), '[]'::jsonb),
    'qbo_errors', coalesce((
      select jsonb_agg(jsonb_build_object('client_id', c.id, 'client_name', c.name,
                                          'last_error', q.last_error, 'last_synced_at', q.last_synced_at)
                       order by c.name)
      from qbo_connections q
      join clients c on c.id = q.client_id and coalesce(c.test_only, false) = false
      where q.status = 'error'), '[]'::jsonb));

  v_out := v_out || jsonb_build_object('pending', jsonb_build_object(
    'access_requests', coalesce((
      select jsonb_agg(jsonb_build_object('staff_name', coalesce(g.staff_name, g.staff_email),
                                          'client_name', c.name, 'requested_at', g.requested_at,
                                          'reason', left(g.reason, 140))
                       order by g.requested_at)
      from staff_client_access_grants g
      join clients c on c.id = g.client_id and coalesce(c.test_only, false) = false
      where g.status = 'pending'), '[]'::jsonb),
    'unmapped_customers', (
      select count(distinct (r.realm_id, r.qbo_customer_id))
      from qbo_customer_resolution r
      join qbo_time_activities t on t.realm_id = r.realm_id and t.customer_qbo_id = r.qbo_customer_id
      where r.client_id is null and not r.ignored),
    'unmapped_people', (
      select count(*) from qbo_employee_staff_map p
      where p.staff_email is null and not p.ignored
        and exists (
          select 1 from qbo_time_activities t
          where t.realm_id = p.realm_id
            and coalesce(t.employee_qbo_id, t.vendor_qbo_id) = p.qbo_id
            and p.qbo_entity_type = case when t.employee_qbo_id is not null then 'Employee' else 'Vendor' end))
  ));

  v_out := v_out || jsonb_build_object('staff_feedback', jsonb_build_object(
    'new_total', (select count(*) from staff_feedback where status = 'new'),
    'new_by_kind', coalesce((
      select jsonb_object_agg(k.kind, k.n)
      from (select kind, count(*) as n from staff_feedback where status = 'new' group by kind) k), '{}'::jsonb),
    'last_7_days', (select count(*) from staff_feedback where created_at >= now() - interval '7 days'),
    'newest', coalesce((
      select jsonb_agg(x order by x.created_at desc) from (
        select f.id, f.kind, f.author_email, s.name as author_name, f.created_at, f.page,
               left(regexp_replace(btrim(f.message), '\s+', ' ', 'g'), 200) as message
        from staff_feedback f
        left join lateral (
          select st.name from staff st where lower(st.email) = lower(f.author_email) limit 1) s on true
        where f.status = 'new'
        order by f.created_at desc
        limit 5
      ) x), '[]'::jsonb)
  ));

  return v_out;
end;
$function$;

CREATE OR REPLACE FUNCTION public.staff_performance(p_days integer DEFAULT 30, p_weights jsonb DEFAULT NULL::jsonb)
 RETURNS TABLE(email text, name text, role text, clients integer, reply_pct numeric, replies integer, close_pct numeric, close_done integer, close_total integer, health_pct numeric, health_red integer, health_n integer, tasks_pct numeric, tasks_done integer, tasks_overdue integer, deadlines_on_time integer, deadlines_total integer, hours_pct numeric, hours numeric, capacity_hours numeric, review_pct numeric, review_label text, score numeric, rank integer, weights jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
declare
  v_me text := lower(auth.jwt() ->> 'email');
  v_adm boolean := public.is_active_staff_admin();
  v_days int := greatest(7, least(365, coalesce(p_days, 30)));
  v_from date := current_date - greatest(7, least(365, coalesce(p_days, 30)));
  v_w jsonb := '{"reply":25,"close":25,"health":20,"tasks":15,"hours":10,"review":5}'::jsonb || coalesce(p_weights, '{}'::jsonb);
  v_late int := coalesce((select s.late_day from public.month_close_settings s where s.id), 15);
  v_reply jsonb;
begin
  if not public.is_active_staff() then return; end if;
  v_reply := public.client_reply_times(v_from, current_date);
  return query
  with people as (
    select s.email, s.id as staff_id, coalesce(p.display_name, s.name, s.email) as name, s.role
    from public.staff s
    left join public.staff_profiles p on p.email = s.email
    where s.active
      and (v_adm or s.email = v_me)
      and (s.role = 'bookkeeper' or exists (
        select 1 from public.clients c
        where lower(c.assigned_bookkeeper_email) = s.email and not coalesce(c.test_only, false)))
  ),
  cl as (
    select lower(c.assigned_bookkeeper_email) as email, c.id as client_id, c.created_at
    from public.clients c
    where c.assigned_bookkeeper_email is not null and not coalesce(c.test_only, false)
  ),
  rp as (
    select lower(x ->> 'email') as email, (x ->> 'replies')::int as replies, (x ->> 'pct_under_goal')::numeric as pct
    from jsonb_array_elements(coalesce(v_reply -> 'by_staff', '[]'::jsonb)) x
  ),
  pr as (
    select g::date as period, (g + interval '1 month' + make_interval(days => v_late - 1))::date as deadline
    from generate_series(date_trunc('month', v_from - interval '2 month'), date_trunc('month', current_date::timestamp), interval '1 month') g
  ),
  cz as (
    select cl.email,
           count(*)::int as total,
           count(*) filter (where mc.status in ('done', 'na', 'review') and coalesce(mc.ready_at, mc.signed_off_at, mc.done_at, mc.updated_at)::date <= pr.deadline)::int as done
    from cl
    cross join pr
    left join public.month_close mc on mc.client_id = cl.client_id and mc.period_kind = 'month' and mc.period = pr.period
    where pr.deadline between v_from and current_date
      and cl.created_at <= pr.period + interval '1 month'
    group by cl.email
  ),
  hl as (
    select cl.email, round(avg(h.score), 0) as avg_score,
           count(*) filter (where h.band = 'red')::int as red, count(h.client_id)::int as n
    from cl join public.client_health() h on h.client_id = cl.client_id
    group by cl.email
  ),
  tk as (
    select lower(coalesce(r.assignee_email, r.staff_email)) as email,
           count(*) filter (where coalesce(r.done, false) and r.completed_at >= v_from)::int as done,
           count(*) filter (where not coalesce(r.done, false) and r.due_date < current_date
                            and r.status <> 'waiting_client')::int as overdue   -- tk v1
    from public.staff_reminders r
    where r.deleted_at is null   -- tk v1
      and ((coalesce(r.done, false) and r.completed_at >= v_from)
       or (not coalesce(r.done, false) and r.due_date < current_date and r.status <> 'waiting_client'))   -- tk v1
    group by 1
  ),
  dl as (
    select cl.email, count(*)::int as total,
           count(*) filter (where d.due_date is null or d.filed_at::date <= d.due_date)::int as on_time
    from public.client_deadline_status d join cl on cl.client_id = d.client_id
    where d.undone_at is null and d.filed_at >= v_from
    group by cl.email
  ),
  qb as (
    select lower(p.staff_email) as email, sum(a.minutes) as minutes
    from public.qbo_time_activities a
    join public.qbo_employee_staff_map p
      on p.realm_id = a.realm_id
     and p.qbo_entity_type = case when a.employee_qbo_id is not null then 'Employee' else 'Vendor' end
     and p.qbo_id = coalesce(a.employee_qbo_id, a.vendor_qbo_id)
    where a.txn_date between v_from and current_date and p.staff_email is not null
    group by 1
  ),
  te as (
    select lower(t.staff_email) as email, sum(t.minutes) as minutes
    from public.time_entries t
    where t.entry_date between v_from and current_date
    group by 1
  ),
  hr as (
    select p.email,
           round(coalesce(nullif(qb.minutes, 0), te.minutes, 0) / 60.0, 1) as hours,
           round(coalesce(sc.weekly_target_hours, 35) * v_days / 7.0, 1) as capacity
    from people p
    left join qb on qb.email = p.email
    left join te on te.email = p.email
    left join public.staff_capacity sc on sc.staff_email = p.email
  ),
  rv as (
    select distinct on (r.staff_id) r.staff_id,
           round(100.0 * (s.cam_behavior + s.cam_success + s.own_behavior + s.own_success + s.hh_behavior + s.hh_success) / 30.0, 0) as pct,
           'Q' || c.quarter || ' ' || c.year as label
    from public.reviews r
    join public.review_cycles c on c.id = r.cycle_id
    join public.review_submissions s on s.review_id = r.id and s.kind = 'manager' and s.submitted_at is not null
    where r.status in ('comparing', 'signed', 'closed_unsigned')
    order by r.staff_id, c.year desc, c.quarter desc, s.submitted_at desc
  ),
  sig as (
    select p.email, p.name, p.role,
           (select count(*) from cl where cl.email = p.email)::int as clients,
           rp.pct as reply_pct, coalesce(rp.replies, 0)::int as replies,
           case when cz.total > 0 then round(100.0 * cz.done / cz.total, 0) end as close_pct,
           coalesce(cz.done, 0)::int as close_done, coalesce(cz.total, 0)::int as close_total,
           hl.avg_score as health_pct, coalesce(hl.red, 0)::int as health_red, coalesce(hl.n, 0)::int as health_n,
           case when coalesce(tk.done, 0) + coalesce(tk.overdue, 0) + coalesce(dl.total, 0) > 0
                then round(100.0 * (coalesce(tk.done, 0) + coalesce(dl.on_time, 0))
                           / (coalesce(tk.done, 0) + coalesce(tk.overdue, 0) + coalesce(dl.total, 0)), 0) end as tasks_pct,
           coalesce(tk.done, 0)::int as tasks_done, coalesce(tk.overdue, 0)::int as tasks_overdue,
           coalesce(dl.on_time, 0)::int as deadlines_on_time, coalesce(dl.total, 0)::int as deadlines_total,
           case when hr.hours > 0 and hr.capacity > 0
                then greatest(0, round(100 - 100.0 * abs(hr.hours - hr.capacity) / hr.capacity, 0)) end as hours_pct,
           hr.hours, hr.capacity as capacity_hours,
           rv.pct as review_pct, rv.label as review_label
    from people p
    left join rp on rp.email = p.email
    left join cz on cz.email = p.email
    left join hl on hl.email = p.email
    left join tk on tk.email = p.email
    left join dl on dl.email = p.email
    left join hr on hr.email = p.email
    left join rv on rv.staff_id = p.staff_id
  ),
  scored as (
    select s.*,
           case when w.total > 0
                then round((coalesce(s.reply_pct, 0) * w.reply + coalesce(s.close_pct, 0) * w.close
                          + coalesce(s.health_pct, 0) * w.health + coalesce(s.tasks_pct, 0) * w.tasks
                          + coalesce(s.hours_pct, 0) * w.hours + coalesce(s.review_pct, 0) * w.review) / w.total, 0) end as score
    from sig s,
    lateral (
      select wr.reply, wr.close, wr.health, wr.tasks, wr.hours, wr.review,
             wr.reply + wr.close + wr.health + wr.tasks + wr.hours + wr.review as total
      from (select
        case when s.reply_pct  is null then 0 else coalesce((v_w ->> 'reply')::numeric, 0) end as reply,
        case when s.close_pct  is null then 0 else coalesce((v_w ->> 'close')::numeric, 0) end as close,
        case when s.health_pct is null then 0 else coalesce((v_w ->> 'health')::numeric, 0) end as health,
        case when s.tasks_pct  is null then 0 else coalesce((v_w ->> 'tasks')::numeric, 0) end as tasks,
        case when s.hours_pct  is null then 0 else coalesce((v_w ->> 'hours')::numeric, 0) end as hours,
        case when s.review_pct is null then 0 else coalesce((v_w ->> 'review')::numeric, 0) end as review) wr
    ) w
  )
  select s.email, s.name, s.role, s.clients,
         s.reply_pct, s.replies,
         s.close_pct, s.close_done, s.close_total,
         s.health_pct, s.health_red, s.health_n,
         s.tasks_pct, s.tasks_done, s.tasks_overdue, s.deadlines_on_time, s.deadlines_total,
         s.hours_pct, s.hours, s.capacity_hours,
         s.review_pct, s.review_label,
         s.score,
         case when v_adm then (rank() over (order by s.score desc nulls last))::int end as rank,
         v_w as weights
  from scored s
  order by s.score desc nulls last, s.name;
end;
$function$;

CREATE OR REPLACE FUNCTION public.offboard_staff_preview(p_email text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_email text := lower(trim(p_email));
begin
  if not public.is_active_staff_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'staff', (select to_jsonb(s) - 'id' from staff s where s.email = v_email),
    'clients', coalesce((
      select jsonb_agg(jsonb_build_object(
               'client_id', a.client_id,
               'client_name', c.name,
               'open_tasks', (select count(*) from staff_reminders r
                               where r.done = false and r.deleted_at is null /* tk v1 */ and r.client_id = a.client_id
                                 and (r.assignee_email = v_email or r.staff_email = v_email)))
             order by c.name)
      from staff_client_access a left join clients c on c.id = a.client_id
      where a.staff_email = v_email), '[]'::jsonb),
    'other_task_clients', coalesce((
      select jsonb_agg(jsonb_build_object('client_id', x.client_id, 'client_name', c.name, 'open_tasks', x.n))
      from (select r.client_id, count(*) n from staff_reminders r
            where r.done = false and r.deleted_at is null /* tk v1 */ and r.client_id is not null
              and (r.assignee_email = v_email or r.staff_email = v_email)
              and not exists (select 1 from staff_client_access a
                              where a.staff_email = v_email and a.client_id = r.client_id)
            group by r.client_id) x
      left join clients c on c.id = x.client_id), '[]'::jsonb),
    'open_tasks_no_client', (select count(*) from staff_reminders r
                              where r.done = false and r.deleted_at is null /* tk v1 */ and r.client_id is null
                                and (r.assignee_email = v_email or r.staff_email = v_email)),
    'open_tasks_total', (select count(*) from staff_reminders r
                          where r.done = false and r.deleted_at is null /* tk v1 */ and (r.assignee_email = v_email or r.staff_email = v_email)),
    'live_grants', (select count(*) from staff_client_access_grants g
                     where g.staff_email = v_email and g.status = 'approved' and g.expires_at > now()),
    'pending_grants', (select count(*) from staff_client_access_grants g
                        where g.staff_email = v_email and g.status = 'pending'),
    'temp_admin', exists (select 1 from staff_temp_admin_access t
                          where t.staff_email = v_email and t.expires_at > now())
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.notify_enqueue_task_assigned()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_by text := lower(coalesce(nullif(auth.jwt() ->> 'email', ''), new.created_by, ''));
  v_by_name text;
begin
  if new.deleted_at is not null then return null; end if;   -- tk v1
  if new.done or new.assignee_email is null then
    return null;
  end if;
  if tg_op = 'UPDATE' and lower(new.assignee_email) is not distinct from lower(old.assignee_email) then
    return null;
  end if;
  if coalesce(new.source, 'manual') = 'access_request' then
    return null;
  end if;
  if v_by = '' or v_by = lower(new.assignee_email) then
    return null;
  end if;
  select name into v_by_name from staff where lower(email) = v_by and active;
  if v_by_name is null then
    return null;
  end if;
  -- fix 1: no email about a client task to someone who cannot open that client (D3)
  if new.client_id is not null and not public.tk_staff_has_client(new.assignee_email, new.client_id) then
    return null;
  end if;
  insert into notification_outbox (kind, recipient_email, client_id, ref_id, payload)
  values ('staff_task_assigned', lower(new.assignee_email), new.client_id, new.id::text,
          jsonb_build_object('text', left(new.text, 200), 'due_date', new.due_date, 'by', v_by_name));
  return null;
end;
$function$;
-- grants are left exactly as they are live (create or replace keeps them)


-- D14. Realtime ----------------------------------------------------------
do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['task_checklist_items', 'tk_comments', 'tk_activity', 'tk_followers', 'tk_attachments'] loop
      if not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;


-- D15 ------------------------------------------------------------------
notify pgrst, 'reload schema';
