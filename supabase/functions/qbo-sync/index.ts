import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Pulls a client's books out of QuickBooks into the qbo_* tables
// (supabase/qbo-data.sql), which the browser then reads through RLS and
// maps onto the client shape the pages already consume
// (components/qbo/mapQboToClient.js). This is the thing that turns the
// dashboard from "Prototype · Sample Data" into real numbers.
//
// Two callers, two auth modes:
//
//   (a) pg_cron/pg_net, hourly (supabase/qbo-sync-cron.sql). Presents the
//       generated cron key — or the project's service_role key — as its
//       bearer token, exactly like qbo-refresh-token does, and syncs EVERY
//       connected client.
//   (b) a signed-in person clicking "Sync now" (the header button next to
//       the Live pill, or the Client details QuickBooks tab). Presents their
//       own Supabase JWT and syncs exactly one client:
//         - active staff: the client_id in the body, only if
//           can_access_client() says that client is theirs. A bookkeeper
//           must not be able to make a client they don't manage phone Intuit.
//         - active client user (client_users row, active): only their own
//           org's client_id; any other client_id in the body is refused.
//       Throttled: a connection that synced OK < 60s ago, or has a sync in
//       progress, returns its last synced_at without calling Intuit.
//       Response: { status: "ok" | "fresh" | "in_progress" | "error",
//                   synced_at, error?, synced[], errors[] }.
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
// Deliberately self-contained — no shared module. Supabase deploys each
// Edge Function independently; a shared file would mean the QBO functions
// could only ever be deployed together.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const QBO_CLIENT_ID = Deno.env.get("QBO_CLIENT_ID")!;
const QBO_CLIENT_SECRET = Deno.env.get("QBO_CLIENT_SECRET")!;
const QBO_TOKEN_ENCRYPTION_KEY = Deno.env.get("QBO_TOKEN_ENCRYPTION_KEY")!;

const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
// The API host is resolved PER CONNECTION, not from QBO_ENV alone. A realm
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

// Refresh an access token this close to expiry rather than watching a call
// fail — same window qbo-refresh-token uses.
const REFRESH_AHEAD_MS = 10 * 60 * 1000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
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
// the Reconnect UI take over" path, and its own message so the stored
// last_error names both codes.
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
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

