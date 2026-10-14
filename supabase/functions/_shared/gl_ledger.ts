// ----------------------------------------------------------------------------
// GL Review: pure ledger helpers for the qbo-gl-review edge function
// (docs/gl-review-spec.md sections 2.1, 2.2, 4.5). No Deno, no network, no
// Supabase, so tests/edge/*.test.mjs import this file directly with node.
// Erasable TypeScript only (no enums, no parameter properties).
//
//   resolveWindow / quarterChunks / halveChunk / coveredMonths   windows (2.2)
//   glColumns / parseGlReport / reportWarning / sectionMismatches  report (2.1)
//   buildLines        raw rows -> the line shape GLR_parse.normalizeApiLine reads
//   monthPrints / lineString / baselineLines   fingerprints, byte-for-byte the
//                     same strings as components/ledger/GLR_fingerprint.js
//
// The account-type helpers are a port of components/ledger/GLR_config.js
// (normalizeAccountType, classificationOf, guessAccountType, toCents). They
// must stay identical: the browser re-derives classification from the same
// fields, and debit_total depends on it. tests/edge/gl_ledger.test.mjs checks
// parity against the browser files.
// ----------------------------------------------------------------------------
import { num, reportColumn, walkDataRows } from "./qbo_report.ts";

// ---------------------------------------------------------------------------
// Account types (port of GLR_config.js; keep in step)
// ---------------------------------------------------------------------------
export const CLASSIFICATION_BY_TYPE: Record<string, string> = {
  "Bank": "Asset",
  "Accounts Receivable": "Asset",
  "Other Current Asset": "Asset",
  "Fixed Asset": "Asset",
  "Other Asset": "Asset",
  "Accounts Payable": "Liability",
  "Credit Card": "Liability",
  "Other Current Liability": "Liability",
  "Long Term Liability": "Liability",
  "Equity": "Equity",
  "Income": "Revenue",
  "Other Income": "Revenue",
  "Expense": "Expense",
  "Other Expense": "Expense",
  "Cost of Goods Sold": "Expense",
};
const TYPE_ALIASES: Record<string, string> = {};
for (const t of Object.keys(CLASSIFICATION_BY_TYPE)) {
  TYPE_ALIASES[t.toLowerCase()] = t;
  TYPE_ALIASES[t.replace(/\s+/g, "").toLowerCase()] = t;
}
TYPE_ALIASES["costofgoodssold"] = "Cost of Goods Sold";

export function normalizeAccountType(t: unknown): string | null {
  if (t == null) return null;
  const k = String(t).trim().toLowerCase();
  if (!k) return null;
  return TYPE_ALIASES[k] || TYPE_ALIASES[k.replace(/\s+/g, "")] || null;
}

export function classificationOf(type: unknown): string | null {
  const t = normalizeAccountType(type);
  return t ? CLASSIFICATION_BY_TYPE[t] : null;
}

const RX_BANK_NAME = /checking|savings|bank|money market|petty cash|operating|\bcash\b/i;
const RX_NOT_BANK_NAME = /undeposited|expense|income|revenue/i;
const RX_PASS_THROUGH = /\b(bill\.?com|bill pay|divvy|ramp)\b/i;

