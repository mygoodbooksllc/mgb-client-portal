RunwayRing from mygoodbooks-ds. Use via `window.MygoodbooksDS.RunwayRing` (bundle loaded from the root `_ds_bundle.js`).

Circular progress ring, originally built for the Cash Runway KPI. `pct` is
0-1; `tone` picks the good/bad color via the --good/--bad design tokens so
it stays in sync with the text tone used alongside it.

## Props

```ts
interface RunwayRingProps {
  /** Ring fill fraction from 0 to 1 (e.g. months of runway / 12, clamped). */
  pct: number;
  /** Which color pairing to use — "negative" draws from --bad/--bad-soft, anything else from --good/--good-soft. */
  tone?: string;
  /** Content rendered in the center of the ring (typically a value + status label). */
  children?: React.ReactNode;
}
```

## Examples

### Positive

```jsx
() => (
  <Card className="runway-ring-card" style={{ width: 220 }}>
    <RunwayRing pct={0.78} tone="positive">
      <div className="runway-ring-value">9.4 mo</div>
      <div className="runway-ring-status positive">Healthy</div>
    </RunwayRing>
  </Card>
)
```

### Negative

```jsx
() => (
  <Card className="runway-ring-card" style={{ width: 220 }}>
    <RunwayRing pct={0.18} tone="negative">
      <div className="runway-ring-value">2.1 mo</div>
      <div className="runway-ring-status negative">Low</div>
    </RunwayRing>
  </Card>
)
```

### NearFull

```jsx
() => (
  <Card className="runway-ring-card" style={{ width: 220 }}>
    <RunwayRing pct={0.98} tone="positive">
      <div className="runway-ring-value">11.7 mo</div>
      <div className="runway-ring-status positive">Strong</div>
    </RunwayRing>
  </Card>
)
```
