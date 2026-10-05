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

  /** "As of Sunday, August 30, 2026 · 7:42 AM · synced from QuickBooks every
      15 minutes". The time is the client's real last QuickBooks sync
      (client.lastSyncedAt), never the current clock, and the cadence comes
      from app.jsx's syncCadenceLabel(plan) (PLAN_SYNC), read at call time.
      Sample-data clients (no sync yet) say so instead. */
  function asOfLabel(client, plan) {
    const stamp = client && client.lastSyncedAt ? new Date(client.lastSyncedAt) : null;
    if (!stamp || isNaN(stamp.getTime())) {
      return client && client.dataSource === "quickbooks"
        ? "Waiting for the first QuickBooks sync"
        : "Sample data";
    }
    const hours = stamp.getHours();
    const hour12 = hours % 12 === 0 ? 12 : hours % 12;
    const minutes = String(stamp.getMinutes()).padStart(2, "0");
    const meridiem = hours < 12 ? "AM" : "PM";
    const cadence =
      typeof syncCadenceLabel === "function" ? syncCadenceLabel(plan) : "Synced from QuickBooks";
    return (
      `As of ${DAY_NAMES[stamp.getDay()]}, ${MONTH_FULL[stamp.getMonth()]} ` +
      `${stamp.getDate()}, ${stamp.getFullYear()} · ${hour12}:${minutes} ${meridiem} · ` +
      cadence.charAt(0).toLowerCase() +
      cadence.slice(1)
    );
  }

  // How long past its plan's cadence a sync can be before the report says
  // the numbers may be stale (Pro every 15 min, Basic on the 15th of each
  // month — PLAN_SYNC in app.jsx), with slack for a missed run. standard is
  // the retired Plus plan (weekly server-side), kept for now.
  const STALE_AFTER_MS = {
    premium: 2 * 3600000,
    standard: 9 * 86400000,
    basic: 35 * 86400000,
  };

  function staleWarning(client, plan) {
    if (!client || client.dataSource !== "quickbooks" || !client.lastSyncedAt) return null;
    const stamp = new Date(client.lastSyncedAt);
    if (isNaN(stamp.getTime())) return null;
    const limit = STALE_AFTER_MS[plan] || STALE_AFTER_MS.standard;
    if (Date.now() - stamp.getTime() <= limit) return null;
    const ago = typeof relTime === "function" ? relTime(client.lastSyncedAt) : "";
    return (
      "Last QuickBooks sync was " +
      (ago || "a while ago") +
      ", longer than this plan's schedule. These numbers may be out of date."
    );
  }

  // A stable per-client number in [0,1), so the modelled series differ between
  // organizations but never change between reloads.
  function seedOf(text) {
    let hash = 0;
    for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) % 100000;
    return hash / 100000;
  }

  const AGING_BUCKET_META = [
    { label: "Current", tone: "good" },
    { label: "1–30 days", tone: "neutral" },
    { label: "31–60 days", tone: "warning" },
    { label: "60+ days", tone: "critical" },
  ];

  function agingBucketIndex(overdueBy) {
    return overdueBy <= 0 ? 0 : overdueBy <= 30 ? 1 : overdueBy <= 60 ? 2 : 3;
  }

  function receivableAging(receivables, today) {
    const buckets = AGING_BUCKET_META.map((b) => ({ ...b, amount: 0 }));
    receivables.forEach((r) => {
      const overdueBy = daysBetween(parseLocalDate(r.dueDate), today);
      buckets[agingBucketIndex(overdueBy)].amount += r.amount;
    });
    // The component renders every bucket it's given, so drop the empty ones
    // rather than showing four segments where only one has money in it.
    return buckets.filter((b) => b.amount > 0);
  }

  // Row-level view of the same receivables the aging buckets summarize —
  // the Collections queue needs individual line items to select from, not
  // just bucket totals.
  function receivablesList(receivables, today) {
    return receivables.map((r, i) => {
      const overdueBy = daysBetween(parseLocalDate(r.dueDate), today);
      const bucket = AGING_BUCKET_META[agingBucketIndex(overdueBy)];
      return {
        id: i,
        description: r.description,
        // Reminders are per customer. Live rows carry the QuickBooks customer
        // id; sample data has none, so the description stands in as the key.
        customerKey: r.customerId ? "qbo:" + r.customerId : "desc:" + r.description,
        customerName: r.customerName || r.description,
        customerEmail: r.customerEmail || null,
        invoiceId: r.invoiceId || null,
        amount: Math.round(r.amount),
        dueDate: r.dueDate,
        daysOverdue: Math.max(0, overdueBy),
        tone: bucket.tone,
        bucketLabel: bucket.label,
      };
    });
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

  // QuickBooks clients: a plain straight line from the average net of the
  // closed months on file. No scripted dip, no payroll/facilities story —
  // nothing here knows when individual bills or gifts will land, so the
  // chart doesn't pretend to.
  function buildLiveForecast(cashTotal, closedMonths, today) {
    const labels = [];
    const balances = [];
    const recent = closedMonths.slice(-6);
    const avgNet = recent.length ? sum(recent, (m) => m.income - m.expenses) / recent.length : 0;
    for (let i = 0; i < 7; i++) {
      labels.push(shortLabel(addDays(today, i * 15)));
      balances.push(Math.round(cashTotal + (avgNet / 2) * i));
    }
    const lowValue = Math.min(...balances);
    const lowIndex = balances.indexOf(lowValue);
    const basis = recent.length
      ? `the average of the last ${recent.length} closed month${recent.length === 1 ? "" : "s"} ` +
        `(${avgNet < 0 ? "−" : "+"}$${Math.round(Math.abs(avgNet)).toLocaleString("en-US")} a month)`
      : "no closed months yet, so a flat line";
    return {
      labels,
      actualCount: 1,
      cashBalances: balances,
      lowPoint: { label: labels[lowIndex], amount: lowValue },
      narrative:
        avgNet < 0
          ? `At the recent pace, cash reaches about $${lowValue.toLocaleString("en-US")} by ${labels[lowIndex]}. ` +
            `Based on ${basis}.`
          : `At the recent pace, cash holds or grows over the next 90 days. Based on ${basis}.`,
      methodology:
        "Straight-line projection from today's cash in QuickBooks and the average net income of recent " +
        "closed months. It doesn't model the timing of individual bills, payroll or gifts.",
    };
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
    // Expense lines only (income budget lines are split out by the mapper;
    // mgbExpenseBudget is belt and braces).
    const over = window
      .mgbExpenseBudget(client.budget)
      .filter((b) => b.actual > b.budgeted)
      .map((b) => ({ ...b, overBy: b.actual - b.budgeted }))
      .sort((a, b) => b.overBy - a.overBy);

    over.slice(0, 2).forEach((row) => {
      // A $0 budget line has no percentage (it used to read "Infinity% over").
      const pct = row.budgeted > 0 ? Math.round((row.overBy / row.budgeted) * 100) : null;
      anomalies.push({
        severity: pct === null || pct >= 20 ? "serious" : "warn",
        title: `${row.category} is over budget`,
        amount: `$${Math.round(row.overBy).toLocaleString("en-US")}`,
        description:
          pct === null
            ? `Spent $${Math.round(row.actual).toLocaleString("en-US")} with nothing budgeted for the period.`
            : `Spent $${Math.round(row.actual).toLocaleString("en-US")} against a ` +
              `$${Math.round(row.budgeted).toLocaleString("en-US")} budget — ${pct}% over for the period.`,
      });
    });

    // Bills already past their due date.
    const lateBills = payables
      .filter((p) => daysBetween(parseLocalDate(p.dueDate), today) > 0)
      .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
    if (lateBills.length) {
      const oldest = daysBetween(parseLocalDate(lateBills[0].dueDate), today);
      anomalies.push({
        severity: oldest > 30 ? "critical" : "serious",
        title: `${lateBills.length} bill${lateBills.length === 1 ? " is" : "s are"} past due`,
        amount: `$${Math.round(sum(lateBills, (p) => p.amount)).toLocaleString("en-US")}`,
        description:
          lateBills
            .slice(0, 3)
            .map((p) => `${p.vendor} (due ${p.dueDate})`)
            .join(", ") +
          (lateBills.length > 3 ? `, and ${lateBills.length - 3} more` : "") +
          ".",
      });
    }

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
          "Every budget category is within plan, no receivable or bill is past due, and nothing is due in the next 7 days.",
      });
    }

    return anomalies;
  }

  /**
   * Build the DailyCloseData object for one client from data.js.
   * @param {object} client - a CLIENTS entry
   * @param {string} [plan] - the viewer's effective plan, for the sync cadence
   * @returns {object} conforming to components/daily-close/types.ts
   */
  function dailyCloseFromClient(client, plan) {
    const today = startOfToday();
    const seed = seedOf(client.id || client.name);

    // Cash accounts only: a credit card's balance is money owed, not cash.
    const isLive = client.dataSource === "quickbooks";
    const cashAccounts = window.mgbCashAccounts(client.bankAccounts);
    const cardAccounts = window.mgbCardAccounts(client.bankAccounts);
    const cashExact = sum(cashAccounts, (a) => a.balance);
    // Whole dollars and cents from the absolute value: Math.floor on a
    // negative balance (-12.34) gave -13 and 66 cents, i.e. "-$13.66".
    const cashCentsTotal = Math.round(cashExact * 100);
    const cashWhole = Math.trunc(cashCentsTotal / 100);
    const cents = Math.abs(cashCentsTotal % 100);

    const monthly = client.monthly || [];
    // A QuickBooks client's newest month is month to date. Growth, the
    // projection, the forecast and the "vs. last month" delta use closed
    // months only; the MTD figure itself is still shown, labeled.
    const closedMonths = window.mgbClosedMonths(monthly);
    const latest = monthly[monthly.length - 1] || { income: 0, expenses: 0 };
    const latestIsPartial = window.mgbIsPartialMonth(latest);
    const prior = monthly[monthly.length - 2] || latest;

    const netIncomeMtd = latest.income - latest.expenses;
    const priorNet = prior.income - prior.expenses;
    const deltaPct = latestIsPartial
      ? null
      : priorNet !== 0
        ? ((netIncomeMtd - priorNet) / Math.abs(priorNet)) * 100
        : 0;
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
    const closedRevenue = closedMonths.map((m) => m.income);
    const closedExpense = closedMonths.map((m) => m.expenses);
    const revenueGrowth = growthRate(closedRevenue);
    const expenseGrowth = growthRate(closedExpense);
    const projectedMonths = projectMonths(monthly.length ? monthly[monthly.length - 1].month : "Dec", 2);
    const projectedRevenue = [];
    const projectedExpense = [];
    // Projected from the last CLOSED month. When the chart's last actual
    // point is the partial month, the projection steps over it (one extra
    // growth step) so it lines up under the right month names.
    let lastRevenue = closedRevenue[closedRevenue.length - 1] || 0;
    let lastExpense = closedExpense[closedExpense.length - 1] || 0;
    if (latestIsPartial) {
      lastRevenue = Math.round(lastRevenue * (1 + revenueGrowth));
      lastExpense = Math.round(lastExpense * (1 + expenseGrowth));
    }
    projectedMonths.forEach(() => {
      lastRevenue = Math.round(lastRevenue * (1 + revenueGrowth));
      lastExpense = Math.round(lastExpense * (1 + expenseGrowth));
      projectedRevenue.push(lastRevenue);
      projectedExpense.push(lastExpense);
    });

    // 14-day cash sparkline and "vs. yesterday": sample clients only. Both
    // were modelled (a month's net / 30 plus a sine wobble), which is fine
    // for a demo and wrong next to real QuickBooks balances, where there is
    // no daily balance history to draw from.
    const dailyNet = netIncomeMtd / 30;
    const sparkline14d = [];
    if (!isLive) {
      for (let i = 13; i >= 0; i--) {
        const wobble = Math.sin((i + seed * 6) * 1.1) * Math.abs(dailyNet) * 1.6;
        sparkline14d.push(Math.round(cashWhole - dailyNet * i + wobble));
      }
    }

    // "Where the money went": real expenses by account for this month when
    // QuickBooks supplied them (mapQboToClient's expenseByAccount, from
    // qbo_pl_lines), top 6 with the rest folded into "Other". Otherwise the
    // budget actuals, as sample clients have always used. A live client with
    // neither gets [] and the card shows its empty-state line.
    let expenseBreakdown = [];
    const byAccount = (client.expenseByAccount || []).filter((e) => e && e.amount > 0);
    if (byAccount.length) {
      const sorted = byAccount.slice().sort((a, b) => b.amount - a.amount);
      const top = sorted.length > 7 ? sorted.slice(0, 6) : sorted;
      expenseBreakdown = top.map((e) => ({ label: e.account, amount: Math.round(e.amount) }));
      if (sorted.length > top.length) {
        const rest = sorted.slice(top.length).reduce((s, e) => s + e.amount, 0);
        if (Math.round(rest) > 0) expenseBreakdown.push({ label: "Other", amount: Math.round(rest) });
      }
    } else {
      expenseBreakdown = window
        .mgbExpenseBudget(client.budget)
        .slice()
        .sort((a, b) => b.actual - a.actual)
        .slice(0, 6)
        .map((b) => ({ label: b.category, amount: Math.round(b.actual) }));
    }

    return {
      firm: { name: "MyGoodBooks" },
      client: {
        id: client.id,
        name: client.name,
        asOfLabel: asOfLabel(client, plan),
        // The component nests its "Sample data" tag inside the sync chip, so the
        // chip has to render for the warning to show at all. The stock sample
        // claims "Synced with QuickBooks Online", which would contradict every
        // other mock banner in the app — so the label carries the real status.
        // `isSampleData` stays false only to avoid printing "sample data" twice.
        syncedLabel:
          client.dataSource === "quickbooks"
            ? "Synced with QuickBooks Online" +
              (client.lastSyncedAt && typeof relTime === "function" && relTime(client.lastSyncedAt)
                ? " · " + relTime(client.lastSyncedAt)
                : "")
            : "Sample data — not connected to QuickBooks yet",
        isSampleData: false,
        staleWarning: staleWarning(client, plan),
      },
      cash: {
        total: cashWhole,
        cents,
        deltaVsYesterday: isLive ? null : Math.round(dailyNet),
        sparkline14d,
        byAccount: cashAccounts.map((a) => ({ name: a.accountName, balance: a.balance })),
        // What's owed on credit cards, shown under cash rather than netted
        // into it.
        cardsOwed: cardAccounts.length ? Math.round(sum(cardAccounts, (a) => a.balance) * 100) / 100 : null,
        cardCount: cardAccounts.length,
      },
      receivables: {
        total: Math.round(sum(receivables, (r) => r.amount)),
        overdueAmount: Math.round(overdueAmount),
        openInvoiceCount: receivables.length,
        customerCount: new Set(receivables.map((r) => r.customerId || r.description)).size,
        aging: aging.map((b) => ({ ...b, amount: Math.round(b.amount) })),
        list: receivablesList(receivables, today),
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
        // null while the month is still open: half a month vs. a whole one
        // isn't a comparison.
        deltaPctVsPriorMonth: deltaPct === null ? null : Math.round(deltaPct * 10) / 10,
        marginPct: Math.round(marginPct * 10) / 10,
        marginTargetPct: 25,
        label: isLive && !latestIsPartial && monthly.length
          ? `Net income, ${latest.month}`
          : "Net income, MTD",
      },
      trend: {
        months: monthly.map((m) => (window.mgbIsPartialMonth(m) ? `${m.month} (MTD)` : m.month)),
        revenue,
        expense,
        projectedMonths,
        projectedRevenue,
        projectedExpense,
      },
      expenseBreakdown,
      forecast90d: isLive
        ? buildLiveForecast(cashWhole, closedMonths, today)
        : buildForecast(client, cashWhole, netIncomeMtd, payables, today, seed),
      anomalies: buildAnomalies(client, receivables, payables, today),
      budgetHealth: buildBudgetHealth(client),
      payablesDueSoon: buildPayablesDueSoon(payables, today),
      // Funds, gifts and pledges aren't synced from QuickBooks yet; the
      // mapper empties them, and this never shows sample gifts to a live
      // client either way.
      fundActivity: isLive ? undefined : buildFundActivity(client),
      reconciliation: buildReconciliation(client),
      cardSource: buildCardSource(client, isLive, today),
      bookkeeper: client.assignedBookkeeper
        ? {
            name: client.assignedBookkeeper.name,
            role: client.assignedBookkeeper.role,
            initials: client.assignedBookkeeper.initials,
            email: client.assignedBookkeeper.email || null,
          }
        : undefined,
      accountManager: client.accountManager && client.accountManager.email
        ? {
            name: client.accountManager.name,
            initials: (client.accountManager.name || "")
              .split(/\s+/)
              .filter(Boolean)
              .slice(0, 2)
              .map((w) => w[0].toUpperCase())
              .join(""),
            email: client.accountManager.email,
          }
        : undefined,
    };
  }

  // Same "over budget, worst first" signal buildAnomalies already flags in
  // its top 2 — this surfaces up to 5 as a standalone panel rather than
  // burying the rest in the anomaly list.
  function buildBudgetHealth(client) {
    const over = window
      .mgbExpenseBudget(client.budget)
      .filter((b) => b.actual > b.budgeted)
      .sort((a, b) => b.actual - b.budgeted - (a.actual - a.budgeted));
    if (!over.length) return undefined;
    return over.slice(0, 5).map((b) => ({
      category: b.category,
      budgeted: Math.round(b.budgeted),
      actual: Math.round(b.actual),
      // null for a $0 budget line (was "Infinity%").
      overByPct: b.budgeted > 0 ? Math.round(((b.actual - b.budgeted) / b.budgeted) * 100) : null,
    }));
  }

  function buildPayablesDueSoon(payables, today) {
    if (!payables.length) return undefined;
    return payables
      .slice()
      .sort((a, b) => parseLocalDate(a.dueDate) - parseLocalDate(b.dueDate))
      .slice(0, 5)
      .map((p) => ({
        vendor: p.vendor,
        description: p.description,
        amount: Math.round(p.amount),
        dueDate: p.dueDate,
        daysUntilDue: daysBetween(today, parseLocalDate(p.dueDate)),
      }));
  }

  // Contributions and fund transfers are both real dated events, so they
  // merge into one chronological feed. Pledges have no per-payment date in
  // data.js (just running committed/received totals), so they're never
  // mixed into `items` — only surfaced as the running total below.
  function buildFundActivity(client) {
    const contributions = client.contributions || [];
    const fundTransfers = client.fundTransfers || [];
    const pledges = client.pledges || [];
    if (!contributions.length && !fundTransfers.length && !pledges.length) return undefined;

    const items = [
      ...contributions.map((c) => ({
        kind: "contribution",
        date: c.date,
        label: `${c.donor} → ${c.fund}`,
        amount: Math.round(c.amount),
      })),
      ...fundTransfers.map((t) => ({
        kind: "transfer",
        date: t.date,
        label: `${t.fromFund} → ${t.toFund}`,
        amount: Math.round(t.amount),
        detail: t.reason,
      })),
    ]
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
      .slice(0, 6);

    const outstanding = pledges.filter((p) => p.committed - p.received > 0.005);
    return {
      items,
      pledgesOutstandingTotal: Math.round(sum(outstanding, (p) => p.committed - p.received)),
      pledgesOutstandingCount: outstanding.length,
    };
  }

  // Everything a custom dashboard card (CustomCards.tsx) can be built from,
  // keyed by month ("2026-08") so a card's period is a plain slice.
  //
  // QuickBooks clients: per-month category actuals and budgets come from
  // client.categoryMonthly (mapQboToClient). Sample clients only have ONE
  // budget period, so earlier months are estimated by scaling each
  // category's actual by that month's total expenses (income categories by
  // total income) — deterministic, and flagged `estimatedHistory` so the card
  // can say so.
  const monthKeyOf = (y, m) => `${y}-${String(m + 1).padStart(2, "0")}`;
  function shiftMonthKey(key, delta) {
    const y = Number(key.slice(0, 4));
    const m = Number(key.slice(5, 7)) - 1 + delta;
    const d = new Date(y, m, 1);
    return monthKeyOf(d.getFullYear(), d.getMonth());
  }
  function buildCardSource(client, isLive, today) {
    const monthly = client.monthly || [];
    const bankAccounts = client.bankAccounts || [];

    // Sample months are labels only ("Aug"). They end at the month of the
    // newest sample transaction (or last month when there are none),
    // stepped back until the label matches the last monthly entry.
    let anchor = null;
    bankAccounts.forEach((a) =>
      (a.transactions || []).forEach((t) => {
        const k = String(t.date || "").slice(0, 7);
        if (/^\d{4}-\d{2}$/.test(k) && (!anchor || k > anchor)) anchor = k;
      })
    );
    if (!anchor) anchor = shiftMonthKey(monthKeyOf(today.getFullYear(), today.getMonth()), -1);
    const lastLabel = monthly.length ? monthly[monthly.length - 1].month : null;
    for (let i = 0; i < 12 && lastLabel && MONTH_NAMES[Number(anchor.slice(5, 7)) - 1] !== lastLabel; i++) {
      anchor = shiftMonthKey(anchor, -1);
    }
    const months = monthly.map((m, i) => ({
      key: m.key || shiftMonthKey(anchor, i - (monthly.length - 1)),
      label: m.month,
      partial: Boolean(m.partial),
      income: Number(m.income) || 0,
      expenses: Number(m.expenses) || 0,
    }));

    const byName = {};
    const categories = [];
    const cat = (name, type) => {
      if (!byName[name]) {
        byName[name] = { name, type, byMonth: {} };
        categories.push(byName[name]);
      }
      return byName[name];
    };
    if (isLive) {
      (client.categoryMonthly || []).forEach((r) => {
        const c = cat(r.category, r.type);
        const cell = c.byMonth[r.month] || (c.byMonth[r.month] = { actual: 0, budgeted: null });
        cell.actual += Number(r.actual) || 0;
        if (r.budgeted != null) cell.budgeted = (cell.budgeted || 0) + Number(r.budgeted);
      });
    } else if (months.length) {
      const last = months[months.length - 1];
      const spread = (rows, type, pick) =>
        (rows || []).forEach((b) => {
          const c = cat(b.category, type);
          const base = pick(last) || 1;
          months.forEach((m) => {
            c.byMonth[m.key] = {
              actual: m === last ? Number(b.actual) || 0 : Math.round(((Number(b.actual) || 0) * pick(m)) / base),
              budgeted: b.budgeted == null ? null : Number(b.budgeted),
            };
          });
        });
      spread(window.mgbExpenseBudget(client.budget), "expense", (m) => m.expenses);
      spread(client.budgetIncome, "income", (m) => m.income);
    }
    categories.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "expense" ? -1 : 1));

    return {
      months,
      categories,
      hasBudget: categories.some((c) => Object.values(c.byMonth).some((v) => v.budgeted != null)),
      estimatedHistory: !isLive,
      accounts: bankAccounts.map((a) => ({
        name: a.accountName,
        kind: window.mgbIsCardAccount(a) ? "card" : "cash",
        balance: Number(a.balance) || 0,
        transactions: (a.transactions || []).map((t) => ({
          date: t.date,
          description: t.description || "",
          category: t.category || null,
          amount: Number(t.amount) || 0,
        })),
      })),
      funds: (client.funds || []).map((f) => ({ name: f.name, restricted: Boolean(f.restricted), balance: Number(f.balance) || 0 })),
      contributions: client.contributions || [],
      fundTransfers: client.fundTransfers || [],
      pledges: client.pledges || [],
    };
  }

  // Factual, not a health signal: outstanding items mid-period are normal,
  // not a problem, so this never says "reconciled"/"needs attention" — just
  // what's open right now and when the last period was actually closed.
  function buildReconciliation(client) {
    const bankAccounts = client.bankAccounts || [];
    const hasReconciliationData = bankAccounts.some((a) => a.statementBalance != null);
    if (!hasReconciliationData) return undefined;

    const accounts = bankAccounts.map((a) => {
      const outstanding = (a.transactions || []).filter((t) => t.cleared === false);
      return {
        name: a.accountName,
        outstandingCount: outstanding.length,
        outstandingTotal: Math.round(sum(outstanding, (t) => t.amount)),
      };
    });

    const closed = (client.bankReconciliations || []).slice().sort((a, b) => (a.closedDate < b.closedDate ? 1 : -1));
    const lastClosed = closed[0];

    return {
      accounts,
      lastClosedPeriod: lastClosed ? lastClosed.period : null,
      lastClosedDate: lastClosed ? lastClosed.closedDate : null,
    };
  }

  window.dailyCloseFromClient = dailyCloseFromClient;
})();