export function guessAccountType(name: unknown): { type: string; fallback: boolean } {
  const raw = String(name == null ? "" : name).trim();
  const m = raw.match(/^(\d{3,6})(?:[.\-]\d+)?\s+(.*)$/);
  const numFirst = m ? m[1].charAt(0) : null;
  const n = (m ? m[2] : raw).toLowerCase();
  const R = (re: RegExp) => re.test(n);
  const out = (type: string, fallback?: boolean) => ({ type, fallback: !!fallback });

  if (R(/undeposited|uncategori[sz]ed asset/)) return out("Other Current Asset");
  if (R(/opening balance equity|retained earnings|net assets|\bequity\b|owner'?s? (draw|contribution|investment)/)) return out("Equity");
  if (R(/accounts receivable|\ba\/r\b/)) return out("Accounts Receivable");
  if (R(/accounts payable|\ba\/p\b/)) return out("Accounts Payable");
  if (R(/accumulated depreciation/)) return out("Fixed Asset");
  if (R(/interest expense|interest paid|loan interest|bank (service )?(charges?|fees?)/)) return out("Expense");
  if (R(/interest income|interest earned|dividend/)) return out("Other Income");
  if (R(/payroll liabilit|payroll tax(es)? payable|sales tax payable|accrued|\bpayable\b/) && !R(/note payable|notes payable|loan/)) return out("Other Current Liability");
  if (R(/\b(loan|mortgage|line of credit)\b|notes? payable/)) return out("Long Term Liability");
  if (R(/credit card|\bvisa\b|mastercard|\bamex\b|american express|discover card|charge card/)) return out("Credit Card");
  if (!numFirst && RX_PASS_THROUGH.test(n)) return out("Credit Card");
  if (numFirst === "1") return out(RX_BANK_NAME.test(n) && !RX_NOT_BANK_NAME.test(n) ? "Bank" : "Other Current Asset");
  if (numFirst === "2") return out(RX_PASS_THROUGH.test(n) ? "Credit Card" : "Other Current Liability");
  if (numFirst === "3") return out("Equity");
  if (numFirst === "4") return out("Income");
  if (numFirst && numFirst >= "5") return out("Expense");
  if (RX_BANK_NAME.test(n) && !RX_NOT_BANK_NAME.test(n)) return out("Bank");
  if (R(/income|revenue|offering|tithe|donation|contribution|\bgifts?\b|grant|\bsales\b|fundrais|tuition/)) return out("Income");
  if (R(/(equipment|furniture( (&|and) fixtures)?|vehicles?|buildings?|land|leasehold improvements)$/)) return out("Fixed Asset");
  if (R(/prepaid|inventory|other current asset/)) return out("Other Current Asset");
  return out("Expense", true);
}

// Integer cents, half away from zero (GLR_config.toCents).
export function toCents(amount: unknown): number {
  const n = Number(amount) || 0;
  const c = Math.round(Math.abs(n) * 100);
  return n < 0 && c ? -c : c;
}

export function normCleared(v: unknown): "R" | "C" | "" {
  const s = String(v ?? "").trim().toUpperCase();
  if (s === "R" || s === "RECONCILED") return "R";
  if (s === "C" || s === "CLEARED") return "C";
  return "";
}

// ---------------------------------------------------------------------------
// Dates: plain 'YYYY-MM-DD' strings, UTC arithmetic, no local time zone.
// ---------------------------------------------------------------------------
const DAY_RX = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isDay(s: unknown): boolean {
  const m = DAY_RX.exec(String(s ?? ""));
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}
function toDate(s: string): Date {
  const m = DAY_RX.exec(s)!;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
}
function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}
export function addDays(s: string, n: number): string {
  return iso(new Date(toDate(s).getTime() + n * 86400000));
}
export function monthStart(s: string): string {
  return s.slice(0, 7) + "-01";
}
export function monthEndOf(s: string): string {
  const d = toDate(monthStart(s));
  return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
}
export function addMonths(s: string, n: number): string {
  const d = toDate(monthStart(s));
  return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1)));
}
function dayDiff(a: string, b: string): number {
  return Math.round((toDate(b).getTime() - toDate(a).getTime()) / 86400000);
}

// ---------------------------------------------------------------------------
// Pull windows (spec 2.2 / 2.6)
// ---------------------------------------------------------------------------
export type WindowKind = "rolling14" | "ytd" | "custom" | "baseline";
export type PullWindow = { kind: WindowKind; start: string; end: string };

// Longest custom window: 24 months (prints are capped at 60 months anyway).
export const MAX_CUSTOM_MONTHS = 24;

