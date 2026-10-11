# Tasks module, Phase 1 build spec

Written 2026-10-11 against HEAD `ddccaba`, from `docs/tasks-module-audit.md` (Step 0 audit plus the owner's decisions D1 to D11, dated 2026-10-10). Revised the same day after a critic pass; every finding and what was done with it is in the **Critique log** at the end. This file is the single source for the Phase 1 build. Each slice brief in the build workflow points here. An engineer who reads this file plus their own brief has everything they need.

Rules that apply to every part of this file:
- No personal names or email addresses anywhere in repo files, URLs, test data or copy. Use roles ("Account Manager", "admin", "bookkeeper"). Test addresses use `example.test`.
- American spelling. Plain, friendly UI copy.
- QuickBooks stays read-only. Nothing here writes to QuickBooks.

---

## Part A. For the owner: what staff get

**In one line:** Tasks become a real task manager inside the portal, good enough to replace Asana for daily work. Today stays the home page.

What staff will see:

1. **My Tasks.** One list of everything assigned to you, grouped as **Overdue**, **Today**, **This week** (the next 7 days) and **Later** (including tasks with no date). A separate **Waiting on client** section holds paused tasks, so they never count as late. Done tasks fold away at the bottom. Tasks finished more than 12 months ago are hidden unless you click **Show older**.
2. **Task details.** Click any task, from My Tasks, Today, a client's Overview, the bell or search, and a details panel slides in. It shows the title, description, status, assignee, due and start dates, priority, section, client or project, the checklist, files, comments and a history of every change. On a phone it fills the screen.
3. **Status.** Every task has a status: **To do**, **In progress**, **Waiting on client**, **Ready for review** or **Done**. A task marked "needs review" can only be finished by an admin. When the bookkeeper finishes it, it moves to Ready for review instead. Any admin can approve it (D1).
4. **Comments with @mentions.** Type `@` and a teammate's name to bring them in. They see it in the bell and start following the task. Followers see the task even if it's private.
5. **Files on tasks.** On a client task, files go into that client's Google Drive folder as internal files. On an internal task, files go into private staff-only storage. Links to other files work too.
6. **Client lists and projects.** Each client has a task list with sections such as Weekly, Monthly and Annual. Internal work has projects: **SOPs**, **Directors**, **Owners** and **90 Day** are created for you, and staff can create more. **SOPs** and **90 Day** are open to all staff (a project setting, "Open to all staff", that you can switch off). Bookkeepers see tasks only for clients assigned to them, or while they have coverage or a temporary grant (D3). Directors and Owners are open to all admins and to no one else (D10).
7. **Quick add.** Press `q` anywhere in the staff portal (except while typing), or use **+ → New task**, from any page, with or without a client open, and type one line, for example `Reconcile operating account #example-church @backup fri !high`. The client, the person, the date and the priority are picked out of the text.
8. **Search.** `Ctrl/⌘+K` now finds any task you're allowed to see, including words in descriptions and comments. Clicking a result opens the task.
9. **Keyboard.** `j`/`k` move through the list, `Enter` opens, `x` marks done, `s` changes status, `a` assigns, `q` adds, `Esc` closes and `?` shows the list of keys. `q` works on every staff page. The other keys work on the Tasks lists and in task details. The keys never fire while you're typing.
10. **Tasks in its own window.** **Open in own window** pops Tasks out into a slim window you can keep beside QuickBooks. **Dock in portal** puts it back. The portal and the window stay in sync. The address `/tasks` also opens this slim view. It's an extra, and Today is still home (D11).
11. **Every task and list has a link.** **Copy link** on a task gives a link that opens it after sign-in. Old links in emails keep working.
12. **Works on phones and in dark mode.** Every screen works at phone width and in dark mode.

How it changes current habits:
- **Work › Tasks** now shows the new My Tasks. Notes and SOPs move to a new **Work › Notes & SOPs** tab, which keeps working exactly as before.
- A task you give someone else shows on *their* My Tasks, not yours. You still see it on the client's list, and you follow it automatically.
- Deleting a task hides it, but it can be restored. Nothing is lost (D5). This holds even for an old copy of the app: a delete from any screen becomes a hide, so comments, files and history stay.
- Due dates are calendar days by default. Business-day dates (`bd5`, `+3bd`) apply only when you type them (D2).

Not in Phase 1, coming later: board and calendar views, saved filters, the recurring engine rewrite, the full review queue, Ask-client, the staff inbox, rules, out-of-office reassignment, dashboards and the Asana import. Mentions show in the bell only, with no email, in Phase 1.

Owner decisions this spec relies on: D1 (any active admin reviews; the Account Manager is the default reviewer from Phase 2), D2 (calendar days), D3 (client access rules), D4 (few or no Asana add-ons), D5 (keep history; hide done tasks older than 12 months), D6 (the Today group is tentative: a view setting can merge it into This week), D9 (Phase 1 is not trimmed), D10 (Owners and Directors open to all admins), D11 (/tasks is a secondary shell). Saved filter presets, when they come, stay personal.

One default this spec picks for the owner to confirm (Part G, item 3): SOPs and 90 Day start open to all active staff. Directors and Owners stay admin-only. Switching a project's "Open to all staff" setting changes this without a code change.

What the owner checks before Phase 1 is called done is listed in **Part G**.

---

## Part B. How the build is split

### B1. Slices

| key | kind | owns | rows |
|---|---|---|---|
| `sql` | sql | `supabase/tasks-module-v1.sql`, `supabase/tasks-module-v1-checks.sql` | 1.1, 1.3, 1.4, 2.1–2.7, 2.13, 11.4, N.2 (DB side) |
| `logic` | module | `components/tasks/TK_logic.js`, `components/tasks/TK_logic.test.js` | 2.2, 2.11, 3.1, 3.6, 11.5 (routes), N.3 |
| `data` | module | `components/tasks/TK_store.js`, `components/tasks/TK_store.test.js`, `components/tasks/TK_api.js`, `components/tasks/TK_sync.js` | 2.1, 2.2 (`TK_api.complete`), 11.4, N.2 (JS side), B4 |
| `views` | module | `components/tasks/TK_viewLogic.js`, `components/tasks/TK_viewLogic.test.js`, `components/tasks/TK_TaskRow.jsx`, `components/tasks/TK_keys.jsx`, `components/tasks/TK_ClientHeader.jsx`, `components/tasks/TK_Sidebar.jsx`, `components/tasks/TK_MyTasks.jsx`, `components/tasks/TK_List.jsx`, `components/tasks/TK_StandaloneBar.jsx`, `components/tasks/TK_App.jsx`, `components/tasks/tk-views.css` | 1.2, 1.4, 3.1, 3.2, 3.6 (list keys), 11.2 (`TK_dockPlan`, pop-out), 11.5 (schema-missing forward), N.4 |
| `drawer` | module | `components/tasks/TK_drawerLogic.js`, `components/tasks/TK_drawerLogic.test.js`, `components/tasks/TK_Drawer.jsx`, `components/tasks/TK_Comments.jsx`, `components/tasks/TK_Attachments.jsx`, `components/tasks/TK_Activity.jsx`, `components/tasks/TK_QuickAdd.jsx`, `components/tasks/tk-drawer.css` | 1.1, 1.3, 2.1, 2.3–2.7, 2.11, 3.6 (drawer keys and stack), N.4 |
| `integration` | integration | every existing app file: `index.html`, `app.jsx`, `vercel.json`, `components/staff/DeepLink.jsx`, `components/staff/StaffNav.jsx`, `components/staff/TopBar.jsx`, `components/staff/Today.jsx`, `components/staff/WorkPage.jsx`, `components/staff/ClientTabCounts.jsx`, `components/staff/TeamPage.jsx`, `components/inbox/StaffInbox.jsx`, `components/dashboard/WidgetDrawer.jsx`, `components/settings/Settings.jsx`, `supabase/functions/notification-emails/index.ts`, `supabase/functions/client-emails/index.ts` | 2.11 (entry points), 2.13, 3.1, 3.6 (drawer stack listeners), 11.1, 11.2 (opener side), 11.5 (call sites, LK changes, #/work/notes), N.1, N.5 |
| `docs` | docs | `README.md`, `docs/staff-guide/*.md` (listed in C11), `components/tour/Tour.jsx`, `components/tour/Tips.jsx` | N.5 (copy), help, What's new |

The files are disjoint. Shared strings that sit in integration-owned files (MGB_VERSION in `index.html`, PAGE_META, Usage labels and the help map in `app.jsx` and `TopBar.jsx`) are fixed word for word in **C10**. Integration types them in, and docs checks them afterwards. Docs never edits integration files.

### B2. Order

1. `sql` writes both files. Applying the migration is a later lead step. This step is read-only against the database.
2. `logic`, `data`, `views` and `drawer` build in parallel against Part C. Each tests its pure file with node. Views and drawer may reference each other's and data's globals only at render time, behind `typeof X === "function"` guards.
3. `integration` wires everything into the app once the modules exist.
4. `docs` writes the guide, Tour, Tips and README, then checks the C10 strings in the integration files.

### B3. Conventions (all slices)

- **Prefixes:** `TK_` for JS globals, `tk_` for SQL objects, `.tk-` for CSS classes, `mgb_tk_` for localStorage keys. One file, one prefix.
- **No bundler:** files load through `window.__SOURCE_ORDER` in `index.html`, Babel compiles in the browser, and every top-level `function`, `const` or `var` becomes a global. A file may use another file's globals at render or call time only, never at top level, except that `TK_logic.js` and `TK_store.js` load first and may be used at the top level of later TK files.
- **Pure logic files** (`TK_logic.js`, `TK_store.js`, `TK_viewLogic.js`, `TK_drawerLogic.js`): no React, no DOM, no Supabase, `var` or `function` declarations, and the guard at the end:
  ```js
  if (typeof module !== "undefined" && module.exports) { module.exports = { /* every exported name */ }; }
  ```
- **Tests:** plain node, no runner, in the same style as `components/staff/staffOpsLogic.test.js`: `const assert = require("assert"); const L = require("./TK_logic.js"); let n = 0; function t(name, fn) {...}` and a final `console.log(n + " checks passed")`. Run with `node components/tasks/TK_logic.test.js`. Test files are never listed in `__SOURCE_ORDER`.
- **CSS:** use only the tokens on `:root` in `styles.css` (and their dark-mode values). No hex colors except a fallback inside `var(--token, #hex)`. Phone breakpoint `@media (max-width: 760px)`. Touch targets are at least 40px on phones. Inline styles never set colors.
- **Copy:** the strings in C10 are final. Use sentence case, American spelling, and no exclamation marks.
- **URLs:** never put emails, names or free text in a URL. Client ids are `encodeURIComponent`'d; project and staff ids are uuids.
- **Schema absent:** every TK file must work when the Phase 1 migration has not been applied (B4).
- **Tracking:** call `MGB_track(name)` only behind `typeof MGB_track === "function"`, and only with the names in C10.

### B4. When the schema is missing

`TK_api.probe()` calls `rpc("tk_schema_version")` once per page load.
- If it returns 1, the schema is `"ok"`.
- If it fails with a missing-function error (`PGRST202`, `42883`, or "Could not find the function"), the schema is `"missing"`.
- On a network error, the schema stays `"unknown"`, and the probe retries on the `online` event or after 30 seconds.
- Any other TK_api call that fails with `42703`, `PGRST204`, `PGRST202` or `42883` does **not** set the schema by itself. These codes also come from ordinary bugs (a typo in a select list, `text = uuid` inside a function). Instead, TK_api re-runs `TK_api.probe()` once (shared promise, at most once per 30 seconds):
  - if the probe now fails with `PGRST202` on `tk_schema_version` itself, the schema becomes `"missing"` and the call rejects with `code: "tk_schema_missing"`;
  - otherwise the schema stays `"ok"` and the call rejects with the original Postgres code and message, which the view shows through its normal error state (`TK_COPY.loadError` or `saveError`) and logs with `console.error("[TK]", code, message)`.
- `TK_sync.start` opens the `tk-core-<tabId>` channel only after the schema is `"ok"`. The `tk-tasks-<tabId>` channel also waits for `"ok"`.

While the schema is `"missing"`:
- `TK_MyTasks` and `TK_App` show the calm setup card (copy in C10), with a link to `#/work/tasks`.
- `place:"tasks"` arrivals are forwarded to the legacy page, never dropped (11.5, "Arrivals").
- WorkPage mounts the legacy `MyTasksPage` (integration).
- `TK_openTask(id)` falls back to `LK_go({place:"work", tab:"tasks", item:"task:"+id})`.
- `TK_QuickAddHost` still opens. It parses the line with `TK_parseQuickAdd` and saves through `staffItemsApi.add` using legacy fields only (text, due_date, client_id, priority, assignee_email, visibility, kind).
- `staffItemsApi` keeps working on the old columns through its own `tkCols` flag (integration, C9).

While the schema is `"unknown"` (the first probe is in flight), views show the loading skeleton.

---

## Part C. Interface contract

> **As applied to production (migration `tasks_module_v1`, 2026-10-11).** `supabase/tasks-module-v1.sql` is the source of truth where it differs from this spec:
> - `tk_set_status` takes a fourth argument, `p_today date` (see C3). `TK_api.setStatus` and `TK_api.complete` pass the caller's local date.
> - An archived project rejects signed-in task writes with `22023 tk_project_archived` (D6). Show it as a calm toast.
> - Non-admin project managers cannot change `open_to_staff`; the trigger keeps the old value.
> - An empty `section` is stored as null (`nullif`), so clearing the field clears the section.
> - Comment authors and admins may edit a comment (tk_comments update policy).
> - Extra indexes: `staff_reminders_tk_client_idx`, `tk_attachments_task_idx`, `tk_attachments_client_file_idx`.
> - Since the apply, every signed-in DELETE on `staff_reminders` is a soft delete. Readers must filter `deleted_at is null`, including the two edge functions (Part G item 12).
> - **fix 1 (migration `tasks_module_v1_fix_1`, 2026-10-11, code review).** A direct API insert into `staff_reminders` needs active staff, and putting a task on a client (insert, or the owner changing `client_id`) needs `can_access_client` unless the caller is an admin; both raise `42501 tk_forbidden`. Definer RPCs, cron and bypass writes are exempt. `tk_can_edit_task` checks active staff before the owner test, and `tk_attachments_before_write` refuses non-staff inserts, so a non-staff owner cannot attach, upload or set status. `tk_project_info` returns `client_id` and `archived` only to server callers and staff who can see the project. `tk_comments.edited_by` records who last changed a comment body (shown as "edited by …" when it is not the author). A former editor can soft-remove their own attachment only while they can still read the task. The assigned email is skipped when the assignee cannot open the task's client, and the `task_due` email in `notification-emails` skips client tasks the assignee cannot reach (admins, `staff_client_access`, or an approved, unexpired grant).
> - **fix 2 (migration `tasks_module_v1_fix_2`, 2026-10-11, behaviour verify).** `complete_staff_item` refuses a soft-deleted row (`42501`), so completing a deleted recurring task no longer creates a live next occurrence. `staff_reminders_before_write` pins `created_by` on every UPDATE, owners included, unless the offboarding or `tk_migrate` bypass is on.

### C1. Load order

Integration inserts this block in `window.__SOURCE_ORDER`, right after `"components/client/QboGiving.jsx"` and before `"components/tour/Tour.jsx"`:

```
"components/tasks/TK_logic.js",
"components/tasks/TK_store.js",
"components/tasks/TK_api.js",
"components/tasks/TK_sync.js",
"components/tasks/TK_viewLogic.js",
"components/tasks/TK_drawerLogic.js",
"components/tasks/TK_TaskRow.jsx",
"components/tasks/TK_keys.jsx",
"components/tasks/TK_Comments.jsx",
"components/tasks/TK_Attachments.jsx",
"components/tasks/TK_Activity.jsx",
"components/tasks/TK_Drawer.jsx",
"components/tasks/TK_QuickAdd.jsx",
"components/tasks/TK_ClientHeader.jsx",
"components/tasks/TK_Sidebar.jsx",
"components/tasks/TK_MyTasks.jsx",
"components/tasks/TK_List.jsx",
"components/tasks/TK_StandaloneBar.jsx",
"components/tasks/TK_App.jsx",
```

It also adds CSS lines after the `components/tour/tips.css` line, in the same `document.write` form:

```js
document.write('<link rel="stylesheet" href="components/tasks/tk-views.css?v=' + Date.now() + '">');
document.write('<link rel="stylesheet" href="components/tasks/tk-drawer.css?v=' + Date.now() + '">');
```

### C2. Data shapes

**Task** (one `staff_reminders` row, as `TK_normalizeTask` returns it):

```
{ id: uuid, text: string, description: string|null,
  status: "todo"|"in_progress"|"waiting_client"|"ready_for_review"|"done",
  done: boolean, due_date: "YYYY-MM-DD"|null, due_at: iso|null, remind_at: iso|null,
  start_on: "YYYY-MM-DD"|null, priority: "low"|"normal"|"high", kind: "task"|"reminder",
  recurrence: "none"|"daily"|"weekly"|"monthly"|"month_end",
  client_id: string|null, project_id: uuid|null, section: string|null, sort_key: number|null,
  parent_id: uuid|null, sop_section: string|null, review_required: boolean,
  assignee_email: string (lowercase), staff_email: string (owner), created_by: string|null,
  visibility: "private"|"shared", source: string, source_ref: string|null, series_id: uuid|null,
  completed_at: iso|null, status_changed_at: iso|null, status_changed_by: string|null,
  waiting_since: iso|null, waiting_minutes: number,
  created_at: iso, updated_at: iso|null, deleted_at: iso|null }
```

`TK_TASK_COLS` (the select list, defined in `TK_api.js`): `id, text, description, status, done, due_date, due_at, remind_at, start_on, priority, kind, recurrence, client_id, project_id, section, sort_key, parent_id, sop_section, review_required, assignee_email, staff_email, created_by, visibility, source, source_ref, series_id, completed_at, status_changed_at, status_changed_by, waiting_since, waiting_minutes, created_at, updated_at, deleted_at`.

**Comment** (`tk_comments`): `{ id, task_id, author_email, body, mentions: string[], kind: "comment"|"send_back"|"client_reply"|"system", created_at, edited_at, edited_by, deleted_at }` (`edited_by`: fix 1)

**Activity** (`tk_activity`): `{ id: number, task_id, actor_email ("system" when there was no signed-in user), kind, from_value, to_value, meta: object, created_at }`

**Follower** (`tk_followers`): `{ task_id, staff_email, added_by, added_at }`

**Attachment** (`tk_attachments`): `{ id, task_id, kind: "file"|"drive"|"link", client_file_id, storage_path, url, name, size, mime, added_by, created_at, removed_at }`

**Project** (`tk_projects`): `{ id, name, kind: "internal"|"onboarding", client_id, owner_email, open_to_staff: boolean, sections: string[], archived_at, created_at, updated_at }`

**Member** (`tk_project_members`): `{ project_id, staff_email, role: "member"|"owner", added_by, added_at }`

**Staff** (from `staff`): `{ id, email, name, role, active }`. Names show only in the UI, never in URLs.

### C3. SQL surface (all in `public`; full detail in Part D)

| object | signature / shape | who may call | returns / errors |
|---|---|---|---|
| `tk_schema_version()` | `() returns int` | authenticated | `1` |
| `tk_can_read_task(p_id uuid)` | stable, definer | authenticated | boolean |
| `tk_can_edit_task(p_id uuid)` | stable, definer | authenticated | boolean |
| `tk_row_readable(p_id uuid, p_owner text, p_assignee text, p_client text, p_project uuid, p_visibility text)` | stable, definer | authenticated (used by the policy) | boolean |
| `tk_is_project_member(p_project uuid)` | stable, definer | authenticated | boolean; true for a member row, or for any active staff member when the project is `open_to_staff` |
| `tk_can_see_project(p_project uuid)` | stable, definer | authenticated | boolean |
| `tk_can_manage_project(p_project uuid)` | stable, definer | authenticated | boolean |
| `tk_project_info(p_project uuid, out found boolean, out client_id text, out archived boolean)` | stable, definer | authenticated (the invoker trigger in D6 calls it; returns `found = false` unless `is_active_staff()`) | record |
| `tk_path_task_id(p_name text)` | immutable | authenticated | uuid or null |
| `tk_can_upload_task_file(p_name text)` | stable, definer | authenticated (used by the storage insert policy) | boolean |
| `tk_staff_has_client(p_email text, p_client text)` | stable, definer | **internal** (revoked from authenticated) | boolean |
| `tk_task_scope_ok(p_task uuid, p_email text)` | stable, definer | **internal** | boolean |
| `tk_parse_mentions(p_body text, p_task uuid)` | stable, definer | **internal** | text[] |
| `complete_staff_item(p_id uuid, p_done boolean, p_today date default null)` | definer, same signature | authenticated | uuid of the next occurrence, or null; null with `p_done=true` and the task now `ready_for_review` means it was sent for review |
| `tk_set_status(p_id uuid, p_status text, p_note text default null, p_today date default null)` | definer | authenticated | the resulting status text; `22023 tk_bad_status` / `22023 tk_bad_transition` (same status, or done → waiting_client / ready_for_review) / `42501 tk_forbidden` / `22023 tk_project_archived`. **As applied:** `p_today` is the caller's local date (`YYYY-MM-DD`, the same value existing callers pass to `complete_staff_item`), handed to `complete_staff_item` for the roll-forward; always send it. |
| `tk_add_follower(p_task uuid, p_email text)` | definer | authenticated | boolean (true if added); `42501 tk_forbidden`, `42501 tk_follower_no_access` |
| `tk_attach_client_file(p_task uuid, p_file uuid)` | definer | authenticated | attachment uuid; `42501 tk_forbidden`, `22023 tk_wrong_client` |
| `tk_search(q text, p_limit int default 20)` | definer, stable; filters every row through `tk_row_readable` itself | authenticated | `table(task_id uuid, task_text text, client_id text, project_id uuid, status text, due_date date, match text, snippet text, rank real)`; `match` is `"task"` or `"comment"` |
| `tk_client_people(p_client text)` | stable, definer | authenticated | `table(role text, email text, name text)`; role is `bookkeeper`, `backup` or `account_manager`; empty unless active staff with `can_access_client` |
| `tk_assignable_staff(p_client text default null, p_project uuid default null)` | stable, definer | authenticated | `table(email text, name text, role text, can_see boolean)`; empty unless active staff, and empty unless the caller passes `can_access_client(p_client)` (with a client) or `tk_can_see_project(p_project)` (with a project) |
| view `tk_tasks` | `security_invoker`, `select * from staff_reminders where deleted_at is null` | authenticated, **select only** (RLS applies) | Task rows |
| trigger `tk_staff_reminders_soft_delete` | BEFORE DELETE on `staff_reminders`, definer | n/a | turns a delete into `deleted_at = now()` (D9) |
| bucket `task-files` | private, 25 MB, the same mime list as `staff-chat-attachments` | storage policies | path `<task_id>/<uuid>-<safe name>` |

Writes from JS go straight to the tables under RLS:
- `staff_reminders`: insert, and update of the whitelisted columns in C5. A delete is turned into a soft delete by the server.
- `tk_comments`: insert, and update of `body` or `deleted_at`.
- `tk_followers`: insert yourself; delete yourself, or anyone if you can edit the task.
- `tk_attachments`: insert `link` or `file` rows; update `removed_at`.
- `tk_projects`: insert (with `.select()`; the creator can always read their new project back) and update.
- `tk_project_members`: insert, update and delete.

Table and view privileges are exact (D general rules): every new tk_ table and view starts from `revoke all … from anon, authenticated`, and then gets only the grants listed in D2, D8 and D11. anon has no privilege on any tk_ object.

### C4. `TK_logic.js` (slice `logic`)

Every name below is exported through the module guard and is a browser global.

```
TK_STATUSES = ["todo","in_progress","waiting_client","ready_for_review","done"]
TK_STATUS_LABELS = { todo:"To do", in_progress:"In progress", waiting_client:"Waiting on client", ready_for_review:"Ready for review", done:"Done" }
TK_PRIORITIES = ["high","normal","low"]; TK_PRIORITY_LABELS = { high:"High", normal:"Normal", low:"Low" }
TK_SOP_SECTION_IDS = ["access","bank_feeds","monthly_close","payroll","bills_vendors","reporting","quirks"]  // must equal app.jsx CLIENT_SOP_SECTIONS ids
TK_SOON_DAYS = 7
TK_OLD_DONE_MONTHS = 12
TK_CLIENT_SECTION_ORDER = ["Weekly","Monthly","Quarterly","Annual","Occasional"]

TK_effectiveStatus(task) -> status            // task.status || (task.done ? "done" : "todo")
TK_canTransition(from, to) -> boolean          // false when from===to, or from "done" to "waiting_client"/"ready_for_review"; true otherwise (mirrors SQL)
TK_resolveStatus(task, to, { isAdmin }) -> status  // "done" on a review_required task by a non-admin, where from != done -> "ready_for_review"; else `to`
TK_nextStatuses(task, { isAdmin }) -> [{ status, label }]  // legal targets in TK_STATUSES order, never the current status, and from "done" never waiting_client or ready_for_review (the server raises tk_bad_transition for both); for a review_required task and a non-admin, "done" is replaced by { status:"ready_for_review", label:"Send for review" }; "done" from ready_for_review is offered only to admins, labelled "Approve"
TK_isOpen(task) -> boolean                     // !deleted_at && effective status !== "done"
TK_isMine(task, email) -> boolean              // lower(assignee_email || staff_email) === lower(email)
TK_isOverdue(task, today) -> boolean           // open, status not waiting_client, due_date && due_date < today
TK_isOldDone(task, today) -> boolean           // done and completed_at (or updated_at) older than 12 months before today
TK_groupMyTasks(tasks, today, { email, showOlder=false, todayGroup=true }) ->
    { overdue:[], today:[], week:[], later:[], waiting:[], done:[] }
    // only TK_isMine and not deleted; waiting = status waiting_client (any date);
    // done = status done (minus TK_isOldDone unless showOlder), sorted completed_at desc;
    // the rest by day difference d = dayDiff(today, due_date): d<0 overdue, d==0 today
    // (or week when todayGroup=false), 1<=d<=7 week, d>7 or no due date later.
    // Calendar days only; Saturday and Sunday are ordinary days. ready_for_review stays in its date group.
TK_compareTasks(a, b) -> number                // due_date asc (nulls last), then high>normal>low, then due_at, then created_at, then id
TK_dueLabel(task, today) -> string             // "Today", "Tomorrow", "Yesterday", "3 days late", weekday "Fri" within 6 days, "Oct 14", "Oct 14, 2027" if another year; "" when no date
TK_ymd(date) -> "YYYY-MM-DD" (local)  TK_addDays(ymd, n)  TK_dayDiff(fromYmd, toYmd)  TK_weekday(ymd) 0..6
TK_isBusinessDay(ymd)  TK_addBusinessDays(ymd, n)  TK_nthBusinessDay(year, month1to12, n)   // Mon-Fri, no holidays in Phase 1 (D2: opt-in only)
TK_parseQuickAdd(input, { today, staff:[{email,name}], clients:[{id,name}], defaultClientId=null }) ->
    { text, assignee_email|null, client_id|null, due_date|null, priority|null,
      tokens:[{ kind:"person"|"client"|"date"|"priority", raw, start, end, value }], errors:[string] }
TK_slug(name) -> lowercase name, non-alphanumerics -> "-", trimmed of "-"
TK_mentionTokens(body) -> unique lowercase handles after "@" (same rule as SQL tk_parse_mentions)
TK_handleOf(email) -> lowercase local part before "@"
TK_parseRoute(hash) -> route ; TK_formatRoute(route) -> hash   (C7 grammar)
TK_KEYMAP = [{ key, label, scope:"list"|"drawer"|"any" }]  (C8)
TK_shouldHandleKey(event, { modalOpen, menuOpen, tourOpen, scope }) -> boolean
    // scope "list" also returns false when the target is inside [data-tk-keyscope="drawer"]; scope "drawer" returns false
    // when the target is outside it. See C8.
TK_canEdit(task, { email, isAdmin, canSeeClient(id)->bool, isMember(projectId)->bool }) -> boolean  // UI hint only; the server decides
TK_normalizeTask(row) -> Task      // fills defaults, lowercases emails, status via TK_effectiveStatus, waiting_minutes 0
TK_isMissingColumn(err) -> boolean // 42703, PGRST204, "column ... does not exist", "could not find the ... column"
TK_isMissingFunction(err) -> boolean // PGRST202, 42883, "could not find the function"
    // Both helpers only say "this error might mean the schema is missing". They never set the schema by themselves;
    // TK_api re-probes first (B4).
TK_COPY = { ...all C10 strings... }
```

`TK_parseQuickAdd` token rules (calendar days unless a business-day token is typed):
- `@handle`: a staff member whose `TK_handleOf(email)` or `TK_slug(name)` starts with `handle`. One match sets `assignee_email`. No match or several gives the error `"Who is @handle?"`, and the token stays in the text.
- `#slug`: a client whose `TK_slug(name)` starts with `slug`, or whose id equals it. Errors work the same way: `"Which client is #slug?"`.
- `!high` `!h` `!low` `!l` `!normal` `!n` set the priority.
- Dates (first match wins, case-insensitive, matched as whole words):
  - `today`, `tod`
  - `tomorrow`, `tmr`, `tom`
  - weekday names and their three-letter forms: the next such day strictly after today
  - `tom`, `sun`, `mon` and `sat` are also everyday words and names, so they count only right after `due` or `on`, or as the last word ("call Tom about payroll" has no date) (fix 1)
  - `next week`: next Monday
  - `eom`: last day of this month
  - `in N days`, `+Nd`, `+Nw`
  - `M/D` and `M/D/YY(YY)`: a past M/D rolls to next year
  - ISO `YYYY-MM-DD`
  - `bdN`: Nth business day of this month, or of next month if it has passed
  - `+Nbd`: N business days after today
- Matched tokens are removed from `text`, and spaces are collapsed. An empty `text` gives the error `"Add a few words about the task."`.

### C5. Data slice: `TK_store.js`, `TK_api.js`, `TK_sync.js`

**`TK_store.js`** (pure, tested)

```
TK_initialState() -> { schema:"unknown", online:true, me:null, drawerId:null, tasks:{}, lists:{}, pending:{}, staff:null, projects:null }
// fix 1: { type:"reset" } returns TK_initialState() (online kept); TK_sync.stop() dispatches it and calls TK_api._reset().
// "me" changing from one non-null email to another also starts from TK_initialState().
TK_listKey(scope) -> string   // "mine", "client:<id>", "project:<uuid>", "person:<email-free staff uuid>", "children:<uuid>"
TK_reduce(state, action) -> new state (never mutates). Actions:
  { type:"schema", value }                       // "unknown"|"ok"|"missing"
  { type:"online", value }
  { type:"listLoading", key }
  { type:"listLoaded", key, tasks:[Task], at }   // upserts tasks (same rule as upsert), sets list ids in returned order
  { type:"listError", key, error:string }
  { type:"upsert", task }                        // keep the newer copy: replace when cached has no updated_at or incoming.updated_at >= cached.updated_at
                                                 // (updated_at compared as the exact ISO strings the server sent, never through Date);
                                                 // fields under a pending optimistic op for that id keep their patched values until commit or rollback;
                                                 // a task with deleted_at set is removed from every list's ids but kept in tasks
  { type:"remove", id }
  { type:"optimistic", id, patch, opId }         // apply the patch, remember the previous fields under pending[opId]
  { type:"rollback", opId } | { type:"commit", opId, task? }   // commit with the server row upserts it, then drops pending[opId]
  { type:"staff", staff:[Staff] } | { type:"projects", projects:[Project] }
  { type:"me", email }
  { type:"drawer", id }                          // id or null; set by TK_DrawerHost on open and close, read by list views (C8 keys)
TK_selectList(state, key) -> { tasks:[Task], loading:boolean, error:string|null, at:number|null }
TK_createStore(reducer=TK_reduce, init=TK_initialState()) -> { getState(), dispatch(action), subscribe(fn)->unsubscribe }
TK_store = TK_createStore()   // the one app-wide store (a global)
```

List membership after `upsert`: a task joins `mine` when `TK_isMine` holds for the email stored under `state.me`. Set `state.me` with `{ type:"me", email }`. A task joins `client:<id>`, `project:<id>` and `children:<parent>` when its fields match. It leaves a list when they stop matching.

**`TK_api.js`** (Supabase through `window.mgbSupabase`; every method returns a Promise and rejects with an `Error` that has `.code`, one of `tk_schema_missing`, `tk_forbidden`, `tk_conflict`, `tk_reverted`, `tk_offline`, `tk_not_found`, or the Postgres code)

```
TK_api.probe() -> "ok"|"missing"|"unknown"     (dispatches schema)
TK_api.listMine(email, { showOlder }) -> [Task]   // tk_tasks, .or(assignee_email.eq.<me>, and(assignee_email.is.null, staff_email.eq.<me>)),
                                                  // plus .or(done.eq.false, completed_at.gte.<12 months ago>) unless showOlder; order due_date nullslast; limit 1000
TK_api.listScope({ clientId | projectId | assigneeEmail | parentId }, { showDone, showOlder }) -> [Task]
TK_api.get(id) -> Task|null                       // from staff_reminders, so a deleted task can still be shown and restored
TK_api.create(fields) -> Task                     // inserts into staff_reminders with staff_email = me, created_by = me, assignee default me,
                                                  // status default "todo"; visibility "shared" only when client_id or project_id is set
TK_api.update(id, patch, { baseUpdatedAt }) -> Task
      // whitelist: text, description, due_date, due_at, remind_at, start_on, priority, kind, recurrence, section, sort_key,
      //   sop_section, review_required, assignee_email, visibility, parent_id, client_id, project_id
      // with baseUpdatedAt: .eq("updated_at", base), where base is the updated_at string exactly as received from the server
      //   (never parsed into a Date, which drops microseconds). On 0 rows, call TK_api.get(id): updated_at moved -> tk_conflict;
      //   row missing or unchanged -> tk_forbidden (RLS denied). Never retry automatically.
      // compares the returned row with the patch; a field the trigger reverted -> tk_reverted with err.fields
TK_api.setStatus(id, status, note) -> status      // rpc tk_set_status { p_id, p_status, p_note, p_today: caller's local YYYY-MM-DD }
TK_api.toggleDone(task) -> status                 // = complete(task, { done: TK_isOpen(task) }).then(r => r.status)
TK_api.complete(task, { done = true }) -> { status, sentForReview:boolean, nextId:uuid|null }
      // no-op (resolves with the current status, no request) when done=true and the task is already done, or done=false and
      //   it is not done, so the server's tk_bad_transition is never hit from a double click. done=true on a ready_for_review
      //   task is sent: an admin approves it, and for anyone else the gate keeps ready_for_review (sentForReview true again).
      // nextId is null in Phase 1 (tk_set_status returns only the status); a recurring task's next row arrives through TK_sync.
      // the one completion path for every surface (TK rows, the drawer, Today's Done, the Overview checkbox, the reminders card):
      // done=true -> setStatus(id,"done"); sentForReview = (status === "ready_for_review"). done=false -> setStatus(id,"todo").
      // Raises the toast itself through TK_toast(text) (a global in TK_api.js that dispatches the existing window event
      // "mgb:toast" { text }, which ToastProvider already handles): TK_COPY.sentForReview when sentForReview, TK_COPY.approved when an admin finished a
      // ready_for_review task. When the schema is missing it falls back to staffItemsApi.toggleDone and returns sentForReview:false.
TK_api.remove(id) -> Task                         // update deleted_at = now()
TK_api.restore(id) -> Task                        // update deleted_at = null
TK_api.listChildren(parentId) -> [Task]
TK_api.listComments(taskId) / addComment(taskId, body) / editComment(id, body) / deleteComment(id)   // delete = deleted_at
TK_api.listActivity(taskId) -> [Activity]         // order created_at asc, limit 500
TK_api.listFollowers(taskId) / follow(taskId) / unfollow(taskId) / addFollower(taskId, email) / removeFollower(taskId, email)
TK_api.listAttachments(taskId)
TK_api.addLink(taskId, { url, name })
TK_api.uploadFile(task, file)    // client task: DRV_upload({file, clientId, visibility:"internal"}) then rpc tk_attach_client_file(task.id, res.file.id);
                                 // no client: storage.from("task-files").upload(TK_attachmentPath(...)) then insert kind "file"
TK_api.openAttachment(att) -> url  // file: createSignedUrl(path, 60); drive: DRV_link(client_file_id); link: att.url
TK_api.removeAttachment(id)        // update removed_at = now()
TK_api.search(q, limit) -> rows of tk_search
TK_api.listMentions(email, { sinceDays = 14 }) -> [{ comment, task }]   // tk_comments where mentions cs {me}, author != me, not deleted, newest 30
TK_api.clientPeople(clientId) / assignable({ clientId, projectId })
TK_api.listStaff() -> [Staff]      // active staff, cached for the session
TK_api.listProjects() / createProject({ name, sections, kind, client_id }) / updateProject(id, patch) / archiveProject(id)
      // createProject uses insert().select("id, …").single(); the select policy lets the creator read it back (D2).
      // 23505 (name taken among active projects in the same client or internal scope) -> code "tk_name_taken",
      // shown as TK_COPY.projectNameTaken. updateProject's whitelist: name, sections, open_to_staff, archived_at.
TK_api.listMembers(projectId) / addMember(projectId, email, role) / removeMember(projectId, email)
TK_api.clientHeader(clientId) -> { qbo:{ status }|null, driveFolderId|null, contacts:[{ name, role, active, optedOut, summary }] }
```

After every successful write, `TK_api`:
- dispatches `upsert` (or `remove`, or `commit` with the server row)
- calls `TK_sync.post(...)`
- calls `TK_sync.markOwnWrite()` and then `staffItemsApi.notify()` behind a typeof guard, so Today, the badge, the Overview card and the tab counts refresh. `TK_sync` ignores the `mgb:staff-items-changed` event that follows its own write (C5 TK_sync), so one edit never triggers a TK refetch.

`navigator.onLine === false` rejects writes with `tk_offline` before any request.

**`TK_sync.js`** (browser only)

```
TK_sync.start(email)   // idempotent; opens BroadcastChannel("mgb-tasks") when supported at once, and, once the schema is "ok",
                       // two private Supabase channels:
                       //   "tk-tasks-" + tabId : postgres_changes * on staff_reminders -> upsert payload.new (deleted_at -> remove)
                       //   "tk-core-" + tabId  : * on tk_comments, tk_activity, tk_followers, tk_attachments, task_checklist_items
                       //                         -> window event "tk:task-changed" { id: (payload.new || payload.old).task_id
                       //                            || ….reminder_id, table }, coalesced per id over 250 ms
                       //                         DELETE payloads skip RLS (D14), so a DELETE is only a refetch hint: the id is
                       //                         dispatched only when that task is already in TK_store, and nothing else is read
                       //                         (task_checklist_items also dispatches TCL_EVENT "mgb:task-checklists-changed")
                       // listens to "online"/"offline" -> dispatch online.
                       // (channel names carry the random tabId, never an email; `email` is kept only for the store's "me")
                       // ONE source of change events: while "tk-tasks-<tabId>" is SUBSCRIBED, TK_sync ignores "mgb:staff-items-changed"
                       // (the legacy staff-reminders-<email> channel and legacy writers still fire it for legacy readers). While the
                       // channel is not joined (connecting, error, offline recovery) it uses that event as a fallback: refetch loaded
                       // lists, debounced 400 ms, and never within 1 s after markOwnWrite(). Refetched rows go through the same upsert
                       // rule, so an in-flight optimistic patch is never rolled back by an older read.
TK_sync.stop()
TK_sync.markOwnWrite() // records Date.now(); see above
TK_sync.tabId          // random per-window id (crypto.randomUUID, or a Math.random fallback); not personal data
TK_sync.post(msg)      // msg: { type:"upsert", task } | { type:"remove", id } | { type:"child", id, table }
                       //    | { type:"dock", hash, to: tabId } | { type:"docked", to: tabId }
                       // stamped { v:1, from: tabId }; own messages ignored; "dock"/"docked" are acted on only by the tab named in `to`
TK_sync.on(type, fn) -> unsubscribe
TK_useStore(selector) -> value                    // React.useSyncExternalStore over TK_store
TK_useSchema() -> "unknown"|"ok"|"missing"        // triggers TK_api.probe() once
TK_useList(key, loader) -> { tasks, loading, error, reload }
TK_useTask(id) -> { task, loading, error, reload }
TK_useTaskChanged(id, fn)                         // calls fn on "tk:task-changed" for that id
```

### C6. Views slice exports and props

```
TK_StatusPill({ task, isAdmin, canEdit, onChange(status), compact }) // button + role="menu" of TK_nextStatuses; class .tk-st-<status>
TK_DuePill({ task, today })                                          // TK_dueLabel; .tk-due-late when TK_isOverdue
TK_TaskRow({ task, today, clientName, projectName, showClient=true, showAssignee=false, assigneeName,
             focused, checklist:{done,total}|null, isAdmin, canEdit, onOpen(id), onToggleDone(task), onStatus(task, status) })
  // renders <li className="tk-row" data-lk={"task:"+id} data-tk-id={id} role="row" tabIndex={focused?0:-1}>
TK_useKeys({ ids, focusedId, setFocusedId, onOpen(id), onToggleDone(id), onStatusMenu(id), onAssign(id), enabled })
  // list views pass enabled = !TK_useStore(s => s.drawerId); with the drawer open, list keys are off entirely (C8)
TK_KeysSheet({ onClose })            // ModalShell listing TK_KEYMAP
TK_SetupCard({ embedded })           // the "Tasks is being set up" state
TK_ClientHeader({ client, staffUser })
TK_Sidebar({ route, clients, isAdmin, staffUser, onNavigate(route) })
TK_MyTasks({ staffUser, clients, isAdmin, embedded=false })
TK_List({ route, staffUser, clients, isAdmin })
TK_StandaloneBar({ staffUser })
TK_App({ staffUser, clients, isAdmin, shell=false })
TK_navigate(route, { replace=false })   // pushState({ mgbNav: AN_navIndex()+1 }) + "mgb-nav" event + "tk:route" event; replace uses replaceState
TK_useRoute() -> route                  // parses location.hash; updates on hashchange, popstate, tk:route
TK_popOut(hash)                         // opens the pop-out window (Row 11.2)
TK_isTouchPrimary() -> boolean          // matchMedia("(hover: none) and (pointer: coarse)"); "phone" for the shell is this, not width alone
```

`TK_viewLogic.js` (pure, tested) holds, besides `TK_groupBySection`, `TK_sortTasks` and `TK_applyFilters`:

```
TK_POPOUT_DEFAULT = { w: 480, h: 820 }; TK_POPOUT_MIN = { w: 380, h: 520 }
TK_popOutFeatures(saved) -> "popup,width=W,height=H"     // saved {w,h} from localStorage mgb_tk_popout_v1, clamped to MIN..screen; else DEFAULT
TK_dockPlan({ hasOpener, openerClosed, openerTabId, replied, elapsedMs }) ->
    "post" | "wait" | "close" | "navigate"
    // no opener, or opener closed, or no openerTabId -> "navigate" (clear the flag, location.assign("/" + hash));
    // otherwise "post" first, then "wait" while !replied and elapsedMs < 600, "close" when replied, "navigate" at 600 ms
TK_shellLayout(width, touchPrimary) -> { compact:boolean, bottomBar:boolean, sidebar:"rail"|"sheet" }
    // width >= 900: sidebar rail; 761..899: sidebar collapses to a "Lists" sheet button in the bar; <= 760: compact rows,
    // full-window drawer. bottomBar only when touchPrimary and width <= 760.
```

`data-tour` keys for Tour and Tips: `tk-add` (the My Tasks add button), `tk-groups` (the group list), `tk-status` (the first row's status pill), `tk-popout` (the pop-out button) and `tk-sidebar`.

### C7. Drawer slice exports and props

```
TK_openTask(id, { from })        // global; dispatches "tk:open-task" { id }; falls back to LK_go({place:"work",tab:"tasks",item}) when no
                                 // host is mounted or TK_store schema is not "ok"
TK_openTaskClick(id) -> (event) => void   // row and link click handler: returns early (browser default) unless a plain left click
                                          // (button 0, no meta/ctrl/shift/alt, not defaultPrevented); then preventDefault + TK_openTask(id).
                                          // Used with href = LK_href({place:"tasks", tab:"my", item:"task:"+id}) so middle-click and
                                          // modifier-click still open a new tab.
TK_DrawerHost({ staffUser, clients, isAdmin, canManageTemplates, canCreateTemplates, onOpenTemplates })
  // on open: dispatch {type:"drawer", id} and window event "tk:drawer-open"; on close: {type:"drawer", id:null}
TK_Drawer({ taskId, onClose, ...same props })
TK_Comments({ task, staffUser, staff, canComment })
TK_Activity({ taskId, nameOf(email) })
TK_Attachments({ task, canEdit })
TK_QuickAddHost({ staffUser, clients, currentClientId })   // sets window.TK_quickAddReady = true while mounted; binds the global `q` (C8)
  // currentClientId: App passes the id of the client whose page is open (the same client object TopBar receives, i.e. the
  // client parsed from the current #/client/<id>/… hash, as TB_clientHash builds it), else null. Event detail wins over it.
TK_QuickAddDialog({ initial, staffUser, clients, onClose, onCreated(task, { open }) })
```

`TK_drawerLogic.js` (pure, tested):

```
TK_EDITABLE_FIELDS                         // the same whitelist as TK_api.update
TK_buildPatch(original, draft) -> patch    // only changed whitelisted fields; "" -> null for dates and description
TK_validateDraft(draft) -> { field: message }   // text 1..500, description <= 5000, start_on <= due_date, recurrence needs due_date
TK_mergeTimeline(comments, activity) -> [{ type:"comment"|"activity", at, item }]  // ascending; deleted comments become "Comment deleted"
TK_activityText(entry, { nameOf, statusLabel }) -> string   // "Moved to In progress", "Assigned to <name>", "Due date set to Oct 14", "Approved", "Sent back", "Deleted", "Restored", "Moved to another list", "Created"
TK_mentionMatches(query, staff, limit=6) -> [Staff]   // handle or name prefix, active only
TK_insertMention(body, caret, handle) -> { body, caret }
TK_validateAttachment(fileOrLink) -> null|message     // file: size <= 25 MB, mime in TK_ATTACH_MIMES; link: https only, length <= 2000
TK_ATTACH_MIMES = ["application/pdf","image/png","image/jpeg","image/gif","image/webp","text/csv","text/plain",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","application/vnd.openxmlformats-officedocument.wordprocessingml.document"]
TK_attachmentPath(taskId, uuid, fileName) -> "<taskId>/<uuid>-<safe>"  // safe = [A-Za-z0-9._-], other characters -> "-", max 100 characters, keeps the extension
TK_quickAddDefaults(detail, { me, currentClientId }) -> { client_id, project_id, section, kind, visibility, text, due_date }
```

### C8. Events, globals, storage, channels and keys

| name | kind | detail | fired by | handled by |
|---|---|---|---|---|
| `tk:open-task` | window CustomEvent | `{ id }` | `TK_openTask` | `TK_DrawerHost` |
| `tk:quick-add` | window CustomEvent | `{ client_id?, project_id?, section?, text?, due_date?, kind? }` | TopBar, Today, TK views, `q` | `TK_QuickAddHost` |
| `tb:quick-add` | existing | `{ kind:"task"\|"note"\|"request"\|"message" }` | TB_QuickAdd | `TK_QuickAddHost` takes `task`; `StaffQuickActions` skips `task` when `window.TK_quickAddReady === true` |
| `tk:task-changed` | window CustomEvent | `{ id, table }` | `TK_sync` | drawer sections, row counts |
| `tk:drawer-open` | window CustomEvent | `{ id }` | `TK_DrawerHost` on open | `SI_ChatDrawer` and `WD_WidgetDrawer` close themselves (integration, drawer stack rule below) |
| `mgb:toast` | existing | `{ text }` | `TK_toast` | ToastProvider |
| `tk:route` | window Event | none | `TK_navigate` | `TK_useRoute` |
| `mgb:staff-items-changed` | existing | none | `staffItemsApi.notify` | legacy callers and `TK_sync` |
| `window.TK_quickAddReady` | global flag | boolean | `TK_QuickAddHost` | `StaffQuickActions` |
| `window.MGB_SHELL` | global | `"tasks"` or undefined | the index.html boot script | app.jsx shell gating |
| `sessionStorage.mgb_shell_v1` | per-tab | `"tasks"` | boot script; cleared on dock | boot script |
| `localStorage.mgb_tk_groups_v1` | per-viewer | `{ overdue:bool, ... }` collapsed groups | TK_MyTasks | TK_MyTasks |
| `localStorage.mgb_tk_view_v1` | per-viewer | `{ todayGroup:bool, showDone:bool }` | TK_MyTasks | TK_MyTasks |
| `localStorage.mgb_tk_sort_v1` | per-viewer | `{ [listKey]: { col, dir } }` | TK_List | TK_List |
| `localStorage.mgb_tk_popout_v1` | per-viewer | `{ w, h }` last pop-out size | TK_StandaloneBar (resize, debounced 500 ms, only when `window.opener`) | `TK_popOutFeatures` |
| `sessionStorage.mygoodbooks_pending_route_v1` | existing | the raw hash before sign-in | app.jsx boot stash | App restores a TK hash verbatim (11.1) |
| BroadcastChannel `mgb-tasks` | cross-window | C5 messages | `TK_sync` | `TK_sync` |
| channel `tk-tasks-<tabId>` | Supabase private | staff_reminders changes | `TK_sync` | store |
| channel `tk-core-<tabId>` | Supabase private | child-table changes | `TK_sync` | events |

Every localStorage and sessionStorage access sits in try/catch.

`TK_KEYMAP` (rendered by `TK_KeysSheet` and by the Settings shortcuts card):

| key | label | scope |
|---|---|---|
| `j` | Next task | list |
| `k` | Previous task | list |
| `Enter` | Open task | list |
| `x` | Mark done or not done | list, drawer |
| `s` | Change status | list, drawer |
| `a` | Assign | list, drawer |
| `q` | Add a task | global (every staff page) |
| `Esc` | Close details | drawer |
| `?` | Show these shortcuts | list, drawer |

**Scopes.** `global` is bound once by `TK_QuickAddHost` (window, bubble phase) for a signed-in staff user who is not impersonating, on every staff page including the shell. `list` keys are bound by `TK_useKeys` in TK_MyTasks, TK_List and the search view, and only while `enabled` is true; list views pass `enabled = !drawerId`, so with the drawer open no list key fires. `drawer` keys are bound by `TK_Drawer` while it is open. The drawer root carries `data-tk-keyscope="drawer"`, and `TK_shouldHandleKey(e, { scope })` double-checks it: scope `"list"` rejects targets inside the drawer, scope `"drawer"` rejects targets outside it (except `document.body`). One key press therefore reaches exactly one handler.

`TK_shouldHandleKey` returns false when any of these hold:
- a Ctrl, Meta or Alt modifier is down (Shift is allowed, for `?`)
- `isComposing`, or keyCode 229
- `defaultPrevented`
- the target or `document.activeElement` is an input, textarea, select, contenteditable or `[role=textbox]`, or sits inside `.tb-search` (the ⌘K box)
- `ctx.modalOpen` (a `.modal-overlay` exists)
- `ctx.menuOpen` (a visible `[role=menu]`, or the TopBar search is open)
- `ctx.tourOpen` (a `.tour-root` exists)
- the scope check above fails

List and global handlers register on `window` in the bubble phase (never capture), so the capture-phase traps in ModalShell, WidgetDrawer and Tour win. Nothing binds Ctrl/⌘+K, arrows or Tab, except the drawer's own Tab trap below.

**Drawer stack rule.** Only one side drawer is open at a time.
- Opening `TK_Drawer` dispatches `tk:drawer-open`. Integration adds a listener to `SI_ChatDrawer` (`components/inbox/StaffInbox.jsx`, around 1830) and `WD_WidgetDrawer` (`components/dashboard/WidgetDrawer.jsx`, around 719) that closes them on that event. Their focus traps then never fight the TK trap.
- The TK drawer's Esc and Tab handler registers on `document` in the **capture** phase (the one capture handler in TK). It acts only when the drawer is the top layer: no `.modal-overlay`, no open `[role=menu]` inside the drawer, and no `.tour-root`. When it handles Esc it calls `preventDefault()` and `stopPropagation()`, so the bubble-phase Esc handlers in StaffInbox (document) and Tips (`components/tour/Tips.jsx` 1009, window) never see that press. One Esc closes one layer.
- A ModalShell opened from the drawer (the confirm, the one task modal) sits above it and handles its own Esc first, because the drawer handler stands down while a `.modal-overlay` exists.

**Layers (z-index).** Existing: widget drawer 650 (1000 as a phone sheet), top bar 700, phone bars 1400 to 1600, tips 1550, phone nav drawer 1700, SI chat drawer 1800, pro reports overlay 1900, modals 2000, toast stack 2100, tour 9000. The TK drawer and its scrim use **1850** (scrim 1849) on every width, including the phone full-screen sheet: above the SI drawer and the phone bars, below modals and toasts, so "Sent for review" and undo toasts show over an open drawer. The shell bottom bar (N.4) uses 1450. These numbers live as `--tk-z-drawer: 1850` and `--tk-z-bar: 1450` at the top of `tk-drawer.css` and `tk-views.css`.

### C9. What integration changes in existing code (contract for the modules)

The modules may rely on all of the following after integration:

1. `staffItemsApi` (app.jsx):
   - Gets a separate `tkCols` flag (true until a missing-column error).
   - `list(supabase, email)` adds `assignee_email.eq."<email>"` to its `.or()`, adds `.is("deleted_at", null)`, and selects the extra fields `status, deleted_at, project_id, section, review_required, updated_at`. When the error is a missing column, it sets `tkCols = false` and retries the current v2 query unchanged. It never sets `legacy` because of a TK column.
   - `add` passes through `status, project_id, section, description, start_on, sop_section, review_required, parent_id` when `tkCols`.
   - `remove(supabase, id)` becomes `update({ deleted_at: new Date().toISOString() })` when `tkCols`, and stays a hard delete only before the migration.
   - `normalizeStaffItem` defaults `status` from `done` and `deleted_at` to null.
2. `isMyStaffItem` → `TK_isMine` when defined. `countDueStaffItems` uses `TK_isOverdue`, and `TK_isOpen` instead of `!t.done`.
3. Globals the modules can call at render time: `ModalShell`, `useToast`, `LK_go`, `LK_href`, `LK_useArrival`, `LK_toast`, `LK_COPY`, `TCL_Checklist`, `TCL_useCounts`, `TCL_fetchTexts`, `TT_draftFromTask`, `TT_openDraft`, `TT_suggestFromTask`, `TT_TemplateIcon`, `DRV_upload`, `DRV_link`, `DRV_status`, `DRV_NOT_CONNECTED_MSG`, `ClientSopView`, `CLIENT_SOP_SECTIONS`, `staffItemsApi`, `AN_navIndex`, `NAV_go`, `MGB_track`.
4. `ClientSopView({ client, readOnly, onEditInMyTasks, section })`: integration adds the optional `section` prop, which shows only that section.
5. App mounts `<TK_DrawerHost …/>` and `<TK_QuickAddHost …/>` once, inside ToastProvider, when a staff user is signed in and not impersonating. It calls `TK_sync.start(email)` in an effect and dispatches `{type:"me", email}`.
6. Page `"tasks"` renders `<TK_App staffUser clients isAdmin shell={window.MGB_SHELL === "tasks"} />`. The Work tab `tasks` renders `<TK_MyTasks embedded …/>`, or legacy `MyTasksPage` when `TK_useSchema()` is `"missing"` or `TK_MyTasks` is undefined. The Work tab `notes` renders `<MyTasksPage mode="notes" …/>` (11.5, "#/work/notes").
7. **LK target shape for Tasks** (`components/staff/DeepLink.jsx`):
   - `LK_href` gains `sub` for non-client places: `path += "/" + encodeURIComponent(String(t.sub))` when `t.tab && t.sub`. So `LK_href({ place:"tasks", tab:"c", sub:"Ab/c" })` is `"#/tasks/c/Ab%2Fc"`, and `LK_href({ place:"tasks", tab:"p", sub:<uuid> })` is `"#/tasks/p/<uuid>"`. Every other existing call is unchanged (none passes `sub` without `clientId` today).
   - `LK_parsePath` keeps the case of `tab` and `sub` when `place === "tasks"` (client ids are case-sensitive). Other places keep lowercasing.
   - The canonical TK targets are: My Tasks `{place:"tasks", tab:"my"}`, a client list `{place:"tasks", tab:"c", sub:clientId}`, a project `{place:"tasks", tab:"p", sub:projectId}`, a task `{place:"tasks", tab:"my", item:"task:"+id}`. Modules and integration use only these.
   - `LK_go` forwards: when `t.place === "work" && t.tab === "tasks"` and `t.item` starts with `task:`, and `typeof TK_openTask === "function"` and `TK_store.getState().schema === "ok"` and `window.TK_drawerHostReady === true`, it calls `TK_openTask(id)` instead of navigating. A missed legacy call site still opens the new drawer. No loop: `TK_openTask` only calls `LK_go` when the schema is not `"ok"`.
8. `TK_DrawerHost` sets `window.TK_drawerHostReady = true` while mounted.
9. Every legacy completion and overdue path uses `TK_api.complete`, `TK_isOpen`, `TK_isOverdue` and `TK_effectiveStatus` once the schema is ok (3.1, call-site table in 11.5).
10. Every other client-side read of `staff_reminders` hides deleted rows: `TeamPage.jsx` ~890 adds `.is("deleted_at", null)` and, on `staffItemsApi.isMissingColumnError`, retries without it (its existing retry pattern). `rg -n 'from\("staff_reminders"\)' app.jsx components` lists each read, and each one either filters `deleted_at` or reads by id.

### C10. Fixed strings

- `window.MGB_VERSION = { label: "2026-10-11a", note: "Tasks: My Tasks, task details, projects and its own window" };`
- `PAGE_META.tasks = { title: "Tasks", subtitle: "Your tasks, client lists and projects" }`
- `USAGE_TAB_LABELS.tasks = "Tasks"`
- `USAGE_ACTION_LABELS` additions:
  - `"tasks-drawer": "Task details opened"`
  - `"tasks-quick-add": "Tasks added with quick add"`
  - `"tasks-search": "Task searches"`
  - `"tasks-shortcut": "Task keyboard shortcuts used"`
  - `"tasks-popout": "Tasks opened in its own window"`
  - `"tasks-dock": "Tasks docked back in the portal"`
- `TB_HELP_FOR_PAGE.tasks = "my-tasks"`
- `ST_BELL_PREFS` new row: `{ key: "mentions", prefix: "tkm:", label: "Mentions on tasks" }`. It defaults to on, like the other rows.
- StaffNav Work tab: `{ key: "notes", label: "Notes & SOPs", help: "notes" }`
- `TK_COPY`:
  - `setupTitle: "Tasks is being set up"`
  - `setupBody: "Your tasks are safe. This page fills in as soon as the update is finished. Until then, use Work › Tasks."`
  - `offline: "You're offline. Showing what was already loaded. Changes are paused until you're back online."`
  - `loadError: "Couldn't load your tasks."`
  - `retry: "Try again"`
  - `saveError: "Couldn't save that change. Try again."`
  - `conflict: "Someone else just changed this task. Showing the latest."`
  - `reverted: "Only the task's owner or an admin can change that."`
  - `sentForReview: "Sent for review. An admin will approve it."`
  - `approved: "Approved."`
  - `deleted: "Task deleted."`
  - `restored: "Task restored."`
  - `emptyMine: "Nothing assigned to you. Press q or Add task to start one."`
  - `emptyMineTouch: "Nothing assigned to you. Tap Add task to start one."`
  - `emptyList: "No tasks here yet."`
  - `emptySearch: "No tasks match that."`
  - `popupBlocked: "Your browser blocked the new window. Allow pop-ups for this site and try again."`
  - `personAdminOnly: "Only admins can see another person's list."`
  - `notFound: "We couldn't find that list."`
  - `deletedBanner: "This task was deleted."`
  - `noClientAccess: "They can't see this client yet, so they won't see this task."`
  - `driveOff: "File storage isn't connected yet. Add a link instead."`
  - `linkCopied: "Link copied."`
  - `projectNameTaken: "There's already a project with that name. Try another name."`
  - `openToStaff: "Open to all staff"`
  - `openToStaffHelp: "Everyone on staff can see this project and add tasks to it."`
  - `taskAdded: "Task added."`

### C11. Docs-owned guide files

The docs slice may edit these:
- `docs/staff-guide/my-tasks.md`
- `work-page.md`
- `home-page.md`
- `top-bar.md`
- `quick-actions.md`
- `notes.md`
- `client-sops.md`
- `client-overview.md`
- `staff-settings.md`
- `task-templates.md`
- `whats-new.md`

It may create these:
- `docs/staff-guide/task-details.md`
- `docs/staff-guide/task-lists-and-projects.md`
- `docs/staff-guide/tasks-own-window.md`

---

## Part D. Database: `supabase/tasks-module-v1.sql`

General rules for the file:
- Safe to re-run: `add column if not exists`, `create table if not exists`, `create or replace function`, `drop policy if exists` then `create policy`, `drop trigger if exists` then `create trigger`, and constraints added in guarded `do` blocks.
- No `begin` or `commit`. No `drop table`, `drop column`, `truncate`, or `delete` of existing rows. No `create index concurrently`.
- New CHECKs on existing tables are added `not valid` and then `validate`d (a new rule for this repo; say so in the header comment).
- Every function has `set search_path = public`, `revoke all on function … from public, anon`, and an explicit `grant execute … to authenticated` only where C3 says so.
- Every new table has `alter table … enable row level security` and exact grants. The live `pg_default_acl` gives anon and authenticated every table privilege (`arwdDxtm`) on new tables and views, `rwU` on new sequences and EXECUTE on new functions. So for **every** new table and view the file runs `revoke all on public.<t> from anon, authenticated;` first and then grants exactly what D2, D8 and D11 list. The same goes for the `tk_activity_id_seq` sequence (`revoke all … from anon, authenticated`; no grant, since only the definer trigger inserts). Functions: `revoke all … from public, anon` always, then the C3 grant.
- The header comment lists every non-additive change with its data-preservation note. There are five:
  - the `staff_reminders_shared_needs_client` CHECK is replaced by a strictly wider one
  - `staff_reminders_before_write` is rewritten with every live branch kept (D6)
  - `complete_staff_item` and five reader functions get `create or replace` with the same signatures (D10, D13)
  - `notify_enqueue_task_assigned` gets `create or replace` with one added early return for soft-deleted rows (D13)
  - a new BEFORE DELETE trigger on `staff_reminders` turns deletes into soft deletes (D9). It removes nothing; it keeps rows that a delete would have removed.

Sections, in this order:

**D1. New columns on `staff_reminders`:**

```sql
alter table public.staff_reminders
  add column if not exists status text not null default 'todo',
  add column if not exists status_changed_at timestamptz,
  add column if not exists status_changed_by text,
  add column if not exists status_before_wait text,
  add column if not exists waiting_since timestamptz,
  add column if not exists waiting_minutes integer not null default 0,
  add column if not exists description text,
  add column if not exists start_on date,
  add column if not exists section text,
  add column if not exists sort_key numeric,
  add column if not exists parent_id uuid references public.staff_reminders(id) on delete set null,
  add column if not exists sop_section text,
  add column if not exists review_required boolean not null default false,
  add column if not exists series_id uuid,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by text;
-- project_id is added in D3, after tk_projects exists.
```

Guarded CHECKs (`not valid` then `validate`):
- `staff_reminders_status_check`: `status in ('todo','in_progress','waiting_client','ready_for_review','done')`
- `staff_reminders_status_before_wait_check`: null or in the same list without `done`
- `staff_reminders_sop_section_check`: null or in the 7 TK_SOP_SECTION_IDS
- `staff_reminders_description_len`: null or `char_length <= 5000`
- `staff_reminders_section_len`: null or 1..60

**D2. `tk_projects` and `tk_project_members`:**

```sql
create table if not exists public.tk_projects (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  kind text not null default 'internal' check (kind in ('internal','onboarding')),
  client_id text references public.clients(id) on update cascade,
  owner_email text,
  open_to_staff boolean not null default false,
  sections text[] not null default '{}' check (cardinality(sections) <= 30),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tk_projects_client_kind check ((kind = 'onboarding') = (client_id is not null))
);
create unique index if not exists tk_projects_name_uniq on public.tk_projects (coalesce(client_id, ''), lower(name)) where archived_at is null;
-- per client (onboarding) or per the internal scope (client_id null), so two clients can each have "Onboarding"

create table if not exists public.tk_project_members (
  project_id uuid not null references public.tk_projects(id) on delete cascade,
  staff_email text not null references public.staff(email) on update cascade on delete cascade
    check (staff_email = lower(staff_email)),
  role text not null default 'member' check (role in ('member','owner')),
  added_by text,
  added_at timestamptz not null default now(),
  primary key (project_id, staff_email)
);
create index if not exists tk_project_members_email_idx on public.tk_project_members (staff_email);
```

Functions:
- `tk_is_project_member(p)`: `is_active_staff()` and (exists a member whose `staff_email = lower(jwt email)`, or the project's `open_to_staff` is true). "Member" everywhere below means this function, so an open project behaves as if every active staff member were a member, for reading, adding tasks and editing shared tasks.
- `tk_can_see_project(p)`: `is_active_staff()` and (`is_active_staff_admin()`, or the project's `owner_email = lower(jwt)`, or `tk_is_project_member(p)`, or the project's `client_id` is not null and `can_access_client(client_id)`).
- `tk_can_manage_project(p)`: `is_active_staff()` and (admin, or the project's `owner_email = lower(jwt)`, or a member row with role `owner`). `open_to_staff` never grants manage.
- `tk_project_info(p)`: `found = false` unless `is_active_staff()`; else found, client_id and `archived_at is not null`. It stays granted to authenticated, because the invoker trigger in D6 calls it as the caller.

Triggers on `tk_projects`:
- BEFORE INSERT (definer): `updated_at := now()`. When the caller is not `is_active_staff_admin()`, force `owner_email := nullif(lower(jwt email), '')` and `open_to_staff := false`, whatever the client sent. Admins may set `owner_email` (lowercased) and `open_to_staff`; an admin insert with no owner_email gets `lower(jwt)`.
- BEFORE UPDATE (invoker): pin `id` and `created_at`. Pin `kind`, `client_id` and `owner_email` unless `is_active_staff_admin()`. Set `updated_at := now()`.
- AFTER INSERT (definer): when a jwt email exists, insert the creator as role `owner`, using `select s.email from staff s where lower(s.email) = lower(jwt) and s.active and s.email = lower(s.email)`, on conflict do nothing.

Why the owner rule sits in the select policy itself: `TK_api.createProject` uses `insert … returning` (`.select()`), and Postgres checks the SELECT policy against the new row before AFTER triggers run and before a definer function's snapshot can see the row. The creator's member row and a `tk_can_see_project(id)` lookup are both invisible at that moment. The column test `owner_email = lower(jwt)` reads the new row directly, so it passes.

Policies on `tk_projects`:
- select `owner_email = lower(coalesce(auth.jwt() ->> 'email','')) or public.tk_can_see_project(id)`
- insert with check `is_active_staff() and (kind = 'internal' or can_access_client(client_id))`
- update using and with check `tk_can_manage_project(id)`
- no delete policy

Policies on `tk_project_members`:
- select `tk_can_see_project(project_id)`
- insert with check `tk_can_manage_project(project_id)`
- update using `tk_can_manage_project(project_id)`
- delete using `tk_can_manage_project(project_id) or staff_email = lower(jwt email)`

Membership rows are relationships, not records, so they may be deleted. A BEFORE INSERT trigger on members lowercases `staff_email`, stamps `added_by` from the jwt, and raises `22023 tk_member_inactive` unless the staff row is active.

Grants, after `revoke all … from anon, authenticated` on both tables: `select, insert, update` on `tk_projects`, and `select, insert, update, delete` on `tk_project_members`, to authenticated. Nothing to anon.

Seed, idempotent: insert internal projects named `SOPs`, `Directors`, `Owners` and `90 Day`, each only when no row with that lower(name) and a null client_id exists, with no owner and no member rows. `SOPs` and `90 Day` get `open_to_staff = true`; `Directors` and `Owners` get `false`. Directors and Owners need no member rows, because admins read and edit everything and bookkeepers are kept out by the absence of membership (D5). The seed never changes `open_to_staff` on a row that already exists, so the owner's later choice survives a re-run.

**D3. `staff_reminders.project_id`, plus the CHECK swap:**

```sql
alter table public.staff_reminders add column if not exists project_id uuid references public.tk_projects(id) on delete set null;
-- replace shared_needs_client with a strictly wider rule (every existing row still passes):
alter table public.staff_reminders drop constraint if exists staff_reminders_shared_needs_client;
alter table public.staff_reminders add constraint staff_reminders_shared_needs_client
  check (visibility = 'private' or client_id is not null or project_id is not null) not valid;
alter table public.staff_reminders validate constraint staff_reminders_shared_needs_client;
```

The drop and re-add run inside a guarded `do` block, which skips when `pg_get_constraintdef` already mentions `project_id`.

**D4. Indexes on `staff_reminders`:**
- `staff_reminders_tk_assignee_idx (assignee_email, done, due_date) where deleted_at is null`. Plain column, not `lower()`: the trigger and the backfill keep `assignee_email` lowercase, and `TK_api.listMine` filters `assignee_email.eq.<me>`, which can use it.
- `staff_reminders_tk_project_idx (project_id) where project_id is not null`
- `staff_reminders_tk_parent_idx (parent_id) where parent_id is not null`
- `staff_reminders_tk_updated_idx (updated_at)`
- the search column and its index:
  ```sql
  alter table public.staff_reminders add column if not exists search_tsv tsvector generated always as
    (setweight(to_tsvector('english', coalesce("text", '')), 'A') || setweight(to_tsvector('english', coalesce(description, '')), 'B')) stored;
  create index if not exists staff_reminders_tk_search_idx on public.staff_reminders using gin (search_tsv);
  ```
  It is modeled on `staff_guide.search_tsv`. The title column is `"text"`, so it is quoted.

**D5. Access helpers.** All are `language plpgsql stable security definer set search_path = public`, and the email is always `v_me := lower(coalesce(auth.jwt() ->> 'email',''))`.

```
tk_staff_has_client(p_email, p_client):           -- internal mirror of can_access_client for any email
  copy the live can_access_client body (read it with pg_get_functiondef first) and replace every jwt-email
  compare with lower(...) = lower(p_email); admin = exists(staff where lower(email)=lower(p_email) and active and role='admin').
tk_task_scope_ok(p_task, p_email):                -- "could this person reach the task's container?"
  active staff p_email required; true if owner, or admin;
  client_id not null -> tk_staff_has_client(p_email, client_id);
  else project_id not null -> a member row for p_email (any role), or the project is open_to_staff;
  else true (a task with no client and no project: an editor chooses to share it through tk_add_follower;
  mentions by a non-editor never add followers, D8, so this branch cannot be used to open a private task).
tk_row_readable(p_id, p_owner, p_assignee, p_client, p_project, p_visibility):
  if v_me = '' then false; if lower(p_owner) = v_me then true; if not is_active_staff() then false;
  if is_active_staff_admin() then true;
  v_inv := lower(coalesce(p_assignee,'')) = v_me or exists(tk_followers where task_id = p_id and staff_email = v_me);
  if p_client is not null then return can_access_client(p_client) and (p_visibility = 'shared' or v_inv);
  if p_project is not null then return tk_is_project_member(p_project) and (p_visibility = 'shared' or v_inv);
  return v_inv;
tk_can_read_task(p_id):  select the row; not found -> false; deleted rows still follow the same rule;
  return tk_row_readable(...).
tk_can_edit_task(p_id):  select the row; v_me = '' -> false; owner -> true; not is_active_staff() -> false; admin -> true;
  assignee and tk_row_readable(...) -> true;
  visibility = 'shared' and client_id not null and can_access_client(client_id) -> true;
  visibility = 'shared' and client_id is null and project_id not null and tk_is_project_member(project_id) -> true;
  else false.   (Followers can read and comment, not edit.)
tk_path_task_id(p_name): immutable, not definer; split_part(p_name,'/',1) when it matches the uuid regex, cast to uuid; else null.
tk_schema_version(): immutable sql, returns 1.
```

Grants:
- `tk_staff_has_client`, `tk_task_scope_ok` and `tk_parse_mentions`: revoke from public, anon and authenticated. Definer triggers and functions call them.
- All the others: grant execute to authenticated.

**D6. Rewrite `staff_reminders_before_write`.** Start from the live body: run `select pg_get_functiondef('public.staff_reminders_before_write'::regproc)` read-only and paste it. Keep it invoker, with `set search_path = public`.

**The live shape matters.** Read on 2026-10-11, the live body is:
```
if tg_op = 'INSERT' then
  <assignee coalesce>; <created_by coalesce>; <access-request sniff>; <INSERT due_date/due_at sync>;
  return new;                                   -- early return: nothing after this runs on INSERT
end if;
<non-owner revert of staff_email, created_by, client_id, visibility, unless mgb.offboarding = 'on'>   -- UPDATE only by position
<UPDATE due_date/due_at sync>
return new;
```
Adding the tk blocks "before the final return" would put them on the UPDATE path only, and an INSERT would skip lowercasing, the created_by stamp, the project check, the done/status mapping, the review gate and the stamps. So **restructure** it like this, keeping every live statement's text verbatim:

```sql
declare
  v_caller text := coalesce(auth.jwt() ->> 'email', '');   -- live declaration, unchanged; the live revert keeps using it as is
  v_me text; v_bypass boolean; v_admin boolean; v_roll boolean; v_p record;
begin
  if tg_op = 'INSERT' then
    -- live: assignee coalesce, created_by coalesce, access-request sniff, INSERT due sync (verbatim)
    -- the live "return new;" here is REMOVED
  end if;

  if tg_op = 'UPDATE' then
    -- live: non-owner revert (verbatim, still compares v_caller as live does)
    -- live: UPDATE due sync (verbatim)
  end if;

  -- tk v1 blocks 1 to 5 below, run for BOTH operations
  return new;
end;
```

The tk v1 blocks, in this order:

```sql
-- tk v1 --------------------------------------------------------------
v_me      := lower(coalesce(auth.jwt() ->> 'email', ''));
v_bypass  := coalesce(current_setting('mgb.offboarding', true),'') = 'on'
          or coalesce(current_setting('mgb.tk_migrate', true),'') = 'on';
          -- mgb.tk_rpc is NOT a bypass here; it only matters to the tk_comments and tk_attachments triggers
v_admin   := v_me <> '' and public.is_active_staff_admin();
v_roll    := tg_op = 'INSERT' and coalesce(current_setting('mgb.tk_rollforward', true),'') = 'on';
          -- set by complete_staff_item around its next-occurrence insert only (D10)

-- 1. emails and created_by (both operations)
new.assignee_email := lower(nullif(btrim(new.assignee_email), ''));
if tg_op = 'INSERT' then
  new.assignee_email := coalesce(new.assignee_email, lower(new.staff_email));
  if v_me <> '' and v_me = lower(new.staff_email) and public.is_active_staff() then
    new.created_by := v_me;              -- otherwise the live coalesce stands (template cron, access requests, roll-forward)
  end if;
end if;

-- 2. non-owner pins (UPDATE; next to the live revert; admins may reassign and move)
if tg_op = 'UPDATE' and v_me <> '' and v_me <> lower(old.staff_email) and not v_bypass and not v_admin then
  new.assignee_email := old.assignee_email;
  new.project_id     := old.project_id;
  new.parent_id      := old.parent_id;
end if;
if tg_op = 'UPDATE' and old.review_required and not new.review_required and not (v_admin or v_bypass) then
  new.review_required := true;           -- only admins switch the review gate off
end if;

-- 3. project sync (both operations; tk_project_info is definer, so a non-member's lookup still works)
if new.project_id is not null then
  select * into v_p from public.tk_project_info(new.project_id);
  if not v_p.found then raise exception 'tk_project_missing' using errcode = '23503'; end if;
  if (tg_op = 'INSERT' or new.project_id is distinct from old.project_id)
     and v_me <> '' and not v_bypass and not v_admin and not v_roll and v_p.client_id is null
     and not public.tk_is_project_member(new.project_id) then
    raise exception 'tk_not_project_member' using errcode = '42501';
  end if;
  if v_p.client_id is not null then new.client_id := v_p.client_id; end if;
end if;

-- 4. status <-> done (both operations)
if tg_op = 'INSERT' then
  if new.done then new.status := 'done'; end if;
elsif new.status is not distinct from old.status and new.done is distinct from old.done then
  new.status := case when new.done then 'done' when old.status = 'done' then 'todo' else old.status end;
end if;
if new.status = 'done' and (tg_op = 'INSERT' or old.status <> 'done')
   and new.review_required and v_me <> '' and not (v_admin or v_bypass) then
  new.status := 'ready_for_review';      -- review gate: legacy done=true writes divert too; admins approve through v_admin
end if;
if tg_op = 'UPDATE' and new.status is distinct from old.status
   and old.status = 'done' and new.status in ('waiting_client','ready_for_review') then
  raise exception 'tk_bad_transition' using errcode = '22023';
end if;
new.done := (new.status = 'done');       -- ready_for_review never syncs done=true
if new.done and (tg_op = 'INSERT' or not old.done) then new.completed_at := coalesce(new.completed_at, now());
elsif new.done then new.completed_at := old.completed_at;   -- UPDATE where both stay done keeps the original time
else new.completed_at := null; end if;

-- 5. waiting bookkeeping, status stamps, server-owned columns (both operations)
if tg_op = 'UPDATE' then
  new.waiting_minutes := old.waiting_minutes; new.waiting_since := old.waiting_since;
  new.status_before_wait := old.status_before_wait; new.series_id := coalesce(old.series_id, new.series_id);
  new.status_changed_at := old.status_changed_at; new.status_changed_by := old.status_changed_by;
  new.deleted_by := old.deleted_by; new.created_at := old.created_at;
else
  new.waiting_minutes := 0; new.waiting_since := null; new.status_before_wait := null; new.deleted_by := null;
end if;
if new.status = 'waiting_client' and (tg_op = 'INSERT' or old.status <> 'waiting_client') then
  new.status_before_wait := case when tg_op = 'INSERT' then 'todo' else old.status end;
  new.waiting_since := now();
elsif tg_op = 'UPDATE' and old.status = 'waiting_client' and new.status <> 'waiting_client' then
  new.waiting_minutes := coalesce(old.waiting_minutes,0)
    + greatest(0, floor(extract(epoch from now() - coalesce(old.waiting_since, now())) / 60))::int;
  new.waiting_since := null;
end if;
if tg_op = 'INSERT' or new.status is distinct from old.status then
  new.status_changed_at := now(); new.status_changed_by := nullif(v_me, '');
end if;
if tg_op = 'UPDATE' then new.updated_at := now(); end if;
if tg_op = 'UPDATE' and new.deleted_at is not null and old.deleted_at is null then new.deleted_by := nullif(v_me,'');
elsif tg_op = 'UPDATE' and new.deleted_at is null then new.deleted_by := null; end if;
```

Notes for the engineer:
- Keep the live `v_caller` declaration and every live comparison exactly as they are (the live revert compares `v_caller` without lowercasing; do not change it). The new blocks use `v_me`, which is lowercased.
- The only edits to live statements are: the INSERT branch loses its `return new;`, and the live revert and UPDATE due sync are wrapped in `if tg_op = 'UPDATE' then … end if;` (they were UPDATE-only by position before; now explicitly). The INSERT due sync stays inside the INSERT branch.
- Mark every new or moved line `-- tk v1`.
- The trigger stays `BEFORE INSERT OR UPDATE … FOR EACH ROW`. Do not recreate the trigger unless it is missing.
- `mgb.*` flags are always transaction-local, `set_config(name, 'on', true)`, and every function that sets one resets it to `''` (`set_config(name, '', true)`) right after the write it guards, so a flag never outlives that one statement. `mgb.tk_approve` is gone: the review gate already lets admins through with `v_admin`, which reads the caller's jwt even inside definer RPCs.

**D7. Backfill.** One `do` block:
- `perform set_config('mgb.tk_migrate','on',true)`
- `update staff_reminders set status = 'done' where done and status <> 'done'`
- `update staff_reminders set assignee_email = lower(assignee_email) where assignee_email <> lower(assignee_email)`
- insert the owner and assignee of every row into `tk_followers` (after D8 creates the table, so place this block after D8), matched through `staff s where s.active and s.email = lower(s.email) and lower(s.email) in (...)`, on conflict do nothing. A staff row stored in mixed case (0 live today) is skipped rather than failing the lowercase CHECK.
- `perform set_config('mgb.tk_migrate','',true)`

Nothing is deleted.

**D8. Child tables.**

```sql
create table if not exists public.tk_followers (
  task_id uuid not null references public.staff_reminders(id) on delete cascade,
  staff_email text not null references public.staff(email) on update cascade on delete cascade check (staff_email = lower(staff_email)),
  added_by text, added_at timestamptz not null default now(),
  primary key (task_id, staff_email));
create index if not exists tk_followers_email_idx on public.tk_followers (staff_email);

create table if not exists public.tk_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.staff_reminders(id) on delete cascade,
  author_email text not null,
  body text not null check (char_length(btrim(body)) between 1 and 5000),
  mentions text[] not null default '{}',
  kind text not null default 'comment' check (kind in ('comment','send_back','client_reply','system')),
  created_at timestamptz not null default now(), edited_at timestamptz, deleted_at timestamptz, deleted_by text,
  tsv tsvector generated always as (to_tsvector('english', coalesce(body,''))) stored);
-- indexes: (task_id, created_at), gin(mentions), gin(tsv)

create table if not exists public.tk_activity (
  id bigserial primary key,
  task_id uuid not null references public.staff_reminders(id) on delete cascade,
  actor_email text not null,
  kind text not null check (kind in ('created','status','assignee','due','priority','section','comment','review_approved',
    'review_sent_back','client_asked','client_answered','reassigned_ooo','imported','deleted','restored','moved')),
  from_value text, to_value text, meta jsonb not null default '{}', created_at timestamptz not null default now());
-- index (task_id, created_at)

create table if not exists public.tk_attachments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.staff_reminders(id) on delete cascade,
  kind text not null check (kind in ('file','drive','link')),
  client_file_id uuid references public.client_files(id) on delete set null,
  storage_path text, url text check (url is null or (url ~* '^https://' and char_length(url) <= 2000)),
  name text not null check (char_length(name) between 1 and 255),
  size bigint check (size is null or size >= 0), mime text,
  added_by text, created_at timestamptz not null default now(), removed_at timestamptz, removed_by text,
  constraint tk_attachments_shape check (
    (kind = 'link' and url is not null) or (kind = 'file' and storage_path is not null) or (kind = 'drive')));
-- index (task_id)
```

Policies and triggers:

- **tk_followers**
  - select `tk_can_read_task(task_id)`.
  - insert with check `staff_email = lower(jwt email) and tk_can_read_task(task_id)`. You can only follow yourself. Others are added through `tk_add_follower`.
  - delete using `staff_email = lower(jwt email) or tk_can_edit_task(task_id)`.
  - Grants, after `revoke all … from anon, authenticated`: select, insert, delete to authenticated.
- **tk_comments**
  - select `tk_can_read_task(task_id)`.
  - insert with check `tk_can_read_task(task_id)`.
  - update using and with check `lower(author_email) = lower(jwt email) or is_active_staff_admin()`.
  - No delete. Grants, after `revoke all … from anon, authenticated`: select, insert, update to authenticated.
  - BEFORE INSERT OR UPDATE trigger `tk_comments_before_write`, security definer. The client controls only `body` and `deleted_at`; every other column is set or pinned here:
    - INSERT:
      - `author_email := lower(jwt)`; raise `42501` when empty or not `is_active_staff()`
      - when `kind <> 'comment'` and `mgb.tk_rpc <> 'on'`, set `kind := 'comment'`
      - `mentions := array_remove(tk_parse_mentions(body, task_id), author_email)` (whatever the client sent is discarded)
      - `created_at := now()`, `edited_at := null`, `deleted_at := null`, `deleted_by := null`
    - UPDATE:
      - pin `id`, `task_id`, `author_email`, `kind` and `created_at`
      - **always** recompute `mentions := array_remove(tk_parse_mentions(new.body, new.task_id), new.author_email)`, whether or not the body changed, so a client-sent `mentions` array never survives
      - `edited_at := case when new.body is distinct from old.body then now() else old.edited_at end`
      - `edited_by := case when new.body is distinct from old.body then caller email else old.edited_by end` (fix 1; null on insert)
      - `deleted_by := case when new.deleted_at is not null and old.deleted_at is null then lower(jwt) when new.deleted_at is null then null else old.deleted_by end`; when `deleted_at` stays set, pin `deleted_at := old.deleted_at`
  - AFTER INSERT OR UPDATE OF body trigger `tk_comments_follow`, definer:
    - adds the author (INSERT only) to `tk_followers`
    - computes the new mentions: on INSERT all of `new.mentions`; on UPDATE `new.mentions` minus `old.mentions`
    - adds those people as followers **only when the author passes `tk_can_edit_task(new.task_id)`** (evaluated with the author's jwt, which is the caller). A read-only reader (for example a follower) can still mention people, and the mention is stored, but no follower row is added, so a mention never opens a task to someone the editors did not choose. The bell stays correct: `listMentions` reads tk_comments under RLS, so a mentioned person who cannot read the task never sees the item.
    - inserts match through `staff s where s.active and s.email = lower(s.email)`, on conflict do nothing
- **tk_parse_mentions(p_body, p_task)**, definer, internal:
  ```sql
  select coalesce(array_agg(distinct s.email), '{}') from public.staff s
  where s.active
    and lower(split_part(s.email,'@',1)) in (
      select rtrim(lower(m[1]), '.') from regexp_matches(coalesce(p_body,''), '(?:^|[^A-Za-z0-9_.])@([A-Za-z0-9._-]{2,64})', 'g') m)
    and public.tk_task_scope_ok(p_task, s.email);
  ```
  `TK_mentionTokens` in JS uses the same regex.
- **tk_activity**
  - select `tk_can_read_task(task_id)`. `revoke all on public.tk_activity from anon, authenticated`, then `grant select … to authenticated`. `revoke all on sequence public.tk_activity_id_seq from anon, authenticated`.
  - Writer: AFTER INSERT OR UPDATE trigger `tk_staff_reminders_activity` on `staff_reminders`, security definer. It does nothing when `mgb.tk_migrate = 'on'`. Actor is `coalesce(nullif(lower(jwt email),''),'system')`.
    - INSERT: `created`, `to_value = status`, `meta = {source}`.
    - UPDATE: one row per changed field:
      - status: `review_approved` when ready_for_review → done; `review_sent_back` when ready_for_review → in_progress or todo; otherwise `status` (from → to)
      - `assignee` (from → to)
      - `due` (due_date text)
      - `priority`
      - `section`
      - `moved`, when client_id or project_id changed: meta `{from_client, to_client, from_project, to_project}`
      - `deleted` when deleted_at goes null → set; `restored` when it goes set → null
    - Comments are not logged, because they are their own stream.
- **tk_attachments**
  - select `tk_can_read_task(task_id)`.
  - insert with check `tk_can_edit_task(task_id) and kind in ('link','file')`.
  - update using `tk_can_edit_task(task_id) or lower(added_by) = lower(jwt email)`.
  - No delete. Grants, after `revoke all … from anon, authenticated`: select, insert, update to authenticated.
  - BEFORE INSERT OR UPDATE trigger, definer:
    - INSERT: `added_by := lower(jwt)`. For kind `file`, require `storage_path like task_id::text || '/%'` and the task's `client_id is null`, else raise `22023 tk_use_drive`. Kind `drive` is allowed only when `mgb.tk_rpc = 'on'`.
    - UPDATE: pin every column except `removed_at`, and stamp `removed_by`.
- **tk_attach_client_file(p_task, p_file)**, definer:
  1. require `tk_can_edit_task(p_task)`
  2. load `client_files f` where `id = p_file and trashed_at is null`
  3. require the task's `client_id = f.client_id`, else raise `22023 tk_wrong_client`
  4. require `can_access_client(f.client_id)`
  5. `set_config('mgb.tk_rpc','on',true)`, insert a `drive` row with f.name, f.size and f.mime, then at once `set_config('mgb.tk_rpc','',true)`
  6. return its id
- **Auto-follow:** AFTER INSERT OR UPDATE OF assignee_email trigger `tk_staff_reminders_autofollow` on `staff_reminders`, definer. It inserts the owner and the assignee, matched through `staff s where s.active and s.email = lower(s.email)`, into tk_followers, on conflict do nothing, so a mixed-case staff row can never make the task write fail. It never removes the previous assignee. It does nothing for a row with `deleted_at` set.
- **tk_add_follower(p_task, p_email)**, definer:
  1. require `tk_can_edit_task(p_task)`, or `lower(p_email) = lower(jwt)` and `tk_can_read_task(p_task)`
  2. the target must be active staff and pass `tk_task_scope_ok(p_task, p_email)`, else raise `42501 tk_follower_no_access`
  3. insert, on conflict do nothing
  4. return whether a row was inserted

**D9. New policies on existing tables.** These sit beside the live policies and never replace them.

```sql
drop policy if exists "tk read tasks" on public.staff_reminders;
create policy "tk read tasks" on public.staff_reminders for select to authenticated
  using (public.tk_row_readable(id, staff_email, assignee_email, client_id, project_id, visibility));
drop policy if exists "tk edit tasks" on public.staff_reminders;
create policy "tk edit tasks" on public.staff_reminders for update to authenticated
  using (public.tk_can_edit_task(id)) with check (public.tk_can_edit_task(id));
drop policy if exists "tk edit checklist" on public.task_checklist_items;
create policy "tk edit checklist" on public.task_checklist_items for all to authenticated
  using (public.tk_can_edit_task(reminder_id)) with check (public.tk_can_edit_task(reminder_id));
```

The owner policy "staff manage own reminders" stays, so the owner keeps insert, and a delete still passes RLS. It no longer removes the row, because of this trigger:

```sql
create or replace function public.tk_staff_reminders_soft_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(auth.jwt() ->> 'email','') = ''                                  -- service role, cron, SQL editor
     or coalesce(current_setting('mgb.tk_hard_delete', true),'') = 'on' then   -- deliberate hard delete
    return old;
  end if;
  update public.staff_reminders set deleted_at = coalesce(deleted_at, now()) where id = old.id;
  return null;                                                                 -- skip the delete; children stay
end $$;
revoke all on function public.tk_staff_reminders_soft_delete() from public, anon, authenticated;
drop trigger if exists tk_staff_reminders_soft_delete on public.staff_reminders;
create trigger tk_staff_reminders_soft_delete before delete on public.staff_reminders
  for each row execute function public.tk_staff_reminders_soft_delete();
```

- Any build, old or new, that calls `.delete()` (for example `staffItemsApi.remove` at app.jsx 18297) now hides the task instead. Comments, checklist, followers and attachments stay, because the cascade never fires. `deleted_by` is stamped by D6 block 5, since the inner update runs with the caller's jwt. PostgREST reports zero rows deleted and no error, which the legacy code already treats as success.
- The new app never calls `.delete()` on staff_reminders; `TK_api.remove` sets `deleted_at`.
- "tk edit tasks" WITH CHECK calls `tk_can_edit_task(id)`, which reads the row as it is **before** the update, not the new values. That is safe today because D6 pins every column that decides access (assignee, project, parent, visibility rules) for non-owners. If a later phase adds a rule that depends on new values, the policy must pass those columns in instead of the id.

**D10. RPCs.**

`complete_staff_item(p_id uuid, p_done boolean, p_today date default null) returns uuid`: same signature, security definer. Start from the live body (`pg_get_functiondef`) and change only this:
- **Permission:** `if not public.tk_can_edit_task(p_id) then raise exception … using errcode = '42501'`, keeping the live message text.
- **Update first:** `update staff_reminders set done = p_done, series_id = coalesce(series_id, id) where id = p_id returning status into v_status`. The trigger maps status and the review gate.
- **Diverted:** if `p_done` and `v_status <> 'done'`, return null.
- **Recurring and now done:** `update … set recurrence = 'none'`, then compute the next date exactly as the live code does, and insert the next row between `set_config('mgb.tk_rollforward','on',true)` and `set_config('mgb.tk_rollforward','',true)`, so an owner who is not a member of the task's internal project can still roll it forward (D6 block 3 skips its membership check only for that insert). Copy every live column plus `description`, `section`, `project_id`, `sop_section`, `review_required`, `parent_id`, `sort_key` and `series_id`. Set `status = 'todo'` and `done = false`. Shift `start_on` by the same number of days as `due_date` when both are set, else null. Set `source_ref` to null only when `source = 'template'`, else copy it.
- **Copy the checklist:** insert into `task_checklist_items (reminder_id, text, done, sort_order, created_by)` every item of the finished task, with `done = false`.
- **Copy the followers:** from `tk_followers` of the finished task, joined to `staff s where s.active and s.email = lower(s.email)`, on conflict do nothing.
- **Undo (`p_done = false`):** the live branch stays as it is (`done = false`, `completed_at = null`); D6 maps status back to `todo`.
- Return the new id, as the live code does.

`tk_set_status(p_id uuid, p_status text, p_note text default null) returns text`, security definer:
1. Validate `p_status` against the five values, else raise `22023 tk_bad_status`.
2. Require `tk_can_edit_task(p_id)`, else raise `42501 tk_forbidden`.
3. `select status into v_from from staff_reminders where id = p_id and deleted_at is null for update`; not found raises `42501 tk_forbidden`.
4. Raise `22023 tk_bad_transition` when `v_from = p_status`, or when `v_from = 'done'` and `p_status in ('waiting_client','ready_for_review')`.
5. If `p_status = 'done'`: `perform complete_staff_item(p_id, true, null)` (the review gate in D6 may divert it to `ready_for_review`; admins pass through `v_admin`).
6. Else if `v_from = 'done'` and `p_status = 'todo'`: `perform complete_staff_item(p_id, false, null)`.
7. Else: one `update staff_reminders set status = p_status where id = p_id`. From `done` this also clears `done` and `completed_at` through D6 block 4, so exactly one activity row is written.
8. If `btrim(coalesce(p_note,'')) <> ''`: `set_config('mgb.tk_rpc','on',true)`, insert into tk_comments with `kind = case when v_from = 'ready_for_review' and p_status in ('in_progress','todo') then 'send_back' else 'system' end`, then `set_config('mgb.tk_rpc','',true)`.
9. Return the current status (re-read).

`tk_search(q text, p_limit int default 20)`: stable, **security definer**, `set search_path = public`. It is definer because `@@` (`ts_match_vq`) is not leakproof, so under invoker RLS the planner cannot use `staff_reminders_tk_search_idx` and scans every row. Access is enforced explicitly instead:
- Empty unless `is_active_staff()`.
- Empty when `btrim(q) = ''` or `char_length(q) > 200`.
- `v_q := websearch_to_tsquery('english', q)`.
- Union of:
  - tasks from `staff_reminders r` where `r.deleted_at is null and r.search_tsv @@ v_q and public.tk_row_readable(r.id, r.staff_email, r.assignee_email, r.client_id, r.project_id, r.visibility)`: match `'task'`, snippet `left(coalesce(r.description,''), 140)`, rank `ts_rank(r.search_tsv, v_q)`
  - comments from `tk_comments c join staff_reminders r on r.id = c.task_id` where `c.deleted_at is null and r.deleted_at is null and c.tsv @@ v_q and public.tk_row_readable(r.id, r.staff_email, r.assignee_email, r.client_id, r.project_id, r.visibility)`: match `'comment'`, snippet `left(c.body, 140)`
- The readable filter runs after the index match, so the index does the narrowing and the helper only sees matching rows.
- Distinct on task_id, keeping the best rank. Order by rank desc, then due_date. Limit `least(greatest(p_limit,1), 50)`.

`tk_client_people(p_client text)`, definer: return nothing unless `is_active_staff() and can_access_client(p_client)`. Rows:
- `('bookkeeper', clients.assigned_bookkeeper_email)`
- `('backup', client_profile.backup_bookkeeper_email)`
- `('account_manager', clients.account_manager_email)`

Each is joined to `staff` on lower(email) for `name`. Active staff only, and null emails are skipped.

`tk_assignable_staff(p_client text default null, p_project uuid default null)`, definer: nothing unless `is_active_staff()`, and nothing when `p_client` is given and `not can_access_client(p_client)`, or `p_project` is given and `not tk_can_see_project(p_project)` (so the list never confirms a client or project the caller cannot see). Every active staff member gets `(email, name, role, can_see)`:
- with a client: `can_see = tk_staff_has_client(email, p_client)`
- with a project and no client: `can_see = admin or member`
- with neither: true

Order by name.

**D11. View `tk_tasks`.** `create or replace view public.tk_tasks with (security_invoker = true) as select * from public.staff_reminders where deleted_at is null;`. Then `revoke all on public.tk_tasks from anon, authenticated;` and `grant select on public.tk_tasks to authenticated;` (select only; writes go to the base table). Realtime stays on the base table.

**D12. Storage.**
- Upsert the bucket: `insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('task-files','task-files', false, 26214400, array[...])`, with the nine mimes from C7 (the same list as `staff-chat-attachments`), and `on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types`.
- Policies on `storage.objects`, each dropped if it exists first:
  - "tk task files read": for select to authenticated, using `bucket_id = 'task-files' and public.tk_can_read_task(public.tk_path_task_id(name))`
  - "tk task files insert": for insert to authenticated, with check `bucket_id = 'task-files' and public.tk_can_upload_task_file(name)`.
  - `tk_can_upload_task_file(p_name text) returns boolean`, stable, security definer, `set search_path = public`: true only when `tk_path_task_id(p_name)` is not null, `tk_can_edit_task` of that id is true, and that task's `client_id is null` and `deleted_at is null` (client tasks attach from the client's Drive instead, through `tk_attach_client_file`). `revoke all … from public, anon; grant execute … to authenticated;`, because the policy runs as the caller.
  - No update or delete policy. Files stay, and only the attachment row is soft-removed.

**D13. Server-side readers: deleted and waiting tasks.** For each function, read the live body with `pg_get_functiondef` (read-only) and paste it with `create or replace`, unchanged except:
- `client_health(jsonb)`: every staff_reminders read adds `deleted_at is null`; the overdue count also adds `status <> 'waiting_client'`.
- `digest_weekly_data(date, date)`: the same two rules for its open, overdue and completed lists.
- `staff_performance(integer, jsonb)`: the same. Completed counts add `deleted_at is null`.
- `offboard_staff_preview(text)`: counts add `deleted_at is null`.
- `offboard_staff(text, jsonb)`: no filter change (moving deleted rows keeps history consistent). It already sets `mgb.offboarding`, which the new pins honor. Its reassignments of deleted rows send nothing, because of the next item.
- `notify_enqueue_task_assigned()` (trigger function): add `if new.deleted_at is not null then return null; end if;` as its first statement (it is an AFTER trigger, so the return value is ignored; match the live return style). Every live skip stays: done, null assignee, unchanged assignee, access_request source and self-assignment. A reassignment of a `ready_for_review` task still notifies, since the new assignee needs to know.
- `tt_generate_template_tasks(date)`: no change. A deleted generated task still blocks regeneration through `template_ref_uniq`, which is intended.

Mark every edited line `-- tk v1`. Keep the signatures, `security definer` and the grants as they are live.

**D14. Realtime.** Use the guarded add for `task_checklist_items`, `tk_comments`, `tk_activity`, `tk_followers` and `tk_attachments`: for each, `alter publication supabase_realtime add table public.<t>` only when `pg_publication` has `supabase_realtime` and `pg_publication_tables` lacks the table. `tk_projects` and `tk_project_members` are not published in Phase 1; the sidebar refetches on focus. Live `realtime.messages` policies already let active staff join any private topic.
- Supabase Realtime does not apply RLS to DELETE events: every subscriber to the table gets the deleted row's primary key (the full old row only under replica identity full, which must never be set on a tk_ table). Hard deletes that remain: `tk_followers` (Unfollow and Remove; key = task id + staff email) and `task_checklist_items` (key = uuid). `tk_comments`, `tk_activity` and `tk_attachments` are never deleted, and `staff_reminders` deletes become updates (D9). So the most a DELETE event can leak is "this staff email stopped following task id X". Staff emails are already visible to every active staff member through the staff list, and a task id reveals nothing without read access, so this is accepted for Phase 1 and noted in Part H.
- Channel names carry the random per-window `tabId`, never an email (C5).

**D15.** `notify pgrst, 'reload schema';` at the end.

**`supabase/tasks-module-v1-checks.sql`** holds read-only SELECTs only, no writes and no transaction control. Each check returns rows of `(check text, ok boolean, detail text)`, and `detail` never holds an email, name or task text. The checks:
1. Every D1 column, and `project_id`, exists with the right type and default.
2. Every CHECK named in D1 and D3 exists and has `convalidated = true`. The `shared_needs_client` definition mentions `project_id`.
3. Every function in C3 exists, including `tk_can_upload_task_file` and `tk_staff_reminders_soft_delete`. `prosecdef` matches C3 (in particular `tk_search` and `tk_can_upload_task_file` are definer). `proconfig` contains `search_path=public`. `has_function_privilege('anon', oid, 'execute') = false`. The internal functions (trigger functions and `tk_staff_reminders_soft_delete`) have no authenticated execute; `tk_project_info` and `tk_can_upload_task_file` do.
4. RLS is enabled on the six tk_ tables, and every policy named in D2, D8, D9 and D12 exists.
4a. Grants: for every tk_ table, the `tk_tasks` view and `tk_activity_id_seq`, `has_table_privilege('anon', …, p)` (or `has_sequence_privilege`) is false for every privilege. `authenticated` has no `DELETE`, `TRUNCATE`, `REFERENCES` or `TRIGGER` on `tk_comments`, `tk_activity`, `tk_attachments` or `tk_tasks`, no `INSERT`/`UPDATE` on `tk_activity` or `tk_tasks`, and no privilege on `tk_activity_id_seq`.
5. The publication holds the five tables in D14.
6. The bucket `task-files` exists, with `public = false` and a 26214400 limit.
7. The `prosrc` of the D13 functions contains `deleted_at`.
8. Invariants:
   - `count(*) where done <> (status = 'done')` = 0
   - `count(*) where status = 'ready_for_review' and done` = 0
   - `count(*) where assignee_email <> lower(assignee_email)` = 0
   - `tk_schema_version() = 1`
   - the 4 seed projects exist (matched by `lower(name)` with a null client_id; these are fixed project names, not personal data). Right after the first run, SOPs and 90 Day have `open_to_staff = true` and the other two `false`; the check reports the four booleans in `detail` and marks `ok` on existence only, because the owner may change the setting later
   - `count(*)` of active `staff` rows with `email <> lower(email)` (reported as a number; the follower inserts skip them)
9. The triggers `staff_reminders_before_write`, `tk_staff_reminders_activity`, `tk_staff_reminders_autofollow`, `tk_staff_reminders_soft_delete` (BEFORE DELETE) and `notify_enqueue_task_assigned` exist on staff_reminders, and `tk_comments_before_write` and `tk_comments_follow` (AFTER INSERT OR UPDATE OF body) exist on tk_comments. `prosrc` of `notify_enqueue_task_assigned` contains `deleted_at`.

**DB acceptance tests** (run by the verify step, never committed). Each is one `execute_sql` call that starts with `BEGIN;`, ends with `ROLLBACK;`, and holds one `do` block:
1. Check the triggers on `clients`, `staff_reminders` and `tk_comments` for pg_net or email side effects first. The outbox rows that `notify_enqueue_task_assigned` writes are rolled back with everything else.
2. Pick actors from `staff` by role (`select email into v_admin from staff where role='admin' and active limit 1`, and likewise a bookkeeper), without printing them.
3. Insert made-up clients with ids prefixed `tk-test-` and `test_only = true`, and made-up task text.
4. Simulate each user with `execute 'set local role authenticated'` plus `set_config('request.jwt.claims', json_build_object('email', v_x, 'role','authenticated')::text, true)`, then `reset role`.
5. Report results only through `raise notice 'check=<name> ok=<bool>'`, or a final select of booleans.

Tests the verify step must run (each one `do` block in its own BEGIN/ROLLBACK call, made-up rows only). Rows in Part E name them by these ids:
- **T1 insert-done:** an owner inserts a task with `done = true` → `status = 'done'`, `completed_at` set.
- **T2 project-returning:** as a bookkeeper, `insert into tk_projects (name) values ('tk-test …') returning id` succeeds, and the row has `owner_email` = the bookkeeper and `open_to_staff = false` even when the insert sent another owner and `true`.
- **T3 duplicate-name:** a second active project with the same name (any case) in the same container raises `23505`.
- **T4 soft-delete:** as the owner, `delete from staff_reminders where id = v_t` → the row still exists with `deleted_at` and `deleted_by` set, and its comment and checklist rows still exist. With `mgb.tk_hard_delete = 'on'` the delete removes the row.
- **T5 bad-transition:** `tk_set_status(done → waiting_client)` raises `22023`; `tk_set_status(x → x)` raises `22023`.
- **T6 reopen:** `tk_set_status(done → in_progress)` leaves `done = false`, `completed_at` null, and writes exactly one tk_activity status row.
- **T7 search-index:** `set local enable_seqscan = off; explain select … from staff_reminders where search_tsv @@ websearch_to_tsquery('english','zzq')` inside `tk_search`'s query shape shows `staff_reminders_tk_search_idx`; and `tk_search` as a bookkeeper never returns a made-up task on a client the bookkeeper cannot access.
- **T8 seed-visibility:** a bookkeeper who is not a member reads tasks in the SOPs and 90 Day projects and does not read a private task in the other two.
- **T9 mention-by-reader:** a follower who cannot edit posts a comment mentioning a third staff member → the comment stores the mention, and no tk_followers row is added for that person.
- **T10 forged-mentions:** an author updates a comment, sending `mentions = '{someone}'` with an unchanged body → `mentions` equals the parsed value.
- **T11 roll-forward:** an owner who is not a member of the task's internal project completes a recurring task → `complete_staff_item` returns a new id, and the new row has the same `project_id`.
- **T12 deleted-no-notify:** reassigning a soft-deleted task adds no outbox row (count the outbox table before and after).
- **T13 anon:** `set local role anon` → selects from every tk_ table and `tk_tasks` raise `42501` (privilege), and `tk_search('x')` raises `42501`.
- **T14 review-gate:** a bookkeeper's `done = true` on a `review_required` task gives `ready_for_review` and `done = false`; an admin's `tk_set_status(… 'done')` on it gives `done`.

---

## Part E. The 25 rows

Each row lists what ships, the data changes, the UI, the URLs and the acceptance checks. Checks are tagged:
- `[code]`: node test or code review
- `[db]`: catalog check or BEGIN…ROLLBACK test
- `[shot]`: stub-harness screenshot
- `[owner]`: a live check by the owner, also in Part G

### 1.1 Client record carries bookkeeper, backup and reviewer assignments
- **Ships:** one resolver, `tk_client_people`, for bookkeeper, backup and Account Manager. Task UI shows them as chips. No reviewer column (D1): any active admin reviews in Phase 1. The reviewer default and override move to Phase 2.
- **Data:** `tk_client_people(p_client)` (D10), gated by `is_active_staff() and can_access_client`. No table changes.
- **UI:**
  - `TK_ClientHeader` shows a People row: Bookkeeper, Backup and Account Manager chips with initials and name, hidden when empty. In the drawer, a People line appears under the client field, showing the same chips plus "Reviewer: any admin" when `review_required`.
  - Loading: chip placeholders.
  - Error or empty: the row is hidden.
  - Offline: cached values for the session.
- **URLs:** none new.
- **Checks:**
  - `[db]` A bookkeeper without access gets 0 rows for a `tk-test-` client. An admin gets the made-up bookkeeper row.
  - `[db]` anon has no execute.
  - `[shot]` tk-list-client shows the People chips.

### 1.2 Client record carries QBO link, Drive folder and contacts
- **Ships:** a client header on the client task list. It needs no new storage.
- **Data:** none. It reads under existing RLS:
  - `qbo_connections` (status)
  - `drive_folders` (the row with `year is null and doc_type is null` for the client)
  - `client_users` (name, role, active)
  - `client_email_recipients.opted_out_at`
  - `client_email_prefs.summary_recipients`

  `TK_api.clientHeader` returns null pieces when a read is denied.
- **UI:**
  - `TK_ClientHeader`: the client name with an "Open client" link (`#/client/<enc>/overview`), an "SOP" link (`#/client/<enc>/sop`), and a QuickBooks pill. The pill reads "QuickBooks connected" when status is connected, else "QuickBooks not connected". It is text only, and never claims a deep link into QuickBooks.
  - "Open Drive folder" opens `https://drive.google.com/drive/folders/<drive_folder_id>` in a new tab. It is disabled, with the title from `TK_COPY.driveOff`, when there is no root folder or `DRV_status()` is false.
  - "Contacts" opens a popover listing client_users with role, an "Unsubscribed" tag when opted out, and a "Gets summaries" tag. Staff may see emails in the popover. Emails never go into URLs.
  - On a phone, the header wraps onto two lines and the contacts popover becomes a sheet.
- **URLs:** `#/tasks/c/<encodeURIComponent(client id)>`.
- **Checks:**
  - `[code]` Header pieces render nothing (no crash) when every read errors.
  - `[shot]` tk-list-client at 1280, 375 and dark.

### 1.3 SOP per client, attachable to tasks
- **Ships:** a task can point to one of the client's 7 SOP sections, and the drawer shows that section read-only.
- **Data:** `staff_reminders.sop_section` with a CHECK over the 7 ids (D1). `complete_staff_item` copies it (D10).
- **UI:**
  - Drawer field "SOP section", for client tasks only: a select of `CLIENT_SOP_SECTIONS` labels plus "None". When it's set, a "View SOP section" button opens a slide-over panel inside the drawer, rendering `<ClientSopView client={c} readOnly section={id} />` with "Open full SOP" (`#/client/<enc>/sop`).
  - Loading: the ClientSopView loading state.
  - An empty section shows "Nothing written for this section yet."
  - On a phone, the slide-over fills the drawer.
- **Integration:**
  - adds the `section` prop to `ClientSopView`
  - the existing `onEditInMyTasks` already routes to `onOpenSop` (app.jsx 24254), so no change there
  - `requestOpenClientSop` has no callers and stays as is
  - MyTasksPage's SOPs card keeps working on `#/work/notes`
- **Checks:**
  - `[code]` `TK_SOP_SECTION_IDS` equals the `CLIENT_SOP_SECTIONS` ids. A test reads app.jsx text and compares the `id:` values.
  - `[db]` An insert with `sop_section = 'nope'` fails with 23514.
  - `[shot]` tk-drawer-sop.

### 1.4 Internal projects as task containers alongside clients
- **Ships:** `tk_projects` and `tk_project_members`, the four seeded projects, project lists, and creating and managing projects.
- **Data:** D2, D3, the trigger project sync (D6), and the read and edit rules (D5).
- **UI:**
  - **Sidebar:** `TK_Sidebar` "Projects" section lists projects the user can see, with archived ones hidden, plus a "New project" button. It opens a ModalShell with a name, an optional sections list (one per line) and, for admins only, an "Open to all staff" switch (`TK_COPY.openToStaff`, help text `TK_COPY.openToStaffHelp`, off by default), and on save navigates to the project. A duplicate name shows `TK_COPY.projectNameTaken` under the name field (from `tk_name_taken`, mapped from 23505) and keeps the modal open.
  - **Header:** the project header on `TK_List` shows the name (editable by managers), an "Open to all staff" chip when `open_to_staff` (admins can toggle it from the project menu), member avatars, "Add member" (a staff select from `TK_api.listStaff`), "Sections" (managers edit an ordered list), and "Archive" (managers, with a confirm). Non-managers see a read-only header.
  - **Onboarding:** an onboarding project can be created only from a client header, through "New onboarding project" (kind `onboarding`, client_id set).
  - **States:**
    - Loading: skeleton.
    - Empty: `TK_COPY.emptyList` with an "Add task" row.
    - An archived project shows the banner "This project is archived." and becomes read-only.
    - Not found or no access: `TK_COPY.notFound`.
- **URLs:** `#/tasks/p/<project uuid>`, with `#/tasks/p/<uuid>/list` accepted as an alias.
- **Checks:**
  - `[db]` A bookkeeper cannot select the "Owners" project, and cannot select a project task there unless they are a member. An admin can select and update both. A bookkeeper reads tasks in SOPs and 90 Day without membership (T8).
  - `[db]` T2 (bookkeeper insert … returning works, owner forced, open_to_staff forced false) and T3 (duplicate name 23505).
  - `[code]` `TK_api.createProject` maps a 23505 error to `{code:"tk_name_taken"}`, and the modal shows `TK_COPY.projectNameTaken` (unit test with a stub client).
  - `[code]` The "Open to all staff" switch renders only when the `isAdmin` prop is true.
  - `[db]` A non-member inserting a task with `project_id` of an internal project gets 42501. A member succeeds.
  - `[db]` A shared project task with no client passes the CHECK.
  - `[db]` For an onboarding project, the task's `client_id` is forced to the project's client.
  - `[db]` The seed is idempotent: running the seed block twice keeps 4 rows.
  - `[shot]` tk-list-project and tk-new-project.
  - `[owner]` The owner confirms the four starter projects and their names.

### 2.1 Task core fields
- **Ships:**
  - Description, start date, section, sort key, parent and soft delete.
  - Assignees can read and edit their tasks, and admins can edit any task.
  - created_by is stamped safely, and assignee changes are pinned for non-owners who are not admins.
  - The drawer edits every field.
- **Data:** D1, D5, D6 (blocks 1–2), D9 and D11. staffItemsApi: soft delete and assignee in the list filter (C9). Server readers ignore deleted rows (D13), and so do the edge functions (integration).
- **UI (`TK_Drawer`):**
  - **Header:** status pill, inline-editable title (Enter saves, Esc reverts), Copy link (`LK_href({place:"tasks", tab:"my", item:"task:"+id})` with the origin, then `TK_COPY.linkCopied`), and close (×).
  - **"More" menu:**
    - "Save as template" (with `canCreateTemplates`, through `TT_draftFromTask` plus `TCL_fetchTexts` plus `TT_openDraft` plus `onOpenTemplates`) or "Suggest as template" (through `TT_suggestFromTask`), the same as MyTasksPage's `saveAsTemplate`
    - "Delete" (owner or editor; a ModalShell confirm, then `TK_api.remove`, then `TK_COPY.deleted`)
  - **Fields grid:**
    - Assignee: a select from `TK_api.assignable`. When `can_see` is false, a warning appears with `TK_COPY.noClientAccess`. The field is disabled for non-owners who are not admins.
    - Due date and optional time
    - Start date
    - Priority
    - Section: a combobox of the project's sections, or the client's known sections
    - Client or project: read-only, with a link
    - Type (Task or Reminder)
    - Remind me (datetime-local)
    - Repeat (None, Daily, Weekly, Monthly, Month end; disabled without a due date)
    - Share with the client's team, or with project members: owner only
    - Needs review: anyone can turn it on, only admins can turn it off
    - Description: a textarea, autosaved on blur, with a 5000-character counter after 4500
  - **Subtasks:** child tasks (`parent_id`) listed as compact `TK_TaskRow`s, plus "Add subtask", which creates a task with the same client or project, the same assignee and `parent_id`.
  - **Saves:** optimistic per field through `TK_api.update`, with `baseUpdatedAt` for title and description.
    - Errors roll back and toast `TK_COPY.saveError`.
    - A conflict reloads the task and toasts `TK_COPY.conflict`.
    - A revert toasts `TK_COPY.reverted`.
  - **A deleted task:** the banner `TK_COPY.deletedBanner`, a Restore button (editors), and every field read-only.
  - **Loading:** skeleton lines.
  - **Not found:** `LK_COPY.taskMissing`, and the drawer closes.
  - **Offline:** the banner `TK_COPY.offline`, inputs disabled.
  - **Desktop:** a right-hand panel 480px wide, with a scrim. Focus is trapped in the drawer, and the trap is skipped while a `.modal-overlay` exists, as in SI_ChatDrawer. Esc closes when no menu is open. Focus returns to the opener.
  - **Phone (≤760px):** a full-screen sheet with a sticky header, as in WD_WidgetDrawer.
- **URLs:** an arrival with `?item=task:<id>` on `#/tasks/...` or `#/work/tasks` opens the drawer (11.5). Every task title in a row is a real `<a href={LK_href({place:"tasks", tab:"my", item:"task:"+id})}>` with `onClick={TK_openTaskClick(id)}`, so a plain click opens the drawer in place while Cmd/Ctrl/Shift/middle click opens a new tab or window at the task's URL.
- **Checks:**
  - `[db]` T4: a `.delete()` from any build keeps the row, stamps `deleted_at` and `deleted_by`, and keeps its comments and checklist.
  - `[code]` `TK_openTaskClick(id)` calls `preventDefault` and `TK_openTask` for a plain left click only; with `metaKey`, `ctrlKey`, `shiftKey`, `altKey` or `button !== 0` it does nothing (unit test with fake events).
  - `[code]` `TK_openTask` with the schema not `"ok"` calls `LK_go({place:"work", tab:"tasks", item:"task:"+id})` instead of opening the drawer.
  - `[db]` The assignee of a private task without a client can select and update it. A colleague who is neither owner, assignee nor follower cannot.
  - `[db]` A non-owner bookkeeper changing `assignee_email` sees it reverted. An admin can change it.
  - `[db]` An insert by the owner stamps `created_by` as the caller even when the client sent another value. An insert with no jwt keeps the coalesce.
  - `[db]` The access_request sniff still sets `source = 'access_request'`.
  - `[db]` A soft-deleted row is hidden from `tk_tasks`, `client_health` overdue and `digest_weekly_data`.
  - `[code]` `TK_buildPatch` includes only changed whitelisted fields.
  - `[code]` `staffItemsApi.remove` issues an update, not a delete, when `tkCols`.
  - `[shot]` tk-drawer, tk-drawer-deleted and tk-drawer-phone.

### 2.2 Status workflow
- **Ships:** five statuses, server-enforced transitions, the review gate, waiting bookkeeping and stamps, and one JS mirror.
- **Data:** the `status` and waiting columns (D1), the trigger (D6 blocks 4–5), `tk_set_status` and `complete_staff_item` (D10), and the activity rows (D8).
- **UI:**
  - `TK_StatusPill` on rows and in the drawer opens a menu built from `TK_nextStatuses`. On a review_required task, a non-admin sees "Send for review" instead of "Done". On ready_for_review, admins see "Approve" (→ done) and "Send back" (→ in_progress), and Send back asks for an optional reason, which goes to `p_note`.
  - The row checkbox calls `TK_api.complete(task, { done: TK_isOpen(task) })`, which raises `TK_COPY.sentForReview` itself when the result is `ready_for_review` (callers never toast it again).
  - Status colors come from tokens:
    - todo: neutral
    - in_progress: info
    - waiting_client: warning
    - ready_for_review: accent
    - done: success
  - Each status also has a text label, never color alone.
- **Checks:**
  - `[code]` `TK_canTransition` matrix (25 pairs).
  - `[code]` `TK_resolveStatus` gate cases.
  - `[code]` `TK_nextStatuses` for an admin and a non-admin.
  - `[db]` Legacy `update set done = true` on a review_required task as a non-admin results in `status = 'ready_for_review'` and `done = false`. As an admin, it results in done.
  - `[db]` T5 (done → waiting_client and same → same raise 22023), T6 (done → in_progress: one activity row, done false), T14 (review gate both ways), T1 (insert with done gives done).
  - `[code]` `TK_api.complete` with a stub client: done on an open task calls `tk_set_status(id,"done")` once and returns `sentForReview` true when the stub answers `ready_for_review`; it dispatches exactly one `mgb:toast`; a second call on a done task sends no request; with the schema missing it calls `staffItemsApi.toggleDone`.
  - `[code]` `TK_nextStatuses` never offers the current status, and from done never offers waiting_client or ready_for_review.
  - `[db]` Leaving waiting_client adds to `waiting_minutes` and clears `waiting_since`. Entering it stores `status_before_wait`.
  - `[db]` `complete_staff_item` returns null when diverted, and creates no next occurrence.
  - `[db]` `tk_set_status` by a user who cannot edit raises 42501.
  - `[shot]` tk-status-menu.

### 2.3 Subtasks and checklist
- **Ships:** TCL_Checklist inside the drawer. Assignees and editors can tick items. The checklist is published to realtime and copied on roll-forward. `parent_id` subtasks have a simple UI (2.1).
- **Data:** the "tk edit checklist" policy (D9), the publication (D14), and the checklist copy in `complete_staff_item` (D10).
- **UI:** a "Checklist" section renders `<TCL_Checklist task={task} canEdit={TK_canEdit(...)} />`. Row counts come from `TCL_useCounts(ids)`. A change from another window arrives through `TCL_EVENT`.
- **Checks:**
  - `[db]` The assignee of a task they don't own can insert and update checklist items.
  - `[db]` Completing a recurring task with 3 items, 1 ticked, gives the next occurrence 3 unticked items, and `source_ref` is null only for `source = 'template'`.
  - `[db]` `task_checklist_items` is in the publication.
  - `[shot]` tk-drawer shows the checklist.

### 2.4 Comments with @mentions
- **Ships:** a comment thread on each task, @mentions with autocomplete, auto-follow, and bell notices. There is no email in Phase 1, and the outbox and email-log CHECKs are not widened.
- **Data:** `tk_comments`, its triggers and `tk_parse_mentions` (D8).
- **UI (`TK_Comments`):**
  - The newest comments sit at the bottom, with a composer (textarea, Ctrl/⌘+Enter or a Post button). Typing `@` opens a listbox from `TK_mentionMatches`; arrows and Enter pick, and the pick inserts `@handle`.
  - Your own comments get "Edit" and "Delete" (soft). Mentions render as chips with the name.
  - Loading: skeleton. Empty: "No comments yet." Error: a retry link.
  - Offline: the composer is disabled.
- **Bell (integration):** each comment that mentions me becomes an item with id `"tkm:"+comment.id`, title "<author name> mentioned you", sub the task text cut to 80 characters, and `go` → `TK_openTask(task_id)`. Bell prefs filter it by the `tkm:` prefix.
- **Checks:**
  - `[db]` A comment with `@<handle of a bookkeeper without access>` on a private client task stores no mention for them. The same comment with an admin's handle stores the mention and adds them as a follower.
  - `[db]` A non-reader cannot insert a comment.
  - `[db]` `author_email` cannot be forged.
  - `[code]` `TK_mentionTokens` matches the SQL regex on 8 vectors.
  - `[shot]` tk-drawer-comments and tk-bell-mention.
  - `[owner]` A mention shows in the bell for a teammate within a minute.

### 2.5 Attachments on a task
- **Ships:**
  - files on client tasks go to Drive (internal), linked through `tk_attach_client_file`
  - files on other tasks go to the private `task-files` bucket
  - https links are allowed on any task
  - removal is soft
- **Data:** `tk_attachments`, its triggers, `tk_attach_client_file`, the bucket and the storage policies (D8, D12).
- **UI (`TK_Attachments`):**
  - A list of name, size and who added it, with Open (`TK_api.openAttachment`, in a new tab) and Remove (editor or adder, with a confirm).
  - "Add file" uses a file input and validates with `TK_validateAttachment`. For a client task, it checks `DRV_status()` first; when Drive is off, it shows `TK_COPY.driveOff` and offers only "Add link".
  - "Add link" takes a URL and an optional name.
  - The upload shows a progress state on the row.
  - Empty: "No files yet." Error: inline on the row.
  - Offline: buttons disabled.
- **Checks:**
  - `[db]` Insert of kind `drive` directly is rejected. `tk_attach_client_file` with a file from another client raises `tk_wrong_client`.
  - `[db]` The storage insert policy rejects a path for a client task, and select is false for a non-reader of a private task.
  - `[db]` The bucket is private, with a 25 MB limit.
  - `[code]` `TK_validateAttachment` and `TK_attachmentPath` vectors.
  - `[shot]` tk-drawer-files (Drive connected, and off).
  - `[owner]` Upload a PDF to a test client task with Drive connected, and see it in the client's Drive folder as internal.

### 2.6 Followers on a task
- **Ships:** followers, auto-follow for owner, assignee, commenter and mentioned people, Follow and Unfollow, and editors adding people.
- **Data:** `tk_followers`, the auto-follow trigger, `tk_add_follower` and the backfill (D7, D8).
- **UI:**
  - The drawer footer shows an avatar stack (up to 5, then "+N"), a "Follow" or "Following ✓" toggle, and, for editors, "Add follower" (a staff select). Adding someone out of scope shows the server error as "They can't see this task's client or project."
  - On a phone, the footer wraps.
- **Checks:**
  - `[db]` Self-follow on a task you can't read is rejected.
  - `[db]` A follower of a private no-client task can read it, but not update it.
  - `[db]` `tk_add_follower` by a non-editor raises 42501.
  - `[db]` Reassigning adds the new assignee.
  - `[shot]` tk-drawer shows the footer.

### 2.7 Activity log per task
- **Ships:** an append-only log written only by the definer trigger.
- **Data:** `tk_activity` and its trigger (D8).
- **UI (`TK_Activity`):**
  - The drawer has "Comments" and "Activity" tabs, plus "All", the default on desktop, which interleaves both through `TK_mergeTimeline`. Each entry shows the actor's name ("System" for system), `TK_activityText`, and a relative time with the exact time in the title.
  - Loading: skeleton. Empty: "No changes yet."
- **Checks:**
  - `[db]` Insert, then status change, then assignee change, then due change, then soft delete gives 5 rows of the right kinds, with the actor equal to the caller.
  - `[db]` A direct insert into tk_activity as authenticated fails.
  - `[db]` The migration backfill wrote no activity rows.
  - `[code]` `TK_activityText` vectors.
  - `[shot]` tk-drawer-activity.

### 2.11 Quick add
- **Ships:**
  - a one-line add from anywhere, which parses tokens and then opens the drawer if asked
  - TB_QuickAdd works without a client
  - one task modal only
- **Data:** none beyond 2.1. `TK_api.create`, or `staffItemsApi.add` when the schema is missing.
- **UI (`TK_QuickAddDialog` in a ModalShell):**
  - One input, with chips below it showing each parsed token (person, client, date, priority), each removable. A row of optional fields shows: Client (select), Due (date), Assignee (select), "Share with the client's team" (checkbox, shown when a client is set), and the project and section when the event provides them.
  - Enter means "Add". Shift+Enter means "Add and open", which opens the drawer.
  - Errors from the parser show inline and block saving only for an empty title.
  - After adding, the dialog closes with a toast "Task added." On "Add and open", it opens the drawer instead.
  - `MGB_track("tasks-quick-add")`.
  - On a phone, the dialog fills the screen and keeps the field row visible.
  - Offline: the Add button is disabled, with `TK_COPY.offline`.
- **Entry points** (integration owns every existing file here; once the schema is ok each one ends in `TK_QuickAddHost` or `TK_api.create`, and with the schema missing each keeps its legacy path):

  | Where | File, line | Today | After |
  |---|---|---|---|
  | `q` key | TK views, and any staff page (C8 scope rule) | none | dispatches `tk:quick-add` with the list's client, project and section, or `currentClientId` |
  | TopBar + menu (TB_QuickAdd) | TopBar.jsx ~964 | returns null with no client | always renders. With a client: New task → `tk:quick-add {client_id}`; New note, Request document and Message keep `tb:quick-add`. With no client: only "New task" → `tk:quick-add {}`; the button label is "Add" |
  | ⌘K actions (TB_actionRows) | TopBar.jsx 347-358 | New task/note with no client and New reminder go to `#/work/tasks` | New task → `tk:quick-add {client_id?}`; New note with a client → `tb:quick-add {kind:"note"}` (unchanged); New note with no client → `TB_go("#/work/notes")`; New reminder → `tk:quick-add {kind:"reminder"}` |
  | StaffQuickActions "Add task" | app.jsx ~7889 | opens its own task modal on `tb:quick-add {kind:"task"}` | skips the task kind when `window.TK_quickAddReady === true` (the host answers instead); other kinds unchanged |
  | Overview tasks card "Add" | app.jsx 6833 | dispatches `tb:quick-add` | dispatches `tk:quick-add {client_id: client.id}` |
  | Today reminders card inline add | Today.jsx 764-850 (`TD_RemindersCard` `onAdd`) | `staffItemsApi.add` | `TK_api.create({ text, due_date, kind:"reminder" })` (no dialog; it stays an inline add) |
  | TK_List "Add task" rows | TK views | n/a | add inline with `TK_api.create`, no dialog |

  There is no "Add task" button on the Today reminders card today; the inline add above is the only Today entry point.
- **Checks:**
  - `[code]` For each table row, a review of the named file shows the "After" behavior, and `rg -n 'tb:quick-add|TB_QUICK_ADD_EVENT' components app.jsx` shows no remaining dispatch of the `task` kind outside TB_QuickAdd's client branch.
  - `[code]` TB_QuickAdd renders with `client = null` and its menu has exactly one item, "New task".
  - `[shot]` tk-quick-add-noclient: the + menu on `#/today` with no client open.
  - `[code]` `TK_parseQuickAdd`: 30 or more vectors covering @, #, ambiguous and unknown tokens, every date form, bdN in a past month, +Nbd across a weekend, priority forms, and text cleanup.
  - `[code]` `TK_quickAddDefaults`.
  - `[code]` `StaffQuickActions` skips its task modal when `TK_quickAddReady`. A review of app.jsx checks this.
  - `[shot]` tk-quick-add with parsed chips, at 1280, 375 and dark.

### 2.13 Global search across tasks and clients
- **Ships:** server-side task and comment search in ⌘K, and a search view in the Tasks shell.
- **Data:** `search_tsv`, the GIN index, the `tk_comments.tsv` index and `tk_search` (D4, D8, D10).
- **UI:**
  - **⌘K Tasks group (integration):** keeps the instant local matches. It adds `TK_api.search(q, 8)` results, debounced 200ms when `q.length >= 2` and the schema is ok, merged and deduplicated by id. Comment hits show "In a comment: <snippet>". `go` → `TK_openTask(id)`. `MGB_track("tasks-search")`.
  - **`#/tasks/search` (views):** an input (autofocus), results as rows, `TK_COPY.emptySearch` when there are none, and an error retry. The query is never written into the URL.
- **Checks:**
  - `[db]` `tk_search` as a bookkeeper never returns a task they can't read, and excludes deleted tasks and deleted comments (T7 second half).
  - `[db]` T7: the plan uses `staff_reminders_tk_search_idx` with seqscan off, and T13: anon gets 42501.
  - `[db]` A blank query returns 0 rows.
  - `[shot]` tk-search (the palette with task results) and tk-search-view.

### 3.1 My Tasks grouped
- **Ships:** `TK_MyTasks` at `#/tasks/my` and at `#/work/tasks` (embedded). Today and the badges use the same grouping and overdue rule.
- **Data:** `TK_api.listMine`. The view filters to my tasks through `TK_isMine`.
- **UI:**
  - **Groups,** in order: Overdue, Today (when the "Today group" view option is on, the default per D6; off merges it into This week), This week, Later, Waiting on client, and Done (collapsed by default).
    - Each group header shows a name, a count and a collapse chevron, remembered in `mgb_tk_groups_v1`.
    - Empty groups are hidden. When everything is empty, the page shows `TK_COPY.emptyMine`, or `emptyMineTouch` on a touch device.
  - **Toolbar:** "Add task" (data-tour `tk-add`), a client filter (my visible clients), a "Show done" toggle, a "Show older" toggle (visible when Show done is on; D5), and a "View" menu with the Today group switch.
  - **Rows:** `TK_TaskRow`. Clicking one opens the drawer. Keys work (3.6).
  - **Loading:** 6 skeleton rows with `aria-busy`. **Error:** `TK_COPY.loadError` plus "Try again". **Offline:** banner and cached rows. **Schema missing:** `TK_SetupCard`.
  - **Phone:** single column, sticky group headers, meta on a second line.
- **Integration** (each rewrite is guarded by `typeof TK_groupMyTasks === "function"` and keeps the old code as the else branch):
  - **Today** (`TD_buildRows`, Today.jsx 394-410, which today filters `!t.done && t.due_date` inline): build the task rows from `TK_groupMyTasks(x.items, { today, email })`. Overdue and today make the "now" band, and week makes the soon band. Waiting, later and done never show. `onClick` stays `lk({place:"work",tab:"tasks",item:"task:"+id})` (LK_go forwards it to the drawer, C9 item 7). The "Done" action calls `TK_api.complete(t)` instead of `x.toggleItem(t)`, so the review gate toasts once. `TD_RemindersCard` `onToggle` → `TK_api.complete(t, {done: TK_isOpen(t)})`, `onRemove` → `TK_api.remove(t.id)`.
  - **Overview card** (`OV_ClientTasks`, app.jsx 6839-6870): open = `TK_isOpen`, overdue = `TK_isOverdue`, the status label from `TK_effectiveStatus`, the checkbox → `TK_api.complete`, the row link → `TK_openTaskClick` with the LK_href task link.
  - **Tab counts** (`CTC_loadTasks`, ClientTabCounts.jsx 275-290, which counts inline): open and overdue counts use `TK_isOpen` and `TK_isOverdue`, and the select adds `deleted_at` (filtered with `.is("deleted_at", null)` behind `tkCols`).
  - **Badge and due counts:** `countDueStaffItems` and `TB_TasksBadge` (TopBar.jsx 951) use `TK_isMine`, `TK_isOpen` and `TK_isOverdue`.
- **Checks:**
  - `[code]` `TK_groupMyTasks`:
    - 20 or more vectors covering every bucket boundary (d = -1, 0, 1, 7, 8)
    - undated tasks go to later
    - waiting overrides date
    - done ordering
    - old done hidden or shown
    - the todayGroup=false merge
    - a Saturday "today"
    - not-mine and deleted excluded
  - `[code]` `TK_isOverdue` excludes waiting and done.
  - `[code]` A unit test feeds `TD_buildRows` three made-up tasks (overdue, waiting with a past date, ready_for_review due today) and gets exactly two task rows, none for the waiting one; the Done action of a row calls a stubbed `TK_api.complete` once.
  - `[code]` `rg -n 'x\.toggleItem|!t\.done' components/staff/Today.jsx components/staff/ClientTabCounts.jsx` shows each remaining hit inside the legacy else branch only (review).
  - `[code]` The CTC open count for a made-up list (one waiting task overdue by date, one done, one deleted, one open) is 2 open and 0 overdue.
  - `[shot]` tk-my-default, tk-my-empty, tk-my-loading, tk-my-error, tk-my-offline, tk-my-setup, work-tasks and today-rows.
  - `[owner]` The owner decides whether to keep the Today group (D6) after a week of use.

### 3.2 List view
- **Ships:** `TK_List` for a client, a project or a person (admin only), grouped by section, with sortable columns, an add row per section, and filters.
- **Data:** `TK_api.listScope`. Sections come from `tk_projects.sections` for projects. For clients, they come from the distinct `section` values, ordered by `TK_CLIENT_SECTION_ORDER` first and then alphabetically, with "No section" last.
- **UI:**
  - **Header:** `TK_ClientHeader`, the project header, or the person header (name and role).
  - **Columns:** Task | Assignee | Due | Status | Priority. Clicking a header sorts through `TK_sortTasks`, remembered per list in `mgb_tk_sort_v1`. The default is section, then sort_key, then `TK_compareTasks`.
  - **Section groups** are collapsible, and each has an inline "Add task" row: one line, Enter saves with that section, parsed with `TK_parseQuickAdd` using `defaultClientId`.
  - **Filters:** assignee, status (multi), Show done and Show older.
  - **Person view** (`#/tasks/u/<staff uuid>`): admins only. Others see `TK_COPY.personAdminOnly`.
  - **Phone:** the columns collapse into the row's second line, and filters move into a "Filters" sheet.
  - **States:** the same as 3.1.
- **URLs:** `#/tasks/c/<enc>`, `#/tasks/p/<uuid>` and `#/tasks/u/<uuid>`. `/list` suffix aliases are accepted. Filters and sorting are not in the URL.
- **Checks:**
  - `[code]` `TK_groupBySection`, `TK_sortTasks` and `TK_applyFilters` vectors.
  - `[db]` A bookkeeper's client list returns only the tasks they may read (D3).
  - `[shot]` tk-list-client, tk-list-project, tk-list-person-admin and tk-list-phone-filters.

### 3.6 Keyboard-first navigation and shortcuts
- **Ships:** j, k, Enter, Esc, x, q, s, a and ?, from one keymap, guarded against inputs, modals, menus and the tour.
- **Data:** none.
- **UI:**
  - `TK_useKeys` runs in TK_MyTasks, TK_List and the search view. The focused row gets a visible focus ring and `aria-selected`.
  - `x` toggles done. `s` opens that row's status menu. `a` opens the drawer with the assignee field focused. `q` dispatches `tk:quick-add` with the list's client, project and section. `?` opens `TK_KeysSheet`.
  - The drawer handles x, s, a, `?` and Esc while it is open (scope `drawer`, C8). List keys are off while the drawer is open (`enabled = !drawerId`), so `x` changes exactly one task.
  - Settings shows a "Tasks" block from `TK_KEYMAP` (integration).
  - `MGB_track("tasks-shortcut")` at most once per session per key.
- **Checks:**
  - `[code]` `TK_shouldHandleKey` rejects:
    - modifiers
    - composition
    - input, textarea, select, contenteditable and role=textbox targets
    - defaultPrevented
    - an open modal, menu or tour

    It accepts `?` with Shift, and rejects a target inside `.tb-search`.
  - `[code]` Scope vectors: scope `"list"` rejects a target inside `[data-tk-keyscope="drawer"]`; scope `"drawer"` rejects a target outside it except `document.body`.
  - `[code]` With the drawer open on task B while the list focus is on task A, one `x` press calls `TK_api.complete` once, for B only (a jsdom-free test with stubbed handlers: `TK_useKeys` given `enabled:false` binds nothing).
  - `[code]` `q` on a non-TK staff page (Today) dispatches exactly one `tk:quick-add`.
  - `[shot]` tk-drawer-stack: open the SI chat drawer, then open a task (the chat drawer closes on `tk:drawer-open`), then one Esc closes the task drawer and nothing else stays open; the shot is taken after the Esc and shows the list.
  - `[code]` The drawer's Esc handler is on `document` with `capture: true`, calls `stopPropagation`, and returns early while a `.modal-overlay`, an open `[role=menu]` inside the drawer, or `.tour-root` exists (review).
  - `[code]` `TK_KEYMAP` keys are unique and include no Ctrl/⌘ combos.
  - `[shot]` tk-keys-sheet.

### 11.1 Same app served at /tasks
- **Ships:** `/tasks` on Vercel opens the slim Tasks shell. Locally, `/?shell=tasks#/tasks/my` does the same, and `/#/tasks/...` opens Tasks inside the normal portal.
- **Data:** none.
- **Integration:**
  - `vercel.json` adds a `redirects` array (rewrites and headers stay exactly as they are):
    ```json
    "redirects": [
      { "source": "/tasks",  "destination": "/?shell=tasks", "permanent": false },
      { "source": "/tasks/", "destination": "/?shell=tasks", "permanent": false }
    ]
    ```
    A redirect, not a rewrite: the page then always loads from `/`, so every relative asset and `document.write` path resolves as today, and no `<base>` tag is needed (the CSP has `base-uri 'none'`). Browsers carry the `#fragment` across a redirect whose Location has none, so `/tasks#/tasks/c/X` lands on `/?shell=tasks#/tasks/c/X`. `/tasks/anything-else` is not matched and 404s as today.
  - The boot code is **merged into the existing first `<script>` in `<head>`** (index.html line 12, the install-app script), at its top, so it runs before every other script and before the CSS `document.write` lines (~109). The install-app script's own `history.replaceState(null, …)` call changes to `history.replaceState(history.state, …)`, and every `replaceState` the boot code makes passes `history.state`, so AN_AppNav's `mgbNav` index is never wiped. The boot code:
    ```html
    <script>
      (function () {
        try {
          var p = location.pathname, sp = new URLSearchParams(location.search), q = sp.get("shell");
          var authHash = /access_token=|refresh_token=|error_description=|type=recovery/.test(location.hash);
          if (q === "portal") { try { sessionStorage.removeItem("mgb_shell_v1"); } catch (e) {} }
          var want = /^\/tasks\/?$/.test(p) || q === "tasks";   // the pathname test covers local servers without the redirect
          if (want) { try { sessionStorage.setItem("mgb_shell_v1", "tasks"); } catch (e) {} }
          var on = false; try { on = sessionStorage.getItem("mgb_shell_v1") === "tasks"; } catch (e) {}
          if (on) window.MGB_SHELL = "tasks";
          if (want || q) {
            sp.delete("shell");
            var s = sp.toString(), h = location.hash;
            if (!authHash && want && !/^#\/tasks(\/|$)/.test(h)) h = "#/tasks/my";
            history.replaceState(history.state, "", "/" + (s ? "?" + s : "") + h);
          }
        } catch (e) {}
      })();
    </script>
    ```
  - App, for `window.MGB_SHELL === "tasks"` and a staff user who is not impersonating:
    - it does not render StaffRail, TB_StaffTopBar, AN_AppNav or the phone Sidebar
    - it renders `<TK_StandaloneBar staffUser />` above the page content
    - client portal users ignore the flag and clear it
  - **Sign-in round trip:** AuthGate's `redirectTo` is `window.location.origin`, so Google returns to `/` with an auth hash and no `?shell`. The shell survives because the flag lives in `sessionStorage.mgb_shell_v1` (same tab), and the boot code never rewrites an auth hash. The task hash survives through the existing `PENDING_ROUTE_KEY` (`mygoodbooks_pending_route_v1`, app.jsx ~25448), which already stashes the raw hash when `parseHashRoute` accepts it. App changes one thing there: after sign-in, when the stashed value matches `^#\/tasks(\/[A-Za-z0-9%._~-]+){0,3}(\?item=[a-z]+:[A-Za-z0-9%._~-]+)?$`, it restores that string verbatim (no lowercasing, no rebuild through `buildHashRoute`).
  - App also:
    - adds `"tasks"` to NON_CLIENT_PAGES and HASH_SUB_ROUTE_PAGES
    - adds PAGE_META.tasks
    - makes `buildHashRoute("tasks")` keep a hash matching `^#\/tasks(\/[A-Za-z0-9%._~-]+){0,3}$`, else return `"#/tasks/my"`
    - makes `effectivePage` bounce `"tasks"` to Today for client users and while impersonating
    - marks the rail's Work item active for page `"tasks"`
- **Checks:**
  - `[code]` A review confirms the boot code sits at the top of the first `<head>` script, before the first `document.write` line, and never touches an auth hash; `rg -n 'replaceState\(null' index.html app.jsx components` returns nothing.
  - `[code]` `node -e 'const v=require("./vercel.json"); …'` confirms valid JSON, both redirect entries with `permanent:false`, and the rewrites and headers arrays byte-identical to before (compare with `git show HEAD:vercel.json`, read-only).
  - `[code]` In the stub harness: load `/?shell=tasks#/tasks/c/Ab%2Fc`, then confirm `location.hash === "#/tasks/c/Ab%2Fc"`, `window.MGB_SHELL === "tasks"` and that `history.state` set before boot (`{mgbNav:3}`) is still there.
  - `[code]` The pending-route restore: a unit-style check of the restore regex with `#/tasks/c/Ab%2Fc?item=task:<uuid>` (kept verbatim) and `#/tasks/../x` (rejected).
  - `[shot]` tk-shell.
  - `[owner]` On a Vercel preview: `/tasks` and `/tasks/` open the slim shell, a signed-out load returns to the shell after Google sign-in, and assets load (no blank page).

### 11.2 Open in own window, and Dock
- **Ships:** pop-out and dock with no lost state.
- **UI:**
  - **Pop-out:** the `TK_App` header has an "Open in own window" button (data-tour `tk-popout`), hidden at 760px and below, when `TK_isTouchPrimary()`, and inside the shell. `TK_popOut(hash)` calls `window.open("/?shell=tasks" + hash, "mgb-tasks", TK_popOutFeatures(saved))` with no `noopener`, where `saved` is `mgb_tk_popout_v1` (default 480 by 820, a slim side window that fits beside the portal). If it returns null, it toasts `TK_COPY.popupBlocked`. Otherwise it calls `MGB_track("tasks-popout")`. The shell remembers its window size on resize (debounced 500 ms, only when `window.opener` exists).
  - **`TK_StandaloneBar`:**
    - The gold logo badge from the portal sign-in, on navy deep: reuse the sign-in badge classes, with background `var(--navy-deep, #05080d)`.
    - The "Tasks" wordmark.
    - A search button, which goes to `#/tasks/search`.
    - An avatar menu with "Open full portal" (it clears the flag and calls `location.assign("/#/today")`) and "Help" (`#/help/my-tasks` in the opener, or in this window).
    - A "Dock in portal" button, shown when `window.opener` exists or the device is not touch-primary. It follows `TK_dockPlan`:
      - It reads the opener's tab id as `window.opener.TK_sync && window.opener.TK_sync.tabId` (same origin, inside try/catch).
      - With an opener tab id, it posts `{ type:"dock", hash, to: openerTabId }`. Only the tab whose `TK_sync.tabId` equals `to` acts: it sets `location.hash = hash`, calls `window.focus()`, and replies `{ type:"docked", to: <the popup's tabId> }`. Other portal tabs ignore it, so a dock never moves an unrelated window.
      - The popup closes itself on `docked`. With no opener, a closed opener, no tab id, or no reply within 600 ms, it clears `mgb_shell_v1` and calls `location.assign("/" + hash)`, turning itself into the full portal in place.
      - Then `MGB_track("tasks-dock")`.
    - On a phone, the bar is compact (logo, search, avatar).
- **Checks:**
  - `[code]` A review confirms there is no `noopener` and the flag is cleared before `location.assign`.
  - `[code]` `TK_dockPlan` vectors: no opener → navigate; opener closed → navigate; opener without tab id → navigate; with tab id → post, then wait at 599 ms, close when replied, navigate at 600 ms unreplied.
  - `[code]` `TK_popOutFeatures`: no saved value → `popup,width=480,height=820`; saved `{w:200,h:300}` → clamped to 380 by 520; saved larger than the screen → clamped to `screen.availWidth`/`availHeight` (passed in for the test).
  - `[code]` A `dock` message whose `to` is another tab id is ignored (TK_sync unit test with a fake BroadcastChannel).
  - `[shot]` tk-popout-slim: the shell at 480 by 820.
  - `[shot]` tk-shell at 1280, 375 and dark.
  - `[owner]` In Chrome on desktop: pop out, edit a task in the window, and see it change in the portal. Dock returns to the same list. Close the portal tab, then dock, and the window turns into the full portal.

### 11.4 Realtime plus BroadcastChannel keep windows in sync
- **Ships:** in-place updates across windows and users.
- **Data:** the publication adds (D14). The existing `staff-reminders-<email>` channel stays as it is.
- **JS:** `TK_sync` (C5). Store upserts are deduplicated by `updated_at`. Child-table events refresh the open drawer sections through `tk:task-changed`.
- **Checks:**
  - `[code]` `TK_reduce` upsert keeps the newer row, removes deleted ones from lists, and moves a reassigned task out of `mine`.
  - `[code]` Optimistic changes roll back.
  - `[code]` One edit, one fetch: with a fake channel in SUBSCRIBED state, `TK_api.update` followed by the `mgb:staff-items-changed` event that `staffItemsApi.notify` fires, and the realtime echo of the same row, cause zero list refetches and one store upsert (count stub calls). With the channel not joined, the same edit causes at most one debounced refetch, and none inside 1 s of `markOwnWrite`.
  - `[code]` `upsert` keeps a pending optimistic field when an older row (same exact `updated_at` string, or an earlier one) arrives, and the coalesce sends one `tk:task-changed` for five child events on one task within 250 ms.
  - `[code]` A realtime DELETE payload for a task id not in the store dispatches nothing.
  - `[db]` The five tables are in `supabase_realtime`.
  - `[owner]` Two staff on two machines: a comment by one appears in the other's open drawer without a reload.

### 11.5 Every client, task and view has a URL
- **Ships:** TK routes, the LK arrivals, old links kept, and Back working inside Tasks.
- **Route grammar** (`TK_parseRoute` / `TK_formatRoute`; never lowercase the id segments):
  - `#/tasks` or `#/tasks/` → `{ view:"my" }`. The formatted form is `#/tasks/my`.
  - `#/tasks/my` → `{ view:"my" }`
  - `#/tasks/c/<enc id>[/list]` → `{ view:"client", clientId }`. A decode failure, or an `@` in the id, gives `unknown`.
  - `#/tasks/p/<uuid>[/list]` → `{ view:"project", projectId }`
  - `#/tasks/u/<uuid>` → `{ view:"person", staffId }`
  - `#/tasks/search` → `{ view:"search" }`
  - anything else → `{ view:"unknown" }`, which renders `TK_COPY.notFound` with a "Go to My Tasks" link
  - The query after `?` is ignored by TK; it belongs to LK.
- **Navigation:** TK_App navigation uses `TK_navigate`, which pushes a history entry and fires `mgb-nav`, so AN_AppNav's Back counter stays right. App's rewrite effect keeps the hash, because of the buildHashRoute regex.
- **Arrivals:** `TK_DrawerHost` calls `LK_useArrival` with `{place:"tasks", kinds:["task","view"], staff:true}`, and again with `{place:"work", tab:"tasks", kinds:["task","view"], staff:true}`, both with `ready = schema === "ok"`.
  - `task:<id>` → `TK_openTask(id)`, with `MGB_track("tasks-drawer")`.
  - `view` with a client → `TK_navigate({view:"client", clientId})`.
  - When the schema is missing, the legacy MyTasksPage claims them, as today.
- **Integration:**
  - `LK_PLACE_CLAIMS` gains `tasks: 1` and keeps `"work/tasks"`.
  - Old emailed links `#/work/tasks?item=task:<id>` keep working.
  - `LK_href`, `LK_parsePath` and `LK_go` change as in C9 item 7: `LK_href` honors `sub` for non-client places (`{place:"tasks", tab:"c", sub:"Ab/c"}` → `#/tasks/c/Ab%2Fc`), `LK_parsePath` keeps the case of `tasks` segments, and `LK_go` forwards a `work/tasks` task item to `TK_openTask` when the schema is ok and `window.TK_drawerHostReady` is true.
  - Schema missing: `TK_DrawerHost` registers the `tasks` arrival only when the schema is not missing; when it is missing, `TK_App` claims `#/tasks/...` and forwards with `LK_go({place:"work", tab:"tasks", item})`, so the legacy MyTasksPage opens the item.
  - `#/work/notes` is a real tab: StaffNav's Work tabs become tasks, notes, close and deadlines, `NAV_subFromHash` accepts `notes`, and WorkPage renders `MyTasksPage mode="notes"`, which registers no task arrivals (only `mode="tasks"` does).
  - **Call sites** (every one is edited by integration; the "After" column is the acceptance list):

    | File, line | What | After |
    |---|---|---|
    | TopBar.jsx 840 | bell item `lkGo` for a task | unchanged target; `LK_go` forwards it to the drawer |
    | TopBar.jsx 508 | ⌘K Tasks group header | `TB_go("#/tasks/my")` |
    | TopBar.jsx 951 | `TB_TasksBadge` click | `TB_go("#/tasks/my")` |
    | TopBar.jsx 345-358 | `TB_actionRows` New task, note, reminder | as in 2.11 |
    | TopBar.jsx ~964 | `TB_QuickAdd` | as in 2.11 |
    | app.jsx 6561 | client open-strip tasks chip | `to = LK_href({place:"tasks", tab:"c", sub: client.id})` |
    | app.jsx 6833 | Overview "Add" | `tk:quick-add {client_id}` |
    | app.jsx 6839 | Overview card `to` | `{place:"tasks", tab:"c", sub: client.id}` |
    | app.jsx 6865 | Overview rows | href `LK_href({place:"tasks", tab:"my", item:"task:"+id})`, click `TK_openTaskClick(id)` |
    | Today.jsx 406 | Today task row click | unchanged `lk({place:"work",…})`; forwarded by `LK_go` |
    | Today.jsx 799, 1159 | "See all" links | keep `NAV_go("work","tasks")`, which still shows the embedded `TK_MyTasks` |
    | app.jsx ~7889 | `StaffQuickActions` task kind | skipped when `TK_quickAddReady` |

    Every edit is guarded by `typeof TK_openTask === "function"` (or the schema check) so a missing schema keeps today's target.
- **Checks:**
  - `[code]` `TK_parseRoute` and `TK_formatRoute` round-trip vectors: a mixed-case id, an encoded slash, `%40` rejected, bad uuids, trailing slash, and `/list` aliases.
  - `[code]` A review confirms LK_PLACE_CLAIMS includes `tasks`.
  - `[code]` `LK_href({place:"tasks", tab:"c", sub:"Ab/c"}) === "#/tasks/c/Ab%2Fc"`, and `LK_parsePath("#/tasks/c/Ab%2Fc")` gives sub `"Ab/c"` with the case kept; `LK_href({place:"client", …})` output is unchanged for five existing vectors.
  - `[code]` With `TK_store` schema `"missing"`, `#/tasks/my?item=task:<id>` ends on `#/work/tasks?item=task:<id>` (harness check), and with schema `"ok"` and `TK_drawerHostReady`, `LK_go({place:"work",tab:"tasks",item:"task:<id>"})` opens the drawer and leaves the hash alone.
  - `[code]` `#/work/notes` renders the notes list, and an arrival `#/work/notes?item=task:<id>` is not claimed by the notes tab.
  - `[code]` For each call-site row, `rg -n` at the named line shows the "After" form (review).
  - `[shot]` tk-drawer, captured from the route `#/tasks/my?item=task:<fixture id>`.
  - `[owner]` An emailed "task assigned" link opens the task's details after a cold sign-in.

### N.1 TK_ prefix, source order, CSS per component, no bundler
- **Ships:** the file layout in B1 and C1.
- **Checks:**
  - `[code]` A grep shows no top-level identifier in `components/tasks/*` without the `TK_` prefix, apart from React-local names.
  - `[code]` Every C1 file is in `__SOURCE_ORDER`, before `components/tour/Tour.jsx` and `app.jsx`. No `.test.js` is listed.
  - `[code]` Smoke check: after load, `typeof` of each exported global in C4–C7 is defined. A Dev Tools-free check in the harness: `window.TK_App && window.TK_logic`… means checking each name.

### N.2 RLS on every new table, re-runnable SQL, nothing destructive
- **Ships:** Part D rules.
- **Checks:**
  - `[db]` The checks file returns all `ok = true`.
  - `[db]` Applying the migration twice in a BEGIN…ROLLBACK leaves the same catalog state (the verify step runs the file text twice in one rolled-back transaction).
  - `[db]` `get_advisors` (security) shows no new warnings for tk_ objects after apply (lead step).
  - `[code]` A grep shows no `drop table`, `drop column`, `truncate`, `delete from` on an existing table, `begin`, `commit` or `concurrently` in the SQL file.

### N.3 Tests in the existing *.test.js style
- **Ships:** `TK_logic.test.js`, `TK_store.test.js`, `TK_viewLogic.test.js` and `TK_drawerLogic.test.js`. They cover business-day math (D2 opt-in), status transitions, grouping, quick add, routes, the reducer, sections, sorting, timelines and attachments. README gets the run-all line: `for f in components/tasks/*.test.js; do node "$f" || break; done`.
- **Checks:** `[code]` All four pass under plain `node`, with no dependencies.

### N.4 Every screen works at phone width
- **Ships:** the phone layouts named in each row, from `TK_shellLayout` (C6). Breakpoint 760px:
  - the drawer becomes a full-screen sheet (z 1850, above every phone bar)
  - **inside the shell only**, on a touch-primary device at 760px or less, the sidebar becomes a bottom bar (My Tasks, Lists, Search, Add) at z 1450 with `padding-bottom: env(safe-area-inset-bottom)`. It is the only bottom bar there: the shell renders no portal nav, and `.tk-shell .chat-fab-wrap { display:none }` hides the chat button. Page content gets matching bottom padding.
  - **inside the normal portal** on a phone, TK adds no bottom bar (the portal's own phone nav stays); the TK sidebar becomes a "Lists" button in the list header that opens a sheet
  - from 761 to 899px the sidebar is a "Lists" sheet button; at 900px and up it is a rail
  - list columns become a second line
  - the pop-out is hidden
  - every touch target is at least 40px
  - no horizontal page scroll
  - dark mode uses only tokens
- **Checks:**
  - `[shot]` every Part F shot at 375 and dark, plus tk-shell-drawer (the drawer in the shell at 375, light and dark).
  - `[code]` `TK_shellLayout` vectors: (1280,false) rail, no bar; (800,false) sheet; (375,true) compact with bar; (375,false) compact, no bar.
  - `[code]` A grep of `tk-*.css` shows `--tk-z-drawer` and `--tk-z-bar` and no other z-index literal above 100.
  - `[code]` A grep shows no hex color outside `var(--x, #hex)` fallbacks in `tk-*.css`.
  - `[owner]` Use My Tasks and the drawer on a real phone.

### N.5 Bump MGB_VERSION
- **Ships:** the C10 string in `index.html` (integration), and the What's new entry (docs).
- **Checks:** `[code]` The label equals `2026-10-11a`, and whats-new.md has a matching "2026-10-11" heading.

---

## Part F. Screenshots for the stub harness

Every shot is taken at desktop 1280, phone 375 and dark (1280). Fixtures:
- signed in as an admin or bookkeeper, as noted
- two test clients (`tk-test-a`, `tk-test-b`)
- the four seed projects
- about 14 tasks spread across every group and status, with made-up text
- comments, activity, followers and attachments on `TK_FIXTURE_TASK`
- `TK_REVIEW_TASK`: an open `review_required` task assigned to the bookkeeper; the fake `tk_set_status` answers `ready_for_review` for it
- `tk_schema_version` returning 1, unless noted

| name | route | state |
|---|---|---|
| tk-my-default | `#/tasks/my` | bookkeeper; every group filled, Done collapsed |
| tk-my-empty | `#/tasks/my` | no tasks |
| tk-my-loading | `#/tasks/my` | list request held pending |
| tk-my-error | `#/tasks/my` | list request fails |
| tk-my-offline | `#/tasks/my` | `navigator.onLine` false after load |
| tk-my-setup | `#/tasks/my` | `tk_schema_version` missing (PGRST202) |
| tk-drawer | `#/tasks/my?item=task:TK_FIXTURE_TASK` | drawer open, details and checklist and footer |
| tk-drawer-comments | `#/tasks/my?item=task:TK_FIXTURE_TASK` | Comments tab, one mention, composer with the @ listbox open |
| tk-drawer-activity | `#/tasks/my?item=task:TK_FIXTURE_TASK` | Activity tab |
| tk-drawer-files | `#/tasks/my?item=task:TK_FIXTURE_TASK` | files section; Drive status off |
| tk-drawer-sop | `#/tasks/my?item=task:TK_FIXTURE_TASK` | SOP section slide-over open |
| tk-drawer-deleted | `#/tasks/my?item=task:TK_DELETED_TASK` | deleted banner and Restore |
| tk-status-menu | `#/tasks/my` | first row's status menu open, review_required task, bookkeeper |
| tk-quick-add | `#/tasks/my` | quick add open with a typed line and parsed chips |
| tk-list-client | `#/tasks/c/tk-test-a` | client header, sections, People chips |
| tk-list-project | `#/tasks/p/TK_FIXTURE_PROJECT` | project header, members, sections |
| tk-new-project | `#/tasks/my` | New project modal open |
| tk-list-person-admin | `#/tasks/u/TK_FIXTURE_STAFF` | admin |
| tk-list-phone-filters | `#/tasks/c/tk-test-a` | Filters sheet open (meaningful at 375) |
| tk-search | `#/tasks/my` | ⌘K open with "reconcile" and task results |
| tk-search-view | `#/tasks/search` | typed query, results |
| tk-keys-sheet | `#/tasks/my` | `?` sheet open |
| tk-shell | `/?shell=tasks#/tasks/my` | standalone bar, no rail or top bar |
| tk-bell-mention | `#/today` | bell open with one `tkm:` item |
| work-tasks | `#/work/tasks` | TK_MyTasks embedded under the Work tabs |
| work-notes | `#/work/notes` | legacy Notes & SOPs content |
| today-rows | `#/today` | task rows in the now and soon bands, no waiting tasks |
| overview-tasks | `#/client/tk-test-a/overview` | Overview tasks card, one waiting task shown as waiting |
| tk-drawer-toast | `#/tasks/my?item=task:TK_REVIEW_TASK` | bookkeeper marks a review_required task done in the drawer; the "Sent for review" toast shows above the open drawer |
| tk-drawer-stack | `#/tasks/my` | SI chat drawer opened, then a task opened (chat drawer closed), then one Esc: only the list remains |
| tk-shell-drawer | `/?shell=tasks#/tasks/my?item=task:TK_FIXTURE_TASK` | shell with the drawer as a full-screen sheet and the bottom bar under it; meaningful at 375 (touch emulated), light and dark |
| tk-popout-slim | `/?shell=tasks#/tasks/my` | viewport 480 by 820 (the pop-out default): rail collapsed to the Lists button, no bottom bar |
| tk-quick-add-noclient | `#/today` | TopBar + menu open with no client: one item, "New task" |

---

## Part G. Owner live checks

1. Read Part A and confirm it matches what you want staff to get.
2. After the migration is applied: sign in as an admin, open My Tasks, and see your existing tasks with nothing missing.
3. With a bookkeeper test account, confirm you can't see a client's tasks unless you're assigned, covering or granted, and can't see the Owners or Directors projects. Confirm the bookkeeper **can** see and add to the SOPs and 90 Day projects, since those start open to all staff (Part A); if you want either one private, an admin turns off "Open to all staff" on it.
4. Mark a "Needs review" task done as a bookkeeper, see it go to Ready for review, and approve it as an admin.
5. Mention a teammate in a comment and confirm they see it in the bell within a minute.
6. Upload a PDF to a test client's task with Drive connected, and find it in that client's Drive folder as internal.
7. On a Vercel preview: open `/tasks`, sign out and back in, and land back in the slim shell. Then pop out, edit a task, dock, and confirm the portal shows the change.
8. Open a "task assigned" email link from before this change, and confirm the task's details open.
9. Two machines: confirm a comment by one appears in the other's open task without a reload.
10. Use My Tasks and the task details on your phone, in light and dark mode.
11. After a week, decide whether to keep the Today group (D6) and the four starter project names.
12. Deploy order: the migrations (`tasks_module_v1`, `tasks_module_v1_fix_1`, `tasks_module_v1_fix_2`) are applied. Deploy `notification-emails` and `client-emails` next, before or with the app, never after it: until both are live they can still email a due reminder or list a value-report item for a task staff deleted. Then ship the app. Put both functions on the release checklist.

---

## Part H. Risks and notes

- **Function rewrites (D6, D10, D13)** must start from the live bodies, not the repo files, because the live bodies differ (for example, `staff-offboarding.sql` holds the current trigger). The checks file confirms the patched readers mention `deleted_at`.
- **Edge-function edits** (`notification-emails`: `.is("deleted_at", null)` and `.neq("status","waiting_client")` on the task_due query; `client-emails`: `.is("deleted_at", null)` on the value report) need the migration's columns, which are now live. Their missing-column fallback keeps them working either way. Deploy both before or with the app (Part G item 12). `notification-emails` also filters `task_due` by client access (fix 1).
- **Admins now edit any task** through "tk edit tasks", as the 2026-10-10 decision says (owner, assignee or any admin). The live non-owner revert still keeps `staff_email`, `created_by`, `client_id` and `visibility` with the owner.
- **The "mine" rule moves** from owner-or-assignee to assignee-first (`TK_isMine`). A creator no longer counts tasks they gave away on their badge. This is stated in Part A.
- **No emails in Phase 1** for mentions, so the outbox and email-log CHECKs stay as they are.
- **The pop-out shares sessionStorage** copied from the opener at creation. The boot script sets the shell flag from `?shell=tasks`, so the copied state does no harm.
- **Deletes become hides** (D9). Any `.delete()` on staff_reminders from a signed-in user, from any build, now sets `deleted_at` instead. A real removal needs the service role or `mgb.tk_hard_delete = 'on'` in SQL. This is the one behavior change old builds see; it is what the 2026-10-10 "keep history" decision asks for.
- **Realtime DELETE events skip RLS.** Unfollow and checklist deletes broadcast their primary keys (task id plus staff email, or a uuid) to every subscriber of those tables. Accepted for Phase 1 (D14): staff emails are visible to all staff already, and the client ignores DELETE payloads for tasks it has not loaded. Channel names carry a random tab id, never an email.
- **SOPs and 90 Day start open to all staff.** That is a default chosen in this revision (the 2026-10-10 notes did not say). The owner confirms it in Part G item 3; an admin can change it per project without a migration.
- **Mixed-case staff rows** are skipped by follower and member inserts instead of failing the write. The checks file reports how many exist (0 today).
- **Deleted deadline and template tasks** still block regeneration (`Deadlines.jsx` reads source_ref without a deleted filter, and `template_ref_uniq`). This is intended and needs no change.

---

## Critique log

Two critics (database, and UI and integration) reviewed the first draft on 2026-10-11. Every finding is listed in the order it was raised. "Accepted" means the fix was made as proposed or in an equivalent form. "Partly" means the problem was fixed but part of the proposal was not taken, and the reason says which part. Facts the critics cited were rechecked read-only against the live database and HEAD before deciding.

| # | Sev | Finding (short) | Verdict | Reason | Changed |
|---|---|---|---|---|---|
| 1 | must | D6: the live INSERT branch ends in `return new;`, so the tk blocks would run on UPDATE only (no project check, no done→status, no review gate on insert) | Accepted | Confirmed in the live body. Restructured as proposed: INSERT branch loses its early return, live revert and UPDATE due sync wrapped in `tg_op = 'UPDATE'`, INSERT due sync kept, every tk block runs for both operations | D6 code and notes; T1 test; 1.4 non-member insert check kept |
| 2 | must | D2: `insert … returning` checks the SELECT policy before AFTER triggers add the creator as member, so non-admin project creation fails | Accepted | Postgres checks the SELECT policy on RETURNING before AFTER ROW triggers. Non-admin `owner_email` is forced to the jwt in BEFORE INSERT, the select policy adds `owner_email = lower(jwt)`, and `tk_can_see_project` covers the owner too | D2 triggers, policy and helper; C5 `createProject` uses `.select()`; T2 test |
| 3 | should | Owner can hard-delete a task via "staff manage own reminders" (ALL) or the view, and the cascade wipes teammates' comments and files | Accepted | A BEFORE DELETE definer trigger turns any signed-in delete into `deleted_at`. Bypassed only with no jwt (service, SQL) or `mgb.tk_hard_delete = 'on'`. It is listed as a non-additive change, and the tk_tasks view is now select-only | D9 trigger and notes; Part D header (five changes); C3 row; T4; checks #3 and #9; Part H |
| 4 | should | Default ACLs give anon and authenticated every privilege on new tables, views, sequences and functions | Accepted | Confirmed in `pg_default_acl`. Every new table, the view and `tk_activity_id_seq` start with `revoke all … from anon, authenticated`, then exact grants. Functions revoke from public and anon | Part D general rules; D2, D8, D11 grants; checks #4a; T13 |
| 5 | should | `tk_search` as invoker cannot use the GIN index, because `@@` is not leakproof | Accepted | Confirmed `ts_match_vq` is not leakproof. `tk_search` is now definer, returns nothing unless active staff, and filters with `tk_row_readable` after the index match | D10 `tk_search`; C3 row; T7; checks #3; 2.13 checks |
| 6 | should | Mentions by read-only followers add followers, which gets around "only editors add people" | Partly | Mentions add followers only when the author passes `tk_can_edit_task`; otherwise the mention is stored but no follower is added. Not taken: tightening `tk_task_scope_ok` for private tasks with no container, because editors legitimately add followers there through the same function, and the hole was the mention path, which is now closed | D8 `tk_comments_follow`; D5 note; T9 |
| 7 | should | Comment UPDATE leaves `mentions`, `edited_at` and `deleted_by` client-controlled; follower trigger is INSERT-only | Accepted | Mentions are recomputed on every update, `edited_at` and `deleted_by` are set only by the trigger, and the follower trigger is `AFTER INSERT OR UPDATE OF body`, adding only new mentions under the same editor rule | D8 `tk_comments_before_write` and `tk_comments_follow`; T10 |
| 8 | should | `mgb.tk_rpc` in the staff_reminders bypass outlives the RPC (transaction-scoped) and could open the review gate | Accepted | `tk_rpc` removed from `v_bypass`; every flag is reset to `''` right after its write; `mgb.tk_approve` dropped (`v_admin` covers it) | D6 `v_bypass` and notes; D8 `tk_attach_client_file`; D10 `tk_set_status` step 8 |
| 9 | should | `tk_set_status` from done lets done → waiting_client / ready_for_review through, and writes two activity rows | Accepted | It now locks and reads the current status, raises `22023 tk_bad_transition` for same-status and the two illegal targets, and moves from done in one update (todo still goes through `complete_staff_item`) | D10 `tk_set_status`; C3 errors; C4 `TK_nextStatuses`; T5, T6; 2.2 checks |
| 10 | should | Soft-deleted tasks still counted by TeamPage, notified by `notify_enqueue_task_assigned`, and moved by `offboard_staff` | Partly | TeamPage filters `deleted_at` with its existing retry, and the notify function returns early for deleted rows (declared as a rewritten live body). Not taken: filtering `offboard_staff`'s move, because moving deleted rows keeps their history with the right person, and the notify fix already stops the emails. Reassigning a `ready_for_review` task still notifies, since the new assignee should know | C9 item 10; D13 notify item; Part D header; T12; checks #9 |
| 11 | should | Roll-forward insert fails block 3 for an owner who is no longer a project member | Accepted | `complete_staff_item` sets `mgb.tk_rollforward` only around the next-occurrence insert; block 3 skips its membership check for that insert only | D6 `v_roll`; D10 `complete_staff_item`; T11 |
| 12 | should | SOPs and 90 Day seeds have no members, so bookkeepers cannot see them, contradicting Part A | Accepted | Added `open_to_staff` to tk_projects (it counts as membership, never as manage). The seed sets it true for SOPs and 90 Day, false for Directors and Owners, and never changes an existing row. This is a default the owner confirms | D2 column, helpers and seed; C2, C3; Part A; 1.4 UI and checks; T8; Part G item 3; Part H |
| 13 | should | Assignee index is on `lower(assignee_email)`, which `listMine`'s equality filter cannot use | Accepted | The trigger already lowercases. Index is now `(assignee_email, done, due_date) where deleted_at is null` | D4 |
| 14 | should | Any 42703/PGRST204/PGRST202/42883 sets the schema to missing and hides real bugs | Accepted | Those codes re-run the probe; the schema becomes missing only on PGRST202 for `tk_schema_version`; otherwise the real error shows. TK_sync channels start only when the schema is ok | B4; C4; C5 TK_sync |
| 15 | nit | Global unique project name blocks two "Onboarding" projects and reveals hidden names | Accepted | Unique on `(coalesce(client_id,''), lower(name)) where archived_at is null`; 23505 maps to `tk_name_taken` and a friendly message. A duplicate of a hidden internal name can still collide, which is accepted (it reveals only that the name is taken) | D2 index; C5; C10 `projectNameTaken`; 1.4; T3 |
| 16 | nit | `tk_can_upload_task_file` missing from C3, grants and checks | Accepted | Added with an explicit grant (the storage policy runs as the caller) and to checks #3 | C3; D12; checks #3 |
| 17 | nit | `tk_assignable_staff` reveals who can see any client; `tk_project_info` callable for any uuid | Partly | `tk_assignable_staff` returns nothing unless the caller can access the client or see the project. Not taken: revoking `tk_project_info`, because D6 is an invoker trigger and calls it as the caller, so the revoke would break every project task write. It is gated by `is_active_staff()` instead and returns only found, client id and archived | D10; C3; D2 helper note |
| 18 | nit | "tk edit tasks" WITH CHECK sees the old row, not the new values | Accepted | Comment added: safe because D6 pins every access column; a later new-row rule must pass columns in | D9 notes |
| 19 | nit | Non-admin can create a project owned by someone else | Accepted | Same fix as #2: BEFORE INSERT forces the owner for non-admins, and BEFORE UPDATE pins it | D2 triggers; T2 |
| 20 | nit | Realtime DELETE events skip RLS; topic names carry emails | Accepted | Noted in D14 and Part H, with the leaked keys spelled out (followers and checklist items; `tk_project_members` is not published). Channel names now use the random tab id, not the email. The client ignores DELETE payloads for unloaded tasks | D14; C5 TK_sync; C8 channel rows; 11.4 check; Part H |
| 21 | nit | `TK_api.update` reports RLS denial as a conflict, and Date round-trips break the `updated_at` equality | Accepted | The base is the exact server string; on 0 rows `TK_api.get` decides between `tk_conflict` and `tk_forbidden`; no automatic retry | C5 `TK_api.update` |
| 22 | nit | Follower and member inserts fail the task write if a staff email is mixed case | Partly | Inserts match only `s.email = lower(s.email)`, so a mixed-case row is skipped and the write never fails. Not taken: a NOT VALID CHECK on `staff.email`, because that changes an existing table owned by other features for a case that does not exist today (0 rows); the checks file reports the count instead | D2, D7, D8, D10 inserts; checks #8 |
| 23 | must | List and drawer key handlers both fire on one press (`x` toggles two tasks) | Accepted | `TK_useKeys` takes `enabled`, lists pass `!drawerId`, and the drawer root carries `data-tk-keyscope="drawer"`, which `TK_shouldHandleKey` checks per scope | C4; C5 store `drawerId`; C6; C8 scopes; 3.6 checks |
| 24 | must | Overview card `to` string is not an LK target, and `LK_href` would encode the slash | Accepted | `LK_href` honors `sub` for non-client places (`#/tasks/c/Ab%2Fc`), `LK_parsePath` keeps case for tasks, canonical targets are fixed, and rows use `TK_openTaskClick`, which leaves modifier and middle clicks to the browser | C7; C9 item 7; 2.1 and 11.5 checks |
| 25 | should | TK drawer focus trap and Esc fight SI_ChatDrawer and WidgetDrawer | Accepted | Drawer stack rule: opening the TK drawer dispatches `tk:drawer-open`, which closes the legacy drawers; the TK Esc/Tab handler is capture-phase on document, stands down for modals, menus and the tour, and stops propagation | C7; C8 stack rule; B1 integration owns StaffInbox and WidgetDrawer; 3.6 checks; tk-drawer-stack shot |
| 26 | should | TK drawer z-index unspecified; toasts must sit above it | Accepted | TK drawer 1850 (scrim 1849) at every width, shell bar 1450, as CSS variables; below modals 2000 and toasts 2100 | C8 layers; N.4 check; tk-drawer-toast shot |
| 27 | should | Pop-out opens at 1180 wide though Part A calls it slim; Dock hidden by width; shell breakpoints unstated; add dock checks | Partly | Default 480 by 820 with the last size remembered; phone means touch-primary, not width; Dock shows when an opener exists or the device is not touch-primary; `TK_shellLayout` states the breakpoints; `TK_dockPlan` has the 600 ms and closed-opener checks. Not taken: focusing an arbitrary main window over BroadcastChannel, because any portal tab would jump; dock now targets only the opener's tab id and otherwise turns the popup into the portal in place | C6; C8 storage; 11.2 UI and checks; tk-popout-slim shot |
| 28 | should | Legacy entry points still open the old task modal; TB_QuickAdd hides without a client; Today has no "Add task" button; `currentClientId` source unstated | Accepted | Entry-point table in 2.11 covers each one; the false Today button line is removed; `currentClientId` comes from the parsed client hash | 2.11; C7 `TK_QuickAddHost` |
| 29 | should | Several legacy call sites still land on old work/tasks | Accepted | Both proposals taken: a call-site table in 11.5, and `LK_go` forwards work/tasks task items to the drawer when the schema is ok and the host is mounted | 11.5; C9 item 7 |
| 30 | should | Legacy completion and overdue paths ignore review status | Accepted | Today, the reminders card, the Overview card and tab counts use `TK_api.complete`, `TK_isOpen`, `TK_isOverdue` and `TK_effectiveStatus`, with the legacy code as the fallback branch | C5 `TK_api.complete`; C9 item 9; 3.1 integration and checks |
| 31 | should | Realtime plus legacy notify cause two or three refetches per edit and can roll back optimistic patches | Accepted | One source of events: the legacy event is ignored while the TK channel is joined, a debounced fallback otherwise, own writes marked, child events coalesced over 250 ms, and upsert keeps pending optimistic fields | C5 store and TK_sync; 11.4 checks |
| 32 | should | Sign-in drops the TK route and the shell flag | Accepted | The shell flag lives in sessionStorage; App restores a stashed TK hash verbatim from `PENDING_ROUTE_KEY` when it matches the TK pattern | C8 storage; 11.1 sign-in round trip and checks |
| 33 | should | With the schema missing, `place:"tasks"` arrivals expire silently | Accepted | DrawerHost registers the tasks arrival only when the schema is not missing; otherwise TK_App forwards to work/tasks with `LK_go` | B4; C7; 11.5 integration and checks |
| 34 | should | Boot script order underspecified; install script wipes `history.state`; a `/tasks/` rewrite breaks relative URLs | Accepted | Boot code merged at the top of the first head script; every `replaceState` keeps `history.state`; `/tasks` and `/tasks/` are Vercel redirects to `/?shell=tasks` instead of a rewrite | 11.1; B1 integration |
| 35 | should | Phone bottom bar collides with the existing fixed bar; no safe-area handling | Partly | Rechecked: styles.css 10402 is the client tabbar, which staff never see, so that collision does not exist. The substance was taken: the TK bottom bar exists only inside the shell on touch-primary phones, is the only bottom bar there, hides the chat button, and uses safe-area padding; in the normal portal TK adds no bottom bar | N.4; C6 `TK_shellLayout`; tk-shell-drawer shot |
| 36 | should | `#/work/notes` contract missing | Accepted | Notes tab added to StaffNav and `NAV_subFromHash`; WorkPage renders `MyTasksPage mode="notes"`, which registers no task arrivals | C9 item 6; 11.5 integration and checks |
| 37 | nit | Scope of `q` and `?` inconsistent; `.tb-search` not skipped | Accepted | `q` is global on every staff page; `?` is list and drawer; `TK_shouldHandleKey` skips inputs and `.tb-search` | Part A; C8 keymap and scopes; 3.6 checks |
| 38 | nit | Tips' window Esc also closes on the same press | Accepted | Covered by #25: the drawer's capture handler stops propagation when it handles Esc | C8 stack rule |
| 39 | nit | Not every row has a runnable check | Accepted | Rows 1.4, 2.1, 2.2, 2.11, 3.1, 3.6, 11.1, 11.2, 11.4, 11.5 and N.4 gained `[code]`, `[db]` or `[shot]` checks owned by the slice that ships them; the DB tests are numbered T1 to T14 | Part D tests; Part E; Part F |
