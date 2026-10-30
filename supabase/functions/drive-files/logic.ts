// Pure helpers for the drive-files edge function: no Deno or network APIs, so
// supabase/functions/drive-files/logic.test.mjs can run them under plain node.
// Uses only WebCrypto (globalThis.crypto.subtle), which Deno and node share.

// ---------------------------------------------------------------------------
// Files: the same 25 MB cap and types the old client-uploads bucket allowed
// (supabase/staff-client-tools.sql).
// ---------------------------------------------------------------------------
export const MAX_BYTES = 25 * 1024 * 1024;
export const ALLOWED_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  heic: "image/heic",
  csv: "text/csv",
  txt: "text/plain",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};
// Other types browsers really send for an allowed extension (Windows with
// Excel installed calls a .csv "application/vnd.ms-excel"; iOS may say heif).
const MIME_ALIASES: Record<string, string[]> = {
  csv: ["application/vnd.ms-excel", "application/csv", "text/x-csv", "text/plain"],
  heic: ["image/heif"],
  jpg: ["image/pjpeg"],
  jpeg: ["image/pjpeg"],
};
// "I don't know" from the browser: the extension alone decides.
const GENERIC_MIMES = new Set(["", "application/octet-stream", "binary/octet-stream"]);

/**
 * The file's allowed MIME type, or null if it isn't one we take. The name
 * must end in an allowed extension AND the declared type (when the browser
 * declares one) must agree with it: no invoice.pdf.exe sent as
 * application/pdf, no invoice.pdf sent as text/html. Returns the extension's
 * canonical type.
 */
export function typeOf(name: string, mime: string | null | undefined): string | null {
  const base = String(name || "");
  const dot = base.lastIndexOf(".");
  if (dot < 1 || dot === base.length - 1) return null;
  const ext = base.slice(dot + 1).toLowerCase();
  const canonical = Object.prototype.hasOwnProperty.call(ALLOWED_TYPES, ext) ? ALLOWED_TYPES[ext] : null;
  if (!canonical) return null;
  const declared = String(mime || "").split(";")[0].trim().toLowerCase();
  if (GENERIC_MIMES.has(declared) || declared === canonical) return canonical;
  return (MIME_ALIASES[ext] || []).includes(declared) ? canonical : null;
}

// Programs, scripts and installers. typeOf's allow-list already refuses them;
// this block list runs first so the person gets a plain "we don't take
// programs" message instead of the generic file-type one, and stays in force
// even if the allow-list ever grows.
export const BLOCKED_EXTS = new Set([
  "exe", "msi", "msp", "msix", "appx", "bat", "cmd", "com", "scr", "pif", "cpl", "gadget",
  "js", "jse", "mjs", "vbs", "vbe", "wsf", "wsh", "hta", "ps1", "psm1", "psd1",
  "sh", "bash", "zsh", "csh", "ksh", "command", "py", "pl", "rb", "php",
  "jar", "class", "dll", "sys", "drv", "ocx", "reg", "lnk", "inf", "scf", "url",
  "dmg", "pkg", "mpkg", "app", "apk", "aab", "ipa", "deb", "rpm", "run", "bin",
  "iso", "img", "vhd", "vhdx", "docm", "xlsm", "pptm", "dotm", "xltm",
]);
export const BLOCKED_TYPE_MESSAGE =
  "Programs, scripts and installers can't be uploaded. Please send a PDF, picture, spreadsheet or Word document instead.";

/** True when the file name ends in a program, script or installer extension.
 *  Trailing dots and spaces are ignored ("setup.exe. " counts as .exe). */
export function blockedExt(name: string | null | undefined): boolean {
  const base = String(name || "").replace(/[.\s]+$/, "");
  const dot = base.lastIndexOf(".");
  if (dot < 0 || dot === base.length - 1) return false;
  return BLOCKED_EXTS.has(base.slice(dot + 1).toLowerCase());
}

// ---------------------------------------------------------------------------
// Per-login access on shared portal files (client page drop).
// ---------------------------------------------------------------------------
export const ACCESS_MODES = ["everyone", "only", "except"] as const;
export const MAX_ACCESS_EMAILS = 50;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** "everyone" | "only" | "except", or null for anything else. Blank = everyone. */
export function parseAccessMode(input: unknown): string | null {
  const m = String(input ?? "").trim().toLowerCase();
  if (!m) return "everyone";
  return (ACCESS_MODES as readonly string[]).includes(m) ? m : null;
}

