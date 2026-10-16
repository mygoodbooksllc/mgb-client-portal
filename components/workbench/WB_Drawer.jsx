// ----------------------------------------------------------------------------
// WB_Drawer: Workbench as a bottom drawer on every staff page (spec addendum
// 2026-10-16, owner approved).
//
// The open panel is WB_Hub (WB_Hub.jsx): tabs (Inbox, My tasks), stack
// protocol, saved state. `clients` (the staff member's client list) gives the
// My tasks rows their client names.
//
// Collapsed: a 44px bar across the whole bottom of the content area (beside
// the left nav, above the phone's safe area) with the count, the next item
// and "Press W".
// Open: the panel rises from the bar, the full width of the content area,
// with a scrim; filter chips All / Tasks / Reviews
// / Messages / Files (WB_Hub.jsx); Mine / Everyone for admins; rows grouped Overdue /
// Today / This week with one quick action each. Phones get a full-height
// sheet. W toggles it (never while typing, in a dialog, a menu or a tour);
// Esc closes one layer at a time. Same store and wb_inbox call as the page.
//
// app.jsx mounts it for a signed-in staff member who isn't viewing as
// someone or previewing; it renders nothing while Workbench is off.
// ----------------------------------------------------------------------------

function WB_Drawer({ me, isAdmin, clients }) {
  const on = WB_useSwitch();
  const s = WB_useStore(me, isAdmin, on);
  const open = s.drawerOpen;
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
  const chip = WB_drawerChip(s.hub.chip);
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

  // W toggles; Esc closes the top layer; Tab stays in it (WB_Hub.jsx).
  WB_useHubKeys(live, panelRef);
  WB_useHubLayers(open && live, panelRef);

  // Focus moves into the panel on open and back to the bar on close.
  const wasOpen = React.useRef(false);
  React.useEffect(() => {
    if (open && !wasOpen.current) {
      if (Date.now() - s.at > 20000) WB_store.refresh();
      setTimeout(() => {
        const first = panelRef.current && WB_hubFocusTarget(panelRef.current, null);
        if (first) first.focus();
      }, 30);
    } else if (!open && wasOpen.current) {
      if (barRef.current) barRef.current.focus();
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

  return (
    <>
      <button
        ref={barRef}
        type="button"
        className={"wb-bar" + (allView.badge ? " has-due" : "") + (open ? " is-open" : "")}
        onClick={() => {
          const willOpen = !WB_store.getState().drawerOpen;
          WB_store.setDrawerOpen(willOpen);
          if (willOpen) WB_track("wb-drawer", "bar");
        }}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={(open ? "Close " : "Open ") + WB_NAME + ", " + count + " item" + (count === 1 ? "" : "s")}
        data-tour="wb-bar"
      >
        <span className="wb-bar-name">{WB_NAME}</span>
        <span className="wb-bar-count">{loading ? "…" : count}</span>
        <span className="wb-bar-next">{next ? next.title : loading ? "" : "All clear"}</span>
        <span className="wb-bar-hint" aria-hidden="true">
          {open ? (
            <>
              Press <kbd className="wb-bar-kbd">W</kbd> to close <span className="wb-bar-chev">&#9660;</span>
            </>
          ) : (
            <>
              Press <kbd className="wb-bar-kbd">W</kbd> <span className="wb-bar-chev">&#9650;</span>
            </>
          )}
        </span>
      </button>
      {open && (
        <WB_Hub s={s} me={me} isAdmin={isAdmin} clients={clients} panelRef={panelRef} view={view} allView={allView} chip={chip} today={today} now={now} count={count} loading={loading} />
      )}
      <WB_UndoBar />
    </>
  );
}