// `today` is the firm's calendar date (America/Chicago), 'YYYY-MM-DD'.
// Returns the window or a plain-language error.
export function resolveWindow(
  action: "pull" | "baseline",
  input: { window?: unknown; period?: unknown },
  today: string,
): PullWindow | { error: string } {
  if (action === "baseline") {
    const p = String(input.period ?? "").trim();
    const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(p);
    const first = m ? `${m[1]}-${m[2]}-01` : "";
    if (!m || !isDay(first)) return { error: "Pick a month for the snapshot." };
    if (first > today) return { error: "That month hasn't started yet." };
    const end = monthEndOf(first);
    return { kind: "baseline", start: first, end: end > today ? today : end };
  }
  const w = input.window;
  if (w == null || w === "" || w === "rolling14") {
    return { kind: "rolling14", start: addMonths(today, -14), end: today };
  }
  if (w === "ytd") return { kind: "ytd", start: today.slice(0, 4) + "-01-01", end: today };
  if (typeof w === "object" && w) {
    const start = String((w as any).start ?? "").trim();
    const end = String((w as any).end ?? "").trim();
    if (!isDay(start) || !isDay(end)) return { error: "Dates must look like 2026-01-31." };
    if (start > end) return { error: "The start date is after the end date." };
    if (end > today) return { error: "The end date can't be in the future." };
    if (start < addMonths(end, -MAX_CUSTOM_MONTHS)) return { error: `Pick ${MAX_CUSTOM_MONTHS} months or less.` };
    return { kind: "custom", start, end };
  }
  return { error: "Unknown window. Use rolling14, ytd or {start, end}." };
}

export type Chunk = { start: string; end: string };

// One chunk per calendar quarter (the first and last may be partial).
export function quarterChunks(start: string, end: string): Chunk[] {
  const out: Chunk[] = [];
  let s = start;
  while (s <= end) {
    const d = toDate(s);
    const qEndMonth = Math.floor(d.getUTCMonth() / 3) * 3 + 2;
    const qEnd = iso(new Date(Date.UTC(d.getUTCFullYear(), qEndMonth + 1, 0)));
    const e = qEnd < end ? qEnd : end;
    out.push({ start: s, end: e });
    s = addDays(e, 1);
  }
  return out;
}

// Splits a chunk in two by date; null when it is a single day.
export function halveChunk(c: Chunk): [Chunk, Chunk] | null {
  const days = dayDiff(c.start, c.end);
  if (days < 1) return null;
  const midEnd = addDays(c.start, Math.floor(days / 2));
  return [{ start: c.start, end: midEnd }, { start: addDays(midEnd, 1), end: c.end }];
}

// Months ('YYYY-MM') the window covers completely, so their fingerprint is
// the whole month. The current month counts when the window runs to today.
export function coveredMonths(w: { start: string; end: string }, today: string): string[] {
  const out: string[] = [];
  for (let m = monthStart(w.start); m <= w.end; m = addMonths(m, 1)) {
    if (m < w.start) continue;
    const full = monthEndOf(m) <= w.end || (w.end >= today && m === monthStart(today));
    if (full) out.push(m.slice(0, 7));
  }
  return out;
}

// ---------------------------------------------------------------------------
// GeneralLedger report
// ---------------------------------------------------------------------------
export const GL_COLUMNS =
  "tx_date,txn_type,doc_num,name,memo,account_name,split_acc,subt_nat_amount,rbal_nat_amount,is_cleared,klass_name,dept_name";

export type GlCols = {
  date: number; type: number; num: number; name: number; memo: number; account: number;
  split: number; amt: number; bal: number; cleared: number; cls: number; loc: number;
};

export function glColumns(report: any): GlCols {
  return {
    date: reportColumn(report, "tx_date", "date"),
    type: reportColumn(report, "txn_type", "transaction type"),
    num: reportColumn(report, "doc_num", "num", "no."),
    name: reportColumn(report, "name", "name"),
    memo: reportColumn(report, "memo", "memo/description", "memo"),
    account: reportColumn(report, "account_name", "account"),
    split: reportColumn(report, "split_acc", "split"),
    amt: reportColumn(report, "subt_nat_amount", "amount"),
    bal: reportColumn(report, "rbal_nat_amount", "balance"),
    cleared: reportColumn(report, "is_cleared", "clr", "cleared"),
    cls: reportColumn(report, "klass_name", "class"),
    loc: reportColumn(report, "dept_name", "location", "department"),
  };
}

