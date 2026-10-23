// ----------------------------------------------------------------------------
// TK_Drag.jsx — Slate app P2: drag to reorder, Alt+Up / Alt+Down, and the
// manual-order switch. Only the Slate app uses it (the callers gate on
// TK_manualOrderAllowed, which needs TK_slateInApp), so the portal page
// renders exactly as before.
//
// The hooks know nothing about tasks beyond ids: rows are [data-tk-id]
// children of a group element [data-tk-group="<index>"], and groups are
// [{ key, label, tasks }] in the order shown. The P1 board can reuse
// TK_useRowDrag with its columns as groups.
//
// Pure rules (key between neighbors, drop plans, Alt+arrow targets) live in
// TK_viewLogic.js (TK_manual*); the server side is tk_manual_reorder
// (supabase/tasks-slate-p2-fixes.sql). The order is per person
// (tk_manual_order) and never touches the shared staff_reminders.sort_key.
// ----------------------------------------------------------------------------

var TK_DRAG_THRESHOLD = 4; // px before a press on the handle becomes a drag
var TK_DRAG_EDGE = 48; // px from a scroll edge where autoscroll starts
var TK_DRAG_SPEED = 14; // px per frame at the very edge

// The nearest scrolling ancestor (or null for the page itself).
function TK_dragScroller(el) {
  var n = el && el.parentElement;
  while (n && n !== document.body && n !== document.documentElement) {
    try {
      var st = window.getComputedStyle(n);
      if (/(auto|scroll)/.test(st.overflowY) && n.scrollHeight > n.clientHeight + 1) return n;
    } catch (e) {}
    n = n.parentElement;
  }
  return null;
}

// The rows of one group element, in order (direct [data-tk-id] children).
function TK_dragRows(groupEl) {
  var out = [];
  var kids = groupEl ? groupEl.children : [];
  for (var i = 0; i < kids.length; i++) {
    if (kids[i].getAttribute && kids[i].getAttribute("data-tk-id")) out.push(kids[i]);
  }
  return out;
}

// The bottom edge of a row together with its open subtask rows.
function TK_dragRowBottom(row) {
  var b = row.getBoundingClientRect().bottom;
  var n = row.nextElementSibling;
  while (n && !n.getAttribute("data-tk-id") && n.classList && n.classList.contains("tk-subrow")) {
    b = Math.max(b, n.getBoundingClientRect().bottom);
    n = n.nextElementSibling;
  }
  return b;
}

