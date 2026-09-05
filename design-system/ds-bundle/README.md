## MyGoodBooks DS — build conventions

**No root provider required** for most components — they read only CSS custom
properties and props, no context. The one exception: any component that calls
`useToast()` must be rendered inside `ToastProvider`. Wrap once near your
app's root:

```tsx
import { ToastProvider, useToast } from 'mygoodbooks-ds';

function App() {
  return (
    <ToastProvider>
      <Dashboard />
    </ToastProvider>
  );
}
```

**Styling idiom: plain CSS classes + custom-property tokens, no CSS-in-JS.**
Every component ships its own class names (below) and reads color/spacing
from `var(--token)`. Don't invent new class names outside this vocabulary —
compose these instead.

Real class vocabulary (from `styles.css`):
`card`, `card-title`, `card-subtitle`, `btn-primary`, `btn-secondary`,
`badge-live`, `mock-banner`, `chart-wrap`, `bar-track`, `bar-fill`, `pill`,
`positive`/`negative`/`neutral`/`good`/`bad`/`over`/`under`/`compact`
(state/tone modifiers), `donut`, `donut-widget`, `donut-hole`,
`donut-center-label`, `donut-center-value`, `donut-legend`,
`donut-legend-row`, `donut-legend-value`, `legend-swatch`,
`runway-ring-card`, `runway-ring-wrap`, `runway-ring-center`,
`runway-ring-value`, `runway-ring-status`, `rb-bar-rows`, `rb-bar-row`,
`rb-bar-fill`, `rb-bar-amt`, `toast`, `toast-stack`.

Core design tokens (`var(--*)`, defined in `:root`, dark-mode aware via
`[data-theme]`): `--navy`, `--navy-deep`, `--gold`, `--gold-deep`, `--bg`,
`--surface`, `--surface-2`, `--border`, `--text`, `--text-muted`,
`--ink-strong`, `--hover-bg`, `--good`/`--good-soft`, `--bad`/`--bad-soft`,
`--accent`/`--accent-soft`, `--shadow`, `--shadow-hover`, `--radius`,
`--font-heading`, `--font-body`, `--font-mono`, `--sidebar-bg`,
`--sidebar-text`, `--sidebar-text-active`, `--sidebar-text-muted`. Use these
tokens rather than hardcoded colors when composing new layout around these
components.

**Fonts are NOT bundled** — the host app loads them at runtime via a Google
Fonts `<link>` (Bitter for headings, IBM Plex Sans for body, IBM Plex Mono for
numerals/mono). Include that `<link>` in the host page; don't expect
`@font-face` from this package.

**Where the truth lives**: `styles.css` (imports `_ds_bundle.css`, the real
compiled component CSS) and each component's own `.d.ts` for its prop
contract. Read those before styling — this summary is not exhaustive.

**Example — a KPI-style card using the real primitives:**

```tsx
import { Card, CardTitle, CardSubtitle, RunwayRing, Button } from 'mygoodbooks-ds';

<Card>
  <CardTitle>Cash Runway</CardTitle>
  <CardSubtitle>Grace Community Church</CardSubtitle>
  <RunwayRing pct={72} tone="good">7.2 months</RunwayRing>
  <Button variant="primary">View report</Button>
</Card>
```

Not part of this DS: `.kpi-card`/`.kpi-label`/`.kpi-value`/`.kpi-sub` are
app-only layout classes from the parent MyGoodBooks app, not shipped here —
don't assume they're styled.

# MygoodbooksDS (mygoodbooks-ds@0.1.0)

This design system is the published mygoodbooks-ds React library, bundled as a single
browser global. All 12 components are the real upstream code.

## Where things are

- `_ds_bundle.js` — the whole-DS bundle at the project root; loads every component to `window.MygoodbooksDS`. First line is a `/* @ds-bundle: … */` metadata header.
- `styles.css` — the single stylesheet entry: it `@import`s the tokens, fonts, and component styles (`_ds_bundle.css`). Link this one file.
- `components/<group>/<Name>/<Name>.prompt.md` (example JSX + variants), `<Name>.d.ts` (types), `<Name>.html` (variant grid).
- `tokens/*.css` — CSS custom properties, names verbatim from upstream.
- `fonts/` — `@font-face` files + `fonts.css` (when the package ships fonts).

For a specific component, `read_file("components/<group>/<Name>/<Name>.prompt.md")`.

## Loading

Add these two lines to your page once (React must be on the page first):

```html
<link rel="stylesheet" href="styles.css">
<script src="_ds_bundle.js"></script>
```

Components are then available at `window.MygoodbooksDS.*`. Mount into a dedicated child node (e.g. `<div id="ds-root">`), not the host page's own React root, so the two trees don't collide:

```jsx
const { AccountCashDonut } = window.MygoodbooksDS;
ReactDOM.createRoot(document.getElementById('ds-root')).render(<AccountCashDonut />);
```

## Tokens

42 CSS custom properties from mygoodbooks-ds. Names are
preserved verbatim from upstream. They are declared inside `_ds_bundle.css` (this DS ships one compiled stylesheet rather than separate token files).

- **color** (6): `--surface`, `--text-muted`, `--surface-2`, …
- **typography** (3): `--font-heading`, `--font-body`, `--font-mono`
- **radius** (1): `--radius`
- **shadow** (2): `--shadow`, `--shadow-hover`
- **other** (30): `--navy`, `--navy-deep`, `--gold`, …

## Components

### general
- `AccountCashDonut` — Donut chart (built with a CSS conic-gradient, not SVG) showing each
- `Badge` — Pill badge with a small leading status dot. Synthesized from the
- `Button` — Pill-shaped action button. Synthesized from the .btn-primary /
- `Card` — Generic glass-surface container used throughout the app for KPI tiles,
- `CardSubtitle` — Card subheading  renders a p classNamecard-subtitle directly below link CardTitle.
- `CardTitle` — Card heading  renders an h3 classNamecard-title, matching every usage site in app.jsx.
- `IncomeExpenseChart` — Filled area chart plotting income vs. expenses over a monthly series.
- `MockBanner` — Small inline banner used at the top of pages built on prototype/sample
- `ReportBarRows` — Small horizontal bar list  same visual language as the shared
- `RunwayRing` — Circular progress ring, originally built for the Cash Runway KPI. pct is
- `ToastProvider` — Provides useToast() to its subtree and renders the resulting toast
- `TrendPill` — Pill showing a directional  change between two period totals (e.g. this
