import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  clientFolderName,
  cleanYear,
  contentDisposition,
  currentYear,
  docTypeFor,
  driveQ,
  makeLinkToken,
  MAX_BYTES,
  normalizeDocType,
  parseServiceAccount,
  ServiceAccount,
  signServiceAccountJwt,
  TOKEN_URL,
  typeOf,
  UUID_RE,
  verifyLinkToken,
  yearForRequest,
} from "./logic.ts";

// Client files in the firm's Google Drive (supabase/google-drive-files.sql has
// the design and schema; docs/staff-guide/google-drive-files.md the setup).
//
// The file of record lives in the "MGB Client Files" Shared Drive under
// <Client name> / <Year> / <Document type>. Supabase keeps only client_files
// (metadata + Drive file id). Drive files are never shared publicly or by
// link: clients have no Google access, so every download is streamed through
// this function.
//
// verify_jwt is OFF because download links (GET ?t=) are opened straight by
// the browser and can't carry an Authorization header. Every other action
// checks the caller's own JWT here and authorizes with the same helpers the
// old client-uploads bucket policies used (is_active_staff, can_access_client,
// is_client_member).
//
// POST actions (JSON body unless noted):
//   status                         -> { connected }
//   upload  (multipart form)       file, client_id, visibility (shared |
//                                  internal | request | message), doc_type,
//                                  year, request_id, participant, internal
//   list    client_id, scope (documents | trash | request), request_id
//   link    ids[] (client_files ids) -> { links: { id: url } }   10 min each
//   trash / restore   id           staff only. Drive trash, never delete.
//   copy_legacy  client_id         staff only. Copies the client's old
//                                  client-uploads objects into Drive and
//                                  leaves the originals where they are.
// GET ?t=<token>                   streams the file (the link from `link`).
//
// Secrets: GOOGLE_SERVICE_ACCOUNT_JSON, GOOGLE_DRIVE_SHARED_DRIVE_ID. Until
// both are set, Drive actions answer 503 {error: "drive_not_connected"} and
// the portal keeps using Supabase Storage (components/files/DriveFiles.js).

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const FN_URL = `${SUPABASE_URL}/functions/v1/drive-files`;
const DRIVE = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const LEGACY_BUCKET = "client-uploads";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
const NOT_CONNECTED = () =>
  json({ error: "drive_not_connected", message: "Drive isn't connected yet. Tell the owner to finish the Google Drive setup." }, 503);

