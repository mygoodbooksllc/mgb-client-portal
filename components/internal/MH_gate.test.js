// Plain node, no framework: `node components/internal/MH_gate.test.js`.
// Guards the MGB Home gate (MH_gate.js, docs/mgb-home-spec.md section 6): the
// pure resolvers (preview x switch x grant x View as), and, in a vm sandbox
// with a fake window, that without the internal grant (or in View as)
// MH_canOpen answers false with no network call and no storage read of the
// preview, that the switch read waits for a session, happens once per page
// load, caches in mgb_home_cache, fires mgb:mgbhome on a change, gives up
// after 3 errors and never writes.

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const P = require("./MH_gate.js");

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

t("routes: #/internal sub-paths map to MGB Home pages and Firm books pages", () => {
  assert.strictEqual(P.MH_pageFromPath([]), null);
  assert.strictEqual(P.MH_pageFromPath(["profitability"]), "mgb-profitability");
  assert.strictEqual(P.MH_pageFromPath(["pricing"]), "mgb-pricing");
  assert.strictEqual(P.MH_pageFromPath(["overhead"]), "mgb-overhead");
  assert.strictEqual(P.MH_pageFromPath(["books", "close"]), "client-close");
  assert.strictEqual(P.MH_pageFromPath(["books", "overview"]), "client-overview");
  assert.strictEqual(P.MH_pageFromPath(["books", "finances"]), "dashboard");
  // Later slices are not routes yet; unknown lands like a bare open.
  ["costs", "capacity", "nope", ""].forEach((x) => assert.strictEqual(P.MH_pageFromPath([x]), null, x));
  assert.strictEqual(P.MH_pageFromPath(["books"]), null);
  assert.strictEqual(P.MH_pageFromPath(["books", "messages"]), null);
});

