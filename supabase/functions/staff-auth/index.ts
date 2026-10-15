import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  isAlreadyRegistered,
  MAX_EMAILS,
  normalizeEmail,
  parseRequest,
  plan,
  RATE_ACTIONS,
  RATE_WINDOW_MS,
  randomPassword,
  remainingBudget,
  type Result,
  summarize,
} from "./logic.ts";

// staff-auth: make the Supabase sign-in account (auth.users row) for staff.
//
// Why this exists
// ---------------
// Supabase Auth has "Allow new users to sign up" OFF, on purpose: nobody can
// mint an account by typing an address or clicking "Sign in with Google".
// The side effect: a bookkeeper added on Team → Members has a `staff` row
// but no auth.users row, so their first Google sign-in comes back with
// signup_disabled. This function creates that account (email confirmed, a
// random password nobody ever uses) so Google sign-in links to it by email.
//
//   POST { action: "ensure", emails: ["a@mygoodbooks.org", ...] }  (max 50)
//   POST { action: "repair" }   every ACTIVE staff member with no account
//                               (from staff_missing_auth(), staff-auth-repair.sql)
//   → { action, results: [{ email, status: "created"|"exists"|"skipped"|"error", reason? }],
//       summary: { created, exists, skipped, error }, more? }
//
// Caller check (same rule as the `staff` table's write policy,
// "admins can manage staff" = is_active_staff_admin(), nothing wider):
//   1. verify_jwt = true — Supabase rejects a missing/invalid JWT first.
//   2. auth.getUser(jwt) resolves the caller. Never trust an email in the body.
//   3. is_active_staff_admin() called with the CALLER's JWT must be true
//      (role 'admin', active, and jwt_has_google(): Google has EVER been
//      linked to the account. It reads the JWT's providers list, so an admin
//      who once used Google and is now in an installed-app email-code
//      session still passes. It does not mean "this session is Google".)
//      Temp admins are bookkeepers and fail here, exactly like the RLS.
//   4. Belt and braces, with the service role: their staff row is
//      role = 'admin' and active = true.
//
// Each address must be @mygoodbooks.org, an ACTIVE staff row, and not a
// client portal login (client_users). Anything else is skipped.
//
// Rate limit: about 60 new accounts per admin per hour, 200 overall, counted
// from staff_audit_log 'auth_user_created' rows only. Not strictly atomic
// under parallel requests; bounded by the number of staff rows missing an
// account. Out of budget → 429.
//
// Never logged or returned: the password, the service role key, request
// bodies, stack traces. Errors are short codes plus a friendly message.
//
// Deploy (verify_jwt ON — no --no-verify-jwt flag):
//   npx supabase@latest functions deploy staff-auth --project-ref xumsqmhccgfjnlmieqyu
// SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are injected
// by Supabase; no new secret.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function fail(status: number, error: string, message: string) {
  return json({ error, message }, status);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return fail(405, "method_not_allowed", "Use POST.");

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.toLowerCase().startsWith("bearer ")) {
      return fail(401, "unauthorized", "Sign in first.");
    }
    const jwt = authHeader.slice(7).trim();

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return fail(400, "invalid_body", "Send a JSON object.");
    }
    const parsed = parseRequest(body);
    if (!parsed.ok) return fail(parsed.status, parsed.error, parsed.message);

    // --- caller identity -----------------------------------------------
    const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: userData, error: userError } = await callerClient.auth
      .getUser(jwt);
    const callerEmail = normalizeEmail(userData?.user?.email);
    if (userError || !callerEmail) return fail(401, "unauthorized", "Sign in first.");

    const { data: isAdmin, error: adminRpcError } = await callerClient.rpc(
      "is_active_staff_admin",
    );
    if (adminRpcError) {
      return fail(500, "access_check_failed", "Couldn't check your access. Try again.");
    }
    if (isAdmin !== true) return fail(403, "forbidden", "Only admins can set up sign-in.");

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const { data: staffRows, error: staffError } = await admin
      .from("staff")
      .select("email, role, active");
    if (staffError || !staffRows) {
      return fail(500, "lookup_failed", "Couldn't read the staff list. Try again.");
    }
    const me = staffRows.find((s) => normalizeEmail(s.email) === callerEmail);
    if (!me || me.role !== "admin" || me.active !== true) {
      return fail(403, "forbidden", "Only admins can set up sign-in.");
    }

    // --- which addresses -----------------------------------------------
    // staff_missing_auth() (staff-auth-repair.sql) lists ACTIVE staff with no
    // auth.users row. Called as the caller, so its own admin check applies.
    const { data: missingRows, error: missingError } = await callerClient.rpc(
      "staff_missing_auth",
    );
    const missing = missingError || !Array.isArray(missingRows)
      ? null
      : new Set(missingRows.map((r: { email: string }) => normalizeEmail(r.email)));

    let emails: string[];
    let rejected: Result[] = [];
    let more = 0;
    if (parsed.action === "repair") {
      if (!missing) {
        return fail(
          503,
          "repair_unavailable",
          "Fix sign-in isn't set up yet (supabase/staff-auth-repair.sql).",
        );
      }
      const all = [...missing].sort();
      emails = all.slice(0, MAX_EMAILS);
      more = all.length - emails.length;
    } else {
      emails = parsed.emails;
      rejected = parsed.rejected;
    }

    // Already has an account = active staff that staff_missing_auth() did not
    // list. If that RPC isn't available, fall back to createUser's own
    // "already registered" answer.
    const hasAuth = missing ? new Set(emails.filter((e) => !missing.has(e))) : null;

    const { data: clientRows, error: clientError } = await admin
      .from("client_users")
      .select("email")
      .ilike("email", "%@mygoodbooks.org");
    if (clientError) {
      return fail(500, "lookup_failed", "Couldn't check client logins. Try again.");
    }

    const { create, results } = plan(
      emails,
      staffRows,
      (clientRows || []).map((r: { email: string }) => r.email),
      hasAuth,
    );

    // --- rate limit ------------------------------------------------------
    let toCreate = create;
    if (create.length > 0) {
      const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
      const [mine, everyone] = await Promise.all([
        admin.from("staff_audit_log").select("id", { count: "exact", head: true })
          .eq("actor_email", callerEmail).in("action", RATE_ACTIONS).gte("created_at", since),
        admin.from("staff_audit_log").select("id", { count: "exact", head: true })
          .in("action", RATE_ACTIONS).gte("created_at", since),
      ]);
      if (mine.error || everyone.error) {
        return fail(500, "rate_check_failed", "Couldn't check the hourly limit. Try again.");
      }
      const budget = remainingBudget(mine.count ?? 0, everyone.count ?? 0);
      if (budget === 0) {
        return fail(
          429,
          "rate_limited",
          "Too many sign-in accounts set up in the last hour. Wait a bit, then use Fix sign-in.",
        );
      }
      toCreate = create.slice(0, budget);
      for (const email of create.slice(budget)) {
        results.push({ email, status: "skipped", reason: "rate_limited" });
      }
    }

    // --- create ------------------------------------------------------------
    for (const email of toCreate) {
      const { error } = await admin.auth.admin.createUser({
        email,
        email_confirm: true,
        password: randomPassword(),
        user_metadata: { created_by: "staff-auth" },
      });
      if (!error) {
        results.push({ email, status: "created" });
        const { error: logError } = await admin.from("staff_audit_log").insert({
          actor_email: callerEmail,
          action: "auth_user_created",
          target_email: email,
          detail: parsed.action === "repair"
            ? "sign-in account created (Fix sign-in)"
            : "sign-in account created",
        });
        if (logError) console.log("staff-auth: audit row not written");
      } else if (isAlreadyRegistered(error)) {
        results.push({ email, status: "exists" });
      } else {
        // Code only: no address, no message body that could echo input.
        // No audit row: nothing was created.
        console.log(
          `staff-auth: createUser failed (${error.status ?? "?"} ${error.code ?? ""})`,
        );
        results.push({ email, status: "error", reason: "create_failed" });
      }
    }

    const all = [...rejected, ...results];
    const summary = summarize(all);

    if (parsed.action === "repair" && emails.length > 0) {
      await admin.from("staff_audit_log").insert({
        actor_email: callerEmail,
        action: "auth_repair",
        target_email: "(active staff without sign-in)",
        detail: `${summary.created} created, ${summary.exists} already set up, ${summary.skipped} skipped, ${summary.error} failed`,
      });
    }

    return json({ action: parsed.action, results: all, summary, ...(more > 0 ? { more } : {}) });
  } catch (_e) {
    console.log("staff-auth: unexpected error");
    return fail(500, "internal_error", "Something went wrong setting up sign-in. Try again.");
  }
});
