-- ============================================================================
-- Slate plus: project status updates + Portfolio (hidden preview,
-- docs/slateplus-projupdates-spec.md).
--
-- Additive and inert: one new table and one view. Nothing reads or writes them
-- unless the Slate plus gate is on (TKP_on(), components/tasks/TK_slatePlus.js).
--
--   tk_project_updates        one status update on a project (On track, At
--                             risk, Off track, Done) with a short note.
--   tk_project_update_latest  the newest non-hidden update per project
--                             (security_invoker, so the table's RLS applies).
--
-- Who (mirrors the project rules that exist today; staff only, no anon):
--   read    the project is visible to me under the tk_projects RLS (owner,
--           member, open to staff, client access, admin; never trashed or
--           internal-locked), and the update is not hidden unless I wrote it
--           or can manage the project.
--   insert  the project is visible and tk_can_manage_project (admin, owner,
--           owner-role member), the same rule as editing the project.
--   update  hide only: the author or a manager sets hidden_at (column grant +
--           trigger; every other column is frozen).
--   delete  never (no policy, no grant). Nothing is hard deleted.
-- No emails, no notifications: inserting writes this row and nothing else.
--
-- Rollback (only if the feature is dropped; it removes typed updates, so ask
-- the owner first):
--   drop view if exists public.tk_project_update_latest;
--   drop table if exists public.tk_project_updates;
--   drop function if exists public.tk_project_updates_guard();
--
-- Applied to production 2026-10-28 (migration slateplus_project_updates).
-- Self-test: supabase/slateplus-project-updates-tests.sql (ends in ROLLBACK).
-- ============================================================================

create table if not exists public.tk_project_updates (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.tk_projects(id) on delete restrict,
  author_email text not null default lower(coalesce(auth.jwt() ->> 'email', '')),
  status text not null,
  body text not null,
  created_at timestamptz not null default now(),
  hidden_at timestamptz,
  hidden_by text,
  constraint tk_project_updates_status_check check (status in ('on_track', 'at_risk', 'off_track', 'done')),
  constraint tk_project_updates_body_len check (char_length(btrim(body)) between 1 and 1000),
  constraint tk_project_updates_hidden_pair check ((hidden_at is null) = (hidden_by is null))
);

create index if not exists tk_project_updates_project_idx
  on public.tk_project_updates (project_id, created_at desc);

comment on table public.tk_project_updates is
  'Slate plus (hidden preview): project status updates. Read = project visible; post = tk_can_manage_project; hide only (no delete). docs/slateplus-projupdates-spec.md';

-- Insert: stamp the author, time and trimmed text. Update: hide or un-hide
-- only (hidden_at); stamps hidden_by. Everything else is frozen.
create or replace function public.tk_project_updates_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_me text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if tg_op = 'INSERT' then
    new.author_email := v_me;
    new.created_at := now();
    new.body := btrim(new.body);
    new.hidden_at := null;
    new.hidden_by := null;
    return new;
  end if;
  if new.id is distinct from old.id
     or new.project_id is distinct from old.project_id
     or new.author_email is distinct from old.author_email
     or new.status is distinct from old.status
     or new.body is distinct from old.body
     or new.created_at is distinct from old.created_at then
    raise exception 'tk_frozen: a posted update can only be hidden' using errcode = '42501';
  end if;
  if new.hidden_at is null then
    new.hidden_by := null;
  elsif old.hidden_at is null then
    new.hidden_at := now();
    new.hidden_by := v_me;
  else
    new.hidden_at := old.hidden_at;
    new.hidden_by := old.hidden_by;
  end if;
  return new;
end $$;

drop trigger if exists tk_project_updates_guard on public.tk_project_updates;
create trigger tk_project_updates_guard
  before insert or update on public.tk_project_updates
  for each row execute function public.tk_project_updates_guard();

alter table public.tk_project_updates enable row level security;

drop policy if exists "tk project updates read" on public.tk_project_updates;
create policy "tk project updates read" on public.tk_project_updates
  for select to authenticated
  using (
    exists (select 1 from public.tk_projects p where p.id = tk_project_updates.project_id)
    and (
      hidden_at is null
      or author_email = lower(coalesce(auth.jwt() ->> 'email', ''))
      or public.tk_can_manage_project(project_id)
    )
  );

drop policy if exists "tk project updates insert" on public.tk_project_updates;
create policy "tk project updates insert" on public.tk_project_updates
  for insert to authenticated
  with check (
    author_email = lower(coalesce(auth.jwt() ->> 'email', ''))
    and hidden_at is null
    and public.tk_can_manage_project(project_id)
    and exists (select 1 from public.tk_projects p where p.id = tk_project_updates.project_id)
  );

drop policy if exists "tk project updates hide" on public.tk_project_updates;
create policy "tk project updates hide" on public.tk_project_updates
  for update to authenticated
  using (
    exists (select 1 from public.tk_projects p where p.id = tk_project_updates.project_id)
    and (author_email = lower(coalesce(auth.jwt() ->> 'email', '')) or public.tk_can_manage_project(project_id))
  )
  with check (
    exists (select 1 from public.tk_projects p where p.id = tk_project_updates.project_id)
    and (author_email = lower(coalesce(auth.jwt() ->> 'email', '')) or public.tk_can_manage_project(project_id))
  );

revoke all on public.tk_project_updates from public, anon, authenticated;
grant select on public.tk_project_updates to authenticated;
grant insert (project_id, status, body) on public.tk_project_updates to authenticated;
grant update (hidden_at) on public.tk_project_updates to authenticated;
grant all on public.tk_project_updates to service_role;

create or replace view public.tk_project_update_latest
with (security_invoker = true) as
  select distinct on (u.project_id)
         u.project_id, u.id, u.status, u.author_email, u.created_at
    from public.tk_project_updates u
   where u.hidden_at is null
   order by u.project_id, u.created_at desc, u.id desc;

comment on view public.tk_project_update_latest is
  'Slate plus (hidden preview): newest non-hidden update per project; security_invoker, so tk_project_updates RLS applies.';

revoke all on public.tk_project_update_latest from public, anon, authenticated;
grant select on public.tk_project_update_latest to authenticated;
grant select on public.tk_project_update_latest to service_role;

-- Checks (read only):
--   select policyname, cmd, roles from pg_policies where tablename = 'tk_project_updates';
--   select has_table_privilege('anon', 'public.tk_project_updates', 'select');  -- false
--   select has_table_privilege('authenticated', 'public.tk_project_updates', 'delete');  -- false
