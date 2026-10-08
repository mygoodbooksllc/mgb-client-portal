// team-reviews: PDFs, Google Drive export and emails for Team Reviews.
//
// verify_jwt is off; every request is checked here.
//   Signed-in staff (Supabase session bearer), body { action, ... }:
//     pdf          { review_id }        signed review PDF. The reviewee, the reviewer, or an admin.
//     export       { review_id }        admin: (re)save the signed PDF to Drive.
//     year_pdf     { staff_id, year }   confirmed year-end summary PDF. That person or an admin.
//     year_export  { staff_id, year }   admin: save the confirmed summary to Drive.
//     drive_status {}                   admin: is the reviews Shared Drive reachable?
//   Machine (service role key, or the Vault qbo_cron_key used by tr_kick / tr_cron):
//     { job: "export_review", id }      after the second signature / an addendum
//     { job: "sweep" }                  send queued emails, retry failed exports
//     { action: "drive_status" }        read-only check (also allowed for the cron key)
//
// Clients never reach anything here: callers must be active rows in public.staff.
// Staff never get Drive links; they download through `pdf` / `year_pdf`.
//
// Secrets (set by the owner; never logged or returned):
//   GOOGLE_SERVICE_ACCOUNT_JSON     shared with drive-files
//   GOOGLE_DRIVE_REVIEWS_DRIVE_ID   the admin-only "~ MGB: Staff Reviews" Shared Drive
//   RESEND_API_KEY                  via ../_shared/email.ts
//
// Deploy with ../drive-files/logic.ts, ../_shared/email.ts, ../_shared/layout.ts and ./pdf.ts.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";
import * as PDFLib from "npm:pdf-lib@1.17.1";
import { DRIVE_SCOPE, driveQ, parseServiceAccount, signServiceAccountJwt, TOKEN_URL, UUID_RE } from "../drive-files/logic.ts";
import { esc, sendEmail } from "../_shared/email.ts";
import * as L from "../_shared/layout.ts";
import { buildReviewPdf, buildYearPdf } from "./pdf.ts";

void DRIVE_SCOPE; // scope is baked into signServiceAccountJwt's claims

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const APP_URL = "https://app.mygoodbooks.org/";
const TZ = "America/Chicago";
const DRIVE = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const WAITING = "waiting_for_drive_setup";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
class HttpError extends Error {
  constructor(public status: number, message: string, public code = "error") {
    super(message);
  }
}
function secretsMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
const clip = (s: unknown, n = 500) => String(s ?? "").slice(0, n);

// ---------------------------------------------------------------------------
// Google Drive
// ---------------------------------------------------------------------------
function reviewsDriveId(): string | null {
  const v = (Deno.env.get("GOOGLE_DRIVE_REVIEWS_DRIVE_ID") || "").trim();
  return v || null;
}
function driveReady(): boolean {
  return !!reviewsDriveId() && !!Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON");
}

let cachedToken: { token: string; exp: number } | null = null;
async function accessToken(): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.exp - 60 > nowSec) return cachedToken.token;
  const sa = parseServiceAccount(Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON") || "");
  let assertion: string;
  try {
    assertion = await signServiceAccountJwt(sa, nowSec);
  } catch (_e) {
    throw new HttpError(503, "The service account's private_key couldn't be read.", "drive_auth_failed");
  }
  const res = await fetch(sa.token_uri || TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    throw new HttpError(503, `Google refused the service account (${res.status} ${body.error || ""})`.trim(), "drive_auth_failed");
  }
  cachedToken = { token: body.access_token, exp: nowSec + Number(body.expires_in || 3600) };
  return cachedToken.token;
}
async function drive(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers || {});
  headers.set("Authorization", `Bearer ${await accessToken()}`);
  return fetch(url, { ...init, headers });
}
async function driveJson(url: string, init: RequestInit = {}): Promise<any> {
  const res = await drive(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new HttpError(res.status === 404 ? 404 : 502, `Google Drive: ${body?.error?.message || res.statusText}`, "drive_error");
  }
  return body;
}
function qs(params: Record<string, string>) {
  return new URLSearchParams({ supportsAllDrives: "true", ...params }).toString();
}
async function findOne(q: string): Promise<{ id: string; name: string } | null> {
  const driveId = reviewsDriveId()!;
  const body = await driveJson(`${DRIVE}/files?` + qs({
    q, corpora: "drive", driveId, includeItemsFromAllDrives: "true", fields: "files(id,name)", pageSize: "5",
  }));
  return body.files?.[0] || null;
}

