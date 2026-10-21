-- =====================================================================
-- Slate app P2: manual order (drag reorder).
--
-- Applied to production 2026-10-21 (migration tasks_slate_p2_reorder).
--
-- RETIRED the same day by tasks-slate-p2-fixes.sql: sort_key is shared, so
-- this would have changed other people's portal order. Execute on
-- tk_reorder is revoked from authenticated (the function is kept, not
-- dropped); manual order now lives per person in tk_manual_order through
-- tk_manual_reorder. No row ever got a sort_key from it (0 keyed rows in
-- production when it was retired). Kept below as the record of what ran.
--
-- Additive only. One new RPC, public.tk_reorder. No new column: the
-- numeric staff_reminders.sort_key (tasks-module-v1.sql) already drives
-- the base order in TK_sortTasks (keyed rows first, low to high, then the
-- usual compare). Nothing calls this RPC unless the Slate app is on and the
-- person picked "Manual" order, so it is harmless while the app is off.
--
-- tk_reorder(p_task, p_before, p_after, p_section, p_set_section, p_order)
--   p_task        the task that moved
--   p_before      the row now just above it in the same group (null = top)
--   p_after       the row now just below it (null = bottom)
--   p_section     the new section name when p_set_section is true (null clears)
--   p_set_section true only on a project list drop into another section
--   p_order       the group's visible order after the move (ids, max 500);
--                 used only when the keys are too close or missing
--
-- The moved task gets a key between its neighbors. When there is no room
-- (a neighbor above has no key, or the gap is under 1e-6) the group is
-- renumbered 1024, 2048, ... from the top through the moved row (and any
-- keyed row below it). Rows below that still have no key stay unkeyed and
-- keep sorting after the keyed ones, so the visible order is kept.
--
-- Access: active staff only; the moved task needs the same per-task edit
-- and read check as the bulk tools (tk__bulk_access). Neighbors must be
-- readable. Renumbered rows are written only when the caller could edit
-- them; others are counted as skipped. A section change stays inside the
-- task's own project (never across projects) and must name one of its
-- sections. sort_key changes are not written to tk_activity (the existing
-- trigger ignores them); a section change is logged as usual.
-- =====================================================================

