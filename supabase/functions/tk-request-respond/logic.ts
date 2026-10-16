// Pure helpers for tk-request-respond (the public answer link). No Deno or
// network APIs, so tests/edge/tk_request_respond.test.mjs runs them under
// plain node.

import { ALLOWED_TYPES, MAX_BYTES, typeOf } from "../drive-files/logic.ts";
import { APP_ORIGIN, TOKEN_RE } from "../_shared/tk_requests.ts";

export { APP_ORIGIN, MAX_BYTES, TOKEN_RE };

export const ACTIONS = ["view", "upload", "answer", "stop_nudges"];
export const MAX_FILES = 5;
export const MAX_REPLY = 4000;
export const MAX_JSON_BYTES = 32 * 1024;
/** Every refusal takes at least this long, so a miss and a hit look alike. */
export const MIN_ERROR_MS = 300;

// tk_rate_hit buckets (spec C6). window seconds, max hits.
export const LIMITS = {
  ip: { window: 600, max: 30 }, // every call from one /24 or /48
  ipbad: { window: 900, max: 10 }, // invalid or expired tokens
  tokview: { window: 3600, max: 20 }, // views of one link
  global: { window: 3600, max: 600 }, // invalid hits from anywhere (circuit breaker)
};

export const STATUS: Record<string, number> = {
  bad_request: 400,
  reply_required: 400,
  too_many: 400,
  invalid: 404,
  expired: 410,
  revoked: 410,
  answered_already: 410,
  cancelled: 410,
  too_large: 413,
  bad_type: 415,
  rate_limited: 429,
  server_error: 500,
  not_connected: 503,
};

export function statusFor(code: string): number {
  return STATUS[code] || 500;
}

/** Token states and RPC errors the browser may see. Anything else is "invalid". */
export function errorCode(stateOrError: string | null | undefined): string | null {
  const s = String(stateOrError || "invalid");
  if (s === "ok") return null;
  return s in STATUS ? s : "invalid";
}

/** States that count toward the per-IP bad-token limit (spec: invalid or expired). */
export function isBadToken(code: string | null): boolean {
  return code === "invalid" || code === "expired";
}

/** CORS for the app origin only; anything else gets no allow-origin header. */
export function corsHeaders(origin: string | null | undefined): Record<string, string> {
  const h: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, x-mgb-token, x-mgb-filename",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
  if (origin === APP_ORIGIN) h["Access-Control-Allow-Origin"] = APP_ORIGIN;
  return h;
}

export const SECURITY_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

/** File name from the X-MGB-Filename header (encodeURIComponent'd by respond.js). */
export function cleanFilename(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s: string;
  try {
    s = decodeURIComponent(raw);
  } catch (_e) {
    return null;
  }
  s = s.replace(/[\u0000-\u001f\u007f]/g, "").replace(/[\\/]/g, "_").trim();
  if (!s || s === "." || s === "..") return null;
  return s.slice(0, 255);
}

export type Precheck = { error?: string; mime?: string; name?: string; length?: number };

/**
 * Everything that can be judged from the method, action and headers, before
 * the database or the body (M8). Uploads must say their size, and it must fit.
 */
export function precheck(i: {
  method: string;
  action: string;
  contentType?: string | null;
  contentLength?: string | null;
  filename?: string | null;
}): Precheck {
  if (i.method !== "POST" || !ACTIONS.includes(i.action)) return { error: "bad_request" };
  const lenRaw = i.contentLength;
  const len = lenRaw == null || lenRaw === "" ? NaN : Number(lenRaw);
  if (i.action === "upload") {
    if (!Number.isInteger(len) || len < 1) return { error: "bad_request" };
    if (len > MAX_BYTES) return { error: "too_large" };
    const name = cleanFilename(i.filename);
    if (!name) return { error: "bad_request" };
    const ct = String(i.contentType || "").split(";")[0].trim().toLowerCase();
    const mime = typeOf(name, ct || null);
    if (!mime) return { error: "bad_type" };
    return { mime, name, length: len };
  }
  // view / answer / stop_nudges: small JSON (or empty) bodies only.
  if (Number.isFinite(len) && len > MAX_JSON_BYTES) return { error: "too_large" };
  const ct = String(i.contentType || "").split(";")[0].trim().toLowerCase();
  if (i.action === "answer" && ct !== "application/json") return { error: "bad_request" };
  return {};
}

