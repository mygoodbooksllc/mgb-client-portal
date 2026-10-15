// ----------------------------------------------------------------------------
// Month-end close tracker (owner request 2026-09-29). Work → Close tab
// (#/work/close, staff navigation redesign 2026-10-08), every staff member.
//
// Clients x months grid: the last 6 months plus the current one. Each cell is
// a month_close row (supabase/month-close.sql); no row = not started.
// Statuses: not started / in progress / review / done / n.a., with who and
// when stamped server-side.
//
// Scope: the page gets App's visibleClients (a bookkeeper's assigned and
// temporarily granted clients; admins get everyone) and RLS
// (can_access_client) enforces the same thing on writes.
//
// CT_useCloseStatus loads the rows, the late day and the viewer's own client
// ids once, for this page and for the Clients list (ClientsPage.jsx), which
// shows each client's month being closed and whether it is late.
//
// Late: a month is late once today is past late_day of the FOLLOWING month
// and it isn't done / n.a. late_day lives in month_close_settings (default
// 15); admins change it here.
//
// Filters (bookkeeper, status) and the summary counts apply to the "focus"
// month, last month by default, since that's the one being closed. Saving a
// cell fires OB_CHANGED_EVENT so the onboarding "First close done" step
// updates.
//
// QuickBooks close checks (CloseChecks.jsx, Phase 1 2026-09-30): each
// completed month's cell also shows the automated status (ready / blocked /
// behind) with the reasons on hover and in the editor, the client column
// flags bank or card accounts with no recent transactions, and the status
// filter can pick either. Admins set the stale-bank threshold here too.
//
// Loaded before app.jsx and shares its global scope: top-level names carry a
// CT_ prefix; app.jsx globals (hooks, ModalShell, useToast, fmtDate) are only
// touched at render time.
// ----------------------------------------------------------------------------

const CT_STATUSES = [
  { key: "not_started", label: "Not started", short: "—" },
  { key: "in_progress", label: "In progress", short: "In progress" },
  // Tasks Phase 2 S2: only an admin sign-off makes a month Done
  // (tk_sign_off_period); everyone else marks it Ready for sign-off.
  { key: "review", label: "Ready for sign-off", short: "Ready" },
  { key: "done", label: "Done", short: "Done" },
  { key: "na", label: "N/A", short: "N/A" },
];
const CT_STATUS_LABEL = Object.fromEntries(CT_STATUSES.map((s) => [s.key, s.label]));
const CT_MONTHS_BACK = 6;

const CT_ymd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Oldest first, current month last.
function CT_periods(today) {
  const out = [];
  for (let i = CT_MONTHS_BACK; i >= 0; i--) {
    out.push(CT_ymd(new Date(today.getFullYear(), today.getMonth() - i, 1)));
  }
  return out;
}

function CT_monthLabel(period, withYear) {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString("en-US", withYear ? { month: "short", year: "numeric" } : { month: "short" });
}

// Deadline for a period: late_day of the following month.
function CT_deadline(period, lateDay) {
  const [y, m] = period.split("-").map(Number);
  return new Date(y, m, lateDay); // month index m = the following month
}

function CT_isLate(period, status, lateDay, today) {
  if (status === "done" || status === "na") return false;
  const dl = CT_deadline(period, lateDay);
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return t > dl;
}

const CT_name = (c) => String((c && (c.name || c.id)) || "");
const CT_who = (email) => String(email || "").split("@")[0];
const CT_bookkeeperOf = (c) => (c.assignedBookkeeper && c.assignedBookkeeper.name) || "";
// Filter key: the staff email when the client is linked to a real staff
// member (clients.assigned_bookkeeper_email), else the legacy display name.
const CT_bookkeeperKey = (c) => {
  const bk = c.assignedBookkeeper;
  if (!bk) return "";
  if (bk.email) return "email:" + String(bk.email).toLowerCase();
  return bk.name ? "name:" + bk.name : "";
};

// --- One shared month_close writer (tabs redesign 2026-10-10) ---------------
// Work › Close (this file) and the client's Close tab (ClientClosePage.jsx)
// both save through CT_saveMonthClose. An existing row is updated only while
// its updated_at still matches what this browser last saw, so a second save
// from another tab gets a "Someone else saved first" prompt instead of
// silently overwriting. A new row is an insert (23505 = it appeared
// meanwhile, also a conflict). No-op saves are skipped, because the trigger
// restamps updated_at and the performance score reads it.
//
// month_close.period is "YYYY-MM-01"; client_close_items.period is "YYYY-MM".
const CT_CHANGED_EVENT = "mgb:month-close-changed";
const CT_toYm = (p) => String(p || "").slice(0, 7); // "2026-09-01" -> "2026-09"
const CT_fromYm = (ym) => String(ym || "").slice(0, 7) + "-01"; // "2026-09" -> "2026-09-01"
// Every month_close read and write here is a month row (period_kind 'month');
// quarter and year rows (tasks-p2-2-periods.sql) share the table.
const CT_COLS =
  "client_id, period_kind, period, status, notes, updated_by, updated_at, signed_off_by, signed_off_at, ready_at, reopened_by, reopened_at, reopened_reason";
// "client|YYYY-MM-01" keys seen as done in this browser session (loads and
// saves). Moving one of them back to done asks first: the client "reports
// are ready" email goes out again unless it went to that person in the last
// 7 days (notify_enqueue_reports_ready).
const CT_doneSeen = new Set();
const CT_noteDone = (row) => {
  if (row && row.status === "done") CT_doneSeen.add(row.client_id + "|" + CT_fromYm(row.period));
};
const CT_monthName = (period) => {
  const [y, m] = String(period || "").split("-").map(Number);
  if (!y || !m) return "";
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long" });
};

