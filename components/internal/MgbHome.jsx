// ----------------------------------------------------------------------------
// MGB Home, slices S1 to S6 (docs/mgb-home-spec.md): the firm's own home on
// the internal client (MyGoodBooks). app.jsx renders these only when mhHere
// (MH_canOpen on the internal client, components/internal/MH_gate.js):
//
//   MH_TabRow             Home · Profitability · Pricing & fees · Overhead ·
//                         Cost rates · Capacity,
//                         then the Firm books ▾ menu (the internal client's
//                         existing pages, regrouped), the lock and the gear.
//   MH_HomePage           #/internal: four cards (margin this month vs
//                         target, staff and full cost once a firm cost basis
//                         exists; Master Data sync; Firm books (S4: last
//                         month's close status, close-check badge and
//                         reasons, due / late line, last QuickBooks sync
//                         with a warning when it failed, is behind or needs
//                         reconnecting, and Sync now); overhead hours this
//                         month). Pure logic in MH_books.js.
//   MH_FirmPnlCard        Firm books › Reports (S4): the firm's Profit & Loss
//                         first on the page (closed months from QuickBooks,
//                         period toggle, by month, Download PDF).
//   MH_OverheadPage       #/internal/overhead (S2): the firm's own time from
//                         internal_hours() (supabase/mgb-home-s2.sql): hours,
//                         share and loaded cost by person, category, month
//                         and description. Cost only, no revenue. Pure logic
//                         in MH_overhead.js.
//   MH_ProfitabilityPage  #/internal/profitability: the cost basis toggle,
//                         then TP_TeamPage mode="profit" (clients table with
//                         fees, cost and margin, client drill; a link to Cost
//                         rates).
//   MH_CostsPage          #/internal/costs (S3): staff cost rates (active
//                         staff, current rate, history, "needs rate"; the
//                         editor is TP_PF_RateCard, moved here from
//                         Profitability), people not on staff (no rate
//                         needed), and the firm cost basis (staff and full
//                         rate per hour by effective date, table
//                         firm_cost_basis, supabase/mgb-home-s3.sql).
//   MH_useCostBasis       firm_cost_basis rows + the picked basis
//                         (MH_getBasis, per browser) -> the basis to ask for.
//   MH_BasisToggle        Staff cost / Full cost, on Profitability and
//                         Overhead. Full is off until a basis row exists.
//   MH_PricingPage        #/internal/pricing: fee list, Master Data sync strip
//                         and unmatched rows, the 2027 fee change review
//                         (S5, MH_FeeReviewCard: read-only master-sheet-sync
//                         action "compare", now vs 2027, flags, CSV; pure
//                         logic in MH_fees.js), milestone tiers (read-only).
//   MH_CapacityPage       #/internal/capacity (S6): hours per person against
//                         target, fee revenue carried (shared by hours), pay
//                         cost, and the split between contract clients (IHH)
//                         and MGB clients, from capacity_inputs()
//                         (supabase/mgb-home-s6.sql); MH_CapacityRulesCard
//                         edits contract clients and fixed / fallback shares.
//                         Pure logic in MH_capacity.js.
//   MH_pageTitle          header title for an MGB Home page or a Firm books page.
//
// Every money piece keeps TP_PF_canSee(effective user) as a second guard and
// every query behind it is refused server-side without can_view_internal().
// No rate values live in code: every figure is read from the database, and
// a missing rate shows as "needs rate". Money pages never call MH_track.
//
// Loaded after TeamPage.jsx / TeamProfit.jsx and before app.jsx; shares the
// global scope, so top-level names carry the MH_ prefix and app.jsx globals
// (fmtMoney, fmtDate, LockIcon, ...) are touched only at render time.
// ----------------------------------------------------------------------------

function MH_pageTitle(page) {
  for (let i = 0; i < MH_TABS.length; i++) if (MH_TABS[i].key === page) return MH_TABS[i].label;
  const b = MH_bookOf(page);
  return b ? b.label : null;
}

function MH_track(name) {
  try {
    if (typeof MGB_track === "function") MGB_track(name);
  } catch (e) {}
}

// ---------------------------------------------------------------------------
// Tab row
// ---------------------------------------------------------------------------
function MH_TabRow({ page, access, onSelectPage, onOpenClientSettings }) {
  const tabs = MH_TABS.map((t) => ({ key: t.key, label: t.label, tour: t.tour }));
  const current = MH_isPage(page) ? page : null;
  const onSettings = page === "client-settings";
  const gear = (
    <>
      <span className="mh-lock" title="Internal: admins with MGB access only">
        {typeof LockIcon === "function" ? <LockIcon aria-hidden="true" /> : null}
        <span className="mh-lock-label">Internal</span>
      </span>
      <button
        type="button"
        className={"cl-settings-btn" + (onSettings ? " active" : "")}
        aria-pressed={onSettings}
        aria-label="Client setup"
        title="Client setup"
        onClick={() => onOpenClientSettings && onOpenClientSettings()}
      >
        {typeof ST_GearIcon === "function" && <ST_GearIcon width="16" height="16" />}
        <span className="cl-settings-label">Setup</span>
      </button>
    </>
  );
  return (
    <NAV_TabRow
      label="MGB Home pages"
      tabs={tabs}
      current={current}
      onSelect={(key) => onSelectPage && onSelectPage(key)}
      idPrefix="mh"
      className="mh-tabs"
      after={<MH_BooksMenu page={page} access={access} onSelectPage={onSelectPage} />}
      right={gear}
    />
  );
}

