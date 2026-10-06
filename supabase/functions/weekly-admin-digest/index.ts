import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { defaultFrom, emailConfigured, esc, sendEmail } from "../_shared/email.ts";
import * as L from "../_shared/layout.ts";

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
//   (c) machine preview: the cron key with body {"preview": true} returns the
//       preview (format json) and sends nothing. Previews (either caller) may
//       add {"include_test": true} to show test clients in Needs attention /
//       Fee changes, for checking the layout; real sends never include them.
//
// "Needs attention" (digest_needs_attention(), supabase/ops-alerting.sql) is
// shown first and only when something is wrong: QuickBooks sync failures and
// last_error, disconnected / errored connections, clients overdue for their
// plan's sync schedule, failed client/admin emails, Intuit usage near the cap,
// and health-check alerts still open. "Fee changes to review"
// (digest_fee_suggestions()) lists clients whose numbers point to a different
// pricing milestone; staff confirm in Client details > Milestone. Nothing here
// changes a fee or emails a client.
//
// Every run is logged in digest_runs. If RESEND_API_KEY is missing the send is
// skipped with status "not_configured". Numbers come from the service-role-only
// SQL function digest_weekly_data(), including the Staff feedback section
// (staff_feedback key; supabase/digest-staff-feedback.sql).

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
// Rendering: the shared MyGoodBooks layout (../_shared/layout.ts). Table
// layout + inline styles for Gmail/Outlook; 600px max, fluid below that.
// Plain-text alternative is built alongside.
// ---------------------------------------------------------------------------
// Colour helpers: `tone` spans pick up the design system's dark-mode values.
const ink = (h: string) => L.tone(h, "ink");
const warn = (h: string) => L.tone(h, "warn");
const bad = (h: string) => L.tone(h, "bad");
const muted = (h: string) => L.tone(h, "muted");

type Section = { title: string; html: string; text: string; link: { label: string; href: string } };

function tableHtml(head: string[], rows: string[][], alignRight: number[] = []): string {
  return L.dataTable(head, rows, alignRight);
}
function para(html: string, t: "text" | "muted" = "text"): string {
  return L.p(html, { tone: t, size: 13.5, margin: "8px 0" });
}
function empty(): string {
  return para("Nothing this week.", "muted");
}
function textTable(rows: string[]): string {
  return rows.map((r) => `  - ${r}`).join("\n");
}

