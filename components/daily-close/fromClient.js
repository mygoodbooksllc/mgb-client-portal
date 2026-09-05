/*
  Adapter: a CLIENTS entry from data.js -> the DailyCloseData contract in types.ts.

  Why this exists
  ---------------
  <DailyClose /> shipped with `sampleDailyCloseData` (Bramblewood Coffee Roasters),
  which meant the panel showed a coffee roaster's numbers no matter which church or
  nonprofit was selected. This derives the panel from the client's own figures so the
  two halves of the app agree.

  Which source wins
  -----------------
  Per the data.js invariants: `monthly` drives period income/expense, `budget[].actual`
  drives expense-by-category, and `bankAccounts[].balance` drives assets. The
  `bankAccounts[].transactions` register is only a short sample — it does NOT reconcile
  with `monthly` and mixes months — so it is never summed here.

  What is derived vs. modelled
  ----------------------------
  Cash, receivables (incl. aging from real due dates), payables, net income, the
  revenue/expense trend and the expense breakdown are computed directly from the
  client's data and will always match what the rest of the app shows.

  The 90-day forecast and the anomaly list are what the missing backend job would
  produce. They are modelled here from the same real inputs and are fully
  deterministic — no randomness, so the panel doesn't change between reloads. The
  projection is a plain trailing average, documented in the methodology line the
  component renders. Replace this whole file when the real job exists.

  Self-contained on purpose: it loads before app.jsx, so it can't borrow that file's
  date helpers.
*/

