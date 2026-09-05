import React from "react";
import { fmtMoney } from "./utils";

/** A bank account balance to plot as one slice of the donut. */
export interface DonutAccount {
  /** Stable key for the slice/legend row. */
  id: string | number;
  /** Display name shown in the legend. */
  accountName: string;
  /** Current balance, in dollars. */
  balance: number;
}

/** Props for {@link AccountCashDonut}. */
export interface AccountCashDonutProps {
  /** Accounts to plot; slice size is each account's share of the summed balance. */
  accounts: DonutAccount[];
  /** Slice colors, cycled in order across accounts. Defaults to the app's gold/good/bad/gold-deep token cycle. */
  colors?: string[];
}

const DEFAULT_DONUT_COLORS = ["var(--gold)", "var(--good)", "var(--bad)", "var(--gold-deep)"];

/**
 * Donut chart (built with a CSS conic-gradient, not SVG) showing each
 * account's share of total cash on hand, with a center readout and a
 * color-keyed legend.
 */
export function AccountCashDonut({ accounts, colors = DEFAULT_DONUT_COLORS }: AccountCashDonutProps) {
  const total = accounts.reduce((s, a) => s + a.balance, 0);
  let cursor = 0;
  const stops = accounts.map((a, i) => {
    const pct = total > 0 ? (a.balance / total) * 100 : 0;
    const color = colors[i % colors.length];
    const stop = `${color} ${cursor}% ${cursor + pct}%`;
    cursor += pct;
    return stop;
  });

  return (
    <div className="donut-widget compact">
      <div className="donut" style={{ background: `conic-gradient(${stops.join(", ")})` }}>
        <div className="donut-hole">
          <span className="donut-center-value">{fmtMoney(total)}</span>
          <span className="donut-center-label">Total Cash</span>
        </div>
      </div>
      <div className="donut-legend">
        {accounts.map((a, i) => (
          <div className="donut-legend-row" key={a.id}>
            <span className="legend-swatch" style={{ background: colors[i % colors.length] }}></span>
            <span>{a.accountName}</span>
            <span className="donut-legend-value">{fmtMoney(a.balance)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
