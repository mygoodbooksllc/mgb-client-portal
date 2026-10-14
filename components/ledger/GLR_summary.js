// ----------------------------------------------------------------------------
// GLR_summary: the client summary (spec 4.3, D5: a template, no AI).
//
//   buildFindings(input) -> findings (stored as gl_review_summaries.findings)
//   findingsToSummary(findings, ctx) -> { variant, body, needsGreetingName }
//
// buildFindings input: { period: 'YYYY-MM', flags (runChecks flags; each may
//   carry status 'open'|'asked'|'cleared'|'fixed' and question text from
//   transaction_questions; default 'open'), lines, recon (reconciliation()),
//   compare (compareMonth() rows), holding (holdingTotals() for the month) }
//
// findingsToSummary ctx: { greetingName, bookkeeperName, clientName,
//   orgType ('church'|'business'|'nonprofit'|...), reconciled (the Close
//   tab's reconciled check, used when the pull has no cleared data) }
//
// Variants (Bailley reviews the wording before it ships, spec 13.5):
//   action: the client has something to do (questions, items in holding
//           accounts, a loan statement)
//   minor:  open items the bookkeeper is handling, or old uncleared items
//   clean:  nothing open
// First person as the bookkeeper. American spelling. Never mentions fees,
// rates or pricing. Wording depends only on findings + ctx (no clock, no
// randomness), so the same month always drafts the same text.
// ----------------------------------------------------------------------------
(function (root, factory) {
  if (typeof module === "object" && module && module.exports) module.exports = factory(require("./GLR_config.js"));
  else root.GLR_summary = factory(root.GLR_config);
})(typeof window !== "undefined" ? window : globalThis, function (C) {
  "use strict";

  var FINDINGS_VERSION = 1;
  var OPEN = { open: true };
  var plural = function (n, one, many) { return n + " " + (n === 1 ? one : many || one + "s"); };
  var money = function (n) { return C.money(n); };
  var usDate = function (d) { var p = String(d || "").split("-"); return p.length === 3 ? p[1] + "/" + p[2] + "/" + p[0] : ""; };
  var clean = function (s) { return String(s == null ? "" : s).replace(/\s+/g, " ").trim(); };

  function buildFindings(input) {
    input = input || {};
    var period = input.period;
    var flags = (input.flags || []).filter(function (f) { return !period || !f.period || f.period.slice(0, 7) === period || f.status === "asked"; });
    var st = function (f) { return f.status || "open"; };
    var counts = { open: 0, asked: 0, cleared: 0, fixed: 0, high_open: 0, medium_open: 0, low_open: 0, by_type: {} };
    flags.forEach(function (f) {
      var s = st(f);
      if (counts[s] != null) counts[s] += 1;
      if (OPEN[s]) {
        counts[f.severity + "_open"] = (counts[f.severity + "_open"] || 0) + 1;
        counts.by_type[f.flag_type] = (counts.by_type[f.flag_type] || 0) + 1;
      }
    });
    var questions = flags.filter(function (f) { return st(f) === "asked"; }).map(function (f) {
      return {
        date: f.txn_date || null,
        name: f.name || "",
        amount: f.amount != null ? f.amount : null,
        text: clean(f.question || f.question_text || ""),
        flag_type: f.flag_type,
      };
    }).sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); });

    var monthLines = (input.lines || []).filter(function (l) { return l && l.date && (!period || C.ym(l.date) === period); });
    var txnKeys = {};
    monthLines.forEach(function (l) { txnKeys[l.key] = true; });

    var holding = (input.holding || []).filter(function (h) { return h.count > 0; }).map(function (h) {
      return { acct: h.acct, count: h.count, total: h.total };
    });

    var recon = input.recon || { available: false, accounts: [] };
    var stale = (recon.accounts || []).filter(function (a) { return a.kind !== "loan" && !a.pass_through && a.stale_count > 0; });
    var loans = (recon.accounts || []).filter(function (a) { return a.loan_uncleared && !a.pass_through; });

    var changes = (input.compare || []).filter(function (r) { return r.status !== "ok"; }).map(function (r) {
      return {
        acct: r.acct, classification: r.classification, status: r.status,
        cur: r.cur, avg: r.avg, diff: r.diff, oneTime: !!r.oneTime, seasonal: !!r.seasonal,
        top_name: r.top && r.top[0] ? r.top[0].name || "" : "",
      };
    });

    return {
      version: FINDINGS_VERSION,
      checks_version: C.CHECKS_VERSION,
      period: period || null,
      month_label: period ? C.monthLabel(period) : "",
      line_count: monthLines.length,
      txn_count: Object.keys(txnKeys).length,
      flags: counts,
      questions: questions,
      holding: holding,
      holding_count: holding.reduce(function (s, h) { return s + h.count; }, 0),
      holding_total: Math.round(holding.reduce(function (s, h) { return s + h.total; }, 0) * 100) / 100,
      recon: {
        available: !!recon.available,
        clean: recon.available ? stale.length === 0 && loans.length === 0 : null,
        stale: stale.map(function (a) { return { acct: a.acct, count: a.stale_count, total: a.stale_total, oldest_date: a.oldest_date }; }),
        stale_count: stale.reduce(function (s, a) { return s + a.stale_count; }, 0),
        stale_total: Math.round(stale.reduce(function (s, a) { return s + a.stale_total; }, 0) * 100) / 100,
        loan_issue: loans.length > 0,
        loan_accounts: loans.map(function (a) { return a.acct; }),
      },
      trends: {
        changes: changes,
        in_range_count: (input.compare || []).filter(function (r) { return r.status === "ok"; }).length,
      },
    };
  }

  function variantOf(f) {
    if ((f.questions || []).length || f.holding_count > 0 || (f.recon && f.recon.loan_issue)) return "action";
    if ((f.flags && f.flags.open > 0) || (f.recon && f.recon.stale_count > 0)) return "minor";
    return "clean";
  }

  // Account names lose their leading number ("6620 Ministry Supplies").
  function acctLabel(a) { return clean(a).replace(/^\d{3,6}(?:[.\-]\d+)?\s+/, ""); }

  function trendSentence(c, church) {
    var name = acctLabel(c.acct);
    var income = c.classification === "Revenue";
    var why = c.oneTime ? (c.top_name ? ", mostly from one " + (income ? "gift or deposit" : "payment") + " (" + c.top_name + ")" : ", mostly from one larger item")
      : c.seasonal ? ", which matches the same month last year" : "";
    if (c.status === "miss") {
      return name + " had no activity this month, though it usually does" + (c.seasonal ? " (last year was the same)" : "") + ".";
    }
    if (c.status === "new") return name + " had its first activity this year (" + money(Math.abs(c.cur)) + ")" + why + ".";
    var dir = c.status === "up" ? "higher" : "lower";
    var label = income && church && /offering|tithe|giving|donation|contribution/i.test(name) ? name + " (giving)" : name;
    return label + " was " + dir + " than usual: " + money(Math.abs(c.cur)) + " compared with a monthly average of " + money(Math.abs(c.avg)) + why + ".";
  }

  var OPENERS = [
    "I finished reviewing your books for %s.",
    "I've completed the review of your books for %s.",
    "I reviewed your books for %s.",
  ];

  function findingsToSummary(findings, ctx) {
    var f = findings || {};
    ctx = ctx || {};
    var variant = variantOf(f);
    var greetingName = clean(ctx.greetingName);
    var church = /church|ministr|congregation/i.test(String(ctx.orgType || ""));
    var month = f.month_label || (f.period ? C.monthLabel(f.period) : "this month");
    var idx = f.period ? C.monthIndex(f.period) % OPENERS.length : 0;
    var opener = OPENERS[idx].replace("%s", month);
    var reconciled = f.recon && f.recon.available ? f.recon.clean && !f.recon.stale_count : !!ctx.reconciled;
    var out = [];

    out.push(greetingName ? "Hello " + greetingName + "," : "Hello,");

    if (variant === "clean") {
      out.push(opener + " Everything looks in order" + (reconciled ? ", the bank accounts are reconciled," : "") + " and there's nothing you need to do this month.");
    } else if (variant === "minor") {
      var parts = [];
      if (f.flags && f.flags.open > 0) {
        parts.push("I found " + (f.flags.open === 1 ? "one small item" : plural(f.flags.open, "small item")) + " that I'm cleaning up on my end. You don't need to do anything about " + (f.flags.open === 1 ? "it" : "them") + ".");
      }
      out.push((opener + " Overall things look good. " + parts.join(" ")).trim());
      if (f.recon && f.recon.stale_count > 0) {
        var st = f.recon.stale.map(function (s) { return acctLabel(s.acct); });
        out.push("A few older items on " + st.join(" and ") + " (" + plural(f.recon.stale_count, "item") + ", " + money(f.recon.stale_total) +
          ") haven't cleared the bank yet. I'm keeping an eye on them. If you know of a check that was never cashed or a deposit that didn't go through, please let me know.");
      }
    } else {
      out.push(opener + " I need your help with a few things before I can finish the month.");
      var n = 1;
      var list = [];
      (f.questions || []).forEach(function (q) {
        var head = [usDate(q.date), q.name, q.amount != null ? money(Math.abs(q.amount)) : ""].filter(Boolean).join(", ");
        list.push(n++ + ". " + (head ? head + ": " : "") + (q.text || "Can you tell me what this was for?"));
      });
      if (f.holding_count > 0) {
        list.push(n++ + ". " + (f.holding_count === 1 ? "One transaction" : plural(f.holding_count, "transaction")) + " totaling " + money(f.holding_total) +
          " couldn't be categorized yet. I'll send the details so you can tell me what " + (f.holding_count === 1 ? "it was" : "they were") + " for.");
      }
      if (f.recon && f.recon.loan_issue) {
        var la = (f.recon.loan_accounts || []).map(acctLabel);
        list.push(n++ + ". Please send the latest statement for " + (la.length ? la.join(" and ") : "the loan") + " so I can reconcile it.");
      }
      out.push(list.join("\n"));
      out.push("You can reply in the portal or just answer this message, whichever is easier.");
      if (f.flags && f.flags.open > 0) {
        out.push("I also found " + (f.flags.open === 1 ? "one small item" : plural(f.flags.open, "small item")) + " that I'm handling myself, so there's nothing else you need to do.");
      }
    }

    var changes = (f.trends && f.trends.changes) || [];
    if (changes.length) {
      var shown = changes.slice(0, 3).map(function (c) { return trendSentence(c, church); });
      out.push("Compared with the rest of the year: " + shown.join(" ") + (changes.length > 3 ? " A few other accounts moved a little as well." : ""));
    } else if (f.trends && f.trends.in_range_count > 0) {
      out.push((church ? "Giving and spending" : "Income and spending") + " were in line with the rest of the year.");
    }

    out.push("Thank you,\n" + (clean(ctx.bookkeeperName) || "Your bookkeeper"));

    return {
      variant: variant,
      body: out.join("\n\n").slice(0, 8000),
      needsGreetingName: !greetingName,
    };
  }

  return { buildFindings: buildFindings, findingsToSummary: findingsToSummary, variantOf: variantOf, FINDINGS_VERSION: FINDINGS_VERSION };
});
