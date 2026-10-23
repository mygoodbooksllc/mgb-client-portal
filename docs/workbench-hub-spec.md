# Workbench Hub: what is left, as Desk additions

Status: rewritten 2026-10-23 for the Sunday 2026-10-25 build. Written against origin/main `646d3ac` (MGB_VERSION 2026-10-22b).
This replaces the 2026-10-16 bottom-bar hub spec (`133979b`). That version is in git history. Its self-critique, `docs/workbench-hub-critique.md`, is kept for history.

**Short version.** Most of the old hub already exists: H0 to H4 shipped on 2026-10-16 and 2026-10-17. The Desk then moved to a right-side column that merged with the task drawer, and the Slate app took over deep task work. Do not build the bottom-bar hub. What is still missing is a few additions inside the Desk that already exists:

- three read-only sections on the Client tab
- Ask client and Message on the Client tab
- Ask client, Message and Time off in the + menu
- a Ledger chip in the Inbox

None of this needs new server code. The client-facing view stays a separate, later spec.

Related docs:

- `docs/workbench-phase3-spec.md`: the `wb_inbox` data, rows and the client-facing outline (section L)
- `docs/desk-right-spec.md`: the right column, rail, bar and drill-in (decisions 17 to 28)
- `docs/tasks-phase4-spec.md`
- `docs/slate-app-interactions-plan.md`
- The Slate app spec is `spec-desk-fullpage.md`. It sits in the folder above the repo (`Mygoodbooks-app-code/`) and is not in git.

---

## 1. What exists today

### 1.1 Desk (portal, right side, every staff page)

The Desk is gated by the per-person flag `mgb_wb_preview` and the firm switch `tk_settings.wb_enabled`. `mgb_wb_classic` opts out. Per memory, the firm switch was still off on 2026-10-21; I have not re-checked it. The Desk is never mounted under View as, a preview or impersonation (`WB_deskMounts`, `app.jsx` about line 29653).

| Piece | What it does | Where |
|---|---|---|
| Rail (closed) | A 52px column with counts for messages, reviews, files and mentions, each with a flyout. It has a **+** menu at the bottom. Messages opens the chat drawer. | `WB_Drawer.jsx` (`WB_DeskRail`, `WB_RAIL_ITEMS` line 244) |
| + menu | **New task** is always there. **New note**, **Request document** and **Message** show only on a client page. This is the same component as the top-bar +. | `TopBar.jsx` `TB_QuickAdd` (line 1277), with `StaffQuickActions` in `app.jsx` 8742 |
| Bottom info bar | Late count, today count, next up, a line for the page's client, and the "D to open" hint | `WB_Drawer.jsx` |
| Open column | About 380px wide, resizable, and it pushes the page at 1100px and up. Phones get a full sheet. D toggles it. | `WB_Drawer.jsx`, `WB_Hub.jsx` |
| Inbox tab | The `wb_inbox` list (see the next table). Mine / Everyone for real admins. Chips: All, Tasks, Reviews, Messages, Files. | `WB_Hub.jsx`, `WB_logic.js` (`WB_DRAWER_TABS` line 34) |
| Slate tab | My tasks (old H2), view chips, Group by and Sort, "+ Add task", and Open in own window or Open Slate app | `WB_HubTasks.jsx` |
| Client tab | Picker (pins, then recents, then type to find), pin star, + Task, Open client, the client's tasks with an add row, and contacts (old H4) | `WB_HubClient.jsx`, plus `TK_ClientTasksBody` in `TK_ClientDrawer.jsx` |
| Task view | A task opens inside the Desk, with Back, an Esc ladder and F6 (Desk R2) | `WB_Hub.jsx`, `TK_DrawerContent.jsx` |
| Reply and files | Reply opens the chat drawer in place (`mgb:open-chat`). Open file opens Drive. (old H3) | `WB_store.js` 810, `app.jsx` 29101 |
| Today page | One "Do next" card. The lists live in the Desk and in Slate. | `WB_Page.jsx` |

What the Inbox lists today (`supabase/workbench-1-core.sql`, `wb_inbox`). Its sources are `task`, `review`, `message`, `gl` and `doc`.