// A report-level warning that the report was cut short (spec 2.2). The exact
// Intuit wording is unverified (spec 11.7), so any Header.Option whose name
// or value mentions truncation / size limits counts.
const TRUNC_RX = /truncat|too\s*large|too\s*many|exceed|maximum|row\s*limit|cell\s*limit|partial/i;
export function reportWarning(report: any): string | null {
  for (const o of report?.Header?.Option || []) {
    const name = String(o?.Name ?? "");
    const value = String(o?.Value ?? "");
    if (/^NoReportData$/i.test(name)) continue;
    if (TRUNC_RX.test(name) || TRUNC_RX.test(value)) return name || "report option";
  }
  return null;
}

// Sections whose Summary amount disagrees with the sum of their own rows plus
// their sub-sections (spec 2.2: "a chunk whose total disagrees with its
// Summary"). Compared in integer cents. A Summary with a blank amount is not
// checked. Returns { checked, mismatched }.
export function sectionMismatches(report: any, amtIdx: number): { checked: number; mismatched: number } {
  const res = { checked: 0, mismatched: 0 };
  if (amtIdx < 0) return res;
  const sum = (row: any): number => {
    let cents = 0;
    for (const r of row?.Rows?.Row || []) {
      if (r?.Rows?.Row) cents += sum(r);
      else if (r?.ColData?.length) cents += toCents(num(r.ColData[amtIdx]?.value));
    }
    const sv = row?.Summary?.ColData?.[amtIdx]?.value;
    if (sv != null && String(sv).trim() !== "") {
      res.checked++;
      if (Math.abs(toCents(num(sv)) - cents) > 1) res.mismatched++;
    }
    return cents;
  };
  for (const r of report?.Rows?.Row || []) if (r?.Rows?.Row) sum(r);
  return res;
}

export type RawRow = {
  qbo_id: string | null; date: string; type: string; num: string; name: string; name_id: string | null;
  memo: string; split: string; amt: number; bal: number | null; acct_id: string | null; acct: string;
  cls: string; loc: string; cleared: string;
};

const txt = (v: unknown) => (v == null ? "" : String(v).trim());

// Data rows with a real date (skips Beginning Balance, totals, blank rows).
// The account is the innermost section header (id + name); the account_name
// cell is the fallback when a row sits outside any section.
export function parseGlReport(report: any): { rows: RawRow[]; cols: GlCols } {
  const cols = glColumns(report);
  const rows: RawRow[] = [];
  const cell = (cd: any[], i: number) => (i >= 0 ? cd[i] : undefined);
  walkDataRows(report?.Rows?.Row || [], (cd, section) => {
    const date = txt(cell(cd, cols.date)?.value);
    if (!isDay(date)) return;
    const typeCell = cell(cd, cols.type);
    const qboId = txt(cell(cd, cols.date)?.id) || txt(typeCell?.id) || null;
    const acctCell = section || cell(cd, cols.account) || null;
    const nameCell = cell(cd, cols.name);
    const balRaw = txt(cell(cd, cols.bal)?.value);
    rows.push({
      qbo_id: qboId,
      date,
      type: txt(typeCell?.value),
      num: txt(cell(cd, cols.num)?.value),
      name: txt(nameCell?.value),
      name_id: txt(nameCell?.id) || null,
      memo: txt(cell(cd, cols.memo)?.value),
      split: txt(cell(cd, cols.split)?.value),
      amt: num(cell(cd, cols.amt)?.value),
      bal: balRaw === "" ? null : num(balRaw),
      acct_id: txt(acctCell?.id) || null,
      acct: txt(acctCell?.value),
      cls: txt(cell(cd, cols.cls)?.value),
      loc: txt(cell(cd, cols.loc)?.value),
      cleared: cols.cleared >= 0 ? normCleared(cell(cd, cols.cleared)?.value) : "",
    });
  });
  return { rows, cols };
}

// TransactionList fallback for the cleared column (spec 11.1): txn key ->
// R / C / ''. Same id rule as qbo-sync pullCloseData.
export const TXN_LIST_COLUMNS = "tx_date,txn_type,account_name,is_cleared,subt_nat_amount";
export function parseClearedList(report: any): Map<string, string> {
  const iDate = reportColumn(report, "tx_date", "date");
  const iType = reportColumn(report, "txn_type", "transaction type");
  const iClr = reportColumn(report, "is_cleared", "clr", "cleared");
  const out = new Map<string, string>();
  if (iClr < 0) return out;
  walkDataRows(report?.Rows?.Row || [], (cd) => {
    const type = txt(cd[iType]?.value);
    const id = txt(cd[iDate]?.id) || txt(cd[iType]?.id) || txt(cd.find((c: any) => c?.id)?.id);
    if (!type || !id) return;
    out.set(`${type}:${id}`, normCleared(cd[iClr]?.value));
  });
  return out;
}

