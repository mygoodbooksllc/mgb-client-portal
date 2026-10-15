// ----------------------------------------------------------------------------
// LR_logic: small pure helpers for the Ledger review screens (LR_*.jsx).
// The checks themselves live in GLR_*.js; this file only shapes their output
// and the stored rows for the screen.
//
//   lastCompleteMonth(today) / monthOptions(today, n) / toPeriod / ymOf
//   makeMemoryCache(ttlMs, now)  GL lines live here for 15 minutes, in memory
//                                only (never localStorage/sessionStorage)
//   attachRun(stored, runFlags)  stored gl_review_flags rows + the in-memory
//                                flag (lines behind it) from the last pull
//   viewFlags / tabCounts / typeCounts / openSince
//   isAskable / defaultQuestion / CLEAR_REASONS / clearReasonLabel
//   toTsv / flagsToTsv / compareToTsv     "Copy for Excel"
//   pullFromOptions / pullWindowFrom / chunk / pullWindowLabel / ruleLabel / fileRules / holdingSplit
//   signoffSummary / chartBars
//
// UMD like the GLR_ files: window.LR_logic in the browser, require() in Node.
// No React, no DOM.
// ----------------------------------------------------------------------------
(function (root, factory) {
  if (typeof module === "object" && module && module.exports) module.exports = factory(require("./GLR_config.js"));
  else root.LR_logic = factory(root.GLR_config);
})(typeof window !== "undefined" ? window : globalThis, function (C) {
  "use strict";

  var pad2 = function (n) { return (n < 10 ? "0" : "") + n; };
  var clean = function (s) { return String(s == null ? "" : s).replace(/\s+/g, " ").trim(); };
  var who = function (email) { return String(email || "").split("@")[0]; };

  // ---- Months ---------------------------------------------------------------
  // A local-fields Date for the firm's (America/Chicago) calendar day, so month
  // math never uses the browser's own timezone.
  function firmDate(now) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(firmToday(now));
    return new Date(+m[1], +m[2] - 1, +m[3]);
  }
  // The month before today's, in the firm's timezone ("last completed month").
  function lastCompleteMonth(today) {
    var d = firmDate(today);
    var y = d.getFullYear(), m = d.getMonth(); // m is 0-based, so this is last month
    if (m === 0) { y -= 1; m = 12; }
    return y + "-" + pad2(m);
  }
  // [{ym, label}] from the last completed month back, newest first.
  function monthOptions(today, count) {
    var n = count || 14;
    var start = C.monthIndex(lastCompleteMonth(today));
    var out = [];
    for (var i = 0; i < n; i++) {
      var k = C.ymFromIndex(start - i);
      out.push({ ym: k, label: C.monthLabel(k) });
    }
    return out;
  }
  function toPeriod(ym) { return String(ym || "").slice(0, 7) + "-01"; }
  function ymOf(p) { return String(p || "").slice(0, 7); }

  // ---- Memory cache -------------------------------------------------------------
  // Map-backed, per key, expires after ttlMs. Never touches browser storage.
  function makeMemoryCache(ttlMs, now) {
    var ttl = ttlMs > 0 ? ttlMs : 15 * 60 * 1000;
    var clock = typeof now === "function" ? now : function () { return Date.now(); };
    var m = new Map();
    return {
      get: function (k) {
        var e = m.get(k);
        if (!e) return null;
        if (clock() - e.at > ttl) { m.delete(k); return null; }
        return e.value;
      },
      set: function (k, v) { m.set(k, { at: clock(), value: v }); return v; },
      drop: function (k) { m.delete(k); },
      clear: function () { m.clear(); },
      size: function () { return m.size; },
    };
  }

  // ---- Flags --------------------------------------------------------------------
  var flagKey = function (f) { return String(f.txn_key) + "|" + String(f.flag_type); };

  // stored: gl_review_flags rows. runFlags: runChecks().flags from the pull.
  // Each stored row gets `run` (the matching in-memory flag, or null).
  function attachRun(stored, runFlags) {
    var byKey = new Map();
    (runFlags || []).forEach(function (f) { byKey.set(flagKey(f), f); });
    return (stored || []).map(function (s) {
      return Object.assign({}, s, { run: byKey.get(flagKey(s)) || null });
    });
  }

  var SEV = { high: 0, medium: 1, low: 2 };
  function sortForView(a, b) {
    return (SEV[a.severity] - SEV[b.severity]) ||
      String(a.txn_date || "").localeCompare(String(b.txn_date || "")) ||
      String(a.flag_type).localeCompare(String(b.flag_type)) ||
      String(a.txn_key).localeCompare(String(b.txn_key));
  }

  // Which flags a status tab shows for month ym:
  //   open / asked: that month, plus earlier months still open or asked
  //                 ("Open since <month>")
  //   cleared:      cleared or fixed, that month only
  function inTab(f, ym, tab) {
    var p = ymOf(f.period);
    if (tab === "open") return f.status === "open" && p <= ym;
    if (tab === "asked") return f.status === "asked" && p <= ym;
    if (tab === "cleared") return (f.status === "cleared" || f.status === "fixed") && p === ym;
    return false;
  }
  function viewFlags(flags, opts) {
    var o = opts || {};
    var tab = o.tab || "open";
    return (flags || []).filter(function (f) {
      return inTab(f, o.ym, tab) && (!o.type || o.type === "all" || f.flag_type === o.type);
    }).sort(sortForView);
  }
  function tabCounts(flags, ym) {
    var c = { open: 0, asked: 0, cleared: 0, high: 0 };
    (flags || []).forEach(function (f) {
      if (inTab(f, ym, "open")) { c.open += 1; if (f.severity === "high") c.high += 1; }
      else if (inTab(f, ym, "asked")) c.asked += 1;
      else if (inTab(f, ym, "cleared")) c.cleared += 1;
    });
    return c;
  }
  // {flag_type: n} for the chips of one tab, in GLR_config.TYPE_ORDER order
  // (unknown types last). Returns [{type, label, n}].
  function typeCounts(flags, ym, tab) {
    var c = {};
    viewFlags(flags, { ym: ym, tab: tab }).forEach(function (f) { c[f.flag_type] = (c[f.flag_type] || 0) + 1; });
    var order = C.TYPE_ORDER.slice();
    Object.keys(c).forEach(function (t) { if (order.indexOf(t) === -1) order.push(t); });
    return order.filter(function (t) { return c[t]; }).map(function (t) {
      return { type: t, label: (C.TYPES[t] && C.TYPES[t].label) || t, n: c[t] };
    });
  }
  // "Open since September 2026" for a flag from an earlier month, else null.
  function openSince(f, ym) {
    var p = ymOf(f.first_period || f.period);
    if (!p || !ym || ymOf(f.period) >= ym) return null;
    return "Open since " + C.monthLabel(p);
  }

  // Same test gl_review_ask makes: one real QuickBooks transaction.
  function isAskable(f) {
    var k = String((f && f.txn_key) || "");
    return !/^(syn|acct|chk|neg|month):/.test(k) && /^[^:]+:.+$/.test(k);
  }

  var QUESTIONS = {
    suspense: "I couldn't tell what this was for. Can you let me know so I can put it in the right category?",
    dup: "This looks like it may have been entered twice. Was it one payment or two?",
    large: "This is larger than usual for this account. Can you tell me what it was for?",
    watch_vendor: "Can you tell me what this purchase was for?",
    loan_expense: "Was this a loan payment or loan proceeds? I want to make sure it's recorded the right way.",
    blank: "This came through without a name or memo. Can you tell me who it was paid to and what it was for?",
  };
  function defaultQuestion(f) {
    return QUESTIONS[f && f.flag_type] || "Can you tell me what this was for?";
  }

  var CLEAR_REASONS = [
    { key: "expected", label: "Expected, nothing wrong" },
    { key: "reviewed_ok", label: "Reviewed, it's fine" },
    { key: "fixed_in_qbo", label: "Fixed it in QuickBooks" },
    { key: "client_answered", label: "The client answered" },
    { key: "other", label: "Other" },
  ];
  function clearReasonLabel(k) {
    if (k === "rule") return "Hidden by a rule";
    for (var i = 0; i < CLEAR_REASONS.length; i++) if (CLEAR_REASONS[i].key === k) return CLEAR_REASONS[i].label;
    return k ? String(k) : "";
  }

  // ---- Copy for Excel -------------------------------------------------------------
  // Tab-separated, one row per line. Tabs and line breaks inside a cell become
  // spaces. Text that Excel would read as a formula (= + - @ at the start,
  // and not a plain number) gets a leading apostrophe.
  function cell(v) {
    if (v == null) return "";
    if (typeof v === "number") return isFinite(v) ? String(v) : "";
    var s = String(v).replace(/[\t\r\n]+/g, " ");
    if (/^[=+\-@]/.test(s) && !/^[-+]?\d+(\.\d+)?$/.test(s)) s = "'" + s;
    return s;
  }
  function toTsv(rows) {
    return (rows || []).map(function (r) { return (r || []).map(cell).join("\t"); }).join("\n");
  }
  var STATUS_LABEL = { open: "Open", asked: "Asked", cleared: "Cleared", fixed: "Fixed in QuickBooks" };
  function flagsToTsv(flags) {
    var rows = [["Date", "Check", "Priority", "Name", "Memo", "Account", "Other side", "Amount", "Why", "Status"]];
    (flags || []).forEach(function (f) {
      rows.push([
        f.txn_date || "",
        (C.TYPES[f.flag_type] && C.TYPES[f.flag_type].label) || f.flag_type,
        f.severity || "",
        f.name || "",
        f.memo || "",
        f.account_name || "",
        f.other_side || "",
        typeof f.amount === "number" ? Math.round(f.amount * 100) / 100 : f.amount == null ? "" : Number(f.amount),
        f.why || "",
        STATUS_LABEL[f.status || "open"] || f.status || "Open",
      ]);
    });
    return toTsv(rows);
  }
  var CMP_LABEL = { new: "New this month", miss: "Missing this month", up: "Higher than usual", down: "Lower than usual", ok: "In range" };
  function compareToTsv(rows, ym) {
    var out = [["Account", "Type", (ym ? C.monthLabel(ym) : "This month"), "Average", "Difference", "Percent", "Status"]];
    (rows || []).forEach(function (r) {
      out.push([r.acct, r.acct_type || "", r.cur, r.avg, r.diff, r.pct == null ? "" : Math.round(r.pct), CMP_LABEL[r.status] || r.status]);
    });
    return toTsv(out);
  }
  function compareStatusLabel(s) { return CMP_LABEL[s] || s || ""; }

  // ---- Misc -------------------------------------------------------------------------
  function chunk(a, n) {
    var out = [], size = n > 0 ? n : 1;
    for (var i = 0; i < (a || []).length; i += size) out.push(a.slice(i, i + size));
    return out;
  }
  var MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  function ymdMonthLabel(ymd) {
    var m = /^(\d{4})-(\d{2})/.exec(String(ymd || ""));
    return m && MONTH_NAMES[+m[2] - 1] ? MONTH_NAMES[+m[2] - 1] + " " + m[1] : "";
  }
  // Month starts for the "Pull from" picker: the current calendar month and
  // back, newest first. 24 entries stay inside the server's 24-month limit.
  function pullFromOptions(today, count) {
    var d = firmDate(today);
    var cur = d.getFullYear() * 12 + d.getMonth();
    var out = [];
    for (var i = 0; i < (count || 24); i++) {
      var k = C.ymFromIndex(cur - i);
      out.push({ ym: k, label: C.monthLabel(k), start: k + "-01" });
    }
    return out;
  }
  // Today as YYYY-MM-DD in the firm's timezone (the server rejects a future end).
  function firmToday(now) {
    var parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(now instanceof Date ? now : new Date());
    var g = function (t) { return (parts.filter(function (p) { return p.type === t; })[0] || {}).value; };
    return g("year") + "-" + g("month") + "-" + g("day");
  }
  // A custom (picked-start) pull holds less history than the 14-month pull, so
  // checks whose result depends on how much history is in the window (round
  // amounts, weekends, large, repeat vendors, check gaps, uncleared loans) can
  // flag or miss differently. Only the window-independent types are saved.
  var CUSTOM_SAVE_TYPES = ["suspense", "obe", "dup", "jecash", "blank", "loan_expense", "watch_vendor", "negbank"];
  function rowsForWindow(rows, windowKind) {
    if (windowKind !== "custom") return rows || [];
    return (rows || []).filter(function (r) { return CUSTOM_SAVE_TYPES.indexOf(r.flag_type) >= 0; });
  }
  // The { start, end } window for a picked month start, ending today (firm date).
  function pullWindowFrom(start, now) {
    return { start: start, end: firmToday(now) };
  }
  // w: a window kind, a { start, end } window, or a gl_review_pulls row
  // (window_kind + window_start + window_end).
  // "Aug 2025 – Oct 2026" for a gl_review_pulls row (real start and end
  // months), or "" when the row has no dates.
  function coveredLabel(row) {
    var f = /^(\d{4})-(\d{2})/.exec(String((row && row.window_start) || ""));
    var t = /^(\d{4})-(\d{2})/.exec(String((row && row.window_end) || ""));
    if (!f || !t) return "";
    var short = function (m) { return MONTH_NAMES[Number(m[2]) - 1].slice(0, 3) + " " + m[1]; };
    return short(f) + " \u2013 " + short(t);
  }
  function pullWindowLabel(w) {
    if (w === "rolling14") return "Last 14 months";
    if (w === "ytd") return "Year to date";
    if (w && typeof w === "object" && w.window_kind === "custom") {
      var from = ymdMonthLabel(w.window_start);
      if (!from) return "";
      return w.window_end && w.window_end === firmToday() ? "Since " + from : from + " to " + (ymdMonthLabel(w.window_end) || w.window_end);
    }
    if (w && typeof w === "object" && w.window_kind) return pullWindowLabel(w.window_kind);
    if (w && typeof w === "object" && w.start && w.end) return w.start + " to " + w.end;
    if (w && typeof w === "object" && w.kind) return pullWindowLabel(w.kind);
    return "";
  }

  // Plain-language line for one gl_review_rules row.
  function ruleLabel(r) {
    if (!r) return "";
    var acct = clean(r.account_name) || (r.account_qbo_id ? "account " + r.account_qbo_id : "");
    var type = (C.TYPES[r.flag_type] && C.TYPES[r.flag_type].label) || r.flag_type || "";
    if (r.kind === "stop_flagging") {
      var target = clean(r.match_name) ? '"' + clean(r.match_name) + '"' : acct;
      return "Don't flag " + target + " for " + (type ? '"' + type + '"' : "this check");
    }
    if (r.kind === "pass_through") return (acct || "This account") + " is a pass-through account (left out of the checks and the year comparison)";
    if (r.kind === "account_type_override") return (acct || "This account") + " is treated as " + (r.account_type_override || "another type");
    if (r.kind === "threshold") return "Custom threshold for " + (type ? '"' + type + '"' : "a check");
    return r.kind;
  }

  // Review a file: in-page edits -> rule rows GLR_rules understands.
  // edits: { passThrough: {acctName: true|false}, types: {acctName: 'Expense'} }
  // true = an active pass_through rule; false = a dismissed one (turns off the
  // name-based suggestion). Nothing here is saved.
  function fileRules(edits) {
    var e = edits || {};
    var out = [];
    Object.keys(e.passThrough || {}).forEach(function (name) {
      out.push({ id: "file-pt-" + name, kind: "pass_through", status: e.passThrough[name] ? "active" : "dismissed", account_name: name });
    });
    Object.keys(e.types || {}).forEach(function (name) {
      if (!e.types[name]) return;
      out.push({ id: "file-type-" + name, kind: "account_type_override", status: "active", account_name: name, account_type_override: e.types[name] });
    });
    return out;
  }

  // holdingTotals() rows -> { uncategorized: {count,total}, ask: {count,total} }.
  // "Ask My Accountant" / "Ask Client" accounts count as ask; the rest
  // (Uncategorized Income/Expense, Suspense) as uncategorized.
  function holdingSplit(holding) {
    var out = { uncategorized: { count: 0, total: 0 }, ask: { count: 0, total: 0 } };
    (holding || []).forEach(function (h) {
      var b = /\bask\b/i.test(String(h.acct || "")) ? out.ask : out.uncategorized;
      b.count += h.count || 0;
      b.total = Math.round((b.total + (h.total || 0)) * 100) / 100;
    });
    return out;
  }

  // gl_review_signoffs row -> { key, label, detail }.
  function signoffSummary(row) {
    if (!row || !row.status || row.status === "in_review") {
      return { key: "none", label: "Not reviewed yet", detail: "" };
    }
    if (row.status === "reviewed") {
      return { key: "reviewed", label: "Waiting for admin approval", detail: "Reviewed by " + who(row.reviewed_by) };
    }
    if (row.status === "approved") {
      var same = String(row.reviewed_by || "").toLowerCase() === String(row.approved_by || "").toLowerCase();
      return {
        key: "approved",
        label: "Approved",
        detail: "Reviewed by " + who(row.reviewed_by) + " · Approved by " + who(row.approved_by) + (same ? " (same person)" : ""),
      };
    }
    if (row.status === "sent_back") {
      return { key: "sent_back", label: "Sent back", detail: (row.sent_back_by ? who(row.sent_back_by) + ": " : "") + clean(row.sent_back_note) };
    }
    return { key: row.status, label: row.status, detail: "" };
  }

  // Bars for a month series [[ym, net], ...] in a w x h box. Heights use the
  // absolute size; negative months are marked so the chart can say so.
  function chartBars(series, w, h, opts) {
    var o = opts || {};
    var gap = o.gap != null ? o.gap : 4;
    var list = series || [];
    var n = list.length;
    if (!n) return { bars: [], max: 0, avgY: null };
    var vals = list.map(function (p) { return Math.abs(Number(p[1]) || 0); });
    var max = Math.max.apply(null, vals.concat([Math.abs(Number(o.avg) || 0)]));
    var bw = Math.max(1, (w - gap * (n - 1)) / n);
    var scale = max > 0 ? h / max : 0;
    var bars = list.map(function (p, i) {
      var v = Number(p[1]) || 0;
      var bh = Math.abs(v) * scale;
      return { ym: p[0], value: v, neg: v < 0, x: i * (bw + gap), y: h - bh, w: bw, h: bh, current: p[0] === o.current };
    });
    var avgY = o.avg != null && max > 0 ? h - Math.abs(Number(o.avg)) * scale : null;
    return { bars: bars, max: max, avgY: avgY };
  }

  return {
    firmDate: firmDate,
    CUSTOM_SAVE_TYPES: CUSTOM_SAVE_TYPES,
    rowsForWindow: rowsForWindow,
    lastCompleteMonth: lastCompleteMonth,
    monthOptions: monthOptions,
    toPeriod: toPeriod,
    ymOf: ymOf,
    makeMemoryCache: makeMemoryCache,
    attachRun: attachRun,
    viewFlags: viewFlags,
    tabCounts: tabCounts,
    typeCounts: typeCounts,
    openSince: openSince,
    isAskable: isAskable,
    defaultQuestion: defaultQuestion,
    CLEAR_REASONS: CLEAR_REASONS,
    clearReasonLabel: clearReasonLabel,
    STATUS_LABEL: STATUS_LABEL,
    toTsv: toTsv,
    flagsToTsv: flagsToTsv,
    compareToTsv: compareToTsv,
    compareStatusLabel: compareStatusLabel,
    chunk: chunk,
    pullWindowLabel: pullWindowLabel,
    coveredLabel: coveredLabel,
    pullFromOptions: pullFromOptions,
    pullWindowFrom: pullWindowFrom,
    firmToday: firmToday,
    ruleLabel: ruleLabel,
    fileRules: fileRules,
    holdingSplit: holdingSplit,
    signoffSummary: signoffSummary,
    chartBars: chartBars,
    who: who,
  };
});
