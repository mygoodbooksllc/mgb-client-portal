// components/ledger/LR_ReviewFile.jsx — Work › Ledger review › Review a file.
// docs/gl-review-spec.md section 8. For any staff member, any client, any
// exported QuickBooks General Ledger (.csv or .xlsx).
//
//   LR_ReviewFilePage({ staffUser })
//
// Everything runs in this browser tab: GLR_parse.parseFile reads the file,
// GLR_checks runs the checks, and nothing is saved anywhere (no flags, no
// rules, no browser storage). Closing or leaving the page drops it. The one
// read is the firm's watch list (gl_review_watch_vendors); if that fails the
// built-in starter list is used.

const LR_FILE_ACCEPT = ".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel";

function LR_ReviewFilePage({ staffUser }) {
  const showToast = typeof useToast === "function" ? useToast() : null;
  const toast = (m) => showToast && showToast(m);
  const [file, setFile] = useState(null); // parsed result
  const [phase, setPhase] = useState("idle"); // idle | reading | done | error
  const [err, setErr] = useState("");
  const [drag, setDrag] = useState(false);
  const [watch, setWatch] = useState(undefined);
  // Firm default for Possible duplicates (files aren't tied to a client, so no override).
  const [dupMode, setDupMode] = useState("smart");
  const [edits, setEdits] = useState({ passThrough: {}, types: {} });
  const [ym, setYm] = useState("");
  const [onlyMonth, setOnlyMonth] = useState(false);
  const [type, setType] = useState("all");
  const [showAccounts, setShowAccounts] = useState(false);
  const inputRef = useRef(null);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  useEffect(() => {
    if (typeof LR_api === "undefined") return;
    LR_api.loadWatchVendors()
      .then((w) => alive.current && setWatch(w && w.length ? w : undefined))
      .catch(() => {});
    LR_api.loadFirmDupMode()
      .then((m) => alive.current && setDupMode(m))
      .catch(() => {});
  }, []);

  const read = async (f) => {
    if (!f) return;
    setPhase("reading");
    setErr("");
    setFile(null);
    setEdits({ passThrough: {}, types: {} });
    setType("all");
    try {
      const out = await GLR_parse.parseFile(f);
      if (!alive.current) return;
      const months = Array.from(new Set(out.lines.map((l) => String(l.date).slice(0, 7)))).sort().reverse();
      setFile({ ...out, months });
      setYm(months[0] || "");
      setPhase("done");
    } catch (e) {
      if (!alive.current) return;
      setErr((e && e.message) || "Couldn't read that file.");
      setPhase("error");
    }
  };
  const onPick = (e) => {
    const f = e.target.files && e.target.files[0];
    read(f);
    e.target.value = "";
  };
  const onDrop = (e) => {
    e.preventDefault();
    setDrag(false);
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    read(f);
  };
  const reset = () => {
    setFile(null);
    setPhase("idle");
    setErr("");
    setEdits({ passThrough: {}, types: {} });
  };

  const rules = useMemo(() => LR_logic.fileRules(edits), [edits]);
  const run = useMemo(() => {
    if (!file || !ym) return null;
    return GLR_checks.runChecks(file.lines, {
      rules,
      watchVendors: watch,
      clearedAvailable: file.cleared_available,
      reviewPeriod: ym,
      dupMode,
    });
  }, [file, rules, watch, ym, dupMode]);

  const flags = useMemo(
    () => (run ? run.flags.map((f) => ({ ...f, id: null, status: "open", first_period: f.period, run: f })) : []),
    [run],
  );
  const inView = (f) => !onlyMonth || LR_logic.ymOf(f.period) === ym;
  const base = flags.filter(inView);
  const chips = LR_logic.typeCounts(base, ym, "open");
  const shown = LR_logic.viewFlags(base, { ym, tab: "open", type });
  const counts = LR_logic.tabCounts(base, ym);
  const compare = useMemo(() => {
    if (!run) return null;
    return GLR_compare.compareMonth(run.lines, ym, {
      rules,
      passThrough: run.passThrough,
      lastCompleteMonth: file && file.months[0],
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, ym]);
  const holding = useMemo(() => (run ? LR_logic.holdingSplit(GLR_checks.holdingTotals(run.lines, { period: ym })) : null), [run, ym]);

  useEffect(() => {
    if (type !== "all" && !chips.some((c) => c.type === type)) setType("all");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ym, onlyMonth, chips.length]);

  // Accounts in the file, with the type the checks are using.
  const accounts = useMemo(() => {
    if (!run) return [];
    const m = new Map();
    run.lines.forEach((l) => {
      if (!m.has(l.acct)) m.set(l.acct, { acct: l.acct, acct_type: l.acct_type, source: l.acct_type_source, classification: l.classification, n: 0 });
      m.get(l.acct).n += 1;
    });
    return Array.from(m.values()).sort((a, b) => a.acct.localeCompare(b.acct));
  }, [run]);
  const ptNames = new Set(((run && run.passThrough) || []).map((a) => a.acct));
  const weakGuesses = accounts.filter((a) => a.source === "guess_default").length;

  const setTypeFor = (acct, t) => setEdits((e) => ({ ...e, types: { ...e.types, [acct]: t || undefined } }));
  const setPtFor = (acct, on) => setEdits((e) => ({ ...e, passThrough: { ...e.passThrough, [acct]: on } }));

  const copyFlags = async () => {
    const ok = await LR_copyText(LR_logic.flagsToTsv(shown));
    toast(ok ? `Copied ${shown.length} flag${shown.length === 1 ? "" : "s"}. Paste into Excel.` : "Couldn't copy. Try again.");
  };

  const intro = (
    <p className="card-subtitle">
      Check an exported General Ledger for any client, connected or not. Export it from QuickBooks Online (Reports › General Ledger, as Excel or
      CSV) and drop it here. The file is read in this browser tab only. Nothing is uploaded or saved, and it's gone when you leave the page.
    </p>
  );

  const drop = (
    <div
      className={"lr-drop" + (drag ? " is-drag" : "")}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={onDrop}
    >
      <p className="lr-drop-text">Drop a General Ledger file here, or</p>
      <button type="button" className="btn-primary" onClick={() => inputRef.current && inputRef.current.click()} disabled={phase === "reading"}>
        {phase === "reading" ? "Reading…" : "Choose a file"}
      </button>
      <input
        ref={inputRef}
        id="lr-file-input"
        type="file"
        accept={LR_FILE_ACCEPT}
        className="lr-sr"
        tabIndex={-1}
        aria-label="General Ledger file"
        onChange={onPick}
      />
      <p className="lr-hint">.csv or .xlsx, up to 25 MB</p>
    </div>
  );

  if (!file) {
    return (
      <div className="lr-page lr-file-page">
        <section className="card lr-panel" aria-labelledby="lr-file-h">
          <h3 className="card-title" id="lr-file-h">
            Review a file
          </h3>
          {intro}
          {drop}
          {phase === "reading" && (
            <p className="lr-note" role="status">
              Reading the file…
            </p>
          )}
          {phase === "error" && (
            <p className="lr-error" role="alert">
              {err}
            </p>
          )}
        </section>
      </div>
    );
  }

  const fileFacts = [file.file_name, file.company, file.period, file.basis ? file.basis[0].toUpperCase() + file.basis.slice(1) + " basis" : ""]
    .filter(Boolean)
    .join(" · ");
  const monthLines = run ? run.lines.filter((l) => String(l.date).slice(0, 7) === ym).length : 0;

  return (
    <div className="lr-page lr-file-page">
      <section className="card lr-panel" aria-labelledby="lr-file-h">
        <div className="lr-panel-head">
          <h3 className="card-title" id="lr-file-h">
            Review a file
          </h3>
          <button type="button" className="btn-secondary lr-btn-sm" onClick={reset}>
            Check another file
          </button>
        </div>
        <p className="lr-file-facts">{fileFacts}</p>
        <p className="lr-hint">
          {file.lines.length.toLocaleString()} ledger lines read. Nothing is saved: flags here can't be cleared or sent to the client. For a
          connected client, use the client's Ledger review tab.
        </p>
        {(file.warnings || []).length > 0 && (
          <ul className="lr-note is-warn" aria-label="Warnings about the file">
            {file.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        )}
        {!file.cleared_available && (
          <p className="lr-hint">This export has no Clr column, so the reconciliation check is off. Add the Clr column in QuickBooks to turn it on.</p>
        )}
        <div className="lr-toolbar">
          <label className="lr-month">
            <span className="lr-month-label">Month</span>
            <select className="lr-select" value={ym} onChange={(e) => setYm(e.target.value)}>
              {file.months.map((m) => (
                <option key={m} value={m}>
                  {GLR_config.monthLabel(m)}
                </option>
              ))}
            </select>
          </label>
          <label className="lr-check lr-check-inline">
            <input type="checkbox" checked={onlyMonth} onChange={(e) => setOnlyMonth(e.target.checked)} />
            <span>Only flags from this month</span>
          </label>
        </div>
      </section>

      <LR_Strip
        items={[
          { label: "Lines this month", value: monthLines.toLocaleString() },
          { label: "Flags", value: counts.open },
          { label: "High priority", value: counts.high, tone: counts.high ? "bad" : null },
          { label: "Uncategorized", value: holding ? LR_money(holding.uncategorized.total) : "—", tone: holding && holding.uncategorized.total ? "warn" : null },
          { label: "Ask Client", value: holding ? LR_money(holding.ask.total) : "—", tone: holding && holding.ask.total ? "warn" : null },
        ]}
        note={onlyMonth ? `Flags from ${GLR_config.monthLabel(ym)} only.` : `Flags from ${GLR_config.monthLabel(ym)} and earlier months in the file.`}
      />

      <section className="card lr-panel lr-flags-card" aria-labelledby="lr-file-flags-h">
        <div className="lr-panel-head">
          <h3 className="card-title" id="lr-file-flags-h">
            Flags
          </h3>
          {shown.length > 0 && (
            <button type="button" className="btn-secondary lr-btn-sm" onClick={copyFlags}>
              Copy for Excel
            </button>
          )}
        </div>
        <LR_TypeChips chips={chips} current={type} onSelect={setType} total={chips.reduce((s, c) => s + c.n, 0)} idPrefix="lrf" />
        <LR_FlagList flags={shown} ym={ym} emptyText={`Nothing flagged${onlyMonth ? " for " + GLR_config.monthLabel(ym) : ""}.`} idPrefix="lrf" />
      </section>

      <div className="lr-grid">
        <LR_ReconPanel recon={run ? run.recon : null} hasData={!!run} headingId="lrf-recon-h" />
        <LR_ComparePanel
          rows={compare}
          ym={ym}
          hasData={!!run}
          headingId="lrf-cmp-h"
          passThroughCount={ptNames.size}
          onCopy={async (rows) => toast((await LR_copyText(LR_logic.compareToTsv(rows, ym))) ? "Copied. Paste into Excel." : "Couldn't copy. Try again.")}
        />
      </div>

      <section className="card lr-panel" aria-labelledby="lrf-accts-h">
        <div className="lr-panel-head">
          <h3 className="card-title" id="lrf-accts-h">
            Account types
          </h3>
          <button
            type="button"
            className="btn-secondary lr-btn-sm"
            aria-expanded={showAccounts}
            aria-controls="lrf-accts"
            onClick={() => setShowAccounts((v) => !v)}
          >
            {showAccounts ? "Hide accounts" : `Show ${accounts.length} accounts`}
          </button>
        </div>
        <p className="card-subtitle">
          An export doesn't say what type each account is, so the type is guessed from the name.
          {weakGuesses > 0 ? ` ${weakGuesses} account${weakGuesses === 1 ? " was" : "s were"} a weak guess (marked below).` : ""} Fix any
          that are wrong and the checks rerun. These changes last until you leave the page.
        </p>
        {showAccounts && (
          <div id="lrf-accts" className="lr-table-wrap">
            <table className="lr-table lr-accts">
              <caption className="lr-sr">Accounts in the file, their type and pass-through setting</caption>
              <thead>
                <tr>
                  <th scope="col">Account</th>
                  <th scope="col">Type</th>
                  <th scope="col">Pass-through</th>
                  <th scope="col" className="lr-num">
                    Lines
                  </th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a, i) => {
                  const pl = GLR_config.isPL(a.classification);
                  const selId = "lrf-type-" + i;
                  return (
                    <tr key={a.acct}>
                      <th scope="row">
                        <label htmlFor={selId}>{a.acct}</label>
                        {a.source === "guess_default" && <span className="lr-kind is-warn">Weak guess</span>}
                        {a.source === "override" && <span className="lr-kind">Changed</span>}
                      </th>
                      <td>
                        <select id={selId} className="lr-select lr-select-sm" value={a.acct_type || ""} onChange={(e) => setTypeFor(a.acct, e.target.value)}>
                          {GLR_config.ACCOUNT_TYPES.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        {pl ? (
                          <span className="lr-hint">Not for income or expense accounts</span>
                        ) : (
                          <label className="lr-check lr-check-inline">
                            <input type="checkbox" checked={ptNames.has(a.acct)} onChange={(e) => setPtFor(a.acct, e.target.checked)} />
                            <span className="lr-sr">{a.acct} is a pass-through account</span>
                            <span aria-hidden="true">{ptNames.has(a.acct) ? "Yes" : "No"}</span>
                          </label>
                        )}
                      </td>
                      <td className="lr-num">{a.n.toLocaleString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
