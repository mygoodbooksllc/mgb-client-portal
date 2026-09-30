import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { emailConfigured, esc, sendEmail } from "../_shared/email.ts";
import * as L from "../_shared/layout.ts";

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

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APP_URL = "https://app.mygoodbooks.org/";
const UNSUB_PAGE = "https://app.mygoodbooks.org/unsubscribe";
const TZ = "America/New_York";
const STALE_MS = 2 * 86400000; // queued rows older than this are dropped, not sent
const BATCH = 500;

type Kind =
  | "staff_client_message" | "staff_doc_upload" | "staff_task_assigned" | "staff_task_due"
  | "staff_feedback_status" | "client_message" | "client_reports_ready";

// Settings key and default for each kind (matches components/settings/Settings.jsx).
const PREF: Record<Kind, { key: string; def: boolean }> = {
  staff_client_message: { key: "client_message", def: true },
  staff_doc_upload: { key: "doc_upload", def: true },
  staff_task_assigned: { key: "task_assigned", def: true },
  staff_task_due: { key: "task_due", def: false },
  staff_feedback_status: { key: "feedback_status", def: true },
  client_message: { key: "bookkeeper_message", def: true },
  client_reports_ready: { key: "reports_ready", def: true },
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
function clientLink(clientId: string | null, page: string) {
  return clientId ? `${APP_URL}#/client/${encodeURIComponent(clientId)}/${page}` : APP_URL;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
type Email = { subject: string; html: string; text: string };
const p = (html: string, tone: "text" | "muted" = "text", size = 15) => L.p(html, { tone, size });

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

function signoffHtml(name: string | null, signature: string | null) {
  if (signature) return p(`${esc(signature).replace(/\n/g, "<br>")}`);
  return p(`Thank you,<br>${name ? `${esc(name)}<br>` : ""}${L.tone("MyGoodBooks", "muted")}`);
}
function signoffText(name: string | null, signature: string | null) {
  if (signature) return [signature];
  return ["Thank you,", ...(name ? [name] : []), "MyGoodBooks"];
}

function clientEmail(o: {
  subject: string; preheader: string; clientName: string; lines: string[]; textLines: string[];
  cta: string; href: string; bkName: string | null; signature: string | null; unsubUrl: string;
}): Email {
  const html = L.emailDocument({
    title: o.subject,
    preheader: o.preheader,
    subtitle: `Bookkeeping for ${o.clientName}`,
    cards: L.card(p("Hi there,") + o.lines.map((l) => p(l)).join("") + L.button(o.cta, o.href) + signoffHtml(o.bkName, o.signature)),
    footer: `You're receiving this because you have access to ${esc(o.clientName)}'s MyGoodBooks portal. You can turn this email off under Settings in your portal, or ${L.link(o.unsubUrl, "unsubscribe", "muted")} from these emails.`,
  });
  const text = [
    "Hi there,", "", ...o.textLines, "", `${o.cta}: ${o.href}`, "", ...signoffText(o.bkName, o.signature), "",
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

  const { data: staffRows } = await db.from("staff").select("email, name, active");
  const activeStaff = new Map<string, string>();
  for (const s of staffRows || []) if (s.active) activeStaff.set(String(s.email).toLowerCase(), s.name || s.email);

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
    const { data: tasks } = await db
      .from("staff_reminders")
      .select("id, text, client_id, assignee_email")
      .eq("done", false)
      .eq("due_date", today)
      .not("assignee_email", "is", null)
      .order("created_at", { ascending: true });
    const byPerson = new Map<string, any[]>();
    for (const t of tasks || []) {
      const e = String(t.assignee_email).toLowerCase();
      if (!activeStaff.has(e)) continue;
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
        cta: "Open My Tasks",
        href: `${APP_URL}#/tasks`,
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
  const fresh = pending.filter((r: any) => now - Date.parse(r.created_at) <= STALE_MS);

  // Group per kind + person + organization: one email per group.
  const groups = new Map<string, any[]>();
  for (const r of fresh) {
    const key = `${r.kind}|${r.recipient_email}|${r.client_id || ""}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  const recipients = [...new Set(fresh.map((r: any) => r.recipient_email))];
  const prefs = await prefsFor(db, recipients);
  const clientIds = [...new Set(fresh.map((r: any) => r.client_id).filter(Boolean))];
  const clients = new Map<string, any>();
  const clientPrefs = new Map<string, any>();
  if (clientIds.length) {
    const { data: cs } = await db.from("clients").select("id, name, test_only, assigned_bookkeeper, assigned_bookkeeper_email").in("id", clientIds);
    for (const c of cs || []) clients.set(c.id, c);
    const { data: cp } = await db.from("client_email_prefs").select("*").in("client_id", clientIds);
    for (const c of cp || []) clientPrefs.set(c.client_id, c);
  }
  // Bookkeeper signatures for client emails.
  const bkEmails = [...new Set([...clients.values()].map((c) => String(c.assigned_bookkeeper_email || "").toLowerCase()).filter(Boolean))];
  const bkPrefs = await prefsFor(db, bkEmails);

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
      if (!activeStaff.has(to)) {
        await skip("Not an active staff member");
        continue;
      }
      const cname = client?.name || "a client";
      if (kind === "staff_client_message") {
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
          cta: "Open My Tasks",
          href: `${APP_URL}#/tasks`,
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
      const bkSig = String(bkPrefs.get(String(client.assigned_bookkeeper_email || "").toLowerCase())?.signature || "").trim() || null;
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
