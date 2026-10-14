// ----------------------------------------------------------------------------
// Which Intuit environment (and so which Intuit app keys) a QuickBooks
// connection uses. Pure: no imports, no Deno globals except in denoEnv, so
// tests/edge/qbo_env.test.mjs runs it under plain node.
//
// Why per connection: Intuit issues SEPARATE app keys for development
// (sandbox companies only) and production (real companies only). Tokens are
// bound to the app that minted them, so a connection must refresh with the
// exact keys it was connected with, forever. There used to be one global set
// (QBO_CLIENT_ID / QBO_CLIENT_SECRET) plus a global QBO_ENV. That global is
// gone: QBO_ENV is no longer read anywhere. Each connect-state row and each
// connection row carries its own api_env, and every Intuit token call picks
// its keys from that.
//
// Secrets (names only; values live in Supabase edge-function secrets):
//   production: QBO_PRODUCTION_CLIENT_ID + QBO_PRODUCTION_CLIENT_SECRET
//               ONLY. Never falls back to the legacy pair: those are the
//               development (sandbox) keys.
//   sandbox:    QBO_SANDBOX_CLIENT_ID + QBO_SANDBOX_CLIENT_SECRET when both are
//               set, otherwise the legacy QBO_CLIENT_ID + QBO_CLIENT_SECRET.
//               A pair is always used whole, never one half of each. If only
//               one half of the new pair is set that is a misconfiguration
//               and is reported, not papered over with the legacy pair.
//               OPERATIONAL NOTE: every sandbox connection made before this
//               change was minted with the legacy pair. If the new sandbox
//               pair is ever set, it must be the SAME Intuit app as the
//               legacy pair (or those connections must be reconnected),
//               because refresh tokens only work with the app that minted
//               them. Leaving the new pair unset is always safe.
//   api_env NULL (a connection made before api_env existed): treated as
//               sandbox, i.e. the legacy pair, which is what minted it.
//
// THE ENVIRONMENT RULE (authoritative copy: SQL public.qbo_env_for_client()
// in supabase/qbo-env-per-connection.sql, which the connect-start RPCs use, so
// the decision is made in the database from clients.test_only and never taken
// from the browser):
//   client with test_only = true  -> sandbox
//   client with test_only = false -> production
//   the firm's own company        -> production
// envForClient / FIRM_ENV below mirror it for the tests and for readers; the
// edge functions never compute the env themselves, they read it from the
// state row (connect) or the connection row (refresh).
// ----------------------------------------------------------------------------

export type QboEnv = "sandbox" | "production";
export type GetEnv = (name: string) => string | undefined;
export type QboKeySource = "sandbox-new" | "sandbox-legacy" | "production";
export type QboKeys = { env: QboEnv; clientId: string; clientSecret: string; source: QboKeySource };

export const SECRET_NAMES = {
  productionId: "QBO_PRODUCTION_CLIENT_ID",
  productionSecret: "QBO_PRODUCTION_CLIENT_SECRET",
  sandboxId: "QBO_SANDBOX_CLIENT_ID",
  sandboxSecret: "QBO_SANDBOX_CLIENT_SECRET",
  legacyId: "QBO_CLIENT_ID",
  legacySecret: "QBO_CLIENT_SECRET",
} as const;

export const FIRM_ENV: QboEnv = "production";
export const INTUIT_AUTHORIZE_URL = "https://appcenter.intuit.com/connect/oauth2";
export const QBO_SCOPE = "com.intuit.quickbooks.accounting";

// Deno's environment, read lazily per call (never at module load), so one
// missing secret fails one connection rather than the whole function boot.
export const denoEnv: GetEnv = (name) => {
  // deno-lint-ignore no-explicit-any
  const d = (globalThis as any).Deno;
  const v = d?.env?.get(name);
  return typeof v === "string" ? v : undefined;
};

// A required secret is missing (or half a pair is). Carries the secret NAMES
// only, never a value. Safe for last_error, logs and API responses.
export class QboKeysMissingError extends Error {
  env: QboEnv;
  missing: string[];
  constructor(env: QboEnv, missing: string[], note = "") {
    super(
      `QuickBooks ${env} keys aren't configured on the server (missing: ${missing.join(", ")})` +
        (note ? `. ${note}` : ""),
    );
    this.name = "QboKeysMissingError";
    this.env = env;
    this.missing = [...missing];
  }
}

// Strict: exactly 'sandbox' or 'production', else null. For anything newly
// minted (the connect-start RPC's answer, a state row written by it).
export function parseEnvStrict(x: unknown): QboEnv | null {
  return x === "sandbox" || x === "production" ? x : null;
}

