// site-forms: checks and the request handler, with the database and the email
// sender passed in. No Deno or network APIs here, so
// tests/edge/site_forms.test.mjs runs it under plain node with fakes.
// index.ts wires the real Supabase client and ../_shared/email.ts.

import { esc } from "../_shared/email.ts";
import type { SendEmailInput, SendEmailResult } from "../_shared/email.ts";
import * as L from "../_shared/layout.ts";

export const ALLOWED_ORIGINS = [
  "https://mygoodbooks.org",
  "https://www.mygoodbooks.org",
  "https://mgb-website-mu.vercel.app", // staging
  "http://localhost:8431", // local testing of the site build
];

// data-site-form names (MGB Website build/export_site.py edit_clarity) and the
// email subject wording for each.
export const FORMS: Record<string, string> = {
  "clarity-review": "Clarity Review request",
  contact: "Contact form message",
};

export const MAX_BODY_BYTES = 10 * 1024;
export const MAX_FIELDS = 20;
export const MAX_VALUE = 2000;
export const MAX_NAME = 120;
export const MAX_EMAIL = 254;
export const MAX_PAGE = 300;
export const LIMITS = { hour: 5, day: 20 };
export const FALLBACK_RECIPIENT = "holden@mygoodbooks.org";
export const DEFAULT_SALT = "mgb-site-forms-v1";
export const HONEYPOT = "website";

// Labels and order for the notification email; other keys follow as sent.
export const FIELD_LABELS: Record<string, string> = {
  name: "Name",
  email: "Email",
  org: "Organization",
  org_type: "Organization type",
  role: "Role",
  budget: "Annual budget or revenue",
  phone: "Phone",
  message: "Message",
};

export const SECURITY_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

const EMAIL_RE = /^[^\s@<>()[\]",;:\\]+@[^\s@<>()[\]",;:\\]+\.[^\s@<>()[\]",;:\\]{2,}$/;
const KEY_RE = /^[A-Za-z0-9_-]{1,64}$/;
// Control characters other than tab and newline. Postgres jsonb also refuses \u0000.
const CTRL_RE = /[\u0000-\u0008\u000b-\u001f\u007f]/g;

export function corsHeaders(origin: string | null | undefined): Record<string, string> {
  const h: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
  if (origin && ALLOWED_ORIGINS.includes(origin)) h["Access-Control-Allow-Origin"] = origin;
  return h;
}

/** A browser on another site is refused; no Origin at all (curl, a server) is allowed. */
export function originAllowed(origin: string | null | undefined): boolean {
  return !origin || ALLOWED_ORIGINS.includes(origin);
}

export function clean(s: string): string {
  return s.replace(/\r\n?/g, "\n").replace(CTRL_RE, "").trim();
}

export function validEmail(s: string): boolean {
  return s.length <= MAX_EMAIL && EMAIL_RE.test(s);
}

/** A name a person would type: has a letter, not too long, not a link. */
export function plausibleName(s: string): boolean {
  if (!s || s.length > MAX_NAME || s.includes("\n")) return false;
  if (!/\p{L}/u.test(s)) return false;
  return !/https?:|:\/\/|www\.|<|>/i.test(s);
}

export type Submission = {
  form: string;
  page: string | null;
  fields: Record<string, string>;
  name: string;
  email: string;
};
export type Parsed = { ok: true; sub: Submission } | { ok: false; honeypot?: true; error: string };

/** Shape and content checks on the parsed JSON body. */
export function parseSubmission(body: unknown): Parsed {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "bad_request" };
  const b = body as Record<string, unknown>;
  const form = typeof b.form === "string" ? b.form : "";
  if (!Object.hasOwn(FORMS, form)) return { ok: false, error: "unknown_form" };
  const raw = b.fields;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "bad_fields" };
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > MAX_FIELDS) return { ok: false, error: "bad_fields" };
  const fields: Record<string, string> = {};
  for (const [k, v] of entries) {
    if (!KEY_RE.test(k) || typeof v !== "string") return { ok: false, error: "bad_fields" };
    fields[k] = clean(v).slice(0, MAX_VALUE);
  }
  // Bots fill the hidden field; the site drops it, so any value here is a bot.
  if (fields[HONEYPOT]) return { ok: false, honeypot: true, error: "honeypot" };
  delete fields[HONEYPOT];
  const name = fields.name || "";
  const email = fields.email || "";
  if (!plausibleName(name)) return { ok: false, error: "bad_name" };
  if (!validEmail(email)) return { ok: false, error: "bad_email" };
  const page = typeof b.page === "string" && b.page.startsWith("/") ? clean(b.page).slice(0, MAX_PAGE) : null;
  return { ok: true, sub: { form, page, fields, name, email } };
}

