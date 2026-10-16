// Tasks Phase 2 (S4): recurring templates, the pure part.
//
// TK_Templates.jsx (#/tasks/templates) draws with these; the node test
// (TK_templateLogic.test.js) checks them. The server is the source of truth:
// supabase/tasks-p2-4-recurring.sql (tk__generate, tk_save_template). The
// preview here mirrors tk__generate for one template and one client so the
// editor can show the next due dates while typing; "Preview 30 days" asks the
// server (tk_generate_preview).
//
// Uses TK_recurrence (TK_recurrenceLogic.js): the global in the browser,
// require() in node. Every name here starts with TK_tpl / TK_TPL / TK_dueRule.

var TK_TPL_CADENCES = [
  { value: "weekly", label: "Weekly", period: "week" },
  { value: "monthly", label: "Monthly", period: "month" },
  { value: "quarterly", label: "Quarterly", period: "quarter" },
  { value: "annually", label: "Annually", period: "year" },
];

var TK_TPL_ROLES = [
  { value: "bookkeeper", label: "Bookkeeper" },
  { value: "backup", label: "Backup bookkeeper" },
  { value: "account_manager", label: "Account manager" },
  { value: "reviewer", label: "Reviewer" },
];

// Same ids and titles as CLIENT_SOP_SECTIONS in app.jsx.
var TK_TPL_SOP = [
  { value: "access", label: "Access & logins" },
  { value: "bank_feeds", label: "Bank & credit card feeds" },
  { value: "monthly_close", label: "Monthly close steps" },
  { value: "payroll", label: "Payroll" },
  { value: "bills_vendors", label: "Recurring bills & vendors" },
  { value: "reporting", label: "Reporting & deliverables" },
  { value: "quirks", label: "Quirks, contacts & preferences" },
];

var TK_TPL_RULES_BY_CADENCE = {
  weekly: ["weekday", "offset"],
  monthly: ["business_day", "eom", "day_of_month", "nth_weekday", "offset"],
  quarterly: ["business_day", "eom", "day_of_month", "nth_weekday", "offset"],
  annually: ["business_day", "eom", "day_of_month", "nth_weekday", "offset"],
};

var TK_TPL_RULE_LABELS = {
  business_day: "A business day of the month",
  eom: "The last business day",
  day_of_month: "A day of the month",
  nth_weekday: "A weekday of the month",
  weekday: "A day of the week",
  offset: "Days after the period ends",
};

var TK_TPL_STATUS_LABELS = { draft: "Draft", active: "On", paused: "Paused", retired: "Retired" };

var TK_TPL_DOW = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

var TK_tplRec = (function () {
  if (typeof TK_recurrence !== "undefined" && TK_recurrence) return TK_recurrence;
  if (typeof require === "function") {
    try {
      return require("./TK_recurrenceLogic.js");
    } catch (e) {}
  }
  return null;
})();

function TK_tplCadence(value) {
  for (var i = 0; i < TK_TPL_CADENCES.length; i++) if (TK_TPL_CADENCES[i].value === value) return TK_TPL_CADENCES[i];
  return TK_TPL_CADENCES[1];
}

function TK_tplLabelOf(list, value) {
  for (var i = 0; i < list.length; i++) if (list[i].value === value) return list[i].label;
  return value ? String(value) : "";
}

// Same as tk__template_kind: quarters are always calendar; basis matters
// only for annual templates.
function TK_tplKind(cadence, basis) {
  if (cadence === "weekly") return "week";
  if (cadence === "quarterly") return "quarter";
  if (cadence === "annually") return basis === "fiscal" ? "year" : "calendar_year";
  return "month";
}

// draft | active | paused | retired. Paused = status active, switch off.
function TK_tplStatus(t) {
  if (!t) return "draft";
  if (t.status === "retired") return "retired";
  if (t.status === "draft") return "draft";
  return t.active === false ? "paused" : "active";
}

// What an admin can do next, in button order (tk_set_template_status).
function TK_tplActions(t) {
  switch (TK_tplStatus(t)) {
    case "draft":
      return [{ action: "activate", label: "Turn on" }, { action: "retire", label: "Retire" }];
    case "active":
      return [{ action: "pause", label: "Pause" }, { action: "retire", label: "Retire" }];
    case "paused":
      return [{ action: "resume", label: "Resume" }, { action: "retire", label: "Retire" }];
    default:
      return [{ action: "draft", label: "Back to draft" }];
  }
}

