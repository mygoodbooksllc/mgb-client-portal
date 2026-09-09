# MyGoodBooks — Session Handoff (6, concise)

*Written 2026-09-07. Read HANDOFF5.md for the infra rollout (GitHub → Vercel →
app.mygoodbooks.org → Squarespace link) and HANDOFF4.md for the dashboard customization and
drag-and-drop work. This session was a full QA pass plus the fixes that came out of it, so
this is the punch list — what changed, why, and what's still open.*

---

## Done this session

**Full QA pass** — desktop 1440, tablet 768, mobile 375 with touch emulation, dark and
light, run against both localhost and the live site. Everything below came out of it.

- **Dark mode is now the default** (your call). Light is opt-in via the sidebar toggle and
  persists in localStorage. The app no longer follows the OS setting at all. `index.html`
  pins `data-theme` in a `<head>` script *before* any stylesheet loads, so a light-OS
  machine doesn't flash the light palette during boot; the React effect keeps it in sync
  after mount and never removes the attribute.

- **Boot time: ~25-30s blank screen → about a second.** This was the worst thing found and
  it was live. `index.html` awaited each source serially — fetch *and* Babel compile, one
  file at a time — so on production `app.jsx` wasn't even *requested* until 17.5s in, and
  `#root` was still empty at 22.5s. All five sources are now fetched in parallel from
  `<head>` (they land by ~220ms) and compiled in dependency order. jsPDF is `defer`red since
  it's only needed on a Download click; undeferred it was blocking React and Babel from
  executing. A branded splash covers whatever boot time is left, so the page is never a
  blank black rectangle.

- **"Cash Runway" was reporting 184.9 months (15 years).** The old `avgMonthlyBurn` summed
  only the deficit months (`max(expenses - income, 0)`) and divided by *all* months, so
  Riverside's single $2,700 shortfall in six months became $450/mo, and the two clients that
  never ran a deficit divided by zero and fell through to a bare "Healthy". Replaced with
  **months of operating reserve** (cash ÷ average monthly expenses), the standard nonprofit
  measure. Riverside now reads 3.4 mo; all four clients give differentiated numbers
  (4.1 / 0.5 / 3.4 / 2.0) and the under-3-months alert actually fires for the two that
  warrant it, where before it fired for nobody. Ring fills against a 6-month target.
  Renamed to "Operating Reserve" in the KPI, the widget picker and Report Builder.

- **Payables "Amount" column was cut off at full desktop width.** `.tx-table`'s 480px
  min-width overflowed the 415px Payables card, hiding the amounts behind an `overflow-x`
  scrollbar macOS doesn't draw. Lowered to 360px, which fits the narrowest card.

- **Six of eight tables scrolled sideways on phones.** Only Bank and Giving had opted into
  the existing restacking rule; Budget vs. Actual was hiding Variance and % Used, the two
  columns that page exists for. Added a label-based stacking mode for the rest — it keys off
  `data-label` rather than `nth-child`, deliberately, because the Documents table drops its
  "Visible To" column for non-bookkeepers and an index-based mapping would break there.

- **Modals had no keyboard or screen-reader support at all** — Escape did nothing, focus
  stayed behind the scrim, Tab walked the page underneath, nothing announced a dialog.
  A grep for Escape/keydown/`role="dialog"`/`aria-modal`/autoFocus across `app.jsx` returned
  zero matches. Added a shared `ModalShell` (app.jsx) providing Escape-to-close,
  `role="dialog"`/`aria-modal`, focus moved in on open, a Tab trap, and focus restored to
  the trigger on close. All three modals go through it. **Anything new that puts a modal on
  screen should use it too.**

- **Search dropdown was being painted over by the cards below it** (you spotted this). Two
  commits: the layer fix, then the root cause. `.global-search` carried the `.card` class
  purely for the glass surface, but `.card` is written for tiles that never draw outside
  their own box — and the dropdown does exactly that. It caused four separate bugs:
  `overflow:hidden` clipped the dropdown and made it unclickable (patched in an earlier
  session); overriding that to `visible` then let `.card::after`'s shimmer — 131px tall on a
  53px bar — spill ~39px past the rounded corners; `backdrop-filter` creates a stacking
  context, trapping the dropdown's `z-index` inside the bar so the content cards below (also
  backdrop-filtered, also `z-index:auto`) won on DOM order; and `.card:hover` lifted and
  scaled the whole search bar like a tile. `.global-search` now takes the surface it wants
  and none of the rest, and carries the `z-index: 800` layer itself. **`.card` is untouched
  — don't re-add it to the search bar.**

