-- =====================================================================
-- Slate app interactions: Duplicate and Copy/Paste (docs/slate-app-interactions-plan.md
-- items 2 and 3). Additive only: one new function, nothing dropped or changed.
--
-- tk_copy_tasks(p_ids uuid[], p_target jsonb default null) -> jsonb
--   { copies: [{ source, id, subtasks: [id] }], skipped: [{ id, reason }] }
--
-- SECURITY INVOKER on purpose: the copies are written as the signed-in
-- person, so row level security and the staff_reminders triggers decide
-- exactly as they do for a task the person adds by hand (read access to the
-- source, project membership, client access, archived and trashed projects).
-- Nothing here grants anything the person could not already do.
--
-- The copy is owned by the caller and keeps: title, notes (description),
-- assignee, priority, kind, visibility, review gate, SOP section, and one
-- level of open subtasks and the checklist (all unchecked). It gets a fresh
-- status (to do), no due or start date, and NO recurring or template links
-- (recurrence none; series, template, period and close links empty; source
-- manual), so a copy can never create duplicate recurring work.
--
-- p_target (optional): { project_id, client_id, section }. A key that is
-- present sets that field (null clears it); no target duplicates in place.
-- A copy never changes client: a source on client X can only land on client
-- X (reason other_client otherwise). Subtasks are only duplicated in place.
--
-- No emails: mgb.tk_bulk is set for this transaction only, which the
-- assignment-email trigger already honors. Undo (client side) soft deletes
-- the copies through tk_bulk_delete, the same archive as Delete.
-- =====================================================================

create or replace function public.tk_copy_tasks(p_ids uuid[], p_target jsonb default null)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_me text := coalesce(auth.jwt() ->> 'email', '');
  v_t jsonb := case when jsonb_typeof(p_target) = 'object' then p_target else '{}'::jsonb end;
  v_has_target boolean;
  v_ids uuid[];
  v_id uuid;
  s public.staff_reminders%rowtype;
  c public.staff_reminders%rowtype;
  v_p record;
  v_project uuid;
  v_client text;
  v_pclient text;
  v_section text;
  v_vis text;
  v_new uuid;
  v_sub uuid;
  v_subs jsonb;
  v_reason text;
  v_copies jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
