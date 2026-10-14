// node --test tests/edge/
// supabase/functions/_shared/qbo.ts: the token-refresh lock (spec 3.2) and the
// Intuit fetch helper, against a fake Supabase client and a fake fetch.
import test from "node:test";
import assert from "node:assert/strict";
import * as Q from "../../supabase/functions/_shared/qbo.ts";

const CLIENT = "c1";
const HOUR = 3600 * 1000;

// ---------------------------------------------------------------------------
// Fake admin client: just the calls qbo.ts makes.
//   from("qbo_connections").update(patch).eq(..).or(cond).select(..)   (take lock)
//   from("qbo_connections").update(patch).eq(..)                        (release / api_env)
//   rpc("qbo_get_tokens" | "qbo_store_tokens" | "qbo_usage_add")
// ---------------------------------------------------------------------------
function fakeAdmin(init = {}) {
  const st = {
    token_refresh_at: null,
    access_token: "old-access",
    refresh_token: "old-refresh",
    expires_at: new Date(Date.now() - 1000).toISOString(), // expired
    lockColumnMissing: false,
    storeError: null,
    stores: 0,
    releases: 0,
    takes: 0,
    usage: [],
    updates: [],
    ...init,
  };
  const admin = {
    st,
    from(table) {
      assert.equal(table, "qbo_connections");
      return {
        update(patch) {
          const chain = {
            eq() { return chain; },
            or(cond) {
              chain._cond = cond;
              return chain;
            },
            select() {
              st.takes++;
              if (st.lockColumnMissing) return Promise.resolve({ data: null, error: { message: "column token_refresh_at does not exist" } });
              const stale = /token_refresh_at\.lt\."([^"]+)"/.exec(chain._cond)[1];
              const free = st.token_refresh_at === null || st.token_refresh_at < stale;
              if (!free) return Promise.resolve({ data: [], error: null });
              st.token_refresh_at = patch.token_refresh_at;
              return Promise.resolve({ data: [{ client_id: CLIENT }], error: null });
            },
            then(res, rej) {
              // plain update (release, api_env write-back)
              st.updates.push(patch);
              if ("token_refresh_at" in patch && patch.token_refresh_at === null) {
                st.releases++;
                if (!st.lockColumnMissing) st.token_refresh_at = null;
              }
              return Promise.resolve({ data: null, error: null }).then(res, rej);
            },
          };
          return chain;
        },
      };
    },
    async rpc(name, args) {
      if (name === "qbo_get_tokens") {
        return { data: [{ access_token: st.access_token, refresh_token: st.refresh_token, expires_at: st.expires_at }], error: null };
      }
      if (name === "qbo_store_tokens") {
        if (st.storeError) return { data: null, error: { message: st.storeError } };
        st.stores++;
        st.access_token = args.p_access_token;
        st.refresh_token = args.p_refresh_token;
        st.expires_at = args.p_expires_at;
        return { data: null, error: null };
      }
      if (name === "qbo_usage_add") {
        st.usage.push([args.p_source, args.p_calls]);
        return { data: null, error: null };
      }
      throw new Error("unexpected rpc " + name);
    },
  };
  return admin;
}

function tokenFetch(opts = {}) {
  const f = async (url, init) => {
    f.calls++;
    assert.equal(url, Q.TOKEN_URL);
    const body = new URLSearchParams(String(init.body));
    f.usedRefresh.push(body.get("refresh_token"));
    if (opts.delay) await new Promise((r) => setTimeout(r, opts.delay));
    if (opts.status && opts.status !== 200) return new Response("{\"error\":\"invalid_grant\"}", { status: opts.status, headers: { intuit_tid: "tid-1" } });
    return new Response(JSON.stringify({ access_token: `new-access-${f.calls}`, refresh_token: `new-refresh-${f.calls}`, expires_in: 3600 }), { status: 200 });
  };
  f.calls = 0;
  f.usedRefresh = [];
  return f;
}

