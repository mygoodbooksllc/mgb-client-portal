-- Ledger review (GL Review): RLS and RPC security tests (spec section 10).
-- NOT a migration. Run in the Supabase SQL editor (or psql as postgres) on a
-- branch or staging project AFTER gl-review-1..4 are applied. Everything runs
-- inside one transaction that ends in ROLLBACK, so no fixture survives.
-- Each check raises 'FAIL n: ...' on failure; a clean run ends with the
-- notice 'gl-review RLS tests: all passed' and then rolls back.
--
-- Identity switching: `set local role authenticated|anon` plus
-- request.jwt.claims (what auth.jwt() reads), and `reset role` back to
-- postgres for fixtures. Expected denials catch insufficient_privilege
-- (42501: no grant, RLS WITH CHECK, or the RPC's own check).
--
-- Fixtures (all *.example.test, clients marked test_only):
--   gltest-a, gltest-b                clients; gltest-a is QuickBooks-connected
--   gltest-bk-a@example.test          bookkeeper with access to gltest-a only
--   gltest-bk-b@example.test          bookkeeper with access to gltest-b only
--   gltest-admin@example.test         admin (sees every client)
--   gltest-client-a1/-a2@example.test portal users of gltest-a
--   gltest-client-a3@example.test     category-scoped portal user of gltest-a
--   pull 6c1e0000-...-0000000000a1    gltest-a's latest pull, run by bookkeeper A
--
-- Review fixes covered (2026-10-14): 29 upsert de-dupes trimmed keys;
-- 30 upsert/mark_fixed take a server pull id (no browser time; flags the pull
-- saw and recon_uncleared are never auto-fixed; other people's / old pulls
-- refused); 31 scoped portal users can't be addressed + gl_review_portal_addressees;
-- 32 one unresolved question per transaction (open + answered) and resolved
-- staff questions hidden from clients; 33 a warn-era override doesn't satisfy
-- block mode; 34 the block gate applies to service_role; 35 the done_at
-- backfill keeps month_close.updated_at.

begin;

-- ===========================================================================
-- Fixtures (as postgres)
-- ===========================================================================
insert into public.clients (id, name, org_type, test_only) values
  ('gltest-a', 'GL Test A', 'nonprofit', true),
  ('gltest-b', 'GL Test B', 'nonprofit', true);
insert into public.staff (email, name, role, active) values
  ('gltest-bk-a@example.test', 'GL Bookkeeper A', 'bookkeeper', true),
  ('gltest-bk-b@example.test', 'GL Bookkeeper B', 'bookkeeper', true),
  ('gltest-admin@example.test', 'GL Admin', 'admin', true);
insert into public.staff_client_access (staff_email, client_id) values
  ('gltest-bk-a@example.test', 'gltest-a'),
  ('gltest-bk-b@example.test', 'gltest-b');
insert into public.client_users (email, client_id, name, role, active) values
  ('gltest-client-a1@example.test', 'gltest-a', 'Client A1', 'admin', true),
  ('gltest-client-a2@example.test', 'gltest-a', 'Client A2', 'admin', true);
insert into public.qbo_connections (client_id, status) values ('gltest-a', 'connected')
  on conflict (client_id) do update set status = 'connected';
insert into public.client_profile (client_id, contact_email) values ('gltest-a', 'gltest-contact-a@example.test')
  on conflict (client_id) do update set contact_email = excluded.contact_email;
-- A category-limited portal user (client-scope-rls.sql): never addressable.
insert into public.client_users (email, client_id, name, role, active, access, categories) values
  ('gltest-client-a3@example.test', 'gltest-a', 'Client A3', 'member', true, 'scoped', array['Office Supplies']);
-- gltest-a's latest pull: complete rolling14, run by bookkeeper A a minute ago.
insert into public.gl_review_pulls (client_id, pull_id, status, window_kind, window_start, window_end,
                                    started_at, finished_at, calls, line_count, pulled_by)
values ('gltest-a', '6c1e0000-0000-4000-8000-0000000000a1', 'ok', 'rolling14',
        (date_trunc('month', current_date) - interval '13 months')::date,
        (date_trunc('month', current_date) + interval '1 month - 1 day')::date,
        now() - interval '1 minute', now(), 3, 100, 'gltest-bk-a@example.test')
on conflict (client_id) do update set pull_id = excluded.pull_id, status = excluded.status,
  window_kind = excluded.window_kind, window_start = excluded.window_start, window_end = excluded.window_end,
  started_at = excluded.started_at, finished_at = excluded.finished_at, pulled_by = excluded.pulled_by;

-- One flag per client, inserted directly (as postgres).
insert into public.gl_review_flags (client_id, period, txn_key, flag_type, severity, why, txn_date, amount, name,
                                    first_period, last_seen_at, last_pull_at, checks_version)
values
  ('gltest-a', date_trunc('month', current_date)::date, 'Purchase:9001', 'suspense', 'high', 'Test flag A',
   current_date, 120.00, 'Test Vendor A', date_trunc('month', current_date)::date, now(), now() - interval '1 hour', 1),
  ('gltest-b', date_trunc('month', current_date)::date, 'Purchase:9002', 'suspense', 'high', 'Test flag B',
   current_date, 80.00, 'Test Vendor B', date_trunc('month', current_date)::date, now(), now() - interval '1 hour', 1),
  -- Seen by an earlier pull only: the latest pull's mark_fixed retires it (30c).
  ('gltest-a', date_trunc('month', current_date)::date, 'Purchase:9010', 'large', 'medium', 'Old large',
   current_date, 5000.00, 'Old Vendor', date_trunc('month', current_date)::date, now(), now() - interval '1 hour', 1),
  -- Month-dependent (review month in the browser): never auto-fixed (30c).
  ('gltest-a', date_trunc('month', current_date)::date, 'acct:77:' || to_char(current_date, 'YYYY-MM'),
   'recon_uncleared', 'medium', 'Stale uncleared items', current_date, 300.00, null,
   date_trunc('month', current_date)::date, now(), now() - interval '1 hour', 1);

-- A client-asked question on client B (the stamp trigger takes created_by
-- from the JWT, so set one; still postgres, so RLS doesn't apply).
insert into public.client_users (email, client_id, name, role, active) values
  ('gltest-client-b1@example.test', 'gltest-b', 'Client B1', 'admin', true);
select set_config('request.jwt.claims', '{"email":"gltest-client-b1@example.test","role":"authenticated"}', true);
insert into public.transaction_questions (client_id, txn_key, note)
  values ('gltest-b', 'Purchase:9102', 'What is this?');
select set_config('request.jwt.claims', '', true);

-- ===========================================================================
-- Bookkeeper A
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"email":"gltest-bk-a@example.test","role":"authenticated"}', true);

do $$
declare n int; v jsonb;
begin
  -- 1. Reads own client's flags, not client B's.
  select count(*) into n from public.gl_review_flags where client_id = 'gltest-a';
  if n <> 3 then raise exception 'FAIL 1a: bookkeeper A sees % flags for A', n; end if;
  select count(*) into n from public.gl_review_flags where client_id = 'gltest-b';
  if n <> 0 then raise exception 'FAIL 1b: bookkeeper A sees % flags for B', n; end if;

  -- 2. No direct DML on gl_review_* tables.
  begin
    update public.gl_review_flags set status = 'cleared' where client_id = 'gltest-a';
    raise exception 'FAIL 2a: direct update of gl_review_flags allowed';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.gl_review_flags (client_id, period, txn_key, flag_type, severity, why, first_period, checks_version)
    values ('gltest-a', date_trunc('month', current_date)::date, 'x:1', 'large', 'low', 'x',
            date_trunc('month', current_date)::date, 1);
    raise exception 'FAIL 2b: direct insert into gl_review_flags allowed';
  exception when insufficient_privilege then null; end;
  begin
    delete from public.gl_review_signoffs;
    raise exception 'FAIL 2c: direct delete on gl_review_signoffs allowed';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.gl_review_rules (client_id, kind, flag_type, match_name)
    values ('gltest-a', 'stop_flagging', 'large', 'x');
    raise exception 'FAIL 2d: direct insert into gl_review_rules allowed';
  exception when insufficient_privilege then null; end;
  begin
    update public.gl_review_settings set done_gate = 'block';
    raise exception 'FAIL 2e: direct update of gl_review_settings allowed';
  exception when insufficient_privilege then null; end;

  -- 3. RPCs refuse client B.
  begin
    perform public.gl_review_upsert_flags('gltest-b', gen_random_uuid(), 1,
      '[{"txn_key":"Purchase:1","flag_type":"large","severity":"low","why":"x","txn_date":"2026-10-01"}]'::jsonb);
    raise exception 'FAIL 3a: upsert_flags allowed for client B';
  exception when insufficient_privilege then null; end;
  begin
    perform public.gl_review_mark_reviewed('gltest-b', current_date);
    raise exception 'FAIL 3b: mark_reviewed allowed for client B';
  exception when insufficient_privilege then null; end;
  begin
    perform public.gl_review_save_summary('gltest-b', current_date, 'clean', 'x', '{}'::jsonb);
    raise exception 'FAIL 3c: save_summary allowed for client B';
  exception when insufficient_privilege then null; end;
  begin
    perform public.gl_review_save_rule('gltest-b', 'stop_flagging', 'large', 'Vendor');
    raise exception 'FAIL 3d: save_rule allowed for client B';
  exception when insufficient_privilege then null; end;
  begin
    perform public.gl_review_override_done('gltest-b', current_date, 'x');
    raise exception 'FAIL 3e: override_done allowed for client B';
  exception when insufficient_privilege then null; end;

  -- 4. Upsert for A works; it never reopens a cleared flag.
  v := public.gl_review_upsert_flags('gltest-a', '6c1e0000-0000-4000-8000-0000000000a1', 1, jsonb_build_array(
    jsonb_build_object('txn_key', 'Purchase:9001', 'flag_type', 'suspense', 'severity', 'high',
                       'why', 'Test flag A again', 'txn_date', current_date),
    jsonb_build_object('txn_key', 'Purchase:9003', 'flag_type', 'round', 'severity', 'low',
                       'why', 'Round number', 'txn_date', current_date)));
  if (v ->> 'inserted')::int <> 1 or (v ->> 'updated')::int <> 1 then
    raise exception 'FAIL 4a: upsert result %', v;
  end if;
  perform public.gl_review_clear((select id from public.gl_review_flags where txn_key = 'Purchase:9003'),
                                 'expected', 'fine', false);
  perform public.gl_review_upsert_flags('gltest-a', '6c1e0000-0000-4000-8000-0000000000a1', 1, jsonb_build_array(
    jsonb_build_object('txn_key', 'Purchase:9003', 'flag_type', 'round', 'severity', 'low',
                       'why', 'Round number', 'txn_date', current_date)));
  if (select status from public.gl_review_flags where txn_key = 'Purchase:9003') <> 'cleared' then
    raise exception 'FAIL 4b: upsert reopened a cleared flag';
  end if;
  -- The flag records the pull that saw it and the pull's server time.
  if (select last_pull_id from public.gl_review_flags where txn_key = 'Purchase:9001' and flag_type = 'suspense')
     is distinct from '6c1e0000-0000-4000-8000-0000000000a1'::uuid
     or (select last_pull_at from public.gl_review_flags where txn_key = 'Purchase:9001' and flag_type = 'suspense')
     is distinct from (select started_at from public.gl_review_pulls where client_id = 'gltest-a') then
    raise exception 'FAIL 4c: last_pull_id / last_pull_at not taken from the pull';
  end if;

  -- 29. (fix 5) Keys are de-duplicated after trimming: "Purchase:9001" and
  -- "Purchase:9001 " in one batch are one flag, not a unique-key error.
  v := public.gl_review_upsert_flags('gltest-a', '6c1e0000-0000-4000-8000-0000000000a1', 1, jsonb_build_array(
    jsonb_build_object('txn_key', 'Purchase:9001', 'flag_type', 'round', 'severity', 'low',
                       'why', 'Round number', 'txn_date', current_date),
    jsonb_build_object('txn_key', 'Purchase:9001 ', 'flag_type', ' round', 'severity', 'low',
                       'why', 'Round number (trailing space)', 'txn_date', current_date)));
  if (v ->> 'inserted')::int <> 1 then raise exception 'FAIL 29a: whitespace duplicates gave %', v; end if;
  select count(*) into n from public.gl_review_flags
   where client_id = 'gltest-a' and txn_key = 'Purchase:9001' and flag_type = 'round';
  if n <> 1 then raise exception 'FAIL 29b: % rows for the trimmed key', n; end if;

  -- 30. (fix 3) Pull identity comes from gl_review_pulls, not the browser.
  begin
    perform public.gl_review_upsert_flags('gltest-a', gen_random_uuid(), 1,
      '[{"txn_key":"Purchase:9020","flag_type":"large","severity":"low","why":"x","txn_date":"2026-10-01"}]'::jsonb);
    raise exception 'FAIL 30a: upsert accepted a pull id that is not the latest pull';
  exception when sqlstate '22023' then null; end;
  v := public.gl_review_mark_fixed('gltest-a', gen_random_uuid(), 1);
  if v ->> 'status' <> 'stale' then raise exception 'FAIL 30b: mark_fixed with an old pull id %', v; end if;
  -- mark_fixed retires only flags this pull did not see, and never a
  -- month-dependent check.
  v := public.gl_review_mark_fixed('gltest-a', '6c1e0000-0000-4000-8000-0000000000a1', 1);
  if v ->> 'status' <> 'ok' or (v ->> 'fixed')::int <> 1 then
    raise exception 'FAIL 30c: mark_fixed result % (expected 1 fixed: Purchase:9010)', v;
  end if;
  if (select status from public.gl_review_flags where txn_key = 'Purchase:9010') <> 'fixed' then
    raise exception 'FAIL 30d: unseen flag not fixed';
  end if;
  if (select status from public.gl_review_flags where txn_key = 'Purchase:9001' and flag_type = 'round') <> 'open'
     or (select status from public.gl_review_flags where txn_key = 'Purchase:9001' and flag_type = 'suspense') <> 'open' then
    raise exception 'FAIL 30e: mark_fixed fixed a flag the pull just saw';
  end if;
  if (select status from public.gl_review_flags where flag_type = 'recon_uncleared' and client_id = 'gltest-a') <> 'open' then
    raise exception 'FAIL 30f: mark_fixed auto-fixed a month-dependent recon_uncleared flag';
  end if;
  -- The latest pull sees Purchase:9010 again: it reopens.
  v := public.gl_review_upsert_flags('gltest-a', '6c1e0000-0000-4000-8000-0000000000a1', 1, jsonb_build_array(
    jsonb_build_object('txn_key', 'Purchase:9010', 'flag_type', 'large', 'severity', 'medium',
                       'why', 'Old large', 'txn_date', current_date)));
  if (v ->> 'reopened')::int <> 1
     or (select status from public.gl_review_flags where txn_key = 'Purchase:9010') <> 'open' then
    raise exception 'FAIL 30g: a fixed flag the latest pull sees again did not reopen (%)', v;
  end if;

  -- 31. (fix 4) Scoped portal users can't be addressed.
  if exists (select 1 from public.gl_review_portal_addressees('gltest-a') a
              where a.email = 'gltest-client-a3@example.test')
     or (select count(*) from public.gl_review_portal_addressees('gltest-a')) <> 2 then
    raise exception 'FAIL 31a: portal addressees list is wrong';
  end if;
  begin
    perform public.gl_review_ask((select id from public.gl_review_flags where txn_key = 'Purchase:9001' and flag_type = 'round'),
                                 'portal', 'gltest-client-a3@example.test', 'What was this?');
    raise exception 'FAIL 31b: asked a scoped portal user';
  exception when sqlstate '22023' then
    if sqlerrm not ilike '%limited access%' then raise exception 'FAIL 31b: wrong error %', sqlerrm; end if;
  end;
  perform public.gl_review_save_summary('gltest-a', current_date, 'clean', 'All clear this month.', '{}'::jsonb);
  begin
    perform public.gl_review_send_summary_portal(
      (select id from public.gl_review_summaries where client_id = 'gltest-a'),
      array['gltest-client-a1@example.test', 'gltest-client-a3@example.test']);
    raise exception 'FAIL 31c: summary sent to a scoped portal user';
  exception when sqlstate '22023' then
    if sqlerrm not ilike '%limited access%' then raise exception 'FAIL 31c: wrong error %', sqlerrm; end if;
  end;
  v := public.gl_review_send_summary_portal(
    (select id from public.gl_review_summaries where client_id = 'gltest-a'), array['GLTEST-CLIENT-A1@example.test']);
  if (select status from public.gl_review_summaries where client_id = 'gltest-a') <> 'sent' then
    raise exception 'FAIL 31d: summary to a full-access user not sent (%)', v;
  end if;

  -- 33a. (fix 2) A warn-mode override is recorded as such.
  perform public.gl_review_override_done('gltest-a', (date_trunc('month', current_date) + interval '2 months')::date);
  if (select override_gate from public.gl_review_signoffs where client_id = 'gltest-a'
        and period = (date_trunc('month', current_date) + interval '2 months')::date) is distinct from 'warn' then
    raise exception 'FAIL 33a: warn override not recorded with override_gate warn';
  end if;

  -- 5. A non-admin cannot approve, send back, edit the watch list or settings.
  begin
    perform public.gl_review_approve('gltest-a', current_date);
    raise exception 'FAIL 5a: bookkeeper approved';
  exception when insufficient_privilege then null; end;
  begin
    perform public.gl_review_send_back('gltest-a', current_date, 'no');
    raise exception 'FAIL 5b: bookkeeper sent back a month';
  exception when insufficient_privilege then null; end;
  begin
    perform public.gl_review_send_back_flag((select id from public.gl_review_flags where txn_key = 'Purchase:9003'), 'no');
    raise exception 'FAIL 5c: bookkeeper sent back a flag';
  exception when insufficient_privilege then null; end;
  begin
    perform public.gl_review_save_watch_vendor(null, 'test vendor', 'other');
    raise exception 'FAIL 5d: bookkeeper edited the watch list';
  exception when insufficient_privilege then null; end;
  begin
    perform public.gl_review_save_settings('block');
    raise exception 'FAIL 5e: bookkeeper changed gl_review_settings';
  exception when insufficient_privilege then null; end;
  begin
    update public.gl_review_watch_vendors set active = false;
    raise exception 'FAIL 5f: direct update of watch vendors allowed';
  exception when insufficient_privilege then null; end;
  -- ...but can read them.
  select count(*) into n from public.gl_review_watch_vendors;
  if n = 0 then raise exception 'FAIL 5g: staff cannot read the watch list'; end if;
  select count(*) into n from public.gl_review_settings;
  if n <> 1 then raise exception 'FAIL 5h: staff cannot read gl_review_settings'; end if;

  -- 6. A non-admin cannot touch the quote tables.
  select count(*) into n from public.quote_settings;
  if n <> 0 then raise exception 'FAIL 6a: bookkeeper reads quote_settings'; end if;
  select count(*) into n from public.quote_settings_history;
  if n <> 0 then raise exception 'FAIL 6b: bookkeeper reads quote_settings_history'; end if;
  select count(*) into n from public.saved_quotes;
  if n <> 0 then raise exception 'FAIL 6c: bookkeeper reads saved_quotes'; end if;
  begin
    insert into public.saved_quotes (prospect_name) values ('Test prospect');
    raise exception 'FAIL 6d: bookkeeper saved a quote';
  exception when insufficient_privilege then null; end;
  update public.quote_settings set min_per_txn = 9;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 6e: bookkeeper updated quote_settings'; end if;
  begin
    perform public.quote_inputs();
    raise exception 'FAIL 6f: bookkeeper read quote_inputs';
  exception when insufficient_privilege then null; end;

  -- 7. The "Ledger reviewed" close item can't be ticked by hand.
  begin
    insert into public.client_close_items (client_id, period, item_key, done)
    values ('gltest-a', to_char(current_date, 'YYYY-MM'), 'ledger_reviewed', true);
    raise exception 'FAIL 7: ledger_reviewed ticked directly';
  exception when insufficient_privilege then null; end;

  -- 8. Baseline lines are not readable from the browser.
  begin
    perform lines from public.gl_review_month_prints limit 1;
    raise exception 'FAIL 8: gl_review_month_prints.lines readable';
  exception when insufficient_privilege then null; end;

  -- 9. Transaction questions of client B are invisible.
  select count(*) into n from public.transaction_questions where client_id = 'gltest-b';
  if n <> 0 then raise exception 'FAIL 9: bookkeeper A sees client B questions'; end if;

  -- 10. Ask client: portal to A1, then email path needs the contact email.
  perform public.gl_review_ask((select id from public.gl_review_flags where txn_key = 'Purchase:9001' and flag_type = 'suspense'),
                               'portal', 'GLTEST-CLIENT-A1@example.test', 'What was this purchase for?');
  if (select status from public.gl_review_flags where txn_key = 'Purchase:9001' and flag_type = 'suspense') <> 'asked' then
    raise exception 'FAIL 10a: flag not asked';
  end if;
  if (select direction from public.transaction_questions where txn_key = 'Purchase:9001' and client_id = 'gltest-a')
     <> 'staff_asked' then
    raise exception 'FAIL 10b: question direction not staff_asked';
  end if;
  begin
    perform public.gl_review_ask((select id from public.gl_review_flags where txn_key = 'Purchase:9001' and flag_type = 'suspense'),
                                 'portal', 'gltest-client-a2@example.test', 'Again?');
    raise exception 'FAIL 10c: asked a flag that is not open';
  exception when sqlstate '22023' then null; end;

  -- 11. Mark reviewed works for own client (warn mode).
  v := public.gl_review_mark_reviewed('gltest-a', current_date);
  if v ->> 'status' <> 'reviewed' then raise exception 'FAIL 11: mark_reviewed %', v; end if;
end $$;

-- Staff can't insert a staff_asked question directly (no gl_review_ask flag):
-- not a client member, so the client INSERT policy refuses.
do $$ begin
  begin
    insert into public.transaction_questions (client_id, txn_key, note, direction, asked_of_email, asked_via)
    values ('gltest-a', 'Purchase:9050', 'Direct ask', 'staff_asked', 'gltest-client-a2@example.test', 'portal');
    raise exception 'FAIL 12: staff inserted a question directly';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- ===========================================================================
-- Bookkeeper B cannot see or act on client A
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"email":"gltest-bk-b@example.test","role":"authenticated"}', true);
do $$
declare n int; v_id uuid;
begin
  select count(*) into n from public.gl_review_flags where client_id = 'gltest-a';
  if n <> 0 then raise exception 'FAIL 13a: bookkeeper B sees client A flags'; end if;
  select count(*) into n from public.gl_review_signoffs where client_id = 'gltest-a';
  if n <> 0 then raise exception 'FAIL 13b: bookkeeper B sees client A sign-offs'; end if;
  select count(*) into n from public.gl_review_month_prints where client_id = 'gltest-a';
  if n <> 0 then raise exception 'FAIL 13c: bookkeeper B sees client A prints'; end if;
  select count(*) into n from public.gl_review_pulls where client_id = 'gltest-a';
  if n <> 0 then raise exception 'FAIL 13d: bookkeeper B sees client A pulls'; end if;
  select count(*) into n from public.transaction_questions where client_id = 'gltest-a';
  if n <> 0 then raise exception 'FAIL 13e: bookkeeper B sees client A questions'; end if;
