// Plain node, no framework: `node components/workbench/WB_peek.test.js`.
// Guards the Desk client summary and Keep on Desk (WB_peek.js): the gate's
// truth table and switch read, keep storage (garbage, versions, other people,
// 24-hour expiry), the which-client rule, the access check, the whitelist
// shaper (deep key scan), the money guard, the read layer (no request at all
// for a client I can't open), the Desk Customize prefs and Reset Desk, and
// the leak cases from docs/desk-client-peek-spec.md section 12 that can be
// checked without a browser.

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const P = require("./WB_peek.js");
const L0 = require("./WB_logic.js");

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
async function ta(name, fn) {
  try {
    await fn();
  } catch (e) {
    console.error("FAIL " + name);
    throw e;
  }
  n++;
}

const NOW = Date.UTC(2026, 10, 3, 15, 0, 0);
const HOUR = 3600 * 1000;

// ---- Gate truth table ----
const SWITCH_ON = [true, "true", 1, { on: true }];
const SWITCH_OFF = [undefined, null, false, "false", 0, "", "1", {}, { on: false }];

t("gate: Desk off is always off", () => {
  [false, undefined, null, 0, "true", 1].forEach((desk) => {
    [true, false].forEach((pre) => {
      SWITCH_ON.concat(SWITCH_OFF).forEach((sw) => {
        assert.strictEqual(P.WB_peekIsOn(desk, pre, sw), false, JSON.stringify([desk, pre, sw]));
      });
    });
  });
});
t("gate: Desk on + preview is on; Desk on + switch on is on; else off", () => {
  SWITCH_ON.concat(SWITCH_OFF).forEach((sw) => assert.strictEqual(P.WB_peekIsOn(true, true, sw), true));
  SWITCH_ON.forEach((sw) => assert.strictEqual(P.WB_peekIsOn(true, false, sw), true));
  SWITCH_OFF.forEach((sw) => assert.strictEqual(P.WB_peekIsOn(true, false, sw), false, JSON.stringify(sw)));
  assert.strictEqual(P.WB_peekIsOn(true), false);
});
t("gate: names match the spec", () => {
  assert.strictEqual(P.WB_PEEK_PREVIEW_KEY, "mgb_peek_preview");
  assert.strictEqual(P.WB_PEEK_CACHE_KEY, "mgb_peek_cache");
  assert.strictEqual(P.WB_PEEK_EVENT, "mgb:peek");
  assert.strictEqual(P.WB_PEEK_SWITCH, "desk_peek_enabled");
  assert.strictEqual(P.WB_PEEK_TTL_MS, 24 * HOUR);
});

// ---- Keep storage ----
t("storage: key per real email, lowercased; none without an email", () => {
  assert.strictEqual(P.WB_peekKey(" Ana@X.org "), "mgb_wb_peek:ana@x.org");
  assert.strictEqual(P.WB_peekKey(""), null);
  assert.strictEqual(P.WB_peekKey(null), null);
});
t("storage: garbage, old versions and wrong shapes read as nothing kept", () => {
  [null, "", "{", "[]", "null", "42", '"x"', '{"v":2,"keptId":"c1","at":1}', '{"keptId":"c1","at":1}', '{"v":1,"keptId":{"a":1},"at":' + NOW + "}"].forEach((raw) => {
    const s = P.WB_peekParse(raw, NOW);
    assert.strictEqual(s.keptId, null, String(raw));
  });
});
t("storage: a fresh keep reads back; collapsed survives", () => {
  const raw = P.WB_peekSerialize({ keptId: "c1", at: NOW - HOUR, collapsed: true });
  const s = P.WB_peekParse(raw, NOW);
  assert.strictEqual(s.keptId, "c1");
  assert.strictEqual(P.WB_peekParse(JSON.stringify({ v: 1, keptId: null }), NOW).collapsed, null, "never chose");
  assert.strictEqual(s.collapsed, true);
  assert.strictEqual(s.expired, false);
});
t("storage: expiry at 24 hours (and a far-future date) clears with expired = true", () => {
  const just = P.WB_peekParse(P.WB_peekSerialize({ keptId: "c1", at: NOW - 24 * HOUR + 1000 }), NOW);
  assert.strictEqual(just.keptId, "c1");
  const old = P.WB_peekParse(P.WB_peekSerialize({ keptId: "c1", at: NOW - 24 * HOUR - 1000, collapsed: true }), NOW);
  assert.strictEqual(old.keptId, null);
  assert.strictEqual(old.expired, true);
  assert.strictEqual(old.collapsed, true, "the fold is kept when the keep expires");
  const future = P.WB_peekParse(JSON.stringify({ v: 1, keptId: "c1", at: NOW + 48 * HOUR }), NOW);
  assert.strictEqual(future.keptId, null);
  const noAt = P.WB_peekParse(JSON.stringify({ v: 1, keptId: "c1" }), NOW);
  assert.strictEqual(noAt.keptId, null);
});
t("storage: ids too long are refused", () => {
  const s = P.WB_peekParse(JSON.stringify({ v: 1, keptId: "x".repeat(80), at: NOW }), NOW);
  assert.strictEqual(s.keptId, null);
});

