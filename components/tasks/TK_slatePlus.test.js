// Plain node, no framework: `node components/tasks/TK_slatePlus.test.js`.
// Guards the Slate plus gate (TK_slatePlus.js): the pure resolver's truth table
// (View as is always off; otherwise the preview or the firm switch), and, in
// a vm sandbox with a fake window, that View as makes no network call, the
// switch read waits for a session, happens once per page load, caches its
// answer in mgb_slateplus_cache, fires mgb:slateplus on a change, gives up
// after 3 errors and never writes.

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const P = require("./TK_slatePlus.js");

{
  const T = P.TKP_projectTag;
  assert.strictEqual(T({ kind: "onboarding", name: "Acme Q4" }, true), "Client");
  assert.strictEqual(T({ kind: "onboarding", name: "Acme Q4" }, false), "Onboarding");
  assert.strictEqual(T({ kind: "onboarding", name: "Acme Q4" }), "Onboarding");
  assert.strictEqual(T({ kind: "onboarding", name: "Acme ONBOARDING" }, true), "Onboarding");
  assert.strictEqual(T({ kind: "onboarding", name: "onboarding steps" }, true), "Onboarding");
  assert.strictEqual(T({ kind: "onboarding", name: null }, true), "Client");
  assert.strictEqual(T({ kind: "internal", name: "x" }, true), null);
  assert.strictEqual(T(null, true), null);
}

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
        assert.strictEqual(P.TKP_isOn(ro, pre, sw), false, JSON.stringify([ro, pre, sw]));
      });
    });
  });
});
t("Not View as + preview: on, whatever the switch", () => {
  [false, undefined, null, 0].forEach((ro) => {
    SWITCH_ON.concat(SWITCH_OFF).forEach((sw) => {
      assert.strictEqual(P.TKP_isOn(ro, true, sw), true, JSON.stringify([ro, sw]));
    });
  });
});
t("Switch true / \"true\" / 1 / {on:true}: on", () => {
  SWITCH_ON.forEach((sw) => {
    assert.strictEqual(P.TKP_isOn(false, false, sw), true, JSON.stringify(sw));
  });
});
t("Nothing / false / null / undefined (and other junk): off", () => {
  SWITCH_OFF.forEach((sw) => {
    assert.strictEqual(P.TKP_isOn(false, false, sw), false, JSON.stringify(sw));
  });
  assert.strictEqual(P.TKP_isOn(), false);
  assert.strictEqual(P.TKP_isOn(false, "1", undefined), false, "preview must be strictly true");
});
t("Keys and event names", () => {
  assert.strictEqual(P.TKP_PREVIEW_KEY, "mgb_slateplus_preview");
  assert.strictEqual(P.TKP_CACHE_KEY, "mgb_slateplus_cache");
  assert.strictEqual(P.TKP_EVENT, "mgb:slateplus");
  assert.strictEqual(P.TKP_SWITCH_KEY, "slateplus_enabled");
});

