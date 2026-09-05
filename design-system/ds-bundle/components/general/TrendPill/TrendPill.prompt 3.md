TrendPill from mygoodbooks-ds. Use via `window.MygoodbooksDS.TrendPill` (bundle loaded from the root `_ds_bundle.js`).

Pill showing a directional % change between two period totals (e.g. this
month vs. last month), colored green/red/neutral based on `goodDir`.

## Props

```ts
interface TrendPillProps {
  /** This period's value. */
  current: number;
  /** The prior period's value to compare against; null/undefined renders "no prior period on record". */
  prior: number;
  /** Which direction of change reads as positive — e.g. "down" for an expense metric where less is good. Defaults to "up". */
  goodDir?: "up" | "down";
}
```

## Examples

### Positive

```jsx
() => <TrendPill current={63500} prior={59800} goodDir="up" />
```

### Negative

```jsx
() => <TrendPill current={55100} prior={52900} goodDir="down" />
```

### Flat

```jsx
() => <TrendPill current={4820.3} prior={4805.1} goodDir="up" />
```

### NoPriorPeriod

```jsx
() => <TrendPill current={35850.55} prior={null} goodDir="up" />
```
