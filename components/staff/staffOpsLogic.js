// Staff operations: pure rules shared by the staff ops components
// (HoursBudget.jsx, ReplyTimes.jsx, Coverage.jsx, Deadlines.jsx,
// HealthBoard.jsx, SopFreshness.jsx, StaffOnboarding.jsx) and the node test
// (staffOpsLogic.test.js). No React, no Supabase.

// ---- Hours budget (supabase/client-hours-budget.sql)
var OPS_BUDGET_WARN = 0.8; // "near" from 80% of the budget
var OPS_BUDGET_OVER = 1.0; // "over" from 100%

// minutes: QuickBooks Time minutes used; budgetHours: client_profile
// .monthly_hours_budget. No budget (null, blank, 0 or bad) => null, so
// nothing is flagged. Hours unknown (null) => null too: unknown never matches.
function OPS_budgetStatus(minutes, budgetHours) {
  var b = budgetHours == null || budgetHours === "" ? NaN : Number(budgetHours);
  if (!(b > 0)) return null;
  if (minutes == null || isNaN(Number(minutes))) return null;
  var used = Number(minutes) / 60;
  var ratio = used / b;
  var state = ratio >= OPS_BUDGET_OVER ? "over" : ratio >= OPS_BUDGET_WARN ? "near" : "ok";
  return { used: used, budget: b, ratio: ratio, pct: Math.round(ratio * 100), state: state };
}

// HC rule "budget": any | near (80% or more, includes over) | over.
function OPS_budgetMatches(rule, status) {
  if (!rule || rule === "any") return true;
  if (!status) return false;
  if (rule === "over") return status.state === "over";
  if (rule === "near") return status.state === "near" || status.state === "over";
  if (rule === "ok") return status.state === "ok";
  return true;
}

// ---- Reply times (supabase/client-reply-times.sql)
// The goal is a constant in calendar hours (nights and weekends count). The
// RPC has its own copy (v_goal); change both together.
var OPS_REPLY_GOAL_HOURS = 24;

// "45 min", "3.2 h", "2.1 days". null/blank => "—".
function OPS_fmtWait(hours) {
  if (hours == null || hours === "" || isNaN(Number(hours))) return "\u2014";
  var h = Math.max(0, Number(hours));
  if (h < 1) return Math.max(1, Math.round(h * 60)) + " min";
  if (h < 48) {
    var r = Math.round(h * 10) / 10;
    return (r % 1 === 0 ? String(r) : r.toFixed(1)) + " h";
  }
  var d = Math.round((h / 24) * 10) / 10;
  return (d % 1 === 0 ? String(d) : d.toFixed(1)) + " days";
}

function OPS_isoDay(dt) {
  var m = dt.getMonth() + 1, d = dt.getDate();
  return dt.getFullYear() + "-" + (m < 10 ? "0" : "") + m + "-" + (d < 10 ? "0" : "") + d;
}

// Reporting periods for the Reply times tab. today = "YYYY-MM-DD".
// "month" = 1st of this month..today, "last-month" = last calendar month,
// "90" = the 90 days ending today.
function OPS_replyPeriod(key, today) {
  var p = String(today).split("-").map(Number);
  var t = new Date(p[0], p[1] - 1, p[2]);
  if (key === "last-month") {
    return { from: OPS_isoDay(new Date(p[0], p[1] - 2, 1)), to: OPS_isoDay(new Date(p[0], p[1] - 1, 0)) };
  }
  if (key === "90") {
    return { from: OPS_isoDay(new Date(p[0], p[1] - 1, p[2] - 89)), to: OPS_isoDay(t) };
  }
  return { from: OPS_isoDay(new Date(p[0], p[1] - 1, 1)), to: OPS_isoDay(t) };
}

// ---- Time off and coverage (supabase/staff-time-off.sql)
// rows: staff_time_off rows {staff_email, starts_on, ends_on, cancelled_at}.
// Dates are "YYYY-MM-DD" strings, so plain string compares order them.
function OPS_addDays(day, n) {
  var p = String(day).split("-").map(Number);
  return OPS_isoDay(new Date(p[0], p[1] - 1, p[2] + n));
}

