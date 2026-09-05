ToastProvider from mygoodbooks-ds. Use via `window.MygoodbooksDS.ToastProvider` (bundle loaded from the root `_ds_bundle.js`).

Provides `useToast()` to its subtree and renders the resulting toast
stack, bottom-right, each auto-dismissing after 3.2s. Ported as-is from
app.jsx — it was already self-contained (own context, own state).

## Props

```ts
interface ToastProviderProps {
  children?: React.ReactNode;
}
```

## Examples

### WithToast

```jsx
() => (
  <ToastProvider>
    <ReferralToastTrigger />
  </ToastProvider>
)
```
