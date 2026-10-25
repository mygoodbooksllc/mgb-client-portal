// Plain node, no framework: `node components/workbench/WB_store.test.js`.
// Runs WB_logic.js + WB_store.js (browser files) in a vm sandbox with a fake
// window, localStorage, clock and timers, and guards the hub state in the
// store: saved per person (mgb_wb_hub:<email>), the old unscoped key ignored
// and removed, writes throttled to one per 500 ms, a flush on pagehide and
// close, reopen only on the same page without an arrival link, and
// WB_hubOpen logging "open-in-place" only when the task drawer really opens,
// and (H3) Reply asking the app for the chat drawer (falling back to the page
// when the app declines) and Open file opening Drive in a new tab.

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
  const events = [];
  const opens = [];
  const popup = { location: { href: "" }, opener: "page", closed: false, close() { this.closed = true; } };
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
    dispatchEvent: (ev) => {
      events.push(ev);
      (listeners[ev && ev.type] || []).forEach((fn) => fn(ev));
      return true;
    },
    open: (url, target, feat) => {
      opens.push([url, target, feat]);
      return o.popup === false ? null : popup;
    },
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
    CustomEvent: function (type, init) {
      this.type = type;
      this.detail = init && init.detail;
    },
    setTimeout: (fn, ms) => {
      timers.push({ fn, ms, id: timers.length + 1, live: true });
      return timers.length;
    },
    clearTimeout: (id) => {
      if (timers[id - 1]) timers[id - 1].live = false;
    },
    setInterval: () => 0,
    clearInterval: () => {},
    // Like TK_DrawerHost: answers with tk:drawer-open in the same dispatch,
    // unless the test says the host is not listening.
    TK_openTask: (id, opts) => {
      opened.push([id, opts]);
      if (o.hostAnswers !== false) win.dispatchEvent({ type: "tk:drawer-open", detail: { id: String(id) } });
    },
    TK_dwState: () => ({ schema: o.schema || "ok" }),
    TK_dlOpenTarget: (c) => (c.schema === "ok" && c.hostReady === true ? "drawer" : "legacy"),
    LK_go: (t, hint) => went.push([t, hint]),
    LK_href: () => "#/x",
  };
  if (o.drvLink) sandbox.DRV_link = o.drvLink;
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
    events,
    opens,
    popup,
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

t("switching people with a save pending: the first person's state is flushed to their own key, never to the next one's", () => {
  const c = load();
  c.S.join("pat@example.com", false);
  c.S.setHub({ chip: "task" });
  assert.strictEqual(c.pending(), 1);
  c.S.join("sam@example.com", false);
  assert.strictEqual(JSON.parse(c.store[K("pat@example.com")]).chip, "task", "Pat's pending change was flushed to Pat's key");
  assert.strictEqual(c.S.getState().hub.chip, "all", "Sam starts clean");
  c.fire(); // any leftover timer must not write Pat's state under Sam
  const sam = c.store[K("sam@example.com")];
  assert.ok(sam === undefined || JSON.parse(sam).chip !== "task", "Sam's key never holds Pat's filter");
  c.S.setHub({ chip: "doc" });
  c.S.flushHub();
  assert.strictEqual(JSON.parse(c.store[K("sam@example.com")]).chip, "doc");
  assert.strictEqual(JSON.parse(c.store[K("pat@example.com")]).chip, "task");
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

  // Host looks ready but nothing answers tk:open-task: the click must not do
  // nothing. It goes to the task's page (closing the Desk) instead.
  const f = load({ hostAnswers: false });
  f.S.join("pat@example.com", false);
  f.S.setDrawerOpen(true);
  assert.strictEqual(f.sandbox.WB_hubOpen(row, "open"), false);
  assert.strictEqual(f.opened.length, 1);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(f.tracked)), [["wb-action", "task:open"]]);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(f.went)), [[{ place: "work", tab: "tasks", item: "task:t1" }, null]]);
  assert.strictEqual(f.S.getState().drawerOpen, false);

  // Hub closed (Today's own list): normal open, never in place.
  const e = load();
  e.S.join("pat@example.com", false);
  assert.strictEqual(e.sandbox.WB_hubOpen(row, "open"), false);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(e.tracked)), [["wb-action", "task:open"]]);
});

