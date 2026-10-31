-- Master Data fee sync (owner request 2026-10-31). Spec: docs/master-sheet-sync-spec.md
--
-- Applied to production 2026-10-31 as migration master_sheet_sync
-- (tests: 56/56 passed, holden vs jesse vs a bookkeeper, rolled back).
-- Safe to re-run. Needs client-profitability.sql, profitability-internal-only.sql
-- and audit-log.sql applied first. Tests: supabase/master-sheet-sync-tests.sql.
--
-- INTERNAL-ONLY like the rest of profitability: every table here is readable
-- only by an active admin with the owner's MGB (internal) grant
-- (is_active_staff_admin() and can_view_internal()). Audit rows use the
-- client_fee.* prefix, which the restrictive audit_log policy already hides.
--
-- What this adds
--   client_fees.source          'manual' | 'master_sheet' (who set the fee last)
--   client_fees.sheet_override  true = an admin overrode the synced fee; the sync
--                               leaves this client alone until "Resume sync"
--   client_fees.synced_at       last time the sync confirmed or wrote this fee
--   master_sheet_norm(text)     lowercase, drop every non a-z0-9 (same as the
--                               edge function's normName)
--   master_sheet_client_map     admin-editable: sheet name -> portal client, or
--                               "not a client" (ignored)
--   master_sheet_sync_runs      the sync log (written by the edge function)
--   master_sheet_unmatched      sheet rows with no portal client (review list)
--   master_sheet_apply()        the only writer of synced fees; service role only
--   client_fees guard trigger   an admin's fee edit on a synced row turns the
--                               override on; admins can't fake source/synced_at;
--                               a synced row can't be deleted without override
--   master_sheet_cron_tick()    nightly 08:20 UTC, posts to the edge function
--                               only after a manual live run has succeeded
--
-- Rollback
--   1. Stop the nightly run:  select cron.unschedule('master-sheet-sync-nightly');
--   2. Put fees back from a run's log (each change has from/to):
--        update client_fees f set monthly_fee = (c->>'from')::numeric, source = 'manual'
--        from master_sheet_sync_runs r, jsonb_array_elements(r.detail->'changes') c
--        where r.id = <run id> and f.client_id = c->>'client_id' and c->>'from' is not null;
--      (fees the run created have from = null; remove those by hand if wanted)
--   3. Remove everything: drop function master_sheet_cron_tick(), master_sheet_apply(bigint,jsonb,jsonb,boolean);
--      drop trigger client_fees_sheet_guard on client_fees; drop function client_fees_sheet_guard();
--      drop table master_sheet_unmatched, master_sheet_sync_runs, master_sheet_client_map;
--      alter table client_fees drop column source, drop column sheet_override, drop column synced_at;
--      drop function master_sheet_norm(text); and remove the two client_fees
--      additions and the master_sheet_client_map branch from audit_row_change().

begin;

-- ---------------------------------------------------------------------------
-- 1. client_fees columns
-- ---------------------------------------------------------------------------
alter table public.client_fees
  add column if not exists source text not null default 'manual',
  add column if not exists sheet_override boolean not null default false,
  add column if not exists synced_at timestamptz;
alter table public.client_fees drop constraint if exists client_fees_source_check;
alter table public.client_fees add constraint client_fees_source_check check (source in ('manual', 'master_sheet'));

-- ---------------------------------------------------------------------------
-- 2. Name normalization (must match logic.js normName)
-- ---------------------------------------------------------------------------
create or replace function public.master_sheet_norm(s text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$ select regexp_replace(lower(coalesce(s, '')), '[^a-z0-9]', '', 'g') $$;

-- ---------------------------------------------------------------------------
-- 3. Map: sheet name -> portal client (or "not a client")
-- ---------------------------------------------------------------------------
create table if not exists public.master_sheet_client_map (
  sheet_name text not null check (length(btrim(sheet_name)) > 0),
  sheet_key text generated always as (public.master_sheet_norm(sheet_name)) stored primary key,
  client_id text references public.clients (id) on delete cascade,
  ignored boolean not null default false,
  note text,
  updated_by text,
  updated_at timestamptz not null default now(),
  check (ignored or client_id is not null)
);
alter table public.master_sheet_client_map enable row level security;
revoke all on public.master_sheet_client_map from anon, public;
grant select, insert, update, delete on public.master_sheet_client_map to authenticated;

drop policy if exists "internal admins read sheet map" on public.master_sheet_client_map;
create policy "internal admins read sheet map" on public.master_sheet_client_map
  for select to authenticated
  using ((select public.is_active_staff_admin()) and (select public.can_view_internal()));
drop policy if exists "internal admins insert sheet map" on public.master_sheet_client_map;
create policy "internal admins insert sheet map" on public.master_sheet_client_map
  for insert to authenticated
  with check ((select public.is_active_staff_admin()) and (select public.can_view_internal()));
drop policy if exists "internal admins update sheet map" on public.master_sheet_client_map;
create policy "internal admins update sheet map" on public.master_sheet_client_map
  for update to authenticated
  using ((select public.is_active_staff_admin()) and (select public.can_view_internal()))
  with check ((select public.is_active_staff_admin()) and (select public.can_view_internal()));
drop policy if exists "internal admins delete sheet map" on public.master_sheet_client_map;
create policy "internal admins delete sheet map" on public.master_sheet_client_map
  for delete to authenticated
  using ((select public.is_active_staff_admin()) and (select public.can_view_internal()));

create or replace function public.master_sheet_map_stamp()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(nullif(auth.jwt() ->> 'email', ''), new.updated_by, 'system');
  if new.ignored then
    new.client_id := null;
  end if;
  return new;
end
$$;
drop trigger if exists master_sheet_map_stamp on public.master_sheet_client_map;
create trigger master_sheet_map_stamp before insert or update on public.master_sheet_client_map
  for each row execute function public.master_sheet_map_stamp();

drop trigger if exists audit_log_trg on public.master_sheet_client_map;
create trigger audit_log_trg after insert or update or delete on public.master_sheet_client_map
  for each row execute function public.audit_row_change();

-- Known odd names (owner list 2026-10-31). Exact matches only; The Way
-- Community Church is The Way Bookkeeping, never Pathway Community Church.
insert into public.master_sheet_client_map (sheet_name, client_id, note, updated_by)
select v.sheet_name, v.client_id, 'owner list 2026-10-31', 'master-sheet-sync setup'
from (values
  ('Life Church Danville', 'life-church'),
  ('City House Church, Milwaukee', 'city-house-church'),
  ('Compassion Church AZ', 'compassion-church'),
  ('The Way Community Church', 'the-way')
) as v(sheet_name, client_id)
where exists (select 1 from public.clients c where c.id = v.client_id)
on conflict (sheet_key) do nothing;

-- ---------------------------------------------------------------------------
-- 4. Sync log and review list (written only by the edge function)
-- ---------------------------------------------------------------------------
create table if not exists public.master_sheet_sync_runs (
  id bigint generated always as identity primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  trigger text not null check (trigger in ('manual', 'cron')),
  mode text not null check (mode in ('live', 'dry_run')),
  status text not null default 'running'
    check (status in ('running', 'ok', 'error', 'not_connected', 'skipped', 'held', 'changed_since_preview')),
  requested_by text,
  fee_column text,
  rows_read int not null default 0,
  updated int not null default 0,
  unchanged int not null default 0,
  unmatched int not null default 0,
  skipped int not null default 0,
  errors int not null default 0,
  conflicts int not null default 0,
  fingerprint text,
  message text,
  detail jsonb not null default '{}'::jsonb
);
create index if not exists master_sheet_sync_runs_started on public.master_sheet_sync_runs (started_at desc);
alter table public.master_sheet_sync_runs enable row level security;
revoke all on public.master_sheet_sync_runs from anon, public, authenticated;
grant select on public.master_sheet_sync_runs to authenticated;
drop policy if exists "internal admins read sheet sync runs" on public.master_sheet_sync_runs;
create policy "internal admins read sheet sync runs" on public.master_sheet_sync_runs
  for select to authenticated
  using ((select public.is_active_staff_admin()) and (select public.can_view_internal()));

create table if not exists public.master_sheet_unmatched (
  sheet_key text primary key,
  sheet_name text not null,
  status text,
  fee_text text,
  reason text,
  last_run_id bigint,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
alter table public.master_sheet_unmatched enable row level security;
revoke all on public.master_sheet_unmatched from anon, public, authenticated;
grant select on public.master_sheet_unmatched to authenticated;
drop policy if exists "internal admins read sheet unmatched" on public.master_sheet_unmatched;
create policy "internal admins read sheet unmatched" on public.master_sheet_unmatched
  for select to authenticated
  using ((select public.is_active_staff_admin()) and (select public.can_view_internal()));

grant all on public.master_sheet_sync_runs, public.master_sheet_unmatched, public.master_sheet_client_map to service_role;

-- ---------------------------------------------------------------------------
-- 5. client_fees guard for people (the sync itself runs as the definer)
-- ---------------------------------------------------------------------------
create or replace function public.client_fees_sheet_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Only people signed in to the app. master_sheet_apply() is SECURITY DEFINER,
  -- so current_user there is the owner and this guard steps aside.
  if current_user not in ('authenticated', 'anon') then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    if old.source = 'master_sheet' and not old.sheet_override then
      raise exception 'This fee is synced from Master Data. Turn on Override before removing it.'
        using errcode = '42501';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    new.source := 'manual';
    new.synced_at := null;
    return new;
  end if;

  -- UPDATE: people never set who-wrote-it fields.
  new.source := old.source;
  new.synced_at := old.synced_at;
  if old.source = 'master_sheet' and not old.sheet_override and not new.sheet_override
     and new.monthly_fee is distinct from old.monthly_fee then
    -- Editing a synced fee is an override (else the next sync would undo it).
    new.sheet_override := true;
  end if;
  return new;
end
$$;
drop trigger if exists client_fees_sheet_guard on public.client_fees;
create trigger client_fees_sheet_guard before insert or update or delete on public.client_fees
  for each row execute function public.client_fees_sheet_guard();

-- ---------------------------------------------------------------------------
-- 6. Audit: override on/off, fee source, map changes
-- ---------------------------------------------------------------------------
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

select pg_temp.patch_fn('public.audit_row_change()',
$a$  elsif t = 'client_fees' then
    if tg_op = 'UPDATE' and (o ->> 'monthly_fee') is not distinct from (n ->> 'monthly_fee') then$a$,
$a$  elsif t = 'client_fees' then
    if tg_op = 'UPDATE' and (o ->> 'sheet_override') is distinct from (n ->> 'sheet_override') then
      perform audit_write(
        case when coalesce((n ->> 'sheet_override')::boolean, false)
             then 'client_fee.sheet_override_on' else 'client_fee.sheet_override_off' end,
        n ->> 'client_id', 'client', n ->> 'client_id',
        jsonb_build_object('fee', n -> 'monthly_fee'));
    end if;
    if tg_op = 'UPDATE' and (o ->> 'monthly_fee') is not distinct from (n ->> 'monthly_fee') then$a$, 1);

select pg_temp.patch_fn('public.audit_row_change()',
$a$jsonb_build_object('from', o -> 'monthly_fee', 'to', n -> 'monthly_fee'));$a$,
$a$jsonb_build_object('from', o -> 'monthly_fee', 'to', n -> 'monthly_fee', 'source', r ->> 'source'));$a$, 1);

select pg_temp.patch_fn('public.audit_row_change()',
$a$  elsif t = 'client_milestones' then$a$,
$a$  elsif t = 'master_sheet_client_map' then
    perform audit_write('client_fee.sheet_map.' || lower(tg_op),
      coalesce(n ->> 'client_id', o ->> 'client_id'), 'master_sheet_row', r ->> 'sheet_key',
      jsonb_build_object('sheet_name', r ->> 'sheet_name',
                         'from_client', o ->> 'client_id', 'to_client', n ->> 'client_id',
                         'ignored', n -> 'ignored'));

  elsif t = 'client_milestones' then$a$, 1);

-- ---------------------------------------------------------------------------
-- 7. The one writer of synced fees (called by the edge function's service role)
-- ---------------------------------------------------------------------------
-- p_items:     [{client_id, from, to}] from the plan (from = fee the plan saw,
--              null = no fee row). Each is rechecked here; anything that moved
--              since the plan is a conflict and is left alone.
-- p_unmatched: [{sheet_key, sheet_name, status, fee_text, reason}]
-- p_rebuild_unmatched: true on a live run (replace the review list).
create or replace function public.master_sheet_apply(
  p_run_id bigint,
  p_items jsonb,
  p_unmatched jsonb default '[]'::jsonb,
  p_rebuild_unmatched boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  it record;
  c record;
  f record;
  v_updated int := 0;
  v_unchanged int := 0;
  v_skipped int := 0;
  v_conflicts int := 0;
  v_changes jsonb := '[]'::jsonb;
  v_conflict_list jsonb := '[]'::jsonb;
  v_n int;
begin
  if coalesce(auth.role(), '') <> 'service_role' and session_user not in ('postgres', 'supabase_admin') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then
    raise exception 'p_items must be an array';
  end if;

  perform pg_advisory_xact_lock(hashtext('master_sheet_sync'));

  -- The audit trigger names this actor (audit_write reads auth.jwt()->>'email').
  perform set_config('request.jwt.claim', '', true);
  perform set_config('request.jwt.claims', '{"email":"master-sheet-sync","role":"service_role"}', true);

  for it in
    select x.client_id, x."from" as from_fee, x."to" as to_fee
    from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) as x(client_id text, "from" numeric, "to" numeric)
  loop
    if it.to_fee is null or it.to_fee <= 0 or it.to_fee > 100000 then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    select id, name, test_only, is_internal into c from clients where id = it.client_id;
    if not found or coalesce(c.test_only, false) or coalesce(c.is_internal, false) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    select * into f from client_fees where client_id = it.client_id for update;
    if found then
      if f.sheet_override then
        v_skipped := v_skipped + 1;
        continue;
      end if;
      if it.from_fee is null or f.monthly_fee <> it.from_fee then
        v_conflicts := v_conflicts + 1;
        v_conflict_list := v_conflict_list || jsonb_build_object('client_id', it.client_id, 'client_name', c.name,
          'planned_from', it.from_fee, 'now', f.monthly_fee, 'to', it.to_fee);
        continue;
      end if;
      if f.monthly_fee = round(it.to_fee, 2) then
        update client_fees set source = 'master_sheet', synced_at = now() where client_id = it.client_id;
        v_unchanged := v_unchanged + 1;
      else
        update client_fees
           set monthly_fee = round(it.to_fee, 2), source = 'master_sheet', synced_at = now(),
               updated_by = 'master-sheet-sync', updated_at = now(),
               needs_review = false, review_note = null
         where client_id = it.client_id;
        v_updated := v_updated + 1;
        v_changes := v_changes || jsonb_build_object('client_id', it.client_id, 'client_name', c.name,
          'from', f.monthly_fee, 'to', round(it.to_fee, 2));
      end if;
    else
      if it.from_fee is not null then
        v_conflicts := v_conflicts + 1;
        v_conflict_list := v_conflict_list || jsonb_build_object('client_id', it.client_id, 'client_name', c.name,
          'planned_from', it.from_fee, 'now', null, 'to', it.to_fee);
        continue;
      end if;
      insert into client_fees (client_id, monthly_fee, source, synced_at, updated_by, updated_at)
      values (it.client_id, round(it.to_fee, 2), 'master_sheet', now(), 'master-sheet-sync', now())
      on conflict (client_id) do nothing;
      get diagnostics v_n = row_count;
      if v_n = 1 then
        v_updated := v_updated + 1;
        v_changes := v_changes || jsonb_build_object('client_id', it.client_id, 'client_name', c.name,
          'from', null, 'to', round(it.to_fee, 2));
      else
        v_conflicts := v_conflicts + 1;
      end if;
    end if;
  end loop;

  if p_rebuild_unmatched then
    delete from master_sheet_unmatched u
     where not exists (select 1 from jsonb_array_elements(coalesce(p_unmatched, '[]'::jsonb)) e
                        where e ->> 'sheet_key' = u.sheet_key);
    insert into master_sheet_unmatched (sheet_key, sheet_name, status, fee_text, reason, last_run_id, last_seen_at)
    select distinct on (e ->> 'sheet_key')
           e ->> 'sheet_key', e ->> 'sheet_name', e ->> 'status', left(e ->> 'fee_text', 80), e ->> 'reason',
           p_run_id, now()
      from jsonb_array_elements(coalesce(p_unmatched, '[]'::jsonb)) e
     where coalesce(e ->> 'sheet_key', '') <> '' and coalesce(e ->> 'sheet_name', '') <> ''
    on conflict (sheet_key) do update
      set sheet_name = excluded.sheet_name, status = excluded.status, fee_text = excluded.fee_text,
          reason = excluded.reason, last_run_id = excluded.last_run_id, last_seen_at = now();
  end if;

  return jsonb_build_object('updated', v_updated, 'unchanged', v_unchanged, 'skipped', v_skipped,
    'conflicts', v_conflicts, 'changes', v_changes, 'conflict_list', v_conflict_list);
end
$$;
revoke all on function public.master_sheet_apply(bigint, jsonb, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.master_sheet_apply(bigint, jsonb, jsonb, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- 8. Nightly run (waits for the first successful manual live run)
-- ---------------------------------------------------------------------------
create or replace function public.master_sheet_cron_tick()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint;
begin
  if not exists (select 1 from master_sheet_sync_runs
                  where trigger = 'manual' and mode = 'live' and status = 'ok') then
    return null;
  end if;
  if exists (select 1 from master_sheet_sync_runs
              where trigger = 'cron' and started_at > now() - interval '20 hours') then
    return null;
  end if;
  select net.http_post(
    url := 'https://xumsqmhccgfjnlmieqyu.supabase.co/functions/v1/master-sheet-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets
        where name = 'qbo_cron_key' limit 1
      )
    ),
    body := '{"trigger":"cron","action":"sync"}'::jsonb,
    timeout_milliseconds := 120000
  ) into v_id;
  return v_id;
end
$$;
revoke all on function public.master_sheet_cron_tick() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'master-sheet-sync-nightly') then
    perform cron.unschedule('master-sheet-sync-nightly');
  end if;
  perform cron.schedule('master-sheet-sync-nightly', '20 8 * * *', 'select public.master_sheet_cron_tick();');
end
$$;

commit;
