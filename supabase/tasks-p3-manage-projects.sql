-- =====================================================================
-- Tasks Phase 3, Manage projects (2026-10-16). Builds on the live
-- Tasks schema (tk_schema_version 10). Safe to re-run. No transaction
-- control (apply_migration wraps it). NOTHING IS EVER DELETED here: the
-- most a project can reach is "trashed", and a trashed project (and the
-- tasks that were in it) can be restored by an admin, forever. After
-- 30 days a trashed project is only marked "expired" (a label and a flag);
-- no row is removed and an admin can still restore it.
--
-- Decisions (owner, 2026-10-16): delete = move to trash only; teams are
-- not part of this slice.
--
-- What "trashed" means
--   * tk_projects.trashed_at / trashed_by / trash_expired_at.
--   * The project disappears from every list: a RESTRICTIVE row-level
--     policy hides it from direct reads (the sidebar, pickers, the
--     project route). Admins see it only through tk_admin_list_projects.
--   * Its tasks are soft-deleted with the SAME deleted_at column the app
--     already uses for deleted tasks, and tagged
--     staff_reminders.trashed_with_project = <project>. Reusing deleted_at
--     is deliberate: every reader that already skips deleted tasks (My
--     Tasks, lists, search, Waiting on client, client_health,
--     digest_weekly_data, staff_performance, the on-time and review
--     stats, the reminder and client emails) skips them with no change
--     and no edge function to redeploy.
--   * Restore puts back exactly the tasks that were hidden WITH the
--     project (trashed_with_project = <project>). A task that was deleted
--     on its own before the trash stays deleted.
--   * Trashing is refused while any live task in the project has an
--     unfinished client request (Ask client: still open, or answered but
--     not yet accepted): finish or cancel it first. (Requests are not
--     tied to deleted_at, so hiding the task would leave the client's
--     request and its reminder emails running.)
--
-- Who may do what (every check is inside the function)
--   rename, archive, unarchive, trash, restore: an active admin, or
--   someone who can manage that project (tk_can_manage_project: its owner
--   or an owner member). Restoring a project that is past 30 days is for
--   admins only. The list screen, tk_admin_list_projects, is admins only.
--   Every action writes an audit_log row (tk_project.renamed / archived /
--   unarchived / trashed / restored; the lazy expiry writes
--   tk_project.trash_expired as 'system').
--
-- Non-additive change, with its data-preservation note:
--   tk_projects_name_uniq (unique per client + name among live
--      projects) is replaced by tk_projects_name_uniq_v2 that also
--      ignores trashed projects. It is strictly looser: every row that
--      satisfied the old index satisfies the new one.
--   (tk_schema_version() stays 10: like the other fix files, this does not
--   bump it, so the existing s8b self-test keeps passing.)
-- =====================================================================

-- 1. Columns ----------------------------------------------------------
alter table public.tk_projects
  add column if not exists trashed_at timestamptz,
  add column if not exists trashed_by text,
  add column if not exists trash_expired_at timestamptz;

alter table public.staff_reminders
  add column if not exists trashed_with_project uuid;

create index if not exists staff_reminders_trashed_with_project_idx
  on public.staff_reminders (trashed_with_project) where trashed_with_project is not null;
create index if not exists tk_projects_trashed_idx
  on public.tk_projects (trashed_at) where trashed_at is not null;

-- 2. Name uniqueness ignores trashed projects -------------------------
create unique index if not exists tk_projects_name_uniq_v2
  on public.tk_projects (coalesce(client_id, ''), lower(name))
  where archived_at is null and trashed_at is null;
drop index if exists public.tk_projects_name_uniq;

-- 3. Hide trashed projects from every direct read ---------------------
-- RESTRICTIVE: it is ANDed with the existing permissive policies, so
-- nobody (admins included) reads or writes a trashed row through the API.
drop policy if exists "tk projects hide trashed" on public.tk_projects;
create policy "tk projects hide trashed" on public.tk_projects
  as restrictive for all to authenticated
  using (trashed_at is null) with check (trashed_at is null);

