import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { docTypeFor, yearForRequest } from "../drive-files/logic.ts";
import { HttpError, secretsPresent, trashDriveFile, uploadIntoFolders } from "../_shared/drive.ts";
import { tokenHashParam } from "../_shared/tk_requests.ts";
import {
  chicagoDate,
  clientIp,
  corsHeaders,
  delayFor,
  errorCode,
  ipHash,
  isBadToken,
  LIMITS,
  MAX_BYTES,
  MAX_JSON_BYTES,
  parseAnswer,
  precheck,
  readCapped,
  SECURITY_HEADERS,
  statusFor,
  TOKEN_RE,
  viewPayload,
} from "./logic.ts";

// Tasks p2 S6: the public "answer link" endpoint behind /respond (respond.html
// + respond.js). A client contact with no portal login answers one request.
//
// PUBLIC: deploy with --no-verify-jwt. The only credential is the link token,
// sent in the X-MGB-Token header (never in the URL or body; never logged or
// echoed). The database keeps sha256(token); every RPC here is service-only.
//
// POST ?action=
//   view          -> {view}  the fixed field list (C6), nothing else
//   upload        raw file body, X-MGB-Filename, Content-Type, Content-Length
//                 (<= 25 MB, the drive-files type list). One file per call,
//                 at most 5 per link. Lands in <Client>/<Year>/<Doc type> in
//                 Drive with visibility "request". -> {file_id, files_left}
//   answer        JSON {reply?, file_ids?[]} -> {ok}. Single use.
//   stop_nudges   -> {ok}. Pauses reminders for this request.
//
// Order of checks (M8): method/action/size/type from headers, then the IP and
// global rate limits, then the token, and only then the body.
// Errors: {error: code} with 400 bad_request | reply_required | too_many,
// 404 invalid, 410 expired | revoked | answered_already | cancelled,
// 413 too_large, 415 bad_type, 429 rate_limited, 503 not_connected. Every
// refusal waits until at least MIN_ERROR_MS so a miss looks like a hit.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function rateHit(admin: SupabaseClient, key: string, l: { window: number; max: number }): Promise<boolean> {
  const { data, error } = await admin.rpc("tk_rate_hit", { p_key: key, p_window_s: l.window, p_max: l.max });
  if (error) throw new Error(`rate: ${error.message}`);
  return data === true;
}
async function ratePeek(admin: SupabaseClient, key: string, l: { window: number; max: number }): Promise<boolean> {
  const { data, error } = await admin.rpc("tk_rate_peek", { p_key: key, p_window_s: l.window, p_max: l.max });
  if (error) throw new Error(`rate: ${error.message}`);
  return data === true;
}
async function logEvent(admin: SupabaseClient, tokenId: string | null, requestId: string | null, event: string, ip: string, detail: Record<string, unknown> = {}) {
  await admin.rpc("tk_log_token_event", { p_token_id: tokenId, p_request_id: requestId, p_event: event, p_ip_hash: ip, p_detail: detail });
}

/** A bad or expired token: count it per IP and (invalid only) globally. */
async function badHit(admin: SupabaseClient, ip: string, code: string) {
  await rateHit(admin, `ipbad:${ip}`, LIMITS.ipbad);
  if (code === "invalid" && !(await rateHit(admin, "global", LIMITS.global))) {
    await logEvent(admin, null, null, "rate_limited", ip, { scope: "global" });
  }
}

