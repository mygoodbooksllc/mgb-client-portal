// Pure rules for the staff-auth edge function (./index.ts). No Deno APIs,
// no network, so node can test them directly:
//   node --test tests/edge/staff_auth.test.mjs
// Only erasable TypeScript here (no enums, no parameter properties), so
// node's built-in type stripping can import this file as-is.

// Anchored, escaped dot, ASCII only: rejects "me@mygoodbooks.org.evil.com",
// "me@mygoodbooksXorg", and any control, zero-width or other non-ASCII
// character left after normalizeEmail(). Stricter than the
// staff_email_domain CHECK (audit2-staff-email-domain.sql), on purpose.
export const STAFF_EMAIL_RE = /^[a-z0-9._%+-]+@mygoodbooks\.org$/;

// One request never asks for more than this many addresses.
export const MAX_EMAILS = 50;

// Rate limits, counted from staff_audit_log 'auth_user_created' rows (one
// per account made) in the last hour. Per admin, and across all admins.
// Not strictly atomic under parallel requests; each request is capped at
// MAX_EMAILS and can only ever create accounts for active staff rows that
// are missing one, which bounds any overshoot.
export const RATE_WINDOW_MS = 60 * 60 * 1000;
export const RATE_LIMIT_PER_ACTOR = 60;
export const RATE_LIMIT_GLOBAL = 200;
export const RATE_ACTIONS = ["auth_user_created"];

export type Status = "created" | "exists" | "skipped" | "error";
export type Reason =
  | "invalid_email"
  | "not_staff"
  | "not_active_staff"
  | "ambiguous"
  | "client_login"
  | "rate_limited"
  | "create_failed";
export type Result = { email: string; status: Status; reason?: Reason };

export type Parsed =
  | { ok: true; action: "ensure"; emails: string[]; rejected: Result[] }
  | { ok: true; action: "repair" }
  | { ok: false; status: number; error: string; message: string };

// NFKC first (so a Kelvin sign becomes "k" and full-width letters become
// ASCII), then trim and lowercase. Whatever is still odd (zero-width
// spaces, inner newlines, NUL) fails STAFF_EMAIL_RE afterwards.
export function normalizeEmail(v: unknown): string {
  return typeof v === "string" ? v.normalize("NFKC").trim().toLowerCase() : "";
}

export function isStaffDomain(email: string): boolean {
  return STAFF_EMAIL_RE.test(email);
}

// Validates the request body. Never echoes anything but the addresses the
// caller sent (lowercased), and caps the list before doing any work.
export function parseRequest(body: unknown): Parsed {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, status: 400, error: "invalid_body", message: "Send a JSON object." };
  }
  const b = body as Record<string, unknown>;
  if (b.action === "repair") return { ok: true, action: "repair" };
  if (b.action !== "ensure") {
    return { ok: false, status: 400, error: "invalid_action", message: "action must be 'ensure' or 'repair'." };
  }
  if (!Array.isArray(b.emails) || b.emails.length === 0) {
    return { ok: false, status: 400, error: "invalid_emails", message: "emails must be a non-empty list." };
  }
  if (b.emails.length > MAX_EMAILS) {
    return {
      ok: false,
      status: 400,
      error: "too_many_emails",
      message: `At most ${MAX_EMAILS} addresses per request.`,
    };
  }
  const seen = new Set<string>();
  const emails: string[] = [];
  const rejected: Result[] = [];
  for (const raw of b.emails) {
    const email = normalizeEmail(raw);
    if (seen.has(email)) continue;
    seen.add(email);
    if (!isStaffDomain(email)) {
      // Keep the echo short and printable; it's the caller's own input.
      rejected.push({ email: email.slice(0, 254), status: "skipped", reason: "invalid_email" });
    } else {
      emails.push(email);
    }
  }
  return { ok: true, action: "ensure", emails, rejected };
}

export type StaffRow = { email: string; active: boolean | null };

// Which addresses may get a sign-in account: an ACTIVE staff row, in the
// firm domain, and not a client portal login. Everything else is skipped
// with a reason. `hasAuth` (lowercased) marks addresses already known to
// have a sign-in account; they come back as "exists" without any call.
export function plan(
  emails: string[],
  staff: StaffRow[],
  clientLogins: string[],
  hasAuth: Set<string> | null,
): { create: string[]; results: Result[] } {
  // Two staff rows that normalize to the same address: refuse rather than
  // guess which one (and its active flag) is meant.
  const staffBy = new Map<string, StaffRow>();
  const dupes = new Set<string>();
  for (const s of staff) {
    const k = normalizeEmail(s.email);
    if (staffBy.has(k)) dupes.add(k);
    staffBy.set(k, s);
  }
  const clients = new Set(clientLogins.map(normalizeEmail));
  const create: string[] = [];
  const results: Result[] = [];
  for (const email of emails) {
    if (!isStaffDomain(email)) {
      results.push({ email, status: "skipped", reason: "invalid_email" });
      continue;
    }
    const row = staffBy.get(email);
    if (dupes.has(email)) {
      results.push({ email, status: "skipped", reason: "ambiguous" });
    } else if (!row) {
      results.push({ email, status: "skipped", reason: "not_staff" });
    } else if (row.active !== true) {
      results.push({ email, status: "skipped", reason: "not_active_staff" });
    } else if (clients.has(email)) {
      results.push({ email, status: "skipped", reason: "client_login" });
    } else if (hasAuth && hasAuth.has(email)) {
      results.push({ email, status: "exists" });
    } else {
      create.push(email);
    }
  }
  return { create, results };
}

// How many more accounts this caller may create right now.
export function remainingBudget(usedByActor: number, usedGlobal: number): number {
  const a = RATE_LIMIT_PER_ACTOR - Math.max(0, usedByActor | 0);
  const g = RATE_LIMIT_GLOBAL - Math.max(0, usedGlobal | 0);
  return Math.max(0, Math.min(a, g));
}

// "This address already has an auth user." Only the specific codes or the
// specific message: a bare 422 is also what a weak-password or invalid-email
// rejection looks like, and must not be reported as "exists".
export function isAlreadyRegistered(error: { message?: string; code?: string; status?: number } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "email_exists" || error.code === "user_already_exists") return true;
  const msg = (error.message || "").toLowerCase();
  return msg.includes("already been registered") || msg.includes("already registered");
}

// 48 random bytes, base64, plus a fixed "aA1!" so any password policy that
// wants upper, lower, digit and symbol is always met (the strength is in the
// random part). Nobody ever types it: staff sign in with Google, and the
// Google identity is linked to this user by email. It exists only because
// createUser needs some credential. Never logged or returned.
export function randomPassword(): string {
  const bytes = new Uint8Array(48);
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s) + "aA1!";
}

export function summarize(results: Result[]): { created: number; exists: number; skipped: number; error: number } {
  let created = 0, exists = 0, skipped = 0, error = 0;
  for (const r of results) {
    if (r.status === "created") created++;
    else if (r.status === "exists") exists++;
    else if (r.status === "error") error++;
    else skipped++;
  }
  return { created, exists, skipped, error };
}