/** Within limits, given the caller's submission times from the last day. */
export function underLimit(times: string[], now: Date): boolean {
  const hourAgo = now.getTime() - 3600_000;
  const dayAgo = now.getTime() - 86400_000;
  const ms = times.map((t) => new Date(t).getTime()).filter((t) => t > dayAgo);
  return ms.length < LIMITS.day && ms.filter((t) => t > hourAgo).length < LIMITS.hour;
}

export function clientIp(get: (name: string) => string | null): string {
  const cf = (get("cf-connecting-ip") || "").trim();
  if (cf) return cf;
  const real = (get("x-real-ip") || "").trim();
  if (real) return real;
  const xff = (get("x-forwarded-for") || "").split(",").map((s) => s.trim()).filter(Boolean);
  return xff.length ? xff[xff.length - 1] : "unknown";
}

export async function ipHash(ip: string, salt: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}|${ip}`)));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Reads at most `max` bytes; null when the body runs over. */
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
  for (const p of parts) {
    out.set(p, o);
    o += p.byteLength;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Notification email
// ---------------------------------------------------------------------------
export function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/New_York",
    dateStyle: "medium",
    timeStyle: "short",
  }) + " ET";
}

function orderedFields(fields: Record<string, string>): [string, string][] {
  const known = Object.keys(FIELD_LABELS).filter((k) => k in fields);
  const rest = Object.keys(fields).filter((k) => !(k in FIELD_LABELS));
  return [...known, ...rest].map((k) => [FIELD_LABELS[k] || k, fields[k]]);
}

export function notificationEmail(sub: Submission, row: { id: string; created_at: string }) {
  const label = FORMS[sub.form];
  const who = sub.name.replace(/\s+/g, " ").slice(0, 80);
  const subject = `New ${label}: ${who}`;
  const when = fmtTime(row.created_at);
  const saved = `Saved in the portal (site_form_submissions), id ${row.id}`;
  const rows = orderedFields(sub.fields);
  const cell = (v: string) => (v ? esc(v).replace(/\n/g, "<br>") : L.tone("(blank)", "muted"));
  const html = L.emailDocument({
    title: subject,
    preheader: `${label} from ${who}`,
    subtitle: "Website form",
    cards: L.card(
      L.heading(`New ${label}`) +
        L.dataTable(["Field", "Answer"], rows.map(([k, v]) => [esc(k), cell(v)])) +
        L.p(`Page: ${esc(sub.page || "(not sent)")}<br>Received: ${esc(when)}`, { tone: "muted", size: 13 }) +
        L.p(esc(saved), { tone: "muted", size: 13 }) +
        L.p("Reply to this email to answer them directly.", { tone: "muted", size: 13 }),
    ),
    footer: "Sent by the site-forms function for the mygoodbooks.org website.",
  });
  const text = [
    `New ${label}`,
    "",
    ...rows.map(([k, v]) => `${k}: ${v || "(blank)"}`),
    "",
    `Page: ${sub.page || "(not sent)"}`,
    `Received: ${when}`,
    saved,
    "",
    "Reply to this email to answer them directly.",
  ].join("\n");
  return { subject, html, text };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
export type Store = {
  /** created_at of this caller's submissions since `sinceIso`. */
  recentTimes: (ipHash: string, sinceIso: string) => Promise<string[]>;
  insert: (row: Record<string, unknown>) => Promise<{ id: string; created_at: string }>;
  /** Active recipient addresses. */
  recipients: () => Promise<string[]>;
  markEmail: (id: string, sent: boolean, error: string | null) => Promise<void>;
};
export type Deps = {
  store: Store;
  sendEmail: (input: SendEmailInput) => Promise<SendEmailResult>;
  emailConfigured: () => boolean;
  salt: string;
  now?: () => Date;
  log?: (msg: string, detail?: Record<string, unknown>) => void;
};

export async function handle(req: Request, deps: Deps): Promise<Response> {
  const origin = req.headers.get("Origin");
  const cors = corsHeaders(origin);
  const log = deps.log || ((m, d) => console.error(m, d ?? {}));
  const now = deps.now || (() => new Date());
  const send = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, ...SECURITY_HEADERS, "Content-Type": "application/json" } });
  const fail = (status: number, error: string) => send(status, { ok: false, error });

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...cors, ...SECURITY_HEADERS } });
  if (req.method !== "POST") return fail(405, "method_not_allowed");
  if (!originAllowed(origin)) return fail(403, "forbidden");
  if (!/^application\/json\b/i.test(req.headers.get("content-type") || "")) return fail(415, "json_only");
  const len = Number(req.headers.get("content-length") || 0);
  if (len > MAX_BODY_BYTES) return fail(413, "too_large");

  const bytes = await readCapped(req.body, MAX_BODY_BYTES);
  if (!bytes) return fail(413, "too_large");
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch (_e) {
    return fail(400, "bad_request");
  }
  const parsed = parseSubmission(body);
  if (!parsed.ok) {
    // A bot sees the same answer a person does, and nothing is stored.
    if (parsed.honeypot) return send(200, { ok: true });
    return fail(400, parsed.error);
  }
  const sub = parsed.sub;

  const at = now();
  const ip = await ipHash(clientIp((n) => req.headers.get(n)), deps.salt);
  try {
    const times = await deps.store.recentTimes(ip, new Date(at.getTime() - 86400_000).toISOString());
    if (!underLimit(times, at)) return fail(429, "rate_limited");
  } catch (e) {
    // Better a possible extra row than a lost lead; the insert below still has to work.
    log("site-forms: rate check failed", { error: String((e as Error)?.message || e).slice(0, 200) });
  }

  let row: { id: string; created_at: string };
  try {
    row = await deps.store.insert({
      form: sub.form,
      page: sub.page,
      fields: sub.fields,
      name: sub.name,
      email: sub.email,
      ip_hash: ip,
      user_agent: (req.headers.get("user-agent") || "").slice(0, 300) || null,
    });
  } catch (e) {
    log("site-forms: insert failed", { form: sub.form, error: String((e as Error)?.message || e).slice(0, 200) });
    return fail(500, "server_error");
  }

  // The row is saved: from here on the visitor always gets 200.
  let emailError: string | null = null;
  try {
    if (!deps.emailConfigured()) {
      emailError = "email not configured (RESEND_API_KEY is not set)";
    } else {
      let to: string[] = [];
      try {
        to = (await deps.store.recipients()).map((s) => s.trim().toLowerCase()).filter(validEmail);
      } catch (e) {
        log("site-forms: recipients read failed", { error: String((e as Error)?.message || e).slice(0, 200) });
      }
      if (!to.length) to = [FALLBACK_RECIPIENT];
      const m = notificationEmail(sub, row);
      const r = await deps.sendEmail({
        to: [...new Set(to)],
        subject: m.subject,
        html: m.html,
        text: m.text,
        replyTo: sub.email,
        tags: [{ name: "type", value: "site-form" }],
      });
      if (!r.ok) emailError = r.error.slice(0, 500);
    }
  } catch (e) {
    emailError = `send failed: ${String((e as Error)?.message || e).slice(0, 300)}`;
  }
  if (emailError) log("site-forms: email not sent", { id: row.id, error: emailError });
  try {
    await deps.store.markEmail(row.id, !emailError, emailError);
  } catch (e) {
    log("site-forms: email status update failed", { id: row.id, error: String((e as Error)?.message || e).slice(0, 200) });
  }
  return send(200, { ok: true });
}