class HttpError extends Error {
  constructor(public status: number, message: string, public code = "error") {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Google auth
// ---------------------------------------------------------------------------
function secretsPresent(): boolean {
  return !!(Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON") && Deno.env.get("GOOGLE_DRIVE_SHARED_DRIVE_ID"));
}
function sharedDriveId(): string {
  return (Deno.env.get("GOOGLE_DRIVE_SHARED_DRIVE_ID") || "").trim();
}

let cachedToken: { token: string; exp: number } | null = null;
let lastOkWrite = 0;

async function noteAuth(admin: SupabaseClient, ok: boolean, detail?: string) {
  const now = Date.now();
  if (ok && now - lastOkWrite < 10 * 60 * 1000) return;
  if (ok) lastOkWrite = now;
  await admin
    .from("drive_status")
    .update(ok ? { last_auth_ok_at: new Date().toISOString() } : { last_auth_error_at: new Date().toISOString(), last_auth_error: (detail || "").slice(0, 300) })
    .eq("id", 1);
}

async function accessToken(admin: SupabaseClient): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.exp - 60 > nowSec) return cachedToken.token;
  let sa: ServiceAccount;
  try {
    sa = parseServiceAccount(Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON") || "");
  } catch (e) {
    await noteAuth(admin, false, (e as Error).message);
    throw new HttpError(503, (e as Error).message, "drive_auth_failed");
  }
  let assertion: string;
  try {
    assertion = await signServiceAccountJwt(sa, nowSec);
  } catch (_e) {
    const msg = "The service account's private_key couldn't be read.";
    await noteAuth(admin, false, msg);
    throw new HttpError(503, msg, "drive_auth_failed");
  }
  const res = await fetch(sa.token_uri || TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    const msg = `Google refused the service account (${res.status} ${body.error || ""} ${body.error_description || ""})`.trim();
    await noteAuth(admin, false, msg);
    throw new HttpError(503, msg, "drive_auth_failed");
  }
  cachedToken = { token: body.access_token, exp: nowSec + Number(body.expires_in || 3600) };
  await noteAuth(admin, true);
  return cachedToken.token;
}

async function drive(admin: SupabaseClient, url: string, init: RequestInit = {}): Promise<Response> {
  const token = await accessToken(admin);
  const headers = new Headers(init.headers || {});
  headers.set("Authorization", `Bearer ${token}`);
  return fetch(url, { ...init, headers });
}

async function driveJson(admin: SupabaseClient, url: string, init: RequestInit = {}): Promise<any> {
  const res = await drive(admin, url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body?.error?.message || res.statusText;
    throw new HttpError(res.status === 404 ? 404 : 502, `Google Drive: ${msg}`, res.status === 404 ? "drive_not_found" : "drive_error");
  }
  return body;
}

function qs(params: Record<string, string>) {
  return new URLSearchParams({ supportsAllDrives: "true", ...params }).toString();
}

// ---------------------------------------------------------------------------
// Folders: <Client name> / <Year> / <Document type>, cached in drive_folders
// ---------------------------------------------------------------------------
type FolderRow = { id: number; client_id: string; year: number | null; doc_type: string | null; name: string; drive_folder_id: string };

async function cachedFolder(admin: SupabaseClient, clientId: string, year: number | null, docType: string | null): Promise<FolderRow | null> {
  let q = admin.from("drive_folders").select("*").eq("client_id", clientId);
  q = year === null ? q.is("year", null) : q.eq("year", year);
  q = docType === null ? q.is("doc_type", null) : q.ilike("doc_type", docType);
  const { data } = await q.limit(1);
  return (data && data[0]) || null;
}

async function findFolder(admin: SupabaseClient, q: string): Promise<{ id: string; name: string } | null> {
  const url = `${DRIVE}/files?` +
    qs({
      q: `${q} and mimeType='${FOLDER_MIME}' and trashed=false`,
      corpora: "drive",
      driveId: sharedDriveId(),
      includeItemsFromAllDrives: "true",
      fields: "files(id,name)",
      pageSize: "10",
    });
  const body = await driveJson(admin, url);
  return (body.files && body.files[0]) || null;
}

async function createFolder(admin: SupabaseClient, name: string, parent: string, appProperties: Record<string, string>, description?: string) {
  return driveJson(admin, `${DRIVE}/files?` + qs({ fields: "id,name" }), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parent], appProperties, description }),
  });
}

/** Caches a folder id; if another upload cached the same folder first, keeps
 *  theirs and moves ours to Drive trash (never deleted). */
async function remember(admin: SupabaseClient, row: Omit<FolderRow, "id">, createdNow: boolean, fresh = false): Promise<string> {
  if (fresh) {
    // Re-resolved after a cached folder went missing: point the cache row at
    // the folder that exists now.
    const old = await cachedFolder(admin, row.client_id, row.year, row.doc_type);
    if (old) {
      await admin.from("drive_folders").update({ name: row.name, drive_folder_id: row.drive_folder_id }).eq("id", old.id);
      return row.drive_folder_id;
    }
  }
  const { error } = await admin.from("drive_folders").insert(row);
  if (!error) return row.drive_folder_id;
  const existing = await cachedFolder(admin, row.client_id, row.year, row.doc_type);
  if (!existing) throw new HttpError(500, `Couldn't save the folder: ${error.message}`);
  if (createdNow && existing.drive_folder_id !== row.drive_folder_id) {
    await drive(admin, `${DRIVE}/files/${row.drive_folder_id}?` + qs({}), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trashed: true }),
    }).catch(() => {});
  }
  return existing.drive_folder_id;
}

