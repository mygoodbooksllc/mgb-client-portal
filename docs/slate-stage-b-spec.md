# Slate Stage B: simpler Slate (hidden preview)

Status: built hidden 2026-11-02. Owner approved the suggestions ("go with your suggestions", "build all").
Gate: one helper, `TKB_on()` / `TKB_useOn()` in `components/tasks/TK_slateSimple.js`.

## 1. Gate (preview flag + firm switch)

- On only when ALL hold: not in View as (read-only), Slate plus is on (`TKP_on()`), and either
  - the per-person preview `localStorage.mgb_slatesimple_preview === "1"` (Developer tools › Feature flags › "Simpler Slate preview", reloads), or
  - the firm switch `tk_settings.slatesimple_enabled` (owner only; missing = off; code never writes it).
- Switch answer cached per browser in `mgb_slatesimple_cache`, change event `mgb:slatesimple` (same pattern as `TK_slatePlus.js`). The switch is read only once Slate plus is on and the preview is off, so staff without Slate plus make no new request.
- Migration `supabase/slate-simple-switch.sql` (applied as `slate_simple_switch`; body copied from the live definition): adds `slatesimple_enabled` to `tk__owner_only_key()` so only the owner can write it. No row inserted. Checks in `supabase/slate-simple-switch-tests.sql`.
- Off: every spot renders exactly what it renders today. No new class names. The only new request is the one cached read of the switch for staff with Slate plus on and the preview off. Styles live in `components/tasks/tk-slatesimple.css` and match only `.tkb-*` classes. Two Stage A fixes (section 4) apply with the flag off too.
- Embedded Slate (Desk tab, portal summary) never uses Stage B.

## 2. Three controls instead of two bars

Under B, `TK_MyTasks` (not embedded) hides `TK_SlateViewBar` and renders `TK_SlateFilterBar` in its `simple` layout (Filter, Group and sort, Saved views). The toolbar row above (Add task, search, Show done, Show older, View menu, Board switch, keys) is unchanged. The View menu code (owned by another session) is not edited.

- **Filter** (button with a count badge, `data-tour="tkb-filter"`, opens a small panel; the old chips target `tk-slate-chips` is not reused): Assignee, Client, Project, Due (incl. custom range), Status, the search text as a removable chip, Clear filters. Same values and logic as today's filter bar (`TK_applySlateFilters`), same state (`plusF`, `searchText`, `clientFilter`).
- **Group and sort** (menu, `TKB_GroupSort`): Group by Due date / Client / Month step (4th/14th/24th) / Status (hidden in Board and Calendar, where grouping does not apply); Sort by Due / Priority / Status / Name (pick again to flip direction); Manual order (app only, same rule as today); Reset view.
- **Saved views** (menu): the Saved filters list (`tk_slate_filter_views`) renamed. A row applies its filters and, when saved under B, its group and sort (stored as `filters.view = {groupBy, sort}`; the older filter bar drops unknown keys, so old UI is unaffected). A default row also applies its group and sort. "Save this view…" stores group + sort + filters. The old Views menu (`tk_saved_views`) shows only with the flag off; its rows stay untouched.
- Dropped under B: the Mine today and Waiting chips (Waiting on client has its own sidebar item). A chip already saved in a view still applies; it shows as a removable chip in the Filter panel and counts in the Filter badge. Emails due stays as a toggle in the Filter panel when the month rhythm is on.
- Label rename in the B controls: "4/14/24th" reads "Month step (4th/14th/24th)". Off: unchanged.

## 3. Labeled left sidebar

`TKR_Rail` gets a `simple` variant (B on):
- Items in order: My tasks · Waiting on client · To review (all staff; the count shows for admins, as today) · Clients · Projects · People · Recurring (admins only). The Create button above stays.
- No Pin button, no left-bar Search (the top search stays).
- Labeled (icon + text) when the Slate app is in full size or the portal is 1280 px or wider; icon rail with captions otherwise.
- Prefs pinning is ignored under B (no `tkr-pinned` class).

## 4. Avatar at the bottom of the sidebar (app only)