end $$;
reset role;
-- Flag ids are invisible to B through RLS, so use a known id fetched as postgres.
do $$
declare v_id uuid := (select id from public.gl_review_flags where txn_key = 'Purchase:9003' and client_id = 'gltest-a');
begin
  perform set_config('gltest.flag_a', v_id::text, true);
end $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"email":"gltest-bk-b@example.test","role":"authenticated"}', true);
do $$ begin
  begin
    perform public.gl_review_clear(current_setting('gltest.flag_a')::uuid, 'expected');
    raise exception 'FAIL 14a: bookkeeper B cleared a client A flag';
  exception when insufficient_privilege then null; end;
  begin
    perform public.gl_review_ask(current_setting('gltest.flag_a')::uuid, 'portal',
                                 'gltest-client-a1@example.test', 'x');
    raise exception 'FAIL 14b: bookkeeper B asked about a client A flag';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- ===========================================================================
-- Client user A1 (the addressee) and A2
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"email":"gltest-client-a2@example.test","role":"authenticated"}', true);
do $$
declare n int;
begin
  -- 15. A client user reads none of the gl_review_* tables.
  select count(*) into n from public.gl_review_flags;            if n <> 0 then raise exception 'FAIL 15a'; end if;
  select count(*) into n from public.gl_review_rules;            if n <> 0 then raise exception 'FAIL 15b'; end if;
  select count(*) into n from public.gl_review_summaries;        if n <> 0 then raise exception 'FAIL 15c'; end if;
  select count(*) into n from public.gl_review_signoffs;         if n <> 0 then raise exception 'FAIL 15d'; end if;
  select count(*) into n from public.gl_review_month_prints;     if n <> 0 then raise exception 'FAIL 15e'; end if;
  select count(*) into n from public.gl_review_pulls;            if n <> 0 then raise exception 'FAIL 15f'; end if;
  select count(*) into n from public.gl_review_watch_vendors;    if n <> 0 then raise exception 'FAIL 15g'; end if;
  select count(*) into n from public.gl_review_settings;         if n <> 0 then raise exception 'FAIL 15h'; end if;
  select count(*) into n from public.quote_settings;             if n <> 0 then raise exception 'FAIL 15i'; end if;
  select count(*) into n from public.saved_quotes;               if n <> 0 then raise exception 'FAIL 15j'; end if;
  begin
    perform public.gl_review_mark_reviewed('gltest-a', current_date);
    raise exception 'FAIL 15k: client user called a staff RPC';
  exception when insufficient_privilege then null; end;

  -- 16. A2 can't see the staff question addressed to A1, and can't answer it.
  select count(*) into n from public.transaction_questions where direction = 'staff_asked';
  if n <> 0 then raise exception 'FAIL 16a: client A2 sees a question addressed to A1'; end if;
  update public.transaction_questions set status = 'answered', answer = 'Not mine'
   where client_id = 'gltest-a' and txn_key = 'Purchase:9001';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 16b: client A2 answered A1''s question'; end if;

  -- 17. A client insert is always client_asked, whatever the row says.
  insert into public.transaction_questions (client_id, txn_key, note, direction, asked_of_email, asked_via)
  values ('gltest-a', 'Purchase:9060', 'What is this?', 'staff_asked', 'gltest-client-a1@example.test', 'portal');
  if (select direction from public.transaction_questions where txn_key = 'Purchase:9060') <> 'client_asked' then
    raise exception 'FAIL 17: client inserted a staff_asked question';
  end if;
  -- 18. Can't ask for another client.
  begin
    insert into public.transaction_questions (client_id, txn_key, note) values ('gltest-b', 'Purchase:9061', 'x');
    raise exception 'FAIL 18: client asked about another client';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"email":"gltest-client-a1@example.test","role":"authenticated"}', true);