// ---- Which client ----
t("which: nothing kept + client page = the page client", () => {
  assert.deepStrictEqual(P.WB_peekWhich({ keptId: null, routeId: "p1", savedId: "s1" }), { id: "p1", from: "route" });
});
t("which: kept + another client's page = the kept client", () => {
  assert.deepStrictEqual(P.WB_peekWhich({ keptId: "k1", routeId: "p1", savedId: "s1" }), { id: "k1", from: "kept" });
});
t("which: Show <page client> on this page visit follows the page; another page goes back to kept", () => {
  assert.deepStrictEqual(P.WB_peekWhich({ keptId: "k1", routeId: "p1", suspendRoute: "p1" }), { id: "p1", from: "route" });
  assert.deepStrictEqual(P.WB_peekWhich({ keptId: "k1", routeId: "p2", suspendRoute: "p1" }), { id: "k1", from: "kept" });
});
t("which: not kept + no page = the last client; nothing = null", () => {
  assert.deepStrictEqual(P.WB_peekWhich({ savedId: "s1" }), { id: "s1", from: "saved" });
  assert.deepStrictEqual(P.WB_peekWhich({}), { id: null, from: null });
});

// ---- Access ----
const MINE = [{ id: "c1", name: "Doxa Church" }, { id: "c2", name: "Grace" }];
t("access: ok / none / unknown", () => {
  assert.strictEqual(P.WB_peekAccess("c1", MINE), "ok");
  assert.strictEqual(P.WB_peekAccess("zz", MINE), "none");
  assert.strictEqual(P.WB_peekAccess("c1", []), "unknown", "list not loaded");
  assert.strictEqual(P.WB_peekAccess("c1", null), "unknown");
  assert.strictEqual(P.WB_peekAccess(null, MINE), "unknown");
  assert.strictEqual(P.WB_peekAccess("", MINE), "unknown");
});
t("which + access: kept and not in my list = the no-access state", () => {
  const w = P.WB_peekWhich({ keptId: "zz", routeId: "c1" });
  assert.strictEqual(w.from, "kept");
  assert.strictEqual(P.WB_peekAccess(w.id, MINE), "none");
});

// ---- Money guard ----
t("money: hidden", () => {
  ["Fee went up in Jan", "$400 a month", "$ 12", "rate change", "Rates are new", "margin low", "invoice late", "Price list", "payment due", "Payments behind", "paid late", "payroll is off", "billing contact", "bill sent", "costs high", "salary question", "wages", "retainer", "discount agreed", "refund", "owes us", "€20", "£5", "1,200 left", "2.5k over", "Raised to 650/mo", "Quoted 1200", "Profit down 20% vs budget", "Revenue 1.2M", "Charging 450 a month", "Hourly is 85", "AR is 40000", "1,5", "Quote sent", "Budget is tight", "Balance looks off", "Please charge them", "Ask about 5k", "Renewal 2026", "They are at 85 an hour"].forEach((s) =>
    assert.strictEqual(P.WB_peekMoney(s), true, s),
  );
});
t("money: shown", () => {
  ["Treasurer changed", "Close Oct by the 10th", "Statements attached", "New pastor starts in May", "Separate the accounts", "Accurate now", "Call Jo first", "Meeting 11/5 at 3:30pm", "Call on 2026-11-05", "Reconcile checking", "Board meets the 3rd", "Send the W-9"].forEach((s) =>
    assert.strictEqual(P.WB_peekMoney(s), false, s),
  );
});

