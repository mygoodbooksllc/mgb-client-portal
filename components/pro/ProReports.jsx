// Pro "Reports" tools: board packet PDF, saved templates, comparison columns,
// Statement of Functional Expenses, giving reports, the "what happened this
// month" summary, read-only share links and church branding.
//
// Loaded as a classic script BEFORE app.jsx, in the same global scope. Rules
// that follow from that:
//   - every top-level name is prefixed (ProReports*/Pr*/pr*/PR_*), except
//     ReportShareView, which the app mounts for a `?share=<token>` URL;
//   - app.jsx globals (useState, useToast, StaffToolsContext, ConfirmModal,
//     isMissingTableError …) are only touched inside function bodies, which
//     run after app.jsx has loaded;
//   - the share page and the PDF builder use only helpers from this file, so
//     a signed-out visitor never depends on anything that needs a session.
//
// Tables: supabase/pro-budget-reports.sql. Every query is guarded; when a
// table is missing the on-screen features keep working and saving says so.

const PR_SETUP_MSG = "Saving needs supabase/pro-budget-reports.sql.";
const PR_OFFLINE_MSG =
  "Saving isn't available here, so changes stay on this screen for now.";

const PR_MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const PR_MONTH_FULL = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const PR_SECTIONS = [
  { key: "cover", label: "Cover page" },
  { key: "summary", label: "What happened this month" },
  { key: "incomeExpense", label: "Income & expenses" },
  { key: "budget", label: "Budget vs. actual" },
  { key: "cash", label: "Cash & funds" },
  { key: "giving", label: "Giving" },
  { key: "functional", label: "Statement of Functional Expenses" },
  { key: "treasurer", label: "Treasurer's note" },
];

const PR_COMPARES = [
  { key: "budget", label: "vs. budget" },
  { key: "priorMonth", label: "vs. prior month" },
  { key: "lastYear", label: "vs. same month last year" },
  { key: "ytd", label: "Year to date vs. last year to date" },
];

const PR_FUNCTIONS = [
  { key: "program", label: "Program services" },
  { key: "management", label: "Management & general" },
  { key: "fundraising", label: "Fundraising" },
];

const PR_EXPIRY_OPTIONS = [7, 30, 90];

// One-click starting points, always available even before anything is saved.
const PR_PRESETS = [
  {
    name: "Monthly board packet",
    sections: ["cover", "summary", "incomeExpense", "budget", "cash", "giving", "treasurer"],
    compare: ["budget", "priorMonth", "lastYear"],
  },
  {
    name: "Finance committee",
    sections: ["cover", "summary", "incomeExpense", "budget", "cash", "functional", "treasurer"],
    compare: ["budget", "priorMonth", "lastYear", "ytd"],
  },
];

// ---------------------------------------------------------------------------
// Small self-contained helpers (no app.jsx dependency)
// ---------------------------------------------------------------------------

function prNum(n) {
  const v = Number(n);
  return isFinite(v) ? v : 0;
}

function prMoney(n) {
  const v = Math.round(prNum(n));
  return (v < 0 ? "-" : "") + "$" + Math.abs(v).toLocaleString("en-US");
}

function prSignedMoney(n) {
  const v = Math.round(prNum(n));
  return (v > 0 ? "+" : "") + prMoney(v);
}

function prPct(p, signed) {
  if (p === null || p === undefined || !isFinite(p)) return "—";
  return (signed && p > 0 ? "+" : "") + p.toFixed(1) + "%";
}

