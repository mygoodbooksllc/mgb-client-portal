// tk-request-respond (public answer link) pure checks:
// supabase/functions/tk-request-respond/logic.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import * as L from "../../supabase/functions/tk-request-respond/logic.ts";

const MB = 1024 * 1024;

test("precheck refuses wrong methods and unknown actions before anything else", () => {
  assert.equal(L.precheck({ method: "GET", action: "view" }).error, "bad_request");
  assert.equal(L.precheck({ method: "POST", action: "list" }).error, "bad_request");
  assert.equal(L.precheck({ method: "POST", action: "" }).error, "bad_request");
  assert.deepEqual(L.precheck({ method: "POST", action: "view", contentLength: "0" }), {});
  assert.deepEqual(L.precheck({ method: "POST", action: "stop_nudges" }), {});
});

test("M8: an upload's size and type are judged from headers, before the body", () => {
  const up = (o) => L.precheck({ method: "POST", action: "upload", ...o });
  assert.equal(up({ contentLength: null, filename: "a.pdf", contentType: "application/pdf" }).error, "bad_request"); // must say its size
  assert.equal(up({ contentLength: "0", filename: "a.pdf", contentType: "application/pdf" }).error, "bad_request");
  assert.equal(up({ contentLength: String(125 * MB), filename: "a.pdf", contentType: "application/pdf" }).error, "too_large");
  assert.equal(up({ contentLength: String(25 * MB + 1), filename: "a.pdf", contentType: "application/pdf" }).error, "too_large");
  assert.equal(up({ contentLength: "100", filename: "run.exe", contentType: "application/octet-stream" }).error, "bad_type");
  assert.equal(up({ contentLength: "100", filename: null, contentType: "application/pdf" }).error, "bad_request");
  const ok = up({ contentLength: String(25 * MB), filename: encodeURIComponent("2025 W-9 (signed).pdf"), contentType: "application/pdf" });
  assert.equal(ok.error, undefined);
  assert.equal(ok.mime, "application/pdf");
  assert.equal(ok.name, "2025 W-9 (signed).pdf");
  assert.equal(ok.length, 25 * MB);
  // extension wins when the browser sends no type
  assert.equal(up({ contentLength: "9", filename: "bank.csv", contentType: "" }).mime, "text/csv");
});

test("JSON actions are capped at 32 KB and answer must be JSON", () => {
  assert.equal(L.precheck({ method: "POST", action: "answer", contentLength: String(33 * 1024), contentType: "application/json" }).error, "too_large");
  assert.equal(L.precheck({ method: "POST", action: "answer", contentLength: "20", contentType: "text/plain" }).error, "bad_request");
  assert.deepEqual(L.precheck({ method: "POST", action: "answer", contentLength: "20", contentType: "application/json; charset=utf-8" }), {});
});

test("file names are cleaned: no paths, no control characters, 255 max", () => {
  assert.equal(L.cleanFilename(encodeURIComponent("../../etc/passwd")), ".._.._etc_passwd");
  assert.equal(L.cleanFilename(encodeURIComponent("a\u0000b\nc.pdf")), "abc.pdf");
  assert.equal(L.cleanFilename("%E0%A4%A"), null); // bad encoding
  assert.equal(L.cleanFilename(".."), null);
  assert.equal(L.cleanFilename(encodeURIComponent("x".repeat(400) + ".pdf")).length, 255);
});

test("answer bodies: reply <= 4000, at most 5 staged file ids, nothing else", () => {
  const id = "0b0f1c2e-1111-4222-8333-944455556666";
  assert.deepEqual(L.parseAnswer({ reply: "  Here you go  " }), { reply: "Here you go", fileIds: [] });
  assert.deepEqual(L.parseAnswer({ reply: "", file_ids: [id, id] }), { reply: null, fileIds: [id] });
  assert.equal(L.parseAnswer({ reply: "x".repeat(4001) }), null);
  assert.equal(L.parseAnswer({ file_ids: Array(6).fill(id) }), null);
  assert.equal(L.parseAnswer({ file_ids: ["not-a-uuid"] }), null);
  assert.equal(L.parseAnswer({ reply: "hi", token: "x" }), null); // no token in the body
  assert.equal(L.parseAnswer(null), null);
  assert.equal(L.parseAnswer([1]), null);
});

