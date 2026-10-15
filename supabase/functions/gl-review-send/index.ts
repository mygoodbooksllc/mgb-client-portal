import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { esc, sendEmail } from "../_shared/email.ts";
import * as L from "../_shared/layout.ts";
import { loadSignoffs, signoffHtml, signoffText } from "../_shared/signature.ts";
import { claimQuestion, claimSummary, finishQuestion, releaseSummary } from "./claim.ts";

// ----------------------------------------------------------------------------
// gl-review-send: Ledger review's two outbound emails to a client
// (docs/gl-review-spec.md 3.3, 5, 6.4):
//   kind "question": an Ask client question created by gl_review_ask with
//                    asked_via = 'email' (transaction_questions row)
//   kind "summary":  the month's client summary (gl_review_summaries draft)
//
// POST { kind: "question" | "summary", id: uuid }   (nothing else is read)
//   -> { status: "sent", to }            emailed; summary marked sent
//    | { status: "test_sent", to }       test client: a [Test] copy went to the caller only
//    | { status: "already_sent" }        question emailed (or being emailed) in the last
//                                         10 minutes / summary already being sent
//    | { status: "skipped", reason }     master switch off / client or recipient opted out
//    | { status: "not_configured" }      RESEND_API_KEY missing
//    | { status: "error", error }
//
// It takes only an id and reads the recipient, subject and body from that
// row, so it can't relay arbitrary text from the firm's domain. verify_jwt ON.
// Checks, in order, before any service_role use: the caller's JWT, active
// staff (is_active_staff), the row is visible to them (staff RLS), and
// can_access_client for the row's client, all run AS the caller.
//
// Recipient: client_profile.contact_email (a question must still be addressed
// to it). Reply-To: the signed-in bookkeeper. Honors client_email_settings
// .enabled, client_email_prefs.opt_out_all, the recipient's unsubscribe and
// clients.test_only, like client-emails. Every attempt is logged in
// client_email_log (feature gl_review_question / gl_review_summary, trigger
// manual or test). Double sends (double click, two tabs) are blocked by
// claiming the row BEFORE sending (./claim.ts): the summary's own
// sent_at/sent_by, or a client_email_log 'sent' row for a question; the
// claim is undone if the send fails. Owner-approved exception to notification-emails.sql's
// "no message text or amounts": the question text and ONE transaction amount
// are the point of the question email. Never fees, rates or margins.
// Never reads QuickBooks and holds no Intuit credentials.
// ----------------------------------------------------------------------------

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const TAG = "gl-review-send";
const UNSUB_PAGE = "https://app.mygoodbooks.org/unsubscribe";
const RESEND_GUARD_MS = 10 * 60 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function fmtDay(d: string | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || ""));
  if (!m) return "";
  return `${MONTHS[+m[2] - 1].slice(0, 3)} ${+m[3]}, ${m[1]}`;
}
function fmtMonth(d: string | null): string {
  const m = /^(\d{4})-(\d{2})/.exec(String(d || ""));
  return m ? `${MONTHS[+m[2] - 1]} ${m[1]}` : "";
}
function fmtMoney(v: unknown): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return "";
  const s = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${n < 0 ? "-" : ""}$${s}`;
}

// Plain text (the summary body, the question) -> escaped HTML paragraphs.
function textToHtml(text: string, size = 15): string {
  return String(text || "")
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((para) => para.trim())
    .filter(Boolean)
    .map((para) => L.p(esc(para).replace(/\n/g, "<br>"), { size }))
    .join("");
}

function footer(clientName: string, unsubUrl: string): string {
  return `You're receiving this because you're the contact for ${esc(clientName)}'s books with MyGoodBooks. ` +
    `Questions? Just reply to this email. ${L.link(esc(unsubUrl), "Unsubscribe", "muted")} from these emails.`;
}

type Rendered = { subject: string; html: string; text: string };

