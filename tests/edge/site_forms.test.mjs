// node --test tests/edge/site_forms.test.mjs
// site-forms (public marketing-site intake): supabase/functions/site-forms/logic.ts,
// handler run end to end with a fake store and a fake sendEmail.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as S from "../../supabase/functions/site-forms/logic.ts";

const SITE = "https://mygoodbooks.org";
const NOW = new Date("2026-11-03T15:00:00Z");
const good = (fields = {}, extra = {}) => ({
  form: "clarity-review",
  page: "/clarity",
  fields: { name: "Pat Treasurer", email: "pat@church.org", org: "Grace Church", org_type: "Church or ministry", role: "Treasurer / Board", budget: "$250k – $1M", ...fields },
  ...extra,
});

function fakes(o = {}) {
  const calls = { inserts: [], marks: [], sends: [], logs: [] };
  const store = {
    recentTimes: async () => {
      if (o.recentThrows) throw new Error("db down");
      return o.times || [];
    },
    insert: async (row) => {
      if (o.insertThrows) throw new Error("insert boom secret-detail");
      calls.inserts.push(row);
      return { id: "11111111-2222-3333-4444-555555555555", created_at: NOW.toISOString() };
    },
    recipients: async () => {
      if (o.recipientsThrow) throw new Error("no read");
      return o.recipients ?? ["holden@mygoodbooks.org", "admin@mygoodbooks.org"];
    },
    markEmail: async (id, sent, error) => calls.marks.push({ id, sent, error }),
  };
  const deps = {
    store,
    sendEmail: async (input) => {
      calls.sends.push(input);
      if (o.sendThrows) throw new Error("network");
      return o.sendResult || { ok: true, id: "re_1" };
    },
    emailConfigured: () => o.configured ?? true,
    salt: "test-salt",
    now: () => NOW,
    log: (m, d) => calls.logs.push({ m, d }),
  };
  return { deps, calls };
}

function req(body, { method = "POST", origin = SITE, type = "application/json", headers = {} } = {}) {
  const h = { ...headers };
  if (origin) h.Origin = origin;
  if (type) h["Content-Type"] = type;
  h["x-forwarded-for"] = h["x-forwarded-for"] || "203.0.113.7";
  const init = { method, headers: h };
  if (method !== "GET" && method !== "OPTIONS" && body !== undefined) init.body = typeof body === "string" ? body : JSON.stringify(body);
  return new Request("https://x.supabase.co/functions/v1/site-forms", init);
}
async function run(r, o) {
  const f = fakes(o);
  const res = await S.handle(r, f.deps);
  const text = res.status === 204 ? "" : await res.text();
  return { res, body: text ? JSON.parse(text) : null, ...f.calls };
}

test("the site's form name is allowed, plus contact; others are refused", async () => {
  const src = readFileSync(new URL("../../supabase/functions/site-forms/logic.ts", import.meta.url), "utf8");
  assert.match(src, /"clarity-review": "Clarity Review request"/);
  assert.deepEqual(Object.keys(S.FORMS).sort(), ["clarity-review", "contact"]);
  const r = await run(req(good({}, { form: "newsletter" })));
  assert.equal(r.res.status, 400);
  assert.equal(r.inserts.length, 0);
  assert.equal((await run(req(good({}, { form: "contact" })))).res.status, 200);
});

test("CORS: preflight echoes only allow-listed origins", async () => {
  for (const o of S.ALLOWED_ORIGINS) {
    const r = await run(req(undefined, { method: "OPTIONS", origin: o }));
    assert.equal(r.res.status, 204);
    assert.equal(r.res.headers.get("access-control-allow-origin"), o);
  }
  const bad = await run(req(undefined, { method: "OPTIONS", origin: "https://evil.example" }));
  assert.equal(bad.res.headers.get("access-control-allow-origin"), null);
  assert.equal(bad.res.headers.get("vary"), "Origin");
});

test("bad origin is refused and stores nothing; no Origin (curl) is allowed", async () => {
  const r = await run(req(good(), { origin: "https://evil.example" }));
  assert.equal(r.res.status, 403);
  assert.equal(r.inserts.length, 0);
  assert.equal(r.res.headers.get("access-control-allow-origin"), null);
  const curl = await run(req(good(), { origin: null }));
  assert.equal(curl.res.status, 200);
  assert.equal(curl.inserts.length, 1);
});

