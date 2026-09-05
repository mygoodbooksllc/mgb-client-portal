CardSubtitle from mygoodbooks-ds. Use via `window.MygoodbooksDS.CardSubtitle` (bundle loaded from the root `_ds_bundle.js`).

## Props

```ts
interface CardSubtitleProps {
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
    <CardTitle>Recent Contributions</CardTitle>
    <CardSubtitle>Individual gifts and grants received</CardSubtitle>
  </Card>
)
```

### NoRecords

```jsx
() => (
  <Card style={{ width: 320 }}>
    <CardTitle>Recent Activity</CardTitle>
    <CardSubtitle>No recent transactions in your areas.</CardSubtitle>
  </Card>
)
```