function ago(iso: string | null | undefined): string {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 90) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)} days ago`;
}
const FEATURE_LABEL: Record<string, string> = {
  doc_chaser: "Document reminders",
  value_report: "Monthly value report",
  staff_client_message: "Staff: client message alerts",
  staff_doc_upload: "Staff: document upload alerts",
  staff_task_assigned: "Staff: task assigned",
  staff_task_due: "Staff: tasks due",
  staff_feedback_status: "Staff: feedback updates",
  client_message: "Client: new message",
  client_reports_ready: "Client: reports ready",
  weekly_admin_digest: "Weekly admin digest",
};
function fmtNum(n: unknown): string {
  return Number(n || 0).toLocaleString("en-US");
}

// Counts the problems in digest_needs_attention(); 0 = section omitted.
function needsAttentionCount(na: any): number {
  if (!na) return 0;
  return (na.sync || []).length + (na.connections || []).length + (na.emails || []).length +
    (na.usage ? 1 : 0) + (na.open_alerts || []).length;
}

function needsAttentionSection(na: any): Section | null {
  if (!needsAttentionCount(na)) return null;
  const testTag = (r: any) => (r.test_only ? ` ${muted("(test)")}` : "");
  const testTxt = (r: any) => (r.test_only ? " (test)" : "");
  let html = "";
  const text: string[] = [];

  const sync: any[] = na.sync || [];
  if (sync.length) {
    html += L.label("QuickBooks syncs") + tableHtml(
      ["Client", "Problem", "Last good sync"],
      sync.map((r) => {
        const bits: string[] = [];
        if (Number(r.errors_7d)) bits.push(`${plural(Number(r.errors_7d), "failed sync")} this week`);
        if (Number(r.errors_in_a_row) >= 2) bits.push(`${r.errors_in_a_row} in a row now`);
        if (r.overdue) bits.push(`overdue (expected ${r.expected}${r.paused_by_usage ? "; paused by the usage limit" : ""})`);
        const err = r.last_run_detail || r.last_error;
        return [
          esc(r.client_name) + testTag(r),
          bad(esc(bits.join("; ") || "last error set")) + (err ? `<br>${muted(esc(clip(err, 140)))}` : ""),
          `${fmtDay(r.last_synced_at)} ${muted(`(${ago(r.last_synced_at)})`)}`,
        ];
      }),
    );
    for (const r of sync) {
      const err = r.last_run_detail || r.last_error;
      text.push(
        `${r.client_name}${testTxt(r)}: ${Number(r.errors_7d) || 0} failed syncs this week` +
          `${r.overdue ? `, overdue (expected ${r.expected})` : ""}; last good sync ${ago(r.last_synced_at)}` +
          `${err ? ` — ${clip(err, 140)}` : ""}`,
      );
    }
  }

  const conns: any[] = na.connections || [];
  if (conns.length) {
    html += L.label("QuickBooks connections") + tableHtml(
      ["Client", "Status", "Last synced"],
      conns.map((r) => [
        esc(r.client_name) + testTag(r),
        bad(r.status === "error" ? "Needs reconnecting" : "Disconnected") +
          (r.last_error ? `<br>${muted(esc(clip(r.last_error, 140)))}` : ""),
        fmtDay(r.last_synced_at),
      ]),
    );
    for (const r of conns) {
      text.push(`${r.client_name}${testTxt(r)}: QuickBooks ${r.status === "error" ? "needs reconnecting" : "disconnected"}`);
    }
  }

  const emails: any[] = na.emails || [];
  if (emails.length) {
    html += L.label("Emails that failed") + tableHtml(
      ["Email", "Failed", "Last failure"],
      emails.map((r) => [
        esc(FEATURE_LABEL[r.feature] || r.feature),
        `<b>${bad(esc(r.failed))}</b>`,
        `${fmtDay(r.last_at)}${r.last_reason ? `<br>${muted(esc(clip(r.last_reason, 140)))}` : ""}`,
      ]),
      [1],
    );
    for (const r of emails) {
      text.push(`${FEATURE_LABEL[r.feature] || r.feature}: ${r.failed} failed (last ${fmtDay(r.last_at)}${r.last_reason ? `: ${clip(r.last_reason, 140)}` : ""})`);
    }
  }

  const u = na.usage;
  if (u) {
    const cap = Number(u.cap) || 1;
    const line = `Intuit API usage is near the monthly cap: ${fmtNum(u.calls)} of ${fmtNum(u.cap)} calls ` +
      `(${Math.round((Number(u.calls) / cap) * 100)}%), on pace for ${fmtNum(u.projected)} (${Math.round((Number(u.projected) / cap) * 100)}%)` +
      (u.mode === "stopped" ? ". Scheduled syncs are stopped until next month." : u.mode === "throttled" ? ". Pro syncs are slowed to every " + u.premium_interval_min + " min." : ".");
    html += L.label("QuickBooks API usage") + para((u.mode === "normal" ? warn : bad)(esc(line)));
    text.push(line);
  }

  const open: any[] = na.open_alerts || [];
  if (open.length) {
    html += L.label("Health-check alerts still open") +
      open.map((a) => para(`• ${esc(a.title)} ${muted(`(since ${fmtDay(a.first_seen_at)})`)}`)).join("");
    for (const a of open) text.push(`Open alert: ${a.title} (since ${fmtDay(a.first_seen_at)})`);
  }

  html += para("Past 7 days. Test clients are excluded" + (na.include_test ? " (shown here because this is a preview)." : "."), "muted");
  return {
    title: "Needs attention",
    html,
    text: textTable(text),
    link: { label: "Open the client list", href: `${APP_URL}/#/home` },
  };
}

