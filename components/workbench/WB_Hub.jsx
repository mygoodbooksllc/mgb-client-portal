// ----------------------------------------------------------------------------
// WB_Hub: the open Workbench panel (Workbench Hub spec, slice H1).
//
// The panel is a hub: tabs (Inbox, My tasks, Client), the Inbox list with its
// filter chips, the My tasks pane (WB_HubTasks.jsx), the Client pane
// (WB_HubClient.jsx), and the stack protocol that
// lets a task drawer, the client drawer, the chat drawer or a dialog sit on
// top of it without the page underneath changing.
//
//   WB_useHubKeys     D / Esc / Tab for the hub. Checks at keydown time (window
//                     capture, before any other handler) whether a layer is
//                     above the hub; if so the hub does nothing, so one Esc
//                     closes exactly one layer. The docked Desk (R1: the right
//                     column) is non-modal, so Esc acts only with focus inside
//                     it (WB_deskEscStep) and Tab is trapped only in the phone sheet.
//   WB_useHubLayers   html.wb-hub-open (lifts the chat drawer above the panel),
//                     html.wb-stacked (a drawer is over the hub) and the focus
//                     return when the stacked drawer closes, only if focus was
//                     inside the Desk. A body-level MutationObserver runs only
//                     while the hub is open.
//   WB_Hub            the panel itself, with the width grip on its left edge
//                     (dock only). WB_Drawer keeps the rail, the info bar, the
//                     width and the drag.
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

