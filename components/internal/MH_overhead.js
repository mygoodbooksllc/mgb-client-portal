// ----------------------------------------------------------------------------
// MH_overhead: the pure logic behind MGB Home › Overhead (docs/mgb-home-spec.md,
// slice S2). The page itself is MH_OverheadPage in MgbHome.jsx; its one read
// is the internal_hours(p_from, p_to) RPC (supabase/mgb-home-s2.sql), which
// refuses anyone without the MGB (internal) grant.
//
//   MH_OH_PERIODS / MH_ohRange(key, today)   period picker -> { from, to }
//   MH_ohCategory(item, description)         one line -> a category label
//   MH_ohCategories(lines)                   lines -> per-category totals
//   MH_ohMonths(months, from, to)            fill months with no time as 0
//   MH_ohPct(part, whole)                    a share in %, or null
//
// Categories are a reading aid, not data: QuickBooks Time has one service
// item ("Hours") for nearly all internal time and most entries carry no
// description, so a real service item wins, then keyword rules on the
// description, in order. Browser file (plain JS, no JSX); loads after
// MH_gate.js. Node tests: MH_overhead.test.js.
// ----------------------------------------------------------------------------

var MH_OH_PERIODS = [
  { key: "month", label: "This month" },
  { key: "last-month", label: "Last month" },
  { key: "3m", label: "Last 3 months" },
  { key: "year", label: "This year" },
  { key: "12m", label: "Last 12 months" },
];

function MH__ohYmd(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

// Whole months, local dates, inclusive. Unknown keys read as "month".
function MH_ohRange(key, today) {
  var now = today instanceof Date ? today : new Date();
  var y = now.getFullYear();
  var m = now.getMonth();
  var endThis = new Date(y, m + 1, 0);
  if (key === "last-month") return { from: MH__ohYmd(new Date(y, m - 1, 1)), to: MH__ohYmd(new Date(y, m, 0)) };
  if (key === "3m") return { from: MH__ohYmd(new Date(y, m - 2, 1)), to: MH__ohYmd(endThis) };
  if (key === "year") return { from: MH__ohYmd(new Date(y, 0, 1)), to: MH__ohYmd(new Date(y, 11, 31)) };
  if (key === "12m") return { from: MH__ohYmd(new Date(y, m - 11, 1)), to: MH__ohYmd(endThis) };
  return { from: MH__ohYmd(new Date(y, m, 1)), to: MH__ohYmd(endThis) };
}

var MH_OH_NO_DESC = "No description";
var MH_OH_OTHER = "Other";
// First match wins.
var MH_OH_RULES = [
  { label: "Onboarding", re: /onboard|new client|set ?up|kick-?off/ },
  { label: "Meetings", re: /meeting|\bmtg\b|\bcall\b|huddle|1:1|one on one|stand-?up|\bzoom\b|\bteams\b/ },
  { label: "Training", re: /train|learn|course|webinar|\bcpe\b|certif|study|tutorial/ },
  { label: "Sales & marketing", re: /sales|marketing|proposal|prospect|\blead|discovery|website|social media|newsletter/ },
  { label: "Email & admin", re: /e-?mail|inbox|admin|asana|slack|filing|organi[sz]|schedul|calendar|payroll|invoice|billing/ },
  { label: "Reviews & planning", re: /review|plan|strategy|process|\bsop\b|document|research/ },
];

// A real service item (anything but QuickBooks Time's generic "Hours") wins;
// otherwise the description decides.
function MH_ohCategory(item, description) {
  var it = item == null ? "" : String(item).trim();
  if (it && it.toLowerCase() !== "hours") return it;
  var d = description == null ? "" : String(description).trim().toLowerCase();
  if (!d) return MH_OH_NO_DESC;
  for (var i = 0; i < MH_OH_RULES.length; i++) if (MH_OH_RULES[i].re.test(d)) return MH_OH_RULES[i].label;
  return MH_OH_OTHER;
}

function MH__num(v) {
  var n = Number(v);
  return v == null || !isFinite(n) ? null : n;
}

// internal_hours().lines -> [{ category, minutes, cost, entries, lines }],
// most minutes first. cost stays null when no line in it had a cost.
function MH_ohCategories(lines) {
  var by = {};
  var order = [];
  (lines || []).forEach(function (l) {
    if (!l) return;
    var c = MH_ohCategory(l.item, l.description);
    if (!by[c]) {
      by[c] = { category: c, minutes: 0, cost: null, entries: 0, lines: 0 };
      order.push(c);
    }
    var g = by[c];
    g.minutes += MH__num(l.minutes) || 0;
    var cost = MH__num(l.cost);
    if (cost != null) g.cost = (g.cost || 0) + cost;
    g.entries += MH__num(l.entries) || 0;
    g.lines += 1;
  });
  return order
    .map(function (k) {
      var g = by[k];
      if (g.cost != null) g.cost = Math.round(g.cost * 100) / 100;
      return g;
    })
    .sort(function (a, b) {
      return b.minutes - a.minutes || a.category.localeCompare(b.category);
    });
}

// internal_hours().months (only months with time) -> every month from..to,
// oldest first, missing ones as { minutes: 0, cost: 0 }.
function MH_ohMonths(months, from, to) {
  var have = {};
  (months || []).forEach(function (m) {
    if (m && m.month) have[String(m.month).slice(0, 7)] = m;
  });
  var out = [];
  if (!from || !to) return out;
  var y = Number(String(from).slice(0, 4));
  var mo = Number(String(from).slice(5, 7)) - 1;
  var endKey = String(to).slice(0, 7);
  for (var guard = 0; guard < 60; guard++) {
    var key = y + "-" + String(mo + 1).padStart(2, "0");
    if (key > endKey) break;
    var m = have[key];
    out.push({
      month: key + "-01",
      minutes: m ? MH__num(m.minutes) || 0 : 0,
      cost: m ? MH__num(m.cost) : 0,
    });
    mo += 1;
    if (mo > 11) {
      mo = 0;
      y += 1;
    }
  }
  return out;
}

// part / whole as a percentage (one decimal), or null when whole is 0/missing.
function MH_ohPct(part, whole) {
  var p = MH__num(part);
  var w = MH__num(whole);
  if (p == null || !w) return null;
  return Math.round((p / w) * 1000) / 10;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    MH_OH_PERIODS: MH_OH_PERIODS,
    MH_OH_NO_DESC: MH_OH_NO_DESC,
    MH_OH_OTHER: MH_OH_OTHER,
    MH_ohRange: MH_ohRange,
    MH_ohCategory: MH_ohCategory,
    MH_ohCategories: MH_ohCategories,
    MH_ohMonths: MH_ohMonths,
    MH_ohPct: MH_ohPct,
  };
}
