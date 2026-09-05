ReportBarRows from mygoodbooks-ds. Use via `window.MygoodbooksDS.ReportBarRows` (bundle loaded from the root `_ds_bundle.js`).

Small horizontal bar list — same visual language as the shared
bar-track/bar-fill elements used elsewhere, laid out as label/bar/amount
rows rather than inline in a table cell. Originally built for the Report
Builder's budget and fund breakdowns.

## Props

```ts
interface ReportBarRowsProps {
  /** Rows to render, each as a label + horizontal bar + trailing amount. */
  items: ReportBarRowItem[];
}
```

## Examples

### FundBalances

```jsx
() => (
  <Card style={{ width: 420 }}>
    <CardTitle>Fund Balances</CardTitle>
    <ReportBarRows
      items={[
        { label: 'Building Fund', amount: 142300.0 },
        { label: 'General Fund', amount: 35850.55 },
        { label: 'Missions Fund', amount: 18750.0 },
        { label: 'Benevolence Fund', amount: 6420.0 },
        { label: 'Kids Ministry Fund', amount: 5180.0 },
      ]}
    />
  </Card>
)
```

### BudgetVsActual

```jsx
() => (
  <Card style={{ width: 420 }}>
    <CardTitle>Spending by Category</CardTitle>
    <ReportBarRows
      items={[
        { label: 'Payroll — under budget', amount: 18200, tone: 'under' },
        { label: 'Facilities — over budget', amount: 6400, tone: 'over' },
        { label: 'Missions — under budget', amount: 3100, tone: 'under' },
      ]}
    />
  </Card>
)
```
