-- =====================================================================
-- Slate month rhythm, slice 5: a client's own rhythm (2026-10-21)
-- Applied to production 2026-10-21 (migration slate_rhythm_5_client_override). Dry-run md5 over
-- the roster + the same 64 clients on 4 dates: identical before and after (e4cadb46..., roster 125bdd9e...).
-- Spec: docs/slate-rhythm-slice-5.md, owner decision 3 in docs/slate-month-rhythm.md.
-- Self-test: supabase/slate-rhythm-5-client-override-tests.sql (rolls back).
--
-- Adds (additive; with no override saved every resolver returns what it did):
--   client_profile.rhythm jsonb null    the client's three days, same shape as
--                                       month_rhythm.parts: [{key, day}] x3;
--                                       null = use the firm rhythm
--   tk_client_rhythm_problem(jsonb)     problem code or null (the firm validator,
--                                       TK_clientRhythmProblem in JS)
--   tk_month_rhythm_merge(jsonb,jsonb)  client over firm, fail closed
--                                       (TK_rhythmForClient in JS)
--   tk__rhythm_for_client(text)         NEW BODY (slice 2 hook): client, then firm,
--                                       then NULL. Callers unchanged: tk__generate,
--                                       tk__issue_period.
--   tk_set_client_rhythm(text, jsonb)   admin RPC: save or clear (null)
--   client_profile_rhythm_guard         BEFORE INSERT/UPDATE/DELETE: only admins
--                                       change it (JWT sessions), value validated
--   client_rhythm_audit + trigger       every change recorded; admins read
--
-- client_profile RLS is staff only (clients have no policy), so clients cannot
-- read the column. No view or column grant needed (see the spec, section 6).
--
-- Re-runnable. Rollback (in this order):
--   create or replace function public.tk__rhythm_for_client(p_client text) returns jsonb
--     language sql stable set search_path = public as $$ select public.tk_month_rhythm(); $$;
--   drop function public.tk_set_client_rhythm(text, jsonb);
--   drop trigger client_profile_rhythm_audit on public.client_profile;
--   drop trigger client_profile_rhythm_guard on public.client_profile;
--   drop function public.client_profile_rhythm_audit(); drop function public.client_profile_rhythm_guard();
--   drop table public.client_rhythm_audit;
--   drop function public.tk_month_rhythm_merge(jsonb, jsonb); drop function public.tk_client_rhythm_problem(jsonb);
--   alter table public.client_profile drop column rhythm;
-- =====================================================================

do $pre$
begin
  if to_regprocedure('public.tk_month_rhythm_problem(jsonb)') is null
     or to_regprocedure('public.tk_month_rhythm()') is null
     or to_regprocedure('public.tk__rhythm_for_client(text)') is null then
    raise exception 'slate rhythm s5: slices 1 and 2 must be applied first';
  end if;
end
$pre$;

-- 1. Column ----------------------------------------------------------------
alter table public.client_profile add column if not exists rhythm jsonb;
comment on column public.client_profile.rhythm is
  'Slate month rhythm override: [{key,day}] x3 (check_in, reports, follow_up). Null = firm rhythm. Admin only (tk_set_client_rhythm).';

-- 2. Validator ---------------------------------------------------------------
create or replace function public.tk_client_rhythm_problem(p jsonb)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p is null or jsonb_typeof(p) = 'null' then null
    else public.tk_month_rhythm_problem(jsonb_build_object('parts', p, 'roll', 'next'))
  end
$$;

