// ----------------------------------------------------------------------------
// WB_Hub: the open Workbench panel (Workbench Hub spec, slice H1).
//
// The panel is a hub: tabs (Inbox now; My tasks and Client arrive in later
// slices), the Inbox list with its filter chips, and the stack protocol that
// lets a task drawer, the client drawer, the chat drawer or a dialog sit on
// top of it without the page underneath changing.
//
//   WB_useHubKeys     W / Esc / Tab for the hub. Checks at keydown time (window
//                     capture, before any other handler) whether a layer is
//                     above the hub; if so the hub does nothing, so one Esc
//                     closes exactly one layer and Tab stays in the top layer.
//   WB_useHubLayers   html.wb-hub-open (lifts the chat drawer above the panel),
//                     html.wb-stacked (hub scrim stops taking clicks while a
//                     drawer is over it) and the focus return when the stacked
//                     drawer closes. A body-level MutationObserver runs only
//                     while the hub is open.
//   WB_Hub            the panel itself. WB_Drawer keeps the bar.
//
// Pure rules (layers, state, row actions) live in WB_logic.js; state lives in
// WB_store (saved in mgb_wb_hub). Browser file; loads after WB_Drawer.jsx.
// ----------------------------------------------------------------------------

function WB__has(sel) {
  try {
    return !!document.querySelector(sel);
  } catch (e) {
    return false;
  }
}

function WB_useHubKeys(live, panelRef) {
  React.useEffect(() => {
    if (!live) return undefined;
    const onKey = (e) => {
      const isW = e.key === "w" || e.key === "W";
      if (e.key !== "Escape" && e.key !== "Tab" && !isW) return;
      const open = WB_store.getState().drawerOpen;
      if (!isW && !open) return;
      // A layer above the hub (task drawer, client drawer, chat drawer, a
      // dialog, a tour, a row's menu) gets the key first.
      const present = WB_layersPresent(WB__has);
      if (e.key === "Tab") {
        // A row's menu sits inside the panel, so Tab stays trapped; only a
        // drawer, dialog or tour above takes Tab over.
        if (WB_isStacked(present) || present.indexOf("tour") >= 0) return;
      } else if (WB_layerAbove(present)) return;
      const panel = panelRef.current;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        WB_store.setDrawerOpen(false);
        return;
      }
      if (e.key === "Tab") {
        // Keep Tab inside the open panel (it is a modal dialog).
        if (!panel) return;
        const f = Array.prototype.filter.call(
          panel.querySelectorAll('button:not([disabled]), a[href], [tabindex="0"], input, select, textarea'),
          (el) => el.offsetParent !== null,
        );
        if (!f.length) return;
        const firstEl = f[0];
        const lastEl = f[f.length - 1];
        const inside = panel.contains(document.activeElement);
        if (e.shiftKey && (document.activeElement === firstEl || !inside)) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && (document.activeElement === lastEl || !inside)) {
          e.preventDefault();
          firstEl.focus();
        }
        return;
      }
      const inPanel = panel && e.target && panel.contains(e.target);
      if (!inPanel && WB_keyBlocked(e)) return;
      if (inPanel && e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName || "")) return;
      e.preventDefault();
      const willOpen = !open;
      WB_store.setDrawerOpen(willOpen);
      if (willOpen) WB_track("wb-drawer", "key");
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [live]);
}

function WB_useHubLayers(open, panelRef) {
  React.useEffect(() => {
    if (!open) return undefined;
    const root = document.documentElement;
    root.classList.add("wb-hub-open");
    let was = false;
    let timer = null;
    const giveFocusBack = () => {
      const panel = panelRef.current;
      if (!panel) return;
      const ae = document.activeElement;
      if (ae && ae !== document.body && panel.contains(ae)) return; // the drawer already put it back
      const key = WB_store.getState().hub.lastFocus;
      let el = null;
      if (key) {
        const rows = panel.querySelectorAll("[data-wb-key]");
        for (let i = 0; i < rows.length && !el; i++) if (rows[i].getAttribute("data-wb-key") === key) el = rows[i];
      }
      if (!el) el = panel.querySelector(".wb-row[tabindex='0']") || panel.querySelector('[role="tab"][aria-selected="true"]') || panel.querySelector(".wb-tab.is-on") || panel;
      if (el && typeof el.focus === "function") el.focus();
    };
    const check = () => {
      const stacked = WB_isStacked(WB_layersPresent(WB__has));
      root.classList.toggle("wb-stacked", stacked);
      if (was && !stacked) {
        clearTimeout(timer);
        timer = setTimeout(giveFocusBack, 0); // after the drawer's own focus restore
      }
      was = stacked;
    };
    const mo = typeof MutationObserver === "function" ? new MutationObserver(check) : null;
    if (mo) mo.observe(document.body, { childList: true });
    check();
    return () => {
      if (mo) mo.disconnect();
      clearTimeout(timer);
      root.classList.remove("wb-hub-open", "wb-stacked");
    };
  }, [open]);
}

