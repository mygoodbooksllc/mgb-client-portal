// Plain node, no framework: `node components/staff/RB_gate.test.js`.
// Guards the Review board gate (RB_gate.js, docs/review-board-spec.md
// section 1): the preview/switch truth table, the real-admin and View as
// checks inside RB_on(), a stale cache for a non-admin, and the switch read
// (only for a real admin, read only, missing row = off, event on change).

const assert = require("assert");

// A fake browser: localStorage, events, View as.
function fakeWindow() {
  const store = {};
  const events = [];
  return {
    store,
    events,
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
    mgbViewAs: { on: false },
  };
}
global.CustomEvent = function (type, init) {
  this.type = type;
  this.detail = init && init.detail;
};
global.window = fakeWindow();
const G = require("./RB_gate.js");

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
function reset() {
  global.window = fakeWindow();
  G.RB_setViewer(false);
  G.RB__switch.state = "idle";
  G.RB__switch.fails = 0;
  G.RB__switch.nextAt = 0;
}

t("names match the spec", () => {
  assert.strictEqual(G.RB_PREVIEW_KEY, "mgb_reviewboard_preview");
  assert.strictEqual(G.RB_CACHE_KEY, "mgb_reviewboard_cache");
  assert.strictEqual(G.RB_EVENT, "mgb:reviewboard");
  assert.strictEqual(G.RB_SWITCH, "reviewboard_enabled");
  assert.deepStrictEqual(G.RB__viewer, { realAdmin: false, read: false });
});

t("RB_isOn truth table: strict true only", () => {
  assert.strictEqual(G.RB_isOn(true, false), true);
  assert.strictEqual(G.RB_isOn(false, true), true);
  assert.strictEqual(G.RB_isOn(true, true), true);
  assert.strictEqual(G.RB_isOn(false, false), false);
  [undefined, null, 0, 1, "1", "true", {}].forEach((v) => {
    assert.strictEqual(G.RB_isOn(v, v), false, JSON.stringify(v));
  });
});

t("RB_switchValue: owner shapes on, everything else off", () => {
  [true, "true", 1, { on: true }].forEach((v) => assert.strictEqual(G.RB_switchValue(v), true, JSON.stringify(v)));
  [undefined, null, false, "false", 0, "", "1", {}, { on: false }, []].forEach((v) => assert.strictEqual(G.RB_switchValue(v), false, JSON.stringify(v)));
});

t("RB_on: off by default, even with preview and cache set", () => {
  reset();
  window.store.mgb_reviewboard_preview = "1";
  window.store.mgb_reviewboard_cache = "1";
  assert.strictEqual(G.RB_on(), false);
});

t("RB_on: a real admin needs the preview or the cached switch", () => {
  reset();
  G.RB_setViewer(true);
  assert.strictEqual(G.RB_on(), false);
  window.store.mgb_reviewboard_preview = "1";
  assert.strictEqual(G.RB_on(), true);
  delete window.store.mgb_reviewboard_preview;
  window.store.mgb_reviewboard_cache = "1";
  assert.strictEqual(G.RB_on(), true);
  window.store.mgb_reviewboard_cache = "true"; // only "1" counts
  assert.strictEqual(G.RB_on(), false);
});

t("RB_on: a stale cache in a non-admin's browser stays off", () => {
  reset();
  window.store.mgb_reviewboard_cache = "1";
  [false, undefined, null, 1, "true", "admin"].forEach((v) => {
    G.RB_setViewer(v);
    assert.strictEqual(G.RB_on(), false, JSON.stringify(v));
  });
});

t("RB_on and RB_firmOn: View as is always off", () => {
  reset();
  G.RB_setViewer(true);
  window.store.mgb_reviewboard_preview = "1";
  window.store.mgb_reviewboard_cache = "1";
  assert.strictEqual(G.RB_on(), true);
  assert.strictEqual(G.RB_firmOn(), true);
  window.mgbViewAs = { on: true, email: "bk@example.com" };
  assert.strictEqual(G.RB_viewingAs(), true);
  assert.strictEqual(G.RB_on(), false);
  assert.strictEqual(G.RB_firmOn(), false);
});

