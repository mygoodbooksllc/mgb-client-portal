# Desk slice spec (2026-10-17)

The Workbench bottom drawer becomes **Desk**. The Tasks module becomes **Slate**. The Desk turns into a frosted-glass, resizable, non-modal dock, and opening a task from the Desk now shows it inside the Desk ("drill-in").

- **Base:** 0807f2f (Workbench hub H4, the Client tab).
- **Status:** spec only. No app code, database, edge function or Asana changes are made here.
- **Size:** Big (a multi-file redesign that touches the 2,400-line TK_Drawer). Opus writes the spec, builds D3 and D4, critiques and does the final verify. Sonnet builds D1 and D2 (copy and CSS). Haiku runs the grep and screenshot sweeps.
- **Earlier decisions:** see `docs/workbench-hub-spec.md`. Its R9 said a non-modal dock needs its own spec, and this is that spec.

---

## 1. Current state (file:line, at 0807f2f)

### Name

- `components/workbench/WB_logic.js:8-12`: `var WB_NAME = "Workbench"`. It is used everywhere in WB_*, StaffNav and StaffInbox.
- The test file asserts it at `WB_logic.test.js:282`.
- There is no constant for the Tasks name. "Tasks" and "My Tasks" are literal strings, about 120 user-facing hits (§3.2).

### Desk shell

- **`WB_Drawer.jsx`**
  - `WB_Drawer.jsx:50-87` sets `html.wb-drawer-on` and `--wb-bar-left`, using `.staff-rail` measured by a ResizeObserver plus a 600 ms interval.
  - `WB_Drawer.jsx:94-106` handles focus. On every open it moves focus into the panel after 30 ms, including the 5-minute reopen on page load. On close it moves focus to the bar.
  - `WB_Drawer.jsx:109-114`: a hashchange closes the panel.
  - `WB_Drawer.jsx:122-150`: the bar is `button.wb-bar` with `aria-haspopup="dialog"` and `data-tour="wb-bar"`. In the DOM, the bar comes before the panel.
- **`WB_Hub.jsx`**
  - `WB_Hub.jsx:250`: `.wb-scrim`, with `onClick` set to close.
  - `WB_Hub.jsx:251`: `.wb-panel` has `role="dialog" aria-modal="true" tabIndex=-1 data-tk-keyscope="drawer"`.
  - `WB_Hub.jsx:33-97` `WB_useHubKeys`: a window capture listener for W, Esc and Tab.
    - Esc closes unless a layer sits above or a field still holds text.
    - Lines 59-77 are a **Tab trap**.
  - `WB_Hub.jsx:128-162` `WB_useHubLayers` adds `html.wb-hub-open`, and a MutationObserver puts focus back.
  - `WB_Hub.jsx:253-262`, the head: `{WB_NAME}`, the count, a "Full page" link to `#/today`, and Close.
  - `WB_Hub.jsx:350-354`: the hint text in the foot.
- **`WB_store.js`**
  - `WB_store.js:112-113` holds `drawerOpen` and `hub`.
  - `WB_store.js:551-607` saves to **localStorage** `mgb_wb_hub:<email>` (the hub spec says sessionStorage). Saves are throttled to 500 ms.
  - A saved state reopens the panel only within 5 minutes of being written (`WB_HUB_OPEN_MS`, `WB_logic.js:340`), on the same route, and not on an `?item=` arrival.
- **`WB.css`**
  - `WB.css:9-21` holds the tokens: `--wb-z-bar 1830`, `--wb-z-scrim 1810`, `--wb-z-panel 1820`, `--wb-bar-h 44px`, `--wb-panel-max 1100px`.
  - `WB.css:520-530`: `.main` padding-bottom equals bar height plus 60px, and toasts and the chat button are lifted above the bar.
  - `WB.css:614-631`: the panel is full width from the rail, with `max-height:min(78vh,720px)`, a solid `var(--surface)` background and the `wb-rise` animation.
  - `WB.css:608-613` is the scrim. `WB.css:770-847` is the phone sheet at **≤760px** (the owner now says 640).
  - `WB.css:849` hides the Desk in print.
- **Stack protocol.** `WB_LAYERS` (`WB_logic.js:711-723`):
  - menus and pickers 3000, tour 2900, modal 2000, `[aria-modal]:not(.wb-panel)` 1900
  - task drawer `.tk-dw-layer` 1850, client drawer 1840, chat 1835
  - the Desk panel 1820

### Opening tasks

- **`TK_openTask`** (`TK_Drawer.jsx:452-471`) dispatches `tk:open-task`. `TK_DrawerHost` (`:479-573`) renders `TK_Drawer` and tracks `tasks-drawer` (`:510`).
- **Every Desk path ends in `TK_openTask`:**
  - `WB_hubOpen` (`WB_store.js:754-777`, from "wb-hub")
  - `WB_HubTasks.jsx:180-185` and `WB_HubClient.jsx:267-274` (`TK_vOpenTask`, from "wb-hub")
  - task title links (`TK_openTaskClick`, from "link")
  - subtasks inside the drawer (`TK_Drawer.jsx:1074`, from "subtask")
  - `TK_vOpenTask` (`TK_TaskRow.jsx:138`) wraps `TK_openTask`.
- **`TK_Drawer` is one function** starting at `TK_Drawer.jsx:1313`. Its parts:
  - **Focus and scroll lock** (`:1451-1465`): it focuses the panel on mount, adds `body.tk-drawer-open` (an `overflow:hidden` scroll lock, `tk-drawer.css:1105`) and gives focus back on unmount.
  - **Esc and Tab trap** (`:1628-1671`): Esc closes the SOP panel first, then calls `onClose`.
  - **Keys** (`:1689-1715`): x, s, a and ? through `TK_shouldHandleKey(…,"drawer")`. That check also accepts `target===body` (`TK_logic.js:1076-1094`).
  - **Body:** built as the `body` variable (`:1718-2275`).
  - **Chrome** (`:2277-2406`), in this order: layer, scrim, `aside.tk-dw[role=dialog][aria-modal]`, header, body, followers, SOP panel, and modals.
  - **P4-4 also edits this file** (the snooze menu, `docs/tasks-phase4-spec.md`).

