# Workbench Hub: quick access along the bottom of every staff page

Status: spec, not built. Written 2026-10-16 on top of `1af930a` (full-width bottom bar) and `0479da2` (P4-1). Size: Big. Opus wrote the spec and the critique.
Critique: `docs/workbench-hub-critique.md`. Its fixes are already folded in here.

Owner asks:

1. "i imagined the workbench across the whole bottom of the page". Shipped in `1af930a`.
2. "i want it to be a quick access to anything we might need including tasks without having to change pages"

This spec covers ask 2. The Workbench drawer becomes a **hub**: one bottom panel with three tabs and an action strip. Anything that needs detail opens in the global drawers that already exist, stacked on top of the hub, so the page underneath never changes.

Parents:

- `docs/workbench-phase3-spec.md` covers the store, `wb_inbox`, rows and the drawer addendum.
- `docs/tasks-phase4-spec.md` covers P4 slices, reserved keys, the shared-file table and the upkeep checklist.

Nothing in this spec repeats a Phase 4 slice. These stay with Phase 4:

- quick-add parser (P4-1)
- bulk and undo (P4-3)
- snooze and saved filters (P4-4)
- client strip (P4-5)
- digest (P4-7)
- shortcuts registry (P4-8)

---

## 1. What the hub is

```
┌ page (unchanged, behind a light scrim) ───────────────────────────────────┐
│                                                                           │
├───────────────────────────────────────────────────────────────────────────┤
│ Workbench 12   [Inbox 12] [My tasks 31] [Client ▾ Example Church]   ⤢ × │  head + tabs
│ + Task   Ask client   Message   Time off   Search ⌘K                     │  action strip
│ ───────────────────────────────────────────────────────────────────────── │
│  (active pane: Inbox list │ My tasks list │ Client summary)              │  body, scrolls
└───────────────────────────────────────────────────────────────────────────┘
  bar when closed: Workbench · 12 · next item · Press W
```

- **Inbox**: today's Workbench list. Its All / Tasks / Reviews / Messages / Files filter becomes a chip row inside the pane, so there is one level of tabs.
- **My tasks**: every open task assigned to me, grouped by due date. This is the "including tasks" part of the ask: the whole list, not only what is due this week.
- **Client**: one client at a time, with:
  - open tasks (add, tick, open)
  - what we are waiting on from them
  - last messages
  - last files
  - contacts

  The picker shows pinned clients first, then recent ones, then a type-to-find list.
- **Action strip**: + Task, Ask client, Message, Time off, Search. When the Client tab has a client, actions default to it.

Detail never opens inside the hub. Each item goes to the global host that already owns it:

| Item | Opens | Route change |
|---|---|---|
| Task, review, subtask | `TK_openTask(id, { from: "wb-hub" })`: the task drawer (edit, complete, comment, reassign, approve, send back) | none |
| Client message | chat drawer (`SI_ChatDrawer`) on that client and person (new event `mgb:open-chat`) | none |
| New client file | Open in Drive (`DRV_link`, new browser tab) plus Mark checked on the row | none |
| Ledger flag, GL review | navigates to the Ledger review page as today. It is a full page, and the hub closes. | yes (by design) |
| "Open client" in the Client tab | navigates to the client page, and the hub closes | yes (asked for) |

**Why stack instead of embed:**

- `TK_Drawer.jsx` is about 2,300 lines, and P4-2, P4-3 and P4-4 all edit it.
- `StaffInbox.jsx` is 2,556 lines, and P4-2 and View-as edit it.

Re-hosting either inside the hub would fork them or put the hub in every one of those conflicts. Their hosts are already mounted on every staff page (`TK_DrawerHost`, `siStaffChat`), so stacking costs almost nothing and keeps one copy of each editor.

### Cuts and merges from the candidate list

| Candidate | Decision |
|---|---|
| 1 Docked detail pane with edit, complete, comment, reassign | **Merged** into the stacked task drawer. That drawer already does all four, plus approve. |
| 2 Universal search | **Extend ⌘K** (`TB_Search`): add "Open in Workbench" on client results and a Workbench actions group. No second search box. The `/` key is not used. |
| 3 Quick actions | Add task, Ask client, Message, Time off: **kept**. **Log time: cut.** `time_entries` was retired 2026-09-29 and QBO is read-only, so there is nothing to write to. |
| 3 Reply (deferred W7) | **Kept, as the chat drawer** opened on the thread. No new composer (see D2). |
| 4 Client lookup | **Kept** as the Client tab. |
| 5 Recents and pins | Client recents and pins: **kept** (pins sync, see D4). **Pinned filters: cut.** P4-4 "My views" owns saved filters. |
| 6 State across navigation | **Kept**: tab, Inbox chip, client, scroll per tab. **Composer drafts: optional H3b**, only after P4-2 and View-as land in `StaffInbox`. |
| 7 Phone and keyboard | **Kept**: full-height sheet as today. Keys in §5. |
| 8 Permissions | **No new tables, no new RPCs, no new writes.** See §4. |
| 9 Performance | **Kept**: lazy panes, bounded reads. See §6. |
| People search | **Cut for now.** It needs a "person view" without a route change, which does not exist. Revisit after P4-6 workload. |

---

