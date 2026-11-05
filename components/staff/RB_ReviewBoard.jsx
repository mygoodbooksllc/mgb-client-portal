// ----------------------------------------------------------------------------
// RB_ReviewBoard: Work › Review board (#/work/review) and the email draft
// extras (docs/review-board-spec.md sections 3c-3e and 5). Real admins only,
// hidden behind the one gate in RB_gate.js (RB_on / RB_useOn).
//
//   RB_ReviewBoardPage({ staffUser, clients, taskClients, viewingAs })
//     WorkPage mounts it for the "review" tab. Gate off or View as: null.
//     One rb_board call per month (rbApi.board), plus the Close tracker's own
//     CT_useCloseStatus for the Close column (no new SQL, same labels and
//     late rule). A 42501 renders nothing: no error banner with details.
//     ?period=YYYY-MM in the hash picks one of the last 3 months (the bell's
//     Deadline digest links here that way).
//   RB_useEmailExtras({ task, subject, body, ready })
//     TK_EmailDraftModal calls it on every render (the function either exists
//     for the whole session or never does). Off: no state change, no fetch,
//     nothing drawn, so the modal is exactly as before. On: To/Cc chips,
//     Copy draft, Open in email app and Mark sent. DRAFT ONLY: nothing here
//     sends anything; Open in email app hands a mailto: link to the person's
//     own email app.
//
// All pure logic (chips, sort, filters, mailto) is in RB_logic.js and
// node-tested. Loads after CloseTracker.jsx and before WorkPage.jsx; shares
// the global scope, so top-level names carry an RB_ prefix and app.jsx
// globals are only touched at render time.
// ----------------------------------------------------------------------------

const RB_SORT_STORE = "mgb_rb_sort";
const RB_CHANGED_EVENT = "mgb:rb-changed"; // Mark sent / Undo: the board reloads

function RB__readSort() {
  try {
    const v = JSON.parse(window.localStorage.getItem(RB_SORT_STORE) || "null");
    if (v && RB_SORT_KEYS.indexOf(v.key) >= 0) return { key: v.key, dir: v.dir === "desc" ? "desc" : "asc" };
  } catch (e) {}
  return { key: "client", dir: "asc" };
}
function RB__saveSort(s) {
  try {
    window.localStorage.setItem(RB_SORT_STORE, JSON.stringify(s));
  } catch (e) {}
}

function RB__taskHref(id) {
  return typeof TK_dwTaskHref === "function" ? TK_dwTaskHref(id) : "#/tasks/my?item=task:" + encodeURIComponent(String(id));
}

function RB__toast(text) {
  if (typeof TK_toast === "function") TK_toast(text);
}

// One deadline chip. A chip with a task opens it in the task drawer (a plain
// link too, so a new tab works); "No task yet" is plain text.
function RB_Chip({ chip, partLabel, clientName, tour }) {
  const cls = "rb-chip ct-s-" + chip.tone + (chip.state === "late" ? " late" : "");
  const body = (
    <>
      <span className="rb-chip-label">{chip.label}</span>
      {chip.sent ? <span className="rb-chip-sent">{chip.sent}</span> : null}
    </>
  );
  if (!chip.id)
    return (
      <span className={cls} data-tour={tour || undefined}>
        {body}
      </span>
    );
  const title = clientName + " · " + partLabel + ": " + chip.label + (chip.sent ? " · " + chip.sent : "") + ". Opens the task.";
  return (
    <a className={cls} data-tour={tour || undefined} href={RB__taskHref(chip.id)} onClick={typeof TK_openTaskClick === "function" ? TK_openTaskClick(chip.id) : undefined} title={title}>
      {body}
    </a>
  );
}

// The expander row: the main contact, then every portal login (active first,
// inactive dimmed).
// A mailto link only for an address that passes the shared email rule
// (RB_mailto drops anything else); otherwise plain text.
function RB_mailLink(email) {
  const href = RB_mailto({ to: [email] }).href;
  return href !== "mailto:" ? <a href={href}>{email}</a> : <span>{email}</span>;
}