function TK_tplIsObj(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

// Same order as tk__template_eff: a valid override rule, the template's
// rule, then the legacy offset.
function TK_tplEffectiveRule(t, override) {
  var rec = TK_tplRec;
  var o = TK_tplIsObj(override) ? override : {};
  if (TK_tplIsObj(o.due_rule) && rec && rec.TK_dueRuleValid(o.due_rule)) return o.due_rule;
  if (t && TK_tplIsObj(t.due_rule)) return t.due_rule;
  var d = t && t.due_offset_days != null ? Number(t.due_offset_days) : 10;
  return { type: "offset", days: isFinite(d) ? d : 10 };
}

function TK_tplOrdinal(n) {
  var v = Math.abs(Number(n) || 0);
  var s = v % 100 >= 11 && v % 100 <= 13 ? "th" : v % 10 === 1 ? "st" : v % 10 === 2 ? "nd" : v % 10 === 3 ? "rd" : "th";
  return v + s;
}

function TK_tplMonthPhrase(mo, cadence) {
  var period = TK_tplCadence(cadence).period;
  var m = mo == null ? 1 : Number(mo);
  if (m === 0) return cadence === "monthly" ? " of the same month" : " of the " + period + "'s last month";
  if (m === 1) return " of the month after the " + period + " ends";
  return " of the " + TK_tplOrdinal(m) + " month after the " + period + " ends";
}

function TK_tplRollPhrase(roll) {
  if (roll === "next") return ", or the next business day";
  if (roll === "prev") return ", or the business day before";
  return "";
}

// One sentence for a due rule, e.g. "10th business day of the month after
// the month ends".
function TK_dueRuleText(rule, cadence) {
  var r = TK_tplIsObj(rule) ? rule : null;
  var period = TK_tplCadence(cadence).period;
  if (!r) return "No due rule";
  switch (r.type) {
    case "offset": {
      var n = Number(r.days) || 0;
      if (n === 0) return "Last day of the " + period;
      if (n > 0) return n + " day" + (n === 1 ? "" : "s") + " after the " + period + " ends";
      return -n + " day" + (n === -1 ? "" : "s") + " before the " + period + " ends";
    }
    case "business_day":
      return (r.n === -1 ? "Last business day" : TK_tplOrdinal(r.n) + " business day") + TK_tplMonthPhrase(r.month_offset, cadence);
    case "eom": {
      var b = Number(r.offset_bd) || 0;
      var head = b === 0 ? "Last business day" : b + " business day" + (b === 1 ? "" : "s") + " before the last business day";
      return head + TK_tplMonthPhrase(r.month_offset, cadence);
    }
    case "day_of_month":
      return "The " + TK_tplOrdinal(r.day) + TK_tplMonthPhrase(r.month_offset, cadence) + TK_tplRollPhrase(r.roll == null ? "next" : r.roll);
    case "nth_weekday":
      return (
        (r.n === -1 ? "Last " : TK_tplOrdinal(r.n) + " ") +
        (TK_TPL_DOW[r.dow] || "weekday") +
        TK_tplMonthPhrase(r.month_offset, cadence) +
        TK_tplRollPhrase(r.roll == null ? "none" : r.roll)
      );
    case "weekday":
      return (TK_TPL_DOW[r.dow] || "A weekday") + " of each week, or the next business day";
  }
  return "Unknown due rule";
}

// A sensible rule when the person switches rule type in the editor.
function TK_tplDefaultRule(type, cadence) {
  switch (type) {
    case "business_day":
      return { type: "business_day", n: 10, month_offset: 1 };
    case "eom":
      return { type: "eom", offset_bd: 0, month_offset: 1 };
    case "day_of_month":
      return { type: "day_of_month", day: 15, month_offset: 1, roll: "next" };
    case "nth_weekday":
      return { type: "nth_weekday", n: 2, dow: 2, month_offset: 1, roll: "none" };
    case "weekday":
      return { type: "weekday", dow: 5 };
    default:
      return { type: "offset", days: cadence === "weekly" ? 0 : 10 };
  }
}

function TK_tplAddDays(ymd, n) {
  var p = String(ymd || "").split("-");
  var d = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]) + n));
  var z = function (v) {
    return v < 10 ? "0" + v : String(v);
  };
  return d.getUTCFullYear() + "-" + z(d.getUTCMonth() + 1) + "-" + z(d.getUTCDate());
}