const deps = (extra = {}) => ({ clientIdKey: "id", clientSecret: "secret", encKey: "k", logTag: "test", sleep: async () => {}, ...extra });

// ---------------------------------------------------------------------------
// getAccessToken
// ---------------------------------------------------------------------------
test("fresh token: returned as is, no lock, no refresh", async () => {
  const admin = fakeAdmin({ expires_at: new Date(Date.now() + HOUR).toISOString() });
  const f = tokenFetch();
  assert.equal(await Q.getAccessToken(admin, CLIENT, deps({ fetch: f })), "old-access");
  assert.equal(f.calls, 0);
  assert.equal(admin.st.takes, 0);
});

test("expiring token: refreshed once under the lock, stored, lock released", async () => {
  const admin = fakeAdmin({ expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString() }); // < 10 min left
  const f = tokenFetch();
  assert.equal(await Q.getAccessToken(admin, CLIENT, deps({ fetch: f })), "new-access-1");
  assert.equal(f.calls, 1);
  assert.deepEqual(f.usedRefresh, ["old-refresh"]);
  assert.equal(admin.st.stores, 1);
  assert.equal(admin.st.refresh_token, "new-refresh-1");
  assert.equal(admin.st.token_refresh_at, null);
  assert.equal(admin.st.releases, 1);
});

test("two concurrent callers: one Intuit refresh, both get the new token", async () => {
  const admin = fakeAdmin();
  const f = tokenFetch({ delay: 15 });
  const sleep = () => new Promise((r) => setTimeout(r, 10));
  const [a, b] = await Promise.all([
    Q.getAccessToken(admin, CLIENT, deps({ fetch: f, sleep })),
    Q.getAccessToken(admin, CLIENT, deps({ fetch: f, sleep })),
  ]);
  assert.equal(f.calls, 1);
  assert.equal(a, "new-access-1");
  assert.equal(b, "new-access-1");
  assert.deepEqual(f.usedRefresh, ["old-refresh"]); // the dead token is never reused
  assert.equal(admin.st.token_refresh_at, null);
});

test("lock held by another process that finishes: re-read, no refresh of our own", async () => {
  const admin = fakeAdmin({ token_refresh_at: new Date().toISOString() });
  const f = tokenFetch();
  let slept = 0;
  const sleep = async (ms) => {
    slept++;
    assert.equal(ms, Q.TOKEN_LOCK_WAIT_MS);
    if (slept === 2) { // the other process stores its result, then releases
      admin.st.access_token = "other-access";
      admin.st.refresh_token = "other-refresh";
      admin.st.expires_at = new Date(Date.now() + HOUR).toISOString();
      admin.st.token_refresh_at = null;
    }
  };
  assert.equal(await Q.getAccessToken(admin, CLIENT, deps({ fetch: f, sleep })), "other-access");
  assert.equal(f.calls, 0);
  assert.equal(slept, 2);
});

test("lock held through every wait: TokenBusyError, never refreshes", async () => {
  const admin = fakeAdmin({ token_refresh_at: new Date().toISOString() });
  const f = tokenFetch();
  let slept = 0;
  await assert.rejects(Q.getAccessToken(admin, CLIENT, deps({ fetch: f, sleep: async () => { slept++; } })), Q.TokenBusyError);
  assert.equal(slept, Q.TOKEN_LOCK_TRIES);
  assert.equal(f.calls, 0);
  assert.notEqual(admin.st.token_refresh_at, null); // not ours to release
});

test("a stale lock (older than 60 s) is taken over", async () => {
  const admin = fakeAdmin({ token_refresh_at: new Date(Date.now() - 2 * 60 * 1000).toISOString() });
  const f = tokenFetch();
  assert.equal(await Q.getAccessToken(admin, CLIENT, deps({ fetch: f })), "new-access-1");
  assert.equal(f.calls, 1);
});