async function CT_conflict(sb, clientId, period, cols) {
  let theirs = null;
  try {
    const r = await sb
      .from("month_close")
      .select(cols || CT_COLS)
      .eq("client_id", clientId)
      .eq("period_kind", "month")
      .eq("period", period)
      .maybeSingle();
    theirs = (r && r.data) || null;
  } catch (e) {}
  CT_noteDone(theirs);
  return { ok: false, conflict: true, theirs };
}

// GL Review gate (docs/gl-review-spec.md 6.4). Runs only when a month moves to
// Done and the Ledger reviewed step applies (closeStepsFor, app.jsx). With
// no 'approved' sign-off and no override:
//   warn (default): "Ledger review isn't approved. Sign off anyway?"; yes
//     records it through gl_review_override_done and the save goes ahead.
//   block: a reason is required; gl_review_override_done refuses non-admins,
//     and the month_close trigger refuses the write without it.
// confirmLedger({ gate, month }) is the caller's own dialog; it resolves to
// true / false or { ok, note }. Without one, window.confirm / window.prompt.
// Returns { ok:true } | { ok:false, cancelled:true } | { ok:false, error }.
const CT_LEDGER_WARN = "Ledger review isn't approved. Sign off anyway?";
async function CT_ledgerGate({ sb, clientId, period, confirmLedger }) {
  if (typeof closeLedgerApplies !== "function" || typeof closeLedgerApi !== "object") return { ok: true };
  try {
    await closeStepsLoad();
    const c = await sb.from("qbo_connections").select("status").eq("client_id", clientId).maybeSingle();
    const connStatus = c && !c.error ? (c.data ? c.data.status : null) : undefined;
    if (!closeLedgerApplies(clientId, period, connStatus)) return { ok: true };
    const so = await closeLedgerApi.signoff(sb, clientId, period);
    if (so.missing) return { ok: true }; // gl-review-1-core.sql not run yet
    const s = so.data;
    if (s && (s.status === "approved" || s.override_at)) return { ok: true };
  } catch (e) {
    return { ok: true }; // the check itself failing never blocks a warn-mode close
  }
  const gate = (typeof closeStepsCtx === "object" && closeStepsCtx.gate) || "warn";
  const month = CT_monthName(period);
  let answer;
  if (typeof confirmLedger === "function") answer = await confirmLedger({ gate, month });
  else if (gate === "block") {
    const r = window.prompt("Ledger review isn't approved. Only an admin can override. Reason:", "");
    answer = r && r.trim() ? { ok: true, note: r.trim() } : false;
  } else answer = window.confirm(CT_LEDGER_WARN);
  const ok = answer === true || !!(answer && answer.ok);
  if (!ok) return { ok: false, cancelled: true };
  const note = (answer && typeof answer === "object" && answer.note) || null;
  if (gate === "block" && !note) return { ok: false, error: { message: "A reason is needed to override the ledger review." } };
  const r = await closeLedgerApi.overrideDone(sb, clientId, period, note);
  if (r && r.error) {
    if (gate === "block") return { ok: false, error: r.error };
    // warn: the override log failing never stops the close (nothing in the
    // database blocks it); leave a trace for support.
    try {
      console.warn("gl_review_override_done failed", r.error);
    } catch (e) {}
  }
  return { ok: true };
}

// Sign-off and reopen (Tasks Phase 2 S2, tasks-p2-2-periods.sql). Moving a
// month into Done is an admin sign-off: CT_ledgerGate runs first (its
// override must exist before the RPC, or the GL gate trigger refuses), then
// tk_sign_off_period with the row's updated_at (40001 = someone else saved
// first, the same conflict prompt). Tasks linked to the month that are
// still open warn (needs_ack) and never block: confirmOpenTasks({ openTasks,
// sample, month }) answers, else window.confirm. Moving a month out of Done
// is tk_reopen_period with a reason (reopenReason, else window.prompt).
// The database refuses both for non-admins (month_close_signoff_guard).
const CT_openTasksText = (n, sample, month) =>
  `${n} open ${n === 1 ? "task is" : "tasks are"} still linked to ${month}` +
  ((sample || []).length ? ": " + sample.map((t) => t.title).join(", ") : "") +
  ". Sign off anyway?";
async function CT_monthRow(sb, clientId, period) {
  const r = await sb
    .from("month_close")
    .select(CT_COLS)
    .eq("client_id", clientId)
    .eq("period_kind", "month")
    .eq("period", period)
    .maybeSingle();
  if (r.error) throw r.error;
  return r.data || null;
}
async function CT_saveNotesOnly(sb, clientId, period, row, notes) {
  if (!row || (row.notes || null) === notes) return { ok: true, row };
  const res = await sb
    .from("month_close")
    .update({ notes })
    .eq("client_id", clientId)
    .eq("period_kind", "month")
    .eq("period", period)
    .eq("updated_at", row.updated_at)
    .select(CT_COLS);
  if (res.error) return { ok: false, error: res.error };
  if (!res.data || !res.data.length) return CT_conflict(sb, clientId, period, CT_COLS);
  return { ok: true, row: res.data[0] };
}
async function CT_signOff({ sb, clientId, period, notes, expectedUpdatedAt, confirmOpenTasks }) {
  let ack = false;
  for (let i = 0; i < 2; i++) {
    const r = await sb.rpc("tk_sign_off_period", {
      p_client_id: clientId,
      p_kind: "month",
      p_period: period,
      p_ack_open: ack,
      p_expected_updated_at: expectedUpdatedAt || null,
    });
    if (r.error) {
      if (r.error.code === "40001") return CT_conflict(sb, clientId, period, CT_COLS);
      return { ok: false, error: r.error };
    }
    const d = r.data || {};
    if (!d.needs_ack) break;
    const month = CT_monthName(period);
    const yes =
      typeof confirmOpenTasks === "function"
        ? await confirmOpenTasks({ openTasks: d.open_tasks, sample: d.sample || [], month })
        : window.confirm(CT_openTasksText(d.open_tasks, d.sample, month));
    if (!yes) return { ok: false, cancelled: true };
    ack = true;
  }
  return CT_saveNotesOnly(sb, clientId, period, await CT_monthRow(sb, clientId, period), notes);
}
async function CT_reopen({ sb, clientId, period, status, notes, reopenReason }) {
  let reason = String(reopenReason || "").trim();
  if (!reason) {
    const r = window.prompt(`Reopen ${CT_monthName(period)}? Say why (at least 3 characters):`, "");
    if (r === null) return { ok: false, cancelled: true };
    reason = r.trim();
  }
  if (reason.length < 3) return { ok: false, error: { message: "Say why it's being reopened (at least 3 characters)." } };
  const r = await sb.rpc("tk_reopen_period", { p_client_id: clientId, p_kind: "month", p_period: period, p_reason: reason.slice(0, 500) });
  if (r.error) return { ok: false, error: r.error };
  let row = await CT_monthRow(sb, clientId, period);
  if (row && row.status !== status) {
    const res = await sb
      .from("month_close")
      .update({ status, notes })
      .eq("client_id", clientId)
      .eq("period_kind", "month")
      .eq("period", period)
      .eq("updated_at", row.updated_at)
      .select(CT_COLS);
    if (res.error) return { ok: false, error: res.error };
    if (!res.data || !res.data.length) return CT_conflict(sb, clientId, period, CT_COLS);
    return { ok: true, row: res.data[0] };
  }
  return CT_saveNotesOnly(sb, clientId, period, row, notes);
}

