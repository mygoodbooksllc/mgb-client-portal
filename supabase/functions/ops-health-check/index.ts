import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { emailConfigured, esc, sendEmail } from "../_shared/email.ts";
import * as L from "../_shared/layout.ts";

// Internal health check (supabase/ops-alerting.sql has the design + schema).
//
// Every 15 minutes pg_cron POSTs here with the Vault-held qbo_cron_key. This
// asks ops_health_plan() what's wrong right now (QuickBooks syncs failing
// twice in a row or 2x overdue for the plan, connections needing a reconnect,
// the qbo-sync cron not running, the Intuit usage hard stop, 3+ failed emails
// in the last hour) and emails ALERT_TO straight away. ops_alert_state
// de-duplicates: at most one email per problem per 24 hours, plus one
// "resolved" note when an alerted problem clears. Test clients never page.
//
// Callers / auth (verify_jwt is OFF; these checks are the gate):
//   (a) machine: the qbo_cron_key or service_role key as bearer.
//         body {"dry_run": true} -> returns the current problems; sends and
//                                   records nothing
//         otherwise              -> the real check
//   (b) an active ADMIN's own JWT: dry run only (?dry_run=1 implied).
//
// Nothing is marked as sent unless Resend accepted the email, so a failed
// send is retried on the next tick.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const APP_URL = "https://app.mygoodbooks.org";
const ALERT_TO = ["admin@mygoodbooks.org"];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
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

function when(iso: string | null | undefined): string {
  if (!iso) return "–";
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }) + " CT";
}

type Alert = { key: string; title: string; detail: string | null; first_seen_at: string; reminder: boolean };
type Resolved = { key: string; title: string; first_seen_at: string; resolved_at: string };

