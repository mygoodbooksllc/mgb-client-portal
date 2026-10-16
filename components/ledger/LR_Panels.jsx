// components/ledger/LR_Panels.jsx — pieces shared by the client Ledger review
// tab (LR_Tab.jsx) and Work › Ledger review › Review a file (LR_ReviewFile.jsx):
// the flag list, type chips, the summary strip, the reconciliation panel and
// "Month vs. the year" with its bar chart.
//
// Pure display: data comes in as props (GLR_checks / GLR_compare output and
// stored gl_review_flags rows), nothing is fetched here.
//
// Prefix: LR_. Like every component file, it only touches app.jsx globals at
// render time, never at the top level. Styles: components/ledger/ledger.css.

function LR_useIsPhone() {
  const q = "(max-width: 859px)";
  const get = () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(q).matches : false);
  const [phone, setPhone] = useState(get);
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const mq = window.matchMedia(q);
    const on = () => setPhone(mq.matches);
    if (mq.addEventListener) mq.addEventListener("change", on);
    else if (mq.addListener) mq.addListener(on);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", on);
      else if (mq.removeListener) mq.removeListener(on);
    };
  }, []);
  return phone;
}

const LR_money = (n) => (n == null || n === "" || !isFinite(Number(n)) ? "—" : GLR_config.money(Number(n)));
const LR_usDate = (d) => {
  const p = String(d || "").slice(0, 10).split("-");
  return p.length === 3 ? `${Number(p[1])}/${Number(p[2])}/${p[0]}` : "";
};
const LR_typeLabel = (t) => (GLR_config.TYPES[t] && GLR_config.TYPES[t].label) || t;
const LR_SEV_LABEL = { high: "High", medium: "Medium", low: "Low" };

// Copies text; true when it worked. Falls back to a hidden textarea when the
// async clipboard isn't allowed.
async function LR_copyText(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) {}
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return !!ok;
  } catch (e) {
    return false;
  }
}

// One row of filter chips. chips: [{type, label, n}]; "all" first.
function LR_TypeChips({ chips, current, onSelect, total, idPrefix }) {
  if (!chips || !chips.length) return null;
  const all = [{ type: "all", label: "All", n: total }].concat(chips);
  return (
    <div className="lr-chips" role="group" aria-label="Filter by check">
      {all.map((c) => (
        <button
          key={c.type}
          type="button"
          id={idPrefix ? idPrefix + "-chip-" + c.type : undefined}
          className={"lr-chip" + (current === c.type ? " is-on" : "")}
          aria-pressed={current === c.type}
          onClick={() => onSelect(c.type)}
        >
          {c.label}
          <span className="lr-chip-n">{c.n}</span>
        </button>
      ))}
    </div>
  );
}

// Status tabs (Open / Asked / Cleared) as a tab list.
function LR_StatusTabs({ tabs, current, onSelect, idPrefix, controls }) {
  const onKey = (e) => {
    const i = tabs.findIndex((t) => t.key === current);
    let next = -1;
    if (e.key === "ArrowRight") next = (i + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    if (next < 0) return;
    e.preventDefault();
    onSelect(tabs[next].key);
    const el = document.getElementById(idPrefix + "-tab-" + tabs[next].key);
    if (el) el.focus();
  };
  return (
    <div className="lr-status-tabs" role="tablist" aria-label="Flag status" onKeyDown={onKey}>
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          id={idPrefix + "-tab-" + t.key}
          aria-selected={current === t.key}
          aria-controls={controls}
          tabIndex={current === t.key ? 0 : -1}
          className={"lr-status-tab" + (current === t.key ? " is-on" : "")}
          onClick={() => onSelect(t.key)}
        >
          {t.label}
          <span className="lr-chip-n">{t.n}</span>
        </button>
      ))}
    </div>
  );
}

// The numbers across the top. items: [{label, value, tone?}]
function LR_Strip({ items, note }) {
  return (
    <section className="lr-strip" aria-label="Summary">
      <dl className="lr-strip-list">
        {items.map((it) => (
          <div key={it.label} className={"lr-strip-item" + (it.tone ? " is-" + it.tone : "")}>
            <dt>{it.label}</dt>
            <dd>{it.value}</dd>
          </div>
        ))}
      </dl>
      {note ? <p className="lr-strip-note">{note}</p> : null}
    </section>
  );
}

