-- Slate plus: custom fields on tasks. Spec: docs/slateplus-customfields-spec.md
-- Applied to production 2026-10-28 (migrations slateplus_customfields, slateplus_customfields_value_set_fix
-- and slateplus_customfields_review_fixes).
-- Self-test: supabase/slateplus-customfields-tests.sql (rolls back; 69/69 passed after the review fixes).
-- Additive only: two new tables, one validation trigger on the new values table, new RPCs.
-- Nothing existing is altered; staff_reminders is untouched. Inert until someone with the
-- Slate plus preview makes a field. Re-runnable. Never deletes data (fields are archived,
-- dropdown options in use are retired, cleared values keep their row with value null).

-- 1. Tables ------------------------------------------------------------------
create table if not exists public.tk_custom_fields (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('project', 'client')),
  project_id uuid references public.tk_projects(id) on delete cascade,
  client_id text references public.clients(id) on delete cascade,
  name text not null check (name = btrim(name) and char_length(name) between 1 and 40),
  type text not null check (type in ('text', 'number', 'dropdown', 'date', 'checkbox', 'person')),
  options jsonb not null default '[]'::jsonb
    check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) <= 40),
  position integer not null default 0,
  archived_at timestamptz,
  archived_by text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_by text,
  updated_at timestamptz not null default now(),
  check ((scope = 'project' and project_id is not null and client_id is null)
      or (scope = 'client' and client_id is not null and project_id is null)),
  check (type = 'dropdown' or options = '[]'::jsonb)
);
create unique index if not exists tk_custom_fields_project_name_uq
  on public.tk_custom_fields (project_id, lower(name)) where scope = 'project' and archived_at is null;
create unique index if not exists tk_custom_fields_client_name_uq
  on public.tk_custom_fields (client_id, lower(name)) where scope = 'client' and archived_at is null;
create index if not exists tk_custom_fields_project_idx on public.tk_custom_fields (project_id) where project_id is not null;
create index if not exists tk_custom_fields_client_idx on public.tk_custom_fields (client_id) where client_id is not null;
alter table public.tk_custom_fields enable row level security;
drop policy if exists "tk cf staff read" on public.tk_custom_fields;
create policy "tk cf staff read" on public.tk_custom_fields
  for select to authenticated
  using (public.is_active_staff()
         and case when scope = 'project' then public.tk_can_see_project(project_id)
                  else public.can_access_client(client_id) end);
revoke all on public.tk_custom_fields from anon, authenticated;
grant select on public.tk_custom_fields to authenticated;

create table if not exists public.tk_custom_field_values (
  field_id uuid not null references public.tk_custom_fields(id) on delete cascade,
  task_id uuid not null references public.staff_reminders(id) on delete cascade,
  value jsonb,
  updated_by text,
  updated_at timestamptz not null default now(),
  primary key (field_id, task_id)
);
create index if not exists tk_custom_field_values_task_idx on public.tk_custom_field_values (task_id);
alter table public.tk_custom_field_values enable row level security;
drop policy if exists "tk cf values staff read" on public.tk_custom_field_values;
create policy "tk cf values staff read" on public.tk_custom_field_values
  for select to authenticated
  using (public.is_active_staff() and public.tk_can_read_task(task_id)
         and exists (select 1 from public.tk_custom_fields f
                       join public.staff_reminders r on r.id = tk_custom_field_values.task_id
                      where f.id = tk_custom_field_values.field_id
                        and ((f.scope = 'project' and f.project_id = r.project_id
                              and public.tk_can_see_project(f.project_id))
                          or (f.scope = 'client' and f.client_id = r.client_id
                              and public.can_access_client(f.client_id)))));
revoke all on public.tk_custom_field_values from anon, authenticated;
grant select on public.tk_custom_field_values to authenticated;

-- 2. Internal helpers --------------------------------------------------------
-- Who may add, edit, order, archive or restore fields on a target.
create or replace function public.tk__cf_can_manage(p_scope text, p_project uuid, p_client text)
returns boolean language plpgsql stable security definer set search_path to 'public', 'pg_temp' as $$
begin
  if public.tk__me() = '' or not public.is_active_staff() then
    return false;
  end if;
  if p_scope = 'project' then
    return p_project is not null
       and public.tk_can_manage_project(p_project)
       and exists (select 1 from tk_projects p where p.id = p_project and p.archived_at is null and p.trashed_at is null);
  elsif p_scope = 'client' then
    return p_client is not null and public.is_active_staff_admin() and public.can_access_client(p_client);
  end if;
  return false;
