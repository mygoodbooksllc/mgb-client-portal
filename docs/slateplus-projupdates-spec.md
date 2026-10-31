# Slate plus: project status updates + Portfolio (hidden preview)

Feature 4 of the Slate "better than Asana" plan. Built 2026-10-28. Gated by the one Slate plus gate (`TKP_useOn()` / `TKP_on()`, `components/tasks/TK_slatePlus.js`): Feature flags › **Slate plus preview** (`mgb_slateplus_preview`), or the owner-only firm switch `tk_settings.slateplus_enabled` (unset; code never writes it). Never in View as. Staff only; clients never see it.

Size: Big (new table + RLS). Opus specs, builds, critiques and verifies.

## 1. Project status updates

On a project page (`#/tasks/p/<id>`), under the project header, a **Status** block:

- **Latest status pill** with the word in it (never color only): **On track** (green), **At risk** (amber), **Off track** (red), **Done** (gray with a check mark). No update yet: a gray **No status yet** pill.
- Beside it: "Updated Oct 28 by Grace" (today, yesterday, or a short date).
- The latest update's text, then **Show N earlier updates**, which opens the full timeline (newest first: pill, text, who, when).
- **Post update** (only for people who can manage the project, and not on an archived project): pick one of the four statuses (four buttons, the word on each, `aria-pressed`), write a short note (required, at most 1000 characters, counter shown from 900), **Post** or **Cancel**. The new update shows at the top right away.
- **Hide** on an update (anyone who can manage the project: admins and project owners; an author who is not a manager cannot): a confirm ("Hide this update? It stays saved, but no one sees it in Slate."), then it leaves the timeline. Nothing is deleted. There is no un-hide in this version: the database refuses clearing `hidden_at` from the app (any API role, admins included); an admin can restore one in SQL. A later version can add Show hidden.

Who can do what (the database decides; the UI only hints):

