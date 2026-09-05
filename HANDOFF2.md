# MyGoodBooks — Session Handoff

*Last updated: 2026-08-31 (fourth revision, plus the demo landing-state change below)*

---

## 1. What this is

MyGoodBooks is a bookkeeping client-portal SaaS for churches and nonprofits. A bookkeeping
practice uses it to give each client organization a self-serve financial dashboard.

**Phase 1 (mock-data prototype, no backend) is functionally complete and polished.** The one
remaining Phase 1 item is stakeholder sign-off. After that the work is infrastructure: turning
this into a real hosted web app. It is explicitly **not** a desktop app — Tauri/Electron was
dropped from the roadmap in favour of shipping as a web app.

The app now carries its first **premium (paid add-on) feature — the Daily Report** — gated on a
per-client `plan` field. Its UI is finished and its headline figures are derived from each
client's real data; only its forecast and anomaly flags are still modelled in the browser.

---

## 2. Quick start

```bash
# Dev server (Browser pane): preview_start with {name: "client-dashboard"}
# -> runs .claude/serve.js on port 8420. Do NOT use python3 -m http.server.

python3 build.py            # bundle everything into dist/mygoodbooks-dashboard.html
python3 build.py --refresh  # same, re-downloading the pinned vendor libs
```

Editing `app.jsx` / `data.js` / `styles.css` is a refresh-the-browser workflow. There is no
compile step.

---

## 3. File map

Project root: `/Users/holdengray/Desktop/Mygoodbooks-app-code/client-dashboard/`

> The parent folder was renamed mid-project (it originally contained a colon:
> `Mygoodbooks:app code` → `Mygoodbooks-app-code`). Any colon-containing path you find
> anywhere is stale.

| File | What it is |
|---|---|
| `app.jsx` | Most React components. Single file, ~2,800 lines. |
| `data.js` | Mock data for 4 sample clients. |
| `styles.css` | All shell styling, both themes, chart animations. |
| `index.html` | Loads React/ReactDOM/Babel/jsPDF from CDN, transforms JSX **and TypeScript** in-browser. |
| `components/daily-close/` | Daily Report panel — see §7. |
| `build.py` | Bundles everything into one self-contained HTML file for sharing. |
| `.claude/launch.json` + `.claude/serve.js` | Local static dev server on port 8420. |
| `client-dashboard-claude-code-prompt.md` | Original brief + 5-phase roadmap (source of truth for phase definitions). |
| `dist/mygoodbooks-dashboard.html` | Build output (regenerated; safe to delete). |
| `.build-cache/` | Cached vendor libraries for `build.py` (regenerated; safe to delete). |
| `.snapshot-before-daily-close/` | Hand-rolled undo point (pre-Daily-Report). |
| `.snapshot-before-dark-mode/` | Hand-rolled undo point (pre-dark-mode). |

The two `.snapshot-*` directories exist only because there is no git. **Delete them once the
repo is initialized** (§12 C1).

The parent directory also holds two `Grace_Community_Church_*_transactions.csv` files. They are
not wired into the app and their origin is unclear — **don't delete without asking.**

**There is still no git repository anywhere in this project.** That is the literal first
infrastructure step.

---

## 4. How it's built (important)

There is **no build step and no bundler.** `index.html` fetches `data.js`, the three
`components/daily-close/` sources and `app.jsx` at runtime, transforms them in-browser with
Babel standalone, and injects them as `<script>` tags. Everything lives in the global scope —
no imports/exports.

**TypeScript is transformed at runtime too.** The Daily Report ships as `.ts`/`.tsx`, so the
loader adds Babel's `typescript` preset (types are stripped, never type-checked). Three traps:

- A plain `.ts` file must **not** also get the react/JSX preset — Babel rejects that pair.
- JSX is inferred from the `filename` passed to `Babel.transform`, so that filename must be
  accurate.
- `allExtensions` / `isTSX` were removed in current Babel. Don't reintroduce them.

Consequences:

- Two large files with no module system — **grep within them** rather than expecting a
  conventional component tree.
- Node.js is not installed / not used.
- **CDN gotcha:** jsPDF's autotable plugin must come from jsDelivr at the exact path
  `https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.4/dist/jspdf.plugin.autotable.min.js`.
  unpkg serves it without CORS headers (blocked), and the filename is *not*
  `jspdf-autotable.min.js`.

---

## 5. The 4 sample clients