// deskRef.current (owned by WB_Drawer): { mode: "dock"|"sheet", zone:
// "desk"|"bar"|"page", dragging, cancel(), drillStep(step) (R2: "pop" |
// "list" | "close"), innerEsc() (R2: the task view's own Esc, the SOP panel;
// true when it ate the key) }.
function WB_useHubKeys(live, panelRef, deskRef) {
  React.useEffect(() => {
    if (!live) return undefined;
    const onKey = (e) => {
      const isD = WB_deskToggleKey(e);
      const isF6 = e.key === "F6" && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;
      if (e.key !== "Escape" && e.key !== "Tab" && !isD && !isF6) return;
      const st = WB_store.getState();
      const open = st.drawerOpen;
      if (!isD && !open) return;
      const dk = (deskRef && deskRef.current) || {};
      const sheet = dk.mode === "sheet";
      const panel = panelRef.current;
      const tgt = e.target;
      const inPanel = !!(panel && tgt && tgt.nodeType === 1 && panel.contains(tgt));
      // Esc while dragging the left edge puts the start width back.
      if (e.key === "Escape" && dk.dragging && typeof dk.cancel === "function") {
        e.preventDefault();
        e.stopPropagation();
        dk.cancel();
        return;
      }
      // A layer above the hub (task drawer, client drawer, chat drawer, a
      // dialog, a tour, a row's menu, the client picker list) gets the key first.
      const present = WB_layersPresent(WB__has);
      // F6 (spec 6, R1 leftover): between the page and the open Desk. A
      // layer above (a dialog, a drawer, the tour) keeps it.
      if (isF6) {
        // The phone sheet covers the page, so the page is not a place to go.
        if (sheet || WB_layerAbove(present)) return;
        const where = WB_deskF6Target({ open, zone: inPanel ? "desk" : "page" });
        if (!where) return;
        e.preventDefault();
        e.stopPropagation();
        if (where === "desk") {
          const tv = panel && panel.querySelector(".wb-taskview");
          const el = tv || (panel && WB_hubFocusTarget(panel, st.hub.lastFocus));
          if (el && typeof el.focus === "function") el.focus();
        } else {
          const main = document.querySelector("main, .main");
          if (main) {
            if (!main.hasAttribute("tabindex")) main.setAttribute("tabindex", "-1");
            main.focus();
          }
        }
        return;
      }
      if (e.key === "Tab") {
        // Only the phone sheet is modal and keeps Tab inside; the docked Desk
        // is part of the page's Tab order (page, bar, Desk, browser).
        if (!sheet || !panel) return;
        // A row's menu sits inside the panel, so Tab stays trapped; only a
        // drawer, dialog or tour above takes Tab over.
        if (WB_isStacked(present) || present.indexOf("tour") >= 0) return;
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
      if (e.key === "Escape") {
        // The dock: Esc is the Desk's only while focus is inside it; with focus
        // on the page it belongs to the page. The sheet covers the page, so a
        // lost focus (body) and focus on the bar (just below the sheet, still
        // reachable) count as inside.
        const onBody = !tgt || tgt === document.body || tgt === document.documentElement;
        let onBar = false;
        try {
          onBar = !!(tgt && tgt.nodeType === 1 && tgt.closest && tgt.closest(".wb-bar, .wb-rail"));
        } catch (err) {}
        if (!inPanel && !(sheet && (onBody || onBar))) return;
        let clears = false;
        try {
          clears = !!(tgt && tgt.matches && tgt.matches(WB_ESC_CLEARS_SEL));
        } catch (err) {}
        // R2: in the task view a text field keeps Esc (the modal drawer's rule:
        // TK_dwIsTyping, a select excepted), so a draft is never lost to it.
        let inTask = false;
        try {
          inTask = !!(tgt && tgt.nodeType === 1 && tgt.closest && tgt.closest(".wb-taskview"));
        } catch (err) {}
        const taskField = inTask && typeof TK_dwIsTyping === "function" && TK_dwIsTyping(tgt) && String(tgt.tagName || "").toUpperCase() !== "SELECT";
        const depth = Array.isArray(st.drill) ? st.drill.length : 0;
        const step = WB_deskEscStep({
          layerAbove: present.some((id) => id !== "picker"),
          pickerOpen: present.indexOf("picker") >= 0,
          // A self-clearing field with text (the add row, the client picker)
          // clears itself first; any other field lets Esc close the Desk.
          fieldKeeps: taskField || WB_escKeepsField({ tag: tgt && tgt.tagName, type: tgt && tgt.type, value: tgt && tgt.value, inPanel, clears }),
          // The SOP side panel is asked at keydown time (below): it is the
          // content's own state, not something WB_logic can see.
          drillInner: false,
          drillDepth: depth,
          closeOnEmpty: !!(st.drillOrigin && st.drillOrigin.closeOnEmpty),
        });
        // layer / picker / field: the element's own handler acts (this runs
        // in the capture phase, so leaving the event alone lets it through).
        if (step !== "close" && step !== "pop" && step !== "list") return;
        e.preventDefault();
        e.stopPropagation();
        if (depth > 0) {
          // Step 4 of the ladder: an open SOP panel closes first.
          try {
            if (typeof dk.innerEsc === "function" && dk.innerEsc() === true) return;
          } catch (err) {}
          if (typeof dk.drillStep === "function") {
            dk.drillStep(step);
            return;
          }
        }
        WB_store.setDrawerOpen(false);
        return;
      }
      // D opens and closes the Desk from anywhere, never while typing, with a
      // modifier, or under a dialog, menu or tour.
      if (WB_layerAbove(present)) return;
      // This listener runs in the window's capture phase, so page handlers
      // (bubble phase) have not seen the key yet; only another capture listener
      // registered earlier could have set defaultPrevented. The check below
      // ignores it so such a listener cannot block the toggle; typing,
      // modifiers, dialogs and menus still block it, and stopPropagation below
      // keeps later handlers from acting on D as well.
      if (!inPanel && WB_keyBlocked({ key: e.key, target: tgt, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, isComposing: e.isComposing, keyCode: e.keyCode, defaultPrevented: false })) return;
      if (inPanel && tgt && (/^(INPUT|TEXTAREA|SELECT)$/.test(tgt.tagName || "") || tgt.isContentEditable)) return;
      e.preventDefault();
      e.stopPropagation(); // the Desk owns D; a page handler must not act on it too
      if (e.repeat) return; // a held D toggles once, not open-close-open
      const willOpen = !open;
      WB_store.setDrawerOpen(willOpen, "key");
      if (willOpen) WB_track("wb-drawer", "key");
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [live]);
}

// The element to focus inside the open panel: the row for `key` if it is on
// screen in the visible pane (Inbox rows carry data-wb-key, My tasks rows and
// their subtasks are "tk:<id>"), else the first visible row, else the selected
// tab. Hidden panes (kept mounted) are never searched.
function WB_hubFocusTarget(panel, key) {
  if (!panel) return null;
  const pane = panel.querySelector(".wb-hub-pane:not([hidden])") || panel;
  const shown = (el) => !!el && el.offsetParent !== null;
  let el = null;
  if (key) {
    const tk = String(key).indexOf("tk:") === 0;
    const want = tk ? String(key).slice(3) : String(key);
    const rows = pane.querySelectorAll(tk ? "[data-tk-id],[data-tk-sub]" : "[data-wb-key]");
    for (let i = 0; i < rows.length && !el; i++) {
      const r = rows[i];
      const v = tk ? r.getAttribute("data-tk-id") || r.getAttribute("data-tk-sub") : r.getAttribute("data-wb-key");
      if (v === want && shown(r)) el = r;
    }
  }
  if (!el) {
    const sels = [".wb-row[tabindex='0']", ".tk-row[tabindex='0']", ".tk-row"];
    for (let k = 0; k < sels.length && !el; k++) {
      const found = pane.querySelectorAll(sels[k]);
      for (let i = 0; i < found.length && !el; i++) if (shown(found[i])) el = found[i];
    }
  }
  return el || panel.querySelector('[role="tab"][aria-selected="true"]') || panel.querySelector(".wb-tab.is-on") || panel;
}

function WB_useHubLayers(open, panelRef, deskRef) {
  React.useEffect(() => {
    if (!open) return undefined;
    const root = document.documentElement;
    root.classList.add("wb-hub-open");
    let was = false;
    let timer = null;
    const giveFocusBack = () => {
      const panel = panelRef.current;
      if (!panel) return;
      // The docked Desk is non-modal: a drawer opened from the page gives focus
      // back to the page (its own restore), not to the Desk. Only focus that was
      // inside the Desk before the layer opened comes back here (focus inside
      // the layer itself is not counted, see WB_Drawer's focus tracker).
      const dk = (deskRef && deskRef.current) || {};
      if (dk.mode !== "sheet" && dk.zone !== "desk") return;
      const ae = document.activeElement;
      if (ae && ae !== document.body && panel.contains(ae)) return; // the drawer already put it back
      const key = WB_store.getState().hub.lastFocus;
      const el = WB_hubFocusTarget(panel, key);
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

// props: s (store state), me, isAdmin, clients, panelRef, allView, view, chip,
// today, now, count, loading, currentClientId (the client page I am on, or
// null), page (the route page, for the Client tab's "For this page" group).
// mode: "dock" | "sheet". layout (dock): "push" (the page makes room) or
// "overlay" (under 1100px the column covers the page's right edge). handle
// (dock only): { show, w, min, max, valueText, onPointerDown, onPointerMove,
// onPointerUp, onPointerCancel, onLostPointerCapture, onKeyDown } from
// WB_Drawer's width drag.
// R3 (decision 28): the open Desk's glance strip, the counts the rail shows
// while closed (the rail goes away while open). Only items with a count.
var WB_GLANCE_ITEMS = [
  { id: "message", one: "message", many: "messages" },
  { id: "review", one: "review", many: "reviews" },
  { id: "doc", one: "file", many: "files" },
  { id: "mention", one: "mention", many: "mentions" },
];
var WB_GLANCE_IDS = WB_GLANCE_ITEMS.map((g) => g.id);
function WB_HubGlance({ counts, onPick }) {
  const c = counts || {};
  return (
    <div className="wb-glance" role="group" aria-label="Waiting on you" data-tour="wb-glance">
      {WB_GLANCE_ITEMS.filter((g) => c[g.id] > 0).map((g) => {
        const n = c[g.id];
        const word = n === 1 ? g.one : g.many;
        return (
          <button key={g.id} type="button" className="wb-glance-btn" aria-label={n + " " + word + " waiting"} onClick={() => onPick && onPick(g.id)}>
            {typeof WB__RailIcon === "function" && <WB__RailIcon id={g.id} />}
            <span className="wb-glance-n">{n > 99 ? "99+" : n}</span>
            <span className="wb-glance-word">{word}</span>
          </button>
        );
      })}
    </div>
  );
}

// R3 (decision 18): the "Right now" card, from WB_deskContext. Parts with a
// go are links (go: "client" opens the Client tab, "messages" the chat).
function WB_RightNow({ ctx, onGo }) {
  if (!ctx) return null;
  return (
    <section className={"wb-rightnow is-" + ctx.kind} aria-label={"Right now: " + ctx.title} data-tour="wb-rightnow">
      <h3 className="wb-rightnow-head">
        <span className="wb-rightnow-label">Right now</span> <span className="wb-rightnow-title">{ctx.title}</span>
      </h3>
      <ul className="wb-rightnow-parts">
        {ctx.parts.map((p) => (
          <li key={p.key} className={"wb-rightnow-part" + (p.bad ? " is-bad" : "")}>
            {p.go ? (
              <button type="button" className="wb-rightnow-go" onClick={() => onGo && onGo(p.go)}>
                {p.text}
              </button>
            ) : (
              p.text
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

// R2 (spec 5.3): drill (the stack; its last item is the task showing),
// deskRef, onDrillStep(step), onCloseTask(), and staffUser plus the template
// props for TK_DrawerContent. While a task shows, the head, tabs, chips and
// list panes are hidden (the panes stay mounted; their scroll comes back).
function WB_Hub({ s, me, isAdmin, clients, panelRef, view, allView, chip, today, now, count, loading, currentClientId, page, mode, layout, handle, drill, deskRef, onDrillStep, onCloseTask, staffUser, canManageTemplates, canCreateTemplates, onOpenTemplates, glance, extras, onGlancePick, rightNow, onRightNowGo }) {
  const dock = mode !== "sheet";
  const plusOn = typeof WB_useDeskPlus === "function" ? WB_useDeskPlus(true) : false;
  const hub = s.hub;
  const tab = hub.tab;
  const stack = Array.isArray(drill) ? drill : [];
  const top = stack.length ? stack[stack.length - 1] : null;
  const taskView = !!top;
  const taskRef = React.useRef(null);
  const topTitle =
    typeof TK_dwUseStore === "function"
      ? TK_dwUseStore((st) => (top && st.tasks && st.tasks[top.id] ? st.tasks[top.id].text || "" : ""))
      : "";
  const titleOf = (id) => {
    try {
      const ts = typeof TK_dwState === "function" ? TK_dwState() : null;
      const t = ts && ts.tasks ? ts.tasks[id] : null;
      return t ? t.text || "" : "";
    } catch (e) {
      return "";
    }
  };
  // The content's own Esc (the SOP panel) is asked first by WB_useHubKeys.
  const registerEsc = React.useCallback(
    (fn) => {
      if (deskRef && deskRef.current) deskRef.current.innerEsc = typeof fn === "function" ? fn : null;
    },
    [deskRef],
  );
  const bodyRef = React.useRef(null);
  const restored = React.useRef(null);
  const tabbed = WB_HUB_TABS.filter((t) => t.live).length > 1;
  // My tasks mounts the first time its tab opens, then stays mounted (hidden)
  // while the hub is open, so switching back is instant. Its count and
  // "rows are on screen" flag come up from the pane.
  const [tasksSeen, setTasksSeen] = React.useState(tab === "tasks");
  const [tasksCount, setTasksCount] = React.useState(null);
  const [tasksReady, setTasksReady] = React.useState(false);
  // Client works the same way (mounts on first visit, stays while open).
  const [clientSeen, setClientSeen] = React.useState(tab === "client");
  const [clientReady, setClientReady] = React.useState(false);
  React.useEffect(() => {
    if (tab === "tasks") setTasksSeen(true);
    if (tab === "client") setClientSeen(true);
  }, [tab]);
  const paneReady = tab === "tasks" ? tasksReady : tab === "client" ? clientReady : !loading;

  const setChip = (id) => {
    WB_store.setHub({ chip: id });
    WB_track("wb-filter", "drawer:" + id);
  };
  const setTab = (id) => {
    if (id === tab) return;
    WB_store.setHub({ tab: id });
    WB_track("wb-filter", "hub:" + id);
    if (id === "tasks" || id === "client") WB_track("wb-hub", id);
  };

  // Restore the pane's scroll once its rows are on screen, then save it as
  // it moves (silent: no re-render; the store throttles the write).
  React.useEffect(() => {
    if (taskView) {
      // Hidden under the task view: put the saved scroll back on return.
      restored.current = null;
      return;
    }
    if (!paneReady) return;
    if (restored.current === tab) return;
    restored.current = tab;
    const el = bodyRef.current;
    if (el) el.scrollTop = hub.scroll[tab] || 0;
  }, [tab, paneReady, taskView]);
  // R3: the glance strip and the "Right now" card, as WB_Drawer's fill
  // (WB_deskFill by the window height) picked them.
  const glanceN = glance || {};
  const extraIds = Array.isArray(extras) ? extras : [];

  const onScroll = (e) => {
    if (restored.current !== tab) return;
    const patch = { scroll: { [tab]: e.currentTarget.scrollTop } };
    // The Client tab's scroll is kept with the client it belongs to.
    if (tab === "client") patch.scrollClientId = hub.clientId || null;
    WB_store.setHub(patch, true);
  };

  return (
    <>
      {/* No scrim. The right column is a region beside the page (non-modal); the phone sheet stays a modal dialog. */}
      <section
        ref={panelRef}
        id="wb-panel"
        className={"wb-panel wb-glass" + (dock ? " is-dock is-right" + (layout === "overlay" ? " is-overlay" : " is-push") : " is-sheet")}
        {...(dock ? { role: "region" } : { role: "dialog", "aria-modal": "true" })}
        aria-labelledby="wb-panel-title"
        tabIndex={-1}
        data-tk-keyscope="drawer"
      >
        {dock && handle && handle.show && (
          <div
            className="wb-desk-handle"
            role="separator"
            aria-orientation="vertical"
            aria-controls="wb-panel"
            aria-label={WORKBENCH_NAME + " width"}
            aria-valuemin={handle.min}
            aria-valuemax={handle.max}
            aria-valuenow={handle.w}
            aria-valuetext={handle.valueText}
            tabIndex={0}
            data-tour="wb-desk-handle"
            onPointerDown={handle.onPointerDown}
            onPointerMove={handle.onPointerMove}
            onPointerUp={handle.onPointerUp}
            onPointerCancel={handle.onPointerCancel}
            onLostPointerCapture={handle.onLostPointerCapture}
            onKeyDown={handle.onKeyDown}
          >
            <span className="wb-desk-grip" aria-hidden="true" />
          </div>
        )}
        <div className="wb-panel-head" hidden={taskView}>
          <h2 className="wb-panel-title" id="wb-panel-title">
            {WB_NAME} <span className="wb-chip-n">{count}</span>
          </h2>
          {s.offline && <span className="wb-offline">Offline</span>}
          <button type="button" className="wb-icon-btn" aria-label={"Close " + WB_NAME} onClick={() => WB_store.setDrawerOpen(false)}>
            ×
          </button>
        </div>
        {!taskView && extraIds.length > 0 && (
          <div className="wb-desk-extras">
            {extraIds.map((id) =>
              id === "glance" ? (
                <WB_HubGlance key="glance" counts={glanceN} onPick={onGlancePick} />
              ) : id === "rightNow" ? (
                <WB_RightNow key="rightNow" ctx={rightNow} onGo={onRightNowGo} />
              ) : null,
            )}
          </div>
        )}
        {!taskView && <WB_HubTabs tab={tab} onPick={setTab} counts={{ inbox: count, tasks: tasksCount }} />}
        {taskView && (
          <div
            ref={taskRef}
            className="wb-taskview"
            role="region"
            tabIndex={-1}
            aria-label={"Task: " + (topTitle || "details")}
            data-tk-keyscope="drawer"
            data-tour="wb-taskview"
            onKeyDownCapture={(e) => {
              if (e.key === "Escape") taskRef.escAt = Date.now();
            }}
            onBlurCapture={() => {
              // A field's own Esc (revert + blur) would drop focus to <body>; keep it in the task view.
              if (!taskRef.escAt || Date.now() - taskRef.escAt > 300) return;
              setTimeout(() => {
                const tv = taskRef.current;
                if (tv && (document.activeElement === document.body || !document.activeElement)) tv.focus({ preventScroll: true });
              }, 20);
            }}
          >
            <div className="tk-dwc">
              {typeof TK_DrawerContent === "function" && (
                <TK_DrawerContent
                  key={top.id}
                  taskId={top.id}
                  mode="embedded"
                  scopeRef={taskRef}
                  registerEsc={registerEsc}
                  onClose={() => onCloseTask && onCloseTask()}
                  focusField={top.focus}
                  headStart={
                    <button
                      type="button"
                      className="wb-back"
                      data-tour="wb-back"
                      onClick={() => onDrillStep && onDrillStep(stack.length > 1 ? "pop" : "list")}
                    >
                      <span aria-hidden="true">←</span> {WB_drillBackLabel(stack, titleOf, WB_NAME)}
                    </button>
                  }
                  staffUser={staffUser}
                  clients={clients}
                  isAdmin={isAdmin}
                  canManageTemplates={canManageTemplates}
                  canCreateTemplates={canCreateTemplates}
                  onOpenTemplates={onOpenTemplates}
                />
              )}
            </div>
          </div>
        )}
        {tab === "inbox" && !taskView && <div className="wb-panel-tools">
          <div className="wb-tabs wb-hub-chips" role="group" aria-label="Filter">
            {WB_drawerTabs(plusOn).map((t) => (
              <button key={t.id} type="button" aria-pressed={chip === t.id} className={"wb-tab wb-tab-" + t.id + (chip === t.id ? " is-on" : "")} {...(t.id === "gl" ? { "data-tour": "wb-chip-gl" } : {})} onClick={() => setChip(t.id)}>
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
        </div>}
        <div ref={bodyRef} className="wb-panel-body" onScroll={onScroll} hidden={taskView}>
          <div className="wb-hub-pane" hidden={tab !== "inbox"} {...(tabbed ? { role: "tabpanel", id: "wb-hub-pane-inbox", "aria-labelledby": "wb-hub-tab-inbox" } : {})}>
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
                {chip === "all" ? "Clean slate. Nothing needs you right now." : "Nothing here."}
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
                onChip={(c) => setChip(WB_drawerTabs(plusOn).some((t) => t.id === c) ? c : "all")}
              />
            )}
            {view.later > 0 && (
              <p className="wb-later">
                {view.later} more later · <a href="#/tasks">Slate</a>
              </p>
            )}
          </div>
          {/* The wrapper always exists (it is the tab's aria-controls target); only the content waits for the first visit. */}
          <div className="wb-hub-pane" hidden={tab !== "tasks"} {...(tabbed ? { role: "tabpanel", id: "wb-hub-pane-tasks", "aria-labelledby": "wb-hub-tab-tasks" } : {})}>
            {tasksSeen && (
              <WB_HubTasks
                me={me}
                isAdmin={isAdmin}
                clients={clients}
                collapsed={hub.collapsed}
                onCollapse={(key, isCollapsed) => WB_store.setHub({ collapsed: { [key]: isCollapsed } })}
                onCount={setTasksCount}
                onReady={() => setTasksReady(true)}
              />
            )}
          </div>
          <div className="wb-hub-pane" hidden={tab !== "client"} {...(tabbed ? { role: "tabpanel", id: "wb-hub-pane-client", "aria-labelledby": "wb-hub-tab-client" } : {})}>
            {clientSeen && typeof WB_HubClient === "function" && (
              <WB_HubClient
                me={me}
                isAdmin={isAdmin}
                clients={clients}
                clientId={hub.clientId}
                currentClientId={currentClientId}
                page={page}
                showing={tab === "client" && !taskView}
                onReady={() => setClientReady(true)}
              />
            )}
          </div>
        </div>
        {taskView ? (
          <p className="wb-panel-foot wb-taskview-keys">
            <kbd>Esc</kbd> back · <kbd>D</kbd> close · <kbd>F6</kbd> page · <kbd>x</kbd> done · <kbd>s</kbd> status · <kbd>a</kbd> assignee
          </p>
        ) : (
        <p className="wb-panel-foot">
          <kbd>D</kbd> opens and closes · <kbd>Esc</kbd> goes back one step
          {dock && handle && handle.show && <> · drag the left edge to change the width</>}
          {tab === "tasks" && <> · <kbd>↑</kbd> <kbd>↓</kbd> move between tasks · use <b>Add to your {WB_SLATE}</b> to add one</>}
          {tab === "client" && <> · type in the box to find a client · the <b>☆</b> pins one to the top</>}
        </p>
        )}
      </section>
    </>
  );
}
