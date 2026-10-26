// node components/tasks/TK_prefsLogic.test.js
const assert = require("assert");
const P = require("./TK_prefsLogic.js");
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
function mem(init) {
  const d = Object.assign({}, init || {});
  return { d, getItem: (k) => (k in d ? d[k] : null), setItem: (k, v) => void (d[k] = String(v)), removeItem: (k) => void delete d[k] };
}
const blocked = {
  getItem() {
    throw new Error("blocked");
  },
  setItem() {
    throw new Error("blocked");
  },
};

t("key is per person and lowercased", () => {
  assert.strictEqual(P.TK_prefsKey(" Ann@MGB.org "), "mgb_tk_prefs_v1:ann@mgb.org");
  assert.strictEqual(P.TK_prefsKey(null), "mgb_tk_prefs_v1:");
});
t("defaults", () => {
  assert.deepStrictEqual(P.TK_prefsDefaults(), { quickKeys: true, density: "comfortable", openIn: "window", showOlder: false });
  assert.deepStrictEqual(P.TK_prefsNormalize(null), P.TK_prefsDefaults());
  assert.deepStrictEqual(P.TK_prefsNormalize([1]), P.TK_prefsDefaults());
});
t("normalize keeps valid, drops bad and unknown", () => {
  assert.deepStrictEqual(P.TK_prefsNormalize({ quickKeys: false, density: "compact", openIn: "desk", showOlder: true, x: 1 }), {
    quickKeys: false,
    density: "compact",
    openIn: "desk",
    showOlder: true,
  });
  assert.deepStrictEqual(P.TK_prefsNormalize({ quickKeys: 0, density: "huge", openIn: "tab", showOlder: "yes" }), P.TK_prefsDefaults());
});
t("read of nothing, bad JSON and blocked storage give defaults", () => {
  assert.deepStrictEqual(P.TK_prefsRead(mem(), "a@b.c"), P.TK_prefsDefaults());
  assert.deepStrictEqual(P.TK_prefsRead(mem({ "mgb_tk_prefs_v1:a@b.c": "{oops" }), "a@b.c"), P.TK_prefsDefaults());
  assert.deepStrictEqual(P.TK_prefsRead(blocked, "a@b.c"), P.TK_prefsDefaults());
  assert.deepStrictEqual(P.TK_prefsRead(null, "a@b.c"), P.TK_prefsDefaults());
});
t("write merges, saves per person and returns the result", () => {
  const s = mem();
  const a = P.TK_prefsWrite(s, "a@b.c", { density: "compact" });
  assert.strictEqual(a.density, "compact");
  const b = P.TK_prefsWrite(s, "a@b.c", { quickKeys: false });
  assert.deepStrictEqual(b, { quickKeys: false, density: "compact", openIn: "window", showOlder: false });
  assert.deepStrictEqual(P.TK_prefsRead(s, "A@B.C"), b);
  assert.deepStrictEqual(P.TK_prefsRead(s, "other@b.c"), P.TK_prefsDefaults());
});
t("write with blocked storage still returns the merged value", () => {
  assert.strictEqual(P.TK_prefsWrite(blocked, "a@b.c", { openIn: "desk" }).openIn, "desk");
});
t("write ignores a bad patch value", () => {
  assert.strictEqual(P.TK_prefsWrite(mem(), "a@b.c", { density: "x" }).density, "comfortable");
});
t("show done defaults on, follows the saved value, keeps other options", () => {
  const s = mem();
  assert.strictEqual(P.TK_prefsShowDoneRead(s), true);
  s.setItem("mgb_tk_view_v1", JSON.stringify({ todayGroup: false, showDone: false }));
  assert.strictEqual(P.TK_prefsShowDoneRead(s), false);
  P.TK_prefsShowDoneWrite(s, true);
  assert.deepStrictEqual(JSON.parse(s.d.mgb_tk_view_v1), { todayGroup: false, showDone: true });
  assert.strictEqual(P.TK_prefsShowDoneRead(blocked), true);
  assert.strictEqual(P.TK_prefsShowDoneWrite(blocked, false), false);
});
t("density class and keys off", () => {
  assert.strictEqual(P.TK_prefsDensityClass({ density: "compact" }), "tk-dens-compact");
  assert.strictEqual(P.TK_prefsDensityClass(null), "");
  assert.strictEqual(P.TK_prefsKeysOff({ quickKeys: false }), true);
  assert.strictEqual(P.TK_prefsKeysOff(null), false);
});
t("notification list names four existing kinds", () => {
  assert.deepStrictEqual(
    P.TK_PREFS_NOTIFY.map((x) => x.email),
    ["task_assigned", "task_mention", "task_due", "task_client_answered"],
  );
});

console.log(n + " checks passed");