do $$
declare n int; v_ok boolean;
begin
  -- 19. A1 sees the question addressed to them, but not A2's own client_asked one.
  select count(*) into n from public.transaction_questions where direction = 'staff_asked';
  if n <> 1 then raise exception 'FAIL 19a: addressee sees % staff questions', n; end if;
  select count(*) into n from public.transaction_questions where txn_key = 'Purchase:9060';
  if n <> 0 then raise exception 'FAIL 19b: client A1 sees client A2''s question'; end if;
  -- 20. Can't resolve it (the stamp trigger refuses), can answer it once.
  v_ok := false;
  begin
    update public.transaction_questions set status = 'resolved', resolution_note = 'x'
     where txn_key = 'Purchase:9001' and client_id = 'gltest-a';
    get diagnostics n = row_count;
    v_ok := (n = 0);
  exception when raise_exception or insufficient_privilege then v_ok := true; end;
  if not v_ok then raise exception 'FAIL 20a: client resolved a staff question'; end if;
  update public.transaction_questions set status = 'answered', answer = 'Office supplies'
   where txn_key = 'Purchase:9001' and client_id = 'gltest-a';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL 20b: addressee could not answer'; end if;
  update public.transaction_questions set answer = 'Changed my mind'
   where txn_key = 'Purchase:9001' and client_id = 'gltest-a';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 20c: answer rewritten'; end if;
