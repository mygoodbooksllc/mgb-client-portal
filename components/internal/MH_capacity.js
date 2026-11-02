// ----------------------------------------------------------------------------
// MH_capacity: the pure logic behind MGB Home › Capacity (docs/mgb-home-spec.md,
// slice S6, OQ7). The page is MH_CapacityPage in MgbHome.jsx; its one read is
// capacity_inputs(p_from, p_to, p_basis, p_default_fees)
// (supabase/mgb-home-s6.sql), which refuses anyone without the MGB (internal)
// grant. No pay figures live here: rates come from that read only.
//
// Per person and month:
//   paid hours   target hours for the days covered (weekly target x days / 7),
//                or the logged hours when more; logged hours alone for someone
//                with no target (former staff, people not on staff)
//   pay cost     loaded rate (+ full-cost uplift) x paid hours, to the cent
//   contract     share of that cost on each contract client (IHH):
//                  1. a 'fixed' allocation row in effect wins (Carmen 100% IHH)
//                  2. else logged contract hours / all logged hours (Jesse)
//                  3. else, in a month with no logged hours, a 'fallback' row
//                  4. else 0 (all MGB), flagged "no hours"
//                shares above 100% in total are scaled down and flagged.
//   MGB cost     pay cost minus the contract costs (so the split sums exactly)
// Fee revenue per client and month (monthly fee x days covered / days) is
// shared among the people who logged time on that client, by minutes;
// revenue of a client nobody logged time on is "not carried by anyone".
//
//   MH_capRound2(x)                              cents
//   MH_capRowInEffect(allocs, email, cid, method, ymd)
//   MH_capShares(pm, allocs, contractIds, email, ymd) -> { shares, source, capped }
//   MH_capPaidMinutes(minutes, weeklyTarget, coveredDays)
//   MH_capSplitCost(total, shares, contractIds)  -> { contract: {cid: $}, mgb }
//   MH_capSplitRevenue(revenue, parts)           -> [$ per part], sums exactly
//   MH_capCompute(data)                          -> { people, split, totals, ... }
//
// Browser file (plain JS, no JSX); loads after MH_gate.js. Node tests:
// MH_capacity.test.js.
// ----------------------------------------------------------------------------

function MH__capNum(v) {
  var n = Number(v);
  return v == null || v === "" || !isFinite(n) ? null : n;
}

function MH_capRound2(x) {
  var n = MH__capNum(x);
  if (n == null) return null;
  // Round half away from zero on the cent, avoiding 1.005 -> 1.00 float drift.
  var s = n < 0 ? -1 : 1;
  return (s * Math.round(Math.abs(n) * 100 + 1e-7)) / 100;
}

// Latest allocation row for (email, client, method) with effective_from <= ymd.
function MH_capRowInEffect(allocs, email, cid, method, ymd) {
  var e = String(email || "").toLowerCase();
  var best = null;
  (allocs || []).forEach(function (a) {
    if (!a || String(a.staff_email || "").toLowerCase() !== e) return;
    if (a.client_id !== cid || (a.method || "fixed") !== method) return;
    var f = String(a.effective_from || "").slice(0, 10);
    if (!f || f > ymd) return;
    if (!best || f > String(best.effective_from).slice(0, 10)) best = a;
  });
  return best;
}

