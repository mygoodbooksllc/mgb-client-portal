// Plain node, no framework: `node components/workbench/WB_store.test.js`.
// Runs WB_logic.js + WB_store.js (browser files) in a vm sandbox with a fake
// window, localStorage, clock and timers, and guards the hub state in the
// store: saved per person (mgb_wb_hub:<email>), the old unscoped key ignored
// and removed, writes throttled to one per 500 ms, a flush on pagehide and
// close, reopen only on the same page without an arrival link, and
// WB_hubOpen logging "open-in-place" only when the task drawer really opens.

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

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

function load(opts) {
  const o = opts || {};
  const store = Object.assign({}, o.ls || {});
  let clock = o.now || Date.parse("2026-10-16T15:00:00Z");
  const timers = [];
  const listeners = {};
  const tracked = [];
  const opened = [];
  const went = [];
  const win = {
    localStorage: {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
      setItem: (k, v) => {
        store[k] = String(v);
      },
      removeItem: (k) => {
        delete store[k];
      },
    },
    location: { hash: o.hash || "#/today" },
    addEventListener: (ev, fn) => {
      (listeners[ev] = listeners[ev] || []).push(fn);
    },
    removeEventListener: () => {},
    dispatchEvent: () => true,
    MGB_track: (name, detail) => tracked.push([name, detail]),
    TK_drawerHostReady: o.hostReady !== false,
  };
  class FakeDate extends Date {
    static now() {
      return clock;
    }
  }
  const sandbox = {
    window: win,
    document: { hidden: false, addEventListener() {}, removeEventListener() {} },
    Date: FakeDate,
    console,
    CustomEvent: function () {},
    setTimeout: (fn, ms) => {
      timers.push({ fn, ms, id: timers.length + 1, live: true });
      return timers.length;
    },
    clearTimeout: (id) => {
      if (timers[id - 1]) timers[id - 1].live = false;
    },
    setInterval: () => 0,
    clearInterval: () => {},
    TK_openTask: (id, opts) => opened.push([id, opts]),
    TK_dwState: () => ({ schema: o.schema || "ok" }),
    TK_dlOpenTarget: (c) => (c.schema === "ok" && c.hostReady === true ? "drawer" : "legacy"),
    LK_go: (t, hint) => went.push([t, hint]),
    LK_href: () => "#/x",
  };
  win.window = win;
  vm.createContext(sandbox);
  const dir = __dirname;
  ["WB_logic.js", "WB_store.js"].forEach((f) => vm.runInContext(fs.readFileSync(path.join(dir, f), "utf8"), sandbox, { filename: f }));
  // Top-level `var`/`function` declarations become properties of the sandbox.
  const ctx = {
    S: sandbox.WB_store,
    sandbox,
    store,
    tracked,
    opened,
    went,
    win,
    listeners,
    advance(ms) {
      clock += ms;
    },
    pending() {
      return timers.filter((x) => x.live).length;
    },
    fire() {
      timers.filter((x) => x.live).forEach((x) => {
        x.live = false;
        x.fn();
      });
    },
    now: () => clock,
  };
  return ctx;
}

const K = (e) => "mgb_wb_hub:" + e;

t("no one joined yet: nothing is saved, nothing scheduled", () => {
  const c = load();
  c.S.setHub({ chip: "task" });
  c.S.flushHub();
  assert.strictEqual(Object.keys(c.store).length, 0);
  assert.strictEqual(c.pending(), 0);
});

t("saved state is per person; the old unscoped key is ignored and removed", () => {
  const c = load();
  const old = c.sandbox.WB_hubSerialize({ open: true, tab: "tasks", chip: "message", scroll: { inbox: 300, tasks: 0, client: 0 } }, c.now(), "#/today");
  c.store["mgb_wb_hub"] = old;
  c.S.join("pat@example.com", false);
  const h = c.S.getState().hub;
  assert.strictEqual(h.chip, "all", "old unscoped key is not inherited");
  assert.strictEqual(h.scroll.inbox, 0);
  assert.strictEqual(c.S.getState().drawerOpen, false);
  assert.strictEqual("mgb_wb_hub" in c.store, false, "old key removed");

  // Pat leaves a filter and the panel open; Sam on the same browser starts clean.
  c.S.setHub({ chip: "task" });
  c.S.setDrawerOpen(true);
  c.S.flushHub();
  assert.ok(c.store[K("pat@example.com")], "saved under Pat's key");
  c.S.join("sam@example.com", false);
  assert.strictEqual(c.S.getState().hub.chip, "all");
  assert.strictEqual(c.S.getState().drawerOpen, false);
  c.S.setHub({ chip: "doc" });
  c.S.flushHub();
  assert.strictEqual(JSON.parse(c.store[K("sam@example.com")]).chip, "doc");
  assert.strictEqual(JSON.parse(c.store[K("pat@example.com")]).chip, "task", "Pat's save is untouched by Sam");
  // Pat comes back (no reload): their own state returns, still open on the same page.
  c.S.join("pat@example.com", false);
  assert.strictEqual(c.S.getState().hub.chip, "task");
  assert.strictEqual(c.S.getState().drawerOpen, true);
});