// opts: { enabled, containerRef, groups, crossGroup, onMove(plan) }
// Press the [data-tk-drag-handle] inside a row and move 4px to start. A line
// shows where it will land; near the scroll edges the list scrolls. Esc or
// a cancelled pointer drops nothing. onMove gets a TK_manualDropPlan.
// Slate app P1 (the board) adds, all optional, so lists behave as before:
//   axis "x"   groups sit side by side (columns): the nearest by x wins, and
//              the container itself scrolls sideways near its edges
//   canDrop(fromIndex, toIndex, id) -> false marks that group .tk-drop-no
//   onBlocked(fromIndex, toIndex, id) when the drop lands on such a group
// Slate app interactions add, all optional (unset: nothing changes):
//   touch            a 400ms press on a row or card starts the drag on a
//                    touch screen; moving first scrolls as usual; a press
//                    held without moving calls onLongPress(id, x, y)
//   onDropTarget(value, id)  dropping on a [data-tk-drop-target] element
//                    (the person / date dock) instead of a group
function TK__dragDropEl(x, y) {
  try {
    var el = document.elementFromPoint(x, y);
    return el && el.closest ? el.closest("[data-tk-drop-target]") : null;
  } catch (e) {
    return null;
  }
}
function TK__dragClearDock() {
  var on = document.querySelectorAll("[data-tk-drop-target].is-over");
  for (var i = 0; i < on.length; i++) on[i].classList.remove("is-over");
}
var TK_DRAG_HOLD_MS = 400; // touch: press this long to pick a row up
var TK_DRAG_HOLD_SLOP = 8; // touch: moving more than this first scrolls instead
function TK_useRowDrag(opts) {
  var ref = React.useRef(opts || {});
  ref.current = opts || {};
  var enabled = !!(opts && opts.enabled);
  var useTouch = !!(opts && opts.enabled && opts.touch);

  React.useEffect(
    function () {
      if (!enabled) return undefined;
      if (typeof TK_manualDropPlan !== "function") return undefined;
      var d = null; // the drag in progress
      var box = null; // the list element of the drag in progress (read at press time)

      function groupEls() {
        var all = box.querySelectorAll("[data-tk-group]");
        var out = [];
        for (var i = 0; i < all.length; i++) out.push(all[i]);
        return out;
      }
      function target(x, y) {
        if (typeof ref.current.onDropTarget === "function") {
          var dock = TK__dragDropEl(x, y);
          if (dock) return { drop: dock.getAttribute("data-tk-drop-target"), dropEl: dock };
        }
        var els = groupEls();
        if (!ref.current.crossGroup) {
          els = els.filter(function (g) { return g.getAttribute("data-tk-group") === d.fromGroup; });
        }
        var best = null;
        var bestDist = Infinity;
        var byX = ref.current.axis === "x";
        els.forEach(function (g) {
          var r = g.getBoundingClientRect();
          var dist = byX ? (x < r.left ? r.left - x : x > r.right ? x - r.right : 0) : y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
          if (dist < bestDist) {
            bestDist = dist;
            best = g;
          }
        });
        if (!best) return null;
        var bestGroup = best.getAttribute("data-tk-group");
        if (typeof ref.current.canDrop === "function" && bestGroup !== d.fromGroup && !ref.current.canDrop(Number(d.fromGroup), Number(bestGroup), d.id)) {
          return { groupEl: best, group: bestGroup, blocked: true };
        }
        var rows = TK_dragRows(best);
        var idx = 0;
        for (var i = 0; i < rows.length; i++) {
          var rr = rows[i].getBoundingClientRect();
          if (y > rr.top + rr.height / 2) idx = i + 1;
        }
        var gr = best.getBoundingClientRect();
        var lineY = rows.length === 0 ? gr.top + 2 : idx < rows.length ? rows[idx].getBoundingClientRect().top : TK_dragRowBottom(rows[rows.length - 1]);
        return { groupEl: best, group: best.getAttribute("data-tk-group"), index: idx, lineY: lineY, left: gr.left, width: gr.width };
      }
      function place() {
        if (!d || !d.active) return;
        var t = target(d.x, d.y);
        d.target = t;
        if (typeof ref.current.onDropTarget === "function") {
          TK__dragClearDock();
          if (t && t.drop) {
            t.dropEl.classList.add("is-over");
            d.line.style.display = "none";
            var into = box.querySelectorAll(".tk-drop-into, .tk-drop-no");
            for (var q = 0; q < into.length; q++) into[q].classList.remove("tk-drop-into", "tk-drop-no");
            return;
          }
        }
        var no = box.querySelectorAll(".tk-drop-no");
        for (var n = 0; n < no.length; n++) if (!t || no[n] !== t.groupEl || !t.blocked) no[n].classList.remove("tk-drop-no");
        if (!t || t.blocked) {
          d.line.style.display = "none";
          var was = box.querySelectorAll(".tk-drop-into");
          for (var w = 0; w < was.length; w++) was[w].classList.remove("tk-drop-into");
          if (t) t.groupEl.classList.add("tk-drop-no");
          return;
        }
        d.line.style.display = "block";
        d.line.style.top = Math.round(t.lineY - 1) + "px";
        d.line.style.left = Math.round(t.left) + "px";
        d.line.style.width = Math.round(t.width) + "px";
        var on = box.querySelectorAll(".tk-drop-into");
        for (var i = 0; i < on.length; i++) if (on[i] !== t.groupEl) on[i].classList.remove("tk-drop-into");
        if (t.group !== d.fromGroup) t.groupEl.classList.add("tk-drop-into");
      }
      function tick() {
        if (!d || !d.active) return;
        var sc = d.scroller;
        var top = sc ? sc.getBoundingClientRect().top : 0;
        var bottom = sc ? sc.getBoundingClientRect().bottom : window.innerHeight;
        var dy = 0;
        if (d.y < top + TK_DRAG_EDGE) dy = -Math.ceil(((top + TK_DRAG_EDGE - d.y) / TK_DRAG_EDGE) * TK_DRAG_SPEED);
        else if (d.y > bottom - TK_DRAG_EDGE) dy = Math.ceil(((d.y - (bottom - TK_DRAG_EDGE)) / TK_DRAG_EDGE) * TK_DRAG_SPEED);
        var dx = 0;
        if (ref.current.axis === "x" && box) {
          var br = box.getBoundingClientRect();
          if (d.x < br.left + TK_DRAG_EDGE) dx = -Math.ceil(((br.left + TK_DRAG_EDGE - d.x) / TK_DRAG_EDGE) * TK_DRAG_SPEED);
          else if (d.x > br.right - TK_DRAG_EDGE) dx = Math.ceil(((d.x - (br.right - TK_DRAG_EDGE)) / TK_DRAG_EDGE) * TK_DRAG_SPEED);
          if (dx) box.scrollLeft += dx;
        }
        if (dy) {
          if (sc) sc.scrollTop += dy;
          else window.scrollBy(0, dy);
        }
        if (dy || dx) place();
        d.raf = window.requestAnimationFrame(tick);
      }
      function start() {
        d.active = true;
        d.row.classList.add("tk-drag-src");
        document.documentElement.classList.add("tk-dragging");
        var line = document.createElement("div");
        line.className = "tk-drop-line";
        line.setAttribute("aria-hidden", "true");
        document.body.appendChild(line);
        d.line = line;
        d.scroller = TK_dragScroller(box);
        d.raf = window.requestAnimationFrame(tick);
      }
      function end(commit) {
        var cur = d;
        d = null;
        document.removeEventListener("pointermove", onMove, true);
        document.removeEventListener("pointerup", onUp, true);
        document.removeEventListener("pointercancel", onCancel, true);
        document.removeEventListener("keydown", onKey, true);
        if (cur && cur.hold) window.clearTimeout(cur.hold);
        if (!cur || !cur.active || !box) return;
        if (cur.raf) window.cancelAnimationFrame(cur.raf);
        cur.row.classList.remove("tk-drag-src");
        document.documentElement.classList.remove("tk-dragging");
        if (cur.line && cur.line.parentNode) cur.line.parentNode.removeChild(cur.line);
        var on = box.querySelectorAll(".tk-drop-into, .tk-drop-no");
        for (var i = 0; i < on.length; i++) on[i].classList.remove("tk-drop-into", "tk-drop-no");
        if (typeof ref.current.onDropTarget === "function") TK__dragClearDock();
        // the click that ends a drag must not open the task (a touch drag's
        // synthetic click comes later, so it is swallowed for longer)
        var swallow = function (e) {
          e.stopPropagation();
          e.preventDefault();
        };
        document.addEventListener("click", swallow, true);
        window.setTimeout(function () {
          document.removeEventListener("click", swallow, true);
        }, cur.touch ? 450 : 0);
        if (!commit || !cur.target) return;
        if (cur.target.drop) {
          if (typeof ref.current.onDropTarget === "function") ref.current.onDropTarget(cur.target.drop, cur.id);
          return;
        }
        if (cur.target.blocked) {
          if (ref.current.onBlocked) ref.current.onBlocked(Number(cur.fromGroup), Number(cur.target.group), cur.id);
          return;
        }
        var gs = ref.current.groups || [];
        var g = gs[Number(cur.target.group)];
        if (!g) return;
        var plan = TK_manualDropPlan(gs, cur.id, g.key, cur.target.index, { crossGroup: !!ref.current.crossGroup });
        if (plan && ref.current.onMove) ref.current.onMove(plan);
      }
      function onMove(e) {
        if (!d || e.pointerId !== d.pointerId) return;
        d.x = e.clientX;
        d.y = e.clientY;
        if (!d.active) {
          if (Math.abs(d.x - d.x0) < TK_DRAG_THRESHOLD && Math.abs(d.y - d.y0) < TK_DRAG_THRESHOLD) return;
          start();
        }
        e.preventDefault();
        place();
      }
      function onUp(e) {
        if (!d || e.pointerId !== d.pointerId) return;
        end(true);
      }
      function onCancel() {
        end(false);
      }
      function onKey(e) {
        if (e.key === "Escape" && d) {
          e.preventDefault();
          e.stopPropagation();
          end(false);
        }
      }
      function onDown(e) {
        if (d || e.button !== 0 || !e.isPrimary) return;
        // touch screens use the press-and-hold path below instead
        if (useTouch && e.pointerType === "touch") return;
        var h = e.target && e.target.closest ? e.target.closest("[data-tk-drag-handle]") : null;
        box = ref.current.containerRef && ref.current.containerRef.current;
        if (!h || !box || !box.contains(h)) return;
        var row = h.closest("[data-tk-id]");
        var grp = row && row.parentElement && row.parentElement.closest("[data-tk-group]");
        if (!row || !grp) return;
        e.preventDefault(); // no text selection, no focus jump
        d = {
          id: row.getAttribute("data-tk-id"),
          row: row,
          fromGroup: grp.getAttribute("data-tk-group"),
          pointerId: e.pointerId,
          x0: e.clientX,
          y0: e.clientY,
          x: e.clientX,
          y: e.clientY,
          active: false,
        };
        document.addEventListener("pointermove", onMove, true);
        document.addEventListener("pointerup", onUp, true);
        document.addEventListener("pointercancel", onCancel, true);
        document.addEventListener("keydown", onKey, true);
      }
      document.addEventListener("pointerdown", onDown);

      // ---- touch (Slate app, opts.touch): press and hold to pick up -------
      function touchOf(e) {
        if (!d || !d.touch) return null;
        var list = e.changedTouches || [];
        for (var i = 0; i < list.length; i++) if (list[i].identifier === d.touchId) return list[i];
        return null;
      }
      function onTouchStart(e) {
        if (d || !e.touches || e.touches.length !== 1) return;
        var t0 = e.touches[0];
        if (typeof TK_ixAtEdge === "function" && TK_ixAtEdge(t0.clientX, window.innerWidth)) return; // swipe back
        box = ref.current.containerRef && ref.current.containerRef.current;
        var el = e.target && e.target.closest ? e.target : null;
        if (!el || !box || !box.contains(el)) return;
        if (el.closest("input, textarea, select, button, a[href], [contenteditable='true'], [role='checkbox']")) return;
        var row = el.closest("[data-tk-id]");
        var grp = row && row.parentElement && row.parentElement.closest("[data-tk-group]");
        if (!row || !grp || !box.contains(grp) || (row.classList && row.classList.contains("tk-subrow"))) return;
        d = {
          id: row.getAttribute("data-tk-id"),
          row: row,
          fromGroup: grp.getAttribute("data-tk-group"),
          touch: true,
          touchId: t0.identifier,
          x0: t0.clientX,
          y0: t0.clientY,
          x: t0.clientX,
          y: t0.clientY,
          active: false,
          moved: false,
        };
        var mine = d;
        d.hold = window.setTimeout(function () {
          if (d !== mine || d.active) return;
          d.hold = null;
          start();
          try {
            if (navigator.vibrate) navigator.vibrate(12);
          } catch (err) {}
          place();
        }, TK_DRAG_HOLD_MS);
        document.addEventListener("keydown", onKey, true);
      }
      function onTouchMove(e) {
        var t = touchOf(e);
        if (!t) return;
        d.x = t.clientX;
        d.y = t.clientY;
        if (!d.active) {
          // moved before the hold: it is a scroll (or a row swipe), not a drag
          if (Math.abs(d.x - d.x0) > TK_DRAG_HOLD_SLOP || Math.abs(d.y - d.y0) > TK_DRAG_HOLD_SLOP) end(false);
          return;
        }
        if (e.cancelable) e.preventDefault(); // no page scroll while carrying
        if (Math.abs(d.x - d.x0) > TK_DRAG_HOLD_SLOP || Math.abs(d.y - d.y0) > TK_DRAG_HOLD_SLOP) d.moved = true;
        place();
      }
      function onTouchEnd(e) {
        var t = touchOf(e);
        if (!t) return;
        var cur = d;
        if (cur.active && !cur.moved) {
          // held without moving: the row menu, not a drop
          end(false);
          if (typeof ref.current.onLongPress === "function") ref.current.onLongPress(cur.id, cur.x, cur.y);
          return;
        }
        end(!!cur.active);
      }
      function onTouchCancel() {
        if (d && d.touch) end(false);
      }
      function onContextMenu(e) {
        // a long press on Android also fires contextmenu; the drag owns it
        if (d && d.touch) e.preventDefault();
      }
      // only registered when asked for (the Slate app), so other callers
      // keep the exact listeners they had
      if (useTouch) {
        document.addEventListener("touchstart", onTouchStart, { passive: true });
        document.addEventListener("touchmove", onTouchMove, { passive: false });
        document.addEventListener("touchend", onTouchEnd, true);
        document.addEventListener("touchcancel", onTouchCancel, true);
        document.addEventListener("contextmenu", onContextMenu, true);
      }
      return function () {
        document.removeEventListener("pointerdown", onDown);
        if (useTouch) {
          document.removeEventListener("touchstart", onTouchStart, { passive: true });
          document.removeEventListener("touchmove", onTouchMove, { passive: false });
          document.removeEventListener("touchend", onTouchEnd, true);
          document.removeEventListener("touchcancel", onTouchCancel, true);
          document.removeEventListener("contextmenu", onContextMenu, true);
        }
        end(false);
      };
    },
    [enabled, useTouch],
  );
}

