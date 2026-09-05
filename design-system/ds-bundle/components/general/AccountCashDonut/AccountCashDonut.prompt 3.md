AccountCashDonut from mygoodbooks-ds. Use via `window.MygoodbooksDS.AccountCashDonut` (bundle loaded from the root `_ds_bundle.js`).

Donut chart (built with a CSS conic-gradient, not SVG) showing each
account's share of total cash on hand, with a center readout and a
color-keyed legend.

## Props

```ts
interface AccountCashDonutProps {
  /** Accounts to plot; slice size is each account's share of the summed balance. */
  accounts: DonutAccount[];
  /** Slice colors, cycled in order across accounts. Defaults to the app's gold/good/bad/gold-deep token cycle. */
  colors?: string[];
}
```

## Examples

### Default

```jsx
() => (
  <Card style={{ width: 340 }}>
    <CardTitle>Cash by Account</CardTitle>
    <CardSubtitle style={{ margin: 0 }}>Share of total cash on hand</CardSubtitle>
    <AccountCashDonut
      accounts={[
        { id: 1, accountName: 'General Operating', balance: 68420.55 },
        { id: 2, accountName: 'Building Fund Savings', balance: 142300.0 },
      ]}
    />
  </Card>
)
```

### ManyAccounts

```jsx
() => (
  <Card style={{ width: 340 }}>
    <CardTitle>Cash by Account</CardTitle>
    <CardSubtitle style={{ margin: 0 }}>Share of total cash on hand</CardSubtitle>
    <AccountCashDonut
      accounts={[
        { id: 1, accountName: 'General Operating', balance: 4820.3 },
        { id: 2, accountName: 'Missions Reserve', balance: 1650.0 },
        { id: 3, accountName: 'Benevolence Fund', balance: 640.0 },
        { id: 4, accountName: 'Building Reserve', balance: 2200.0 },
      ]}
    />
  </Card>
)
```
