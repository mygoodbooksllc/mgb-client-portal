import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  flagKeysMissing,
  flagReconnect,
  getAccessToken,
  IntuitAuthError,
  IntuitError,
  intuitFetch,
  meterUsage,
  newCtx,
  type QboCtx,
  QboKeysMissingError,
  queryUrl,
  reportUrl,
  resolveApiBase,
  TokenBusyError,
} from "../_shared/qbo.ts";
import {
  type AcctInfo,
  baselineLines,
  buildLines,
  type Chunk,
  coveredMonths,
  GL_COLUMNS,
  type GlCols,
  halveChunk,
  monthPrints,
  parseClearedList,
  parseGlReport,
  type PullWindow,
  quarterChunks,
  type RawRow,
  reportWarning,
  resolveWindow,
  sectionMismatches,
  TXN_LIST_COLUMNS,
} from "../_shared/gl_ledger.ts";

// ----------------------------------------------------------------------------
// qbo-gl-review: Ledger review's GeneralLedger pull (docs/gl-review-spec.md
// 2 and 3.1). Read-only against QuickBooks.
//
// POST { action: "pull", client_id, window?: "rolling14" | "ytd" | {start, end}, force? }
//   -> { status: "ok", pull_id, pulled_at, basis, window, lines[], ... }
//    | { status: "fresh", pull_id, pulled_at } | { status: "in_progress" }
//    | { status: "error", error }
// POST { action: "baseline", client_id, period: "YYYY-MM" }
//   -> { status: "ok", baseline_id, period, line_count, debit_total, hash, ... }
//
// verify_jwt ON (browser only, no cron caller). Checks, in order, before any
// service_role use: the caller's JWT (auth.getUser), an active staff row, and
// can_access_client(client_id) run AS the caller. Client users get 403.
//
// GL lines are returned to the browser and never stored (spec 2.5). Stored by
// this function (service role, through RPCs in supabase/gl-review-1-core.sql
// and -3-close.sql): the gl_review_pulls lock/audit row, month fingerprints,
// closed-month baselines. Never logs Intuit bodies, amounts or names: status
// codes, counts and intuit_tid only. Metered as qbo_usage_add('gl_review', n)
// once per request; the usage guard's "stopped" mode does not block this
// (user-initiated only, same rule as Sync now).
//
// The token-refresh lock (qbo_connections.token_refresh_at) lives in
// ../_shared/qbo.ts getAccessToken. A 401 (Intuit refused the token refresh,
// or rejected the token on both hosts / a data call) flips the connection to
// 'error' with qbo-sync's reconnect message (flagReconnect), like qbo-sync.
// A busy lock never does.
//
// Env switches (all optional; read at boot):
//   QBO_GL_CHECK_SECTION_TOTALS  default true. "false" turns off the section
//                                Summary-vs-rows check (kill switch, spec 11.7).
//   QBO_GL_SPLIT_TOO_LARGE       default true. "false" stops reading 400 bodies
//                                for "too large" and halving on them: such a
//                                400 then fails the pull as a plain refusal.
//   QBO_GL_MAX_SPLIT_DEPTH       default 6 (a quarter halved 6 times is ~1.5
//                                days). How often one chunk may be halved.
// ----------------------------------------------------------------------------

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const SOURCE = "gl_review"; // qbo_usage_add source
const TAG = "qbo-gl-review";
const CONCURRENCY = 3; // GeneralLedger chunks in flight at once (spec 2.2)
const MAX_CALLS = 60; // hard stop for one request (halving included)

function envFlag(name: string, dflt: boolean): boolean {
  const v = String(Deno.env.get(name) ?? "").trim().toLowerCase();
  if (!v) return dflt;
  if (["0", "false", "off", "no"].includes(v)) return false;
  if (["1", "true", "on", "yes"].includes(v)) return true;
  return dflt;
}
function envInt(name: string, dflt: number, min: number, max: number): number {
  const n = Number.parseInt(String(Deno.env.get(name) ?? ""), 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
}
// Spec 2.2: a section whose Summary total disagrees with its rows = truncated.
// The Summary semantics are sandbox-unverified (spec 11.7); set
// QBO_GL_CHECK_SECTION_TOTALS=false if a sandbox run shows correct reports
// failing this check.
const CHECK_SECTION_TOTALS = envFlag("QBO_GL_CHECK_SECTION_TOTALS", true);
// Halve a chunk Intuit rejects as too large (spec 2.2). Kill switch.
const SPLIT_TOO_LARGE = envFlag("QBO_GL_SPLIT_TOO_LARGE", true);
const MAX_SPLIT_DEPTH = envInt("QBO_GL_MAX_SPLIT_DEPTH", 6, 0, 12);
const FIRM_TZ = "America/Chicago";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

function firmToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: FIRM_TZ }).format(new Date());
}