### Things that rely on `aria-modal`

- **Tips are suppressed** by `TIPS_BUSY` (`Tips.jsx:141-142`), whose selector includes `[aria-modal='true']`. This is the only thing hiding tips while the Desk is open.
- **Quick add `q`** is blocked while any `[aria-modal='true']` is present (`TK_QuickAdd.jsx:546-547`).
- **`TK_vKeyCtx.modalOpen`** (`TK_keys.jsx:65-67`) pauses the page's list keys.

### Gating

- **Desk mount:** `app.jsx:30116-30127` mounts the Desk only when `showStaffRail && !tkShell && !isPreviewingUser && !impersonating && staffUser.email`. This does not depend on aria-modal.
- **Today:** `Today.jsx:1092` `wbOn` renders `WB_Page` at `:1578`. `WB_Page.jsx:66-72` titles that card `{WB_NAME}`.
- **Nav:** `StaffNav.jsx:18-41` renames the Today nav item to `WB_NAME` when the Workbench is on.

### Staff guide sync

`docs/staff-guide/sync.mjs` does a **full** sync: it upserts every article and DELETES every slug that has no file. It must not be used for this work (§8).

---

## 2. Names: constants

- **`WB_logic.js:8-12`:**
  ```js
  var WORKBENCH_NAME = "Desk";       // the bottom dock's display name, the one place it lives
  var WB_NAME = WORKBENCH_NAME;      // alias, so the ~40 existing references keep working
  ```
  Export both. Update the test so it asserts `WORKBENCH_NAME === "Desk"` and `WB_NAME === WORKBENCH_NAME`.
- **`components/tasks/TK_logic.js`**, near `TK_COPY` (line 28):
  ```js
  var SLATE_NAME = "Slate";          // the task module's display name
  ```
  - TK_logic.js loads before WB_* and app.jsx in `__SOURCE_ORDER`, so every consumer can read it.
  - Code outside TK_ reads it as `typeof SLATE_NAME !== "undefined" ? SLATE_NAME : "Slate"`.
  - `TK_COPY.setupTitle` and `TK_COPY.setupBody` are built from it.
- **For NeverSlate,** no Desk or Slate component may hard-code "MyGoodBooks", "MGB" or a firm color. Brand stays in tokens (§5) and in the two constants.

## 3. Rename inventory

The rule: **copy changes; identifiers never change.**

### 3.1 Workbench → Desk (via WORKBENCH_NAME unless noted)

| Where | Now | Becomes |
|---|---|---|
| Bar `WB_Drawer.jsx:122-150` | "Workbench", "Open/Close Workbench" | "Desk", "Open/Close Desk" (already uses `{WB_NAME}`) |
| Hub head `WB_Hub.jsx:253-262` | `{WB_NAME}`, "Full page" | "Desk"; "Full page" becomes **"Open Today"** |
| Hub tabs `WB_logic.js:316` | "My tasks" | **SLATE_NAME** ("Slate") |
| Hub tabs aria `WB_Hub.jsx:165-197` | "Workbench sections" | "Desk sections" (via constant) |
| Quick add in the hub foot `WB_Hub.jsx:350-354`, `WB_HubTasks.jsx:333` | "+ Add task" | **"Add to your " + SLATE_NAME**. The input placeholder is the same. |
| Foot hint `WB_Hub.jsx:350` | "W opens and closes · Esc closes one layer at a time" | "W opens and closes · Esc goes back one step · drag the top edge to resize" |
| Shortcut sheet `WB_Row.jsx:464-478` | "Open or close the Workbench drawer", "(Inbox, My tasks, Client)", "Workbench shortcuts" | "Open or close the Desk", "(Inbox, Slate, Client)", "Desk shortcuts" |
| Today card `WB_Page.jsx:66-72` | title `{WB_NAME}`, "…Press W for the drawer on any page." | title **"Needs you"** (a literal, not the constant); "…Press W for your Desk on any page." |
| `WB_Page.jsx:116,177` | "Couldn't refresh Workbench", "Workbench help" | "Couldn't refresh this list", "Today help" |
| `Today.jsx:1574` | "Switch back to the Workbench" | "Switch back to the new Today" |
| StaffNav `StaffNav.jsx:18-41` | Today label becomes WB_NAME when on | **Always "Today"**. The help slug stays `workbench` when on (it is a slug). |
| StaffInbox `:1795` | "…off Workbench without replying" | "…off your Desk without replying" (via constant) |
| Tips `Tips.jsx:204-211` (`wb-more`), `:290-296` (`wb-noreply`) | "drawer", "My tasks tab", "off your Workbench" | "Desk", "Slate tab", "off your Desk" |
| Announcement `announcements.js:148-213` | historical `workbench-launch` | **Unchanged** (dated history), except step `ann-bar` (`:205-207`), which targets the live bar: "The Desk, on every page… tabs for your Inbox, Slate and one Client…" |
| Dev Tools flags `app.jsx:988-998` | "Workbench preview", "Classic Today" | "Desk preview". "Classic Today" is unchanged. The keys stay. |
| Dev Tools `app.jsx:15329-15331` | "Workbench on for staff", "Workbench Ledger flags due…", "Workbench new files from" | "Desk and new Today on for staff", "Desk Ledger flags due…", "Desk new files from" |
| INFRA `app.jsx:1078` | "Supabase SQL (Workbench)" | **Unchanged** (it names the migration) |
| Usage Stats `app.jsx:17135-17142` | "Workbench drawer opened", "Workbench hub: My tasks and Client tabs…" | "Desk opened", "Desk: Slate and Client tabs opened, clients picked". Add new labels (§9). |
| `app.jsx:26586` | "the Workbench list when it's on" | "the Needs you list when it's on" |
| Guide `docs/staff-guide/workbench.md` | title "How do I use the Workbench?" | **"How do I use the Desk?"**. The body is rewritten (§8). |