// The next periods for one template x client, the way tk__generate walks
// them. opts: { today, fye ('MM-DD'), holidays, count (default 3),
// activatedOn (default today, as a preview treats a draft), override }.
// Returns null for an unusable rule, else
// [{ start, end, label, due, startOn, when: 'now' | 'later' | 'missed' }]:
// 'now' = the next run creates it, 'later' = created startOn, 'missed' =
// past the 7-day grace (listed, never created; only before 'now' rows).
function TK_tplUpcoming(tpl, opts) {
  var rec = TK_tplRec;
  var o = opts || {};
  if (!rec || !tpl || !o.today) return null;
  var rule = TK_tplEffectiveRule(tpl, o.override);
  if (!rec.TK_dueRuleValid(rule)) return null;
  var allowed = TK_TPL_RULES_BY_CADENCE[tpl.cadence] || [];
  if (allowed.indexOf(rule.type) < 0) return null;
  var kind = TK_tplKind(tpl.cadence, tpl.period_basis);
  var lead = Math.max(0, Number(tpl.lead_days) || 0);
  var today = o.today;
  var act = o.activatedOn || today;
  var count = o.count || 3;
  var hol = o.holidays || [];
  var a = rec.TK_periodStart(kind, act, o.fye);
  var b = rec.TK_periodStart(kind, TK_tplAddDays(today, -365), o.fye);
  var floor = a > b ? a : b;
  var start = rec.TK_periodStart(kind, TK_tplAddDays(floor, -1), o.fye);
  var out = [];
  var guard = 0;
  while (out.length < count && guard < 400) {
    guard++;
    var end = rec.TK_periodEnd(kind, start);
    var due = null;
    try {
      due = rec.TK_resolveDue(rule, start, end, hol);
    } catch (e) {
      return null;
    }
    if (due && due >= act) {
      var startOn = TK_tplAddDays(due, -lead);
      var when = due < TK_tplAddDays(today, -7) ? "missed" : startOn <= today ? "now" : "later";
      if (when !== "missed" || o.withMissed) {
        out.push({ start: start, end: end, label: rec.TK_periodLabel(kind, start), due: due, startOn: startOn, when: when });
      }
    }
    start = TK_tplAddDays(end, 1);
  }
  return out;
}

// Generated titles end with " · <period>": 'Sep 2026', 'Q3 2026',
// 'FY 2027', '2026', 'Wk of Sep 7'. A template's title must not.
function TK_tplStripPeriod(text) {
  return String(text || "")
    .replace(/\s*·\s*(?:Wk of [A-Z][a-z]{2} \d{1,2}|FY \d{4}|[A-Z][a-z]{2,8}\.? \d{4}|Q[1-4] \d{4}|\d{4})\s*$/, "")
    .trim()
    .slice(0, 200);
}

function TK_tplChecklistLines(text) {
  return String(text || "")
    .split("\n")
    .map(function (s) {
      return s.trim().slice(0, 300);
    })
    .filter(Boolean)
    .slice(0, 50);
}

function TK_tplBlank() {
  return {
    id: null,
    title: "",
    cadence: "monthly",
    rule: { type: "business_day", n: 10, month_offset: 1 },
    lead_days: 7,
    plan_tiers: [],
    client_ids: [],
    priority: "normal",
    checklist: [],
    assignee_role: "bookkeeper",
    review_required: false,
    sop_section: "",
    estimate_minutes: "",
    period_basis: "calendar",
  };
}

// A task_templates row -> the editor's draft.
function TK_tplFromRow(row) {
  var r = row || {};
  var d = TK_tplBlank();
  d.id = r.id || null;
  d.title = r.title || "";
  d.cadence = r.cadence || "monthly";
  d.rule = TK_tplEffectiveRule(r, null);
  d.lead_days = r.lead_days != null ? Number(r.lead_days) : 7;
  d.plan_tiers = Array.isArray(r.plan_tiers) ? r.plan_tiers.slice() : [];
  d.client_ids = Array.isArray(r.client_ids) ? r.client_ids.slice() : [];
  d.priority = r.priority || "normal";
  d.checklist = Array.isArray(r.checklist) ? r.checklist.slice() : [];
  d.assignee_role = r.assignee_role || "bookkeeper";
  d.review_required = !!r.review_required;
  d.sop_section = r.sop_section || "";
  d.estimate_minutes = r.estimate_minutes != null ? String(r.estimate_minutes) : "";
  d.period_basis = r.period_basis === "fiscal" ? "fiscal" : "calendar";
  d.status = r.status || "draft";
  d.active = r.active !== false;
  d.template_set_id = r.template_set_id || null;
  d.activated_at = r.activated_at || null;
  return d;
}

