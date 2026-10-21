// ----------------------------------------------------------------------------
// TK_SlateSliver.jsx — the Slate app's sliver: the current task with Start and
// Done (spec-desk-fullpage 3.4, S4).
//
// TK_SlateSliver({ shape, staffUser, clients, isAdmin })
//   Rendered by TK_SlateSliverSlot (TK_SlateModes.jsx) inside
//   .tk-sliver-slot#tk-sliver-slot, which only exists in the Slate app
//   (TK_slateInApp) in sliver mode. Nothing here runs on the portal page, in
//   the app-off shell or in the other modes.
//
//   The task: TK_slateSliverPick (TK_slateCurrent, minus the task just marked
//   Done while its Undo is up) over every task in the store plus my own list
//   (loaded once under the list key "slate-sliver").
//   strip   one line: dot | title | client · due | +N | Start | Done | Expand.
//           Works from 18px of height; TK_slateSliverFit drops due, client and
//           +N as the height and width shrink (measured with a ResizeObserver;
//           @container slate is width only). The bar hides in a strip.
//   column  the same items stacked; the title takes up to 3 lines.
//   Start   TK_vSetStatus(task, "in_progress"), only on a todo task.
//   Done    TK_vComplete(task, isAdmin): the one completion path, so the review
//           gate, recurring tasks and the report picker all apply. Its toast
//           ("Done." / "Sent for review..." with Undo, from TK_api.offerUndo)
//           shows inside the sliver for 5 s, then the next task comes in.
//   Toasts  while the sliver is up, every mgb:toast shows inside it and its
//           live region (the page's toast stack is hidden in a sliver: it
//           would cover the strip).
//   Expand  the List size preset (TK_useSlatePresets, S3). Where presets are
//           not allowed (a normal tab, or a miss this session) it says "Drag
//           the window bigger". Clicking the title does the same.
//   Keys    s Start, x Done, Enter expand: only while focus is in the slot (or
//           nowhere), never while typing or with a dialog or menu open.
//   Offline Start and Done are disabled, with a title saying why.
//   Usage   slate-sliver-start, slate-sliver-done (window.MGB_track).
// Pure rules: TK_viewLogic.js (TK_slateSliverFit, TK_slateSliverPick,
// TK_slateSliverRest, TK_slateSliverKey). Loads after TK_SlateModes.jsx.
// ----------------------------------------------------------------------------

var TK_SLIVER_UNDO_MS = 5000; // the sliver's Undo window after Done
var TK_SLIVER_MSG_MS = 4000; // other messages (errors, "Undone.")
var TK_SLIVER_OFFLINE = "You're offline. Start and Done come back when you reconnect.";
var TK_SLIVER_DRAG = "Drag the window bigger to see your list.";

function TK__slvTasksSel(s) {
  return s ? s.tasks : null;
}

function TK__slvTrack(name, shape) {
  if (typeof TK__slTrack === "function") TK__slTrack(name, { shape: shape || null });
  else if (typeof TK_vTrack === "function") TK_vTrack(name);
}

function TK__slvSentText() {
  var t = typeof TK_vCopy === "function" ? TK_vCopy("sentForReview", "") : "";
  return t || "Sent for review. An admin will approve it.";
}

function TK__slvFocus(el) {
  if (!el) return;
  try {
    el.focus({ preventScroll: true });
  } catch (e) {}
}

