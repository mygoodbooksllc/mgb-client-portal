-- view-as-last-seen.sql security and behavior tests (spec §5.1).
-- NOT a migration. Run in the Supabase SQL editor (or psql as postgres)
-- AFTER view-as-last-seen.sql is applied. Everything runs inside one
-- transaction that ends in ROLLBACK, so no fixture survives. Each check
-- raises 'FAIL n: ...' on failure; a clean run ends with the notice
-- 'view-as-last-seen tests: all passed' and then rolls back.
--
-- Identity switching as in staff-auth-repair-tests.sql: `set local role
-- authenticated` plus request.jwt.claims (what auth.jwt() reads), and
-- `reset role` back to postgres for fixtures. Staff claims carry
-- app_metadata google because is_active_staff_admin() requires
-- jwt_has_google().
--
-- Fixtures (all zz-lastseen-*, @mygoodbooks.org because of the
-- staff_email_domain CHECK):
--   zz-lastseen-admin@mygoodbooks.org   active admin (the caller)
--   zz-lastseen-bk@mygoodbooks.org      active bookkeeper
--   zz-lastseen-temp@mygoodbooks.org    active bookkeeper with a live
--                                       temporary admin grant

begin;

insert into public.staff (email, name, role, active) values
  ('zz-lastseen-admin@mygoodbooks.org', 'ZZ Lastseen Admin', 'admin', true),
  ('zz-lastseen-bk@mygoodbooks.org', 'ZZ Lastseen Bookkeeper', 'bookkeeper', true),
  ('zz-lastseen-temp@mygoodbooks.org', 'ZZ Lastseen Temp', 'bookkeeper', true);
insert into public.staff_temp_admin_access (staff_email, granted_by, expires_at, reason)
values ('zz-lastseen-temp@mygoodbooks.org', 'zz-lastseen-admin@mygoodbooks.org', now() + interval '1 day', 'test');

do $$
begin
  -- 0. Grants and shape.
  if has_function_privilege('anon', 'public.staff_last_seen(text)', 'execute') then
    raise exception 'FAIL 0a: anon can execute staff_last_seen(text)';
  end if;
  if not has_function_privilege('authenticated', 'public.staff_last_seen(text)', 'execute') then
    raise exception 'FAIL 0b: authenticated cannot execute staff_last_seen(text)';
  end if;
  if not (select prosecdef from pg_proc where oid = 'public.staff_last_seen(text)'::regprocedure) then
    raise exception 'FAIL 0c: staff_last_seen(text) is not SECURITY DEFINER';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'usage_events' and column_name = 'view_as') then
    raise exception 'FAIL 0d: usage_events.view_as is missing';
  end if;
  if position('not ue.view_as' in pg_get_functiondef('public.usage_summary(integer)'::regprocedure)) = 0 then
    raise exception 'FAIL 0e: usage_summary does not skip view_as rows';
  end if;
end
$$;

-- 1. Admin: JSON with every key.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"role":"authenticated","email":"zz-lastseen-admin@mygoodbooks.org","app_metadata":{"provider":"google","providers":["google"]}}', true);
do $$
declare
  j jsonb;
begin
  j := public.staff_last_seen('ZZ-Lastseen-BK@mygoodbooks.org');
  if not (j ? 'last_view' and j ? 'last_action_at' and j ? 'last_sign_in_at'
          and j ? 'last_error' and j ? 'errors_7d') then
    raise exception 'FAIL 1a: missing keys in %', j;
  end if;
  begin
    perform public.staff_last_seen('nobody-zz@example.com');
    raise exception 'FAIL 1b: a non-staff email was accepted';
  exception when invalid_parameter_value then null;
  end;
end
$$;

-- 2. Bookkeeper, and bookkeeper with a temporary admin grant: refused.
select set_config('request.jwt.claims',
  '{"role":"authenticated","email":"zz-lastseen-bk@mygoodbooks.org","app_metadata":{"provider":"google","providers":["google"]}}', true);
do $$
begin
  begin
    perform public.staff_last_seen('zz-lastseen-admin@mygoodbooks.org');
    raise exception 'FAIL 2a: a bookkeeper ran staff_last_seen';
  exception when insufficient_privilege then null;
  end;
end
$$;
select set_config('request.jwt.claims',
  '{"role":"authenticated","email":"zz-lastseen-temp@mygoodbooks.org","app_metadata":{"provider":"google","providers":["google"]}}', true);
do $$
begin
  begin
    perform public.staff_last_seen('zz-lastseen-bk@mygoodbooks.org');
    raise exception 'FAIL 2b: a temporary admin ran staff_last_seen';
  exception when insufficient_privilege then null;
  end;