// "Firm books ▾": the internal client's own pages. The Finances group shows
// only the pages the internal client's plan has (access.tabs).
function MH_BooksMenu({ page, access, onSelectPage }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const btnRef = useRef(null);
  const allowed = access && access.tabs ? access.tabs : null;
  const items = MH_BOOKS.filter((b) => !b.fin || !allowed || allowed.has(b.page));
  const cur = MH_bookOf(page);
  const close = (refocus) => {
    setOpen(false);
    if (refocus && btnRef.current) btnRef.current.focus();
  };
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) close(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close(true);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown, { passive: true });
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  useEffect(() => {
    if (!open || !rootRef.current) return;
    const first = rootRef.current.querySelector("[role='menuitem']");
    if (first) first.focus();
  }, [open]);
  const onMenuKeyDown = (e) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const list = Array.from((rootRef.current && rootRef.current.querySelectorAll("[role='menuitem']")) || []);
    if (!list.length) return;
    e.preventDefault();
    const i = list.indexOf(document.activeElement);
    (e.key === "ArrowDown" ? list[(i + 1) % list.length] : list[(i - 1 + list.length) % list.length]).focus();
  };
  const btnLabel = cur ? "Firm books · " + cur.label : "Firm books";
  return (
    <span className="cl-clientview cl-viewas-wrap mh-books" ref={rootRef}>
      <button
        ref={btnRef}
        type="button"
        className={"cl-clientview-btn" + (cur ? " is-current" : "") + (open ? " open" : "")}
        data-tour="mh-books"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={btnLabel}
        onClick={() => {
          if (!open) MH_track("mh-books-open");
          setOpen((v) => !v);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className="cl-clientview-label">
          <span className="cl-clientview-full">{btnLabel}</span>
          <span className="cl-clientview-short" aria-hidden="true">
            Firm books
          </span>
        </span>
        <ChevronDownIcon className={"cl-viewas-chev" + (open ? " open" : "")} />
      </button>
      {open && (
        <div className="cl-viewas-menu cl-clientview-menu" role="menu" aria-label="Firm books" onKeyDown={onMenuKeyDown}>
          <div className="cl-clientview-head" role="presentation">
            The firm's own books
          </div>
          {items.map((b, i) => {
            const isCur = cur && cur.page === b.page;
            const sep = b.fin && (i === 0 || !items[i - 1].fin);
            return (
              <React.Fragment key={b.slug}>
                {sep && <div className="cl-clientview-sep" role="separator" />}
                <button
                  type="button"
                  role="menuitem"
                  className={"cl-viewas-item cl-clientview-item" + (isCur ? " is-current" : "")}
                  aria-current={isCur ? "page" : undefined}
                  onClick={() => {
                    close(false);
                    if (onSelectPage) onSelectPage(b.page);
                  }}
                >
                  <span className="cl-viewas-name">{b.label}</span>
                  {isCur && (
                    <span className="cl-clientview-check" aria-hidden="true">
                      ✓
                    </span>
                  )}
                </button>
              </React.Fragment>
            );
          })}
        </div>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------
function MH_useMoneyUser() {
  const ctx = useContext(StaffToolsContext);
  const user = ctx && ctx.staffUser;
  return { user, canMoney: typeof TP_PF_canSee === "function" && TP_PF_canSee(user) };
}

function MH_NoAccess() {
  return (
    <div className="card">
      <p className="tp-muted" style={{ margin: 0 }}>
        This page isn't available.
      </p>
    </div>
  );
}

function MH_safe(p) {
  return Promise.resolve(p).then(
    (r) => ({ data: r && r.data, error: r && r.error }),
    (e) => ({ data: null, error: e }),
  );
}

// Cost basis (S3). on = the caller may load money (TP_PF_canSee); false = no
// request at all. firm_cost_basis is refused (RLS) without the grant.
function MH_useCostBasis(on) {
  const [rows, setRows] = useState({ loading: !!on, list: [], error: null });
  const [picked, setPicked] = useState(() => (typeof MH_getBasis === "function" ? MH_getBasis() : "staff"));
  const [bump, setBump] = useState(0);
  const reload = useCallback(() => setBump((n) => n + 1), []);
  useEffect(() => {
    const hit = () => setPicked(MH_getBasis());
    const onStorage = (e) => {
      if (!e || !e.key || e.key === MH_BASIS_KEY) hit();
    };
    window.addEventListener(MH_BASIS_EVENT, hit);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(MH_BASIS_EVENT, hit);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  useEffect(() => {
    const sb = window.mgbSupabase;
    if (!on || !sb) {
      setRows({ loading: false, list: [], error: null });
      return undefined;
    }
    let alive = true;
    setRows((r) => ({ ...r, loading: true }));
    MH_safe(
      sb.from("firm_cost_basis").select("effective_from, staff_rate, full_rate, note, updated_by, updated_at").order("effective_from", { ascending: false }),
    ).then((r) => {
      if (!alive) return;
      setRows({
        loading: false,
        list: (r.data || []).map((x) => ({ ...x, staff_rate: Number(x.staff_rate), full_rate: Number(x.full_rate) })),
        error: r.error || null,
      });
    });
    return () => {
      alive = false;
    };
  }, [on, bump]);
  const hasBasis = rows.list.length > 0;
  return { ...rows, hasBasis, picked, basis: MH_effectiveBasis(picked, hasBasis), setPicked: MH_setBasis, reload };
}

function MH_BasisToggle({ cb }) {
  if (!cb || cb.loading) return null;
  const full = cb.basis === "full";
  return (
    <div className="mh-basis" data-tour="mh-basis">
      <span className="mh-basis-label">Cost basis</span>
      <div className="modal-tabs" style={{ marginTop: 0 }} role="group" aria-label="Cost basis">
        <button type="button" className={"modal-tab" + (!full ? " active" : "")} aria-pressed={!full} onClick={() => cb.setPicked("staff")}>
          Staff cost
        </button>
        <button
          type="button"
          className={"modal-tab" + (full ? " active" : "")}
          aria-pressed={full}
          disabled={!cb.hasBasis}
          title={cb.hasBasis ? undefined : "Set the firm cost basis on Cost rates first"}
          onClick={() => cb.setPicked("full")}
        >
          Full cost
        </button>
      </div>
      <span className="tp-muted mh-small">
        {full
          ? "Each person's loaded hourly cost plus the firm overhead per hour (firm cost basis)."
          : cb.hasBasis
          ? "Each person's loaded hourly cost."
          : "Each person's loaded hourly cost. Full cost needs a firm cost basis on Cost rates."}
      </span>
    </div>
  );
}

// Month-to-date margin from a TP_PF_useProfit state, the same sums as
// TP_PF_SummaryStrip. -> { margin, note }.
function MH_marginOf(profit, qboOn) {
  if (profit.loading) return { margin: null, note: "Loading…" };
  if (profit.kind) return { margin: null, note: TP_PF_blocker(profit, qboOn) || "Couldn't load profit." };
  if (!qboOn) return { margin: null, note: "Connect QuickBooks Time to see cost and margin." };
  if (!profit.hasRates) return { margin: null, note: "Set staff cost rates on Cost rates to see margin." };
  const excl = typeof CF_excludedIds === "function" ? CF_excludedIds() : new Set();
  let cost = 0;
  let rev = 0;
  profit.rows.forEach((r) => {
    if (excl.has(r.client_id) || r.cost == null || r.revenue == null) return;
    cost += r.cost;
    rev += r.revenue;
  });
  const margin = rev > 0 ? ((rev - cost) / rev) * 100 : null;
  return { margin, note: margin == null ? "No costed revenue yet this month." : null };
}

// ---------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------
function MH_Card({ title, children, go, goLabel }) {
  return (
    <section className="card mh-card">
      <h3 className="card-title">{title}</h3>
      <div className="mh-card-body">{children}</div>
      <button type="button" className="link-btn mh-card-go" onClick={go}>
        {goLabel} →
      </button>
    </section>
  );
}

function MH_HomePage({ clients, onSelectPage }) {
  const { canMoney } = MH_useMoneyUser();
  const monthRange = useMemo(() => TP_periodRange("month"), []);
  const cb = MH_useCostBasis(canMoney);
  // Staff-cost margin always; the full-cost one only once a firm cost basis
  // exists (OQ4: Home shows both). Overhead cost follows the picked basis.
  const profit = TP_PF_useProfit(canMoney, monthRange, 0, "staff");
  const profitFull = TP_PF_useProfit(canMoney && !cb.loading && cb.hasBasis, monthRange, 0, "full");
  const qbo = TP_useQboStatus();
  const qboOn = !!qbo.available;
  const ohRange = useMemo(() => MH_ohRange("month"), []);
  const oh = MH_useInternalHours(canMoney, ohRange, cb.basis, cb.loading);
  const [sync, setSync] = useState({ loading: true });
  const [books, setBooks] = useState({ loading: true });
  const internal = typeof STAFF_internalClient === "function" ? STAFF_internalClient() : null;
  const internalId = internal ? internal.id : null;
  // Last month is the one being closed (Close tracker focus month).
  const closePeriod = useMemo(() => {
    const d = new Date();
    const m = new Date(d.getFullYear(), d.getMonth() - 1, 1);
    return `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}-01`;
  }, []);

  useEffect(() => {
    const sb = window.mgbSupabase;
    if (!canMoney || !sb) return undefined;
    let alive = true;
    (async () => {
      const [runs, un, mp] = await Promise.all([
        MH_safe(sb.from("master_sheet_sync_runs").select("started_at, mode, status, updated, unmatched").eq("mode", "live").neq("status", "not_connected").order("started_at", { ascending: false }).limit(1)),
        MH_safe(sb.from("master_sheet_unmatched").select("sheet_key")),
        MH_safe(sb.from("master_sheet_client_map").select("sheet_key")),
      ]);
      if (!alive) return;
      const mapped = new Set(((mp.data || [])).map((m) => m.sheet_key));
      setSync({
        loading: false,
        error: runs.error || un.error || null,
        last: (runs.data || [])[0] || null,
        unmatched: (un.data || []).filter((u) => !mapped.has(u.sheet_key)).length,
      });
    })();
    return () => {
      alive = false;
    };
  }, [canMoney]);

  // S4: the close status card (status, close-check badge and reasons, due
  // line) and the last sync line (with Sync now). booksBump reloads it after
  // a sync.
  const [booksBump, setBooksBump] = useState(0);
  useEffect(() => {
    const sb = window.mgbSupabase;
    if (!canMoney || !sb) {
      setBooks({ loading: false });
      return undefined;
    }
    // The roster is still loading: keep "Loading…" rather than "not connected".
    if (!internalId) return undefined;
    let alive = true;
    (async () => {
      const [mc, qc, cc, run, st] = await Promise.all([
        MH_safe(sb.from("month_close").select("status, updated_at").eq("client_id", internalId).eq("period_kind", "month").eq("period", closePeriod).maybeSingle()),
        MH_safe(sb.from("qbo_connections").select("status, last_synced_at").eq("client_id", internalId).maybeSingle()),
        MH_safe(sb.from("close_checks").select("status, reasons, evaluated_at").eq("client_id", internalId).eq("period", closePeriod).maybeSingle()),
        MH_safe(sb.from("qbo_sync_runs").select("status, started_at").eq("client_id", internalId).order("started_at", { ascending: false }).limit(1)),
        MH_safe(sb.from("month_close_settings").select("late_day").maybeSingle()),
      ]);
      if (!alive) return;
      setBooks({
        loading: false,
        close: mc.data || null,
        closeErr: mc.error || null,
        qbo: qc.data || null,
        qboErr: qc.error || null,
        checks: cc.data || null,
        run: (run.data || [])[0] || null,
        lateDay: (st.data && Number(st.data.late_day)) || 15,
      });
    })();
    return () => {
      alive = false;
    };
  }, [canMoney, internalId, closePeriod, booksBump]);

  if (!canMoney) return <MH_NoAccess />;

  const { margin, note: marginNote } = MH_marginOf(profit, qboOn);
  const full = cb.hasBasis ? MH_marginOf(profitFull, qboOn) : null;

  const closeLabel = (() => {
    if (books.loading) return "Loading…";
    if (books.closeErr) return "Couldn't load the close.";
    const s = books.close ? books.close.status : "not_started";
    const lbl = typeof CT_STATUS_LABEL === "object" && CT_STATUS_LABEL[s] ? CT_STATUS_LABEL[s] : s === "not_started" ? "Not started" : s;
    return lbl;
  })();
  const monthName = new Date(closePeriod + "T00:00:00").toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const closeStatus = books.close ? books.close.status : "not_started";
  const closeNote = (() => {
    if (books.loading || books.closeErr) return null;
    const deadline = typeof CT_deadline === "function" ? CT_deadline(closePeriod, books.lateDay || 15) : null;
    const late = typeof CT_isLate === "function" ? CT_isLate(closePeriod, closeStatus, books.lateDay || 15, new Date()) : false;
    const n = MH_bkCloseNote(closeStatus, deadline, late, new Date());
    if (!n) return null;
    const dueTxt = n.due ? n.due.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
    if (n.kind === "late") return { warn: true, text: `Late: it was due ${dueTxt}.` };
    if (n.kind === "signoff") return { warn: false, text: "Waiting on an admin sign-off." };
    return { warn: false, text: `Due ${dueTxt}.` };
  })();
  const reasons = MH_bkReasons(books.checks, 2);
  const syncState = MH_bkSyncState(books.qbo || null, books.run || null, Date.now());
  const ago = (iso) => (typeof relTime === "function" && relTime(iso)) || fmtDate(String(iso).slice(0, 10));
  const exactAt = (iso) => (iso && typeof fmtDateTime === "function" ? fmtDateTime(iso) : undefined);
  const syncText = (() => {
    if (books.qboErr) return "Couldn't load the QuickBooks status.";
    switch (syncState.kind) {
      case "none":
        return "QuickBooks isn't connected for the firm.";
      case "reconnect":
        return "QuickBooks needs to be reconnected. Reconnect it from Setup (the gear at the top right).";
      case "never":
        return "QuickBooks connected, not synced yet.";
      case "failed":
        return `The last sync failed ${ago(syncState.failedAt)}.` + (syncState.at ? ` Last good sync ${ago(syncState.at)}.` : "");
      case "stale":
        return `QuickBooks hasn't synced since ${ago(syncState.at)}.`;
      default:
        return `QuickBooks last synced ${ago(syncState.at)}.`;
    }
  })();
  const canSyncHere = !books.qboErr && syncState.kind !== "none" && syncState.kind !== "reconnect" && typeof QboSyncNowButton === "function";

  const runLine = (() => {
    if (sync.loading) return "Loading…";
    if (sync.error) return "Couldn't load the sync.";
    if (!sync.last) return "No live sync has run yet.";
    const when = fmtDate(String(sync.last.started_at).slice(0, 10));
    const ok = sync.last.status === "ok";
    return `Last live sync ${when}${ok ? "" : ` (${String(sync.last.status).replace(/_/g, " ")})`}`;
  })();

  return (
    <div className="mh-home" data-tour="mh-home-cards">
      <div className="mh-cards">
        <MH_Card title="Margin this month" go={() => onSelectPage("mgb-profitability")} goLabel="Profitability">
          {margin != null ? (
            <p className="mh-big">
              {full && <span className="tp-muted">Staff cost </span>}
              <TP_PF_MarginChip margin={margin} target={profit.target} />
              <span className="tp-muted"> vs target {TP_PF_fmtPct(profit.target)}</span>
            </p>
          ) : (
            <p className="tp-muted">{marginNote}</p>
          )}
          {full && margin != null && (
            full.margin != null ? (
              <p className="mh-big">
                <span className="tp-muted">Full cost </span>
                {/* No color: the target margin was set on staff cost, so it
                    isn't a fair bar for full cost. */}
                <b>{TP_PF_fmtPct(full.margin)}</b>
              </p>
            ) : (
              <p className="tp-muted">Full cost: {full.note}</p>
            )
          )}
          <p className="tp-muted mh-small">
            Month to date, from QuickBooks Time hours and loaded cost rates{full ? "; full cost adds the firm overhead per hour" : ""}.
          </p>
        </MH_Card>
        <MH_Card title="Master Data sync" go={() => onSelectPage("mgb-pricing")} goLabel="Pricing & fees">
          <p>{runLine}</p>
          {!sync.loading && !sync.error && (
            <p className={sync.unmatched ? "mh-warn" : "tp-muted"}>
              {sync.unmatched ? `${sync.unmatched} sheet ${sync.unmatched === 1 ? "row" : "rows"} not matched to a client` : "Every sheet row is matched."}
            </p>
          )}
        </MH_Card>
        <MH_Card title="Firm books" go={() => onSelectPage("client-close")} goLabel="Close">
          <div data-tour="mh-firm-close">
            <p>
              {monthName} close: <b>{closeLabel}</b>
              {books.checks && typeof CC_Badge === "function" && (
                <>
                  {" "}
                  <CC_Badge row={books.checks} compact />
                </>
              )}
            </p>
            {closeNote && <p className={(closeNote.warn ? "mh-warn" : "tp-muted") + " mh-small"}>{closeNote.text}</p>}
            {reasons.shown.length > 0 && (
              <ul className="mh-reasons tp-muted mh-small" aria-label="Close checks">
                {reasons.shown.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
                {reasons.more > 0 && <li>and {reasons.more} more</li>}
              </ul>
            )}
          </div>
          {!books.loading && (
            <div className="mh-sync" data-tour="mh-firm-sync">
              <p className={syncState.warn ? "mh-warn" : "tp-muted"} title={exactAt(syncState.failedAt || syncState.at)}>
                {syncText}
              </p>
              {canSyncHere && (
                <QboSyncNowButton
                  clientId={internalId}
                  isStaff
                  canSyncNow
                  setupLabel="Setup (the gear at the top right)"
                  onSynced={() => setBooksBump((n) => n + 1)}
                  onFailed={() => setBooksBump((n) => n + 1)}
                />
              )}
            </div>
          )}
        </MH_Card>
        <MH_Card title="Overhead this month" go={() => onSelectPage("mgb-overhead")} goLabel="Overhead">
          {oh.loading ? (
            <p className="tp-muted">Loading…</p>
          ) : oh.error || !oh.data ? (
            <p className="tp-muted">Couldn't load overhead hours.</p>
          ) : (
            <>
              <p className="mh-big">
                <b>{MH_ohHours(oh.data.totals && oh.data.totals.minutes)}</b> hours
                {MH_ohPct(oh.data.totals && oh.data.totals.minutes, oh.data.totals && oh.data.totals.all_minutes) != null && (
                  <span className="tp-muted"> · {MH_ohPct(oh.data.totals.minutes, oh.data.totals.all_minutes)}% of all logged hours</span>
                )}
              </p>
              <p className="tp-muted">
                {oh.data.rates_set
                  ? `${oh.data.basis === "full" ? "Full cost" : "Cost"} ${MH_ohMoney(oh.data.totals && oh.data.totals.cost)}`
                  : "Set staff cost rates on Cost rates to see cost."}
              </p>
            </>
          )}
          <p className="tp-muted mh-small">The firm's own time in QuickBooks Time, month to date.</p>
        </MH_Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Firm books › Reports (S4): the firm's Profit & Loss on screen, first on the
// page (the downloads and the board packet stay below it, unchanged). From
// client.monthly (QuickBooks, closed months only, the same rows the P&L PDF
// uses). app.jsx renders it only when mhHere; TP_PF_canSee is the second guard
// and the internal client's QuickBooks rows are locked without the grant.
// ---------------------------------------------------------------------------
const MH_PNL_PERIODS = ["month", "quarter", "ytd"];

function MH_FirmPnlCard({ client }) {
  const { canMoney } = MH_useMoneyUser();
  const showToast = typeof useToast === "function" ? useToast() : null;
  const [period, setPeriod] = useState("month");
  if (!canMoney || !client) return null;
  const monthly = client.monthly || [];
  const fromQbo = client.dataSource === "quickbooks";
  // Closed months only: periodMonths falls back to the month-to-date row when
  // nothing is closed, which this card shouldn't call a Profit & Loss.
  const hasClosed = typeof window.mgbClosedMonths === "function" && window.mgbClosedMonths(monthly).length > 0;
  const months = fromQbo && hasClosed && typeof periodMonths === "function" ? periodMonths(monthly, period) : [];
  const pnl = MH_bkPnl(months);
  const label = (key) => (typeof periodLabelFor === "function" ? periodLabelFor(monthly, key) : key);
  const monthLabel = (m) => (typeof window.mgbMonthYearLabel === "function" ? window.mgbMonthYearLabel(m) : m.month);
  const span = months.length ? (months.length === 1 ? monthLabel(months[0]) : `${monthLabel(months[0])} – ${monthLabel(months[months.length - 1])}`) : "";
  const download = () => {
    if (typeof REPORT_PDF_BUILDERS !== "object" || !REPORT_PDF_BUILDERS.pl) return;
    const filename = REPORT_PDF_BUILDERS.pl(client, period);
    if (showToast) showToast(`Downloaded "${filename}"`);
    MH_track("mh-firm-pnl-pdf");
  };
  return (
    <section className="card mh-pnl" style={{ marginBottom: 20 }} data-tour="mh-firm-pnl" aria-labelledby="mh-pnl-title">
      <h3 className="card-title" id="mh-pnl-title">
        Firm Profit &amp; Loss
      </h3>
      {!fromQbo ? (
        <p className="tp-muted" style={{ margin: 0 }}>
          QuickBooks isn't connected for the firm, so there's no Profit &amp; Loss to show.
        </p>
      ) : !months.length ? (
        <p className="tp-muted" style={{ margin: 0 }}>
          No closed month from QuickBooks yet.
        </p>
      ) : (
        <>
          <p className="card-subtitle" style={{ margin: 0 }}>
            {span}. Closed months from QuickBooks; the current month shows once it ends.
          </p>
          <div className="view-toggle" style={{ marginTop: 12 }} role="group" aria-label="Period">
            {MH_PNL_PERIODS.map((key) => (
              <button
                type="button"
                key={key}
                className={"view-toggle-btn" + (period === key ? " active" : "")}
                aria-pressed={period === key}
                onClick={() => setPeriod(key)}
              >
                {label(key)}
              </button>
            ))}
          </div>
          <div className="mh-pnl-stats">
            <div>
              <span className="tp-muted mh-small">Income</span>
              <b>{fmtMoney(pnl.income)}</b>
            </div>
            <div>
              <span className="tp-muted mh-small">Expenses</span>
              <b>{fmtMoney(pnl.expenses)}</b>
            </div>
            <div>
              <span className="tp-muted mh-small">Net income</span>
              <b className={pnl.net < 0 ? "mh-warn" : undefined}>{fmtMoney(pnl.net)}</b>
              {pnl.margin != null && <span className="tp-muted mh-small">{pnl.margin}% of income</span>}
            </div>
          </div>
          {pnl.rows.length > 1 && (
            <div className="table-scroll">
              <table className="tx-table tx-table-labeled tp-table">
                <thead>
                  <tr>
                    <th>Month</th>
                    <th className="num">Income</th>
                    <th className="num">Expenses</th>
                    <th className="num">Net income</th>
                  </tr>
                </thead>
                <tbody>
                  {pnl.rows.map((r, i) => (
                    <tr key={i}>
                      <td data-label="Month">{monthLabel(r)}</td>
                      <td className="num" data-label="Income">{fmtMoney(r.income)}</td>
                      <td className="num" data-label="Expenses">{fmtMoney(r.expenses)}</td>
                      <td className="num" data-label="Net income">{fmtMoney(r.net)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <button type="button" className="btn-primary" style={{ marginTop: 14 }} onClick={download}>
            Download PDF
          </button>
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Overhead (S2): the firm's own time, from internal_hours(). Refused
// server-side without can_view_internal(); `on` false = no request at all.
// ---------------------------------------------------------------------------
// basis: "staff" | "full" (MH_useCostBasis().basis; full only once a firm
// cost basis row exists, or the server refuses). wait: true while the cost
// basis is still loading (shows Loading, sends nothing).
function MH_useInternalHours(on, range, basis, wait) {
  const [st, setSt] = useState({ loading: !!on });
  const b = basis === "full" ? "full" : "staff";
  const from = range && range.from;
  const to = range && range.to;
  const key = `${from}|${to}|${b}`;
  useEffect(() => {
    if (!on || wait || !from || !to || typeof TP_qRpc !== "function") {
      setSt({ loading: !!(on && wait) });
      return undefined;
    }
    let alive = true;
    // Drop the old period's answer so the page and CSV never show it under the new period.
    setSt({ loading: true });
    TP_qRpc("internal_hours", { p_from: from, p_to: to, p_basis: b }).then((r) => {
      if (!alive) return;
      setSt({ loading: false, key, data: r.error ? null : r.data || null, error: r.error || null, status: r.status, message: MH_basisErrorText(r.error) });
    });
    return () => {
      alive = false;
    };
  }, [on, wait, from, to, b]);
  // Until the effect runs for a new period or basis (or while the basis
  // loads), never show the previous answer under the new labels.
  if (on && (wait || (!st.loading && st.key !== key))) return { loading: true };
  return st;
}

// The server's "no firm cost basis" refusal (22023: Full cost picked in one
// tab after the last basis row was removed in another), in plain words.
function MH_basisErrorText(err) {
  const m = String((err && err.message) || "");
  return /firm cost basis/i.test(m) ? "There's no firm cost basis any more, so Full cost can't be shown. Pick Staff cost, or add a basis on Cost rates." : null;
}

function MH_ohHours(min) {
  return typeof TP_fmtHM === "function" ? TP_fmtHM(min || 0) : String(Math.round((min || 0) / 6) / 10);
}
function MH_ohMoney(v) {
  return v == null ? "–" : fmtMoney(Math.round(Number(v)));
}
function MH_ohPctLabel(p) {
  return p == null ? "–" : `${p}%`;
}

function MH_OverheadPage() {
  const { canMoney } = MH_useMoneyUser();
  const [period, setPeriod] = useState("month");
  const range = useMemo(() => MH_ohRange(period), [period]);
  const cb = MH_useCostBasis(canMoney);
  const res = MH_useInternalHours(canMoney, range, cb.basis, cb.loading);
  if (!canMoney) return <MH_NoAccess />;

  const d = res.data;
  const tot = (d && d.totals) || {};
  const ratesSet = !!(d && d.rates_set);
  const fullBasis = !!(d && d.basis === "full");
  const people = (d && d.people) || [];
  const lines = (d && d.lines) || [];
  const months = d ? MH_ohMonths(d.months, range.from, range.to) : [];
  const cats = MH_ohCategories(lines);
  const described = lines.filter((l) => l && l.description).slice(0, 15);
  const maxMonth = months.reduce((m, x) => Math.max(m, x.minutes || 0), 0);
  const noDesc = cats.find((c) => c.category === MH_OH_NO_DESC);
  const noDescPct = noDesc ? MH_ohPct(noDesc.minutes, tot.minutes) : null;

  const csv = () => {
    if (!d || typeof TP_downloadCsv !== "function") return;
    TP_downloadCsv(
      `mgb-overhead-${fullBasis ? "full-cost" : "staff-cost"}-${range.from}-to-${range.to}.csv`,
      ["Section", "Name", "Item", "Hours", "Share %", "Cost"],
      [
        ...people.map((p) => ["Person", p.name || p.staff_email || "", "", (p.minutes / 60).toFixed(2), MH_ohPct(p.minutes, p.all_minutes) ?? "", ratesSet && p.cost != null ? p.cost : ""]),
        ...cats.map((c) => ["Category", c.category, "", (c.minutes / 60).toFixed(2), MH_ohPct(c.minutes, tot.minutes) ?? "", ratesSet && c.cost != null ? c.cost : ""]),
        ...months.map((m) => ["Month", m.month.slice(0, 7), "", (m.minutes / 60).toFixed(2), "", ratesSet && m.cost != null ? m.cost : ""]),
        ...lines.map((l) => ["Line", l.description || MH_OH_NO_DESC, l.item || "", (l.minutes / 60).toFixed(2), MH_ohPct(l.minutes, tot.minutes) ?? "", ratesSet && l.cost != null ? l.cost : ""]),
      ],
    );
  };

  return (
    <div className="tp-page mh-overhead" data-tour="mh-overhead">
      <div className="card tp-toolbar-card" style={{ marginBottom: 20 }}>
        <div className="tp-toolbar">
          <div className="modal-tabs" style={{ marginTop: 0 }}>
            {MH_OH_PERIODS.map((p) => (
              <button key={p.key} type="button" className={"modal-tab" + (period === p.key ? " active" : "")} onClick={() => setPeriod(p.key)}>
                {p.label}
              </button>
            ))}
          </div>
          <button type="button" className="btn-secondary" onClick={csv} disabled={!d || res.loading}>
            Download CSV
          </button>
        </div>
        <MH_BasisToggle cb={cb} />
      </div>

      <section className="card" style={{ marginBottom: 20 }} aria-labelledby="mh-oh-title">
        <h3 className="card-title" id="mh-oh-title">Overhead</h3>
        <p className="card-subtitle">
          The firm's own time: QuickBooks Time hours on customers matched to MyGoodBooks (internal), such as My Good Books
          (Clock-in Option), with their cost at each person's loaded cost rate
          {fullBasis ? " plus the firm overhead per hour (Full cost)" : ""}. Cost only; no revenue.
        </p>
        {res.loading && !d ? (
          <p className="tp-muted">Loading…</p>
        ) : res.error ? (
          <p className="tp-muted">{res.message || (typeof TP_qErrorText === "function" ? TP_qErrorText("overhead hours", res.error, res.status) : "Couldn't load overhead hours.")}</p>
        ) : !d ? (
          <p className="tp-muted">Nothing to show.</p>
        ) : (
          <>
            <div className="tp-stats">
              <TP_Stat label="Overhead hours" value={MH_ohHours(tot.minutes)} />
              <TP_Stat label="Share of all logged hours" value={MH_ohPctLabel(MH_ohPct(tot.minutes, tot.all_minutes))} />
              <TP_Stat
                label={(fullBasis ? "Full cost" : "Cost") + (tot.estimated_minutes ? " (part estimated)" : "")}
                value={ratesSet ? MH_ohMoney(tot.cost) : "–"}
              />
              <TP_Stat label="People" value={String(tot.people || 0)} />
            </div>
            {!ratesSet && <p className="tp-muted">Set staff cost rates on Cost rates to see cost.</p>}
            {ratesSet && tot.estimated_minutes > 0 && (
              <p className="tp-muted mh-small">
                {MH_ohHours(tot.estimated_minutes)} of these hours ({MH_ohMoney(tot.estimated_cost)}) are costed at the average
                rate: the person has no cost rate for that date, or isn't matched to a staff member. Add the rate on Cost rates,
                or match the person on the QuickBooks Time mapping page.
              </p>
            )}
            {ratesSet && tot.former_minutes > 0 && (
              <p className="tp-muted mh-small">
                {MH_ohHours(tot.former_minutes)} ({MH_ohMoney(tot.former_cost)}) is time by people no longer on staff, costed at
                the average rate. No rate is needed for them.
              </p>
            )}
            {!tot.minutes && <p className="tp-muted">No internal time in this period.</p>}
          </>
        )}
      </section>

      {d && tot.minutes > 0 && (
        <>
          {months.length > 1 && (
            <section className="card" style={{ marginBottom: 20 }} aria-labelledby="mh-oh-trend">
              <h3 className="card-title" id="mh-oh-trend">By month</h3>
              <div className="mh-oh-trend">
                {months.map((m) => (
                  <div className="mh-oh-month" key={m.month}>
                    <span className="mh-oh-month-label">
                      {new Date(m.month + "T00:00:00").toLocaleDateString("en-US", { month: "short", year: "2-digit" })}
                    </span>
                    <span className="mh-oh-bar-track" aria-hidden="true">
                      <span className="mh-oh-bar" style={{ width: maxMonth ? `${Math.max(0, (m.minutes / maxMonth) * 100)}%` : 0 }} />
                    </span>
                    <span className="mh-oh-month-val">
                      {MH_ohHours(m.minutes)}
                      {ratesSet && <span className="tp-muted"> · {MH_ohMoney(m.cost)}</span>}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="card" style={{ marginBottom: 20 }} aria-labelledby="mh-oh-people">
            <h3 className="card-title" id="mh-oh-people">By person</h3>
            <p className="card-subtitle">Share = this person's internal hours out of everything they logged in the period.</p>
            <div className="table-scroll">
              <table className="tx-table tx-table-labeled tp-table">
                <thead>
                  <tr>
                    <th>Person</th>
                    <th className="num">Hours</th>
                    <th className="num">Share of their hours</th>
                    <th className="num">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {people.map((p) => (
                    <tr key={p.key}>
                      <td data-label="Person">
                        {p.name || p.staff_email || "Unknown"}
                        {!p.mapped && <span className="tp-muted">{p.former ? " · no longer on staff" : " · not matched to staff"}</span>}
                      </td>
                      <td className="num" data-label="Hours">{MH_ohHours(p.minutes)}</td>
                      <td className="num" data-label="Share of their hours">{MH_ohPctLabel(MH_ohPct(p.minutes, p.all_minutes))}</td>
                      <td className="num" data-label="Cost">
                        {ratesSet ? MH_ohMoney(p.cost) : "–"}
                        {ratesSet && p.estimated && <span className="tp-muted" title="Part costed at the average rate"> *</span>}
                        {ratesSet && p.former && !p.estimated && (
                          <span className="tp-muted" title="No longer on staff: costed at the average rate"> †</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card" style={{ marginBottom: 20 }} aria-labelledby="mh-oh-cats">
            <h3 className="card-title" id="mh-oh-cats">By category</h3>
            <p className="card-subtitle">
              Grouped from the service item, or from words in the description when the item is the generic "Hours".
              {noDescPct != null && noDescPct >= 50 && ` ${noDescPct}% of this time has no description in QuickBooks Time.`}
              {lines.length >= 300 && " Uses the 300 biggest lines, so small categories may be missing."}
            </p>
            <div className="table-scroll">
              <table className="tx-table tx-table-labeled tp-table">
                <thead>
                  <tr>
                    <th>Category</th>
                    <th className="num">Hours</th>
                    <th className="num">Share</th>
                    <th className="num">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {cats.map((c) => (
                    <tr key={c.category}>
                      <td data-label="Category">{c.category}</td>
                      <td className="num" data-label="Hours">{MH_ohHours(c.minutes)}</td>
                      <td className="num" data-label="Share">{MH_ohPctLabel(MH_ohPct(c.minutes, tot.minutes))}</td>
                      <td className="num" data-label="Cost">{ratesSet ? MH_ohMoney(c.cost) : "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {described.length > 0 && (
            <section className="card" style={{ marginBottom: 20 }} aria-labelledby="mh-oh-top">
              <h3 className="card-title" id="mh-oh-top">Top descriptions</h3>
              <div className="table-scroll">
                <table className="tx-table tx-table-labeled tp-table">
                  <thead>
                    <tr>
                      <th>Description</th>
                      <th className="num">Hours</th>
                      <th className="num">People</th>
                      <th className="num">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {described.map((l, i) => (
                      <tr key={i}>
                        <td data-label="Description">
                          {l.description}
                          {l.item && String(l.item).toLowerCase() !== "hours" && <span className="tp-muted"> · {l.item}</span>}
                        </td>
                        <td className="num" data-label="Hours">{MH_ohHours(l.minutes)}</td>
                        <td className="num" data-label="People">{l.people}</td>
                        <td className="num" data-label="Cost">{ratesSet ? MH_ohMoney(l.cost) : "–"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Profitability
// ---------------------------------------------------------------------------
function MH_ProfitabilityPage({ clients }) {
  const { canMoney } = MH_useMoneyUser();
  const cb = MH_useCostBasis(canMoney);
  if (!canMoney) return <MH_NoAccess />;
  if (cb.loading) return <p className="tp-muted">Loading…</p>;
  return (
    <>
      <div className="card tp-toolbar-card mh-basis-card" style={{ marginBottom: 20 }}>
        <MH_BasisToggle cb={cb} />
      </div>
      <TP_TeamPage clients={clients} mode="profit" basis={cb.basis} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Cost rates (S3)
// ---------------------------------------------------------------------------
// Staff cost rates (staff_cost_rates) and the firm cost basis
// (firm_cost_basis). Both are refused server-side (RLS) without
// can_view_internal(); writes are audited (cost_rate.*, firm_cost.*, hidden
// from anyone without the grant). Nothing is pre-filled: every figure comes
// from the database and a missing one reads "needs rate".
function MH_CostsPage() {
  const { canMoney } = MH_useMoneyUser();
  const cb = MH_useCostBasis(canMoney);
  const [st, setSt] = useState({ loading: !!canMoney });
  const [bump, setBump] = useState(0);
  const [open, setOpen] = useState(null); // staff email whose rate editor is open
  const reload = useCallback(() => setBump((n) => n + 1), []);
  const today = typeof TP_ymd === "function" ? TP_ymd(new Date()) : new Date().toISOString().slice(0, 10);

  useEffect(() => {
    const sb = window.mgbSupabase;
    if (!canMoney || !sb) {
      setSt({ loading: false });
      return undefined;
    }
    let alive = true;
    (async () => {
      const [staff, rates, ign] = await Promise.all([
        MH_safe(sb.from("staff").select("email, name, role, active").order("name")),
        MH_safe(sb.from("staff_cost_rates").select("staff_email, effective_from, hourly_cost").order("staff_email").order("effective_from", { ascending: false })),
        MH_safe(sb.from("qbo_employee_staff_map").select("display_name, qbo_entity_type, staff_email").eq("ignored", true).order("display_name")),
      ]);
      if (!alive) return;
      setSt({
        loading: false,
        error: staff.error || rates.error || null,
        staff: staff.data || [],
        rates: (rates.data || []).map((r) => ({ ...r, staff_email: String(r.staff_email || "").toLowerCase(), hourly_cost: TP_PF_num(r.hourly_cost) })),
        ignored: ign.error ? [] : ign.data || [],
      });
    })();
    return () => {
      alive = false;
    };
  }, [canMoney, bump]);

  if (!canMoney) return <MH_NoAccess />;

  const people = st.staff ? MH_ratePeople(st.staff, st.rates, today) : [];
  const roleOf = {};
  (st.staff || []).forEach((x) => {
    roleOf[String(x.email || "").toLowerCase()] = x.role;
  });
  const needs = people.filter((p) => p.needsRate).length;
  // Former people: inactive staff, plus QuickBooks Time people set to
  // "ignored" in the mapping (never given a portal login). Names only.
  const formerNames = [];
  const seenName = {};
  (st.staff || []).forEach((x) => {
    if (x.active) return;
    const n = x.name || x.email;
    if (n && !seenName[n.toLowerCase()]) {
      seenName[n.toLowerCase()] = true;
      formerNames.push(n);
    }
  });
  (st.ignored || []).forEach((x) => {
    const n = x.display_name;
    if (n && !seenName[n.toLowerCase()]) {
      seenName[n.toLowerCase()] = true;
      formerNames.push(n);
    }
  });
  formerNames.sort((a, b) => a.localeCompare(b));

  if (open) {
    const p = people.find((x) => x.email === open);
    const shim = { loading: st.loading, kind: null, rates: st.rates || [], reload };
    return (
      <div className="tp-page mh-costs">
        <button type="button" className="link-btn" style={{ marginBottom: 12 }} onClick={() => setOpen(null)}>
          ← Back to Cost rates
        </button>
        <TP_PF_RateCard email={open} name={p ? p.name : open} profit={shim} today={today} />
      </div>
    );
  }

  return (
    <div className="tp-page mh-costs" data-tour="mh-costs">
      <section className="card" style={{ marginBottom: 20 }} aria-labelledby="mh-costs-staff">
        <h3 className="card-title" id="mh-costs-staff">Staff cost rates</h3>
        <p className="card-subtitle">
          What an hour of each person costs the firm (pay plus taxes and benefits). Used to cost QuickBooks Time hours on
          Profitability and Overhead. A new rate starts on its date; earlier hours keep the old rate. Open a person to add or
          change a rate.
        </p>
        {st.loading ? (
          <p className="tp-muted">Loading…</p>
        ) : st.error ? (
          <p className="tp-muted">Couldn't load cost rates.</p>
        ) : people.length === 0 ? (
          <p className="tp-muted">No active staff.</p>
        ) : (
          <>
            {needs > 0 && (
              <p className="mh-warn mh-small" style={{ marginTop: 0 }}>
                {needs} {needs === 1 ? "person needs" : "people need"} a rate. Until then their hours are costed at the average
                rate and marked estimated.
              </p>
            )}
            <div className="table-scroll">
              <table className="tx-table tx-table-labeled tp-table">
                <thead>
                  <tr>
                    <th>Person</th>
                    <th>Role</th>
                    <th className="num">Hourly cost</th>
                    <th>Since</th>
                    <th className="num">Changes</th>
                  </tr>
                </thead>
                <tbody>
                  {people.map((p) => (
                    <tr key={p.email}>
                      <td data-primary="">
                        <button type="button" className="tp-q-link" onClick={() => setOpen(p.email)}>
                          {p.name}
                        </button>
                      </td>
                      <td data-label="Role">{roleOf[p.email] && typeof TP_roleLabel === "function" ? TP_roleLabel(roleOf[p.email]) : "–"}</td>
                      <td className="num" data-label="Hourly cost">
                        {p.current ? `${fmtMoney(p.current.hourly_cost)}/h` : <span className="pf-fee-tag">needs rate</span>}
                      </td>
                      <td data-label="Since">{p.current ? TP_PF_dateY(p.current.effective_from) : "–"}</td>
                      <td className="num" data-label="Changes">{p.history.length || "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {!st.loading && !st.error && formerNames.length > 0 && (
        <section className="card" style={{ marginBottom: 20 }} aria-labelledby="mh-costs-former">
          <h3 className="card-title" id="mh-costs-former">Not on staff</h3>
          <p className="card-subtitle">
            People who are inactive in the portal or set to "ignored" in the QuickBooks Time mapping, such as people who have
            left. No rate is needed: any time they logged without a rate is costed at the average rate and shown as former
            staff, not estimated.
          </p>
          <p style={{ margin: 0 }}>{formerNames.join(", ")}</p>
        </section>
      )}

      <MH_FirmBasisCard cb={cb} today={today} />
    </div>
  );
}

// Firm cost basis editor: the owner's two blended figures per hour, by
// effective date. Full cost on Profitability and Overhead adds (full rate -
// staff rate) to each person's own rate for hours on or after that date.
function MH_FirmBasisCard({ cb, today }) {
  const [from, setFrom] = useState(today);
  const [staffRate, setStaffRate] = useState("");
  const [fullRate, setFullRate] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const sb = window.mgbSupabase;
  const current = cb.hasBasis ? MH_firmBasisAt(cb.list, today) : null;
  const save = async () => {
    const a = Number(staffRate);
    const b = Number(fullRate);
    if (staffRate === "" || fullRate === "" || !isFinite(a) || !isFinite(b) || a < 0 || b < 0) {
      setErr("Enter both rates per hour, 0 or more.");
      return;
    }
    if (a >= 10000 || b >= 10000) {
      setErr("Rates must be under $10,000 per hour.");
      return;
    }
    if (b < a) {
      setErr("The full rate can't be lower than the staff rate.");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from || "")) {
      setErr("Pick the date it takes effect.");
      return;
    }
    // Same date as a saved row: replace it only on a yes, and keep its note
    // when the note box is left blank.
    const same = (cb.list || []).find((r) => r.effective_from === from);
    if (same && !window.confirm(`There's already a firm cost basis from ${TP_PF_dateY(from)}. Replace it?`)) return;
    const n = note.trim() || (same ? same.note || null : null);
    setSaving(true);
    setErr(null);
    const res = await MH_safe(
      sb.from("firm_cost_basis").upsert({ effective_from: from, staff_rate: a, full_rate: b, note: n }, { onConflict: "effective_from" }),
    );
    setSaving(false);
    if (res.error) {
      setErr(`Couldn't save: ${res.error.message || res.error}`);
      return;
    }
    setStaffRate("");
    setFullRate("");
    setNote("");
    cb.reload();
  };
  const remove = async (r) => {
    if (!window.confirm(`Remove the firm cost basis from ${TP_PF_dateY(r.effective_from)}?`)) return;
    setSaving(true);
    setErr(null);
    const res = await MH_safe(sb.from("firm_cost_basis").delete().eq("effective_from", r.effective_from));
    setSaving(false);
    if (res.error) setErr(`Couldn't delete: ${res.error.message || res.error}`);
    else cb.reload();
  };
  return (
    <section className="card" style={{ marginBottom: 20 }} aria-labelledby="mh-costs-basis" data-tour="mh-costs-basis">
      <h3 className="card-title" id="mh-costs-basis">Firm cost basis</h3>
      <p className="card-subtitle">
        Two firm-wide figures per hour: the staff rate (what staff time costs on average) and the full rate (that plus owner
        pay, retirement and other overhead). Full cost on Profitability and Overhead adds the difference to each person's own
        rate. Staff cost stays the default.
      </p>
      {cb.loading ? (
        <p className="tp-muted">Loading…</p>
      ) : cb.error ? (
        <p className="tp-muted">Couldn't load the firm cost basis.</p>
      ) : (
        <>
          <p style={{ margin: "0 0 10px" }}>
            {current ? (
              <>
                Current: staff <b>{fmtMoney(current.staff_rate)}/h</b>, full <b>{fmtMoney(current.full_rate)}/h</b>
                <span className="tp-muted"> since {TP_PF_dateY(current.effective_from)}</span>
              </>
            ) : (
              <span className="tp-muted">Not set yet, so Full cost is off.</span>
            )}
          </p>
          <div className="pf-fee-form">
            <label>
              <span>Staff rate per hour</span>
              <input type="number" min="0" step="0.5" inputMode="decimal" value={staffRate} onChange={(ev) => setStaffRate(ev.target.value)} />
            </label>
            <label>
              <span>Full rate per hour</span>
              <input type="number" min="0" step="0.5" inputMode="decimal" value={fullRate} onChange={(ev) => setFullRate(ev.target.value)} />
            </label>
            <label>
              <span>Effective from</span>
              <input type="date" value={from} onChange={(ev) => setFrom(ev.target.value)} />
            </label>
            <label className="mh-basis-note">
              <span>Note (optional)</span>
              <input type="text" maxLength={500} value={note} onChange={(ev) => setNote(ev.target.value)} />
            </label>
            <button type="button" className="btn-primary pf-btn" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
          {err && <p className="tp-bad" style={{ marginTop: 8 }}>{err}</p>}
          {cb.list.length > 0 && (
            <ul className="pf-rate-history mh-basis-history">
              {cb.list.map((r) => (
                <li key={r.effective_from}>
                  <span>
                    {TP_PF_dateY(r.effective_from)}
                    {r.note ? <span className="tp-muted"> · {r.note}</span> : null}
                  </span>
                  <span>
                    {fmtMoney(r.staff_rate)}/h · {fmtMoney(r.full_rate)}/h
                  </span>
                  <button type="button" className="tp-q-link" onClick={() => remove(r)} disabled={saving}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Capacity (S6)
// ---------------------------------------------------------------------------
// Hours per person next to the fee revenue of the clients they carry and
// their pay cost, split between contract clients (IHH) and MGB clients. One
// read, capacity_inputs() (supabase/mgb-home-s6.sql), refused server-side
// without can_view_internal(); the math is MH_capCompute (MH_capacity.js).
// The rules card edits cost_contract_clients and staff_cost_allocations
// (RLS: grant holders only; audited as cost_contract.* / cost_alloc.*).
// No MH_track here: money pages are never sent to usage tracking.
function MH_useCapacity(on, range, basis, wait, bump) {
  const [st, setSt] = useState({ loading: !!on });
  const b = basis === "full" ? "full" : "staff";
  const from = range && range.from;
  const to = range && range.to;
  const key = `${from}|${to}|${b}|${bump}`;
  useEffect(() => {
    const sb = window.mgbSupabase;
    if (!on || wait || !from || !to || !sb || typeof TP_qRpc !== "function") {
      setSt({ loading: !!(on && wait) });
      return undefined;
    }
    let alive = true;
    setSt({ loading: true });
    (async () => {
      // Tier fees fill in for clients without a fee row, as on Profitability.
      const m = await MH_safe(sb.from("client_milestones").select("client_id, confirmed_tier"));
      const tierFees = {};
      ((m && m.data) || []).forEach((r) => {
        const fee = typeof TP_PF_tierFee === "function" ? TP_PF_tierFee(r.confirmed_tier) : null;
        if (fee != null) tierFees[r.client_id] = fee;
      });
      const r = await TP_qRpc("capacity_inputs", { p_from: from, p_to: to, p_basis: b, p_default_fees: tierFees });
      if (!alive) return;
      setSt({ loading: false, key, data: r.error ? null : r.data || null, error: r.error || null, status: r.status, message: MH_basisErrorText(r.error) });
    })();
    return () => {
      alive = false;
    };
  }, [on, wait, from, to, b, bump]);
  if (on && (wait || (!st.loading && st.key !== key))) return { loading: true };
  return st;
}

function MH_capPct(x) {
  return x == null || !isFinite(x) ? "–" : `${Math.round(x * 100)}%`;
}

function MH_CapacityPage({ clients }) {
  const { canMoney } = MH_useMoneyUser();
  const [period, setPeriod] = useState("last-month");
  const [bump, setBump] = useState(0);
  const reload = useCallback(() => setBump((n) => n + 1), []);
  const range = useMemo(() => MH_ohRange(period), [period]);
  const cb = MH_useCostBasis(canMoney);
  const res = MH_useCapacity(canMoney, range, cb.basis, cb.loading, bump);
  const d = res.data;
  const r = useMemo(() => (d && typeof MH_capCompute === "function" ? MH_capCompute(d) : null), [d]);
  if (!canMoney) return <MH_NoAccess />;

  const ratesSet = !!(d && d.rates_set);
  const fullBasis = !!(d && d.basis === "full");
  const contracts = (r && r.contracts) || [];
  const people = (r && r.people) || [];
  const tot = (r && r.totals) || {};
  const uncarriedMgb = r ? r.uncarried.mgb : 0;
  const uncarriedContract = r ? Object.keys(r.uncarried.contract).reduce((a, k) => a + (r.uncarried.contract[k] || 0), 0) : 0;
  const anyEst = people.some((p) => p.flags.estimated);
  const anyFallback = people.some((p) => p.flags.fallback);
  const anyNoHours = people.some((p) => p.flags.noHours);
  const anyCapped = people.some((p) => p.flags.capped);
  const anyUncosted = people.some((p) => p.flags.uncosted);
  const hrs = (m) => MH_ohHours(m);
  const money = (v) => (ratesSet ? MH_ohMoney(v) : "–");

  const csv = () => {
    if (!r || typeof TP_downloadCsv !== "function") return;
    const head = ["Section", "Name", "Hours", "Target hours", "Use %", "Fee revenue", "Pay cost"];
    contracts.forEach((c) => head.push(`${c.label} cost`));
    head.push("MGB cost", "Margin", "Margin %");
    const rows = people.map((p) => {
      const row = ["Person", p.name, (p.minutes / 60).toFixed(2), p.targetMinutes != null ? (p.targetMinutes / 60).toFixed(2) : "", p.utilization != null ? Math.round(p.utilization * 100) : "", p.revenue, ratesSet ? p.pay : ""];
      contracts.forEach((c) => row.push(ratesSet ? p.contractCost[c.client_id] : ""));
      row.push(ratesSet ? p.mgbCost : "", ratesSet ? p.margin : "", ratesSet && p.marginPct != null ? p.marginPct : "");
      return row;
    });
    r.split.forEach((s) => {
      const row = ["Split", s.name, "", "", "", s.revenue, ratesSet ? s.cost : ""];
      contracts.forEach(() => row.push(""));
      row.push("", ratesSet ? s.margin : "", ratesSet && s.marginPct != null ? s.marginPct : "");
      rows.push(row);
    });
    TP_downloadCsv(`mgb-capacity-${fullBasis ? "full-cost" : "staff-cost"}-${range.from}-to-${range.to}.csv`, head, rows);
  };

  return (
    <div className="tp-page mh-capacity" data-tour="mh-capacity">
      <div className="card tp-toolbar-card" style={{ marginBottom: 20 }}>
        <div className="tp-toolbar">
          <div className="modal-tabs" style={{ marginTop: 0 }}>
            {MH_OH_PERIODS.map((p) => (
              <button key={p.key} type="button" className={"modal-tab" + (period === p.key ? " active" : "")} onClick={() => setPeriod(p.key)}>
                {p.label}
              </button>
            ))}
          </div>
          <button type="button" className="btn-secondary" onClick={csv} disabled={!r || res.loading}>
            Download CSV
          </button>
        </div>
        <MH_BasisToggle cb={cb} />
      </div>

      <section className="card" style={{ marginBottom: 20 }} aria-labelledby="mh-cap-title">
        <h3 className="card-title" id="mh-cap-title">Capacity</h3>
        <p className="card-subtitle">
          Each person's QuickBooks Time hours against their weekly target, the fee revenue of the clients they log time on
          (shared by hours), and their pay cost: loaded cost rate{fullBasis ? " plus the firm overhead per hour (Full cost)" : ""} ×
          paid hours (the target hours for the days so far, or the logged hours when more). Contract clients such as IHH are
          shown apart from MGB clients. Plain hours stay on Team › Hours.
        </p>
        {res.loading && !d ? (
          <p className="tp-muted">Loading…</p>
        ) : res.error ? (
          <p className="tp-muted">{res.message || (typeof TP_qErrorText === "function" ? TP_qErrorText("capacity", res.error, res.status) : "Couldn't load capacity.")}</p>
        ) : !r ? (
          <p className="tp-muted">Nothing to show.</p>
        ) : (
          <>
            <div className="tp-stats">
              <TP_Stat label="Hours logged" value={hrs(tot.allMinutes != null ? tot.allMinutes : tot.minutes)} />
              <TP_Stat label="Use of target hours" value={MH_capPct(tot.utilization)} />
              <TP_Stat label="Fee revenue" value={MH_ohMoney(tot.revenue)} />
              <TP_Stat label={(fullBasis ? "Full pay cost" : "Pay cost") + (anyEst ? " (part estimated)" : "")} value={money(tot.pay)} />
              <TP_Stat label="Margin" value={ratesSet ? `${MH_ohMoney(tot.margin)} · ${MH_ohPctLabel(tot.marginPct)}` : "–"} bad={ratesSet && tot.margin < 0} />
            </div>
            {!ratesSet && <p className="tp-muted">Set staff cost rates on Cost rates to see cost.</p>}
            {tot.otherMinutes > 0 && (
              <p className="tp-muted mh-small">
                Use of target hours counts only people with a weekly target. Other time ({hrs(tot.otherMinutes)} by former staff and
                people with no target or not matched to a staff member) is in Hours logged but not in that figure.
              </p>
            )}
            {(uncarriedMgb > 0 || uncarriedContract > 0) && (
              <p className="tp-muted mh-small">
                {MH_ohMoney(uncarriedMgb + uncarriedContract)} of fee revenue is from clients nobody logged time on in a month. It
                counts in the split below but isn't carried by anyone in the people table.
              </p>
            )}
            {r.missingFees > 0 && (
              <p className="tp-muted mh-small">
                {r.missingFees} {r.missingFees === 1 ? "client has" : "clients have"} no fee and no tier, so no revenue. Set fees on
                Pricing &amp; fees.
              </p>
            )}
          </>
        )}
      </section>

      {r && (
        <>
          <section className="card" style={{ marginBottom: 20 }} aria-labelledby="mh-cap-split" data-tour="mh-capacity-split">
            <h3 className="card-title" id="mh-cap-split">Contract clients vs MGB clients</h3>
            <p className="card-subtitle">
              Revenue is each side's client fees. Cost is everyone's pay cost, split by the allocation rules below: a fixed share
              when one is set, otherwise by the hours each person logged on the contract client that month. MGB includes the
              firm's own time.
            </p>
            <div className="table-scroll">
              <table className="tx-table tx-table-labeled tp-table">
                <thead>
                  <tr>
                    <th>Side</th>
                    <th className="num">Fee revenue</th>
                    <th className="num">Allocated cost</th>
                    <th className="num">Margin</th>
                    <th className="num">Margin %</th>
                  </tr>
                </thead>
                <tbody>
                  {r.split.map((s) => (
                    <tr key={s.key}>
                      <td data-primary="">
                        {s.contract ? s.label : "MGB clients"}
                        {s.contract && s.name && s.name !== s.label && <span className="tp-muted"> · {s.name}</span>}
                        {!s.contract && <span className="tp-muted"> · and firm time</span>}
                      </td>
                      <td className="num" data-label="Fee revenue">{MH_ohMoney(s.revenue)}</td>
                      <td className="num" data-label="Allocated cost">{money(s.cost)}</td>
                      <td className={"num" + (ratesSet && s.margin < 0 ? " mh-warn" : "")} data-label="Margin">{money(s.margin)}</td>
                      <td className="num" data-label="Margin %">{ratesSet ? MH_ohPctLabel(s.marginPct) : "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card" style={{ marginBottom: 20 }} aria-labelledby="mh-cap-people">
            <h3 className="card-title" id="mh-cap-people">By person</h3>
            <p className="card-subtitle">
              Use = hours logged out of their weekly target for the days covered (target from Team › Hours › Capacity). Revenue
              carried = their share, by hours, of the fees of the clients they logged time on.
            </p>
            {people.length === 0 ? (
              <p className="tp-muted">No hours or targets in this period.</p>
            ) : (
              <div className="table-scroll">
                <table className="tx-table tx-table-labeled tp-table">
                  <thead>
                    <tr>
                      <th>Person</th>
                      <th className="num">Hours</th>
                      <th className="num">Use</th>
                      <th className="num">Revenue carried</th>
                      <th className="num">Pay cost</th>
                      {contracts.map((c) => (
                        <th className="num" key={c.client_id}>{c.label} share</th>
                      ))}
                      <th className="num">MGB cost</th>
                      <th className="num">Margin</th>
                    </tr>
                  </thead>
                  <tbody>
                    {people.map((p) => (
                      <tr key={p.key}>
                        <td data-primary="">
                          {p.name}
                          {!p.mapped && <span className="tp-muted">{p.former ? " · no longer on staff" : " · not matched to staff"}</span>}
                          {p.mapped && p.former && <span className="tp-muted"> · no longer on staff</span>}
                        </td>
                        <td className="num" data-label="Hours">
                          {hrs(p.minutes)}
                          {p.targetMinutes != null && <span className="tp-muted"> / {hrs(p.targetMinutes)}</span>}
                        </td>
                        <td className="num" data-label="Use">{MH_capPct(p.utilization)}</td>
                        <td className="num" data-label="Revenue carried">{MH_ohMoney(p.revenue)}</td>
                        <td className="num" data-label="Pay cost">
                          {money(p.pay)}
                          {ratesSet && p.flags.estimated && <span className="tp-muted" title="Part costed at the average rate"> *</span>}
                          {ratesSet && p.flags.uncosted && <span className="tp-muted" title="No rate and no average rate"> ?</span>}
                        </td>
                        {contracts.map((c) => (
                          <td className="num" data-label={`${c.label} share`} key={c.client_id}>
                            {ratesSet ? MH_ohMoney(p.contractCost[c.client_id]) : "–"}
                            {p.pay ? <span className="tp-muted"> · {MH_capPct(p.contractCost[c.client_id] / p.pay)}</span> : null}
                            {p.sources.fixed && <span className="tp-muted" title="A fixed share from the allocation rules"> (fixed)</span>}
                            {p.flags.fallback && <span className="tp-muted" title="No logged hours in a month: the fallback share was used"> (fallback)</span>}
                            {p.flags.noHours && <span className="tp-muted" title="No logged hours in a month and no fallback share: that month is all MGB"> ‡</span>}
                          </td>
                        ))}
                        <td className="num" data-label="MGB cost">{money(p.mgbCost)}</td>
                        <td className={"num" + (ratesSet && p.margin < 0 ? " mh-warn" : "")} data-label="Margin">
                          {ratesSet ? MH_ohMoney(p.margin) : "–"}
                          {ratesSet && p.marginPct != null && <span className="tp-muted"> · {MH_ohPctLabel(p.marginPct)}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {(anyEst || anyNoHours || anyCapped || anyUncosted) && (
              <ul className="tp-muted mh-small mh-cap-notes">
                {anyEst && <li>* Part costed at the average rate: add the person's rate on Cost rates.</li>}
                {anyUncosted && <li>? No cost rate at all yet, so no cost.</li>}
                {anyNoHours && <li>‡ A month with no logged hours and no fallback share counts as all MGB. Add a fallback share below if that's wrong.</li>}
                {anyCapped && <li>Fixed and fallback shares added up to more than 100% for someone, so they were scaled down. Check the rules below.</li>}
              </ul>
            )}
            {anyFallback && <p className="tp-muted mh-small">(fallback) = a month with no logged hours, split by the stored fallback share.</p>}
          </section>
        </>
      )}

      <MH_CapacityRulesCard clients={clients} onChanged={reload} />
    </div>
  );
}

// Allocation rules: which clients are separate contracts, and fixed or
// fallback shares per person. Grant holders only (RLS); every change audited.
function MH_CapacityRulesCard({ clients, onChanged }) {
  const today = typeof TP_ymd === "function" ? TP_ymd(new Date()) : new Date().toISOString().slice(0, 10);
  const [st, setSt] = useState({ loading: true });
  const [bump, setBump] = useState(0);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const [newContract, setNewContract] = useState({ client_id: "", label: "" });
  const [form, setForm] = useState({ staff_email: "", client_id: "", share: "100", method: "fixed", effective_from: today, note: "" });
  const sb = window.mgbSupabase;
  useEffect(() => {
    if (!sb) {
      setSt({ loading: false, error: "no client" });
      return undefined;
    }
    let alive = true;
    (async () => {
      const [cc, al, staff] = await Promise.all([
        MH_safe(sb.from("cost_contract_clients").select("client_id, label, note").order("label")),
        MH_safe(sb.from("staff_cost_allocations").select("id, staff_email, client_id, share, method, effective_from, note").order("staff_email").order("effective_from", { ascending: false })),
        MH_safe(sb.from("staff").select("email, name, active").eq("active", true).order("name")),
      ]);
      if (!alive) return;
      setSt({ loading: false, error: cc.error || al.error || null, contracts: cc.data || [], allocs: al.data || [], staff: staff.data || [] });
    })();
    return () => {
      alive = false;
    };
  }, [bump]);
  const done = () => {
    setBump((n) => n + 1);
    if (onChanged) onChanged();
  };
  const nameOf = (email) => {
    const s = (st.staff || []).find((x) => String(x.email || "").toLowerCase() === email);
    return s ? s.name || s.email : email;
  };
  const labelOf = (cid) => {
    const c = (st.contracts || []).find((x) => x.client_id === cid);
    return c ? c.label : cid;
  };
  const clientName = (cid) => {
    const c = (clients || []).find((x) => x && x.id === cid);
    return c ? c.name : cid;
  };
  const run = async (p, what) => {
    setSaving(true);
    setErr(null);
    const res = await MH_safe(p);
    setSaving(false);
    if (res.error) {
      setErr(`Couldn't ${what}: ${res.error.message || res.error}`);
      return false;
    }
    done();
    return true;
  };
  const addContract = async () => {
    const label = newContract.label.trim();
    if (!newContract.client_id || !label) {
      setErr("Pick a client and give it a short label.");
      return;
    }
    if (await run(sb.from("cost_contract_clients").insert({ client_id: newContract.client_id, label: label.slice(0, 40) }), "add the contract client")) {
      setNewContract({ client_id: "", label: "" });
    }
  };
  const removeContract = async (c) => {
    if (!window.confirm(`Stop treating ${c.label} as a separate contract? Its allocation rules are removed too.`)) return;
    await run(sb.from("cost_contract_clients").delete().eq("client_id", c.client_id), "remove it");
  };
  const addAlloc = async () => {
    const share = Number(form.share);
    if (!form.staff_email || !form.client_id) {
      setErr("Pick a person and a contract client.");
      return;
    }
    if (form.share === "" || !isFinite(share) || share < 0 || share > 100) {
      setErr("The share is a percentage from 0 to 100.");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.effective_from || "")) {
      setErr("Pick the date it takes effect.");
      return;
    }
    const row = {
      staff_email: form.staff_email.toLowerCase(),
      client_id: form.client_id,
      share: Math.round(share * 100) / 10000,
      method: form.method === "fallback" ? "fallback" : "fixed",
      effective_from: form.effective_from,
      note: form.note.trim() || null,
    };
    const same = (st.allocs || []).find(
      (a) => a.staff_email === row.staff_email && a.client_id === row.client_id && a.method === row.method && a.effective_from === row.effective_from,
    );
    if (same && !window.confirm("There's already a rule for this person, client, kind and date. Replace it?")) return;
    if (await run(sb.from("staff_cost_allocations").upsert(row, { onConflict: "staff_email,client_id,method,effective_from" }), "save the rule")) {
      setForm((f) => ({ ...f, note: "" }));
    }
  };
  const removeAlloc = async (a) => {
    if (!window.confirm(`Remove this rule for ${nameOf(a.staff_email)}?`)) return;
    await run(sb.from("staff_cost_allocations").delete().eq("id", a.id), "remove the rule");
  };
  const taken = new Set((st.contracts || []).map((c) => c.client_id));
  const pickable = (clients || []).filter((c) => c && c.isInternal !== true && c.testOnly !== true && !taken.has(c.id));

  return (
    <section className="card" style={{ marginBottom: 20 }} aria-labelledby="mh-cap-rules" data-tour="mh-capacity-rules">
      <h3 className="card-title" id="mh-cap-rules">Allocation rules</h3>
      <p className="card-subtitle">
        A contract client's staff cost is shown apart from MGB clients. For each person, a <b>fixed</b> share always applies
        (for someone who works only on a contract). With no fixed share, cost follows the hours they logged on the contract
        client that month. A <b>fallback</b> share is used only in a month with no logged hours. A newer rule takes over from
        its date.
      </p>
      {st.loading ? (
        <p className="tp-muted">Loading…</p>
      ) : st.error ? (
        <p className="tp-muted">Couldn't load the allocation rules.</p>
      ) : (
        <>
          <h4 className="mh-cap-sub">Contract clients</h4>
          {st.contracts.length === 0 ? (
            <p className="tp-muted">None yet: every client counts as MGB.</p>
          ) : (
            <ul className="pf-rate-history mh-basis-history">
              {st.contracts.map((c) => (
                <li key={c.client_id}>
                  <span>
                    <b>{c.label}</b>
                    <span className="tp-muted"> · {clientName(c.client_id)}</span>
                  </span>
                  <span />
                  <button type="button" className="tp-q-link" onClick={() => removeContract(c)} disabled={saving}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="pf-fee-form">
            <label>
              <span>Client</span>
              <select value={newContract.client_id} onChange={(ev) => setNewContract((x) => ({ ...x, client_id: ev.target.value }))}>
                <option value="">Pick a client…</option>
                {pickable.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name || c.id}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Short label</span>
              <input type="text" maxLength={40} value={newContract.label} onChange={(ev) => setNewContract((x) => ({ ...x, label: ev.target.value }))} />
            </label>
            <button type="button" className="btn-secondary pf-btn" onClick={addContract} disabled={saving}>
              Add contract client
            </button>
          </div>

          <h4 className="mh-cap-sub">Shares by person</h4>
          {st.allocs.length === 0 ? (
            <p className="tp-muted">No rules: everyone's cost follows their logged hours.</p>
          ) : (
            <ul className="pf-rate-history mh-basis-history">
              {st.allocs.map((a) => (
                <li key={a.id}>
                  <span>
                    {nameOf(a.staff_email)}
                    <span className="tp-muted">
                      {" "}
                      · from {typeof TP_PF_dateY === "function" ? TP_PF_dateY(a.effective_from) : a.effective_from}
                      {a.note ? ` · ${a.note}` : ""}
                    </span>
                  </span>
                  <span>
                    {Math.round(Number(a.share) * 1000) / 10}% {labelOf(a.client_id)} · {a.method === "fallback" ? "fallback" : "fixed"}
                  </span>
                  <button type="button" className="tp-q-link" onClick={() => removeAlloc(a)} disabled={saving}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          {st.contracts.length > 0 && (
            <div className="pf-fee-form">
              <label>
                <span>Person</span>
                <select value={form.staff_email} onChange={(ev) => setForm((f) => ({ ...f, staff_email: ev.target.value }))}>
                  <option value="">Pick a person…</option>
                  {(st.staff || []).map((s) => (
                    <option key={s.email} value={String(s.email || "").toLowerCase()}>
                      {s.name || s.email}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Contract client</span>
                <select value={form.client_id} onChange={(ev) => setForm((f) => ({ ...f, client_id: ev.target.value }))}>
                  <option value="">Pick…</option>
                  {st.contracts.map((c) => (
                    <option key={c.client_id} value={c.client_id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Share %</span>
                <input type="number" min="0" max="100" step="1" inputMode="decimal" value={form.share} onChange={(ev) => setForm((f) => ({ ...f, share: ev.target.value }))} />
              </label>
              <label>
                <span>Kind</span>
                <select value={form.method} onChange={(ev) => setForm((f) => ({ ...f, method: ev.target.value }))}>
                  <option value="fixed">Fixed (always)</option>
                  <option value="fallback">Fallback (months with no hours)</option>
                </select>
              </label>
              <label>
                <span>Effective from</span>
                <input type="date" value={form.effective_from} onChange={(ev) => setForm((f) => ({ ...f, effective_from: ev.target.value }))} />
              </label>
              <label className="mh-basis-note">
                <span>Note (optional)</span>
                <input type="text" maxLength={500} value={form.note} onChange={(ev) => setForm((f) => ({ ...f, note: ev.target.value }))} />
              </label>
              <button type="button" className="btn-primary pf-btn" onClick={addAlloc} disabled={saving}>
                {saving ? "Saving…" : "Save rule"}
              </button>
            </div>
          )}
          {err && <p className="tp-bad" style={{ marginTop: 8 }}>{err}</p>}
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Pricing & fees
// ---------------------------------------------------------------------------
function MH_PricingPage({ clients }) {
  const { canMoney } = MH_useMoneyUser();
  const monthRange = useMemo(() => TP_periodRange("month"), []);
  const profit = TP_PF_useProfit(canMoney, monthRange, 0);
  const [sort, setSort] = useState({ key: "name", dir: "asc" });
  const rows = useMemo(() => {
    const excl = typeof CF_excludedIds === "function" ? CF_excludedIds() : new Set();
    return (clients || [])
      .filter((c) => c && !excl.has(c.id) && c.isInternal !== true && c.testOnly !== true)
      .map((c) => {
        const v = TP_PF_rowView(profit, false, c.id);
        const tier = profit.tierFees ? profit.tierFees[c.id] : null;
        const sheet = profit.feeSheet ? profit.feeSheet[c.id] : null;
        return {
          id: c.id,
          name: c.name || "Unknown client",
          fee: v.fee,
          feeSource: v.feeSource,
          feeReview: v.feeReview,
          feeSheet: v.feeSheet,
          syncedAt: sheet && sheet.syncedAt ? sheet.syncedAt : null,
          tier: tier != null ? tier : null,
          gap: v.fee != null && tier != null && v.feeSource !== "tier_default" ? v.fee - tier : null,
        };
      });
  }, [clients, profit]);
  const sorted = useMemo(() => {
    const out = rows.slice();
    const k = sort.key;
    const d = sort.dir === "asc" ? 1 : -1;
    out.sort((a, b) => {
      if (k === "name") return d * a.name.localeCompare(b.name);
      const av = a[k] == null ? (d > 0 ? Infinity : -Infinity) : a[k];
      const bv = b[k] == null ? (d > 0 ? Infinity : -Infinity) : b[k];
      return av === bv ? a.name.localeCompare(b.name) : d * (av < bv ? -1 : 1);
    });
    return out;
  }, [rows, sort]);
  if (!canMoney) return <MH_NoAccess />;
  const toggle = (key) => setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "name" ? "asc" : "desc" }));
  const mark = (key) => (sort.key === key ? (sort.dir === "asc" ? " ▲" : " ▼") : "");
  const tiers = [CHURCH_PLANT_MILESTONE].concat(PRICING_MILESTONES);
  const noFee = rows.filter((r) => r.fee == null).length;
  return (
    <div className="tp-page mh-pricing" data-tour="mh-pricing">
      <section className="card" style={{ marginBottom: 20 }} aria-labelledby="mh-fees-title">
        <h3 className="card-title" id="mh-fees-title">Client fees</h3>
        <p className="card-subtitle">
          Every client's monthly fee and where it comes from. Fees marked Master Data are synced from the MGB_Master_Data
          sheet. To change or override a fee, open the client in Profitability.
        </p>
        {profit.loading ? (
          <p className="tp-muted">Loading…</p>
        ) : profit.kind ? (
          <p className="tp-muted">{TP_PF_blocker(profit, true) || "Couldn't load fees."}</p>
        ) : (
          <>
            {noFee > 0 && (
              <p className="tp-muted" style={{ marginTop: 0 }}>
                {noFee} {noFee === 1 ? "client has" : "clients have"} no fee and no confirmed milestone.
              </p>
            )}
            <div className="table-scroll mgb-sticky-wrap">
              <table className="tx-table tx-table-labeled tp-table">
                <thead>
                  <tr>
                    <th>
                      <button type="button" className="tp-sort" onClick={() => toggle("name")}>Client{mark("name")}</button>
                    </th>
                    <th className="num">
                      <button type="button" className="tp-sort" onClick={() => toggle("fee")}>Fee / mo{mark("fee")}</button>
                    </th>
                    <th>Source</th>
                    <th>Synced</th>
                    <th className="num" title="The fee for the client's confirmed pricing milestone">
                      <button type="button" className="tp-sort" onClick={() => toggle("tier")}>Milestone fee{mark("tier")}</button>
                    </th>
                    <th className="num" title="Actual fee minus the milestone fee. Plus means they pay more than their milestone; minus means less.">
                      <button type="button" className="tp-sort" onClick={() => toggle("gap")}>Gap{mark("gap")}</button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r) => (
                    <tr key={r.id}>
                      <td data-label="Client">{r.name}</td>
                      <td className="num" data-label="Fee / mo">{r.fee != null ? fmtMoney(r.fee) : "–"}</td>
                      <td data-label="Source">
                        <TP_PF_FeeTag source={r.feeSource} review={r.feeReview} sheet={r.feeSheet} />
                        {r.fee != null && r.feeSource !== "tier_default" && !r.feeSheet && <span className="tp-muted">set here</span>}
                      </td>
                      <td data-label="Synced">{r.syncedAt ? fmtDate(String(r.syncedAt).slice(0, 10)) : "–"}</td>
                      <td className="num" data-label="Milestone fee">{r.tier != null ? fmtMoney(r.tier) : "–"}</td>
                      <td className={"num" + (r.gap != null && r.gap < 0 ? " tp-bad" : "")} data-label="Gap">
                        {r.gap == null ? "–" : (r.gap > 0 ? "+" : r.gap < 0 ? "−" : "") + fmtMoney(Math.abs(r.gap))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
      <TP_PF_SheetSyncStrip profit={profit} />
      <MH_FeeReviewCard ready={!!profit.ready} />
      <section className="card" style={{ marginTop: 20, marginBottom: 20 }} aria-labelledby="mh-tiers-title">
        <h3 className="card-title" id="mh-tiers-title">Milestone tiers</h3>
        <p className="card-subtitle">The published pricing, for reference. Change it in the public pricing block and app.jsx together.</p>
        <div className="table-scroll">
          <table className="tx-table tx-table-labeled tp-table">
            <thead>
              <tr>
                <th>Milestone</th>
                <th>Transactions / mo</th>
                <th>Annual expenses</th>
                <th className="num">Fee</th>
              </tr>
            </thead>
            <tbody>
              {tiers.map((m) => (
                <tr key={m.tier}>
                  <td data-label="Milestone">
                    {m.roman} · {m.name}
                  </td>
                  <td data-label="Transactions / mo">{m.txLabel}</td>
                  <td data-label="Annual expenses">{m.budgetLabel}</td>
                  <td className="num" data-label="Fee">{milestoneFeeLabel(m)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2027 fee change review (S5): READ-ONLY. The master-sheet-sync action
// "compare" reads "Bookkeeping fee now" and "Bookkeeping fee 2027" for every
// sheet row matched to a client (same caller check as Preview / Sync now:
// can_view_internal() as the caller) and writes nothing, not even a run log.
// ready = the profit load finished, which proves the grant (same wait as
// TP_PF_SheetSyncStrip). The sheet is read only when the person clicks.
// Pure logic: MH_fees.js (filters, sort, CSV) + logic.js planCompare (flags).
// ---------------------------------------------------------------------------
function MH_frMoney(v) {
  return v == null ? "–" : fmtMoney(v);
}

function MH_frSigned(v, pct) {
  if (v == null || !isFinite(v)) return "–";
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  return pct ? `${sign}${Math.abs(v)}%` : `${sign}${fmtMoney(Math.abs(v))}`;
}

function MH_FeeReviewCard({ ready }) {
  const [res, setRes] = useState({ busy: false, data: null, error: null });
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState({ key: "name", dir: "asc" });
  if (!ready || typeof TP_PF_invokeSync !== "function" || typeof MH_frFilter !== "function") return null;

  const load = async () => {
    setRes((r) => ({ ...r, busy: true, error: null }));
    const r = await TP_PF_invokeSync({ action: "compare" });
    if (r.error) return setRes({ busy: false, data: null, error: r.error });
    const d = r.data || {};
    if (d.status !== "ok") return setRes({ busy: false, data: null, error: d.message || "The comparison didn't run." });
    // No MH_track here: MGB_track logs client_id null, which admins without the grant can see.
    setRes({ busy: false, data: d, error: null });
  };

  const d = res.data;
  const shown = d ? MH_frSort(MH_frFilter(d.rows, filter), sort.key, sort.dir) : [];
  const toggle = (key) => setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "name" ? "asc" : "desc" }));
  const mark = (key) => (sort.key === key ? (sort.dir === "asc" ? " ▲" : " ▼") : "");
  const csv = () => {
    if (!d || typeof TP_downloadCsv !== "function") return;
    const c = MH_frCsv(MH_frSort(MH_frFilter(d.rows, filter), sort.key, sort.dir));
    TP_downloadCsv(`mgb-fee-review-now-vs-2027-${String(d.read_at || "").slice(0, 10) || "today"}${filter === "all" ? "" : "-" + filter}.csv`, c.header, c.rows);
  };

  return (
    <section className="card mh-fee-review" style={{ marginTop: 20 }} aria-labelledby="mh-fr-title" data-tour="mh-fee-review">
      <h3 className="card-title" id="mh-fr-title">2027 fee change review</h3>
      <p className="card-subtitle">
        Each client's “Bookkeeping fee now” next to its “Bookkeeping fee 2027” in the MGB_Master_Data sheet, with the change in dollars
        and percent. Read only: this never changes a fee. Sheet rows with no portal client aren't shown: active ones are listed to
        match in the Master Data sync above, and Lost, Paused or Gone ones are skipped there too.
      </p>
      <div className="mh-fr-bar">
        <button type="button" className="btn-secondary pf-btn" onClick={load} disabled={res.busy}>
          {res.busy ? "Reading the sheet…" : d ? "Read the sheet again" : "Compare now and 2027"}
        </button>
        {d && (
          <button type="button" className="btn-secondary pf-btn" onClick={csv} disabled={!shown.length}>
            Download CSV
          </button>
        )}
        {d && d.read_at && <span className="tp-muted">Read {TP_PF_when(d.read_at)}</span>}
      </div>
      {res.error && <p className="tp-bad pf-sync-msg">{res.error}</p>}
      {d && (
        <>
          <p className="tp-muted mh-fr-summary">{MH_frSummary(d.counts)}</p>
          {(d.errors || []).length > 0 && (
            <ul className="pf-sync-list tp-bad">
              {d.errors.map((e, i) => (
                <li key={i}>
                  Row {e.row} {e.sheet_name}: {e.reason}
                </li>
              ))}
            </ul>
          )}
          <div className="modal-tabs mh-fr-filters" role="group" aria-label="Show">
            {MH_FR_FILTERS.map((f) => (
              <button key={f.key} type="button" className={"modal-tab" + (filter === f.key ? " active" : "")} aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
                {f.label} ({MH_frFilter(d.rows, f.key).length})
              </button>
            ))}
          </div>
          {shown.length === 0 ? (
            <p className="tp-muted">No clients in this view.</p>
          ) : (
            <div className="table-scroll mgb-sticky-wrap">
              <table className="tx-table tx-table-labeled tp-table">
                <thead>
                  <tr>
                    <th>
                      <button type="button" className="tp-sort" onClick={() => toggle("name")}>Client{mark("name")}</button>
                    </th>
                    <th>Status</th>
                    <th className="num">
                      <button type="button" className="tp-sort" onClick={() => toggle("now")}>Now{mark("now")}</button>
                    </th>
                    <th className="num">
                      <button type="button" className="tp-sort" onClick={() => toggle("next")}>2027{mark("next")}</button>
                    </th>
                    <th className="num">
                      <button type="button" className="tp-sort" onClick={() => toggle("change")}>Change{mark("change")}</button>
                    </th>
                    <th className="num">
                      <button type="button" className="tp-sort" onClick={() => toggle("pct")}>%{mark("pct")}</button>
                    </th>
                    <th>Flags</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.client_id + ":" + r.row}>
                      <td data-primary="" data-label="Client">
                        <span className="tp-name">{r.client_name}</span>
                        {r.sheet_name !== r.client_name && <span className="tp-muted"> (sheet: {r.sheet_name})</span>}
                      </td>
                      <td data-label="Status">{r.status}</td>
                      <td className="num" data-label="Now" title={r.now == null && r.now_note ? r.now_note : undefined}>{MH_frMoney(r.now)}</td>
                      <td className="num" data-label="2027" title={r.next == null && r.next_note ? r.next_note : undefined}>{MH_frMoney(r.next)}</td>
                      <td className={"num" + (r.change != null && r.change < 0 ? " tp-bad" : "")} data-label="Change">{MH_frSigned(r.change, false)}</td>
                      <td className={"num" + (r.pct != null && r.pct < 0 ? " tp-bad" : "")} data-label="%">{MH_frSigned(r.pct, true)}</td>
                      <td data-label="Flags">
                        {(r.flags || []).length === 0
                          ? "–"
                          : r.flags.map((f) => (
                              <span key={f} className="pf-fee-tag pf-fee-check mh-fr-flag">
                                {MH_FR_FLAGS[f] || f}
                              </span>
                            ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
