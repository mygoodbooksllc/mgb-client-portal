// node --test tests/edge/*.test.mjs
// supabase/functions/qbo-sync/recent_activity.ts: recent register activity
// from the QuickBooks Query API (replaces the TransactionList report Intuit
// refuses since 2026-10-31). Same row shape, labels and signs as the report.
import test from "node:test";
import assert from "node:assert/strict";
import * as R from "../../supabase/functions/qbo-sync/recent_activity.ts";

const ACCOUNTS = [
  { Id: "1", Name: "Checking", FullyQualifiedName: "Checking", AccountType: "Bank" },
  { Id: "2", Name: "Visa", FullyQualifiedName: "Visa", AccountType: "Credit Card" },
  { Id: "3", Name: "Jane", FullyQualifiedName: "Visa:Jane", AccountType: "Credit Card" },
  { Id: "4", Name: "Office", FullyQualifiedName: "Expenses:Office", AccountType: "Expense" },
  { Id: "5", Name: "Rent", FullyQualifiedName: "Rent", AccountType: "Expense" },
  { Id: "6", Name: "Undeposited Funds", FullyQualifiedName: "Undeposited Funds", AccountType: "Other Current Asset", AccountSubType: "UndepositedFunds" },
  { Id: "7", Name: "Accounts Receivable (A/R)", FullyQualifiedName: "Accounts Receivable (A/R)", AccountType: "Accounts Receivable" },
  { Id: "8", Name: "Accounts Payable (A/P)", FullyQualifiedName: "Accounts Payable (A/P)", AccountType: "Accounts Payable" },
  { Id: "9", Name: "Donations", FullyQualifiedName: "Income:Donations", AccountType: "Income" },
  { Id: "10", Name: "Services", FullyQualifiedName: "Services", AccountType: "Income" },
];
const ctx = () => R.buildRecentCtx(ACCOUNTS);
const exp = (acct, amt) => ({ DetailType: "AccountBasedExpenseLineDetail", Amount: amt, AccountBasedExpenseLineDetail: { AccountRef: { value: acct } } });

test("query: TxnDate window, Id order, 1000-row pages, rejects bad input", () => {
  assert.equal(
    R.recentQuery("Purchase", "2026-08-02", "2026-10-31", 1001),
    "select * from Purchase where TxnDate >= '2026-08-02' and TxnDate <= '2026-10-31' orderby Id startposition 1001 maxresults 1000",
  );
  assert.throws(() => R.recentQuery("Account; drop", "2026-08-02", "2026-10-31", 1));
  assert.throws(() => R.recentQuery("Purchase", "2026-08-02' or 1=1", "2026-10-31", 1));
});

test("Purchase: bank expense negative, card expense positive, card credit negative, sub-account by full name", () => {
  const c = ctx();
  const bank = R.mapRecentTxn("Purchase", { Id: "11", TxnDate: "2026-10-01", PaymentType: "Cash", AccountRef: { value: "1", name: "Checking" }, TotalAmt: 50, EntityRef: { name: "Staples" }, PrivateNote: "paper", Line: [exp("4", 50)] }, c);
  assert.deepEqual(bank, { qbo_id: "11", txn_type: "Expense", txn_date: "2026-10-01", account_name: "Checking", split_account: "Expenses:Office", name: "Staples", memo: "paper", amount: -50 });
  const card = R.mapRecentTxn("Purchase", { Id: "12", TxnDate: "2026-10-02", PaymentType: "CreditCard", AccountRef: { value: "3", name: "Jane" }, TotalAmt: 20, Line: [exp("4", 20)] }, c);
  assert.equal(card.txn_type, "Expense");
  assert.equal(card.account_name, "Visa:Jane");
  assert.equal(card.amount, 20);
  const credit = R.mapRecentTxn("Purchase", { Id: "13", TxnDate: "2026-10-03", PaymentType: "CreditCard", Credit: true, AccountRef: { value: "2" }, TotalAmt: 5, Line: [exp("4", 5)] }, c);
  assert.equal(credit.txn_type, "Credit Card Credit");
  assert.equal(credit.amount, -5);
  const check = R.mapRecentTxn("Purchase", { Id: "14", TxnDate: "2026-10-03", PaymentType: "Check", AccountRef: { value: "1" }, TotalAmt: 900, Line: [exp("5", 900)] }, c);
  assert.equal(check.txn_type, "Check");
  assert.equal(check.amount, -900);
  assert.equal(check.split_account, "Rent");
});

