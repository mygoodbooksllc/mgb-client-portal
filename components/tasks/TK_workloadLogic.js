// ----------------------------------------------------------------------------
// Slate plus workload strip: pure logic (docs/slateplus-workload-spec.md).
// Rows come from the RPC tk_slateplus_workload() (counts only). Browser file,
// shared global scope: every name carries a TKW_ prefix. Node tests:
// components/tasks/TK_workloadLogic.test.js.
// ----------------------------------------------------------------------------

var TKW_COLLAPSE_KEY = "mgb_slateplus_workload_v1";
var TKW_TTL = 60000;

function TKW__int(v) {
  var n = Number(v);
  return isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

// RPC rows -> clean rows, busiest first (due this week, then late, then open,
// then name). late is null while late tasks don't count (grace period).
function TKW_rows(raw) {
  var out = (Array.isArray(raw) ? raw : [])
    .filter(function (r) {
      return r && r.email;
    })
    .map(function (r) {
      var email = String(r.email).trim().toLowerCase();
      return {
        id: r.staff_id ? String(r.staff_id) : null,
        email: email,
        name: String(r.name || email.split("@")[0]),
        role: String(r.role || ""),
        me: r.is_me === true,
        open: TKW__int(r.open_count),
        week: TKW__int(r.due_week),
        late: r.late_count == null ? null : TKW__int(r.late_count),
      };
    });
  out.sort(function (a, b) {
    return b.week - a.week || (b.late || 0) - (a.late || 0) || b.open - a.open || a.name.localeCompare(b.name);
  });
  return out;
}

// True when any row carries a late count (late tasks count against staff).
function TKW_lateOn(rows) {
  return (rows || []).some(function (r) {
    return r.late != null;
  });
}

// Bar width (0..100) of this week's load against the busiest person.
function TKW_barPct(row, rows) {
  var max = 0;
  (rows || []).forEach(function (r) {
    if (r.week > max) max = r.week;
  });
  if (!max || !row) return 0;
  return Math.round((row.week / max) * 100);
}

// Where a click goes: your own row -> your Slate; another person -> their
// list, admins only (the person list is admin-only). null = not clickable.
var TKW_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function TKW_href(row, isAdmin) {
  if (!row) return null;
  if (row.me) return "#/tasks/my";
  if (isAdmin === true && row.id && TKW_UUID_RE.test(row.id)) return "#/tasks/u/" + row.id;
  return null;
}

// First name for the compact line ("Ana Ruiz" -> "Ana").
function TKW_short(row) {
  if (!row) return "";
  if (row.me) return "You";
  var n = String(row.name || "").trim();
  return n.split(/\s+/)[0] || n;
}

// One line for the Unassigned group, e.g. "Ana 7 · Ben 3 · You 2" (due this
// week). Only when more than one person is visible.
function TKW_compactLine(rows, max) {
  var list = rows || [];
  if (list.length < 2) return "";
  var lim = max || 6;
  var parts = list.slice(0, lim).map(function (r) {
    return TKW_short(r) + " " + r.week;
  });
  if (list.length > lim) parts.push("+" + (list.length - lim) + " more");
  return parts.join(" · ");
}

// Plain-language title for a chip (screen readers and hover).
function TKW_title(row) {
  if (!row) return "";
  var s = row.name + ": " + row.open + " open, " + row.week + " due this week";
  if (row.late != null) s += ", " + row.late + " late";
  return s;
}

// Collapsed state, remembered per browser.
function TKW_readCollapsed(lsGet) {
  try {
    return lsGet(TKW_COLLAPSE_KEY) === "collapsed";
  } catch (e) {
    return false;
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    TKW_rows: TKW_rows,
    TKW_lateOn: TKW_lateOn,
    TKW_barPct: TKW_barPct,
    TKW_href: TKW_href,
    TKW_short: TKW_short,
    TKW_compactLine: TKW_compactLine,
    TKW_title: TKW_title,
    TKW_readCollapsed: TKW_readCollapsed,
    TKW_COLLAPSE_KEY: TKW_COLLAPSE_KEY,
  };
}