/** The access list from a form field (a JSON array of emails, or a single
 *  comma list): trimmed, lower case, de-duplicated. Returns null when it isn't
 *  readable, has a value that isn't an email, or names more than 50 people. */
export function normalizeAccessEmails(input: unknown): string[] | null {
  let raw: unknown[] = [];
  if (input === null || input === undefined || input === "") raw = [];
  else if (Array.isArray(input)) raw = input;
  else {
    const s = String(input).trim();
    if (s.startsWith("[")) {
      try {
        const v = JSON.parse(s);
        if (!Array.isArray(v)) return null;
        raw = v;
      } catch (_e) {
        return null;
      }
    } else raw = s.split(",");
  }
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== "string") return null;
    const e = v.trim().toLowerCase();
    if (!e) continue;
    if (e.length > 320 || !EMAIL_RE.test(e)) return null;
    if (!out.includes(e)) out.push(e);
  }
  return out.length > MAX_ACCESS_EMAILS ? null : out;
}

/** A display name for a file: control characters become spaces, trimmed,
 *  at most 200 characters; blank means "use the file name" (null). */
export function cleanDisplayName(input: unknown): string | null {
  const s = String(input ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 200).trim();
  return s || null;
}

// Types a browser can show safely inline from the functions domain. Anything
// else downloads as an attachment.
const INLINE_TYPES = new Set(["application/pdf", "image/png", "image/jpeg", "text/plain", "text/csv"]);