| Row kind | Meaning |
|---|---|
| `task`, `task_sent_back`, `task_review` | Tasks and reviews |
| `client_answered`, `doc_request` | Ask client answers and document requests |
| `message` | Client messages: the client wrote last, not internal |
| `gl_flags`, `gl_approve`, `gl_sent_back`, `gl_answer` | Ledger (GL Review) flags and review states |
| `doc_upload` | New client files |

Today's other rows (deadlines, bills and the rest) also come in, as Other.

### 1.2 Slate app (its own window, deep task work)

The Slate app is gated by `mgb_slate_app_preview` and the firm switch `tk_settings.slate_app_enabled`, which is off. `mgb_slate_classic` opts out. Launch prep is in (`cf561a8`, `646d3ac`): the notice, tour and guide SQL are held until the owner flips the switch.

| Piece | Where |
|---|---|
| `/slate` shell, install, and the `mgb-slate` channel to the portal (chat and client links forward to a portal window) | `TK_SlateBridge.jsx` |
| Size modes (sliver, compact, regular, full) and a detail pane in full mode | `TK_SlateModes.jsx`, `TK_App.jsx` |
| Sliver: the current task with Start, Done, Undo and Expand | `TK_SlateSliver.jsx` |
| Board view (P1) | `TK_Board.jsx` |
| Drag reorder (P2) | `TK_Drag.jsx`, `tk_reorder` |
| Named saved views, and bulk Status, Priority and Section (P3) | `TK_SavedViews.jsx`, `TK_BulkBar.jsx` |
| My Tasks groups (Overdue, Today, This week), Review, Waiting, projects, sections, templates, quick add | `TK_MyTasks.jsx`, `TK_List.jsx`, `TK_Templates.jsx`, `TK_QuickAdd.jsx` |
| **In progress now (another agent):** undo, duplicate, copy and paste, moving between sections, multi-select, right-click menu, swipe back | `docs/slate-app-interactions-plan.md` |

**Split rule** (from the Slate app spec, section 1). The portal acts on existing work, one item at a time. The Slate app is where you shape work. The Slate app has no Inbox, by design.

### 1.3 Task drawer and the client drawer

- The task detail is `TK_DrawerContent` (labeled grid, subtasks, comments, files, review gate). It has the **Ask client** section (`TK_dwRequests` in `TK_AskClientModal.jsx`), which works for client tasks only.
- Outside the Desk the task opens in `TK_Drawer`. Inside the Desk it opens in place.
- The `t` key opens the client tasks drawer (`TK_ClientDrawer.jsx`). Its body is shared with the Desk Client tab.

---

## 2. Gap analysis against the original hub goals

| Goal (2026-10-16) | State | Evidence |
|---|---|---|
| Inbox without leaving the page | **Covered** | Desk Inbox tab, and Reply opens the chat drawer in place (`4b439c4`) |
| My tasks without leaving the page | **Covered** | Desk Slate tab (`7ffbdc7`, later `8a43b6e`) |
| Tasks open in place | **Covered** | Desk R2 drill-in (`ba929cd`) |
| Private tasks hidden on Waiting on client (old H0) | **Covered** | `5fba50c`. Not re-checked against the live function. |
| **Client pane without leaving the page** | **Partly** | The Client tab has tasks, contacts, pins, + Task and Open client. **Missing:** Waiting on client, last messages and last files, which the old section 3.3 listed. `WB_HubClient.jsx` reads only `TK_api.listScope`. |
| **Quick action: + Task** | **Covered** | The rail + menu (New task everywhere), the Client tab + Task, and the Slate tab + Add task |
| **Quick action: Ask client** | **Partly** | Ask client works only from inside a client task (`TK_dwRequests`). There is no task-less Ask client in the Desk or the + menu. The + menu's **Request document** is the older document request (`staffToolsApi.addDocRequest`), not Ask client. `tk_ask_client` takes a null task (`supabase/tasks-p2-5-requests.sql` 704; `TK_api.askClient` sends `taskId \|\| null`). |
| **Quick action: Message** | **Partly** | The rail Messages count opens the chat drawer's list. The + menu has Message only on that client's own page. The Client tab has no Message button. |
| **Quick action: Time off** | **Missing** | `CV_MyTimeOffBody` is mounted only on Team › People (`TeamPage.jsx` 774). |
| **Inbox source: client messages** | **Covered** | The `message` kind in `wb_inbox`, the Messages chip and the rail count |
| **Inbox source: ledger and GL review flags** | **Partly** | The `gl_*` rows show under **All** in the Desk, but the Desk has no **Ledger** chip. `WB_DRAWER_TABS` lacks `gl`, although the Today chips (`WB_CHIPS`) have it. There is no rail count, by decision 28. |
| **Inbox source: document uploads** | **Covered** | The `doc_upload` kind, the Files chip and the rail count, with Mark checked |
| Search: ⌘K "Open in Workbench" (old H6) | **Missing, and cut** | See section 5 |
| **Client-facing view** | **Partly** | Clients have **What we need from you** (`components/client/ClientNeeds.jsx`) and the Preliminary reports card (`CN_ReportStateCard`). A grep found no client-facing close progress and no "recently finished" feed. `CloseChecklistCard` and `CloseProgressList` (`app.jsx` 6856, 7096) are staff only. |

