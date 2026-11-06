// node --test tests/precompile.test.mjs
// tools/precompile.mjs: the build step must compile exactly what the
// in-browser Babel path compiles (classic JSX, types stripped) for every file
// in index.html's __SOURCE_ORDER.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { compileOne, loaderFor, sourceOrder } from "../tools/precompile.mjs";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("reads the source order from index.html, app.jsx last", () => {
  const order = sourceOrder(html);
  assert.ok(order.length > 100);
  assert.equal(order[0], "auth-config.js");
  assert.equal(order[order.length - 1], "app.jsx");
  for (const f of order) assert.ok(fs.existsSync(new URL("../" + f, import.meta.url)), f + " missing");
});

test("classic JSX runtime, fragments, and stripped types", async () => {
  const out = await compileOne("x.tsx", "const n: number = 1; function A(){ return <><b className='x'>{n}</b></>; }");
  assert.match(out, /React\.createElement\(React\.Fragment/);
  assert.match(out, /React\.createElement\("b"/);
  assert.doesNotMatch(out, /: number/);
  assert.doesNotMatch(out, /jsx-runtime|import /);
});

test(".js files may hold JSX, like the browser path", async () => {
  assert.equal(loaderFor("a.js"), "jsx");
  assert.equal(loaderFor("a.ts"), "ts");
  const out = await compileOne("a.js", "const el = <div/>;");
  assert.match(out, /React\.createElement\("div"/);
});

test("top-level declarations stay global (no wrapper, no strict mode added)", async () => {
  const out = await compileOne("g.js", "const SHARED = 1; function useIt(){ return SHARED; }");
  assert.match(out, /^const SHARED = 1;/);
  assert.doesNotMatch(out, /use strict|\(\(\) =>|exports/);
});

test("the loader still falls back to in-browser Babel", () => {
  assert.match(html, /"precompiled\/" \+ path \+ "\.js"/);
  assert.match(html, /function ensureBabel\(\)/);
  assert.match(html, /sha384-AISI5AuDG6E8DeEiFMVB3rGQxhZt24OU0avMp\+GMV64\+tpnA3\+Z6F5MT0f96iPva/);
});
