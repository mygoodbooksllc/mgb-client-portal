// Inventory export (owner 2026-10-08; Team › Inventory, was "Tech"). Admins only.
//
//   POST { action: "status" }  -> { connected, folder? }   is Drive set up?
//   POST { action: "export" }  -> { ok, url, name }        new Google Sheet
//
// Each export is a new Google Sheet (tabs Requests, Items, Roster,
// Standard setup, Directory) in an "Inventory" folder on the admin-only
// Shared Drive (GOOGLE_DRIVE_REVIEWS_DRIVE_ID, the same drive as quarterly
// reviews), so home addresses never land in the client files drive.
// verify_jwt is off: the caller's JWT is checked here (active admin staff).
// Deploy: npx supabase@latest functions deploy tech-inventory --project-ref xumsqmhccgfjnlmieqyu --no-verify-jwt

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";
import * as XLSX from "npm:xlsx@0.18.5";
import { driveQ, parseServiceAccount, signServiceAccountJwt, TOKEN_URL } from "../drive-files/logic.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const TZ = "America/New_York";
const DRIVE = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const SHEET_MIME = "application/vnd.google-apps.spreadsheet";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const FOLDER_NAME = "Inventory";
// Same rule as TI_isLaptop in components/staff/TechInventory.jsx.
const LAPTOP_RE = /mac|laptop|lenovo|dell|thinkpad|chromebook|notebook|\bhp\b/i;
const NOT_LAPTOP_RE = /desktop|imac|mac mini/i;

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

function driveId(): string | null {
  return (Deno.env.get("GOOGLE_DRIVE_REVIEWS_DRIVE_ID") || "").trim() || null;
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
async function driveJson(url: string, init: RequestInit = {}): Promise<any> {
  const headers = new Headers(init.headers || {});
  headers.set("Authorization", `Bearer ${await accessToken()}`);
  const res = await fetch(url, { ...init, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(502, `Google Drive: ${body?.error?.message || res.statusText}`, "drive_error");
  return body;
}
function qs(params: Record<string, string>) {
  return new URLSearchParams({ supportsAllDrives: "true", ...params }).toString();
}

/** The "Inventory" folder at the shared drive root (an earlier "Tech inventory" one is reused), found by appProperties so a rename never duplicates it. */
async function folderId(): Promise<string> {
  const d = driveId()!;
  const found = await driveJson(`${DRIVE}/files?` + qs({
    q: `'${driveQ(d)}' in parents and mimeType='${FOLDER_MIME}' and trashed=false and appProperties has { key='mgbTechInventory' and value='1' }`,
    corpora: "drive", driveId: d, includeItemsFromAllDrives: "true", fields: "files(id)", pageSize: "1",
  }));
  if (found.files?.[0]?.id) return found.files[0].id;
  const made = await driveJson(`${DRIVE}/files?` + qs({ fields: "id" }), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: FOLDER_MIME, parents: [d], appProperties: { mgbTechInventory: "1" } }),
  });
  return made.id;
}

function multipart(meta: unknown, bytes: Uint8Array, mediaType: string): { body: Uint8Array; type: string } {
  const b = "mgb" + crypto.randomUUID().replace(/-/g, "");
  const enc = new TextEncoder();
  const head = enc.encode(
    `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${b}\r\nContent-Type: ${mediaType}\r\n\r\n`,
  );
  const tail = enc.encode(`\r\n--${b}--`);
  const body = new Uint8Array(head.length + bytes.length + tail.length);
  body.set(head, 0);
  body.set(bytes, head.length);
  body.set(tail, head.length + bytes.length);
  return { body, type: `multipart/related; boundary=${b}` };
}

async function caller(req: Request, db: SupabaseClient) {
  const auth = req.headers.get("Authorization") || "";
  if (!/^Bearer\s+\S+/i.test(auth)) throw new HttpError(401, "Sign in again.", "unauthorized");
  const asUser = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } } });
  const { data, error } = await asUser.auth.getUser();
  const email = data?.user?.email?.toLowerCase();
  if (error || !email) throw new HttpError(401, "Sign in again.", "unauthorized");
  const { data: st } = await db.from("staff").select("email, role, active").ilike("email", email.replace(/[\\%_]/g, (c) => "\\" + c)).eq("active", true).maybeSingle();
  if (!st || st.role !== "admin") throw new HttpError(403, "Only admins can export the inventory.", "forbidden");
  return { email };
}

const day = (v: unknown) => (v ? String(v).slice(0, 10) : "");
const stamp = (v: unknown) =>
  v ? new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(String(v))) : "";
const isLaptop = (a: any) => {
  const t = `${a.category || ""} ${a.item || ""}`;
  return LAPTOP_RE.test(t) && !NOT_LAPTOP_RE.test(t);
};
// Same rule as TI_covers: category/item equals or ends with the setup item; any laptop covers a laptop line.
const covers = (a: any, item: string) => {
  const k = item.toLowerCase();
  if (LAPTOP_RE.test(k) && !NOT_LAPTOP_RE.test(k)) return isLaptop(a);
  return [a.category, a.item].some((v) => {
    const t = String(v || "").toLowerCase();
    return t === k || t.endsWith(" " + k);
  });
};

