// ----------------------------------------------------------------------------
// MGB Home, slices S1 to S4 (docs/mgb-home-spec.md): the firm's own home on
// the internal client (MyGoodBooks). app.jsx renders these only when mhHere
// (MH_canOpen on the internal client, components/internal/MH_gate.js):
//
//   MH_TabRow             Home · Profitability · Pricing & fees · Overhead ·
//                         Cost rates,
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
//                         and unmatched rows, milestone tiers (read-only).
//   MH_pageTitle          header title for an MGB Home page or a Firm books page.
//
// Every money piece keeps TP_PF_canSee(effective user) as a second guard and
// every query behind it is refused server-side without can_view_internal().
// No rate values live in code: every figure is read from the database, and
// a missing rate shows as "needs rate". Capacity is a later slice.
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
