-- =====================================================================
-- Self-test: gift anniversary basis (supabase/client-org-gift-basis.sql).
--
-- Covers: anon and non-admin refused on both RPCs, the default
-- (no row = client_since), saving established, bad values refused (RPC and
-- direct write), the list for each basis, the fallback to Client since for a
-- client with no known founding date ("Not sure" or blank), the digest count
-- following the basis, and the audit row.
--
-- Run it whole; it ends in ROLLBACK, so nothing it writes is kept (including
-- the tk_settings row and the test client's test_only change). Uses the test
-- clients grace-community and basic-test only inside this transaction. No
-- names or emails of real people live in this file; staff are picked at run
-- time. A failed check raises and stops the run.
-- =====================================================================
begin;

create temp table t_ctx (k text primary key, v text) on commit drop;
grant all on t_ctx to authenticated, anon, service_role;
create or replace function pg_temp.ctx(p_k text) returns text language sql as $$ select v from t_ctx where k = p_k $$;
create or replace function pg_temp.as_staff(p_email text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid(), 'email', p_email, 'role', 'authenticated',
    'app_metadata', json_build_object('provider', 'google'))::text, true);
$$;
create or replace function pg_temp.no_jwt() returns void language sql as $$
  select set_config('request.jwt.claims', '', true);
$$;
create or replace function pg_temp.ok(p_cond boolean, p_what text) returns void language plpgsql as $$
begin
  if p_cond is not true then raise exception 'SELF-TEST FAILED: %', p_what; end if;
  raise notice 'ok: %', p_what;
