-- =====================================================================
-- Self-test: client org profile + anniversary gifts
-- (supabase/client-org-profile.sql, spec docs/client-org-profile-spec.md
-- section 9.16).
--
-- Covers: anon, a scoped user, an inactive user, a staff JWT, another org's
-- client_id in the payload, oversized and unknown keys, field validation,
-- write-only get-to-know (client never sees answers; temp-grant-only staff
-- don't either), client_since (clients can't set it; staff can), the
-- admin-only gift list and gift stamping trigger, Feb 29, the service-role
-- digest count (follows the firm switch), the default gift basis, and audit_log never holding
-- answer text or field values.
--
-- Run it whole; it ends in ROLLBACK, so nothing it writes is kept. It uses
-- the test clients grace-community (active full-access user) and basic-test
-- (inactive user) and a throwaway scoped user, only inside this
-- transaction. It never writes tk_settings. No names or emails of real
-- people live in this file; staff are picked at run time.
-- A failed check raises and stops the run.
-- =====================================================================
begin;

create temp table t_ctx (k text primary key, v text) on commit drop;
grant all on t_ctx to authenticated, anon, service_role;

create or replace function pg_temp.ctx(p_k text) returns text language sql as $$ select v from t_ctx where k = p_k $$;
-- Staff JWT (Google provider, like a real staff sign-in).
create or replace function pg_temp.as_staff(p_email text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid(), 'email', p_email, 'role', 'authenticated',
    'app_metadata', json_build_object('provider', 'google'))::text, true);
