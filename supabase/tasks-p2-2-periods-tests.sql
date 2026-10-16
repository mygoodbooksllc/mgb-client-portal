-- Tasks Phase 2, S2 (periods + sign-off): behaviour tests.
-- NOT a migration. Run after tasks-p2-2-periods.sql. Everything runs in one
-- transaction that ends in ROLLBACK, so no fixture survives and no outbox
-- row is ever visible to the email sender. Each check raises 'FAIL n: ...';
-- a clean run ends with the notice 'tasks-p2-2 tests: all passed'.
--
-- Identity switching as in gl-review-rls-tests.sql: `set local role
-- authenticated` plus request.jwt.claims, `reset role` for fixtures.
--
-- Fixtures (synthetic; staff must be @mygoodbooks.org; clients test_only):
--   p2test-a, p2test-b               clients; p2test-a is QuickBooks-connected
--   p2test-bk@mygoodbooks.org           bookkeeper with access to p2test-a only
--   p2test-admin@mygoodbooks.org        admin
--   p2test-client@example.test       portal user of p2test-a

begin;

insert into public.clients (id, name, org_type, test_only) values
  ('p2test-a', 'P2 Test A', 'nonprofit', true),
  ('p2test-b', 'P2 Test B', 'nonprofit', true);
insert into public.staff (email, name, role, active) values
  ('p2test-bk@mygoodbooks.org', 'P2 Bookkeeper', 'bookkeeper', true),
  ('p2test-admin@mygoodbooks.org', 'P2 Admin', 'admin', true);
insert into public.staff_client_access (staff_email, client_id) values ('p2test-bk@mygoodbooks.org', 'p2test-a');
insert into public.client_users (email, client_id, name, role, active) values
  ('p2test-client@example.test', 'p2test-a', 'P2 Client', 'admin', true);
insert into public.qbo_connections (client_id, status) values ('p2test-a', 'connected')
  on conflict (client_id) do update set status = 'connected';
insert into public.client_profile (client_id, fiscal_year_end) values ('p2test-a', '06-30')
  on conflict (client_id) do update set fiscal_year_end = excluded.fiscal_year_end;
-- Block mode from long ago, so the GL gate applies to every month here.
update public.gl_review_settings set done_gate = 'block', effective_from = date '2000-01-01' where id;
-- One open shared task linked to Aug 2026 (month) for p2test-a.
insert into public.staff_reminders (staff_email, text, visibility, client_id, status, period_kind, period_start)
values ('p2test-bk@mygoodbooks.org', 'P2 open task', 'shared', 'p2test-a', 'todo', 'month', date '2026-08-01');

-- 1. Bookkeeper: Ready for sign-off works, Done does not ---------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"email":"p2test-bk@mygoodbooks.org","role":"authenticated","app_metadata":{"provider":"google"}}', true);
do $$
declare r public.month_close;
begin
  insert into public.month_close (client_id, period, status) values ('p2test-a', date '2026-08-01', 'review');
  select * into r from public.month_close where client_id = 'p2test-a' and period_kind = 'month' and period = date '2026-08-01';
  if r.ready_at is null then raise exception 'FAIL 1a: ready_at not stamped on review'; end if;
  if r.period_kind <> 'month' then raise exception 'FAIL 1b: period_kind default'; end if;

  begin
    update public.month_close set status = 'done' where client_id = 'p2test-a' and period = date '2026-08-01';
    raise exception 'FAIL 1c: bookkeeper marked a month done';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.month_close (client_id, period, status) values ('p2test-a', date '2026-07-01', 'done');
    raise exception 'FAIL 1d: bookkeeper inserted a done month';
  exception when insufficient_privilege then null; end;
  begin
    perform public.tk_sign_off_period('p2test-a', 'month', date '2026-08-01');
    raise exception 'FAIL 1e: bookkeeper called tk_sign_off_period';
  exception when insufficient_privilege then null; end;

  -- Sign-off columns are not writable directly.
  update public.month_close set signed_off_by = 'p2test-bk@mygoodbooks.org', signed_off_at = now(),
                                reviewer_email = 'p2test-bk@mygoodbooks.org', notes = 'ready'
   where client_id = 'p2test-a' and period = date '2026-08-01';
  select * into r from public.month_close where client_id = 'p2test-a' and period_kind = 'month' and period = date '2026-08-01';
  if r.signed_off_by is not null or r.signed_off_at is not null or r.reviewer_email is not null then
    raise exception 'FAIL 1f: protected columns written by a bookkeeper';
  end if;
  if r.notes is distinct from 'ready' then raise exception 'FAIL 1g: notes edit lost'; end if;

  -- Back to work clears ready_at; the next review stamps it again.
  update public.month_close set status = 'in_progress' where client_id = 'p2test-a' and period = date '2026-08-01';
  if (select ready_at from public.month_close where client_id = 'p2test-a' and period = date '2026-08-01') is not null then
    raise exception 'FAIL 1h: ready_at kept after going back to in progress';
  end if;
  update public.month_close set status = 'review' where client_id = 'p2test-a' and period = date '2026-08-01';

  -- Summary: one open task.
  if (public.tk_period_summary('p2test-a', 'month', date '2026-08-01') ->> 'open')::int <> 1 then
    raise exception 'FAIL 1i: summary open count';
  end if;
  begin
    perform public.tk_period_summary('p2test-b', 'month', date '2026-08-01');
    raise exception 'FAIL 1j: summary for a client without access';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- 2. Admin sign-off: GL gate, open-task warning, concurrency, done ----------