function renderQuestion(q: any, client: any, greeting: string | null, sig: any, bkName: string | null, unsubUrl: string): Rendered {
  const subject = `A quick question about a transaction in ${client.name}'s books`;
  const hi = greeting ? `Hi ${greeting},` : "Hi there,";
  const facts: string[] = [];
  if (q.txn_date) facts.push(`<b>Date:</b> ${esc(fmtDay(q.txn_date))}`);
  if (q.txn_amount != null && fmtMoney(q.txn_amount)) facts.push(`<b>Amount:</b> ${esc(fmtMoney(q.txn_amount))}`);
  if (q.txn_description) facts.push(`<b>Details:</b> ${esc(q.txn_description)}`);
  if (q.txn_account) facts.push(`<b>Recorded in:</b> ${esc(q.txn_account)}`);
  const body =
    L.p(esc(hi)) +
    L.p(`While reviewing ${esc(client.name)}'s books, we had a question about this transaction:`) +
    (facts.length
      ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;margin:0 0 16px 0;"><tr>` +
        `<td class="mgb-warm" bgcolor="${L.T.warmBg}" style="background:${L.T.warmBg};border:1px solid ${L.T.warmBorder};border-radius:10px;padding:14px 16px 2px 16px;">` +
        L.p(facts.join("<br>"), { size: 14.5 }) + `</td></tr></table>`
      : "") +
    textToHtml(q.note) +
    L.p("Just reply to this email with whatever you know. A short answer is perfect.", { tone: "muted", size: 14 }) +
    signoffHtml(sig, bkName);
  const text = [
    hi,
    "",
    `While reviewing ${client.name}'s books, we had a question about this transaction:`,
    "",
    ...(q.txn_date ? [`Date: ${fmtDay(q.txn_date)}`] : []),
    ...(q.txn_amount != null && fmtMoney(q.txn_amount) ? [`Amount: ${fmtMoney(q.txn_amount)}`] : []),
    ...(q.txn_description ? [`Details: ${q.txn_description}`] : []),
    ...(q.txn_account ? [`Recorded in: ${q.txn_account}`] : []),
    "",
    String(q.note || "").trim(),
    "",
    "Just reply to this email with whatever you know. A short answer is perfect.",
    "",
    ...signoffText(sig, bkName),
    "",
    `Unsubscribe from these emails: ${unsubUrl}`,
  ].join("\n");
  const html = L.emailDocument({
    title: subject,
    preheader: String(q.note || "").slice(0, 140),
    subtitle: `Bookkeeping for ${client.name}`,
    cards: L.card(body),
    footer: footer(client.name, unsubUrl),
  });
  return { subject, html, text };
}

