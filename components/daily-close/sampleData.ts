(function () {

/**
 * The same demo dataset used in the standalone prototype (Bramblewood Coffee
 * Roasters). Useful for local development, Storybook, and QA before a real
 * QuickBooks connection exists — pass this straight into <DailyClose data={...} />.
 */
const sampleDailyCloseData = {
  firm: { name: "MyGoodBooks" },
  client: {
    name: "Bramblewood Coffee Roasters",
    asOfLabel: "Snapshot for Sunday, August 30, 2026 · 7:42 AM",
    syncedLabel: "Synced with QuickBooks Online",
    isSampleData: true,
  },
  cash: {
    total: 60819,
    cents: 55,
    deltaVsYesterday: 1240,
    sparkline14d: [
      55200, 56100, 55800, 57000, 58200, 57600, 59000, 58500, 59800, 60200,
      59600, 60900, 60100, 60819,
    ],
  },
  receivables: {
    total: 28450,
    overdueAmount: 9200,
    openInvoiceCount: 4,
    customerCount: 12,
    aging: [
      { label: "Current", amount: 14200, tone: "good" },
      { label: "1–30 days", amount: 5050, tone: "neutral" },
      { label: "31–60 days", amount: 5000, tone: "warning" },
      { label: "60+ days", amount: 4200, tone: "critical" },
    ],
  },
  payables: {
    total: 11275,
    dueWithin7Days: 4300,
    hasPastDue: false,
  },
  netIncome: {
    mtd: 12100,
    deltaPctVsPriorMonth: 65.8,
    marginPct: 35.4,
    marginTargetPct: 25,
  },
  trend: {
    months: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug"],
    revenue: [27400, 26800, 29900, 31200, 33500, 35100, 31800, 34200],
    expense: [24100, 23700, 24900, 25600, 26800, 27300, 24500, 22100],
    projectedMonths: ["Sep", "Oct"],
    projectedRevenue: [35600, 36900],
    projectedExpense: [25200, 25800],
  },
  expenseBreakdown: [
    { label: "Payroll & wages", amount: 12000 },
    { label: "Rent & utilities", amount: 3200 },
    { label: "Cost of goods", amount: 2900 },
    { label: "Software & subs", amount: 2860 },
    { label: "Marketing", amount: 780 },
    { label: "Other", amount: 360 },
  ],
  forecast90d: {
    labels: [
      "Aug 30", "Sep 6", "Sep 13", "Sep 18", "Sep 27", "Oct 4", "Oct 11",
      "Oct 18", "Oct 25", "Nov 1", "Nov 8", "Nov 15", "Nov 22", "Nov 28",
    ],
    actualCount: 1,
    cashBalances: [
      60819, 54200, 47600, 38240, 44900, 49300, 45100, 51800, 55600, 50200,
      54900, 58700, 56100, 61400,
    ],
    lowPoint: { label: "Sep 18", amount: 38240 },
    narrative:
      "Projected low: $38,240 around September 18 — driven by the mid-month loan payment landing the same week as payroll. Cash recovers once the Bramblewood Catering invoice is expected to collect.",
    methodology:
      "Modeled from average customer payment timing (32 days), recurring bills and payroll on their usual schedule, and seasonal sales patterns from the past 12 months. Re-forecast automatically with every new transaction.",
  },
  anomalies: [
    {
      severity: "critical",
      title: "Invoice #1042 is 96 days overdue",
      amount: "$4,200",
      description:
        "Bramblewood Catering LLC. This is the largest piece of your 60+ day balance — worth a call before it ages further.",
    },
    {
      severity: "serious",
      title: "Unusual cash withdrawal on Aug 22",
      amount: "$2,800",
      description:
        "Logged as an owner draw, outside the usual pattern for this account. Confirm it was intentional.",
    },
    {
      severity: "warn",
      title: "Software & subscriptions up 340% this month",
      amount: "$2,860",
      description:
        "A $2,210 annual renewal landed on top of the usual $650 in monthly tools. Expected to normalize next month.",
    },
    {
      severity: "good",
      title: "Cost of goods trending under budget",
      amount: "−6%",
      description:
        "Coffee and packaging costs came in below the trailing average — margins held even with July's dip in sales.",
    },
  ],
};

window.sampleDailyCloseData = sampleDailyCloseData;
})();