/** Validates the answer body: {reply?: string, file_ids?: uuid[]}. */
export function parseAnswer(body: unknown): { reply: string | null; fileIds: string[] } | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  for (const k of Object.keys(b)) if (k !== "reply" && k !== "file_ids") return null;
  let reply: string | null = null;
  if (b.reply != null) {
    if (typeof b.reply !== "string" || b.reply.length > MAX_REPLY) return null;
    reply = b.reply.trim() || null;
  }
  let fileIds: string[] = [];
  if (b.file_ids != null) {
    if (!Array.isArray(b.file_ids) || b.file_ids.length > MAX_FILES) return null;
    const re = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    if (!b.file_ids.every((x) => typeof x === "string" && re.test(x))) return null;
    fileIds = Array.from(new Set(b.file_ids as string[]));
  }
  return { reply, fileIds };
}

/** The fixed view (C6). Only these fields ever reach the browser. */
export function viewPayload(v: Record<string, unknown> | null | undefined) {
  const s = (x: unknown) => (x == null ? null : String(x));
  const o = v || {};
  return {
    title: s(o.title),
    prompt: s(o.prompt),
    kind: s(o.kind),
    needs_upload: o.needs_upload === true,
    due_date: s(o.due_date),
    status: s(o.status),
    asked_on: s(o.asked_on),
    asked_by_first_name: s(o.asked_by_first_name),
    client_display_name: s(o.client_display_name),
    expires_on: s(o.expires_on),
    limits: { max_files: MAX_FILES, max_mb: Math.round(MAX_BYTES / 1024 / 1024), types: Object.keys(ALLOWED_TYPES) },
  };
}

// ---------------------------------------------------------------------------
// Caller IP, reduced to a daily /24 or /48 hash (no secret salt, spec C6)
// ---------------------------------------------------------------------------
export function clientIp(get: (name: string) => string | null): string {
  const cf = (get("cf-connecting-ip") || "").trim();
  if (cf) return cf;
  const real = (get("x-real-ip") || "").trim();
  if (real) return real;
  const xff = (get("x-forwarded-for") || "").split(",").map((s) => s.trim()).filter(Boolean);
  return xff.length ? xff[xff.length - 1] : "unknown";
}

export function ipPrefix(ip: string): string {
  const v4 = /^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/i.exec(ip);
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.0/24`;
  if (ip.includes(":")) {
    const [head, tail] = ip.toLowerCase().split("::");
    const h = head ? head.split(":") : [];
    const t = tail != null ? (tail ? tail.split(":") : []) : [];
    const groups = tail != null ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t] : h;
    const g = groups.slice(0, 3).map((x) => (x || "0").replace(/^0+(?=.)/, ""));
    while (g.length < 3) g.push("0");
    return `${g.join(":")}::/48`;
  }
  return "unknown";
}

export function chicagoDate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export async function ipHash(ip: string, day: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${ipPrefix(ip)}|${day}`)));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

/** Reads at most `max` bytes from a body stream; null when it runs over. */
export async function readCapped(stream: ReadableStream<Uint8Array> | null, max: number): Promise<Uint8Array | null> {
  if (!stream) return new Uint8Array(0);
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const part of parts) {
    out.set(part, o);
    o += part.byteLength;
  }
  return out;
}

export function delayFor(startMs: number, nowMs: number, minMs = MIN_ERROR_MS): number {
  return Math.max(0, minMs - (nowMs - startMs));
}
