// ----------------------------------------------------------------------------
// MH_fees: the pure logic behind the MGB Home slice S5 "2027 fee change
// review" (docs/mgb-home-spec.md section 4) on Pricing & fees. The rows come
// from the READ-ONLY master-sheet-sync action "compare" (Bookkeeping fee now
// vs Bookkeeping fee 2027 per matched client; the function computes the
// change, the % and the flags, supabase/functions/master-sheet-sync/logic.js
// planCompare). This file only filters, sorts and builds the CSV. The piece
// itself is MH_FeeReviewCard in MgbHome.jsx.
//
//   MH_FR_FLAGS                 flag key -> short label (table and CSV)
//   MH_FR_FILTERS               filter chips [{ key, label }]
//   MH_frFilter(rows, key)      rows for a chip
//   MH_frSort(rows, key, dir)   name | now | next | change | pct
//   MH_frCsv(rows)              -> { header, rows } for TP_downloadCsv
//   MH_frSummary(counts)        one plain line from the counts
//
// Browser file (plain JS, no JSX); loads after MH_gate.js. Node tests:
// MH_fees.test.js. No fee amounts live here.
// ----------------------------------------------------------------------------

var MH_FR_FLAGS = {
  big_move: "Moves more than 25%",
  missing_2027: "No 2027 fee",
  missing_now: "No current fee",
  lost_paused: "Lost / Paused",
  duplicate: "Two sheet rows",
};

var MH_FR_FILTERS = [
  { key: "all", label: "All" },
  { key: "flagged", label: "Flagged" },
  { key: "big_move", label: "Over 25%" },
  { key: "missing_2027", label: "No 2027 fee" },
  { key: "lost_paused", label: "Lost / Paused" },
];

function MH__frFlags(r) {
  return (r && Array.isArray(r.flags) && r.flags) || [];
}

function MH_frFilter(rows, key) {
  var list = Array.isArray(rows) ? rows : [];
  if (!key || key === "all") return list.slice();
  if (key === "flagged") return list.filter(function (r) { return MH__frFlags(r).length > 0; });
  return list.filter(function (r) { return MH__frFlags(r).indexOf(key) >= 0; });
}

// Blanks always sort last, whichever way.
function MH_frSort(rows, key, dir) {
  var d = dir === "desc" ? -1 : 1;
  var name = function (r) { return String((r && (r.client_name || r.sheet_name)) || ""); };
  var out = (Array.isArray(rows) ? rows : []).slice();
  out.sort(function (a, b) {
    if (!key || key === "name") return d * name(a).localeCompare(name(b)) || (a.row || 0) - (b.row || 0);
    var av = a[key];
    var bv = b[key];
    var an = av == null || !isFinite(av);
    var bn = bv == null || !isFinite(bv);
    if (an && bn) return name(a).localeCompare(name(b));
    if (an) return 1;
    if (bn) return -1;
    if (av === bv) return name(a).localeCompare(name(b));
    return d * (av < bv ? -1 : 1);
  });
  return out;
}

function MH__frNum(v) {
  return v == null || !isFinite(v) ? "" : Number(v).toFixed(2);
}

function MH_frCsv(rows) {
  var header = ["Client", "Sheet name", "Sheet row", "Status", "Fee now", "Fee 2027", "Change $", "Change %", "Flags", "Note"];
  var out = (Array.isArray(rows) ? rows : []).map(function (r) {
    var notes = [];
    if (r.now == null && r.now_note) notes.push("now: " + r.now_note);
    if (r.next == null && r.next_note) notes.push("2027: " + r.next_note);
    return [
      r.client_name || "",
      r.sheet_name || "",
      r.row == null ? "" : r.row,
      r.status || "",
      MH__frNum(r.now),
      MH__frNum(r.next),
      MH__frNum(r.change),
      r.pct == null || !isFinite(r.pct) ? "" : String(r.pct),
      MH__frFlags(r)
        .map(function (f) { return MH_FR_FLAGS[f] || f; })
        .join("; "),
      notes.join("; "),
    ];
  });
  return { header: header, rows: out };
}

function MH_frSummary(counts) {
  var c = counts || {};
  var n = function (v) { return Number(v) || 0; };
  var bits = [n(c.matched) + (n(c.matched) === 1 ? " client" : " clients")];
  bits.push(n(c.big_move) + " move more than 25%");
  bits.push(n(c.missing_2027) + " with no 2027 fee");
  bits.push(n(c.lost_paused) + " Lost or Paused");
  if (n(c.missing_now)) bits.push(n(c.missing_now) + " with no current fee");
  if (n(c.duplicate)) bits.push(n(c.duplicate) + " on two sheet rows");
  if (n(c.unmatched)) bits.push(n(c.unmatched) + " sheet rows not matched (not shown)");
  return bits.join(" · ");
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    MH_FR_FLAGS: MH_FR_FLAGS,
    MH_FR_FILTERS: MH_FR_FILTERS,
    MH_frFilter: MH_frFilter,
    MH_frSort: MH_frSort,
    MH_frCsv: MH_frCsv,
    MH_frSummary: MH_frSummary,
  };
}
