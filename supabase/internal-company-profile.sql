-- MGB as the INTERNAL COMPANY PROFILE (database half).
--
-- clients.id = 'mygoodbooks' stops being a "client" and becomes the firm's own
-- books. It keeps everything a client org has (QuickBooks, month close, close
-- checks, GL Review, QBO sync alerts, tasks, documents, notes, Drive) but:
--
--   1. It is left out of client-facing and firm-wide rollups: the three weekly
--      digests, staff performance, usage summary, QBO firm auto-match, client
--      health, client profitability, client reply times and coverage
--      (coverage_overview, grant_coverage_access). The client-emails,
--      notification-emails and gl-review-send edge functions skip it too.
--      ONE shared rule decides who counts in firm-wide numbers: is_roster_client()
--      / is_roster_client_id() = "not test_only and not is_internal". The test
--      clients (basic-test, grace-community) are kept out of the same rollups,
--      plus task/overdue counts, usage stats, hours, template-task generation
--      and the ops client count. Per-client screens are unchanged.
--   2. It is locked down PER PERSON, server-side. The internal row and ALL of
--      its data (every table with a client_id column, the Storage folder, tasks,
--      access/coverage grants) require BOTH an active staff ADMIN (role =
--      'admin'; a temp admin, account manager or bookkeeper is not enough, and
--      neither is "View as", which only changes what the browser displays while
--      the real session stays the admin's) AND a row in internal_access.
--      Only the owner can change who has a row, via set_internal_access().
--
-- Design notes
--   * clients.is_internal is a SEPARATE flag from test_only. test_only flips
--     QuickBooks to the sandbox and hides the org from non-admins; never reuse it.
--   * The permission lives in its own table, not a column on staff, because the
--     "admins can manage staff" policy lets any admin UPDATE staff: a column
--     there would let an admin grant themselves access. internal_access has NO
--     write policy and no write grant; writes go through the owner-only,
--     SECURITY DEFINER set_internal_access().
--   * The lock on child tables is one RESTRICTIVE policy per table with a
--     client_id column ("internal company lock"). Restrictive policies are ANDed
--     with every existing permissive policy, so admin-only, staff_client_access,
--     temp-grant, coverage-grant and client-portal policies cannot bypass it
--     without rewriting each one. service_role and the table owner bypass RLS,
--     so the edge functions, cron and QBO sync keep working untouched.
--     NEW tables with a client_id column need the same policy
--     (supabase/internal-company-profile-tests.sql fails if one is missing).
--   * Functions are changed by patching their CURRENT live definition in place
--     (pg_get_functiondef -> targeted text replace -> CREATE OR REPLACE), so
--     signatures, SECURITY DEFINER, search_path and grants stay byte-identical.
--     Every replacement asserts how many times its anchor text occurs and the
--     whole file is a no-op on a second run.
--   * Soft only: nothing is dropped or deleted except re-creating the clients
--     SELECT policy and the internal-lock policies (drop if exists + create).
--
-- Safe to re-run. Add-only. Apply after: staff-schema, clients-test-only-*,
-- staff-client-access, temp-client-access, audit-log, weekly-digest, and the
-- functions patched below.

-- ===========================================================================
-- 1. The flag, one internal row, the roster helper
-- ===========================================================================
alter table public.clients add column if not exists is_internal boolean not null default false;

-- Only one internal row can ever exist.
create unique index if not exists clients_one_internal on public.clients ((true)) where is_internal;

-- "A real, paying-style client": neither a test org nor the internal profile.
create or replace function public.is_roster_client(c public.clients)
returns boolean
language sql
immutable
as $$
  select not coalesce(c.test_only, false) and not coalesce(c.is_internal, false);
$$;
grant execute on function public.is_roster_client(public.clients) to anon, authenticated, service_role;

-- Same rule for tables keyed by client_id. A null or unknown id counts as
-- roster (firm-level rows stay in the totals). SECURITY DEFINER so a caller who
-- cannot SEE a hidden test/internal client still gets the right answer.
create or replace function public.is_roster_client_id(p_client_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
    select 1 from public.clients c
     where c.id = p_client_id
       and (coalesce(c.test_only, false) or coalesce(c.is_internal, false)));
$$;
grant execute on function public.is_roster_client_id(text) to authenticated, service_role;

-- ===========================================================================
-- 2. Per-admin permission (owner-managed)
-- ===========================================================================
create table if not exists public.internal_access (
  staff_email text primary key,
  is_owner    boolean not null default false,   -- set only by this migration / service role
  granted_by  text,
  granted_at  timestamptz not null default now()
);
alter table public.internal_access enable row level security;
revoke all on table public.internal_access from anon, authenticated;
grant select on table public.internal_access to authenticated;

-- Seed: the owner (Holden Gray, active admin). Everyone else starts without.
insert into public.internal_access (staff_email, is_owner, granted_by)
select s.email, true, 'migration'
  from public.staff s
 where s.name = 'Holden Gray' and s.role = 'admin' and s.active
on conflict (staff_email) do update set is_owner = true;

-- May the CURRENT caller see the internal profile? Active admin + a grant row.
create or replace function public.can_view_internal()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_active_staff_admin()
     and exists (select 1 from public.internal_access ia
                  where ia.staff_email = auth.jwt() ->> 'email');
$$;
grant execute on function public.can_view_internal() to anon, authenticated, service_role;

create or replace function public.is_internal_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_active_staff_admin()
     and exists (select 1 from public.internal_access ia
                  where ia.staff_email = auth.jwt() ->> 'email' and ia.is_owner);
$$;
grant execute on function public.is_internal_owner() to anon, authenticated, service_role;

-- The internal client ids the CURRENT caller may NOT see ('{}' when they may).
-- Evaluated once per statement as an initplan inside the lock policies.
create or replace function public.internal_blocked_ids()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select case when public.can_view_internal() then '{}'::text[]
              else coalesce(array(select c.id from public.clients c where c.is_internal), '{}'::text[]) end;
$$;
grant execute on function public.internal_blocked_ids() to anon, authenticated, service_role;

-- Reads: the caller's own row, or every row for the owner (for the toggle UI).
drop policy if exists "internal access read" on public.internal_access;
create policy "internal access read"
  on public.internal_access for select
  using (staff_email = auth.jwt() ->> 'email' or public.is_internal_owner());

-- Owner-only toggle. p_allowed true = give an active ADMIN access; false = take
-- it away. The owner's own row cannot be changed here, so an admin can never
-- grant themselves (only the owner passes the first check) and the owner can
-- never lock themselves out by accident.
create or replace function public.set_internal_access(p_email text, p_allowed boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller text := auth.jwt() ->> 'email';
  v_target text;
  v_target_role text;
begin
  if not public.is_internal_owner() then
    raise exception 'Only the owner can change who can see the internal company profile.' using errcode = '42501';
  end if;
  select s.email, s.role into v_target, v_target_role
    from public.staff s
   where lower(s.email) = lower(btrim(coalesce(p_email, ''))) and s.active
   limit 1;
  if v_target is null then
    raise exception 'That person is not an active staff member.' using errcode = '22023';
  end if;
  if exists (select 1 from public.internal_access ia where ia.staff_email = v_target and ia.is_owner) then
    raise exception 'The owner always has access.' using errcode = '22023';
  end if;
  if p_allowed then
    if v_target_role <> 'admin' then
      raise exception 'Only an admin can be given access to the internal company profile.' using errcode = '22023';
    end if;
    insert into public.internal_access (staff_email, is_owner, granted_by)
    values (v_target, false, v_caller)
    on conflict (staff_email) do nothing;
  else
    delete from public.internal_access where staff_email = v_target and not is_owner;
  end if;
  perform public.audit_write(
    case when p_allowed then 'internal_access.granted' else 'internal_access.revoked' end,
    null, 'staff', v_target, '{}'::jsonb);
end;
$$;
revoke all on function public.set_internal_access(text, boolean) from public, anon;
grant execute on function public.set_internal_access(text, boolean) to authenticated, service_role;

-- A demoted or deactivated admin loses the grant (it would otherwise silently
-- come back if they were promoted again). The owner's row is never removed.
create or replace function public.internal_access_staff_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- An email change follows through, so a grant (and the owner row) can never be
  -- orphaned by a rename.
  if old.email is distinct from new.email then
    update public.internal_access set staff_email = new.email where staff_email = old.email;
  end if;
  if new.role <> 'admin' or not new.active then
    delete from public.internal_access where staff_email = new.email and not is_owner;
  end if;
  return null;
end;
$$;
revoke all on function public.internal_access_staff_sync() from public, anon, authenticated;
drop trigger if exists internal_access_staff_sync on public.staff;
create trigger internal_access_staff_sync
  after update of role, active, email on public.staff
  for each row execute function public.internal_access_staff_sync();

-- ===========================================================================
-- 3. The lock itself
-- ===========================================================================
-- 3a. can_access_client(): everything keyed through it (GL Review RPCs, tasks,
--     Storage client-uploads, client tools, log_audit_event, ...) inherits it.
create or replace function public.can_access_client(p_client_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (
    public.is_active_staff_admin()
    or (
      public.is_active_staff()
      and (
        exists (
          select 1 from staff_client_access sca
          where sca.staff_email = auth.jwt() ->> 'email'
            and sca.client_id = p_client_id
        )
        or exists (
          select 1 from staff_client_access_grants g
          where g.staff_email = auth.jwt() ->> 'email'
            and g.client_id = p_client_id
            and g.status = 'approved'
            and g.expires_at > now()
        )
      )
    )
  )
  and (
    not exists (select 1 from clients ic where ic.id = p_client_id and ic.is_internal)
    or public.can_view_internal()
  );
$$;

-- Approving access to a client: same lock (nobody can approve grants on MGB
-- without the permission; no such grant can take effect anyway).
create or replace function public.can_approve_client_access(p_client_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (
    public.is_active_staff_admin()
    or (
      public.is_active_staff()
      and exists (
        select 1 from staff_client_access sca
        where sca.staff_email = auth.jwt() ->> 'email'
          and sca.client_id = p_client_id
      )
    )
  )
  and (
    not exists (select 1 from clients ic where ic.id = p_client_id and ic.is_internal)
    or public.can_view_internal()
  );
$$;

-- 3b. The clients table. "client reads own org" (a portal user) is unchanged
--     and still needs no test_only condition; the restrictive policy below
--     additionally hides the internal row from every portal user.
drop policy if exists "staff can read clients" on public.clients;
create policy "staff can read clients"
  on public.clients for select
  using (
    public.is_active_staff()
    and (not is_internal or public.can_view_internal())
    and (
      not test_only
      or public.is_active_staff_admin()
      or exists (
        select 1 from staff_client_access sca
        where sca.staff_email = auth.jwt() ->> 'email'
          and sca.client_id = clients.id
      )
    )
  );

drop policy if exists "internal company lock" on public.clients;
create policy "internal company lock"
  on public.clients as restrictive for all
  using (not is_internal or public.can_view_internal())
  with check (not is_internal or public.can_view_internal());

-- 3c. Every table with a client_id column: one restrictive policy. (Covers
--     admin-only policies, staff_client_access, temp grants, coverage grants and
--     client-portal policies in one place.)
do $$
declare r record;
begin
  for r in
    select c.table_name
      from information_schema.columns c
      join information_schema.tables t
        on t.table_schema = c.table_schema and t.table_name = c.table_name
     where c.table_schema = 'public' and c.column_name = 'client_id' and t.table_type = 'BASE TABLE'
  loop
    execute format('drop policy if exists "internal company lock" on public.%I', r.table_name);
    execute format(
      'create policy "internal company lock" on public.%I as restrictive for all '
      || 'using (client_id is null or client_id <> all ((select public.internal_blocked_ids())::text[])) '
      || 'with check (client_id is null or client_id <> all ((select public.internal_blocked_ids())::text[]))',
      r.table_name);
  end loop;
end $$;

-- ===========================================================================
-- 4. Patch the live functions in place (see header). Temporary helper.
-- ===========================================================================
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

-- 4a. Audit: log is_internal changes next to test_only on the clients trigger.
--     (Done before the flag is set below so the first flip is on record.)
select pg_temp.patch_fn('public.audit_row_change()',
  $a$or (o ->> 'test_only') is distinct from (n ->> 'test_only') then$a$,
  $a$or (o ->> 'test_only') is distinct from (n ->> 'test_only')
         or (o ->> 'is_internal') is distinct from (n ->> 'is_internal') then$a$, 1);
select pg_temp.patch_fn('public.audit_row_change()',
  $a$'test_only', jsonb_build_array(o -> 'test_only', n -> 'test_only')));$a$,
  $a$'test_only', jsonb_build_array(o -> 'test_only', n -> 'test_only'),
            'is_internal', jsonb_build_array(o -> 'is_internal', n -> 'is_internal')));$a$, 1);

