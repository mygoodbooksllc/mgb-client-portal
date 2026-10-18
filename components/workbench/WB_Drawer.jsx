// ----------------------------------------------------------------------------
// WB_Drawer: the Desk (was Workbench) at the bottom of every staff page (spec
// addendum 2026-10-16, owner approved; Desk spec D3 2026-10-17).
//
// The open panel is WB_Hub (WB_Hub.jsx): tabs (Inbox, Slate, Client), stack
// protocol, saved state. `clients` (the staff member's client list) gives the
// Slate rows their client names.
//
// Collapsed: a 44px glass bar, centered right of the left nav (--desk-max-w
// wide), above the phone's safe area, with the count, the next item and
// "Press D".
// Open, desktop and tablet ("dock", wider than 760px): the panel rises from
// the bar, the same width, with NO scrim. It is non-modal: the page behind
// stays scrollable and clickable, and gets bottom padding equal to the Desk
// height (--desk-pad) so its end is reachable. The top edge is a resize
// handle (role=separator): drag it, or focus it and use the arrow keys, Home
// and End, to snap between strip (one row), medium and tall. A drag up on the
// closed bar opens it at that height. The height (a snap name) is saved per
// person in mgb_wb_desk:<email>.
// Open, phones (760px and under, "sheet"): the full-height modal sheet as
// before (aria-modal, Tab kept inside, page scroll locked), no handle.
// D toggles it (never while typing, in a dialog, a menu or a tour, or with a
// modifier); Esc, with focus inside the Desk, goes back one step. Same store
// and wb_inbox call as the page.
//
// The bar and panel are portaled into a div at the end of .app-shell (after
// .main), so the Tab order runs page, bar, Desk, then out to the browser,
// and they stay inside the shell's stacking context: modals (2000), the Undo
// bar (2050) and everything portaled to <body> (drawers, tips, the tour)
// layer above them. The docked Desk also sits under the sticky top bar (700)
// so its menus drop over it; the phone sheet stays high (WB.css).
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

// The room the Desk can grow into: from the bottom of the sticky staff tool
// bar (top) to the top of the Desk bar. Both are measured, so the safe areas
// and a preview bar are already counted.
function WB__deskRoom(bar) {
  let top = 0;
  try {
    const tb = document.querySelector(".tb-bar");
    if (tb) {
      const r = tb.getBoundingClientRect();
      if (r.height > 0) top = Math.max(0, Math.round(r.bottom));
    }
  } catch (e) {}
  let bottom = (window.innerHeight || 0) - 44;
  if (bar) {
    const r = bar.getBoundingClientRect();
    if (r.height > 0) bottom = r.top;
  }
  return { room: Math.max(0, Math.round(bottom - top)), top };
}