export function contentDisposition(name: string, mime: string | null | undefined): string {
  const kind = mime && INLINE_TYPES.has(mime) ? "inline" : "attachment";
  const ascii = String(name || "file").replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(String(name || "file"))}`;
}

// ---------------------------------------------------------------------------
// Folder layout: <Client name> / <Year> / <Document type>
// ---------------------------------------------------------------------------
export const DOC_TYPES = [
  "Bank statements",
  "Credit card statements",
  "Loan statements",
  "Payroll",
  "Tax forms",
  "Receipts",
  "Invoices",
  "Bills",
  "Donations",
  "Budgets",
  "Reports",
  "Contracts",
  "Insurance",
  "Messages",
  "Other",
] as const;

// First match wins, so the specific ones come before the general ones.
const DOC_TYPE_RULES: [RegExp, string][] = [
  [/credit\s*card|\bamex\b|\bvisa\b|mastercard|card statement/i, "Credit card statements"],
  [/\bloan\b|mortgage|line of credit|\bloc\b/i, "Loan statements"],
  [/bank|checking|savings|account statement|\bstatements?\b/i, "Bank statements"],
  [/payroll|pay\s*stub|\bgusto\b|\badp\b|paychex|\bw-?2s?\b|\b941\b|\b940\b/i, "Payroll"],
  [/\btax|\b1099|\bw-?9\b|\b990\b|\b1096\b|\birs\b|\bk-?1\b/i, "Tax forms"],
  [/receipt/i, "Receipts"],
  [/invoice/i, "Invoices"],
  [/\bbills?\b|vendor|payable/i, "Bills"],
  [/donat|giving|tithe|offering|contribution|pledge/i, "Donations"],
  [/budget/i, "Budgets"],
  [/report|financials|p\s*&\s*l|profit and loss|balance sheet/i, "Reports"],
  [/contract|agreement|lease/i, "Contracts"],
  [/insurance|policy/i, "Insurance"],
];

/** A document type from a document request's title, "Other" if nothing fits. */
export function docTypeFor(title: string | null | undefined): string {
  const t = String(title || "");
  for (const [re, type] of DOC_TYPE_RULES) if (re.test(t)) return type;
  return "Other";
}

/** A picker value, matched case-insensitively to DOC_TYPES; else "Other". */
export function normalizeDocType(input: string | null | undefined): string {
  const want = String(input || "").trim().toLowerCase();
  return DOC_TYPES.find((d) => d.toLowerCase() === want) || "Other";
}

/** The current year in New York (where the firm works). */
export function currentYear(now: Date = new Date()): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric" }).format(now));
}

/** A 4-digit year (2000-2099) named in the text, or null. */
export function yearInText(text: string | null | undefined): number | null {
  const m = String(text || "").match(/\b(20\d\d)\b/);
  return m ? Number(m[1]) : null;
}

/** A valid year from a form field, else the fallback. */
export function cleanYear(input: unknown, fallback: number): number {
  const n = Number(input);
  return Number.isInteger(n) && n >= 2000 && n <= 2100 ? n : fallback;
}

/** The year a document request's upload is filed under: the year the title
 *  names ("2025 W-2s", "September 2026 statement"), else the current year. */
export function yearForRequest(title: string | null | undefined, now: Date = new Date()): number {
  return yearInText(title) ?? currentYear(now);
}

/** A Drive folder name from a client's display name. */
export function clientFolderName(name: string | null | undefined, clientId: string): string {
  const n = String(name || "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
  return n || clientId;
}

/** The three folder names for a file, top first. */
export function folderPath(clientName: string, clientId: string, year: number, docType: string): string[] {
  return [clientFolderName(clientName, clientId), String(year), normalizeDocType(docType)];
}

/** Escapes a value for a Drive `q` string literal. */
export function driveQ(s: string): string {
  return String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

// ---------------------------------------------------------------------------
// Paths that point at a Drive file (the rest are old Supabase Storage keys).
//   <client>/<request id>/drive:<client_files.id>
//   <client>/messages/<email>/drive:<client_files.id>
// ---------------------------------------------------------------------------
const DRIVE_REF = /\/drive:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
export function driveRef(path: string | null | undefined): string | null {
  const m = String(path || "").match(DRIVE_REF);
  return m ? m[1] : null;
}
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// ---------------------------------------------------------------------------
// base64url
// ---------------------------------------------------------------------------
export function b64url(bytes: Uint8Array | string): string {
  const b = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  let bin = "";
  for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function b64urlDecode(s: string): Uint8Array {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---------------------------------------------------------------------------
// Google service-account JWT (RFC 7523 bearer grant)
// ---------------------------------------------------------------------------
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
export const TOKEN_URL = "https://oauth2.googleapis.com/token";

export type ServiceAccount = { client_email: string; private_key: string; token_uri?: string };

/** Parses the GOOGLE_SERVICE_ACCOUNT_JSON secret. Throws a message that never
 *  includes the secret itself. */
export function parseServiceAccount(raw: string): ServiceAccount {
  let sa: any;
  try {
    sa = JSON.parse(raw);
  } catch (_e) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON isn't valid JSON (paste the whole key file).");
  }
  if (!sa || typeof sa.client_email !== "string" || typeof sa.private_key !== "string") {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is missing client_email or private_key.");
  }
  return { client_email: sa.client_email, private_key: sa.private_key, token_uri: sa.token_uri };
}

export function jwtClaims(sa: ServiceAccount, nowSec: number) {
  return {
    iss: sa.client_email,
    scope: DRIVE_SCOPE,
    aud: TOKEN_URL,
    iat: nowSec,
    exp: nowSec + 3600,
  };
}

export function pemToDer(pem: string): Uint8Array {
  const body = pem
    .replace(/\\n/g, "\n")
    .replace(/-----BEGIN [^-]+-----/, "")
    .replace(/-----END [^-]+-----/, "")
    .replace(/\s+/g, "");
  return b64urlDecode(body.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""));
}

/** header.claims.signature, RS256 with the service account's private key. */
export async function signServiceAccountJwt(sa: ServiceAccount, nowSec: number): Promise<string> {
  const header = { alg: "RS256", typ: "JWT" };
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(jwtClaims(sa, nowSec)))}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(input)));
  return `${input}.${b64url(sig)}`;
}

// ---------------------------------------------------------------------------
// Short-lived download links: <payload>.<HMAC-SHA256>. The payload names the
// client_files row and an expiry; the function streams the file only while
// the signature checks out and the link hasn't expired.
// ---------------------------------------------------------------------------
export const LINK_TTL_SEC = 600;

async function hmacKey(secret: string) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode("drive-files-link:" + secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function makeLinkToken(fileId: string, secret: string, nowSec: number, ttl = LINK_TTL_SEC): Promise<string> {
  const payload = b64url(JSON.stringify({ f: fileId, e: nowSec + ttl }));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), new TextEncoder().encode(payload)));
  return `${payload}.${b64url(sig)}`;
}

/** The client_files id the token is for, or null if it's forged or expired. */
export async function verifyLinkToken(token: string, secret: string, nowSec: number): Promise<string | null> {
  const parts = String(token || "").split(".");
  if (parts.length !== 2) return null;
  let ok = false;
  try {
    ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), b64urlDecode(parts[1]), new TextEncoder().encode(parts[0]));
  } catch (_e) {
    return null;
  }
  if (!ok) return null;
  try {
    const p = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[0])));
    if (typeof p.f !== "string" || !UUID_RE.test(p.f) || typeof p.e !== "number" || p.e < nowSec) return null;
    return p.f;
  } catch (_e) {
    return null;
  }
}