async function clientFolder(admin: SupabaseClient, clientId: string, clientName: string, fresh = false): Promise<string> {
  const want = clientFolderName(clientName, clientId);
  const hit = fresh ? null : await cachedFolder(admin, clientId, null, null);
  if (hit) {
    // Client renamed in the portal: rename the Drive folder to match. The
    // stable id lives in appProperties, so this never makes a duplicate.
    if (hit.name !== want) {
      await driveJson(admin, `${DRIVE}/files/${hit.drive_folder_id}?` + qs({ fields: "id" }), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: want }),
      });
      await admin.from("drive_folders").update({ name: want }).eq("id", hit.id);
    }
    return hit.drive_folder_id;
  }
  const root = sharedDriveId();
  let found = await findFolder(
    admin,
    `'${driveQ(root)}' in parents and appProperties has { key='mgbClientId' and value='${driveQ(clientId)}' }`,
  );
  let created = false;
  if (!found) {
    found = await createFolder(admin, want, root, { mgbClientId: clientId, mgbLevel: "client" }, `MyGoodBooks client id: ${clientId}`);
    created = true;
  } else if (found.name !== want) {
    await driveJson(admin, `${DRIVE}/files/${found.id}?` + qs({ fields: "id" }), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: want }),
    });
  }
  return remember(admin, { client_id: clientId, year: null, doc_type: null, name: want, drive_folder_id: found!.id }, created, fresh);
}

async function childFolder(
  admin: SupabaseClient,
  clientId: string,
  parent: string,
  name: string,
  year: number,
  docType: string | null,
  fresh = false,
): Promise<string> {
  const hit = fresh ? null : await cachedFolder(admin, clientId, year, docType);
  if (hit) return hit.drive_folder_id;
  let found = await findFolder(admin, `'${driveQ(parent)}' in parents and name='${driveQ(name)}'`);
  let created = false;
  if (!found) {
    const props: Record<string, string> = { mgbClientId: clientId, mgbLevel: docType ? "doc_type" : "year", mgbYear: String(year) };
    if (docType) props.mgbDocType = docType;
    found = await createFolder(admin, name, parent, props);
    created = true;
  }
  return remember(admin, { client_id: clientId, year, doc_type: docType, name, drive_folder_id: found!.id }, created, fresh);
}

async function folderFor(admin: SupabaseClient, clientId: string, clientName: string, year: number, docType: string, fresh = false) {
  const top = await clientFolder(admin, clientId, clientName, fresh);
  const y = await childFolder(admin, clientId, top, String(year), year, null, fresh);
  return childFolder(admin, clientId, y, docType, year, docType, fresh);
}

// ---------------------------------------------------------------------------
// Upload: resumable session, then one PUT of the bytes (<= 25 MB)
// ---------------------------------------------------------------------------
async function driveUpload(
  admin: SupabaseClient,
  bytes: Uint8Array,
  meta: { name: string; mime: string; parent: string; clientId: string; description?: string },
) {
  const init = await drive(admin, `${DRIVE_UPLOAD}/files?` + qs({ uploadType: "resumable", fields: "id,name,mimeType,size,webViewLink" }), {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": meta.mime,
      "X-Upload-Content-Length": String(bytes.byteLength),
    },
    body: JSON.stringify({
      name: meta.name,
      mimeType: meta.mime,
      parents: [meta.parent],
      appProperties: { mgbClientId: meta.clientId },
      description: meta.description,
    }),
  });
  if (!init.ok) {
    const b = await init.json().catch(() => ({}));
    throw new HttpError(init.status === 404 ? 404 : 502, `Google Drive: ${b?.error?.message || init.statusText}`, init.status === 404 ? "drive_not_found" : "drive_error");
  }
  const session = init.headers.get("Location");
  if (!session) throw new HttpError(502, "Google Drive didn't start the upload.");
  const put = await fetch(session, {
    method: "PUT",
    headers: { "Content-Type": meta.mime, "Content-Length": String(bytes.byteLength) },
    body: bytes,
  });
  const body = await put.json().catch(() => ({}));
  if (!put.ok || !body.id) throw new HttpError(502, `Google Drive upload failed: ${body?.error?.message || put.statusText}`);
  return body as { id: string; name: string; mimeType: string; size?: string; webViewLink?: string };
}