$$;
-- Client JWT (email provider).
create or replace function pg_temp.as_client(p_email text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid(), 'email', p_email, 'role', 'authenticated',
    'app_metadata', json_build_object('provider', 'email'))::text, true);
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
create or replace function pg_temp.cnt(p_sql text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute 'select count(*) from (' || p_sql || ') q' into n;
  return n;
end $$;
-- A complete, valid payload (dates relative to today).
create or replace function pg_temp.full_payload() returns jsonb language sql as $$
  select jsonb_build_object(
    'card_name', 'OP Selftest Church',
    'org_type', 'Church',
    'established_date', to_char((current_date + 10 - interval '20 years')::date, 'YYYY-MM-DD'),
    'established_unknown', false,
    'gift_same_as_org', false,
    'gift_address', '1 Test Way, Testville, TN 37000',
    'receiver_name', 'Front Desk',
    'courier_phone', '(615) 555-0100 x12',
    'contact_name', 'OP Contact',
    'contact_email', 'OP.Contact@Example.invalid',
    'contact_phone', '+1 615 555 0101',
    'fiscal_year_end', '12-31');
$$;

-- ---------------------------------------------------------------------
-- Setup (as the migration role)
-- ---------------------------------------------------------------------
-- The firm switch was off while built hidden and has been on since 2026-10-25.
-- Checks that depend on it read it once here and expect the matching result.
insert into t_ctx select 'sw', case when public.op__switch_on() then 'on' else 'off' end;
select pg_temp.ok(pg_temp.ctx('sw') in ('on', 'off'), 'firm switch org_profile_enabled read (' || pg_temp.ctx('sw') || ')');
select pg_temp.ok(public.tk__owner_only_key('org_profile_enabled')
                  and public.tk__owner_only_key('hovernav_enabled') and public.tk__owner_only_key('wb_enabled'),
                  'org_profile_enabled is owner-only and older keys are kept');

insert into t_ctx select 'gu', lower(email) from client_users where client_id = 'grace-community' and active and coalesce(access, 'full') = 'full' order by email limit 1;
insert into t_ctx select 'iu', lower(email) from client_users where client_id = 'basic-test' and not active order by email limit 1;
insert into t_ctx select 'ad', s.email from staff s where s.active and s.role = 'admin' order by s.email limit 1;
insert into t_ctx select 'nb', s.email from staff s
  join clients c on c.id = 'grace-community'
 where s.active and s.role <> 'admin'
   and lower(s.email) not in (lower(coalesce(c.assigned_bookkeeper_email, '')), lower(coalesce(c.account_manager_email, '')))
   and not exists (select 1 from staff_client_access sca where sca.client_id = 'grace-community' and lower(sca.staff_email) = lower(s.email))
   and not exists (select 1 from staff_client_access_grants g where g.client_id = 'grace-community' and lower(g.staff_email) = lower(s.email) and g.status in ('approved', 'pending'))
 order by s.email limit 1;
select pg_temp.ok(pg_temp.ctx('gu') is not null and pg_temp.ctx('iu') is not null
                  and pg_temp.ctx('ad') is not null and pg_temp.ctx('nb') is not null,
                  'found a full-access client user, an inactive client user, an admin and a non-admin staffer without access');
insert into client_users (email, client_id, name, role, active, access)
values ('op-selftest-scoped@example.invalid', 'grace-community', 'OP Scoped', 'Team member', true, 'scoped');
select pg_temp.ok(not exists (select 1 from client_org_profile where client_id in ('grace-community', 'basic-test')),
                  'no profile rows for the test clients to start');
insert into t_ctx select 'audit0', coalesce(max(id), 0)::text from audit_log;

-- ---------------------------------------------------------------------
-- 1. anon: no table or RPC access at all
-- ---------------------------------------------------------------------
select pg_temp.no_jwt();
set local role anon;
select pg_temp.expect_err('select public.client_org_profile_mine()', 'permission denied', 'anon cannot call mine()');
select pg_temp.expect_err($q$select public.client_org_profile_save('{}'::jsonb)$q$, 'permission denied', 'anon cannot call save()');
select pg_temp.expect_err('select public.admin_upcoming_anniversaries(30)', 'permission denied', 'anon cannot list anniversaries');
select pg_temp.expect_err('select public.org_anniversaries_digest_count(current_date)', 'permission denied', 'anon cannot call digest count');
select pg_temp.expect_err('select 1 from public.client_org_profile', 'permission denied', 'anon cannot read client_org_profile');
select pg_temp.expect_err('select 1 from public.client_get_to_know', 'permission denied', 'anon cannot read client_get_to_know');
select pg_temp.expect_err('select 1 from public.client_gifts', 'permission denied', 'anon cannot read client_gifts');
reset role;

set local role authenticated;

-- ---------------------------------------------------------------------
-- 2. Ineligible callers: scoped, inactive, staff JWT, unknown email
-- ---------------------------------------------------------------------
select pg_temp.as_client('op-selftest-scoped@example.invalid');
select pg_temp.ok(public.client_org_profile_mine() = '{"eligible": false}'::jsonb, 'scoped user: mine() is {eligible:false} only');
select pg_temp.expect_err('select public.client_org_profile_save(pg_temp.full_payload())', 'not allowed', 'scoped user cannot save');

select pg_temp.as_client(pg_temp.ctx('iu'));
select pg_temp.ok(public.client_org_profile_mine() = '{"eligible": false}'::jsonb, 'inactive user: mine() is {eligible:false} only');
select pg_temp.expect_err('select public.client_org_profile_save(pg_temp.full_payload())', 'not allowed', 'inactive user cannot save');

select pg_temp.as_client('op-nobody@example.invalid');
select pg_temp.ok(public.client_org_profile_mine() = '{"eligible": false}'::jsonb, 'no client_users row: {eligible:false}, no exception');

select pg_temp.as_staff(pg_temp.ctx('ad'));
select pg_temp.ok(public.client_org_profile_mine() = '{"eligible": false}'::jsonb, 'staff JWT: mine() is {eligible:false}');
select pg_temp.expect_err('select public.client_org_profile_save(pg_temp.full_payload())', 'not allowed', 'staff JWT cannot save');
select pg_temp.expect_err('select public.org_anniversaries_digest_count(current_date)', 'permission denied', 'authenticated (even admin) cannot call digest count');

-- ---------------------------------------------------------------------
-- 3. Full-access client: mine() whitelist
-- ---------------------------------------------------------------------
select pg_temp.as_client(pg_temp.ctx('gu'));
select pg_temp.ok((public.client_org_profile_mine() ->> 'eligible')::boolean, 'full-access user is eligible');
select pg_temp.ok((public.client_org_profile_mine() ->> 'enabled')::boolean = (pg_temp.ctx('sw') = 'on'), 'enabled follows the firm switch');
select pg_temp.ok(public.client_org_profile_mine() -> 'profile' = 'null'::jsonb, 'no profile yet');
select pg_temp.ok((public.client_org_profile_mine() -> 'prefill') - array['name', 'entity_type', 'org_type', 'org_address',
                  'fiscal_year_end', 'user_name', 'user_email'] = '{}'::jsonb, 'prefill has whitelisted keys only');
select pg_temp.ok(position('launch_date' in public.client_org_profile_mine()::text) = 0
                  and position('target_hourly_rate' in public.client_org_profile_mine()::text) = 0,
                  'mine() never carries launch_date or rates');
select pg_temp.ok(pg_temp.cnt('select 1 from client_org_profile') = 0 and pg_temp.cnt('select 1 from client_get_to_know') = 0
                  and pg_temp.cnt('select 1 from client_gifts') = 0,
                  'client cannot read any of the three tables directly (RLS)');

-- ---------------------------------------------------------------------
-- 4. Payload shape + validation (errors name the field, never the value)
-- ---------------------------------------------------------------------
select pg_temp.expect_err($q$select public.client_org_profile_save('[]'::jsonb)$q$, 'payload must be an object', 'array payload rejected');
select pg_temp.expect_err($q$select public.client_org_profile_save('"x"'::jsonb)$q$, 'payload must be an object', 'string payload rejected');
select pg_temp.expect_err($q$select public.client_org_profile_save(jsonb_build_object('junk', repeat('x', 17000)))$q$,
                          'payload is too large', 'payload over 16 KB rejected');
do $$
begin
  perform public.client_org_profile_save(pg_temp.full_payload() || jsonb_build_object('card_name', 'OPVALUE' || repeat('z', 200)));
  raise exception 'SELF-TEST FAILED: long card_name accepted';
exception when others then
  if sqlerrm like 'SELF-TEST FAILED%' then raise; end if;
  perform pg_temp.ok(sqlerrm like 'card_name is too long%' and position('OPVALUE' in sqlerrm) = 0 and sqlstate = '22023',
                     'card_name over 200 rejected; message names the field, not the value');
end $$;
select pg_temp.expect_err($q$select public.client_org_profile_save(pg_temp.full_payload() || '{"card_name": 5}')$q$, 'card_name must be text', 'non-text card_name rejected');
select pg_temp.expect_err($q$select public.client_org_profile_save(pg_temp.full_payload() || '{"established_date": "2023-02-30"}')$q$, 'established_date must be a date', 'impossible date rejected (22023, not a cast crash)');
select pg_temp.expect_err($q$select public.client_org_profile_save(pg_temp.full_payload() || '{"established_date": "today"}')$q$, 'established_date must be a date', 'date keyword rejected');
select pg_temp.expect_err($q$select public.client_org_profile_save(pg_temp.full_payload() || '{"established_date": "1700-01-01"}')$q$, 'between 1800-01-01 and today', 'established before 1800 rejected');
select pg_temp.expect_err(format('select public.client_org_profile_save(pg_temp.full_payload() || %L::jsonb)',
                          jsonb_build_object('established_date', to_char(current_date + 1, 'YYYY-MM-DD'))),
                          'between 1800-01-01 and today', 'established in the future rejected');
select pg_temp.expect_err($q$select public.client_org_profile_save(pg_temp.full_payload() || '{"fiscal_year_end": "02-30"}')$q$, 'fiscal_year_end must be a real month and day', 'fiscal year end 02-30 rejected');
select pg_temp.expect_err($q$select public.client_org_profile_save(pg_temp.full_payload() || '{"fiscal_year_end": "13-01"}')$q$, 'fiscal_year_end must be a real month and day', 'fiscal year end 13-01 rejected');
select pg_temp.expect_err($q$select public.client_org_profile_save(pg_temp.full_payload() || '{"fiscal_year_end": "12/31"}')$q$, 'fiscal_year_end must be MM-DD', 'fiscal year end format checked');
select pg_temp.expect_err($q$select public.client_org_profile_save(pg_temp.full_payload() || '{"courier_phone": "call me"}')$q$, 'courier_phone has characters', 'phone with letters rejected');
select pg_temp.expect_err($q$select public.client_org_profile_save(pg_temp.full_payload() || '{"contact_email": "nope"}')$q$, 'contact_email is not a valid email', 'bad email rejected');
select pg_temp.expect_err($q$select public.client_org_profile_save(pg_temp.full_payload() || '{"established_unknown": "yes"}')$q$, 'established_unknown must be true or false', 'non-boolean flag rejected');
select pg_temp.expect_err($q$select public.client_org_profile_save(pg_temp.full_payload() || '{"gift_same_as_org": true}')$q$, 'organization address is empty', 'same-as-org refused when the org address is empty');
select pg_temp.expect_err(format('select public.client_org_profile_save(pg_temp.full_payload() || %L::jsonb)',
                          jsonb_build_object('get_to_know', jsonb_build_object('hobbies', repeat('h', 301)))),
                          'get_to_know.hobbies is too long', 'get-to-know answer over 300 rejected');
select pg_temp.expect_err($q$select public.client_org_profile_save(pg_temp.full_payload() || '{"get_to_know": "x"}')$q$, 'get_to_know must be an object', 'get-to-know must be an object');
select pg_temp.ok(pg_temp.cnt($$select 1 from public.client_org_profile_mine() m where m -> 'profile' <> 'null'::jsonb$$) = 0,
                  'nothing was saved by the refused calls');

-- 02-29 is a valid fiscal year end.
select pg_temp.ok((public.client_org_profile_save(pg_temp.full_payload() || '{"fiscal_year_end": "02-29"}') -> 'profile' ->> 'fiscal_year_end') = '02-29',
                  'fiscal year end 02-29 accepted');

-- ---------------------------------------------------------------------
-- 5. Another org's client_id, unknown keys, client_since, get-to-know
-- ---------------------------------------------------------------------
select pg_temp.ok((public.client_org_profile_save(pg_temp.full_payload() || jsonb_build_object(
    'client_id', 'basic-test',
    'client_since', '2000-01-01', 'client_since_set_by', 'evil@example.invalid',
    'completed_by', 'evil@example.invalid', 'completed_at', '2000-01-01',
    'zzz_unknown', 'ignored',
    'get_to_know', jsonb_build_object(
      'favorite_treat', '  OPSECRET-treat  ', 'coffee_or_tea', 'OPSECRET-coffee', 'allergies', '',
      'hobbies', 'OPSECRET-hobby', 'team_note', 'OPSECRET-team', 'zzz_extra', 'OPSECRET-extra')))
  ->> 'complete')::boolean, 'complete save returns complete = true');

reset role;
select pg_temp.no_jwt();
select pg_temp.ok(not exists (select 1 from client_org_profile where client_id = 'basic-test')
                  and not exists (select 1 from client_get_to_know where client_id = 'basic-test'),
                  'payload client_id ignored: nothing written for another org');
select pg_temp.ok((select client_since is null and client_since_set_by is null and completed_by = pg_temp.ctx('gu')
                          and completed_at > now() - interval '1 minute' and contact_email = 'op.contact@example.invalid'
                   from client_org_profile where client_id = 'grace-community'),
                  'client cannot set client_since or completed_*; server stamps completion; email lowercased');
select pg_temp.ok((select answers = '{"favorite_treat": "OPSECRET-treat", "coffee_or_tea": "OPSECRET-coffee", "hobbies": "OPSECRET-hobby", "team_note": "OPSECRET-team"}'::jsonb
                   from client_get_to_know where client_id = 'grace-community'),
                  'get-to-know: 5 known keys only, trimmed, empty dropped, unknown key ignored');
set local role authenticated;
select pg_temp.as_client(pg_temp.ctx('gu'));
select pg_temp.ok(position('OPSECRET' in public.client_org_profile_mine()::text) = 0
                  and (public.client_org_profile_mine() ->> 'has_get_to_know')::boolean,
                  'client never gets answers back, only has_get_to_know = true');
select pg_temp.ok(not (public.client_org_profile_mine() -> 'profile' ?| array['client_since', 'client_since_set_by', 'completed_by', 'updated_by', 'client_id']),
                  'profile omits client_since and staff emails');

-- Partial save clears completion; get-to-know not supplied stays as is.
select pg_temp.ok(not (public.client_org_profile_save(pg_temp.full_payload() - 'receiver_name') ->> 'complete')::boolean,
                  'partial save allowed and marks incomplete');
-- "Not sure" counts for the established date.
select pg_temp.ok((public.client_org_profile_save(pg_temp.full_payload() || '{"established_unknown": true}') ->> 'complete')::boolean,
                  'established "Not sure" satisfies the required date');
select pg_temp.ok((public.client_org_profile_save(pg_temp.full_payload()) ->> 'complete')::boolean, 'complete again');
select pg_temp.ok((public.client_org_profile_save(pg_temp.full_payload() || '{"contact_email": null}') ->> 'complete')::boolean,
                  'main contact with phone only still complete');

reset role;
select pg_temp.no_jwt();
select pg_temp.ok((select answers ? 'hobbies' from client_get_to_know where client_id = 'grace-community'),
                  'saves without get_to_know leave the answers alone');

-- ---------------------------------------------------------------------
-- 6. Staff card, client_since, temp-grant-only staff and get-to-know
-- ---------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_staff(pg_temp.ctx('nb'));
select pg_temp.expect_err($q$select public.staff_client_org_profile('grace-community')$q$, 'not allowed', 'staff without access cannot read the card');
select pg_temp.expect_err($q$select public.staff_set_client_since('grace-community', current_date)$q$, 'not allowed', 'staff without access cannot set client since');
select pg_temp.expect_err('select public.admin_upcoming_anniversaries(30)', 'not allowed', 'non-admin cannot list anniversaries');
select pg_temp.ok(pg_temp.cnt('select 1 from client_org_profile') = 0, 'staff without access read no profile rows');
reset role;
insert into staff_client_access_grants (client_id, staff_email, staff_name, reason, duration_days, status, decided_by, decided_at, expires_at)
values ('grace-community', pg_temp.ctx('nb'), 'OP test', 'OP self-test temp grant', 1, 'approved', pg_temp.ctx('ad'), now(), now() + interval '1 day');
set local role authenticated;
select pg_temp.as_staff(pg_temp.ctx('nb'));
select pg_temp.ok(public.can_access_client('grace-community'), 'temp grant gives client access');
select pg_temp.ok((select (j ->> 'complete')::boolean and (j ->> 'has_get_to_know')::boolean
                          and not (j ->> 'can_see_get_to_know')::boolean and j -> 'get_to_know' = 'null'::jsonb
                          and position('OPSECRET' in j::text) = 0
                   from public.staff_client_org_profile('grace-community') j),
                  'temp-grant-only staff see the profile but not the get-to-know answers');
select pg_temp.ok(pg_temp.cnt($$select 1 from client_org_profile where client_id = 'grace-community'$$) = 1
                  and pg_temp.cnt($$select 1 from client_get_to_know where client_id = 'grace-community'$$) = 0,
                  'RLS: temp-grant-only staff read the profile row but no get-to-know row');

select pg_temp.as_staff(pg_temp.ctx('ad'));
select pg_temp.ok((select (j ->> 'can_see_get_to_know')::boolean and j -> 'get_to_know' ->> 'hobbies' = 'OPSECRET-hobby'
                   from public.staff_client_org_profile('grace-community') j),
                  'admin sees the get-to-know answers on the card');
select pg_temp.ok(pg_temp.cnt($$select 1 from client_get_to_know where client_id = 'grace-community'$$) = 1, 'RLS: admin reads the get-to-know row');
select pg_temp.expect_err($q$select public.staff_set_client_since('grace-community', current_date + 1)$q$, 'between 1900-01-01 and today', 'future client since rejected');
select pg_temp.expect_err($q$select public.staff_set_client_since('grace-community', date '1899-12-31')$q$, 'between 1900-01-01 and today', 'client since before 1900 rejected');
select pg_temp.expect_err($q$select public.staff_set_client_since('op-no-such-client', current_date)$q$, 'unknown client', 'unknown client rejected');
insert into t_ctx values ('since', ((current_date + 5) - interval '3 years')::date::text);
select pg_temp.ok((select j ->> 'client_since' = pg_temp.ctx('since') and j ->> 'client_since_source' = 'staff'
                          and j ->> 'client_since_set_by' = pg_temp.ctx('ad')
                   from public.staff_set_client_since('grace-community', pg_temp.ctx('since')::date) j),
                  'admin sets client since; source = staff');
select pg_temp.as_client(pg_temp.ctx('gu'));
select pg_temp.ok((public.client_org_profile_save(pg_temp.full_payload()) ->> 'complete')::boolean, 'client re-save after staff set');
reset role;
select pg_temp.no_jwt();
select pg_temp.ok((select client_since = pg_temp.ctx('since')::date from client_org_profile where client_id = 'grace-community'),
                  'client save never touches client_since');
set local role authenticated;

-- ---------------------------------------------------------------------
-- 7. Anniversaries (admin only, test clients excluded) + gifts
-- ---------------------------------------------------------------------
select pg_temp.as_staff(pg_temp.ctx('ad'));
select pg_temp.ok(pg_temp.cnt($$select 1 from public.admin_upcoming_anniversaries(30) where client_id = 'grace-community'$$) = 0,
                  'test_only client excluded from anniversaries');
select pg_temp.ok(pg_temp.cnt('select 1 from public.admin_upcoming_anniversaries(100000)') >= 0
                  and pg_temp.cnt('select 1 from public.admin_upcoming_anniversaries(null)') >= 0
                  and pg_temp.cnt('select 1 from public.admin_upcoming_anniversaries(-5)') >= 0,
                  'days are clamped (huge, null, negative all run)');
reset role;
update clients set test_only = false where id = 'grace-community';   -- rolled back at the end
set local role authenticated;
select pg_temp.as_staff(pg_temp.ctx('ad'));
select pg_temp.ok((select occasion_date = (current_date + 5) and years = 3 and profile_complete and has_get_to_know and gift_id is null
                   from public.admin_upcoming_anniversaries(30) where client_id = 'grace-community' and occasion = 'client_since'),
                  'client_since anniversary listed in 5 days, 3 years, flags set, no gift yet');
-- Gift basis (client-org-gift-basis.sql): the default lists Client since only.
-- The founding-date basis is covered by client-org-gift-basis-tests.sql.
select pg_temp.ok(public.admin_gift_basis() <> 'client_since'
                  or pg_temp.cnt($$select 1 from public.admin_upcoming_anniversaries(30) where client_id = 'grace-community' and occasion = 'established'$$) = 0,
                  'default basis (Client since) does not list the founding date');
select pg_temp.ok(pg_temp.cnt($$select 1 from public.admin_upcoming_anniversaries(7) where client_id = 'grace-community'$$) = 1,
                  'p_days window respected (7 days: only the client_since one)');
select pg_temp.ok(position('OPSECRET' in (select coalesce(string_agg(t::text, ''), '') from public.admin_upcoming_anniversaries(30) t)) = 0,
                  'anniversary rows carry presence flags only');

insert into client_gifts (client_id, occasion, occasion_year, occasion_date, status, item, amount, notes, planned_by)
values ('grace-community', 'client_since', extract(year from current_date + 5)::int, current_date + 5, 'planned',
        'Cookie tin', 38.50, 'OP test', 'evil@example.invalid');
select pg_temp.ok((select planned_by = pg_temp.ctx('ad') and sent_at is null and sent_by is null
                   from client_gifts where client_id = 'grace-community' and occasion = 'client_since'),
                  'gift insert stamps planned_by from the JWT (ignores the payload)');
select pg_temp.expect_err(format($q$insert into client_gifts (client_id, occasion, occasion_year, occasion_date) values ('grace-community', 'client_since', %s, %L)$q$,
                          extract(year from current_date + 5)::int, current_date + 5),
                          'client_gifts_one_per_occasion', 'a second gift for the same occasion and year is refused');
select pg_temp.expect_err($q$insert into client_gifts (client_id, occasion, occasion_year, occasion_date, amount) values ('grace-community', 'established', 2000, '2000-01-01', 501)$q$,
                          'check constraint', 'gift amount over 500 refused');
update client_gifts set status = 'sent', sent_by = 'evil@example.invalid', sent_at = '2000-01-01'
 where client_id = 'grace-community' and occasion = 'client_since';
select pg_temp.ok((select status = 'sent' and sent_by = pg_temp.ctx('ad') and sent_at > now() - interval '1 minute'
                          and planned_by = pg_temp.ctx('ad')
                   from client_gifts where client_id = 'grace-community' and occasion = 'client_since'),
                  'mark sent stamps sent_by and sent_at from the JWT');
select pg_temp.ok((select gift_status = 'sent' and gift_item = 'Cookie tin' and gift_amount = 38.50
                   from public.admin_upcoming_anniversaries(30) where client_id = 'grace-community' and occasion = 'client_since'),
                  'anniversary row shows the matched gift');

select pg_temp.as_staff(pg_temp.ctx('nb'));
select pg_temp.ok(pg_temp.cnt('select 1 from client_gifts') = 0, 'non-admin staff read no gifts (RLS)');
select pg_temp.expect_err($q$insert into client_gifts (client_id, occasion, occasion_year, occasion_date) values ('grace-community', 'established', 2000, '2000-01-01')$q$,
                          'row-level security', 'non-admin staff cannot plan a gift');
select pg_temp.as_client(pg_temp.ctx('gu'));
select pg_temp.expect_err('select public.admin_upcoming_anniversaries(30)', 'not allowed', 'client cannot list anniversaries');

-- ---------------------------------------------------------------------
-- 8. Feb 29 (make_interval, never make_date)
-- ---------------------------------------------------------------------
reset role;
select pg_temp.no_jwt();
select pg_temp.ok((select occ = date '2027-02-28' and years = 3 from public.op__next_occurrence(date '2024-02-29', date '2027-01-01')),
                  'Feb 29 lands on Feb 28 in a common year');
select pg_temp.ok((select occ = date '2028-02-29' and years = 4 from public.op__next_occurrence(date '2024-02-29', date '2028-01-01')),
                  'Feb 29 stays Feb 29 in a leap year');
select pg_temp.ok((select occ = date '2028-02-29' and years = 4 from public.op__next_occurrence(date '2024-02-29', date '2027-03-01')),
                  'after Feb 28 has passed, the next one is the leap-day one');
select pg_temp.ok((select occ = date '2026-10-23' and years = 10 from public.op__next_occurrence(date '2016-10-23', date '2026-10-23')),
                  'an anniversary today counts as today');

-- ---------------------------------------------------------------------
-- 9. Digest count: service_role only; null while the switch is off
-- ---------------------------------------------------------------------
set local role service_role;
select pg_temp.ok(case when pg_temp.ctx('sw') = 'on'
                       then public.org_anniversaries_digest_count(current_date) >= 1
                       else public.org_anniversaries_digest_count(current_date) is null end,
                  'digest count follows the switch (null while off, counts the upcoming client while on)');
reset role;
select pg_temp.ok((select count(distinct client_id) >= 1 from public.op__anniversaries(current_date, 30)),
                  'the count source sees the upcoming client (what the digest would count with the switch on)');

-- ---------------------------------------------------------------------
-- 10. Audit: field names only, never answers or values
-- ---------------------------------------------------------------------
select pg_temp.ok(exists (select 1 from audit_log where id > pg_temp.ctx('audit0')::bigint
                            and action = 'client.org_profile_updated' and client_id = 'grace-community'
                            and details ? 'changed' and details ? 'completed' and details ? 'gtk_replaced'),
                  'save writes client.org_profile_updated with changed/completed/gtk_replaced');
select pg_temp.ok((select bool_and((details - array['changed', 'completed', 'gtk_replaced']) = '{}'::jsonb)
                   from audit_log where id > pg_temp.ctx('audit0')::bigint and action = 'client.org_profile_updated'),
                  'org profile audit has no other keys');
select pg_temp.ok(not exists (select 1 from audit_log where id > pg_temp.ctx('audit0')::bigint
                                and (details::text like '%OPSECRET%' or details::text like '%OP Selftest Church%'
                                     or details::text like '%Test Way%' or details::text like '%Front Desk%'
                                     or details::text like '%OP Contact%')),
                  'audit_log never contains answer text or field values');
select pg_temp.ok(exists (select 1 from audit_log where id > pg_temp.ctx('audit0')::bigint
                            and action = 'client.since_set' and client_id = 'grace-community'
                            and details ->> 'to' = pg_temp.ctx('since')),
                  'staff_set_client_since writes client.since_set with from/to');

-- ---------------------------------------------------------------------
-- 11. Structure: no realtime, no triggers on get-to-know
-- ---------------------------------------------------------------------
select pg_temp.ok(not exists (select 1 from pg_publication_tables
                                where schemaname = 'public' and tablename in ('client_org_profile', 'client_get_to_know', 'client_gifts')),
                  'none of the three tables is in a realtime publication');
select pg_temp.ok(not exists (select 1 from pg_trigger where tgrelid = 'public.client_get_to_know'::regclass and not tgisinternal),
                  'client_get_to_know has no triggers');

select 'Client org profile self-test passed';
rollback;