function feeChangesSection(f: any): Section | null {
  const rows: any[] = f?.changes || [];
  const unconfirmed = Number(f?.unconfirmed || 0);
  if (!rows.length && !unconfirmed) return null;
  const fee = (v: unknown) => (v == null ? "Custom" : `${money(v)}/mo`);
  const why = (r: any) => {
    const tx = r.avg_tx != null ? `${fmtNum(Math.round(Number(r.avg_tx)))} transactions/mo (3-month avg)` : null;
    const b = r.budget != null ? `${money(r.budget)} budget (${r.budget_basis})` : null;
    const lead = r.driven_by === "transactions" ? tx : r.driven_by === "budget" ? b : [tx, b].filter(Boolean).join(" and ");
    const other = r.driven_by === "transactions" ? b : r.driven_by === "budget" ? tx : null;
    return `${lead || "–"}${other ? `; ${other}` : ""}`;
  };
  let html = rows.length
    ? tableHtml(
        ["Client", "Current → suggested", "Why"],
        rows.map((r) => [
          esc(r.client_name),
          `${esc(r.current_name)} ${muted(esc(fee(r.current_fee)))} → <b>${(r.direction === "up" ? warn : ink)(esc(r.suggested_name))}</b> ${muted(esc(fee(r.suggested_fee)))}`,
          esc(why(r)),
        ]),
      )
    : para("No milestone changes this week.", "muted");
  html += para(
    "Higher of the 3-month average monthly transactions and the annual budget. Suggestions only: confirm or skip each one in Client details › Milestone. Fees go down as well as up; nothing changes and no client is emailed until staff confirm." +
      (unconfirmed ? ` ${plural(unconfirmed, "client has", "clients have")} no confirmed milestone yet.` : ""),
    "muted",
  );
  const text = (rows.length
    ? textTable(rows.map((r) =>
      `${r.client_name}: ${r.current_name} (${fee(r.current_fee)}) -> ${r.suggested_name} (${fee(r.suggested_fee)}), ${why(r)}`
    ))
    : "  No milestone changes this week.") +
    (unconfirmed ? `\n  ${plural(unconfirmed, "client has", "clients have")} no confirmed milestone yet.` : "");
  return { title: "Fee changes to review", html, text, link: { label: "Open Milestones to review on Home", href: `${APP_URL}/#/home` } };
}