async function uploadIntoFolders(
  admin: SupabaseClient,
  bytes: Uint8Array,
  meta: { name: string; mime: string; clientId: string; clientName: string; year: number; docType: string; description?: string },
) {
  let parent = await folderFor(admin, meta.clientId, meta.clientName, meta.year, meta.docType);
  try {
    return { parent, file: await driveUpload(admin, bytes, { ...meta, parent }) };
  } catch (e) {
    // Someone moved or trashed a cached folder in Drive: rebuild once.
    if (!(e instanceof HttpError) || e.code !== "drive_not_found") throw e;
    parent = await folderFor(admin, meta.clientId, meta.clientName, meta.year, meta.docType, true);
    return { parent, file: await driveUpload(admin, bytes, { ...meta, parent }) };
  }
}

async function trashDriveFile(admin: SupabaseClient, driveFileId: string, trashed: boolean) {
  await driveJson(admin, `${DRIVE}/files/${driveFileId}?` + qs({ fields: "id,trashed" }), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ trashed }),
  });
}

// ---------------------------------------------------------------------------
// Caller + permissions (mirrors the old client-uploads bucket policies)
// ---------------------------------------------------------------------------
type Caller = { email: string; asUser: SupabaseClient };

async function caller(req: Request): Promise<Caller> {
  const auth = req.headers.get("Authorization") || "";
  if (!/^Bearer\s+\S+/i.test(auth)) throw new HttpError(401, "Sign in again.", "unauthorized");
  const asUser = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } } });
  const { data, error } = await asUser.auth.getUser();
  const email = data?.user?.email;
  if (error || !email) throw new HttpError(401, "Sign in again.", "unauthorized");
  return { email: email.toLowerCase(), asUser };
}

async function rpcTrue(c: Caller, fn: string, args?: Record<string, unknown>) {
  const { data, error } = await c.asUser.rpc(fn, args);
  return !error && data === true;
}
async function isStaffFor(c: Caller, clientId: string) {
  return (await rpcTrue(c, "is_active_staff")) && (await rpcTrue(c, "can_access_client", { p_client_id: clientId }));
}
async function isMemberOf(c: Caller, clientId: string) {
  return rpcTrue(c, "is_client_member", { p_client_id: clientId });
}

async function logEvent(admin: SupabaseClient, action: string, ok: boolean, clientId: string | null, actor: string | null, detail?: string) {
  await admin.from("drive_file_events").insert({ action, ok, client_id: clientId, actor, detail: detail ? detail.slice(0, 500) : null });
}

