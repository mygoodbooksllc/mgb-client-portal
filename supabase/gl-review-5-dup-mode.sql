-- ============================================================================
-- GL Review: "Possible duplicates" mode (Smart / Strict)
-- ----------------------------------------------------------------------------
-- Smart (default) flags a duplicate only with stronger evidence than date +
-- name + amount + account (see components/ledger/GLR_checks.js, "dup" block).
-- Strict is the old rule. The browser runs the checks, so the database only
-- stores the mode and soft-hides flags the Smart rule no longer detects.
--
--   gl_review_settings.dup_mode            firm default ('smart' | 'strict')
--   gl_review_client_settings              optional per-client override
--   gl_review_save_dup_mode(mode, client)  admin only, audit-logged (audit_log)
--   gl_review_hide_dup_flags(...)          after a Smart pull: open dup flags
--                                          Smart set aside become status
--                                          'fixed' with fixed_by 'dup_smart'
--
-- Staff decisions are never touched: only status 'open' flags move, and
-- asked / cleared flags, notes and approvals stay as they are. Soft and
-- reversible: switching to Strict (or a Strict pull) reopens them.
--
-- Rollback (nothing else depends on it):
--   drop function if exists public.gl_review_hide_dup_flags(text, uuid, text[]);
--   drop function if exists public.gl_review_save_dup_mode(text, text);
--   drop table if exists public.gl_review_client_settings;
--   alter table public.gl_review_settings drop column if exists dup_mode;
-- (first reopen with:  update public.gl_review_flags set status = 'open', fixed_at = null,
--   fixed_by = null where fixed_by = 'dup_smart';)
-- Re-run safe.
-- ============================================================================

alter table public.gl_review_settings add column if not exists dup_mode text not null default 'smart';
alter table public.gl_review_settings drop constraint if exists gl_review_settings_dup_mode;
alter table public.gl_review_settings add constraint gl_review_settings_dup_mode check (dup_mode in ('smart', 'strict'));

create table if not exists public.gl_review_client_settings (
  client_id  text primary key references public.clients(id) on delete cascade,
  dup_mode   text not null check (dup_mode in ('smart', 'strict')),
  created_by text,
  created_at timestamptz not null default now(),
  updated_by text,
  updated_at timestamptz not null default now()
);
drop trigger if exists gl_review_client_settings_stamp on public.gl_review_client_settings;
create trigger gl_review_client_settings_stamp before insert or update on public.gl_review_client_settings
  for each row execute function public.gl_review_stamp();

alter table public.gl_review_client_settings enable row level security;
revoke all on public.gl_review_client_settings from public, anon, authenticated;
grant all on public.gl_review_client_settings to service_role;
drop policy if exists "staff read gl review client settings" on public.gl_review_client_settings;
create policy "staff read gl review client settings" on public.gl_review_client_settings
  for select to authenticated
  using (public.is_active_staff() and public.can_access_client(client_id));
grant select on public.gl_review_client_settings to authenticated;

