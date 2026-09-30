-- Checklists inside a task (owner request 2026-09-30).
--
-- Applied to production 2026-09-30 as migration task_checklists (together
-- with the task_templates.checklist column and the tt_generate_template_tasks
-- change, both kept in supabase/task-templates.sql).
-- Safe to re-run.
--
--   task_checklist_items    the steps inside one staff_reminders task:
--                           text, done, sort_order. My Tasks shows progress
--                           ("3/5") and lets staff tick them off.
--   staff_checklist_presets personal reusable checklists ("My month-end
--                           steps"): a name + an ordered list of item texts.
--                           Private to their owner. Applying one copies its
--                           items onto a task.
--
-- Task templates can carry a checklist too (task_templates.checklist text[]);
-- tt_generate_template_tasks() copies it onto every task it creates.
--
-- Access follows the task's own RLS (staff_reminders):
--   read   anyone who can read the task (owner, shared-client teammates,
--          admins). The policy is an EXISTS on staff_reminders, which is
--          itself filtered by staff_reminders' RLS for the caller.
--   write  the same people who can update the task: its owner
--          (staff_email = JWT email), or, for a task shared with a client's
--          team, active staff who can access that client. Admins can read
--          every checklist but, like tasks, only edit shared or their own.
-- Deleting a task deletes its checklist (on delete cascade).

create table if not exists public.task_checklist_items (
  id          uuid primary key default gen_random_uuid(),
  reminder_id uuid not null references public.staff_reminders(id) on delete cascade,
  text        text not null,
  done        boolean not null default false,
  sort_order  integer not null default 0,
  done_by     text,
  done_at     timestamptz,
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint tci_text_len check (length(text) between 1 and 300)
);

create index if not exists task_checklist_items_reminder_idx
  on public.task_checklist_items (reminder_id, sort_order);

create or replace function public.task_checklist_items_before_write()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_by := coalesce(nullif(auth.jwt() ->> 'email', ''), new.created_by);
    new.created_at := now();
    if new.done then
      new.done_by := coalesce(nullif(auth.jwt() ->> 'email', ''), new.done_by);
      new.done_at := now();
    else
      new.done_by := null;
      new.done_at := null;
    end if;
  else
    new.reminder_id := old.reminder_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    if new.done is distinct from old.done then
      new.done_by := case when new.done then nullif(auth.jwt() ->> 'email', '') end;
      new.done_at := case when new.done then now() end;
    else
      new.done_by := old.done_by;
      new.done_at := old.done_at;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists task_checklist_items_before_write on public.task_checklist_items;
create trigger task_checklist_items_before_write
  before insert or update on public.task_checklist_items
  for each row execute function public.task_checklist_items_before_write();

alter table public.task_checklist_items enable row level security;

drop policy if exists "read checklist of readable task" on public.task_checklist_items;
create policy "read checklist of readable task" on public.task_checklist_items
  for select to authenticated
  using (exists (select 1 from public.staff_reminders r where r.id = reminder_id));

drop policy if exists "edit checklist of editable task" on public.task_checklist_items;
create policy "edit checklist of editable task" on public.task_checklist_items
  for all to authenticated
  using (exists (
    select 1 from public.staff_reminders r
    where r.id = reminder_id
      and (
        r.staff_email = (auth.jwt() ->> 'email')
        or (r.visibility = 'shared' and r.client_id is not null
            and public.is_active_staff() and public.can_access_client(r.client_id))
      )
  ))
  with check (exists (
    select 1 from public.staff_reminders r
    where r.id = reminder_id
      and (
        r.staff_email = (auth.jwt() ->> 'email')
        or (r.visibility = 'shared' and r.client_id is not null
            and public.is_active_staff() and public.can_access_client(r.client_id))
      )
  ));

revoke all on public.task_checklist_items from anon;
grant select, insert, update, delete on public.task_checklist_items to authenticated;

-- ---------------------------------------------------------------------------
-- Personal reusable checklists
-- ---------------------------------------------------------------------------

create table if not exists public.staff_checklist_presets (
  id          uuid primary key default gen_random_uuid(),
  owner_email text not null,
  name        text not null,
  items       text[] not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint scp_name_len check (length(name) between 1 and 80),
  constraint scp_items_len check (cardinality(items) between 1 and 50)
);

create unique index if not exists staff_checklist_presets_owner_name_uniq
  on public.staff_checklist_presets (owner_email, lower(name));

create or replace function public.staff_checklist_presets_before_write()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.owner_email := coalesce(nullif(auth.jwt() ->> 'email', ''), new.owner_email);
  else
    new.owner_email := old.owner_email;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

drop trigger if exists staff_checklist_presets_before_write on public.staff_checklist_presets;
create trigger staff_checklist_presets_before_write
  before insert or update on public.staff_checklist_presets
  for each row execute function public.staff_checklist_presets_before_write();

alter table public.staff_checklist_presets enable row level security;

drop policy if exists "staff manage own checklist presets" on public.staff_checklist_presets;
create policy "staff manage own checklist presets" on public.staff_checklist_presets
  for all to authenticated
  using (owner_email = (auth.jwt() ->> 'email') and public.is_active_staff())
  with check (owner_email = (auth.jwt() ->> 'email') and public.is_active_staff());

revoke all on public.staff_checklist_presets from anon;
grant select, insert, update, delete on public.staff_checklist_presets to authenticated;
