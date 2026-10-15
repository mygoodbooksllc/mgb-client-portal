-- =====================================================================
-- Tasks Phase 2, slice S2: periods and admin sign-off.
-- Spec: docs/tasks-phase2-spec.md C2 + F (+ critique M6, M7, M15, m9).
--
-- Safe to re-run, one transaction (apply_migration or begin/commit).
-- Nothing is dropped except the month_close primary key, which is swapped
-- in place for (client_id, period_kind, period). Every row is kept and a
-- full copy sits in month_close_p2_backup (kept, never dropped in Phase 2).
--
-- What changes:
--   1. month_close gets period_kind ('month' | 'quarter' | 'year', default
--      'month'), sign-off / reopen columns, reviewer_email and ready_at.
--      Quarters are calendar quarters; 'year' is the client's fiscal year
--      (owner answer Q2).
--   2. The PK widens to (client_id, period_kind, period) (owner decision 3).
--   3. Every live function that reads or upserts month_close is patched
--      in place to month rows only (gate, reopen, reports-ready email,
--      ledger review, baselines, client_health, staff_performance). The
--      repo files that define them carry the same edits, so a re-run of an
--      older file does not revert this.
--   4. Only an admin sign-off (tk_sign_off_period) can make a period Done,
--      and only tk_reopen_period can take it out of Done (decision 4: open
--      tasks warn, they never block). Everyone else uses 'review' ("Ready
--      for sign-off"). Guard trigger: month_close_signoff_guard. The RPCs
--      set the transaction-local flag mgb.tk_signoff = 'on'.
--   5. ready_at is stamped the first time a period reaches review or done;
--      the bookkeeper close KPI uses it, so admin sign-off delay is not
--      the bookkeeper's (critique M7).
--   6. Reports-ready client email: month rows only (Q3) and at most once
--      per client user per month within 7 days (critique m9).
--   7. staff_reminders gets period_kind / period_start (filled by the S4
--      generator; nothing writes them yet).
--   8. client_profile.fiscal_year_end: a non-admin cannot change it once
--      the client has fiscal-year rows in month_close (critique M6).
--
-- The live pg_default_acl hands anon and authenticated every privilege on
-- new tables and EXECUTE on new functions, so each new object starts from
-- "revoke all" and then gets exactly what it needs.
-- =====================================================================

-- 0. Helper: patch a live function body in place ------------------------
create or replace function pg_temp.patch_fn(p_sig text, p_from text, p_to text, p_expected int)
returns void
language plpgsql
as $f$
declare
  d text;
  n int;
begin
  d := pg_get_functiondef(p_sig::regprocedure);
  if position(p_to in d) > 0 then
    return;  -- already patched
  end if;
  n := (length(d) - length(replace(d, p_from, ''))) / length(p_from);
  if n <> p_expected then
    raise exception 'patch_fn %: expected % occurrence(s) of anchor %, found %', p_sig, p_expected, p_from, n;
  end if;
  execute replace(d, p_from, p_to);
end
$f$;

-- 1. Backup (first run only) --------------------------------------------
create table if not exists public.month_close_p2_backup as
  select * from public.month_close;

alter table public.month_close_p2_backup enable row level security;
revoke all on table public.month_close_p2_backup from public, anon, authenticated;
grant select on table public.month_close_p2_backup to authenticated;
drop policy if exists "admins read month close backup" on public.month_close_p2_backup;
create policy "admins read month close backup" on public.month_close_p2_backup
  for select to authenticated using (public.is_active_staff_admin());

-- 2. New month_close columns ---------------------------------------------
alter table public.month_close add column if not exists period_kind text not null default 'month';
alter table public.month_close add column if not exists signed_off_by text;
alter table public.month_close add column if not exists signed_off_at timestamptz;
alter table public.month_close add column if not exists reopened_reason text;
alter table public.month_close add column if not exists reopened_by text;
alter table public.month_close add column if not exists reopened_at timestamptz;
alter table public.month_close add column if not exists reviewer_email text;
alter table public.month_close add column if not exists ready_at timestamptz;

-- 3. CHECKs (the first-of-month CHECK stays: quarters and years start on day 1)
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'month_close_period_kind_check'
                   and conrelid = 'public.month_close'::regclass) then
    alter table public.month_close add constraint month_close_period_kind_check
      check (period_kind in ('month', 'quarter', 'year')) not valid;
    alter table public.month_close validate constraint month_close_period_kind_check;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'month_close_quarter_aligned'
                   and conrelid = 'public.month_close'::regclass) then
    alter table public.month_close add constraint month_close_quarter_aligned
      check (period_kind <> 'quarter' or extract(month from period)::int in (1, 4, 7, 10)) not valid;
    alter table public.month_close validate constraint month_close_quarter_aligned;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'month_close_reopened_reason_len'
                   and conrelid = 'public.month_close'::regclass) then
    alter table public.month_close add constraint month_close_reopened_reason_len
      check (reopened_reason is null or char_length(reopened_reason) <= 500) not valid;
    alter table public.month_close validate constraint month_close_reopened_reason_len;
  end if;
