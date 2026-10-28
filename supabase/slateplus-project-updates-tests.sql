-- =====================================================================
-- Self-test for slateplus-project-updates.sql (Slate plus project status
-- updates). Run it whole after the migration. It ends in ROLLBACK, so the
-- test project, members and updates it makes are never kept. People are
-- picked at run time; no names or emails live in this file. A failed check
-- raises; a run with no error is a pass.
-- Ran clean on production 2026-10-28 (rolled back; 0 rows kept, checked),
-- and again after slateplus-project-updates-hidefix.sql (hide = managers
-- only; no un-hide through the API).
-- =====================================================================
begin;

create temp table t_ctx (k text primary key, v text) on commit drop;
grant select on t_ctx to authenticated, anon;
create or replace function pg_temp.ctx(p_k text) returns text language sql as $$ select v from t_ctx where k = p_k $$;
create or replace function pg_temp.as_user(p_email text) returns void language sql as $$
  select set_config('request.jwt.claims',
    case when p_email is null then '' else json_build_object(
      'sub', gen_random_uuid(),
      'email', coalesce((select s.email from staff s where lower(s.email) = lower(p_email) limit 1), p_email),
      'role', 'authenticated', 'app_metadata', json_build_object('provider', 'google'))::text end, true);
$$;
create or replace function pg_temp.ok(p_cond boolean, p_what text) returns void language plpgsql as $$
begin
  if p_cond is not true then raise exception 'SELF-TEST FAILED: %', p_what; end if;
  raise notice 'ok: %', p_what;
end $$;

-- 0. Shape -------------------------------------------------------------------
select pg_temp.ok((select relrowsecurity from pg_class where oid = 'public.tk_project_updates'::regclass)
              and not has_table_privilege('anon', 'public.tk_project_updates', 'select')
              and not has_table_privilege('anon', 'public.tk_project_updates', 'insert')
              and has_table_privilege('authenticated', 'public.tk_project_updates', 'select')
              and not has_table_privilege('authenticated', 'public.tk_project_updates', 'delete')
              and not has_table_privilege('authenticated', 'public.tk_project_updates', 'truncate')
              and not has_column_privilege('authenticated', 'public.tk_project_updates', 'body', 'update')
              and has_column_privilege('authenticated', 'public.tk_project_updates', 'hidden_at', 'update')
              and not has_column_privilege('authenticated', 'public.tk_project_updates', 'author_email', 'insert')
              and not has_table_privilege('anon', 'public.tk_project_update_latest', 'select'),
                  'RLS on; anon nothing; no delete; insert/update column grants only');
select pg_temp.ok((select count(*) from pg_policies where schemaname = 'public' and tablename = 'tk_project_updates') = 3
              and not exists (select 1 from pg_policies where tablename = 'tk_project_updates' and cmd = 'DELETE'),
                  'three policies (read, insert, hide), no delete policy');

-- People: own = project owner (non-admin), mem = plain member (non-admin),
-- out = non-admin with no access, adm = an admin, cl = a non-staff login.
insert into t_ctx select 'own', s.email from staff s where s.active and s.role <> 'admin' order by s.email limit 1;
insert into t_ctx select 'mem', s.email from staff s where s.active and s.role <> 'admin' and s.email <> pg_temp.ctx('own') order by s.email limit 1;
insert into t_ctx select 'out', s.email from staff s where s.active and s.role <> 'admin' and s.email not in (pg_temp.ctx('own'), pg_temp.ctx('mem')) order by s.email limit 1;
insert into t_ctx select 'adm', s.email from staff s where s.active and s.role = 'admin' order by s.email limit 1;
insert into t_ctx values ('cl', 'projupdates-selftest-client@example.invalid');
select pg_temp.ok(pg_temp.ctx('own') is not null and pg_temp.ctx('mem') is not null and pg_temp.ctx('out') is not null
              and pg_temp.ctx('adm') is not null, 'test people found');

-- 1. Set up as the owner, through RLS: an internal project, mem as a member.
do $$
declare v_p uuid;
begin
  perform pg_temp.as_user(pg_temp.ctx('own'));
  set local role authenticated;
  insert into public.tk_projects (name, kind, owner_email)
    values ('projupdates selftest ' || gen_random_uuid(), 'internal', lower(pg_temp.ctx('own')))
    returning id into v_p;
  insert into public.tk_project_members (project_id, staff_email, role) values (v_p, lower(pg_temp.ctx('mem')), 'member');
  reset role;
  insert into t_ctx values ('p', v_p::text);