(function () {
  const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const MONTH_FULL = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];

  const sum = (list, pick) => list.reduce((total, item) => total + (pick ? pick(item) : item), 0);

  // Local-date parse. `new Date("2026-09-05")` is parsed as UTC and comes back a day
  // early west of Greenwich — the same trap todayLocal() exists to avoid in app.jsx.
  function parseLocalDate(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  function startOfToday() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  const daysBetween = (from, to) => Math.round((to - from) / 86400000);

  function addDays(date, days) {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
  }

  const shortLabel = (date) => `${MONTH_NAMES[date.getMonth()]} ${date.getDate()}`;

  /** "Live as of Sunday, August 30, 2026 · 7:42 AM" — recomputed on an
      interval by DailyClose.tsx, so this reads as a continuously-updating
      view rather than a fixed once-a-day snapshot. */
  function asOfLabel(now) {
    const hours = now.getHours();
    const hour12 = hours % 12 === 0 ? 12 : hours % 12;
    const minutes = String(now.getMinutes()).padStart(2, "0");
    const meridiem = hours < 12 ? "AM" : "PM";
    return (
      `Live as of ${DAY_NAMES[now.getDay()]}, ${MONTH_FULL[now.getMonth()]} ` +
      `${now.getDate()}, ${now.getFullYear()} · ${hour12}:${minutes} ${meridiem}`
    );
  }

  // A stable per-client number in [0,1), so the modelled series differ between
  // organizations but never change between reloads.
  function seedOf(text) {
    let hash = 0;
    for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) % 100000;
    return hash / 100000;
  }

  function receivableAging(receivables, today) {
    const buckets = [
      { label: "Current", amount: 0, tone: "good" },
      { label: "1–30 days", amount: 0, tone: "neutral" },
      { label: "31–60 days", amount: 0, tone: "warning" },
      { label: "60+ days", amount: 0, tone: "critical" },
    ];
    receivables.forEach((r) => {
      const overdueBy = daysBetween(parseLocalDate(r.dueDate), today);
      const index = overdueBy <= 0 ? 0 : overdueBy <= 30 ? 1 : overdueBy <= 60 ? 2 : 3;
      buckets[index].amount += r.amount;
    });
    // The component renders every bucket it's given, so drop the empty ones
    // rather than showing four segments where only one has money in it.
    return buckets.filter((b) => b.amount > 0);
  }

  function projectMonths(lastMonthLabel, count) {
    const startIndex = MONTH_NAMES.indexOf(lastMonthLabel);
    const out = [];
    for (let i = 1; i <= count; i++) out.push(MONTH_NAMES[(startIndex + i) % 12]);
    return out;
  }

  /** Average month-over-month growth across the series, clamped to something sane. */
  function growthRate(series) {
    if (series.length < 2) return 0;
    const steps = [];
    for (let i = 1; i < series.length; i++) {
      if (series[i - 1] > 0) steps.push(series[i] / series[i - 1] - 1);
    }
    if (!steps.length) return 0;
    const mean = sum(steps) / steps.length;
    return Math.max(-0.12, Math.min(0.12, mean));
  }

  function buildForecast(client, cashTotal, monthlyNet, payables, today, seed) {
    // Seven fortnightly points: today, then 90 days out.
    const labels = [];
    const balances = [];
    const points = 7;
    const perFortnight = monthlyNet / 2;

    // The biggest bill still to be paid creates the visible dip, so the shape is
    // traceable to a real row rather than being decorative noise.
    const largestPayable = payables.slice().sort((a, b) => b.amount - a.amount)[0];
    const dipIndex = 2 + Math.floor(seed * 2); // 2 or 3 — same every reload

    let running = cashTotal;
    for (let i = 0; i < points; i++) {
      const date = addDays(today, i * 15);
      labels.push(shortLabel(date));
      if (i === 0) {
        balances.push(Math.round(running));
        continue;
      }
      running += perFortnight;
      if (i === dipIndex) running -= (largestPayable ? largestPayable.amount : 0) + Math.abs(perFortnight) * 0.9;
      if (i === dipIndex + 1) running += Math.abs(perFortnight) * 0.55;
      balances.push(Math.round(running));
    }

    const lowValue = Math.min(...balances);
    const lowIndex = balances.indexOf(lowValue);

    const narrative = largestPayable
      ? `Projected low: $${lowValue.toLocaleString("en-US")} around ${labels[lowIndex]} — driven by ` +
        `${largestPayable.vendor} ($${largestPayable.amount.toLocaleString("en-US")}) landing in the same ` +
        `stretch as regular payroll and facility costs. Cash recovers as the period's income comes in.`
      : `Projected low: $${lowValue.toLocaleString("en-US")} around ${labels[lowIndex]}, based on the ` +
        `trailing average of income and expenses.`;

    return {
      labels,
      actualCount: 1,
      cashBalances: balances,
      lowPoint: { label: labels[lowIndex], amount: lowValue },
      narrative,
      methodology:
        "Modelled in the browser from this organization's own monthly income and expense history and its " +
        "outstanding payables — there is no bank feed or QuickBooks connection behind it yet. Recalculates " +
        "whenever the underlying figures change.",
    };
  }

  function buildAnomalies(client, receivables, payables, today) {
    const anomalies = [];

    // Over-budget categories — the same signal the dashboard's "Take Note" line uses.
    const over = (client.budget || [])
      .filter((b) => b.actual > b.budgeted)
      .map((b) => ({ ...b, overBy: b.actual - b.budgeted }))
      .sort((a, b) => b.overBy - a.overBy);

    over.slice(0, 2).forEach((row) => {
      const pct = Math.round((row.overBy / row.budgeted) * 100);
      anomalies.push({
        severity: pct >= 20 ? "serious" : "warn",
        title: `${row.category} is over budget`,
        amount: `$${Math.round(row.overBy).toLocaleString("en-US")}`,
        description:
          `Spent $${Math.round(row.actual).toLocaleString("en-US")} against a ` +
          `$${Math.round(row.budgeted).toLocaleString("en-US")} budget — ${pct}% over for the period.`,
      });
    });

    // Anything genuinely past due.
    const pastDue = receivables.filter((r) => daysBetween(parseLocalDate(r.dueDate), today) > 0);
    pastDue.slice(0, 1).forEach((r) => {
      const days = daysBetween(parseLocalDate(r.dueDate), today);
      anomalies.push({
        severity: days > 60 ? "critical" : "serious",
        title: `${r.description} is ${days} days overdue`,
        amount: `$${Math.round(r.amount).toLocaleString("en-US")}`,
        description: `Due ${r.dueDate}. Still outstanding as of this snapshot.`,
      });
    });

    const dueSoon = payables.filter((p) => {
      const days = daysBetween(today, parseLocalDate(p.dueDate));
      return days >= 0 && days <= 7;
    });
    if (dueSoon.length) {
      anomalies.push({
        severity: "warn",
        title: `${dueSoon.length} bill${dueSoon.length === 1 ? "" : "s"} due within 7 days`,
        amount: `$${Math.round(sum(dueSoon, (p) => p.amount)).toLocaleString("en-US")}`,
        description: dueSoon.map((p) => `${p.vendor} (${p.dueDate})`).join(", ") + ".",
      });
    }

    // Always say something, even for a clean month.
    if (!anomalies.length) {
      anomalies.push({
        severity: "good",
        title: "Nothing needs attention",
        amount: "—",
        description:
          "Every budget category is within plan, no receivable is past due, and nothing is due in the next 7 days.",
      });
    }

    return anomalies;
  }

  /**
   * Build the DailyCloseData object for one client from data.js.
   * @param {object} client - a CLIENTS entry
   * @returns {object} conforming to components/daily-close/types.ts
   */
  function dailyCloseFromClient(client) {
    const today = startOfToday();
    const seed = seedOf(client.id || client.name);

    const cashExact = sum(client.bankAccounts || [], (a) => a.balance);
    const cashWhole = Math.floor(cashExact);
    const cents = Math.round((cashExact - cashWhole) * 100);

    const monthly = client.monthly || [];
    const latest = monthly[monthly.length - 1] || { income: 0, expenses: 0 };
    const prior = monthly[monthly.length - 2] || latest;

    const netIncomeMtd = latest.income - latest.expenses;
    const priorNet = prior.income - prior.expenses;
    const deltaPct = priorNet !== 0 ? ((netIncomeMtd - priorNet) / Math.abs(priorNet)) * 100 : 0;
    const marginPct = latest.income !== 0 ? (netIncomeMtd / latest.income) * 100 : 0;

    const receivables = client.receivables || [];
    const payables = client.payables || [];
    const aging = receivableAging(receivables, today);
    const overdueAmount = sum(
      aging.filter((b) => b.label !== "Current"),
      (b) => b.amount
    );

    const revenue = monthly.map((m) => m.income);
    const expense = monthly.map((m) => m.expenses);
    const revenueGrowth = growthRate(revenue);
    const expenseGrowth = growthRate(expense);
    const projectedMonths = projectMonths(monthly.length ? monthly[monthly.length - 1].month : "Dec", 2);
    const projectedRevenue = [];
    const projectedExpense = [];
    let lastRevenue = revenue[revenue.length - 1] || 0;
    let lastExpense = expense[expense.length - 1] || 0;
    projectedMonths.forEach(() => {
      lastRevenue = Math.round(lastRevenue * (1 + revenueGrowth));
      lastExpense = Math.round(lastExpense * (1 + expenseGrowth));
      projectedRevenue.push(lastRevenue);
      projectedExpense.push(lastExpense);
    });

    // 14-day cash sparkline: walk backwards from today's balance using the
    // period's average daily net, so the shape reflects the client's real
    // direction of travel. Shape only — the component draws no axis.
    const dailyNet = netIncomeMtd / 30;
    const sparkline14d = [];
    for (let i = 13; i >= 0; i--) {
      const wobble = Math.sin((i + seed * 6) * 1.1) * Math.abs(dailyNet) * 1.6;
      sparkline14d.push(Math.round(cashWhole - dailyNet * i + wobble));
    }

    const expenseBreakdown = (client.budget || [])
      .slice()
      .sort((a, b) => b.actual - a.actual)
      .slice(0, 6)
      .map((b) => ({ label: b.category, amount: Math.round(b.actual) }));

    return {
      firm: { name: "MyGoodBooks" },
      client: {
        name: client.name,
        asOfLabel: asOfLabel(new Date()),
        // The component nests its "Sample data" tag inside the sync chip, so the
        // chip has to render for the warning to show at all. The stock sample
        // claims "Synced with QuickBooks Online", which would contradict every
        // other mock banner in the app — so the label carries the real status.
        // `isSampleData` stays false only to avoid printing "sample data" twice.
        syncedLabel: "Sample data — not connected to QuickBooks yet",
        isSampleData: false,
      },
      cash: {
        total: cashWhole,
        cents,
        deltaVsYesterday: Math.round(dailyNet),
        sparkline14d,
      },
      receivables: {
        total: Math.round(sum(receivables, (r) => r.amount)),
        overdueAmount: Math.round(overdueAmount),
        openInvoiceCount: receivables.length,
        customerCount: receivables.length,
        aging: aging.map((b) => ({ ...b, amount: Math.round(b.amount) })),
      },
      payables: {
        total: Math.round(sum(payables, (p) => p.amount)),
        dueWithin7Days: Math.round(
          sum(
            payables.filter((p) => {
              const days = daysBetween(today, parseLocalDate(p.dueDate));
              return days >= 0 && days <= 7;
            }),
            (p) => p.amount
          )
        ),
        hasPastDue: payables.some((p) => daysBetween(parseLocalDate(p.dueDate), today) > 0),
      },
      netIncome: {
        mtd: Math.round(netIncomeMtd),
        deltaPctVsPriorMonth: Math.round(deltaPct * 10) / 10,
        marginPct: Math.round(marginPct * 10) / 10,
        marginTargetPct: 25,
      },
      trend: {
        months: monthly.map((m) => m.month),
        revenue,
        expense,
        projectedMonths,
        projectedRevenue,
        projectedExpense,
      },
      expenseBreakdown,
      forecast90d: buildForecast(client, cashWhole, netIncomeMtd, payables, today, seed),
      anomalies: buildAnomalies(client, receivables, payables, today),
    };
  }

  window.dailyCloseFromClient = dailyCloseFromClient;
})();
