// Plain node, no framework: `node components/internal/MH_capacity.test.js`.
// Guards the MGB Home › Capacity allocation math (MH_capacity.js): rounding,
// a month with no hours, the hours-weighted split summing to 100%, fixed rows
// (100% on a contract client), fallback rows and revenue sharing.
// All rates and fees below are made-up test numbers, not anyone's pay.

const assert = require("assert");
const C = require("./MH_capacity.js");

let n = 0;
function t(name, fn) {
  try {
    fn();
  } catch (e) {
    console.error("FAIL " + name);
    throw e;
  }
  n++;
}

const K = "contract-x";
const fixedFull = { staff_email: "c@test", client_id: K, share: 1, method: "fixed", effective_from: "2000-01-01" };
const fbHalf = { staff_email: "j@test", client_id: K, share: 0.5, method: "fallback", effective_from: "2026-01-01" };

// Rounding -------------------------------------------------------------------
t("round2: cents, half away from zero", () => {
  assert.strictEqual(C.MH_capRound2(1.005), 1.01);
  assert.strictEqual(C.MH_capRound2(2.675), 2.68);
  assert.strictEqual(C.MH_capRound2(-1.005), -1.01);
  assert.strictEqual(C.MH_capRound2(null), null);
  assert.strictEqual(C.MH_capRound2("x"), null);
});
t("split cost: thirds sum exactly to the rounded total", () => {
  const s = C.MH_capSplitCost(100, { a: 1 / 3, b: 1 / 3 }, ["a", "b"]);
  assert.strictEqual(s.contract.a, 33.33);
  assert.strictEqual(s.contract.b, 33.33);
  assert.strictEqual(s.mgb, 33.34);
  assert.strictEqual(Math.round((s.contract.a + s.contract.b + s.mgb) * 100), 10000);
});
t("split cost: odd cents never lose a cent", () => {
  for (const total of [0.01, 10.005, 99.99, 1234.567, 7]) {
    const s = C.MH_capSplitCost(total, { a: 0.857 }, ["a"]);
    assert.strictEqual(Math.round((s.contract.a + s.mgb) * 100), Math.round(C.MH_capRound2(total) * 100));
  }
});
t("split revenue: parts sum to the rounded revenue", () => {
  const parts = C.MH_capSplitRevenue(100, [1, 1, 1]);
  assert.strictEqual(Math.round(parts.reduce((a, b) => a + b, 0) * 100), 10000);
  assert.deepStrictEqual(C.MH_capSplitRevenue(50, [0, 0]), [0, 0]);
});

// Paid hours -------------------------------------------------------------------
t("paid minutes: target for the days covered, or logged when more", () => {
  assert.strictEqual(C.MH_capPaidMinutes(600, 35, 7), 2100);
  assert.strictEqual(C.MH_capPaidMinutes(3000, 35, 7), 3000);
  assert.strictEqual(C.MH_capPaidMinutes(600, null, 30), 600);
  assert.strictEqual(C.MH_capPaidMinutes(0, 35, 0), 0);
});

// Shares ------------------------------------------------------------------------
t("shares: hours-weighted split", () => {
  const s = C.MH_capShares({ minutes: 1000, contract_minutes: { [K]: 850 } }, [], [K], "j@test", "2026-09-30");
  assert.strictEqual(s.source, "hours");
  assert.ok(Math.abs(s.shares[K] - 0.85) < 1e-12);
});
t("shares: hours-weighted split plus MGB is 100%", () => {
  const pm = { minutes: 997, contract_minutes: { [K]: 331 } };
  const s = C.MH_capShares(pm, [], [K], "j@test", "2026-09-30");
  const cost = C.MH_capSplitCost(123.45, s.shares, [K]);
  assert.strictEqual(Math.round((cost.contract[K] + cost.mgb) * 100), 12345);
});
t("shares: fixed row wins over hours (100% contract)", () => {
  const s = C.MH_capShares({ minutes: 600, contract_minutes: { [K]: 60 } }, [fixedFull], [K], "c@test", "2026-09-30");
  assert.strictEqual(s.source, "fixed");
  assert.strictEqual(s.shares[K], 1);
});
t("shares: no hours and no fallback row -> 0, source none", () => {
  const s = C.MH_capShares({ minutes: 0, contract_minutes: {} }, [], [K], "j@test", "2026-09-30");
  assert.strictEqual(s.source, "none");
  assert.strictEqual(s.shares[K], 0);
});
t("shares: no hours uses the fallback row in effect", () => {
  const s = C.MH_capShares({ minutes: 0, contract_minutes: {} }, [fbHalf], [K], "j@test", "2026-09-30");
  assert.strictEqual(s.source, "fallback");
  assert.strictEqual(s.shares[K], 0.5);
});
t("shares: fallback row not yet in effect is ignored", () => {
  const s = C.MH_capShares({ minutes: 0 }, [fbHalf], [K], "j@test", "2025-12-31");
  assert.strictEqual(s.source, "none");
});
t("shares: fallback ignored when there are hours", () => {
  const s = C.MH_capShares({ minutes: 100, contract_minutes: {} }, [fbHalf], [K], "j@test", "2026-09-30");
  assert.strictEqual(s.source, "hours");
  assert.strictEqual(s.shares[K], 0);
});
t("shares: latest row in effect wins", () => {
  const rows = [fixedFull, { ...fixedFull, share: 0.25, effective_from: "2026-06-01" }];
  assert.strictEqual(C.MH_capShares({ minutes: 1 }, rows, [K], "c@test", "2026-05-31").shares[K], 1);
  assert.strictEqual(C.MH_capShares({ minutes: 1 }, rows, [K], "c@test", "2026-06-01").shares[K], 0.25);
});
t("shares: over 100% across contracts is scaled down and flagged", () => {
  const rows = [fixedFull, { ...fixedFull, client_id: "k2" }];
  const s = C.MH_capShares({ minutes: 1 }, rows, [K, "k2"], "c@test", "2026-09-30");
  assert.ok(s.capped);
  assert.ok(Math.abs(s.shares[K] + s.shares.k2 - 1) < 1e-12);
});