t("routes: every page builds the hash that parses back to it", () => {
  P.MH_TABS.forEach((tab) => {
    const h = P.MH_hashFor(tab.key);
    assert.ok(h.indexOf("#/internal") === 0);
    const parts = h.replace(/^#\/internal\/?/, "").split("/").filter(Boolean);
    assert.strictEqual(parts.length ? P.MH_pageFromPath(parts) : "mgb-home", tab.key);
  });
  P.MH_BOOKS.forEach((b) => {
    const h = P.MH_hashFor(b.page);
    assert.strictEqual(h, "#/internal/books/" + b.slug);
    assert.strictEqual(P.MH_pageFromPath(["books", b.slug]), b.page);
  });
  ["client-settings", "messages", "milestone", "today", null].forEach((p) => assert.strictEqual(P.MH_hashFor(p), null));
  assert.ok(P.MH_isPage("mgb-pricing") && !P.MH_isPage("client-close") && P.MH_isPage("mgb-overhead") && !P.MH_isPage("mgb-capacity"));
  assert.deepStrictEqual(P.MH_TABS.map((x) => x.key), ["mgb-home", "mgb-profitability", "mgb-pricing", "mgb-overhead"]);
  assert.strictEqual(P.MH_hashFor("mgb-overhead"), "#/internal/overhead");
});

t("moved line: shows for 30 days from the first time, then never", () => {
  const day = 86400000;
  assert.strictEqual(P.MH_movedLineShows(null, 1000), true);
  assert.strictEqual(P.MH_movedLineShows(0, 29 * day), true);
  assert.strictEqual(P.MH_movedLineShows(0, 30 * day), false);
  assert.strictEqual(P.MH_movedLineShows(NaN, 5), true);
});

const SWITCH_ON = [true, "true", 1, { on: true }];
const SWITCH_OFF = [undefined, null, false, "false", 0, "", "1", {}, { on: false }, { on: "true" }];

t("MH_isOn: preview on is on, whatever the switch", () => {
  SWITCH_ON.concat(SWITCH_OFF).forEach((sw) => assert.strictEqual(P.MH_isOn(true, sw), true, JSON.stringify(sw)));
});
t("MH_isOn: switch true / \"true\" / 1 / {on:true} is on", () => {
  SWITCH_ON.forEach((sw) => assert.strictEqual(P.MH_isOn(false, sw), true, JSON.stringify(sw)));
});
t("MH_isOn: nothing / junk is off; preview must be strictly true", () => {
  SWITCH_OFF.forEach((sw) => assert.strictEqual(P.MH_isOn(false, sw), false, JSON.stringify(sw)));
  assert.strictEqual(P.MH_isOn(), false);
  assert.strictEqual(P.MH_isOn("1", undefined), false);
});
t("MH_canOpenPure: grant AND on, both strictly true", () => {
  assert.strictEqual(P.MH_canOpenPure(true, true), true);
  [[false, true], [true, false], [false, false], [1, true], [true, 1], [undefined, true], ["true", true]].forEach(([g, o]) =>
    assert.strictEqual(P.MH_canOpenPure(g, o), false, JSON.stringify([g, o])),
  );
});
t("Keys and event names", () => {
  assert.strictEqual(P.MH_PREVIEW_KEY, "mgb_home_preview");
  assert.strictEqual(P.MH_CACHE_KEY, "mgb_home_cache");
  assert.strictEqual(P.MH_EVENT, "mgb:mgbhome");
  assert.strictEqual(P.MH_SWITCH_KEY, "mgb_home_enabled");
});

// ---- Browser behavior in a sandbox ----
// grant: what STAFF_canViewInternal(real, imp) answers (app.jsx: admin + grant + not in View as).
function load(opts) {
  const o = opts || {};
  const store = Object.assign({}, o.ls || {});
  const calls = { from: [], session: 0, writes: 0, lsReads: 0, grantArgs: [] };
  const events = [];
  const window = {
    localStorage: {
      getItem: (k) => {
        calls.lsReads++;
        return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null;
      },
      setItem: (k, v) => {
        store[k] = String(v);
      },
      removeItem: (k) => {
        delete store[k];
      },
    },
    dispatchEvent: (e) => events.push(e.type),
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  const answer = o.answer === undefined ? { data: null, error: null } : o.answer;
  const builder = {
    select: () => builder,
    eq: (col, val) => {
      calls.from[calls.from.length - 1].eq = [col, val];
      return builder;
    },
    maybeSingle: () => Promise.resolve(answer),
    insert: () => (calls.writes++, builder),
    update: () => (calls.writes++, builder),
    upsert: () => (calls.writes++, builder),
    delete: () => (calls.writes++, builder),
  };
  window.mgbSupabase = {
    from: (table) => {
      calls.from.push({ table });
      return builder;
    },
    auth: {
      getSession: () => {
        calls.session++;
        return Promise.resolve({ data: { session: o.noSession ? null : { user: {} } } });
      },
    },
  };
  const clock = { t: 1000000 };
  const sandbox = { window, Event: function (type) { this.type = type; }, console, Date: { now: () => clock.t } };
  if (o.grant !== "missing") {
    // Mirrors app.jsx: admin + canViewInternal + not impersonating.
    sandbox.STAFF_canViewInternal = (real, imp) => {
      calls.grantArgs.push([real, imp]);
      return !!real && real.role === "admin" && real.canViewInternal === true && !imp;
    };
  }
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "MH_gate.js"), "utf8"), sandbox);
  return { sb: sandbox, store, calls, events, clock };
}
const tick = () => new Promise((r) => setTimeout(r, 0));
const HOLDEN = { email: "holden@mygoodbooks.org", role: "admin", canViewInternal: true };
const JESSE = { email: "jesse@mygoodbooks.org", role: "admin", canViewInternal: false };
const BK = { email: "bk@mygoodbooks.org", role: "bookkeeper", canViewInternal: false };

