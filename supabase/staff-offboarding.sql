-- Staff offboarding (owner request 2026-09-29).
--
-- Applied to production 2026-09-29 as migration staff_offboarding.
-- Safe to re-run. Needs audit-log.sql (audit_write) first.
--
--   offboard_staff_preview(p_email)  admin-only read of what offboarding
--                                    would touch: assigned clients (with open
--                                    task counts), open tasks with no client,
--                                    live and pending access grants.
--   offboard_staff(p_email, p_reassign)
--       admin-only, one transaction (a plpgsql function call is atomic: any
--       error rolls every step back). p_reassign:
--         {"default": "new@mygoodbooks.org" | null,
--          "clients": {"<client_id>": "new@..." | null, ...}}
--       A client key that is present wins over "default"; an explicit null
--       means "just unassign, no replacement".
--       Steps:
--         1. staff_client_access: replacement gets the client (if any), the
--            leaver's row is removed. Where the leaver was the client's
--            assigned bookkeeper, clients.assigned_bookkeeper_email (and the
--            display name) moves to the replacement, or is cleared when there
--            is none (added 2026-09-29, migration
--            offboard_reassigns_assigned_bookkeeper; see
--            assigned-bookkeeper-email.sql).
--         2. open staff_reminders (done = false) where the leaver is the
--            assignee or the owner: moved to the client's replacement, else
--            "default", else the admin running the offboarding.
--         3. access grants: live approved ones revoked (expires now),
--            pending ones cancelled. Temp admin access expired too.
--         4. staff.active = false.
--         5. one 'staff.offboarded' audit row with the counts (the row
--            triggers from audit-log.sql log each step individually too).
--       Never deletes the staff row, finished tasks or any history.
--
-- staff_reminders_before_write (staff-reminders-v2.sql) pins staff_email on
-- updates by anyone but the owner. It is re-created here with one change: it
-- lets offboard_staff move ownership, signalled by the transaction-local
-- setting mgb.offboarding that only that function sets. PostgREST can't set
-- arbitrary settings, so the browser can't use this.

begin;

create or replace function public.staff_reminders_before_write()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_caller text := coalesce(auth.jwt() ->> 'email', '');
begin
  if tg_op = 'INSERT' then
    new.assignee_email := coalesce(new.assignee_email, new.staff_email);
    new.created_by := coalesce(new.created_by, nullif(v_caller, ''), new.staff_email);

    if new.source = 'manual'
       and v_caller is distinct from new.staff_email
       and new.text like 'New access request from %' then
      new.source := 'access_request';
      new.source_ref := coalesce(new.source_ref, new.client_id);
    end if;

    if new.due_at is null and new.due_date is not null then
      new.due_at := new.due_date::timestamp at time zone 'UTC';
    elsif new.due_date is null and new.due_at is not null then
      new.due_date := (new.due_at at time zone 'UTC')::date;
    end if;
    return new;
  end if;

  if v_caller is distinct from old.staff_email
     and coalesce(current_setting('mgb.offboarding', true), '') <> 'on' then
    new.staff_email := old.staff_email;
    new.created_by := old.created_by;
    new.client_id := old.client_id;
    new.visibility := old.visibility;
  end if;

  if new.due_date is distinct from old.due_date
     and new.due_at is not distinct from old.due_at then
    new.due_at := case when new.due_date is null then null
                       else new.due_date::timestamp at time zone 'UTC' end;
  elsif new.due_at is distinct from old.due_at
     and new.due_date is not distinct from old.due_date then
    new.due_date := case when new.due_at is null then null
                         else (new.due_at at time zone 'UTC')::date end;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Preview
-- ---------------------------------------------------------------------------
create or replace function public.offboard_staff_preview(p_email text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(p_email));
begin
  if not public.is_active_staff_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'staff', (select to_jsonb(s) - 'id' from staff s where s.email = v_email),
    'clients', coalesce((
      select jsonb_agg(jsonb_build_object(
               'client_id', a.client_id,
               'client_name', c.name,
               'open_tasks', (select count(*) from staff_reminders r
                               where r.done = false and r.client_id = a.client_id
                                 and (r.assignee_email = v_email or r.staff_email = v_email)))
             order by c.name)
      from staff_client_access a left join clients c on c.id = a.client_id
      where a.staff_email = v_email), '[]'::jsonb),
    -- Open tasks on clients the leaver is NOT assigned to (e.g. via a temp
    -- grant) are grouped by client so the wizard can still route them.
    'other_task_clients', coalesce((
      select jsonb_agg(jsonb_build_object('client_id', x.client_id, 'client_name', c.name, 'open_tasks', x.n))
      from (select r.client_id, count(*) n from staff_reminders r
            where r.done = false and r.client_id is not null
              and (r.assignee_email = v_email or r.staff_email = v_email)
              and not exists (select 1 from staff_client_access a
                              where a.staff_email = v_email and a.client_id = r.client_id)
            group by r.client_id) x
      left join clients c on c.id = x.client_id), '[]'::jsonb),
    'open_tasks_no_client', (select count(*) from staff_reminders r
                              where r.done = false and r.client_id is null
                                and (r.assignee_email = v_email or r.staff_email = v_email)),
    'open_tasks_total', (select count(*) from staff_reminders r
                          where r.done = false and (r.assignee_email = v_email or r.staff_email = v_email)),
    'live_grants', (select count(*) from staff_client_access_grants g
                     where g.staff_email = v_email and g.status = 'approved' and g.expires_at > now()),
    'pending_grants', (select count(*) from staff_client_access_grants g
                        where g.staff_email = v_email and g.status = 'pending'),
    'temp_admin', exists (select 1 from staff_temp_admin_access t
                          where t.staff_email = v_email and t.expires_at > now())
  );
