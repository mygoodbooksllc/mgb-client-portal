# Slate plus: custom fields on tasks

Status: built hidden 2026-10-28 (feature 2 of the Slate "better than Asana" plan). Part of the
"Slate plus" batch. Owner decision 2026-10-28: build custom fields, bounded as below (recorded in
`docs/slate-differentiators.md`, Guardrails).
Gate: per-person flag `mgb_slateplus_preview` (Developer tools > Feature flags, "Slate plus
preview") or the firm switch `tk_settings.slateplus_enabled` (NOT SET = off; code never sets it).
Shared check: `TKP_on()` / `TKP_useOn()` in `components/tasks/TK_slatePlus.js`.

Aim: let a project or a client's list carry a few extra facts per task (for example "Fund",
"Bank account", "Grant", "Board meeting date", "Reviewed by treasurer") without turning Slate into
a general-purpose database. Bounded: at most 15 active fields per project or client, six types,
20 options per dropdown.

## 0. Audit (how tasks work today, and what this touches)

- Tasks are rows in `staff_reminders` (read through the `tk_tasks` view). A task sits on a
  client's list (`client_id`), in a project (`project_id`), both (a project tied to a client:
  the database copies the project's client onto the task), or neither (personal).
- Who can read a task: `tk_can_read_task(id)` (owner, admin, assignee, follower; on a client list
  `can_access_client` plus shared or involved; in a project `tk_is_project_member` plus shared or
  involved; MGB internal clients only with internal access). Who can edit: `tk_can_edit_task(id)`
  (owner, admin, assignee who can read it, shared task on a client you can reach, shared project
  task for a member). Followers read and comment, never edit.
- Who manages a project: `tk_can_manage_project(id)` (admin, the project owner, or a member with
  role owner; Open to all staff never grants manage). Who sees a project: `tk_can_see_project(id)`.
- The drawer (`TK_DrawerContent.jsx`) is a label / value grid; Slate plus rows (Blocked by) slot in
  as `<TK_DwDepsRow>`. Rows (`TK_TaskRow.jsx`) build a `meta` chip array. The project header
  (`TK_vProjectHeader` in `TK_List.jsx`) and client header (`TK_ClientHeader.jsx`) have a
  `tk-head-actions` strip. The Slate plus filter bar (`TK_filterLogic.js`, `TK_FilterBar.jsx`)
  filters the cross-client Slate page; its saved views are validated on the server.
- Team load, Calendar, Board, search and the Slate page read the same task objects; nothing there
  changes. Custom field values live in their own table and never change a task row.

## 1. What staff see (preview on)