end $$;

-- 4. Primary key -> (client_id, period_kind, period) ---------------------
do $$
declare
  v_name text;
  v_cols text;
begin
  select c.conname,
         string_agg(a.attname, ',' order by k.ord)
    into v_name, v_cols
    from pg_constraint c
    cross join lateral unnest(c.conkey) with ordinality as k(attnum, ord)
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
   where c.conrelid = 'public.month_close'::regclass and c.contype = 'p'
   group by c.conname;
  if v_cols is distinct from 'client_id,period_kind,period' then
    lock table public.month_close in access exclusive mode;
    if v_name is not null then
      execute format('alter table public.month_close drop constraint %I', v_name);
    end if;
    alter table public.month_close add constraint month_close_pkey primary key (client_id, period_kind, period);
  end if;
end $$;

-- 5. Live functions: month rows only, new conflict target ----------------
-- GL gate: quarters and years have no ledger review.
select pg_temp.patch_fn('public.month_close_gl_review_gate()',
  E'  if not v_becomes_done then\n',
  E'  if not v_becomes_done or new.period_kind <> ''month'' then\n', 1);

-- GL reopen: only a month's ledger sign-off reopens.
select pg_temp.patch_fn('public.month_close_gl_review_reopen()',
  $a$  if old.status <> 'done' or (tg_op = 'UPDATE' and new.status = 'done') then$a$,
  $a$  if old.status <> 'done' or old.period_kind <> 'month' or (tg_op = 'UPDATE' and new.status = 'done') then$a$, 1);

-- Ledger review "first tick" starts the month row.
select pg_temp.patch_fn('public.gl_review_mark_reviewed(text,date)',
  $a$on conflict (client_id, period) do update set status = 'in_progress'$a$,
  $a$on conflict (client_id, period_kind, period) do update set status = 'in_progress'$a$, 1);

-- Baselines: the month's done row.
select pg_temp.patch_fn('public.gl_review_baseline_from_last_print(text,date)',
  $a$   where client_id = p_client_id and period = v_period and status = 'done';$a$,
  $a$   where client_id = p_client_id and period_kind = 'month' and period = v_period and status = 'done';$a$, 1);
select pg_temp.patch_fn('public.gl_review_store_baseline(text,date,text,integer,numeric,text,jsonb,text)',
  $a$select 1 from month_close where client_id = p_client_id and period = v_period and status = 'done'$a$,
  $a$select 1 from month_close where client_id = p_client_id and period_kind = 'month' and period = v_period and status = 'done'$a$, 1);

-- Client health: the month row.
select pg_temp.patch_fn('public.client_health(jsonb)',
  $a$left join public.month_close m on m.client_id = c.id and m.period = $1$a$,
  $a$left join public.month_close m on m.client_id = c.id and m.period_kind = 'month' and m.period = $1$a$, 1);

