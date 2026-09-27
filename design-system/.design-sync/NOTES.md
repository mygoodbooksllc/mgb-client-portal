# NOTES

## Fixes applied during preview authoring (this sync)

- **`src/styles.css` had two unclosed `{` blocks** that silently swallowed
  every rule after them (CSS parser recovery consumes subsequent balanced
  rule-blocks as "bad declaration" content of the still-open block, so they
  never actually apply):
  - `.legend-swatch` (~line 284) was missing its closing `}` before the
    "Bar / Pill" section comment — this broke `.bar-track`, `.bar-fill`,
    `.pill`, `.rb-*`, `.mock-banner`, and `.btn-*` until the next fix below.
  - `.btn-secondary:hover` (~line 379) was also missing its closing `}`
    before `.btn-primary:disabled` — this broke `.runway-ring-*`,
    `.donut-*`, and `.toast-*`.
  - The file also **ended mid-`@keyframes toast-in`**, missing the `to {}`
    state and the block's closing `}`. Restored from the matching block in
    the app's own `client-dashboard/styles.css` (the two files share this
    section verbatim).
  - These were real bugs in the shipped stylesheet (not preview-only) —
    `dist/styles.css` is a straight copy of `src/styles.css`, so every
    consumer of the DS package was silently getting unstyled buttons,
    pills, bar rows, mock banners, runway rings, donuts, and toasts. Fixed
    at the source and re-verified: `npm run build` → `package-build.mjs` →
    `package-validate.mjs` (0 warnings) → `package-capture.mjs` (all 12
    components carried forward with the fix already baked in).
  - **Re-sync risk**: if `src/styles.css` gets hand-edited again, re-check
    brace balance (`python3 -c "print(open('src/styles.css').read().count('{') - open('src/styles.css').read().count('}'))"` should print 0) before
    trusting a "clean" validate — a broken stylesheet still produces a
    bundle that builds and renders (browsers silently drop the corrupted
    rules), so `package-validate.mjs`'s render check alone won't catch it.
    Only the contact-sheet eyeball caught this originally.

## Known render warns

- None outstanding — final `package-validate.mjs` run is 0 warnings, 12/12
  render cleanly.

## Grid overrides

- `AccountCashDonut`, `Card`, `CardSubtitle`, `CardTitle`,
  `IncomeExpenseChart`, `ReportBarRows`: `cardMode: column` (wide multi-export
  cards that were cropped by the default grid).
- `ToastProvider`: `cardMode: single`, `primaryStory: WithToast` — the toast
  is `position: fixed`, so no grid layout can contain it; single-card mode is
  exempt from the grid-overflow check by design.

## kpi-* classes are NOT part of the DS

`.kpi-card`, `.kpi-label`, `.kpi-value`, `.kpi-sub`, `.kpi-grid` appear all
over `app.jsx` but are **not defined anywhere in `src/styles.css`** — they're
raw app-level layout classes, not DS component styles. Previews were written
to avoid them (e.g. `RunwayRing`'s preview uses `Card` + `.runway-ring-card`
only, dropping the `kpi-card`/`kpi-label`/`kpi-sub` wrapper markup from the
real call site) since applying them made cards look broken/unstyled through
no fault of the preview. If the DS ever adds a real `KpiCard` component,
source its styling from `app.jsx`'s inline `.kpi-*` CSS (in the parent
`client-dashboard/styles.css`, not this package) rather than assuming it's
already shipped here.

## 2026-09-22 re-sync (calm redesign + icons)

- **Styles are a manual copy of the app's.** `src/styles.css` was brought up
  to the app's calm redesign by merging, per selector, the final cascaded
  declarations from `client-dashboard/styles.css` into every rule this file
  already defines (tokens in all three `:root` blocks, `.card`, `.card::after`,
  `.btn-*`, `.donut-*`, `.runway-ring-value`, `.toast*`, `.icon-inline`);
  `.card:hover` was dropped because the app removed it. In-body comments in
  the rewritten rules were lost. Brace balance checked (0).
- **Icons**: 30 `*Icon` components + `IconGallery` were added to the package
  after the Sep 2 sync. Each icon has an authored preview
  (`previews/<Name>Icon.tsx`: `Sizes`, `Tones`, `InButton`), generated from
  one template, so they are uniform. Icon previews and `IconGallery` use
  `cardMode: column`; the `Tones` row was clipped in the 3-up grid.
