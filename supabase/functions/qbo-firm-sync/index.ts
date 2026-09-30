import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Pulls QuickBooks Time hours out of MyGoodBooks' OWN QuickBooks Online
// company (the "firm" connection, qbo_firm_connection — see
// supabase/qbo-firm-time.sql for the whole design) into qbo_time_activities,
// and keeps the customer->client and employee/vendor->staff map tables
// current. It also replaces qbo_firm_invoices with the firm's open invoices
// (Balance > 0) for the weekly admin digest (supabase/weekly-digest.sql).
// The per-client qbo-sync function is untouched; this is separate so
// the client sync, its cron and its plan schedule never see the firm company.
//
// Two callers, two auth modes (same shape as qbo-sync):
//   (a) pg_cron/pg_net every 10 minutes (job 'qbo-firm-sync'), or the
//       qbo_firm_sync_now() RPC, presenting the Vault-held cron key (or the
//       service_role key) as bearer. Body {"force": true} skips the "due"
//       check (the RPC sends it); otherwise it only syncs when the last good
//       sync is SYNC_INTERVAL_MS old, or never happened.
//   (b) an active ADMIN's own Supabase JWT (supabase.functions.invoke
//       ('qbo-firm-sync')). Checked as the user via is_active_staff_admin();
//       anyone else gets 403. Always forced, synchronous result.
// Both: one sync at a time (sync_started_at lock), and a forced sync inside
// 60 seconds of a good one returns "fresh" without phoning Intuit.
//
// Intuit usage guard (supabase/qbo-usage-guard.sql): every Accounting API
// call is counted into qbo_api_usage (source 'qbo-firm-sync') once per
// request, and an unforced cron run is skipped ("usage_stopped") once the
// month's calls pass the hard stop. Forced and admin runs still go.
//
// Response: { status: "ok" | "fresh" | "in_progress" | "not_due" |
//             "not_connected" | "usage_stopped" | "error", synced_at?,
//             error?, counts? }
//
// verify_jwt must be OFF (the cron caller has no Supabase session); the
// bearer checks below are the gate. Never logs Intuit response bodies or any
// token — status codes, counts and intuit_tid only (Intuit review rule, same
// as qbo-sync). Self-contained on purpose: Supabase deploys each function
// independently.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const QBO_CLIENT_ID = Deno.env.get("QBO_CLIENT_ID")!;
const QBO_CLIENT_SECRET = Deno.env.get("QBO_CLIENT_SECRET")!;
const QBO_TOKEN_ENCRYPTION_KEY = Deno.env.get("QBO_TOKEN_ENCRYPTION_KEY")!;

const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const PROD_BASE = "https://quickbooks.api.intuit.com";
const SANDBOX_BASE = "https://sandbox-quickbooks.api.intuit.com";
const MINOR_VERSION = "75";

const REFRESH_AHEAD_MS = 10 * 60 * 1000;
const SYNC_INTERVAL_MS = 55 * 60 * 1000; // cron fires every 10 min; sync ~hourly
const MIN_FORCED_INTERVAL_MS = 60 * 1000;
const LOCK_STALE_MS = 10 * 60 * 1000;
const FULL_EVERY_MS = 7 * 24 * 60 * 60 * 1000; // weekly 13-month pass
const FULL_MONTHS = 13;
const ROLLING_DAYS = 60;
const PAGE = 1000;
const MAX_PAGES = 100; // 100k rows: a safety stop, not an expected size

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function secretsMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

class IntuitError extends Error {
  status: number;
  tid: string | null;
  constructor(status: number, tid: string | null, what: string) {
    super(`${what} failed (${status})${tid ? ` — intuit_tid: ${tid}` : ""}`);
    this.status = status;
    this.tid = tid;
  }
}