---

## 3. Recommendation and build plan

**Drop the bottom-bar hub.** Build only the gaps marked Partly or Missing above, as additions to the Desk. No new surface:

- The Client tab gains sections and two buttons.
- The existing + menu gains three items.
- The Inbox gains one chip.

The Slate app is not touched, so this plan does not collide with the interactions build.

**Size and models.** Medium. The changes are a few files inside an existing surface, with no server code, but Ask client can email a client and the new reads show client data.

- Sonnet builds the UI slices.
- Opus builds S2, the data reads.
- Opus reviews every slice, at high effort for S2 to S4.
- Haiku runs the greps and screenshot sweeps at low effort.
- Opus does one final verify.

Rough cost: 8 to 12% of a week.

### 3.1 Gating (preview flag and firm switch)

- **No new flag.** Everything lives inside the Desk, so it rides the Desk's existing gate:
  - `mgb_wb_preview` per person
  - `tk_settings.wb_enabled` for the firm
  - `mgb_wb_classic` to opt out
- Code never writes `wb_enabled`. It stays off until the owner flips it.
- **`TB_QuickAdd` is shared with the top-bar +, which is live today.** The three new menu items render only when the Desk is on (`deskOn` / `WB_useSwitch()`). With the Desk off, the + menu must stay byte-for-byte the same as today.
- **Leak check (part of S5):** grep for the new items and confirm each sits behind the Desk check. Then screenshot the top-bar + with the Desk off, both on a client page and off one.

### 3.2 Slices (in order)

| Order | Slice | Size | Build | Review | Files |
|---|---|---|---|---|---|
| S0 | Pre-flight checks (read-only) | XS | Haiku, low | none | none |
| S1 | Ledger chip in the Desk Inbox | XS | Sonnet, low | Opus, medium | `WB_logic.js` + test, docs |
| S2 | Client tab: Waiting on client, last messages, last files | M | Opus, high | Opus, high | `WB_HubClient.jsx`, `WB.css`, docs |
| S3 | Client tab buttons: Ask client, Message | S | Sonnet, medium | Opus, high | `WB_HubClient.jsx`, docs |
| S4 | + menu: Ask client…, Message…, Time off | M | Sonnet, medium | Opus, high | `TopBar.jsx` (`TB_QuickAdd` only), a small new `WB_QuickActions.jsx`, `index.html` source order, docs |
| S5 | Launch hook, sweep, final verify | S | Sonnet, low for the edits; Opus, high for the verify | n/a | `announcements.js` (Desk step only), `Tour.jsx`, docs |

Every slice:

- ships from its own worktree off the latest origin/main, rebases, then pushes (mgb-ship-from-worktree)
- carries its own upkeep in the same commit
- does not edit `TK_*` files, because the interactions build is editing them now. It may read them only.

**S0. Pre-flight checks (no code).**

1. Confirm the interactions build has landed, or list the files it touches.
2. Read the live bodies of `tk_ask_client` and `tk_waiting_on_client`, read-only, and confirm:
   - a null `p_task_id` is accepted
   - the H0 private filter is live
3. Confirm these columns exist live:
   - `client_messages(id, client_id, participant_email, author_kind, author_name, body, created_at, internal, deleted_at)`
   - `client_files(id, client_id, name, mime, uploaded_at, uploaded_by, drive_file_id, trashed_at)`
4. Confirm `wb_enabled` and `slate_app_enabled` are still off.

