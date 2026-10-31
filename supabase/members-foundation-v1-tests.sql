-- Members foundation v1: RLS and trigger tests. NOT a migration.
-- Run after members-foundation-v1.sql, as postgres (SQL editor or MCP).
-- Everything is one DO block that ALWAYS ends by raising an exception, so
-- every fixture rolls back. Read the result from the error text:
--   'members-foundation tests PASSED n/n'  or  '... FAILED: <list>'.
-- Fixtures are @example.test addresses (rolled-back auth.users rows and the basic-test client) only. No real
-- customer data is read or written. Role simulation: set local role
-- authenticated / anon plus request.jwt.claims, as the portal's other tests do.

do $$
declare
  c_client text := 'mf-client@example.test';
  c_course text := 'mf-course@example.test';
  c_kit    text := 'mf-kit@example.test';
  c_unc    text := 'mf-unconfirmed@example.test';
  u_client uuid := gen_random_uuid();
  u_course uuid := gen_random_uuid();
  u_kit    uuid := gen_random_uuid();
  u_unc    uuid := gen_random_uuid();
  fails text[] := '{}';
  total int := 0;
  n int;
  s text;
  procedure_ok boolean;
begin
  -- fixtures (as postgres). Test auth users exist only inside this block,
  -- which always rolls back; no email is sent and nothing persists.
  insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at) values
    ('00000000-0000-0000-0000-000000000000', u_client, 'authenticated', 'authenticated', c_client, now(), now(), now()),
    ('00000000-0000-0000-0000-000000000000', u_course, 'authenticated', 'authenticated', c_course, now(), now(), now()),
    ('00000000-0000-0000-0000-000000000000', u_kit,    'authenticated', 'authenticated', c_kit,    now(), now(), now()),
    ('00000000-0000-0000-0000-000000000000', u_unc,    'authenticated', 'authenticated', c_unc,    null,  now(), now());
  insert into public.client_users (email, client_id, name, role, active, access)
  values (c_client, 'basic-test', 'MF test client', 'member', true, 'full')
  on conflict (email) do nothing;
  insert into public.member_access (email, member_id, access, source, is_test) values
    (c_course, u_course, 'course', 'manual', true),
    (c_kit, null, 'kit', 'manual', true),
    (c_unc, null, 'kit', 'manual', true);
  insert into public.member_profiles (member_id, email, is_test) values (u_course, c_course, true);
  insert into public.member_purchases (email, member_id, product, amount_cents, status, is_test) values
    (c_course, u_course, 'course', 9900, 'paid', true),
    (c_kit, null, 'kit', 7900, 'paid', true);

  -- T1 trigger: active roster row created a client row
  total := total + 1;
  select count(*) into n from public.member_access where email = c_client and access = 'client' and source = 'client_roster';
  if n <> 1 then fails := fails || 'T1 roster insert -> client row'; end if;
  if not exists (select 1 from public.member_access where email = c_client and member_id = u_client) then
    fails := fails || 'T1b trigger did not link member_id for a confirmed user';
  end if;

  -- T2-T4 each test member reads only their own access rows
  total := total + 1;
  perform set_config('request.jwt.claims', json_build_object('email', c_client, 'role', 'authenticated', 'sub', u_client)::text, true);
  set local role authenticated;
  select string_agg(access, ',' order by access) into s from public.member_access;
  reset role;
  if s is distinct from 'client' then fails := fails || ('T2 client sees ' || coalesce(s, 'nothing')); end if;

  total := total + 1;
  perform set_config('request.jwt.claims', json_build_object('email', c_course, 'role', 'authenticated', 'sub', u_course)::text, true);
  set local role authenticated;
  select string_agg(access, ',' order by access) into s from public.member_access;
  reset role;
  if s is distinct from 'course' then fails := fails || ('T3 course sees ' || coalesce(s, 'nothing')); end if;

  total := total + 1;
  perform set_config('request.jwt.claims', json_build_object('email', upper(c_kit), 'role', 'authenticated', 'sub', u_kit)::text, true);
  set local role authenticated;
  select string_agg(access, ',' order by access) into s from public.member_access;
  reset role;
  if s is distinct from 'kit' then fails := fails || ('T4 kit (upper-case JWT email) sees ' || coalesce(s, 'nothing')); end if;

  -- T5 purchases and profiles: kit member cannot read the course member's rows
  total := total + 1;
  perform set_config('request.jwt.claims', json_build_object('email', c_kit, 'role', 'authenticated', 'sub', u_kit)::text, true);
  set local role authenticated;
  select count(*) into n from public.member_purchases where email <> c_kit;
  select n + count(*) into n from public.member_profiles;
  reset role;
  if n <> 0 then fails := fails || 'T5 kit member read another member''s purchases/profile'; end if;

  -- T6 course member reads own purchase and profile
  total := total + 1;
  perform set_config('request.jwt.claims', json_build_object('email', c_course, 'role', 'authenticated', 'sub', u_course)::text, true);
  set local role authenticated;
  select count(*) into n from public.member_purchases;
  select n + count(*) into n from public.member_profiles;
  reset role;
  if n <> 2 then fails := fails || ('T6 course member own rows = ' || n); end if;

  -- T7 no client-side writes: insert, update, delete all refused
  total := total + 1;
  perform set_config('request.jwt.claims', json_build_object('email', c_course, 'role', 'authenticated', 'sub', u_course)::text, true);
  procedure_ok := true;
  begin
    set local role authenticated;
    insert into public.member_access (email, access, source) values (c_course, 'kit', 'manual');
    procedure_ok := false;
  exception when insufficient_privilege then null; end;
  reset role;
  begin
    set local role authenticated;
    update public.member_access set expires_at = now() where email = c_course;
    procedure_ok := false;
  exception when insufficient_privilege then null; end;
  reset role;
  begin
    set local role authenticated;
    delete from public.member_purchases where email = c_course;
    procedure_ok := false;
  exception when insufficient_privilege then null; end;
  reset role;
  begin
    set local role authenticated;
    insert into public.member_profiles (member_id, email) values (gen_random_uuid(), 'x@example.test');
    procedure_ok := false;
  exception when insufficient_privilege then null; end;
  reset role;
  if not procedure_ok then fails := fails || 'T7 a client-side write was allowed'; end if;

  -- T8 anon reads nothing
  total := total + 1;
  perform set_config('request.jwt.claims', '', true);
  begin
    set local role anon;
    select count(*) into n from public.member_access;
    fails := fails || 'T8 anon could select member_access';
  exception when insufficient_privilege then null; end;
  reset role;

  -- T9 the trigger function cannot be called by a signed-in user
  total := total + 1;
  if has_function_privilege('authenticated', 'public.member_access_sync_client_roster()', 'execute')
     or has_function_privilege('anon', 'public.member_access_sync_client_roster()', 'execute') then
    fails := fails || 'T9 trigger function executable by anon/authenticated';
  end if;

  -- T10 deactivate removes only the roster client row; a manual row survives
  total := total + 1;
  insert into public.member_access (email, access, source, is_test) values (c_client, 'kit', 'manual', true);
  update public.client_users set active = false where email = c_client;
  select string_agg(access || '/' || source, ',') into s from public.member_access where email = c_client;
  if s is distinct from 'kit/manual' then fails := fails || ('T10 after deactivate: ' || coalesce(s, 'nothing')); end if;

  -- T11 client now sees no client row through RLS
  total := total + 1;
  perform set_config('request.jwt.claims', json_build_object('email', c_client, 'role', 'authenticated', 'sub', u_client)::text, true);
  set local role authenticated;
  select count(*) into n from public.member_access where access = 'client';
  reset role;
  if n <> 0 then fails := fails || 'T11 client row still visible after deactivate'; end if;

  -- T12 reactivate restores it; delete removes it
  total := total + 1;
  update public.client_users set active = true where email = c_client;
  select count(*) into n from public.member_access where email = c_client and access = 'client';
  delete from public.client_users where email = c_client;
  select n * 10 + count(*) into n from public.member_access where email = c_client and access = 'client';
  if n <> 10 then fails := fails || ('T12 reactivate/delete code ' || n); end if;

  -- T13 the members bucket is private with no storage policies
  total := total + 1;
  if exists (select 1 from storage.buckets where id = 'members' and public)
     or exists (select 1 from pg_policies where schemaname = 'storage'
                and (coalesce(qual, '') || coalesce(with_check, '')) like '%''members''%') then
    fails := fails || 'T13 members bucket public or has a policy';
  end if;

  -- T14 an unconfirmed account with a member's email reads nothing
  total := total + 1;
  perform set_config('request.jwt.claims', json_build_object('email', c_unc, 'role', 'authenticated', 'sub', u_unc)::text, true);
  set local role authenticated;
  select count(*) into n from public.member_access;
  reset role;
  if n <> 0 then fails := fails || 'T14 unconfirmed account read member_access'; end if;

  -- T15 a JWT claiming another member's email (sub mismatch) reads nothing
  total := total + 1;
  perform set_config('request.jwt.claims', json_build_object('email', c_course, 'role', 'authenticated', 'sub', u_kit)::text, true);
  set local role authenticated;
  select count(*) into n from public.member_access where email = c_course;
  reset role;
  if n <> 0 then fails := fails || 'T15 email claim not matching sub read rows'; end if;

  if array_length(fails, 1) is null then
    raise exception 'members-foundation tests PASSED %/% (rolled back)', total, total;
  else
    raise exception 'members-foundation tests FAILED (% of %): %', array_length(fails, 1), total, array_to_string(fails, ' | ');
  end if;
end $$;
