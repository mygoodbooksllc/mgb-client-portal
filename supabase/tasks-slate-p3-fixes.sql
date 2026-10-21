-- =====================================================================
-- Slate app P3 review fixes (follow-up to tasks-slate-p3-views-bulk.sql).
-- Additive only: one create or replace of the tk_saved_views guard trigger
-- function. No data is changed or deleted. Re-runnable.
--
--   1. Saved views: the 30 cap was per person per scope, and scope is any
--      short lowercase word, so one person could make unlimited rows by
--      inventing scopes. Adds a cap of 120 views per person across every
--      scope (4 scopes' worth). The advisory lock now covers the person
--      (not person + scope) so both counts are race-free.
-- Everything else in the guard is unchanged.
-- Applied to production 2026-10-21 (migration tasks_slate_p3_fixes).
-- =====================================================================

create or replace function public.tk_saved_views_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_api boolean := current_user in ('anon', 'authenticated');
begin
  if tg_op = 'INSERT' then
    if v_me <> '' then
      new.owner_email := v_me;                       -- never trust a client-supplied owner
    elsif v_api then
      raise exception 'tk_forbidden' using errcode = '42501';
    else
      new.owner_email := lower(coalesce(nullif(btrim(new.owner_email), ''), ''));
    end if;
    if new.owner_email = '' then
      raise exception 'tk_forbidden' using errcode = '42501';
    end if;
  else
    new.owner_email := old.owner_email;              -- the owner, scope and birth never move
    new.scope := old.scope;
    new.created_at := old.created_at;
    new.updated_at := now();
  end if;
  new.name := btrim(regexp_replace(coalesce(new.name, ''), '\s+', ' ', 'g'));
  if lower(new.name) = 'default' then
    raise exception 'tk_name_reserved' using errcode = '22023';
  end if;
  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(hashtext('tk_saved_views:' || new.owner_email));   -- p3 fixes: per person
    if (select count(*) from public.tk_saved_views x where x.owner_email = new.owner_email and x.scope = new.scope) >= 30 then
      raise exception 'tk_too_many_views' using errcode = '22023';
    end if;
    if (select count(*) from public.tk_saved_views x where x.owner_email = new.owner_email) >= 120 then   -- p3 fixes
      raise exception 'tk_too_many_views' using errcode = '22023';
    end if;
  end if;
  return new;
end $$;

revoke all on function public.tk_saved_views_guard() from public, anon, authenticated;