test("lock column missing (SQL not applied): fails open and still refreshes", async () => {
  const admin = fakeAdmin({ lockColumnMissing: true });
  const f = tokenFetch();
  assert.equal(await Q.getAccessToken(admin, CLIENT, deps({ fetch: f })), "new-access-1");
  assert.equal(f.calls, 1);
  assert.equal(admin.st.releases, 0);
});

test("Intuit refuses the refresh: IntuitError 401 and the lock is released", async () => {
  const admin = fakeAdmin();
  const f = tokenFetch({ status: 400 });
  await assert.rejects(Q.getAccessToken(admin, CLIENT, deps({ fetch: f })), (e) => e instanceof Q.IntuitError && e.status === 401 && e.tid === "tid-1");
  assert.equal(admin.st.token_refresh_at, null);
  assert.equal(admin.st.stores, 0);
});

test("storing the new tokens fails: throws, lock released", async () => {
  const admin = fakeAdmin({ storeError: "boom" });
  const f = tokenFetch();
  await assert.rejects(Q.getAccessToken(admin, CLIENT, deps({ fetch: f })), /storing refreshed/);
  assert.equal(admin.st.token_refresh_at, null);
});

test("storing the new tokens throws (rpc rejects): TokenStoreError, lock released", async () => {
  const admin = fakeAdmin();
  const rpc = admin.rpc.bind(admin);
  admin.rpc = async (name, args) => {
    if (name === "qbo_store_tokens") throw new Error("socket hang up");
    return rpc(name, args);
  };
  await assert.rejects(Q.getAccessToken(admin, CLIENT, deps({ fetch: tokenFetch() })), Q.TokenStoreError);
  assert.equal(admin.st.token_refresh_at, null);
});

test("token reply isn't JSON: throws without any of the body, lock released, nothing stored", async () => {
  const admin = fakeAdmin();
  const f = async () => new Response("access_token=SECRET-abc&refresh_token=SECRET-def", { status: 200 });
  await assert.rejects(Q.getAccessToken(admin, CLIENT, deps({ fetch: f })), (e) => !/SECRET|access_token=/.test(e.message) && /valid JSON/.test(e.message));
  assert.equal(admin.st.token_refresh_at, null);
  assert.equal(admin.st.stores, 0);
});

test("token reply missing the refresh token: throws, nothing stored, lock released", async () => {
  const admin = fakeAdmin();
  const f = async () => new Response(JSON.stringify({ access_token: "a", expires_in: 3600 }), { status: 200 });
  await assert.rejects(Q.getAccessToken(admin, CLIENT, deps({ fetch: f })), /incomplete/);
  assert.equal(admin.st.stores, 0);
  assert.equal(admin.st.token_refresh_at, null);
});

test("token endpoint network failure / timeout: IntuitError(0), lock released; the call carries a timeout signal", async () => {
  const admin = fakeAdmin();
  let signal = null;
  const f = async (_u, init) => {
    signal = init.signal;
    const e = new Error("The operation timed out.");
    e.name = "TimeoutError";
    throw e;
  };
  await assert.rejects(Q.getAccessToken(admin, CLIENT, deps({ fetch: f })), (e) => e instanceof Q.IntuitError && e.status === 0 && /timed out/.test(e.message));
  assert.ok(signal instanceof AbortSignal);
  assert.equal(admin.st.token_refresh_at, null);
  assert.ok(Q.TOKEN_FETCH_TIMEOUT_MS < Q.TOKEN_LOCK_STALE_MS);
});

test("a hung token endpoint is aborted by the timeout", async () => {
  const admin = fakeAdmin();
  const f = (_u, init) => new Promise((_r, rej) => init.signal.addEventListener("abort", () => rej(init.signal.reason)));
  await assert.rejects(Q.getAccessToken(admin, CLIENT, deps({ fetch: f, timeoutMs: 20 })), (e) => e instanceof Q.IntuitError && e.status === 0);
  assert.equal(admin.st.token_refresh_at, null);
});

