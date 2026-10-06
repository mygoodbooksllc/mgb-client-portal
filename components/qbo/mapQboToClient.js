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

  // qbo_transactions.split_account -> the Bank page's Category. Blank means
  // "not known yet" (null); "-Split-" is QuickBooks' marker for a
  // transaction posted to several accounts.
  function categoryFor(v) {
    var s = String(v == null ? "" : v).trim();
    if (!s) return null;
    if (/^-?split-?$/i.test(s)) return "Split (several accounts)";
    return s;
  }

  function todayIso(from) {
    var d = from ? new Date(from) : new Date();
    if (isNaN(d.getTime())) d = new Date();
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
  // "Money Market"), so the sub-type carries straight through. Cards are
  // tagged kind: "card" below so nothing adds what's owed to cash.
  var BANKISH = { "Bank": true, "Credit Card": true };
  // Same list as data.js's MGB_INCOME_ACCOUNT_TYPES (not reachable from here).
  var MGB_INCOME_TYPES = { Income: true, "Other Income": true };

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

  // --- giving ----------------------------------------------------------------
  // A church's tithes and offerings, read from QuickBooks (read-only). Which
  // income accounts count as giving: the staff pick in
  // client_giving_accounts (Client details -> QuickBooks) when there is one,
  // otherwise every Income / Other Income account whose name looks like
  // giving. P&L lines carry leaf account names; transaction split accounts
  // are fully qualified ("Giving:Tithes"), so both sides compare on the leaf.
  var GIVING_NAME_RE = /\b(tithes?|offerings?|contributions?|donations?|giving|pledges?|gifts?)\b/i;
  function leafName(name) {
    return String(name == null ? "" : name).replace(/^.*:/, "").trim();
  }
  window.mgbLooksLikeGiving = function (name) {
    return GIVING_NAME_RE.test(String(name || ""));
  };
  // Every income account name known for a client, from the chart of accounts
  // and from the P&L lines (a parent's residual line can exist without a
  // matching qbo_accounts row). Sorted, de-duplicated, leaf names.
  window.mgbQboIncomeAccountNames = function (accounts, plLines) {
    var seen = {};
    (accounts || []).forEach(function (a) {
      if (a && a.name && MGB_INCOME_TYPES[a.account_type]) seen[leafName(a.name)] = true;
    });
    (plLines || []).forEach(function (l) {
      if (l && l.account_name && l.account_type === "Income") seen[leafName(l.account_name)] = true;
    });
    return Object.keys(seen).sort(function (a, b) {
      return a.toLowerCase() < b.toLowerCase() ? -1 : 1;
    });
  };
  // Only transaction types that post to an income account. Matching is on
  // the leaf name, and a company can have an expense sub-account with the
  // same leaf as an income one (the Intuit sample's "Plants and Soil"), so
  // expenses, bills and checks are never giving. Estimates, purchase orders
  // and delayed charges move no money.
  var GIVING_TXN_TYPES = {
    Deposit: true,
    "Sales Receipt": true,
    Invoice: true,
    "Credit Memo": true,
    Refund: true,
    "Journal Entry": true,
  };

  window.mgbBuildQboGiving = function (opts) {
    opts = opts || {};
    var plLines = opts.plLines || [];
    var transactions = opts.transactions || [];
    var monthKeys = (opts.monthKeys || []).slice().sort();
    var syncMonthKey = opts.syncMonthKey;
    var incomeNames = window.mgbQboIncomeAccountNames(opts.accounts, plLines);
    var setting = opts.setting || null;
    var source = setting ? "staff" : "auto";
    var chosen = setting
      ? (setting.account_names || []).map(leafName).filter(Boolean)
      : incomeNames.filter(function (n) {
          return GIVING_NAME_RE.test(n);
        });
    var isGiving = {};
    chosen.forEach(function (n) {
      isGiving[n.toLowerCase()] = true;
    });

    // Monthly totals over the synced P&L window (qbo-sync pulls 12 months:
    // this month to date plus the 11 before it).
    var byMonth = {};
    monthKeys.forEach(function (k) {
      byMonth[k] = 0;
    });
    // The sync month always gets a (month-to-date) bar, even before the P&L
    // has a column for it.
    if (syncMonthKey && !(syncMonthKey in byMonth)) byMonth[syncMonthKey] = 0;
    var byAccount = {};
    var syncYear = String(syncMonthKey || "").slice(0, 4);
    plLines.forEach(function (l) {
      if (l.account_type !== "Income") return;
      var leaf = leafName(l.account_name);
      if (!isGiving[leaf.toLowerCase()]) return;
      var day = toDay(l.month);
      if (!day) return;
      var k = day.slice(0, 7);
      var amt = toNumber(l.amount);
      byMonth[k] = (byMonth[k] || 0) + amt;
      if (!byAccount[leaf]) byAccount[leaf] = { account: leaf, ytd: 0, last12: 0, thisMonth: 0 };
      byAccount[leaf].last12 += amt;
      if (k.slice(0, 4) === syncYear) byAccount[leaf].ytd += amt;
      if (k === syncMonthKey) byAccount[leaf].thisMonth += amt;
    });
    var months = Object.keys(byMonth)
      .sort()
      .map(function (k) {
        return {
          key: k,
          month: monthLabel(k + "-01"),
          year: Number(k.slice(0, 4)) || null,
          amount: Math.round(byMonth[k] * 100) / 100,
          partial: k === syncMonthKey,
        };
      });
    var closed = months.filter(function (m) {
      return !m.partial;
    });
    var current = months.find(function (m) {
      return m.key === syncMonthKey;
    });
    var lastClosed = closed.length ? closed[closed.length - 1] : null;
    var ytdMonths = months.filter(function (m) {
      return String(m.year) === syncYear;
    });
    function sum(list) {
      return list.reduce(function (s, m) {
        return s + m.amount;
      }, 0);
    }
    var closedForAvg = closed.slice(-12);

    var recent = transactions
      .filter(function (t) {
        if (!GIVING_TXN_TYPES[t.txn_type]) return false;
        return isGiving[leafName(t.split_account).toLowerCase()];
      })
      .map(function (t) {
        return {
          date: toDay(t.txn_date),
          type: t.txn_type || "",
          name: t.name || "",
          memo: t.memo || "",
          account: leafName(t.split_account),
          amount: toNumber(t.amount),
        };
      })
      .filter(function (t) {
        return t.date;
      })
      .sort(function (a, b) {
        return a.date < b.date ? 1 : a.date > b.date ? -1 : 0;
      });

    return {
      source: source,
      accounts: chosen,
      incomeAccounts: incomeNames,
      months: months,
      thisMonth: current ? current.amount : 0,
      thisMonthKey: syncMonthKey || null,
      lastMonth: lastClosed ? lastClosed.amount : null,
      lastMonthKey: lastClosed ? lastClosed.key : null,
      ytd: Math.round(sum(ytdMonths) * 100) / 100,
      ytdFromKey: ytdMonths.length ? ytdMonths[0].key : null,
      last12: Math.round(sum(months) * 100) / 100,
      monthlyAverage: closedForAvg.length ? Math.round((sum(closedForAvg) / closedForAvg.length) * 100) / 100 : null,
      byAccount: Object.keys(byAccount)
        .map(function (k) {
          return byAccount[k];
        })
        .sort(function (a, b) {
          return b.last12 - a.last12;
        }),
      // Newest 50 for the "Recent giving" list; every synced gift (the
      // sync keeps about 90 days of transactions) for donor totals.
      recent: recent.slice(0, 50),
      gifts: recent,
      giftsFrom: recent.length ? recent[recent.length - 1].date : null,
    };
  };

  // --- funds -----------------------------------------------------------------
  // Fund balances from the QuickBooks chart of accounts (read-only). Which
  // balance-sheet accounts are funds: the staff pick in client_fund_accounts
  // (Client details -> QuickBooks -> Fund accounts), each marked restricted
  // or not; otherwise equity/asset accounts whose names contain "fund" or
  // "restricted". "Undeposited Funds" is QuickBooks' clearing account, never
  // a fund. The balance is qbo_accounts.current_balance as of the last sync.
  var FUND_NAME_RE = /\bfunds?\b|restricted/i;
  var NOT_A_FUND_RE = /undeposited/i;
  var FUND_CLASSES = { Equity: true, Asset: true };
  window.mgbLooksLikeFund = function (name) {
    var s = String(name || "");
    return FUND_NAME_RE.test(s) && !NOT_A_FUND_RE.test(s);
  };
  // "Restricted - Building Fund" and "Temporarily restricted net assets" are
  // restricted; "Unrestricted net assets" and everything else is not.
  window.mgbGuessRestricted = function (name) {
    var s = String(name || "");
    return /restricted/i.test(s) && !/unrestricted/i.test(s);
  };
  function isBalanceSheet(a) {
    if (!a) return false;
    if (a.classification) return !!FUND_CLASSES[a.classification];
    return /equity|asset|bank/i.test(String(a.account_type || ""));
  }
  // Every active equity/asset account, for the staff picker.
  window.mgbQboFundCandidates = function (accounts) {
    return (accounts || [])
      .filter(function (a) {
        return a && a.name && a.active !== false && isBalanceSheet(a);
      })
      .map(function (a) {
        return {
          name: a.name,
          accountType: a.account_type || "",
          classification: a.classification || "",
          balance: toNumber(a.current_balance),
        };
      })
      .sort(function (x, y) {
        return x.name.toLowerCase() < y.name.toLowerCase() ? -1 : 1;
      });
  };
  window.mgbBuildQboFunds = function (opts) {
    opts = opts || {};
    var candidates = window.mgbQboFundCandidates(opts.accounts);
    var balanceByName = {};
    (opts.accounts || []).forEach(function (a) {
      if (a && a.name) balanceByName[a.name] = toNumber(a.current_balance);
    });
    var setting = opts.setting || null;
    var picks = setting && Array.isArray(setting.accounts) ? setting.accounts : null;
    var funds = picks
      ? picks
          .filter(function (p) {
            return p && p.name;
          })
          .map(function (p) {
            return {
              name: String(p.name),
              balance: balanceByName[p.name] || 0,
              restricted: typeof p.restricted === "boolean" ? p.restricted : window.mgbGuessRestricted(p.name),
              // A picked account that no longer syncs (renamed or deleted
              // in QuickBooks) shows $0 and is flagged for staff.
              missing: !(p.name in balanceByName),
            };
          })
      : candidates
          .filter(function (c) {
            return window.mgbLooksLikeFund(c.name);
          })
          .map(function (c) {
            return { name: c.name, balance: c.balance, restricted: window.mgbGuessRestricted(c.name), missing: false };
          });
    var restricted = 0;
    var unrestricted = 0;
    funds.forEach(function (f) {
      if (f.restricted) restricted += f.balance;
      else unrestricted += f.balance;
    });
    return {
      source: picks ? "staff" : "auto",
      funds: funds,
      candidates: candidates,
      restrictedTotal: Math.round(restricted * 100) / 100,
      unrestrictedTotal: Math.round(unrestricted * 100) / 100,
    };
  };

  window.mapQboToClient = function mapQboToClient(client, rows) {
    rows = rows || {};
    var accounts = rows.accounts || [];
    var monthlyPl = rows.monthlyPl || [];
    var budgetLines = rows.budgetLines || [];
    var plLines = rows.plLines || [];
    var invoices = rows.invoices || [];
    var bills = rows.bills || [];
    var transactions = rows.transactions || [];
    var connection = rows.connection || null;
    // "This month" is the month of the last sync, not the browser's month.
    // A client last synced on Sep 28 and opened on Oct 2 still has
    // September as its newest (partial) month; keying off the browser date
    // would show an empty October budget and call September closed.
    var today = todayIso(connection && connection.last_synced_at);
    var syncMonthKey = today.slice(0, 7);

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
          // A Credit Card account's current_balance is the amount OWED
          // (positive when there's a balance due). `kind` keeps it out of
          // cash on hand — see window.mgbIsCardAccount in data.js.
          kind: a.account_type === "Credit Card" ? "card" : "cash",
          balance: toNumber(a.current_balance),
          transactions: [],
        };
      })
      .sort(function (x, y) {
        // Cash accounts first, then cards; biggest balance first within each.
        if (x.kind !== y.kind) return x.kind === "cash" ? -1 : 1;
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
        // Category is the posting ("split") account QuickBooks booked the
        // other side to (qbo_transactions.split_account). null until a
        // qbo-sync build that saves it has run for this client; pages then
        // fall back to the type (t.category || t.type || "Uncategorized").
        // A multi-line transaction reports "-Split-".
        category: categoryFor(t.split_account),
        // The transaction type ("Deposit", "Expense"), kept separately.
        type: t.txn_type || null,
        // Stable key for this QuickBooks transaction (the table's primary
        // key minus client_id), used by transaction questions.
        txnKey: t.qbo_id ? String(t.txn_type || "") + ":" + String(t.qbo_id) : null,
        // Everywhere in the app a negative amount is money out (sample data,
        // bank registers). On a credit card register QuickBooks reports a
        // charge as positive (the balance owed went up) and a payment or
        // credit as negative, so a charge showed as green "+" money in.
        // Flip card rows to match.
        amount: acct.kind === "card" ? 0 - toNumber(t.amount) : toNumber(t.amount),
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
        var key = String(r.month || "").slice(0, 7);
        return {
          month: monthLabel(r.month),
          // "2026-09" and 2026: month labels alone repeat across a year
          // boundary ("Oct" last year vs this year) in 12-month views.
          key: key,
          year: Number(key.slice(0, 4)) || null,
          // qbo-sync's P&L window ends today, so the sync month's row is
          // month to date. Every average, projection and "last month"
          // figure leaves it out (window.mgbClosedMonths in data.js).
          partial: key === syncMonthKey,
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
    //
    // qbo-sync pulls EVERY Budget line, income included (a church budgets
    // its giving), and qbo_budget_lines has no account type. Every budget
    // view in the app is a spending view ("over budget" = spent too much),
    // so the type is joined back in from qbo_accounts (or, failing a name
    // match, from which side of the P&L the name appeared on) and income
    // lines go to budgetIncome instead of budget.
    var currentMonth = syncMonthKey + "-01";
    var typeByName = {};
    accounts.forEach(function (a) {
      if (a.name && a.account_type) typeByName[a.name] = a.account_type;
    });
    var plTypeByName = {};
    plLines.forEach(function (l) {
      if (!l.account_name) return;
      // Expense wins when a name shows up on both sides, same as qbo-sync.
      if (plTypeByName[l.account_name] !== "Expense") {
        plTypeByName[l.account_name] = l.account_type;
      }
    });
    function accountTypeFor(name) {
      var tail = String(name).replace(/^.*:/, "");
      return typeByName[name] || typeByName[tail] || plTypeByName[name] || null;
    }
    function budgetRowsFor(month) {
      var byAccount = {};
      var order = [];
      budgetLines.forEach(function (b) {
        if (toDay(b.month) !== month) return;
        var name = b.account_name || "Uncategorized";
        if (!byAccount[name]) {
          byAccount[name] = {
            category: name,
            budgeted: 0,
            actual: 0,
            accountType: accountTypeFor(name),
          };
          order.push(name);
        }
        byAccount[name].budgeted += toNumber(b.budgeted);
        byAccount[name].actual += toNumber(b.actual);
      });
      return order.map(function (name) {
        return byAccount[name];
      });
    }
    var prevDate = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 2, 1));
    var prevMonth = prevDate.toISOString().slice(0, 10);
    var allBudget = budgetRowsFor(currentMonth);
    var budget = window.mgbExpenseBudget(allBudget);
    var budgetIncome = allBudget.filter(function (b) {
      return budget.indexOf(b) === -1;
    });
    // The last CLOSED month's expense budget vs. actual, for reports that
    // default to a closed month (the board packet) rather than month to date.
    var budgetPrev = window.mgbExpenseBudget(budgetRowsFor(prevMonth));

    // --- expenseByAccount --------------------------------------------------
    // qbo_pl_lines (written by qbo-sync from the same monthly ProfitAndLoss
    // report that feeds qbo_monthly_pl) holds one row per month per account.
    // The Live Report's "Where the money went" card needs this month's
    // expenses by account whether or not the company has a QuickBooks budget,
    // so expose the current and previous month here, biggest first. Refunds
    // can leave an account net negative; those aren't "where money went" and
    // are dropped.
    function expensesFor(month) {
      var byName = {};
      plLines.forEach(function (l) {
        if (l.account_type !== "Expense" || toDay(l.month) !== month) return;
        var name = l.account_name || "Uncategorized";
        byName[name] = (byName[name] || 0) + toNumber(l.amount);
      });
      return Object.keys(byName)
        .map(function (name) {
          return { account: name, amount: byName[name] };
        })
        .filter(function (r) {
          return r.amount > 0;
        })
        .sort(function (a, b) {
          return b.amount - a.amount;
        });
    }
    var expenseByAccount = expensesFor(currentMonth);
    var expenseByAccountPrev = expensesFor(prevMonth);

    // --- categoryMonthly ---------------------------------------------------
    // Every month, every income/expense account: actual (qbo_pl_lines) next
    // to budgeted (qbo_budget_lines). Custom dashboard cards
    // (components/daily-close/CustomCards.tsx) pick a few categories and a
    // window of months out of this; nothing else reads it. Actuals come from
    // the P&L lines rather than the budget lines' own `actual`, which only
    // exist for accounts that have a budget.
    var catByKey = {};
    var categoryMonthly = [];
    function catRow(monthKey, name, type) {
      var k = monthKey + "|" + name;
      if (!catByKey[k]) {
        catByKey[k] = { month: monthKey, category: name, type: type, actual: 0, budgeted: null };
        categoryMonthly.push(catByKey[k]);
      }
      return catByKey[k];
    }
    plLines.forEach(function (l) {
      var day = toDay(l.month);
      if (!day || (l.account_type !== "Expense" && l.account_type !== "Income")) return;
      var row = catRow(day.slice(0, 7), l.account_name || "Uncategorized", l.account_type === "Income" ? "income" : "expense");
      row.actual += toNumber(l.amount);
    });
    budgetLines.forEach(function (b) {
      var day = toDay(b.month);
      if (!day) return;
      var name = b.account_name || "Uncategorized";
      var t = accountTypeFor(name);
      var row = catRow(day.slice(0, 7), name, t && MGB_INCOME_TYPES[t] ? "income" : "expense");
      row.budgeted = (row.budgeted || 0) + toNumber(b.budgeted);
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
        // doc_number is QuickBooks' own invoice number (qbo-sync v11+);
        // older rows have none, and no number is shown rather than the
        // internal id, which means nothing to the client.
        var docNumber = inv.doc_number ? String(inv.doc_number) : null;
        return {
          id: "inv:" + inv.qbo_id,
          description: inv.customer_name || (docNumber ? "Invoice #" + docNumber : "Invoice"),
          docNumber: docNumber,
          issueDate: toDay(inv.txn_date),
          amount: toNumber(inv.balance),
          dueDate: due,
          // The Collections Queue drafts one reminder per customer, addressed
          // to that customer (qbo-sync v10+; older rows have neither).
          customerId: inv.customer_id || null,
          customerName: inv.customer_name || null,
          customerEmail: inv.customer_email || null,
          invoiceId: inv.qbo_id,
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
        var docNumber = b.doc_number ? String(b.doc_number) : null;
        var issued = toDay(b.txn_date);
        return {
          id: "bill:" + b.qbo_id,
          vendor: b.vendor_name || "Vendor",
          // The vendor's bill number when QuickBooks has one; otherwise the
          // bill date, never the internal QuickBooks id.
          description: docNumber ? "Bill #" + docNumber : issued ? "Bill dated " + issued : "Bill",
          docNumber: docNumber,
          issueDate: issued,
          amount: toNumber(b.balance),
          dueDate: due,
        };
      })
      .filter(Boolean)
      .sort(function (a, b) {
        return a.dueDate < b.dueDate ? -1 : 1;
      });

    var fundsQbo = window.mgbBuildQboFunds({
      accounts: accounts,
      setting: (rows.fundSettings || [])[0] || null,
    });

    // Object.assign over the existing client keeps everything QuickBooks has
    // no opinion about — the roster fields, the users roster, threads,
    // documents — exactly as it was. Only the financial arrays are
    // replaced, and only with what actually came back.
    return Object.assign({}, client, {
      bankAccounts: bankAccounts,
      monthly: monthly,
      budget: budget,
      budgetIncome: budgetIncome,
      budgetPrev: budgetPrev,
      expenseByAccount: expenseByAccount,
      expenseByAccountPrev: expenseByAccountPrev,
      categoryMonthly: categoryMonthly,
      receivables: receivables,
      payables: payables,
      // Nothing syncs the rest yet (no donor, payroll, reconciliation or
      // document feed). A roster client whose id matches a data.js sample
      // would otherwise show the sample's funds, donors, Gusto payroll and
      // files next to real QuickBooks numbers. Pages show a "not connected
      // yet" state for a QuickBooks client with none.
      // Fund balances from the picked (or auto-detected) QuickBooks
      // accounts, same { name, balance, restricted } shape as data.js, so
      // the Funds page, dashboard cards and reports read them unchanged.
      funds: fundsQbo.funds.map(function (f) {
        return { name: f.name, balance: f.balance, restricted: f.restricted };
      }),
      fundsQbo: fundsQbo,
      contributions: [],
      pledges: [],
      donors: [],
      fundTransfers: [],
      payroll: null,
      bankReconciliations: [],
      documents: [],
      // Tithes and offerings from the QuickBooks P&L (see mgbBuildQboGiving
      // above). funds/contributions stay empty: those are per-gift donor
      // records QuickBooks doesn't hold.
      givingQbo: window.mgbBuildQboGiving({
        accounts: accounts,
        plLines: plLines,
        transactions: transactions,
        monthKeys: monthly.map(function (m) {
          return m.key;
        }),
        syncMonthKey: syncMonthKey,
        setting: (rows.givingSettings || [])[0] || null,
      }),
      dataSource: "quickbooks",
      lastSyncedAt: (connection && connection.last_synced_at) || null,
    });
  };
})();
