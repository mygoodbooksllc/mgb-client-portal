-- Ledger review (GL Review), part 4: Quote tool tables.
-- Spec: docs/gl-review-spec.md section 9 (9.1, 9.2, 9.3) and 13.5.
-- NOT APPLIED. Written 2026-10-14 (tables specced now, screens are phase 3).
-- Put the applied date here when it goes to production
-- (migration name gl_review_4_quotes). Independent of parts 1 to 3.
--
-- What this file adds (admin only, like client-profitability.sql)
--   quote_settings          single row of minutes per unit of work. The
--                           starting values are PLACEHOLDERS from the
--                           2026-10-14 session, not measured:
--                             1 min per transaction, 20 per reconciliation,
--                             60 for reports review; cleanup 3 per
--                             uncategorized, 5 per duplicate, 10 per opening
--                             balance equity line, 90 per unreconciled month.
--                           is_placeholder stays true until an admin first
--                           saves a changed number. auto_tune can only be
--                           turned on once is_placeholder is false AND the
--                           firm QuickBooks Time connection is live and has
--                           synced (qbo_firm_connection). Admins select and
--                           update (column grant); nobody inserts or deletes.
--   quote_settings_history  one row per change, written by a trigger so a
--                           save can't skip it (source manual / auto_tune /
--                           seed); a 'seed' row is added once.
--   saved_quotes            a saved quote with every assumption copied in, so
--                           later setting changes never rewrite it. client_id
--                           is null for a prospect (filled in phase 5). No
--                           ledger lines are ever stored. archived_at +
--                           saved_quotes_archive_stale(): prospect quotes
--                           (no client, never accepted/converted) untouched
--                           for 90 days are archived (owner decision 13.5).
--                           No cron is scheduled here.
--   quote_inputs()          admin-only read of the target margin and current
--                           bookkeeper hourly costs (security invoker, spec 9.1).
-- quote_tune_suggestion() (spec 9.4) is phase 3 and not in this file.
--
-- Safe to re-run.
--
-- Rollback (nothing depends on these yet):
--   drop function if exists public.quote_inputs(), public.saved_quotes_archive_stale(),
--     public.quote_settings_before_update(), public.quote_settings_log_history(),
--     public.saved_quotes_stamp();
--   drop table if exists public.saved_quotes, public.quote_settings_history, public.quote_settings;
--
-- Depends on (repo definitions re-read 2026-10-14): client-profitability.sql
-- (staff_cost_rates, profitability_settings), qbo-firm-time.sql
-- (qbo_firm_connection), staff-schema.sql (staff), clients-roster.sql
-- (clients), staff-admin-policies.sql (is_active_staff_admin).

begin;

-- ===========================================================================
-- 1. quote_settings (single row)
-- ===========================================================================
create table if not exists public.quote_settings (
  id                             boolean primary key default true,
  min_per_txn                    numeric(6,2) not null default 1.0,
  min_per_recon                  numeric(6,2) not null default 20,
  min_reports_review             numeric(6,2) not null default 60,
  cleanup_min_uncategorized      numeric(6,2) not null default 3,
  cleanup_min_duplicate          numeric(6,2) not null default 5,
  cleanup_min_obe                numeric(6,2) not null default 10,
  cleanup_min_unreconciled_month numeric(6,2) not null default 90,
  is_placeholder                 boolean not null default true,
  auto_tune                      boolean not null default false,
  updated_by                     text,
  updated_at                     timestamptz not null default now(),
  constraint quote_settings_singleton check (id),
  constraint quote_settings_minutes check (
        min_per_txn >= 0 and min_per_recon >= 0 and min_reports_review >= 0
    and cleanup_min_uncategorized >= 0 and cleanup_min_duplicate >= 0
    and cleanup_min_obe >= 0 and cleanup_min_unreconciled_month >= 0
  ),
  constraint quote_settings_auto_tune_needs_real_values check (not auto_tune or not is_placeholder)
);
insert into public.quote_settings (id) values (true) on conflict (id) do nothing;

