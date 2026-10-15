-- Launch announcements: RLS and RPC security tests.
-- NOT a migration. Run in the Supabase SQL editor (or psql as postgres) on a
-- branch or staging project AFTER staff-announcements.sql is applied.
-- Everything runs inside one transaction that ends in ROLLBACK, so no fixture
-- survives. Each check raises 'FAIL n: ...' on failure; a clean run ends with
-- the notice 'staff-announcements tests: all passed' and then rolls back.
--
-- Same identity switching as qbo-env-per-connection-tests.sql: `set local
-- role` plus request.jwt.claims, `reset role` back to postgres for fixtures.
--
-- Fixtures (staff emails must be @mygoodbooks.org, claims carry app_metadata
-- google because is_active_staff() requires it):
--   anntest-a@mygoodbooks.org     bookkeeper
--   anntest-b@mygoodbooks.org     bookkeeper
--   anntest-admin@mygoodbooks.org admin
--   anntest-off@mygoodbooks.org   inactive bookkeeper
--   anntest-client@example.test   not staff

begin;

insert into public.staff (email, name, role, active) values
  ('anntest-a@mygoodbooks.org', 'Ann A', 'bookkeeper', true),
  ('anntest-b@mygoodbooks.org', 'Ann B', 'bookkeeper', true),
  ('anntest-admin@mygoodbooks.org', 'Ann Admin', 'admin', true),
  ('anntest-off@mygoodbooks.org', 'Ann Off', 'bookkeeper', false);

-- ===========================================================================
-- anon: nothing
-- ===========================================================================
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$
begin
  begin
    perform 1 from public.staff_announcements;
    raise exception 'FAIL 1a: anon could select';
  exception when insufficient_privilege then null; end;
  begin
    perform public.staff_announcement_report();
    raise exception 'FAIL 1b: anon could run the report';
  exception when insufficient_privilege then null; end;
end
$$;
reset role;

-- ===========================================================================
-- Staffer A: own rows only
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"email":"anntest-a@mygoodbooks.org","role":"authenticated","app_metadata":{"provider":"google","providers":["google"]}}', true);
do $$
declare r public.staff_announcements;
begin
  -- Insert stamps the owner from the JWT, even when the row names someone else.
  insert into public.staff_announcements (staff_email, announcement_id, status)
    values ('anntest-b@mygoodbooks.org', 'anntest-one', 'seen')
    returning * into r;
  if r.staff_email <> 'anntest-a@mygoodbooks.org' then
    raise exception 'FAIL 2a: insert kept a browser-supplied owner (%)', r.staff_email;
  end if;

  update public.staff_announcements
     set status = 'later', later_count = 1,
         staff_email = 'anntest-b@mygoodbooks.org', first_seen_at = '2000-01-01'
   where announcement_id = 'anntest-one'
   returning * into r;
  if r.staff_email <> 'anntest-a@mygoodbooks.org' or r.first_seen_at < '2020-01-01'
     or r.status <> 'later' or r.later_count <> 1 then
    raise exception 'FAIL 2b: update changed owner or first_seen_at, or lost the status';
  end if;

  begin
    update public.staff_announcements set later_count = 4 where announcement_id = 'anntest-one';
    raise exception 'FAIL 2c: later_count above 3 accepted';
  exception when check_violation then null; end;
  begin
    update public.staff_announcements set status = 'maybe' where announcement_id = 'anntest-one';
    raise exception 'FAIL 2d: unknown status accepted';
  exception when check_violation then null; end;
  begin
    insert into public.staff_announcements (announcement_id) values ('Bad Id!');
    raise exception 'FAIL 2e: bad announcement id accepted';
  exception when check_violation then null; end;
  begin
    delete from public.staff_announcements where announcement_id = 'anntest-one';
    raise exception 'FAIL 2f: delete allowed';
  exception when insufficient_privilege then null; end;
  begin
    perform public.staff_announcement_report();
    raise exception 'FAIL 2g: a non-admin ran the report';
  exception when insufficient_privilege then null; end;

  -- A stale save never takes an answer back (an offline retry, a second tab).
  update public.staff_announcements set status = 'dismissed', later_count = 2
   where announcement_id = 'anntest-one';
  update public.staff_announcements set status = 'seen', later_count = 0
   where announcement_id = 'anntest-one' returning * into r;
  if r.status <> 'dismissed' or r.later_count <> 2 then
    raise exception 'FAIL 2h: a stale seen undid a skip or lowered the Later count (% %)', r.status, r.later_count;
  end if;
  update public.staff_announcements set status = 'toured' where announcement_id = 'anntest-one';
  update public.staff_announcements set status = 'dismissed' where announcement_id = 'anntest-one'
    returning * into r;
  if r.status <> 'toured' then
    raise exception 'FAIL 2i: a finished tour was changed to %', r.status;
  end if;