// opts: { enabled, groups, focusedId, crossGroup, onMove(plan) }
// Alt+Up / Alt+Down moves the focused row one place (into the next section
// on a project list). The same guards as the list keys: not while typing, in
// a menu, a dialog or a tour, and not inside the task drawer.
function TK_useManualKeys(opts) {
  var ref = React.useRef(opts || {});
  ref.current = opts || {};
  var enabled = !!(opts && opts.enabled);
  React.useEffect(
    function () {
      if (!enabled) return undefined;
      var onKey = function (e) {
        if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
        if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
        var o = ref.current;
        if (!o.focusedId || typeof TK_manualKeyTarget !== "function") return;
        if (typeof TK_shouldHandleKey === "function" && typeof TK_vKeyCtx === "function") {
          var probe = { target: e.target, isComposing: e.isComposing, keyCode: e.keyCode, defaultPrevented: e.defaultPrevented };
          if (!TK_shouldHandleKey(probe, TK_vKeyCtx())) return;
        }
        var plan = TK_manualKeyTarget(o.groups || [], o.focusedId, e.key === "ArrowUp" ? -1 : 1, { crossGroup: !!o.crossGroup });
        e.preventDefault();
        if (plan && o.onMove) o.onMove(plan, { keys: true });
      };
      document.addEventListener("keydown", onKey);
      return function () {
        document.removeEventListener("keydown", onKey);
      };
    },
    [enabled],
  );
}