-- The flag.
update public.clients set is_internal = true where id = 'mygoodbooks' and not is_internal;

-- 4b. The three weekly digests. The ONE shared rule for "real clients" is
--     is_roster_client(clients) / is_roster_client_id(text): not a test org and
--     not the internal profile. Every cross-client number below uses it.
select pg_temp.patch_fn('public.digest_fee_suggestions(boolean)',
  $a$where p_include_test or not coalesce(c.test_only, false)$a$,
  $a$where (p_include_test or public.is_roster_client(c)) and not c.is_internal$a$, 1);

select pg_temp.patch_fn('public.digest_needs_attention(boolean)',
  $a$where h.status = 'connected'$a$,
  $a$where h.status = 'connected'
         and not coalesce((select ic.is_internal from clients ic where ic.id = h.client_id), false)$a$, 1);
select pg_temp.patch_fn('public.digest_needs_attention(boolean)',
  $a$where h.status <> 'connected'$a$,
  $a$where h.status <> 'connected'
         and not coalesce((select ic.is_internal from clients ic where ic.id = h.client_id), false)$a$, 1);
select pg_temp.patch_fn('public.digest_needs_attention(boolean)',
  $a$and (p_include_test or not coalesce(c.test_only, false))$a$,
  $a$and (p_include_test or not coalesce(c.test_only, false))
           and not coalesce(c.is_internal, false)$a$, 1);