-- Staff performance close KPI: month rows; the bookkeeper's own ready time
-- counts, so admin sign-off delay is not theirs (critique M7).
select pg_temp.patch_fn('public.staff_performance(integer,jsonb)',
  $a$left join public.month_close mc on mc.client_id = cl.client_id and mc.period = pr.period$a$,
  $a$left join public.month_close mc on mc.client_id = cl.client_id and mc.period_kind = 'month' and mc.period = pr.period$a$, 1);
select pg_temp.patch_fn('public.staff_performance(integer,jsonb)',
  $a$count(*) filter (where mc.status in ('done', 'na') and mc.updated_at::date <= pr.deadline)::int as done$a$,
  $a$count(*) filter (where mc.status in ('done', 'na', 'review') and coalesce(mc.ready_at, mc.signed_off_at, mc.done_at, mc.updated_at)::date <= pr.deadline)::int as done$a$, 1);

-- Reports-ready client email: months only (Q3), and not again to the same
-- person for the same month within 7 days (critique m9). Same body lives in
-- notification-emails.sql.
create or replace function public.notify_enqueue_reports_ready()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'done' and new.period_kind = 'month'
     and (tg_op = 'INSERT' or old.status is distinct from 'done') then
    insert into notification_outbox (kind, recipient_email, client_id, ref_id, payload)
    select 'client_reports_ready', lower(cu.email), new.client_id,
           new.client_id || ':' || new.period::text,
           jsonb_build_object('period', new.period)
    from client_users cu
    where cu.client_id = new.client_id and cu.active
      and not exists (
        select 1 from notification_outbox o
         where o.kind = 'client_reports_ready'
           and o.ref_id = new.client_id || ':' || new.period::text
           and o.recipient_email = lower(cu.email)
           and o.created_at > now() - interval '7 days');
  end if;
  return null;
end;
$$;

-- 6. tk_activity kind: + period_signed_off (restates the live list) ------
alter table public.tk_activity drop constraint if exists tk_activity_kind_check;
alter table public.tk_activity add constraint tk_activity_kind_check check (kind in (
  'created', 'status', 'assignee', 'due', 'priority', 'section', 'comment',
  'review_approved', 'review_sent_back', 'client_asked', 'client_answered',
  'reassigned_ooo', 'imported', 'deleted', 'restored', 'moved',
  'period_signed_off'));

-- 7. Task -> period link (no FK; spec C2 decision) -----------------------
alter table public.staff_reminders add column if not exists period_kind text;
alter table public.staff_reminders add column if not exists period_start date;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'staff_reminders_period_kind_check'
                   and conrelid = 'public.staff_reminders'::regclass) then
    alter table public.staff_reminders add constraint staff_reminders_period_kind_check
      check ((period_kind is null and period_start is null)
          or (period_kind in ('month', 'quarter', 'year') and period_start is not null)) not valid;
    alter table public.staff_reminders validate constraint staff_reminders_period_kind_check;
  end if;
end $$;
create index if not exists staff_reminders_period_idx
  on public.staff_reminders (client_id, period_kind, period_start)
  where deleted_at is null;

-- 8. Period start for a client --------------------------------------------
-- month: first of the month. quarter: calendar quarter (Q2). year: the
-- client's fiscal year, from client_profile.fiscal_year_end (default 12-31).
create or replace function public.tk_period_start(p_client_id text, p_kind text, p_date date)
returns date
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_fye text;
begin
  if auth.uid() is not null and not public.is_active_staff() then
    raise exception 'Staff only' using errcode = '42501';
  end if;
  if p_kind not in ('month', 'quarter', 'year') then
    raise exception 'Unknown period kind %', p_kind using errcode = '22023';
  end if;
  if p_kind = 'year' then
    select fiscal_year_end into v_fye from public.client_profile where client_id = p_client_id;
  end if;
  return public.tk_period_start_for(p_kind, p_date, v_fye);
end;
$$;