/** "{Staff Name}" folder at the shared drive root, found by appProperties so a rename never duplicates it. */
async function staffFolder(db: SupabaseClient, staff: { id: string; name: string }): Promise<string> {
  const driveId = reviewsDriveId()!;
  const name = String(staff.name || "Team member").replace(/[\/\\]/g, "-").trim();
  const { data: cached } = await db.from("review_drive_folders").select("*").eq("staff_id", staff.id).maybeSingle();
  if (cached?.drive_folder_id) {
    const res = await drive(`${DRIVE}/files/${cached.drive_folder_id}?` + qs({ fields: "id,name,trashed" }));
    const f = await res.json().catch(() => ({}));
    if (res.ok && !f.trashed) {
      if (f.name !== name) {
        await driveJson(`${DRIVE}/files/${cached.drive_folder_id}?` + qs({ fields: "id" }), {
          method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }),
        });
        await db.from("review_drive_folders").update({ name, updated_at: new Date().toISOString() }).eq("staff_id", staff.id);
      }
      return cached.drive_folder_id;
    }
  }
  let folder = await findOne(
    `'${driveQ(driveId)}' in parents and mimeType='${FOLDER_MIME}' and trashed=false and appProperties has { key='mgbStaffId' and value='${driveQ(staff.id)}' }`,
  );
  if (!folder) {
    folder = await driveJson(`${DRIVE}/files?` + qs({ fields: "id,name" }), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [driveId], appProperties: { mgbStaffId: staff.id } }),
    });
  }
  await db.from("review_drive_folders").upsert({ staff_id: staff.id, name, drive_folder_id: folder!.id, updated_at: new Date().toISOString() });
  return folder!.id;
}

function multipart(meta: unknown, bytes: Uint8Array): { body: Uint8Array; type: string } {
  const b = "mgb" + crypto.randomUUID().replace(/-/g, "");
  const enc = new TextEncoder();
  const head = enc.encode(
    `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${b}\r\nContent-Type: application/pdf\r\n\r\n`,
  );
  const tail = enc.encode(`\r\n--${b}--`);
  const body = new Uint8Array(head.length + bytes.length + tail.length);
  body.set(head, 0);
  body.set(bytes, head.length);
  body.set(tail, head.length + bytes.length);
  return { body, type: `multipart/related; boundary=${b}` };
}

/** Saves the PDF. An existing file (by id, else by appProperties) gets a new revision, never a duplicate. */
async function savePdf(folderId: string, name: string, bytes: Uint8Array, knownId: string | null, prop: Record<string, string>) {
  let fileId = knownId;
  if (fileId) {
    const res = await drive(`${DRIVE}/files/${fileId}?` + qs({ fields: "id,trashed" }));
    const f = await res.json().catch(() => ({}));
    if (!res.ok || f.trashed) fileId = null;
  }
  if (!fileId) {
    const [k, v] = Object.entries(prop)[0];
    const found = await findOne(`'${driveQ(folderId)}' in parents and trashed=false and appProperties has { key='${k}' and value='${driveQ(v)}' }`);
    fileId = found?.id || null;
  }
  if (fileId) {
    const mp = multipart({ name, mimeType: "application/pdf" }, bytes);
    const f = await driveJson(`${DRIVE_UPLOAD}/files/${fileId}?` + qs({ uploadType: "multipart", fields: "id" }), {
      method: "PATCH", headers: { "Content-Type": mp.type }, body: mp.body,
    });
    return f.id as string;
  }
  const mp = multipart({ name, mimeType: "application/pdf", parents: [folderId], appProperties: prop }, bytes);
  const f = await driveJson(`${DRIVE_UPLOAD}/files?` + qs({ uploadType: "multipart", fields: "id" }), {
    method: "POST", headers: { "Content-Type": mp.type }, body: mp.body,
  });
  return f.id as string;
}

