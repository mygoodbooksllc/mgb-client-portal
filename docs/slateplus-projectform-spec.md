# Slate plus: New project form (hidden preview)

Built 2026-10-28 (label 2026-10-28i). Hidden behind the Slate plus gate (`TKP_on()` / `TKP_useOn()` in `components/tasks/TK_slatePlus.js`): a person's own Feature flag `mgb_slateplus_preview`, or the owner-only firm switch `tk_settings.slateplus_enabled` (still unset). Off in View as. Staff only.

Files: `components/tasks/TK_ProjectForm.jsx` (`TKPF_NewProjectModal`), `components/tasks/TK_projectFormLogic.js` (pure rules, node test `TK_projectFormLogic.test.js`), `supabase/slateplus-project-form.sql` (applied 2026-10-28, migration `slateplus_project_form`). Hooks: `TK_Sidebar.jsx` (wrapper), `TK_SlateRail.jsx` and `TK_ClientHeader.jsx` (pass `clients`, `staffUser`), `TK_api.js` (columns), `TK_List.jsx` (project header), `TK_ManageProjects.jsx` (rows), `tk-views.css` (`.tkpf*`).

## 1. Fields

1. **Name** (required, as before).
2. **Description**, optional, at most 500 characters, live "N characters left". Stored trimmed, three or more blank lines squeezed to one blank line.
3. **Client**, optional (hidden on the client header's onboarding form, which already has its client, and when the viewer has no clients). "No client (internal project)" is the default. Only the viewer's own client list. Picking one makes it a client project: `kind = 'onboarding'` and `client_id`, because `tk_projects_client_kind` requires `(kind = 'onboarding') = (client_id is not null)`. Tasks added in it get the project's client (existing `TK_List` add path).
4. **Due date**, optional (`type=date`). Must be a real day, 2000 to 2100.
5. **Color** from the project palette (`TK_PROJECT_COLORS`, `TK_vColorPicker`). Skip it and one is picked for you (the server color guard, as today).
6. **Start from**: Blank, three starter lists (To do / Doing / Done; Month-end steps; Onboarding steps), or "Copy sections from another project" (projects you can see, not archived, with at least one section). Picking one fills the Sections box, which stays editable.
7. **Sections** (one per line, as before).
8. **People**: You are Owner (fixed row). Add active staff as Owner or Member, change role, remove. Up to 25. Never yourself, no duplicates.
9. **Who can see it**: Open to all staff switch (admins only, as today) with help text, a one-line summary ("Visible to all staff", "Visible to you and 3 people", "Visible to you, 2 people and staff who work on Acme", "Visible only to you") and a warning when only you will see it.

## 2. Save

1. `TK_api.createProject(TKPF_buildCreate(...))`; the open-to-staff fallback is the same as the classic form.
2. If people were picked: add them one at a time with `TK_api.addMember` (`TKPF_addMembers`, never rejects). A refusal never stops the rest.
3. Any failures: the form shows "Project created" with "The project was created, but N people could not be added: Name (reason), ... You can add them later from Members on the project page." and an Open project button. The project is never lost or rolled back.

## 3. Permissions (unchanged, checked live 2026-10-28)

- Insert: `is_active_staff()` and (internal or `can_access_client(client_id)`). The before-insert trigger forces `owner_email` = me and `open_to_staff = false` for non-admins; the after-insert trigger adds me as owner member.
- Members: `tk_project_members` insert needs `tk_can_manage_project(project_id)`; the creator is owner so can add; non-admins can never add people to a project they cannot manage. Inactive staff raise `tk_member_inactive`.
- New columns are covered by the existing row policies and table grants. No policy, grant or trigger change.

## 4. Showing it

- Project header (`TK_vProjectHeader`): a Due pill ("Due Nov 3", or "Late: was due Oct 1" in the bad tone when past due and not archived) and the description under the title.
- Manage projects: a muted line under the name with the due text and description (live rows only; trashed rows come from a different query and do not show them).

## 5. Gate off

`TK_NewProjectModal` renders `TK_vNewProjectModalClassic`, the original form with its body unchanged; the extra props are ignored. `TK_api` selects the same project columns as before and never sends color, description or due date. Header and Manage projects render nothing new. Rows with a saved description or due date keep them, unseen.

## 6. Self-critique

- Client-tied general projects carry the Onboarding tag (schema `kind`). A separate kind would need a constraint change; left for the owner.
- No edit UI yet for description or due date after creation (follow-up; `updateProject` fields unchanged).
- Members are added after the insert, so a crash mid-way leaves a project with some people; the done screen names the rest, and Members on the project page can add them.
- Starter lists are fixed text in code (no admin editing).

## 7. Drafts (not published)

### Guide (staff-guide, Slate article, new section)

> **New project**
> Click New project in the Slate sidebar. Give it a name. You can also add a short description, tie it to a client, set a due date and pick a color. Start from fills in the sections for you: pick a starter list or copy another project's sections, then change them as you like. Under People, add anyone who should work on it as an Owner (can change the project) or a Member. Who can see it tells you, in one line, who will see the project. If it says only you will, add people (admins can also turn on Open to all staff). If someone cannot be added, the project is still made and you are told who to add later from Members.

### Next-visit notice

> **New project, now with people and dates.** When you make a project you can now add people, tie it to a client, set a due date, add a description and start from a list of sections. The due date shows on the project page and turns red once it is late.

### Tour step (one step, target New project button)

> **Make a project.** Add people, a client, a due date and starter sections in one go. The line at the bottom tells you who will see it.
