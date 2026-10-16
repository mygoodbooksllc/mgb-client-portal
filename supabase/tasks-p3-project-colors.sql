-- =====================================================================
-- Tasks Phase 3, Project colors (2026-10-16). Builds on
-- tasks-p3-manage-projects.sql. Safe to re-run. No transaction control
-- (apply_migration wraps it). Nothing is deleted.
--
-- What it does
--   * tk_projects.color: one of ten palette keys (blue, teal, green, amber,
--     coral, pink, purple, navy, olive, gray). The app draws the dot; the
--     database only stores the key. The same ten keys live in
--     components/tasks/TK_viewLogic.js (TK_PROJECT_COLORS); a node test
--     reads this file and fails if the two lists drift apart.
--   * Existing projects get a color once, in the order they were made
--     (round robin through the palette), so the same project is the same
--     color for everyone.
--   * A new project gets the palette color used by the fewest live
--     (not trashed) projects, ties going to the earlier palette color. A
--     valid color sent with the insert is kept.
--   * The color changes only through tk_project_set_color (admin, or whoever
--     can manage the project), which writes an audit_log row
--     (tk_project.color_set). A direct UPDATE of the column is ignored by
--     a guard trigger (same pattern as the trash columns), so the audit
--     trail cannot be skipped.
--   * tk_admin_list_projects() also returns the color for the Manage
--     projects screen (its return type grows by one column, so it is
--     dropped and recreated with the same body and grants).
--   * Every function is SECURITY DEFINER with search_path = public and is
--     not executable by anon.
-- =====================================================================

-- 1. Column (nullable until the backfill below) --------------------------
alter table public.tk_projects add column if not exists color text;

-- 2. Guard: assigns on insert, ignores a direct change on update ----------
create or replace function public.tk_projects_color_guard()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_pal text[] := array['blue','teal','green','amber','coral','pink','purple','navy','olive','gray'];
  v_pick text;
begin
  if tg_op = 'INSERT' then
    if new.color is null or not (new.color = any (v_pal)) then
      select u.c into v_pick
        from unnest(v_pal) with ordinality as u(c, i)
       order by (select count(*) from public.tk_projects p
                  where p.color = u.c and p.trashed_at is null), u.i
       limit 1;
      new.color := v_pick;
    end if;
  elsif new.color is distinct from old.color
        and coalesce(current_setting('mgb.tk_project_color', true), '') <> 'on' then
    new.color := old.color;
  end if;
  return new;
end $$;
revoke all on function public.tk_projects_color_guard() from public, anon, authenticated;
drop trigger if exists tk_projects_color_guard on public.tk_projects;
create trigger tk_projects_color_guard before insert or update on public.tk_projects
  for each row execute function public.tk_projects_color_guard();

-- 3. Backfill existing projects once (oldest first, round robin) ----------
select set_config('mgb.tk_project_color', 'on', true);
with n as (
  select id, row_number() over (order by created_at, id) as rn
    from public.tk_projects
   where color is null
)
update public.tk_projects p
   set color = (array['blue','teal','green','amber','coral','pink','purple','navy','olive','gray'])[((n.rn - 1) % 10)::int + 1]
  from n
 where n.id = p.id;
select set_config('mgb.tk_project_color', '', true);

-- 4. Constraints ---------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tk_projects_color_check') then
    alter table public.tk_projects
      add constraint tk_projects_color_check
      check (color in ('blue','teal','green','amber','coral','pink','purple','navy','olive','gray'));
  end if;
end $$;
alter table public.tk_projects alter column color set not null;

-- 5. Set a color (admin or project manager) -------------------------------
create or replace function public.tk_project_set_color(p_project uuid, p_color text)
returns text
language plpgsql security definer
set search_path = public
as $$
declare
  v_p public.tk_projects;
  v_pal text[] := array['blue','teal','green','amber','coral','pink','purple','navy','olive','gray'];
  v_color text := lower(btrim(coalesce(p_color, '')));
begin
  v_p := public.tk__project_gate(p_project);
  if v_p.trashed_at is not null then
    raise exception 'tk_project_trashed' using errcode = '22023';
  end if;
  if not (v_color = any (v_pal)) then
    raise exception 'tk_bad_color' using errcode = '22023';
  end if;
  if v_color = v_p.color then
    return v_color;
  end if;
  perform set_config('mgb.tk_project_color', 'on', true);
  update public.tk_projects set color = v_color where id = p_project;
  perform set_config('mgb.tk_project_color', '', true);
  perform public.audit_write('tk_project.color_set', v_p.client_id, 'tk_project', p_project::text,
                             jsonb_build_object('name', v_p.name, 'from', v_p.color, 'to', v_color));
  return v_color;
end $$;

-- 6. The admin list, with the color ----------------------------------------
drop function if exists public.tk_admin_list_projects();
create or replace function public.tk_admin_list_projects()
returns table (
  id uuid, name text, kind text, client_id text, client_name text,
  owner_email text, owner_name text, open_to_staff boolean,
  created_at timestamptz, archived_at timestamptz,
  trashed_at timestamptz, trashed_by text, trash_expires_at timestamptz, trash_expired boolean,
  state text,
  open_tasks integer, done_tasks integer, trashed_tasks integer, open_requests integer, member_count integer,
  color text
)
language plpgsql security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if lower(coalesce(auth.jwt() ->> 'email', '')) = '' or not public.is_active_staff_admin() then
    raise exception 'tk_forbidden' using errcode = '42501';
  end if;
  perform public.tk__projects_mark_expired();
  return query
  select p.id, p.name, p.kind, p.client_id, c.name,
         p.owner_email, so.name, p.open_to_staff,
         p.created_at, p.archived_at,
         p.trashed_at, p.trashed_by, p.trashed_at + interval '30 days',
         p.trashed_at is not null and p.trashed_at < now() - interval '30 days',
         case when p.trashed_at is not null
                then case when p.trashed_at < now() - interval '30 days' then 'expired' else 'trashed' end
              when p.archived_at is not null then 'archived'
              else 'active' end,
         (select count(*)::int from public.staff_reminders s
           where s.project_id = p.id and s.deleted_at is null and s.status <> 'done'),
         (select count(*)::int from public.staff_reminders s
           where s.project_id = p.id and s.deleted_at is null and s.status = 'done'),
         (select count(*)::int from public.staff_reminders s where s.trashed_with_project = p.id),
         (select count(*)::int from public.client_requests r
            join public.staff_reminders s on s.id = r.task_id
           where s.project_id = p.id and s.deleted_at is null
             and r.status in ('open', 'answered') and r.deleted_at is null and not r.legacy_doc_request),
         (select count(*)::int from public.tk_project_members m where m.project_id = p.id),
         p.color
    from public.tk_projects p
    left join public.clients c on c.id = p.client_id
    left join public.staff so on lower(so.email) = lower(p.owner_email)
   where p.client_id is null or p.client_id <> all (public.internal_blocked_ids())
   order by (p.trashed_at is not null), (p.archived_at is not null), lower(p.name);
end $$;

-- 7. Grants ---------------------------------------------------------------
revoke all on function public.tk_project_set_color(uuid, text) from public, anon;
revoke all on function public.tk_admin_list_projects() from public, anon;
grant execute on function public.tk_project_set_color(uuid, text) to authenticated;
grant execute on function public.tk_admin_list_projects() to authenticated;
