// Pure helpers for the qbo-webhook function (tested in
// tests/edge/qbo_webhook.test.mjs). No Deno, no network, no database.

/**
 * Intuit signs each webhook POST with the app's Verifier Token:
 * header `intuit-signature` = base64(HMAC-SHA256(verifierToken, rawBody)).
 * The firm can have two Intuit apps (production and sandbox keys), each with
 * its own verifier token, so every configured token is tried. Empty tokens
 * are ignored; with none configured nothing verifies.
 */
export async function verifyIntuitSignature(
  raw: string,
  signature: string | null | undefined,
  tokens: Array<string | null | undefined>,
): Promise<boolean> {
  const sig = String(signature || "").trim();
  if (!sig) return false;
  for (const t of tokens) {
    const token = String(t || "").trim();
    if (!token) continue;
    const expected = await hmacB64(token, raw);
    if (timingSafeEqual(sig, expected)) return true;
  }
  return false;
}

export async function hmacB64(key: string, data: string): Promise<string> {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(data)));
  let s = "";
  for (let i = 0; i < mac.length; i++) s += String.fromCharCode(mac[i]);
  return btoa(s);
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const REALM_RE = /^\d{1,32}$/;

/**
 * The QuickBooks companies (realm ids) a notification says changed.
 * Accepts both payload shapes Intuit sends:
 *   legacy:      { eventNotifications: [{ realmId, dataChangeEvent: {...} }] }
 *   CloudEvents: [{ specversion, type: "qbo.<entity>.<op>.v1", intuitaccountid, ... }]
 * Only numeric realm ids are kept; anything else is ignored. Entity names,
 * ids and amounts are never returned (the portal re-reads the books itself).
 */
export function realmsFromPayload(payload: unknown): string[] {
  const out = new Set<string>();
  const add = (v: unknown) => {
    const s = typeof v === "number" ? String(v) : typeof v === "string" ? v.trim() : "";
    if (REALM_RE.test(s)) out.add(s);
  };
  const p: any = payload;
  if (p && typeof p === "object" && !Array.isArray(p) && Array.isArray(p.eventNotifications)) {
    for (const n of p.eventNotifications) add(n?.realmId);
  }
  const events: any[] = Array.isArray(p) ? p : p && typeof p === "object" && p.specversion ? [p] : [];
  for (const e of events) {
    if (!e || typeof e !== "object") continue;
    add(e.intuitaccountid ?? e.intuitAccountId ?? e.realmId ?? e.realmid);
  }
  return [...out];
}