// For an api_env READ BACK from a stored row (state or connection). NULL /
// missing means a legacy row from before api_env existed, which was minted
// with the legacy (sandbox) keys, so it maps to sandbox. Any other unexpected
// value throws instead of guessing (the column has a CHECK constraint, so this
// "can't happen"; if it does, failing beats refreshing with the wrong app).
export function normalizeStoredEnv(x: unknown): QboEnv {
  if (x === null || x === undefined) return "sandbox";
  const strict = parseEnvStrict(x);
  if (!strict) throw new Error("stored QuickBooks api_env is not 'sandbox' or 'production'");
  return strict;
}

function present(getEnv: GetEnv, name: string): string | null {
  const v = getEnv(name);
  const t = typeof v === "string" ? v.trim() : "";
  return t ? t : null;
}

// The Intuit app keys for an environment. Throws QboKeysMissingError (names
// only) when they aren't configured.
export function keysForEnv(env: QboEnv, getEnv: GetEnv): QboKeys {
  const N = SECRET_NAMES;
  if (env === "production") {
    const id = present(getEnv, N.productionId);
    const secret = present(getEnv, N.productionSecret);
    const missing = [!id && N.productionId, !secret && N.productionSecret].filter(Boolean) as string[];
    if (missing.length) throw new QboKeysMissingError("production", missing);
    return { env, clientId: id as string, clientSecret: secret as string, source: "production" };
  }
  if (env !== "sandbox") throw new Error("unknown QuickBooks environment");

  const newId = present(getEnv, N.sandboxId);
  const newSecret = present(getEnv, N.sandboxSecret);
  if (newId && newSecret) return { env, clientId: newId, clientSecret: newSecret, source: "sandbox-new" };
  if (newId || newSecret) {
    // Half of the new pair: never combine it with half of the legacy pair.
    throw new QboKeysMissingError("sandbox", [newId ? N.sandboxSecret : N.sandboxId], "Set both halves of the pair, or neither");
  }
  const oldId = present(getEnv, N.legacyId);
  const oldSecret = present(getEnv, N.legacySecret);
  if (oldId && oldSecret) return { env, clientId: oldId, clientSecret: oldSecret, source: "sandbox-legacy" };
  if (oldId || oldSecret) {
    throw new QboKeysMissingError("sandbox", [oldId ? N.legacySecret : N.legacyId], "Set both halves of the pair, or neither");
  }
  throw new QboKeysMissingError("sandbox", [N.sandboxId, N.sandboxSecret], `or the legacy ${N.legacyId} + ${N.legacySecret}`);
}

// Keys for a STORED api_env (connection or state row; NULL = legacy sandbox).
export function keysForStoredEnv(apiEnv: unknown, getEnv: GetEnv): QboKeys {
  return keysForEnv(normalizeStoredEnv(apiEnv), getEnv);
}

// Mirror of SQL public.qbo_env_for_client() (see the header). Only `true`
// means test; anything else is treated as a real client.
export function envForClient(testOnly: boolean | null | undefined): QboEnv {
  return testOnly === true ? "sandbox" : "production";
}

// The OAuth redirect URI. The SAME function builds it for the authorize URL
// (qbo-connect-start) and for the code exchange (qbo-callback): Intuit rejects
// an exchange whose redirect_uri differs from the authorize request's by even
// one character. It must also be registered on BOTH Intuit apps (development
// and production) in the Intuit developer portal. Same string as before this
// change: `${SUPABASE_URL}/functions/v1/qbo-callback` (a trailing slash on
// SUPABASE_URL, which the hosted value never has, is dropped).
export function qboRedirectUri(supabaseUrl: string | undefined | null): string {
  const base = String(supabaseUrl ?? "").trim().replace(/\/+$/, "");
  // http only for a local `supabase functions serve`; the hosted URL is https.
  if (!/^https?:\/\/[^\s/?#]+$/.test(base)) throw new Error("SUPABASE_URL is missing or not a bare origin");
  return `${base}/functions/v1/qbo-callback`;
}

export function authorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const qs = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    scope: QBO_SCOPE,
    redirect_uri: redirectUri,
    state,
  });
  return `${INTUIT_AUTHORIZE_URL}?${qs}`;
}

// intuit_tid is echoed to the browser (?ref=) so staff can quote it to
// Intuit support. Only a plain id shape passes; anything else is dropped.
// The same regex is used on the page that shows it (qbo-connected.html).
export const INTUIT_TID_RE = /^[0-9A-Za-z-]{8,64}$/;
export function sanitizeIntuitTid(x: unknown): string | null {
  return typeof x === "string" && INTUIT_TID_RE.test(x) ? x : null;
}