function render(alerts: Alert[], resolved: Resolved[], open: number) {
  const subject = alerts.length
    ? `MyGoodBooks alert: ${alerts.length === 1 ? alerts[0].title : `${alerts.length} problems need attention`}`
    : `MyGoodBooks: resolved – ${resolved.length === 1 ? resolved[0].title : `${resolved.length} problems cleared`}`;

  let cards = "";
  if (alerts.length) {
    const rows = alerts.map((a) =>
      `<b>${L.tone(esc(a.title), "bad")}</b><br>` +
      (a.detail ? `${esc(a.detail)}<br>` : "") +
      L.tone(`First seen ${esc(when(a.first_seen_at))}${a.reminder ? " · still happening (daily reminder)" : ""}`, "muted")
    );
    cards += L.card(L.heading("Needs attention now") + L.ruledList(rows), { padding: "24px 24px 4px 24px" });
  }
  if (resolved.length) {
    const rows = resolved.map((r) =>
      `<b>${L.tone(esc(r.title), "good")}</b><br>` +
      L.tone(`Cleared ${esc(when(r.resolved_at))} (first seen ${esc(when(r.first_seen_at))})`, "muted")
    );
    cards += L.card(L.heading("Resolved") + L.ruledList(rows), { padding: "24px 24px 4px 24px" });
  }
  cards += L.card(
    L.p(
      `${open ? `${open} problem${open === 1 ? "" : "s"} open right now. ` : "Nothing else is open right now. "}` +
        `QuickBooks syncs are on each client's page in the app; ` +
        L.link(`${APP_URL}/#/home`, "open the app &rarr;"),
      { size: 13.5, margin: "4px 0 12px 0" },
    ),
    { padding: "16px 24px 8px 24px" },
  );

  const html = L.emailDocument({
    title: subject,
    preheader: alerts.length ? alerts.map((a) => a.title).join(" · ") : resolved.map((r) => r.title).join(" · "),
    subtitle: "Health check",
    cards,
    footer:
      "Internal health check, every 15 minutes. At most one email per problem per 24 hours, plus a note when it clears. " +
      "Test clients are excluded. It can't see Supabase itself being down; the external uptime monitor covers that.",
  });

  const text = [
    subject,
    "",
    ...(alerts.length
      ? ["NEEDS ATTENTION NOW", ...alerts.map((a) =>
        `- ${a.title}\n  ${a.detail || ""}\n  First seen ${when(a.first_seen_at)}${a.reminder ? " (still happening, daily reminder)" : ""}`
      ), ""]
      : []),
    ...(resolved.length
      ? ["RESOLVED", ...resolved.map((r) => `- ${r.title} (cleared ${when(r.resolved_at)})`), ""]
      : []),
    `Open the app: ${APP_URL}/#/home`,
    "Internal health check, every 15 minutes. At most one email per problem per 24 hours. Test clients are excluded.",
  ].join("\n");

  return { subject, html, text };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const authHeader = req.headers.get("Authorization") || "";
  const presented = authHeader.replace(/^Bearer\s+/i, "");
  if (!presented) return json({ error: "unauthorized" }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const url = new URL(req.url);
  let body: any = {};
  if (req.method === "POST") {
    try {
      body = await req.json();
    } catch (_e) {
      body = {};
    }
  }

  let isMachine = secretsMatch(presented, SERVICE_ROLE_KEY);
  if (!isMachine) {
    const { data: cronKey } = await admin.rpc("qbo_cron_key");
    isMachine = typeof cronKey === "string" && cronKey.length > 0 && secretsMatch(presented, cronKey);
  }
  let dryRun = url.searchParams.get("dry_run") === "1" || body?.dry_run === true;
  if (!isMachine) {
    const asUser = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: userRes, error: userErr } = await asUser.auth.getUser();
    if (userErr || !userRes?.user?.email) return json({ error: "unauthorized" }, 401);
    const { data: isAdmin, error: rpcErr } = await asUser.rpc("is_active_staff_admin");
    if (rpcErr || isAdmin !== true) return json({ error: "forbidden" }, 403);
    dryRun = true;
  }

  if (dryRun) {
    const { data, error } = await admin.rpc("ops_health_problems");
    if (error) return json({ status: "error", error: error.message }, 500);
    const { data: state } = await admin.from("ops_alert_state").select("*").order("first_seen_at", { ascending: false }).limit(50);
    return json({ status: "dry_run", problems: data || [], state: state || [], recipients: ALERT_TO, email_configured: emailConfigured() });
  }

  const { data: plan, error: planErr } = await admin.rpc("ops_health_plan");
  if (planErr || !plan) {
    console.log(`ops-health-check: could not evaluate — ${planErr?.message || "no data"}`);
    return json({ status: "error", error: planErr?.message || "no data" }, 500);
  }
  const alerts: Alert[] = plan.alerts || [];
  const resolved: Resolved[] = plan.resolved || [];
  if (!alerts.length && !resolved.length) {
    return json({ status: "ok", open: plan.open || 0, sent: false });
  }

  const email = render(alerts, resolved, Number(plan.open || 0));
  const sent = await sendEmail({
    to: ALERT_TO,
    subject: email.subject,
    html: email.html,
    text: email.text,
    tags: [{ name: "kind", value: "ops_health_alert" }],
  });
  if (!sent.ok) {
    // Not marked: the next tick retries.
    console.log(`ops-health-check: send failed — ${sent.error}`);
    return json({ status: "send_failed", error: sent.error, alerts: alerts.length, resolved: resolved.length }, 502);
  }
  const { error: markErr } = await admin.rpc("ops_health_mark", {
    p_alerted: alerts.map((a) => a.key),
    p_resolved: resolved.map((r) => r.key),
  });
  if (markErr) console.log(`ops-health-check: sent but could not record — ${markErr.message}`);
  console.log(`ops-health-check: sent ${alerts.length} alert(s), ${resolved.length} resolved`);
  return json({ status: "sent", id: sent.id, alerts: alerts.map((a) => a.key), resolved: resolved.map((r) => r.key) });
});