test("ensureFreshToken: reports whether it refreshed; lockTries 0 never waits", async () => {
  const fresh = fakeAdmin({ expires_at: new Date(Date.now() + HOUR).toISOString() });
  assert.deepEqual(await Q.ensureFreshToken(fresh, CLIENT, deps({ fetch: tokenFetch(), lockTries: 0 })), { accessToken: "old-access", refreshed: false, tid: null });
  assert.equal(fresh.st.takes, 0); // not due: no lock taken at all

  const due = fakeAdmin();
  const r = await Q.ensureFreshToken(due, CLIENT, deps({ fetch: tokenFetch(), lockTries: 0 }));
  assert.equal(r.refreshed, true);
  assert.equal(r.accessToken, "new-access-1");

  const busy = fakeAdmin({ token_refresh_at: new Date().toISOString() });
  let slept = 0;
  await assert.rejects(Q.ensureFreshToken(busy, CLIENT, deps({ fetch: tokenFetch(), lockTries: 0, sleep: async () => { slept++; } })), Q.TokenBusyError);
  assert.equal(slept, 0);
  assert.notEqual(busy.st.token_refresh_at, null);
});

test("ensureFreshToken: refreshed by someone else between our read and the lock -> no refresh", async () => {
  const admin = fakeAdmin();
  const f = tokenFetch();
  const take = admin.from.bind(admin);
  // The other process finishes just as we take the lock.
  admin.from = (t) => {
    const q = take(t);
    const update = q.update;
    q.update = (patch) => {
      const chain = update(patch);
      const select = chain.select;
      chain.select = (...a) => {
        admin.st.access_token = "other-access";
        admin.st.expires_at = new Date(Date.now() + HOUR).toISOString();
        return select(...a);
      };
      return chain;
    };
    return q;
  };
  const r = await Q.ensureFreshToken(admin, CLIENT, deps({ fetch: f }));
  assert.deepEqual(r, { accessToken: "other-access", refreshed: false, tid: null });
  assert.equal(f.calls, 0);
  assert.equal(admin.st.token_refresh_at, null);
});

test("no tokens / no refresh token: NoTokensError (message unchanged)", async () => {
  const none = fakeAdmin({ access_token: null, refresh_token: null });
  await assert.rejects(Q.getAccessToken(none, CLIENT, deps({ fetch: tokenFetch() })), (e) => e instanceof Q.NoTokensError && /no stored QuickBooks tokens/.test(e.message));
  const noRefresh = fakeAdmin({ refresh_token: null });
  await assert.rejects(Q.getAccessToken(noRefresh, CLIENT, deps({ fetch: tokenFetch() })), (e) => e instanceof Q.NoTokensError && /no refresh token/.test(e.message));
  // Only a refresh token on file (access token missing): refreshes.
  const onlyRefresh = fakeAdmin({ access_token: null });
  assert.equal(await Q.getAccessToken(onlyRefresh, CLIENT, deps({ fetch: tokenFetch() })), "new-access-1");
});

test("reconnectMessage / flagReconnect: qbo-sync's wording, status error, never throws", async () => {
  const e = new Q.IntuitError(401, "tid-9", "token refresh");
  assert.equal(Q.reconnectMessage(e), "QuickBooks rejected the connection — please reconnect. (token refresh failed (401) — intuit_tid: tid-9)");
  const a = new Q.IntuitAuthError("t", 401, 403);
  assert.equal(Q.reconnectMessage(a), a.message);
  const admin = fakeAdmin();
  await Q.flagReconnect(admin, CLIENT, e, "test");
  assert.deepEqual(admin.st.updates.at(-1).status, "error");
  assert.match(admin.st.updates.at(-1).last_error, /please reconnect/);
  await Q.flagReconnect({ from() { throw new Error("down"); } }, CLIENT, e, "test");
});

