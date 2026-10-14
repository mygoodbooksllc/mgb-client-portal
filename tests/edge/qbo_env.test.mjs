// node --test tests/edge/*.test.mjs
// supabase/functions/_shared/qbo-env.ts: which Intuit app keys a QuickBooks
// connection uses (per-connection api_env), plus how ../_shared/qbo.ts
// ensureFreshToken picks them. All secret values here are fake.
import test from "node:test";
import assert from "node:assert/strict";
import * as E from "../../supabase/functions/_shared/qbo-env.ts";
import * as Q from "../../supabase/functions/_shared/qbo.ts";

// A getEnv over a plain object (stands in for Deno.env.get).
const envOf = (o) => (name) => (Object.prototype.hasOwnProperty.call(o, name) ? o[name] : undefined);

const PROD = { QBO_PRODUCTION_CLIENT_ID: "prod-id-VALUE", QBO_PRODUCTION_CLIENT_SECRET: "prod-secret-VALUE" };
const SBX = { QBO_SANDBOX_CLIENT_ID: "sbx-id-VALUE", QBO_SANDBOX_CLIENT_SECRET: "sbx-secret-VALUE" };
const LEGACY = { QBO_CLIENT_ID: "legacy-id-VALUE", QBO_CLIENT_SECRET: "legacy-secret-VALUE" };

// The error must name secrets, never carry a value.
function namesOnly(e, names) {
  assert.ok(e instanceof E.QboKeysMissingError, "QboKeysMissingError");
  assert.deepEqual(e.missing, names);
  assert.doesNotMatch(e.message, /VALUE/);
  for (const n of names) assert.match(e.message, new RegExp(n));
  return true;
}

// ---------------------------------------------------------------------------
// keysForEnv
// ---------------------------------------------------------------------------
test("sandbox: the new QBO_SANDBOX_* pair wins when both are set", () => {
  const k = E.keysForEnv("sandbox", envOf({ ...SBX, ...LEGACY, ...PROD }));
  assert.deepEqual(k, { env: "sandbox", clientId: "sbx-id-VALUE", clientSecret: "sbx-secret-VALUE", source: "sandbox-new" });
});

test("sandbox: falls back to the legacy QBO_CLIENT_ID/SECRET pair", () => {
  const k = E.keysForEnv("sandbox", envOf({ ...LEGACY, ...PROD }));
  assert.deepEqual(k, { env: "sandbox", clientId: "legacy-id-VALUE", clientSecret: "legacy-secret-VALUE", source: "sandbox-legacy" });
});

test("sandbox: half of the new pair is never mixed with the legacy pair", () => {
  assert.throws(() => E.keysForEnv("sandbox", envOf({ QBO_SANDBOX_CLIENT_ID: "sbx-id-VALUE", ...LEGACY })),
    (e) => namesOnly(e, ["QBO_SANDBOX_CLIENT_SECRET"]) && /both halves/.test(e.message));
  assert.throws(() => E.keysForEnv("sandbox", envOf({ QBO_SANDBOX_CLIENT_SECRET: "sbx-secret-VALUE", ...LEGACY })),
    (e) => namesOnly(e, ["QBO_SANDBOX_CLIENT_ID"]));
});

test("sandbox: half of the legacy pair is reported, not used", () => {
  assert.throws(() => E.keysForEnv("sandbox", envOf({ QBO_CLIENT_ID: "legacy-id-VALUE" })),
    (e) => namesOnly(e, ["QBO_CLIENT_SECRET"]));
});

test("sandbox: nothing set -> names the new pair and mentions the legacy one", () => {
  assert.throws(() => E.keysForEnv("sandbox", envOf({ ...PROD })),
    (e) => namesOnly(e, ["QBO_SANDBOX_CLIENT_ID", "QBO_SANDBOX_CLIENT_SECRET"]) && /QBO_CLIENT_ID \+ QBO_CLIENT_SECRET/.test(e.message));
});

test("production: uses QBO_PRODUCTION_* only", () => {
  const k = E.keysForEnv("production", envOf({ ...PROD, ...SBX, ...LEGACY }));
  assert.deepEqual(k, { env: "production", clientId: "prod-id-VALUE", clientSecret: "prod-secret-VALUE", source: "production" });
});