-- 4. Guards -----------------------------------------------------------
-- 4a. The trash columns on a project change only inside the RPCs below
--     (they set mgb.tk_project_trash = 'on' for the transaction).
create or replace function public.tk_projects_trash_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.trashed_at := null;
    new.trashed_by := null;
    new.trash_expired_at := null;
  elsif coalesce(current_setting('mgb.tk_project_trash', true), '') <> 'on' then
    new.trashed_at := old.trashed_at;
    new.trashed_by := old.trashed_by;
    new.trash_expired_at := old.trash_expired_at;
  end if;
  return new;
end $$;
revoke all on function public.tk_projects_trash_guard() from public, anon, authenticated;
drop trigger if exists tk_projects_trash_guard on public.tk_projects;
create trigger tk_projects_trash_guard before insert or update on public.tk_projects
  for each row execute function public.tk_projects_trash_guard();

-- 4b. On tasks: nobody (the import, a cron, the API) can put a live task
--     into a trashed project, and trashed_with_project changes only inside
--     the RPCs. Definer, so it can see trashed projects.
create or replace function public.tk_staff_reminders_trash_guard()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_in_rpc boolean := coalesce(current_setting('mgb.tk_project_trash', true), '') = 'on';
begin
  if tg_op = 'INSERT' then
    if not v_in_rpc then new.trashed_with_project := null; end if;
  else
    if not v_in_rpc then new.trashed_with_project := old.trashed_with_project; end if;
  end if;
  -- a live task may not sit in a trashed project (insert, move, or an undelete)
  if new.deleted_at is null and new.project_id is not null
     and (tg_op = 'INSERT' or new.project_id is distinct from old.project_id or old.deleted_at is not null)
     and exists (select 1 from public.tk_projects p where p.id = new.project_id and p.trashed_at is not null) then
    raise exception 'tk_project_trashed' using errcode = '22023';
  end if;
  -- an undelete clears the marker
  if new.deleted_at is null then new.trashed_with_project := null; end if;
  return new;
end $$;
revoke all on function public.tk_staff_reminders_trash_guard() from public, anon, authenticated;
drop trigger if exists staff_reminders_trash_guard on public.staff_reminders;
create trigger staff_reminders_trash_guard before insert or update on public.staff_reminders
  for each row execute function public.tk_staff_reminders_trash_guard();

-- 5. Internal helpers --------------------------------------------------
-- Lazy 30-day expiry: marks, never removes. Called by the list RPC; also
-- safe to call from a daily cron later.
create or replace function public.tk__projects_mark_expired()
returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  perform set_config('mgb.tk_project_trash', 'on', true);
  with u as (
    update public.tk_projects p
       set trash_expired_at = now()
     where p.trashed_at is not null and p.trash_expired_at is null
       and p.trashed_at < now() - interval '30 days'
    returning p.id, p.name, p.client_id, p.trashed_at
  ), l as (
    insert into public.audit_log (actor_email, action, client_id, target_type, target_id, details)
    select 'system', 'tk_project.trash_expired', u.client_id, 'tk_project', u.id::text,
           jsonb_build_object('name', u.name, 'trashed_at', u.trashed_at)
      from u
    returning 1
  )
  select count(*) into v_n from l;
  perform set_config('mgb.tk_project_trash', '', true);
  return coalesce(v_n, 0);
end $$;
revoke all on function public.tk__projects_mark_expired() from public, anon, authenticated;

-- The shared door for the five actions: signed-in active staff, then admin
-- or project manager. Returns the locked project row. A project the caller
-- cannot manage (or cannot see) is "tk_forbidden", whether or not it exists.
create or replace function public.tk__project_gate(p_project uuid)
returns public.tk_projects
language plpgsql security definer
set search_path = public
as $$
declare
  v_p public.tk_projects;
  v_admin boolean;
begin
  if lower(coalesce(auth.jwt() ->> 'email', '')) = '' or not public.is_active_staff() then
    raise exception 'tk_forbidden' using errcode = '42501';
  end if;
  v_admin := public.is_active_staff_admin();
  select * into v_p from public.tk_projects where id = p_project for update;
  if not found then
    raise exception 'tk_forbidden' using errcode = '42501';
  end if;
  if v_p.client_id is not null and v_p.client_id = any (public.internal_blocked_ids()) then
    raise exception 'tk_forbidden' using errcode = '42501';
  end if;
  if not (v_admin or public.tk_can_manage_project(p_project)) then
    raise exception 'tk_forbidden' using errcode = '42501';
  end if;
  return v_p;
