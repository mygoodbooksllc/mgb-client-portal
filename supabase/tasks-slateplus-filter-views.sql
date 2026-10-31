-- =====================================================================
-- tasks-slateplus-filter-views.sql
--
-- Slate plus (hidden preview): saved filter sets for the Slate page filter
-- bar (docs/slateplus-filters-spec.md section 4). Additive only: one new
-- table, its guard trigger, four owner-only RLS policies and one RPC.
-- Nothing existing is altered. Harmless while the preview is off: only
-- components/tasks/TK_FilterBar.jsx reads it, and only when TKP_on().
--
--   tk_slate_filter_views: a person's named filter sets (search text plus
--   the filter bar choices; NOT Group by / Sort / quick chips, which the
--   Slate app's Views menu and tk_saved_views already cover).
--   - owner_email stamped from the JWT by the trigger, never from the client
--   - name 1-60 characters, trimmed and single-spaced, unique per person
--     (any case); at most 30 per person (advisory lock)
--   - filters: a JSON object up to 4000 bytes (the app normalizes it on
--     read with TK_normalizeSlateFilters, so a bad value is harmless)
--   - is_default: at most one per person (partial unique index)
--   RLS: active staff only, and only their own rows. anon: nothing.
--   authenticated: select/insert/update/delete (no truncate/references/
--   trigger). Clients are not staff, so they see and write nothing.
--
--   tk_filter_view_set_default(p_id uuid): SECURITY INVOKER (RLS applies),
--   clears my other default and sets this one; null clears my default.
--   Raises tk_not_found when p_id is not one of my rows.
--
-- Self-test (rolls back): supabase/tasks-slateplus-filter-views-tests.sql
-- Rollback: drop function public.tk_filter_view_set_default(uuid);
--           drop table public.tk_slate_filter_views;
--           drop function public.tk_slate_filter_views_guard();
--
-- Applied to production 2026-10-27 (migration tasks_slateplus_filter_views).
-- =====================================================================

create table if not exists public.tk_slate_filter_views (
  id uuid primary key default gen_random_uuid(),
  owner_email text not null default lower(coalesce(auth.jwt() ->> 'email', '')),
  name text not null,
  filters jsonb not null default '{}'::jsonb,
  is_default boolean not null default false,
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tk_slate_filter_views_name_check check (char_length(name) between 1 and 60 and name = btrim(name)),
  constraint tk_slate_filter_views_filters_check check (jsonb_typeof(filters) = 'object' and octet_length(filters::text) <= 4000)
);
create unique index if not exists tk_slate_filter_views_owner_name_uq
  on public.tk_slate_filter_views (owner_email, lower(name));
create unique index if not exists tk_slate_filter_views_one_default_uq
  on public.tk_slate_filter_views (owner_email) where is_default;
create index if not exists tk_slate_filter_views_owner_pos_idx
  on public.tk_slate_filter_views (owner_email, position);

create or replace function public.tk_slate_filter_views_guard()
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
    new.owner_email := old.owner_email;              -- the owner and birth never move
    new.created_at := old.created_at;
    new.updated_at := now();
  end if;
  new.name := btrim(regexp_replace(coalesce(new.name, ''), '\s+', ' ', 'g'));
  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(hashtext('tk_slate_filter_views:' || new.owner_email));
    if (select count(*) from public.tk_slate_filter_views x where x.owner_email = new.owner_email) >= 30 then
      raise exception 'tk_too_many_views' using errcode = '22023';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists tk_slate_filter_views_guard on public.tk_slate_filter_views;
create trigger tk_slate_filter_views_guard
  before insert or update on public.tk_slate_filter_views
  for each row execute function public.tk_slate_filter_views_guard();

alter table public.tk_slate_filter_views enable row level security;
revoke all on table public.tk_slate_filter_views from public, anon;
grant select, insert, update, delete on table public.tk_slate_filter_views to authenticated;
revoke truncate, references, trigger on table public.tk_slate_filter_views from authenticated, anon, public;  -- TRUNCATE would skip RLS

drop policy if exists "tk filter views read own" on public.tk_slate_filter_views;
create policy "tk filter views read own" on public.tk_slate_filter_views
  for select to authenticated
  using ((select public.is_active_staff()) and owner_email = (select lower(coalesce(auth.jwt() ->> 'email', ''))));
drop policy if exists "tk filter views insert own" on public.tk_slate_filter_views;
create policy "tk filter views insert own" on public.tk_slate_filter_views
  for insert to authenticated
  with check ((select public.is_active_staff()) and owner_email = (select lower(coalesce(auth.jwt() ->> 'email', ''))));
drop policy if exists "tk filter views update own" on public.tk_slate_filter_views;
create policy "tk filter views update own" on public.tk_slate_filter_views
  for update to authenticated
  using ((select public.is_active_staff()) and owner_email = (select lower(coalesce(auth.jwt() ->> 'email', ''))))
  with check ((select public.is_active_staff()) and owner_email = (select lower(coalesce(auth.jwt() ->> 'email', ''))));
drop policy if exists "tk filter views delete own" on public.tk_slate_filter_views;
create policy "tk filter views delete own" on public.tk_slate_filter_views
  for delete to authenticated
  using ((select public.is_active_staff()) and owner_email = (select lower(coalesce(auth.jwt() ->> 'email', ''))));

-- One default per person, switched in one statement order that never
-- breaks the partial unique index. SECURITY INVOKER: RLS limits it to my rows.
create or replace function public.tk_filter_view_set_default(p_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if p_id is not null and not exists (select 1 from public.tk_slate_filter_views where id = p_id) then
    raise exception 'tk_not_found' using errcode = 'P0002';
  end if;
  update public.tk_slate_filter_views set is_default = false
   where is_default and (p_id is null or id <> p_id);
  if p_id is not null then
    update public.tk_slate_filter_views set is_default = true where id = p_id and not is_default;
  end if;
end $$;

revoke all on function public.tk_filter_view_set_default(uuid) from public, anon;
grant execute on function public.tk_filter_view_set_default(uuid) to authenticated;

notify pgrst, 'reload schema';