// ---- Shaper ----
const RICH_CLIENT = {
  id: "c1",
  name: "Doxa Church",
  assignedBookkeeper: { name: "Ana Diaz", email: "ana@mgb.org", rate: 55, hourlyRate: 40 },
  accountManager: { name: "Ben Stone", email: "ben@mgb.org" },
  fee: 900,
  monthlyFee: 900,
  rate: 55,
  plan: "pro",
  planPrice: 1200,
  qbo: { realmId: "123", balance: 999 },
  margin: 0.2,
  hours: 12,
  hoursOver: 3,
  health: { reasons: ["margin", "hours_over"] },
  lastSyncedAt: "2026-11-01",
};
const READS = {
  contacts: {
    status: "ok",
    data: {
      contacts: [
        { id: "k1", name: "Jo Smith", email: "jo@doxa.org", role: "Treasurer", can_answer: true, notes: "Fee talk: $900, rate change" },
        { id: "k2", name: "Pat Lee", email: "pat@doxa.org", role: "Pastor", notes: "x" },
      ],
      portal: [
        { email: "jo@doxa.org", name: "Jo S", role: "owner" },
        { email: "amy@doxa.org", name: "Amy", role: null, opted_out: false },
      ],
    },
  },
  drive: { status: "ok", data: { on: true, folderId: "1AbC_d-9" } },
  flag: { status: "ok", data: [{ id: "n1", client_id: "c1", text: "Close Oct by the 10th", pinned: true, category: "status", created_at: "2026-11-01T10:00:00Z" }] },
  message: {
    status: "ok",
    data: [{ id: "m1", client_id: "c1", author_kind: "client", author_name: "Jo", body: "Statements attached for October", created_at: "2026-11-03T13:00:00Z", internal: false, deleted_at: null }],
  },
};
const BANNED_KEYS = /fee|rate|plan|price|qbo|margin|hours|health|balance|realm|notes|synced|billing/i;
function deepKeys(o, out) {
  const acc = out || [];
  if (o && typeof o === "object") {
    Object.keys(o).forEach((k) => {
      acc.push(k);
      deepKeys(o[k], acc);
    });
  }
  return acc;
}
function deepStrings(o, out) {
  const acc = out || [];
  if (typeof o === "string") acc.push(o);
  else if (o && typeof o === "object") Object.keys(o).forEach((k) => deepStrings(o[k], acc));
  return acc;
}

