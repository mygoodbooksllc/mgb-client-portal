-- Slate plus: profile 2, unified search, Team load 4 weeks (hidden preview).
-- Spec: docs/slateplus-profile2-spec.md (sections 2.5, 4.1, 4.2, 12.1-12.4).
-- Self-test: supabase/slateplus-profile2-tests.sql (one transaction, rolled back).
--
-- Additive only. Nothing the old experience reads is changed or re-created:
--   1. NEW table tk_staff_profile_prefs: one row per staff member, written only
--      by that person (RLS: owner = JWT email, active staff). No admin policy:
--      nobody reads or writes another person's row directly. Others see the
--      fields the owner shares only through tk_profile_card.
--   2. NEW tables tk_staff_teams + tk_staff_team_members: any active staff
--      reads; only admins (is_active_staff_admin) write.
--   3. NEW RPC tk_profile_card(email): the profile card for one active staff
--      member. Self = the whole own row; others = only shared fields, pins and
--      SOP favorites filtered by the VIEWER's access. Plus org (manager and
--      direct reports from staff_hr_records: only staff_email, manager_email,
--      end_date are read; no other HR column leaves) and teams.
--   4. NEW RPC tk_search_prefix(q, limit): word-prefix task search for the
--      unified search box; every returned row passes tk_row_readable.
--   5. NEW RPC tk_slateplus_workload_weeks(): due counts per visible person for
--      this week + 3 more (people = tk_slateplus_workload(), same visibility),
--      plus an Unassigned row counted only over tasks the caller can read.
-- All three RPCs: security definer, stable, search_path = public, staff check
-- first, read-only, execute revoked from public/anon, granted to authenticated.
-- Only gate-on code (TKP_on(), components/tasks/TK_slatePlus.js) calls them;
-- they are inert while the preview is off. No tk_settings row is written.
--
-- Safe to re-run.

