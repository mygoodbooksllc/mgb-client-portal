-- =====================================================================
-- Slate month rhythm, slice 4a: report state per client month (2026-10-21)
-- Applied to production 2026-10-21 (migration slate_rhythm_4_report_state). Self-test: slate-rhythm-4-report-state-tests.sql (all ok).
-- Spec: docs/slate-rhythm-slice-4.md (a). Additive only.
-- Self-test: supabase/slate-rhythm-4-report-state-tests.sql (rolls back).
--
-- Adds:
--   table tk_report_state (client_id, period, state none|preliminary|full,
--     missing jsonb, set_by, set_at), RLS on: staff with client access read;
--     nobody writes directly (tk_set_report_state only); clients have no
--     table access at all.
--   table tk_report_state_audit, filled by trigger; admins read.
--   tk_set_report_state(text, date, text, jsonb)  staff write path
--   tk_client_report_state(text)                   the only client read path:
--     period, state and missing labels (plus the request id while that
--     request is still open). Never task ids, names, assignees or notes.
--   trigger tk_rhythm_row8_full on staff_reminders: completing a row 8
--     (month_rhythm:8_follow_up) task sets that month to full.
--
-- Rollback:
--   drop trigger if exists tk_rhythm_row8_full on public.staff_reminders;
--   drop function if exists public.tk_rhythm_row8_full();
--   drop function if exists public.tk_client_report_state(text);
--   drop function if exists public.tk_set_report_state(text, date, text, jsonb);
--   drop table if exists public.tk_report_state_audit;
--   drop table if exists public.tk_report_state;   (cascades its audit trigger)
--   drop function if exists public.tk_report_state_audit_trg();
--   drop function if exists public.tk__report_missing_ok(jsonb);
-- =====================================================================

-- 1. Shape check for the missing list ----------------------------------
create or replace function public.tk__report_missing_ok(p jsonb)
returns boolean
language sql
immutable
set search_path to 'public'
as $$
  select jsonb_typeof(p) = 'array'
     and jsonb_array_length(p) <= 30
     and not exists (
       select 1 from jsonb_array_elements(p) e
        where jsonb_typeof(e) <> 'object'
           or jsonb_typeof(e -> 'label') is distinct from 'string'
           or char_length(btrim(e ->> 'label')) not between 1 and 200
           or (e ? 'request_id' and jsonb_typeof(e -> 'request_id') not in ('string', 'null'))
           or (select count(*) from jsonb_object_keys(e) k where k not in ('label', 'request_id')) > 0
     );
$$;

-- 2. Tables --------------------------------------------------------------
create table if not exists public.tk_report_state (
  client_id text not null references public.clients(id) on delete cascade,
  period date not null check (period = date_trunc('month', period)::date),
  state text not null default 'none' check (state in ('none', 'preliminary', 'full')),
  missing jsonb not null default '[]'::jsonb check (public.tk__report_missing_ok(missing)),
  set_by text,
  set_at timestamptz not null default now(),
  primary key (client_id, period),
  check (state = 'preliminary' or missing = '[]'::jsonb)
);
alter table public.tk_report_state enable row level security;
revoke all on public.tk_report_state from public, anon, authenticated;
grant select on public.tk_report_state to authenticated;
drop policy if exists "tk report state staff read" on public.tk_report_state;
create policy "tk report state staff read" on public.tk_report_state
  for select to authenticated
  using (public.is_active_staff() and public.can_access_client(client_id));

create table if not exists public.tk_report_state_audit (
  id bigint generated always as identity primary key,
  client_id text not null,
  period date not null,
  old_state text,
  new_state text,
  old_missing jsonb,
  new_missing jsonb,
  changed_by text,
  changed_at timestamptz not null default now()
);
create index if not exists tk_report_state_audit_client on public.tk_report_state_audit (client_id, period);
alter table public.tk_report_state_audit enable row level security;
revoke all on public.tk_report_state_audit from public, anon, authenticated;
grant select on public.tk_report_state_audit to authenticated;
drop policy if exists "tk report state audit admin read" on public.tk_report_state_audit;
create policy "tk report state audit admin read" on public.tk_report_state_audit
  for select to authenticated
  using (public.is_active_staff_admin());

