// Plain node, no framework: `node components/workbench/WB_plus.test.js`.
// Guards the Desk additions gate (WB_plus.js): the pure resolver's truth
// table (Desk off is always off; Desk on needs the preview or the firm
// switch), and, in a vm sandbox with a fake window, that the Desk off makes
// no network call, the switch read waits for a session, caches its answer in
// mgb_deskplus_cache, fires mgb:deskplus on a change and never writes.

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const P = require("./WB_plus.js");

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

// ---- Resolver truth table ----
const SWITCH_ON = [true, "true", 1, { on: true }];
const SWITCH_OFF = [undefined, null, false, "false", 0, "", "1", {}, { on: false }, { on: "true" }];

t("Desk off: always off, whatever the preview or switch", () => {
  [false, undefined, null, 0, "true", 1].forEach((desk) => {
    [true, false].forEach((pre) => {
      SWITCH_ON.concat(SWITCH_OFF).forEach((sw) => {
        assert.strictEqual(P.WB_plusIsOn(desk, pre, sw), false, JSON.stringify([desk, pre, sw]));
      });
    });
  });
});
t("Desk on + preview: on, whatever the switch", () => {
  SWITCH_ON.concat(SWITCH_OFF).forEach((sw) => {
    assert.strictEqual(P.WB_plusIsOn(true, true, sw), true, JSON.stringify(sw));
  });
});
t("Desk on + switch true / \"true\" / 1 / {on:true}: on", () => {
  SWITCH_ON.forEach((sw) => {
    assert.strictEqual(P.WB_plusIsOn(true, false, sw), true, JSON.stringify(sw));
  });
});
t("Desk on + nothing / false / null / undefined (and other junk): off", () => {
  SWITCH_OFF.forEach((sw) => {
    assert.strictEqual(P.WB_plusIsOn(true, false, sw), false, JSON.stringify(sw));
  });
  assert.strictEqual(P.WB_plusIsOn(true), false);
  assert.strictEqual(P.WB_plusIsOn(true, undefined, undefined), false);
});

// ---- Browser behavior in a sandbox ----
function load(opts) {
  const o = opts || {};
  const store = Object.assign({}, o.ls || {});
  const calls = { from: [], session: 0, writes: 0 };
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
    insert: () => {
      calls.writes++;
      return builder;
    },
    update: () => {
      calls.writes++;
      return builder;
    },
    upsert: () => {
      calls.writes++;
      return builder;
    },
    delete: () => {
      calls.writes++;
      return builder;
    },
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
  const sandbox = { window, Event: function (type) { this.type = type; }, console };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "WB_plus.js"), "utf8"), sandbox);
  return { sb: sandbox, store, calls, events };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

(async () => {
  await ta("Desk off: no network call, even with the preview or a cached on", async () => {
    const L = load({ ls: { mgb_deskplus_preview: "1", mgb_deskplus_cache: "1" } });
    assert.strictEqual(L.sb.WB_plusOn(false), false);
    assert.strictEqual(L.sb.WB_plusOn(undefined), false);
    await tick();
    assert.strictEqual(L.calls.from.length, 0);
    assert.strictEqual(L.calls.session, 0);
  });

  await ta("Desk on + preview: on, and no switch read", async () => {
    const L = load({ ls: { mgb_deskplus_preview: "1" } });
    assert.strictEqual(L.sb.WB_plusOn(true), true);
    await tick();
    assert.strictEqual(L.calls.from.length, 0);
  });

  await ta("Desk on, preview off, switch missing: off; one read of deskplus_enabled, no write", async () => {
    const L = load({});
    assert.strictEqual(L.sb.WB_plusOn(true), false);
    L.sb.WB_plusOn(true);
    await tick();
    await tick();
    assert.strictEqual(L.calls.from.length, 1);
    assert.deepStrictEqual(L.calls.from[0], { table: "tk_settings", eq: ["key", "deskplus_enabled"] });
    assert.strictEqual(L.calls.writes, 0);
    assert.strictEqual(L.store.mgb_deskplus_cache, undefined);
    assert.deepStrictEqual(L.events, []);
    L.sb.WB_plusOn(true);
    await tick();
    assert.strictEqual(L.calls.from.length, 1, "one read per page load");
  });

  await ta("Switch on: cache set to 1, mgb:deskplus fires once, then on", async () => {
    const L = load({ answer: { data: { value: true }, error: null } });
    assert.strictEqual(L.sb.WB_plusOn(true), false);
    await tick();
    await tick();
    assert.strictEqual(L.store.mgb_deskplus_cache, "1");
    assert.deepStrictEqual(L.events, ["mgb:deskplus"]);
    assert.strictEqual(L.sb.WB_plusOn(true), true);
    assert.strictEqual(L.calls.writes, 0);
  });

  await ta("Switch turned off: a stale cached 1 is removed and the event fires", async () => {
    const L = load({ ls: { mgb_deskplus_cache: "1" }, answer: { data: { value: false }, error: null } });
    assert.strictEqual(L.sb.WB_plusOn(true), true, "last known answer until the read lands");
    await tick();
    await tick();
    assert.strictEqual(L.store.mgb_deskplus_cache, undefined);
    assert.deepStrictEqual(L.events, ["mgb:deskplus"]);
    assert.strictEqual(L.sb.WB_plusOn(true), false);
  });

  await ta("No session yet: no tk_settings read, and it tries again later", async () => {
    const L = load({ noSession: true, answer: { data: { value: true }, error: null } });
    L.sb.WB_plusOn(true);
    await tick();
    await tick();
    assert.strictEqual(L.calls.from.length, 0);
    assert.strictEqual(L.calls.session, 1);
    L.sb.WB_plusOn(true);
    await tick();
    assert.strictEqual(L.calls.session, 2);
  });

  await ta("A read error leaves the cache alone and goes back to idle", async () => {
    const L = load({ ls: { mgb_deskplus_cache: "1" }, answer: { data: null, error: { message: "nope" } } });
    L.sb.WB_plusOn(true);
    await tick();
    await tick();
    assert.strictEqual(L.store.mgb_deskplus_cache, "1");
    assert.deepStrictEqual(L.events, []);
    L.sb.WB_plusOn(true);
    await tick();
    assert.strictEqual(L.calls.session, 2);
  });

  console.log("WB_plus: " + n + " tests passed");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
