// Plain node, no framework: `node components/tasks/TK_customFields.test.js`.
// Guards the Slate plus custom field rules (TK_customFields.js): names, options,
// value checks (the browser mirror of the server trigger), display text, which
// fields apply to a task, the row chips (3 then +N), sorting, error words, that
// every runtime helper is inert while the gate is off, and the optimistic save
// with its revert (an older failed save never undoes a newer one).

const assert = require("assert");
const C = require("./TK_customFields.js");

let n = 0;
const pending = [];
function t(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === "function") {
      pending.push(
        r.then(
          () => n++,
          (e) => {
            console.error("FAIL " + name);
            throw e;
          },
        ),
      );
      return;
    }
  } catch (e) {
    console.error("FAIL " + name);
    throw e;
  }
  n++;
}

const F = (id, type, extra) => Object.assign({ id, name: "F" + id, type, scope: "project", project_id: "p1", position: 0, options: [] }, extra || {});
const dd = F("d", "dropdown", {
  name: "Bank",
  options: [
    { id: "o1", label: "Checking", retired: false },
    { id: "o2", label: "Savings", retired: false },
    { id: "o3", label: "Old", retired: true },
  ],
});
const staff = [{ email: "sonya@mygoodbooks.org", name: "Sonya Reed" }];

t("nameCheck: trims, length, unique any case, self allowed, archived ignored", () => {
  const list = [{ id: "a", name: "Fund" }, { id: "b", name: "Grant", archived_at: "2026-10-01" }];
  assert.deepStrictEqual(C.TKCF_nameCheck("  Bank  ", list), { ok: true, name: "Bank", error: "" });
  assert.strictEqual(C.TKCF_nameCheck("   ", list).ok, false);
  assert.strictEqual(C.TKCF_nameCheck("x".repeat(41), list).ok, false);
  assert.strictEqual(C.TKCF_nameCheck("x".repeat(40), list).ok, true);
  assert.strictEqual(C.TKCF_nameCheck("FUND", list).ok, false);
  assert.strictEqual(C.TKCF_nameCheck("fund", list, "a").ok, true);
  assert.strictEqual(C.TKCF_nameCheck("grant", list).ok, true);
  assert.strictEqual(C.TKCF_nameCheck("a   b", []).name, "a b");
});

t("normalizeOptions: cleans, drops blanks and retired, refuses repeats, 1-20", () => {
  const r = C.TKCF_normalizeOptions([{ id: "o1", label: " Checking " }, { label: "" }, { label: "New" }, { id: "o3", label: "Old", retired: true }]);
  assert.deepStrictEqual(r, { ok: true, options: [{ id: "o1", label: "Checking" }, { label: "New" }], error: "" });
  assert.strictEqual(C.TKCF_normalizeOptions([{ label: "A" }, { label: "a" }]).ok, false);
  assert.strictEqual(C.TKCF_normalizeOptions([]).ok, false);
  assert.strictEqual(C.TKCF_normalizeOptions([{ label: "x".repeat(41) }]).ok, false);
  const many = Array.from({ length: 21 }, (_, i) => ({ label: "o" + i }));
  assert.strictEqual(C.TKCF_normalizeOptions(many).ok, false);
  assert.strictEqual(C.TKCF_normalizeOptions(many.slice(0, 20)).ok, true);
  // a bad or repeated id is dropped (the server makes a new one)
  const ids = C.TKCF_normalizeOptions([{ id: "bad id!", label: "A" }, { id: "o1", label: "B" }, { id: "o1", label: "C" }]);
  assert.deepStrictEqual(ids.options, [{ label: "A" }, { id: "o1", label: "B" }, { label: "C" }]);
});

t("parseOptionsText: one per line, keeps ids by label (retired too)", () => {
  const r = C.TKCF_parseOptionsText("Checking\n\n  savings \r\nPayroll\nold", dd.options);
  assert.deepStrictEqual(r.options, [{ id: "o1", label: "Checking" }, { id: "o2", label: "savings" }, { label: "Payroll" }, { id: "o3", label: "old" }]);
  assert.strictEqual(C.TKCF_parseOptionsText("", dd.options).ok, false);
});

