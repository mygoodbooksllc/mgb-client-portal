import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  ensureFreshToken,
  flagKeysMissing,
  IntuitError as SharedIntuitError,
  QboKeysMissingError,
  TokenStoreError,
} from "../_shared/qbo.ts";

// Pulls a client's books out of QuickBooks into the qbo_* tables
// (supabase/qbo-data.sql), which the browser then reads through RLS and
// maps onto the client shape the pages already consume
// (components/qbo/mapQboToClient.js). This is the thing that turns the
// dashboard from "Prototype · Sample Data" into real numbers.
//
// Two callers, two auth modes:
//
//   (a) pg_cron/pg_net, every 5 minutes (supabase/qbo-usage-guard.sql).
//       Presents the generated cron key — or the project's service_role key —
//       as its bearer token, exactly like qbo-refresh-token does, and syncs
//       every connected client that is due on its plan's schedule (see
//       isDueForPlan: Pro every hour — 2 hours when the Intuit usage guard
//       has throttled — Plus weekly, Basic on the 15th). Skips every client
//       when qbo_usage_status() says the month's calls passed the hard stop.
//       For a Pro client whose last full read is under a day old, a CDC call
//       asks QuickBooks whether anything changed first; nothing changed means
//       no re-read (one Intuit call instead of six).
//   (b) a signed-in person clicking "Sync now" (the header button next to
//       the Live pill, or the Client details QuickBooks tab). Presents their
//       own Supabase JWT and syncs exactly one client:
//         - active staff: the client_id in the body, only if
//           can_access_client() says that client is theirs. A bookkeeper
//           must not be able to make a client they don't manage phone Intuit.
//         - active client user (client_users row, active): only their own
//           org's client_id; any other client_id in the body is refused.
//           Clients on Basic or Plus are refused (Sync now is a Pro feature).
//       Throttled: a connection that synced OK < 60s ago, or has a sync in
//       progress, returns its last synced_at without calling Intuit. Refused
//       (status "error" with a `code`): any attempt on the connection < 60s
//       ago, failed or not (too_soon); 30 attempts a day per client user or
//       200 per staffer (daily_limit, from qbo_manual_sync_attempts); a
//       client user once the Intuit usage guard has hit its hard stop
//       (usage_stopped).
//       Response: { status: "ok" | "fresh" | "in_progress" | "error",
//                   code?, synced_at, error?, synced[], errors[] }.
//       With { action: "balance_sheet_asof", end_date } (staff only) it
//       instead returns one read-only Balance Sheet as of a past month end
//       and syncs nothing; see balanceSheetAsOf.
//
// verify_jwt is off on this function (caller (a) is Postgres, which has no
// Supabase session), so mode (b)'s checks are done by hand below against the
// anon key + the caller's Authorization header — i.e. as the user, under RLS
// — before anything touches the service_role client.
//
// Never logs Intuit response bodies (qbo-callback's rule: a QBO payload is
// customer financial data and Intuit's review prohibits logging it). Status
// codes, counts and intuit_tid only. intuit_tid is captured on every Intuit
// response so a disputed or failed call can be correlated with Intuit
// support without needing the body.
//
// Every Intuit Accounting API call is counted and added to qbo_api_usage
// once per request (qbo_usage_add). OAuth token calls aren't metered by Intuit
// and aren't counted.
//
// Close data (qbo_account_status, qbo_period_balances; supabase/
// qbo-close-checks.sql) is pulled at most once a day per client — the first
// pull is the 13-month backfill — and then close_checks_evaluate() re-scores
// that client's last six months.
//
// Giving by donor for full calendar years (qbo_donor_gifts; supabase/
// qbo-donor-gifts.sql): one GeneralLedger call per year, the current year at
// most once a day or on Sync now, the previous year daily through Feb 15 and
// then only if never pulled. See pullDonorGifts.
//
// Self-contained except for the token refresh: getAccessToken below wraps
// ../_shared/qbo.ts ensureFreshToken, which holds the token_refresh_at lock
// shared with qbo-refresh-token and qbo-gl-review (gl-review-spec 3.2) and is
// covered by tests/edge/qbo_lock.test.mjs. _shared is bundled at deploy, so
// this function picks up changes there only when redeployed. Everything else
// (intuitFetch, report parsing) is still this file's own; qbo-gl-review uses
// copies of those helpers in ../_shared/qbo.ts.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
// The Intuit app keys (QBO_PRODUCTION_* / QBO_SANDBOX_* / legacy
// QBO_CLIENT_ID + QBO_CLIENT_SECRET) and QBO_TOKEN_ENCRYPTION_KEY are read by
// ../_shared/qbo.ts (token refresh), lazily and per connection: each refresh
// uses the keys of that connection's api_env (../_shared/qbo-env.ts). There is
// no global QBO_ENV any more.

// The API host is resolved PER CONNECTION, never from a global. A realm
// authorized under production keys returns 403 against the sandbox host and
// vice versa, so a global default silently breaks every connection made under
// the other set of keys. qbo_connections.api_env records the truth per client, and a
// row that has none yet is resolved by probing both hosts once.
const PROD_BASE = "https://quickbooks.api.intuit.com";
const SANDBOX_BASE = "https://sandbox-quickbooks.api.intuit.com";
const MINOR_VERSION = "75";

function baseForEnv(env: string | null | undefined): string | null {
  if (env === "production") return PROD_BASE;
  if (env === "sandbox") return SANDBOX_BASE;
  return null;
}

// The browser calls this function ("Sync now" via supabase.functions.invoke),
// so it must answer the CORS preflight and tag every reply. Without it the
// preflight got 401 and the app showed "We couldn't reach QuickBooks".
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// Constant-time comparison of two secrets. The length check leaks only the
// length (already implied by the header), then every character is compared so
// a wrong guess can't be narrowed down one byte at a time by timing.
function secretsMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// An Intuit call that came back non-2xx. `status` is carried so a 401
// (token rejected outright) can flip the connection to 'error' while a
// transient 5xx just fails this run.
class IntuitError extends Error {
  status: number;
  tid: string | null;
  constructor(status: number, tid: string | null, what: string) {
    super(`${what} failed (${status})${tid ? ` — intuit_tid: ${tid}` : ""}`);
    this.status = status;
    this.tid = tid;
  }
}

// Both API hosts rejected the very first call. Not an environment question
// any more: the token itself is bad, revoked, or lacks the scope. Carries
// status 401 so it takes the existing "flip the connection to error and let
// the Reconnect UI take over" path, and its own message so the recorded
// qbo_sync_errors detail names both codes.
class IntuitAuthError extends IntuitError {
  constructor(tid: string | null, prodStatus: number, sandboxStatus: number) {
    super(401, tid, "environment probe");
    this.message =
      "QuickBooks rejected the connection — please reconnect " +
      `(production: ${prodStatus}, sandbox: ${sandboxStatus})`;
  }
}

// ---------------------------------------------------------------------------
// Dates. Everything Intuit takes or returns here is a plain calendar date; no
// time zone is ever involved in a P&L period or a due date, so these all work
// in UTC-flavoured YYYY-MM-DD strings and never construct a local Date.
// ---------------------------------------------------------------------------
function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function firstOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
function addMonths(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
}
function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86400000);
}

const MONTH_ABBR: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

// Report column titles for a month-summarized report arrive as "Sep 2025"
// (and occasionally "Sep 2025" with a full month name). Returns the first of
// that month, or null for the Account / Total / blank columns.
function monthTitleToDate(title: string): string | null {
  const m = /^([A-Za-z]{3,9})\s+(\d{4})$/.exec((title || "").trim());
  if (!m) return null;
  const idx = MONTH_ABBR[m[1].slice(0, 3).toLowerCase()];
  if (idx === undefined) return null;
  return isoDay(new Date(Date.UTC(Number(m[2]), idx, 1)));
}

function num(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  let t = String(v ?? "").trim();
  // Accounting negatives: "(1,234.50)" is -1234.50.
  const paren = /^\(.*\)$/.test(t);
  if (paren) t = t.slice(1, -1);
  const n = parseFloat(t.replace(/,/g, ""));
  if (!Number.isFinite(n)) return 0;
  return paren ? -Math.abs(n) : n;
}

// ---------------------------------------------------------------------------
// Intuit HTTP
// ---------------------------------------------------------------------------
// Intuit Accounting API calls made by this isolate since the last flush.
// Read-and-reset in flushUsage(), so overlapping requests never double-count.
let INTUIT_CALLS = 0;

async function flushUsage(admin: any) {
  const n = INTUIT_CALLS;
  INTUIT_CALLS = 0;
  if (n <= 0) return;
  const { error } = await admin.rpc("qbo_usage_add", { p_source: "qbo-sync", p_calls: n });
  if (error) {
    INTUIT_CALLS += n; // try again with the next request
    console.log(`qbo-sync: usage counter update failed: ${error.message}`);
  }
}

async function intuitFetch(
  accessToken: string,
  url: string,
  what: string,
): Promise<any> {
  INTUIT_CALLS++;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });
  const tid = res.headers.get("intuit_tid");
  if (!res.ok) {
    // Body deliberately not read and never logged — see the header comment.
    throw new IntuitError(res.status, tid, what);
  }
  try {
    return await res.json();
  } catch (_e) {
    // The runtime's SyntaxError quotes the start of the body; this message
    // reaches logs and last_error, so it must not carry any of it.
    throw new Error(`${what}: QuickBooks sent a reply that isn't valid JSON`);
  }
}

function queryUrl(base: string, realmId: string, q: string): string {
  return (
    `${base}/v3/company/${realmId}/query` +
    `?query=${encodeURIComponent(q)}&minorversion=${MINOR_VERSION}`
  );
}

function reportUrl(base: string, realmId: string, name: string, params: Record<string, string>): string {
  const qs = new URLSearchParams({ ...params, minorversion: MINOR_VERSION });
  return `${base}/v3/company/${realmId}/reports/${name}?${qs}`;
}

