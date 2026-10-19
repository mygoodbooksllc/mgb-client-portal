import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { emailConfigured, esc, sendEmail } from "../_shared/email.ts";
import * as L from "../_shared/layout.ts";
import { loadSignoffs, signoffHtml, signoffText, type Signoff } from "../_shared/signature.ts";
import { approvalEmail, approvalSkipReason, isHeld } from "./handbookApproval.ts";

// Notification emails behind Settings > Notifications
// (supabase/notification-emails.sql has the outbox, triggers and schedules).
//   job "outbox"   : send what the database triggers queued (cron, every 5 min)
//   job "task_due" : each person's open tasks due today (cron, daily 11:30 UTC)
//
// Auth (verify_jwt is OFF; this is the gate): machine callers only. pg_cron via
// notification_emails_cron(job) presents the Vault qbo_cron_key (or the
// service_role key) as bearer. Nothing else can call this function.
//
// Every recipient's own preference (user_settings.settings.notify.email.<key>)
// is checked at send time. Client kinds also honor the admin master switch
// (client_email_settings.enabled), the org's opt_out_all, each person's
// unsubscribe link (client_email_recipients) and test_only clients. Bodies
// never contain message text, amounts, fees or rates.
//
// staff_client_message rows with payload.loop_in (supabase/account-manager.sql)
// are a "Loop in bookkeeper" or an @mention: same Settings key, own wording.
//
// Staff Handbook (supabase/staff-handbook.sql, hb_queue): handbook_sign_needed
// and handbook_countersign_needed. Link only, never the policy text. Payload:
// { policy_title, policy_slug, version_no, link, due_date? (sign),
//   signer_name?, signature_id? (countersign) }. Settings key notify.email.handbook.
//
// handbook_approval_needed (supabase/staff-handbook-4-approvals.sql): one
// batched "N handbook policies need your approval" email to the policy
// approver. A row is left unsent until payload.not_before (at most one email
// per 30 minutes); at send time the recipient must still be the approver and
// an active admin, and the live count of drafts waiting is used (0: skipped).
// Count and link only, never titles or text. Settings key
// notify.email.handbook_approval. See ./handbookApproval.ts.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APP_URL = "https://app.mygoodbooks.org/";
const UNSUB_PAGE = "https://app.mygoodbooks.org/unsubscribe";
const TZ = "America/New_York";
const STALE_MS = 2 * 86400000; // queued rows older than this are dropped, not sent
const BATCH = 500;

type Kind =
  | "staff_client_message" | "staff_doc_upload" | "staff_task_assigned" | "staff_task_due"
  | "staff_feedback_status" | "staff_tech_request" | "client_message" | "client_reports_ready"
  | "handbook_sign_needed" | "handbook_countersign_needed"
  | "staff_task_review_ready" | "staff_task_sent_back" | "staff_task_mention" | "staff_task_client_answered"
  | "staff_task_batch" | "handbook_approval_needed";