### 3.2 Tasks → Slate (the module or place name only)

This comes from the inventory sweep. **"Task" or "tasks" stays when it means an item** ("Add task" in lists, "3 tasks", "Tasks due today", "Tasks and deadlines" on Performance, email preferences "Tasks assigned to me").

| Group | Strings that change (examples, full list in the sweep) |
|---|---|
| Module shell | `TK_App.jsx:107,116,140,186,198`: "Go to My Tasks", h1 "Tasks", "Open Tasks in its own window", nav aria "Tasks", "My Tasks". `TK_StandaloneBar.jsx:262,272`: "Tasks home", wordmark "Tasks". |
| View titles | `TK_Sidebar.jsx:302`, `TK_MyTasks.jsx:160,468,469`, `TK_List.jsx:974`, `TK_ClientDrawer.jsx:599,625`: "My Tasks" becomes **"My Slate"**. `TK_ClientDrawer.jsx:243,246` "Tasks for X" / "Tasks" stay (items). |
| Setup and errors | `TK_logic.js:28-29`, `TK_api.js:364,854`, `TK_TaskRow.jsx:1338,1342`, `WB_HubTasks.jsx:36,48,328,336`, `WB_HubClient.jsx:33,53`, `WB_Hub.jsx:318`, `WB_Page.jsx:139,157`, `app.jsx:30458`: "Tasks is being set up", "Work › Tasks", "My Tasks" become "Slate is being set up", "Work › Slate", "My Slate". |
| Places | `StaffNav.jsx:58,63` Work hint and tab label "Tasks" become "Slate". `TopBar.jsx:382-383,409,416,1000,1046`: "Tasks › Recurring" becomes "Slate › Recurring". `TopBar.jsx:1141,1160`: top-bar pill "Tasks" becomes "Slate". `TopBar.jsx:628`: search group "Tasks" **stays** (items). `Today.jsx:945,1413`, `Deadlines.jsx:238`, `TaskTemplates.jsx:144`, `Settings.jsx:96,989,1296`, `WorkPage.jsx:99`, `app.jsx:7466-7470` (stays: items), `:19735,20491,21947`, `TK_Drawer.jsx:2360`, `TK_keys.jsx:176,211`, `TK_Templates.jsx:576`, `TK_api.js:1229`, `TK_viewLogic.js:767,769`. |
| PAGE_META | `app.jsx:26594` (Work subtitle), `:26597` title "Tasks" becomes "Slate" (document title "Slate · MyGoodBooks"), `:26598` subtitle, `:26640-26641`. |
| Tours | `Tour.jsx:1045,1143,1155,1169,1339,1341,1387,1416,1424,1431,1435,1490-1491`: "The Tasks tour" becomes "The Slate tour", and so on. |
| Tips | `Tips.jsx:210,514,599` (and `:391` where it names the place). |
| Usage Stats | `app.jsx:17070` tab label "Tasks" becomes "Slate". `:17086` "My tasks" becomes "My Slate". The action labels that name the place: "Tasks opened in its own window" becomes "Slate opened in its own window", plus "Slate docked back in the portal" and "Slate window set to follow your client". Item labels stay. |
| Dev Tools | `app.jsx:15312,15123,15314`: "Tasks switches" becomes "Slate switches". The INFRA names `:1058-1093` **stay** (they name migrations). |
| Guide titles | `tasks-own-window` "Can I keep Tasks in its own window?" becomes "Can I keep Slate in its own window?". `my-tasks` "How do I add and manage my tasks?" becomes "How do I use my Slate?". The other titles name items and stay. Bodies across about 30 articles change "Work › Tasks", "My Tasks" and "Tasks › X" (counts in the sweep: whats-new 34, tips 23, my-tasks 15…). |
| Announcements | Historical entries (`announcements.js:48-681`) **stay as written**. Only the new Desk entry uses the new names. |
| README | Prose that names the module (§10). The code-identifier sections stay. |

### 3.3 Must NOT change

- **Routes:** `#/tasks*`, `#/work/tasks`, `/tasks` → `?shell=tasks` (vercel.json), `#/today`.
- **Page and nav keys:** `tasks`, `today`, the Settings start-page value `tasks`, the `TB_HELP_FOR_PAGE` and `TB_TASKS_HELP` keys.
- **Storage:** `mgb_wb_*` (including `mgb_wb_hub:<email>`, `mgb_wb_pins`, `mgb_wb_preview`, `mgb_wb_classic`), `mgb_tk_*`, `mgb_shell_v1`.
- **Database:** every `tk_*` and `wb_*` table, RPC and tk_settings key (`wb_enabled`…). The email preference keys.
- **Tracked events:** `tasks-*` and `wb-*`.
- **Code names:** CSS classes `wb-*`, `tk-*`; `data-tour` ids; tour and tip ids; component and file names (`WB_*`, `TK_*`, `WB_HubTasks`).
- **Guide slugs** (`workbench`, `my-tasks`, `tasks-own-window`…). Renaming a file deletes its database row.
- The PWA name "MyGoodBooks".

## 4. Component and state changes