test("view exposes only the fixed C6 field list", () => {
  const v = L.viewPayload({
    title: "W-9", prompt: "Please send", kind: "document", needs_upload: true, due_date: "2026-10-30", status: "open",
    asked_on: "2026-10-16", asked_by_first_name: "Jesse", client_display_name: "Grace Community", expires_on: "2026-10-30",
    // must never leak:
    client_id: "grace-community", recipient_email: "a@example.invalid", task_id: "t", token_id: "x", asked_by: "jesse@x",
  });
  assert.deepEqual(Object.keys(v).sort(), [
    "asked_by_first_name", "asked_on", "client_display_name", "due_date", "expires_on", "kind", "limits", "needs_upload",
    "prompt", "status", "title",
  ]);
  assert.equal(v.limits.max_files, 5);
  assert.equal(v.limits.max_mb, 25);
  assert.ok(v.limits.types.includes("pdf"));
});

test("error codes: only known codes reach the browser, the rest are 'invalid'", () => {
  assert.equal(L.errorCode("ok"), null);
  for (const c of ["expired", "revoked", "answered_already", "cancelled"]) assert.equal(L.statusFor(L.errorCode(c)), 410);
  assert.equal(L.statusFor(L.errorCode("rate_limited")), 429);
  assert.equal(L.errorCode("tk_not_found"), "invalid");
  assert.equal(L.errorCode(undefined), "invalid");
  assert.equal(L.statusFor("invalid"), 404);
  assert.equal(L.statusFor("too_large"), 413);
  assert.equal(L.statusFor("bad_type"), 415);
  assert.ok(L.isBadToken("invalid") && L.isBadToken("expired"));
  assert.ok(!L.isBadToken("revoked") && !L.isBadToken("answered_already"));
});

test("CORS: the app origin only", () => {
  assert.equal(L.corsHeaders("https://app.mygoodbooks.org")["Access-Control-Allow-Origin"], "https://app.mygoodbooks.org");
  assert.equal(L.corsHeaders("https://evil.example")["Access-Control-Allow-Origin"], undefined);
  assert.equal(L.corsHeaders(null)["Access-Control-Allow-Origin"], undefined);
  assert.match(L.corsHeaders(null)["Access-Control-Allow-Headers"], /x-mgb-token/);
  assert.equal(L.SECURITY_HEADERS["Cache-Control"], "no-store");
});

test("IP: cf-connecting-ip, then x-real-ip, then the right-most forwarded hop", () => {
  const h = (o) => (n) => o[n] ?? null;
  assert.equal(L.clientIp(h({ "cf-connecting-ip": "1.2.3.4", "x-real-ip": "5.6.7.8" })), "1.2.3.4");
  assert.equal(L.clientIp(h({ "x-real-ip": "5.6.7.8", "x-forwarded-for": "9.9.9.9" })), "5.6.7.8");
  assert.equal(L.clientIp(h({ "x-forwarded-for": "6.6.6.6, 10.0.0.1, 8.8.4.4" })), "8.8.4.4");
  assert.equal(L.clientIp(h({})), "unknown");
});

test("ip_hash is per /24 or /48 and per day, never the raw address", async () => {
  assert.equal(L.ipPrefix("203.0.113.77"), "203.0.113.0/24");
  assert.equal(L.ipPrefix("::ffff:203.0.113.9"), "203.0.113.0/24");
  assert.equal(L.ipPrefix("2001:db8:abcd:12::1"), "2001:db8:abcd::/48");
  assert.equal(L.ipPrefix("2001:db8::1"), "2001:db8:0::/48");
  const a = await L.ipHash("203.0.113.5", "2026-10-16");
  assert.equal(a, await L.ipHash("203.0.113.200", "2026-10-16"));
  assert.notEqual(a, await L.ipHash("203.0.113.5", "2026-10-17"));
  assert.notEqual(a, await L.ipHash("203.0.114.5", "2026-10-16"));
  assert.match(a, /^[0-9a-f]{32}$/);
  assert.ok(!a.includes("203"));
});