| Client | Plan | Users |
|---|---|---|
| Grace Community Church | **premium** | Pastor John Whitfield (full), Rachel Delgado (scoped, Kids Ministry), Tom Reyes (scoped, Board Treasurer — tabs only, no category limits) |
| New Hope Fellowship | standard | Pastor Mia Ortiz (full), Kevin Nakamura (scoped, Worship & Media) |
| Riverside Food Pantry | **premium** | Dana Petrakis (full), Luis Moreno (scoped, 3 ops categories) |
| Open Arms Family Services | standard | Marcus Bell (full), Priya Raman (scoped, 2 program categories) |

Plus a `__bookkeeper__` view (MyGoodBooks, full access) that also exposes bookkeeper-only
controls. Previewing as a user **hides the client/preview switchers** — there's an "Exit
preview" banner to get back.

---

## 6. Access model (settled — don't "fix" this back)

`resolveAccess()` returns `tabs`, `categories`, `funds`, `isCategoryScoped`, and
**`isFullAccess`**. `isFullAccess` is *not* the same as `!isCategoryScoped` — Tom is tab-scoped
with no category limits but is still not full access. Use the explicit flag.

`scopeClientData()` narrows budget, transactions, funds, contributions, **and documents**.

- **Documents** carry `visibility: "all" | "full"` in `data.js`. `"all"` = anyone at the org
  with the Documents tab; `"full"` = full-access users only. Uploads default to `"all"` so the
  uploader can still see what they just added. In bookkeeper view the Documents table shows a
  "Visible To" column whose pill toggles it; clients never see that column.
- **Messages** are per-user. `client.messages` is gone; each client has `client.threads` keyed
  by user id — one private thread per person with MyGoodBooks. Live threads and read counts are
  keyed `"<clientId>::<userId>"` via `threadKeyFor()`. A signed-in person sees only their own
  thread; bookkeeper view gets a thread picker with a gold dot on threads awaiting a reply.

Category-scoped users get a different dashboard component entirely (`ScopedDashboardPage`),
which deliberately omits org-wide cash / revenue / runway. `ORG_WIDE_TABS` (bank, receivables,
reports, budgeting-tool, **daily-close**) are withheld from category-scoped users.

**Billing tier is a second, independent gate.** Each client carries `plan: "premium" |
"standard"`. `hasPremiumPlan()` is applied inside `resolveAccess()` — before any per-user
scoping, since an unsubscribed org has nobody who can see a premium tab — and again at the
render site. **Keep billing logic out of `<DailyClose />`; it has none by design.**

> **Access control is presentation-layer only.** All of it must be rebuilt as real backend
> enforcement before any real client data is involved.

---

## 7. The Daily Report

### Files

`components/daily-close/` — `DailyClose.tsx`, `DailyClose.css`, `types.ts`, `sampleData.ts`,
`fromClient.js`.

It arrived from a separate design session as a Next.js + CSS Modules component and was
**adapted, not rewritten**:

- CSS Modules aren't available without a bundler, so every class is prefixed `dc-` and the
  component maps `styles.foo -> "dc-foo"` through a `Proxy`.
- `DailyClose.tsx` and `sampleData.ts` are wrapped in IIFEs and publish to `window`, because
  all scripts share one global scope and `app.jsx` already declares `useState`/`useMemo` at top
  level.

### Naming (deliberate mismatch)

**The display name is "Daily Report"** — no leading "The". The route key (`daily-close`), the
`DailyClose` component, the directory and the `dc-` CSS prefix all keep their original names on
purpose; renaming them would churn the whole vendored component for a label change. Only three
strings are user-visible: the nav label and `PAGE_META` title in `app.jsx`, and the masthead in
`DailyClose.tsx`.

It is the **first item under Overview**, above Dashboard.

**The app opens on the Daily Report for Riverside Food Pantry** — `App()` initializes
`selectedClientId` to `"riverside-pantry"` and `page` to `"daily-close"` (changed 2026-08-31,
outside the session that wrote the rest of this document). This is a demo landing state: a
premium client, so the tab exists, opened straight onto the feature.

It degrades safely rather than by luck. `effectivePage = access.tabs.has(page) ? page :
ALWAYS_VISIBLE_KEY`, and `resolveAccess()` strips premium tabs for standard-plan clients — so
switching to New Hope or Open Arms lands on Dashboard, and the render site still double-checks
`hasPremiumPlan(client)`. The same fallback covers category-scoped users, for whom
`daily-close` is org-wide-withheld.

