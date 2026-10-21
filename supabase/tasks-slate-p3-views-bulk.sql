-- =====================================================================
-- Slate app P3: named saved views + bulk Status, Priority and Section
-- (spec-desk-fullpage section 9, P3). Additive only: two new tables and
-- three new functions. Nothing the portal Slate page reads is changed.
-- Re-runnable. Apply it whole.
--
--   1. tk_saved_views: several named views per person per scope. The
--      existing single saved view (per person, per browser, localStorage)
--      is NOT migrated or deleted; the Slate app shows it as "Default".
--      RLS: a person reads, writes and deletes only their own rows; the
--      owner is stamped from the JWT by a trigger, never from the client.
--      Name 1-60 characters, unique per person and scope (any case), at
--      most 30 views per person per scope, "Default" is reserved.
--   2. tk_field_ops: the undo log for the new bulk kinds (same idea as
--      tk_undo_ops; a separate table so the live undo function and its
--      check constraint stay untouched). RLS on, no policies, no grants.
--   3. tk_bulk_set(p_ids, p_patch, p_today): exactly one of
--        {"status": "todo" | "in_progress" | "waiting_client"}
--        {"priority": "low" | "normal" | "high"}
--        {"section": "<name>" | null}
--      Up to 100 tasks; each task runs in its own exception block and
--      comes back done or skipped with a reason code. Done is NOT a value
--      here: the app sends Done through tk_bulk_complete (the Complete
--      path: review gate, recurring roll-forward). Ready for review is not
--      bulk-settable (it notifies reviewers); rows in review are skipped
--      (in_review) and done rows are skipped (done_use_reopen). Status goes
--      through tk_set_status per row, the same path as the drawer. Section
--      must be one of the task's own project's sections (matched without
--      regard to case, stored as the project spells it); no project gives
--      no_project, a missing section gives section_missing; null clears.
--   4. tk_undo_fields(p_op): the same person, within 10 minutes, once. A
--      task that changed since is skipped (changed_since).
-- New reason codes (client text in TK_viewLogic.js TK_BULK_REASONS):
--   done_use_reopen, no_project, section_missing (plus the existing ones).
-- Applied to production 2026-10-21 (migration tasks_slate_p3_views_bulk).
-- =====================================================================

-- 1. Saved views ----------------------------------------------------------
create table if not exists public.tk_saved_views (
  id uuid primary key default gen_random_uuid(),
  owner_email text not null default lower(coalesce(auth.jwt() ->> 'email', '')),
  scope text not null,
  name text not null,
  view jsonb not null,
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tk_saved_views_scope_check check (scope ~ '^[a-z][a-z0-9_]{0,39}$'),
  constraint tk_saved_views_name_check check (char_length(name) between 1 and 60 and name = btrim(name)),
  constraint tk_saved_views_view_check check (jsonb_typeof(view) = 'object' and octet_length(view::text) <= 4000)
);
create unique index if not exists tk_saved_views_owner_scope_name_uq
  on public.tk_saved_views (owner_email, scope, lower(name));
create index if not exists tk_saved_views_owner_scope_pos_idx
  on public.tk_saved_views (owner_email, scope, position);

create or replace function public.tk_saved_views_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_api boolean := current_user in ('anon', 'authenticated');
begin
  if tg_op = 'INSERT' then
    if v_me <> '' then
      new.owner_email := v_me;                       -- never trust a client-supplied owner
    elsif v_api then
      raise exception 'tk_forbidden' using errcode = '42501';
    else
      new.owner_email := lower(coalesce(nullif(btrim(new.owner_email), ''), ''));
    end if;
    if new.owner_email = '' then
      raise exception 'tk_forbidden' using errcode = '42501';
    end if;
  else
    new.owner_email := old.owner_email;              -- the owner, scope and birth never move
    new.scope := old.scope;
    new.created_at := old.created_at;
    new.updated_at := now();
  end if;
  new.name := btrim(regexp_replace(coalesce(new.name, ''), '\s+', ' ', 'g'));
  if lower(new.name) = 'default' then
    raise exception 'tk_name_reserved' using errcode = '22023';
  end if;
  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(hashtext('tk_saved_views:' || new.owner_email || ':' || new.scope));
    if (select count(*) from public.tk_saved_views x where x.owner_email = new.owner_email and x.scope = new.scope) >= 30 then
      raise exception 'tk_too_many_views' using errcode = '22023';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists tk_saved_views_guard on public.tk_saved_views;
create trigger tk_saved_views_guard
  before insert or update on public.tk_saved_views
  for each row execute function public.tk_saved_views_guard();

alter table public.tk_saved_views enable row level security;
revoke all on table public.tk_saved_views from public, anon;
grant select, insert, update, delete on table public.tk_saved_views to authenticated;
revoke truncate, references, trigger on table public.tk_saved_views from authenticated, anon, public;  -- TRUNCATE would skip RLS

