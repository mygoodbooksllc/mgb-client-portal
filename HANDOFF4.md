# MyGoodBooks — Session Handoff (4)

*Written 2026-09-05. Supersedes HANDOFF3.md for anything it contradicts — read that one
(and HANDOFF2.md, which it in turn defers to) first for everything not mentioned here: file
map, access model, data invariants, build mechanics, the visual redesign, and everything
about Report Builder / Enterprise Tools / Daily Report that didn't change today.*

---

## 1. Headline summary

Two threads this session: **the dashboard became a fully customizable, drag-and-drop hub**
(pull in cards from any tab you have access to, reorder them, resize them), and **this
project got its first-ever git repo** — with a QA pass in between that caught a real bug
(touch drag-and-drop was completely non-functional on phones) before it shipped.

**Unfinished going into tonight**: the repo is committed locally but **not pushed to
GitHub yet** (§6) — that's the one real next step. The Artifact link (§7) is current as of
the end of this session, republished with the touch-drag fix right before wrapping up.

---

## 2. Dashboard customization — new this session, end to end

Both `DashboardPage` and `ScopedDashboardPage` (app.jsx) now support a full widget system,
built around `useWidgetLayout()` (app.jsx, ~line 3295) — a hook that persists an ordered
list of visible widget ids to `localStorage` (`mygoodbooks_dashboard_widgets_v1`), keyed per
`${client.id}:full` or `${client.id}:scoped:<sorted categories>` so a bookkeeper previewing
a limited user sees *that user's* picks, not their own.

- **"⚙ Customize dashboard" button** opens `WidgetPickerModal` — checkboxes to show/hide
  each widget, drag handles (⠿) to reorder. Modal reorder uses standard HTML5
  drag-and-drop (mouse only — this list is short and desktop-oriented, so it was left as-is
  after the touch findings in §5; worth revisiting if that becomes a problem).
- **On-page card dragging** — the actual KPI tiles and content cards can be picked up and
  dropped directly, not just reordered in the modal. `useDragReorder()` (app.jsx, ~line 3586)
  drives this; see §5 for today's touch fix.
- **Cross-tab widgets** (`crossTabWidgetDefs()`, app.jsx ~line 980) — the dashboard can pull
  in summary cards from Budget vs. Actual, Bank Accounts, Receivables & Payables, and Giving
  & Funds, gated by `access.tabs.has(tabKey)` so a widget only appears as an option if the
  viewer can already see that tab's real page. Each shows a "From <Tab Name>" badge in the
  picker. This is what makes it "a hub for everything they might want to see," per the
  explicit ask.
- **Adaptive card sizing** — `.content-grid-adaptive` (styles.css ~line 1021) is a fixed
  2-column grid with `align-items: start`, not the old `1.6fr/1fr` stretch-to-match layout.
  A short card (Bank Accounts, Budget Totals) sizes to its own content instead of stretching
  to match a tall neighbor; a `.content-card-full` card (charts, transaction lists) spans
  both columns and always gets its own row. Two short cards land side by side automatically
  via normal grid auto-placement — no JS layout math needed. `COMPACT_CONTENT_CARDS`
  (app.jsx, just above `crossTabWidgetDefs`) is the hardcoded list of which widget ids count
  as "short."
- **Subcategory ledger** — `CategoryLedger` (app.jsx, right after `IncomeExpenseChart`)
  renders a scrollable bar-chart breakdown of the current month's transactions by category
  underneath the Income vs. Expenses chart, reusing the existing budget-table bar-track
  styling. This is what "subcategory accounts and ledger visuals" turned into.
- **Recent Activity / Recent Transactions** now show a rolling **2-month window**
  (`monthsAgoLocal(2)`, app.jsx near `todayLocal`) in a fixed-height scrollable container
  (`.tx-list-scroll`, styles.css) instead of a hard top-5/top-6 cutoff.
- **Referral popup disabled** — both render call sites are commented out
  (`ScopedDashboardPage` and `DashboardPage`), but `ReferralPopup` and its storage
  keys/defaults are untouched in app.jsx, ready to re-enable by uncommenting.

### A real bug this surfaced and fixed: charts going permanently blank

The scroll-reveal system (HANDOFF3 §3) marked a card "ready to animate" by imperatively
adding a CSS class (`classList.add("in-view")`) from an `IntersectionObserver` callback.
Once the dashboard started re-rendering on its own (drag state, widget-layout state), React
would recompute `className` on every render and **silently wipe that class**, since it was
never part of what React thinks it owns. The chart's clip-path never lifted, so it rendered
permanently invisible — reported as "I see nothing on Income vs. Expenses." Same latent bug
existed in the Daily Report panel (which already re-renders every 30s from its own live
tick) and would eventually have hit it too.

