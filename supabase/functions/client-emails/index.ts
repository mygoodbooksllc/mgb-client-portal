import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { emailConfigured, esc, sendEmail } from "../_shared/email.ts";
import * as L from "../_shared/layout.ts";
import { loadSignoffs, signoffHtml, signoffText } from "../_shared/signature.ts";

// Client-facing emails (supabase/client-emails.sql has the schema + rules).
//   job "doc_chaser"   : missing-documents reminders (daily cron)
//   job "value_report" : monthly value report (cron on the 3rd; default OFF)
//
// Callers / auth (verify_jwt is OFF; these checks are the gate):
//   (a) pg_cron via client_emails_cron(job) with the Vault qbo_cron_key (or the
//       service_role key) as bearer. Body {"job": ..., "trigger": "cron"}.
//   (b) an active ADMIN's own JWT (is_active_staff_admin()). Body
//       {"job", "action": "preview" | "test", "client_id", "period"?}
//         preview -> returns the email HTML (text/html), sends nothing
//         test    -> sends that client's email to the admin only
//   (c) anyone holding an unsubscribe token (no auth; the token is the proof):
//       POST {"action": "unsubscribe" | "resubscribe" | "unsub_info", "token"}
//       from the /unsubscribe page, or an RFC 8058 one-click POST to
//       ?unsub=<token> (List-Unsubscribe-Post). Sets that recipient's
//       client_email_recipients.opted_out_at for that client.
//
// Every real send (cron and test) passes gate(): global kill switch, feature
// switch, the client's opt-outs (and chaser pause), and test_only (cron only).
// Every attempt is logged in client_email_log. Never includes fees, rates or
// margins.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const PORTAL_URL = "https://app.mygoodbooks.org/";
const UNSUB_PAGE = "https://app.mygoodbooks.org/unsubscribe";
const UNSUB_SLOT = "__MGB_UNSUB_URL__"; // replaced per recipient before sending
const TEST_UNSUB_URL = `${UNSUB_PAGE}?t=test`;
const TZ = "America/New_York";

type Job = "doc_chaser" | "value_report";
type Trigger = "cron" | "test" | "preview";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Expose-Headers": "X-Would-Send",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
function secretsMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---------------------------------------------------------------------------
// Dates (America/New_York)
// ---------------------------------------------------------------------------
function dateIn(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);
}
function prevMonthStart(today: string): string {
  const [y, m] = today.split("-").map(Number);
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  return `${py}-${String(pm).padStart(2, "0")}-01`;
}
function nextMonthStart(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}
// Midnight in New York on `iso` as an ISO instant.
function nyMidnight(iso: string): string {
  for (const off of ["-05:00", "-04:00"]) {
    const d = new Date(`${iso}T00:00:00${off}`);
    const h = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "2-digit", hourCycle: "h23" }).format(d);
    if (h === "00" && dateIn(d) === iso) return d.toISOString();
  }
  return new Date(`${iso}T05:00:00Z`).toISOString();
}
function fmtDay(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00Z`);
  return d.toLocaleDateString("en-US", { timeZone: "UTC", month: "long", day: "numeric" });
}
function monthName(period: string): string {
  return new Date(`${period}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "long", year: "numeric" });
}
function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

// ---------------------------------------------------------------------------
// Gate: every real send goes through this.
// ---------------------------------------------------------------------------
function gate(job: Job, trigger: Trigger, settings: any, prefs: any, client: any): string | null {
  if (!settings || settings.enabled === false) return "Client emails are turned off (master switch)";
  if (job === "doc_chaser" && settings.doc_chaser_enabled !== true) return "The missing-documents chaser is turned off";
  if (job === "value_report" && settings.value_report_enabled !== true) return "The monthly value report is turned off";
  if (prefs?.opt_out_all) return "This client is opted out of all emails";
  if (job === "doc_chaser" && prefs?.opt_out_doc_chaser) return "This client is opted out of document reminders";
  if (job === "value_report" && prefs?.opt_out_value_report) return "This client is opted out of the value report";
  if (job === "doc_chaser" && prefs?.chaser_paused) return "Reminders are paused for this client";
  if (trigger === "cron" && client?.test_only) return "Test client";
  return null;
}

