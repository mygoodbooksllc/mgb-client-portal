-- Firm-wide audit log (owner request 2026-09-29).
--
-- Applied to production 2026-09-29 as migration audit_log.
-- Safe to re-run.
--
-- audit_log            one row per sensitive change. Admins read; nobody
--                      writes directly (no insert/update/delete grants or
--                      policies). Rows come only from:
--   audit_row_change()   SECURITY DEFINER trigger on the sensitive tables
--                        below. Actor = auth.jwt()->>'email', or 'system'
--                        when there is no JWT (cron, edge functions with the
--                        service role, the SQL editor).
--   log_audit_event()    RPC for client-side events staff can't express as a
--                        row change ("View as" start/stop, client portal
--                        preview). Active staff only; actions are allow-listed
--                        so it can't be used to forge row-change entries.
--
-- Tables covered (all exist as of 2026-09-29):
--   staff_client_access         client_access.assigned / .unassigned
--   staff_client_access_grants  access_grant.requested / approved / denied /
--                               revoked / cancelled
--   staff                       staff.added / role_changed / activated /
--                               deactivated / removed
--   client_fees                 client_fee.set / changed / removed
--   staff_cost_rates            cost_rate.set / changed / removed
--   profitability_settings      profitability.target_changed
--   qbo_customer_client_map     qbo_customer_map.changed (manual changes only:
--                               a signed-in person or manual=true; the sync's
--                               last_seen_at bumps are ignored)
--   qbo_employee_staff_map      qbo_employee_map.changed (same rule)
--   qbo_firm_connection         qbo_firm.connected / disconnected
--   clients                     client.created / deleted / plan_changed /
--                               updated (org type, payroll add-on, test flag)
--   client_milestones           client.tier_changed (confirmed_tier; the
--                               pricing tier lives here, not on clients)
--
-- The older staff_audit_log (staff-audit-log.sql) is superseded by this table
-- (the staff.* actions above cover the same changes) but is left in place,
-- data and all. Checked 2026-09-29: it is NOT unused yet. The
-- staff_audit_trigger on staff (log_staff_change) still writes to it, and the
-- Developer Tools page's "Recent Activity" card (DeveloperToolsPage in
-- app.jsx) still reads it. New code should read/write audit_log instead;
-- retire the old table only after that card is moved over.

begin;

create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_email text not null default 'system',
  action text not null,
  client_id text,
  target_type text,
  target_id text,
  details jsonb not null default '{}'::jsonb
);
create index if not exists audit_log_at_idx on public.audit_log (at desc);
create index if not exists audit_log_actor_idx on public.audit_log (actor_email, at desc);
create index if not exists audit_log_client_idx on public.audit_log (client_id, at desc);
create index if not exists audit_log_action_idx on public.audit_log (action, at desc);

alter table public.audit_log enable row level security;
revoke all on public.audit_log from anon, authenticated;
grant select on public.audit_log to authenticated;

drop policy if exists "admins read audit log" on public.audit_log;
create policy "admins read audit log" on public.audit_log
  for select to authenticated using (public.is_active_staff_admin());

-- ---------------------------------------------------------------------------
-- Internal writer (not callable from the API)
-- ---------------------------------------------------------------------------
create or replace function public.audit_write(
  p_action text, p_client_id text, p_target_type text, p_target_id text, p_details jsonb
) returns void
language sql
security definer
set search_path = public
as $$
  insert into audit_log (actor_email, action, client_id, target_type, target_id, details)
  values (
    coalesce(nullif(auth.jwt() ->> 'email', ''), 'system'),
    p_action, p_client_id, p_target_type, p_target_id,
    coalesce(p_details, '{}'::jsonb)
  );