- **Smaller fixes:** touch targets raised to 44px (hamburger, drawer close, nav rows, theme
  toggle, selects) and consolidated into the existing `@media (pointer: coarse)` block; the
  mobile drawer now scrolls as one column instead of hiding Messages and Documents behind a
  short inner scrollbar; "+ Add Category" no longer overflows its card (`.add-category-row`
  had no `flex-wrap` and its input no `min-width: 0`); select text no longer collides with
  its chevron; the count-up no longer respins every stat on every tab change and uses a
  uniform duration instead of a random one per number (see the entry below); the theme
  toggle is labelled in client view
  instead of floating alone; and the `dangerouslySetInnerHTML`-to-decode-an-ampersand hack
  is gone.

- **Count-up regression, caught and fixed after the first push.** Scoping the animation to a
  2000ms window measured from effect mount worked locally and silently killed it in
  production: a cold load saturates the main thread right after mount, IntersectionObserver
  callbacks are only delivered once that work lets go, and past the deadline every number
  rendered flat. It's now gated on navigation instead — armed for the page the viewer lands
  on, disarmed the moment they navigate away — so nothing depends on how long first paint
  takes. **Don't reintroduce a time-based gate here.**

- **The tab now survives a refresh.** `page` is persisted to `mygoodbooks_page_v1` and
  restored on load, validated against the known tab keys. The raw choice is stored rather
  than the rendered one, so a bookkeeper previewing as someone without access to that tab
  still gets it back on exiting the preview; the existing `effectivePage` guard handles
  rendering a tab the current viewer can't see.

- **`build.py` now mirrors index.html's theme bootstrap.** The bundle doesn't use
  index.html, so the single-file build had no `data-theme` until React mounted — on a
  light-OS machine that meant the light palette showed until Babel finished compiling.

---

## Verified working (checked, no action needed)

- Fund balances reconcile exactly: cash $83,201 − payables $4,180 = $79,021 in funds.
- All four report PDFs generate (correct filenames, no errors) — still true with jsPDF
  deferred, which was the main risk of that change.
- Budgeting Tool math, global search (opens, correct hits, navigates, clears).
- **Per-client message drafts do not leak across organizations** — the regression from
  HANDOFF4 still holds.
- Access scoping as Luis: nav filtered, bookkeeper switchers hidden, "Budgeted (your areas)"
  $12,700 = exactly his three categories.
- Dark mode: zero WCAG AA contrast failures across all text.
- No horizontal page scroll and no hidden side-scrolling containers at 375 / 768 / 1440, on
  all 11 pages.

---

## Full to-do list

- [x] ~~Republish the Artifact and rebuild `dist/`.~~ Both done — `python3 build.py`
      regenerates the bundle, and the Artifact
      (`https://claude.ai/code/artifact/ffe4688e-ddd4-459f-9662-a65937a2ffa2`) was
      republished to the same URL. **Re-run both after any future change**; neither updates
      itself, and the live site deploying is not the same as these being current.
- [ ] **Real-device touch check** — still outstanding from HANDOFF5, and now there's more to
      check: the touch drag-and-drop fix plus the new 44px targets, single-scroll drawer and
      stacked tables were all verified via emulation, not a real finger.
- [ ] **Light-mode contrast on the gold text.** Couldn't be measured — the page background is
      painted by a decorative mesh layer rather than element backgrounds, so computed
      ratios come out meaningless. Visually the gradient "Enterprise Tools" nav items and the
      gold "RIVERSIDE FOOD PANTRY" label look washed out on cream. Needs an eye, not a script.
- [ ] **`Your Funds` in scoped client view** shows $79,021, the org-wide fund total, to a
      limited-access user. Pre-existing and possibly intentional, but it sits oddly next to
      the comment in `ScopedDashboardPage` saying org-wide figures aren't theirs to see.
      Worth settling when the real access model lands.
- [ ] **Supabase conversation** — auth + replacing `data.js` with real tables. Unchanged from
      HANDOFF5: worth walking through properly rather than rushing at the end of a session.
- [ ] **Receipt-capture / document digitization** — still parked, no decision. The fork is
      unchanged: (1) capture + attach as a plain document, (2) capture + canned extraction,
      (3) real in-browser OCR via Tesseract.js.

---

## State as of this handoff

- Local git: 14 commits, working tree clean, `main` pushed and tracking `origin/main`.
  This session added five: `e312119` (dark default + QA fixes), `07bf3e7` (search dropdown
  layer), `c0140f8` (search bar stops inheriting `.card`), `a895e17` (count-up regression
  fix, caught after the first push — see the entry above), and `7abf78a` (tab survives a
  refresh).
- **Live and verified at app.mygoodbooks.org** — loaded the production site after each push
  and confirmed the behaviour there, not just that the files deployed.
- Note: the browser will happily serve a cached `index.html` even though that file
  cache-busts `styles.css` on every load. This cost time during the session — a change
  looked like it hadn't deployed when it had. Hard-refresh before concluding a fix is broken.
- QuickBooks/Supabase: still not connected; the "not connected to QuickBooks yet" badges in
  the UI remain accurate.
- `mygoodbooks.org` root domain on Squarespace: untouched, as before.
