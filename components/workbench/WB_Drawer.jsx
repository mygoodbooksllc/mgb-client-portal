// ----------------------------------------------------------------------------
// WB_Drawer: the Desk (was Workbench) on every staff page. R1 + R1c of the
// Desk spec (docs/desk-right-spec.md, decisions 26-28, owner approved
// 2026-10-19): a right column and a bottom info bar.
//
// The right column. Closed, it is the slim rail: 52px, the sidebar color,
// full height from under the top bar down to the bottom bar. It shows only
// what other people are waiting on you for: messages, reviews, files and
// mentions, each a count with a flyout (hover or focus), and the quick-add +
// at the bottom (the top bar's + menu, TB_QuickAdd variant "rail"). The rail
// is one Tab stop (roving tabindex, arrow keys move, Enter opens). Messages
// opens the chat drawer (the floating chat bubble is not shown while the
// Desk is on); mentions opens the bell.
// Open (D, a click on the bar or the rail), the column widens in place to
// the saved width (380px Standard, 320-520 with the grip on its left edge,
// magnets at the named widths; saved per person in mgb_wb_desk:<email>).
// From 1100px wide the page makes room (--desk-occupy, "push"); under that
// the column covers the page's right edge ("overlay"); no scrim, no focus
// trap above 760px. Phones (760px and under, "sheet") get the full-screen
// modal sheet. The open body is WB_Hub (WB_Hub.jsx).
//
// The bottom info bar (R1c): 42px, the sidebar color, full width from the
// left rail to the right edge (to the open column's edge while open, one
// line). Your own work and the clock only: "3 late", "5 of 8 today", next
// up with its client, the page client line (open tasks, waiting, QuickBooks
// sync, from the client tab counts and the client's own sync data, no new
// fetch) and the "D to open" hint. "Clean slate" when there is nothing.
// A click or D opens the column; it never opens a panel of its own.
//
// The rail, bar and column are portaled into a div at the end of .app-shell
// (after .main), so the Tab order runs page, bar, rail, Desk, then out to the
// browser, and they stay inside the shell's stacking context: modals (2000),
// the Undo bar (2050) and everything portaled to <body> (drawers, tips, the
// tour) layer above them. They sit under the sticky top bar (700), which
// stays full width, so its menus drop over the column; the phone sheet
// stays high (WB.css).
//
// app.jsx mounts it only when WB_deskMounts(...) says so (a signed-in staff
// member who isn't viewing as someone, previewing or impersonating); it
// renders nothing while the Desk is off.
// ----------------------------------------------------------------------------

// "sheet" at the phone breakpoint, "dock" above it, kept current.
function WB_useDeskMode() {
  const q = "(max-width: " + WB_DESK_SHEET_MAX + "px)";
  const read = () => {
    try {
      if (window.matchMedia) return window.matchMedia(q).matches ? "sheet" : "dock";
      return WB_deskMode(window.innerWidth);
    } catch (e) {
      return "dock";
    }
  };
  const [mode, setMode] = React.useState(read);
  React.useEffect(() => {
    let mq = null;
    try {
      mq = window.matchMedia ? window.matchMedia(q) : null;
    } catch (e) {}
    if (!mq) return undefined;
    const on = () => setMode(mq.matches ? "sheet" : "dock");
    on();
    if (mq.addEventListener) mq.addEventListener("change", on);
    else if (mq.addListener) mq.addListener(on);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", on);
      else if (mq.removeListener) mq.removeListener(on);
    };
  }, []);
  return mode;
}

// app.jsx: is the Desk live for this person right now, with its rail showing?
// (mounts is WB_deskMounts(...)). Hides the floating chat bubble while it is.
// Phones (the sheet, 760px and under) have no rail and so no messages icon,
// so the bubble stays there, lifted above the info bar (WB.css). Re-renders
// only when the answer changes.
// anyMode (R2): live on phones too (the sheet). app.jsx hides the client
// tasks strip with it, because tasks and the client tab open in the Desk there.
function WB_useDeskLive(mounts, anyMode) {
  const mode = WB_useDeskMode();
  const read = () => {
    if (!mounts || typeof WB_store === "undefined") return false;
    const st = WB_store.getState();
    return WB_deskLive({ mounts: true, on: st.on, status: st.status });
  };
  const [live, setLive] = React.useState(read);
  React.useEffect(() => {
    if (!mounts || typeof WB_store === "undefined") {
      setLive(false);
      return undefined;
    }
    try {
      if (!WB_store.getState().flagKnown) WB_store.readFlag();
    } catch (e) {}
    const on = () => {
      const v = read();
      setLive((p) => (p === v ? p : v));
    };
    on();
    return WB_store.subscribe(on);
  }, [mounts]);
  return live && (anyMode === true || mode === "dock");
}

// The bell's mentions (TB_Bell publishes them on window, TopBar.jsx).
function WB_useBellMentions() {
  const read = () => {
    try {
      return Array.isArray(window.TB_bellMentions) ? window.TB_bellMentions : [];
    } catch (e) {
      return [];
    }
  };
  const [list, setList] = React.useState(read);
  React.useEffect(() => {
    const on = () => setList(read());
    window.addEventListener("tb:bell-mentions", on);
    on();
    return () => window.removeEventListener("tb:bell-mentions", on);
  }, []);
  return list;
}

// Tasks I finished today, from the task store (null until one of my task
// lists has loaded, so the bar never claims "0 of 5" from nothing).
function WB_useDoneToday(me, today, live) {
  const calc = () => {
    try {
      if (!live || typeof TK_store === "undefined" || !TK_store || typeof TK_store.getState !== "function") return null;
      if (typeof TK_isMine !== "function" || typeof TK_effectiveStatus !== "function") return null;
      const st = TK_store.getState() || {};
      const lists = st.lists || {};
      const ok = (k) => !!(lists[k] && lists[k].at);
      if (!ok("mine") && !ok("wb:mine")) return null;
      const map = st.tasks || {};
      const tasks = Object.keys(map).map((k) => map[k]);
      return WB_doneToday(tasks, { today, isMine: (t) => TK_isMine(t, me), isDone: (t) => TK_effectiveStatus(t) === "done" });
    } catch (e) {
      return null;
    }
  };
  const [n, setN] = React.useState(calc);
  React.useEffect(() => {
    const on = () => {
      const v = calc();
      setN((p) => (p === v ? p : v));
    };
    on();
    if (!live || typeof TK_store === "undefined" || !TK_store || typeof TK_store.subscribe !== "function") return undefined;
    return TK_store.subscribe(on);
  }, [me, today, live]);
  return n;
}

