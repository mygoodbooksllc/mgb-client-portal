// ----------------------------------------------------------------------------
// TK_SlateIx.jsx — Slate app interactions (docs/slate-app-interactions-plan.md)
//
// Everything here runs only in the Slate app with the preview on
// (TK_slateInApp for the list helpers, TK_slateAppOn for swipe back). With
// the preview off the hooks attach nothing and render nothing, so the portal
// page is exactly as before.
//
//   TK_useSlateIx(opts)   one per list view: Cmd/Ctrl+D, C, V; Shift / Cmd
//                         click to select; the right-click (and long-press)
//                         menu; a drag box that selects rows; touch row
//                         swipes (right completes, left snoozes); the drop
//                         dock (drag a row onto a person or a date).
//   TK_SwipeBackHost      mounted once: a two-finger trackpad swipe right, or
//                         a touch swipe in from the left edge, steps back:
//                         close the menu or dialog, then the open task, then
//                         the previous page.
//
// Writes go through the existing TK_api calls (copyRun, bulkRun,
// bulkUpdate, complete), so the server's edit rules and RLS decide what
// happens and every action offers Undo. Pure rules live in TK_viewLogic.js
// (TK_ix*, TK_copySkipText).
// ----------------------------------------------------------------------------

// ---- The task clipboard (this window only) ---------------------------------
var TK__ixClip = { ids: [] };
var TK__ixClipSubs = [];
function TK__ixClipSet(ids) {
  TK__ixClip = { ids: (ids || []).map(String) };
  TK__ixClipSubs.slice().forEach(function (fn) {
    try {
      fn(TK__ixClip);
    } catch (e) {}
  });
}
function TK_useIxClip() {
  var pair = React.useState(TK__ixClip);
  React.useEffect(function () {
    var fn = function (c) {
      pair[1](c);
    };
    TK__ixClipSubs.push(fn);
    return function () {
      var i = TK__ixClipSubs.indexOf(fn);
      if (i >= 0) TK__ixClipSubs.splice(i, 1);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return pair[0];
}

function TK__ixMac() {
  try {
    return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || "");
  } catch (e) {
    return false;
  }
}
function TK__ixApiOk() {
  return typeof TK_api !== "undefined" && !!TK_api && typeof TK_api.copyRun === "function" && typeof TK_api.bulkRun === "function";
}
function TK__ixFail(e) {
  TK_vToast(TK_vErrText(e));
}
function TK__ixToday(t) {
  if (t) return t;
  if (typeof TK_vToday === "function") return TK_vToday();
  var d = new Date();
  var p2 = function (n) {
    return (n < 10 ? "0" : "") + n;
  };
  return d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate());
}
// A press on an element's own scrollbar (classic, always-shown scrollbars:
// Windows, or macOS with a mouse plugged in) lands on the element itself, past
// its client area.
function TK__ixOnScrollbar(e) {
  var el = e && e.target;
  if (!el || el.nodeType !== 1 || typeof e.offsetX !== "number") return false;
  var vbar = el.offsetWidth - el.clientWidth;
  var hbar = el.offsetHeight - el.clientHeight;
  return (vbar > 2 && e.offsetX >= el.clientWidth) || (hbar > 2 && e.offsetY >= el.clientHeight);
}
var TK__IX_INTERACTIVE = "input, textarea, select, button, a[href], label, [contenteditable='true'], [role='checkbox'], [role='menu'], [role='menuitem'], [data-tk-drag-handle]";

// ---- One action on a set of task ids ---------------------------------------
// c: { byId, isAdmin, today, pasteTarget(), bulk, me }
function TK_ixRun(action, ids, c) {
  var o = c || {};
  var list = (ids || []).map(String).filter(Boolean);
  if (!list.length || !TK__ixApiOk()) return;
  var one = list.length === 1 ? (o.byId || {})[list[0]] : null;
  var today = TK__ixToday(o.today);
  if (typeof TK_vTrack === "function") TK_vTrack("slate-ix-" + action.split(":")[0]);
  if (action === "open") return TK_vOpenTask(list[0], { from: "menu" });
  if (action === "edit") return TK_vOpenTask(list[0], { from: "menu", focus: "title" });
  if (action === "complete" || action === "reopen") {
    if (one) return TK_vComplete(one, o.isAdmin);
    return TK_api.bulkRun(action, list).catch(TK__ixFail);
  }
  if (action === "duplicate") return TK_api.copyRun(list, null).catch(TK__ixFail);
  if (action === "copy") {
    var max = TK_api.COPY_MAX || 50;
    var keep = list.slice(0, max);
    TK__ixClipSet(keep);
    // best effort: the titles on the system clipboard too, for pasting elsewhere
    try {
      var titles = keep
        .map(function (id) {
          var t = (o.byId || {})[id];
          return t && t.text ? String(t.text) : "";
        })
        .filter(Boolean)
        .join("\n");
      if (titles && navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(titles).catch(function () {});
    } catch (e) {}
    var key = TK__ixMac() ? "⌘V" : "Ctrl+V";
    TK_vToast((keep.length === 1 ? "Copied." : "Copied " + keep.length + " tasks.") + (list.length > keep.length ? " (The first " + max + ".)" : "") + " Press " + key + " in a list to paste.");
    return;
  }
  if (action === "paste") {
    var clip = TK__ixClip.ids || [];
    if (!clip.length) {
      TK_vToast("Nothing copied yet. Select tasks and press " + (TK__ixMac() ? "⌘C" : "Ctrl+C") + " first.");
      return;
    }
    var target = typeof o.pasteTarget === "function" ? o.pasteTarget() : null;
    return TK_api.copyRun(clip, target, "Pasted").catch(TK__ixFail);
  }
  if (action === "assign_me") {
    // the claim path (what anyone on the team may do), one task at a time;
    // TK_api.claim toasts success and failure itself
    if (typeof TK_api.claim !== "function") return;
    return list.slice(0, 25).reduce(function (p, id) {
      return p.then(function () {
        return TK_api.claim(id).catch(function () {});
      });
    }, Promise.resolve());
  }
  if (action.indexOf("due_") === 0) {
    var due = TK_ixDueFor(action.slice(4), today);
    if (due === undefined) return;
    return TK_api.bulkRun("set_due", list, { due_date: due }).catch(TK__ixFail);
  }
  if (action === "snooze") {
    var to = one ? TK_ixSnoozeDate(one.due_date, today) : TK_ixDueFor("tomorrow", today);
    return TK_api.bulkUpdate(list, { due_date: to }).then(function (r) {
      var n = r.done.length + (r.review ? r.review.length : 0);
      var text = n ? (list.length === 1 ? "Snoozed. " + TK_ixDueText(to, today) : "Snoozed " + n + (n === 1 ? " task. " : " tasks. ") + TK_ixDueText(to, today)) : TK__ixSkipText(r.skipped);
      TK_api.offerUndo(text, r, { ids: list });
    }, TK__ixFail);
  }
  if (action.indexOf("section:") === 0) {
    var sec = action.slice(8);
    return TK_api.bulkRun("set_section", list, { section: sec === "" ? null : sec }).catch(TK__ixFail);
  }
  if (action === "select" && o.bulk) return o.bulk.setMany(list, true);
  if (action === "deselect" && o.bulk) return o.bulk.clear();
  if (action === "delete") return TK_api.bulkRun("delete", list).catch(TK__ixFail);
}

function TK__ixSkipText(skipped) {
  var s = Array.isArray(skipped) && skipped[0] ? skipped[0] : null;
  if (s && s.reason && typeof TK_bulkReasonText === "function") return TK_bulkReasonText(s.reason);
  return "Nothing changed.";
}

// ---- The row menu ----------------------------------------------------------
function TK__ixLabel(key, n, mac) {
  var many = n > 1 ? " " + n + " tasks" : "";
  var cmd = mac ? "⌘" : "Ctrl+";
  switch (key) {
    case "open": return ["Open", "Enter"];
    case "edit": return ["Edit title", "E"];
    case "complete": return [n > 1 ? "Mark" + many + " done" : "Mark done", "X"];
    case "reopen": return ["Mark not done", "X"];
    case "duplicate": return ["Duplicate" + many, cmd + "D"];
    case "copy": return ["Copy" + many, cmd + "C"];
    case "paste": return ["Paste here", cmd + "V"];
    case "assign_me": return ["Assign to me", ""];
    case "due_today": return ["Due today", ""];
    case "due_tomorrow": return ["Due tomorrow", ""];
    case "due_next_week": return ["Due next week", ""];
    case "due_none": return ["No due date", ""];
    case "snooze": return ["Snooze a day", ""];
    case "section": return ["Move to section…", ""];
    case "select": return ["Select", "V"];
    case "deselect": return ["Clear selection", "Esc"];
    case "delete": return [n > 1 ? "Delete" + many : "Delete", ""];
    default: return [key, ""];
  }
}

// props: { x, y, items (keys), count, sections, onPick(key), onClose }
function TK_IxMenu(props) {
  var ref = React.useRef(null);
  var subPair = React.useState(false);
  var sub = subPair[0];
  var posPair = React.useState({ left: props.x, top: props.y });
  var mac = TK__ixMac();
  // give focus back to where it was when the menu closes
  React.useEffect(function () {
    var before = document.activeElement;
    return function () {
      try {
        if (before && before.focus && document.contains(before) && (!document.activeElement || document.activeElement === document.body || (ref.current && ref.current.contains(document.activeElement)))) before.focus({ preventScroll: true });
      } catch (e) {}
    };
  }, []);
  React.useLayoutEffect(
    function () {
      var el = ref.current;
      if (!el) return;
      var r = el.getBoundingClientRect();
      var left = Math.max(8, Math.min(props.x, window.innerWidth - r.width - 8));
      var top = Math.max(8, Math.min(props.y, window.innerHeight - r.height - 8));
      posPair[1]({ left: left, top: top });
      var first = el.querySelector("[role='menuitem']");
      if (first) first.focus();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sub],
  );
  React.useEffect(function () {
    var close = function (e) {
      if (e && e.target && ref.current && ref.current.contains(e.target)) return;
      props.onClose();
    };
    var closeNow = function () {
      props.onClose();
    };
    var onEsc = function (e) {
      if (e.key !== "Escape" || (ref.current && ref.current.contains(e.target))) return;
      e.preventDefault();
      e.stopPropagation();
      props.onClose();
    };
    document.addEventListener("keydown", onEsc, true);
    document.addEventListener("pointerdown", close, true);
    document.addEventListener("scroll", close, true);
    window.addEventListener("resize", closeNow);
    window.addEventListener("blur", closeNow);
    return function () {
      document.removeEventListener("keydown", onEsc, true);
      document.removeEventListener("pointerdown", close, true);
      document.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", closeNow);
      window.removeEventListener("blur", closeNow);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  var onKeyDown = function (e) {
    var items = ref.current ? Array.prototype.slice.call(ref.current.querySelectorAll("[role='menuitem']")) : [];
    var i = items.indexOf(document.activeElement);
    if (e.key === "Escape" || e.key === "Tab") {
      e.preventDefault();
      e.stopPropagation();
      if (sub && e.key === "Escape") subPair[1](false);
      else props.onClose();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      if (!items.length) return;
      var next = e.key === "ArrowDown" ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
      items[next].focus();
    } else if (e.key === "ArrowLeft" && sub) {
      e.preventDefault();
      subPair[1](false);
    }
  };
  var btn = function (key, label, hint, run, cls) {
    return (
      <button
        key={key}
        type="button"
        role="menuitem"
        className={"tk-menu-item tk-ix-item" + (cls ? " " + cls : "")}
        onClick={function (e) {
          e.stopPropagation();
          run();
        }}
      >
        <span className="tk-menu-label">{label}</span>
        {hint ? <span className="tk-ix-hint">{hint}</span> : null}
      </button>
    );
  };
  var body;
  if (sub) {
    body = [btn("back", "‹ Back", "", function () { subPair[1](false); }, "tk-ix-back")];
    (props.sections || []).forEach(function (s, i) {
      body.push(btn("s" + i, s, "", function () { props.onPick("section:" + s); }));
    });
    body.push(btn("s-none", "No section", "", function () { props.onPick("section:"); }));
  } else {
    body = props.items.map(function (k, i) {
      if (k === "-") return <div key={"d" + i} className="tk-ix-sep" role="separator" />;
      var l = TK__ixLabel(k, props.count, mac);
      if (k === "section") return btn(k, l[0], "›", function () { subPair[1](true); });
      return btn(k, l[0], l[1], function () { props.onPick(k); }, k === "delete" ? "tk-ix-danger" : "");
    });
  }
  return ReactDOM.createPortal(
    <div
      ref={ref}
      className="tk-menu tk-ix-menu"
      role="menu"
      aria-label={props.count > 1 ? props.count + " selected tasks" : "Task actions"}
      style={{ position: "fixed", left: posPair[0].left, top: posPair[0].top }}
      onKeyDown={onKeyDown}
      onContextMenu={function (e) {
        e.preventDefault();
      }}
    >
      {body}
    </div>,
    document.body,
  );
}

// ---- The drop dock (shown only while a row is being dragged) ---------------
function TK_IxDock(props) {
  var p = props.people || [];
  var dates = [
    ["due:today", "Today"],
    ["due:tomorrow", "Tomorrow"],
    ["due:next_week", "Next week"],
    ["due:none", "No date"],
  ];
  return ReactDOM.createPortal(
    <div className="tk-ix-dock" aria-hidden="true">
      <div className="tk-ix-dock-head">Drop on a date</div>
      {dates.map(function (d) {
        return (
          <div key={d[0]} className="tk-ix-drop" data-tk-drop-target={d[0]}>
            {d[1]}
          </div>
        );
      })}
      {p.length ? <div className="tk-ix-dock-head">or a person</div> : null}
      {p.map(function (x) {
        return (
          <div key={x.email} className="tk-ix-drop tk-ix-drop-who" data-tk-drop-target={"who:" + x.email}>
            {x.name}
          </div>
        );
      })}
    </div>,
    document.body,
  );
}

// opts: { enabled, rootRef, ids, byId, focusedId, setFocusedId, bulk, kind
//   ("project" | "client" | "person" | "my"), projectId, clientId, sections
//   (the project's sections, or null), today, isAdmin, readOnly, keysOn,
//   people [{ email, name }], dock (a drag is possible here), swipes (touch
//   row swipes; lists, not the board) }
// Returns { el, onDropTarget(value, id), onLongPress(id, x, y) }.
function TK_useSlateIx(opts) {
  var o = opts || {};
  var on = !!o.enabled;
  var ref = React.useRef(o);
  ref.current = o;
  var clip = TK_useIxClip();
  var menuPair = React.useState(null); // { x, y, ids }
  var menu = menuPair[0];
  var setMenu = menuPair[1];
  var staff = TK_vUseStaff(on && !!o.dock);

  // the run context, read fresh at action time
  var ctx = function () {
    var c = ref.current;
    return {
      byId: c.byId || {},
      isAdmin: c.isAdmin,
      today: c.today,
      bulk: c.bulk,
      me: TK_vMe(),
      pasteTarget: function () {
        var f = c.focusedId != null ? (c.byId || {})[c.focusedId] : null;
        return TK_ixPasteTarget({
          kind: c.kind,
          projectId: c.projectId,
          clientId: c.clientId,
          section: f ? f.section : null,
          // a client list paste lands outside projects: keep the focused
          // row's section only when that row is outside a project too
          bySection: !!f && (c.kind === "project" || (c.kind === "client" && !f.project_id)),
        });
      },
    };
  };
  // the rows an action applies to: the selection when id is part of it
  var targetsFor = function (id) {
    var b = ref.current.bulk;
    var sel = b && b.ready && b.count > 0 ? b.ids() : [];
    if (id == null) return sel.length ? sel : ref.current.focusedId != null ? [String(ref.current.focusedId)] : [];
    if (sel.length > 1 && b.has(String(id))) return sel;
    return [String(id)];
  };
  var openMenu = function (id, x, y) {
    if (ref.current.setFocusedId) ref.current.setFocusedId(id);
    setMenu({ x: x, y: y, ids: targetsFor(id) });
  };

  React.useEffect(
    function () {
      if (!on) return undefined;
      var html = document.documentElement;
      html.classList.add("tk-ix");
      var rootEl = function () {
        return ref.current.rootRef && ref.current.rootRef.current;
      };
      var rowOf = function (el) {
        var root = rootEl();
        var row = el && el.closest ? el.closest("[data-tk-id]") : null;
        return row && root && root.contains(row) ? row : null;
      };

      // Cmd/Ctrl + D / C / V
      var onKey = function (e) {
        var act = TK_ixChordAction(e);
        if (!act || e.defaultPrevented) return;
        var c = ref.current;
        if (c.keysOn === false) return;
        if (typeof TK__isTypingTarget === "function" && TK__isTypingTarget(e.target)) return;
        if (e.target && e.target.closest && e.target.closest("[data-tk-keyscope='drawer']")) return;
        var k = TK_vKeyCtx();
        if (k.modalOpen || k.menuOpen || k.tourOpen) return;
        if (act === "copy") {
          var s = window.getSelection ? String(window.getSelection() || "") : "";
          if (s) return; // copying page text: leave it to the browser
        }
        var ids = act === "paste" ? ["paste"] : targetsFor(null);
        if (!ids.length) return;
        if (c.readOnly && act !== "copy") return;
        e.preventDefault();
        TK_ixRun(act, act === "paste" ? ["paste"] : ids, ctx());
      };

      // Shift / Cmd / Ctrl click on a row body: select instead of open
      var onClick = function (e) {
        var c = ref.current;
        if (!(e.shiftKey || e.metaKey || e.ctrlKey) || e.altKey || e.button !== 0) return;
        if (!c.bulk || !c.bulk.ready) return;
        var row = rowOf(e.target);
        if (!row || (e.target.closest && e.target.closest(TK__IX_INTERACTIVE))) return;
        e.preventDefault();
        e.stopPropagation();
        c.bulk.toggle(row.getAttribute("data-tk-id"), !!e.shiftKey);
      };

      // right click on a row (Shift + right click keeps the browser's menu)
      var onCtx = function (e) {
        if (e.shiftKey || e.defaultPrevented) return;
        var row = rowOf(e.target);
        if (!row) return;
        if (e.target.closest && e.target.closest("input, textarea, [contenteditable='true']")) return;
        e.preventDefault();
        openMenu(row.getAttribute("data-tk-id"), e.clientX, e.clientY);
      };

      // ---- the drag box (mouse) ----
      var mq = null;
      var clearHits = function () {
        var hit = document.querySelectorAll(".tk-ix-hit");
        for (var i = 0; i < hit.length; i++) hit[i].classList.remove("tk-ix-hit");
      };
      var rowsNow = function () {
        var root = rootEl();
        var c = ref.current;
        var allowed = {};
        (c.ids || []).forEach(function (id) {
          allowed[String(id)] = 1;
        });
        var els = root ? root.querySelectorAll("[data-tk-id]") : [];
        var out = [];
        for (var i = 0; i < els.length; i++) {
          var id = els[i].getAttribute("data-tk-id");
          if (!allowed[id]) continue;
          var r = els[i].getBoundingClientRect();
          out.push({ id: id, el: els[i], left: r.left, top: r.top, right: r.right, bottom: r.bottom });
        }
        return out;
      };
      var mqMove = function (e) {
        if (!mq) return;
        var dx = e.clientX - mq.x0;
        var dy = e.clientY - mq.y0;
        if (!mq.active) {
          if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
          if (html.classList.contains("tk-dragging")) return mqEnd(false);
          mq.active = true;
          html.classList.add("tk-ix-marquee");
          try {
            window.getSelection().removeAllRanges();
          } catch (err) {}
          var box = document.createElement("div");
          box.className = "tk-ix-box";
          box.setAttribute("aria-hidden", "true");
          document.body.appendChild(box);
          mq.box = box;
        }
        e.preventDefault();
        var l = Math.min(mq.x0, e.clientX);
        var t = Math.min(mq.y0, e.clientY);
        mq.box.style.left = l + "px";
        mq.box.style.top = t + "px";
        mq.box.style.width = Math.abs(dx) + "px";
        mq.box.style.height = Math.abs(dy) + "px";
        var rows = rowsNow();
        var hits = TK_ixMarqueeHits({ left: mq.x0, top: mq.y0, right: e.clientX, bottom: e.clientY }, rows);
        var set = {};
        hits.forEach(function (id) {
          set[id] = 1;
        });
        rows.forEach(function (r) {
          r.el.classList.toggle("tk-ix-hit", !!set[r.id]);
        });
        mq.hits = hits;
      };
      var mqEnd = function (commit) {
        var cur = mq;
        mq = null;
        document.removeEventListener("pointermove", mqMove, true);
        document.removeEventListener("pointerup", mqUp, true);
        document.removeEventListener("pointercancel", mqCancel, true);
        if (!cur || !cur.active) return;
        html.classList.remove("tk-ix-marquee");
        if (cur.box && cur.box.parentNode) cur.box.parentNode.removeChild(cur.box);
        clearHits();
        var swallow = function (ev) {
          ev.stopPropagation();
          ev.preventDefault();
        };
        document.addEventListener("click", swallow, true);
        window.setTimeout(function () {
          document.removeEventListener("click", swallow, true);
        }, 0);
        var b = ref.current.bulk;
        if (!commit || !b || !b.ready) return;
        // a plain drag box replaces the selection; Shift / Cmd / Ctrl adds
        b.setMany(cur.hits || [], true, cur.add ? null : { replace: true });
      };
      var mqUp = function () {
        mqEnd(true);
      };
      var mqCancel = function () {
        mqEnd(false);
      };
      var onDown = function (e) {
        var c = ref.current;
        if (mq || e.button !== 0 || e.pointerType !== "mouse" || !e.isPrimary) return;
        if (!c.bulk || !c.bulk.ready) return;
        var root = rootEl();
        if (!root || !root.contains(e.target)) return;
        if (e.target.closest && e.target.closest(TK__IX_INTERACTIVE + ", .tk-bulkbar, .tk-toolbar, .tk-list-head")) return;
        if (TK__ixOnScrollbar(e)) return; // dragging a scrollbar scrolls, never draws a box
        mq = { x0: e.clientX, y0: e.clientY, active: false, add: e.shiftKey || e.metaKey || e.ctrlKey, hits: [] };
        document.addEventListener("pointermove", mqMove, true);
        document.addEventListener("pointerup", mqUp, true);
        document.addEventListener("pointercancel", mqCancel, true);
      };

      // ---- touch: row swipes and a long press for the menu ----
      var sw = null;
      var swReset = function (row) {
        if (!row) return;
        row.classList.remove("is-swiping", "is-swipe-done", "is-swipe-snooze", "is-swipe-armed");
        row.style.transform = "";
      };
      var onTouchStart = function (e) {
        var c = ref.current;
        if (sw || !e.touches || e.touches.length !== 1) return;
        var t0 = e.touches[0];
        if (TK_ixAtEdge(t0.clientX, window.innerWidth)) return; // swipe back
        var row = rowOf(e.target);
        if (!row) return;
        if (e.target.closest && e.target.closest("input, textarea, select, [contenteditable='true']")) return;
        var inGroup = row.parentElement && row.parentElement.closest("[data-tk-group]");
        sw = { row: row, id: row.getAttribute("data-tk-id"), x0: t0.clientX, y0: t0.clientY, x: t0.clientX, y: t0.clientY, axis: null, tid: t0.identifier };
        var swipeOk = !!c.swipes && !c.readOnly && row.classList.contains("tk-row") && !row.classList.contains("tk-subrow");
        sw.swipeOk = swipeOk;
        // rows the drag can pick up get their menu from the drag's long press
        if (!inGroup || !c.dock || c.readOnly) {
          var mine = sw;
          sw.hold = window.setTimeout(function () {
            if (sw !== mine || mine.axis) return;
            mine.held = true;
            try {
              if (navigator.vibrate) navigator.vibrate(12);
            } catch (err) {}
            openMenu(mine.id, mine.x, mine.y);
          }, 500);
        }
      };
      var touchOf = function (e) {
        var l = e.changedTouches || [];
        for (var i = 0; i < l.length; i++) if (sw && l[i].identifier === sw.tid) return l[i];
        return null;
      };
      var onTouchMove = function (e) {
        var t = touchOf(e);
        if (!t) return;
        if (sw.held) {
          // the long press opened the menu: the finger moving is not a swipe
          if (e.cancelable) e.preventDefault();
          return;
        }
        sw.x = t.clientX;
        sw.y = t.clientY;
        var dx = sw.x - sw.x0;
        var dy = sw.y - sw.y0;
        if (html.classList.contains("tk-dragging")) {
          if (sw.hold) window.clearTimeout(sw.hold);
          swReset(sw.row);
          sw = null;
          return;
        }
        if (!sw.axis) {
          sw.axis = TK_ixSwipeAxis(dx, dy);
          if (!sw.axis) return;
          if (sw.hold) window.clearTimeout(sw.hold);
          if (sw.axis !== "x" || !sw.swipeOk) {
            sw = null;
            return;
          }
          sw.width = sw.row.getBoundingClientRect().width;
          sw.row.classList.add("is-swiping");
        }
        if (e.cancelable) e.preventDefault();
        var shown = Math.max(-sw.width * 0.6, Math.min(sw.width * 0.6, dx));
        sw.row.style.transform = "translateX(" + Math.round(shown) + "px)";
        sw.row.classList.toggle("is-swipe-done", dx > 0);
        sw.row.classList.toggle("is-swipe-snooze", dx < 0);
        sw.row.classList.toggle("is-swipe-armed", !!TK_ixSwipeAction(dx, sw.width));
      };
      var onTouchEnd = function (e) {
        var t = touchOf(e);
        if (!t) return;
        var cur = sw;
        sw = null;
        if (cur.hold) window.clearTimeout(cur.hold);
        if (cur.held) {
          // the long press opened the menu: not a tap on the row
          swReset(cur.row);
          if (e.cancelable) e.preventDefault();
          return;
        }
        if (cur.axis !== "x") return;
        var act = TK_ixSwipeAction(cur.x - cur.x0, cur.width);
        swReset(cur.row);
        var swallow = function (ev) {
          ev.stopPropagation();
          ev.preventDefault();
        };
        document.addEventListener("click", swallow, true);
        window.setTimeout(function () {
          document.removeEventListener("click", swallow, true);
        }, 450);
        if (!act) return;
        var task = (ref.current.byId || {})[cur.id];
        if (act === "complete") {
          if (task) TK_ixRun(task.status === "done" || task.done ? "reopen" : "complete", [cur.id], ctx());
        } else TK_ixRun("snooze", [cur.id], ctx());
      };
      var onTouchCancel = function () {
        if (!sw) return;
        if (sw.hold) window.clearTimeout(sw.hold);
        swReset(sw.row);
        sw = null;
      };

      document.addEventListener("keydown", onKey);
      document.addEventListener("click", onClick, true);
      document.addEventListener("contextmenu", onCtx);
      document.addEventListener("pointerdown", onDown);
      document.addEventListener("touchstart", onTouchStart, { passive: true });
      document.addEventListener("touchmove", onTouchMove, { passive: false });
      document.addEventListener("touchend", onTouchEnd, true);
      document.addEventListener("touchcancel", onTouchCancel, true);
      return function () {
        html.classList.remove("tk-ix");
        document.removeEventListener("keydown", onKey);
        document.removeEventListener("click", onClick, true);
        document.removeEventListener("contextmenu", onCtx);
        document.removeEventListener("pointerdown", onDown);
        document.removeEventListener("touchstart", onTouchStart, { passive: true });
        document.removeEventListener("touchmove", onTouchMove, { passive: false });
        document.removeEventListener("touchend", onTouchEnd, true);
        document.removeEventListener("touchcancel", onTouchCancel, true);
        mqEnd(false);
        onTouchCancel();
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [on],
  );

  // a drop on the dock: a date or a person, for the dragged row (or the
  // whole selection when the dragged row is part of it)
  var onDropTarget = function (value, id) {
    var ids = targetsFor(id);
    var v = String(value || "");
    if (v.indexOf("due:") === 0) TK_ixRun("due_" + v.slice(4), ids, ctx());
    else if (v.indexOf("who:") === 0) {
      var who = v.slice(4);
      if (TK__ixApiOk()) TK_api.bulkRun("reassign", ids, { assignee_email: who }).catch(TK__ixFail);
    }
  };

  var el = null;
  if (on) {
    var parts = [];
    if (menu) {
      var c = ref.current;
      var n = menu.ids.length;
      var t = n === 1 ? (c.byId || {})[menu.ids[0]] : null;
      var me = TK_vMe();
      var canEdit = t ? (typeof TK_rwAccess === "function" ? TK_rwAccess(t, { me: me, isAdmin: !!c.isAdmin, canEdit: !c.readOnly }).edit : !c.readOnly) : !c.readOnly;
      var items = TK_ixMenuItems({
        readOnly: !!c.readOnly,
        canEdit: canEdit,
        done: !!(t && (t.status === "done" || t.done)),
        count: n,
        clip: (clip.ids || []).length,
        sections: c.kind === "project" && Array.isArray(c.sections) ? c.sections : null,
        canClaim: n === 1 ? !!(t && TK_vCanClaim(t)) : true,
      });
      if (!(c.bulk && c.bulk.ready)) {
        items = items.filter(function (k) {
          return k !== "select" && k !== "deselect";
        });
      }
      parts.push(
        <TK_IxMenu
          key="menu"
          x={menu.x}
          y={menu.y}
          items={items}
          count={n}
          sections={(c.sections || []).filter(function (s) {
            return s != null && String(s).trim();
          })}
          onClose={function () {
            setMenu(null);
          }}
          onPick={function (k) {
            var ids = menu.ids;
            setMenu(null);
            TK_ixRun(k, k === "paste" ? ["paste"] : ids, ctx());
          }}
        />,
      );
    }
    if (o.dock && !o.readOnly) parts.push(<TK_IxDock key="dock" people={TK_ixDockPeople(TK_vMe(), o.people, staff)} />);
    el = parts.length ? <React.Fragment>{parts}</React.Fragment> : null;
  }
  return { el: el, onDropTarget: on ? onDropTarget : undefined, onLongPress: on ? openMenu : undefined };
}

// ---- Swipe back (Slate app and the portal, preview on) ---------------------
function TK__ixCanScrollLeft(el) {
  var n = el;
  while (n && n !== document.body && n !== document.documentElement) {
    try {
      if (n.scrollWidth > n.clientWidth + 1 && n.scrollLeft > 0) {
        var st = window.getComputedStyle(n);
        if (/(auto|scroll)/.test(st.overflowX)) return true;
      }
    } catch (e) {}
    n = n.parentElement;
  }
  return false;
}
function TK__ixTopLayer() {
  // the sidebar's hover flyout is not a layer: it closes when the pointer leaves
  var sel = "[role='menu']:not(.hn-fly), .modal-overlay, .tk-cd-layer, [role='dialog'][aria-modal='true']";
  var all;
  try {
    all = document.querySelectorAll(sel);
  } catch (e) {
    return null;
  }
  for (var i = all.length - 1; i >= 0; i--) {
    var el = all[i];
    // the task drawer itself is the next step (a menu inside it is a layer)
    if (el.getAttribute("role") !== "menu" && el.closest && el.closest(".tk-dw-layer, .tk-dw")) continue;
    if (el.offsetParent !== null || el.getClientRects().length) return el;
  }
  return null;
}
function TK__ixSafari() {
  return /^((?!chrome|android|crios|fxios|edg).)*safari/i.test(navigator.userAgent || "");
}
function TK__ixBack() {
  var layer = TK__ixTopLayer();
  var st = typeof TK_store !== "undefined" && TK_store && TK_store.getState ? TK_store.getState() : null;
  var task = !!(st && st.drawerId);
  // Safari runs its own back swipe on the page history; never step it twice.
  var safari = TK__ixSafari();
  var step = TK_ixBackStep({ layer: !!layer, task: task, history: !safari && window.history.length > 1 });
  if (step === "layer") {
    var target = layer.querySelector("[role='menuitem'], button, [tabindex]") || layer;
    var ev = new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true, cancelable: true });
    (layer.contains(document.activeElement) ? document.activeElement : target).dispatchEvent(ev);
  } else if (step === "task") {
    // Esc on the drawer runs its own close (it checks unsaved edits first)
    var panel = document.querySelector(".tk-dw");
    if (panel) panel.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true, cancelable: true }));
    else TK_store.dispatch({ type: "drawer", id: null });
  } else if (step === "history") {
    window.history.back();
  }
  if (step && typeof TK_vTrack === "function") TK_vTrack("slate-swipe-back");
}

function TK_SwipeBackHost() {
  var on = typeof TK_useSlateAppOn === "function" ? !!TK_useSlateAppOn() : false;
  React.useEffect(
    function () {
      if (!on) return undefined;
      var html = document.documentElement;
      html.classList.add("tk-swipe-back");
      // Safari runs its own two-finger back swipe on the page: leave the
      // trackpad to it there (the touch edge swipe below still works).
      var safari = TK__ixSafari();
      // a gesture starts after 300ms of quiet; one that starts where the
      // page (or a panel under the pointer) can still scroll left never fires
      var sum = { x: 0, y: 0, t: 0, fired: false, dead: false };
      var onWheel = function (e) {
        if (safari || e.ctrlKey || e.deltaMode !== 0) return; // pinch zoom, or a mouse wheel
        var now = Date.now();
        if (now - sum.t > 300) sum = { x: 0, y: 0, t: now, fired: false, dead: false };
        sum.t = now;
        if (sum.fired || sum.dead) return;
        if (TK__ixCanScrollLeft(e.target) || html.classList.contains("tk-dragging") || html.classList.contains("tk-ix-marquee")) {
          sum.dead = true;
          return;
        }
        sum.x += e.deltaX;
        sum.y += e.deltaY;
        if (!TK_ixWheelBack(sum.x, sum.y)) return;
        sum.fired = true;
        TK__ixBack();
      };
      var tw = null;
      var onTs = function (e) {
        if (!e.touches || e.touches.length !== 1) return;
        var t = e.touches[0];
        tw = t.clientX <= (typeof TK_IX_EDGE === "number" ? TK_IX_EDGE : 24) ? { x0: t.clientX, y0: t.clientY, id: t.identifier } : null;
      };
      var onTe = function (e) {
        if (!tw) return;
        var l = e.changedTouches || [];
        for (var i = 0; i < l.length; i++) {
          if (l[i].identifier !== tw.id) continue;
          var dx = l[i].clientX - tw.x0;
          var dy = l[i].clientY - tw.y0;
          tw = null;
          if (dx > 80 && Math.abs(dx) > Math.abs(dy) * 1.5 && !html.classList.contains("tk-dragging")) TK__ixBack();
          return;
        }
      };
      window.addEventListener("wheel", onWheel, { passive: true });
      document.addEventListener("touchstart", onTs, { passive: true });
      document.addEventListener("touchend", onTe, true);
      return function () {
        html.classList.remove("tk-swipe-back");
        window.removeEventListener("wheel", onWheel, { passive: true });
        document.removeEventListener("touchstart", onTs, { passive: true });
        document.removeEventListener("touchend", onTe, true);
      };
    },
    [on],
  );
  return null;
}