async function driveStatus() {
  const missing: string[] = [];
  if (!Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON")) missing.push("GOOGLE_SERVICE_ACCOUNT_JSON");
  if (!reviewsDriveId()) missing.push("GOOGLE_DRIVE_REVIEWS_DRIVE_ID");
  if (missing.length) return { connected: false, missing };
  try {
    const res = await drive(`${DRIVE}/drives/${encodeURIComponent(reviewsDriveId()!)}?fields=id,name`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { connected: false, status: res.status, error: clip(body?.error?.message || res.statusText, 300) };
    }
    return { connected: true, drive_name: body.name };
  } catch (e) {
    return { connected: false, error: clip((e as Error).message, 300) };
  }
}

// ---------------------------------------------------------------------------
// Export jobs
// ---------------------------------------------------------------------------
const reviewFileName = (doc: any) => `${doc.cycle.year} Q${doc.cycle.quarter} Review.pdf`;

async function exportReview(db: SupabaseClient, reviewId: string) {
  const { data: doc, error } = await db.rpc("tr_review_doc", { p_review: reviewId });
  if (error) throw new HttpError(500, error.message);
  if (!doc) throw new HttpError(409, "Only signed reviews are exported.", "not_signed");
  const now = new Date().toISOString();
  let result: Record<string, unknown>;
  if (!driveReady()) {
    await db.from("reviews").update({ drive_export_attempted_at: now, drive_export_error: WAITING }).eq("id", reviewId);
    result = { ok: false, error: WAITING };
  } else {
    try {
      const bytes = await buildReviewPdf(PDFLib, doc);
      const folder = await staffFolder(db, doc.staff);
      const fileId = await savePdf(folder, reviewFileName(doc), bytes, doc.drive_file_id, { mgbReviewId: reviewId });
      await db.from("reviews").update({
        drive_file_id: fileId, drive_exported_at: now, drive_export_attempted_at: now, drive_export_error: null,
      }).eq("id", reviewId);
      result = { ok: true, drive: { exported_at: now } };
    } catch (e) {
      const msg = clip((e as Error).message, 500);
      await db.from("reviews").update({ drive_export_attempted_at: now, drive_export_error: msg }).eq("id", reviewId);
      result = { ok: false, error: msg };
    }
  }
  // "Locked" email, once per person per review (re-exports after an addendum don't resend).
  const payload = { cycle: doc.cycle.label, staff_name: doc.staff?.name };
  await db.from("review_notifications").upsert([
    { kind: "locked", to_staff_id: doc.staff_id, review_id: reviewId, payload, dedupe_key: `locked:${reviewId}:staff` },
    { kind: "locked", to_staff_id: doc.reviewer_id, review_id: reviewId, payload, dedupe_key: `locked:${reviewId}:reviewer` },
  ], { onConflict: "dedupe_key", ignoreDuplicates: true });
  return result;
}

async function exportYear(db: SupabaseClient, staffId: string, year: number) {
  const { data: doc, error } = await db.rpc("tr_year_doc", { p_staff: staffId, p_year: year });
  if (error) throw new HttpError(500, error.message);
  if (!doc) throw new HttpError(409, "Confirm the year-end summary before exporting it.", "not_confirmed");
  if (!driveReady()) return { ok: false, error: WAITING };
  const bytes = await buildYearPdf(PDFLib, doc);
  const folder = await staffFolder(db, doc.staff);
  const fileId = await savePdf(folder, `${doc.year} Year-End Summary.pdf`, bytes, doc.drive_file_id, { mgbYearSummaryId: doc.id });
  const now = new Date().toISOString();
  await db.from("review_year_summaries").update({ drive_file_id: fileId, drive_exported_at: now }).eq("id", doc.id);
  return { ok: true, drive: { exported_at: now } };
}

// ---------------------------------------------------------------------------
// Emails (outbox: public.review_notifications)
// ---------------------------------------------------------------------------
const firstName = (n: unknown) => String(n || "").trim().split(/\s+/)[0] || "";
function fmtDue(d: string | null | undefined): string {
  if (!d) return "";
  return new Date(`${String(d).slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
}
function emailFor(n: any, to: any, review: any): { subject: string; lines: string[]; cta: string; href: string } | null {
  const p = n.payload || {};
  const cycle = p.cycle || "this quarter";
  const reviewLink = n.review_id ? `${APP_URL}#/team/reviews/r/${n.review_id}` : `${APP_URL}#/team/reviews`;
  const isReviewer = review && review.reviewer_id === n.to_staff_id;
  const staffName = p.staff_name || review?.staff_name || "the team member";
  const revFirst = firstName(review?.reviewer_name) || "your reviewer";
  switch (n.kind) {
    case "cycle_opened":
      return {
        subject: `Your ${cycle} review is open`,
        lines: [
          `Your ${cycle} quarterly review is open${p.due_at ? `, due ${fmtDue(p.due_at)}` : ""}.`,
          "Complete your self-review and the team survey in the portal. Your scores stay hidden from your reviewer until both reviews are in.",
        ],
        cta: "Start my self-review", href: reviewLink,
      };
    case "review_assigned":
      return {
        subject: `Review ${staffName} for ${cycle}`,
        lines: [
          `You're the reviewer for ${staffName}'s ${cycle} review${p.due_at ? `, due ${fmtDue(p.due_at)}` : ""}.`,
          "Neither of you sees the other's scores until both reviews are submitted.",
        ],
        cta: "Open the review", href: reviewLink,
      };
    case "comparison_ready":
      return {
        subject: `${cycle} comparison is ready`,
        lines: isReviewer
          ? [`Both reviews are in for ${staffName}. The comparison is open.`, "Schedule the review meeting to agree action steps, then both of you sign."]
          : [`Both reviews are in for your ${cycle} review. The comparison is open.`, `Schedule your review meeting with ${revFirst}. You'll agree action steps together, then both sign.`],
        cta: "See the comparison", href: reviewLink,
      };
    case "reopened":
      return {
        subject: `Your ${p.kind === "manager" ? "review of " + staffName : "self-review"} was reopened`,
        lines: [
          `An admin reopened your ${p.kind === "manager" ? "review of " + staffName : "self-review"} for ${cycle} so you can make changes.`,
          p.reason ? `Reason: ${p.reason}` : "",
          "Submit it again when you're done. The comparison stays hidden until then.",
        ].filter(Boolean),
        cta: "Open the review", href: reviewLink,
      };
    case "signature_needed":
      return {
        subject: `${firstName(p.signer_name) || "The other person"} signed the ${cycle} review`,
        lines: [
          `${p.signer_name || "The other person"} signed ${isReviewer ? staffName + "'s" : "your"} ${cycle} review.`,
          "Sign from your own portal login to lock it.",
        ],
        cta: "Sign the review", href: reviewLink,
      };
    case "reminder":
    case "due_soon": {
      const t = p.todo || {};
      const items = [
        t.self ? "Your self-review" : "",
        t.manager ? `Your review of ${staffName}` : "",
        t.survey ? "The team survey" : "",
        t.sign ? "Sign your review" : "",
      ].filter(Boolean);
      if (!items.length) return null;
      return {
        subject: n.kind === "due_soon" ? `${cycle} review due ${fmtDue(p.due_at)}` : `Reminder: ${cycle} review due ${fmtDue(p.due_at)}`,
        lines: [`Still to do for ${cycle}:`, ...items.map((i) => "- " + i)],
        cta: "Open Reviews", href: t.survey && !t.self && !t.manager && !t.sign ? `${APP_URL}#/team/reviews/survey` : reviewLink,
      };
    }
    case "locked": {
      const adminWithFile = to.role === "admin" && review?.drive_file_id;
      return {
        subject: `${cycle} review signed and locked`,
        lines: isReviewer
          ? [`${staffName}'s ${cycle} review is signed by both of you and locked.`,
             adminWithFile ? "The signed PDF is saved in the Staff Reviews Shared Drive." : "The signed PDF will be saved to Drive; you can download it from the portal any time."]
          : [`Your ${cycle} review is signed by both of you and locked.`, "You can download the signed PDF from Reviews in the portal any time."],
        cta: adminWithFile ? "Open in Drive" : "Open the review",
        href: adminWithFile ? `https://drive.google.com/file/d/${review.drive_file_id}/view` : reviewLink,
      };
    }
  }
  return null;
}

async function sendOutbox(db: SupabaseClient) {
  const out = { sent: 0, failed: 0, skipped: 0 };
  const { data: rows } = await db.from("review_notifications").select("*").eq("status", "queued").order("created_at").limit(40);
  for (const n of rows || []) {
    const { data: to } = await db.from("staff").select("id, name, email, role, active").eq("id", n.to_staff_id).maybeSingle();
    let review: any = null;
    if (n.review_id) {
      const { data: r } = await db.from("reviews").select("staff_id, reviewer_id, drive_file_id").eq("id", n.review_id).maybeSingle();
      if (r) {
        const { data: ppl } = await db.from("staff").select("id, name").in("id", [r.staff_id, r.reviewer_id]);
        const nm = (id: string) => (ppl || []).find((x: any) => x.id === id)?.name;
        review = { ...r, staff_name: nm(r.staff_id), reviewer_name: nm(r.reviewer_id) };
      }
    }
    const msg = to?.active && to.email ? emailFor(n, to, review) : null;
    if (!msg) {
      await db.from("review_notifications").update({ status: "skipped", last_error: to?.active ? "nothing to send" : "recipient inactive" }).eq("id", n.id);
      out.skipped++;
      continue;
    }
    const html = L.emailDocument({
      title: msg.subject,
      preheader: msg.lines[0] || msg.subject,
      subtitle: "Team reviews",
      cards: L.card(L.p(`Hi ${esc(firstName(to.name))},`) + msg.lines.map((l) => L.p(esc(l))).join("") + L.button(msg.cta, msg.href)),
      footer: "You're receiving this because you're on the MyGoodBooks team. Reviews are private to you, your reviewer and MyGoodBooks admins.",
    });
    const text = [`Hi ${firstName(to.name)},`, "", ...msg.lines, "", `${msg.cta}: ${msg.href}`].join("\n");
    const res = await sendEmail({ to: [to.email], subject: msg.subject, html, text, tags: [{ name: "kind", value: `team_reviews_${n.kind}` }] });
    if (res.ok) {
      await db.from("review_notifications").update({ status: "sent", sent_at: new Date().toISOString(), attempts: n.attempts + 1, last_error: null }).eq("id", n.id);
      out.sent++;
    } else if ((res as any).notConfigured) {
      await db.from("review_notifications").update({ status: "skipped", attempts: n.attempts + 1, last_error: "email not configured" }).eq("id", n.id);
      out.skipped++;
    } else {
      const giveUp = n.attempts + 1 >= 5;
      await db.from("review_notifications").update({ status: giveUp ? "failed" : "queued", attempts: n.attempts + 1, last_error: clip((res as any).error, 300) }).eq("id", n.id);
      out.failed++;
    }
  }
  return out;
}

async function sweep(db: SupabaseClient) {
  const exports: Record<string, unknown>[] = [];
  const cutoff = new Date(Date.now() - 3600_000).toISOString();
  const { data: due } = await db.from("reviews").select("id").eq("status", "signed").is("drive_file_id", null)
    .or(`drive_export_attempted_at.is.null,drive_export_attempted_at.lt.${cutoff}`).limit(5);
  for (const r of due || []) {
    try {
      exports.push({ id: r.id, ...(await exportReview(db, r.id)) });
    } catch (e) {
      exports.push({ id: r.id, ok: false, error: clip((e as Error).message, 200) });
    }
  }
  const emails = await sendOutbox(db);
  return { exports: exports.length, emails };
}

// ---------------------------------------------------------------------------
// Callers
// ---------------------------------------------------------------------------
type Me = { id: string; name: string; email: string; isAdmin: boolean };
async function caller(req: Request, db: SupabaseClient): Promise<Me> {
  const auth = req.headers.get("Authorization") || "";
  if (!/^Bearer\s+\S+/i.test(auth)) throw new HttpError(401, "Sign in again.", "unauthorized");
  const asUser = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } } });
  const { data, error } = await asUser.auth.getUser();
  const email = data?.user?.email?.toLowerCase();
  if (error || !email) throw new HttpError(401, "Sign in again.", "unauthorized");
  const { data: st } = await db.from("staff").select("id, name, email, role, active").ilike("email", email.replace(/[\\%_]/g, (c) => "\\" + c)).eq("active", true).maybeSingle();
  if (!st) throw new HttpError(403, "Reviews are only for the MyGoodBooks team.", "forbidden");
  return { id: st.id, name: st.name, email, isAdmin: st.role === "admin" };
}

