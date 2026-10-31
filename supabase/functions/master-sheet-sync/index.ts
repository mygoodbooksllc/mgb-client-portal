import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  FEE_COLUMN,
  FEE_HEADERS,
  SHEET_URL,
  TOKEN_URL,
  cronHoldReason,
  googleErrorMessage,
  normName,
  parseServiceAccount,
  planFingerprint,
  planSync,
  signServiceAccountJwt,
  valuesUrl,
} from "./logic.js";

// Master Data fee sync (docs/master-sheet-sync-spec.md, supabase/master-sheet-sync.sql).
// Reads the Clients tab of the MGB_Master_Data Google Sheet with a READ-ONLY
// service account and keeps client_fees in step. INTERNAL-ONLY.
//
// Callers / auth (verify_jwt is OFF; these checks are the gate):
//   (a) an admin with the MGB (internal) grant, with their own Supabase JWT:
//       can_view_internal() is called AS THEM (it includes is_active_staff_admin()
//       and the Google sign-in check). Anyone else gets 401/403 and nothing.
//         {action:"status"}   connected? service-account email, fee column
//         {action:"preview"}  dry run: reads the sheet, returns the plan, logs it
//         {action:"sync", fingerprint}  live: only when the plan still matches
//                             the preview the person saw
//   (b) pg_cron via master_sheet_cron_tick() with the Vault qbo_cron_key (or the
//       service role key): {trigger:"cron"} = live nightly run. It runs only
//       after a manual live run on the same fee column has succeeded, and holds
//       (writes nothing) when the plan has too many or too big changes.
//
// Secret GOOGLE_SA_KEY = the service account's JSON key (the owner sets it).
// Without it every run is logged "not_connected" and nothing changes.
// The only writer of fees is the SQL function master_sheet_apply() (service role).

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

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

function secretsMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function saInfo(): { connected: boolean; email: string | null; error: string | null; sa: any } {
  const raw = Deno.env.get("GOOGLE_SA_KEY");
  if (!raw) return { connected: false, email: null, error: null, sa: null };
  try {
    const sa = parseServiceAccount(raw);
    return { connected: true, email: sa.client_email, error: null, sa };
  } catch (e) {
    return { connected: false, email: null, error: (e as Error).message, sa: null };
  }
}