function buildSections(d: any): Section[] {
  const out: Section[] = [];
  const team = { label: "Open the Team page", href: `${APP_URL}/#/team` };
  const firmOn = d.firm_qbo?.status === "connected" || d.firm_qbo?.status === "error";

  // 0. Needs attention (omitted when everything's fine)
  const na = needsAttentionSection(d.needs_attention);
  if (na) out.push(na);

  // 1. Scope creep
  {
    const rows: any[] = d.scope_creep || [];
    const html = rows.length
      ? tableHtml(
          ["Client", "Last week", "Typical week", "4-wk pace /mo", "3-mo avg /mo"],
          rows.map((r) => [
            esc(r.client_name),
            `<b>${(r.week_flag ? warn : ink)(hrs(r.week_hours))}</b>`,
            hrs(r.base_week_hours),
            `<b>${(r.month_flag ? warn : ink)(hrs(r.pace_month_hours))}</b>`,
            hrs(r.base_month_hours),
          ]),
          [1, 2, 3, 4],
        ) + para("Flagged at 1.5× the 3-month average and at least 2 hours more.", "muted")
      : empty() + (firmOn ? "" : para("QuickBooks Time isn't connected, so there are no hours to compare.", "muted"));
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
            esc(r.client_name) + (r.estimated ? ` ${muted("(est.)")}` : ""),
            money(r.monthly_fee),
            money(r.monthly_cost),
            `<b>${(Number(r.margin_pct) < 0 ? bad : warn)(`${esc(r.margin_pct)}%`)}</b>`,
            `<b>${money(r.suggested_fee)}</b>`,
          ]),
          [1, 2, 3, 4],
        )
      : empty();
    html += para(
      `Target margin ${esc(d.target_margin_pct)}%. Cost is the last 90 days of QuickBooks Time at each person's cost rate; suggested fee = cost ÷ (1 − target).` +
        (noFee ? ` ${plural(noFee, "client has", "clients have")} no fee set and ${noFee === 1 ? "isn't" : "aren't"} reviewed.` : "") +
        (d.price_review_has_rates ? "" : " No staff cost rates are set yet."),
      "muted",
    );
    const text = (rows.length
      ? textTable(rows.map((r) =>
        `${r.client_name}: fee ${money(r.monthly_fee)}/mo, cost ${money(r.monthly_cost)}/mo, margin ${r.margin_pct}% -> suggest ${money(r.suggested_fee)}${r.estimated ? " (est.)" : ""}`
      ))
      : "  Nothing this week.") + (noFee ? `\n  ${plural(noFee, "client has", "clients have")} no fee set.` : "");
    out.push({ title: "Price review", html, text, link: team });
  }

  // 2b. Fee changes to review (pricing milestones; omitted when none)
  {
    const fc = feeChangesSection(d.fee_suggestions);
    if (fc) out.push(fc);
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
        "muted",
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
            `<b>${(Number(r.days_overdue) > 30 ? bad : warn)(esc(r.days_overdue))}</b>`,
            money(r.balance, true),
          ]),
          [3, 4],
        ) + para(`Total overdue: <b>${money(total, true)}</b>`)
      : empty();
    if (!d.invoices_synced_at) {
      html += para("Invoices haven't synced from the firm's QuickBooks yet.", "muted");
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
      ? para("QuickBooks Time isn't connected, so timesheets can't be checked.", "muted")
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
              `<b>${(under && firmOn ? warn : ink)(hrs(r.qbo_hours))}</b> ${muted(`/ ${hrs(r.target_hours)}`)}`,
              esc(r.tasks_done),
              `${esc(r.tasks_open)} / ${(Number(r.tasks_overdue) ? bad : ink)(esc(r.tasks_overdue))}`,
              hrs(r.app_hours),
            ];
          }),
          [1, 2, 3, 4],
        ) + para(`Target is each person's weekly capacity, or 35h where none is set${d.has_capacity_table ? "" : " (capacity isn't set up yet)"}.`, "muted")
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
      link: { label: "Open the client list", href: `${APP_URL}/#/home` },
    });
  }

  // 8. Pending
  {
    const p = d.pending || {};
    const reqs: any[] = p.access_requests || [];
    const items: string[] = [];
    const textItems: string[] = [];
    for (const r of reqs) {
      items.push(`Access request: <b>${esc(r.staff_name)}</b> → ${esc(r.client_name)} ${muted(`(${fmtDay(r.requested_at)})`)}`);
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
      items.push(bad("The firm's QuickBooks connection needs reconnecting."));
      textItems.push("The firm's QuickBooks connection needs reconnecting.");
    }
    // Intuit API usage this month (qbo_usage_status; supabase/qbo-usage-guard.sql).
    const u = d.qbo_usage;
    if (u && Number(u.cap)) {
      const pct = (n: number) => `${Math.round((n / Number(u.cap)) * 100)}%`;
      const fmt = (n: number) => Number(n || 0).toLocaleString("en-US");
      const line =
        `QuickBooks API usage: ${fmt(u.calls)} calls this month (${pct(u.calls)} of ${fmt(u.cap)}), ` +
        `on pace for ${fmt(u.projected)} (${pct(u.projected)}). Pro syncs every ${u.premium_interval_min} min`;
      const note =
        u.mode === "stopped" ? " — scheduled syncs are stopped until next month; Sync now still works."
        : u.mode === "throttled" ? " — slowed down to stay under the monthly limit."
        : ".";
      const text = line + note;
      items.push(u.mode === "stopped" ? bad(esc(text)) : u.mode === "throttled" ? warn(esc(text)) : esc(text));
      textItems.push(text);
    }
    const html = items.length ? items.map((i) => para(`• ${i}`)).join("") : empty();
    out.push({ title: "Pending", html, text: textItems.length ? textTable(textItems) : "  Nothing this week.", link: team });
  }

  // 9. Staff feedback (staff_feedback; supabase/digest-staff-feedback.sql)
  {
    const f = d.staff_feedback || {};
    const total = Number(f.new_total || 0);
    const week = Number(f.last_7_days || 0);
    const rows: any[] = f.newest || [];
    const summary = feedbackSummary(f);
    const weekLine = `${plural(week, "report")} received in the last 7 days.`;
    let html: string;
    let text: string;
    if (!total) {
      html = para("No new feedback.", "muted") + (week ? para(esc(weekLine), "muted") : "");
      text = `  No new feedback.${week ? ` ${weekLine}` : ""}`;
    } else {
      html = para(`<b>${esc(summary)}</b>`) +
        tableHtml(
          ["Kind", "From", "Message"],
          rows.map((r) => [
            `<b>${(r.kind === "bug" ? bad : ink)(esc(KIND_LABEL[r.kind] || r.kind))}</b>`,
            esc(r.author_name || r.author_email || "–") + (r.author_name ? `<br>${muted(esc(r.author_email))}` : "") +
              `<br>${muted(fmtDay(r.created_at))}`,
            esc(clip(r.message)),
          ]),
        ) +
        para((total > rows.length ? `Showing the ${rows.length} newest. ` : "") + esc(weekLine), "muted");
      text = `  ${summary}\n` +
        textTable(rows.map((r) =>
          `[${KIND_LABEL[r.kind] || r.kind}] ${r.author_name || r.author_email}: ${clip(r.message)}`
        )) + `\n  ${weekLine}`;
    }
    out.push({ title: "Staff feedback", html, text, link: { label: "Open the Feedback page", href: `${APP_URL}/#/feedback` } });
  }

  return out;
}