// ---------------------------------------------------------------------------
// Lines (spec 2.1 table; shape read by GLR_parse.normalizeApiLine)
// ---------------------------------------------------------------------------
export type AcctInfo = { type: string | null; subtype: string | null; classification: string | null };

export type GlLine = {
  key: string; line: string; date: string; type: string; num: string; name: string; name_id: string | null;
  memo: string; split: string; amt: number; bal: number | null; acct_id: string | null; acct: string;
  acct_type: string | null; acct_subtype: string | null; classification: string | null;
  cls: string; loc: string; cleared: string; v1099: boolean | null;
  // 0-based position of the row in the raw input, i.e. Intuit's own report
  // order (qbo-gl-review joins chunks in date order). The line array itself
  // is sorted for stable keys; anything that needs Intuit's order (running
  // balances, e.g. the negative-bank check) should sort by seq.
  seq: number;
};

// Transaction types whose name is a customer or an employee, never a vendor
// (QuickBooks' GeneralLedger txn_type wording). The report's name cell has no
// entity type, so a name only gets the vendor 1099 flag when its id is in the
// vendor map AND the transaction isn't one of these.
const NON_VENDOR_TXN_RX =
  /^(invoice|payment|sales receipt|credit memo|refund( receipt)?|estimate|statement charge|delayed (charge|credit)|paycheck|payroll (check|adjustment|refund)|time (activity|charge))$/i;
