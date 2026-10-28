-- ============================================================================
-- Slate plus project status updates: hide fix (follow-up to
-- slateplus-project-updates.sql, same day; review finding).
--   1. Hide is for managers only (tk_can_manage_project: admins, the project
--      owner, owner-role members), as the spec's "admins or project owners".
--      The author no longer gets a separate hide right.
--   2. No un-hide through the API: once hidden_at is set, a signed-in user
--      (role authenticated or anon) cannot clear it. An admin can still clear
--      it from the SQL editor (role postgres), as the spec says.
-- Applied to production 2026-10-28 (migration slateplus_project_updates_hidefix).
-- Self-test: supabase/slateplus-project-updates-tests.sql (ends in ROLLBACK).
-- ============================================================================

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
  if old.hidden_at is not null and new.hidden_at is null then
    if current_user in ('authenticated', 'anon') then
      raise exception 'tk_frozen: a hidden update can only be restored by an admin in SQL' using errcode = '42501';
    end if;
    new.hidden_by := null;
    return new;
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

drop policy if exists "tk project updates hide" on public.tk_project_updates;
create policy "tk project updates hide" on public.tk_project_updates
  for update to authenticated
  using (
    exists (select 1 from public.tk_projects p where p.id = tk_project_updates.project_id)
    and public.tk_can_manage_project(project_id)
  )
  with check (
    exists (select 1 from public.tk_projects p where p.id = tk_project_updates.project_id)
    and public.tk_can_manage_project(project_id)
  );
