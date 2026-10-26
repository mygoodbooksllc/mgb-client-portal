// Plain node, no framework: `node components/tour/TOUR_slateLogic.test.js`.
// Guards "Slate, start to finish" (TOUR_slateLogic.js): unique step ids, every
// chapter has steps, every target is a data-tour in the source, short cards,
// nothing about the held month rhythm, and every `go` only navigates or opens
// (no write call anywhere in the helpers it is built from).

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const L = require("./TOUR_slateLogic.js");

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

const ROOT = path.join(__dirname, "..", "..");
const SRC = fs.readFileSync(path.join(__dirname, "TOUR_slateLogic.js"), "utf8");
const admin = { isAdmin: true, isBookkeeper: false, tempAdmin: false, showsAdminPages: true, amCount: 0 };
const bk = { isAdmin: false, isBookkeeper: true, tempAdmin: false, showsAdminPages: false, amCount: 0 };

t("steps: unique ids, a chapter each, a go each, title and body", () => {
  [admin, bk, undefined].forEach((ctx) => {
    const steps = L.TOUR_slateSteps(ctx);
    assert.ok(steps.length >= 30, "steps " + steps.length);
    const ids = steps.map((s) => s.id);
    assert.strictEqual(new Set(ids).size, ids.length, "step ids repeat");
    const keys = L.TOUR_SLATE_CHAPTERS.map((c) => c.key);
    steps.forEach((s) => {
      assert.ok(keys.indexOf(s.chapter) >= 0, "chapter of " + s.id);
      assert.strictEqual(typeof s.go, "function", "go of " + s.id);
      assert.ok(s.wait, "wait on " + s.id);
      assert.ok(s.title && typeof s.body === "function" && String(s.body()).trim(), "title/body of " + s.id);
      assert.ok(Array.isArray(s.targets), "targets of " + s.id);
    });
    assert.ok(!steps[0].targets.length, "a centered welcome first");
    assert.ok(!steps[steps.length - 1].targets.length, "a centered end");
  });
});

t("chapters: seven, in order, none empty, contiguous", () => {
  assert.deepStrictEqual(
    L.TOUR_SLATE_CHAPTERS.map((c) => c.label),
    ["Your day", "Client lists", "Working a task", "Speed", "Team flow", "Automation", "Your setup"],
  );
  const steps = L.TOUR_slateSteps(bk);
  const idx = L.TOUR_slateChapterIndex(steps);
  assert.deepStrictEqual(
    idx.map((c) => c.key),
    L.TOUR_SLATE_CHAPTERS.map((c) => c.key),
    "each chapter once, in order (contiguous)",
  );
  idx.forEach((c) => {
    assert.ok(c.count >= 1, c.key + " is empty");
    assert.strictEqual(steps[c.index].chapter, c.key);
  });
  assert.strictEqual(idx.reduce((a, c) => a + c.count, 0), steps.length);
});