select pg_temp.patch_fn('public.digest_needs_attention(boolean)',
  $a$where s.resolved_at is null and s.last_alerted_at is not null$a$,
  $a$where s.resolved_at is null and s.last_alerted_at is not null
          and not exists (select 1 from clients ic where ic.is_internal and s.key like '%:' || ic.id)$a$, 1);

select pg_temp.patch_fn('public.digest_weekly_data(date,date)',
  $a$coalesce(c.test_only, false) = false$a$,
  $a$public.is_roster_client(c)$a$, 8);
-- Task counts on the staff scorecard skip tasks tied to a test/internal client.
select pg_temp.patch_fn('public.digest_weekly_data(date,date)',
  $a$and t.deleted_at is null) as tasks_done$a$,
  $a$and t.deleted_at is null
                 and (t.client_id is null or public.is_roster_client_id(t.client_id))) as tasks_done$a$, 1);
select pg_temp.patch_fn('public.digest_weekly_data(date,date)',
  $a$and t.deleted_at is null) as tasks_open$a$,
  $a$and t.deleted_at is null
                 and (t.client_id is null or public.is_roster_client_id(t.client_id))) as tasks_open$a$, 1);
select pg_temp.patch_fn('public.digest_weekly_data(date,date)',
  $a$and t.deleted_at is null and t.status <> 'waiting_client') as tasks_overdue$a$,
  $a$and t.deleted_at is null and t.status <> 'waiting_client'
                 and (t.client_id is null or public.is_roster_client_id(t.client_id))) as tasks_overdue$a$, 1);