function pdfResponse(bytes: Uint8Array, filename: string) {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");
  return new Response(bytes, {
    status: 200,
    headers: {
      ...CORS,
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed", message: "POST only." }, 405);
  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  let body: any = {};
  try {
    body = await req.json();
  } catch (_e) {
    body = {};
  }
  try {
    const presented = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    let machine = !!presented && secretsMatch(presented, SERVICE_ROLE_KEY);
    if (!machine && presented) {
      // Maybe the Vault cron key (tr_kick / tr_cron).
      const { data: cronKey } = await db.rpc("qbo_cron_key");
      machine = typeof cronKey === "string" && cronKey.length > 0 && secretsMatch(presented, cronKey);
    }

    if (machine) {
      if (body.action === "drive_status") return json(await driveStatus());
      if (body.job === "export_review" && UUID_RE.test(String(body.id || ""))) {
        const r = await exportReview(db, body.id);
        const emails = await sendOutbox(db);
        return json({ ...r, emails });
      }
      if (body.job === "sweep") return json(await sweep(db));
      return json({ error: "bad_request", message: "Unknown job." }, 400);
    }

    const me = await caller(req, db);
    const action = String(body.action || "");
    const requireAdmin = () => {
      if (!me.isAdmin) throw new HttpError(403, "Only admins can do that.", "forbidden");
    };

    if (action === "drive_status") {
      requireAdmin();
      return json(await driveStatus());
    }

    if (action === "pdf" || action === "export") {
      const id = String(body.review_id || "");
      if (!UUID_RE.test(id)) throw new HttpError(400, "Missing review.", "bad_request");
      const { data: r } = await db.from("reviews").select("id, staff_id, reviewer_id, status").eq("id", id).maybeSingle();
      if (!r) throw new HttpError(404, "Review not found.", "not_found");
      const allowed = me.isAdmin || r.staff_id === me.id || r.reviewer_id === me.id;
      if (!allowed) throw new HttpError(404, "Review not found.", "not_found");
      if (action === "export") {
        requireAdmin();
        const res = await exportReview(db, id);
        await sendOutbox(db);
        if (!res.ok && res.error !== WAITING) throw new HttpError(502, `Couldn't save to Drive: ${res.error}`, "drive_error");
        return json(res);
      }
      const { data: doc } = await db.rpc("tr_review_doc", { p_review: id });
      if (!doc) throw new HttpError(409, "The PDF is available once both people sign.", "not_signed");
      const bytes = await buildReviewPdf(PDFLib, doc);
      return pdfResponse(bytes, `${doc.staff?.name || "Review"} - ${reviewFileName(doc)}`);
    }

    if (action === "year_pdf" || action === "year_export") {
      const staffId = String(body.staff_id || "");
      const year = Number(body.year);
      if (!UUID_RE.test(staffId) || !Number.isInteger(year) || year < 2000 || year > 2100) {
        throw new HttpError(400, "Pick a person and a year.", "bad_request");
      }
      if (!me.isAdmin && staffId !== me.id) throw new HttpError(404, "Summary not found.", "not_found");
      if (action === "year_export") {
        requireAdmin();
        return json(await exportYear(db, staffId, year));
      }
      const { data: doc } = await db.rpc("tr_year_doc", { p_staff: staffId, p_year: year });
      if (!doc) throw new HttpError(409, "The year-end summary isn't confirmed yet.", "not_confirmed");
      const bytes = await buildYearPdf(PDFLib, doc);
      return pdfResponse(bytes, `${doc.staff?.name || "Staff"} - ${year} Year-End Summary.pdf`);
    }

    throw new HttpError(400, "Unknown action.", "bad_request");
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    const code = e instanceof HttpError ? e.code : "error";
    if (status >= 500) console.log(`team-reviews: ${clip((e as Error).message, 300)}`);
    return json({ error: code, message: clip((e as Error).message, 300) || "Something went wrong." }, status);
  }
});
