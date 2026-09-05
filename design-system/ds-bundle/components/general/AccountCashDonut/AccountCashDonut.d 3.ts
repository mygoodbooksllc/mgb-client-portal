import * as React from 'react';

/**
 * AccountCashDonut — from mygoodbooks-ds@0.1.0.
 */
export interface AccountCashDonutProps {
  /** Accounts to plot; slice size is each account's share of the summed balance. */
  accounts: DonutAccount[];
  /** Slice colors, cycled in order across accounts. Defaults to the app's gold/good/bad/gold-deep token cycle. */
  colors?: string[];
}

export declare const AccountCashDonut: React.ComponentType<AccountCashDonutProps>;
