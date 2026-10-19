// ----------------------------------------------------------------------------
// WB_Page: the Desk's side of Today (#/today keeps its slug).
//
// Today's redesign (2026-10-19j, desk-right-spec decision 28: one job per
// surface): Today shows ONE "Do next" card, the top row of the Desk's ordered
// list, in place of the long Needs you list, the source chips and the four
// count tiles. Slate and the Desk own the lists. The card itself is shared
// with classic Today (TD_DoNextCard in components/staff/Today.jsx), and the
// counts for Today's header line go up through onSummary.
//
// td: Today's rows (kinds Workbench doesn't fetch: deadlines, close blocked,
// bills, team reviews, handbook, upgrades, health, coverage, SOPs, access,
// profile, celebrations) come in as the Other source, ranked with the rest.
// fallback: Today's classic Do next card, shown while wb_inbox isn't live
// (the rollout safety net).
// deskOn: kept for callers; the tiles it used to hide are gone either way.
// ----------------------------------------------------------------------------

function WB_Page({ me, isAdmin, td, fallback, deskOn, onSummary }) {
  const s = WB_useStore(me, isAdmin, true);
  const [help, setHelp] = React.useState(false);
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30000);
    return () => clearInterval(id);
  }, []);
  const now = Date.now();
  const today = WB_today(now);
  const other = React.useMemo(() => WB_fromToday(td), [td]);
  // An admin on "Everyone" still gets their own next item here.
  const all = React.useMemo(() => {
    const mineOnly = (r) => !(s.scope === "everyone" && r.owner_email && String(r.owner_email).toLowerCase() !== String(me || "").toLowerCase());
    return s.rows.filter(mineOnly).concat(other);
  }, [s.rows, other, s.scope, me]);
  const view = React.useMemo(() => WB_build(all, { today, now, chip: "all" }), [all, today, tick, s.rows]);
  const t = view.tiles;
  const loading = (s.status === "loading" || s.status === "idle") && !s.at;
  const missing = s.status === "missing";

  React.useEffect(() => {
    if (typeof onSummary === "function" && !missing && !loading) onSummary({ due: t.dueToday, late: t.overdue });
  }, [t.dueToday, t.overdue, missing, loading]);

  if (missing) return fallback || null;

  const flat = [];
  view.groups.forEach((g) => g.rows.forEach((r) => flat.push(r)));
  const topRow = flat[0] || null;
  const nextRow = flat[1] || null;
  const primary = topRow ? WB_primaryAction(topRow) : null;
  const isOther = !!topRow && topRow.source === "other";
  const tdr = isOther ? topRow._td : null;
  const meta = topRow ? [topRow.client_name, topRow.period ? WB_periodLabel(topRow.period) : null, WB_whenText(topRow, today, now), isOther ? topRow.detail : null].filter(Boolean).join(" · ") : "";
  const open = () => {
    if (!topRow) return;
    if (isOther) {
      if (tdr && tdr.onClick) tdr.onClick();
      else if (tdr && tdr.actions && tdr.actions[0] && tdr.actions[0].onClick) tdr.actions[0].onClick();
      return;
    }
    if (topRow.kind === "task" && topRow.source_id != null) {
      if (topRow.status === "todo" && typeof WB_store.startTask === "function") WB_store.startTask(topRow);
      if (typeof TK_openTask === "function") {
        TK_openTask(String(topRow.source_id), { from: "today" });
        return;
      }
    }
    WB_go(topRow, "open");
  };
  const label = isOther ? (tdr && tdr.actions && tdr.actions.find((a) => a.primary) ? tdr.actions.find((a) => a.primary).label : "Open") : primary ? primary.label : "Open";

  if (typeof TD_DoNextCard !== "function") return fallback || null;
  return (
    <>
      <TD_DoNextCard
        loading={loading}
        top={topRow ? { title: topRow.title, meta, label } : null}
        next={nextRow ? nextRow.title : ""}
        more={Math.max(0, view.visible - 1) + (view.later || 0)}
        onOpen={open}
        onHelp={() => setHelp(true)}
        offline={s.offline}
        updated={WB_updatedText(s.at, now)}
        error={s.error ? "Couldn't refresh this list." + (s.at ? " Showing the last list." : "") : ""}
        onRetry={() => WB_store.refresh()}
      />
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