// Lines behind one flag (from the in-memory pull or the file).
function LR_LineTable({ lines }) {
  if (!lines || !lines.length) return null;
  return (
    <div className="lr-table-wrap">
      <table className="lr-table lr-lines">
        <caption className="lr-sr">Ledger lines behind this flag</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Type</th>
            <th scope="col">No.</th>
            <th scope="col">Name</th>
            <th scope="col">Memo</th>
            <th scope="col">Account</th>
            <th scope="col" className="lr-num">
              Amount
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.slice(0, 50).map((l, i) => (
            <tr key={(l.line || l.key || "") + ":" + i}>
              <td>{LR_usDate(l.date)}</td>
              <td>{l.type}</td>
              <td>{l.num}</td>
              <td>{l.name}</td>
              <td>{l.memo}</td>
              <td>{l.acct}</td>
              <td className="lr-num">{LR_money(l.amt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {lines.length > 50 && <p className="card-subtitle">Showing 50 of {lines.length} lines.</p>}
    </div>
  );
}

// The flag list. flags: stored rows (with .run) or run flags. renderActions(f)
// and renderMeta(f) add the per-row buttons and status lines.
function LR_FlagList({ flags, ym, renderActions, renderMeta, emptyText, idPrefix, selected, onToggle }) {
  const [openId, setOpenId] = useState(null);
  if (!flags.length) return <p className="lr-empty">{emptyText || "Nothing here."}</p>;
  return (
    <ul className="lr-flags" aria-label="Flags">
      {flags.map((f) => {
        const id = f.id || f.txn_key + "|" + f.flag_type;
        const run = f.run || (f._lines ? f : null);
        const lines = run ? run._lines || (run.line ? [run.line] : []) : [];
        const since = ym ? LR_logic.openSince(f, ym) : null;
        const detailsId = (idPrefix || "lr") + "-d-" + String(id).replace(/[^a-zA-Z0-9_-]/g, "_");
        const expanded = openId === id;
        return (
          <li key={id} className={"lr-flag sev-" + f.severity}>
            <div className="lr-flag-main">
              <div className="lr-flag-head">
                {onToggle && f.id && (f.status === "open" || f.status === "asked") && (
                  <input
                    type="checkbox"
                    className="lr-pick"
                    checked={!!(selected && selected.has(f.id))}
                    onChange={() => onToggle(f.id)}
                    aria-label={`Select ${LR_typeLabel(f.flag_type)} ${f.name || f.memo || "flag"}`}
                  />
                )}
                <span className={"lr-sev sev-" + f.severity}>{LR_SEV_LABEL[f.severity] || f.severity}</span>
                <span className="lr-flag-type">{LR_typeLabel(f.flag_type)}</span>
                {since && <span className="lr-since">{since}</span>}
              </div>
              <div className="lr-flag-what">
                <span className="lr-flag-date">{LR_usDate(f.txn_date)}</span>
                <span className="lr-flag-name">{f.name || f.memo || "(no name)"}</span>
                {f.amount != null && <span className="lr-flag-amt">{LR_money(f.amount)}</span>}
              </div>
              <p className="lr-flag-why">{f.why}</p>
              <p className="lr-flag-acct">
                {f.account_name}
                {f.other_side ? " · " + f.other_side : ""}
                {f.class_name ? " · Class: " + f.class_name : ""}
                {f.location_name ? " · Location: " + f.location_name : ""}
              </p>
              {f.name && f.memo ? <p className="lr-flag-memo">Memo: {f.memo}</p> : null}
              {renderMeta ? renderMeta(f) : null}
              {lines.length > 0 && (
                <button
                  type="button"
                  className="link-btn lr-details-btn"
                  aria-expanded={expanded}
                  aria-controls={detailsId}
                  onClick={() => setOpenId(expanded ? null : id)}
                >
                  {expanded ? "Hide lines" : lines.length === 1 ? "Show the line" : `Show ${lines.length} lines`}
                </button>
              )}
              {expanded && (
                <div id={detailsId} className="lr-flag-lines">
                  <LR_LineTable lines={lines} />
                </div>
              )}
            </div>
            {renderActions ? <div className="lr-flag-actions">{renderActions(f)}</div> : null}
          </li>
        );
      })}
    </ul>
  );
}

// Reconciliation per bank, card and loan account (GLR_checks.reconciliation).
function LR_ReconPanel({ recon, hasData, headingId }) {
  const hid = headingId || "lr-recon-h";
  let body;
  if (!hasData) {
    body = <p className="card-subtitle">Pull the ledger to see what hasn't cleared the bank.</p>;
  } else if (!recon || !recon.available) {
    body = <p className="card-subtitle">Not available for this company. QuickBooks didn't send cleared status with this ledger.</p>;
  } else if (!recon.accounts.length) {
    body = <p className="card-subtitle">No bank, credit card or loan accounts in this ledger.</p>;
  } else {
    body = (
      <>
        {recon.loan_issue && (
          <p className="lr-alert" role="note">
            A loan account has items that haven't cleared while the operating accounts look clean. Ask for the latest loan statement.
          </p>
        )}
        {recon.banks_clean === true && !recon.loan_issue && <p className="lr-good">Bank accounts have nothing older than {GLR_config.T.reconStaleDays} days uncleared.</p>}
        <div className="lr-table-wrap">
          <table className="lr-table">
            <caption className="lr-sr">Uncleared items through {LR_usDate(recon.through)}</caption>
            <thead>
              <tr>
                <th scope="col">Account</th>
                <th scope="col" className="lr-num">
                  Uncleared
                </th>
                <th scope="col" className="lr-num">
                  Amount
                </th>
                <th scope="col">Oldest</th>
                <th scope="col" className="lr-num">
                  Over {GLR_config.T.reconStaleDays} days
                </th>
                <th scope="col">Last reconciled</th>
              </tr>
            </thead>
            <tbody>
              {recon.accounts.map((a) => (
                <tr key={(a.acct_id || "") + a.acct} className={a.stale_count > 0 || a.loan_uncleared ? "is-warn" : ""}>
                  <th scope="row">
                    {a.acct}
                    <span className="lr-kind">
                      {a.kind === "bank" ? "Bank" : a.kind === "card" ? "Credit card" : "Loan"}
                      {a.pass_through ? " · pass-through" : ""}
                    </span>
                  </th>
                  <td className="lr-num">{a.open_count}</td>
                  <td className="lr-num">{LR_money(a.open_total)}</td>
                  <td>{a.oldest_date ? LR_usDate(a.oldest_date) : "—"}</td>
                  <td className="lr-num">{a.stale_count ? `${a.stale_count} (${LR_money(a.stale_total)})` : "0"}</td>
                  <td>{a.last_reconciled_date ? LR_usDate(a.last_reconciled_date) : "Never"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );
  }
  return (
    <section className="card lr-panel" aria-labelledby={hid}>
      <h3 className="card-title" id={hid}>
        Reconciliation
      </h3>
      {body}
    </section>
  );
}

// Bars for one account's months, with the average as a dashed line. The
// table beside it carries the same numbers, so the chart is labeled as an
// image with a one-line summary.
function LR_BarChart({ row, ym }) {
  const W = 320;
  const H = 96;
  const g = LR_logic.chartBars(row.series || [], W, H, { avg: row.avg, current: ym, gap: 3 });
  if (!g.bars.length) return null;
  const label = `${row.acct}: ${GLR_config.monthLabel(ym)} ${LR_money(row.cur)}, average ${LR_money(row.avg)} over ${g.bars.length} months.`;
  return (
    <figure className="lr-chart">
      <svg viewBox={`0 0 ${W} ${H + 16}`} role="img" aria-label={label} preserveAspectRatio="none">
        {g.bars.map((b) => (
          <rect
            key={b.ym}
            x={b.x}
            y={b.y}
            width={b.w}
            height={Math.max(b.h, 1)}
            className={"lr-bar" + (b.current ? " is-current" : "") + (b.neg ? " is-neg" : "")}
          >
            <title>
              {GLR_config.monthLabel(b.ym)}: {LR_money(b.value)}
            </title>
          </rect>
        ))}
        {g.avgY != null && <line x1="0" x2={W} y1={g.avgY} y2={g.avgY} className="lr-avg-line" />}
        <text x="0" y={H + 13} className="lr-chart-axis">
          {GLR_config.monthLabel(g.bars[0].ym)}
        </text>
        <text x={W} y={H + 13} textAnchor="end" className="lr-chart-axis">
          {GLR_config.monthLabel(g.bars[g.bars.length - 1].ym)}
        </text>
      </svg>
      <figcaption className="card-subtitle">
        Bars are each month's total; the dashed line is the average. {GLR_config.monthLabel(ym)} is darker.
      </figcaption>
    </figure>
  );
}

const LR_CMP_TONE = { new: "warn", miss: "warn", up: "warn", down: "warn", ok: "ok" };

// "Month vs. the year" (GLR_compare.compareMonth rows; P&L only, pass-through
// accounts already left out).
function LR_ComparePanel({ rows, ym, hasData, onCopy, headingId, passThroughCount }) {
  const hid = headingId || "lr-cmp-h";
  const [showAll, setShowAll] = useState(false);
  const [picked, setPicked] = useState(null);
  const moved = (rows || []).filter((r) => r.status !== "ok");
  const shown = showAll ? rows || [] : moved;
  const pickedRow = (rows || []).find((r) => (r.acct_id || r.acct) === picked) || moved[0] || null;
  let body;
  if (!hasData) body = <p className="card-subtitle">Pull the ledger to compare this month with the rest of the year.</p>;
  else if (!rows || !rows.length) body = <p className="card-subtitle">No income or expense activity to compare.</p>;
  else
    body = (
      <>
        <p className="card-subtitle">
          Income and expense accounts only.
          {passThroughCount ? ` ${passThroughCount} pass-through account${passThroughCount === 1 ? " is" : "s are"} left out.` : ""}{" "}
          {moved.length ? `${moved.length} account${moved.length === 1 ? "" : "s"} moved outside the usual range.` : "Everything is in the usual range."}
        </p>
        {pickedRow && <LR_BarChart row={pickedRow} ym={ym} />}
        <div className="lr-table-wrap">
          <table className="lr-table lr-cmp">
            <caption className="lr-sr">
              {GLR_config.monthLabel(ym)} compared with the average month. Pick an account to chart it.
            </caption>
            <thead>
              <tr>
                <th scope="col">Account</th>
                <th scope="col" className="lr-num">
                  {GLR_config.monthLabel(ym).split(" ")[0]}
                </th>
                <th scope="col" className="lr-num">
                  Average
                </th>
                <th scope="col" className="lr-num">
                  Difference
                </th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const key = r.acct_id || r.acct;
                const on = pickedRow && (pickedRow.acct_id || pickedRow.acct) === key;
                return (
                  <tr key={key} className={on ? "is-picked" : ""}>
                    <th scope="row">
                      <button type="button" className="link-btn lr-cmp-pick" aria-pressed={!!on} onClick={() => setPicked(key)}>
                        {r.acct}
                      </button>
                      {r.oneTime ? <span className="lr-kind">One-time</span> : null}
                      {r.seasonal ? <span className="lr-kind">Seasonal</span> : null}
                    </th>
                    <td className="lr-num">{LR_money(r.cur)}</td>
                    <td className="lr-num">{LR_money(r.avg)}</td>
                    <td className="lr-num">
                      {LR_money(r.diff)}
                      {r.pct != null && isFinite(r.pct) ? <span className="lr-pct"> ({Math.round(r.pct)}%)</span> : null}
                    </td>
                    <td>
                      <span className={"lr-cmp-status is-" + (LR_CMP_TONE[r.status] || "ok")}>{LR_logic.compareStatusLabel(r.status)}</span>
                    </td>
                  </tr>
                );
              })}
              {!shown.length && (
                <tr>
                  <td colSpan={5} className="card-subtitle">
                    Nothing moved outside the usual range.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="lr-panel-foot">
          <button type="button" className="link-btn" aria-pressed={showAll} onClick={() => setShowAll(!showAll)}>
            {showAll ? "Show only accounts that moved" : `Show all ${rows.length} accounts`}
          </button>
          {onCopy && (
            <button type="button" className="btn-secondary lr-btn-sm" onClick={() => onCopy(rows)}>
              Copy for Excel
            </button>
          )}
        </div>
      </>
    );
  return (
    <section className="card lr-panel" aria-labelledby={hid}>
      <h3 className="card-title" id={hid}>
        Month vs. the year
      </h3>
      {body}
    </section>
  );
}
