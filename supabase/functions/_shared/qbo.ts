// ----------------------------------------------------------------------------
// Shared QuickBooks Online helpers for edge functions (docs/gl-review-spec.md
// 3.2). Lifted from qbo-sync/index.ts. qbo-gl-review uses this module for
// everything; qbo-sync and qbo-refresh-token use only the token refresh
// (getAccessToken / ensureFreshToken), so the lock lives in one tested place.
// qbo-sync keeps its own copies of the other helpers. A function bundles
// _shared at deploy time, so it picks up changes here only when it is
// redeployed: after changing the token code, redeploy qbo-sync,
// qbo-refresh-token and qbo-gl-review together.
//
// Exports: IntuitError, IntuitAuthError, TokenBusyError, NoTokensError,
// TokenStoreError, intuitFetch(ctx, url, what) with the call counter on ctx
// (no module-level global), queryUrl, reportUrl, reportColumn, walkDataRows,
// num, baseForEnv, resolveApiBase (per-connection api_env, probing both hosts
// once), meterUsage, isTooLargeFault, reconnectMessage / flagReconnect (the
// qbo-sync "please reconnect" path), flagKeysMissing + QboKeysMissingError
// (re-exported from ./qbo-env.ts), and getAccessToken / ensureFreshToken with
// the token-refresh lock.
//
// Never logs Intuit response bodies or token values: status codes, counts and
// intuit_tid only.
//
// Intuit app keys are chosen PER CONNECTION (./qbo-env.ts): a refresh uses
// keysForStoredEnv(qbo_connections.api_env), NULL = legacy sandbox keys. The
// caller passes the api_env it already holds (`apiEnv`), or it is read with
// one select, and only when a refresh is actually due. Keys are read lazily
// per call, never at module load. Missing keys throw QboKeysMissingError
// (secret names only) before the lock is taken; flagKeysMissing records it on
// the connection.
//
// The token-refresh lock (qbo_connections.token_refresh_at, spec 3.2): Intuit
// rotates the refresh token on every use and the old one dies at once, so two
// processes refreshing the same connection at the same moment strand it.
// qbo-sync, qbo-refresh-token and every user of this module take the lock with
// a conditional UPDATE (stale after 60 s), hold it only around the Intuit token
// call + qbo_store_tokens, and re-read the stored tokens under it. A caller
// that can't take it waits 2 s, up to 3 times, re-reading the stored tokens
// each time (the other process refreshed) instead of refreshing. If the column
// doesn't exist yet (SQL not applied) the lock fails open, as before.
// Everything between taking and releasing the lock sits in one try/finally,
// and the Intuit token call times out after 20 s (well under the 60 s stale
// window), so a hung or failed refresh can't leave the lock held.
// ----------------------------------------------------------------------------
import { num, reportColumn, walkDataRows } from "./qbo_report.ts";
import { denoEnv, type GetEnv, keysForStoredEnv, QboKeysMissingError } from "./qbo-env.ts";
export { num, reportColumn, walkDataRows };
export { QboKeysMissingError };

export const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
export const PROD_BASE = "https://quickbooks.api.intuit.com";
export const SANDBOX_BASE = "https://sandbox-quickbooks.api.intuit.com";
export const MINOR_VERSION = "75";
// Refresh an access token this close to expiry (same window as qbo-sync and
// qbo-refresh-token).
export const REFRESH_AHEAD_MS = 10 * 60 * 1000;
export const TOKEN_LOCK_STALE_MS = 60 * 1000;
export const TOKEN_LOCK_WAIT_MS = 2000;
export const TOKEN_LOCK_TRIES = 3;
// Intuit token endpoint timeout. Must stay well under TOKEN_LOCK_STALE_MS.
export const TOKEN_FETCH_TIMEOUT_MS = 20 * 1000;