drop policy if exists "tk saved views read own" on public.tk_saved_views;
create policy "tk saved views read own" on public.tk_saved_views
  for select to authenticated
  using (public.is_active_staff() and owner_email = lower(coalesce(auth.jwt() ->> 'email', '')));
drop policy if exists "tk saved views insert own" on public.tk_saved_views;
create policy "tk saved views insert own" on public.tk_saved_views
  for insert to authenticated
  with check (public.is_active_staff() and owner_email = lower(coalesce(auth.jwt() ->> 'email', '')));
drop policy if exists "tk saved views update own" on public.tk_saved_views;
create policy "tk saved views update own" on public.tk_saved_views
  for update to authenticated
  using (public.is_active_staff() and owner_email = lower(coalesce(auth.jwt() ->> 'email', '')))
  with check (public.is_active_staff() and owner_email = lower(coalesce(auth.jwt() ->> 'email', '')));
drop policy if exists "tk saved views delete own" on public.tk_saved_views;
create policy "tk saved views delete own" on public.tk_saved_views
  for delete to authenticated
  using (public.is_active_staff() and owner_email = lower(coalesce(auth.jwt() ->> 'email', '')));

-- 2. Undo log for the new bulk kinds --------------------------------------
create table if not exists public.tk_field_ops (
  id uuid primary key default gen_random_uuid(),
  actor_email text not null,
  kind text not null check (kind in ('set_status', 'set_priority', 'set_section')),
  task_ids uuid[] not null,
  before jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '10 minutes',
  undone_at timestamptz
);
create index if not exists tk_field_ops_actor_idx on public.tk_field_ops (actor_email, created_at);
alter table public.tk_field_ops enable row level security;
revoke all on table public.tk_field_ops from public, anon, authenticated;

-- 3. Bulk status / priority / section -------------------------------------
create or replace function public.tk_bulk_set(p_ids uuid[], p_patch jsonb, p_today date default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_ids uuid[];
  v_id uuid;
  r public.staff_reminders%rowtype;
  a public.staff_reminders%rowtype;
  v_reason text;
  v_key text;
  v_status text;
  v_priority text;
  v_section text;
  v_secs text[];
  v_match text;
  v_new text;
  v_op uuid;
  v_done jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_entries jsonb := '[]'::jsonb;
begin
  -- the patch: one known key, a known value
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or (select count(*) from jsonb_object_keys(p_patch)) <> 1 then
    raise exception 'tk_bad_patch' using errcode = '22023';
  end if;
  select k into v_key from jsonb_object_keys(p_patch) k;
  if v_key not in ('status', 'priority', 'section') then
    raise exception 'tk_bad_patch' using errcode = '22023';
  end if;
  if v_key = 'status' then
    if jsonb_typeof(p_patch -> 'status') <> 'string' or (p_patch ->> 'status') not in ('todo', 'in_progress', 'waiting_client') then
      raise exception 'tk_bad_patch' using errcode = '22023';   -- done goes through tk_bulk_complete; review is not bulk
    end if;
    v_status := p_patch ->> 'status';
  elsif v_key = 'priority' then
    if jsonb_typeof(p_patch -> 'priority') <> 'string' or (p_patch ->> 'priority') not in ('low', 'normal', 'high') then
      raise exception 'tk_bad_patch' using errcode = '22023';
    end if;
    v_priority := p_patch ->> 'priority';
  else
    if jsonb_typeof(p_patch -> 'section') not in ('string', 'null') then
      raise exception 'tk_bad_patch' using errcode = '22023';
    end if;
    v_section := nullif(btrim(coalesce(p_patch ->> 'section', '')), '');
    if v_section is not null and char_length(v_section) > 60 then
      raise exception 'tk_bad_patch' using errcode = '22023';
    end if;
  end if;

  v_ids := public.tk__bulk_begin(p_ids);   -- staff check, 100 cap, de-dupe
  delete from public.tk_field_ops where actor_email = v_me and created_at < now() - interval '1 day';

  foreach v_id in array v_ids loop
    v_reason := public.tk__bulk_access(v_id);
    v_new := null;
    if v_reason is null then
      select * into r from public.staff_reminders x where x.id = v_id;
      if v_key = 'status' then
        if r.status = 'done' then v_reason := 'done_use_reopen';
        elsif r.status = 'ready_for_review' then v_reason := 'in_review';
        elsif r.status = v_status then v_reason := 'no_change';
        end if;
      elsif v_key = 'priority' then
        if r.priority = v_priority then v_reason := 'no_change'; end if;
      else
        if v_section is null then
          if r.section is null then v_reason := 'no_change'; end if;
        elsif r.project_id is null then
          v_reason := 'no_project';
        else
          select p.sections into v_secs from public.tk_projects p where p.id = r.project_id;
          select s into v_match from unnest(coalesce(v_secs, '{}'::text[])) s where lower(s) = lower(v_section) limit 1;
          if v_match is null then v_reason := 'section_missing';
          elsif r.section is not distinct from v_match then v_reason := 'no_change';
          else v_new := v_match;
          end if;
        end if;
      end if;
    end if;
    if v_reason is null then
      begin
        if v_key = 'status' then
          perform public.tk_set_status(v_id, v_status, null, p_today);   -- the drawer's path, row by row
        elsif v_key = 'priority' then
          update public.staff_reminders set priority = v_priority where id = v_id;
        else
          update public.staff_reminders set section = v_new where id = v_id;   -- null clears
        end if;
        select * into a from public.staff_reminders x where x.id = v_id;
        if (v_key = 'status' and a.status is distinct from v_status)
           or (v_key = 'priority' and a.priority is distinct from v_priority)
           or (v_key = 'section' and a.section is distinct from v_new) then
          raise exception 'tk_forbidden';
        end if;
        v_entries := v_entries || jsonb_build_array(jsonb_build_object(
          'id', r.id, 'status', r.status, 'priority', r.priority, 'section', r.section,
          'updated_at_after', a.updated_at,
          'after', jsonb_build_object('status', a.status, 'priority', a.priority, 'section', a.section)));
        v_done := v_done || to_jsonb(v_id::text);
      exception when others then
        v_reason := public.tk__bulk_reason(sqlerrm);
      end;
    end if;
    if v_reason is not null then
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('id', v_id, 'reason', v_reason));
    end if;
  end loop;

  if jsonb_array_length(v_entries) > 0 then
    insert into public.tk_field_ops (actor_email, kind, task_ids, before)
    select v_me, 'set_' || v_key, array_agg((e ->> 'id')::uuid), v_entries
      from jsonb_array_elements(v_entries) e
    returning id into v_op;
  end if;
  return jsonb_build_object('op_id', v_op, 'kind', 'set_' || v_key, 'done', v_done, 'skipped', v_skipped);