t("shape: whitelist only (deep key scan): no fee, rate, plan, qbo, margin, hours, notes", () => {
  const v = P.WB_peekShape(RICH_CLIENT, READS, "ana@mgb.org");
  const keys = deepKeys(v);
  keys.forEach((k) => assert.ok(!BANNED_KEYS.test(k), "key " + k));
  assert.deepStrictEqual(Object.keys(v).sort(), ["am", "bookkeeper", "contact", "driveUrl", "flag", "message", "moreCount", "status"]);
  const text = deepStrings(v).join(" | ");
  assert.ok(!/\$|\bfee|\brate|margin|900|1200|999/i.test(text), text);
});
t("shape: You for me, AM shown when different, hidden when the same person", () => {
  const v = P.WB_peekShape(RICH_CLIENT, READS, "ana@mgb.org");
  assert.deepStrictEqual(v.bookkeeper, { name: "You", you: true });
  assert.deepStrictEqual(v.am, { name: "Ben Stone", you: false });
  const same = P.WB_peekShape(Object.assign({}, RICH_CLIENT, { accountManager: { name: "Ana D", email: "ana@mgb.org" } }), READS, "x@mgb.org");
  assert.strictEqual(same.am, null);
});
t("shape: contacts first, then portal users, one per email, +N more", () => {
  const v = P.WB_peekShape(RICH_CLIENT, READS, "x");
  assert.deepStrictEqual(v.contact, { role: "Treasurer", name: "Jo Smith", email: "jo@doxa.org" });
  assert.strictEqual(v.moreCount, 2, "Pat + Amy (Jo's portal row is a duplicate)");
  const portalOnly = P.WB_peekShape(RICH_CLIENT, { contacts: { status: "ok", data: { contacts: [], portal: [{ email: "amy@doxa.org", name: "Amy" }] } } }, "x");
  assert.deepStrictEqual(portalOnly.contact, { role: "Portal user", name: "Amy", email: "amy@doxa.org" });
  const none = P.WB_peekShape(RICH_CLIENT, { contacts: { status: "ok", data: { contacts: [], portal: [] } } }, "x");
  assert.strictEqual(none.contact, null);
  assert.strictEqual(none.moreCount, 0);
});
t("shape: a bad email is dropped (no mailto anywhere, plain text only)", () => {
  const v = P.WB_peekShape(RICH_CLIENT, { contacts: { status: "ok", data: { contacts: [{ name: "Jo", email: "javascript:alert(1)" }] } } }, "x");
  assert.deepStrictEqual(v.contact, { role: "", name: "Jo", email: "" });
  assert.ok(!/mailto/i.test(JSON.stringify(P.WB_peekShape(RICH_CLIENT, READS, "x"))));
});
t("shape: Drive only when Drive is on and the id is plain; encoded URL", () => {
  assert.strictEqual(P.WB_peekShape(RICH_CLIENT, READS, "x").driveUrl, "https://drive.google.com/drive/folders/1AbC_d-9");
  assert.strictEqual(P.WB_peekShape(RICH_CLIENT, { drive: { status: "ok", data: { on: false, folderId: "1AbC" } } }, "x").driveUrl, null);
  assert.strictEqual(P.WB_peekDriveUrl("../evil?x=1", true), null);
  assert.strictEqual(P.WB_peekDriveUrl("", true), null);
});
t("shape: flag is the newest pinned Status/Handoff note of THIS client, trimmed", () => {
  const rows = [
    { client_id: "c1", text: "Old handoff", pinned: true, category: "handoff", created_at: "2026-10-01T00:00:00Z" },
    { client_id: "c1", text: "Not pinned", pinned: false, category: "status", created_at: "2026-11-02T00:00:00Z" },
    { client_id: "c1", text: "General", pinned: true, category: "general", created_at: "2026-11-02T00:00:00Z" },
    { client_id: "c2", text: "Other client", pinned: true, category: "status", created_at: "2026-11-03T00:00:00Z" },
  ];
  assert.deepStrictEqual(P.WB_peekFlag(rows, "c1"), { text: "Old handoff", hidden: false });
  const long = P.WB_peekFlag([{ client_id: "c1", text: "a ".repeat(100), pinned: true, category: "status" }], "c1");
  assert.ok(long.text.length <= 80);
  assert.strictEqual(P.WB_peekFlag([], "c1"), null);
});
t("leak: money-word flag shows See pinned note (T6, pure part)", () => {
  const v = P.WB_peekShape(RICH_CLIENT, { flag: { status: "ok", data: [{ client_id: "c1", text: "Fee goes to $950 in Jan", pinned: true, category: "status" }] } }, "x");
  assert.deepStrictEqual(v.flag, { text: "See pinned note", hidden: true });
  const text = deepStrings(v).join(" ");
  assert.ok(!/\$|\bfee\b|\brate\b|margin/i.test(text), text);
});
t("leak: money in the FULL message is caught before it is shortened (no truncation gap)", () => {
  const body = "Hi Ben, thanks for the quick call yesterday about the new quarter and the staffing plan, so the number we agreed on is 1,500 per cycle";
  const v = P.WB_peekShape(
    RICH_CLIENT,
    { message: { status: "ok", data: [{ client_id: "c1", author_kind: "client", author_name: "Jo", body, internal: false, deleted_at: null, created_at: "2026-11-03T00:00:00Z" }] } },
    "x",
  );
  assert.strictEqual(v.message.text, "Open the thread to read it");
  assert.ok(!/1,5|1500/.test(deepStrings(v).join(" ")));
});
t("leak: a money word in the last message or a contact role is never shown", () => {
  const v = P.WB_peekShape(
    RICH_CLIENT,
    {
      message: { status: "ok", data: [{ client_id: "c1", author_kind: "client", author_name: "Jo", body: "Is the $900 invoice paid?", internal: false, deleted_at: null, created_at: "2026-11-03T00:00:00Z" }] },
      contacts: { status: "ok", data: { contacts: [{ name: "Jo", email: "jo@doxa.org", role: "Fee contact" }] } },
    },
    "x",
  );
  assert.strictEqual(v.message.text, "Open the thread to read it");
  assert.strictEqual(v.contact.role, "");
  assert.ok(!/\$|\bfee\b|\brate\b|margin|invoice/i.test(deepStrings(v).join(" ")));
});
t("shape: last message is client-visible only (internal, deleted and other clients dropped)", () => {
  const rows = [
    { client_id: "c1", author_kind: "staff", author_name: "Ben", body: "internal note", internal: true, deleted_at: null, created_at: "2026-11-03T14:00:00Z" },
    { client_id: "c1", author_kind: "client", author_name: "Jo", body: "deleted", internal: false, deleted_at: "2026-11-03T00:00:00Z", created_at: "2026-11-03T14:30:00Z" },
    { client_id: "c2", author_kind: "client", author_name: "Other", body: "other client", internal: false, deleted_at: null, created_at: "2026-11-03T14:40:00Z" },
    { client_id: "c1", author_kind: "staff", author_name: "Ben", body: "Thanks, got it", internal: false, deleted_at: null, created_at: "2026-11-03T10:00:00Z" },
    { client_id: "c1", author_kind: "client", author_name: "Jo", body: "no internal field", deleted_at: null, created_at: "2026-11-03T14:50:00Z" },
  ];
  const m = P.WB_peekMessage(rows, "c1");
  assert.deepStrictEqual(m, { who: "Ben", kindLabel: "Staff", at: "2026-11-03T10:00:00Z", text: "Thanks, got it", hidden: false });
});
t("shape: loading / error status per row; nothing invented for missing reads", () => {
  const v = P.WB_peekShape(RICH_CLIENT, { contacts: { status: "error" } }, "x");
  assert.deepStrictEqual(v.status, { contacts: "error", drive: "loading", flag: "loading", message: "loading" });
  assert.strictEqual(v.contact, null);
  assert.strictEqual(v.flag, null);
  assert.strictEqual(v.message, null);
  assert.strictEqual(v.driveUrl, null);
});
t("shape: never spreads the client (unknown keys never appear)", () => {
  const v = P.WB_peekShape(Object.assign({ secretThing: "S3CRET" }, RICH_CLIENT), READS, "x");
  assert.ok(JSON.stringify(v).indexOf("S3CRET") < 0);
});