-- 9. Guard: only the sign-off / reopen RPCs move a period in or out of Done
create or replace function public.month_close_signoff_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_flag boolean := coalesce(current_setting('mgb.tk_signoff', true), '') = 'on';
  -- A signed-in person (uid or email claim). Service role / SQL editor: neither.
  v_user boolean := auth.uid() is not null or nullif(auth.jwt() ->> 'email', '') is not null;
  v_fye text;
begin
  if tg_op = 'UPDATE' and new.period_kind is distinct from old.period_kind then
    raise exception 'A period''s kind cannot change' using errcode = '22023';
  end if;
  if new.period_kind = 'year' and (tg_op = 'INSERT' or new.period is distinct from old.period) then
    select fiscal_year_end into v_fye from public.client_profile where client_id = new.client_id;
    if new.period <> public.tk_period_start_for('year', new.period, v_fye) then
      raise exception 'That date is not the start of this client''s fiscal year' using errcode = '22023';
    end if;
  end if;

  if v_user and not v_flag then
    if new.status = 'done' and (tg_op = 'INSERT' or old.status is distinct from 'done') then
      raise exception 'Only an admin sign-off can close a period' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and old.status = 'done' and new.status <> 'done' then
      raise exception 'A signed-off period can only be reopened by an admin, with a reason' using errcode = '42501';
    end if;
    if tg_op = 'INSERT' then
      new.signed_off_by := null;  new.signed_off_at := null;
      new.reopened_reason := null; new.reopened_by := null; new.reopened_at := null;
      new.ready_at := null;
      if new.reviewer_email is not null and not public.is_active_staff_admin() then
        new.reviewer_email := null;
      end if;
    else
      new.signed_off_by := old.signed_off_by;  new.signed_off_at := old.signed_off_at;
      new.reopened_reason := old.reopened_reason; new.reopened_by := old.reopened_by;
      new.reopened_at := old.reopened_at;
      new.ready_at := old.ready_at;
      if new.reviewer_email is distinct from old.reviewer_email and not public.is_active_staff_admin() then
        new.reviewer_email := old.reviewer_email;
      end if;
    end if;
    -- Back to work: the next "ready" stamps a fresh time.
    if new.status in ('not_started', 'in_progress') then
      new.ready_at := null;
    end if;
  end if;

  if new.status in ('review', 'done') and new.ready_at is null then
    new.ready_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists month_close_signoff_guard on public.month_close;
create trigger month_close_signoff_guard
  before insert or update on public.month_close
  for each row execute function public.month_close_signoff_guard();