-- 4c. Firm-wide rollups and matching.
select pg_temp.patch_fn('public.staff_performance(integer,jsonb)',
  $a$not coalesce(c.test_only, false)$a$,
  $a$public.is_roster_client(c)$a$, 2);
select pg_temp.patch_fn('public.staff_performance(integer,jsonb)',
  $a$where r.deleted_at is null   -- tk v1$a$,
  $a$where r.deleted_at is null   -- tk v1
      and (r.client_id is null or public.is_roster_client_id(r.client_id))$a$, 1);

select pg_temp.patch_fn('public.usage_summary(integer)',
  $a$from usage_events u$a$,
  $a$from (select * from public.usage_events ue
          where ue.client_id is null or public.is_roster_client_id(ue.client_id)) u$a$, 1);
select pg_temp.patch_fn('public.usage_summary(integer)',
  $a$from usage_events$a$,
  $a$from (select * from public.usage_events ue
          where ue.client_id is null or public.is_roster_client_id(ue.client_id)) as usage_events$a$, 10);
select pg_temp.patch_fn('public.usage_summary(integer)',
  $a$where not c.test_only$a$,
  $a$where public.is_roster_client(c)$a$, 1);

select pg_temp.patch_fn('public.qbo_firm_auto_match(text)',
  $a$where coalesce(test_only, false) = false and name is not null$a$,
  $a$where public.is_roster_client(clients) and name is not null$a$, 1);