// ---- Task count, fold ----
t("tasks: 3 open · 1 late; no open tasks", () => {
  const today = "2026-11-03";
  const tasks = [
    { status: "todo", due_date: "2026-11-01" },
    { status: "in_progress", due_date: "2026-11-10" },
    { status: "todo" },
    { status: "done", due_date: "2026-10-01" },
  ];
  assert.strictEqual(P.WB_peekTaskCount(tasks, today).text, "3 open · 1 late");
  assert.strictEqual(P.WB_peekTaskCount([{ status: "todo" }], today).text, "1 open");
  assert.strictEqual(P.WB_peekTaskCount([], today).text, "No open tasks");
});
t("fold: one line text; short tier folded by default; a saved choice wins", () => {
  const v = P.WB_peekShape(RICH_CLIENT, READS, "x");
  assert.deepStrictEqual(P.WB_peekFoldParts(v), { text: "Ana Diaz · Jo Smith", drive: true });
  assert.strictEqual(P.WB_peekFolded("short"), true);
  assert.strictEqual(P.WB_peekFolded("medium"), false);
  assert.strictEqual(P.WB_peekFolded("tall"), false);
  assert.strictEqual(P.WB_peekFolded("short", false), false);
  assert.strictEqual(P.WB_peekFolded("tall", true), true);
});

// ---- ⌘K row ----
t("cmdk: off or no client page = no row; keep / stop keeping", () => {
  assert.strictEqual(P.WB_peekActionRow(false, { id: "c1", name: "Doxa" }, null), null);
  assert.strictEqual(P.WB_peekActionRow(true, null, null), null);
  const a = P.WB_peekActionRow(true, { id: "c1", name: "Doxa" }, null);
  assert.strictEqual(a.title, "Keep Doxa on Desk");
  assert.ok(/keep/.test(a.keywords) && /pin/.test(a.keywords) && /desk/.test(a.keywords) && /peek/.test(a.keywords));
  assert.strictEqual(P.WB_peekActionRow(true, { id: "c1", name: "Doxa" }, "c1").title, "Stop keeping Doxa");
});

// ---- Desk Customize prefs ----
t("prefs: defaults, garbage, and the four closed choices", () => {
  const d = P.WB_deskPrefsParse(null);
  assert.deepStrictEqual(d, { on: { glance: true, rightNow: true }, closed: "both" });
  ["{", "[]", '{"v":2,"closed":"rail"}', '{"v":1,"closed":"sideways"}'].forEach((raw) => assert.deepStrictEqual(P.WB_deskPrefsParse(raw), d, raw));
  ["both", "rail", "bar", "neither"].forEach((c) => assert.strictEqual(P.WB_deskPrefsParse(JSON.stringify({ v: 1, closed: c })).closed, c));
  const off = P.WB_deskPrefsParse(P.WB_deskPrefsSerialize({ on: { glance: false, rightNow: false }, closed: "bar" }));
  assert.deepStrictEqual(off, { on: { glance: false, rightNow: false }, closed: "bar" });
});
t("prefs: feed WB_deskFill and WB_deskClosedShow as the engine expects", () => {
  const p = P.WB_deskPrefsParse(JSON.stringify({ v: 1, on: { glance: true, rightNow: false }, closed: "bar" }));
  assert.deepStrictEqual(L0.WB_deskFill({ tier: "tall", prefs: { on: p.on }, ctx: { glance: true, rightNow: true } }), ["glance"]);
  assert.deepStrictEqual(L0.WB_deskFill({ tier: "tall", ctx: { glance: true, rightNow: true } }), ["glance", "rightNow"], "no prefs = today");
  assert.deepStrictEqual(L0.WB_deskClosedShow(p.closed, "dock"), { rail: false, bar: true });
  assert.deepStrictEqual(L0.WB_deskClosedShow("neither", "sheet"), { rail: false, bar: true }, "a phone always keeps the bar");
});
t("reset: Desk keys for one person only; pins and recents are not in the list", () => {
  const keys = P.WB_deskResetKeys("Ana@X.org");
  assert.deepStrictEqual(keys, ["mgb_wb_deskprefs:ana@x.org", "mgb_wb_desk:ana@x.org", "mgb_wb_hub:ana@x.org", "mgb_wb_peek:ana@x.org"]);
  assert.ok(!keys.some((k) => /pins|recent/.test(k)));
  assert.deepStrictEqual(P.WB_deskResetKeys(""), []);
});