async function rpcJson(admin: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<any> {
  const { data, error } = await admin.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data || {};
}

Deno.serve(async (req) => {
  const t0 = Date.now();
  const cors = corsHeaders(req.headers.get("Origin"));
  const send = async (status: number, body: unknown) => {
    if (status !== 200) await new Promise((r) => setTimeout(r, delayFor(t0, Date.now())));
    return new Response(JSON.stringify(body), { status, headers: { ...cors, ...SECURITY_HEADERS, "Content-Type": "application/json" } });
  };
  const fail = (code: string, extra: Record<string, unknown> = {}) => send(statusFor(code), { error: code, ...extra });

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...cors, ...SECURITY_HEADERS } });

  const action = new URL(req.url).searchParams.get("action") || "";
  const pre = precheck({
    method: req.method,
    action,
    contentType: req.headers.get("content-type"),
    contentLength: req.headers.get("content-length"),
    filename: req.headers.get("x-mgb-filename"),
  });
  if (pre.error) return fail(pre.error);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  try {
    const ip = await ipHash(clientIp((n) => req.headers.get(n)), chicagoDate());
    if (!(await rateHit(admin, `ip:${ip}`, LIMITS.ip))) {
      await logEvent(admin, null, null, "rate_limited", ip, { scope: "ip" });
      return fail("rate_limited");
    }
    if (!(await ratePeek(admin, `ipbad:${ip}`, LIMITS.ipbad)) || !(await ratePeek(admin, "global", LIMITS.global))) {
      return fail("rate_limited");
    }

    const token = req.headers.get("x-mgb-token") || "";
    if (!TOKEN_RE.test(token)) {
      // Same work as an unknown token: hash it, ask the database, count it.
      const h = await tokenHashParam(token.slice(0, 64) || "x");
      await rpcJson(admin, "tk_token_lookup", { p_hash: h, p_ip_hash: ip }).catch(() => null);
      await badHit(admin, ip, "invalid");
      return fail("invalid");
    }
    const hash = await tokenHashParam(token);

    if (action === "view") {
      const r = await rpcJson(admin, "tk_token_lookup", { p_hash: hash, p_ip_hash: ip });
      const code = errorCode(r.state);
      if (code) {
        if (isBadToken(code)) await badHit(admin, ip, code);
        // A real link that is closed may show the asker's first name (C6).
        return code === "invalid" ? fail(code) : fail(code, { asked_by_first_name: r.view?.asked_by_first_name ?? null });
      }
      if (!(await rateHit(admin, `tokview:${r.token_id}`, LIMITS.tokview))) {
        await logEvent(admin, r.token_id, r.request_id, "rate_limited", ip, { scope: "tokview" });
        return fail("rate_limited");
      }
      return send(200, { view: viewPayload(r.view) });
    }

    if (action === "stop_nudges") {
      const r = await rpcJson(admin, "tk_stop_nudges_by_token", { p_hash: hash, p_ip_hash: ip });
      if (r.ok === true) return send(200, { ok: true });
      const code = errorCode(r.error)!;
      if (isBadToken(code)) await badHit(admin, ip, code);
      return fail(code);
    }

    if (action === "answer") {
      const g = await rpcJson(admin, "tk_token_gate", { p_hash: hash, p_ip_hash: ip });
      const gcode = errorCode(g.state);
      if (gcode) {
        if (isBadToken(gcode)) await badHit(admin, ip, gcode);
        return fail(gcode);
      }
      const raw = await readCapped(req.body, MAX_JSON_BYTES);
      if (!raw) return fail("too_large");
      let parsed: unknown;
      try {
        parsed = JSON.parse(new TextDecoder().decode(raw) || "{}");
      } catch (_e) {
        parsed = null;
      }
      const a = parseAnswer(parsed);
      // A malformed body still costs an attempt: the RPC counts it.
      const r = await rpcJson(admin, "tk_answer_request_by_token", {
        p_hash: hash,
        p_reply: a ? a.reply : "x".repeat(4001),
        p_file_ids: a ? a.fileIds : [],
        p_ip_hash: ip,
      });
      if (r.ok === true) return send(200, { ok: true });
      const code = errorCode(r.error)!;
      if (isBadToken(code)) await badHit(admin, ip, code);
      return fail(code);
    }

    // upload
    const g = await rpcJson(admin, "tk_token_gate", { p_hash: hash, p_ip_hash: ip });
    const gcode = errorCode(g.state);
    if (gcode) {
      if (isBadToken(gcode)) await badHit(admin, ip, gcode);
      return fail(gcode);
    }
    if (!g.needs_upload) return fail("bad_request");
    if (!(Number(g.files_left) > 0)) return fail("too_many");
    if (!secretsPresent()) return fail("not_connected");
    const bytes = await readCapped(req.body, Math.min(MAX_BYTES, pre.length!));
    if (!bytes) return fail("too_large");
    if (bytes.byteLength < 1) return fail("bad_request");

    const year = yearForRequest(g.title);
    const docType = docTypeFor(g.title);
    let up;
    try {
      up = await uploadIntoFolders(admin, bytes, {
        name: pre.name!,
        mime: pre.mime!,
        clientId: g.client_id,
        clientName: g.client_name,
        year,
        docType,
        description: "Uploaded through a MyGoodBooks answer link",
      });
    } catch (e) {
      console.error("tk-request-respond upload", e instanceof HttpError ? e.code : "error", (e as Error).message);
      return fail("server_error");
    }
    const s = await rpcJson(admin, "tk_stage_request_file_by_token", {
      p_hash: hash,
      p_file: {
        drive_file_id: up.file.id,
        drive_folder_id: up.parent,
        name: pre.name,
        mime: pre.mime,
        size: bytes.byteLength,
        year,
        doc_type: docType,
      },
      p_ip_hash: ip,
    }).catch((e) => ({ ok: false, error: "server_error", _e: (e as Error).message }));
    if (s.ok !== true) {
      // Compensate: the file is in Drive but not recorded. Drive trash only.
      await trashDriveFile(admin, up.file.id, true).catch(() => {});
      if (s._e) console.error("tk-request-respond stage", s._e);
      return fail(errorCode(s.error) || "server_error");
    }
    return send(200, { file_id: s.file_id, name: pre.name, files_left: s.files_left });
  } catch (e) {
    // Never log headers or the body: the token lives there.
    console.error("tk-request-respond", action, (e as Error).message);
    return fail("server_error");
  }
});
