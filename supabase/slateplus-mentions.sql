-- Slate plus: @mentions in task comments (hidden preview).
-- Spec: docs/slateplus-mentions-spec.md. Self-test: slateplus-mentions-tests.sql
-- (one transaction, rolled back).
--
-- Additive only. Nothing the old experience reads is changed:
--   1. NEW RPC tk_mention_candidates(task): the active staff who will actually
--      see an @mention on this task (bell notice + can read the comment).
--      Only the preview picker calls it (TK_api.mentionCandidates, gated by
--      TKP_on() in components/tasks/TK_slatePlus.js). Staff only; clients and
--      anon get nothing. Internal company tasks list only admins with
--      internal access (tk_staff_has_client is internal-aware; the admin
--      shortcut in tk_task_scope_ok is not, so the check is added here).
--   2. The firm switch tk_settings.slateplus_enabled is owner-only through
--      tk__owner_only_key. A sibling Slate plus migration added that key to the
--      live list first (re-read with pg_get_functiondef 2026-10-27, identical to
--      what this file would have set), so this file does NOT recreate it (no
--      race with siblings). The self-test checks it. No row is inserted:
--      missing = off for everyone; only the owner turns it on, never the app.
--
-- tk_parse_mentions, tk_comments triggers, the staff_task_mention email and
-- the bell are NOT touched.
--
-- Safe to re-run. Applied to production 2026-10-27 (project xumsqmhccgfjnlmieqyu).

create or replace function public.tk_mention_candidates(p_task uuid)
returns table (email text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_r record;
  v_edit boolean;
  v_internal boolean;
begin
  if v_me = '' or p_task is null or not public.is_active_staff() or not public.tk_can_read_task(p_task) then
    return;
  end if;
  select r.id, r.staff_email, r.assignee_email, r.client_id, r.project_id, r.visibility, r.deleted_at
    into v_r from staff_reminders r where r.id = p_task;
  if not found or v_r.deleted_at is not null then
    return;
  end if;
  -- an editor's mention adds a follower (tk_comments_follow), so they can read it
  v_edit := public.tk_can_edit_task(p_task);
  v_internal := v_r.client_id is not null
                and exists (select 1 from clients c where c.id = v_r.client_id and c.is_internal);
  return query
    select lower(s.email)
      from staff s
     where s.active
       and lower(s.email) <> v_me
       and public.tk_task_scope_ok(p_task, s.email)
       and (not v_internal or public.tk_staff_has_client(s.email, v_r.client_id))
       and (
             v_edit
          or s.role = 'admin'
          or lower(s.email) = lower(coalesce(v_r.staff_email, ''))
          or lower(s.email) = lower(coalesce(v_r.assignee_email, ''))
          or exists (select 1 from tk_followers f where f.task_id = p_task and f.staff_email = lower(s.email))
          or (v_r.visibility = 'shared' and (v_r.client_id is not null or v_r.project_id is not null))
       )
     order by 1;
end $$;

revoke all on function public.tk_mention_candidates(uuid) from public, anon;
grant execute on function public.tk_mention_candidates(uuid) to authenticated;

notify pgrst, 'reload schema';