create or replace function public.tk_report_state_audit_trg()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_by text := coalesce(nullif(lower(coalesce(auth.jwt() ->> 'email', '')), ''), 'system');
begin
  if tg_op = 'DELETE' then
    insert into tk_report_state_audit (client_id, period, old_state, new_state, old_missing, new_missing, changed_by)
    values (old.client_id, old.period, old.state, null, old.missing, null, v_by);
    return old;
  end if;
  if tg_op = 'UPDATE' and new.state is not distinct from old.state and new.missing is not distinct from old.missing then
    return new;
  end if;
  insert into tk_report_state_audit (client_id, period, old_state, new_state, old_missing, new_missing, changed_by)
  values (new.client_id, new.period,
          case when tg_op = 'UPDATE' then old.state end, new.state,
          case when tg_op = 'UPDATE' then old.missing end, new.missing, v_by);
  return new;
end $$;
revoke all on function public.tk_report_state_audit_trg() from public, anon, authenticated;
drop trigger if exists tk_report_state_audit on public.tk_report_state;
create trigger tk_report_state_audit after insert or update or delete on public.tk_report_state
  for each row execute function public.tk_report_state_audit_trg();

-- 3. Staff write path ----------------------------------------------------
create or replace function public.tk_set_report_state(p_client text, p_period date, p_state text, p_missing jsonb default '[]'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_period date := date_trunc('month', p_period)::date;
  v_state text := lower(btrim(coalesce(p_state, '')));
  v_missing jsonb := '[]'::jsonb;
  e jsonb;
  v_label text;
  v_rid uuid;
  r public.tk_report_state%rowtype;
begin
  if v_me = '' or not public.is_active_staff() or p_client is null or not public.can_access_client(p_client) then
    raise exception 'tk_forbidden' using errcode = '42501';
  end if;
  if p_period is null or v_state not in ('none', 'preliminary', 'full') then
    raise exception 'tk_bad_report_state' using errcode = '22023';
  end if;
  if v_state = 'preliminary' then
    if p_missing is null or jsonb_typeof(p_missing) <> 'array' then
      raise exception 'tk_bad_report_state' using errcode = '22023';
    end if;
    for e in select x from jsonb_array_elements(p_missing) x loop
      v_label := case when jsonb_typeof(e) = 'object' then left(btrim(coalesce(e ->> 'label', '')), 200)
                      when jsonb_typeof(e) = 'string' then left(btrim(e #>> '{}'), 200) end;
      continue when v_label is null or v_label = '';
      v_rid := null;
      if jsonb_typeof(e) = 'object' and coalesce(e ->> 'request_id', '') ~ '^[0-9a-fA-F-]{36}$' then
        select cr.id into v_rid from client_requests cr
         where cr.id = (e ->> 'request_id')::uuid and cr.client_id = p_client and cr.deleted_at is null;
      end if;
      v_missing := v_missing || jsonb_build_array(jsonb_build_object('label', v_label, 'request_id', v_rid));
    end loop;
    if jsonb_array_length(v_missing) = 0 then
      raise exception 'tk_report_missing_required' using errcode = '22023';
    end if;
    if jsonb_array_length(v_missing) > 30 then
      raise exception 'tk_bad_report_state' using errcode = '22023';
    end if;
  end if;
  insert into tk_report_state as s (client_id, period, state, missing, set_by, set_at)
  values (p_client, v_period, v_state, v_missing, v_me, now())
  on conflict (client_id, period) do update
     set state = excluded.state, missing = excluded.missing, set_by = excluded.set_by, set_at = excluded.set_at
  returning * into r;
  return jsonb_build_object('client_id', r.client_id, 'period', r.period, 'state', r.state,
                            'missing', r.missing, 'set_by', r.set_by, 'set_at', r.set_at);
end $$;
revoke all on function public.tk_set_report_state(text, date, text, jsonb) from public, anon;
grant execute on function public.tk_set_report_state(text, date, text, jsonb) to authenticated;

-- 4. Client read path (outcomes only) ------------------------------------
-- A client user sees their own client's rows, and only when the owner has
-- turned the month rhythm on (or the client is a test client), so a staff
-- preview never reaches a real client before launch. Staff with access see
-- them always. request_id is kept only while that request is still open on
-- this client, so the link never points at something answered or gone.
create or replace function public.tk_client_report_state(p_client_id text)
returns table(period date, state text, missing jsonb)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_staff boolean := public.is_active_staff() and public.can_access_client(p_client_id);
begin
  if p_client_id is null then
    return;
  end if;
  if not v_staff then
    if not public.is_client_member(p_client_id) then
      raise exception 'tk_forbidden' using errcode = '42501';
    end if;
    if not (coalesce(public.tk__jsonb_bool((select value from tk_settings where key = 'month_rhythm_enabled')), false)
            or exists (select 1 from clients c where c.id = p_client_id and coalesce(c.test_only, false))) then
      return;
    end if;
  end if;
  return query
  select s.period, s.state,
         coalesce((select jsonb_agg(jsonb_build_object(
                     'label', e ->> 'label',
                     'request_id', (select cr.id from client_requests cr
                                     where cr.id = case when coalesce(e ->> 'request_id', '') ~ '^[0-9a-fA-F-]{36}$'
                                                        then (e ->> 'request_id')::uuid end
                                       and cr.client_id = s.client_id and cr.status = 'open'
                                       and cr.deleted_at is null and not cr.legacy_doc_request))
                     order by o)
                     from jsonb_array_elements(s.missing) with ordinality x(e, o)), '[]'::jsonb)
    from tk_report_state s
   where s.client_id = p_client_id
     and s.period >= (date_trunc('month', current_date) - interval '24 months')::date
   order by s.period desc;
end $$;
revoke all on function public.tk_client_report_state(text) from public, anon;
grant execute on function public.tk_client_report_state(text) to authenticated;

-- 5. Row 8 done -> full ----------------------------------------------------
-- Any path that completes a row 8 task (drawer, bulk, Desk, approval) sets
-- that client month to full. The 24th auto-complete (mgb.tk_rhythm, slice
-- 4b) is skipped: it closes row 8 only when nothing was preliminary, and must
-- not claim full reports were sent. A failure here never blocks completing.
create or replace function public.tk_rhythm_row8_full()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_ref text;
begin
  if coalesce(current_setting('mgb.tk_rhythm', true), '') = 'on'
     or coalesce(current_setting('mgb.tk_migrate', true), '') = 'on' then
    return null;
  end if;
  if new.client_id is null or new.period_kind is distinct from 'month' or new.period_start is null then
    return null;
  end if;
  select t.source_ref into v_ref from task_templates t where t.id = new.template_id;
  if v_ref is distinct from 'month_rhythm:8_follow_up' then
    return null;
  end if;
  begin
    insert into tk_report_state (client_id, period, state, missing, set_by, set_at)
    values (new.client_id, date_trunc('month', new.period_start)::date, 'full', '[]'::jsonb,
            coalesce(nullif(lower(coalesce(auth.jwt() ->> 'email', '')), ''), 'system'), now())
    on conflict (client_id, period) do update
       set state = 'full', missing = '[]'::jsonb, set_by = excluded.set_by, set_at = excluded.set_at
     where tk_report_state.state is distinct from 'full';
  exception when others then
    raise warning 'tk_rhythm_row8_full: %', sqlerrm;
  end;
  return null;
end $$;
revoke all on function public.tk_rhythm_row8_full() from public, anon, authenticated;
drop trigger if exists tk_rhythm_row8_full on public.staff_reminders;
create trigger tk_rhythm_row8_full after update of status, done on public.staff_reminders
  for each row
  when (new.done and not coalesce(old.done, false) and new.template_id is not null)
  execute function public.tk_rhythm_row8_full();

do $c$
begin
  if not exists (select 1 from pg_class where oid = 'public.tk_report_state'::regclass and relrowsecurity)
     or not exists (select 1 from pg_class where oid = 'public.tk_report_state_audit'::regclass and relrowsecurity) then
    raise exception 'slate rhythm s4a: RLS missing';
  end if;
  if has_table_privilege('authenticated', 'public.tk_report_state', 'insert')
     or has_table_privilege('authenticated', 'public.tk_report_state', 'update')
     or has_table_privilege('authenticated', 'public.tk_report_state', 'delete')
     or has_table_privilege('anon', 'public.tk_report_state', 'select') then
    raise exception 'slate rhythm s4a: table grants too wide';
  end if;
end $c$;