// Returns { ok:true, row[, noop] } | { ok:false, conflict:true, theirs } |
// { ok:false, cancelled:true } (a warning or the reopen reason was declined) |
// { ok:false, error }. expectedUpdatedAt must be the server's updated_at
// string for the row this browser last loaded (null/undefined when there
// was no row).
async function CT_saveMonthClose({
  sb,
  clientId,
  period,
  status,
  notes,
  expectedUpdatedAt,
  prevRow,
  confirmLedger,
  confirmOpenTasks,
  reopenReason,
}) {
  sb = sb || window.mgbSupabase;
  period = CT_fromYm(period);
  notes = String(notes || "").trim() || null;
  // "Keep mine" after a conflict passes no prevRow, only theirs' updated_at.
  // Load that row so a signed-off month still routes through sign-off /
  // reopen (a plain update into or out of Done is refused by
  // month_close_signoff_guard). A changed row stays a conflict below.
  if (!prevRow && expectedUpdatedAt && sb) {
    try {
      const cur = await CT_monthRow(sb, clientId, period);
      if (cur && cur.updated_at === expectedUpdatedAt) prevRow = cur;
    } catch (e) {}
  }
  if (prevRow && prevRow.status === status && (prevRow.notes || null) === notes) {
    return { ok: true, row: prevRow, noop: true }; // never restamp updated_at
  }
  if (!sb) return { ok: false, error: { message: "Supabase isn't configured, so nothing is saved." } };
  const becomesDone = status === "done" && !(prevRow && prevRow.status === "done");
  const leavesDone = !!(prevRow && prevRow.status === "done") && status !== "done";
  if (becomesDone) {
    const g = await CT_ledgerGate({ sb, clientId, period, confirmLedger });
    if (!g.ok) return g;
  }
  let res;
  try {
    if (becomesDone || leavesDone) {
      const out = becomesDone
        ? await CT_signOff({ sb, clientId, period, notes, expectedUpdatedAt, confirmOpenTasks })
        : await CT_reopen({ sb, clientId, period, status, notes, reopenReason });
      if (!out.ok) return out;
      res = { data: out.row ? [out.row] : [] };
    } else if (expectedUpdatedAt) {
      res = await sb
        .from("month_close")
        .update({ status, notes })
        .eq("client_id", clientId)
        .eq("period_kind", "month")
        .eq("period", period)
        .eq("updated_at", expectedUpdatedAt)
        .select(CT_COLS); // array; length 0 = someone else saved first
      if (!res.error && (!res.data || res.data.length === 0)) return CT_conflict(sb, clientId, period, CT_COLS);
    } else {
      res = await sb.from("month_close").insert({ client_id: clientId, period, status, notes }).select(CT_COLS);
      if (res.error && res.error.code === "23505") return CT_conflict(sb, clientId, period, CT_COLS);
    }
  } catch (e) {
    return { ok: false, error: e };
  }
  if (res.error) return { ok: false, error: res.error };
  const row = (Array.isArray(res.data) ? res.data[0] : res.data) || {
    client_id: clientId,
    period,
    status,
    notes,
    updated_by: null,
    updated_at: new Date().toISOString(),
  };
  CT_noteDone(row);
  try {
    window.dispatchEvent(new CustomEvent(CT_CHANGED_EVENT, { detail: { clientId, period, row } }));
    window.dispatchEvent(
      new CustomEvent(OB_CHANGED_EVENT, {
        detail: { clientId, period },
      }),
    );
  } catch (e) {}
  try {
    notifyStaffTools();
  } catch (e) {}
  // Spec 4.5(b): snapshot the closed month's ledger, best effort (a miss is
  // filled from the last pull print by gl_review_baseline_from_last_print).
  if (becomesDone && typeof closeLedgerApplies === "function" && closeLedgerApplies(clientId, period)) {
    try {
      Promise.resolve(
        sb.functions.invoke("qbo-gl-review", { body: { action: "baseline", client_id: clientId, period } }),
      ).catch(() => {});
    } catch (e) {}
  }
  return { ok: true, row };
}

