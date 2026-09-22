// Turns the qbo_* rows fetched in index.html's loadQboData() into the exact
// client shape data.js documents and app.jsx consumes — same field names,
// same types, same nesting. Nothing downstream knows or cares whether a
// number came from QuickBooks or from CLIENTS_MOCK_DATA; the ONLY difference
// a page can see is `dataSource === "quickbooks"`, which is what gates the
// sample-data banners and the Live pill.
//
// Pure and synchronous on purpose: no fetching, no Supabase, no React. That
// keeps it testable from plain node (components/qbo/mapQboToClient.test.js)
// without a browser or a database, and it means the boot sequence can call
// it between the roster merge and app.jsx with no await of its own.
//
// Returns a NEW object — never mutates the client passed in — so a failed or
// partial QBO load can simply not call this and leave the sample data alone.

(function () {
  // data.js's monthly[].month is a three-letter label ("Sep"), not a date.
  var MONTH_ABBR = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];

  // Parsed as UTC, deliberately. A "2026-09-01" month key run through
  // `new Date(...)` in a negative-offset time zone lands on Aug 31 local and
  // the chart silently shows the wrong month name.
  function monthLabel(isoDate) {
    var m = /^(\d{4})-(\d{2})/.exec(String(isoDate || ""));
    if (!m) return "";
    return MONTH_ABBR[Number(m[2]) - 1] || "";
  }

  function toNumber(v) {
    var n = typeof v === "number" ? v : parseFloat(v);
    return isFinite(n) ? n : 0;
  }

  // Every date app.jsx renders goes through fmtDate/daysUntil, which append
  // "T00:00:00" to a bare YYYY-MM-DD. Anything else (a null, a full
  // timestamp) produces an Invalid Date in a financial table, so normalize
  // here and let the caller drop rows that have nothing usable.
  function toDay(v) {
    if (!v) return null;
    var s = String(v);
    return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
  }

  function todayIso() {
    var d = new Date();
    return (
      d.getFullYear() +
      "-" +
      String(d.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(d.getDate()).padStart(2, "0")
    );
  }

  // Which QuickBooks accounts are "bank accounts" as far as the Bank page is
  // concerned. Credit cards are included because the page is really "money
  // you hold and money you owe on a card" — a church's ministry card belongs
  // on it — and data.js's `type` field is free text ("Checking", "Savings",
  // "Money Market"), so the sub-type carries straight through.
  var BANKISH = { "Bank": true, "Credit Card": true };

  function prettyType(account) {
    var sub = account.account_sub_type || "";
    if (sub) {
      // Intuit's sub-types are PascalCase with no spaces ("MoneyMarket",
      // "SavingsAccount"); data.js's are spaced title case.
      var spaced = sub.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
      return spaced;
    }
    return account.account_type || "Account";
  }

  // data.js's accountMask is the last four of the account number, shown as
  // "Account ending 1204". QuickBooks' Account entity does carry AcctNum, but
  // only when the company has account numbers switched on, and qbo_accounts
  // does not store it today (see the known-gaps note in HANDOFF7 §170). The
  // best honest fallback is a trailing number already in the account's name
  // ("Operating Checking 1204"); failing that, no mask at all rather than a
  // made-up one.
  function maskFor(account) {
    var m = /(\d{4})\D*$/.exec(String(account.name || ""));
    return m ? m[1] : "";
  }

  window.mapQboToClient = function mapQboToClient(client, rows) {
    rows = rows || {};
    var accounts = rows.accounts || [];
    var monthlyPl = rows.monthlyPl || [];
    var budgetLines = rows.budgetLines || [];
    var invoices = rows.invoices || [];
    var bills = rows.bills || [];
    var transactions = rows.transactions || [];
    var connection = rows.connection || null;
    var today = todayIso();

    // --- bankAccounts ------------------------------------------------------
    var bankAccounts = accounts
      .filter(function (a) {
        return BANKISH[a.account_type] && a.active !== false;
      })
      .map(function (a) {
        return {
          id: String(a.qbo_id),
          accountName: a.name || "Account",
          accountMask: maskFor(a),
          type: prettyType(a),
          balance: toNumber(a.current_balance),
          transactions: [],
        };
      })
      .sort(function (x, y) {
        return y.balance - x.balance;
      });

    // --- transactions, hung off the account they belong to ------------------
    // BankTransactionsPanel reads client.bankAccounts[].transactions, so the
    // TransactionList rows are grouped onto their register account by name.
    // A row whose account isn't one of the bank/credit-card accounts above
    // (an expense-account split line, say) is genuinely not bank activity and
    // is left out rather than dumped onto an arbitrary account.
    var byName = {};
    bankAccounts.forEach(function (acct) {
      byName[acct.accountName] = acct;
    });
    transactions.forEach(function (t) {
      var acct = byName[t.account_name];
      if (!acct) return;
      var date = toDay(t.txn_date);
      if (!date) return;
      acct.transactions.push({
        date: date,
        // memo first: it's what the bookkeeper actually typed. The payee
        // name is the fallback, and the transaction type is the last resort
        // so a row is never a blank description.
        description: t.memo || t.name || t.txn_type || "Transaction",
        // data.js's `category` is a budget category; QuickBooks' nearest
        // honest equivalent on a register row is the transaction type.
        category: t.txn_type || "Uncategorized",
        amount: toNumber(t.amount),
      });
    });
    bankAccounts.forEach(function (acct) {
      acct.transactions.sort(function (a, b) {
        return a.date < b.date ? 1 : a.date > b.date ? -1 : 0;
      });
    });

    // --- monthly -----------------------------------------------------------
    var monthly = monthlyPl
      .slice()
      .sort(function (a, b) {
        return String(a.month) < String(b.month) ? -1 : 1;
      })
      .map(function (r) {
        return {
          month: monthLabel(r.month),
          income: toNumber(r.revenue),
          expenses: toNumber(r.expenses),
        };
      })
      .filter(function (r) {
        return r.month;
      });

    // --- budget ------------------------------------------------------------
    // qbo_budget_lines is per month; the Budget page is a single
    // this-month-vs-budget view, so collapse to the current month, one row
    // per account. A client with no QuickBooks budget set up gets an empty
    // array — never the sample budget, which would be a lie sitting next to
    // real numbers.
    var currentMonth = today.slice(0, 7) + "-01";
    var budgetByAccount = {};
    var budgetOrder = [];
    budgetLines.forEach(function (b) {
      if (toDay(b.month) !== currentMonth) return;
      var name = b.account_name || "Uncategorized";
      if (!budgetByAccount[name]) {
        budgetByAccount[name] = { category: name, budgeted: 0, actual: 0 };
        budgetOrder.push(name);
      }
      budgetByAccount[name].budgeted += toNumber(b.budgeted);
      budgetByAccount[name].actual += toNumber(b.actual);
    });
    var budget = budgetOrder.map(function (name) {
      return budgetByAccount[name];
    });

    // --- receivables / payables --------------------------------------------
    // Shapes are data.js's exactly. The "overdue logic" everywhere in app.jsx
    // is daysUntil(dueDate, today) < 0 — there is no separate overdue flag —
    // so what matters is that dueDate is always a bare YYYY-MM-DD. An invoice
    // with no due date falls back to its transaction date (QuickBooks treats
    // a due-date-less invoice as due on issue), and one with neither is
    // dropped rather than rendered as "Invalid Date".
    var receivables = invoices
      .map(function (inv) {
        var due = toDay(inv.due_date) || toDay(inv.txn_date);
        if (!due) return null;
        return {
          description: inv.customer_name || "Invoice " + inv.qbo_id,
          amount: toNumber(inv.balance),
          dueDate: due,
        };
      })
      .filter(Boolean)
      .sort(function (a, b) {
        return a.dueDate < b.dueDate ? -1 : 1;
      });

    var payables = bills
      .map(function (b) {
        var due = toDay(b.due_date) || toDay(b.txn_date);
        if (!due) return null;
        return {
          vendor: b.vendor_name || "Vendor",
          description: "Bill #" + b.qbo_id,
          amount: toNumber(b.balance),
          dueDate: due,
        };
      })
      .filter(Boolean)
      .sort(function (a, b) {
        return a.dueDate < b.dueDate ? -1 : 1;
      });

    // Object.assign over the existing client keeps everything QuickBooks has
    // no opinion about — the roster fields, the users roster, threads,
    // documents — exactly as it was. Only the six financial arrays are
    // replaced, and only with what actually came back.
    return Object.assign({}, client, {
      bankAccounts: bankAccounts,
      monthly: monthly,
      budget: budget,
      receivables: receivables,
      payables: payables,
      dataSource: "quickbooks",
      lastSyncedAt: (connection && connection.last_synced_at) || null,
    });
  };
})();