### 4.1 Mode

A new pure helper, `WB_deskMode(width)`, returns `"sheet"` at width ≤ 640 and `"dock"` above that.

- `WB_store` keeps `mode` up to date from a `matchMedia("(max-width: 640px)")` listener.
- **Sheet** keeps today's phone behavior: full height, no handle, `aria-modal="true"` and the Tab trap. Because it covers the page, nothing behind it is reachable, and `html.wb-hub-open body{overflow:hidden}` applies at ≤640.
- **Dock** is the new non-modal panel.
- **Breakpoints:** move the sheet CSS from `@media (max-width:760px)` to 640. The 44px tap targets stay at ≤760, so tablets get the dock with large targets.

### 4.2 Non-modal dock (D3)

**`WB_Hub.jsx`**
- Delete the `.wb-scrim` element and its CSS (`WB.css:608-613`, and `html.wb-stacked .wb-scrim`). `--wb-z-scrim` is retired.
- In dock mode the panel becomes:
  ```
  <section id="wb-panel" className="wb-panel wb-glass" role="region"
           aria-labelledby="wb-panel-title" tabIndex={-1} data-tk-keyscope="drawer">
  ```
  - There is no `aria-modal`.
  - It keeps `data-tk-keyscope="drawer"`, so page list keys stand down while focus is inside the Desk.
- In sheet mode it stays `role="dialog" aria-modal="true"`.
- **`WB_useHubKeys`:**
  - The Tab trap runs only in sheet mode.
  - **Esc is handled only when `panel.contains(e.target)`**, in this order:
    1. any `WB_layerAbove` layer (menus, tour, modals) keeps it
    2. the client picker list is open, so close the picker
    3. a field still has text (`WB_escKeepsField`), so the browser clears it
    4. inside the drill-in, the content's own layer (the SOP panel) closes
    5. the drill-in pops one level
    6. the panel closes
  - The rule is pure: `WB_deskEscStep({layerAbove, pickerOpen, fieldKeeps, drillInner, drillDepth})` returns `"layer" | "picker" | "field" | "inner" | "back" | "close"`.
- **W** still toggles from anywhere when the person is not typing (`WB_keyBlocked`).

**Focus**

- **Open by the bar, W, or dragging up on the bar:** focus goes to `WB_hubFocusTarget` (the last row, else the first row, else the active tab).
- **Restored open on page load (the 5-minute reopen):** focus is **not** moved. The store sets `openedBy: "restore"`, and `WB_Drawer.jsx:94-106` checks it.
- **Close:** if focus was inside the Desk, it goes to the bar. Otherwise it stays where it is. For example, W pressed while working on the page leaves focus there.
- **Tab order:**
  - The DOM order stays bar, then panel. The panel is portaled after `.main`, as today.
  - Tab moves from the end of the page to the bar, then into the panel: the resize separator, head buttons, tabs, pane rows, quick add.
  - Tab then leaves to the browser chrome. Shift+Tab walks back the same way.
- **The focus-return MutationObserver** in `WB_useHubLayers` returns focus only if focus was inside the Desk before the layer opened. Otherwise the page keeps it.

**Page behind**

- It stays interactive. There is no scroll lock.
- `html.wb-hub-open .main` gets `padding-bottom: calc(var(--desk-h) + var(--wb-bar-h) + 8px + env(safe-area-inset-bottom))`. In dock mode the toast and chat-button lift uses the same calc.
- `--desk-h` is written on `<html>` by `WB_Drawer` only.
- The pane gets `overscroll-behavior: contain`, so wheel scrolling inside the Desk never scrolls the page.

**Rules that lived on aria-modal, now replaced**

- **Tips:** add `.wb-panel` to `TIPS_BUSY` (`Tips.jsx:141`). Tips stay off while the Desk is open in both modes. This replaces the aria-modal side effect.
- **Quick add `q`:** it now works while the dock is open with focus on the page, and it opens its own modal above. This is accepted, and the guide says so.
- **Page list keys** (j/k…) work while the dock is open with focus on the page. They stay off with focus inside the Desk (keyscope). This is the intended non-modal behavior.
- **The never-mounts rule:** move the condition at `app.jsx:30116-30127` into a pure `WB_deskMounts({showStaffRail, tkShell, previewing, impersonating, email})` that is node-tested. The meaning is unchanged: View as, preview and impersonation never mount the Desk, because it would show the admin's own items. "View as: whole app" (planned) can later flip it in one place.
- **`WB_LAYERS`:** the `[aria-modal]:not(.wb-panel)` entry stays. Stand-alone dialogs still stack above the dock.

### 4.3 Resize (D3)

**Pure helpers in `WB_logic.js`** (node-tested; px values; `vh` is the inner height minus the top bar):
```js
WB_DESK_KEY = "mgb_wb_desk";              // sibling key: mgb_wb_desk:<email>; no TTL (height is a preference)
WB_DESK_STRIP = 148;                      // head 44 + tabs 40 + one row 56 + 8
WB_deskPoints(vh)   -> { strip: 148, medium: round(0.45*vh), tall: min(round(0.78*vh), vh - 16) }
                       // if medium - strip < 80, medium = strip + 80; if tall <= medium + 40, tall = medium (merged)
WB_deskClamp(h, vh) -> clamp(h, WB_DESK_STRIP, vh - 16)
WB_deskSnap(h, vy, points) -> "strip"|"medium"|"tall"
                       // nearest point; a fling |vy| > 0.6 px/ms moves to the next point in that direction
WB_deskStep(snap, key, points) -> snap  // ArrowUp/PageUp up one, ArrowDown/PageDown down one, Home strip, End tall
WB_deskParse(raw) -> { v:1, snap }      // a bad value falls back to "medium"
WB_deskSerialize(st) -> '{"v":1,"snap":"medium"}'
WB_deskKey(email)
```
- **Only the snap name is stored**, never px. Every viewport recomputes its own heights, so a resize or a move to a different monitor re-clamps by itself.
- **Defaults:** `medium`, with no key read in the sheet.
- **Why a sibling key** rather than a field in `mgb_wb_hub`: the hub blob carries the 5-minute reopen rule and is rewritten every 500 ms. Height is a lasting preference, so mixing them would lose it, or keep stale state.

