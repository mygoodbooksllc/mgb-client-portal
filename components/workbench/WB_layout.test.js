// Plain node, no framework: `node components/workbench/WB_layout.test.js`.
// Guards the L1 left sidebar rules (WB_layout.js): the built-in profile,
// resolution person > role default > built-in per field, parse safety,
// role-key precedence, the diff round trip, the gate truth table and the
// recents filter.

const assert = require("assert");
const L = require("./WB_layout.js");

let n = 0;
function t(name, fn) {
  try {
    fn();
  } catch (e) {
    console.error("FAIL " + name);
    throw e;
  }
  n++;
}

const BUILTIN_ORDER = ["places", "pinned", "recent", "alerts"];

t("built-in profile is complete for left", () => {
  const p = L.WB_layoutBuiltin("left");
  assert.deepStrictEqual(p.order, BUILTIN_ORDER);
  BUILTIN_ORDER.forEach((id) => {
    assert.strictEqual(p.on[id], true);
    assert.ok(["off", "compact", "full"].includes(p.detail[id]));
  });
  assert.strictEqual(p.width, 220);
});

t("built-in for an unknown bar falls back to left", () => {
  assert.deepStrictEqual(L.WB_layoutBuiltin("nope").order, BUILTIN_ORDER);
});

t("profile with no layers is the built-in (admins get Alerts right after the places)", () => {
  assert.deepStrictEqual(L.WB_layoutProfile({ bar: "left", roleKey: "am" }), L.WB_layoutBuiltin("left"));
  assert.deepStrictEqual(L.WB_layoutProfile({ bar: "left", roleKey: "tempAdmin" }), L.WB_layoutBuiltin("left"));
  const admin = L.WB_layoutProfile({ bar: "left", roleKey: "admin" });
  assert.deepStrictEqual(admin.order, ["places", "alerts", "pinned", "recent"]);
  assert.deepStrictEqual(Object.assign({}, admin, { order: BUILTIN_ORDER }), L.WB_layoutBuiltin("left"));
});

const roleDefaults = {
  v: 1,
  roles: {
    bookkeeper: { left: { order: ["places", "recent", "pinned", "alerts"], on: { recent: false }, detail: { pinned: "compact" }, width: 260 } },
  },
};

t("role default beats built-in, per field", () => {
  const p = L.WB_layoutProfile({ bar: "left", roleKey: "bookkeeper", roleDefaults });
  assert.deepStrictEqual(p.order, ["places", "recent", "pinned", "alerts"]);
  assert.strictEqual(p.on.recent, false);
  assert.strictEqual(p.on.pinned, true);
  assert.strictEqual(p.detail.pinned, "compact");
  assert.strictEqual(p.detail.recent, "compact");
  assert.strictEqual(p.width, 260);
});

t("role default for another role does not apply", () => {
  const p = L.WB_layoutProfile({ bar: "left", roleKey: "am", roleDefaults });
  assert.deepStrictEqual(p, L.WB_layoutBuiltin("left"));
});

t("person beats role default, field by field", () => {
  const person = { v: 1, left: { on: { recent: true }, width: 300 } };
  const p = L.WB_layoutProfile({ bar: "left", roleKey: "bookkeeper", roleDefaults, personPrefs: person });
  assert.strictEqual(p.on.recent, true); // person
  assert.deepStrictEqual(p.order, ["places", "recent", "pinned", "alerts"]); // role (person left it alone)
  assert.strictEqual(p.detail.pinned, "compact"); // role
  assert.strictEqual(p.width, 300); // person
});

t("order, on, detail and width resolve separately", () => {
  const person = { v: 1, left: { detail: { alerts: "off" } } };
  const p = L.WB_layoutProfile({ bar: "left", roleKey: "bookkeeper", roleDefaults, personPrefs: person });
  assert.strictEqual(p.detail.alerts, "off");
  assert.strictEqual(p.width, 260);
  assert.strictEqual(p.on.recent, false);
});

t("raw JSON text is accepted for both layers", () => {
  const p = L.WB_layoutProfile({
    bar: "left",
    roleKey: "bookkeeper",
    roleDefaults: JSON.stringify(roleDefaults),
    personPrefs: JSON.stringify({ v: 1, left: { width: 240 } }),
  });
  assert.strictEqual(p.width, 240);
  assert.strictEqual(p.on.recent, false);
});

t("unknown ids are dropped, missing ids appended in built-in order, duplicates removed", () => {
  const person = { v: 1, left: { order: ["recent", "ghost", "recent", "places"], on: { ghost: true }, detail: { ghost: "full" } } };
  const parsed = L.WB_layoutParse(person);
  assert.deepStrictEqual(parsed.left.order, ["recent", "places"]);
  assert.strictEqual(parsed.left.on, undefined);
  assert.strictEqual(parsed.left.detail, undefined);
  const p = L.WB_layoutProfile({ bar: "left", personPrefs: person });
  // places is locked first, the rest keeps the saved order, missing ones follow in built-in order
  assert.deepStrictEqual(p.order, ["places", "recent", "pinned", "alerts"]);
});

