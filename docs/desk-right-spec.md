# Desk on the right: build spec (2026-10-17)

The Desk becomes a right-side panel and merges with the task drawer. It opens on the Desk (Inbox, Slate, Client tabs). Choosing a task drills into the task detail inside the same panel. Back arrow and Esc go back one level; Esc on the Desk list closes the panel. The panel is non-modal: the page behind keeps scrolling and working. Glass stays on the Desk only (panel and its closed handle); the modal task drawer, the client drawer and menus stay solid.

Base: main at 67e28ea. Builds on `docs/desk-spec.md` (D1 rename, D2 glass, D3 resizable dock all shipped; D4 drill-in never built, superseded by this spec). The Desk is still off for everyone until the tk_settings flag `wb_enabled` is on (Dev Tools preview flag `mgb_wb_preview` for testing). Until then the modal `TK_Drawer` is what every staff member sees.

**Size: Big** (multi-file redesign, focus and keyboard model, routing for every task open). Opus writes the spec, builds the risky slices, critiques and runs the final verify. Sonnet builds the contained UI slices with an Opus review. Haiku runs screenshot sweeps, grep checks and the node tests. Per-slice models are in section 15.

---

## 0. Owner decisions (each with a recommendation)

1. **Task opened from a page row** (Slate list, client page, search, bell, deep link, quick add). *Recommend:* yes, it opens in the Desk's task view whenever the Desk is live. Back target depends on where it started: if the panel was closed, Esc closes the panel and focus returns to the row you clicked, and the back arrow reads "Desk" and shows the last Desk tab. If the panel was already open, Esc and back both return to the Desk list.
2. **Old modal TK_Drawer.** *Recommend:* keep it, unchanged, only as the fallback (Desk off, View as or preview, the own-window Slate, task schema missing). It shares one body component with the Desk task view, so there is one place to fix task UI.
3. **Closed state on desktop.** *Recommend:* a right-edge **handle** (a small glass card below the top bar) carrying the approved content, which can be **tucked** to a 28px edge tab by dragging it right. No new top-bar pill (the top bar is already at its collapse limit). *Alternative:* a "3 late · 5 today" pill next to the Slate pill.
4. **How the closed state shows the count.** *Recommend:* split counts, "3 late" in the danger color and "5 today" in the normal text color; the tucked tab shows the combined number, with a red dot if anything is late. "Clean slate" when both are 0.
5. **Handle content (owner approved).** *Recommend:* ship all approved items: the late/today split, next-up with its client, waiting-on-you icons (messages, reviews, files), `+` quick add, a rotating key hint, a page-aware client line, pinned client chips and QBO sync staleness. Each one can be turned off in the gear (decision 9). The counts are locked on so the handle is never blank.
6. **Width.** *Recommend:* free width with magnet stops. Narrow 300, Standard 420 (default), Wide 560. Minimum 260 ("very narrow"); maximum `min(720, viewport − rail − 480)`. Dragging past the minimum by 80px, or flinging right faster than 0.6 px/ms, closes the panel. Opening a task from Narrow widens it to 380 for that task only.
7. **Length (height along the right edge).** *Recommend:* two remembered lengths, one for the closed handle and one for the open panel, each Short, Medium or Tall. The handle defaults to Medium and the open panel to Tall (full height). A task view always uses full height while it is open. Longer lengths fill with more glance items, and only items that are switched on fill (section 8).
8. **Push or overlay.** *Recommend:* push (the page narrows beside the Desk, like the widget editor) when at least 720px of page is left; overlay otherwise; full sheet on phones (≤760px).
9. **Desk settings gear.** *Recommend:* a gear in the panel head opens "Desk settings": on/off switches for each handle item and each open-Desk extra, plus "Reset to defaults". Saved per person in `mgb_wb_desk_prefs:<email>`. Reordering (up/down buttons) is an optional follow-up slice. Syncing across devices comes later.
10. **Dock position: bottom or right, per person (owner addition).** *Recommend:* yes. Right is the default for everyone. Switch by dragging the panel head to the other edge (a snap preview shows) or with "Dock: Right / Bottom" in the gear. One component with a `dock` prop, not two. Stored in the existing per-person geometry key `mgb_wb_desk:<email>` (v2, field `dock`) rather than a new `mgb_wb_desk_dock:<email>` key, so one parse handles both docks' sizes. Phones ignore it.
11. **Navigation while the Desk is open.** *Recommend:* in push layout, whatever is open (list or task) stays open when you change pages, so you can click the task's client and keep the task beside it. Overlay and the phone sheet close on navigation because they cover the page.
12. **Keyboard.** *Recommend:* D opens the Desk. If it is open and focus is on the page, D moves focus into the Desk; a second D closes it. Esc only acts when focus is inside the Desk. j/k and ↑/↓ move in whichever side has focus. Task keys x, s, a and ? only work when focus is inside the task view. F6 moves focus between the page and the Desk.
13. **Client drawer overlap** (the 420px client tasks drawer opened by `t`, the strip and the Slate pill on a client page). *Recommend:* while the Desk is live these open the Desk's Client tab for that client. The modal client drawer stays as the fallback.
14. **Widget edit mode** (dashboard widgets push 360px from the right). *Recommend:* entering edit mode closes the Desk and hides the handle; leaving it restores them.
15. **Order with P4-4 (snooze, saved filters).** *Recommend:* land R0 (the TK_Drawer split) first; P4-4 rebases onto it. The two never run in parallel.
16. **Task UX pass before the Desk build (owner request 2026-10-18: tasks are less obvious to use than Asana).** *Recommend:* yes, build slices T1 to T3 (section 15) first, so the Desk task view reuses the finished row and pane and the task UI is built once. What Asana does that ours does not: every field is visible even when empty (dashed assignee circle, faint date icon, priority always shown); every cell edits in place with a small picker; hover shows a "…" menu, subtask and comment counts; a "+ Add task" row under each group; people are initials avatars; the task pane is a labeled grid (Assignee, Due, Client, Project, Priority, Status) above the description. Board view by status (with drag between columns) and drag-to-reorder are separate follow-ups, T4 and T5, owner to decide later.
17. **Closed Desk uses the whole edge (owner request 2026-10-19: show max info while closed).** *Recommend:* yes. Right dock closed: the handle is a full-height strip from under the top bar to the bottom of the page (`top: var(--desk-top)`, `bottom: 0`), about 280px wide, overlaying the page; the tuck tab still exists for people who want the room back. Bottom dock closed: the bar is the full width of the page area (edge to edge beside the rail), not the 640px centered bar. The open Desk sizes are unchanged. This replaces the Short/Medium/Tall closed-handle lengths (decision 7, section 4) with one full-height handle that fills with every enabled item that fits, so the length grips apply to the open panel only; `--desk-max-w` centering applies to the open bottom panel only.