// Takes the Desk's height, page padding and lift off <html>, with its classes.
function WB__deskClearVars() {
  try {
    const el = document.documentElement;
    ["--desk-h", "--desk-pad", "--desk-lift", "--desk-top"].forEach((k) => el.style.removeProperty(k));
    el.classList.remove("wb-desk-strip", "wb-desk-dragging");
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

// Stacked layers and the tour: focus inside them is not "the page" and not
// "the Desk" (WB_deskFocusZone ignores it).
var WB_DESK_LAYER_SEL = WB_LAYERS.filter(function (l) {
  return l.stacked || l.id === "tour";
})
  .map(function (l) {
    return l.sel;
  })
  .join(", ");

function WB_Drawer({ me, isAdmin, clients, currentClientId, page }) {
  const on = WB_useSwitch();
  const s = WB_useStore(me, isAdmin, on);
  const open = s.drawerOpen;
  const panelRef = React.useRef(null);
  const barRef = React.useRef(null);
  const live = on && s.status !== "missing" && !!me;
  const mode = WB_useDeskMode();
  // Shared with WB_useHubKeys / WB_useHubLayers: the mode, where focus is,
  // and the drag (so Esc can cancel it).
  const deskRef = React.useRef({ mode: mode, zone: "page", dragging: false, cancel: null });
  deskRef.current.mode = mode;
  // Where the bar and panel render: undefined until the first layout pass
  // (nothing yet, before paint), then the div at the end of .app-shell, or
  // null to render in place.
  const [host, setHost] = React.useState(undefined);
  React.useLayoutEffect(() => {
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
  const next = WB_nextRow(allView);
  const count = allView.counts.all;

  // Room for the bar at the bottom of the page, and where it starts: the
  // bar and the open panel sit in the content area, beside the left nav
  // (--wb-bar-left, measured from the staff rail so it follows the rail
  // collapsing or expanding; 0 on phones, where the nav is off-canvas).
  React.useEffect(() => {
    const el = document.documentElement;
    el.classList.toggle("wb-drawer-on", live);
    if (!live) {
      el.style.removeProperty("--wb-bar-left");
      return () => el.classList.remove("wb-drawer-on");
    }
    let last = null;
    let watched = null;
    let ro = null;
    const measure = () => {
      const rail = document.querySelector(".staff-rail");
      if (rail !== watched) {
        if (ro) ro.disconnect();
        watched = rail;
        if (rail && typeof ResizeObserver === "function") {
          ro = new ResizeObserver(measure);
          ro.observe(rail);
        }
      }
      const rails = rail ? [rail.getBoundingClientRect()] : [];
      const left = WB_barLeft(rails, window.innerWidth);
      if (left !== last) {
        last = left;
        el.style.setProperty("--wb-bar-left", left + "px");
      }
    };
    measure();
    window.addEventListener("resize", measure);
    const id = setInterval(measure, 600); // the rail can mount or change late
    return () => {
      window.removeEventListener("resize", measure);
      clearInterval(id);
      if (ro) ro.disconnect();
      el.classList.remove("wb-drawer-on");
      el.style.removeProperty("--wb-bar-left");
    };
  }, [live]);

  // ---- D3: height. The room is re-measured on open, on window resize
  // (rAF-throttled) and once a second while open (a banner can appear); the
  // snap name stays, so a smaller window re-clamps by itself.
  const [room, setRoom] = React.useState(() => (typeof window !== "undefined" ? Math.max(0, (window.innerHeight || 0) - 120) : 600));
  const [top, setTop] = React.useState(0);
  const roomRef = React.useRef(room);
  roomRef.current = room;
  React.useEffect(() => {
    if (!live || !open) return undefined;
    let raf = 0;
    const measure = () => {
      raf = 0;
      const m = WB__deskRoom(barRef.current);
      setRoom(m.room);
      setTop(m.top);
    };
    const later = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("resize", later);
    const id = setInterval(later, 1000);
    return () => {
      window.removeEventListener("resize", later);
      clearInterval(id);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [live, open]);
  const snap = s.desk ? s.desk.snap : "medium";
  const points = WB_deskPoints(room);
  const h = WB_deskClamp(WB_deskHeight(snap, points), room);
  const dock = mode === "dock";
  const [commits, setCommits] = React.useState(0); // re-run the write below after a drag ends

  // --desk-h / --desk-pad / --desk-lift / --desk-top on <html> (WB.css reads
  // them), and html.wb-desk-strip at strip height. Skipped mid-drag: the
  // drag's paint writes the height, padding and lift itself.
  React.useLayoutEffect(() => {
    const el = document.documentElement;
    if (!live) {
      // The Desk switched off (or the store went missing): nothing may keep
      // padding the page or lifting the toasts.
      WB__deskClearVars();
      return undefined;
    }
    el.style.setProperty("--desk-top", top + "px");
    if (!deskRef.current.dragging) {
      const pad = WB_deskPagePad({ open, mode, h });
      el.style.setProperty("--desk-pad", pad.pad + "px");
      el.style.setProperty("--desk-lift", pad.lift + "px");
      el.style.setProperty("--desk-h", h + "px");
      el.classList.toggle("wb-desk-strip", open && dock && h < WB_DESK_STRIP + 30);
    }
    return undefined;
  }, [live, open, mode, h, top, commits]);
  // ---- D3: drag. Pointer Events (mouse, touch and pen share one path) with
  // pointer capture; the height is written straight to --desk-h in a rAF (no
  // React render mid-drag); the release snaps with the last 80 ms of speed.
  const drag = React.useRef(null);
  // Drops a drag without committing or touching the store (unmount, or the
  // Desk switching off mid-drag): the queued paint is cancelled.
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
  // The page padding and the toasts' lift follow the height mid-drag too, so
  // the page end stays reachable and nothing hides behind the Desk.
  const paint = (hh) => {
    const el = document.documentElement;
    el.style.setProperty("--desk-h", hh + "px");
    el.classList.toggle("wb-desk-strip", hh < WB_DESK_STRIP + 30);
    const pad = WB_deskPagePad({ open: true, mode: "dock", h: hh });
    el.style.setProperty("--desk-pad", pad.pad + "px");
    el.style.setProperty("--desk-lift", pad.lift + "px");
  };
  const stamp = (e) => (e && e.timeStamp ? e.timeStamp : typeof performance !== "undefined" ? performance.now() : Date.now());
  const beginDrag = (e, el, startH, fromBar) => {
    // Measure now: a drag from the closed bar starts before the open measure.
    const m = WB__deskRoom(barRef.current);
    roomRef.current = m.room;
    setRoom(m.room);
    setTop(m.top);
    const first = WB_deskClamp(startH, m.room);
    drag.current = { id: e.pointerId, el, startY: e.clientY, startH, h: first, fromBar, samples: [{ t: stamp(e), h: first }], raf: 0 };
    try {
      el.setPointerCapture(e.pointerId);
    } catch (err) {}
    document.documentElement.classList.add("wb-desk-dragging");
    deskRef.current.dragging = true;
    paint(first);
  };
  const moveDrag = (e) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    const hh = WB_deskClamp(d.startH + (d.startY - e.clientY), roomRef.current);
    const t = stamp(e);
    d.h = hh;
    d.samples.push({ t, h: hh });
    while (d.samples.length > 2 && t - d.samples[0].t > 80) d.samples.shift();
    if (!d.raf) {
      d.raf = requestAnimationFrame(() => {
        d.raf = 0;
        if (drag.current === d) paint(d.h);
      });
    }
  };
  const endDrag = (commit) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    if (d.raf) cancelAnimationFrame(d.raf);
    try {
      if (d.el.hasPointerCapture && d.el.hasPointerCapture(d.id)) d.el.releasePointerCapture(d.id);
    } catch (err) {}
    document.documentElement.classList.remove("wb-desk-dragging");
    deskRef.current.dragging = false;
    if (!commit) {
      // Esc: put the start height back (a drag that opened the Desk closes it).
      // The press is over too, so the next pointer move cannot start the
      // drag again and the release cannot click the bar open.
      if (press.current) press.current.done = true;
      if (d.fromBar) WB_store.setDrawerOpen(false);
      setCommits((n) => n + 1);
      return;
    }
    const a = d.samples[0];
    const b = d.samples[d.samples.length - 1];
    const dt = b.t - a.t;
    const vy = dt > 0 ? (b.h - a.h) / dt : 0;
    const to = WB_deskSnap(d.h, vy, WB_deskPoints(roomRef.current));
    WB_store.setDeskSnap(to);
    setCommits((n) => n + 1);
    WB_track("wb-resize", "drag:" + to);
  };
  deskRef.current.cancel = () => endDrag(false);

  const handle = {
    show: dock && !points.merged,
    pct: WB_deskPct(h, room),
    valueText: WB_deskValueText(snap),
    onPointerDown: (e) => {
      if (e.button !== 0 || e.isPrimary === false || drag.current) return;
      e.preventDefault(); // no text selection; focus the handle ourselves
      try {
        e.currentTarget.focus();
      } catch (err) {}
      beginDrag(e, e.currentTarget, h, false);
    },
    onPointerMove: moveDrag,
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
      if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].indexOf(e.key) < 0) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      e.preventDefault();
      e.stopPropagation();
      const to = WB_deskStep(snap, e.key, WB_deskPoints(roomRef.current));
      if (to === snap) return;
      WB_store.setDeskSnap(to);
      WB_track("wb-resize", "key:" + to);
    },
  };

  // The closed bar: a drag up of more than 12px opens the Desk and continues
  // as a drag (the panel's top follows the pointer); a click still toggles,
  // but never after a drag (movement over 6px swallows the click). Dock only.
  // A press ends (done) on pointerup, pointercancel or lost capture anywhere,
  // or on Esc; an ended press never starts a drag. It is kept only so the
  // click that follows its release can see `moved`; a keyboard click
  // (detail 0) ignores it.
  const press = React.useRef(null);
  const endPress = (e) => {
    const p = press.current;
    if (p && (!e || e.pointerId === p.id)) p.done = true;
  };
  React.useEffect(() => {
    if (!live || !dock) return undefined;
    window.addEventListener("pointerup", endPress, true);
    window.addEventListener("pointercancel", endPress, true);
    return () => {
      window.removeEventListener("pointerup", endPress, true);
      window.removeEventListener("pointercancel", endPress, true);
    };
  }, [live, dock]);
  const barEvents = dock
    ? {
        onPointerDown: (e) => {
          if (e.button !== 0 || e.isPrimary === false) return;
          press.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false, done: false, wasOpen: WB_store.getState().drawerOpen };
        },
        onPointerMove: (e) => {
          if (drag.current) {
            moveDrag(e);
            return;
          }
          const p = press.current;
          if (!p || p.done || p.id !== e.pointerId) return;
          // A mouse with no button down: the release happened somewhere we
          // did not hear it, so the press is over.
          if (e.pointerType === "mouse" && e.buttons === 0) {
            p.done = true;
            return;
          }
          const dy = p.y - e.clientY;
          if (Math.abs(dy) > 6 || Math.abs(e.clientX - p.x) > 6) p.moved = true;
          if (p.wasOpen || dy <= 12 || !barRef.current) return;
          const barTop = barRef.current.getBoundingClientRect().top;
          beginDrag(e, barRef.current, barTop - e.clientY, true);
          WB_store.setDrawerOpen(true, "drag");
          WB_track("wb-drawer", "drag");
        },
        onPointerUp: (e) => {
          if (drag.current && e.pointerId === drag.current.id) endDrag(true);
        },
        onPointerCancel: (e) => {
          if (drag.current && e.pointerId === drag.current.id) endDrag(true);
          endPress(e);
        },
        onLostPointerCapture: (e) => {
          if (drag.current && e.pointerId === drag.current.id) endDrag(true);
          endPress(e);
        },
      }
    : {};

  // Where focus is (spec 4.2): inside the Desk, on its bar, or on the page.
  // Focus inside a stacked drawer, a dialog or the tour does not count, so
  // "where it was before the layer opened" survives the layer. A click on a
  // non-focusable part of the page counts as the page.
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
      const z = WB_deskFocusZone({ inLayer, inPanel: !!(panel && panel.contains(t)), onBar: !!(bar && bar.contains(t)) });
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

  // Open by the bar, D or a drag: focus moves into the Desk. A page-load
  // reopen (openedBy "restore") and a launch tour opening it ("tour") leave
  // focus where it is. Close: focus goes to the bar only if it was inside the
  // Desk (always, on the phone sheet).
  const wasOpen = React.useRef(false);
  React.useEffect(() => {
    if (open && !wasOpen.current) {
      if (Date.now() - s.at > 20000) WB_store.refresh();
      const by = WB_store.getState().openedBy;
      if (by !== "restore" && by !== "tour") {
        setTimeout(() => {
          const first = panelRef.current && WB_hubFocusTarget(panelRef.current, null);
          if (first) first.focus();
        }, 30);
      }
    } else if (!open && wasOpen.current) {
      if (drag.current) endDrag(false);
      const where = mode === "sheet" ? "bar" : WB_deskCloseFocus(deskRef.current.zone);
      if (where === "bar" && barRef.current) barRef.current.focus();
    }
    wasOpen.current = open;
  }, [open]);

  // Leaving the page (a deep link) closes the drawer.
  React.useEffect(() => {
    if (!open) return undefined;
    const onHash = () => WB_store.setDrawerOpen(false);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [open]);

  if (!live) return null;

  const loading = !s.at && (s.status === "loading" || s.status === "idle");

  const desk = (
    <>
      <button
        ref={barRef}
        type="button"
        className={"wb-bar" + (allView.badge ? " has-due" : "") + (open ? " is-open" : "")}
        onClick={(e) => {
          const p = press.current;
          press.current = null;
          // The end of a drag, not a click. Enter / Space (detail 0) always toggle.
          if (e.detail !== 0 && p && p.moved) return;
          const willOpen = !WB_store.getState().drawerOpen;
          WB_store.setDrawerOpen(willOpen, "bar");
          if (willOpen) WB_track("wb-drawer", "bar");
        }}
        {...barEvents}
        aria-expanded={open}
        {...(dock ? {} : { "aria-haspopup": "dialog" })}
        {...(open ? { "aria-controls": "wb-panel" } : {})}
        aria-label={(open ? "Close " : "Open ") + WB_NAME + ", " + count + " item" + (count === 1 ? "" : "s")}
        data-tour="wb-bar"
      >
        <span className="wb-bar-name">{WB_NAME}</span>
        <span className="wb-bar-count">{loading ? "…" : count}</span>
        <span className="wb-bar-next">{next ? next.title : loading ? "" : "Clean slate"}</span>
        <span className="wb-bar-hint" aria-hidden="true">
          {open ? (
            <>
              Press <kbd className="wb-bar-kbd">D</kbd> to close <span className="wb-bar-chev">&#9660;</span>
            </>
          ) : (
            <>
              Press <kbd className="wb-bar-kbd">D</kbd> <span className="wb-bar-chev">&#9650;</span>
            </>
          )}
        </span>
      </button>
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
          handle={handle}
        />
      )}
    </>
  );

  return (
    <>
      {host === undefined ? null : host && typeof ReactDOM !== "undefined" && ReactDOM.createPortal ? ReactDOM.createPortal(desk, host) : desk}
      <WB_UndoBar />
    </>
  );
}