test("production: never falls back to the legacy (or sandbox) pair", () => {
  assert.throws(() => E.keysForEnv("production", envOf({ ...LEGACY, ...SBX })),
    (e) => namesOnly(e, ["QBO_PRODUCTION_CLIENT_ID", "QBO_PRODUCTION_CLIENT_SECRET"]) && e.env === "production");
  assert.throws(() => E.keysForEnv("production", envOf({ QBO_PRODUCTION_CLIENT_ID: "prod-id-VALUE", ...LEGACY })),
    (e) => namesOnly(e, ["QBO_PRODUCTION_CLIENT_SECRET"]));
});

test("blank / whitespace values count as missing; values are trimmed", () => {
  assert.throws(() => E.keysForEnv("production", envOf({ QBO_PRODUCTION_CLIENT_ID: "  ", QBO_PRODUCTION_CLIENT_SECRET: "" })),
    (e) => namesOnly(e, ["QBO_PRODUCTION_CLIENT_ID", "QBO_PRODUCTION_CLIENT_SECRET"]));
  const k = E.keysForEnv("production", envOf({ QBO_PRODUCTION_CLIENT_ID: " a ", QBO_PRODUCTION_CLIENT_SECRET: "b\n" }));
  assert.equal(k.clientId, "a");
  assert.equal(k.clientSecret, "b");
  // A blank new-sandbox half is "unset", so the legacy pair is used whole.
  const s = E.keysForEnv("sandbox", envOf({ QBO_SANDBOX_CLIENT_ID: " ", ...LEGACY }));
  assert.equal(s.source, "sandbox-legacy");
});

test("unknown environment throws (not a keys-missing error)", () => {
  assert.throws(() => E.keysForEnv("staging", envOf({ ...PROD, ...LEGACY })), (e) => !(e instanceof E.QboKeysMissingError));
});

// ---------------------------------------------------------------------------
// Stored env (state / connection rows)
// ---------------------------------------------------------------------------
test("stored api_env: NULL / missing -> sandbox (legacy keys); strict values pass; junk throws", () => {
  assert.equal(E.normalizeStoredEnv(null), "sandbox");
  assert.equal(E.normalizeStoredEnv(undefined), "sandbox");
  assert.equal(E.normalizeStoredEnv("production"), "production");
  assert.equal(E.normalizeStoredEnv("sandbox"), "sandbox");
  assert.throws(() => E.normalizeStoredEnv("Production"));
  assert.throws(() => E.normalizeStoredEnv(""));
  assert.equal(E.keysForStoredEnv(null, envOf({ ...LEGACY, ...PROD })).source, "sandbox-legacy");
  assert.equal(E.keysForStoredEnv("production", envOf({ ...LEGACY, ...PROD })).source, "production");
});

test("parseEnvStrict: only the two exact words", () => {
  assert.equal(E.parseEnvStrict("sandbox"), "sandbox");
  assert.equal(E.parseEnvStrict("production"), "production");
  for (const x of [null, undefined, "", "prod", "SANDBOX", 1, {}]) assert.equal(E.parseEnvStrict(x), null);
});

// ---------------------------------------------------------------------------
// The rule
// ---------------------------------------------------------------------------
test("envForClient: test_only true -> sandbox, false/null -> production; firm -> production", () => {
  assert.equal(E.envForClient(true), "sandbox");
  assert.equal(E.envForClient(false), "production");
  assert.equal(E.envForClient(null), "production");
  assert.equal(E.envForClient(undefined), "production");
  assert.equal(E.FIRM_ENV, "production");
});