end $$;
create or replace function pg_temp.expect_err(p_sql text, p_err text, p_what text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if position(p_err in sqlerrm) > 0 then raise notice 'ok: % (%)', p_what, p_err; return; end if;
    raise exception 'SELF-TEST FAILED: % expected %, got %', p_what, p_err, sqlerrm;
  end;
  raise exception 'SELF-TEST FAILED: % expected %, but it succeeded', p_what, p_err;
end $$;
create or replace function pg_temp.occ(p_client text) returns text language sql as $$
  select coalesce(string_agg(occasion, ',' order by occasion), '')
  from public.admin_upcoming_anniversaries(30) where client_id = p_client;
$$;

-- Setup (migration role)
insert into t_ctx select 'ad', s.email from staff s where s.active and s.role = 'admin' order by s.email limit 1;
insert into t_ctx select 'nb', s.email from staff s where s.active and s.role <> 'admin' order by s.email limit 1;
select pg_temp.ok(pg_temp.ctx('ad') is not null and pg_temp.ctx('nb') is not null, 'found an admin and a non-admin staffer');
select pg_temp.ok(not public.tk__owner_only_key('org_gift_basis'), 'org_gift_basis is not an owner-only key');
select pg_temp.ok(not exists (select 1 from tk_settings where key = 'org_gift_basis'),
                  'no org_gift_basis row yet (the default); re-run this test before anyone saves a basis');
update clients set test_only = false where id in ('grace-community', 'basic-test');   -- rolled back
-- grace-community: client since in 5 days (3 years), founded in 10 days (20 years).
-- basic-test: client since in 6 days (2 years), founding date "Not sure".
insert into client_org_profile (client_id, client_since, established_date, established_unknown)
values ('grace-community', ((current_date + 5) - interval '3 years')::date, ((current_date + 10) - interval '20 years')::date, false),
       ('basic-test', ((current_date + 6) - interval '2 years')::date, null, true)
on conflict (client_id) do update set client_since = excluded.client_since,
  established_date = excluded.established_date, established_unknown = excluded.established_unknown;
insert into t_ctx select 'audit0', coalesce(max(id), 0)::text from tk_settings_audit;

-- 1. anon
set local role anon;
select pg_temp.no_jwt();
select pg_temp.expect_err('select public.admin_gift_basis()', 'permission denied', 'anon cannot read the basis');
select pg_temp.expect_err($q$select public.admin_set_gift_basis('established')$q$, 'permission denied', 'anon cannot set the basis');
select pg_temp.expect_err('select public.op__gift_basis()', 'permission denied', 'anon cannot call the internal reader');
reset role;

-- 2. non-admin staff
set local role authenticated;
select pg_temp.as_staff(pg_temp.ctx('nb'));
select pg_temp.expect_err('select public.admin_gift_basis()', 'not allowed', 'non-admin cannot read the basis');
select pg_temp.expect_err($q$select public.admin_set_gift_basis('established')$q$, 'not allowed', 'non-admin cannot set the basis');
select pg_temp.expect_err('select public.op__gift_basis()', 'permission denied', 'authenticated cannot call the internal reader');

-- 3. admin: default is client_since, only Client since rows
select pg_temp.as_staff(pg_temp.ctx('ad'));
select pg_temp.ok(public.admin_gift_basis() = 'client_since', 'no row: basis is client_since');
select pg_temp.ok(pg_temp.occ('grace-community') = 'client_since', 'client_since basis: grace lists Client since only');
select pg_temp.ok(pg_temp.occ('basic-test') = 'client_since', 'client_since basis: basic-test lists Client since');
select pg_temp.ok((select occasion_date = current_date + 5 and years = 3 from public.admin_upcoming_anniversaries(30)
                   where client_id = 'grace-community'), 'Client since date and years unchanged');

-- 4. bad values refused
select pg_temp.expect_err($q$select public.admin_set_gift_basis('both')$q$, 'org_gift_basis_invalid', 'RPC refuses an unknown basis');
select pg_temp.expect_err($q$select public.admin_set_gift_basis(null)$q$, 'org_gift_basis_invalid', 'RPC refuses null');
select pg_temp.expect_err($q$insert into tk_settings (key, value) values ('org_gift_basis', '"founding"'::jsonb)$q$,
                          'org_gift_basis_invalid', 'direct write of an unknown value refused');
select pg_temp.expect_err($q$insert into tk_settings (key, value) values ('org_gift_basis', 'true'::jsonb)$q$,
                          'org_gift_basis_invalid', 'direct write of a non-string refused');
select pg_temp.ok(public.admin_gift_basis() = 'client_since', 'still client_since after refused writes');

-- 5. established: founding date, with Client since as the fallback
select pg_temp.ok(public.admin_set_gift_basis('established') = 'established', 'admin saves established');
select pg_temp.ok(public.admin_gift_basis() = 'established', 'basis reads back established');
select pg_temp.ok(pg_temp.occ('grace-community') = 'established', 'established basis: grace lists the founding date only');
select pg_temp.ok((select occasion_date = current_date + 10 and years = 20 from public.admin_upcoming_anniversaries(30)
                   where client_id = 'grace-community'), 'founding date and years');
select pg_temp.ok(pg_temp.occ('basic-test') = 'client_since', 'founding date "Not sure": falls back to Client since');
reset role;
update client_org_profile set established_unknown = false, established_date = null where client_id = 'basic-test';
set local role authenticated;
select pg_temp.as_staff(pg_temp.ctx('ad'));
select pg_temp.ok(pg_temp.occ('basic-test') = 'client_since', 'blank founding date: falls back to Client since');

-- 6. digest count reads the same list (never writes org_profile_enabled)
reset role;
select pg_temp.no_jwt();
select pg_temp.ok(
  case when public.op__switch_on()
       then public.org_anniversaries_digest_count(current_date)
            = (select count(distinct client_id)::int from public.op__anniversaries(current_date, 30))
       else public.org_anniversaries_digest_count(current_date) is null end,
  'digest count matches the basis-aware list (null while the switch is off)');

-- 7. audit: the saved change is in tk_settings_audit with the admin's email
select pg_temp.ok(exists (select 1 from tk_settings_audit where id > pg_temp.ctx('audit0')::bigint
                            and key = 'org_gift_basis' and new_value = '"established"'::jsonb
                            and lower(changed_by) = lower(pg_temp.ctx('ad'))),
                  'basis change audited with the admin email');

-- 8. back to client_since restores the default list
set local role authenticated;
select pg_temp.as_staff(pg_temp.ctx('ad'));
select pg_temp.ok(public.admin_set_gift_basis('client_since') = 'client_since'
                  and pg_temp.occ('grace-community') = 'client_since', 'switching back lists Client since again');
reset role;

select 'Gift basis self-test passed';
rollback;