test("split: one account by name, several accounts or tax -> -Split-", () => {
  const c = ctx();
  const two = R.mapRecentTxn("Purchase", { Id: "15", TxnDate: "2026-10-04", PaymentType: "Cash", AccountRef: { value: "1" }, TotalAmt: 30, Line: [exp("4", 10), exp("5", 20)] }, c);
  assert.equal(two.split_account, "-Split-");
  const same = R.mapRecentTxn("Purchase", { Id: "16", TxnDate: "2026-10-04", PaymentType: "Cash", AccountRef: { value: "1" }, TotalAmt: 30, Line: [exp("4", 10), exp("4", 20)] }, c);
  assert.equal(same.split_account, "Expenses:Office");
  const taxed = R.mapRecentTxn("Purchase", { Id: "17", TxnDate: "2026-10-04", PaymentType: "Cash", AccountRef: { value: "1" }, TotalAmt: 33, TxnTaxDetail: { TotalTax: 3 }, Line: [exp("4", 30)] }, c);
  assert.equal(taxed.split_account, "-Split-");
});

test("Deposit: register is deposit-to, payments in come from Undeposited Funds, name from the line", () => {
  const c = ctx();
  const fromUf = R.mapRecentTxn("Deposit", { Id: "20", TxnDate: "2026-10-05", DepositToAccountRef: { value: "1" }, TotalAmt: 100, Line: [{ Amount: 100, LinkedTxn: [{ TxnId: "9", TxnType: "Payment" }] }] }, c);
  assert.equal(fromUf.account_name, "Checking");
  assert.equal(fromUf.split_account, "Undeposited Funds");
  assert.equal(fromUf.amount, 100);
  const gift = R.mapRecentTxn("Deposit", { Id: "21", TxnDate: "2026-10-05", DepositToAccountRef: { value: "1" }, TotalAmt: 75, Line: [{ Amount: 75, DetailType: "DepositLineDetail", DepositLineDetail: { AccountRef: { value: "9" }, Entity: { name: "A Donor" } } }] }, c);
  assert.equal(gift.split_account, "Income:Donations");
  assert.equal(gift.name, "A Donor");
  const mixed = R.mapRecentTxn("Deposit", { Id: "22", TxnDate: "2026-10-05", DepositToAccountRef: { value: "1" }, TotalAmt: 175, Line: [{ Amount: 100, LinkedTxn: [{ TxnId: "9" }] }, { Amount: 75, DetailType: "DepositLineDetail", DepositLineDetail: { AccountRef: { value: "9" } } }] }, c);
  assert.equal(mixed.split_account, "-Split-");
});

test("Payment, Invoice, Bill, BillPayment, Transfer, CreditCardPayment, JournalEntry labels and signs", () => {
  const c = ctx();
  const pay = R.mapRecentTxn("Payment", { Id: "30", TxnDate: "2026-10-06", TotalAmt: 40, CustomerRef: { name: "Cust" } }, c);
  assert.deepEqual([pay.txn_type, pay.account_name, pay.split_account, pay.amount, pay.name], ["Payment", "Undeposited Funds", "Accounts Receivable (A/R)", 40, "Cust"]);
  const inv = R.mapRecentTxn("Invoice", { Id: "31", TxnDate: "2026-10-06", TotalAmt: 60, CustomerRef: { name: "Cust" }, Line: [{ DetailType: "SalesItemLineDetail", Amount: 60, SalesItemLineDetail: { ItemRef: { value: "1" }, ItemAccountRef: { value: "10" } } }, { DetailType: "SubTotalLineDetail", Amount: 60 }] }, c);
  assert.deepEqual([inv.txn_type, inv.account_name, inv.split_account, inv.amount], ["Invoice", "Accounts Receivable (A/R)", "Services", 60]);
  const bill = R.mapRecentTxn("Bill", { Id: "32", TxnDate: "2026-10-06", TotalAmt: 80, VendorRef: { name: "V" }, Line: [exp("5", 80)] }, c);
  assert.deepEqual([bill.txn_type, bill.account_name, bill.split_account, bill.amount], ["Bill", "Accounts Payable (A/P)", "Rent", 80]);
  const bpChk = R.mapRecentTxn("BillPayment", { Id: "33", TxnDate: "2026-10-06", PayType: "Check", TotalAmt: 80, VendorRef: { name: "V" }, CheckPayment: { BankAccountRef: { value: "1" } } }, c);
  assert.deepEqual([bpChk.txn_type, bpChk.account_name, bpChk.split_account, bpChk.amount], ["Bill Payment (Check)", "Checking", "Accounts Payable (A/P)", -80]);
  const bpCc = R.mapRecentTxn("BillPayment", { Id: "34", TxnDate: "2026-10-06", PayType: "CreditCard", TotalAmt: 80, CreditCardPayment: { CCAccountRef: { value: "2" } } }, c);
  assert.deepEqual([bpCc.txn_type, bpCc.account_name, bpCc.amount], ["Bill Payment (Credit Card)", "Visa", 80]);
  const tr = R.mapRecentTxn("Transfer", { Id: "35", TxnDate: "2026-10-06", Amount: 500, FromAccountRef: { value: "1" }, ToAccountRef: { value: "2" } }, c);
  assert.deepEqual([tr.txn_type, tr.account_name, tr.split_account, tr.amount], ["Transfer", "Checking", "Visa", -500]);
  const ccp = R.mapRecentTxn("CreditCardPayment", { Id: "36", TxnDate: "2026-10-06", Amount: 300, BankAccountRef: { value: "1" }, CreditCardAccountRef: { value: "2" }, VendorRef: { name: "Bank" } }, c);
  assert.deepEqual([ccp.txn_type, ccp.account_name, ccp.split_account, ccp.amount, ccp.name], ["Credit Card Payment", "Checking", "Visa", -300, "Bank"]);
  const je = R.mapRecentTxn("JournalEntry", { Id: "37", TxnDate: "2026-10-06", PrivateNote: "adj", Line: [] }, c);
  assert.deepEqual([je.txn_type, je.account_name, je.split_account, je.amount, je.memo], ["Journal Entry", null, "-Split-", 0, "adj"]);
});