// ---------------------------------------------------------------------------
// Redirect URI + authorize URL
// ---------------------------------------------------------------------------
test("qboRedirectUri: same string as before; trailing slash dropped; bad input throws", () => {
  assert.equal(E.qboRedirectUri("https://xumsqmhccgfjnlmieqyu.supabase.co"), "https://xumsqmhccgfjnlmieqyu.supabase.co/functions/v1/qbo-callback");
  assert.equal(E.qboRedirectUri("https://x.supabase.co/"), "https://x.supabase.co/functions/v1/qbo-callback");
  assert.equal(E.qboRedirectUri("http://127.0.0.1:54321"), "http://127.0.0.1:54321/functions/v1/qbo-callback");
  for (const bad of [undefined, null, "", "x.supabase.co", "https://x.supabase.co/path", "https://x.supabase.co?q=1", "javascript:alert(1)"]) {
    assert.throws(() => E.qboRedirectUri(bad));
  }
});

test("authorizeUrl: Intuit host, encoded params, the redirect URI the callback exchanges with", () => {
  const redirect = E.qboRedirectUri("https://x.supabase.co");
  const u = new URL(E.authorizeUrl("cid&x=1", redirect, "a".repeat(64)));
  assert.equal(u.origin + u.pathname, "https://appcenter.intuit.com/connect/oauth2");
  assert.equal(u.searchParams.get("client_id"), "cid&x=1");
  assert.equal(u.searchParams.get("response_type"), "code");
  assert.equal(u.searchParams.get("scope"), "com.intuit.quickbooks.accounting");
  assert.equal(u.searchParams.get("redirect_uri"), redirect);
  assert.equal(u.searchParams.get("state"), "a".repeat(64));
  assert.equal(u.searchParams.get("x"), null);
});

// ---------------------------------------------------------------------------
// Ref sanitizer (intuit_tid echoed as ?ref=)
// ---------------------------------------------------------------------------
test("sanitizeIntuitTid: letters, digits, dashes, 8-64 chars; anything else dropped", () => {
  assert.equal(E.sanitizeIntuitTid("1-6543abcd-0123456789abcdef"), "1-6543abcd-0123456789abcdef");
  assert.equal(E.sanitizeIntuitTid("abcdefgh"), "abcdefgh");
  assert.equal(E.sanitizeIntuitTid("a".repeat(64)), "a".repeat(64));
  for (const bad of [null, undefined, "", "short", "a".repeat(65), "abc def ghi", "<script>x</script>", "abcdefgh\n", "abcdefgh&status=connected", "abc_defgh", 12345678]) {
    assert.equal(E.sanitizeIntuitTid(bad), null, String(bad));
  }
});

// ---------------------------------------------------------------------------
// ensureFreshToken picks keys from the connection's api_env
// ---------------------------------------------------------------------------
function fakeAdmin(init = {}) {
  const st = { apiEnv: null, selects: 0, takes: 0, updates: [], selectError: null, ...init };
  return {
    st,
    from(table) {
      assert.equal(table, "qbo_connections");
      return {
        select(cols) {
          assert.equal(cols, "api_env");
          const chain = {
            eq() { return chain; },
            maybeSingle() {
              st.selects++;
              if (st.selectError) return Promise.resolve({ data: null, error: { message: st.selectError } });
              return Promise.resolve({ data: { api_env: st.apiEnv }, error: null });
            },
          };
          return chain;
        },
        update(patch) {
          const chain = {
            eq() { return chain; },
            or() { return chain; },
            select() {
              st.takes++;
              return Promise.resolve({ data: [{ client_id: "c1" }], error: null });
            },
            then(res, rej) {
              st.updates.push(patch);
              return Promise.resolve({ data: null, error: null }).then(res, rej);
            },
          };
          return chain;
        },
      };
    },
    async rpc(name, args) {
      if (name === "qbo_get_tokens") {
        return { data: [{ access_token: "old", refresh_token: "old-refresh", expires_at: new Date(Date.now() - 1000).toISOString() }], error: null };
      }
      if (name === "qbo_store_tokens") return { data: null, error: null };
      throw new Error("unexpected rpc " + name);
    },
  };
}

function recordingFetch() {
  const f = async (_url, init) => {
    f.auth.push(init.headers.Authorization);
    return new Response(JSON.stringify({ access_token: "new", refresh_token: "new-refresh", expires_in: 3600 }), { status: 200 });
  };
  f.auth = [];
  return f;
}
const basic = (id, secret) => `Basic ${btoa(`${id}:${secret}`)}`;
const tdeps = (extra) => ({ encKey: "k", logTag: "test", sleep: async () => {}, ...extra });

