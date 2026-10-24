-- View as (read-only) + admin "Last seen" (2026-10-16). Safe to re-run.
-- Applied to production 2026-10-24 (Supabase migration view_as_last_seen); tests file passed.
--
-- docs/view-as-full-app-spec.md §4. Run AFTER usage-stats-2.sql,
-- audit2-telemetry-binding.sql, audit-log.sql and
-- internal-company-profile.sql (the usage_summary patch in 4.5 anchors on
-- the text internal-company-profile.sql left in it).
--
--   usage_events     + browser, app_version (Last seen) and view_as (an
--                    admin's View as page views and actions, left out of
--                    Usage Stats and Last seen)
--   telemetry_force_now()  usage_events.occurred_at / client_errors.created_at
--                    are always the server's now()
--   client_errors    insert policy binds actor_email to the session and
--                    bounds every text column
--   staff_last_seen(email)  admins only: last page view, last sign-in, last
--                    error, errors in the last 7 days
--   log_audit_event  + view_as.blocked; every view_as.* action is admin-only
--                    (supersedes the copy in audit-log.sql, which mirrors it)
--   usage_summary    skips view_as rows
--
-- Deploy order: apply this BEFORE (or with) the app change. The app now
-- sends browser / app_version / view_as on every usage_events insert, and
-- PostgREST rejects unknown columns, so page-view logging stops until the
-- columns exist.
--
-- No retention job (owner decision Q5: no automatic deletion).
--
-- Re-checked against live definitions 2026-10-23 (origin/main 646d3ac):
-- usage_events insert policy "signed-in users can log their own usage" binds
-- actor_email/actor_role/client_id only (column-agnostic); client_errors insert
-- policy "signed-in users can report errors" is still auth.role() only;
-- log_audit_event still allows only view_as.start/stop + portal_preview.*
-- (4.4 below keeps those and adds view_as.blocked); usage_summary(integer)
-- has exactly 11 anchors and no view_as yet; no triggers on either table;
-- 0 mixed-case emails; 0 client_errors rows over the 4.2 bounds.

begin;

-- 4.1 usage_events: browser + app version on every page view (spec D8).
alter table usage_events add column if not exists browser text;
alter table usage_events add column if not exists app_version text;
alter table usage_events drop constraint if exists usage_events_browser_len;
alter table usage_events add constraint usage_events_browser_len
  check (browser is null or length(browser) <= 80) not valid;
alter table usage_events drop constraint if exists usage_events_app_version_len;
alter table usage_events add constraint usage_events_app_version_len
  check (app_version is null or length(app_version) <= 40) not valid;
-- View as marker (not detail: MGB_track already uses detail for actions).
alter table usage_events add column if not exists view_as boolean not null default false;
-- Insert policy (audit2-telemetry-binding.sql) is column-agnostic: no change.

-- 4.1b Server time only. Without this anyone signed in can insert their own
-- row dated in the future and look "last seen" forever.
create or replace function public.telemetry_force_now()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_table_name = 'usage_events' then
    new.occurred_at := now();
  else
    new.created_at := now();
  end if;
  return new;
end
$$;
drop trigger if exists usage_events_force_now on usage_events;
create trigger usage_events_force_now before insert on usage_events
  for each row execute function public.telemetry_force_now();
drop trigger if exists client_errors_force_now on client_errors;
create trigger client_errors_force_now before insert on client_errors
  for each row execute function public.telemetry_force_now();

-- 4.2 client_errors: bind actor_email to the session and bound the sizes.
-- (MGB_reportError already trims to these limits.)
drop policy if exists "signed-in users can report errors" on client_errors;
create policy "signed-in users can report errors"
  on client_errors for insert
  with check (
    auth.role() = 'authenticated'
    and (actor_email is null or lower(actor_email) = lower(auth.jwt() ->> 'email'))
    and length(message) <= 500
    and (stack is null or length(stack) <= 4000)
    and (source is null or length(source) <= 300)
    and (user_agent is null or length(user_agent) <= 300)
    and (page is null or length(page) <= 100)
    and (app_version is null or length(app_version) <= 40)
    and (device is null or length(device) <= 40)
    and (actor_role is null or length(actor_role) <= 20)
  );
create index if not exists client_errors_actor_idx on client_errors (lower(actor_email), created_at desc);

