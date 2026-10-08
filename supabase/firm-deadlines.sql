-- Firm deadline calendar (owner request 2026-10-07). Staff only.
--
-- Applied to production 2026-10-07 as migrations firm_deadlines and
-- firm_deadlines_rule_check_fix (null-safe rule check).
-- Safe to re-run (seeds use "on conflict do nothing", so admin edits stay).
--
--   firm_deadline_rules        the firm's list of filing deadlines. Every
--                              active staff member reads; admins add, edit and
--                              deactivate (active = false). Never deleted.
--   client_deadline_overrides  per client: a different due date (annual rules
--                              only), skip the rule, or turn on an opt-in rule
--                              (a row with skip = false and no date). Removed
--                              with removed_at, never deleted.
--   client_deadline_status     "Mark filed": one live row per client, rule and
--                              period. Undo sets undone_at, never deletes.
--
-- Dates are worked out in the app (staffOpsLogic.js, OPS_deadline*), so the
-- database only stores rules and what people did. The seeded federal dates are
-- a starting point to VERIFY each year, not tax or legal advice.
--
-- due_rule shapes (checked by firm_deadline_rule_ok):
--   annual:    {"month": 1-12, "day": 1-31}
--              or {"fye_months": 1-12, "day": 1-31, "fallback_month": 1-12, "fallback_day": 1-31}
--              (the day of the Nth month after the client's fiscal year end;
--               the fallback date when the client has no fiscal year end)
--   quarterly: {"dates": [{"month","day"} x4]} for Q1..Q4; a date whose month
--              is before the quarter's last month falls in the next year
--   monthly:   {"day": 1-31, "offset_months": 0-3} (day N of the month that
--              is offset_months after the period month; default 1)
--
-- Clients never see any of it: every policy needs active staff, and the client
-- tables also need can_access_client().

create or replace function public.firm_deadline_rule_ok(p_cadence text, p_rule jsonb)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  d jsonb;
  ok_md constant text := '^(1[0-2]|[1-9])$';
begin
  if p_rule is null or jsonb_typeof(p_rule) <> 'object' then
    return false;
  end if;
  if p_cadence = 'annual' then
    if p_rule ? 'fye_months' then
      return coalesce((p_rule->>'fye_months') ~ ok_md
        and (p_rule->>'day') ~ '^([1-9]|[12][0-9]|3[01])$'
        and (p_rule->>'fallback_month') ~ ok_md
        and (p_rule->>'fallback_day') ~ '^([1-9]|[12][0-9]|3[01])$', false);
    end if;
    return coalesce((p_rule->>'month') ~ ok_md and (p_rule->>'day') ~ '^([1-9]|[12][0-9]|3[01])$', false);
  elsif p_cadence = 'quarterly' then
    if coalesce(jsonb_typeof(p_rule->'dates'), '') <> 'array' or jsonb_array_length(p_rule->'dates') <> 4 then
      return false;
    end if;
    for d in select * from jsonb_array_elements(p_rule->'dates') loop
      if not coalesce((d->>'month') ~ ok_md and (d->>'day') ~ '^([1-9]|[12][0-9]|3[01])$', false) then
        return false;
      end if;
    end loop;
    return true;
  elsif p_cadence = 'monthly' then
    return coalesce((p_rule->>'day') ~ '^([1-9]|[12][0-9]|3[01])$'
      and coalesce(p_rule->>'offset_months', '1') ~ '^[0-3]$', false);
  end if;
  return false;
end;
$$;

create table if not exists public.firm_deadline_rules (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  description text,
  cadence text not null,
  due_rule jsonb not null,
  applies_entity_type text[],
  applies_org_type_excludes text[],
  requires_payroll boolean,
  opt_in boolean not null default false,
  active boolean not null default true,
  sort int not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text,
  constraint firm_deadline_rules_key_check check (key ~ '^[a-z0-9][a-z0-9-]{1,40}$'),
  constraint firm_deadline_rules_name_check check (length(trim(name)) between 1 and 80),
  constraint firm_deadline_rules_desc_check check (description is null or length(description) <= 600),
  constraint firm_deadline_rules_cadence_check check (cadence in ('annual', 'quarterly', 'monthly')),
  constraint firm_deadline_rules_rule_check check (public.firm_deadline_rule_ok(cadence, due_rule))
);

alter table public.firm_deadline_rules enable row level security;