## 2. Architecture

### 2.1 Mount and ownership

- **Mount.** `WB_Drawer` stays the single mount in `app.jsx` (about line 29912). The condition is unchanged: `showStaffRail && !tkShell && !isPreviewingUser && !impersonating`. So the hub never exists under View as or a preview.
  - The hub gains one prop: `clients` (the staff member's accessible client list `app.jsx` already holds for `ClientSwitcher`). This is a one-line change at the mount.
- **Off switch.** It is still off unless `tk_settings.wb_enabled` is on or a browser has `mgb_wb_preview`. `WB_useSwitch` is unchanged. Classic mode (`mgb_wb_classic`) hides the hub with the bar.
- **New files** (so the shared files barely grow):
  - `components/workbench/WB_Hub.jsx`: the tab shell, action strip and stack protocol. `WB_Drawer` keeps the bar and renders `<WB_Hub>` when open.
  - `components/workbench/WB_HubTasks.jsx`: the My tasks pane.
  - `components/workbench/WB_HubClient.jsx`: the Client pane and picker.
  - All three go into `index.html` `__SOURCE_ORDER` after `WB_Drawer.jsx`. Every global they call is defined earlier: TK_*, SI_*, CV_*, DRV_*, CS_*.
- **Extracted shared body.** `TK_ClientTasksBody({ clientId, clientName, staffUser, isAdmin, compact })` is lifted out of `TK_ClientDrawerPanel`. It contains the rows, the add row and contacts, with the list key `"clientcd:<id>"` unchanged.
  - The `t` drawer and the hub Client tab render the same body.
  - The extraction must not change behavior: same props to `TK_TaskRow`, same list key, same handlers.

### 2.2 State

Hub state lives in `WB_store` (the module singleton). It survives route changes because `WB_Drawer` never unmounts while the hub is on. It is mirrored to `sessionStorage["mgb_wb_hub"]`, so a reload keeps it in that browser tab only.

```
hub: {
  tab: "inbox" | "tasks" | "client",   // last tab (reopens there)
  chip: "all" | "task" | "review" | "message" | "doc",   // WB_DRAWER_TABS ids
  clientId: string | null,             // Client tab's client
  scroll: { inbox: n, tasks: n, client: n },
  lastFocus: string | null             // row id that launched a stacked drawer
}
```

- **New store methods:** `setHub(patch)` and `hub()`. Writes to sessionStorage are throttled to 1 per 500 ms and wrapped in try/catch.
- **Scroll** is saved on the pane's scroll event (throttled) and restored after the pane's first render.
- **Pins** go in `user_settings.settings.wb_pins = [clientId, …]`. There are at most 8; the oldest drops off.
  - They are written only through the existing Settings store helper, and only the `wb_pins` key changes.
  - The largest live row is 1.4 KB against a 16 KB check, and 8 ids add about 300 B.
  - If the settings write fails, the pin stays in memory for the session and a toast says "Couldn't save pin".
- **Recents** reuse `CS_readRecent(email)` and `CS_pushRecent(email, id)`, the ClientSwitcher's existing localStorage list (5 entries). Picking a client in the hub pushes to it. Hub and switcher share one list.

### 2.3 Stack protocol (required before anything else)

Today `WB_Drawer` is a modal with its own document keydown handler for Esc, the Tab trap and W. It does not know when the task drawer (z 1850), the chat drawer (z 1800, which is *below* the hub panel at 1820) or a modal (2000+) is on top of it.

**Rules:**

1. **Layer check.** `WB_layerAbove()` returns true when any of these exist:
   - `.tk-dw-layer` (task drawer, z 1850)
   - `.tk-cd-layer` (`t` client drawer, z 1840)
   - `.si-drawer-layer`
   - `.modal-overlay` (quick add, Ask client, Time off and every ModalShell, z 2000+)
   - `[aria-modal="true"]` outside `.wb-panel`
   - `.tour-root`
   - `.wb-menu`

   While that holds, the hub's key handler ignores Esc, Tab and W, so the top layer gets them first.
   - It checks at keydown time. A closing layer is still in the DOM during the same event, so one Esc closes exactly one layer, whichever handler runs first.
2. **Chat drawer above the hub.** While the hub is open, `html.wb-hub-open` is set. `WB.css` adds `html.wb-hub-open .si-drawer-layer { z-index: 1830 }`, which puts it above the panel at 1820 and below the task drawer at 1850. No `StaffInbox` CSS changes.
3. **Scrim.** While a stacked drawer is open, the hub scrim's pointer events are off (`html.wb-stacked .wb-scrim { pointer-events: none }`). A click outside then closes only the stacked drawer, because that drawer's own scrim handles it.
4. **Focus return.** When a stacked drawer closes, focus returns to `hub.lastFocus` if that row still exists, otherwise to the active tab.
   - Detection: a `MutationObserver` on `document.body` (childList only), started only while the hub is open, watching for the layer classes above.
5. **Hash changes.** `hashchange` still closes the hub. `TK_DrawerHost` already ignores a hashchange within 500 ms of opening, and the hub never changes the hash itself, so nothing new closes.
6. **Hidden page.** The hub's `aria-modal` stays true. The task drawer and the chat drawer are portaled to `body`, so they are siblings of the hub and not trapped inside it.

### 2.4 Row actions in the hub

`WB_logic` gains `WB_hubAction(row)`. It is pure and tested in `WB_logic.test.js`.

| Row kind | Hub primary action | Menu (⋯), unchanged otherwise |
|---|---|---|
| `task`, `task_review`, subtask | Open → `TK_openTask(row.task_id, { from: "wb-hub" })` | Start, Snooze, Open full page |
| `message` | Reply → `mgb:open-chat {clientId, email}` | No reply needed, Snooze, Open full page |
| `doc_upload` (new file) | Open file → `DRV_link(fileId)` in a new tab | Mark checked, Snooze, Open full page |
| `gl_*` and anything else | Review → `WB_go(row)` (navigates as today) | as today |

**Open full page** keeps the old behavior (`WB_go`). The full Today page (`#/today`) is unchanged and still uses `WB_go`, because there is no hub on top of it there.

---

## 3. Capabilities

### 3.1 Inbox tab

- The current drawer content, unchanged except for:
  - tabs become chips
  - primary actions come from `WB_hubAction`
- Mine / Everyone for real admins stays. Temp admins get Mine only (`wb_inbox` already refuses Everyone).
- Data: `wb_inbox(p_scope, p_sources, p_include_test)` through `WB_store`. No change.

### 3.2 My tasks tab

- **List.** `TK_vUseList("wb:mine", loader)` with loader `TK_api.listMine(email, { showOlder: false })`.
  - Use **its own key, not `"mine"`**. `TK_sync` refetches a key with the *first* loader registered for it (`st.loaders[key][0]`). My Tasks' loader changes with its Show older switch, so sharing the key would let either surface reload the other with the wrong options.
  - Edits, ticks and reassigns still show in both at once: `TK_sync` applies task upserts and removes to the store rows, and both keys refetch on the same sweep.
- **Grouping.** These are the same calls My Tasks makes, read-only:
  - `TK_groupMyTasks(tasks, today, { email, showOlder: false, isAdmin, inMyBook })` in `TK_logic.js`
  - then `TK_myGroupsView(groups, { collapsed, showDone: false })` in `TK_viewLogic.js`

  The hub's groups match My Tasks' default view. Collapsed groups live in hub state, not in My Tasks' localStorage key.
- **Rows.** `TK_TaskRow` with only today's props: `task, today, subs, showClient, assigneeName, canEdit, onOpen → TK_openTask, onToggleDone → TK_vComplete, onStatus → TK_vSetStatus`. No selection or bulk props, so P4-3's additions do not reach the hub.
- **Bottom of the list.** "+ Add task" opens `tk:quick-add` (P4-1's parser, unchanged). A "My Tasks page" link navigates.
- **Limits.** `listMine` is already bounded (1,000 rows). The pane renders the first 200 rows and then shows "Show all on My Tasks".

### 3.3 Client tab

**Picker** (combobox, with `aria-activedescendant`):

- Pinned clients (★), then recents (from `CS_readRecent`), then a typed filter over the `clients` prop.
- It never queries the server. The prop is already scoped to what this person can open.
- The ★ next to the name pins or unpins.

**Sections**, each loaded only when the tab is shown with a client, in parallel, each with its own error and Retry:

| Section | Source | Bound | Access |
|---|---|---|---|
| Tasks (rows, add row, contacts) | `TK_ClientTasksBody` (list key `clientcd:<id>`, `TK_api.listScope({clientId})`) | existing | tasks RLS, existing |
| Waiting on client | `TK_api.waitingOnClient(clientId)` → `tk_waiting_on_client(p_client_id)` | existing (limit 500) | definer + `is_active_staff()` + `can_access_client()`. **No `visibility` filter today. Fixed by H0 before H4 (§8 R3).** |
| Last messages | `client_messages` select `id, participant_email, author_kind, author_name, body, created_at`, filters `client_id = ?`, `internal = false`, `deleted_at is null`, order `created_at desc`, limit 5. Body trimmed to 140 characters in the UI. | 5 | RLS: staff plus `can_access_client`, plus the internal-company lock |
| Last files | `client_files` select `id, name, mime, uploaded_at, uploaded_by, drive_file_id`, filters `client_id = ?`, `trashed_at is null`, order `uploaded_at desc`, limit 5 | 5 | RLS as above. Opening a file uses `DRV_link` (drive-files `link`, which checks access server-side). |

**Actions** in the pane header:

- **Open client** (navigates)
- **+ Task**: `tk:quick-add {client_id}`
- **Ask client**
- **Message**: `mgb:open-chat {clientId}`, which shows the client's thread list in the chat drawer

There is no new RPC. Four small parallel reads replace one call. A security-invoker summary RPC is a fallback only if the pane takes over 600 ms at p75, measured in H4.

### 3.4 Action strip

| Action | Does | Client default |
|---|---|---|
| + Task | dispatches `tk:quick-add` (P4-1 dialog) | Client tab's client, if any |
| Ask client | `TK_AskClientModal({ clientId, clientName, taskId: null, onClose, onAsked })`. The modal already sends `taskId: p.taskId \|\| null` to `TK_api.askClient`, and `tk_ask_client` accepts a null task. If no client is chosen, a client picker (the same combobox) shows first. | Client tab's client |
| Message | `mgb:open-chat {clientId}` | Client tab's client. Without one, the chat drawer opens on its own list. |
| Time off | a modal wrapping `CV_MyTimeOffBody({ staffUser })`, as-is. It includes "Hand my tasks to backups" (`CV_Handoff` → `tk_apply_ooo`). | n/a |
| Search ⌘K | opens the top-bar search (new `tb:open-search` event, see 3.5). It is added in H6, because `TopBar.jsx` has no opener today: it opens only on its own ⌘K keydown and input focus. | n/a |

The strip wraps to two rows on narrow widths. On phones it becomes a horizontal scroller.

### 3.5 ⌘K extensions (TopBar.jsx)

- **Open in Workbench.** Client results get a secondary action:
  - The row shows a small "Workbench" button.
  - Shift+Enter on the row does the same, and the row hint says "Shift+Enter: Workbench".
  - It sets `hub.tab = "client"`, sets `hub.clientId`, opens the hub and closes the palette. Enter keeps its old meaning (go to client).
- **Workbench actions group.** Shown only when the hub is on (`WB_useSwitch()` true): Open Workbench, My tasks in Workbench, Time off.
- **Open-search event.** `TB_Search` listens for `tb:open-search` (new: `setOpen(true)`, then focus the input) so the hub's Search button can open it. Verified: no opener exists today.

### 3.6 Message reply via the chat drawer (W7 replacement)

- **Event.** `window.dispatchEvent(new CustomEvent("mgb:open-chat", { detail: { clientId, email } }))`.
- **`app.jsx` listener** (next to `siStaffChat` and `setSiDrawer`, about lines 30495–30515):
  - It runs only when `siStaffChat` is available. Otherwise it falls back to `WB_go(row)`.
  - It calls `setSiDrawer({ clientId, email })`. The render passes them as `defaultClientId` and `initialEmail`.
  - `SI_ChatDrawer({ onClose, ...inboxProps })` already spreads every prop into `StaffInbox`, which honors `initialEmail` at about line 1502. **`StaffInbox.jsx` is not edited.**
- **Order of closing.** `SI_ChatDrawer` closes on `tk:drawer-open`, so opening a task from the chat drawer swaps one for the other. The hub stays open under both.
- **What sending does.** Sending is the existing `SI_ClientThread` insert, then `mgb:client-messages-changed`, which is already in `WB_EVENTS`, so the Inbox row clears.

---

## 4. Permissions and data exposure

The hub adds **no tables, no RPCs, no edge functions and no new write paths**. Every read and write is one the user can already do on another page. The only server change in this plan is H0, which **tightens** an existing RPC.

| Concern | Rule |
|---|---|
| View as / preview | The hub is not mounted (existing `app.jsx` condition). View-as also blocks writes with its fetch guard, so this is two layers of protection. |
| Temp admin | Inbox is Mine only. The `clients` prop is their scoped list. Everything else is RLS or definer RPCs that already check `can_access_client`. |
| Bookkeeper | The `clients` prop is their assigned clients. A client id from sessionStorage or pins that they can no longer access shows "You don't have access to this client" and removes the pin. RLS returns 0 rows and the UI never shows another client's name. |
| Messages | Only `internal = false` rows. Internal notes stay in `StaffInbox`. |
| Waiting on client | Verified 2026-10-16: `tk_waiting_on_client` has no `visibility` filter in either branch. A private task's `text` can reach any staff member with access to the client, **today, on `#/tasks/waiting`**. H0 fixes it on the server before the hub shows this data anywhere new. |
| Pins | Own `user_settings` row only (RLS own-row). Ids only, no names. |
| Telemetry | `WB_track` gets event names and tab ids only, never client names or text. |

---

## 5. Keyboard and phone

**No new global keys.** W stays the only global key the hub owns.

| Key | Where | Does |
|---|---|---|
| W | anywhere not typing, no layer above | open or close the hub |
| Esc | hub open | closes the top layer: row menu, then stacked drawer or modal, then the hub |
| ← / → | on the tab list | switch tabs (ARIA tabs; Home and End jump) |
| ↑ / ↓ | in a list | move between rows (WB_List roving focus already, and the same for My tasks and Client) |
| Enter | on a row | hub primary action |
| Tab | in the hub | trapped in the hub unless a layer is above (§2.3) |
| ⌘K, Shift+Enter | palette | open the client in the Workbench (§3.5) |

**Clashes checked:**

- `/` stays unused.
- The digits 1–6 are not bound in the hub. The page's chip keys stay on `#/today` only.
- The Phase 4 reserved keys are not touched: q, w (this one), t, j, k, x, s, a, e, o, v, z, 0–6, Cmd+K, Cmd+Z, ?, and g-sequences.
- **`q` while the hub is open does nothing.** `TK_QuickAdd` treats any `[aria-modal='true']` as a modal and stands down, and the hub is one. The way in is **+ Task** on the strip, and `TK_QuickAdd.jsx` is not edited because it is a P4 file. The foot hint says so.
- **`t` while the hub is open** opens the client tasks drawer (z 1840) above the hub, because its host only checks `.modal-overlay`. That is acceptable: it is in `WB_layerAbove()`, so Esc closes it first.
- **P4-8:** when it lands, it declares W, the hub arrows and Shift+Enter in `MGB_keys.js`. The hub adds no registry of its own.

**Phones (<768px):**

- The hub is the existing full-height sheet.
- Tabs are a scrolling segmented row and the strip is one scrolling row.
- Stacked drawers already go full width at this size, and the chat drawer goes over the sheet (z 1830).
- Back gesture or Esc closes the top layer.
- All targets are at least 44px.

---

## 6. Performance

- **Collapsed hub:** no new work. The bar uses the same `wb_inbox` store, with the same 2-minute poll and realtime as today.
- **Panes** mount lazily the first time their tab opens. After that they stay mounted while the hub is open, and unmount when it closes. The lists (`wb:mine`, `clientcd:<id>`) stay warm in `TK_store`, so reopening paints at once and then revalidates.
- **Client tab:** at most 4 parallel requests per client switch, each bounded (5 / 5 / existing). Switching clients cancels by sequence number, and a stale response is dropped.
- **No MutationObserver** while the hub is closed.
- **Budget:**
  - Opening the hub must not add more than 50 ms of main-thread time on a mid laptop. Measure with the Performance panel in H1 and H2.
  - Normal pages must show no new network calls when the hub is closed.

---

## 7. Slice plan (in order)

**Size: Big.** It is a multi-file redesign of a surface on every page, plus one server privacy fix.

**Models:**

- Opus writes the spec and the critique (this doc).
- Builds use Sonnet when a slice is UI-only and Opus when it touches server, data access or permissions.
- Opus reviews every slice.
- Haiku runs the screenshot sweeps and checks at low effort.

**Every UI slice:**

- ships behind the existing Workbench switch (off for staff until the owner turns on `wb_enabled`)
- is tested with `mgb_wb_preview`
- carries its own upkeep in the same commit (memory rule)

**Common test steps for every UI slice:**

- `node components/workbench/WB_logic.test.js`
- Haiku screenshot sweep at 1440, 760 and 375, in light and dark
- Role matrix:
  - bookkeeper
  - admin (Mine and Everyone)
  - temp admin (Mine only)
  - View as: hub absent
  - preview: hub absent
- Classic flag: hub absent
- No console errors
- No new network calls on a normal page with the hub closed

**Common upkeep for every UI slice** (from the P4 spec checklist), each "if touched":

- staff guide `docs/staff-guide/workbench.md` + `node docs/staff-guide/sync.mjs`
- tips targets (re-point any `data-tour`/tip anchors that moved)
- ? help menu (Help for this page → Use the Workbench)
- `docs/staff-guide/whats-new.md`
- README Workbench section
- Dev Tools:
  - `MGB_VERSION` at `index.html:205` (bump the label, prepend to the note)
  - flags (none new)
  - reset keys: add `mgb_wb_hub` (sessionStorage) to the Workbench reset in H1
  - `PAGE_META` (none new: the hub is not a page)
  - Usage Stats labels for new `WB_track` names

Shared-file legend:

- **A** = `app.jsx`
- **SI** = `StaffInbox.jsx`
- **TB** = `TopBar.jsx`
- **CD** = `TK_ClientDrawer.jsx`
- **ANN** = `announcements.js`
- **V** = `MGB_VERSION`

Every slice touches V, so V is a rebase-only conflict: take theirs, then re-prepend. **No hub slice edits SI, TK_List, TK_MyTasks, TK_TaskRow, TK_api, TK_Drawer or TK_QuickAdd.**

| Order | Slice | Size | Build | Review | Shared files |
|---|---|---|---|---|---|
| H0 | Private tasks out of `tk_waiting_on_client` (server) | S | Opus, high | Opus, high | none (SQL file) |
| H1 | Hub shell, stack protocol, state; tasks open in place | M | Sonnet, medium | Opus, high | V |
| H2 | My tasks tab | M | Sonnet, medium | Opus, medium | V |
| H3 | Reply opens the chat drawer; files open in Drive | S | Sonnet, medium | Opus, medium | A, V |
| H4 | Client tab, pins, `TK_ClientTasksBody` | L | Opus, high | Opus, high | CD, A, V |
| H5 | Action strip (Task, Ask client, Message, Time off) | M | Sonnet, medium | Opus, high | V |
| H6 | ⌘K Open in Workbench, Search button, launch tour | M | Sonnet, medium | Opus, medium | TB, ANN, V |
| (H3b) | optional: composer draft keeps across close | S | Sonnet, low | Opus, low | SI, V |

Haiku runs screenshot sweeps for every UI slice, at low effort.

### H0: Private tasks out of `tk_waiting_on_client`. Size S

This fixes a bug that ships today, independent of the hub, and is a **gate for H4**.

- **Build:** Opus, high effort. **Review:** Opus, high.
- **Files:**
  - `supabase/tasks-p4-waiting-private.sql` (new, re-runnable `create or replace`)
  - `tk_schema_version` bump to 11 (or the next free number when built)
  - `TK_api` schema probe only if the P4 rule needs it
- **Change.** In both branches of `tk_waiting_on_client`, a task row with `visibility = 'private'` is shown only to:
  - its `staff_email`
  - its `assignee_email`

  For everyone else:
  - **Branch 1** (open requests): keep the request row, because the request is the client's business, not the private task's. Null out `task_id`, `text`, `assignee_email`, `status` and `due_date` from the task.
  - **Branch 2** (tasks in `waiting_client` with no request): drop the row.
- **Rules.** Follow the P4 rule-2 recipe:
  - re-runnable SQL
  - live function body fetched first (no copy from repo)
  - `security definer`
  - `set search_path = public`
  - grants unchanged
- **Owner apply:** auto-apply is pre-approved (memory). This spec applies nothing.
- **Conflicts:** P4-5 also reads this RPC. The result's column shape does not change, so P4-5 is unaffected.
- **Tests:**
  - SQL checks as two staff on a test client: A owns a private waiting task, B has client access. B gets no task text.
  - B still sees the request row with a null task.
  - Admin B gets the same result: private means private.
  - `#/tasks/waiting` still renders a request with no task ("No task").
  - Confirm `TK_WaitingList` handles `task_id null`, which it must already do for task-less Documents requests.
- **Upkeep:** What's new line ("Waiting on client no longer shows other people's private tasks"), V. No guide or tour change.

### H1: Hub shell, stack protocol, state, tasks open in place. Size M

- **Build:** Sonnet, medium effort. **Review:** Opus, high.
- **Files:**
  - `WB_Hub.jsx` (new)
  - `WB_Drawer.jsx`: renders WB_Hub when open; key handler uses `WB_layerAbove()`
  - `WB_store.js`: `hub` state, `setHub`, sessionStorage
  - `WB_logic.js` + test: `WB_hubAction`, `WB_LAYER_SELECTORS` constant
  - `WB.css`: tabs, chip row, `wb-hub-open` / `wb-stacked` rules, SI z-index lift
  - `index.html`: source order, V
  - docs
- **Scope:**
  - The Inbox tab only, with chips. My tasks and Client tabs arrive in H2 and H4. The tab ARIA and arrow keys are ready for them, and a one-tab tablist renders no tab row.
  - Tasks and reviews open in the task drawer.
  - Stack protocol, focus return, scroll and tab restore.
- **Conflicts:**
  - V and docs only.
  - It rebases on `1af930a`, which has already landed.
  - P4-3 and P4-4 do not touch WB files. P4-4's `tk_snooze_task` wraps `wb_snooze`, which is server-only.
- **Tests:**
  - Unit: `WB_hubAction` for every row kind, and the selector list.
  - Manual:
    - Open a task from the hub, then Esc (task drawer closes, hub stays, focus on the row), then Esc (hub closes).
    - Open a task, then click the dimmed page: only the task drawer closes.
    - W while the task drawer is open does nothing.
    - `t` while the hub is open stacks the client drawer, and Esc closes it first.
    - `q` while the hub is open does nothing.
    - Reload keeps the chip and scroll.
    - A link in the hub that navigates closes it, and reopening restores the tab.
    - Tab stays trapped in the top layer.
    - Opening the hub costs no more than 50 ms of main thread (Performance panel).
- **Upkeep:**
  - guide "Use the Workbench": "Open a task without leaving the page"
  - foot hint: W, Esc, "+ Task to add"
  - Dev Tools reset key `mgb_wb_hub`
  - V
- **Announcement:** none yet (the hub is off; see H6).

### H2: My tasks tab. Size M

This is the owner's "including tasks", so it comes straight after the shell.

- **Build:** Sonnet, medium effort. **Review:** Opus, medium.
- **Files:**
  - `WB_HubTasks.jsx` (new)
  - `WB_Hub.jsx` (tab)
  - `WB.css`
  - `index.html` source order
  - docs, V
- **Reads (does not edit):** TK_TaskRow, TK_logic, TK_viewLogic, TK_api, TK_sync.
- **Conflicts:**
  - None in shared files.
  - **Contract risk:** P4-3 changes `TK_TaskRow` props or `TK_groupMyTasks` / `TK_myGroupsView` signatures.
    - Mitigation: the hub passes today's props only.
    - The H2 builder adds a row to the P4 spec's shared-file table: "WB_HubTasks renders TK_TaskRow and calls TK_groupMyTasks/TK_myGroupsView; keep them backward compatible; run the hub smoke test." That is a 1-line docs edit in `tasks-phase4-spec.md`, in the H2 commit.
- **Tests:**
  - Tick a task in the hub while on My Tasks: the My Tasks row updates without reload, and the Inbox count drops.
  - Toggle My Tasks' Show older with the hub open: the hub list doesn't change (separate key).
  - Open a task: the task drawer opens over the hub.
  - "+ Add task" opens quick add.
  - More than 200 rows shows "Show all on My Tasks".
  - Groups match My Tasks' default view.
- **Upkeep:**
  - guide section "My tasks in the Workbench"
  - tip on the My tasks tab
  - Usage Stats label `wb-hub:tasks`
  - V

### H3: Reply opens the chat drawer; files open in Drive. Size S

- **Build:** Sonnet, medium effort. **Review:** Opus, medium.
- **Files:**
  - **A:** the `mgb:open-chat` listener in its own `useEffect` next to `siStaffChat` / `setSiDrawer`, about 15 lines, plus passing `initialEmail` in the existing `SI_ChatDrawer` render
  - `WB_logic.js` + test: message and doc_upload hub actions
  - `WB_Hub.jsx`
  - docs, V
- **Conflicts:**
  - **A:** View-as (`wt-viewas`, 47 files) and P4-2 both edit `app.jsx`. This is one new effect block plus one prop at an existing render, and does not overlap either.
  - Whoever lands second rebases, and the other side's code wins.
  - **SI is not touched** (props are already spread).
- **Tests:**
  - Reply opens the chat drawer on that client and person, above the hub (z 1830).
  - Send: the row clears within 2 s (event) and within 2 min (poll).
  - The chat drawer then opening a task swaps to the task drawer, and the hub stays.
  - A stale row for a client the bookkeeper can no longer open shows `StaffInbox`'s normal no-access state.
  - File row: Open file opens Drive in a new tab. Mark checked plus Undo works.
  - The listener does nothing (and falls back to `WB_go`) when `siStaffChat` is off.
- **Upkeep:**
  - guide "Reply without leaving the page"
  - V

**H3b (optional, later):** composer draft keeps across close.

- File: `SI_ClientThread` only.
- sessionStorage key `mgb_si_draft:<clientId>:<email>`, cleared on send, at most 20 keys.
- **Only after P4-2 and View-as have merged** into `StaffInbox.jsx`.

### H4: Client tab, pins, `TK_ClientTasksBody`. Size L

- **Gate:** H0 is applied.
- **Build:** Opus, high effort (data reads and access). **Review:** Opus, high. **Screenshots:** Haiku.
- **Files:**
  - `WB_HubClient.jsx` (new)
  - **CD:** extract `TK_ClientTasksBody` and render it from `TK_ClientDrawerPanel`
  - `WB_store.js` (pins via the Settings store)
  - `WB_Hub.jsx`
  - **A:** pass `clients` to `WB_Drawer`, 1 line at the mount
  - `WB.css`
  - docs, V
- **Conflicts:**
  - **CD vs P4-5** (client strip in the drawer head). Land after P4-5 if P4-5 is in flight. Otherwise H4 goes first and P4-5 puts its strip in `TK_ClientDrawerPanel`'s head, above the extracted body.
  - The extraction is a pure move: same JSX, hooks, list key and handlers. Review it with `git diff --color-moved=zebra`.
  - **A:** one line at the `WB_Drawer` mount.
- **Tests:**
  - Access:
    - A bookkeeper sees only assigned clients in the picker.
    - A stale pinned or session client id they can't open shows the no-access line and drops the pin.
    - No internal notes are listed.
    - A temp admin sees their scope only.
    - A private task never shows to a non-owner (after H0).
  - Bounds:
    - 4 requests per switch, `limit=5` on messages and files.
    - Fast switching shows no stale client.
  - Behavior:
    - The `t` drawer looks identical before and after (screenshot diff).
    - Pins sync across two browsers; the cap is 8.
    - A pin save failure shows a toast.
  - Pane load p75 under 600 ms on a large client (otherwise open the summary-RPC follow-up).
- **Upkeep:**
  - guide "Look up a client from the Workbench"
  - tip on the pin star
  - Usage Stats `wb-hub:client`, `wb-pin`
  - V

### H5: Action strip (Task, Ask client, Message, Time off). Size M

- **Build:** Sonnet, medium effort. **Review:** Opus, high (Ask client reaches clients; Time off hands off tasks).
- **Files:**
  - `WB_Hub.jsx`, `WB.css`
  - docs, V
- **Uses unmodified:** `TK_AskClientModal`, `CV_MyTimeOffBody`, `ModalShell`, `tk:quick-add`, `mgb:open-chat`.
- **Conflicts:** none in shared files.
- **Tests:**
  - Ask client with no task, from the strip and from the Client tab:
    - The request shows in Waiting on client and in the Client tab.
    - Emails stay a dry run unless that client is switched on (server gate).
    - A test client sends only the `[Test]` copy.
  - With no client chosen, the picker shows first.
  - Time off:
    - Add and remove time off.
    - "Hand my tasks to backups" preview and apply on a test account.
    - Esc closes the modal before the hub.
  - + Task carries the Client tab's client.
  - Message opens the chat drawer on that client.
- **Upkeep:**
  - guide "Quick actions in the Workbench"
  - tip on the strip
  - Usage Stats `wb-hub:action:<id>`
  - V

### H6: ⌘K Open in Workbench, Search button, launch. Size M

- **Build:** Sonnet, medium effort. **Review:** Opus, medium.
- **Files:**
  - **TB:** Shift+Enter secondary action, Workbench group, `tb:open-search` listener
  - `WB_Hub.jsx`: Search button on the strip
  - **ANN:** edit the `workbench-launch` entry only
  - Workbench tour steps
  - docs, V
- **Conflicts:**
  - **TB:** View-as edits `TopBar.jsx`. Land after `wt-viewas` merges, or rebase onto it.
  - **ANN:** P4 slices add their own entries, and this slice touches only `workbench-launch`.
- **Launch:**
  - The Workbench is not launched yet: `workbench-launch` is gated `ready` and `wb_enabled` is off.
  - So the hub joins that notice and tour (stops: bar → tabs → action strip → Client tab).
  - If the owner switched the Workbench on before H6, add a `workbench-hub` notice and tour instead (memory rule).
- **Tests:**
  - ⌘K → client → Shift+Enter opens the hub on that client.
  - Enter still navigates.
  - The Workbench group is hidden when the hub is off.
  - The Search button opens ⌘K with the input focused.
  - The tour runs at 1440 and 375 and its anchors exist.
  - The notice shows once.
- **Upkeep:**
  - full sweep: guide + sync, tour, tips, help, README, What's new, Dev Tools (V, reset keys, Usage Stats), `ANN_REGISTRY`

**Order rationale:**

- H0 is independent and should go first, because it fixes a live leak.
- H1 is the base for everything else.
- H2 and H3 can run in parallel worktrees after H1. They share only the `WB_Hub.jsx` tab list and V.
- H4 waits for H0, and for P4-5's position on CD.
- H5 uses H4's client context.
- H6 is last, because it needs final tour anchors and `wt-viewas` merged.

**Estimated total:** 2×S + 4×M + 1×L (+ optional H3b S).

---

## 8. Critical pass: risks and cuts

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | Stacked layers fight over Esc, Tab and focus. A user could get trapped or lose focus. | High | §2.3 protocol is H1's main job (keydown-time layer check, focus return). Manual matrix in the H1 tests. Opus review focuses on it. |
| R2 | The chat drawer sits under the hub (1800 < 1820), so Reply would open invisibly. | High | `html.wb-hub-open .si-drawer-layer { z-index: 1830 }` in H1. H3 tests it visually. |
| R3 | **Confirmed:** `tk_waiting_on_client` returns private tasks' text to anyone with client access. Live today on `#/tasks/waiting`, and the hub would show it in a second place. | High (privacy) | H0 server fix first. H4 is gated on it. |
| R4 | Sharing the `"mine"` list key would let My Tasks' Show older and the hub reload each other with the wrong loader (`TK_sync` uses the first registered loader). | Medium | The hub uses its own key, `wb:mine`. |
| R5 | `TK_TaskRow` / `TK_groupMyTasks` drift from P4-3. | Medium | Today's props only, a note in the P4 shared-file table, and the hub smoke test in P4-3. |
| R6 | The hub becomes a second app inside the app (people, GL, reports) and has to be maintained forever. | Medium | Hard rule: the hub owns lists and launchers only. Editors stay in their hosts. Three tabs maximum (D3). |
| R7 | Two client surfaces: the `t` drawer and the Client tab. | Medium | One shared `TK_ClientTasksBody`. D5 decides whether to merge. |
| R8 | View-as (`wt-viewas`) is uncommitted and touches A/SI/TB. | Medium | Only H3 (A, two small hunks), H4 (A, one line) and H6 (TB) touch them. H6 lands after View-as. |
| R9 | The page under the scrim is unusable while the hub is open. The owner may want "side by side". | Medium | D1 (default: overlay). A non-modal dock needs a split layout and new focus rules, which is a separate spec. |
| R10 | `q` doesn't work while the hub is open (`TK_QuickAdd` treats `aria-modal` as a modal). | Low | + Task on the strip and the foot hint. No edit to the P4 file. P4-8's registry can revisit it. |
| R11 | A stale session or pinned client id the user can no longer access. | Low | No-access line, the pin is dropped, and RLS returns nothing. |
| R12 | Phone overload: 3 tabs, strip and list in a 375px sheet. | Low | The strip scrolls, labels are short, and screenshot sweeps check it. |

**Cuts (stated so nobody builds them by accident):**

- log time
- pinned filters (P4-4)
- people search
- an in-hub task editor
- an in-hub composer (unless D2 flips)
- a `/` key
- digit tab keys
- a new summary RPC (unless H4 measures slow)
- composer drafts before P4-2 and View-as land
- edits to `TK_QuickAdd`, `TK_Drawer`, `StaffInbox`, `TK_TaskRow` or `TK_MyTasks`

---

## 9. Owner decisions (5, each with a default)

| # | Question | Default (what gets built if you say nothing) |
|---|---|---|
| D1 | When the Workbench is open, should the page behind it stay usable (side by side) or be dimmed (overlay)? | **Overlay, dimmed** (as today). It is simpler, phones work the same, and focus is safe. Side by side can be a later spec. |
| D2 | Reply to a client message: open the chat drawer on that thread, or type the reply right in the Workbench row? | **Chat drawer.** It is the full composer with attachments and history, it needs no second composer to maintain, and the page still doesn't change. |
| D3 | Tabs: Inbox · My tasks · Client. Add a fourth (for example "Me": time off and coverage)? | **Three tabs.** Time off is a button on the action strip. |
| D4 | Pinned clients: follow you to every computer, or this browser only? | **Every computer** (saved to your settings), up to 8 pins. |
| D5 | Should the `t` key (client tasks drawer) open the Workbench Client tab instead, so there is one client surface? | **Not yet.** Keep `t` as is until P4-5 (client strip) lands, then decide with both in front of you. |

Fixed choices (no decision needed):

- the hub reopens on the last tab and client
- log time is cut
- `/` is not used
- no new server code
