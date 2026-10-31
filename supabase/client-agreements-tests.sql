-- client-agreements.sql security and behavior tests (docs/agreements-spec.md §12).
-- NOT a migration. Run in the Supabase SQL editor (or psql / MCP execute_sql
-- as postgres) AFTER client-agreements.sql is applied. Everything runs inside
-- one transaction that ends in ROLLBACK, so no fixture survives (including the
-- temporary agreements_client_enabled row used for the switch-on checks).
-- Each check raises 'FAIL n: ...'; a clean run raises nothing.
--
-- Identities (set local role + request.jwt.claims, as in
-- view-as-last-seen-tests.sql). Staff claims carry app_metadata google.
--   zz-agr-admin@mygoodbooks.org  admin
--   zz-agr-am@mygoodbooks.org     bookkeeper, account manager of zz-agr-a
--   zz-agr-bk@mygoodbooks.org     bookkeeper assigned to zz-agr-a (not AM)
--   zz-agr-bk2@mygoodbooks.org    bookkeeper with no access
--   zz-agr-ca@example.com         client user of zz-agr-a
--   zz-agr-cb@example.com         client user of zz-agr-b
--   anon

begin;

insert into public.staff (email, name, role, active) values
  ('zz-agr-admin@mygoodbooks.org', 'ZZ Agr Admin', 'admin', true),
  ('zz-agr-am@mygoodbooks.org', 'ZZ Agr AM', 'bookkeeper', true),
  ('zz-agr-bk@mygoodbooks.org', 'ZZ Agr BK', 'bookkeeper', true),
  ('zz-agr-bk2@mygoodbooks.org', 'ZZ Agr BK2', 'bookkeeper', true);
insert into public.clients (id, name, org_type, test_only) values
  ('zz-agr-a', 'ZZ Agr A', 'Nonprofit', true),
  ('zz-agr-b', 'ZZ Agr B', 'Nonprofit', true);
update public.clients set account_manager_email = 'zz-agr-am@mygoodbooks.org' where id = 'zz-agr-a';
insert into public.staff_client_access (staff_email, client_id)
  select v.e, 'zz-agr-a' from (values ('zz-agr-am@mygoodbooks.org'), ('zz-agr-bk@mygoodbooks.org')) v(e)
   where not exists (select 1 from public.staff_client_access s where s.staff_email = v.e and s.client_id = 'zz-agr-a');
insert into public.client_users (email, client_id, name, role, active) values
  ('zz-agr-ca@example.com', 'zz-agr-a', 'ZZ Client A', 'Owner', true),
  ('zz-agr-cb@example.com', 'zz-agr-b', 'ZZ Client B', 'Owner', true);
insert into public.client_files (id, client_id, drive_file_id, name, year, visibility)
  values ('00000000-0000-4000-8000-0000000000f1', 'zz-agr-b', 'zz-drive-b', 'b.pdf', 2026, 'shared');
-- The switch must be unset for the first half (it is unset in production;
-- this script never deletes it, it stops instead).
do $$ begin
  if exists (select 1 from public.tk_settings where key = 'agreements_client_enabled') then
    raise exception 'STOP: agreements_client_enabled is set; run the switch-off half by hand';
  end if;
end $$;

do $$
begin
  if has_table_privilege('anon', 'public.client_agreements', 'select') then raise exception 'FAIL 0a: anon can select'; end if;
  if has_table_privilege('authenticated', 'public.client_agreements', 'delete') then raise exception 'FAIL 0b: authenticated can delete'; end if;
  if has_function_privilege('anon', 'public.client_agreements_mine(text)', 'execute') then raise exception 'FAIL 0c: anon can run client_agreements_mine'; end if;
  if exists (select 1 from pg_policies where tablename = 'client_agreements' and cmd in ('DELETE', 'ALL') and permissive = 'PERMISSIVE') then
    raise exception 'FAIL 0d: a permissive delete/all policy exists';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.client_agreements'::regclass) then raise exception 'FAIL 0e: RLS off'; end if;
