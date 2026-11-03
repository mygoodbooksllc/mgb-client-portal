-- Lost clients follow-up (owner decision 2026-11-03: auto-close).
-- Applied to production 2026-11-03 (Supabase MCP execute_sql).
--
-- A. Open tasks and reminders of a lost client are closed automatically.
--    "Closed" = moved to the Tasks trash (staff_reminders.deleted_at, the same
--    soft delete as Delete task). That is deliberate: staff_reminders has no
--    cancelled status, and moving to done would count as completed work and
--    inflate on-time / performance numbers. A trashed task is not open, not
--    overdue, not assigned, and not counted anywhere as done. Done tasks, and
--    tasks already in the trash, are never touched. Each close writes the usual
--    tk_activity "deleted" row (actor "system") and one audit_log row
--    (client.tasks_auto_closed, with the count).
--    Undoing lost (clearing lost_at) does NOT reopen them; an admin can restore
--    individual tasks from the trash.
--    Runs (1) from a trigger on clients when lost_at is set to today or earlier,
--    and (2) at the start of every live tk__generate run (the nightly cron) for
--    clients whose future lost_at date has now arrived.
-- B. tk__generate makes no task for a client with a future lost_at when the
--    task is due on or after lost_at (custom-schedule "occ" templates are
--    covered by the nightly close once lost_at arrives).
--
-- Safe to re-run.

create or replace function pg_temp.mh_patch_fn(p_sig text, p_from text, p_to text, p_done text, p_expected int)
returns void
language plpgsql
as $f$
declare
  d text;
  n int;
begin
  d := pg_get_functiondef(p_sig::regprocedure);
  if position(p_done in d) > 0 then
    return;
  end if;
  n := (length(d) - length(replace(d, p_from, ''))) / length(p_from);
  if n <> p_expected then
    raise exception 'mh_patch_fn %: expected % occurrence(s) of anchor %, found %', p_sig, p_expected, p_from, n;
  end if;
  execute replace(d, p_from, p_to);
end
$f$;

-- 1. The closer. p_client_id null = every lost client.
create or replace function public.tk_close_lost_client_tasks(p_client_id text default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'America/Chicago')::date;
  r record;
  v_n int;
  v_total int := 0;
begin
  for r in
    select cl.id, cl.name from clients cl
     where cl.lost_at is not null and cl.lost_at <= v_today
       and (p_client_id is null or cl.id = p_client_id)
       and exists (select 1 from staff_reminders s
                    where s.client_id = cl.id and not s.done and s.deleted_at is null)
     order by cl.id
  loop
    update staff_reminders s
       set deleted_at = now()
     where s.client_id = r.id and not s.done and s.deleted_at is null;
    get diagnostics v_n = row_count;
    v_total := v_total + v_n;
    perform audit_write('client.tasks_auto_closed', r.id, 'client', r.id,
      jsonb_build_object('name', r.name, 'closed', v_n, 'how', 'moved to Tasks trash'));
  end loop;
  return v_total;
end
$$;
comment on function public.tk_close_lost_client_tasks(text) is
  'Lost clients: moves open tasks/reminders of lost clients (lost_at <= today, Chicago) to the Tasks trash. Not completed work. Trigger and nightly tk__generate only.';
revoke all on function public.tk_close_lost_client_tasks(text) from public, anon, authenticated;
grant execute on function public.tk_close_lost_client_tasks(text) to service_role;

-- 2. Trigger: server-side, fires when lost_at is set to today or earlier.
create or replace function public.clients_lost_close_tasks()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.tk_close_lost_client_tasks(new.id);
  return null;
end
$$;
revoke all on function public.clients_lost_close_tasks() from public, anon, authenticated;

drop trigger if exists clients_lost_close_tasks on public.clients;
create trigger clients_lost_close_tasks
  after update of lost_at on public.clients
  for each row
  when (new.lost_at is not null
        and new.lost_at is distinct from old.lost_at
        and new.lost_at <= (now() at time zone 'America/Chicago')::date)
  execute function public.clients_lost_close_tasks();

-- 3. tk__generate: nightly close + no tasks due on or after a future lost_at.
select pg_temp.mh_patch_fn('public.tk__generate(date,boolean,text,integer,text,uuid)',
  $a$  v_would_adopt jsonb := '[]'::jsonb;   -- recurring asana overlap$a$,
  $a$  v_would_adopt jsonb := '[]'::jsonb;   -- recurring asana overlap
  v_lost_closed int := 0;   -- lost clients$a$,
  'v_lost_closed int', 1);
select pg_temp.mh_patch_fn('public.tk__generate(date,boolean,text,integer,text,uuid)',
  $a$    perform set_config('mgb.tk_generate', 'on', true);$a$,
  $a$    perform set_config('mgb.tk_generate', 'on', true);
    v_lost_closed := public.tk_close_lost_client_tasks(p_client_id);   -- lost clients: lost_at has arrived$a$,
  'v_lost_closed := ', 1);
select pg_temp.mh_patch_fn('public.tk__generate(date,boolean,text,integer,text,uuid)',
  $a$      select cl.id from clients cl$a$,
  $a$      select cl.id, cl.lost_at from clients cl$a$,
  'select cl.id, cl.lost_at from clients cl', 1);
select pg_temp.mh_patch_fn('public.tk__generate(date,boolean,text,integer,text,uuid)',
  $a$if v_due is not null and v_due >= v_act_c and (v_pfloor is null or v_start >= v_pfloor) then$a$,
  $a$if v_due is not null and v_due >= v_act_c and (v_pfloor is null or v_start >= v_pfloor)
           and (c.lost_at is null or v_due < c.lost_at) /* lost:due */ then$a$,
  '/* lost:due */', 1);
select pg_temp.mh_patch_fn('public.tk__generate(date,boolean,text,integer,text,uuid)',
  $a$'adopted', v_adopted);   -- recurring asana overlap$a$,
  $a$'adopted', v_adopted, 'lost_closed', v_lost_closed);   -- recurring asana overlap$a$,
  $a$'lost_closed', v_lost_closed$a$, 1);

-- 4. One-time run for clients already lost (Citymark, 2026-10-30).
select public.tk_close_lost_client_tasks(null) as closed_now;
