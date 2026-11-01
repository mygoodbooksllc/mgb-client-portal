// ----------------------------------------------------------------------------
// MGB Home, slices S1 + S2 (docs/mgb-home-spec.md): the firm's own home on
// the internal client (MyGoodBooks). app.jsx renders these only when mhHere
// (MH_canOpen on the internal client, components/internal/MH_gate.js):
//
//   MH_TabRow             Home · Profitability · Pricing & fees · Overhead,
//                         then the Firm books ▾ menu (the internal client's
//                         existing pages, regrouped), the lock and the gear.
//   MH_HomePage           #/internal: four cards (margin this month vs
//                         target, Master Data sync, Firm books close + last
//                         QuickBooks sync, overhead hours this month).
//   MH_OverheadPage       #/internal/overhead (S2): the firm's own time from
//                         internal_hours() (supabase/mgb-home-s2.sql): hours,
//                         share and loaded cost by person, category, month
//                         and description. Cost only, no revenue. Pure logic
//                         in MH_overhead.js.
//   MH_ProfitabilityPage  #/internal/profitability: TP_TeamPage mode="profit"
//                         (clients table with fees, cost and margin, client
//                         drill, staff cost rates).
//   MH_PricingPage        #/internal/pricing: fee list, Master Data sync strip
//                         and unmatched rows, milestone tiers (read-only).
//   MH_pageTitle          header title for an MGB Home page or a Firm books page.
//
// Every money piece keeps TP_PF_canSee(effective user) as a second guard and
// every query behind it is refused server-side without can_view_internal().
// Cost rates and Capacity tabs are later slices: nothing for them.
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
  const profit = TP_PF_useProfit(canMoney, monthRange, 0);
  const qbo = TP_useQboStatus();
  const qboOn = !!qbo.available;
  const ohRange = useMemo(() => MH_ohRange("month"), []);
  const oh = MH_useInternalHours(canMoney, ohRange);
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

  useEffect(() => {
    const sb = window.mgbSupabase;
    if (!canMoney || !sb || !internalId) {
      setBooks({ loading: false });
      return undefined;
    }
    let alive = true;
    (async () => {
      const [mc, qc] = await Promise.all([
        MH_safe(sb.from("month_close").select("status, updated_at").eq("client_id", internalId).eq("period_kind", "month").eq("period", closePeriod).maybeSingle()),
        MH_safe(sb.from("qbo_connections").select("status, last_synced_at").eq("client_id", internalId).maybeSingle()),
      ]);
      if (!alive) return;
      setBooks({ loading: false, close: mc.data || null, closeErr: mc.error || null, qbo: qc.data || null });
    })();
    return () => {
      alive = false;
    };
  }, [canMoney, internalId, closePeriod]);

  if (!canMoney) return <MH_NoAccess />;

  // Month-to-date margin, the same sums as TP_PF_SummaryStrip.
  let margin = null;
  let marginNote = null;
  if (profit.loading) marginNote = "Loading…";
  else if (profit.kind) marginNote = TP_PF_blocker(profit, qboOn) || "Couldn't load profit.";
  else if (!qboOn) marginNote = "Connect QuickBooks Time to see cost and margin.";
  else if (!profit.hasRates) marginNote = "Set staff cost rates to see margin.";
  else {
    const excl = typeof CF_excludedIds === "function" ? CF_excludedIds() : new Set();
    let cost = 0;
    let rev = 0;
    profit.rows.forEach((r) => {
      if (excl.has(r.client_id) || r.cost == null || r.revenue == null) return;
      cost += r.cost;
      rev += r.revenue;
    });
    margin = rev > 0 ? ((rev - cost) / rev) * 100 : null;
    if (margin == null) marginNote = "No costed revenue yet this month.";
  }

  const closeLabel = (() => {
    if (books.loading) return "Loading…";
    if (books.closeErr) return "Couldn't load the close.";
    const s = books.close ? books.close.status : "not_started";
    const lbl = typeof CT_STATUS_LABEL === "object" && CT_STATUS_LABEL[s] ? CT_STATUS_LABEL[s] : s === "not_started" ? "Not started" : s;
    return lbl;
  })();
  const monthName = new Date(closePeriod + "T00:00:00").toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const lastSync = books.qbo && books.qbo.last_synced_at ? fmtDate(String(books.qbo.last_synced_at).slice(0, 10)) : null;

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
              <TP_PF_MarginChip margin={margin} target={profit.target} />
              <span className="tp-muted"> vs target {TP_PF_fmtPct(profit.target)}</span>
            </p>
          ) : (
            <p className="tp-muted">{marginNote}</p>
          )}
          <p className="tp-muted mh-small">Month to date, from QuickBooks Time hours and loaded cost rates.</p>
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
          <p>
            {monthName} close: <b>{closeLabel}</b>
          </p>
          <p className="tp-muted">
            {books.loading
              ? ""
              : books.qbo
              ? lastSync
                ? `QuickBooks last synced ${lastSync}`
                : "QuickBooks connected, not synced yet"
              : "QuickBooks isn't connected for the firm."}
          </p>
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
                {oh.data.rates_set ? `Cost ${MH_ohMoney(oh.data.totals && oh.data.totals.cost)}` : "Set staff cost rates to see cost."}
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
// Overhead (S2): the firm's own time, from internal_hours(). Refused
// server-side without can_view_internal(); `on` false = no request at all.
// ---------------------------------------------------------------------------
function MH_useInternalHours(on, range) {
  const [st, setSt] = useState({ loading: !!on });
  const from = range && range.from;
  const to = range && range.to;
  useEffect(() => {
    if (!on || !from || !to || typeof TP_qRpc !== "function") {
      setSt({ loading: false });
      return undefined;
    }
    let alive = true;
    // Drop the old period's answer so the page and CSV never show it under the new period.
    setSt({ loading: true });
    TP_qRpc("internal_hours", { p_from: from, p_to: to }).then((r) => {
      if (!alive) return;
      setSt({ loading: false, data: r.error ? null : r.data || null, error: r.error || null, status: r.status });
    });
    return () => {
      alive = false;
    };
  }, [on, from, to]);
  return st;
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
  const res = MH_useInternalHours(canMoney, range);
  if (!canMoney) return <MH_NoAccess />;

  const d = res.data;
  const tot = (d && d.totals) || {};
  const ratesSet = !!(d && d.rates_set);
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
      `mgb-overhead-${range.from}-to-${range.to}.csv`,
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
      </div>

      <section className="card" style={{ marginBottom: 20 }} aria-labelledby="mh-oh-title">
        <h3 className="card-title" id="mh-oh-title">Overhead</h3>
        <p className="card-subtitle">
          The firm's own time: QuickBooks Time hours on customers matched to MyGoodBooks (internal), such as My Good Books
          (Clock-in Option), with their cost at each person's loaded cost rate. Cost only; no revenue.
        </p>
        {res.loading && !d ? (
          <p className="tp-muted">Loading…</p>
        ) : res.error ? (
          <p className="tp-muted">{typeof TP_qErrorText === "function" ? TP_qErrorText("overhead hours", res.error, res.status) : "Couldn't load overhead hours."}</p>
        ) : !d ? (
          <p className="tp-muted">Nothing to show.</p>
        ) : (
          <>
            <div className="tp-stats">
              <TP_Stat label="Overhead hours" value={MH_ohHours(tot.minutes)} />
              <TP_Stat label="Share of all logged hours" value={MH_ohPctLabel(MH_ohPct(tot.minutes, tot.all_minutes))} />
              <TP_Stat label={tot.estimated_minutes ? "Cost (part estimated)" : "Cost"} value={ratesSet ? MH_ohMoney(tot.cost) : "–"} />
              <TP_Stat label="People" value={String(tot.people || 0)} />
            </div>
            {!ratesSet && <p className="tp-muted">Set staff cost rates (Profitability › Staff cost rates) to see cost.</p>}
            {ratesSet && tot.estimated_minutes > 0 && (
              <p className="tp-muted mh-small">
                {MH_ohHours(tot.estimated_minutes)} of these hours ({MH_ohMoney(tot.estimated_cost)}) are costed at the average
                rate: the person has no cost rate for that date, or isn't matched to a staff member.
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
                        {!p.mapped && <span className="tp-muted"> · not matched to staff</span>}
                      </td>
                      <td className="num" data-label="Hours">{MH_ohHours(p.minutes)}</td>
                      <td className="num" data-label="Share of their hours">{MH_ohPctLabel(MH_ohPct(p.minutes, p.all_minutes))}</td>
                      <td className="num" data-label="Cost">
                        {ratesSet ? MH_ohMoney(p.cost) : "–"}
                        {ratesSet && p.estimated && <span className="tp-muted" title="Part costed at the average rate"> *</span>}
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
  if (!canMoney) return <MH_NoAccess />;
  return <TP_TeamPage clients={clients} mode="profit" />;
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