drop policy if exists "staff read deadline rules" on public.firm_deadline_rules;
create policy "staff read deadline rules" on public.firm_deadline_rules
  for select to authenticated using (public.is_active_staff());

drop policy if exists "admins add deadline rules" on public.firm_deadline_rules;
create policy "admins add deadline rules" on public.firm_deadline_rules
  for insert to authenticated with check (public.is_active_staff_admin());

drop policy if exists "admins edit deadline rules" on public.firm_deadline_rules;
create policy "admins edit deadline rules" on public.firm_deadline_rules
  for update to authenticated
  using (public.is_active_staff_admin())
  with check (public.is_active_staff_admin());

revoke all on public.firm_deadline_rules from anon;
revoke delete, truncate on public.firm_deadline_rules from authenticated;
grant select, insert, update on public.firm_deadline_rules to authenticated;

create table if not exists public.client_deadline_overrides (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references public.clients(id),
  rule_key text not null references public.firm_deadline_rules(key) on update cascade,
  due_date date,
  skip boolean not null default false,
  note text,
  updated_by text,
  updated_at timestamptz not null default now(),
  removed_at timestamptz,
  constraint client_deadline_overrides_one_kind check (not (skip and due_date is not null)),
  constraint client_deadline_overrides_note_check check (note is null or length(note) <= 300)
);
create unique index if not exists client_deadline_overrides_live_idx
  on public.client_deadline_overrides (client_id, rule_key) where removed_at is null;

alter table public.client_deadline_overrides enable row level security;

drop policy if exists "staff read deadline overrides" on public.client_deadline_overrides;
create policy "staff read deadline overrides" on public.client_deadline_overrides
  for select to authenticated
  using (public.is_active_staff() and public.can_access_client(client_id));

drop policy if exists "staff add deadline overrides" on public.client_deadline_overrides;
create policy "staff add deadline overrides" on public.client_deadline_overrides
  for insert to authenticated
  with check (public.is_active_staff() and public.can_access_client(client_id));

drop policy if exists "staff edit deadline overrides" on public.client_deadline_overrides;
create policy "staff edit deadline overrides" on public.client_deadline_overrides
  for update to authenticated
  using (public.is_active_staff() and public.can_access_client(client_id))
  with check (public.is_active_staff() and public.can_access_client(client_id));

revoke all on public.client_deadline_overrides from anon;
revoke delete, truncate on public.client_deadline_overrides from authenticated;
grant select, insert, update on public.client_deadline_overrides to authenticated;

create table if not exists public.client_deadline_status (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references public.clients(id),
  rule_key text not null references public.firm_deadline_rules(key) on update cascade,
  period_key text not null,
  due_date date,
  filed_by text,
  filed_at timestamptz not null default now(),
  note text,
  undone_at timestamptz,
  undone_by text,
  constraint client_deadline_status_period_check check (length(period_key) between 1 and 20),
  constraint client_deadline_status_note_check check (note is null or length(note) <= 300)
);
create unique index if not exists client_deadline_status_live_idx
  on public.client_deadline_status (client_id, rule_key, period_key) where undone_at is null;

alter table public.client_deadline_status enable row level security;

drop policy if exists "staff read deadline status" on public.client_deadline_status;
create policy "staff read deadline status" on public.client_deadline_status
  for select to authenticated
  using (public.is_active_staff() and public.can_access_client(client_id));

drop policy if exists "staff mark deadlines filed" on public.client_deadline_status;
create policy "staff mark deadlines filed" on public.client_deadline_status
  for insert to authenticated
  with check (public.is_active_staff() and public.can_access_client(client_id));

drop policy if exists "staff undo deadline status" on public.client_deadline_status;
create policy "staff undo deadline status" on public.client_deadline_status
  for update to authenticated
  using (public.is_active_staff() and public.can_access_client(client_id))
  with check (public.is_active_staff() and public.can_access_client(client_id));

revoke all on public.client_deadline_status from anon;
revoke delete, truncate on public.client_deadline_status from authenticated;
grant select, insert, update on public.client_deadline_status to authenticated;