-- Admin only. p_mode 'smart' | 'strict'. With p_client_id it sets that
-- client's override; with p_mode null and a client it clears the override
-- (the client follows the firm default again). Without a client it sets the
-- firm default. Returns {restored}: dup flags reopened right away because the
-- mode that now applies is Strict (Smart-hidden flags come back as open).
-- Going to Smart cannot be applied to stored data (the lines are not kept);
-- it takes effect on the next pull.
create or replace function public.gl_review_save_dup_mode(p_mode text, p_client_id text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := public.gl_review_require_admin();
  v_firm text;
  v_restored int := 0;
  v_old text;
begin
  if p_mode is not null and p_mode not in ('smart', 'strict') then
    raise exception 'Possible duplicates mode is smart or strict.' using errcode = '22023';
  end if;
  insert into public.gl_review_settings (id) values (true) on conflict (id) do nothing;

  if p_client_id is null then
    if p_mode is null then
      raise exception 'Choose Smart or Strict.' using errcode = '22023';
    end if;
    select dup_mode into v_old from public.gl_review_settings where id;
    update public.gl_review_settings set dup_mode = p_mode where id;
    perform public.audit_write('gl_review.dup_mode', null, 'setting', 'firm',
      jsonb_build_object('from', v_old, 'to', p_mode, 'scope', 'firm'));
    if p_mode = 'strict' then
      -- Every client without its own Smart override is now Strict.
      update public.gl_review_flags g
         set status = 'open', fixed_at = null, fixed_by = null
       where g.fixed_by = 'dup_smart' and g.status = 'fixed' and g.flag_type = 'dup'
         and not exists (select 1 from public.gl_review_client_settings s
                         where s.client_id = g.client_id and s.dup_mode = 'smart');
      get diagnostics v_restored = row_count;
    end if;
  else
    if not exists (select 1 from public.clients c where c.id = p_client_id) then
      raise exception 'Client not found.' using errcode = 'P0002';
    end if;
    select dup_mode into v_old from public.gl_review_client_settings where client_id = p_client_id;
    if p_mode is null then
      delete from public.gl_review_client_settings where client_id = p_client_id;
    else
      insert into public.gl_review_client_settings (client_id, dup_mode) values (p_client_id, p_mode)
      on conflict (client_id) do update set dup_mode = excluded.dup_mode;
    end if;
    perform public.audit_write('gl_review.dup_mode', p_client_id, 'setting', p_client_id,
      jsonb_build_object('from', v_old, 'to', p_mode, 'scope', 'client'));
    select dup_mode into v_firm from public.gl_review_settings where id;
    if coalesce(p_mode, v_firm) = 'strict' then
      update public.gl_review_flags g
         set status = 'open', fixed_at = null, fixed_by = null
       where g.client_id = p_client_id and g.fixed_by = 'dup_smart' and g.status = 'fixed' and g.flag_type = 'dup';
      get diagnostics v_restored = row_count;
    end if;
  end if;
  return jsonb_build_object('restored', v_restored);
end;
$$;
revoke all on function public.gl_review_save_dup_mode(text, text) from public, anon;
grant execute on function public.gl_review_save_dup_mode(text, text) to authenticated;

-- After a SMART pull: open dup flags the Smart rule set aside (Strict would
-- flag them, Smart does not) become 'fixed' with fixed_by 'dup_smart' (shown
-- as "No longer flagged (Smart mode)"). p_keys are txn_keys computed by the
-- browser. Same guards as gl_review_upsert_flags (the client's latest pull,
-- run by the caller, recent) and the pull's window: only flags whose month is
-- inside it move. Only status 'open' moves; asked / cleared flags, notes and
-- approvals are never touched, and the flag row keeps its snapshot. Run it
-- BEFORE gl_review_mark_fixed so those flags are not labeled 'system' fixed.
-- Returns {hidden, mode}: mode 'strict' means the database did not apply Smart
-- (the caller must then skip mark_fixed so the flags stay open).
create or replace function public.gl_review_hide_dup_flags(p_client_id text, p_pull_id uuid, p_keys text[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := public.gl_review_require_staff(p_client_id);
  p public.gl_review_pulls;
  v_n int := 0;
begin
  select * into p from public.gl_review_pulls where client_id = p_client_id;
  if p.client_id is null or p_pull_id is null or p.pull_id is distinct from p_pull_id then
    raise exception 'A newer pull replaced this one. Pull again.' using errcode = '22023';
  end if;
  if p.pulled_by is distinct from v_email then
    raise exception 'Only the person who ran this pull can change its flags.' using errcode = '42501';
  end if;
  if not ((p.status = 'ok' and p.started_at >= now() - interval '20 minutes')
          or (p.status = 'running' and p.started_at > now() - interval '3 minutes')) then
    raise exception 'This pull is too old. Pull again.' using errcode = '22023';
  end if;
  if p.window_start is null or p.window_end is null then
    return jsonb_build_object('hidden', 0);
  end if;
  if p_keys is null or coalesce(array_length(p_keys, 1), 0) = 0 then
    return jsonb_build_object('hidden', 0);
  end if;
  if array_length(p_keys, 1) > 5000 then
    raise exception 'At most 5,000 keys per call.' using errcode = '22023';
  end if;
  -- Smart only: refuse when the effective mode for this client is Strict.
  if coalesce((select s.dup_mode from public.gl_review_client_settings s where s.client_id = p_client_id),
              (select s.dup_mode from public.gl_review_settings s where s.id), 'smart') <> 'smart' then
    return jsonb_build_object('hidden', 0, 'mode', 'strict');
  end if;

  update public.gl_review_flags g
     set status = 'fixed', fixed_at = now(), fixed_by = 'dup_smart',
         last_pull_id = p_pull_id, last_pull_at = p.started_at
   where g.client_id = p_client_id
     and g.flag_type = 'dup'
     and g.status = 'open'
     and g.txn_key = any (p_keys)
     and g.period >= date_trunc('month', p.window_start)::date
     and g.period <= p.window_end
     and (g.last_pull_at is null or p.started_at >= g.last_pull_at)
     and g.last_pull_id is distinct from p_pull_id; -- skip flags this pull already re-saw as open
  get diagnostics v_n = row_count;
  return jsonb_build_object('hidden', v_n, 'mode', 'smart');
end;
$$;
revoke all on function public.gl_review_hide_dup_flags(text, uuid, text[]) from public, anon;
grant execute on function public.gl_review_hide_dup_flags(text, uuid, text[]) to authenticated;