create table if not exists public.quote_settings_history (
  id         uuid primary key default gen_random_uuid(),
  changed_by text,
  changed_at timestamptz not null default now(),
  source     text not null check (source in ('manual', 'auto_tune', 'seed')),
  old        jsonb,
  new        jsonb not null,
  note       text check (note is null or length(note) <= 1000)
);
create index if not exists quote_settings_history_changed_idx
  on public.quote_settings_history (changed_at desc);

-- Stamp, placeholder and auto-tune rules. The change source is 'manual' for
-- any signed-in caller; trusted backend code (the phase 3 monthly job, no
-- JWT) may set app.quote_settings_source = 'auto_tune' for the transaction.
create or replace function public.quote_settings_before_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(nullif(btrim(auth.jwt() ->> 'email'), ''));
  v_signed_in boolean := v_email is not null or coalesce(auth.jwt() ->> 'role', '') in ('authenticated', 'anon');
  v_source text;
  v_minutes_changed boolean;
begin
  new.id := old.id;
  v_source := case when v_signed_in then 'manual'
                   else coalesce(nullif(current_setting('app.quote_settings_source', true), ''), 'manual') end;
  if v_source not in ('manual', 'auto_tune') then
    raise exception 'quote_settings: unknown change source %', v_source;
  end if;

  v_minutes_changed :=
       new.min_per_txn is distinct from old.min_per_txn
    or new.min_per_recon is distinct from old.min_per_recon
    or new.min_reports_review is distinct from old.min_reports_review
    or new.cleanup_min_uncategorized is distinct from old.cleanup_min_uncategorized
    or new.cleanup_min_duplicate is distinct from old.cleanup_min_duplicate
    or new.cleanup_min_obe is distinct from old.cleanup_min_obe
    or new.cleanup_min_unreconciled_month is distinct from old.cleanup_min_unreconciled_month;

  if v_signed_in then
    -- Browser: is_placeholder isn't granted; the first real save clears it.
    new.is_placeholder := old.is_placeholder and not v_minutes_changed;
  end if;
  if v_source = 'auto_tune' and (old.is_placeholder or not old.auto_tune) then
    raise exception 'quote_settings: auto-tune needs real (non-placeholder) values and auto_tune on';
  end if;
  -- Turning auto_tune on needs the firm QuickBooks Time connection live (spec 9.4).
  if new.auto_tune and not old.auto_tune then
    if new.is_placeholder then
      raise exception 'Save real minutes first; auto-tune can''t start from the placeholders.' using errcode = '22023';
    end if;
    if not exists (select 1 from qbo_firm_connection f
                   where f.status = 'connected' and f.last_synced_at is not null) then
      raise exception 'Auto-tune needs the firm QuickBooks Time connection to be live.' using errcode = '22023';
    end if;
  end if;

  new.updated_at := now();
  new.updated_by := coalesce(v_email, case when v_source = 'auto_tune' then 'auto_tune' end, new.updated_by);
  perform set_config('app.quote_settings_source_used', v_source, true);
  return new;
end;
$$;
revoke all on function public.quote_settings_before_update() from public, anon, authenticated;

drop trigger if exists quote_settings_before_update on public.quote_settings;
create trigger quote_settings_before_update
  before update on public.quote_settings
  for each row execute function public.quote_settings_before_update();

-- History row for every update that changes anything but the stamp.
create or replace function public.quote_settings_log_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (to_jsonb(new) - 'updated_at' - 'updated_by') = (to_jsonb(old) - 'updated_at' - 'updated_by') then
    return null;
  end if;
  insert into public.quote_settings_history (changed_by, source, old, new, note)
  values (new.updated_by,
          coalesce(nullif(current_setting('app.quote_settings_source_used', true), ''), 'manual'),
          to_jsonb(old), to_jsonb(new),
          left(nullif(current_setting('app.quote_settings_note', true), ''), 1000));
  return null;
