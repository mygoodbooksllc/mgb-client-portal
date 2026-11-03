# Desk usability review

Date: 2026-11-03. Scope: the **current** Desk (right side) as shipped. That's `wb_enabled` on for all staff since 2026-10-21, the Desk preview checkbox retired 2026-10-25, and Classic Today (`mgb_wb_classic`) as the only opt-out.

**How this was done.** I read the code (`components/workbench/*`, `components/staff/StaffSidebar.jsx`, `components/staff/TopBar.jsx`, `components/tour/*`) and the docs (`docs/desk-right-spec.md`, `docs/staff-guide/workbench.md`). **I didn't see the Desk live myself.** The lead checked the live Desk (owner login, 1440 wide, 2026-11-03) and passed on what the Inbox and Client tabs look like. Those facts are marked *(live)*. Everything else is from code and may differ slightly on screen. Nothing was clicked, timed or tested with real staff.

Companion: `docs/desk-client-peek-spec.md`.

---

## 1. What a new staff member meets

**Closed Desk (default):**
- a 52px **rail** on the right edge with four icons (messages, reviews, files, mentions), each with a hover flyout
- a 42px **info bar** along the bottom ("3 late", "5 of 8 today", next up, the page's client, "D to open")
- on the left, the **staff sidebar** (L1) with Pinned clients, Recent clients and a Customize popover

**Open Desk** (D, or click the bar), top to bottom:
1. Head: title, count, Offline pill, ×. No gear.
2. Glance line and the **Right now** card, chosen by window height (`WB_deskFill`, tiers short <640 / medium <820 / tall)
3. Tabs: **Inbox | Slate | Client** *(live)*
4. Inbox: chips **All / Tasks / Reviews / Messages / Files**, then **Mine / Everyone** for admins, rows grouped **Overdue / This week** with Open buttons and row menus *(live)*
5. Footer key hints

**Client tab** *(live, Doxa Church)*:
1. Header row: name, ☆, "+ Task", "Open client"
2. "Switch client..." box
3. "Add task"
4. OVERDUE (7) / THIS WEEK (7), with late chips ("117 days late"), avatar, priority, status dropdown
5. **"Client contacts", collapsed, at the very bottom**
- There's no Drive link, flag or latest message.
- Empty state: "Pick a client to see their tasks here. Pin the ones you work on most with the star."

Widths are 320 / 380 / 460 (drag the left edge, 320-520). It pushes the page at ≥1100px, overlays below that, and becomes a full-screen sheet at ≤760px.

## 2. Findings

### F1. Four surfaces for one person's work (biggest learning cost)
The left sidebar, rail, bottom bar and open column each hold a different slice (decision 28: pins/recents left, waiting-on-you on the rail, your own work on the bar). The rule is sound, but it's invisible. Nothing on screen says why the late count is at the bottom and the messages are on the right. A new person has to learn four places before they trust any of them.

### F2. Discovery leans on keys and hover
- D opens the Desk, F6 moves focus, t opens the client panel, and j/k/x/s/a/e/o/q, 1-6 and 0 work in lists.
- The rail is **icon-only with hover flyouts**, so there's nothing to read until you hover, and on touch there's no hover.
- The full shortcut list is reached through **"?" on Today's Do next card**, not from the Desk itself. The Desk footer shows a few hints but doesn't link to the full list.

### F3. In the Client tab, the useful facts sit below the fold *(live)*
- On a busy client (14 open tasks), **contacts are collapsed at the very bottom**, below every task.
- The Drive folder isn't on the tab at all; it needs the full client page.
- There's no "what did they last say" either.
- So the Client tab works as a task list for one client, but it isn't yet a "who is this client" view. That's the gap the client peek spec fills.

### F4. The Client tab follows the page, which surprises people both ways
On a client page the tab jumps to that client. Elsewhere it shows the last one (`WB_HubClient.jsx` header). That's good for browsing but bad on a call: open a second client to compare and the Desk leaves the first. Nothing holds a client, and nothing on screen explains the rule.

### F5. Labels drift between places
- **Files vs Documents:** the Desk chip says Files, while Today chips and the client page say Documents.
- **"Inbox" tab vs the Inbox page:** same word, different scopes.
- **☆ star** in the Desk vs a **pin icon** and "Pin this client" in the left sidebar, for the same `mgb_wb_pins` list. Two pictures for one thing.
- **Slate** tab whose code id is `tasks`. Harmless on screen, but the guide and tour must say Slate.
- The empty Client tab says "Pin ... with the star", which mixes both words in one sentence.

### F6. Density at standard width (380px)
With the Desk open on a tall window, a new person sees: head, glance line, Right now card, 3 tabs, 5 chips (which wrap at 320), Mine/Everyone for admins, group headers, rows with Open buttons and menus, and the footer hints. That's at least 8 layers before the first row. Each one is earned, but together they read as busy. The tier logic (`WB_DESK_BUDGET` 1 / 3 / 6) already trims on short windows. It doesn't trim for "I'm new".

### F7. Nothing on the Desk can be customized from the Desk
- The engine is there but has **no UI**:
  - `WB_deskFill` accepts prefs `{on, order}`
  - `WB_deskClosedShow` supports both / rail / bar / neither
  - `WB_layout.js` already defines Desk bars `rail` (`tabs`, `actions`) and `bar` (`info`, `actions`), marked "wait for R4"
  - R4 (the gear) was never built
- The **only reset** is Dev Tools, Reset local state, which also resets everything else.

Compare the left sidebar, which has a clear Customize popover (sliders icon) for on/off, order, detail and width, plus admin role defaults (`tk_settings.layout_defaults`).

### F8. Narrow and phone behavior is solid but blunt
Under 1100px the Desk overlays the page (you can't see both). At ≤760px it's a full sheet. That's correct, but at 1024-1099 (a common laptop width with a sidebar open) people lose the page every time they open the Desk. The rail's hover flyouts also have no touch equivalent.

### F9. Empty states mostly explain, a few don't invite
Inbox and Client empty states say what goes there. None offer the next step as a button ("Pick a client" has a box, which is good; there's no "Show me around" or link to the guide).

## 3. Customizable today vs not

| You can change today | You can't change today |
|---|---|
| Desk width (drag 320-520, remembered) | Which extras show (glance, Right now) |
| Last tab, chip, scroll (remembered) | Closed Desk: rail, bar, both or neither (engine yes, UI no) |
| Folded Slate groups | Order of tabs or chips |
| Star pins (max 8), shared with the left sidebar | Hide a chip you never use (for example Files) |
| Admin Mine/Everyone | Keep a client on the Client tab (follows page) |
| Classic Today (opt out of the Desk) | Where contacts sit in the Client tab |
| Left sidebar: full Customize popover | A Desk-only reset (only the global Reset local state) |

## 4. Recommendations, ranked (value ÷ cost)

| # | Change | Value | Size | Risk | Preview-flag fit |
|---|---|---|---|---|---|
| R1 | **Client tab summary + Keep** (the client peek spec): contacts, Drive, flag and last message above the tasks, collapsible. Keep stops the tab following the page. | High: fixes F3 and F4, the most common "where is it" during client work | M | Medium (role visibility; the spec has leak tests) | Yes, `mgb_peek_preview` + `desk_peek_enabled` |
| R2 | **Label clean-up:** Files → Documents on Desk chips. One icon for pins everywhere (star). Empty text "Star a client to keep it at the top". Inbox tab → "Waiting" or keep it and rename nothing (owner call, Q2). | High for little cost (F5) | S | Low (text only; tips, tour and guide must follow) | Not needed. Text-only, ship with the upkeep checklist. |
| R3 | **Desk Customize popover** in the Desk head (same sliders icon and pattern as the left sidebar): on/off for Glance and Right now, closed Desk = both/rail/bar/neither, a "Reset Desk" button. All wired to existing `WB_deskFill` prefs and `WB_deskClosedShow`. | High (F7; the engine exists) | S-M | Low (prefs only, local) | Yes, can share the peek's flag or have its own |
| R4 | **"Keys" link in the Desk footer** that opens the existing shortcut sheet, plus `?` inside the Desk. | Medium (F2) | S | Low | Not needed |
| R5 | **Rail labels on first use:** show the rail's text labels (Messages, Reviews, Files, Mentions) for the first week or until each is clicked once, then icon-only. Tap opens the flyout on touch. | Medium (F2, F8) | S | Low | Yes |
| R6 | **"Simple" starting layout for new staff:** a role default (via `WB_layout.js` / `tk_settings.layout_defaults`) that hides Right now and admin Mine/Everyone until the person turns them on. | Medium (F6) | M | Medium (role defaults touch everyone; needs owner choices) | Yes |
| R7 | **Chip overflow:** at 320px show All / Tasks / Messages and fold the rest into "More". | Low-medium (F6) | S | Low | Yes |
| R8 | **"How the Desk is laid out" one-card explainer** (rail = waiting on you, bar = your work, left = your clients), linked from the Desk head the first two weeks, plus the existing tour. | Medium (F1) | S | Low | Folds into launch-kit notices |
| R9 | **Push instead of overlay at 1024-1099px** when the left sidebar is collapsed. | Low-medium (F8) | M | Medium (layout math in `WB_Drawer`) | Yes |
| R10 | **Customize the Inbox chips** (hide, reorder). | Low | M | Low | Yes |

Not recommended now: merging the rail and bar into one surface (it undoes decisions 26-28, which were approved and shipped 2026-10), or a separate pinned-client slot outside the Client tab (it duplicates the star pins and the Client tab, as the lead's live check showed).

## 5. Recommended first slice (3 changes)

1. **R1, Client tab summary + Keep** (Medium, hidden behind its own flag). This is the client peek spec, phases P0-P2.
2. **R2, label clean-up** (Small, text only, with guide, tour and tips in the same commit).
3. **R3, Desk Customize popover** with Glance, Right now, closed-Desk choice and Reset Desk (Small-Medium, can sit behind the same preview flag so the owner tries both together).

R4 (Keys link) is a one-line add that can ride along with R2 if there's room.

**Models:** R1 is Sonnet build, Opus review and leak verify, Haiku screenshots. R2 and R4 are Sonnet, with Haiku grepping for every changed label. R3 is Sonnet build, Opus review, Haiku screenshots.

## 6. Open questions for the owner

1. **Star vs pin:** use the star everywhere (Desk and left sidebar), and call the new Client tab toggle "Keep on Desk"?
2. **"Inbox" tab name:** keep it, or rename the Desk tab (for example "Waiting") so it isn't confused with the Inbox page?
3. **Files → Documents** on the Desk chips: OK?
4. **New-staff simple layout (R6):** hide Right now and Mine/Everyone by default for new staff, or show everything and rely on the tour?
5. **Customize scope (R3):** per person only, or also admin role defaults like the left sidebar?

## 7. What I couldn't verify

- I didn't see any of the Desk live. Live facts come only from the lead's check (owner login, 1440 wide). I haven't seen it at 320px, under 1100px, on a phone sheet, or as a bookkeeper or temp admin.
- How real staff actually use the Desk (no usage data read for this review).
- Whether Desk additions (`deskplus_enabled`) are on right now. It changes the Client tab (See all, Ledger chip).
- Production RLS state. I ran no SQL. Permissions are taken from the SQL files in the repo.