| | Read updates | Post | Hide |
|---|---|---|---|
| Anyone who can see the project today (owner, members, open-to-staff, staff with access to the project's client, admins) | yes (hidden ones: no) | no | no |
| People who can manage it today (`tk_can_manage_project`: admins, the project owner, members with role owner) | yes, hidden ones too | yes | yes |
| The update's author (if they later lose manage) | yes, their own hidden ones too | no | no |
| Clients, anon, inactive staff | no | no | no |

Same reach as the project itself: a trashed project, or a client project an internal-locked person can't see, shows no updates (the read check goes through the `tk_projects` RLS).

**No emails and no notifications** for updates in this version: posting writes a row and nothing else (no bell, no digest, no Desk item). Mention-style notifications ("@Grace this needs you") or a "notify members" box are a later option.

## 2. Portfolio page

`#/tasks/portfolio` (route parses only while the gate is on; off it is "We couldn't find that list" as before). Reached from:
- the Slate text sidebar, Projects section: **Portfolio** link under New project (gate on only);
- the Slate plus icon rail: the Projects panel (next to Manage projects) and the Projects hover menu.

One table of every project the viewer can see: the same `TK_api.listProjects()` list the sidebar and rail use (from the store; no extra project read). Archived projects are hidden unless **Show archived** is ticked.

Columns: **Project** (color dot, name, the same Client/Onboarding tag as the sidebar (`TKP_projectTag`); a real link, so Cmd/Ctrl click opens a new tab; a row click opens the project), **Owner** (staff name, else the part before @), **Status** (latest pill), **Last update** (date, and an amber **Stale** pill when the project is not done or archived and has had no update in 14 days; a project with no updates counts from its creation date), **Due** (`tk_projects.due_on` from the New project form; "Late" in red once past due and not archived).

Sort: **Status** (Off track, At risk, On track, No status yet, Done; ties by name) or **Due** (soonest first, no date last; ties by name), each toggles ascending/descending (column header buttons with `aria-sort`). Also sortable by Project and Last update (same code, cheap). Default: Status.

Open/total task counts: **skipped**. The page loads no tasks, and the only count source is one `tk_project_task_counts` RPC per project, which is not cheap for a list. A later version can add one batched RPC.

Data: one read of the new view `tk_project_update_latest` (latest non-hidden update per project, RLS applies) when the page opens and again after you post or hide an update in this tab (`mgb:tk-projupdates-changed`).

## 3. Database (`supabase/slateplus-project-updates.sql`, migration `slateplus_project_updates`)

Additive and inert while the preview is off (nothing reads or writes it).

- Table `tk_project_updates`: `id` uuid pk, `project_id` uuid fk → `tk_projects` (on delete restrict: projects are only ever trashed, and a hard delete must decide about its updates on purpose), `author_email` (stamped from the JWT by a trigger), `status` (check: on_track, at_risk, off_track, done), `body` (trimmed, 1 to 1000 characters), `created_at` (now(), trigger), `hidden_at`, `hidden_by` (both or neither). Index (project_id, created_at desc).
- RLS on. Policies (authenticated only, none for anon):
  - read: the project is visible to me (`exists (select 1 from tk_projects p where p.id = project_id)`, run under my own RLS, so it is exactly today's project read rule including trash and the internal lock) and (not hidden, or I am the author, or `tk_can_manage_project(project_id)`).
  - insert: project visible, `tk_can_manage_project(project_id)`, author is me, not hidden.
  - update (hide only): project visible and `tk_can_manage_project(project_id)`. A trigger refuses any change except `hidden_at`, stamps `hidden_by` and the time, and refuses un-hide (clearing `hidden_at`) for `authenticated`/`anon`; column grant allows `update (hidden_at)` only. (Tightened after review by `supabase/slateplus-project-updates-hidefix.sql`, migration `slateplus_project_updates_hidefix`: the first version let the author hide and let anyone who could hide also un-hide.)
  - no delete policy and no delete grant.
- Grants: anon nothing; authenticated `select`, `insert (project_id, status, body)`, `update (hidden_at)`.
- View `tk_project_update_latest` (`security_invoker = true`): latest non-hidden update per project (`distinct on`). Select for authenticated only.

## 4. Code

- `components/tasks/TK_projectUpdatesLogic.js` (`TKPU_`, pure, node test `TK_projectUpdatesLogic.test.js`): statuses, labels, tones, sort rank, the 14-day stale rule, draft check, portfolio rows and sorting, date text.
- `components/tasks/TK_ProjectUpdates.jsx`: `TKPU_ProjectStatus` (the header block) and `TKPU_Portfolio` (the page).
- `components/tasks/tk-projupdates.css`.
- `TK_api.js`: `listProjectUpdates(projectId)`, `postProjectUpdate(projectId, status, body)`, `hideProjectUpdate(id)`, `projectUpdatesLatest()`.
- `TK_logic.js`: `portfolio` route (gate on only). `TK_App.jsx`: renders the page. `TK_List.jsx`: the Status block in the project header (gate on only). `TK_Sidebar.jsx`, `TK_SlateRail.jsx`, `TK_railLogic.js`: Portfolio links.
- Gate off: no new markup, no new reads, the `portfolio` route stays unknown.

## 5. Drafts (not published; Slate plus is hidden)

**Guide** (`task-lists-and-projects`, new section "Project status and Portfolio"):
"Project owners can post a status update on a project: open the project, press **Post update**, pick **On track**, **At risk**, **Off track** or **Done**, write a line or two about where things stand, and press **Post**. The newest update shows under the project name with its status; press **Show earlier updates** to see the history. Everyone who can see the project can read the updates. If you posted something by mistake, press **Hide** on it (it is kept, just not shown). Posting an update does not email or notify anyone, so mention it in a task comment if someone needs to know.
**Portfolio** (Slate sidebar, under Projects) lists every project you can see with its owner, latest status, when it was last updated and its due date. A **Stale** tag means no update in 14 days. Click a column title to sort, and click a project to open it."

**What's new:** "Slate projects have status updates (On track, At risk, Off track, Done) and a new Portfolio page that shows every project's status and due date in one table."

**Notice** (`slateplus-projupdates`, at launch): title "Project status updates", body "Owners can post a status on a project, and Portfolio (under Projects) shows every project's status at a glance. Nothing is emailed."

**Tour** (at launch, 2 steps): (1) on a project, `data-tour="tk-projstatus"`: "Post a status update here so everyone can see how the project is going." (2) sidebar `data-tour="tk-portfolio-nav"`: "Portfolio shows every project's latest status, last update and due date."

**Tip** (at launch): target `tk-portfolio-nav`, "Sort Portfolio by Status to see what's off track first."

## 6. Launch

Flip `slateplus_enabled` with the rest of Slate plus (README launch checklist); publish section 5.

## 7. Rollback

Revert the commit, or leave the switch off. The table can stay (inert). Dropping it would remove typed updates, so do that only if the feature is dropped and the owner agrees.

## 8. Self-critique (before build)

- "Edit" means manage (`tk_can_manage_project`), the same rule as renaming the project; plain members and open-to-staff viewers read only. If the owner wants plain members to post, widen only the insert policy.
- Hidden rows are still readable by the author and managers through the API (by design, so nothing is lost); the UI never shows them.
- Archived projects: the database allows a manager to post (mirrors the project update rule, which also lets them unarchive); the UI hides Post update on an archived project, like every other edit there.
- Stale uses the browser's date; a 14-day window makes a time-zone day either way harmless.

## 9. Review fixes (Opus review after build, 2026-10-28)

- Un-hide through the API (medium): the first trigger let anyone who could hide clear `hidden_at`. Fixed in `supabase/slateplus-project-updates-hidefix.sql` (`slateplus_project_updates_hidefix`): un-hide is refused for `authenticated`/`anon`, and hide is narrowed to managers ("admins or project owners"), so the Hide button shows only for them.
- Keyboard focus: opening the composer moves focus to the chosen status (else the first); Cancel or Post returns it to **Post update**. The counter's live region is always in the page, so the first count is announced.
- "yesterday" used now minus 24 hours, wrong on a DST day; it now uses the calendar day before (node test covers 2026-03-09).
- Noted, not fixed (shared, pre-existing): `TK_useRoute` parses the hash once, so if the firm switch arrives after the first parse a cold-loaded `#/tasks/portfolio` (like `#/tasks/profile`) shows the default view until the next hash change. Only matters for the owner's switch, never for the preview flag.
