// ----------------------------------------------------------------------------
// Client › Close tab (TABS-SPEC WP2, close-tab.md §3-§10). Staff only.
//
//   CLC_ClientClosePage({ client, staffUser, isAdmin, onNavigate })
//     One client, one month: status and notes (the month_close record),
//     the QuickBooks check (CC_ClientCloseCard), the Ledger review card
//     (CLC_LedgerCard, GL Review spec 6.2; only when closeStepsFor gives the
//     seventh step), the close steps (CloseChecklistCard: six, or seven with
//     "Ledger reviewed"), the "Mark {Month} done" control, the read-only
//     monthly_close SOP and the "Sent to the client" history.
//   CLC_CloseSummaryRow({ client, counts, onOpen })
//     One line for the Overview (WP4 places it), linking here.
//
// Every month_close write goes through CT_saveMonthClose (CloseTracker.jsx),
// so Work › Close and this tab share one updated_at conflict guard.
// Loaded after CloseChecks.jsx and CloseTracker.jsx, before app.jsx. The
// app.jsx globals (CloseChecklistCard, sentItemsStore, clientSopsApi, SopBody,
// ConfirmModal, useToast, relTime, staffToolsApi …) are only touched inside
// render and effects. Top-level names carry a CLC_ prefix.
// ----------------------------------------------------------------------------

const CLC_PHONE_MQ = "(max-width: 899px)";
const CLC_SENT_SHOWN = 10;
const CLC_DAY_MS = 24 * 60 * 60 * 1000;

