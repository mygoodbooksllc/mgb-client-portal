-- ============================================================================
-- Slate plus: New project form upgrades (hidden preview,
-- docs/slateplus-projectform-spec.md).
--
-- Additive and inert: two optional columns on tk_projects. Nothing reads or
-- writes them unless the Slate plus gate is on (TKP_on(), components/tasks/
-- TK_slatePlus.js); with the gate off the app never selects them.
--
--   description  text, optional, at most 500 characters (shown in the project
--                header and Manage projects)
--   due_on       date, optional (shown in the project header; "late" styling
--                when past due and the project is not archived)
--
-- Permissions: unchanged. The existing tk_projects RLS covers the new columns
-- (insert: active staff, client projects need can_access_client; update:
-- tk_can_manage_project; read: tk_can_see_project). Table-level grants to
-- authenticated already include every column. No trigger touches them.
--
-- Rollback (only if the preview is dropped; it removes typed text):
--   alter table public.tk_projects drop constraint if exists tk_projects_description_len;
--   alter table public.tk_projects drop column if exists description, drop column if exists due_on;
--
-- Applied to production 2026-10-28 (migration slateplus_project_form).
-- ============================================================================

alter table public.tk_projects
  add column if not exists description text,
  add column if not exists due_on date;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.tk_projects'::regclass and conname = 'tk_projects_description_len'
  ) then
    alter table public.tk_projects
      add constraint tk_projects_description_len
      check (description is null or char_length(description) <= 500);
  end if;
end $$;

comment on column public.tk_projects.description is 'Slate plus (hidden preview): optional project description, at most 500 characters.';
comment on column public.tk_projects.due_on is 'Slate plus (hidden preview): optional project due date.';

-- Checks (read only):
--   select column_name, data_type from information_schema.columns
--    where table_schema = 'public' and table_name = 'tk_projects' and column_name in ('description', 'due_on');
--   select conname from pg_constraint where conrelid = 'public.tk_projects'::regclass and conname = 'tk_projects_description_len';
