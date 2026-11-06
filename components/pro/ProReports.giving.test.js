// Plain node: `node components/pro/ProReports.giving.test.js`.
// ProReports.jsx is a browser JSX file, so the pure helpers are pulled out of
// the source text and evaluated in a vm sandbox (no restructuring of the app).
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..", "..");
const src = fs.readFileSync(path.join(__dirname, "ProReports.jsx"), "utf8");

// Grab a top-level `function name(` ... matching closing brace.
function extractFn(name) {
  const start = src.indexOf("\nfunction " + name + "(");
  if (start < 0) throw new Error("missing function " + name);
  let i = src.indexOf("{", src.indexOf(")", start));
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error("unbalanced " + name);
}
function extractConst(name) {
  const m = new RegExp("\\nconst " + name + " = \\[[\\s\\S]*?\\n\\];").exec(src);
  if (!m) throw new Error("missing const " + name);
  return m[0];
}

const code = [
  extractConst("PR_MONTH_SHORT"),
  extractConst("PR_MONTH_FULL"),
  ...["prNum", "prMoney", "prTodayIso", "prIsoDaysAgo", "prPeriodLabelFromKey", "prShortPeriodLabel", "prGivingSection", "prDraftSummary"].map(extractFn),
  "this.prGivingSection = prGivingSection; this.prDraftSummary = prDraftSummary;",
].join("\n");
const box = { window: {}, console };
box.window.window = box.window;
vm.createContext(box);
vm.runInContext(code, box, { filename: "ProReports.helpers" });
const { prGivingSection, prDraftSummary } = box;

// Real QuickBooks mapper, for the "built through mapQboToClient" case.
const qsb = { window: {}, console };
qsb.window.window = qsb.window;
vm.createContext(qsb);
vm.runInContext(fs.readFileSync(path.join(root, "data.js"), "utf8"), qsb, { filename: "data.js" });
vm.runInContext(fs.readFileSync(path.join(root, "components", "qbo", "mapQboToClient.js"), "utf8"), qsb, { filename: "mapQboToClient.js" });
const { mapQboToClient, withClientDataDefaults } = qsb.window;

let checks = 0;
function ok(c, w) { checks++; if (!c) { console.error("FAIL: " + w); process.exit(1); } }
function eq(a, e, w) { ok(a === e, `${w} - expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`); }

// 1. Hand-built QuickBooks client with givingQbo.
{
  const client = {
    dataSource: "quickbooks", contributions: [], pledges: [],
    givingQbo: {
      accounts: ["Tithes", "Offerings"], ytd: 9000, last12: 15000, thisMonth: 1500,
      months: [{ key: "2026-08", amount: 1000 }, { key: "2026-09", amount: 1500, partial: false }],
      byAccount: [{ account: "Tithes", ytd: 6000, last12: 10000, thisMonth: 1000 }, { account: "Offerings", ytd: 3000, last12: 5000, thisMonth: 500 }],
    },
  };
  const g = prGivingSection(client, "2026-09");
  eq(g.hasAnyGifts, true, "QB giving counts as having giving");
  eq(g.qbo.periodTotal, 1500, "periodTotal matches the month");
  eq(g.qbo.periodHasData, true, "periodHasData true");
  eq(g.qbo.ytd, 2500, "ytd is Jan through the packet month, from the monthly totals");
  eq(g.qbo.last12, 15000, "last12");
  eq(g.qbo.accounts.length, 2, "account rows");
  eq(JSON.stringify(g.qbo.accounts[0]), JSON.stringify({ account: "Tithes", ytd: 6000, last12: 10000 }), "account row shape");
  eq(g.topDonors.length, 0, "no donors for the qbo shape");
  eq(g.byFund.rows.length, 0, "no fund rows for the qbo shape");
  const other = prGivingSection(client, "2026-05");
  eq(other.qbo.periodTotal, 0, "month with no entry totals 0");
  eq(other.qbo.periodHasData, false, "periodHasData false");
  eq(other.hasAnyGifts, true, "still shows ytd and accounts");
  // draft summary sentence
  const cur = { mi: 8, label: "Sep", income: 10, expenses: 5 };
  const sum = (gv) => prDraftSummary({ orgName: "X", timeline: [cur], comparisons: [], budget: { rows: [] }, cash: { accounts: [] }, giving: gv });
  ok(sum(g).includes("Giving recorded this month came to $1,500."), "summary has the giving sentence");
  ok(!sum(other).includes("Giving recorded"), "no sentence when the month total is 0");
}