t("validateValue mirrors the server rules", () => {
  const v = C.TKCF_validateValue;
  assert.deepStrictEqual(v(F(1, "text"), "  hi "), { ok: true, value: "hi", error: "" });
  assert.strictEqual(v(F(1, "text"), "   ").value, null);
  assert.strictEqual(v(F(1, "text"), "x".repeat(501)).ok, false);
  assert.strictEqual(v(F(1, "text"), "x".repeat(500)).ok, true);
  assert.strictEqual(v(F(1, "number"), "1,250.5").value, 1250.5);
  assert.strictEqual(v(F(1, "number"), "-3").value, -3);
  assert.strictEqual(v(F(1, "number"), ".5").value, 0.5);
  assert.strictEqual(v(F(1, "number"), "abc").ok, false);
  assert.strictEqual(v(F(1, "number"), "1e5").ok, false);
  assert.strictEqual(v(F(1, "number"), "1000000000000").ok, false);
  assert.strictEqual(v(F(1, "number"), "1.1234567").ok, false);
  assert.strictEqual(v(F(1, "number"), "1.123456").ok, true);
  assert.strictEqual(v(F(1, "number"), "").value, null);
  assert.strictEqual(v(F(1, "date"), "2026-02-28").value, "2026-02-28");
  assert.strictEqual(v(F(1, "date"), "2026-02-29").ok, false);
  assert.strictEqual(v(F(1, "date"), "2028-02-29").ok, true);
  assert.strictEqual(v(F(1, "date"), "1899-12-31").ok, false);
  assert.strictEqual(v(F(1, "date"), "2026-2-3").ok, false);
  assert.strictEqual(v(F(1, "checkbox"), true).value, true);
  assert.strictEqual(v(F(1, "checkbox"), false).value, false);
  assert.strictEqual(v(F(1, "checkbox"), "yes").ok, false);
  assert.strictEqual(v(dd, "o2").value, "o2");
  assert.strictEqual(v(dd, "o3").ok, false);
  assert.strictEqual(v(dd, "zz").ok, false);
  assert.strictEqual(v(dd, "").value, null);
  assert.strictEqual(v(F(1, "person"), " Sonya@MyGoodBooks.org ").value, "sonya@mygoodbooks.org");
  assert.strictEqual(v(F(1, "person"), "nobody").ok, false);
  assert.strictEqual(v(F(1, "mystery"), "x").ok, false);
  assert.strictEqual(v(F(1, "text"), null).value, null);
});

t("format and isFilled", () => {
  assert.strictEqual(C.TKCF_format(F(1, "number"), 1234567.25), "1,234,567.25");
  assert.strictEqual(C.TKCF_format(F(1, "number"), -1000), "-1,000");
  assert.strictEqual(C.TKCF_format(F(1, "date"), "2026-03-03"), "Mar 3, 2026");
  assert.strictEqual(C.TKCF_format(dd, "o3"), "Old");
  assert.strictEqual(C.TKCF_format(dd, "gone"), "");
  assert.strictEqual(C.TKCF_format(F(1, "person"), "sonya@mygoodbooks.org", staff), "Sonya Reed");
  assert.strictEqual(C.TKCF_format(F(1, "person"), "left@mygoodbooks.org", staff), "left@mygoodbooks.org");
  assert.strictEqual(C.TKCF_format(F(1, "checkbox"), true), "Yes");
  assert.strictEqual(C.TKCF_format(F(1, "text"), null), "");
  assert.strictEqual(C.TKCF_isFilled(F(1, "checkbox"), false), false);
  assert.strictEqual(C.TKCF_isFilled(F(1, "checkbox"), true), true);
  assert.strictEqual(C.TKCF_isFilled(F(1, "text"), "  "), false);
  assert.strictEqual(C.TKCF_isFilled(F(1, "number"), 0), true);
  assert.strictEqual(C.TKCF_isFilled(F(1, "number"), null), false);
  assert.strictEqual(C.TKCF_isFilled(dd, "o1"), true);
  assert.strictEqual(C.TKCF_isFilled(dd, "o3"), true); // retired still shows
  assert.strictEqual(C.TKCF_isFilled(dd, "gone"), false); // unknown id: no chip
});

t("indexFields: active sorted per target, archived apart, junk skipped", () => {
  const idx = C.TKCF_indexFields([
    F("a", "text", { position: 2 }),
    F("b", "text", { position: 0 }),
    F("c", "text", { archived_at: "2026-10-02" }),
    F("k", "text", { scope: "client", project_id: null, client_id: "cl1", position: 0 }),
    F("x", "formula"),
    { id: "y", type: "text", scope: "project", project_id: null },
    null,
  ]);
  assert.deepStrictEqual(idx.byTarget["p:p1"].map((f) => f.id), ["b", "a"]);
  assert.deepStrictEqual(idx.archivedByTarget["p:p1"].map((f) => f.id), ["c"]);
  assert.deepStrictEqual(idx.byTarget["c:cl1"].map((f) => f.id), ["k"]);
  assert.ok(!idx.byId.x && !idx.byId.y);
});