set local role authenticated;
select set_config('request.jwt.claims', '{"email":"p2test-admin@mygoodbooks.org","role":"authenticated","app_metadata":{"provider":"google"}}', true);
do $$
declare
  j jsonb;
  r public.month_close;
  v_before timestamptz;
begin
  select updated_at into v_before from public.month_close where client_id = 'p2test-a' and period = date '2026-08-01';

  -- Open task: warning, nothing written.
  j := public.tk_sign_off_period('p2test-a', 'month', date '2026-08-01');
  if (j ->> 'needs_ack')::boolean is not true or (j ->> 'open_tasks')::int <> 1
     or jsonb_array_length(j -> 'sample') <> 1 or j -> 'sample' -> 0 ->> 'title' <> 'P2 open task' then
    raise exception 'FAIL 2a: no needs_ack for an open task: %', j;
  end if;
  if (select status from public.month_close where client_id = 'p2test-a' and period = date '2026-08-01') <> 'review' then
    raise exception 'FAIL 2b: needs_ack wrote the row';
  end if;

  -- Stale updated_at: 40001.
  begin
    perform public.tk_sign_off_period('p2test-a', 'month', date '2026-08-01', null, true, v_before - interval '1 minute');
    raise exception 'FAIL 2c: stale expected updated_at accepted';
  exception when serialization_failure then null; end;

  -- Ledger review not approved, block mode: the GL gate still blocks.
  begin
    perform public.tk_sign_off_period('p2test-a', 'month', date '2026-08-01', null, true, v_before);
    raise exception 'FAIL 2d: GL gate did not block the sign-off';
  exception when insufficient_privilege then null; end;

  -- Approve the ledger review (as the app's CT_ledgerGate path would), then sign off.
  perform public.gl_review_override_done('p2test-a', date '2026-08-01', 'P2 test override reason');
  j := public.tk_sign_off_period('p2test-a', 'month', date '2026-08-01', 'All reconciled', true, v_before);
  if (j ->> 'ok')::boolean is not true or (j ->> 'open_tasks')::int <> 1 then
    raise exception 'FAIL 2e: sign-off failed: %', j;
  end if;
  select * into r from public.month_close where client_id = 'p2test-a' and period_kind = 'month' and period = date '2026-08-01';
  if r.status <> 'done' or r.signed_off_by <> 'p2test-admin@mygoodbooks.org' or r.signed_off_at is null
     or r.done_at is null or r.ready_at is null or r.notes not like '%Sign-off: All reconciled' then
    raise exception 'FAIL 2f: signed-off row wrong: %', to_jsonb(r);
  end if;
  if not exists (select 1 from public.tk_activity a join public.staff_reminders s on s.id = a.task_id
                  where s.text = 'P2 open task' and a.kind = 'period_signed_off') then
    raise exception 'FAIL 2g: period_signed_off not logged on the open task';
  end if;

  -- Second call: already done.
  j := public.tk_sign_off_period('p2test-a', 'month', date '2026-08-01');
  if (j ->> 'already')::boolean is not true then raise exception 'FAIL 2h: second sign-off not idempotent: %', j; end if;

  -- Not aligned / unknown kind.
  begin
    perform public.tk_sign_off_period('p2test-a', 'quarter', date '2026-08-01', null, true);
    raise exception 'FAIL 2i: unaligned quarter accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.tk_sign_off_period('p2test-a', 'week', date '2026-08-03', null, true);
    raise exception 'FAIL 2j: week kind accepted';
  exception when invalid_parameter_value then null; end;
end $$;
reset role;

-- Reports-ready email queued once for the month (outbox is not staff-readable).
do $$ declare n_out int; begin
  select count(*) into n_out from public.notification_outbox
   where kind = 'client_reports_ready' and ref_id = 'p2test-a:2026-08-01';
  if n_out <> 1 then raise exception 'FAIL 2k: expected 1 reports-ready row, got %', n_out; end if;
end $$;

-- 3. Bookkeeper cannot take a signed-off month out of Done ------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"email":"p2test-bk@mygoodbooks.org","role":"authenticated","app_metadata":{"provider":"google"}}', true);
do $$ begin
  begin
    update public.month_close set status = 'in_progress' where client_id = 'p2test-a' and period = date '2026-08-01';
    raise exception 'FAIL 3a: bookkeeper reopened a signed-off month';
  exception when insufficient_privilege then null; end;
  begin
    perform public.tk_reopen_period('p2test-a', 'month', date '2026-08-01', 'Found a missing bill');
    raise exception 'FAIL 3b: bookkeeper called tk_reopen_period';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- 4. Admin reopen, re-sign: GL approval reopened, no second email ------------
