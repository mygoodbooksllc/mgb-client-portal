-- Client onboarding checklist (owner request 2026-09-29).
--
-- Applied to production 2026-09-29 as migrations client_onboarding and
-- tt_onboarding_advisor_fixes (policy split).
-- Safe to re-run. Depends on month-close.sql (for the "first close" step's
-- auto-detection, which the app does by reading month_close).
--
--   onboarding_steps   the default step list every client gets. Admins add,
--                      rename, reorder and retire steps (active = false keeps
--                      history for clients who already ticked it).
--                      auto_source marks a step the app can tick on its own:
--                        'qbo'         a qbo_connections row with status
--                                      'connected' exists for the client
--                        'first_close' any month_close row for the client
--                                      is 'done'
--                      A step with auto_source can still be ticked by hand
--                      (e.g. QuickBooks connected outside the portal).
--   client_onboarding  per-client manual ticks. done_by / done_at are stamped
--                      server-side.
--
-- RLS: every active staff member reads the step list, admins write it.
-- client_onboarding follows can_access_client() (admins see all).

create table if not exists public.onboarding_steps (
  key         text primary key,
  label       text not null,
  description text,
  sort_order  integer not null default 100,
  auto_source text,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  constraint onboarding_steps_key_format check (key ~ '^[a-z0-9_]{1,40}$'),
  constraint onboarding_steps_label_len check (length(label) between 1 and 120),
  constraint onboarding_steps_auto_source check (auto_source is null or auto_source in ('qbo', 'first_close'))
);

insert into public.onboarding_steps (key, label, description, sort_order, auto_source) values
  ('agreement_signed', 'Agreement signed', 'Engagement letter / service agreement is signed and filed.', 10, null),
  ('qbo_connected', 'QuickBooks connected', 'Ticks itself when QuickBooks is connected in the portal.', 20, 'qbo'),
  ('bank_feeds', 'Bank feeds added', 'Every bank and card account is feeding into QuickBooks.', 30, null),
  ('documents_received', 'Documents received', 'Prior statements, payroll reports and opening balances are in.', 40, null),
  ('first_close', 'First close done', 'Ticks itself when a month is marked done on the Close tracker.', 50, 'first_close')
on conflict (key) do nothing;

alter table public.onboarding_steps enable row level security;

drop policy if exists "staff read onboarding steps" on public.onboarding_steps;
create policy "staff read onboarding steps" on public.onboarding_steps
  for select to authenticated
  using (public.is_active_staff());

-- Separate insert/update/delete policies (not one "for all") so SELECT has a
-- single permissive policy (performance advisor).
drop policy if exists "admins manage onboarding steps" on public.onboarding_steps;
drop policy if exists "admins insert onboarding steps" on public.onboarding_steps;
drop policy if exists "admins update onboarding steps" on public.onboarding_steps;
drop policy if exists "admins delete onboarding steps" on public.onboarding_steps;
create policy "admins insert onboarding steps" on public.onboarding_steps
  for insert to authenticated with check (public.is_active_staff_admin());
create policy "admins update onboarding steps" on public.onboarding_steps
  for update to authenticated
  using (public.is_active_staff_admin()) with check (public.is_active_staff_admin());
create policy "admins delete onboarding steps" on public.onboarding_steps
  for delete to authenticated using (public.is_active_staff_admin());

revoke all on public.onboarding_steps from anon;
grant select, insert, update, delete on public.onboarding_steps to authenticated;

create table if not exists public.client_onboarding (
  client_id text not null references public.clients(id) on delete cascade,
  step_key  text not null references public.onboarding_steps(key) on delete cascade on update cascade,
  done      boolean not null default false,
  done_by   text,
  done_at   timestamptz,
  primary key (client_id, step_key)
);

create index if not exists client_onboarding_step_idx on public.client_onboarding (step_key);

create or replace function public.client_onboarding_before_write()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.done then
    if tg_op = 'INSERT' or not coalesce(old.done, false) then
      new.done_at := now();
      new.done_by := coalesce(nullif(auth.jwt() ->> 'email', ''), new.done_by);
    else
      new.done_at := old.done_at;
      new.done_by := old.done_by;
    end if;
  else
    new.done_at := null;
    new.done_by := null;
  end if;
  return new;
end;
$$;

drop trigger if exists client_onboarding_before_write on public.client_onboarding;
create trigger client_onboarding_before_write
  before insert or update on public.client_onboarding
  for each row execute function public.client_onboarding_before_write();

alter table public.client_onboarding enable row level security;

drop policy if exists "staff read client onboarding" on public.client_onboarding;
create policy "staff read client onboarding" on public.client_onboarding
  for select to authenticated
  using (public.is_active_staff() and public.can_access_client(client_id));

drop policy if exists "staff insert client onboarding" on public.client_onboarding;
create policy "staff insert client onboarding" on public.client_onboarding
  for insert to authenticated
  with check (public.is_active_staff() and public.can_access_client(client_id));

drop policy if exists "staff update client onboarding" on public.client_onboarding;
create policy "staff update client onboarding" on public.client_onboarding
  for update to authenticated
  using (public.is_active_staff() and public.can_access_client(client_id))
  with check (public.is_active_staff() and public.can_access_client(client_id));

drop policy if exists "admins delete client onboarding" on public.client_onboarding;
create policy "admins delete client onboarding" on public.client_onboarding
  for delete to authenticated
  using (public.is_active_staff_admin());

revoke all on public.client_onboarding from anon;
grant select, insert, update, delete on public.client_onboarding to authenticated;