t("fieldsForTask: project fields then client fields; personal tasks none", () => {
  const idx = C.TKCF_indexFields([F("a", "text"), F("k", "text", { scope: "client", project_id: null, client_id: "cl1" })]);
  assert.deepStrictEqual(C.TKCF_fieldsForTask({ project_id: "p1", client_id: "cl1" }, idx).map((f) => f.id), ["a", "k"]);
  assert.deepStrictEqual(C.TKCF_fieldsForTask({ client_id: "cl1" }, idx).map((f) => f.id), ["k"]);
  assert.deepStrictEqual(C.TKCF_fieldsForTask({ project_id: "p9" }, idx), []);
  assert.deepStrictEqual(C.TKCF_fieldsForTask({}, idx), []);
  assert.deepStrictEqual(C.TKCF_fieldsForTask(null, idx), []);
});

t("indexValues and chips: 3 then +N, empty and unticked skipped", () => {
  const fields = [F("a", "text", { name: "Fund" }), F("b", "checkbox", { name: "Reviewed" }), F("c", "checkbox", { name: "Signed" }), dd, F("e", "number", { name: "Amount" }), F("f", "text", { name: "Note" })];
  const vals = C.TKCF_indexValues([
    { task_id: "t1", field_id: "a", value: "Building" },
    { task_id: "t1", field_id: "b", value: true },
    { task_id: "t1", field_id: "c", value: false },
    { task_id: "t1", field_id: "d", value: "o3" },
    { task_id: "t1", field_id: "e", value: 1500 },
    { task_id: "t1", field_id: "f", value: null },
    { task_id: null, field_id: "a", value: "x" },
  ]);
  assert.deepStrictEqual(Object.keys(vals), ["t1"]);
  const c = C.TKCF_chips(fields, vals.t1, staff);
  assert.deepStrictEqual(c.chips.map((x) => x.text), ["Fund: Building", "Reviewed", "Bank: Old"]);
  assert.strictEqual(c.chips[1].check, true);
  assert.strictEqual(c.more, 1);
  assert.strictEqual(c.moreTitle, "Amount: 1,500");
  const none = C.TKCF_chips(fields, {}, staff);
  assert.deepStrictEqual(none, { chips: [], more: 0, moreTitle: "" });
});

t("compare: empty last, by type", () => {
  const num = F(1, "number");
  assert.ok(C.TKCF_compare(num, 2, 10) < 0);
  assert.ok(C.TKCF_compare(num, null, 1) > 0);
  assert.strictEqual(C.TKCF_compare(num, null, null), 0);
  assert.ok(C.TKCF_compare(dd, "o2", "o1") > 0);
  assert.ok(C.TKCF_compare(F(1, "date"), "2026-01-02", "2026-01-10") < 0);
  assert.ok(C.TKCF_compare(F(1, "text"), "apple", "Banana") < 0);
  assert.ok(C.TKCF_compare(F(1, "checkbox"), true, false) < 0);
});

t("reorder moves one id; bad indexes leave the list alone", () => {
  assert.deepStrictEqual(C.TKCF_reorder(["a", "b", "c"], 0, 2), ["b", "c", "a"]);
  assert.deepStrictEqual(C.TKCF_reorder(["a", "b", "c"], 2, 0), ["c", "a", "b"]);
  assert.deepStrictEqual(C.TKCF_reorder(["a", "b"], 5, 0), ["a", "b"]);
});

t("errText: plain words for each refusal", () => {
  const e = (m) => ({ message: m });
  assert.strictEqual(C.TKCF_errText(e("tk_cf_limit: 15 fields is the most for one list")), C.TKCF_CAP_TEXT);
  assert.strictEqual(C.TKCF_errText(e("tk_cf_bad_value: that option is retired")), "That option is retired.");
  assert.strictEqual(C.TKCF_errText(e("tk_cf_bad_options: a dropdown has 1 to 20 options")), "A dropdown has 1 to 20 options.");
  assert.strictEqual(C.TKCF_errText({ reason: "tk_cf_name_taken" }), "This list already has a field with that name.");
  assert.strictEqual(C.TKCF_errText(e("tk_cf_type_locked")), "A field's type can't change. Make a new field instead.");
  assert.strictEqual(C.TKCF_errText(e("tk_forbidden")), "You can't change that.");
  assert.strictEqual(C.TKCF_errText(e("something else")), "Couldn't save that change. Try again.");
});

