// Small builder for API-shaped ledgers (spec 2.6 lines) used by the tests.
"use strict";
const P = require("../../../components/ledger/GLR_parse.js");

const ACCTS = {
  CK: { acct: "1010 Operating Checking", acct_id: "35", acct_type: "Bank" },
  SAV: { acct: "1020 Savings", acct_id: "36", acct_type: "Bank" },
  CARD: { acct: "2100 Church Visa", acct_id: "60", acct_type: "Credit Card" },
  LOAN: { acct: "2700 Building Loan", acct_id: "70", acct_type: "Long Term Liability" },
  BILL: { acct: "2050 Bill.com Money Out Clearing", acct_id: "52", acct_type: "Other Current Liability" },
  APC: { acct: "2060 AP Clearing", acct_id: "53", acct_type: "Other Current Liability" },
  OBE: { acct: "3000 Opening Balance Equity", acct_id: "90", acct_type: "Equity" },
  TITHE: { acct: "4010 Tithes & Offerings", acct_id: "100", acct_type: "Income" },
  LOANINC: { acct: "4900 Other Income", acct_id: "101", acct_type: "Other Income" },
  SUP: { acct: "6620 Ministry Supplies", acct_id: "200", acct_type: "Expense" },
  OFF: { acct: "6630 Office Supplies", acct_id: "201", acct_type: "Expense" },
  UTIL: { acct: "6510 Utilities", acct_id: "202", acct_type: "Expense" },
  REP: { acct: "6520 Building Repairs", acct_id: "203", acct_type: "Expense" },
  INT: { acct: "6900 Interest Expense", acct_id: "204", acct_type: "Expense" },
  AMA: { acct: "Ask My Accountant", acct_id: "205", acct_type: "Expense" },
  UNC: { acct: "Uncategorized Expense", acct_id: "206", acct_type: "Expense" },
};

function ledger() {
  let n = 0;
  const raw = [];
  // legs: [[ACCT, amount, extra?], ...]; the first leg names the "split" of the others.
  function txn(date, type, name, memo, legs, opts = {}) {
    const id = opts.id || String(++n);
    const key = type.replace(/\s+/g, "") + ":" + id;
    legs.forEach(([a, amt, extra], i) => {
      const other = legs.length === 2 ? legs[1 - i][0].acct : "-Split-";
      raw.push(Object.assign({
        key, line: key + ":" + i, date, type, num: opts.num || "", name, name_id: name ? "v:" + name.toLowerCase() : null,
        memo, split: other, amt, acct: a.acct, acct_id: a.acct_id, acct_type: a.acct_type, cls: opts.cls || "", loc: opts.loc || "",
        cleared: (extra && extra.cleared) || "",
      }, extra || {}));
    });
    return key;
  }
  // A simple expense paid from a bank or card: category +amt, bank -amt.
  function pay(date, name, memo, cat, amt, from = ACCTS.CK, opts = {}) {
    return txn(date, opts.type || "Expense", name, memo, [[cat, amt, opts.catExtra], [from, -amt, opts.bankExtra]], opts);
  }
  return { txn, pay, raw, lines: () => P.normalizeApiLines(raw) };
}

module.exports = { ACCTS, ledger };