test("readCapped stops reading once a body runs over the cap", async () => {
  let pulled = 0;
  const stream = new ReadableStream({
    pull(c) {
      pulled++;
      if (pulled > 100) return c.close();
      c.enqueue(new Uint8Array(1024));
    },
  });
  assert.equal(await L.readCapped(stream, 4096), null);
  assert.ok(pulled < 10, `read ${pulled} chunks`);
  const small = new ReadableStream({ start(c) { c.enqueue(new Uint8Array([1, 2])); c.enqueue(new Uint8Array([3])); c.close(); } });
  assert.deepEqual([...(await L.readCapped(small, 3))], [1, 2, 3]);
  assert.equal((await L.readCapped(null, 3)).byteLength, 0);
});

test("refusals are padded to the same minimum time", () => {
  assert.equal(L.delayFor(1000, 1000), L.MIN_ERROR_MS);
  assert.equal(L.delayFor(1000, 1100), L.MIN_ERROR_MS - 100);
  assert.equal(L.delayFor(1000, 5000), 0);
});

test("rate limits match the spec table", () => {
  assert.deepEqual(L.LIMITS.ip, { window: 600, max: 30 });
  assert.deepEqual(L.LIMITS.ipbad, { window: 900, max: 10 });
  assert.deepEqual(L.LIMITS.tokview, { window: 3600, max: 20 });
  assert.deepEqual(L.LIMITS.global, { window: 3600, max: 600 });
});

test("the endpoint source never logs or echoes the token", async () => {
  const { readFile } = await import("node:fs/promises");
  const src = await readFile(new URL("../../supabase/functions/tk-request-respond/index.ts", import.meta.url), "utf8");
  for (const line of src.split("\n").filter((l) => /console\.(log|error|warn)/.test(l))) {
    assert.ok(!/token|hash|headers/i.test(line.replace(/tk-request-respond/g, "")), `logs something sensitive: ${line.trim()}`);
  }
  assert.ok(!/searchParams\.get\("t(oken)?"\)/.test(src), "token must not come from the URL");
  assert.ok(/x-mgb-token/.test(src));
});

// ---------------------------------------------------------------------------
// Rate limits and the global breaker (S6 review MAJOR 1)
// ---------------------------------------------------------------------------
// In-memory twin of tk_rate_hit / tk_rate_peek (one window, no expiry).
function memRate() {
  const counts = new Map();
  const logs = [];
  return {
    counts,
    logs,
    hit: async (k, l) => {
      const n = (counts.get(k) || 0) + 1;
      counts.set(k, n);
      return n <= l.max;
    },
    peek: async (k, l) => (counts.get(k) || 0) < l.max,
    log: async (event, detail) => {
      logs.push({ event, ...detail });
    },
  };
}
const GOOD = "A".repeat(43);
const UNKNOWN = "B".repeat(43);
function fakeDb() {
  const calls = { lookup: 0, dummy: 0 };
  return {
    calls,
    lookup: async (t) => {
      calls.lookup++;
      return t === GOOD ? { code: null, data: { token_id: "t1" } } : { code: "invalid", data: {} };
    },
    dummy: async () => {
      calls.dummy++;
    },
  };
}