end $$;
reset role;

-- 32. (fix 6) One unresolved question per transaction: an ANSWERED question
-- still blocks a second one (index covers open + answered). Once staff
-- resolve it, the addressee no longer sees the row (resolution_note is staff-only).
do $$ begin
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'transaction_questions_one_open'
                  and indexdef ilike '%answered%') then
    raise exception 'FAIL 32a: transaction_questions_one_open does not cover answered questions';
  end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"email":"gltest-bk-a@example.test","role":"authenticated"}', true);
do $$
declare n int;
begin
  begin
    perform public.gl_review_ask((select id from public.gl_review_flags where txn_key = 'Purchase:9001' and flag_type = 'round'),
                                 'portal', 'gltest-client-a2@example.test', 'And this round number?');
    raise exception 'FAIL 32b: second question on a transaction with an answered one';
  exception when unique_violation then null; end;
  update public.transaction_questions set status = 'resolved', resolution_note = 'Staff only: reclassed to 6100'
   where client_id = 'gltest-a' and txn_key = 'Purchase:9001' and status = 'answered';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL 32c: staff could not resolve the answered question'; end if;
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"email":"gltest-client-a1@example.test","role":"authenticated"}', true);
do $$
declare n int;
begin
  select count(*) into n from public.transaction_questions where direction = 'staff_asked';
  if n <> 0 then raise exception 'FAIL 32d: addressee still sees a resolved staff question (% rows)', n; end if;
  select count(*) into n from public.transaction_questions where resolution_note is not null;
  if n <> 0 then raise exception 'FAIL 32e: client reads a resolution_note'; end if;