// Per-person, app-only "manual order" memory for one scope ("my",
// "list:<listKey>"). Returns [on, setOn].
function TK_useManualPref(scope) {
  var read = function () {
    try {
      return TK_manualPrefRead(window.localStorage.getItem(TK_MANUAL_PREF_KEY), scope);
    } catch (e) {
      return false;
    }
  };
  var pair = React.useState(read);
  React.useEffect(
    function () {
      pair[1](read());
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scope],
  );
  var set = function (on) {
    pair[1](!!on);
    try {
      window.localStorage.setItem(TK_MANUAL_PREF_KEY, TK_manualPrefWrite(window.localStorage.getItem(TK_MANUAL_PREF_KEY), scope, !!on));
    } catch (e) {}
  };
  return [pair[0], set];
}

// One polite live region per view for "Moved to position 2 of 5 in Today."
function TK_useManualAnnouncer() {
  var pair = React.useState("");
  var el = (
    <div className="tk-sr" role="status" aria-live="polite" aria-atomic="true">
      {pair[0]}
    </div>
  );
  var say = function (text) {
    pair[1]("");
    window.setTimeout(function () {
      pair[1](text || "");
    }, 30);
  };
  return { el: el, say: say };
}

// ---- The person's own manual order (tk_manual_order) ----------------------
// One keys map { taskId: key } per scope ("my", "list:<listKey>"), shared by
// every view of that scope in this window. It is never written to the task
// store or to staff_reminders.sort_key, so the portal never sees it.
var TK__manualCache = {}; // scope -> keys map
var TK__manualVer = {}; // scope -> bumps on every local change
var TK__manualSubs = {}; // scope -> [fn(keys)]

