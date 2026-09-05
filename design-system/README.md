# mygoodbooks-ds

Reusable, presentational UI primitives extracted from the MyGoodBooks client
dashboard prototype (`../app.jsx`, a single-file React app with no build
tooling of its own). This package exists so a separate tool (Claude Design's
design-sync) can import and bundle these components independently of the
parent prototype.

Every component here started life inline in `app.jsx` and was ported to a
standalone `.tsx` file with explicit, typed props — no dependence on the
parent app's global state, context, or mock data shape beyond what's passed
in as props. Two components (`ToastProvider`) were already self-contained
in the original file; the rest (`Card`, `Button`, `Badge`) are new thin
wrappers synthesized from CSS classes (`.card`, `.btn-primary`/`.btn-secondary`,
`.badge-live`/`.badge-dot`) that were used ad hoc across many places in
`app.jsx` without a shared component.

## Components

- `MockBanner` — inline banner flagging a page as showing prototype/sample data.
- `RunwayRing` — circular progress ring (originally the Cash Runway KPI).
- `TrendPill` — pill showing a directional % change between two periods.
- `AccountCashDonut` — CSS conic-gradient donut of account balances + legend.
- `IncomeExpenseChart` — SVG filled-area chart of income vs. expenses over time.
- `ReportBarRows` — horizontal bar-chart rows with label/bar/amount.
- `Card`, `CardTitle`, `CardSubtitle` — glass-surface container + heading/subheading.
- `Button` — pill button, `variant="primary" | "secondary"`.
- `Badge` — status pill with a leading dot.
- `ToastProvider` (+ `useToast`) — toast notification context and stack.

## Usage

```bash
npm install
npm run build
```

Produces one ESM bundle per component in `dist/` (react/react-dom external),
a combined `dist/index.js` barrel, `.d.ts` declarations, and `dist/styles.css`
with the design tokens and component styles these components need.

## Styling

`src/styles.css` was extracted from the parent app's `../styles.css`: the
`:root` design-token block (including dark mode overrides) plus the full
ruleset for every class these components use. It intentionally is not
slimmed down surgically — if any extracted component uses a class, that
class's whole ruleset is included, even parts unused by these components, to
avoid subtly breaking a shared class.

## Notes / things a human should sanity-check

- `Badge`'s only real usage site in `app.jsx` is the "Prototype · Sample
  Data" pill in the page header. There's no second usage to confirm a
  `tone`/color-variant prop, so `Badge` only exposes `label` — it does not
  invent variants that weren't observed.
- `Card`/`Button` are synthesized wrappers around CSS classes used directly
  on plain `<div>`/`<button>` elements throughout `app.jsx` — there was no
  single canonical `Card` or `Button` component in the source to port, so
  the prop shape (`variant`, spreading native HTML attributes) is inferred
  from how those classes were used across many call sites (KPI cards, report
  cards, download/export buttons, modal actions).
- `IncomeExpenseChart`'s `monthly` prop type (`{ month, income, expenses }`)
  matches `client.monthly` in the parent app's mock data exactly.