// Field errors for a draft: { field: text }, or null when it can be saved.
function TK_tplValidate(d) {
  var rec = TK_tplRec;
  var e = {};
  var title = String((d && d.title) || "").trim();
  if (!title) e.title = "Give it a title.";
  else if (title.length > 200) e.title = "Keep the title under 200 characters.";
  else if (TK_tplStripPeriod(title) !== title) e.title = "Leave the period off. Each task gets it added, like “· Sep 2026”.";
  var allowed = TK_TPL_RULES_BY_CADENCE[d && d.cadence];
  if (!allowed) e.cadence = "Pick how often it repeats.";
  else if (!d.rule || allowed.indexOf(d.rule.type) < 0) e.rule = "Pick when it's due.";
  else if (rec && !rec.TK_dueRuleValid(d.rule)) e.rule = "That due date doesn't work. Check the numbers.";
  var lead = Number(d && d.lead_days);
  if (!(Math.floor(lead) === lead && lead >= 0 && lead <= 90)) e.lead_days = "Use 0 to 90 days.";
  var est = d && d.estimate_minutes;
  if (est !== "" && est != null) {
    var n = Number(est);
    if (!(Math.floor(n) === n && n >= 1 && n <= 10000)) e.estimate_minutes = "Use whole minutes, 1 to 10000.";
  }
  if (d && Array.isArray(d.checklist) && d.checklist.length > 50) e.checklist = "Keep it to 50 steps.";
  return Object.keys(e).length ? e : null;
}

// The draft -> tk_save_template's p_tpl.
function TK_tplToPayload(d) {
  var rule = d.rule;
  var p = {
    title: TK_tplStripPeriod(d.title),
    cadence: d.cadence,
    due_rule: rule,
    lead_days: Number(d.lead_days) || 0,
    plan_tiers: (d.plan_tiers || []).slice(),
    client_ids: (d.client_ids || []).slice(),
    priority: d.priority || "normal",
    checklist: (d.checklist || []).slice(0, 50),
    assignee_role: d.assignee_role || "bookkeeper",
    review_required: !!d.review_required,
    sop_section: d.sop_section || "",
    estimate_minutes: d.estimate_minutes === "" || d.estimate_minutes == null ? "" : String(Number(d.estimate_minutes)),
    period_basis: d.cadence === "annually" && d.period_basis === "fiscal" ? "fiscal" : "calendar",
  };
  // the legacy column stays meaningful for old readers
  if (rule && rule.type === "offset") p.due_offset_days = rule.days;
  return p;
}

var TK_TPL_SKIP_TEXT = {
  no_assignee: "Nobody to give it to: the client has no bookkeeper or account manager.",
  no_access: "The person it would go to can't see this client.",
  bad_rule: "The due rule doesn't give a date for this period.",
  error: "Something went wrong. It tries again on the next run.",
};

function TK_tplSkipReasonText(reason) {
  return TK_TPL_SKIP_TEXT[reason] || "Skipped.";
}

function TK_tplPlural(n, one, many) {
  return n + " " + (n === 1 ? one : many || one + "s");
}

// One line for a generator result (a real run or a preview).
function TK_tplRunSummary(res) {
  var r = res || {};
  var bits = [];
  if (r.dry_run) {
    var w = Array.isArray(r.would_create) ? r.would_create.length : 0;
    var u = Array.isArray(r.upcoming) ? r.upcoming.length : 0;
    bits.push(w ? TK_tplPlural(w, "task") + " would be created now" : "Nothing would be created now");
    if (u) bits.push(u + " more coming up");
  } else {
    var c = Number(r.created) || 0;
    var people = r.by_assignee ? Object.keys(r.by_assignee).length : 0;
    bits.push(c ? "Created " + TK_tplPlural(c, "task") + " for " + TK_tplPlural(people, "person", "people") : "Nothing new to create");
  }
  var s = Array.isArray(r.skipped) ? r.skipped.length : 0;
  var m = Array.isArray(r.missed) ? r.missed.length : 0;
  if (s) bits.push(s + " skipped");
  if (m) bits.push(TK_tplPlural(m, "missed period") + " listed");
  return bits.join(". ") + ".";
}

