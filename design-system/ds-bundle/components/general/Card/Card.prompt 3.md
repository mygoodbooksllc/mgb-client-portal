Card from mygoodbooks-ds. Use via `window.MygoodbooksDS.Card` (bundle loaded from the root `_ds_bundle.js`).

Generic glass-surface container used throughout the app for KPI tiles,
page sections, and grid items. Synthesized from the `.card` class shared
by dozens of `className="card"` divs in app.jsx — this is not a single
original component but the canonical wrapper for that pattern.

## Props

```ts
interface CardProps {
  children?: React.ReactNode;
  className?: string;
  id?: string;
  style?: React.CSSProperties;
}
```

## Examples

### Default

```jsx
() => (
  <Card style={{ width: 320 }}>
    <CardTitle>Recent Activity</CardTitle>
    <CardSubtitle>Transactions in your areas</CardSubtitle>
    <p style={{ margin: '12px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
      Aug 24 · $500.00 · General Operating
    </p>
  </Card>
)
```

### Report

```jsx
() => (
  <Card style={{ width: 320 }} className="report-card">
    <CardTitle>Monthly Financial Statement</CardTitle>
    <CardSubtitle>Income statement, balance sheet, and cash flow for the current month</CardSubtitle>
  </Card>
)
```

### SubtitleOnly

```jsx
() => (
  <Card style={{ width: 320 }}>
    <CardTitle>Fund Balances</CardTitle>
    <CardSubtitle>What the money in the bank is designated for</CardSubtitle>
  </Card>
)
```

## Related

`CardSubtitle`, `CardTitle`
