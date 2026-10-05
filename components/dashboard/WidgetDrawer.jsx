// ----------------------------------------------------------------------------
// Customize drawer for every customizable board (owner request 2026-09-30,
// modelled on Asana's "Add widgets" panel).
//
// Boards using it:
//   * client Dashboard, full access and limited user (app.jsx DashboardPage /
//     ScopedDashboardPage, via CustomizeDashboardButton)
//   * staff Bookkeeper Home (app.jsx BookkeeperHomePage, same button)
//   * Live Report (components/daily-close/DailyClose.tsx)
//
// Pieces:
//   * WD_CustomizeButton: the "Customize dashboard" button. Opens the drawer
//     and, while it's open, puts the board in edit mode.
//   * WD_WidgetDrawer: right-side panel (full-width sheet on phones). "Add
//     widgets" lists hidden widgets as cards with a small skeleton preview and
//     a "+"; "On your dashboard" lists visible ones with remove and reorder.
//     Saved views and Reset to default sit in the footer.
//   * WD_EditChrome: in edit mode, every card on the board (anything carrying
//     data-wd-id) gets an outline, a drag handle and a remove button.
//   * WD_useDragReorder: mouse drag-to-reorder for the cards themselves.
//   * WD_sync / WD_useBoardSync: saves each board's layout and saved views to
//     the signed-in person's account (public.user_board_layouts, see
//     supabase/user-board-layouts.sql) so they follow them across devices.
//     localStorage stays the cache and the fallback: no Supabase, signed out,
//     offline, or the table not there yet all just keep the local copy.
//
// The layout object each board passes in is its own hook's return value
// (app.jsx useWidgetLayout, DailyClose useLiveReportLayout): order, hidden,
// visibleOrder, toggle, reorder, add, reset, views, saveView, applyView,
// deleteView. This file never touches a board's storage directly.
//
// Loads before DailyClose.tsx and app.jsx (see index.html's source order), so
// everything here is a plain global prefixed WD_. Hooks are read from the
// shared global scope at call time (app.jsx line 1 destructures them).
// ----------------------------------------------------------------------------

// ---- Skeleton previews ------------------------------------------------------

// Rough shape of each widget, for the faint preview on its "Add widgets" card.
// Anything not listed falls back by id: kpi-* is a number, the rest a list.
const WD_KIND_BY_ID = {
  // Dashboards
  "income-expenses": "chart",
  "your-budget": "bars",
  "xt-budget-summary": "stats",
  "xt-receivables-payables": "stats",
  "xt-giving-summary": "chart",
  // Bookkeeper Home
  "month-close": "bars",
  // Financial Overview (formerly Live Report)
  trend: "chart",
  outlook: "chart",
  "expense-breakdown": "bars",
  "budget-health": "bars",
  aging: "bars",
  "cash-by-account": "donut",
};

function WD_kindFor(w) {
  if (w.kind) return w.kind;
  if (WD_KIND_BY_ID[w.id]) return WD_KIND_BY_ID[w.id];
  if (w.group === "kpi" || String(w.id).startsWith("kpi-")) return "number";
  return "list";
}

function WD_isKpi(w) {
  return w.group === "kpi" || String(w.id).startsWith("kpi-");
}