function renderSummary(s: any, client: any, sig: any, bkName: string | null, unsubUrl: string): Rendered {
  const month = fmtMonth(s.period);
  const subject = `${month} books review for ${client.name}`;
  // The body is the bookkeeper's edited text (greeting included); only the
  // sign-off and the layout are added here.
  const body = textToHtml(s.body) + signoffHtml(sig, bkName);
  const text = [String(s.body || "").trim(), "", ...signoffText(sig, bkName), "", `Unsubscribe from these emails: ${unsubUrl}`].join("\n");
  const html = L.emailDocument({
    title: subject,
    preheader: `Your ${month} books review`,
    subtitle: `Bookkeeping for ${client.name}`,
    cards: L.card(body),
    footer: footer(client.name, unsubUrl),
  });
  return { subject, html, text };
}

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
  const kind: "question" | "summary" | null = body?.kind === "question" ? "question" : body?.kind === "summary" ? "summary" : null;
  const id = typeof body?.id === "string" ? body.id.trim() : "";
  if (!kind || !UUID_RE.test(id)) return json({ status: "error", error: "kind (question|summary) and id are required" }, 400);

  // 1. Caller (as them).
  const asUser = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userRes, error: userErr } = await asUser.auth.getUser();
  const caller = userRes?.user?.email?.toLowerCase() || "";
  if (userErr || !caller) return json({ status: "error", error: "Please sign in again." }, 401);

  // 2. Active staff.
  const { data: isStaff, error: staffErr } = await asUser.rpc("is_active_staff");
  if (staffErr || isStaff !== true) return json({ status: "error", error: "This is for staff only." }, 403);

  // 3. The row, through the caller's own RLS (staff + can_access_client).
  const table = kind === "question" ? "transaction_questions" : "gl_review_summaries";
  const { data: seen } = await asUser.from(table).select("id, client_id").eq("id", id).maybeSingle();
  if (!seen?.client_id) return json({ status: "error", error: kind === "question" ? "Question not found." : "Summary not found." }, 404);
  const clientId: string = seen.client_id;

  // 4. Explicitly: this staffer may work on this client.
  const { data: allowed, error: accErr } = await asUser.rpc("can_access_client", { p_client_id: clientId });
  if (accErr || allowed !== true) return json({ status: "error", error: "You don't have access to this client." }, 403);

  // Only now: the service role.
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const feature = kind === "question" ? "gl_review_question" : "gl_review_summary";
  const reason = `${kind} ${id}`;
  const log = async (row: Record<string, unknown>) => {
    const { error } = await admin.from("client_email_log").insert({
      feature, client_id: clientId, requested_by: caller, trigger: "manual", ...row,
    });
    if (error) console.log(`${TAG}: could not log — ${error.message}`);
  };

  const [{ data: client }, { data: profile }, { data: settings }, { data: prefs }, { data: staffRow }] = await Promise.all([
    admin.from("clients").select("id, name, test_only, is_internal").eq("id", clientId).maybeSingle(),
    admin.from("client_profile").select("contact_email, greeting_name").eq("client_id", clientId).maybeSingle(),
    admin.from("client_email_settings").select("*").eq("id", true).maybeSingle(),
    admin.from("client_email_prefs").select("*").eq("client_id", clientId).maybeSingle(),
    admin.from("staff").select("name").ilike("email", caller.replace(/[\\%_]/g, (c) => "\\" + c)).maybeSingle(),
  ]);
  if (!client) return json({ status: "error", error: "Client not found." }, 404);
  // The internal company profile (MGB itself) has no client to email.
  if (client.is_internal === true) return json({ status: "error", error: "The internal company profile has no client to email." }, 400);
  const contact = String(profile?.contact_email || "").trim().toLowerCase();
  const greeting = String(profile?.greeting_name || "").trim() || null;

  // The row itself, read fresh with the service role.
  let row: any;
  let period: string | null = null;
  if (kind === "question") {
    const { data } = await admin.from("transaction_questions")
      .select("id, client_id, direction, asked_via, asked_of_email, status, note, txn_date, txn_amount, txn_description, txn_account")
      .eq("id", id).maybeSingle();
    row = data;
    if (!row || row.direction !== "staff_asked" || row.asked_via !== "email") {
      return json({ status: "error", error: "Only an email question can be sent this way." }, 400);
    }
    if (row.status !== "open") return json({ status: "error", error: "This question isn't open any more." }, 400);
    if (!contact) return json({ status: "error", error: "Add a contact email in Client setup." }, 400);
    if (row.asked_of_email !== contact) {
      return json({ status: "error", error: "The client's contact email changed. Ask the question again so it goes to the new address." }, 400);
    }
    if (!String(row.note || "").trim()) return json({ status: "error", error: "The question is empty." }, 400);
    period = row.txn_date ? `${String(row.txn_date).slice(0, 7)}-01` : null;
    // The double-click / retry guard is the claim just before sending.
  } else {
    const { data } = await admin.from("gl_review_summaries").select("id, client_id, period, body, status").eq("id", id).maybeSingle();
    row = data;
    if (!row) return json({ status: "error", error: "Summary not found." }, 404);
    if (row.status !== "draft") return json({ status: "error", error: "This summary was already sent." }, 400);
    if (!contact) return json({ status: "error", error: "Add a contact email in Client setup." }, 400);
    if (!String(row.body || "").trim()) return json({ status: "error", error: "The summary is empty." }, 400);
    period = String(row.period).slice(0, 10);
  }
  if (!EMAIL_RE.test(contact)) return json({ status: "error", error: "The contact email in Client setup doesn't look right." }, 400);

  // Gates (same switches as client-emails).
  const skip = async (why: string) => {
    await log({ status: "skipped", reason: `${reason}: ${why}`.slice(0, 500), recipients: [contact], period });
    return json({ status: "skipped", reason: why });
  };
  if (!settings || settings.enabled === false) return skip("Client emails are turned off (master switch)");
  if (prefs?.opt_out_all) return skip("This client is opted out of all emails");

  // Unsubscribe token for the contact (created on first use).
  await admin.from("client_email_recipients").upsert([{ client_id: clientId, email: contact }], { onConflict: "client_id,email", ignoreDuplicates: true });
  const { data: rec } = await admin.from("client_email_recipients").select("token, opted_out_at").eq("client_id", clientId).eq("email", contact).maybeSingle();
  if (rec?.opted_out_at) return skip("The contact unsubscribed from these emails");
  const token = rec?.token ? String(rec.token) : "";
  const unsubUrl = token ? `${UNSUB_PAGE}?t=${encodeURIComponent(token)}` : UNSUB_PAGE;
  const oneClick = token ? `${SUPABASE_URL}/functions/v1/client-emails?unsub=${encodeURIComponent(token)}` : null;

  const sigs = await loadSignoffs(admin, [caller]);
  const sig = sigs.get(caller) || null;
  const bkName = String(staffRow?.name || "").trim() || null;
  const email = kind === "question"
    ? renderQuestion(row, client, greeting, sig, bkName, unsubUrl)
    : renderSummary(row, client, sig, bkName, unsubUrl);

  // Test client: a [Test] copy to the caller only; nothing is marked sent.
  const isTest = client.test_only === true;
  const to = isTest ? caller : contact;
  const base = { recipients: [to], period, subject: email.subject.slice(0, 300), trigger: isTest ? "test" : "manual" };

  // Claim before sending, so a second click / tab can't send it again.
  let summaryClaim: string | null = null;
  let logId: string | null = null;
  if (kind === "summary") {
    const c = await claimSummary(admin, id, caller, Date.now(), RESEND_GUARD_MS);
    if (!c.claimed) {
      if (c.error) {
        console.log(`${TAG}: summary send claim failed for client ${clientId}: ${c.error}`);
        return json({ status: "error", error: "Couldn't start the send. Try again in a minute." });
      }
      return json({ status: "already_sent" });
    }
    summaryClaim = c.claimIso;
  } else {
    const c = await claimQuestion(admin, { feature, client_id: clientId, requested_by: caller, ...base, reason }, { guardMs: RESEND_GUARD_MS });
    if (!c.claimed) return json(c.status === "already_sent" ? { status: "already_sent" } : { status: "error", error: c.error });
    logId = c.logId;
  }

  // From here on the claim is ours: every way out either keeps it (the email
  // went out) or undoes it.
  let keepClaim = false;
  let emailed = false;
  try {
    let sent: Awaited<ReturnType<typeof sendEmail>>;
    try {
      sent = await sendEmail({
        to: [to],
        subject: isTest ? `[Test] ${email.subject}` : email.subject,
        html: email.html,
        text: email.text,
        replyTo: caller,
        tags: [{ name: "kind", value: feature }],
        headers: oneClick && !isTest ? { "List-Unsubscribe": `<${oneClick}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } : undefined,
      });
    } catch (e) {
      sent = { ok: false, error: String((e as Error)?.message || e) };
    }

    if (!sent.ok) {
      const why = sent.notConfigured ? reason : `${reason}: ${String(sent.error).slice(0, 300)}`;
      const status = sent.notConfigured ? "not_configured" : "error";
      if (logId) await finishQuestion(admin, logId, { status, reason: why });
      else await log({ ...base, status, reason: why });
      if (sent.notConfigured) return json({ status: "not_configured" });
      console.log(`${TAG}: send failed for client ${clientId} (${kind}): ${sent.error}`);
      return json({ status: "error", error: "The email didn't send. Try again in a minute." });
    }

    // Sent. A test copy marks nothing sent, so its claim is undone below and
    // its log row stops counting toward the resend guard.
    emailed = true;
    keepClaim = !isTest;
    const sentReason = isTest ? `${reason} (test copy to sender)` : reason;
    if (logId) await finishQuestion(admin, logId, { status: "sent", reason: sentReason, provider_id: sent.id });
    else await log({ ...base, status: "sent", reason: sentReason, provider_id: sent.id });
    console.log(`${TAG}: client ${clientId} ${kind} ${isTest ? "test copy" : "sent"}`);

    if (isTest) return json({ status: "test_sent", to });

    if (kind === "summary") {
      const { error: re } = await admin.rpc("gl_review_record_summary_email", {
        p_summary_id: id,
        p_sent_to: [contact],
        p_sent_by: caller,
      });
      if (re) {
        // The email went out; only the "sent" stamp failed. Say so plainly.
        // The claim stays, so nobody re-sends it for the next 10 minutes.
        console.log(`${TAG}: record_summary_email failed for client ${clientId}: ${re.message}`);
        return json({ status: "sent", to, warning: "The email went out, but the summary couldn't be marked sent. Mark it sent by hand." });
      }
    }
    return json({ status: "sent", to });
  } catch (e) {
    console.log(`${TAG}: unexpected failure for client ${clientId} (${kind}): ${(e as Error)?.message || e}`);
    if (emailed) return json(isTest ? { status: "test_sent", to } : { status: "sent", to });
    if (logId) await finishQuestion(admin, logId, { status: "error", reason: `${reason}: unexpected failure` });
    return json({ status: "error", error: "The email didn't send. Try again in a minute." });
  } finally {
    if (summaryClaim && !keepClaim) await releaseSummary(admin, id, summaryClaim, TAG);
  }
});