// The last day someone is out, if they're out on `today`. Back-to-back or
// overlapping entries chain (out Mon-Fri plus the next Mon-Tue => Tue).
// Not out today => null.
function OPS_outUntil(rows, email, today) {
  var me = String(email || "").toLowerCase();
  if (!me) return null;
  var mine = (rows || []).filter(function (r) {
    return !r.cancelled_at && String(r.staff_email || "").toLowerCase() === me;
  });
  var cur = null;
  mine.forEach(function (r) {
    if (r.starts_on <= today && r.ends_on >= today && (!cur || r.ends_on > cur)) cur = r.ends_on;
  });
  if (!cur) return null;
  var grew = true;
  while (grew) {
    grew = false;
    for (var i = 0; i < mine.length; i++) {
      var r = mine[i];
      if (r.starts_on <= OPS_addDays(cur, 1) && r.ends_on > cur) {
        cur = r.ends_on;
        grew = true;
      }
    }
  }
  return cur;
}

// Entries still to come or under way (not cancelled, not over), soonest first.
function OPS_upcomingTimeOff(rows, today, email) {
  var me = email ? String(email).toLowerCase() : null;
  return (rows || [])
    .filter(function (r) {
      return !r.cancelled_at && r.ends_on >= today && (!me || String(r.staff_email || "").toLowerCase() === me);
    })
    .slice()
    .sort(function (a, b) {
      return a.starts_on < b.starts_on ? -1 : a.starts_on > b.starts_on ? 1 : 0;
    });
}

// Problems with a time-off entry before saving, or null when it's fine.
function OPS_timeOffError(startsOn, endsOn, today) {
  if (!startsOn || !endsOn) return "Pick the first and last day.";
  if (endsOn < startsOn) return "The last day can't be before the first day.";
  if (endsOn < today) return "That's already over. Pick dates from today on.";
  var p1 = String(startsOn).split("-").map(Number), p2 = String(endsOn).split("-").map(Number);
  var days = Math.round((new Date(p2[0], p2[1] - 1, p2[2]) - new Date(p1[0], p1[1] - 1, p1[2])) / 864e5);
  if (days > 366) return "Keep it to a year or less.";
  return null;
}

// Coverage tab wording for coverage_overview's backup_access.
var OPS_BACKUP_ACCESS = {
  none_set: { label: "No backup set", tone: "bad" },
  not_staff: { label: "Backup isn't active staff", tone: "bad" },
  admin: { label: "Has access (admin)", tone: "good" },
  assigned: { label: "Has access (assigned)", tone: "good" },
  temporary: { label: "Temporary access", tone: "good" },
  none: { label: "No access", tone: "bad" },
};

// ---- Firm deadline calendar (supabase/firm-deadlines.sql)
// Rules come from firm_deadline_rules; dates are worked out here. Everything
// is a "YYYY-MM-DD" string. The seeded dates are a starting point to verify,
// not tax advice. Weekends roll to the next Monday; federal holidays don't.
var OPS_DEADLINE_SOON_DAYS = 7;
var OPS_MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// y, m (1-based, may run past 12), d (clamped to the month's last day).
function OPS_ymd(y, m, d) {
  y = y + Math.floor((m - 1) / 12);
  m = ((((m - 1) % 12) + 12) % 12) + 1;
  var last = new Date(y, m, 0).getDate();
  return OPS_isoDay(new Date(y, m - 1, Math.min(d, last)));
}

function OPS_dayDiff(a, b) {
  var p = String(a).split("-").map(Number), q = String(b).split("-").map(Number);
  return Math.round((new Date(p[0], p[1] - 1, p[2]) - new Date(q[0], q[1] - 1, q[2])) / 864e5);
}

// Saturday and Sunday move to Monday.
function OPS_rollWeekend(day) {
  var p = String(day).split("-").map(Number);
  var dow = new Date(p[0], p[1] - 1, p[2]).getDay();
  return dow === 6 ? OPS_addDays(day, 2) : dow === 0 ? OPS_addDays(day, 1) : day;
}