end;
$$;
revoke all on function public.quote_settings_log_history() from public, anon, authenticated;

drop trigger if exists quote_settings_log_history on public.quote_settings;
create trigger quote_settings_log_history
  after update on public.quote_settings
  for each row execute function public.quote_settings_log_history();

-- One 'seed' row recording the placeholder starting point.
insert into public.quote_settings_history (changed_by, source, old, new, note)
select 'seed', 'seed', null, to_jsonb(q), 'Placeholder starting values (2026-10-14), not measured'
  from public.quote_settings q
 where not exists (select 1 from public.quote_settings_history);

-- ===========================================================================
-- 2. saved_quotes
-- ===========================================================================
create table if not exists public.saved_quotes (
  id               uuid primary key default gen_random_uuid(),
  client_id        text references public.clients(id) on delete set null,   -- phase 5: quote -> client
  prospect_name    text not null check (length(btrim(prospect_name)) between 1 and 200),
  status           text not null default 'draft'
                     check (status in ('draft', 'sent', 'accepted', 'declined', 'converted')),
  period_start     date,
  period_end       date,
  source_file_name text check (source_file_name is null or length(source_file_name) <= 255),  -- name only
  inputs           jsonb not null default '{}'::jsonb
                     check (jsonb_typeof(inputs) = 'object' and pg_column_size(inputs) <= 32768),
  assumptions      jsonb not null default '{}'::jsonb
                     check (jsonb_typeof(assumptions) = 'object' and pg_column_size(assumptions) <= 16384),
  result           jsonb not null default '{}'::jsonb
                     check (jsonb_typeof(result) = 'object' and pg_column_size(result) <= 16384),
  note             text check (note is null or length(note) <= 2000),
  created_by       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  converted_at     timestamptz,
  archived_at      timestamptz,
  constraint saved_quotes_period check (period_start is null or period_end is null or period_end >= period_start)
);
create index if not exists saved_quotes_created_idx on public.saved_quotes (created_at desc);
create index if not exists saved_quotes_client_idx on public.saved_quotes (client_id) where client_id is not null;

create or replace function public.saved_quotes_stamp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(nullif(btrim(auth.jwt() ->> 'email'), ''));
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(v_email, new.created_by);
    new.created_at := now();
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  new.prospect_name := btrim(new.prospect_name);
  if new.status = 'converted' and (tg_op = 'INSERT' or old.status is distinct from 'converted') then
    new.converted_at := now();
  elsif new.status <> 'converted' then
    new.converted_at := null;
  else
    new.converted_at := old.converted_at;
  end if;
  return new;
end;
$$;
revoke all on function public.saved_quotes_stamp() from public, anon, authenticated;

drop trigger if exists saved_quotes_stamp on public.saved_quotes;
create trigger saved_quotes_stamp
  before insert or update on public.saved_quotes
  for each row execute function public.saved_quotes_stamp();

-- ===========================================================================
-- 3. RLS and grants (admin only)
-- ===========================================================================
alter table public.quote_settings enable row level security;
alter table public.quote_settings_history enable row level security;
alter table public.saved_quotes enable row level security;

revoke all on public.quote_settings from public, anon, authenticated;
revoke all on public.quote_settings_history from public, anon, authenticated;
revoke all on public.saved_quotes from public, anon, authenticated;
grant all on public.quote_settings, public.quote_settings_history, public.saved_quotes to service_role;

grant select on public.quote_settings to authenticated;
grant update (min_per_txn, min_per_recon, min_reports_review, cleanup_min_uncategorized,
              cleanup_min_duplicate, cleanup_min_obe, cleanup_min_unreconciled_month, auto_tune)
  on public.quote_settings to authenticated;
drop policy if exists "admins read quote settings" on public.quote_settings;
create policy "admins read quote settings" on public.quote_settings
  for select to authenticated using (public.is_active_staff_admin());