set local role authenticated;
select set_config('request.jwt.claims', '{"email":"p2test-admin@mygoodbooks.org","role":"authenticated","app_metadata":{"provider":"google"}}', true);
do $$
declare r public.month_close; j jsonb;
begin
  begin
    perform public.tk_reopen_period('p2test-a', 'month', date '2026-08-01', 'no');
    raise exception 'FAIL 4a: short reason accepted';
  exception when invalid_parameter_value then null; end;
  perform public.tk_reopen_period('p2test-a', 'month', date '2026-08-01', 'Found a missing bill');
  select * into r from public.month_close where client_id = 'p2test-a' and period_kind = 'month' and period = date '2026-08-01';
  if r.status <> 'in_progress' or r.signed_off_at is not null or r.reopened_by <> 'p2test-admin@mygoodbooks.org'
     or r.reopened_reason <> 'Found a missing bill' or r.done_at is not null then
    raise exception 'FAIL 4b: reopen row wrong: %', to_jsonb(r);
  end if;
  if (select override_at from public.gl_review_signoffs where client_id = 'p2test-a' and period = date '2026-08-01') is not null then
    raise exception 'FAIL 4c: GL override not cleared on reopen';
  end if;
  begin
    perform public.tk_reopen_period('p2test-a', 'month', date '2026-08-01', 'Again please');
    raise exception 'FAIL 4d: reopened a period that is not signed off';
  exception when invalid_parameter_value then null; end;

  perform public.gl_review_override_done('p2test-a', date '2026-08-01', 'P2 test override again');
  j := public.tk_sign_off_period('p2test-a', 'month', date '2026-08-01', null, true);
  if (j ->> 'ok')::boolean is not true then raise exception 'FAIL 4e: re-sign failed: %', j; end if;
end $$;
reset role;
do $$ declare n_out int; begin
  select count(*) into n_out from public.notification_outbox
   where kind = 'client_reports_ready' and ref_id = 'p2test-a:2026-08-01';
  if n_out <> 1 then raise exception 'FAIL 4f: reports-ready re-sent within 7 days (% rows)', n_out; end if;
end $$;