// Compute ------------------------------------------------------------------------
function fixture() {
  return {
    from: "2026-09-01",
    to: "2026-10-31",
    basis: "staff",
    months: [
      { month: "2026-09-01", days: 30, covered_days: 30 },
      { month: "2026-10-01", days: 31, covered_days: 31 },
    ],
    contracts: [{ client_id: K, label: "X", name: "Contract X" }],
    allocations: [fixedFull, fbHalf],
    people: [
      { key: "c@test", staff_email: "c@test", name: "C", active: true, mapped: true, former: false, weekly_target: 35 },
      { key: "j@test", staff_email: "j@test", name: "J", active: true, mapped: true, former: false, weekly_target: 35 },
      { key: "unmapped:Z", staff_email: null, name: "Z", active: false, mapped: false, former: false, weekly_target: null },
    ],
    person_months: [
      // C: 100% contract even with some MGB-client time.
      { key: "c@test", month: "2026-09-01", minutes: 9000, contract_minutes: { [K]: 8400 }, rate: 10 },
      { key: "c@test", month: "2026-10-01", minutes: 9300, contract_minutes: { [K]: 9300 }, rate: 10 },
      // J: September by hours (85% contract), October no hours (fallback 50%).
      { key: "j@test", month: "2026-09-01", minutes: 10000, contract_minutes: { [K]: 8500 }, rate: 20 },
      { key: "j@test", month: "2026-10-01", minutes: 0, contract_minutes: {}, rate: 20 },
      // Z: not on staff, logged hours only, estimated rate.
      { key: "unmapped:Z", month: "2026-09-01", minutes: 600, contract_minutes: {}, rate: 15, estimated: true },
    ],
    clients: [
      { client_id: K, name: "Contract X", monthly_fee: 3000, fee_source: "actual", contract: true },
      { client_id: "m1", name: "M1", monthly_fee: 600, fee_source: "actual", contract: false },
      { client_id: "m2", name: "M2", monthly_fee: 310, fee_source: "actual", contract: false },
      { client_id: "m3", name: "M3", monthly_fee: null, fee_source: null, contract: false },
    ],
    work: [
      { key: "c@test", client_id: K, month: "2026-09-01", minutes: 8400 },
      { key: "j@test", client_id: K, month: "2026-09-01", minutes: 8500 },
      { key: "c@test", client_id: K, month: "2026-10-01", minutes: 9300 },
      { key: "c@test", client_id: "m1", month: "2026-09-01", minutes: 600 },
      { key: "j@test", client_id: "m1", month: "2026-09-01", minutes: 1500 },
      { key: "unmapped:Z", client_id: "m1", month: "2026-09-01", minutes: 600 },
    ],
  };
}