(async () => {
  await ta("No grant (Jesse, a bookkeeper, nobody): false, no network, no preview read, even with preview + cache on", async () => {
    for (const who of [JESSE, BK, null]) {
      const L = load({ ls: { mgb_home_preview: "1", mgb_home_cache: "1" }, answer: { data: { value: true }, error: null } });
      assert.strictEqual(L.sb.MH_canOpen(who, false), false);
      await tick();
      await tick();
      assert.strictEqual(L.calls.from.length, 0);
      assert.strictEqual(L.calls.session, 0);
      assert.strictEqual(L.calls.lsReads, 0, "never even looks at the preview without the grant");
    }
  });

  await ta("View as (impersonating): false and no network, even for Holden with preview on", async () => {
    const L = load({ ls: { mgb_home_preview: "1", mgb_home_cache: "1" } });
    assert.strictEqual(L.sb.MH_canOpen(HOLDEN, { email: "jesse@mygoodbooks.org" }), false);
    await tick();
    assert.strictEqual(L.calls.from.length, 0);
    assert.strictEqual(L.calls.lsReads, 0);
  });

  await ta("STAFF_canViewInternal missing (client app): false", async () => {
    const L = load({ grant: "missing", ls: { mgb_home_preview: "1" } });
    assert.strictEqual(L.sb.MH_canOpen(HOLDEN, false), false);
  });

  await ta("Holden, preview on: true and settled at once; the switch is still read (cache stays fresh), never written", async () => {
    const L = load({ ls: { mgb_home_preview: "1" }, answer: { data: { value: true }, error: null } });
    assert.strictEqual(L.sb.MH_canOpen(HOLDEN, false), true);
    assert.strictEqual(L.sb.MH_switchSettled(), true);
    await tick();
    await tick();
    assert.strictEqual(L.calls.from.length, 1);
    assert.strictEqual(L.store.mgb_home_cache, "1");
    assert.strictEqual(L.calls.writes, 0);
  });

  await ta("Holden, preview off, switch missing: false; one read of mgb_home_enabled per load, no write", async () => {
    const L = load({});
    assert.strictEqual(L.sb.MH_canOpen(HOLDEN, false), false);
    assert.strictEqual(L.sb.MH_switchSettled(), false, "not settled until the read lands");
    L.sb.MH_canOpen(HOLDEN, false);
    await tick();
    await tick();
    assert.strictEqual(L.calls.from.length, 1);
    assert.deepStrictEqual(L.calls.from[0], { table: "tk_settings", eq: ["key", "mgb_home_enabled"] });
    assert.strictEqual(L.calls.writes, 0);
    assert.strictEqual(L.store.mgb_home_cache, undefined);
    assert.strictEqual(L.sb.MH_switchSettled(), true);
    assert.deepStrictEqual(L.events, ["mgb:mgbhome"], "fires on settle so waiting pages re-render");
    L.sb.MH_canOpen(HOLDEN, false);
    await tick();
    assert.strictEqual(L.calls.from.length, 1, "one read per page load");
  });

  await ta("Switch on: cache 1, mgb:mgbhome fires once, then Holden true and Jesse still false", async () => {
    const L = load({ answer: { data: { value: true }, error: null } });
    assert.strictEqual(L.sb.MH_canOpen(HOLDEN, false), false);
    await tick();
    await tick();
    assert.strictEqual(L.store.mgb_home_cache, "1");
    assert.deepStrictEqual(L.events, ["mgb:mgbhome"]);
    assert.strictEqual(L.sb.MH_canOpen(HOLDEN, false), true);
    assert.strictEqual(L.sb.MH_on(), true);
    assert.strictEqual(L.sb.MH_canOpen(JESSE, false), false);
    assert.strictEqual(L.calls.writes, 0);
  });

  await ta("Switch turned off: a stale cached 1 is removed and the event fires", async () => {
    const L = load({ ls: { mgb_home_cache: "1" }, answer: { data: { value: false }, error: null } });
    assert.strictEqual(L.sb.MH_canOpen(HOLDEN, false), true, "last known answer until the read lands");
    await tick();
    await tick();
    assert.strictEqual(L.store.mgb_home_cache, undefined);
    assert.deepStrictEqual(L.events, ["mgb:mgbhome"]);
    assert.strictEqual(L.sb.MH_canOpen(HOLDEN, false), false);
  });

  await ta("No session yet: no tk_settings read, tries again after 3s", async () => {
    const L = load({ noSession: true, answer: { data: { value: true }, error: null } });
    L.sb.MH_on();
    await tick();
    await tick();
    assert.strictEqual(L.calls.from.length, 0);
    assert.strictEqual(L.calls.session, 1);
    L.sb.MH_on();
    await tick();
    assert.strictEqual(L.calls.session, 1, "not again within 3s");
    L.clock.t += 3001;
    L.sb.MH_on();
    await tick();
    assert.strictEqual(L.calls.session, 2);
  });

  await ta("A read error leaves the cache alone, retries after 30s and gives up after 3", async () => {
    const L = load({ ls: { mgb_home_cache: "1" }, answer: { data: null, error: { message: "nope" } } });
    L.sb.MH_on();
    await tick();
    await tick();
    assert.strictEqual(L.store.mgb_home_cache, "1");
    L.sb.MH_on();
    await tick();
    assert.strictEqual(L.calls.session, 1, "not again within 30s");
    for (let i = 0; i < 2; i++) {
      L.clock.t += 30001;
      L.sb.MH_on();
      await tick();
      await tick();
    }
    assert.strictEqual(L.calls.from.length, 3);
    L.clock.t += 30001;
    L.sb.MH_on();
    await tick();
    assert.strictEqual(L.calls.from.length, 3, "gives up after 3 errors this page load");
    assert.strictEqual(L.store.mgb_home_cache, "1");
    assert.strictEqual(L.calls.writes, 0);
  });

  console.log("MH_gate: " + n + " tests passed");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