const webViewLink = (driveFileId: string) => `https://drive.google.com/file/d/${encodeURIComponent(driveFileId)}/view`;

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
async function doUpload(req: Request, admin: SupabaseClient) {
  const c = await caller(req);
  const len = Number(req.headers.get("Content-Length") || 0);
  if (len && len > MAX_BYTES + 64 * 1024) throw new HttpError(413, "Files are capped at 25 MB.", "too_big");
  let form: FormData;
  try {
    form = await req.formData();
  } catch (_e) {
    throw new HttpError(400, "Send the file as multipart/form-data.");
  }
  const file = form.get("file");
  const clientId = String(form.get("client_id") || "");
  let visibility = String(form.get("visibility") || "shared");
  if (!(file instanceof File)) throw new HttpError(400, "No file was sent.");
  if (!clientId) throw new HttpError(400, "client_id is required.");
  if (!["shared", "internal", "request", "message"].includes(visibility)) throw new HttpError(400, "Unknown visibility.");
  if (file.size > MAX_BYTES) throw new HttpError(413, "Files are capped at 25 MB.", "too_big");
  const mime = typeOf(file.name, file.type);
  if (!mime) throw new HttpError(415, "PDF, PNG, JPEG, HEIC, CSV, Excel, Word and text files only.", "bad_type");

  const staff = await isStaffFor(c, clientId);
  const member = !staff && (await isMemberOf(c, clientId));
  if (!staff && !member) throw new HttpError(403, "You can't add files for this client.", "forbidden");
  if (visibility === "internal" && !staff) throw new HttpError(403, "Only MyGoodBooks staff can add staff-only files.", "forbidden");

  const { data: client } = await admin.from("clients").select("id, name").eq("id", clientId).maybeSingle();
  if (!client) throw new HttpError(404, "Client not found.");

  let docType = normalizeDocType(String(form.get("doc_type") || ""));
  let year = cleanYear(form.get("year"), currentYear());
  let requestId: string | null = null;
  let participant: string | null = null;

  if (visibility === "request") {
    requestId = String(form.get("request_id") || "");
    if (!UUID_RE.test(requestId)) throw new HttpError(400, "request_id is required.");
    const { data: r } = await admin.from("client_doc_requests").select("id, client_id, title, status").eq("id", requestId).maybeSingle();
    if (!r || r.client_id !== clientId) throw new HttpError(404, "That request wasn't found.");
    if (!["open", "uploaded"].includes(r.status)) throw new HttpError(409, "That request is already closed.");
    docType = docTypeFor(r.title);
    year = form.get("year") ? year : yearForRequest(r.title);
  } else if (visibility === "message") {
    participant = String(form.get("participant") || "").trim().toLowerCase();
    if (!participant) throw new HttpError(400, "participant is required.");
    if (!staff && participant !== c.email) throw new HttpError(403, "You can only attach files to your own conversation.", "forbidden");
    docType = "Messages";
    // A staff internal note: client users never see the file.
    if (staff && String(form.get("internal") || "") === "true") visibility = "internal";
  }

  if (!secretsPresent()) return NOT_CONNECTED();

  const bytes = new Uint8Array(await file.arrayBuffer());
  let uploaded;
  try {
    uploaded = await uploadIntoFolders(admin, bytes, {
      name: file.name.slice(0, 255),
      mime,
      clientId,
      clientName: client.name,
      year,
      docType,
      description: `Uploaded through the MyGoodBooks portal by ${c.email}`,
    });
  } catch (e) {
    await logEvent(admin, "upload", false, clientId, c.email, (e as Error).message);
    throw e;
  }

  const { data: row, error } = await admin
    .from("client_files")
    .insert({
      client_id: clientId,
      drive_file_id: uploaded.file.id,
      drive_folder_id: uploaded.parent,
      name: file.name.slice(0, 255),
      mime,
      size: bytes.byteLength,
      year,
      doc_type: docType,
      visibility,
      participant_email: participant,
      request_id: requestId,
      uploaded_by: c.email,
    })
    .select("*")
    .single();
  if (error || !row) {
    // Don't leave an orphan the portal can't see: move it to Drive trash.
    await trashDriveFile(admin, uploaded.file.id, true).catch(() => {});
    await logEvent(admin, "upload", false, clientId, c.email, `saved to Drive but not recorded: ${error?.message}`);
    throw new HttpError(500, "The file reached Drive but couldn't be recorded. Try again.");
  }
  await logEvent(admin, "upload", true, clientId, c.email);

  let path: string | null = null;
  if (requestId) {
    path = `${clientId}/${requestId}/drive:${row.id}`;
    const { error: fErr } = await c.asUser.rpc("fulfill_doc_request", { p_id: requestId, p_path: path, p_name: file.name });
    if (fErr) throw new HttpError(500, `Uploaded, but the request couldn't be marked: ${fErr.message}`);
  } else if (row.visibility === "message" || participant) {
    path = `${clientId}/messages/${participant}/drive:${row.id}`;
  }
  return json({ file: shape(row, staff), path });
}

