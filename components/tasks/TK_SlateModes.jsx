// ----------------------------------------------------------------------------
// TK_SlateModes.jsx — the Slate app's size modes, detail pane and size presets
// (spec-desk-fullpage 3.3 and 3.5, S3).
//
// Everything here runs only inside the Slate app (TK_slateInApp: /slate, the
// Tasks shell, the app on). On the portal page and with the app off every hook
// returns the old answer (no mode, "drawer", width <= 760 ...) and nothing
// observes, listens or adds a class, so TK_shellLayout keeps working as it
// always has.
//
// ---- CSS CONTRACT (P1, P2 and S4 build on it) --------------------------------
//   .tk-app.is-shell.tk-m-<mode>     mode: sliver | compact | regular | full,
//                                    exactly one, set in the same frame as the
//                                    measure (TK_slateMode with hysteresis).
//   .tk-app.is-shell.tk-shape-<s>    sliver only: strip (h < 200) | column.
//   container  slate / inline-size   on .tk-app.is-shell inside the app, so
//                                    @container slate (...) works below it.
//   html.tk-slate-m-<mode>           the same mode on <html>, for layers that
//   html.tk-slate-wide               portal to <body> (drawer, quick add,
//                                    sheets) and for the @media guards:
//                                    tk-slate-wide = regular or full.
//   .tk-sliver-slot#tk-sliver-slot   the sliver's region (S4 fills it); the
//                                    list stays mounted, hidden.
//   .tk-slate-pane                   full only: the detail pane column;
//   .tk-slate-pane-slot              the drawer host portals the open task
//                                    into it (TK_DrawerHost, one owner).
//   Inside the app, style ONLY off tk-m-* or @container slate. Old @media
//   (max-width: 760px / 720px) rules in tk-views.css, tk-drawer.css,
//   tk-requests.css and styles.css are guarded with
//   :where(html:not(.tk-slate-wide)), so they still fire in compact (whose
//   range sits inside them) and on the portal, and never in regular or full.
//   Any NEW width @media rule that can match inside the shell needs the same
//   guard.
//
// ---- API ----------------------------------------------------------------------
//   TK_slateModeNow()                {mode, shape} | null (null: not the app)
//   TK_useSlateMode()                the same, live (hook)
//   TK_useSlateModeObserver(on)      ResizeObserver + rAF on .tk-app.is-shell;
//                                    returns a callback ref for that element
//   TK_useSlateTaskHost()            "pane" | "drawer" | "none" (TK_slateTaskHost)
//   TK_useListKeysOn(drawerId)       list keys stay on while the pane holds the task
//   TK_useSlateWide()                Templates, Manage, Sections, bulk editable
//   TK_useSlatePhone(width)          phone-style UI (compact) | width <= 760
//   TK_slatePhoneNow()               the same, not a hook (null: not the app)
//   TK_slateSetPaneEl / TK_useSlatePaneEl  the pane slot element
//   TK_SlatePane                     the full-mode pane column (TK_App)
//   TK_SlatePaneTask                 the embedded task (TK_DrawerHost portals it)
//   TK_useSlatePresets()             { ok, apply(id) } size presets
//   TK_SlateWiderNote / TK_SlateReadOnly   compact's read-only note and wrapper
//   TK_slateTakeSearch / TK_slateOnSearch  the bar's search box -> TK_SearchView
//
// Width: window.innerWidth, the input TK_slateMode documents, so the mode
// edges line up with the old @media widths (compact always sits inside
// max-width 760). Height: window.innerHeight (the element grows with the list).
// The observer on .tk-app.is-shell plus window resize schedule the measure.
// Pure rules: TK_viewLogic.js. Loads after TK_SlateBridge.jsx.
// ----------------------------------------------------------------------------

var TK_SLATE_SIZE_MISS_KEY = "mgb_slate_size_miss_v1"; // sessionStorage ms timestamp: presets hidden for 2 minutes after a missed resize
var TK_SLATE_MODE_TRACK_MS = 1500; // a mode must hold this long before slate-app-mode is tracked

var TK__sm = {
  state: null, // { mode, shape } once measured in the app
  subs: [],
  paneEl: null,
  paneSubs: [],
  presetSubs: [],
  trackT: null,
  tracked: null,
  focusT: null,
  search: "",
  searchSubs: [],
};

function TK__smInApp() {
  try {
    return typeof TK_slateInApp === "function" && TK_slateInApp() === true;
  } catch (e) {
    return false;
  }
}