end $$;
revoke all on function public.tk__project_gate(uuid) from public, anon, authenticated;

-- 6. Public RPCs --------------------------------------------------------

-- 6a. Rename -----------------------------------------------------------
create or replace function public.tk_project_rename(p_project uuid, p_name text)
returns text
language plpgsql security definer
set search_path = public
as $$
declare
  v_p public.tk_projects;
  v_name text := btrim(coalesce(p_name, ''));
begin
  v_p := public.tk__project_gate(p_project);
  if v_p.trashed_at is not null then
    raise exception 'tk_project_trashed' using errcode = '22023';
  end if;
  if char_length(v_name) not between 1 and 120 then
    raise exception 'tk_bad_name' using errcode = '22023';
  end if;
  if v_name = v_p.name then
    return v_name;
  end if;
  begin
    update public.tk_projects set name = v_name where id = p_project;
  exception when unique_violation then
    raise exception 'tk_name_taken' using errcode = '23505';
  end;
  perform public.audit_write('tk_project.renamed', v_p.client_id, 'tk_project', p_project::text,
                             jsonb_build_object('from', v_p.name, 'to', v_name));
  return v_name;
end $$;

-- 6b. Archive / unarchive ----------------------------------------------
create or replace function public.tk_project_archive(p_project uuid, p_archive boolean default true)
returns text
language plpgsql security definer
set search_path = public
as $$
declare
  v_p public.tk_projects;
begin
  v_p := public.tk__project_gate(p_project);
  if v_p.trashed_at is not null then
    raise exception 'tk_project_trashed' using errcode = '22023';
  end if;
  if coalesce(p_archive, true) then
    if v_p.archived_at is null then
      update public.tk_projects set archived_at = now() where id = p_project;
      perform public.audit_write('tk_project.archived', v_p.client_id, 'tk_project', p_project::text,
                                 jsonb_build_object('name', v_p.name));
    end if;
    return 'archived';
  end if;
  if v_p.archived_at is not null then
    begin
      update public.tk_projects set archived_at = null where id = p_project;
    exception when unique_violation then
      raise exception 'tk_name_taken' using errcode = '23505';
    end;
    perform public.audit_write('tk_project.unarchived', v_p.client_id, 'tk_project', p_project::text,
                               jsonb_build_object('name', v_p.name));
  end if;
  return 'active';
end $$;

-- 6c. Move to trash. Returns how many tasks went with it. ---------------
create or replace function public.tk_project_trash(p_project uuid)
returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  v_p public.tk_projects;
  v_me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_open integer;
  v_n integer;
begin
  v_p := public.tk__project_gate(p_project);
  if v_p.trashed_at is not null then
    return 0;   -- already in the trash
  end if;
  select count(*) into v_open
    from public.client_requests r
    join public.staff_reminders s on s.id = r.task_id
   where s.project_id = p_project and s.deleted_at is null
     and r.status in ('open', 'answered') and r.deleted_at is null and not r.legacy_doc_request;
  if v_open > 0 then
    raise exception 'tk_has_open_requests' using errcode = '22023', detail = v_open::text;
  end if;
  perform set_config('mgb.tk_project_trash', 'on', true);
  update public.tk_projects
     set trashed_at = now(), trashed_by = v_me, trash_expired_at = null
   where id = p_project;
  update public.staff_reminders
     set deleted_at = now(), trashed_with_project = p_project
   where project_id = p_project and deleted_at is null;
  get diagnostics v_n = row_count;
  perform set_config('mgb.tk_project_trash', '', true);
  perform public.audit_write('tk_project.trashed', v_p.client_id, 'tk_project', p_project::text,
                             jsonb_build_object('name', v_p.name, 'tasks_hidden', v_n));
  return v_n;
end $$;

-- 6d. Restore. Returns how many tasks came back. -------------------------
create or replace function public.tk_project_restore(p_project uuid)
returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  v_p public.tk_projects;
  v_n integer;
