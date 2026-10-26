// Plain node, no framework: `node components/inbox/TM_gate.test.js`.
// Guards the thread menu gate (TM_gate.js): the pure resolver's truth table
// (View as is always off; otherwise the preview or the firm switch), and, in
// a vm sandbox with a fake window, that View as makes no network call, the
// switch read waits for a session, happens once per page load, caches its
// answer in mgb_threadmenu_cache, fires mgb:threadmenu on a change, gives up
// after 3 errors and never writes.

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const P = require("./TM_gate.js");

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

t("View as: always off, whatever the preview or switch", () => {
  [true, 1, "yes"].forEach((ro) => {
    [true, false].forEach((pre) => {
      SWITCH_ON.concat(SWITCH_OFF).forEach((sw) => {
        assert.strictEqual(P.TM_isOn(ro, pre, sw), false, JSON.stringify([ro, pre, sw]));
      });
    });
  });
});
t("Not View as + preview: on, whatever the switch", () => {
  [false, undefined, null, 0].forEach((ro) => {
    SWITCH_ON.concat(SWITCH_OFF).forEach((sw) => {
      assert.strictEqual(P.TM_isOn(ro, true, sw), true, JSON.stringify([ro, sw]));
    });
  });
});
t("Switch true / \"true\" / 1 / {on:true}: on", () => {
  SWITCH_ON.forEach((sw) => {
    assert.strictEqual(P.TM_isOn(false, false, sw), true, JSON.stringify(sw));
  });
});
t("Nothing / false / null / undefined (and other junk): off", () => {
  SWITCH_OFF.forEach((sw) => {
    assert.strictEqual(P.TM_isOn(false, false, sw), false, JSON.stringify(sw));
  });
  assert.strictEqual(P.TM_isOn(), false);
  assert.strictEqual(P.TM_isOn(false, "1", undefined), false, "preview must be strictly true");
});
t("Keys and event names", () => {
  assert.strictEqual(P.TM_PREVIEW_KEY, "mgb_threadmenu_preview");
  assert.strictEqual(P.TM_CACHE_KEY, "mgb_threadmenu_cache");
  assert.strictEqual(P.TM_EVENT, "mgb:threadmenu");
  assert.strictEqual(P.TM_SWITCH_KEY, "threadmenu_enabled");
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
  const clock = { t: 1000000 };
  const sandbox = { window, Event: function (type) { this.type = type; }, console, Date: { now: () => clock.t } };
  if (o.viewAs) sandbox.MGB_viewAsReadOnly = () => true;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "TM_gate.js"), "utf8"), sandbox);
  return { sb: sandbox, store, calls, events, clock };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

(async () => {
  await ta("View as: off and no network call, even with the preview or a cached on", async () => {
    const L = load({ viewAs: true, ls: { mgb_threadmenu_preview: "1", mgb_threadmenu_cache: "1" } });
    assert.strictEqual(L.sb.TM_threadMenuOn(), false);
    await tick();
    assert.strictEqual(L.calls.from.length, 0);
    assert.strictEqual(L.calls.session, 0);
  });

  await ta("Preview on: on, and no switch read", async () => {
    const L = load({ ls: { mgb_threadmenu_preview: "1" } });
    assert.strictEqual(L.sb.TM_threadMenuOn(), true);
    await tick();
    assert.strictEqual(L.calls.from.length, 0);
  });

  await ta("Preview off, switch missing: off; one read of threadmenu_enabled per load, no write", async () => {
    const L = load({});
    assert.strictEqual(L.sb.TM_threadMenuOn(), false);
    L.sb.TM_threadMenuOn();
    await tick();
    await tick();
    assert.strictEqual(L.calls.from.length, 1);
    assert.deepStrictEqual(L.calls.from[0], { table: "tk_settings", eq: ["key", "threadmenu_enabled"] });
    assert.strictEqual(L.calls.writes, 0);
    assert.strictEqual(L.store.mgb_threadmenu_cache, undefined);
    assert.deepStrictEqual(L.events, []);
    L.sb.TM_threadMenuOn();
    await tick();
    assert.strictEqual(L.calls.from.length, 1, "one read per page load");
  });

  await ta("Switch on: cache set to 1, mgb:threadmenu fires once, then on", async () => {
    const L = load({ answer: { data: { value: true }, error: null } });
    assert.strictEqual(L.sb.TM_threadMenuOn(), false);
    await tick();
    await tick();
    assert.strictEqual(L.store.mgb_threadmenu_cache, "1");
    assert.deepStrictEqual(L.events, ["mgb:threadmenu"]);
    assert.strictEqual(L.sb.TM_threadMenuOn(), true);
    assert.strictEqual(L.calls.writes, 0);
  });

  await ta("Switch turned off: a stale cached 1 is removed and the event fires", async () => {
    const L = load({ ls: { mgb_threadmenu_cache: "1" }, answer: { data: { value: false }, error: null } });
    assert.strictEqual(L.sb.TM_threadMenuOn(), true, "last known answer until the read lands");
    await tick();
    await tick();
    assert.strictEqual(L.store.mgb_threadmenu_cache, undefined);
    assert.deepStrictEqual(L.events, ["mgb:threadmenu"]);
    assert.strictEqual(L.sb.TM_threadMenuOn(), false);
  });

  await ta("No session yet: no tk_settings read, and it tries again later", async () => {
    const L = load({ noSession: true, answer: { data: { value: true }, error: null } });
    L.sb.TM_threadMenuOn();
    await tick();
    await tick();
    assert.strictEqual(L.calls.from.length, 0);
    assert.strictEqual(L.calls.session, 1);
    L.sb.TM_threadMenuOn();
    await tick();
    assert.strictEqual(L.calls.session, 1, "not again within 3s");
    L.clock.t += 3001;
    L.sb.TM_threadMenuOn();
    await tick();
    assert.strictEqual(L.calls.session, 2);
  });

  await ta("A read error leaves the cache alone, retries after 30s and gives up after 3", async () => {
    const L = load({ ls: { mgb_threadmenu_cache: "1" }, answer: { data: null, error: { message: "nope" } } });
    L.sb.TM_threadMenuOn();
    await tick();
    await tick();
    assert.strictEqual(L.store.mgb_threadmenu_cache, "1");
    assert.deepStrictEqual(L.events, []);
    L.sb.TM_threadMenuOn();
    await tick();
    assert.strictEqual(L.calls.session, 1, "not again within 30s");
    L.clock.t += 30001;
    L.sb.TM_threadMenuOn();
    await tick();
    await tick();
    assert.strictEqual(L.calls.session, 2);
    L.clock.t += 30001;
    L.sb.TM_threadMenuOn();
    await tick();
    await tick();
    assert.strictEqual(L.calls.from.length, 3);
    L.clock.t += 30001;
    L.sb.TM_threadMenuOn();
    await tick();
    assert.strictEqual(L.calls.from.length, 3, "gives up after 3 errors this page load");
    assert.strictEqual(L.store.mgb_threadmenu_cache, "1");
  });

  console.log("TM_gate: " + n + " tests passed");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
