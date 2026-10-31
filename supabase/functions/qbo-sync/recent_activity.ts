// Recent register activity (qbo_transactions) from the QuickBooks Query API.
//
// Until 2026-10-30 this came from one TransactionList report call. Since
// 2026-10-31 Intuit refuses TransactionList (ValidationFault 6000) for our
// companies whatever the window, columns or minorversion, while Query API
// calls keep working. So the same 90-day window is read entity by entity
// (one query per type, paged at Intuit's 1000-row cap) and each transaction
// is mapped to the row shape the report produced, so the Bank page, Giving,
// the close-task email and transaction questions read it unchanged:
//   - txn_type uses the report's wording ("Expense", "Credit Card Credit",
//     "Bill Payment (Check)"), so the (client_id, txn_type, qbo_id) key of a
//     transaction is the same as before;
//   - account_name is the register account the report's Account column
//     showed (bank or card for an expense, the deposit-to account for a
//     deposit or payment, A/R for an invoice, A/P for a bill), by
//     FullyQualifiedName ("Parent:Child"), as the report printed it;
//   - split_account is the one other account, or "-Split-" when the
//     transaction posts to several;
//   - amount carries the report's sign: money out of a bank account is
//     negative, a charge on a card is positive, a card credit negative.
//
// Not reachable through the Query API at all: payroll paychecks, payroll
// tax payments and payroll adjustments ("Payroll Check", "Tax Payment",
// "Payroll Adjustment"). Their rows from the last good report pull are kept
// as they were (with their old updated_at, so nothing claims they are
// fresh) until they age out of the 90-day window. The same goes for a type
// whose query failed this run: its stored rows are kept rather than wiped.
//
// Pure apart from the injected fetcher, so tests/edge/qbo_recent_activity
// .test.mjs runs it under node. Never logs a response body.

export const RECENT_PAGE_SIZE = 1000;
// 10 pages = 10,000 rows of one type in 90 days. Far past any client today;
// the cap only stops a runaway loop from burning the Intuit allowance.
export const RECENT_MAX_PAGES = 10;

// Query order. Every transaction type TransactionList listed for these
// companies, plus the other common ones it would list.
export const RECENT_ENTITIES = [
  "Purchase",
  "Deposit",
  "Transfer",
  "CreditCardPayment",
  "JournalEntry",
  "Payment",
  "SalesReceipt",
  "RefundReceipt",
  "Invoice",
  "CreditMemo",
  "Bill",
  "BillPayment",
  "VendorCredit",
];

// The txn_type labels each entity can produce. A label is "covered" when its
// entity was read in full this run; stored rows with a covered label are
// replaced, others are kept (see mergeRecentRows).
export const ENTITY_LABELS: Record<string, string[]> = {
  // "Credit Card Expense" is what the report called some card purchases (seen
  // on the sandbox company); the Query API cannot tell those from "Expense",
  // and the production company's report used "Expense", so new rows say
  // "Expense". Listed here so the old label is replaced, not kept twice.
  Purchase: ["Expense", "Check", "Credit Card Expense", "Credit Card Credit"],
  Deposit: ["Deposit"],
  Transfer: ["Transfer"],
  CreditCardPayment: ["Credit Card Payment"],
  JournalEntry: ["Journal Entry"],
  Payment: ["Payment"],
  SalesReceipt: ["Sales Receipt"],
  RefundReceipt: ["Refund"],
  Invoice: ["Invoice"],
  CreditMemo: ["Credit Memo"],
  Bill: ["Bill"],
  BillPayment: ["Bill Payment (Check)", "Bill Payment (Credit Card)"],
  VendorCredit: ["Vendor Credit"],
};

export const SPLIT_MARK = "-Split-";

// Report-only payroll labels: not in the Query API, so their stored rows are
// always kept (until they leave the window).
export const PAYROLL_LABELS = ["Payroll Check", "Tax Payment", "Payroll Adjustment"];

