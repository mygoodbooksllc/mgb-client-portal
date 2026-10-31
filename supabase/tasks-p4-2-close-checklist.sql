-- =====================================================================
-- Tasks Phase 4, slice P4-2: the Close checklist linked to tasks
-- (Phase 2 spec items 14.1 + 14.2; Phase 4 spec 2.2; critique B1, M5, M6).
--
-- Re-runnable. Apply it whole. What it does:
--   1. tk_client_close_optin: a per-client switch ("Create month-end tasks
--      from the Close checklist"), off by default, soft turn-off. Read by
--      staff who can see the client; written only by tk_set_close_optin
--      (an admin or that client's account manager).
--   2. staff_reminders.close_key: stamped on insert from the template's
--      close_key (monthly, top-level template tasks, only inside the
--      generator, only the five keys of tk__is_close_task_key), server-owned
--      after that, cleared if the task moves client/period or becomes a
--      subtask. One live close task per client, month and key
--      (uq_close_task); tk__issue_period returns 'skipped' / 'close_dup'
--      before claiming. Appended to the tk_tasks view. A close task made
--      for a step already ticked starts done (adopt trigger).
--   3. tk__generate: the standard-set gate moved inside the client loop
--      (critique B1). A set member reaches a client when the owner turned
--      the set on (standard_set_live), OR the client is opted in, OR the
--      call names a test/internal client. For an opted-in client no close
--      month (period) before the opt-in floor is created or listed as
--      missed: the floor is the month after the opt-in month, or the
--      opt-in month itself when "also this month" was ticked. (A close
--      month's tasks fall due early the next month.)
--      standard_set_live is NOT touched.
--   4. Turns on five standard-set members (bank_feed, bank_rec, card_rec,
--      entries, review). 'sent' stays a draft: it ticks itself when the
--      packet is sent. With standard_set_live off they still reach only
--      opted-in and named test clients.
--   5. tk_close_tick: the one write path for a checklist tick. With no live
--      linked task it writes the item as before; with one it moves the task
--      (done, review, reopen) and returns a plain message when it can't.
--   6. Triggers: a task status change ticks/unticks its checklist item
--      (ready_for_review stays unticked) and logs "Close checklist
--      updated"; a direct write to a linked checklist item is refused
--      (tk_use_close_tick) unless it comes from these functions.
--   7. tk_close_optin_status: the toggle's state plus overlapping
--      recurring templates (for the duplicate warning).
--   8. tk_activity kind 'close_checklist'; tk_schema_version 11.
-- =====================================================================

-- 1. Per-client opt-in -----------------------------------------------------
create table if not exists public.tk_client_close_optin (
  client_id text primary key references public.clients(id) on delete cascade,
  enabled_at timestamptz not null default now(),
  enabled_by text not null,
  include_current_month boolean not null default false,
  disabled_at timestamptz,
  disabled_by text
);
alter table public.tk_client_close_optin enable row level security;
revoke all on public.tk_client_close_optin from anon, authenticated;
grant select on public.tk_client_close_optin to authenticated;
drop policy if exists "staff read close optin" on public.tk_client_close_optin;
create policy "staff read close optin" on public.tk_client_close_optin
  for select to authenticated
  using ((select public.is_active_staff()) and public.can_access_client(client_id));

-- First day the generator may create close tasks for this client (null = not opted in).
create or replace function public.tk__close_optin_floor(p_client text)
returns date
language sql
stable
security definer
set search_path = public
as $$
  select case when o.include_current_month
              then date_trunc('month', (o.enabled_at at time zone 'America/Chicago'))::date
              else (date_trunc('month', (o.enabled_at at time zone 'America/Chicago')) + interval '1 month')::date end
    from public.tk_client_close_optin o
   where o.client_id = p_client and o.disabled_at is null;
$$;
revoke all on function public.tk__close_optin_floor(text) from public, anon, authenticated;

-- review fix (major 1): the five steps that can be tasks, in one place. 'sent'
-- (and any other key) is never issued by the opt-in, stamped or ticked here.
create or replace function public.tk__is_close_task_key(p_key text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select coalesce(p_key in ('bank_feed', 'bank_rec', 'card_rec', 'entries', 'review'), false);
$$;
revoke all on function public.tk__is_close_task_key(text) from public, anon, authenticated;

-- 2. close_key on tasks ----------------------------------------------------
alter table public.staff_reminders add column if not exists close_key text;

create or replace function public.tk_staff_reminders_close_key()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
begin
  if tg_op = 'INSERT' then
    new.close_key := null;
    -- review fix (minor): stamped only by the generator (tk__generate / tk_issue_missed set
    -- mgb.tk_generate), and only for the five task keys (major 1)
    if coalesce(current_setting('mgb.tk_generate', true), '') = 'on'
       and new.template_id is not null and new.parent_id is null and new.period_kind = 'month'
       and new.period_start is not null and new.client_id is not null then
      select t.close_key into v_key from public.task_templates t where t.id = new.template_id;
      if public.tk__is_close_task_key(v_key) then
        new.close_key := v_key;
      end if;
    end if;
  else
    -- server-owned: never set by a client write; a moved task unlinks
    new.close_key := old.close_key;
    if new.client_id is distinct from old.client_id
       or new.period_start is distinct from old.period_start
       or new.period_kind is distinct from old.period_kind
       or new.parent_id is not null then
      new.close_key := null;
    end if;
  end if;
  return new;
end $$;
revoke all on function public.tk_staff_reminders_close_key() from public, anon, authenticated;
drop trigger if exists tk_staff_reminders_close_key on public.staff_reminders;
create trigger tk_staff_reminders_close_key
  before insert or update on public.staff_reminders
  for each row execute function public.tk_staff_reminders_close_key();

create unique index if not exists uq_close_task
  on public.staff_reminders (client_id, period_start, close_key)
  where close_key is not null and deleted_at is null and parent_id is null;

-- the view keeps its columns in order; close_key is appended at the end
create or replace view public.tk_tasks with (security_invoker = true) as
 select id, staff_email, text, due_date, done, created_at, client_id, priority, completed_at, kind, due_at, remind_at,
    recurrence, assignee_email, created_by, visibility, source, source_ref, status, status_changed_at, status_changed_by,
    status_before_wait, waiting_since, waiting_minutes, description, start_on, section, sort_key, parent_id, sop_section,
    review_required, series_id, updated_at, deleted_at, deleted_by, project_id, search_tsv, reviewer_email,
    send_back_count, ready_at, submitted_by, submitted_at, approved_by, approved_at, due_date_original,
    waiting_before_due_minutes, template_id, period_kind, period_start, is_unassigned, close_key
   from public.staff_reminders
  where deleted_at is null;

-- 8a. activity kind (rebuilt from the live constraint so other kinds are kept)
do $$
declare
  v_def text;
  v_new text;
begin
  select pg_get_constraintdef(c.oid) into v_def from pg_constraint c
   where c.conrelid = 'public.tk_activity'::regclass and c.conname = 'tk_activity_kind_check';
  if v_def is null then
    raise exception 'tk_activity_kind_check not found';
  end if;
  if position('''close_checklist''' in v_def) = 0 then
    v_new := regexp_replace(v_def, '\]\)+$', '');
    if v_new = v_def then
      raise exception 'tk_activity_kind_check has an unexpected shape: %', v_def;
    end if;
    v_new := v_new || ', ''close_checklist''::text])))';
    alter table public.tk_activity drop constraint tk_activity_kind_check;
    execute 'alter table public.tk_activity add constraint tk_activity_kind_check ' || v_new;
  end if;
end $$;

-- 6a. Linked task -> checklist sync ----------------------------------------
-- The live linked task for a checklist item (null when none).
create or replace function public.tk__close_task(p_client text, p_period text, p_key text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select r.id from public.staff_reminders r
   where r.client_id = p_client
     and p_period ~ '^[0-9]{4}-[0-9]{2}$'
     and r.period_start = to_date(p_period || '-01', 'YYYY-MM-DD')
     and r.close_key = p_key
     and r.period_kind = 'month'
     and r.parent_id is null
     and r.deleted_at is null
   limit 1;
$$;
revoke all on function public.tk__close_task(text, text, text) from public, anon, authenticated;

-- Make the checklist item match the task (done = status 'done'). Writes only
-- when they differ; logs one activity row when it writes.
create or replace function public.tk__close_sync(p_task uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_period text;
  v_cur boolean;
  v_done boolean;
  v_actor text := coalesce(nullif(current_setting('mgb.tk_actor', true), ''),
                           nullif(lower(coalesce(auth.jwt() ->> 'email', '')), ''), 'system');
begin
  select t.id, t.client_id, t.period_kind, t.period_start, t.close_key, t.parent_id, t.deleted_at, t.status
    into r from public.staff_reminders t where t.id = p_task;
  if not found or r.close_key is null or r.deleted_at is not null or r.parent_id is not null
     or r.period_kind is distinct from 'month' or r.period_start is null or r.client_id is null then
    return false;
  end if;
  v_period := to_char(r.period_start, 'YYYY-MM');
  v_done := r.status = 'done';
  select i.done into v_cur from public.client_close_items i
   where i.client_id = r.client_id and i.period = v_period and i.item_key = r.close_key;
  if coalesce(v_cur, false) = v_done then
    return false;
  end if;
  perform set_config('mgb.tk_close', 'on', true);
  begin
    insert into public.client_close_items (client_id, period, item_key, done, done_by, done_at)
    values (r.client_id, v_period, r.close_key, v_done,
            case when v_done and v_actor <> 'system' then v_actor end,
            case when v_done then now() end)
    on conflict (client_id, period, item_key) do update
      set done = excluded.done, done_by = excluded.done_by, done_at = excluded.done_at;
  exception when others then
    perform set_config('mgb.tk_close', '', true);
    raise;
  end;
  perform set_config('mgb.tk_close', '', true);
  insert into public.tk_activity (task_id, actor_email, kind, from_value, to_value, meta)
  values (r.id, v_actor, 'close_checklist', coalesce(v_cur, false)::text, v_done::text,
          jsonb_build_object('item_key', r.close_key, 'period', v_period, 'done', v_done));
  return true;
end $$;
revoke all on function public.tk__close_sync(uuid) from public, anon, authenticated;

create or replace function public.tk_staff_reminders_close_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.tk__close_sync(new.id);
  return null;
end $$;
revoke all on function public.tk_staff_reminders_close_sync() from public, anon, authenticated;
drop trigger if exists tk_staff_reminders_close_sync on public.staff_reminders;
-- Plain AFTER UPDATE (not "update of status"): complete_staff_item sets done and a BEFORE
-- trigger maps status, which an "of status" column trigger would never see.
-- review fix (minor): a restored task (deleted_at set -> null, e.g. its project restored) syncs too.
create trigger tk_staff_reminders_close_sync
  after update on public.staff_reminders
  for each row
  when (new.close_key is not null
        and (old.status is distinct from new.status or (old.deleted_at is not null and new.deleted_at is null)))
  execute function public.tk_staff_reminders_close_sync();

-- review fix (major 2): a close task created for a step someone already ticked starts done, so the
-- step stays ticked and the two agree. Runs only inside the generator (the only writer of close_key),
-- where mgb.tk_generate is on, so the review gate is bypassed exactly as for any generator write.
-- A failure here never blocks the task being created; the next status change syncs them.
create or replace function public.tk_staff_reminders_close_adopt()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period text := to_char(new.period_start, 'YYYY-MM');
  v_done boolean;
begin
  if new.close_key is null or new.status = 'done' or new.deleted_at is not null or new.parent_id is not null then
    return null;
  end if;
  select i.done into v_done from public.client_close_items i
   where i.client_id = new.client_id and i.period = v_period and i.item_key = new.close_key;
  if not coalesce(v_done, false) then
    return null;
  end if;
  begin
    perform set_config('mgb.tk_close', 'on', true);
    update public.staff_reminders set status = 'done' where id = new.id;
    perform set_config('mgb.tk_close', '', true);
    insert into public.tk_activity (task_id, actor_email, kind, from_value, to_value, meta)
    values (new.id, 'system', 'close_checklist', 'true', 'true',
            jsonb_build_object('item_key', new.close_key, 'period', v_period, 'done', true, 'adopted', true));
  exception when others then
    perform set_config('mgb.tk_close', '', true);
  end;
  return null;
end $$;
revoke all on function public.tk_staff_reminders_close_adopt() from public, anon, authenticated;
drop trigger if exists tk_staff_reminders_close_adopt on public.staff_reminders;
create trigger tk_staff_reminders_close_adopt
  after insert on public.staff_reminders
  for each row
  when (new.close_key is not null)
  execute function public.tk_staff_reminders_close_adopt();

-- 6b. A linked checklist item is written only through tk_close_tick / the sync.
-- Intentionally raises for every caller (admins, definer RPCs, service role, SQL editor):
-- the only way past it is the mgb.tk_close flag that tk__close_sync and the adopt trigger set.
create or replace function public.client_close_items_guard_linked()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(current_setting('mgb.tk_close', true), '') = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op <> 'INSERT' and public.tk__close_task(old.client_id, old.period, old.item_key) is not null then
    raise exception 'tk_use_close_tick' using errcode = '42501';
  end if;
  if tg_op <> 'DELETE' and public.tk__close_task(new.client_id, new.period, new.item_key) is not null then
    raise exception 'tk_use_close_tick' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
revoke all on function public.client_close_items_guard_linked() from public, anon, authenticated;
drop trigger if exists client_close_items_guard_linked on public.client_close_items;
create trigger client_close_items_guard_linked
  before insert or update or delete on public.client_close_items
  for each row execute function public.client_close_items_guard_linked();

-- 3. Generator: set gate per client -----------------------------------------
create or replace function public.tk__generate(p_today date, p_dry_run boolean, p_client_id text, p_horizon_days integer,
                                               p_trigger text, p_only_template uuid default null::uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_today date := coalesce(p_today, (now() at time zone 'America/Chicago')::date);
  v_dry boolean := coalesce(p_dry_run, false) or p_only_template is not null;
  v_horizon int := greatest(coalesce(p_horizon_days, 0), 0);
  -- review fix (minor): a value that isn't a yes/no counts as off and is warned about, never aborts the run
  v_set_live_raw jsonb := (select value from tk_settings where key = 'standard_set_live');
  v_set_live boolean := coalesce(public.tk__jsonb_bool(v_set_live_raw), false);
  v_named_test boolean := false;
  v_live_since date;
  v_is_set boolean;
  v_optin date;   -- tk p4-2: the client's opt-in floor (null = not opted in)
  v_pfloor date;  -- tk p4-2: first period (close month) an opted-in client gets
  v_act_c date;
  -- critique m3: nothing due before on_time_since (S3 ship date) is listed as missed
  v_miss_floor date := (select (s.value #>> '{}')::date from tk_settings s where s.key = 'on_time_since');
  t public.task_templates%rowtype;
  v_set record;
  c record;
  v_eff jsonb;
  v_kind text;
  v_act date;
  v_start date;
  v_floor date;
  v_end date;
  v_due date;
  v_r jsonb;
  v_created int := 0;
  v_by jsonb := '{}'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_missed jsonb := '[]'::jsonb;
  v_would jsonb := '[]'::jsonb;
  v_upcoming jsonb := '[]'::jsonb;
  v_warn jsonb := '[]'::jsonb;
  v_n int := 0;
  v_max_hol date;
  v_result jsonb;
begin
  if p_client_id is not null then
    select coalesce(cl.test_only, false) or coalesce(cl.is_internal, false) into v_named_test
      from clients cl where cl.id = p_client_id;
    v_named_test := coalesce(v_named_test, false);
  end if;
  if not v_dry then
    perform pg_advisory_xact_lock(hashtext('tk_generate'));
    perform set_config('mgb.tk_generate', 'on', true);
  end if;

  for t in
    select tt.* from task_templates tt
     where (p_only_template is not null and tt.id = p_only_template)
        or (p_only_template is null and tt.active and tt.status = 'active')
     order by tt.created_at, tt.id
  loop
    v_live_since := null;
    v_is_set := false;
    if t.template_set_id is not null and p_only_template is null then
      select s.deleted_at, s.is_standard, s.live_since into v_set from tk_template_sets s where s.id = t.template_set_id;
      if v_set.deleted_at is not null then continue; end if;
      v_is_set := true;
      v_live_since := (v_set.live_since at time zone 'America/Chicago')::date;   -- review fix (major 1)
    end if;
    v_act := case when p_only_template is not null then v_today
                  else coalesce((t.activated_at at time zone 'America/Chicago')::date,
                                (t.created_at at time zone 'America/Chicago')::date) end;

    for c in
      select cl.id from clients cl
       where (case when p_client_id is not null then cl.id = p_client_id else public.is_roster_client(cl) end)
         and ((cardinality(t.plan_tiers) = 0 and cardinality(t.client_ids) = 0)
              or cl.plan = any (t.plan_tiers)
              or cl.id = any (t.client_ids))
       order by cl.id
    loop
      v_act_c := v_act;
      v_pfloor := null;
      if v_is_set then
        -- tk p4-2 (critique B1): the set gate is per client. A set member reaches a client when the
        -- owner turned the set on, the client is opted in to month-end tasks, or a test client is named.
        v_optin := public.tk__close_optin_floor(c.id);
        if v_set_live then
          -- review fix (major 1): a real client from the later of activation and the set going live
          if v_live_since is not null and not (p_client_id is not null and v_named_test) then
            v_act_c := greatest(v_act, v_live_since);
          end if;
        elsif v_optin is not null and public.tk__is_close_task_key(t.close_key) then
          -- review fix (major 1): the opt-in issues only the five step templates, never 'sent' or others
          -- tk p4-2: no close month before the opt-in floor is created or listed as missed
          -- (a close month's tasks fall due in the next month, so the floor is on the period, not the due date)
          v_pfloor := v_optin;
        elsif not (p_client_id is not null and v_named_test) then
          continue;
        end if;
      end if;

      v_eff := public.tk__template_eff(t, c.id);
      if (v_eff ->> 'skip')::boolean then continue; end if;
      v_kind := v_eff ->> 'kind';
      v_floor := greatest(public.tk_period_start_for(v_kind, v_act_c, v_eff ->> 'fye'),
                          public.tk_period_start_for(v_kind, v_today - 365, v_eff ->> 'fye'));
      -- a period whose due date was before activation is neither created nor missed
      v_start := public.tk_period_start_for(v_kind, v_floor - 1, v_eff ->> 'fye');
      while v_start <= v_today + greatest(t.lead_days, v_horizon) + 130 loop
        v_end := public.tk__period_end(v_kind, v_start);
        v_due := public.tk_resolve_due(v_eff -> 'rule', v_start, v_end);
        if v_due is not null and v_due >= v_act_c and (v_pfloor is null or v_start >= v_pfloor) then
          if v_due < v_today - 7 then
            -- owner Q7: past the 7-day grace -> listed, never created
            if (v_miss_floor is null or v_due >= v_miss_floor)
               and not exists (select 1 from task_template_issued i
                            where i.template_id = t.id and i.client_id = c.id and i.period = v_start)
               -- review fix (minor): a dismissed (or hand-made) period is not listed again
               and not exists (select 1 from tk_generate_missed m
                            where m.template_id = t.id and m.client_id = c.id and m.period_start = v_start
                              and (m.dismissed_at is not null or m.issued_at is not null)) then
              if jsonb_array_length(v_missed) < 300 then
                v_missed := v_missed || jsonb_build_object('template', t.id, 'title', v_eff ->> 'title', 'client', c.id,
                                                           'period', v_start, 'label', public.tk__period_label(v_kind, v_start), 'due', v_due);
              end if;
              if not v_dry then
                insert into tk_generate_missed (template_id, client_id, period_start, due_date, label)
                values (t.id, c.id, v_start, v_due, public.tk__period_label(v_kind, v_start))
                on conflict do nothing;
              end if;
            end if;
          elsif v_due - t.lead_days <= v_today then
            v_r := public.tk__issue_period(t, v_eff, c.id, v_start, v_dry);
            if v_r ->> 'status' = 'created' then
              v_created := v_created + 1;
              v_by := jsonb_set(v_by, array[v_r ->> 'assignee'], to_jsonb(coalesce((v_by ->> (v_r ->> 'assignee'))::int, 0) + 1));
            elsif v_r ->> 'status' = 'would_create' then
              if jsonb_array_length(v_would) < 500 then
                v_would := v_would || (v_r || jsonb_build_object('template', t.id, 'title', v_eff ->> 'title', 'client', c.id, 'period', v_start));
              end if;
            elsif v_r ->> 'status' = 'skipped' then
              if jsonb_array_length(v_skipped) < 300 then
                v_skipped := v_skipped || jsonb_build_object('template', t.id, 'title', v_eff ->> 'title', 'client', c.id,
                                                             'period', v_start, 'label', v_r ->> 'label', 'reason', v_r ->> 'reason',
                                                             'detail', v_r ->> 'detail');
              end if;
            end if;
          elsif v_dry and v_horizon > 0 and v_due - t.lead_days <= v_today + v_horizon then
            if not exists (select 1 from task_template_issued i
                            where i.template_id = t.id and i.client_id = c.id and i.period = v_start)
               and jsonb_array_length(v_upcoming) < 500 then
              v_upcoming := v_upcoming || jsonb_build_object('template', t.id, 'title', v_eff ->> 'title', 'client', c.id,
                                                             'period', v_start, 'label', public.tk__period_label(v_kind, v_start),
                                                             'due', v_due, 'start_on', v_due - t.lead_days);
            end if;
          end if;
        end if;
        v_start := v_end + 1;
        v_n := v_n + 1;
        exit when v_n > 200000;   -- runaway guard
      end loop;
    end loop;
  end loop;

  -- critique m1: business-day maths needs holidays a year ahead
  select max(h.day) into v_max_hol from tk_holidays h;
  if v_max_hol is null or v_max_hol < v_today + 365 then
    v_warn := v_warn || to_jsonb('Firm holidays run out on ' || coalesce(v_max_hol::text, 'never set') || '. Add next year''s holidays.'::text);
  end if;
  if v_set_live_raw is not null and public.tk__jsonb_bool(v_set_live_raw) is null then
    v_warn := v_warn || to_jsonb('The standard set switch has an unreadable value, so it counts as off. The owner can switch it again.'::text);
  end if;

  v_result := jsonb_build_object('created', v_created, 'by_assignee', v_by, 'skipped', v_skipped, 'missed', v_missed,
                                 'dry_run', v_dry, 'today', v_today, 'warnings', v_warn);
  if v_dry then
    v_result := v_result || jsonb_build_object('would_create', v_would, 'upcoming', v_upcoming);
  else
    insert into tk_generator_runs (p_today, trigger, dry_run, ran_by, created, skipped, missed, result)
    values (v_today, coalesce(p_trigger, 'cron'), false, nullif(lower(coalesce(auth.jwt() ->> 'email', '')), ''),
            v_created, v_skipped, v_missed, v_result - 'skipped' - 'missed');
    perform set_config('mgb.tk_generate', '', true);
  end if;
  return v_result;
end $function$;

-- 3b. tk__issue_period: the live body, plus (review fix, minor) a pre-check so a second
-- template for a step that already has a live close task that month returns
-- 'skipped' / 'close_dup' without claiming the period.
create or replace function public.tk__issue_period(p_t task_templates, p_eff jsonb, p_client text, p_start date, p_dry_run boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_kind text := p_eff ->> 'kind';
  v_end date := public.tk__period_end(p_eff ->> 'kind', p_start);
  v_due date;
  v_label text := public.tk__period_label(p_eff ->> 'kind', p_start);
  v_role text := p_eff ->> 'role';
  v_to text;
  v_ref text := p_t.id::text || ':' || p_client || ':' || to_char(p_start, 'YYYY-MM-DD');
  v_id uuid;
  v_claimed boolean;
  v_pk text;
  v_items int;
  v_away uuid;   -- tk p2 s7
  v_cover text;   -- tk p2 s7
begin
  v_due := public.tk_resolve_due(p_eff -> 'rule', p_start, v_end);
  if v_due is null then
    return jsonb_build_object('status', 'skipped', 'reason', 'bad_rule', 'label', v_label);
  end if;
  if exists (select 1 from task_template_issued i
              where i.template_id = p_t.id and i.client_id = p_client and i.period = p_start) then
    return jsonb_build_object('status', 'exists', 'due', v_due, 'label', v_label);
  end if;
  -- tk p4-2 review fix: one live close task per client, month and step
  if v_kind = 'month' and public.tk__is_close_task_key(p_t.close_key)
     and exists (select 1 from staff_reminders r
                  where r.client_id = p_client and r.period_start = p_start and r.close_key = p_t.close_key
                    and r.deleted_at is null and r.parent_id is null) then
    return jsonb_build_object('status', 'skipped', 'reason', 'close_dup', 'due', v_due, 'label', v_label);
  end if;

  select p.email into v_to from public.tk__client_people(p_client) p where p.role = v_role limit 1;
  if v_to is null then
    select p.email into v_to from public.tk__client_people(p_client) p where p.role = 'bookkeeper' limit 1;
  end if;
  if v_to is null then
    select p.email into v_to from public.tk__client_people(p_client) p where p.role = 'account_manager' limit 1;
  end if;
  if p_t.assignee_email is not null   -- tk p2 s8b: the person the template names (Asana mirror)
     and exists (select 1 from staff s where lower(s.email) = lower(p_t.assignee_email) and s.active)
     and public.tk_staff_has_client(lower(p_t.assignee_email), p_client) then
    v_to := lower(p_t.assignee_email);
  end if;
  if v_to is null then
    return jsonb_build_object('status', 'skipped', 'reason', 'no_assignee', 'due', v_due, 'label', v_label);
  end if;
  if not public.tk_staff_has_client(v_to, p_client) then
    return jsonb_build_object('status', 'skipped', 'reason', 'no_access', 'assignee', v_to, 'due', v_due, 'label', v_label);
  end if;
  -- tk p2 s7: the assignee is out on the due date (time off already started) -> the backup takes it
  select o.id into v_away from staff_time_off o
   where lower(o.staff_email) = v_to and o.cancelled_at is null and v_due between o.starts_on and o.ends_on
     and o.starts_on <= (now() at time zone 'America/Chicago')::date
   limit 1;
  if v_away is not null and not p_t.leave_unassigned then   -- tk p2 s8b: nobody to cover for
    select c.o_to into v_cover from public.tk__ooo_cover(v_to, p_client, v_due, null) c where c.o_skip is null;
  end if;
  if p_dry_run then
    return jsonb_build_object('status', 'would_create', 'assignee', v_to, 'due', v_due, 'label', v_label,
                              'start_on', v_due - p_t.lead_days, 'covered_by', v_cover);   -- tk p2 s7
  end if;

  v_pk := case when v_kind in ('month', 'quarter', 'year') then v_kind end;
  begin
    insert into task_template_issued (template_id, client_id, period, reminder_id, assignee)
    values (p_t.id, p_client, p_start, null, v_to)
    on conflict do nothing
    returning true into v_claimed;
    if v_claimed is null then
      return jsonb_build_object('status', 'exists', 'due', v_due, 'label', v_label);
    end if;

    perform set_config('mgb.tk_ooo', case when v_cover is not null then 'quiet' else '' end, true);   -- tk p2 s7
    perform set_config('mgb.tk_unassigned', case when p_t.leave_unassigned then 'on' else '' end, true);   -- tk p2 s8b
    insert into staff_reminders (
      staff_email, assignee_email, text, client_id, priority, due_date, due_date_original, start_on,
      kind, recurrence, visibility, source, source_ref, template_id, series_id,
      period_kind, period_start, sop_section, review_required)
    values (
      v_to, case when p_t.leave_unassigned then null else coalesce(v_cover, v_to) end, (p_eff ->> 'title') || ' · ' || v_label, p_client, p_t.priority, v_due, v_due,
      v_due - p_t.lead_days,
      'task', 'none', 'shared', 'template', v_ref, p_t.id, md5(p_t.id::text || p_client)::uuid,
      v_pk, case when v_pk is not null then p_start end, p_t.sop_section,
      coalesce((p_eff ->> 'review_required')::boolean, false))
    on conflict (source_ref) where source = 'template' do nothing
    returning id into v_id;
    if v_id is null then
      select r.id into v_id from staff_reminders r where r.source = 'template' and r.source_ref = v_ref;
    else
      if v_cover is not null then   -- tk p2 s7
        insert into tk_ooo_reassignments (time_off_id, task_id, client_id, from_email, to_email, reason, reassigned_by)
        values (v_away, v_id, p_client, v_to, v_cover, 'generator', 'system')
        on conflict do nothing;
      end if;
      insert into task_checklist_items (reminder_id, text, sort_order)
      select v_id, left(btrim(x.item), 300), (x.ord - 1)::int
        from jsonb_array_elements_text(coalesce(p_eff -> 'checklist', '[]'::jsonb)) with ordinality as x(item, ord)
       where nullif(btrim(x.item), '') is not null and x.ord <= 50;
    end if;
    perform set_config('mgb.tk_ooo', '', true);   -- tk p2 s7
    perform set_config('mgb.tk_unassigned', '', true);   -- tk p2 s8b
    update task_template_issued set reminder_id = v_id
     where template_id = p_t.id and client_id = p_client and period = p_start;

    if v_pk is not null then
      begin
        insert into month_close (client_id, period_kind, period, status)
        values (p_client, v_pk, p_start, 'not_started')
        on conflict do nothing;
      exception when others then
        null;
      end;
    end if;
  exception when others then
    return jsonb_build_object('status', 'skipped', 'reason', 'error', 'detail', left(sqlerrm, 200),
                              'due', v_due, 'label', v_label);
  end;
  return jsonb_build_object('status', 'created', 'assignee', v_to, 'reminder_id', v_id, 'due', v_due, 'label', v_label,
                            'covered_by', v_cover);   -- tk p2 s7
end $function$;

-- 4. Turn on the five linked standard-set members (once; 'sent' stays a draft).
update public.task_templates t
   set status = 'active', active = true, activated_at = now()
 where t.close_key in ('bank_feed', 'bank_rec', 'card_rec', 'entries', 'review')
   and t.status = 'draft'
   and t.activated_at is null
   and exists (select 1 from public.tk_template_sets s
                where s.id = t.template_set_id and s.is_standard and s.deleted_at is null);

-- 5. The one write path for a checklist tick ---------------------------------
create or replace function public.tk_close_tick(p_client_id text, p_period text, p_item_key text, p_done boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_done boolean := coalesce(p_done, false);
  v_task uuid;
  r record;
  v_out text;
  v_msg text;
  v_status text;
begin
  if v_me = '' or not public.is_active_staff() then
    raise exception 'tk_forbidden' using errcode = '42501';
  end if;
  if p_client_id is null or not public.can_access_client(p_client_id)
     or p_client_id = any (public.internal_blocked_ids()) then
    raise exception 'tk_forbidden' using errcode = '42501';
  end if;
  -- Only the five linked steps go through here; "sent" and Ledger reviewed keep their own writers.
  if p_period is null or p_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
     or not public.tk__is_close_task_key(p_item_key) then
    raise exception 'tk_bad_input' using errcode = '22023';
  end if;

  v_task := public.tk__close_task(p_client_id, p_period, p_item_key);
  if v_task is null then
    -- no live linked task: the item is written as it always was
    insert into public.client_close_items (client_id, period, item_key, done)
    values (p_client_id, p_period, p_item_key, v_done)
    on conflict (client_id, period, item_key) do update set done = excluded.done;
    return jsonb_build_object('status', 'saved', 'linked_task_id', null, 'done', v_done, 'message', null);
  end if;

  select x.id, x.status, x.submitted_by, x.approved_at into r
    from public.staff_reminders x where x.id = v_task for update;
  if not public.tk_can_edit_task(v_task) then
    return jsonb_build_object('status', 'blocked', 'linked_task_id', v_task, 'task_status', r.status,
                              'done', r.status = 'done', 'message', 'You can''t change this task. Ask its assignee or an admin.');
  end if;

  begin
    if v_done then
      if r.status in ('todo', 'in_progress') then
        v_out := public.tk_set_status(v_task, 'done');
        if v_out = 'ready_for_review' then
          v_status := 'review'; v_msg := 'Sent for review';
        else
          v_status := 'done'; v_msg := 'Task marked done';
        end if;
      elsif r.status = 'waiting_client' then
        v_status := 'blocked'; v_msg := 'Waiting on the client. Close the request first.';
      elsif r.status = 'ready_for_review' then
        v_status := 'blocked'; v_msg := 'In review';
      else
        v_status := 'unchanged'; v_msg := null;   -- already done
      end if;
    else
      if r.status = 'done' then
        if r.approved_at is not null and not public.is_active_staff_admin() then
          v_status := 'blocked'; v_msg := 'Ask an admin to reopen';
        else
          v_out := public.tk_set_status(v_task, 'todo');
          v_status := 'reopened'; v_msg := 'Task reopened';
        end if;
      elsif r.status = 'ready_for_review' then
        if lower(coalesce(r.submitted_by, '')) = v_me then
          v_out := public.tk_withdraw_review(v_task);
          v_status := 'withdrawn'; v_msg := 'Pulled back from review';
        else
          v_status := 'blocked'; v_msg := 'In review. Only the person who sent it can pull it back.';
        end if;
      else
        v_status := 'unchanged'; v_msg := null;   -- todo / in progress / waiting: already unticked
      end if;
    end if;
  exception when others then
    -- tk_blocked (Slate plus "Blocked by", 2026-10-27): plain words, never an error.
    if sqlerrm ~ '^tk_(forbidden|bad_transition|has_open_requests|needs_approval|task_in_trash|project_trashed|blocked)' then
      v_status := 'blocked';
      v_msg := case
        when sqlerrm like 'tk_blocked%' then 'This task is waiting on another task to finish.'
        when sqlerrm like 'tk_has_open_requests%' then 'Waiting on the client. Close the request first.'
        when sqlerrm like 'tk_needs_approval%' then 'In review'
        when sqlerrm like 'tk_forbidden%' and not v_done then 'Ask an admin to reopen'
        when sqlerrm like 'tk_forbidden%' then 'You can''t change this task. Ask its assignee or an admin.'
        when sqlerrm like 'tk_task_in_trash%' or sqlerrm like 'tk_project_trashed%' then 'This task is in the trash.'
        else 'The task can''t move that way right now.' end;
    else
      raise;
    end if;
  end;

  -- self-heal: the item always ends matching the task
  perform public.tk__close_sync(v_task);
  select x.status into r from public.staff_reminders x where x.id = v_task;
  return jsonb_build_object('status', v_status, 'linked_task_id', v_task, 'task_status', r.status,
                            'done', r.status = 'done', 'message', v_msg);
end $$;
revoke all on function public.tk_close_tick(text, text, text, boolean) from public, anon;
grant execute on function public.tk_close_tick(text, text, text, boolean) to authenticated;

-- 1b. The toggle's setter --------------------------------------------------
create or replace function public.tk__close_optin_can_edit(p_client text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_active_staff()
     and public.can_access_client(p_client)
     and not (p_client = any (public.internal_blocked_ids()))
     and (public.is_active_staff_admin()
          or exists (select 1 from public.clients c
                      where c.id = p_client
                        and lower(coalesce(c.account_manager_email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
                        and lower(coalesce(auth.jwt() ->> 'email', '')) <> ''));
$$;
revoke all on function public.tk__close_optin_can_edit(text) from public, anon, authenticated;

create or replace function public.tk_set_close_optin(p_client_id text, p_enabled boolean, p_include_current boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if v_me = '' or p_client_id is null or not public.tk__close_optin_can_edit(p_client_id) then
    raise exception 'tk_forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from public.clients c where c.id = p_client_id) then
    raise exception 'tk_forbidden' using errcode = '42501';
  end if;
  if coalesce(p_enabled, false) then
    insert into public.tk_client_close_optin (client_id, enabled_at, enabled_by, include_current_month)
    values (p_client_id, now(), v_me, coalesce(p_include_current, false))
    on conflict (client_id) do update
      set enabled_at = case when tk_client_close_optin.disabled_at is null then tk_client_close_optin.enabled_at else now() end,
          enabled_by = case when tk_client_close_optin.disabled_at is null then tk_client_close_optin.enabled_by else v_me end,
          -- review fix (minor): already on, "also this month" can still be added (never taken away)
          include_current_month = case when tk_client_close_optin.disabled_at is null
                                       then tk_client_close_optin.include_current_month or coalesce(p_include_current, false)
                                       else coalesce(p_include_current, false) end,
          disabled_at = null,
          disabled_by = null;
  else
    update public.tk_client_close_optin
       set disabled_at = now(), disabled_by = v_me
     where client_id = p_client_id and disabled_at is null;
  end if;
  return public.tk_close_optin_status(p_client_id);
end $$;

-- 7. The toggle's state, plus recurring templates that look like month-end work.
create or replace function public.tk_close_optin_status(p_client_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  o record;
  v_overlap jsonb;
  v_floor date;
begin
  if p_client_id is null or not public.is_active_staff() or not public.can_access_client(p_client_id)
     or p_client_id = any (public.internal_blocked_ids()) then
    raise exception 'tk_forbidden' using errcode = '42501';
  end if;
  select * into o from public.tk_client_close_optin x where x.client_id = p_client_id;
  v_floor := public.tk__close_optin_floor(p_client_id);
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title) order by t.title), '[]'::jsonb)
    into v_overlap
    from public.task_templates t
    join public.clients cl on cl.id = p_client_id
   where t.active and t.status = 'active'
     and not exists (select 1 from public.tk_template_sets s where s.id = t.template_set_id and s.is_standard)
     and ((cardinality(t.plan_tiers) = 0 and cardinality(t.client_ids) = 0)
          or cl.plan = any (t.plan_tiers) or cl.id = any (t.client_ids))
     and (t.close_key is not null or t.title ~* '\m(rec|recs|reconcil\w*|bank|card|close)\M')
     and not coalesce((public.tk__template_eff(t, p_client_id) ->> 'skip')::boolean, false);
  return jsonb_build_object(
    'enabled', o.client_id is not null and o.disabled_at is null,
    'include_current_month', coalesce(o.include_current_month, false),
    'enabled_at', o.enabled_at,
    'enabled_by', o.enabled_by,
    'disabled_at', o.disabled_at,
    'starts', v_floor,
    'can_edit', public.tk__close_optin_can_edit(p_client_id),
    'set_live', coalesce(public.tk__jsonb_bool((select value from tk_settings where key = 'standard_set_live')), false),
    'overlaps', v_overlap);
end $$;
revoke all on function public.tk_close_optin_status(text) from public, anon;
grant execute on function public.tk_close_optin_status(text) to authenticated;
revoke all on function public.tk_set_close_optin(text, boolean, boolean) from public, anon;
grant execute on function public.tk_set_close_optin(text, boolean, boolean) to authenticated;

-- 8b. schema version ------------------------------------------------------
create or replace function public.tk_schema_version()
returns integer
language sql
stable
set search_path = public
as $$ select 11 $$;