function WD_Skeleton({ kind }) {
  let body;
  if (kind === "number") {
    body = (
      <div className="wd-sk-number">
        <span className="wd-sk-line" style={{ width: "40%" }} />
        <span className="wd-sk-line wd-sk-big" style={{ width: "62%" }} />
        <span className="wd-sk-line" style={{ width: "30%" }} />
      </div>
    );
  } else if (kind === "bars") {
    body = (
      <div className="wd-sk-bars">
        {[78, 56, 90, 38].map((w, i) => (
          <div className="wd-sk-bar-row" key={i}>
            <span className="wd-sk-line" style={{ width: "22%" }} />
            <span className="wd-sk-track">
              <span className="wd-sk-fill" style={{ width: w + "%" }} />
            </span>
          </div>
        ))}
      </div>
    );
  } else if (kind === "chart") {
    body = (
      <div className="wd-sk-chart">
        {[35, 52, 44, 68, 58, 80, 64, 88].map((h, i) => (
          <span className="wd-sk-col" key={i} style={{ height: h + "%" }} />
        ))}
      </div>
    );
  } else if (kind === "stats") {
    body = (
      <div className="wd-sk-stats">
        {[0, 1, 2].map((i) => (
          <div className="wd-sk-stat" key={i}>
            <span className="wd-sk-line" style={{ width: "70%" }} />
            <span className="wd-sk-line wd-sk-big" style={{ width: "90%" }} />
          </div>
        ))}
      </div>
    );
  } else if (kind === "donut") {
    body = (
      <div className="wd-sk-donut-wrap">
        <span className="wd-sk-donut" />
        <div className="wd-sk-donut-legend">
          <span className="wd-sk-line" style={{ width: "80%" }} />
          <span className="wd-sk-line" style={{ width: "60%" }} />
          <span className="wd-sk-line" style={{ width: "70%" }} />
        </div>
      </div>
    );
  } else {
    body = (
      <div className="wd-sk-list">
        {[64, 48, 56].map((w, i) => (
          <div className="wd-sk-list-row" key={i}>
            <span className="wd-sk-dot" />
            <span className="wd-sk-line" style={{ width: w + "%" }} />
            <span className="wd-sk-line wd-sk-end" />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="wd-sk" aria-hidden="true">
      {body}
    </div>
  );
}

// ---- Account sync -----------------------------------------------------------

const WD_TABLE = "user_board_layouts";
const WD_SAVE_DEBOUNCE_MS = 800;

// Module-level store shared by every board on the page. status:
//   idle        nothing fetched yet (or signed out)
//   loading     fetch in flight
//   ready       rows fetched for `email`; saves go to the server
//   unavailable no Supabase, no session, or the table isn't there (the
//               migration isn't applied yet): boards stay on localStorage
const WD_sync = (function () {
  const listeners = new Set();
  const pauseReasons = new Set();
  let status = "idle";
  let email = null;
  let rows = {};
  let generation = 0;
  let pending = {};
  let timer = null;
  let authHooked = false;

  const sb = () => window.mgbSupabase || null;
  const emit = () =>
    listeners.forEach((fn) => {
      try {
        fn();
      } catch (e) {}
    });

  async function load() {
    const client = sb();
    if (!client) {
      status = "unavailable";
      return;
    }
    status = "loading";
    try {
      const { data: s } = await client.auth.getSession();
      const em =
        s && s.session && s.session.user && s.session.user.email
          ? s.session.user.email.toLowerCase()
          : null;
      if (!em) {
        status = "unavailable";
        email = null;
        rows = {};
        emit();
        return;
      }
      const { data, error } = await client
        .from(WD_TABLE)
        .select("board_key, layout, views");
      if (error) {
        // Missing table, RLS surprise, network: all mean "use local only".
        status = "unavailable";
        emit();
        return;
      }
      email = em;
      rows = {};
      (data || []).forEach((r) => {
        rows[r.board_key] = r;
      });
      generation += 1;
      status = "ready";
      emit();
    } catch (e) {
      status = "unavailable";
      emit();
    }
  }

  function hookAuth() {
    const client = sb();
    if (authHooked || !client || !client.auth.onAuthStateChange) return;
    authHooked = true;
    client.auth.onAuthStateChange((event, session) => {
      const em =
        session && session.user && session.user.email
          ? session.user.email.toLowerCase()
          : null;
      if (status === "loading") return;
      if (!em) {
        if (email || status === "ready") {
          flush();
          email = null;
          rows = {};
          status = "idle";
          emit();
        }
        return;
      }
      if (em !== email) {
        // Signed in (or switched account): fetch that person's boards.
        flush();
        email = null;
        rows = {};
        status = "idle";
        load();
      }
    });
    const flushNow = () => flush();
    window.addEventListener("pagehide", flushNow);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flush();
    });
  }

  function flush() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    const client = sb();
    const batch = pending;
    pending = {};
    if (!client || status !== "ready" || !email) return;
    Object.keys(batch).forEach((key) => {
      const payload = { user_email: email, board_key: key, ...batch[key] };
      client
        .from(WD_TABLE)
        .upsert(payload, { onConflict: "user_email,board_key" })
        .then(({ error }) => {
          if (error) status = "unavailable";
        })
        .catch(() => {});
    });
  }

  return {
    ensureLoaded() {
      hookAuth();
      if (status === "idle") load();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    get generation() {
      return generation;
    },
    get status() {
      return status;
    },
    // undefined = not known yet (not loaded / unavailable); null = no row.
    getRow(boardKey) {
      if (status !== "ready") return undefined;
      return rows[boardKey] || null;
    },
    // Every saved board row (Settings > Dashboards lists them). Empty until
    // loaded.
    listRows() {
      return status === "ready" ? Object.values(rows).map((r) => ({ ...r })) : [];
    },
    // patch: { layout } and/or { views }. Skipped while paused (staff "View
    // as" or client-user preview) so those sessions never overwrite the
    // signed-in staff member's own rows.
    save(boardKey, patch) {
      if (pauseReasons.size || status !== "ready") return;
      rows[boardKey] = { ...(rows[boardKey] || { board_key: boardKey }), ...patch };
      pending[boardKey] = { ...(pending[boardKey] || {}), ...patch };
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, WD_SAVE_DEBOUNCE_MS);
    },
    setPaused(reason, on) {
      if (on) pauseReasons.add(reason);
      else pauseReasons.delete(reason);
    },
  };
})();

// Keeps one board in step with the account copy. getLocal() returns the
// board's current local { layout, views }; applyRemote(row) adopts a server
// row. On each successful load: a server row wins; no row but a local layout
// means this device has never uploaded, so upload it (one-time migration).
function WD_useBoardSync(boardKey, getLocal, applyRemote) {
  const fnRef = useRef(null);
  fnRef.current = { getLocal, applyRemote };
  const seenGen = useRef(-1);
  useEffect(() => {
    seenGen.current = -1;
    const run = () => {
      const gen = WD_sync.generation;
      if (seenGen.current === gen) return;
      const row = WD_sync.getRow(boardKey);
      if (row === undefined) return;
      seenGen.current = gen;
      const hasServer =
        row && (row.layout || (Array.isArray(row.views) && row.views.length));
      if (hasServer) {
        fnRef.current.applyRemote(row);
      } else {
        const local = fnRef.current.getLocal() || {};
        const patch = {};
        if (local.layout) patch.layout = local.layout;
        if (Array.isArray(local.views) && local.views.length)
          patch.views = local.views;
        if (Object.keys(patch).length) WD_sync.save(boardKey, patch);
      }
    };
    const unsub = WD_sync.subscribe(run);
    WD_sync.ensureLoaded();
    run();
    return unsub;
  }, [boardKey]);
}

// ---- Card drag-to-reorder ---------------------------------------------------

// Lets the actual cards on a board be picked up and dropped to reorder — the
// board's layout.reorder, driven by dragging the card itself. dragProps(id)
// spreads onto the card's wrapper; dragClass(id) adds the visual feedback
// classes. dragProps also tags the card with data-wd-id, which is how edit
// mode finds the cards to outline.
//
// Mouse-only, deliberately. An earlier version simulated touch dragging with
// pointer capture + elementFromPoint hit-testing and long-press to pick up;
// four real-device bugs in a row (never reordering, selecting text instead,
// the browser's scroll gesture winning the long-press race) showed native
// drag-and-drop over touch is too fragile to reimplement. Touch users reorder
// with the up/down buttons in the Customize drawer instead.
function WD_useDragReorder(layout) {
  const [draggedId, setDraggedId] = useState(null);
  // dragover fires many times a second, and reorder(dragged, target) is NOT
  // idempotent for a stationary hover (a second call swaps them straight
  // back). Only reorder once per newly entered target.
  const lastTarget = useRef(null);

  return {
    // iPhone-homescreen style: cards shuffle live the instant you drag over
    // a neighbor; dropping only ends the grab.
    dragProps: (id) => ({
      "data-wd-id": id,
      draggable: true,
      onDragStart: () => {
        lastTarget.current = null;
        setDraggedId(id);
      },
      onDragOver: (e) => {
        e.preventDefault();
        if (draggedId && draggedId !== id && lastTarget.current !== id) {
          lastTarget.current = id;
          layout.reorder(draggedId, id);
        }
      },
      onDrop: (e) => {
        e.preventDefault();
        lastTarget.current = null;
        setDraggedId(null);
      },
      onDragEnd: () => {
        lastTarget.current = null;
        setDraggedId(null);
      },
    }),
    // The held card lifts; every other card jiggles, like iOS rearranging.
    dragClass: (id) =>
      "draggable-card" +
      (draggedId === id ? " card-dragging" : draggedId ? " card-jiggling" : ""),
    isDragging: Boolean(draggedId),
    draggedId,
  };
}

// ---- Edit mode chrome on the cards -----------------------------------------

const WD_FLASH_MS = 2600;

// Nearest ancestor of the Customize button that holds the board's cards.
function WD_findBoard(anchor) {
  if (!anchor) return null;
  let el = anchor.parentElement;
  while (el && el !== document.body) {
    if (el.querySelector("[data-wd-id]")) return el;
    el = el.parentElement;
  }
  return anchor.parentElement;
}

// Appends a small host element to each card and portals the handle + remove
// button into it. The host is absolutely positioned and sits after React's
// own children, so React's reconciliation of the card is unaffected. React
// events from the portal bubble through this component, not the card, so a
// click on remove never also triggers the card's own onClick.
function WD_EditChrome({ anchorRef, widgets, layout, flashId, onFlashed }) {
  const [hosts, setHosts] = useState([]);
  const orderKey = layout.visibleOrder.join("|");

  useEffect(() => {
    const board = WD_findBoard(anchorRef.current);
    if (!board) return undefined;
    let frame = null;
    const scan = () => {
      frame = null;
      const next = [];
      board.querySelectorAll("[data-wd-id]").forEach((card) => {
        let host = null;
        for (const child of card.children) {
          if (child.classList && child.classList.contains("wd-chrome-host")) {
            host = child;
            break;
          }
        }
        if (!host) {
          host = document.createElement("span");
          host.className = "wd-chrome-host";
          card.appendChild(host);
        }
        next.push({ id: card.getAttribute("data-wd-id"), host });
      });
      setHosts((prev) =>
        prev.length === next.length &&
        prev.every((h, i) => h.host === next[i].host && h.id === next[i].id)
          ? prev
          : next,
      );
    };
    scan();
    // Cards can remount for reasons unrelated to the layout (a KPI switching
    // between <div> and <button>, say); re-scan on any change under the board.
    const observer = new MutationObserver(() => {
      if (!frame) frame = requestAnimationFrame(scan);
    });
    observer.observe(board, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [orderKey]);

  // Remove every host when edit mode ends.
  useEffect(
    () => () => {
      document
        .querySelectorAll(".wd-chrome-host")
        .forEach((h) => h.parentNode && h.parentNode.removeChild(h));
      document
        .querySelectorAll(".wd-just-added")
        .forEach((c) => c.classList.remove("wd-just-added"));
    },
    [],
  );

  // A just-added widget scrolls into view and flashes (once per add; the
  // host re-scan that follows the add must not re-trigger it).
  const flashedRef = useRef(null);
  const flashTimer = useRef(null);
  useEffect(() => {
    if (!flashId || flashedRef.current === flashId) return;
    const board = WD_findBoard(anchorRef.current);
    const card = board
      ? board.querySelector(`[data-wd-id="${CSS.escape(flashId)}"]`)
      : null;
    if (!card) return;
    flashedRef.current = flashId;
    const reduce =
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    card.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
    card.classList.add("wd-just-added");
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => {
      card.classList.remove("wd-just-added");
      flashedRef.current = null;
      onFlashed();
    }, WD_FLASH_MS);
  }, [flashId, hosts]);
  useEffect(() => () => clearTimeout(flashTimer.current), []);

  return hosts.map(({ id, host }) => {
    const w = widgets.find((x) => x.id === id);
    if (!w) return null;
    return ReactDOM.createPortal(
      <span className="wd-chrome">
        <span className="wd-chrome-handle" aria-hidden="true" title="Drag to move">
          ⠿
        </span>
        <button
          type="button"
          className="wd-chrome-remove"
          tabIndex={-1}
          aria-label={`Remove ${w.label}`}
          title="Remove from dashboard"
          draggable={false}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            layout.toggle(id);
          }}
        >
          ×
        </button>
      </span>,
      host,
      id,
    );
  });
}