end $$;

-- 1. Admin adds agreements for both orgs.
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"zz-agr-admin@mygoodbooks.org","app_metadata":{"provider":"google","providers":["google"]}}', true);
insert into public.client_agreements (id, client_id, title, status, signed_on, expires_on, document_url, staff_note, visible_to_client) values
  ('00000000-0000-4000-8000-0000000000a1', 'zz-agr-a', 'A service agreement', 'signed', '2024-01-05', current_date + 30, 'https://drive.google.com/file/d/a1', 'SECRET-NOTE-A1', true),
  ('00000000-0000-4000-8000-0000000000a2', 'zz-agr-a', 'A internal', 'draft', null, null, null, 'SECRET-NOTE-A2', false),
  ('00000000-0000-4000-8000-0000000000a3', 'zz-agr-a', 'A old addendum', 'signed', '2023-02-01', null, 'https://drive.google.com/file/d/a3', null, true),
  ('00000000-0000-4000-8000-0000000000b1', 'zz-agr-b', 'B engagement', 'signed', '2025-03-01', null, 'https://drive.google.com/file/d/b1', 'SECRET-NOTE-B1', true);
do $$
declare j jsonb;
begin
  if (select count(*) from public.client_agreements where client_id like 'zz-agr-%') <> 4 then raise exception 'FAIL 1a: admin cannot read all'; end if;
  if (select created_by from public.client_agreements where id = '00000000-0000-4000-8000-0000000000a1') <> 'zz-agr-admin@mygoodbooks.org' then
    raise exception 'FAIL 1b: created_by not stamped';
  end if;
  j := public.agreements_staff_perms('zz-agr-a');
  if not ((j->>'can_edit')::boolean and (j->>'is_admin')::boolean and not (j->>'client_enabled')::boolean) then raise exception 'FAIL 1c: admin perms %', j; end if;
  begin
    insert into public.client_agreements (client_id, title, document_url) values ('zz-agr-a', 'bad', 'javascript:alert(1)');
    raise exception 'FAIL 1d: javascript url accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.client_agreements (client_id, title, client_file_id) values ('zz-agr-a', 'wrong file', '00000000-0000-4000-8000-0000000000f1');
    raise exception 'FAIL 1e: other client''s file accepted';
  exception when insufficient_privilege then null;
  end;
end $$;

-- 2. Account manager of A: edit A, never B, no restore, no client signing, no delete.
select set_config('request.jwt.claims', '{"role":"authenticated","email":"zz-agr-am@mygoodbooks.org","app_metadata":{"provider":"google","providers":["google"]}}', true);
do $$
declare j jsonb; n int;
begin
  if (select count(*) from public.client_agreements where client_id = 'zz-agr-a') <> 3 then raise exception 'FAIL 2a: AM cannot read A'; end if;
  if (select count(*) from public.client_agreements where client_id = 'zz-agr-b') <> 0 then raise exception 'FAIL 2b: AM reads B'; end if;
  j := public.agreements_staff_perms('zz-agr-a');
  if not ((j->>'can_edit')::boolean and not (j->>'is_admin')::boolean) then raise exception 'FAIL 2c: AM perms %', j; end if;
  insert into public.client_agreements (client_id, title) values ('zz-agr-a', 'AM added');
  begin
    insert into public.client_agreements (client_id, title) values ('zz-agr-b', 'AM into B');
    raise exception 'FAIL 2d: AM inserted into B';
  exception when insufficient_privilege then null;
  end;
  update public.client_agreements set status = 'sent' where id = '00000000-0000-4000-8000-0000000000a2';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL 2e: AM cannot update A'; end if;
  update public.client_agreements set title = 'hijack' where id = '00000000-0000-4000-8000-0000000000b1';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 2f: AM updated B'; end if;
  begin
    update public.client_agreements set client_can_sign = true where id = '00000000-0000-4000-8000-0000000000a1';
    raise exception 'FAIL 2g: AM changed client_can_sign';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.client_agreements set client_id = 'zz-agr-b' where id = '00000000-0000-4000-8000-0000000000a1';
    raise exception 'FAIL 2h: AM moved an agreement';
  exception when insufficient_privilege then null;
  end;
  -- Trash a3, then try to restore it.
  update public.client_agreements set trashed_at = now() where id = '00000000-0000-4000-8000-0000000000a3';
  if (select trashed_by from public.client_agreements where id = '00000000-0000-4000-8000-0000000000a3') <> 'zz-agr-am@mygoodbooks.org' then
    raise exception 'FAIL 2i: trashed_by not stamped';
  end if;
  begin
    update public.client_agreements set trashed_at = null where id = '00000000-0000-4000-8000-0000000000a3';
    raise exception 'FAIL 2j: AM restored from trash';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.client_agreements where id = '00000000-0000-4000-8000-0000000000a2';
    raise exception 'FAIL 2k: AM deleted';
  exception when insufficient_privilege then null;
  end;
