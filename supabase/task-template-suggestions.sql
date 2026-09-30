-- "Save as template" suggestions from staff (owner request 2026-09-30).
--
-- Applied to production 2026-09-30 as migration task_template_suggestions.
-- Safe to re-run.
--
-- In My Tasks every task has a "Save as template" button. Admins go straight
-- to the Task templates editor, pre-filled (nothing is saved until they click
-- Save). Everyone else can't write task_templates (RLS: real admins only), so
-- the button files a suggestion here instead. Admins see pending suggestions
-- at the top of Task templates (and in the bell) with "Create template" and
-- "Dismiss".
--
--   title         the task text with the " · Sep 2026" / " · Q3 2026" /
--                 " · 2026" period suffix removed (done in the browser).
--   priority      low / normal / high, copied from the task.
--   client_id     the task's client, if any (becomes client targeting).
--   reminder_id   the staff_reminders row it came from (informational; no FK
--                 so deleting the task never touches the suggestion).
--   suggested_by  stamped from the JWT email by the trigger; clients can't
--                 spoof it.
--   status        pending -> created (template_id set) or dismissed.
--
-- RLS: active staff may insert their own row (suggested_by = JWT email,
-- status pending). Admins read and update. Nobody deletes from the browser.

create table if not exists public.task_template_suggestions (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  priority      text not null default 'normal',
  client_id     text references public.clients(id) on delete set null,
  reminder_id   uuid,
  suggested_by  text,
  status        text not null default 'pending',
  template_id   uuid references public.task_templates(id) on delete set null,
  resolved_by   text,
  resolved_at   timestamptz,
  created_at    timestamptz not null default now(),
  constraint tts_title_len check (length(title) between 1 and 200),
  constraint tts_priority check (priority in ('low', 'normal', 'high')),
  constraint tts_status check (status in ('pending', 'created', 'dismissed'))
);

create index if not exists task_template_suggestions_pending_idx
  on public.task_template_suggestions (created_at desc) where status = 'pending';
create index if not exists task_template_suggestions_client_idx
  on public.task_template_suggestions (client_id);
create index if not exists task_template_suggestions_template_idx
  on public.task_template_suggestions (template_id);

-- One pending suggestion per person per title + client.
create unique index if not exists task_template_suggestions_pending_uniq
  on public.task_template_suggestions (suggested_by, lower(title), coalesce(client_id, ''))
  where status = 'pending';

create or replace function public.task_template_suggestions_before_write()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.suggested_by := coalesce(nullif(auth.jwt() ->> 'email', ''), new.suggested_by);
    new.status := 'pending';
    new.template_id := null;
    new.resolved_by := null;
    new.resolved_at := null;
    new.created_at := now();
  else
    -- Only the resolution fields change after insert.
    new.title := old.title;
    new.priority := old.priority;
    new.client_id := old.client_id;
    new.reminder_id := old.reminder_id;
    new.suggested_by := old.suggested_by;
    new.created_at := old.created_at;
    if new.status is distinct from old.status then
      new.resolved_by := coalesce(nullif(auth.jwt() ->> 'email', ''), new.resolved_by);
      new.resolved_at := case when new.status = 'pending' then null else now() end;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists task_template_suggestions_before_write on public.task_template_suggestions;
create trigger task_template_suggestions_before_write
  before insert or update on public.task_template_suggestions
  for each row execute function public.task_template_suggestions_before_write();

alter table public.task_template_suggestions enable row level security;

drop policy if exists "staff suggest templates" on public.task_template_suggestions;
create policy "staff suggest templates" on public.task_template_suggestions
  for insert to authenticated
  with check (
    public.is_active_staff()
    and suggested_by = (auth.jwt() ->> 'email')
    and status = 'pending'
  );

drop policy if exists "admins read template suggestions" on public.task_template_suggestions;
create policy "admins read template suggestions" on public.task_template_suggestions
  for select to authenticated
  using (public.is_active_staff_admin());

drop policy if exists "admins resolve template suggestions" on public.task_template_suggestions;
create policy "admins resolve template suggestions" on public.task_template_suggestions
  for update to authenticated
  using (public.is_active_staff_admin())
  with check (public.is_active_staff_admin());

revoke all on public.task_template_suggestions from anon;
revoke delete on public.task_template_suggestions from authenticated;
grant select, insert, update on public.task_template_suggestions to authenticated;