create or replace function public.tk_reorder(
  p_task uuid,
  p_before uuid default null,
  p_after uuid default null,
  p_section text default null,
  p_set_section boolean default false,
  p_order uuid[] default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_reason text;
  r public.staff_reminders%rowtype;
  a public.staff_reminders%rowtype;
  v_kb numeric;
  v_ka numeric;
  v_key numeric;
  v_secs text[];
  v_section text;
  v_order uuid[];
  v_pos int;
  v_cut int;
  v_i int;
  v_id uuid;
  v_cur numeric;
  v_new numeric;
  v_rows jsonb := '[]'::jsonb;
  v_renorm int := 0;
  v_skipped int := 0;
  v_upd timestamptz;
begin
  if v_me = '' or not public.is_active_staff() then
    raise exception 'tk_forbidden' using errcode = '42501';
  end if;
  if p_task is null or p_task = p_before or p_task = p_after
     or (p_before is not null and p_before = p_after) then
    raise exception 'tk_bad_patch' using errcode = '22023';
  end if;
  if coalesce(cardinality(p_order), 0) > 500 then
    raise exception 'tk_too_many' using errcode = '22023';
  end if;

  v_reason := public.tk__bulk_access(p_task);
  if v_reason = 'in_trash' then
    raise exception 'tk_task_in_trash' using errcode = '22023';
  elsif v_reason is not null then
    raise exception 'tk_forbidden' using errcode = '42501';
  end if;
  select * into r from public.staff_reminders x where x.id = p_task for update;

  -- neighbors: readable, live rows only (the app only sends rows it shows)
  if p_before is not null then
    if not public.tk_can_read_task(p_before)
       or not exists (select 1 from public.staff_reminders x where x.id = p_before and x.deleted_at is null) then
      raise exception 'tk_not_found' using errcode = '22023';
    end if;
    select x.sort_key into v_kb from public.staff_reminders x where x.id = p_before;
  end if;
  if p_after is not null then
    if not public.tk_can_read_task(p_after)
       or not exists (select 1 from public.staff_reminders x where x.id = p_after and x.deleted_at is null) then
      raise exception 'tk_not_found' using errcode = '22023';
    end if;
    select x.sort_key into v_ka from public.staff_reminders x where x.id = p_after;
  end if;

  -- section: the task's own project only; one of its sections; null clears
  v_section := r.section;
  if coalesce(p_set_section, false) then
    if p_section is null or btrim(p_section) = '' then
      v_section := null;
    elsif r.project_id is null then
      raise exception 'tk_bad_patch' using errcode = '22023';
    else
      select p.sections into v_secs from public.tk_projects p where p.id = r.project_id;
      select s into v_section from unnest(coalesce(v_secs, '{}'::text[])) s where lower(s) = lower(btrim(p_section)) limit 1;
      if v_section is null then
        raise exception 'tk_bad_patch' using errcode = '22023';
      end if;
    end if;
  end if;

  -- the key between the neighbors (mirrors TK_manualKeyBetween in TK_viewLogic.js)
  if p_before is null then
    v_key := case when p_after is not null and v_ka is not null then v_ka - 1024 else 1024 end;
  elsif v_kb is null then
    v_key := null;                                      -- no room: renumber
  elsif p_after is null or v_ka is null then
    v_key := v_kb + 1024;
  elsif v_kb < v_ka and (v_ka - v_kb) > 0.000001 then
    v_key := (v_kb + v_ka) / 2;
  else
    v_key := null;                                      -- too close or out of order: renumber
  end if;

  if v_key is null then
    if p_order is null then
      raise exception 'tk_bad_patch' using errcode = '22023';
    end if;
    -- the visible order without the moved row (first copy of each id kept)
    select coalesce(array_agg(s.x order by s.o), '{}'::uuid[]) into v_order
      from (select u.x, min(u.o) as o
              from unnest(p_order) with ordinality as u(x, o)
             where u.x is not null and u.x <> p_task
             group by u.x) s;
    v_pos := null;
    if p_before is not null then v_pos := array_position(v_order, p_before); end if;
    if v_pos is not null then
      v_pos := v_pos + 1;
    elsif p_after is not null and array_position(v_order, p_after) is not null then
      v_pos := array_position(v_order, p_after);
    elsif p_before is null then
      v_pos := 1;
    else
      v_pos := cardinality(v_order) + 1;
    end if;
    v_order := v_order[1:v_pos - 1] || p_task || v_order[v_pos:cardinality(v_order)];
    -- renumber through the moved row and through the last row that already has a key
    v_cut := v_pos;
    for v_i in 1 .. cardinality(v_order) loop
      if v_order[v_i] <> p_task
         and exists (select 1 from public.staff_reminders x where x.id = v_order[v_i] and x.sort_key is not null) then
        v_cut := greatest(v_cut, v_i);
      end if;
    end loop;
    for v_i in 1 .. v_cut loop
      v_id := v_order[v_i];
      v_new := 1024 * v_i;
      if v_id = p_task then
        v_key := v_new;
        continue;
      end if;
      select x.sort_key into v_cur from public.staff_reminders x where x.id = v_id;
      if not found then continue; end if;
      if v_cur is not distinct from v_new then continue; end if;
      if public.tk__bulk_access(v_id) is not null then
        v_skipped := v_skipped + 1;
        continue;
      end if;
      begin
        update public.staff_reminders set sort_key = v_new where id = v_id returning updated_at into v_upd;
        v_rows := v_rows || jsonb_build_array(jsonb_build_object('id', v_id, 'sort_key', v_new, 'updated_at', v_upd));
        v_renorm := v_renorm + 1;
      exception when others then
        v_skipped := v_skipped + 1;
      end;
    end loop;
  end if;

  update public.staff_reminders
     set sort_key = v_key,
         section = v_section
   where id = p_task;
  select * into a from public.staff_reminders x where x.id = p_task;
  if a.sort_key is distinct from v_key or a.section is distinct from v_section then
    raise exception 'tk_forbidden' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'id', a.id, 'sort_key', a.sort_key, 'section', a.section, 'updated_at', a.updated_at,
    'rows', v_rows, 'renormalized', v_renorm, 'skipped', v_skipped);
end $$;

revoke all on function public.tk_reorder(uuid, uuid, uuid, text, boolean, uuid[]) from public, anon;
grant execute on function public.tk_reorder(uuid, uuid, uuid, text, boolean, uuid[]) to authenticated;

comment on function public.tk_reorder(uuid, uuid, uuid, text, boolean, uuid[]) is
  'Slate app P2: moves one task between two neighbors (manual order); optional same-project section change; renumbers the group when keys run out of room.';