// ---------------------------------------------------------------------------
// Rendering: the shared MyGoodBooks layout (../_shared/layout.ts).
// ---------------------------------------------------------------------------
function p(html: string, t: "text" | "muted" = "text", size = 15) {
  return L.p(html, { tone: t, size });
}
function button(label: string) {
  return L.button(label, PORTAL_URL);
}
function shell(opts: { title: string; preheader: string; body: string; clientName: string }) {
  return L.emailDocument({
    title: opts.title,
    preheader: opts.preheader,
    subtitle: `Bookkeeping for ${opts.clientName}`,
    cards: L.card(opts.body),
    footer: `You're receiving this because you have access to ${esc(opts.clientName)}'s MyGoodBooks portal. Questions? Just reply to this email. ${L.link(UNSUB_SLOT, "Unsubscribe", "muted")} from these emails.`,
  });
}
// The assigned bookkeeper's sign-off (Settings > Email signature text, plus
// their Profile photo when they turned that on) replaces the default sign-off.
// Loaded into client._signoff before rendering; see ../_shared/signature.ts.
async function withSignatures(db: SupabaseClient, clients: any[]): Promise<any[]> {
  const sigs = await loadSignoffs(db, clients.map((c) => String(c.assigned_bookkeeper_email || "")));
  return clients.map((c) => ({ ...c, _signoff: sigs.get(String(c.assigned_bookkeeper_email || "").toLowerCase()) || null }));
}
// Monthly summary: people who turned it off in their own Settings
// (notify.email.monthly_summary === false) are left out, and when the main
// contact picked who receives it (client_email_prefs.summary_recipients) only
// those people get it.
async function summaryFilter(db: SupabaseClient, to: { email: string; token: string }[], prefs: any) {
  const chosen: string[] = Array.isArray(prefs?.summary_recipients) ? prefs.summary_recipients.map((e: string) => String(e).toLowerCase()) : [];
  let list = chosen.length ? to.filter((r) => chosen.includes(r.email.toLowerCase())) : to;
  if (!list.length) return list;
  const { data } = await db.from("user_settings").select("user_email, settings").in("user_email", list.map((r) => r.email.toLowerCase()));
  const off = new Set((data || []).filter((r: any) => r.settings?.notify?.email?.monthly_summary === false).map((r: any) => String(r.user_email).toLowerCase()));
  list = list.filter((r) => !off.has(r.email.toLowerCase()));
  return list;
}

function renderChaser(client: any, requests: any[], firstTime: boolean) {
  const bk = client.assigned_bookkeeper?.name || null;
  const n = requests.length;
  const subject = firstTime
    ? `${n === 1 ? "A document" : `${n} documents`} needed for ${client.name}`
    : `Friendly reminder: ${plural(n, "document")} still needed for ${client.name}`;
  const items = requests
    .map((r) => {
      const small = (h: string) => `<br><span class="mgb-muted" style="color:${L.T.muted};font-size:13.5px;">${h}</span>`;
      const due = r.due_date ? small(`Needed by ${esc(fmtDay(r.due_date))}`) : "";
      const det = r.details ? small(esc(r.details)) : "";
      return `<b class="mgb-ink" style="color:${L.T.ink};font-weight:600;">${esc(r.title)}</b>${det}${due}`;
    });
  const body =
    p("Hi there,") +
    p(firstTime
      ? `To keep ${esc(client.name)}'s books up to date, we need the following from you:`
      : `Just a friendly reminder. To keep ${esc(client.name)}'s books up to date, we're still waiting on:`) +
    L.ruledList(items) +
    p("You can upload each one in your portal under <b>Documents</b>. It goes straight to your bookkeeper.") +
    button("Upload in your portal") +
    p("If you've already sent these another way, just reply and let us know.", "muted", 14) +
    signoffHtml(client._signoff, bk);
  const text = [
    "Hi there,",
    "",
    firstTime
      ? `To keep ${client.name}'s books up to date, we need the following from you:`
      : `Just a friendly reminder. To keep ${client.name}'s books up to date, we're still waiting on:`,
    "",
    ...requests.map((r) => `- ${r.title}${r.due_date ? ` (needed by ${fmtDay(r.due_date)})` : ""}${r.details ? `\n  ${r.details}` : ""}`),
    "",
    `Upload each one in your portal under Documents: ${PORTAL_URL}`,
    "If you've already sent these another way, just reply and let us know.",
    "",
    ...signoffText(client._signoff, bk),
    "",
    `Unsubscribe from these emails: ${UNSUB_SLOT}`,
  ].join("\n");
  const html = shell({ title: subject, preheader: requests.map((r) => r.title).join(", "), body, clientName: client.name });
  return { subject, html, text };
}

