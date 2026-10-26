-- =====================================================================
-- Thread menu (docs/thread-menu-spec.md, sections 2 and 3).
--
-- Staff-side state for one client message thread, (client_id,
-- participant_email) in public.client_messages: a staff-only label, Hide
-- (admins Restore), Done, Snooze, Pin and an "Assigned" tag, plus an audit
-- row for every write. Firm-wide shared state, last write wins.
--
-- Additive only: two new tables and new functions. Nothing here alters
-- client_messages, client_message_reads, notification_outbox or any table a
-- client can read. The only cross-table write is wb_thread_noreply (staff
-- only, already exists), the Desk's "No reply needed" marker, so Done and Hide
-- also take the thread off the Desk Inbox.
--
-- Clients never see any of it: no client policy, no publication, no trigger
-- on client_messages, no edge function reads either table. Writes only
-- through the RPCs below (security definer, auth checked inside).
--
-- The app reads client_thread_state only while the thread menu is on for the
-- person (preview flag mgb_threadmenu_preview or the owner-only firm switch
-- tk_settings.threadmenu_enabled, components/inbox/TM_gate.js).
--
-- Self-test: supabase/thread-menu-tests.sql (ends in ROLLBACK).
-- Applied to production 2026-10-25 (project xumsqmhccgfjnlmieqyu).
-- Updated 2026-10-25 (review fix, applied the same day as migration
-- thread_menu_hide_marker): hide_marker_id keeps Hide's Desk marker apart
-- from Done's, Restore undoes the marker Hide made, and a marker is handed
-- over (not undone) while the other state still holds.
-- =====================================================================

create table if not exists public.client_thread_state (
  client_id         text not null references public.clients(id) on delete cascade,
  participant_email text not null check (participant_email = lower(trim(participant_email))
                                         and char_length(participant_email) <= 320),
  label             text check (label is null or char_length(label) between 1 and 80),
  hidden_at timestamptz, hidden_by text,
  done_at   timestamptz, done_by   text,
  done_marker_id uuid,             -- wb_thread_noreply row Done inserted (or Restore handed over)
  hide_marker_id uuid,             -- wb_thread_noreply row Hide inserted (or Reopen handed over)
  snoozed_until timestamptz, snoozed_at timestamptz, snoozed_by text,
  pinned_at timestamptz, pinned_by text,
  assignee_email text,
  updated_at timestamptz not null default now(), updated_by text,
  primary key (client_id, participant_email)
);

alter table public.client_thread_state add column if not exists hide_marker_id uuid;

create table if not exists public.client_thread_audit (          -- no FK: survives client deletion
  id uuid primary key default gen_random_uuid(),
  client_id text not null,
  participant_email text not null,
  action text not null check (action in ('label','hide','restore','done','reopen','snooze','unsnooze',
                                        'pin','unpin','assign','task')),
  from_value jsonb,
  to_value jsonb,
  marker_id uuid,                  -- set when the action inserted a wb_thread_noreply marker
  actor_email text not null,
  at timestamptz not null default now()
);
create index if not exists client_thread_audit_thread_idx
  on public.client_thread_audit (client_id, participant_email, at desc);
create index if not exists client_thread_audit_marker_idx
  on public.client_thread_audit (marker_id) where marker_id is not null;

alter table public.client_thread_state enable row level security;
alter table public.client_thread_audit enable row level security;

revoke all on public.client_thread_state from public, anon, authenticated;
revoke all on public.client_thread_audit from public, anon, authenticated;
grant select on public.client_thread_state to authenticated;

drop policy if exists cts_staff_read on public.client_thread_state;
create policy cts_staff_read on public.client_thread_state
  as permissive for select to authenticated
  using ((select public.is_active_staff()) and public.can_access_client(client_id));

-- Parity with client_messages' "internal company lock".
drop policy if exists cts_internal_lock on public.client_thread_state;
create policy cts_internal_lock on public.client_thread_state
  as restrictive for all
  using (client_id <> all ((select public.internal_blocked_ids())::text[]));

-- Audit: no grant and no policy. Written only by the RPCs; admins read it in SQL.

-- ---------------------------------------------------------------------
-- Private helpers (only the RPCs call these)
-- ---------------------------------------------------------------------