class PullError extends Error {
  kind: "too_large" | "incomplete";
  constructor(kind: "too_large" | "incomplete", detail: string) {
    super(detail);
    this.kind = kind;
  }
}

// Short plain-language errors for the screen. Never Intuit text.
function friendly(e: unknown): string {
  if (e instanceof QboKeysMissingError) {
    return "QuickBooks isn't set up for this account type yet. Ask an admin.";
  }
  if (e instanceof TokenBusyError) return "QuickBooks is busy refreshing its sign-in. Try again in a minute.";
  if (e instanceof PullError) {
    return e.kind === "too_large"
      ? "This ledger is too big to pull in one go. Try a shorter window, or use Review a file."
      : "QuickBooks sent an incomplete ledger, so none of it was used. Try again, or use Review a file.";
  }
  if (e instanceof IntuitAuthError || (e instanceof IntuitError && (e.status === 401 || e.status === 403))) {
    return "QuickBooks rejected the connection. Reconnect QuickBooks for this client, then try again.";
  }
  if (e instanceof IntuitError) {
    if (e.status === 429) return "QuickBooks is busy right now. Try again in a minute.";
    if (e.status === 0 || e.status >= 500) return "QuickBooks didn't answer. Try again in a minute.";
    return "QuickBooks refused the ledger request. Try again, or use Review a file.";
  }
  const m = (e as Error)?.message || "";
  if (/no stored QuickBooks tokens|no refresh token/.test(m)) return "QuickBooks needs to be reconnected for this client.";
  return "The ledger pull didn't finish. Try again.";
}

const isAuthFailure = (e: unknown) =>
  e instanceof TokenBusyError || (e instanceof IntuitError && (e.status === 401 || e.status === 403));

// ---------------------------------------------------------------------------
// Accounts, vendors
// ---------------------------------------------------------------------------
async function loadAccountsFromDb(admin: any, clientId: string): Promise<Map<string, AcctInfo>> {
  const out = new Map<string, AcctInfo>();
  const { data, error } = await admin
    .from("qbo_accounts")
    .select("qbo_id, account_type, account_sub_type, classification")
    .eq("client_id", clientId)
    .range(0, 9999);
  if (error) {
    console.log(`${TAG}: qbo_accounts read failed for client ${clientId}: ${error.message}`);
    return out;
  }
  for (const a of data || []) {
    out.set(String(a.qbo_id), { type: a.account_type ?? null, subtype: a.account_sub_type ?? null, classification: a.classification ?? null });
  }
  return out;
}

// One Account query (the same one qbo-sync uses) when qbo_accounts is empty or
// lacks an account the ledger names. A failure other than auth leaves the
// browser to guess those types from the name.
async function queryAccounts(ctx: QboCtx, base: string, realm: string, into: Map<string, AcctInfo>, clientId: string) {
  try {
    const res = await intuitFetch(ctx, queryUrl(base, realm, "select * from Account where Active in (true, false) maxresults 1000"), "Account query");
    for (const a of res?.QueryResponse?.Account || []) {
      into.set(String(a.Id), { type: a.AccountType ?? null, subtype: a.AccountSubType ?? null, classification: a.Classification ?? null });
    }
  } catch (e) {
    if (isAuthFailure(e)) throw e;
    console.log(`${TAG}: Account query failed for client ${clientId}: ${(e as Error).message}`);
  }
}