end
$$;

-- 3. client_errors: another person's actor_email is rejected; null or own is ok.
select set_config('request.jwt.claims',
  '{"role":"authenticated","email":"zz-lastseen-bk@mygoodbooks.org","app_metadata":{"provider":"google","providers":["google"]}}', true);
do $$
begin
  begin
    insert into public.client_errors (actor_email, message) values ('zz-lastseen-admin@mygoodbooks.org', 'zz forged');
    raise exception 'FAIL 3a: client_errors accepted another person''s actor_email';
  exception when insufficient_privilege then null;
  end;
  insert into public.client_errors (actor_email, message) values (null, 'zz null actor');
  insert into public.client_errors (actor_email, message) values ('ZZ-Lastseen-Bk@mygoodbooks.org', 'zz own');
  begin
    insert into public.client_errors (actor_email, message) values (null, repeat('x', 501));
    raise exception 'FAIL 3b: client_errors accepted a 501-character message';
  exception when insufficient_privilege then null;
  end;
end
$$;

-- 4. log_audit_event: admin can write view_as.blocked; unknown actions fail;
--    a bookkeeper can't write view_as.*, but portal_preview.* still works.
select set_config('request.jwt.claims',
  '{"role":"authenticated","email":"zz-lastseen-admin@mygoodbooks.org","app_metadata":{"provider":"google","providers":["google"]}}', true);
do $$
begin
  perform public.log_audit_event('view_as.blocked', null, '{"target":"x"}'::jsonb);
  begin
    perform public.log_audit_event('nope', null, '{}'::jsonb);
    raise exception 'FAIL 4a: unknown audit action accepted';
  exception when invalid_parameter_value then null;
  end;
end
$$;
select set_config('request.jwt.claims',
  '{"role":"authenticated","email":"zz-lastseen-bk@mygoodbooks.org","app_metadata":{"provider":"google","providers":["google"]}}', true);
do $$
begin
  begin
    perform public.log_audit_event('view_as.start', null, '{"target":"zz-lastseen-admin@mygoodbooks.org"}'::jsonb);
    raise exception 'FAIL 4b: a bookkeeper wrote view_as.start';
  exception when insufficient_privilege then null;
  end;
  perform public.log_audit_event('portal_preview.start', null, '{"target":"x"}'::jsonb);
end
$$;

-- 5. Future timestamps are replaced with the server's now().
select set_config('request.jwt.claims',
  '{"role":"authenticated","email":"zz-lastseen-bk@mygoodbooks.org","app_metadata":{"provider":"google","providers":["google"]}}', true);
insert into public.usage_events (actor_email, actor_role, page, kind, occurred_at)
values ('zz-lastseen-bk@mygoodbooks.org', 'staff', 'zz-future', 'view', now() + interval '1 year');
insert into public.client_errors (actor_email, message, created_at)
values ('zz-lastseen-bk@mygoodbooks.org', 'zz future', now() + interval '1 year');
reset role;
do $$
begin
  if exists (select 1 from public.usage_events
              where actor_email = 'zz-lastseen-bk@mygoodbooks.org' and occurred_at > now() + interval '1 minute') then
    raise exception 'FAIL 5a: usage_events kept a client-supplied future occurred_at';
  end if;
  if exists (select 1 from public.client_errors
              where lower(actor_email) = 'zz-lastseen-bk@mygoodbooks.org' and created_at > now() + interval '1 minute') then
    raise exception 'FAIL 5b: client_errors kept a client-supplied future created_at';
  end if;
end
$$;

-- 6. An admin's own View as rows don't count toward their Last seen.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"role":"authenticated","email":"zz-lastseen-admin@mygoodbooks.org","app_metadata":{"provider":"google","providers":["google"]}}', true);
insert into public.usage_events (actor_email, actor_role, page, kind, view_as)
values ('zz-lastseen-admin@mygoodbooks.org', 'staff', 'zz-viewas-page', 'view', true);
do $$
declare
  j jsonb;
begin
  j := public.staff_last_seen('zz-lastseen-admin@mygoodbooks.org');
  if coalesce(j -> 'last_view' ->> 'page', '') = 'zz-viewas-page' then
    raise exception 'FAIL 6a: a view_as row showed as the admin''s last view';
  end if;
  if j ->> 'last_action_at' is not null then
    raise exception 'FAIL 6b: a view_as row set the admin''s last_action_at';
  end if;
  raise notice 'view-as-last-seen tests: all passed';
end
$$;

rollback;
-- 7. Afterwards (separately): get_advisors (security) shows no new warnings.