- In the Slate app window, under B, the account avatar sits at the bottom of the left sidebar and opens the same account menu as today (built from one shared item list, so the two never drift). Labeled sidebar: avatar + name; icon rail: initials only.
- The top bar hides its avatar while the sidebar avatar is mounted. Portal Slate page: the portal's own top-bar account menu stays (no sidebar avatar there). The rail scrolls, so the avatar menu is fixed to the window (`.tkb-menu-up`).
- Stage A fix (applies with the flag off too): `TK_vMenuButton` gets an opt-in `returnFocus` prop so picking an item returns focus to the button; only the avatar menus pass it, so the View menu behaves exactly as today.
- Stage A fix (flag off too): the "slate-easier" notice step `ann-avatar` targets `tkb-avatar`, then `tk-sbar-avatar`; with neither present (portal), the step text says the account menu lives in the Slate app window.

## 5. Open task: "More details"

Under B, wherever the task panel opens for that person (Slate app, portal Slate, Desk drawer), the panel keeps visible: title, Mark done, the field grid (assignee, due, client, project, priority, status), description, subtasks, checklist, client requests, files, comments.
Collapsed under a "More details" button (state per browser `mgb_slatesimple_more_v1`): Start, Section, Type, Remind me, Repeat, Sharing, Review, Dependencies, Custom fields, SOP. A count of filled fields shows on the button (sharing is not counted, since client tasks share by default). While collapsed the rows are not mounted, so a tour step aimed at the sharing row falls back to the field grid; the Slate basics tour sends `tkb:more-open` to unfold it.

## 6. Add-line at the top of lists

`TKB_AddLine` above My tasks (not embedded) and in the glance panel. Client and project lists keep their existing per-section add rows (no change):
- One text box. Plain words are understood with the existing parser (`TK_parseQuickAdd`, plain words on): title, plus optional client, date and person ("Call Acme about payroll tomorrow for Jesse").
- A live "Will add …" line shows what will be saved (`TK_qaWillAdd`). Ambiguous names are not applied; the words stay in the title. No AI.
- Enter saves with `TK_api.create` only when nothing is ambiguous and the task is for me; otherwise (or with Shift+Enter) the Quick add dialog opens prefilled. Esc clears. Disabled offline. Hidden in compact and sliver sizes (`.tk-p3-edit`).

## 7. Today at a glance (owner add, 2026-11-02)

In the Slate app full size, when no task is open, the right pane shows "Today at a glance" instead of "Pick a task" (templates view keeps "Pick a template").
- Four counts, own tasks only (assignee = me, open): Overdue · Due this week (today through 7 days ahead, matching the Next 7 days filter) · Waiting on client (my tasks in that status) · Waiting for review (admins only: the existing review queue count, `TK_reviewQueueCount`).
- Each count is a button: it goes to My tasks and sets the matching filter (Due Late / Due Next 7 days / Status Waiting on client); the review count goes to To review.
- "Start here": my top 3 open tasks, overdue first, then soonest due (no due date last), each opens the task.
- A small add box: the same `TKB_AddLine` (assigned to me). When the Quick add dialog cannot take the words (not mounted or already open) the words stay in the box.
- Opening a task swaps in the task; closing it returns the glance panel.
- Data: my own tasks through the live store list `assignee:<person key>` (`TK_api.listScope({assigneeEmail})`), and, for admins, the existing review list. No money, no MGB Home data, nothing about other people. View as: Stage B is off, so the pane is unchanged; read-only staff never see an add box.

## 8. Help

- Draft guide article "Slate basics" (`docs/staff-guide/drafts/staff-guide-slate-basics.md`), published at launch.
- New 3-chapter tour "Slate basics": Your list (sidebar, three controls, glance panel) · Add and finish (add-line, open task, More details, Mark done) · Client lists (Clients, Waiting on client, Saved views). Listed in the ? menu tour list only when B is on.
- Next-visit notice "slate-simpler" visible only when B is on for that person, opens the tour.
- Tips: new tips for the three controls and the add-line, shown only when B is on.
- Live guide is not changed while hidden, except `admin-insight` (admin only) gains the flag and switch rows.

## 9. Upkeep

Dev Tools: flag row, switch row (owner only), reset keys (`mgb_slatesimple_cache`, `mgb_slatesimple_more_v1`), infra notes, `MGB_VERSION` next letter. README section. What's new draft.

## 10. Rollback

Untick the preview (one browser) or leave the switch off. Code revert: the commit(s) touch no data; the migration only adds a key to the owner-only list (harmless).

## Out of scope

Removing the old bars (stay as the default), changing the portal top bar, changing any server rule.