function shape(r: any, staff: boolean) {
  const out: any = {
    id: r.id,
    client_id: r.client_id,
    name: r.name,
    mime: r.mime,
    size: r.size,
    year: r.year,
    doc_type: r.doc_type,
    visibility: r.visibility,
    request_id: r.request_id,
    message_id: r.message_id,
    uploaded_by: r.uploaded_by,
    uploaded_at: r.uploaded_at,
    trashed_at: r.trashed_at,
  };
  if (staff) {
    out.web_view_link = webViewLink(r.drive_file_id);
    out.legacy_path = r.legacy_path;
    out.trashed_by = r.trashed_by;
  }
  return out;
}

async function doList(req: Request, body: any) {
  const c = await caller(req);
  const clientId = String(body.client_id || "");
  if (!clientId) throw new HttpError(400, "client_id is required.");
  const staff = await isStaffFor(c, clientId);
  // RLS on client_files is the real gate: the caller's own JWT only sees the
  // rows the old bucket policies would have let them see.
  let q = c.asUser.from("client_files").select("*").eq("client_id", clientId).order("uploaded_at", { ascending: false }).limit(500);
  const scope = String(body.scope || "documents");
  if (scope === "documents") q = q.in("visibility", ["shared", "internal"]).is("trashed_at", null);
  else if (scope === "trash") {
    if (!staff) return json({ files: [] });
    q = q.in("visibility", ["shared", "internal"]).not("trashed_at", "is", null);
  } else if (scope === "request") {
    if (!UUID_RE.test(String(body.request_id || ""))) throw new HttpError(400, "request_id is required.");
    q = q.eq("request_id", body.request_id);
  } else throw new HttpError(400, "Unknown scope.");
  const { data, error } = await q;
  if (error) throw new HttpError(500, error.message);
  // Old Storage objects already copied into Drive, so the page can hide the
  // originals (which stay where they are).
  let copied: string[] = [];
  if (staff) {
    const { data: lp } = await c.asUser.from("client_files").select("legacy_path").eq("client_id", clientId).not("legacy_path", "is", null).limit(1000);
    copied = (lp || []).map((r: any) => r.legacy_path);
  }
  return json({ files: (data || []).map((r: any) => shape(r, staff)), copied_legacy_paths: copied, connected: secretsPresent(), staff });
}

async function doLink(req: Request, body: any) {
  const c = await caller(req);
  const ids = (Array.isArray(body.ids) ? body.ids : [body.id]).map(String).filter((s: string) => UUID_RE.test(s)).slice(0, 100);
  if (!ids.length) return json({ links: {} });
  // Same rule as listing: if the caller's RLS lets them see the row, they may
  // download it.
  const { data, error } = await c.asUser.from("client_files").select("id").in("id", ids);
  if (error) throw new HttpError(500, error.message);
  const nowSec = Math.floor(Date.now() / 1000);
  const links: Record<string, string> = {};
  for (const r of data || []) links[r.id] = `${FN_URL}?t=${await makeLinkToken(r.id, SERVICE_ROLE_KEY, nowSec)}`;
  return json({ links, expires_in: 600 });
}

