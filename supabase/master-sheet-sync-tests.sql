-- Master Data fee sync: tests for master-sheet-sync.sql.
-- NOT a migration. Run AFTER master-sheet-sync.sql, in the Supabase SQL editor
-- (or psql as postgres). One transaction ending in ROLLBACK, so nothing
-- survives. Ends by raising 'master-sheet-sync tests FAILED: ...' or with the
-- notice '... all N passed'.
--
-- Personas from the live staff table (no emails here), same as
-- profitability-internal-only-tests.sql:
--   owner    active admin with internal_access.is_owner (has the grant)
--   adm_no   active admin WITHOUT a grant row (Jesse today)
--   bk       active bookkeeper

begin;

create temp table _mss (n serial, name text, ok boolean, detail text);
create temp table _who (k text primary key, email text);
create temp table _cl (k text primary key, id text);

create or replace function pg_temp.chk(p_name text, p_ok boolean, p_detail text default null)
returns void language plpgsql as $$
begin
  insert into _mss(name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail);
end $$;

create or replace function pg_temp.claims(p_email text)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim', '', true);
  perform set_config('request.jwt.claims',
    case when p_email is null then ''
         else json_build_object('email', p_email, 'role', 'authenticated', 'sub', gen_random_uuid(),
                'app_metadata', json_build_object('provider', 'google', 'providers', json_build_array('google')))::text end,
    true);
end $$;

create or replace function pg_temp.probe(p_email text, p_sql text)
returns text language plpgsql as $$
declare v text;
begin
  perform pg_temp.claims(p_email);
  set local role authenticated;
  begin
    execute p_sql into v;
    v := coalesce(v, 'null');
  exception when others then
    v := 'ERR:' || sqlstate || ':' || left(sqlerrm, 90);
  end;
  reset role;
  perform pg_temp.claims(null);
  return v;
end $$;

create or replace function pg_temp.dml(p_email text, p_sql text)
returns text language plpgsql as $$
declare n int;
begin
  perform pg_temp.claims(p_email);
  set local role authenticated;
  begin
    execute p_sql;
    get diagnostics n = row_count;
  exception when others then
    reset role;
    perform pg_temp.claims(null);
    return 'ERR:' || sqlstate;
  end;
  reset role;
  perform pg_temp.claims(null);
  return n::text;
end $$;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
insert into _who select 'owner', ia.staff_email from internal_access ia
  join staff s on s.email = ia.staff_email and s.role = 'admin' and s.active
 where ia.is_owner limit 1;
insert into _who select 'adm_no', s.email from staff s
 where s.role = 'admin' and s.active
   and not exists (select 1 from internal_access ia where ia.staff_email = s.email)
 order by s.email limit 1;
insert into _who select 'bk', email from staff where role = 'bookkeeper' and active order by email limit 1;

-- Three real clients (not test, not internal) used only inside this transaction.
insert into _cl select 'a', id from clients where not coalesce(test_only, false) and not coalesce(is_internal, false) order by id limit 1;
insert into _cl select 'b', id from clients where not coalesce(test_only, false) and not coalesce(is_internal, false) order by id offset 1 limit 1;
insert into _cl select 'c', id from clients where not coalesce(test_only, false) and not coalesce(is_internal, false) order by id offset 2 limit 1;
insert into _cl select 't', id from clients where coalesce(test_only, false) order by id limit 1;

delete from client_fees where client_id in (select id from _cl where k in ('a', 'b', 'c'));
insert into client_fees (client_id, monthly_fee, updated_by) values
  ((select id from _cl where k = 'a'), 500, 'mss-test'),
  ((select id from _cl where k = 'c'), 700, 'mss-test');
insert into master_sheet_sync_runs (trigger, mode, status, requested_by) values ('manual', 'dry_run', 'ok', 'mss-test');
insert into master_sheet_unmatched (sheet_key, sheet_name, status) values ('msstestrow', 'MSS Test Row', 'Active')
  on conflict (sheet_key) do nothing;