---

## 1. Terms

- **Dock**: `right` (new default) or `bottom` (D3 as shipped). Desktop only.
- **Layout** (right dock): `push`, `overlay` or `sheet`. Bottom dock: `bottom` or `sheet`.
- **Handle**: the closed Desk. Right dock: a card under the top bar on the right edge. Bottom dock: the existing 44px `.wb-bar`. Phone: the existing bottom bar.
- **Task view**: the drill-in task detail inside the panel (the shared `TK_DrawerContent` in embedded mode).
- **Drill stack**: the task views opened in a row (subtask, parent), max 5.
- **closeOnEmpty**: true when the task view opened while the panel was closed. Backing out of the last task closes the panel.

---

## 2. Where things mount (unchanged rules, new owner)

| Situation | Desk mounts | Task opens in |
|---|---|---|
| Staff, `wb_enabled` on (or preview flag), normal session | yes (`WB_deskMounts`) | Desk task view |
| `wb_enabled` off | no | modal `TK_Drawer` |
| View as / previewing (`isPreviewingUser`), impersonating | no | modal `TK_Drawer` (impersonating: no task host) |
| Own-window Slate (`tkShell`) | no | modal `TK_Drawer` |
| Task schema not ready (`TK_dwApi` probe fails) | yes | `LK_go` to work/tasks (today's fallback) |
| Phone (≤760px) | yes, sheet | Desk sheet task view |

`TK_DrawerHost` (`app.jsx:30827`) keeps mounting exactly as now (`tkHosts`), because it is the fallback and it owns arrivals. `TK_ClientDrawerHost` and `TK_QuickAddHost` also stay.

---

## 3. Layout and geometry

### 3.1 Right dock

- **Panel**: `section#wb-panel.wb-panel.wb-glass.is-dock.is-right` (keep `is-dock`; add `is-right` / `is-bottom` and `is-push` / `is-overlay`). `position: fixed; top: var(--desk-top); right: 0; bottom: 0` at Tall, or `height: var(--desk-len)` at Short or Medium. Width is `var(--desk-w)`.
- **It sits below the top bar** (`--desk-top` = the `.tb-bar` bottom, already measured by `WB__deskRoom`), so the bell, notes, search, user menu and their menus stay usable. Panel z `--wb-z-panel` 680 and handle `--wb-z-bar` 690, both below the top bar at 700.
- **Push** (new class `html.wb-desk-push`). Follows the widget editor pattern (`widget-drawer.css:477`):
  ```css
  html.wb-desk-push .main { padding-right: calc(40px + var(--desk-occupy)); }
  html.wb-desk-push .main > .tb-bar { margin-right: calc(-40px - var(--desk-occupy)); }
  ```
  The top bar stays full width. `--desk-occupy` is set on `<html>` to the panel width while open in push, otherwise 0.
- **Overlay**: same panel, no padding; a soft left shadow (`--desk-glass-shadow`); no scrim; the page stays clickable and scrollable.
- **During a drag**, the panel moves with the pointer (rAF paint of `--desk-w`). `--desk-occupy` updates only on release, so charts and tables reflow once rather than every frame.
- **New pure helper** in WB_logic.js:
  ```js
  WB_deskLayout({ vw, railW, w, dock }) // -> "push" | "overlay" | "sheet" | "bottom"
  // sheet if vw <= 760; "bottom" if dock === "bottom"; push if vw - railW - w >= 720; else overlay
  ```
  `railW` is read from `.staff-rail` (the same ResizeObserver that feeds `--wb-bar-left`). The sidebar becoming an icon rail by default (64px) only changes this number.
- **Width**: left-edge grip `div.wb-desk-handle[role=separator][aria-orientation=vertical]` (keep the class and `data-tour="wb-desk-handle"`). It reuses the D3 Pointer Events capture, the rAF paint, the 80ms velocity window and Esc-cancels-drag. New helpers:
  - `WB_DESK_W = { min: 260, narrow: 300, standard: 420, wide: 560, cap: 720 }`
  - `WB_deskWidthMax(vw, railW)` = `max(min, min(cap, vw − railW − 480))`
  - `WB_deskWidthSnap(w, vx, max)` returns `{ w, close }`. It applies a 24px magnet to narrow, standard and wide. `close` is true when `w < min − 80` or `vx > 0.6` px/ms to the right with `w < standard`.
  - Keys on the grip: ←/→ change width by 24px, PageUp/PageDown jump to the next magnet stop, Home goes to min, End goes to max, Enter resets to Standard. `aria-valuenow`, `aria-valuemin` and `aria-valuemax` are in px, with `aria-valuetext` such as "Desk width 420 pixels, Standard".
- **Length**: a bottom-edge grip `div.wb-desk-lenhandle[role=separator][aria-orientation=horizontal]` shows at Short and Medium; at Tall it sits on the bottom edge. It reuses the D3 height math anchored at the top: `WB_deskPoints(vh − desk-top)` and `WB_deskSnap`, with snap names mapped short→`strip`, medium→`medium`, tall→`tall` so the D3 helpers are reused unchanged.
- **Task view** forces full height and at least 380 width while it is showing. These are transient: they are never saved and are restored on back.

### 3.2 Bottom dock (D3, kept as an option)

- Everything D3 ships stays: centered beside the rail (`--wb-bar-left`), `--desk-max-w` 640, the height snaps strip/medium/tall, `--desk-pad` page padding, the `--desk-lift` toast and chat lift (except at ≥1100px), the bar drag-up to open, and the top-edge grip.
- **New in the bottom dock**: dragging below `strip` by 80px, or a downward fling over 0.6 px/ms, closes the panel (the same rule as dragging right in the right dock). Width is not resizable in the bottom dock (unchanged).
- The task view forces `tall` while it is showing, transient.
- Closed handle = the existing `.wb-bar`, widened to the full width of the page area beside the rail (decision 17). Its one line shows counts, next-up and, at ≥900px, the waiting icons and `+` (section 8.4).

### 3.3 Switching docks (owner addition)

- **Drag**: press on the panel head (title area, not its buttons) and move more than 8px. The panel follows the pointer at 0.9 opacity. When the pointer comes within 120px of the *other* dock's edge (the right edge from the bottom dock, the bottom edge from the right dock), a snap preview appears: a dashed `--desk-edge` outline of where the panel would land, class `wb-dock-preview`, z 685. Releasing inside the zone switches docks; releasing anywhere else springs back (180ms; instant with reduced motion). Esc during the drag cancels.
- **Gear**: "Dock: Right / Bottom" radio buttons in Desk settings. This is the keyboard and assistive-technology path.
- **After a switch**, an aria-live message ("Desk moved to the right") plays and focus stays in the panel head. Usage event `wb-dock` with `{to}`.
- **Pure helper**: `WB_deskDockTarget({ x, y, vw, vh, dock })` returns `"right" | "bottom" | null`.
- Each dock keeps its own remembered size, so switching back restores it.

### 3.4 Phones (≤760px)

Dock, width and length are ignored. The bottom 44px bar and the full-height sheet from D3 stay (`100dvh` minus the safe area). The task view drills inside the sheet. The gear is in the sheet head. Handle prefs apply to the bar's single line (counts and next-up only).

### 3.5 Remembered geometry: `mgb_wb_desk:<email>` v2

```js
{ v: 2, dock: "right",
  right:  { w: 420, len: "tall", hlen: "medium", tucked: false },
  bottom: { snap: "medium" } }
```

- `WB_deskParse` accepts v1 `{v:1, snap}` and migrates it to v2 with `dock: "right"` and `bottom.snap = snap`. Nobody is live yet, so everyone starts on the right.
- Junk falls back to defaults.
- `w` is re-clamped to the current window on load and on resize (it is stored as wanted, applied clamped).
- `WB_deskSerialize` writes v2 only.
- `WB_store.desk` becomes `{ dock, right, bottom }`. `setDeskSnap` stays for the bottom dock; add `setDeskWidth`, `setDeskLen(which, snap)`, `setDeskDock` and `setDeskTucked`.

---

## 4. Closed handle (right dock)

- **Element**: `button.wb-handle.wb-glass` inside the existing `div.wb-desk-root` portal, with `data-tour="wb-bar"`. It reuses the frozen tour id so the existing tour steps and announcement steps still find it; the phone and bottom-dock bar keep it too. It is a grid of small zones; the zones that act (`+`, a waiting icon, a chip) are their own buttons inside a `div[role=group]` wrapper, not nested buttons.
- **Position** (decision 17): full height, `top: var(--desk-top); right: 0; bottom: 0; width: 280px`, no gap, so it shows the most it can. The chat launcher and toasts shift left of it (section 9). There is no `hlen`; the fill rule uses the available height.
- **It overlays the page** (no push). Drag it right more than 40px, or press "Tuck" in the gear, to tuck it into a 28px × 72px edge tab (`.wb-handle.is-tucked`). The tab shows the total count and a late dot. Clicking the tab opens the Desk; dragging it left untucks it.
- It auto-tucks when the page area is under 900px wide. That is not saved, and it untucks when there is room again.
- **Click** (not on an inner button) opens the Desk with `openedBy:"bar"`. **Drag left** more than 12px from the handle opens it too, like the D3 drag-up.
- No length grip on the closed handle (decision 17); the open panel keeps its length grip.
- **Content** fills by length budget from the enabled items (section 8).

---

## 5. Task view (drill-in) and routing

### 5.1 One router

- `TK_openTask(id, opts)` (`TK_Drawer.jsx:452`) first calls `window.TK_openTaskRoute?.(id, opts)`. If that returns true, it stops. Otherwise it runs today's path (`TK_dlOpenTarget`, then a `tk:open-task` event or `LK_go`).
- `WB_Drawer` registers `TK_openTaskRoute` while it is mounted and removes it on unmount. It returns true when the pure `WB_deskRoute({ live, schemaOk, opts })` returns `"desk"`, which happens when the Desk is live, the schema probe is ok, and `opts.modal !== true` (an escape hatch for future callers). It then calls `WB_store.drill(id, opts)`.
- Every current caller goes through this router automatically, including DeepLink:465, TopBar:599 and :1026, TK_MyTasks:335 and :432, TK_BulkBar:256, TK_QuickAdd:162, TK_WaitingList:108, TK_ReviewQueue:259, TK_keys:113 (focus "assignee"), TK_List (:1171, :1324, :1586, :1638), TK_TaskRow (:138, :751, :1088, :1300), TK_ClientDrawer (:228, :330), and app.jsx :6908 and :7524. `TK_vOpenTask` and `TK_openTaskClick` inherit it.
- **Arrivals**: in `TK_DrawerHost`, the `LK_useArrival` branch changes from `open(a.id)` to `TK_openTask(a.id, { from: "arrival" })` so deep links reach the Desk too.
- `WB_hubOpen` (WB_store.js:773): task rows call `WB_store.drill` directly. Chat, files and others are unchanged except for decision 11 (`WB_go` keeps the Desk open in push layout).
- `window.TK_drawerHostReady` (read by TopBar.jsx:123 and DeepLink.jsx:464) is unchanged.

### 5.2 Drill stack (WB_store)

- `desk.drill: [{ id, from, focus }]` and `desk.origin: { closeOnEmpty, tab }`. The opener element is kept in a module ref, not stored.
- Pure helpers:
  - `WB_drillPush(stack, item, cap=5)`: if the same id is on top, it updates `focus` only; when over the cap it drops the oldest.
  - `WB_drillPop(stack)`
- Subtask and parent clicks (TK_Drawer :1074, :1099, :1838) arrive with `from:"subtask"` or `"link"` and push.
- While the task view is open, `TK_store.deskTaskId` is set (a new field). `drawerId` stays reserved for the modal. Row highlight consumers (TK_MyTasks:228, TK_List:1011, TK_ClientDrawer:410) read `drawerId || deskTaskId`. The page-list key disable (TK_List:1483) keeps reading only `drawerId`, so page j/k keep working beside the Desk.
- The `tk:drawer-open` event still fires, with `detail.embedded = true` (StaffInbox.jsx:1901 and WidgetDrawer.jsx:678 listen).
- Usage: `tasks-drawer` as now, plus `wb-drill` with `{from}`.

### 5.3 Panel head in the task view

- Back arrow `button.wb-back`, labeled "Back to Desk" or "Back to <parent title>". Then the task context line, Copy link, More (`TK_dwMenu`) and Close ×.
- Tabs and chips are hidden while the task view is showing. The Desk list panes stay mounted and hidden, keeping their scroll.

### 5.4 Navigation (decision 11)

- `WB_deskNavStep({ layout, view, msSinceOpen })` returns `"keep" | "close"`.
  - push: keep.
  - overlay and sheet: close, except within 500ms of an arrival (the same grace `TK_DrawerHost` uses).
- This replaces the D3 "hashchange closes the Desk" rule.
- **Reload**: the hub blob (`WB_HUB_OPEN_MS` = 5 minutes) reopens the Desk list on any route in push layout and on the same route otherwise. The task view is not restored from storage; deep links (`?task=`) handle that through arrivals.

---

## 6. Keyboard model

| Key | Focus on page | Focus in Desk list | Focus in task view |
|---|---|---|---|
| D | closed: open and focus the Desk. Open: focus the Desk | close | close (keeps the stack for 5 minutes) |
| Esc | page's own handlers only | close | ladder (below) |
| j/k, ↑/↓ | page lists | Desk rows (`WB_hubFocusTarget`) | not handled |
| Enter | page | open the row (drill or `WB_hubOpen`) | field default |
| x, s, a, ? | page lists (`TK_keys`) | not handled | task actions (`TK_shouldHandleKey` with `embedded:true`, scope = panel ref) |
| q (quick add) | yes | yes | yes |
| F6 | focus the Desk (if open) | focus the page `main` | focus the page `main` |

- D stays guarded by `WB_deskToggleKey` (plain d, no modifiers, no repeat), `WB_keyBlocked`, the typing check and `WB_layerAbove`.
- **Esc ladder**, extending `WB_deskEscStep`:
  1. a layer above
  2. the open picker
  3. a field that keeps Esc
  4. the inner panel (the SOP side panel)
  5. drill depth > 1: pop
  6. depth 1 and not closeOnEmpty: back to the list
  7. depth 1 and closeOnEmpty: close
  8. list: close

  New inputs: `drillDepth`, `closeOnEmpty`.
- **Tab** is only trapped in the phone sheet (as D3). On desktop, Tab moves naturally between the page and the Desk.
- `TK_QuickAdd.jsx:547` and `TK_keys.jsx:67` treat `[aria-modal]` as blocking. The desktop Desk is `role=region`, so it does not block. The sheet is `aria-modal`, so it blocks as today.

---

## 7. Focus, ARIA and focus return

- **ARIA**: desktop panel `role=region aria-labelledby="wb-panel-title"`. Phone sheet `role=dialog aria-modal=true`, unchanged. The task view region has `aria-label="Task: <title>"`. Back and close have text labels.
- **On open**: D and the handle focus `WB_hubFocusTarget` after 30ms. Restore and tour do not move focus (unchanged).
- **Opener ref**: saved on every open and every drill from outside the panel (`document.activeElement` if it is outside the panel).
- **Close**: focus goes to the opener if it is still connected. Otherwise to the handle (or the tucked tab), otherwise `main`. This replaces `WB_deskCloseFocus` with `WB_deskReturnFocus({ openerOk, handleOk })`.
- **Drill from the Desk list**: focus the task title. Back: focus the row (`data-tk-id`).
- **Drill from a page row**: focus the task title. Esc returns focus to that page row, and the panel goes back to its list or closes (closeOnEmpty).
- The `WB_useHubLayers` MutationObserver focus-give-back is unchanged (only when the zone is the Desk, or on the sheet).

---

## 8. Glance content, length fill and the Desk settings gear

### 8.1 Items

Handle items (closed, right dock):

| id | Item | Default | Lines | Min length | Shows when |
|---|---|---|---|---|---|
| `counts` | Late / Today split (locked on) | on | 1 | short | always |
| `next` | Next up + client name | on | 1 | short | an item exists |
| `waiting` | Waiting on you icons: messages, reviews, files (count badges; each opens that Inbox chip) | on | 1 | medium | any count > 0 |
| `add` | `+` quick add (opens `TK_QuickAdd`) | on | 0 (sits in the counts line) | short | always |
| `client` | This page's client: "Acme · 2 open · last msg 3d" | on | 1 | medium | on a client page and that client has open items or unread messages |
| `pins` | Pinned client chips (from `mgb_wb_pins:<email>`, up to 4 at medium and 8 at tall) | on | 1–2 | medium | pins exist |
| `qbo` | QBO sync staleness: the page client if stale over 24h, otherwise "3 clients not synced in 2+ days" | on | 1 | medium | something is stale (from `lastSyncedAt` on `visibleClients`; no new fetch) |
| `next3` | The next 3 items after next-up | on | 3 | tall | items exist |
| `hint` | Rotating key hint: D, Esc, j/k, q, F6 (8s; static with reduced motion; hidden after 10 opens by D) | on | 1 | tall | not retired |

Open-Desk extras (a "glance" strip above the tabs):

| id | Item | Default | Lines | Min length |
|---|---|---|---|---|
| `glance` | Counts + waiting icons row | on | 1 | short |
| `pageClient` | Page client card (open, waiting, last message, QBO staleness) | on | 2 | medium |
| `pins` | Pinned chips row | on | 1 | medium |
| `agenda` | Due this week (5 rows) | off | 5 | tall |
| `qboList` | Stale syncs across my clients | off | 3 | tall |
| `foot` | Key hints footer (existing) | on | 1 | short |

### 8.2 Fill rule (pure, `WB_deskFill`)

```js
WB_deskFill({ items, prefs, tier, ctx }) // -> [ids to render]
// budget: closed handle = every line that fits its full height (decision 17); short 1, medium 3, tall 6 (glance strip)
// walk items in prefs order; skip off, skip minTier > tier, skip !shows(ctx);
// add while lines fit; counts always first
```

Only enabled items fill. Turning one off lets the next enabled item move up. A Short length never grows past its budget. With the bottom dock and the phone bar, the handle tier is a fixed `bar`: one line, holding `counts`, `next`, and at ≥900px `waiting` and `add`.

### 8.3 Gear and prefs

- **Gear**: `button.wb-gear[data-tour="wb-desk-gear"][aria-haspopup=menu]` in the panel head. It opens a `.wb-menu` popover (menu layer, z 3000), "Desk settings", with these groups:
  - "Dock: Right / Bottom" (radio)
  - "When closed" (switches for the handle items)
  - "On the open Desk" (switches)
  - "Tuck the handle"
  - "Reset to defaults"

  Each switch is `role=menuitemcheckbox`.
- **Key**: `mgb_wb_desk_prefs:<email>`
  ```js
  { v: 1, handle: { on: { qbo: false }, order: [] }, desk: { on: { agenda: true }, order: [] }, hintOpens: 3 }
  ```
  It stores overrides only, so new items get their defaults. `WB_prefsParse` and `WB_prefsSerialize` drop unknown ids, cap it at 2KB and fall back on junk. `WB_store.setPrefs(patch)` saves with the hub's 500ms throttle. Usage event `wb-prefs` with `{id, on}`.
- **Reorder (optional R4b)**: ↑/↓ buttons on each row, written to `order`. `WB_deskFill` already honors it.

### 8.4 Data

Everything comes from what the Desk already loads (hub rows, pins, `visibleClients`, current client and page). No new queries or tables. The waiting counts come from the Inbox chip counts (`WB_DRAWER_TABS`).

---

## 9. Layering

| Thing | z | With the right dock open |
|---|---|---|
| Top bar `.tb-bar` | 700 | above the Desk; its menus are unaffected |
| Desk panel / handle / dock preview | 680 / 690 / 685 | |
| Modals, `[aria-modal]`, modal task drawer, client drawer, chat drawer | 2000 / 1900 / 1850 / 1840 / 1835 | above the Desk (unchanged `WB_LAYERS`) |
| Menus, pickers | 3000 | above |
| Tour | 2900 | above. In overlay layout a tour start closes the Desk unless its step targets a `wb-` id |
| Toasts `.toast-stack` | 2100 | `right: calc(var(--desk-occupy-any) + 24px)` |
| Chat launcher `.si-launcher` / `.chat-fab-wrap` | 900 | `right: calc(var(--desk-occupy-any) + 16px)` |
| Undo bar `.wb-undo` | 2050 | centered on the page area: `left: calc(var(--wb-bar-left) + (100vw - var(--wb-bar-left) - var(--desk-occupy-any)) / 2)` |

- `--desk-occupy-any` is the panel width in push *or* overlay (right dock, open). It is 0 when closed, in the bottom dock and on phones. The bottom dock keeps the D3 `--desk-lift` rules.
- **Tips**: `TIPS_BUSY` (Tips.jsx:141) changes `.wb-panel` to `.wb-panel:not(.is-push)`, so tips still show beside a pushed Desk. Tips.jsx:797 adds `.wb-handle` to the pinned list.
- **Tour**: `TOUR_stickyBottom` (Tour.jsx:330) keeps `.wb-bar` and `.wb-panel.is-bottom` and drops a right-dock panel. The new `TOUR_stickyRight()` returns `--desk-occupy-any` so popovers avoid it. Tour.jsx:346 adds `.wb-handle`.
- **Print**: hide `.wb-handle` and `.wb-dock-preview` too.

---

## 10. Modal TK_Drawer and the split (R0)

- New file `components/tasks/TK_DrawerContent.jsx`, loaded right before `TK_Drawer.jsx` in the `index.html` source list (line 392).
- It holds the current `TK_Drawer` body: state, fetch, effects, the x/s/a/? keys and the header contents. The current lines to move are :1313-2275 plus the header parts of :2277-2406, `TK_dwFollowers`, `TK_dwSopPanel`, `TK_dwConfirm`, `TK_dwSendBack` and `TK_dwKeys`.
- Props:
  ```js
  { taskId, mode: "drawer" | "embedded", scopeRef, onClose, onBack, onOpenTask,
    registerEsc, focusField, staffUser, clients, isAdmin,
    canManageTemplates, canCreateTemplates, onOpenTemplates }
  ```
  - `registerEsc(fn)` lets the host ask "will you eat this Esc" (SOP panel, inner modals).
  - In `mode:"drawer"` the content behaves exactly as today.
- `TK_Drawer.jsx` keeps the helpers (:19-450), `TK_openTask`, `TK_openTaskClick`, `TK_DrawerHost`, `TK_dwMenu`, and a thin `TK_Drawer` chrome: `tk-dw-layer`, the scrim, `aside.tk-dw[role=dialog][aria-modal]`, the Tab trap, `body.tk-drawer-open` scroll lock and opener focus restore (:1451-1465, :1628-1671).
- **R0 changes no behavior**: same DOM, same classes, same keys. It is checked by a before/after DOM snapshot of the drawer on one task and the existing `TK_drawerLogic.test.js`.
- **Embedded mode** (built in R2): no portal, scrim, aria-modal, trap or scroll lock. Keys are scoped to `scopeRef` via `TK_shouldHandleKey(e, { scope: "drawer", embedded: true })` (already supported, TK_logic.js:1083). `onClose` maps to the Desk Esc ladder.
- **CSS (R2)**: wrap the content in `.tk-dwc { container: tkdw / inline-size }`. Copy the phone rules from `tk-drawer.css @media (max-width:760px)` (one-column fields, 40px targets) into `@container tkdw (max-width: 480px)`. The modal keeps its media rules and also matches the container rule on phones (375 is under 480), so it looks the same. The `body.tk-drawer-open` scroll lock stays media-only and modal-only.
- **P4-4 collision**: P4-4 edits the More menu snooze items, `TK_MyTasks`, `TK_List`, `TK_Sidebar`, `TK_viewLogic` and `TK_App`. After R0, its drawer edit lands in `TK_DrawerContent.jsx`. Do R0 first, then P4-4 rebases. R2 also touches `TK_List` and `TK_MyTasks` (`deskTaskId` highlight), so R2 runs after P4-4 lands or rebases onto it. Any fix from the in-flight "Desk task click regression" work lands before R0.

---

## 11. What stays from D3 and what goes

**Stays (reused by both docks):**
- the snap and fling math (`WB_deskPoints`, `WB_deskSnap`, `WB_deskStep`, `WB_DESK_FLING`)
- Pointer Events capture, the rAF paint and Esc-cancel
- the separator ARIA and value text
- `WB_deskFocusZone` and `WB_DESK_LAYER_SEL`
- the glass tokens and every fallback (`@supports not`, reduced transparency, forced colors, reduced motion)
- `WB_deskMounts`, `WB_deskToggleKey`, `WB_deskEscStep` (extended)
- the sheet mode and `WB_useDeskMode`
- the hub blob and pins
- `WB_UndoBar`
- **the whole bottom dock** (decision 10): `.wb-bar`, the drag-up, `--desk-pad`, `--desk-lift`, `--wb-bar-left` centering and `--desk-max-w`, scoped under `.is-bottom` / `html.wb-dock-bottom`

**Changes:**
- the hashchange-closes rule (replaced by `WB_deskNavStep`)
- `WB_deskCloseFocus` (replaced by `WB_deskReturnFocus`)
- v1 → v2 storage
- the "Drag the top edge" foot hint and the `desk-resize` tip text, which become dock-aware

**Deleted:**
- D4's "Open on its own" item (never built; not needed)
- If the owner says no to decision 10, R1 also deletes the bottom-dock CSS and drag-up (about 150 CSS lines and 80 JS lines) instead of scoping them.

**Cost of keeping the bottom dock** (one component with a `dock` prop):
- about +1 medium slice (R1b)
- a doubled screenshot matrix (two docks × push/overlay × light/dark)
- about 230 lines kept instead of deleted

Two separate components were rejected: the keys, Esc, focus and drill logic would be duplicated and drift apart.

---

## 12. Tests

All node tests use the existing runners.

**`WB_logic.test.js`:**
- `WB_deskLayout`, including rail changes, push/overlay at the 720 boundary, sheet at 760 and the bottom dock
- `WB_deskWidthMax`, and `WB_deskWidthSnap` for magnets, close by distance, close by fling and no close above Standard
- `WB_deskDockTarget` zones
- `WB_deskParse` v2 round trip, v1 migration and junk input
- `WB_deskRoute`: live or not, schema, `modal:true`
- `WB_deskNavStep`, including the 500ms grace
- the `WB_deskEscStep` ladder for every row of the table in section 6
- `WB_deskReturnFocus`
- `WB_prefsParse` (unknown ids, cap, defaults) and `WB_deskFill` (budgets, off items, min length, order, locked counts, the `bar` tier)

**`WB_store.test.js`:** `drill` push and pop, cap 5, same-id no-op, `origin.closeOnEmpty`, `setDeskWidth`, `setDeskLen`, `setDeskDock`, prefs save throttle, and `adoptHub` reading v2.

**TK tests:** `TK_drawerLogic.test.js` and `TK_logic.test.js` pass unchanged after R0. Add `TK_shouldHandleKey` embedded cases if they are missing.

**Owner browser checklist** (Haiku sweep, then the owner):
- 1440, 1100, 900, 760 and 375 wide, light and dark, right and bottom dock
- open and close by D, the handle, drag-to-close, tuck
- a task from the Slate list with the Desk closed and with it open, then Esc and back
- a subtask chain to depth 5
- a deep link `?task=`
- toast, chat button and Undo placement
- a tour and a tip beside a pushed Desk
- widget edit mode
- View as (modal fallback) and the own-window Slate (modal)
- gear toggles changing the handle at each length

---

## 13. Upkeep (same commit as each user-facing slice)

**Guide**: per-slug, md5-guarded upserts only. **Never run `docs/staff-guide/sync.mjs`** (it deletes rows). Slugs are frozen.
- `workbench`: right side, handle, width and length, push vs overlay, dock switch, gear, keys table
- `task-details`: "details open in the Desk on the right. Press Esc or Back to return", plus the fallback wording for View as
- `client-tasks-drawer`: now the Desk's Client tab
- `home-page`, `tips`, `whats-new`, `my-tasks`, `inbox`, `admin-guide`, `admin-insight`: mentions and screenshots

**Tips (Tips.jsx):**
- `desk-resize` re-pointed to `wb-desk-handle` with dock-aware text
- `wb-more` and `wb-noreply`: confirm their targets still exist inside the panel
- new `desk-settings` (target `wb-desk-gear`) and `desk-tuck` (target `wb-bar`)

**Tour (Tour.jsx):** add the ids `wb-desk-gear`, `wb-desk-lenhandle` and `wb-back` to the list at :151-154; the sticky measures from section 9.

**Announcements (announcements.js):** new `desk-right-launch` with these steps:
- ann-welcome
- ann-handle (`wb-bar`)
- ann-edge (`wb-desk-handle`, "drag to resize, drag off to close")
- ann-drill ("tasks open right here; Esc goes back")
- ann-gear (`wb-desk-gear`, "pick what shows; move the Desk to the bottom")

It uses `ready: ANN_deskOn()` and the roles admin and bookkeeper. `desk-launch` stays as history.

**Dev Tools:**
- bump MGB_VERSION (`index.html:205`)
- the reset-list comment at app.jsx:13952 names `mgb_wb_desk_prefs:<email>` and the v2 `mgb_wb_desk:<email>` (the `mgb_` prefix already resets them)
- add a Dev Tools row "Desk dock: right/bottom" that shows the current value
- the flags `wb_enabled` and `mgb_wb_preview` are unchanged

**Usage Stats (app.jsx ~17120-17151):**
- add `"wb-drill": "Task opened in the Desk"`, `"wb-dock": "Desk moved (right/bottom)"`, `"wb-prefs": "Desk settings changed"`, `"wb-tuck": "Desk handle tucked"`
- relabel `"wb-resize"` to "Desk resized (width, length or height)"

**README:** the Desk section (dock, keys, storage keys).

**New-feature notice:** the announcement above counts as the next-visit notice plus walkthrough.

---

## 14. Rollout

1. Ship behind the existing gate: Desk off until `wb_enabled`. Test with `mgb_wb_preview`.
2. The owner runs the checklist (section 12) with preview on.
3. Turn on `wb_enabled`. The modal drawer stays as the fallback, so turning the flag off again is a full rollback.

---

## 15. Slices

Weekly-usage estimates assume the 85% weekly cap and about 12% a day.

| Slice | What | Size | Build / review / checks | Est. weekly usage |
|---|---|---|---|---|
| T1 | Task row pass (`TK_TaskRow`): initials avatar for assignee, dashed placeholders for empty assignee and date, due chip (red overdue, amber today), priority always visible, in-place pickers on every cell, hover "…" menu with subtask and comment counts; same row in Slate, My Tasks, client pages and the Desk | M | Sonnet builds, Opus reviews, Haiku sweep (all list hosts) | 4–5% |
| T2 | "+ Add task" row at the bottom of each group (Slate, My Tasks, client pages), inline title entry, Enter adds and keeps going | S | Sonnet builds, Opus reviews | 1–2% |
| T3 | Labeled field grid at the top of the task pane (Assignee, Due, Client, Project, Priority, Status), description, subtasks, comments, Ask client below; done inside `TK_DrawerContent` right after R0 so the modal drawer and the Desk both get it | M | Sonnet builds, Opus reviews, Haiku sweep (modal + Desk) | 3–4% |
| T4 (later, owner call) | Board view by status with drag between columns | L | Opus builds and critiques | 8–10% |
| T5 (later, owner call) | Drag to reorder within a group | S | Sonnet builds | 1–2% |
| R0 | TK_Drawer split into `TK_DrawerContent` + chrome, no behavior change (section 10) | M | Opus builds (high), Opus reviews, Haiku runs tests and the DOM-snapshot diff | 5–7% |
| R1 | Right-dock shell: `WB_deskLayout`, push/overlay/sheet, width grip + magnets + drag-to-close, v2 storage + migration, closed handle (Short tier: counts, next, `+`), tuck, z and toast/chat/Undo shifts, D/F6/Esc list level, focus return, widget edit mode | L | Opus builds, Opus critiques, Haiku screenshot sweep | 11–13% |
| R1b | Bottom dock kept as an option: `dock` prop, `.is-bottom` scoping, drag-down close, dock switch by head drag + preview, `WB_deskDockTarget` | M | Sonnet builds, Opus reviews, Haiku sweep (both docks) | 4–6% |
| R2 | Drill-in: router `TK_openTaskRoute`, drill stack, embedded `TK_DrawerContent`, container queries, `deskTaskId`, nav rule, Esc ladder, arrivals, client drawer → Desk Client tab | L | Opus builds, Opus critiques, Haiku sweep incl. the modal fallback | 10–12% |
| R3 | Length grips (handle + panel), `WB_deskFill`, full handle content (waiting, page client, pins, QBO, next3, hint), glance strip | M | Sonnet builds, Opus reviews, Haiku sweep | 6–8% |
| R4 | Gear + `mgb_wb_desk_prefs:<email>`, switches, dock radio, reset | M | Sonnet builds, Opus reviews, Haiku checks | 4–6% |
| R4b | Optional reorder | S | Sonnet builds and self-checks, Haiku test run | 1–2% |
| R5 | Upkeep (section 13): 10 guide slugs, tips, tour, announcement, Dev Tools, Usage Stats, README | M | Sonnet writes, Opus final verify (whole feature, owner checklist dry run) | 6–8% |

- **Total**: about 46–61% of a week, roughly 4–5 working days at the current pace. Plan it over two weeks next to other work.
- **Without the bottom dock** (decision 10 = no): drop R1b (about −5%).
- **Order (updated 2026-10-19, trimmed plan)**. Run strictly in sequence, one writer per file set, upkeep in each slice's own commit, one Opus review per slice:
  1. **T1 + T2** (row pass and "+ Add task" row, one brief). Sonnet builds, Opus reviews. 5–7%.
  2. **R0 + T3** (TK_Drawer split, then the labeled task pane on top; one job). Opus builds, Opus reviews. 6–9%.
  3. **R1** right-dock shell. Opus builds, Opus critiques. 10–12%.
  4. **R2** task view inside the Desk. Opus builds, Opus critiques. 10–12%.
  5. **R3 + R4** (length auto-fill and gear/prefs share the item list and prefs; one job). Sonnet builds, Opus reviews. 8–11%.
  6. **Final Opus verify** (whole feature, owner checklist dry run; replaces the old R5, since upkeep ships in each slice). 2–3%.
  Total about 41–54% of a week. Owner then turns on `wb_enabled`.
- **Deferred to the week of Nov 2 (kept in the plan, owner decision 2026-10-19):** **R1b** bottom dock option (+4–6%), **R4b** optional glance-item reorder (1–2%), **P4-4** snooze and saved filters (rebases onto R0/R2 afterwards), **T4** board view and **T5** drag reorder (owner calls), the section 17 differentiators, handle extras if trimmed at R1/R3 (key hint, page-aware client line, pinned chips, QBO staleness), width magnet stops and push layout if shipped as free-drag overlay first. Until R1b lands the existing D3 bottom dock is replaced by the right dock when R1 ships; decision 10 stays on the list.
- **Upkeep for T1 to T3** (same commit each): staff guide Tasks articles, Tasks tour stops (row, add row, task pane), tips targets that point at row cells, What's-new entry and announcement, Dev Tools MGB_VERSION, README.

---

## 16. Risks

- **P4-4 and the Hub H5/H6 slices** also touch `TK_Drawer.jsx` and `WB_Hub.jsx`. Run them strictly in sequence (decision 15). H5 (action strip) should land after R2, so it is built inside the drill-aware head.
- **Push reflow**: wide tables and charts reflow when the Desk opens. Mitigated by updating `--desk-occupy` only on release, and by the 720px page minimum (overlay below it). Watch for ResizeObserver loop warnings in the top-bar container queries.
- **Two key owners**: page and Desk lists both answer j/k. Focus decides, and `deskTaskId` keeps page keys alive. Any key bug here is easy to feel, so it goes on the owner checklist.
- **Non-modal accessibility**: no focus trap on desktop. F6 and the focus return rules carry the load. Test with VoiceOver once.
- **The handle overlays page content** on the right edge. Tuck, auto-tuck under 900px and the 248px width keep this small. If the owner finds it in the way, the fallback is decision 3's top-bar pill.
- **Two docks double the visual test surface** (R1b cost). One shared component keeps the logic single.
- **Flipping `wb_enabled`** changes task opening for every staff member at once. The modal fallback is the rollback.

---

## 17. After the Desk: Slate differentiators (backlog, owner brainstorm 2026-10-18)

Source: claude.ai artifact "Where Slate can win" (TS3fpfXacNpXUB85cD6TAb): complaints about Asana, ClickUp, Monday, Notion, Trello/Basecamp/Planner, Todoist, Motion/Sunsama, Karbon, TaxDome and Financial Cents, and what only a task manager inside the books and client portal can do. Not part of the Desk build. Each becomes its own spec when picked. Where an idea touches work already planned, the hook is noted.

| # | Idea | Hook into this plan | Status in the app |
|---|---|---|---|
| 1 | Tasks that check themselves (task or template step linked to a `close_checks` / reconciliation status; green "QuickBooks agrees", amber if new activity lands after the tick) | New row chip in T1 (leave room for a status chip on the row) | Partly built (close_checks, qbo_account_status) |
| 2 | One "what we need from you" checklist per client (upload resolves the staff task, reminders escalate) | Desk Client tab and handle "waiting on you" icons read the same data | Partly built (Ask client S5/S6) |
| 3 | Work that starts when inputs arrive ("Waiting on bank", never red) | Template triggers | Partly built (recurrence engine) |
| 4 | Tasks carry their evidence (typed links to GL flag, transaction, file, message; grounded client-question draft) | Task pane (T3) gets a "Linked" section | Partly built |
| 5 | Close progress the client can check ("7 of 10 steps, waiting on 1 from you") | Client dashboard card | Mostly built |
| 6 | Nonprofit calendar template packs by client type | Templates | Partly built |
| 7 | Capacity: task size, weekly totals against QuickBooks Time hours and the client budget, warning at assign time (suggest only, never auto-move) | Size field in the T3 grid; weekly total can be a Desk glance item (R3) | Hours budget built; size new |
| 8 | Treasurer turnover (requests addressed to a role) | Client contacts | Partly built |
| 9 | Quiet by default notifications (daily digest) | Settings | Bell and emails built |
| 10 | Weekly reset for anything overdue 7+ days | Desk could host it as an Inbox mode | Bulk bar and hand-off built |
| 11 | One lead, many helpers | Avatars in T1 show lead plus helper stack | Followers built |
| 12 | Fast and simple, full export of tasks, comments, files | Keep the T1 to T3 pass light | Lists, keys, search built |

Guardrails from the same brainstorm: no ClickUp-style feature sprawl, no endless custom fields, AI drafts and suggests but never acts on its own, stay specific to bookkeeping for churches and nonprofits.

Suggested order after the Desk ships: 1, then 2 and 8, then 3 and 6, then 9 and 10, then 7, 4, 5, 11 as staff ask. Test the top three with two or three bookkeepers and one volunteer treasurer before building.
