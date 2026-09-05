Button from mygoodbooks-ds. Use via `window.MygoodbooksDS.Button` (bundle loaded from the root `_ds_bundle.js`).

Pill-shaped action button. Synthesized from the `.btn-primary` /
`.btn-secondary` classes used directly on `<button>` elements throughout
app.jsx (e.g. "Download PDF", "Export CSV", modal save/cancel actions) —
there was no single shared Button component in the original app.

## Props

```ts
interface ButtonProps {
  /** Visual style — "primary" is the solid navy pill (`.btn-primary`), "secondary" the outlined pill (`.btn-secondary`). Defa */
  variant?: "primary" | "secondary";
  className?: string;
  id?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}
```

## Examples

### Primary

```jsx
() => <Button variant="primary">Export CSV</Button>
```

### Secondary

```jsx
() => <Button variant="secondary">Cancel</Button>
```

### Disabled

```jsx
() => (
  <Button variant="primary" disabled>
    Send Referral
  </Button>
)
```

### Group

```jsx
() => (
  <div style={{ display: 'flex', gap: 10 }}>
    <Button variant="secondary">Cancel</Button>
    <Button variant="primary">Save</Button>
  </div>
)
```