function TK__smMeasure(prev) {
  var w = 0;
  var h = 0;
  try {
    w = window.innerWidth;
    h = window.innerHeight;
  } catch (e) {}
  return typeof TK_slateMode === "function" ? TK_slateMode(w, h, prev) : { mode: "compact", shape: null };
}

var TK__SM_DOC = ["tk-slate-m-sliver", "tk-slate-m-compact", "tk-slate-m-regular", "tk-slate-m-full", "tk-slate-wide"];
function TK__smApplyDoc(st) {
  try {
    var cl = document.documentElement.classList;
    for (var i = 0; i < TK__SM_DOC.length; i++) cl.remove(TK__SM_DOC[i]);
    if (!st) return;
    cl.add("tk-slate-m-" + st.mode);
    if (st.mode === "regular" || st.mode === "full") cl.add("tk-slate-wide");
  } catch (e) {}
}

function TK__smApplyEl(el, st) {
  if (!el || !el.classList) return;
  try {
    var drop = [];
    for (var i = 0; i < el.classList.length; i++) {
      var c = el.classList[i];
      if (c.indexOf("tk-m-") === 0 || c.indexOf("tk-shape-") === 0) drop.push(c);
    }
    drop.forEach(function (c) {
      el.classList.remove(c);
    });
    if (!st) return;
    String(TK_slateModeClasses(st))
      .split(" ")
      .forEach(function (c) {
        if (c) el.classList.add(c);
      });
  } catch (e) {}
}

function TK_slateModeNow() {
  if (!TK__smInApp()) return null;
  if (!TK__sm.state) {
    TK__sm.state = TK__smMeasure(null);
    TK__smApplyDoc(TK__sm.state);
  }
  return TK__sm.state;
}

function TK__smNotify(list) {
  list.slice().forEach(function (fn) {
    try {
      fn();
    } catch (e) {}
  });
}

function TK__smSubscribe(fn) {
  TK__sm.subs.push(fn);
  var off = typeof TK__slSubscribe === "function" ? TK__slSubscribe(fn) : function () {};
  return function () {
    TK__sm.subs = TK__sm.subs.filter(function (f) {
      return f !== fn;
    });
    off();
  };
}

function TK_useSlateMode() {
  return React.useSyncExternalStore(TK__smSubscribe, TK_slateModeNow, TK_slateModeNow);
}

function TK__smVisible(el) {
  return !!el && (el.offsetParent !== null || (el.getClientRects && el.getClientRects().length > 0));
}

// The new mode's main region: the sliver slot, else the list column.
function TK__smMainRegion() {
  try {
    return document.querySelector(".tk-app.is-shell.tk-m-sliver .tk-sliver-slot") || document.querySelector(".tk-app.is-shell .tk-app-main");
  } catch (e) {
    return null;
  }
}

// After a swap: focus that ended up hidden (or on <body>) goes to the main region.
function TK__smFixFocus() {
  if (TK__sm.focusT) clearTimeout(TK__sm.focusT);
  // After the drawer's own focus moves (it restores its opener with a 0 ms timer).
  TK__sm.focusT = setTimeout(function () {
    TK__sm.focusT = null;
    var a = null;
    try {
      a = document.activeElement;
    } catch (e) {}
    if (a && a !== document.body && TK__smVisible(a)) return;
    var main = TK__smMainRegion();
    if (!main) return;
    try {
      main.focus({ preventScroll: true });
    } catch (e) {}
  }, 60);
}

function TK__smTrack(st) {
  if (TK__sm.trackT) clearTimeout(TK__sm.trackT);
  TK__sm.trackT = setTimeout(function () {
    TK__sm.trackT = null;
    var key = st.mode + (st.shape ? ":" + st.shape : "");
    if (TK__sm.tracked === key) return;
    TK__sm.tracked = key;
    if (typeof TK__slTrack === "function") TK__slTrack("slate-app-mode", { mode: st.mode, shape: st.shape || null });
  }, TK_SLATE_MODE_TRACK_MS);
}