-- 4.3 staff_last_seen: admins only (temporary admins are role 'bookkeeper' in
-- SQL, so is_active_staff_admin() already excludes them).
create or replace function public.staff_last_seen(p_email text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  e text := lower(trim(coalesce(p_email, '')));
  result jsonb;
begin
  if not public.is_active_staff_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from staff s where lower(s.email) = e) then
    raise exception 'not a staff member' using errcode = '22023';
  end if;
  select jsonb_build_object(
    'last_view', (
      select to_jsonb(x) from (
        select occurred_at, page, tab, device, browser, app_version
        from usage_events
        -- Exact match keeps usage_events_actor_idx in use. The insert policy
        -- stores the JWT email as-is; 0 mixed-case rows (re-checked 2026-10-23).
        where actor_email = e and kind = 'view' and not view_as
        order by occurred_at desc limit 1
      ) x),
    'last_action_at', (select max(occurred_at) from usage_events where actor_email = e and not view_as),
    'last_sign_in_at', (select u.last_sign_in_at from auth.users u where lower(u.email) = e limit 1),
    'last_error', (
      select to_jsonb(x) from (
        select created_at, page, left(message, 200) as message, source, app_version, device, user_agent
        from client_errors
        where lower(actor_email) = e
        order by created_at desc limit 1
      ) x),
    'errors_7d', (select count(*) from client_errors
                  where lower(actor_email) = e and created_at >= now() - interval '7 days')
  ) into result;
  return result;
end
$$;
revoke all on function public.staff_last_seen(text) from public, anon;
grant execute on function public.staff_last_seen(text) to authenticated;

-- 4.4 log_audit_event: allow view_as.blocked (stop already allowed; details carry reason).
-- view_as.* is admin-only: only admins can View as, so a bookkeeper writing
-- view_as.start naming someone else would be a forged row.
-- Mirrored in audit-log.sql so a re-run of that file keeps view_as.blocked.
create or replace function public.log_audit_event(
  p_action text, p_client_id text default null, p_details jsonb default '{}'::jsonb
) returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if not public.is_active_staff() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_action like 'view\_as.%' and not public.is_active_staff_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_action not in ('view_as.start', 'view_as.stop', 'view_as.blocked',
                      'portal_preview.start', 'portal_preview.stop') then
    raise exception 'unknown audit action %', p_action using errcode = '22023';
  end if;
  if p_client_id is not null and not public.can_access_client(p_client_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  insert into audit_log (actor_email, action, client_id, target_type, target_id, details)
  values (
    auth.jwt() ->> 'email', p_action, p_client_id,
    case when p_action like 'view_as.%' then 'staff' else 'client_user' end,
    left(coalesce(p_details ->> 'target', ''), 200),
    case when length(coalesce(p_details, '{}'::jsonb)::text) <= 2000
         then coalesce(p_details, '{}'::jsonb) else '{}'::jsonb end
  );
end;
$$;
revoke all on function public.log_audit_event(text, text, jsonb) from public, anon;
grant execute on function public.log_audit_event(text, text, jsonb) to authenticated;

-- 4.5 usage_summary: exclude View as activity from every count (pages, weeks,
-- people, actions). Patches the live definition (pg_get_functiondef) in
-- place, the same way internal-company-profile.sql did: each of the 11
-- usage_events subqueries it wrapped gets `and not ue.view_as`. Skipped when
-- already patched; raises if the anchor count is off (definition changed
-- since, so look before forcing it).
create or replace function pg_temp.patch_fn(p_sig text, p_from text, p_to text, p_expected int)
returns void
language plpgsql
as $f$
declare
  d text;
  n int;
begin
  d := pg_get_functiondef(p_sig::regprocedure);
  if position(p_to in d) > 0 then
    return;  -- already patched
  end if;
  n := (length(d) - length(replace(d, p_from, ''))) / length(p_from);
  if n <> p_expected then
    raise exception 'patch_fn %: expected % occurrence(s) of anchor %, found %', p_sig, p_expected, p_from, n;
  end if;
  execute replace(d, p_from, p_to);
end
$f$;

select pg_temp.patch_fn('public.usage_summary(integer)',
  $a$where ue.client_id is null or public.is_roster_client_id(ue.client_id))$a$,
  $a$where (ue.client_id is null or public.is_roster_client_id(ue.client_id)) and not ue.view_as)$a$, 11);

commit;