end;
$$;
revoke all on function public.offboard_staff_preview(text) from public, anon;
grant execute on function public.offboard_staff_preview(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Offboard
-- ---------------------------------------------------------------------------
create or replace function public.offboard_staff(p_email text, p_reassign jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(p_email));
  v_caller text := lower(auth.jwt() ->> 'email');
  v_reassign jsonb := coalesce(p_reassign, '{}'::jsonb);
  v_map jsonb := coalesce(v_reassign -> 'clients', '{}'::jsonb);
  v_default text := lower(nullif(trim(v_reassign ->> 'default'), ''));
  v_staff staff;
  v_repl text;
  r record;
  n_assigned int := 0;
  n_unassigned int := 0;
  n_tasks int := 0;
  n_revoked int := 0;
  n_cancelled int := 0;
  n_temp int := 0;
  v_moves jsonb := '[]'::jsonb;
begin
  if not public.is_active_staff_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_email = v_caller then
    raise exception 'you can''t offboard yourself' using errcode = '22023';
  end if;
  select * into v_staff from staff where email = v_email for update;
  if not found then
    raise exception 'no staff member %', v_email using errcode = '22023';
  end if;
  if jsonb_typeof(v_map) <> 'object' then
    raise exception 'p_reassign.clients must be an object' using errcode = '22023';
  end if;

  -- Every named replacement must be a different, active staff member.
  for v_repl in
    select distinct lower(x) from (
      select v_default x
      union all select value #>> '{}' from jsonb_each(v_map)
    ) s where x is not null
  loop
    if v_repl = v_email then
      raise exception 'can''t reassign to the person being offboarded' using errcode = '22023';
    end if;
    if not exists (select 1 from staff where email = v_repl and active) then
      raise exception '% is not an active staff member', v_repl using errcode = '22023';
    end if;
  end loop;

  -- 1. Client assignments
  for r in select client_id from staff_client_access where staff_email = v_email loop
    v_repl := case when v_map ? r.client_id then lower(v_map ->> r.client_id) else v_default end;
    if v_repl is not null then
      insert into staff_client_access (staff_email, client_id)
      values (v_repl, r.client_id) on conflict do nothing;
      n_assigned := n_assigned + 1;
    end if;
    -- Assigned bookkeeper follows the replacement (the clients trigger
    -- rewrites the display name too). With no replacement, deleting the
    -- access row below clears it (sca_clear_assigned_bookkeeper).
    update clients set assigned_bookkeeper_email = v_repl
     where id = r.client_id and assigned_bookkeeper_email = v_email and v_repl is not null;
    delete from staff_client_access where staff_email = v_email and client_id = r.client_id;
    n_unassigned := n_unassigned + 1;
    v_moves := v_moves || jsonb_build_object('client_id', r.client_id, 'to', v_repl);
  end loop;

  -- 2. Open tasks and reminders
  perform set_config('mgb.offboarding', 'on', true);
  with upd as (
    update staff_reminders t
       set assignee_email = case when t.assignee_email = v_email then x.target else t.assignee_email end,
           staff_email    = case when t.staff_email = v_email then x.target else t.staff_email end
      from (
        select r2.id,
               coalesce(case when r2.client_id is not null and v_map ? r2.client_id
                             then lower(v_map ->> r2.client_id) end,
                        v_default, v_caller) as target
          from staff_reminders r2
         where r2.done = false
           and (r2.assignee_email = v_email or r2.staff_email = v_email)
      ) x
     where t.id = x.id
    returning 1
  )
  select count(*) into n_tasks from upd;
  perform set_config('mgb.offboarding', '', true);

  -- 3. Access grants
  with u as (
    update staff_client_access_grants
       set status = 'revoked',
           decided_by = coalesce(decided_by, v_caller),
           decided_at = coalesce(decided_at, now()),
           expires_at = least(expires_at, now())
     where staff_email = v_email and status = 'approved' and expires_at > now()
    returning 1
  ) select count(*) into n_revoked from u;
  with u as (
    update staff_client_access_grants
       set status = 'cancelled', decided_by = v_caller, decided_at = now()
     where staff_email = v_email and status = 'pending'
    returning 1
  ) select count(*) into n_cancelled from u;
  with u as (
    update staff_temp_admin_access set expires_at = now()
     where staff_email = v_email and expires_at > now()
    returning 1
  ) select count(*) into n_temp from u;

  -- 4. Deactivate (never delete)
  update staff set active = false where email = v_email and active;

  -- 5. Summary row
  perform audit_write('staff.offboarded', null, 'staff', v_email, jsonb_build_object(
    'clients', v_moves, 'default', v_default,
    'clients_unassigned', n_unassigned, 'clients_reassigned', n_assigned,
    'tasks_moved', n_tasks, 'grants_revoked', n_revoked, 'grants_cancelled', n_cancelled,
    'temp_admin_expired', n_temp));

  return jsonb_build_object(
    'email', v_email, 'clients_unassigned', n_unassigned, 'clients_reassigned', n_assigned,
    'tasks_moved', n_tasks, 'grants_revoked', n_revoked, 'grants_cancelled', n_cancelled,
    'temp_admin_expired', n_temp);
end;
$$;
revoke all on function public.offboard_staff(text, jsonb) from public, anon;
grant execute on function public.offboard_staff(text, jsonb) to authenticated;

commit;