t("places cannot be turned off", () => {
  const p = L.WB_layoutProfile({ bar: "left", personPrefs: { v: 1, left: { on: { places: false, pinned: false } } } });
  assert.strictEqual(p.on.places, true);
  assert.strictEqual(p.on.pinned, false);
});

t("width clamps to 220-320 and non-numbers fall back", () => {
  const w = (x) => L.WB_layoutProfile({ bar: "left", personPrefs: { v: 1, left: { width: x } } }).width;
  assert.strictEqual(w(100), 220);
  assert.strictEqual(w(900), 320);
  assert.strictEqual(w(281.6), 282);
  assert.strictEqual(w("300"), 220);
  assert.strictEqual(w(NaN), 220);
  assert.strictEqual(w(null), 220);
  assert.strictEqual(w(Infinity), 220);
});

t("width is capped at 260 below 1100px", () => {
  assert.strictEqual(L.WB_layoutWidthFor(320, 1099), 260);
  assert.strictEqual(L.WB_layoutWidthFor(320, 1100), 320);
  assert.strictEqual(L.WB_layoutWidthFor(240, 900), 240);
  assert.strictEqual(L.WB_layoutWidthFor("x", 1400), 220);
});

t("detail: bad values fall back to the lower layer", () => {
  const person = { v: 1, left: { detail: { pinned: "huge", recent: 3, alerts: "off" } } };
  const parsed = L.WB_layoutParse(person);
  assert.deepStrictEqual(parsed.left.detail, { alerts: "off" });
  const p = L.WB_layoutProfile({ bar: "left", personPrefs: person });
  assert.strictEqual(p.detail.pinned, "full");
  assert.strictEqual(p.detail.recent, "compact");
});

t("parse: null, string junk, array, number are ignored", () => {
  assert.strictEqual(L.WB_layoutParse(null), null);
  assert.strictEqual(L.WB_layoutParse(undefined), null);
  assert.strictEqual(L.WB_layoutParse("not json"), null);
  assert.strictEqual(L.WB_layoutParse("[1,2]"), null);
  assert.strictEqual(L.WB_layoutParse([1]), null);
  assert.strictEqual(L.WB_layoutParse(7), null);
});

t("parse: wrong schema version is ignored", () => {
  assert.strictEqual(L.WB_layoutParse({ v: 2, left: { width: 300 } }), null);
  assert.strictEqual(L.WB_layoutParse({ left: { width: 300 } }), null);
  const p = L.WB_layoutProfile({ bar: "left", personPrefs: { v: 2, left: { width: 300 } } });
  assert.strictEqual(p.width, 220);
});

t("parse: over 8 KB is ignored (text and object)", () => {
  const big = { v: 1, left: { order: ["places"], pad: "x".repeat(9000) } };
  assert.strictEqual(L.WB_layoutParse(JSON.stringify(big)), null);
  assert.strictEqual(L.WB_layoutParse(big), null);
  const ok = { v: 1, left: { width: 300 } };
  assert.deepStrictEqual(L.WB_layoutParse(ok), { v: 1, left: { width: 300 } });
});

t("parse: prototype keys are ignored", () => {
  const evil = JSON.parse('{"v":1,"__proto__":{"polluted":true},"left":{"__proto__":{"x":1},"on":{"__proto__":true,"recent":false},"width":250},"roles":{"__proto__":{"left":{"width":300}},"admin":{"left":{"width":280}}}}');
  const parsed = L.WB_layoutParse(evil);
  assert.deepStrictEqual(parsed.left, { on: { recent: false }, width: 250 });
  assert.deepStrictEqual(Object.keys(parsed.roles), ["admin"]);
  assert.strictEqual(({}).polluted, undefined);
  assert.strictEqual(parsed.polluted, undefined);
});

t("parse: unknown roles and bars are dropped", () => {
  const parsed = L.WB_layoutParse({ v: 1, roles: { owner: { left: { width: 300 } }, am: { sidebar: { width: 300 }, left: { width: 300 } } }, top: { width: 300 } });
  assert.deepStrictEqual(parsed, { v: 1, roles: { am: { left: { width: 300 } } } });
});

t("role key precedence for every combination", () => {
  const k = L.WB_layoutRoleKey;
  assert.strictEqual(k({ role: "admin" }), "admin");
  assert.strictEqual(k({ role: "admin", hasTempAdminAccess: true, amCount: 3 }), "admin");
  assert.strictEqual(k({ isAdmin: true, amCount: 3 }), "admin");
  assert.strictEqual(k({ role: "bookkeeper", hasTempAdminAccess: true, amCount: 3 }), "tempAdmin");
  assert.strictEqual(k({ role: "bookkeeper", hasTempAdminAccess: true }), "tempAdmin");
  assert.strictEqual(k({ role: "bookkeeper", amCount: 1 }), "am");
  assert.strictEqual(k({ role: "bookkeeper", amCount: 0 }), "bookkeeper");
  assert.strictEqual(k({ role: "bookkeeper" }), "bookkeeper");
  assert.strictEqual(k({}), "bookkeeper");
  assert.strictEqual(k(null), "bookkeeper");
});

