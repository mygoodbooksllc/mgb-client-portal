// Pure rules for the master-sheet-sync edge function (docs/master-sheet-sync-spec.md).
// No Deno, network or database calls, so logic.test.js runs it under plain node:
//   node supabase/functions/master-sheet-sync/logic.test.js
// Uses only WebCrypto (globalThis.crypto.subtle), which Deno and node share.

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
// WHICH FEE COLUMN FEEDS THE PORTAL. Owner decision 2026-10-31: the 2027 fee
// for now. Flip to "now" when the owner says so (the nightly run then waits
// for a manual Sync now on the new column before it runs again).
export const FEE_COLUMN = "2027";

export const FEE_HEADERS = { now: "Bookkeeping fee now", 2027: "Bookkeeping fee 2027" };
export const SHEET_ID = "1y6Tw4GDZWxpD20UfHKVLUvuej1q2abUQ1FaZRYfrPR8";
export const SHEET_TAB = "Clients";
export const HEADER_ROW = 4; // data starts on the next row
export const SHEET_RANGE = `${SHEET_TAB}!A${HEADER_ROW}:Z1000`;
export const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`;
export const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
export const TOKEN_URL = "https://oauth2.googleapis.com/token";

export const MIN_DATA_ROWS = 5; // fewer = the read went wrong; write nothing
export const MAX_FEE = 100000; // a monthly fee above this is a typo
export const CRON_MAX_CHANGES = 10; // a nightly run with more changes is held for a person
export const CRON_MAX_SWING = 0.5; // ... or with any fee moving more than 50%
export const UPDATED_BY = "master-sheet-sync";

// ---------------------------------------------------------------------------
// Names, money, status
// ---------------------------------------------------------------------------
/** Lower case, every character that isn't a-z or 0-9 dropped. Must stay the
 *  same as SQL public.master_sheet_norm() (map and review-list keys). */
export function normName(s) {
  return String(s == null ? "" : s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/**
 * A usable monthly fee from a sheet cell (a number, or money text like
 * "$3,000.00"), rounded to cents. Anything else gives fee null and a reason,
 * and the caller must leave the portal fee alone: blank, text, formula errors,
 * negatives, zero and amounts over MAX_FEE never clear or change a fee.
 */
export function parseFee(v) {
  if (v == null) return { fee: null, reason: "fee is blank" };
  let n;
  if (typeof v === "number") {
    n = v;
  } else {
    const s = String(v).trim();
    if (!s) return { fee: null, reason: "fee is blank" };
    if (/^\(.*\)$/.test(s) || /^-|^\$\s*-|-$/.test(s)) return { fee: null, reason: `fee isn't a positive amount (${s})` };
    const cleaned = s.replace(/^\$\s*/, "").replace(/,/g, "").replace(/\s+/g, "");
    if (!/^\d+(\.\d+)?$/.test(cleaned)) return { fee: null, reason: `fee isn't a number (${s.slice(0, 40)})` };
    n = Number(cleaned);
  }
  if (!isFinite(n)) return { fee: null, reason: "fee isn't a number" };
  if (n < 0) return { fee: null, reason: "fee isn't a positive amount" };
  if (n === 0) return { fee: null, reason: "fee is $0 (left alone)" };
  if (n > MAX_FEE) return { fee: null, reason: `fee over $${MAX_FEE.toLocaleString("en-US")} looks like a typo` };
  return { fee: Math.round(n * 100) / 100, reason: null };
}

/** "active" | "lost" | "paused" | "gone" | "blank" | "other" */
export function normStatus(s) {
  const v = String(s == null ? "" : s).trim().toLowerCase();
  if (!v) return "blank";
  if (v === "active" || v === "lost" || v === "paused" || v === "gone") return v;
  return "other";
}

const headerKey = (h) => String(h == null ? "" : h).trim().replace(/\s+/g, " ").toLowerCase();

/**
 * Column indexes from the header row, by exact header text (trimmed, any case).
 * Throws a plain message when a header is missing or appears twice; the run
 * then changes nothing.
 */
export function findColumns(headerRow, feeColumn = FEE_COLUMN) {
  const feeHeader = FEE_HEADERS[feeColumn];
  if (!feeHeader) throw new Error(`Unknown fee column setting "${feeColumn}".`);
  const want = { client: "Client", status: "Status", fee: feeHeader };
  const keys = (headerRow || []).map(headerKey);
  const out = {};
  for (const [k, label] of Object.entries(want)) {
    const hits = [];
    keys.forEach((h, i) => {
      if (h === headerKey(label)) hits.push(i);
    });
    if (hits.length === 0) throw new Error(`Couldn't find the "${label}" column in row ${HEADER_ROW} of the ${SHEET_TAB} tab.`);
    if (hits.length > 1) throw new Error(`"${label}" appears ${hits.length} times in row ${HEADER_ROW} of the ${SHEET_TAB} tab.`);
    out[k] = hits[0];
  }
  return { ...out, feeHeader };
}