**Store** (`WB_store.js`): add `desk: {snap}`, `setDeskSnap(snap)` (saved at once, with no throttle) and `adoptHub(email)`, which reads the desk key too.

**Handle** (`WB_Hub.jsx`, the first child of the panel, dock mode only):
```
<div className="wb-desk-handle" role="separator" aria-orientation="horizontal"
     aria-controls="wb-panel" aria-label={"Resize " + WORKBENCH_NAME}
     aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}
     aria-valuetext={"Medium, about half the window"} tabIndex={0}>
```
- `pct = round(100 * h / vh)`.
- Keys go through `WB_deskStep`. Enter is not used.

**Drag**

- **Pointer Events only**, so mouse, touch and pen share one path.
- `pointerdown` on a primary button:
  - calls `setPointerCapture(e.pointerId)`
  - adds `html.wb-desk-dragging`, which turns off transitions, sets `user-select:none` and `cursor: ns-resize`
  - records the start y and height
- `pointermove` writes `--desk-h` straight onto `<html>` in a rAF. React does not re-render during the drag.
- `pointerup` snaps (`WB_deskSnap` with the velocity of the last 80 ms), commits, and releases capture.
- `pointercancel` or `lostpointercapture` also commits a snap.
- **Esc during a drag** puts back the start height.
- The handle CSS has `touch-action:none`, and the hit area is a 12px strip with a visible 36×4 grip.

**Collapsed bar**

- There is no handle on the bar.
- A vertical pointer drag up on the bar of more than 12px opens the Desk and continues as a drag. The release snaps.
- A click still toggles. A drag never fires the click: suppress it when the movement exceeds 6px.

**Window resize**

- A `resize` listener (rAF-throttled) recomputes the points and rewrites `--desk-h`. The snap name stays the same.
- On a window under about 360px tall, all three points merge and the handle hides.

**Reduced motion**

- No `wb-rise` animation and no height transition. A snap jumps.
- This extends the existing `prefers-reduced-motion` block at `WB.css:650`.

**Safe areas**

- The panel bottom is `calc(var(--wb-bar-h) + env(safe-area-inset-bottom))`, as today.
- `tall` also subtracts `env(safe-area-inset-top)`. A CSS `max-height: calc(100dvh - var(--topbar-h) - 16px - env(safe-area-inset-top))` backs up the JS.

### 4.4 Width (dock)

- The panel and the bar share one width: `width: min(var(--desk-max-w), calc(100vw - var(--wb-bar-left) - 32px))`. Both are centered in the space to the right of the rail.
- The default is `--desk-max-w: 640px`. This follows the reference mockup and the drawer-width layout that the drill-in content was built for.
- This conflicts with the earlier "across the whole bottom" decision (Q1). To go back, set the token to `100vw` in one line.

### 4.5 Drill-in (D4)

**Split `TK_Drawer.jsx` (with no behavior change):**
- `TK_DrawerContent(props)`: everything that is inside `<aside>` today, which is the header, body, followers, SOP panel and modals, plus the data hooks and the x/s/a/? keys. Props are the current `TK_Drawer` props plus:
  - `mode`: `"drawer" | "embedded"`
  - `scopeRef`: the element that keys must come from
  - `onBack`: embedded only
  - `onOpenTask(id, opts)`: the subtask and parent link override
  - `registerEsc(fn)`: content gives the Desk a function that returns true when it used Esc (closing the SOP panel)
- `TK_Drawer(props)`, the chrome: the layer, scrim, `aside[role=dialog][aria-modal]`, the focus, scroll-lock and restore effect (`:1451-1465`), and the Esc and Tab trap (`:1628-1671`, with the SOP-first rule asked through `registerEsc`). It renders `<TK_DrawerContent mode="drawer">`.
- **This must ship as its own commit** ("TK_Drawer split, no behavior change") and be diffed against the stand-alone drawer checklist (§7.2). **Coordinate with P4-4**: the split lands first and P4-4 rebases onto it, or the split waits for P4-4 to merge. Either way, the two must not be built in parallel.

**What embedded mode does differently:**
- no portal, no scrim, no `aria-modal`, no Tab trap
- no `body.tk-drawer-open` (no scroll lock)
- no `tasks-drawer` track; track `wb-drill` instead
- keys need `scopeRef.current.contains(e.target)`, and are **never** taken from `body`
- keys stand down while `WB_layerAbove(scopeRef.current)` is true, for example a stand-alone drawer opened above it
- subtask and parent clicks call `onOpenTask`, which pushes onto the drill stack
- the header shows **Back** (`aria-label="Back to " + tabLabel`) on the left, and a new **"Open on its own"** item in the More menu calls `TK_openTask(id,{from:"desk-pop"})`

**The router** (`TK_openTask`, `TK_Drawer.jsx:452`):
- Its first line becomes `if (window.TK_openTaskRoute && window.TK_openTaskRoute(id, opts)) return;`.
- `WB_Drawer` registers `TK_openTaskRoute` while it is mounted and removes it on unmount. Its decision is a pure helper:
  ```js
  WB_deskOwnsOpen({ open, from, inputInDeskAt, now }) ->
    open && from !== "desk-pop" && (from === "wb-hub" || from === "subtask-desk" || now - inputInDeskAt < 1000)
  ```
