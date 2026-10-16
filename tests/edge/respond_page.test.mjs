// Static checks on the public /respond page (Tasks p2 S6): it never parses
// request data as HTML, every element id the script uses exists, and
// vercel.json serves it with an enforced CSP and no referrer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../../", import.meta.url);
const js = readFileSync(new URL("respond.js", root), "utf8");
const html = readFileSync(new URL("respond.html", root), "utf8");
const vercel = JSON.parse(readFileSync(new URL("vercel.json", root), "utf8"));

test("respond.js never writes HTML or evaluates strings", () => {
  for (const bad of ["innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "eval(", "new Function"]) {
    assert.ok(!js.includes(bad), bad);
  }
});

test("respond.js wipes the token from the address bar and sends it only as a header", () => {
  assert.ok(js.indexOf("history.replaceState") < js.indexOf("fetch("));
  assert.ok(js.includes('"X-MGB-Token": token'));
  assert.ok(!/\?action=[^"]*t=/.test(js));
});

test("every id respond.js uses exists in respond.html", () => {
  const ids = new Set([...js.matchAll(/\$\("([a-z-]+)"\)/g)].map((m) => m[1]));
  for (const s of ["loading", "form", "done", "closed", "stop"]) ids.add(s);
  for (const id of ids) assert.ok(html.includes(`id="${id}"`), id);
});

test("respond.html has no inline script or style (the CSP blocks them)", () => {
  assert.ok(!/<script(?![^>]*\bsrc=)/.test(html));
  assert.ok(!/<style/.test(html));
  assert.ok(!/\sstyle="/.test(html));
  assert.ok(!/\son[a-z]+="/.test(html));
});

test("vercel.json serves /respond with an enforced CSP and no referrer", () => {
  assert.ok(vercel.rewrites.some((r) => r.source === "/respond" && r.destination === "/respond.html"));
  for (const src of ["/respond", "/respond.html"]) {
    const blk = vercel.headers.find((h) => h.source === src);
    assert.ok(blk, src);
    const get = (k) => (blk.headers.find((h) => h.key === k) || {}).value || "";
    assert.equal(get("Referrer-Policy"), "no-referrer");
    assert.match(get("X-Robots-Tag"), /noindex/);
    const csp = get("Content-Security-Policy");
    assert.match(csp, /script-src 'self'(;|$)/);
    assert.ok(!csp.includes("unsafe-inline"));
    assert.match(csp, /connect-src https:\/\/xumsqmhccgfjnlmieqyu\.supabase\.co/);
  }
});
