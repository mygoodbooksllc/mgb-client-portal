// components/ledger/LR_Tab.jsx — Client › Ledger review (staff only).
// docs/gl-review-spec.md sections 2, 4, 5 and 7.1-7.3; owner decisions in 13
// (warn only; an admin may approve their own review).
//
//   LR_LedgerTab({ client, staffUser, isAdmin, onNavigate })
//
// App mounts it for the "client-ledger" page (#/client/<id>/ledger), staff
// only, never in client view. Keyed by client id, so a client switch starts
// fresh.
//
// Flow:
//   1. Load the stored side: flags, rules, the latest pull row, settings,
//      watch list, portal addressees (gl_review_portal_addressees, never
//      scoped users), greeting name / contact email, and the
//      month's sign-off and summary.
//   2. If QuickBooks is connected and no copy of this client's ledger is in
//      memory, pull it (qbo-gl-review). The lines stay in memory for 15
//      minutes (LR_cache) and are never written to browser storage.
//   3. Run the checks in the browser (GLR_checks), save the flags
//      (gl_review_upsert_flags, chunks of 2,000, tagged with the pull_id
//      qbo-gl-review returned), then mark flags the pull no longer sees as
//      fixed (gl_review_mark_fixed, rolling 14-month pulls only, and only
//      when the firm watch list loaded).
//      The saved set never depends on the month picker: the month-dependent
//      check (recon_uncleared) is always run as of the last complete month
//      (saveYm below). The screen re-runs the checks for the picked month
//      for display only.
//   4. The screen shows stored flags (their status is the truth) with the
//      lines behind each one from the in-memory pull.
//   5. Deep links (#/client/<id>/ledger?month=YYYY-MM) are claimed with
//      LK_useArrival and open that month when it's in the picker.
//
// Prefix: LR_. Only touches app.jsx globals (useToast, ModalShell,
// ConfirmModal, TB_clientHash, CT_CHANGED_EVENT) and the DeepLink.jsx /
// TxnQuestions.jsx globals (LK_useArrival, LK_toast, TQ_notify) at render time.

let LR_cacheInst = null;
function LR_cache() {
  if (!LR_cacheInst) LR_cacheInst = LR_logic.makeMemoryCache(15 * 60 * 1000);
  return LR_cacheInst;
}

const LR_when = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};
const LR_firstName = (u) => String((u && (u.name || u.email)) || "").split(/[\s@]/)[0];
const LR_isChurch = (c) => /church|ministr|congregation/i.test(String((c && (c.orgType || c.org_type)) || ""));

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------