**Fixed by switching to a `data-in-view` attribute** instead of a class — React only
manages attributes it's explicitly given in JSX, so an attribute set by outside code
survives every re-render. All three files' CSS updated: `styles.css` (`.card[data-in-view]`),
`components/daily-close/DailyClose.css` (`.dc-kpiTile[data-in-view]`,
`.dc-panel[data-in-view]`), and the JS in app.jsx's reveal `useEffect`.
**If you ever add another imperative-DOM-mutation-driven CSS hook, use a data attribute,
not a class** — this is a durable lesson, not a one-off patch.

---

## 3. Drag-and-drop direction bug (fixed)

Dragging a card **left** worked; dragging **right** silently did nothing. Root cause: the
reorder math removed the dragged id from the array, then inserted it "before" the target's
new (post-removal) index. For a rightward drag, removing the dragged item shifts every
later index down by one — so "insert before target" lands exactly back where the drag
started. `layout.reorder()` (app.jsx, inside `useWidgetLayout`) is now direction-aware:
insert *after* the target when dragging forward, *before* it when dragging backward. Both
directions verified with synthetic `DragEvent` sequences post-fix.

---

## 4. iPhone-style live reorder + jiggle

Reordering now feels like rearranging home-screen apps: grabbing a card jiggles every
*other* card in the grid (`.card-jiggling`, two alternating keyframes so they don't
visually sync), and dropping onto a neighbor reorders **live**, on `dragover`, not just on
release. Jiggle speed was tuned down 50% after initial feedback that it was too fast
(`cardJiggleA`/`B` durations: 0.26s→0.39s, 0.22s→0.33s — styles.css ~line 2745).

---

## 5. QA pass — touch drag-and-drop was completely broken (fixed)

Ran a full sweep at 1440px and 375px across all 11 pages. Desktop and mobile layout are
clean — **no horizontal overflow, no clipped text anywhere**. But the on-page card
drag-and-drop (§2) used plain HTML5 `draggable`/`dragstart`/`dragover`/`drop`, and **no
mobile browser fires those events from touch input, on any platform.** The feature wasn't
buggy on phones — it was structurally absent.

**Fixed with a parallel Pointer Events path** in `useDragReorder()` (app.jsx). Mouse
behavior is untouched (still native HTML5 DnD, ghost image and all) — the two paths are
separate handlers on the same element, gated by `e.pointerType`:

- **Press and hold** (`CARD_LONG_PRESS_MS = 350`) to pick a card up. A plain swipe is *not*
  mistaken for a drag — any movement over 10px before the hold timer lands cancels it, so
  ordinary scrolling is unaffected.
