import { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  clientFolderName,
  driveQ,
  parseServiceAccount,
  ServiceAccount,
  signServiceAccountJwt,
  TOKEN_URL,
} from "../drive-files/logic.ts";

// Google Drive helpers shared by drive-files (signed-in portal) and
// tk-request-respond (public answer link). Moved out of drive-files/index.ts
// unchanged in Tasks p2 S6. Files land in <Client> / <Year> / <Document type>
// in the "~ MGB: Client Files (Portal)" Shared Drive.

export const DRIVE = "https://www.googleapis.com/drive/v3";
export const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3";
export const FOLDER_MIME = "application/vnd.google-apps.folder";

export class HttpError extends Error {
  constructor(public status: number, message: string, public code = "error") {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Google auth
// ---------------------------------------------------------------------------
export function secretsPresent(): boolean {
  return !!(Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON") && Deno.env.get("GOOGLE_DRIVE_SHARED_DRIVE_ID"));
}
export function sharedDriveId(): string {
  return (Deno.env.get("GOOGLE_DRIVE_SHARED_DRIVE_ID") || "").trim();
}

let cachedToken: { token: string; exp: number } | null = null;
let lastOkWrite = 0;

export async function noteAuth(admin: SupabaseClient, ok: boolean, detail?: string) {
  const now = Date.now();
  if (ok && now - lastOkWrite < 10 * 60 * 1000) return;
  if (ok) lastOkWrite = now;
  await admin
    .from("drive_status")
    .update(ok ? { last_auth_ok_at: new Date().toISOString() } : { last_auth_error_at: new Date().toISOString(), last_auth_error: (detail || "").slice(0, 300) })
    .eq("id", 1);
}

export async function accessToken(admin: SupabaseClient): Promise<string> {
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

export async function drive(admin: SupabaseClient, url: string, init: RequestInit = {}): Promise<Response> {
  const token = await accessToken(admin);
  const headers = new Headers(init.headers || {});
  headers.set("Authorization", `Bearer ${token}`);
  return fetch(url, { ...init, headers });
}

export async function driveJson(admin: SupabaseClient, url: string, init: RequestInit = {}): Promise<any> {
  const res = await drive(admin, url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body?.error?.message || res.statusText;
    throw new HttpError(res.status === 404 ? 404 : 502, `Google Drive: ${msg}`, res.status === 404 ? "drive_not_found" : "drive_error");
  }
  return body;
}

export function qs(params: Record<string, string>) {
  return new URLSearchParams({ supportsAllDrives: "true", ...params }).toString();
}

// ---------------------------------------------------------------------------
// Folders: <Client name> / <Year> / <Document type>, cached in drive_folders
// ---------------------------------------------------------------------------
export type FolderRow = { id: number; client_id: string; year: number | null; doc_type: string | null; name: string; drive_folder_id: string };

export async function cachedFolder(admin: SupabaseClient, clientId: string, year: number | null, docType: string | null): Promise<FolderRow | null> {
  let q = admin.from("drive_folders").select("*").eq("client_id", clientId);
  q = year === null ? q.is("year", null) : q.eq("year", year);
  q = docType === null ? q.is("doc_type", null) : q.ilike("doc_type", docType);
  const { data } = await q.limit(1);
  return (data && data[0]) || null;
}

export async function findFolder(admin: SupabaseClient, q: string): Promise<{ id: string; name: string } | null> {
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

export async function createFolder(admin: SupabaseClient, name: string, parent: string, appProperties: Record<string, string>, description?: string) {
  return driveJson(admin, `${DRIVE}/files?` + qs({ fields: "id,name" }), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parent], appProperties, description }),
  });
}

/** Caches a folder id; if another upload cached the same folder first, keeps
 *  theirs and moves ours to Drive trash (never deleted). */
export async function remember(admin: SupabaseClient, row: Omit<FolderRow, "id">, createdNow: boolean, fresh = false): Promise<string> {
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

export async function clientFolder(admin: SupabaseClient, clientId: string, clientName: string, fresh = false): Promise<string> {
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

export async function childFolder(
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

export async function folderFor(admin: SupabaseClient, clientId: string, clientName: string, year: number, docType: string, fresh = false) {
  const top = await clientFolder(admin, clientId, clientName, fresh);
  const y = await childFolder(admin, clientId, top, String(year), year, null, fresh);
  return childFolder(admin, clientId, y, docType, year, docType, fresh);
}

// ---------------------------------------------------------------------------
// Upload: resumable session, then one PUT of the bytes (<= 25 MB)
// ---------------------------------------------------------------------------
export async function driveUpload(
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

export async function uploadIntoFolders(
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

export async function trashDriveFile(admin: SupabaseClient, driveFileId: string, trashed: boolean) {
  await driveJson(admin, `${DRIVE}/files/${driveFileId}?` + qs({ fields: "id,trashed" }), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ trashed }),
  });
}
