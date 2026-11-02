// ----------------------------------------------------------------------------
// MH_books: the pure logic behind the MGB Home slice S4 "Firm books polish"
// (docs/mgb-home-spec.md): the Home Firm books card (close status + last
// QuickBooks sync) and the firm Profit & Loss on Firm books › Reports. The
// pieces themselves are MH_HomePage / MH_FirmPnlCard in MgbHome.jsx; they read
// month_close, close_checks, qbo_connections and qbo_sync_runs for the
// internal client, all behind the internal company lock (no rows without the
// MGB grant).
//
//   MH_BK_STALE_HOURS                 a firm sync older than this is "behind"
//   MH_bkSyncState(conn, run, nowMs)  -> { kind, warn, at, failedAt }
//   MH_bkCloseNote(status, deadline, late, today)
//                                     -> { kind, warn, due } or null
//   MH_bkReasons(row, max)            close-check reasons -> { shown, more }
//   MH_bkPnl(months)                  closed P&L months -> totals + rows
//
// Browser file (plain JS, no JSX); loads after MH_gate.js. Node tests:
// MH_books.test.js.
// ----------------------------------------------------------------------------

// The firm syncs every few minutes; a day and a bit without one means the
// schedule or the connection is stuck.
var MH_BK_STALE_HOURS = 26;

function MH__bkMs(iso) {
  if (!iso) return null;
  var t = new Date(iso).getTime();
  return isFinite(t) ? t : null;
}

// conn: qbo_connections row ({ status, last_synced_at }) or null.
// run:  the newest qbo_sync_runs row ({ status, started_at }) or null.
// kind: "none"      QuickBooks isn't connected for the firm (no row, or
//                   status "disconnected": a disconnect keeps the row)
//       "reconnect" QuickBooks rejected the connection (status "error")
//       "never"     connected, never synced
//       "failed"    the newest run failed after the last good sync
//       "stale"     no sync for MH_BK_STALE_HOURS
//       "ok"
// at = last_synced_at; failedAt = the failed run's started_at.
function MH_bkSyncState(conn, run, nowMs) {
  var now = typeof nowMs === "number" ? nowMs : Date.now();
  if (!conn || conn.status === "disconnected") return { kind: "none", warn: false, at: null, failedAt: null };
  var at = conn.last_synced_at || null;
  if (conn.status === "error") return { kind: "reconnect", warn: true, at: at, failedAt: null };
  var atMs = MH__bkMs(at);
  var runMs = run && run.status === "error" ? MH__bkMs(run.started_at) : null;
  if (runMs != null && (atMs == null || runMs > atMs)) return { kind: "failed", warn: true, at: at, failedAt: run.started_at };
  if (atMs == null) return { kind: "never", warn: false, at: null, failedAt: null };
  if (now - atMs > MH_BK_STALE_HOURS * 3600 * 1000) return { kind: "stale", warn: true, at: at, failedAt: null };
  return { kind: "ok", warn: false, at: at, failedAt: null };
}

// The due line under the close status. deadline: the period's due date
// (CT_deadline); late: CT_isLate's answer (it knows the "late from" month).
// kind: "late"    past due and not in (warn)
//       "signoff" Ready for sign-off: waiting on an admin, not late
//       "due"     open and due on or after today
// null when the month is done / N/A, or when it is past due but not counted
// late (months before the Close tracker's "late from" month).
function MH_bkCloseNote(status, deadline, late, today) {
  var s = status || "not_started";
  if (s === "done" || s === "na") return null;
  var due = deadline instanceof Date ? deadline : null;
  if (late) return { kind: "late", warn: true, due: due };
  if (s === "review") return { kind: "signoff", warn: false, due: due };
  if (!due) return null;
  var t = today instanceof Date ? today : new Date();
  var day = new Date(t.getFullYear(), t.getMonth(), t.getDate());
  if (day > due) return null;
  return { kind: "due", warn: false, due: due };
}

// The first `max` close-check reasons, and how many more there are.
function MH_bkReasons(row, max) {
  var list = row && Array.isArray(row.reasons) ? row.reasons.filter(function (r) { return r != null && String(r).trim() !== ""; }) : [];
  var n = typeof max === "number" && max >= 0 ? max : 2;
  return { shown: list.slice(0, n).map(String), more: Math.max(0, list.length - n) };
}

function MH__bkNum(v) {
  var n = Number(v);
  return isFinite(n) ? n : 0;
}

// months: the P&L months for the picked period (periodMonths), oldest first,
// each { month, year?, income, expenses }. -> { income, expenses, net,
// margin (net / income in %, one decimal, null without income), rows }.
// rows keep the month order and add net. Cents are rounded per sum, so a
// month's net can differ from the total by a cent; that is expected.
function MH_bkPnl(months) {
  var list = Array.isArray(months) ? months : [];
  var income = 0;
  var expenses = 0;
  var rows = list.map(function (m) {
    var inc = MH__bkNum(m && m.income);
    var exp = MH__bkNum(m && m.expenses);
    income += inc;
    expenses += exp;
    return { month: m && m.month, year: m && m.year, income: inc, expenses: exp, net: Math.round((inc - exp) * 100) / 100 };
  });
  income = Math.round(income * 100) / 100;
  expenses = Math.round(expenses * 100) / 100;
  var net = Math.round((income - expenses) * 100) / 100;
  var margin = income > 0 ? Math.round((net / income) * 1000) / 10 : null;
  return { income: income, expenses: expenses, net: net, margin: margin, rows: rows };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    MH_BK_STALE_HOURS: MH_BK_STALE_HOURS,
    MH_bkSyncState: MH_bkSyncState,
    MH_bkCloseNote: MH_bkCloseNote,
    MH_bkReasons: MH_bkReasons,
    MH_bkPnl: MH_bkPnl,
  };
}