// "12-31" or "6/30" => 12 / 6, else null.
function OPS_fyeMonth(fye) {
  var m = /^\s*(\d{1,2})\s*[-\/]\s*(\d{1,2})\s*$/.exec(String(fye || ""));
  if (!m) return null;
  var mo = Number(m[1]);
  return mo >= 1 && mo <= 12 ? mo : null;
}

// Does the rule apply to this client? A live override that isn't "skip"
// always turns it on (that's how an opt-in rule or an exception is added).
function OPS_ruleApplies(rule, client, override, forced) {
  if (!rule || rule.active === false || !client) return false;
  if (override && override.skip) return false;
  if (override || forced) return true;
  if (rule.opt_in) return false;
  var ent = String(client.entityType || "nonprofit").toLowerCase();
  if (rule.applies_entity_type && rule.applies_entity_type.length &&
      !rule.applies_entity_type.some(function (e) { return String(e).toLowerCase() === ent; })) return false;
  var org = String(client.orgType || "").toLowerCase();
  if (rule.applies_org_type_excludes && rule.applies_org_type_excludes.some(function (e) { return String(e).toLowerCase() === org; })) return false;
  if (rule.requires_payroll === true && !client.payrollAddOn) return false;
  if (rule.requires_payroll === false && client.payrollAddOn) return false;
  return true;
}

// Every occurrence of a rule with a nominal date in fromYear-1 .. toYear+1:
// [{period_key, period_label, nominal, assumed}].
function OPS_ruleOccurrences(rule, fye, fromYear, toYear) {
  var r = (rule && rule.due_rule) || {};
  var out = [];
  for (var y = fromYear - 1; y <= toYear + 1; y++) {
    if (rule.cadence === "quarterly") {
      (r.dates || []).slice(0, 4).forEach(function (dt, i) {
        var q = i + 1;
        var dueY = Number(dt.month) < q * 3 ? y + 1 : y;
        out.push({ period_key: y + "-Q" + q, period_label: "Q" + q + " " + y, nominal: OPS_ymd(dueY, Number(dt.month), Number(dt.day)) });
      });
    } else if (rule.cadence === "monthly") {
      var off = r.offset_months == null ? 1 : Number(r.offset_months);
      for (var m = 1; m <= 12; m++) {
        out.push({
          period_key: y + "-" + (m < 10 ? "0" : "") + m,
          period_label: OPS_MONTHS_SHORT[m - 1] + " " + y,
          nominal: OPS_ymd(y, m + off, Number(r.day)),
        });
      }
    } else if (r.fye_months != null) {
      var fm = OPS_fyeMonth(fye);
      if (fm) {
        out.push({
          period_key: "FY" + y,
          period_label: "FY ending " + OPS_MONTHS_SHORT[fm - 1] + " " + y,
          nominal: OPS_ymd(y, fm + Number(r.fye_months), Number(r.day)),
        });
      } else {
        out.push({
          period_key: "FY" + (y - 1),
          period_label: "FY " + (y - 1) + " (no fiscal year end set)",
          nominal: OPS_ymd(y, Number(r.fallback_month), Number(r.fallback_day)),
          assumed: true,
        });
      }
    } else {
      out.push({ period_key: String(y), period_label: null, nominal: OPS_ymd(y, Number(r.month), Number(r.day)) });
    }
  }
  return out;
}

// Older key dates on the client profile act as date overrides.
var OPS_LEGACY_DEADLINE_FIELDS = { "990": "form_990_due", "1099-nec": "filing_1099_due" };

