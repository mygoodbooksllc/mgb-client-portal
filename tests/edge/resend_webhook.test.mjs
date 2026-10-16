// resend-webhook stored payloads (S6 review MAJOR 2):
// supabase/functions/resend-webhook/logic.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import * as L from "../../supabase/functions/resend-webhook/logic.ts";

const TOK = "Zq3_x-9".padEnd(43, "a");

test("a clicked answer link is never stored: no link/url, no token anywhere", () => {
  const evt = {
    type: "email.clicked",
    created_at: "2026-10-16T12:00:00Z",
    data: {
      email_id: "e1",
      from: "MyGoodBooks <hello@mygoodbooks.org>",
      to: ["c@example.com"],
      subject: "We need one thing from you",
      tags: [{ name: "kind", value: "tk_request" }],
      click: {
        ipAddress: "203.0.113.9",
        link: `https://app.mygoodbooks.org/respond#t=${TOK}`,
        url: `https://app.mygoodbooks.org/respond?t=${TOK}&x=1`,
        timestamp: "2026-10-16T12:00:00Z",
        userAgent: "Mozilla/5.0",
      },
    },
  };
  const p = L.safePayload(evt);
  const s = JSON.stringify(p);
  assert.ok(!s.includes(TOK), "token leaked");
  assert.ok(!s.includes("/respond"), "link leaked");
  assert.deepEqual(p.click, { timestamp: "2026-10-16T12:00:00Z", userAgent: "Mozilla/5.0" });
  assert.equal(p.type, "email.clicked");
  assert.deepEqual(p.tags, [{ name: "kind", value: "tk_request" }]);
});

test("t= values are redacted anywhere else in what is kept (fragment and query)", () => {
  assert.equal(L.redactTokens(`see https://x/respond#t=${TOK}`), "see https://x/respond#t=[redacted]");
  assert.equal(L.redactTokens(`https://x/r?a=1&t=${TOK}&b=2`), "https://x/r?a=1&t=[redacted]&b=2");
  assert.equal(L.redactTokens("no token: at=1 cat=2"), "no token: at=1 cat=2");
  const p = L.safePayload({ type: "email.bounced", data: { bounce: { message: `bad https://x/respond#t=${TOK}` } } });
  assert.ok(!JSON.stringify(p).includes(TOK));
  assert.equal(L.safeSubject(`Re https://x#t=${TOK}`), "Re https://x#t=[redacted]");
  assert.equal(L.safeSubject(""), null);
});

test("events without a click keep their shape", () => {
  const p = L.safePayload({ type: "email.delivered", data: { from: "a@b", tags: null } });
  assert.equal(p.click, undefined);
  assert.equal(p.from, "a@b");
  assert.deepEqual(L.safePayload(null), { type: undefined, from: undefined, tags: undefined, click: undefined, bounce: undefined });
});
