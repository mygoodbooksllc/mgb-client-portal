// Plain node, no framework: `node components/members/MB_gate.test.js`.
// Guards the Members area gate (MB_gate.js): the resolver, that everything off
// makes only the one tk_settings read (never members_staff_me), that the tab is
// hidden in View as, and that nothing is ever written.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

let n = 0;
async function ta(name, fn) {
  try {
    await fn();
  } catch (e) {
    console.error("FAIL " + name);
    throw e;
  }
  n++;
}

function load(o) {
  const store = Object.assign({}, o.ls || {});
  const events = [];
  const calls = { from: [], rpc: [], writes: 0, session: 0 };
  const window = {
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => {
        store[k] = String(v);
      },
      removeItem: (k) => {
        delete store[k];
      },
    },
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: (e) => {
      events.push(e.type);
    },
  };
  const builder = {
    select: () => builder,
    eq: () => builder,
    maybeSingle: () => Promise.resolve({ data: o.switchRow === undefined ? null : { value: o.switchRow }, error: null }),
    insert: () => (calls.writes++, builder),
    update: () => (calls.writes++, builder),
    upsert: () => (calls.writes++, builder),
    delete: () => (calls.writes++, builder),
  };
  window.mgbSupabase = {
    from: (table) => (calls.from.push(table), builder),
    rpc: (fn) => (calls.rpc.push(fn), Promise.resolve({ data: o.me || null, error: o.meError || null })),
    auth: { getSession: () => (calls.session++, Promise.resolve({ data: { session: { user: {} } } })) },
  };
  const sandbox = { window, Event: function (type) { this.type = type; }, console, Date, Promise };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "MB_gate.js"), "utf8"), sandbox);
  return { sb: sandbox, store, calls, events };
}
const tick = () => new Promise((r) => setTimeout(r, 5));
const ME = { switch_on: false, is_owner: true, can_list: true, can_open: true };

(async () => {
  await ta("resolver truth table", async () => {
    const L = load({});
    const R = L.sb.MB_isShown;
    assert.strictEqual(R(false, false, ME), false);
    assert.strictEqual(R(true, false, ME), true);
    assert.strictEqual(R(false, true, ME), true);
    assert.strictEqual(R(true, true, { can_list: false }), false);
    assert.strictEqual(R(true, true, null), false);
  });

  await ta("all off: one tk_settings read, no members_staff_me, no writes", async () => {
    const L = load({});
    assert.strictEqual(L.sb.MB_tabVisible({}), false);
    await tick();
    assert.strictEqual(L.calls.from.length, 1);
    assert.strictEqual(L.calls.from[0], "tk_settings");
    assert.strictEqual(L.calls.rpc.length, 0);
    assert.strictEqual(L.calls.writes, 0);
    assert.strictEqual(L.store.mgb_members_cache, undefined);
  });

  await ta("preview on: no tk_settings read, members_staff_me called, tab shows", async () => {
    const L = load({ ls: { mgb_members_preview: "1" }, me: ME });
    assert.strictEqual(L.sb.MB_tabVisible({}), false);
    await tick();
    assert.deepStrictEqual(Array.from(L.calls.rpc), ["members_staff_me"]);
    assert.strictEqual(L.calls.from.length, 0);
    assert.strictEqual(L.sb.MB_tabVisible({}), true);
    assert.ok(L.events.indexOf("mgb:members") !== -1);
  });

  await ta("hidden in View as and impersonation even when on", async () => {
    const L = load({ ls: { mgb_members_preview: "1" }, me: ME });
    L.sb.MB_tabVisible({});
    await tick();
    assert.strictEqual(L.sb.MB_tabVisible({ impersonating: { email: "x" } }), false);
    assert.strictEqual(L.sb.MB_tabVisible({ viewAs: true }), false);
    assert.strictEqual(L.sb.MB_tabVisible({}), true);
  });

  await ta("preview on but can_list false: hidden", async () => {
    const L = load({ ls: { mgb_members_preview: "1" }, me: { switch_on: false, is_owner: false, can_list: false, can_open: false } });
    L.sb.MB_tabVisible({});
    await tick();
    assert.strictEqual(L.sb.MB_tabVisible({}), false);
  });

  await ta("firm switch on: cached, event fires, then members_staff_me", async () => {
    const L = load({ switchRow: true, me: { switch_on: true, is_owner: false, can_list: true, can_open: false } });
    L.sb.MB_tabVisible({});
    await tick();
    assert.strictEqual(L.store.mgb_members_cache, "1");
    L.sb.MB_tabVisible({});
    await tick();
    assert.deepStrictEqual(Array.from(L.calls.rpc), ["members_staff_me"]);
    assert.strictEqual(L.sb.MB_tabVisible({}), true);
    assert.strictEqual(L.calls.writes, 0);
  });

  await ta("switch turned off clears the cache", async () => {
    const L = load({ ls: { mgb_members_cache: "1" }, switchRow: false });
    L.sb.MB_tabVisible({});
    await tick();
    assert.strictEqual(L.store.mgb_members_cache, undefined);
  });

  console.log("MB_gate: " + n + " checks passed");
})();