// First-tick rule (D10). Call after a close step was ticked. When no other
// step was done before this tick and the month_close row is missing or Not
// started, the month moves to In progress. Never touches review/done/na; a
// conflict stays silent (someone else already set a status).
// Returns { changed:true, row } | { changed:false[, conflict] }.
async function CT_applyFirstTick({ sb, clientId, period, hadOtherDone }) {
  if (hadOtherDone) return { changed: false };
  sb = sb || window.mgbSupabase;
  if (!sb || !clientId) return { changed: false };
  const p = CT_fromYm(period);
  let row = null;
  try {
    const r = await sb
      .from("month_close")
      .select(CT_COLS)
      .eq("client_id", clientId)
      .eq("period_kind", "month")
      .eq("period", p)
      .maybeSingle();
    if (r.error) return { changed: false };
    row = r.data || null;
  } catch (e) {
    return { changed: false };
  }
  if (row && row.status !== "not_started") return { changed: false };
  const res = await CT_saveMonthClose({
    sb,
    clientId,
    period: p,
    status: "in_progress",
    notes: row ? row.notes : null,
    expectedUpdatedAt: row ? row.updated_at : null,
    prevRow: row,
  });
  return res.ok && !res.noop ? { changed: true, row: res.row } : { changed: false, conflict: !!res.conflict };
}

// "3:42 PM" today, "Oct 9, 3:42 PM" on another day.
function CT_clock(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return "";
  const t = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return d.toDateString() === new Date().toDateString()
    ? t
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + ", " + t;
}

// The conflict prompt, shared by Work › Close and the Close tab. Closing it
// (Escape, backdrop) changes nothing.
function CT_ConflictModal({ theirs, onLoadTheirs, onKeepMine, onClose }) {
  const [busy, setBusy] = useState(false);
  const who = theirs && theirs.updated_by ? CT_who(theirs.updated_by) : "Someone";
  const time = theirs ? CT_clock(theirs.updated_at) : "";
  const st = theirs ? CT_STATUS_LABEL[theirs.status] || theirs.status : CT_STATUS_LABEL.not_started;
  const n = theirs && theirs.notes ? String(theirs.notes) : "";
  const notesBit = n ? ` · "${n.length > 120 ? n.slice(0, 120) + "…" : n}"` : "";
  return (
    <ModalShell onClose={onClose} labelledBy="ct-conflict-title" className="confirm-modal">
      <div className="modal-header">
        <h3 className="card-title" id="ct-conflict-title" style={{ margin: 0 }}>
          Someone else saved first
        </h3>
        <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <div className="modal-body">
        <p className="card-subtitle" style={{ margin: 0 }}>
          {who} changed this{time ? " at " + time : ""}. Their version: {st}
          {notesBit}.
        </p>
      </div>
      <div className="modal-footer">
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => onLoadTheirs && onLoadTheirs()}>
          Load theirs
        </button>
        <button
          type="button"
          className="btn-primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              if (onKeepMine) await onKeepMine();
            } finally {
              setBusy(false);
            }
          }}
        >
          Keep mine
        </button>
      </div>
    </ModalShell>
  );
}

// Close status for every client the viewer can see, this month and the
// CT_MONTHS_BACK before it. Shared by the Close tab below and the Clients
// list (ClientsPage.jsx).
//
//   rows          "client|period" -> month_close row (no row = not started)
//   setRows       for optimistic saves (the Close tab's editor)
//   lateDay       month_close_settings.late_day (default 15)
//   myClientIds   Set of client ids staff_client_access grants the viewer
//   periods/today oldest period first, current month last
//   focus         the month being closed right now: last month
//   statusOf(clientId, period), isLate(clientId, period)
//   byClient      {clientId: {period, status, late}} for the clients passed
//                 in — the oldest late month when one is late, else `focus`
//   loading/error, reload()
function CT_useCloseStatus(clients, staffUser) {
  const today = useMemo(() => new Date(), []);
  const periods = useMemo(() => CT_periods(today), [today]);
  const focus = periods[periods.length - 2];
  const [rows, setRows] = useState({}); // "client|period" -> row
  const [lateDay, setLateDay] = useState(15);
  const [state, setState] = useState({ loading: true, error: null });
  const [myClientIds, setMyClientIds] = useState(null);

  const load = useCallback(async () => {
    const sb = window.mgbSupabase;
    if (!sb) {
      setState({ loading: false, error: "Supabase isn't configured, so nothing is saved." });
      return;
    }
    const safe = (p) => Promise.resolve(p).then((r) => r, (e) => ({ data: null, error: e }));
    const [mc, st, mine] = await Promise.all([
      safe(
        sb
          .from("month_close")
          .select(CT_COLS)
          .eq("period_kind", "month")
          .gte("period", periods[0])
          .lte("period", periods[periods.length - 1]),
      ),
      safe(sb.from("month_close_settings").select("late_day").maybeSingle()),
      safe(sb.from("staff_client_access").select("client_id").eq("staff_email", staffUser && staffUser.email)),
    ]);
    const map = {};
    (mc.data || []).forEach((r) => {
      map[r.client_id + "|" + r.period] = r;
      CT_noteDone(r);
    });
    setRows(map);
    if (st.data && st.data.late_day) setLateDay(st.data.late_day);
    setMyClientIds(new Set((mine.data || []).map((r) => r.client_id)));
    setState({
      loading: false,
      error: mc.error ? "Couldn't load close status (" + (mc.error.message || "not signed in") + "). Showing empty months." : null,
    });
  }, [periods, staffUser && staffUser.email]);

  useEffect(() => {
    load();
  }, [load]);

  // A save anywhere (the Close tab, another editor) patches the row here, so
  // Work › Close and the Clients list update without a refresh.
  useEffect(() => {
    const on = (e) => {
      const d = (e && e.detail) || {};
      if (d.row && d.row.client_id && d.row.period) {
        const r = d.row;
        setRows((prev) => ({ ...prev, [r.client_id + "|" + CT_fromYm(r.period)]: r }));
      } else load();
    };
    window.addEventListener(CT_CHANGED_EVENT, on);
    return () => window.removeEventListener(CT_CHANGED_EVENT, on);
  }, [load]);

  const statusOf = (clientId, period) => {
    const r = rows[clientId + "|" + period];
    return r ? r.status : "not_started";
  };
  const isLate = (clientId, period) => CT_isLate(period, statusOf(clientId, period), lateDay, today);

  const byClient = useMemo(() => {
    const out = {};
    (clients || []).forEach((c) => {
      // Oldest late month first: "August is still open" matters more than
      // "September is in progress". A month older than the one being closed
      // with no row at all isn't late, just untracked — otherwise a client
      // added in September reads as late for April.
      const late = periods.find((p) => (p === focus || rows[c.id + "|" + p]) && isLate(c.id, p));
      const period = late || focus;
      out[c.id] = { period, status: statusOf(c.id, period), late: !!late };
    });
    return out;
    // eslint-disable-next-line
  }, [(clients || []).map((c) => c.id).join(","), rows, lateDay, periods]);

  return {
    rows,
    setRows,
    lateDay,
    setLateDay,
    myClientIds,
    periods,
    today,
    focus,
    statusOf,
    isLate,
    byClient,
    loading: state.loading,
    error: state.error,
    reload: load,
  };
}