begin
  v_p := public.tk__project_gate(p_project);
  if v_p.trashed_at is null then
    return 0;   -- not in the trash
  end if;
  if (v_p.trashed_at < now() - interval '30 days') and not public.is_active_staff_admin() then
    raise exception 'tk_trash_expired' using errcode = '42501';
  end if;
  perform set_config('mgb.tk_project_trash', 'on', true);
  begin
    update public.tk_projects
       set trashed_at = null, trashed_by = null, trash_expired_at = null
     where id = p_project;
  exception when unique_violation then
    raise exception 'tk_name_taken' using errcode = '23505';
  end;
  update public.staff_reminders
     set deleted_at = null, trashed_with_project = null
   where trashed_with_project = p_project;
  get diagnostics v_n = row_count;
  perform set_config('mgb.tk_project_trash', '', true);
  perform public.audit_write('tk_project.restored', v_p.client_id, 'tk_project', p_project::text,
                             jsonb_build_object('name', v_p.name, 'tasks_restored', v_n,
                                                'was_expired', v_p.trashed_at < now() - interval '30 days'));
  return v_n;
end $$;

-- 6e. The admin list ------------------------------------------------------
create or replace function public.tk_admin_list_projects()
returns table (
  id uuid, name text, kind text, client_id text, client_name text,
  owner_email text, owner_name text, open_to_staff boolean,
  created_at timestamptz, archived_at timestamptz,
  trashed_at timestamptz, trashed_by text, trash_expires_at timestamptz, trash_expired boolean,
  state text,
  open_tasks integer, done_tasks integer, trashed_tasks integer, open_requests integer, member_count integer
)
language plpgsql security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if lower(coalesce(auth.jwt() ->> 'email', '')) = '' or not public.is_active_staff_admin() then
    raise exception 'tk_forbidden' using errcode = '42501';
  end if;
  perform public.tk__projects_mark_expired();
  return query
  select p.id, p.name, p.kind, p.client_id, c.name,
         p.owner_email, so.name, p.open_to_staff,
         p.created_at, p.archived_at,
         p.trashed_at, p.trashed_by, p.trashed_at + interval '30 days',
         p.trashed_at is not null and p.trashed_at < now() - interval '30 days',
         case when p.trashed_at is not null
                then case when p.trashed_at < now() - interval '30 days' then 'expired' else 'trashed' end
              when p.archived_at is not null then 'archived'
              else 'active' end,
         (select count(*)::int from public.staff_reminders s
           where s.project_id = p.id and s.deleted_at is null and s.status <> 'done'),
         (select count(*)::int from public.staff_reminders s
           where s.project_id = p.id and s.deleted_at is null and s.status = 'done'),
         (select count(*)::int from public.staff_reminders s where s.trashed_with_project = p.id),
         (select count(*)::int from public.client_requests r
            join public.staff_reminders s on s.id = r.task_id
           where s.project_id = p.id and s.deleted_at is null
             and r.status in ('open', 'answered') and r.deleted_at is null and not r.legacy_doc_request),
         (select count(*)::int from public.tk_project_members m where m.project_id = p.id)
    from public.tk_projects p
    left join public.clients c on c.id = p.client_id
    left join public.staff so on lower(so.email) = lower(p.owner_email)
   where p.client_id is null or p.client_id <> all (public.internal_blocked_ids())
   order by (p.trashed_at is not null), (p.archived_at is not null), lower(p.name);
end $$;

-- 7. Grants -------------------------------------------------------------
revoke all on function public.tk_project_rename(uuid, text) from public, anon;
revoke all on function public.tk_project_archive(uuid, boolean) from public, anon;
revoke all on function public.tk_project_trash(uuid) from public, anon;
revoke all on function public.tk_project_restore(uuid) from public, anon;
revoke all on function public.tk_admin_list_projects() from public, anon;
grant execute on function public.tk_project_rename(uuid, text) to authenticated;
grant execute on function public.tk_project_archive(uuid, boolean) to authenticated;
grant execute on function public.tk_project_trash(uuid) to authenticated;
grant execute on function public.tk_project_restore(uuid) to authenticated;
grant execute on function public.tk_admin_list_projects() to authenticated;