/** Sheet values (header row first) -> data rows with a non-blank client name. */
export function readRows(values, feeColumn = FEE_COLUMN) {
  const all = Array.isArray(values) ? values : [];
  const cols = findColumns(all[0] || [], feeColumn);
  const rows = [];
  for (let i = 1; i < all.length; i++) {
    const r = all[i] || [];
    const name = String(r[cols.client] == null ? "" : r[cols.client]).trim();
    const key = normName(name);
    if (!name || !key) continue;
    const feeRaw = r[cols.fee];
    const pf = parseFee(feeRaw);
    rows.push({
      rowNumber: HEADER_ROW + i,
      name,
      key,
      statusRaw: String(r[cols.status] == null ? "" : r[cols.status]).trim(),
      status: normStatus(r[cols.status]),
      feeRaw: feeRaw == null ? "" : String(feeRaw),
      fee: pf.fee,
      feeReason: pf.reason,
    });
  }
  return { rows, cols };
}

const cents = (v) => (v == null || v === "" || !isFinite(Number(v)) ? null : Math.round(Number(v) * 100));
const statusLabel = (r) => r.statusRaw || "blank";

/**
 * The whole plan for one run. Nothing here writes.
 *   values  sheet values from SHEET_RANGE (header row first)
 *   clients [{id, name, test_only, is_internal}]
 *   fees    [{client_id, monthly_fee, sheet_override}]
 *   map     [{sheet_key, sheet_name, client_id, ignored}]
 * Returns {error} or {rowsRead, items, changes, unchanged, unmatched, skipped,
 * errors, counts}. items = what master_sheet_apply() gets: every matched
 * Active row with a usable fee ({client_id, from, to, change}).
 */
export function planSync({ values, clients, fees, map, feeColumn = FEE_COLUMN }) {
  let read;
  try {
    read = readRows(values, feeColumn);
  } catch (e) {
    return { error: e.message };
  }
  const { rows } = read;
  if (rows.length < MIN_DATA_ROWS) {
    return { error: `Only ${rows.length} client row(s) came back from the sheet (expected at least ${MIN_DATA_ROWS}). Nothing was changed.` };
  }

  const byId = new Map();
  const byKey = new Map();
  for (const c of clients || []) {
    byId.set(c.id, c);
    const k = normName(c.name);
    if (!k) continue;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(c);
  }
  const feeBy = new Map((fees || []).map((f) => [f.client_id, f]));
  const mapBy = new Map((map || []).map((m) => [m.sheet_key || normName(m.sheet_name), m]));

  const skipped = [];
  const unmatched = [];
  const errors = [];
  const claims = new Map(); // client_id -> [row]

  for (const r of rows) {
    const base = { row: r.rowNumber, sheet_name: r.name, status: statusLabel(r) };
    let client = null;
    const m = mapBy.get(r.key);
    if (m) {
      if (m.ignored) {
        skipped.push({ ...base, reason: "marked not a client" });
        continue;
      }
      client = byId.get(m.client_id) || null;
      if (!client) {
        errors.push({ ...base, reason: `matched by hand to a client that no longer exists (${m.client_id})` });
        continue;
      }
    } else {
      const cands = byKey.get(r.key) || [];
      if (cands.length !== 1) {
        if (r.status === "lost" || r.status === "gone" || r.status === "paused") {
          skipped.push({ ...base, reason: `${statusLabel(r)}, no portal client` });
        } else {
          unmatched.push({
            ...base,
            fee: r.fee,
            fee_text: r.feeRaw,
            reason: cands.length ? `${cands.length} portal clients share this name` : "no portal client with this name",
          });
        }
        continue;
      }
      client = cands[0];
    }
    const at = { ...base, client_id: client.id, client_name: client.name };
    if (client.test_only) {
      skipped.push({ ...at, reason: "test client" });
      continue;
    }
    if (client.is_internal) {
      skipped.push({ ...at, reason: "internal company" });
      continue;
    }
    if (r.status !== "active") {
      skipped.push({ ...at, reason: `Status ${statusLabel(r)}: fee left alone` });
      continue;
    }
    if (r.fee == null) {
      skipped.push({ ...at, reason: r.feeReason || "no usable fee" });
      continue;
    }
    const cur = feeBy.get(client.id);
    if (cur && cur.sheet_override) {
      skipped.push({ ...at, reason: "override on in the portal" });
      continue;
    }
    if (!claims.has(client.id)) claims.set(client.id, []);
    claims.get(client.id).push({ ...at, fee: r.fee, from: cur ? cents(cur.monthly_fee) : null });
  }

  const items = [];
  const changes = [];
  const unchanged = [];
  for (const [cid, list] of claims) {
    if (list.length > 1) {
      for (const x of list) errors.push({ row: x.row, sheet_name: x.sheet_name, status: x.status, client_id: cid, client_name: x.client_name, reason: `${list.length} sheet rows point at this client; none written` });
      continue;
    }
    const x = list[0];
    const fromC = x.from;
    const toC = Math.round(x.fee * 100);
    const from = fromC == null ? null : fromC / 100;
    const change = fromC !== toC;
    items.push({ client_id: cid, from, to: x.fee, change });
    const rec = { row: x.row, sheet_name: x.sheet_name, client_id: cid, client_name: x.client_name, from, to: x.fee };
    (change ? changes : unchanged).push(rec);
  }
  const byName = (a, b) => String(a.client_name || a.sheet_name).localeCompare(String(b.client_name || b.sheet_name));
  changes.sort(byName);
  unchanged.sort(byName);

  return {
    rowsRead: rows.length,
    items,
    changes,
    unchanged,
    unmatched,
    skipped,
    errors,
    counts: {
      rows_read: rows.length,
      updated: changes.length,
      unchanged: unchanged.length,
      unmatched: unmatched.length,
      skipped: skipped.length,
      errors: errors.length,
    },
  };
}

