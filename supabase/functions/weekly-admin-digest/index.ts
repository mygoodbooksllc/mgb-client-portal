import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { defaultFrom, emailConfigured, esc, sendEmail } from "../_shared/email.ts";

// Weekly admin digest (supabase/weekly-digest.sql has the design + schema).
//
// Callers / auth (verify_jwt is OFF; these checks are the gate):
//   (a) pg_cron via digest_cron_tick() (hourly; it only calls at send_dow /
//       send_hour in digest_settings.timezone), presenting the Vault-held
//       qbo_cron_key (or the service_role key) as bearer. Body {"trigger":"cron"}.
//       Sends to digest_settings.recipients if enabled.
//   (b) an active ADMIN's own Supabase JWT (checked with is_active_staff_admin()):
//         ?preview=1 (or body {"preview": true})  -> returns the HTML, sends nothing
//         otherwise                               -> "Send test now": sends to the
//                                                    recipients even if disabled
//       Optional ?week_start=YYYY-MM-DD (a Monday) for either.
//
// Every run is logged in digest_runs. If RESEND_API_KEY is missing the send is
// skipped with status "not_configured". Numbers come from the service-role-only
// SQL function digest_weekly_data().

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const APP_URL = "https://app.mygoodbooks.org";

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

// ---------------------------------------------------------------------------
// Dates (all in the digest timezone)
// ---------------------------------------------------------------------------
function todayIn(tz: string): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date());
}
function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
// Monday of the week BEFORE the one containing `today`.
function lastWeekStart(today: string): string {
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay(); // 0 Sun .. 6 Sat
  const sinceMonday = (dow + 6) % 7;
  return addDays(today, -sinceMonday - 7);
}
function fmtDay(iso: string | null | undefined, withDow = false): string {
  if (!iso) return "–";
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00Z`);
  const md = d.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
  return withDow ? `${d.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short" })} ${md}` : md;
}
function fmtRange(ws: string, we: string): string {
  const a = new Date(`${ws}T12:00:00Z`);
  const b = new Date(`${we}T12:00:00Z`);
  const sameMonth = a.getUTCMonth() === b.getUTCMonth();
  const left = fmtDay(ws);
  const right = sameMonth ? String(b.getUTCDate()) : fmtDay(we);
  return `${left}–${right}, ${b.getUTCFullYear()}`;
}
function money(v: unknown, cents = false): string {
  const n = Number(v ?? 0);
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  });
}
function hrs(v: unknown): string {
  const n = Number(v ?? 0);
  return `${Number.isInteger(n) ? n : n.toFixed(1)}h`;
}
function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

// ---------------------------------------------------------------------------
// Rendering. Table layout + inline styles for Gmail/Outlook; 600px max, fluid
// below that. Plain-text alternative is built alongside.
// ---------------------------------------------------------------------------
const C = {
  ink: "#1f2a37",
  muted: "#6b7280",
  line: "#e5e7eb",
  bg: "#f4f5f7",
  card: "#ffffff",
  brand: "#1d6b52",
  warn: "#b45309",
  bad: "#b91c1c",
};
const FONT = "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;";

type Section = { title: string; html: string; text: string; link: { label: string; href: string } };