function env(name: string): string {
  // deno-lint-ignore no-explicit-any
  const d = (globalThis as any).Deno;
  return (d?.env?.get(name) as string | undefined) ?? "";
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------
// An Intuit call that came back non-2xx. `tooLarge` is set when a 400 says the
// report is too big (the body is read for that one check and never logged).
export class IntuitError extends Error {
  status: number;
  tid: string | null;
  tooLarge: boolean;
  constructor(status: number, tid: string | null, what: string, tooLarge = false) {
    super(`${what} failed (${status})${tid ? ` — intuit_tid: ${tid}` : ""}`);
    this.status = status;
    this.tid = tid;
    this.tooLarge = tooLarge;
  }
}

// Both API hosts rejected the first call: the token is bad, not the host.
export class IntuitAuthError extends IntuitError {
  constructor(tid: string | null, prodStatus: number, sandboxStatus: number) {
    super(401, tid, "environment probe");
    this.message =
      "QuickBooks rejected the connection — please reconnect " +
      `(production: ${prodStatus}, sandbox: ${sandboxStatus})`;
  }
}

// Another process held the token-refresh lock through every wait. Not a
// connection problem: callers must not flip the connection to 'error' on it.
export class TokenBusyError extends Error {
  constructor() {
    super("QuickBooks sign-in refresh already in progress");
  }
}

// No usable stored tokens (never connected, or no refresh token on file).
export class NoTokensError extends Error {}

// Intuit refreshed the token but qbo_store_tokens failed. Intuit has already
// rotated the refresh token, so the stored one may be dead: never ignore this.
export class TokenStoreError extends Error {
  tid: string | null;
  constructor(tid: string | null) {
    super("storing refreshed QuickBooks tokens failed — the connection may need reconnecting");
    this.tid = tid;
  }
}

// Parses a JSON body. A parse failure never carries the body: the runtime's
// SyntaxError message quotes the start of the text, which could be report
// data or a token, and these messages reach logs and last_error.
async function readJson(res: Response, what: string): Promise<any> {
  try {
    return await res.json();
  } catch (_e) {
    throw new Error(`${what}: QuickBooks sent a reply that isn't valid JSON`);
  }
}

// "This report is too big" from a 400 body (spec 2.2). Only Intuit's Fault
// Error Message / Detail / code are read when the body is JSON; the raw text
// only when it isn't. Deliberately narrow: generic words like "limit" or
// "maximum" alone (e.g. a bad maxresults or date parameter) don't count. The
// exact Intuit wording is unverified (spec 11.7).
const TOO_LARGE_RX =
  /\btoo\s+(large|big)\b|\btoo\s+many\s+(rows|cells|records|results|lines|columns)\b|\b(rows|cells|records|results|response\s+size|report\s+size)\b[^.]{0,40}\bexceed|\bexceed(s|ed)?\b[^.]{0,40}\b(rows|cells|records|results|response\s+size|report\s+size|cell\s+limit|row\s+limit)\b/i;
export function isTooLargeFault(text: string): boolean {
  const t = String(text || "");
  let parts: string[] | null = null;
  try {
    const j = JSON.parse(t);
    const errs = j?.Fault?.Error ?? j?.fault?.error ?? [];
    parts = (Array.isArray(errs) ? errs : [errs]).flatMap((e: any) => [e?.Message, e?.message, e?.Detail, e?.detail, e?.code])
      .filter((x: unknown) => x != null).map(String);
  } catch (_e) { /* not JSON: fall back to the text */ }
  const hay = parts ? parts.join(" . ") : t.slice(0, 4000);
  return TOO_LARGE_RX.test(hay);
}

// qbo-sync's wording for a rejected connection (stored in last_error).
export function reconnectMessage(e: Error): string {
  const detail = e?.message || "QuickBooks rejected the connection";
  return e instanceof IntuitAuthError ? detail : `QuickBooks rejected the connection — please reconnect. (${detail})`;
}

// Same path as qbo-sync on a 401 (token refused or both hosts rejected): the
// connection goes to 'error' and the existing Reconnect UI takes over. Never
// called for TokenBusyError. Never throws.
export async function flagReconnect(admin: any, clientId: string, e: Error, logTag = "qbo"): Promise<void> {
  try {
    const { error } = await admin
      .from("qbo_connections")
      .update({ status: "error", last_error: reconnectMessage(e), updated_at: new Date().toISOString() })
      .eq("client_id", clientId);
    if (error) console.log(`${logTag}: could not flag client ${clientId} for reconnect: ${error.message}`);
  } catch (err) {
    console.log(`${logTag}: could not flag client ${clientId} for reconnect: ${(err as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------
export function baseForEnv(e: string | null | undefined): string | null {
  if (e === "production") return PROD_BASE;
  if (e === "sandbox") return SANDBOX_BASE;
  return null;
}

export function queryUrl(base: string, realmId: string, q: string): string {
  return `${base}/v3/company/${realmId}/query?query=${encodeURIComponent(q)}&minorversion=${MINOR_VERSION}`;
}

export function reportUrl(base: string, realmId: string, name: string, params: Record<string, string>): string {
  const qs = new URLSearchParams({ ...params, minorversion: MINOR_VERSION });
  return `${base}/v3/company/${realmId}/reports/${name}?${qs}`;
}

// Per-request context. `calls` counts every HTTP attempt to the Accounting API
// (retries included) for metering; nothing is module-global, so overlapping
// requests in one isolate never mix counts.
export type QboCtx = {
  accessToken: string;
  calls: number;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};

export function newCtx(accessToken: string): QboCtx {
  return { accessToken, calls: 0 };
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Retries 429 / 5xx / network failures: 3 attempts in all, backing off 1 s
// then 3 s (or Retry-After, capped at 10 s). 4xx other than 429 is final.
export async function intuitFetch(
  ctx: QboCtx,
  url: string,
  what: string,
  opts: { attempts?: number; sniffTooLarge?: boolean } = {},
): Promise<any> {
  const f = ctx.fetch ?? fetch;
  const sleep = ctx.sleep ?? defaultSleep;
  const attempts = Math.max(1, opts.attempts ?? 3);
  let last: unknown = null;
  for (let i = 0; i < attempts; i++) {
    if (i > 0) {
      const ra = last instanceof IntuitError ? (last as any)._retryAfterMs ?? 0 : 0;
      await sleep(Math.min(10000, Math.max(ra, i === 1 ? 1000 : 3000)));
    }
    ctx.calls++;
    let res: Response;
    try {
      res = await f(url, { headers: { Authorization: `Bearer ${ctx.accessToken}`, Accept: "application/json" } });
    } catch (_e) {
      last = new IntuitError(0, null, `${what} (network)`);
      continue;
    }
    const tid = res.headers.get("intuit_tid");
    if (res.ok) return await readJson(res, what);
    let tooLarge = false;
    if (res.status === 400 && opts.sniffTooLarge) {
      // Read only to classify; never logged, never returned.
      try {
        tooLarge = isTooLargeFault(await res.text());
      } catch (_e) { /* ignore */ }
    } else {
      try { await res.body?.cancel(); } catch (_e) { /* ignore */ }
    }
    const err = new IntuitError(res.status, tid, what, tooLarge);
    if (res.status === 429 || res.status >= 500) {
      const s = Number(res.headers.get("retry-after"));
      (err as any)._retryAfterMs = Number.isFinite(s) && s > 0 ? s * 1000 : 0;
      last = err;
      continue;
    }
    throw err;
  }
  throw last instanceof Error ? last : new IntuitError(0, null, what);
}

// The API host for this connection. A known api_env is used as-is; a row
// without one is probed (production, then sandbox) with the caller's first
// real request and the answer is written back, like qbo-sync's account query.
// Returns the host and that first response.
export async function resolveApiBase(
  admin: any,
  ctx: QboCtx,
  clientId: string,
  apiEnv: string | null | undefined,
  urlFor: (base: string) => string,
  what: string,
): Promise<{ base: string; first: any }> {
  const known = baseForEnv(apiEnv);
  if (known) return { base: known, first: await intuitFetch(ctx, urlFor(known), what) };
  let prodErr: IntuitError | null = null;
  try {
    return { base: PROD_BASE, first: await settle(PROD_BASE) };
  } catch (e) {
    if (!(e instanceof IntuitError)) throw e;
    prodErr = e;
  }
  try {
    return { base: SANDBOX_BASE, first: await settle(SANDBOX_BASE) };
  } catch (e2) {
    if (!(e2 instanceof IntuitError)) throw e2;
    const p = prodErr as IntuitError;
    const authish = (st: number) => st === 401 || st === 403;
    // Rejected by both: the token is the problem. Two transient failures are
    // not, so the production failure is rethrown and the pull just fails.
    if (authish(p.status) && authish(e2.status)) throw new IntuitAuthError(e2.tid ?? p.tid, p.status, e2.status);
    throw p;
  }
  async function settle(base: string) {
    const first = await intuitFetch(ctx, urlFor(base), what, { attempts: 1 });
    const resolved = base === PROD_BASE ? "production" : "sandbox";
    await admin.from("qbo_connections").update({ api_env: resolved, updated_at: new Date().toISOString() }).eq("client_id", clientId);
    console.log(`qbo: client ${clientId} resolved api_env = ${resolved}`);
    return first;
  }
}

// qbo_usage_add(source, calls), once per request. Never throws.
export async function meterUsage(admin: any, source: string, calls: number): Promise<void> {
  if (!(calls > 0)) return;
  try {
    const { error } = await admin.rpc("qbo_usage_add", { p_source: source, p_calls: calls });
    if (error) console.log(`qbo: usage counter update failed: ${error.message}`);
  } catch (e) {
    console.log(`qbo: usage counter update failed: ${(e as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// Tokens + the refresh lock
// ---------------------------------------------------------------------------
export type TokenDeps = {
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  // Explicit Intuit app keys (tests). Both set = used as is, no env lookup.
  // Otherwise the keys come from keysForStoredEnv(apiEnv, getEnv).
  clientIdKey: string;
  clientSecret: string;
  // The connection's qbo_connections.api_env when the caller already has it
  // (null = legacy row = sandbox keys). undefined = read it (one select, only
  // when a refresh is due).
  apiEnv: string | null | undefined;
  getEnv: GetEnv;
  encKey: string; // QBO_TOKEN_ENCRYPTION_KEY
  logTag: string;
  // Extra tries after the lock is found held (2 s apart). 0 = don't wait:
  // TokenBusyError at once (the qbo-refresh-token cron skips that client).
  lockTries: number;
  timeoutMs: number; // Intuit token endpoint timeout
};

function tokenDeps(over: Partial<TokenDeps> = {}): TokenDeps {
  return {
    fetch: over.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a)),
    sleep: over.sleep ?? defaultSleep,
    now: over.now ?? (() => Date.now()),
    clientIdKey: over.clientIdKey ?? "",
    clientSecret: over.clientSecret ?? "",
    apiEnv: over.apiEnv,
    getEnv: over.getEnv ?? denoEnv,
    encKey: over.encKey ?? env("QBO_TOKEN_ENCRYPTION_KEY"),
    logTag: over.logTag ?? "qbo",
    lockTries: Math.max(0, over.lockTries ?? TOKEN_LOCK_TRIES),
    timeoutMs: over.timeoutMs ?? TOKEN_FETCH_TIMEOUT_MS,
  };
}

// "acquired" | "held" | "unavailable" (column missing / update failed: fail open).
export async function takeTokenLock(admin: any, clientId: string, now = Date.now()): Promise<"acquired" | "held" | "unavailable"> {
  const staleIso = new Date(now - TOKEN_LOCK_STALE_MS).toISOString();
  const { data, error } = await admin
    .from("qbo_connections")
    .update({ token_refresh_at: new Date(now).toISOString() })
    .eq("client_id", clientId)
    .or(`token_refresh_at.is.null,token_refresh_at.lt."${staleIso}"`)
    .select("client_id");
  if (error) return "unavailable";
  return data && data.length ? "acquired" : "held";
}

export async function releaseTokenLock(admin: any, clientId: string): Promise<void> {
  try {
    await admin.from("qbo_connections").update({ token_refresh_at: null }).eq("client_id", clientId);
  } catch (_e) { /* the lock goes stale after 60 s anyway */ }
}

// The stored token row. Throws NoTokensError when there is none at all; a row
// may lack an access token (a refresh can still mint one) or a refresh token
// (fine while the access token is fresh).
async function readTokens(admin: any, clientId: string, encKey: string): Promise<any> {
  const { data: rows, error } = await admin.rpc("qbo_get_tokens", { p_client_id: clientId, p_key: encKey });
  const row = rows?.[0];
  if (error || !row || (!row.access_token && !row.refresh_token)) throw new NoTokensError("no stored QuickBooks tokens");
  return row;
}

// The Intuit app keys to refresh this connection with (see TokenDeps).
async function refreshKeys(admin: any, clientId: string, d: TokenDeps): Promise<{ id: string; secret: string }> {
  if (d.clientIdKey && d.clientSecret) return { id: d.clientIdKey, secret: d.clientSecret };
  let apiEnv = d.apiEnv;
  if (apiEnv === undefined) {
    const { data, error } = await admin.from("qbo_connections").select("api_env").eq("client_id", clientId).maybeSingle();
    if (error) throw new Error("could not read this connection's QuickBooks environment");
    apiEnv = data?.api_env ?? null;
  }
  const k = keysForStoredEnv(apiEnv, d.getEnv); // throws QboKeysMissingError
  return { id: k.clientId, secret: k.clientSecret };
}

// Records "keys not configured" on the connection (secret names only, never a
// value). Status is left alone: the tokens are fine, and once the secrets are
// set the next refresh just works without a reconnect. Never throws.
export async function flagKeysMissing(admin: any, clientId: string, e: QboKeysMissingError, logTag = "qbo"): Promise<void> {
  try {
    const { error } = await admin
      .from("qbo_connections")
      .update({ last_error: `${e.message}. Ask an admin to add them.`, updated_at: new Date().toISOString() })
      .eq("client_id", clientId);
    if (error) console.log(`${logTag}: could not record missing keys for client ${clientId}: ${error.message}`);
  } catch (err) {
    console.log(`${logTag}: could not record missing keys for client ${clientId}: ${(err as Error).message}`);
  }
}

function isFresh(row: any, now: number): boolean {
  const exp = row?.expires_at ? new Date(row.expires_at).getTime() : 0;
  return !!row?.access_token && exp - now > REFRESH_AHEAD_MS;
}

export type FreshToken = { accessToken: string; refreshed: boolean; tid: string | null };

// A usable access token for the client, and whether this call refreshed it.
// The stored token is used when it has more than 10 minutes left (no lock
// taken); otherwise the lock is taken, the tokens re-read under it, and only
// then refreshed. Throws:
//   IntuitError(401)  Intuit refused the refresh (reconnect needed)
//   IntuitError(0)    the token endpoint didn't answer (network / 20 s timeout)
//   TokenBusyError    another process held the lock through every wait
//   NoTokensError     nothing stored, or no refresh token when one is needed
//   TokenStoreError   refreshed, but saving the rotated tokens failed (loud)
//   QboKeysMissingError  this connection's environment has no keys configured
//                     (thrown before the lock; nothing sent to Intuit)
export async function ensureFreshToken(admin: any, clientId: string, over: Partial<TokenDeps> = {}): Promise<FreshToken> {
  const d = tokenDeps(over);
  let row = await readTokens(admin, clientId, d.encKey);
  if (isFresh(row, d.now())) return { accessToken: row.access_token, refreshed: false, tid: null };
  if (!row.refresh_token) throw new NoTokensError("no refresh token on file");
  // Before the lock: a connection whose keys aren't configured fails here,
  // without touching the lock or Intuit.
  const keys = await refreshKeys(admin, clientId, d);

  let lock = await takeTokenLock(admin, clientId, d.now());
  for (let i = 0; lock === "held" && i < d.lockTries; i++) {
    await d.sleep(TOKEN_LOCK_WAIT_MS);
    row = await readTokens(admin, clientId, d.encKey);
    if (isFresh(row, d.now())) return { accessToken: row.access_token, refreshed: false, tid: null };
    lock = await takeTokenLock(admin, clientId, d.now());
  }
  if (lock === "held") throw new TokenBusyError();

  // From here to the end the lock may be ours: every exit releases it.
  try {
    if (lock === "acquired") {
      // Re-read under the lock: another process may have refreshed between
      // our first read and taking the lock; its old refresh token is dead.
      row = await readTokens(admin, clientId, d.encKey);
      if (isFresh(row, d.now())) return { accessToken: row.access_token, refreshed: false, tid: null };
      if (!row.refresh_token) throw new NoTokensError("no refresh token on file");
    }
    let res: Response;
    try {
      res = await d.fetch(TOKEN_URL, {
        method: "POST",
        headers: {
          Authorization: `Basic ${btoa(`${keys.id}:${keys.secret}`)}`,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: row.refresh_token }),
        signal: AbortSignal.timeout(d.timeoutMs),
      });
    } catch (e) {
      const timedOut = (e as Error)?.name === "TimeoutError" || (e as Error)?.name === "AbortError";
      throw new IntuitError(0, null, timedOut ? "token refresh (timed out)" : "token refresh (network)");
    }
    const tid = res.headers.get("intuit_tid");
    if (!res.ok) {
      try { await res.body?.cancel(); } catch (_e) { /* ignore */ }
      // Nearly always invalid_grant: the refresh token expired or was
      // revoked. 401-shaped so callers take the reconnect path (as before,
      // for every non-2xx).
      throw new IntuitError(401, tid, "token refresh");
    }
    let tokens: any;
    try {
      tokens = await readJson(res, "token refresh");
    } catch (e) {
      // Intuit may have rotated the refresh token already; nothing to store.
      console.error(`${d.logTag}: token refresh for client ${clientId} returned unreadable JSON${tid ? ` (intuit_tid: ${tid})` : ""}`);
      throw e;
    }
    const expiresIn = Number(tokens?.expires_in);
    if (!tokens?.access_token || !tokens?.refresh_token || !(expiresIn > 0)) {
      console.error(`${d.logTag}: token refresh for client ${clientId} returned an incomplete reply${tid ? ` (intuit_tid: ${tid})` : ""}`);
      throw new Error("token refresh: QuickBooks sent an incomplete reply");
    }
    let storeErr: unknown = null;
    try {
      const r = await admin.rpc("qbo_store_tokens", {
        p_client_id: clientId,
        p_access_token: tokens.access_token,
        p_refresh_token: tokens.refresh_token,
        p_expires_at: new Date(d.now() + expiresIn * 1000).toISOString(),
        p_key: d.encKey,
      });
      storeErr = r?.error ?? null;
    } catch (e) {
      storeErr = e;
    }
    if (storeErr) {
      // Loud on purpose: Intuit has rotated the refresh token, so the one on
      // file is probably dead now.
      console.error(`${d.logTag}: storing refreshed tokens FAILED for client ${clientId}${tid ? ` (intuit_tid: ${tid})` : ""}`);
      throw new TokenStoreError(tid);
    }
    console.log(`${d.logTag}: refreshed token for client ${clientId}${tid ? ` (intuit_tid: ${tid})` : ""}`);
    return { accessToken: tokens.access_token, refreshed: true, tid };
  } finally {
    if (lock === "acquired") await releaseTokenLock(admin, clientId);
  }
}

// Just the access token (qbo-gl-review, qbo-sync).
export async function getAccessToken(admin: any, clientId: string, over: Partial<TokenDeps> = {}): Promise<string> {
  return (await ensureFreshToken(admin, clientId, over)).accessToken;
}