### Data

`fromClient.js` adapts a `CLIENTS` entry into the `DailyCloseData` contract in `types.ts`.

- **Derived exactly** from `data.js`, and therefore always reconciles with the rest of the app:
  cash (to the cent), receivables *including aging computed from real due dates*, payables,
  net income, the revenue/expense trend, and the expense breakdown.
- **Modelled** (standing in for the backend job that doesn't exist): the 90-day forecast and
  the anomaly list. Deterministic — seeded off client id, no randomness, so the panel doesn't
  change between reloads. The dip traces to the client's largest real payable; the anomalies
  come from real over-budget categories, matching the dashboard's own "Take Note" line. The
  panel states this in its methodology text.
- It **never sums `bankAccounts[].transactions`** — see §8.
- The sync chip reads *"Sample data — not connected to QuickBooks yet"*. The stock sample
  claimed "Synced with QuickBooks Online", which would contradict every other mock banner. That
  chip is also the only place the component renders its sample-data warning, so it can't simply
  be omitted.

`sampleData.ts` (Bramblewood Coffee Roasters) is kept for QA but is no longer rendered.

### Layout — container queries, not media queries

The panel was designed as a full-width route. Embedded here it sits in a ~590–630px column
beside the 260px sidebar, where its original `@media (max-width: 720px)` breakpoint never fires
and the four KPI tiles squeeze to ~128px — too narrow for a figure like "$210,720.55".

`.dc-dailyClose` declares `container-type: inline-size`, and rules at the end of
`DailyClose.css` reflow on the panel's **own** width: 4 tiles above 780px, 2×2 below, 1 below
400px, with the two-panel row stacking at the same breakpoint. The old viewport media query is
kept as a fallback. **Don't convert these back to media queries** — the viewport is the wrong
thing to measure here.

`.dc-page`'s `max-width: 820px` was also removed: it made this the only page that didn't fill
the content column, so on windows wider than ~1100px it looked conspicuously narrow next to
every other page.

---

## 8. `data.js` invariants

**Fund balances must sum to net assets** —
`sum(funds) === sum(bankAccounts.balance) − sum(payables.amount)`. Restricted funds are carved
*out of* the cash already in the accounts, never added on top. The unrestricted General Fund is
the balancing plug. Each `funds:` array has a comment stating its arithmetic. **If you change
any bank balance or payable, re-derive the General Fund.**

**`bankAccounts[].transactions` is a short sample, not a complete register.** For Grace it sums
to $34,060 of income while `monthly` (which drives the dashboard Revenue KPI and the chart) says
$63,500 for the same month. It also mixes July rows into August and has a `"Transfer In"`
category that is an inter-account transfer, not income. For anything spanning fields use the
source the UI already shows: `monthly` for period income/expense, `budget[].actual` for
expense-by-category, `bankAccounts[].balance` for assets. The PDF Profit & Loss and
`fromClient.js` both do this deliberately.

**Prose in the seeded threads quotes real figures** (Open Arms cites unrestricted cash) —
re-check those strings whenever balances change.

**Riverside's two threads deliberately end with a client message** (added 2026-08-31). A thread
counts as awaiting attention only when its *last* message is from the bookkeeper, so this is
what stops the chat widget and the nav badge from firing on load in the demo landing state
above. If you append a bookkeeper reply to Dana's or Luis's thread, the popup comes back.

---

## 9. Theming, typography and motion

### Dark mode (don't "fix" this back)

Follows the **device setting only** — one `@media (prefers-color-scheme: dark)` block right
after `:root` in `styles.css`. No in-app toggle. `<DailyClose />` is rendered with **no `theme`
prop** so it follows the same signal, and the two palettes are deliberately shared.

**The load-bearing detail:** `--navy` was doing two opposite jobs — dark *chrome* (sidebar,
`.btn-primary`, `.toast`, `.mobile-topbar`, avatars) and dark *ink* on light surfaces
(`.page-title`, `.kpi-value`, `.card-title`). Those flip in opposite directions, so the ink role
was split into **`--ink-strong`**, which in light mode is simply `var(--navy)` — light rendering
is unchanged. **Do not re-merge them**, and never point a background at `--ink-strong` or a
heading at `--navy`.

Supporting tokens: `--surface-2`, `--hover-bg`, `--muted-line`, `--sidebar-text-muted`,
`--warm-bg/-border/-text`, `--glass-bg`, `--glass-border`, `--tint-on-surface`,
`--chart-income`, `--selected-outline`, `--referral-bg`, `--referral-border`. Four fixed real
bugs rather than just tidying:

- `--chart-income` — the bar chart's income series was `var(--navy)`, i.e. chrome, which
  disappears against a dark card. (`fill="var(--token)"` *does* resolve in SVG presentation
  attributes here.)
- `--selected-outline` — the active tab ring was near-white and harsh on dark; gold there,
  unchanged navy in light.
- `--referral-bg` — the referral popup is frosted glass tinted *darker* than the cream page,
  which has no presence at all over a near-black page. Dark mode tints it **lighter** than the
  page instead. Apply the same thinking to any glass surface added later.
- `--glass-bg` / `--tint-on-surface` — same problem in the chat widget.

About a dozen hardcoded colours remain and are intentional: white text on navy or gold chrome,
correct in both themes.

**Known pre-existing low contrast in _light_ mode** (not caused by dark mode, left alone
deliberately): the gold portal greeting (~2.8:1) and the "Restricted" fund pill (~2.5:1).

### Typography

Shared with the Daily Report so the two halves read as one product: **Bitter** for display and
headings, **IBM Plex Sans** for body *and numbers*, **IBM Plex Mono** for small tabular figures.

That mapping is why `.kpi-value`, `.fund-balance`, `.donut-center-value`,
`.account-tab-balance` and the avatars use `--font-body` rather than `--font-heading` — the
component keeps its KPI numbers in Plex Sans, not the serif. **Lato is gone.** One combined
Google Fonts request in `index.html` / `build.py` covers both halves; the shell additionally
needs Bitter *italic* and weight *800*, which the component alone never requested.

### Visual direction

"Bold & Elevated" — navy `#243746` / gold `#c7ae86` on cream `#faf9f6`, pill buttons, bold
tight-tracking headline numbers. Dark mode keeps gold as the brand accent and swaps the cream
base for `#0f1512`.

**Cards are outlined** (`1px solid var(--border)` on `.card`) to match the Daily Report's tiles
and panels. This supersedes the original "borderless floating cards" direction. The shell keeps
its own warmer `--border` rather than the panel's cooler `--line`, so the outline stays in the
shell's palette in both themes.

### Chart animations

Charts wipe in left-to-right; bars grow from zero, cascading down their list; sparklines stagger
across the KPI row; the donut rotates in; anomaly rows rise in sequence.

Pure CSS keyframes on mount, so they replay whenever a page is opened (React swaps the page
component on every nav change) and whenever a Daily Report Outlook tab is switched (those
branches mount/unmount conditionally — **verified they do not need `key` props**). Every rule
sits inside `@media (prefers-reduced-motion: no-preference)`.

The wipe uses `clip-path` with **negative insets on three sides**
(`inset(-50% 100% -50% -50%)` → `inset(-50%)`) so only the right edge sweeps. A plain
`inset(0 0 0 0)` would permanently clip the axis labels, end markers and low-point dot that the
charts deliberately draw outside their own box via `overflow: visible`. **If you add a chart,
keep that pattern.**

---

## 10. Patterns to follow

- **Key per-client component state by client id.** Any component holding a draft/filter/form
  must get `key={"something-" + selectedClientId}` at its render site. `ChatWidget` lacked this
  and a message draft typed for one church was delivered into another org's thread. Watch for
  `useState` in components rendered outside `<main>` (floating widgets, modals).
  *Counter-example:* the sidebar's collapse state is deliberately **not** keyed — it's a viewer
  preference, not client data, so it should survive switching organizations.
- **Use `todayLocal()`, never `new Date().toISOString().slice(0,10)`.** The latter returns the
  *UTC* date while `fmtDate` parses it back as local — west of UTC that stamps anything after
  ~7pm with tomorrow's date. `fromClient.js` has its own local-date parser for the same reason.
- **Every colour goes through a token defined in BOTH theme blocks.** Never hardcode a hex on a
  rule that renders on a themed surface.
- **Restate `display: none` for `[hidden]`.** A rule like `.nav-section-items { display: flex }`
  outranks the browser's `[hidden]` default, so the attribute silently stops hiding anything.
  Pair any such rule with `.thing[hidden] { display: none; }`.
- **Don't re-assert UI state from an effect that depends on navigation.** The chat widget's
  auto-open ran on every `effectivePage` change and unconditionally set the flag, so dismissing
  it only lasted until the next tab click.
- **Mobile tables.** `.tx-table` is shared by six tables with different column counts. To make
  one fit on phones, add `tx-table-stack` plus a modifier mapping its cells to grid areas (see
  `.tx-stack-bank`, `.tx-stack-giving`). Don't restyle `.tx-table` directly.
- Grid/flex children containing wide tables need `min-width: 0`, or the card grows past the
  viewport instead of letting `.table-scroll` scroll.

---

## 11. What changed today (2026-08-30)

### Daily Report shipped

A premium one-page financial snapshot: cash position, AR/AP, revenue-vs-expense trend, and an
Outlook panel toggling between cash-flow forecast, revenue trend and anomaly flags. Integrated
per §7 — adapted from a Next.js/CSS-Modules component, gated behind a new `plan` field, and
added to `ORG_WIDE_TABS` so category-scoped users never see it.

Then, across the day: **per-client data** (`fromClient.js`, replacing the Bramblewood sample),
**renamed** to "Daily Report", **moved above Dashboard** in the nav, **container-query layout**,
and the **820px width cap removed**.

### Dark mode across the whole app

Device-setting driven, with the `--navy` ink/chrome split described in §9. Included fixing the
referral popup and chat widget, whose translucent surfaces vanished against a dark page.

### Unified typography and outlined cards

Lato replaced with Bitter / IBM Plex Sans / IBM Plex Mono, matching the Daily Report's role
assignment. `.card` gained a 1px outline to match the panel's tiles.

### Chart animations

Wipe-in and grow-from-zero entrances, replaying on load and on every tab switch, all gated
behind `prefers-reduced-motion`.

### Collapsible sidebar sections

Overview / Finances / Client Tools headers are real `<button>`s with `aria-expanded` +
`aria-controls` and a rotating chevron. A collapsed header containing the current page turns
gold, and any unread badge inside rolls up onto the header — so collapsing never hides where you
are or that a reply is waiting.

### Three real bugs fixed

1. **Chat widget reopened on every tab click** after being dismissed. Two compounding causes:
   the effect re-asserted `open` on each navigation, and in bookkeeper view `closeChatWidget`
   marks only the *active* thread read while `hasUnreadMessages` means "any thread at this org"
   — with three people at Grace it never cleared. Auto-open now fires once per unread
   *signature* and keeps a `Set` of what it already offered.
2. **Unread badge never cleared.** Bookkeeper view opened `clientUsers[0]`'s thread, but the
   badge is raised by *any* waiting thread — at Grace only Rachel's qualified. So you'd open
   Messages, mark John's already-read thread read, and the badge would persist. Bookkeeper view
   now defaults to the first *unread* thread (an explicit picker choice still wins), and the
   read-marking effect keys off `effectivePage` rather than `page`.
3. **`build.py` didn't know about `components/daily-close/`** and would have shipped a Daily
   Report tab that white-screens. It now inlines all three sources, compiles them with the right
   presets in the right order, and loads the consolidated font request.

### Decision recorded

The **900ms canned auto-reply in Messages stays** — not a concern for the demo.

---

## 12. Next steps

### A. Before stakeholder sign-off

1. **Fix the shared link's pinned version** — see §13. *Only you can do this; it's a browser
   step.* Right now viewers get an old build no matter how often the artifact is republished.
   The alternative is publishing to a fresh, unpinned artifact URL.
2. **Manual click-through of the app.** Verification this session was heavily data-level
   (DOM measurements, contrast ratios, per-client assertions) plus spot-check screenshots,
   because the preview pane's screenshot capture is unreliable (§14). A human pass in a real
   browser is still worth doing.
3. **Decide the New Hope forecast story.** Their 90-day cash line dips **below zero** —
   arithmetically correct for an org running −$1,700/month against $4,820 of cash, and arguably
   a good illustration of the feature's value, but check it's the story you want in a demo.
   They're on the standard plan so the tab is hidden today; it appears the moment they're
   flipped to premium.

### B. Cheap polish, highest value first

1. **Add a React error boundary.** There is still none, so a single component error blanks the
   entire page. This is the highest-value small fix in the app.
2. **Message timestamps.** Messages have a date but no time, so several same-day messages all
   read "Aug 29" with no ordering cue.
3. **Multi-line message composer.** It's a single-line `<input>`; Enter can't insert a newline.
4. **Optimistic-send failure/retry path.** Fine while mocked, needed with a real backend.

### C. Infrastructure build-out — strict order, each depends on the previous

1. **`git init` + push to GitHub.** Then delete the two `.snapshot-*` directories.
2. **Install Node.js, scaffold a real Vite + React project**, migrate `app.jsx` / `data.js` /
   `styles.css` / `components/daily-close/` into it with real imports/exports instead of loose
   globals. The Daily Report files revert almost exactly to their original Next.js form: restore
   the CSS Module, drop the `styles` Proxy and the IIFE wrappers, restore the imports/exports.
   **Delete `build.py` at this point.**
3. **Connect Vercel** to the GitHub repo.
4. **Create the Supabase project**, design the schema, wire keys into Vercel env vars.
5. **Create a Google Cloud project**, enable the Drive API, create a service account, set up
   per-client folders.

Phase 2 (QuickBooks OAuth) and Phase 3 (Plaid) are **blocked** until the above exists —
QuickBooks OAuth specifically needs a real hosted domain to redirect to.

### D. Follow-on feature work

- **Replace `fromClient.js` with a real backend job** computing the forecast, anomaly flags and
  aging buckets per client. `components/daily-close/types.ts` is the contract to produce.
- **Attachments are metadata only** (name + size); no file is retained and nothing opens. Route
  these through the same Google Drive path as Documents rather than inventing a second
  mechanism.
- **Rebuild access control as real backend enforcement** before any real client data lands.

---

## 13. Sharing the build

**Shared link:** `https://claude.ai/code/artifact/ffe4688e-ddd4-459f-9662-a65937a2ffa2`
Already shared with anyone who has the link.

> **⚠️ Viewers see a pinned earlier version, not the live one.** Republishing updates the live
> version but does **not** move the pin, so everyone with the link keeps getting an old build.
> The pin is changed from the artifact page's own version/share menu — a manual browser step
> that the build and publish flow cannot do. Either re-pin to the latest version, turn pinning
> off, or publish to a fresh artifact URL.

**To update it:** run `python3 build.py`, then publish `dist/mygoodbooks-dashboard.html`
passing that URL as `url` so it redeploys in place instead of creating a second artifact. Keep
the title `MyGoodBooks` and the 📗 favicon stable — viewers find the tab by them.

**About `build.py`:**

- Needs only Python 3 — no Node/npm, deliberately.
- Inlines the vendor libraries, `app.jsx`, `data.js`, `styles.css`, the three
  `components/daily-close/` sources and `logo.webp` into one file whose **only external request
  is the Google Fonts stylesheet** — the single host a published Artifact's CSP allows. It
  cannot fetch sibling files at all.
- Sources are base64-encoded rather than pasted inline, since a stray `</script>` inside a
  minified library or a JS string would otherwise terminate the surrounding tag.
- Vendor libs are cached in `.build-cache/`; use `--refresh` to re-download.
- It **pins Babel (7.24.7)** while `index.html` uses whatever is current, so **verify a build in
  the browser rather than trusting the dev server** — the pinned copy has to carry the
  `typescript` preset the Daily Report needs. It does, as of this build.
- JSX/TS are still transformed at runtime, same as `index.html` — that keeps the script
  dependency-free, at the cost of ~2.9MB of Babel and ~1s of startup.
- Output is ~4.6MB, well under the 16MB Artifact limit.

---

## 14. Environment gotchas

- **The preview pane mis-composites screenshots** taken in the same batch right after a long JS
  wait or a programmatic scroll — content renders blank or ghosted even though the DOM is
  correct. Take the screenshot in its own round-trip, and confirm layout with DOM measurements
  rather than trusting a suspicious capture. This cost real time twice today; both "bugs" turned
  out to be capture artifacts.
- **The console buffer persists across navigations**, so stale errors from an earlier reload can
  look like current failures. Confirm against live state before chasing one.
- **Watch your selectors when testing.** Two false results today came from `querySelector`
  grabbing the wrong element (the global search box instead of the message composer; the
  always-mounted revenue chart instead of the Outlook one).

---

## 15. Memory files

`/Users/holdengray/.claude/projects/-Users-holdengray-Desktop-Mygoodbooks-app-code-client-dashboard/memory/`
— `MEMORY.md` is the index. Covers the build setup, data invariants, the access model, the
client-keyed-state pattern, the dark-mode token roles, the Daily Report integration, and the
preference for reversible/snapshotted experiments.
