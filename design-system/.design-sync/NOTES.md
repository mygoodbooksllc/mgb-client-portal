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
