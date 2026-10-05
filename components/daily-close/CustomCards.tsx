"use client";

/*
  Custom dashboard cards for the Pro Financial Overview (DailyClose.tsx).

  A client builds a card from menus: what to track (budget categories, all
  income, all spending, income vs spending, bank/card accounts, funds), the
  time period, which sections to show (summary, chart, breakdown,
  transactions) and transaction filters (money in/out, a word in the
  description, a minimum amount). The card definition is plain JSON, saved
  with the rest of the overview layout (useLiveReportLayout in
  DailyClose.tsx: localStorage plus the account copy in user_board_layouts),
  and rendered here from `data.cardSource` (buildCardSource in
  fromClient.js). Nothing in this file fetches anything.

  Same wiring as DailyClose.tsx: global React, `dc-` classes through the
  `styles` proxy for anything inside the overview, plain `cc-` classes
  (DailyClose.css, bottom) for the card's own pieces and the builder, and the
  whole file inside an IIFE so its names can't collide with app.jsx. Public
  surface: window.MGB_CustomCards.
*/

(function () {
const { useMemo, useRef, useState, useEffect } = React;

const styles = new Proxy(
  {},
  { get: (_, key) => (typeof key === "string" ? "dc-" + key : undefined) }
);

/* ============================================================
   Card definition
   ============================================================ */

type CCSource = "categories" | "income" | "expenses" | "net" | "accounts" | "funds";
type CCPeriod = "this-month" | "last-month" | "last-3" | "last-6" | "last-12" | "ytd";
type CCAccent = "blue" | "orange" | "green" | "gold" | "purple" | "slate";

interface CustomCardDef {
  id: string;
  title: string;
  source: CCSource;
  /** Category, account or fund names. Empty = all (accounts and funds only). */
  items: string[];
  period: CCPeriod;
  /** QuickBooks clients only: count the month-to-date month in multi-month periods. */
  includeCurrent: boolean;
  show: { summary: boolean; chart: boolean; breakdown: boolean; transactions: boolean };
  chart: "bars" | "line";
  compareBudget: boolean;
  txn: { limit: number; direction: "all" | "in" | "out"; keyword: string; minAmount: number | null };
  accent: CCAccent;
}

const CC_MAX_CARDS = 24;
const CC_SOURCES: { id: CCSource; label: string; hint: string }[] = [
  { id: "categories", label: "Budget categories", hint: "One or more categories, against budget" },
  { id: "expenses", label: "All spending", hint: "Total expenses and where they went" },
  { id: "income", label: "All income", hint: "Total income and where it came from" },
  { id: "net", label: "Income vs. spending", hint: "Both totals and what's left over" },
  { id: "accounts", label: "Bank & card accounts", hint: "Balances, money in and money out" },
  { id: "funds", label: "Funds", hint: "Fund balances, gifts and transfers" },
];
const CC_PERIODS: { id: CCPeriod; label: string }[] = [
  { id: "this-month", label: "This month" },
  { id: "last-month", label: "Last month" },
  { id: "last-3", label: "Last 3 months" },
  { id: "last-6", label: "Last 6 months" },
  { id: "last-12", label: "Last 12 months" },
  { id: "ytd", label: "Year to date" },
];
const CC_ACCENTS: { id: CCAccent; label: string; color: string }[] = [
  { id: "blue", label: "Blue", color: "#2a78d6" },
  { id: "orange", label: "Orange", color: "#eb6834" },
  { id: "green", label: "Green", color: "#1f9d55" },
  { id: "gold", label: "Gold", color: "#b8975a" },
  { id: "purple", label: "Purple", color: "#7a5af5" },
  { id: "slate", label: "Slate", color: "#4b6475" },
];
const accentColor = (a: string) => (CC_ACCENTS.find((x) => x.id === a) || CC_ACCENTS[0]).color;

function ccNewId(): string {
  return "custom-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function ccDefaults(): CustomCardDef {
  return {
    id: ccNewId(),
    title: "",
    source: "categories",
    items: [],
    period: "last-3",
    includeCurrent: true,
    show: { summary: true, chart: true, breakdown: false, transactions: true },
    chart: "bars",
    compareBudget: true,
    txn: { limit: 5, direction: "all", keyword: "", minAmount: null },
    accent: "blue",
  };
}

const oneOf = <T,>(v: any, list: readonly T[], fallback: T): T => (list.includes(v) ? v : fallback);

// Anything read back from storage or another device goes through this, so a
// hand-edited or older definition can't crash the overview.
function ccNormalize(raw: any): CustomCardDef | null {
  if (!raw || typeof raw !== "object" || typeof raw.id !== "string" || !raw.id.startsWith("custom-")) return null;
  const d = ccDefaults();
  const show = raw.show && typeof raw.show === "object" ? raw.show : {};
  const txn = raw.txn && typeof raw.txn === "object" ? raw.txn : {};
  const min = Number(txn.minAmount);
  return {
    id: raw.id.slice(0, 64),
    title: String(raw.title || "").slice(0, 80),
    source: oneOf(raw.source, CC_SOURCES.map((s) => s.id), d.source),
    items: Array.isArray(raw.items) ? raw.items.filter((x: any) => typeof x === "string").slice(0, 50) : [],
    period: oneOf(raw.period, CC_PERIODS.map((p) => p.id), d.period),
    includeCurrent: raw.includeCurrent !== false,
    show: {
      summary: show.summary !== false,
      chart: show.chart !== false,
      breakdown: Boolean(show.breakdown),
      transactions: show.transactions !== false,
    },
    chart: raw.chart === "line" ? "line" : "bars",
    compareBudget: raw.compareBudget !== false,
    txn: {
      limit: oneOf(Number(txn.limit), [5, 10, 20], 5),
      direction: oneOf(txn.direction, ["all", "in", "out"] as const, "all"),
      keyword: String(txn.keyword || "").slice(0, 60),
      minAmount: txn.minAmount != null && txn.minAmount !== "" && isFinite(min) && min > 0 ? min : null,
    },
    accent: oneOf(raw.accent, CC_ACCENTS.map((a) => a.id), d.accent),
  };
}

function ccNormalizeList(list: any): CustomCardDef[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  return list
    .map(ccNormalize)
    .filter((c): c is CustomCardDef => {
      if (!c || seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    })
    .slice(0, CC_MAX_CARDS);
}

/* ============================================================
   Formatting
   ============================================================ */

const MONTH_FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fmtMoney(n: number): string {
  const sign = n < 0 ? "−" : "";
  return sign + "$" + Math.round(Math.abs(n)).toLocaleString("en-US");
}
function fmtCompact(n: number): string {
  const a = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (a >= 1e6) return sign + "$" + (a / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, "") + "M";
  if (a >= 1e3) return sign + "$" + (a / 1e3).toFixed(a >= 1e4 ? 0 : 1).replace(/\.0$/, "") + "k";
  return sign + "$" + Math.round(a);
}
function fmtDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  if (!m) return "";
  return MONTH_ABBR[Number(m[2]) - 1] + " " + Number(m[3]);
}
const keyMonth = (k: string) => Number(k.slice(5, 7)) - 1;
const keyYear = (k: string) => k.slice(0, 4);

function periodLabel(keys: string[], partialKey: string | null): string {
  if (!keys.length) return "";
  const first = keys[0];
  const last = keys[keys.length - 1];
  const mtd = partialKey && keys.includes(partialKey) ? " (month to date)" : "";
  if (keys.length === 1) return `${MONTH_FULL[keyMonth(first)]} ${keyYear(first)}${mtd}`;
  const left = MONTH_ABBR[keyMonth(first)] + (keyYear(first) !== keyYear(last) ? " " + keyYear(first) : "");
  return `${left} – ${MONTH_ABBR[keyMonth(last)]} ${keyYear(last)}${mtd}`;
}

/* ============================================================
   Computing a card from the client's data
   ============================================================ */

const norm = (s: any) => String(s || "").trim().toLowerCase();
const tail = (s: any) => norm(s).replace(/^.*:/, "").trim();
// QuickBooks names sub-accounts "Parent:Child" in the P&L, while a
// transaction's category can carry either form.
function categoryMatches(txnCategory: any, item: string): boolean {
  const t = norm(txnCategory);
  if (!t) return false;
  return t === norm(item) || tail(t) === tail(item);
}

function resolvePeriod(def: CustomCardDef, src: any): string[] {
  const months = (src && src.months) || [];
  if (!months.length) return [];
  const all = months.map((m: any) => m.key);
  const closed = months.filter((m: any) => !m.partial).map((m: any) => m.key);
  const pool = def.includeCurrent ? all : closed.length ? closed : all;
  const newest = all[all.length - 1];
  switch (def.period) {
    case "this-month":
      return [newest];
    case "last-month":
      return closed.length ? [closed[closed.length - 1]] : [newest];
    case "last-3":
      return pool.slice(-3);
    case "last-6":
      return pool.slice(-6);
    case "last-12":
      return pool.slice(-12);
    case "ytd": {
      const year = keyYear(pool[pool.length - 1]);
      return pool.filter((k: string) => keyYear(k) === year);
    }
  }
  return pool.slice(-3);
}

interface CCTxn {
  date: string;
  description: string;
  detail: string;
  amount: number;
}

interface CCResult {
  keys: string[];
  periodText: string;
  /** Per-month chart rows, oldest first. */
  series: { label: string; key: string; a: number; b: number | null; budget: number | null }[];
  seriesNames: [string, string | null];
  stats: { label: string; value: string; tone?: "good" | "bad" | null }[];
  progress: { pct: number; over: boolean; text: string } | null;
  breakdown: { name: string; amount: number; budget: number | null }[];
  breakdownTitle: string;
  transactions: CCTxn[];
  transactionsTotal: number;
  notes: string[];
  empty: string | null;
}

function txnFilter(def: CustomCardDef, keys: string[]) {
  const kw = norm(def.txn.keyword);
  const keySet = new Set(keys);
  return (t: CCTxn) => {
    if (!keySet.has(String(t.date).slice(0, 7))) return false;
    if (def.txn.direction === "in" && t.amount <= 0) return false;
    if (def.txn.direction === "out" && t.amount >= 0) return false;
    if (def.txn.minAmount != null && Math.abs(t.amount) < def.txn.minAmount) return false;
    if (kw && !norm(t.description + " " + t.detail).includes(kw)) return false;
    return true;
  };
}

function allTxns(src: any, accountNames?: string[] | null): (CCTxn & { category: string | null; account: string })[] {
  const out: any[] = [];
  (src.accounts || []).forEach((a: any) => {
    if (accountNames && accountNames.length && !accountNames.includes(a.name)) return;
    (a.transactions || []).forEach((t: any) =>
      out.push({
        date: t.date,
        description: t.description,
        category: t.category,
        account: a.name,
        detail: [t.category, a.name].filter(Boolean).join(" · "),
        amount: t.amount,
      })
    );
  });
  return out;
}

function sortRecent<T extends { date: string }>(list: T[]): T[] {
  return list.slice().sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : 0));
}