-- =====================================================================
-- 1. tk_staff_profile_prefs
-- =====================================================================
create table if not exists public.tk_staff_profile_prefs (
  owner_email        text primary key,
  status_line        text check (status_line is null or char_length(status_line) between 1 and 140),
  status_set_at      timestamptz,
  focus_quarter      text check (focus_quarter is null or focus_quarter ~ '^[0-9]{4}-Q[1-4]$'),
  focus_goals        jsonb not null default '[]'::jsonb,
  bio                text check (bio is null or char_length(bio) <= 600),
  skills             text[] not null default '{}',
  working_hours      text check (working_hours is null or char_length(working_hours) <= 120),
  pinned_client_ids  text[] not null default '{}',
  pinned_project_ids uuid[] not null default '{}',
  favorites          jsonb not null default '[]'::jsonb,
  section_order      text[] not null default '{}',
  hidden_sections    text[] not null default '{}',
  time_zone          text,
  share              jsonb not null default
                     '{"status":true,"about":true,"focus":false,"pins":false,"favorites":false,"time":true}'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
alter table public.tk_staff_profile_prefs enable row level security;

drop policy if exists tkpp_select on public.tk_staff_profile_prefs;
drop policy if exists tkpp_insert on public.tk_staff_profile_prefs;
drop policy if exists tkpp_update on public.tk_staff_profile_prefs;
drop policy if exists tkpp_delete on public.tk_staff_profile_prefs;
create policy tkpp_select on public.tk_staff_profile_prefs for select to authenticated
  using (public.is_active_staff() and owner_email = lower(coalesce(auth.jwt() ->> 'email', '')));
create policy tkpp_insert on public.tk_staff_profile_prefs for insert to authenticated
  with check (public.is_active_staff() and owner_email = lower(coalesce(auth.jwt() ->> 'email', '')));
create policy tkpp_update on public.tk_staff_profile_prefs for update to authenticated
  using (public.is_active_staff() and owner_email = lower(coalesce(auth.jwt() ->> 'email', '')))
  with check (public.is_active_staff() and owner_email = lower(coalesce(auth.jwt() ->> 'email', '')));
create policy tkpp_delete on public.tk_staff_profile_prefs for delete to authenticated
  using (public.is_active_staff() and owner_email = lower(coalesce(auth.jwt() ->> 'email', '')));

revoke all on public.tk_staff_profile_prefs from public, anon, authenticated;
grant select, insert, update, delete on public.tk_staff_profile_prefs to authenticated;

-- Section keys (spec 4.3). Keep in sync with TKP2_SECTIONS in
-- components/tasks/TK_profilePrefsLogic.js.
create or replace function public.tk__profile_section_keys()
returns text[] language sql immutable set search_path = public
as $$ select array['header','pins','glance','load','org','focus','tasks','ooo','about',
                   'favorites','covers','collab','recent','shoutouts','defaultview']::text[] $$;
create or replace function public.tk__profile_fixed_sections()
returns text[] language sql immutable set search_path = public
as $$ select array['header','glance','load','tasks','defaultview']::text[] $$;

-- Time zone rule (spec 12.3): a real IANA region name from pg_timezone_names
-- ("America/Chicago"), or UTC. No abbreviations (CST, EST), no offsets
-- (+05:00, Etc/GMT+5), no posix/ or right/ copies.
-- Keep in sync with TKP2_zoneOk in TK_profilePrefsLogic.js (shape only).
create or replace function public.tk__tz_ok(p_tz text)
returns boolean language sql stable set search_path = public
as $$
  select p_tz is not null
     and (p_tz = 'UTC'
          or (p_tz ~ '^[A-Za-z]+(/[A-Za-z0-9_+-]+)+$'
              and p_tz !~ '^(Etc|posix|right|SystemV)/'
              and exists (select 1 from pg_catalog.pg_timezone_names z where z.name = p_tz)));
$$;

create or replace function public.tk_staff_profile_prefs_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_me text := lower(btrim(coalesce(auth.jwt() ->> 'email', '')));
  v_keys text[] := public.tk__profile_section_keys();
  v_fixed text[] := public.tk__profile_fixed_sections();
  v_el jsonb;
  v_out jsonb;
  v_txt text;
  v_lbl text;
  v_arr text[];
  v_k text;
  v_def jsonb := '{"status":true,"about":true,"focus":false,"pins":false,"favorites":false,"time":true}'::jsonb;
  v_share jsonb;
begin
  -- owner: always the JWT on insert, frozen on update
  if tg_op = 'INSERT' then
    if v_me = '' then
      raise exception 'tk_profile_owner: sign in to save your profile' using errcode = '22023';
    end if;
    new.owner_email := v_me;
    new.created_at := now();
  else
    new.owner_email := old.owner_email;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();

  -- plain text: trimmed, empty -> null, length rules
  new.status_line := nullif(btrim(new.status_line), '');
  if new.status_line is not null and char_length(new.status_line) > 140 then
    raise exception 'tk_profile_status: a status is at most 140 characters' using errcode = '22023';
  end if;
  if tg_op = 'INSERT' then
    new.status_set_at := case when new.status_line is null then null else now() end;
  elsif new.status_line is distinct from old.status_line then
    new.status_set_at := case when new.status_line is null then null else now() end;
  else
    new.status_set_at := old.status_set_at;
  end if;

  new.focus_quarter := nullif(btrim(new.focus_quarter), '');
  if new.focus_quarter is not null and new.focus_quarter !~ '^[0-9]{4}-Q[1-4]$' then
    raise exception 'tk_profile_quarter: the quarter looks like 2026-Q4' using errcode = '22023';
  end if;

  new.bio := nullif(btrim(new.bio), '');
  if new.bio is not null and char_length(new.bio) > 600 then
    raise exception 'tk_profile_bio: About me is at most 600 characters' using errcode = '22023';
  end if;
  new.working_hours := nullif(btrim(new.working_hours), '');
  if new.working_hours is not null and char_length(new.working_hours) > 120 then
    raise exception 'tk_profile_hours: working hours are at most 120 characters' using errcode = '22023';
  end if;

  -- focus goals: [{text 1-120, done bool}], at most 3, extra keys dropped
  new.focus_goals := coalesce(new.focus_goals, '[]'::jsonb);
  if jsonb_typeof(new.focus_goals) <> 'array' then
    raise exception 'tk_profile_goals: goals must be a list' using errcode = '22023';
  end if;
  if jsonb_array_length(new.focus_goals) > 3 then
    raise exception 'tk_profile_goals: at most 3 focus goals' using errcode = '22023';
  end if;
  v_out := '[]'::jsonb;
  for v_el in select e from jsonb_array_elements(new.focus_goals) e loop
    if jsonb_typeof(v_el) <> 'object' or jsonb_typeof(v_el -> 'text') is distinct from 'string' then
      raise exception 'tk_profile_goals: each goal needs text' using errcode = '22023';
    end if;
    v_txt := btrim(v_el ->> 'text');
    if char_length(v_txt) < 1 or char_length(v_txt) > 120 then
      raise exception 'tk_profile_goals: a goal is 1 to 120 characters' using errcode = '22023';
    end if;
    if v_el ? 'done' and jsonb_typeof(v_el -> 'done') <> 'boolean' then
      raise exception 'tk_profile_goals: done is true or false' using errcode = '22023';
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object('text', v_txt, 'done', coalesce((v_el ->> 'done')::boolean, false)));
  end loop;
  new.focus_goals := v_out;

  -- skills: trimmed, blanks dropped, 1-40 each, de-duplicated (any case), at most 12
  v_arr := '{}';
  foreach v_txt in array coalesce(new.skills, '{}'::text[]) loop
    v_txt := btrim(v_txt);
    continue when v_txt is null or v_txt = '';
    if char_length(v_txt) > 40 then
      raise exception 'tk_profile_skills: a skill is at most 40 characters' using errcode = '22023';
    end if;
    if not exists (select 1 from unnest(v_arr) s where lower(s) = lower(v_txt)) then
      v_arr := v_arr || v_txt;
    end if;
  end loop;
  if coalesce(array_length(v_arr, 1), 0) > 12 then
    raise exception 'tk_profile_skills: at most 12 skills' using errcode = '22023';
  end if;
  new.skills := v_arr;

  -- pins: de-duplicated in order, at most 12 each (not checked against access:
  -- every read filters by the viewer's access)
  v_arr := '{}';
  foreach v_txt in array coalesce(new.pinned_client_ids, '{}'::text[]) loop
    v_txt := btrim(v_txt);
    continue when v_txt is null or v_txt = '' or v_txt = any (v_arr);
    if char_length(v_txt) > 120 then
      raise exception 'tk_profile_pins: bad client id' using errcode = '22023';
    end if;
    v_arr := v_arr || v_txt;
  end loop;
  if coalesce(array_length(v_arr, 1), 0) > 12 then
    raise exception 'tk_profile_pins: at most 12 pinned clients' using errcode = '22023';
  end if;
  new.pinned_client_ids := v_arr;
  new.pinned_project_ids := coalesce(array(
    select p from (select distinct on (p) p, o from unnest(coalesce(new.pinned_project_ids, '{}'::uuid[])) with ordinality u(p, o)
                    where p is not null order by p, o) d order by o), '{}'::uuid[]);
  if coalesce(array_length(new.pinned_project_ids, 1), 0) > 12 then
    raise exception 'tk_profile_pins: at most 12 pinned projects' using errcode = '22023';
  end if;

  -- favorites: at most 20; {kind:'sop', sop_id, client_id, label} or
  -- {kind:'link', url (https only), label}; extra keys dropped
  new.favorites := coalesce(new.favorites, '[]'::jsonb);
  if jsonb_typeof(new.favorites) <> 'array' then
    raise exception 'tk_profile_favorites: favorites must be a list' using errcode = '22023';
  end if;
  if jsonb_array_length(new.favorites) > 20 then
    raise exception 'tk_profile_favorites: at most 20 favorites' using errcode = '22023';
  end if;
  v_out := '[]'::jsonb;
  for v_el in select e from jsonb_array_elements(new.favorites) e loop
    if jsonb_typeof(v_el) <> 'object' then
      raise exception 'tk_profile_favorites: bad favorite' using errcode = '22023';
    end if;
    v_lbl := btrim(coalesce(v_el ->> 'label', ''));
    if char_length(v_lbl) < 1 or char_length(v_lbl) > 80 then
      raise exception 'tk_profile_favorites: a label is 1 to 80 characters' using errcode = '22023';
    end if;
    if v_el ->> 'kind' = 'sop' then
      if coalesce(v_el ->> 'sop_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         or btrim(coalesce(v_el ->> 'client_id', '')) = '' then
        raise exception 'tk_profile_favorites: an SOP favorite needs the SOP and its client' using errcode = '22023';
      end if;
      v_out := v_out || jsonb_build_array(jsonb_build_object('kind', 'sop', 'sop_id', lower(v_el ->> 'sop_id'),
                                                              'client_id', btrim(v_el ->> 'client_id'), 'label', v_lbl));
    elsif v_el ->> 'kind' = 'link' then
      v_txt := btrim(coalesce(v_el ->> 'url', ''));
      -- Same rule as ^https://[^\s<>"']{3,500}$ (Postgres caps a {m,n} count at 255).
      if v_txt !~ '^https://[^\s<>"'']+$' or char_length(v_txt) not between 11 and 508 then
        raise exception 'tk_profile_favorites: links must start with https://' using errcode = '22023';
      end if;
      v_out := v_out || jsonb_build_array(jsonb_build_object('kind', 'link', 'url', v_txt, 'label', v_lbl));
    else
      raise exception 'tk_profile_favorites: a favorite is an SOP or a link' using errcode = '22023';
    end if;
  end loop;
  new.favorites := v_out;

  -- layout: known keys only, de-duplicated, at most 16; fixed sections never hidden
  v_arr := '{}';
  foreach v_k in array coalesce(new.section_order, '{}'::text[]) loop
    if not (v_k = any (v_keys)) then
      raise exception 'tk_profile_sections: unknown section %', v_k using errcode = '22023';
    end if;
    if not (v_k = any (v_arr)) then v_arr := v_arr || v_k; end if;
  end loop;
  if coalesce(array_length(v_arr, 1), 0) > 16 then
    raise exception 'tk_profile_sections: too many sections' using errcode = '22023';
  end if;
  new.section_order := v_arr;
  v_arr := '{}';
  foreach v_k in array coalesce(new.hidden_sections, '{}'::text[]) loop
    if not (v_k = any (v_keys)) then
      raise exception 'tk_profile_sections: unknown section %', v_k using errcode = '22023';
    end if;
    if v_k = any (v_fixed) then
      raise exception 'tk_profile_sections: % cannot be hidden', v_k using errcode = '22023';
    end if;
    if not (v_k = any (v_arr)) then v_arr := v_arr || v_k; end if;
  end loop;
  if coalesce(array_length(v_arr, 1), 0) > 16 then
    raise exception 'tk_profile_sections: too many sections' using errcode = '22023';
  end if;
  new.hidden_sections := v_arr;

  -- time zone: null or a real zone name
  new.time_zone := nullif(btrim(new.time_zone), '');
  if new.time_zone is not null and not public.tk__tz_ok(new.time_zone) then
    raise exception 'tk_profile_time_zone: pick a time zone from the list' using errcode = '22023';
  end if;

  -- share: exactly the six boolean keys (missing -> default, unknown dropped)
  v_share := coalesce(new.share, '{}'::jsonb);
  if jsonb_typeof(v_share) <> 'object' then
    raise exception 'tk_profile_share: bad sharing choices' using errcode = '22023';
  end if;
  v_out := '{}'::jsonb;
  foreach v_k in array array['status','about','focus','pins','favorites','time'] loop
    if v_share ? v_k then
      if jsonb_typeof(v_share -> v_k) <> 'boolean' then
        raise exception 'tk_profile_share: % is true or false', v_k using errcode = '22023';
      end if;
      v_out := v_out || jsonb_build_object(v_k, v_share -> v_k);
    else
      v_out := v_out || jsonb_build_object(v_k, v_def -> v_k);
    end if;
  end loop;
  new.share := v_out;

  return new;
end $$;

drop trigger if exists tk_staff_profile_prefs_guard on public.tk_staff_profile_prefs;
create trigger tk_staff_profile_prefs_guard
  before insert or update on public.tk_staff_profile_prefs
  for each row execute function public.tk_staff_profile_prefs_guard();

-- =====================================================================
-- 2. Teams (admins write, staff read)
-- =====================================================================
create table if not exists public.tk_staff_teams (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 1 and 60),
  description text check (description is null or char_length(description) <= 200),
  color       text check (color is null or color in ('gold','sage','sky','plum','rose','slate')),
  sort        int not null default 0,
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  archived_at timestamptz
);
create unique index if not exists tk_staff_teams_name_uq on public.tk_staff_teams (lower(btrim(name)));

create table if not exists public.tk_staff_team_members (
  team_id     uuid not null references public.tk_staff_teams(id) on delete cascade,
  staff_email text not null,
  added_by    text,
  added_at    timestamptz not null default now(),
  primary key (team_id, staff_email)
);
create index if not exists tk_staff_team_members_email_idx on public.tk_staff_team_members (staff_email);
alter table public.tk_staff_teams enable row level security;
alter table public.tk_staff_team_members enable row level security;

drop policy if exists tkst_read on public.tk_staff_teams;
drop policy if exists tkst_ins on public.tk_staff_teams;
drop policy if exists tkst_upd on public.tk_staff_teams;
drop policy if exists tkst_del on public.tk_staff_teams;
drop policy if exists tkstm_read on public.tk_staff_team_members;
drop policy if exists tkstm_ins on public.tk_staff_team_members;
drop policy if exists tkstm_del on public.tk_staff_team_members;
create policy tkst_read  on public.tk_staff_teams for select to authenticated using (public.is_active_staff());
create policy tkst_ins   on public.tk_staff_teams for insert to authenticated with check (public.is_active_staff_admin());
create policy tkst_upd   on public.tk_staff_teams for update to authenticated using (public.is_active_staff_admin()) with check (public.is_active_staff_admin());
create policy tkst_del   on public.tk_staff_teams for delete to authenticated using (public.is_active_staff_admin());
create policy tkstm_read on public.tk_staff_team_members for select to authenticated using (public.is_active_staff());
create policy tkstm_ins  on public.tk_staff_team_members for insert to authenticated with check (public.is_active_staff_admin());
create policy tkstm_del  on public.tk_staff_team_members for delete to authenticated using (public.is_active_staff_admin());
-- no update policy on members (remove + add)

revoke all on public.tk_staff_teams, public.tk_staff_team_members from public, anon, authenticated;
grant select, insert, update, delete on public.tk_staff_teams to authenticated;
grant select, insert, delete on public.tk_staff_team_members to authenticated;

create or replace function public.tk_staff_teams_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_me text := lower(btrim(coalesce(auth.jwt() ->> 'email', '')));
begin
  -- clear error for API callers (RLS refuses them anyway)
  if current_user in ('anon', 'authenticated') and not public.is_active_staff_admin() then
    raise exception 'tk_forbidden' using errcode = '42501';
  end if;
  new.name := btrim(regexp_replace(coalesce(new.name, ''), '\s+', ' ', 'g'));
  new.description := nullif(btrim(new.description), '');
  new.color := nullif(btrim(lower(new.color)), '');
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_by := nullif(v_me, '');
    new.created_at := now();
    if (select count(*) from public.tk_staff_teams t where t.archived_at is null) >= 30 then
      raise exception 'tk_too_many: at most 30 teams' using errcode = '22023';
    end if;
  else
    new.id := old.id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  return new;
end $$;

drop trigger if exists tk_staff_teams_guard on public.tk_staff_teams;
create trigger tk_staff_teams_guard
  before insert or update on public.tk_staff_teams
  for each row execute function public.tk_staff_teams_guard();

create or replace function public.tk_staff_team_members_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_me text := lower(btrim(coalesce(auth.jwt() ->> 'email', '')));
begin
  if current_user in ('anon', 'authenticated') and not public.is_active_staff_admin() then
    raise exception 'tk_forbidden' using errcode = '42501';
  end if;
  new.staff_email := lower(btrim(coalesce(new.staff_email, '')));
  if not exists (select 1 from public.staff s where lower(s.email) = new.staff_email and s.active) then
    raise exception 'tk_member_inactive: only active staff can be on a team' using errcode = '22023';
  end if;
  if (select count(*) from public.tk_staff_team_members m where m.team_id = new.team_id) >= 40 then
    raise exception 'tk_too_many: at most 40 people on a team' using errcode = '22023';
  end if;
  new.added_by := nullif(v_me, '');
  new.added_at := now();
  return new;
end $$;

drop trigger if exists tk_staff_team_members_guard on public.tk_staff_team_members;
create trigger tk_staff_team_members_guard
  before insert on public.tk_staff_team_members
  for each row execute function public.tk_staff_team_members_guard();

-- =====================================================================
-- 3. tk_profile_card(email)
-- =====================================================================
create or replace function public.tk_profile_card(p_email text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me text := lower(btrim(coalesce(auth.jwt() ->> 'email', '')));
  v_t text := lower(btrim(coalesce(p_email, '')));
  v_today date := (now() at time zone 'America/Chicago')::date;
  v_row public.tk_staff_profile_prefs%rowtype;
  v_found boolean;
  v_share jsonb;
  v_org jsonb;
  v_teams jsonb;
  v_mgr jsonb;
  v_reports jsonb;
begin
  if v_me = '' or not public.is_active_staff() then
    return null;
  end if;
  if v_t = '' or char_length(v_t) > 320
     or not exists (select 1 from public.staff s where lower(s.email) = v_t and s.active) then
    return null;
  end if;

  select * into v_row from public.tk_staff_profile_prefs p where p.owner_email = v_t;
  v_found := found;
  if not v_found then
    v_row.owner_email := v_t;
    v_row.focus_goals := '[]'::jsonb;
    v_row.skills := '{}';
    v_row.pinned_client_ids := '{}';
    v_row.pinned_project_ids := '{}';
    v_row.favorites := '[]'::jsonb;
    v_row.section_order := '{}';
    v_row.hidden_sections := '{}';
    v_row.share := '{"status":true,"about":true,"focus":false,"pins":false,"favorites":false,"time":true}'::jsonb;
  end if;
  v_share := coalesce(v_row.share, '{}'::jsonb);

  -- org: one level up and down. Only staff_email, manager_email, end_date are
  -- read from staff_hr_records; active staff on both ends; employment not ended.
  select jsonb_build_object('email', lower(m.email),
                            'name', coalesce(nullif(btrim(m.name), ''), split_part(lower(m.email), '@', 1)))
    into v_mgr
    from public.staff_hr_records h
    join public.staff m on lower(m.email) = lower(btrim(h.manager_email)) and m.active
   where lower(h.staff_email) = v_t
     and (h.end_date is null or h.end_date >= v_today)
     and lower(btrim(h.manager_email)) <> v_t
     and not exists (select 1 from public.staff_hr_records mh
                      where lower(mh.staff_email) = lower(m.email) and mh.end_date < v_today)
   limit 1;
  select coalesce(jsonb_agg(jsonb_build_object('email', x.em, 'name', x.nm) order by lower(x.nm), x.em), '[]'::jsonb)
    into v_reports
    from (select lower(s.email) as em,
                 coalesce(nullif(btrim(s.name), ''), split_part(lower(s.email), '@', 1)) as nm
            from public.staff_hr_records h
            join public.staff s on lower(s.email) = lower(h.staff_email) and s.active
           where lower(btrim(h.manager_email)) = v_t
             and lower(h.staff_email) <> v_t
             and (h.end_date is null or h.end_date >= v_today)
           order by lower(coalesce(nullif(btrim(s.name), ''), s.email)), lower(s.email)
           limit 50) x;
  v_org := jsonb_build_object('manager', v_mgr, 'reports', v_reports);

  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'color', t.color)
                            order by t.sort, lower(t.name)), '[]'::jsonb)
    into v_teams
    from public.tk_staff_teams t
    join public.tk_staff_team_members m on m.team_id = t.id
   where m.staff_email = v_t and t.archived_at is null;

  if v_t = v_me then
    return jsonb_build_object(
      'email', v_t, 'is_self', true, 'has_row', v_found,
      'status_line', v_row.status_line, 'status_set_at', v_row.status_set_at,
      'focus_quarter', v_row.focus_quarter, 'focus_goals', v_row.focus_goals,
      'bio', v_row.bio, 'skills', to_jsonb(v_row.skills), 'working_hours', v_row.working_hours,
      'pinned_client_ids', to_jsonb(v_row.pinned_client_ids),
      'pinned_project_ids', to_jsonb(v_row.pinned_project_ids),
      'favorites', v_row.favorites,
      'section_order', to_jsonb(v_row.section_order), 'hidden_sections', to_jsonb(v_row.hidden_sections),
      'time_zone', v_row.time_zone, 'share', v_share,
      'updated_at', v_row.updated_at,
      'org', v_org, 'teams', v_teams);
  end if;

  return jsonb_build_object(
    'email', v_t, 'is_self', false,
    'section_order', to_jsonb(v_row.section_order), 'hidden_sections', to_jsonb(v_row.hidden_sections),
    'status_line',   case when (v_share ->> 'status')::boolean then v_row.status_line end,
    'status_set_at', case when (v_share ->> 'status')::boolean and v_row.status_line is not null then v_row.status_set_at end,
    'bio',           case when (v_share ->> 'about')::boolean then v_row.bio end,
    'skills',        case when (v_share ->> 'about')::boolean then to_jsonb(v_row.skills) end,
    'working_hours', case when (v_share ->> 'about')::boolean then v_row.working_hours end,
    'focus_quarter', case when (v_share ->> 'focus')::boolean then v_row.focus_quarter end,
    'focus_goals',   case when (v_share ->> 'focus')::boolean then v_row.focus_goals end,
    'pinned_client_ids', case when (v_share ->> 'pins')::boolean then
        to_jsonb(coalesce(array(select c.x from unnest(v_row.pinned_client_ids) with ordinality c(x, o)
                                 where exists (select 1 from public.clients cl where cl.id = c.x)
                                   and public.can_access_client(c.x)
                                 order by c.o), '{}'::text[])) end,
    'pinned_project_ids', case when (v_share ->> 'pins')::boolean then
        to_jsonb(coalesce(array(select p.x from unnest(v_row.pinned_project_ids) with ordinality p(x, o)
                                 where exists (select 1 from public.tk_projects tp where tp.id = p.x and tp.trashed_at is null)
                                   and public.tk_can_see_project(p.x)
                                 order by p.o), '{}'::uuid[])) end,
    'favorites', case when (v_share ->> 'favorites')::boolean then
        coalesce((select jsonb_agg(f.e order by f.o)
                    from jsonb_array_elements(v_row.favorites) with ordinality f(e, o)
                   where f.e ->> 'kind' = 'link'
                      or (f.e ->> 'kind' = 'sop'
                          and public.can_access_client(f.e ->> 'client_id')
                          and exists (select 1 from public.client_sops so
                                       where so.id::text = f.e ->> 'sop_id' and so.client_id = f.e ->> 'client_id'))),
                 '[]'::jsonb) end,
    'time_zone', case when (v_share ->> 'time')::boolean then v_row.time_zone end,
    'org', v_org, 'teams', v_teams);