function prDateLabel(iso) {
  if (!iso) return "";
  const s = String(iso);
  const d = s.length <= 10 ? new Date(s + "T00:00:00") : new Date(s);
  if (!isFinite(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function prTodayIso() {
  const d = new Date();
  return (
    d.getFullYear() +
    "-" + String(d.getMonth() + 1).padStart(2, "0") +
    "-" + String(d.getDate()).padStart(2, "0")
  );
}

function prIsoDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return (
    d.getFullYear() +
    "-" + String(d.getMonth() + 1).padStart(2, "0") +
    "-" + String(d.getDate()).padStart(2, "0")
  );
}

function prPeriodLabelFromKey(key) {
  const m = /^(\d{4})-(\d{2})$/.exec(key || "");
  if (!m) return key || "";
  return PR_MONTH_FULL[Number(m[2]) - 1] + " " + m[1];
}

function prShortPeriodLabel(key) {
  const m = /^(\d{4})-(\d{2})$/.exec(key || "");
  if (!m) return key || "";
  return PR_MONTH_SHORT[Number(m[2]) - 1] + " " + m[1];
}

function prMonthIdx(label) {
  const s = String(label || "").trim().slice(0, 3).toLowerCase();
  return PR_MONTH_SHORT.findIndex((m) => m.toLowerCase() === s);
}

function prDelta(current, base) {
  const diff = prNum(current) - prNum(base);
  const pct = prNum(base) !== 0 ? (diff / Math.abs(prNum(base))) * 100 : null;
  return { diff, pct };
}

// Whether a change is good news: more income or net is good, more spending
// is not. Returns the pr-good / pr-bad class, or "" for no change.
function prToneClass(kind, diff) {
  if (!diff) return "";
  const good = kind === "expense" ? diff < 0 : diff > 0;
  return good ? "pr-good" : "pr-bad";
}

function prValidHex(c) {
  return typeof c === "string" && /^#[0-9a-fA-F]{6}$/.test(c) ? c : null;
}

function prValidLogo(u) {
  return typeof u === "string" &&
    /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(u) &&
    u.length <= 400000
    ? u
    : null;
}

function prHexToRgb(hex) {
  const h = prValidHex(hex);
  if (!h) return null;
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

function prRandomToken() {
  if (!window.crypto || !window.crypto.getRandomValues) {
    throw new Error("This browser can't make a secure link.");
  }
  return Array.from(window.crypto.getRandomValues(new Uint8Array(32)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function prShareUrl(token) {
  return `${window.location.origin}${window.location.pathname}?share=${token}`;
}

// ---------------------------------------------------------------------------
// Number crunching
// ---------------------------------------------------------------------------

// The packet reports on the last CLOSED month (see window.mgbClosedMonths).
// A QuickBooks client's budget[] is the month-to-date sync month, so the
// packet uses budgetPrev (the closed month's expense budget) instead; sample
// clients' budget is already a full month.
function prReportBudget(client) {
  if (client && client.dataSource === "quickbooks") return client.budgetPrev || [];
  return window.mgbExpenseBudget(client && client.budget);
}

// Expense lines for the Statement of Functional Expenses: every expense
// account QuickBooks reported for the closed month (not just the budgeted
// ones), else the sample budget's actuals.
function prExpenseRows(client) {
  if (client && client.dataSource === "quickbooks") {
    return (client.expenseByAccountPrev || []).map((e) => ({ category: e.account, actual: e.amount }));
  }
  return prReportBudget(client);
}

// client.monthly carries three-letter month labels, not dates. Give each row a
// real year/month by walking back from the latest one, which is the most
// recent month with that name on or before today (QuickBooks-backed rows are
// current-year; a row can carry an explicit `year` too).
function prTimeline(monthly) {
  const list = Array.isArray(monthly) ? monthly : [];
  if (!list.length) return [];
  const out = new Array(list.length);
  const now = new Date();
  let prevMi = null;
  let prevYear = null;
  for (let i = list.length - 1; i >= 0; i--) {
    const row = list[i] || {};
    const mi = prMonthIdx(row.month);
    let year;
    if (Number.isInteger(row.year)) {
      year = row.year;
    } else if (prevMi === null) {
      year = now.getFullYear() - (mi > now.getMonth() ? 1 : 0);
    } else {
      year = mi >= prevMi ? prevYear - 1 : prevYear;
    }
    const ok = mi >= 0;
    out[i] = {
      label: ok ? `${PR_MONTH_SHORT[mi]} ${year}` : String(row.month || ""),
      full: ok ? `${PR_MONTH_FULL[mi]} ${year}` : String(row.month || ""),
      key: ok ? `${year}-${String(mi + 1).padStart(2, "0")}` : null,
      year,
      mi,
      income: prNum(row.income),
      expenses: prNum(row.expenses),
    };
    if (ok) {
      prevMi = mi;
      prevYear = year;
    }
  }
  return out;
}

function prIeRows(cur, base, withIncome) {
  const rows = [];
  if (withIncome) {
    rows.push({ line: "Income", kind: "income", current: cur.income, base: base.income, ...prDelta(cur.income, base.income) });
  }
  rows.push({ line: "Expenses", kind: "expense", current: cur.expenses, base: base.expenses, ...prDelta(cur.expenses, base.expenses) });
  if (withIncome) {
    const cn = cur.income - cur.expenses;
    const bn = base.income - base.expenses;
    rows.push({ line: "Net (income less expenses)", kind: "net", current: cn, base: bn, ...prDelta(cn, bn) });
  }
  return rows;
}

// The four comparison columns. Each is either available with rows, or
// unavailable with a plain reason — never a made-up number.
function prComparisons(timeline, budget) {
  const cur = timeline[timeline.length - 1];
  if (!cur) return [];
  const out = [];
  const bud = Array.isArray(budget) ? budget : [];

  if (bud.length) {
    const budgeted = bud.reduce((s, b) => s + prNum(b.budgeted), 0);
    const actual = bud.reduce((s, b) => s + prNum(b.actual), 0);
    out.push({
      key: "budget", label: "vs. budget", available: true,
      currentLabel: cur.label, baseLabel: `Budget, ${cur.label}`,
      rows: [{ line: "Expenses in budgeted categories", kind: "expense", current: actual, base: budgeted, ...prDelta(actual, budgeted) }],
    });
  } else {
    out.push({ key: "budget", label: "vs. budget", available: false, reason: "No budget is set for this month yet." });
  }

  const prior = timeline[timeline.length - 2];
  if (prior && prior.key) {
    out.push({
      key: "priorMonth", label: "vs. prior month", available: true,
      currentLabel: cur.label, baseLabel: prior.label, rows: prIeRows(cur, prior, true),
    });
  } else {
    out.push({ key: "priorMonth", label: "vs. prior month", available: false, reason: "Not enough history yet." });
  }

  const lyKey = cur.key ? `${cur.year - 1}-${cur.key.slice(5)}` : null;
  const ly = timeline.length >= 13 && lyKey ? timeline.find((t) => t.key === lyKey) : null;
  if (ly) {
    out.push({
      key: "lastYear", label: "vs. same month last year", available: true,
      currentLabel: cur.label, baseLabel: ly.label, rows: prIeRows(cur, ly, true),
    });
  } else {
    out.push({
      key: "lastYear", label: "vs. same month last year", available: false,
      reason: "Not enough history yet. This needs 13 months of numbers.",
    });
  }

  const thisYtd = timeline.filter((t) => t.key && t.year === cur.year && t.mi <= cur.mi);
  const lastYtd = timeline.filter((t) => t.key && t.year === cur.year - 1 && t.mi <= cur.mi);
  if (cur.key && thisYtd.length === cur.mi + 1 && lastYtd.length === cur.mi + 1) {
    const sum = (arr) => ({
      income: arr.reduce((s, t) => s + t.income, 0),
      expenses: arr.reduce((s, t) => s + t.expenses, 0),
    });
    const span = cur.mi === 0 ? "Jan" : `Jan–${PR_MONTH_SHORT[cur.mi]}`;
    out.push({
      key: "ytd", label: "Year to date vs. last year to date", available: true,
      currentLabel: `${span} ${cur.year}`, baseLabel: `${span} ${cur.year - 1}`,
      rows: prIeRows(sum(thisYtd), sum(lastYtd), true),
    });
  } else {
    out.push({
      key: "ytd", label: "Year to date vs. last year to date", available: false,
      reason: "Not enough history yet. This needs this year and last year from January on.",
    });
  }
  return out;
}

function prBudgetSection(budget, notes) {
  const rows = (Array.isArray(budget) ? budget : []).map((b) => {
    const budgeted = prNum(b.budgeted);
    const actual = prNum(b.actual);
    const variance = actual - budgeted;
    return {
      category: String(b.category || ""),
      budgeted,
      actual,
      variance,
      pct: budgeted > 0 ? (variance / budgeted) * 100 : null,
      note: (notes && notes[b.category]) || "",
    };
  });
  const budgeted = rows.reduce((s, r) => s + r.budgeted, 0);
  const actual = rows.reduce((s, r) => s + r.actual, 0);
  return {
    rows,
    totals: {
      budgeted,
      actual,
      variance: actual - budgeted,
      pct: budgeted > 0 ? ((actual - budgeted) / budgeted) * 100 : null,
    },
  };
}

function prSuggestFunction(category) {
  const c = String(category || "").toLowerCase();
  if (/fundrais|donor|campaign|stewardship|development|gala|appeal|giving event/.test(c)) return "fundraising";
  if (/office|admin|insurance|rent|utilit|accounting|bookkeep|audit|legal|bank fee|professional|facilit|software|technology/.test(c)) return "management";
  if (/salar|pastor|ministry|worship|outreach|mission|program|kids|youth|children|benevolence|curriculum|pantry|food|music|media|education|camp/.test(c)) return "program";
  return "program";
}

function prFunctionalSection(budget, fnMap, periodLabel) {
  const rows = (Array.isArray(budget) ? budget : []).map((b) => {
    const fn = (fnMap && fnMap[b.category]) || prSuggestFunction(b.category);
    const total = prNum(b.actual);
    return {
      category: String(b.category || ""),
      fn,
      total,
      program: fn === "program" ? total : 0,
      management: fn === "management" ? total : 0,
      fundraising: fn === "fundraising" ? total : 0,
    };
  });
  const totals = rows.reduce(
    (t, r) => ({
      total: t.total + r.total,
      program: t.program + r.program,
      management: t.management + r.management,
      fundraising: t.fundraising + r.fundraising,
    }),
    { total: 0, program: 0, management: 0, fundraising: 0 },
  );
  const pctOf = (v) => (totals.total > 0 ? (v / totals.total) * 100 : null);
  return {
    periodLabel: `For the month of ${periodLabel} (last closed month)`,
    rows,
    totals,
    pct: { program: pctOf(totals.program), management: pctOf(totals.management), fundraising: pctOf(totals.fundraising) },
  };
}

function prCashSection(client, timeline) {
  // Cash accounts only: a credit card's balance is money owed, not cash.
  const accounts = window.mgbCashAccounts(client.bankAccounts).map((a) => ({
    name: String(a.accountName || a.name || "Account"),
    type: String(a.type || ""),
    balance: prNum(a.balance),
  }));
  const totalCash = accounts.reduce((s, a) => s + a.balance, 0);
  const funds = (client.funds || []).map((f) => ({
    name: String(f.name || ""),
    restricted: !!f.restricted,
    balance: prNum(f.balance),
  }));
  const avgExp = timeline.length ? timeline.reduce((s, t) => s + t.expenses, 0) / timeline.length : 0;
  return {
    accounts,
    totalCash,
    funds,
    restrictedTotal: funds.filter((f) => f.restricted).reduce((s, f) => s + f.balance, 0),
    unrestrictedTotal: funds.filter((f) => !f.restricted).reduce((s, f) => s + f.balance, 0),
    runwayMonths: avgExp > 0 && accounts.length ? totalCash / avgExp : null,
    receivablesTotal: (client.receivables || []).reduce((s, r) => s + prNum(r.amount), 0),
    payablesTotal: (client.payables || []).reduce((s, p) => s + prNum(p.amount), 0),
  };
}

function prGivingSection(client, periodKey) {
  const gifts = (client.contributions || []).filter((c) => c && /^\d{4}-\d{2}-\d{2}/.test(String(c.date || "")));
  const isAnon = (d) => !d || /^anonymous$/i.test(String(d).trim());
  const inPeriod = periodKey ? gifts.filter((c) => String(c.date).startsWith(periodKey)) : [];

  const byDonor = {};
  inPeriod.forEach((c) => {
    if (isAnon(c.donor)) return;
    const k = String(c.donor);
    byDonor[k] = byDonor[k] || { donor: k, total: 0, gifts: 0 };
    byDonor[k].total += prNum(c.amount);
    byDonor[k].gifts += 1;
  });
  const topDonors = Object.values(byDonor).sort((a, b) => b.total - a.total).slice(0, 10);
  const anonymousTotal = inPeriod.filter((c) => isAnon(c.donor)).reduce((s, c) => s + prNum(c.amount), 0);

  // Lapsed: gave in the prior 12 months, nothing in the last 90 days.
  const today = prTodayIso();
  const d90 = prIsoDaysAgo(90);
  const d365 = prIsoDaysAgo(365);
  let lapsed;
  if (!gifts.length) {
    lapsed = { available: false, reason: "No giving recorded yet." };
  } else {
    const earliest = gifts.reduce((m, c) => (c.date < m ? c.date : m), gifts[0].date);
    if (earliest > d90) {
      lapsed = {
        available: false,
        reason: "Not enough history yet. Lapsed donors need more than 90 days of giving on record.",
      };
    } else {
      const last = {};
      gifts.forEach((c) => {
        if (isAnon(c.donor) || c.date < d365 || c.date > today) return;
        const k = String(c.donor);
        last[k] = last[k] || { donor: k, lastGift: c.date, total12: 0 };
        if (c.date > last[k].lastGift) last[k].lastGift = c.date;
        last[k].total12 += prNum(c.amount);
      });
      lapsed = {
        available: true,
        rows: Object.values(last)
          .filter((r) => r.lastGift < d90)
          .sort((a, b) => b.total12 - a.total12),
      };
    }
  }

  // Giving by fund over the most recent (up to) six months on record.
  const monthKeys = Array.from(new Set(gifts.map((c) => String(c.date).slice(0, 7)))).sort().slice(-6);
  const fundMap = {};
  gifts.forEach((c) => {
    const mk = String(c.date).slice(0, 7);
    const idx = monthKeys.indexOf(mk);
    if (idx < 0) return;
    const f = String(c.fund || "General");
    fundMap[f] = fundMap[f] || { fund: f, values: monthKeys.map(() => 0), total: 0 };
    fundMap[f].values[idx] += prNum(c.amount);
    fundMap[f].total += prNum(c.amount);
  });

  const pledgeRows = (client.pledges || []).map((p) => {
    const committed = prNum(p.committed);
    const received = prNum(p.received);
    return {
      donor: String(p.donor || ""),
      fund: String(p.fund || ""),
      committed,
      received,
      remaining: Math.max(committed - received, 0),
      pct: committed > 0 ? (received / committed) * 100 : null,
      dueDate: p.dueDate || null,
    };
  });
  const pc = pledgeRows.reduce((s, r) => s + r.committed, 0);
  const pr = pledgeRows.reduce((s, r) => s + r.received, 0);

  return {
    periodLabel: prPeriodLabelFromKey(periodKey),
    hasAnyGifts: gifts.length > 0,
    totalInPeriod: inPeriod.reduce((s, c) => s + prNum(c.amount), 0),
    giftCount: inPeriod.length,
    topDonors,
    anonymousTotal,
    lapsed,
    byFund: {
      months: monthKeys.map(prShortPeriodLabel),
      rows: Object.values(fundMap).sort((a, b) => b.total - a.total),
    },
    pledges: {
      rows: pledgeRows,
      totals: { committed: pc, received: pr, remaining: Math.max(pc - pr, 0), pct: pc > 0 ? (pr / pc) * 100 : null },
    },
  };
}

// Rule-based first draft of the plain-language summary.
function prDraftSummary({ orgName, timeline, comparisons, budget, cash, giving }) {
  const cur = timeline[timeline.length - 1];
  if (!cur) return "";
  const monthName = cur.mi >= 0 ? PR_MONTH_FULL[cur.mi] : cur.label;
  const net = cur.income - cur.expenses;
  const parts = [];

  parts.push(
    `In ${monthName}, ${orgName || "we"} received ${prMoney(cur.income)} and spent ${prMoney(cur.expenses)}, ` +
      (net >= 0 ? `a surplus of ${prMoney(net)}.` : `a shortfall of ${prMoney(-net)}.`),
  );

  const pm = comparisons.find((c) => c.key === "priorMonth" && c.available);
  if (pm) {
    const inc = pm.rows.find((r) => r.kind === "income");
    const exp = pm.rows.find((r) => r.kind === "expense");
    const word = (d, up, down) => (d > 0 ? up : d < 0 ? down : "held steady");
    const bit = (r, up, down) =>
      r.diff === 0
        ? word(0)
        : `${word(r.diff, up, down)} ${prMoney(Math.abs(r.diff))}${r.pct !== null ? ` (${Math.abs(r.pct).toFixed(0)}%)` : ""}`;
    parts.push(
      `Compared with ${PR_MONTH_FULL[prMonthIdx(pm.baseLabel)] || pm.baseLabel}, income ${bit(inc, "was up", "was down")} and expenses ${bit(exp, "rose", "fell")}.`,
    );
  }

  const ly = comparisons.find((c) => c.key === "lastYear" && c.available);
  if (ly) {
    const inc = ly.rows.find((r) => r.kind === "income");
    if (inc && inc.pct !== null) {
      parts.push(
        `Income is ${inc.diff >= 0 ? "up" : "down"} ${Math.abs(inc.pct).toFixed(0)}% from ${monthName} last year.`,
      );
    }
  }

  const over = budget.rows
    .filter((r) => r.variance > 0 && r.budgeted > 0)
    .sort((a, b) => b.variance - a.variance)
    .slice(0, 2);
  if (budget.rows.length) {
    if (over.length) {
      parts.push(
        `Spending ran over budget in ${over.map((r) => `${r.category} (${prMoney(r.variance)} over)`).join(" and ")}.`,
      );
    } else {
      parts.push("Every budget category came in at or under budget.");
    }
  }

  if (cash.accounts.length) {
    let s = `Cash on hand is ${prMoney(cash.totalCash)}`;
    if (cash.runwayMonths !== null) s += `, about ${cash.runwayMonths.toFixed(1)} months of typical expenses`;
    s += ".";
    if (cash.restrictedTotal > 0) {
      s += ` Of our fund balances, ${prMoney(cash.restrictedTotal)} is set aside in restricted funds.`;
    }
    parts.push(s);
  }

  if (giving.giftCount > 0) {
    let s = `Giving recorded this month came to ${prMoney(giving.totalInPeriod)} across ${giving.giftCount} gift${giving.giftCount === 1 ? "" : "s"}.`;
    parts.push(s);
  }
  if (giving.pledges.rows.length && giving.pledges.totals.pct !== null) {
    parts.push(
      `Pledges are ${giving.pledges.totals.pct.toFixed(0)}% received (${prMoney(giving.pledges.totals.received)} of ${prMoney(giving.pledges.totals.committed)}).`,
    );
  }
  return parts.join(" ");
}

function prDefaultConfig(periodLabel) {
  return prConfigFromPreset(PR_PRESETS[0], periodLabel);
}

function prConfigFromPreset(preset, periodLabel) {
  const sections = {};
  PR_SECTIONS.forEach((s) => (sections[s.key] = preset.sections.includes(s.key)));
  const compare = {};
  PR_COMPARES.forEach((c) => (compare[c.key] = preset.compare.includes(c.key)));
  return { name: preset.name, sections, compare, periodLabel: periodLabel || "", treasurerNote: "" };
}

// Anything loaded from the database is normalized before use.
function prNormalizeConfig(raw, fallbackPeriod) {
  const base = prDefaultConfig(fallbackPeriod);
  if (!raw || typeof raw !== "object") return base;
  const sections = {};
  PR_SECTIONS.forEach((s) => {
    sections[s.key] = raw.sections && typeof raw.sections[s.key] === "boolean" ? raw.sections[s.key] : base.sections[s.key];
  });
  const compare = {};
  PR_COMPARES.forEach((c) => {
    compare[c.key] = raw.compare && typeof raw.compare[c.key] === "boolean" ? raw.compare[c.key] : base.compare[c.key];
  });
  return {
    name: typeof raw.name === "string" ? raw.name : base.name,
    sections,
    compare,
    // A saved template keeps its own label only if it was typed in; the
    // default follows the current month so "load" doesn't show a stale month.
    periodLabel: typeof raw.periodLabel === "string" && raw.periodLabel.trim() ? raw.periodLabel : fallbackPeriod || "",
    treasurerNote: typeof raw.treasurerNote === "string" ? raw.treasurerNote.slice(0, 6000) : "",
  };
}

// The structured packet: numbers, rows and text only (never HTML). The same
// object drives the on-screen preview, the PDF, and a share link's snapshot.
function prBuildSnapshot({ client, timeline, config, summary, notes, fnMap, branding }) {
  const cur = timeline[timeline.length - 1] || null;
  const periodKey = cur ? cur.key : null;
  const periodLabel = (config.periodLabel || "").trim() || (cur ? cur.full : "");
  const comparisons = prComparisons(timeline, prReportBudget(client)).filter((c) => config.compare[c.key]);
  const orgName = String(client.name || "");
  return {
    v: 1,
    orgName,
    title: `${orgName} board packet`,
    periodLabel,
    periodKey,
    generatedAt: new Date().toISOString(),
    branding: {
      logo: prValidLogo(branding && branding.logo),
      color: prValidHex(branding && branding.color),
    },
    sections: PR_SECTIONS.map((s) => s.key).filter((k) => config.sections[k]),
    summary: String(summary || ""),
    treasurerNote: String(config.treasurerNote || ""),
    incomeExpense: {
      current: cur ? { label: cur.label, income: cur.income, expenses: cur.expenses, net: cur.income - cur.expenses } : null,
      months: timeline.slice(-12).map((t) => ({ label: t.label, income: t.income, expenses: t.expenses, net: t.income - t.expenses })),
      comparisons,
    },
    budget: prBudgetSection(prReportBudget(client), notes),
    cash: prCashSection(client, timeline),
    giving: prGivingSection(client, periodKey),
    functional: prFunctionalSection(prExpenseRows(client), fnMap, cur ? cur.full : periodLabel),
  };
}

// ---------------------------------------------------------------------------
// PDF (jsPDF + autotable), built only from a snapshot
// ---------------------------------------------------------------------------

// jsPDF's built-in Helvetica is Latin-1 only; smart punctuation would print
// as garbage.
function prPdfText(s) {
  return String(s === null || s === undefined ? "" : s)
    .replace(/[‒–—―]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, "...")
    .replace(/[ ]/g, " ")
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA1-\xFF]/g, "");
}

function prPdfTableTheme(extra) {
  return {
    theme: "striped",
    styles: { fontSize: 9, cellPadding: 3, textColor: [5, 8, 13] },
    headStyles: { fillColor: [5, 8, 13], textColor: [250, 249, 246], fontStyle: "bold" },
    footStyles: { fillColor: [199, 174, 134], textColor: [5, 8, 13], fontStyle: "bold" },
    margin: { left: 14, right: 14, top: 22, bottom: 18 },
    ...extra,
  };
}

function prBuildPacketPdf(snap) {
  const JsPDF = window.jspdf && window.jspdf.jsPDF;
  if (!JsPDF) throw new Error("The PDF library hasn't loaded.");
  const doc = new JsPDF();
  if (typeof doc.autoTable !== "function") throw new Error("The PDF table add-on hasn't loaded.");
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const brand = prHexToRgb(snap.branding && snap.branding.color) || [5, 8, 13];
  const gold = [199, 174, 134];
  const muted = [110, 110, 110];
  const ink = [5, 8, 13];
  const T = prPdfText;
  const labelFor = (k) => (PR_SECTIONS.find((s) => s.key === k) || {}).label || k;
  const logo = prValidLogo(snap.branding && snap.branding.logo);

  const addLogo = (x, y, maxW, maxH) => {
    if (!logo) return 0;
    try {
      const props = doc.getImageProperties(logo);
      const ratio = props.width / props.height || 1;
      let w = maxW;
      let h = w / ratio;
      if (h > maxH) {
        h = maxH;
        w = h * ratio;
      }
      doc.addImage(logo, logo.indexOf("image/png") > -1 ? "PNG" : "JPEG", x, y, w, h);
      return h;
    } catch (e) {
      return 0;
    }
  };

  const content = (snap.sections || []).filter((k) => k !== "cover" && PR_SECTIONS.some((s) => s.key === k));
  const hasCover = (snap.sections || []).includes("cover");
  const hasToc = content.length >= 2;
  let firstPageUsed = false;
  const newPage = () => {
    if (firstPageUsed) doc.addPage();
    firstPageUsed = true;
  };

  // Cover
  if (hasCover) {
    newPage();
    doc.setFillColor(brand[0], brand[1], brand[2]);
    doc.rect(0, 0, W, 10, "F");
    let y = 60;
    const lh = addLogo(W / 2 - 35, 30, 70, 40);
    if (lh) y = 30 + lh + 20;
    doc.setTextColor(ink[0], ink[1], ink[2]);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(24);
    doc.splitTextToSize(T(snap.orgName), W - 40).forEach((line) => {
      doc.text(line, W / 2, y, { align: "center" });
      y += 10;
    });
    y += 4;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(16);
    doc.text("Board packet", W / 2, y, { align: "center" });
    y += 9;
    doc.setFontSize(12);
    doc.setTextColor(muted[0], muted[1], muted[2]);
    doc.text(T(snap.periodLabel), W / 2, y, { align: "center" });
    doc.setDrawColor(brand[0], brand[1], brand[2]);
    doc.setLineWidth(0.8);
    doc.line(W / 2 - 30, y + 8, W / 2 + 30, y + 8);
    doc.setFontSize(9);
    doc.text(T(`Prepared ${prDateLabel(snap.generatedAt)} with MyGoodBooks`), W / 2, H - 20, { align: "center" });
  }

  let tocPage = null;
  if (hasToc) {
    newPage();
    tocPage = doc.getNumberOfPages();
  }

  const header = (title) => {
    doc.setTextColor(ink[0], ink[1], ink[2]);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.text(T(title), 14, 32);
    return 40;
  };

  const ensure = (y, need) => {
    if (y + need > H - 20) {
      doc.addPage();
      return 28;
    }
    return y;
  };

  const paragraph = (text, y, opts = {}) => {
    doc.setFont("helvetica", opts.bold ? "bold" : "normal");
    doc.setFontSize(opts.size || 10.5);
    const c = opts.color || ink;
    doc.setTextColor(c[0], c[1], c[2]);
    const paras = T(text).split(/\n{2,}/);
    paras.forEach((p, pi) => {
      doc.splitTextToSize(p.replace(/\n/g, " "), W - 28).forEach((line) => {
        y = ensure(y, 6);
        doc.text(line, 14, y);
        y += opts.lh || 5.6;
      });
      if (pi < paras.length - 1) y += 3;
    });
    return y;
  };

  const table = (y, cfg) => {
    const cs = cfg.columnStyles || {};
    doc.autoTable(
      prPdfTableTheme({
        startY: y,
        ...cfg,
        // Header and footer cells follow their column's alignment too.
        didParseCell: (data) => {
          const c = cs[data.column.index];
          if (data.section !== "body" && c && c.halign) data.cell.styles.halign = c.halign;
        },
      }),
    );
    return doc.lastAutoTable.finalY + 8;
  };

  const right = (cols) => {
    const o = {};
    cols.forEach((c) => (o[c] = { halign: "right" }));
    return o;
  };

  const compareTable = (y, comparisons) => {
    const body = [];
    comparisons.forEach((c) => {
      if (!c.available) {
        body.push([T(c.label), { content: T(c.reason), colSpan: 5, styles: { textColor: muted, fontStyle: "italic" } }]);
        return;
      }
      c.rows.forEach((r, i) => {
        body.push([
          i === 0 ? T(`${c.label}\n(${c.currentLabel} vs ${c.baseLabel})`) : "",
          T(r.line),
          prMoney(r.current),
          prMoney(r.base),
          prSignedMoney(r.diff),
          T(prPct(r.pct, true)),
        ]);
      });
    });
    return table(y, {
      head: [["Comparison", "Line", "This period", "Compared to", "$ change", "% change"]],
      body,
      columnStyles: { 0: { cellWidth: 46 }, ...right([2, 3, 4, 5]) },
    });
  };

  const drawers = {
    summary: (y) => paragraph(snap.summary || "No summary written for this period.", y),
    treasurer: (y) => paragraph(snap.treasurerNote || "No note this period.", y),
    incomeExpense: (y) => {
      const ie = snap.incomeExpense || {};
      if (ie.current) {
        y = paragraph(
          `${ie.current.label}: income ${prMoney(ie.current.income)}, expenses ${prMoney(ie.current.expenses)}, net ${prSignedMoney(ie.current.net)}.`,
          y,
          { bold: true },
        );
        y += 3;
      }
      if ((ie.comparisons || []).length) y = compareTable(y, ie.comparisons);
      y = ensure(y, 20);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(ink[0], ink[1], ink[2]);
      doc.text("Month by month", 14, y);
      return table(y + 3, {
        head: [["Month", "Income", "Expenses", "Net"]],
        body: (ie.months || []).map((m) => [T(m.label), prMoney(m.income), prMoney(m.expenses), prSignedMoney(m.net)]),
        columnStyles: right([1, 2, 3]),
      });
    },
    budget: (y) => {
      const b = snap.budget || { rows: [], totals: {} };
      if (!b.rows.length) return paragraph("No budget is set for this month yet.", y);
      const hasNotes = b.rows.some((r) => r.note);
      const head = ["Category", "Budgeted", "Actual", "Variance", "%"];
      if (hasNotes) head.push("Note");
      y = table(y, {
        head: [head],
        body: b.rows.map((r) => {
          const row = [T(r.category), prMoney(r.budgeted), prMoney(r.actual), prSignedMoney(r.variance), T(prPct(r.pct, true))];
          if (hasNotes) row.push(T(r.note));
          return row;
        }),
        foot: [
          (() => {
            const f = ["Total", prMoney(b.totals.budgeted), prMoney(b.totals.actual), prSignedMoney(b.totals.variance), T(prPct(b.totals.pct, true))];
            if (hasNotes) f.push("");
            return f;
          })(),
        ],
        columnStyles: { ...right([1, 2, 3, 4]), ...(hasNotes ? { 5: { cellWidth: 55 } } : {}) },
      });
      return paragraph("Variance is actual less budgeted; a positive number means spending ran over.", y, { size: 8.5, color: muted, lh: 4.5 });
    },
    cash: (y) => {
      const c = snap.cash || { accounts: [], funds: [] };
      if (c.accounts.length) {
        y = table(y, {
          head: [["Account", "Type", "Balance"]],
          body: c.accounts.map((a) => [T(a.name), T(a.type), prMoney(a.balance)]),
          foot: [["Total cash", "", prMoney(c.totalCash)]],
          columnStyles: right([2]),
        });
      } else {
        y = paragraph("No bank accounts connected yet.", y);
      }
      if (c.runwayMonths !== null && c.runwayMonths !== undefined) {
        y = paragraph(`Operating reserve: about ${c.runwayMonths.toFixed(1)} months of typical expenses.`, y);
        y += 2;
      }
      if (c.funds.length) {
        y = ensure(y, 30);
        y = table(y, {
          head: [["Fund", "Type", "Balance"]],
          body: c.funds.map((f) => [T(f.name), f.restricted ? "Restricted" : "Unrestricted", prMoney(f.balance)]),
          foot: [["Restricted / unrestricted", "", `${prMoney(c.restrictedTotal)} / ${prMoney(c.unrestrictedTotal)}`]],
          columnStyles: right([2]),
        });
      }
      if (c.receivablesTotal || c.payablesTotal) {
        y = paragraph(`Money owed to us: ${prMoney(c.receivablesTotal)}. Bills to pay: ${prMoney(c.payablesTotal)}.`, y);
      }
      return y;
    },
    giving: (y) => {
      const g = snap.giving;
      if (!g || !g.hasAnyGifts) {
        y = paragraph("No giving recorded yet.", y);
      } else {
        y = paragraph(`${g.periodLabel}: ${prMoney(g.totalInPeriod)} from ${g.giftCount} gift${g.giftCount === 1 ? "" : "s"}.`, y, { bold: true });
        y += 2;
        if (g.topDonors.length) {
          y = table(y, {
            head: [["Top donors", "Gifts", "Total"]],
            body: g.topDonors.map((d) => [T(d.donor), String(d.gifts), prMoney(d.total)]),
            foot: g.anonymousTotal ? [["Anonymous gifts (combined)", "", prMoney(g.anonymousTotal)]] : undefined,
            columnStyles: right([1, 2]),
          });
        }
        y = ensure(y, 24);
        if (g.lapsed.available) {
          if (g.lapsed.rows.length) {
            y = table(y, {
              head: [["Lapsed donors (no gift in 90 days)", "Last gift", "Past 12 months"]],
              body: g.lapsed.rows.map((r) => [T(r.donor), T(prDateLabel(r.lastGift)), prMoney(r.total12)]),
              columnStyles: right([2]),
            });
          } else {
            y = paragraph("Lapsed donors: none. Everyone who gave in the past year has given in the last 90 days.", y);
            y += 2;
          }
        } else {
          y = paragraph(`Lapsed donors: ${g.lapsed.reason}`, y, { color: muted });
          y += 2;
        }
        if (g.byFund.rows.length) {
          y = ensure(y, 24);
          y = table(y, {
            head: [["Giving by fund", ...g.byFund.months.map(T), "Total"]],
            body: g.byFund.rows.map((r) => [T(r.fund), ...r.values.map(prMoney), prMoney(r.total)]),
            columnStyles: right(g.byFund.months.map((_, i) => i + 1).concat([g.byFund.months.length + 1])),
          });
        }
      }
      if (g && g.pledges.rows.length) {
        y = ensure(y, 24);
        const t = g.pledges.totals;
        y = table(y, {
          head: [["Pledge", "Fund", "Committed", "Received", "Remaining", "%"]],
          body: g.pledges.rows.map((r) => [T(r.donor), T(r.fund), prMoney(r.committed), prMoney(r.received), prMoney(r.remaining), T(prPct(r.pct))]),
          foot: [["Total", "", prMoney(t.committed), prMoney(t.received), prMoney(t.remaining), T(prPct(t.pct))]],
          columnStyles: right([2, 3, 4, 5]),
        });
      }
      return y;
    },
    functional: (y) => {
      const f = snap.functional;
      if (!f || !f.rows.length) return paragraph("No expense categories for this month yet.", y);
      y = paragraph(f.periodLabel, y, { color: muted, size: 9.5 });
      y += 1;
      y = table(y, {
        head: [["Expense", "(A) Total", "(B) Program services", "(C) Management & general", "(D) Fundraising"]],
        body: f.rows.map((r) => [
          T(r.category),
          prMoney(r.total),
          r.program ? prMoney(r.program) : "",
          r.management ? prMoney(r.management) : "",
          r.fundraising ? prMoney(r.fundraising) : "",
        ]),
        foot: [
          ["Total functional expenses", prMoney(f.totals.total), prMoney(f.totals.program), prMoney(f.totals.management), prMoney(f.totals.fundraising)],
          ["% of total", f.totals.total ? "100%" : "-", T(prPct(f.pct.program)), T(prPct(f.pct.management)), T(prPct(f.pct.fundraising))],
        ],
        columnStyles: right([1, 2, 3, 4]),
      });
      return paragraph("Laid out like Form 990, Part IX. Each category is assigned wholly to one function.", y, { size: 8.5, color: muted, lh: 4.5 });
    },
  };

  const starts = [];
  content.forEach((key) => {
    newPage();
    starts.push({ key, page: doc.getNumberOfPages() });
    const y = header(labelFor(key));
    try {
      drawers[key](y);
    } catch (e) {
      paragraph("This section couldn't be drawn.", y);
    }
  });

  if (!firstPageUsed) {
    newPage();
    paragraph("No sections were chosen for this packet.", 40);
  }

  if (tocPage) {
    doc.setPage(tocPage);
    let y = header("Contents");
    doc.setFontSize(11);
    starts.forEach((s) => {
      doc.setFont("helvetica", "normal");
      doc.setTextColor(ink[0], ink[1], ink[2]);
      const label = T(labelFor(s.key));
      doc.text(label, 14, y);
      doc.text(String(s.page), W - 14, y, { align: "right" });
      const lw = doc.getTextWidth(label);
      const pw = doc.getTextWidth(String(s.page));
      doc.setDrawColor(gold[0], gold[1], gold[2]);
      doc.setLineDashPattern([0.6, 1.2], 0);
      doc.line(14 + lw + 3, y, W - 14 - pw - 3, y);
      doc.setLineDashPattern([], 0);
      y += 9;
    });
  }

  // Header rule and footer on every page but the cover.
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    if (hasCover && i === 1) continue;
    doc.setPage(i);
    doc.setDrawColor(brand[0], brand[1], brand[2]);
    doc.setLineWidth(0.8);
    doc.line(14, 16, W - 14, 16);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(muted[0], muted[1], muted[2]);
    doc.text(T(snap.orgName), 14, 12);
    doc.text(T(snap.periodLabel), W - 14, 12, { align: "right" });
    doc.text(`Page ${i} of ${n}`, W - 14, H - 10, { align: "right" });
  }
  return doc;
}

function prPacketFilename(snap) {
  return `${snap.orgName} board packet ${snap.periodLabel}`.replace(/[\\/:*?"<>|]/g, "").trim() + ".pdf";
}

// ---------------------------------------------------------------------------
// Logo downscaling
// ---------------------------------------------------------------------------

function prDownscaleLogo(file) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\/(png|jpeg)$/.test(file.type)) {
      reject(new Error("Please choose a PNG or JPEG image."));
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      reject(new Error("That image is over 10 MB. Please choose a smaller one."));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Couldn't read that file."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Couldn't open that image."));
      img.onload = () => {
        try {
          const scale = Math.min(1, 400 / (img.naturalWidth || img.width || 400));
          const w = Math.max(1, Math.round((img.naturalWidth || img.width) * scale));
          const h = Math.max(1, Math.round((img.naturalHeight || img.height) * scale));
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d");
          const LIMIT = 300000;
          if (file.type === "image/png") {
            ctx.drawImage(img, 0, 0, w, h);
            const png = canvas.toDataURL("image/png");
            if (png.length <= LIMIT) {
              resolve(png);
              return;
            }
          }
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          for (const q of [0.92, 0.85, 0.75, 0.6, 0.45]) {
            const jpg = canvas.toDataURL("image/jpeg", q);
            if (jpg.length <= LIMIT) {
              resolve(jpg);
              return;
            }
          }
          reject(new Error("That image is too detailed to store. Try a simpler logo."));
        } catch (e) {
          reject(new Error("Couldn't process that image."));
        }
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// ---------------------------------------------------------------------------
// Read-only renderers (shared by the suite preview and the public share page)
// ---------------------------------------------------------------------------

function PrParagraphs({ text, empty }) {
  const t = String(text || "").trim();
  if (!t) return <p className="pr-muted">{empty}</p>;
  return t.split(/\n{2,}/).map((p, i) => (
    <p key={i} className="pr-para">
      {p}
    </p>
  ));
}

function PrUnavailable({ children }) {
  return <p className="pr-unavailable">{children}</p>;
}

function PrComparisonCards({ comparisons }) {
  if (!comparisons || !comparisons.length) {
    return <p className="pr-muted">No comparisons chosen.</p>;
  }
  return (
    <div className="pr-compare-grid">
      {comparisons.map((c) => (
        <div className="pr-compare-card" key={c.key}>
          <div className="pr-compare-head">
            <strong>{c.label}</strong>
            {c.available && (
              <span className="pr-muted">
                {c.currentLabel} vs {c.baseLabel}
              </span>
            )}
          </div>
          {!c.available ? (
            <PrUnavailable>{c.reason}</PrUnavailable>
          ) : (
            <div className="pr-table-wrap">
              <table className="tx-table pr-table">
                <thead>
                  <tr>
                    <th></th>
                    <th className="num">This period</th>
                    <th className="num">Compared to</th>
                    <th className="num">$ change</th>
                    <th className="num">% change</th>
                  </tr>
                </thead>
                <tbody>
                  {c.rows.map((r) => (
                    <tr key={r.line}>
                      <td>{r.line}</td>
                      <td className="num">{prMoney(r.current)}</td>
                      <td className="num">{prMoney(r.base)}</td>
                      <td className={"num " + prToneClass(r.kind, r.diff)}>{prSignedMoney(r.diff)}</td>
                      <td className={"num " + prToneClass(r.kind, r.diff)}>{prPct(r.pct, true)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function PrIncomeExpenseBlock({ ie }) {
  if (!ie || !ie.current) return <p className="pr-muted">No monthly numbers yet.</p>;
  const c = ie.current;
  return (
    <div>
      <div className="pr-kpis">
        <div className="pr-kpi">
          <span className="kpi-label">Income, {c.label}</span>
          <strong>{prMoney(c.income)}</strong>
        </div>
        <div className="pr-kpi">
          <span className="kpi-label">Expenses</span>
          <strong>{prMoney(c.expenses)}</strong>
        </div>
        <div className="pr-kpi">
          <span className="kpi-label">Net</span>
          <strong className={c.net >= 0 ? "pr-good" : "pr-bad"}>{prSignedMoney(c.net)}</strong>
        </div>
      </div>
      {(ie.comparisons || []).length > 0 && <PrComparisonCards comparisons={ie.comparisons} />}
      <h4 className="pr-subhead">Month by month</h4>
      <div className="pr-table-wrap">
        <table className="tx-table pr-table">
          <thead>
            <tr>
              <th>Month</th>
              <th className="num">Income</th>
              <th className="num">Expenses</th>
              <th className="num">Net</th>
            </tr>
          </thead>
          <tbody>
            {ie.months.map((m) => (
              <tr key={m.label}>
                <td>{m.label}</td>
                <td className="num">{prMoney(m.income)}</td>
                <td className="num">{prMoney(m.expenses)}</td>
                <td className={"num " + (m.net >= 0 ? "pr-good" : "pr-bad")}>{prSignedMoney(m.net)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PrBudgetBlock({ budget }) {
  if (!budget || !budget.rows.length) return <p className="pr-muted">No budget is set for this month yet.</p>;
  return (
    <div className="pr-table-wrap">
      <table className="tx-table pr-table">
        <thead>
          <tr>
            <th>Category</th>
            <th className="num">Budgeted</th>
            <th className="num">Actual</th>
            <th className="num">Variance</th>
            <th className="num">%</th>
            <th>Note</th>
          </tr>
        </thead>
        <tbody>
          {budget.rows.map((r) => (
            <tr key={r.category}>
              <td>{r.category}</td>
              <td className="num">{prMoney(r.budgeted)}</td>
              <td className="num">{prMoney(r.actual)}</td>
              <td className={"num " + prToneClass("expense", r.variance)}>{prSignedMoney(r.variance)}</td>
              <td className={"num " + prToneClass("expense", r.variance)}>{prPct(r.pct, true)}</td>
              <td className="pr-note-cell">{r.note || <span className="pr-muted">—</span>}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="pr-total-row">
            <td>Total</td>
            <td className="num">{prMoney(budget.totals.budgeted)}</td>
            <td className="num">{prMoney(budget.totals.actual)}</td>
            <td className="num">{prSignedMoney(budget.totals.variance)}</td>
            <td className="num">{prPct(budget.totals.pct, true)}</td>
            <td></td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function PrCashBlock({ cash }) {
  if (!cash) return null;
  return (
    <div>
      <div className="pr-kpis">
        <div className="pr-kpi">
          <span className="kpi-label">Cash on hand</span>
          <strong>{cash.accounts.length ? prMoney(cash.totalCash) : "—"}</strong>
        </div>
        <div className="pr-kpi">
          <span className="kpi-label">Operating reserve</span>
          <strong>{cash.runwayMonths !== null && cash.runwayMonths !== undefined ? `${cash.runwayMonths.toFixed(1)} months` : "—"}</strong>
        </div>
        {cash.funds.length > 0 && (
          <div className="pr-kpi">
            <span className="kpi-label">Restricted funds</span>
            <strong>{prMoney(cash.restrictedTotal)}</strong>
          </div>
        )}
      </div>
      {cash.accounts.length > 0 && (
        <div className="pr-table-wrap">
          <table className="tx-table pr-table">
            <thead>
              <tr>
                <th>Account</th>
                <th>Type</th>
                <th className="num">Balance</th>
              </tr>
            </thead>
            <tbody>
              {cash.accounts.map((a, i) => (
                <tr key={a.name + i}>
                  <td>{a.name}</td>
                  <td>{a.type}</td>
                  <td className="num">{prMoney(a.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {cash.funds.length > 0 && (
        <div className="pr-table-wrap">
          <table className="tx-table pr-table">
            <thead>
              <tr>
                <th>Fund</th>
                <th>Type</th>
                <th className="num">Balance</th>
              </tr>
            </thead>
            <tbody>
              {cash.funds.map((f) => (
                <tr key={f.name}>
                  <td>{f.name}</td>
                  <td>
                    <span className={"pill " + (f.restricted ? "restricted" : "unrestricted")}>
                      {f.restricted ? "Restricted" : "Unrestricted"}
                    </span>
                  </td>
                  <td className="num">{prMoney(f.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(cash.receivablesTotal > 0 || cash.payablesTotal > 0) && (
        <p className="pr-muted">
          Money owed to us: {prMoney(cash.receivablesTotal)}. Bills to pay: {prMoney(cash.payablesTotal)}.
        </p>
      )}
    </div>
  );
}

function PrGivingBlock({ giving }) {
  const g = giving;
  if (!g) return null;
  return (
    <div>
      {!g.hasAnyGifts ? (
        <p className="pr-muted">No giving recorded yet.</p>
      ) : (
        <>
          <div className="pr-kpis">
            <div className="pr-kpi">
              <span className="kpi-label">Giving, {g.periodLabel}</span>
              <strong>{prMoney(g.totalInPeriod)}</strong>
            </div>
            <div className="pr-kpi">
              <span className="kpi-label">Gifts</span>
              <strong>{g.giftCount}</strong>
            </div>
            {g.pledges.rows.length > 0 && (
              <div className="pr-kpi">
                <span className="kpi-label">Pledges received</span>
                <strong>{prPct(g.pledges.totals.pct)}</strong>
              </div>
            )}
          </div>

          <h4 className="pr-subhead">Top donors, {g.periodLabel}</h4>
          {g.topDonors.length ? (
            <div className="pr-table-wrap">
              <table className="tx-table pr-table">
                <thead>
                  <tr>
                    <th>Donor</th>
                    <th className="num">Gifts</th>
                    <th className="num">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {g.topDonors.map((d) => (
                    <tr key={d.donor}>
                      <td>{d.donor}</td>
                      <td className="num">{d.gifts}</td>
                      <td className="num">{prMoney(d.total)}</td>
                    </tr>
                  ))}
                  {g.anonymousTotal > 0 && (
                    <tr>
                      <td className="pr-muted">Anonymous gifts (combined)</td>
                      <td className="num"></td>
                      <td className="num">{prMoney(g.anonymousTotal)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="pr-muted">No named gifts recorded for {g.periodLabel}.</p>
          )}

          <h4 className="pr-subhead">Lapsed donors</h4>
          <p className="pr-hint">Gave in the past 12 months, but nothing in the last 90 days.</p>
          {!g.lapsed.available ? (
            <PrUnavailable>{g.lapsed.reason}</PrUnavailable>
          ) : g.lapsed.rows.length ? (
            <div className="pr-table-wrap">
              <table className="tx-table pr-table">
                <thead>
                  <tr>
                    <th>Donor</th>
                    <th>Last gift</th>
                    <th className="num">Past 12 months</th>
                  </tr>
                </thead>
                <tbody>
                  {g.lapsed.rows.map((r) => (
                    <tr key={r.donor}>
                      <td>{r.donor}</td>
                      <td>{prDateLabel(r.lastGift)}</td>
                      <td className="num">{prMoney(r.total12)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="pr-muted">None. Everyone who gave in the past year has given in the last 90 days.</p>
          )}

          {g.byFund.rows.length > 0 && (
            <>
              <h4 className="pr-subhead">Giving by fund</h4>
              <div className="pr-table-wrap">
                <table className="tx-table pr-table">
                  <thead>
                    <tr>
                      <th>Fund</th>
                      {g.byFund.months.map((m) => (
                        <th className="num" key={m}>
                          {m}
                        </th>
                      ))}
                      <th className="num">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.byFund.rows.map((r) => (
                      <tr key={r.fund}>
                        <td>{r.fund}</td>
                        {r.values.map((v, i) => (
                          <td className="num" key={i}>
                            {v ? prMoney(v) : <span className="pr-muted">—</span>}
                          </td>
                        ))}
                        <td className="num">
                          <strong>{prMoney(r.total)}</strong>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}

      {g.pledges.rows.length > 0 && (
        <>
          <h4 className="pr-subhead">Pledge progress</h4>
          <div className="pr-pledges">
            {g.pledges.rows.map((r, i) => (
              <div className="pr-pledge" key={r.donor + i}>
                <div className="pr-pledge-top">
                  <span>
                    <strong>{r.donor}</strong> <span className="pr-muted">· {r.fund}</span>
                  </span>
                  <span>
                    {prMoney(r.received)} of {prMoney(r.committed)}
                  </span>
                </div>
                <div className="pr-bar" aria-hidden="true">
                  <span style={{ width: `${Math.min(100, Math.max(0, r.pct || 0))}%` }} />
                </div>
                <div className="pr-hint">
                  {prPct(r.pct)} received
                  {r.remaining > 0 ? `, ${prMoney(r.remaining)} to go` : ", complete"}
                  {r.dueDate ? ` · due ${prDateLabel(r.dueDate)}` : ""}
                </div>
              </div>
            ))}
            <div className="pr-hint">
              Overall: {prMoney(g.pledges.totals.received)} received of {prMoney(g.pledges.totals.committed)} committed ({prPct(g.pledges.totals.pct)}).
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function PrFunctionalTable({ functional }) {
  const f = functional;
  if (!f || !f.rows.length) return <p className="pr-muted">No expense categories for this month yet.</p>;
  const cell = (v) => (v ? prMoney(v) : <span className="pr-muted">—</span>);
  return (
    <div>
      <p className="pr-hint">{f.periodLabel}</p>
      <div className="pr-table-wrap">
        <table className="tx-table pr-table pr-990">
          <thead>
            <tr>
              <th>Expense</th>
              <th className="num">(A) Total</th>
              <th className="num">(B) Program services</th>
              <th className="num">(C) Management &amp; general</th>
              <th className="num">(D) Fundraising</th>
            </tr>
          </thead>
          <tbody>
            {f.rows.map((r) => (
              <tr key={r.category}>
                <td>{r.category}</td>
                <td className="num">{prMoney(r.total)}</td>
                <td className="num">{cell(r.program)}</td>
                <td className="num">{cell(r.management)}</td>
                <td className="num">{cell(r.fundraising)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="pr-total-row">
              <td>Total functional expenses</td>
              <td className="num">{prMoney(f.totals.total)}</td>
              <td className="num">{prMoney(f.totals.program)}</td>
              <td className="num">{prMoney(f.totals.management)}</td>
              <td className="num">{prMoney(f.totals.fundraising)}</td>
            </tr>
            <tr className="pr-pct-row">
              <td>% of total</td>
              <td className="num">{f.totals.total ? "100%" : "—"}</td>
              <td className="num">{prPct(f.pct.program)}</td>
              <td className="num">{prPct(f.pct.management)}</td>
              <td className="num">{prPct(f.pct.fundraising)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function PrSnapshotView({ snap, showCover }) {
  if (!snap) return null;
  const labelFor = (k) => (PR_SECTIONS.find((s) => s.key === k) || {}).label || k;
  const color = prValidHex(snap.branding && snap.branding.color);
  const logo = prValidLogo(snap.branding && snap.branding.logo);
  const body = (key) => {
    switch (key) {
      case "summary":
        return <PrParagraphs text={snap.summary} empty="No summary written for this period." />;
      case "treasurer":
        return <PrParagraphs text={snap.treasurerNote} empty="No note this period." />;
      case "incomeExpense":
        return <PrIncomeExpenseBlock ie={snap.incomeExpense} />;
      case "budget":
        return <PrBudgetBlock budget={snap.budget} />;
      case "cash":
        return <PrCashBlock cash={snap.cash} />;
      case "giving":
        return <PrGivingBlock giving={snap.giving} />;
      case "functional":
        return <PrFunctionalTable functional={snap.functional} />;
      default:
        return null;
    }
  };
  const sections = (snap.sections || []).filter((k) => k !== "cover" && PR_SECTIONS.some((s) => s.key === k));
  return (
    <div className="pr-snapshot">
      {showCover && (snap.sections || []).includes("cover") && (
        <div className="pr-cover" style={color ? { borderTopColor: color } : undefined}>
          {logo && <img className="pr-cover-logo" src={logo} alt="" />}
          <div className="pr-cover-org">{snap.orgName}</div>
          <div className="pr-cover-title">Board packet</div>
          <div className="pr-cover-period">{snap.periodLabel}</div>
        </div>
      )}
      {sections.length === 0 && <p className="pr-muted">No sections chosen.</p>}
      {sections.map((k) => (
        <section className="pr-snap-section" key={k} style={color ? { borderLeftColor: color } : undefined}>
          <h3 className="pr-snap-title">{labelFor(k)}</h3>
          {body(k)}
        </section>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Public share page — no login, no staff context
// ---------------------------------------------------------------------------

function ReportShareView({ token }) {
  const [state, setState] = React.useState({ status: "loading", row: null });

  React.useEffect(() => {
    let cancelled = false;
    const t = String(token || "");
    if (!/^[0-9a-fA-F]{32,128}$/.test(t)) {
      setState({ status: "missing", row: null });
      return undefined;
    }
    const sb = window.mgbSupabase;
    if (!sb || typeof sb.rpc !== "function") {
      setState({ status: "error", row: null });
      return undefined;
    }
    (async () => {
      try {
        const { data, error } = await sb.rpc("get_report_share", { p_token: t });
        if (cancelled) return;
        if (error) {
          setState({ status: "error", row: null });
          return;
        }
        const row = Array.isArray(data) ? data[0] : data;
        if (!row || !row.snapshot || typeof row.snapshot !== "object") {
          setState({ status: "missing", row: null });
          return;
        }
        setState({ status: "ok", row });
      } catch (e) {
        if (!cancelled) setState({ status: "error", row: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const row = state.row;
  const snap = row && row.snapshot;
  const color = snap ? prValidHex(snap.branding && snap.branding.color) : null;
  const logo = snap ? prValidLogo(snap.branding && snap.branding.logo) : null;

  React.useEffect(() => {
    if (row) document.title = `${row.title || "Report"} · MyGoodBooks`;
  }, [row]);

  const download = () => {
    try {
      const doc = prBuildPacketPdf(snap);
      doc.save(prPacketFilename(snap));
    } catch (e) {
      window.alert("Sorry, the PDF couldn't be made in this browser.");
    }
  };

  return (
    <div className="pr-share-page">
      <div className="pr-share-inner">
        {state.status === "loading" && (
          <div className="card pr-share-message">
            <p className="pr-muted">Opening the report…</p>
          </div>
        )}
        {(state.status === "missing" || state.status === "error") && (
          <div className="card pr-share-message">
            <h1 className="pr-share-h1">
              {state.status === "missing" ? "This link isn't available" : "We couldn't open this report"}
            </h1>
            <p>
              {state.status === "missing"
                ? "It may have expired or been turned off by whoever shared it. Please ask them for a new link."
                : "Something went wrong reaching the report. Please check your connection and try again in a moment."}
            </p>
          </div>
        )}
        {state.status === "ok" && snap && (
          <>
            <header className="pr-share-header" style={color ? { borderBottomColor: color } : undefined}>
              <div className="pr-share-brand">
                {logo && <img className="pr-share-logo" src={logo} alt="" />}
                <div>
                  <div className="pr-share-org">{row.client_name || snap.orgName}</div>
                  <h1 className="pr-share-h1">{row.title || "Board packet"}</h1>
                  <div className="pr-muted">{snap.periodLabel}</div>
                </div>
              </div>
              <button type="button" className="btn-primary" onClick={download}>
                Download PDF
              </button>
            </header>
            <p className="pr-share-note">
              A read-only copy shared from MyGoodBooks on {prDateLabel(row.created_at)}. This link works until{" "}
              {prDateLabel(row.expires_at)}.
            </p>
            <div className="card">
              <PrSnapshotView snap={snap} showCover={false} />
            </div>
            <footer className="pr-share-footer">Prepared with MyGoodBooks</footer>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The suite (signed-in Pro client or staff)
// ---------------------------------------------------------------------------

const PR_TABS = [
  { key: "packet", label: "Board packet" },
  { key: "summary", label: "This month's summary" },
  { key: "compare", label: "Comparisons" },
  { key: "giving", label: "Giving" },
  { key: "functional", label: "Functional expenses" },
  { key: "share", label: "Share links" },
  { key: "brand", label: "Logo & colours" },
];

function ProReportsSuite({ client, access, clientPortalUser }) {
  const showToast = (typeof useToast === "function" && useToast()) || (() => {});
  const staffCtx = useContext(StaffToolsContext) || {};
  const who = (staffCtx.staff && staffCtx.staffUser) || clientPortalUser || null;
  const whoEmail = (who && who.email) || null;
  const sb = window.mgbSupabase || null;
  const clientId = client && client.id;

  // Closed months only, so the packet defaults to the last closed month
  // rather than a QuickBooks client's month-to-date row.
  const timeline = useMemo(
    () => prTimeline(window.mgbClosedMonths(client && client.monthly)),
    [client && client.monthly],
  );
  const current = timeline[timeline.length - 1] || null;
  const periodKey = current ? current.key : null;
  const defaultPeriodLabel = current ? current.full : "";

  const [tab, setTab] = useState("packet");
  const [config, setConfig] = useState(() => prDefaultConfig(defaultPeriodLabel));
  const [missing, setMissing] = useState(false);
  const [branding, setBranding] = useState({ logo: null, color: null });
  const [fnMap, setFnMap] = useState({});
  const [notes, setNotes] = useState({});
  const [summaryText, setSummaryText] = useState(null); // null = use the draft
  const [summarySavedAt, setSummarySavedAt] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [shares, setShares] = useState([]);
  const [busy, setBusy] = useState("");

  // The toast function changes identity whenever a toast shows; reading it
  // through a ref keeps the loaders below stable, so a toast never triggers a
  // reload (which would also overwrite an unsaved summary edit).
  const toastRef = useRef(showToast);
  toastRef.current = showToast;
  const flagError = useCallback((error, fallback) => {
    const isMissing = typeof isMissingTableError === "function" && isMissingTableError(error);
    if (isMissing) setMissing(true);
    if (fallback) toastRef.current(isMissing ? PR_SETUP_MSG : fallback);
  }, []);

  // Keep the default period label in step with the data.
  useEffect(() => {
    setConfig((c) => (c.periodLabel ? c : { ...c, periodLabel: defaultPeriodLabel }));
  }, [defaultPeriodLabel]);

  const loadTemplates = useCallback(async () => {
    if (!sb || !clientId) return;
    try {
      const { data, error } = await sb
        .from("client_report_templates")
        .select("id,name,config,created_by,updated_at")
        .eq("client_id", clientId)
        .order("name");
      if (error) flagError(error);
      else setTemplates(data || []);
    } catch (e) {
      /* keep working without saved templates */
    }
  }, [sb, clientId, flagError]);

  const loadShares = useCallback(async () => {
    if (!sb || !clientId) return;
    try {
      const { data, error } = await sb
        .from("client_report_shares")
        .select("id,token,title,created_by,created_at,expires_at,revoked_at")
        .eq("client_id", clientId)
        .order("created_at", { ascending: false });
      if (error) flagError(error);
      else setShares(data || []);
    } catch (e) {
      /* ignore */
    }
  }, [sb, clientId, flagError]);

  useEffect(() => {
    if (!sb || !clientId) return undefined;
    let cancelled = false;
    const run = async (fn) => {
      try {
        await fn();
      } catch (e) {
        /* never crash on a load */
      }
    };
    run(async () => {
      const { data, error } = await sb
        .from("client_branding")
        .select("logo_data_url,brand_color")
        .eq("client_id", clientId)
        .maybeSingle();
      if (cancelled) return;
      if (error) flagError(error);
      else if (data) setBranding({ logo: prValidLogo(data.logo_data_url), color: prValidHex(data.brand_color) });
    });
    run(async () => {
      const { data, error } = await sb
        .from("client_functional_map")
        .select("category,function")
        .eq("client_id", clientId);
      if (cancelled) return;
      if (error) flagError(error);
      else {
        const m = {};
        (data || []).forEach((r) => {
          if (PR_FUNCTIONS.some((f) => f.key === r.function)) m[r.category] = r.function;
        });
        setFnMap(m);
      }
    });
    if (periodKey) {
      run(async () => {
        const { data, error } = await sb
          .from("client_report_summaries")
          .select("summary,updated_at")
          .eq("client_id", clientId)
          .eq("period", periodKey)
          .maybeSingle();
        if (cancelled) return;
        if (error) flagError(error);
        else if (data && typeof data.summary === "string") {
          setSummaryText(data.summary);
          setSummarySavedAt(data.updated_at || null);
        }
      });
      run(async () => {
        // The budget page files notes under the calendar month (its budget
        // figures are "this month"), which can be a month past the latest
        // monthly row. Read both; the budget page's month wins.
        const now = new Date();
        const budgetPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
        const periods = [...new Set([periodKey, budgetPeriod].filter(Boolean))];
        const { data, error } = await sb
          .from("client_variance_notes")
          .select("category,note,period")
          .eq("client_id", clientId)
          .in("period", periods);
        if (cancelled) return;
        if (error) flagError(error);
        else {
          const m = {};
          (data || [])
            .slice()
            .sort((a, b) => (a.period === budgetPeriod) - (b.period === budgetPeriod))
            .forEach((r) => (m[r.category] = r.note));
          setNotes(m);
        }
      });
    }
    run(loadTemplates);
    run(loadShares);
    return () => {
      cancelled = true;
    };
  }, [sb, clientId, periodKey, flagError, loadTemplates, loadShares]);

  // Numbers
  const comparisonsAll = useMemo(() => prComparisons(timeline, prReportBudget(client)), [timeline, client]);
  const budgetSec = useMemo(() => prBudgetSection(prReportBudget(client), notes), [client, notes]);
  const cashSec = useMemo(() => prCashSection(client, timeline), [client, timeline]);
  const givingSec = useMemo(() => prGivingSection(client, periodKey), [client, periodKey]);
  const draft = useMemo(
    () =>
      prDraftSummary({
        orgName: client.name,
        timeline,
        comparisons: comparisonsAll,
        budget: budgetSec,
        cash: cashSec,
        giving: givingSec,
      }),
    [client.name, timeline, comparisonsAll, budgetSec, cashSec, givingSec],
  );
  const summary = summaryText === null ? draft : summaryText;

  const snapshot = useMemo(
    () => prBuildSnapshot({ client, timeline, config, summary, notes, fnMap, branding }),
    [client, timeline, config, summary, notes, fnMap, branding],
  );

  if (access && access.isCategoryScoped) return null;

  const noData = !timeline.length;
  const canSave = !!sb && !!clientId;
  const needSave = () => {
    if (!canSave) {
      showToast(PR_OFFLINE_MSG);
      return false;
    }
    return true;
  };

  // ---- actions ----
  const downloadPacket = () => {
    try {
      const doc = prBuildPacketPdf(snapshot);
      doc.save(prPacketFilename(snapshot));
      showToast("Board packet downloaded.");
    } catch (e) {
      showToast(e && e.message ? `Couldn't make the PDF. ${e.message}` : "Couldn't make the PDF.");
    }
  };

  const saveSummary = async () => {
    if (!needSave() || !periodKey) return;
    setBusy("summary");
    try {
      const now = new Date().toISOString();
      const { error } = await sb.from("client_report_summaries").upsert(
        { client_id: clientId, period: periodKey, summary: summary.slice(0, 6000), updated_by: whoEmail, updated_at: now },
        { onConflict: "client_id,period" },
      );
      if (error) flagError(error, "Couldn't save the summary.");
      else {
        setSummaryText(summary);
        setSummarySavedAt(now);
        showToast("Summary saved.");
      }
    } catch (e) {
      showToast("Couldn't save the summary.");
    }
    setBusy("");
  };

  const tabBody = () => {
    if (noData && tab !== "brand" && tab !== "share") {
      return (
        <p className="pr-muted">
          Reports need at least one month of numbers. Once this month's books are in, everything here fills in on its own.
        </p>
      );
    }
    switch (tab) {
      case "packet":
        return (
          <PrPacketPanel
            config={config}
            setConfig={setConfig}
            comparisons={comparisonsAll}
            snapshot={snapshot}
            onDownload={downloadPacket}
            templates={templates}
            reloadTemplates={loadTemplates}
            defaultPeriodLabel={defaultPeriodLabel}
            sb={sb}
            clientId={clientId}
            whoEmail={whoEmail}
            needSave={needSave}
            flagError={flagError}
            showToast={showToast}
          />
        );
      case "summary":
        return (
          <div className="pr-stack">
            <p className="card-subtitle">
              A plain-language paragraph for {current ? current.full : "this month"}, drafted from the numbers. Edit it however you
              like; it goes into the board packet and any share link.
            </p>
            <textarea
              className="pr-textarea"
              rows={9}
              maxLength={6000}
              value={summary}
              onChange={(e) => setSummaryText(e.target.value)}
              aria-label="What happened this month"
            />
            <div className="pr-row">
              <button type="button" className="btn-primary" onClick={saveSummary} disabled={busy === "summary"}>
                {busy === "summary" ? "Saving…" : "Save summary"}
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setSummaryText(draft);
                  showToast("Redrafted from this month's numbers. Save to keep it.");
                }}
              >
                Redraft from numbers
              </button>
              <span className="pr-hint">
                {summarySavedAt ? `Saved ${prDateLabel(summarySavedAt)}` : "Not saved yet"} · {summary.length}/6000
              </span>
            </div>
          </div>
        );
      case "compare":
        return (
          <div className="pr-stack">
            <p className="card-subtitle">
              How {current ? current.label : "this month"} stacks up. Where there isn't enough history for a fair comparison, we say so
              rather than guess.
            </p>
            <PrComparisonCards comparisons={comparisonsAll} />
          </div>
        );
      case "giving":
        return <PrGivingBlock giving={givingSec} />;
      case "functional":
        return (
          <PrFunctionalPanel
            client={client}
            fnMap={fnMap}
            setFnMap={setFnMap}
            functional={snapshot.functional}
            sb={sb}
            clientId={clientId}
            needSave={needSave}
            flagError={flagError}
            showToast={showToast}
          />
        );
      case "share":
        return (
          <PrSharesPanel
            shares={shares}
            reloadShares={loadShares}
            snapshot={snapshot}
            orgName={client.name}
            sb={sb}
            clientId={clientId}
            whoEmail={whoEmail}
            needSave={needSave}
            flagError={flagError}
            showToast={showToast}
            noData={noData}
          />
        );
      case "brand":
        return (
          <PrBrandingPanel
            branding={branding}
            setBranding={setBranding}
            orgName={client.name}
            periodLabel={snapshot.periodLabel}
            sb={sb}
            clientId={clientId}
            whoEmail={whoEmail}
            needSave={needSave}
            flagError={flagError}
            showToast={showToast}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="card pr-suite">
      <div className="pr-suite-head">
        <div>
          <span className="eyebrow-badge">Pro</span>
          <h3 className="card-title">Board reports</h3>
          <p className="card-subtitle">
            Build a board packet, share a read-only copy, and keep this month's story in plain words.
          </p>
        </div>
      </div>
      {missing && <div className="pr-banner">{PR_SETUP_MSG} Everything on screen still works.</div>}
      {!sb && <div className="pr-banner">{PR_OFFLINE_MSG}</div>}
      <div className="view-toggle pr-tabs" role="tablist" aria-label="Report tools">
        {PR_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={"view-toggle-btn" + (tab === t.key ? " active" : "")}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="pr-tab-body">{tabBody()}</div>
    </div>
  );
}

// ---- Board packet + templates ----------------------------------------------

function PrPacketPanel({
  config, setConfig, comparisons, snapshot, onDownload, templates, reloadTemplates,
  defaultPeriodLabel, sb, clientId, whoEmail, needSave, flagError, showToast,
}) {
  const [preview, setPreview] = useState(false);
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState(null); // {id, name}
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [saving, setSaving] = useState(false);

  const toggle = (group, key) =>
    setConfig((c) => ({ ...c, [group]: { ...c[group], [key]: !c[group][key] } }));
  const chosen = PR_SECTIONS.filter((s) => config.sections[s.key]).length;

  const load = (cfg, name) => {
    setConfig(prNormalizeConfig({ ...cfg, name }, defaultPeriodLabel));
    showToast(`Loaded "${name}".`);
  };

  const saveTemplate = async () => {
    const name = (newName || config.name || "").trim().slice(0, 120);
    if (!name) {
      showToast("Give the template a name first.");
      return;
    }
    if (!needSave()) return;
    setSaving(true);
    try {
      const cfg = {
        sections: config.sections,
        compare: config.compare,
        treasurerNote: config.treasurerNote,
        periodLabel: config.periodLabel === defaultPeriodLabel ? "" : config.periodLabel,
      };
      const existing = templates.find((t) => t.name.toLowerCase() === name.toLowerCase());
      const res = existing
        ? await sb
            .from("client_report_templates")
            .update({ config: cfg, updated_at: new Date().toISOString() })
            .eq("id", existing.id)
        : await sb
            .from("client_report_templates")
            .insert({ client_id: clientId, name, config: cfg, created_by: whoEmail });
      if (res.error) flagError(res.error, "Couldn't save the template.");
      else {
        showToast(existing ? `Updated "${name}".` : `Saved "${name}".`);
        setNewName("");
        setConfig((c) => ({ ...c, name }));
        reloadTemplates();
      }
    } catch (e) {
      showToast("Couldn't save the template.");
    }
    setSaving(false);
  };

  const rename = async () => {
    const name = (renaming.name || "").trim().slice(0, 120);
    if (!name) return;
    if (!needSave()) return;
    try {
      const { error } = await sb
        .from("client_report_templates")
        .update({ name, updated_at: new Date().toISOString() })
        .eq("id", renaming.id);
      if (error) flagError(error, "Couldn't rename that.");
      else {
        setRenaming(null);
        reloadTemplates();
      }
    } catch (e) {
      showToast("Couldn't rename that.");
    }
  };

  const remove = async (t) => {
    setConfirmDelete(null);
    if (!needSave()) return;
    try {
      const { error } = await sb.from("client_report_templates").delete().eq("id", t.id);
      if (error) flagError(error, "Couldn't delete that.");
      else {
        showToast(`Deleted "${t.name}".`);
        reloadTemplates();
      }
    } catch (e) {
      showToast("Couldn't delete that.");
    }
  };

  return (
    <div className="pr-stack">
      <div className="pr-templates">
        <span className="pr-label">Start from</span>
        <div className="pr-chip-row">
          {PR_PRESETS.map((p) => (
            <button key={p.name} type="button" className="pr-chip" onClick={() => load(prConfigFromPreset(p, ""), p.name)}>
              {p.name}
            </button>
          ))}
          {templates.map((t) =>
            renaming && renaming.id === t.id ? (
              <span key={t.id} className="pr-chip pr-chip-edit ms-form">
                <input
                  value={renaming.name}
                  maxLength={120}
                  autoFocus
                  aria-label="Template name"
                  onChange={(e) => setRenaming({ ...renaming, name: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") rename();
                    if (e.key === "Escape") setRenaming(null);
                  }}
                />
                <button type="button" className="link-btn" onClick={rename}>
                  Save
                </button>
                <button type="button" className="link-btn" onClick={() => setRenaming(null)}>
                  Cancel
                </button>
              </span>
            ) : (
              <span key={t.id} className={"pr-chip pr-chip-saved" + (config.name === t.name ? " active" : "")}>
                <button type="button" className="pr-chip-main" onClick={() => load(t.config, t.name)}>
                  {t.name}
                </button>
                <button type="button" className="pr-chip-icon" aria-label={`Rename ${t.name}`} onClick={() => setRenaming({ id: t.id, name: t.name })}>
                  ✎
                </button>
                <button type="button" className="pr-chip-icon" aria-label={`Delete ${t.name}`} onClick={() => setConfirmDelete(t)}>
                  ×
                </button>
              </span>
            ),
          )}
        </div>
      </div>

      <div className="pr-grid-2">
        <fieldset className="pr-fieldset">
          <legend>Sections</legend>
          {PR_SECTIONS.map((s) => (
            <label className="pr-check" key={s.key}>
              <input type="checkbox" checked={!!config.sections[s.key]} onChange={() => toggle("sections", s.key)} />
              <span>{s.label}</span>
            </label>
          ))}
        </fieldset>
        <fieldset className="pr-fieldset">
          <legend>Comparison columns</legend>
          {PR_COMPARES.map((c) => {
            const info = comparisons.find((x) => x.key === c.key);
            const unavailable = info && !info.available;
            return (
              <label className={"pr-check" + (unavailable ? " pr-check-off" : "")} key={c.key}>
                <input type="checkbox" checked={!!config.compare[c.key]} onChange={() => toggle("compare", c.key)} />
                <span>
                  {c.label}
                  {unavailable && <span className="pr-hint pr-block">{info.reason}</span>}
                </span>
              </label>
            );
          })}
          <p className="pr-hint">Used in the Income &amp; expenses section. Budget vs. actual always compares to budget.</p>
        </fieldset>
      </div>

      <div className="ms-form pr-row pr-wrap">
        <label className="task-field">
          Period label
          <input
            value={config.periodLabel}
            maxLength={80}
            onChange={(e) => setConfig((c) => ({ ...c, periodLabel: e.target.value }))}
            placeholder={defaultPeriodLabel}
          />
        </label>
      </div>

      {config.sections.treasurer && (
        <label className="task-field">
          Treasurer's note
          <textarea
            className="pr-textarea"
            rows={4}
            maxLength={6000}
            value={config.treasurerNote}
            placeholder="Anything the board should hear from the treasurer this month."
            onChange={(e) => setConfig((c) => ({ ...c, treasurerNote: e.target.value }))}
          />
        </label>
      )}

      <div className="pr-row pr-wrap">
        <button type="button" className="btn-primary" onClick={onDownload} disabled={chosen === 0}>
          Download board packet (PDF)
        </button>
        <button type="button" className="btn-secondary" onClick={() => setPreview((p) => !p)}>
          {preview ? "Hide preview" : "Preview on screen"}
        </button>
        <span className="pr-spacer" />
        <span className="ms-form pr-row">
          <input
            value={newName}
            maxLength={120}
            placeholder={config.name || "Template name"}
            aria-label="Template name"
            onChange={(e) => setNewName(e.target.value)}
          />
          <button type="button" className="btn-secondary" onClick={saveTemplate} disabled={saving}>
            {saving ? "Saving…" : "Save as template"}
          </button>
        </span>
      </div>

      {preview && (
        <div className="pr-preview">
          <PrSnapshotView snap={snapshot} showCover={true} />
        </div>
      )}

      {confirmDelete && typeof ConfirmModal === "function" && (
        <ConfirmModal
          title="Delete this template?"
          body={`"${confirmDelete.name}" will be removed for everyone at this organization. Packets you've already downloaded aren't affected.`}
          confirmLabel="Delete template"
          onConfirm={() => remove(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}

// ---- Functional expense mapping --------------------------------------------

function PrFunctionalPanel({ client, fnMap, setFnMap, functional, sb, clientId, needSave, flagError, showToast }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);
  const categories = prExpenseRows(client).map((b) => b.category);

  const start = () => {
    const d = {};
    categories.forEach((c) => (d[c] = fnMap[c] || prSuggestFunction(c)));
    setDraft(d);
    setEditing(true);
  };

  const save = async () => {
    setFnMap(draft); // on-screen statement updates even if saving isn't possible
    if (!needSave()) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      const rows = categories.map((c) => ({ client_id: clientId, category: c, function: draft[c] }));
      const { error } = rows.length
        ? await sb.from("client_functional_map").upsert(rows, { onConflict: "client_id,category" })
        : { error: null };
      if (error) flagError(error, "Couldn't save the mapping.");
      else {
        showToast("Mapping saved.");
        setEditing(false);
      }
    } catch (e) {
      showToast("Couldn't save the mapping.");
    }
    setSaving(false);
  };

  return (
    <div className="pr-stack">
      <p className="card-subtitle">
        Each expense category is assigned to program services, management &amp; general, or fundraising, the way Form 990 asks.
        This shows the last closed month, since that's where category detail is kept.
      </p>
      {!editing ? (
        <>
          <PrFunctionalTable functional={functional} />
          {categories.length > 0 && (
            <div>
              <button type="button" className="btn-secondary" onClick={start}>
                Change how categories are assigned
              </button>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="pr-table-wrap">
            <table className="tx-table pr-table">
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Function</th>
                  <th>Suggested</th>
                </tr>
              </thead>
              <tbody>
                {categories.map((c) => (
                  <tr key={c}>
                    <td>{c}</td>
                    <td className="ms-form">
                      <select value={draft[c]} onChange={(e) => setDraft((d) => ({ ...d, [c]: e.target.value }))} aria-label={`Function for ${c}`}>
                        {PR_FUNCTIONS.map((f) => (
                          <option key={f.key} value={f.key}>
                            {f.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="pr-muted">{(PR_FUNCTIONS.find((f) => f.key === prSuggestFunction(c)) || {}).label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pr-row pr-wrap">
            <button type="button" className="btn-primary" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save mapping"}
            </button>
            <button type="button" className="btn-secondary" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="link-btn"
              onClick={() => {
                const d = {};
                categories.forEach((c) => (d[c] = prSuggestFunction(c)));
                setDraft(d);
              }}
            >
              Reset to suggestions
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ---- Share links -------------------------------------------------------------

function PrSharesPanel({ shares, reloadShares, snapshot, orgName, sb, clientId, whoEmail, needSave, flagError, showToast, noData }) {
  const [title, setTitle] = useState("");
  const [days, setDays] = useState(30);
  const [creating, setCreating] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(null);
  const [justMade, setJustMade] = useState(null);
  const defaultTitle = `${orgName || "Board"} board packet, ${snapshot.periodLabel}`.slice(0, 200);

  const copy = async (token) => {
    const url = prShareUrl(token);
    try {
      await navigator.clipboard.writeText(url);
      showToast("Link copied.");
    } catch (e) {
      window.prompt("Copy this link:", url);
    }
  };

  const create = async () => {
    if (noData) {
      showToast("There aren't any numbers to share yet.");
      return;
    }
    if (!needSave()) return;
    setCreating(true);
    try {
      const token = prRandomToken();
      const n = PR_EXPIRY_OPTIONS.includes(Number(days)) ? Number(days) : 30;
      // A minute's grace so a fast browser clock can't trip the 90-day check.
      const expires = new Date(Date.now() + n * 86400000 - 60000).toISOString();
      const snap = JSON.parse(JSON.stringify(snapshot));
      const t = (title || defaultTitle).trim().slice(0, 200) || "Board packet";
      const { error } = await sb.from("client_report_shares").insert({
        client_id: clientId,
        token,
        title: t,
        snapshot: snap,
        created_by: whoEmail,
        expires_at: expires,
      });
      if (error) flagError(error, "Couldn't create the link.");
      else {
        setJustMade(token);
        setTitle("");
        showToast("Share link created.");
        reloadShares();
        try {
          await navigator.clipboard.writeText(prShareUrl(token));
          showToast("Share link created and copied.");
        } catch (e) {
          /* the copy button is right there */
        }
      }
    } catch (e) {
      showToast(e && e.message ? e.message : "Couldn't create the link.");
    }
    setCreating(false);
  };

  const revoke = async (s) => {
    setConfirmRevoke(null);
    if (!needSave()) return;
    try {
      const { error } = await sb
        .from("client_report_shares")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", s.id);
      if (error) flagError(error, "Couldn't turn that link off.");
      else {
        showToast("Link turned off.");
        reloadShares();
      }
    } catch (e) {
      showToast("Couldn't turn that link off.");
    }
  };

  const now = Date.now();
  const statusOf = (s) =>
    s.revoked_at ? "revoked" : new Date(s.expires_at).getTime() <= now ? "expired" : "live";

  return (
    <div className="pr-stack">
      <p className="card-subtitle">
        A read-only link to the current board packet, for board members who don't have a login. It's a snapshot: later changes
        won't show up unless you make a new link.
      </p>
      <div className="ms-form pr-row pr-wrap pr-align-end">
        <label className="task-field">
          Title
          <input value={title} maxLength={200} placeholder={defaultTitle} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="task-field compact">
          Expires after
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {PR_EXPIRY_OPTIONS.map((d) => (
              <option key={d} value={d}>
                {d} days
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn-primary" onClick={create} disabled={creating}>
          {creating ? "Creating…" : "Create share link"}
        </button>
      </div>
      <p className="pr-hint">
        Includes: {snapshot.sections.map((k) => (PR_SECTIONS.find((s) => s.key === k) || {}).label).join(", ") || "nothing yet"}.
        Change the sections on the Board packet tab.
      </p>

      {shares.length === 0 ? (
        <p className="pr-muted">No share links yet.</p>
      ) : (
        <ul className="pr-share-list">
          {shares.map((s) => {
            const st = statusOf(s);
            return (
              <li key={s.id} className={"pr-share-item" + (justMade === s.token ? " pr-new" : "")}>
                <div className="pr-share-main">
                  <strong>{s.title}</strong>
                  <span className="pr-hint">
                    Created {prDateLabel(s.created_at)}
                    {s.created_by ? ` by ${s.created_by}` : ""} ·{" "}
                    {st === "live" ? `expires ${prDateLabel(s.expires_at)}` : st === "expired" ? `expired ${prDateLabel(s.expires_at)}` : `turned off ${prDateLabel(s.revoked_at)}`}
                  </span>
                </div>
                <span className={"pill " + (st === "live" ? "good" : "neutral")}>
                  {st === "live" ? "Live" : st === "expired" ? "Expired" : "Turned off"}
                </span>
                {st === "live" && (
                  <span className="pr-row">
                    <button type="button" className="link-btn" onClick={() => copy(s.token)}>
                      Copy link
                    </button>
                    <button type="button" className="link-btn pr-danger" onClick={() => setConfirmRevoke(s)}>
                      Turn off
                    </button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {confirmRevoke && typeof ConfirmModal === "function" && (
        <ConfirmModal
          title="Turn off this link?"
          body={`Anyone with the link to "${confirmRevoke.title}" won't be able to open it anymore. This can't be undone, but you can always make a new link.`}
          confirmLabel="Turn off link"
          onConfirm={() => revoke(confirmRevoke)}
          onCancel={() => setConfirmRevoke(null)}
        />
      )}
    </div>
  );
}

// ---- Logo & colours --------------------------------------------------------

function PrBrandingPanel({ branding, setBranding, orgName, periodLabel, sb, clientId, whoEmail, needSave, flagError, showToast }) {
  const [logo, setLogo] = useState(branding.logo);
  const [color, setColor] = useState(branding.color || "#05080d");
  const [colorText, setColorText] = useState(branding.color || "#05080d");
  const [saving, setSaving] = useState(false);
  const [processing, setProcessing] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    setLogo(branding.logo);
    if (branding.color) {
      setColor(branding.color);
      setColorText(branding.color);
    }
  }, [branding.logo, branding.color]);

  const onFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    setProcessing(true);
    try {
      const url = await prDownscaleLogo(file);
      setLogo(url);
    } catch (err) {
      showToast(err && err.message ? err.message : "Couldn't use that image.");
    }
    setProcessing(false);
  };

  const save = async () => {
    const c = prValidHex(color);
    const next = { logo: prValidLogo(logo), color: c };
    setBranding(next); // PDFs made in this session pick it up regardless
    if (!needSave()) return;
    setSaving(true);
    try {
      const { error } = await sb.from("client_branding").upsert(
        {
          client_id: clientId,
          logo_data_url: next.logo,
          brand_color: next.color,
          updated_by: whoEmail,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "client_id" },
      );
      if (error) flagError(error, "Couldn't save the branding.");
      else showToast("Logo and colour saved.");
    } catch (err) {
      showToast("Couldn't save the branding.");
    }
    setSaving(false);
  };

  const previewColor = prValidHex(color) || "#05080d";

  return (
    <div className="pr-grid-2">
      <div className="pr-stack">
        <p className="card-subtitle">
          Your logo and colour go on the board packet's cover and page headers, and on share links.
        </p>
        <div>
          <span className="pr-label">Logo</span>
          <div className="pr-row pr-wrap">
            <input ref={fileRef} type="file" accept="image/png,image/jpeg" onChange={onFile} className="pr-file" aria-label="Upload logo" />
            <button type="button" className="btn-secondary" onClick={() => fileRef.current && fileRef.current.click()} disabled={processing}>
              {processing ? "Preparing…" : logo ? "Replace logo" : "Upload logo"}
            </button>
            {logo && (
              <button type="button" className="link-btn" onClick={() => setLogo(null)}>
                Remove
              </button>
            )}
          </div>
          <p className="pr-hint">PNG or JPEG. We shrink it to 400px wide so it stays light.</p>
        </div>
        <div className="ms-form">
          <span className="pr-label">Brand colour</span>
          <div className="pr-row">
            <input
              type="color"
              className="pr-color"
              value={previewColor}
              aria-label="Brand colour"
              onChange={(e) => {
                setColor(e.target.value);
                setColorText(e.target.value);
              }}
            />
            <input
              value={colorText}
              maxLength={7}
              aria-label="Brand colour hex"
              className="pr-hex"
              onChange={(e) => {
                const v = e.target.value.trim();
                setColorText(v);
                if (prValidHex(v)) setColor(v);
              }}
            />
          </div>
        </div>
        <div className="pr-row">
          <button type="button" className="btn-primary" onClick={save} disabled={saving || processing}>
            {saving ? "Saving…" : "Save logo & colour"}
          </button>
        </div>
      </div>
      <div>
        <span className="pr-label">Preview</span>
        <div className="pr-brand-preview" aria-label="Cover preview">
          <div className="pr-brand-band" style={{ background: previewColor }} />
          {logo ? <img src={logo} alt="" className="pr-brand-logo" /> : <div className="pr-brand-logo-empty">Your logo</div>}
          <div className="pr-brand-org">{orgName}</div>
          <div className="pr-brand-sub">Board packet</div>
          <div className="pr-brand-period">{periodLabel}</div>
          <div className="pr-brand-rule" style={{ background: previewColor }} />
        </div>
      </div>
    </div>
  );
}
