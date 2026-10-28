# Slate plus: workload strip (spec + self-critique)

Status: built 2026-10-27, hidden behind the Slate plus preview. Part of the "Slate plus" batch (sibling features share the same gate).

## 1. Goal
The person handing out work sees, on the Slate page, who is overloaded this week: per active staff member, open tasks, tasks due this week, late tasks (when late tasks count), and hours for admins. Click a person to see Slate filtered to them.

## 2. Gate (shared by the Slate plus batch)
- Per-person preview: localStorage `mgb_slateplus_preview` = "1" (Developer tools > Feature flags > "Slate plus preview", reloads the page).
- Firm switch: `tk_settings.slateplus_enabled`. Not set = off. Owner-only (added to `tk__owner_only_key`). Code never writes it.
- One check: `TKP_on()` / `TKP_useOn()` in `components/tasks/TK_slatePlus.js`. Off for View as (it would show the admin's numbers, not the viewed person's).
- Off: nothing renders, no RPC call, no extra network request (the switch is read only when the Slate page mounts the strip; with no preview and the cached switch off, it is still read once per page load, read-only).

## 3. Data
- New RPC `tk_slateplus_workload()` (supabase/slateplus-workload.sql): SECURITY DEFINER, read-only, `is_active_staff()` required (42501 otherwise), anon has no execute. Returns counts only: staff_id, email, name, role, is_me, open_count, due_week, late_count, week_start, week_end. No task text, client ids or client names.
- Counting rules: assignee only (Unassigned never counts for anyone); not done, not trashed, status not waiting_client (that is on the client); test and internal (MGB) clients excluded (same as Team > Capacity); other people's private tasks excluded, your own count on your row.
- Week: Monday to Sunday, America/Chicago (same zone as `tk_late_count_from`).
- Late: same firm rule as Team (due before today, on or after `tk_late_count_from()`, not `tk_late_excused`). While the grace period is on (late tasks don't count against staff) late_count is NULL and the column is hidden, matching the hidden Overdue column on Team > Capacity.
- Hours: reuse `TP_useCapacity` (TeamCapacity.jsx: staff_capacity + qbo_hours_by_staff). Admin only, because both are admin-only today. Shows this week's QuickBooks Time hours against the weekly target and the Has room / Overloaded chip from the 4-week average.

## 4. Visibility decision
Team > Capacity and the Team page are admin-only (staff_capacity RLS, qbo_hours_by_staff, TP_ pages). Following that:
- Admins: everyone, with hours. Click a person opens their list (`#/tasks/u/<staff id>`, the existing admin-only person list in Slate). Since the person profile (2026-10-27, `docs/slateplus-profile-spec.md`), a click on someone else opens their profile instead; admins reach the list from there.
- Account managers (account_manager_email on any real client, the same rule as the AM tour): everyone, task counts only, no hours. Rows for other people are not clickable, because the person list is admin-only.
- Everyone else: only their own row, no team totals (Team capacity shows non-admins nothing, so no extra counts are exposed). Their own row links to their Slate.
There are no non-admin account managers on the live roster today (checked 2026-10-27), so the AM branch is tested in SQL when one exists.

## 5. UI
- Slate page (`TK_MyTasks`, full page only, not the embedded Work summary or Desk tab): a "Team load" strip under the view bar. Collapsible (chevron button, aria-expanded); collapsed state remembered in this browser (`mgb_slateplus_workload_v1`). Each person is a chip: name, open, due this week (bar relative to the busiest person), late when counted, hours for admins. Sorted by due this week, then open. "You" marked.
- Unassigned group (claim flow): the same data as one compact line under the group header ("Team load this week: Ana 7 · Ben 3 ..."), only when more than one person is visible, so you see load before claiming or assigning.
- Waits for the Slate list to load, then refreshes when the list changes size, when the signed-in person changes, and about every 60 s while the tab is visible (one shared fetch for the strip and the line); fails soft (missing RPC or error renders nothing).

## 6. Not in scope
Assignee picker hints inside the drawer, drag-to-person load warnings, per-client load.

## 7. Self-critique
- Leak risk: the RPC is the only new data path; it returns counts and names already visible in the staff picker. Private task counts of others are excluded. Non-AM staff get one row. OK.
- Grace rule: late counts would "negatively affect bookkeepers" if shown to assigners during the grace period; hidden (NULL) until the owner turns late counts on. OK.
- Unassigned rows: live data has 178 open rows with is_unassigned = true (assignee_email null); the RPC requires is_unassigned false and an assignee, so they never inflate anyone's load. OK.
- Differs from Team > Capacity's Open column on purpose: Team attributes an Unassigned task to its creator (assignee, else staff_email) and counts waiting-on-client tasks; it also counts private tasks for admins. The strip counts only assigned, not-waiting tasks and never other people's private tasks (even for admins), so the strip never leans on someone's private list. Numbers can therefore be a little lower than Team's.
- View as: hidden, because the RPC runs as the real admin. OK.
- Concurrency with sibling Slate plus agents: `TK_slatePlus.js` holds only the gate; workload code lives in `TK_workloadLogic.js` / `TK_Workload.jsx` / `tk-workload.css` to keep merges small. `tk__owner_only_key` was re-read live right before applying.
- Cost: one RPC per Slate mount (one aggregate over open tasks, about 1.2k rows). OK.
- Rollback: delete the strip call sites; `drop function public.tk_slateplus_workload()` is safe (nothing else reads it).

## 8. Launch (owner)
See README "Slate plus launch checklist". Guide text, tip, tour step and notice are drafted in `docs/staff-guide/drafts/staff-guide-slateplus-workload.md`, not published.