function ccCompute(def: CustomCardDef, src: any): CCResult {
  const res: CCResult = {
    keys: [],
    periodText: "",
    series: [],
    seriesNames: ["", null],
    stats: [],
    progress: null,
    breakdown: [],
    breakdownTitle: "",
    transactions: [],
    transactionsTotal: 0,
    notes: [],
    empty: null,
  };
  if (!src || !src.months) {
    res.empty = "This card needs your financial data, which isn't loaded.";
    return res;
  }
  const keys = resolvePeriod(def, src);
  const partial = (src.months.find((m: any) => m.partial) || {}).key || null;
  const labelOf = (k: string) => {
    const m = src.months.find((x: any) => x.key === k);
    return (m && m.label) || MONTH_ABBR[keyMonth(k)];
  };
  res.keys = keys;
  res.periodText = periodLabel(keys, partial);
  if (!keys.length) {
    res.empty = "No monthly figures recorded yet.";
    return res;
  }
  const filter = txnFilter(def, keys);
  const finishTxns = (list: CCTxn[]) => {
    const matched = sortRecent(list.filter(filter));
    res.transactionsTotal = matched.reduce((s, t) => s + t.amount, 0);
    res.transactions = matched;
  };
  const sumBudget = (cats: any[], k: string) => {
    let any = false;
    let total = 0;
    cats.forEach((c) => {
      const cell = c.byMonth[k];
      if (cell && cell.budgeted != null) {
        any = true;
        total += cell.budgeted;
      }
    });
    return any ? total : null;
  };
  const budgetProgress = (actual: number, budget: number | null, income: boolean) => {
    if (budget == null || budget <= 0) return null;
    const pct = (actual / budget) * 100;
    const over = actual > budget;
    const diff = Math.abs(budget - actual);
    const text = income
      ? over
        ? `${fmtMoney(diff)} above budget`
        : `${fmtMoney(diff)} still to come`
      : over
      ? `${fmtMoney(diff)} over budget`
      : `${fmtMoney(diff)} left in budget`;
    return { pct, over: income ? false : over, text };
  };
  const monthsInfo = (k: string) => src.months.find((m: any) => m.key === k) || { income: 0, expenses: 0 };
  // Sample clients have one budget period; buildCardSource estimates the
  // earlier months of each category from it.
  if (src.estimatedHistory && keys.length > 1 && def.source === "categories") {
    res.notes.push("Sample data: earlier months are estimated from the current budget period.");
  }

  if (def.source === "categories") {
    const cats = def.items.map((name) => (src.categories || []).find((c: any) => c.name === name)).filter(Boolean);
    const missing = def.items.filter((name) => !(src.categories || []).some((c: any) => c.name === name));
    if (missing.length) res.notes.push(`Not in your books anymore: ${missing.join(", ")}.`);
    if (!cats.length) {
      res.empty = def.items.length ? "None of the chosen categories are in your books." : "Pick at least one category.";
      return res;
    }
    const income = cats.every((c: any) => c.type === "income");
    res.series = keys.map((k) => ({
      key: k,
      label: labelOf(k),
      a: cats.reduce((s: number, c: any) => s + ((c.byMonth[k] && c.byMonth[k].actual) || 0), 0),
      b: null,
      budget: def.compareBudget ? sumBudget(cats, k) : null,
    }));
    res.seriesNames = [income ? "Received" : "Spent", null];
    const actual = res.series.reduce((s, r) => s + r.a, 0);
    const budget = res.series.some((r) => r.budget != null) ? res.series.reduce((s, r) => s + (r.budget || 0), 0) : null;
    res.stats.push({ label: income ? "Received" : "Spent", value: fmtMoney(actual) });
    if (budget != null) {
      res.stats.push({ label: "Budget", value: fmtMoney(budget) });
      const left = budget - actual;
      res.stats.push(
        income
          ? { label: left >= 0 ? "To go" : "Above", value: fmtMoney(Math.abs(left)), tone: left <= 0 ? "good" : null }
          : { label: left >= 0 ? "Left" : "Over", value: fmtMoney(Math.abs(left)), tone: left >= 0 ? "good" : "bad" }
      );
      res.progress = budgetProgress(actual, budget, income);
    } else if (keys.length > 1) {
      res.stats.push({ label: "Monthly average", value: fmtMoney(actual / keys.length) });
    }
    res.breakdownTitle = "By category";
    res.breakdown = cats
      .map((c: any) => ({
        name: c.name,
        amount: keys.reduce((s, k) => s + ((c.byMonth[k] && c.byMonth[k].actual) || 0), 0),
        budget: def.compareBudget && keys.some((k) => c.byMonth[k] && c.byMonth[k].budgeted != null)
          ? keys.reduce((s, k) => s + ((c.byMonth[k] && c.byMonth[k].budgeted) || 0), 0)
          : null,
      }))
      .sort((x: any, y: any) => y.amount - x.amount);
    finishTxns(allTxns(src).filter((t) => cats.some((c: any) => categoryMatches(t.category, c.name))));
    return res;
  }

  if (def.source === "income" || def.source === "expenses") {
    const income = def.source === "income";
    const type = income ? "income" : "expense";
    const cats = (src.categories || []).filter((c: any) => c.type === type);
    res.series = keys.map((k) => ({
      key: k,
      label: labelOf(k),
      a: income ? monthsInfo(k).income : monthsInfo(k).expenses,
      b: null,
      budget: def.compareBudget ? sumBudget(cats, k) : null,
    }));
    res.seriesNames = [income ? "Income" : "Spending", null];
    const actual = res.series.reduce((s, r) => s + r.a, 0);
    const hasBudget = def.compareBudget && res.series.some((r) => r.budget != null);
    const budget = hasBudget ? res.series.reduce((s, r) => s + (r.budget || 0), 0) : null;
    res.stats.push({ label: income ? "Income" : "Spent", value: fmtMoney(actual) });
    if (budget != null) {
      res.stats.push({ label: "Budget", value: fmtMoney(budget) });
      res.progress = budgetProgress(actual, budget, income);
    }
    if (keys.length > 1) res.stats.push({ label: "Monthly average", value: fmtMoney(actual / keys.length) });
    res.breakdownTitle = income ? "Where it came from" : "Where it went";
    const rows = cats
      .map((c: any) => ({ name: c.name, amount: keys.reduce((s, k) => s + ((c.byMonth[k] && c.byMonth[k].actual) || 0), 0), budget: null }))
      .filter((r: any) => r.amount > 0)
      .sort((x: any, y: any) => y.amount - x.amount);
    res.breakdown = rows.length > 7 ? [...rows.slice(0, 6), { name: "Everything else", amount: rows.slice(6).reduce((s: number, r: any) => s + r.amount, 0), budget: null }] : rows;
    finishTxns(allTxns(src).filter((t) => (income ? t.amount > 0 : t.amount < 0)));
    return res;
  }

  if (def.source === "net") {
    res.series = keys.map((k) => ({ key: k, label: labelOf(k), a: monthsInfo(k).income, b: monthsInfo(k).expenses, budget: null }));
    res.seriesNames = ["Income", "Spending"];
    const inc = res.series.reduce((s, r) => s + r.a, 0);
    const exp = res.series.reduce((s, r) => s + (r.b || 0), 0);
    res.stats.push({ label: "Income", value: fmtMoney(inc) });
    res.stats.push({ label: "Spending", value: fmtMoney(exp) });
    res.stats.push({ label: inc - exp >= 0 ? "Left over" : "Short", value: fmtMoney(Math.abs(inc - exp)), tone: inc - exp >= 0 ? "good" : "bad" });
    res.breakdownTitle = "Month by month";
    res.breakdown = res.series.map((r) => ({ name: periodLabel([r.key], partial), amount: r.a - (r.b || 0), budget: null })).reverse();
    finishTxns(allTxns(src));
    return res;
  }

  if (def.source === "accounts") {
    const accounts = (src.accounts || []).filter((a: any) => !def.items.length || def.items.includes(a.name));
    const missing = def.items.filter((name) => !(src.accounts || []).some((a: any) => a.name === name));
    if (missing.length) res.notes.push(`Not connected anymore: ${missing.join(", ")}.`);
    if (!accounts.length) {
      res.empty = "No matching accounts.";
      return res;
    }
    const txns = allTxns(src, accounts.map((a: any) => a.name));
    // Money in / out are what the card's own filters let through, so a
    // keyword card ("youth") totals just those transactions.
    const scoped = txns.filter(filter);
    res.series = keys.map((k) => {
      const inMonth = scoped.filter((t) => String(t.date).slice(0, 7) === k);
      return {
        key: k,
        label: labelOf(k),
        a: inMonth.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0),
        b: inMonth.filter((t) => t.amount < 0).reduce((s, t) => s - t.amount, 0),
        budget: null,
      };
    });
    res.seriesNames = ["Money in", "Money out"];
    const cash = accounts.filter((a: any) => a.kind !== "card").reduce((s: number, a: any) => s + a.balance, 0);
    const owed = accounts.filter((a: any) => a.kind === "card").reduce((s: number, a: any) => s + a.balance, 0);
    // Balances can't be filtered by a keyword or amount, so a filtered card
    // (say, "youth") shows only what its transactions add up to.
    const filtered = Boolean(norm(def.txn.keyword)) || def.txn.minAmount != null || def.txn.direction !== "all";
    if (!filtered) {
      if (accounts.some((a: any) => a.kind !== "card")) res.stats.push({ label: "Balance now", value: fmtMoney(cash) });
      if (owed) res.stats.push({ label: "Owed on cards", value: fmtMoney(owed) });
    } else {
      res.stats.push({ label: "Matching", value: String(scoped.length) });
    }
    res.stats.push({ label: "Money in", value: fmtMoney(res.series.reduce((s, r) => s + r.a, 0)) });
    res.stats.push({ label: "Money out", value: fmtMoney(res.series.reduce((s, r) => s + (r.b || 0), 0)) });
    res.breakdownTitle = "Balance by account";
    res.breakdown = accounts.map((a: any) => ({ name: a.name + (a.kind === "card" ? " (owed)" : ""), amount: a.balance, budget: null }));
    finishTxns(txns);
    return res;
  }

  if (def.source === "funds") {
    const funds = (src.funds || []).filter((f: any) => !def.items.length || def.items.includes(f.name));
    if (!(src.funds || []).length) {
      res.empty = "No funds are set up for this account yet.";
      return res;
    }
    if (!funds.length) {
      res.empty = "No matching funds.";
      return res;
    }
    const names = funds.map((f: any) => f.name);
    const gifts: CCTxn[] = (src.contributions || [])
      .filter((c: any) => names.includes(c.fund))
      .map((c: any) => ({ date: c.date, description: c.donor || "Gift", detail: [c.fund, c.method].filter(Boolean).join(" · "), amount: Number(c.amount) || 0 }));
    const transfers: CCTxn[] = [];
    (src.fundTransfers || []).forEach((t: any) => {
      const amt = Number(t.amount) || 0;
      if (names.includes(t.toFund) && !names.includes(t.fromFund))
        transfers.push({ date: t.date, description: `Transfer from ${t.fromFund}`, detail: t.reason || "Fund transfer", amount: amt });
      if (names.includes(t.fromFund) && !names.includes(t.toFund))
        transfers.push({ date: t.date, description: `Transfer to ${t.toFund}`, detail: t.reason || "Fund transfer", amount: -amt });
    });
    const scoped = gifts.filter(filter);
    res.series = keys.map((k) => ({
      key: k,
      label: labelOf(k),
      a: scoped.filter((g) => String(g.date).slice(0, 7) === k).reduce((s, g) => s + g.amount, 0),
      b: null,
      budget: null,
    }));
    res.seriesNames = ["Gifts", null];
    res.stats.push({ label: "Balance", value: fmtMoney(funds.reduce((s: number, f: any) => s + f.balance, 0)) });
    res.stats.push({ label: "Gifts received", value: fmtMoney(res.series.reduce((s, r) => s + r.a, 0)) });
    const netTransfers = transfers.filter(filter).reduce((s, t) => s + t.amount, 0);
    if (netTransfers) res.stats.push({ label: "Net transfers", value: fmtMoney(netTransfers), tone: netTransfers > 0 ? "good" : null });
    const pledges = (src.pledges || []).filter((p: any) => !p.fund || names.includes(p.fund));
    const open = pledges.reduce((s: number, p: any) => s + Math.max(0, (Number(p.committed) || 0) - (Number(p.received) || 0)), 0);
    if (open > 0) res.stats.push({ label: "Open pledges", value: fmtMoney(open) });
    res.breakdownTitle = "Balance by fund";
    res.breakdown = funds.map((f: any) => ({ name: f.name + (f.restricted ? " (restricted)" : ""), amount: f.balance, budget: null }));
    finishTxns([...gifts, ...transfers]);
    return res;
  }
  return res;
}

