// QuickBooks webhooks -> "this company changed" marks on qbo_connections
// (supabase/qbo-webhooks.sql). Nothing is synced here: the qbo-sync cron run
// picks up marked connections on its next tick, so this answers Intuit in
// well under its 3-second limit and a burst of edits costs one sync.
//
// Intuit setup (developer.intuit.com > your app > Webhooks, once per key set):
//   URL:      https://<project-ref>.supabase.co/functions/v1/qbo-webhook
//   Entities: the ones qbo-sync reads (Account, Bill, BillPayment, Budget is
//             not offered, Customer, Deposit, Estimate, Invoice, JournalEntry,
//             Payment, Purchase, SalesReceipt, Transfer, Vendor, VendorCredit,
//             RefundReceipt, CreditMemo, TimeActivity).
//   Then copy the app's Verifier Token into the function secrets
//   QBO_PRODUCTION_WEBHOOK_VERIFIER and/or QBO_SANDBOX_WEBHOOK_VERIFIER.
// Without a verifier secret every call is rejected (401).
//
// Deploy: npx supabase@latest functions deploy qbo-webhook --project-ref <ref> --no-verify-jwt
//
// Never logs or stores the payload (QuickBooks data stays out of logs, same
// rule as qbo-sync). Only realm ids are read from it.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { realmsFromPayload, verifyIntuitSignature } from "./logic.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VERIFIERS = [
  Deno.env.get("QBO_PRODUCTION_WEBHOOK_VERIFIER"),
  Deno.env.get("QBO_SANDBOX_WEBHOOK_VERIFIER"),
  Deno.env.get("QBO_WEBHOOK_VERIFIER"),
];
// Intuit's payloads are small; refuse anything absurd before hashing it.
const MAX_BODY_BYTES = 1024 * 1024;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return json({ error: "too large" }, 413);
  if (!(await verifyIntuitSignature(raw, req.headers.get("intuit-signature"), VERIFIERS))) {
    return json({ error: "bad signature" }, 401);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch (_e) {
    return json({ error: "bad json" }, 400);
  }
  const realms = realmsFromPayload(payload);
  if (!realms.length) return json({ ok: true, marked: 0 });

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const nowIso = new Date().toISOString();
  // Keep the earliest unsynced mark: only fill webhook_dirty_at when empty,
  // and always stamp webhook_last_at so staff can see webhooks arriving.
  const { data: marked, error: markErr } = await db
    .from("qbo_connections")
    .update({ webhook_dirty_at: nowIso })
    .in("realm_id", realms)
    .eq("status", "connected")
    .is("webhook_dirty_at", null)
    .select("client_id");
  const { error: lastErr } = await db
    .from("qbo_connections")
    .update({ webhook_last_at: nowIso })
    .in("realm_id", realms);
  if (markErr || lastErr) {
    // 500 makes Intuit retry later, which is what we want if the database
    // blipped. Message only, never the payload.
    console.error(`qbo-webhook: update failed: ${(markErr || lastErr)!.message}`);
    return json({ error: "update failed" }, 500);
  }
  console.log(`qbo-webhook: ${realms.length} realm(s) notified, ${marked?.length ?? 0} newly marked`);
  return json({ ok: true, marked: marked?.length ?? 0 });
});