// pm = { minutes, contract_minutes: { cid: minutes } } for one person-month.
// source: 'fixed' | 'hours' | 'fallback' | 'none' (the strongest one used).
function MH_capShares(pm, allocs, contractIds, email, ymd) {
  var minutes = MH__capNum(pm && pm.minutes) || 0;
  var cm = (pm && pm.contract_minutes) || {};
  var shares = {};
  var used = { fixed: false, hours: false, fallback: false };
  (contractIds || []).forEach(function (cid) {
    var fixed = email ? MH_capRowInEffect(allocs, email, cid, "fixed", ymd) : null;
    if (fixed) {
      shares[cid] = Math.max(0, Math.min(1, MH__capNum(fixed.share) || 0));
      used.fixed = true;
      return;
    }
    if (minutes > 0) {
      shares[cid] = Math.max(0, MH__capNum(cm[cid]) || 0) / minutes;
      used.hours = true;
      return;
    }
    var fb = email ? MH_capRowInEffect(allocs, email, cid, "fallback", ymd) : null;
    if (fb) {
      shares[cid] = Math.max(0, Math.min(1, MH__capNum(fb.share) || 0));
      used.fallback = true;
      return;
    }
    shares[cid] = 0;
  });
  var sum = 0;
  Object.keys(shares).forEach(function (k) { sum += shares[k]; });
  var capped = false;
  if (sum > 1 + 1e-9) {
    Object.keys(shares).forEach(function (k) { shares[k] = shares[k] / sum; });
    capped = true;
  }
  var source = used.fixed ? "fixed" : used.fallback ? "fallback" : minutes > 0 ? "hours" : "none";
  return { shares: shares, source: source, capped: capped };
}

function MH_capPaidMinutes(minutes, weeklyTarget, coveredDays) {
  var m = Math.max(0, MH__capNum(minutes) || 0);
  var t = MH__capNum(weeklyTarget);
  var d = MH__capNum(coveredDays);
  if (t == null || d == null) return m;
  var target = Math.round((t * 60 * d) / 7);
  return Math.max(m, target);
}

// total (dollars) split by shares; contract parts to the cent, MGB gets the rest.
function MH_capSplitCost(total, shares, contractIds) {
  var tot = MH_capRound2(total);
  var out = { contract: {}, mgb: null };
  if (tot == null) return out;
  var used = 0;
  (contractIds || []).forEach(function (cid) {
    var c = MH_capRound2(tot * ((shares && shares[cid]) || 0));
    out.contract[cid] = c;
    used += c;
  });
  out.mgb = MH_capRound2(tot - used);
  return out;
}

// revenue (dollars) shared by weights; each to the cent, the largest part
// takes the rounding remainder so the parts sum to the rounded revenue.
function MH_capSplitRevenue(revenue, weights) {
  var r = MH_capRound2(revenue);
  var w = (weights || []).map(function (x) { return Math.max(0, MH__capNum(x) || 0); });
  var W = w.reduce(function (a, b) { return a + b; }, 0);
  if (r == null || !W) return w.map(function () { return 0; });
  var parts = w.map(function (x) { return MH_capRound2((r * x) / W); });
  var sum = parts.reduce(function (a, b) { return a + b; }, 0);
  var big = 0;
  w.forEach(function (x, i) { if (x > w[big]) big = i; });
  parts[big] = MH_capRound2(parts[big] + (r - sum));
  return parts;
}

function MH__capMonthEnd(month, days, to) {
  var m = String(month || "").slice(0, 7);
  var end = m + "-" + String(MH__capNum(days) || 28).padStart(2, "0");
  var t = String(to || "").slice(0, 10);
  return t && t < end ? t : end;
}