// Suggested title from the current choices, used until the person types
// their own.
function ccSuggestTitle(def: CustomCardDef): string {
  const period = (CC_PERIODS.find((p) => p.id === def.period) || CC_PERIODS[0]).label.toLowerCase();
  const list = (names: string[]) => (names.length <= 2 ? names.join(" & ") : `${names[0]} + ${names.length - 1} more`);
  const kw = def.txn.keyword.trim();
  switch (def.source) {
    case "categories":
      if (kw && def.items.length) return `“${kw}” in ${list(def.items)}, ${period}`;
      return def.items.length ? `${list(def.items)}, ${period}` : `Budget, ${period}`;
    case "income":
      return `Income, ${period}`;
    case "expenses":
      return `Spending, ${period}`;
    case "net":
      return `Income vs. spending, ${period}`;
    case "accounts":
      return kw ? `“${kw}” transactions, ${period}` : def.items.length ? `${list(def.items)}, ${period}` : `Account activity, ${period}`;
    case "funds":
      return def.items.length ? `${list(def.items)}, ${period}` : `Funds, ${period}`;
  }
  return "Custom card";
}

function ccDescribe(def: CustomCardDef): string {
  const src = (CC_SOURCES.find((s) => s.id === def.source) || CC_SOURCES[0]).label;
  const period = (CC_PERIODS.find((p) => p.id === def.period) || CC_PERIODS[0]).label;
  const kw = def.txn.keyword.trim() ? ` · “${def.txn.keyword.trim()}”` : "";
  return `Your custom card · ${src} · ${period}${kw}`;
}