// ---------------------------------------------------------------------------
// intuitFetch
// ---------------------------------------------------------------------------
function seqFetch(responses) {
  const f = async (url, init) => {
    f.urls.push(url);
    f.auth.push(init?.headers?.Authorization);
    const r = responses[Math.min(f.urls.length - 1, responses.length - 1)];
    if (r instanceof Error) throw r;
    return typeof r === "function" ? r() : r;
  };
  f.urls = [];
  f.auth = [];
  return f;
}
const ok = (body) => () => new Response(JSON.stringify(body), { status: 200 });
const status = (s, body = "", headers = {}) => () => new Response(body, { status: s, headers });

test("intuitFetch: retries 5xx with 1 s backoff, counts every attempt", async () => {
  const sleeps = [];
  const ctx = { ...Q.newCtx("tok"), fetch: seqFetch([status(503), ok({ a: 1 })]), sleep: async (ms) => { sleeps.push(ms); } };
  assert.deepEqual(await Q.intuitFetch(ctx, "https://x/q", "test"), { a: 1 });
  assert.equal(ctx.calls, 2);
  assert.deepEqual(sleeps, [1000]);
  assert.equal(ctx.fetch.auth[0], "Bearer tok");
});

test("intuitFetch: 429 honors Retry-After (capped at 10 s), then gives up after 3", async () => {
  const sleeps = [];
  const ctx = { ...Q.newCtx("tok"), fetch: seqFetch([status(429, "", { "retry-after": "5" }), status(429, "", { "retry-after": "60" }), status(429)]), sleep: async (ms) => { sleeps.push(ms); } };
  await assert.rejects(Q.intuitFetch(ctx, "https://x/q", "test"), (e) => e instanceof Q.IntuitError && e.status === 429);
  assert.equal(ctx.calls, 3);
  assert.deepEqual(sleeps, [5000, 10000]);
});

test("intuitFetch: 401 is final; network errors retry then fail as status 0", async () => {
  const ctx = { ...Q.newCtx("tok"), fetch: seqFetch([status(401, "secret body", { intuit_tid: "t9" })]), sleep: async () => {} };
  await assert.rejects(Q.intuitFetch(ctx, "https://x/q", "test"), (e) => e.status === 401 && e.tid === "t9" && !/secret/.test(e.message));
  assert.equal(ctx.calls, 1);
  const ctx2 = { ...Q.newCtx("tok"), fetch: seqFetch([new Error("ECONNRESET")]), sleep: async () => {} };
  await assert.rejects(Q.intuitFetch(ctx2, "https://x/q", "test"), (e) => e instanceof Q.IntuitError && e.status === 0);
  assert.equal(ctx2.calls, 3);
});

test("isTooLargeFault: Intuit's size faults only, not other 400s", () => {
  const fault = (Message, Detail = "", code = "") => JSON.stringify({ Fault: { Error: [{ Message, Detail, code }], type: "ValidationFault" } });
  assert.equal(Q.isTooLargeFault(fault("Report too large")), true);
  assert.equal(Q.isTooLargeFault(fault("Too many rows", "The report has too many rows to return")), true);
  assert.equal(Q.isTooLargeFault(fault("Request failed", "Number of cells exceeds the 400000 cell limit")), true);
  assert.equal(Q.isTooLargeFault("Response size exceeds the maximum allowed"), true); // non-JSON body
  for (const m of [
    fault("Invalid Date", "start_date exceeds end_date"),
    fault("maxresults exceeds limit", "maxresults must be 1000 or less"),
    fault("Invalid query", "Request has invalid or unsupported property"),
    fault("Business Validation Error", "The amount exceeds the maximum allowed"),
    fault("Missing required parameter", "Required param missing, need to supply the required value for the API"),
    "Bad Request: limit reached",
    "",
  ]) {
    assert.equal(Q.isTooLargeFault(m), false, m);
  }
  // A size word outside the Fault messages doesn't count when the body is JSON.
  assert.equal(Q.isTooLargeFault(JSON.stringify({ Fault: { Error: [{ Message: "Invalid Date" }] }, note: "too large" })), false);
});

