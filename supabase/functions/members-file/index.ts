import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// members-file: serves one file from the private 'members' Storage bucket to
// a signed-in member who is allowed that folder (members step 1, 2026-10-31).
//
// GET /functions/v1/members-file/<path>     or    ?path=<path>
// Authorization: Bearer <the member's Supabase access token>
//
// Order, failing closed at every step:
//   1. Path is checked before anything else (400 on traversal or odd chars).
//   2. The token is resolved with auth.getUser (401 if missing or invalid).
//      The session is only ever read from the Authorization header, never a
//      query string.
//   3. member_access is read THROUGH THE CALLER'S OWN JWT, so RLS returns only
//      their rows. Expired rows are ignored. (403 if the folder rule fails.)
//   4. Only then does the service role read the file from Storage.
// Every response is Cache-Control: private, no-store. Nothing here writes.
// verify_jwt is off (deployed with --no-verify-jwt) like the portal's other
// functions; step 2 does the JWT check itself.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const BUCKET = "members";

type Access = "client" | "course" | "kit";

// Folder rule table: site-integration/Launch Plan.md step 3 item 4 and the
// README "Protect the folders, not just the pages".
const FOLDER_RULES: Record<string, Access[]> = {
  "library": ["client"],
  "course": ["client", "course"],
  "certificate": ["client", "course"],
  "slides": ["client", "course"],
  "sheets": ["client", "course"],
  "launch-kit": ["client", "kit"],
  "app-icons": ["client", "course", "kit"],
};
const ROOT_FILES = new Set([
  "index.html",
  "app.js",
  "sw.js",
  "manifest.webmanifest",
  "offline.json",
]);
const ANY: Access[] = ["client", "course", "kit"];

const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  json: "application/json",
  webmanifest: "application/manifest+json",
  css: "text/css; charset=utf-8",
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  svg: "image/svg+xml",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

const BASE_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Cache-Control": "private, no-store, max-age=0",
  "Vary": "Authorization",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

function fail(status: number, error: string) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { ...BASE_HEADERS, "Content-Type": "application/json" },
  });
}

const SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

// Returns the clean path, or null if it must be rejected.
export function cleanPath(raw: string): string | null {
  let p: string;
  try {
    p = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (p.length === 0 || p.length > 300) return null;
  if (p.startsWith("/")) p = p.slice(1);
  const parts = p.split("/");
  if (parts.length > 8) return null;
  for (const s of parts) {
    if (!SEGMENT.test(s) || s === "." || s === ".." || s.includes("..")) return null;
  }
  return parts.join("/");
}

// Which access kinds open this path. null = not a members path (fail closed).
export function allowedFor(path: string): Access[] | null {
  const parts = path.split("/");
  if (parts.length === 1) return ROOT_FILES.has(parts[0]) ? ANY : null;
  return FOLDER_RULES[parts[0]] ?? null;
}

function rawPathFrom(url: URL): string {
  const q = url.searchParams.get("path");
  if (q !== null) return q;
  const marker = "/members-file/";
  const i = url.pathname.indexOf(marker);
  return i === -1 ? "" : url.pathname.slice(i + marker.length);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: BASE_HEADERS });
  if (req.method !== "GET" && req.method !== "HEAD") return fail(405, "method_not_allowed");

  try {
    const url = new URL(req.url);
    const path = cleanPath(rawPathFrom(url));
    if (!path) return fail(400, "bad_path");
    const needs = allowedFor(path);

    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.toLowerCase().startsWith("bearer ")) return fail(401, "sign_in_required");
    const jwt = authHeader.slice(7).trim();
    if (!jwt) return fail(401, "sign_in_required");

    const caller = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await caller.auth.getUser(jwt);
    if (userError || !userData?.user?.email) return fail(401, "sign_in_required");
    // Unconfirmed accounts get nothing (RLS's member_jwt_email() also refuses them).
    if (!userData.user.email_confirmed_at) return fail(403, "not_allowed");

    if (!needs) return fail(403, "not_allowed");

    // RLS returns only this person's rows.
    const { data: rows, error: accessError } = await caller
      .from("member_access")
      .select("access, expires_at");
    if (accessError || !Array.isArray(rows)) return fail(403, "not_allowed");

    const now = Date.now();
    const live = new Set(
      rows
        .filter((r) => !r.expires_at || Date.parse(r.expires_at) > now)
        .map((r) => r.access as Access),
    );
    if (!needs.some((a) => live.has(a))) return fail(403, "not_allowed");

    const encoded = path.split("/").map(encodeURIComponent).join("/");
    const res = await fetch(
      `${SUPABASE_URL}/storage/v1/object/authenticated/${BUCKET}/${encoded}`,
      { headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}`, apikey: SERVICE_ROLE_KEY } },
    );
    if (res.status === 400 || res.status === 404) {
      await res.body?.cancel();
      return fail(404, "not_found");
    }
    if (!res.ok || !res.body) {
      await res.body?.cancel();
      return fail(502, "storage_error");
    }

    const ext = (path.split(".").pop() || "").toLowerCase();
    const headers: Record<string, string> = {
      ...BASE_HEADERS,
      "Content-Type": TYPES[ext] || "application/octet-stream",
    };
    const len = res.headers.get("Content-Length");
    if (len) headers["Content-Length"] = len;
    if (req.method === "HEAD") {
      await res.body.cancel();
      return new Response(null, { status: 200, headers });
    }
    return new Response(res.body, { status: 200, headers });
  } catch (_e) {
    return fail(500, "error");
  }
});