// ---- Browser behavior in a sandbox ----
function load(opts) {
  const o = opts || {};
  const store = Object.assign({}, o.ls || {});
  const calls = { from: [], session: 0, writes: 0, reads: 0, add: [], remove: [] };
  const events = [];
  const listeners = {};
  const window = {
    localStorage: {
      getItem: (k) => {
        calls.reads++;
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
    addEventListener: (type, fn) => {
      calls.add.push(type);
      (listeners[type] = listeners[type] || []).push(fn);
    },
    removeEventListener: (type, fn) => {
      calls.remove.push(type);
      listeners[type] = (listeners[type] || []).filter((x) => x !== fn);
    },
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
  sandbox.Promise = Promise;
  if (o.timers) {
    sandbox.timers = [];
    sandbox.setTimeout = (fn, ms) => {
      sandbox.timers.push({ fn, ms });
      return sandbox.timers.length;
    };
  }
  if (o.react) sandbox.React = o.react;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "TK_slatePlus.js"), "utf8"), sandbox);
  const fire = (type, e) => (listeners[type] || []).slice().forEach((fn) => fn(e || { type }));
  return { sb: sandbox, store, calls, events, clock, fire, listeners };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

(async () => {
  await ta("View as: off and no network call, even with the preview or a cached on", async () => {
    const L = load({ viewAs: true, ls: { mgb_slateplus_preview: "1", mgb_slateplus_cache: "1" } });
    assert.strictEqual(L.sb.TKP_on(), false);
    await tick();
    assert.strictEqual(L.calls.from.length, 0);
    assert.strictEqual(L.calls.session, 0);
  });

  await ta("Preview on: on, and no switch read", async () => {
    const L = load({ ls: { mgb_slateplus_preview: "1" } });
    assert.strictEqual(L.sb.TKP_on(), true);
    await tick();
    assert.strictEqual(L.calls.from.length, 0);
  });

  await ta("Preview off, switch missing: off; one read of slateplus_enabled per load, no write", async () => {
    const L = load({});
    assert.strictEqual(L.sb.TKP_on(), false);
    L.sb.TKP_on();
    await tick();
    await tick();
    assert.strictEqual(L.calls.from.length, 1);
    assert.deepStrictEqual(L.calls.from[0], { table: "tk_settings", eq: ["key", "slateplus_enabled"] });
    assert.strictEqual(L.calls.writes, 0);
    assert.strictEqual(L.store.mgb_slateplus_cache, undefined);
    assert.deepStrictEqual(L.events, []);
    L.sb.TKP_on();
    await tick();
    assert.strictEqual(L.calls.from.length, 1, "one read per page load");
  });

  await ta("Switch on: cache set to 1, mgb:slateplus fires once, then on", async () => {
    const L = load({ answer: { data: { value: true }, error: null } });
    assert.strictEqual(L.sb.TKP_on(), false);
    await tick();
    await tick();
    assert.strictEqual(L.store.mgb_slateplus_cache, "1");
    assert.deepStrictEqual(L.events, ["mgb:slateplus"]);
    assert.strictEqual(L.sb.TKP_on(), true);
    assert.strictEqual(L.calls.writes, 0);
  });

  await ta("Switch turned off: a stale cached 1 is removed and the event fires", async () => {
    const L = load({ ls: { mgb_slateplus_cache: "1" }, answer: { data: { value: false }, error: null } });
    assert.strictEqual(L.sb.TKP_on(), true, "last known answer until the read lands");
    await tick();
    await tick();
    assert.strictEqual(L.store.mgb_slateplus_cache, undefined);
    assert.deepStrictEqual(L.events, ["mgb:slateplus"]);
    assert.strictEqual(L.sb.TKP_on(), false);
  });

  await ta("No session yet: no tk_settings read, and it tries again later", async () => {
    const L = load({ noSession: true, answer: { data: { value: true }, error: null } });
    L.sb.TKP_on();
    await tick();
    await tick();
    assert.strictEqual(L.calls.from.length, 0);
    assert.strictEqual(L.calls.session, 1);
    L.sb.TKP_on();
    await tick();
    assert.strictEqual(L.calls.session, 1, "not again within 3s");
    L.clock.t += 3001;
    L.sb.TKP_on();
    await tick();
    assert.strictEqual(L.calls.session, 2);
  });

  await ta("A read error leaves the cache alone, retries after 30s and gives up after 3", async () => {
    const L = load({ ls: { mgb_slateplus_cache: "1" }, answer: { data: null, error: { message: "nope" } } });
    L.sb.TKP_on();
    await tick();
    await tick();
    assert.strictEqual(L.store.mgb_slateplus_cache, "1");
    assert.deepStrictEqual(L.events, []);
    L.sb.TKP_on();
    await tick();
    assert.strictEqual(L.calls.session, 1, "not again within 30s");
    L.clock.t += 30001;
    L.sb.TKP_on();
    await tick();
    await tick();
    assert.strictEqual(L.calls.session, 2);
    L.clock.t += 30001;
    L.sb.TKP_on();
    await tick();
    await tick();
    assert.strictEqual(L.calls.from.length, 3);
    L.clock.t += 30001;
    L.sb.TKP_on();
    await tick();
    assert.strictEqual(L.calls.from.length, 3, "gives up after 3 errors this page load");
    assert.strictEqual(L.store.mgb_slateplus_cache, "1");
  });

  // ---- The shared hook store (review fix 2026-10-27) ----
  // A fake React 18: useSyncExternalStore subscribes once per caller and
  // returns the snapshot, like the real one.
  const fakeReact = (subs) => ({
    useSyncExternalStore: (subscribe, getSnapshot) => {
      subs.push(subscribe(() => {}));
      return getSnapshot();
    },
  });

  await ta("hook: 300 rows add the window listeners once, and remove them with the last", async () => {
    const unsubs = [];
    const L = load({ react: fakeReact(unsubs), ls: { mgb_slateplus_preview: "1" } });
    for (let i = 0; i < 300; i++) assert.strictEqual(L.sb.TKP_useOn(), true);
    assert.deepStrictEqual(L.calls.add.sort(), ["mgb:slateplus", "storage"]);
    unsubs.slice(0, 299).forEach((u) => u());
    assert.strictEqual(L.calls.remove.length, 0);
    unsubs[299]();
    assert.deepStrictEqual(L.calls.remove.sort(), ["mgb:slateplus", "storage"]);
  });

  await ta("hook: one synchronous pass of 300 rows reads localStorage once (gate off)", async () => {
    const unsubs = [];
    const L = load({ react: fakeReact(unsubs), noSession: true });
    await tick();
    L.calls.reads = 0;
    for (let i = 0; i < 300; i++) assert.strictEqual(L.sb.TKP__snapshot(), false);
    assert.ok(L.calls.reads <= 2, "reads: " + L.calls.reads);
    await tick();
    // Next pass reads fresh (a Dev Tools flag change shows on the next render).
    L.store.mgb_slateplus_preview = "1";
    assert.strictEqual(L.sb.TKP__snapshot(), true);
  });

  await ta("hook: same answers as before (off, preview, cached switch, View as)", async () => {
    const cases = [
      [{}, false],
      [{ ls: { mgb_slateplus_preview: "1" } }, true],
      [{ ls: { mgb_slateplus_cache: "1" } }, true],
      [{ ls: { mgb_slateplus_preview: "1", mgb_slateplus_cache: "1" }, viewAs: true }, false],
    ];
    for (const [o, want] of cases) {
      const L = load(Object.assign({ react: fakeReact([]), noSession: true }, o));
      assert.strictEqual(L.sb.TKP_useOn(), want, JSON.stringify(o));
      await tick();
    }
  });

  await ta("hook: a change notifies subscribers; the snapshot is re-read", async () => {
    const L = load({ noSession: true });
    let hits = 0;
    const un = L.sb.TKP__subscribe(() => hits++);
    assert.strictEqual(L.sb.TKP__snapshot(), false);
    L.store.mgb_slateplus_cache = "1";
    L.fire("mgb:slateplus");
    assert.strictEqual(hits, 1);
    assert.strictEqual(L.sb.TKP__snapshot(), true);
    L.fire("storage", { key: "other_key" });
    assert.strictEqual(hits, 1, "unrelated keys are ignored");
    L.fire("storage", { key: null });
    assert.strictEqual(hits, 2);
    un();
    L.fire("mgb:slateplus");
    assert.strictEqual(hits, 2);
  });

  await ta("hook: View as subscribes without any network call", async () => {
    const L = load({ viewAs: true, react: fakeReact([]) });
    L.sb.TKP_useOn();
    await tick();
    assert.strictEqual(L.calls.session, 0);
    assert.strictEqual(L.calls.from.length, 0);
  });

  await ta("hook: no session yet retries once at its time while subscribed, never writes", async () => {
    const L = load({ noSession: true, timers: true });
    const un = L.sb.TKP__subscribe(() => {});
    await tick();
    assert.strictEqual(L.calls.session, 1);
    assert.strictEqual(L.calls.from.length, 0);
    L.sb.TKP__subscribe(() => {});
    assert.strictEqual(L.sb.timers.length, 1, "one shared retry timer");
    L.clock.t += 3001;
    L.sb.timers[0].fn();
    await tick();
    assert.strictEqual(L.calls.session, 2);
    assert.strictEqual(L.sb.timers.length, 2, "still no session: the next try is scheduled by itself");
    assert.strictEqual(L.calls.writes, 0);
    un();
  });

  t("fallback without useSyncExternalStore still shares the store", () => {
    const effects = [];
    const react = {
      useState: (v) => [v, () => {}],
      useEffect: (fn) => effects.push(fn),
    };
    const L = load({ react, ls: { mgb_slateplus_preview: "1" } });
    for (let i = 0; i < 50; i++) assert.strictEqual(L.sb.TKP_useOn(), true);
    const cleanups = effects.map((fn) => fn());
    assert.deepStrictEqual(L.calls.add.sort(), ["mgb:slateplus", "storage"]);
    cleanups.forEach((c) => c());
    assert.strictEqual(L.calls.remove.length, 2);
  });

  console.log("TK_slatePlus: " + n + " tests passed");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