// 2. Built through the real mapper + mgbBuildQboGiving.
{
  const pl = [
    { month: "2026-08-01", account_name: "Tithes", account_type: "Income", amount: 1000 },
    { month: "2026-09-01", account_name: "Tithes", account_type: "Income", amount: 1200 },
    { month: "2026-09-01", account_name: "Building Fund Offering", account_type: "Income", amount: 300 },
  ];
  const mapped = mapQboToClient(withClientDataDefaults({ id: "x", name: "X" }), {
    plLines: pl,
    monthlyPl: [{ month: "2026-09-01", revenue: 1500, expenses: 0 }],
    connection: { last_synced_at: "2026-09-20T12:00:00Z" },
  });
  ok(mapped.givingQbo && mapped.givingQbo.accounts.length === 2, "mapper attached givingQbo");
  const g = prGivingSection(mapped, "2026-09");
  eq(g.hasAnyGifts, true, "mapped client has giving");
  const m = mapped.givingQbo.months.find((x) => x.key === "2026-09");
  ok(m && m.amount === 1500, "mapper month amount is 1500");
  eq(g.qbo.periodTotal, 1500, "packet period total equals the Giving & funds month");
  eq(g.qbo.ytd, mapped.givingQbo.ytd, "packet ytd equals Giving & funds ytd");
  eq(g.qbo.accounts.length, 2, "packet account rows");
}

// 2b. Packet year to date follows the packet month, not the last sync (review finding).
{
  const client = {
    dataSource: "quickbooks", contributions: [], pledges: [],
    givingQbo: {
      accounts: ["Tithes"], ytd: 800, last12: 12800,
      months: [{ key: "2026-11", amount: 5000 }, { key: "2026-12", amount: 12000 }, { key: "2027-01", amount: 800, partial: true }],
      byAccount: [{ account: "Tithes", ytd: 800, last12: 12800 }],
    },
  };
  const g = prGivingSection(client, "2026-12");
  eq(g.qbo.periodTotal, 12000, "December month total");
  eq(g.qbo.ytd, 17000, "December packet ytd excludes January 2027");
  const hidden = prGivingSection({ dataSource: "quickbooks", contributions: [], pledges: [], givingQbo: null, givingQboHidden: true }, "2026-12");
  ok(/limited access/.test(hidden.emptyText), "limited-access users get an honest empty text");
}

// 3. QuickBooks client with no giving accounts: truthful empty text.
{
  const client = { dataSource: "quickbooks", contributions: [], pledges: [], givingQbo: { accounts: [], months: [], byAccount: [] } };
  const g = prGivingSection(client, "2026-09");
  eq(g.hasAnyGifts, false, "nothing to show");
  eq(g.qbo, null, "no qbo block");
  eq(g.emptyText, "No giving accounts are set up in QuickBooks yet. Your bookkeeper can choose which income accounts count as giving.", "truthful empty text");
  ok(!/isn't included/.test(g.emptyText), "old stale text is gone");
}

// 4. Non-QuickBooks client with contributions: donor output unchanged.
{
  const client = {
    dataSource: "manual", pledges: [],
    contributions: [
      { date: "2026-09-03", donor: "Ann", amount: 100, fund: "General" },
      { date: "2026-09-10", donor: "Ann", amount: 50, fund: "General" },
      { date: "2026-09-12", donor: "Bob", amount: 25, fund: "Missions" },
      { date: "2026-09-15", donor: "Anonymous", amount: 10, fund: "General" },
    ],
  };
  const g = prGivingSection(client, "2026-09");
  eq(g.hasAnyGifts, true, "has gifts");
  eq(g.qbo, null, "no qbo block for non-QB");
  eq(g.totalInPeriod, 185, "period total");
  eq(g.giftCount, 4, "gift count");
  eq(g.topDonors[0].donor, "Ann", "top donor");
  eq(g.topDonors[0].total, 150, "top donor total");
  eq(g.anonymousTotal, 10, "anonymous total");
  eq(g.byFund.rows.length, 2, "fund rows");
  const empty = prGivingSection({ dataSource: "manual", contributions: [], pledges: [] }, "2026-09");
  eq(empty.emptyText, "No giving recorded yet.", "non-QB empty text");
  const qbNoGiving = prGivingSection({ dataSource: "quickbooks", contributions: [], pledges: [] }, "2026-09");
  eq(qbNoGiving.hasAnyGifts, false, "QB with no givingQbo shows empty");
  const cur = { mi: 8, label: "Sep", income: 10, expenses: 5 };
  const s = prDraftSummary({ orgName: "X", timeline: [cur], comparisons: [], budget: { rows: [] }, cash: { accounts: [] }, giving: g });
  ok(s.includes("came to $185 across 4 gifts."), "donor summary sentence unchanged");
}

// 5. Old saved snapshot (no qbo key) still reads fine.
{
  const old = { periodLabel: "September 2026", hasAnyGifts: true, emptyText: "x", totalInPeriod: 5, giftCount: 1, topDonors: [], anonymousTotal: 0, lapsed: { available: false, reason: "r" }, byFund: { months: [], rows: [] }, pledges: { rows: [], totals: { committed: 0, received: 0, remaining: 0, pct: null } } };
  ok(!old.qbo, "old snapshot has no qbo");
  const cur = { mi: 8, label: "Sep", income: 10, expenses: 5 };
  const s = prDraftSummary({ orgName: "X", timeline: [cur], comparisons: [], budget: { rows: [] }, cash: { accounts: [] }, giving: old });
  ok(s.includes("came to $5 across 1 gift."), "old snapshot summary still works");
}

console.log(`ProReports giving: ${checks} assertions passed.`);