// Templates in display groups: standard sets first (by set name), then the
// firm's own. Inside a group: on, paused, draft, retired; then by title.
function TK_tplGroups(templates, sets) {
  var order = { active: 0, paused: 1, draft: 2, retired: 3 };
  var byTitle = function (a, b) {
    var x = order[TK_tplStatus(a)] - order[TK_tplStatus(b)];
    if (x) return x;
    var p = String(a.title || "").toLowerCase();
    var q = String(b.title || "").toLowerCase();
    return p < q ? -1 : p > q ? 1 : 0;
  };
  var setMap = {};
  (sets || []).forEach(function (s) {
    if (s && s.id && !s.deleted_at) setMap[s.id] = { set: s, templates: [] };
  });
  var firm = [];
  (templates || []).forEach(function (t) {
    if (t.template_set_id && setMap[t.template_set_id]) setMap[t.template_set_id].templates.push(t);
    else firm.push(t);
  });
  var groups = Object.keys(setMap)
    .map(function (k) {
      return setMap[k];
    })
    .sort(function (a, b) {
      return String(a.set.name).localeCompare(String(b.set.name));
    })
    .map(function (g) {
      return { key: "set:" + g.set.id, set: g.set, label: g.set.name, templates: g.templates.sort(byTitle) };
    });
  groups.push({ key: "firm", set: null, label: "Firm templates", templates: firm.sort(byTitle) });
  return groups;
}

// Plain words for a refused template write (err.reason or err.code from
// TK_api). null = not a template error; the caller falls back to TK_vErrText.
var TK_TPL_ERR_TEXT = {
  tk_forbidden: "Only admins can change recurring templates.",
  tk_owner_only: "Only the owner can turn that on or off.",
  tk_bad_due_rule: "That due date rule doesn't work. Check the numbers.",
  tk_bad_template: "Something in the template isn't valid. Check each field.",
  tk_checklist_too_long: "Keep the checklist to 50 steps.",
  tk_bad_override: "That change for this client isn't allowed.",
  tk_bad_action: "That step isn't allowed for this template right now.",
  tk_template_retired: "Retired templates can't be edited. Move it back to draft first.",
  tk_not_found: "That template is gone. Refresh the page.",
  tk_bad_reviewer: "Pick an active admin as the reviewer.",
  tk_offline: "You're offline. Try again when you're back online.",
  tk_cadence_locked: "How often it repeats can't change once a template has been on. Retire it and make a new one.",
  tk_review_admin_only: "Only an admin can turn approval off for a client.",
};

var TK_TPL_CADENCE_LOCK_NOTE = "How often it repeats can't change once a template has been on. Retire it and make a new one.";

// Review fix (major 2): once a template has been on (or made a task) its
// cadence and year basis are fixed; tk_save_template refuses a change.
function TK_tplCadenceLocked(t, issuedCount) {
  if (!t || !t.id) return false;
  var status = t.status || "draft";
  return status !== "draft" || !!t.activated_at || Number(issuedCount) > 0;
}

// A timestamp -> its 'YYYY-MM-DD' in the firm's time zone (America/Chicago),
// the same date SQL takes with `at time zone 'America/Chicago'`.
function TK_tplCentralDate(ts) {
  if (!ts) return null;
  var d = new Date(ts);
  if (isNaN(d.getTime())) return null;
  try {
    var parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
    var m = {};
    parts.forEach(function (p) {
      m[p.type] = p.value;
    });
    return m.year + "-" + m.month + "-" + m.day;
  } catch (e) {
    return d.toISOString().slice(0, 10);
  }
}

// The same reading SQL's tk__jsonb_bool gives a tk_settings value: true,
// false, or null when it isn't a yes/no (the generator then treats it as off).
function TK_tplBool(v) {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    var s = v.trim().toLowerCase();
    if (["true", "t", "yes", "y", "on", "1"].indexOf(s) >= 0) return true;
    if (["false", "f", "no", "n", "off", "0", ""].indexOf(s) >= 0) return false;
  }
  return null;
}