async function readSheet(sa: any): Promise<any[][]> {
  const assertion = await signServiceAccountJwt(sa, Math.floor(Date.now() / 1000));
  const tok = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  if (!tok.ok) throw new Error(googleErrorMessage(tok.status === 400 ? 401 : tok.status, sa.client_email));
  const { access_token } = await tok.json();
  if (!access_token) throw new Error(googleErrorMessage(401, sa.client_email));
  const res = await fetch(valuesUrl(), { headers: { Authorization: `Bearer ${access_token}` } });
  if (!res.ok) throw new Error(googleErrorMessage(res.status, sa.client_email));
  const body = await res.json();
  return Array.isArray(body?.values) ? body.values : [];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

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

  let requestedBy: string;
  let trigger: "manual" | "cron";
  if (isMachine) {
    trigger = "cron";
    requestedBy = "nightly";
  } else {
    const asUser = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: userRes, error: userErr } = await asUser.auth.getUser();
    if (userErr || !userRes?.user?.email) return json({ error: "unauthorized" }, 401);
    // Fail closed: any error means no access. can_view_internal() includes the admin check.
    const { data: internal, error: intErr } = await asUser.rpc("can_view_internal");
    if (intErr || internal !== true) return json({ error: "forbidden" }, 403);
    trigger = "manual";
    requestedBy = userRes.user.email;
  }

  const action: string = isMachine && body?.trigger === "cron" ? "sync" : String(body?.action || "status");
  if (!["status", "preview", "sync"].includes(action)) return json({ error: "unknown action" }, 400);

  const feeColumn = FEE_COLUMN;
  const info = saInfo();

  if (action === "status") {
    const { data: lastOk } = await admin
      .from("master_sheet_sync_runs")
      .select("id, started_at, fee_column")
      .eq("trigger", "manual")
      .eq("mode", "live")
      .eq("status", "ok")
      .order("started_at", { ascending: false })
      .limit(1);
    return json({
      connected: info.connected,
      key_error: info.error,
      service_account_email: info.email,
      fee_column: feeColumn,
      fee_header: (FEE_HEADERS as Record<string, string>)[feeColumn],
      sheet_url: SHEET_URL,
      nightly_ready: !!(lastOk && lastOk[0] && lastOk[0].fee_column === feeColumn),
    });
  }

  const mode = action === "preview" ? "dry_run" : "live";
  const startedAt = new Date().toISOString();
  const log = async (status: string, fields: Record<string, unknown> = {}) => {
    const { data, error } = await admin
      .from("master_sheet_sync_runs")
      .insert({
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        trigger,
        mode,
        status,
        requested_by: requestedBy,
        fee_column: feeColumn,
        ...fields,
      })
      .select("id")
      .single();
    if (error) console.error("master-sheet-sync: run log failed", error.message);
    return data?.id ?? null;
  };

  if (!info.connected) {
    const message = info.error || "Not connected yet: the GOOGLE_SA_KEY secret isn't set. Nothing was changed.";
    const runId = await log("not_connected", { message });
    return json({ status: "not_connected", message, run_id: runId });
  }

  // Nightly gate: needs a successful manual live run on this fee column first.
  if (trigger === "cron") {
    const { data: lastOk } = await admin
      .from("master_sheet_sync_runs")
      .select("id")
      .eq("trigger", "manual")
      .eq("mode", "live")
      .eq("status", "ok")
      .eq("fee_column", feeColumn)
      .limit(1);
    if (!lastOk || !lastOk.length) {
      const message = `Waiting for a first Sync now on the "${(FEE_HEADERS as Record<string, string>)[feeColumn]}" column. Nothing was changed.`;
      const runId = await log("skipped", { message });
      return json({ status: "skipped", message, run_id: runId });
    }
  }

  // Portal data (service role; the caller was already checked).
  const [cl, fe, mp] = await Promise.all([
    admin.from("clients").select("id, name, test_only, is_internal"),
    admin.from("client_fees").select("client_id, monthly_fee, sheet_override"),
    admin.from("master_sheet_client_map").select("sheet_key, sheet_name, client_id, ignored"),
  ]);
  if (cl.error || fe.error || mp.error) {
    const message = "Couldn't read the portal's clients or fees. Nothing was changed.";
    const runId = await log("error", { message, errors: 1 });
    return json({ status: "error", message, run_id: runId });
  }

  let values: any[][];
  try {
    values = await readSheet(info.sa);
  } catch (e) {
    const message = (e as Error).message || "Couldn't read the sheet.";
    const runId = await log("error", { message, errors: 1 });
    return json({ status: "error", message, run_id: runId });
  }

  const plan = planSync({ values, clients: cl.data, fees: fe.data, map: mp.data, feeColumn });
  if (plan.error) {
    const runId = await log("error", { message: plan.error, errors: 1 });
    return json({ status: "error", message: plan.error, run_id: runId });
  }
  const fingerprint = await planFingerprint(plan);
  const unmatchedRows = plan.unmatched.map((u: any) => ({
    sheet_key: normName(u.sheet_name),
    sheet_name: u.sheet_name,
    status: u.status,
    fee_text: u.fee_text,
    reason: u.reason,
  }));
  const counts = {
    rows_read: plan.counts.rows_read,
    updated: plan.counts.updated,
    unchanged: plan.counts.unchanged,
    unmatched: plan.counts.unmatched,
    skipped: plan.counts.skipped,
    errors: plan.counts.errors,
  };
  const planDetail = {
    changes: plan.changes,
    unmatched: plan.unmatched,
    skipped: plan.skipped,
    errors: plan.errors,
  };

  if (mode === "dry_run") {
    const runId = await log("ok", { ...counts, fingerprint, detail: planDetail, message: "Preview only. Nothing was changed." });
    return json({ status: "ok", mode, run_id: runId, fingerprint, counts, ...planDetail, unchanged: plan.unchanged.length });
  }

  if (trigger === "manual") {
    if (typeof body?.fingerprint !== "string" || body.fingerprint !== fingerprint) {
      const message = "The sheet or the portal changed since your preview. Preview again before syncing. Nothing was changed.";
      const runId = await log("changed_since_preview", { ...counts, updated: 0, fingerprint, detail: planDetail, message });
      return json({ status: "changed_since_preview", message, run_id: runId, fingerprint, counts, ...planDetail });
    }
  } else {
    const hold = cronHoldReason(plan);
    if (hold) {
      const runId = await log("held", { ...counts, updated: 0, fingerprint, detail: planDetail, message: `Held: ${hold} Nothing was changed.` });
      return json({ status: "held", message: hold, run_id: runId });
    }
  }

  // Live: log the run first, then apply in one transaction.
  const runId = await log("running", { ...counts, updated: 0, fingerprint });
  const { data: applied, error: applyErr } = await admin.rpc("master_sheet_apply", {
    p_run_id: runId,
    p_items: plan.items,
    p_unmatched: unmatchedRows,
    p_rebuild_unmatched: true,
  });
  const finishedAt = new Date().toISOString();
  if (applyErr || !applied) {
    console.error("master-sheet-sync: apply failed", applyErr?.message);
    const message = "Writing the fees failed. Nothing was changed.";
    if (runId) {
      await admin.from("master_sheet_sync_runs").update({ status: "error", finished_at: finishedAt, message, errors: counts.errors + 1, detail: planDetail }).eq("id", runId);
    }
    return json({ status: "error", message, run_id: runId });
  }
  const a = applied as any;
  const message =
    `${a.updated} fee(s) updated, ${a.unchanged} already matched` +
    (a.conflicts ? `, ${a.conflicts} left alone because the fee changed during the run` : "") +
    (counts.unmatched ? `, ${counts.unmatched} sheet row(s) need matching` : "") +
    ".";
  if (runId) {
    await admin
      .from("master_sheet_sync_runs")
      .update({
        status: "ok",
        finished_at: finishedAt,
        updated: a.updated,
        unchanged: a.unchanged,
        skipped: counts.skipped + (a.skipped || 0),
        conflicts: a.conflicts || 0,
        message,
        detail: { ...planDetail, changes: a.changes, conflicts: a.conflict_list },
      })
      .eq("id", runId);
  }
  return json({
    status: "ok",
    mode,
    run_id: runId,
    message,
    counts: { ...counts, updated: a.updated, unchanged: a.unchanged, conflicts: a.conflicts || 0 },
    changes: a.changes,
    conflicts: a.conflict_list,
    unmatched: plan.unmatched,
  });
});