-- 10. Sign off ------------------------------------------------------------
-- Admin only. Open tasks linked to the period warn (needs_ack) and never
-- block (decision 4). p_expected_updated_at gives the same optimistic
-- concurrency as CT_saveMonthClose (40001 on a mismatch, critique M15).
-- For a month the GL gate trigger still runs: the app runs CT_ledgerGate
-- (override) before calling this.
create or replace function public.tk_sign_off_period(
  p_client_id text,
  p_kind text,
  p_period date,
  p_note text default null,
  p_ack_open boolean default false,
  p_expected_updated_at timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(nullif(btrim(auth.jwt() ->> 'email'), ''));
  v_row public.month_close;
  v_open int;
  v_sample jsonb;
  v_notes text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not public.is_active_staff_admin() then
    raise exception 'Only an admin can sign off a period' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('month', 'quarter', 'year') then
    raise exception 'Unknown period kind %', p_kind using errcode = '22023';
  end if;
  if not exists (select 1 from public.clients where id = p_client_id) or not public.can_access_client(p_client_id) then
    raise exception 'Unknown client' using errcode = '22023';
  end if;
  if p_period is null or p_period <> public.tk_period_start(p_client_id, p_kind, p_period) then
    raise exception 'That date is not the start of a %', p_kind using errcode = '22023';
  end if;

  select * into v_row from public.month_close
   where client_id = p_client_id and period_kind = p_kind and period = p_period
   for update;
  if p_expected_updated_at is not null
     and (v_row.client_id is null or v_row.updated_at is distinct from p_expected_updated_at) then
    raise exception 'Someone else changed this period. Reload and try again.' using errcode = '40001';
  end if;
  if v_row.status = 'done' then
    return jsonb_build_object('ok', true, 'already', true, 'signed_off_at', v_row.signed_off_at,
                              'updated_at', v_row.updated_at, 'open_tasks', 0);
  end if;

  select count(*) into v_open
    from public.staff_reminders r
   where r.client_id = p_client_id and r.period_kind = p_kind and r.period_start = p_period
     and r.deleted_at is null and r.visibility = 'shared' and r.status <> 'done';

  if v_open > 0 and not coalesce(p_ack_open, false) then
    select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'title', x.text, 'status', x.status)), '[]'::jsonb)
      into v_sample
      from (select r.id, r.text, r.status
              from public.staff_reminders r
             where r.client_id = p_client_id and r.period_kind = p_kind and r.period_start = p_period
               and r.deleted_at is null and r.visibility = 'shared' and r.status <> 'done'
             order by r.due_date nulls last, r.created_at
             limit 5) x;
    return jsonb_build_object('ok', false, 'needs_ack', true, 'open_tasks', v_open, 'sample', v_sample);
  end if;

  v_notes := v_row.notes;
  if v_note is not null then
    v_notes := concat_ws(E'\n', nullif(v_notes, ''), 'Sign-off: ' || v_note);
    if char_length(v_notes) > 2000 then
      raise exception 'Notes would be over 2000 characters. Shorten the sign-off note.' using errcode = '22023';
    end if;
  end if;

  perform set_config('mgb.tk_signoff', 'on', true);
  insert into public.month_close as m (client_id, period_kind, period, status, notes, signed_off_by, signed_off_at)
  values (p_client_id, p_kind, p_period, 'done', v_notes, v_email, now())
  on conflict (client_id, period_kind, period) do update
    set status = 'done', notes = excluded.notes,
        signed_off_by = excluded.signed_off_by, signed_off_at = excluded.signed_off_at
  returning * into v_row;
  perform set_config('mgb.tk_signoff', 'off', true);

  if v_open > 0 then
    insert into public.tk_activity (task_id, actor_email, kind, to_value, meta)
    select r.id, coalesce(v_email, 'system'), 'period_signed_off', p_kind || ':' || p_period::text,
           jsonb_build_object('client_id', p_client_id, 'period_kind', p_kind, 'period', p_period)
      from public.staff_reminders r
     where r.client_id = p_client_id and r.period_kind = p_kind and r.period_start = p_period
       and r.deleted_at is null and r.visibility = 'shared' and r.status <> 'done';
  end if;

  return jsonb_build_object('ok', true, 'signed_off_at', v_row.signed_off_at,
                            'updated_at', v_row.updated_at, 'open_tasks', v_open);
end;
$$;