end $$;

-- 2. Posting, reading, hiding as each person -----------------------------------
do $$
declare
  v_p uuid := pg_temp.ctx('p')::uuid;
  v_u1 uuid;
  v_u2 uuid;
  v_n bigint;
  v_t text;
begin
  -- owner posts; author and time are stamped, text trimmed
  perform pg_temp.as_user(pg_temp.ctx('own'));
  set local role authenticated;
  insert into public.tk_project_updates (project_id, status, body) values (v_p, 'at_risk', '  Waiting on the bank  ')
    returning id into v_u1;
  select author_email || '|' || body into v_t from public.tk_project_updates where id = v_u1;
  if v_t <> lower(pg_temp.ctx('own')) || '|Waiting on the bank' then raise exception 'SELF-TEST FAILED: stamp/trim got %', v_t; end if;
  begin
    insert into public.tk_project_updates (project_id, status, body, author_email) values (v_p, 'on_track', 'x', 'someone@example.invalid');
    raise exception 'SELF-TEST FAILED: author_email insert allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.tk_project_updates (project_id, status, body) values (v_p, 'great', 'x');
    raise exception 'SELF-TEST FAILED: bad status allowed';
  exception when check_violation then null;
  end;
  begin
    insert into public.tk_project_updates (project_id, status, body) values (v_p, 'on_track', '   ');
    raise exception 'SELF-TEST FAILED: blank body allowed';
  exception when check_violation then null;
  end;
  begin
    insert into public.tk_project_updates (project_id, status, body) values (v_p, 'on_track', repeat('x', 1001));
    raise exception 'SELF-TEST FAILED: 1001-char body allowed';
  exception when check_violation then null;
  end;
  begin
    update public.tk_project_updates set body = 'edited' where id = v_u1;
    raise exception 'SELF-TEST FAILED: body edit allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.tk_project_updates where id = v_u1;
    raise exception 'SELF-TEST FAILED: delete allowed';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- plain member: reads, cannot post or hide
  perform pg_temp.as_user(pg_temp.ctx('mem'));
  set local role authenticated;
  select count(*) into v_n from public.tk_project_updates where project_id = v_p;
  if v_n <> 1 then raise exception 'SELF-TEST FAILED: member reads % (expected 1)', v_n; end if;
  begin
    insert into public.tk_project_updates (project_id, status, body) values (v_p, 'on_track', 'member try');
    raise exception 'SELF-TEST FAILED: plain member posted';
  exception when insufficient_privilege then null;
  end;
  update public.tk_project_updates set hidden_at = now() where id = v_u1;
  get diagnostics v_n = row_count;
  if v_n <> 0 then raise exception 'SELF-TEST FAILED: plain member hid an update'; end if;
  reset role;

  -- an author who is no longer a manager (row made as SQL, stamped as mem)
  -- cannot hide their own update
  perform pg_temp.as_user(pg_temp.ctx('mem'));
  insert into public.tk_project_updates (project_id, status, body) values (v_p, 'on_track', 'old note by mem')
    returning id into v_t;
  insert into t_ctx values ('u3', v_t);
  set local role authenticated;
  update public.tk_project_updates set hidden_at = now() where id = pg_temp.ctx('u3')::uuid;
  get diagnostics v_n = row_count;
  if v_n <> 0 then raise exception 'SELF-TEST FAILED: a non-manager author hid their update'; end if;
  reset role;
  perform pg_temp.as_user(pg_temp.ctx('own'));
  set local role authenticated;
  update public.tk_project_updates set hidden_at = now() where id = pg_temp.ctx('u3')::uuid;
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'SELF-TEST FAILED: owner could not hide the mem update'; end if;
  reset role;

  -- staff with no access: sees nothing, cannot post
  perform pg_temp.as_user(pg_temp.ctx('out'));
  set local role authenticated;
  select count(*) into v_n from public.tk_project_updates where project_id = v_p;
  if v_n <> 0 then raise exception 'SELF-TEST FAILED: outsider reads %', v_n; end if;
  select count(*) into v_n from public.tk_project_update_latest where project_id = v_p;
  if v_n <> 0 then raise exception 'SELF-TEST FAILED: outsider reads the latest view'; end if;
  begin
    insert into public.tk_project_updates (project_id, status, body) values (v_p, 'on_track', 'outsider try');
    raise exception 'SELF-TEST FAILED: outsider posted';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- admin posts a newer update; the owner hides it
  perform pg_temp.as_user(pg_temp.ctx('adm'));
  set local role authenticated;
  insert into public.tk_project_updates (project_id, status, body) values (v_p, 'off_track', 'Admin note')
    returning id into v_u2;
  reset role;
  perform pg_temp.as_user(pg_temp.ctx('own'));
  set local role authenticated;
  update public.tk_project_updates set hidden_at = '2000-01-01' where id = v_u2;
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'SELF-TEST FAILED: owner could not hide'; end if;
  select coalesce(hidden_by, '') || '|' || (hidden_at > now() - interval '1 minute')::text into v_t from public.tk_project_updates where id = v_u2;
  if v_t <> lower(pg_temp.ctx('own')) || '|true' then raise exception 'SELF-TEST FAILED: hide stamp got %', v_t; end if;
  begin
    update public.tk_project_updates set hidden_at = null where id = v_u2;
    raise exception 'SELF-TEST FAILED: un-hide allowed through the API';
  exception when insufficient_privilege then null;
  end;
  reset role;
  perform pg_temp.as_user(pg_temp.ctx('adm'));
  set local role authenticated;
  begin
    update public.tk_project_updates set hidden_at = null where id = v_u2;
    raise exception 'SELF-TEST FAILED: admin un-hide allowed through the API';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- member no longer sees the admin's hidden one (still sees their own
  -- hidden note); the latest view skips both
  perform pg_temp.as_user(pg_temp.ctx('mem'));
  set local role authenticated;
  select count(*) into v_n from public.tk_project_updates where project_id = v_p;
  if v_n <> 2 then raise exception 'SELF-TEST FAILED: member reads % after hide (expected 2: visible + own hidden)', v_n; end if;
  select count(*) into v_n from public.tk_project_updates where id = v_u2;
  if v_n <> 0 then raise exception 'SELF-TEST FAILED: member reads the admin hidden update'; end if;
  select id::text into v_t from public.tk_project_update_latest where project_id = v_p;
  if v_t is distinct from v_u1::text then raise exception 'SELF-TEST FAILED: latest view shows % (expected the visible one)', v_t; end if;
  reset role;

  -- the admin (author) still reads both hidden ones
  perform pg_temp.as_user(pg_temp.ctx('adm'));
  set local role authenticated;
  select count(*) into v_n from public.tk_project_updates where project_id = v_p;
  if v_n <> 3 then raise exception 'SELF-TEST FAILED: admin reads % (expected 3 incl. hidden)', v_n; end if;
  reset role;

  -- restoring in SQL (no API role) works and clears hidden_by
  update public.tk_project_updates set hidden_at = null where id = v_u2;
  select coalesce(hidden_by, 'none') into v_t from public.tk_project_updates where id = v_u2;
  if v_t <> 'none' then raise exception 'SELF-TEST FAILED: SQL restore left hidden_by %', v_t; end if;

  -- a client login and anon
  perform pg_temp.as_user(pg_temp.ctx('cl'));
  set local role authenticated;
  select count(*) into v_n from public.tk_project_updates;
  if v_n <> 0 then raise exception 'SELF-TEST FAILED: a client reads %', v_n; end if;
  reset role;
  perform pg_temp.as_user(null);
  set local role anon;
  begin
    select count(*) into v_n from public.tk_project_updates;
    raise exception 'SELF-TEST FAILED: anon read the table';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- trashed project: its updates disappear for the owner too
  perform pg_temp.as_user(pg_temp.ctx('adm'));
  set local role authenticated;
  perform public.tk_project_trash(v_p);
  reset role;
  perform pg_temp.as_user(pg_temp.ctx('own'));
  set local role authenticated;
  select count(*) into v_n from public.tk_project_updates where project_id = v_p;
  if v_n <> 0 then raise exception 'SELF-TEST FAILED: owner reads % on a trashed project', v_n; end if;
  begin
    insert into public.tk_project_updates (project_id, status, body) values (v_p, 'on_track', 'after trash');
    raise exception 'SELF-TEST FAILED: posted on a trashed project';
  exception when insufficient_privilege then null;
  end;
  reset role;
  raise notice 'ok: post, read, hide (managers only), no API un-hide, SQL restore, outsider, client, anon, trash';
end $$;

rollback;
