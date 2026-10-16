import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { emailConfigured, sendEmail } from "../_shared/email.ts";
import { askEmail, expiresOn, newToken, nudgeEmail, portalLink, respondLink, tokenHashParam } from "../_shared/tk_requests.ts";
import { envelopes, rpcErrorCode } from "./send_plan.ts";

// Tasks p2 S6: staff "Ask client" sends (verify_jwt ON; the staff JWT).
//
// POST {action: "preview" | "send" | "resend" | "nudge", request_id, target?}
//   target (optional): a contact id or portal email on the request; without
//   one, everyone on the request. "nudge" is the staff "Send reminder" (the
//   reminder template; its links never revoke the earlier ones).
//
// The database decides everything through the caller's own JWT:
// rpc tk_client_request_send checks staff + client access and returns the
// mode (tk__request_send_mode):
//   off      -> 409 email_off
//   dry_run  -> the RPC logged client_email_log skipped/dry_run; nothing is
//               sent and no token is minted. client_request_enabled is OFF
//               until the owner flips it in Dev Tools > Flags.
//   test     -> a [Test] client: one copy to the caller only
//   live     -> claim (10-minute guard) -> mint a token per contact -> send
//               (Reply-To: the staff member who asked) -> finish the log row.
// Tokens are never logged or returned; only their sha256 is stored.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const auth = req.headers.get("Authorization") || "";
  if (!/^Bearer\s+\S+/i.test(auth)) return json({ error: "unauthorized" }, 401);
  const asUser = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data: u } = await asUser.auth.getUser();
  const me = String(u?.user?.email || "").toLowerCase();
  if (!me) return json({ error: "unauthorized" }, 401);

  let body: any = {};
  try {
    body = await req.json();
  } catch (_e) {
    return json({ error: "bad_request" }, 400);
  }
  const action = String(body?.action || "");
  const requestId = String(body?.request_id || "");
  const target = body?.target == null ? null : String(body.target).slice(0, 320);
  if (!["preview", "send", "resend", "nudge"].includes(action) || !UUID_RE.test(requestId)) return json({ error: "bad_request" }, 400);

  // The caller's own JWT: staff + client access are checked in the RPC.
  const { data: plan, error: pErr } = await asUser.rpc("tk_client_request_send", { p_id: requestId, p_action: action, p_target: target });
  if (pErr) {
    const code = rpcErrorCode(pErr.message);
    return json({ error: code }, code === "forbidden" || code === "not_found" ? 403 : 409);
  }
  const summary = {
    mode: plan.mode,
    dry_run: plan.dry_run === true,
    action,
    recipients: plan.recipients || [],
    targets: (plan.targets || []).map((t: any) => ({ type: t.type, email: t.email, name: t.name ?? null })),
    subject: plan.subject,
  };
  if (action === "preview" || !plan.needs_sender) return json({ ...summary, sent: 0 });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const env = envelopes(plan, me);
  if (!env.length) return json({ ...summary, sent: 0, error: "no_recipients" }, 409);
  const subjectFor = (test: boolean) => ((test ? "[Test] " : "") + String(plan.subject || "")).slice(0, 300);

  const { data: logId, error: cErr } = await admin.rpc("tk_request_send_claim", {
    p_id: requestId, p_action: action, p_actor: `staff:${me}`, p_mode: plan.mode,
    p_recipients: env.map((e) => e.to), p_subject: subjectFor(plan.mode === "test"),
  });
  if (cErr) return json({ ...summary, sent: 0, error: rpcErrorCode(cErr.message) }, 409);

  if (!emailConfigured()) {
    await admin.rpc("tk_request_send_finish", { p_log_id: logId, p_status: "not_configured", p_reason: "RESEND_API_KEY is not set", p_recipients: null, p_provider_id: null });
    return json({ ...summary, sent: 0, error: "not_configured" }, 503);
  }

  const ttl = Number(plan.link_ttl_days) || 14;
  const sentTo: string[] = [];
  const ids: string[] = [];
  let lastError: string | null = null;
  for (const e of env) {
    let href: string;
    let tokenId: string | null = null;
    let token: string | null = null;
    if (e.via === "link") {
      token = newToken();
      const { data: tid, error: iErr } = await admin.rpc("tk_issue_request_token", {
        p_request_id: requestId, p_contact_id: e.contactId, p_email: e.to, p_hash: await tokenHashParam(token),
        p_ttl_days: ttl, p_actor: `staff:${me}`, p_is_test: e.test, p_mode: action,
      });
      if (iErr) {
        lastError = `link not issued: ${rpcErrorCode(iErr.message)}`;
        continue;
      }
      tokenId = tid as string;
      href = respondLink(token);
    } else {
      href = portalLink(plan.client_id, requestId);
    }
    const mail = action === "nudge"
      ? (() => {
        const m = nudgeEmail({
          clientName: plan.client_name || "Your organization",
          recipientName: e.name,
          items: [{ title: plan.title, href }],
          viaPortal: e.via === "portal",
          stopHref: token ? respondLink(token, true) : null,
          replyToFirstName: plan.staff_first_name,
        });
        return { ...m, subject: subjectFor(e.test) };
      })()
      : askEmail({
      clientName: plan.client_name || "Your organization",
      recipientName: e.name,
      staffFirstName: plan.staff_first_name || "Your bookkeeper",
      title: plan.title,
      prompt: plan.prompt,
      dueDate: plan.due_date,
      href,
      viaPortal: e.via === "portal",
      expiresOn: e.via === "link" ? expiresOn(ttl) : null,
      test: e.test,
    });
    const sent = await sendEmail({
      to: [e.to], subject: mail.subject, html: mail.html, text: mail.text,
      replyTo: plan.asked_by || undefined, tags: [{ name: "kind", value: "client_request" }],
    });
    if (sent.ok) {
      sentTo.push(e.to);
      if (sent.id) ids.push(sent.id);
      if (tokenId) {
        await admin.rpc("tk_log_token_event", { p_token_id: tokenId, p_request_id: requestId, p_event: "emailed", p_ip_hash: null, p_detail: { mode: plan.mode } });
      }
    } else {
      lastError = sent.error;
    }
  }
  await admin.rpc("tk_request_send_finish", {
    p_log_id: logId,
    p_status: sentTo.length ? "sent" : "error",
    p_reason: lastError ? lastError.slice(0, 500) : null,
    p_recipients: sentTo,
    p_provider_id: ids.join(",") || null,
  });
  return json({ ...summary, sent: sentTo.length, failed: env.length - sentTo.length, error: sentTo.length ? null : lastError ? "send_failed" : null },
    sentTo.length ? 200 : 502);
});