t("gate off: runtime helpers are inert, no network", () => {
  let calls = 0;
  global.TK_api = new Proxy({}, { get: () => () => { calls++; return Promise.resolve([]); } });
  assert.strictEqual(C.TKCF_on(), false);
  assert.strictEqual(C.TKCF_ready(), false);
  assert.deepStrictEqual(C.TKCF_fieldsOf({ project_id: "p1" }), []);
  assert.deepStrictEqual(C.TKCF_listFor("project", "p1"), { active: [], archived: [] });
  assert.deepStrictEqual(C.TKCF_valuesOf("t1"), {});
  assert.strictEqual(C.TKCF_chipsFor({ id: "t1", project_id: "p1" }), null);
  return Promise.all([
    C.TKCF_load(true),
    C.TKCF_loadTask("t1"),
    C.TKCF_setValue(F(1, "text"), { id: "t1" }, "x"),
    C.TKCF_saveField(null, "project", "p1", "A", "text"),
    C.TKCF_archiveField("a", true),
    C.TKCF_orderFields(["a"]),
  ]).then((r) => {
    assert.strictEqual(r[0], null);
    assert.strictEqual(r[2].ok, false);
    assert.strictEqual(calls, 0);
    delete global.TK_api;
  });
});

Promise.all(pending)
  .then(() => {
    // Gate on: load, chips, optimistic save and revert (fake API).
    const events = [];
    global.window = { dispatchEvent: (ev) => events.push(ev), addEventListener() {}, removeEventListener() {} };
    global.Event = function (name) { this.type = name; };
    global.TKP_on = () => true;
    let fail = false;
    let held = null; // when set, cfValueSet waits for the test to settle it
    const sent = [];
    global.TK_api = {
      cfFields: () => Promise.resolve([F("a", "text", { name: "Fund" }), F("b", "number", { name: "Amount", position: 1 })]),
      cfValues: (ids) => Promise.resolve(ids ? [{ task_id: "t2", field_id: "a", value: "Done task" }] : [{ task_id: "t1", field_id: "a", value: "Building" }]),
      cfValueSet: (f, tid, v) => {
        sent.push([f, tid, v]);
        if (held) return new Promise((res, rej) => held.push({ res: () => res({ ok: true, value: v }), rej: () => rej({ message: "boom" }) }));
        return fail ? Promise.reject({ message: "tk_cf_archived: that field is archived" }) : Promise.resolve({ ok: true, value: v });
      },
    };
    const task = { id: "t1", project_id: "p1" };
    return C.TKCF_load(true)
      .then(() => {
        assert.strictEqual(C.TKCF_ready(), true);
        assert.deepStrictEqual(C.TKCF_fieldsOf(task).map((f) => f.id), ["a", "b"]);
        assert.deepStrictEqual(C.TKCF_chipsFor(task).chips.map((c) => c.text), ["Fund: Building"]);
        return C.TKCF_setValue(C.TKCF_fieldsOf(task)[1], task, "12.5");
      })
      .then((r) => {
        assert.deepStrictEqual(r, { ok: true, value: 12.5 });
        assert.deepStrictEqual(sent[0], ["b", "t1", 12.5]);
        assert.strictEqual(C.TKCF_valuesOf("t1").b.value, 12.5);
        return C.TKCF_setValue(C.TKCF_fieldsOf(task)[1], task, "12.5");
      })
      .then((r) => {
        assert.strictEqual(r.same, true);
        assert.strictEqual(sent.length, 1);
        return C.TKCF_setValue(C.TKCF_fieldsOf(task)[1], task, "abc");
      })
      .then((r) => {
        assert.deepStrictEqual(r, { ok: false, error: "Enter a number." });
        assert.strictEqual(sent.length, 1);
        fail = true;
        return C.TKCF_setValue(C.TKCF_fieldsOf(task)[0], task, "Roof");
      })
      .then((r) => {
        assert.deepStrictEqual(r, { ok: false, error: "That field is archived." });
        assert.strictEqual(C.TKCF_valuesOf("t1").a.value, "Building");
        // Overlapping saves: the older one failing must not undo the newer one.
        fail = false;
        held = [];
        const fb = C.TKCF_fieldsOf(task)[1];
        const p1 = C.TKCF_setValue(fb, task, "1");
        const p2 = C.TKCF_setValue(fb, task, "2");
        assert.strictEqual(C.TKCF_valuesOf("t1").b.value, 2);
        held[0].rej();
        return p1.then((r1) => {
          assert.strictEqual(r1.ok, false);
          assert.strictEqual(C.TKCF_valuesOf("t1").b.value, 2);
          held[1].res();
          return p2;
        });
      })
      .then((r2) => {
        assert.strictEqual(r2.ok, true);
        assert.strictEqual(C.TKCF_valuesOf("t1").b.value, 2);
        held = null;
        return C.TKCF_loadTask("t2");
      })
      .then(() => {
        assert.strictEqual(C.TKCF_valuesOf("t2").a.value, "Done task");
        return C.TKCF_load(true);
      })
      .then(() => {
        // a single-task read survives a full reload (done tasks are not in it)
        assert.strictEqual(C.TKCF_valuesOf("t2").a.value, "Done task");
        assert.ok(events.length >= 4);
        n += 1;
        console.log("TK_customFields: " + n + " tests passed");
      });
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