function TK_SlateSliver(props) {
  var p = props || {};
  var shape = p.shape === "column" ? "column" : "strip";
  var staffUser = p.staffUser || {};
  var isAdmin = !!p.isAdmin;
  var storeMe = TK_vUseStore(function (s) {
    return s && s.me ? String(s.me) : "";
  });
  var me = TK_vLower(staffUser.email || storeMe);
  var today = TK_vToday();
  var online = TK_vUseOnline();
  var presets = typeof TK_useSlatePresets === "function" ? TK_useSlatePresets() : { ok: false, apply: function () {} };

  // My tasks (once, while the sliver is up), plus whatever the store holds.
  var loader = function () {
    if (typeof TK_api === "undefined" || !TK_api || typeof TK_api.listMine !== "function") return Promise.resolve([]);
    return TK_api.listMine(me, { showOlder: false });
  };
  var list = TK_vUseList(me ? "slate-sliver" : null, loader);
  var map = TK_vUseStore(TK__slvTasksSel);
  var listTasks = list && Array.isArray(list.tasks) ? list.tasks : [];
  var all = React.useMemo(
    function () {
      var out = [];
      var seen = {};
      if (map && typeof map === "object") {
        Object.keys(map).forEach(function (k) {
          var t = map[k];
          if (t && t.id != null && !seen[String(t.id)]) {
            seen[String(t.id)] = 1;
            out.push(t);
          }
        });
      }
      listTasks.forEach(function (t) {
        if (t && t.id != null && !seen[String(t.id)]) {
          seen[String(t.id)] = 1;
          out.push(t);
        }
      });
      return out;
    },
    [map, listTasks],
  );

  var phPair = React.useState(null); // null | { kind: "saving" | "done", task, text, undo, key }
  var phase = phPair[0];
  var setPhase = phPair[1];
  var msgPair = React.useState(null); // { text, action, key } shown for a few seconds
  var msg = msgPair[0];
  var setMsg = msgPair[1];
  var livePair = React.useState("");
  var live = livePair[0];
  var setLive = livePair[1];
  var busyPair = React.useState(false); // Start running
  var busy = busyPair[0];
  var setBusy = busyPair[1];
  var dimPair = React.useState({ w: 0, h: 0 });
  var dim = dimPair[0];
  var setDim = dimPair[1];

  var rootRef = React.useRef(null);
  var phaseRef = React.useRef(null);
  phaseRef.current = phase;
  var capRef = React.useRef(null); // the last toast seen
  var phaseT = React.useRef(null);
  var msgT = React.useRef(null);
  var alive = React.useRef(true);
  var wantFocus = React.useRef(false);

  var skip = phase && phase.task ? phase.task.id : null;
  var task = TK_slateSliverPick(all, me, today, skip);
  var rest = TK_slateSliverRest(all, me, today, task ? task.id : null, skip);
  var fit = TK_slateSliverFit(shape, dim.w, dim.h);
  var status = task ? TK_vStatusOf(task) : null;
  var title = task ? String(task.text || "Untitled task") : "";
  var clientNames = React.useMemo(
    function () {
      return typeof TK_vNameMap === "function" ? TK_vNameMap(p.clients, "id", "name") : {};
    },
    [p.clients],
  );
  var clientName = task && task.client_id != null ? clientNames[String(task.client_id)] || "" : "";

  var say = function (text) {
    // Re-announce the same words too (a second "Done." after another task).
    setLive("");
    setTimeout(function () {
      if (alive.current) setLive(String(text || ""));
    }, 30);
  };

  var showMsg = function (m, ms) {
    if (!m || !m.text) return;
    if (msgT.current) clearTimeout(msgT.current);
    setMsg(m);
    say(m.text);
    msgT.current = setTimeout(function () {
      msgT.current = null;
      if (alive.current) setMsg(null);
    }, ms || TK_SLIVER_MSG_MS);
  };

  var endPhase = function () {
    if (phaseT.current) clearTimeout(phaseT.current);
    phaseT.current = null;
    wantFocus.current = true;
    setPhase(null);
  };

  React.useEffect(function () {
    alive.current = true;
    return function () {
      alive.current = false;
      if (phaseT.current) clearTimeout(phaseT.current);
      if (msgT.current) clearTimeout(msgT.current);
    };
  }, []);

  // Toasts show here while the sliver is up (the page's stack is hidden).
  var handlers = React.useRef({});
  handlers.current.toast = function (cap) {
    if (phaseRef.current && phaseRef.current.kind === "saving") return; // Done's own result, read below
    showMsg(cap, cap.action ? TK_SLIVER_UNDO_MS : TK_SLIVER_MSG_MS);
  };
  handlers.current.dismiss = function (key) {
    var ph = phaseRef.current;
    if (ph && ph.kind === "done" && ph.key && ph.key === key) {
      endPhase(); // undone some other way (Ctrl/Cmd+Z): the Undo here is gone too
      return;
    }
    setMsg(function (m) {
      return m && m.key === key ? Object.assign({}, m, { action: null }) : m;
    });
  };
  React.useEffect(function () {
    var onToast = function (e) {
      var d = e && e.detail;
      if (!d || !d.text) return;
      var cap = {
        text: String(d.text),
        action: d.action && typeof d.action.onClick === "function" ? d.action : null,
        key: d.key || null,
        at: Date.now(),
      };
      capRef.current = cap;
      handlers.current.toast(cap);
    };
    var onDismiss = function (e) {
      var key = e && e.detail && e.detail.key;
      if (key) handlers.current.dismiss(key);
    };
    window.addEventListener("mgb:toast", onToast);
    window.addEventListener("mgb:toast-dismiss", onDismiss);
    return function () {
      window.removeEventListener("mgb:toast", onToast);
      window.removeEventListener("mgb:toast-dismiss", onDismiss);
    };
  }, []);

  // How much room the slot has: its width, and the window's height below its top.
  React.useEffect(function () {
    var el = rootRef.current;
    if (!el) return undefined;
    var slot = (el.closest && el.closest(".tk-sliver-slot")) || el;
    var raf = 0;
    var run = function () {
      raf = 0;
      var r = null;
      try {
        r = slot.getBoundingClientRect();
      } catch (e) {
        r = null;
      }
      if (!r) return;
      var w = Math.max(0, Math.round(r.width));
      var h = Math.max(0, Math.round((window.innerHeight || 0) - Math.max(0, r.top)));
      setDim(function (d) {
        return d.w === w && d.h === h ? d : { w: w, h: h };
      });
    };
    var schedule = function () {
      if (raf) return;
      try {
        raf = window.requestAnimationFrame(run);
      } catch (e) {
        run();
      }
    };
    var ro = null;
    try {
      if (typeof ResizeObserver === "function") {
        ro = new ResizeObserver(schedule);
        ro.observe(slot);
      }
    } catch (e) {
      ro = null;
    }
    window.addEventListener("resize", schedule);
    schedule();
    return function () {
      if (raf) {
        try {
          window.cancelAnimationFrame(raf);
        } catch (e) {}
      }
      if (ro) ro.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, []);

  var canAct = online && !phase && !!task;

  var doStart = function () {
    if (!canAct || busy || status !== "todo") return;
    var t = task;
    var name = title;
    TK__slvTrack("slate-sliver-start", shape);
    setBusy(true);
    Promise.resolve(TK_vSetStatus(t, "in_progress", null, isAdmin)).then(function (r) {
      if (!alive.current) return;
      setBusy(false);
      wantFocus.current = true;
      if (r) say("Started: " + name);
    });
  };

  var doDone = function () {
    if (!canAct) return;
    var t = task;
    var from = status;
    var since = Date.now();
    TK__slvTrack("slate-sliver-done", shape);
    if (msgT.current) clearTimeout(msgT.current);
    setMsg(null);
    setPhase({ kind: "saving", task: t, text: "Saving…", undo: null, key: null });
    wantFocus.current = true;
    Promise.resolve(TK_vComplete(t, isAdmin)).then(function (r) {
      if (!alive.current) return;
      var cap = capRef.current && capRef.current.at >= since ? capRef.current : null;
      var landed = !!(r && r.status && r.status !== from && !r.reportPick);
      if (!landed) {
        // Failed, already in review, or the report picker: the task stays.
        endPhase();
        if (cap) showMsg(cap);
        return;
      }
      var text = cap ? cap.text : r.sentForReview ? TK__slvSentText() : "Done.";
      wantFocus.current = true;
      setPhase({ kind: "done", task: t, text: text, undo: cap ? cap.action : null, key: cap ? cap.key : null });
      say(text);
      if (phaseT.current) clearTimeout(phaseT.current);
      phaseT.current = setTimeout(function () {
        phaseT.current = null;
        if (alive.current) endPhase();
      }, TK_SLIVER_UNDO_MS);
    });
  };

  var doUndo = function () {
    var ph = phaseRef.current;
    if (!ph || !ph.undo) return;
    var act = ph.undo;
    endPhase();
    try {
      act.onClick();
    } catch (e) {}
  };

  var doExpand = function () {
    if (presets && presets.ok && typeof presets.apply === "function") {
      presets.apply("list");
      return;
    }
    showMsg({ text: TK_SLIVER_DRAG, action: null, key: null });
  };

  var doAdd = function () {
    try {
      window.dispatchEvent(new CustomEvent("tk:quick-add", { detail: {} }));
    } catch (e) {}
  };

  // s / x / Enter while focus is in the slot (or nowhere).
  handlers.current.key = function (k) {
    if (k === "start") {
      if (!canAct || busy || status !== "todo") return false;
      doStart();
      return true;
    }
    if (k === "done") {
      if (!canAct) return false;
      doDone();
      return true;
    }
    if (k === "expand") {
      doExpand();
      return true;
    }
    return false;
  };
  React.useEffect(function () {
    var onKey = function (e) {
      if (!e || e.defaultPrevented) return;
      var k = typeof TK_slateSliverKey === "function" ? TK_slateSliverKey(e) : null;
      if (!k) return;
      var root = rootRef.current;
      var slot = root && root.closest ? root.closest(".tk-sliver-slot") : root;
      if (!slot) return;
      var tgt = e.target;
      var onBody = !tgt || tgt === document.body || tgt === document.documentElement;
      if (!onBody && !(tgt.nodeType === 1 && slot.contains(tgt))) return;
      if (typeof TK__isTypingTarget === "function" && TK__isTypingTarget(tgt)) return;
      var ctx = typeof TK_vKeyCtx === "function" ? TK_vKeyCtx() : {};
      if (ctx.modalOpen || ctx.menuOpen || ctx.tourOpen) return;
      // Enter on a button is that button's own click.
      if (k === "expand" && tgt && tgt.tagName === "BUTTON") return;
      if (handlers.current.key(k)) e.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return function () {
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  // Focus stays in the slot after an action: Undo while it is up, else Done,
  // else the slot. Only when focus was in the slot or fell to <body>.
  React.useEffect(function () {
    if (!wantFocus.current) return;
    if (phase && phase.kind === "saving") return; // wait for Done's result
    wantFocus.current = false;
    var root = rootRef.current;
    var slot = root && root.closest ? root.closest(".tk-sliver-slot") : null;
    if (!root || !slot) return;
    var a = null;
    try {
      a = document.activeElement;
    } catch (e) {}
    var lost = !a || a === document.body || a === document.documentElement;
    var inSlot = !!(a && slot.contains(a));
    if (!lost && !inSlot) return; // the person moved on (the bar, a dialog)
    var onCtl = inSlot && a !== slot && !a.disabled && a.getClientRects && a.getClientRects().length > 0;
    if (onCtl && !(phase && phase.kind === "done")) return; // already on a control
    var to = root.querySelector("[data-sl-focus]");
    TK__slvFocus(to && !to.disabled ? to : slot);
  });

  var offTitle = online ? undefined : TK_SLIVER_OFFLINE;
  var expandLabel = presets && presets.ok ? "Expand to the list (Enter)" : TK_SLIVER_DRAG;
  var cls = "tk-sl tk-sl-" + shape + " tk-sl-" + fit.size + (fit.lines === 2 ? " tk-sl-lines2" : "");

  var expandBtn = (
    <button type="button" className="btn-secondary tk-sl-btn tk-sl-expand" aria-label={expandLabel} title={expandLabel} onClick={doExpand}>
      <TK_vIcon name="list" size={fit.size === "xs" ? 12 : 16} />
      {shape === "column" ? <span>List</span> : null}
    </button>
  );

  var body;
  if (phase) {
    var was = phase.task ? String(phase.task.text || "") : "";
    body = (
      <React.Fragment>
        <span className="tk-dot tk-st-done" aria-hidden="true" />
        <span className="tk-sl-main" key={"p-" + phase.kind}>
          <span className="tk-sl-note">{phase.text}</span>
          {was && fit.due ? <span className="tk-sl-was">{was}</span> : null}
        </span>
        <span className="tk-sl-acts">
          {phase.kind === "done" && phase.undo ? (
            <button type="button" className="btn-primary tk-sl-btn is-primary" data-sl-focus="1" aria-label={"Undo: " + (was || "the last task")} onClick={doUndo}>
              Undo
            </button>
          ) : null}
          {expandBtn}
        </span>
      </React.Fragment>
    );
  } else if (!task) {
    var loading = !!(list && list.loading);
    body = (
      <React.Fragment>
        <span className="tk-sl-main">
          {msg && !fit.due && shape === "strip" ? (
            <span className="tk-sl-note">{msg.text}</span>
          ) : (
            <span className="tk-sl-title tk-sl-empty">{loading ? "Loading your tasks…" : "Clean slate"}</span>
          )}
          {msg && (fit.due || shape === "column") ? <span className="tk-sl-note">{msg.text}</span> : null}
        </span>
        <span className="tk-sl-acts">
          {loading ? null : (
            <button type="button" className="btn-secondary tk-sl-btn" data-sl-focus="1" aria-label="Add a task" onClick={doAdd}>
              <TK_vIcon name="plus" size={fit.size === "xs" ? 12 : 14} />
              <span>Add</span>
            </button>
          )}
          {expandBtn}
        </span>
      </React.Fragment>
    );
  } else {
    var metaBits = [];
    if (fit.client && clientName) metaBits.push(<span key="c" className="tk-sl-client">{clientName}</span>);
    if (fit.due && task.due_date && typeof TK_DuePill === "function") metaBits.push(<TK_DuePill key="d" task={task} today={today} />);
    var metaRow = metaBits.length ? (
      <span className="tk-sl-meta">
        {metaBits.length === 2 ? [metaBits[0], <span key="s" className="tk-sl-sep" aria-hidden="true">·</span>, metaBits[1]] : metaBits}
      </span>
    ) : null;
    var noteInTitle = !!msg && shape === "strip" && !fit.due;
    body = (
      <React.Fragment>
        <span className={"tk-dot tk-st-" + status} aria-hidden="true" />
        <span className="tk-sl-main" key={"t-" + String(task.id)}>
          {noteInTitle ? (
            <span className="tk-sl-note">{msg.text}</span>
          ) : (
            <button type="button" className="tk-sl-title" tabIndex={-1} title={title} onClick={doExpand}>
              {title}
            </button>
          )}
          {msg && !noteInTitle ? <span className="tk-sl-note">{msg.text}</span> : null}
          {!msg || shape === "column" ? metaRow : null}
        </span>
        {fit.rest && rest > 0 ? (
          <span className="tk-sl-rest" title={rest + " more due today or late"}>
            <span aria-hidden="true">{"+" + rest}</span>
            <span className="tk-sr">{rest + " more due today or late"}</span>
          </span>
        ) : null}
        <span className="tk-sl-acts">
          {msg && msg.action ? (
            <button
              type="button"
              className="btn-secondary tk-sl-btn"
              onClick={function () {
                var act = msg.action;
                setMsg(null);
                try {
                  act.onClick();
                } catch (e) {}
              }}
            >
              {msg.action.label || "Undo"}
            </button>
          ) : null}
          {status === "todo" ? (
            <button
              type="button"
              className="btn-secondary tk-sl-btn"
              aria-label={"Start: " + title}
              title={offTitle || "Start (s)"}
              disabled={!online || busy}
              aria-disabled={!online || busy ? "true" : undefined}
              onClick={doStart}
            >
              Start
            </button>
          ) : null}
          <button
            type="button"
            className="btn-primary tk-sl-btn is-primary"
            data-sl-focus="1"
            aria-label={"Done: " + title}
            title={offTitle || (task.review_required ? "Done, sends it for review (x)" : "Done (x)")}
            disabled={!online}
            onClick={doDone}
          >
            <TK_vIcon name="check" size={fit.size === "xs" ? 12 : 14} />
            <span>Done</span>
          </button>
          {expandBtn}
        </span>
      </React.Fragment>
    );
  }

  return (
    <div className={cls} ref={rootRef} data-sl-online={online ? "1" : "0"}>
      <p className="tk-sr" role="status" aria-live="polite" aria-atomic="true">
        {live}
      </p>
      {body}
      {shape === "column" && !online ? <p className="tk-sl-hint">Offline</p> : null}
      {shape === "column" && !(presets && presets.ok) ? <p className="tk-sl-hint">Drag the window bigger to see your list.</p> : null}
    </div>
  );
}