end $$;

-- 4. Undo for the new kinds -------------------------------------------------
create or replace function public.tk_undo_fields(p_op uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  o public.tk_field_ops%rowtype;
  e jsonb;
  v_id uuid;
  r public.staff_reminders%rowtype;
  v_reason text;
  v_done jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
begin
  if v_me = '' or not public.is_active_staff() then
    raise exception 'tk_forbidden' using errcode = '42501';
  end if;
  select * into o from public.tk_field_ops x where x.id = p_op for update;
  if not found or o.actor_email <> v_me then
    raise exception 'tk_not_found' using errcode = '42501';   -- someone else's op looks missing
  end if;
  if o.undone_at is not null then
    raise exception 'tk_undo_used' using errcode = '22023';
  end if;
  if now() > o.expires_at then
    raise exception 'tk_undo_expired' using errcode = '22023';
  end if;
  update public.tk_field_ops set undone_at = now() where id = p_op;

  for e in select * from jsonb_array_elements(o.before) loop
    v_id := (e ->> 'id')::uuid;
    v_reason := null;
    begin
      select * into r from public.staff_reminders x where x.id = v_id for update;
      if not found or not public.tk_can_edit_task(v_id) or not public.tk_can_read_task(v_id) then
        v_reason := 'no_access';
      elsif r.updated_at is distinct from (e ->> 'updated_at_after')::timestamptz
         or r.status is distinct from (e -> 'after' ->> 'status')
         or r.priority is distinct from (e -> 'after' ->> 'priority')
         or r.section is distinct from (e -> 'after' ->> 'section') then
        v_reason := 'changed_since';
      elsif o.kind = 'set_status' then
        update public.staff_reminders set status = e ->> 'status' where id = v_id;
      elsif o.kind = 'set_priority' then
        update public.staff_reminders set priority = e ->> 'priority' where id = v_id;
      elsif o.kind = 'set_section' then
        update public.staff_reminders set section = e ->> 'section' where id = v_id;   -- null clears
      end if;
    exception when others then
      v_reason := public.tk__bulk_reason(sqlerrm);
    end;
    if v_reason is null then
      v_done := v_done || to_jsonb(v_id::text);
    else
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('id', v_id, 'reason', v_reason));
    end if;
  end loop;

  return jsonb_build_object('op_id', o.id, 'kind', o.kind, 'done', v_done, 'skipped', v_skipped,
                            'spawned_removed', 0, 'spawned_kept', '[]'::jsonb,
                            'emails_cancelled', 0, 'already_emailed', '[]'::jsonb);
end $$;

revoke all on function public.tk_saved_views_guard() from public, anon, authenticated;
revoke all on function public.tk_bulk_set(uuid[], jsonb, date) from public, anon;
grant execute on function public.tk_bulk_set(uuid[], jsonb, date) to authenticated;
revoke all on function public.tk_undo_fields(uuid) from public, anon;
grant execute on function public.tk_undo_fields(uuid) to authenticated;