// Vendor id -> Vendor1099 (spec 2.3), paged at 1,000. Held in memory only.
// null when the query fails for a non-auth reason (vendors_loaded false).
async function loadVendors(ctx: QboCtx, base: string, realm: string, clientId: string): Promise<Map<string, boolean | null> | null> {
  const out = new Map<string, boolean | null>();
  try {
    for (let start = 1; start <= 20001; start += 1000) {
      const q = `select Id, DisplayName, Vendor1099 from Vendor where Active in (true, false) startposition ${start} maxresults 1000`;
      const res = await intuitFetch(ctx, queryUrl(base, realm, q), "Vendor query");
      const vs = res?.QueryResponse?.Vendor || [];
      for (const v of vs) out.set(String(v.Id), typeof v.Vendor1099 === "boolean" ? v.Vendor1099 : null);
      if (vs.length < 1000) break;
    }
    return out;
  } catch (e) {
    if (isAuthFailure(e)) throw e;
    console.log(`${TAG}: Vendor query failed for client ${clientId}: ${(e as Error).message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// GeneralLedger, chunked by quarter, halved when too large (spec 2.2)
// ---------------------------------------------------------------------------
type GlPull = { rows: RawRow[]; chunks: Chunk[]; has: { cleared: boolean; cls: boolean; loc: boolean } };

// Promise.allSettled for one round, so no sibling fetch is still running (and
// adding to ctx.calls) when the pull is finished and metered; then the first
// failure, if any, is thrown.
async function settleAll<T>(ps: Promise<T>[]): Promise<T[]> {
  const rs = await Promise.allSettled(ps);
  const bad = rs.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
  if (bad) throw bad.reason;
  return rs.map((r) => (r as PromiseFulfilledResult<T>).value);
}

async function pullGl(ctx: QboCtx, base: string, realm: string, w: PullWindow, basis: string): Promise<GlPull> {
  // Rows are kept per chunk and joined in date order at the end, so the row
  // order (and each line's seq) is Intuit's own order within a chunk, chunks
  // in date order, whatever order the concurrent fetches finished in.
  const got: { c: Chunk; rows: RawRow[] }[] = [];
  const has = { cleared: true, cls: true, loc: true };
  let queue = quarterChunks(w.start, w.end);
  const depth = new Map<string, number>(); // chunk -> times halved to get it
  const dkey = (c: Chunk) => `${c.start}..${c.end}`;

  const one = async (c: Chunk): Promise<Chunk[]> => {
    if (ctx.calls >= MAX_CALLS) throw new PullError("too_large", `call cap ${MAX_CALLS} reached`);
    let report: any;
    try {
      report = await intuitFetch(
        ctx,
        reportUrl(base, realm, "GeneralLedger", {
          start_date: c.start,
          end_date: c.end,
          accounting_method: basis,
          columns: GL_COLUMNS,
        }),
        "GeneralLedger",
        { sniffTooLarge: SPLIT_TOO_LARGE },
      );
    } catch (e) {
      if (e instanceof IntuitError && e.tooLarge) return split(c, "rejected as too large");
      throw e;
    }
    const warn = reportWarning(report);
    if (warn) return split(c, `report option ${warn}`);
    const parsed = parseGlReport(report);
    if (CHECK_SECTION_TOTALS) {
      const chk = sectionMismatches(report, parsed.cols.amt);
      if (chk.mismatched > 0) {
        throw new PullError("incomplete", `${chk.mismatched}/${chk.checked} section totals disagree (${c.start}..${c.end})`);
      }
    }
    if (parsed.cols.date < 0 || parsed.cols.amt < 0 || parsed.cols.type < 0) {
      throw new PullError("incomplete", "GeneralLedger came back without date/type/amount columns");
    }
    const cols: GlCols = parsed.cols;
    if (cols.cleared < 0) has.cleared = false;
    if (cols.cls < 0) has.cls = false;
    if (cols.loc < 0) has.loc = false;
    got.push({ c, rows: parsed.rows });
    return [];
  };
  const split = (c: Chunk, why: string): Chunk[] => {
    const d = depth.get(dkey(c)) ?? 0;
    const halves = d < MAX_SPLIT_DEPTH ? halveChunk(c) : null;
    console.log(`${TAG}: chunk ${c.start}..${c.end} ${why}; ${halves ? "halving" : d >= MAX_SPLIT_DEPTH ? "split limit reached, giving up" : "single day, giving up"}`);
    if (!halves) throw new PullError("too_large", d >= MAX_SPLIT_DEPTH ? `chunk ${c.start}..${c.end} still too large after ${d} splits` : `single day ${c.start} too large`);
    for (const h of halves) depth.set(dkey(h), d + 1);
    return halves;
  };

  // Rounds of up to CONCURRENCY chunks; halves go into the next round.
  while (queue.length) {
    const next: Chunk[] = [];
    for (let i = 0; i < queue.length; i += CONCURRENCY) {
      const batch = queue.slice(i, i + CONCURRENCY);
      const results = await settleAll(batch.map(one));
      for (const r of results) next.push(...r);
    }
    queue = next;
  }
  got.sort((a, b) => (a.c.start < b.c.start ? -1 : a.c.start > b.c.start ? 1 : 0));
  const rows: RawRow[] = [];
  for (const g of got) for (const r of g.rows) rows.push(r);
  return { rows, chunks: got.map((g) => g.c), has };
}

// is_cleared missing from GeneralLedger (spec 11.1): one TransactionList call
// per chunk, joined on the txn key, applied to bank and credit card lines.
async function pullClearedFallback(ctx: QboCtx, base: string, realm: string, chunks: Chunk[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < chunks.length; i += CONCURRENCY) {
    const batch = chunks.slice(i, i + CONCURRENCY);
    const reports = await settleAll(batch.map((c) =>
      intuitFetch(ctx, reportUrl(base, realm, "TransactionList", { start_date: c.start, end_date: c.end, columns: TXN_LIST_COLUMNS }), "TransactionList")
    ));
    for (const rep of reports) for (const [k, v] of parseClearedList(rep)) out.set(k, v);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ status: "error", error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") || "";
  if (!/^Bearer\s+\S+/i.test(authHeader)) return json({ status: "error", error: "Please sign in again." }, 401);

  let body: any = {};
  try {
    body = await req.json();
  } catch (_e) {
    body = {};
  }
  const action: "pull" | "baseline" | null = body?.action === "pull" ? "pull" : body?.action === "baseline" ? "baseline" : null;
  if (!action) return json({ status: "error", error: "action must be pull or baseline" }, 400);
  const clientId = typeof body?.client_id === "string" && body.client_id.length <= 100 ? body.client_id.trim() : "";
  if (!clientId) return json({ status: "error", error: "client_id is required" }, 400);

  // 1. Who is calling (as them, anon key + their JWT).
  const asUser = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userRes, error: userErr } = await asUser.auth.getUser();
  const user = userRes?.user;
  if (userErr || !user?.email) return json({ status: "error", error: "Please sign in again." }, 401);
  const email = user.email.toLowerCase();

  // 2. Active staff (is_active_staff() runs as the caller). Client users: 403.
  const { data: isStaff, error: staffErr } = await asUser.rpc("is_active_staff");
  if (staffErr || isStaff !== true) return json({ status: "error", error: "Ledger review is for staff only." }, 403);

  // 3. This staffer may work on this client.
  const { data: allowed, error: accErr } = await asUser.rpc("can_access_client", { p_client_id: clientId });
  if (accErr || allowed !== true) return json({ status: "error", error: "You don't have access to this client." }, 403);

  // Only now: the service role.
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const { data: conn } = await admin
    .from("qbo_connections")
    .select("client_id, realm_id, status, api_env")
    .eq("client_id", clientId)
    .maybeSingle();
  if (!conn || conn.status !== "connected" || !conn.realm_id) {
    return json({ status: "error", error: "QuickBooks isn't connected for this client" });
  }
  const realm = String(conn.realm_id);

  const today = firmToday();
  const wr = resolveWindow(action, { window: body?.window, period: body?.period }, today);
  if ("error" in wr) return json({ status: "error", error: wr.error }, 400);
  const w: PullWindow = wr;

  if (action === "baseline") {
    const { data: mc } = await admin.from("month_close").select("status").eq("client_id", clientId).eq("period", w.start).maybeSingle();
    if (mc?.status !== "done") return json({ status: "error", error: "Mark the month Done first, then take the snapshot." });
  }

  // Lock + audit row. "fresh" compares only window_kind, so a custom window or
  // a baseline month always forces a new pull.
  const force = body?.force === true || w.kind === "custom" || w.kind === "baseline";
  const { data: begin, error: beginErr } = await admin.rpc("gl_review_pull_begin", {
    p_client_id: clientId,
    p_pulled_by: email,
    p_window_kind: w.kind,
    p_window_start: w.start,
    p_window_end: w.end,
    p_force: force,
  });
  if (beginErr || !begin?.status) {
    console.log(`${TAG}: pull_begin failed for client ${clientId}: ${beginErr?.message || "no result"}`);
    return json({ status: "error", error: "The ledger pull couldn't start. Try again." }, 500);
  }
  if (begin.status === "in_progress") return json({ status: "in_progress" });
  if (begin.status === "fresh") return json({ status: "fresh", pull_id: begin.pull_id, pulled_at: begin.pulled_at });
  const pullId: string = begin.pull_id;
  const pulledAt: string = begin.pulled_at;

  const ctx = newCtx("");
  let finished = false;
  const finish = async (status: "ok" | "error", lineCount: number | null, error: string | null) => {
    finished = true;
    const { data: ok, error: fe } = await admin.rpc("gl_review_pull_finish", {
      p_client_id: clientId,
      p_pull_id: pullId,
      p_status: status,
      p_calls: ctx.calls,
      p_line_count: lineCount,
      p_error: error,
    });
    if (fe) console.log(`${TAG}: pull_finish failed for client ${clientId}: ${fe.message}`);
    else if (ok !== true) console.log(`${TAG}: pull ${pullId} for client ${clientId} was taken over before it finished`);
  };

  try {
    // The connection's own api_env picks the Intuit app keys for a refresh.
    ctx.accessToken = await getAccessToken(admin, clientId, { logTag: TAG, apiEnv: conn.api_env ?? null });

    // Preferences: the company's own accounting method, pinned and sent
    // explicitly on every report (spec 2.1), plus class/location tracking.
    // Also the call that settles api_env for a connection that has none.
    const { base, first: prefsRes } = await resolveApiBase(
      admin, ctx, clientId, conn.api_env,
      (b) => queryUrl(b, realm, "select * from Preferences"),
      "Preferences query",
    );
    const prefs = prefsRes?.QueryResponse?.Preferences?.[0] || {};
    const basis = /cash/i.test(String(prefs?.ReportPrefs?.ReportBasis || "")) ? "Cash" : "Accrual";
    const ai = prefs?.AccountingInfoPrefs || {};
    const classOff = ai.ClassTrackingPerTxn === false && ai.ClassTrackingPerTxnLine === false;
    const locOff = ai.TrackDepartments === false;

    const accounts = await loadAccountsFromDb(admin, clientId);
    let accountsQueried = false;
    if (accounts.size === 0) {
      await queryAccounts(ctx, base, realm, accounts, clientId);
      accountsQueried = true;
    }
    const vendors = action === "pull" ? await loadVendors(ctx, base, realm, clientId) : null;

    const gl = await pullGl(ctx, base, realm, w, basis);

    if (!accountsQueried && gl.rows.some((r) => r.acct_id && !accounts.has(r.acct_id))) {
      await queryAccounts(ctx, base, realm, accounts, clientId);
    }

    let clearedByKey: Map<string, string> | null = null;
    let clearedAvailable = gl.has.cleared;
    if (!clearedAvailable && action === "pull" && gl.chunks.length) {
      try {
        clearedByKey = await pullClearedFallback(ctx, base, realm, gl.chunks);
        clearedAvailable = true;
      } catch (e) {
        if (isAuthFailure(e)) throw e;
        console.log(`${TAG}: cleared fallback failed for client ${clientId}: ${(e as Error).message}`);
      }
    }

    const lines = buildLines(gl.rows, accounts, vendors, clearedByKey);
    const capturedBy = `staff:${email}`.slice(0, 200);

    // ---- baseline: store the closed-month snapshot, then finish.
    if (action === "baseline") {
      const ym = w.start.slice(0, 7);
      const [p] = await monthPrints(lines, basis, [ym]);
      const { data: baselineId, error: be } = await admin.rpc("gl_review_store_baseline", {
        p_client_id: clientId,
        p_period: w.start,
        p_basis: basis,
        p_line_count: p.line_count,
        p_debit_total: p.debit_total,
        p_hash: p.hash,
        p_lines: baselineLines(lines, ym),
        p_captured_by: capturedBy,
      });
      if (be) {
        console.log(`${TAG}: store_baseline failed for client ${clientId} ${ym}: ${be.message}`);
        await finish("error", null, "Snapshot not saved");
        return json({ status: "error", error: "The month's snapshot couldn't be saved. Check the month is still Done and try again." });
      }
      await finish("ok", lines.length, null);
      const { error: pe } = await admin.rpc("gl_review_record_prints", {
        p_client_id: clientId,
        p_prints: [{ period: p.period, basis: p.basis, line_count: p.line_count, debit_total: p.debit_total, hash: p.hash }],
        p_captured_by: capturedBy,
      });
      if (pe) console.log(`${TAG}: record_prints failed for client ${clientId}: ${pe.message}`);
      console.log(`${TAG}: client ${clientId} baseline ${ym} ok — ${lines.length} lines, ${ctx.calls} calls, ${gl.chunks.length} chunks`);
      return json({
        status: "ok",
        pull_id: pullId,
        pulled_at: pulledAt,
        basis,
        window: w,
        period: w.start,
        baseline_id: baselineId ?? null,
        line_count: p.line_count,
        debit_total: p.debit_total,
        hash: p.hash,
        calls: ctx.calls,
      });
    }

    // ---- pull
    await finish("ok", lines.length, null);

    // Month fingerprints for the months this window covers completely.
    let printsRecorded: number | null = null;
    try {
      const prints = await monthPrints(lines, basis, coveredMonths(w, today));
      const { data: n, error: pe } = await admin.rpc("gl_review_record_prints", {
        p_client_id: clientId,
        p_prints: prints.map((p) => ({ period: p.period, basis: p.basis, line_count: p.line_count, debit_total: p.debit_total, hash: p.hash })),
        p_captured_by: capturedBy,
      });
      if (pe) console.log(`${TAG}: record_prints failed for client ${clientId}: ${pe.message}`);
      else printsRecorded = typeof n === "number" ? n : null;
    } catch (e) {
      console.log(`${TAG}: fingerprints failed for client ${clientId}: ${(e as Error).message}`);
    }

    // Spec 4.5 (a): Done months in the window with no baseline (the app's
    // call right after Done was missed) get one from the last print taken
    // before Done. Best effort.
    try {
      const { data: closed } = await admin.from("month_close").select("period")
        .eq("client_id", clientId).eq("status", "done").gte("period", w.start).lte("period", w.end);
      const periods = (closed || []).map((r: any) => String(r.period).slice(0, 10));
      if (periods.length) {
        const { data: have } = await admin.from("gl_review_month_prints").select("period")
          .eq("client_id", clientId).eq("kind", "baseline").in("period", periods);
        const got = new Set((have || []).map((r: any) => String(r.period).slice(0, 10)));
        for (const p of periods.filter((x) => !got.has(x)).slice(0, 24)) {
          const { error: fe } = await admin.rpc("gl_review_baseline_from_last_print", { p_client_id: clientId, p_period: p });
          if (fe) console.log(`${TAG}: baseline fallback ${p} failed for client ${clientId}: ${fe.message}`);
        }
      }
    } catch (e) {
      console.log(`${TAG}: baseline fallback failed for client ${clientId}: ${(e as Error).message}`);
    }

    console.log(
      `${TAG}: client ${clientId} pull ${w.kind} ok — ${lines.length} lines, ${ctx.calls} calls, ` +
        `${gl.chunks.length} chunks, basis ${basis}, prints ${printsRecorded ?? "?"}`,
    );
    return json({
      status: "ok",
      pull_id: pullId,
      pulled_at: pulledAt,
      basis,
      window: w,
      lines,
      vendors_loaded: vendors !== null,
      vendor_count: vendors ? vendors.size : 0,
      cleared_available: clearedAvailable,
      class_tracking: gl.has.cls && !classOff,
      location_tracking: gl.has.loc && !locOff,
      calls: ctx.calls,
      prints_recorded: printsRecorded,
    });
  } catch (e) {
    const msg = friendly(e);
    // Our own strings only: IntuitError carries status + intuit_tid, never a body.
    console.log(`${TAG}: client ${clientId} ${action} failed — ${(e as Error)?.message || e}`);
    // Same as qbo-sync: a 401 (refresh refused / token rejected) sends the
    // connection to 'error' so the Reconnect UI takes over. Not TokenBusyError.
    if (e instanceof IntuitError && e.status === 401) await flagReconnect(admin, clientId, e, TAG);
    // This connection's environment has no keys configured: names only.
    if (e instanceof QboKeysMissingError) await flagKeysMissing(admin, clientId, e, TAG);
    if (!finished) await finish("error", null, msg);
    return json({ status: "error", error: msg });
  } finally {
    await meterUsage(admin, SOURCE, ctx.calls);
  }
});
