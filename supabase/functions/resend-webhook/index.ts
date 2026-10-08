// Resend delivery webhook -> email_events (supabase/usage-stats-2.sql).
//
// Resend signs every webhook with Svix headers. The secret (whsec_...) lives
// in the function secret RESEND_WEBHOOK_SECRET; set it in the Supabase
// dashboard after creating the webhook at https://resend.com/webhooks with
// this function's URL and the events you want (delivered, opened, clicked,
// bounced, complained, delivery_delayed, sent). Without the secret every call
// is rejected, so nothing can be written by a stranger.
//
// Deploy: npx supabase@latest functions deploy resend-webhook --project-ref <ref> --no-verify-jwt
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("RESEND_WEBHOOK_SECRET") || "";
const TOLERANCE_SECONDS = 5 * 60;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(bytes: ArrayBuffer): string {
  let s = "";
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function verify(req: Request, raw: string): Promise<boolean> {
  if (!WEBHOOK_SECRET) return false;
  const id = req.headers.get("svix-id") || "";
  const ts = req.headers.get("svix-timestamp") || "";
  const sigHeader = req.headers.get("svix-signature") || "";
  if (!id || !ts || !sigHeader) return false;
  const age = Math.abs(Date.now() / 1000 - Number(ts));
  if (!Number.isFinite(age) || age > TOLERANCE_SECONDS) return false;
  const secret = WEBHOOK_SECRET.replace(/^whsec_/, "");
  const key = await crypto.subtle.importKey("raw", b64ToBytes(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${ts}.${raw}`));
  const expected = bytesToB64(mac);
  return sigHeader.split(" ").some((part) => {
    const [version, sig] = part.split(",");
    return version === "v1" && !!sig && timingSafeEqual(sig, expected);
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  const raw = await req.text();
  if (!(await verify(req, raw))) return json({ error: "bad signature" }, 401);

  let evt: any;
  try {
    evt = JSON.parse(raw);
  } catch (_e) {
    return json({ error: "bad json" }, 400);
  }
  const type = String(evt?.type || "").replace(/^email\./, "") || "unknown";
  const data = evt?.data || {};
  const to = Array.isArray(data.to) ? data.to[0] : data.to;
  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { error } = await db.from("email_events").upsert(
    {
      event_type: type,
      email_id: data.email_id ? String(data.email_id) : null,
      to_email: to ? String(to).slice(0, 320) : null,
      subject: data.subject ? String(data.subject).slice(0, 300) : null,
      occurred_at: evt?.created_at || new Date().toISOString(),
      payload: { type: evt?.type, from: data.from, tags: data.tags, click: data.click, bounce: data.bounce },
    },
    { onConflict: "email_id,event_type,occurred_at", ignoreDuplicates: true },
  );
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true });
});