/* ============================================================
   Chart
   ============================================================ */

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / mag;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * mag;
}

function CCChart({ result, kind, color }: { result: CCResult; kind: "bars" | "line"; color: string }) {
  const rows = result.series;
  const second = result.seriesNames[1];
  const secondColor = "var(--series-expense)";
  const hasBudget = rows.some((r) => r.budget != null);
  const W = 340,
    H = 150,
    padL = 40,
    padR = 8,
    padT = 10,
    padB = 22;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const max = niceMax(Math.max(1, ...rows.map((r) => Math.max(Math.abs(r.a), Math.abs(r.b || 0), r.budget || 0))));
  const Y = (v: number) => padT + innerH - (Math.max(0, v) / max) * innerH;
  const n = rows.length;
  const slot = innerW / Math.max(1, n);
  const cx = (i: number) => padL + slot * i + slot / 2;
  const barW = Math.min(34, slot * (second ? 0.36 : 0.56));
  const everyN = n > 8 ? Math.ceil(n / 6) : 1;
  const linePath = (vals: number[]) => vals.map((v, i) => `${i ? "L" : "M"}${cx(i).toFixed(1)},${Y(v).toFixed(1)}`).join(" ");

  return (
    <div className="cc-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${result.seriesNames[0]} by month`} preserveAspectRatio="none">
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={padL} x2={W - padR} y1={Y(max * f)} y2={Y(max * f)} className="cc-grid" />
            <text x={padL - 6} y={Y(max * f) + 3} textAnchor="end" className="cc-axis">
              {fmtCompact(max * f)}
            </text>
          </g>
        ))}
        {kind === "bars" &&
          rows.map((r, i) => (
            <g key={r.key}>
              <rect
                x={cx(i) - (second ? barW + 1 : barW / 2)}
                y={Y(r.a)}
                width={barW}
                height={Math.max(0, Y(0) - Y(r.a))}
                rx={3}
                fill={color}
              >
                <title>{`${r.label}: ${result.seriesNames[0]} ${fmtMoney(r.a)}${r.budget != null ? ` · budget ${fmtMoney(r.budget)}` : ""}`}</title>
              </rect>
              {second && (
                <rect x={cx(i) + 1} y={Y(r.b || 0)} width={barW} height={Math.max(0, Y(0) - Y(r.b || 0))} rx={3} fill={secondColor}>
                  <title>{`${r.label}: ${second} ${fmtMoney(r.b || 0)}`}</title>
                </rect>
              )}
            </g>
          ))}
        {kind === "line" && (
          <>
            <path d={linePath(rows.map((r) => r.a))} fill="none" stroke={color} strokeWidth={2.2} strokeLinejoin="round" />
            {second && <path d={linePath(rows.map((r) => r.b || 0))} fill="none" stroke={secondColor} strokeWidth={2.2} strokeLinejoin="round" />}
            {rows.map((r, i) => (
              <circle key={r.key} cx={cx(i)} cy={Y(r.a)} r={3} fill={color}>
                <title>{`${r.label}: ${result.seriesNames[0]} ${fmtMoney(r.a)}`}</title>
              </circle>
            ))}
          </>
        )}
        {hasBudget &&
          rows.map((r, i) =>
            r.budget == null ? null : (
              <line
                key={"b" + r.key}
                x1={cx(i) - Math.max(barW, 10) / 2 - 4}
                x2={cx(i) + Math.max(barW, 10) / 2 + 4}
                y1={Y(r.budget)}
                y2={Y(r.budget)}
                className="cc-budgetTick"
              >
                <title>{`${r.label}: budget ${fmtMoney(r.budget)}`}</title>
              </line>
            )
          )}
        {rows.map((r, i) =>
          i % everyN === 0 || i === n - 1 ? (
            <text key={"l" + r.key} x={cx(i)} y={H - 6} textAnchor="middle" className="cc-axis">
              {r.label}
            </text>
          ) : null
        )}
      </svg>
      <div className={styles.legend}>
        <span className={styles.legendItem}>
          <span className={styles.legendSwatchLine} style={{ background: color }} />
          {result.seriesNames[0]}
        </span>
        {second && (
          <span className={styles.legendItem}>
            <span className={styles.legendSwatchLine} style={{ background: secondColor }} />
            {second}
          </span>
        )}
        {hasBudget && (
          <span className={styles.legendItem}>
            <span className={`${styles.legendSwatchLine} ${styles.legendSwatchDashed}`} />
            Budget
          </span>
        )}
      </div>
    </div>
  );
}

/* ============================================================
   The card
   ============================================================ */