Report the results. Change nothing.

**S1. Ledger chip.**

- Add `{ id: "gl", label: "Ledger" }` to `WB_DRAWER_TABS` between Messages and Files.
- Saved hub state with an unknown chip still falls back to All (existing check, `WB_logic.js` 383).
- Test: the chip filters to `gl_*` rows only, All is unchanged, and an old saved chip still loads.

**S2. Client tab sections.** These go below the tasks, in this order:

1. **Waiting on client**
   - Read: `TK_api.waitingOnClient(clientId)` (`tk_waiting_on_client`, definer, `is_active_staff` + `can_access_client`, private-safe since H0).
   - Show the open requests: title, asked date, nudge state.
   - A row with a task opens the task in the Desk. A row with no task opens the client's Requests page.
2. **Last messages**
   - Read: `client_messages` where `client_id = ?`, `internal = false` and `deleted_at is null`, ordered by `created_at desc`, limit 5.
   - The body is trimmed to 140 characters.
   - A click opens the chat drawer on that person (`mgb:open-chat {clientId, email}`).
3. **Last files**
   - Read: `client_files` where `client_id = ?` and `trashed_at is null`, ordered by `uploaded_at desc`, limit 5.
   - A click opens Drive through `DRV_link` (access is checked on the server).

Rules for all three sections:

- **Access.** Reads run under the user's own login (RLS: staff plus `can_access_client`, plus the internal-company lock). The picker already holds only clients this person can open. An id they can no longer open shows the existing no-access line.
- **Loading.**
  - Load only while the Client tab is showing with a client chosen.
  - Run the three reads in parallel. Each has its own error line and a Retry.
  - When the client changes, drop stale replies by sequence number.
  - The rail and the bar make no new network calls.
- **No new RPC.** Add a summary RPC only if p75 load is over 600ms on a large client, and then as a separate follow-up.
- **Tests:**
  - Role matrix: bookkeeper (assigned clients only), admin, temp admin (scoped), View as (Desk absent).
  - No internal messages appear.
  - A private task is never shown to someone who is not its owner.
  - Fast client switching never shows a stale client.
  - Exactly 3 requests per client switch.
  - `node components/workbench/WB_logic.test.js` and `WB_store.test.js`.

**S3. Client tab buttons.** Next to + Task:

- **Ask client** opens `TK_AskClientModal({ clientId, clientName, taskId: null })` unmodified. The request shows in Waiting on client right away, because the `mgb:tk-requests-changed` event fires.
- **Message** sends `mgb:open-chat {clientId}`, which opens the chat drawer on that client's threads.
- Tests:
  - On a test client, Ask client sends only the `[Test]` copy.
  - On a client whose emails are not switched on, the send is a dry run (server gate).
  - Esc closes the modal before it closes the Desk.

**S4. + menu additions.** These show only while the Desk is on (3.1).

- **Ask client…**
  - Defaults to the page's client.
  - Off a client page, a small client picker comes first. Reuse the Client tab picker pool, `WB_hubPickerPool`, which already excludes the MGB internal client and test clients unless "Show test clients" is on.
  - Then it opens the S3 modal.
- **Message…** opens the chat drawer on the page's client, or on its own list when there is no client. This replaces the current client-page-only Message item, but only while the Desk is on.
- **Time off** opens a ModalShell wrapping `CV_MyTimeOffBody({ staffUser })` as-is, including "Hand my tasks to backups" (`tk_apply_ooo`).
- Keep **Request document** as it is.
- Put the picker and the time-off modal in a new `components/workbench/WB_QuickActions.jsx`, so `TopBar.jsx` gains only the three gated items.
- Tests:
  - The rail + and the top-bar + match while the Desk is on. The phone sheet uses the top-bar +.
  - Test Time off: add, remove, then hand-off preview and apply on a test account.
  - Desk off: the + menu is unchanged.

**S5. Launch hook, sweep, verify.**

- **Launch notice.** The Desk launch is the combined notice `new-look-and-layout` (`announcements.js` 1480, step `ann-desk`), held by `ANN_launchOn()`.
  - If it has not launched yet, extend the `ann-desk` step text and add one tour stop on the Client tab.
  - If the owner has already flipped `wb_enabled`, add a small `desk-client-actions` next-visit notice and tour instead (mgb-launch-kit).
