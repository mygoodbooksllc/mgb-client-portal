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
    /** Used to namespace the cash-floor alert threshold in localStorage. Omit and the setting is shared across clients. */
    id?: string;
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
    /** Per-account split backing the "Cash by account" panel. Omit to hide that panel. */
    byAccount?: { name: string; balance: number }[];
  };

  receivables: {
    total: number;
    /** Total considered "overdue" for the KPI chip — your own definition (commonly 31+ days). */
    overdueAmount: number;
    openInvoiceCount: number;
    customerCount: number;
    /** Ordered buckets, e.g. Current / 1-30 / 31-60 / 60+. Amounts should sum to `total`. */
    aging: { label: string; amount: number; tone: AgingTone }[];
    /** Row-level line items backing the Collections queue. Omit to hide that panel. */
    list?: {
      id: number | string;
      description: string;
      amount: number;
      dueDate: string;
      daysOverdue: number;
      tone: AgingTone;
      bucketLabel: string;
    }[];
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

  /** Categories running over their period budget, worst first. Omit or leave
      empty to hide the Budget Health panel — a client with nothing over
      budget shouldn't see an empty "problems" panel. */
  budgetHealth?: {
    category: string;
    budgeted: number;
    actual: number;
    overByPct: number;
  }[];

  /** Upcoming bills, soonest due first — the "don't get surprised" glance
      backing Cash Flow Pro's own Pay Run workflow. Omit to hide the panel. */
  payablesDueSoon?: {
    vendor: string;
    description: string;
    amount: number;
    dueDate: string;
    daysUntilDue: number;
  }[];

  /** Fund Accounting Pro's own data, summarized for the dashboard. `items`
      is a real dated feed (contributions + fund transfers); pledges have no
      per-payment date in the underlying data, so they're surfaced only as a
      running total, not mixed into the chronological feed. Omit the whole
      block (or leave `items` empty) to hide the panel — most clients have no
      funds at all. */
  fundActivity?: {
    items: {
      kind: "contribution" | "transfer";
      date: string;
      label: string;
      amount: number;
      detail?: string;
    }[];
    pledgesOutstandingTotal: number;
    pledgesOutstandingCount: number;
  };

  /** Reconciliation Pro's status, summarized — described factually (open
      items awaiting clearance, last closed period), not as a health/warning
      signal: mid-period outstanding items are normal, not a problem. Omit to
      hide the panel. */
  reconciliation?: {
    accounts: {
      name: string;
      outstandingCount: number;
      outstandingTotal: number;
    }[];
    lastClosedPeriod: string | null;
    lastClosedDate: string | null;
  };

  /** The client's assigned bookkeeper at the firm, for a quick "who do I
      ask" contact card. Omit if nobody's assigned yet. */
  bookkeeper?: {
    name: string;
    role: string;
    initials: string;
  };
}
