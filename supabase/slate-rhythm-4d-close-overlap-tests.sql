-- =====================================================================
-- Self-test for slate-rhythm-4d-close-overlap.sql (the rhythm replaces the close steps).
-- Ends in ROLLBACK: the switches it forces (month_rhythm_enabled, standard_set_live)
-- and the opt-in row it adds exist only inside this transaction. No email is sent.
-- People and clients are picked at run time; no names or emails live in this file.
-- A failed check raises; the last select returns 'all ok'.
-- =====================================================================
begin;

create temp table t_ctx (k text primary key, v text) on commit drop;
grant select on t_ctx to authenticated;
create or replace function pg_temp.ctx(p_k text) returns text language sql as $$ select v from t_ctx where k = p_k $$;
create or replace function pg_temp.as_user(p_email text) returns void language sql as $$
  select set_config('request.jwt.claims',
    case when p_email is null then '' else json_build_object(
      'sub', gen_random_uuid(), 'email', p_email, 'role', 'authenticated',
      'app_metadata', json_build_object('provider', 'google'))::text end, true);
$$;
create or replace function pg_temp.ok(p_cond boolean, p_what text) returns void language plpgsql as $$
begin
  if p_cond is not true then raise exception 'SELF-TEST FAILED: %', p_what; end if;
end $$;
-- how many dry-run entries for p_client come from the standard set's five step templates
create or replace function pg_temp.close_steps(r jsonb, p_client text) returns int language sql as $$
  select count(*)::int
    from jsonb_array_elements(coalesce(r -> 'would_create', '[]') || coalesce(r -> 'upcoming', '[]')
                              || coalesce(r -> 'skipped', '[]') || coalesce(r -> 'missed', '[]')) x
    join task_templates t on t.id = (x ->> 'template')::uuid
    join tk_template_sets s on s.id = t.template_set_id and s.is_standard
   where x ->> 'client' = p_client and public.tk__is_close_task_key(t.close_key);
$$;
create or replace function pg_temp.rhythm_rows(r jsonb, p_client text) returns int language sql as $$
  select count(*)::int
    from jsonb_array_elements(coalesce(r -> 'would_create', '[]') || coalesce(r -> 'upcoming', '[]')
                              || coalesce(r -> 'skipped', '[]')) x
    join task_templates t on t.id = (x ->> 'template')::uuid
    join tk_template_sets s on s.id = t.template_set_id and s.gate_key = 'month_rhythm_enabled'
   where x ->> 'client' = p_client;
$$;
grant execute on function pg_temp.ctx(text), pg_temp.ok(boolean, text), pg_temp.as_user(text) to authenticated;

-- 0. Shape
select pg_temp.ok(not has_function_privilege('authenticated', 'public.tk__rhythm_covers_client(text)', 'execute')
              and not has_function_privilege('anon', 'public.tk__rhythm_covers_client(text)', 'execute'),
                  'covers helper is internal');
select pg_temp.ok(position('slate rhythm 4d' in pg_get_functiondef('public.tk__generate(date,boolean,text,integer,text,uuid)'::regprocedure)) > 0,
                  'generator patched');

-- People and clients: a real roster client with a bookkeeper, a named test client, an admin
insert into t_ctx select 'real', cl.id from clients cl
 where public.is_roster_client(cl)
   and exists (select 1 from public.tk__client_people(cl.id) p where p.role = 'bookkeeper')
 order by cl.id limit 1;
insert into t_ctx select 'test', cl.id from clients cl where coalesce(cl.test_only, false) order by cl.id limit 1;
insert into t_ctx select 'admin', lower(s.email) from staff s where s.active and s.role = 'admin' order by s.email limit 1;
select pg_temp.ok(pg_temp.ctx('real') is not null and pg_temp.ctx('test') is not null and pg_temp.ctx('admin') is not null,
                  'test people and clients found');
select pg_temp.ok(public.tk__rhythm_covers_client(pg_temp.ctx('real')), 'the rhythm covers the real client');

