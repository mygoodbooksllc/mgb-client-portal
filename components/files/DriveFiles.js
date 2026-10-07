// ----------------------------------------------------------------------------
// Client files in the firm's Google Drive (owner request: "client files to
// pass through supabase as a link and actually store in mgb google drive").
//
// The browser never talks to Google. Every upload, list, download, trash and
// restore goes through the drive-files edge function
// (supabase/functions/drive-files/index.ts), which stores the file in the
// "~ MGB: Client Files (Portal)" Shared Drive under <Client name>/<Year>/<Document type>
// and keeps only a client_files row (metadata + Drive file id) in Supabase.
// Downloads are short-lived links back to that function, so clients never
// need Google access.
//
// Old paths still point at Supabase Storage (client-uploads). A path that
// points at Drive ends in "/drive:<client_files id>", e.g.
//   <client>/<request id>/drive:<uuid>          (document request upload)
//   <client>/messages/<email>/drive:<uuid>      (inbox attachment)
//
// FALLBACK SWITCH: until the owner adds the two Google secrets, the function
// answers "drive_not_connected". With DRV_STORAGE_FALLBACK = true the portal
// then keeps using Supabase Storage exactly as before. Once Drive is live and
// checked, set it to false (or delete the fallback branches at each call site:
// grep DRV_useStorage) and an unconnected Drive shows staff
// DRV_NOT_CONNECTED_MSG instead.
//
// Loaded before StaffInbox.jsx and app.jsx in the shared Babel scope: every
// top-level name has a DRV_ prefix.
// ----------------------------------------------------------------------------

const DRV_STORAGE_FALLBACK = false;

const DRV_FN = "drive-files";
const DRV_NOT_CONNECTED_MSG = "File storage isn't connected yet; tell the owner.";
const DRV_REF_RE = /\/drive:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

// Same list as supabase/functions/drive-files/logic.ts DOC_TYPES ("Messages"
// is set automatically for inbox attachments, so it isn't offered here).
const DRV_DOC_TYPES = [
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
  "Other",
];

/** The client_files id a stored path points at, or null for a Storage path. */
function DRV_driveRef(path) {
  const m = String(path || "").match(DRV_REF_RE);
  return m ? m[1] : null;
}

/** The current year in New York, the default folder year. */
function DRV_currentYear() {
  try {
    return Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric" }).format(new Date()));
  } catch (e) {
    return new Date().getFullYear();
  }
}

async function DRV_token() {
  const sb = window.mgbSupabase;
  const { data } = await sb.auth.getSession();
  const token = data && data.session && data.session.access_token;
  if (!token) throw new Error("Sign in again.");
  return token;
}

async function DRV_fetch(init) {
  const cfg = window.SUPABASE_CONFIG || {};
  const token = await DRV_token();
  const headers = Object.assign({ Authorization: `Bearer ${token}`, apikey: cfg.anonKey || "" }, init.headers || {});
  const res = await fetch(`${cfg.url}/functions/v1/${DRV_FN}`, Object.assign({}, init, { headers }));
  let body = null;
  try {
    body = await res.json();
  } catch (e) {
    body = null;
  }
  if (!res.ok) {
    const err = new Error((body && body.message) || `File storage error (HTTP ${res.status}).`);
    err.code = (body && body.error) || "error";
    err.status = res.status;
    if (err.code === "drive_not_connected") {
      DRV_setConnected(false);
      err.message = DRV_NOT_CONNECTED_MSG;
    }
    throw err;
  }
  return body || {};
}

function DRV_call(body) {
  return DRV_fetch({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

// ---------------------------------------------------------------------------
// Connected? Cached for a minute so a page full of files asks once.
// ---------------------------------------------------------------------------
let DRV_connectedCache = { value: null, at: 0, pending: null };

function DRV_setConnected(v) {
  DRV_connectedCache = { value: !!v, at: Date.now(), pending: null };
}

async function DRV_status() {
  const c = DRV_connectedCache;
  if (c.value !== null && Date.now() - c.at < 60 * 1000) return c.value;
  if (c.pending) return c.pending;
  const p = DRV_call({ action: "status" })
    .then((r) => {
      DRV_setConnected(!!r.connected);
      return !!r.connected;
    })
    .catch(() => {
      // Function unreachable (or not deployed): behave as "not connected".
      DRV_connectedCache.pending = null;
      return false;
    });
  DRV_connectedCache.pending = p;
  return p;
}

/**
 * True when this action should use the old Supabase Storage path: Drive isn't
 * connected and the fallback switch is on. With the switch off and Drive not
 * connected it throws DRV_NOT_CONNECTED_MSG instead.
 */
async function DRV_useStorage() {
  if (await DRV_status()) return false;
  if (DRV_STORAGE_FALLBACK) return true;
  const err = new Error(DRV_NOT_CONNECTED_MSG);
  err.code = "drive_not_connected";
  throw err;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * Upload one file. visibility: "shared" | "internal" | "request" | "message".
 * Returns { file, path }: path is set for request and message uploads (the
 * "/drive:<id>" path to store in the old column).
 */
async function DRV_upload({ file, clientId, visibility, docType, year, requestId, participant, internal }) {
  const fd = new FormData();
  fd.append("file", file, file.name);
  fd.append("client_id", clientId);
  fd.append("visibility", visibility || "shared");
  if (docType) fd.append("doc_type", docType);
  if (year) fd.append("year", String(year));
  if (requestId) fd.append("request_id", requestId);
  if (participant) fd.append("participant", participant);
  if (internal) fd.append("internal", "true");
  return DRV_fetch({ method: "POST", body: fd });
}

/** scope: "documents" | "trash" | "request". */
function DRV_list(clientId, scope, requestId) {
  return DRV_call({ action: "list", client_id: clientId, scope: scope || "documents", request_id: requestId });
}

/** { [client_files id]: download url } for the ids the caller may open. */
async function DRV_links(ids) {
  const list = (ids || []).filter(Boolean);
  if (!list.length) return {};
  const r = await DRV_call({ action: "link", ids: list });
  return r.links || {};
}

async function DRV_link(id) {
  const links = await DRV_links([id]);
  if (!links[id]) throw new Error("That file isn't available.");
  return links[id];
}

/** Staff only: moves the file to Google Drive's trash (never deletes it). */
function DRV_trash(id) {
  return DRV_call({ action: "trash", id });
}

/** Staff only: takes the file back out of Drive's trash. */
function DRV_restore(id) {
  return DRV_call({ action: "restore", id });
}

/** Staff only: copies up to 50 of a client's old Storage files into Drive.
 *  The originals stay where they are. */
function DRV_copyLegacy(clientId) {
  return DRV_call({ action: "copy_legacy", client_id: clientId });
}

window.mgbDrive = {
  FALLBACK: DRV_STORAGE_FALLBACK,
  NOT_CONNECTED_MSG: DRV_NOT_CONNECTED_MSG,
  DOC_TYPES: DRV_DOC_TYPES,
  driveRef: DRV_driveRef,
  status: DRV_status,
  useStorage: DRV_useStorage,
  upload: DRV_upload,
  list: DRV_list,
  links: DRV_links,
  link: DRV_link,
  trash: DRV_trash,
  restore: DRV_restore,
  copyLegacy: DRV_copyLegacy,
};