// ---- H3: Reply and Open file -----------------------------------------------------
const plain = (x) => JSON.parse(JSON.stringify(x));
const msgRow = { item_key: "message:message:m1", kind: "message", source: "message", source_id: "m1", client_id: "c9", participant_email: "pat@client.com" };
const fileRow = { item_key: "doc:doc_upload:f1", kind: "doc_upload", source: "doc", source_id: "f1", client_id: "c9" };

t("Reply asks the app for the chat drawer and stays on the page when it takes it", () => {
  const c = load();
  c.S.join("pat@example.com", false);
  c.S.setDrawerOpen(true);
  c.listeners["mgb:open-chat"] = [(ev) => (ev.detail.handled = true)];
  assert.strictEqual(c.sandbox.WB_hubOpen(msgRow, "open"), true);
  const ev = c.events.filter((e) => e.type === "mgb:open-chat");
  assert.strictEqual(ev.length, 1);
  assert.deepStrictEqual(plain({ c: ev[0].detail.clientId, e: ev[0].detail.email }), { c: "c9", e: "pat@client.com" });
  assert.strictEqual(c.went.length, 0, "the page does not change");
  assert.strictEqual(c.S.getState().drawerOpen, true, "the hub stays open");
  assert.strictEqual(c.S.getState().hub.lastFocus, "message:message:m1", "focus returns to this row");
  assert.deepStrictEqual(plain(c.tracked), [["wb-action", "message:reply-in-place"]]);
});

t("Reply falls back to the thread's page when the app declines (staff chat off, Inbox page)", () => {
  const c = load();
  c.S.join("pat@example.com", false);
  c.S.setDrawerOpen(true);
  c.listeners["mgb:open-chat"] = [() => {}]; // listener present but declines
  assert.strictEqual(c.sandbox.WB_hubOpen(msgRow, "open"), false);
  assert.strictEqual(c.went.length, 1);
  assert.deepStrictEqual(plain(c.tracked), [["wb-action", "message:reply"]]);
  // No listener at all: same.
  const d = load();
  d.S.join("pat@example.com", false);
  d.S.setDrawerOpen(true);
  assert.strictEqual(d.sandbox.WB_hubOpen(msgRow, "open"), false);
  assert.strictEqual(d.went.length, 1);
});

t("Reply never asks for the chat drawer when the hub is closed or the row has no client", () => {
  const c = load();
  c.S.join("pat@example.com", false);
  c.listeners["mgb:open-chat"] = [(ev) => (ev.detail.handled = true)];
  assert.strictEqual(c.sandbox.WB_hubOpen(msgRow, "open"), false, "hub closed: Today's own list");
  assert.strictEqual(c.events.filter((e) => e.type === "mgb:open-chat").length, 0);
  c.S.setDrawerOpen(true);
  assert.strictEqual(c.sandbox.WB_hubOpen(Object.assign({}, msgRow, { client_id: null }), "open"), false);
  assert.strictEqual(c.events.filter((e) => e.type === "mgb:open-chat").length, 0);
});

const later = [];
function ta(name, fn) {
  later.push(
    fn().then(
      () => {
        n++;
      },
      (e) => {
        console.error("FAIL " + name);
        throw e;
      },
    ),
  );
}
const tick = () => new Promise((r) => setImmediate(r));

ta("Open file opens Drive in a new tab, opened first and pointed at the link", async () => {
  const asked = [];
  const c = load({ drvLink: (id) => (asked.push(id), Promise.resolve("https://drive.google.com/file/d/abc/view")) });
  c.S.join("pat@example.com", false);
  c.S.setDrawerOpen(true);
  assert.strictEqual(c.sandbox.WB_hubOpen(fileRow, "open"), true);
  assert.deepStrictEqual(plain(c.opens), [["", "_blank", null]], "the tab opens inside the click");
  assert.strictEqual(c.popup.opener, null, "the new tab can't reach back");
  await tick();
  assert.deepStrictEqual(asked, ["f1"]);
  assert.strictEqual(c.popup.location.href, "https://drive.google.com/file/d/abc/view");
  assert.strictEqual(c.popup.closed, false);
  assert.strictEqual(c.went.length, 0, "the page does not change");
  assert.strictEqual(c.S.getState().drawerOpen, true);
  assert.strictEqual(c.S.getState().hub.lastFocus, "doc:doc_upload:f1");
  assert.deepStrictEqual(plain(c.tracked), [["wb-action", "doc_upload:open-in-drive"]]);
});

