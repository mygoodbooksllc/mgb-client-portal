// Plain node: `node tests/tabOrder.test.js`. normalizeTabOrder (app.jsx), the
// shape the org tab order is saved in (clients.tab_order,
// supabase/client-tab-order.sql), plus static guards on how App uses it.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "app.jsx"), "utf8");
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

const start = src.indexOf("function normalizeTabOrder(value)");
assert(start > 0, "normalizeTabOrder must exist");
let depth = 0, end = src.indexOf("{", start);
for (let i = end; i < src.length; i++) {
  if (src[i] === "{") depth++;
  else if (src[i] === "}" && --depth === 0) { end = i + 1; break; }
}
const NAV_SECTIONS = [
  { label: "Home", items: [{ key: "dashboard" }, { key: "messages" }] },
  { label: "Finances", items: [{ key: "budget" }, { key: "bank" }, { key: "giving" }, { key: "payroll" }] },
];
const normalizeTabOrder = new Function("NAV_SECTIONS", src.slice(start, end) + "; return normalizeTabOrder;")(NAV_SECTIONS);

assert.deepStrictEqual(normalizeTabOrder(null), {});
assert.deepStrictEqual(normalizeTabOrder([]), {});
assert.deepStrictEqual(normalizeTabOrder("x"), {});
assert.deepStrictEqual(
  normalizeTabOrder({ Finances: ["giving", "bank", "giving", "nope", 5, "dashboard"], Old: ["bank"] }),
  { Finances: ["giving", "bank"] },
  "keeps known keys of that section only, once each, and drops unknown sections",
);
assert.deepStrictEqual(normalizeTabOrder({ Finances: [] }), {}, "an empty list is no order");
assert.deepStrictEqual(
  normalizeTabOrder({ Home: ["messages", "dashboard"], Finances: ["payroll"] }),
  { Home: ["messages", "dashboard"], Finances: ["payroll"] },
);

// App: admins save to the org row only when the column exists; everyone
// else keeps the per-browser order; the copy-up only fills an empty value.
const rt = src.slice(src.indexOf("const reorderTab = async"), src.indexOf("const openOrgTabs"));
assert(/canEditOrgTabs && window\.TAB_ORDER_COL_OK/.test(rt), "only admins with the column write the org order");
assert(/setLocalTabOrder\(/.test(rt), "non-admins keep the local order");
assert(/\.eq\("tab_order", "\{\}"\)/.test(rt), "copy-up must only fill an empty server value");
assert(/TAB_ORDER_COL_OK/.test(html) && /select\("id, tab_order"\)/.test(html), "roster loads tab_order in its own query");
console.log("tabOrder.test.js ok");
