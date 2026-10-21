-- =====================================================================
-- Slate app P2 review fixes: manual order becomes per person.
--
-- Why: tasks-slate-p2-reorder.sql wrote manual order into the shared
-- column staff_reminders.sort_key. Portal lists (TK_sortTasks, the Desk,
-- subtask order) already sort keyed rows first, so one previewer's drag
-- would have changed everyone's portal order, and a renumber rewrote keys
-- on other people's tasks. The owner rule is that with the preview off
-- every portal looks exactly as today.
--
-- Fix (additive only, no data deleted, staff_reminders.sort_key is never
-- written again by the Slate app):
--   1. tk_manual_order: one row per (owner, scope, task) with the person's
--      own key. RLS: a person reads only their own rows. No direct writes
--      from the API (no insert/update/delete grants); the RPC below writes.
--      The owner always comes from the JWT.
--   2. tk_manual_reorder(p_scope, p_task, p_before, p_after, p_section,
--      p_set_section, p_order): same rules as tk_reorder, but the keys live
--      in tk_manual_order for the caller and scope. Ordering needs only
--      read access to the tasks; a section change (project lists only, the
--      scope's own project) still needs the per-task edit check
--      (tk__bulk_access) and is the only write to staff_reminders.
--   3. tk_reorder (the old shared-column RPC) is retired: execute revoked
--      from authenticated, anon and public. It is not dropped.
--
-- Scopes: 'my' or 'list:project:<id>' / 'list:client:<id>' /
-- 'list:person:<id>' (the app's list keys). At most 2000 rows per person
-- per scope; p_order at most 500 ids.
--
-- Production check before this file: 0 rows in staff_reminders had a
-- non-null sort_key (the P2 self-test rolled back; nothing live changed).
-- Applied to production 2026-10-21 (migration tasks_slate_p2_fixes).
-- =====================================================================

-- 1. Per-person manual order ----------------------------------------------
create table if not exists public.tk_manual_order (
  owner_email text not null,
  scope text not null,
  task_id uuid not null references public.staff_reminders(id) on delete cascade,
  sort_key double precision not null,
  updated_at timestamptz not null default now(),
  primary key (owner_email, scope, task_id),
  constraint tk_manual_order_scope_check
    check (scope ~ '^(my|list:(project|client|person):[A-Za-z0-9_.@+-]{1,120})$'),
  constraint tk_manual_order_key_check
    check (sort_key > -1e15 and sort_key < 1e15)     -- no NaN (sorts above all numbers in Postgres), no infinity
);
create index if not exists tk_manual_order_task_idx on public.tk_manual_order (task_id);

alter table public.tk_manual_order enable row level security;
revoke all on table public.tk_manual_order from public, anon, authenticated;
grant select on table public.tk_manual_order to authenticated;

drop policy if exists "tk manual order read own" on public.tk_manual_order;
create policy "tk manual order read own" on public.tk_manual_order
  for select to authenticated
  using (public.is_active_staff() and owner_email = lower(coalesce(auth.jwt() ->> 'email', '')));

-- 2. The RPC ---------------------------------------------------------------
create or replace function public.tk_manual_reorder(
  p_scope text,
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
  v_kb double precision;
  v_ka double precision;
  v_key double precision;
  v_secs text[];
  v_section text;
  v_sec_changed boolean := false;
  v_order uuid[];
  v_pos int;
  v_cut int;
  v_i int;
  v_id uuid;
  v_cur double precision;
  v_new double precision;
  v_rows jsonb := '[]'::jsonb;
  v_renorm int := 0;
  v_skipped int := 0;
  v_upd timestamptz;
begin
  if v_me = '' or not public.is_active_staff() then
    raise exception 'tk_forbidden' using errcode = '42501';
  end if;
  if p_scope is null or p_scope !~ '^(my|list:(project|client|person):[A-Za-z0-9_.@+-]{1,120})$' then
    raise exception 'tk_bad_patch' using errcode = '22023';
  end if;
  if p_task is null or p_task = p_before or p_task = p_after
     or (p_before is not null and p_before = p_after) then
    raise exception 'tk_bad_patch' using errcode = '22023';
  end if;
  if coalesce(cardinality(p_order), 0) > 500 then
    raise exception 'tk_too_many' using errcode = '22023';
  end if;

  -- one move at a time per person and scope
  perform pg_advisory_xact_lock(hashtext('tk_manual_order:' || v_me || ':' || p_scope));

  -- the moved task: readable and live (ordering is personal: no edit right needed)
  select * into r from public.staff_reminders x where x.id = p_task;
  if not found or not public.tk_can_read_task(p_task) then
    raise exception 'tk_forbidden' using errcode = '42501';
  end if;
  if r.trashed_with_project is not null then
    raise exception 'tk_task_in_trash' using errcode = '22023';
  end if;
  if r.deleted_at is not null then
    raise exception 'tk_forbidden' using errcode = '42501';
  end if;

  -- neighbors: readable, live rows only (the app only sends rows it shows)
  if p_before is not null then
    if not public.tk_can_read_task(p_before)
       or not exists (select 1 from public.staff_reminders x where x.id = p_before and x.deleted_at is null) then
      raise exception 'tk_not_found' using errcode = '22023';
    end if;
    select m.sort_key into v_kb from public.tk_manual_order m
     where m.owner_email = v_me and m.scope = p_scope and m.task_id = p_before;
  end if;
  if p_after is not null then
    if not public.tk_can_read_task(p_after)
       or not exists (select 1 from public.staff_reminders x where x.id = p_after and x.deleted_at is null) then
      raise exception 'tk_not_found' using errcode = '22023';
    end if;
    select m.sort_key into v_ka from public.tk_manual_order m
     where m.owner_email = v_me and m.scope = p_scope and m.task_id = p_after;
  end if;

  -- section: project lists only, the scope's own project, one of its
  -- sections; null clears. Needs the same per-task edit check as the bulk tools.
  v_section := r.section;
  if coalesce(p_set_section, false) then
    if r.project_id is null or p_scope <> 'list:project:' || r.project_id::text then
      raise exception 'tk_bad_patch' using errcode = '22023';
    end if;
    v_reason := public.tk__bulk_access(p_task);
    if v_reason = 'in_trash' then
      raise exception 'tk_task_in_trash' using errcode = '22023';
    elsif v_reason is not null then
      raise exception 'tk_forbidden' using errcode = '42501';
    end if;
    if p_section is null or btrim(p_section) = '' then
      v_section := null;
    else
      select p.sections into v_secs from public.tk_projects p where p.id = r.project_id;
      select s into v_section from unnest(coalesce(v_secs, '{}'::text[])) s where lower(s) = lower(btrim(p_section)) limit 1;
      if v_section is null then
        raise exception 'tk_bad_patch' using errcode = '22023';
      end if;
    end if;
    v_sec_changed := v_section is distinct from r.section;
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
         and exists (select 1 from public.tk_manual_order m
                      where m.owner_email = v_me and m.scope = p_scope and m.task_id = v_order[v_i]) then
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
      -- only the caller's own key rows, and only for live tasks they can read
      if not public.tk_can_read_task(v_id)
         or not exists (select 1 from public.staff_reminders x where x.id = v_id and x.deleted_at is null) then
        v_skipped := v_skipped + 1;
        continue;
      end if;
      v_cur := null;
      select m.sort_key into v_cur from public.tk_manual_order m
       where m.owner_email = v_me and m.scope = p_scope and m.task_id = v_id;
      if v_cur is not distinct from v_new then continue; end if;
      insert into public.tk_manual_order (owner_email, scope, task_id, sort_key, updated_at)
      values (v_me, p_scope, v_id, v_new, now())
      on conflict (owner_email, scope, task_id) do update set sort_key = excluded.sort_key, updated_at = now();
      v_rows := v_rows || jsonb_build_array(jsonb_build_object('id', v_id, 'sort_key', v_new));
      v_renorm := v_renorm + 1;
    end loop;
  end if;

  insert into public.tk_manual_order (owner_email, scope, task_id, sort_key, updated_at)
  values (v_me, p_scope, p_task, v_key, now())
  on conflict (owner_email, scope, task_id) do update set sort_key = excluded.sort_key, updated_at = now();

  if (select count(*) from public.tk_manual_order m where m.owner_email = v_me and m.scope = p_scope) > 2000 then
    raise exception 'tk_too_many' using errcode = '22023';
  end if;

  v_upd := r.updated_at;
  if v_sec_changed then
    update public.staff_reminders set section = v_section where id = p_task returning updated_at into v_upd;
    if (select x.section from public.staff_reminders x where x.id = p_task) is distinct from v_section then
      raise exception 'tk_forbidden' using errcode = '42501';
    end if;
  end if;

  return jsonb_build_object(
    'id', p_task, 'sort_key', v_key, 'section', v_section, 'section_changed', v_sec_changed,
    'updated_at', v_upd, 'rows', v_rows, 'renormalized', v_renorm, 'skipped', v_skipped);
end $$;

revoke all on function public.tk_manual_reorder(text, uuid, uuid, uuid, text, boolean, uuid[]) from public, anon;
grant execute on function public.tk_manual_reorder(text, uuid, uuid, uuid, text, boolean, uuid[]) to authenticated;

comment on function public.tk_manual_reorder(text, uuid, uuid, uuid, text, boolean, uuid[]) is
  'Slate app P2: moves one task between two neighbors in the caller''s own manual order (tk_manual_order); optional same-project section change through the per-task edit check.';

-- 3. Retire the shared-column RPC (not dropped) -----------------------------
revoke execute on function public.tk_reorder(uuid, uuid, uuid, text, boolean, uuid[]) from public, anon, authenticated;
comment on function public.tk_reorder(uuid, uuid, uuid, text, boolean, uuid[]) is
  'RETIRED 2026-10-21 (Slate app P2 review): wrote the shared staff_reminders.sort_key. Execute revoked; use tk_manual_reorder.';
