// ----------------------------------------------------------------------------
// WB_Drawer: Workbench as a bottom drawer on every staff page (spec addendum
// 2026-10-16, owner approved).
//
// Collapsed: a 44px bar across the whole bottom of the content area (beside
// the left nav, above the phone's safe area) with the count, the next item
// and "Press W".
// Open: the panel rises from the bar, the full width of the content area,
// with a scrim; tabs All / Tasks / Reviews
// / Messages / Files; Mine / Everyone for admins; rows grouped Overdue /
// Today / This week with one quick action each. Phones get a full-height
// sheet. W toggles it (never while typing, in a dialog, a menu or a tour);
// Esc closes it. Same store and wb_inbox call as the page.
//
// app.jsx mounts it for a signed-in staff member who isn't viewing as
// someone or previewing; it renders nothing while Workbench is off.
// ----------------------------------------------------------------------------

function WB_Drawer({ me, isAdmin }) {
  const on = WB_useSwitch();
  const s = WB_useStore(me, isAdmin, on);
  const open = s.drawerOpen;
  const [tab, setTab] = React.useState("all");
  const panelRef = React.useRef(null);
  const barRef = React.useRef(null);
  const live = on && s.status !== "missing" && !!me;
  // Regroup every 30 s so Overdue / Today and "waited" times stay current.
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    if (!live) return undefined;
    const id = setInterval(() => setTick((n) => n + 1), 30000);
    return () => clearInterval(id);
  }, [live]);

  const now = Date.now();
  const today = WB_today(now);
  const chip = WB_drawerChip(tab);
  const view = React.useMemo(() => WB_build(s.rows, { today, now, chip }), [s.rows, today, chip, open, tick]);
  const allView = React.useMemo(() => (chip === "all" ? view : WB_build(s.rows, { today, now, chip: "all" })), [view, s.rows, today, chip, tick]);
  const next = WB_nextRow(allView);
  const count = allView.counts.all;

  // Room for the bar at the bottom of the page, and where it starts: the
  // bar and the open panel span the content area, beside the left nav
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

  // W toggles; Esc closes.
  React.useEffect(() => {
    if (!live) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape" && WB_store.getState().drawerOpen) {
        if (document.querySelector(".wb-menu")) return; // the row's menu closes first
        e.preventDefault();
        WB_store.setDrawerOpen(false);
        return;
      }
      if (e.key === "Tab" && WB_store.getState().drawerOpen && panelRef.current) {
        // Keep Tab inside the open panel (it is a modal dialog).
        const f = Array.prototype.filter.call(
          panelRef.current.querySelectorAll('button:not([disabled]), a[href], [tabindex="0"], input, select, textarea'),
          (el) => el.offsetParent !== null,
        );
        if (!f.length) return;
        const firstEl = f[0];
        const lastEl = f[f.length - 1];
        const inside = panelRef.current.contains(document.activeElement);
        if (e.shiftKey && (document.activeElement === firstEl || !inside)) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && (document.activeElement === lastEl || !inside)) {
          e.preventDefault();
          firstEl.focus();
        }
        return;
      }
      if (e.key !== "w" && e.key !== "W") return;
      if (WB_store.getState().drawerOpen && document.querySelector(".wb-menu")) return; // a row's menu is open
      const inPanel = panelRef.current && e.target && panelRef.current.contains(e.target);
      if (!inPanel && WB_keyBlocked(e)) return;
      if (inPanel && e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName || "")) return;
      e.preventDefault();
      const willOpen = !WB_store.getState().drawerOpen;
      WB_store.setDrawerOpen(willOpen);
      if (willOpen) WB_track("wb-drawer", "key");
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [live]);

  // Focus moves into the panel on open and back to the bar on close.
  const wasOpen = React.useRef(false);
  React.useEffect(() => {
    if (open && !wasOpen.current) {
      if (Date.now() - s.at > 20000) WB_store.refresh();
      setTimeout(() => {
        const first = panelRef.current && (panelRef.current.querySelector(".wb-row[tabindex='0']") || panelRef.current);
        if (first) first.focus();
      }, 30);
    } else if (!open && wasOpen.current) {
      if (barRef.current && panelRef.current && panelRef.current.contains(document.activeElement)) barRef.current.focus();
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

  const setTabTracked = (id) => {
    setTab(id);
    WB_track("wb-filter", "drawer:" + id);
  };
  const loading = !s.at && (s.status === "loading" || s.status === "idle");

  return (
    <>
      {!open && (
        <button
          ref={barRef}
          type="button"
          className={"wb-bar" + (allView.badge ? " has-due" : "")}
          onClick={() => {
            WB_store.setDrawerOpen(true);
            WB_track("wb-drawer", "bar");
          }}
          aria-label={"Open " + WB_NAME + ", " + count + " item" + (count === 1 ? "" : "s")}
          data-tour="wb-bar"
        >
          <span className="wb-bar-name">{WB_NAME}</span>
          <span className="wb-bar-count">{loading ? "…" : count}</span>
          <span className="wb-bar-next">{next ? next.title : loading ? "" : "All clear"}</span>
          <span className="wb-bar-hint" aria-hidden="true">
            Press <kbd className="wb-bar-kbd">W</kbd>
          </span>
        </button>
      )}
      {open && (
        <>
          <div className="wb-scrim" onClick={() => WB_store.setDrawerOpen(false)} aria-hidden="true" />
          <div ref={panelRef} className="wb-panel" role="dialog" aria-modal="true" aria-labelledby="wb-panel-title" tabIndex={-1} data-tk-keyscope="drawer">
            <div className="wb-panel-head">
              <h2 className="wb-panel-title" id="wb-panel-title">
                {WB_NAME} <span className="wb-chip-n">{count}</span>
              </h2>
              {s.offline && <span className="wb-offline">Offline</span>}
              <a className="wb-panel-full" href="#/today" onClick={() => WB_store.setDrawerOpen(false)}>
                Full page
              </a>
              <button type="button" className="wb-icon-btn" aria-label={"Close " + WB_NAME} onClick={() => WB_store.setDrawerOpen(false)}>
                ×
              </button>
            </div>
            <div className="wb-panel-tools">
              <div className="wb-tabs" role="tablist" aria-label="Filter">
                {WB_DRAWER_TABS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    aria-selected={tab === t.id}
                    className={"wb-tab" + (tab === t.id ? " is-on" : "")}
                    onClick={() => setTabTracked(t.id)}
                  >
                    {t.label}
                    <span className="wb-chip-n">{allView.counts[t.id === "all" ? "all" : t.id]}</span>
                  </button>
                ))}
              </div>
              {isAdmin && (
                <div className="wb-scope" role="group" aria-label="Whose items">
                  {["mine", "everyone"].map((k) => (
                    <button key={k} type="button" className={"wb-scope-btn" + (s.scope === k ? " is-on" : "")} aria-pressed={s.scope === k} onClick={() => WB_store.setScope(k)}>
                      {k === "mine" ? "Mine" : "Everyone"}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="wb-panel-body">
              {s.error && (
                <div className="wb-error" role="alert">
                  <span>Couldn't refresh.</span>
                  <button type="button" className="btn-secondary" onClick={() => WB_store.refresh()}>
                    Retry
                  </button>
                </div>
              )}
              {loading ? (
                <ul className="wb-skeleton" aria-label="Loading" role="status">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <li key={i} className="wb-skel-row" />
                  ))}
                </ul>
              ) : view.visible === 0 ? (
                <p className="wb-filtered-empty" role="status">
                  {chip === "all" ? "Nothing needs you right now." : "Nothing here."}
                </p>
              ) : (
                <WB_List
                  view={view}
                  today={today}
                  now={now}
                  compact
                  showOwner={s.scope === "everyone"}
                  listId="wb-dl"
                  onChip={(c) => setTabTracked(WB_DRAWER_TABS.some((t) => t.id === c) ? c : "all")}
                />
              )}
              {view.later > 0 && (
                <p className="wb-later">
                  {view.later} more later · <a href="#/tasks">My Tasks</a>
                </p>
              )}
            </div>
            <p className="wb-panel-foot">
              <kbd>W</kbd> opens and closes · <kbd>Esc</kbd> closes
            </p>
          </div>
        </>
      )}
      <WB_UndoBar />
    </>
  );
}
