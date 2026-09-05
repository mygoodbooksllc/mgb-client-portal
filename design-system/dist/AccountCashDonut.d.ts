import React from "react";
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
/**
 * Donut chart (built with a CSS conic-gradient, not SVG) showing each
 * account's share of total cash on hand, with a center readout and a
 * color-keyed legend.
 */
export declare function AccountCashDonut({ accounts, colors }: AccountCashDonutProps): React.JSX.Element;
