// Plain node: `node components/tasks/TK_slateIxReview.test.js`.
// Slate app final review fixes (2026-10-23): the size preset double-click
// race (run for real in a sandbox) and static guards on the late Undo wiring
// in TK_Drag.jsx (the UI itself needs a signed-in browser).

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

let n = 0;
const queue = [];
function t(name, fn) {
  queue.push({ name, fn });
}
const ROOT = path.join(__dirname, "../..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

// Pull TK_slateApplyPreset (plain JS, no JSX) out of TK_SlateModes.jsx and
// run it against a fake window whose resizeTo lands after `lag` ms.
function presetSandbox(lag) {
  const src = read("components/tasks/TK_SlateModes.jsx");
  const a = src.indexOf("var TK__smPresetGen");
  const b = src.indexOf("function TK__smPresetSub");
  assert.ok(a > 0 && b > a, "TK_slateApplyPreset found");
  let now = 0;
  const timers = [];
  const listeners = [];
  const misses = [];
  const win = {
    innerWidth: 1000,
    innerHeight: 800,
    outerWidth: 1000,
    outerHeight: 800,
    screen: { availWidth: 1600, availHeight: 1000, availLeft: 0, availTop: 0 },
    moveTo() {},
    // like a window manager that animates the resize: a newer resizeTo
    // replaces one still in flight, so the window never shows the first size
    resizeTo(w, h) {
      const i = timers.findIndex((x) => x.resize);
      if (i >= 0) timers.splice(i, 1);
      timers.push({ at: now + lag, resize: true, fn: () => {
        win.innerWidth = w;
        win.innerHeight = h;
        listeners.slice().forEach((f) => f());
      } });
    },
    addEventListener(type, fn) {
      if (type === "resize") listeners.push(fn);
    },
    removeEventListener(type, fn) {
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    },
    requestAnimationFrame(fn) {
      timers.push({ at: now + 16, fn });
    },
  };
  const ctx = {
    window: win,
    Date: { now: () => now },
    setTimeout(fn, ms) {
      timers.push({ at: now + (ms || 0), fn });
    },
    TK_slatePresetsOk: () => true,
    TK_slateSizePreset: (id) => (id === "sliver" ? { w: 360, h: 800 } : { w: 900, h: 800 }),
    TK_slateSizeHit: (want, got) => Math.abs(want.w - got.w) <= 4 && Math.abs(want.h - got.h) <= 4,
    TK__smMiss: (id) => misses.push(id),
  };
  vm.createContext(ctx);
  vm.runInContext(src.slice(a, b), ctx);
  return {
    apply: (id) => ctx.TK_slateApplyPreset(id),
    advance(ms) {
      const end = now + ms;
      for (;;) {
        timers.sort((x, y) => x.at - y.at);
        if (!timers.length || timers[0].at > end) break;
        const next = timers.shift();
        now = next.at;
        next.fn();
      }
      now = end;
    },
    misses,
    listeners,
  };
}

t("presets: a second click within 500 ms is not a miss (presets stay shown)", () => {
  const s = presetSandbox(250);
  s.apply("sliver");
  s.advance(150);
  s.apply("list");
  s.advance(2000);
  assert.deepStrictEqual(s.misses, [], "no miss from the older check");
  assert.strictEqual(s.listeners.length, 0, "every resize listener removed");
});

t("presets: a resize that never lands is still a miss", () => {
  const s = presetSandbox(100000);
  s.apply("list");
  s.advance(2000);
  assert.deepStrictEqual(s.misses, ["list"]);
  assert.strictEqual(s.listeners.length, 0);
});

t("presets: one click that lands is not a miss", () => {
  const s = presetSandbox(80);
  s.apply("sliver");
  s.advance(2000);
  assert.deepStrictEqual(s.misses, []);
});

t("late undo wiring: a move between sections re-reads the task before putting it back", () => {
  const src = read("components/tasks/TK_Drag.jsx");
  const fn = src.slice(src.indexOf("function TK__manualOfferUndo"), src.indexOf("function TK__manualStamp"));
  assert.ok(fn.indexOf("TK_api.undoCheck(") > 0, "undoCheck called");
  assert.ok(fn.indexOf("r.updatedAt") > 0, "uses the stamp the move returned");
  assert.ok(fn.indexOf("Not undone: the task was changed after the move") > 0, "says so when changed");
  assert.ok(fn.indexOf("Not undone: the task was moved again since.") > 0, "no stamp: section guard");
  assert.ok(src.indexOf("if (back) TK__manualOfferUndo(plan, back, move, c, r);") > 0, "passes the server answer");
});

t("drag box: a press on a scrollbar never starts a box", () => {
  const src = read("components/tasks/TK_SlateIx.jsx");
  const a = src.indexOf("function TK__ixOnScrollbar");
  const b = src.indexOf("var TK__IX_INTERACTIVE");
  assert.ok(a > 0 && b > a, "helper found");
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(src.slice(a, b), ctx);
  const el = { nodeType: 1, offsetWidth: 415, clientWidth: 400, offsetHeight: 600, clientHeight: 600 };
  assert.strictEqual(ctx.TK__ixOnScrollbar({ target: el, offsetX: 405, offsetY: 10 }), true, "on the vertical bar");
  assert.strictEqual(ctx.TK__ixOnScrollbar({ target: el, offsetX: 200, offsetY: 10 }), false, "in the list");
  const flat = { nodeType: 1, offsetWidth: 402, clientWidth: 400, offsetHeight: 600, clientHeight: 598 };
  assert.strictEqual(ctx.TK__ixOnScrollbar({ target: flat, offsetX: 399, offsetY: 597 }), false, "overlay bars / thin borders");
  const wide = { nodeType: 1, offsetWidth: 800, clientWidth: 800, offsetHeight: 615, clientHeight: 600 };
  assert.strictEqual(ctx.TK__ixOnScrollbar({ target: wide, offsetX: 10, offsetY: 606 }), true, "on the board's horizontal bar");
  assert.strictEqual(ctx.TK__ixOnScrollbar({ target: null }), false);
  assert.ok(src.indexOf("if (TK__ixOnScrollbar(e)) return;") > 0, "wired into the drag box start");
});

t("shift-click select: page text the click stretched over the list is dropped", () => {
  const src = read("components/tasks/TK_SlateIx.jsx");
  const a = src.indexOf("function TK__ixDropTextSelection");
  const b = src.indexOf("function TK__ixOnScrollbar");
  assert.ok(a > 0 && b > a, "helper found");
  let cleared = 0;
  const inList = { id: "row" };
  const outside = { id: "header" };
  const root = { contains: (n) => n === inList };
  const sel = (collapsed, start, end) => ({
    isCollapsed: collapsed,
    rangeCount: 1,
    getRangeAt: () => ({ startContainer: start, endContainer: end }),
    removeAllRanges: () => cleared++,
  });
  const ctx = { window: { getSelection: () => cur } };
  let cur = sel(false, inList, inList);
  vm.createContext(ctx);
  vm.runInContext(src.slice(a, b), ctx);
  assert.strictEqual(ctx.TK__ixDropTextSelection(root), true, "selection over rows dropped");
  cur = sel(false, outside, outside);
  assert.strictEqual(ctx.TK__ixDropTextSelection(root), false, "text elsewhere on the page kept");
  cur = sel(true, inList, inList);
  assert.strictEqual(ctx.TK__ixDropTextSelection(root), false, "nothing selected");
  assert.strictEqual(ctx.TK__ixDropTextSelection(null), false, "no list");
  assert.strictEqual(cleared, 1);
  const click = src.slice(src.indexOf("var onClick = function (e)"), src.indexOf("var onCtx = function (e)"));
  assert.ok(click.indexOf("TK__ixDropTextSelection(rootEl());") > click.indexOf("c.bulk.toggle("), "runs after the toggle");
});

t("saved views: only the newest list request may land", () => {
  const src = read("components/tasks/TK_SavedViews.jsx");
  const fn = src.slice(src.indexOf("var reqRef = React.useRef(0);"), src.indexOf("React.useEffect(function () {\n    load();"));
  assert.ok(fn.indexOf("var req = ++reqRef.current;") > 0);
  assert.strictEqual((fn.match(/if \(req !== reqRef\.current\) return;/g) || []).length, 2, "both answers check it");
});

(async () => {
  for (const item of queue) {
    try {
      await item.fn();
      n++;
    } catch (e) {
      console.error("FAIL " + item.name);
      console.error(e);
      process.exit(1);
    }
  }
  console.log(n + " checks passed");
})();