// A 401-shaped failure with a plain message: flips the connection to 'error'
// so the admin UI shows Reconnect.
function authError(message: string, tid: string | null = null): IntuitError {
  const e = new IntuitError(401, tid, "auth");
  e.message = message;
  return e;
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function num(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}
function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}
function ts(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
function qEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

// ---------------------------------------------------------------------------
// Intuit HTTP
// ---------------------------------------------------------------------------
// Intuit Accounting API calls since the last flush (read-and-reset).
let INTUIT_CALLS = 0;

async function flushUsage(admin: any) {
  const n = INTUIT_CALLS;
  INTUIT_CALLS = 0;
  if (n <= 0) return;
  const { error } = await admin.rpc("qbo_usage_add", { p_source: "qbo-firm-sync", p_calls: n });
  if (error) {
    INTUIT_CALLS += n;
    console.log(`qbo-firm-sync: usage counter update failed: ${error.message}`);
  }
}

async function intuitGet(accessToken: string, url: string, what: string): Promise<any> {
  INTUIT_CALLS++;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  const tid = res.headers.get("intuit_tid");
  if (!res.ok) {
    // Drain without reading into anything we keep or log.
    await res.body?.cancel();
    throw new IntuitError(res.status, tid, what);
  }
  return await res.json();
}

function queryUrl(base: string, realmId: string, q: string): string {
  return `${base}/v3/company/${realmId}/query?query=${encodeURIComponent(q)}&minorversion=${MINOR_VERSION}`;
}

// Runs `select * from <Entity> <where>` page by page (STARTPOSITION is
// 1-based) until a short page. Deduped by Id in case Intuit's paging shifts
// under a concurrent edit.
async function queryAll(
  accessToken: string,
  base: string,
  realmId: string,
  entity: string,
  where: string,
): Promise<any[]> {
  const out: any[] = [];
  const seen = new Set<string>();
  for (let page = 0; page < MAX_PAGES; page++) {
    const start = page * PAGE + 1;
    const q = `select * from ${entity}${where ? ` ${where}` : ""} startposition ${start} maxresults ${PAGE}`;
    const res = await intuitGet(accessToken, queryUrl(base, realmId, q), `${entity} query`);
    const rows: any[] = res?.QueryResponse?.[entity] || [];
    for (const r of rows) {
      const id = String(r?.Id ?? "");
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(r);
    }
    if (rows.length < PAGE) return out;
  }
  throw new Error(`${entity} query exceeded ${MAX_PAGES * PAGE} rows`);
}

// ---------------------------------------------------------------------------
// Tokens (qbo_firm_get_tokens / qbo_firm_store_tokens, service_role only)
// ---------------------------------------------------------------------------
async function getAccessToken(admin: any): Promise<string> {
  const { data: rows, error } = await admin.rpc("qbo_firm_get_tokens", {
    p_key: QBO_TOKEN_ENCRYPTION_KEY,
  });
  const row = rows?.[0];
  if (error || !row?.access_token) throw authError("no stored QuickBooks tokens");

  const expiresAtMs = row.expires_at ? new Date(row.expires_at).getTime() : 0;
  if (expiresAtMs - Date.now() > REFRESH_AHEAD_MS) return row.access_token;
  if (!row.refresh_token) throw authError("no refresh token on file");

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${QBO_CLIENT_ID}:${QBO_CLIENT_SECRET}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: row.refresh_token }),
  });
  const tid = res.headers.get("intuit_tid");
  if (!res.ok) {
    await res.body?.cancel();
    throw new IntuitError(401, tid, "token refresh");
  }
  const tokens = await res.json();
  // Intuit rotates the refresh token; store the new one before anything else.
  const { error: storeErr } = await admin.rpc("qbo_firm_store_tokens", {
    p_access_token: tokens.access_token,
    p_refresh_token: tokens.refresh_token,
    p_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    p_key: QBO_TOKEN_ENCRYPTION_KEY,
  });
  if (storeErr) throw new Error("could not store refreshed QuickBooks tokens");
  console.log(`qbo-firm-sync: refreshed token${tid ? ` (intuit_tid: ${tid})` : ""}`);
  return tokens.access_token;
}