// ---- The drawer -------------------------------------------------------------

const WD_PHONE_MAX = 640;

function WD_PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function WD_MinusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M5 12h14" />
    </svg>
  );
}

function WD_ChevronIcon({ up }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={up ? "M6 15l6-6 6 6" : "M6 9l6 6 6-6"} />
    </svg>
  );
}

function WD_OnBoardList({ title, ids, widgets, layout, rowRefs, onRemove }) {
  const [draggedId, setDraggedId] = useState(null);
  const [overId, setOverId] = useState(null);
  if (!ids.length) return null;
  const labelOf = (id) => (widgets.find((w) => w.id === id) || { label: id }).label;
  return (
    <div className="wd-onboard-group">
      {title && <div className="wd-onboard-group-title">{title}</div>}
      <ul className="wd-onboard-list">
        {ids.map((id, i) => {
          const label = labelOf(id);
          return (
            <li
              key={id}
              className={
                "wd-onboard-row" +
                (draggedId === id ? " is-dragging" : "") +
                (overId === id && draggedId && draggedId !== id ? " is-over" : "")
              }
              draggable
              onDragStart={(e) => {
                setDraggedId(id);
                try {
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", id);
                } catch (err) {}
              }}
              onDragOver={(e) => {
                if (!draggedId || !ids.includes(draggedId)) return;
                e.preventDefault();
                if (draggedId !== id) setOverId(id);
              }}
              onDragLeave={() => setOverId((cur) => (cur === id ? null : cur))}
              onDrop={(e) => {
                e.preventDefault();
                if (draggedId && ids.includes(draggedId)) layout.reorder(draggedId, id);
                setDraggedId(null);
                setOverId(null);
              }}
              onDragEnd={() => {
                setDraggedId(null);
                setOverId(null);
              }}
            >
              <span className="wd-onboard-handle" aria-hidden="true" title="Drag to reorder">
                ⠿
              </span>
              <span className="wd-onboard-label">{label}</span>
              <span className="wd-onboard-actions">
                <button
                  type="button"
                  className="wd-icon-btn"
                  disabled={i === 0}
                  onClick={() => layout.reorder(id, ids[i - 1])}
                  aria-label={`Move ${label} up`}
                >
                  <WD_ChevronIcon up />
                </button>
                <button
                  type="button"
                  className="wd-icon-btn"
                  disabled={i === ids.length - 1}
                  onClick={() => layout.reorder(id, ids[i + 1])}
                  aria-label={`Move ${label} down`}
                >
                  <WD_ChevronIcon />
                </button>
                <button
                  type="button"
                  className="wd-icon-btn wd-remove-btn"
                  ref={(el) => {
                    if (el) rowRefs.current[id] = el;
                    else delete rowRefs.current[id];
                  }}
                  onClick={() => onRemove(id)}
                  aria-label={`Remove ${label}`}
                  title="Remove from dashboard"
                >
                  <WD_MinusIcon />
                </button>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function WD_WidgetDrawer({ widgets, layout, anchorRef, onClose, boardName, onCreateCustom, createCustomDesc }) {
  const panelRef = useRef(null);
  const rowRefs = useRef({});
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [top, setTop] = useState(0);
  const [flashId, setFlashId] = useState(null);
  const [newViewName, setNewViewName] = useState("");

  const byId = (id) => widgets.find((w) => w.id === id);
  // Hidden widgets, in the board's default order so the list reads the same
  // way every time rather than reshuffling with the saved layout.
  const available = widgets.filter((w) => layout.hidden.has(w.id));
  const visible = layout.visibleOrder.filter((id) => byId(id));
  const visibleKpis = visible.filter((id) => WD_isKpi(byId(id)));
  const visibleCards = visible.filter((id) => !WD_isKpi(byId(id)));

  // Sit below the staff top bar when there is one; phones get a full sheet.
  useEffect(() => {
    const measure = () => {
      const bar = document.querySelector(".tb-bar");
      if (!bar || window.innerWidth <= WD_PHONE_MAX) return setTop(0);
      setTop(Math.max(0, Math.round(bar.getBoundingClientRect().bottom)));
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, { passive: true });
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure);
    };
  }, []);

  // Edit mode flag for the board's CSS (outlines, room for the drawer).
  useEffect(() => {
    document.documentElement.classList.add("wd-editing");
    return () => document.documentElement.classList.remove("wd-editing");
  }, []);

  // Focus trap, Escape, click outside. Mount/unmount only (see ModalShell in
  // app.jsx for why onClose is read through a ref).
  useEffect(() => {
    const panel = panelRef.current;
    const restoreTo = anchorRef.current || document.activeElement;
    const focusables = () =>
      [
        ...panel.querySelectorAll(
          'button, [href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((el) => !el.disabled && el.offsetParent !== null);
    const first = focusables()[0];
    (first || panel).focus();

    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusables();
      if (!items.length) return;
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      if (!panel.contains(document.activeElement)) {
        e.preventDefault();
        firstEl.focus();
      } else if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };
    // Clicks on the board's cards (remove, drag) and on the Customize button
    // itself (which toggles) don't count as "outside".
    const onPointerDown = (e) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (panel.contains(t)) return;
      if (anchorRef.current && anchorRef.current.contains(t)) return;
      if (t.closest("[data-wd-id]")) return;
      onCloseRef.current();
    };
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("mousedown", onPointerDown, true);
    document.addEventListener("touchstart", onPointerDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("mousedown", onPointerDown, true);
      document.removeEventListener("touchstart", onPointerDown, true);
      if (restoreTo && typeof restoreTo.focus === "function") restoreTo.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const add = (id) => {
    if (layout.add) layout.add(id);
    else layout.toggle(id);
    setFlashId(id);
  };

  const remove = (id) => {
    const ids = visible;
    const i = ids.indexOf(id);
    const nextId = ids[i + 1] || ids[i - 1];
    layout.toggle(id);
    // Keep the caret in the list rather than dropping it on <body>.
    setTimeout(() => {
      const el = nextId && rowRefs.current[nextId];
      if (el) el.focus();
      else if (panelRef.current) panelRef.current.focus();
    }, 0);
  };

  const saveView = () => {
    if (!newViewName.trim()) return;
    layout.saveView(newViewName);
    setNewViewName("");
  };

  return ReactDOM.createPortal(
    <>
      <WD_EditChrome
        anchorRef={anchorRef}
        widgets={widgets}
        layout={layout}
        flashId={flashId}
        onFlashed={() => setFlashId(null)}
      />
      <aside
        className="wd-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wd-drawer-title"
        tabIndex={-1}
        ref={panelRef}
        style={{ "--wd-top": top + "px" }}
      >
        <div className="wd-drawer-head">
          <div>
            <h2 id="wd-drawer-title" className="wd-drawer-title">
              Add widgets
            </h2>
            <p className="wd-drawer-sub">Customize {boardName || "your dashboard"}</p>
          </div>
          <button type="button" className="wd-close" onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="wd-drawer-body">
          <section aria-labelledby="wd-add-title">
            <h3 id="wd-add-title" className="wd-section-title wd-visually-hidden">
              Available widgets
            </h3>
            {onCreateCustom && (
              <button type="button" className="wd-add-card wd-create-card" onClick={onCreateCustom}>
                <span className="wd-add-card-head">
                  <span className="wd-add-card-text">
                    <span className="wd-add-name">Create a custom card</span>
                    <span className="wd-add-desc">
                      {createCustomDesc ||
                        "Pick the categories, accounts or funds, a time period and what to show"}
                    </span>
                  </span>
                  <span className="wd-add-plus" aria-hidden="true">
                    <WD_PlusIcon />
                  </span>
                </span>
              </button>
            )}
            {available.length === 0 ? (
              <p className="wd-empty">
                Everything is already on your dashboard. Remove a widget below to
                bring it back here.
              </p>
            ) : (
              <ul className="wd-add-list">
                {available.map((w) => (
                  <li key={w.id}>
                    <button
                      type="button"
                      className="wd-add-card"
                      onClick={() => add(w.id)}
                    >
                      <span className="wd-add-card-head">
                        <span className="wd-add-card-text">
                          {w.sourceTab && (
                            <span className="wd-add-source">From {w.sourceTab}</span>
                          )}
                          <span className="wd-add-name">
                            <span className="wd-visually-hidden">Add </span>
                            {w.label}
                          </span>
                          {w.description && (
                            <span className="wd-add-desc">{w.description}</span>
                          )}
                        </span>
                        <span className="wd-add-plus" aria-hidden="true">
                          <WD_PlusIcon />
                        </span>
                      </span>
                      <WD_Skeleton kind={WD_kindFor(w)} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="wd-onboard-title" className="wd-onboard">
            <h3 id="wd-onboard-title" className="wd-section-title">
              On your dashboard
            </h3>
            {visible.length === 0 ? (
              <p className="wd-empty">Nothing yet. Add a widget above.</p>
            ) : (
              <>
                <WD_OnBoardList
                  title={visibleKpis.length && visibleCards.length ? "Top numbers" : null}
                  ids={visibleKpis}
                  widgets={widgets}
                  layout={layout}
                  rowRefs={rowRefs}
                  onRemove={remove}
                />
                <WD_OnBoardList
                  title={visibleKpis.length && visibleCards.length ? "Cards" : null}
                  ids={visibleCards}
                  widgets={widgets}
                  layout={layout}
                  rowRefs={rowRefs}
                  onRemove={remove}
                />
              </>
            )}
            <p className="wd-hint">
              With a mouse you can also drag cards on the page itself.
            </p>
          </section>
        </div>

        <div className="wd-drawer-foot">
          <details className="wd-views">
            <summary>
              Saved views{layout.views.length ? ` (${layout.views.length})` : ""}
            </summary>
            <p className="wd-hint">
              Save this arrangement under a name to switch back to it later.
            </p>
            {layout.views.length > 0 && (
              <ul className="wd-view-list">
                {layout.views.map((v) => (
                  <li className="wd-view-row" key={v.name}>
                    <span className="wd-view-name">{v.name}</span>
                    <button
                      type="button"
                      className="wd-text-btn"
                      onClick={() => layout.applyView(v.name)}
                    >
                      Apply
                    </button>
                    <button
                      type="button"
                      className="wd-icon-btn"
                      onClick={() => layout.deleteView(v.name)}
                      aria-label={`Delete view ${v.name}`}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="wd-view-new">
              <input
                type="text"
                placeholder="Name this arrangement…"
                aria-label="View name"
                value={newViewName}
                maxLength={60}
                onChange={(e) => setNewViewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveView();
                }}
              />
              <button
                type="button"
                className="btn-secondary"
                disabled={!newViewName.trim()}
                onClick={saveView}
              >
                Save view
              </button>
            </div>
          </details>
          <div className="wd-foot-actions">
            <button type="button" className="btn-secondary" onClick={layout.reset}>
              Reset to default
            </button>
            <button type="button" className="btn-primary" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      </aside>
    </>,
    document.body,
  );
}

// The Customize button. className/children let a board keep its own button
// styling (the Live Report uses its dc- classes). onOpenChange tells a board
// that needs to know (for card dragging only while editing) when edit mode
// starts and ends.
function WD_CustomizeButton({
  widgets,
  layout,
  className = "customize-dashboard-btn",
  children,
  boardName,
  onOpenChange,
  onCreateCustom,
  createCustomDesc,
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef(null);
  const set = (next) => {
    setOpen(next);
    if (onOpenChange) onOpenChange(next);
  };
  return (
    <>
      <button
        type="button"
        ref={anchorRef}
        data-tour="customize"
        className={className + (open ? " is-active" : "")}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => set(!open)}
      >
        {children || "Customize dashboard"}
      </button>
      {open && (
        <WD_WidgetDrawer
          widgets={widgets}
          layout={layout}
          anchorRef={anchorRef}
          boardName={boardName}
          onClose={() => set(false)}
          createCustomDesc={createCustomDesc}
          onCreateCustom={
            onCreateCustom
              ? () => {
                  set(false);
                  onCreateCustom();
                }
              : null
          }
        />
      )}
    </>
  );
}