t("reopen only on the same page, and not on an arrival link", () => {
  const same = load({ hash: "#/today" });
  same.store[K("pat@example.com")] = same.sandbox.WB_hubSerialize({ open: true, tab: "tasks" }, same.now() - 60000, "#/today");
  same.S.join("pat@example.com", false);
  assert.strictEqual(same.S.getState().drawerOpen, true);
  assert.strictEqual(same.S.getState().hub.tab, "tasks");

  const other = load({ hash: "#/clients" });
  other.store[K("pat@example.com")] = other.sandbox.WB_hubSerialize({ open: true, tab: "tasks" }, other.now() - 60000, "#/today");
  other.S.join("pat@example.com", false);
  assert.strictEqual(other.S.getState().drawerOpen, false);
  assert.strictEqual(other.S.getState().hub.tab, "tasks", "tab is still remembered");

  const arrival = load({ hash: "#/today?item=task:1" });
  arrival.store[K("pat@example.com")] = arrival.sandbox.WB_hubSerialize({ open: true }, arrival.now() - 60000, "#/today");
  arrival.S.join("pat@example.com", false);
  assert.strictEqual(arrival.S.getState().drawerOpen, false);
});

t("writes are throttled to one per 500 ms and the last value wins", () => {
  const c = load();
  c.S.join("pat@example.com", false);
  c.S.setHub({ chip: "task" });
  assert.strictEqual(c.pending(), 1, "one timer after the first change");
  c.S.setHub({ chip: "message" });
  c.S.setHub({ scroll: { inbox: 120 } }, true);
  assert.strictEqual(c.pending(), 1, "more changes share the timer");
  assert.strictEqual(c.store[K("pat@example.com")], undefined, "nothing written before it fires");
  const timer = c.sandbox.WB_store; // eslint-disable-line no-unused-vars
  c.fire();
  const saved = JSON.parse(c.store[K("pat@example.com")]);
  assert.strictEqual(saved.chip, "message");
  assert.strictEqual(saved.scroll.inbox, 120);
  assert.strictEqual(c.pending(), 0);
  c.S.setHub({ chip: "doc" });
  assert.strictEqual(c.pending(), 1, "a new change after the write starts a new throttle");
});

t("the timer is 500 ms", () => {
  const c = load();
  c.S.join("pat@example.com", false);
  let ms = null;
  const real = c.sandbox.setTimeout;
  c.sandbox.setTimeout = (fn, m) => {
    ms = m;
    return real(fn, m);
  };
  c.S.setHub({ chip: "task" });
  assert.strictEqual(ms, 500);
});

t("pagehide flushes at once; closing the panel flushes too", () => {
  const c = load();
  c.S.join("pat@example.com", false);
  c.S.setHub({ chip: "task" });
  c.S.setDrawerOpen(true);
  assert.strictEqual(c.store[K("pat@example.com")], undefined);
  assert.strictEqual((c.listeners.pagehide || []).length, 1, "pagehide listener registered once");
  c.listeners.pagehide[0]();
  let saved = JSON.parse(c.store[K("pat@example.com")]);
  assert.strictEqual(saved.chip, "task");
  assert.strictEqual(saved.open, true);
  assert.strictEqual(saved.route, "#/today");
  assert.strictEqual(c.pending(), 0, "the pending timer is cleared");
  c.S.setDrawerOpen(false);
  saved = JSON.parse(c.store[K("pat@example.com")]);
  assert.strictEqual(saved.open, false);
});

t("WB_hubOpen logs open-in-place only when the task drawer really opens", () => {
  const row = { item_key: "task:task:1", kind: "task", source: "task", source_id: "t1" };
  // Hub open, drawer ready: opens in place.
  const a = load();
  a.S.join("pat@example.com", false);
  a.S.setDrawerOpen(true);
  assert.strictEqual(a.sandbox.WB_hubOpen(row, "open"), true);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(a.opened)), [["t1", { from: "wb-hub" }]]);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(a.tracked)), [["wb-action", "task:open-in-place"]]);
  assert.strictEqual(a.S.getState().hub.lastFocus, "task:task:1");

  // Task data not ready (schema not ok): falls back to the page, logs a plain open.
  const b = load({ schema: "unknown" });
  b.S.join("pat@example.com", false);
  b.S.setDrawerOpen(true);
  assert.strictEqual(b.sandbox.WB_hubOpen(row, "open"), false);
  assert.strictEqual(b.opened.length, 0);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(b.tracked)), [["wb-action", "task:open"]]);
  assert.strictEqual(b.went.length, 1);

  // Drawer host not mounted: same fallback.
  const d = load({ hostReady: false });
  d.S.join("pat@example.com", false);
  d.S.setDrawerOpen(true);
  assert.strictEqual(d.sandbox.WB_hubOpen(row, "open"), false);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(d.tracked)), [["wb-action", "task:open"]]);

  // Hub closed (Today's own list): normal open, never in place.
  const e = load();
  e.S.join("pat@example.com", false);
  assert.strictEqual(e.sandbox.WB_hubOpen(row, "open"), false);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(e.tracked)), [["wb-action", "task:open"]]);
});

console.log("WB_store: " + n + " checks passed");