test("method, content type, size and JSON checks", async () => {
  assert.equal((await run(req(undefined, { method: "GET" }))).res.status, 405);
  assert.equal((await run(req(good(), { method: "PUT" }))).res.status, 405);
  assert.equal((await run(req("form=x", { type: "application/x-www-form-urlencoded" }))).res.status, 415);
  assert.equal((await run(req("{not json"))).res.status, 400);
  assert.equal((await run(req("[]"))).res.status, 400);
  const big = good({ message: "x".repeat(11 * 1024) });
  const r = await run(req(big));
  assert.equal(r.res.status, 413);
  assert.equal(r.inserts.length, 0);
  // A declared Content-Length over 10 KB is refused before the body is read.
  const declared = {
    method: "POST",
    headers: new Headers({ Origin: SITE, "Content-Type": "application/json", "Content-Length": "20000" }),
    get body() { throw new Error("body was read"); },
  };
  assert.equal((await run(declared)).res.status, 413);
  // No Content-Length (chunked): the capped read catches it.
  const chunked = {
    method: "POST",
    headers: new Headers({ Origin: SITE, "Content-Type": "application/json" }),
    body: new Blob([JSON.stringify(big)]).stream(),
  };
  assert.equal((await run(chunked)).res.status, 413);
});

test("fields: object of strings, at most 20 keys, values cut to 2000", async () => {
  assert.equal((await run(req({ form: "clarity-review", fields: ["a"] }))).res.status, 400);
  assert.equal((await run(req(good({ budget: 5 })))).res.status, 400);
  assert.equal((await run(req(good({ "bad key!": "x" })))).res.status, 400);
  const many = {};
  for (let i = 0; i < 19; i++) many[`f${i}`] = "x";
  assert.equal((await run(req(good(many)))).res.status, 400); // 6 + 19 > 20
  const p = S.parseSubmission(good({ message: "y".repeat(2500) + "\u0000" }));
  assert.equal(p.ok, true);
  assert.equal(p.sub.fields.message.length, 2000);
  assert.ok(!JSON.stringify(p.sub).includes("\\u0000"));
});

test("name and email are required and checked", async () => {
  for (const f of [{ name: "" }, { name: "   " }, { name: "12345" }, { name: "Visit http://spam.example" }, { name: "x".repeat(121) }]) {
    assert.equal((await run(req(good(f)))).body.error, "bad_name", JSON.stringify(f));
  }
  for (const f of [{ email: "" }, { email: "pat" }, { email: "pat@church" }, { email: "a b@c.org" }, { email: "a@b.org\r\nBcc: x@y.org" }, { email: `${"a".repeat(250)}@b.org` }]) {
    assert.equal((await run(req(good(f)))).body.error, "bad_email", JSON.stringify(f));
  }
  assert.equal(S.plausibleName("José O'Neil-Smith"), true);
  assert.equal(S.validEmail("first.last+tag@sub.church.org"), true);
});

test("honeypot: filled -> 200, nothing stored or sent; empty -> dropped from fields", async () => {
  const r = await run(req(good({ website: "http://bot.example" })));
  assert.equal(r.res.status, 200);
  assert.deepEqual(r.body, { ok: true });
  assert.equal(r.inserts.length, 0);
  assert.equal(r.sends.length, 0);
  // even when the rest is junk
  const junk = await run(req({ form: "clarity-review", fields: { website: "x", name: "" } }));
  assert.equal(junk.res.status, 200);
  assert.equal(junk.inserts.length, 0);
  const ok = await run(req(good({ website: "" })));
  assert.equal(ok.inserts.length, 1);
  assert.ok(!("website" in ok.inserts[0].fields));
});

test("rate limit: 5 per hour, 20 per day, from the caller's recent rows", async () => {
  const ago = (min) => new Date(NOW.getTime() - min * 60000).toISOString();
  assert.equal(S.underLimit([ago(1), ago(2), ago(3), ago(4)], NOW), true);
  assert.equal(S.underLimit([ago(1), ago(2), ago(3), ago(4), ago(59)], NOW), false);
  assert.equal(S.underLimit([ago(1), ago(2), ago(3), ago(4), ago(61)], NOW), true);
  const day = Array.from({ length: 20 }, (_, i) => ago(70 + i * 60));
  assert.equal(S.underLimit(day.slice(0, 19), NOW), true);
  assert.equal(S.underLimit(day, NOW), false);
  assert.equal(S.underLimit(Array.from({ length: 30 }, () => ago(60 * 25)), NOW), true); // older than a day
  const r = await run(req(good()), { times: [ago(1), ago(2), ago(3), ago(4), ago(5)] });
  assert.equal(r.res.status, 429);
  assert.equal(r.inserts.length, 0);
  assert.equal(r.sends.length, 0);
  // a failed rate check does not lose the lead
  const down = await run(req(good()), { recentThrows: true });
  assert.equal(down.res.status, 200);
  assert.equal(down.inserts.length, 1);
});

test("ip is stored only as a salted sha-256", async () => {
  const r = await run(req(good()));
  const row = r.inserts[0];
  assert.match(row.ip_hash, /^[0-9a-f]{64}$/);
  assert.equal(row.ip_hash, await S.ipHash("203.0.113.7", "test-salt"));
  assert.notEqual(row.ip_hash, await S.ipHash("203.0.113.7", "other-salt"));
  assert.ok(!JSON.stringify(row).includes("203.0.113.7"));
  assert.equal(S.clientIp((n) => ({ "x-forwarded-for": "1.1.1.1, 2.2.2.2" })[n] ?? null), "2.2.2.2");
  assert.equal(S.clientIp((n) => ({ "cf-connecting-ip": "9.9.9.9", "x-forwarded-for": "1.1.1.1" })[n] ?? null), "9.9.9.9");
});

