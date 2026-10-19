// ----------------------------------------------------------------------------
// WB_Page: the full-page Workbench on Today (#/today keeps its slug), spec D1.
//
// TD_TodayPage renders this in place of its tiles and "Needs you" list when
// Workbench is on, and keeps its greeting and optional cards. Today's own
// row kinds Workbench doesn't fetch (deadlines, close blocked, bills, team
// reviews, handbook, upgrades, health, coverage, SOPs, access, profile,
// celebrations) come in as the Other source with their own buttons.
//
// fallback: Today's old tiles and list, shown while wb_inbox isn't live
// (the rollout safety net).
// deskOn (Desk R3, decision 28): the Desk's bar and rail carry the counts,
// so the four count tiles step aside; the chips keep their counts.
// ----------------------------------------------------------------------------

function WB_Page({ me, isAdmin, td, fallback, deskOn }) {
  const s = WB_useStore(me, isAdmin, true);
  const [chip, setChipState] = React.useState("all");
  const [help, setHelp] = React.useState(false);
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30000);
    return () => clearInterval(id);
  }, []);
  const now = Date.now();
  const today = WB_today(now);
  const other = React.useMemo(() => WB_fromToday(td), [td]);
  const all = React.useMemo(() => s.rows.concat(other), [s.rows, other]);
  const view = React.useMemo(() => WB_build(all, { today, now, chip }), [all, today, chip, tick, s.rows]);

  const setChip = (id) => {
    if (id === chip) return;
    setChipState(id);
    WB_track("wb-filter", id);
  };
  const jump = (group) => {
    setChipState("all");
    setTimeout(() => {
      const el = document.getElementById("wb-pl-g-" + group) || document.getElementById("wb-page");
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  };

  if (s.status === "missing") return fallback || null;

  const loading = (s.status === "loading" || s.status === "idle") && !s.at;
  const t = view.tiles;
  const tiles = [
    { key: "reply", label: "Needs reply", value: t.reply, tone: t.reply ? "now" : "calm", sub: t.reply ? "clients waiting on us" : "every client has an answer", go: () => setChip("message") },
    { key: "due", label: "Due today", value: t.dueToday, tone: t.dueToday ? "week" : "calm", sub: t.dueToday ? "on today's list" : "nothing due today", go: () => jump("today") },
    { key: "overdue", label: "Overdue", value: t.overdue, tone: t.overdue ? "now" : "calm", sub: t.overdue ? "past due" : "nothing past due", go: () => jump("overdue") },
    { key: "reviews", label: "Reviews", value: t.reviews, tone: t.reviews ? "week" : "calm", sub: t.reviews ? "to review, or sent back to you" : "no reviews waiting", go: () => setChip("review") },
  ];
  const chipLabel = (WB_CHIPS.find((c) => c.id === chip) || { label: "Snoozed" }).label;

  return (
    <>
      {!deskOn && (
        <div className="kpi-grid td-kpis wb-tiles" data-tour="wb-tiles">
          {tiles.map((x) => (
            <button type="button" key={x.key} className={"card kpi-card kpi-card-clickable td-kpi td-kpi-" + x.tone} onClick={x.go}>
              <span className="kpi-label">{x.label}</span>
              <span className="kpi-value">{loading ? "…" : x.value}</span>
              <span className="kpi-sub">{x.sub}</span>
            </button>
          ))}
        </div>
      )}

      <section className="card wb-card" id="wb-page" aria-labelledby="wb-page-title">
        <div className="wb-card-head">
          <div>
            <h2 className="card-title" id="wb-page-title">
              Needs you
            </h2>
            <p className="card-subtitle">Everything that needs you, in order. Press D for your Desk on any page.</p>
          </div>
          <div className="wb-head-right">
            {s.offline && <span className="wb-offline">Offline</span>}
            <span className="wb-updated" aria-live="off">
              {WB_updatedText(s.at, now)}
            </span>
            <button type="button" className="wb-icon-btn" aria-label="Refresh" title="Refresh" onClick={() => WB_store.refresh()}>
              ↻
            </button>
            <button type="button" className="wb-icon-btn" aria-label="Today help and shortcuts" title="Help and shortcuts" onClick={() => setHelp(true)}>
              ?
            </button>
          </div>
        </div>

        <div className="wb-toolbar">
          <div className="wb-chips" role="toolbar" aria-label="Filter by source" data-tour="wb-chips">
            {WB_CHIPS.map((c) => (
              <button key={c.id} type="button" className={"wb-chip" + (chip === c.id ? " is-on" : "")} aria-pressed={chip === c.id} onClick={() => setChip(c.id)}>
                {c.label}
                <span className="wb-chip-n">{view.counts[c.id]}</span>
              </button>
            ))}
            {(view.counts.snoozed > 0 || chip === "snoozed") && (
              <button type="button" className={"wb-chip wb-chip-snoozed" + (chip === "snoozed" ? " is-on" : "")} aria-pressed={chip === "snoozed"} onClick={() => setChip("snoozed")}>
                Snoozed
                <span className="wb-chip-n">{view.counts.snoozed}</span>
              </button>
            )}
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

        {s.error && (
          <div className="wb-error" role="alert">
            <span>Couldn't refresh this list. {s.at ? "Showing the last list." : ""}</span>
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
          chip === "all" ? (
            <div className="td-empty wb-empty" role="status">
              <span className="td-empty-mark" aria-hidden="true">
                ✓
              </span>
              <span className="td-empty-text">
                <strong>Clean slate. Nothing needs you right now.</strong>
                <span>
                  New messages, tasks, reviews and files show up here as they come in.{" "}
                  <a href="#/tasks">Slate</a> · <a href="#/inbox">Messages</a>
                </span>
              </span>
            </div>
          ) : (
            <p className="wb-filtered-empty" role="status">
              No {chipLabel.toLowerCase()} items.{" "}
              <button type="button" className="wb-linkish" onClick={() => setChip("all")}>
                Show all
              </button>
            </p>
          )
        ) : (
          <WB_List view={view} today={today} now={now} onChip={setChip} onHelp={() => setHelp(true)} showOwner={s.scope === "everyone"} listId="wb-pl" />
        )}

        {view.later > 0 && chip !== "snoozed" && (
          <p className="wb-later">
            {view.later} more later · <a href="#/tasks">Slate</a>
          </p>
        )}
      </section>
      {/* The drawer shows the Undo bar when it is mounted (html.wb-drawer-on). */}
      {!document.documentElement.classList.contains("wb-drawer-on") && <WB_UndoBar />}
      {help && <WB_HelpSheet onClose={() => setHelp(false)} />}
    </>
  );
}

// "?" on the page: the guide article, the tour and the shortcut keys.
function WB_HelpSheet({ onClose }) {
  const [keys, setKeys] = React.useState(false);
  if (keys) return <WB_KeysSheet onClose={onClose} />;
  if (typeof ModalShell !== "function") return null;
  return (
    <ModalShell onClose={onClose} labelledBy="wb-help-title" className="confirm-modal">
      <div className="modal-header">
        <h3 className="card-title" id="wb-help-title" style={{ margin: 0 }}>
          Today help
        </h3>
        <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <div className="modal-body wb-help">
        <a className="wb-help-item" href="#/help/workbench" onClick={onClose}>
          Read the guide article
        </a>
        <button
          type="button"
          className="wb-help-item"
          onClick={() => {
            onClose();
            if (typeof TOUR_startStaff === "function") TOUR_startStaff("ann:desk-rename");
          }}
        >
          Take the 1-minute tour
        </button>
        <button type="button" className="wb-help-item" onClick={() => setKeys(true)}>
          Keyboard shortcuts
        </button>
        <button
          type="button"
          className="wb-help-item"
          onClick={() => {
            // Same key as Dev Tools › Feature flags › Classic Today; Today
            // offers the way back.
            WB__lsSet("mgb_wb_classic", "1");
            window.location.reload();
          }}
        >
          Use classic Today in this browser
        </button>
      </div>
    </ModalShell>
  );
}