select pg_temp.patch_fn('public.client_health(jsonb)',
  $a$select cl.id from clients cl where public.can_access_client(cl.id)$a$,
  $a$select cl.id from clients cl where public.can_access_client(cl.id) and not cl.is_internal$a$, 1);
select pg_temp.patch_fn('public.client_profitability(date,date,jsonb)',
  $a$left join client_fees f on f.client_id = c.id$a$,
  $a$left join client_fees f on f.client_id = c.id
    where public.is_roster_client(c)$a$, 1);
select pg_temp.patch_fn('public.client_reply_times(date,date)',
  $a$and (v_admin or public.can_access_client(m.client_id))$a$,
  $a$and (v_admin or public.can_access_client(m.client_id))
      and public.is_roster_client_id(m.client_id)$a$, 1);

-- QuickBooks time reports: hours worked for a test/internal customer are not
-- "client hours". By client they are dropped; by staff the person's own total
-- stays, but those minutes no longer count toward client_minutes/client_count.
select pg_temp.patch_fn('public.qbo_hours_by_client(date,date)',
  $a$where a.txn_date between p_from and p_to$a$,
  $a$where a.txn_date between p_from and p_to
      and (r.client_id is null or public.is_roster_client_id(r.client_id))$a$, 1);
select pg_temp.patch_fn('public.qbo_hours_by_staff(date,date)',
  $a$r.client_id as res_client_id,$a$,
  $a$(case when public.is_roster_client_id(r.client_id) then r.client_id end) as res_client_id,$a$, 1);
select pg_temp.patch_fn('public.qbo_hours_by_staff(date,date)',
  $a$coalesce(r.ignored, false) as res_ignored$a$,
  $a$(coalesce(r.ignored, false) or not public.is_roster_client_id(r.client_id)) as res_ignored$a$, 1);