const KIND_LABEL: Record<string, string> = { bug: "Bug", idea: "Idea", question: "Question", other: "Other" };
const KIND_ORDER = ["bug", "idea", "question", "other"];
const KIND_PLURAL: Record<string, [string, string]> = {
  bug: ["bug", "bugs"],
  idea: ["idea", "ideas"],
  question: ["question", "questions"],
  other: ["other", "other"],
};
// "3 new: 2 bugs, 1 idea"
function feedbackSummary(f: any): string {
  const byKind = f.new_by_kind || {};
  const parts = KIND_ORDER.filter((k) => Number(byKind[k])).map((k) =>
    plural(Number(byKind[k]), KIND_PLURAL[k][0], KIND_PLURAL[k][1])
  );
  return `${Number(f.new_total || 0)} new${parts.length ? `: ${parts.join(", ")}` : ""}`;
}
function clip(s: unknown, n = 120): string {
  const t = String(s ?? "").trim();
  return t.length > n ? `${t.slice(0, n).trimEnd()}…` : t;
}

function headline(d: any): string[] {
  const bits: string[] = [];
  const late: any[] = d.late_payers || [];
  const lateTotal = late.reduce((s, r) => s + Number(r.balance || 0), 0);
  bits.push(`${money(d.revenue?.mrr)} monthly fees across ${plural(Number(d.revenue?.active_clients || 0), "active client")}`);
  const naCount = needsAttentionCount(d.needs_attention);
  if (naCount) bits.push(`${plural(naCount, "thing")} need${naCount === 1 ? "s" : ""} attention (see the top section)`);
  const feeCount = (d.fee_suggestions?.changes || []).length;
  if (feeCount) bits.push(`${plural(feeCount, "fee change")} to review`);
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
  if (Number(d.staff_feedback?.new_total)) bits.push(plural(Number(d.staff_feedback.new_total), "new staff feedback report"));
  if (bits.length === 1) bits.push("nothing needs attention");
  return bits;
}