// ---- View as (pure part): the Desk never mounts, so the gate is off ----
t("leak T7 (pure): View as / preview / impersonation never mount the Desk, so the peek is off", () => {
  [{ previewing: true }, { impersonating: true }, { tkShell: true }, { showStaffRail: false }].forEach((x) => {
    const mounts = L0.WB_deskMounts(Object.assign({ showStaffRail: true, email: "admin@mgb.org" }, x));
    assert.strictEqual(mounts, false, JSON.stringify(x));
    assert.strictEqual(P.WB_peekIsOn(mounts, true, true), false);
  });
});

// ---- Browser behavior in a sandbox ----
function load(opts) {
  const o = opts || {};
  const store = Object.assign({}, o.ls || {});
  const calls = { from: [], rpc: [], session: 0, writes: 0, filters: [] };
  const events = [];
  const window = {
    localStorage: {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
      setItem: (k, v) => {
        store[k] = String(v);
      },
      removeItem: (k) => {
        delete store[k];
      },
    },
    dispatchEvent: (e) => events.push({ type: e.type, detail: e.detail }),
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  const answers = o.answers || {};
  const mk = (table) => {
    const b = {
      select: () => b,
      eq: (c, v) => {
        calls.filters.push([table, "eq", c, v]);
        return b;
      },
      is: (c, v) => {
        calls.filters.push([table, "is", c, v]);
        return b;
      },
      in: (c, v) => {
        calls.filters.push([table, "in", c, v]);
        return b;
      },
      order: () => b,
      limit: (k) => {
        calls.filters.push([table, "limit", k]);
        return Promise.resolve(answers[table] || { data: [], error: null });
      },
      maybeSingle: () => Promise.resolve(answers[table] || { data: null, error: null }),
      insert: () => {
        calls.writes++;
        return b;
      },
      update: () => {
        calls.writes++;
        return b;
      },
      upsert: () => {
        calls.writes++;
        return b;
      },
      delete: () => {
        calls.writes++;
        return b;
      },
    };
    return b;
  };
  window.mgbSupabase = {
    from: (table) => {
      calls.from.push(table);
      return mk(table);
    },
    rpc: (name, args) => {
      calls.rpc.push([name, args]);
      return Promise.resolve(answers["rpc:" + name] || { data: { contacts: [], portal: [] }, error: null });
    },
    auth: {
      getSession: () => {
        calls.session++;
        return Promise.resolve({ data: { session: o.noSession ? null : { user: {} } } });
      },
    },
  };
  function CustomEvent(type, init) {
    this.type = type;
    this.detail = init && init.detail;
  }
  function Event(type) {
    this.type = type;
  }
  const clock = { t: NOW };
  const sandbox = { window, CustomEvent, Event, console, Date: Object.assign(function () {}, { now: () => clock.t, parse: Date.parse }) };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "WB_peek.js"), "utf8"), sandbox);
  return { sb: sandbox, store, calls, events, clock, supa: window.mgbSupabase };
}
const tick = () => new Promise((r) => setTimeout(r, 0));
function seq() {
  let gen = 0;
  const per = {};
  return {
    reset: () => {
      gen += 1;
    },
    start: (s) => {
      per[s] = (per[s] || 0) + 1;
      return { g: gen, s, n: per[s] };
    },
    ok: (tok) => !!tok && tok.g === gen && per[tok.s] === tok.n,
  };
}

