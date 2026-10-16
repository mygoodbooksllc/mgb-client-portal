-- =====================================================================
-- Self-test: the owner-only "Ask client emails live" switch
-- (client_email_settings.client_request_enabled) as the Emails page saves it
-- (components/staff/ClientEmailSettings.jsx: a plain update of
-- client_email_settings under the signed-in user's JWT, RLS on).
--
-- No schema change goes with this test: the save path already exists.
-- RLS "admins update client email settings" lets admins update the row,
-- and trigger tk_guard_client_request_switch (supabase/tasks-p2-5-requests.sql)
-- refuses the switch for anyone but public.is_internal_owner() and writes a
-- tk_settings_audit row (who, when, old, new) for every change.
--
-- Run it whole; it ends in ROLLBACK, so nothing it writes is kept: the
-- switch, the audit rows and everything else go back to how they were. The
-- owner flip below never commits and sends nothing (sending happens only
-- in edge functions, which never see this uncommitted transaction).
-- People are picked at run time; no names or emails live in this file.
-- A failed check raises and stops the run.
-- =====================================================================
begin;

create temp table t_ctx (k text primary key, v text) on commit drop;
grant all on t_ctx to authenticated;

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
-- Rows a statement touched, run as the current role (RLS applies).
create or replace function pg_temp.rows(p_sql text) returns int language plpgsql as $$
declare n int;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
end $$;

-- Starting state (read as the migration role, before any switch of role).
insert into t_ctx select 'start', client_request_enabled::text from client_email_settings where id;
insert into t_ctx select 'pilot', coalesce((select value::text from tk_settings where key = 'client_request_pilot'), '<missing>');
insert into t_ctx select 'audit0', count(*)::text from tk_settings_audit where key = 'client_email_settings.client_request_enabled';
select pg_temp.ok(pg_temp.ctx('start') = 'false', 'the switch starts off (never flipped live)');

-- People: ow = the owner (active admin with internal_access.is_owner),
-- na = an active admin who is not the owner, bk = an active bookkeeper.
insert into t_ctx select 'ow', lower(s.email) from staff s join internal_access ia on ia.staff_email = s.email and ia.is_owner
 where s.active and s.role = 'admin' order by s.email limit 1;
do $$
declare v text;
begin
  for v in select lower(s.email) from staff s where s.active and s.role = 'admin' order by s.email loop
    perform pg_temp.as_user(v);
    if not public.is_internal_owner() then
      insert into t_ctx values ('na', v);
      exit;
    end if;
  end loop;
  perform pg_temp.as_user(null);
end $$;
insert into t_ctx select 'bk', lower(s.email) from staff s where s.active and s.role = 'bookkeeper' order by s.email limit 1;
select pg_temp.ok(pg_temp.ctx('ow') is not null and pg_temp.ctx('na') is not null and pg_temp.ctx('bk') is not null,
                  'found an owner, a non-owner admin and a bookkeeper');

set local role authenticated;

-- 1. A non-owner admin cannot turn it on (the Emails page's exact update).
select pg_temp.as_user(pg_temp.ctx('na'));
select pg_temp.ok(not public.is_internal_owner(), 'non-owner admin: is_internal_owner() is false (row shows Owner only)');
select pg_temp.ok((select count(*) = 1 from client_email_settings where id), 'non-owner admin can read the settings row');
select pg_temp.expect_err($q$update client_email_settings set client_request_enabled = true where id = true$q$, 'tk_owner_only',
                          'non-owner admin cannot turn Ask client emails live on');
select pg_temp.ok(pg_temp.rows($q$update client_email_settings set reply_to = reply_to where id = true$q$) = 1,
                  'control: the same admin can still save other Client emails settings');
select pg_temp.ok((select not client_request_enabled from client_email_settings where id), 'switch still off after the refused try');

-- 2. A bookkeeper cannot touch the row at all (RLS: 0 rows).
select pg_temp.as_user(pg_temp.ctx('bk'));
select pg_temp.ok(pg_temp.rows($q$update client_email_settings set client_request_enabled = true where id = true$q$) = 0,
                  'bookkeeper: update touches no row (RLS)');

-- 3. No JWT (anon-like) is refused by the guard too.
select pg_temp.as_user(null);
select pg_temp.ok(pg_temp.rows($q$update client_email_settings set client_request_enabled = true where id = true$q$) = 0,
                  'no signed-in user: update touches no row (RLS)');

-- 4. The owner path works and is audited (rolled back at the end).
select pg_temp.as_user(pg_temp.ctx('ow'));
select pg_temp.ok(public.is_internal_owner(), 'owner: is_internal_owner() is true (row is clickable)');
select pg_temp.ok(pg_temp.rows($q$update client_email_settings set client_request_enabled = true where id = true$q$) = 1,
                  'owner turns Ask client emails live on');
select pg_temp.ok((select client_request_enabled from client_email_settings where id), 'switch reads on for the owner');
select pg_temp.ok((select a.changed_by = pg_temp.ctx('ow') and a.new_value = 'true'::jsonb and a.old_value = 'false'::jsonb
                     and a.changed_at > now() - interval '1 minute'
                     from tk_settings_audit a where a.key = 'client_email_settings.client_request_enabled'
                     order by a.id desc limit 1),
                  'audit row: owner, off -> on, now (the row line reads it back)');
select pg_temp.ok(pg_temp.rows($q$update client_email_settings set client_request_enabled = false where id = true$q$) = 1,
                  'owner turns it off again (immediate, no confirm needed server-side)');
select pg_temp.ok((select a.new_value = 'false'::jsonb from tk_settings_audit a
                    where a.key = 'client_email_settings.client_request_enabled' order by a.id desc limit 1),
                  'audit row: on -> off');

-- 5. While on, a non-owner still cannot turn it off.
select pg_temp.ok(pg_temp.rows($q$update client_email_settings set client_request_enabled = true where id = true$q$) = 1, 'owner on again');
select pg_temp.as_user(pg_temp.ctx('na'));
select pg_temp.expect_err($q$update client_email_settings set client_request_enabled = false where id = true$q$, 'tk_owner_only',
                          'non-owner admin cannot turn it off either');

-- 6. The page's other reads work for an admin: pilot (tk_settings) and audit.
select pg_temp.ok((select count(*) <= 1 from tk_settings where key = 'client_request_pilot'), 'admin can read the pilot setting');
select pg_temp.ok((select count(*) >= 3 from tk_settings_audit where key = 'client_email_settings.client_request_enabled')
                  , 'admin can read the switch audit');

-- 7. Nothing touched the pilot list.
reset role;
select pg_temp.as_user(null);
select pg_temp.ok(coalesce((select value::text from tk_settings where key = 'client_request_pilot'), '<missing>') = pg_temp.ctx('pilot'),
                  'client_request_pilot unchanged');

select 'Ask client switch self-test passed';
rollback;
