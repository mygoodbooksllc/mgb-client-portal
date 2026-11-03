# Desk client peek: spec

Status: **spec only, nothing built** (2026-11-03). Hidden behind a preview flag plus a firm switch until the owner launches it.
Related: `docs/desk-right-spec.md` (Desk layout, decisions 1-28), `docs/staff-guide/workbench.md` (current Desk guide), `docs/desk-usability-review.md` (review written alongside this spec).

**Shape in one line:** the peek **extends the existing Desk Client tab**. It isn't a new parallel slot. The selected client's header row gets a compact, collapsible summary (contact, Drive folder, flag, latest message, next tasks) **above** the task list. A new **Keep** toggle stops the tab from following page changes, so the client stays put while you work elsewhere. The existing star pins stay what they are: favorites at the top of the client finder.

Visible words: **Keep on Desk** (toggle), **Kept** (badge). Code ids use `wb_peek` / `WB_peek*`. See Q1 on the word "Pinned".

---

## 0. What the Client tab does today (checked live by the lead, 2026-11-03, owner login, 1440 wide)

- Desk tabs: **Inbox | Slate | Client**.
- With no client: a "Find a client..." box, Recent and All clients, and the empty text "Pick a client to see their tasks here. Pin the ones you work on most with the star." A footer hint bar covers D, Esc, drag the left edge for width, and the star.
- With a client (for example Doxa Church), from the top:
  1. Header row: client name, ☆ star (pin), "+ Task", "Open client"
  2. "Switch client..." box
  3. "Add task" row
  4. Tasks grouped OVERDUE / THIS WEEK, with late chips ("117 days late"), assignee avatar, priority, status dropdown
  5. **"Client contacts"**, collapsed, at the **bottom**, below every task (`TK_ClientContacts`, mounted from `TK_ClientDrawer.jsx:400` / `TK_ClientTasksBody`)
- There's no flag, no Drive link and no latest message anywhere on the tab.
- Which client shows (code, `WB_HubClient.jsx` header): on a client page that client is picked when the tab mounts or the page changes. Otherwise it's the one the tab showed last (`hub.clientId`, saved with the hub). So the tab **follows the page**, and today nothing can hold a client while you browse other clients.

The problem the peek solves: on a long task list the contacts are effectively hidden, the Drive folder needs the full client page, and the tab jumps to whatever client page you open next.

## 1. Goal

When a staff member is working one client for a while (a call, a month-end close, a cleanup), the Desk Client tab shows that client's short facts at a glance, with contacts and Drive reachable **without scrolling**. Optionally, the tab keeps that client even while the person opens other pages or other clients.

## 2. Non-goals

- **No money.** No fees, rates, plan price, margins, hours over, invoice amounts, QuickBooks connection or balances, or anything read under `can_view_internal()`. The summary is safe on a shared screen.
- No editing in the summary. Every action opens an existing place (client page, chat, task, contacts editor). Contacts are still edited in `TK_ClientContacts`.
- Not a second client page. Anything longer than one line links out.
- No second "pinned" concept. Star pins (`mgb_wb_pins:<email>`, max 8) stay favorites in the finder and the left sidebar, unchanged.
- No new surface on the closed Desk (rail and bar) in Phase 1 (decision 28).
- Never shown to clients, or in View as, impersonation, previewing, or the own-window Slate. The Desk doesn't mount there (`WB_deskMounts`).
- No cross-device sync in Phase 1.

## 3. User stories

1. **Bookkeeper on a client call.** "I open Doxa on the Desk Client tab. The treasurer's name and email and the Drive folder are right under the client name, not below 14 tasks. I click Keep, and while I open Reports for another client to compare, the Desk stays on Doxa."
2. **Bookkeeper doing month-end.** "The summary shows the last client message, so I know they sent the statements yesterday. My next 3 tasks are in the summary, and the full list is right below."
3. **Account manager covering.** "The summary tells me who the bookkeeper is, so I know who to ask."
4. **Admin reviewing.** "Message opens their chat in one click from the summary."
5. **Anyone who loses access.** "My temporary grant ran out. The kept client shows no name or data, just 'You can't see this client anymore' and a Stop keeping button."
6. **New staff member.** "The summary is just there the first time I pick a client. The Keep toggle has a tip the first time."

## 4. Layout of the Client tab with the peek