test("skips rows with no usable Id or date", () => {
  const c = ctx();
  assert.equal(R.mapRecentTxn("Purchase", { TxnDate: "2026-10-01" }, c), null);
  assert.equal(R.mapRecentTxn("Purchase", { Id: "1", TxnDate: "" }, c), null);
  assert.equal(R.mapRecentTxn("Purchase", { Id: "a'b", TxnDate: "2026-10-01" }, c), null);
});

function fakeFetch(handler) {
  const calls = [];
  const fn = async (q, what) => {
    calls.push(q);
    return handler(q, what);
  };
  fn.calls = calls;
  return fn;
}
const entityOf = (q) => q.match(/from (\w+)/)[1];
const posOf = (q) => Number(q.match(/startposition (\d+)/)[1]);

test("pages each type until a short page, dedupes, keeps window", async () => {
  const many = Array.from({ length: 1000 }, (_, i) => ({ Id: String(i + 1), TxnDate: "2026-10-01", PaymentType: "Cash", AccountRef: { value: "1" }, TotalAmt: 1, Line: [exp("4", 1)] }));
  const f = fakeFetch((q) => {
    const e = entityOf(q);
    if (e === "Purchase") {
      if (posOf(q) === 1) return { QueryResponse: { Purchase: many } };
      // second page repeats one id (dedupe) and has one outside the window
      return { QueryResponse: { Purchase: [many[0], { Id: "2001", TxnDate: "2026-07-01", PaymentType: "Cash", AccountRef: { value: "1" }, TotalAmt: 1 }] } };
    }
    return { QueryResponse: {} };
  });
  const r = await R.pullRecentActivity(f, ACCOUNTS, "2026-08-02", "2026-10-31");
  assert.equal(f.calls.filter((q) => entityOf(q) === "Purchase").length, 2);
  assert.equal(f.calls.length, R.RECENT_ENTITIES.length + 1);
  assert.equal(r.rows.length, 1000);
  assert.deepEqual(r.failed, []);
  assert.ok(r.covered.has("Expense") && r.covered.has("Deposit") && r.covered.has("Credit Card Expense"));
});

test("per-type failure is non-fatal; 401 rethrows; 429 stops the rest", async () => {
  const fault = Object.assign(new Error("Deposit query failed (200 with Fault)"), { status: 200 });
  const r1 = await R.pullRecentActivity(fakeFetch((q) => {
    if (entityOf(q) === "Deposit") throw fault;
    return { QueryResponse: {} };
  }), ACCOUNTS, "2026-08-02", "2026-10-31");
  assert.deepEqual(r1.failed, ["Deposit"]);
  assert.equal(r1.firstError, fault);
  assert.ok(!r1.covered.has("Deposit") && r1.covered.has("Expense"));

  await assert.rejects(
    R.pullRecentActivity(fakeFetch(() => { throw Object.assign(new Error("401"), { status: 401 }); }), ACCOUNTS, "2026-08-02", "2026-10-31"),
    /401/,
  );

  const f3 = fakeFetch((q) => {
    if (entityOf(q) === "Transfer") throw Object.assign(new Error("429"), { status: 429 });
    return { QueryResponse: {} };
  });
  const r3 = await R.pullRecentActivity(f3, ACCOUNTS, "2026-08-02", "2026-10-31");
  assert.equal(f3.calls.length, 3); // Purchase, Deposit, Transfer, then stop
  assert.equal(r3.failed.length, R.RECENT_ENTITIES.length - 2);
});