-- Template tasks are no longer generated for test/internal clients (existing
-- ones stay; this only stops new ones appearing in task counts and workload).
select pg_temp.patch_fn('public.tt_generate_template_tasks(date)',
  $a$join clients c on ($a$,
  $a$join clients c on public.is_roster_client(c) and ($a$, 1);

-- Ops: "real clients exist" for the Drive check means real clients only.
select pg_temp.patch_fn('public.ops_health_problems()',
  $a$from clients c where not coalesce(c.test_only, false);$a$,
  $a$from clients c where public.is_roster_client(c);$a$, 1);

-- 4d. Coverage: time-off overview skips test/internal clients; granting
--     coverage on the internal profile is refused.
select pg_temp.patch_fn('public.coverage_overview(date,date)',
  $a$join clients c$a$,
  $a$join (select cc.* from clients cc where public.is_roster_client(cc)) c$a$, 1);
select pg_temp.patch_fn('public.grant_coverage_access(uuid,text)',
  $a$  select * into t from staff_time_off where id = p_time_off_id;$a$,
  $a$  if exists (select 1 from clients ic where ic.id = p_client_id and ic.is_internal) then
    raise exception 'Coverage access is not available for the internal company profile' using errcode = '22023';
  end if;
  select * into t from staff_time_off where id = p_time_off_id;$a$, 1);

-- 4e. Access requests (definer insert bypasses RLS) and task visibility.
select pg_temp.patch_fn('public.request_client_access(text,text,integer)',
  $a$if not exists (select 1 from clients where id = p_client_id) then$a$,
  $a$if not exists (select 1 from clients where id = p_client_id and (not is_internal or public.can_view_internal())) then$a$, 1);
select pg_temp.patch_fn('public.tk_row_readable(uuid,text,text,text,uuid,text)',
  $a$  if lower(p_owner) = v_me then return true; end if;$a$,
  $a$  if p_client is not null and p_client = any (public.internal_blocked_ids()) then return false; end if;
  if lower(p_owner) = v_me then return true; end if;$a$, 1);
select pg_temp.patch_fn('public.tk_staff_has_client(text,text)',
  $a$begin
  return exists ($a$,
  $a$begin
  if exists (select 1 from clients ic where ic.id = p_client and ic.is_internal) then
    -- internal company profile: only an active admin who holds the permission
    return exists (
      select 1 from staff s join internal_access ia on ia.staff_email = s.email
      where lower(s.email) = lower(p_email) and s.active and s.role = 'admin');
  end if;
  return exists ($a$, 1);

-- ===========================================================================
-- 5. Review follow-ups (all add-only and idempotent)
-- ===========================================================================
-- 5a. Task edit paths. Every write path (tk_attachments, tk_followers,
--     task_checklist_items, tk_set_status, complete_staff_item, tk_add_follower,
--     tk_attach_client_file, tk_can_upload_task_file) already funnels through
--     tk_can_edit_task(), which let ANY admin through. It now says no for a
--     task on the internal client unless the caller holds the permission.
create or replace function public.tk_task_internal_blocked(p_task uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.staff_reminders r
                  where r.id = p_task and r.client_id = any (public.internal_blocked_ids()));
$$;
revoke all on function public.tk_task_internal_blocked(uuid) from public, anon;
grant execute on function public.tk_task_internal_blocked(uuid) to authenticated, service_role;

select pg_temp.patch_fn('public.tk_can_edit_task(uuid)',
  $a$if not public.is_active_staff() then return false; end if;$a$,
  $a$if not public.is_active_staff() then return false; end if;
  if v_r.client_id is not null and v_r.client_id = any (public.internal_blocked_ids()) then return false; end if;$a$, 1);

-- The comment-edit policy had a bare "or is_active_staff_admin()".
alter policy "tk comments update" on public.tk_comments
  using (((lower(author_email) = lower(coalesce(auth.jwt() ->> 'email', ''))) and public.tk_can_read_task(task_id))
         or (public.is_active_staff_admin() and not public.tk_task_internal_blocked(task_id)))
  with check (((lower(author_email) = lower(coalesce(auth.jwt() ->> 'email', ''))) and public.tk_can_read_task(task_id))
         or (public.is_active_staff_admin() and not public.tk_task_internal_blocked(task_id)));

-- 5b. No client portal for the internal company: no client_users rows, and the
--     two membership helpers every portal function/policy goes through ignore
--     any such row. (Staff, including the owner, use the staff path.)
create or replace function public.client_users_no_internal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.clients c where c.id = new.client_id and c.is_internal) then
    raise exception 'The internal company profile has no client portal users.' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function public.client_users_no_internal() from public, anon, authenticated;
drop trigger if exists client_users_no_internal on public.client_users;
create trigger client_users_no_internal
  before insert or update of client_id on public.client_users
  for each row execute function public.client_users_no_internal();

select pg_temp.patch_fn('public.is_client_member(text)',
  $a$and cu.active);$a$,
  $a$and cu.active
    and not exists (select 1 from clients ic where ic.id = cu.client_id and ic.is_internal));$a$, 1);
select pg_temp.patch_fn('public.st_my_client_user()',
  $a$and active
  limit 1;$a$,
  $a$and active
    and not exists (select 1 from clients ic where ic.id = client_users.client_id and ic.is_internal)
  limit 1;$a$, 1);

-- 5c. Staff offboarding preview: hide internal-client assignments and task
--     counts from admins who do not hold the permission.
select pg_temp.patch_fn('public.offboard_staff_preview(text)',
  $a$where a.staff_email = v_email), '[]'::jsonb),$a$,
  $a$where a.staff_email = v_email and a.client_id <> all (public.internal_blocked_ids())), '[]'::jsonb),$a$, 1);