- Once picked up, **page scroll is blocked** via a native, non-passive `touchmove` listener
  (React's own touch handlers are passive by default, so `preventDefault()` from a React
  `onTouchMove` wouldn't work) — attached only for the lifetime of the drag via a
  `useEffect` keyed on `draggedId`.
- Cards carry a `data-widget-id` attribute so the card under the finger can be found with
  `document.elementFromPoint()` on every `pointermove` — necessary because pointer capture
  routes all subsequent events back to the *held* element, not whatever's underneath, so
  manual hit-testing is the only way to know what's being dragged over.
- `-webkit-touch-callout: none` on `.draggable-card` (styles.css) stops iOS's text-selection
  callout from appearing mid-long-press and fighting the gesture.

Verified end-to-end with synthetic `PointerEvent` sequences (pointerdown → wait past the
threshold → pointermove → pointerup) in a mobile-emulated viewport: pick-up, live jiggle,
live reorder, and `localStorage` persistence all confirmed working. Also verified a short
swipe (moved before the hold lands) correctly does *not* trigger a pick-up.

**Also fixed in the same pass**: several controls measured 16–32px tall at 375px width —
well under the ~44px both Apple's and Google's guidelines call the minimum comfortable
touch target. Checkbox inputs, the budgeting tool's row-remove (`×`) button, document
visibility toggles, and Daily Report's tab buttons. Raised to 44px under
`@media (pointer: coarse)` (styles.css, end of file) — **keyed to input device, not screen
width**, so a touch laptop showing the full desktop layout benefits too, and a narrow
desktop window driven by a mouse is untouched. Also caught a related dead-zone: a checkbox
`<li>` row was already 44px tall, but the clickable `<label>` inside it was only 28px,
leaving 8px of silently-unresponsive padding top and bottom. Labels now `flex: 1` to fill
their row.

**Not yet re-verified live on an actual phone or a real finger** — everything above was
checked with viewport emulation and synthetic pointer events, which is a good proxy but
isn't the same as a real touchscreen. Worth a real-device pass before calling this closed.

---

## 6. First git repo for this project (local only — not pushed yet)

Per HANDOFF2 §12C, this was long-flagged as "the literal first step" before any
infrastructure work. Done tonight, but only halfway:

- `git init`, `.gitignore` (excludes `.DS_Store`, `.build-cache/`, the `.snapshot-before-*/`
  rollback folders, and `node_modules/`), and two commits — see `git log`.
- **Scanned for secrets before staging** (`.env`, credential, key, token patterns) — none
  found. `design-system/node_modules` (39MB) is the only thing of real size excluded;
  everything else, including `dist/mygoodbooks-dashboard.html` and the `design-system/`
  reference material, is tracked as-is.
- Author identity on these commits is the machine's local default
  (`holdengray@Holdens-MBP.home.local`) — cosmetic only, but worth setting to a real email
  before pushing if you want commits to link to your GitHub account's contribution graph
  (`git config user.email "..."`, then `git commit --amend --reset-author` on the last one
  if it matters retroactively).
- **No remote configured yet.** `git remote -v` is empty. This is the actual next step —
  see §8.

### A useful discovery: no build step needed for hosting

The root `index.html` (not `dist/mygoodbooks-dashboard.html`) already works as a
**zero-config static site** — it fetches `data.js`, `app.jsx`, and the DailyClose component
files via relative-path `fetch()` calls and Babel-transforms them in-browser, exactly like
the local dev server does. This means Vercel needs **no build command at all**: import the
repo, framework preset "Other," deploy. `dist/mygoodbooks-dashboard.html` (the fully-inlined
single-file build from `build.py`) stays useful for the Artifact-sharing workflow (§7) and
as an offline/portable copy, but it's not required for the live hosted site.

---

## 7. Artifact link — current as of end of session

Shared link unchanged: `https://claude.ai/code/artifact/ffe4688e-ddd4-459f-9662-a65937a2ffa2`
(favicon 📊, per HANDOFF3 §9 — keep passing no `favicon` param on republish to preserve it).

Republished three times this session: after the drag-direction fix (§3), after the jiggle
slowdown (§4), and again at the very end with the touch drag-and-drop + tap-target fixes
(§5). **This link and `dist/mygoodbooks-dashboard.html` in the git repo are both current**
— no gap between what's committed and what's shared going into tonight.

One thing to check when you open it: the last `read` on this Artifact came back **private**
(earlier in the session it read as "shared with anyone with the link"). Not investigated —
might just mean the share pin needs moving again from the Artifact's own share menu if you
want it link-shareable, per HANDOFF2's pinned-version note.

---

## 8. Exact next steps for tonight

In order:

1. **Push to GitHub.** Local repo is ready (§6); you need to either:
   - Create an empty repo at github.com/new (no README/gitignore) and hand me the URL, or
   - Run `gh auth login` yourself and tell me once it's done, so I can `gh repo create` +
     push in one step without you touching a browser.
2. **Import into Vercel** — vercel.com/new, pick the repo, framework preset "Other," no
   build command (§6). Deploy. Every push to `main` after that auto-deploys.
3. **Real-device touch check** — §5's fixes are verified via emulation, not a real phone.
   Worth 5 minutes on an actual iPhone/Android before calling the mobile work done.
4. **Check the Artifact's share state** (§7) if you need the link shareable again.
5. Once GitHub + Vercel are live, the Supabase conversation (auth + replacing `data.js`
   with real tables) is next — deliberately not started yet since it involves real schema
   and auth-model decisions worth walking through together rather than rushing at the end
   of a session.

---

## 9. Everything from HANDOFF3/HANDOFF2 that still applies, unchanged

Re-read those in full before infrastructure work — nothing below moved:

- File map, no-build/no-bundler mechanics for `index.html`'s dev-mode loading (HANDOFF2
  §2–5; still exactly how the root `index.html` behaves, per §6 above).
- The access model, `resolveAccess()`, `ORG_WIDE_TABS`, category-scoped dashboards
  (HANDOFF2 §6) — this is what `crossTabWidgetDefs()` in §2 above builds directly on top of,
  unmodified.
- `data.js` invariants — fund balances summing to net assets, `bankAccounts[].transactions`
  being a partial sample, not a full register (HANDOFF2 §8).
- The "Soft Glass / Ambient" visual redesign, scroll-gated chart animations (now bugfixed
  per §2 above, but the *design* is unchanged), number count-up, Report Builder, Enterprise
  Tools tier, and the live Daily Report — all HANDOFF3, all untouched today except where
  §2's `data-in-view` fix touched the reveal-animation plumbing underneath them.
- Known loose end from HANDOFF3 §9 (favicon) — still just "keep passing no `favicon` param,"
  unchanged.
- Still no answer on HANDOFF3 §12.3 (whether Report Builder's always-empty Q4 should be
  hidden from the dropdown) — untouched, still open.