t("compute: fixed person is 100% contract every month", () => {
  const r = C.MH_capCompute(fixture());
  const c = r.people.find((p) => p.key === "c@test");
  assert.strictEqual(c.mgbCost, 0);
  assert.strictEqual(c.contractCost[K], c.pay);
  assert.strictEqual(c.contractShare, 1);
});
t("compute: hours month + fallback month, split sums to pay", () => {
  const r = C.MH_capCompute(fixture());
  const j = r.people.find((p) => p.key === "j@test");
  // Sept: paid = max(10000, 35h x 30/7 = 9000 min) = 10000 min at 20/h -> 3333.33
  // Oct: paid = 35h x 31/7 = 9300 min at 20/h -> 3100, 50% fallback.
  assert.strictEqual(j.pay, 6433.33);
  assert.strictEqual(j.contractCost[K], C.MH_capRound2(3333.33 * 0.85) + 1550);
  assert.strictEqual(Math.round((j.contractCost[K] + j.mgbCost) * 100), Math.round(j.pay * 100));
  assert.ok(j.flags.fallback);
  assert.ok(!j.flags.noHours);
});
t("compute: no hours and no fallback -> all MGB, flagged", () => {
  const f = fixture();
  f.allocations = [fixedFull];
  const j = C.MH_capCompute(f).people.find((p) => p.key === "j@test");
  assert.ok(j.flags.noHours);
  assert.strictEqual(j.contractCost[K], C.MH_capRound2(3333.33 * 0.85));
  assert.strictEqual(Math.round((j.contractCost[K] + j.mgbCost) * 100), Math.round(j.pay * 100));
});
t("compute: logged-only person, estimated flag kept", () => {
  const z = C.MH_capCompute(fixture()).people.find((p) => p.key === "unmapped:Z");
  assert.strictEqual(z.pay, 150);
  assert.strictEqual(z.mgbCost, 150);
  assert.ok(z.flags.estimated);
  assert.strictEqual(z.utilization, null);
});
t("compute: revenue shared by minutes, uncarried months reported", () => {
  const r = C.MH_capCompute(fixture());
  const sum = r.people.reduce((a, p) => a + p.revenue, 0);
  const uncarried = r.uncarried.mgb + Object.values(r.uncarried.contract).reduce((a, b) => a + b, 0);
  assert.strictEqual(Math.round((sum + uncarried) * 100), Math.round(r.totals.revenue * 100));
  // m1 in October and m2 in both months nobody logged time on.
  assert.strictEqual(r.uncarried.mgb, 600 + 310 + 310);
  assert.strictEqual(r.missingFees, 1);
});
t("compute: split rows sum to the totals", () => {
  const r = C.MH_capCompute(fixture());
  const cost = r.split.reduce((a, s) => a + s.cost, 0);
  const rev = r.split.reduce((a, s) => a + s.revenue, 0);
  assert.strictEqual(Math.round(cost * 100), Math.round(r.totals.pay * 100));
  assert.strictEqual(Math.round(rev * 100), Math.round(r.totals.revenue * 100));
  assert.strictEqual(r.split[r.split.length - 1].key, "mgb");
});
t("compute: missing rate -> uncosted, no cost", () => {
  const f = fixture();
  f.person_months.forEach((pm) => { if (pm.key === "j@test") pm.rate = null; });
  const j = C.MH_capCompute(f).people.find((p) => p.key === "j@test");
  assert.ok(j.flags.uncosted);
  assert.strictEqual(j.pay, 0);
});
t("compute: utilization against target minutes", () => {
  const c = C.MH_capCompute(fixture()).people.find((p) => p.key === "c@test");
  assert.strictEqual(c.targetMinutes, 9000 + 9300);
  assert.strictEqual(c.utilization, 1);
});
t("compute: firm use of target hours counts only people with a target", () => {
  const r = C.MH_capCompute(fixture());
  // C 9000+9300 and J 10000+0 have targets; Z's 600 is other time.
  assert.strictEqual(r.totals.minutes, 9000 + 9300 + 10000);
  assert.strictEqual(r.totals.otherMinutes, 600);
  assert.strictEqual(r.totals.allMinutes, 9000 + 9300 + 10000 + 600);
  assert.strictEqual(r.totals.targetMinutes, (9000 + 9300) * 2);
  assert.strictEqual(r.totals.utilization, (9000 + 9300 + 10000) / ((9000 + 9300) * 2));
});
t("compute: lots of untargeted time never pushes use of target past the targeted hours", () => {
  const f = fixture();
  f.person_months.find((pm) => pm.key === "unmapped:Z").minutes = 100000;
  const r = C.MH_capCompute(f);
  assert.strictEqual(r.totals.utilization, (9000 + 9300 + 10000) / ((9000 + 9300) * 2));
  assert.strictEqual(r.totals.otherMinutes, 100000);
});

