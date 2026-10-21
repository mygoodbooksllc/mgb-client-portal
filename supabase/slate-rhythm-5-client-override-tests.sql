-- =====================================================================
-- Self-test for slate-rhythm-5-client-override.sql (a client's own rhythm). Ends in ROLLBACK.
-- Test clients basic-test and grace-community only; people picked at run time.
-- A failed check raises; the last select returns 'all ok'.
-- Vector rows are copied from components/tasks/TK_rhythmClient.fixtures.js;
-- TK_rhythmClient.test.js checks every row is here with the same text.
-- Last run 2026-10-21 against production: all ok, rolled back (nothing left behind).
-- =====================================================================
begin;

create temp table t_ctx (k text primary key, v text) on commit drop;
grant all on t_ctx to authenticated;
create or replace function pg_temp.ctx(p_k text) returns text language sql as $$ select v from t_ctx where k = p_k $$;
create or replace function pg_temp.as_user(p_email text, p_google boolean default true) returns void language sql as $$
  select set_config('request.jwt.claims',
    case when p_email is null then '' else json_build_object(
      'sub', gen_random_uuid(), 'email', p_email, 'role', 'authenticated',
      'app_metadata', case when p_google then json_build_object('provider', 'google') else json_build_object('provider', 'email') end)::text end, true);
$$;
create or replace function pg_temp.ok(p_cond boolean, p_what text) returns void language plpgsql as $$
begin
  if p_cond is not true then raise exception 'SELF-TEST FAILED: %', p_what; end if;
end $$;
create or replace function pg_temp.expect_err(p_sql text, p_err text, p_what text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if position(p_err in sqlerrm) > 0 then return; end if;
    raise exception 'SELF-TEST FAILED: % expected %, got %', p_what, p_err, sqlerrm;
  end;
  raise exception 'SELF-TEST FAILED: % expected %, but it succeeded', p_what, p_err;
end $$;
grant execute on function pg_temp.ctx(text), pg_temp.ok(boolean, text), pg_temp.expect_err(text, text, text),
  pg_temp.as_user(text, boolean) to authenticated;

-- 0. Vectors (shared with JS) -------------------------------------------------
create temp table t_problem (id text, j text, p text) on commit drop;
insert into t_problem values
  ('cp01_none', null, null),
  ('cp02_json_null', 'null', null),
  ('cp03_ok', '[{"key":"check_in","day":5},{"key":"reports","day":15},{"key":"follow_up","day":25}]', null),
  ('cp04_ok_labels', '[{"key":"check_in","label":"Start","day":1},{"key":"reports","day":2},{"key":"follow_up","day":28}]', null),
  ('cp05_object', '{"parts":[{"key":"check_in","day":5},{"key":"reports","day":15},{"key":"follow_up","day":25}]}', 'parts_missing'),
  ('cp06_string', '"5,15,25"', 'parts_missing'),
  ('cp07_two', '[{"key":"check_in","day":5},{"key":"reports","day":15}]', 'parts_count'),
  ('cp08_order', '[{"key":"reports","day":5},{"key":"check_in","day":15},{"key":"follow_up","day":25}]', 'part_key'),
  ('cp09_day_29', '[{"key":"check_in","day":5},{"key":"reports","day":15},{"key":"follow_up","day":29}]', 'part_day'),
  ('cp10_day_str', '[{"key":"check_in","day":"5"},{"key":"reports","day":15},{"key":"follow_up","day":25}]', 'part_day'),
  ('cp11_equal', '[{"key":"check_in","day":5},{"key":"reports","day":5},{"key":"follow_up","day":25}]', 'day_order'),
  ('cp12_label_blank', '[{"key":"check_in","label":" ","day":5},{"key":"reports","day":15},{"key":"follow_up","day":25}]', 'label'),
  ('cp13_empty_array', '[]', 'parts_count'),
  ('cp14_float_int', '[{"key":"check_in","day":5.0},{"key":"reports","day":15},{"key":"follow_up","day":25}]', null)
;
create temp table t_merge (id text, f text, c text, e text) on commit drop;
insert into t_merge values
  ('cm01_no_override', '{"parts":[{"key":"check_in","label":"Check in","day":4},{"key":"reports","label":"Send reports","day":14},{"key":"follow_up","label":"Follow up","day":24}],"roll":"next"}', null, '{"parts":[{"key":"check_in","label":"Check in","day":4},{"key":"reports","label":"Send reports","day":14},{"key":"follow_up","label":"Follow up","day":24}],"roll":"next"}'),
  ('cm02_json_null', '{"parts":[{"key":"check_in","label":"Check in","day":4},{"key":"reports","label":"Send reports","day":14},{"key":"follow_up","label":"Follow up","day":24}],"roll":"next"}', 'null', '{"parts":[{"key":"check_in","label":"Check in","day":4},{"key":"reports","label":"Send reports","day":14},{"key":"follow_up","label":"Follow up","day":24}],"roll":"next"}'),
  ('cm03_override', '{"parts":[{"key":"check_in","label":"Check in","day":4},{"key":"reports","label":"Send reports","day":14},{"key":"follow_up","label":"Follow up","day":24}],"roll":"next"}', '[{"key":"check_in","day":5},{"key":"reports","day":15},{"key":"follow_up","day":25}]', '{"parts":[{"key":"check_in","label":"Check in","day":5},{"key":"reports","label":"Send reports","day":15},{"key":"follow_up","label":"Follow up","day":25}],"roll":"next"}'),
  ('cm04_firm_roll_kept', '{"parts":[{"key":"check_in","day":3},{"key":"reports","day":12},{"key":"follow_up","day":20}],"roll":"prev"}', '[{"key":"check_in","day":5},{"key":"reports","day":15},{"key":"follow_up","day":25}]', '{"parts":[{"key":"check_in","day":5},{"key":"reports","day":15},{"key":"follow_up","day":25}],"roll":"prev"}'),
  ('cm05_client_labels_ignored', '{"parts":[{"key":"check_in","label":"Check in","day":4},{"key":"reports","label":"Send reports","day":14},{"key":"follow_up","label":"Follow up","day":24}],"roll":"next"}', '[{"key":"check_in","label":"Mine","day":2},{"key":"reports","day":9},{"key":"follow_up","day":27}]', '{"parts":[{"key":"check_in","label":"Check in","day":2},{"key":"reports","label":"Send reports","day":9},{"key":"follow_up","label":"Follow up","day":27}],"roll":"next"}'),
  ('cm06_firm_missing', null, '[{"key":"check_in","day":5},{"key":"reports","day":15},{"key":"follow_up","day":25}]', null),
  ('cm07_firm_missing_no_override', null, null, null),
  ('cm08_firm_invalid', '{"parts":[],"roll":"next"}', '[{"key":"check_in","day":5},{"key":"reports","day":15},{"key":"follow_up","day":25}]', null),
  ('cm09_client_invalid', '{"parts":[{"key":"check_in","label":"Check in","day":4},{"key":"reports","label":"Send reports","day":14},{"key":"follow_up","label":"Follow up","day":24}],"roll":"next"}', '[{"key":"check_in","day":20},{"key":"reports","day":15},{"key":"follow_up","day":25}]', null),
  ('cm10_client_object', '{"parts":[{"key":"check_in","label":"Check in","day":4},{"key":"reports","label":"Send reports","day":14},{"key":"follow_up","label":"Follow up","day":24}],"roll":"next"}', '{"parts":[{"key":"check_in","day":5},{"key":"reports","day":15},{"key":"follow_up","day":25}]}', null),
  ('cm11_float_day', '{"parts":[{"key":"check_in","label":"Check in","day":4},{"key":"reports","label":"Send reports","day":14},{"key":"follow_up","label":"Follow up","day":24}],"roll":"next"}', '[{"key":"check_in","day":5.0},{"key":"reports","day":15},{"key":"follow_up","day":25}]', '{"parts":[{"key":"check_in","label":"Check in","day":5},{"key":"reports","label":"Send reports","day":15},{"key":"follow_up","label":"Follow up","day":25}],"roll":"next"}'),
  ('cm12_same_as_firm', '{"parts":[{"key":"check_in","label":"Check in","day":4},{"key":"reports","label":"Send reports","day":14},{"key":"follow_up","label":"Follow up","day":24}],"roll":"next"}', '[{"key":"check_in","day":4},{"key":"reports","day":14},{"key":"follow_up","day":24}]', '{"parts":[{"key":"check_in","label":"Check in","day":4},{"key":"reports","label":"Send reports","day":14},{"key":"follow_up","label":"Follow up","day":24}],"roll":"next"}'),
  ('cm13_firm_extra_fields_dropped', '{"parts":[{"key":"check_in","label":"Check in","day":4,"note":"x"},{"key":"reports","day":14},{"key":"follow_up","day":24}],"roll":"none","v":2}', '[{"key":"check_in","day":5},{"key":"reports","day":15},{"key":"follow_up","day":25}]', '{"parts":[{"key":"check_in","label":"Check in","day":5},{"key":"reports","day":15},{"key":"follow_up","day":25}],"roll":"none"}')
;
select pg_temp.ok(public.tk_client_rhythm_problem(j::jsonb) is not distinct from p, 'problem vector ' || id
                  || ' gave ' || coalesce(public.tk_client_rhythm_problem(j::jsonb), 'null'))
  from t_problem;
select pg_temp.ok((select count(*) = 14 from t_problem), 'all 14 problem vectors present');
select pg_temp.ok(public.tk_month_rhythm_merge(f::jsonb, c::jsonb) is not distinct from e::jsonb, 'merge vector ' || id
                  || ' gave ' || coalesce(public.tk_month_rhythm_merge(f::jsonb, c::jsonb)::text, 'null'))
  from t_merge;
select pg_temp.ok((select count(*) = 13 from t_merge), 'all 13 merge vectors present');

-- People and access ------------------------------------------------------------
insert into t_ctx select 'a1', lower(s.email) from staff s where s.active and s.role = 'admin' order by s.email limit 1;
insert into t_ctx select 'bk', lower(s.email) from staff s where s.active and s.role = 'bookkeeper' order by s.email limit 1;
insert into t_ctx select 'cm', lower(cu.email) from client_users cu where cu.client_id = 'grace-community' and cu.active order by cu.email limit 1;
select pg_temp.ok(pg_temp.ctx('a1') is not null and pg_temp.ctx('bk') is not null and pg_temp.ctx('cm') is not null, 'test people found');
select pg_temp.ok(not exists (select 1 from staff s where lower(s.email) = pg_temp.ctx('cm')), 'client user is not staff');
insert into staff_client_access (staff_email, client_id)
select pg_temp.ctx('bk'), 'basic-test'
 where not exists (select 1 from staff_client_access where lower(staff_email) = pg_temp.ctx('bk') and client_id = 'basic-test');
insert into t_ctx values ('firm', public.tk_month_rhythm()::text);
insert into t_ctx values ('audit0', (select count(*) from client_rhythm_audit)::text);
insert into t_ctx values ('C', '[{"key":"check_in","day":5},{"key":"reports","day":15},{"key":"follow_up","day":25}]');
select pg_temp.ok(pg_temp.ctx('firm') is not null, 'firm rhythm readable');

-- Generator before any override (no JWT, as the cron runs it).
insert into t_ctx values ('gen_before', public.tk__generate('2026-11-03', true, 'basic-test', 40, 'selftest', null)::text);

-- 1. Admin saves an override ----------------------------------------------------
set local role authenticated;
select pg_temp.as_user(pg_temp.ctx('a1'));
select pg_temp.ok(
  public.tk_set_client_rhythm('basic-test',
    '[{"key":"check_in","label":"Mine","day":5},{"key":"reports","day":15.0},{"key":"follow_up","day":25}]'::jsonb)
  = jsonb_build_object('client_id', 'basic-test', 'rhythm', pg_temp.ctx('C')::jsonb),
  'admin save returns the stored value without labels');
select pg_temp.ok((select rhythm = pg_temp.ctx('C')::jsonb from client_profile where client_id = 'basic-test'), 'admin reads the override back');
select pg_temp.expect_err($$select public.tk_set_client_rhythm('basic-test', '[{"key":"check_in","day":5},{"key":"reports","day":5},{"key":"follow_up","day":25}]')$$,
  'tk_month_rhythm_invalid: day_order', 'admin invalid days');
select pg_temp.expect_err($$select public.tk_set_client_rhythm('basic-test', '{"parts":[]}')$$,
  'tk_month_rhythm_invalid: parts_missing', 'admin object instead of array');
select pg_temp.expect_err($$select public.tk_set_client_rhythm('__no_such_client__', null)$$, 'tk_unknown_client', 'admin unknown client');
select pg_temp.expect_err($$update client_profile set rhythm = '[{"key":"check_in","day":5}]' where client_id = 'basic-test'$$,
  'tk_month_rhythm_invalid: parts_count', 'admin direct update is validated');
select pg_temp.ok((select count(*) >= 1 from client_rhythm_audit where client_id = 'basic-test'), 'admin reads the audit');
-- grace-community gets one too, for the client read check below
select public.tk_set_client_rhythm('grace-community', pg_temp.ctx('C')::jsonb);
reset role;

select pg_temp.ok((select count(*) = pg_temp.ctx('audit0')::int + 2 from client_rhythm_audit), 'two audit rows written');
select pg_temp.ok((select changed_by = pg_temp.ctx('a1') and old_value is null and new_value = pg_temp.ctx('C')::jsonb
                     from client_rhythm_audit where client_id = 'basic-test' order by id desc limit 1), 'audit row content');

-- 2. Bookkeeper with access: reads, cannot change --------------------------------
set local role authenticated;
select pg_temp.as_user(pg_temp.ctx('bk'));
select pg_temp.ok((select rhythm = pg_temp.ctx('C')::jsonb from client_profile where client_id = 'basic-test'), 'bookkeeper reads the override');
select pg_temp.expect_err($$select public.tk_set_client_rhythm('basic-test', null)$$, 'tk_forbidden', 'bookkeeper RPC clear');
select pg_temp.expect_err($$select public.tk_set_client_rhythm('basic-test', '[{"key":"check_in","day":6},{"key":"reports","day":16},{"key":"follow_up","day":26}]')$$,
  'tk_forbidden', 'bookkeeper RPC change');
select pg_temp.expect_err($$update client_profile set rhythm = '[{"key":"check_in","day":6},{"key":"reports","day":16},{"key":"follow_up","day":26}]' where client_id = 'basic-test'$$,
  'tk_forbidden', 'bookkeeper direct change');
select pg_temp.expect_err($$update client_profile set rhythm = null where client_id = 'basic-test'$$, 'tk_forbidden', 'bookkeeper direct clear');
select pg_temp.expect_err($$update client_profile set rhythm = 'null'::jsonb where client_id = 'basic-test'$$, 'tk_forbidden', 'bookkeeper direct clear (JSON null)');
select pg_temp.expect_err($$delete from client_profile where client_id = 'basic-test'$$, 'tk_forbidden', 'bookkeeper delete of a row with an override');
select pg_temp.expect_err($$insert into client_profile (client_id, rhythm) values ('basic-test', '[{"key":"check_in","day":6},{"key":"reports","day":16},{"key":"follow_up","day":26}]')
                            on conflict (client_id) do update set rhythm = excluded.rhythm$$, 'tk_forbidden', 'bookkeeper upsert');
update client_profile set updated_at = now() where client_id = 'basic-test';   -- other fields still save
select pg_temp.ok((select rhythm = pg_temp.ctx('C')::jsonb from client_profile where client_id = 'basic-test'), 'override unchanged after bookkeeper attempts');
select pg_temp.ok((select count(*) = 0 from client_rhythm_audit), 'bookkeeper cannot read the audit');
reset role;

-- 3. An admin email without a Google sign-in is not an admin here ------------------
set local role authenticated;
select pg_temp.as_user(pg_temp.ctx('a1'), false);
select pg_temp.expect_err($$select public.tk_set_client_rhythm('basic-test', null)$$, 'tk_forbidden', 'admin without Google sign-in');
reset role;

-- 4. Client user: reads nothing, writes nothing -----------------------------------
set local role authenticated;
select pg_temp.as_user(pg_temp.ctx('cm'), false);
select pg_temp.ok((select count(*) = 0 from client_profile), 'client user reads no client_profile rows');
select pg_temp.ok((select count(*) = 0 from client_rhythm_audit), 'client user reads no audit rows');
select pg_temp.expect_err($$select public.tk_set_client_rhythm('grace-community', null)$$, 'tk_forbidden', 'client user RPC');
update client_profile set rhythm = null where client_id = 'grace-community';   -- RLS: touches nothing
delete from client_profile where client_id = 'grace-community';
reset role;
select pg_temp.ok((select rhythm = pg_temp.ctx('C')::jsonb from client_profile where client_id = 'grace-community'), 'client user changed nothing');

-- 5. Anon and grants ------------------------------------------------------------------
select pg_temp.ok(not has_function_privilege('anon', 'public.tk_set_client_rhythm(text,jsonb)', 'execute'), 'anon cannot run the RPC');
select pg_temp.ok(not has_table_privilege('anon', 'public.client_profile', 'select'), 'anon cannot select client_profile');
select pg_temp.ok(not has_table_privilege('anon', 'public.client_rhythm_audit', 'select'), 'anon cannot select the audit');
select pg_temp.ok(not has_table_privilege('authenticated', 'public.client_rhythm_audit', 'insert'), 'nobody inserts audit rows directly');
select pg_temp.ok(not has_function_privilege('authenticated', 'public.tk__rhythm_for_client(text)', 'execute'), 'hook not granted');

-- 6. The resolver: client, then firm -------------------------------------------------
select pg_temp.as_user(null);
select pg_temp.ok(public.tk__rhythm_for_client('basic-test')
                  = public.tk_month_rhythm_merge(pg_temp.ctx('firm')::jsonb, pg_temp.ctx('C')::jsonb), 'hook returns the merged value');
select pg_temp.ok((public.tk__rhythm_for_client('basic-test') -> 'parts' -> 1 ->> 'day')::int = 15
                  and public.tk__rhythm_for_client('basic-test') -> 'roll' = pg_temp.ctx('firm')::jsonb -> 'roll'
                  and public.tk__rhythm_for_client('basic-test') -> 'parts' -> 1 -> 'label' = pg_temp.ctx('firm')::jsonb -> 'parts' -> 1 -> 'label',
                  'client days, firm roll and labels');
select pg_temp.ok(public.tk__rhythm_for_client('mygoodbooks') = pg_temp.ctx('firm')::jsonb, 'a client without an override gets the firm value');

-- 7. Generator: rhythm rows on the client's days, everything else byte-identical ----------
create temp table t_fp on commit drop as select id from task_templates where due_rule ->> 'type' = 'firm_part';
insert into t_ctx values ('gen_after', public.tk__generate('2026-11-03', true, 'basic-test', 40, 'selftest', null)::text);
create or replace function pg_temp.strip(p jsonb, p_fp boolean) returns text language sql as $$
  select string_agg(k || ':' || coalesce((select jsonb_agg(x order by o)::text
                                            from jsonb_array_elements(case when jsonb_typeof(p -> k) = 'array' then p -> k else '[]' end) with ordinality as a(x, o)
                                           where ((x ->> 'template')::uuid in (select id from t_fp)) = p_fp), '[]'), '|' order by k)
    from jsonb_object_keys(p) k
$$;
select pg_temp.ok(pg_temp.strip(pg_temp.ctx('gen_before')::jsonb, false) = pg_temp.strip(pg_temp.ctx('gen_after')::jsonb, false),
  'non-rhythm generator output identical');
select pg_temp.ok((pg_temp.ctx('gen_before')::jsonb - array['would_create','upcoming','skipped','missed','by_assignee','created'])
                  = (pg_temp.ctx('gen_after')::jsonb - array['would_create','upcoming','skipped','missed','by_assignee','created']),
  'generator scalars and warnings identical');
insert into t_ctx select 'n_fp', count(*)::text
  from jsonb_array_elements(coalesce(pg_temp.ctx('gen_after')::jsonb -> 'would_create', '[]') || coalesce(pg_temp.ctx('gen_after')::jsonb -> 'upcoming', '[]')) x
 where (x ->> 'template')::uuid in (select id from t_fp);
select pg_temp.ok(pg_temp.ctx('n_fp')::int > 0, 'basic-test has rhythm rows in the dry run');
select pg_temp.ok((x ->> 'due')::date = public.tk_resolve_due(t.due_rule, (x ->> 'period')::date,
                     (date_trunc('month', (x ->> 'period')::date) + interval '1 month - 1 day')::date,
                     public.tk__rhythm_for_client('basic-test')),
                  'rhythm row ' || t.source_ref || ' ' || (x ->> 'period') || ' due ' || (x ->> 'due') || ' is on the client day')
  from jsonb_array_elements(coalesce(pg_temp.ctx('gen_after')::jsonb -> 'would_create', '[]') || coalesce(pg_temp.ctx('gen_after')::jsonb -> 'upcoming', '[]')) x
  join task_templates t on t.id = (x ->> 'template')::uuid
 where t.id in (select id from t_fp);
select pg_temp.ok(pg_temp.strip(pg_temp.ctx('gen_before')::jsonb, true) <> pg_temp.strip(pg_temp.ctx('gen_after')::jsonb, true),
  'rhythm rows moved to the client days');

-- 8. The issue point uses the client's days too ------------------------------------------
select pg_temp.ok(
  (public.tk__issue_period(t, public.tk__template_eff(t, 'basic-test'), 'basic-test', '2027-01-01', true) ->> 'due')::date
    = public.tk_resolve_due(t.due_rule, '2027-01-01', '2027-01-31', public.tk__rhythm_for_client('basic-test')),
  'issue point due for ' || t.source_ref)
  from task_templates t where t.id in (select id from t_fp);

-- 9. Clear: back to the firm rhythm ------------------------------------------------------
set local role authenticated;
select pg_temp.as_user(pg_temp.ctx('a1'));
select pg_temp.ok(public.tk_set_client_rhythm('basic-test', 'null'::jsonb) ->> 'rhythm' is null, 'admin clear with JSON null');
select pg_temp.ok(public.tk_set_client_rhythm('grace-community', null) ->> 'rhythm' is null, 'admin clear with SQL null');
select pg_temp.ok((select count(*) = 0 from client_profile where rhythm is not null and client_id in ('basic-test', 'grace-community')), 'both cleared');
reset role;
select pg_temp.as_user(null);
select pg_temp.ok(public.tk__rhythm_for_client('basic-test') = pg_temp.ctx('firm')::jsonb, 'cleared client back on the firm value');
select pg_temp.ok((select count(*) = pg_temp.ctx('audit0')::int + 4 from client_rhythm_audit), 'clears audited');
select pg_temp.ok(public.tk__generate('2026-11-03', true, 'basic-test', 40, 'selftest', null)::text = pg_temp.ctx('gen_before'),
  'generator output after clear is byte-identical to before');

-- 10. Server sessions with no JWT: allowed, still validated ---------------------------------
update client_profile set rhythm = pg_temp.ctx('C')::jsonb where client_id = 'basic-test';
select pg_temp.ok((select rhythm = pg_temp.ctx('C')::jsonb from client_profile where client_id = 'basic-test'), 'server session can set');
select pg_temp.expect_err($$update client_profile set rhythm = '[{"key":"check_in","day":0},{"key":"reports","day":15},{"key":"follow_up","day":25}]' where client_id = 'basic-test'$$,
  'tk_month_rhythm_invalid: part_day', 'server session is validated');

select 'all ok';
rollback;
