// ----------------------------------------------------------------------------
// GLR_compare: "Month vs. the year" (spec 7.1; prototype compareMonth).
//
//   compareMonth(lines, 'YYYY-MM', opts) -> rows, P&L accounts only
//   monthKeys(lines) -> ['YYYY-MM', ...] every month from first to last
//   monthlyVolume(lines, opts) -> [{ month, lines, txns }]
//
// opts: { rules, passThrough (GLR_rules.passThrough result; built from rules
//   when missing), lastCompleteMonth: 'YYYY-MM' (months after it are left out
//   of the average, so a half-finished current month never drags it down) }
//
// Row: { acct, acct_id, acct_type, classification, cur, curN, avg, prior,
//   diff, pct, status: 'new'|'miss'|'up'|'down'|'ok', series: [[ym, net]],
//   top: [{date, name, memo, amount, key}], oneTime, seasonal, explained }
// Amounts are the account's net for the month in the ledger's sign, as in
// the prototype. "up"/"down" compare absolute sizes.
// ----------------------------------------------------------------------------
(function (root, factory) {
  if (typeof module === "object" && module && module.exports) module.exports = factory(require("./GLR_config.js"), require("./GLR_rules.js"));
  else root.GLR_compare = factory(root.GLR_config, root.GLR_rules);
})(typeof window !== "undefined" ? window : globalThis, function (C, R) {
  "use strict";

  var CMP = C.CMP;

  function monthKeys(lines) {
    var lo = Infinity, hi = -Infinity;
    (lines || []).forEach(function (l) {
      if (!l || !l.date) return;
      var k = C.monthIndex(C.ym(l.date));
      if (k < lo) lo = k;
      if (k > hi) hi = k;
    });
    var out = [];
    for (var k = lo; k <= hi; k++) out.push(C.ymFromIndex(k));
    return out;
  }

  function prepare(lines, opts) {
    var L = R.applyAccountTypes((lines || []).filter(function (l) { return l && l.date; }), opts.rules);
    var pt = opts.passThrough && typeof opts.passThrough.has === "function" ? opts.passThrough : R.passThrough(L, opts.rules);
    return { L: L, pt: pt };
  }

  function compareMonth(lines, period, opts) {
    opts = opts || {};
    var p = prepare(lines, opts);
    var keys = monthKeys(p.L);
    if (period && keys.indexOf(period) === -1) {
      // Selected month has no activity at all: still compare against the rest.
      keys.push(period);
      keys.sort();
    }
    var curIdx = C.monthIndex(period);
    var others = keys.filter(function (k) {
      if (k === period) return false;
      if (opts.lastCompleteMonth && k > opts.lastCompleteMonth) return false;
      return true;
    });
    var pl = p.L.filter(function (l) { return C.isPL(l.classification) && !p.pt.has(l); });
    var groups = new Map();
    pl.forEach(function (l) {
      var k = R.acctKey(l);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(l);
    });

    var rows = [];
    groups.forEach(function (list) {
      var f = list[0];
      var by = {}, cnt = {}, curLines = [];
      keys.forEach(function (k) { by[k] = 0; cnt[k] = 0; });
      list.forEach(function (l) {
        var k = C.ym(l.date);
        if (!(k in by)) { by[k] = 0; cnt[k] = 0; }
        by[k] += l.cents;
        cnt[k] += 1;
        if (k === period) curLines.push(l);
      });
      var cur = (by[period] || 0) / 100, curN = cnt[period] || 0;
      var avg = others.length ? others.reduce(function (s, k) { return s + by[k]; }, 0) / others.length / 100 : 0;
      avg = Math.round(avg * 100) / 100;
      var active = others.filter(function (k) { return cnt[k] > 0; }).length;
      var priorK = C.ymFromIndex(curIdx - 1);
      var prior = priorK in by ? by[priorK] / 100 : null;
      var diff = Math.round((cur - avg) * 100) / 100;
      var status = "ok";
      if (curN && !active) status = "new";
      else if (!curN && others.length >= CMP.minMonths && active / others.length >= CMP.missShare) status = "miss";
      else if (curN && Math.abs(diff) >= CMP.minDiff && Math.abs(diff) >= CMP.minPct * Math.abs(avg)) status = Math.abs(cur) > Math.abs(avg) ? "up" : "down";

      // Why lines (Phase 2 in the spec; cheap, so computed now).
      var top = curLines.slice().sort(function (a, b) { return Math.abs(b.cents) - Math.abs(a.cents) || (a.date < b.date ? -1 : 1); })
        .slice(0, CMP.topN).map(function (l) { return { date: l.date, name: l.name, memo: l.memo, amount: l.cents / 100, key: l.key }; });
      var oneTime = (status === "up" || status === "down" || status === "new") && top.length > 0 &&
        Math.abs(top[0].amount) >= CMP.oneTimeShare * Math.abs(diff) && Math.abs(diff) > 0;
      var seasonal = false;
      if (status !== "ok" && keys.length >= CMP.seasonalMinMonths) {
        var lastYear = C.ymFromIndex(curIdx - 12);
        if (lastYear in by) {
          var ly = by[lastYear] / 100;
          // Seasonal: the same month last year was off the average the same
          // way, by at least half as much (or was also empty, for a miss).
          if (status === "miss") seasonal = cnt[lastYear] === 0;
          else if (status === "up" || status === "down") {
            var lyDiff = ly - avg;
            seasonal = Math.sign(lyDiff) === Math.sign(diff) && Math.abs(lyDiff) >= Math.abs(diff) / 2;
          }
        }
      }
      rows.push({
        acct: f.acct,
        acct_id: f.acct_id,
        acct_type: f.acct_type,
        classification: f.classification,
        cur: cur,
        curN: curN,
        avg: avg,
        prior: prior,
        diff: diff,
        pct: avg ? Math.round((diff / Math.abs(avg)) * 1000) / 10 : null,
        status: status,
        series: keys.map(function (k) { return [k, (by[k] || 0) / 100]; }),
        top: top,
        oneTime: oneTime,
        seasonal: seasonal,
        explained: oneTime || seasonal,
      });
    });
    var order = { miss: 0, up: 1, down: 1, "new": 2, ok: 3 };
    rows.sort(function (a, b) {
      return order[a.status] - order[b.status] ||
        (a.classification === b.classification ? 0 : a.classification === "Revenue" ? -1 : 1) ||
        String(a.acct).localeCompare(String(b.acct), undefined, { numeric: true });
    });
    return rows;
  }

  // Lines and transactions per month (activity strip). Pass-through lines
  // are left out so a spend card's mirror lines don't double the count.
  function monthlyVolume(lines, opts) {
    opts = opts || {};
    var p = prepare(lines, opts);
    var keys = monthKeys(p.L);
    var acc = {};
    keys.forEach(function (k) { acc[k] = { month: k, lines: 0, txns: 0, _k: {} }; });
    p.L.forEach(function (l) {
      if (p.pt.has(l)) return;
      var a = acc[C.ym(l.date)];
      a.lines += 1;
      if (!a._k[l.key]) { a._k[l.key] = true; a.txns += 1; }
    });
    return keys.map(function (k) { return { month: k, lines: acc[k].lines, txns: acc[k].txns }; });
  }

  return { compareMonth: compareMonth, monthKeys: monthKeys, monthlyVolume: monthlyVolume };
});