do $$
begin
  perform pg_temp.chk('personas found: owner, adm_no, bk', (select count(*) from _who where email is not null) = 3,
    (select string_agg(k || '=' || coalesce(email, '?'), ',') from _who));
  perform pg_temp.chk('fixture clients found', (select count(*) from _cl where id is not null and k in ('a','b','c')) = 3);
end $$;

-- ---------------------------------------------------------------------------
-- Checks
-- ---------------------------------------------------------------------------
do $$
declare
  own text := (select email from _who where k = 'owner');
  adm text := (select email from _who where k = 'adm_no');
  bk  text := (select email from _who where k = 'bk');
  ca text := (select id from _cl where k = 'a');
  cb text := (select id from _cl where k = 'b');
  cc text := (select id from _cl where k = 'c');
  ct text := (select id from _cl where k = 't');
  v text;
  who text;
  r jsonb;
  n_audit int;
begin
  perform pg_temp.chk('adm_no: can_view_internal() false', pg_temp.probe(adm, 'select public.can_view_internal()') = 'false');
  perform pg_temp.chk('owner: can_view_internal() true', pg_temp.probe(own, 'select public.can_view_internal()') = 'true');

  -- Reads: nothing for adm_no (Jesse) or a bookkeeper.
  foreach who in array array[adm, bk] loop
    v := pg_temp.probe(who, 'select count(*) from public.master_sheet_client_map');
    perform pg_temp.chk('map: zero rows for ' || who, v = '0', v);
    v := pg_temp.probe(who, 'select count(*) from public.master_sheet_sync_runs');
    perform pg_temp.chk('runs: zero rows for ' || who, v = '0', v);
    v := pg_temp.probe(who, 'select count(*) from public.master_sheet_unmatched');
    perform pg_temp.chk('unmatched: zero rows for ' || who, v = '0', v);
    v := pg_temp.probe(who, 'select public.master_sheet_apply(0, ''[]''::jsonb)::text');
    perform pg_temp.chk('master_sheet_apply: refused for ' || who, v like 'ERR:42501:%', v);
    v := pg_temp.probe(who, 'select public.master_sheet_cron_tick()::text');
    perform pg_temp.chk('master_sheet_cron_tick: refused for ' || who, v like 'ERR:42501:%', v);
    v := pg_temp.dml(who, $q$insert into public.master_sheet_client_map (sheet_name, ignored) values ('MSS Probe', true)$q$);
    perform pg_temp.chk('map insert: refused for ' || who, v like 'ERR:%', v);
    v := pg_temp.dml(who, $q$delete from public.master_sheet_client_map$q$);
    perform pg_temp.chk('map delete: 0 rows for ' || who, v = '0', v);
    v := pg_temp.dml(who, $q$insert into public.master_sheet_sync_runs (trigger, mode) values ('manual', 'live')$q$);
    perform pg_temp.chk('runs insert: refused for ' || who, v like 'ERR:%', v);
    v := pg_temp.dml(who, $q$delete from public.master_sheet_unmatched$q$);
    perform pg_temp.chk('unmatched delete: refused or 0 for ' || who, v like 'ERR:%' or v = '0', v);
  end loop;

  -- Owner reads; still cannot call the writer or fake the log.
  v := pg_temp.probe(own, 'select count(*) from public.master_sheet_client_map');
  perform pg_temp.chk('map: owner reads the 4 seeds', v not like 'ERR:%' and v::int >= 4, v);
  v := pg_temp.probe(own, $q$select count(*) from public.master_sheet_sync_runs where requested_by = 'mss-test'$q$);
  perform pg_temp.chk('runs: owner reads', v = '1', v);
  v := pg_temp.probe(own, $q$select count(*) from public.master_sheet_unmatched where sheet_key = 'msstestrow'$q$);
  perform pg_temp.chk('unmatched: owner reads', v = '1', v);
  v := pg_temp.probe(own, 'select public.master_sheet_apply(0, ''[]''::jsonb)::text');
  perform pg_temp.chk('master_sheet_apply: refused even for owner (service role only)', v like 'ERR:42501:%', v);
  v := pg_temp.dml(own, $q$insert into public.master_sheet_sync_runs (trigger, mode) values ('manual', 'live')$q$);
  perform pg_temp.chk('runs insert: refused for owner', v like 'ERR:%', v);
  v := pg_temp.dml(own, $q$insert into public.master_sheet_client_map (sheet_name, ignored) values ('MSS Probe Org', true)$q$);
  perform pg_temp.chk('map insert: owner can mark "not a client"', v = '1', v);
  v := pg_temp.probe(own, $q$select updated_by from public.master_sheet_client_map where sheet_key = 'mssprobeorg'$q$);
  perform pg_temp.chk('map: updated_by stamped with the signed-in email', v = own, v);
  v := pg_temp.probe(own, $q$select count(*) from public.audit_log where action = 'client_fee.sheet_map.insert' and target_id = 'mssprobeorg'$q$);
  perform pg_temp.chk('map change audited (owner reads it)', v = '1', v);
  v := pg_temp.probe(adm, $q$select count(*) from public.audit_log where action like 'client_fee.sheet_map.%'$q$);
  perform pg_temp.chk('map audit hidden from adm_no', v = '0', v);
  perform pg_temp.chk('seed: The Way Community Church -> the-way (not Pathway)',
    (select client_id from master_sheet_client_map where sheet_key = 'thewaycommunitychurch') = 'the-way');

  -- People cannot fake a synced row.
  v := pg_temp.dml(own, format($q$insert into public.client_fees (client_id, monthly_fee, source, synced_at) values (%L, 300, 'master_sheet', now())$q$, cb));
  perform pg_temp.chk('owner insert: accepted', v = '1', v);
  perform pg_temp.chk('owner insert: source forced to manual, synced_at null',
    (select source = 'manual' and synced_at is null from client_fees where client_id = cb));
  delete from client_fees where client_id = cb;

  -- The sync (as postgres here; the edge function uses the service role).
  r := public.master_sheet_apply(1, jsonb_build_array(
         jsonb_build_object('client_id', ca, 'from', 500, 'to', 600),          -- change
         jsonb_build_object('client_id', cb, 'from', null, 'to', 250.5),       -- new
         jsonb_build_object('client_id', cc, 'from', 650, 'to', 800),          -- fee moved since plan: conflict
         jsonb_build_object('client_id', ct, 'from', null, 'to', 99),          -- test client: skipped
         jsonb_build_object('client_id', ca, 'from', 600, 'to', 0)             -- zero: skipped
       ),
       jsonb_build_array(jsonb_build_object('sheet_key', 'mssnewrow', 'sheet_name', 'MSS New Row', 'status', 'Active', 'fee_text', '$5')),
       true);
  perform pg_temp.chk('apply: counts', (r->>'updated')::int = 2 and (r->>'conflicts')::int = 1 and (r->>'skipped')::int = 2, r::text);
  perform pg_temp.chk('apply: changed fee written with source/synced/updated_by',
    (select monthly_fee = 600 and source = 'master_sheet' and synced_at is not null and updated_by = 'master-sheet-sync'
       from client_fees where client_id = ca));
  perform pg_temp.chk('apply: new fee inserted', (select monthly_fee from client_fees where client_id = cb) = 250.50);
  perform pg_temp.chk('apply: conflict left alone', (select monthly_fee from client_fees where client_id = cc) = 700);
  perform pg_temp.chk('apply: test client never written', ct is null or not exists (select 1 from client_fees where client_id = ct and updated_by = 'master-sheet-sync'));
  perform pg_temp.chk('apply: review list rebuilt',
    exists (select 1 from master_sheet_unmatched where sheet_key = 'mssnewrow')
    and not exists (select 1 from master_sheet_unmatched where sheet_key = 'msstestrow'));
  select count(*) into n_audit from audit_log
   where actor_email = 'master-sheet-sync' and client_id in (ca, cb) and action in ('client_fee.changed', 'client_fee.set')
     and details->>'source' = 'master_sheet';
  perform pg_temp.chk('apply: audit rows with actor master-sheet-sync and source', n_audit = 2, n_audit::text);

  -- Same fee again: unchanged, no new audit row.
  r := public.master_sheet_apply(2, jsonb_build_array(jsonb_build_object('client_id', ca, 'from', 600, 'to', 600)), '[]'::jsonb, false);
  perform pg_temp.chk('apply: same fee counts unchanged', (r->>'unchanged')::int = 1, r::text);
  perform pg_temp.chk('apply: same fee writes no audit row',
    (select count(*) from audit_log where actor_email = 'master-sheet-sync' and client_id = ca) = 1);

  -- Jesse cannot touch synced fees.
  v := pg_temp.dml(adm, format($q$update public.client_fees set monthly_fee = 1 where client_id = %L$q$, ca));
  perform pg_temp.chk('adm_no update synced fee: 0 rows', v = '0', v);
  v := pg_temp.dml(adm, format($q$update public.client_fees set sheet_override = true where client_id = %L$q$, ca));
  perform pg_temp.chk('adm_no turn on override: 0 rows', v = '0', v);

  -- Owner: delete of a synced row is blocked; editing it turns the override on.
  v := pg_temp.dml(own, format($q$delete from public.client_fees where client_id = %L$q$, ca));
  perform pg_temp.chk('owner delete synced fee: refused', v like 'ERR:42501', v);
  v := pg_temp.dml(own, format($q$update public.client_fees set needs_review = true where client_id = %L$q$, ca));
  perform pg_temp.chk('owner non-fee edit: no override', v = '1' and not (select sheet_override from client_fees where client_id = ca), v);
  v := pg_temp.dml(own, format($q$update public.client_fees set monthly_fee = 650, source = 'manual', synced_at = null where client_id = %L$q$, ca));
  perform pg_temp.chk('owner edits synced fee: override turns on, source/synced_at kept',
    v = '1' and (select sheet_override and source = 'master_sheet' and synced_at is not null and monthly_fee = 650
                   from client_fees where client_id = ca), v);
  perform pg_temp.chk('override on audited',
    exists (select 1 from audit_log where action = 'client_fee.sheet_override_on' and client_id = ca and actor_email = own));

  -- Sync leaves an overridden fee alone.
  r := public.master_sheet_apply(3, jsonb_build_array(jsonb_build_object('client_id', ca, 'from', 650, 'to', 900)), '[]'::jsonb, false);
  perform pg_temp.chk('apply: override skipped', (r->>'skipped')::int = 1 and (select monthly_fee from client_fees where client_id = ca) = 650, r::text);

  -- Resume sync.
  v := pg_temp.dml(own, format($q$update public.client_fees set sheet_override = false where client_id = %L$q$, ca));
  perform pg_temp.chk('owner resume sync', v = '1' and exists (select 1 from audit_log where action = 'client_fee.sheet_override_off' and client_id = ca), v);
  v := pg_temp.dml(own, format($q$delete from public.client_fees where client_id = %L$q$, cc));
  perform pg_temp.chk('owner delete manual fee: allowed', v = '1', v);

  -- Audit rows from the sync are hidden from Jesse.
  v := pg_temp.probe(adm, $q$select count(*) from public.audit_log where actor_email = 'master-sheet-sync'$q$);
  perform pg_temp.chk('sync audit rows hidden from adm_no', v = '0', v);

  -- Cron tick: does nothing until a manual live run succeeded.
  perform pg_temp.chk('cron tick: no post without a manual live ok run',
    not exists (select 1 from master_sheet_sync_runs where trigger = 'manual' and mode = 'live' and status = 'ok')
    and public.master_sheet_cron_tick() is null);
  perform pg_temp.chk('cron job scheduled', exists (select 1 from cron.job where jobname = 'master-sheet-sync-nightly'));
  perform pg_temp.chk('norm matches JS', public.master_sheet_norm('City House Church, Milwaukee') = 'cityhousechurchmilwaukee'
    and public.master_sheet_norm('Café') = 'caf');
end $$;

do $$
declare bad text;
begin
  select string_agg(name || coalesce(' [' || detail || ']', ''), E'\n  ') into bad from _mss where not ok;
  if bad is not null then
    raise exception E'master-sheet-sync tests FAILED:\n  %', bad;
  end if;
  raise notice 'master-sheet-sync tests: all % passed', (select count(*) from _mss);
end $$;

rollback;
