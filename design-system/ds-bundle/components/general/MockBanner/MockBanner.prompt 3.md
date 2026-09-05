MockBanner from mygoodbooks-ds. Use via `window.MygoodbooksDS.MockBanner` (bundle loaded from the root `_ds_bundle.js`).

Small inline banner used at the top of pages built on prototype/sample
data, to make clear to the viewer that the numbers aren't live yet.

## Props

```ts
interface MockBannerProps {
  /** Explanatory text shown next to the flask icon (e.g. what data on this page is fabricated). */
  text: string;
}
```

## Examples

### Default

```jsx
() => (
  <MockBanner text="Every number on this page is sample data for prototyping — no QuickBooks or bank connection yet." />
)
```

### ReportContext

```jsx
() => (
  <MockBanner text="Reports are generated as real PDFs from this client's mock data — once QuickBooks is connected in Phase 2, these will reflect live books." />
)
```

### LongText

```jsx
() => (
  <MockBanner text="Uploaded files stay in your browser for this session only — nothing is actually stored yet." />
)
```