async function doGet(url: URL, admin: SupabaseClient) {
  const id = await verifyLinkToken(url.searchParams.get("t") || "", SERVICE_ROLE_KEY, Math.floor(Date.now() / 1000));
  if (!id) return new Response("This link has expired. Go back to the portal and open the file again.", { status: 403, headers: { ...CORS, "Content-Type": "text/plain; charset=utf-8" } });
  if (!secretsPresent()) return NOT_CONNECTED();
  const { data: row } = await admin.from("client_files").select("drive_file_id, name, mime, client_id").eq("id", id).maybeSingle();
  if (!row) return new Response("File not found.", { status: 404, headers: CORS });
  const res = await drive(admin, `${DRIVE}/files/${row.drive_file_id}?` + qs({ alt: "media" }));
  if (!res.ok || !res.body) {
    await logEvent(admin, "download", false, row.client_id, null, `${res.status} ${res.statusText}`);
    return new Response("Couldn't fetch that file from Google Drive. Try again in a moment.", { status: 502, headers: { ...CORS, "Content-Type": "text/plain; charset=utf-8" } });
  }
  const mime = row.mime || "application/octet-stream";
  const headers: Record<string, string> = {
    ...CORS,
    "Content-Type": mime,
    "Content-Disposition": contentDisposition(row.name, row.mime),
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
    "Referrer-Policy": "no-referrer",
  };
  const len = res.headers.get("Content-Length");
  if (len) headers["Content-Length"] = len;
  return new Response(res.body, { status: 200, headers });
}

async function doTrash(req: Request, body: any, admin: SupabaseClient, trashed: boolean) {
  const c = await caller(req);
  const id = String(body.id || "");
  if (!UUID_RE.test(id)) throw new HttpError(400, "id is required.");
  const { data: row } = await admin.from("client_files").select("*").eq("id", id).maybeSingle();
  if (!row) throw new HttpError(404, "File not found.");
  if (!(await isStaffFor(c, row.client_id))) throw new HttpError(403, "Only MyGoodBooks staff can move files to Trash.", "forbidden");
  if (!secretsPresent()) return NOT_CONNECTED();
  try {
    await trashDriveFile(admin, row.drive_file_id, trashed);
  } catch (e) {
    await logEvent(admin, trashed ? "trash" : "restore", false, row.client_id, c.email, (e as Error).message);
    if (!trashed && e instanceof HttpError && e.code === "drive_not_found") {
      throw new HttpError(410, "Google Drive has already emptied this file from its trash (after 30 days), so it can't be restored.", "gone");
    }
    throw e;
  }
  const { error } = await admin
    .from("client_files")
    .update(trashed ? { trashed_at: new Date().toISOString(), trashed_by: c.email } : { trashed_at: null, trashed_by: null })
    .eq("id", id);
  if (error) throw new HttpError(500, error.message);
  await logEvent(admin, trashed ? "trash" : "restore", true, row.client_id, c.email);
  return json({ ok: true });
}