// All deadlines for the clients between from and to (inclusive), soonest
// first. opts: {rules, clients, profiles: {client_id: profile}, overrides,
// statuses, from, to, today}.
function OPS_deadlineItems(opts) {
  var rules = (opts.rules || []).filter(function (r) { return r.active !== false; });
  var profiles = opts.profiles || {};
  var from = opts.from, to = opts.to, today = opts.today;
  var fromY = Number(String(from).slice(0, 4)), toY = Number(String(to).slice(0, 4));
  var ovr = {};
  (opts.overrides || []).forEach(function (o) {
    if (!o.removed_at) ovr[o.client_id + "|" + o.rule_key] = o;
  });
  var filed = {};
  (opts.statuses || []).forEach(function (st) {
    if (!st.undone_at) filed[st.client_id + "|" + st.rule_key + "|" + st.period_key] = st;
  });
  var items = [];
  (opts.clients || []).forEach(function (c) {
    var prof = profiles[c.id] || {};
    rules.forEach(function (rule) {
      var o = ovr[c.id + "|" + rule.key] || null;
      var legacyField = OPS_LEGACY_DEADLINE_FIELDS[rule.key];
      var legacy = legacyField && prof[legacyField] ? String(prof[legacyField]).slice(0, 10) : null;
      var fixed = rule.cadence === "annual" ? (o && o.due_date) || legacy : null;
      if (!OPS_ruleApplies(rule, c, o, !!fixed)) return;
      var occ = OPS_ruleOccurrences(rule, prof.fiscal_year_end, fromY, toY).map(function (x) {
        var due = OPS_rollWeekend(x.nominal);
        return Object.assign({}, x, { due: due, rolled: due !== x.nominal, source: null });
      });
      if (fixed) {
        var best = null, bestGap = 1e9;
        occ.forEach(function (x) {
          var gap = Math.abs(OPS_dayDiff(x.nominal, fixed));
          if (gap < bestGap) { best = x; bestGap = gap; }
        });
        var src = o && o.due_date ? "override" : "key-dates";
        if (best && bestGap <= 200) {
          best.due = fixed; best.rolled = false; best.source = src;
        } else {
          occ.push({ period_key: "D" + fixed, period_label: null, nominal: fixed, due: fixed, rolled: false, source: src });
        }
      }
      occ.forEach(function (x) {
        if (x.due < from || x.due > to) return;
        var st = filed[c.id + "|" + rule.key + "|" + x.period_key] || null;
        var state = st ? "filed" : x.due < today ? "overdue" : OPS_dayDiff(x.due, today) <= OPS_DEADLINE_SOON_DAYS ? "soon" : "upcoming";
        items.push({
          id: c.id + "|" + rule.key + "|" + x.period_key,
          client_id: c.id,
          client_name: c.name || c.id,
          assignee_email: c.assignedBookkeeper && c.assignedBookkeeper.email ? String(c.assignedBookkeeper.email).toLowerCase() : null,
          rule_key: rule.key,
          rule_name: rule.name,
          cadence: rule.cadence,
          period_key: x.period_key,
          period_label: x.period_label,
          due: x.due,
          nominal: x.nominal,
          rolled: x.rolled,
          assumed: !!x.assumed,
          source: x.source,
          note: o && o.note ? o.note : null,
          status: st,
          state: state,
        });
      });
    });
  });
  items.sort(function (a, b) {
    return a.due < b.due ? -1 : a.due > b.due ? 1 : a.client_name < b.client_name ? -1 : a.client_name > b.client_name ? 1 : a.rule_key < b.rule_key ? -1 : 1;
  });
  return items;
}

// "Mon 15th"-style plain-English rule summary for the admin list.
function OPS_describeDueRule(rule) {
  var r = (rule && rule.due_rule) || {};
  var md = function (m, d) { return OPS_MONTHS_SHORT[Number(m) - 1] + " " + Number(d); };
  if (rule.cadence === "quarterly") return "Quarterly: " + (r.dates || []).map(function (x) { return md(x.month, x.day); }).join(", ");
  if (rule.cadence === "monthly") {
    var off = r.offset_months == null ? 1 : Number(r.offset_months);
    return "Monthly: day " + Number(r.day) + (off === 0 ? " of the same month" : off === 1 ? " of the next month" : " of the month " + off + " months later");
  }
  if (r.fye_months != null) return "Day " + Number(r.day) + " of month " + Number(r.fye_months) + " after the fiscal year end (" + md(r.fallback_month, r.fallback_day) + " if none set)";
  return "Every year: " + md(r.month, r.day);
}

// ---- Shout-outs (supabase/staff-shoutouts.sql)
var OPS_SHOUTOUT_MAX = 500;

