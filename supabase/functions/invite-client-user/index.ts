import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// §171: send a client contact their first sign-in link.
//
// The problem this exists to solve
// -------------------------------
// ClientAuthGate's login form calls signInWithOtp with
// shouldCreateUser: false (a deliberate security-audit fix — otherwise
// anyone could type any address into the portal's login box and make
// Supabase mint an auth.users row and send a branded email to it). The
// consequence is that a brand-new client contact, freshly added to
// client_users by a bookkeeper, has NO auth.users row yet, so
// signInWithOtp finds nothing to sign in and no link is ever sent. They
// could never log in for the first time.
//
// The fix is an invite that only STAFF can trigger, which is what this is.
// It runs with the service role (the only way to reach auth.admin), so the
// caller check below is load-bearing: without it this would be an open
// "email anyone a link into any client's books" endpoint.
//
// Caller check, in order:
//   1. verify_jwt = true — Supabase rejects anything with no valid JWT
//      before this code runs at all.
//   2. auth.getUser(jwt) resolves that JWT to a real, current user. Never
//      trust an email out of the request body.
//   3. that email must be an ACTIVE row in `staff` (a client contact's own
//      JWT is a perfectly valid JWT — it must not get past here).
//   4. can_access_client(client_id) must be true, called through a client
//      built with the CALLER's JWT so the function sees their identity, not
//      the service role's. That's the same assignment-scoping predicate
//      every per-client table's RLS uses
//      (audit-hardening-client-scoping.sql) — a bookkeeper can't invite
//      someone into a client they aren't assigned to.
//
// Only then does the service-role client come out.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

// Where the invite link lands. Pinned to the production portal path on
// purpose (never taken from the request) — /login is what ClientAuthGate
// mounts on, and an attacker-supplied redirectTo is how invite links get
// turned into token-stealing open redirects.
const INVITE_REDIRECT_TO = "https://app.mygoodbooks.org/login";

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

// Fixed error codes and wording; the raw DB/auth error is logged with
// console.error and never returned.
const ERROR_MESSAGES: Record<string, string> = {
  contact_save_failed: "The contact couldn't be saved. Please try again.",
  invite_failed: "The invite email couldn't be sent. Please try again later.",
  rate_limit_check_failed: "Invites aren't available right now. Please try again later.",
};
function fail(code: string, status: number) {
  return json({ error: code, message: ERROR_MESSAGES[code] }, status);
}

const INVITES_PER_CALLER_PER_HOUR = 20;
const RECIPIENT_COOLDOWN_MS = 10 * 60 * 1000;

