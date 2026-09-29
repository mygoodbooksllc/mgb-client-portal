-- Month-end close tracker (owner request 2026-09-29).
--
-- Applied to production 2026-09-29 as migration month_close.
-- Safe to re-run.
--
--   month_close           one row per client per month (period = first of the
--                         month). No row = "not started". status is one of
--                         not_started / in_progress / review / done / na.
--                         updated_by / updated_at are stamped server-side on
--                         every write, so the grid's "who and when" can't be
--                         spoofed from the browser.
--   month_close_settings  one row: late_day (default 15). A month is late when
--                         today is past that day of the FOLLOWING month and
--                         the month isn't done / n.a. Admins edit it; every
--                         active staff member reads it.
--
-- RLS: staff read and write rows for clients they can access
-- (can_access_client(), which already lets admins see every client).
-- Only admins delete. The UI (components/staff/CloseTracker.jsx) never
-- deletes; "not started" is written as a status.
--
-- onboarding (supabase/client-onboarding.sql) reads month_close to tick
-- "First close done" automatically.

create table if not exists public.month_close (
  client_id  text not null references public.clients(id) on delete cascade,
  period     date not null,
  status     text not null default 'not_started',
  notes      text,
  updated_by text,
  updated_at timestamptz not null default now(),
  primary key (client_id, period),
  constraint month_close_period_first_of_month
    check (period = date_trunc('month', period)::date),
  constraint month_close_status_check
    check (status in ('not_started', 'in_progress', 'review', 'done', 'na')),
  constraint month_close_notes_len check (notes is null or length(notes) <= 2000)
);

create index if not exists month_close_period_idx on public.month_close (period);

create or replace function public.month_close_before_write()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(nullif(auth.jwt() ->> 'email', ''), new.updated_by);
  return new;
end;
$$;

drop trigger if exists month_close_before_write on public.month_close;
create trigger month_close_before_write
  before insert or update on public.month_close
  for each row execute function public.month_close_before_write();

alter table public.month_close enable row level security;

drop policy if exists "staff read month close" on public.month_close;
create policy "staff read month close" on public.month_close
  for select to authenticated
  using (public.is_active_staff() and public.can_access_client(client_id));

drop policy if exists "staff insert month close" on public.month_close;
create policy "staff insert month close" on public.month_close
  for insert to authenticated
  with check (public.is_active_staff() and public.can_access_client(client_id));

drop policy if exists "staff update month close" on public.month_close;
create policy "staff update month close" on public.month_close
  for update to authenticated
  using (public.is_active_staff() and public.can_access_client(client_id))
  with check (public.is_active_staff() and public.can_access_client(client_id));

drop policy if exists "admins delete month close" on public.month_close;
create policy "admins delete month close" on public.month_close
  for delete to authenticated
  using (public.is_active_staff_admin());

revoke all on public.month_close from anon;
grant select, insert, update, delete on public.month_close to authenticated;

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------

create table if not exists public.month_close_settings (
  id         boolean primary key default true,
  late_day   integer not null default 15,
  updated_by text,
  updated_at timestamptz not null default now(),
  constraint month_close_settings_singleton check (id),
  constraint month_close_settings_late_day check (late_day between 1 and 28)
);

insert into public.month_close_settings (id) values (true) on conflict (id) do nothing;

alter table public.month_close_settings enable row level security;

drop policy if exists "staff read close settings" on public.month_close_settings;
create policy "staff read close settings" on public.month_close_settings
  for select to authenticated
  using (public.is_active_staff());

drop policy if exists "admins update close settings" on public.month_close_settings;
create policy "admins update close settings" on public.month_close_settings
  for update to authenticated
  using (public.is_active_staff_admin())
  with check (public.is_active_staff_admin());

drop trigger if exists month_close_settings_before_write on public.month_close_settings;
create trigger month_close_settings_before_write
  before update on public.month_close_settings
  for each row execute function public.month_close_before_write();

revoke all on public.month_close_settings from anon;
grant select, update on public.month_close_settings to authenticated;