(async () => {
  await ta("switch: Desk off makes no network call, even with the preview and a cached on", async () => {
    const L = load({ ls: { mgb_peek_preview: "1", mgb_peek_cache: "1" } });
    assert.strictEqual(L.sb.WB_peekOn(false), false);
    await tick();
    assert.strictEqual(L.calls.from.length + L.calls.rpc.length + L.calls.session, 0);
  });
  await ta("switch: preview on = on, no switch read", async () => {
    const L = load({ ls: { mgb_peek_preview: "1" } });
    assert.strictEqual(L.sb.WB_peekOn(true), true);
    await tick();
    assert.strictEqual(L.calls.from.length, 0);
  });
  await ta("switch: missing row = off; one read of desk_peek_enabled; never writes", async () => {
    const L = load({});
    assert.strictEqual(L.sb.WB_peekOn(true), false);
    await tick();
    await tick();
    assert.deepStrictEqual(L.calls.from, ["tk_settings"]);
    assert.deepStrictEqual(L.calls.filters[0], ["tk_settings", "eq", "key", "desk_peek_enabled"]);
    assert.strictEqual(L.calls.writes, 0);
    L.sb.WB_peekOn(true);
    await tick();
    assert.strictEqual(L.calls.from.length, 1, "one read per page load");
  });
  await ta("switch: on = cached, mgb:peek fires, then on", async () => {
    const L = load({ answers: { tk_settings: { data: { value: true }, error: null } } });
    L.sb.WB_peekOn(true);
    await tick();
    await tick();
    assert.strictEqual(L.store.mgb_peek_cache, "1");
    assert.deepStrictEqual(L.events.map((e) => e.type), ["mgb:peek"]);
    assert.strictEqual(L.sb.WB_peekOn(true), true);
  });

  await ta("reads: a client I can open = exactly 4 reads, all scoped to that client, no writes", async () => {
    const L = load({
      answers: {
        drive_folders: { data: [{ drive_folder_id: "F1" }], error: null },
        client_private_notes: { data: [{ client_id: "c1", text: "Close Oct by the 10th", pinned: true, category: "status" }], error: null },
        client_messages: { data: [], error: null },
      },
    });
    const got = {};
    const p = L.sb.WB_peekFetch(L.supa, "c1", MINE, seq(), (sec, st) => (got[sec] = st), () => Promise.resolve(true));
    assert.ok(p);
    await p;
    assert.deepStrictEqual(JSON.parse(JSON.stringify(L.calls.rpc)), [["tk_request_recipients", { p_client_id: "c1" }]]);
    assert.deepStrictEqual(L.calls.from.slice().sort(), ["client_messages", "client_private_notes", "drive_folders"]);
    L.calls.filters.filter((f) => f[1] === "eq" && f[2] === "client_id").forEach((f) => assert.strictEqual(f[3], "c1"));
    assert.ok(L.calls.filters.some((f) => f[0] === "client_messages" && f[2] === "internal" && f[3] === false));
    assert.ok(L.calls.filters.some((f) => f[0] === "client_private_notes" && f[2] === "pinned" && f[3] === true));
    assert.ok(L.calls.filters.some((f) => f[0] === "client_private_notes" && f[1] === "in" && f[3].join() === "status,handoff"));
    assert.ok(!L.calls.from.includes("qbo_connections") && !L.calls.from.includes("clients"));
    assert.strictEqual(L.calls.writes, 0);
    assert.strictEqual(got.drive.status, "ok");
    assert.deepStrictEqual(JSON.parse(JSON.stringify(got.drive.data)), { on: true, folderId: "F1" });
  });
  await ta("reads: Drive off = no drive_folders read", async () => {
    const L = load({});
    await L.sb.WB_peekFetch(L.supa, "c1", MINE, seq(), () => {}, () => Promise.resolve(false));
    assert.ok(!L.calls.from.includes("drive_folders"));
  });
  await ta("reads: one failed read = that row errors, the others land", async () => {
    const L = load({ answers: { client_messages: { data: null, error: { message: "boom" } } } });
    const got = {};
    await L.sb.WB_peekFetch(L.supa, "c1", MINE, seq(), (sec, st) => (got[sec] = st.status), null);
    assert.deepStrictEqual(got, { contacts: "ok", drive: "ok", flag: "ok", message: "error" });
  });
  await ta("reads: a stale reply for the previous client is never applied", async () => {
    const L = load({});
    const s = seq();
    const applied = [];
    const first = L.sb.WB_peekFetch(L.supa, "c1", MINE, s, (sec, st) => applied.push(st.clientId + ":" + st.status), null);
    const second = L.sb.WB_peekFetch(L.supa, "c2", MINE, s, (sec, st) => applied.push(st.clientId + ":" + st.status), null);
    await Promise.all([first, second]);
    assert.ok(!applied.includes("c1:ok"), applied.join());
    assert.ok(applied.includes("c2:ok"));
  });

  // Leak cases (pure + sandbox): each ends in "no request at all".
  const cases = [
    ["T1 bookkeeper, unassigned client (hand-written kept id)", "c9", MINE],
    ["T2 temp grant expired (client dropped out of my list)", "c3", MINE],
    ["T3 assignment removed (next load's list lacks it)", "c2", [{ id: "c1", name: "Doxa" }]],
    ["T4 temp admin (same list as the base role; unassigned id)", "c9", MINE],
    ["T5 MGB internal for an admin without internal access (not in visibleClients)", "mgb-internal", MINE],
    ["list not loaded yet (unknown)", "c1", []],
  ];
  for (const [name, id, list] of cases) {
    await ta("leak " + name + ": zero requests", async () => {
      const L = load({ ls: { mgb_peek_preview: "1" } });
      const applied = [];
      const r = L.sb.WB_peekFetch(L.supa, id, list, seq(), (sec) => applied.push(sec), () => Promise.resolve(true));
      assert.strictEqual(r, null);
      await tick();
      assert.strictEqual(L.calls.from.length + L.calls.rpc.length, 0);
      assert.deepStrictEqual(applied, [], "no loading state either (the no-access view shows no name)");
    });
  }
  await ta("leak T2 (pure): during the grant ok, after expiry none, without a reload", async () => {
    const withGrant = MINE.concat([{ id: "c3", name: "Granted" }]);
    assert.strictEqual(P.WB_peekAccess("c3", withGrant), "ok");
    assert.strictEqual(P.WB_peekAccess("c3", MINE), "none");
  });

  await ta("keep: write, read back, other people's keys untouched, event fires", async () => {
    const L = load({ ls: { "mgb_wb_peek:bob@x.org": JSON.stringify({ v: 1, keptId: "b1", at: NOW }) } });
    L.sb.WB_peekSetKept("Ana@X.org", "c1", NOW);
    assert.strictEqual(JSON.parse(L.store["mgb_wb_peek:ana@x.org"]).keptId, "c1");
    assert.strictEqual(L.sb.WB_peekRead("ana@x.org", NOW).keptId, "c1");
    assert.strictEqual(JSON.parse(L.store["mgb_wb_peek:bob@x.org"]).keptId, "b1");
    assert.ok(L.events.some((e) => e.type === "mgb:wb-peek"));
    L.sb.WB_peekSetKept("ana@x.org", null, NOW);
    assert.strictEqual(L.store["mgb_wb_peek:ana@x.org"], undefined, "nothing kept and open = key removed");
    L.sb.WB_peekSetCollapsed("ana@x.org", true, NOW);
    assert.deepStrictEqual(JSON.parse(L.store["mgb_wb_peek:ana@x.org"]), { v: 1, keptId: null, at: null, collapsed: true });
    L.sb.WB_peekSetCollapsed("ana@x.org", false, NOW);
    assert.strictEqual(L.sb.WB_peekRead("ana@x.org", NOW).collapsed, false, "an explicit open is remembered");
    L.sb.WB_peekSetCollapsed("ana@x.org", null, NOW);
    assert.strictEqual(L.store["mgb_wb_peek:ana@x.org"], undefined);
  });
  await ta("keep: never touches the star pins", async () => {
    const pins = JSON.stringify({ v: 1, pins: ["c2"] });
    const L = load({ ls: { "mgb_wb_pins:ana@x.org": pins } });
    L.sb.WB_peekSetKept("ana@x.org", "c1", NOW);
    L.sb.WB_peekSetKept("ana@x.org", null, NOW);
    L.sb.WB_deskReset("ana@x.org");
    assert.strictEqual(L.store["mgb_wb_pins:ana@x.org"], pins);
  });
  await ta("reset Desk: clears my Desk keys only", async () => {
    const L = load({
      ls: {
        "mgb_wb_deskprefs:ana@x.org": "x",
        "mgb_wb_desk:ana@x.org": "x",
        "mgb_wb_hub:ana@x.org": "x",
        "mgb_wb_peek:ana@x.org": "x",
        "mgb_wb_desk:bob@x.org": "keep",
        mgb_peek_preview: "1",
      },
    });
    L.sb.WB_deskReset("ana@x.org");
    assert.deepStrictEqual(Object.keys(L.store).sort(), ["mgb_peek_preview", "mgb_wb_desk:bob@x.org"]);
  });
  await ta("reset Desk: also resets the in-memory store (width, hub) when one is loaded", async () => {
    const L = load({});
    let called = 0;
    L.sb.WB_store = { resetDesk: () => { called++; } };
    L.sb.WB_deskReset("ana@x.org");
    assert.strictEqual(called, 1);
    L.sb.WB_store = undefined;
    L.sb.WB_deskReset("ana@x.org"); // no store loaded: still fine
  });
  await ta("prefs: default prefs remove the key; a change writes it and fires the event", async () => {
    const L = load({});
    L.sb.WB_deskPrefsWrite("ana@x.org", { on: { glance: false, rightNow: true }, closed: "rail" });
    assert.deepStrictEqual(JSON.parse(L.store["mgb_wb_deskprefs:ana@x.org"]), { v: 1, on: { glance: false, rightNow: true }, closed: "rail" });
    assert.ok(L.events.some((e) => e.type === "mgb:wb-deskprefs"));
    L.sb.WB_deskPrefsWrite("ana@x.org", { on: { glance: true, rightNow: true }, closed: "both" });
    assert.strictEqual(L.store["mgb_wb_deskprefs:ana@x.org"], undefined);
  });
  await ta("memory: fresh within 2 minutes, stale after, per person and client", async () => {
    const L = load({});
    L.sb.WB_peekMemPut("ana@x.org", "c1", { x: 1 }, NOW);
    assert.strictEqual(L.sb.WB_peekMemGet("ana@x.org", "c1", NOW + 60000).fresh, true);
    assert.strictEqual(L.sb.WB_peekMemGet("ana@x.org", "c1", NOW + 121000).fresh, false);
    assert.strictEqual(L.sb.WB_peekMemGet("bob@x.org", "c1", NOW), null);
    assert.strictEqual(L.sb.WB_peekMemGet("ana@x.org", "c2", NOW), null);
  });

  console.log("WB_peek tests passed: " + n);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