-- Who may act on this thread. Returns the normalized participant email.
create or replace function public.thread__guard(p_client_id text, p_email text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_email text := lower(trim(coalesce(p_email, '')));
begin
  if v_me = '' or not public.is_active_staff() then
    raise exception 'not_staff' using errcode = '42501';
  end if;
  if p_client_id is null or not public.can_access_client(p_client_id)
     or p_client_id = any (coalesce(public.internal_blocked_ids(), array[]::text[])) then
    raise exception 'no_client_access' using errcode = '42501';
  end if;
  if v_email = '' or char_length(v_email) > 320 then
    raise exception 'bad_email' using errcode = '22023';
  end if;
  if not exists (select 1 from client_messages m
                  where m.client_id = p_client_id and m.participant_email = v_email
                    and m.deleted_at is null) then
    raise exception 'no_thread' using errcode = '22023';
  end if;
  return v_email;
end $$;

-- The Desk "No reply needed" marker through the latest client message.
-- Returns the marker id this call inserted, else null (no client message, or
-- already marked through it: an existing marker is never claimed).
create or replace function public.thread__mark_no_reply(p_client_id text, p_email text)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_msg client_messages%rowtype;
  v_id uuid;
begin
  select * into v_msg from client_messages m
   where m.client_id = p_client_id and m.participant_email = p_email
     and m.author_kind = 'client' and m.internal = false and m.deleted_at is null
   order by m.created_at desc, m.id desc
   limit 1;
  if not found then
    return null;
  end if;
  if exists (select 1 from wb_thread_noreply n
              where n.through_message_id = v_msg.id and n.undone_at is null) then
    return null;
  end if;
  insert into wb_thread_noreply (client_id, participant_email, through_message_id, through_at, reason, marked_by)
  values (v_msg.client_id, v_msg.participant_email, v_msg.id, v_msg.created_at, 'no_reply_needed', v_me)
  returning id into v_id;
  return v_id;
end $$;

-- The state row (created lazily), locked for this write.
create or replace function public.thread__row(p_client_id text, p_email text)
returns public.client_thread_state
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_row client_thread_state%rowtype;
begin
  insert into client_thread_state (client_id, participant_email)
  values (p_client_id, p_email)
  on conflict (client_id, participant_email) do nothing;
  select * into v_row from client_thread_state
   where client_id = p_client_id and participant_email = p_email
   for update;
  return v_row;
end $$;

create or replace function public.thread__audit(p_client_id text, p_email text, p_action text,
                                                p_from jsonb, p_to jsonb, p_marker uuid)
returns void
language sql
volatile
security definer
set search_path = public
as $$
  insert into client_thread_audit (client_id, participant_email, action, from_value, to_value, marker_id, actor_email)
  values (p_client_id, p_email, p_action, p_from, p_to, p_marker, lower(coalesce(auth.jwt() ->> 'email', '')));
$$;

revoke execute on function public.thread__guard(text, text) from public, anon, authenticated;
revoke execute on function public.thread__mark_no_reply(text, text) from public, anon, authenticated;
revoke execute on function public.thread__row(text, text) from public, anon, authenticated;
revoke execute on function public.thread__audit(text, text, text, jsonb, jsonb, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Public RPCs (staff with access to the client; Restore is admin-only)
-- ---------------------------------------------------------------------

-- Rename: staff-side label only, never the messages. '' or null clears.
create or replace function public.thread_set_label(p_client_id text, p_email text, p_label text)
returns public.client_thread_state
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_email text := public.thread__guard(p_client_id, p_email);
  v_label text;
  v_row client_thread_state%rowtype;
  v_old text;
begin
  v_label := btrim(regexp_replace(regexp_replace(coalesce(p_label, ''), '[[:cntrl:]]', ' ', 'g'), '\s+', ' ', 'g'));
  if v_label = '' then v_label := null; end if;
  if v_label is not null and char_length(v_label) > 80 then
    raise exception 'bad_label' using errcode = '22023';
  end if;
  v_row := public.thread__row(p_client_id, v_email);
  v_old := v_row.label;
  update client_thread_state set label = v_label, updated_at = now(), updated_by = v_me
   where client_id = p_client_id and participant_email = v_email
   returning * into v_row;
  perform public.thread__audit(p_client_id, v_email, 'label', to_jsonb(v_old), to_jsonb(v_label), null);
  return v_row;
end $$;

-- Hide: restorable (never a delete). Also takes the thread off the Desk.
create or replace function public.thread_hide(p_client_id text, p_email text)
returns public.client_thread_state
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_email text := public.thread__guard(p_client_id, p_email);
  v_row client_thread_state%rowtype;
  v_old timestamptz;
  v_m uuid;
begin
  v_row := public.thread__row(p_client_id, v_email);
  v_old := v_row.hidden_at;
  v_m := public.thread__mark_no_reply(p_client_id, v_email);
  update client_thread_state
     set hidden_at = now(), hidden_by = v_me,
         hide_marker_id = coalesce(v_m, hide_marker_id),
         updated_at = now(), updated_by = v_me
   where client_id = p_client_id and participant_email = v_email
   returning * into v_row;
  perform public.thread__audit(p_client_id, v_email, 'hide', to_jsonb(v_old), to_jsonb(v_row.hidden_at), v_m);
  return v_row;
end $$;

-- Restore a hidden thread: admins only. Undoes the Desk marker Hide made,
-- unless the thread is still done with no marker of its own (then Done keeps it).
create or replace function public.thread_restore(p_client_id text, p_email text)
returns public.client_thread_state
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_email text := public.thread__guard(p_client_id, p_email);
  v_row client_thread_state%rowtype;
  v_old timestamptz;
  v_marker uuid;
  v_hand boolean := false;
begin
  if not public.is_active_staff_admin() then
    raise exception 'admin_only' using errcode = '42501';
  end if;
  v_row := public.thread__row(p_client_id, v_email);
  v_old := v_row.hidden_at;
  v_marker := v_row.hide_marker_id;
  if v_marker is not null then
    if v_row.done_at is not null and v_row.done_marker_id is null then
      v_hand := true;
    else
      update wb_thread_noreply set undone_at = now(), undone_by = v_me
       where id = v_marker and undone_at is null;
    end if;
  end if;
  update client_thread_state
     set hidden_at = null, hidden_by = null, hide_marker_id = null,
         done_marker_id = case when v_hand then v_marker else done_marker_id end,
         updated_at = now(), updated_by = v_me
   where client_id = p_client_id and participant_email = v_email
   returning * into v_row;
  perform public.thread__audit(p_client_id, v_email, 'restore', to_jsonb(v_old),
                               case when v_marker is null then null
                                    when v_hand then jsonb_build_object('handed_marker', v_marker)
                                    else jsonb_build_object('undid_marker', v_marker) end, null);
  return v_row;
end $$;

-- Mark done (true) / Reopen (false). Reopen undoes only the marker Done
-- made, and hands it to Hide instead while the thread is still hidden with no
-- marker of its own.
create or replace function public.thread_set_done(p_client_id text, p_email text, p_done boolean)
returns public.client_thread_state
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_email text := public.thread__guard(p_client_id, p_email);
  v_row client_thread_state%rowtype;
  v_old timestamptz;
  v_m uuid;
  v_marker uuid;
  v_hand boolean := false;
begin
  v_row := public.thread__row(p_client_id, v_email);
  v_old := v_row.done_at;
  if coalesce(p_done, false) then
    v_m := public.thread__mark_no_reply(p_client_id, v_email);
    update client_thread_state
       set done_at = now(), done_by = v_me,
           done_marker_id = coalesce(v_m, done_marker_id),
           updated_at = now(), updated_by = v_me
     where client_id = p_client_id and participant_email = v_email
     returning * into v_row;
    perform public.thread__audit(p_client_id, v_email, 'done', to_jsonb(v_old), to_jsonb(v_row.done_at), v_m);
  else
    v_marker := v_row.done_marker_id;
    if v_marker is not null then
      if v_row.hidden_at is not null and v_row.hide_marker_id is null then
        v_hand := true;
      else
        update wb_thread_noreply set undone_at = now(), undone_by = v_me
         where id = v_marker and undone_at is null;
      end if;
    end if;
    update client_thread_state
       set done_at = null, done_by = null, done_marker_id = null,
           hide_marker_id = case when v_hand then v_marker else hide_marker_id end,
           updated_at = now(), updated_by = v_me
     where client_id = p_client_id and participant_email = v_email
     returning * into v_row;
    perform public.thread__audit(p_client_id, v_email, 'reopen', to_jsonb(v_old),
                                 case when v_marker is null then null
                                      when v_hand then jsonb_build_object('handed_marker', v_marker)
                                      else jsonb_build_object('undid_marker', v_marker) end, null);
  end if;
  return v_row;
end $$;

-- Snooze until a time (at most 30 days out, WB_SNOOZE_MAX_DAYS); null = Unsnooze.
create or replace function public.thread_snooze(p_client_id text, p_email text, p_until timestamptz)
returns public.client_thread_state
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_email text := public.thread__guard(p_client_id, p_email);
  v_row client_thread_state%rowtype;
  v_old timestamptz;
begin
  -- A few minutes of slack for a browser clock a little ahead.
  if p_until is not null and (p_until <= now() or p_until > now() + interval '30 days 10 minutes') then
    raise exception 'bad_snooze' using errcode = '22023';
  end if;
  v_row := public.thread__row(p_client_id, v_email);
  v_old := v_row.snoozed_until;
  update client_thread_state
     set snoozed_until = p_until,
         snoozed_at = case when p_until is null then null else now() end,
         snoozed_by = case when p_until is null then null else v_me end,
         updated_at = now(), updated_by = v_me
   where client_id = p_client_id and participant_email = v_email
   returning * into v_row;
  perform public.thread__audit(p_client_id, v_email, case when p_until is null then 'unsnooze' else 'snooze' end,
                               to_jsonb(v_old), to_jsonb(p_until), null);
  return v_row;
end $$;

create or replace function public.thread_set_pin(p_client_id text, p_email text, p_pinned boolean)
returns public.client_thread_state
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_email text := public.thread__guard(p_client_id, p_email);
  v_row client_thread_state%rowtype;
  v_old timestamptz;
  v_on boolean := coalesce(p_pinned, false);
begin
  v_row := public.thread__row(p_client_id, v_email);
  v_old := v_row.pinned_at;
  update client_thread_state
     set pinned_at = case when v_on then now() else null end,
         pinned_by = case when v_on then v_me else null end,
         updated_at = now(), updated_by = v_me
   where client_id = p_client_id and participant_email = v_email
   returning * into v_row;
  perform public.thread__audit(p_client_id, v_email, case when v_on then 'pin' else 'unpin' end,
                               to_jsonb(v_old), to_jsonb(v_row.pinned_at), null);
  return v_row;
end $$;

-- Reassign: the staff-side "Assigned: Name" tag only. No notification and no
-- Desk ownership change. null or '' clears.
create or replace function public.thread_assign(p_client_id text, p_email text, p_assignee text)
returns public.client_thread_state
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_email text := public.thread__guard(p_client_id, p_email);
  v_row client_thread_state%rowtype;
  v_old text;
  v_to text := nullif(lower(trim(coalesce(p_assignee, ''))), '');
begin
  if v_to is not null and not (
       exists (select 1 from staff s where lower(s.email) = v_to and s.active)
       and public.tk_staff_has_client(v_to, p_client_id)) then
    raise exception 'bad_assignee' using errcode = '22023';
  end if;
  v_row := public.thread__row(p_client_id, v_email);
  v_old := v_row.assignee_email;
  update client_thread_state set assignee_email = v_to, updated_at = now(), updated_by = v_me
   where client_id = p_client_id and participant_email = v_email
   returning * into v_row;
  perform public.thread__audit(p_client_id, v_email, 'assign', to_jsonb(v_old), to_jsonb(v_to), null);
  return v_row;
end $$;

-- Create task: the app makes the task (TK_api.create, private), then logs it
-- here. Only the caller's own task on the same client.
create or replace function public.thread_log_task(p_client_id text, p_email text, p_task_id uuid)
returns public.client_thread_state
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_email text := public.thread__guard(p_client_id, p_email);
  v_row client_thread_state%rowtype;
begin
  if p_task_id is null or not exists (
       select 1 from staff_reminders r
        where r.id = p_task_id and r.client_id = p_client_id and lower(r.created_by) = v_me) then
    raise exception 'bad_task' using errcode = '22023';
  end if;
  v_row := public.thread__row(p_client_id, v_email);
  update client_thread_state set updated_at = now(), updated_by = v_me
   where client_id = p_client_id and participant_email = v_email
   returning * into v_row;
  perform public.thread__audit(p_client_id, v_email, 'task', null, jsonb_build_object('task_id', p_task_id), null);
  return v_row;
end $$;

revoke execute on function public.thread_set_label(text, text, text) from public, anon;
revoke execute on function public.thread_hide(text, text) from public, anon;
revoke execute on function public.thread_restore(text, text) from public, anon;
revoke execute on function public.thread_set_done(text, text, boolean) from public, anon;
revoke execute on function public.thread_snooze(text, text, timestamptz) from public, anon;
revoke execute on function public.thread_set_pin(text, text, boolean) from public, anon;
revoke execute on function public.thread_assign(text, text, text) from public, anon;
revoke execute on function public.thread_log_task(text, text, uuid) from public, anon;
grant execute on function public.thread_set_label(text, text, text) to authenticated;
grant execute on function public.thread_hide(text, text) to authenticated;
grant execute on function public.thread_restore(text, text) to authenticated;
grant execute on function public.thread_set_done(text, text, boolean) to authenticated;
grant execute on function public.thread_snooze(text, text, timestamptz) to authenticated;
grant execute on function public.thread_set_pin(text, text, boolean) to authenticated;
grant execute on function public.thread_assign(text, text, text) to authenticated;
grant execute on function public.thread_log_task(text, text, uuid) to authenticated;

notify pgrst, 'reload schema';
