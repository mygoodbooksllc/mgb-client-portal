// ----------------------------------------------------------------------------
// GLR_config: thresholds, regexes, flag types and account-type helpers for
// Ledger review (docs/gl-review-spec.md sections 7 and 8). Pure: no React, no
// DOM, no Supabase.
//
// Loads in the browser as a plain script (window.GLR_config) and in Node via
// require() (module.exports), so tests/ledger/*.test.js run with `node --test`.
// Every other GLR_ file reads its constants from here; tune numbers here only.
// ----------------------------------------------------------------------------
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module && module.exports) module.exports = api;
  else root.GLR_config = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  // Bump when a check, threshold or regex changes, so gl_review_mark_fixed
  // never mass-"fixes" flags produced by older check code (spec 4.1).
  var CHECKS_VERSION = 1;

  // ---- Flag types. severity is the gl_review_flags.severity value.
  // side: which line of a two-sided transaction represents the flag after
  // dedupe ("bank" = the bank side, otherwise the category side).
  // key: "txn" = '<txn_type>:<qbo_id>' (or the file/synthetic key);
  // "chk" / "neg" / "acct" / "month" are the made-up keys of spec 4.1.
  var TYPES = {
    suspense: { label: "Suspense / uncategorized", severity: "high", side: "category", key: "txn" },
    obe: { label: "Opening balance equity", severity: "high", side: "category", key: "txn" },
    dup: { label: "Possible duplicate", severity: "high", side: "category", key: "txn" },
    negbank: { label: "Negative bank balance", severity: "high", side: "bank", key: "neg" },
    jecash: { label: "Manual JE to cash", severity: "medium", side: "bank", key: "txn" },
    gap: { label: "Check number gap", severity: "medium", side: "bank", key: "chk" },
    large: { label: "Unusually large", severity: "medium", side: "category", key: "txn" },
    round: { label: "Round dollar", severity: "low", side: "category", key: "txn" },
    weekend: { label: "Weekend date", severity: "low", side: "category", key: "txn" },
    blank: { label: "No name or memo", severity: "low", side: "category", key: "txn" },
    // Bailley's review standard
    vendor_acct: { label: "Unusual account for this vendor", severity: "medium", side: "category", key: "txn" },
    loan_expense: { label: "Possible loan booked as income or expense", severity: "medium", side: "category", key: "txn" },
    watch_vendor: { label: "Watch-list vendor", severity: "medium", side: "category", key: "txn" },
    recon_uncleared: { label: "Not reconciled", severity: "medium", side: "bank", key: "acct" },
    // Phase 2/4, keys only (no check code yet)
    swing: { label: "Month swing", severity: "low", side: "category", key: "acct" },
    changed_after_close: { label: "Changed after close", severity: "high", side: "category", key: "month" },
  };
  var TYPE_ORDER = [
    "suspense", "obe", "dup", "negbank", "recon_uncleared", "jecash", "gap", "large",
    "loan_expense", "watch_vendor", "vendor_acct", "round", "weekend", "blank",
  ];
  var SEVERITY_RANK = { high: 0, medium: 1, low: 2 };

  // ---- Thresholds (prototype README "Checks", plus Bailley's checks)
  var T = {
    dupMinAbs: 0.01, // amount != 0
    dupSmartMinAbs: 1, // Smart duplicate mode ignores amounts under this ($)
    gapMin: 2, // a jump of 2..25 between check numbers is a gap
    gapMax: 25, // larger jumps are new check stock
    largeMinLines: 8, // per account, non-zero lines needed before "large" runs
    largeMinAbs: 500,
    largeMadK: 5, // > median + 5 x MAD
    largeMedK: 3, // and > 3 x median
    largeMadFallback: 0.25, // MAD of 0 falls back to 0.25 x median
    roundMinAbs: 1000,
    roundStep: 100,
    weekendMinAbs: 500,
    // "Recurring" = the same name + absolute amount on at least this many
    // distinct transactions. The prototype counted 6 GL lines, which is 3
    // two-sided transactions; counting transactions makes the API and file
    // paths agree.
    recurMinTxns: 3,
    // vendor_acct: a vendor with >= minTxns category-side transactions,
    // >= dominantShare of them on one account, posting to another P&L
    // account it has used at most maxOther times.
    vendorMinTxns: 4,
    vendorDominantShare: 0.75,
    vendorMaxOther: 1,
    loanMinAbs: 100,
    // Reconciliation panel: an unreconciled line older than this many days
    // before the "through" date is stale.
    reconStaleDays: 60,
  };

  // ---- Month vs. the year (prototype CMP)
  var CMP = {
    minDiff: 250,
    minPct: 0.4,
    missShare: 0.7,
    minMonths: 3,
    oneTimeShare: 0.5, // one transaction is at least half the difference
    seasonalMinMonths: 13,
    topN: 3,
  };

  // ---- Regexes
  var RX = {
    suspense: /ask my accountant|ask (the )?client|uncategori[sz]ed|suspense/i,
    obe: /opening balance equity/i,
    bankName: /checking|savings|bank|money market|petty cash|operating|\bcash\b/i,
    notBankName: /undeposited|expense|income|revenue/i,
    journal: /journal/i,
    check: /check/i,
    roundExcludeType: /payroll|deposit/i,
    weekendType: /journal|check|expense|transfer/i,
    weekendExcludeWhere: /offering|tithe|donation|contribution/i,
    passThrough: /\b(bill\.?com|bill pay|divvy|ramp)\b/i,
    loanAccount: /\b(loan|mortgage|note payable|notes payable|line of credit)\b/i,
    loanWords: /\b(loan|mortgage|line of credit|loc|principal)\b/i,
    lenderName: /\b(bank|credit union|lending|lender|loans?|mortgage|sba)\b/i,
    loanSafeAccount: /interest|fee|charge|service|dividend/i,
  };

  // ---- Starter vendor watch list for "Review a file" and tests. The real
  // list is gl_review_watch_vendors (admin-edited, seeded by migration);
  // Bailley reviews it before it ships (spec 13.5).
  var DEFAULT_WATCH_VENDORS = [
    { pattern: "netflix", category: "streaming" },
    { pattern: "hulu", category: "streaming" },
    { pattern: "spotify", category: "streaming" },
    { pattern: "disney+", category: "streaming" },
    { pattern: "liquor", category: "liquor" },
    { pattern: "wine & spirits", category: "liquor" },
    { pattern: "total wine", category: "liquor" },
    { pattern: "casino", category: "gambling" },
    { pattern: "draftkings", category: "gambling" },
    { pattern: "fanduel", category: "gambling" },
    { pattern: "venmo", category: "personal_payment" },
    { pattern: "cash app", category: "personal_payment" },
  ];

  // ---- QuickBooks account types (spec 8)
  var CLASSIFICATION_BY_TYPE = {
    "Bank": "Asset",
    "Accounts Receivable": "Asset",
    "Other Current Asset": "Asset",
    "Fixed Asset": "Asset",
    "Other Asset": "Asset",
    "Accounts Payable": "Liability",
    "Credit Card": "Liability",
    "Other Current Liability": "Liability",
    "Long Term Liability": "Liability",
    "Equity": "Equity",
    "Income": "Revenue",
    "Other Income": "Revenue",
    "Expense": "Expense",
    "Other Expense": "Expense",
    "Cost of Goods Sold": "Expense",
  };
  var ACCOUNT_TYPES = Object.keys(CLASSIFICATION_BY_TYPE);

  // QuickBooks API AccountType values sometimes arrive without spaces
  // ("OtherCurrentAsset"); map both spellings to the display form.
  var TYPE_ALIASES = {};
  ACCOUNT_TYPES.forEach(function (t) {
    TYPE_ALIASES[t.toLowerCase()] = t;
    TYPE_ALIASES[t.replace(/\s+/g, "").toLowerCase()] = t;
  });
  TYPE_ALIASES["costofgoodssold"] = "Cost of Goods Sold";

  function normalizeAccountType(t) {
    if (t == null) return null;
    var k = String(t).trim().toLowerCase();
    if (!k) return null;
    return TYPE_ALIASES[k] || TYPE_ALIASES[k.replace(/\s+/g, "")] || null;
  }

  function classificationOf(type) {
    var t = normalizeAccountType(type);
    return t ? CLASSIFICATION_BY_TYPE[t] : null;
  }

  function isPL(classification) {
    return classification === "Revenue" || classification === "Expense";
  }

  // File uploads: a name-based guess (spec 8). Returns a QuickBooks type.
  // `guessed` is true always; `fallback` true when nothing matched and the
  // account defaulted to Expense (shown to the bookkeeper as a weak guess).
  function guessAccountType(name) {
    var raw = String(name == null ? "" : name).trim();
    var m = raw.match(/^(\d{3,6})(?:[.\-]\d+)?\s+(.*)$/);
    var numFirst = m ? m[1].charAt(0) : null;
    var n = (m ? m[2] : raw).toLowerCase();
    var R = function (re) { return re.test(n); };
    var out = function (type, fallback) { return { type: type, fallback: !!fallback }; };

    if (R(/undeposited|uncategori[sz]ed asset/)) return out("Other Current Asset");
    if (R(/opening balance equity|retained earnings|net assets|\bequity\b|owner'?s? (draw|contribution|investment)/)) return out("Equity");
    if (R(/accounts receivable|\ba\/r\b/)) return out("Accounts Receivable");
    if (R(/accounts payable|\ba\/p\b/)) return out("Accounts Payable");
    if (R(/accumulated depreciation/)) return out("Fixed Asset");
    if (R(/interest expense|interest paid|loan interest|bank (service )?(charges?|fees?)/)) return out("Expense");
    if (R(/interest income|interest earned|dividend/)) return out("Other Income");
    if (R(/payroll liabilit|payroll tax(es)? payable|sales tax payable|accrued|\bpayable\b/) && !R(/note payable|notes payable|loan/)) return out("Other Current Liability");
    if (R(/\b(loan|mortgage|line of credit)\b|notes? payable/)) return out("Long Term Liability");
    if (R(/credit card|\bvisa\b|mastercard|\bamex\b|american express|discover card|charge card/)) return out("Credit Card");
    if (!numFirst && RX.passThrough.test(n)) return out("Credit Card");
    if (numFirst === "1") return out(RX.bankName.test(n) && !RX.notBankName.test(n) ? "Bank" : "Other Current Asset");
    if (numFirst === "2") return out(RX.passThrough.test(n) ? "Credit Card" : "Other Current Liability");
    if (numFirst === "3") return out("Equity");
    if (numFirst === "4") return out("Income");
    if (numFirst && numFirst >= "5") return out("Expense");
    if (RX.bankName.test(n) && !RX.notBankName.test(n)) return out("Bank");
    if (R(/income|revenue|offering|tithe|donation|contribution|\bgifts?\b|grant|\bsales\b|fundrais|tuition/)) return out("Income");
    if (R(/(equipment|furniture( (&|and) fixtures)?|vehicles?|buildings?|land|leasehold improvements)$/)) return out("Fixed Asset");
    if (R(/prepaid|inventory|other current asset/)) return out("Other Current Asset");
    return out("Expense", true);
  }

  // ---- Dates and months. Dates are 'YYYY-MM-DD' strings everywhere, so no
  // time zone can move a transaction to another day.
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July",
    "August", "September", "October", "November", "December"];
  function ym(date) { return String(date).slice(0, 7); }
  function monthIndex(ymStr) { var p = String(ymStr).split("-"); return (+p[0]) * 12 + (+p[1] - 1); }
  function ymFromIndex(i) { var y = Math.floor(i / 12), m = (i % 12) + 1; return y + "-" + (m < 10 ? "0" : "") + m; }
  function periodOf(date) { return ym(date) + "-01"; } // gl_review_flags.period
  function monthLabel(ymStr) { var i = monthIndex(ymStr); return MONTHS[i % 12] + " " + Math.floor(i / 12); }
  function monthEnd(ymStr) {
    var p = String(ymStr).split("-");
    var d = new Date(Date.UTC(+p[0], +p[1], 0));
    return ymStr.slice(0, 7) + "-" + String(d.getUTCDate()).padStart(2, "0");
  }
  function weekday(date) { var p = String(date).split("-"); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay(); }
  function dayNumber(date) { var p = String(date).split("-"); return Date.UTC(+p[0], +p[1] - 1, +p[2]) / 864e5; }

  // Integer cents, rounded half away from zero, so float noise never changes
  // a comparison or a hash.
  function toCents(amount) {
    var n = Number(amount) || 0;
    var c = Math.round(Math.abs(n) * 100);
    return n < 0 && c ? -c : c;
  }

  function money(n) {
    var v = Math.abs(Number(n) || 0);
    return (Number(n) < 0 ? "-" : "") + "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // Small, sync, non-cryptographic hash (FNV-1a 32) for file-line keys.
  function shortHash(s) {
    var h = 0x811c9dc5;
    s = String(s);
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return ("0000000" + h.toString(16)).slice(-8);
  }

  return {
    CHECKS_VERSION: CHECKS_VERSION,
    TYPES: TYPES,
    TYPE_ORDER: TYPE_ORDER,
    SEVERITY_RANK: SEVERITY_RANK,
    T: T,
    CMP: CMP,
    RX: RX,
    DEFAULT_WATCH_VENDORS: DEFAULT_WATCH_VENDORS,
    CLASSIFICATION_BY_TYPE: CLASSIFICATION_BY_TYPE,
    ACCOUNT_TYPES: ACCOUNT_TYPES,
    normalizeAccountType: normalizeAccountType,
    classificationOf: classificationOf,
    isPL: isPL,
    guessAccountType: guessAccountType,
    MONTHS: MONTHS,
    ym: ym,
    monthIndex: monthIndex,
    ymFromIndex: ymFromIndex,
    periodOf: periodOf,
    monthLabel: monthLabel,
    monthEnd: monthEnd,
    weekday: weekday,
    dayNumber: dayNumber,
    toCents: toCents,
    money: money,
    shortHash: shortHash,
  };
});