t("RB_firmOn ignores the per-person preview", () => {
  reset();
  G.RB_setViewer(true);
  window.store.mgb_reviewboard_preview = "1";
  assert.strictEqual(G.RB_firmOn(), false);
  window.store.mgb_reviewboard_cache = "1";
  assert.strictEqual(G.RB_firmOn(), true);
});

t("localStorage that throws reads as off", () => {
  reset();
  G.RB_setViewer(true);
  window.localStorage = {
    getItem: () => {
      throw new Error("blocked");
    },
  };
  assert.strictEqual(G.RB_on(), false);
});

// A fake supabase that records every call; only select is offered, so a write
// would throw.
function fakeSb(value, opts) {
  const o = opts || {};
  const calls = [];
  return {
    calls,
    auth: { getSession: () => Promise.resolve({ data: { session: o.noSession ? null : { user: {} } } }) },
    from(table) {
      calls.push(["from", table]);
      const q = {
        select(cols) {
          calls.push(["select", cols]);
          return q;
        },
        eq(col, v) {
          calls.push(["eq", col, v]);
          return q;
        },
        maybeSingle() {
          if (o.error) return Promise.resolve({ data: null, error: { message: "x" } });
          return Promise.resolve({ data: value === undefined ? null : { value }, error: null });
        },
      };
      return q;
    },
  };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

(async () => {
  await ta("switch read: not a real admin = no request at all", async () => {
    reset();
    const sb = fakeSb(true);
    window.mgbSupabase = sb;
    G.RB_switchRead();
    await tick();
    assert.deepStrictEqual(sb.calls, []);
    assert.strictEqual(window.store.mgb_reviewboard_cache, undefined);
  });

  await ta("switch read: real admin, switch on -> cache '1' and one event", async () => {
    reset();
    G.RB_setViewer(true);
    const sb = fakeSb(true);
    window.mgbSupabase = sb;
    G.RB_switchRead();
    await tick();
    await tick();
    assert.deepStrictEqual(sb.calls, [
      ["from", "tk_settings"],
      ["select", "value"],
      ["eq", "key", "reviewboard_enabled"],
    ]);
    assert.strictEqual(window.store.mgb_reviewboard_cache, "1");
    assert.deepStrictEqual(window.events, ["mgb:reviewboard"]);
    assert.strictEqual(G.RB_on(), true);
    // Once per page load.
    G.RB_switchRead();
    await tick();
    assert.strictEqual(sb.calls.length, 3);
  });

  await ta("switch read: missing row clears a stale cache and fires", async () => {
    reset();
    G.RB_setViewer(true);
    window.store.mgb_reviewboard_cache = "1";
    window.mgbSupabase = fakeSb(undefined);
    G.RB_switchRead();
    await tick();
    await tick();
    assert.strictEqual(window.store.mgb_reviewboard_cache, undefined);
    assert.deepStrictEqual(window.events, ["mgb:reviewboard"]);
    assert.strictEqual(G.RB_on(), false);
  });

  await ta("switch read: off value, no change = no event", async () => {
    reset();
    G.RB_setViewer(true);
    window.mgbSupabase = fakeSb(false);
    G.RB_switchRead();
    await tick();
    await tick();
    assert.strictEqual(window.store.mgb_reviewboard_cache, undefined);
    assert.deepStrictEqual(window.events, []);
  });

  await ta("switch read: no session waits; errors stop after 3", async () => {
    reset();
    G.RB_setViewer(true);
    const sb = fakeSb(true, { noSession: true });
    window.mgbSupabase = sb;
    G.RB_switchRead();
    await tick();
    assert.strictEqual(G.RB__switch.state, "idle");
    assert.ok(G.RB__switch.nextAt > Date.now());
    assert.deepStrictEqual(sb.calls, []);
    reset();
    G.RB_setViewer(true);
    window.mgbSupabase = fakeSb(true, { error: true });
    for (let i = 0; i < 3; i++) {
      G.RB_switchRead(true);
      await tick();
      await tick();
    }
    assert.strictEqual(G.RB__switch.state, "done");
    assert.strictEqual(window.store.mgb_reviewboard_cache, undefined);
  });

  console.log("RB_gate: " + n + " tests passed");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