end $$;
reset role;

-- ===========================================================================
-- Admin: self-approval, settings, gate, reopen
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"email":"gltest-admin@example.test","role":"authenticated"}', true);
do $$
declare n int;
begin
  -- 21. An admin may approve their own review (owner decision 13.4).
  perform public.gl_review_mark_reviewed('gltest-b', current_date);
  perform public.gl_review_approve('gltest-b', current_date);
  if (select status from public.gl_review_signoffs where client_id = 'gltest-b'
        and period = date_trunc('month', current_date)::date) <> 'approved' then
    raise exception 'FAIL 21: admin self-approval refused';
  end if;
  -- 22. Admin reads quote tables and inputs.
  select count(*) into n from public.quote_settings;
  if n <> 1 then raise exception 'FAIL 22a: admin cannot read quote_settings'; end if;
  perform public.quote_inputs();
  insert into public.saved_quotes (prospect_name) values ('Test prospect');
  -- 23. Admin switches the gate to block (restored by the rollback).
  perform public.gl_review_save_settings('block');
end $$;
reset role;

-- 24. Block mode: bookkeeper A can't mark gltest-a Done (reviewed, not approved).
set local role authenticated;
select set_config('request.jwt.claims', '{"email":"gltest-bk-a@example.test","role":"authenticated"}', true);
do $$ begin
  begin
    update public.month_close set status = 'done'
     where client_id = 'gltest-a' and period = date_trunc('month', current_date)::date;
    raise exception 'FAIL 24a: month marked done without approval in block mode';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.month_close (client_id, period, status)
    values ('gltest-a', (date_trunc('month', current_date) + interval '1 month')::date, 'done');
    raise exception 'FAIL 24b: insert straight to done allowed in block mode';
  exception when insufficient_privilege then null; end;
  -- 33b. (fix 2) The warn-era override on month +2 does not satisfy block mode.
  begin
    insert into public.month_close (client_id, period, status)
    values ('gltest-a', (date_trunc('month', current_date) + interval '2 months')::date, 'done');
    raise exception 'FAIL 33b: a warn-mode override satisfied the block gate';
  exception when insufficient_privilege then null; end;
  -- A bookkeeper can't override in block mode.
  begin
    perform public.gl_review_override_done('gltest-a', current_date, 'Need it closed');
    raise exception 'FAIL 24c: bookkeeper overrode in block mode';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- 25. Admin approves; then Done works; reopening clears the approval.