// ---------------------------------------------------------------------------
// Row shaping
// ---------------------------------------------------------------------------

// Duration of one TimeActivity in whole minutes. Intuit sends either
// Hours/Minutes(/Seconds) or StartTime/EndTime with an optional break.
function activityMinutes(ta: any): number {
  if (ta.Hours != null || ta.Minutes != null) {
    return Math.max(0, Math.round(num(ta.Hours) * 60 + num(ta.Minutes) + num(ta.Seconds) / 60));
  }
  const start = ta.StartTime ? new Date(ta.StartTime).getTime() : NaN;
  const end = ta.EndTime ? new Date(ta.EndTime).getTime() : NaN;
  if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
    const breakMin =
      num(ta.BreakHours) * 60 + num(ta.BreakMinutes) + num(ta.BreakSeconds) / 60;
    return Math.max(0, Math.round((end - start) / 60000 - breakMin));
  }
  return 0;
}

function timeRow(realmId: string, ta: any) {
  const nameOf = str(ta.NameOf) || (ta.VendorRef ? "Vendor" : ta.EmployeeRef ? "Employee" : null);
  const isVendor = nameOf === "Vendor";
  return {
    realm_id: realmId,
    qbo_id: String(ta.Id),
    txn_date: str(ta.TxnDate)?.slice(0, 10) ?? null,
    name_of: nameOf,
    employee_qbo_id: !isVendor ? str(ta.EmployeeRef?.value) : null,
    employee_name: !isVendor ? str(ta.EmployeeRef?.name) : null,
    vendor_qbo_id: isVendor ? str(ta.VendorRef?.value) : null,
    vendor_name: isVendor ? str(ta.VendorRef?.name) : null,
    customer_qbo_id: str(ta.CustomerRef?.value),
    customer_name: str(ta.CustomerRef?.name),
    minutes: activityMinutes(ta),
    billable_status: str(ta.BillableStatus),
    hourly_rate: ta.HourlyRate != null && ta.HourlyRate !== "" ? num(ta.HourlyRate) : null,
    description: str(ta.Description),
    item_qbo_id: str(ta.ItemRef?.value),
    item_name: str(ta.ItemRef?.name),
    start_time: ts(ta.StartTime),
    end_time: ts(ta.EndTime),
    qbo_last_updated: ts(ta.MetaData?.LastUpdatedTime),
  };
}