// Supabase reports "this address already has an auth user" a few different
// ways depending on version/path. Any of them means the same thing for us:
// there is nothing to invite, the person just uses the normal login form
// (which now works for them, because signInWithOtp has a user to find).
function isAlreadyRegistered(
  error: { message?: string; code?: string; status?: number },
) {
  const msg = (error.message || "").toLowerCase();
  return (
    error.code === "email_exists" ||
    error.code === "user_already_exists" ||
    error.status === 422 ||
    msg.includes("already been registered") ||
    msg.includes("already registered") ||
    msg.includes("already exists")
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return json({ error: "unauthorized" }, 401);
  }
  const jwt = authHeader.slice(7).trim();

  let body: {
    email?: string;
    client_id?: string;
    name?: string;
    role?: string;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }

  const email = (body.email || "").trim().toLowerCase();
  const clientId = (body.client_id || "").trim();
  if (!email || !email.includes("@") || !clientId) {
    return json({ error: "email and client_id are required" }, 400);
  }

  // --- caller identity -------------------------------------------------
  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  const { data: userData, error: userError } = await callerClient.auth.getUser(
    jwt,
  );
  const callerEmail = userData?.user?.email?.toLowerCase();
  if (userError || !callerEmail) return json({ error: "unauthorized" }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { data: staffRow } = await admin
    .from("staff")
    .select("email, active")
    .eq("email", callerEmail)
    .maybeSingle();
  if (!staffRow || !staffRow.active) return json({ error: "forbidden" }, 403);

  // RLS/identity-sensitive on purpose: called through the caller's own JWT,
  // so can_access_client() reads THEIR staff_client_access assignments.
  const { data: canAccess, error: rpcError } = await callerClient.rpc(
    "can_access_client",
    { p_client_id: clientId },
  );
  if (rpcError) return json({ error: "access_check_failed" }, 500);
  if (canAccess !== true) return json({ error: "forbidden" }, 403);

  // --- from here on: service role --------------------------------------
  // Make sure the contact is actually on the allowlist and active before
  // any email goes out — an invite to someone ClientAuthGate would then
  // refuse is just a confusing dead end for the client.
  const { data: existingContact } = await admin
    .from("client_users")
    .select("email, client_id, name, role, active")
    .eq("email", email)
    .maybeSingle();

  if (existingContact && existingContact.client_id !== clientId) {
    // email is client_users' primary key — one person, one org. Silently
    // moving them would revoke their access to the other org. Which org is
    // deliberately not said: the caller may not be assigned to it.
    return json(
      {
        error: "already_assigned",
        message: `${email} is already set up for a different organization.`,
      },
      409,
    );
  }

  // Rate limits (invite_attempts, service-role only). Every invite email
  // draws on Supabase's project-wide auth-email quota, which everyone's
  // sign-in links share: at most INVITES_PER_CALLER_PER_HOUR per staffer,
  // and one per recipient per RECIPIENT_COOLDOWN_MS. Fails closed.
  const nowMs = Date.now();
  const [byCaller, byRecipient] = await Promise.all([
    admin
      .from("invite_attempts")
      .select("id", { count: "exact", head: true })
      .eq("caller_email", callerEmail)
      .gte("created_at", new Date(nowMs - 60 * 60 * 1000).toISOString()),
    admin
      .from("invite_attempts")
      .select("id", { count: "exact", head: true })
      .eq("recipient_email", email)
      .gte("created_at", new Date(nowMs - RECIPIENT_COOLDOWN_MS).toISOString()),
  ]);
  if (byCaller.error || byRecipient.error) {
    console.error(
      `invite-client-user: rate-limit check failed: ${(byCaller.error || byRecipient.error)!.message}`,
    );
    return fail("rate_limit_check_failed", 500);
  }
  if ((byCaller.count ?? 0) >= INVITES_PER_CALLER_PER_HOUR) {
    return json({
      error: "rate_limited",
      message: "You've sent a lot of invites in the last hour. Please try again later.",
    }, 429);
  }
  if ((byRecipient.count ?? 0) >= 1) {
    return json({
      error: "rate_limited",
      message: `An invite was just sent to ${email}. Please wait 10 minutes before sending another.`,
    }, 429);
  }
  const { error: attemptError } = await admin
    .from("invite_attempts")
    .insert({ caller_email: callerEmail, recipient_email: email });
  if (attemptError) {
    console.error(`invite-client-user: could not record attempt: ${attemptError.message}`);
    return fail("rate_limit_check_failed", 500);
  }

  // Written through invite_write_client_user (service_role only) so the
  // activity log records the staff member as the actor instead of 'System'.
  // callerEmail comes from auth.getUser(jwt) above, never from the body.
  if (!existingContact || !existingContact.active) {
    const { error: writeError } = await admin.rpc("invite_write_client_user", {
      p_actor_email: callerEmail,
      p_email: email,
      p_client_id: clientId,
      p_name: (body.name || "").trim() || email.split("@")[0],
      p_role: (body.role || "").trim() || "Contact",
    });
    if (writeError) {
      console.error(`invite-client-user: invite_write_client_user failed: ${writeError.code ?? ""} ${writeError.message}`);
      return fail("contact_save_failed", 400);
    }
  }

  // --- the invite itself -----------------------------------------------
  const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(
    email,
    { redirectTo: INVITE_REDIRECT_TO },
  );

  const status = inviteError
    ? isAlreadyRegistered(inviteError) ? "exists" : "error"
    : "invited";

  if (status === "error") {
    console.error(
      `invite-client-user: invite failed: ${inviteError!.code ?? ""} ${inviteError!.status ?? ""} ${inviteError!.message}`,
    );
    return fail("invite_failed", 400);
  }

  // The client_users trigger (client-activity-log.sql) logs the row change,
  // but not the email — "we sent Dana her link on the 4th" is its own fact,
  // and the whole point of this endpoint. client_activity_log has insert
  // revoked from anon/authenticated; service_role is unaffected.
  await admin.from("client_activity_log").insert({
    client_id: clientId,
    actor_email: callerEmail,
    actor_name: callerEmail,
    action: status === "invited"
      ? "portal_invite_sent"
      : "portal_invite_skipped",
    detail: {
      email,
      result: status,
      note: status === "exists"
        ? "Already had a sign-in account — can use the portal login form directly."
        : "Invite email sent.",
    },
  });

  return json({
    status,
    email,
    message: status === "invited"
      ? `Invite sent to ${email}.`
      : `${email} already has a sign-in account — they can sign in from the portal login page.`,
  });
});