select pg_temp.patch_fn('public.offboard_staff_preview(text)',
  $a$and r.client_id is not null$a$,
  $a$and r.client_id is not null and r.client_id <> all (public.internal_blocked_ids())$a$, 1);
select pg_temp.patch_fn('public.offboard_staff_preview(text)',
  $a$'open_tasks_total', (select count(*) from staff_reminders r$a$,
  $a$'open_tasks_total', (select count(*) from (select x.* from staff_reminders x
                                              where x.client_id is null or x.client_id <> all (public.internal_blocked_ids())) r$a$, 1);

-- 5d. Ops alert rows are keyed 'kind:client_id' (e.g. qbo_reconnect:mygoodbooks).
--     Rows naming the internal client are readable only with the permission.
--     (The cron / ops email use the service role and are unaffected.)
create or replace function public.ops_key_internal_blocked(p_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not public.can_view_internal()
     and exists (select 1 from public.clients c
                  where c.is_internal and c.id = any (string_to_array(p_key, ':')));
$$;
revoke all on function public.ops_key_internal_blocked(text) from public, anon;
grant execute on function public.ops_key_internal_blocked(text) to authenticated, service_role;
drop policy if exists "internal company lock" on public.ops_alert_state;
create policy "internal company lock" on public.ops_alert_state
  as restrictive for select using (not public.ops_key_internal_blocked(key));

-- The weekly admin digest lists open alerts by title: leave the internal ones out.
select pg_temp.patch_fn('public.digest_needs_attention(boolean)',
  $a$where s.resolved_at is null and s.last_alerted_at is not null$a$,
  $a$where s.resolved_at is null and s.last_alerted_at is not null
         and not exists (select 1 from clients ic
                          where ic.is_internal and ic.id = any (string_to_array(s.key, ':')))$a$, 1);

-- 5e. QuickBooks customer mapping: only the permission holder can map a QBO
--     customer onto the internal client.
select pg_temp.patch_fn('public.qbo_set_customer_mapping(text,text,boolean,text)',
  $a$if p_client_id is not null and not exists (select 1 from clients where id = p_client_id) then$a$,
  $a$if p_client_id is not null and not public.can_view_internal()
     and exists (select 1 from clients where id = p_client_id and is_internal) then
    raise exception 'not authorized';
  end if;
  if p_client_id is not null and not exists (select 1 from clients where id = p_client_id) then$a$, 1);

-- 5f. The by-id roster helper is for server-side code only (no anonymous caller).
revoke all on function public.is_roster_client_id(text) from public, anon;
grant execute on function public.is_roster_client_id(text) to authenticated, service_role;