drop policy if exists "admins update quote settings" on public.quote_settings;
create policy "admins update quote settings" on public.quote_settings
  for update to authenticated
  using (public.is_active_staff_admin()) with check (public.is_active_staff_admin());

grant select on public.quote_settings_history to authenticated;
drop policy if exists "admins read quote settings history" on public.quote_settings_history;
create policy "admins read quote settings history" on public.quote_settings_history
  for select to authenticated using (public.is_active_staff_admin());

grant select, insert, update, delete on public.saved_quotes to authenticated;
drop policy if exists "admins read saved quotes" on public.saved_quotes;
create policy "admins read saved quotes" on public.saved_quotes
  for select to authenticated using (public.is_active_staff_admin());
drop policy if exists "admins write saved quotes" on public.saved_quotes;
create policy "admins write saved quotes" on public.saved_quotes
  for insert to authenticated with check (public.is_active_staff_admin());
drop policy if exists "admins update saved quotes" on public.saved_quotes;
create policy "admins update saved quotes" on public.saved_quotes
  for update to authenticated
  using (public.is_active_staff_admin()) with check (public.is_active_staff_admin());
drop policy if exists "admins delete saved quotes" on public.saved_quotes;
create policy "admins delete saved quotes" on public.saved_quotes
  for delete to authenticated using (public.is_active_staff_admin());

-- ===========================================================================
-- 4. Functions
-- ===========================================================================
-- Spec 9.1. Security invoker: the caller's RLS applies to staff_cost_rates and
-- profitability_settings (both admin-only), and the explicit check gives a
-- clear error instead of empty numbers.
-- Returns {target_margin_pct, avg_bookkeeper_hourly_cost, bookkeepers:
--          [{email, name, hourly_cost, effective_from}]} (active staff with
-- role 'bookkeeper', latest rate with effective_from <= today; staff with no
-- rate are listed with hourly_cost null and left out of the average).
create or replace function public.quote_inputs()
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_margin numeric;
  v_rates jsonb;
  v_avg numeric;
begin
  if not public.is_active_staff_admin() then
    raise exception 'Only admins can use the quote tool.' using errcode = '42501';
  end if;
  select target_margin_pct into v_margin from profitability_settings where id;
  with bk as (
    select lower(s.email) as email, s.name,
           (select r.hourly_cost from staff_cost_rates r
             where r.staff_email = lower(s.email) and r.effective_from <= current_date
             order by r.effective_from desc limit 1) as hourly_cost,
           (select r.effective_from from staff_cost_rates r
             where r.staff_email = lower(s.email) and r.effective_from <= current_date
             order by r.effective_from desc limit 1) as effective_from
      from staff s
     where s.active and s.role = 'bookkeeper'
  )
  select coalesce(jsonb_agg(jsonb_build_object('email', email, 'name', name, 'hourly_cost', hourly_cost,
                                               'effective_from', effective_from) order by name, email), '[]'::jsonb),
         round(avg(hourly_cost), 2)
    into v_rates, v_avg
    from bk;
  return jsonb_build_object('target_margin_pct', v_margin, 'avg_bookkeeper_hourly_cost', v_avg,
                            'bookkeepers', v_rates);
end;
$$;
revoke all on function public.quote_inputs() from public, anon;
grant execute on function public.quote_inputs() to authenticated;

-- Owner decision 13.5: prospect quotes (no client, never accepted or
-- converted) untouched for 90 days are archived. Returns rows archived.
-- Service role only; schedule it (daily) when the quote tool ships.
-- Deleting on request stays a manual admin delete.
create or replace function public.saved_quotes_archive_stale()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  update public.saved_quotes
     set archived_at = now()
   where archived_at is null
     and client_id is null
     and status not in ('accepted', 'converted')
     and updated_at < now() - interval '90 days';
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.saved_quotes_archive_stale() from public, anon, authenticated;
grant execute on function public.saved_quotes_archive_stale() to service_role;

commit;