```
[ Doxa Church  ☆   (Keep)          + Task   Open client ]   header row (Keep is new)
[ Bookkeeper: Ana · AM: Ben                       ⌃ ]   summary, collapsible (new)
[ Treasurer: Jo Smith  jo@...  Copy · +2 more         ]
[ Drive folder ↗          Flag: "Close Oct by the 10th" ]
[ Last message: Jo · 2 hr ago · "Statements attached…" ]
[ Next: 3 tasks (1 late) →  jumps to the list            ]
[ Message ]
[ Switch client...                                     ]   unchanged
[ Add task                                             ]   unchanged
[ OVERDUE (7) ... THIS WEEK (7) ...                    ]   unchanged list
[ Client contacts (collapsed)                          ]   unchanged, still here for editing
```

- The summary sits **between the header row and "Switch client..."**.
- **"Next tasks" is a one-line count + jump**, not a copy of 3 rows, because the full list is right below. In the short tier the jump is all there is. (The mockup's "up to 3 open tasks" becomes a Phase 2 option on the Slate strip, section 7, where there's no list below.)
- **Collapsible:** a chevron folds the summary to one line ("Ana · Jo Smith · Drive ↗"). Collapsed or open is remembered per person, for every client (not per client).
- The bottom "Client contacts" section stays (that's where people add and edit contacts). The summary's "+N more" scrolls to it and opens it.
- The approved mockup's "Open full page" button is the header row's existing "Open client" link, so nothing gets duplicated.

## 5. Contents, and where each field comes from

**Whitelist rule:** the summary is built by a pure shaper, `WB_peekShape(client, reads)`, that copies only the fields below and never spreads a `CLIENTS` object (which carries QuickBooks and plan data).

| # | Field | Source | Fetch? | Notes |
|---|---|---|---|---|
| 1 | Client name, ☆, + Task, Open client | existing header row | No | Unchanged. |
| 2 | Keep toggle + Kept badge | local state (section 6) | No | New, in the header row next to ☆. Different glyph from the star (a lock or "keep" pin). See Q1. |
| 3 | Bookkeeper / AM | `clients` prop (`visibleClients`, app.jsx:31819): `assignedBookkeeper.name`, `accountManager` (`AM_fromRow`) | No | "You" when it's me. AM shown only if different. |
| 4 | Contact | `tk_request_recipients(p_client_id).contacts` (the same read `TK_ClientContacts` uses, `client_contacts` with roles), then `TK_api.clientHeader(clientId).contacts` (portal users) if there are none | Yes, 1 (shared with the bottom section if that's mounted) | One person: role + name. Email as plain text with Copy. **No mailto, no email in a URL** (`TK_ClientHeader` rule). "+N more" opens the bottom section. |
| 5 | Drive folder | `TK_api.clientHeader(clientId).driveFolderId` (`drive_folders`, year null, doc_type null) | Yes, 1 | `https://drive.google.com/drive/folders/<id>` (encodeURIComponent), only when `DRV_status()` is on. Otherwise the row is hidden. RLS: `is_active_staff() and can_access_client()`. |
| 6 | Flag | Recommended: newest **pinned** `client_private_notes` row, category Status or Handoff (RLS `can_access_client`, same read as `clientNotesApi.list`, app.jsx:20360) | Yes, 1 (limit 1) | One line, ~80 chars. **Money guard:** if it matches `/\$\s?\d|\bfees?\b|\brates?\b|margin|invoice|price|pay(ment)?s?\b/i`, show "See pinned note" instead (notes do carry fee talk, and the schema's own example is about fees). Alternative is in Q3. |
| 7 | Latest client message | `client_messages` with `WB_CX_MSG_COLS`, eq client_id, `internal = false`, `deleted_at is null`, order created_at desc, **limit 1** (as in `WB_clientExtras.js`) | Yes, 1 | Author + age (`WB_cxWhen`) + one trimmed line (`WB_cxTrim`). Label "Client" vs "Staff" from `author_kind`. The name is display only (`author_name` spoofing is an open README follow-up). |
| 8 | Next tasks | the tab's own list, `TK_vUseList("wb:client:<id>")` | No (already loaded) | "3 open · 1 late", clicking scrolls to the first group. |
| 9 | Message | `WB__openChat(clientId, me)` (WB_store.js:835) | No | Falls back to the Messages page for that client. |

**Reads per selected client:** 3 calls at most (recipients, clientHeader, pinned note + latest message can run in parallel, so 4 requests). Re-read on client change, on Desk open if older than 2 minutes, and on `mgb:wb-peek`. No polling. Stale guards use the `WB_cxSeq` pattern. When the summary is collapsed, reads still run (so expanding is instant) but are skipped while the tab is hidden (`showing` false, as Desk additions already do).

**Never in the summary:** plan, fee, rate, billing, QuickBooks status or balances, `client_health()` reasons `margin` and `hours_over`, anything under `can_view_internal()`, internal messages, staff pay, hours.

## 6. Keep: how it works

The Client tab already remembers its last client (`hub.clientId`). **Keep** adds one rule: while a client is kept, the tab **doesn't follow the page**. Opening another client page leaves the Desk on the kept client.

### Entry points (Phase 1)
1. **Keep toggle in the Client tab header row** (main entry point). Click to keep, click again to stop.
2. **Client page header.** A "Keep on Desk" button next to the client name (`TK_ClientHeader` and the client Overview header). It keeps that client, opens the Desk on the Client tab, and turns into "Kept on Desk ✓".
3. **⌘K.** One row in `TB_actionRows` (TopBar.jsx:432): "Keep <client> on Desk" on a client page, and "Stop keeping <client>" when already kept. Search words: keep, pin, desk, peek.
4. **Keyboard `p`** on a client page toggles Keep (unused today; check `WB_keys` and the `TK_` key handlers before building). Added to the Desk shortcut list and the Client tab footer hints.

Phase 3: the top-bar client picker row and the left sidebar's client menu.

### Persistence
- Key: `localStorage["mgb_wb_peek:<email>"]` = `{ v: 1, keptId, at, collapsed }`. `collapsed` is the summary fold (it applies even with nothing kept). Separate from star pins. Neither writes the other.
- With **nothing kept**, behavior is exactly today's (follow the page, else last client).
- With a client **kept**, the tab shows it on mount and on every page change. "Switch client..." still works: picking a different client while kept asks nothing, moves the keep to the new client, and toasts "Now keeping <new>. Undo".
- Survives reload and sign-in again on the same browser. Per person (real email), per browser.
- Cross-tab: a `storage` event plus `mgb:wb-peek`.
- Clearing: the toggle, the client header button, ⌘K, `p`, Dev Tools **Reset local state** (`mgb_` prefix), or access loss (the no-access state with Stop keeping).
- Expiry: recommend a keep older than **7 days** clears on next load with a one-time toast. Owner decides (Q5).
- A hint when kept and on a different client's page: the header row shows "Kept · you're on <page client>" with a "Show <page client>" link that switches the keep off for this visit. This stops the "why is the Desk on the wrong client?" confusion.

## 7. Placement, heights and narrow widths

The summary is inside the Client tab, so the Desk's `WB_deskFill` budget for glance and Right now is unchanged. The tab adapts to `WB_deskTier`:

| Tier | Summary |
|---|---|
| tall (≥820px) | All rows open by default |
| medium (640-819px) | Contact + Drive on one line, flag and message on one line each |
| short (<640px) | Folded to one line by default (bookkeeper · contact · Drive ↗), chevron to open |

- Desk width 320: Copy replaces the email text, buttons become icon + short label, and lines truncate with ellipsis. At 380/460 it's the full layout.
- Overlay (<1100px): same as the column.
- Phone sheet (≤760px): folded one line on top, tap opens it, and buttons go full width.
- Right now card: when its client equals the Client tab's client and the Client tab is showing, Right now hides (decision 28, one place per fact).
- Task view: when a task is open in the Desk, the summary is hidden (as the head is today).

**Phase 2, the Slate strip (the mockup's "Slate below"):** when a client is **kept** and the Slate tab is active, a one-line strip at the top of the Slate list reads "<client> · next: <task> · Drive ↗ · Message", and clicking the name switches to the Client tab. Open question Q6. This is the only place the peek reaches outside the Client tab.

## 8. States

| State | When | What shows |
|---|---|---|
| No client | Tab empty | Today's empty state, with the text updated (usability review R2) |
| Loading | Reads in flight | Summary frame with bookkeeper (no fetch) and 2 grey skeleton lines |
| Partial | One read failed | That row says "Couldn't load · Retry". Other rows render. Nothing is logged with client data. |
| Error / offline | All reads failed | One line: "Can't reach the server. Retry", with the Desk's Offline pill as usual |
| No access | Kept or remembered id not in `visibleClients` | "You can't see this client anymore." + Stop keeping. **No name, no reads.** (Extends today's "You don't have access to this client".) |
| Client removed | Id not in CLIENTS at all | Same as no access |
| Empty rows | No contact / Drive / flag / message | That row is hidden. Contact shows "No contacts yet · Add" (scrolls to the bottom section). |

## 9. Permissions per role

Existing RLS only. No new policies. The client-side check is a convenience, and the database is the gate.

| Role | Can see the summary / keep | What shows | Notes |
|---|---|---|---|
| Admin (active) | Any client in `visibleClients` | All of section 5 | MGB internal only with `can_view_internal()`, and it isn't in the Client tab picker pool anyway (`WB_hubPickerPool` excludes it). |
| Account manager (non-admin) | Clients in `staff_client_access` + live grants | All | |
| Bookkeeper, assigned | Assigned + live grants | All | |
| Bookkeeper, **not assigned**, no grant | Nothing. The client isn't in `visibleClients`, so the picker can't offer it. | A stale kept id gives the **no-access state**: no name, **no reads fired** | RLS (`can_access_client`) would return nothing anyway. The UI must not even ask. |
| Bookkeeper with approved temp grant | That client while the grant is live (`CS_useLiveGrantClientIds`) | All | On expiry the client drops out of `visibleClients` and the summary flips to no access without a reload. |
| Temp admin | Same as their base role. Temp admin opens admin pages, not more client data. | Same | Leak test T4 |
| Clients, View as, impersonation, previewing | Never. No Desk mount. | n/a | Keep storage is keyed by the real signed-in email. |

Pure helper: `WB_peekAccess(clientId, visibleClients)` returns `"ok" | "none" | "unknown"`. Reads fire only on `"ok"`.

## 10. Gating (hidden until the owner launches)

Copies `components/workbench/WB_plus.js`:

- **Preview flag** `mgb_peek_preview` in app.jsx `FEATURE_FLAGS`, label "Desk client summary (preview)", `reloads: true`.
- **Firm switch** `tk_settings.desk_peek_enabled`, owner-only. Read once per load, cached in `mgb_peek_cache`, event `mgb:peek`, hook `WB_usePeek(deskOn)`.
- **Resolver** `WB_peekIsOn(deskOn, previewOn, switchValue)` = `deskOn && (previewOn || switchValue === true)`.
- **Owner-only trigger:** add `desk_peek_enabled` to the owner-only key list as `supabase/owner-only-deskplus-switch.sql` does. That's the only SQL. It's additive and auto-apply eligible. No new tables.
- **Off means today's Client tab exactly:** no summary, no Keep toggle, contacts at the bottom, no client header button, no ⌘K row, no `p`. Stored keep ignored, not deleted.
- Classic Today users have no Desk, so they get no peek.
- **Never flip the switch.** The owner turns it on in Dev Tools.

## 11. Upkeep list (drafted during the build, published at launch)

Per `mgb-ui-upkeep` and `mgb-preview-flag-build`:

1. **Staff guide** `docs/staff-guide/workbench.md` (slug `workbench`): rewrite the Client tab section (summary, Keep, star = favorites) and add a line in the client page article. Targeted Supabase upsert at launch. Never `sync.mjs`.
2. **Tour** (`components/tour/Tour.jsx`): one step on the summary (`data-tour="wb-peek"`), one on Keep (`data-tour="wb-peek-keep"`), behind `WB_peekIsOn`. Admin, AM, bookkeeper and temp-admin tours. Not client tours. Re-check the existing `TK_ClientContacts` tour target (Tour.jsx ~159) still points at the bottom section.
3. **Tips** (`components/tour/Tips.jsx`): `wb-peek-keep`, shown the first time someone opens a client page while the Client tab shows a different client, respecting `TIPS_BUSY`.
4. **What's new / launch notice** (`components/tour/announcements.js`): `ANN_peekLaunchOn()` like `ANN_deskPlusLaunchOn()`, with a "Show me" tour (`mgb-launch-kit`).
5. **Help menus and hints:** the Client tab footer hint bar gains "p keeps this client". The Desk shortcut list gains `p`.
6. **Dev Tools:** `PAGE_META` entry, FEATURE_FLAGS row, a switches row for `desk_peek_enabled` next to `deskplus_enabled` (app.jsx ~15754), reset keys `mgb_wb_peek:*` and `mgb_peek_cache` listed in the Reset local state comment. `MGB_VERSION` bump at build time.
7. **README:** Desk components row (~96) for `WB_peek.js` / `WB_HubClientSummary.jsx`, a launch checklist like Desk additions (~3204), and a change-log line.
8. **Empty-state text** in the Client tab (it mentions only the star) gets one more sentence about Keep, gated.

## 12. Test plan

**Pure logic (node, `WB_peek.test.js`):**
- `WB_peekIsOn` truth table.
- `WB_peekShape` whitelist: a fixture client with `fee`, `rate`, `plan`, `qbo`, `margin`, `hours` keys produces a view with none of them (deep key scan).
- Money guard: any `$` followed by a digit, "fee went up", "rate change", "margin low", "invoice late" are hidden. "Treasurer changed", "Close Oct by the 10th" are shown.
- `WB_peekAccess` ok / none / unknown.
- Which-client rule: nothing kept + client page gives the page client. Kept + other client page gives the kept one. Kept + no-access gives the no-access state. Not kept + no page gives the last client.
- Storage tolerates garbage, old versions and other people's keys. Expiry math.

**Leak tests (live; Opus verify, test logins per `project-page-drop-test-setup`):**
- T1 **Bookkeeper, unassigned client:** not in the picker. Hand-write `mgb_wb_peek:<email>` with its id and reload. You should get no access, **zero** network requests for that id, and the name absent from the DOM.
- T2 **Temp grant:** keep during a live grant. Revoke or expire it, and it flips to no access without a reload.
- T3 **Assignment removed:** the bookkeeper's next load shows no access.
- T4 **Temp admin:** same fields as without temp admin. A hand-written unassigned id gives no access.
- T5 **MGB internal:** an admin without `internal_access` gets no access for a hand-written id.
- T6 **No money:** a pinned note with a fee shows "See pinned note". The summary's DOM text has no `$`, "fee", "rate" or "margin".
- T7 **View as:** admin keeps a client, then Views as a bookkeeper. No Desk. Exit, and the keep is intact.
- T8 **Client portal:** `mgb_wb_peek` is never read.

**Preview on/off:**
- P1 Off/off: the Client tab is pixel-identical to today (screenshot compare, contacts still at the bottom). No button, ⌘K row or `p`.
- P2 Flag on: everything appears after reload. Flag off: gone, storage kept.
- P3 Switch on (owner test, then off): shows without the flag.
- P4 Classic Today: nothing.

**Layout (Haiku sweep):** heights 600 / 750 / 900, Desk widths 320 / 380 / 460, 1024 (overlay), 390 (phone sheet), light and dark. Confirm contacts and Drive are visible without scrolling at 750 high and 380 wide with a 14-task client (the Doxa case).

## 13. Phased build

Overall: **Medium.** A few files and one additive SQL row, but it touches what each role can see, so Opus does the leak verify and it isn't skipped.

| Phase | What | Size | Build / review / checks |
|---|---|---|---|
| P0 | `WB_peek.js`: gate (`WB_peekIsOn`, `WB_usePeek`, cache), storage, which-client rule, `WB_peekShape`, `WB_peekAccess`, money guard. Node tests. Owner-only SQL row. FEATURE_FLAGS + Dev Tools switch row. | S | Sonnet builds, Opus reviews, Haiku runs tests |
| P1 | `WB_HubClientSummary.jsx` in the Client tab (rows, states, fold, tiers), Keep toggle + which-client rule wired into `WB_HubClient`, client page header button, ⌘K row, `p`, Right now de-dupe | M | Sonnet builds UI. **Opus** writes or reviews the read and shaper layer and runs T1-T8. Haiku runs the screenshot sweep. |
| P2 | Upkeep drafts (section 11), gated. Optional Slate strip (section 7) if the owner says yes to Q6. | S | Sonnet writes, Opus verifies against `mgb-ui-upkeep` |
| P3 (later) | Top-bar picker + sidebar entry points, cross-device keep (`staff_prefs` row), summary in task view | M | Plan again first |

Each phase ships from a worktree to main, hidden. The owner tries it with the flag, then flips `desk_peek_enabled`.

## 14. Open questions for the owner

1. **Words.** Recommend the star stays "Pin" (favorites at the top of the finder and the sidebar) and the new toggle is **"Keep on Desk"** (the tab stays on that client). Or do you want the mockup's "Pinned" badge, which would mean renaming the star to "Favorite"?
2. **Summary for everyone with access?** Bookkeeper/AM line, contact, Drive, flag and last message for every role that can open the client. OK?
3. **Flag source:** the newest pinned Status/Handoff note (recommended, with the money guard), a health band chip ("Watch", "At risk") without margin/hours reasons, or both?
4. **Contacts order:** named request contacts (treasurer, pastor) first, then portal users. OK?
5. **Keep expiry:** 7 days, 24 hours, or never?
6. **Slate strip:** when a client is kept, show a one-line strip on the Slate tab (the mockup's "my Slate below")? Or is the Client tab enough?
7. **Next tasks in the summary:** a count + jump (recommended, since the list is right below), or the mockup's 3 task rows repeated?
8. **Move contacts?** Keep the full "Client contacts" section at the bottom for editing (recommended), or move the whole section up under the summary?
9. **Closed Desk:** show "Kept: <client>" in the bottom bar, or keep the bar for your own work only (decision 28)?