// The bottom of the sticky staff top bar: the column and rail start there.
// Measured, so a preview banner above it is counted.
function WB__deskTop() {
  try {
    const tb = document.querySelector(".tb-bar");
    if (tb) {
      const r = tb.getBoundingClientRect();
      if (r.height > 0) return Math.max(0, Math.floor(r.bottom)); // floor: a fractional bottom must not leave a page-colored sliver above the rail
    }
  } catch (e) {}
  return 0;
}

// Takes the Desk's variables and classes off <html>.
function WB__deskClearVars() {
  try {
    const el = document.documentElement;
    ["--desk-w", "--desk-occupy", "--desk-occupy-any", "--desk-cover", "--desk-top"].forEach((k) => el.style.removeProperty(k));
    el.classList.remove("wb-desk-side", "wb-desk-push", "wb-desk-overlay", "wb-desk-open", "wb-desk-dragging");
  } catch (e) {}
}

// The Desk's own container at the end of .app-shell (after .main): created
// once per mount, removed on unmount. null when there is no shell (render in
// place).
function WB__deskHost() {
  try {
    const shell = document.querySelector(".app-shell");
    if (!shell) return null;
    const el = document.createElement("div");
    el.className = "wb-desk-root";
    shell.appendChild(el);
    return el;
  } catch (e) {
    return null;
  }
}

// Can focus go back to this element? (still in the page, shown, enabled)
function WB__canFocus(el) {
  try {
    return !!(el && el.isConnected && typeof el.focus === "function" && !el.disabled && el.offsetParent !== null && el !== document.body);
  } catch (e) {
    return false;
  }
}

// Stacked layers and the tour: focus inside them is not "the page" and not
// "the Desk" (WB_deskFocusZone ignores it).
var WB_DESK_LAYER_SEL = WB_LAYERS.filter(function (l) {
  return l.stacked || l.id === "tour";
})
  .map(function (l) {
    return l.sel;
  })
  .join(", ");

// ---- Rail icons (stroke currentColor: the rail's own text colors) ----------
function WB__RailIcon({ id }) {
  const p = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", focusable: "false" };
  if (id === "message")
    return (
      <svg {...p}>
        <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
      </svg>
    );
  if (id === "review")
    return (
      <svg {...p}>
        <path d="M9 11l3 3 8-8" />
        <path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9" />
      </svg>
    );
  if (id === "doc")
    return (
      <svg {...p}>
        <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
        <path d="M14 3v5h5" />
      </svg>
    );
  return (
    <svg {...p}>
      <circle cx="12" cy="12" r="4" />
      <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8" />
    </svg>
  );
}

var WB_RAIL_ITEMS = [
  { id: "message", one: "message", many: "messages", empty: "No messages waiting" },
  { id: "review", one: "review", many: "reviews", empty: "No reviews waiting" },
  { id: "doc", one: "file", many: "files", empty: "No files waiting" },
  { id: "mention", one: "mention", many: "mentions", empty: "No new mentions" },
];

// The slim rail (closed column, dock only).
function WB_DeskRail({ counts, lines, unread, quickClient, onPick, onOpen }) {
  const [idx, setIdx] = React.useState(0);
  // R2 (R1 leftover): Esc hides the flyouts (WCAG 1.4.13, dismissible
  // without moving the pointer or focus). They come back when the pointer
  // enters an icon again or focus moves to another one.
  const [tipsOff, setTipsOff] = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      const el = ref.current;
      if (!el) return;
      let shown = false;
      try {
        shown = el.matches(":hover") || el.contains(document.activeElement);
      } catch (err) {}
      if (shown) setTipsOff(true);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  // After a mouse click the Desk returns focus to the icon from script, which
  // matches :focus-visible and would pin the flyout open. Mouse use marks the
  // rail (is-pointer); a key press clears it, so keyboard focus still shows it.
  React.useEffect(() => {
    // Any pointer movement or press marks mouse use; only keys that move focus
    // (Tab, arrows, Home, End) clear it, so a stray key press or Esc elsewhere
    // can't leave a flyout pinned open after the mouse has left.
    const down = () => { if (ref.current) ref.current.classList.add("is-pointer"); };
    const key = (e) => { if (ref.current && ["Tab", "ArrowUp", "ArrowDown", "Home", "End"].indexOf(e.key) >= 0) ref.current.classList.remove("is-pointer"); };
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("pointermove", down, true);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointermove", down, true);
      window.removeEventListener("keydown", key, true);
    };
  }, []);
  const items = () => Array.prototype.slice.call((ref.current && ref.current.querySelectorAll("[data-wb-rail]")) || []);
  const onKeyDown = (e) => {
    if (e.defaultPrevented) return; // the open + menu already moved focus
    const t = e.target;
    try {
      if (t && t.closest && t.closest('[role="menu"]')) return; // the + menu moves its own focus
    } catch (err) {}
    if (["ArrowDown", "ArrowUp", "Home", "End"].indexOf(e.key) < 0 || e.ctrlKey || e.metaKey || e.altKey) return;
    const list = items();
    if (!list.length) return;
    e.preventDefault();
    const i = Math.max(0, list.indexOf(document.activeElement));
    const n = e.key === "Home" ? 0 : e.key === "End" ? list.length - 1 : e.key === "ArrowDown" ? (i + 1) % list.length : (i - 1 + list.length) % list.length;
    setIdx(n);
    list[n].focus();
  };
  const onFocus = (e) => {
    const i = items().indexOf(e.target);
    if (i >= 0 && i !== idx) setIdx(i);
    if (i >= 0 && i !== idx) setTipsOff(false);
  };
  const hasAdd = typeof TB_QuickAdd === "function";
  return (
    <div
      ref={ref}
      className={"wb-rail" + (tipsOff ? " is-tips-off" : "")}
      role="toolbar"
      aria-orientation="vertical"
      aria-label={WB_NAME + ": waiting on you"}
      data-tour="wb-rail"
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setTipsOff(false);
      }}
      onMouseLeave={() => setTipsOff(false)}
      onClick={(e) => {
        // A click on the rail itself (not an icon or the + menu) opens the Desk.
        if (e.target === e.currentTarget || (e.target.classList && e.target.classList.contains("wb-rail-gap"))) onOpen();
      }}
    >
      {WB_RAIL_ITEMS.map((it, i) => {
        const n = counts[it.id] || 0;
        const ls = lines[it.id] || [];
        const label = n ? n + " " + (n === 1 ? it.one : it.many) + " waiting" : it.empty;
        const tipId = "wb-rail-tip-" + it.id;
        const dot = it.id === "message" && unread;
        return (
          <div key={it.id} className={"wb-rail-item" + (n ? " has-count" : "")} onMouseEnter={() => tipsOff && setTipsOff(false)}>
            <button
              type="button"
              className="wb-rail-btn"
              data-wb-rail={it.id}
              tabIndex={i === idx ? 0 : -1}
              aria-label={label + (dot ? ", new message" : "")}
              aria-describedby={tipId}
              onClick={() => onPick(it.id)}
            >
              <WB__RailIcon id={it.id} />
              {n > 0 && (
                <span className="wb-rail-badge" aria-hidden="true">
                  {n > 99 ? "99+" : n}
                </span>
              )}
              {dot && <span className="wb-rail-dot" aria-hidden="true" />}
            </button>
            <div className="wb-rail-tip" id={tipId} role="tooltip">
              <span className="wb-rail-tip-head">{label}</span>
              {ls.slice(0, 3).map((l, k) => (
                <span key={k} className="wb-rail-tip-line">
                  {l}
                </span>
              ))}
              {ls.length > 3 && <span className="wb-rail-tip-more">{"+" + (ls.length - 3) + " more"}</span>}
            </div>
          </div>
        );
      })}
      <div className="wb-rail-gap" aria-hidden="true" />
      {hasAdd && <TB_QuickAdd client={quickClient} variant="rail" tabIndex={idx === WB_RAIL_ITEMS.length ? 0 : -1} />}
    </div>
  );
}