set local role authenticated;
select set_config('request.jwt.claims', '{"email":"gltest-admin@example.test","role":"authenticated"}', true);
do $$ begin
  -- Since tasks-p2-2-periods.sql only the sign-off RPCs move a month in or
  -- out of Done (month_close_signoff_guard); stand in for them here.
  perform set_config('mgb.tk_signoff', 'on', true);
  perform public.gl_review_approve('gltest-a', current_date);
  update public.month_close set status = 'done'
   where client_id = 'gltest-a' and period = date_trunc('month', current_date)::date;
  if (select done_at from public.month_close where client_id = 'gltest-a'
        and period = date_trunc('month', current_date)::date) is null then
    raise exception 'FAIL 25a: done_at not stamped';
  end if;
  update public.month_close set status = 'review'
   where client_id = 'gltest-a' and period = date_trunc('month', current_date)::date;
  if (select status from public.gl_review_signoffs where client_id = 'gltest-a'
        and period = date_trunc('month', current_date)::date) <> 'reviewed' then
    raise exception 'FAIL 25b: reopening did not clear the approval';
  end if;
  -- 33c. (fix 2) An admin override made in block mode (with a reason) does count.
  perform public.gl_review_override_done('gltest-a', (date_trunc('month', current_date) + interval '2 months')::date,
                                         'Owner asked to close; review next week');
  if (select override_gate from public.gl_review_signoffs where client_id = 'gltest-a'
        and period = (date_trunc('month', current_date) + interval '2 months')::date) is distinct from 'block' then
    raise exception 'FAIL 33c: block override not recorded with override_gate block';
  end if;
  insert into public.month_close (client_id, period, status)
  values ('gltest-a', (date_trunc('month', current_date) + interval '2 months')::date, 'done');
  -- Reopening clears the override, gate included.
  update public.month_close set status = 'review'
   where client_id = 'gltest-a' and period = (date_trunc('month', current_date) + interval '2 months')::date;
  if (select override_gate from public.gl_review_signoffs where client_id = 'gltest-a'
        and period = (date_trunc('month', current_date) + interval '2 months')::date) is not null then
    raise exception 'FAIL 33d: reopening did not clear override_gate';
  end if;