// Mid-month changes (segments from capacity_inputs, mgb-home-s6b.sql) -------------
// Made-up figures: rate 10/h until the 16th, 20/h from the 16th (a raise).
function midMonth(extra) {
  return Object.assign({
    from: "2026-09-01",
    to: "2026-09-30",
    basis: "staff",
    months: [{ month: "2026-09-01", days: 30, covered_days: 30 }],
    contracts: [{ client_id: K, label: "X", name: "Contract X" }],
    allocations: [],
    people: [{ key: "h@test", staff_email: "h@test", name: "H", active: true, mapped: true, former: false, weekly_target: null }],
    person_months: [{
      key: "h@test", month: "2026-09-01", minutes: 1200, contract_minutes: { [K]: 600 }, rate: 20,
      segments: [
        { from: "2026-09-01", to: "2026-09-15", days: 15, minutes: 600, contract_minutes: { [K]: 600 }, rate: 10 },
        { from: "2026-09-16", to: "2026-09-30", days: 15, minutes: 600, contract_minutes: {}, rate: 20 },
      ],
    }],
    clients: [],
    work: [],
  }, extra || {});
}
t("mid-month raise: logged hours priced at the rate on their date", () => {
  const h = C.MH_capCompute(midMonth()).people[0];
  // 10h at 10 + 10h at 20 = 300 (the month-end rate alone would say 400).
  assert.strictEqual(h.pay, 300);
  // Hours split per segment: first half all contract, second half all MGB.
  assert.strictEqual(h.contractCost[K], 100);
  assert.strictEqual(h.mgbCost, 200);
});
t("mid-month raise: unlogged target hours spread over the days", () => {
  const f = midMonth();
  f.people[0].weekly_target = 7; // 7h/week x 30/7 = 30h = 1800 min; logged 1200, 600 padding
  const h = C.MH_capCompute(f).people[0];
  // 300 for the logged time + 5h at 10 + 5h at 20 = 450.
  assert.strictEqual(h.paidMinutes, 1800);
  assert.strictEqual(h.pay, 450);
  assert.strictEqual(Math.round((h.contractCost[K] + h.mgbCost) * 100), 45000);
});
t("mid-month rule: a fixed rule from the 16th covers only the second half", () => {
  const f = midMonth();
  f.allocations = [{ staff_email: "h@test", client_id: K, share: 1, method: "fixed", effective_from: "2026-09-16" }];
  const h = C.MH_capCompute(f).people[0];
  // First half by hours (all contract, 100), second half fixed 100% (200).
  assert.strictEqual(h.contractCost[K], 300);
  assert.strictEqual(h.mgbCost, 0);
  assert.ok(h.sources.fixed && h.sources.hours);
});
t("mid-month: a segment with no hours uses the month's hours ratio, not the fallback", () => {
  const f = midMonth();
  f.people[0].weekly_target = 7;
  f.allocations = [{ staff_email: "h@test", client_id: K, share: 0.9, method: "fallback", effective_from: "2026-01-01" }];
  f.person_months[0].segments[1].minutes = 0;
  f.person_months[0].minutes = 600;
  const h = C.MH_capCompute(f).people[0];
  assert.ok(!h.flags.fallback);
  // Month ratio 600/600 contract: the whole paid month sits on the contract.
  assert.strictEqual(h.mgbCost, 0);
  assert.strictEqual(h.contractCost[K], h.pay);
});
t("mid-month: a rate that starts mid-month leaves the first half estimated / uncosted", () => {
  const f = midMonth();
  f.person_months[0].segments[0].rate = null;
  const h = C.MH_capCompute(f).people[0];
  assert.ok(h.flags.uncosted);
  assert.strictEqual(h.pay, 200);
  f.person_months[0].segments[0].rate = 15;
  f.person_months[0].segments[0].estimated = true;
  const e = C.MH_capCompute(f).people[0];
  assert.ok(e.flags.estimated && !e.flags.uncosted);
  assert.strictEqual(e.pay, 350);
});
t("segments: no segments falls back to one month-long piece at the month-end rate", () => {
  const f = midMonth();
  delete f.person_months[0].segments;
  const h = C.MH_capCompute(f).people[0];
  assert.strictEqual(h.pay, 400);
  const s = C.MH_capSegments({ minutes: 5, rate: 3 }, { end: "2026-09-30", covered: 30 });
  assert.deepStrictEqual([s.length, s[0].from, s[0].days, s[0].rate], [1, "2026-09-30", 30, 3]);
});

t("compute: empty input is safe", () => {
  const r = C.MH_capCompute({});
  assert.deepStrictEqual(r.people, []);
  assert.strictEqual(r.totals.pay, 0);
  assert.strictEqual(r.split.length, 1);
});

console.log(`MH_capacity tests: ${n} passed`);