function tableHtml(head: string[], rows: string[][], alignRight: number[] = []): string {
  const th = head
    .map((h, i) =>
      `<th align="${alignRight.includes(i) ? "right" : "left"}" style="${FONT}font-size:11px;font-weight:600;color:${C.muted};text-transform:uppercase;letter-spacing:.04em;padding:6px 8px;border-bottom:1px solid ${C.line};">${esc(h)}</th>`
    )
    .join("");
  const tr = rows
    .map((r) =>
      `<tr>${r
        .map((cell, i) =>
          `<td align="${alignRight.includes(i) ? "right" : "left"}" style="${FONT}font-size:13px;color:${C.ink};padding:6px 8px;border-bottom:1px solid ${C.line};vertical-align:top;">${cell}</td>`
        )
        .join("")}</tr>`
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;"><tr>${th}</tr>${tr}</table>`;
}
function para(html: string, color = C.ink): string {
  return `<p style="${FONT}font-size:13px;line-height:1.5;color:${color};margin:6px 0;">${html}</p>`;
}
function empty(): string {
  return para("Nothing this week.", C.muted);
}
function textTable(rows: string[]): string {
  return rows.map((r) => `  - ${r}`).join("\n");
}

function buildSections(d: any): Section[] {
  const out: Section[] = [];
  const team = { label: "Open the Team page", href: `${APP_URL}/` };
  const firmOn = d.firm_qbo?.status === "connected" || d.firm_qbo?.status === "error";

  // 1. Scope creep
  {
    const rows: any[] = d.scope_creep || [];
    const html = rows.length
      ? tableHtml(
          ["Client", "Last week", "Typical week", "4-wk pace /mo", "3-mo avg /mo"],
          rows.map((r) => [
            esc(r.client_name),
            `<b style="color:${r.week_flag ? C.warn : C.ink};">${hrs(r.week_hours)}</b>`,
            hrs(r.base_week_hours),
            `<b style="color:${r.month_flag ? C.warn : C.ink};">${hrs(r.pace_month_hours)}</b>`,
            hrs(r.base_month_hours),
          ]),
          [1, 2, 3, 4],
        ) + para("Flagged at 1.5× the 3-month average and at least 2 hours more.", C.muted)
      : empty() + (firmOn ? "" : para("QuickBooks Time isn't connected, so there are no hours to compare.", C.muted));
    const text = rows.length
      ? textTable(rows.map((r) =>
        `${r.client_name}: ${hrs(r.week_hours)} last week (typical ${hrs(r.base_week_hours)}); 4-week pace ${hrs(r.pace_month_hours)}/mo vs ${hrs(r.base_month_hours)}/mo`
      ))
      : "  Nothing this week.";
    out.push({ title: "Scope creep", html, text, link: team });
  }

  // 2. Price review
  {
    const rows: any[] = d.price_review || [];
    const noFee = Number(d.price_review_no_fee_count || 0);
    let html = rows.length
      ? tableHtml(
          ["Client", "Fee /mo", "Cost /mo", "Margin", "Suggested fee"],
          rows.map((r) => [
            esc(r.client_name) + (r.estimated ? ` <span style="color:${C.muted};">(est.)</span>` : ""),
            money(r.monthly_fee),
            money(r.monthly_cost),
            `<b style="color:${Number(r.margin_pct) < 0 ? C.bad : C.warn};">${esc(r.margin_pct)}%</b>`,
            `<b>${money(r.suggested_fee)}</b>`,
          ]),
          [1, 2, 3, 4],
        )
      : empty();
    html += para(
      `Target margin ${esc(d.target_margin_pct)}%. Cost is the last 90 days of QuickBooks Time at each person's cost rate; suggested fee = cost ÷ (1 − target).` +
        (noFee ? ` ${plural(noFee, "client has", "clients have")} no fee set and ${noFee === 1 ? "isn't" : "aren't"} reviewed.` : "") +
        (d.price_review_has_rates ? "" : " No staff cost rates are set yet."),
      C.muted,
    );
    const text = (rows.length
      ? textTable(rows.map((r) =>
        `${r.client_name}: fee ${money(r.monthly_fee)}/mo, cost ${money(r.monthly_cost)}/mo, margin ${r.margin_pct}% -> suggest ${money(r.suggested_fee)}${r.estimated ? " (est.)" : ""}`
      ))
      : "  Nothing this week.") + (noFee ? `\n  ${plural(noFee, "client has", "clients have")} no fee set.` : "");
    out.push({ title: "Price review", html, text, link: team });
  }

  // 3. Revenue snapshot
  {
    const r = d.revenue || {};
    const added: any[] = r.added || [];
    const html = tableHtml(
      ["Monthly fees", "Active clients", "3-month projection"],
      [[`<b>${money(r.mrr)}</b>`, `<b>${esc(r.active_clients ?? 0)}</b>`, `<b>${money(r.projection_3m)}</b>`]],
    ) +
      para(
        (added.length ? `Added in the last 7 days: ${added.map((a) => esc(a.client_name)).join(", ")}.` : "No clients added in the last 7 days.") +
          ` ${esc(r.clients_with_fee ?? 0)} of ${esc(r.active_clients ?? 0)} clients have a fee set. Removed clients aren't tracked yet.`,
        C.muted,
      );
    const text =
      `  Monthly fees ${money(r.mrr)} · ${r.active_clients ?? 0} active clients · 3-month projection ${money(r.projection_3m)}\n` +
      `  ${added.length ? `Added: ${added.map((a) => a.client_name).join(", ")}` : "No clients added in the last 7 days."}`;
    out.push({ title: "Revenue snapshot", html, text, link: team });
  }

  // 4. Late payers
  {
    const rows: any[] = d.late_payers || [];
    const total = rows.reduce((s, r) => s + Number(r.balance || 0), 0);
    let html = rows.length
      ? tableHtml(
          ["Client", "Invoice", "Due", "Days late", "Balance"],
          rows.map((r) => [
            esc(r.client_name || r.customer_name || "–"),
            esc(r.doc_number || "–"),
            fmtDay(r.due_date),
            `<b style="color:${Number(r.days_overdue) > 30 ? C.bad : C.warn};">${esc(r.days_overdue)}</b>`,
            money(r.balance, true),
          ]),
          [3, 4],
        ) + para(`Total overdue: <b>${money(total, true)}</b>`)
      : empty();
    if (!d.invoices_synced_at) {
      html += para("Invoices haven't synced from the firm's QuickBooks yet.", C.muted);
    }
    const text = rows.length
      ? textTable(rows.map((r) =>
        `${r.client_name || r.customer_name}: #${r.doc_number || "–"} due ${fmtDay(r.due_date)}, ${r.days_overdue} days late, ${money(r.balance, true)}`
      )) + `\n  Total overdue: ${money(total, true)}`
      : "  Nothing this week.";
    out.push({ title: "Late payers", html, text, link: team });
  }

  // 5. Timesheet gaps
  {
    const rows: any[] = firmOn ? d.timesheet_gaps || [] : [];
    const html = !firmOn
      ? para("QuickBooks Time isn't connected, so timesheets can't be checked.", C.muted)
      : rows.length
      ? tableHtml(
          ["Person", "Weekdays with no QuickBooks time", "In app, no QuickBooks entry"],
          rows.map((r) => [
            esc(r.staff_name),
            (r.no_qbo_weekdays || []).map((x: string) => fmtDay(x, true)).join(", ") || "–",
            (r.app_without_qbo || []).map((x: any) => `${fmtDay(x.day, true)} (${x.app_minutes}m)`).join(", ") || "–",
          ]),
        )
      : empty();
    const text = !firmOn
      ? "  QuickBooks Time isn't connected."
      : rows.length
      ? textTable(rows.map((r) =>
        `${r.staff_name}: no QB time ${(r.no_qbo_weekdays || []).map((x: string) => fmtDay(x, true)).join(", ") || "–"}; app time without QB ${(r.app_without_qbo || []).map((x: any) => fmtDay(x.day, true)).join(", ") || "–"}`
      ))
      : "  Nothing this week.";
    out.push({ title: "Timesheet gaps", html, text, link: team });
  }

  // 6. Staff scorecard
  {
    const rows: any[] = d.scorecard || [];
    const html = rows.length
      ? tableHtml(
          ["Person", "QB hours", "Tasks done", "Open / overdue", "In app"],
          rows.map((r) => {
            const under = Number(r.qbo_hours) < Number(r.target_hours);
            return [
              esc(r.staff_name),
              `<b style="color:${under && firmOn ? C.warn : C.ink};">${hrs(r.qbo_hours)}</b> <span style="color:${C.muted};">/ ${hrs(r.target_hours)}</span>`,
              esc(r.tasks_done),
              `${esc(r.tasks_open)} / <span style="color:${Number(r.tasks_overdue) ? C.bad : C.ink};">${esc(r.tasks_overdue)}</span>`,
              hrs(r.app_hours),
            ];
          }),
          [1, 2, 3, 4],
        ) + para(`Target is each person's weekly capacity, or 35h where none is set${d.has_capacity_table ? "" : " (capacity isn't set up yet)"}.`, C.muted)
      : empty();
    const text = rows.length
      ? textTable(rows.map((r) =>
        `${r.staff_name}: ${hrs(r.qbo_hours)}/${hrs(r.target_hours)} QB, ${r.tasks_done} done, ${r.tasks_open} open (${r.tasks_overdue} overdue), ${hrs(r.app_hours)} in app`
      ))
      : "  Nothing this week.";
    out.push({ title: "Staff scorecard", html, text, link: team });
  }

  // 7. Stale clients
  {
    const stale: any[] = d.stale_clients || [];
    const errs: any[] = d.qbo_errors || [];
    let html = "";
    if (!stale.length && !errs.length) html = empty();
    if (stale.length) {
      html += tableHtml(
        ["No activity in 30 days", "Last in app", "Last QB time"],
        stale.map((r) => [esc(r.client_name), fmtDay(r.last_app_day), fmtDay(r.last_qbo_day)]),
      );
    }
    if (errs.length) {
      html += tableHtml(
        ["QuickBooks connection error", "Last synced"],
        errs.map((r) => [esc(r.client_name), fmtDay(r.last_synced_at)]),
      );
    }
    const lines = [
      ...stale.map((r) => `${r.client_name}: no activity in 30 days`),
      ...errs.map((r) => `${r.client_name}: QuickBooks connection error`),
    ];
    out.push({
      title: "Stale clients",
      html,
      text: lines.length ? textTable(lines) : "  Nothing this week.",
      link: { label: "Open the client list", href: `${APP_URL}/` },
    });
  }

  // 8. Pending
  {
    const p = d.pending || {};
    const reqs: any[] = p.access_requests || [];
    const items: string[] = [];
    const textItems: string[] = [];
    for (const r of reqs) {
      items.push(`Access request: <b>${esc(r.staff_name)}</b> → ${esc(r.client_name)} <span style="color:${C.muted};">(${fmtDay(r.requested_at)})</span>`);
      textItems.push(`Access request: ${r.staff_name} -> ${r.client_name}`);
    }
    if (Number(p.unmapped_customers)) {
      items.push(`${plural(Number(p.unmapped_customers), "QuickBooks customer")} with time but no client mapping`);
      textItems.push(`${plural(Number(p.unmapped_customers), "unmapped QuickBooks customer")}`);
    }
    if (Number(p.unmapped_people)) {
      items.push(`${plural(Number(p.unmapped_people), "QuickBooks person", "QuickBooks people")} with time but no staff mapping`);
      textItems.push(`${plural(Number(p.unmapped_people), "unmapped QuickBooks person", "unmapped QuickBooks people")}`);
    }
    if (d.firm_qbo?.status === "error") {
      items.push(`<span style="color:${C.bad};">The firm's QuickBooks connection needs reconnecting.</span>`);
      textItems.push("The firm's QuickBooks connection needs reconnecting.");
    }
    const html = items.length ? items.map((i) => para(`• ${i}`)).join("") : empty();
    out.push({ title: "Pending", html, text: textItems.length ? textTable(textItems) : "  Nothing this week.", link: team });
  }

  return out;
}

function headline(d: any): string[] {
  const bits: string[] = [];
  const late: any[] = d.late_payers || [];
  const lateTotal = late.reduce((s, r) => s + Number(r.balance || 0), 0);
  bits.push(`${money(d.revenue?.mrr)} monthly fees across ${plural(Number(d.revenue?.active_clients || 0), "active client")}`);
  if ((d.scope_creep || []).length) bits.push(`${plural(d.scope_creep.length, "client")} running over usual hours`);
  if ((d.price_review || []).length) bits.push(`${plural(d.price_review.length, "client")} below target margin`);
  if (late.length) bits.push(`${plural(late.length, "overdue invoice")} (${money(lateTotal)})`);
  const firmOn = d.firm_qbo?.status === "connected" || d.firm_qbo?.status === "error";
  const gaps = firmOn ? (d.timesheet_gaps || []).length : 0;
  if (gaps) bits.push(`${plural(gaps, "person", "people")} with timesheet gaps`);
  const stale = (d.stale_clients || []).length + (d.qbo_errors || []).length;
  if (stale) bits.push(`${plural(stale, "client")} stale or disconnected`);
  const pend = (d.pending?.access_requests || []).length;
  if (pend) bits.push(`${plural(pend, "access request")} waiting`);
  if (bits.length === 1) bits.push("nothing needs attention");
  return bits;
}

function render(d: any) {
  const range = fmtRange(d.week_start, d.week_end);
  const subject = `MyGoodBooks weekly digest · ${range}`;
  const sections = buildSections(d);
  const head = headline(d);

  const sectionHtml = sections
    .map((s) => `
<tr><td style="padding:0 0 12px 0;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.card};border:1px solid ${C.line};border-radius:8px;">
    <tr><td style="padding:14px 16px 4px 16px;">
      <h2 style="${FONT}font-size:15px;font-weight:700;color:${C.ink};margin:0 0 6px 0;">${esc(s.title)}</h2>
      ${s.html}
      <p style="${FONT}font-size:12px;margin:8px 0 10px 0;"><a href="${esc(s.link.href)}" style="color:${C.brand};text-decoration:underline;">${esc(s.link.label)} &rarr;</a></p>
    </td></tr>
  </table>
</td></tr>`)
    .join("");

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:${C.bg};">
<div style="display:none;max-height:0;overflow:hidden;">${esc(head.join(" · "))}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.bg};">
<tr><td align="center" style="padding:20px 10px;">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">
  <tr><td style="padding:0 0 12px 0;">
    <p style="${FONT}font-size:12px;color:${C.muted};margin:0;text-transform:uppercase;letter-spacing:.06em;">MyGoodBooks · Weekly digest</p>
    <h1 style="${FONT}font-size:20px;font-weight:700;color:${C.ink};margin:4px 0 0 0;">Week of ${esc(range)}</h1>
  </td></tr>
  <tr><td style="padding:0 0 12px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.card};border:1px solid ${C.line};border-left:4px solid ${C.brand};border-radius:8px;">
      <tr><td style="padding:12px 16px;">
        ${head.map((b) => para(`• ${esc(b)}`)).join("")}
      </td></tr>
    </table>
  </td></tr>
  ${sectionHtml}
  <tr><td style="padding:8px 4px 0 4px;">
    <p style="${FONT}font-size:11px;color:${C.muted};margin:0;line-height:1.5;">Sent to MyGoodBooks admins. Test clients are excluded. Change recipients or turn this off on the Team page (Weekly digest card) at <a href="${APP_URL}/" style="color:${C.muted};">${APP_URL.replace("https://", "")}</a>.</p>
  </td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table>
</body></html>`;

  const text = [
    `MyGoodBooks weekly digest: week of ${range}`,
    "",
    ...head.map((b) => `* ${b}`),
    "",
    ...sections.flatMap((s) => [s.title.toUpperCase(), s.text, `  ${s.link.label}: ${s.link.href}`, ""]),
    "Test clients are excluded. Change recipients on the Team page (Weekly digest card).",
  ].join("\n");

  return { subject, html, text, headline: head };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
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

  let trigger: "cron" | "manual" | "preview";
  let requestedBy: string | null = null;
  if (isMachine) {
    trigger = "cron";
  } else {
    const asUser = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes, error: userErr } = await asUser.auth.getUser();
    if (userErr || !userRes?.user?.email) return json({ error: "unauthorized" }, 401);
    const { data: isAdmin, error: rpcErr } = await asUser.rpc("is_active_staff_admin");
    if (rpcErr || isAdmin !== true) return json({ error: "forbidden" }, 403);
    requestedBy = userRes.user.email;
    const preview = url.searchParams.get("preview") === "1" || body?.preview === true;
    trigger = preview ? "preview" : "manual";
  }

  const startedAt = new Date().toISOString();
  const { data: settings } = await admin.from("digest_settings").select("*").eq("id", true).maybeSingle();
  const tz: string = settings?.timezone || "America/New_York";
  const recipients: string[] = settings?.recipients?.length ? settings.recipients : ["admin@mygoodbooks.org"];
  const today = todayIn(tz);
  const wsParam = url.searchParams.get("week_start") || body?.week_start;
  const weekStart = typeof wsParam === "string" && /^\d{4}-\d{2}-\d{2}$/.test(wsParam) ? wsParam : lastWeekStart(today);
  const weekEnd = addDays(weekStart, 6);

  const log = async (status: string, extra: Record<string, unknown> = {}) => {
    const { error } = await admin.from("digest_runs").insert({
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      trigger,
      status,
      requested_by: requestedBy,
      recipients: trigger === "preview" ? null : recipients,
      week_start: weekStart,
      week_end: weekEnd,
      ...extra,
    });
    if (error) console.log(`weekly-admin-digest: could not log run — ${error.message}`);
  };

  if (trigger === "cron" && settings && settings.enabled === false) {
    await log("disabled", { detail: "digest is turned off in digest_settings" });
    return json({ status: "disabled" });
  }

  const { data, error } = await admin.rpc("digest_weekly_data", { p_week_start: weekStart, p_today: today });
  if (error || !data) {
    const detail = `could not build the digest: ${error?.message || "no data"}`;
    await log("error", { detail });
    console.log(`weekly-admin-digest: ${detail}`);
    return json({ status: "error", error: detail }, 500);
  }

  const email = render(data);
  const summary = { headline: email.headline, subject: email.subject };

  if (trigger === "preview") {
    await log("preview", { summary });
    if (url.searchParams.get("format") === "json" || body?.format === "json") {
      return json({ status: "preview", subject: email.subject, html: email.html, text: email.text, email_configured: emailConfigured(), recipients, from: defaultFrom() });
    }
    return new Response(email.html, { headers: { ...CORS, "Content-Type": "text/html; charset=utf-8" } });
  }

  if (!emailConfigured()) {
    await log("not_configured", { detail: "email not configured (RESEND_API_KEY is not set)", summary });
    console.log("weekly-admin-digest: email not configured — RESEND_API_KEY is not set");
    return json({ status: "not_configured", error: "email not configured", subject: email.subject });
  }

  const sent = await sendEmail({
    to: recipients,
    subject: trigger === "manual" ? `[Test] ${email.subject}` : email.subject,
    html: email.html,
    text: email.text,
    tags: [{ name: "kind", value: "weekly_admin_digest" }],
  });
  if (!sent.ok) {
    await log("error", { detail: sent.error, summary });
    console.log(`weekly-admin-digest: send failed — ${sent.error}`);
    return json({ status: "error", error: sent.error }, 502);
  }
  await log("sent", { provider_id: sent.id, summary });
  console.log(`weekly-admin-digest: sent (${trigger}) to ${recipients.length} recipient(s)`);
  return json({ status: "sent", id: sent.id, recipients, subject: email.subject });
});