test("lockout scenario: 700 junk tokens from 70 networks never lock out a real link", async () => {
  const r = memRate();
  const db = fakeDb();
  for (let net = 0; net < 70; net++) {
    for (let i = 0; i < 10; i++) {
      const tok = i % 2 ? UNKNOWN : "junk";
      const out = await L.resolveToken(r, `net${net}`, tok, db.lookup, db.dummy);
      assert.equal(out.error, "invalid");
    }
  }
  assert.ok(r.counts.get("global") >= L.LIMITS.global.max, "the breaker is open");
  // A client on a fresh network still gets in, while the breaker is open.
  const ok = await L.resolveToken(r, "client-net", GOOD, db.lookup, db.dummy);
  assert.equal(ok.error, undefined);
  assert.deepEqual(ok.data, { token_id: "t1" });
  // ...and a junk token from that same fresh network is still just "invalid".
  assert.equal((await L.resolveToken(r, "other-net", "junk", db.lookup, db.dummy)).error, "invalid");
});

test("the breaker opens once: one log line, then over-limit hits stop counting", async () => {
  const r = memRate();
  const db = fakeDb();
  for (let i = 0; i < L.LIMITS.global.max + 50; i++) {
    await L.resolveToken(r, `n${Math.floor(i / 5)}`, UNKNOWN, db.lookup, db.dummy);
  }
  assert.equal(r.logs.filter((x) => x.scope === "global").length, 1);
  assert.equal(r.counts.get("global"), L.LIMITS.global.max);
});

test("malformed tokens skip the database once the breaker is open; well-formed ones are always looked up", async () => {
  const r = memRate();
  const db = fakeDb();
  await L.resolveToken(r, "n0", "junk", db.lookup, db.dummy);
  assert.equal(db.calls.dummy, 1);
  r.counts.set("global", L.LIMITS.global.max + 1);
  await L.resolveToken(r, "n1", "junk", db.lookup, db.dummy);
  assert.equal(db.calls.dummy, 1, "shed without a database call");
  const before = db.calls.lookup;
  await L.resolveToken(r, "n2", GOOD, db.lookup, db.dummy);
  assert.equal(db.calls.lookup, before + 1);
});

test("per-network limits still hold: 10 bad tokens lock that /24 out, even with a good token", async () => {
  const r = memRate();
  const db = fakeDb();
  for (let i = 0; i < L.LIMITS.ipbad.max; i++) {
    assert.equal((await L.resolveToken(r, "evil", UNKNOWN, db.lookup, db.dummy)).error, "invalid");
  }
  assert.equal((await L.resolveToken(r, "evil", GOOD, db.lookup, db.dummy)).error, "rate_limited");
  // Another network is unaffected.
  assert.equal((await L.resolveToken(r, "fine", GOOD, db.lookup, db.dummy)).error, undefined);
});

test("per-network call limit: the 31st call in the window is refused before the token is read", async () => {
  const r = memRate();
  const db = fakeDb();
  for (let i = 0; i < L.LIMITS.ip.max; i++) {
    assert.equal((await L.resolveToken(r, "busy", GOOD, db.lookup, db.dummy)).error, undefined);
  }
  const n = db.calls.lookup;
  assert.equal((await L.resolveToken(r, "busy", GOOD, db.lookup, db.dummy)).error, "rate_limited");
  assert.equal(db.calls.lookup, n, "no lookup after the network limit");
  assert.deepEqual(r.logs.at(-1), { event: "rate_limited", scope: "ip" });
});

test("expired counts per network but not globally; closed-link data rides along", async () => {
  const r = memRate();
  const out = await L.resolveToken(r, "n", GOOD, async () => ({ code: "expired", data: { view: { asked_by_first_name: "Jo" } } }), async () => {});
  assert.equal(out.error, "expired");
  assert.equal(out.data.view.asked_by_first_name, "Jo");
  assert.equal(r.counts.get("ipbad:n"), 1);
  assert.equal(r.counts.get("global"), undefined);
  // Non-token refusals (e.g. reply_required) are not counted at all.
  assert.equal(await L.onBadToken(r, "n", "reply_required"), "reply_required");
  assert.equal(r.counts.get("ipbad:n"), 1);
});