-- Stamps who/when on all three tables and keeps the history honest.
create or replace function public.firm_deadlines_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text := lower(auth.jwt() ->> 'email');
begin
  if tg_table_name = 'firm_deadline_rules' then
    new.name := trim(new.name);
    new.description := nullif(trim(coalesce(new.description, '')), '');
    new.updated_at := now();
    if v_me is not null then new.updated_by := v_me; end if;
    if tg_op = 'UPDATE' then
      new.created_at := old.created_at;
      new.key := old.key; -- the key links overrides and filings; it never changes
    end if;
  elsif tg_table_name = 'client_deadline_overrides' then
    new.note := nullif(trim(coalesce(new.note, '')), '');
    new.updated_at := now();
    if v_me is not null then new.updated_by := v_me; end if;
    if tg_op = 'INSERT' then
      new.removed_at := null;
    else
      new.client_id := old.client_id;
      new.rule_key := old.rule_key;
      if old.removed_at is not null then
        raise exception 'That override was removed. Add a new one instead.' using errcode = '22023';
      end if;
    end if;
  else -- client_deadline_status
    if tg_op = 'INSERT' then
      new.note := nullif(trim(coalesce(new.note, '')), '');
      if v_me is not null then
        new.filed_by := v_me;
        new.filed_at := now();
      end if;
      new.undone_at := null;
      new.undone_by := null;
    else
      -- Only undo is allowed after filing; everything else stays as filed.
      new.client_id := old.client_id;
      new.rule_key := old.rule_key;
      new.period_key := old.period_key;
      new.due_date := old.due_date;
      new.filed_by := old.filed_by;
      new.filed_at := old.filed_at;
      new.note := old.note;
      if old.undone_at is not null then
        new.undone_at := old.undone_at;
        new.undone_by := old.undone_by;
      elsif new.undone_at is not null then
        new.undone_at := now();
        new.undone_by := v_me;
      end if;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.firm_deadlines_guard() from public, anon, authenticated;

drop trigger if exists firm_deadline_rules_guard_trg on public.firm_deadline_rules;
create trigger firm_deadline_rules_guard_trg
  before insert or update on public.firm_deadline_rules
  for each row execute function public.firm_deadlines_guard();

drop trigger if exists client_deadline_overrides_guard_trg on public.client_deadline_overrides;
create trigger client_deadline_overrides_guard_trg
  before insert or update on public.client_deadline_overrides
  for each row execute function public.firm_deadlines_guard();

drop trigger if exists client_deadline_status_guard_trg on public.client_deadline_status;
create trigger client_deadline_status_guard_trg
  before insert or update on public.client_deadline_status
  for each row execute function public.firm_deadlines_guard();

-- Seed: common US federal deadlines. VERIFY every year; weekends roll to
-- Monday in the app, federal holidays don't.
insert into public.firm_deadline_rules
  (key, name, description, cadence, due_rule, applies_entity_type, applies_org_type_excludes, requires_payroll, opt_in, sort)
values
  ('1099-nec', 'Form 1099-NEC',
   'Send to contractors and file with the IRS for payments made last year. Verify the date each year.',
   'annual', '{"month": 1, "day": 31}', null, null, null, false, 10),
  ('w-2', 'Forms W-2 and W-3',
   'Give employees their W-2s and file with the SSA for last year. Payroll clients only. Verify the date each year.',
   'annual', '{"month": 1, "day": 31}', null, null, true, false, 20),
  ('941', 'Form 941 (quarterly payroll)',
   'Quarterly payroll tax return, due the last day of the month after each quarter. Payroll clients only. Verify the dates each year.',
   'quarterly', '{"dates": [{"month": 4, "day": 30}, {"month": 7, "day": 31}, {"month": 10, "day": 31}, {"month": 1, "day": 31}]}',
   null, null, true, false, 30),
  ('940', 'Form 940 (annual FUTA)',
   'Annual federal unemployment tax return for last year. Payroll clients only. Verify the date each year.',
   'annual', '{"month": 1, "day": 31}', null, null, true, false, 40),
  ('990', 'Form 990 / 990-EZ / 990-N',
   'Due the 15th day of the 5th month after the fiscal year ends (May 15 for a December year end, used when no fiscal year end is set). Nonprofits only; churches are left out. Form 8868 can extend it. Verify the date and which form applies.',
   'annual', '{"fye_months": 5, "day": 15, "fallback_month": 5, "fallback_day": 15}',
   array['nonprofit'], array['Church'], null, false, 50),
  ('1096', 'Form 1096 (paper 1099s)',
   'Transmittal for 1099s filed on paper. Off by default: turn it on for each client that files on paper. Verify the date each year.',
   'annual', '{"month": 1, "day": 31}', null, null, null, true, 60)
on conflict (key) do nothing;