end $$;

-- Validates a dropdown option list and keeps every old option still used by a value (as
-- retired). p_new: [{id?, label, retired?}]. Missing ids are generated. Raises tk_cf_bad_options.
create or replace function public.tk__cf_merge_options(p_new jsonb, p_old jsonb, p_field uuid)
returns jsonb language plpgsql volatile security definer set search_path to 'public', 'pg_temp' as $$
declare
  v_out jsonb := '[]'::jsonb;
  v_e jsonb;
  v_id text;
  v_label text;
  v_ret boolean;
  v_ids text[] := '{}';
  v_labels text[] := '{}';
  v_active int := 0;
begin
  if p_new is null or jsonb_typeof(p_new) <> 'array' then
    raise exception 'tk_cf_bad_options: options must be a list' using errcode = '22023';
  end if;
  for v_e in select x from jsonb_array_elements(p_new) x loop
    if jsonb_typeof(v_e) <> 'object' or jsonb_typeof(v_e -> 'label') is distinct from 'string' then
      raise exception 'tk_cf_bad_options: each option needs a label' using errcode = '22023';
    end if;
    v_label := btrim(v_e ->> 'label');
    if char_length(v_label) < 1 or char_length(v_label) > 40 then
      raise exception 'tk_cf_bad_options: an option label is 1 to 40 characters' using errcode = '22023';
    end if;
    v_id := case when jsonb_typeof(v_e -> 'id') = 'string' then btrim(v_e ->> 'id') else '' end;
    if v_id = '' then
      v_id := 'o' || substr(md5(gen_random_uuid()::text), 1, 10);
    end if;
    if v_id !~ '^[A-Za-z0-9_-]{1,40}$' or v_id = any (v_ids) then
      raise exception 'tk_cf_bad_options: option ids must be unique' using errcode = '22023';
    end if;
    v_ret := coalesce(jsonb_typeof(v_e -> 'retired') = 'boolean' and (v_e ->> 'retired')::boolean, false);
    if not v_ret then
      if lower(v_label) = any (v_labels) then
        raise exception 'tk_cf_bad_options: two options have the same name' using errcode = '22023';
      end if;
      v_labels := v_labels || lower(v_label);
      v_active := v_active + 1;
    end if;
    v_ids := v_ids || v_id;
    v_out := v_out || jsonb_build_array(jsonb_build_object('id', v_id, 'label', v_label, 'retired', v_ret));
  end loop;
  if v_active < 1 or v_active > 20 then
    raise exception 'tk_cf_bad_options: a dropdown has 1 to 20 options' using errcode = '22023';
  end if;
  -- Old options dropped from the list but still used on a task stay, retired.
  if p_old is not null and jsonb_typeof(p_old) = 'array' and p_field is not null then
    for v_e in select x from jsonb_array_elements(p_old) x loop
      v_id := v_e ->> 'id';
      if v_id is null or v_id = any (v_ids) then continue; end if;
      if exists (select 1 from tk_custom_field_values cv where cv.field_id = p_field and cv.value = to_jsonb(v_id)) then
        v_ids := v_ids || v_id;
        v_out := v_out || jsonb_build_array(jsonb_build_object('id', v_id, 'label', coalesce(v_e ->> 'label', v_id), 'retired', true));
      end if;
    end loop;
  end if;
  if jsonb_array_length(v_out) > 40 then
    raise exception 'tk_cf_bad_options: too many retired options; clear some tasks first' using errcode = '22023';
  end if;
  return v_out;
end $$;

-- 3. Validation trigger on values ---------------------------------------------
create or replace function public.tk_custom_field_values_check()
returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare
  f record;
  t record;
  v jsonb := new.value;
  s text;
  n numeric;
  d date;
  o jsonb;