t("diff of the defaults is {}", () => {
  const base = L.WB_layoutProfile({ bar: "left", roleKey: "bookkeeper", roleDefaults });
  assert.deepStrictEqual(L.WB_layoutDiff(base, base), {});
});

t("diff round trip: profile(diff(p)) == p", () => {
  const base = L.WB_layoutProfile({ bar: "left", roleKey: "bookkeeper", roleDefaults });
  const wanted = {
    order: ["places", "alerts", "pinned", "recent"],
    on: Object.assign({}, base.on, { recent: true, alerts: false }),
    detail: Object.assign({}, base.detail, { recent: "full" }),
    width: 300,
  };
  const diff = L.WB_layoutDiff(wanted, base);
  assert.deepStrictEqual(diff.on, { recent: true, alerts: false });
  assert.deepStrictEqual(diff.detail, { recent: "full" });
  assert.strictEqual(diff.width, 300);
  const back = L.WB_layoutProfile({ bar: "left", roleKey: "bookkeeper", roleDefaults, personPrefs: { v: 1, left: diff } });
  assert.deepStrictEqual(back, wanted);
});

t("diff keeps unchanged fields out so role default changes still reach people", () => {
  const base = L.WB_layoutBuiltin("left");
  const wanted = Object.assign({}, base, { width: 250 });
  const diff = L.WB_layoutDiff(wanted, base);
  assert.deepStrictEqual(diff, { width: 250 });
  const changed = { v: 1, roles: { admin: { left: { on: { recent: false } } } } };
  const p = L.WB_layoutProfile({ bar: "left", roleKey: "admin", roleDefaults: changed, personPrefs: { v: 1, left: diff } });
  assert.strictEqual(p.on.recent, false);
  assert.strictEqual(p.width, 250);
});

t("SS_navIsOn truth table: classic wins, then preview, then the firm switch", () => {
  const on = L.SS_navIsOn;
  // [setting, preview, classic] -> result
  assert.strictEqual(on(undefined, false, false), false);
  assert.strictEqual(on(true, false, false), true);
  assert.strictEqual(on(undefined, true, false), true);
  assert.strictEqual(on(true, true, false), true);
  assert.strictEqual(on(undefined, false, true), false);
  assert.strictEqual(on(true, false, true), false);
  assert.strictEqual(on(undefined, true, true), false);
  assert.strictEqual(on(true, true, true), false);
});

t("SS_navIsOn reads the setting with the Desk's value rules, and never accepts 'on'", () => {
  const on = L.SS_navIsOn;
  assert.strictEqual(on("true", false, false), true);
  assert.strictEqual(on(1, false, false), true);
  assert.strictEqual(on({ on: true }, false, false), true);
  assert.strictEqual(on("on", false, false), false);
  assert.strictEqual(on("false", false, false), false);
  assert.strictEqual(on(false, false, false), false);
  assert.strictEqual(on(null, false, false), false);
  assert.strictEqual(on({ on: "yes" }, false, false), false);
});

t("recents filter: excludes pins and the current client", () => {
  assert.deepStrictEqual(L.SS_filterRecents(["a", "b", "c", "d"], ["b"], "c"), ["a", "d"]);
});

t("recents filter: keeps order, de-duplicates, drops junk", () => {
  assert.deepStrictEqual(L.SS_filterRecents(["z", "a", "z", "", 5, null, "m"], [], null), ["z", "a", "5", "m"]);
});

t("recents filter: cap of 5, applied after filtering", () => {
  const recents = ["1", "2", "3", "4", "5", "6", "7"];
  assert.deepStrictEqual(L.SS_filterRecents(recents, [], null), ["1", "2", "3", "4", "5"]);
  assert.deepStrictEqual(L.SS_filterRecents(recents, ["1", "2"], "3"), ["4", "5", "6", "7"]);
  assert.deepStrictEqual(L.SS_filterRecents(recents, [], null, 2), ["1", "2"]);
  assert.deepStrictEqual(L.SS_filterRecents("nope", null, undefined), []);
});

t("initials for the collapsed chip", () => {
  assert.strictEqual(L.SS_initials("Acme Roofing"), "AR");
  assert.strictEqual(L.SS_initials("Acme"), "AC");
  assert.strictEqual(L.SS_initials(""), "?");
  assert.strictEqual(L.SS_initials(null), "?");
  assert.strictEqual(L.SS_initials("  the  big  co "), "TB");
});

console.log("WB_layout.test.js: " + n + " tests passed");