ta("Open file: a failed link closes the blank tab and says so; nothing navigates", async () => {
  const c = load({ drvLink: () => Promise.reject(new Error("That file isn't available.")) });
  c.S.join("pat@example.com", false);
  c.S.setDrawerOpen(true);
  assert.strictEqual(c.sandbox.WB_hubOpen(fileRow, "open"), true);
  await tick();
  assert.strictEqual(c.popup.closed, true);
  assert.strictEqual(c.popup.location.href, "");
  const toast = c.events.filter((e) => e.type === "mgb:toast");
  assert.strictEqual(toast.length, 1);
  assert.ok(/That file isn't available/.test(toast[0].detail.text));
  assert.strictEqual(c.went.length, 0);
  assert.strictEqual(c.tracked.length, 0, "a failed open is not logged as opened");
});

ta("Open file: a link that isn't https is refused", async () => {
  const c = load({ drvLink: () => Promise.resolve("javascript:alert(1)") });
  c.S.join("pat@example.com", false);
  c.S.setDrawerOpen(true);
  c.sandbox.WB_hubOpen(fileRow, "open");
  await tick();
  assert.strictEqual(c.popup.closed, true);
  assert.strictEqual(c.popup.location.href, "");
  assert.strictEqual(c.events.filter((e) => e.type === "mgb:toast").length, 1);
});

ta("Open file: pop-ups blocked says so once, without asking Drive or opening a second window", async () => {
  const asked = [];
  const c = load({ popup: false, drvLink: (id) => (asked.push(id), Promise.resolve("https://drive.google.com/x")) });
  c.S.join("pat@example.com", false);
  c.S.setDrawerOpen(true);
  assert.strictEqual(c.sandbox.WB_hubOpen(fileRow, "open"), true);
  await tick();
  assert.strictEqual(c.opens.length, 1, "no second window.open after the link arrives");
  assert.deepStrictEqual(asked, [], "Drive isn't asked when there is no tab to show it in");
  const toast = c.events.filter((e) => e.type === "mgb:toast");
  assert.strictEqual(toast.length, 1);
  assert.ok(/blocked/.test(toast[0].detail.text));
  assert.strictEqual(c.tracked.length, 0);
  assert.strictEqual(c.went.length, 0);
});

ta("Open file options (Desk Client tab): failHint replaces the ⋯ menu text, track:false skips the open-in-drive event", async () => {
  const ok = load({ drvLink: () => Promise.resolve("https://drive.google.com/x") });
  ok.S.join("pat@example.com", false);
  assert.strictEqual(await ok.sandbox.WB__openDriveFile("f1", { failHint: "Try again.", track: false }), true);
  assert.strictEqual(ok.popup.location.href, "https://drive.google.com/x");
  assert.strictEqual(ok.tracked.length, 0);
  const bad = load({ drvLink: () => Promise.resolve("javascript:alert(1)") });
  bad.S.join("pat@example.com", false);
  assert.strictEqual(await bad.sandbox.WB__openDriveFile("f1", { failHint: "Open it from the client's Documents." }), false);
  let toast = bad.events.filter((e) => e.type === "mgb:toast");
  assert.strictEqual(toast.length, 1);
  assert.ok(/Documents/.test(toast[0].detail.text) && !/⋯/.test(toast[0].detail.text));
  const err = load({ drvLink: () => Promise.reject(new Error("Gone")) });
  err.S.join("pat@example.com", false);
  assert.strictEqual(await err.sandbox.WB__openDriveFile("f1", { failHint: "Try again." }), false);
  toast = err.events.filter((e) => e.type === "mgb:toast");
  assert.ok(/Gone\. Try again\./.test(toast[0].detail.text) && !/⋯/.test(toast[0].detail.text));
  // No options: today's Inbox text and tracking.
  const plainCase = load({ drvLink: () => Promise.reject(new Error("Gone")) });
  plainCase.S.join("pat@example.com", false);
  await plainCase.sandbox.WB__openDriveFile("f1");
  assert.ok(/⋯ menu/.test(plainCase.events.filter((e) => e.type === "mgb:toast")[0].detail.text));
});

ta("Open file falls back to the Files page when Drive helpers aren't loaded or the hub is closed", async () => {
  const a = load(); // no DRV_link
  a.S.join("pat@example.com", false);
  a.S.setDrawerOpen(true);
  assert.strictEqual(a.sandbox.WB_hubOpen(fileRow, "open"), false);
  assert.strictEqual(a.went.length, 1);
  assert.strictEqual(a.opens.length, 0);
  const b = load({ drvLink: () => Promise.resolve("https://x.test/") });
  b.S.join("pat@example.com", false);
  assert.strictEqual(b.sandbox.WB_hubOpen(fileRow, "open"), false, "hub closed");
  assert.strictEqual(b.went.length, 1);
  assert.strictEqual(b.opens.length, 0);
});

// ---- Client tab (H4) ----
t("Client tab pins: saved per person, newest first, capped, cleared when empty, tracked", () => {
  const c = load({ ls: { "mgb_wb_pins:sam@mgb.com": '{"v":1,"pins":["z9"]}' } });
  const P = (e) => "mgb_wb_pins:" + e;
  assert.deepStrictEqual(plain(c.sandbox.WB_pinsRead("Pat@MGB.com")), []);
  let r = c.sandbox.WB_pinToggle("Pat@MGB.com", "c1");
  assert.strictEqual(r.on, true);
  r = c.sandbox.WB_pinToggle("pat@mgb.com", "c2");
  assert.deepStrictEqual(plain(r.pins), ["c2", "c1"]);
  assert.deepStrictEqual(JSON.parse(c.store[P("pat@mgb.com")]), { v: 1, pins: ["c2", "c1"] });
  // Someone else on this browser keeps their own pins.
  assert.deepStrictEqual(plain(c.sandbox.WB_pinsRead("sam@mgb.com")), ["z9"]);
  for (let i = 0; i < 10; i++) c.sandbox.WB_pinToggle("pat@mgb.com", "x" + i);
  assert.strictEqual(c.sandbox.WB_pinsRead("pat@mgb.com").length, 8);
  assert.strictEqual(c.sandbox.WB_pinsRead("pat@mgb.com")[0], "x9");
  // Unpinning the last one removes the key.
  c.sandbox.WB_pinsWrite("pat@mgb.com", ["c1"]);
  r = c.sandbox.WB_pinToggle("pat@mgb.com", "c1");
  assert.strictEqual(r.on, false);
  assert.ok(!Object.prototype.hasOwnProperty.call(c.store, P("pat@mgb.com")));
  assert.deepStrictEqual(plain(c.tracked.slice(0, 2)), [
    ["wb-pin", "on"],
    ["wb-pin", "on"],
  ]);
  assert.deepStrictEqual(plain(c.tracked[c.tracked.length - 1]), ["wb-pin", "off"]);
  // No email: nothing is written.
  c.sandbox.WB_pinToggle("", "c1");
  assert.ok(Object.keys(c.store).every((k) => k.indexOf("mgb_wb_pins:") !== 0 || k === P("sam@mgb.com")));
});

t("Client tab pins: toggle works from the pins on screen, so unpin works while storage is blocked", () => {
  const c = load();
  const blocked = () => {
    throw new Error("SecurityError");
  };
  c.win.localStorage = { getItem: blocked, setItem: blocked, removeItem: blocked };
  // Storage reads as empty, but the tab's own pins say c1 is pinned.
  assert.deepStrictEqual(plain(c.sandbox.WB_pinsRead("pat@mgb.com")), []);
  let r = c.sandbox.WB_pinToggle("pat@mgb.com", "c1", ["c1", "c2"]);
  assert.strictEqual(r.on, false);
  assert.deepStrictEqual(plain(r.pins), ["c2"]);
  r = c.sandbox.WB_pinToggle("pat@mgb.com", "c3", plain(r.pins));
  assert.strictEqual(r.on, true);
  assert.deepStrictEqual(plain(r.pins), ["c3", "c2"]);
  // Pins for clients missing from a partial list are never touched by a toggle.
  r = c.sandbox.WB_pinToggle("pat@mgb.com", "c9", ["gone1", "gone2"]);
  assert.deepStrictEqual(plain(r.pins), ["c9", "gone1", "gone2"]);
});

t("Client tab recents: the client switcher's own per-person list, when it is loaded", () => {
  const c = load();
  assert.deepStrictEqual(plain(c.sandbox.WB_recentsRead("pat@mgb.com")), []); // switcher not loaded
  assert.deepStrictEqual(plain(c.sandbox.WB_recentsPush("pat@mgb.com", "c1")), []);
  const lsKeys = [];
  c.sandbox.CS_RECENT_KEY = "mgb-client-switcher-recent";
  c.sandbox.CS_readRecent = (k) => {
    lsKeys.push(k);
    return JSON.parse(c.store[k] || "[]");
  };
  c.sandbox.CS_pushRecent = (k, id) => {
    const next = [id].concat(JSON.parse(c.store[k] || "[]").filter((x) => x !== id));
    c.store[k] = JSON.stringify(next);
    return next;
  };
  assert.deepStrictEqual(plain(c.sandbox.WB_recentsPush("Pat@MGB.com", 7)), ["7"]);
  assert.deepStrictEqual(plain(c.sandbox.WB_recentsRead("pat@mgb.com")), ["7"]);
  assert.strictEqual(lsKeys[0], "mgb-client-switcher-recent:pat@mgb.com");
});

t("R1 Desk width: per person, saved at once, v1 migrates, junk reads as Standard", () => {
  const D = (e) => "mgb_wb_desk:" + e;
  const c = load();
  // Before anyone joins: the state changes but nothing is written.
  c.S.setDeskWidth(460);
  assert.strictEqual(c.S.getState().desk.right.w, 460);
  assert.strictEqual(Object.keys(c.store).length, 0);
  c.store[D("pat@example.com")] = '{"v":2,"dock":"right","right":{"w":420}}';
  c.S.join("pat@example.com", false);
  assert.strictEqual(c.S.getState().desk.right.w, 420, "Pat's saved width is read on join");
  c.S.setDeskWidth(500);
  assert.strictEqual(c.store[D("pat@example.com")], '{"v":2,"dock":"right","right":{"w":500}}', "saved at once, no throttle");
  c.S.setDeskWidth(9000);
  assert.strictEqual(c.S.getState().desk.right.w, 520, "kept inside 320-520");
  c.S.setDeskWidth("nope");
  assert.strictEqual(c.S.getState().desk.right.w, 520, "a bad value keeps the current width");
  // Sam on the same browser has their own width (none saved: Standard, and nothing written).
  c.S.join("sam@example.com", false);
  assert.strictEqual(c.S.getState().desk.right.w, 380);
  assert.strictEqual(c.store[D("sam@example.com")], undefined);
  // A D3 (v1) height migrates to the v2 default and is rewritten once.
  c.store[D("kim@example.com")] = '{"v":1,"snap":"tall"}';
  c.S.join("kim@example.com", false);
  assert.strictEqual(c.S.getState().desk.right.w, 380);
  assert.strictEqual(c.store[D("kim@example.com")], '{"v":2,"dock":"right","right":{"w":380}}');
  c.store[D("lee@example.com")] = "garbage";
  c.S.join("lee@example.com", false);
  assert.strictEqual(c.S.getState().desk.right.w, 380);
  // The hub blob never carries the width.
  c.S.setDrawerOpen(true);
  c.S.flushHub();
  assert.ok(c.store[K("lee@example.com")].indexOf("right") < 0);
});

t("D3 openedBy: a page-load reopen says restore; a click or key says who", () => {
  const c = load({ hash: "#/today" });
  c.store[K("pat@example.com")] = c.sandbox.WB_hubSerialize({ open: true, tab: "tasks" }, c.now() - 60000, "#/today");
  c.S.join("pat@example.com", false);
  assert.strictEqual(c.S.getState().drawerOpen, true);
  assert.strictEqual(c.S.getState().openedBy, "restore");
  c.S.setDrawerOpen(false);
  assert.strictEqual(c.S.getState().openedBy, "");
  c.S.setDrawerOpen(true, "key");
  assert.strictEqual(c.S.getState().openedBy, "key");
  c.S.setDrawerOpen(false);
  c.S.setDrawerOpen(true);
  assert.strictEqual(c.S.getState().openedBy, "");
  const closed = load({ hash: "#/clients" });
  closed.store[K("pat@example.com")] = closed.sandbox.WB_hubSerialize({ open: true }, closed.now() - 60000, "#/today");
  closed.S.join("pat@example.com", false);
  assert.strictEqual(closed.S.getState().openedBy, "");
});

// ---- R2: the drill stack -------------------------------------------------------
t("R2 drill: a closed Desk opens on the task and closes again when it is left", () => {
  const c = load();
  c.S.join("pat@example.com", false);
  assert.strictEqual(c.S.getState().drawerOpen, false);
  assert.strictEqual(c.S.drill("t1", { from: "slate" }), true);
  let st = c.S.getState();
  assert.strictEqual(st.drawerOpen, true);
  assert.strictEqual(st.openedBy, "drill");
  assert.deepStrictEqual(plain(st.drill), [{ id: "t1", from: "slate", focus: null }]);
  assert.strictEqual(st.drillOrigin.closeOnEmpty, true);
  // Subtask: pushes; the origin is kept.
  c.S.drill("t2", { from: "subtask" });
  st = c.S.getState();
  assert.strictEqual(st.drill.length, 2);
  assert.strictEqual(st.drillOrigin.closeOnEmpty, true);
  // Same id on top: focus only, no new level.
  c.S.drill("t2", { focus: "assignee" });
  assert.strictEqual(c.S.getState().drill.length, 2);
  assert.strictEqual(c.S.getState().drill[1].focus, "assignee");
  assert.strictEqual(c.S.drillBack(), 1);
  assert.strictEqual(c.S.drillBack(), 0);
  assert.strictEqual(c.S.drillBack(), 0);
  assert.strictEqual(c.S.drill("", {}), false);
});

t("R2 drill: an open Desk goes back to its list (closeOnEmpty false), cap 5", () => {
  const c = load();
  c.S.join("pat@example.com", false);
  c.S.setHub({ tab: "tasks" });
  c.S.setDrawerOpen(true, "key");
  c.S.drill("a", { from: "wb-hub" });
  const st = c.S.getState();
  assert.strictEqual(st.openedBy, "key");
  assert.strictEqual(st.drillOrigin.closeOnEmpty, false);
  assert.strictEqual(st.drillOrigin.tab, "tasks");
  ["b", "c", "d", "e", "f", "g"].forEach((id) => c.S.drill(id, { from: "subtask" }));
  assert.deepStrictEqual(plain(c.S.getState().drill.map((x) => x.id)), ["c", "d", "e", "f", "g"]);
  c.S.drillClear();
  assert.strictEqual(c.S.getState().drill.length, 0);
  assert.strictEqual(c.S.getState().drawerOpen, true);
});

t("R2 drill: closing keeps the stack for 5 minutes; a page drill on a closed Desk starts over", () => {
  const c = load();
  c.S.join("pat@example.com", false);
  c.S.drill("a");
  c.S.drill("b", { from: "subtask" });
  c.S.setDrawerOpen(false); // D in the task view
  assert.strictEqual(c.S.getState().drill.length, 2);
  assert.ok(c.S.getState().drillClosedAt > 0);
  c.advance(60000);
  c.S.setDrawerOpen(true, "key");
  assert.strictEqual(c.S.getState().drill.length, 2);
  assert.strictEqual(c.S.getState().drillClosedAt, 0);
  c.S.setDrawerOpen(false);
  c.advance(5 * 60 * 1000 + 1);
  c.S.setDrawerOpen(true, "key");
  assert.strictEqual(c.S.getState().drill.length, 0);
  // Closed with a kept stack, then a task opened from the page: a new stack.
  c.S.drill("x");
  c.S.setDrawerOpen(false);
  c.S.drill("y", { from: "slate" });
  assert.deepStrictEqual(plain(c.S.getState().drill.map((x) => x.id)), ["y"]);
  assert.strictEqual(c.S.getState().drillOrigin.closeOnEmpty, true);
  // A new person: no stack carried over.
  c.S.join("sam@example.com", false);
  assert.strictEqual(c.S.getState().drill.length, 0);
});

t("the hub saves under mgb_wb_hub:<email> and removes the old unscoped key", () => {
  const p = load({ ls: { mgb_wb_hub: "old" } });
  p.S.join("pat@example.com", false);
  p.S.setDrawerOpen(true, "key");
  p.S.flushHub();
  assert.ok(p.store["mgb_wb_hub:pat@example.com"]);
  assert.strictEqual(p.store["mgb_wb_hub"], undefined);
  assert.strictEqual(p.sandbox.WB_hubKey("A@b.co"), "mgb_wb_hub:a@b.co");
});

Promise.all(later).then(
  () => console.log("WB_store: " + n + " checks passed"),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