-- 5. Quarters and fiscal years ------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"email":"p2test-admin@mygoodbooks.org","role":"authenticated","app_metadata":{"provider":"google"}}', true);
do $$
declare j jsonb;
begin
  if public.tk_period_start('p2test-a', 'quarter', date '2026-08-15') <> date '2026-07-01' then
    raise exception 'FAIL 5a: calendar quarter start';
  end if;
  if public.tk_period_start('p2test-a', 'year', date '2026-08-15') <> date '2026-07-01'
     or public.tk_period_start('p2test-a', 'year', date '2026-03-15') <> date '2025-07-01' then
    raise exception 'FAIL 5b: fiscal year start (06-30 year end)';
  end if;
  if public.tk_period_start('p2test-b', 'year', date '2026-03-15') <> date '2026-01-01' then
    raise exception 'FAIL 5c: default fiscal year start';
  end if;

  -- A quarter signs off without the GL gate and sends no client email (Q3).
  j := public.tk_sign_off_period('p2test-a', 'quarter', date '2026-07-01');
  if (j ->> 'ok')::boolean is not true then raise exception 'FAIL 5d: quarter sign-off: %', j; end if;
  -- The month row for July is untouched (separate key).
  if exists (select 1 from public.month_close where client_id = 'p2test-a' and period_kind = 'month' and period = date '2026-07-01') then
    raise exception 'FAIL 5f: quarter sign-off wrote a month row';
  end if;

  begin
    perform public.tk_sign_off_period('p2test-a', 'year', date '2026-01-01');
    raise exception 'FAIL 5g: calendar-year start accepted for a 06-30 client';
  exception when invalid_parameter_value then null; end;
  j := public.tk_sign_off_period('p2test-a', 'year', date '2025-07-01');
  if (j ->> 'ok')::boolean is not true then raise exception 'FAIL 5h: fiscal year sign-off: %', j; end if;
end $$;
reset role;
do $$ begin
  -- Client emails only: staff_* notices (S3 'ready for sign-off' to admins) are not client email.
  if exists (select 1 from public.notification_outbox where client_id = 'p2test-a' and kind not like 'staff\_%' and ref_id <> 'p2test-a:2026-08-01') then
    raise exception 'FAIL 5e: a quarter or year sign-off queued a client email';
  end if;
end $$;

-- 6. Fiscal year end locked for a bookkeeper once year rows exist (M6) ------
set local role authenticated;
select set_config('request.jwt.claims', '{"email":"p2test-bk@mygoodbooks.org","role":"authenticated","app_metadata":{"provider":"google"}}', true);
do $$ begin
  begin
    update public.client_profile set fiscal_year_end = '12-31' where client_id = 'p2test-a';
    raise exception 'FAIL 6a: bookkeeper changed fiscal_year_end with year rows present';
  exception when insufficient_privilege then null; end;
  -- A direct misaligned year row is refused for anyone.
  begin
    insert into public.month_close (client_id, period_kind, period, status) values ('p2test-a', 'year', date '2026-01-01', 'not_started');
    raise exception 'FAIL 6b: misaligned year row accepted';
  exception when invalid_parameter_value then null; end;
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"email":"p2test-admin@mygoodbooks.org","role":"authenticated","app_metadata":{"provider":"google"}}', true);
update public.client_profile set fiscal_year_end = '06-30' where client_id = 'p2test-a';
reset role;

-- 7. Kind never changes; quarter alignment CHECK; month readers -------------
do $$
begin
  begin
    update public.month_close set period_kind = 'month' where client_id = 'p2test-a' and period_kind = 'quarter';
    raise exception 'FAIL 7a: period_kind changed';
  exception when invalid_parameter_value then null; end;
  begin
    insert into public.month_close (client_id, period_kind, period, status) values ('p2test-b', 'quarter', date '2026-02-01', 'not_started');
    raise exception 'FAIL 7b: unaligned quarter row accepted';
  exception when check_violation then null; end;
end $$;

-- 8. Ledger review "first tick" upserts with the new conflict target -------
set local role authenticated;
select set_config('request.jwt.claims', '{"email":"p2test-bk@mygoodbooks.org","role":"authenticated","app_metadata":{"provider":"google"}}', true);
do $$ begin
  perform public.gl_review_mark_reviewed('p2test-a', date '2026-05-01');
  if (select status from public.month_close where client_id = 'p2test-a' and period_kind = 'month'
        and period = date '2026-05-01') is distinct from 'in_progress' then
    raise exception 'FAIL 8: gl_review_mark_reviewed did not start the month row';
  end if;
end $$;
reset role;

do $$ begin raise notice 'tasks-p2-2 tests: all passed'; end $$;

rollback;