function CardMenu({ title, onEdit, onDuplicate, onDelete }: { title: string; onEdit: () => void; onDuplicate: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setConfirming(false);
      }
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setConfirming(false);
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("touchstart", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("touchstart", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  const pick = (fn: () => void) => () => {
    setOpen(false);
    setConfirming(false);
    fn();
  };
  return (
    <div className="cc-menuWrap" ref={ref}>
      <button
        type="button"
        className="cc-menuBtn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Options for ${title}`}
        onClick={() => setOpen(!open)}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="19" cy="12" r="1.8" />
        </svg>
      </button>
      {open && (
        <div className="cc-menu" role="menu">
          {confirming ? (
            <div className="cc-menuConfirm">
              <p>Delete this card? This can't be undone.</p>
              <div className="cc-menuConfirmRow">
                <button type="button" className="cc-menuDanger" onClick={pick(onDelete)}>
                  Delete
                </button>
                <button type="button" className="cc-menuItem" onClick={() => setConfirming(false)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <button type="button" role="menuitem" className="cc-menuItem" onClick={pick(onEdit)}>
                Edit card
              </button>
              <button type="button" role="menuitem" className="cc-menuItem" onClick={pick(onDuplicate)}>
                Duplicate
              </button>
              <button type="button" role="menuitem" className="cc-menuItem cc-menuItemDanger" onClick={() => setConfirming(true)}>
                Delete…
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function CustomCardBody({ def, source }: { def: CustomCardDef; source: any }) {
  const r = useMemo(() => ccCompute(def, source), [def, source]);
  const color = accentColor(def.accent);
  if (r.empty) return <div className={styles.emptyNote}>{r.empty}</div>;
  const shown = r.transactions.slice(0, def.txn.limit);
  const maxBreak = Math.max(1, ...r.breakdown.map((b) => Math.max(Math.abs(b.amount), b.budget || 0)));
  return (
    <>
      {def.show.summary && (
        <>
          <div className="cc-stats">
            {r.stats.map((s) => (
              <div className="cc-stat" key={s.label}>
                <div className="cc-statLabel">{s.label}</div>
                <div className={`cc-statValue ${styles.num} ${s.tone === "good" ? "cc-good" : s.tone === "bad" ? "cc-bad" : ""}`}>{s.value}</div>
              </div>
            ))}
          </div>
          {r.progress && (
            <div className="cc-progress">
              <div className="cc-progressTrack" role="img" aria-label={`${Math.round(r.progress.pct)}% of budget`}>
                <div
                  className="cc-progressFill"
                  style={{ width: `${Math.min(100, r.progress.pct)}%`, background: r.progress.over ? "var(--critical)" : color }}
                />
              </div>
              <div className={`cc-progressText ${r.progress.over ? "cc-bad" : ""}`}>
                {Math.round(r.progress.pct)}% of budget · {r.progress.text}
              </div>
            </div>
          )}
        </>
      )}
      {def.show.chart && r.series.length > 0 && <CCChart result={r} kind={def.chart} color={color} />}
      {def.show.breakdown && r.breakdown.length > 0 && (
        <div className="cc-section">
          <div className="cc-sectionTitle">{r.breakdownTitle}</div>
          {r.breakdown.map((b) => (
            <div className="cc-breakRow" key={b.name}>
              <div className="cc-breakName" title={b.name}>
                {b.name}
              </div>
              <div className="cc-breakBar">
                <div className="cc-breakFill" style={{ width: `${(Math.abs(b.amount) / maxBreak) * 100}%`, background: b.amount < 0 ? "var(--critical)" : color }} />
                {b.budget != null && <div className="cc-breakMark" style={{ left: `${Math.min(100, (b.budget / maxBreak) * 100)}%` }} title={`Budget ${fmtMoney(b.budget)}`} />}
              </div>
              <div className={`cc-breakAmt ${styles.num}`}>{fmtMoney(b.amount)}</div>
            </div>
          ))}
        </div>
      )}
      {def.show.transactions && (
        <div className="cc-section">
          <div className="cc-sectionTitle">
            Transactions
            {r.transactions.length > 0 && (
              <span className="cc-sectionMeta">
                {r.transactions.length > shown.length ? `Latest ${shown.length} of ${r.transactions.length}` : `${r.transactions.length}`} · net {fmtMoney(r.transactionsTotal)}
              </span>
            )}
          </div>
          {shown.length === 0 ? (
            <div className="cc-txnEmpty">No transactions match in this period.</div>
          ) : (
            <ul className="cc-txnList">
              {shown.map((t, i) => (
                <li className="cc-txn" key={t.date + t.description + i}>
                  <span className="cc-txnDate">{fmtDate(t.date)}</span>
                  <span className="cc-txnMain">
                    <span className="cc-txnDesc">{t.description}</span>
                    {t.detail && <span className="cc-txnDetail">{t.detail}</span>}
                  </span>
                  <span className={`cc-txnAmt ${styles.num} ${t.amount > 0 ? "cc-good" : ""}`}>{t.amount > 0 ? "+" + fmtMoney(t.amount) : fmtMoney(t.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {r.notes.length > 0 && (
        <div className="cc-notes">
          {r.notes.map((n) => (
            <div key={n}>{n}</div>
          ))}
        </div>
      )}
    </>
  );
}

function CustomCardPanel({
  def,
  source,
  wdProps,
  onEdit,
  onDuplicate,
  onDelete,
  preview,
}: {
  def: CustomCardDef;
  source: any;
  wdProps?: object;
  onEdit?: () => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
  preview?: boolean;
}) {
  const title = def.title.trim() || ccSuggestTitle(def);
  const r = useMemo(() => ccCompute(def, source), [def, source]);
  const color = accentColor(def.accent);
  return (
    <div className={`${styles.panel} cc-card`} style={{ "--cc-accent": color } as any} {...(wdProps || {})}>
      <div className={styles.panelHead}>
        <div className={styles.panelTitleRow}>
          <span className="cc-dot" style={{ background: color }} aria-hidden="true" />
          <div>
            <div className={styles.panelTitle}>{title}</div>
            <div className={styles.panelSub}>{r.periodText || "Custom card"}</div>
          </div>
        </div>
        {!preview && onEdit && onDuplicate && onDelete && <CardMenu title={title} onEdit={onEdit} onDuplicate={onDuplicate} onDelete={onDelete} />}
      </div>
      <CustomCardBody def={def} source={source} />
    </div>
  );
}

/* ============================================================
   Builder
   ============================================================ */

const CC_TEMPLATES: { label: string; hint: string; apply: (src: any) => Partial<CustomCardDef> }[] = [
  {
    label: "Track a budget category",
    hint: "Spending vs. budget over the last 3 months, with its transactions",
    apply: () => ({ source: "categories", period: "last-3", show: { summary: true, chart: true, breakdown: false, transactions: true } }),
  },
  {
    label: "Find transactions by keyword",
    hint: "Everything with a word like “youth” or “retreat” in it",
    apply: () => ({
      source: "accounts",
      items: [],
      period: "last-3",
      show: { summary: true, chart: false, breakdown: false, transactions: true },
      txn: { limit: 10, direction: "all", keyword: "", minAmount: null },
    }),
  },
  {
    label: "Where the money went",
    hint: "Spending by category for the period you choose",
    apply: () => ({ source: "expenses", period: "this-month", show: { summary: true, chart: false, breakdown: true, transactions: false } }),
  },
  {
    label: "Income vs. spending",
    hint: "Both totals month by month, and what's left over",
    apply: () => ({ source: "net", period: "last-6", chart: "bars", show: { summary: true, chart: true, breakdown: false, transactions: false } }),
  },
  {
    label: "Large transactions",
    hint: "Anything over an amount you set, across your accounts",
    apply: () => ({
      source: "accounts",
      items: [],
      period: "last-month",
      show: { summary: false, chart: false, breakdown: false, transactions: true },
      txn: { limit: 10, direction: "all", keyword: "", minAmount: 1000 },
    }),
  },
  {
    label: "Fund snapshot",
    hint: "Fund balances plus recent gifts and transfers",
    apply: () => ({ source: "funds", items: [], period: "last-3", show: { summary: true, chart: true, breakdown: true, transactions: true } }),
  },
];

function Checklist({
  options,
  selected,
  onChange,
  emptyText,
  allMeansEverything,
}: {
  options: { name: string; meta?: string }[];
  selected: string[];
  onChange: (next: string[]) => void;
  emptyText: string;
  allMeansEverything?: boolean;
}) {
  const [q, setQ] = useState("");
  const shown = options.filter((o) => norm(o.name).includes(norm(q)));
  if (!options.length) return <p className="cc-help">{emptyText}</p>;
  const toggle = (name: string) => onChange(selected.includes(name) ? selected.filter((x) => x !== name) : [...selected, name]);
  return (
    <div className="cc-checklistWrap">
      {options.length > 6 && (
        <input type="search" className="cc-input" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the list" />
      )}
      <div className="cc-checklistTools">
        <span>{selected.length ? `${selected.length} selected` : allMeansEverything ? "None selected = all of them" : "None selected"}</span>
        <span>
          <button type="button" className="cc-linkBtn" onClick={() => onChange(Array.from(new Set([...selected, ...shown.map((o) => o.name)])))}>
            Select all
          </button>
          {" · "}
          <button type="button" className="cc-linkBtn" onClick={() => onChange([])}>
            Clear
          </button>
        </span>
      </div>
      <div className="cc-checklist" role="group">
        {shown.map((o) => (
          <label className="cc-check" key={o.name}>
            <input type="checkbox" checked={selected.includes(o.name)} onChange={() => toggle(o.name)} />
            <span className="cc-checkName">{o.name}</span>
            {o.meta && <span className="cc-checkMeta">{o.meta}</span>}
          </label>
        ))}
        {!shown.length && <p className="cc-help">Nothing matches “{q}”.</p>}
      </div>
    </div>
  );
}

/* ============================================================
   Describe it: a free, rule-based reader that turns a sentence like
   "youth budget for the last 3 months" into builder settings. It only
   matches words against this client's own category, account and fund
   names and a fixed list of phrases; nothing leaves the browser.
   ============================================================ */

const CC_STOP = new Set(
  ("a an and the of for to in on at by with from my our me show see track give list all any every " +
    "card cards last past previous recent recently this that these those months month weeks week year years " +
    "quarter ytd date so far budget budgets budgeted spending spent spend expenses expense costs cost income " +
    "revenue money transactions transaction activity vs versus compared compare against over above under below " +
    "more than less large big chart graph trend line bars bar breakdown category categories account accounts " +
    "bank banks card balance balances fund funds total totals each per how much what where went came is are was " +
    "it its i we us please want would like can could just only also left net surplus deficit in out deposits " +
    "deposit payments payment withdrawals charges incoming outgoing blue orange green gold purple slate gray grey " +
    "color colour one two three four five six twelve half end giving donations donation gifts gift offerings " +
    "offering tithes tithe contributions").split(" ")
);
const CC_NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, nine: 9, twelve: 12 };

function ccStem(w: string): string {
  w = w.replace(/'s$/, "");
  if (w.length > 4 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}
const ccWords = (s: string) => norm(s).replace(/[^a-z0-9$.,' ]+/g, " ").split(/\s+/).filter(Boolean);

interface CCParseResult {
  patch: Partial<CustomCardDef> | null;
  catType: "expense" | "income" | null;
  understood: string[];
  hint: string | null;
}

// A name matches when the whole name appears in the sentence, or when one of
// its distinctive words does ("missions" -> "Missions & Outreach").
function ccMatchNames(text: string, words: Set<string>, names: string[]): { hits: string[]; used: Set<string> } {
  const t = " " + ccWords(text).join(" ") + " ";
  const used = new Set<string>();
  const whole = names.filter((n) => {
    const p = ccWords(tail(n)).join(" ");
    return p.length > 2 && t.includes(" " + p + " ");
  });
  if (whole.length) {
    whole.forEach((n) => ccWords(tail(n)).forEach((w) => used.add(ccStem(w))));
    return { hits: whole, used };
  }
  const hits = names.filter((n) => {
    const own = ccWords(tail(n)).map(ccStem).filter((w) => w.length > 2 && !CC_STOP.has(w));
    const match = own.filter((w) => words.has(w));
    match.forEach((w) => used.add(w));
    return match.length > 0;
  });
  return { hits, used };
}

function ccParse(text: string, src: any): CCParseResult {
  const raw = norm(text);
  const none: CCParseResult = { patch: null, catType: null, understood: [], hint: null };
  if (!raw) return none;
  const list = ccWords(raw);
  const words = new Set(list.map(ccStem));
  const has = (...ps: string[]) => ps.some((p) => (p.includes(" ") ? (" " + list.join(" ") + " ").includes(" " + p + " ") : words.has(ccStem(p))));
  const understood: string[] = [];

  // Period
  let period: CCPeriod | null = null;
  const nMatch = raw.match(/(\d+|one|two|three|four|five|six|nine|twelve)\s*(?:-\s*)?(month|week|year)s?/);
  if (has("year to date", "ytd", "this year", "so far this year")) period = "ytd";
  else if (nMatch) {
    const n = /\d/.test(nMatch[1]) ? Number(nMatch[1]) : CC_NUMBER_WORDS[nMatch[1]];
    const months = nMatch[2] === "year" ? n * 12 : nMatch[2] === "week" ? Math.ceil(n / 4) : n;
    period = months <= 1 ? "last-month" : months <= 3 ? "last-3" : months <= 6 ? "last-6" : "last-12";
  } else if (has("this month", "month to date", "so far")) period = "this-month";
  else if (has("last month", "previous month", "past month")) period = "last-month";
  else if (has("quarter")) period = "last-3";
  else if (has("half year", "half a year")) period = "last-6";
  else if (has("last year", "past year", "year", "annual", "yearly")) period = "last-12";
  if (period) understood.push((CC_PERIODS.find((p) => p.id === period) as any).label);

  // Amount: "over $1,000", "more than 500", "large"
  let minAmount: number | null = null;
  const amt = raw.match(/(?:over|above|more than|greater than|bigger than|at least|>)\s*\$?\s*([\d,]+(?:\.\d+)?)\s*(k)?/);
  if (amt) minAmount = Number(amt[1].replace(/,/g, "")) * (amt[2] ? 1000 : 1) || null;
  else if (has("large", "big")) minAmount = 1000;
  if (minAmount) understood.push(`Over ${fmtMoney(minAmount)}`);

  // Direction
  let direction: "all" | "in" | "out" = "all";
  if (has("money in", "deposits", "deposit", "incoming", "received")) direction = "in";
  else if (has("money out", "payments", "withdrawals", "charges", "outgoing", "paid")) direction = "out";
  if (direction !== "all") understood.push(direction === "in" ? "Money in only" : "Money out only");

  // Names the client actually has
  const cats = (src.categories || []) as any[];
  const accounts = (src.accounts || []) as any[];
  const funds = (src.funds || []) as any[];
  const catHit = ccMatchNames(raw, words, cats.map((c) => c.name));
  const acctHit = ccMatchNames(raw, words, accounts.map((a) => a.name));
  const fundHit = ccMatchNames(raw, words, funds.map((f) => f.name));
  const used = new Set([...catHit.used, ...acctHit.used, ...fundHit.used]);

  // Whatever's left is a keyword to look for in transactions ("youth").
  const leftovers = list.map(ccStem).filter((w) => w.length > 2 && !CC_STOP.has(w) && !used.has(w) && !/^[\d$.,k]+$/.test(w));
  const kwWord = leftovers.length ? list.find((w) => ccStem(w) === leftovers[0]) || leftovers[0] : "";
  const allTx = accounts.flatMap((a) => a.transactions || []);
  const kwTx = kwWord ? allTx.filter((t: any) => norm(t.description).includes(ccStem(kwWord))) : [];

  // Source
  let source: CCSource;
  let items: string[] = [];
  let keyword = "";
  const wantsBudget = has("budget", "budgets", "budgeted", "spending", "spent", "expenses", "costs");
  const wantsIncome = has("income", "revenue", "giving", "donations", "gifts", "offerings");
  if (has("vs", "versus", "net", "left over", "surplus", "deficit") || (has("income") && has("spending", "expenses"))) {
    source = "net";
  } else if (has("fund", "funds") || (fundHit.hits.length && !catHit.hits.length)) {
    source = "funds";
    items = fundHit.hits;
  } else if (catHit.hits.length) {
    source = "categories";
    items = catHit.hits;
    // "youth ministry" can hit both Kids Ministry and Ministry Programs; keep
    // the ones the keyword's transactions are actually booked to.
    if (items.length > 1 && kwTx.length) {
      const booked = items.filter((n) => kwTx.some((t: any) => categoryMatches(t.category, n)));
      if (booked.length) items = booked;
    }
    if (kwWord) keyword = kwWord;
  } else if (acctHit.hits.length || has("account", "accounts", "bank", "balance", "balances", "card")) {
    source = "accounts";
    items = acctHit.hits;
    if (kwWord) keyword = kwWord;
  } else if (kwWord && kwTx.length) {
    // "youth budget": no category is called youth, so find the categories
    // its transactions are booked to and track those, filtered by the word.
    const counts: Record<string, number> = {};
    kwTx.forEach((t: any) => {
      const c = cats.find((c) => categoryMatches(t.category, c.name));
      if (c) counts[c.name] = (counts[c.name] || 0) + 1;
    });
    const viaCats = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
    if (wantsBudget && viaCats.length) {
      source = "categories";
      items = viaCats.slice(0, 3);
    } else {
      source = "accounts";
    }
    keyword = kwWord;
  } else if (wantsIncome) source = "income";
  else if (has("spending", "spent", "expenses", "costs", "where the money went")) source = "expenses";
  else if (minAmount || direction !== "all" || has("transactions", "transaction")) source = "accounts";
  else {
    return {
      ...none,
      understood,
      hint: kwWord
        ? `Couldn't find “${kwWord}” in your categories, accounts or recent transactions. Try a category name or a time period.`
        : "Try naming a category, an account, or a time period, like “Missions last 6 months”.",
    };
  }

  const srcLabel = (CC_SOURCES.find((s) => s.id === source) as any).label;
  understood.unshift(items.length ? `${srcLabel}: ${items.join(", ")}` : srcLabel);
  if (keyword) understood.push(`Transactions with “${keyword}”`);

  // What to show
  const isTxnCard = source === "accounts" && !has("balance", "balances");
  const show = {
    summary: !(source === "accounts" && minAmount) || has("total", "totals", "summary"),
    chart: has("chart", "graph", "trend", "line", "bars") || (!isTxnCard && source !== "funds" ? true : source === "funds"),
    breakdown: has("breakdown", "by category", "where the money went", "where it went", "where it came from") || source === "funds",
    transactions: has("transactions", "transaction", "list") || isTxnCard || Boolean(keyword) || source === "categories",
  };
  if (source === "expenses" || source === "income") show.breakdown = show.breakdown || !has("chart", "graph", "trend");

  const colour = CC_ACCENTS.find((a) => words.has(a.id)) || (has("gray", "grey") ? CC_ACCENTS.find((a) => a.id === "slate") : null);

  const catType = source === "categories" && items.length ? ((cats.find((c) => c.name === items[0]) || {}).type === "income" ? "income" : "expense") : null;
  const patch: Partial<CustomCardDef> = {
    source,
    items,
    period: period || (source === "accounts" ? "last-month" : "last-3"),
    show,
    chart: has("line", "trend") ? "line" : "bars",
    compareBudget: source !== "accounts" && source !== "funds",
    txn: { limit: has("all", "every") ? 20 : keyword || isTxnCard ? 10 : 5, direction, keyword, minAmount },
  };
  if (colour) {
    patch.accent = colour.id;
    understood.push(colour.label);
  }
  if (!period) understood.push((CC_PERIODS.find((p) => p.id === patch.period) as any).label + " (default)");
  return { patch, catType, understood, hint: null };
}

function validate(def: CustomCardDef, src: any): string | null {
  if (def.source === "categories" && !def.items.length) return "Pick at least one category.";
  if (def.source === "funds" && !(src.funds || []).length) return "No funds are set up for this account yet.";
  if (!def.show.summary && !def.show.chart && !def.show.breakdown && !def.show.transactions) return "Turn on at least one section to show.";
  return null;
}

function CustomCardBuilder({
  initial,
  source,
  theme,
  onSave,
  onCancel,
}: {
  initial: CustomCardDef | null;
  source: any;
  theme?: string;
  onSave: (def: CustomCardDef) => void;
  onCancel: () => void;
}) {
  const isNew = !initial;
  const [def, setDef] = useState<CustomCardDef>(() => (initial ? ccNormalize(initial) || ccDefaults() : ccDefaults()));
  const [titleTouched, setTitleTouched] = useState(Boolean(initial && initial.title));
  const [catType, setCatType] = useState<"expense" | "income">(() => {
    const first = initial && initial.source === "categories" && (source.categories || []).find((c: any) => c.name === initial.items[0]);
    return first && first.type === "income" ? "income" : "expense";
  });
  const [tried, setTried] = useState(false);
  const templatesRef = useRef<HTMLDetailsElement>(null);
  const [describe, setDescribe] = useState("");
  const [parsed, setParsed] = useState<CCParseResult | null>(null);
  const fillFromText = () => {
    const r = ccParse(describe, source);
    setParsed(r);
    if (!r.patch) return;
    const base = ccDefaults();
    setDef((d) => ({ ...base, ...r.patch, id: d.id, accent: r.patch!.accent || d.accent, title: "" }));
    if (r.catType) setCatType(r.catType);
    setTitleTouched(false);
    if (templatesRef.current) templatesRef.current.open = false;
  };
  const set = (patch: Partial<CustomCardDef>) => setDef((d) => ({ ...d, ...patch }));
  const setShow = (k: keyof CustomCardDef["show"], v: boolean) => setDef((d) => ({ ...d, show: { ...d.show, [k]: v } }));
  const setTxn = (patch: Partial<CustomCardDef["txn"]>) => setDef((d) => ({ ...d, txn: { ...d.txn, ...patch } }));

  const hasPartial = (source.months || []).some((m: any) => m.partial);
  const hasFunds = (source.funds || []).length > 0;
  const cats = (source.categories || []).filter((c: any) => c.type === catType);
  const hasIncomeCats = (source.categories || []).some((c: any) => c.type === "income");
  const budgetable = (def.source === "categories" || def.source === "income" || def.source === "expenses") && source.hasBudget;
  const error = validate(def, source);
  const finalDef = { ...def, title: (titleTouched ? def.title : "").trim() };
  const lastKey = ((source.months || [])[(source.months || []).length - 1] || {}).key;
  const catMeta = (c: any) => {
    const cell = lastKey && c.byMonth[lastKey];
    return cell ? `${fmtMoney(cell.actual)} latest month` : "";
  };

  const save = () => {
    setTried(true);
    if (error) return;
    onSave({ ...finalDef, title: finalDef.title || ccSuggestTitle(finalDef) });
  };

  const Shell: any = typeof ModalShell === "function" ? ModalShell : null;
  const content = (
    <form
      className="cc-builder"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div className="modal-header">
        <h3 className="card-title" id="cc-builder-title" style={{ margin: 0 }}>
          {isNew ? "Create a custom card" : "Edit custom card"}
        </h3>
        <button type="button" className="modal-close" onClick={onCancel} aria-label="Close">
          ×
        </button>
      </div>
      <div className="modal-body cc-builderBody">
        <div className="cc-builderGrid">
          <div className="cc-form">
            <div className="cc-describe">
              <label htmlFor="cc-describe-input">Describe the card you want</label>
              <div className="cc-describeRow">
                <input
                  id="cc-describe-input"
                  className="cc-input"
                  placeholder="e.g. youth budget for the last 3 months"
                  value={describe}
                  maxLength={200}
                  onChange={(e) => setDescribe(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      fillFromText();
                    }
                  }}
                />
                <button type="button" className="btn-secondary" onClick={fillFromText} disabled={!describe.trim()}>
                  Fill in
                </button>
              </div>
              {parsed && parsed.patch && (
                <p className="cc-help cc-understood">
                  Filled in: {parsed.understood.join(" · ")}. Check the settings below and change anything that's off.
                </p>
              )}
              {parsed && !parsed.patch && <p className="cc-help cc-understood is-miss">{parsed.hint}</p>}
            </div>
            {isNew && (
              <details className="cc-templates" ref={templatesRef}>
                <summary>Start from an idea</summary>
                <div className="cc-templateList">
                  {CC_TEMPLATES.filter((t) => !(t.label === "Fund snapshot" && !hasFunds)).map((t) => (
                    <button
                      type="button"
                      key={t.label}
                      className="cc-template"
                      onClick={() => {
                        setDef((d) => ({ ...d, ...t.apply(source), id: d.id }));
                        setTitleTouched(false);
                        if (templatesRef.current) templatesRef.current.open = false;
                      }}
                    >
                      <strong>{t.label}</strong>
                      <span>{t.hint}</span>
                    </button>
                  ))}
                </div>
              </details>
            )}

            <fieldset className="cc-fieldset">
              <legend>1. What should it track?</legend>
              <div className="cc-chips">
                {CC_SOURCES.filter((s) => s.id !== "funds" || hasFunds || def.source === "funds").map((s) => (
                  <label className={`cc-chip ${def.source === s.id ? "is-on" : ""}`} key={s.id}>
                    <input
                      type="radio"
                      name="cc-source"
                      checked={def.source === s.id}
                      onChange={() => set({ source: s.id, items: [] })}
                    />
                    <strong>{s.label}</strong>
                    <span>{s.hint}</span>
                  </label>
                ))}
              </div>
              {def.source === "categories" && (
                <div className="cc-sub">
                  {hasIncomeCats && (
                    <div className="cc-seg" role="radiogroup" aria-label="Category type">
                      {(["expense", "income"] as const).map((t) => (
                        <button
                          type="button"
                          key={t}
                          role="radio"
                          aria-checked={catType === t}
                          className={catType === t ? "is-on" : ""}
                          onClick={() => {
                            setCatType(t);
                            set({ items: [] });
                          }}
                        >
                          {t === "expense" ? "Spending categories" : "Income categories"}
                        </button>
                      ))}
                    </div>
                  )}
                  <Checklist
                    options={cats.map((c: any) => ({ name: c.name, meta: catMeta(c) }))}
                    selected={def.items}
                    onChange={(items) => set({ items })}
                    emptyText="No categories have been recorded yet."
                  />
                  <p className="cc-help">Pick several to combine them into one total.</p>
                </div>
              )}
              {def.source === "accounts" && (
                <div className="cc-sub">
                  <Checklist
                    options={(source.accounts || []).map((a: any) => ({ name: a.name, meta: a.kind === "card" ? "Card" : fmtMoney(a.balance) }))}
                    selected={def.items}
                    onChange={(items) => set({ items })}
                    emptyText="No bank accounts are connected yet."
                    allMeansEverything
                  />
                </div>
              )}
              {def.source === "funds" && (
                <div className="cc-sub">
                  <Checklist
                    options={(source.funds || []).map((f: any) => ({ name: f.name, meta: fmtMoney(f.balance) }))}
                    selected={def.items}
                    onChange={(items) => set({ items })}
                    emptyText="No funds are set up for this account yet."
                    allMeansEverything
                  />
                </div>
              )}
            </fieldset>

            <fieldset className="cc-fieldset">
              <legend>2. Time period</legend>
              <div className="cc-row">
                <select className="cc-input" value={def.period} onChange={(e) => set({ period: e.target.value as CCPeriod })} aria-label="Time period">
                  {CC_PERIODS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
                {hasPartial && def.period !== "this-month" && def.period !== "last-month" && (
                  <label className="cc-inline">
                    <input type="checkbox" checked={def.includeCurrent} onChange={(e) => set({ includeCurrent: e.target.checked })} />
                    Include this month so far
                  </label>
                )}
              </div>
            </fieldset>

            <fieldset className="cc-fieldset">
              <legend>3. What to show</legend>
              <div className="cc-toggles">
                <label className="cc-inline">
                  <input type="checkbox" checked={def.show.summary} onChange={(e) => setShow("summary", e.target.checked)} />
                  Summary totals
                </label>
                <label className="cc-inline">
                  <input type="checkbox" checked={def.show.chart} onChange={(e) => setShow("chart", e.target.checked)} />
                  Month-by-month chart
                </label>
                <label className="cc-inline">
                  <input type="checkbox" checked={def.show.breakdown} onChange={(e) => setShow("breakdown", e.target.checked)} />
                  Breakdown list
                </label>
                <label className="cc-inline">
                  <input type="checkbox" checked={def.show.transactions} onChange={(e) => setShow("transactions", e.target.checked)} />
                  Transactions
                </label>
              </div>
              {def.show.chart && (
                <div className="cc-row">
                  <div className="cc-seg" role="radiogroup" aria-label="Chart style">
                    {(["bars", "line"] as const).map((c) => (
                      <button type="button" key={c} role="radio" aria-checked={def.chart === c} className={def.chart === c ? "is-on" : ""} onClick={() => set({ chart: c })}>
                        {c === "bars" ? "Bars" : "Line"}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {budgetable && (
                <label className="cc-inline">
                  <input type="checkbox" checked={def.compareBudget} onChange={(e) => set({ compareBudget: e.target.checked })} />
                  Compare with budget
                </label>
              )}
            </fieldset>

            {def.show.transactions && (
              <fieldset className="cc-fieldset">
                <legend>4. Which transactions</legend>
                <div className="cc-grid2">
                  <label className="cc-field">
                    <span>Only if the description has</span>
                    <input
                      type="text"
                      className="cc-input"
                      placeholder="e.g. youth, retreat, Amazon"
                      maxLength={60}
                      value={def.txn.keyword}
                      onChange={(e) => setTxn({ keyword: e.target.value })}
                    />
                  </label>
                  <label className="cc-field">
                    <span>Money in or out</span>
                    <select className="cc-input" value={def.txn.direction} onChange={(e) => setTxn({ direction: e.target.value as any })}>
                      <option value="all">Both</option>
                      <option value="out">Money out only</option>
                      <option value="in">Money in only</option>
                    </select>
                  </label>
                  <label className="cc-field">
                    <span>At least this amount</span>
                    <input
                      type="number"
                      className="cc-input"
                      min={0}
                      step="1"
                      inputMode="decimal"
                      placeholder="Any amount"
                      value={def.txn.minAmount == null ? "" : def.txn.minAmount}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        setTxn({ minAmount: isFinite(v) && v > 0 ? v : null });
                      }}
                    />
                  </label>
                  <label className="cc-field">
                    <span>How many to list</span>
                    <select className="cc-input" value={def.txn.limit} onChange={(e) => setTxn({ limit: Number(e.target.value) })}>
                      {[5, 10, 20].map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {def.source === "accounts" && <p className="cc-help">The keyword and amount filters also set the card's money in and money out totals.</p>}
              </fieldset>
            )}

            <fieldset className="cc-fieldset">
              <legend>{def.show.transactions ? "5." : "4."} Name and color</legend>
              <label className="cc-field">
                <span>Card title</span>
                <input
                  type="text"
                  className="cc-input"
                  maxLength={80}
                  placeholder={ccSuggestTitle(def)}
                  value={titleTouched ? def.title : ""}
                  onChange={(e) => {
                    setTitleTouched(true);
                    set({ title: e.target.value });
                  }}
                />
              </label>
              <div className="cc-swatches" role="radiogroup" aria-label="Card color">
                {CC_ACCENTS.map((a) => (
                  <button
                    type="button"
                    key={a.id}
                    role="radio"
                    aria-checked={def.accent === a.id}
                    aria-label={a.label}
                    title={a.label}
                    className={`cc-swatch ${def.accent === a.id ? "is-on" : ""}`}
                    style={{ background: a.color }}
                    onClick={() => set({ accent: a.id })}
                  />
                ))}
              </div>
            </fieldset>
          </div>

          <div className="cc-previewCol">
            <div className="cc-previewLabel">Preview</div>
            <div className="dc-dailyClose cc-previewFrame" data-theme={theme}>
              <CustomCardPanel def={finalDef} source={source} preview />
            </div>
            <p className="cc-help">Uses your latest synced numbers. Only you see your custom cards.</p>
          </div>
        </div>
      </div>
      <div className="modal-footer">
        <span className="cc-error" role="alert">
          {tried && error ? error : ""}
        </span>
        <span className="cc-footBtns">
          <button type="button" className="btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn-primary">
            {isNew ? "Add to overview" : "Save changes"}
          </button>
        </span>
      </div>
    </form>
  );

  return ReactDOM.createPortal(
    Shell ? (
      <Shell onClose={onCancel} labelledBy="cc-builder-title" className="cc-modal">
        {content}
      </Shell>
    ) : (
      <div className="modal-overlay" onClick={onCancel}>
        <div className="modal-panel cc-modal" role="dialog" aria-modal="true" aria-labelledby="cc-builder-title" onClick={(e) => e.stopPropagation()}>
          {content}
        </div>
      </div>
    ),
    document.body
  );
}

window.MGB_CustomCards = {
  MAX: CC_MAX_CARDS,
  newId: ccNewId,
  normalizeList: ccNormalizeList,
  parse: ccParse,
  describe: ccDescribe,
  suggestTitle: ccSuggestTitle,
  compute: ccCompute,
  Panel: CustomCardPanel,
  Builder: CustomCardBuilder,
};
})();