-- 11. Reopen --------------------------------------------------------------
-- Admin only, with a reason. For a month the GL reopen trigger still
-- reopens the ledger sign-off.
create or replace function public.tk_reopen_period(p_client_id text, p_kind text, p_period date, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(nullif(btrim(auth.jwt() ->> 'email'), ''));
  v_reason text := btrim(coalesce(p_reason, ''));
  v_status text;
begin
  if not public.is_active_staff_admin() then
    raise exception 'Only an admin can reopen a period' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('month', 'quarter', 'year') then
    raise exception 'Unknown period kind %', p_kind using errcode = '22023';
  end if;
  -- Same client check as tk_sign_off_period: SECURITY DEFINER skips RLS, so
  -- the internal-company lock (can_view_internal) is enforced here.
  if not public.can_access_client(p_client_id) then
    raise exception 'Unknown client' using errcode = '22023';
  end if;
  if char_length(v_reason) < 3 or char_length(v_reason) > 500 then
    raise exception 'Give a reason (3 to 500 characters)' using errcode = '22023';
  end if;
  select status into v_status from public.month_close
   where client_id = p_client_id and period_kind = p_kind and period = p_period
   for update;
  if v_status is distinct from 'done' then
    raise exception 'This period is not signed off' using errcode = '22023';
  end if;

  perform set_config('mgb.tk_signoff', 'on', true);
  update public.month_close
     set status = 'in_progress',
         signed_off_by = null, signed_off_at = null,
         reopened_reason = v_reason, reopened_by = v_email, reopened_at = now()
   where client_id = p_client_id and period_kind = p_kind and period = p_period;
  perform set_config('mgb.tk_signoff', 'off', true);
end;
$$;

-- 12. Period summary for the sign-off panel -------------------------------
create or replace function public.tk_period_summary(p_client_id text, p_kind text, p_period date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v jsonb;
  r public.month_close;
begin
  if not (public.is_active_staff() and public.can_access_client(p_client_id)) then
    raise exception 'Staff only' using errcode = '42501';
  end if;
  select jsonb_build_object(
           'open',    count(*) filter (where s.status in ('todo', 'in_progress')),
           'review',  count(*) filter (where s.status = 'ready_for_review'),
           'waiting', count(*) filter (where s.status = 'waiting_client'),
           'done',    count(*) filter (where s.status = 'done'),
           'total',   count(*))
    into v
    from public.staff_reminders s
   where s.client_id = p_client_id and s.period_kind = p_kind and s.period_start = p_period
     and s.deleted_at is null and s.visibility = 'shared';
  select * into r from public.month_close
   where client_id = p_client_id and period_kind = p_kind and period = p_period;
  return v || jsonb_build_object(
    'status', coalesce(r.status, 'not_started'),
    'signed_off_by', r.signed_off_by, 'signed_off_at', r.signed_off_at,
    'reopened_by', r.reopened_by, 'reopened_at', r.reopened_at, 'reopened_reason', r.reopened_reason,
    'ready_at', r.ready_at, 'updated_at', r.updated_at, 'updated_by', r.updated_by);
end;
$$;

-- 13. Fiscal year end: locked for non-admins once year rows exist (M6) ----
create or replace function public.client_profile_guard_fiscal_year_end()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (auth.uid() is null and nullif(auth.jwt() ->> 'email', '') is null) or public.is_active_staff_admin() then
    return new;
  end if;
  if new.fiscal_year_end is distinct from old.fiscal_year_end
     and exists (select 1 from public.month_close m
                  where m.client_id = new.client_id and m.period_kind = 'year' and m.status <> 'na') then
    raise exception 'Only an admin can change the fiscal year end once fiscal years are being tracked'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists client_profile_guard_fiscal_year_end on public.client_profile;
create trigger client_profile_guard_fiscal_year_end
  before update of fiscal_year_end on public.client_profile
  for each row execute function public.client_profile_guard_fiscal_year_end();

-- 14. Schema probe --------------------------------------------------------
create or replace function public.tk_schema_version()
returns integer
language sql immutable
set search_path = public
as $$ select 3; $$;

-- 15. Grants --------------------------------------------------------------
revoke all on function public.tk_period_start(text, text, date) from public, anon, authenticated;
revoke all on function public.month_close_signoff_guard() from public, anon, authenticated;
revoke all on function public.tk_sign_off_period(text, text, date, text, boolean, timestamptz) from public, anon, authenticated;
revoke all on function public.tk_reopen_period(text, text, date, text) from public, anon, authenticated;
revoke all on function public.tk_period_summary(text, text, date) from public, anon, authenticated;
revoke all on function public.client_profile_guard_fiscal_year_end() from public, anon, authenticated;
revoke all on function public.notify_enqueue_reports_ready() from public, anon, authenticated;
revoke all on function public.tk_schema_version() from public, anon, authenticated;

grant execute on function public.tk_period_start(text, text, date) to authenticated;
grant execute on function public.tk_sign_off_period(text, text, date, text, boolean, timestamptz) to authenticated;
grant execute on function public.tk_reopen_period(text, text, date, text) to authenticated;
grant execute on function public.tk_period_summary(text, text, date) to authenticated;
grant execute on function public.tk_schema_version() to authenticated;