// Tab row (ARIA tabs). Renders nothing while only one tab is live.
function WB_HubTabs({ tab, onPick, counts }) {
  const live = WB_HUB_TABS.filter((t) => t.live);
  if (live.length < 2) return null;
  const ids = live.map((t) => t.id);
  const onKeyDown = (e) => {
    const next = WB_tabMove(ids, tab, e.key);
    if (!next) return;
    e.preventDefault();
    onPick(next);
    const el = document.getElementById("wb-hub-tab-" + next);
    if (el) el.focus();
  };
  return (
    <div className="wb-hub-tabs" role="tablist" aria-label={WB_NAME + " sections"} onKeyDown={onKeyDown}>
      {live.map((t) => (
        <button
          key={t.id}
          id={"wb-hub-tab-" + t.id}
          type="button"
          role="tab"
          aria-selected={tab === t.id}
          aria-controls={"wb-hub-pane-" + t.id}
          tabIndex={tab === t.id ? 0 : -1}
          className={"wb-hub-tab" + (tab === t.id ? " is-on" : "")}
          onClick={() => onPick(t.id)}
        >
          {t.label}
          {counts && counts[t.id] != null && <span className="wb-chip-n">{counts[t.id]}</span>}
        </button>
      ))}
    </div>
  );
}

// props: s (store state), isAdmin, panelRef, allView, view, chip, today, now,
// count, loading.
function WB_Hub({ s, isAdmin, panelRef, view, allView, chip, today, now, count, loading }) {
  const hub = s.hub;
  const tab = hub.tab;
  const bodyRef = React.useRef(null);
  const restored = React.useRef(null);
  const tabbed = WB_HUB_TABS.filter((t) => t.live).length > 1;

  const setChip = (id) => {
    WB_store.setHub({ chip: id });
    WB_track("wb-filter", "drawer:" + id);
  };
  const setTab = (id) => {
    if (id === tab) return;
    WB_store.setHub({ tab: id });
    WB_track("wb-filter", "hub:" + id);
  };

  // Restore the pane's scroll once its rows are on screen, then save it as
  // it moves (silent: no re-render; the store throttles the write).
  React.useEffect(() => {
    if (loading) return;
    if (restored.current === tab) return;
    restored.current = tab;
    const el = bodyRef.current;
    if (el) el.scrollTop = hub.scroll[tab] || 0;
  }, [tab, loading]);
  const onScroll = (e) => {
    if (restored.current !== tab) return;
    WB_store.setHub({ scroll: { [tab]: e.currentTarget.scrollTop } }, true);
  };

  return (
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
        <WB_HubTabs tab={tab} onPick={setTab} counts={{ inbox: count }} />
        <div className="wb-panel-tools">
          <div className="wb-tabs wb-hub-chips" role="group" aria-label="Filter">
            {WB_DRAWER_TABS.map((t) => (
              <button key={t.id} type="button" aria-pressed={chip === t.id} className={"wb-tab" + (chip === t.id ? " is-on" : "")} onClick={() => setChip(t.id)}>
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
        <div
          ref={bodyRef}
          className="wb-panel-body"
          onScroll={onScroll}
          {...(tabbed ? { role: "tabpanel", id: "wb-hub-pane-" + tab, "aria-labelledby": "wb-hub-tab-" + tab } : {})}
        >
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
              hub
              showOwner={s.scope === "everyone"}
              listId="wb-dl"
              onChip={(c) => setChip(WB_DRAWER_TABS.some((t) => t.id === c) ? c : "all")}
            />
          )}
          {view.later > 0 && (
            <p className="wb-later">
              {view.later} more later · <a href="#/tasks">My Tasks</a>
            </p>
          )}
        </div>
        <p className="wb-panel-foot">
          <kbd>W</kbd> opens and closes · <kbd>Esc</kbd> closes one layer at a time
        </p>
      </div>
    </>
  );
}