- `inputInDeskAt` is stamped by capture-phase `pointerdown` and `keydown` listeners on the panel. This covers title links (from "link") that render inside Desk rows, and Safari, which does not focus a button on click.
- It applies in **both** modes. On a phone the sheet drills in too, so nothing stacks.

**Hub state** (in the store, not persisted, and `WB_hubSerialize` is unchanged):
- `drill: [{taskId, focus}]`, capped at 5.
- `openDrill(id, opts)` pushes. If the top entry already has that id, it only refocuses.
- `back()` pops.
- Switching tabs or closing the Desk clears it.
- A hashchange already closes the Desk.

**Rendering in `WB_Hub`**
- When `drill.length`, panes stay mounted but `hidden`, so their scroll is kept.
- `<div className="wb-drill">` renders `<TK_DrawerContent mode="embedded" key={top.taskId} …/>`.
- The tabs stay visible. Clicking any tab leaves the drill-in.
- The head title becomes "Task". The Back arrow sits in the head and in the content header, and both call `back()`.

**Focus in the drill-in**
- On drill open, focus goes to the content's title field, or to `focus` if one was given.
- On back, it goes to the row (`lastFocus "tk:"+id`, which already exists), or to the previous drill title.

**Sizing:** if the Desk sits at `strip` when a drill-in opens, it rises to `medium` for that session only (`setDeskSnap(…, {transient:true})`), and the stored preference does not change.

**Kept:** the stand-alone `TK_DrawerHost` and `TK_Drawer` stay as they are for every open from outside the Desk.

## 5. CSS tokens (`WB.css` `:root`, dark first; dark is the product default)

```css
:root {
  --desk-max-w: 640px;
  --desk-h: 0px;                         /* written by WB_Drawer */
  --desk-radius: 16px;
  --desk-glass-blur: 22px;
  --desk-glass-sat: 1.6;
  --desk-glass-bg: rgba(255,255,255,.62);
  --desk-glass-edge: rgba(255,255,255,.70);
  --desk-glass-shadow: 0 -10px 36px rgba(15,23,42,.16), inset 0 1px 0 rgba(255,255,255,.55);
  --desk-row-bg: rgba(255,255,255,.80);
  --desk-row-bg-hover: rgba(255,255,255,.94);
  --desk-solid-bg: var(--surface);
  --desk-grip: rgba(15,23,42,.28);
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { /* dark set */ } }
:root[data-theme="dark"] {
  --desk-glass-bg: rgba(22,28,40,.58);
  --desk-glass-edge: rgba(255,255,255,.12);
  --desk-glass-shadow: 0 -10px 36px rgba(0,0,0,.45), inset 0 1px 0 rgba(255,255,255,.06);
  --desk-row-bg: rgba(255,255,255,.06);
  --desk-row-bg-hover: rgba(255,255,255,.10);
  --desk-grip: rgba(255,255,255,.30);
}
```
- The dark set appears twice, following the `styles.css:105-185` pattern.
- **Only `.wb-panel.wb-glass` and `.wb-bar` get glass:**
  - `background: var(--desk-glass-bg)`
  - `-webkit-backdrop-filter` and `backdrop-filter: blur(var(--desk-glass-blur)) saturate(var(--desk-glass-sat))`
  - `border: 1px solid var(--desk-glass-edge)`
  - `box-shadow: var(--desk-glass-shadow)`
  - `border-radius: var(--desk-radius) var(--desk-radius) 0 0`
- **Rows, the quick add, the drill-in content card and the picker input** sit on `var(--desk-row-bg)` with a 10px radius, which gives the lighter inner layer.
- **Menus, modals, the tour, the search palette, the stand-alone task drawer and the client picker list stay solid.** Desk menus are portaled or are `.wb-menu` and keep `var(--surface)`.
- **Fallbacks, all of which set `background: var(--desk-solid-bg)` and turn off backdrop-filter:**
  - `@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))`
  - `@media (prefers-reduced-transparency: reduce)` (support is limited, so this is progressive)
  - `@media (forced-colors: active)`
  - the phone sheet (≤640): it covers the page, so glass adds cost and no benefit
  - print stays hidden
- **Contrast:** row text must keep 4.5:1 on `--desk-row-bg` over both a white and a dark page. Check this in §7.2.

## 6. Slices, in order

| Slice | Content | Depends on | Ships alone? | Builder / reviewer |
|---|---|---|---|---|
| **D1 Rename** | constants, §3.1 and §3.2 copy, Today nav label, the Today card title, guide plus per-slug upserts, tour, tips, help, README, Dev Tools, Usage Stats | none | Yes | Sonnet builds, Opus reviews, Haiku runs the grep sweep (no "Workbench" or "My Tasks" left in UI copy) |
| **D2 Glass** | §5 tokens and CSS, row layers, fallbacks, width token | none (CSS only) | Yes, in either order with D1 | Sonnet builds, Opus reviews, Haiku runs screenshot sweeps (light, dark, Safari, no-blur) |
| **D3 Non-modal + resize** | §4.1-4.3: mode, scrim removal, Esc and focus rules, TIPS_BUSY, `WB_deskMounts`, height helpers and store, handle, drag, bar drag, padding | best after D2 (the glass shows the page behind) | Yes | Opus builds, Opus critiques and verifies |
| **D4a TK_Drawer split** | `TK_DrawerContent` plus chrome, with no behavior change | coordinated with P4-4 | Yes (invisible) | Opus |
| **D4b Drill-in** | router, drill stack, embedded mode, Back, "Open on its own" | D3 (Esc ladder), D4a | No | Opus builds, Opus critiques and verifies |

