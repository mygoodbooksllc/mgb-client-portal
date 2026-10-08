import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { emailConfigured, esc, sendEmail } from "../_shared/email.ts";
import * as L from "../_shared/layout.ts";

// Helpers behind Developer tools (Settings › Firm settings › Developer tools).
//
// Admin-only: the caller's own JWT must belong to an active staff admin
// (public.is_active_staff_admin()). There is no machine caller.
//
//   POST { action: "test-email" }
//       Sends a short email to the caller's OWN address so an admin can
//       confirm the firm's sender (RESEND_API_KEY + DIGEST_FROM) works
//       without involving a client. Returns { ok, id, to } or { ok:false, error }.
//
// Deploy: npx supabase@latest functions deploy dev-tools --project-ref <ref> --no-verify-jwt

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const APP_URL = "https://app.mygoodbooks.org";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.replace(/^Bearer\s+/i, "")) return json({ error: "unauthorized" }, 401);
  const asUser = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: userRes, error: userErr } = await asUser.auth.getUser();
  if (userErr || !userRes?.user?.email) return json({ error: "unauthorized" }, 401);
  const { data: isAdmin, error: rpcErr } = await asUser.rpc("is_active_staff_admin");
  if (rpcErr || isAdmin !== true) return json({ error: "forbidden" }, 403);
  const email = userRes.user.email;

  let body: any = {};
  try {
    body = await req.json();
  } catch (_e) {
    body = {};
  }
  const action = String(body?.action || "");

  if (action === "test-email") {
    if (!emailConfigured()) {
      return json({ ok: false, error: "Email isn't configured yet: RESEND_API_KEY is not set in the function secrets." });
    }
    const when = new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC";
    const subject = "Test email from the MyGoodBooks portal";
    const html = L.emailDocument({
      title: subject,
      preheader: "If you can read this, the firm's sender works.",
      subtitle: "Developer tools",
      cards: L.card(
        L.p(`This is a test sent from <strong>Developer tools</strong> by ${esc(email)} at ${esc(when)}.`) +
          L.p(
            "If it reached your inbox rather than spam, the firm's sender and domain are set up correctly. Nothing else was sent.",
            { tone: "muted" },
          ) +
          L.button("Open the portal", `${APP_URL}/#/developer-tools`),
      ),
      footer: "Sent only to the admin who pressed the button.",
    });
    const text = [
      subject,
      "",
      `This is a test sent from Developer tools by ${email} at ${when}.`,
      "If it reached your inbox rather than spam, the firm's sender and domain are set up correctly. Nothing else was sent.",
      "",
      `Open the portal: ${APP_URL}/#/developer-tools`,
    ].join("\n");
    const res = await sendEmail({
      to: [email],
      subject,
      html,
      text,
      tags: [{ name: "type", value: "dev-test" }],
    });
    if (!res.ok) return json({ ok: false, error: res.error });
    return json({ ok: true, id: res.id, to: email });
  }

  return json({ error: "unknown action" }, 400);
});