end $$;

revoke all on function public.tk_profile_card(text) from public, anon;
grant execute on function public.tk_profile_card(text) to authenticated;

-- =====================================================================
-- 4. tk_search_prefix(q, limit): word-prefix task search
-- =====================================================================
-- Match first (cheap), then tk_row_readable on the matched rows only. This is
-- a DEFINER that bypasses RLS: EVERY branch that returns a row calls
-- tk_row_readable. Returns no client names, emails, hours or last seen.
create or replace function public.tk_search_prefix(q text, p_limit int default 12)
returns table(task_id uuid, task_text text, kind text, client_id text,
              project_id uuid, status text, due_date date, done boolean,
              match text, snippet text, rank int)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_terms text[];
  v_lim int := least(greatest(coalesce(p_limit, 12), 1), 25);
begin
  if not public.is_active_staff() then return; end if;
  if q is null or char_length(q) > 200 then return; end if;
  select array_agg(s.t) into v_terms from (
    select distinct left(w.t, 40) as t
      from regexp_split_to_table(btrim(regexp_replace(lower(q), '[^a-z0-9]+', ' ', 'g')), ' ') as w(t)
     where w.t <> '' limit 6) s;
  if v_terms is null or (select max(char_length(x)) from unnest(v_terms) x) < 2 then return; end if;
  -- escape LIKE specials (none can survive the normalize above; kept on purpose)
  v_terms := array(select replace(replace(replace(x, '\', '\\'), '%', '\%'), '_', '\_') from unnest(v_terms) x);

  return query
  with cand as (
    select r.id, r."text" as ttl, r.kind as knd, r.client_id as cid, r.project_id as pid, r.status as st,
           r.due_date as dd, r.done as dn, r.staff_email as own, r.assignee_email as asg,
           r.visibility as vis, r.description as dsc,
           ' ' || regexp_replace(lower(coalesce(r."text", '')), '[^a-z0-9]+', ' ', 'g') as n_title,
           ' ' || regexp_replace(lower(coalesce(r.description, '')), '[^a-z0-9]+', ' ', 'g') as n_desc,
           ' ' || regexp_replace(lower(coalesce(c.name, '')), '[^a-z0-9]+', ' ', 'g') as n_client
      from public.staff_reminders r
      left join public.clients c on c.id = r.client_id
     where r.deleted_at is null
  ),
  task_hits as (
    select x.*,
           case when (select bool_and(x.n_title like '% ' || tt || '%' escape '\') from unnest(v_terms) tt) then 'title'
                when (select bool_and(x.n_title || x.n_desc like '% ' || tt || '%' escape '\') from unnest(v_terms) tt) then 'notes'
                else 'client' end as h_match
      from cand x
     where (select bool_and(
                 x.n_title like '% ' || tt || '%' escape '\'
              or x.n_desc  like '% ' || tt || '%' escape '\'
              or (x.cid is not null and x.n_client like '% ' || tt || '%' escape '\'))
              from unnest(v_terms) tt)
  ),
  readable as (
    select h.* from task_hits h
     where public.tk_row_readable(h.id, h.own, h.asg, h.cid, h.pid, h.vis)
       -- a client-name hit counts only where the viewer can access the client
       and (h.h_match <> 'client' or public.can_access_client(h.cid))
  ),
  comment_hits as (
    select r.id, r."text" as ttl, r.kind as knd, r.client_id as cid, r.project_id as pid, r.status as st,
           r.due_date as dd, r.done as dn, left(cm.body, 140) as snip
      from public.tk_comments cm
      join public.staff_reminders r on r.id = cm.task_id
     where cm.deleted_at is null and r.deleted_at is null
       and (select bool_and(' ' || regexp_replace(lower(coalesce(cm.body, '')), '[^a-z0-9]+', ' ', 'g')
                            like '% ' || tt || '%' escape '\') from unnest(v_terms) tt)
       and public.tk_row_readable(r.id, r.staff_email, r.assignee_email, r.client_id, r.project_id, r.visibility)
  ),
  allhits as (
    select rd.id, rd.ttl, rd.knd, rd.cid, rd.pid, rd.st, rd.dd, rd.dn, rd.h_match as hm,
           case when rd.h_match = 'notes' then left(coalesce(rd.dsc, ''), 140) else null end as snip,
           case rd.h_match when 'title' then 1 when 'client' then 2 else 3 end as rk
      from readable rd
    union all
    select ch.id, ch.ttl, ch.knd, ch.cid, ch.pid, ch.st, ch.dd, ch.dn, 'comment', ch.snip, 4
      from comment_hits ch
  ),
  best as (select distinct on (a.id) a.* from allhits a order by a.id, a.rk)
  select b.id, b.ttl, coalesce(b.knd, 'task'), b.cid, b.pid, b.st, b.dd, b.dn, b.hm, b.snip, b.rk
    from best b
   order by b.rk, b.dn, b.dd nulls last, b.ttl
   limit v_lim;
end $$;

revoke all on function public.tk_search_prefix(text, int) from public, anon;
grant execute on function public.tk_search_prefix(text, int) to authenticated;

-- =====================================================================
-- 5. tk_slateplus_workload_weeks(): this week + 3, due counts only
-- =====================================================================
-- People = tk_slateplus_workload() (admins and account managers: everyone;
-- others: only themselves), so the visibility rule lives in one place.
-- Counting rules copied from tk_slateplus_workload (KEEP IN SYNC): open, not
-- waiting on the client, not trashed, not Unassigned, real clients only (no
-- test or internal), others' private tasks never counted.
-- Rows: 4 dated rows (week_start = Monday, America/Chicago) per person plus one
-- row with week_start NULL carrying the all-dates open count; the same for an
-- Unassigned row (is_unassigned), counted only over tasks tk_row_readable
-- gives the caller.
create or replace function public.tk_slateplus_workload_weeks()
returns table (staff_id uuid, email text, name text, is_me boolean,
               is_unassigned boolean, week_start date, due_count integer)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_ws date := date_trunc('week', (now() at time zone 'America/Chicago')::date)::date;
begin
  if v_me = '' or not public.is_active_staff() then
    raise exception 'tk_forbidden' using errcode = '42501';
  end if;
  return query
  with people as (
    select w.staff_id as sid, lower(w.email) as em, w.name as nm, w.open_count as oc
      from public.tk_slateplus_workload() w
  ),
  weeks as (select (v_ws + 7 * g)::date as ws from generate_series(0, 3) g),
  t as (
    select lower(r.assignee_email) as em, r.due_date as dd
      from public.staff_reminders r
      left join public.clients c on c.id = r.client_id
     where r.done = false and r.deleted_at is null
       and coalesce(r.is_unassigned, false) = false and r.assignee_email is not null
       and coalesce(r.status, 'todo') not in ('done', 'waiting_client')
       and (r.client_id is null
            or (c.id is not null and coalesce(c.is_internal, false) = false and coalesce(c.test_only, false) = false))
       and (coalesce(r.visibility, '') <> 'private' or lower(r.assignee_email) = v_me)
       and r.due_date between v_ws and v_ws + 27
       and lower(r.assignee_email) in (select p.em from people p)
  ),
  u as (
    select r.due_date as dd
      from public.staff_reminders r
      left join public.clients c on c.id = r.client_id
     where r.done = false and r.deleted_at is null
       and (coalesce(r.is_unassigned, false) or r.assignee_email is null)
       and coalesce(r.status, 'todo') not in ('done', 'waiting_client')
       and (r.client_id is null
            or (c.id is not null and coalesce(c.is_internal, false) = false and coalesce(c.test_only, false) = false))
       and public.tk_row_readable(r.id, r.staff_email, r.assignee_email, r.client_id, r.project_id, r.visibility)
  )
  select x.sid, x.em, x.nm, x.me, x.un, x.ws, x.n from (
    select p.sid, p.em, coalesce(p.nm, split_part(p.em, '@', 1)) as nm, p.em = v_me as me, false as un, w.ws,
           (select count(*) from t where t.em = p.em and t.dd between w.ws and w.ws + 6)::int as n
      from people p cross join weeks w
    union all
    select p.sid, p.em, coalesce(p.nm, split_part(p.em, '@', 1)), p.em = v_me, false, null::date, coalesce(p.oc, 0)::int
      from people p
    union all
    select null::uuid, null::text, 'Unassigned', false, true, w.ws,
           (select count(*) from u where u.dd between w.ws and w.ws + 6)::int
      from weeks w
    union all
    select null::uuid, null::text, 'Unassigned', false, true, null::date, (select count(*) from u)::int
  ) x
  order by x.un, x.em, x.ws nulls last;
end $$;

revoke all on function public.tk_slateplus_workload_weeks() from public, anon;
grant execute on function public.tk_slateplus_workload_weeks() to authenticated;

notify pgrst, 'reload schema';