// Client contacts gate on (row.contactList from cc__people): one "People"
// block with where each person came from. Off: the blocks below, unchanged.
function RB_PeopleBlock({ list }) {
  const label = (p) => (typeof OPC_sourceLabel === "function" ? OPC_sourceLabel(p) : "");
  return (
    <div className="rb-exp-block">
      <span className="rb-exp-label">People</span>
      {list.length ? (
        <ul className="rb-exp-list">
          {list.map((p, i) => (
            <li key={(p.email || "") + "|" + i} className={p.opted_out ? "rb-inactive" : ""}>
              {p.name ? <strong>{p.name}</strong> : null}
              {p.email ? RB_mailLink(p.email) : null}
              {p.phone ? <span>{p.phone}</span> : null}
              {p.title || p.role ? <span className="rb-exp-note">{p.title || p.role}</span> : null}
              {label(p) ? <span className="rb-exp-note">{label(p)}</span> : null}
              {p.source === "login" && p.is_main ? <span className="rb-exp-note">first portal login</span> : null}
              {p.gets_monthly_emails ? <span className="rb-exp-note">monthly emails</span> : null}
              {p.can_answer ? <span className="rb-exp-note">can answer</span> : null}
              {p.added_by_client ? <span className="rb-exp-note">Added by client</span> : null}
              {p.opted_out ? <span className="rb-exp-note">opted out</span> : null}
            </li>
          ))}
        </ul>
      ) : (
        <span className="rb-exp-line rb-exp-note">No people yet</span>
      )}
    </div>
  );
}