- **Haiku sweep:** 1440, 760 and 375 pixels, light and dark. Desk open on the Inbox (Ledger chip), on the Client tab with all sections, and with the + menu open. Desk-off screenshots for the leak check.
- **Opus final verify** against this spec, sections 2 and 3.

### 3.3 Upkeep (in each slice's commit, as touched; mgb-ui-upkeep)

- Staff guide `docs/staff-guide/workbench.md` (Desk article): Client tab sections, Ask client from the Desk, the + menu items, the Ledger chip. Also `time-off-coverage.md` (a new way in) and `ask-client.md` (task-less ask from the Desk). Ship per-build guide SQL.
- Tips: re-point any tip on the Client tab head, and add one on the Waiting section.
- Tour: Desk steps in `Tour.jsx` (S5).
- ? help menu: no new page, so no change unless text moves.
- `docs/staff-guide/whats-new.md` (one line per user-facing slice).
- README Desk section.
- Dev Tools:
  - `MGB_VERSION` in `index.html`: bump the label and prepend to the note.
  - Flags: none new.
  - Reset keys: none new (state stays in `mgb_wb_hub`).
  - `PAGE_META`: none, because the Desk is not a page.
  - Usage Stats labels for new `WB_track` names: `wb-hub:client-waiting`, `wb-hub:client-msg`, `wb-hub:client-file`, `wb-quick:ask`, `wb-quick:message`, `wb-quick:timeoff`.
- US spelling throughout.

---

## 4. Owner decisions (each with a default)

| # | Question | Default if you say nothing |
|---|---|---|
| Q1 | Client tab: add all three sections (Waiting on client, last 5 messages, last 5 files), or only Waiting on client? | **All three**, 5 rows each, below the tasks |
| Q2 | Should Time off be in the + menu? | **Yes**, for everyone with the Desk on |
| Q3 | Ledger items: a Desk chip only, or also a count on the rail? | **Chip only.** Under decision 28 the rail is for what other people wait on you for. |
| Q4 | Client-facing view (close progress, recently finished): when? | **Not Sunday.** Write its own spec after the Slate app launches, starting from `workbench-phase3-spec.md` section L and the existing `ClientNeeds`. |

Everything else is fixed:

- no new flag (the Desk gate is used)
- no server code
- the Slate app is not touched
- the `t` drawer stays as it is

---

## 5. Cut from the old spec, and why

| Old item | Why it is cut |
|---|---|
| Bottom-bar hub panel with a scrim and overlay (section 1, D1) | Replaced by the right-side Desk column (desk-right-spec decisions 26 to 28) |
| A separate action strip row | It would be a fourth control row. Its actions go into the existing + menu and the Client tab head ("one job per surface", decision 28). |
| Inbox / My tasks / Client tabs as new work (H1, H2, H4) | Already built (`c579409`, `7ffbdc7`, `0807f2f`), now the Desk's Inbox, Slate and Client tabs |
| The stack protocol's scrim and Tab-trap rules (section 2.3, items 3 and 6) | The docked Desk is non-modal (Desk D3 and R1). The layer check is built (`WB_LAYER_SELECTORS`). |
| The W key | Replaced by D (Desk D3) |
| ⌘K "Open in Workbench", Shift+Enter, the Workbench actions group, the Search button and `tb:open-search` (H6) | The Client tab's type-to-find picker and the L1 sidebar's pinned and recent clients already find a client in place. It would also add a shared `TopBar.jsx` change for little gain. |
| Pins saved to `user_settings`, synced across computers (D4) | Built as per-browser `mgb_wb_pins:<email>` instead. Not a gap unless staff ask. |
| A fourth "Me" tab (D3) | Time off goes in the + menu (S4) |
| Composer drafts kept across close (H3b) | Nobody has asked for it, and it would touch `StaffInbox.jsx` |
| Log time | `time_entries` was retired on 2026-09-29. QuickBooks Time is parked. |
| People search | Needs a person view without a route change, which does not exist |
| Pinned filters | Slate's named saved views (P3) own this |
| An editor or composer inside the hub | Tasks open in the Desk (R2), and Reply uses the chat drawer |
| A summary RPC for the Client tab | Only if S2 measures over 600ms at p75 |
| Hub-specific launch tour (H6) | Folded into the Desk launch notice (S5) |