// ---------------------------------------------------------------------------
// Tokens: ../_shared/qbo.ts ensureFreshToken reads (decrypts) them through the
// same SECURITY DEFINER RPCs qbo-callback and qbo-refresh-token use, and
// refreshes in-line, under the token_refresh_at lock, when the access token is
// within 10 minutes of expiring. Intuit ALWAYS rotates the refresh token on
// use; a failure to store the new one is thrown (logged loudly), never ignored.
//
// Errors keep their old shapes for runSync's catch: Intuit refusing the
// refresh is this file's IntuitError(401) (flip to 'error', Reconnect UI);
// the lock held through every wait is a plain error (last_error only, the
// connection stays 'connected'); this connection's environment having no keys
// configured is QboKeysMissingError (secret names only; last_error only,
// nothing sent to Intuit).
//
// apiEnv: the connection's qbo_connections.api_env, which picks the Intuit
// app keys for a refresh (NULL = a legacy row = sandbox/legacy keys).
// ---------------------------------------------------------------------------
async function getAccessToken(admin: any, clientId: string, apiEnv: string | null): Promise<string> {
  try {
    return (await ensureFreshToken(admin, clientId, { logTag: "qbo-sync", apiEnv })).accessToken;
  } catch (e) {
    if (e instanceof SharedIntuitError) {
      const local = new IntuitError(e.status, e.tid, "token refresh");
      local.message = e.message;
      throw local;
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Report parsing
//
// A QuickBooks report is a tree: Rows.Row[] where each entry is either a
// Section (Header + nested Rows + Summary, tagged with `group` for the
// well-known ones — Income, Expenses, COGS, NetIncome…) or a Data row
// (ColData[] positionally aligned with Columns.Column[]).
//
// Column positions are NOT stable across companies or report types — a
// company with no classes gets a different column set — so every parser
// below indexes by resolved column, never by a hardcoded position.
// ---------------------------------------------------------------------------

interface MonthCol {
  index: number;
  month: string; // YYYY-MM-01
}

function monthColumns(report: any): MonthCol[] {
  const cols = report?.Columns?.Column || [];
  const out: MonthCol[] = [];
  cols.forEach((c: any, i: number) => {
    const month = monthTitleToDate(c?.ColTitle || "");
    if (month) out.push({ index: i, month });
  });
  return out;
}

// Which P&L section a leaf row belongs to, normalized to the two buckets the
// dashboard cares about. COGS is folded into expenses: to a church or a
// nonprofit treasurer "what did we spend" means cost of goods too, and the
// monthly chart has exactly two series.
function sectionKind(group: string | undefined, header: string): "income" | "expense" | null {
  const g = (group || "").toLowerCase();
  if (g === "income" || g === "otherincome") return "income";
  if (g === "expenses" || g === "cogs" || g === "otherexpenses") return "expense";
  const h = (header || "").toLowerCase();
  if (h.includes("income") && !h.includes("net")) return "income";
  if (h.includes("expense") || h.includes("cost of goods")) return "expense";
  return null;
}

interface ParsedPL {
  monthly: Map<string, { revenue: number; expenses: number }>;
  lines: Map<string, { client_id?: string; month: string; account_name: string; account_type: string; amount: number }>;
}

function parseProfitAndLoss(report: any): ParsedPL {
  const months = monthColumns(report);
  const monthly = new Map<string, { revenue: number; expenses: number }>();
  const lines = new Map<string, any>();
  for (const mc of months) monthly.set(mc.month, { revenue: 0, expenses: 0 });

  // Keyed by section as well as name: a company can have an income and an
  // expense sub-account with the same short name, and merging them moved the
  // expense into income (qbo_pl_lines is keyed the same way since
  // supabase/qbo-pl-lines-by-type.sql).
  function addLine(month: string, accountName: string, kind: "income" | "expense", amount: number) {
    const key = `${kind}|${month}|${accountName}`;
    const prev = lines.get(key);
    if (prev) {
      prev.amount += amount;
    } else {
      lines.set(key, {
        month,
        account_name: accountName,
        account_type: kind === "income" ? "Income" : "Expense",
        amount,
      });
    }
  }

  // Walk depth-first. `kind` is inherited from the nearest enclosing
  // Income/Expenses section; a Section's own Summary row is skipped for the
  // line detail (it would double-count its children) but IS what the monthly
  // totals are taken from, at the top level only.
  //
  // Returns what the walked rows add up to per month column, so a section can
  // compare its Summary with its children. A parent account with sub-accounts
  // is a Section whose Summary ("Total Maintenance and Repair") includes money
  // posted straight to the parent; Intuit carries that amount on the Header
  // row, not as a Data row, so it used to be lost (qbo_pl_lines summed short
  // of qbo_monthly_pl). The difference Summary - children is booked as a line
  // under the parent's own name, which makes the lines add up to the totals.
  function walkRows(rows: any[], kind: "income" | "expense" | null, depth: number): number[] {
    const totals = months.map(() => 0);
    for (const row of rows || []) {
      const headerName = (row?.Header?.ColData?.[0]?.value || "").trim();
      const ownKind = sectionKind(row?.group, headerName) ?? kind;

      if (row?.Rows?.Row || row?.Summary?.ColData) {
        const childTotals = walkRows(row?.Rows?.Row || [], ownKind, depth + 1);
        months.forEach((mc, i) => {
          const summary = row?.Summary?.ColData ? num(row.Summary.ColData[mc.index]?.value) : childTotals[i];
          const residual = Math.round((summary - childTotals[i]) * 100) / 100;
          // Only account sections (depth > 0) get a residual line; a stray
          // difference on a top-level "Income"/"Expenses" section has no
          // account to belong to.
          if (residual && ownKind && headerName && depth > 0) {
            addLine(mc.month, headerName, ownKind, residual);
          }
          totals[i] += summary;
        });
        // Top-level section totals feed qbo_monthly_pl. Nested subsection
        // summaries are already included in their parent's, so only depth 0
        // contributes.
        if (depth === 0 && row?.Rows?.Row && row?.Summary?.ColData && ownKind) {
          for (const mc of months) {
            const v = num(row.Summary.ColData[mc.index]?.value);
            const bucket = monthly.get(mc.month)!;
            if (ownKind === "income") bucket.revenue += v;
            else bucket.expenses += v;
          }
        }
        continue;
      }

      // Leaf data row: one account, one amount per month column.
      const cd = row?.ColData;
      if (!cd || !cd.length) continue;
      const accountName = (cd[0]?.value || "").trim();
      months.forEach((mc, i) => {
        const amount = num(cd[mc.index]?.value);
        totals[i] += amount;
        if (!amount || !accountName || !ownKind) return; // no zero rows
        addLine(mc.month, accountName, ownKind, amount);
      });
    }
    return totals;
  }

  walkRows(report?.Rows?.Row || [], null, 0);

  // Fallback: a company whose P&L has no recognizable top-level Income /
  // Expenses sections (rare, but Intuit's grouping is not contractual) would
  // otherwise report zero revenue and zero expenses while the line detail is
  // perfectly good. Derive the totals from the lines instead.
  let anyTotals = false;
  for (const v of monthly.values()) if (v.revenue || v.expenses) anyTotals = true;
  if (!anyTotals && lines.size) {
    for (const l of lines.values()) {
      const bucket = monthly.get(l.month) || { revenue: 0, expenses: 0 };
      if (l.account_type === "Income") bucket.revenue += l.amount;
      else bucket.expenses += l.amount;
      monthly.set(l.month, bucket);
    }
  }

  return { monthly, lines };
}

// TransactionList's columns genuinely vary by company and by the options
// Intuit decides to include, so resolve every one of them by ColTitle.
function parseTransactionList(report: any): any[] {
  const cols = (report?.Columns?.Column || []).map((c: any) =>
    String(c?.ColTitle || "").trim().toLowerCase(),
  );
  const find = (...names: string[]) => {
    for (const n of names) {
      const i = cols.indexOf(n);
      if (i !== -1) return i;
    }
    // Loose second pass — "Memo/Description" vs "Memo", "Transaction Type"
    // vs "Type", and so on.
    for (const n of names) {
      const i = cols.findIndex((c: string) => c.includes(n));
      if (i !== -1) return i;
    }
    return -1;
  };
  const iDate = find("date", "txn date");
  const iType = find("transaction type", "type");
  const iName = find("name", "customer", "vendor", "payee");
  const iMemo = find("memo/description", "memo", "description");
  const iAcct = find("account", "split");
  // The posting ("split") account, used as the transaction's category. Only
  // when it's a separate column from the register account above.
  const iSplitRaw = find("split");
  const iSplit = iSplitRaw !== iAcct ? iSplitRaw : -1;
  const iAmt = find("amount", "total");

  const out: any[] = [];
  const seen = new Set<string>();

  function walk(rows: any[]) {
    for (const row of rows || []) {
      if (row?.Rows?.Row) {
        walk(row.Rows.Row);
        continue;
      }
      const cd = row?.ColData;
      if (!cd || !cd.length) continue;
      const txnDate = iDate >= 0 ? (cd[iDate]?.value || "").slice(0, 10) : "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(txnDate)) continue; // skip summary rows
      const txnType = (iType >= 0 ? cd[iType]?.value : "") || "Transaction";
      // Intuit hangs the entity id off whichever cell links to the
      // transaction — usually the date or the type cell.
      const qboId =
        (iDate >= 0 && cd[iDate]?.id) ||
        (iType >= 0 && cd[iType]?.id) ||
        cd.find((c: any) => c?.id)?.id ||
        "";
      // No id at all (some report rows genuinely have none) — synthesize a
      // stable one from the row's own content so the primary key holds and a
      // re-sync produces the same key rather than duplicating.
      let key = String(qboId || "");
      if (!key) {
        key = `syn-${txnDate}-${(iAmt >= 0 ? cd[iAmt]?.value : "") || ""}-${
          (iName >= 0 ? cd[iName]?.value : "") || ""
        }`.replace(/\s+/g, "_").slice(0, 120);
      }
      const dedupe = `${txnType}|${key}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      out.push({
        qbo_id: key,
        txn_type: txnType,
        txn_date: txnDate,
        account_name: (iAcct >= 0 ? cd[iAcct]?.value : "") || null,
        split_account: (iSplit >= 0 ? cd[iSplit]?.value : "") || null,
        name: (iName >= 0 ? cd[iName]?.value : "") || null,
        memo: (iMemo >= 0 ? cd[iMemo]?.value : "") || null,
        amount: iAmt >= 0 ? num(cd[iAmt]?.value) : 0,
      });
    }
  }
  walk(report?.Rows?.Row || []);
  return out;
}

// ---------------------------------------------------------------------------
// Writes. Replace per client per table: QuickBooks is the system of record,
// so a row that no longer exists there must not survive here, and diffing ids
// to find deletions is more machinery than re-materializing a few hundred
// rows. The delete and insert run in ONE transaction inside
// qbo_replace_rows() (supabase/qbo-replace-rows.sql), so a reader mid-sync
// sees the previous rows, never an empty table.
// ---------------------------------------------------------------------------
async function replaceRows(admin: any, table: string, clientId: string, rows: any[]) {
  const { data, error } = await admin.rpc("qbo_replace_rows", {
    p_table: table,
    p_client_id: clientId,
    p_rows: rows,
  });
  if (error) throw new Error(`${table}: ${error.message}`);
  return typeof data === "number" ? data : rows.length;
}

// ---------------------------------------------------------------------------
// Change data capture. One call answers "did anything change since X?" for
// every entity that feeds the P&L, A/R, A/P, the register or the chart of
// accounts. Budget isn't a CDC entity; the daily full read picks it up.
// Intuit only looks back 30 days.
// ---------------------------------------------------------------------------
const CDC_ENTITIES = [
  "Account", "Bill", "BillPayment", "CreditMemo", "Customer", "Deposit",
  "Invoice", "JournalEntry", "Payment", "Purchase", "PurchaseOrder",
  "RefundReceipt", "SalesReceipt", "Transfer", "Vendor", "VendorCredit",
].join(",");
const CDC_MAX_AGE_MS = 29 * 24 * 60 * 60 * 1000;
// Re-read everything at least this often even when CDC reports no changes
// (budgets, report-only effects, and the rolling P&L window).
const FULL_SYNC_MAX_AGE_MS = 24 * 60 * 60 * 1000;
// Overlap on changedSince, so a change made while the previous sync was
// running is never missed.
const CDC_OVERLAP_MS = 5 * 60 * 1000;

function intuitTimestamp(d: Date): string {
  return d.toISOString().slice(0, 19) + "+00:00";
}

async function cdcChangeCount(
  accessToken: string,
  base: string,
  realmId: string,
  since: Date,
): Promise<number> {
  const url =
    `${base}/v3/company/${realmId}/cdc?entities=${CDC_ENTITIES}` +
    `&changedSince=${encodeURIComponent(intuitTimestamp(since))}&minorversion=${MINOR_VERSION}`;
  const res = await intuitFetch(accessToken, url, "CDC");
  let n = 0;
  for (const cdc of res?.CDCResponse || []) {
    for (const qr of cdc?.QueryResponse || []) {
      for (const [k, v] of Object.entries(qr || {})) {
        if (k === "startPosition" || k === "maxResults" || k === "totalCount") continue;
        if (Array.isArray(v)) n += v.length;
      }
    }
  }
  return n;
}

// ---------------------------------------------------------------------------
// Close data (supabase/qbo-close-checks.sql). QuickBooks exposes no bank-feed
// status and no reconciliation history, so both are proxied from reports:
//   - last transaction per bank / card account, and whether each transaction
//     is reconciled, from a 13-month TransactionList with the "cleared"
//     column;
//   - month-end balances (Undeposited Funds above all) from a BalanceSheet
//     summarized by month;
//   - transactions sitting in Uncategorized / Ask My Accountant accounts per
//     month from a GeneralLedger restricted to those accounts.
// At most 3 Intuit calls, once a day per client.
// ---------------------------------------------------------------------------
const CLOSE_SYNC_MAX_AGE_MS = 24 * 60 * 60 * 1000 - 10 * 60 * 1000;
const CLOSE_MONTHS = 13;

type CloseKind = "bank" | "credit_card" | "undeposited" | "uncategorized";

function closeKind(a: any): CloseKind | null {
  const name = String(a?.name || "");
  if (a?.account_sub_type === "UndepositedFunds" || /^undeposited funds/i.test(name)) return "undeposited";
  if (a?.account_type === "Bank") return "bank";
  if (a?.account_type === "Credit Card") return "credit_card";
  if (/uncategori[sz]ed|ask my accountant/i.test(name)) return "uncategorized";
  return null;
}

// Column index by MetaData ColKey (stable), falling back to a title match.
function reportColumn(report: any, key: string, ...titles: string[]): number {
  const cols = report?.Columns?.Column || [];
  for (let i = 0; i < cols.length; i++) {
    for (const m of cols[i]?.MetaData || []) {
      if (m?.Name === "ColKey" && m?.Value === key) return i;
    }
  }
  for (let i = 0; i < cols.length; i++) {
    const t = String(cols[i]?.ColTitle || "").trim().toLowerCase();
    if (titles.includes(t)) return i;
  }
  return -1;
}

function walkDataRows(rows: any[], fn: (cd: any[], section: any | null) => void, section: any = null) {
  for (const row of rows || []) {
    if (row?.Rows?.Row) {
      walkDataRows(row.Rows.Row, fn, row?.Header?.ColData?.[0] ? row.Header.ColData[0] : section);
      continue;
    }
    if (row?.ColData?.length) fn(row.ColData, section);
  }
}

function monthOf(isoDate: string): string {
  return isoDate.slice(0, 8) + "01";
}
function monthEnd(month: string): string {
  const d = new Date(month + "T00:00:00Z");
  return isoDay(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
}

async function pullCloseData(
  admin: any,
  accessToken: string,
  base: string,
  realmId: string,
  clientId: string,
  accounts: any[],
): Promise<Record<string, number>> {
  const today = new Date();
  const start = isoDay(addMonths(firstOfMonth(today), -(CLOSE_MONTHS - 1)));
  const end = isoDay(today);
  const months: string[] = [];
  for (let i = CLOSE_MONTHS - 1; i >= 0; i--) months.push(isoDay(addMonths(firstOfMonth(today), -i)));

  const tracked = new Map<string, { a: any; kind: CloseKind }>();
  const idByName = new Map<string, string>();
  for (const a of accounts) {
    const kind = closeKind(a);
    if (!kind) continue;
    tracked.set(String(a.qbo_id), { a, kind });
    idByName.set(String(a.name || "").trim().toLowerCase(), String(a.qbo_id));
  }
  const counts: Record<string, number> = {};
  if (!tracked.size) {
    counts.close_accounts = await replaceRows(admin, "qbo_account_status", clientId, []);
    await replaceRows(admin, "qbo_period_balances", clientId, []);
    return counts;
  }
  const resolve = (cell: any): string | null => {
    if (cell?.id && tracked.has(String(cell.id))) return String(cell.id);
    const byName = idByName.get(String(cell?.value || "").trim().toLowerCase());
    if (byName) return byName;
    // Sub-accounts show as "Parent:Child" in some reports.
    const leaf = String(cell?.value || "").split(":").pop()!.trim().toLowerCase();
    return idByName.get(leaf) || null;
  };

  // Per account: activity per month, last transaction, reconciliation.
  const txnCount = new Map<string, Map<string, number>>();
  const lastTxn = new Map<string, string>();
  const lastRecon = new Map<string, string>();
  const unreconDates = new Map<string, string[]>();
  const bump = (id: string, d: string) => {
    const m = txnCount.get(id) || new Map<string, number>();
    m.set(monthOf(d), (m.get(monthOf(d)) || 0) + 1);
    txnCount.set(id, m);
    if (!lastTxn.has(id) || lastTxn.get(id)! < d) lastTxn.set(id, d);
  };

  // 1. TransactionList with the cleared column.
  const tl = await intuitFetch(
    accessToken,
    reportUrl(base, realmId, "TransactionList", {
      start_date: start,
      end_date: end,
      columns: "tx_date,txn_type,account_name,other_account,is_cleared,subt_nat_amount",
    }),
    "TransactionList (close) report",
  );
  const iDate = reportColumn(tl, "tx_date", "date");
  const iAcct = reportColumn(tl, "account_name", "account");
  const iOther = reportColumn(tl, "other_account", "split");
  const iClr = reportColumn(tl, "is_cleared", "clr", "cleared");
  const clearedKnown = iClr >= 0;
  walkDataRows(tl?.Rows?.Row || [], (cd) => {
    const d = iDate >= 0 ? String(cd[iDate]?.value || "").slice(0, 10) : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
    const acct = iAcct >= 0 ? resolve(cd[iAcct]) : null;
    const other = iOther >= 0 ? resolve(cd[iOther]) : null;
    for (const id of [acct, other]) {
      if (!id) continue;
      const k = tracked.get(id)!.kind;
      if (k === "bank" || k === "credit_card") bump(id, d);
    }
    // The cleared flag belongs to the row's own account side.
    if (acct && clearedKnown) {
      const k = tracked.get(acct)!.kind;
      if (k === "bank" || k === "credit_card") {
        const c = String(cd[iClr]?.value || "").trim();
        if (/^r/i.test(c)) {
          if (!lastRecon.has(acct) || lastRecon.get(acct)! < d) lastRecon.set(acct, d);
        } else {
          const list = unreconDates.get(acct) || [];
          list.push(d);
          unreconDates.set(acct, list);
        }
      }
    }
  });

  // 2. GeneralLedger for uncategorized accounts: every line currently sitting
  // in one of them, by month.
  const uncatIds = [...tracked.entries()].filter(([, t]) => t.kind === "uncategorized").map(([id]) => id);
  if (uncatIds.length) {
    const gl = await intuitFetch(
      accessToken,
      reportUrl(base, realmId, "GeneralLedger", {
        start_date: start,
        end_date: end,
        account: uncatIds.join(","),
        columns: "tx_date,txn_type,subt_nat_amount",
      }),
      "GeneralLedger report",
    );
    const gDate = reportColumn(gl, "tx_date", "date");
    walkDataRows(gl?.Rows?.Row || [], (cd, section) => {
      const d = gDate >= 0 ? String(cd[gDate]?.value || "").slice(0, 10) : "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
      const id = section ? resolve(section) : null;
      if (!id || tracked.get(id)!.kind !== "uncategorized") return;
      bump(id, d);
    });
  }

  // 3. BalanceSheet by month: month-end balances.
  const balances = new Map<string, Map<string, number>>();
  const bs = await intuitFetch(
    accessToken,
    reportUrl(base, realmId, "BalanceSheet", {
      start_date: start,
      end_date: end,
      summarize_column_by: "Month",
    }),
    "BalanceSheet report",
  );
  const bsMonths = monthColumns(bs);
  const takeBalances = (cell: any, cd: any[]) => {
    const id = resolve(cell);
    if (!id) return;
    const m = balances.get(id) || new Map<string, number>();
    for (const mc of bsMonths) {
      const raw = cd[mc.index]?.value;
      if (raw === undefined || raw === null || raw === "") continue;
      m.set(mc.month, (m.get(mc.month) || 0) + num(raw));
    }
    balances.set(id, m);
  };
  (function walkBs(rows: any[]) {
    for (const row of rows || []) {
      if (row?.Rows?.Row) {
        // A parent account with sub-accounts: its Summary is the total.
        const h = row?.Header?.ColData?.[0];
        if (h?.id && tracked.has(String(h.id)) && row?.Summary?.ColData) {
          takeBalances(h, row.Summary.ColData);
          continue;
        }
        walkBs(row.Rows.Row);
        continue;
      }
      if (row?.ColData?.[0]?.id) takeBalances(row.ColData[0], row.ColData);
    }
  })(bs?.Rows?.Row || []);

  // Rows.
  const nowIso = new Date().toISOString();
  const statusRows: any[] = [];
  const periodRows: any[] = [];
  for (const [id, { a, kind }] of tracked) {
    const isBank = kind === "bank" || kind === "credit_card";
    const unrecon = (unreconDates.get(id) || []).sort();
    statusRows.push({
      client_id: clientId,
      qbo_id: id,
      name: a.name ?? null,
      kind,
      account_type: a.account_type ?? null,
      account_sub_type: a.account_sub_type ?? null,
      current_balance: a.current_balance ?? null,
      last_txn_date: lastTxn.get(id) ?? null,
      last_reconciled_date: isBank ? lastRecon.get(id) ?? null : null,
      unreconciled_count: isBank && clearedKnown ? unrecon.length : null,
      oldest_unreconciled_date: isBank && clearedKnown ? unrecon[0] ?? null : null,
      updated_at: nowIso,
    });
    for (const month of months) {
      const bal = balances.get(id)?.get(month);
      const through = monthEnd(month);
      periodRows.push({
        client_id: clientId,
        month,
        account_qbo_id: id,
        account_name: a.name ?? null,
        kind,
        balance_end: bal === undefined ? null : bal,
        txn_count: txnCount.get(id)?.get(month) || 0,
        unreconciled_through: isBank && clearedKnown ? unrecon.filter((d) => d <= through).length : null,
        updated_at: nowIso,
      });
    }
  }
  counts.close_accounts = await replaceRows(admin, "qbo_account_status", clientId, statusRows);
  counts.close_periods = await replaceRows(admin, "qbo_period_balances", clientId, periodRows);
  return counts;
}

// ---------------------------------------------------------------------------
// Giving by donor for a whole calendar year (supabase/qbo-donor-gifts.sql),
// for year-end giving statements on the Pro Giving & Funds Tax Documents view.
//
// ONE Intuit call per year: a GeneralLedger report for Jan 1 - Dec 31,
// restricted (`account`) to the client's Income / Other Income accounts, with
// the date, type, number, name, memo and amount columns. GeneralLedger is used
// rather than TransactionList because TransactionList has no account filter,
// so it would return the whole register. The name column is the customer /
// payer (the donor); rows are grouped under an account section header, which
// gives the fund / giving account. Every income account is stored and the
// browser keeps the giving ones (client.givingQbo.accounts), so a change to
// the giving-account pick needs no new call.
//
// Schedule (donorYearsDue): the current year at most once a day, or on Sync
// now; the previous year once a day through Feb 15 (US Central), afterwards
// only if it was never pulled. Read-only.
// ---------------------------------------------------------------------------
const DONOR_PULL_MAX_AGE_MS = 24 * 60 * 60 * 1000 - 10 * 60 * 1000;
const INCOME_ACCOUNT_TYPES = new Set(["Income", "Other Income"]);

function donorYearsDue(
  pulls: Map<number, string>,
  now: Date,
  forceCurrent: boolean,
): number[] {
  const today = centralDate(now); // YYYY-MM-DD
  const year = Number(today.slice(0, 4));
  const stale = (y: number) => {
    const at = pulls.get(y);
    return !at || now.getTime() - new Date(at).getTime() >= DONOR_PULL_MAX_AGE_MS;
  };
  const due: number[] = [];
  if (forceCurrent || stale(year)) due.push(year);
  const prev = year - 1;
  const inJanFeb = today.slice(5) <= "02-15";
  if (!pulls.has(prev) || (inJanFeb && stale(prev))) due.push(prev);
  return due;
}

// null = status unreadable (table missing etc.): pull nothing this run rather
// than every year on every run.
async function donorPullsFor(admin: any, clientIds: string[]): Promise<Map<string, Map<number, string>> | null> {
  const out = new Map<string, Map<number, string>>();
  if (!clientIds.length) return out;
  const { data, error } = await admin
    .from("qbo_donor_gift_pulls")
    .select("client_id, year, pulled_at")
    .in("client_id", clientIds);
  if (error) {
    console.log(`qbo-sync: donor pull status unavailable: ${error.message}`);
    return null;
  }
  for (const r of data || []) {
    const m = out.get(r.client_id) || new Map<number, string>();
    m.set(Number(r.year), r.pulled_at);
    out.set(r.client_id, m);
  }
  return out;
}

async function pullDonorGifts(
  admin: any,
  accessToken: string,
  base: string,
  realmId: string,
  clientId: string,
  year: number,
  accounts: any[],
): Promise<number> {
  const income = accounts.filter((a) => INCOME_ACCOUNT_TYPES.has(String(a?.account_type || "")));
  if (!income.length) {
    return await replaceDonorGifts(admin, clientId, year, []);
  }
  const nameById = new Map<string, string>();
  const idByName = new Map<string, string>();
  for (const a of income) {
    nameById.set(String(a.qbo_id), String(a.name || ""));
    idByName.set(String(a.name || "").trim().toLowerCase(), String(a.qbo_id));
  }
  const resolve = (cell: any): string | null => {
    if (cell?.id && nameById.has(String(cell.id))) return String(cell.id);
    const leaf = String(cell?.value || "").split(":").pop()!.trim().toLowerCase();
    return idByName.get(leaf) || null;
  };

  const today = isoDay(new Date());
  const start = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  const end = yearEnd < today ? yearEnd : today;
  const gl = await intuitFetch(
    accessToken,
    reportUrl(base, realmId, "GeneralLedger", {
      start_date: start,
      end_date: end,
      account: [...nameById.keys()].join(","),
      columns: "tx_date,txn_type,doc_num,name,memo,account_name,subt_nat_amount",
    }),
    "GeneralLedger (giving) report",
  );
  const iDate = reportColumn(gl, "tx_date", "date");
  const iType = reportColumn(gl, "txn_type", "transaction type");
  const iNum = reportColumn(gl, "doc_num", "num", "no.");
  const iName = reportColumn(gl, "name", "name");
  const iMemo = reportColumn(gl, "memo", "memo/description");
  const iAcct = reportColumn(gl, "account_name", "account");
  const iAmt = reportColumn(gl, "subt_nat_amount", "amount");

  const rows = new Map<string, any>();
  walkDataRows(gl?.Rows?.Row || [], (cd, section) => {
    const d = iDate >= 0 ? String(cd[iDate]?.value || "").slice(0, 10) : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d.slice(0, 4) !== String(year)) return;
    const acctId = (section ? resolve(section) : null) || (iAcct >= 0 ? resolve(cd[iAcct]) : null);
    if (!acctId) return;
    const amount = iAmt >= 0 ? num(cd[iAmt]?.value) : 0;
    if (!amount) return;
    const txnType = (iType >= 0 ? String(cd[iType]?.value || "") : "") || "Transaction";
    const txnId =
      (iDate >= 0 && cd[iDate]?.id) || (iType >= 0 && cd[iType]?.id) || "";
    const nameCell = iName >= 0 ? cd[iName] : null;
    const donor = String(nameCell?.value || "").trim();
    const docNum = iNum >= 0 ? String(cd[iNum]?.value || "").trim() : "";
    const memo = iMemo >= 0 ? String(cd[iMemo]?.value || "").trim() : "";
    // One gift = one transaction x account x donor (a deposit can carry lines
    // from several payers; two lines of one sales receipt to the same account
    // are one gift).
    const key = (
      txnId
        ? `${txnType}|${txnId}|${acctId}|${donor}`
        : `syn|${d}|${txnType}|${docNum}|${acctId}|${donor}|${memo}|${rows.size}`
    ).slice(0, 300);
    const prev = rows.get(key);
    if (prev) {
      prev.amount = Math.round((prev.amount + amount) * 100) / 100;
      if (!prev.memo && memo) prev.memo = memo;
      return;
    }
    rows.set(key, {
      client_id: clientId,
      year,
      line_key: key,
      txn_date: d,
      donor_name: donor || null,
      donor_qbo_id: nameCell?.id ? String(nameCell.id) : null,
      amount: Math.round(amount * 100) / 100,
      account_name: nameById.get(acctId) || null,
      account_qbo_id: acctId,
      txn_type: txnType,
      txn_qbo_id: txnId ? String(txnId) : null,
      doc_number: docNum || null,
      memo: memo || null,
    });
  });
  const list = [...rows.values()].filter((r) => r.amount !== 0);
  return await replaceDonorGifts(admin, clientId, year, list);
}

async function replaceDonorGifts(admin: any, clientId: string, year: number, rows: any[]): Promise<number> {
  const { data, error } = await admin.rpc("qbo_replace_donor_gifts", {
    p_client_id: clientId,
    p_year: year,
    p_rows: rows,
  });
  if (error) throw new Error(`qbo_donor_gifts: ${error.message}`);
  return typeof data === "number" ? data : rows.length;
}

// ---------------------------------------------------------------------------
// One client, end to end.
// ---------------------------------------------------------------------------
async function syncClient(
  admin: any,
  clientId: string,
  realmId: string,
  apiEnv: string | null,
  opts: { cdcSince?: Date | null; closeDue?: boolean; donorYears?: number[] } = {},
) {
  const startedAt = new Date().toISOString();
  const counts: Record<string, number> = {};

  try {
    if (!realmId) throw new Error("connection has no realm_id — reconnect QuickBooks");
    const accessToken = await getAccessToken(admin, clientId, apiEnv);

    const today = new Date();
    const plStart = isoDay(addMonths(firstOfMonth(today), -11));
    const plEnd = isoDay(today);
    const txStart = isoDay(addDays(today, -90));

    // --- Change gate (scheduled Pro runs only) -----------------------------
    // One CDC call instead of six reads when nothing has changed since the
    // last sync. Any CDC failure other than a rejected token falls back to
    // the full read.
    const knownBase = baseForEnv(apiEnv);
    let base: string = knownBase || PROD_BASE;
    let skipFull = false;
    if (opts.cdcSince && knownBase) {
      try {
        const changes = await cdcChangeCount(accessToken, knownBase, realmId, opts.cdcSince);
        counts.cdc_changes = changes;
        if (changes === 0) skipFull = true;
      } catch (e) {
        if (e instanceof IntuitError && e.status === 401) throw e;
        console.log(`qbo-sync: CDC check failed for client ${clientId}, doing a full read: ${(e as Error).message}`);
      }
    }
    counts.full = skipFull ? 0 : 1;

    let accountRows: any[] = [];
    if (!skipFull) {
      // --- Chart of accounts -------------------------------------------------
      // Also where the API environment gets settled. If the connection already
      // knows which host it belongs to, use it. If it doesn't — every connection
      // made before api_env existed — probe with this same first call: production
      // first, then sandbox, and whichever answers 2xx is the host for the whole
      // rest of this sync and is written back so no later run has to probe again.
      const ACCOUNTS_QUERY = "select * from Account where Active = true maxresults 1000";
      let accountsRes: any;

      if (knownBase) {
        base = knownBase;
        accountsRes = await intuitFetch(
          accessToken,
          queryUrl(base, realmId, ACCOUNTS_QUERY),
          "Account query",
        );
      } else {
        let prodErr: IntuitError;
        try {
          accountsRes = await intuitFetch(
            accessToken,
            queryUrl(PROD_BASE, realmId, ACCOUNTS_QUERY),
            "Account query",
          );
          base = PROD_BASE;
        } catch (e) {
          if (!(e instanceof IntuitError)) throw e;
          prodErr = e;
          try {
            accountsRes = await intuitFetch(
              accessToken,
              queryUrl(SANDBOX_BASE, realmId, ACCOUNTS_QUERY),
              "Account query",
            );
            base = SANDBOX_BASE;
          } catch (e2) {
            if (!(e2 instanceof IntuitError)) throw e2;
            const authish = (st: number) => st === 401 || st === 403;
            // Rejected by both: the token is the problem, not the host. A pair
            // of transient 5xx/429s is a different story — rethrow the
            // production failure so this run just fails and retries.
            if (authish(prodErr.status) && authish(e2.status)) {
              throw new IntuitAuthError(e2.tid ?? prodErr.tid, prodErr.status, e2.status);
            }
            throw prodErr;
          }
        }
        const resolvedEnv = base === PROD_BASE ? "production" : "sandbox";
        await admin
          .from("qbo_connections")
          .update({ api_env: resolvedEnv, updated_at: new Date().toISOString() })
          .eq("client_id", clientId);
        console.log(`qbo-sync: client ${clientId} resolved api_env = ${resolvedEnv}`);
      }
      accountRows = (accountsRes?.QueryResponse?.Account || []).map((a: any) => ({
        client_id: clientId,
        qbo_id: String(a.Id),
        name: a.Name ?? null,
        account_type: a.AccountType ?? null,
        account_sub_type: a.AccountSubType ?? null,
        classification: a.Classification ?? null,
        current_balance: a.CurrentBalance ?? null,
        currency: a.CurrencyRef?.value ?? null,
        active: a.Active ?? true,
        updated_at: new Date().toISOString(),
      }));
      counts.accounts = await replaceRows(admin, "qbo_accounts", clientId, accountRows);

      // --- P&L, summarized by month -----------------------------------------
      const plReport = await intuitFetch(
        accessToken,
        reportUrl(base, realmId, "ProfitAndLoss", {
          start_date: plStart,
          end_date: plEnd,
          summarize_column_by: "Month",
        }),
        "ProfitAndLoss report",
      );
      const pl = parseProfitAndLoss(plReport);

      const monthlyRows = [...pl.monthly.entries()].map(([month, v]) => ({
        client_id: clientId,
        month,
        revenue: v.revenue,
        expenses: v.expenses,
        net: v.revenue - v.expenses,
        updated_at: new Date().toISOString(),
      }));
      monthlyRows.sort((a, b) => (a.month < b.month ? -1 : 1));
      counts.monthly_pl = await replaceRows(admin, "qbo_monthly_pl", clientId, monthlyRows);

      const plLineRows = [...pl.lines.values()].map((l) => ({
        client_id: clientId,
        month: l.month,
        account_name: l.account_name,
        account_type: l.account_type,
        amount: l.amount,
      }));
      counts.pl_lines = await replaceRows(admin, "qbo_pl_lines", clientId, plLineRows);

      // --- Budgets -----------------------------------------------------------
      // Intuit's Budget entity carries no actuals, so `actual` is joined in
      // here from the P&L lines for the same month + account. A budgeted
      // account with no P&L activity that month is a real 0, not a null.
      // A budget line names an account, not a section; when an income and an
      // expense account share a name, the expense side wins (budgets are
      // overwhelmingly about spending).
      const actualByKey = new Map<string, number>();
      for (const l of pl.lines.values()) {
        const k = `${l.month}|${l.account_name}`;
        if (l.account_type === "Expense" || !actualByKey.has(k)) actualByKey.set(k, l.amount);
      }
      let budgetRows: any[] = [];
      try {
        const budgetRes = await intuitFetch(
          accessToken,
          queryUrl(base, realmId, "select * from Budget"),
          "Budget query",
        );
        const seenBudget = new Set<string>();
        for (const b of budgetRes?.QueryResponse?.Budget || []) {
          if (b.Active === false) continue;
          const fiscalYear = b.StartDate ? Number(String(b.StartDate).slice(0, 4)) : null;
          for (const d of b.BudgetDetail || []) {
            const month = d.BudgetDate ? String(d.BudgetDate).slice(0, 8) + "01" : null;
            const accountName = d.AccountRef?.name || d.AccountRef?.value;
            if (!month || !accountName) continue;
            // qbo_budget_lines is keyed (client_id, month, account_name), so
            // two overlapping budgets covering the same month+account collapse
            // — sum them rather than losing one to a PK violation.
            const key = `${month}|${accountName}`;
            if (seenBudget.has(key)) {
              const existing = budgetRows.find(
                (r) => r.month === month && r.account_name === accountName,
              );
              if (existing) existing.budgeted = num(existing.budgeted) + num(d.Amount);
              continue;
            }
            seenBudget.add(key);
            budgetRows.push({
              client_id: clientId,
              fiscal_year: fiscalYear,
              month,
              account_name: accountName,
              budgeted: num(d.Amount),
              actual: actualByKey.get(key) ?? 0,
            });
          }
        }
      } catch (e) {
        // A company with no budgets set up, or a realm whose token lacks the
        // scope, should not fail the whole sync — the rest of the data is
        // still good and the UI already handles an empty budget.
        if (e instanceof IntuitError && e.status === 401) throw e;
        console.log(`qbo-sync: budget pull skipped for client ${clientId}: ${(e as Error).message}`);
        budgetRows = [];
      }
      counts.budget_lines = await replaceRows(admin, "qbo_budget_lines", clientId, budgetRows);

      // --- Open A/R ----------------------------------------------------------
      const invoiceRes = await intuitFetch(
        accessToken,
        queryUrl(base, realmId, "select * from Invoice where Balance > '0' maxresults 1000"),
        "Invoice query",
      );
      const todayIso = isoDay(today);
      const openInvoices: any[] = invoiceRes?.QueryResponse?.Invoice || [];

      // --- Customer emails (for per-customer payment reminders) -------------
      // Only the customers that have an open invoice, by Id, in one query per
      // 100 ids — normally a single call, and none at all when nothing is
      // open. Customer is a CDC entity, so an email edited in QuickBooks
      // triggers the next full read. Falls back to the invoice's own
      // BillEmail. A failed lookup keeps the addresses stored last time
      // rather than failing the sync (the reminder just opens with a blank
      // To:). Read-only: nothing is written back to QuickBooks.
      const customerIds = [
        ...new Set(
          openInvoices
            .map((inv) => String(inv.CustomerRef?.value ?? ""))
            .filter((id) => /^[A-Za-z0-9-]+$/.test(id)),
        ),
      ];
      const emailByCustomer = new Map<string, string>();
      if (customerIds.length) {
        try {
          for (let i = 0; i < customerIds.length; i += 100) {
            const ids = customerIds.slice(i, i + 100).map((id) => `'${id}'`).join(",");
            const custRes = await intuitFetch(
              accessToken,
              queryUrl(base, realmId, `select * from Customer where Id in (${ids}) maxresults 1000`),
              "Customer query",
            );
            for (const c of custRes?.QueryResponse?.Customer || []) {
              const email = String(c.PrimaryEmailAddr?.Address ?? "").trim();
              if (email) emailByCustomer.set(String(c.Id), email);
            }
          }
          counts.customer_emails = emailByCustomer.size;
        } catch (e) {
          if (e instanceof IntuitError && e.status === 401) throw e;
          console.log(`qbo-sync: customer email lookup skipped for client ${clientId}: ${(e as Error).message}`);
          const { data: stored } = await admin
            .from("qbo_invoices")
            .select("customer_id, customer_email")
            .eq("client_id", clientId)
            .not("customer_email", "is", null);
          for (const r of stored || []) {
            if (r.customer_id && r.customer_email) emailByCustomer.set(r.customer_id, r.customer_email);
          }
        }
      }

      const invoiceRows = openInvoices.map((inv: any) => {
        const customerId = inv.CustomerRef?.value != null ? String(inv.CustomerRef.value) : null;
        const billEmail = String(inv.BillEmail?.Address ?? "").trim();
        return {
          client_id: clientId,
          qbo_id: String(inv.Id),
          customer_name: inv.CustomerRef?.name ?? null,
          // QuickBooks' own invoice number (supabase/qbo-doc-number.sql).
          doc_number: inv.DocNumber != null && String(inv.DocNumber).trim() ? String(inv.DocNumber).trim() : null,
          txn_date: inv.TxnDate ?? null,
          due_date: inv.DueDate ?? null,
          total: num(inv.TotalAmt),
          balance: num(inv.Balance),
          status: inv.DueDate && inv.DueDate < todayIso ? "overdue" : "open",
          updated_at: new Date().toISOString(),
          customer_id: customerId,
          customer_email: (customerId && emailByCustomer.get(customerId)) || billEmail || null,
        };
      });
      counts.invoices = await replaceRows(admin, "qbo_invoices", clientId, invoiceRows);

      // --- Open A/P ----------------------------------------------------------
      const billRes = await intuitFetch(
        accessToken,
        queryUrl(base, realmId, "select * from Bill where Balance > '0' maxresults 1000"),
        "Bill query",
      );
      const billRows = (billRes?.QueryResponse?.Bill || []).map((b: any) => ({
        client_id: clientId,
        qbo_id: String(b.Id),
        vendor_name: b.VendorRef?.name ?? null,
        // The vendor's bill number as entered in QuickBooks, often blank.
        doc_number: b.DocNumber != null && String(b.DocNumber).trim() ? String(b.DocNumber).trim() : null,
        txn_date: b.TxnDate ?? null,
        due_date: b.DueDate ?? null,
        total: num(b.TotalAmt),
        balance: num(b.Balance),
        status: b.DueDate && b.DueDate < todayIso ? "overdue" : "open",
        updated_at: new Date().toISOString(),
      }));
      counts.bills = await replaceRows(admin, "qbo_bills", clientId, billRows);

      // --- Recent register activity -----------------------------------------
      const txReport = await intuitFetch(
        accessToken,
        reportUrl(base, realmId, "TransactionList", { start_date: txStart, end_date: plEnd }),
        "TransactionList report",
      );
      const txRows = parseTransactionList(txReport).map((t) => ({
        client_id: clientId,
        ...t,
        updated_at: new Date().toISOString(),
      }));
      counts.transactions = await replaceRows(admin, "qbo_transactions", clientId, txRows);
    }

    // --- Close data (daily; the first pull is the backfill) ----------------
    let closePulled = false;
    if (opts.closeDue) {
      try {
        let accts = accountRows;
        if (skipFull) {
          const { data: stored } = await admin
            .from("qbo_accounts")
            .select("qbo_id, name, account_type, account_sub_type, current_balance")
            .eq("client_id", clientId);
          accts = stored || [];
        }
        Object.assign(counts, await pullCloseData(admin, accessToken, base, realmId, clientId, accts));
        closePulled = true;
      } catch (e) {
        // The dashboard data above is still good; close checks just keep
        // yesterday's data and retry on the next run.
        if (e instanceof IntuitError && e.status === 401) throw e;
        counts.close_error = 1;
        console.log(`qbo-sync: close data pull failed for client ${clientId}: ${(e as Error).message}`);
      }
    }

    // --- Giving by donor, full calendar years (1 call per year due) --------
    if (opts.donorYears && opts.donorYears.length) {
      let accts = accountRows;
      if (skipFull) {
        const { data: stored } = await admin
          .from("qbo_accounts")
          .select("qbo_id, name, account_type")
          .eq("client_id", clientId);
        accts = stored || [];
      }
      for (const y of opts.donorYears) {
        try {
          counts[`donor_gifts_${y}`] = await pullDonorGifts(admin, accessToken, base, realmId, clientId, y, accts);
        } catch (e) {
          // Keep the year's previous rows; it's retried on the next run.
          if (e instanceof IntuitError && e.status === 401) throw e;
          counts.donor_gifts_error = 1;
          console.log(`qbo-sync: donor gifts ${y} pull failed for client ${clientId}: ${(e as Error).message}`);
        }
      }
    }

    // --- Bookkeeping -------------------------------------------------------
    await admin.from("qbo_sync_runs").insert({
      client_id: clientId,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      status: "ok",
      detail: null,
      counts,
    });
    const syncedAt = new Date().toISOString();
    await admin
      .from("qbo_connections")
      .update({
        status: "connected",
        last_synced_at: syncedAt,
        last_error: null,
        updated_at: new Date().toISOString(),
        ...(skipFull ? {} : { last_full_sync_at: syncedAt }),
        ...(closePulled ? { close_synced_at: syncedAt } : {}),
      })
      .eq("client_id", clientId);
    if (closePulled) {
      const { error: evalErr } = await admin.rpc("close_checks_evaluate", { p_client_id: clientId });
      if (evalErr) console.log(`qbo-sync: close_checks_evaluate failed for client ${clientId}: ${evalErr.message}`);
    }

    console.log(`qbo-sync: client ${clientId} ok — ${JSON.stringify(counts)}`);
    return { client_id: clientId, counts, synced_at: syncedAt };
  } catch (e) {
    const err = e as Error;
    // Message only. IntuitError's message is built from status + intuit_tid,
    // both safe; anything else is one of our own strings or database error
    // text. No response body ever reaches this.
    const detail = err.message || "sync failed";
    // Client users can read qbo_sync_runs.detail and qbo_connections.last_error,
    // so the raw detail goes to the service-role-only qbo_sync_errors and the
    // client-visible columns get a reference to it.
    const ref = crypto.randomUUID();
    const { error: refErr } = await admin
      .from("qbo_sync_errors")
      .insert({ ref, client_id: clientId, detail });
    if (refErr) console.error(`qbo-sync: could not record error ${ref}: ${refErr.message}`);
    const shortRef = ref.slice(0, 8);
    // TokenStoreError (_shared/qbo.ts): Intuit rotated the refresh token but
    // saving it failed, so the old one is dead and only a reconnect helps.
    const needsReconnect = (e instanceof IntuitError && e.status === 401) || e instanceof TokenStoreError;
    const publicError = needsReconnect
      ? `QuickBooks rejected the connection — please reconnect. (ref ${shortRef})`
      : `Sync failed (ref ${shortRef})`;
    await admin.from("qbo_sync_runs").insert({
      client_id: clientId,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      status: "error",
      detail: publicError,
      counts,
    });
    if (needsReconnect) {
      await admin
        .from("qbo_connections")
        .update({ status: "error", last_error: publicError, updated_at: new Date().toISOString() })
        .eq("client_id", clientId);
    } else if (e instanceof QboKeysMissingError) {
      // Secret names only; status left alone (works again once they're set).
      await flagKeysMissing(admin, clientId, e, "qbo-sync");
    } else {
      await admin
        .from("qbo_connections")
        .update({ last_error: publicError, updated_at: new Date().toISOString() })
        .eq("client_id", clientId);
    }
    console.log(`qbo-sync: client ${clientId} failed (ref ${shortRef}) — ${detail}`);
    return { client_id: clientId, error: publicError };
  }
}

// ---------------------------------------------------------------------------
// Balance Sheet as of a month end (action "balance_sheet_asof"; staff only,
// mode (b)). Reports page › Balance Sheet › "Balance Sheet as of <month end>
// (QuickBooks)": the PDF needs the true month-end figures so Mark sent can
// tick "Reports sent to the client" (owner decision D5, closePeriodForAsOf in
// app.jsx). On demand, ONE Intuit report call per press (two only when the
// connection's API host isn't known yet), counted into qbo_api_usage like
// every other call. Nothing is stored: no table writes besides the token
// refresh getAccessToken already does. READ-ONLY toward QuickBooks: a GET of
// the BalanceSheet report, never a write.
//
// No accounting_method is passed, exactly like every other report this
// function pulls, so QuickBooks uses the company's own preference; the basis
// it used comes back as `basis`.
//
// Request:  { action: "balance_sheet_asof", client_id, end_date: "YYYY-MM-DD" }
// Response: { status: "ok", as_of, basis, currency, empty,
//             sections: [{ key: "assets"|"liabilities"|"equity", title,
//                          total, lines: [{ name, amount, depth,
//                                           type: "header"|"line"|"subtotal" }] }],
//             totals: { assets, liabilities, equity, liabilities_and_equity } }
//        or { status: "error", error } (QuickBooks failed or wants a reconnect)
//        or HTTP 400 { error } (bad end_date / not connected), 403 (not staff).
// ---------------------------------------------------------------------------

// The latest calendar date anywhere on Earth (UTC+14), so a staffer whose
// browser has already rolled into a new month is never refused "last month".
// end_date must be a month's last day, no later than the last day of the
// month before that date, and not before 2000.
// BS_VALIDATE_START
function bsValidateEndDate(raw: unknown, now: Date): string | null {
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return "end_date must be a date (YYYY-MM-DD)";
  }
  const [y, m, d] = raw.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return "end_date isn't a real date";
  }
  if (y < 2000) return "end_date is too far back";
  const lastOfMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (d !== lastOfMonth) return "end_date must be the last day of a month";
  const latest = new Date(now.getTime() + 14 * 60 * 60 * 1000);
  const maxEnd = isoDay(new Date(Date.UTC(latest.getUTCFullYear(), latest.getUTCMonth(), 0)));
  if (raw > maxEnd) return "end_date must be the last day of a month that has ended";
  return null;
}
// BS_VALIDATE_END

// BS_PARSE_START
interface BsLine {
  name: string;
  amount: number | null;
  depth: number;
  type: "header" | "line" | "subtotal";
}
interface BsSection {
  key: "assets" | "liabilities" | "equity";
  title: string;
  total: number;
  lines: BsLine[];
}

function bsAmount(cd: any[] | undefined, idx: number): number | null {
  const raw = cd?.[idx]?.value;
  if (raw === undefined || raw === null || String(raw).trim() === "") return null;
  return num(raw);
}

// Flattens one top-level section (its own header and summary are the
// section's title and total, so they're not repeated as lines).
function bsFlatten(rows: any[], amtIdx: number, depth: number, out: BsLine[]) {
  for (const row of rows || []) {
    if (row?.Rows?.Row || row?.Header || row?.Summary) {
      const name = String(row?.Header?.ColData?.[0]?.value || "").trim();
      const own = bsAmount(row?.Header?.ColData, amtIdx);
      if (name) out.push({ name, amount: own, depth, type: "header" });
      bsFlatten(row?.Rows?.Row || [], amtIdx, depth + 1, out);
      const sumName = String(row?.Summary?.ColData?.[0]?.value || "").trim();
      if (sumName || row?.Summary?.ColData) {
        out.push({
          name: sumName || (name ? `Total ${name}` : "Total"),
          amount: bsAmount(row?.Summary?.ColData, amtIdx) ?? 0,
          depth,
          type: "subtotal",
        });
      }
      continue;
    }
    if (row?.ColData?.length) {
      const name = String(row.ColData[0]?.value || "").trim();
      if (!name) continue;
      out.push({ name, amount: bsAmount(row.ColData, amtIdx) ?? 0, depth, type: "line" });
    }
  }
}

function parseBalanceSheet(report: any): {
  sections: BsSection[];
  totals: { assets: number; liabilities: number; equity: number; liabilities_and_equity: number };
  basis: string | null;
  currency: string | null;
  empty: boolean;
  unreadable: boolean;
} {
  const cols = report?.Columns?.Column || [];
  let amtIdx = reportColumn(report, "total", "total");
  if (amtIdx < 0) amtIdx = Math.max(1, cols.length - 1);
  const top: any[] = report?.Rows?.Row || [];
  const headerOf = (r: any) => String(r?.Header?.ColData?.[0]?.value || "").trim();
  const find = (rows: any[], group: string, re: RegExp) =>
    rows.find((r) => r?.group === group) || rows.find((r) => re.test(headerOf(r)));
  const assetsRow = find(top, "TotalAssets", /^(total\s+)?assets$/i);
  const leRow = find(top, "TotalLiabilitiesAndEquity", /liabilities\s+and\s+(equity|net assets)/i);
  const inner: any[] = leRow?.Rows?.Row || top;
  const liabRow = find(inner, "Liabilities", /^liabilities$/i);
  const equityRow = find(inner, "Equity", /^(equity|net assets)$/i);

  const build = (row: any, key: BsSection["key"], fallback: string): BsSection => {
    const lines: BsLine[] = [];
    bsFlatten(row?.Rows?.Row || [], amtIdx, 0, lines);
    return {
      key,
      title: headerOf(row) || fallback,
      total: bsAmount(row?.Summary?.ColData, amtIdx) ?? 0,
      lines,
    };
  };
  const sections = [
    build(assetsRow, "assets", "Assets"),
    build(liabRow, "liabilities", "Liabilities"),
    build(equityRow, "equity", "Equity"),
  ];
  const totals = {
    assets: sections[0].total,
    liabilities: sections[1].total,
    equity: sections[2].total,
    liabilities_and_equity:
      bsAmount(leRow?.Summary?.ColData, amtIdx) ?? sections[1].total + sections[2].total,
  };
  const noData = (report?.Header?.Option || []).some(
    (o: any) => o?.Name === "NoReportData" && String(o?.Value) === "true",
  );
  const anyAmount = sections.some(
    (s) => s.total !== 0 || s.lines.some((l) => l.amount !== null && l.amount !== 0),
  );
  // A report with no Assets row, or with neither a Liabilities nor an Equity
  // row, is a shape we couldn't read (not "no data"): the caller errors.
  const unreadable = !noData && (!assetsRow || (!liabRow && !equityRow));
  return {
    sections,
    totals,
    unreadable,
    basis: report?.Header?.ReportBasis ? String(report.Header.ReportBasis) : null,
    currency: report?.Header?.Currency ? String(report.Header.Currency) : null,
    empty: noData || !anyAmount,
  };
}
// BS_PARSE_END

async function balanceSheetAsOf(admin: any, clientId: string, endDate: unknown): Promise<Response> {
  const bad = bsValidateEndDate(endDate, new Date());
  if (bad) return json({ error: bad }, 400);
  const asOf = endDate as string;

  const { data: conn } = await admin
    .from("qbo_connections")
    .select("client_id, realm_id, status, api_env")
    .eq("client_id", clientId)
    .maybeSingle();
  if (!conn) return json({ error: "QuickBooks isn't connected for this client" }, 400);
  if (conn.status !== "connected" || !conn.realm_id) {
    return json({ status: "error", error: "QuickBooks needs to be reconnected — please reconnect" });
  }

  try {
    const accessToken = await getAccessToken(admin, clientId, conn.api_env ?? null);
    // Balances are cumulative, so only end_date sets the figures. start_date
    // is pinned to Jan 1 of that year (QuickBooks' own "this year to date"
    // default for a calendar-year company) so Intuit never fills in a
    // start of its own that falls after an older end_date.
    const params = { start_date: asOf.slice(0, 4) + "-01-01", end_date: asOf };
    const known = baseForEnv(conn.api_env);
    // A connection made before api_env existed: don't guess production then
    // sandbox (two Intuit calls); a normal sync records the environment.
    if (!known) return json({ status: "error", error: "Press Sync now once first, then try again." });
    const report = await intuitFetch(accessToken, reportUrl(known, conn.realm_id, "BalanceSheet", params), "Balance Sheet");
    const { unreadable, ...parsed } = parseBalanceSheet(report);
    if (unreadable) {
      console.log(`qbo-sync: balance_sheet_asof client ${clientId} ${asOf} failed — unreadable shape`);
      return json({ status: "error", error: "QuickBooks returned a Balance Sheet in a shape we couldn't read." });
    }
    if (!parsed.empty && Math.abs(parsed.totals.assets - parsed.totals.liabilities_and_equity) >= 0.005) {
      console.log(`qbo-sync: balance_sheet_asof client ${clientId} ${asOf} failed — did not balance`);
      return json({ status: "error", error: "QuickBooks' Balance Sheet didn't balance, so no PDF was made." });
    }
    // Counts only: no amounts, no account names (customer financial data).
    console.log(
      `qbo-sync: balance_sheet_asof client ${clientId} ${asOf} ok — ` +
        `${parsed.sections.map((s) => s.lines.length).join("/")} lines${parsed.empty ? " (empty)" : ""}`,
    );
    return json({ status: "ok", as_of: asOf, ...parsed });
  } catch (e) {
    const err = e as Error;
    // Message only: status code + intuit_tid, or one of our own strings.
    let detail = err.message || "Balance Sheet failed";
    if (e instanceof IntuitError && e.status === 401 && !(e instanceof IntuitAuthError)) {
      detail = `QuickBooks rejected the connection — please reconnect. (${detail})`;
    }
    console.log(`qbo-sync: balance_sheet_asof client ${clientId} ${asOf} failed — ${detail}`);
    return json({ status: "error", error: detail });
  }
}

// ---------------------------------------------------------------------------
// "Sync now" guards (mode (b)) and the plan schedule (mode (a)).
// ---------------------------------------------------------------------------

// A user-triggered sync is skipped if the connection synced successfully
// less than this long ago, and refused if any Sync now attempt on it (failed
// ones included) started less than this long ago.
const USER_SYNC_MIN_INTERVAL_MS = 60 * 1000;
// Sync now attempts per person in a rolling 24 hours, counted from
// qbo_manual_sync_attempts. Each attempt costs up to ~9 Intuit calls, and
// the Intuit allowance is shared by every client of the app.
const CLIENT_DAILY_SYNC_CAP = 30;
const STAFF_DAILY_SYNC_CAP = 200;

// A refused Sync now, in the shape both Sync now buttons already handle:
// status "error" plus errors[0].error. `code` is for future UI use. The
// messages must not say "reconnect" or "included with Pro" (the client
// button keys its wording off those).
function syncRefused(code: string, message: string, clientId: string, syncedAt: string | null) {
  return json({
    status: "error",
    code,
    error: message,
    synced_at: syncedAt,
    synced: [],
    errors: [{ client_id: clientId, error: message }],
  });
}

// Sync schedule by client plan (clients.plan; owner decisions 2026-09-27 and
// 2026-09-30). The cron calls this function every 5 minutes; each run syncs
// only the clients that are due:
//   premium (Pro)   every hour (qbo_usage_settings.premium_interval_min;
//                   2 hours when the usage guard throttles), and clients may press
//                   Sync now
//   standard (Plus) once a week: when the last good sync is 7+ days old
//   basic (Basic)   once a month, on the 15th (US Central date)
// A client with no successful sync yet is always due, so a new connection
// fills in straight away. Staff can press Sync now on any plan.
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
function centralDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(d);
}
// Slack for the 5-minute cron tick: a sync that finished a few seconds after
// :00 must still count as due an hour later, not 5 minutes after that.
const CRON_SLACK_MS = 3 * 60 * 1000;
function isDueForPlan(
  plan: string | null,
  lastSyncedAt: string | null,
  now: Date,
  premiumIntervalMin = 60,
): boolean {
  if (!lastSyncedAt) return true;
  const last = new Date(lastSyncedAt);
  if (plan === "basic") {
    const today = centralDate(now);
    return today.endsWith("-15") && centralDate(last) !== today;
  }
  if (plan === "standard") return now.getTime() - last.getTime() >= WEEK_MS;
  return now.getTime() - last.getTime() >= premiumIntervalMin * 60 * 1000 - CRON_SLACK_MS;
}
// A lock older than this is treated as abandoned (the function crashed or
// timed out mid-sync) and may be taken over.
const SYNC_LOCK_STALE_MS = 5 * 60 * 1000;

// Atomic "take the lock if nobody holds it" on qbo_connections.sync_started_at
// (supabase/qbo-sync-now.sql). The conditional UPDATE ... RETURNING is the
// lock: of two concurrent callers, exactly one gets a row back.
//
// Fail-open: if the column doesn't exist yet (function deployed before the
// SQL file is applied) or the update errors for any other reason, the sync
// proceeds unlocked — the 60-second throttle still applies — rather than
// breaking the button.
async function acquireSyncLock(admin: any, clientId: string): Promise<"acquired" | "held" | "unavailable"> {
  const nowIso = new Date().toISOString();
  const staleIso = new Date(Date.now() - SYNC_LOCK_STALE_MS).toISOString();
  const { data, error } = await admin
    .from("qbo_connections")
    .update({ sync_started_at: nowIso })
    .eq("client_id", clientId)
    .or(`sync_started_at.is.null,sync_started_at.lt."${staleIso}"`)
    .select("client_id");
  if (error) return "unavailable";
  return data && data.length ? "acquired" : "held";
}

async function releaseSyncLock(admin: any, clientId: string) {
  await admin
    .from("qbo_connections")
    .update({ sync_started_at: null })
    .eq("client_id", clientId);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
Deno.serve(async (req) => {
  try {
    return await handle(req);
  } finally {
    await flushUsage(createClient(SUPABASE_URL, SERVICE_ROLE_KEY)).catch(() => {});
  }
});

async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const authHeader = req.headers.get("Authorization") || "";
  const presented = authHeader.replace(/^Bearer\s+/i, "");
  if (!presented) return json({ error: "unauthorized" }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Mode (a): a machine caller. Two bearers are accepted — the service_role
  // key, and the cron key: a 32-byte secret Postgres generated for itself and
  // keeps in Vault, read back here through the service_role-only
  // qbo_cron_key() RPC so the schedule never depends on a hand-copied key
  // (supabase/cron-shared-secret.sql). Both compared constant-time.
  let isServiceRole = secretsMatch(presented, SERVICE_ROLE_KEY);
  if (!isServiceRole) {
    const { data: cronKey } = await admin.rpc("qbo_cron_key");
    isServiceRole =
      typeof cronKey === "string" && cronKey.length > 0 && secretsMatch(presented, cronKey);
  }

  let targets: any[] = [];
  let skipped = 0;
  let usage: any = null;

  if (isServiceRole) {
    // The scheduled call sends '{}'. An action is only for signed-in staff.
    let machineBody: any = {};
    try {
      machineBody = await req.json();
    } catch (_e) {
      machineBody = {};
    }
    if (machineBody?.action !== undefined && machineBody?.action !== null) {
      return json({ error: "unknown action" }, 400);
    }
    // Intuit usage guard (supabase/qbo-usage-guard.sql). Past the hard stop,
    // scheduled syncs stop for the rest of the month; Sync now still works
    // for staff (client users are refused in mode (b) below).
    // If the status can't be read, carry on at the normal cadence.
    const { data: usageData, error: usageErr } = await admin.rpc("qbo_usage_status");
    if (!usageErr && usageData) usage = usageData;
    if (usage?.mode === "stopped") {
      console.log(`qbo-sync: usage hard stop (${usage.calls} of ${usage.cap}); scheduled syncs skipped`);
      return json({ synced: [], errors: [], skipped: "all", reason: "usage_hard_stop", usage });
    }
    const premiumIntervalMin = Number(usage?.premium_interval_min) || 60;

    const { data, error } = await admin
      .from("qbo_connections")
      .select("client_id, realm_id, api_env, last_synced_at, last_full_sync_at, close_synced_at")
      .eq("status", "connected");
    if (error) return json({ error: "failed to list connections" }, 500);
    const conns = data || [];
    // Plans, to decide who's due this run. If the lookup fails, fall back
    // to syncing everyone (the old behaviour) rather than no one.
    const planById: Record<string, string> = {};
    if (conns.length) {
      const { data: plans, error: planErr } = await admin
        .from("clients")
        .select("id, plan")
        .in("id", conns.map((c: any) => c.client_id));
      if (!planErr) (plans || []).forEach((p: any) => (planById[p.id] = p.plan));
    }
    const now = new Date();
    targets = conns.filter((c: any) =>
      isDueForPlan(planById[c.client_id] ?? "premium", c.last_synced_at, now, premiumIntervalMin),
    );
    skipped = conns.length - targets.length;
  } else {
    // Mode (b): a signed-in person's own JWT — an active staffer, or an
    // active client user. Identity and staff/client checks run AS THEM,
    // under RLS, against the anon key — so a forged client_id in the body
    // can't get past can_access_client() or client_users' own-row policy.
    let body: any = {};
    try {
      body = await req.json();
    } catch (_e) {
      body = {};
    }
    const requested = typeof body?.client_id === "string" && body.client_id ? body.client_id : null;

    const asUser = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes, error: userErr } = await asUser.auth.getUser();
    const user = userRes?.user;
    if (userErr || !user?.email) return json({ error: "unauthorized" }, 401);

    let clientId: string | null = null;
    let isStaff = false;

    // Active staff roster row. `staff` RLS lets a signed-in user read only
    // their own row, so this is both the authorization check and its own
    // scoping. Staff may sync any client can_access_client() says is theirs
    // (admins: every client; bookkeepers: their assigned ones).
    const { data: staffRow } = await asUser
      .from("staff")
      .select("email, active")
      .eq("email", user.email)
      .maybeSingle();
    if (staffRow && staffRow.active === true) {
      isStaff = true;
      if (!requested) return json({ error: "client_id required" }, 400);
      const { data: allowed, error: rpcErr } = await asUser.rpc("can_access_client", {
        p_client_id: requested,
      });
      if (rpcErr || allowed !== true) return json({ error: "forbidden" }, 403);
      clientId = requested;
    } else {
      // Active client user: only their own org. client_users is keyed by
      // email (one org per login) and its "client reads own row" policy
      // returns only the caller's row. A client_id in the body that isn't
      // theirs is refused rather than silently swapped for their own.
      const { data: cu } = await asUser
        .from("client_users")
        .select("client_id, active")
        .eq("email", user.email)
        .maybeSingle();
      if (!cu || cu.active !== true || !cu.client_id) return json({ error: "forbidden" }, 403);
      if (requested && requested !== cu.client_id) return json({ error: "forbidden" }, 403);
      clientId = cu.client_id;
      // Sync now is a Pro feature for clients; Basic and Plus refresh on
      // their plan's schedule.
      const { data: org } = await admin
        .from("clients")
        .select("plan")
        .eq("id", clientId)
        .maybeSingle();
      if (org && org.plan !== "premium") {
        return json({ error: "Sync now is included with Pro" }, 403);
      }
    }

    // Read-only report actions (no action = Sync now, unchanged). Staff only,
    // after the same can_access_client() check Sync now uses above.
    if (body?.action !== undefined && body?.action !== null) {
      if (body.action !== "balance_sheet_asof") return json({ error: "unknown action" }, 400);
      if (!isStaff) return json({ error: "forbidden" }, 403);
      return await balanceSheetAsOf(admin, clientId!, body.end_date);
    }

    const { data: conn } = await admin
      .from("qbo_connections")
      .select("client_id, realm_id, status, api_env, last_synced_at, close_synced_at")
      .eq("client_id", clientId)
      .maybeSingle();
    if (!conn) return json({ error: "QuickBooks isn't connected for this client" }, 400);
    // Staff may retry a connection sitting in 'error' (that's how they find
    // out whether a reconnect worked); a client only syncs a live one.
    if (!isStaff && conn.status !== "connected") {
      return json({ error: "QuickBooks isn't connected for this client" }, 400);
    }

    // Throttle. A successful sync under a minute old is returned as-is
    // without phoning Intuit — a double-click, or a client and their
    // bookkeeper both pressing the button, costs nothing.
    const lastMs = conn.last_synced_at ? new Date(conn.last_synced_at).getTime() : 0;
    if (!isStaff && lastMs && Date.now() - lastMs < USER_SYNC_MIN_INTERVAL_MS) {
      return json({ status: "fresh", synced_at: conn.last_synced_at, synced: [], errors: [] });
    }

    // Intuit usage guard: past the hard stop, client users can't spend more
    // of the shared allowance. Staff still can (that's how they check a fix).
    // Unreadable status carries on, same as the scheduled path.
    if (!isStaff) {
      const { data: usageData, error: usageErr } = await admin.rpc("qbo_usage_status");
      if (!usageErr && usageData?.mode === "stopped") {
        return syncRefused(
          "usage_stopped",
          "Sync now is paused for the rest of the month. Your numbers will refresh automatically next month.",
          clientId!,
          conn.last_synced_at,
        );
      }
    }

    // Daily cap per person, rolling 24 hours. Fails closed: if the count
    // can't be read, the cap can't be enforced.
    const actorEmail = (user.email || "").toLowerCase();
    const { count: recent, error: countErr } = await admin
      .from("qbo_manual_sync_attempts")
      .select("id", { count: "exact", head: true })
      .eq("actor_email", actorEmail)
      .gte("attempted_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
    if (countErr) {
      console.error(`qbo-sync: could not count Sync now attempts: ${countErr.message}`);
      return syncRefused("unavailable", "Sync now isn't available right now. Please try again later.", clientId!, conn.last_synced_at);
    }
    if ((recent ?? 0) >= (isStaff ? STAFF_DAILY_SYNC_CAP : CLIENT_DAILY_SYNC_CAP)) {
      return syncRefused(
        "daily_limit",
        "You've reached today's Sync now limit. Your numbers still refresh on their regular schedule.",
        clientId!,
        conn.last_synced_at,
      );
    }

    // Throttle on the last ATTEMPT, failed ones included. The conditional
    // UPDATE ... RETURNING stamps last_sync_attempt_at and is its own check:
    // of two concurrent callers only one gets a row back.
    const attemptIso = new Date().toISOString();
    const { data: stamped, error: stampErr } = await admin
      .from("qbo_connections")
      .update({ last_sync_attempt_at: attemptIso })
      .eq("client_id", clientId)
      .or(
        `last_sync_attempt_at.is.null,last_sync_attempt_at.lt."${
          new Date(Date.now() - USER_SYNC_MIN_INTERVAL_MS).toISOString()
        }"`,
      )
      .select("client_id");
    if (stampErr) {
      console.error(`qbo-sync: could not stamp Sync now attempt: ${stampErr.message}`);
      return syncRefused("unavailable", "Sync now isn't available right now. Please try again later.", clientId!, conn.last_synced_at);
    }
    if (!stamped || !stamped.length) {
      return syncRefused(
        "too_soon",
        "A sync was just tried for this account. Please wait a minute and try again.",
        clientId!,
        conn.last_synced_at,
      );
    }
    const { error: logErr } = await admin
      .from("qbo_manual_sync_attempts")
      .insert({ client_id: clientId, actor_email: actorEmail, attempted_at: attemptIso });
    if (logErr) {
      console.error(`qbo-sync: could not record Sync now attempt: ${logErr.message}`);
      return syncRefused("unavailable", "Sync now isn't available right now. Please try again later.", clientId!, conn.last_synced_at);
    }
    // And one sync per connection at a time. Two concurrent delete-then-
    // insert runs on the same client would trip each other's primary keys.
    const lock = await acquireSyncLock(admin, clientId!);
    if (lock === "held") {
      return json({ status: "in_progress", synced_at: conn.last_synced_at, synced: [], errors: [] });
    }

    let result: any;
    try {
      // Sync now always does the full read (no CDC gate), pulls close data
      // when it's due, and always refreshes this year's giving by donor (the
      // previous year only on its own schedule).
      const pulls = await donorPullsFor(admin, [conn.client_id]);
      result = await syncClient(admin, conn.client_id, conn.realm_id, conn.api_env ?? null, {
        closeDue: isStaff || isCloseDue(conn.close_synced_at, new Date()),
        donorYears: pulls
          ? donorYearsDue(pulls.get(conn.client_id) || new Map(), new Date(), true)
          : [],
      });
    } finally {
      if (lock === "acquired") await releaseSyncLock(admin, clientId!);
    }
    if (result.error) {
      return json({
        status: "error",
        error: result.error,
        synced_at: conn.last_synced_at,
        synced: [],
        errors: [result],
      });
    }
    return json({
      status: "ok",
      synced_at: result.synced_at,
      synced: [result],
      errors: [],
    });
  }

  const synced: any[] = [];
  const errors: any[] = [];
  // Sequential on purpose: Intuit rate-limits per app as well as per realm,
  // and a firm-wide cron run fanning out in parallel is the shape that trips
  // it. A full sweep of a few dozen clients still finishes well inside the
  // Edge Function timeout.
  const now = new Date();
  const donorPulls = await donorPullsFor(admin, targets.map((t: any) => t.client_id));
  for (const t of targets) {
    const result = await syncClient(admin, t.client_id, t.realm_id, t.api_env ?? null, {
      cdcSince: cdcSinceFor(t, now),
      closeDue: isCloseDue(t.close_synced_at, now),
      donorYears: donorPulls
        ? donorYearsDue(donorPulls.get(t.client_id) || new Map(), now, false)
        : [],
    });
    if ((result as any).error) errors.push(result);
    else synced.push(result);
  }

  return json({ synced, errors, skipped, mode: usage?.mode ?? null });
}

function isCloseDue(closeSyncedAt: string | null | undefined, now: Date): boolean {
  if (!closeSyncedAt) return true;
  return now.getTime() - new Date(closeSyncedAt).getTime() >= CLOSE_SYNC_MAX_AGE_MS;
}

// The CDC gate applies when the last full read is under a day old and the
// last sync is inside Intuit's 30-day CDC window; otherwise null = full read.
function cdcSinceFor(t: any, now: Date): Date | null {
  if (!t.last_synced_at || !t.last_full_sync_at) return null;
  const last = new Date(t.last_synced_at).getTime();
  const full = new Date(t.last_full_sync_at).getTime();
  if (now.getTime() - full >= FULL_SYNC_MAX_AGE_MS) return null;
  if (now.getTime() - last >= CDC_MAX_AGE_MS) return null;
  return new Date(last - CDC_OVERLAP_MS);
}