function RB_ContactExpander({ row }) {
  const c = row.contact;
  if (Array.isArray(row.contactList)) {
    return (
      <div className="rb-expander" data-tour="rb-expander">
        <RB_PeopleBlock list={row.contactList} />
      </div>
    );
  }
  return (
    <div className="rb-expander" data-tour="rb-expander">
      <div className="rb-exp-block">
        <span className="rb-exp-label">Main contact</span>
        {c ? (
          <span className="rb-exp-line">
            {c.name ? <strong>{c.name}</strong> : null}
            {c.email ? RB_mailLink(c.email) : null}
            {c.phone ? <span>{c.phone}</span> : null}
            {c.source === "login" ? <span className="rb-exp-note">first portal login</span> : null}
          </span>
        ) : (
          <span className="rb-exp-line rb-exp-note">Not set</span>
        )}
      </div>
      <div className="rb-exp-block">
        <span className="rb-exp-label">Portal logins</span>
        {row.logins.length ? (
          <ul className="rb-exp-list">
            {row.logins.map((u) => (
              <li key={u.email} className={u.active ? "" : "rb-inactive"}>
                {u.name ? <strong>{u.name}</strong> : null}
                <span>{u.email}</span>
                {u.role ? <span className="rb-exp-note">{u.role}</span> : null}
                {!u.active ? <span className="rb-exp-note">inactive</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <span className="rb-exp-line rb-exp-note">No portal logins</span>
        )}
      </div>
    </div>
  );
}

// The filters above the table (plain selects, same look as the Close tracker).
function RB_Toolbar({ period, options, onPeriod, bk, setBk, bookkeepers, status, setStatus, showTest, setShowTest, onRefresh, loading }) {
  return (
    <div className="ct-toolbar rb-toolbar" data-tour="rb-filters">
      <label className="ct-field">
        <span>Month</span>
        <select value={period} onChange={(e) => onPeriod(e.target.value)}>
          {options.map((p) => (
            <option key={p} value={p}>
              {CT_monthLabel(p, true)}
            </option>
          ))}
        </select>
      </label>
      <label className="ct-field">
        <span>Bookkeeper</span>
        <select value={bk} onChange={(e) => setBk(e.target.value)}>
          <option value="all">All</option>
          {bookkeepers.map((b) => (
            <option key={b.key} value={b.key}>
              {b.label}
            </option>
          ))}
          <option value="unassigned">Unassigned</option>
        </select>
      </label>
      <label className="ct-field">
        <span>Status</span>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          {RB_STATUS_FILTERS.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <label className="rb-check">
        <input type="checkbox" checked={showTest} onChange={(e) => setShowTest(e.target.checked)} />
        <span>Show test clients</span>
      </label>
      <button type="button" className="btn-secondary rb-refresh" onClick={onRefresh} disabled={loading}>
        {loading ? "Loading…" : "Refresh"}
      </button>
    </div>
  );
}

const RB_COLUMNS = [
  { key: "client", label: "Client" },
  { key: "bookkeeper", label: "Bookkeeper" },
  { key: "backup", label: "Backup" },
  { key: "contact", label: "Main contact" },
  { key: "check_in", part: true },
  { key: "reports", part: true },
  { key: "follow_up", part: true },
  { key: "close", label: "Close" },
];

// The page. The gate is checked here, before any hook that reads data, so
// with the board off nothing loads.
function RB_ReviewBoardPage({ staffUser, clients, taskClients, viewingAs }) {
  const on = typeof RB_useOn === "function" ? RB_useOn() : false;
  if (!on || viewingAs) return null;
  return <RB_Board staffUser={staffUser} clients={clients} taskClients={taskClients} />;
}

function RB_Board({ staffUser, clients, taskClients }) {
  const close = CT_useCloseStatus(clients, staffUser);
  // Client contacts gate (re-renders when the switch cache or preview changes).
  const contactsOn = typeof OPC_useGate === "function" ? OPC_useGate() : false;
  const options = useMemo(() => RB_periodOptions(close.focus), [close.focus]);
  const [period, setPeriod] = useState(() => RB_periodFromHash(window.location.hash, options) || close.focus);
  const [res, setRes] = useState({ state: "loading", data: null });
  const [reloadTick, setReloadTick] = useState(0);
  const [sort, setSort] = useState(RB__readSort);
  const [bk, setBk] = useState("all");
  const [status, setStatus] = useState("all");
  const [showTest, setShowTest] = useState(false);
  const [open, setOpen] = useState(() => new Set());

  // The bell (and any deep link) can change ?period= while the page is open.
  useEffect(() => {
    const on = () => {
      const p = RB_periodFromHash(window.location.hash, options);
      if (p) setPeriod(p);
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, [options]);

  // Mark sent / Undo in an email draft: reload so the chip's second line shows.
  useEffect(() => {
    const on = () => setReloadTick((n) => n + 1);
    window.addEventListener(RB_CHANGED_EVENT, on);
    return () => window.removeEventListener(RB_CHANGED_EVENT, on);
  }, []);

  useEffect(() => {
    let live = true;
    setRes((r) => ({ state: "loading", data: r.data && String(r.data.period).slice(0, 10) === period ? r.data : null }));
    rbApi.board(period).then((r) => {
      if (!live) return;
      if (r.forbidden) setRes({ state: "forbidden", data: null });
      else if (r.error || !r.data) setRes({ state: "error", data: null });
      else setRes({ state: "ok", data: r.data });
    });
    return () => {
      live = false;
    };
  }, [period, reloadTick]);

  const pickPeriod = (p) => {
    setPeriod(p);
    // Keep the month in the address without a history entry (NAV_useHashSub
    // does the same for tabs).
    try {
      window.history.replaceState(null, "", "#/work/review?period=" + p.slice(0, 7));
    } catch (e) {}
  };

  const byId = useMemo(() => {
    const m = {};
    (taskClients || clients || []).forEach((c) => {
      if (c && c.id) m[c.id] = c;
    });
    return m;
  }, [taskClients, clients]);

  const rows = useMemo(() => {
    const d = res.data;
    if (!d || !Array.isArray(d.clients)) return [];
    return d.clients.map((r) => {
      const c = byId[r.client_id] || null;
      const mc = close.rows[r.client_id + "|" + period];
      return RB_rowModel(
        r,
        c,
        { status: close.statusOf(r.client_id, period), late: close.isLate(r.client_id, period), signedOff: (mc && mc.signed_off_by) || null },
        {
          today: d.today,
          bk: c ? { name: CT_bookkeeperOf(c), key: CT_bookkeeperKey(c) } : null,
          contactsOn: contactsOn,
        },
      );
    });
    // eslint-disable-next-line
  }, [res.data, byId, close.rows, close.lateDay, period, contactsOn]);

  const bookkeepers = useMemo(() => {
    const seen = {};
    rows.forEach((r) => {
      if (r.bkKey && !seen[r.bkKey]) seen[r.bkKey] = r.bkName || r.bkKey.replace(/^(email|name):/, "");
    });
    return Object.keys(seen)
      .map((key) => ({ key, label: seen[key] }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [rows]);

  const visible = useMemo(() => RB_sortRows(RB_filterRows(rows, { bk, status, showTest }), sort.key, sort.dir), [rows, bk, status, showTest, sort]);

  if (res.state === "forbidden") return null;

  const d = res.data;
  const rhythm = d ? d.rhythm : null;
  const today = d ? d.today : null;
  const part = RB_currentPart(rhythm, today, period);
  const labels = {};
  RB_PARTS.forEach((k) => {
    labels[k] = RB_partLabel(k, rhythm);
  });
  const shown = RB_filterRows(rows, { showTest });
  const anyTask = shown.some((r) => RB_PARTS.some((k) => r.chips[k].state !== "none"));

  const onSort = (key) => {
    const next = sort.key === key ? { key, dir: sort.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" };
    setSort(next);
    RB__saveSort(next);
  };
  const toggle = (id) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const header = (col) => {
    const label = col.part ? labels[col.key] : col.label;
    const active = sort.key === col.key;
    return (
      <th
        key={col.key}
        scope="col"
        className={col.key === "client" ? "ct-client-col rb-col-client" : "rb-col"}
        aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
      >
        <button type="button" className="rb-sort" onClick={() => onSort(col.key)} title={"Sort by " + label}>
          {label}
          <span className="rb-sort-mark" aria-hidden="true">
            {active ? (sort.dir === "asc" ? "▲" : "▼") : ""}
          </span>
        </button>
      </th>
    );
  };

  return (
    <div className="ct-page rb-page">
      <div className="card ct-toolbar-card">
        <RB_Toolbar
          period={period}
          options={options}
          onPeriod={pickPeriod}
          bk={bk}
          setBk={setBk}
          bookkeepers={bookkeepers}
          status={status}
          setStatus={setStatus}
          showTest={showTest}
          setShowTest={setShowTest}
          onRefresh={() => setReloadTick((n) => n + 1)}
          loading={res.state === "loading"}
        />
        {d ? <p className="rb-topline">{RB_topLine(visible, part, rhythm)}</p> : null}
      </div>

      <div className="card ct-grid-card">
        {res.state === "error" ? (
          <p className="card-subtitle">Couldn't load the Review board. Try Refresh in a moment.</p>
        ) : !d ? (
          <p className="card-subtitle">Loading…</p>
        ) : !anyTask ? (
          <p className="card-subtitle">
            {"No rhythm tasks for " + RB_monthName(period) + " yet."}
            {showTest ? "" : " To try it while the month rhythm is off, run Make due tasks now on a test client and turn on Show test clients."}
          </p>
        ) : visible.length === 0 ? (
          <p className="card-subtitle">No clients match these filters.</p>
        ) : (
          <div className="ct-scroll mgb-sticky-wrap" tabIndex={0} aria-label="Review board, scrolls sideways" data-tour="rb-table">
            <table className="ct-grid rb-grid">
              <thead>
                <tr>
                  {RB_COLUMNS.map(header)}
                  <th scope="col" className="rb-col rb-col-approve" title="Coming later">
                    Approve
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r, rowIndex) => {
                  const isOpen = open.has(r.id);
                  const cl = r.close;
                  const st = CT_STATUSES.find((s) => s.key === cl.status) || CT_STATUSES[0];
                  return (
                    <React.Fragment key={r.id}>
                      <tr className={isOpen ? "rb-row open" : "rb-row"}>
                        <th scope="row" className="ct-client-col rb-col-client">
                          <span className="rb-client">
                            <button
                              type="button"
                              className="rb-expand"
                              aria-expanded={isOpen}
                              aria-controls={"rb-exp-" + r.id}
                              aria-label={(isOpen ? "Hide" : "Show") + " contacts for " + r.name}
                              onClick={() => toggle(r.id)}
                            >
                              <span aria-hidden="true">{isOpen ? "▾" : "▸"}</span>
                            </button>
                            <a className="ct-client-name" href={TB_clientHash(r.id)} title={"Open " + r.name}>
                              {r.name}
                            </a>
                          </span>
                          {r.test || r.internal ? <span className="ct-client-bk">{r.internal ? "Internal" : "Test client"}</span> : null}
                        </th>
                        <td className="rb-text">{r.bkName || <span className="rb-muted">Unassigned</span>}</td>
                        <td className="rb-text">{r.backupName || <span className="rb-muted">—</span>}</td>
                        <td className="rb-text">{r.contactName || <span className="rb-muted">Not set</span>}</td>
                        {RB_PARTS.map((k) => (
                          <td key={k} className="rb-cell">
                            <RB_Chip chip={r.chips[k]} partLabel={labels[k]} clientName={r.name} tour={rowIndex === 0 && k === RB_PARTS[0] ? "rb-chip" : null} />
                          </td>
                        ))}
                        <td className="rb-cell">
                          <a
                            className={"ct-pill ct-s-" + cl.status + (cl.late ? " late" : "")}
                            href={TB_clientHash(r.id, "close")}
                            title={r.name + " · " + CT_monthLabel(period, true) + ": " + st.label + (cl.late ? " (late)" : "") + (cl.signedOff ? " · signed off" : "")}
                          >
                            <span className="ct-pill-status">{cl.late && cl.status === "not_started" ? "Late" : st.short}</span>
                            {cl.signedOff ? <span className="ct-pill-who">signed off</span> : null}
                          </a>
                        </td>
                        <td className="rb-cell rb-approve" title="Coming later">
                          <span className="rb-muted">—</span>
                        </td>
                      </tr>
                      {isOpen ? (
                        <tr className="rb-exp-row" id={"rb-exp-" + r.id}>
                          <td colSpan={RB_COLUMNS.length + 1}>
                            <RB_ContactExpander row={r} />
                          </td>
                        </tr>
                      ) : null}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ---- Email draft extras (spec section 5) ------------------------------------

// My email for the Cc rule ("on unless it is me"), from the signed-in session.
function RB__myEmail(c) {
  try {
    if (!c || !c.auth || typeof c.auth.getSession !== "function") return Promise.resolve("");
    return c.auth.getSession().then(
      (r) => (r && r.data && r.data.session && r.data.session.user && r.data.session.user.email) || "",
      () => "",
    );
  } catch (e) {
    return Promise.resolve("");
  }
}

// -> { on, hideSuggestedCc, top, footer }. top goes above Subject, footer
// after the existing buttons. Off (gate off, not loaded, 42501, error): every
// field is null/false and the modal draws what it drew before.
function RB_useEmailExtras({ task, subject, body, ready }) {
  const gate = typeof RB_useOn === "function" ? RB_useOn() : false;
  const taskId = task && task.id ? task.id : null;
  const on = gate && !!taskId;
  const [load, setLoad] = useState({ state: "idle", chips: null });
  const [sel, setSel] = useState({});
  const [sent, setSent] = useState(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!on) return undefined;
    let live = true;
    setLoad({ state: "loading", chips: null });
    setSent(null);
    setNote("");
    Promise.all([rbApi.draftRecipients(taskId), RB__myEmail(window.mgbSupabase)]).then(([r, me]) => {
      if (!live) return;
      if (r.error || !r.data) {
        setLoad({ state: "off", chips: null });
        return;
      }
      const chips = RB_recipientChips(r.data, me, { contactsOn: typeof OPC_isOn === "function" && OPC_isOn() });
      const s = {};
      chips.to.concat(chips.cc).forEach((x) => {
        s[x.email] = x.on;
      });
      setSel(s);
      // Already marked sent (reopened draft): show who and when.
      const was = r.data.sent;
      setSent(was && was.at ? { by: was.by, byName: was.by_name || "", at: was.at } : null);
      setLoad({ state: "ok", chips, me: String(me || "").toLowerCase() });
    });
    return () => {
      live = false;
    };
  }, [on, taskId]);

  if (!on || load.state !== "ok") return { on: false, hideSuggestedCc: false, top: null, footer: null };

  const chips = load.chips;
  const picked = (list) => list.filter((x) => sel[x.email]).map((x) => x.email);
  const to = picked(chips.to);
  const cc = picked(chips.cc);
  const flip = (email) => setSel((prev) => Object.assign({}, prev, { [email]: !prev[email] }));
  const say = (text) => {
    setNote(text);
    RB__toast(text);
  };

  const copyDraft = () => {
    TK_emailCopy(RB_draftText({ to, cc, subject, body })).then(
      () => setNote("Draft copied with To and Cc."),
      () => setNote("Copy did not work. Select the text and copy it by hand."),
    );
  };
  const openApp = () => {
    const m = RB_mailto({ to, cc, subject, body });
    const go = () => {
      try {
        window.location.href = m.href;
      } catch (e) {}
    };
    if (m.bodyLeftOut) {
      TK_emailCopy(body).then(
        () => {
          say("Body copied. Paste it into the email.");
          go();
        },
        () => {
          say("The email is too long to open with the body. Copy email, then paste it in.");
          go();
        },
      );
    } else go();
  };
  const markSent = () => {
    setBusy(true);
    rbApi.markSent(taskId, to.length).then((r) => {
      setBusy(false);
      if (r.error || !r.data) {
        setNote("Couldn't mark it sent. Try again in a moment.");
        return;
      }
      setSent({ by: r.data.by, byName: "", at: r.data.at });
      setNote("");
      try {
        window.dispatchEvent(new CustomEvent(RB_CHANGED_EVENT, { detail: { taskId } }));
      } catch (e) {}
    });
  };
  const undo = () => {
    setBusy(true);
    rbApi.unmarkSent(taskId).then((r) => {
      setBusy(false);
      if (r.error) {
        setNote("Couldn't undo. Try again in a moment.");
        return;
      }
      setSent(null);
      setNote("No longer marked sent.");
      try {
        window.dispatchEvent(new CustomEvent(RB_CHANGED_EVENT, { detail: { taskId } }));
      } catch (e) {}
    });
  };

  const chipRow = (list, label, empty) => (
    <div className="rb-rcpt-row">
      <span className="tk-dw-label rb-rcpt-label">{label}</span>
      {list.length ? (
        <span className="rb-rcpt-chips">
          {list.map((x) => (
            <button
              key={x.email}
              type="button"
              className={"rb-rcpt" + (sel[x.email] ? " on" : "")}
              aria-pressed={!!sel[x.email]}
              onClick={() => flip(x.email)}
              title={x.tip || x.email}
            >
              {x.name ? x.name + " · " + x.email : x.email}
            </button>
          ))}
        </span>
      ) : (
        <span className="tk-dw-hint rb-rcpt-empty">{empty}</span>
      )}
    </div>
  );

  const top = (
    <div className="rb-email-extras">
      {chipRow(
        chips.to,
        "To",
        typeof OPC_isOn === "function" && OPC_isOn()
          ? "Add people in Organization profile › People to contact."
          : "Add a contact in Client info.",
      )}
      {chipRow(chips.cc, "Cc", "No bookkeeper or account manager on this client.")}
      {sent ? (
        <p className="tk-dw-hint rb-sent-line">
          {RB_sentLine(sent, load.me) + " "}
          <button type="button" className="rb-linkbtn" onClick={undo} disabled={busy}>
            Undo
          </button>
        </p>
      ) : null}
      <p className="tk-dw-hint" aria-live="polite">
        {note}
      </p>
    </div>
  );
  const footer = (
    <>
      <button type="button" className="btn-secondary" onClick={copyDraft} disabled={!ready}>
        Copy draft
      </button>
      <button type="button" className="btn-secondary" onClick={openApp} disabled={!ready || !to.length} title={to.length ? "Opens your own email app with this draft" : "Pick at least one To"}>
        Open in email app
      </button>
      <button type="button" className="btn-secondary" onClick={markSent} disabled={!ready || busy || !!sent}>
        {sent ? "Marked sent" : "Mark sent"}
      </button>
    </>
  );
  return { on: true, hideSuggestedCc: true, top, footer };
}