end $$;

-- 3. Assigned bookkeeper (not AM): read only.
select set_config('request.jwt.claims', '{"role":"authenticated","email":"zz-agr-bk@mygoodbooks.org","app_metadata":{"provider":"google","providers":["google"]}}', true);
do $$
declare j jsonb; n int;
begin
  if (select count(*) from public.client_agreements where client_id = 'zz-agr-a') <> 4 then raise exception 'FAIL 3a: BK cannot read A'; end if;
  if (select count(*) from public.client_agreements where client_id = 'zz-agr-b') <> 0 then raise exception 'FAIL 3b: BK reads B'; end if;
  j := public.agreements_staff_perms('zz-agr-a');
  if (j->>'can_edit')::boolean or not (j->>'can_read')::boolean then raise exception 'FAIL 3c: BK perms %', j; end if;
  begin
    insert into public.client_agreements (client_id, title) values ('zz-agr-a', 'BK added');
    raise exception 'FAIL 3d: BK inserted';
  exception when insufficient_privilege then null;
  end;
  update public.client_agreements set title = 'BK edit' where id = '00000000-0000-4000-8000-0000000000a1';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 3e: BK updated'; end if;
  -- Preview as a client user: only the visible, untrashed rows, no note.
  j := public.client_agreements_mine('zz-agr-a');
  if not (j->>'preview')::boolean or jsonb_array_length(j->'agreements') <> 1 then raise exception 'FAIL 3f: BK preview %', j; end if;
  if j::text like '%SECRET-NOTE%' or j::text like '%staff_note%' then raise exception 'FAIL 3g: preview leaks the note'; end if;
end $$;

-- 4. Bookkeeper with no access: nothing.
select set_config('request.jwt.claims', '{"role":"authenticated","email":"zz-agr-bk2@mygoodbooks.org","app_metadata":{"provider":"google","providers":["google"]}}', true);
do $$
declare j jsonb;
begin
  if (select count(*) from public.client_agreements where client_id like 'zz-agr-%') <> 0 then raise exception 'FAIL 4a: unassigned BK reads'; end if;
  j := public.agreements_staff_perms('zz-agr-a');
  if (j->>'can_read')::boolean or (j->>'can_edit')::boolean then raise exception 'FAIL 4b: unassigned perms %', j; end if;
  if jsonb_array_length(public.client_agreements_mine('zz-agr-a')->'agreements') <> 0 then raise exception 'FAIL 4c: unassigned RPC rows'; end if;
end $$;