// Calendar quarter q (1-4) of year as [from, toExclusive] "YYYY-MM-DD"
// strings, for the review form's "Shout-outs this quarter". Bad input => null.
function OPS_quarterRange(year, quarter) {
  var y = Number(year), q = Number(quarter);
  if (!(y > 1900) || !(q >= 1 && q <= 4) || Math.floor(q) !== q) return null;
  var m = (q - 1) * 3 + 1;
  var pad = function (n) { return (n < 10 ? "0" : "") + n; };
  var from = y + "-" + pad(m) + "-01";
  var to = q === 4 ? (y + 1) + "-01-01" : y + "-" + pad(m + 3) + "-01";
  return [from, to];
}

// Problem with a draft shout-out, or "" when it can be sent.
function OPS_shoutoutError(toEmail, body, meEmail) {
  var to = String(toEmail || "").trim().toLowerCase();
  var text = String(body || "").trim();
  if (!to) return "Pick who it's for.";
  if (to === String(meEmail || "").trim().toLowerCase()) return "You can't send a shout-out to yourself.";
  if (!text) return "Write a short note.";
  if (text.length > OPS_SHOUTOUT_MAX) return "Keep it under " + OPS_SHOUTOUT_MAX + " characters.";
  return "";
}

// SOP freshness: the later of the last section edit and the last "Mark as
// still accurate". Times are ISO strings (or null); today is "YYYY-MM-DD".
// Returns null when neither exists, else { at, days, stale, source }.
var OPS_SOP_STALE_DAYS = 180;
function OPS_sopFreshness(lastEdited, lastReviewed, today) {
  var e = lastEdited ? Date.parse(lastEdited) : NaN;
  var r = lastReviewed ? Date.parse(lastReviewed) : NaN;
  if (isNaN(e) && isNaN(r)) return null;
  var useReview = !isNaN(r) && (isNaN(e) || r >= e);
  var at = useReview ? lastReviewed : lastEdited;
  var t = Date.parse(String(today || "") + "T00:00:00");
  var d = new Date(useReview ? r : e);
  var day = Date.parse(OPS_isoDay(d) + "T00:00:00");
  var days = isNaN(t) ? 0 : Math.max(0, Math.round((t - day) / 864e5));
  return { at: at, days: days, stale: days > OPS_SOP_STALE_DAYS, source: useReview ? "review" : "edit" };
}

// "today", "1 day ago", "12 days ago".
function OPS_daysAgo(n) {
  if (!(n > 0)) return "today";
  return n === 1 ? "1 day ago" : n + " days ago";
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    OPS_BUDGET_WARN: OPS_BUDGET_WARN, OPS_BUDGET_OVER: OPS_BUDGET_OVER,
    OPS_budgetStatus: OPS_budgetStatus, OPS_budgetMatches: OPS_budgetMatches,
    OPS_REPLY_GOAL_HOURS: OPS_REPLY_GOAL_HOURS, OPS_fmtWait: OPS_fmtWait, OPS_replyPeriod: OPS_replyPeriod,
    OPS_addDays: OPS_addDays, OPS_outUntil: OPS_outUntil, OPS_upcomingTimeOff: OPS_upcomingTimeOff,
    OPS_timeOffError: OPS_timeOffError, OPS_BACKUP_ACCESS: OPS_BACKUP_ACCESS,
    OPS_DEADLINE_SOON_DAYS: OPS_DEADLINE_SOON_DAYS, OPS_ymd: OPS_ymd, OPS_dayDiff: OPS_dayDiff,
    OPS_rollWeekend: OPS_rollWeekend, OPS_fyeMonth: OPS_fyeMonth, OPS_ruleApplies: OPS_ruleApplies,
    OPS_ruleOccurrences: OPS_ruleOccurrences, OPS_deadlineItems: OPS_deadlineItems, OPS_describeDueRule: OPS_describeDueRule,
    OPS_SHOUTOUT_MAX: OPS_SHOUTOUT_MAX, OPS_quarterRange: OPS_quarterRange, OPS_shoutoutError: OPS_shoutoutError,
    OPS_SOP_STALE_DAYS: OPS_SOP_STALE_DAYS, OPS_sopFreshness: OPS_sopFreshness, OPS_daysAgo: OPS_daysAgo,
  };
}
