/**
 * Data contract for <DailyClose />.
 *
 * This is the shape your backend needs to produce per client — from QuickBooks,
 * a cache table, wherever. Nothing in the component talks to QuickBooks directly;
 * it only renders this object. See sampleData.ts for a fully worked example, and
 * INTEGRATION.md for how this maps to QuickBooks Online API endpoints.
 */

export type Severity = "critical" | "serious" | "warn" | "good";
export type AgingTone = "good" | "neutral" | "warning" | "critical";

export interface DailyCloseData {
  firm: {
    /** Shown as the small eyebrow label above the product name. */
    name: string;
  };
  client: {
    name: string;
    /** e.g. "Snapshot for Sunday, August 30, 2026 · 7:42 AM" — format however your app does dates/timezones. */
    asOfLabel: string;
    /** e.g. "Synced with QuickBooks Online" — omit to hide the sync chip. */
    syncedLabel?: string;
    /** Shows a small "Sample data" tag next to the sync chip. Set false once real data is live. */
    isSampleData?: boolean;
  };

  cash: {
    /** Whole-dollar amount. Cents are rendered separately for the ledger-style ".55" treatment. */
    total: number;
    cents?: number;
    deltaVsYesterday: number;
    /** 10-20 points is plenty; this is a sparkline, not an axis-labeled chart. */
    sparkline14d: number[];
  };

  receivables: {
    total: number;
    /** Total considered "overdue" for the KPI chip — your own definition (commonly 31+ days). */
    overdueAmount: number;
    openInvoiceCount: number;
    customerCount: number;
    /** Ordered buckets, e.g. Current / 1-30 / 31-60 / 60+. Amounts should sum to `total`. */
    aging: { label: string; amount: number; tone: AgingTone }[];
  };

  payables: {
    total: number;
    dueWithin7Days: number;
    hasPastDue: boolean;
  };

  netIncome: {
    mtd: number;
    deltaPctVsPriorMonth: number;
    marginPct: number;
    marginTargetPct: number;
  };

  trend: {
    /** Actual months, oldest first, e.g. last 8 months. */
    months: string[];
    revenue: number[];
    expense: number[];
    /** Projected months appended after `months` on the chart, rendered dashed. */
    projectedMonths: string[];
    projectedRevenue: number[];
    projectedExpense: number[];
  };

  expenseBreakdown: { label: string; amount: number }[];

  forecast90d: {
    /** Full label set: actual point(s) first, then projected. */
    labels: string[];
    /** How many of `labels`/`cashBalances` (from the start) are actual vs. projected. Usually 1. */
    actualCount: number;
    cashBalances: number[];
    lowPoint: { label: string; amount: number };
    /** The one-line insight shown in the callout box. */
    narrative: string;
    /** Small-print methodology note under the chart. */
    methodology: string;
  };

  anomalies: {
    severity: Severity;
    title: string;
    /** Pre-formatted, e.g. "$4,200" or "−6%". */
    amount: string;
    description: string;
  }[];
}