/** Stable text for the planned fee changes; a live run must match its preview. */
export async function planFingerprint(plan) {
  const s = (plan.changes || [])
    .map((c) => `${c.client_id}:${c.from == null ? "" : c.from.toFixed(2)}:${c.to.toFixed(2)}`)
    .sort()
    .join("|");
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Why a nightly run must wait for a person, or null when it may write. */
export function cronHoldReason(plan) {
  const ch = plan.changes || [];
  if (ch.length > CRON_MAX_CHANGES) return `${ch.length} fee changes is more than the nightly limit of ${CRON_MAX_CHANGES}. Preview and Sync now to apply them.`;
  const big = ch.filter((c) => c.from != null && c.from > 0 && Math.abs(c.to - c.from) / c.from > CRON_MAX_SWING);
  if (big.length) {
    return `${big.map((c) => c.client_name).join(", ")}: fee moves more than ${Math.round(CRON_MAX_SWING * 100)}%. Preview and Sync now to apply.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Google service account (read-only) -> access token
// ---------------------------------------------------------------------------
/** Parses the GOOGLE_SA_KEY secret. Messages never include the secret. */
export function parseServiceAccount(raw) {
  let sa;
  try {
    sa = JSON.parse(String(raw || ""));
  } catch (_e) {
    throw new Error("GOOGLE_SA_KEY isn't valid JSON (paste the whole key file).");
  }
  if (!sa || typeof sa.client_email !== "string" || typeof sa.private_key !== "string") {
    throw new Error("GOOGLE_SA_KEY is missing client_email or private_key.");
  }
  return { client_email: sa.client_email, private_key: sa.private_key };
}

export function jwtClaims(sa, nowSec) {
  return { iss: sa.client_email, scope: SHEETS_SCOPE, aud: TOKEN_URL, iat: nowSec, exp: nowSec + 3600 };
}

function b64url(input) {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function pemToDer(pem) {
  const body = String(pem)
    .replace(/\\n/g, "\n")
    .replace(/-----BEGIN [^-]+-----/, "")
    .replace(/-----END [^-]+-----/, "")
    .replace(/\s+/g, "");
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** header.claims.signature, RS256 with the service account's private key. */
export async function signServiceAccountJwt(sa, nowSec) {
  const input = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(JSON.stringify(jwtClaims(sa, nowSec)))}`;
  const key = await crypto.subtle.importKey("pkcs8", pemToDer(sa.private_key), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(input)));
  return `${input}.${b64url(sig)}`;
}

export function valuesUrl(sheetId = SHEET_ID, range = SHEET_RANGE) {
  return `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE&majorDimension=ROWS`;
}

/** Plain words for a Google error status (never the response body's secrets). */
export function googleErrorMessage(status, saEmail) {
  if (status === 403 || status === 404) {
    return `Google says the service account can't open the sheet. Share MGB_Master_Data with ${saEmail || "the service account email"} as Viewer.`;
  }
  if (status === 400) return "Google refused the request (check the tab is still named Clients).";
  if (status === 401) return "Google refused the service account key. Create a new key and update GOOGLE_SA_KEY.";
  if (status === 429) return "Google says too many requests. Try again in a minute.";
  return `Google returned an error (${status}). Try again later.`;
}
