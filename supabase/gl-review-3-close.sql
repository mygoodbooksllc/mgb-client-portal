-- Ledger review (GL Review), part 3: Close tab integration.
-- Spec: docs/gl-review-spec.md section 6 (6.1, 6.4) and 4.5 (baseline fallback).
-- NOT APPLIED. Written 2026-10-14 for Phase 1. Put the applied date here when
-- it goes to production (migration name gl_review_3_close).
-- Needs gl-review-1-core.sql (and, by order, gl-review-2-questions.sql) first.
--
-- What this file adds
--   1. client_close_items guard: the "ledger_reviewed" step can only be
--      written by gl_review_mark_reviewed / gl_review_send_back (they set the
--      transaction-local flag app.gl_review_signoff). A signed-in caller who
--      inserts, updates or deletes that row directly gets an error, even
--      though the "staff manage close items" FOR ALL policy would allow it.
--      Trusted backend code (service role / SQL editor, no JWT) is not blocked.
--   2. month_close.done_at: stamped when a month becomes Done, cleared when it
--      is reopened. gl_review_baseline_from_last_print uses it. The backfill
--      for months already Done runs with month_close_before_write disabled,
--      so their updated_at / updated_by (the on-time-close metric) are kept.
--   3. month_close gate (spec 6.4): BEFORE INSERT OR UPDATE. When the status
--      is or becomes 'done' (an insert straight to done included) and
--        gl_review_settings.done_gate = 'block'
--        and the month is on or after gl_review_settings.effective_from
--        and the client's QuickBooks connection is 'connected'
--        and the month has no 'approved' sign-off and no override made in
--            block mode (override_gate = 'block'; a warn-era override
--            doesn't count, spec 4.4),
--      it raises. With done_gate = 'warn' (the shipped default, owner decision
--      13.1) it never raises; the warning lives in the UI (CT_saveMonthClose).
--      Applies to EVERY caller, so the Work > Close grid can't bypass it.
--      NOTE: that includes service_role (edge functions, cron) and the SQL
--      editor / postgres: there is no backend bypass. In block mode, backend
--      code that marks a month Done must first get it approved or overridden
--      (gl_review_override_done as an admin), or the write raises 42501.
--   4. Reopening a month (done -> anything else, or deleting a done row)
--      clears the approval and the override (override_* incl. override_gate)
--      on gl_review_signoffs: an
--      'approved' month goes back to 'reviewed' and needs approving again.
--      The "Ledger reviewed" tick stays (the review itself still stands).
--   5. gl_review_baseline_from_last_print (service role): spec 4.5 fallback
--      (a) for a month closed without a fresh pull: copies the last 'pull'
--      print taken before the month was marked Done into a hash-only
--      'baseline' row (pull prints don't keep lines, so neither does this).
--
-- Safe to re-run.
--
-- Rollback (inside one transaction):
--   drop trigger if exists client_close_items_guard_ledger_reviewed on public.client_close_items;
--   drop trigger if exists month_close_gl_review_gate on public.month_close;
--   drop trigger if exists month_close_gl_review_reopen on public.month_close;
--   drop function if exists public.client_close_items_guard_ledger_reviewed(),
--     public.month_close_gl_review_gate(), public.month_close_gl_review_reopen(),
--     public.gl_review_baseline_from_last_print(text, date);
--   alter table public.month_close drop column if exists done_at;
--
-- Depends on (repo definitions re-read 2026-10-14): month-close.sql
-- (month_close, month_close_before_write), staff-client-tools.sql
-- (client_close_items: period 'YYYY-MM', FOR ALL staff policy, no FK, no
-- triggers), qbo-connections.sql (qbo_connections.status),
-- notification-emails.sql (notify_enqueue_reports_ready after insert/update
-- of status on month_close; not changed here).

begin;

-- ===========================================================================
-- 1. client_close_items: ledger_reviewed only through the sign-off RPCs
-- ===========================================================================
create or replace function public.client_close_items_guard_ledger_reviewed()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_signed_in boolean := nullif(btrim(auth.jwt() ->> 'email'), '') is not null
                         or coalesce(auth.jwt() ->> 'role', '') in ('authenticated', 'anon');
  v_touches boolean;
begin
  v_touches := (tg_op <> 'INSERT' and old.item_key = 'ledger_reviewed')
            or (tg_op <> 'DELETE' and new.item_key = 'ledger_reviewed');
  if v_touches and v_signed_in
     and coalesce(current_setting('app.gl_review_signoff', true), '') <> 'on' then
    raise exception 'The "Ledger reviewed" step is set from the Ledger review tab (Mark reviewed / Send back).'
      using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
revoke all on function public.client_close_items_guard_ledger_reviewed() from public, anon, authenticated;

drop trigger if exists client_close_items_guard_ledger_reviewed on public.client_close_items;
create trigger client_close_items_guard_ledger_reviewed
  before insert or update or delete on public.client_close_items
  for each row execute function public.client_close_items_guard_ledger_reviewed();

-- ===========================================================================
-- 2. month_close.done_at
-- ===========================================================================
alter table public.month_close add column if not exists done_at timestamptz;
-- Existing Done months: best available time is the last write.
-- month_close_before_write stamps updated_at = now() (and updated_by) on every
-- UPDATE, which would make every backfilled month look closed today and break
-- the on-time-close metric that reads updated_at
-- (staff-celebrations-performance.sql, tasks-module-v1.sql). Turn it off for
-- this one statement only (ALTER TABLE is transactional: a failure rolls the
-- disable back too). The gate trigger below (on a re-run) keeps the supplied
-- done_at for a row that is already done, and no status changes, so the
-- update-of-status triggers don't fire.
alter table public.month_close disable trigger month_close_before_write;
update public.month_close set done_at = updated_at where status = 'done' and done_at is null;
alter table public.month_close enable trigger month_close_before_write;

-- ===========================================================================
-- 3. month_close gate (+ done_at stamp)
-- ===========================================================================
-- Named so it fires after month_close_before_write (BEFORE triggers run in
-- name order); it reads only status / period / client_id.
create or replace function public.month_close_gl_review_gate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_becomes_done boolean := new.status = 'done' and (tg_op = 'INSERT' or old.status is distinct from 'done');
  s public.gl_review_settings;
begin
  -- done_at: set on the way into done, kept while done, cleared otherwise.
  if v_becomes_done then
    new.done_at := now();
  elsif new.status = 'done' then
    new.done_at := coalesce(old.done_at, new.done_at, now());
  else
    new.done_at := null;
  end if;

  if not v_becomes_done or new.period_kind <> 'month' then   -- period_kind: added by tasks-p2-2-periods.sql
    return new;
  end if;

  select * into s from public.gl_review_settings where id;
  if s.id is null or s.done_gate <> 'block' or new.period < s.effective_from then
    return new;
  end if;
  if not exists (select 1 from qbo_connections c where c.client_id = new.client_id and c.status = 'connected') then
    return new;   -- spec 6.3: no QuickBooks connection, no ledger review step
  end if;
  -- Approved, or overridden IN BLOCK MODE (admin + reason). A warn-era
  -- override (override_gate 'warn') does not count (spec 4.4).
  if exists (select 1 from public.gl_review_signoffs g
             where g.client_id = new.client_id and g.period = new.period
               and (g.status = 'approved'
                    or (g.override_at is not null and g.override_gate = 'block'))) then
    return new;
  end if;
  raise exception 'Ledger review isn''t approved for this month. An admin can approve it or override.'
    using errcode = '42501';
end;
$$;
revoke all on function public.month_close_gl_review_gate() from public, anon, authenticated;

drop trigger if exists month_close_gl_review_gate on public.month_close;
create trigger month_close_gl_review_gate
  before insert or update on public.month_close
  for each row execute function public.month_close_gl_review_gate();

-- ===========================================================================
-- 4. Reopening a month clears approval and override
-- ===========================================================================
create or replace function public.month_close_gl_review_reopen()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor text := lower(nullif(btrim(auth.jwt() ->> 'email'), ''));
  n int;
begin
  if old.status <> 'done' or old.period_kind <> 'month' or (tg_op = 'UPDATE' and new.status = 'done') then
    return null;
  end if;
  update public.gl_review_signoffs
     set status = case when status = 'approved' then 'reviewed' else status end,
         approved_by = null, approved_at = null,
         override_by = null, override_note = null, override_at = null, override_gate = null
   where client_id = old.client_id and period = old.period
     and (approved_at is not null or override_at is not null or status = 'approved');
  get diagnostics n = row_count;
  if n > 0 then
    perform public.gl_review_log(old.client_id, coalesce(v_actor, 'system'), 'ledger_review_reopened',
      jsonb_build_object('period', to_char(old.period, 'YYYY-MM'),
                         'new_status', case when tg_op = 'UPDATE' then new.status end));
  end if;
  return null;
end;
$$;
revoke all on function public.month_close_gl_review_reopen() from public, anon, authenticated;

drop trigger if exists month_close_gl_review_reopen on public.month_close;
create trigger month_close_gl_review_reopen
  after update of status or delete on public.month_close
  for each row execute function public.month_close_gl_review_reopen();

-- ===========================================================================
-- 5. Baseline fallback (spec 4.5 (a)), service role only
-- ===========================================================================
-- Returns the baseline id: the existing one if the month already has a
-- baseline, else a hash-only copy of the last 'pull' print captured at or
-- before the month's done_at. Null when there is no such print (the screen
-- then says "no snapshot from when this month was closed").
create or replace function public.gl_review_baseline_from_last_print(p_client_id text, p_period date)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period date := public.gl_review_month(p_period);
  v_done_at timestamptz;
  v_id uuid;
  p public.gl_review_month_prints;
begin
  select done_at into v_done_at from month_close
   where client_id = p_client_id and period_kind = 'month' and period = v_period and status = 'done';
  if v_done_at is null then
    raise exception 'A baseline is only stored for a month marked Done.' using errcode = '22023';
  end if;
  select id into v_id from public.gl_review_month_prints
   where client_id = p_client_id and period = v_period and kind = 'baseline'
   order by captured_at desc limit 1;
  if v_id is not null then
    return v_id;
  end if;
  select * into p from public.gl_review_month_prints
   where client_id = p_client_id and period = v_period and kind = 'pull' and captured_at <= v_done_at
   order by captured_at desc limit 1;
  if p.id is null then
    return null;
  end if;
  insert into public.gl_review_month_prints (client_id, period, kind, basis, line_count, debit_total, hash,
                                             captured_at, captured_by, lines)
  values (p_client_id, v_period, 'baseline', p.basis, p.line_count, p.debit_total, p.hash,
          p.captured_at, 'fallback:last_pull', null)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.gl_review_baseline_from_last_print(text, date) from public, anon, authenticated;
grant execute on function public.gl_review_baseline_from_last_print(text, date) to service_role;

commit;
