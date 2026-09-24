-- Pricing milestones: where each client stands on the published pricing
-- (marketing/pricing-embed.html), so clients always know their tier and
-- staff see when a change is due.
--
-- Builds on staff-schema.sql (is_active_staff()), audit-hardening-client-
-- scoping.sql (can_access_client()), client-users.sql and qbo-data.sql.
-- Safe to re-run.
--
-- Owner decisions (2026-09-24):
--   * A client's milestone is the HIGHER of the two measures: trailing
--     3-month average monthly transactions, and annual operating budget.
--   * The tracker only proposes. A staff member confirms before the fee
--     changes, in either direction; fees go down as well as up.
--
-- The tier table itself (thresholds + fees) lives in the app
-- (PRICING_MILESTONES in app.jsx), matching the public pricing block.
--
-- What this does:
--   1. client_milestones: one row per client. The staff-entered annual
--      budget (from the Form 990 or an approved budget) and the confirmed
--      milestone. Staff with access to the client can edit the budget
--      fields; the confirmed_* columns only change through
--      confirm_client_milestone(). Client users can read their own row.
--   2. client_milestone_history: one row per confirmed change, with the
--      numbers it was based on. Written only by confirm_client_milestone().
--   3. client_milestone_stats(client_ids[]): the live numbers per client.
--      Security invoker, so RLS on the qbo tables decides what a caller sees.
--   4. confirm_client_milestone(...): staff-only; records a change.

-- ---------------------------------------------------------------------------
-- 1. client_milestones
-- ---------------------------------------------------------------------------

create table if not exists public.client_milestones (
  client_id text primary key,
  annual_budget numeric check (annual_budget is null or annual_budget >= 0),
  budget_source text check (budget_source in ('form_990', 'approved_budget', 'other')),
  budget_as_of date,
  confirmed_tier int check (confirmed_tier between 1 and 6),
  confirmed_at timestamptz,
  confirmed_by text,
  updated_at timestamptz not null default now(),
  updated_by text
);

-- Stamps updated_* from the JWT and keeps confirmed_* out of reach of plain
-- updates (only confirm_client_milestone sets app.milestone_confirm).
create or replace function public.client_milestones_before_write()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_email text := nullif(auth.jwt() ->> 'email', '');
  v_confirming boolean := coalesce(current_setting('app.milestone_confirm', true), '') = 'on';
begin
  if not v_confirming then
    if tg_op = 'INSERT' then
      new.confirmed_tier := null;
      new.confirmed_at := null;
      new.confirmed_by := null;
    else
      new.confirmed_tier := old.confirmed_tier;
      new.confirmed_at := old.confirmed_at;
      new.confirmed_by := old.confirmed_by;
    end if;
  end if;
  if tg_op = 'UPDATE' then
    new.client_id := old.client_id;
  end if;
  new.updated_at := now();
  if v_email is not null then
    new.updated_by := v_email;
  end if;
  return new;
end;
$$;

drop trigger if exists client_milestones_before_write on public.client_milestones;
create trigger client_milestones_before_write
  before insert or update on public.client_milestones
  for each row execute function public.client_milestones_before_write();

-- ---------------------------------------------------------------------------
-- 2. client_milestone_history
-- ---------------------------------------------------------------------------

create table if not exists public.client_milestone_history (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,
  from_tier int,
  to_tier int not null check (to_tier between 1 and 6),
  avg_monthly_tx numeric,
  annual_budget numeric,
  budget_basis text,
  note text,
  changed_by text,
  changed_at timestamptz not null default now()
);

create index if not exists client_milestone_history_client_idx
  on public.client_milestone_history (client_id, changed_at desc);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.client_milestones enable row level security;
alter table public.client_milestone_history enable row level security;
revoke all on public.client_milestones from anon;
revoke all on public.client_milestone_history from anon;
revoke insert, update, delete on public.client_milestone_history from authenticated;
revoke delete on public.client_milestones from authenticated;

drop policy if exists "staff read client milestones" on public.client_milestones;
create policy "staff read client milestones" on public.client_milestones
  for select using (public.is_active_staff() and public.can_access_client(client_id));

drop policy if exists "staff insert client milestones" on public.client_milestones;
create policy "staff insert client milestones" on public.client_milestones
  for insert with check (public.is_active_staff() and public.can_access_client(client_id));