$$;
revoke all on function public.audit_write(text, text, text, text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- One trigger function for every audited table
-- ---------------------------------------------------------------------------
create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  t text := tg_table_name;
  o jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  n jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  r jsonb := coalesce(n, o);
  v_actor text := nullif(auth.jwt() ->> 'email', '');
begin
  if t = 'staff_client_access' then
    perform audit_write(
      case when tg_op = 'DELETE' then 'client_access.unassigned' else 'client_access.assigned' end,
      r ->> 'client_id', 'staff', r ->> 'staff_email', '{}'::jsonb)
    where tg_op in ('INSERT', 'DELETE');

  elsif t = 'staff_client_access_grants' then
    if tg_op = 'INSERT' then
      perform audit_write('access_grant.requested', n ->> 'client_id', 'staff', n ->> 'staff_email',
        jsonb_build_object('grant_id', n ->> 'id', 'reason', n ->> 'reason', 'days', n -> 'duration_days',
                           'status', n ->> 'status'));
    elsif tg_op = 'UPDATE' and (o ->> 'status') is distinct from (n ->> 'status') then
      perform audit_write('access_grant.' || coalesce(n ->> 'status', 'changed'), n ->> 'client_id', 'staff',
        n ->> 'staff_email',
        jsonb_build_object('grant_id', n ->> 'id', 'from', o ->> 'status', 'expires_at', n ->> 'expires_at'));
    elsif tg_op = 'DELETE' then
      perform audit_write('access_grant.deleted', o ->> 'client_id', 'staff', o ->> 'staff_email',
        jsonb_build_object('grant_id', o ->> 'id', 'status', o ->> 'status'));
    end if;

  elsif t = 'staff' then
    if tg_op = 'INSERT' then
      perform audit_write('staff.added', null, 'staff', n ->> 'email',
        jsonb_build_object('role', n ->> 'role', 'name', n ->> 'name'));
    elsif tg_op = 'DELETE' then
      perform audit_write('staff.removed', null, 'staff', o ->> 'email',
        jsonb_build_object('role', o ->> 'role', 'name', o ->> 'name'));
    else
      if (o ->> 'role') is distinct from (n ->> 'role') then
        perform audit_write('staff.role_changed', null, 'staff', n ->> 'email',
          jsonb_build_object('from', o ->> 'role', 'to', n ->> 'role'));
      end if;
      if (o ->> 'active') is distinct from (n ->> 'active') then
        perform audit_write(case when (n ->> 'active')::boolean then 'staff.activated' else 'staff.deactivated' end,
          null, 'staff', n ->> 'email', '{}'::jsonb);
      end if;
    end if;

  elsif t = 'client_fees' then
    if tg_op = 'UPDATE' and (o ->> 'monthly_fee') is not distinct from (n ->> 'monthly_fee') then
      return null;
    end if;
    perform audit_write(
      case tg_op when 'INSERT' then 'client_fee.set' when 'DELETE' then 'client_fee.removed' else 'client_fee.changed' end,
      r ->> 'client_id', 'client', r ->> 'client_id',
      jsonb_build_object('from', o -> 'monthly_fee', 'to', n -> 'monthly_fee'));

  elsif t = 'staff_cost_rates' then
    if tg_op = 'UPDATE' and (o ->> 'hourly_cost') is not distinct from (n ->> 'hourly_cost')
       and (o ->> 'effective_from') is not distinct from (n ->> 'effective_from') then
      return null;
    end if;
    perform audit_write(
      case tg_op when 'INSERT' then 'cost_rate.set' when 'DELETE' then 'cost_rate.removed' else 'cost_rate.changed' end,
      null, 'staff', r ->> 'staff_email',
      jsonb_build_object('effective_from', r ->> 'effective_from',
                         'from', o -> 'hourly_cost', 'to', n -> 'hourly_cost'));

  elsif t = 'profitability_settings' then
    if (o ->> 'target_margin_pct') is distinct from (n ->> 'target_margin_pct') then
      perform audit_write('profitability.target_changed', null, 'settings', 'profitability',
        jsonb_build_object('from', o -> 'target_margin_pct', 'to', n -> 'target_margin_pct'));
    end if;

  elsif t = 'qbo_customer_client_map' then
    if (v_actor is not null or coalesce((n ->> 'manual')::boolean, false))
       and (tg_op <> 'UPDATE'
            or (o ->> 'client_id') is distinct from (n ->> 'client_id')
            or (o ->> 'ignored') is distinct from (n ->> 'ignored')
            or (o ->> 'manual') is distinct from (n ->> 'manual')) then
      perform audit_write('qbo_customer_map.' || lower(tg_op),
        coalesce(n ->> 'client_id', o ->> 'client_id'), 'qbo_customer', r ->> 'qbo_customer_id',
        jsonb_build_object('customer', r ->> 'customer_name',
                           'from_client', o ->> 'client_id', 'to_client', n ->> 'client_id',
                           'ignored', n -> 'ignored', 'manual', n -> 'manual'));
    end if;

  elsif t = 'qbo_employee_staff_map' then
    if (v_actor is not null or coalesce((n ->> 'manual')::boolean, false))
       and (tg_op <> 'UPDATE'
            or (o ->> 'staff_email') is distinct from (n ->> 'staff_email')
            or (o ->> 'ignored') is distinct from (n ->> 'ignored')
            or (o ->> 'manual') is distinct from (n ->> 'manual')) then
      perform audit_write('qbo_employee_map.' || lower(tg_op), null, 'qbo_employee', r ->> 'qbo_id',
        jsonb_build_object('name', r ->> 'display_name',
                           'from_staff', o ->> 'staff_email', 'to_staff', n ->> 'staff_email',
                           'ignored', n -> 'ignored', 'manual', n -> 'manual'));
    end if;

  elsif t = 'qbo_firm_connection' then
    if tg_op = 'DELETE' then
      perform audit_write('qbo_firm.disconnected', null, 'qbo_firm', o ->> 'realm_id',
        jsonb_build_object('company', o ->> 'company_name'));
    elsif tg_op = 'INSERT' or (o ->> 'status') is distinct from (n ->> 'status')
          or (o ->> 'realm_id') is distinct from (n ->> 'realm_id') then
      if (n ->> 'status') = 'connected' or tg_op = 'INSERT' then
        perform audit_write('qbo_firm.connected', null, 'qbo_firm', n ->> 'realm_id',
          jsonb_build_object('company', n ->> 'company_name', 'status', n ->> 'status'));
      elsif (o ->> 'status') = 'connected' then
        perform audit_write(case when (n ->> 'status') = 'disconnected' then 'qbo_firm.disconnected'
                                 else 'qbo_firm.status_changed' end,
          null, 'qbo_firm', n ->> 'realm_id',
          jsonb_build_object('from', o ->> 'status', 'to', n ->> 'status', 'error', n ->> 'last_error'));
      end if;
    end if;

  elsif t = 'clients' then
    if tg_op = 'INSERT' then
      perform audit_write('client.created', n ->> 'id', 'client', n ->> 'id',
        jsonb_build_object('name', n ->> 'name', 'plan', n ->> 'plan'));
    elsif tg_op = 'DELETE' then
      perform audit_write('client.deleted', o ->> 'id', 'client', o ->> 'id',
        jsonb_build_object('name', o ->> 'name', 'plan', o ->> 'plan'));
    else
      if (o ->> 'plan') is distinct from (n ->> 'plan') then
        perform audit_write('client.plan_changed', n ->> 'id', 'client', n ->> 'id',
          jsonb_build_object('from', o ->> 'plan', 'to', n ->> 'plan'));
      end if;
      if (o ->> 'org_type') is distinct from (n ->> 'org_type')
         or (o ->> 'payroll_add_on') is distinct from (n ->> 'payroll_add_on')
         or (o ->> 'test_only') is distinct from (n ->> 'test_only') then
        perform audit_write('client.updated', n ->> 'id', 'client', n ->> 'id',
          jsonb_build_object(
            'org_type', jsonb_build_array(o -> 'org_type', n -> 'org_type'),
            'payroll_add_on', jsonb_build_array(o -> 'payroll_add_on', n -> 'payroll_add_on'),
            'test_only', jsonb_build_array(o -> 'test_only', n -> 'test_only')));
      end if;
    end if;

  elsif t = 'client_milestones' then
    if (o ->> 'confirmed_tier') is distinct from (n ->> 'confirmed_tier') then
      perform audit_write('client.tier_changed', r ->> 'client_id', 'client', r ->> 'client_id',
        jsonb_build_object('from', o -> 'confirmed_tier', 'to', n -> 'confirmed_tier'));
    end if;
  end if;

  return null;
end;
$$;
revoke all on function public.audit_row_change() from public, anon, authenticated;

do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'staff_client_access', 'staff_client_access_grants', 'staff', 'client_fees',
    'staff_cost_rates', 'profitability_settings', 'qbo_customer_client_map',
    'qbo_employee_staff_map', 'qbo_firm_connection', 'clients', 'client_milestones'
  ] loop
    if to_regclass('public.' || tbl) is not null then
      execute format('drop trigger if exists audit_log_trg on public.%I', tbl);
      execute format(
        'create trigger audit_log_trg after insert or update or delete on public.%I
           for each row execute function public.audit_row_change()', tbl);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Client-side events (staff only, allow-listed actions)
-- ---------------------------------------------------------------------------
create or replace function public.log_audit_event(
  p_action text, p_client_id text default null, p_details jsonb default '{}'::jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_active_staff() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_action not in ('view_as.start', 'view_as.stop', 'portal_preview.start', 'portal_preview.stop') then
    raise exception 'unknown audit action %', p_action using errcode = '22023';
  end if;
  if p_client_id is not null and not public.can_access_client(p_client_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  insert into audit_log (actor_email, action, client_id, target_type, target_id, details)
  values (
    auth.jwt() ->> 'email', p_action, p_client_id,
    case when p_action like 'view_as.%' then 'staff' else 'client_user' end,
    left(coalesce(p_details ->> 'target', ''), 200),
    -- Bounded so the RPC can't be used to stuff large blobs into the log.
    case when length(coalesce(p_details, '{}'::jsonb)::text) <= 2000
         then coalesce(p_details, '{}'::jsonb) else '{}'::jsonb end
  );
end;
$$;
revoke all on function public.log_audit_event(text, text, jsonb) from public, anon;
grant execute on function public.log_audit_event(text, text, jsonb) to authenticated;

commit;