- **Environment**: the Sep 2 sync ran on Linux; its `node_modules` (DS and
  `.ds-sync/`) had Linux esbuild binaries and failed on macOS. Fix:
  `npm ci` here and reinstall `.ds-sync` deps (`esbuild ts-morph
  @types/react playwright`). There is no Playwright browser cache on this
  Mac: set `DS_CHROMIUM_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"`
  for validate/capture/resync.
- **Git**: `ds-bundle/` and `.ds-sync/` had been committed; they are
  regenerated output and are now gitignored.

## Re-sync risks

- `src/styles.css` drifts whenever the app's `styles.css` changes; nothing
  enforces the copy. Re-run the per-selector merge (or diff the `:root`
  blocks) before each sync.
- A new icon added to `src/` needs its own `previews/<Name>.tsx` (copy any
  existing icon preview, change the import and label) plus a
  `cardMode: column` override, or it ships a near-blank floor card
  (`[RENDER_BLANK]`).
- `conventions.md` names icon components and the `RunwayRing` `pct`
  fraction; re-validate those names against the build on every sync.

## 2026-09-27: new target project "MyGoodBooks"

- The old Claude Design project "MyGoodBooks Design System"
  (`b5c754f7-266e-4cf2-98a4-f1445fca1cc8`) is **retired** — never sync to it.
- New target: "MyGoodBooks" (`96865ffb-efaf-4fd2-8e6d-4665a5d3332f`), created
  for a fresh first import. The written brand guide comes from the
  "MyGoodBooks" Design System artifact (claude.ai/artifact/ARYpfcrCbFgFxJnbm1xqLx),
  which was itself read out of this package after the calm redesign.
- First import into the new project finished 2026-09-27: 43 components,
  all previews authored and graded good, render check 43/43, 223 files.

### Fixes this run

- **Fonts now ship.** `src/styles.css` starts with a Google Fonts `@import`
  (Bitter / IBM Plex Sans / IBM Plex Mono, same weights as the app's
  `index.html`) and ends with a `body` rule (`var(--font-body)`,
  `var(--text)`). Before this, designs fell back to Times/system fonts
  because the package relied on the host app's `<link>`.
  `runtimeFontPrefixes` was removed from the config; validate now reports
  `[FONT_REMOTE]` (informational, expected).
- **Tokens added** from the app: `--on-gold`, `--on-gold-deep`, `--grid-line`,
  `--grid-cell-w`, `--grid-cell-h` (all three `:root` blocks as the app has them).
- **`cardMode: column`** added for `Button`, `MockBanner`, `RunwayRing`,
  `TrendPill`: their third cell was clipped at the card's right edge in the
  3-up grid. Validate did NOT flag it (no `[GRID_OVERFLOW]`); only the contact
  sheet showed it.
- **Brand guide** ships as `guides/brand-guide.md` (default `guidelinesGlob`
  picks it up → `guidelines/guides/brand-guide.md`). Copied from the
  MyGoodBooks artifact's `project/README.md` minus its "Not synced" section.
- `conventions.md`: fonts paragraph corrected (fonts now load from
  `styles.css`) and a pointer to the brand guide added. Every class, token and
  component it names was re-verified against the build.

### Environment (macOS, Desktop is iCloud-synced)

- iCloud keeps creating `"<name> 2"` / `"<name> 3"` copies inside
  `node_modules` while you work. `tsc` auto-loads every `@types/*` folder and
  failed on `react 3`; `tsconfig.json` now pins `"types": ["react","react-dom"]`.
  If the build breaks on odd duplicate names again, `npm ci` here and
  `npm i esbuild ts-morph @types/react playwright` in `.ds-sync/` (create
  `.ds-sync/package.json` first if it's missing).
- Playwright's own browser isn't installed; always set
  `DS_CHROMIUM_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"`
  for validate, capture and resync (capture fails without it too).
- A stale `ds-bundle/` without `_ds_bundle.js` trips `[OUT_UNSAFE]`; the old
  one was moved to `Mygoodbooks-app-code/ds-bundle.stale-2026-09-22`.

## Re-sync risks (updated 2026-09-27)

- `src/styles.css` is still a manual copy of the app's `styles.css`; nothing
  enforces it. Diff the `:root` blocks before each sync.
- The brand guide is a copy of the artifact's README; if the artifact changes,
  re-copy it.
- The Google Fonts `@import` is network-fetched at render time; if Google
  Fonts is unreachable, designs fall back to system fonts.
- Grades for 42 components were carried forward from the Sep 22 sync (their
  preview sources didn't change); they were eyeballed on this run's contact
  sheets after the font change.