// Shared shell: title, body, footer with Cancel + the action. onSubmit returns
// a promise; a rejection shows its message inside the dialog.
function LR_Dialog({ id, title, children, submitLabel, canSubmit, onSubmit, onCancel, danger }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const submit = async (e) => {
    if (e) e.preventDefault();
    if (busy || !canSubmit) return;
    setBusy(true);
    setErr("");
    try {
      await onSubmit();
    } catch (x) {
      setErr((x && x.message) || "That didn't work. Try again.");
      setBusy(false);
    }
  };
  return (
    <ModalShell onClose={busy ? () => {} : onCancel} labelledBy={id + "-title"} className="lr-dialog">
      <form onSubmit={submit}>
        <div className="modal-header">
          <h3 className="card-title" id={id + "-title"} style={{ margin: 0 }}>
            {title}
          </h3>
          <button type="button" className="modal-close" onClick={onCancel} aria-label="Close" disabled={busy}>
            ×
          </button>
        </div>
        <div className="modal-body lr-dialog-body">
          {children}
          {err && (
            <p className="lr-error" role="alert">
              {err}
            </p>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className={danger ? "btn-secondary lr-btn-danger" : "btn-primary"} disabled={busy || !canSubmit}>
            {busy ? "Working…" : submitLabel}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function LR_FlagSummaryLine({ flag }) {
  return (
    <p className="lr-dialog-flag">
      <strong>{LR_typeLabel(flag.flag_type)}</strong> · {LR_usDate(flag.txn_date)} · {flag.name || flag.memo || "(no name)"}
      {flag.amount != null ? " · " + LR_money(flag.amount) : ""}
    </p>
  );
}

function LR_ClearDialog({ flag, clientName, onCancel, onSubmit }) {
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [stop, setStop] = useState(false);
  const canStop = !!(String(flag.name || "").trim() || flag.account_qbo_id || flag.account_name);
  const target = String(flag.name || "").trim() ? `"${flag.name}"` : flag.account_name || "this account";
  return (
    <LR_Dialog
      id="lr-clear"
      title="Clear this flag"
      submitLabel="Clear"
      canSubmit={!!reason && note.length <= 2000}
      onCancel={onCancel}
      onSubmit={() => onSubmit({ reason, note: note.trim(), stop })}
    >
      <LR_FlagSummaryLine flag={flag} />
      <fieldset className="lr-fieldset">
        <legend className="ct-legend">Reason</legend>
        {LR_logic.CLEAR_REASONS.map((r) => (
          <label key={r.key} className="lr-radio">
            <input type="radio" name="lr-clear-reason" value={r.key} checked={reason === r.key} onChange={() => setReason(r.key)} />
            {r.label}
          </label>
        ))}
      </fieldset>
      <label className="ct-legend" htmlFor="lr-clear-note">
        Note (optional)
      </label>
      <textarea id="lr-clear-note" className="ct-notes" rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
      <label className={"lr-check" + (canStop ? "" : " is-disabled")}>
        <input type="checkbox" checked={stop} disabled={!canStop} onChange={(e) => setStop(e.target.checked)} />
        <span>
          Stop flagging this for {clientName}
          <span className="lr-hint">
            {canStop
              ? `Future "${LR_typeLabel(flag.flag_type)}" flags for ${target} won't show. You can undo this under Rules.`
              : "This flag has no name or account, so it can't be muted."}
          </span>
        </span>
      </label>
    </LR_Dialog>
  );
}

function LR_AskDialog({ flag, portalUsers, portalMissing, contactEmail, onCancel, onSubmit }) {
  const hasPortal = portalUsers.length > 0;
  const [via, setVia] = useState(hasPortal ? "portal" : "email");
  const [to, setTo] = useState(hasPortal ? portalUsers[0].email : contactEmail || "");
  const [q, setQ] = useState(LR_logic.defaultQuestion(flag));
  const pickVia = (v) => {
    setVia(v);
    setTo(v === "portal" ? (portalUsers[0] && portalUsers[0].email) || "" : contactEmail || "");
  };
  return (
    <LR_Dialog
      id="lr-ask"
      title="Ask the client"
      submitLabel={via === "email" ? "Send email" : "Send in portal"}
      canSubmit={!!to && !!q.trim() && q.length <= 2000}
      onCancel={onCancel}
      onSubmit={() => onSubmit({ via, to, question: q.trim() })}
    >
      <LR_FlagSummaryLine flag={flag} />
      <fieldset className="lr-fieldset">
        <legend className="ct-legend">Send it</legend>
        <label className={"lr-radio" + (hasPortal ? "" : " is-disabled")}>
          <input type="radio" name="lr-ask-via" value="portal" checked={via === "portal"} disabled={!hasPortal} onChange={() => pickVia("portal")} />
          In the portal{hasPortal ? "" : portalMissing ? " (portal users couldn't load)" : " (no portal users)"}
        </label>
        <label className={"lr-radio" + (contactEmail ? "" : " is-disabled")}>
          <input type="radio" name="lr-ask-via" value="email" checked={via === "email"} disabled={!contactEmail} onChange={() => pickVia("email")} />
          By email{contactEmail ? ` to ${contactEmail}` : " (add a contact email in Client setup)"}
        </label>
      </fieldset>
      {via === "portal" && hasPortal && (
        <>
          <label className="ct-legend" htmlFor="lr-ask-to">
            Who to ask
          </label>
          <select id="lr-ask-to" className="lr-select" value={to} onChange={(e) => setTo(e.target.value)}>
            {portalUsers.map((u) => (
              <option key={u.email} value={u.email}>
                {u.name ? `${u.name} (${u.email})` : u.email}
              </option>
            ))}
          </select>
        </>
      )}
      <label className="ct-legend" htmlFor="lr-ask-q">
        Question
      </label>
      <textarea id="lr-ask-q" className="ct-notes" rows={4} maxLength={2000} value={q} onChange={(e) => setQ(e.target.value)} />
      <p className="lr-hint">
        The client sees the date, name, amount and account with your question.
        {via === "email" ? " Replies come to your email." : " Replies come back in Messages."}
      </p>
    </LR_Dialog>
  );
}

function LR_TextDialog({ id, title, intro, label, submitLabel, required, maxLength, initial, onCancel, onSubmit, danger }) {
  const [text, setText] = useState(initial || "");
  const max = maxLength || 1000;
  return (
    <LR_Dialog
      id={id}
      title={title}
      submitLabel={submitLabel}
      danger={danger}
      canSubmit={(!required || !!text.trim()) && text.length <= max}
      onCancel={onCancel}
      onSubmit={() => onSubmit(text.trim())}
    >
      {intro}
      <label className="ct-legend" htmlFor={id + "-text"}>
        {label}
      </label>
      <textarea id={id + "-text"} className="ct-notes" rows={4} maxLength={max} value={text} onChange={(e) => setText(e.target.value)} />
      <p className="lr-hint">
        {text.length} of {max.toLocaleString()} characters
      </p>
    </LR_Dialog>
  );
}

function LR_PortalSendDialog({ users, onCancel, onSubmit }) {
  const [picked, setPicked] = useState(() => users.map((u) => u.email));
  const toggle = (email) => setPicked((p) => (p.indexOf(email) >= 0 ? p.filter((x) => x !== email) : p.concat([email])));
  return (
    <LR_Dialog
      id="lr-send-portal"
      title="Send the summary in the portal"
      submitLabel="Send"
      canSubmit={picked.length > 0 && picked.length <= 20}
      onCancel={onCancel}
      onSubmit={() => onSubmit(picked)}
    >
      <fieldset className="lr-fieldset">
        <legend className="ct-legend">Send to</legend>
        {users.map((u) => (
          <label key={u.email} className="lr-check">
            <input type="checkbox" checked={picked.indexOf(u.email) >= 0} onChange={() => toggle(u.email)} />
            <span>{u.name ? `${u.name} (${u.email})` : u.email}</span>
          </label>
        ))}
      </fieldset>
      <p className="lr-hint">Each person gets it as a message from you. Once sent, the summary can't be edited.</p>
    </LR_Dialog>
  );
}

// ---------------------------------------------------------------------------
// The tab
// ---------------------------------------------------------------------------
function LR_LedgerTab({ client, staffUser, isAdmin, onNavigate }) {
  const showToast = typeof useToast === "function" ? useToast() : null;
  const toast = (m) => showToast && showToast(m);
  const isPhone = LR_useIsPhone();
  const clientName = (client && (client.name || client.id)) || "this client";
  // Month lists use the firm (America/Chicago) date, not the browser's.
  const monthOpts = useMemo(() => LR_logic.monthOptions(new Date(), 24), []);
  const pullFromOpts = useMemo(() => LR_logic.pullFromOptions(new Date(), 24), []);
  // Per-run "Pull from" month start ('' = the saved default). Never saved.
  const [pullFrom, setPullFrom] = useState("");
  const pullFromRef = useRef("");
  // The month the saved flags are checked as of (the last complete month).
  // Fixed for the life of the tab, never the picker.
  const saveYm = monthOpts[0].ym;
  const [ym, setYm] = useState(monthOpts[0].ym);
  const period = LR_logic.toPeriod(ym);

  const [ctx, setCtx] = useState(null);
  const [ctxErr, setCtxErr] = useState("");
  const [stored, setStored] = useState(null);
  const [storedErr, setStoredErr] = useState("");
  const [questions, setQuestions] = useState({});
  const [month, setMonth] = useState({ loading: true, signoff: null, summary: null });
  const [data, setData] = useState(() => LR_cache().get(client.id));
  const [pull, setPull] = useState({ phase: "idle" });
  const [rulesChanged, setRulesChanged] = useState(false);
  const [tab, setTab] = useState("open");
  const [type, setType] = useState("all");
  const [dialog, setDialog] = useState(null);
  const [actionBusy, setActionBusy] = useState(false);

  const alive = useRef(true);
  const ctxRef = useRef(null);
  const ymRef = useRef(ym);
  const pullingRef = useRef(false);
  ctxRef.current = ctx;
  ymRef.current = ym;
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  const sinceRef = useRef(LR_logic.toPeriod(monthOpts[monthOpts.length - 1].ym));

  const reloadFlags = useCallback(async () => {
    try {
      const rows = await LR_api.loadFlags(client.id, sinceRef.current);
      if (!alive.current) return;
      setStored(rows);
      setStoredErr("");
      const qids = rows.map((r) => r.question_id).filter(Boolean);
      const qs = await LR_api.loadQuestions(qids);
      if (alive.current) setQuestions(qs);
    } catch (e) {
      if (alive.current) {
        setStored((s) => s || []);
        setStoredErr(e.message || "Couldn't load the saved flags.");
      }
    }
  }, [client.id]);

  const reloadRules = useCallback(async () => {
    try {
      const rules = await LR_api.loadRules(client.id);
      if (alive.current) setCtx((c) => (c ? { ...c, rules } : c));
    } catch (e) {}
  }, [client.id]);

  const reloadMonth = useCallback(async () => {
    const p = LR_logic.toPeriod(ymRef.current);
    const r = await LR_api.loadMonth(client.id, p);
    if (alive.current && LR_logic.toPeriod(ymRef.current) === p) setMonth({ loading: false, ...r });
  }, [client.id]);

  // ---- Pull + save -------------------------------------------------------
  const doPull = useCallback(
    async (force, useDefault) => {
      const c = ctxRef.current;
      if (!c || pullingRef.current) return;
      pullingRef.current = true;
      setPull({ phase: "pulling" });
      try {
        const picked = useDefault ? "" : pullFromRef.current;
        const windowKind = picked ? LR_logic.pullWindowFrom(picked) : (c.settings && c.settings.pull_window) || "rolling14";
        // A custom range always runs a new pull.
        let res = await LR_api.pull(client.id, windowKind, force || !!picked);
        if (res && res.status === "fresh") {
          const cached = LR_cache().get(client.id);
          if (cached) {
            if (alive.current) {
              setData(cached);
              setPull({ phase: "done", fresh: true });
            }
            return;
          }
          res = await LR_api.pull(client.id, windowKind, true);
        }
        if (!alive.current) return;
        if (!res || res.status === "in_progress") {
          setPull({ phase: "busy" });
          return;
        }
        if (res.status !== "ok") {
          setPull({ phase: "error", error: res.error || "The ledger pull didn't finish. Try again in a minute." });
          return;
        }
        let parsed;
        try {
          parsed = GLR_parse.fromPull(res);
        } catch (e) {
          setPull({ phase: "error", error: e.message });
          return;
        }
        parsed.warnings = Array.isArray(res.warnings) ? res.warnings.filter((w) => typeof w === "string") : [];
        LR_cache().set(client.id, parsed);
        setData(parsed);
        setPull({ phase: "saving" });

        // Save the flags this pull found, then retire the ones it didn't.
        // reviewPeriod is fixed (saveYm), so what's saved, and what
        // mark_fixed compares against, never depends on the month picker.
        let saveError = "";
        let fixed = 0;
        let pulledKind = "";
        // null = the firm watch list didn't load and the checks used the
        // built-in list; then nothing is marked fixed this time, so a
        // watch_vendor flag isn't retired just because the list was missing.
        const watchFallback = c.watchVendors == null;
        try {
          const run = GLR_checks.runChecks(parsed.lines, {
            rules: c.rules,
            watchVendors: c.watchVendors || undefined,
            clearedAvailable: parsed.cleared_available,
            reviewPeriod: saveYm,
          });
          // A custom pull has less history, so only window-independent flag
          // types are saved (the in-memory run still shows everything).
          const pid = await LR_api.pullIdFor(client.id, res);
          const rows = LR_logic.rowsForWindow(GLR_checks.toUpsertRows(run.flags), pid && pid.window_kind);
          if (!pid || !pid.pull_id) throw new Error("This pull couldn't be matched to its record, so the flags weren't saved. Pull again.");
          pulledKind = pid.window_kind;
          await LR_api.upsertFlags(client.id, pid.pull_id, GLR_config.CHECKS_VERSION, rows);
          if (pid.window_kind === "rolling14" && !watchFallback) {
            const r = await LR_api.markFixed(client.id, pid.pull_id, GLR_config.CHECKS_VERSION);
            fixed = (r && r.fixed) || 0;
          }
        } catch (e) {
          saveError = e.message || "The flags couldn't be saved.";
        }
        const pullRow = await LR_api.loadPullRow(client.id);
        await reloadFlags();
        if (!alive.current) return;
        if (pullRow) setCtx((x) => (x ? { ...x, pull: pullRow } : x));
        setRulesChanged(false);
        // A custom range is one-off: later re-pulls go back to the default.
        if (pulledKind === "custom") {
          pullFromRef.current = "";
          setPullFrom("");
        }
        setPull({ phase: "done", saveError, fixed, watchFallback, custom: pulledKind === "custom", covers: pullRow ? LR_logic.coveredLabel(pullRow) : "" });
        LR_api.notifyChanged(client.id, LR_logic.toPeriod(ymRef.current));
      } catch (e) {
        if (alive.current) setPull({ phase: "error", error: (e && e.message) || "The ledger pull didn't finish." });
      } finally {
        pullingRef.current = false;
      }
    },
    [client.id, reloadFlags, saveYm],
  );

  // ---- First load ---------------------------------------------------------
  useEffect(() => {
    let off = false;
    (async () => {
      try {
        const c = await LR_api.loadContext(client.id);
        if (off || !alive.current) return;
        setCtx(c);
        ctxRef.current = c;
        await reloadFlags();
        if (!off && alive.current && c.connected && !LR_cache().get(client.id)) doPull(false, true);
      } catch (e) {
        if (!off && alive.current) setCtxErr(e.message || "Couldn't load Ledger review.");
      }
    })();
    return () => {
      off = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client.id]);

  useEffect(() => {
    setMonth((m) => ({ ...m, loading: true }));
    reloadMonth();
  }, [ym, reloadMonth]);

  // ---- Deep links -------------------------------------------------------------
  // #/client/<id>/ledger?month=YYYY-MM (Close tab "Open Ledger review").
  // Claiming the arrival stops the global "couldn't find that item" toast.
  LK_useArrival({ clientId: client.id, tab: "ledger", kinds: ["view"], staff: true }, !!ctx, (a) => {
    if (!a || !a.month) return;
    if (monthOpts.some((m) => m.ym === a.month)) setYm(a.month);
    else if (typeof LK_toast === "function" && typeof LK_COPY === "object")
      LK_toast(LK_fill(LK_COPY.closeMonth, { Month: GLR_config.monthLabel(a.month), Month2: GLR_config.monthLabel(ymRef.current) }));
  });

  // ---- Derived -------------------------------------------------------------
  const rules = (ctx && ctx.rules) || [];
  const run = useMemo(() => {
    if (!data || !ctx) return null;
    return GLR_checks.runChecks(data.lines, {
      rules,
      watchVendors: ctx.watchVendors || undefined,
      clearedAvailable: data.cleared_available,
      reviewPeriod: ym,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, ctx && ctx.rules, ctx && ctx.watchVendors, ym]);

  const flags = useMemo(() => {
    const merged = LR_logic.attachRun(stored || [], run ? run.flags : []);
    const have = new Set(merged.map((f) => f.txn_key + "|" + f.flag_type));
    // A month-dependent flag (recon_uncleared) for a month other than
    // saveYm is never saved, so it isn't listed as "Not saved yet"; the
    // Reconciliation panel still shows that month.
    const unsaved = run
      ? run.flags
          .filter((f) => !have.has(f.txn_key + "|" + f.flag_type))
          .filter((f) => f.flag_type !== "recon_uncleared" || LR_logic.ymOf(f.period) === saveYm)
          .map((f) => ({ ...f, id: null, status: "open", first_period: f.period, run: f, unsaved: true }))
      : [];
    return merged.concat(unsaved).map((f) => {
      const q = f.question_id ? questions[f.question_id] : null;
      return q ? { ...f, question: q.note, q } : f;
    });
  }, [stored, run, questions, saveYm]);

  const counts = LR_logic.tabCounts(flags, ym);
  const chips = LR_logic.typeCounts(flags, ym, tab);
  const shown = LR_logic.viewFlags(flags, { ym, tab, type });
  const holdingRows = useMemo(() => (run ? GLR_checks.holdingTotals(run.lines, { period: ym }) : null), [run, ym]);
  const holding = holdingRows ? LR_logic.holdingSplit(holdingRows) : null;
  const monthLines = run ? run.lines.filter((l) => String(l.date).slice(0, 7) === ym).length : null;
  const compare = useMemo(() => {
    if (!run) return null;
    return GLR_compare.compareMonth(run.lines, ym, {
      rules,
      passThrough: GLR_rules.passThrough(run.lines, rules),
      lastCompleteMonth: LR_logic.lastCompleteMonth(new Date()),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, ym]);

  // Reset the type chip when it no longer has anything in this tab.
  useEffect(() => {
    if (type !== "all" && !chips.some((c) => c.type === type)) setType("all");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, ym, chips.length]);

  const portalUsers = (ctx && ctx.portalUsers) || [];
  const portalMissing = !!(ctx && ctx.portalUsersMissing);
  const contactEmail = (ctx && ctx.profile && ctx.profile.contact_email) || "";
  const greetingName = (ctx && ctx.profile && ctx.profile.greeting_name) || "";
  const canAsk = portalUsers.length > 0 || !!contactEmail;
  const signoff = month.signoff;
  const so = LR_logic.signoffSummary(signoff);
  const realAdmin = !!isAdmin;
  const me = String((staffUser && staffUser.email) || "").toLowerCase();

  // ---- Actions ---------------------------------------------------------------
  const act = async (fn, okMsg) => {
    if (actionBusy) return;
    setActionBusy(true);
    try {
      await fn();
      if (okMsg) toast(okMsg);
    } catch (e) {
      toast((e && e.message) || "That didn't work. Try again.");
    } finally {
      if (alive.current) setActionBusy(false);
    }
  };
  const afterFlagChange = async () => {
    await reloadFlags();
    LR_api.notifyChanged(client.id, period);
  };

  const onClear = (f) =>
    setDialog({
      kind: "clear",
      flag: f,
      submit: async ({ reason, note, stop }) => {
        await LR_api.clear(f.id, reason, note, stop);
        setDialog(null);
        toast(stop ? `Cleared. It won't be flagged again for ${clientName}.` : "Cleared.");
        if (stop) await reloadRules();
        await afterFlagChange();
      },
    });

  const onAsk = (f) =>
    setDialog({
      kind: "ask",
      flag: f,
      submit: async ({ via, to, question }) => {
        let qid;
        try {
          qid = await LR_api.ask(f.id, via, to, question);
        } catch (e) {
          if (e && e.code === "23505") throw new Error("There's already an open question about this transaction. It's in Messages and the Bank tab.");
          throw e;
        }
        setDialog(null);
        if (via === "email") {
          try {
            const r = await LR_api.sendEmail("question", qid);
            toast(r.status === "test_sent" ? "Test client: a [Test] copy of the question went to you." : `Question emailed to ${to}.`);
          } catch (e) {
            toast(`The question is saved, but the email didn't send: ${e.message}`);
          }
        } else {
          toast("Question sent in the portal.");
        }
        // The question posts a thread message (database trigger): refresh
        // Messages, the Bank tab pill and the bell.
        if (typeof TQ_notify === "function") TQ_notify();
        await afterFlagChange();
      },
    });

  const onAnswer = (f) =>
    setDialog({
      kind: "text",
      id: "lr-answer",
      title: "Got an answer",
      intro: (
        <>
          <LR_FlagSummaryLine flag={f} />
          {f.question ? <p className="lr-hint">You asked: {f.question}</p> : null}
        </>
      ),
      label: "What did they say?",
      submitLabel: "Save the answer",
      required: true,
      maxLength: 2000,
      submit: async (text) => {
        await LR_api.answer(f.id, text);
        setDialog(null);
        toast("Answer saved. Clear the flag when it's sorted out.");
        if (typeof TQ_notify === "function") TQ_notify();
        await afterFlagChange();
      },
    });

  const onSendBackFlag = (f) =>
    setDialog({
      kind: "text",
      id: "lr-sendback-flag",
      title: "Send this flag back",
      intro: (
        <>
          <LR_FlagSummaryLine flag={f} />
          <p className="lr-hint">It goes back to Open with your note, so the bookkeeper looks again.</p>
        </>
      ),
      label: "Note for the bookkeeper",
      submitLabel: "Send back",
      required: true,
      maxLength: 1000,
      submit: async (text) => {
        await LR_api.sendBackFlag(f.id, text);
        setDialog(null);
        toast("Sent back.");
        await afterFlagChange();
      },
    });

  const doMarkReviewed = () =>
    act(async () => {
      const r = await LR_api.markReviewed(client.id, period);
      await reloadMonth();
      LR_api.notifyChanged(client.id, period);
      if (r && r.month_started && typeof CT_CHANGED_EVENT === "string") {
        try {
          window.dispatchEvent(new CustomEvent(CT_CHANGED_EVENT));
        } catch (e) {}
      }
      toast(`${GLR_config.monthLabel(ym)} marked reviewed.${realAdmin ? "" : " An admin will approve it."}`);
    });
  const onMarkReviewed = () => {
    const high = LR_logic.viewFlags(flags, { ym, tab: "open" }).filter((f) => f.severity === "high" && LR_logic.ymOf(f.period) === ym).length;
    if (high > 0) {
      setDialog({
        kind: "confirm",
        title: "High-priority flags are still open",
        body: `${high} high-priority flag${high === 1 ? " is" : "s are"} still open for ${GLR_config.monthLabel(ym)}. Mark it reviewed anyway?`,
        confirmLabel: "Mark reviewed anyway",
        run: doMarkReviewed,
      });
    } else doMarkReviewed();
  };
  const onApprove = () =>
    act(async () => {
      await LR_api.approve(client.id, period);
      await reloadMonth();
      LR_api.notifyChanged(client.id, period);
    }, `${GLR_config.monthLabel(ym)} approved.`);
  const onSendBackMonth = () =>
    setDialog({
      kind: "text",
      id: "lr-sendback-month",
      title: `Send ${GLR_config.monthLabel(ym)} back`,
      intro: <p className="lr-hint">The Close step "Ledger reviewed" unticks, and the bookkeeper sees your note here and on the Close tab.</p>,
      label: "What needs another look?",
      submitLabel: "Send back",
      required: true,
      maxLength: 1000,
      submit: async (text) => {
        await LR_api.sendBack(client.id, period, text);
        setDialog(null);
        toast("Sent back.");
        await reloadMonth();
        LR_api.notifyChanged(client.id, period);
      },
    });

  // Pass-through and rules.
  const ruleAct = (fn, msg) =>
    act(async () => {
      await fn();
      await reloadRules();
      setRulesChanged(true);
    }, msg);
  const keepPassThrough = (a) =>
    ruleAct(
      () => LR_api.saveRule(client.id, { kind: "pass_through", account_qbo_id: a.acct_id, account_name: a.acct, source: "auto_detected" }),
      `${a.acct} saved as a pass-through account.`,
    );
  const dismissPassThrough = (a) =>
    ruleAct(async () => {
      const id = await LR_api.saveRule(client.id, {
        kind: "pass_through",
        account_qbo_id: a.acct_id,
        account_name: a.acct,
        status: "suggested",
        source: "auto_detected",
      });
      await LR_api.setRuleStatus(id, "dismissed");
    }, `${a.acct} will be checked like any other account.`);
  const removeRule = (r) => ruleAct(() => LR_api.setRuleStatus(r.id, "dismissed"), "Rule removed.");
  const acceptRule = (r) => ruleAct(() => LR_api.setRuleStatus(r.id, "active"), "Rule turned on.");

  // ---- Render ------------------------------------------------------------------
  if (ctxErr) {
    return (
      <div className="lr-page">
        <p className="lr-error" role="alert">
          {ctxErr}
        </p>
      </div>
    );
  }
  if (!ctx) {
    return (
      <div className="lr-page">
        <p className="card-subtitle" role="status">
          Loading Ledger review…
        </p>
      </div>
    );
  }
  if (ctx.schemaMissing) {
    return (
      <div className="lr-page">
        <section className="card lr-panel">
          <h3 className="card-title">Ledger review isn't set up yet</h3>
          <p className="card-subtitle">The Ledger review tables aren't in the database yet. Ask an admin to apply the Ledger review migrations.</p>
        </section>
      </div>
    );
  }

  const pullRow = ctx.pull;
  const pulling = pull.phase === "pulling" || pull.phase === "saving";
  let pullLine = "";
  if (pullRow && pullRow.status === "ok") {
    pullLine = `Last pulled ${LR_when(pullRow.finished_at || pullRow.started_at)}${pullRow.pulled_by ? " by " + LR_logic.who(pullRow.pulled_by) : ""}`;
    const covered = LR_logic.coveredLabel(pullRow);
    if (covered) pullLine += " · covered " + covered;
    else if (pullRow.window_kind) pullLine += " · " + LR_logic.pullWindowLabel(pullRow);
  } else if (pullRow && pullRow.status === "running") pullLine = "A pull is running…";
  else if (!pullRow) pullLine = "Not pulled yet";
  const reviewFileHref = "#/work/ledger";

  const toolbar = (
    <div className="lr-toolbar app-topbar-row">
      <label className="lr-field">
        <span className="lr-month-label">Review month</span>
        <select className="lr-select" value={ym} onChange={(e) => setYm(e.target.value)}>
          {monthOpts.map((m) => (
            <option key={m.ym} value={m.ym}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
      {ctx.connected && (
        <label className="lr-field">
          <span className="lr-month-label">Pull transactions back to</span>
          <select
            className="lr-select"
            title="Applies to this pull only; your saved setting doesn't change."
            value={pullFrom}
            disabled={pulling}
            onChange={(e) => {
              pullFromRef.current = e.target.value;
              setPullFrom(e.target.value);
            }}
          >
            <option value="">Usual range ({(ctx.settings && ctx.settings.pull_window) === "ytd" ? "this year so far" : "14 months back"})</option>
            {pullFromOpts.map((m) => (
              <option key={m.ym} value={m.start}>
                {m.label}
              </option>
            ))}
          </select>
          <span className="lr-hint">Choose an earlier month to include older transactions. Applies to this pull only; your saved setting doesn't change.</span>
        </label>
      )}
      {ctx.connected && (
        <button type="button" className="btn-secondary" disabled={pulling} onClick={() => doPull(true)}>
          {pull.phase === "pulling" ? "Getting latest…" : pull.phase === "saving" ? "Saving flags…" : "Pull from QuickBooks"}
        </button>
      )}
      <span className="lr-pull-line">{pullLine}</span>
    </div>
  );

  // The picked month is earlier than the loaded pull's first day.
  const winStart = data && data.window && data.window.start;
  const beforeWindow = !!winStart && String(ym) < String(winStart).slice(0, 7);

  let banner = null;
  if (!ctx.connected) {
    banner = (
      <div className="lr-note" role="note">
        <p>
          QuickBooks isn't connected for {clientName}, so there's no ledger to pull. You can still check an exported General Ledger in{" "}
          <a href={reviewFileHref}>Work › Ledger review</a>.
        </p>
      </div>
    );
  } else if (pull.phase === "pulling") {
    banner = (
      <p className="lr-note" role="status">
        Pulling the ledger from QuickBooks. This takes a few seconds…
      </p>
    );
  } else if (pull.phase === "saving") {
    banner = (
      <p className="lr-note" role="status">
        Saving the flags…
      </p>
    );
  } else if (pull.phase === "busy") {
    banner = (
      <div className="lr-note is-warn" role="status">
        <p>Someone else is pulling this ledger right now. Try again in a minute.</p>
        <button type="button" className="btn-secondary lr-btn-sm" onClick={() => doPull(false)}>
          Try again
        </button>
      </div>
    );
  } else if (pull.phase === "error") {
    const notConnected = /isn't connected|reconnect/i.test(pull.error || "");
    banner = (
      <div className="lr-note is-bad" role="alert">
        <p>{pull.error}</p>
        <div className="lr-note-actions">
          <button type="button" className="btn-secondary lr-btn-sm" onClick={() => doPull(true)}>
            Try again
          </button>
          {notConnected && <a href={reviewFileHref}>Review a file instead</a>}
        </div>
      </div>
    );
  } else if (pull.phase === "done" && !pull.saveError && pull.watchFallback) {
    banner = (
      <p className="lr-note is-warn" role="status">
        The firm watch list didn't load, so this pull used the built-in list and didn't mark anything fixed. Pull again later to retire flags QuickBooks
        no longer shows.
      </p>
    );
  } else if (pull.phase === "done" && !pull.saveError && pull.custom) {
    banner = (
      <p className="lr-note" role="status">
        Covered {pull.covers || "the picked range"}. Flags that dropped out of QuickBooks weren't cleaned up; only the 14-month pull does that. History-based checks
        (round amounts, weekends, large, repeat vendors, check gaps, uncleared loans) are shown but not saved on a custom pull.
      </p>
    );
  } else if (pull.phase === "done" && pull.saveError) {
    banner = (
      <p className="lr-note is-bad" role="alert">
        The ledger loaded, but the flags couldn't be saved: {pull.saveError} The list below shows what this pull found; actions come back once it saves.
      </p>
    );
  }

  const dataNote = data ? `Ledger lines are kept in this browser tab for 15 minutes (pulled ${LR_when(data.pulled_at)}), never saved.` : "";

  const strip = (
    <LR_Strip
      items={[
        { label: "Ledger lines", value: monthLines == null ? "—" : monthLines.toLocaleString() },
        { label: "Open flags", value: counts.open },
        { label: "High priority", value: counts.high, tone: counts.high ? "bad" : null },
        { label: "Asked", value: counts.asked },
        {
          label: "Uncategorized",
          value: holding ? LR_money(holding.uncategorized.total) : "—",
          tone: holding && holding.uncategorized.total ? "warn" : null,
        },
        { label: "Ask Client", value: holding ? LR_money(holding.ask.total) : "—", tone: holding && holding.ask.total ? "warn" : null },
      ]}
      note={`Counts as of the last pull. ${dataNote}`}
    />
  );

  // Per-row meta and actions.
  const renderMeta = (f) => {
    const out = [];
    if (f.unsaved) out.push(<p key="u" className="lr-meta is-warn">Not saved yet</p>);
    if (f.status === "open" && f.sent_back_note)
      out.push(
        <p key="sb" className="lr-meta is-warn">
          Sent back: {f.sent_back_note}
        </p>,
      );
    if (f.status === "asked") {
      const q = f.q;
      out.push(
        <div key="q" className="lr-meta lr-q">
          <p>
            Asked{q && q.asked_via ? (q.asked_via === "email" ? " by email" : " in the portal") : ""}
            {q && q.asked_of_email ? " to " + q.asked_of_email : ""}
            {q && q.created_at ? " · " + LR_when(q.created_at) : ""}
          </p>
          {f.question ? <p className="lr-q-text">"{f.question}"</p> : null}
          {q && q.answer ? (
            <p className="lr-q-answer">
              <strong>Answer:</strong> {q.answer}
            </p>
          ) : (
            <p className="lr-hint">Waiting for an answer.</p>
          )}
        </div>,
      );
    }
    if (f.status === "cleared")
      out.push(
        <p key="c" className="lr-meta">
          {LR_logic.clearReasonLabel(f.cleared_reason)}
          {f.cleared_by && f.cleared_by !== "rule" ? " · " + LR_logic.who(f.cleared_by) : ""}
          {f.cleared_at ? " · " + LR_when(f.cleared_at) : ""}
          {f.stop_flagging ? " · won't be flagged again" : ""}
          {f.note ? <span className="lr-meta-note">{f.note}</span> : null}
        </p>,
      );
    if (f.status === "fixed")
      out.push(
        <p key="x" className="lr-meta is-good">
          Fixed in QuickBooks{f.fixed_at ? " · gone from the pull on " + LR_when(f.fixed_at) : ""}
        </p>,
      );
    return out.length ? out : null;
  };
  const renderActions = (f) => {
    if (!f.id) return null;
    const btns = [];
    if (f.status === "open" || f.status === "asked")
      btns.push(
        <button key="clear" type="button" className="btn-secondary lr-btn-sm" disabled={actionBusy} onClick={() => onClear(f)}>
          Clear
        </button>,
      );
    if (f.status === "open" && LR_logic.isAskable(f) && canAsk)
      btns.push(
        <button key="ask" type="button" className="btn-secondary lr-btn-sm" disabled={actionBusy} onClick={() => onAsk(f)}>
          Ask client
        </button>,
      );
    if (f.status === "asked" && f.q && f.q.asked_via === "email" && f.q.status === "open")
      btns.push(
        <button key="ans" type="button" className="btn-secondary lr-btn-sm" disabled={actionBusy} onClick={() => onAnswer(f)}>
          Got an answer
        </button>,
      );
    if (f.status === "cleared" && realAdmin)
      btns.push(
        <button key="sb" type="button" className="link-btn lr-btn-sm" disabled={actionBusy} onClick={() => onSendBackFlag(f)}>
          Send back
        </button>,
      );
    return btns.length ? btns : null;
  };

  const tabs = [
    { key: "open", label: "Open", n: counts.open },
    { key: "asked", label: "Asked", n: counts.asked },
    { key: "cleared", label: "Cleared", n: counts.cleared },
  ];
  const emptyText =
    tab === "open"
      ? stored === null
        ? "Loading…"
        : data || !ctx.connected
          ? `Nothing open for ${GLR_config.monthLabel(ym)}.`
          : "Nothing saved yet. Pull the ledger to run the checks."
      : tab === "asked"
        ? "No questions waiting on the client."
        : `Nothing cleared for ${GLR_config.monthLabel(ym)} yet.`;

  const flagsCard = (
    <section className="card lr-panel lr-flags-card" aria-labelledby="lr-flags-h" data-tour="ledger-flags">
      <div className="lr-panel-head">
        <h3 className="card-title" id="lr-flags-h">
          Flags
        </h3>
        {shown.length > 0 && (
          <button
            type="button"
            className="btn-secondary lr-btn-sm"
            onClick={async () => toast((await LR_copyText(LR_logic.flagsToTsv(shown))) ? "Copied. Paste into Excel." : "Couldn't copy. Try again.")}
          >
            Copy for Excel
          </button>
        )}
      </div>
      {storedErr && (
        <p className="lr-error" role="alert">
          {storedErr}
        </p>
      )}
      {!canAsk && counts.open > 0 && (
        <p className="lr-hint">
          Ask client is off: {clientName} has no portal users and no contact email.{" "}
          <a href={typeof TB_clientHash === "function" ? TB_clientHash(client.id, "setup") : "#"}>Add a contact email in Client setup</a>.
        </p>
      )}
      <LR_StatusTabs tabs={tabs} current={tab} onSelect={setTab} idPrefix="lr-st" controls="lr-flag-panel" />
      <div id="lr-flag-panel" role="tabpanel" aria-labelledby={"lr-st-tab-" + tab}>
        <LR_TypeChips chips={chips} current={type} onSelect={setType} total={chips.reduce((s, c) => s + c.n, 0)} idPrefix="lr" />
        <LR_FlagList flags={shown} ym={ym} renderMeta={renderMeta} renderActions={renderActions} emptyText={emptyText} idPrefix="lr" />
      </div>
    </section>
  );

  // Pass-through accounts and rules.
  const pt = (run && run.passThrough) || [];
  const activeRules = rules.filter((r) => r.status !== "dismissed");
  const bsAccounts = run
    ? Array.from(
        new Map(
          run.lines.filter((l) => !GLR_config.isPL(l.classification)).map((l) => [l.acct_id != null ? "id:" + l.acct_id : "n:" + l.acct, l]),
        ).values(),
      )
        .filter((l) => !pt.some((a) => (a.acct_id != null && a.acct_id === l.acct_id) || a.acct === l.acct))
        .sort((a, b) => String(a.acct).localeCompare(String(b.acct)))
    : [];
  const rulesCard = (
    <LR_RulesCard
      clientName={clientName}
      passThrough={pt}
      rules={activeRules}
      bsAccounts={bsAccounts}
      hasData={!!run}
      busy={actionBusy}
      rulesChanged={rulesChanged && ctx.connected}
      onPull={() => doPull(true)}
      onKeep={keepPassThrough}
      onDismiss={dismissPassThrough}
      onRemove={removeRule}
      onAccept={acceptRule}
      onAdd={(l) =>
        ruleAct(
          () => LR_api.saveRule(client.id, { kind: "pass_through", account_qbo_id: l.acct_id, account_name: l.acct }),
          `${l.acct} saved as a pass-through account.`,
        )
      }
    />
  );

  const summaryCard = (
    <LR_SummaryCard
      key={"sum-" + ym}
      client={client}
      clientName={clientName}
      staffUser={staffUser}
      ym={ym}
      period={period}
      loading={month.loading}
      summary={month.summary}
      flags={flags}
      run={run}
      compare={compare}
      holdingRows={holdingRows}
      greetingName={greetingName}
      portalUsers={portalUsers}
      contactEmail={contactEmail}
      onSaved={reloadMonth}
      openDialog={setDialog}
      toast={toast}
    />
  );

  const selfReviewed = signoff && String(signoff.reviewed_by || "").toLowerCase() === me;
  const signoffBar = (
    <section
      className={"card lr-signoff is-" + so.key + (isPhone ? " is-phone" : "")}
      aria-labelledby="lr-signoff-h"
      data-tour="ledger-signoff"
    >
      <div className="lr-signoff-text">
        <h3 className="card-title" id="lr-signoff-h">
          Sign-off for {GLR_config.monthLabel(ym)}
        </h3>
        <p className="lr-signoff-state">
          <span className={"lr-pill is-" + so.key}>{month.loading ? "Loading…" : so.label}</span>
          {so.detail ? <span className="lr-signoff-detail">{so.detail}</span> : null}
        </p>
        {signoff && signoff.status === "reviewed" && signoff.high_open_at_review > 0 && (
          <p className="lr-hint">
            {signoff.high_open_at_review} high-priority flag{signoff.high_open_at_review === 1 ? " was" : "s were"} open when it was marked
            reviewed.
          </p>
        )}
        {signoff && signoff.status === "approved" && signoff.approved_at && <p className="lr-hint">Approved {LR_when(signoff.approved_at)}.</p>}
      </div>
      <div className="lr-signoff-actions">
        {(!signoff || signoff.status === "in_review" || signoff.status === "sent_back") && (
          <button type="button" className="btn-primary" disabled={actionBusy || month.loading} onClick={onMarkReviewed}>
            Mark reviewed
          </button>
        )}
        {signoff && signoff.status === "reviewed" && !realAdmin && (
          <button type="button" className="btn-secondary" disabled={actionBusy} onClick={onMarkReviewed}>
            Mark reviewed again
          </button>
        )}
        {realAdmin && signoff && signoff.status === "reviewed" && (
          <button type="button" className="btn-primary" disabled={actionBusy} onClick={onApprove}>
            {selfReviewed ? "Approve my review" : "Approve"}
          </button>
        )}
        {realAdmin && signoff && (signoff.status === "reviewed" || signoff.status === "approved") && (
          <button type="button" className="btn-secondary" disabled={actionBusy} onClick={onSendBackMonth}>
            Send back
          </button>
        )}
      </div>
    </section>
  );

  let dialogEl = null;
  if (dialog) {
    const close = () => setDialog(null);
    if (dialog.kind === "clear")
      dialogEl = <LR_ClearDialog flag={dialog.flag} clientName={clientName} onCancel={close} onSubmit={dialog.submit} />;
    else if (dialog.kind === "ask")
      dialogEl = (
        <LR_AskDialog
          flag={dialog.flag}
          portalUsers={portalUsers}
          portalMissing={portalMissing}
          contactEmail={contactEmail}
          onCancel={close}
          onSubmit={dialog.submit}
        />
      );
    else if (dialog.kind === "text")
      dialogEl = (
        <LR_TextDialog
          id={dialog.id}
          title={dialog.title}
          intro={dialog.intro}
          label={dialog.label}
          submitLabel={dialog.submitLabel}
          required={dialog.required}
          maxLength={dialog.maxLength}
          initial={dialog.initial}
          onCancel={close}
          onSubmit={dialog.submit}
        />
      );
    else if (dialog.kind === "portal") dialogEl = <LR_PortalSendDialog users={portalUsers} onCancel={close} onSubmit={dialog.submit} />;
    else if (dialog.kind === "confirm")
      dialogEl = (
        <ConfirmModal
          title={dialog.title}
          body={dialog.body}
          confirmLabel={dialog.confirmLabel}
          onCancel={close}
          onConfirm={() => {
            const r = dialog.run;
            setDialog(null);
            if (r) r();
          }}
        />
      );
  }

  return (
    <div className="lr-page" data-tour="client-ledger">
      {toolbar}
      {banner}
      {beforeWindow && (
        <p className="lr-note" role="status">
          This month wasn't in the last pull. Use Pull transactions back to (next to Pull from QuickBooks) to include older months.
        </p>
      )}
      {data && data.warnings && data.warnings.length > 0 && (
        <ul className="lr-note is-warn" aria-label="Warnings from the pull">
          {data.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
      {strip}
      {flagsCard}
      <div className="lr-grid">
        <LR_ReconPanel recon={run ? run.recon : null} hasData={!!run} />
        <LR_ComparePanel
          rows={compare}
          ym={ym}
          hasData={!!run}
          passThroughCount={pt.length}
          onCopy={async (rows) => toast((await LR_copyText(LR_logic.compareToTsv(rows, ym))) ? "Copied. Paste into Excel." : "Couldn't copy. Try again.")}
        />
      </div>
      {rulesCard}
      {summaryCard}
      {signoffBar}
      {dialogEl}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pass-through accounts and rules
// ---------------------------------------------------------------------------
function LR_RulesCard({
  clientName,
  passThrough,
  rules,
  bsAccounts,
  hasData,
  busy,
  rulesChanged,
  onPull,
  onKeep,
  onDismiss,
  onRemove,
  onAccept,
  onAdd,
}) {
  const [addKey, setAddKey] = useState("");
  const keyOf = (l) => (l.acct_id != null ? "id:" + l.acct_id : "n:" + l.acct);
  const auto = passThrough.filter((a) => a.source === "auto");
  return (
    <section className="card lr-panel" aria-labelledby="lr-rules-h">
      <h3 className="card-title" id="lr-rules-h">
        Pass-through accounts and rules
      </h3>
      <p className="card-subtitle">
        Pass-through accounts (spend cards and bill-pay clearing) are left out of the checks and the year comparison. Rules apply to{" "}
        {clientName} only.
      </p>
      {rulesChanged && (
        <div className="lr-note is-warn" role="status">
          <p>Rules changed. Pull from QuickBooks again to update the saved flags.</p>
          <button type="button" className="btn-secondary lr-btn-sm" onClick={onPull} disabled={busy}>
            Pull from QuickBooks
          </button>
        </div>
      )}
      {auto.length > 0 && (
        <div className="lr-sub">
          <h4 className="lr-sub-h">Suggested pass-through accounts</h4>
          <ul className="lr-rule-list">
            {auto.map((a) => (
              <li key={(a.acct_id || "") + a.acct} className="lr-rule">
                <span className="lr-rule-text">
                  {a.acct} <span className="lr-kind">Suggested from the name</span>
                </span>
                <span className="lr-rule-actions">
                  <button type="button" className="btn-secondary lr-btn-sm" disabled={busy} onClick={() => onKeep(a)}>
                    Keep
                  </button>
                  <button type="button" className="link-btn lr-btn-sm" disabled={busy} onClick={() => onDismiss(a)}>
                    Not pass-through
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="lr-sub">
        <h4 className="lr-sub-h">Saved rules</h4>
        {rules.length === 0 ? (
          <p className="card-subtitle">No rules yet. "Stop flagging" on a Clear adds one.</p>
        ) : (
          <ul className="lr-rule-list">
            {rules.map((r) => (
              <li key={r.id} className="lr-rule">
                <span className="lr-rule-text">
                  {LR_logic.ruleLabel(r)}
                  {r.status === "suggested" ? <span className="lr-kind">Suggested</span> : null}
                  {r.note ? <span className="lr-meta-note">{r.note}</span> : null}
                </span>
                <span className="lr-rule-actions">
                  {r.status === "suggested" && (
                    <button type="button" className="btn-secondary lr-btn-sm" disabled={busy} onClick={() => onAccept(r)}>
                      Turn on
                    </button>
                  )}
                  <button type="button" className="link-btn lr-btn-sm" disabled={busy} onClick={() => onRemove(r)} aria-label={"Remove rule: " + LR_logic.ruleLabel(r)}>
                    Remove
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {hasData && bsAccounts.length > 0 && (
        <form
          className="lr-add-pt"
          onSubmit={(e) => {
            e.preventDefault();
            const l = bsAccounts.find((x) => keyOf(x) === addKey);
            if (l) {
              onAdd(l);
              setAddKey("");
            }
          }}
        >
          <label className="ct-legend" htmlFor="lr-add-pt">
            Mark another account as pass-through
          </label>
          <div className="lr-inline">
            <select id="lr-add-pt" className="lr-select" value={addKey} onChange={(e) => setAddKey(e.target.value)}>
              <option value="">Pick an account…</option>
              {bsAccounts.map((l) => (
                <option key={keyOf(l)} value={keyOf(l)}>
                  {l.acct}
                </option>
              ))}
            </select>
            <button type="submit" className="btn-secondary lr-btn-sm" disabled={busy || !addKey}>
              Save
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Summary for the client (spec 7.3). Nothing sends automatically.
// ---------------------------------------------------------------------------
function LR_SummaryCard({
  client,
  clientName,
  staffUser,
  ym,
  period,
  loading,
  summary,
  flags,
  run,
  compare,
  holdingRows,
  greetingName,
  portalUsers,
  contactEmail,
  onSaved,
  openDialog,
  toast,
}) {
  const sent = summary && summary.status === "sent";
  const draftFor = () => {
    if (!run) return null;
    const findings = GLR_summary.buildFindings({
      period: ym,
      flags,
      lines: run.lines,
      recon: run.recon,
      compare: compare || [],
      holding: holdingRows || [],
    });
    const out = GLR_summary.findingsToSummary(findings, {
      greetingName,
      bookkeeperName: LR_firstName(staffUser),
      clientName,
      orgType: client.orgType || client.org_type,
    });
    return { findings, ...out };
  };
  const [text, setText] = useState("");
  const [built, setBuilt] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);

  // Start from the saved draft, else from the template once the pull is in.
  useEffect(() => {
    if (loading || dirty) return;
    if (summary && summary.body) {
      setText(summary.body);
      return;
    }
    const d = draftFor();
    if (d) {
      setBuilt(d);
      setText(d.body);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, summary && summary.id, summary && summary.body, !!run]);

  const needsGreeting = LR_isChurch(client) && !String(greetingName || "").trim();
  const save = async () => {
    const d = built || draftFor();
    const variant = (d && d.variant) || (summary && summary.variant) || "minor";
    const findings = (d && d.findings) || (summary && summary.findings) || {};
    const id = await LR_api.saveSummary(client.id, period, variant, text.trim(), findings);
    setDirty(false);
    return id;
  };
  const wrap = async (fn) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast((e && e.message) || "That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  };
  const onSaveDraft = () =>
    wrap(async () => {
      await save();
      await onSaved();
      toast("Draft saved.");
    });
  const onRebuild = () => {
    const d = draftFor();
    if (!d) return;
    setBuilt(d);
    setText(d.body);
    setDirty(true);
  };
  const onPortal = () =>
    openDialog({
      kind: "portal",
      submit: async (emails) => {
        const id = await save();
        await LR_api.sendSummaryPortal(id, emails);
        openDialog(null);
        toast("Summary sent in the portal.");
        await onSaved();
      },
    });
  const onEmail = () =>
    openDialog({
      kind: "confirm",
      title: "Email the summary",
      body: `Send this summary to ${contactEmail}? Once sent, it can't be edited.`,
      confirmLabel: "Send email",
      run: () =>
        wrap(async () => {
          const id = await save();
          const r = await LR_api.sendEmail("summary", id);
          toast(r.status === "test_sent" ? "Test client: a [Test] copy of the summary went to you." : `Summary emailed to ${contactEmail}.`);
          await onSaved();
        }),
    });

  const empty = !text.trim();
  const tooLong = text.length > 8000;
  let body;
  if (loading) body = <p className="card-subtitle">Loading…</p>;
  else if (sent)
    body = (
      <>
        <p className="lr-meta is-good">
          Sent {summary.sent_via === "email" ? "by email" : "in the portal"}
          {summary.sent_to && summary.sent_to.length ? " to " + summary.sent_to.join(", ") : ""}
          {summary.sent_at ? " · " + LR_when(summary.sent_at) : ""}
          {summary.sent_by ? " · " + LR_logic.who(summary.sent_by) : ""}
        </p>
        <pre className="lr-summary-sent">{summary.body}</pre>
      </>
    );
  else if (!run && !(summary && summary.body))
    body = <p className="card-subtitle">Pull the ledger to draft this month's summary.</p>;
  else
    body = (
      <>
        {needsGreeting && (
          <p className="lr-hint">
            The summary starts with "Hello," because {clientName} has no greeting name.{" "}
            <a href={typeof TB_clientHash === "function" ? TB_clientHash(client.id, "setup") : "#"}>Set a greeting name</a> (for example,
            "Pastor Mark").
          </p>
        )}
        <label className="ct-legend" htmlFor="lr-summary-text">
          Draft for {clientName}
        </label>
        <textarea
          id="lr-summary-text"
          className="ct-notes lr-summary-text"
          rows={12}
          maxLength={8000}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setDirty(true);
          }}
        />
        <p className="lr-hint">
          {text.length.toLocaleString()} of 8,000 characters{summary && summary.updated_at && !dirty ? " · draft saved " + LR_when(summary.updated_at) : ""}
          {dirty ? " · not saved" : ""}
        </p>
        <div className="lr-summary-actions">
          <button type="button" className="btn-secondary lr-btn-sm" disabled={busy || empty || tooLong || !dirty} onClick={onSaveDraft}>
            Save draft
          </button>
          {run && (
            <button type="button" className="link-btn lr-btn-sm" disabled={busy} onClick={onRebuild}>
              Start over from the template
            </button>
          )}
          <span className="lr-spacer" />
          <button
            type="button"
            className="btn-primary lr-btn-sm"
            disabled={busy || empty || tooLong || !portalUsers.length}
            onClick={onPortal}
            aria-describedby={!portalUsers.length ? "lr-sum-portal-why" : undefined}
          >
            Send via portal
          </button>
          <button
            type="button"
            className="btn-secondary lr-btn-sm"
            disabled={busy || empty || tooLong || !contactEmail}
            onClick={onEmail}
            aria-describedby={!contactEmail ? "lr-sum-email-why" : undefined}
          >
            Send by email
          </button>
        </div>
        {!portalUsers.length && (
          <p className="lr-hint" id="lr-sum-portal-why">
            Send via portal is off: {clientName} has no active portal users who can see the whole company.
          </p>
        )}
        {!contactEmail && (
          <p className="lr-hint" id="lr-sum-email-why">
            Send by email is off: add a contact email in Client setup.
          </p>
        )}
      </>
    );
  return (
    <section className="card lr-panel" aria-labelledby="lr-summary-h" data-tour="ledger-summary">
      <h3 className="card-title" id="lr-summary-h">
        Summary for the client
      </h3>
      {body}
    </section>
  );
}
