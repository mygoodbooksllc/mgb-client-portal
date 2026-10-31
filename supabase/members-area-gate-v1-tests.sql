-- Members area gate v1: role-simulation tests. NOT a migration.
-- Run after members-area-gate-v1.sql, as postgres (SQL editor or MCP).
-- One DO block that ALWAYS ends by raising, so every fixture rolls back,
-- including the switch being turned on in G7. Read the result from the error
-- text: 'members-area-gate tests PASSED n/n' or '... FAILED: <list>'.
-- Fixtures: @example.test auth users and the basic-test (test_only) client.
-- The owner case uses the owner's own sign-in row and a rolled-back test
-- access row. No customer data is read or written.

do $$
declare
  c_client text := 'gate-client@example.test';
  c_course text := 'gate-course@example.test';
  c_allow  text := 'gate-allow@example.test';
  u_client uuid := gen_random_uuid();
  u_course uuid := gen_random_uuid();
  u_allow  uuid := gen_random_uuid();
  v_owner_email text;
  v_owner_id uuid;
  v_admin text;
  fails text[] := '{}';
  total int := 0;
  n int;
  s text;
  j jsonb;
  blocked boolean;
begin
  select a.email into v_owner_email from public.members_area_allowlist a where a.note = 'owner' limit 1;
  select u.id into v_owner_id from auth.users u
   where lower(u.email) = v_owner_email and u.email_confirmed_at is not null limit 1;
  select lower(s2.email) into v_admin from public.staff s2
   where s2.role = 'admin' and coalesce(s2.active, true)
     and lower(s2.email) <> coalesce(v_owner_email, '') limit 1;

  -- G0 starting state: switch off, allowlist is the owner only
  total := total + 1;
  if public.members_area_switch_on() then fails := fails || 'G0 switch is ON before the test'; end if;
  select count(*) into n from public.members_area_allowlist;
  if n <> 1 or v_owner_email is null or v_owner_id is null then
    fails := fails || ('G0 allowlist rows=' || n || ' owner sign-in found=' || (v_owner_id is not null));
  end if;

  -- fixtures (rolled back)
  insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at) values
    ('00000000-0000-0000-0000-000000000000', u_client, 'authenticated', 'authenticated', c_client, now(), now(), now()),
    ('00000000-0000-0000-0000-000000000000', u_course, 'authenticated', 'authenticated', c_course, now(), now(), now()),
    ('00000000-0000-0000-0000-000000000000', u_allow,  'authenticated', 'authenticated', c_allow,  now(), now(), now());
  -- a client added to a roster: the trigger writes their client row
  insert into public.client_users (email, client_id, name, role, active, access)
  values (c_client, 'basic-test', 'Gate test client', 'member', true, 'full');
  insert into public.member_access (email, member_id, access, source, is_test) values
    (c_course, u_course, 'course', 'manual', true),
    (c_allow,  u_allow,  'kit',    'manual', true),
    (v_owner_email, v_owner_id, 'kit', 'manual', true);
  insert into public.member_profiles (member_id, email, is_test) values (u_course, c_course, true);
  insert into public.member_purchases (email, member_id, product, amount_cents, status, is_test) values
    (c_course, u_course, 'course', 9900, 'paid', true);
  insert into public.members_area_allowlist (email, note) values (c_allow, 'rolled-back test');

  -- G1 the roster trigger still writes the client row while the gate is closed
  total := total + 1;
  select count(*) into n from public.member_access where email = c_client and access = 'client' and source = 'client_roster';
  if n <> 1 then fails := fails || 'G1 roster trigger did not write the client row'; end if;

  -- G2 switch OFF: the client reads nothing
  total := total + 1;
  perform set_config('request.jwt.claims', json_build_object('email', c_client, 'role', 'authenticated', 'sub', u_client)::text, true);
  set local role authenticated;
  select count(*) into n from public.member_access;
  reset role;
  if n <> 0 then fails := fails || ('G2 closed: client read ' || n || ' access rows'); end if;

  -- G3 switch OFF: a course buyer reads no access, profile or purchase rows
  total := total + 1;
  perform set_config('request.jwt.claims', json_build_object('email', c_course, 'role', 'authenticated', 'sub', u_course)::text, true);
  set local role authenticated;
  select count(*) into n from public.member_access;
  select n + count(*) into n from public.member_profiles;
  select n + count(*) into n from public.member_purchases;
  reset role;
  if n <> 0 then fails := fails || ('G3 closed: course buyer read ' || n || ' rows'); end if;

  -- G4 switch OFF: the owner gets through (own row only)
  total := total + 1;
  perform set_config('request.jwt.claims', json_build_object('email', v_owner_email, 'role', 'authenticated', 'sub', v_owner_id,
    'app_metadata', json_build_object('provider', 'google'))::text, true);
  set local role authenticated;
  select string_agg(email || '/' || access, ',') into s from public.member_access;
  reset role;
  if s is distinct from (v_owner_email || '/kit') then fails := fails || ('G4 closed: owner saw ' || coalesce(s, 'nothing')); end if;

  -- G5 switch OFF: an allowlisted test user gets through (own row only)
  total := total + 1;
  perform set_config('request.jwt.claims', json_build_object('email', c_allow, 'role', 'authenticated', 'sub', u_allow)::text, true);
  set local role authenticated;
  select string_agg(access, ',') into s from public.member_access;
  reset role;
  if s is distinct from 'kit' then fails := fails || ('G5 closed: allowlisted test user saw ' || coalesce(s, 'nothing')); end if;

  -- G6 the edge function's gate answer while closed
  total := total + 1;
  j := public.members_area_gate_for(c_client);
  s := (j ->> 'allowed') || (public.members_area_gate_for(null) ->> 'allowed')
       || (public.members_area_gate_for(upper(v_owner_email)) ->> 'allowed')
       || (public.members_area_gate_for(c_allow) ->> 'allowed') || (j ->> 'open');
  if s <> 'falsefalsetruetruefalse' then fails := fails || ('G6 gate_for while closed: ' || s); end if;

  -- G7 a client cannot flip the switch (no write, and nothing is written)
  total := total + 1;
  perform set_config('request.jwt.claims', json_build_object('email', c_client, 'role', 'authenticated', 'sub', u_client)::text, true);
  blocked := false;
  begin
    set local role authenticated;
    insert into public.tk_settings (key, value) values ('members_area_open', 'true'::jsonb);
  exception when others then blocked := true; end;
  reset role;
  begin
    set local role authenticated;
    update public.tk_settings set value = 'true'::jsonb where key = 'members_area_open';
  exception when others then null; end;
  reset role;
  if not blocked or public.members_area_switch_on() then fails := fails || 'G7 a client changed the switch'; end if;

  -- G8 an admin who is not the owner cannot flip it either
  total := total + 1;
  if v_admin is null then
    fails := fails || 'G8 no non-owner admin found to test';
  else
    perform set_config('request.jwt.claims', json_build_object('email', v_admin, 'role', 'authenticated', 'sub', gen_random_uuid(),
      'app_metadata', json_build_object('provider', 'google', 'providers', json_build_array('google')))::text, true);
    blocked := false;
    begin
      set local role authenticated;
      insert into public.tk_settings (key, value) values ('members_area_open', 'true'::jsonb);
    exception when others then blocked := true; end;
    reset role;
    if not blocked or public.members_area_switch_on() then fails := fails || 'G8 a non-owner admin changed the switch'; end if;
  end if;

  -- G9 clients cannot read or change the allowlist, or call the gate helpers
  total := total + 1;
  perform set_config('request.jwt.claims', json_build_object('email', c_client, 'role', 'authenticated', 'sub', u_client)::text, true);
  blocked := false;
  begin
    set local role authenticated;
    insert into public.members_area_allowlist (email) values (c_client);
  exception when insufficient_privilege then blocked := true; end;
  reset role;
  begin
    set local role authenticated;
    select count(*) into n from public.members_area_allowlist;
    blocked := false;
  exception when insufficient_privilege then null; end;
  reset role;
  if not blocked
     or has_function_privilege('authenticated', 'public.members_area_gate_for(text)', 'execute')
     or has_function_privilege('anon', 'public.members_area_gate_for(text)', 'execute')
     or has_function_privilege('authenticated', 'public.members_area_switch_on()', 'execute')
     or has_function_privilege('anon', 'public.members_area_open_for_me()', 'execute') then
    fails := fails || 'G9 allowlist or gate helper reachable by a client';
  end if;

  -- G10 the live backfilled roster rows are unreadable to anyone outside the allowlist
  total := total + 1;
  select count(*) into n from public.member_access ma
   where ma.source = 'client_roster' and ma.email not like '%@example.test'
     and exists (select 1 from public.members_area_allowlist a where a.email = ma.email);
  if n <> 0 then fails := fails || 'G10 a backfilled roster email is on the allowlist'; end if;

  -- G11 switch ON (owner override, rolled back): the client gets through
  total := total + 1;
  perform set_config('mgb.tk_owner_override', 'on', true);
  insert into public.tk_settings (key, value) values ('members_area_open', 'true'::jsonb)
  on conflict (key) do update set value = excluded.value;
  perform set_config('mgb.tk_owner_override', '', true);
  perform set_config('request.jwt.claims', json_build_object('email', c_client, 'role', 'authenticated', 'sub', u_client)::text, true);
  set local role authenticated;
  select string_agg(access, ',') into s from public.member_access;
  reset role;
  j := public.members_area_gate_for(c_client);
  if s is distinct from 'client' or (j ->> 'allowed') <> 'true' or (j ->> 'open') <> 'true' then
    fails := fails || ('G11 open: client saw ' || coalesce(s, 'nothing') || ', gate ' || j::text);
  end if;

  -- G12 switch ON still keeps people to their own rows
  total := total + 1;
  perform set_config('request.jwt.claims', json_build_object('email', c_course, 'role', 'authenticated', 'sub', u_course)::text, true);
  set local role authenticated;
  select count(*) into n from public.member_access where email <> c_course;
  reset role;
  if n <> 0 then fails := fails || 'G12 open: course buyer read someone else''s rows'; end if;

  if array_length(fails, 1) is null then
    raise exception 'members-area-gate tests PASSED %/% (rolled back)', total, total;
  else
    raise exception 'members-area-gate tests FAILED (% of %): %', array_length(fails, 1), total, array_to_string(fails, ' | ');
  end if;
end $$;