// data = capacity_inputs() result. Returns everything the page shows.
function MH_capCompute(data) {
  var d = data || {};
  var contracts = (d.contracts || []).map(function (c) {
    return { client_id: c.client_id, label: c.label || c.name || c.client_id, name: c.name || c.label || c.client_id };
  });
  var cids = contracts.map(function (c) { return c.client_id; });
  var isContract = {};
  cids.forEach(function (c) { isContract[c] = true; });
  var allocs = d.allocations || [];
  var months = {};
  (d.months || []).forEach(function (m) {
    var key = String(m.month).slice(0, 10);
    months[key] = { days: MH__capNum(m.days) || 0, covered: MH__capNum(m.covered_days) || 0, end: MH__capMonthEnd(m.month, m.days, d.to) };
  });

  var people = {};
  var order = [];
  (d.people || []).forEach(function (p) {
    people[p.key] = {
      key: p.key,
      name: p.name || p.staff_email || "Unknown",
      email: p.staff_email || null,
      role: p.role || null,
      active: !!p.active,
      former: !!p.former,
      mapped: !!p.mapped,
      weeklyTarget: MH__capNum(p.weekly_target),
      minutes: 0,
      targetMinutes: null,
      paidMinutes: 0,
      pay: 0,
      contractCost: {},
      mgbCost: 0,
      revenue: 0,
      contractRevenue: {},
      mgbRevenue: 0,
      sources: {},
      flags: { estimated: false, former: false, uncosted: false, fallback: false, noHours: false, capped: false },
    };
    cids.forEach(function (c) { people[p.key].contractCost[c] = 0; people[p.key].contractRevenue[c] = 0; });
    order.push(p.key);
  });

  // Cost, person by month.
  (d.person_months || []).forEach(function (pm) {
    var p = people[pm.key];
    var mk = String(pm.month).slice(0, 10);
    var mo = months[mk];
    if (!p || !mo) return;
    var mins = Math.max(0, MH__capNum(pm.minutes) || 0);
    p.minutes += mins;
    if (p.weeklyTarget != null) {
      p.targetMinutes = (p.targetMinutes || 0) + Math.round((p.weeklyTarget * 60 * mo.covered) / 7);
    }
    var paid = MH_capPaidMinutes(mins, p.weeklyTarget, mo.covered);
    p.paidMinutes += paid;
    var rate = MH__capNum(pm.rate);
    if (rate == null) {
      if (paid > 0) p.flags.uncosted = true;
      return;
    }
    if (pm.estimated) p.flags.estimated = true;
    if (pm.former) p.flags.former = true;
    var pay = MH_capRound2((paid / 60) * rate);
    var sh = MH_capShares(pm, allocs, cids, p.email, mo.end);
    if (sh.capped) p.flags.capped = true;
    p.sources[sh.source] = true;
    if (sh.source === "fallback") p.flags.fallback = true;
    if (sh.source === "none" && paid > 0 && cids.length) p.flags.noHours = true;
    var split = MH_capSplitCost(pay, sh.shares, cids);
    p.pay = MH_capRound2(p.pay + pay);
    cids.forEach(function (c) { p.contractCost[c] = MH_capRound2(p.contractCost[c] + split.contract[c]); });
    p.mgbCost = MH_capRound2(p.mgbCost + split.mgb);
  });

  // Revenue, client by month, shared by minutes.
  var clients = {};
  (d.clients || []).forEach(function (c) { clients[c.client_id] = c; });
  var workBy = {};
  (d.work || []).forEach(function (w) {
    var k = w.client_id + "|" + String(w.month).slice(0, 10);
    (workBy[k] = workBy[k] || []).push(w);
  });
  var clientRevenue = {};
  var uncarried = { contract: {}, mgb: 0 };
  cids.forEach(function (c) { uncarried.contract[c] = 0; });
  var missingFees = 0;
  Object.keys(clients).forEach(function (cid) {
    var c = clients[cid];
    var fee = MH__capNum(c.monthly_fee);
    if (fee == null) { missingFees++; return; }
    var contract = !!isContract[cid];
    Object.keys(months).forEach(function (mk) {
      var mo = months[mk];
      if (!mo.days) return;
      var rev = MH_capRound2((fee * mo.covered) / mo.days);
      clientRevenue[cid] = MH_capRound2((clientRevenue[cid] || 0) + rev);
      var ws = (workBy[cid + "|" + mk] || []).filter(function (w) { return people[w.key] && (MH__capNum(w.minutes) || 0) > 0; });
      if (!ws.length) {
        if (contract) uncarried.contract[cid] = MH_capRound2(uncarried.contract[cid] + rev);
        else uncarried.mgb = MH_capRound2(uncarried.mgb + rev);
        return;
      }
      var parts = MH_capSplitRevenue(rev, ws.map(function (w) { return w.minutes; }));
      ws.forEach(function (w, i) {
        var p = people[w.key];
        p.revenue = MH_capRound2(p.revenue + parts[i]);
        if (contract) p.contractRevenue[cid] = MH_capRound2(p.contractRevenue[cid] + parts[i]);
        else p.mgbRevenue = MH_capRound2(p.mgbRevenue + parts[i]);
      });
    });
  });

  var list = order.map(function (k) {
    var p = people[k];
    p.utilization = p.targetMinutes ? p.minutes / p.targetMinutes : null;
    p.margin = MH_capRound2(p.revenue - p.pay);
    p.marginPct = p.revenue ? Math.round(((p.revenue - p.pay) / p.revenue) * 1000) / 10 : null;
    var contractTotal = 0;
    cids.forEach(function (c) { contractTotal += p.contractCost[c]; });
    p.contractShare = p.pay ? contractTotal / p.pay : null;
    return p;
  }).filter(function (p) { return p.minutes > 0 || p.pay > 0 || p.revenue > 0 || p.weeklyTarget != null; });

  // The contract vs MGB split.
  var split = contracts.map(function (c) {
    var revenue = MH_capRound2(clientRevenue[c.client_id] || 0);
    var cost = MH_capRound2(list.reduce(function (a, p) { return a + (p.contractCost[c.client_id] || 0); }, 0));
    return { key: "contract:" + c.client_id, client_id: c.client_id, label: c.label, name: c.name, contract: true,
             revenue: revenue, cost: cost, margin: MH_capRound2(revenue - cost),
             marginPct: revenue ? Math.round(((revenue - cost) / revenue) * 1000) / 10 : null };
  });
  var mgbRevenue = 0;
  Object.keys(clientRevenue).forEach(function (cid) { if (!isContract[cid]) mgbRevenue += clientRevenue[cid]; });
  mgbRevenue = MH_capRound2(mgbRevenue);
  var mgbCost = MH_capRound2(list.reduce(function (a, p) { return a + (p.mgbCost || 0); }, 0));
  split.push({ key: "mgb", label: "MGB clients", name: "MGB clients and firm time", contract: false,
               revenue: mgbRevenue, cost: mgbCost, margin: MH_capRound2(mgbRevenue - mgbCost),
               marginPct: mgbRevenue ? Math.round(((mgbRevenue - mgbCost) / mgbRevenue) * 1000) / 10 : null });

  var totals = { minutes: 0, targetMinutes: 0, paidMinutes: 0, pay: 0, revenue: 0 };
  list.forEach(function (p) {
    totals.minutes += p.minutes;
    totals.targetMinutes += p.targetMinutes || 0;
    totals.paidMinutes += p.paidMinutes;
    totals.pay = MH_capRound2(totals.pay + p.pay);
  });
  totals.revenue = MH_capRound2(split.reduce(function (a, s) { return a + s.revenue; }, 0));
  totals.margin = MH_capRound2(totals.revenue - totals.pay);
  totals.marginPct = totals.revenue ? Math.round((totals.margin / totals.revenue) * 1000) / 10 : null;
  totals.utilization = totals.targetMinutes ? totals.minutes / totals.targetMinutes : null;

  return { contracts: contracts, people: list, split: split, totals: totals, uncarried: uncarried,
           missingFees: missingFees, from: d.from || null, to: d.to || null, basis: d.basis || "staff" };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    MH_capRound2: MH_capRound2,
    MH_capRowInEffect: MH_capRowInEffect,
    MH_capShares: MH_capShares,
    MH_capPaidMinutes: MH_capPaidMinutes,
    MH_capSplitCost: MH_capSplitCost,
    MH_capSplitRevenue: MH_capSplitRevenue,
    MH_capCompute: MH_capCompute,
  };
}