t("cards: one or two sentences each", () => {
  L.TOUR_slateSteps(admin).forEach((s) => {
    const body = String(s.body());
    const sentences = (body.match(/[A-Za-z0-9)'][.!?](?=\s|$)/g) || []).length;
    assert.ok(sentences >= 1 && sentences <= 2, s.id + " has " + sentences + " sentences: " + body);
    assert.ok(body.length <= 200, s.id + " runs " + body.length + " characters");
  });
});

t("copy: no month rhythm, Close order or Emails due; Ask client coming soon once; US spelling", () => {
  const all = L.TOUR_slateSteps(admin).map((s) => s.title + " " + s.body());
  const text = all.join("\n");
  assert.ok(!/rhythm|close order|emails due|month-end tasks/i.test(text), "held rhythm mentioned");
  assert.ok(!/colour|behaviour|organis/i.test(text), "US spelling");
  const soon = all.filter((x) => /coming soon/i.test(x));
  assert.strictEqual(soon.length, 1);
  assert.ok(/Ask client/.test(soon[0]));
  // Group by 4th/14th/24th is live and stays in chapter 1.
  const gb = L.TOUR_slateSteps(admin).find((s) => s.id === "sl-groupby");
  assert.strictEqual(gb.chapter, "day");
  assert.ok(/4th\/14th\/24th/.test(gb.body()));
  ["tk-recurring-rhythm", "tk-close-order", "tk-emails-due"].forEach((k) =>
    assert.ok(!L.TOUR_slateSteps(admin).some((s) => s.targets.indexOf(k) >= 0), k + " is used"),
  );
});

t("targets: every one is a data-tour in the source", () => {
  const files = [path.join(ROOT, "app.jsx")];
  const walk = (dir) =>
    fs.readdirSync(dir, { withFileTypes: true }).forEach((d) => {
      const p = path.join(dir, d.name);
      if (d.isDirectory()) walk(p);
      else if (/\.jsx$/.test(d.name)) files.push(p);
    });
  walk(path.join(ROOT, "components"));
  const src = files.map((f) => fs.readFileSync(f, "utf8")).join("\n");
  const targets = new Set();
  L.TOUR_slateSteps(admin).forEach((s) => s.targets.forEach((k) => targets.add(k)));
  assert.ok(targets.size >= 20);
  targets.forEach((k) => {
    const esc = k.replace(/[-]/g, "\\-");
    // data-tour="k", data-tour={... "k" ...}, or a component's tour / tourKey prop
    const re = new RegExp('(?:data-tour|tourKey|tour)=(?:"' + esc + '"|\\{[^}\\n]*"' + esc + '")');
    assert.ok(re.test(src), "no data-tour for " + k);
  });
});

t("go: the helpers call only navigation and open functions", () => {
  // Every function the steps' `go` closures are built from.
  const helpers = ["TOUR_slCloseTask", "TOUR_slNav", "TOUR_slSettings", "TOUR_slDemoId", "TOUR_slOpenDemo", "TOUR_slHashPath", "TOUR_slPickTask"];
  const ALLOWED = new Set([
    "function", "if", "return", "typeof", "catch", "String", "Array.isArray", "split", "filter", "find", "map", "test",
    "TK_store.getState", "TK_dwDispatch", "TK_vOpenTask", "TK_slateInApp", "setTimeout", "tryOpen",
  ].concat(helpers));
  helpers.forEach((name) => {
    const fn = L[name];
    assert.strictEqual(typeof fn, "function", name);
    const body = fn.toString();
    // A write verb anywhere in a helper fails, whatever calls it.
    assert.ok(
      !/\b(TK_api|supabase|fetch|insert|upsert|update|delete|remove|create|complete|approve|sendBack|send|askClient|bulk|patch|save|mutate|record|ST_store)\b/i.test(
        body.replace(/\/\/[^\n]*/g, ""),
      ),
      name + " has a write word",
    );
    (body.replace(/\/\/[^\n]*/g, "").match(/[A-Za-z_$][\w$.]*(?=\s*\()/g) || []).forEach((call) => {
      // Read-only methods on any value (an array, a string, a regex, the store).
      const method = call.indexOf(".") > 0 ? call.split(".").pop() : null;
      const READ = ["map", "filter", "find", "split", "test", "getState", "isArray"];
      assert.ok(ALLOWED.has(call) || (method && READ.indexOf(method) >= 0), name + " calls " + call);
    });
  });
  // The only dispatch closes the task details.
  const d = SRC.match(/TK_dwDispatch\(([^)]*)\)/g) || [];
  assert.ok(d.length >= 1);
  d.forEach((x) => assert.ok(/type: "drawer", id: null/.test(x), x));
  // TOUR_slateSteps builds every go from those helpers only.
  const stepsSrc = L.TOUR_slateSteps.toString();
  assert.ok(!/location\.hash\s*=|TK_\w+\(/.test(stepsSrc.replace(/typeof TK_api[^;]*;/, "")), "TOUR_slateSteps itself calls no TK_ function");
});

t("go: navigates, closes details and opens the demo task, nothing else", () => {
  const calls = [];
  const timers = [];
  const state = {
    drawerId: "x1",
    deskTaskId: null,
    tasks: {
      a: { id: "a", text: "Reconcile bank", parent_id: null },
      b: { id: "b", text: "[Demo] Send monthly reports", parent_id: null },
      c: { id: "c", text: "[Demo] sub", parent_id: "b" },
    },
    lists: { "client:grace-community": { ids: ["a", "c", "b"] } },
  };
  global.window = { location: { hash: "#/tasks/my" } };
  global.TK_store = { getState: () => state };
  global.TK_dwDispatch = (a) => {
    calls.push(["dispatch", a]);
    state.drawerId = null;
  };
  global.TK_vOpenTask = (id, o) => calls.push(["open", id, o]);
  global.TK_slateInApp = () => false;
  const realSet = global.setTimeout;
  global.setTimeout = (fn) => timers.push(fn);
  try {
    // Already there, nothing open: false, nothing called.
    state.drawerId = null;
    assert.strictEqual(L.TOUR_slNav("#/tasks/my")(), false);
    assert.strictEqual(calls.length, 0);
    // A task open: it is closed, then the hash moves.
    state.drawerId = "x1";
    L.TOUR_slNav("#/tasks/review")();
    assert.deepStrictEqual(calls[0], ["dispatch", { type: "drawer", id: null }]);
    assert.strictEqual(window.location.hash, "#/tasks/review");
    // Settings outside the app stays on My Slate.
    L.TOUR_slSettings()();
    assert.strictEqual(window.location.hash, "#/tasks/my");
    global.TK_slateInApp = () => true;
    L.TOUR_slSettings()();
    assert.strictEqual(window.location.hash, "#/tasks/settings");
    // The demo task: Pro Test Client's list, then its first [Demo] task.
    calls.length = 0;
    L.TOUR_slOpenDemo()();
    assert.strictEqual(window.location.hash, "#/tasks/c/grace-community");
    while (timers.length) timers.shift()();
    assert.deepStrictEqual(calls, [["open", "b", { from: "list" }]]);
    // Already open: not opened again.
    calls.length = 0;
    state.drawerId = "b";
    L.TOUR_slOpenDemo()();
    while (timers.length) timers.shift()();
    assert.deepStrictEqual(calls, []);
    // No list: gives up quietly.
    state.drawerId = null;
    state.lists = {};
    L.TOUR_slOpenDemo()();
    let guard = 0;
    while (timers.length && guard++ < 100) timers.shift()();
    assert.deepStrictEqual(calls, []);
    // Every step's go runs with these stubs and only ever does the above.
    state.lists = { "client:grace-community": { ids: ["a", "b"] } };
    calls.length = 0;
    L.TOUR_slateSteps(admin).forEach((s) => {
      s.go();
      while (timers.length) timers.shift()();
    });
    calls.forEach((c) => assert.ok(c[0] === "dispatch" || (c[0] === "open" && c[1] === "b"), JSON.stringify(c)));
  } finally {
    global.setTimeout = realSet;
    delete global.window;
    delete global.TK_store;
    delete global.TK_dwDispatch;
    delete global.TK_vOpenTask;
    delete global.TK_slateInApp;
  }
});

t("hash: ?tour=slate asks for the tour", () => {
  assert.ok(L.TOUR_slateHashAsks("#/tasks/my?tour=slate"));
  assert.ok(L.TOUR_slateHashAsks("#/tasks?tour=slate"));
  assert.ok(L.TOUR_slateHashAsks("#/tasks/c/x?item=t:1&tour=slate"));
  assert.ok(!L.TOUR_slateHashAsks("#/tasks/my"));
  assert.ok(!L.TOUR_slateHashAsks("#/tasks/my?tour=slates"));
  assert.ok(!L.TOUR_slateHashAsks("#/today?tour=slate"));
  assert.ok(!L.TOUR_slateHashAsks(null));
  assert.strictEqual(L.TOUR_slHashPath("#/tasks/my?tour=slate"), "#/tasks/my");
});

t("pick: first top-level [Demo] task, else the first top-level, else null", () => {
  assert.strictEqual(
    L.TOUR_slPickTask([
      { id: 1, text: "A", parent_id: null },
      { id: 2, text: "[Demo] sub", parent_id: 9 },
      { id: 3, text: "[demo] B" },
      { id: 4, text: "[Demo] gone", deleted_at: "2026-01-01" },
    ]),
    "3",
  );
  assert.strictEqual(L.TOUR_slPickTask([{ id: 5, text: "Plain" }, { id: 6, text: "[Demo] x", deleted_at: "x" }]), "5");
  assert.strictEqual(L.TOUR_slPickTask([{ id: 7, text: "[Demo] sub", parent_id: 1 }]), null);
  assert.strictEqual(L.TOUR_slPickTask(null), null);
  assert.strictEqual(L.TOUR_SLATE_CLIENT, "grace-community");
});

t("wiring: Tour.jsx registers the tour, the notice runs it, the app mounts the root", () => {
  const tour = fs.readFileSync(path.join(__dirname, "Tour.jsx"), "utf8");
  assert.ok(/key: "slate",\s*\n\s*setting: "slateTour"/.test(tour));
  assert.ok(/window\.TK_replaySlateTour = /.test(tour));
  assert.ok(/TOUR_openSlateApp|TK_openSlateApp\("#\/tasks\/my\?tour=slate"\)/.test(tour));
  const app = fs.readFileSync(path.join(ROOT, "app.jsx"), "utf8");
  assert.ok(/<TOUR_StaffRoot\s+shell\b/.test(app));
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  assert.ok(html.indexOf('"components/tour/TOUR_slateLogic.js"') >= 0 && html.indexOf('"components/tour/TOUR_slateLogic.js"') < html.indexOf('"components/tour/Tour.jsx"'));
  const { ANN_REGISTRY } = require("./announcements.js");
  const a = ANN_REGISTRY.find((x) => x.id === "slate-start-to-finish");
  assert.ok(a && a.tourKey === "slate" && a.date === "2026-10-26");
  assert.deepStrictEqual(a.roles, ["admin", "tempAdmin", "bookkeeper", "accountManager"]);
  assert.ok(!/rhythm/i.test(a.summary + JSON.stringify(a.steps({}).map((s) => s.body()))));
});

console.log("TOUR_slateLogic: " + n + " checks passed");