test("item lines without an account look up the Item list once", async () => {
  const f = fakeFetch((q) => {
    const e = entityOf(q);
    if (e === "SalesReceipt") return { QueryResponse: { SalesReceipt: [{ Id: "50", TxnDate: "2026-10-09", TotalAmt: 10, DepositToAccountRef: { value: "1" }, Line: [{ DetailType: "SalesItemLineDetail", Amount: 10, SalesItemLineDetail: { ItemRef: { value: "77" } } }] }] } };
    if (e === "Item") return { QueryResponse: { Item: [{ Id: "77", IncomeAccountRef: { value: "10" } }] } };
    return { QueryResponse: {} };
  });
  const r = await R.pullRecentActivity(f, ACCOUNTS, "2026-08-02", "2026-10-31");
  assert.equal(f.calls.filter((q) => entityOf(q) === "Item").length, 1);
  const sr = r.rows.find((x) => x.qbo_id === "50");
  assert.deepEqual([sr.txn_type, sr.account_name, sr.split_account, sr.amount], ["Sales Receipt", "Checking", "Services", 10]);
  assert.equal(r.itemsError, false);
});

test("merge keeps uncovered stored rows (payroll, failed types) inside the window with their own updated_at", () => {
  const fresh = [{ qbo_id: "1", txn_type: "Expense", txn_date: "2026-10-01" }];
  const stored = [
    { client_id: "c", qbo_id: "1", txn_type: "Expense", txn_date: "2026-09-01", updated_at: "2026-10-30T00:00:00Z" },
    { client_id: "c", qbo_id: "9", txn_type: "Expense", txn_date: "2026-09-01", updated_at: "2026-10-30T00:00:00Z" },
    { client_id: "c", qbo_id: "p1", txn_type: "Payroll Check", txn_date: "2026-10-15", updated_at: "2026-10-30T00:00:00Z" },
    { client_id: "c", qbo_id: "p0", txn_type: "Payroll Check", txn_date: "2026-07-15", updated_at: "2026-10-30T00:00:00Z" },
    { client_id: "c", qbo_id: "d1", txn_type: "Deposit", txn_date: "2026-10-10", updated_at: "2026-10-30T00:00:00Z" },
  ];
  const covered = new Set(["Expense", "Check", "Credit Card Expense", "Credit Card Credit"]);
  const m = R.mergeRecentRows(fresh, stored, covered, "2026-08-02", "2026-10-31");
  assert.equal(m.kept, 2);
  assert.deepEqual(m.rows.map((r) => r.qbo_id).sort(), ["1", "d1", "p1"]);
  assert.equal(m.rows.find((r) => r.qbo_id === "p1").updated_at, "2026-10-30T00:00:00Z");
});

test("a reply with no QueryResponse fails the type instead of wiping it", async () => {
  const r = await R.pullRecentActivity(fakeFetch((q) => {
    if (entityOf(q) === "Invoice") return { time: "2026-10-31T12:00:00Z" };
    return { QueryResponse: {} };
  }), ACCOUNTS, "2026-08-02", "2026-10-31");
  assert.deepEqual(r.failed, ["Invoice"]);
  assert.ok(!r.covered.has("Invoice"));
  assert.doesNotMatch(String(r.firstError.message), /2026-10-31T12/);
});

test("item list failure keeps item-line types uncovered", async () => {
  const r = await R.pullRecentActivity(fakeFetch((q) => {
    const e = entityOf(q);
    if (e === "Invoice") return { QueryResponse: { Invoice: [{ Id: "60", TxnDate: "2026-10-09", TotalAmt: 10, Line: [{ DetailType: "SalesItemLineDetail", Amount: 10, SalesItemLineDetail: { ItemRef: { value: "77" } } }] }] } };
    if (e === "Item") throw Object.assign(new Error("500"), { status: 500 });
    return { QueryResponse: {} };
  }), ACCOUNTS, "2026-08-02", "2026-10-31");
  assert.equal(r.itemsError, true);
  assert.ok(r.failed.includes("Invoice"));
  assert.ok(!r.covered.has("Invoice") && r.covered.has("Expense"));
  assert.equal(r.rows.find((x) => x.qbo_id === "60"), undefined);
});

test("merge drops stale labels with no Query API twin, and Ids already fresh", () => {
  const fresh = [{ qbo_id: "1", txn_type: "Expense", txn_date: "2026-10-01" }];
  const stored = [
    { qbo_id: "1", txn_type: "Credit Card Expense", txn_date: "2026-10-01" },
    { qbo_id: "2", txn_type: "Cash Expense", txn_date: "2026-10-01" },
    { qbo_id: "3", txn_type: "Tax Payment", txn_date: "2026-10-01" },
    { qbo_id: "4", txn_type: "Payroll Adjustment", txn_date: "2026-10-01" },
  ];
  const all = new Set(Object.values(R.ENTITY_LABELS).flat());
  const m = R.mergeRecentRows(fresh, stored, all, "2026-08-02", "2026-10-31");
  assert.deepEqual(m.rows.map((r) => r.qbo_id).sort(), ["1", "3", "4"]);
  assert.equal(m.kept, 2);
});
