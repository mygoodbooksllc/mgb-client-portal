-- Members step 2 (staff Members list): role-simulation tests. NOT a migration.
-- Run after members-staff-list-v1.sql, as postgres (SQL editor or MCP).
-- One DO block that ALWAYS ends by raising, so every fixture rolls back,
-- including log rows, the permission rows and the switch turned on in S8.
-- Read the result from the error text:
--   'members-staff-list tests PASSED n/n'  or  '... FAILED: <list>'.
-- Fixtures: @example.test auth users and access rows only. Staff are the real
-- staff rows (emails only, used as JWT claims); nothing about them changes.

do $$
declare
  c_mem   text := 'ms-member@example.test';
  u_mem   uuid := gen_random_uuid();
  v_owner text;
  v_admin text;
  v_bk    text;
  fails text[] := '{}';
  total int := 0;
  n int;
  n2 int;
  s text;
  j jsonb;
  blocked boolean;
begin
  select ia.staff_email into v_owner from public.internal_access ia where ia.is_owner limit 1;
  select s2.email into v_admin from public.staff s2
   where s2.role = 'admin' and s2.active and s2.email <> v_owner order by s2.email limit 1;
  select s2.email into v_bk from public.staff s2
   where s2.role <> 'admin' and s2.active order by s2.email limit 1;

  insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at) values
    ('00000000-0000-0000-0000-000000000000', u_mem, 'authenticated', 'authenticated', c_mem, now(), now(), now());
  insert into public.member_access (email, member_id, access, source, is_test) values (c_mem, u_mem, 'kit', 'manual', true);
  insert into public.member_purchases (email, member_id, product, amount_cents, status, stripe_session_id, paid_at, is_test)
  values (c_mem, u_mem, 'kit', 7900, 'paid', 'cs_test_ms', now(), true);

  -- S0 starting state: both switches off, nobody holds the permission
  total := total + 1;
  if public.members_staff_switch_on() or public.members_area_switch_on() then fails := fails || 'S0 a switch is on'; end if;
  select count(*) into n from public.members_support_staff;
  if n <> 0 or v_owner is null or v_admin is null or v_bk is null then
    fails := fails || ('S0 support rows=' || n || ' owner/admin/bk found=' || (v_owner is not null) || (v_admin is not null) || (v_bk is not null));
  end if;

  -- S1 a non-owner admin cannot grant the permission (to anyone, including themselves)
  total := total + 1;
  perform set_config('request.jwt.claims', json_build_object('email', v_admin, 'role', 'authenticated', 'sub', gen_random_uuid(),
    'app_metadata', json_build_object('provider', 'google', 'providers', json_build_array('google')))::text, true);
  blocked := false;
  begin
    set local role authenticated;
    perform public.set_members_support(v_admin, true);
  exception when insufficient_privilege then blocked := true; end;
  reset role;
  begin
    set local role authenticated;
    insert into public.members_support_staff (staff_email, granted_by) values (v_admin, v_admin);
    blocked := false;
  exception when insufficient_privilege then null; end;
  reset role;
  select count(*) into n from public.members_support_staff;
  if not blocked or n <> 0 then fails := fails || 'S1 a non-owner admin granted the permission'; end if;

  -- S2 the owner can grant; it is logged
  total := total + 1;
  perform set_config('request.jwt.claims', json_build_object('email', v_owner, 'role', 'authenticated', 'sub', gen_random_uuid(),
    'app_metadata', json_build_object('provider', 'google', 'providers', json_build_array('google')))::text, true);
  set local role authenticated;
  j := public.set_members_support(v_bk, true);
  reset role;
  select count(*) into n from public.member_support_log
   where action = 'support_permission.granted' and actor_email = lower(v_owner) and details ->> 'staff_email' = lower(v_bk);
  if (j ->> 'changed') <> 'true' or n <> 1
     or not exists (select 1 from public.members_support_staff where staff_email = v_bk) then
    fails := fails || ('S2 owner grant: ' || j::text || ' log rows ' || n);
  end if;

  -- S3 while the staff switch is off, the holder (not the owner) cannot open; logged as denied
  total := total + 1;
  perform set_config('request.jwt.claims', json_build_object('email', v_bk, 'role', 'authenticated', 'sub', gen_random_uuid(),
    'app_metadata', json_build_object('provider', 'google', 'providers', json_build_array('google')))::text, true);
  set local role authenticated;
  j := public.open_member(u_mem, 'Sign-in help');
  reset role;
  select count(*) into n from public.member_support_log where member_id = u_mem and outcome = 'denied' and actor_email = lower(v_bk);
  if (j ->> 'ok') <> 'false' or n <> 1 then fails := fails || ('S3 switch off, holder: ' || j::text || ' denied rows ' || n); end if;

  -- S4 while the switch is off, the owner can list and open; the log row appears
  total := total + 1;
  perform set_config('request.jwt.claims', json_build_object('email', v_owner, 'role', 'authenticated', 'sub', gen_random_uuid(),
    'app_metadata', json_build_object('provider', 'google', 'providers', json_build_array('google')))::text, true);
  set local role authenticated;
  select count(*) into n from public.members_staff_list() l where l.email = c_mem and l.member_key = u_mem and l.is_test;
  j := public.open_member(u_mem, 'Purchase question');
  reset role;
  select count(*) into n2 from public.member_support_log
   where id = (j ->> 'log_id')::bigint and member_id = u_mem and outcome = 'ok' and reason = 'Purchase question' and actor_email = lower(v_owner);
  if n <> 1 or (j ->> 'ok') <> 'true' or n2 <> 1 or (j #>> '{account,email}') <> c_mem
     or jsonb_array_length(j -> 'purchases') <> 1 then
    fails := fails || ('S4 owner list/open: list ' || n || ' log ' || n2 || ' ' || left(j::text, 200));
  end if;

  -- S5 non-owner admin while switch is off: cannot list, me says no
  total := total + 1;
  perform set_config('request.jwt.claims', json_build_object('email', v_admin, 'role', 'authenticated', 'sub', gen_random_uuid(),
    'app_metadata', json_build_object('provider', 'google', 'providers', json_build_array('google')))::text, true);
  blocked := false;
  begin
    set local role authenticated;
    perform count(*) from public.members_staff_list();
  exception when insufficient_privilege then blocked := true; end;
  reset role;
  set local role authenticated;
  j := public.members_staff_me();
  reset role;
  if not blocked or (j ->> 'can_list') <> 'false' then fails := fails || ('S5 switch off, admin: blocked=' || blocked || ' ' || j::text); end if;

  -- S6 a reason is required
  total := total + 1;
  perform set_config('request.jwt.claims', json_build_object('email', v_owner, 'role', 'authenticated', 'sub', gen_random_uuid(),
    'app_metadata', json_build_object('provider', 'google', 'providers', json_build_array('google')))::text, true);
  blocked := false;
  begin
    set local role authenticated;
    perform public.open_member(u_mem, '  ');
  exception when invalid_parameter_value then blocked := true; end;
  reset role;
  if not blocked then fails := fails || 'S6 open without a reason was allowed'; end if;

  -- S7 turn the staff switch on (owner override, rolled back)
  perform set_config('mgb.tk_owner_override', 'on', true);
  insert into public.tk_settings (key, value) values ('members_staff_enabled', 'true'::jsonb)
  on conflict (key) do update set value = excluded.value;
  perform set_config('mgb.tk_owner_override', '', true);

  -- S7 holder can open; the log row appears in the same call
  total := total + 1;
  perform set_config('request.jwt.claims', json_build_object('email', v_bk, 'role', 'authenticated', 'sub', gen_random_uuid(),
    'app_metadata', json_build_object('provider', 'google', 'providers', json_build_array('google')))::text, true);
  set local role authenticated;
  j := public.open_member(u_mem, 'Sign-in help');
  reset role;
  select count(*) into n from public.member_support_log
   where id = (j ->> 'log_id')::bigint and member_id = u_mem and outcome = 'ok' and actor_email = lower(v_bk) and reason = 'Sign-in help';
  if (j ->> 'ok') <> 'true' or n <> 1 then fails := fails || ('S7 holder open: ' || left(j::text, 200) || ' log ' || n); end if;

  -- S8 non-holder admin (switch on): sees the list, cannot open, attempt logged as denied
  total := total + 1;
  perform set_config('request.jwt.claims', json_build_object('email', v_admin, 'role', 'authenticated', 'sub', gen_random_uuid(),
    'app_metadata', json_build_object('provider', 'google', 'providers', json_build_array('google')))::text, true);
  set local role authenticated;
  select count(*) into n from public.members_staff_list() l where l.email = c_mem;
  j := public.open_member(u_mem, 'Other: curious');
  reset role;
  select count(*) into n2 from public.member_support_log where actor_email = lower(v_admin) and outcome = 'denied';
  if n <> 1 or (j ->> 'ok') <> 'false' or n2 <> 1 or j ? 'account' then
    fails := fails || ('S8 non-holder admin: list ' || n || ' ' || j::text || ' denied rows ' || n2);
  end if;

  -- S9 log reads: the non-holder admin reads none; the holder reads only their own
  total := total + 1;
  set local role authenticated;
  select count(*) into n from public.member_support_log;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('email', v_bk, 'role', 'authenticated', 'sub', gen_random_uuid(),
    'app_metadata', json_build_object('provider', 'google', 'providers', json_build_array('google')))::text, true);
  set local role authenticated;
  select count(*) filter (where actor_email <> lower(v_bk)) into n2 from public.member_support_log;
  select count(*) into s from public.member_support_log;
  reset role;
  if n <> 0 or n2 <> 0 or s::int < 2 then fails := fails || ('S9 log read: admin ' || n || ', holder saw others ' || n2); end if;

  -- S10 the log cannot be updated, deleted or truncated, even by postgres
  total := total + 1;
  blocked := true;
  begin
    update public.member_support_log set reason = 'changed' where member_id = u_mem;
    blocked := false;
  exception when insufficient_privilege then null; end;
  begin
    delete from public.member_support_log where member_id = u_mem;
    blocked := false;
  exception when insufficient_privilege then null; end;
  begin
    truncate public.member_support_log;
    blocked := false;
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claims', json_build_object('email', v_owner, 'role', 'authenticated', 'sub', gen_random_uuid(),
    'app_metadata', json_build_object('provider', 'google', 'providers', json_build_array('google')))::text, true);
  begin
    set local role authenticated;
    update public.member_support_log set reason = 'changed';
    get diagnostics n = row_count;
    if n > 0 then blocked := false; end if;
  exception when insufficient_privilege then null; end;
  reset role;
  begin
    set local role authenticated;
    insert into public.member_support_log (actor_email, actor_kind, action) values ('x@example.test', 'staff', 'customer.opened');
    blocked := false;
  exception when insufficient_privilege then null; end;
  reset role;
  select count(*) into n from public.member_support_log where member_id = u_mem and reason = 'changed';
  if not blocked or n <> 0 then fails := fails || 'S10 the log was changed'; end if;

  -- S11 a member cannot read the log, list, open, or see the permission table
  total := total + 1;
  perform set_config('request.jwt.claims', json_build_object('email', c_mem, 'role', 'authenticated', 'sub', u_mem)::text, true);
  set local role authenticated;
  select count(*) into n from public.member_support_log;
  select n + count(*) into n from public.members_support_staff;
  reset role;
  blocked := true;
  begin
    set local role authenticated;
    perform count(*) from public.members_staff_list();
    blocked := false;
  exception when insufficient_privilege then null; end;
  reset role;
  begin
    set local role authenticated;
    perform public.open_member(u_mem, 'Sign-in help');
    blocked := false;
  exception when insufficient_privilege then null; end;
  reset role;
  begin
    set local role authenticated;
    perform public.set_members_support(c_mem, true);
    blocked := false;
  exception when insufficient_privilege then null; end;
  reset role;
  set local role authenticated;
  j := public.members_staff_me();
  reset role;
  if n <> 0 or not blocked or (j ->> 'can_list') <> 'false' then
    fails := fails || ('S11 member: read ' || n || ' blocked=' || blocked || ' ' || j::text);
  end if;

  -- S12 anon has no access at all
  total := total + 1;
  if has_function_privilege('anon', 'public.open_member(uuid, text)', 'execute')
     or has_function_privilege('anon', 'public.members_staff_list()', 'execute')
     or has_function_privilege('anon', 'public.set_members_support(text, boolean)', 'execute')
     or has_table_privilege('anon', 'public.member_support_log', 'select')
     or has_table_privilege('authenticated', 'public.member_support_log', 'insert')
     or has_table_privilege('authenticated', 'public.members_support_staff', 'insert')
     or has_function_privilege('authenticated', 'public.members__key_for_email(text)', 'execute') then
    fails := fails || 'S12 a privilege leaked to anon or authenticated';
  end if;

  -- S13 the owner can remove the permission; removal is logged; the owner's own row is refused
  total := total + 1;
  perform set_config('request.jwt.claims', json_build_object('email', v_owner, 'role', 'authenticated', 'sub', gen_random_uuid(),
    'app_metadata', json_build_object('provider', 'google', 'providers', json_build_array('google')))::text, true);
  set local role authenticated;
  j := public.set_members_support(v_bk, false);
  reset role;
  blocked := false;
  begin
    set local role authenticated;
    perform public.set_members_support(v_owner, false);
  exception when invalid_parameter_value then blocked := true; end;
  reset role;
  select count(*) into n from public.member_support_log where action = 'support_permission.removed' and details ->> 'staff_email' = lower(v_bk);
  if (j ->> 'changed') <> 'true' or n <> 1 or not blocked
     or exists (select 1 from public.members_support_staff where staff_email = v_bk) then
    fails := fails || ('S13 owner remove: ' || j::text || ' log ' || n || ' owner-row refused=' || blocked);
  end if;

  if array_length(fails, 1) is null then
    raise exception 'members-staff-list tests PASSED %/% (rolled back)', total, total;
  else
    raise exception 'members-staff-list tests FAILED (% of %): %', array_length(fails, 1), total, array_to_string(fails, ' | ');
  end if;
end $$;