export function nameMayBeVendor(txnType: string): boolean {
  return !NON_VENDOR_TXN_RX.test(String(txnType || "").trim());
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// Sorts (Intuit's row order isn't stable), assigns keys and line ids, joins
// account types and the vendor 1099 map (vendor names only, see
// nameMayBeVendor), and records each row's original position as seq. An account missing from `accounts`
// gets acct_type/classification null: the browser then guesses from the name
// (GLR_parse.finishLine), and fingerprint debit totals use the same guess.
export function buildLines(
  raw: RawRow[],
  accounts: Map<string, AcctInfo>,
  vendors: Map<string, boolean | null> | null,
  clearedByKey: Map<string, string> | null = null,
): GlLine[] {
  const seqOf = new Map<RawRow, number>();
  raw.forEach((r, i) => seqOf.set(r, i));
  const rows = raw.slice().sort((a, b) =>
    cmp(a.date, b.date) || cmp(a.type, b.type) || cmp(a.qbo_id || "", b.qbo_id || "") || cmp(a.acct_id || "", b.acct_id || "") ||
    (toCents(a.amt) - toCents(b.amt)) || cmp(a.num, b.num) || cmp(a.name, b.name) || cmp(a.memo, b.memo)
  );
  const synN = new Map<string, number>();
  const lineN = new Map<string, number>();
  return rows.map((r) => {
    let key: string;
    if (r.qbo_id && r.type) key = `${r.type}:${r.qbo_id}`;
    else {
      const base = `syn:${r.date}:${r.type}:${r.num}:${r.acct_id ?? ""}:${toCents(r.amt)}`;
      const n = (synN.get(base) || 0) + 1;
      synN.set(base, n);
      key = `${base}:${n}`;
    }
    const lk = `${key}:${r.acct_id ?? ""}`;
    const k = (lineN.get(lk) || 0) + 1;
    lineN.set(lk, k);
    const info = r.acct_id ? accounts.get(r.acct_id) : undefined;
    const t = normalizeAccountType(info?.type);
    let cleared = r.cleared;
    if (clearedByKey && (t === "Bank" || t === "Credit Card")) cleared = clearedByKey.get(key) ?? "";
    return {
      key,
      line: `${lk}:${k}`,
      date: r.date,
      type: r.type,
      num: r.num,
      name: r.name,
      name_id: r.name_id,
      memo: r.memo,
      split: r.split,
      amt: r.amt,
      bal: r.bal,
      acct_id: r.acct_id,
      acct: r.acct || "(no account)",
      acct_type: t,
      acct_subtype: t ? (info?.subtype || null) : null,
      classification: t ? (info?.classification || classificationOf(t)) : null,
      cls: r.cls,
      loc: r.loc,
      cleared,
      v1099: vendors && r.name_id && vendors.has(r.name_id) && nameMayBeVendor(r.type) ? vendors.get(r.name_id) ?? null : null,
      seq: seqOf.get(r) ?? 0,
    };
  });
}

// ---------------------------------------------------------------------------
// Fingerprints (spec 4.5): the same strings as GLR_fingerprint.js
// ---------------------------------------------------------------------------
const s = (v: unknown) => (v == null ? "" : String(v).replace(/[|\n\r]/g, " "));

type PrintLine = { key: string; acct_id: string | null; date: string; amt: number; cents?: number | null;
  cls?: string | null; loc?: string | null; name_id?: string | null; name?: string | null;
  acct?: string | null; acct_type?: string | null; classification?: string | null };

function centsOf(l: PrintLine): number {
  return l.cents != null ? Math.round(l.cents) : toCents(l.amt);
}

export function lineString(l: PrintLine): string {
  return [s(l.key), s(l.acct_id), s(l.date), String(centsOf(l)), s(l.cls), s(l.loc), s(l.name_id)].join("|");
}

// Classification exactly as the browser ends up with it (GLR_parse.finishLine).
export function effectiveClassification(l: PrintLine): string | null {
  const t = normalizeAccountType(l.acct_type);
  if (t) return l.classification || classificationOf(t);
  return classificationOf(guessAccountType(l.acct || "(no account)").type);
}

export function isDebit(l: PrintLine): boolean {
  const c = centsOf(l);
  const cls = effectiveClassification(l);
  const creditNormal = cls === "Liability" || cls === "Equity" || cls === "Revenue";
  return creditNormal ? c < 0 : c > 0;
}

export async function sha256Hex(str: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  const b = new Uint8Array(buf);
  let out = "";
  for (let i = 0; i < b.length; i++) out += (b[i] < 16 ? "0" : "") + b[i].toString(16);
  return out;
}

export type MonthPrint = {
  period: string; basis: string | null; ym: string; line_count: number;
  debit_total: number; debit_cents: number; credit_cents: number; hash: string;
};

// One print per month in `months` ('YYYY-MM'; default: every month that has
// lines). A listed month with no lines gets the empty print (line_count 0),
// so a month emptied after close still changes.
export async function monthPrints(lines: PrintLine[], basis: string | null, months?: string[]): Promise<MonthPrint[]> {
  const by = new Map<string, PrintLine[]>();
  for (const l of lines || []) {
    if (!l || !l.date) continue;
    const k = String(l.date).slice(0, 7);
    if (!by.has(k)) by.set(k, []);
    by.get(k)!.push(l);
  }
  const list = (months ? [...new Set(months)] : [...by.keys()]).sort();
  const out: MonthPrint[] = [];
  for (const ym of list) {
    const ls = by.get(ym) || [];
    const strs = ls.map(lineString).sort();
    let deb = 0, cred = 0;
    for (const l of ls) {
      const c = Math.abs(centsOf(l));
      if (isDebit(l)) deb += c; else cred += c;
    }
    out.push({
      period: ym + "-01",
      basis: basis ? String(basis) : null,
      ym,
      line_count: ls.length,
      debit_total: deb / 100,
      debit_cents: deb,
      credit_cents: cred,
      hash: await sha256Hex(strs.join("\n")),
    });
  }
  return out;
}

// Closed-month snapshot rows [key, acct_id, date, cents, name], sorted like
// GLR_fingerprint.baselineLines.
export function baselineLines(lines: PrintLine[], ym: string): [string, string | null, string, number, string][] {
  return (lines || [])
    .filter((l) => l && l.date && String(l.date).slice(0, 7) === ym)
    .map((l) => [l.key, l.acct_id == null ? null : String(l.acct_id), l.date, centsOf(l), l.name || ""] as [string, string | null, string, number, string])
    .sort((a, b) => cmp(a.join("|"), b.join("|")));
}