-- 5. Client of A, switch OFF: nothing at all.
select set_config('request.jwt.claims', '{"role":"authenticated","email":"zz-agr-ca@example.com","app_metadata":{"provider":"email","providers":["email"]}}', true);
do $$
declare j jsonb; n int;
begin
  if (select count(*) from public.client_agreements) <> 0 then raise exception 'FAIL 5a: client reads the table directly'; end if;
  j := public.client_agreements_mine('zz-agr-a');
  if (j->>'enabled')::boolean or jsonb_array_length(j->'agreements') <> 0 then raise exception 'FAIL 5b: switch off but %', j; end if;
  begin
    insert into public.client_agreements (client_id, title) values ('zz-agr-a', 'client added');
    raise exception 'FAIL 5c: client inserted';
  exception when insufficient_privilege then null;
  end;
  update public.client_agreements set title = 'x' where client_id = 'zz-agr-a';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 5d: client updated'; end if;
end $$;

-- Switch ON (inside this rolled-back transaction only).
reset role;
insert into public.tk_settings (key, value) values ('agreements_client_enabled', 'true'::jsonb);
set local role authenticated;

-- 6. Client of A, switch ON: own visible rows only, never the note.
select set_config('request.jwt.claims', '{"role":"authenticated","email":"zz-agr-ca@example.com","app_metadata":{"provider":"email","providers":["email"]}}', true);
do $$
declare j jsonb;
begin
  if (select count(*) from public.client_agreements) <> 0 then raise exception 'FAIL 6a: client reads the table directly'; end if;
  j := public.client_agreements_mine('zz-agr-a');
  if not (j->>'enabled')::boolean then raise exception 'FAIL 6b: not enabled %', j; end if;
  if jsonb_array_length(j->'agreements') <> 1 or (j->'agreements'->0->>'id') <> '00000000-0000-4000-8000-0000000000a1' then
    raise exception 'FAIL 6c: wrong rows %', j;
  end if;
  if j::text like '%SECRET-NOTE%' or j::text like '%staff_note%' or j::text like '%client_can_sign%' or j::text like '%created_by%' then
    raise exception 'FAIL 6d: leaks staff fields %', j;
  end if;
  if (j->>'preview')::boolean then raise exception 'FAIL 6e: client marked as preview'; end if;
  j := public.client_agreements_mine('zz-agr-b');
  if (j->>'enabled')::boolean or jsonb_array_length(j->'agreements') <> 0 then raise exception 'FAIL 6f: A reads B %', j; end if;
end $$;

-- 7. Client of B: only B.
select set_config('request.jwt.claims', '{"role":"authenticated","email":"zz-agr-cb@example.com","app_metadata":{"provider":"email","providers":["email"]}}', true);
do $$
declare j jsonb;
begin
  j := public.client_agreements_mine('zz-agr-b');
  if jsonb_array_length(j->'agreements') <> 1 or (j->'agreements'->0->>'title') <> 'B engagement' then raise exception 'FAIL 7a: %', j; end if;
  if j::text like '%SECRET-NOTE%' then raise exception 'FAIL 7b: B note leaked'; end if;
  if jsonb_array_length(public.client_agreements_mine('zz-agr-a')->'agreements') <> 0 then raise exception 'FAIL 7c: B reads A'; end if;
end $$;

-- 8. Admin restores from trash.
select set_config('request.jwt.claims', '{"role":"authenticated","email":"zz-agr-admin@mygoodbooks.org","app_metadata":{"provider":"google","providers":["google"]}}', true);
do $$
begin
  update public.client_agreements set trashed_at = null where id = '00000000-0000-4000-8000-0000000000a3';
  if (select trashed_at from public.client_agreements where id = '00000000-0000-4000-8000-0000000000a3') is not null then raise exception 'FAIL 8a: restore failed'; end if;
  if (select trashed_by from public.client_agreements where id = '00000000-0000-4000-8000-0000000000a3') is not null then raise exception 'FAIL 8b: trashed_by kept'; end if;
end $$;

-- 9. Anon: no table, no RPC.
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
do $$
declare n int;
begin
  begin
    select count(*) into n from public.client_agreements;
    raise exception 'FAIL 9a: anon selected';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.client_agreements_mine('zz-agr-a');
    raise exception 'FAIL 9b: anon ran the RPC';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
rollback;