test("accepted: row saved, email to active recipients with reply-to and tag", async () => {
  const r = await run(req(good({ message: "Line one\nLine <two>" })));
  assert.equal(r.res.status, 200);
  assert.deepEqual(r.body, { ok: true });
  assert.equal(r.res.headers.get("access-control-allow-origin"), SITE);
  const row = r.inserts[0];
  assert.equal(row.form, "clarity-review");
  assert.equal(row.page, "/clarity");
  assert.equal(row.name, "Pat Treasurer");
  assert.equal(row.email, "pat@church.org");
  assert.equal(row.fields.org, "Grace Church");
  const m = r.sends[0];
  assert.deepEqual(m.to, ["holden@mygoodbooks.org", "admin@mygoodbooks.org"]);
  assert.equal(m.replyTo, "pat@church.org");
  assert.deepEqual(m.tags, [{ name: "type", value: "site-form" }]);
  assert.equal(m.subject, "New Clarity Review request: Pat Treasurer");
  assert.match(m.text, /Saved in the portal \(site_form_submissions\), id 11111111-2222-3333-4444-555555555555/);
  assert.match(m.text, /Organization: Grace Church/);
  assert.match(m.text, /Annual budget or revenue: \$250k – \$1M/);
  assert.match(m.text, /Page: \/clarity/);
  assert.match(m.html, /Line one<br>Line &lt;two&gt;/);
  assert.ok(!m.html.includes("<two>"));
  assert.deepEqual(r.marks, [{ id: "11111111-2222-3333-4444-555555555555", sent: true, error: null }]);
});

test("HTML in any field is escaped in the email", async () => {
  assert.equal((await run(req(good({ name: "Pat <script>x</script>" })))).body.error, "bad_name");
  const r = await run(req(good({ message: "<script>x</script>", org: '"><img src=x onerror=alert(1)>' }, { page: "/<b>p" })));
  const html = r.sends[0].html;
  assert.ok(!html.includes("<b>p"));
  assert.ok(!html.includes("<script>x"));
  assert.ok(!html.includes("<img src=x"));
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test("recipients empty or unreadable -> holden@mygoodbooks.org", async () => {
  assert.deepEqual((await run(req(good()), { recipients: [] })).sends[0].to, ["holden@mygoodbooks.org"]);
  assert.deepEqual((await run(req(good()), { recipientsThrow: true })).sends[0].to, ["holden@mygoodbooks.org"]);
  assert.deepEqual((await run(req(good()), { recipients: ["Holden@MyGoodBooks.org", "holden@mygoodbooks.org", "junk"] })).sends[0].to, ["holden@mygoodbooks.org"]);
});

test("email failure or not configured still returns 200 and keeps email_error", async () => {
  const f = await run(req(good()), { sendResult: { ok: false, status: 422, error: "email provider rejected the send: bad from" } });
  assert.equal(f.res.status, 200);
  assert.deepEqual(f.body, { ok: true });
  assert.equal(f.marks[0].sent, false);
  assert.match(f.marks[0].error, /rejected/);
  const t = await run(req(good()), { sendThrows: true });
  assert.equal(t.res.status, 200);
  assert.match(t.marks[0].error, /send failed/);
  const nc = await run(req(good()), { configured: false });
  assert.equal(nc.res.status, 200);
  assert.equal(nc.sends.length, 0);
  assert.equal(nc.inserts.length, 1);
  assert.match(nc.marks[0].error, /not configured/);
  // logs carry no visitor address or field values
  const logs = JSON.stringify([...f.logs, ...t.logs, ...nc.logs]);
  assert.ok(!logs.includes("pat@church.org") && !logs.includes("Grace Church") && !logs.includes("Pat Treasurer"));
});

test("insert failure -> 500 {ok:false} with no internal detail, no email", async () => {
  const r = await run(req(good()), { insertThrows: true });
  assert.equal(r.res.status, 500);
  assert.deepEqual(r.body, { ok: false, error: "server_error" });
  assert.equal(r.sends.length, 0);
  assert.ok(!JSON.stringify(r.body).includes("secret-detail"));
});

test("the recipient seed and fallback are work addresses only", () => {
  const sql = readFileSync(new URL("../../supabase/site-forms.sql", import.meta.url), "utf8");
  const idx = readFileSync(new URL("../../supabase/functions/site-forms/index.ts", import.meta.url), "utf8");
  assert.match(sql, /'holden@mygoodbooks\.org', true, 'Holden main inbox, primary'/);
  assert.match(sql, /'admin@mygoodbooks\.org', true, 'shared admin address'/);
  assert.equal(S.FALLBACK_RECIPIENT, "holden@mygoodbooks.org");
  assert.ok(!/gmail\.com/i.test(sql + idx));
});