begin
  if tg_op = 'UPDATE' and (new.field_id is distinct from old.field_id or new.task_id is distinct from old.task_id) then
    raise exception 'tk_cf_bad_value: a value cannot move' using errcode = '22023';
  end if;
  -- FOR SHARE: an options edit (FOR UPDATE in tk_cf_field_save) waits for this value to
  -- commit, so its in-use check sees it; and this waits for an edit already under way.
  select * into f from tk_custom_fields where id = new.field_id for share;
  if not found then
    raise exception 'tk_cf_not_found' using errcode = '22023';
  end if;
  if v is not null and jsonb_typeof(v) = 'null' then
    v := null;
  end if;
  -- Same value again: a no-op (keeps who set it and when).
  if tg_op = 'UPDATE' and v is not distinct from old.value then
    return old;
  end if;
  if f.archived_at is not null then
    raise exception 'tk_cf_archived: that field is archived' using errcode = '22023';
  end if;
  select r.project_id, r.client_id into t from staff_reminders r where r.id = new.task_id;
  -- coalesce: a task with no project (or client) gives null, which must count as "no".
  if not found
     or not coalesce((f.scope = 'project' and f.project_id = t.project_id)
                  or (f.scope = 'client' and f.client_id = t.client_id), false) then
    raise exception 'tk_cf_wrong_scope: that field is not on this task''s list' using errcode = '22023';
  end if;
  if v is not null then
    if f.type = 'text' then
      if jsonb_typeof(v) <> 'string' then
        raise exception 'tk_cf_bad_value: text expected' using errcode = '22023';
      end if;
      s := btrim(v #>> '{}');
      if s = '' then
        v := null;
      elsif char_length(s) > 500 then
        raise exception 'tk_cf_bad_value: 500 characters is the most' using errcode = '22023';
      else
        v := to_jsonb(s);
      end if;
    elsif f.type = 'number' then
      if jsonb_typeof(v) <> 'number' then
        raise exception 'tk_cf_bad_value: a number expected' using errcode = '22023';
      end if;
      n := (v #>> '{}')::numeric;
      if abs(n) >= 1e12 or n <> round(n, 6) then
        raise exception 'tk_cf_bad_value: number out of range' using errcode = '22023';
      end if;
      v := to_jsonb(n);
    elsif f.type = 'checkbox' then
      if jsonb_typeof(v) <> 'boolean' then
        raise exception 'tk_cf_bad_value: true or false expected' using errcode = '22023';
      end if;
    elsif f.type = 'date' then
      if jsonb_typeof(v) <> 'string' or (v #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$' then
        raise exception 'tk_cf_bad_value: a date (YYYY-MM-DD) expected' using errcode = '22023';
      end if;
      s := v #>> '{}';
      begin
        d := s::date;
      exception when others then
        raise exception 'tk_cf_bad_value: not a real date' using errcode = '22023';
      end;
      if to_char(d, 'YYYY-MM-DD') <> s or extract(year from d) < 1900 or extract(year from d) > 2200 then
        raise exception 'tk_cf_bad_value: not a real date' using errcode = '22023';
      end if;
    elsif f.type = 'dropdown' then
      if jsonb_typeof(v) <> 'string' then
        raise exception 'tk_cf_bad_value: an option expected' using errcode = '22023';
      end if;
      select x into o from jsonb_array_elements(f.options) x where x ->> 'id' = (v #>> '{}') limit 1;
      if o is null then
        raise exception 'tk_cf_bad_value: that option does not exist' using errcode = '22023';
      end if;
      if coalesce((o ->> 'retired')::boolean, false) then
        raise exception 'tk_cf_bad_value: that option is retired' using errcode = '22023';
      end if;
    elsif f.type = 'person' then
      if jsonb_typeof(v) <> 'string' then
        raise exception 'tk_cf_bad_value: a person expected' using errcode = '22023';
      end if;
      s := lower(btrim(v #>> '{}'));
      if not exists (select 1 from staff st where lower(st.email) = s and st.active) then
        raise exception 'tk_cf_bad_value: pick an active staff member' using errcode = '22023';
      end if;
      v := to_jsonb(s);
    end if;
  end if;
  new.value := v;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists tk_custom_field_values_check on public.tk_custom_field_values;
create trigger tk_custom_field_values_check
  before insert or update on public.tk_custom_field_values
  for each row execute function public.tk_custom_field_values_check();

-- 4. RPCs ------------------------------------------------------------------
-- Create (p_id null) or edit a field. p_target is the project id (uuid text) or client id.
create or replace function public.tk_cf_field_save(
  p_id uuid, p_scope text, p_target text, p_name text, p_type text, p_options jsonb default null)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare
  v_me text := public.tk__me();
  v_name text := btrim(coalesce(p_name, ''));
  v_f tk_custom_fields%rowtype;
  v_project uuid;
  v_client text;
  v_opts jsonb := '[]'::jsonb;
  v_n int;
begin
  if v_me = '' or not public.is_active_staff() then
    raise exception 'tk_forbidden' using errcode = '42501';
  end if;
  if char_length(v_name) < 1 or char_length(v_name) > 40 then
    raise exception 'tk_cf_bad_name: a field name is 1 to 40 characters' using errcode = '22023';
  end if;
  if p_id is null then
    if p_scope = 'project' then
      begin
        v_project := nullif(btrim(coalesce(p_target, '')), '')::uuid;
      exception when others then
        raise exception 'tk_bad_input' using errcode = '22023';
      end;
    elsif p_scope = 'client' then
      v_client := nullif(btrim(coalesce(p_target, '')), '');
    else
      raise exception 'tk_bad_input' using errcode = '22023';
    end if;
    if not public.tk__cf_can_manage(p_scope, v_project, v_client) then
      raise exception 'tk_forbidden' using errcode = '42501';
    end if;
    if p_type is null or p_type not in ('text', 'number', 'dropdown', 'date', 'checkbox', 'person') then
      raise exception 'tk_cf_bad_type' using errcode = '22023';
    end if;
    perform pg_advisory_xact_lock(hashtext('tk_cf:' || p_scope || ':' || coalesce(v_project::text, v_client)));
    select count(*) into v_n from tk_custom_fields
     where scope = p_scope and project_id is not distinct from v_project and client_id is not distinct from v_client
       and archived_at is null;
    if v_n >= 15 then
      raise exception 'tk_cf_limit: 15 fields is the most for one list' using errcode = '22023';
    end if;
    if exists (select 1 from tk_custom_fields
                where scope = p_scope and project_id is not distinct from v_project and client_id is not distinct from v_client
                  and archived_at is null and lower(name) = lower(v_name)) then
      raise exception 'tk_cf_name_taken' using errcode = '22023';
    end if;
    if p_type = 'dropdown' then
      v_opts := public.tk__cf_merge_options(p_options, null, null);
    end if;
    insert into tk_custom_fields (scope, project_id, client_id, name, type, options, position, created_by, updated_by)
    values (p_scope, v_project, v_client, v_name, p_type, v_opts,
            coalesce((select max(position) + 1 from tk_custom_fields
                       where scope = p_scope and project_id is not distinct from v_project
                         and client_id is not distinct from v_client), 0),
            v_me, v_me)
    returning * into v_f;
    return to_jsonb(v_f);
  end if;

  select * into v_f from tk_custom_fields where id = p_id;
  if not found or not public.tk__cf_can_manage(v_f.scope, v_f.project_id, v_f.client_id) then
    raise exception 'tk_forbidden' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('tk_cf:' || v_f.scope || ':' || coalesce(v_f.project_id::text, v_f.client_id)));
  -- Re-read under the lock (FOR UPDATE): a concurrent edit or value save is seen.
  select * into v_f from tk_custom_fields where id = p_id for update;
  if v_f.archived_at is not null then
    raise exception 'tk_cf_archived: restore the field first' using errcode = '22023';
  end if;
  if p_type is not null and p_type <> v_f.type then
    raise exception 'tk_cf_type_locked' using errcode = '22023';
  end if;
  if exists (select 1 from tk_custom_fields
              where scope = v_f.scope and project_id is not distinct from v_f.project_id
                and client_id is not distinct from v_f.client_id
                and archived_at is null and lower(name) = lower(v_name) and id <> v_f.id) then
    raise exception 'tk_cf_name_taken' using errcode = '22023';
  end if;
  v_opts := v_f.options;
  if v_f.type = 'dropdown' and p_options is not null then
    v_opts := public.tk__cf_merge_options(p_options, v_f.options, v_f.id);
  end if;
  update tk_custom_fields
     set name = v_name, options = v_opts, updated_by = v_me, updated_at = now()
   where id = v_f.id
  returning * into v_f;
  return to_jsonb(v_f);
end $$;

create or replace function public.tk_cf_field_archive(p_id uuid, p_archive boolean)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare
  v_me text := public.tk__me();
  v_f tk_custom_fields%rowtype;
  v_n int;
begin
  select * into v_f from tk_custom_fields where id = p_id;
  if v_me = '' or not found or not public.tk__cf_can_manage(v_f.scope, v_f.project_id, v_f.client_id) then
    raise exception 'tk_forbidden' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('tk_cf:' || v_f.scope || ':' || coalesce(v_f.project_id::text, v_f.client_id)));
  select * into v_f from tk_custom_fields where id = p_id for update;
  if coalesce(p_archive, true) then
    if v_f.archived_at is null then
      update tk_custom_fields set archived_at = now(), archived_by = v_me, updated_by = v_me, updated_at = now()
       where id = v_f.id returning * into v_f;
    end if;
    return to_jsonb(v_f);
  end if;
  if v_f.archived_at is null then
    return to_jsonb(v_f);
  end if;
  select count(*) into v_n from tk_custom_fields
   where scope = v_f.scope and project_id is not distinct from v_f.project_id
     and client_id is not distinct from v_f.client_id and archived_at is null;
  if v_n >= 15 then
    raise exception 'tk_cf_limit: 15 fields is the most for one list' using errcode = '22023';
  end if;
  if exists (select 1 from tk_custom_fields
              where scope = v_f.scope and project_id is not distinct from v_f.project_id
                and client_id is not distinct from v_f.client_id
                and archived_at is null and lower(name) = lower(v_f.name)) then
    raise exception 'tk_cf_name_taken' using errcode = '22023';
  end if;
  update tk_custom_fields
     set archived_at = null, archived_by = null, updated_by = v_me, updated_at = now(),
         position = coalesce((select max(position) + 1 from tk_custom_fields
                               where scope = v_f.scope and project_id is not distinct from v_f.project_id
                                 and client_id is not distinct from v_f.client_id and archived_at is null), 0)
   where id = v_f.id returning * into v_f;
  return to_jsonb(v_f);
end $$;

-- New order for ALL active fields of one list.
create or replace function public.tk_cf_field_order(p_ids uuid[])
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare
  v_f tk_custom_fields%rowtype;
  v_n int;
begin
  if p_ids is null or cardinality(p_ids) < 1 or cardinality(p_ids) > 15 then
    raise exception 'tk_cf_bad_order' using errcode = '22023';
  end if;
  select * into v_f from tk_custom_fields where id = p_ids[1];
  if not found or public.tk__me() = '' or not public.tk__cf_can_manage(v_f.scope, v_f.project_id, v_f.client_id) then
    raise exception 'tk_forbidden' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('tk_cf:' || v_f.scope || ':' || coalesce(v_f.project_id::text, v_f.client_id)));
  select count(*) into v_n from tk_custom_fields
   where scope = v_f.scope and project_id is not distinct from v_f.project_id
     and client_id is not distinct from v_f.client_id and archived_at is null;
  if v_n <> cardinality(p_ids)
     or (select count(distinct x) from unnest(p_ids) x) <> v_n
     or exists (select 1 from unnest(p_ids) x
                 where not exists (select 1 from tk_custom_fields c
                                    where c.id = x and c.scope = v_f.scope
                                      and c.project_id is not distinct from v_f.project_id
                                      and c.client_id is not distinct from v_f.client_id
                                      and c.archived_at is null)) then
    raise exception 'tk_cf_bad_order' using errcode = '22023';
  end if;
  update tk_custom_fields c set position = o.i - 1, updated_at = now()
    from unnest(p_ids) with ordinality o(id, i)
   where c.id = o.id;
  return jsonb_build_object('ok', true);
end $$;

-- Set (or clear with null) one value. Anyone who can edit the task.
create or replace function public.tk_cf_value_set(p_field uuid, p_task uuid, p_value jsonb)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare
  v_me text := public.tk__me();
  v_t record;
  v_out jsonb;
begin
  if v_me = '' or not public.is_active_staff() or p_field is null or p_task is null
     or not public.tk_can_edit_task(p_task) then
    raise exception 'tk_forbidden' using errcode = '42501';
  end if;
  select r.deleted_at, r.project_id into v_t from staff_reminders r where r.id = p_task;
  if v_t.deleted_at is not null then
    raise exception 'tk_task_in_trash' using errcode = '22023';
  end if;
  if v_t.project_id is not null and exists (select 1 from tk_projects p where p.id = v_t.project_id and p.trashed_at is not null) then
    raise exception 'tk_project_trashed' using errcode = '22023';
  end if;
  if v_t.project_id is not null and exists (select 1 from tk_projects p where p.id = v_t.project_id and p.archived_at is not null) then
    raise exception 'tk_project_archived' using errcode = '22023';
  end if;
  -- Update first, then insert (not INSERT ... ON CONFLICT): the BEFORE INSERT trigger would
  -- otherwise validate the proposed row first and refuse an unchanged retired option.
  update tk_custom_field_values set value = p_value, updated_by = v_me
   where field_id = p_field and task_id = p_task
  returning value into v_out;
  if not found then
    begin
      insert into tk_custom_field_values (field_id, task_id, value, updated_by)
      values (p_field, p_task, p_value, v_me)
      returning value into v_out;
    exception when unique_violation then
      update tk_custom_field_values set value = p_value, updated_by = v_me
       where field_id = p_field and task_id = p_task
      returning value into v_out;
    end;
  end if;
  return jsonb_build_object('ok', true, 'value', v_out);
end $$;

-- Non-empty values on active fields: for the given tasks, or every open task the caller
-- can read (null). Only tasks the caller can read.
create or replace function public.tk_cf_values(p_task_ids uuid[] default null)
returns table (field_id uuid, task_id uuid, value jsonb, updated_by text, updated_at timestamptz)
language plpgsql stable security definer set search_path to 'public', 'pg_temp' as $$
begin
  if not public.is_active_staff() then
    return;
  end if;
  return query
  select v.field_id, v.task_id, v.value, v.updated_by, v.updated_at
    from tk_custom_field_values v
    join tk_custom_fields f on f.id = v.field_id and f.archived_at is null
    join staff_reminders r on r.id = v.task_id
   where v.value is not null
     and (case when p_task_ids is not null then v.task_id = any (p_task_ids)
               else r.done = false and r.deleted_at is null end)
     and public.tk_can_read_task(v.task_id)
     -- Only fields that apply to the task's current list and that the caller can see
     -- (values left from an earlier list, or a private project's fields, stay hidden).
     and ((f.scope = 'project' and f.project_id = r.project_id and public.tk_can_see_project(f.project_id))
       or (f.scope = 'client' and f.client_id = r.client_id and public.can_access_client(f.client_id)))
   order by v.updated_at desc
   limit 5000;
end $$;

-- 5. Grants ----------------------------------------------------------------
revoke all on function public.tk__cf_can_manage(text, uuid, text) from public, anon, authenticated;
revoke all on function public.tk__cf_merge_options(jsonb, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.tk_custom_field_values_check() from public, anon, authenticated;
revoke all on function public.tk_cf_field_save(uuid, text, text, text, text, jsonb) from public, anon;
revoke all on function public.tk_cf_field_archive(uuid, boolean) from public, anon;
revoke all on function public.tk_cf_field_order(uuid[]) from public, anon;
revoke all on function public.tk_cf_value_set(uuid, uuid, jsonb) from public, anon;
revoke all on function public.tk_cf_values(uuid[]) from public, anon;
grant execute on function public.tk_cf_field_save(uuid, text, text, text, text, jsonb) to authenticated;
grant execute on function public.tk_cf_field_archive(uuid, boolean) to authenticated;
grant execute on function public.tk_cf_field_order(uuid[]) to authenticated;
grant execute on function public.tk_cf_value_set(uuid, uuid, jsonb) to authenticated;
grant execute on function public.tk_cf_values(uuid[]) to authenticated;