// One-off: copy a client's old client-uploads objects into Drive. Originals
// stay in Supabase Storage untouched; trash/ is skipped.
async function doCopyLegacy(req: Request, body: any, admin: SupabaseClient) {
  const c = await caller(req);
  const clientId = String(body.client_id || "");
  if (!clientId) throw new HttpError(400, "client_id is required.");
  if (!(await isStaffFor(c, clientId))) throw new HttpError(403, "Staff only.", "forbidden");
  if (!secretsPresent()) return NOT_CONNECTED();
  const { data: client } = await admin.from("clients").select("id, name").eq("id", clientId).maybeSingle();
  if (!client) throw new HttpError(404, "Client not found.");
  const store = admin.storage.from(LEGACY_BUCKET);

  const paths: string[] = [];
  const walk = async (prefix: string, depth: number) => {
    const { data } = await store.list(prefix, { limit: 1000 });
    for (const o of data || []) {
      const p = `${prefix}/${o.name}`;
      if (!o.id) {
        if (depth === 0 && o.name === "trash") continue;
        if (depth < 2) await walk(p, depth + 1);
      } else paths.push(p);
    }
  };
  await walk(clientId, 0);

  const { data: done } = await admin.from("client_files").select("legacy_path").eq("client_id", clientId).not("legacy_path", "is", null);
  const already = new Set((done || []).map((r: any) => r.legacy_path));
  const todo = paths.filter((p) => !already.has(p)).slice(0, 50);

  const { data: reqs } = await admin.from("client_doc_requests").select("id, title, file_path").eq("client_id", clientId);
  const reqById = new Map((reqs || []).map((r: any) => [r.id, r]));

  let copied = 0;
  const errors: string[] = [];
  for (const p of todo) {
    const seg = p.split("/");
    const fileName = seg[seg.length - 1].replace(/^\d+-/, "");
    let visibility = "shared";
    let docType = "Other";
    let year = currentYear();
    let requestId: string | null = null;
    let participant: string | null = null;
    if (seg[1] === "internal") visibility = "internal";
    else if (seg[1] === "messages") {
      visibility = "message";
      participant = (seg[2] || "").toLowerCase();
      docType = "Messages";
    } else if (UUID_RE.test(seg[1] || "")) {
      visibility = "request";
      const r: any = reqById.get(seg[1]);
      if (r) {
        requestId = r.id;
        docType = docTypeFor(r.title);
        year = yearForRequest(r.title);
      }
    }
    try {
      const { data: blob, error } = await store.download(p);
      if (error || !blob) throw new Error(error?.message || "couldn't read the original");
      const mime = typeOf(fileName, blob.type) || "application/octet-stream";
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const up = await uploadIntoFolders(admin, bytes, {
        name: fileName,
        mime,
        clientId,
        clientName: client.name,
        year,
        docType,
        description: `Copied from the portal's old storage (${p})`,
      });
      const { error: insErr } = await admin.from("client_files").insert({
        client_id: clientId,
        drive_file_id: up.file.id,
        drive_folder_id: up.parent,
        name: fileName.slice(0, 255),
        mime,
        size: bytes.byteLength,
        year,
        doc_type: docType,
        visibility,
        participant_email: participant,
        request_id: requestId,
        legacy_path: p,
        uploaded_by: c.email,
      });
      if (insErr) {
        await trashDriveFile(admin, up.file.id, true).catch(() => {});
        throw new Error(insErr.message);
      }
      copied++;
    } catch (e) {
      errors.push(`${p}: ${(e as Error).message}`);
    }
  }
  await logEvent(admin, "copy_legacy", errors.length === 0, clientId, c.email, errors.length ? errors.slice(0, 3).join("; ") : `copied ${copied}`);
  return json({ copied, remaining: paths.filter((p) => !already.has(p)).length - copied, errors });
}

// ---------------------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const url = new URL(req.url);
  try {
    if (req.method === "GET") {
      if (url.searchParams.get("t")) return await doGet(url, admin);
      return json({ error: "not_found" }, 404);
    }
    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

    const ctype = req.headers.get("Content-Type") || "";
    if (ctype.startsWith("multipart/form-data")) {
      if ((url.searchParams.get("action") || "upload") !== "upload") throw new HttpError(400, "Unknown action.");
      return await doUpload(req, admin);
    }
    let body: any = {};
    try {
      body = await req.json();
    } catch (_e) {
      body = {};
    }
    switch (String(body.action || "")) {
      case "status": {
        await caller(req);
        return json({ connected: secretsPresent() });
      }
      case "list":
        return await doList(req, body);
      case "link":
        return await doLink(req, body);
      case "trash":
        return await doTrash(req, body, admin, true);
      case "restore":
        return await doTrash(req, body, admin, false);
      case "copy_legacy":
        return await doCopyLegacy(req, body, admin);
      default:
        return json({ error: "unknown_action" }, 400);
    }
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.code, message: e.message }, e.status);
    console.log(`drive-files: ${(e as Error).message}`);
    return json({ error: "error", message: "Something went wrong with file storage. Try again." }, 500);
  }
});