- **Fields button** in the project header and the client list header (next to the other header
  buttons): "Fields" with a count when there are any. Opens the **Fields** panel.
  - Everyone who can see the list can open it and read the field list.
  - Project: admins and project owners can add, rename, reorder, edit dropdown options, archive
    and restore. Client list: admins only. Others see "Only an admin or the project owner can
    change fields." (client list: "Only an admin can change a client's fields.").
  - Add a field: name (1 to 40 characters, unique in that list, any case), type (Text, Number,
    Dropdown, Date, Checkbox, Person), and for Dropdown 1 to 20 options (each 1 to 40
    characters, no repeats). The type is fixed once made (make a new field to change it).
  - Up to 15 active fields per project or client. At the cap: "15 fields is the most for one
    list. Archive one to add another."
  - **Archive** hides the field everywhere (drawer, chips) but keeps every value. **Show archived**
    lists archived fields with **Restore** (subject to the cap and the name rule).
  - Removing a dropdown option that tasks still use keeps it as a hidden (retired) option: those
    tasks keep showing it, but it can no longer be picked. Renaming an option renames it on every
    task (values store the option's id, not its label).
- **Task drawer**: one row per active field that applies to the task, under Blocked by. A task in a
  project tied to a client gets the project's fields first, then the client's. Editors:
  - Text: one line, up to 500 characters, saved on blur or Enter (Esc reverts).
  - Number: saved on blur or Enter; "Enter a number." when not one.
  - Dropdown: a select with the options (plus the current retired one, marked "(retired)").
  - Date: a date picker.
  - Checkbox: a tick box.
  - Person: a select of active staff.
  - Anyone who can edit the task can set values; followers and read-only views see them disabled.
  - Hover a value's label for "Last set by <name>, <date>".
- **Task rows**: chips for filled fields, at most 3, then "+N" (hover lists the rest). A chip reads
  "Fund: Building" (Checkbox: just the field name with a check). Empty values, unticked boxes and
  archived fields show no chip.
- Nothing shows in View as, for clients, or with the preview off.

## 2. Data (supabase/slateplus-customfields.sql, additive only)

### Tables (RLS on, select only for authenticated, every write through an RPC)

`tk_custom_fields`: `id uuid pk`, `scope text` (`project` | `client`), `project_id uuid` (fk
`tk_projects`, cascade), `client_id text` (fk `clients`, cascade), exactly one set to match the
scope; `name text` (trimmed, 1 to 40), `type text` (`text`, `number`, `dropdown`, `date`,
`checkbox`, `person`), `options jsonb` (array, at most 40 entries incl. retired; `[]` unless
dropdown), `position int`, `archived_at`, `archived_by`, `created_by`, `created_at`,
`updated_at`, `updated_by`. Partial unique index on (scope target, lower(name)) where not archived.

`tk_custom_field_values`: `field_id uuid` (fk, cascade), `task_id uuid` (fk `staff_reminders`,
cascade), `value jsonb` (null = cleared; the row stays), `updated_by`, `updated_at`; primary key
(field_id, task_id); index on task_id.

Option shape: `{"id": "o1a2b3", "label": "Building", "retired": false}`. Ids are 1 to 40 of
`[A-Za-z0-9_-]`, unique in the field.

Value shape by type: text = JSON string (trimmed, 1 to 500); number = JSON number (absolute value
under 1e12, at most 6 decimals); dropdown = option id (string); date = "YYYY-MM-DD" (a real date,
years 1900 to 2200); checkbox = true / false; person = lowercase email of active staff. Empty text
stores null.

### Read policies

- Fields: active staff and (project: `tk_can_see_project(project_id)`; client:
  `can_access_client(client_id)`).
- Values: active staff, `tk_can_read_task(task_id)` (exactly who can read the task), and the
  value's field applies to the task's current project or client and is visible to the caller
  (`tk_can_see_project` / `can_access_client`). A task you cannot read never leaks a value, and a
  value saved under an old project (task moved) or a private project's field stays unreadable.
  `tk_cf_values` applies the same rule.
- No anon access anywhere; `revoke all` from anon and authenticated, then `grant select` to
  authenticated.

### Validation trigger (BEFORE INSERT OR UPDATE on values)

`tk_custom_field_values_check`: loads the field; rejects (`tk_cf_bad_value`) a value of the wrong
type, too long text, bad number, bad date, an option id that does not exist, a retired option (unless
unchanged), a person who is not active staff. On a value change it also refuses an archived field
(`tk_cf_archived`) and a field that does not apply to the task's current project or client
(`tk_cf_wrong_scope`). Normalizes (trims text, lowercases person) and stamps `updated_at`.

### RPCs (security definer, `search_path public, pg_temp`, execute revoked from public and anon)

- `tk_cf_field_save(p_id, p_scope, p_target, p_name, p_type, p_options)` creates (p_id null) or
  edits. Manage check (`tk__cf_can_manage`): project = `tk_can_manage_project` and the project is
  not archived or trashed; client = active admin who `can_access_client`. Caps: 15 active per
  target (`tk_cf_limit`), name rule (`tk_cf_bad_name`, `tk_cf_name_taken`), type fixed on edit
  (`tk_cf_type_locked`), options (`tk_cf_bad_options`) merged by `tk__cf_merge_options`, which
  keeps any option still used by a value as retired. Editing an archived field is refused
  (`tk_cf_archived`; restore first).
- `tk_cf_field_archive(p_id, p_archive boolean)` archives or restores (restore re-checks the cap
  and the name).
- `tk_cf_field_order(p_ids uuid[])` sets positions for the active fields of one target (all ids
  must be that target's active fields).
- `tk_cf_value_set(p_field, p_task, p_value jsonb)`: `tk_can_edit_task(p_task)`, task not in the
  trash, its project not archived or trashed, field active and applies to the task; updates the
  row first and inserts only when there is none (an `INSERT ... ON CONFLICT` would run the BEFORE
  INSERT trigger on the proposed row first and refuse re-saving an unchanged retired option), and
  returns the stored value.
- `tk_cf_values(p_task_ids uuid[] default null)`: values (non-null, active fields only) for the
  given tasks, or for every open task the caller can read when null (max 5000 rows).
- All raise `tk_forbidden` (42501) for a non-staff caller or one without rights.
- Locking: one advisory lock per target for field saves, archive and order; field save and archive
  re-read the field `FOR UPDATE` after the lock; the values trigger reads the field `FOR SHARE`, so
  an options edit and a value save on the same field run one after the other.

## 3. Rules and edge cases

- A task that moves to another project or client keeps its old values (never deleted) but they no
  longer show, because only the fields of its current project and client apply. Moving it back
  shows them again.
- A trashed project or client list keeps its fields; values return if restored.
- A retired dropdown option still displays on tasks that use it; it cannot be newly picked.
- Archiving a field hides it; values stay. Restoring brings them back.
- Person fields store an email; someone who leaves keeps showing by name (or email) on old tasks,
  but cannot be newly picked.
- The client app never loads any of this. View as turns the gate off (no network).
- Slate app compact window: the Fields panel is read-only ("Make the window wider to edit"), as
  with Sections.
- A task assignee who is not a member of a private project can open the task but cannot see that
  project's field definitions (the field read policy follows `tk_can_see_project`), so the drawer
  shows no field rows for them, and the value read rule hides those values too. Accepted: private
  project fields are the project's business.
- Done tasks are not in the bulk value load (open tasks only); the drawer loads one task's values
  when it opens (`TKCF_loadTask`), so done tasks show and keep their values.
- View as: `tk_cf_values` is in `MGB_VIEW_AS_SILENT_RPCS` as a backstop (the gate is already off).

## 4. Self-critique (and what changed because of it)

- *Client fields: who manages?* The brief says admins and project owners. A client list has no
  owner, so only admins manage client fields. Design call left for the owner: let a client's
  account manager manage them too.
- *Values per task via a JSON column on `staff_reminders`?* Rejected: it would touch the hottest
  table, its triggers and Realtime payloads. A side table keeps the old app byte-for-byte the same.
- *Direct table writes with RLS?* Rejected in favor of RPCs (like dependencies): one place for the
  cap, the merge of options and the scope check, and the trigger still guards every write.
- *Filters in the Slate plus filter bar:* the bar filters across all clients and its saved views
  are validated on the server, while fields belong to one project or client. Not cheap; follow-up
  (below).
- *Activity log entries for value changes:* widening `tk_activity`'s kind list collides with other
  work in flight; instead each value keeps who set it and when (hover). Follow-up.

## 5. Follow-ups (not built)

- Field filters (dropdown, checkbox, person) in the Slate plus filter bar when it is narrowed to one
  client or project, and in saved views.
- A column picker / sort by a field on project and client lists (`TKCF_compare` is ready).
- Value changes in the task Activity tab.
- Copying a project's fields when a project is made from another (New project form "Start from").
- Optional: account managers manage their clients' fields.
- A done task's values (loaded when its drawer opens) are not refreshed by later bulk loads, and
  another person's change shows only after the next reload or drawer open. The bulk read is capped at
  5000 rows with no notice (far above today's open-task count).
- Each task row adds its own window listener for field changes (two per row with Blocked by). Fine
  at today's list sizes; a shared subscription would be lighter.

## 5b. Build record

- Migrations applied 2026-10-28: `slateplus_customfields`, then
  `slateplus_customfields_value_set_fix` (update-then-insert in `tk_cf_value_set`), then
  `slateplus_customfields_review_fixes` (after the Opus review: value read rule needs a visible,
  applying field; field row locks in save, archive and the trigger; `pg_temp` in every
  `search_path`).
- SQL self-test `supabase/slateplus-customfields-tests.sql` (one DO block, rolls back, RLS as
  non-admin staff, a project member, non-members and an admin, plus a task moved off its project):
  69/69 passed after the review fixes; both tables empty afterwards.
- Node test `components/tasks/TK_customFields.test.js` (rules, gate off is inert, fake-API flow,
  an older failed save never undoes a newer one).
- Review fixes in the browser code: an unknown dropdown id shows no chip; a failed rename puts the
  old name back; the date input ignores half-typed years instead of toasting; an optimistic save
  only rolls back (or settles) its own entry.
- Code: rules and runtime `TK_customFields.js` (`TKCF_`), UI `TK_CustomFields.jsx`, styles
  `tk-customfields.css`, API `TK_api.cf*`.

## 6. Launch checklist (owner says go)

1. Final Opus verify with the preview on and off.
2. Owner sets `slateplus_enabled` (whole Slate plus batch) from the SQL editor.
3. Publish the guide section, tip and notice below.

## 7. Drafts (NOT published; publish at launch)

### Staff guide (Slate: Custom fields)

> **Custom fields.** A project or a client's task list can carry up to 15 extra fields, such as
> Fund, Grant or Board meeting date. Open the list and click **Fields** in its header. Admins and
> the project's owner add fields (Text, Number, Dropdown, Date, Checkbox or Person), rename them,
> change their order and dropdown options, and archive them. On a client's list only admins
> change fields. Anyone who can edit a task fills its fields in the task details, under Blocked
> by. Filled fields show as small chips on the task row (three at most, then +N). Archiving a
> field hides it but keeps every value; Show archived brings it back. Removing a dropdown option
> that tasks use keeps it on those tasks as retired.

### Next-visit notice (`slateplus-customfields`)

> **New: custom fields.** Projects and client lists can now have their own fields, like Fund or
> Grant. Click Fields in the list header to see them, and fill them in on any task you can edit.

### Tour step (project header Fields button, `data-tour="tkcf-fields"`)

> "Fields: extra facts for every task in this list. Admins and project owners set them up here;
> anyone who can edit a task fills them in its details."

### Tip (`tkcf-chips`)

> "Filled custom fields show as chips on the row. Hover +N to see the rest."