end
$$;
reset role;

-- ===========================================================================
-- Staffer B: cannot see or change A's row
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"email":"anntest-b@mygoodbooks.org","role":"authenticated","app_metadata":{"provider":"google","providers":["google"]}}', true);
do $$
declare n integer;
begin
  select count(*) into n from public.staff_announcements;
  if n <> 0 then raise exception 'FAIL 3a: B sees % of A''s rows', n; end if;
  update public.staff_announcements set status = 'dismissed' where announcement_id = 'anntest-one';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 3b: B updated A''s row'; end if;
  -- B writes the same announcement id as its own row.
  insert into public.staff_announcements (announcement_id, status) values ('anntest-one', 'toured');
  select count(*) into n from public.staff_announcements;
  if n <> 1 then raise exception 'FAIL 3c: B should see exactly its own row, saw %', n; end if;
end
$$;
reset role;

do $$
begin
  if (select status from public.staff_announcements where staff_email = 'anntest-a@mygoodbooks.org') <> 'toured' then
    raise exception 'FAIL 3d: A''s row was changed by B';
  end if;
end
$$;

-- ===========================================================================
-- Inactive staff and a portal client: nothing
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"email":"anntest-off@mygoodbooks.org","role":"authenticated","app_metadata":{"provider":"google","providers":["google"]}}', true);
do $$
begin
  begin
    insert into public.staff_announcements (announcement_id) values ('anntest-two');
    raise exception 'FAIL 4a: inactive staff inserted';
  exception when insufficient_privilege then null; end;
end
$$;
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"email":"anntest-client@example.test","role":"authenticated","app_metadata":{"provider":"google","providers":["google"]}}', true);
do $$
begin
  begin
    insert into public.staff_announcements (announcement_id) values ('anntest-two');
    raise exception 'FAIL 4b: a client inserted';
  exception when insufficient_privilege then null; end;
  if (select count(*) from public.staff_announcements) <> 0 then
    raise exception 'FAIL 4c: a client can read rows';
  end if;
end
$$;
reset role;

-- ===========================================================================
-- Admin: the report
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"email":"anntest-admin@mygoodbooks.org","role":"authenticated","app_metadata":{"provider":"google","providers":["google"]}}', true);
do $$
declare n integer;
begin
  select count(*) into n from public.staff_announcement_report() where announcement_id = 'anntest-one';
  if n <> 2 then raise exception 'FAIL 5a: report should list A and B for anntest-one, got %', n; end if;
  select count(*) into n from public.staff_announcement_report() where staff_email = 'anntest-admin@mygoodbooks.org' and announcement_id is null;
  if n <> 1 then raise exception 'FAIL 5b: a staffer with no rows should appear once with a null id'; end if;
  select count(*) into n from public.staff_announcement_report() where staff_email = 'anntest-off@mygoodbooks.org';
  if n <> 0 then raise exception 'FAIL 5c: report lists an inactive staffer'; end if;
  -- The admin still cannot read others' rows straight from the table.
  select count(*) into n from public.staff_announcements;
  if n <> 0 then raise exception 'FAIL 5d: admin reads the table directly (%)', n; end if;
end
$$;
reset role;

do $$ begin raise notice 'staff-announcements tests: all passed'; end $$;

rollback;