end $$;
reset role;

-- 34. (fix 7) The block gate applies to service_role too (no backend bypass).
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
do $$ begin
  begin
    insert into public.month_close (client_id, period, status)
    values ('gltest-a', (date_trunc('month', current_date) + interval '3 months')::date, 'done');
    raise exception 'FAIL 34: service_role marked an unapproved month done in block mode';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- ===========================================================================
-- Anon gets nothing
-- ===========================================================================
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$
declare t text;
begin
  foreach t in array array['gl_review_flags', 'gl_review_rules', 'gl_review_summaries', 'gl_review_signoffs',
                           'gl_review_month_prints', 'gl_review_pulls', 'gl_review_watch_vendors',
                           'gl_review_settings', 'quote_settings', 'quote_settings_history', 'saved_quotes',
                           'transaction_questions'] loop
    begin
      execute format('select 1 from public.%I limit 1', t);
      raise exception 'FAIL 26: anon can read %', t;
    exception when insufficient_privilege then null; end;
  end loop;
  begin
    perform public.gl_review_mark_reviewed('gltest-a', current_date);
    raise exception 'FAIL 27a: anon called a staff RPC';
  exception when insufficient_privilege then null; end;
  begin
    perform public.gl_review_pull_begin('gltest-a', 'x', 'rolling14', current_date, current_date, false);
    raise exception 'FAIL 27b: anon called a service-role RPC';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- Service-role RPCs are not callable by staff either.
