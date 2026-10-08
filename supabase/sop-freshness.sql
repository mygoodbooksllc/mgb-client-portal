-- SOP freshness (owner request 2026-10-07). Staff only.
--
-- Applied to production 2026-10-07 as migration sop_freshness. Run after
-- client-health.sql (this replaces its client_sop_status()). Safe to re-run.
--
--   client_profile.sheet_reviewed_at / sheet_reviewed_by
--       When someone last pressed "Mark as still accurate" on a client's SOP,
--       and who. Only mark_sop_reviewed() sets them; a direct write keeps
--       the old values (trigger below).
--
--   mark_sop_reviewed(p_client_id)
--       Active staff who can access the client. Stamps now() and the
--       caller's email. Returns the new time.
--
--   client_sop_status()
--       Same first four columns as before, so client_health() keeps working.
--       last_touched is now the later of the last section edit and the last
--       review. Adds last_edited, last_reviewed, reviewed_by. A client with a
--       review but no sections gets a row too (filled 0).
--
-- client_health() now says "SOP not reviewed in N days" (patched in place
-- below; client-health.sql has the same text).
--
-- Clients can't see any of it: client_profile is staff-only and both
-- functions need active staff.

begin;

alter table public.client_profile
  add column if not exists sheet_reviewed_at timestamptz,
  add column if not exists sheet_reviewed_by text;

create or replace function public.client_profile_guard_sop_review()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(current_setting('mgb.sop_review', true), '') = '1' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.sheet_reviewed_at := null;
    new.sheet_reviewed_by := null;
  else
    new.sheet_reviewed_at := old.sheet_reviewed_at;
    new.sheet_reviewed_by := old.sheet_reviewed_by;
  end if;
  return new;
end;
$$;
revoke all on function public.client_profile_guard_sop_review() from public, anon, authenticated;

drop trigger if exists client_profile_guard_sop_review on public.client_profile;
create trigger client_profile_guard_sop_review
  before insert or update on public.client_profile
  for each row execute function public.client_profile_guard_sop_review();

create or replace function public.mark_sop_reviewed(p_client_id text)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text := lower(auth.jwt() ->> 'email');
  v_at timestamptz := now();
begin
  if not public.is_active_staff() or v_me is null then
    raise exception 'staff only' using errcode = '42501';
  end if;
  if p_client_id is null or not public.can_access_client(p_client_id) then
    raise exception 'not allowed for this client' using errcode = '42501';
  end if;
  perform set_config('mgb.sop_review', '1', true);
  insert into client_profile (client_id, sheet_reviewed_at, sheet_reviewed_by)
  values (p_client_id, v_at, v_me)
  on conflict (client_id) do update
    set sheet_reviewed_at = excluded.sheet_reviewed_at,
        sheet_reviewed_by = excluded.sheet_reviewed_by;
  perform set_config('mgb.sop_review', '', true);
  return v_at;
end;
$$;
revoke all on function public.mark_sop_reviewed(text) from public, anon;
grant execute on function public.mark_sop_reviewed(text) to authenticated;

-- Return type changes, so drop first. client_health() is plpgsql and looks
-- it up at run time.
drop function if exists public.client_sop_status();
create function public.client_sop_status()
returns table (client_id text, last_touched timestamptz, filled int, total int,
               last_edited timestamptz, last_reviewed timestamptz, reviewed_by text)
language sql
stable
security definer
set search_path = public
as $$
  with s as (
    select s.client_id,
           max(s.updated_at) last_edited,
           count(*) filter (where length(trim(coalesce(s.body, ''))) > 0
                              and s.section in ('access', 'bank_feeds', 'monthly_close', 'payroll',
                                                'bills_vendors', 'reporting', 'quirks'))::int filled
      from client_sops s
     group by s.client_id
  ),
  ids as (
    select s.client_id from s
    union
    select cp.client_id from client_profile cp where cp.sheet_reviewed_at is not null
  )
  select i.client_id,
         greatest(s.last_edited, cp.sheet_reviewed_at),
         coalesce(s.filled, 0),
         7,
         s.last_edited,
         cp.sheet_reviewed_at,
         cp.sheet_reviewed_by
    from ids i
    left join s on s.client_id = i.client_id
    left join client_profile cp on cp.client_id = i.client_id
   where public.is_active_staff() and public.can_access_client(i.client_id);
$$;
revoke all on function public.client_sop_status() from public, anon;
grant execute on function public.client_sop_status() to authenticated;

-- client_health(): "updated" -> "reviewed" in the stale-SOP reason.
do $$
declare
  v_def text := pg_get_functiondef('public.client_health(jsonb)'::regprocedure);
begin
  if v_def like '%SOP not updated in %' then
    execute replace(v_def, '''SOP not updated in ''', '''SOP not reviewed in ''');
  end if;
end;
$$;

commit;
