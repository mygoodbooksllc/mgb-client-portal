// Tasks p2 S6: Ask-client links and emails, shared by tk-client-requests
// (staff send / resend), client-emails (the client_request_nudge job) and
// tk-request-respond (the public answer endpoint).
//
// Pure: no Deno or network APIs, so tests/edge/tk_requests.test.mjs runs it
// under plain node. Uses only WebCrypto (globalThis.crypto), which Deno and
// node share.
//
// Tokens: 32 random bytes, base64url (43 characters). The plain token lives
// only in the email body and the /respond#t= fragment; the database keeps
// sha256(token) as bytea. Never log a token or put it in a query string.

import { esc } from "./email.ts";
import { button, card, emailDocument, link, p, ruledList } from "./layout.ts";

export const APP_ORIGIN = "https://app.mygoodbooks.org";
export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CLIENT_ID_RE = /^[a-z0-9-]{1,80}$/;

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A fresh link token (43 base64url characters). */
export function newToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return b64url(bytes);
}

/** sha256 of the token's ASCII text, as lowercase hex (64 characters). */
export async function tokenHashHex(token: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The bytea literal PostgREST accepts for a bytea RPC argument. */
export async function tokenHashParam(token: string): Promise<string> {
  return "\\x" + (await tokenHashHex(token));
}

/** /respond link for a contact. `stop` adds the "Stop reminders" flag. */
export function respondLink(token: string, stop = false): string {
  if (!TOKEN_RE.test(token)) throw new Error("bad token");
  return `${APP_ORIGIN}/respond#t=${token}${stop ? "&stop=1" : ""}`;
}

/** Portal deep link: sign in, then Things we need for this request. */
export function portalLink(clientId: string, requestId?: string | null): string {
  if (!CLIENT_ID_RE.test(clientId)) throw new Error("bad client id");
  if (requestId && !UUID_RE.test(requestId)) throw new Error("bad request id");
  const next = `#/client/${clientId}/needs${requestId ? `/${requestId}` : ""}`;
  return `${APP_ORIGIN}/login?next=${encodeURIComponent(next)}`;
}

/** Long date in the firm's voice: "October 30, 2026". Input YYYY-MM-DD. */
export function longDate(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  if (!m) return "";
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${months[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

/** Date `days` from `now`, as YYYY-MM-DD in Chicago time. */
export function expiresOn(days: number, now: Date = new Date()): string {
  const d = new Date(now.getTime() + days * 86400000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

const firstWord = (s: string | null | undefined) => (String(s || "").trim().split(/\s+/)[0] || "");

export type AskEmailInput = {
  clientName: string;
  recipientName?: string | null;
  staffFirstName: string;
  title: string;
  prompt: string;
  dueDate?: string | null;
  href: string; // respondLink(...) or portalLink(...)
  viaPortal: boolean;
  expiresOn?: string | null; // YYYY-MM-DD, link emails only
  test?: boolean;
  unsubscribeHref?: string | null;
};

/** The first email for one request (spec C6 "Ask"). Every value is escaped. */
export function askEmail(i: AskEmailInput): { subject: string; html: string; text: string } {
  const who = firstWord(i.recipientName);
  const staff = firstWord(i.staffFirstName) || "Your bookkeeper";
  const subject = `${i.test ? "[Test] " : ""}${i.clientName}: ${i.title}`.slice(0, 300);
  const due = i.dueDate ? longDate(i.dueDate) : "";
  const exp = i.expiresOn ? longDate(i.expiresOn) : "";
  const linkNote = i.viaPortal
    ? "Sign in to the MyGoodBooks portal to reply or upload."
    : `This link works once and expires on ${exp}. It only shows this request.`;
  const inner = [
    p(esc(`Hi${who ? " " + who : ""},`)),
    p(esc(`${staff} at MyGoodBooks needs the following:`)),
    p(`<strong>${esc(i.title)}</strong>`, { margin: "0 0 8px 0" }),
    p(esc(i.prompt).replace(/\n/g, "<br>")),
    due ? p(esc(`Due ${due}.`), { tone: "muted" }) : "",
    button(i.viaPortal ? "Open in the portal" : "Reply or upload", i.href),
    p(esc(linkNote), { tone: "muted", size: 13.5 }),
  ].join("");
  const footer = [
    esc(`Questions? Reply to this email to reach ${staff}.`),
    i.unsubscribeHref ? ` ${link(i.unsubscribeHref, "Unsubscribe", "muted")}` : "",
  ].join("");
  const html = emailDocument({
    title: subject,
    preheader: `${staff} at MyGoodBooks needs: ${i.title}`,
    subtitle: i.clientName,
    cards: card(inner),
    footer,
  });
  const text = [
    `Hi${who ? " " + who : ""},`,
    "",
    `${staff} at MyGoodBooks needs the following:`,
    "",
    i.title,
    i.prompt,
    due ? `Due ${due}.` : "",
    "",
    `${i.viaPortal ? "Open in the portal" : "Reply or upload"}: ${i.href}`,
    linkNote,
    "",
    `Questions? Reply to this email to reach ${staff}.`,
  ].filter((l, n, a) => !(l === "" && a[n - 1] === "")).join("\n");
  return { subject, html, text };
}

export type NudgeItem = { title: string; href: string };
export type NudgeEmailInput = {
  clientName: string;
  recipientName?: string | null;
  items: NudgeItem[];
  viaPortal: boolean;
  stopHref?: string | null; // contacts: respondLink(token, true)
  unsubscribeHref?: string | null; // portal users
  replyToFirstName?: string | null;
};

/** One combined reminder per recipient per client per day (spec C6 "Nudge"). */
export function nudgeEmail(i: NudgeEmailInput): { subject: string; html: string; text: string } {
  const n = i.items.length;
  const who = firstWord(i.recipientName);
  const subject = `Reminder: ${n} item${n === 1 ? "" : "s"} ${i.clientName} still needs from you`.slice(0, 300);
  const rows = i.items.map((it) => `${esc(it.title)}<br>${link(it.href, i.viaPortal ? "Open in the portal" : "Reply or upload")}`);
  const inner = [
    p(esc(`Hi${who ? " " + who : ""},`)),
    p(esc(`MyGoodBooks is still waiting on ${n === 1 ? "this item" : "these items"}:`)),
    ruledList(rows),
    i.viaPortal ? "" : p(esc("Each link works once and only shows that request."), { tone: "muted", size: 13.5 }),
  ].join("");
  const staff = firstWord(i.replyToFirstName);
  const footer = [
    esc(staff ? `Questions? Reply to this email to reach ${staff}.` : "Questions? Reply to this email."),
    i.stopHref ? ` ${link(i.stopHref, "Stop reminders", "muted")}` : "",
    i.unsubscribeHref ? ` ${link(i.unsubscribeHref, "Unsubscribe", "muted")}` : "",
  ].join("");
  const html = emailDocument({ title: subject, preheader: subject, subtitle: i.clientName, cards: card(inner), footer });
  const text = [
    `Hi${who ? " " + who : ""},`,
    "",
    `MyGoodBooks is still waiting on ${n === 1 ? "this item" : "these items"}:`,
    "",
    ...i.items.map((it) => `- ${it.title}: ${it.href}`),
    "",
    staff ? `Questions? Reply to this email to reach ${staff}.` : "Questions? Reply to this email.",
    i.stopHref ? `Stop reminders: ${i.stopHref}` : "",
    i.unsubscribeHref ? `Unsubscribe: ${i.unsubscribeHref}` : "",
  ].filter(Boolean).join("\n");
  return { subject, html, text };
}