// "2026-09-01" -> "September 2026"
function CLC_monthFull(period) {
  const [y, m] = String(period || "").split("-").map(Number);
  if (!y || !m) return "";
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

// Date | ISO -> "Oct 10"
function CLC_shortDate(d) {
  if (!d) return "";
  const x = d instanceof Date ? d : new Date(d);
  if (isNaN(x)) return "";
  return x.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function CLC_rel(iso) {
  if (!iso) return "";
  return relTime(iso) || CLC_shortDate(iso);
}

function CLC_isPhoneNow() {
  try {
    return !!(window.matchMedia && window.matchMedia(CLC_PHONE_MQ).matches);
  } catch (e) {
    return false;
  }
}

function CLC_useIsPhone() {
  const [phone, setPhone] = useState(CLC_isPhoneNow);
  useEffect(() => {
    let mq = null;
    try {
      mq = window.matchMedia ? window.matchMedia(CLC_PHONE_MQ) : null;
    } catch (e) {}
    if (!mq) return undefined;
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

const CLC_soft = (q) => Promise.resolve(q).then((r) => r || { data: null, error: null }, (e) => ({ data: null, error: e }));

// Is QuickBooks linked for this client? A qbo_connections row (any status),
// or the client record says its data comes from QuickBooks.
function CLC_connected(client, conn) {
  if (conn) return true;
  return !!(client && client.dataSource === "quickbooks");
}

// close-tab.md §6a: what the QuickBooks check says and whether it lets the
// primary Done button show.
//   key: current | ready | failing | not_connected | not_checked
function CLC_checkState({ period, currentPeriod, check, connected }) {
  if (period >= currentPeriod) return { key: "current", pass: true };
  if (check && check.status === "ready") return { key: "ready", pass: true };
  if (check && (check.status === "blocked" || check.status === "behind")) return { key: "failing", pass: false };
  return { key: connected ? "not_checked" : "not_connected", pass: true };
}

function CLC_failReasons(check) {
  if (!check) return "";
  const r = (check.reasons || []).filter(Boolean);
  if (r.length) return r.join("; ");
  const failing = (Array.isArray(check.checks) ? check.checks : []).filter((c) => c && c.ok === false);
  return failing.map((c) => c.label || c.key).join("; ");
}

function CLC_goReports(client) {
  return TB_clientHash(client.id, "reports");
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

function CLC_ClientClosePage({ client, staffUser, isAdmin, onNavigate }) {
  const showToast = useToast();
  const toast = (m) => showToast && showToast(m);
  const today = useMemo(() => new Date(), []);
  const periods = useMemo(() => CT_periods(today).slice().reverse(), [today]); // newest first
  const currentPeriod = periods[0];
  const [period, setPeriod] = useState(() => CT_fromYm(closePeriodFor()));
  const ym = CT_toYm(period);
  const month = CT_monthName(period);
  const clientName = CT_name(client);
  const isPhone = CLC_useIsPhone();

  // --- month_close row, late day, close check, connection -----------------
  const [meta, setMeta] = useState({ loading: true, forKey: null, row: null, lateDay: 15, check: null, conn: null });
  const metaKey = client.id + "|" + period;
  const metaKeyRef = useRef(metaKey);
  metaKeyRef.current = metaKey;
  const loadMeta = useCallback(
    async (parts) => {
      const sb = window.mgbSupabase;
      const key = client.id + "|" + period;
      if (!sb) {
        setMeta((m) => ({ ...m, loading: false, forKey: key }));
        return;
      }
      const want = parts || ["row", "settings", "check", "conn"];
      const [mc, st, cc, conn] = await Promise.all([
        want.includes("row")
          ? CLC_soft(sb.from("month_close").select(CT_COLS).eq("client_id", client.id).eq("period_kind", "month").eq("period", period).maybeSingle())
          : null,
        want.includes("settings") ? CLC_soft(sb.from("month_close_settings").select("late_day").maybeSingle()) : null,
        want.includes("check")
          ? CLC_soft(
              sb
                .from("close_checks")
                .select("client_id, period, status, checks, reasons, data_as_of, evaluated_at")
                .eq("client_id", client.id)
                .eq("period", period)
                .maybeSingle(),
            )
          : null,
        want.includes("conn")
          ? CLC_soft(sb.from("qbo_connections").select("client_id, status, last_synced_at").eq("client_id", client.id).maybeSingle())
          : null,
      ]);
      if (mc && !mc.error) CT_noteDone(mc.data);
      setMeta((m) => {
        // A response for a month or client no longer on screen never lands (out-of-order loads).
        if (key !== metaKeyRef.current) return m;
        const next = { ...m, loading: false, forKey: key };
        if (mc) next.row = mc.error ? null : mc.data || null;
        if (st && !st.error && st.data && st.data.late_day) next.lateDay = st.data.late_day;
        if (cc) next.check = cc.error ? null : cc.data || null;
        if (conn) next.conn = conn.error ? null : conn.data || null;
        return next;
      });
    },
    [client.id, period],
  );
  useEffect(() => {
    loadMeta();
  }, [loadMeta]);
  useEffect(() => {
    const onClose = (e) => {
      const d = (e && e.detail) || {};
      if (String(d.clientId) !== String(client.id) || CT_fromYm(d.period) !== period) return;
      if (d.row) setMeta((m) => ({ ...m, row: d.row }));
      else loadMeta(["row"]);
    };
    const onChecks = () => loadMeta(["check", "conn"]);
    window.addEventListener(CT_CHANGED_EVENT, onClose);
    window.addEventListener(CC_CHANGED_EVENT, onChecks);
    window.addEventListener("mgb-qbo-reloaded", onChecks);
    return () => {
      window.removeEventListener(CT_CHANGED_EVENT, onClose);
      window.removeEventListener(CC_CHANGED_EVENT, onChecks);
      window.removeEventListener("mgb-qbo-reloaded", onChecks);
    };
  }, [client.id, period, loadMeta]);
  const metaReady = !meta.loading && meta.forKey === metaKey;
  const row = metaReady ? meta.row : null;
  const status = (row && row.status) || "not_started";

  // --- close steps (count only; CloseChecklistCard renders and ticks them) ---
  // Six, or seven when Ledger reviewed applies (closeStepsFor, app.jsx).
  useCloseStepsCtx();
  const [items, setItems] = useState({ forYm: null, rows: [] });
  const loadItems = useCallback(() => {
    const sb = window.mgbSupabase;
    if (!sb) {
      setItems({ forYm: ym, rows: [] });
      return;
    }
    CLC_soft(staffToolsApi.closeItems(sb, client.id, ym)).then((r) => setItems({ forYm: ym, rows: (r && !r.error && r.data) || [] }));
  }, [client.id, ym]);
  useEffect(() => {
    loadItems();
    const evt = STAFF_TOOLS_EVENT;
    window.addEventListener(evt, loadItems);
    return () => window.removeEventListener(evt, loadItems);
  }, [loadItems]);
  // The connection status this page loaded wins over the shared cache.
  const connStatus = !meta.loading && meta.forKey === metaKey ? (meta.conn ? meta.conn.status || null : null) : undefined;
  const stepList = closeStepsFor(client, ym, connStatus);
  const stepTotal = stepList.length;
  const hasLedger = stepTotal > CLOSE_CHECKLIST.length;
  const doneKeys = new Set(
    (items.forYm === ym ? items.rows : []).filter((r) => r.done && (!r.period || String(r.period).slice(0, 7) === ym)).map((r) => r.item_key),
  );

  // --- Ledger review (GL Review spec 6.2) ------------------------------------
  const [ledger, setLedger] = useState({ forKey: null, data: null });
  const ledgerKey = client.id + "|" + ym;
  const ledgerKeyRef = useRef(ledgerKey);
  ledgerKeyRef.current = ledgerKey;
  const loadLedger = useCallback(() => {
    const sb = window.mgbSupabase;
    if (!sb || !hasLedger) return;
    const k = client.id + "|" + ym;
    closeLedgerApi.summary(sb, client.id, ym).then(
      (d) => {
        if (k === ledgerKeyRef.current) setLedger({ forKey: k, data: d });
      },
      () => {},
    );
  }, [client.id, ym, hasLedger]);
  useEffect(() => {
    loadLedger();
    window.addEventListener(GL_REVIEW_EVENT, loadLedger);
    window.addEventListener(STAFF_TOOLS_EVENT, loadLedger);
    window.addEventListener(CT_CHANGED_EVENT, loadLedger);
    return () => {
      window.removeEventListener(GL_REVIEW_EVENT, loadLedger);
      window.removeEventListener(STAFF_TOOLS_EVENT, loadLedger);
      window.removeEventListener(CT_CHANGED_EVENT, loadLedger);
    };
  }, [loadLedger]);
  const ledgerData = ledger.forKey === ledgerKey ? ledger.data : null;
  const signoff = ledgerData && !ledgerData.missing ? ledgerData.signoff : null;
  // The sign-off row is the source of truth for the Ledger reviewed step.
  if (hasLedger && signoff) {
    if (signoff.status === "reviewed" || signoff.status === "approved") doneKeys.add(CLOSE_LEDGER_STEP.key);
    else doneKeys.delete(CLOSE_LEDGER_STEP.key);
  }
  const doneCount = stepList.filter((s) => doneKeys.has(s.key)).length;
  const stepsLeft = stepTotal - doneCount;

  // --- SOP -----------------------------------------------------------------
  const [sop, setSop] = useState({ loading: true, row: null });
  const loadSop = useCallback(async () => {
    const sb = window.mgbSupabase;
    if (!sb) {
      setSop({ loading: false, row: null });
      return;
    }
    try {
      const r = await clientSopsApi.getOne(sb, client.id, "monthly_close");
      setSop({ loading: false, row: (r && r.data) || null });
    } catch (e) {
      setSop({ loading: false, row: null });
    }
  }, [client.id]);
  useEffect(() => {
    loadSop();
  }, [loadSop]);
  useClientSopsChanged(loadSop);

  // --- Sent history ----------------------------------------------------------
  const sent = sentItemsStore.use(client.id, true);
  const [showAllSent, setShowAllSent] = useState(false);

  // --- Phone panels (collapsed <details>) ------------------------------------
  const [sopOpen, setSopOpen] = useState(false);
  const [sentOpen, setSentOpen] = useState(false);

  // --- Status draft ----------------------------------------------------------
  const [draft, setDraft] = useState({ status: "not_started", notes: "" });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [ask, setAsk] = useState(null); // { kind, run }
  const [reopenText, setReopenText] = useState("");
  const [conflict, setConflict] = useState(null); // { theirs, mine: {status, notes} }
  useEffect(() => {
    if (dirty) return;
    setDraft({ status, notes: (row && row.notes) || "" });
    // eslint-disable-next-line
  }, [row && row.updated_at, row && row.status, row && row.notes, metaKey, dirty]);
  useEffect(() => {
    setDirty(false);
  }, [metaKey]);

  const lateDay = meta.lateDay || 15;
  const deadline = CT_deadline(period, lateDay);
  const late = CT_isLate(period, status, lateDay, today);
  const lateDays = late
    ? Math.max(1, Math.floor((new Date(today.getFullYear(), today.getMonth(), today.getDate()) - deadline) / CLC_DAY_MS))
    : 0;
  const connected = CLC_connected(client, meta.conn);
  const connError = !!(meta.conn && meta.conn.status === "error");
  const check = metaReady ? meta.check : null;
  const cs = CLC_checkState({ period, currentPeriod, check, connected });
  const key = client.id + "|" + period;
  const doneBefore = CT_doneSeen.has(key);

  // --- Saving ----------------------------------------------------------------
  async function save(nextStatus, nextNotes, opts) {
    const o = opts || {};
    const prev = o.force ? null : row;
    // Read before the await: the status this save moves away from.
    const was = (o.force ? o.wasStatus : row && row.status) || "not_started";
    setSaving(true);
    const res = await CT_saveMonthClose({
      sb: window.mgbSupabase,
      clientId: client.id,
      period,
      status: nextStatus,
      notes: nextNotes,
      expectedUpdatedAt: o.force ? o.expected || null : row ? row.updated_at : null,
      prevRow: prev,
      // Ledger review warning (spec 6.4, warn mode) in this page's own dialog;
      // block mode falls back to CT_ledgerGate's reason prompt.
      confirmLedger: ({ gate }) =>
        gate === "block"
          ? Promise.resolve().then(() => {
              const r = window.prompt("Ledger review isn't approved. Only an admin can override. Reason:", "");
              return r && r.trim() ? { ok: true, note: r.trim() } : false;
            })
          : new Promise((resolve) => setAsk({ kind: "ledger", run: () => resolve(true), cancel: () => resolve(false) })),
      // Tasks still open for the month warn, never block (tk_sign_off_period).
      confirmOpenTasks: ({ openTasks, sample }) =>
        new Promise((resolve) =>
          setAsk({ kind: "opentasks", openTasks, sample, run: () => resolve(true), cancel: () => resolve(false) }),
        ),
      reopenReason: o.reopenReason,
    });
    setSaving(false);
    if (res.cancelled) return false;
    if (res.ok) {
      setMeta((m) => ({ ...m, row: res.row }));
      setDirty(false);
      setDraft({ status: res.row.status, notes: res.row.notes || "" });
      if (!res.noop && nextStatus === "done" && was !== "done") {
        toast(`${month} signed off. ${clientName}'s people will get an email.`);
      } else if (!res.noop && nextStatus === "review" && was !== "review") {
        toast(`${month} is ready for sign-off.`);
      }
      return true;
    }
    if (res.conflict) {
      setConflict({ theirs: res.theirs, mine: { status: nextStatus, notes: nextNotes } });
      return false;
    }
    toast("Couldn't save. " + ((res.error && res.error.message) || ""));
    return false;
  }

  // Status card Save: re-done and late-note confirms (close-tab.md §6c, §11).
  function onSaveStatus() {
    const notes = draft.notes.trim();
    if (status === "done" && draft.status !== "done") {
      askReopen(draft.status, notes);
      return;
    }
    if (draft.status === "done" && status !== "done" && doneBefore) {
      setAsk({ kind: "redone", run: () => save("done", notes) });
      return;
    }
    const notesChanged = (notes || null) !== ((row && row.notes) || null);
    // A signed-off month's KPI time is its ready / sign-off time, so only an
    // N/A month's note can move it.
    if (
      row &&
      draft.status === "na" &&
      draft.status === status &&
      notesChanged &&
      row.updated_at &&
      CT_ymd(new Date()) > CT_ymd(deadline) &&
      CT_ymd(new Date(row.updated_at)) <= CT_ymd(deadline)
    ) {
      setAsk({ kind: "latenote", run: () => save(draft.status, notes) });
      return;
    }
    save(draft.status, notes);
  }

  // Reopen a signed-off month (admins only): asks for a reason first.
  function askReopen(target, notes) {
    setReopenText("");
    setAsk({ kind: "reopen", target, notes });
  }

  // Done button: anyway confirm, then re-done confirm, then save. Admins sign
  // off (done); everyone else marks the month Ready for sign-off (review).
  function markDone(anyway) {
    // Keep notes typed in the Status card but not saved yet (a stray click never throws away a draft).
    const notes = dirty ? (draft.notes || "").trim() || null : (row && row.notes) || null;
    const finish = () => {
      if (!isAdmin) save("review", notes);
      else if (doneBefore) setAsk({ kind: "redone", run: () => save("done", notes) });
      else save("done", notes);
    };
    if (anyway) setAsk({ kind: "anyway", run: finish });
    else finish();
  }

  // --- Arrive (deep links) ---------------------------------------------------
  const ready = metaReady && !sent.loading;
  const arrive = (a) => {
    let delay = 250;
    if (a.month) {
      const want = CT_fromYm(a.month);
      if (periods.includes(want)) {
        if (want !== period) {
          setPeriod(want);
          delay = 700;
        }
      } else {
        LK_toast(LK_fill(LK_COPY.closeMonth, { Month: CLC_monthFull(want), Month2: CLC_monthFull(period) }));
      }
    }
    if (a.kind === "view") return;
    if (a.kind === "sent") {
      setShowAllSent(true);
      setSentOpen(true);
    }
    setTimeout(() => {
      const el = LK_find(a.kind + ":" + a.id);
      if (el) {
        if (el.tagName === "DETAILS") el.open = true;
        LK_reveal(el, { row: a.kind === "step" || a.kind === "sent" });
      } else if (a.kind === "sent") LK_toast(LK_COPY.sentMissing);
      else LK_toast(LK_COPY.unclaimed);
    }, delay);
  };
  LK_useArrival({ clientId: client.id, tab: "close", kinds: ["step", "sent", "at", "view"], staff: true }, ready, arrive);

  // --- Pieces ------------------------------------------------------------------
  const statusLabel = late ? "Late" : CT_STATUS_LABEL[status] || status;
  const statusCls = late ? "late" : status;

  const deadlineChip =
    status === "done" || status === "na" || status === "review" ? null : late ? (
      <span className="clc-deadline is-late">Late · {lateDays} {lateDays === 1 ? "day" : "days"}</span>
    ) : (
      <span className="clc-deadline">Due {CLC_shortDate(deadline)}</span>
    );

  const header = (
    <div className="clc-head">
      {/* The page header above already shows "Close" as the H1. */}
      <h2 className="clc-title clc-sr">Close</h2>
      <label className="clc-month">
        <span className="clc-month-label">Month</span>
        <select value={period} onChange={(e) => setPeriod(e.target.value)}>
          {periods.map((p) => (
            <option key={p} value={p}>
              {CLC_monthFull(p)}
              {p === currentPeriod ? " (this month)" : ""}
            </option>
          ))}
        </select>
      </label>
      {metaReady && deadlineChip}
    </div>
  );

  const statusCardRef = useRef(null);
  const summary = (
    <button
      type="button"
      className="clc-summary"
      onClick={() => {
        const el = statusCardRef.current;
        if (!el) return;
        LK_reveal(el);
      }}
    >
      <span className={"clc-status-pill ct-s-" + statusCls}>{statusLabel}</span>
      <span>
        {doneCount} of {stepTotal} steps
      </span>
      {check && <CC_Badge row={check} compact />}
    </button>
  );

  const changed = draft.status !== status || (draft.notes.trim() || null) !== ((row && row.notes) || null);
  const statusCard = (
    <section className="card clc-status clc-o-status" ref={statusCardRef} aria-labelledby="clc-status-h">
      <h3 className="card-title" id="clc-status-h">
        Status
      </h3>
      <fieldset className="ct-status-group">
        <legend className="ct-legend clc-sr">Status</legend>
        {CT_STATUSES.filter((s) => isAdmin || s.key !== "done" || status === "done").map((s) => (
          <label key={s.key} className={"ct-status-opt ct-s-" + s.key + (draft.status === s.key ? " selected" : "")}>
            <input
              type="radio"
              name={"clc-status-" + client.id}
              value={s.key}
              checked={draft.status === s.key}
              disabled={!isAdmin && status === "done"}
              onChange={() => {
                setDraft((d) => ({ ...d, status: s.key }));
                setDirty(true);
              }}
            />
            {s.key === "done" ? "Done (sign off)" : s.label}
          </label>
        ))}
      </fieldset>
      {!isAdmin && status === "done" ? (
        <p className="card-subtitle" role="note">
          Signed off{row && row.signed_off_by ? " by " + CT_who(row.signed_off_by) : ""}. Only an admin can reopen it.
        </p>
      ) : !isAdmin ? (
        <p className="card-subtitle" role="note">
          When your part is finished, pick Ready for sign-off. An admin signs {month} off.
        </p>
      ) : null}
      {draft.status === "done" && status !== "done" && (
        <p className="ct-email-warn" role="note">
          Signing off emails {clientName}'s people that {month} reports are ready.
        </p>
      )}
      <label className="ct-legend" htmlFor={"clc-notes-" + client.id}>
        Notes
      </label>
      <textarea
        id={"clc-notes-" + client.id}
        className="ct-notes"
        rows={isPhone ? 4 : 3}
        maxLength={2000}
        value={draft.notes}
        placeholder="Waiting on bank statement, reviewer, anything useful"
        onChange={(e) => {
          const v = e.target.value;
          setDraft((d) => ({ ...d, notes: v }));
          setDirty(true);
        }}
      />
      <div className="clc-status-foot">
        {row && row.updated_by ? (
          <span className="card-subtitle clc-updated">
            Last updated by {CT_who(row.updated_by)} · {CLC_rel(row.updated_at)}
          </span>
        ) : (
          <span />
        )}
        <button type="button" className="btn-primary" disabled={saving || !metaReady || !changed} onClick={onSaveStatus}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </section>
  );

  const reconnect = () => {
    LK_go({ clientId: client.id, tab: "settings", sub: "client", item: "setup:details.quickbooks" });
  };
  const olderThan90 = (() => {
    const [y, m] = period.split("-").map(Number);
    return today - new Date(y, m - 1, 1) > 90 * CLC_DAY_MS;
  })();
  let qboLine = null;
  if (metaReady) {
    if (cs.key === "current") qboLine = "QuickBooks checks a month after it ends.";
    else if (cs.key === "ready") qboLine = `QuickBooks looks ready for ${month}.`;
    else if (cs.key === "not_connected") qboLine = "QuickBooks isn't connected, so there's no automatic check. Tick the steps yourself.";
    else if (cs.key === "not_checked") qboLine = `QuickBooks hasn't checked ${month} yet. Tick the steps yourself.`;
  }
  const qboSection = (
    <section className="clc-qbo clc-o-qbo" data-lk="at:close-qbo" data-tour="close-qbo" aria-labelledby="clc-qbo-h">
      <h3 className="clc-section-title" id="clc-qbo-h">
        QuickBooks check
      </h3>
      {connError && (
        <div className="clc-reconnect" role="note">
          <p>QuickBooks needs to be reconnected, so this check is out of date. Reconnect it, then Sync now.</p>
          <button type="button" className="btn-secondary" onClick={reconnect}>
            Reconnect QuickBooks
          </button>
        </div>
      )}
      {qboLine && <p className={"clc-qbo-line" + (cs.key === "not_checked" ? " is-warn" : "")}>{qboLine}</p>}
      {metaReady && cs.key === "failing" && olderThan90 && (
        <p className="clc-qbo-line is-warn">Bank shows the last 90 days. Check QuickBooks for {month}.</p>
      )}
      {cs.key !== "current" && (
        <CC_ClientCloseCard client={client} period={period} showSyncLine={cs.key !== "not_connected"} linkable />
      )}
    </section>
  );

  const ledgerSection = hasLedger ? (
    <CLC_LedgerCard
      client={client}
      ym={ym}
      month={month}
      data={ledgerData}
      isAdmin={!!isAdmin}
      onChanged={loadLedger}
      toast={toast}
    />
  ) : null;

  const stepsSection = (
    <div className="clc-steps-wrap clc-o-steps" data-lk="at:close-steps">
      <CloseChecklistCard client={client} period={ym} />
    </div>
  );

  // Done control (close-tab.md §6b).
  let doneBody = null;
  let doneEnabled = false;
  if (metaReady) {
    if (status === "done") {
      const by = row && (row.signed_off_by || row.updated_by);
      const at = row && (row.signed_off_at || row.updated_at);
      doneBody = (
        <p className="clc-done-state">
          {month} is signed off
          {by ? " · " + CT_who(by) : ""}
          {at ? " · " + CLC_shortDate(at) : ""}
          {isAdmin ? (
            <>
              {" · "}
              <button type="button" className="link-btn" disabled={saving} onClick={() => askReopen("in_progress", (row && row.notes) || null)}>
                Reopen
              </button>
            </>
          ) : null}
        </p>
      );
    } else if (status === "na") {
      doneBody = <p className="clc-done-state">{month} is marked not needed (N/A).</p>;
    } else if (stepsLeft > 0) {
      doneBody = (
        <p className="card-subtitle clc-steps-left">
          {stepsLeft === 1 ? "1 step left" : `${stepsLeft} steps left`}
          {isAdmin ? ` before you can sign off ${month}.` : ` before ${month} is ready for sign-off.`}
        </p>
      );
    } else if (!isAdmin && status === "review") {
      doneBody = (
        <p className="clc-done-state">
          {month} is ready for sign-off
          {row && row.ready_at ? " · " + CLC_shortDate(row.ready_at) : ""}. An admin signs it off.
        </p>
      );
    } else {
      doneEnabled = true;
      doneBody = (
        <>
          {cs.pass ? (
            <button type="button" className="btn-primary clc-done-btn" disabled={saving} onClick={() => markDone(false)}>
              {isAdmin ? `Sign off ${month}` : `Mark ${month} ready for sign-off`}
            </button>
          ) : (
            <button type="button" className="btn-secondary clc-done-btn" disabled={saving} onClick={() => markDone(true)}>
              {isAdmin ? `Sign off ${month} anyway` : `Mark ${month} ready anyway`}
            </button>
          )}
          {isAdmin ? (
            <p className="ct-email-warn" role="note">
              Signing off emails {clientName}'s people that {month} reports are ready.
            </p>
          ) : (
            <p className="card-subtitle" role="note">
              An admin signs it off. That's when {clientName}'s people get the "reports are ready" email.
            </p>
          )}
        </>
      );
    }
  }
  const doneSection = (
    <section
      className={"clc-done clc-o-done" + (doneEnabled && isPhone ? " is-sticky" : "")}
      data-lk="at:close-done"
      data-tour="close-done"
      aria-label={isAdmin ? `Sign off ${month}` : `Mark ${month} ready for sign-off`}
    >
      {doneBody}
    </section>
  );

  // SOP panel.
  const sopInner = sop.loading ? (
    <p className="card-subtitle">Loading…</p>
  ) : sop.row && String(sop.row.body || "").trim() ? (
    <>
      <SopBody text={sop.row.body} />
      <a
        className="clc-panel-link"
        href={TB_clientHash(client.id, "sop")}
        onClick={(e) => {
          if (!onNavigate) return;
          e.preventDefault();
          onNavigate("sop");
        }}
      >
        Edit in SOP →
      </a>
    </>
  ) : (
    <p className="card-subtitle">
      No close steps written for {clientName} yet.{" "}
      <a
        className="clc-panel-link"
        href={TB_clientHash(client.id, "sop")}
        onClick={(e) => {
          if (!onNavigate) return;
          e.preventDefault();
          onNavigate("sop");
        }}
      >
        Add them in SOP →
      </a>
    </p>
  );

  // Sent panel. Rows sent after the picked month ended get a soft dot.
  const sentRows = sent.rows || [];
  const [py, pm] = period.split("-").map(Number);
  const periodEnd = new Date(py, pm, 1);
  const shownSent = showAllSent ? sentRows : sentRows.slice(0, CLC_SENT_SHOWN);
  const sentInner = sent.loading ? (
    <p className="card-subtitle">Loading…</p>
  ) : sentRows.length === 0 ? (
    <p className="card-subtitle">
      Nothing sent yet. Use "Mark sent to client" on Reports.{" "}
      <a className="clc-panel-link" href={CLC_goReports(client)}>
        Go to Reports →
      </a>
    </p>
  ) : (
    <>
      <ul className="clc-sent-list">
        {shownSent.map((s) => {
          const thisClose = s.sent_at && new Date(s.sent_at) >= periodEnd;
          const who = s.sent_by_name || CT_who(s.sent_by);
          const bits = [s.item_label || s.item_key, s.period_label, who, CLC_rel(s.sent_at)].filter(Boolean);
          return (
            <li key={s.id} className="clc-sent-row" data-lk={"sent:" + s.id}>
              {thisClose && (
                <span className="clc-dot" title="This close">
                  <span className="clc-sr">This close</span>
                </span>
              )}
              <span className="clc-sent-text">
                {bits.join(" · ")}
                {s.note ? <span className="clc-sent-note">{s.note}</span> : null}
              </span>
            </li>
          );
        })}
      </ul>
      {!showAllSent && sentRows.length > CLC_SENT_SHOWN && (
        <button type="button" className="link-btn clc-show-all" onClick={() => setShowAllSent(true)}>
          Show all ({sentRows.length})
        </button>
      )}
    </>
  );

  const sopPanel = isPhone ? (
    <details className="card clc-panel clc-o-sop" data-clc-sop="" open={sopOpen} onToggle={(e) => setSopOpen(e.currentTarget.open)}>
      <summary className="clc-panel-summary">Monthly close steps</summary>
      <div className="clc-panel-body">{sopInner}</div>
    </details>
  ) : (
    <section className="card clc-panel clc-o-sop" data-clc-sop="" aria-labelledby="clc-sop-h">
      <h3 className="card-title" id="clc-sop-h">
        Monthly close steps
      </h3>
      <div className="clc-panel-body">{sopInner}</div>
    </section>
  );
  const sentPanel = isPhone ? (
    <details className="card clc-panel clc-o-sent" open={sentOpen} onToggle={(e) => setSentOpen(e.currentTarget.open)}>
      <summary className="clc-panel-summary">
        Sent to the client{sentRows.length ? " (" + sentRows.length + ")" : ""}
      </summary>
      <div className="clc-panel-body">{sentInner}</div>
    </details>
  ) : (
    <section className="card clc-panel clc-o-sent" aria-labelledby="clc-sent-h">
      <h3 className="card-title" id="clc-sent-h">
        Sent to the client
      </h3>
      <div className="clc-panel-body">{sentInner}</div>
    </section>
  );

  // Confirms.
  let askModal = null;
  if (ask) {
    const done = () => {
      const run = ask.run;
      setAsk(null);
      if (run) run();
    };
    const cancel = () => {
      const c = ask.cancel;
      setAsk(null);
      if (c) c();
    };
    if (ask.kind === "ledger") {
      askModal = (
        <ConfirmModal
          title="Ledger review"
          body={`Ledger review isn't approved. Sign off anyway?`}
          confirmLabel="Sign off anyway"
          onConfirm={done}
          onCancel={cancel}
        />
      );
    } else if (ask.kind === "anyway") {
      askModal = (
        <ConfirmModal
          title="QuickBooks still shows problems"
          body={`QuickBooks still shows: ${CLC_failReasons(check)}. ${isAdmin ? `Sign off ${month}` : `Mark ${month} ready for sign-off`} anyway?`}
          confirmLabel={isAdmin ? "Sign off anyway" : "Mark ready anyway"}
          onConfirm={done}
          onCancel={cancel}
        />
      );
    } else if (ask.kind === "redone") {
      askModal = (
        <ConfirmModal
          title={`Sign off ${month}`}
          body={'This month was signed off before. Signing it off again sends the "reports are ready" email again, unless it went out in the last 7 days.'}
          confirmLabel="Sign off again"
          onConfirm={done}
          onCancel={cancel}
        />
      );
    } else if (ask.kind === "latenote") {
      askModal = (
        <ConfirmModal
          title="Save note"
          body="This close was on time. Saving a note now records it as finished today, which can count as late. Save anyway?"
          confirmLabel="Save note"
          onConfirm={done}
          onCancel={cancel}
        />
      );
    } else if (ask.kind === "opentasks") {
      const n = ask.openTasks || 0;
      const names = (ask.sample || []).map((t) => t.title).join(", ");
      askModal = (
        <ConfirmModal
          title={`Sign off ${month}`}
          body={`${n} open ${n === 1 ? "task is" : "tasks are"} still linked to ${month}${names ? ": " + names : ""}. Sign off anyway?`}
          confirmLabel="Sign off anyway"
          onConfirm={done}
          onCancel={cancel}
        />
      );
    } else if (ask.kind === "reopen") {
      const target = ask.target || "in_progress";
      const label = (CT_STATUSES.find((s) => s.key === target) || {}).label || "In progress";
      const okReason = reopenText.trim().length >= 3;
      askModal = (
        <ModalShell onClose={cancel} labelledBy="clc-reopen-title" className="confirm-modal">
          <div className="modal-header">
            <h3 className="card-title" id="clc-reopen-title" style={{ margin: 0 }}>
              Reopen {month}?
            </h3>
            <button className="modal-close" onClick={cancel} aria-label="Close">
              ×
            </button>
          </div>
          <div className="modal-body">
            <p className="card-subtitle" style={{ marginTop: 0 }}>
              It goes back to {label}. Say why, so the team can see it later.
            </p>
            <label className="ct-legend" htmlFor="clc-reopen-reason">
              Why reopen it?
            </label>
            <input
              id="clc-reopen-reason"
              className="ct-notes"
              maxLength={500}
              value={reopenText}
              placeholder="Found a missing bill, client asked for a change…"
              onChange={(e) => setReopenText(e.target.value)}
            />
          </div>
          <div className="modal-footer">
            <button className="btn-secondary" onClick={cancel}>
              Cancel
            </button>
            <button
              className="btn-primary"
              disabled={!okReason}
              onClick={() => {
                const why = reopenText.trim();
                setAsk(null);
                save(target, ask.notes, { reopenReason: why });
              }}
            >
              Reopen
            </button>
          </div>
        </ModalShell>
      );
    }
  }

  return (
    <div className="clc-page" data-tour="close-page">
      {header}
      {summary}
      <div className="clc-layout">
        <div className="clc-col clc-main">
          {statusCard}
          {qboSection}
          {ledgerSection}
          {stepsSection}
          {doneSection}
        </div>
        <aside className="clc-col clc-side" aria-label="Close notes and history">
          {sopPanel}
          {sentPanel}
        </aside>
      </div>
      {askModal}
      {conflict && (
        <CT_ConflictModal
          theirs={conflict.theirs}
          onClose={() => setConflict(null)}
          onLoadTheirs={() => {
            const t = conflict.theirs;
            setMeta((m) => ({ ...m, row: t || null }));
            setDraft({ status: (t && t.status) || "not_started", notes: (t && t.notes) || "" });
            setDirty(false);
            setConflict(null);
          }}
          onKeepMine={async () => {
            const c = conflict;
            setConflict(null);
            await save(c.mine.status, c.mine.notes, {
              force: true,
              expected: c.theirs ? c.theirs.updated_at : null,
              wasStatus: c.theirs ? c.theirs.status : "not_started",
            });
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ledger review card (GL Review spec 6.2). Shown only when the seventh step
// applies. Counts come from gl_review_flags as of the last pull (no scheduled
// pull in phase 1); the sign-off moves only through the RPCs
// (closeLedgerApi, app.jsx). An admin may approve their own review (13.4).
// ---------------------------------------------------------------------------

const CLC_LEDGER_STATUS = {
  in_review: "In review",
  reviewed: "Reviewed, waiting for approval",
  approved: "Approved",
  sent_back: "Sent back",
};

function CLC_LedgerCard({ client, ym, month, data, isAdmin, onChanged, toast }) {
  const [busy, setBusy] = useState(null);
  const [sendBack, setSendBack] = useState(null); // note draft while the modal is open
  const so = data && !data.missing ? data.signoff : null;
  const st = (so && so.status) || null;
  const href = LK_href({ clientId: client.id, tab: "ledger", month: ym });
  const go = LK_onClick({ clientId: client.id, tab: "ledger", month: ym });
  const after = () => {
    try {
      notifyGlReview();
      notifyStaffTools();
    } catch (e) {}
    if (onChanged) onChanged();
  };
  const fail = (error) => toast("Couldn't save. " + ((error && error.message) || ""));
  async function run(kind) {
    const sb = window.mgbSupabase;
    if (!sb) return;
    setBusy(kind);
    let r;
    try {
      if (kind === "review") r = await closeLedgerApi.markReviewed(sb, client.id, ym);
      else if (kind === "approve") r = await closeLedgerApi.approve(sb, client.id, ym);
      else if (kind === "sendback") r = await closeLedgerApi.sendBack(sb, client.id, ym, String(sendBack || "").trim());
    } catch (e) {
      r = { error: e };
    }
    setBusy(null);
    if (r && r.error) return fail(r.error);
    if (kind === "sendback") setSendBack(null);
    if (kind === "review") {
      const d = (r && r.data) || {};
      const high = d.high_open_at_review || 0;
      toast(
        `Ledger marked reviewed for ${month}` +
          (high ? ` with ${high} high-priority flag${high === 1 ? "" : "s"} open.` : ".") +
          (d.month_started ? ` ${month} is now In progress.` : ""),
      );
      if (d.month_started) {
        try {
          window.dispatchEvent(new CustomEvent(CT_CHANGED_EVENT, { detail: { clientId: client.id, period: CT_fromYm(ym) } }));
        } catch (e) {}
      }
    } else if (kind === "approve") toast(`Ledger review approved for ${month}.`);
    else toast(`Ledger review sent back for ${month}.`);
    after();
  }

  let body;
  if (!data) body = <p className="card-subtitle">Loading…</p>;
  else if (data.missing) body = <p className="card-subtitle">Ledger review isn't set up yet.</p>;
  else {
    const pull = data.pull;
    let pulled;
    if (pull && pull.status === "running") pulled = "Pulling from QuickBooks now…";
    else if (pull && pull.finished_at)
      pulled =
        "Last pulled " + CLC_rel(pull.finished_at) + (pull.status === "error" ? " (the last pull failed)" : "") + " · counts as of the last pull";
    else pulled = "Not pulled yet. Open Ledger review to pull the ledger.";
    const sub = typeof closeLedgerSubline === "function" ? closeLedgerSubline(so) : "";
    const canMark = st !== "reviewed" && st !== "approved";
    const ready = canMark && pull && pull.finished_at && data.highOpen === 0;
    body = (
      <>
        <p className="clc-ledger-counts">
          {data.open} open · {data.asked} asked · {data.cleared} cleared
          {data.highOpen > 0 ? <span className="clc-ledger-high"> · {data.highOpen} high priority</span> : null}
        </p>
        <p className="card-subtitle clc-ledger-pulled">{pulled}</p>
        {sub ? <p className="clc-ledger-sub">{sub}</p> : null}
        {ready ? <p className="clc-ledger-ready">Ready to mark reviewed: no high-priority flags open.</p> : null}
        <div className="clc-ledger-actions">
          <a className="btn-secondary" href={href} onClick={go}>
            Open Ledger review →
          </a>
          {canMark && (
            <button type="button" className="btn-primary" disabled={!!busy} onClick={() => run("review")}>
              {busy === "review" ? "Saving…" : "Mark reviewed"}
            </button>
          )}
          {isAdmin && st === "reviewed" && (
            <button type="button" className="btn-primary" disabled={!!busy} onClick={() => run("approve")}>
              {busy === "approve" ? "Saving…" : "Approve"}
            </button>
          )}
          {isAdmin && (st === "reviewed" || st === "approved") && (
            <button type="button" className="btn-secondary" disabled={!!busy} onClick={() => setSendBack("")}>
              Send back
            </button>
          )}
        </div>
      </>
    );
  }
  const note = String(sendBack || "").trim();
  return (
    <section className="card clc-ledger clc-o-ledger" data-lk="at:close-ledger" aria-labelledby="clc-ledger-h">
      <div className="clc-card-head">
        <h3 className="card-title" id="clc-ledger-h">
          Ledger review
        </h3>
        {st && <span className="clc-chip">{CLC_LEDGER_STATUS[st] || st}</span>}
      </div>
      {body}
      {sendBack !== null && (
        <ModalShell onClose={() => setSendBack(null)} labelledBy="clc-sendback-title" className="confirm-modal">
          <div className="modal-header">
            <h3 className="card-title" id="clc-sendback-title" style={{ margin: 0 }}>
              Send back the {month} ledger review
            </h3>
            <button className="modal-close" onClick={() => setSendBack(null)} aria-label="Close">
              ×
            </button>
          </div>
          <div className="modal-body">
            <label className="ct-legend" htmlFor="clc-sendback-note">
              What needs another look?
            </label>
            <textarea
              id="clc-sendback-note"
              className="ct-notes"
              rows={3}
              maxLength={1000}
              value={sendBack}
              onChange={(e) => setSendBack(e.target.value)}
            />
          </div>
          <div className="modal-footer">
            <button className="btn-secondary" onClick={() => setSendBack(null)}>
              Cancel
            </button>
            <button className="btn-primary" disabled={!note || busy === "sendback"} onClick={() => run("sendback")}>
              {busy === "sendback" ? "Sending…" : "Send back"}
            </button>
          </div>
        </ModalShell>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Overview summary row
// ---------------------------------------------------------------------------

// Per-client cache of last month's close bits, 60 s.
const CLC_sumStore = { byClient: {}, subs: {} };
const CLC_SUM_FRESH_MS = 60000;

async function CLC_loadSummary(clientId) {
  const sb = window.mgbSupabase;
  const ym = closePeriodFor();
  const period = CT_fromYm(ym);
  const prev = CLC_sumStore.byClient[clientId];
  if (!sb) {
    CLC_sumStore.byClient[clientId] = { at: Date.now(), ym, done: 0, status: "not_started", check: null, conn: null };
  } else {
    CLC_sumStore.byClient[clientId] = { ...(prev || {}), loading: true };
    const [items, mc, cc, conn] = await Promise.all([
      CLC_soft(sb.from("client_close_items").select("item_key, done").eq("client_id", clientId).eq("period", ym)),
      CLC_soft(sb.from("month_close").select("status").eq("client_id", clientId).eq("period_kind", "month").eq("period", period).maybeSingle()),
      CLC_soft(sb.from("close_checks").select("status, checks").eq("client_id", clientId).eq("period", period).maybeSingle()),
      CLC_soft(sb.from("qbo_connections").select("status").eq("client_id", clientId).maybeSingle()),
    ]);
    // Six steps, or seven with Ledger reviewed (closeStepsFor, app.jsx).
    await closeStepsLoad();
    const connStatus = conn && !conn.error ? (conn.data ? conn.data.status || null : null) : undefined;
    const steps = closeStepsFor(clientId, ym, connStatus);
    const keys = steps.map((s) => s.key);
    const done = ((items && items.data) || []).filter((r) => r.done && (!keys || keys.includes(r.item_key))).length;
    CLC_sumStore.byClient[clientId] = {
      at: Date.now(),
      ym,
      done,
      total: steps.length,
      status: (mc && mc.data && mc.data.status) || "not_started",
      check: (cc && cc.data) || null,
      conn: (conn && conn.data) || null,
    };
  }
  (CLC_sumStore.subs[clientId] || new Set()).forEach((f) => f());
}

function CLC_qboState({ connStatus, check, failing, connected }) {
  if (connStatus === "error") return "needs reconnecting";
  const f = failing || (check && Array.isArray(check.checks) ? check.checks.filter((c) => c && c.ok === false).map((c) => c.key) : []);
  if (f.includes("uncategorized") || f.includes("undeposited")) return "blocked";
  if (f.includes("bank_active") || f.includes("reconciled")) return "behind";
  const st = check && (typeof check === "string" ? check : check.status);
  if (st === "blocked") return "blocked";
  if (st === "behind") return "behind";
  if (st === "ready") return "ready";
  if (!connected) return "not connected";
  return "not checked yet";
}

function CLC_CloseSummaryRow({ client, counts, onOpen }) {
  const [, bump] = React.useReducer((n) => n + 1, 0);
  const id = client && client.id;
  useEffect(() => {
    if (!id) return undefined;
    const set = (CLC_sumStore.subs[id] = CLC_sumStore.subs[id] || new Set());
    set.add(bump);
    const e = CLC_sumStore.byClient[id];
    if (!e || (!e.loading && Date.now() - (e.at || 0) > CLC_SUM_FRESH_MS)) CLC_loadSummary(id);
    const reload = () => CLC_loadSummary(id);
    const onClose = (ev) => {
      const d = (ev && ev.detail) || {};
      if (!d.clientId || String(d.clientId) === String(id)) reload();
    };
    const evt = STAFF_TOOLS_EVENT;
    window.addEventListener(evt, reload);
    window.addEventListener(CT_CHANGED_EVENT, onClose);
    return () => {
      set.delete(bump);
      window.removeEventListener(evt, reload);
      window.removeEventListener(CT_CHANGED_EVENT, onClose);
    };
  }, [id]);
  if (!id) return null;
  const e = CLC_sumStore.byClient[id];
  if (!e || e.done == null) {
    return (
      <div className="clc-sumrow" data-tour="ov-close" data-lk="at:ov-close">
        <span className="card-subtitle">Loading…</span>
      </div>
    );
  }
  const cl = counts && counts.loaded && counts.close && counts.close.period ? counts.close : null;
  const ym = e.ym;
  const month = CT_monthName(ym);
  const status = (cl && cl.status) || e.status || "not_started";
  const late = !!(cl && cl.late && cl.latePeriod && CT_toYm(cl.latePeriod) === ym);
  const statusLabel = late ? "Late" : CT_STATUS_LABEL[status] || status;
  const connStatus = cl ? (cl.qbo === "error" ? "error" : null) : e.conn && e.conn.status;
  const connected = cl ? cl.qbo !== "none" : CLC_connected(client, e.conn);
  const qbo = CLC_qboState({
    connStatus,
    check: cl ? cl.check : e.check,
    failing: cl ? cl.failing : null,
    connected,
  });
  const total = e.total || CLOSE_CHECKLIST.length;
  const href = TB_clientHash(id, "close");
  const click = (ev) => {
    if (!onOpen || ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
    ev.preventDefault();
    onOpen();
  };
  return (
    <div className="clc-sumrow" data-tour="ov-close" data-lk="at:ov-close">
      <a className="clc-sumrow-main" href={href} onClick={click}>
        {month} close · <span className={"clc-sum-status ct-s-" + (late ? "late" : status)}>{statusLabel}</span> · {e.done} of {total} steps
      </a>
      <span className={"clc-sumrow-qbo" + (qbo === "needs reconnecting" || qbo === "blocked" ? " is-bad" : qbo === "behind" ? " is-warn" : "")}>
        {" "}
        · QuickBooks: {qbo} ·{" "}
      </span>
      <a className="clc-sumrow-open" href={href} onClick={click}>
        Open Close →
      </a>
    </div>
  );
}