// ---------------------------------------------------------------------------
// Intuit HTTP
// ---------------------------------------------------------------------------
async function intuitFetch(
  accessToken: string,
  url: string,
  what: string,
): Promise<any> {
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
  return await res.json();
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
// Tokens: read (decrypt) via the same SECURITY DEFINER RPCs qbo-callback and
// qbo-refresh-token use, and refresh in-line when the access token is within
// REFRESH_AHEAD_MS of expiring. Intuit ALWAYS rotates the refresh token on
// use, so a successful refresh must store the new one immediately — the old
// one is dead the instant the call returns.
// ---------------------------------------------------------------------------
async function getAccessToken(admin: any, clientId: string): Promise<string> {
  const { data: rows, error } = await admin.rpc("qbo_get_tokens", {
    p_client_id: clientId,
    p_key: QBO_TOKEN_ENCRYPTION_KEY,
  });
  const row = rows?.[0];
  if (error || !row?.access_token) throw new Error("no stored QuickBooks tokens");

  const now = Date.now();
  const expiresAtMs = row.expires_at ? new Date(row.expires_at).getTime() : 0;
  if (expiresAtMs - now > REFRESH_AHEAD_MS) return row.access_token;
  if (!row.refresh_token) throw new Error("no refresh token on file");

  const basicAuth = btoa(`${QBO_CLIENT_ID}:${QBO_CLIENT_SECRET}`);
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: row.refresh_token,
    }),
  });
  const tid = res.headers.get("intuit_tid");
  if (!res.ok) {
    // A 400 here is nearly always invalid_grant: the refresh token itself
    // expired or was revoked. Surfaced as a 401-shaped failure so the caller
    // flips the connection to 'error' and the existing Reconnect UI takes over.
    throw new IntuitError(401, tid, "token refresh");
  }
  console.log(
    `qbo-sync: refreshed token for client ${clientId}${tid ? ` (intuit_tid: ${tid})` : ""}`,
  );
  const tokens = await res.json();
  await admin.rpc("qbo_store_tokens", {
    p_client_id: clientId,
    p_access_token: tokens.access_token,
    p_refresh_token: tokens.refresh_token,
    p_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    p_key: QBO_TOKEN_ENCRYPTION_KEY,
  });
  return tokens.access_token;
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

  // Walk depth-first. `kind` is inherited from the nearest enclosing
  // Income/Expenses section; a Section's own Summary row is skipped for the
  // line detail (it would double-count its children) but IS what the monthly
  // totals are taken from, at the top level only.
  function walkRows(rows: any[], kind: "income" | "expense" | null, depth: number) {
    for (const row of rows || []) {
      const headerName = row?.Header?.ColData?.[0]?.value || "";
      const ownKind = sectionKind(row?.group, headerName) ?? kind;

      if (row?.Rows?.Row) {
        walkRows(row.Rows.Row, ownKind, depth + 1);
        // Top-level section totals feed qbo_monthly_pl. Nested subsection
        // summaries are already included in their parent's, so only depth 0
        // contributes.
        if (depth === 0 && row?.Summary?.ColData && ownKind) {
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
      if (!accountName || !ownKind) continue;
      for (const mc of months) {
        const amount = num(cd[mc.index]?.value);
        if (!amount) continue; // don't store a zero row per account per month
        const key = `${mc.month}|${accountName}`;
        const prev = lines.get(key);
        if (prev) {
          prev.amount += amount;
        } else {
          lines.set(key, {
            month: mc.month,
            account_name: accountName,
            account_type: ownKind === "income" ? "Income" : "Expense",
            amount,
          });
        }
      }
    }
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
// One client, end to end.
// ---------------------------------------------------------------------------
async function syncClient(
  admin: any,
  clientId: string,
  realmId: string,
  apiEnv: string | null,
) {
  const startedAt = new Date().toISOString();
  const counts: Record<string, number> = {};

  try {
    if (!realmId) throw new Error("connection has no realm_id — reconnect QuickBooks");
    const accessToken = await getAccessToken(admin, clientId);

    const today = new Date();
    const plStart = isoDay(addMonths(firstOfMonth(today), -11));
    const plEnd = isoDay(today);
    const txStart = isoDay(addDays(today, -90));

    // --- Chart of accounts -------------------------------------------------
    // Also where the API environment gets settled. If the connection already
    // knows which host it belongs to, use it. If it doesn't — every connection
    // made before api_env existed — probe with this same first call: production
    // first, then sandbox, and whichever answers 2xx is the host for the whole
    // rest of this sync and is written back so no later run has to probe again.
    const ACCOUNTS_QUERY = "select * from Account where Active = true maxresults 1000";
    const knownBase = baseForEnv(apiEnv);
    let base: string;
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
    const accountRows = (accountsRes?.QueryResponse?.Account || []).map((a: any) => ({
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
    const actualByKey = new Map<string, number>();
    for (const l of pl.lines.values()) {
      actualByKey.set(`${l.month}|${l.account_name}`, l.amount);
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
    const invoiceRows = (invoiceRes?.QueryResponse?.Invoice || []).map((inv: any) => ({
      client_id: clientId,
      qbo_id: String(inv.Id),
      customer_name: inv.CustomerRef?.name ?? null,
      txn_date: inv.TxnDate ?? null,
      due_date: inv.DueDate ?? null,
      total: num(inv.TotalAmt),
      balance: num(inv.Balance),
      status: inv.DueDate && inv.DueDate < todayIso ? "overdue" : "open",
      updated_at: new Date().toISOString(),
    }));
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
      })
      .eq("client_id", clientId);

    console.log(`qbo-sync: client ${clientId} ok — ${JSON.stringify(counts)}`);
    return { client_id: clientId, counts, synced_at: syncedAt };
  } catch (e) {
    const err = e as Error;
    // Message only. IntuitError's message is built from status + intuit_tid,
    // both safe; anything else is one of our own strings. No response body
    // ever reaches this.
    const detail = err.message || "sync failed";
    await admin.from("qbo_sync_runs").insert({
      client_id: clientId,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      status: "error",
      detail,
      counts,
    });
    if (e instanceof IntuitError && e.status === 401) {
      await admin
        .from("qbo_connections")
        .update({
          status: "error",
          last_error:
            e instanceof IntuitAuthError
              ? detail
              : `QuickBooks rejected the connection — please reconnect. (${detail})`,
          updated_at: new Date().toISOString(),
        })
        .eq("client_id", clientId);
    } else {
      await admin
        .from("qbo_connections")
        .update({ last_error: detail, updated_at: new Date().toISOString() })
        .eq("client_id", clientId);
    }
    console.log(`qbo-sync: client ${clientId} failed — ${detail}`);
    return { client_id: clientId, error: detail };
  }
}

// ---------------------------------------------------------------------------
// "Sync now" guards (mode (b) only — the cron path is unchanged).
// ---------------------------------------------------------------------------

// A user-triggered sync is skipped if the connection synced successfully
// less than this long ago.
const USER_SYNC_MIN_INTERVAL_MS = 60 * 1000;
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

  let targets: { client_id: string; realm_id: string; api_env: string | null }[] = [];

  if (isServiceRole) {
    const { data, error } = await admin
      .from("qbo_connections")
      .select("client_id, realm_id, api_env")
      .eq("status", "connected");
    if (error) return json({ error: "failed to list connections" }, 500);
    targets = data || [];
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
    }

    const { data: conn } = await admin
      .from("qbo_connections")
      .select("client_id, realm_id, status, api_env, last_synced_at")
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
    if (lastMs && Date.now() - lastMs < USER_SYNC_MIN_INTERVAL_MS) {
      return json({ status: "fresh", synced_at: conn.last_synced_at, synced: [], errors: [] });
    }
    // And one sync per connection at a time. Two concurrent delete-then-
    // insert runs on the same client would trip each other's primary keys.
    const lock = await acquireSyncLock(admin, clientId!);
    if (lock === "held") {
      return json({ status: "in_progress", synced_at: conn.last_synced_at, synced: [], errors: [] });
    }

    let result: any;
    try {
      result = await syncClient(admin, conn.client_id, conn.realm_id, conn.api_env ?? null);
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
  for (const t of targets) {
    const result = await syncClient(admin, t.client_id, t.realm_id, t.api_env ?? null);
    if ((result as any).error) errors.push(result);
    else synced.push(result);
  }

  return json({ synced, errors });
});