function CT_CloseTrackerPage({ clients, staffUser }) {
  const showToast = typeof useToast === "function" ? useToast() : null;
  const toast = (m) => showToast && showToast(m);
  const isAdmin = !!(staffUser && staffUser.role === "admin");
  const close = CT_useCloseStatus(clients, staffUser);
  const { rows, setRows, lateDay, setLateDay, myClientIds, periods, today, statusOf } = close;
  const state = { loading: close.loading, error: close.error };
  const [focus, setFocus] = useState(close.focus);
  const [bkFilter, setBkFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("any");
  const [editing, setEditing] = useState(null); // { client, period }
  const [lateDraft, setLateDraft] = useState("");
  const cc = typeof CC_useCloseChecks === "function" ? CC_useCloseChecks(periods) : null;
  const checkOf = (clientId, period) => (cc ? cc.checks[clientId + "|" + period] : null);
  const staleOf = (clientId) =>
    cc && typeof CC_staleBanks === "function" ? CC_staleBanks(cc.accounts[clientId], cc.staleDays, today) : [];

  const bookkeepers = useMemo(() => {
    const byKey = new Map();
    (clients || []).forEach((c) => {
      const k = CT_bookkeeperKey(c);
      if (k && !byKey.has(k)) byKey.set(k, CT_bookkeeperOf(c) || k.replace(/^email:/, ""));
    });
    return [...byKey.entries()]
      .map(([key, label]) => ({ key, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [clients]);

  // By id/email only: staff can rename themselves, so no name matching.
  const isMine = (c) =>
    (myClientIds && myClientIds.has(c.id)) ||
    (staffUser &&
      staffUser.email &&
      CT_bookkeeperKey(c) === "email:" + String(staffUser.email).toLowerCase());

  const sorted = useMemo(
    () => (clients || []).slice().sort((a, b) => CT_name(a).localeCompare(CT_name(b))),
    [clients],
  );

  const byBookkeeper = sorted.filter((c) =>
    bkFilter === "all"
      ? true
      : bkFilter === "mine"
        ? isMine(c)
        : bkFilter === "unassigned"
          ? !CT_bookkeeperKey(c)
          : CT_bookkeeperKey(c) === bkFilter,
  );

  const focusIsLate = (c) => CT_isLate(focus, statusOf(c.id, focus), lateDay, today);
  const visible = byBookkeeper.filter((c) => {
    if (statusFilter === "any") return true;
    if (statusFilter === "late") return focusIsLate(c);
    if (statusFilter === "stale") return staleOf(c.id).length > 0;
    if (statusFilter.startsWith("qb_")) {
      const k = checkOf(c.id, focus);
      return !!k && k.status === statusFilter.slice(3);
    }
    return statusOf(c.id, focus) === statusFilter;
  });

  const qbCounts = useMemo(() => {
    const out = { ready: 0, blocked: 0, behind: 0, stale: 0, any: 0 };
    if (!cc) return out;
    byBookkeeper.forEach((c) => {
      const k = checkOf(c.id, focus);
      if (k && out[k.status] !== undefined) {
        out[k.status]++;
        out.any++;
      }
      if (staleOf(c.id).length) out.stale++;
    });
    return out;
    // eslint-disable-next-line
  }, [byBookkeeper.map((c) => c.id).join(","), cc && cc.checks, cc && cc.accounts, cc && cc.staleDays, focus]);

  const counts = useMemo(() => {
    const out = { late: 0 };
    CT_STATUSES.forEach((s) => (out[s.key] = 0));
    byBookkeeper.forEach((c) => {
      const s = statusOf(c.id, focus);
      out[s] = (out[s] || 0) + 1;
      if (CT_isLate(focus, s, lateDay, today)) out.late++;
    });
    return out;
    // eslint-disable-next-line
  }, [byBookkeeper.map((c) => c.id).join(","), rows, focus, lateDay]);

  const lateAll = useMemo(() => {
    let n = 0;
    byBookkeeper.forEach((c) =>
      periods.forEach((p) => {
        if (CT_isLate(p, statusOf(c.id, p), lateDay, today)) n++;
      }),
    );
    return n;
    // eslint-disable-next-line
  }, [byBookkeeper.map((c) => c.id).join(","), rows, lateDay]);

  // Thin wrapper over the shared CT_saveMonthClose: optimistic set, then the
  // guarded save. A conflict restores the old row and opens the prompt; an
  // error restores and toasts. The optimistic row is marked _opt and never
  // used as expectedUpdatedAt (only the server's own updated_at is).
  const [conflict, setConflict] = useState(null); // { client, period, status, notes, theirs }
  const save = async (clientId, period, status, notes, expectedOverride, opts) => {
    const sb = window.mgbSupabase;
    const key = clientId + "|" + period;
    const prev = rows[key];
    const expected = expectedOverride !== undefined ? expectedOverride : prev && !prev._opt ? prev.updated_at : null;
    const optimistic = {
      client_id: clientId,
      period,
      status,
      notes: notes || null,
      updated_by: staffUser && staffUser.email,
      updated_at: new Date().toISOString(),
      _opt: true,
    };
    const restore = () =>
      setRows((r) => {
        const n = { ...r };
        if (prev) n[key] = prev;
        else delete n[key];
        return n;
      });
    setRows((r) => ({ ...r, [key]: optimistic }));
    if (!sb) return true;
    const res = await CT_saveMonthClose({
      sb,
      clientId,
      period,
      status,
      notes,
      expectedUpdatedAt: expected,
      prevRow: expectedOverride !== undefined ? null : prev,
      reopenReason: opts && opts.reopenReason,
    });
    if (res.conflict) {
      restore();
      return { conflict: true, theirs: res.theirs };
    }
    if (!res.ok) {
      restore();
      // Declining the ledger-review warning is not an error.
      if (!res.cancelled) toast("Couldn't save. " + ((res.error && res.error.message) || ""));
      return false;
    }
    setRows((r) => ({ ...r, [key]: res.row }));
    return true;
  };

  const saveLateDay = async () => {
    const n = parseInt(lateDraft, 10);
    if (!(n >= 1 && n <= 28)) {
      toast("Pick a day between 1 and 28.");
      return;
    }
    const sb = window.mgbSupabase;
    const old = lateDay;
    setLateDay(n);
    setLateDraft("");
    if (!sb) return;
    const { error } = await sb.from("month_close_settings").update({ late_day: n }).eq("id", true);
    if (error) {
      setLateDay(old);
      toast("Couldn't save the late day. " + (error.message || ""));
    } else toast(`Months now count as late after the ${n}${CT_ordinal(n)} of the next month.`);
  };

  return (
    <div className="ct-page">
      <div className="card ct-toolbar-card">
        <div className="ct-toolbar">
          <label className="ct-field">
            <span>Month</span>
            <select value={focus} onChange={(e) => setFocus(e.target.value)}>
              {periods
                .slice()
                .reverse()
                .map((p) => (
                  <option key={p} value={p}>
                    {CT_monthLabel(p, true)}
                  </option>
                ))}
            </select>
          </label>
          <label className="ct-field">
            <span>Bookkeeper</span>
            <select value={bkFilter} onChange={(e) => setBkFilter(e.target.value)}>
              <option value="all">Everyone</option>
              <option value="mine">My clients</option>
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
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="any">Any</option>
              {CT_STATUSES.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
              <option value="late">Late</option>
              {cc && (
                <>
                  <option value="qb_ready">QuickBooks: ready</option>
                  <option value="qb_blocked">QuickBooks: blocked</option>
                  <option value="qb_behind">QuickBooks: behind</option>
                  <option value="stale">Stale bank feed</option>
                </>
              )}
            </select>
          </label>
          {isAdmin && (
            <form
              className="ct-field ct-late-setting"
              onSubmit={(e) => {
                e.preventDefault();
                saveLateDay();
              }}
            >
              <span>Late after day</span>
              <span className="ct-late-input">
                <input
                  type="number"
                  min={1}
                  max={28}
                  inputMode="numeric"
                  value={lateDraft === "" ? lateDay : lateDraft}
                  onChange={(e) => setLateDraft(e.target.value)}
                  aria-label="Day of the following month after which an open month is late"
                />
                {lateDraft !== "" && Number(lateDraft) !== lateDay && (
                  <button type="submit" className="btn-secondary">
                    Save
                  </button>
                )}
              </span>
            </form>
          )}
          {isAdmin && cc && typeof CC_StaleDaysSetting === "function" && (
            <CC_StaleDaysSetting value={cc.staleDays} toast={toast} />
          )}
        </div>
        <div className="ct-summary" aria-label={`Summary for ${CT_monthLabel(focus, true)}`}>
          {CT_STATUSES.map((s) => (
            <button
              key={s.key}
              type="button"
              className={"ct-sum ct-s-" + s.key + (statusFilter === s.key ? " active" : "")}
              onClick={() => setStatusFilter(statusFilter === s.key ? "any" : s.key)}
            >
              <span className="ct-sum-n">{counts[s.key] || 0}</span>
              <span className="ct-sum-l">{s.label}</span>
            </button>
          ))}
          <button
            type="button"
            className={"ct-sum ct-s-late" + (statusFilter === "late" ? " active" : "")}
            onClick={() => setStatusFilter(statusFilter === "late" ? "any" : "late")}
          >
            <span className="ct-sum-n">{counts.late}</span>
            <span className="ct-sum-l">Late</span>
          </button>
        </div>
        <p className="card-subtitle ct-note">
          Counts are for {CT_monthLabel(focus, true)}. A month is late after the {lateDay}
          {CT_ordinal(lateDay)} of the next month if it isn't done or N/A
          {lateAll ? ` · ${lateAll} late cell${lateAll === 1 ? "" : "s"} in the grid` : ""}.
        </p>
        {cc && (qbCounts.any > 0 || qbCounts.stale > 0) && (
          <div className="cc-summary" aria-label={`QuickBooks checks for ${CT_monthLabel(focus, true)}`}>
            <span className="cc-summary-l">QuickBooks checks</span>
            {["ready", "blocked", "behind"].map((k) => (
              <button
                key={k}
                type="button"
                className={"cc-badge " + CC_STATUS[k].cls + (statusFilter === "qb_" + k ? " active" : "")}
                onClick={() => setStatusFilter(statusFilter === "qb_" + k ? "any" : "qb_" + k)}
              >
                {qbCounts[k]} {CC_STATUS[k].label.toLowerCase()}
              </button>
            ))}
            <button
              type="button"
              className={"cc-badge cc-stale-badge" + (statusFilter === "stale" ? " active" : "")}
              onClick={() => setStatusFilter(statusFilter === "stale" ? "any" : "stale")}
              title={`Bank or card accounts with no transactions in over ${cc.staleDays} days`}
            >
              {qbCounts.stale} stale bank
            </button>
          </div>
        )}
        {state.error && <div className="mock-banner ct-banner">{state.error}</div>}
      </div>

      <div className="card ct-grid-card">
        {state.loading ? (
          <p className="card-subtitle">Loading…</p>
        ) : visible.length === 0 ? (
          <p className="card-subtitle">
            {sorted.length === 0 ? "No clients to show." : "No clients match these filters."}
          </p>
        ) : (
          <div className="ct-scroll" tabIndex={0} aria-label="Close status grid, scrolls sideways" data-tour="close-grid">
            <table className="ct-grid">
              <thead>
                <tr>
                  <th scope="col" className="ct-client-col">
                    Client
                  </th>
                  {periods.map((p) => (
                    <th key={p} scope="col" className={"ct-month" + (p === focus ? " focus" : "")}>
                      <button type="button" className="ct-month-btn" onClick={() => setFocus(p)}>
                        {CT_monthLabel(p, p.slice(5, 7) === "01" || p === periods[0])}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((c) => (
                  <tr key={c.id}>
                    <th scope="row" className="ct-client-col">
                      <a
                        className="ct-client-name"
                        href={TB_clientHash(c.id, "close")}
                        title={"Open " + CT_name(c) + "'s close"}
                      >
                        {CT_name(c)}
                      </a>
                      <span className="ct-client-bk">{CT_bookkeeperOf(c) || "Unassigned"}</span>
                      {(() => {
                        const st = staleOf(c.id);
                        return st.length ? (
                          <span
                            className="cc-badge cc-stale-badge compact"
                            title={st.map((a) => `${a.name || a.qbo_id}: last transaction ${a.idle} days ago`).join("\n")}
                          >
                            Stale bank
                          </span>
                        ) : null;
                      })()}
                    </th>
                    {periods.map((p) => {
                      const r = rows[c.id + "|" + p];
                      const s = r ? r.status : "not_started";
                      const late = CT_isLate(p, s, lateDay, today);
                      const title =
                        `${CT_name(c)} · ${CT_monthLabel(p, true)}: ${CT_STATUS_LABEL[s]}` +
                        (late ? " (late)" : "") +
                        (r && r.updated_by ? ` · ${CT_who(r.updated_by)}, ${new Date(r.updated_at).toLocaleDateString()}` : "") +
                        (r && s === "done" && r.signed_off_by ? ` · signed off by ${CT_who(r.signed_off_by)}` : "") +
                        (r && r.notes ? ` · ${r.notes}` : "");
                      return (
                        <td key={p} className={"ct-cell" + (p === focus ? " focus" : "")}>
                          <button
                            type="button"
                            className={"ct-pill ct-s-" + s + (late ? " late" : "")}
                            title={title}
                            aria-label={title}
                            onClick={() => setEditing({ client: c, period: p })}
                          >
                            <span className="ct-pill-status">{late && s === "not_started" ? "Late" : CT_STATUSES.find((x) => x.key === s).short}</span>
                            {r && r.updated_by && s !== "not_started" && (
                              <span className="ct-pill-who">
                                {CT_who(r.updated_by)} · {new Date(r.updated_at).toLocaleDateString("en-US", { month: "numeric", day: "numeric" })}
                              </span>
                            )}
                            {r && r.notes && <span className="ct-pill-note" aria-hidden="true">•</span>}
                          </button>
                          {typeof CC_Badge === "function" && <CC_Badge row={checkOf(c.id, p)} compact />}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && (
        <CT_CellEditor
          isAdmin={isAdmin}
          client={editing.client}
          period={editing.period}
          row={rows[editing.client.id + "|" + editing.period]}
          late={CT_isLate(editing.period, statusOf(editing.client.id, editing.period), lateDay, today)}
          deadline={CT_deadline(editing.period, lateDay)}
          check={checkOf(editing.client.id, editing.period)}
          onClose={() => setEditing(null)}
          onSave={async (status, notes, opts) => {
            const ed = editing;
            const ok = await save(ed.client.id, ed.period, status, notes, undefined, opts);
            if (ok && ok.conflict) {
              setEditing(null);
              setConflict({ client: ed.client, period: ed.period, status, notes, theirs: ok.theirs });
            } else if (ok) setEditing(null);
          }}
        />
      )}
      {conflict && (
        <CT_ConflictModal
          theirs={conflict.theirs}
          onClose={() => setConflict(null)}
          onLoadTheirs={() => {
            const k = conflict.client.id + "|" + conflict.period;
            const t = conflict.theirs;
            setRows((r) => {
              const n = { ...r };
              if (t) n[k] = t;
              else delete n[k];
              return n;
            });
            setConflict(null);
          }}
          onKeepMine={async () => {
            const cf = conflict;
            const ok = await save(cf.client.id, cf.period, cf.status, cf.notes, cf.theirs ? cf.theirs.updated_at : null);
            if (ok && ok.conflict) setConflict({ ...cf, theirs: ok.theirs });
            else setConflict(null);
          }}
        />
      )}
    </div>
  );
}

function CT_ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

function CT_CellEditor({ isAdmin, client, period, row, late, deadline, check, onClose, onSave }) {
  const [status, setStatus] = useState(row ? row.status : "not_started");
  const [notes, setNotes] = useState((row && row.notes) || "");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  // Confirms render inside this same ModalShell (a nested ModalShell would
  // take Escape for the outer one first). ask = "redone" | "latenote" | null.
  const [ask, setAsk] = useState(null);
  const month = CT_monthName(period);
  const prevStatus = row ? row.status : "not_started";
  // Only an admin signs off (Done) or reopens a signed-off month.
  const locked = !isAdmin && prevStatus === "done";
  const reopening = prevStatus === "done" && status !== "done";
  const choices = CT_STATUSES.filter((s) => isAdmin || s.key !== "done" || prevStatus === "done");
  const doSave = async () => {
    setSaving(true);
    await onSave(status, notes.trim(), reopening ? { reopenReason: reason.trim() } : undefined);
    setSaving(false);
  };
  const askFor = () => {
    const key = client.id + "|" + CT_fromYm(period);
    if (status === "done" && prevStatus !== "done" && CT_doneSeen.has(key)) return "redone";
    const notesChanged = (notes.trim() || null) !== ((row && row.notes) || null);
    // A signed-off month's KPI time is its ready / sign-off time, so only an
    // N/A month's note can move it (staff_performance, tasks-p2-2-periods.sql).
    if (
      row &&
      status === "na" &&
      status === prevStatus &&
      notesChanged &&
      row.updated_at &&
      CT_ymd(new Date()) > CT_ymd(deadline) &&
      CT_ymd(new Date(row.updated_at)) <= CT_ymd(deadline)
    )
      return "latenote";
    return null;
  };
  if (ask) {
    const redone = ask === "redone";
    return (
      <ModalShell key="ask" onClose={() => setAsk(null)} labelledBy="ct-ask-title" className="ct-modal">
        <div className="ct-modal-body">
          <h3 id="ct-ask-title" className="card-title">
            {CT_name(client)} · {CT_monthLabel(period, true)}
          </h3>
          <p className="ct-ask-text">
            {redone
              ? 'This month was signed off before. Signing it off again sends the "reports are ready" email again, unless it went out in the last 7 days.'
              : "This close was on time. Saving a note now records it as finished today, which can count as late. Save anyway?"}
          </p>
          <div className="ct-modal-foot">
            <button type="button" className="btn-secondary" onClick={() => setAsk(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={saving}
              onClick={async () => {
                await doSave();
              }}
            >
              {saving ? "Saving…" : redone ? "Sign off again" : "Save note"}
            </button>
          </div>
        </div>
      </ModalShell>
    );
  }
  return (
    <ModalShell key="edit" onClose={onClose} labelledBy="ct-edit-title" className="ct-modal">
      <form
        className="ct-modal-body"
        onSubmit={async (e) => {
          e.preventDefault();
          const a = askFor();
          if (a) {
            setAsk(a);
            return;
          }
          await doSave();
        }}
      >
        <h3 id="ct-edit-title" className="card-title">
          {CT_name(client)} · {CT_monthLabel(period, true)}
        </h3>
        <p className="card-subtitle">
          Due by {deadline.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
          {late ? " · late" : ""}
        </p>
        {check && typeof CC_Badge === "function" && (
          <div className="cc-editor">
            <div className="cc-head">
              <span className="ct-legend">QuickBooks checks</span>
              <CC_Badge row={check} />
            </div>
            {(check.reasons || []).length > 0 && (
              <ul className="cc-reasons">
                {check.reasons.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            )}
            {check.status !== "no_data" && <CC_CheckList row={check} />}
          </div>
        )}
        <fieldset className="ct-status-group">
          <legend className="ct-legend">Status</legend>
          {choices.map((s) => (
            <label key={s.key} className={"ct-status-opt ct-s-" + s.key + (status === s.key ? " selected" : "")}>
              <input
                type="radio"
                name="ct-status"
                value={s.key}
                checked={status === s.key}
                disabled={locked}
                onChange={() => setStatus(s.key)}
              />
              {s.key === "done" ? "Done (sign off)" : s.label}
            </label>
          ))}
        </fieldset>
        {locked ? (
          <p className="card-subtitle" role="note">
            Signed off{row && row.signed_off_by ? " by " + CT_who(row.signed_off_by) : ""}. Only an admin can reopen it.
          </p>
        ) : !isAdmin ? (
          <p className="card-subtitle" role="note">
            When your part is finished, pick Ready for sign-off. An admin signs {month} off.
          </p>
        ) : null}
        {status === "done" && prevStatus !== "done" && (
          <p className="ct-email-warn" role="note">
            Signing off emails {CT_name(client)}'s people that {month} reports are ready.
          </p>
        )}
        {reopening && (
          <>
            <label className="ct-legend" htmlFor="ct-reopen-reason">
              Why reopen it?
            </label>
            <input
              id="ct-reopen-reason"
              className="ct-notes"
              maxLength={500}
              value={reason}
              placeholder="Found a missing bill, client asked for a change…"
              onChange={(e) => setReason(e.target.value)}
            />
          </>
        )}
        <label className="ct-legend" htmlFor="ct-notes">
          Notes
        </label>
        <textarea
          id="ct-notes"
          className="ct-notes"
          rows={3}
          maxLength={2000}
          value={notes}
          placeholder="Waiting on bank statement, reviewer, anything useful"
          onChange={(e) => setNotes(e.target.value)}
        />
        {row && row.updated_by && (
          <p className="card-subtitle">
            Last updated by {CT_who(row.updated_by)} on {new Date(row.updated_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
          </p>
        )}
        <div className="ct-modal-foot">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={saving || (reopening && reason.trim().length < 3)}>
            {saving ? "Saving…" : status === "done" && prevStatus !== "done" ? "Sign off" : reopening ? "Reopen" : "Save"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