- **The recommended order is D1, then D2, then D3, then D4a, then D4b.** D1 and D2 can run in parallel.
- **Each slice gets its own MGB_VERSION bump** and its own What's new line.
- **The next-visit announcement and tour ship with D3,** once the Desk really behaves differently. D1 gets a small rename notice. D4b adds a step to the Desk tour.

## 7. Test plan

### 7.1 Node tests (`components/workbench/WB_logic.test.js`)

- **Constants:** `WORKBENCH_NAME === "Desk"` and `WB_NAME === WORKBENCH_NAME`. In the TK tests, `SLATE_NAME === "Slate"`.
- **`WB_deskMode`:** 640 returns sheet, 641 returns dock.
- **`WB_deskPoints`:**
  - vh 900 gives strip 148, medium 405, tall 702
  - vh 400 merges medium and tall
  - vh 300 merges all three
  - tall ≤ vh − 16
- **`WB_deskClamp`:** a value below strip goes up to strip; a value above vh − 16 comes down to vh − 16; NaN gives strip.
- **`WB_deskSnap`:**
  - finds the nearest point at a midpoint tie (rule: up wins)
  - a fling up from strip gives medium, not tall
  - a fling down from tall gives medium
  - a velocity of 0.59 does not count as a fling
- **`WB_deskStep`:** ArrowUp at tall stays tall; Home gives strip; End gives tall; an unknown key gives the same value; it works with merged points.
- **`WB_deskParse` and `WB_deskSerialize`:**
  - a round trip works
  - garbage, `{v:2}` and an unknown snap give `medium`
  - `WB_deskKey("A@x.com")` lowercases like `WB_hubKey`
- **`WB_deskEscStep`:** every rung of the ladder (layer > picker > field > inner > back > close), using a truth table.
- **`WB_deskOwnsOpen`:**
  - closed gives false
  - wb-hub gives true
  - desk-pop gives false
  - link with recent input gives true
  - link with stale input (more than 1 s) gives false
  - subtask-desk gives true
- **`WB_deskMounts`:** each of previewing, impersonating, tkShell and no email gives false. All clear gives true.
- **Existing:** the `WB_hub*` tests still pass, and `WB_hubSerialize` output does not change (no `drill`, no `height`).
- **TK:** `node --test components/tasks/*.test.js` still passes after D4a. If `TK_shouldHandleKey` gets an embedded flag, add a case: embedded scope with target body gives false.

### 7.2 Browser checklist for the owner (staff login, Chrome; then Safari)

**D1**
1. The nav says Today.
2. The bar says Desk.
3. The tabs read Inbox | Slate | Client.
4. The quick add reads "Add to your Slate".
5. Work › Slate, the top-bar Slate pill, and the document title "Slate · MyGoodBooks".
6. ? help on the Desk opens "How do I use the Desk?".
7. Old links `#/tasks/my` and `#/today` still work.

**D2**
1. Glass over a busy page, in light and dark.
2. Rows are readable.
3. Menus, modals, the tour and the stand-alone task drawer are solid.
4. The flag-off check: in DevTools, uncheck backdrop-filter and the panel turns solid.
5. Phone width: a solid sheet.

**D3**
1. With the Desk open, scroll and click the page behind it. It works, with no dimming.
2. The bottom of the page is reachable (padding).
3. Press W on the page: the Desk opens and focus goes inside. Press W again: it closes and focus goes to the bar.
4. With focus on the page, Esc does nothing to the Desk.
5. With focus in the Desk, Esc runs the ladder: picker, then field, then panel.
6. Tab from the page reaches the bar, then the Desk, then out.
7. Drag the top edge with a mouse, a trackpad and (on an iPad or touch laptop) touch. It snaps to strip, medium and tall.
8. Reload: the height is remembered. Sign in as another staff member: their own height.
9. The separator, focused, responds to arrows, Home and End. VoiceOver reads its value.
10. Shrink the browser window: the Desk clamps and never covers the top bar.
11. Reduced motion (OS setting): no slide or animation.
12. No tip appears while the Desk is open.
13. View as and preview: no Desk.
14. Phone width (≤640): a full sheet, no handle, with Tab kept inside.
15. Drag up on the closed bar: it opens at that size.

**D4**
1. Click a Slate or Client row: the detail opens inside the Desk, and there is no second drawer.
2. Back, and Esc, return you to the row with scroll kept.
3. Open a subtask from the detail, then Back twice.
4. "Open on its own" opens the stand-alone drawer.
5. From a page list (outside the Desk), a task still opens in the stand-alone drawer.
6. In the drill-in, x, s and a act on that task. With focus on the page, they do nothing.
7. Edit the title in the drill-in: the row updates.
8. The Delete and Send back modals sit above the Desk.
9. A phone sheet drills in too.
10. The stand-alone drawer behaves as before (focus trap, scroll lock, Esc closes the SOP panel first).

## 8. Staff guide (live) — per-slug, md5-guarded upserts ONLY

**Never run `sync.mjs` output** for this work. It deletes rows and rewrites every article.

For each changed slug, run one statement:
```sql
insert into public.staff_guide (slug,title,section,audience,body_md,keywords,sort)
values ($slug,$title,$section,$audience,$body,$kw,$sort)
on conflict (slug) do update set title=excluded.title, body_md=excluded.body_md, keywords=excluded.keywords, updated_at=now()
where md5(public.staff_guide.body_md) = $md5_of_body_before_edit;   -- guard: skip if someone changed it live
```
- Check the row count afterward. Zero means the live copy drifted. In that case stop, diff, and ask.
- **Slugs to touch:**
  - D1: `workbench`, `my-tasks`, `tasks-own-window`, `whats-new`, `tips`, `home-page`, `inbox`, `admin-guide`, `admin-insight`, `work-page`, `top-bar`, `staff-settings`, and the ~20 others listed by the sweep that say "Work › Tasks" or "My Tasks".
  - D3 and D4b: `workbench` again.