// A query reply must carry QueryResponse (Intuit sends {"QueryResponse":{}}
// for a truly empty result). Anything else is not an answer: treating it as
// "no transactions" would wipe that type's stored rows.
function queryList(res: any, entity: string, what: string): any[] {
  const qr = res?.QueryResponse;
  if (!qr || typeof qr !== "object" || Array.isArray(qr)) {
    throw Object.assign(new Error(`${what}: QuickBooks sent a reply with no QueryResponse`), { status: 0 });
  }
  const list = qr[entity];
  return Array.isArray(list) ? list : [];
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const SAFE_ID = /^[A-Za-z0-9-]{1,40}$/;

export function recentQuery(entity: string, start: string, end: string, startPosition: number): string {
  if (!RECENT_ENTITIES.includes(entity)) throw new Error(`recentQuery: unknown entity ${entity}`);
  if (!ISO_DAY.test(start) || !ISO_DAY.test(end)) throw new Error("recentQuery: bad date");
  const pos = Math.max(1, Math.floor(startPosition));
  return (
    `select * from ${entity} where TxnDate >= '${start}' and TxnDate <= '${end}' ` +
    `orderby Id startposition ${pos} maxresults ${RECENT_PAGE_SIZE}`
  );
}

export function itemQuery(startPosition: number): string {
  const pos = Math.max(1, Math.floor(startPosition));
  return `select * from Item where Active in (true, false) orderby Id startposition ${pos} maxresults ${RECENT_PAGE_SIZE}`;
}

function num(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = parseFloat(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function text(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return s ? s : null;
}

// ---------------------------------------------------------------------------
// Context: account names and defaults from the chart of accounts this sync
// already read (raw Intuit Account objects), plus item -> account lookups.
// ---------------------------------------------------------------------------
export type RecentCtx = {
  fqnById: Map<string, string>;
  typeById: Map<string, string>;
  ar: string | null;
  ap: string | null;
  undeposited: string;
  // item id -> { income, expense } account ids; filled only when needed.
  items: Map<string, { income: string | null; expense: string | null }> | null;
};

function pickDefault(accounts: any[], type: string, nameRe: RegExp): any | null {
  const of = accounts.filter((a) => a?.AccountType === type);
  if (!of.length) return null;
  return of.find((a) => nameRe.test(String(a?.Name || ""))) || of[0];
}

export function buildRecentCtx(accounts: any[]): RecentCtx {
  const fqnById = new Map<string, string>();
  const typeById = new Map<string, string>();
  for (const a of accounts || []) {
    if (a?.Id == null) continue;
    const id = String(a.Id);
    const name = text(a.FullyQualifiedName) || text(a.Name);
    if (name) fqnById.set(id, name);
    if (a.AccountType) typeById.set(id, String(a.AccountType));
  }
  const fqn = (a: any) => (a ? text(a.FullyQualifiedName) || text(a.Name) : null);
  const uf =
    (accounts || []).find((a) => a?.AccountSubType === "UndepositedFunds") ||
    (accounts || []).find((a) => /^undeposited funds/i.test(String(a?.Name || "")));
  return {
    fqnById,
    typeById,
    ar: fqn(pickDefault(accounts || [], "Accounts Receivable", /^accounts receivable/i)),
    ap: fqn(pickDefault(accounts || [], "Accounts Payable", /^accounts payable/i)),
    undeposited: fqn(uf) || "Undeposited Funds",
    items: null,
  };
}

export function buildItemMap(items: any[]): Map<string, { income: string | null; expense: string | null }> {
  const m = new Map<string, { income: string | null; expense: string | null }>();
  for (const it of items || []) {
    if (it?.Id == null) continue;
    m.set(String(it.Id), {
      income: it.IncomeAccountRef?.value != null ? String(it.IncomeAccountRef.value) : null,
      expense:
        it.ExpenseAccountRef?.value != null
          ? String(it.ExpenseAccountRef.value)
          : it.AssetAccountRef?.value != null
            ? String(it.AssetAccountRef.value)
            : null,
    });
  }
  return m;
}

function refName(ctx: RecentCtx, ref: any): string | null {
  if (!ref) return null;
  const id = ref.value != null ? String(ref.value) : "";
  return (id && ctx.fqnById.get(id)) || text(ref.name);
}

// ---------------------------------------------------------------------------
// Split: the other account(s) a transaction posts to.
// ---------------------------------------------------------------------------
type Posting = { keys: Set<string>; names: Map<string, string | null>; unknown: number };

function flatLines(lines: any[], out: any[] = []): any[] {
  for (const l of lines || []) {
    const inner = l?.GroupLineDetail?.Line;
    if (Array.isArray(inner) && inner.length) flatLines(inner, out);
    else out.push(l);
  }
  return out;
}

// Does any line need the Item list to know its account?
export function needsItems(entity: string, t: any): boolean {
  for (const l of flatLines(t?.Line || [])) {
    if (l?.DetailType === "SalesItemLineDetail" && !l?.SalesItemLineDetail?.ItemAccountRef?.value) return true;
    if (l?.DetailType === "ItemBasedExpenseLineDetail") return true;
  }
  return false;
}

function postings(ctx: RecentCtx, t: any): Posting {
  const p: Posting = { keys: new Set(), names: new Map(), unknown: 0 };
  const addRef = (ref: any) => {
    if (!ref || (ref.value == null && !ref.name)) {
      p.unknown++;
      return;
    }
    const key = ref.value != null ? `a:${ref.value}` : `n:${ref.name}`;
    p.keys.add(key);
    if (!p.names.has(key)) p.names.set(key, refName(ctx, ref));
  };
  const addId = (id: string | null) => {
    if (!id) {
      p.unknown++;
      return;
    }
    addRef({ value: id });
  };
  for (const l of flatLines(t?.Line || [])) {
    const dt = l?.DetailType;
    if (dt === "SubTotalLineDetail" || dt === "DescriptionOnly" || dt === "DescriptionLineDetail") continue;
    if (dt === "AccountBasedExpenseLineDetail") addRef(l.AccountBasedExpenseLineDetail?.AccountRef);
    else if (dt === "JournalEntryLineDetail") addRef(l.JournalEntryLineDetail?.AccountRef);
    else if (dt === "DiscountLineDetail") addRef(l.DiscountLineDetail?.DiscountAccountRef);
    else if (dt === "DepositLineDetail" && l.DepositLineDetail?.AccountRef) addRef(l.DepositLineDetail.AccountRef);
    else if (Array.isArray(l?.LinkedTxn) && l.LinkedTxn.length && (dt === "DepositLineDetail" || !dt)) {
      // A deposit line that brings in a payment from Undeposited Funds.
      p.keys.add("uf");
      p.names.set("uf", ctx.undeposited);
    } else if (dt === "SalesItemLineDetail") {
      const d = l.SalesItemLineDetail || {};
      if (d.ItemAccountRef?.value) addRef(d.ItemAccountRef);
      else addId(ctx.items?.get(String(d.ItemRef?.value ?? ""))?.income ?? null);
    } else if (dt === "ItemBasedExpenseLineDetail") {
      addId(ctx.items?.get(String(l.ItemBasedExpenseLineDetail?.ItemRef?.value ?? ""))?.expense ?? null);
    } else if (num(l?.Amount) !== 0) {
      p.unknown++;
    }
  }
  if (t?.CashBack?.AccountRef && num(t.CashBack.Amount) !== 0) addRef(t.CashBack.AccountRef);
  if (num(t?.TxnTaxDetail?.TotalTax) !== 0) {
    p.keys.add("tax");
    p.names.set("tax", null);
  }
  return p;
}

function splitOf(p: Posting): string | null {
  const n = p.keys.size + p.unknown;
  if (n > 1) return SPLIT_MARK;
  if (p.keys.size === 1) return p.names.get([...p.keys][0]) ?? null;
  return null;
}

// ---------------------------------------------------------------------------
// One QuickBooks transaction -> one qbo_transactions row (no client_id or
// updated_at; the caller adds those). null when it has no Id or TxnDate.
// ---------------------------------------------------------------------------
export function mapRecentTxn(entity: string, t: any, ctx: RecentCtx): any | null {
  if (!t || t.Id == null || !SAFE_ID.test(String(t.Id))) return null;
  const txnDate = String(t.TxnDate || "").slice(0, 10);
  if (!ISO_DAY.test(txnDate)) return null;
  const total = num(t.TotalAmt);
  const memo = text(t.PrivateNote);
  const customer = text(t.CustomerRef?.name);
  const vendor = text(t.VendorRef?.name);
  let txnType: string;
  let account: string | null = null;
  let split: string | null = null;
  let name: string | null = null;
  let amount = 0;

  switch (entity) {
    case "Purchase": {
      const acctId = t.AccountRef?.value != null ? String(t.AccountRef.value) : "";
      const acctType = ctx.typeById.get(acctId);
      const isCard = acctType ? acctType === "Credit Card" : t.PaymentType === "CreditCard";
      const credit = t.Credit === true;
      txnType = t.PaymentType === "Check" ? "Check" : isCard && credit ? "Credit Card Credit" : "Expense";
      account = refName(ctx, t.AccountRef);
      split = splitOf(postings(ctx, t));
      name = text(t.EntityRef?.name);
      amount = isCard ? (credit ? -total : total) : credit ? total : -total;
      break;
    }
    case "Deposit": {
      txnType = "Deposit";
      account = refName(ctx, t.DepositToAccountRef);
      split = splitOf(postings(ctx, t));
      for (const l of t.Line || []) {
        name = text(l?.DepositLineDetail?.Entity?.name);
        if (name) break;
      }
      amount = total;
      break;
    }
    case "Transfer": {
      txnType = "Transfer";
      account = refName(ctx, t.FromAccountRef);
      split = refName(ctx, t.ToAccountRef);
      amount = -num(t.Amount);
      break;
    }
    case "CreditCardPayment": {
      txnType = "Credit Card Payment";
      account = refName(ctx, t.BankAccountRef);
      split = refName(ctx, t.CreditCardAccountRef);
      name = vendor;
      amount = -num(t.Amount);
      break;
    }
    case "JournalEntry": {
      // The report showed a journal entry with no single account, "-Split-",
      // and its net (0).
      txnType = "Journal Entry";
      split = SPLIT_MARK;
      amount = 0;
      break;
    }
    case "Payment": {
      txnType = "Payment";
      account = t.DepositToAccountRef ? refName(ctx, t.DepositToAccountRef) : ctx.undeposited;
      split = t.ARAccountRef ? refName(ctx, t.ARAccountRef) : ctx.ar;
      name = customer;
      amount = total;
      break;
    }
    case "SalesReceipt": {
      txnType = "Sales Receipt";
      account = t.DepositToAccountRef ? refName(ctx, t.DepositToAccountRef) : ctx.undeposited;
      split = splitOf(postings(ctx, t));
      name = customer;
      amount = total;
      break;
    }
    case "RefundReceipt": {
      txnType = "Refund";
      account = refName(ctx, t.DepositToAccountRef);
      split = splitOf(postings(ctx, t));
      name = customer;
      amount = -total;
      break;
    }
    case "Invoice": {
      txnType = "Invoice";
      account = t.ARAccountRef ? refName(ctx, t.ARAccountRef) : ctx.ar;
      split = splitOf(postings(ctx, t));
      name = customer;
      amount = total;
      break;
    }
    case "CreditMemo": {
      txnType = "Credit Memo";
      account = t.ARAccountRef ? refName(ctx, t.ARAccountRef) : ctx.ar;
      split = splitOf(postings(ctx, t));
      name = customer;
      amount = -total;
      break;
    }
    case "Bill": {
      txnType = "Bill";
      account = t.APAccountRef ? refName(ctx, t.APAccountRef) : ctx.ap;
      split = splitOf(postings(ctx, t));
      name = vendor;
      amount = total;
      break;
    }
    case "VendorCredit": {
      txnType = "Vendor Credit";
      account = t.APAccountRef ? refName(ctx, t.APAccountRef) : ctx.ap;
      split = splitOf(postings(ctx, t));
      name = vendor;
      amount = -total;
      break;
    }
    case "BillPayment": {
      const card = t.PayType === "CreditCard";
      txnType = card ? "Bill Payment (Credit Card)" : "Bill Payment (Check)";
      account = card
        ? refName(ctx, t.CreditCardPayment?.CCAccountRef)
        : refName(ctx, t.CheckPayment?.BankAccountRef);
      split = t.APAccountRef ? refName(ctx, t.APAccountRef) : ctx.ap;
      name = vendor;
      amount = card ? total : -total;
      break;
    }
    default:
      return null;
  }
  return {
    qbo_id: String(t.Id),
    txn_type: txnType,
    txn_date: txnDate,
    account_name: account,
    split_account: split,
    name,
    memo,
    amount,
  };
}

// ---------------------------------------------------------------------------
// The read. `fetchQuery(q, what)` is intuitFetch on a Query URL; it throws an
// error with a numeric `status` for Intuit refusals (401 / 429 / 4xx / 5xx /
// 200-with-Fault). Per-type failures are non-fatal: the type is listed in
// `failed` and its stored rows are kept by mergeRecentRows. A 401 is
// rethrown (the token is the problem; the caller's reconnect path). A 429
// stops every remaining query this run (rate limited: don't keep calling).
// ---------------------------------------------------------------------------
export type RecentResult = {
  rows: any[];
  covered: Set<string>;
  failed: string[];
  truncated: string[];
  firstError: any | null;
  itemsError: boolean;
  calls: number;
};

export async function pullRecentActivity(
  fetchQuery: (q: string, what: string) => Promise<any>,
  accounts: any[],
  start: string,
  end: string,
): Promise<RecentResult> {
  const ctx = buildRecentCtx(accounts);
  const raw = new Map<string, any[]>();
  const failed: string[] = [];
  const truncated: string[] = [];
  let firstError: any = null;
  let stopped = false;
  let calls = 0;

  const fail = (entity: string, e: any) => {
    if (e && e.status === 401) throw e;
    failed.push(entity);
    if (!firstError) firstError = e;
    if (e && e.status === 429) stopped = true;
  };

  for (const entity of RECENT_ENTITIES) {
    if (stopped) {
      failed.push(entity);
      continue;
    }
    const got: any[] = [];
    try {
      for (let page = 0; page < RECENT_MAX_PAGES; page++) {
        calls++;
        const res = await fetchQuery(
          recentQuery(entity, start, end, 1 + page * RECENT_PAGE_SIZE),
          `${entity} query`,
        );
        const rows = queryList(res, entity, `${entity} query`);
        got.push(...rows);
        if (rows.length < RECENT_PAGE_SIZE) break;
        if (page === RECENT_MAX_PAGES - 1) truncated.push(entity);
      }
      raw.set(entity, got);
    } catch (e) {
      fail(entity, e);
    }
  }

  // Item accounts, only when some line names an item without its account.
  let itemsError = false;
  let wantItems = false;
  for (const [entity, list] of raw) {
    if (list.some((t) => needsItems(entity, t))) {
      wantItems = true;
      break;
    }
  }
  if (wantItems && !stopped) {
    try {
      const items: any[] = [];
      for (let page = 0; page < RECENT_MAX_PAGES; page++) {
        calls++;
        const res = await fetchQuery(itemQuery(1 + page * RECENT_PAGE_SIZE), "Item query");
        const list = queryList(res, "Item", "Item query");
        items.push(...list);
        if (list.length < RECENT_PAGE_SIZE) break;
      }
      ctx.items = buildItemMap(items);
    } catch (e: any) {
      if (e && e.status === 401) throw e;
      // Splits on item lines show as unknown (null, or "-Split-" next to
      // another account) rather than guessed.
      itemsError = true;
      if (e && e.status === 429) stopped = true;
    }
  } else if (wantItems) {
    itemsError = true;
  }

  const rows: any[] = [];
  const seen = new Set<string>();
  const covered = new Set<string>();
  for (const [entity, list] of raw) {
    // A type is covered (its stored rows replaced) only when it was read in
    // full and, if its lines needed the Item list, that list was read too;
    // otherwise its stored rows (with good categories) are kept instead.
    const itemBlind = itemsError && list.some((t) => needsItems(entity, t));
    if (itemBlind) {
      failed.push(entity);
      continue;
    }
    if (!truncated.includes(entity)) for (const l of ENTITY_LABELS[entity] || []) covered.add(l);
    for (const t of list) {
      const r = mapRecentTxn(entity, t, ctx);
      if (!r) continue;
      if (r.txn_date < start || r.txn_date > end) continue;
      const k = `${r.txn_type}|${r.qbo_id}`;
      if (seen.has(k)) continue;
      seen.add(k);
      rows.push(r);
    }
  }
  return { rows, covered, failed, truncated, firstError, itemsError, calls };
}

// Fresh rows, plus the stored rows nothing fresh replaces: labels no query
// covered this run (payroll; a failed or truncated type), still inside the
// window, and not already present fresh. Stored rows keep their own
// updated_at (they are the last good pull, not new data).
export function mergeRecentRows(
  fresh: any[],
  stored: any[],
  covered: Set<string>,
  start: string,
  end: string,
): { rows: any[]; kept: number } {
  // Kept: payroll, plus labels of a known entity that was not covered this
  // run (failed, truncated, or item-blind). Any other old label (report
  // wording with no Query API twin) is dropped, so it cannot sit beside the
  // fresh row for the same transaction.
  const keepable = new Set(PAYROLL_LABELS);
  for (const labels of Object.values(ENTITY_LABELS)) {
    for (const l of labels) if (!covered.has(l)) keepable.add(l);
  }
  // QuickBooks transaction Ids are one sequence per company, so an Id that
  // is already fresh (under any label) is never kept again.
  const freshIds = new Set(fresh.map((r) => String(r.qbo_id)));
  const kept = (stored || []).filter((r) => {
    if (!r || !keepable.has(r.txn_type)) return false;
    const d = String(r.txn_date || "").slice(0, 10);
    if (!ISO_DAY.test(d) || d < start || d > end) return false;
    return !freshIds.has(String(r.qbo_id));
  });
  return { rows: [...fresh, ...kept], kept: kept.length };
}
