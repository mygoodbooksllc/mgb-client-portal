CardTitle from mygoodbooks-ds. Use via `window.MygoodbooksDS.CardTitle` (bundle loaded from the root `_ds_bundle.js`).

## Props

```ts
interface CardTitleProps {
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
    <CardTitle>Income vs. Expenses</CardTitle>
  </Card>
)
```

### WithInlineStyle

```jsx
() => (
  <Card style={{ width: 320 }}>
    <CardTitle style={{ margin: 0 }}>Grace Community Church</CardTitle>
  </Card>
)
```