drop policy if exists "staff update client milestones" on public.client_milestones;
create policy "staff update client milestones" on public.client_milestones
  for update using (public.is_active_staff() and public.can_access_client(client_id))
  with check (public.is_active_staff() and public.can_access_client(client_id));

drop policy if exists "client reads own milestone" on public.client_milestones;
create policy "client reads own milestone" on public.client_milestones
  for select using (
    exists (
      select 1 from client_users cu
      where cu.email = auth.jwt() ->> 'email'
        and cu.client_id = client_milestones.client_id
        and cu.active
    )
  );

drop policy if exists "staff read milestone history" on public.client_milestone_history;
create policy "staff read milestone history" on public.client_milestone_history
  for select using (public.is_active_staff() and public.can_access_client(client_id));

drop policy if exists "client reads own milestone history" on public.client_milestone_history;
create policy "client reads own milestone history" on public.client_milestone_history
  for select using (
    exists (
      select 1 from client_users cu
      where cu.email = auth.jwt() ->> 'email'
        and cu.client_id = client_milestone_history.client_id
        and cu.active
    )
  );

-- ---------------------------------------------------------------------------
-- 3. client_milestone_stats — the live numbers
-- ---------------------------------------------------------------------------
-- tx_90d: QuickBooks transactions dated in the last 90 days (qbo-sync keeps
--   exactly that window), so the monthly average is tx_90d / 3.
-- qbo_budget_total: the QuickBooks budget for the latest fiscal year, if any.
-- expenses_12m: total expenses over the last 12 complete months.
-- last_synced_at: newest qbo_transactions row, so the app can say how fresh.

create or replace function public.client_milestone_stats(p_client_ids text[])
returns table (
  client_id text,
  tx_90d bigint,
  qbo_budget_total numeric,
  expenses_12m numeric,
  last_synced_at timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    c.id,
    (select count(*) from qbo_transactions t
      where t.client_id = c.id and t.txn_date > current_date - 90),
    (select sum(b.budgeted) from qbo_budget_lines b
      where b.client_id = c.id
        and b.fiscal_year = (select max(b2.fiscal_year) from qbo_budget_lines b2 where b2.client_id = c.id)),
    (select sum(p.expenses) from qbo_monthly_pl p
      where p.client_id = c.id
        and p.month >= (date_trunc('month', current_date) - interval '12 months')::date
        and p.month < date_trunc('month', current_date)::date),
    (select max(t.updated_at) from qbo_transactions t where t.client_id = c.id)
  from unnest(p_client_ids) as c(id);
$$;

revoke all on function public.client_milestone_stats(text[]) from public, anon;
grant execute on function public.client_milestone_stats(text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. confirm_client_milestone — staff record a change
-- ---------------------------------------------------------------------------

create or replace function public.confirm_client_milestone(
  p_client_id text,
  p_tier int,
  p_avg_monthly_tx numeric,
  p_annual_budget numeric,
  p_budget_basis text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := nullif(auth.jwt() ->> 'email', '');
  v_from int;
begin
  if v_email is null or not public.is_active_staff() or not public.can_access_client(p_client_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_tier is null or p_tier < 1 or p_tier > 6 then
    raise exception 'invalid tier' using errcode = '22023';
  end if;

  select confirmed_tier into v_from from client_milestones where client_id = p_client_id;

  perform set_config('app.milestone_confirm', 'on', true);
  insert into client_milestones (client_id, confirmed_tier, confirmed_at, confirmed_by)
    values (p_client_id, p_tier, now(), v_email)
    on conflict (client_id) do update
      set confirmed_tier = excluded.confirmed_tier,
          confirmed_at = excluded.confirmed_at,
          confirmed_by = excluded.confirmed_by;
  perform set_config('app.milestone_confirm', 'off', true);

  insert into client_milestone_history
    (client_id, from_tier, to_tier, avg_monthly_tx, annual_budget, budget_basis, note, changed_by)
  values
    (p_client_id, v_from, p_tier, p_avg_monthly_tx, p_annual_budget, p_budget_basis,
     nullif(trim(coalesce(p_note, '')), ''), v_email);
end;
$$;

revoke all on function public.confirm_client_milestone(text, int, numeric, numeric, text, text) from public, anon;
grant execute on function public.confirm_client_milestone(text, int, numeric, numeric, text, text) to authenticated;
revoke all on function public.client_milestones_before_write() from public, anon;