- **`workbench.md` rewrite:**
  - drop "dimmed behind it"
  - "Open a task without leaving the page" now describes the drill-in and Back
  - add "Resize the Desk"
  - add "q works while the Desk is open"
  - "Switch back to the new Today"
- **Keywords:** keep the old words (workbench, my tasks, tasks) so search still finds the articles.

## 9. Upkeep (in the same commit as each slice)

- **`MGB_VERSION`** (`index.html:205`): bump per slice (`2026-10-1Xa`…) with a one-line note.
- **What's new** (`docs/staff-guide/whats-new.md`, plus the live upsert): one line per slice.
- **Announcement:** a new entry `desk-launch` (with D3), roles admin and bookkeeper, `ready` on `WB_store.getState().on`. Its steps:
  1. "Workbench is now Desk, Tasks is now Slate"
  2. the glass Desk (target `wb-bar`)
  3. drag to resize (a new target `data-tour="wb-desk-handle"`)
  4. the page stays usable
  5. click a row to open it right here (added with D4b; target `wb-list` in the Desk)

  The `workbench-launch` entry stays as history. The `ann-bar` copy is updated (§3.1).
- **Tour:** the Slate tour copy (§3.2). "New: The Desk tour" appears in the ? menu. `TOUR_stickyBottom` (`Tour.jsx:325-343`) must measure the centered bar plus `--desk-h`.
- **Tips:**
  - `wb-more` and `wb-noreply` copy
  - the `TIPS_BUSY` `.wb-panel` entry
  - a new tip `desk-resize` ("Drag the top edge of your Desk to make it shorter or taller")
  - `Tips.jsx:778`: the fixed-bar measure follows the centered bar
  - mirror all of this in `docs/staff-guide/tips.md`
- **? help:** `TB_HELP_FOR_PAGE` needs no key changes. The Desk's own ? opens `workbench` (the slug stays). Check the labels in the help menu.
- **README:** §10.
- **Dev Tools:**
  - the flag label "Desk preview"
  - the tk_settings row labels (§3.1)
  - "Slate switches"
  - reset keys: add `mgb_wb_desk:<email>` to the reset list (`app.jsx:15270` area)
  - PAGE_META tasks becomes Slate
  - INFRA names unchanged
- **Usage Stats:**
  - relabel the `wb-drawer`, `wb-hub` and Slate tab labels
  - **new events:**
    - `wb-resize` "Desk resized (drag or keys)"
    - `wb-drill` "Task details opened inside the Desk"
    - `wb-drill-pop` "Task opened on its own from the Desk"

## 10. README changes

- **L90**, the `components/workbench/` row:
  - "the Desk (was Workbench)"
  - `WORKBENCH_NAME` with the `WB_NAME` alias
  - the sheet/dock modes
  - glass tokens
  - `mgb_wb_desk:<email>`
  - drill-in through `TK_DrawerContent` plus `TK_openTaskRoute`
- **L89 and L694-787:** "the Slate module (code name Tasks, `TK_`, routes `#/tasks`)", plus `SLATE_NAME`.
- **L1900:** replace "aria-modal hub pauses list keys" with the keyscope rule plus "q works while the dock is open".
- **L1907-1932:** a changelog entry and the upkeep rules for D1-D4.
- **New rule:** guide updates for the Desk go through per-slug md5-guarded upserts (§8), never `sync.mjs`.

## 11. Risks

1. **The TK_Drawer split collides with P4-4.** It is a 2,400-line file and two builders would conflict. Mitigation: D4a ships alone, with no behavior change, in strict order with P4-4, and the §7.2 stand-alone checks are run again.
2. **Keys leaking out of the embedded detail.** `TK_shouldHandleKey("drawer")` accepts `body`, so x/s/a could hit the drilled task while the person works on the page. Mitigation: embedded mode requires the target inside `scopeRef`, plus a test.
3. **Removing aria-modal unhides behavior** that relied on it quietly: tips, `q`, and page list keys. Mitigation: the explicit `TIPS_BUSY` entry, the documented `q` change, the keyscope, and the owner checks D3-4/5/12.
4. **Glass cost and contrast.** A 22px backdrop blur over a scrolling page can drop frames on older laptops, and translucency can fail 4.5:1 over busy content. Mitigation: a 640px width limits the blurred area, row layers are 80% opaque, there is a solid fallback, and contrast is checked on light and dark pages.
5. **Routing false positives.** The 1-second "input in Desk" window could claim a task opened from the page right after a Desk click. Mitigation: a short window, `from:"desk-pop"` as an escape hatch, and tests.
6. **The rename has a wide reach** (about 120 Slate strings and about 30 guide articles). A stray "My Tasks" or a renamed slug would break help links or delete a live guide row. Mitigation: identifiers are frozen (§3.3), a Haiku grep sweep runs before commit, and guide writes are per-slug upserts only.
7. **Width reversal** (640 centered vs. full width). This is one token, but the tour and tip measuring code must follow it.

## 12. Open questions for the owner

1. **Width:** a centered panel about 640px wide, like the mockup (the default), or full width as approved earlier?
2. **Today:** keep the ordered list on Today under the title "Needs you" (the default), or go back to Classic Today now that the Desk carries the list?
3. **"My Tasks"** becomes "My Slate" (the default), or just "Slate"?
4. **Tips while the Desk is a short strip:** keep them hidden whenever the Desk is open (the default), or allow them at strip height?
5. **Old announcements and What's new history:** leave the old "Tasks" and "Workbench" wording as written (the default), or rewrite it?