// The first day tk__generate counts for a template (review fix, major 1):
// its activation date (Central), or for a standard-set member reaching a
// real client, the later of that and the day the set went live.
// opts: { set (row with live_since), testClient }.
function TK_tplActivatedOn(t, opts) {
  var o = opts || {};
  if (!t) return null;
  var act = TK_tplCentralDate(t.activated_at || t.created_at);
  if (!act) return null;
  if (t.template_set_id && o.set && o.set.live_since && !o.testClient) {
    var live = TK_tplCentralDate(o.set.live_since);
    if (live && live > act) return live;
  }
  return act;
}

// tk_set_client_override's p_override from the modal's choices. A
// non-admin never sends review_required when an admin already turned
// approval off (the server keeps it), and never sends false.
function TK_tplOverridePayload(choice, opts) {
  var c = choice || {};
  var o = opts || {};
  var next = {};
  var tt = TK_tplStripPeriod(c.title);
  if (tt) next.title = tt;
  if (c.rule) next.due_rule = c.rule;
  if (c.role) next.assignee_role = c.role;
  var adminOff = o.stored && o.stored.review_required === false;
  if (o.isAdmin || !adminOff) {
    if (c.review === "yes") next.review_required = true;
    if (c.review === "no" && o.isAdmin) next.review_required = false;
  }
  if (o.stored && Array.isArray(o.stored.checklist)) next.checklist = o.stored.checklist;
  return next;
}

// tk_issue_missed's answer -> what the Missed periods row shows (major 4).
// closed: the row leaves the list; text: the toast (or the inline reason).
function TK_tplIssueOutcome(res) {
  var r = res || {};
  if (r.status === "created") return { closed: true, text: "Task made." };
  if (r.status === "exists") return { closed: true, text: "That period already had a task, so it's linked to it now." };
  if (r.status === "skipped") return { closed: false, text: "Not made. " + TK_tplSkipReasonText(r.reason) };
  return { closed: false, text: "Nothing was made. Refresh and try again." };
}

function TK_tplErrorText(err) {
  if (!err) return null;
  var r = err.reason || err.code;
  return TK_TPL_ERR_TEXT[r] || null;
}

// Does a template reach this client? (same test as tk__generate)
function TK_tplAppliesTo(t, client) {
  if (!t || !client) return false;
  var tiers = t.plan_tiers || [];
  var ids = t.client_ids || [];
  if (!tiers.length && !ids.length) return true;
  return tiers.indexOf(client.plan) >= 0 || ids.indexOf(client.id) >= 0;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    TK_TPL_CADENCES: TK_TPL_CADENCES,
    TK_TPL_ROLES: TK_TPL_ROLES,
    TK_TPL_SOP: TK_TPL_SOP,
    TK_TPL_RULES_BY_CADENCE: TK_TPL_RULES_BY_CADENCE,
    TK_TPL_RULE_LABELS: TK_TPL_RULE_LABELS,
    TK_TPL_STATUS_LABELS: TK_TPL_STATUS_LABELS,
    TK_tplLabelOf: TK_tplLabelOf,
    TK_tplKind: TK_tplKind,
    TK_tplStatus: TK_tplStatus,
    TK_tplActions: TK_tplActions,
    TK_tplEffectiveRule: TK_tplEffectiveRule,
    TK_tplOrdinal: TK_tplOrdinal,
    TK_dueRuleText: TK_dueRuleText,
    TK_tplDefaultRule: TK_tplDefaultRule,
    TK_tplUpcoming: TK_tplUpcoming,
    TK_tplStripPeriod: TK_tplStripPeriod,
    TK_tplChecklistLines: TK_tplChecklistLines,
    TK_tplBlank: TK_tplBlank,
    TK_tplErrorText: TK_tplErrorText,
    TK_tplFromRow: TK_tplFromRow,
    TK_tplValidate: TK_tplValidate,
    TK_tplToPayload: TK_tplToPayload,
    TK_tplSkipReasonText: TK_tplSkipReasonText,
    TK_tplRunSummary: TK_tplRunSummary,
    TK_tplGroups: TK_tplGroups,
    TK_tplAppliesTo: TK_tplAppliesTo,
    TK_TPL_CADENCE_LOCK_NOTE: TK_TPL_CADENCE_LOCK_NOTE,
    TK_tplCadenceLocked: TK_tplCadenceLocked,
    TK_tplCentralDate: TK_tplCentralDate,
    TK_tplBool: TK_tplBool,
    TK_tplActivatedOn: TK_tplActivatedOn,
    TK_tplOverridePayload: TK_tplOverridePayload,
    TK_tplIssueOutcome: TK_tplIssueOutcome,
  };
}