function render(d: any) {
  const range = fmtRange(d.week_start, d.week_end);
  const subject = `MyGoodBooks weekly digest · ${range}`;
  const sections = buildSections(d);
  const head = headline(d);

  const sectionHtml = sections
    .map((s) =>
      L.card(
        L.heading(s.title) +
          s.html +
          L.p(`${L.link(s.link.href, `${esc(s.link.label)} &rarr;`)}`, { size: 13.5, margin: "12px 0 18px 0" }),
        { padding: "24px 24px 4px 24px" },
      )
    )
    .join("");

  const html = L.emailDocument({
    title: subject,
    preheader: head.join(" · "),
    subtitle: "Weekly digest",
    intro: L.pageTitle(`Week of ${range}`),
    cards:
      L.card(head.map((b) => para(`• ${esc(b)}`)).join(""), { variant: "warm", padding: "16px 24px 12px 24px" }) +
      sectionHtml,
    footer: `Sent to MyGoodBooks admins. Test clients are excluded. Change recipients or turn this off on the Emails page at ${L.link(`${APP_URL}/#/emails`, `${APP_URL.replace("https://", "")}/#/emails`, "muted")}.`,
  });

  const text = [
    `MyGoodBooks weekly digest: week of ${range}`,
    "",
    ...head.map((b) => `* ${b}`),
    "",
    ...sections.flatMap((s) => [s.title.toUpperCase(), s.text, `  ${s.link.label}: ${s.link.href}`, ""]),
    `Test clients are excluded. Change recipients or turn this off on the Emails page: ${APP_URL}/#/emails`,
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
    // The cron key may also ask for a preview (sends nothing).
    trigger = body?.preview === true ? "preview" : "cron";
    if (trigger === "preview") requestedBy = "machine preview";
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

  // Usage guard status for the Pending section. Optional: a failure here
  // never stops the digest.
  try {
    const { data: usage, error: usageErr } = await admin.rpc("qbo_usage_status");
    if (!usageErr && usage) (data as any).qbo_usage = usage;
  } catch (_e) {
    // ignore
  }

  // Needs attention + fee suggestions (supabase/ops-alerting.sql). Optional:
  // a failure here never stops the digest. Test clients only ever appear in
  // a preview that asks for them.
  const includeTest = trigger === "preview" &&
    (body?.include_test === true || url.searchParams.get("include_test") === "1");
  try {
    const { data: na, error: naErr } = await admin.rpc("digest_needs_attention", { p_include_test: includeTest });
    if (!naErr && na) (data as any).needs_attention = na;
    else if (naErr) console.log(`weekly-admin-digest: needs attention unavailable — ${naErr.message}`);
  } catch (_e) {
    // ignore
  }
  try {
    const { data: fees, error: feeErr } = await admin.rpc("digest_fee_suggestions", { p_include_test: includeTest });
    if (!feeErr && fees) (data as any).fee_suggestions = fees;
    else if (feeErr) console.log(`weekly-admin-digest: fee suggestions unavailable — ${feeErr.message}`);
  } catch (_e) {
    // ignore
  }

  const email = render(data);
  const summary = { headline: email.headline, subject: email.subject };

  if (trigger === "preview") {
    await log("preview", { summary });
    if (url.searchParams.get("format") === "json" || body?.format === "json" || requestedBy === "machine preview") {
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