async function buildWorkbook(db: SupabaseClient): Promise<Uint8Array> {
  const [rq, as, su, st, ct] = await Promise.all([
    db.from("tech_requests").select("*").order("created_at", { ascending: false }),
    db.from("tech_assets").select("*").order("created_at", { ascending: false }),
    db.from("tech_setup").select("*").order("sort"),
    db.from("staff").select("email, name, role, active").order("name"),
    db.from("staff_contact").select("*"),
  ]);
  const bad = rq.error || as.error || su.error || st.error || ct.error;
  if (bad) throw new HttpError(500, bad.message);
  const staff = (st.data || []).map((s: any) => ({ ...s, email: String(s.email).toLowerCase() }));
  const nameOf = (e: string) => staff.find((s: any) => s.email === String(e).toLowerCase())?.name || e;
  const active = staff.filter((s: any) => s.active);
  const assets = as.data || [];
  const liveAssets = assets.filter((a: any) => !a.archived_at);
  const requests = rq.data || [];
  const setup = (su.data || []).filter((s: any) => !s.archived_at);
  const essentials = setup.filter((s: any) => s.essential).map((s: any) => String(s.item));
  const contact = new Map((ct.data || []).map((c: any) => [String(c.staff_email).toLowerCase(), c]));

  const wb = XLSX.utils.book_new();
  const add = (name: string, header: string[], rows: unknown[][]) => {
    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    ws["!cols"] = header.map((h) => ({ wch: Math.max(10, Math.min(48, h.length + 4)) }));
    XLSX.utils.book_append_sheet(wb, ws, name);
  };

  add("Requests", ["Requested", "Person", "Email", "Item", "Why", "Priority", "Status", "Archived"],
    requests.map((r: any) => [stamp(r.created_at), nameOf(r.staff_email), r.staff_email, r.item, r.reason || "", r.priority, r.status, stamp(r.archived_at)]));

  add("Items", ["Logged", "Person", "Email", "Category", "Item", "Serial", "Condition", "Received", "Notes", "Archived"],
    assets.map((a: any) => [stamp(a.created_at), nameOf(a.staff_email), a.staff_email, a.category, a.item, a.serial || "", a.condition, day(a.date_received), a.notes || "", stamp(a.archived_at)]));

  add("Roster", ["Person", "Email", "Laptop", "Items", "Open requests", "Missing essentials", ...essentials],
    active.map((s: any) => {
      const mine = liveAssets.filter((a: any) => String(a.staff_email).toLowerCase() === s.email);
      const laptop = mine.find(isLaptop);
      const open = requests.filter((r: any) => !r.archived_at && String(r.staff_email).toLowerCase() === s.email && (r.status === "Open" || r.status === "Ordered")).length;
      const have = essentials.map((e: string) => mine.some((a: any) => covers(a, e)));
      return [s.name, s.email, laptop ? laptop.item : "", mine.length, open, have.filter((h) => !h).length, ...have.map((h) => (h ? "Yes" : ""))];
    }));

  add("Standard setup", ["Item", "Essential", "Price", "Link"],
    setup.map((s: any) => [s.item, s.essential ? "Yes" : "Optional", s.price == null ? "" : Number(s.price), s.link || ""]));

  add("Directory", ["Name", "Email", "Role", "Full name", "Personal email", "Work phone", "Home phone", "Mobile", "Street", "City", "State", "ZIP"],
    active.map((s: any) => {
      const c: any = contact.get(s.email) || {};
      return [s.name, s.email, s.role === "admin" ? "Admin" : "Bookkeeper", c.full_name || "", c.personal_email || "", c.work_phone || "", c.home_phone || "", c.mobile || "", c.street || "", c.city || "", c.state || "", c.zip || ""];
    }));

  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return new Uint8Array(out);
}

async function exportSheet(db: SupabaseClient) {
  const bytes = await buildWorkbook(db);
  const parent = await folderId();
  const when = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date()).replace(",", "");
  const name = `Inventory ${when}`;
  const mp = multipart({ name, mimeType: SHEET_MIME, parents: [parent] }, bytes, XLSX_MIME);
  const f = await driveJson(`${DRIVE_UPLOAD}/files?` + qs({ uploadType: "multipart", fields: "id,webViewLink" }), {
    method: "POST", headers: { "Content-Type": mp.type }, body: mp.body,
  });
  return { ok: true, name, url: f.webViewLink || `https://docs.google.com/spreadsheets/d/${f.id}/edit` };
}

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
    await caller(req, db);
    const ready = !!driveId() && !!Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON");
    if (body.action === "status") return json({ connected: ready });
    if (body.action === "export") {
      if (!ready) return json({ error: "drive_not_set_up", message: "Google Drive isn't connected yet (same setup as quarterly reviews)." }, 503);
      return json(await exportSheet(db));
    }
    return json({ error: "bad_request", message: "Unknown action." }, 400);
  } catch (e) {
    const err = e instanceof HttpError ? e : new HttpError(500, String((e as Error)?.message || e).slice(0, 300));
    return json({ error: err.code, message: err.message }, err.status);
  }
});