-- 3. Merge: client over firm, fail closed --------------------------------------
create or replace function public.tk_month_rhythm_merge(p_firm jsonb, p_client jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select case
    when p_firm is null or public.tk_month_rhythm_problem(p_firm) is not null then null
    when p_client is null or jsonb_typeof(p_client) = 'null' then p_firm
    when public.tk_client_rhythm_problem(p_client) is not null then null
    else jsonb_build_object(
      'parts', (select jsonb_agg(
                         case when fp ? 'label'
                              then jsonb_build_object('key', fp -> 'key', 'label', fp -> 'label',
                                                      'day', to_jsonb(((p_client -> (i::int - 1) ->> 'day')::numeric)::int))
                              else jsonb_build_object('key', fp -> 'key',
                                                      'day', to_jsonb(((p_client -> (i::int - 1) ->> 'day')::numeric)::int))
                         end order by i)
                  from jsonb_array_elements(p_firm -> 'parts') with ordinality as x(fp, i)),
      'roll', p_firm -> 'roll')
  end
$$;

revoke all on function public.tk_client_rhythm_problem(jsonb) from public, anon;
revoke all on function public.tk_month_rhythm_merge(jsonb, jsonb) from public, anon;
grant execute on function public.tk_client_rhythm_problem(jsonb) to authenticated;
grant execute on function public.tk_month_rhythm_merge(jsonb, jsonb) to authenticated;

-- 4. The slice 2 hook: client, then firm, then NULL ------------------------------
-- Security invoker, as before; only SECURITY DEFINER code calls it (no grant to
-- authenticated), so it reads client_profile as the function owner.
create or replace function public.tk__rhythm_for_client(p_client text)
returns jsonb
language sql
stable
set search_path = public
as $$
  select public.tk_month_rhythm_merge(
    public.tk_month_rhythm(),
    (select cp.rhythm from public.client_profile cp where cp.client_id = p_client));
$$;
revoke all on function public.tk__rhythm_for_client(text) from public, anon, authenticated;

-- 5. Audit -----------------------------------------------------------------------
create table if not exists public.client_rhythm_audit (
  id bigint generated always as identity primary key,
  client_id text not null,
  old_value jsonb,
  new_value jsonb,
  changed_by text,
  changed_at timestamptz not null default now()
);
create index if not exists client_rhythm_audit_client_idx on public.client_rhythm_audit (client_id, changed_at desc);
alter table public.client_rhythm_audit enable row level security;
drop policy if exists "client rhythm audit admin read" on public.client_rhythm_audit;
create policy "client rhythm audit admin read" on public.client_rhythm_audit
  for select to authenticated using (public.is_active_staff_admin());
revoke all on public.client_rhythm_audit from anon, authenticated;
grant select on public.client_rhythm_audit to authenticated;

-- 6. Guard: only admins change it; the value is validated ----------------------------
create or replace function public.client_profile_rhythm_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_jwt boolean := coalesce(auth.jwt() ->> 'email', '') <> '';
  v_problem text;
begin
  if tg_op = 'DELETE' then
    if old.rhythm is not null and v_jwt and not public.is_active_staff_admin() then
      raise exception 'tk_forbidden' using errcode = '42501';
    end if;
    return old;
  end if;
  if jsonb_typeof(new.rhythm) = 'null' then
    new.rhythm := null;   -- JSON null is stored as SQL NULL (no override)
  end if;
  if tg_op = 'UPDATE' and new.rhythm is not distinct from old.rhythm then
    return new;
  end if;
  if tg_op = 'INSERT' and new.rhythm is null then
    return new;
  end if;
  if v_jwt and not public.is_active_staff_admin() then
    raise exception 'tk_forbidden' using errcode = '42501';
  end if;
  v_problem := public.tk_client_rhythm_problem(new.rhythm);
  if v_problem is not null then
    raise exception 'tk_month_rhythm_invalid: %', v_problem using errcode = '22023';
  end if;
  return new;
end $$;
revoke all on function public.client_profile_rhythm_guard() from public, anon, authenticated;

drop trigger if exists client_profile_rhythm_guard on public.client_profile;
create trigger client_profile_rhythm_guard before insert or update or delete on public.client_profile
  for each row execute function public.client_profile_rhythm_guard();

create or replace function public.client_profile_rhythm_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then old.rhythm end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then new.rhythm end;
  v_client text := case when tg_op = 'DELETE' then old.client_id else new.client_id end;
begin
  if v_old is not distinct from v_new then
    return null;
  end if;
  insert into public.client_rhythm_audit (client_id, old_value, new_value, changed_by)
  values (v_client, v_old, v_new, nullif(lower(coalesce(auth.jwt() ->> 'email', '')), ''));
  return null;
end $$;
revoke all on function public.client_profile_rhythm_audit() from public, anon, authenticated;

drop trigger if exists client_profile_rhythm_audit on public.client_profile;
create trigger client_profile_rhythm_audit after insert or update or delete on public.client_profile
  for each row execute function public.client_profile_rhythm_audit();

-- 7. Admin RPC: save or clear ---------------------------------------------------------
-- p_parts: [{key, day}] x3, or null / JSON null to use the firm rhythm again.
create or replace function public.tk_set_client_rhythm(p_client_id text, p_parts jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_val jsonb;
  v_problem text;
begin
  if v_me = '' or not public.is_active_staff_admin() or not public.can_access_client(p_client_id) then
    raise exception 'tk_forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from public.clients c where c.id = p_client_id) then
    raise exception 'tk_unknown_client' using errcode = '22023';
  end if;
  if p_parts is null or jsonb_typeof(p_parts) = 'null' then
    v_val := null;
  else
    v_problem := public.tk_client_rhythm_problem(p_parts);
    if v_problem is not null then
      raise exception 'tk_month_rhythm_invalid: %', v_problem using errcode = '22023';
    end if;
    select jsonb_agg(jsonb_build_object('key', e -> 'key', 'day', to_jsonb(((e ->> 'day')::numeric)::int)) order by i)
      into v_val
      from jsonb_array_elements(p_parts) with ordinality as x(e, i);
  end if;
  insert into public.client_profile (client_id, rhythm, updated_by, updated_at)
  values (p_client_id, v_val, v_me, now())
  on conflict (client_id) do update
     set rhythm = excluded.rhythm, updated_by = excluded.updated_by, updated_at = excluded.updated_at
   where client_profile.rhythm is distinct from excluded.rhythm;
  return jsonb_build_object('client_id', p_client_id, 'rhythm', v_val);
end $$;
revoke all on function public.tk_set_client_rhythm(text, jsonb) from public, anon;
grant execute on function public.tk_set_client_rhythm(text, jsonb) to authenticated;

-- 8. Post-checks ------------------------------------------------------------------------
do $c$
begin
  if public.tk__rhythm_for_client('__no_such_client__') is distinct from public.tk_month_rhythm() then
    raise exception 'slate rhythm s5: hook without an override must equal the firm value';
  end if;
  if exists (select 1 from public.client_profile where rhythm is not null) then
    raise exception 'slate rhythm s5: no override should exist yet';
  end if;
  if has_function_privilege('authenticated', 'public.tk__rhythm_for_client(text)', 'execute') then
    raise exception 'slate rhythm s5: hook must not be granted to authenticated';
  end if;
  if has_function_privilege('anon', 'public.tk_set_client_rhythm(text,jsonb)', 'execute') then
    raise exception 'slate rhythm s5: anon can run tk_set_client_rhythm';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.client_rhythm_audit'::regclass) then
    raise exception 'slate rhythm s5: RLS off on client_rhythm_audit';
  end if;
end
$c$;

notify pgrst, 'reload schema';