// ---------------------------------------------------------------------------
// The sync
// ---------------------------------------------------------------------------
async function syncFirm(admin: any, conn: any, trigger: string) {
  const startedAt = new Date().toISOString();
  const counts: Record<string, number> = {};
  const realmId: string = conn.realm_id;
  const now = new Date();
  const full =
    !conn.last_full_sync_at ||
    now.getTime() - new Date(conn.last_full_sync_at).getTime() >= FULL_EVERY_MS;
  const from = full
    ? isoDay(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - FULL_MONTHS, 1)))
    : isoDay(new Date(now.getTime() - ROLLING_DAYS * 86400000));

  await admin
    .from("qbo_firm_connection")
    .update({ last_attempt_at: startedAt })
    .eq("id", true);

  try {
    if (!realmId) throw authError("the firm connection has no realm");
    const accessToken = await getAccessToken(admin);

    // Host: known api_env, else probe with CompanyInfo (production first).
    const companyPath = `/v3/company/${realmId}/companyinfo/${realmId}?minorversion=${MINOR_VERSION}`;
    let base = conn.api_env === "sandbox" ? SANDBOX_BASE : conn.api_env === "production" ? PROD_BASE : "";
    let company: any;
    if (base) {
      company = await intuitGet(accessToken, base + companyPath, "CompanyInfo");
    } else {
      try {
        company = await intuitGet(accessToken, PROD_BASE + companyPath, "CompanyInfo");
        base = PROD_BASE;
      } catch (e) {
        if (!(e instanceof IntuitError)) throw e;
        try {
          company = await intuitGet(accessToken, SANDBOX_BASE + companyPath, "CompanyInfo");
          base = SANDBOX_BASE;
        } catch (e2) {
          if (!(e2 instanceof IntuitError)) throw e2;
          const authish = (s: number) => s === 401 || s === 403;
          if (authish(e.status) && authish(e2.status)) throw authError(`QuickBooks rejected the token (production: ${e.status}, sandbox: ${e2.status})`, e2.tid);
          throw e;
        }
      }
    }
    const companyName = str(company?.CompanyInfo?.CompanyName) || str(company?.CompanyInfo?.LegalName);

    // --- TimeActivity ---------------------------------------------------------
    const activities = await queryAll(
      accessToken, base, realmId, "TimeActivity", `where TxnDate >= '${from}'`,
    );
    const timeRows = activities
      .map((ta) => timeRow(realmId, ta))
      .filter((r) => r.txn_date && r.txn_date >= from);
    counts.time_activities = timeRows.length;

    // --- Customers (incl. inactive, jobs carry ParentRef) --------------------
    const customers = await queryAll(
      accessToken, base, realmId, "Customer", "where Active in (true, false)",
    );
    const customerRows = customers.map((c: any) => ({
      qbo_customer_id: String(c.Id),
      customer_name: str(c.DisplayName),
      company_name: str(c.CompanyName),
      fully_qualified_name: str(c.FullyQualifiedName),
      parent_qbo_id: str(c.ParentRef?.value),
      is_job: c.Job === true || !!c.ParentRef?.value,
      active: c.Active !== false,
    }));
    // Customers referenced by time but not returned (shouldn't happen, but a
    // name is better than an orphan id in the map UI).
    const knownCustomers = new Set(customerRows.map((c) => c.qbo_customer_id));
    for (const r of timeRows) {
      if (r.customer_qbo_id && !knownCustomers.has(r.customer_qbo_id)) {
        knownCustomers.add(r.customer_qbo_id);
        customerRows.push({
          qbo_customer_id: r.customer_qbo_id,
          customer_name: r.customer_name,
          company_name: null,
          fully_qualified_name: r.customer_name,
          parent_qbo_id: null,
          is_job: false,
          active: true,
        });
      }
    }

    // --- Employees (all) + Vendors (only those on timesheets) ---------------
    const employees = await queryAll(
      accessToken, base, realmId, "Employee", "where Active in (true, false)",
    );
    const people: any[] = employees.map((e: any) => ({
      qbo_entity_type: "Employee",
      qbo_id: String(e.Id),
      display_name: str(e.DisplayName) || [str(e.GivenName), str(e.FamilyName)].filter(Boolean).join(" ") || null,
      qbo_email: str(e.PrimaryEmailAddr?.Address),
      active: e.Active !== false,
    }));
    const vendorIds = [...new Set(timeRows.map((r) => r.vendor_qbo_id).filter(Boolean) as string[])];
    for (let i = 0; i < vendorIds.length; i += 100) {
      const ids = vendorIds.slice(i, i + 100).map((id) => `'${qEscape(id)}'`).join(", ");
      const vendors = await queryAll(accessToken, base, realmId, "Vendor", `where Id in (${ids})`);
      for (const v of vendors) {
        people.push({
          qbo_entity_type: "Vendor",
          qbo_id: String(v.Id),
          display_name: str(v.DisplayName),
          qbo_email: str(v.PrimaryEmailAddr?.Address),
          active: v.Active !== false,
        });
      }
    }
    const knownPeople = new Set(people.map((p) => `${p.qbo_entity_type}:${p.qbo_id}`));
    for (const r of timeRows) {
      const type = r.vendor_qbo_id ? "Vendor" : r.employee_qbo_id ? "Employee" : null;
      const id = r.vendor_qbo_id || r.employee_qbo_id;
      if (!type || !id || knownPeople.has(`${type}:${id}`)) continue;
      knownPeople.add(`${type}:${id}`);
      people.push({
        qbo_entity_type: type,
        qbo_id: id,
        display_name: r.vendor_name || r.employee_name,
        qbo_email: null,
        active: true,
      });
    }

    // --- Writes: maps first (so auto-match is ready), then the time window ---
    const c1 = await admin.rpc("qbo_firm_upsert_customers", { p_realm_id: realmId, p_rows: customerRows });
    if (c1.error) throw new Error(`customers: ${c1.error.message}`);
    counts.customers = typeof c1.data === "number" ? c1.data : customerRows.length;

    const c2 = await admin.rpc("qbo_firm_upsert_people", { p_realm_id: realmId, p_rows: people });
    if (c2.error) throw new Error(`people: ${c2.error.message}`);
    counts.people = typeof c2.data === "number" ? c2.data : people.length;

    const c3 = await admin.rpc("qbo_firm_replace_time_window", {
      p_realm_id: realmId,
      p_from: from,
      p_rows: timeRows,
    });
    if (c3.error) throw new Error(`time activities: ${c3.error.message}`);

    // --- Open invoices (weekly admin digest "late payers") -------------------
    // Best effort: a failure here is recorded in counts but never fails the
    // time sync above. Whole set replaced each run (paid invoices drop out).
    try {
      const invoices = await queryAll(accessToken, base, realmId, "Invoice", "where Balance > '0'");
      const invoiceRows = invoices.map((inv: any) => ({
        qbo_id: String(inv.Id),
        customer_qbo_id: str(inv.CustomerRef?.value),
        customer_name: str(inv.CustomerRef?.name),
        doc_number: str(inv.DocNumber),
        txn_date: str(inv.TxnDate)?.slice(0, 10) ?? null,
        due_date: str(inv.DueDate)?.slice(0, 10) ?? str(inv.TxnDate)?.slice(0, 10) ?? null,
        total_amt: num(inv.TotalAmt),
        balance: num(inv.Balance),
      }));
      const c4 = await admin.rpc("qbo_firm_replace_invoices", { p_realm_id: realmId, p_rows: invoiceRows });
      if (c4.error) throw new Error(c4.error.message);
      counts.open_invoices = invoiceRows.length;
    } catch (invErr) {
      counts.open_invoices_failed = 1;
      console.log(`qbo-firm-sync: open invoices skipped — ${(invErr as Error).message}`);
    }

    const syncedAt = new Date().toISOString();
    await admin.from("qbo_firm_sync_runs").insert({
      realm_id: realmId,
      started_at: startedAt,
      finished_at: syncedAt,
      status: "ok",
      window_from: from,
      full_window: full,
      trigger,
      counts,
    });
    const update: Record<string, unknown> = {
      status: "connected",
      last_synced_at: syncedAt,
      last_error: null,
      updated_at: syncedAt,
    };
    if (base) update.api_env = base === PROD_BASE ? "production" : "sandbox";
    if (companyName) update.company_name = companyName;
    if (full) update.last_full_sync_at = syncedAt;
    // neq: an admin who pressed Disconnect mid-run stays disconnected.
    await admin.from("qbo_firm_connection").update(update).eq("id", true).neq("status", "disconnected");

    console.log(`qbo-firm-sync: ok (${full ? "full" : "rolling"} from ${from}) ${JSON.stringify(counts)}`);
    return { status: "ok", synced_at: syncedAt, counts, window_from: from, full_window: full };
  } catch (e) {
    const err = e as Error;
    const detail = err.message || "sync failed";
    await admin.from("qbo_firm_sync_runs").insert({
      realm_id: realmId ?? null,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      status: "error",
      window_from: from,
      full_window: full,
      trigger,
      detail,
      counts,
    });
    const authFailure = e instanceof IntuitError && e.status === 401;
    await admin
      .from("qbo_firm_connection")
      .update({
        ...(authFailure ? { status: "error" } : {}),
        last_error: authFailure
          ? `QuickBooks rejected the firm connection — please reconnect. (${detail})`
          : detail,
        updated_at: new Date().toISOString(),
      })
      .eq("id", true)
      .neq("status", "disconnected");
    console.log(`qbo-firm-sync: failed — ${detail}`);
    return { status: "error", error: detail, synced_at: conn.last_synced_at ?? null };
  }
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
  const authHeader = req.headers.get("Authorization") || "";
  const presented = authHeader.replace(/^Bearer\s+/i, "");
  if (!presented) return json({ error: "unauthorized" }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  let body: any = {};
  try {
    body = await req.json();
  } catch (_e) {
    body = {};
  }

  let isMachine = secretsMatch(presented, SERVICE_ROLE_KEY);
  if (!isMachine) {
    const { data: cronKey } = await admin.rpc("qbo_cron_key");
    isMachine = typeof cronKey === "string" && cronKey.length > 0 && secretsMatch(presented, cronKey);
  }

  let force = false;
  let trigger = "cron";
  if (isMachine) {
    force = body?.force === true;
    trigger = body?.trigger === "admin" ? "admin" : "cron";
  } else {
    // Mode (b): an admin's own JWT, checked as them.
    const asUser = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes, error: userErr } = await asUser.auth.getUser();
    if (userErr || !userRes?.user?.email) return json({ error: "unauthorized" }, 401);
    const { data: isAdmin, error: rpcErr } = await asUser.rpc("is_active_staff_admin");
    if (rpcErr || isAdmin !== true) return json({ error: "forbidden" }, 403);
    force = true;
    trigger = "admin";
  }

  const { data: conn, error: connErr } = await admin
    .from("qbo_firm_connection")
    .select("realm_id, status, api_env, last_synced_at, last_full_sync_at")
    .eq("id", true)
    .maybeSingle();
  if (connErr) return json({ error: "failed to read the firm connection" }, 500);
  // The cron only syncs a live connection; a forced (admin) run may retry one
  // sitting in 'error' — that's how an admin finds out a reconnect worked.
  if (!conn || conn.status === "disconnected" || (!force && conn.status !== "connected")) {
    return json({ status: "not_connected" });
  }

  const lastMs = conn.last_synced_at ? new Date(conn.last_synced_at).getTime() : 0;
  if (!force && lastMs && Date.now() - lastMs < SYNC_INTERVAL_MS) {
    return json({ status: "not_due", synced_at: conn.last_synced_at });
  }
  if (!force) {
    const { data: usage, error: usageErr } = await admin.rpc("qbo_usage_status");
    if (!usageErr && usage?.mode === "stopped") {
      return json({ status: "usage_stopped", synced_at: conn.last_synced_at });
    }
  }
  if (force && lastMs && Date.now() - lastMs < MIN_FORCED_INTERVAL_MS) {
    return json({ status: "fresh", synced_at: conn.last_synced_at });
  }

  // Lock: conditional UPDATE ... RETURNING; exactly one caller wins.
  const nowIso = new Date().toISOString();
  const staleIso = new Date(Date.now() - LOCK_STALE_MS).toISOString();
  const { data: locked, error: lockErr } = await admin
    .from("qbo_firm_connection")
    .update({ sync_started_at: nowIso })
    .eq("id", true)
    .or(`sync_started_at.is.null,sync_started_at.lt."${staleIso}"`)
    .select("realm_id");
  if (lockErr) return json({ error: "failed to take the sync lock" }, 500);
  if (!locked || !locked.length) {
    return json({ status: "in_progress", synced_at: conn.last_synced_at });
  }

  try {
    const result = await syncFirm(admin, conn, trigger);
    return json(result);
  } finally {
    await admin.from("qbo_firm_connection").update({ sync_started_at: null }).eq("id", true);
  }
}