begin
  if v_me = '' or not public.is_active_staff() then
    raise exception 'tk_forbidden' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_ids), 0) > 50 then
    raise exception 'tk_too_many' using errcode = '22023';
  end if;
  v_has_target := v_t ? 'project_id' or v_t ? 'client_id' or v_t ? 'section';
  select coalesce(array_agg(q.x order by q.o), '{}'::uuid[]) into v_ids
    from (select u.x, min(u.o) as o
            from unnest(coalesce(p_ids, '{}'::uuid[])) with ordinality as u(x, o)
           where u.x is not null
           group by u.x) q;

  -- a copy is not a new assignment: no "assigned to you" email
  perform set_config('mgb.tk_bulk', 'on', true);

  foreach v_id in array v_ids loop
    v_reason := null;
    v_subs := '[]'::jsonb;
    begin
      -- row level security: only a task the caller can read is found
      select * into s from public.staff_reminders x where x.id = v_id;
      if not found then
        v_reason := 'no_access';
      elsif s.deleted_at is not null or s.trashed_with_project is not null then
        v_reason := 'deleted';
      elsif s.parent_id is not null and v_has_target then
        v_reason := 'subtask';
      end if;

      if v_reason is null then
        -- where the copy goes
        v_project := case when v_t ? 'project_id' then nullif(v_t ->> 'project_id', '')::uuid else s.project_id end;
        v_pclient := null;
        if v_project is not null then
          select * into v_p from public.tk_project_info(v_project);
          if not coalesce(v_p.found, false) then raise exception 'tk_project_missing'; end if;
          v_pclient := v_p.client_id;
        end if;
        if v_pclient is not null then
          v_client := v_pclient;
        elsif v_t ? 'client_id' then
          v_client := nullif(v_t ->> 'client_id', '');
        elsif v_t ? 'project_id' then
          v_client := null;
        else
          v_client := s.client_id;
        end if;
        if s.client_id is not null and v_client is distinct from s.client_id then
          v_reason := 'other_client';
        end if;
      end if;

      if v_reason is null then
        if v_t ? 'section' then
          v_section := left(nullif(btrim(coalesce(v_t ->> 'section', '')), ''), 60);
        elsif v_project is distinct from s.project_id then
          v_section := null;
        else
          v_section := s.section;
        end if;
        v_vis := case when v_client is null and v_project is null then 'private' else s.visibility end;
        perform set_config('mgb.tk_unassigned', case when s.assignee_email is null then 'on' else '' end, true);

        insert into public.staff_reminders (
          staff_email, created_by, text, description, client_id, project_id, section, parent_id,
          visibility, assignee_email, priority, kind, recurrence, source, status, done,
          review_required, sop_section, sort_key)
        values (
          v_me, lower(v_me), s.text, s.description, v_client, v_project, v_section,
          case when v_has_target then null else s.parent_id end,
          v_vis, s.assignee_email, s.priority, s.kind, 'none', 'manual', 'todo', false,
          s.review_required, s.sop_section, s.sort_key)
        returning id into v_new;

        insert into public.task_checklist_items (reminder_id, text, done, sort_order, created_by)
        select v_new, i.text, false, i.sort_order, lower(v_me)
          from public.task_checklist_items i where i.reminder_id = s.id
         order by i.sort_order, i.created_at;

        -- one level of open subtasks (a subtask itself has none to copy)
        if s.parent_id is null then
          for c in
            select * from public.staff_reminders x
             where x.parent_id = s.id and x.deleted_at is null and x.trashed_with_project is null
             order by x.sort_key nulls last, x.created_at
          loop
            perform set_config('mgb.tk_unassigned', case when c.assignee_email is null then 'on' else '' end, true);
            insert into public.staff_reminders (
              staff_email, created_by, text, description, client_id, project_id, section, parent_id,
              visibility, assignee_email, priority, kind, recurrence, source, status, done,
              review_required, sop_section, sort_key)
            values (
              v_me, lower(v_me), c.text, c.description, v_client, v_project, v_section, v_new,
              v_vis, c.assignee_email, c.priority, c.kind, 'none', 'manual', 'todo', false,
              c.review_required, c.sop_section, c.sort_key)
            returning id into v_sub;
            insert into public.task_checklist_items (reminder_id, text, done, sort_order, created_by)
            select v_sub, i.text, false, i.sort_order, lower(v_me)
              from public.task_checklist_items i where i.reminder_id = c.id
             order by i.sort_order, i.created_at;
            v_subs := v_subs || to_jsonb(v_sub::text);
          end loop;
        end if;
        perform set_config('mgb.tk_unassigned', '', true);
        v_copies := v_copies || jsonb_build_array(jsonb_build_object('source', v_id, 'id', v_new, 'subtasks', v_subs));
      end if;
    exception when others then
      perform set_config('mgb.tk_unassigned', '', true);
      v_reason := case
        when sqlerrm like '%tk_task_in_trash%' then 'in_trash'
        when sqlerrm like '%tk_project_trashed%' then 'project_trashed'
        when sqlerrm like '%tk_project_archived%' then 'project_archived'
        when sqlerrm like '%tk_forbidden%' or sqlerrm like '%tk_not_project_member%'
          or sqlerrm like '%tk_project_missing%' or sqlerrm like '%row-level security%' then 'no_access'
        else 'error' end;
    end;
    if v_reason is not null then
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('id', v_id, 'reason', v_reason));
    end if;
  end loop;

  return jsonb_build_object('copies', v_copies, 'skipped', v_skipped);
end $$;

revoke all on function public.tk_copy_tasks(uuid[], jsonb) from public, anon;
grant execute on function public.tk_copy_tasks(uuid[], jsonb) to authenticated;

comment on function public.tk_copy_tasks(uuid[], jsonb) is
  'Slate app Duplicate / Copy-Paste: copies tasks as the caller (RLS and triggers apply), no recurring links, no emails. supabase/slate-ix-copy.sql';