test("refresh: api_env 'production' (passed in) uses the production keys, no lookup", async () => {
  const admin = fakeAdmin();
  const f = recordingFetch();
  await Q.ensureFreshToken(admin, "c1", tdeps({ fetch: f, apiEnv: "production", getEnv: envOf({ ...PROD, ...LEGACY }) }));
  assert.deepEqual(f.auth, [basic("prod-id-VALUE", "prod-secret-VALUE")]);
  assert.equal(admin.st.selects, 0);
});

test("refresh: api_env NULL (legacy row) uses the legacy pair", async () => {
  const admin = fakeAdmin();
  const f = recordingFetch();
  await Q.ensureFreshToken(admin, "c1", tdeps({ fetch: f, apiEnv: null, getEnv: envOf({ ...PROD, ...LEGACY }) }));
  assert.deepEqual(f.auth, [basic("legacy-id-VALUE", "legacy-secret-VALUE")]);
});

test("refresh: api_env not passed -> read from qbo_connections", async () => {
  const admin = fakeAdmin({ apiEnv: "production" });
  const f = recordingFetch();
  await Q.ensureFreshToken(admin, "c1", tdeps({ fetch: f, getEnv: envOf({ ...PROD, ...LEGACY }) }));
  assert.equal(admin.st.selects, 1);
  assert.deepEqual(f.auth, [basic("prod-id-VALUE", "prod-secret-VALUE")]);
});

test("refresh: the api_env lookup failing throws before the lock and Intuit", async () => {
  const admin = fakeAdmin({ selectError: "boom" });
  const f = recordingFetch();
  await assert.rejects(Q.ensureFreshToken(admin, "c1", tdeps({ fetch: f, getEnv: envOf({ ...PROD, ...LEGACY }) })), /environment/);
  assert.equal(admin.st.takes, 0);
  assert.equal(f.auth.length, 0);
});

test("refresh: production keys missing -> QboKeysMissingError before the lock; Intuit never called", async () => {
  const admin = fakeAdmin();
  const f = recordingFetch();
  await assert.rejects(
    Q.ensureFreshToken(admin, "c1", tdeps({ fetch: f, apiEnv: "production", getEnv: envOf({ ...LEGACY }) })),
    (e) => e instanceof Q.QboKeysMissingError && namesOnly(e, ["QBO_PRODUCTION_CLIENT_ID", "QBO_PRODUCTION_CLIENT_SECRET"]),
  );
  assert.equal(admin.st.takes, 0);
  assert.equal(f.auth.length, 0);
});

test("refresh: a fresh token never needs keys (missing keys don't break a fresh connection)", async () => {
  const admin = fakeAdmin();
  admin.rpc = async (name) => {
    assert.equal(name, "qbo_get_tokens");
    return { data: [{ access_token: "still-good", refresh_token: "r", expires_at: new Date(Date.now() + 3600e3).toISOString() }], error: null };
  };
  const f = recordingFetch();
  const r = await Q.ensureFreshToken(admin, "c1", tdeps({ fetch: f, apiEnv: "production", getEnv: envOf({}) }));
  assert.equal(r.accessToken, "still-good");
  assert.equal(f.auth.length, 0);
});

test("flagKeysMissing: last_error has names only, status untouched, never throws", async () => {
  const admin = fakeAdmin();
  const e = new E.QboKeysMissingError("production", ["QBO_PRODUCTION_CLIENT_ID"]);
  await Q.flagKeysMissing(admin, "c1", e, "test");
  assert.equal(admin.st.updates.length, 1);
  const patch = admin.st.updates[0];
  assert.ok(!("status" in patch));
  assert.match(patch.last_error, /QBO_PRODUCTION_CLIENT_ID/);
  assert.match(patch.last_error, /Ask an admin/);
  const broken = { from() { throw new Error("db down"); } };
  await Q.flagKeysMissing(broken, "c1", e, "test"); // does not throw
});