const CLOSE_LABEL: Record<string, string> = {
  done: "Closed. Your books for the month are final.",
  review: "In final review.",
  in_progress: "In progress.",
  not_started: "Starting soon.",
};

function renderValue(client: any, period: string, v: any) {
  const bk = client.assigned_bookkeeper?.name || null;
  const month = monthName(period);
  const subject = `Your ${month} bookkeeping summary: ${client.name}`;
  const hours = Math.round(v.hours * 10) / 10;
  const stats = L.statTiles([
    { value: String(hours), label: hours === 1 ? "hour on your books" : "hours on your books" },
    { value: String(v.tasks.count), label: v.tasks.count === 1 ? "task completed" : "tasks completed" },
    { value: String(v.docs.count), label: v.docs.count === 1 ? "document received" : "documents received" },
  ]);
  const list = (title: string, rows: string[], more: number) =>
    rows.length
      ? L.label(title) +
        L.bullets([...rows.map((r) => esc(r)), ...(more > 0 ? [L.tone(`and ${more} more`, "muted")] : [])])
      : "";
  const closeLine = v.close && CLOSE_LABEL[v.close] ? p(`<b>Month-end close:</b> ${esc(CLOSE_LABEL[v.close])}`) : "";
  const body =
    p("Hi there,") +
    p(`Here's a quick look at what we did for ${esc(client.name)} in ${esc(month)}.`) +
    stats +
    closeLine +
    list("Completed for you", v.tasks.items, v.tasks.count - v.tasks.items.length) +
    list("Documents received", v.docs.items, v.docs.count - v.docs.items.length) +
    button("Open your portal") +
    signoffHtml(client._signoff, bk);
  const text = [
    "Hi there,",
    "",
    `Here's a quick look at what we did for ${client.name} in ${month}.`,
    "",
    `- ${hours} hours on your books`,
    `- ${plural(v.tasks.count, "task")} completed`,
    `- ${plural(v.docs.count, "document")} received`,
    ...(v.close && CLOSE_LABEL[v.close] ? [`- Month-end close: ${CLOSE_LABEL[v.close]}`] : []),
    ...(v.tasks.items.length ? ["", "Completed for you:", ...v.tasks.items.map((t: string) => `  - ${t}`)] : []),
    ...(v.docs.items.length ? ["", "Documents received:", ...v.docs.items.map((t: string) => `  - ${t}`)] : []),
    "",
    `Your portal: ${PORTAL_URL}`,
    "",
    ...signoffText(client._signoff, bk),
    "",
    `Unsubscribe from these emails: ${UNSUB_SLOT}`,
  ].join("\n");
  const html = shell({ title: subject, preheader: `${hours} hours, ${plural(v.tasks.count, "task")} completed, ${plural(v.docs.count, "document")} received`, body, clientName: client.name });
  return { subject, html, text };
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------
async function portalEmails(db: SupabaseClient, clientId: string): Promise<string[]> {
  const { data } = await db.from("client_users").select("email").eq("client_id", clientId).eq("active", true);
  return [...new Set((data || []).map((r: any) => String(r.email || "").trim().toLowerCase()).filter(Boolean))];
}

// Active portal users minus anyone who unsubscribed, each with their own
// unsubscribe token (created on first use; random, unguessable).
async function recipientsFor(db: SupabaseClient, clientId: string): Promise<{ to: { email: string; token: string }[]; optedOut: number; total: number }> {
  const emails = await portalEmails(db, clientId);
  if (!emails.length) return { to: [], optedOut: 0, total: 0 };
  await db.from("client_email_recipients").upsert(emails.map((email) => ({ client_id: clientId, email })), { onConflict: "client_id,email", ignoreDuplicates: true });
  const { data } = await db.from("client_email_recipients").select("email, token, opted_out_at").eq("client_id", clientId).in("email", emails);
  const rows = data || [];
  const to = rows.filter((r: any) => !r.opted_out_at && r.token).map((r: any) => ({ email: r.email, token: r.token }));
  return { to, optedOut: rows.filter((r: any) => r.opted_out_at).length, total: emails.length };
}

function withUnsub(s: string, url: string) {
  return s.split(UNSUB_SLOT).join(url);
}

// One email per recipient so each carries its own unsubscribe link.
async function sendToEach(
  to: { email: string; token: string }[],
  email: { subject: string; html: string; text: string },
  opts: { replyTo?: string; job: Job },
): Promise<{ ok: string[]; failed: string[]; ids: string[]; error: string | null }> {
  const fnUrl = `${SUPABASE_URL}/functions/v1/client-emails`;
  const out = { ok: [] as string[], failed: [] as string[], ids: [] as string[], error: null as string | null };
  for (const r of to) {
    const url = `${UNSUB_PAGE}?t=${encodeURIComponent(r.token)}`;
    const oneClick = `${fnUrl}?unsub=${encodeURIComponent(r.token)}`;
    const sent = await sendEmail({
      to: [r.email], subject: email.subject, html: withUnsub(email.html, esc(url)), text: withUnsub(email.text, url),
      replyTo: opts.replyTo, tags: [{ name: "kind", value: opts.job }],
      headers: { "List-Unsubscribe": `<${oneClick}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
    });
    if (sent.ok) {
      out.ok.push(r.email);
      if (sent.id) out.ids.push(sent.id);
    } else {
      out.failed.push(r.email);
      out.error = sent.error;
    }
  }
  return out;
}

// Unsubscribe / resubscribe by token. No auth: the 64-hex-char random token is the proof.
async function handleUnsub(db: SupabaseClient, token: string, action: "unsubscribe" | "resubscribe" | "unsub_info", via: string) {
  if (!/^[a-f0-9]{32,128}$/.test(token)) return json({ status: "invalid" }, 404);
  const { data: row } = await db.from("client_email_recipients").select("client_id, email, opted_out_at").eq("token", token).maybeSingle();
  if (!row) return json({ status: "invalid" }, 404);
  const { data: client } = await db.from("clients").select("name").eq("id", row.client_id).maybeSingle();
  const [user, domain] = String(row.email).split("@");
  const masked = `${user.slice(0, 1)}${"*".repeat(Math.max(1, Math.min(6, user.length - 1)))}@${domain}`;
  const base = { client: client?.name || "your organization", email: masked };
  if (action === "unsub_info") return json({ status: row.opted_out_at ? "unsubscribed" : "subscribed", ...base });
  const patch = action === "unsubscribe"
    ? { opted_out_at: row.opted_out_at || new Date().toISOString(), opted_out_via: via }
    : { opted_out_at: null, opted_out_via: null };
  const { error } = await db.from("client_email_recipients").update(patch).eq("token", token);
  if (error) return json({ status: "error" }, 500);
  return json({ status: action === "unsubscribe" ? "unsubscribed" : "subscribed", ...base });
}

async function valueData(db: SupabaseClient, clientId: string, period: string) {
  const next = nextMonthStart(period);
  const fromTs = nyMidnight(period);
  const toTs = nyMidnight(next);

  let minutes = 0;
  const { data: res } = await db.from("qbo_customer_resolution").select("realm_id, qbo_customer_id").eq("client_id", clientId);
  if (res && res.length) {
    const ids = [...new Set(res.map((r: any) => r.qbo_customer_id))];
    const keys = new Set(res.map((r: any) => `${r.realm_id}|${r.qbo_customer_id}`));
    const { data: acts } = await db
      .from("qbo_time_activities")
      .select("realm_id, customer_qbo_id, minutes")
      .in("customer_qbo_id", ids)
      .gte("txn_date", period)
      .lt("txn_date", next);
    for (const a of acts || []) if (keys.has(`${a.realm_id}|${a.customer_qbo_id}`)) minutes += Number(a.minutes || 0);
  }

  const { data: tasks, count: taskCount } = await db
    .from("staff_reminders")
    .select("text", { count: "exact" })
    .eq("client_id", clientId)
    .eq("visibility", "shared")
    .eq("done", true)
    .gte("completed_at", fromTs)
    .lt("completed_at", toTs)
    .order("completed_at", { ascending: true })
    .limit(10);

  const { data: close } = await db.from("month_close").select("status").eq("client_id", clientId).eq("period", period).maybeSingle();

  const { data: reqs } = await db
    .from("client_doc_requests")
    .select("title")
    .eq("client_id", clientId)
    .in("status", ["uploaded", "done"])
    .gte("fulfilled_at", fromTs)
    .lt("fulfilled_at", toTs)
    .order("fulfilled_at", { ascending: true });
  const { data: docs } = await db
    .from("client_documents")
    .select("name")
    .eq("client_id", clientId)
    .gte("created_at", fromTs)
    .lt("created_at", toTs)
    .order("created_at", { ascending: true });
  const docNames = [...(reqs || []).map((r: any) => r.title), ...(docs || []).map((d: any) => d.name)].filter(Boolean);

  return {
    hours: minutes / 60,
    tasks: { count: taskCount ?? (tasks || []).length, items: (tasks || []).map((t: any) => String(t.text || "").slice(0, 140)) },
    close: close?.status && close.status !== "na" ? close.status : null,
    docs: { count: docNames.length, items: docNames.slice(0, 10) },
  };
}

// Reminder spacing after the Nth reminder: day 0, +3 (day 3), +4 (day 7), then weekly.
function gapAfter(sent: number): number {
  return sent === 0 ? 0 : sent === 1 ? 3 : sent === 2 ? 4 : 7;
}
function isDue(chase: any, today: string): boolean {
  const sent = Number(chase?.reminders_sent || 0);
  if (sent === 0 || !chase?.last_reminded_at) return true;
  return daysBetween(dateIn(new Date(chase.last_reminded_at)), today) >= gapAfter(sent);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  // RFC 8058 one-click (mail client POSTs "List-Unsubscribe=One-Click" as a form).
  const oneClickToken = new URL(req.url).searchParams.get("unsub");
  if (oneClickToken) return handleUnsub(db, oneClickToken, "unsubscribe", "one_click");

  let body: any = {};
  try {
    body = await req.json();
  } catch (_e) {
    body = {};
  }
  if (body?.action === "unsubscribe" || body?.action === "resubscribe" || body?.action === "unsub_info") {
    return handleUnsub(db, String(body.token || ""), body.action, "link");
  }

  const authHeader = req.headers.get("Authorization") || "";
  const presented = authHeader.replace(/^Bearer\s+/i, "");
  if (!presented) return json({ error: "unauthorized" }, 401);
  const job: Job | null = body?.job === "doc_chaser" || body?.job === "value_report" ? body.job : null;
  if (!job) return json({ error: "job must be doc_chaser or value_report" }, 400);

  let isMachine = secretsMatch(presented, SERVICE_ROLE_KEY);
  if (!isMachine) {
    const { data: cronKey } = await db.rpc("qbo_cron_key");
    isMachine = typeof cronKey === "string" && cronKey.length > 0 && secretsMatch(presented, cronKey);
  }

  let adminEmail: string | null = null;
  if (!isMachine) {
    const asUser = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: u, error: ue } = await asUser.auth.getUser();
    if (ue || !u?.user?.email) return json({ error: "unauthorized" }, 401);
    const { data: isAdmin, error: re } = await asUser.rpc("is_active_staff_admin");
    if (re || isAdmin !== true) return json({ error: "forbidden" }, 403);
    adminEmail = u.user.email.toLowerCase();
  }

  const { data: settings } = await db.from("client_email_settings").select("*").eq("id", true).maybeSingle();
  const today = dateIn(new Date());
  const replyTo = settings?.reply_to || undefined;

  const log = async (row: Record<string, unknown>) => {
    const { error } = await db.from("client_email_log").insert({ feature: job, requested_by: adminEmail, ...row });
    if (error) console.log(`client-emails: could not log — ${error.message}`);
  };

  // -------------------------------------------------------------------------
  // Admin: preview / test for one client
  // -------------------------------------------------------------------------
  if (!isMachine) {
    const action = body?.action === "test" ? "test" : body?.action === "preview" ? "preview" : null;
    const clientId = typeof body?.client_id === "string" ? body.client_id : null;
    if (!action || !clientId) return json({ error: "action (preview|test) and client_id are required" }, 400);
    const { data: clientRow } = await db.from("clients").select("id, name, test_only, assigned_bookkeeper, assigned_bookkeeper_email").eq("id", clientId).maybeSingle();
    if (!clientRow) return json({ error: "client not found" }, 404);
    const [client] = await withSignatures(db, [clientRow]);
    const { data: prefs } = await db.from("client_email_prefs").select("*").eq("client_id", clientId).maybeSingle();

    let email: { subject: string; html: string; text: string };
    let period: string | null = null;
    let requestIds: string[] | null = null;
    if (job === "doc_chaser") {
      const { data: open } = await db
        .from("client_doc_requests")
        .select("id, title, details, due_date, created_at")
        .eq("client_id", clientId)
        .eq("status", "open")
        .order("created_at", { ascending: true });
      const rows = open || [];
      if (!rows.length && action === "test") {
        return json({ status: "skipped", reason: "Nothing outstanding: this client has no open document requests" });
      }
      const sample = rows.length ? rows : [{ title: "Example: September bank statement", details: "Preview only. This client has no open requests.", due_date: null }];
      const { data: chase } = await db.from("client_doc_chase").select("reminders_sent").in("request_id", rows.map((r: any) => r.id));
      const first = !(chase || []).some((c: any) => Number(c.reminders_sent) > 0);
      email = renderChaser(client, sample, first);
      requestIds = rows.map((r: any) => r.id);
    } else {
      period = typeof body?.period === "string" && /^\d{4}-\d{2}-01$/.test(body.period) ? body.period : prevMonthStart(today);
      email = renderValue(client, period, await valueData(db, clientId, period));
    }

    email = { subject: email.subject, html: withUnsub(email.html, esc(TEST_UNSUB_URL)), text: withUnsub(email.text, TEST_UNSUB_URL) };
    if (action === "preview") {
      const blocked = gate(job, "cron", settings, prefs, client);
      return new Response(email.html, {
        headers: { ...CORS, "Content-Type": "text/html; charset=utf-8", "X-Would-Send": blocked ? `no: ${blocked}` : "yes" },
      });
    }

    const blocked = gate(job, "test", settings, prefs, client);
    if (blocked) {
      await log({ trigger: "test", client_id: clientId, status: "skipped", reason: blocked, recipients: [adminEmail], period, subject: email.subject });
      return json({ status: "skipped", reason: blocked });
    }
    if (!emailConfigured()) {
      await log({ trigger: "test", client_id: clientId, status: "not_configured", reason: "RESEND_API_KEY is not set", recipients: [adminEmail], period, subject: email.subject });
      return json({ status: "not_configured", error: "email not configured" });
    }
    const sent = await sendEmail({ to: [adminEmail!], subject: `[Test] ${email.subject}`, html: email.html, text: email.text, replyTo, tags: [{ name: "kind", value: job }] });
    await log({
      trigger: "test", client_id: clientId, status: sent.ok ? "sent" : "error", reason: sent.ok ? null : sent.error,
      recipients: [adminEmail], period, request_ids: requestIds, subject: email.subject, provider_id: sent.ok ? sent.id : null,
    });
    return sent.ok ? json({ status: "sent", to: adminEmail }) : json({ status: "error", error: sent.error }, 502);
  }

  // -------------------------------------------------------------------------
  // Cron
  // -------------------------------------------------------------------------
  const globalBlock = gate(job, "cron", settings, null, null);
  if (globalBlock) {
    await log({ trigger: "cron", status: "skipped", reason: globalBlock, period: job === "value_report" ? prevMonthStart(today) : null });
    return json({ status: "skipped", reason: globalBlock });
  }

  const { data: clientRows } = await db.from("clients").select("id, name, test_only, assigned_bookkeeper, assigned_bookkeeper_email");
  const clients = await withSignatures(db, clientRows || []);
  const { data: allPrefs } = await db.from("client_email_prefs").select("*");
  const prefsBy = new Map((allPrefs || []).map((r: any) => [r.client_id, r]));
  const summary: Record<string, number> = { sent: 0, skipped: 0, not_configured: 0, error: 0 };

  // Skips are logged at most once per client/reason per 6 days to keep history readable.
  const recentSkip = async (clientId: string, reason: string) => {
    const since = new Date(Date.now() - 6 * 86400000).toISOString();
    const { count } = await db.from("client_email_log").select("id", { count: "exact", head: true })
      .eq("feature", job).eq("client_id", clientId).eq("status", "skipped").eq("reason", reason).gte("created_at", since);
    return (count || 0) > 0;
  };
  const skip = async (clientId: string, reason: string, extra: Record<string, unknown> = {}) => {
    summary.skipped++;
    if (!(await recentSkip(clientId, reason))) await log({ trigger: "cron", client_id: clientId, status: "skipped", reason, ...extra });
  };

  if (job === "doc_chaser") {
    const { data: open } = await db
      .from("client_doc_requests")
      .select("id, client_id, title, details, due_date, created_at")
      .eq("status", "open")
      .order("created_at", { ascending: true });
    const ids = (open || []).map((r: any) => r.id);
    const { data: chase } = ids.length ? await db.from("client_doc_chase").select("*").in("request_id", ids) : { data: [] as any[] };
    const chaseBy = new Map((chase || []).map((c: any) => [c.request_id, c]));
    const byClient = new Map<string, any[]>();
    for (const r of open || []) {
      if (!byClient.has(r.client_id)) byClient.set(r.client_id, []);
      byClient.get(r.client_id)!.push(r);
    }
    const since20h = new Date(Date.now() - 20 * 3600000).toISOString();

    for (const client of clients || []) {
      const rows = byClient.get(client.id);
      if (!rows?.length) continue;
      const due = rows.filter((r) => isDue(chaseBy.get(r.id), today));
      if (!due.length) continue;
      const blocked = gate(job, "cron", settings, prefsBy.get(client.id), client);
      if (blocked) {
        await skip(client.id, blocked);
        continue;
      }
      const { count: recent } = await db.from("client_email_log").select("id", { count: "exact", head: true })
        .eq("feature", job).eq("client_id", client.id).eq("trigger", "cron").eq("status", "sent").gte("created_at", since20h);
      if ((recent || 0) > 0) continue;
      const rc = await recipientsFor(db, client.id);
      if (!rc.to.length) {
        await skip(client.id, rc.total ? "Every portal user has unsubscribed" : "No active portal users to email");
        continue;
      }
      const to = rc.to.map((r) => r.email);
      const first = rows.every((r) => !Number(chaseBy.get(r.id)?.reminders_sent || 0));
      const email = renderChaser(client, rows, first);
      if (!emailConfigured()) {
        summary.not_configured++;
        await log({ trigger: "cron", client_id: client.id, status: "not_configured", reason: "RESEND_API_KEY is not set", recipients: to, request_ids: due.map((r) => r.id), subject: email.subject });
        continue;
      }
      const res = await sendToEach(rc.to, email, { replyTo, job });
      const sent = { ok: res.ok.length > 0 };
      await log({
        trigger: "cron", client_id: client.id, status: sent.ok ? "sent" : "error",
        reason: res.failed.length ? `Failed for ${res.failed.join(", ")}: ${res.error}` : null,
        recipients: res.ok.length ? res.ok : to, request_ids: due.map((r) => r.id), subject: email.subject, provider_id: res.ids.join(",") || null,
      });
      if (!sent.ok) {
        summary.error++;
        continue;
      }
      summary.sent++;
      const nowIso = new Date().toISOString();
      await db.from("client_doc_chase").upsert(
        due.map((r) => ({ request_id: r.id, client_id: client.id, reminders_sent: Number(chaseBy.get(r.id)?.reminders_sent || 0) + 1, last_reminded_at: nowIso })),
      );
    }
    return json({ status: "ok", job, summary });
  }

  // value_report
  const period = typeof body?.period === "string" && /^\d{4}-\d{2}-01$/.test(body.period) ? body.period : prevMonthStart(today);
  for (const client of clients || []) {
    const blocked = gate(job, "cron", settings, prefsBy.get(client.id), client);
    if (blocked) {
      await skip(client.id, blocked, { period });
      continue;
    }
    const { count: already } = await db.from("client_email_log").select("id", { count: "exact", head: true })
      .eq("feature", job).eq("client_id", client.id).eq("trigger", "cron").eq("status", "sent").eq("period", period);
    if ((already || 0) > 0) continue;
    const rc = await recipientsFor(db, client.id);
    if (!rc.to.length) {
      await skip(client.id, rc.total ? "Every portal user has unsubscribed" : "No active portal users to email", { period });
      continue;
    }
    rc.to = await summaryFilter(db, rc.to, prefsBy.get(client.id));
    if (!rc.to.length) {
      await skip(client.id, "Everyone chosen for the monthly summary has turned it off", { period });
      continue;
    }
    const to = rc.to.map((r) => r.email);
    const v = await valueData(db, client.id, period);
    if (v.hours === 0 && v.tasks.count === 0 && v.docs.count === 0 && !v.close) {
      await skip(client.id, "Nothing to report for the month", { period });
      continue;
    }
    const email = renderValue(client, period, v);
    if (!emailConfigured()) {
      summary.not_configured++;
      await log({ trigger: "cron", client_id: client.id, status: "not_configured", reason: "RESEND_API_KEY is not set", recipients: to, period, subject: email.subject });
      continue;
    }
    const res = await sendToEach(rc.to, email, { replyTo, job });
    await log({
      trigger: "cron", client_id: client.id, status: res.ok.length ? "sent" : "error",
      reason: res.failed.length ? `Failed for ${res.failed.join(", ")}: ${res.error}` : null,
      recipients: res.ok.length ? res.ok : to, period, subject: email.subject, provider_id: res.ids.join(",") || null,
    });
    summary[res.ok.length ? "sent" : "error"]++;
  }
  return json({ status: "ok", job, period, summary });
});