// Settings key and default for each kind (matches components/settings/Settings.jsx).
const PREF: Record<Kind, { key: string; def: boolean }> = {
  staff_client_message: { key: "client_message", def: true },
  staff_doc_upload: { key: "doc_upload", def: true },
  staff_task_assigned: { key: "task_assigned", def: true },
  staff_task_due: { key: "task_due", def: false },
  staff_feedback_status: { key: "feedback_status", def: true },
  staff_tech_request: { key: "tech_request", def: true }, // goes to admin@mygoodbooks.org, which has no settings
  client_message: { key: "bookkeeper_message", def: true },
  client_reports_ready: { key: "reports_ready", def: true },
  handbook_sign_needed: { key: "handbook", def: true },
  handbook_countersign_needed: { key: "handbook", def: true },
  handbook_approval_needed: { key: "handbook_approval", def: true },
  // Tasks Phase 2 (supabase/tasks-p2-3-review.sql and later slices).
  staff_task_review_ready: { key: "task_review", def: true },
  staff_task_sent_back: { key: "task_sent_back", def: true },
  staff_task_mention: { key: "task_mention", def: true },
  staff_task_client_answered: { key: "task_client_answered", def: true },
  staff_task_batch: { key: "task_batch", def: true },
};
const isClientKind = (k: Kind) => k === "client_message" || k === "client_reports_ready";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
function secretsMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function dateIn(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
function fmtDay(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00Z`);
  return d.toLocaleDateString("en-US", { timeZone: "UTC", month: "long", day: "numeric" });
}
function monthName(period: string): string {
  return new Date(`${String(period).slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "long", year: "numeric" });
}
function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}
function handbookLink(slug: unknown) {
  const s = String(slug || "").trim();
  return s ? `${APP_URL}#/team/handbook?item=handbook:${encodeURIComponent(s)}` : `${APP_URL}#/team/handbook`;
}
function clientLink(clientId: string | null, page: string) {
  return clientId ? `${APP_URL}#/client/${encodeURIComponent(clientId)}/${page}` : APP_URL;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
type Email = { subject: string; html: string; text: string };
const p = (html: string, tone: "text" | "muted" = "text", size = 15) => L.p(html, { tone, size });

// Tasks links stay inside the app: only "#/tasks..." hashes from the payload.
function taskHash(h: unknown): string {
  const s = String(h || "");
  return /^#\/tasks(\/[A-Za-z0-9_\-\/]*)?(\?item=task:[0-9a-f-]{36})?$/.test(s) ? `${APP_URL}${s}` : `${APP_URL}#/tasks/my`;
}
function taskLink(id: unknown): string {
  const s = String(id || "");
  return /^[0-9a-f-]{36}$/.test(s) ? `${APP_URL}#/tasks/my?item=task:${s}` : `${APP_URL}#/tasks/my`;
}
const PERIOD_KIND: Record<string, string> = { month: "month", quarter: "quarter", year: "year" };
function periodLabel(p: unknown, kind: unknown): string {
  const m = /^(\d{4})-(\d{2})/.exec(String(p || ""));
  if (!m) return "A period";
  const k = PERIOD_KIND[String(kind || "month")] || "month";
  if (k === "year") return `FY ${m[1]}`;
  if (k === "quarter") return `Q${Math.floor((Number(m[2]) - 1) / 3) + 1} ${m[1]}`;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 15)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

// Review loop and @mention emails (Tasks Phase 2 S3). Payload: text, by,
// task_id (ref_id), and reason (sent back), excerpt (mention), or
// kind='period' + period/period_kind (a month marked Ready for sign-off).
function taskEmail(kind: Kind, list: any[], cname: string | null): Email | null {
  const rows = list.slice(0, 15).map((r: any) => ({ id: r.ref_id, ...(r.payload || {}) }));
  if (!rows.length) return null;
  const one = rows.length === 1 ? rows[0] : null;
  const by = [...new Set(rows.map((r: any) => String(r.by || "").trim()).filter(Boolean))];
  const who = by.length === 1 ? by[0] : "Your team";
  const forClient = cname ? ` for ${cname}` : "";
  const forClientH = cname ? ` for <b>${esc(cname)}</b>` : "";
  const label = (r: any) => (r.kind === "period" ? `${periodLabel(r.period, r.period_kind)} close` : String(r.text || "A task").slice(0, 200));
  if (kind === "staff_task_review_ready") {
    const periods = rows.every((r: any) => r.kind === "period");
    return staffEmail({
      subject: one ? `Ready for your review: ${label(one)}${cname ? ` (${cname})` : ""}` : `${rows.length} items ready for your review`,
      preheader: rows.map(label).join(", ").slice(0, 140),
      lines: [`${esc(who)} marked ${one ? "this" : "these"} ready for review${forClientH}:`, L.bullets(rows.map((r: any) => esc(label(r))))],
      textLines: [`${who} marked ${one ? "this" : "these"} ready for review${forClient}:`, ...rows.map((r: any) => `- ${label(r)}`)],
      cta: periods ? "Open Work › Close" : "Open the review queue",
      href: periods ? `${APP_URL}#/work/close` : `${APP_URL}#/tasks/review`,
    });
  }
  if (kind === "staff_task_sent_back") {
    return staffEmail({
      subject: one ? `Sent back: ${label(one)}` : `${rows.length} tasks sent back to you`,
      preheader: one ? String(one.reason || "").slice(0, 140) : rows.map(label).join(", ").slice(0, 140),
      lines: [
        `${esc(who)} sent ${one ? "a task" : `${rows.length} tasks`} back to you${forClientH}:`,
        L.bullets(rows.map((r: any) => `<b>${esc(label(r))}</b>${r.reason ? `<br>${L.tone(esc(String(r.reason).slice(0, 600)), "muted")}` : ""}`)),
      ],
      textLines: [`${who} sent ${one ? "a task" : `${rows.length} tasks`} back to you${forClient}:`, ...rows.map((r: any) => `- ${label(r)}${r.reason ? `\n  ${String(r.reason).slice(0, 600)}` : ""}`)],
      cta: one ? "Open the task" : "Open your tasks",
      href: one ? taskLink(one.id) : `${APP_URL}#/tasks/my`,
    });
  }
  if (kind === "staff_task_mention") {
    return staffEmail({
      subject: one ? `${who} mentioned you: ${label(one)}` : `${rows.length} task mentions`,
      preheader: one ? String(one.excerpt || "").slice(0, 140) : rows.map(label).join(", ").slice(0, 140),
      lines: [
        `${esc(who)} mentioned you on ${one ? "a task" : `${rows.length} tasks`}${forClientH}:`,
        L.bullets(rows.map((r: any) => `<b>${esc(label(r))}</b>${r.excerpt ? `<br>${L.tone(esc(String(r.excerpt).slice(0, 300)), "muted")}` : ""}`)),
      ],
      textLines: [`${who} mentioned you on ${one ? "a task" : `${rows.length} tasks`}${forClient}:`, ...rows.map((r: any) => `- ${label(r)}${r.excerpt ? `\n  ${String(r.excerpt).slice(0, 300)}` : ""}`)],
      cta: one ? "Open the task" : "Open your tasks",
      href: one ? taskLink(one.id) : `${APP_URL}#/tasks/my`,
    });
  }
  // staff_task_client_answered
  return staffEmail({
    subject: one ? `Client answered: ${label(one)}` : `${rows.length} client answers on your tasks`,
    preheader: rows.map(label).join(", ").slice(0, 140),
    lines: [`${cname ? `<b>${esc(cname)}</b>` : "Your client"} answered ${one ? "a question" : `${rows.length} questions`} on your tasks:`, L.bullets(rows.map((r: any) => esc(label(r))))],
    textLines: [`${cname || "Your client"} answered ${one ? "a question" : `${rows.length} questions`} on your tasks:`, ...rows.map((r: any) => `- ${label(r)}`)],
    cta: one ? "Open the task" : "Open your tasks",
    href: one ? taskLink(one.id) : `${APP_URL}#/tasks/my`,
  });
}

function staffEmail(o: { subject: string; preheader: string; lines: string[]; textLines: string[]; cta: string; href: string }): Email {
  const settingsUrl = `${APP_URL}#/settings`;
  const html = L.emailDocument({
    title: o.subject,
    preheader: o.preheader,
    subtitle: "Staff notification",
    cards: L.card(o.lines.map((l) => p(l)).join("") + L.button(o.cta, o.href)),
    footer: `You're receiving this because it's turned on in your MyGoodBooks settings. ${L.link(settingsUrl, "Change notification settings", "muted")}.`,
  });
  const text = [...o.textLines, "", `${o.cta}: ${o.href}`, "", `Change notification settings: ${settingsUrl}`].join("\n");
  return { subject: o.subject, html, text };
}

// Sign-off (signature text plus the optional Profile photo): ../_shared/signature.ts.

function clientEmail(o: {
  subject: string; preheader: string; clientName: string; lines: string[]; textLines: string[];
  cta: string; href: string; bkName: string | null; signature: Signoff | null; unsubUrl: string;
}): Email {
  const html = L.emailDocument({
    title: o.subject,
    preheader: o.preheader,
    subtitle: `Bookkeeping for ${o.clientName}`,
    cards: L.card(p("Hi there,") + o.lines.map((l) => p(l)).join("") + L.button(o.cta, o.href) + signoffHtml(o.signature, o.bkName)),
    footer: `You're receiving this because you have access to ${esc(o.clientName)}'s MyGoodBooks portal. You can turn this email off under Settings in your portal, or ${L.link(o.unsubUrl, "unsubscribe", "muted")} from these emails.`,
  });
  const text = [
    "Hi there,", "", ...o.textLines, "", `${o.cta}: ${o.href}`, "", ...signoffText(o.signature, o.bkName), "",
    `Unsubscribe from these emails: ${o.unsubUrl}`,
  ].join("\n");
  return { subject: o.subject, html, text };
}

const FEEDBACK_STATUS: Record<string, string> = {
  new: "New", planned: "Planned", done: "Done", wont_do: "Won't do",
};

// ---------------------------------------------------------------------------
// Data helpers
// ---------------------------------------------------------------------------
async function prefsFor(db: SupabaseClient, emails: string[]) {
  const map = new Map<string, any>();
  if (!emails.length) return map;
  const { data } = await db.from("user_settings").select("user_email, settings").in("user_email", emails);
  for (const r of data || []) map.set(String(r.user_email).toLowerCase(), r.settings || {});
  return map;
}
function wants(settings: any, kind: Kind): boolean {
  const v = settings?.notify?.email?.[PREF[kind].key];
  return typeof v === "boolean" ? v : PREF[kind].def;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  const presented = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!presented) return json({ error: "unauthorized" }, 401);
  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  let isMachine = secretsMatch(presented, SERVICE_ROLE_KEY);
  if (!isMachine) {
    const { data: cronKey } = await db.rpc("qbo_cron_key");
    isMachine = typeof cronKey === "string" && cronKey.length > 0 && secretsMatch(presented, cronKey);
  }
  if (!isMachine) return json({ error: "unauthorized" }, 401);

  let body: any = {};
  try {
    body = await req.json();
  } catch (_e) {
    body = {};
  }
  const job = body?.job === "outbox" || body?.job === "task_due" ? body.job : null;
  if (!job) return json({ error: "job must be outbox or task_due" }, 400);

  const { data: settings } = await db.from("client_email_settings").select("*").eq("id", true).maybeSingle();
  const replyTo = settings?.reply_to || undefined;
  const summary: Record<string, number> = { sent: 0, skipped: 0, not_configured: 0, error: 0 };

  const log = async (row: Record<string, unknown>) => {
    const { error } = await db.from("client_email_log").insert({ trigger: "cron", ...row });
    if (error) console.log(`notification-emails: could not log — ${error.message}`);
  };

  const { data: staffRows } = await db.from("staff").select("email, name, active, role");
  const activeStaff = new Map<string, string>();
  for (const s of staffRows || []) if (s.active) activeStaff.set(String(s.email).toLowerCase(), s.name || s.email);
  // Where MGB (internal) task emails go: one configured address instead of
  // the people on the task (internal_notify_settings). Unset or not yet
  // migrated = internal emails are not sent.
  let internalNotify = "";
  {
    const { data: ns } = await db.from("internal_notify_settings").select("notify_email").maybeSingle();
    internalNotify = String(ns?.notify_email || "").trim().toLowerCase();
  }

  // Send one email to one person; returns the outcome for the outbox rows.
  const deliver = async (
    kind: Kind, to: string, email: Email, clientId: string | null, extra: Record<string, unknown> = {},
    headers?: Record<string, string>,
  ): Promise<{ status: string; reason: string | null }> => {
    if (!emailConfigured()) {
      summary.not_configured++;
      await log({ feature: kind, client_id: clientId, status: "not_configured", reason: "RESEND_API_KEY is not set", recipients: [to], subject: email.subject, ...extra });
      return { status: "not_configured", reason: "RESEND_API_KEY is not set" };
    }
    const sent = await sendEmail({ to: [to], subject: email.subject, html: email.html, text: email.text, replyTo, tags: [{ name: "kind", value: kind }], headers });
    await log({
      feature: kind, client_id: clientId, status: sent.ok ? "sent" : "error", reason: sent.ok ? null : sent.error,
      recipients: [to], subject: email.subject, provider_id: sent.ok ? sent.id : null, ...extra,
    });
    summary[sent.ok ? "sent" : "error"]++;
    return sent.ok ? { status: "sent", reason: null } : { status: "error", reason: String(sent.error || "send failed").slice(0, 300) };
  };

  // -------------------------------------------------------------------------
  // Daily: tasks due today
  // -------------------------------------------------------------------------
  if (job === "task_due") {
    const today = dateIn(new Date());
    // Tasks module (2026-10-11): deleted tasks and tasks waiting on the
    // client never send a due reminder. Until that migration has run the
    // columns don't exist (42703), so the old query runs instead.
    const dueQuery = (tk: boolean) => {
      let q = db
        .from("staff_reminders")
        .select("id, text, client_id, assignee_email")
        .eq("done", false)
        .eq("due_date", today)
        .not("assignee_email", "is", null);
      if (tk) q = q.is("deleted_at", null).neq("status", "waiting_client");
      return q.order("created_at", { ascending: true });
    };
    let { data: tasks, error: dueErr } = await dueQuery(true);
    if (dueErr && (dueErr as any).code === "42703") ({ data: tasks } = await dueQuery(false));
    // Client access (D3): a client task only reaches someone who can open
    // that client in the app (admin, assigned, or an approved unexpired
    // grant). Same rule as tk_staff_has_client in tasks-module-v1.sql.
    const admins = new Set<string>();
    for (const s of staffRows || []) if (s.active && s.role === "admin") admins.add(String(s.email).toLowerCase());
    const reach = new Set<string>();
    const dueEmails = [...new Set((tasks || []).filter((t: any) => t.client_id).map((t: any) => String(t.assignee_email).toLowerCase()))];
    if (dueEmails.length) {
      const { data: sca } = await db.from("staff_client_access").select("staff_email, client_id").in("staff_email", dueEmails);
      for (const a of sca || []) reach.add(String(a.staff_email).toLowerCase() + "|" + a.client_id);
      const { data: grants } = await db.from("staff_client_access_grants").select("staff_email, client_id")
        .in("staff_email", dueEmails).eq("status", "approved").gt("expires_at", new Date().toISOString());
      for (const g of grants || []) reach.add(String(g.staff_email).toLowerCase() + "|" + g.client_id);
    }
    // Test clients and the internal company profile (clients.is_internal):
    // a test client's task never sends a due reminder, and an internal task
    // only reaches an admin who holds the per-admin internal_access grant
    // (the same rule the database enforces). is_internal is read in a second,
    // tolerant query so this still runs before internal-company-profile.sql.
    const testIds = new Set<string>();
    const internalIds = new Set<string>();
    const internalOk = new Set<string>();
    {
      const { data: tc } = await db.from("clients").select("id").eq("test_only", true);
      for (const c of tc || []) testIds.add(String(c.id));
      const { data: ic, error: icErr } = await db.from("clients").select("id").eq("is_internal", true);
      if (!icErr) {
        for (const c of ic || []) internalIds.add(String(c.id));
        if (internalIds.size) {
          const { data: ia } = await db.from("internal_access").select("staff_email");
          for (const a of ia || []) internalOk.add(String(a.staff_email).toLowerCase());
        }
      }
    }
    const byPerson = new Map<string, any[]>();
    for (const t of tasks || []) {
      const e = String(t.assignee_email).toLowerCase();
      if (!activeStaff.has(e)) continue;
      if (t.client_id && testIds.has(String(t.client_id))) continue;
      if (t.client_id && internalIds.has(String(t.client_id))) {
        if (!internalNotify) continue;
        if (!byPerson.has(internalNotify)) byPerson.set(internalNotify, []);
        byPerson.get(internalNotify)!.push(t);
        continue;
      }
      if (t.client_id && !admins.has(e) && !reach.has(e + "|" + t.client_id)) continue;   // D3
      if (!byPerson.has(e)) byPerson.set(e, []);
      byPerson.get(e)!.push(t);
    }
    const prefs = await prefsFor(db, [...byPerson.keys()]);
    const since = new Date(Date.now() - 20 * 3600000).toISOString();
    for (const [to, list] of byPerson) {
      if (!wants(prefs.get(to), "staff_task_due")) {
        summary.skipped++;
        continue;
      }
      const { count } = await db.from("client_email_log").select("id", { count: "exact", head: true })
        .eq("feature", "staff_task_due").eq("status", "sent").contains("recipients", [to]).gte("created_at", since);
      if ((count || 0) > 0) continue;
      const shown = list.slice(0, 15);
      const more = list.length - shown.length;
      const subject = `${plural(list.length, "task")} due today`;
      const items = shown.map((t) => esc(String(t.text || "").slice(0, 200)));
      const email = staffEmail({
        subject,
        preheader: shown.map((t) => t.text).join(", ").slice(0, 140),
        lines: [`You have ${plural(list.length, "open task")} due today (${esc(fmtDay(today))}):`, L.bullets([...items, ...(more > 0 ? [L.tone(`and ${more} more`, "muted")] : [])])],
        textLines: [`You have ${plural(list.length, "open task")} due today (${fmtDay(today)}):`, ...shown.map((t) => `- ${String(t.text || "").slice(0, 200)}`), ...(more > 0 ? [`and ${more} more`] : [])],
        cta: "Open your tasks",
        href: `${APP_URL}#/work/tasks`,
      });
      await deliver("staff_task_due", to, email, null);
    }
    return json({ status: "ok", job, summary });
  }

  // -------------------------------------------------------------------------
  // Outbox
  // -------------------------------------------------------------------------
  const { data: rows } = await db
    .from("notification_outbox")
    .select("*")
    .is("processed_at", null)
    .order("created_at", { ascending: true })
    .limit(BATCH);
  const pending = rows || [];
  if (!pending.length) return json({ status: "ok", job, summary });

  const finish = async (ids: number[], status: string, reason: string | null) => {
    if (!ids.length) return;
    await db.from("notification_outbox").update({ processed_at: new Date().toISOString(), status, reason }).in("id", ids);
  };

  // Drop stale rows (the function was down, or email was off for days).
  const now = Date.now();
  const stale = pending.filter((r: any) => now - Date.parse(r.created_at) > STALE_MS);
  await finish(stale.map((r: any) => r.id), "skipped", "Too old to send");
  summary.skipped += stale.length;
  // Approver notices still inside their batching window stay queued
  // (untouched) for a later run.
  const fresh = pending.filter((r: any) => now - Date.parse(r.created_at) <= STALE_MS && !isHeld(r, now));

  const clientIds = [...new Set(fresh.map((r: any) => r.client_id).filter(Boolean))];
  const clients = new Map<string, any>();
  const clientPrefs = new Map<string, any>();
  if (clientIds.length) {
    const { data: cs } = await db.from("clients").select("id, name, test_only, is_internal, assigned_bookkeeper, assigned_bookkeeper_email").in("id", clientIds);
    for (const c of cs || []) clients.set(c.id, c);
    const { data: cp } = await db.from("client_email_prefs").select("*").in("client_id", clientIds);
    for (const c of cp || []) clientPrefs.set(c.client_id, c);
  }
  // MGB (internal) staff emails (task, message, upload, mention) go to the one
  // configured address instead of the people on the row; nothing is sent when
  // it is unset. Client-facing kinds for it are already skipped further down.
  const isInternalRow = (r: any) => !!r.client_id && !isClientKind(r.kind as Kind) && !!clients.get(r.client_id)?.is_internal;
  const toSkip: any[] = [];
  const routed: any[] = [];
  for (const r of fresh) {
    if (!isInternalRow(r)) { routed.push(r); continue; }
    if (!internalNotify) { toSkip.push(r); continue; }
    routed.push({ ...r, recipient_email: internalNotify });
  }
  await finish(toSkip.map((r: any) => r.id), "skipped", "Internal company emails have no address set");
  summary.skipped += new Set(toSkip.map((r: any) => `${r.kind}|${r.recipient_email}|${r.client_id}`)).size;
  const recipients = [...new Set(routed.map((r: any) => String(r.recipient_email).toLowerCase()))];
  const prefs = await prefsFor(db, recipients);
  // Group per kind + person + organization: one email per group.
  const groups = new Map<string, any[]>();
  for (const r of routed) {
    // Loop-ins and @mentions (payload.loop_in, supabase/account-manager.sql)
    // share kind staff_client_message but get their own email.
    const key = `${r.kind}|${r.recipient_email}|${r.client_id || ""}${r.payload?.loop_in ? "|loop" : ""}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  // Bookkeeper signatures for client emails.
  const bkEmails = [...new Set([...clients.values()].map((c) => String(c.assigned_bookkeeper_email || "").toLowerCase()).filter(Boolean))];
  const bkSigs = await loadSignoffs(db, bkEmails);

  for (const [, list] of groups) {
    const kind = list[0].kind as Kind;
    const to = String(list[0].recipient_email).toLowerCase();
    const clientId: string | null = list[0].client_id || null;
    const client = clientId ? clients.get(clientId) : null;
    const ids = list.map((r: any) => r.id);
    const skip = async (reason: string) => {
      summary.skipped++;
      await finish(ids, "skipped", reason);
    };

    // A kind this deploy doesn't know (newer SQL than function): skip the
    // row instead of throwing in wants() and stopping every later email.
    if (!PREF[kind]) {
      await skip("Unknown email kind");
      continue;
    }
    if (!wants(prefs.get(to), kind)) {
      await skip("Turned off in the person's settings");
      continue;
    }
    if (clientId && !client) {
      await skip("Organization no longer exists");
      continue;
    }

    let email: Email;
    let headers: Record<string, string> | undefined;
    let extra: Record<string, unknown> = {};

    if (!isClientKind(kind)) {
      // Inventory requests go to the shared admin inbox, which isn't a portal login.
      if (kind !== "staff_tech_request" && !activeStaff.has(to)) {
        await skip("Not an active staff member");
        continue;
      }
      if (kind === "handbook_sign_needed" && !(staffRows || []).some((x: any) => x.active && x.role === "bookkeeper" && String(x.email).toLowerCase() === to)) {
        await skip("No longer a bookkeeper (only bookkeepers sign staff policies)");
        continue;
      }
      const cname = client?.name || "a client";
      if (kind === "staff_client_message" && list[0].payload?.loop_in) {
        // "Loop in bookkeeper" from the inbox, or an @mention in a reply or note.
        const bys = [...new Set(list.map((r: any) => String(r.payload?.by || r.payload?.author_name || "").trim()).filter(Boolean))];
        const by = bys.length === 1 ? bys[0] : "A teammate";
        const mentioned = list.every((r: any) => r.payload?.mention);
        const what = mentioned ? "mentioned you in a conversation with" : "looped you in on a conversation with";
        email = staffEmail({
          subject: mentioned ? `${by} mentioned you: ${cname}` : `${by} looped you in: ${cname}`,
          preheader: `${by} ${what} ${cname}`,
          lines: [`${esc(by)} ${what} <b>${esc(cname)}</b> in the portal.`],
          textLines: [`${by} ${what} ${cname} in the portal.`],
          cta: "Open Messages",
          href: clientLink(clientId, "messages"),
        });
      } else if (kind === "staff_client_message") {
        const authors = [...new Set(list.map((r: any) => String(r.payload?.author_name || "").trim()).filter(Boolean))];
        const who = authors.length === 1 ? authors[0] : "Your client";
        const n = list.length;
        email = staffEmail({
          subject: `New message from ${cname}`,
          preheader: `${who} sent ${n === 1 ? "a message" : `${n} messages`}`,
          lines: [`${esc(who)} at <b>${esc(cname)}</b> sent ${n === 1 ? "a new message" : `${n} new messages`} in the portal.`],
          textLines: [`${who} at ${cname} sent ${n === 1 ? "a new message" : `${n} new messages`} in the portal.`],
          cta: "Open Messages",
          href: clientLink(clientId, "messages"),
        });
      } else if (kind === "staff_doc_upload") {
        const titles = list.map((r: any) => String(r.payload?.title || "A document")).slice(0, 15);
        email = staffEmail({
          subject: `${list.length === 1 ? "Document uploaded" : `${list.length} documents uploaded`}: ${cname}`,
          preheader: titles.join(", ").slice(0, 140),
          lines: [`<b>${esc(cname)}</b> uploaded ${list.length === 1 ? "a requested document" : `${list.length} requested documents`}:`, L.bullets(titles.map((t) => esc(t)))],
          textLines: [`${cname} uploaded ${list.length === 1 ? "a requested document" : `${list.length} requested documents`}:`, ...titles.map((t) => `- ${t}`)],
          cta: "Open Documents",
          href: clientLink(clientId, "documents"),
        });
      } else if (kind === "staff_task_assigned") {
        const items = list.slice(0, 15).map((r: any) => {
          const pl = r.payload || {};
          return { text: String(pl.text || "A task"), due: pl.due_date ? fmtDay(pl.due_date) : "", by: String(pl.by || "A teammate") };
        });
        const by = [...new Set(items.map((i) => i.by))];
        email = staffEmail({
          subject: list.length === 1 ? `New task for you${client ? `: ${cname}` : ""}` : `${list.length} tasks assigned to you`,
          preheader: items.map((i) => i.text).join(", ").slice(0, 140),
          lines: [
            `${esc(by.length === 1 ? by[0] : "Your team")} assigned you ${list.length === 1 ? "a task" : `${list.length} tasks`}${client ? ` for <b>${esc(cname)}</b>` : ""}:`,
            L.bullets(items.map((i) => `${esc(i.text)}${i.due ? L.tone(` (due ${esc(i.due)})`, "muted") : ""}`)),
          ],
          textLines: [
            `${by.length === 1 ? by[0] : "Your team"} assigned you ${list.length === 1 ? "a task" : `${list.length} tasks`}${client ? ` for ${cname}` : ""}:`,
            ...items.map((i) => `- ${i.text}${i.due ? ` (due ${i.due})` : ""}`),
          ],
          cta: "Open your tasks",
          href: `${APP_URL}#/work/tasks`,
        });
      } else if (kind === "staff_task_review_ready" || kind === "staff_task_sent_back" || kind === "staff_task_mention" || kind === "staff_task_client_answered") {
        const e2 = taskEmail(kind, list, client ? cname : null);
        if (!e2) {
          await skip("Nothing to send");
          continue;
        }
        email = e2;
      } else if (kind === "staff_task_batch") {
        // One summary per person per run (generator digest, OOO handoff and return).
        const pl = list[list.length - 1].payload || {};
        const items: string[] = list.flatMap((r: any) => (Array.isArray(r.payload?.items) ? r.payload.items : [])).map((x: any) => String(x || "").slice(0, 200)).filter(Boolean);
        const shown = items.slice(0, 25);
        const more = items.length - shown.length;
        const title = String(pl.title || "Task update").slice(0, 120);
        const intro = String(pl.intro || "").slice(0, 400);
        email = staffEmail({
          subject: title,
          preheader: (intro || shown.join(", ")).slice(0, 140),
          lines: [...(intro ? [esc(intro)] : []), ...(shown.length ? [L.bullets([...shown.map((t) => esc(t)), ...(more > 0 ? [L.tone(`and ${more} more`, "muted")] : [])])] : [])],
          textLines: [...(intro ? [intro] : []), ...shown.map((t) => `- ${t}`), ...(more > 0 ? [`and ${more} more`] : [])],
          cta: "Open your tasks",
          href: taskHash(pl.hash),
        });
      } else if (kind === "staff_tech_request") {
        const items = list.slice(0, 15).map((r: any) => {
          const pl = r.payload || {};
          return { item: String(pl.item || "Hardware"), priority: String(pl.priority || "Normal"), reason: String(pl.reason || ""), by: String(pl.by || "A teammate") };
        });
        const one = items.length === 1 ? items[0] : null;
        email = staffEmail({
          subject: one ? `Inventory request from ${one.by}: ${one.item}` : `${items.length} new inventory requests`,
          preheader: items.map((i) => `${i.by}: ${i.item}`).join(", ").slice(0, 140),
          lines: [
            one ? "A new hardware request came in:" : "New hardware requests came in:",
            L.bullets(items.map((i) => `<b>${esc(i.item)}</b> for ${esc(i.by)} ${L.tone(`(${esc(i.priority)} priority)`, "muted")}${i.reason ? `<br>${L.tone(esc(i.reason.slice(0, 300)), "muted")}` : ""}`)),
          ],
          textLines: [
            one ? "A new hardware request came in:" : "New hardware requests came in:",
            ...items.map((i) => `- ${i.item} for ${i.by} (${i.priority} priority)${i.reason ? `\n  ${i.reason.slice(0, 300)}` : ""}`),
          ],
          cta: "Open Team › Inventory",
          href: `${APP_URL}#/team/inventory`,
        });
      } else if (kind === "handbook_sign_needed") {
        // One row per published version that needs re-signing; the newest version per policy wins.
        const byPolicy = new Map<string, any>();
        for (const r of list) {
          const pl = r.payload || {};
          const k = String(pl.policy_slug || pl.policy_title || r.ref_id);
          if (!byPolicy.has(k) || Number(pl.version_no) > Number(byPolicy.get(k).version_no)) byPolicy.set(k, pl);
        }
        const items = [...byPolicy.values()].map((pl: any) => ({
          title: String(pl.policy_title || "A staff policy").slice(0, 200),
          v: pl.version_no ? ` v${pl.version_no}` : "",
          due: pl.due_date ? fmtDay(pl.due_date) : "",
          slug: pl.policy_slug,
        }));
        const one = items.length === 1 ? items[0] : null;
        email = staffEmail({
          subject: one ? `Please sign: ${one.title}${one.v}` : `${items.length} staff policies need your signature`,
          preheader: one ? `A new version needs your signature${one.due ? ` by ${one.due}` : ""}` : items.map((i) => i.title).join(", ").slice(0, 140),
          lines: [
            one
              ? `A new version of <b>${esc(one.title)}</b>${esc(one.v)} was published and needs your signature${one.due ? ` by <b>${esc(one.due)}</b>` : ""}.`
              : "New versions of these staff policies need your signature:",
            ...(one ? [] : [L.bullets(items.map((i) => `<b>${esc(i.title)}</b>${esc(i.v)}${i.due ? L.tone(` (sign by ${esc(i.due)})`, "muted") : ""}`))]),
            "Read it in the portal under HR › Handbook, then sign at the bottom.",
          ],
          textLines: [
            one
              ? `A new version of ${one.title}${one.v} was published and needs your signature${one.due ? ` by ${one.due}` : ""}.`
              : "New versions of these staff policies need your signature:",
            ...(one ? [] : items.map((i) => `- ${i.title}${i.v}${i.due ? ` (sign by ${i.due})` : ""}`)),
            "Read it in the portal under HR › Handbook, then sign at the bottom.",
          ],
          cta: one ? "Read and sign" : "Open the Handbook",
          href: one ? handbookLink(one.slug) : handbookLink(null),
        });
      } else if (kind === "handbook_approval_needed") {
        // Batched approver notice: re-check who approves and count live.
        const { data: hs } = await db.from("handbook_settings").select("policy_approver_email").eq("id", 1).maybeSingle();
        const { count, error: cErr } = await db.from("handbook_policies")
          .select("id", { count: "exact", head: true })
          .eq("status", "draft").eq("active", true).eq("approval_status", "pending");
        const why = approvalSkipReason({
          to,
          approverSetting: hs?.policy_approver_email ?? null,
          isActiveAdmin: (staffRows || []).some((x: any) => x.active && x.role === "admin" && String(x.email).toLowerCase() === to),
          pending: cErr ? null : (count ?? null),
        });
        if (why) {
          await skip(why);
          continue;
        }
        email = staffEmail(approvalEmail(count!, APP_URL));
      } else if (kind === "handbook_countersign_needed") {
        const items = list.slice(0, 15).map((r: any) => {
          const pl = r.payload || {};
          return {
            who: String(pl.signer_name || "A teammate").slice(0, 120),
            title: String(pl.policy_title || "a staff policy").slice(0, 200),
            v: pl.version_no ? ` v${pl.version_no}` : "",
            slug: pl.policy_slug,
          };
        });
        const one = items.length === 1 ? items[0] : null;
        const slugs = [...new Set(items.map((i) => String(i.slug || "")))];
        email = staffEmail({
          subject: one ? `Countersign: ${one.who}, ${one.title}` : `${items.length} handbook signatures to countersign`,
          preheader: one ? `${one.who} signed ${one.title}${one.v}` : items.map((i) => `${i.who}: ${i.title}`).join(", ").slice(0, 140),
          lines: [
            one
              ? `${esc(one.who)} signed <b>${esc(one.title)}</b>${esc(one.v)}. It's ready for your countersignature.`
              : "These staff policy signatures are ready for your countersignature:",
            ...(one ? [] : [L.bullets(items.map((i) => `${esc(i.who)}: <b>${esc(i.title)}</b>${esc(i.v)}`))]),
            "Countersign in the portal under HR › Handbook. The signed copy is filed once you do.",
          ],
          textLines: [
            one
              ? `${one.who} signed ${one.title}${one.v}. It's ready for your countersignature.`
              : "These staff policy signatures are ready for your countersignature:",
            ...(one ? [] : items.map((i) => `- ${i.who}: ${i.title}${i.v}`)),
            "Countersign in the portal under HR › Handbook. The signed copy is filed once you do.",
          ],
          cta: "Open the Handbook",
          href: handbookLink(slugs.length === 1 ? slugs[0] : null),
        });
      } else {
        // staff_feedback_status: the latest change per feedback item wins.
        const latest = new Map<string, any>();
        for (const r of list) latest.set(String(r.ref_id), r);
        const items = [...latest.values()].map((r: any) => r.payload || {});
        const one = items.length === 1 ? items[0] : null;
        const statusLabel = (s: string) => FEEDBACK_STATUS[s] || s;
        email = staffEmail({
          subject: one ? `Your feedback is now: ${statusLabel(one.status)}` : `${items.length} of your feedback items were updated`,
          preheader: items.map((i) => String(i.message || "")).join(", ").slice(0, 140),
          lines: [
            one ? "An admin updated the status of your feedback:" : "An admin updated the status of your feedback items:",
            L.bullets(items.map((i) => `<b>${esc(statusLabel(i.status))}</b>: ${esc(String(i.message || "").slice(0, 160))}${i.note ? `<br>${L.tone(`Note: ${esc(i.note)}`, "muted")}` : ""}`)),
          ],
          textLines: [
            one ? "An admin updated the status of your feedback:" : "An admin updated the status of your feedback items:",
            ...items.map((i) => `- ${statusLabel(i.status)}: ${String(i.message || "").slice(0, 160)}${i.note ? `\n  Note: ${i.note}` : ""}`),
          ],
          cta: "Open MyGoodBooks",
          href: APP_URL,
        });
      }
    } else {
      // Client kinds: master switch, org opt-out, test client, membership, unsubscribe.
      if (!settings || settings.enabled === false) {
        await skip("Client emails are turned off (master switch)");
        continue;
      }
      const cp = clientPrefs.get(clientId!);
      if (cp?.opt_out_all) {
        await skip("This client is opted out of all emails");
        continue;
      }
      if (client.test_only) {
        await skip("Test client");
        continue;
      }
      if (client.is_internal) {
        await skip("Internal company profile");
        continue;
      }
      const { data: member } = await db.from("client_users").select("email").eq("client_id", clientId).eq("active", true).ilike("email", to.replace(/[\\%_]/g, "\\$&")).limit(1).maybeSingle();
      if (!member) {
        await skip("Not an active portal user of this organization");
        continue;
      }
      await db.from("client_email_recipients").upsert([{ client_id: clientId, email: to }], { onConflict: "client_id,email", ignoreDuplicates: true });
      const { data: rec } = await db.from("client_email_recipients").select("token, opted_out_at").eq("client_id", clientId).eq("email", to).maybeSingle();
      if (!rec?.token || rec.opted_out_at) {
        await skip("Unsubscribed");
        continue;
      }
      const unsubUrl = `${UNSUB_PAGE}?t=${encodeURIComponent(rec.token)}`;
      const oneClick = `${SUPABASE_URL}/functions/v1/client-emails?unsub=${encodeURIComponent(rec.token)}`;
      headers = { "List-Unsubscribe": `<${oneClick}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" };
      const bkName = client.assigned_bookkeeper?.name || null;
      const bkSig = bkSigs.get(String(client.assigned_bookkeeper_email || "").toLowerCase()) || null;
      if (kind === "client_message") {
        const n = list.length;
        const who = bkName || "Your bookkeeper";
        email = clientEmail({
          subject: `New message from ${who}`,
          preheader: `${n === 1 ? "A new message" : `${n} new messages`} in your portal`,
          clientName: client.name,
          lines: [`${esc(who)} sent you ${n === 1 ? "a new message" : `${n} new messages`} about ${esc(client.name)}. Open your portal to read and reply.`],
          textLines: [`${who} sent you ${n === 1 ? "a new message" : `${n} new messages`} about ${client.name}. Open your portal to read and reply.`],
          cta: "Read in your portal",
          href: clientLink(clientId, "messages"),
          bkName, signature: bkSig, unsubUrl,
        });
      } else {
        const periods = [...new Set(list.map((r: any) => String(r.payload?.period || "").slice(0, 10)).filter(Boolean))].sort();
        const period = periods[periods.length - 1] || null;
        const month = period ? monthName(period) : "the month";
        extra = { period };
        email = clientEmail({
          subject: `Your ${month} reports are ready: ${client.name}`,
          preheader: `Your books for ${month} are closed`,
          clientName: client.name,
          lines: [`Good news: we've finished closing ${esc(client.name)}'s books for ${esc(month)}. Your reports are ready to view in your portal.`],
          textLines: [`Good news: we've finished closing ${client.name}'s books for ${month}. Your reports are ready to view in your portal.`],
          cta: "View your reports",
          href: clientLink(clientId, "reports"),
          bkName, signature: bkSig, unsubUrl,
        });
      }
    }

    const res = await deliver(kind, to, email, clientId, extra, headers);
    await finish(ids, res.status, res.reason);
  }

  return json({ status: "ok", job, processed: pending.length, summary });
});