-- Setup inside this transaction: the close set live since September, rhythm templates active since October
set local mgb.tk_owner_override = 'on';
insert into tk_settings (key, value) values ('standard_set_live', 'true')
on conflict (key) do update set value = excluded.value;
insert into tk_settings (key, value) values ('month_rhythm_enabled', 'false')
on conflict (key) do update set value = excluded.value;
update tk_template_sets set live_since = timestamptz '2026-09-01 12:00-05' where is_standard;
update task_templates set activated_at = timestamptz '2026-09-01 12:00-05'
 where template_set_id in (select id from tk_template_sets where is_standard);

do $t$
declare
  r jsonb;
  n int;
  v_real text := pg_temp.ctx('real');
  v_test text := pg_temp.ctx('test');
begin
  -- 1. Rhythm off, set live: the real client gets the close steps (unchanged behavior)
  r := public.tk__generate('2026-12-01', true, v_real, 40, 'selftest', null);
  n := pg_temp.close_steps(r, v_real);
  perform pg_temp.ok(n > 0, format('rhythm off: real client lists close steps (%s)', n));
  perform pg_temp.ok(pg_temp.rhythm_rows(r, v_real) = 0, 'rhythm off: no rhythm rows for the real client');

  -- 2. Rhythm on: the real client gets rhythm rows and no close steps
  update tk_settings set value = 'true' where key = 'month_rhythm_enabled';
  update tk_template_sets set live_since = timestamptz '2026-10-01 12:00-05' where gate_key = 'month_rhythm_enabled';
  update task_templates set activated_at = timestamptz '2026-10-01 12:00-05'
   where template_set_id in (select id from tk_template_sets where gate_key = 'month_rhythm_enabled');
  r := public.tk__generate('2026-12-01', true, v_real, 40, 'selftest', null);
  perform pg_temp.ok(pg_temp.close_steps(r, v_real) = 0, 'rhythm on: real client lists no close steps');
  perform pg_temp.ok(pg_temp.rhythm_rows(r, v_real) > 0, 'rhythm on: real client lists rhythm rows');
  r := public.tk__generate('2026-12-01', true, null, 40, 'selftest', null);
  perform pg_temp.ok(pg_temp.close_steps(r, v_real) = 0, 'rhythm on: roster run lists no close steps for the real client');

  -- 3. Rhythm on, opted in: still no close steps
  insert into tk_client_close_optin (client_id, enabled_at, enabled_by)
  values (v_real, timestamptz '2026-10-01 12:00-05', pg_temp.ctx('admin'))
  on conflict (client_id) do update set disabled_at = null, enabled_at = excluded.enabled_at;
  r := public.tk__generate('2026-12-01', true, v_real, 40, 'selftest', null);
  perform pg_temp.ok(pg_temp.close_steps(r, v_real) = 0, 'rhythm on: opted-in real client lists no close steps');

  -- 4. Rhythm on, named test client: both still listed, so the owner can compare
  r := public.tk__generate('2026-12-01', true, v_test, 40, 'selftest', null);
  perform pg_temp.ok(pg_temp.close_steps(r, v_test) > 0, 'rhythm on: named test client still lists close steps');

  -- 5. A client every rhythm template skips is not covered, so its close steps stay
  perform pg_temp.ok(not public.tk__rhythm_covers_client('no-such-client'), 'unknown client is not covered');
end $t$;

-- 6. Opt-in status: rhythm templates never listed; rhythm_replaces follows the switch
select pg_temp.as_user(pg_temp.ctx('admin'));
select pg_temp.ok((public.tk_close_optin_status(pg_temp.ctx('real')) ->> 'rhythm_replaces')::boolean,
                  'status: rhythm on says it replaces the close steps');
select pg_temp.ok(not exists (select 1 from jsonb_array_elements(public.tk_close_optin_status(pg_temp.ctx('real')) -> 'overlaps') x
                               join task_templates t on t.id = (x ->> 'id')::uuid
                               join tk_template_sets s on s.id = t.template_set_id and s.gate_key = 'month_rhythm_enabled'),
                  'status: no rhythm template listed as an overlap (switch on)');
select pg_temp.as_user(null);
update tk_settings set value = 'false' where key = 'month_rhythm_enabled';
select pg_temp.as_user(pg_temp.ctx('admin'));
select pg_temp.ok(not (public.tk_close_optin_status(pg_temp.ctx('real')) ->> 'rhythm_replaces')::boolean,
                  'status: rhythm off says it does not replace');
select pg_temp.as_user(null);

select 'all ok' as result;
rollback;
