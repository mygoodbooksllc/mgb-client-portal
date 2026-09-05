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