set local role authenticated;
select set_config('request.jwt.claims', '{"email":"gltest-admin@example.test","role":"authenticated"}', true);
do $$ begin
  begin
    perform public.gl_review_record_prints('gltest-a', '[]'::jsonb, 'x');
    raise exception 'FAIL 28a: staff called gl_review_record_prints';
  exception when insufficient_privilege then null; end;
  begin
    perform public.gl_review_baseline_from_last_print('gltest-a', current_date);
    raise exception 'FAIL 28b: staff called gl_review_baseline_from_last_print';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- 35. (fix 1) The done_at backfill keeps updated_at / updated_by. A Done row
-- from before gl-review-3 (no done_at) is written with the stamping triggers
-- off, then the backfill runs exactly as in gl-review-3-close.sql section 2
-- (keep these three statements in sync with it).
alter table public.month_close disable trigger month_close_before_write;
alter table public.month_close disable trigger month_close_gl_review_gate;
insert into public.month_close (client_id, period, status, updated_at, updated_by, done_at)
values ('gltest-b', (date_trunc('month', current_date) - interval '2 months')::date, 'done',
        '2026-01-05 10:00+00', 'gltest-bk-b@example.test', null);
alter table public.month_close enable trigger month_close_gl_review_gate;
alter table public.month_close enable trigger month_close_before_write;

alter table public.month_close disable trigger month_close_before_write;
update public.month_close set done_at = updated_at where status = 'done' and done_at is null;
alter table public.month_close enable trigger month_close_before_write;

do $$
declare r record;
begin
  select * into r from public.month_close
   where client_id = 'gltest-b' and period = (date_trunc('month', current_date) - interval '2 months')::date;
  if r.updated_at <> '2026-01-05 10:00+00'::timestamptz or r.updated_by is distinct from 'gltest-bk-b@example.test' then
    raise exception 'FAIL 35a: backfill changed updated_at/updated_by (% / %)', r.updated_at, r.updated_by;
  end if;
  if r.done_at is distinct from '2026-01-05 10:00+00'::timestamptz then
    raise exception 'FAIL 35b: done_at not backfilled from updated_at (%)', r.done_at;
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'month_close_before_write' and tgenabled = 'O') then
    raise exception 'FAIL 35c: month_close_before_write left disabled';
  end if;
end $$;

-- 31e. (fix 4) The addressee list is staff-only.
set local role authenticated;
select set_config('request.jwt.claims', '{"email":"gltest-bk-b@example.test","role":"authenticated"}', true);
do $$ begin
  begin
    perform public.gl_review_portal_addressees('gltest-a');
    raise exception 'FAIL 31e: bookkeeper B listed client A portal users';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claims', '{"email":"gltest-client-a1@example.test","role":"authenticated"}', true);
do $$ begin
  begin
    perform public.gl_review_portal_addressees('gltest-a');
    raise exception 'FAIL 31f: a client user listed portal addressees';
  exception when insufficient_privilege then null; end;
  begin
    perform public.gl_review_portal_addressable('gltest-a', 'gltest-client-a1@example.test');
    raise exception 'FAIL 31g: gl_review_portal_addressable callable from the browser';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$ begin
  begin
    perform public.gl_review_portal_addressees('gltest-a');
    raise exception 'FAIL 31h: anon listed portal addressees';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- 30h. (fix 3) Only the person who ran the pull can save or retire its flags,
-- and an old pull can't be saved.
set local role authenticated;
select set_config('request.jwt.claims', '{"email":"gltest-admin@example.test","role":"authenticated"}', true);
do $$
declare v jsonb;
begin
  begin
    perform public.gl_review_upsert_flags('gltest-a', '6c1e0000-0000-4000-8000-0000000000a1', 1,
      '[{"txn_key":"Purchase:9030","flag_type":"large","severity":"low","why":"x","txn_date":"2026-10-01"}]'::jsonb);
    raise exception 'FAIL 30h: admin saved flags for bookkeeper A''s pull';
  exception when insufficient_privilege then null; end;
  v := public.gl_review_mark_fixed('gltest-a', '6c1e0000-0000-4000-8000-0000000000a1', 1);
  if v ->> 'status' <> 'stale' then raise exception 'FAIL 30i: admin retired flags with another person''s pull %', v; end if;
end $$;
reset role;
update public.gl_review_pulls set started_at = now() - interval '2 hours' where client_id = 'gltest-a';
set local role authenticated;
select set_config('request.jwt.claims', '{"email":"gltest-bk-a@example.test","role":"authenticated"}', true);
do $$ begin
  begin
    perform public.gl_review_upsert_flags('gltest-a', '6c1e0000-0000-4000-8000-0000000000a1', 1,
      '[{"txn_key":"Purchase:9031","flag_type":"large","severity":"low","why":"x","txn_date":"2026-10-01"}]'::jsonb);
    raise exception 'FAIL 30j: upsert accepted a two-hour-old pull';
  exception when sqlstate '22023' then null; end;
end $$;
reset role;

do $$ begin raise notice 'gl-review RLS tests: all passed'; end $$;

rollback;
