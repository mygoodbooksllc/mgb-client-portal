// ----------------------------------------------------------------------------
// GLR_checks: the Ledger review checks (spec 7 "Phase 1 checks", Bailley's
// standard in PLAN.md) over normalized lines from GLR_parse.
//
//   runChecks(lines, ctx) -> { flags, suppressed, passThrough, recon, lines }
//   reconciliation(lines, ctx) -> the Reconciliation panel data
//   holdingTotals(lines, { period }) -> Uncategorized / Ask My Accountant $
//   toUpsertRows(flags) -> jsonb rows for gl_review_upsert_flags
//   flagKey(type, line, extra) -> the spec 4.1 txn_key
//
// ctx: { rules: gl_review_rules rows, watchVendors: [{pattern, category,
//   active}], clearedAvailable: bool, reviewPeriod: 'YYYY-MM' (defaults to
//   the latest month in the lines), dedupe: true (false = prototype parity,
//   one flag per line) }
//
// A flag:
//   { id, flag_type, severity, label, why, txn_key, period 'YYYY-MM-01',
//     txn_date, amount, name, memo, account_name, account_qbo_id, other_side,
//     class_name, location_name, askable, checks_version,
//     line (the line shown), _lines (every line behind it), line_count }
// Pure. No React, no DOM.
// ----------------------------------------------------------------------------
(function (root, factory) {
  if (typeof module === "object" && module && module.exports) module.exports = factory(require("./GLR_config.js"), require("./GLR_rules.js"));
  else root.GLR_checks = factory(root.GLR_config, root.GLR_rules);
})(typeof window !== "undefined" ? window : globalThis, function (C, R) {
  "use strict";

  var T = C.T, RX = C.RX, TYPES = C.TYPES;
  var low = function (s) { return String(s == null ? "" : s).trim().toLowerCase(); };
  var isBank = function (l) { return l.acct_type === "Bank"; };
  var abs = Math.abs;

  function groupBy(a, f) {
    var m = new Map();
    a.forEach(function (x) { var k = f(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); });
    return m;
  }

  // Account id inside made-up keys: QuickBooks id, else "n~<name>" (files).
  function acctRef(l) { return l.acct_id != null ? String(l.acct_id) : "n~" + low(l.acct); }

  // spec 4.1 keys. extra: { num } for chk, { month } for acct/month.
  function flagKey(type, line, extra) {
    extra = extra || {};
    var kind = (TYPES[type] && TYPES[type].key) || "txn";
    var k;
    if (kind === "chk") k = "chk:" + acctRef(line) + ":" + (extra.num != null ? extra.num : line.num);
    else if (kind === "neg") k = "neg:" + acctRef(line) + ":" + line.date;
    else if (kind === "acct") k = "acct:" + acctRef(line) + ":" + (extra.month || C.ym(line.date));
    else if (kind === "month") k = "month:" + (extra.month || C.ym(line.date));
    else k = line.key;
    return String(k).slice(0, 200);
  }

  function isLoanAccount(l) {
    return l.acct_type === "Long Term Liability" || (l.classification === "Liability" && l.acct_type !== "Credit Card" && RX.loanAccount.test(l.acct));
  }

  // ---- Reconciliation panel (spec 7.1). Uses lines dated on or before the
  // end of the review month. "Open" = not R (the pullCloseData rule).
  function reconciliation(lines, ctx) {
    ctx = ctx || {};
    var L = ctx._prepared ? lines : R.applyAccountTypes(lines || [], ctx.rules);
    var pt = ctx._pt || R.passThrough(L, ctx.rules);
    var period = ctx.reviewPeriod || latestMonth(L);
    var through = period ? C.monthEnd(period) : null;
    var available = !!ctx.clearedAvailable;
    var throughDay = through ? C.dayNumber(through) : 0;
    var byAcct = groupBy(L.filter(function (l) {
      return (isBank(l) || l.acct_type === "Credit Card" || isLoanAccount(l)) && (!through || l.date <= through);
    }), R.acctKey);
    var accounts = [];
    byAcct.forEach(function (list) {
      var f = list[0];
      var a = {
        acct: f.acct, acct_id: f.acct_id,
        kind: isBank(f) ? "bank" : f.acct_type === "Credit Card" ? "card" : "loan",
        pass_through: pt.has(f),
        line_count: list.length,
        reconciled_count: null, cleared_not_reconciled: null,
        open_count: null, open_total: null, oldest_date: null, last_reconciled_date: null,
        stale_count: null, stale_total: null, oldest_line: null,
      };
      if (available) {
        var open = list.filter(function (l) { return l.cleared !== "R"; });
        var rec = list.filter(function (l) { return l.cleared === "R"; });
        var stale = open.filter(function (l) { return throughDay - C.dayNumber(l.date) > T.reconStaleDays; });
        var sumC = function (xs) { return xs.reduce(function (s, l) { return s + l.cents; }, 0) / 100; };
        open.sort(function (x, y) { return x.date < y.date ? -1 : x.date > y.date ? 1 : 0; });
        a.reconciled_count = rec.length;
        a.cleared_not_reconciled = open.filter(function (l) { return l.cleared === "C"; }).length;
        a.open_count = open.length;
        a.open_total = sumC(open);
        a.oldest_date = open.length ? open[0].date : null;
        a.oldest_line = open[0] || null;
        a.last_reconciled_date = rec.reduce(function (m, l) { return !m || l.date > m ? l.date : m; }, null);
        a.stale_count = stale.length;
        a.stale_total = sumC(stale);
      }
      accounts.push(a);
    });
    var order = { bank: 0, card: 1, loan: 2 };
    accounts.sort(function (x, y) { return order[x.kind] - order[y.kind] || String(x.acct).localeCompare(String(y.acct), undefined, { numeric: true }); });
    var banks = accounts.filter(function (a) { return a.kind === "bank" && !a.pass_through; });
    var banksClean = available ? banks.every(function (a) { return a.stale_count === 0; }) : null;
    accounts.forEach(function (a) {
      a.loan_uncleared = available && a.kind === "loan" ? a.open_count > 0 && (a.stale_count > 0 || a.reconciled_count === 0) : false;
    });
    return {
      available: available,
      period: period,
      through: through,
      accounts: accounts,
      banks_clean: banksClean,
      loan_issue: accounts.some(function (a) { return a.loan_uncleared && !a.pass_through; }),
    };
  }

  function latestMonth(lines) {
    var m = null;
    (lines || []).forEach(function (l) { if (l.date && (!m || l.date > m)) m = l.date; });
    return m ? C.ym(m) : null;
  }

  // ---- Uncategorized / Ask My Accountant dollars (Bailley: count and $).
  function holdingTotals(lines, opts) {
    opts = opts || {};
    var list = (lines || []).filter(function (l) { return RX.suspense.test(l.acct) && (!opts.period || C.ym(l.date) === opts.period); });
    var out = [];
    groupBy(list, R.acctKey).forEach(function (ls) {
      var keys = {};
      ls.forEach(function (l) { keys[l.key] = true; });
      out.push({
        acct: ls[0].acct, acct_id: ls[0].acct_id,
        count: Object.keys(keys).length,
        total: ls.reduce(function (s, l) { return s + abs(l.cents); }, 0) / 100,
        net: ls.reduce(function (s, l) { return s + l.cents; }, 0) / 100,
      });
    });
    out.sort(function (a, b) { return b.total - a.total; });
    return out;
  }

  // ---- The checks. Each hit: { t, x (line), why, key?, severity? }.
  function collectHits(L, ctx, pt, recon) {
    var hits = [];
    var add = function (t, x, why, extra) { hits.push(Object.assign({ t: t, x: x, why: why }, extra || {})); };

    // Recurring: same name + |amount| on >= recurMinTxns distinct transactions.
    var recur = new Map();
    L.forEach(function (x) {
      var k = low(x.name) + "|" + abs(x.cents);
      if (!recur.has(k)) recur.set(k, new Set());
      recur.get(k).add(x.key);
    });
    var isRecur = function (x) { var s = recur.get(low(x.name) + "|" + abs(x.cents)); return !!s && s.size >= T.recurMinTxns; };

    var dupSeen = new Map();
    var watch = (ctx.watchVendors || C.DEFAULT_WATCH_VENDORS).filter(function (w) {
      return w && w.active !== false && low(w.pattern).length >= 2;
    });

    L.forEach(function (x) {
      var a = abs(x.cents);
      var where = x.acct + " " + x.split;
      if (RX.suspense.test(x.acct)) add("suspense", x, "Posted to a holding account. Needs a real category.");
      if (RX.obe.test(x.acct)) add("obe", x, "Activity in Opening Balance Equity usually means a setup or reconciliation issue.");
      if (x.cents !== 0) {
        var dk = [x.date, x.cents, low(x.name), R.acctKey(x)].join("|");
        var prev = dupSeen.get(dk);
        if (prev && prev.key !== x.key) {
          add("dup", x, "Same date, name, amount and account as " + (prev.row ? "row " + prev.row : "another entry" + (prev.num ? " (" + prev.type + " #" + prev.num + ")" : "")) + ".");
        } else if (!prev) dupSeen.set(dk, x);
      }
      if (RX.journal.test(x.type) && isBank(x)) add("jecash", x, "Journal entries hitting a bank account should be rare and documented.");
      if (a >= T.roundMinAbs * 100 && a % (T.roundStep * 100) === 0 && !RX.roundExcludeType.test(x.type) && !isRecur(x)) {
        add("round", x, "Even-hundred amount of $1,000 or more. Confirm it isn't an estimate.");
      }
      var dw = C.weekday(x.date);
      if ((dw === 0 || dw === 6) && a >= T.weekendMinAbs * 100 && !isRecur(x) && RX.weekendType.test(x.type) && !RX.weekendExcludeWhere.test(where)) {
        add("weekend", x, dw === 0 ? "Dated on a Sunday." : "Dated on a Saturday.");
      }
      if (!x.name && !x.memo) add("blank", x, "No payee or memo. Hard to support in an audit.");

      // Loan booked as expense or income
      if (a >= T.loanMinAbs * 100 && C.isPL(x.classification) && !RX.loanSafeAccount.test(x.acct) &&
          (RX.lenderName.test(x.name) || RX.loanWords.test(x.memo))) {
        if (x.classification === "Expense") {
          add("loan_expense", x, "Looks like a loan payment" + (x.name ? " to " + x.name : "") + " posted to " + x.acct + ". The principal belongs on the loan account, not an expense.");
        } else {
          add("loan_expense", x, "Looks like loan money" + (x.name ? " from " + x.name : "") + " posted to income. Loan proceeds belong on a loan account.");
        }
      }

      // Watch-list vendors (firm-wide list, gl_review_watch_vendors)
      if (x.cents !== 0 && watch.length) {
        var hay = low(x.name) + " " + low(x.memo);
        for (var i = 0; i < watch.length; i++) {
          if (hay.indexOf(low(watch[i].pattern)) !== -1) {
            add("watch_vendor", x, "Matches the watch list (" + String(watch[i].category || "other").replace(/_/g, " ") + "). Confirm it's an organization expense, not a personal one.");
            break;
          }
        }
      }
    });

    // Per-account checks
    groupBy(L, R.acctKey).forEach(function (list) {
      var acct = list[0].acct;
      if (isBank(list[0])) {
        var neg = false;
        // Walk the register in QuickBooks order: by the pull's per-line `seq`
        // when every line has one, else the order the lines came in.
        var reg = list;
        if (list.length && list.every(function (x) { return typeof x.seq === "number"; })) {
          reg = list.map(function (x, i) { return { x: x, i: i }; })
            .sort(function (a, b) { return a.x.seq - b.x.seq || a.i - b.i; })
            .map(function (o) { return o.x; });
        }
        reg.forEach(function (x) {
          if (x.bal == null) return;
          if (x.bal < 0 && !neg) { add("negbank", x, "Running balance fell to " + C.money(x.bal) + "."); neg = true; }
          else if (x.bal >= 0) neg = false;
        });
        var nums = Array.from(new Set(list.filter(function (x) { return RX.check.test(x.type) && /^\d+$/.test(x.num); }).map(function (x) { return +x.num; })))
          .sort(function (a, b) { return a - b; });
        for (var i = 1; i < nums.length; i++) {
          var g = nums[i] - nums[i - 1];
          if (g >= T.gapMin && g <= T.gapMax) {
            var after = nums[i];
            var x = list.filter(function (t) { return RX.check.test(t.type) && +t.num === after; })[0];
            add("gap", x, g === 2 ? "Check #" + (nums[i - 1] + 1) + " is missing." : "Checks #" + (nums[i - 1] + 1) + "–" + (nums[i] - 1) + " are missing.", { keyExtra: { num: after } });
          }
        }
      }
      // Unusually large: robust outlier on |amount| (prototype medians).
      var absv = list.map(function (x) { return abs(x.cents) / 100; }).filter(function (v) { return v > 0; }).sort(function (a, b) { return a - b; });
      if (absv.length >= T.largeMinLines) {
        var med = absv[absv.length >> 1];
        var mad = absv.map(function (v) { return abs(v - med); }).sort(function (a, b) { return a - b; })[absv.length >> 1] || med * T.largeMadFallback;
        list.forEach(function (x) {
          var v = abs(x.cents) / 100;
          if (v >= T.largeMinAbs && !isRecur(x) && v > med + T.largeMadK * mad && v > med * T.largeMedK) {
            add("large", x, "About " + Math.round(v / med) + "× the typical " + C.money(med) + " in " + acct + ".");
          }
        });
      }
    });

    // Unusual account for this vendor (category side, P&L accounts only).
    var cat = L.filter(function (x) { return C.isPL(x.classification) && !pt.has(x) && (x.name_id || x.name); });
    groupBy(cat, function (x) { return x.name_id ? "id:" + x.name_id : "n:" + low(x.name); }).forEach(function (list) {
      var byAcct = groupBy(list, R.acctKey);
      var allKeys = new Set(list.map(function (x) { return x.key; }));
      var total = allKeys.size;
      if (total < T.vendorMinTxns || byAcct.size < 2) return;
      var counts = [];
      byAcct.forEach(function (ls, k) { counts.push({ k: k, n: new Set(ls.map(function (x) { return x.key; })).size, acct: ls[0].acct, lines: ls }); });
      counts.sort(function (a, b) { return b.n - a.n; });
      var dom = counts[0];
      if (dom.n / total < T.vendorDominantShare) return;
      counts.slice(1).forEach(function (c) {
        if (c.n > T.vendorMaxOther) return;
        c.lines.forEach(function (x) {
          add("vendor_acct", x, (x.name || "This vendor") + " usually posts to " + dom.acct + " (" + dom.n + " of " + total + "). This one went to " + x.acct + ".");
        });
      });
    });

    // Reconciliation flags
    if (recon && recon.available) {
      recon.accounts.forEach(function (a) {
        if (!a.oldest_line) return;
        var line = Object.assign({}, a.oldest_line, { amt: a.open_total, cents: C.toCents(a.open_total), name: "", memo: "", split: "" });
        if (a.kind === "loan" && a.loan_uncleared) {
          add("recon_uncleared", line,
            "Loan account with " + a.open_count + " unreconciled line" + (a.open_count === 1 ? "" : "s") + " (" + C.money(a.open_total) + "), the oldest from " + a.oldest_date + (recon.banks_clean ? ", while the bank accounts are reconciled." : "."),
            { keyExtra: { month: recon.period }, severity: recon.banks_clean ? "high" : "medium", period: recon.period });
        } else if (a.kind !== "loan" && a.stale_count > 0) {
          add("recon_uncleared", line,
            a.stale_count + " item" + (a.stale_count === 1 ? "" : "s") + " (" + C.money(a.stale_total) + ") older than " + T.reconStaleDays + " days " + (a.stale_count === 1 ? "hasn't" : "haven't") + " been reconciled. The oldest is from " + a.oldest_date + ".",
            { keyExtra: { month: recon.period }, severity: "medium", period: recon.period });
        }
      });
    }
    return hits;
  }

  function makeFlag(h, group) {
    var x = h.x, def = TYPES[h.t];
    var key = flagKey(h.t, x, h.keyExtra);
    var ymStr = h.period || C.ym(x.date);
    return {
      id: h.t + "|" + key,
      flag_type: h.t,
      severity: h.severity || def.severity,
      label: def.label,
      why: String(h.why).slice(0, 1000),
      txn_key: key,
      period: ymStr + "-01",
      txn_date: x.date,
      amount: x.cents / 100,
      name: x.name || "",
      memo: x.memo || "",
      account_name: x.acct,
      account_qbo_id: x.acct_id,
      other_side: x.split || "",
      class_name: x.cls || "",
      location_name: x.loc || "",
      askable: !!x.askable && def.key === "txn",
      checks_version: C.CHECKS_VERSION,
      line: x,
      _lines: group.map(function (g) { return g.x; }),
      line_count: group.length,
    };
  }

  // One flag per transaction per type. The line shown: the bank side for
  // bank checks, otherwise the category side (not bank, not pass-through).
  function dedupe(hits, pt) {
    var groups = new Map();
    hits.forEach(function (h) {
      var k = h.t + "|" + flagKey(h.t, h.x, h.keyExtra);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(h);
    });
    var out = [];
    groups.forEach(function (g) {
      var wantBank = TYPES[g[0].t].side === "bank";
      var score = function (h) {
        if (wantBank) return isBank(h.x) ? 2 : 0;
        return (isBank(h.x) ? 0 : 1) + (pt.has(h.x) ? 0 : 1);
      };
      var best = g[0];
      g.forEach(function (h) { if (score(h) > score(best)) best = h; });
      out.push(makeFlag(best, g));
    });
    return out;
  }

  function sortFlags(flags) {
    var tord = {};
    C.TYPE_ORDER.forEach(function (t, i) { tord[t] = i; });
    return flags.sort(function (a, b) {
      return C.SEVERITY_RANK[a.severity] - C.SEVERITY_RANK[b.severity] ||
        (a.txn_date < b.txn_date ? 1 : a.txn_date > b.txn_date ? -1 : 0) ||
        (tord[a.flag_type] || 0) - (tord[b.flag_type] || 0) ||
        (a.txn_key < b.txn_key ? -1 : a.txn_key > b.txn_key ? 1 : 0);
    });
  }

  function runChecks(lines, ctx) {
    ctx = ctx || {};
    var L = R.applyAccountTypes((lines || []).filter(function (l) { return l && l.date; }), ctx.rules);
    var pt = R.passThrough(L, ctx.rules);
    var recon = reconciliation(L, Object.assign({}, ctx, { _prepared: true, _pt: pt }));
    var hits = collectHits(L, ctx, pt, recon);
    var flags = ctx.dedupe === false
      ? hits.map(function (h) { return makeFlag(h, [h]); })
      : dedupe(hits, pt);

    var kept = [], suppressed = [];
    flags.forEach(function (f) {
      if (f._lines.every(function (l) { return pt.has(l); })) {
        suppressed.push({ flag: f, reason: "pass_through", rule_id: null });
        return;
      }
      var rule = R.stopRuleFor(f, ctx.rules);
      if (rule) { suppressed.push({ flag: f, reason: "stop_flagging", rule_id: rule.id || null }); return; }
      kept.push(f);
    });
    return { flags: sortFlags(kept), suppressed: suppressed, passThrough: pt.accounts, recon: recon, lines: L };
  }

  function countByType(flags) {
    var c = {};
    (flags || []).forEach(function (f) { c[f.flag_type] = (c[f.flag_type] || 0) + 1; });
    return c;
  }

  // Rows for gl_review_upsert_flags (spec 4.1). File-upload flags are never
  // stored in phase 1, so they are dropped here.
  var UPSERT_FIELDS = ["txn_key", "flag_type", "severity", "why", "period", "txn_date", "amount", "name", "memo",
    "account_name", "account_qbo_id", "other_side", "class_name", "location_name"];
  function toUpsertRows(flags) {
    return (flags || []).filter(function (f) { return f.line && f.line.source !== "file"; }).map(function (f) {
      var o = {};
      UPSERT_FIELDS.forEach(function (k) { o[k] = f[k] === undefined ? null : f[k]; });
      return o;
    });
  }

  return {
    runChecks: runChecks,
    reconciliation: reconciliation,
    holdingTotals: holdingTotals,
    flagKey: flagKey,
    countByType: countByType,
    toUpsertRows: toUpsertRows,
    sortFlags: sortFlags,
    latestMonth: latestMonth,
    UPSERT_MAX: 2000,
  };
});