// R2 adds staffUser and the template props (canManageTemplates,
// canCreateTemplates, onOpenTemplates), passed through to the task view's
// TK_DrawerContent exactly as app.jsx passes them to TK_DrawerHost.
// variant="window" (MGB Desk in its own window, WB_DeskApp.jsx): the same
// Desk, but rendered in place and always open: no rail, no info bar, no width
// grip, no html classes or variables, no D key, no sheet layout. Closing does
// nothing (the store's forceOpen) and "close" steps act as "list". onCount(n)
// reports the item count (the window title).
function WB_Drawer({ me, isAdmin, clients, currentClientId, page, messagesUnread, chatClientId, clientCounts, pageClient, staffUser, canManageTemplates, canCreateTemplates, onOpenTemplates, variant, onCount }) {
  const isWin = variant === "window";
  const winInit = React.useRef(false);
  if (isWin && !winInit.current) {
    winInit.current = true;
    WB_store.setOptions({ hubKeyBase: WB_HUB_WIN_KEY, forceOpen: true });
  }
  const on = WB_useSwitch();
  const s = WB_useStore(me, isAdmin, on);
  const open = s.drawerOpen;
  const panelRef = React.useRef(null);
  const barRef = React.useRef(null);
  const railRef = React.useRef(null);
  const live = on && s.status !== "missing" && !!me;
  const deskMode = WB_useDeskMode();
  const mode = isWin ? "window" : deskMode;
  const sheet = mode === "sheet";
  // Shared with WB_useHubKeys / WB_useHubLayers: the mode, where focus is,
  // and the drag (so Esc can cancel it).
  const deskRef = React.useRef({ mode: mode, zone: "page", dragging: false, cancel: null });
  deskRef.current.mode = mode;
  deskRef.current.variant = isWin ? "window" : "";
  // Where the Desk renders: undefined until the first layout pass (nothing
  // yet, before paint), then the div at the end of .app-shell, or null to
  // render in place (always, in the window).
  const [host, setHost] = React.useState(isWin ? null : undefined);
  React.useLayoutEffect(() => {
    if (isWin) return undefined;
    const el = WB__deskHost();
    setHost(el);
    return () => {
      if (el && el.parentNode) el.parentNode.removeChild(el);
    };
  }, []);
  // Regroup every 30 s so Overdue / Today and "waited" times stay current.
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    if (!live) return undefined;
    const id = setInterval(() => setTick((n) => n + 1), 30000);
    return () => clearInterval(id);
  }, [live]);

  const now = Date.now();
  const today = WB_today(now);
  const chip = WB_drawerChip(s.hub.chip);
  const view = React.useMemo(() => WB_build(s.rows, { today, now, chip }), [s.rows, today, chip, open, tick]);
  const allView = React.useMemo(() => (chip === "all" ? view : WB_build(s.rows, { today, now, chip: "all" })), [view, s.rows, today, chip, tick]);
  const count = allView.counts.all;
  React.useEffect(() => {
    if (isWin && typeof onCount === "function") onCount(count);
  }, [count, isWin]);
  const mentions = WB_useBellMentions();
  const doneToday = WB_useDoneToday(me, today, live);

  // The left edge (--wb-bar-left, measured from the staff rail so it follows
  // the rail collapsing or expanding; 0 on phones, where the nav is
  // off-canvas), the window width and the top bar's bottom (--desk-top).
  const [leftW, setLeftW] = React.useState(0);
  const [vw, setVw] = React.useState(() => (typeof window !== "undefined" ? window.innerWidth || 0 : 0));
  const [top, setTop] = React.useState(0);
  React.useEffect(() => {
    if (isWin) return undefined; // no rail to measure, no page to make room on
    const el = document.documentElement;
    el.classList.toggle("wb-drawer-on", live);
    if (!live) {
      el.style.removeProperty("--wb-bar-left");
      return () => el.classList.remove("wb-drawer-on");
    }
    let last = null;
    let watched = null;
    let ro = null;
    let raf = 0;
    const measure = () => {
      raf = 0;
      const rail = document.querySelector(".staff-rail");
      if (rail !== watched) {
        if (ro) ro.disconnect();
        watched = rail;
        if (rail && typeof ResizeObserver === "function") {
          ro = new ResizeObserver(later);
          ro.observe(rail);
        }
      }
      const rails = rail ? [rail.getBoundingClientRect()] : [];
      const left = WB_barLeft(rails, window.innerWidth);
      if (left !== last) {
        last = left;
        el.style.setProperty("--wb-bar-left", left + "px");
        setLeftW(left);
      }
      setVw(window.innerWidth || 0);
      setTop(WB__deskTop());
    };
    const later = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("resize", later);
    window.addEventListener("scroll", later, { passive: true }); // a banner above the top bar scrolls away
    const id = setInterval(later, 600); // the rail and banners can mount or change late
    return () => {
      window.removeEventListener("resize", later);
      window.removeEventListener("scroll", later);
      clearInterval(id);
      if (raf) cancelAnimationFrame(raf);
      if (ro) ro.disconnect();
      el.classList.remove("wb-drawer-on");
      el.style.removeProperty("--wb-bar-left");
    };
  }, [live]);

  // ---- R2: the task view (spec 5). The drill stack lives in WB_store; the
  // column shows the top task while the Desk is open and the stack has one.
  const drillStack = open && Array.isArray(s.drill) ? s.drill : [];
  const drillTop = drillStack.length ? drillStack[drillStack.length - 1] : null;
  const taskView = !!drillTop;
  const taskViewRef = React.useRef(taskView);
  taskViewRef.current = taskView;
  // The task view widens the column to at least Wide (decision 26). A width
  // dragged or keyed while a task shows is kept for this task view only; the
  // saved list width never changes from here.
  const [taskW, setTaskW] = React.useState(null);
  React.useEffect(() => {
    if (!taskView) setTaskW(null);
  }, [taskView]);

  // ---- Width and layout (WB_deskLayout, node-tested) ----
  const savedW = s.desk && s.desk.right ? s.desk.right.w : WB_DESK_W.standard;
  const wantW = taskView ? WB_deskTaskWidth(savedW, taskW) : savedW;
  const layout = WB_deskLayout({ vw, railW: leftW, w: wantW, open });
  const layoutRef = React.useRef(layout);
  layoutRef.current = layout;
  // What covers the page's right edge: the open column, else the rail.
  const cover = layout.mode === "sheet" ? 0 : open ? layout.w : WB_DESK_RAIL;

  // --desk-w / --desk-occupy / --desk-occupy-any / --desk-cover / --desk-top
  // on <html> (WB.css reads them) and the classes: wb-desk-side (the rail or
  // column is on the right; the page keeps room for it), wb-desk-push (open
  // and the page makes room), wb-desk-overlay, wb-desk-open. Skipped mid-drag:
  // the drag's paint writes the width itself.
  React.useLayoutEffect(() => {
    if (isWin) return undefined; // the window never writes the page's variables
    const el = document.documentElement;
    if (!live) {
      // The Desk switched off (or the store went missing): nothing may keep
      // padding the page or moving the toasts.
      WB__deskClearVars();
      return undefined;
    }
    el.style.setProperty("--desk-top", top + "px");
    el.classList.toggle("wb-desk-side", layout.mode !== "sheet");
    el.classList.toggle("wb-desk-open", open);
    el.classList.toggle("wb-desk-push", open && layout.mode === "push");
    el.classList.toggle("wb-desk-overlay", open && layout.mode === "overlay");
    if (!deskRef.current.dragging) {
      el.style.setProperty("--desk-w", layout.w + "px");
      el.style.setProperty("--desk-occupy", layout.occupy + "px");
      el.style.setProperty("--desk-occupy-any", layout.occupyAny + "px");
      el.style.setProperty("--desk-cover", cover + "px");
    }
    return undefined;
  }, [live, open, layout.mode, layout.w, layout.occupy, layout.occupyAny, cover, top]);

  // ---- Width drag. Pointer Events (mouse, touch and pen share one path)
  // with pointer capture; the width is written straight to --desk-w in a rAF
  // (no React render mid-drag); the page's room (--desk-occupy) follows on
  // release. The release snaps with the last 80 ms of speed (magnets at the
  // named widths); a fling or drag far to the right closes the column.
  const drag = React.useRef(null);
  const stamp = (e) => (e && e.timeStamp ? e.timeStamp : typeof performance !== "undefined" ? performance.now() : Date.now());
  const paint = (w) => {
    const el = document.documentElement;
    el.style.setProperty("--desk-w", w + "px");
    el.style.setProperty("--desk-occupy-any", w + "px");
    el.style.setProperty("--desk-cover", w + "px");
  };
  const dropDrag = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    if (d.raf) cancelAnimationFrame(d.raf);
    try {
      if (d.el.hasPointerCapture && d.el.hasPointerCapture(d.id)) d.el.releasePointerCapture(d.id);
    } catch (err) {}
    deskRef.current.dragging = false;
    document.documentElement.classList.remove("wb-desk-dragging");
  };
  React.useEffect(() => {
    if (!live) dropDrag();
  }, [live]);
  React.useEffect(
    () => () => {
      dropDrag();
      WB__deskClearVars();
    },
    [],
  );
  const [commits, setCommits] = React.useState(0);
  React.useLayoutEffect(() => {
    // After a drag ends without a width change, put the saved width back.
    if (isWin || !live || deskRef.current.dragging) return;
    const L = layoutRef.current;
    paint(L.w);
    const el = document.documentElement;
    el.style.setProperty("--desk-occupy-any", L.occupyAny + "px");
    el.style.setProperty("--desk-cover", (L.mode === "sheet" ? 0 : WB_store.getState().drawerOpen ? L.w : WB_DESK_RAIL) + "px");
  }, [commits]);
  const endDrag = (commit) => {
    const d = drag.current;
    if (!d) return;
    dropDrag();
    if (!commit) {
      setCommits((n) => n + 1); // Esc: the start width comes back
      return;
    }
    const a = d.samples[0];
    const b = d.samples[d.samples.length - 1];
    const dt = b.t - a.t;
    // Positive vx = the column growing (the pointer moving left).
    const vx = dt > 0 ? (b.w - a.w) / dt : 0;
    const to = WB_deskWidthSnap(d.raw, vx, layoutRef.current.max);
    if (to.close) {
      setCommits((n) => n + 1);
      WB_store.setDrawerOpen(false);
      WB_track("wb-resize", "drag:close");
      return;
    }
    if (taskViewRef.current) setTaskW(to.w);
    else WB_store.setDeskWidth(to.w);
    setCommits((n) => n + 1);
    WB_track("wb-resize", "drag:" + WB_deskWidthName(to.w));
  };
  deskRef.current.cancel = () => endDrag(false);

  const handle = {
    show: !sheet,
    w: layout.w,
    min: WB_DESK_W.min,
    max: layout.max,
    valueText: WB_deskWidthText(layout.w),
    onPointerDown: (e) => {
      if (e.button !== 0 || e.isPrimary === false || drag.current) return;
      e.preventDefault(); // no text selection; focus the grip ourselves
      try {
        e.currentTarget.focus();
      } catch (err) {}
      const w0 = layoutRef.current.w;
      drag.current = { id: e.pointerId, el: e.currentTarget, startX: e.clientX, startW: w0, w: w0, raw: w0, samples: [{ t: stamp(e), w: w0 }], raf: 0 };
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch (err) {}
      document.documentElement.classList.add("wb-desk-dragging");
      deskRef.current.dragging = true;
    },
    onPointerMove: (e) => {
      const d = drag.current;
      if (!d || e.pointerId !== d.id) return;
      const raw = d.startW + (d.startX - e.clientX);
      const t = stamp(e);
      d.raw = raw;
      d.w = WB_deskWidthClamp(raw, layoutRef.current.max);
      d.samples.push({ t, w: raw });
      while (d.samples.length > 2 && t - d.samples[0].t > 80) d.samples.shift();
      if (!d.raf) {
        d.raf = requestAnimationFrame(() => {
          d.raf = 0;
          if (drag.current === d) paint(d.w);
        });
      }
    },
    onPointerUp: (e) => {
      if (drag.current && e.pointerId === drag.current.id) endDrag(true);
    },
    onPointerCancel: (e) => {
      if (drag.current && e.pointerId === drag.current.id) endDrag(true);
    },
    onLostPointerCapture: (e) => {
      if (drag.current && e.pointerId === drag.current.id) endDrag(true);
    },
    onKeyDown: (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const to = WB_deskWidthStep(layoutRef.current.w, e.key, layoutRef.current.max);
      if (to == null) return;
      e.preventDefault();
      e.stopPropagation();
      if (to === layoutRef.current.w) return;
      if (taskViewRef.current) setTaskW(to);
      else WB_store.setDeskWidth(to);
      WB_track("wb-resize", "key:" + WB_deskWidthName(to));
    },
  };

  // Where focus is (spec 4.2): inside the Desk, on its bar or rail, or on the
  // page. Focus inside a stacked drawer, a dialog or the tour does not count,
  // so "where it was before the layer opened" survives the layer. A click on
  // a non-focusable part of the page counts as the page.
  React.useEffect(() => {
    if (!live) return undefined;
    const track = (e) => {
      const t = e.target;
      if (!t || t.nodeType !== 1) return;
      let inLayer = false;
      try {
        inLayer = !!(WB_DESK_LAYER_SEL && t.closest(WB_DESK_LAYER_SEL));
      } catch (err) {}
      const panel = panelRef.current;
      const bar = barRef.current;
      const rail = railRef.current;
      const onBar = !!((bar && bar.contains(t)) || (rail && rail.contains(t)));
      const z = WB_deskFocusZone({ inLayer, inPanel: !!(panel && panel.contains(t)), onBar });
      if (z) deskRef.current.zone = z;
    };
    document.addEventListener("focusin", track, true);
    document.addEventListener("pointerdown", track, true);
    return () => {
      document.removeEventListener("focusin", track, true);
      document.removeEventListener("pointerdown", track, true);
    };
  }, [live]);

  // D toggles; Esc goes back one step with focus inside; Tab stays in the
  // phone sheet (WB_Hub.jsx).
  WB_useHubKeys(live, panelRef, deskRef);
  WB_useHubLayers(open && live, panelRef, deskRef);

  // Open by the bar, the rail, D or the grip: focus moves into the Desk, and
  // where it came from is kept. A page-load reopen (openedBy "restore") and a
  // launch tour opening it ("tour") leave focus where it is. Close: focus goes
  // back to where it came from only if it was inside the Desk (always, on
  // the phone sheet): the opener, else the rail, else the page.
  const wasOpen = React.useRef(false);
  const opener = React.useRef(null);
  const openedAt = React.useRef(0);
  React.useEffect(() => {
    if (open && !wasOpen.current) {
      openedAt.current = Date.now();
      if (Date.now() - s.at > 20000) WB_store.refresh();
      const ae = document.activeElement;
      const panel = panelRef.current;
      opener.current = ae && ae !== document.body && !(panel && panel.contains(ae)) ? ae : null;
      const by = WB_store.getState().openedBy;
      // A drill-in (or a reopen onto a kept task) focuses the task view
      // itself (the effect below).
      if (by !== "restore" && by !== "tour" && by !== "drill" && !WB_store.getState().drill.length) {
        setTimeout(() => {
          const first = panelRef.current && WB_hubFocusTarget(panelRef.current, null);
          if (first) first.focus();
        }, 30);
      }
    } else if (!open && wasOpen.current) {
      if (drag.current) endDrag(false);
      const zone = deskRef.current.zone;
      const ae = document.activeElement;
      const lost = !ae || ae === document.body || !ae.isConnected;
      if (sheet || zone === "desk" || lost) {
        const op = opener.current;
        // The rail is back on the next paint (it replaces the open column).
        setTimeout(() => {
          const railBtn = railRef.current && railRef.current.querySelector('[data-wb-rail][tabindex="0"]');
          const where = WB_deskReturnFocus({ openerOk: WB__canFocus(op), handleOk: WB__canFocus(railBtn) || WB__canFocus(barRef.current) });
          if (where === "opener") op.focus();
          else if (where === "handle") (WB__canFocus(railBtn) ? railBtn : barRef.current).focus();
          else {
            const main = document.querySelector("main, .main");
            if (main) {
              if (!main.hasAttribute("tabindex")) main.setAttribute("tabindex", "-1");
              main.focus();
            }
          }
        }, 0);
      }
      opener.current = null;
    }
    wasOpen.current = open;
  }, [open]);

  // ---- R2: the router (spec 5.1). While the Desk is live, every TK_openTask
  // call lands here first; true = the Desk's task view took it. The modal
  // drawer (or the Tasks page) takes it otherwise: schema not ready, or
  // opts.modal. drillReturn = where focus goes back when the first level
  // closes (the row it was opened from, on the page or in the Desk list).
  const drillReturn = React.useRef(null);
  const [drillSeq, setDrillSeq] = React.useState(0);
  React.useEffect(() => {
    if (!live) return undefined;
    const route = (id, opts) => {
      const o = opts || {};
      let schemaOk = false;
      try {
        const ts = typeof TK_dwState === "function" ? TK_dwState() : null;
        schemaOk = !!ts && ts.schema === "ok";
      } catch (err) {}
      if (WB_deskRoute({ live: true, schemaOk, opts: o }) !== "desk") return false;
      const st = WB_store.getState();
      // Clicking the row of the task already showing closes its view.
      const top = st.drill.length ? st.drill[st.drill.length - 1] : null;
      if (o.from === "list" && st.drawerOpen && top && String(top.id) === String(id) && deskRef.current && deskRef.current.drillStep) {
        while (WB_store.getState().drill.length > 1) WB_store.drillBack();
        deskRef.current.drillStep(st.drillOrigin.closeOnEmpty ? "close" : "list");
        return true;
      }
      const panel = panelRef.current;
      const ae = document.activeElement;
      const real = ae && ae !== document.body && ae !== document.documentElement ? ae : null;
      const outside = !!real && !(panel && panel.contains(real));
      if (!st.drawerOpen || !st.drill.length) drillReturn.current = real;
      // Spec 7: the opener is saved on every drill from outside the panel.
      if (outside && st.drawerOpen) opener.current = real;
      if (!WB_store.drill(String(id), { from: o.from || "", focus: o.focus || null })) return false;
      openedAt.current = Date.now();
      setDrillSeq((n) => n + 1);
      // The chat and widget drawers close for a task, as before; embedded
      // tells them it is the Desk's task view.
      try {
        window.dispatchEvent(new CustomEvent("tk:drawer-open", { detail: { id: String(id), embedded: true } }));
      } catch (err) {}
      WB_track("tasks-drawer");
      WB_track("wb-drill", o.from || "other");
      return true;
    };
    // The client tasks panel (t, the top bar's Tasks pill) becomes the Desk's
    // Client tab (decision 13). toggle on the client already showing closes.
    const clientRoute = (clientId, action) => {
      if (clientId == null || clientId === "") return false;
      const st = WB_store.getState();
      const showing = st.drawerOpen && !st.drill.length && st.hub.tab === "client" && String(st.hub.clientId || "") === String(clientId);
      if (action === "toggle" && showing) {
        WB_store.setDrawerOpen(false);
        return true;
      }
      WB_store.drillClear();
      WB_store.setHub({ tab: "client", clientId: String(clientId), lastFocus: null });
      WB_track("wb-hub", "client");
      if (!st.drawerOpen) {
        WB_store.setDrawerOpen(true, "client");
        WB_track("wb-drawer", "client");
      } else {
        setTimeout(() => {
          const el = panelRef.current && WB_hubFocusTarget(panelRef.current, null);
          if (el && typeof el.focus === "function") el.focus();
        }, 30);
      }
      return true;
    };
    window.TK_openTaskRoute = route;
    window.TK_openClientRoute = clientRoute;
    return () => {
      try {
        if (window.TK_openTaskRoute === route) delete window.TK_openTaskRoute;
        if (window.TK_openClientRoute === clientRoute) delete window.TK_openClientRoute;
      } catch (err) {}
    };
  }, [live]);

  // TK_store.deskTaskId: the task the view shows (rows mark it). drawerId
  // stays the modal's only.
  const deskTaskId = live && taskView ? drillTop.id : null;
  React.useEffect(() => {
    if (typeof TK_dwDispatch === "function") TK_dwDispatch({ type: "deskTask", id: deskTaskId });
  }, [deskTaskId]);
  React.useEffect(
    () => () => {
      if (typeof TK_dwDispatch === "function") TK_dwDispatch({ type: "deskTask", id: null });
    },
    [],
  );

  // Focus the task view on every drill (spec 7). The region, not the title
  // field, so x / s / a and the Esc ladder work at once (as in the modal).
  // focus "assignee" (the a key on a row): TK_DrawerContent focuses it.
  const taskViewKey = taskView ? drillTop.id + ":" + drillStack.length : "";
  React.useEffect(() => {
    if (!taskView || (drillTop && drillTop.focus === "assignee")) return undefined;
    if (WB_store.getState().openedBy === "restore") return undefined;
    let n = 0;
    let t = 0;
    const go = () => {
      const el = panelRef.current && panelRef.current.querySelector(".wb-taskview");
      if (el) {
        if (!el.contains(document.activeElement)) el.focus({ preventScroll: true });
        return;
      }
      if (n++ < 10) t = setTimeout(go, 30);
    };
    t = setTimeout(go, 30);
    return () => clearTimeout(t);
  }, [taskViewKey, drillSeq]);

  // The ladder's task-view steps (WB_useHubKeys, the Back button, the
  // content's own close): pop to the previous task, back to the list, or
  // close the Desk.
  const drillStep = (stepIn) => {
    // The window has no closed state to go back to: "close" is "list".
    const step = isWin && stepIn === "close" ? "list" : stepIn;
    if (step === "pop") {
      WB_store.drillBack();
      return;
    }
    if (step === "list") {
      while (WB_store.drillBack() > 0) {}
      const back = drillReturn.current;
      drillReturn.current = null;
      setTimeout(() => {
        if (WB__canFocus(back)) back.focus();
        else {
          const el = panelRef.current && WB_hubFocusTarget(panelRef.current, WB_store.getState().hub.lastFocus);
          if (el && typeof el.focus === "function") el.focus();
        }
      }, 30);
      return;
    }
    // close: the Desk was closed when the task opened; focus goes back to the
    // page row (the opener, through the close effect above).
    const back = drillReturn.current;
    drillReturn.current = null;
    if (WB__canFocus(back) && !(panelRef.current && panelRef.current.contains(back))) opener.current = back;
    WB_store.drillClear();
    WB_store.setDrawerOpen(false);
  };
  deskRef.current.drillStep = drillStep;
  // The task's own close (× in its head, a deleted or missing task): leave the
  // task view the way Esc at depth 1 would.
  const closeTask = () => drillStep(WB_store.getState().drillOrigin.closeOnEmpty ? "close" : "list");

  // Leaving the page (a deep link): the pushed column stays (it is part of
  // the layout); an overlay or the phone sheet closes, unless it opened
  // just now (the click that opened it also navigated).
  React.useEffect(() => {
    if (!open || isWin) return undefined; // the window's own hash catch-all is in WB_DeskApp.jsx
    const onHash = () => {
      const step = WB_deskNavStep({ layout: layoutRef.current.mode, msSinceOpen: Date.now() - openedAt.current });
      if (step === "close") WB_store.setDrawerOpen(false);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [open]);

  // R3: the open column's length (the window height; it is full height)
  // decides which extras fit (WB_deskFill). Kept here, not in WB_Hub, so the
  // bar knows whether the "Right now" card is showing.
  const [winH, setWinH] = React.useState(() => (typeof window !== "undefined" ? window.innerHeight : 0));
  React.useEffect(() => {
    const onResize = () => setWinH(window.innerHeight);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  if (!live) return null;

  const loading = !s.at && (s.status === "loading" || s.status === "idle");

  // ---- The rail's counts and flyout lines (decision 28: messages, reviews,
  // files, mentions; nothing else).
  const unseenMentions = mentions.filter((m) => m && m.unseen);
  const railCounts = WB_railCounts({ counts: allView.counts, mentions: unseenMentions.length });
  // Who, subject and the wait (decision 19), e.g. "Acme: Question · 3h".
  const rowsOf = (c) => {
    const out = [];
    allView.groups.forEach((g) => g.rows.forEach((r) => WB_chipOf(r) === c && out.push(WB_railLine(r, now))));
    return out;
  };
  const railLines = {
    message: rowsOf("message"),
    review: rowsOf("review"),
    doc: rowsOf("doc"),
    mention: unseenMentions.map((m) => m.title + (m.sub ? ": " + m.sub : "")),
  };
  const openTo = (patch, by) => {
    if (patch) WB_store.setHub(patch);
    if (!WB_store.getState().drawerOpen) {
      WB_store.setDrawerOpen(true, by || "rail");
      WB_track("wb-drawer", by || "rail");
    }
  };
  const onRailPick = (id) => {
    WB_track("wb-rail", id);
    if (id === "message") {
      if (WB__openChat(chatClientId || null)) return;
      openTo({ tab: "inbox", chip: "message" });
      return;
    }
    if (id === "mention") {
      if (Array.isArray(window.TB_bellMentions) && document.querySelector(".tb-bell")) {
        window.dispatchEvent(new CustomEvent("tb:open-bell"));
        return;
      }
      openTo({ tab: "inbox", chip: "all" });
      return;
    }
    openTo({ tab: "inbox", chip: id });
  };

  // ---- The info bar (R1c): my own work and the page client.
  const lateRows = [];
  const todayRows = [];
  const taskRows = [];
  allView.groups.forEach((g) =>
    g.rows.forEach((r) => {
      if (r.source !== "task") return;
      taskRows.push(r);
      if (g.id === "overdue") lateRows.push(r);
      else if (g.id === "today") todayRows.push(r);
    }),
  );
  const progress = WB_barProgress({ late: lateRows.length, dueOpen: todayRows.length, doneToday });
  const next = taskRows[0] || null;
  const cc = clientCounts || {};
  const ago = pageClient && pageClient.lastSyncedAt && typeof relTime === "function" ? relTime(pageClient.lastSyncedAt) : "";
  const clientLine = pageClient
    ? WB_barClientLine({
        name: pageClient.name,
        loaded: !!cc.loaded,
        error: !!cc.error,
        tasks: cc.tasks ? cc.tasks.mine : 0,
        overdue: cc.tasks ? cc.tasks.overdue : 0,
        waiting: cc.bank ? cc.bank.waiting : 0,
        qbo: !!pageClient.qbo,
        qboError: !!(cc.close && cc.close.qbo === "error"),
        syncedAt: pageClient.lastSyncedAt || null,
        staleHours: pageClient.staleHours,
        now,
        ago,
      })
    : null;
  // ---- The open Desk's "Right now" card (R3, decision 18): the page's
  // context from what the page already loaded (no new fetch).
  // The page client's message rows in the Desk's own inbox (the rail's
  // source) are merged in, so the card never says "No messages waiting"
  // while the rail counts one for this client (the tab counts poll every
  // 2 minutes; the Desk's rows can be newer).
  let inboxOldest = null;
  let pcMsgs = 0;
  let pcOldest = null;
  const pcId = pageClient && pageClient.id != null ? String(pageClient.id) : "";
  allView.groups.forEach((g) =>
    g.rows.forEach((r) => {
      if (WB_chipOf(r) !== "message") return;
      if (pcId && String(r.client_id) === pcId) {
        pcMsgs += 1;
        if (r.waiting_since && (!pcOldest || String(r.waiting_since) < pcOldest)) pcOldest = String(r.waiting_since);
      }
      if (!r.waiting_since) return;
      if (!inboxOldest || String(r.waiting_since) < inboxOldest) inboxOldest = String(r.waiting_since);
    }),
  );
  const rightNow = WB_deskContext(
    { page, clientName: pageClient ? pageClient.name : "" },
    {
      counts: cc,
      qbo: !!(pageClient && pageClient.qbo),
      syncedAt: pageClient ? pageClient.lastSyncedAt || null : null,
      staleHours: pageClient ? pageClient.staleHours : null,
      ago,
      now,
      inbox: { count: allView.counts.all, messages: allView.counts.message, oldestAt: inboxOldest },
      deskMessages: { count: pcMsgs, oldestAt: pcOldest },
    },
  );
  const glanceAny = WB_GLANCE_IDS.some((id) => railCounts[id] > 0);
  const deskExtras = open && !taskView ? WB_deskFill({ tier: WB_deskTier(winH), ctx: { glance: glanceAny, rightNow: !!rightNow } }) : [];
  // Decision 28 (each fact in one place): while the open Desk's "Right now"
  // card shows this client, the bar's page client line steps aside.
  const barClientLine = clientLine && !(rightNow && rightNow.kind === "client" && deskExtras.indexOf("rightNow") >= 0) ? clientLine : null;
  const onRightNowGo = (go) => {
    WB_track("wb-rightnow", go);
    if (go === "client") {
      WB_store.setHub({ tab: "client" });
      return;
    }
    if (go === "messages") {
      if (WB__openChat(chatClientId || null)) return;
      WB_store.setHub({ tab: "inbox", chip: "message" });
    }
  };
  const onGlancePick = (id) => {
    WB_track("wb-glance", id);
    if (id === "mention") {
      onRailPick(id);
      return;
    }
    // Messages, reviews and files filter the Desk's own inbox (it is open).
    WB_store.setHub({ tab: "inbox", chip: id });
  };

  const empty = !loading && progress.empty && !next;
  const barSummary = [
    loading ? "Loading" : "",
    progress.lateText,
    progress.todayText,
    next ? "Next up: " + next.title + (next.client_name ? " for " + next.client_name : "") : "",
    empty ? "Clean slate" : "",
    barClientLine ? barClientLine.name + (barClientLine.parts.length ? ": " + barClientLine.parts.map((p) => p.text).join(", ") : "") : "",
  ]
    .filter(Boolean)
    .join(". ");

  const desk = (
    <>
      {!isWin && <button
        ref={barRef}
        type="button"
        className={"wb-bar wb-infobar" + (open ? " is-open" : "") + (progress.late ? " has-late" : "")}
        onClick={() => {
          const willOpen = !WB_store.getState().drawerOpen;
          WB_store.setDrawerOpen(willOpen, "bar");
          if (willOpen) WB_track("wb-drawer", "bar");
        }}
        aria-expanded={open}
        {...(sheet ? { "aria-haspopup": "dialog" } : {})}
        {...(open ? { "aria-controls": "wb-panel" } : {})}
        aria-label={(open ? "Close " : "Open ") + WB_NAME + (barSummary ? ". " + barSummary : "")}
        data-tour="wb-bar"
      >
        <span className="wb-bar-work">
          {loading ? (
            <span className="wb-bar-today">…</span>
          ) : empty ? (
            <span className="wb-bar-clean">Clean slate</span>
          ) : (
            <>
              {progress.lateText && <span className="wb-bar-late">{progress.lateText}</span>}
              {progress.todayText && <span className="wb-bar-today">{progress.todayText}</span>}
            </>
          )}
        </span>
        {next && (
          <span className="wb-bar-next">
            <span className="wb-bar-label">Next up</span> <span className="wb-bar-next-title">{next.title}</span>
            {next.client_name && <span className="wb-bar-next-client"> · {next.client_name}</span>}
          </span>
        )}
        {barClientLine && (
          <span className="wb-bar-client">
            <span className="wb-bar-client-name">{barClientLine.name}</span>
            {barClientLine.parts.map((p) => (
              <span key={p.key} className={"wb-bar-client-part" + (p.bad ? " is-bad" : "")}>
                {p.text}
              </span>
            ))}
          </span>
        )}
        <span className="wb-bar-hint" aria-hidden="true">
          <kbd className="wb-bar-kbd">D</kbd> {open ? "to close" : "to open"}
        </span>
      </button>}
      {!isWin && !sheet && !open && (
        <div ref={railRef} className="wb-rail-wrap">
          <WB_DeskRail
            counts={railCounts}
            lines={railLines}
            unread={!!messagesUnread}
            quickClient={pageClient ? { id: pageClient.id, name: pageClient.name } : null}
            onPick={onRailPick}
            onOpen={() => openTo(null, "rail")}
          />
        </div>
      )}
      {open && (
        <WB_Hub
          s={s}
          me={me}
          isAdmin={isAdmin}
          clients={clients}
          panelRef={panelRef}
          view={view}
          allView={allView}
          chip={chip}
          today={today}
          now={now}
          count={count}
          loading={loading}
          currentClientId={currentClientId}
          page={page}
          mode={mode}
          layout={isWin ? "window" : layout.mode}
          handle={isWin ? null : handle}
          variant={variant}
          deskMenu={!isWin && s.appOn && !sheet && typeof WB_DeskMenu === "function" ? <WB_DeskMenu /> : null}
          drill={drillStack}
          deskRef={deskRef}
          onDrillStep={drillStep}
          onCloseTask={closeTask}
          staffUser={staffUser}
          canManageTemplates={canManageTemplates}
          canCreateTemplates={canCreateTemplates}
          onOpenTemplates={onOpenTemplates}
          glance={railCounts}
          extras={deskExtras}
          onGlancePick={onGlancePick}
          rightNow={rightNow}
          onRightNowGo={onRightNowGo}
        />
      )}
    </>
  );

  return (
    <>
      {host === undefined && !isWin ? null : host && typeof ReactDOM !== "undefined" && ReactDOM.createPortal ? ReactDOM.createPortal(desk, host) : desk}
      <WB_UndoBar />
    </>
  );
}