function TK__smSet(next, el) {
  var prev = TK__sm.state;
  if (prev && next && prev.mode === next.mode && prev.shape === next.shape) {
    TK__smApplyEl(el, prev);
    return;
  }
  var host = function (s) {
    return typeof TK_slateTaskHost === "function" ? TK_slateTaskHost(s ? s.mode : null) : "drawer";
  };
  // Blur (so a title, note or due draft saves) before the task changes host.
  if (prev && host(prev) !== host(next)) {
    try {
      var a = document.activeElement;
      if (a && a !== document.body && a.closest && a.closest(".tk-dw, .tk-slate-pane") && typeof a.blur === "function") a.blur();
    } catch (e) {}
  }
  TK__sm.state = next;
  TK__smApplyDoc(next);
  TK__smApplyEl(el, next);
  TK__smNotify(TK__sm.subs);
  if (prev) TK__smFixFocus();
  TK__smTrack(next);
}

// The observer. Returns a callback ref for .tk-app.is-shell; with on false it
// returns a ref that does nothing and nothing listens.
function TK_useSlateModeObserver(on) {
  var pair = React.useState(null);
  var el = pair[0];
  var setEl = pair[1];
  var enabled = !!on;
  React.useEffect(
    function () {
      if (!enabled || !el) return undefined;
      var raf = 0;
      var run = function () {
        raf = 0;
        TK__smSet(TK__smMeasure(TK__sm.state), el);
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
          ro.observe(el);
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
    },
    [enabled, el],
  );
  React.useEffect(
    function () {
      if (!enabled) return undefined;
      return function () {
        // Leaving the app (or TK_App unmounting): drop the <html> classes and
        // the measure, so the next TK_slateModeNow starts fresh.
        TK__smApplyDoc(null);
        TK__sm.state = null;
      };
    },
    [enabled],
  );
  return enabled ? setEl : null;
}

function TK_useSlateTaskHost() {
  var m = TK_useSlateMode();
  return m && typeof TK_slateTaskHost === "function" ? TK_slateTaskHost(m.mode) : "drawer";
}

// A sliver hides the list (still mounted), so its keys (x, v, j, k ...) stay
// off there: they must never act on rows nobody can see.
function TK_useListKeysOn(drawerId) {
  var m = TK_useSlateMode();
  if (m && m.mode === "sliver") return false;
  var host = m && typeof TK_slateTaskHost === "function" ? TK_slateTaskHost(m.mode) : "drawer";
  return !drawerId || host === "pane";
}

function TK_useSlateWide() {
  var m = TK_useSlateMode();
  return m && typeof TK_slateLayout === "function" ? TK_slateLayout(m.mode).canEdit : true;
}

function TK_useSlatePhone(width) {
  var m = TK_useSlateMode();
  if (m && typeof TK_slateLayout === "function") return TK_slateLayout(m.mode).compact;
  return width <= 760;
}

function TK_slatePhoneNow() {
  var m = TK_slateModeNow();
  return m && typeof TK_slateLayout === "function" ? TK_slateLayout(m.mode).compact : null;
}

// ---- The pane slot ------------------------------------------------------------

function TK_slateSetPaneEl(el) {
  if (TK__sm.paneEl === el) return;
  TK__sm.paneEl = el || null;
  TK__smNotify(TK__sm.paneSubs);
}
function TK__smPaneSub(fn) {
  TK__sm.paneSubs.push(fn);
  return function () {
    TK__sm.paneSubs = TK__sm.paneSubs.filter(function (f) {
      return f !== fn;
    });
  };
}
function TK__smPaneGet() {
  return TK__sm.paneEl;
}
function TK_useSlatePaneEl() {
  return React.useSyncExternalStore(TK__smPaneSub, TK__smPaneGet, TK__smPaneGet);
}

function TK__smOpenId() {
  try {
    var st = typeof TK_dwState === "function" ? TK_dwState() : null;
    return st && st.drawerId != null ? String(st.drawerId) : null;
  } catch (e) {
    return null;
  }
}

// j / k swap the pane, Esc clears it (full mode, while the pane is up).
function TK__smUsePaneKeys(on) {
  React.useEffect(
    function () {
      if (!on) return undefined;
      var jkAt = 0;
      var onDownCapture = function (e) {
        if (!e || e.ctrlKey || e.metaKey || e.altKey) return;
        if (e.key === "j" || e.key === "k") jkAt = Date.now();
      };
      var onFocusIn = function (e) {
        if (!jkAt || Date.now() - jkAt > 400) return;
        var t = e && e.target;
        if (!t || !t.closest) return;
        var row = t.closest(".tk-app.is-shell .tk-row[data-tk-id]");
        if (!row || row !== t) return;
        var open = TK__smOpenId();
        var id = row.getAttribute("data-tk-id");
        if (!open || !id || id === open) return;
        if (typeof TK_openTask === "function") TK_openTask(id, { from: "keys" });
      };
      var onDown = function (e) {
        if (!e || e.key !== "Escape" || e.defaultPrevented) return;
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        var open = TK__smOpenId();
        if (!open) return;
        var ctx = typeof TK_vKeyCtx === "function" ? TK_vKeyCtx() : {};
        if (ctx.modalOpen || ctx.menuOpen || ctx.tourOpen) return;
        if (typeof TK__isTypingTarget === "function" && TK__isTypingTarget(e.target)) return;
        var eat = TK__sm.paneEsc;
        if (typeof eat === "function" && eat() === true) {
          e.preventDefault();
          return;
        }
        e.preventDefault();
        var inPane = !!(e.target && e.target.closest && e.target.closest(".tk-slate-pane"));
        if (typeof TK_dwDispatch === "function") TK_dwDispatch({ type: "drawer", id: null });
        if (inPane) {
          setTimeout(function () {
            var row = null;
            try {
              row = document.querySelector('.tk-app.is-shell .tk-row[data-tk-id="' + String(open).replace(/["\\]/g, "") + '"]');
            } catch (err) {}
            var to = row || TK__smMainRegion();
            if (to) {
              try {
                to.focus({ preventScroll: true });
              } catch (err) {}
            }
          }, 0);
        }
      };
      document.addEventListener("keydown", onDownCapture, true);
      document.addEventListener("focusin", onFocusIn, false);
      document.addEventListener("keydown", onDown, false);
      return function () {
        document.removeEventListener("keydown", onDownCapture, true);
        document.removeEventListener("focusin", onFocusIn, false);
        document.removeEventListener("keydown", onDown, false);
      };
    },
    [on],
  );
}

// The full-mode pane column. TK_App renders it; TK_DrawerHost portals the
// open task into its slot, so the task has one owner (TK_store drawerId).
function TK_SlatePane(props) {
  var view = (props && props.view) || "";
  var drawerId = TK_vUseStore(function (s) {
    return s ? s.drawerId : null;
  });
  TK__smUsePaneKeys(true);
  var empty = view === "templates" ? "Pick a template" : "Pick a task";
  return (
    <section className="tk-slate-pane" aria-label="Task details">
      {drawerId ? null : (
        <div className="tk-slate-pane-empty">
          <p>{empty}</p>
          {view === "templates" ? <p className="tk-muted">Templates open in their own editor.</p> : null}
        </div>
      )}
      <div className="tk-slate-pane-slot" ref={TK_slateSetPaneEl} />
    </section>
  );
}

// The embedded task in the pane (TK_DrawerHost renders it through a portal).
function TK_SlatePaneTask(props) {
  var p = props || {};
  var ref = React.useRef(null);
  var registerEsc = React.useCallback(function (fn) {
    TK__sm.paneEsc = typeof fn === "function" ? fn : null;
  }, []);
  if (typeof TK_DrawerContent !== "function") return null;
  return (
    <div
      ref={ref}
      className="tk-slate-pane-task"
      tabIndex={-1}
      data-tk-keyscope="drawer"
      onKeyDownCapture={function (e) {
        if (e.key === "Escape") ref.escAt = Date.now();
      }}
      onBlurCapture={function () {
        // A field's own Esc (revert + blur) would drop focus to <body>; keep it here.
        if (!ref.escAt || Date.now() - ref.escAt > 300) return;
        setTimeout(function () {
          var el = ref.current;
          if (el && (document.activeElement === document.body || !document.activeElement)) {
            try {
              el.focus({ preventScroll: true });
            } catch (e) {}
          }
        }, 20);
      }}
    >
      <div className="tk-dwc">
        <TK_DrawerContent
          key={p.taskId}
          taskId={p.taskId}
          mode="embedded"
          scopeRef={ref}
          registerEsc={registerEsc}
          onClose={p.onClose}
          focusField={p.focusField}
          staffUser={p.staffUser}
          clients={p.clients}
          isAdmin={p.isAdmin}
          canManageTemplates={p.canManageTemplates}
          canCreateTemplates={p.canCreateTemplates}
          onOpenTemplates={p.onOpenTemplates}
        />
      </div>
    </div>
  );
}

// ---- Size presets (spec 3.5) -------------------------------------------------------

function TK__smSsGet(k) {
  try {
    return window.sessionStorage.getItem(k);
  } catch (e) {
    return null;
  }
}
function TK__smSsSet(k, v) {
  try {
    window.sessionStorage.setItem(k, v);
  } catch (e) {}
}

function TK__smStandalone() {
  try {
    var ia = window.mgbInstallApp;
    if (ia && typeof ia.slateStandalone === "function" && ia.slateStandalone()) return true;
  } catch (e) {}
  try {
    return !!(window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
  } catch (e) {
    return false;
  }
}

function TK_slatePresetsOk() {
  if (!TK__smInApp()) return false;
  // A missed resize hides the buttons for 2 minutes only (never the whole
  // session), so the way back to the normal view always returns.
  if (typeof TK_slateMissHides === "function" && TK_slateMissHides(TK__smSsGet(TK_SLATE_SIZE_MISS_KEY), Date.now(), { w: window.innerWidth, h: window.innerHeight })) return false;
  var opener = false;
  try {
    opener = !!window.opener;
  } catch (e) {
    opener = false;
  }
  var name = "";
  try {
    name = window.name || "";
  } catch (e) {}
  return typeof TK_slatePresetsAllowed === "function" && TK_slatePresetsAllowed({ hasOpener: opener, standalone: TK__smStandalone(), name: name });
}

function TK__smMiss(id) {
  // Time plus the window size now: growing the window clears the hide.
  TK__smSsSet(TK_SLATE_SIZE_MISS_KEY, Date.now() + "|" + window.innerWidth + "|" + window.innerHeight);
  TK__smNotify(TK__sm.presetSubs);
  setTimeout(function () {
    TK__smNotify(TK__sm.presetSubs);
  }, 121000);
  if (typeof TK_vToast === "function") TK_vToast(id === "sliver" ? "Drag the window smaller" : "Drag the window bigger");
}

// Size the window to a preset. Checks a frame later (and up to 500 ms for the
// resize to land) that the inner size is within 4px; a miss hides the presets
// for this session and says "Drag the window bigger". A newer preset click
// retires the older check, so two quick clicks never count as a miss.
var TK__smPresetGen = 0;
function TK_slateApplyPreset(id) {
  if (!TK_slatePresetsOk()) return;
  var scr = {};
  try {
    var s = window.screen || {};
    scr = { availWidth: s.availWidth, availHeight: s.availHeight, availLeft: s.availLeft, availTop: s.availTop };
  } catch (e) {}
  var chrome = { w: 0, h: 0 };
  try {
    chrome = { w: window.outerWidth - window.innerWidth, h: window.outerHeight - window.innerHeight };
  } catch (e) {}
  var want = typeof TK_slateSizePreset === "function" ? TK_slateSizePreset(id, scr, chrome) : null;
  if (!want) {
    TK__smMiss(id);
    return;
  }
  try {
    if (want.x != null && want.y != null) window.moveTo(want.x, want.y);
    window.resizeTo(want.w, want.h);
  } catch (e) {}
  if (typeof TK__slTrack === "function") TK__slTrack("slate-app-size", { preset: id });
  var done = false;
  var started = Date.now();
  var gen = ++TK__smPresetGen;
  var check = function () {
    if (done) return;
    if (gen !== TK__smPresetGen) {
      done = true;
      window.removeEventListener("resize", check);
      return;
    }
    var got = { w: window.innerWidth, h: window.innerHeight };
    if (typeof TK_slateSizeHit === "function" && TK_slateSizeHit(want, got)) {
      done = true;
      window.removeEventListener("resize", check);
      return;
    }
    if (Date.now() - started >= 500) {
      done = true;
      window.removeEventListener("resize", check);
      TK__smMiss(id);
    }
  };
  window.addEventListener("resize", check);
  try {
    window.requestAnimationFrame(check);
  } catch (e) {}
  setTimeout(check, 520);
}

function TK__smPresetSub(fn) {
  TK__sm.presetSubs.push(fn);
  var off = typeof TK__slSubscribe === "function" ? TK__slSubscribe(fn) : function () {};
  // A resize re-checks the hide, so the buttons return as soon as the window grows.
  var onResize = function () {
    fn();
  };
  window.addEventListener("resize", onResize);
  return function () {
    window.removeEventListener("resize", onResize);
    TK__sm.presetSubs = TK__sm.presetSubs.filter(function (f) {
      return f !== fn;
    });
    off();
  };
}
function TK_useSlatePresets() {
  var ok = React.useSyncExternalStore(TK__smPresetSub, TK_slatePresetsOk, TK_slatePresetsOk);
  return { ok: ok, apply: TK_slateApplyPreset };
}

var TK_SLATE_PRESET_ITEMS = [
  { id: "sliver", label: "Sliver" },
  { id: "list", label: "List" },
  { id: "full", label: "Full page" },
];

// The size buttons in the bar (regular and full).
function TK_SlateSizeButtons() {
  var pr = TK_useSlatePresets();
  if (!pr.ok) return null;
  return (
    <div className="tk-slate-sizes" role="group" aria-label="Window size" data-tour="tk-slate-sizes">
      {TK_SLATE_PRESET_ITEMS.map(function (it) {
        return (
          <button
            key={it.id}
            type="button"
            className="tk-sbar-btn tk-slate-size"
            onClick={function () {
              pr.apply(it.id);
            }}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

// ---- Compact: read-only with a note ------------------------------------------------

function TK_SlateWiderNote() {
  var pr = TK_useSlatePresets();
  return (
    <div className="tk-slate-wider" role="note">
      <span>Make the window wider to edit.</span>
      {pr.ok ? (
        <button
          type="button"
          className="btn-secondary tk-slate-fullpage"
          onClick={function () {
            pr.apply("full");
          }}
        >
          Full page
        </button>
      ) : null}
    </div>
  );
}

// Outside the app: the children, untouched. Inside: always one fieldset (so a
// mode change never remounts the children), disabled with the note in compact.
function TK_SlateReadOnly(props) {
  var m = TK_useSlateMode();
  if (!m) return props.children === undefined ? null : props.children;
  var wide = typeof TK_slateLayout === "function" ? TK_slateLayout(m.mode).canEdit : true;
  return (
    <React.Fragment>
      {wide || props.note === false ? null : <TK_SlateWiderNote />}
      <fieldset className="tk-slate-ro" disabled={!wide}>
        {props.children}
      </fieldset>
    </React.Fragment>
  );
}

// ---- The sliver's slot (S4 fills it) --------------------------------------------

// S4: TK_SlateSliver (TK_SlateSliver.jsx) fills it with the current task.
function TK_SlateSliverSlot(props) {
  var p = props || {};
  var pr = TK_useSlatePresets();
  var filled = typeof TK_SlateSliver === "function";
  return (
    <div className="tk-sliver-slot" id="tk-sliver-slot" role="region" aria-label="Current task" tabIndex={-1} data-shape={p.shape || ""}>
      {filled ? <TK_SlateSliver shape={p.shape} staffUser={p.staffUser} clients={p.clients} isAdmin={p.isAdmin} /> : null}
      {filled ? null : <p className="tk-sliver-wait">Make the window bigger to see your list.</p>}
      {!filled && pr.ok ? (
        <button
          type="button"
          className="tk-tool-btn"
          onClick={function () {
            pr.apply("list");
          }}
        >
          List
        </button>
      ) : null}
    </div>
  );
}

// ---- The bar's search box -> the Search view ---------------------------------

// TK_SearchView's first query (then cleared). "" when nothing was typed.
function TK_slateTakeSearch() {
  var q = TK__sm.search || "";
  TK__sm.search = "";
  return q;
}
// The Search view listens while it is open. Returns the unsubscribe.
function TK_slateOnSearch(fn) {
  if (typeof fn !== "function") return function () {};
  TK__sm.searchSubs.push(fn);
  return function () {
    TK__sm.searchSubs = TK__sm.searchSubs.filter(function (f) {
      return f !== fn;
    });
  };
}
function TK_slateSearch(q) {
  var text = String(q || "").slice(0, 200);
  if (TK__sm.searchSubs.length) {
    TK__sm.searchSubs.slice().forEach(function (fn) {
      try {
        fn(text);
      } catch (e) {}
    });
  } else {
    TK__sm.search = text;
  }
  if (typeof TK_navigate === "function") TK_navigate({ view: "search" });
}

function TK_SlateSearchBox() {
  var pair = React.useState("");
  var q = pair[0];
  var setQ = pair[1];
  return (
    <form
      className="tk-slate-search"
      role="search"
      onSubmit={function (e) {
        e.preventDefault();
        TK_slateSearch(q);
        setQ("");
      }}
    >
      <TK_vIcon name="search" size={16} />
      <input className="tk-slate-search-input" type="search" aria-label="Search tasks" placeholder="Search tasks" maxLength={200} value={q} onChange={function (e) {
        setQ(e.target.value);
      }} />
    </form>
  );
}