test("intuitFetch: a 200 that isn't JSON fails without quoting the body", async () => {
  const ctx = { ...Q.newCtx("tok"), fetch: seqFetch([status(200, "<html>Payroll for Jane Doe 12,345.67")]), sleep: async () => {} };
  await assert.rejects(Q.intuitFetch(ctx, "https://x/r", "GL"), (e) => !/Jane|12,345|html/.test(e.message));
});

test("intuitFetch: a 400 'too large' is flagged only when sniffing, never retried", async () => {
  const body = '{"Fault":{"Error":[{"Message":"Report too large","Detail":"exceeds the maximum"}]}}';
  const ctx = { ...Q.newCtx("tok"), fetch: seqFetch([status(400, body)]), sleep: async () => {} };
  await assert.rejects(Q.intuitFetch(ctx, "https://x/r", "GL", { sniffTooLarge: true }), (e) => e.status === 400 && e.tooLarge === true);
  assert.equal(ctx.calls, 1);
  const ctx2 = { ...Q.newCtx("tok"), fetch: seqFetch([status(400, body)]), sleep: async () => {} };
  await assert.rejects(Q.intuitFetch(ctx2, "https://x/r", "GL"), (e) => e.status === 400 && e.tooLarge === false);
});

test("reportUrl / queryUrl / baseForEnv", () => {
  assert.equal(Q.baseForEnv("production"), Q.PROD_BASE);
  assert.equal(Q.baseForEnv("sandbox"), Q.SANDBOX_BASE);
  assert.equal(Q.baseForEnv(null), null);
  const u = new URL(Q.reportUrl(Q.PROD_BASE, "123", "GeneralLedger", { start_date: "2026-01-01", columns: "a,b" }));
  assert.equal(u.pathname, "/v3/company/123/reports/GeneralLedger");
  assert.equal(u.searchParams.get("columns"), "a,b");
  assert.equal(u.searchParams.get("minorversion"), Q.MINOR_VERSION);
  const q = new URL(Q.queryUrl(Q.SANDBOX_BASE, "123", "select * from Preferences"));
  assert.equal(q.pathname, "/v3/company/123/query");
  assert.equal(q.searchParams.get("query"), "select * from Preferences");
});

test("resolveApiBase: unknown env probes production then sandbox and writes it back", async () => {
  const admin = fakeAdmin();
  const ctx = { ...Q.newCtx("tok"), fetch: seqFetch([status(401), ok({ QueryResponse: { Preferences: [{}] } })]), sleep: async () => {} };
  const r = await Q.resolveApiBase(admin, ctx, CLIENT, null, (b) => Q.queryUrl(b, "1", "select * from Preferences"), "prefs");
  assert.equal(r.base, Q.SANDBOX_BASE);
  assert.ok(r.first.QueryResponse);
  assert.equal(ctx.calls, 2);
  assert.ok(admin.st.updates.some((p) => p.api_env === "sandbox"));
  // both refuse -> IntuitAuthError (the token is the problem)
  const ctx2 = { ...Q.newCtx("tok"), fetch: seqFetch([status(401), status(403)]), sleep: async () => {} };
  await assert.rejects(Q.resolveApiBase(admin, ctx2, CLIENT, undefined, (b) => b, "prefs"), Q.IntuitAuthError);
  // known env: one call, no probing
  const ctx3 = { ...Q.newCtx("tok"), fetch: seqFetch([ok({ x: 1 })]), sleep: async () => {} };
  const r3 = await Q.resolveApiBase(admin, ctx3, CLIENT, "production", (b) => b + "/q", "prefs");
  assert.equal(r3.base, Q.PROD_BASE);
  assert.equal(ctx3.fetch.urls[0], Q.PROD_BASE + "/q");
});

test("meterUsage: once, skips zero, never throws", async () => {
  const admin = fakeAdmin();
  await Q.meterUsage(admin, "gl_review", 0);
  await Q.meterUsage(admin, "gl_review", 7);
  assert.deepEqual(admin.st.usage, [["gl_review", 7]]);
  await Q.meterUsage({ rpc: async () => { throw new Error("down"); } }, "gl_review", 1);
});