function TK__manualSet(scope, keys) {
  TK__manualCache[scope] = keys || {};
  TK__manualVer[scope] = (TK__manualVer[scope] || 0) + 1;
  (TK__manualSubs[scope] || []).slice().forEach(function (fn) {
    try {
      fn(TK__manualCache[scope]);
    } catch (e) {}
  });
}

function TK__manualReload(scope) {
  if (!scope || typeof TK_api === "undefined" || !TK_api || typeof TK_api.manualOrderLoad !== "function") return Promise.resolve(null);
  var ver = TK__manualVer[scope] || 0;
  return TK_api.manualOrderLoad(scope).then(
    function (keys) {
      // a move made while this was loading wins; its own reply brings the keys
      if ((TK__manualVer[scope] || 0) === ver) TK__manualSet(scope, keys || {});
      return keys;
    },
    function () {
      return null;
    },
  );
}

// The keys map for scope while enabled (an empty map otherwise). Loads once
// per scope per window and follows local moves.
function TK_useManualOrder(scope, enabled) {
  var on = !!(enabled && scope);
  var pair = React.useState(function () {
    return { scope: scope, keys: (on && TK__manualCache[scope]) || {} };
  });
  React.useEffect(
    function () {
      if (!on) return undefined;
      var alive = true;
      var fn = function (keys) {
        if (alive) pair[1]({ scope: scope, keys: keys || {} });
      };
      (TK__manualSubs[scope] = TK__manualSubs[scope] || []).push(fn);
      if (TK__manualCache[scope]) fn(TK__manualCache[scope]);
      else TK__manualReload(scope);
      return function () {
        alive = false;
        var list = TK__manualSubs[scope] || [];
        var i = list.indexOf(fn);
        if (i >= 0) list.splice(i, 1);
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [on, scope],
  );
  if (!on) return {};
  return pair[0].scope === scope ? pair[0].keys : TK__manualCache[scope] || {};
}

// Undo of a drag or Alt+Arrow move is a Slate app feature only.
function TK__ixUndoOn() {
  try {
    return typeof TK_slateInApp === "function" && !!TK_slateInApp() && typeof TK_api !== "undefined" && !!TK_api && typeof TK_api.offerUndoRun === "function";
  } catch (e) {
    return false;
  }
}

// "Moved." with Undo: one more tk_manual_reorder puts the task back between
// its old neighbors. The section goes back only when the task still sits in
// the section it was moved to (someone may have changed it since).
function TK__manualOfferUndo(plan, back, move, c) {
  var scope = move.scope;
  var label = plan.crossGroup && c.labelOf ? c.labelOf(plan.groupKey) : "";
  TK_api.offerUndoRun(label ? "Moved to " + label + "." : "Moved.", function () {
    var setSection = false;
    var section = null;
    if (plan.crossGroup && c.sectionOf) {
      section = c.sectionOf(back.fromKey);
      var cur = typeof TK_store !== "undefined" && TK_store && TK_store.getState ? (TK_store.getState().tasks || {})[plan.id] : null;
      var now = cur ? String(cur.section || "").toLowerCase() : null;
      setSection = section !== undefined && now === String(move.section || "").toLowerCase();
      if (section === undefined) section = null;
    }
    return TK_api.manualReorder({
      scope: scope,
      id: plan.id,
      beforeId: back.beforeId,
      afterId: back.afterId,
      orderIds: back.orderIds,
      setSection: setSection,
      section: setSection ? section : null,
    }).then(function (r) {
      TK__manualSet(scope, TK_manualApply(TK__manualCache[scope], plan.id, { key: r.key, rows: r.rows }));
      if (r.skipped > 0) TK__manualReload(scope);
      return "Undone. The task is back where it was.";
    });
  });
}

// Runs a plan: optimistic move in the person's keys map (and the task store
// for a section change), tk_manual_reorder, rollback + toast on an error.
// ctx: { scope, sectionOf(groupKey) -> section name or null, say(text),
// labelOf(groupKey), undoGroups (Slate app: the groups before the move) }.
function TK_manualMove(plan, ctx) {
  var c = ctx || {};
  if (!plan || !c.scope || typeof TK_api === "undefined" || !TK_api || typeof TK_api.manualReorder !== "function") return Promise.resolve(null);
  var scope = c.scope;
  var prev = TK__manualCache[scope] || {};
  // Slate app: where the task was, so Undo (and Cmd+Z) can put it back.
  // ctx.undoGroups is the list as drawn before this move.
  var back = c.undoGroups && TK__ixUndoOn() && typeof TK_manualUndoPlan === "function" ? TK_manualUndoPlan(c.undoGroups, plan.id) : null;
  var p = TK_manualPatches(plan, prev);
  TK__manualSet(scope, TK_manualApply(prev, plan.id, p));
  var move = {
    scope: scope,
    id: plan.id,
    beforeId: plan.before ? plan.before.id : null,
    afterId: plan.after ? plan.after.id : null,
    orderIds: plan.order.map(function (t) { return t.id; }),
    setSection: !!plan.crossGroup,
    section: plan.crossGroup && c.sectionOf ? c.sectionOf(plan.groupKey) : null,
  };
  if (c.say) c.say(TK_manualAnnounce(plan, c.labelOf ? c.labelOf(plan.groupKey) : ""));
  return TK_api.manualReorder(move).then(
    function (r) {
      TK__manualSet(scope, TK_manualApply(TK__manualCache[scope], plan.id, { key: r.key, rows: r.rows }));
      // rows the server skipped keep no key there: take its copy
      if (r.skipped > 0) TK__manualReload(scope);
      try {
        if (typeof TK_vTrack === "function") TK_vTrack("tasks-reorder");
      } catch (e) {}
      if (back) TK__manualOfferUndo(plan, back, move, c);
      return r;
    },
    function (e) {
      TK__manualSet(scope, prev);
      TK__manualReload(scope);
      if (c.say) c.say("Couldn't move the task. It is back where it was.");
      if (typeof TK_vToast === "function") TK_vToast(typeof TK_vErrText === "function" ? TK_vErrText(e) : "Couldn't move the task.");
      return null;
    },
  );
}
