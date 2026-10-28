// ----------------------------------------------------------------------------
// TK_rulesLogic.js — pure parts of Slate plus Rules (hidden preview, TKP_on).
//
// A rule is "When <trigger>, then <action>" for one project or one client.
// The server (supabase/slateplus-rules.sql) owns the truth: tk__rule_pair_ok,
// tk__rule_problem, the executor and its loop guard. This file mirrors the
// parts the Rules page needs before it asks the server: the pair matrix, the
// same problem messages (for what the page can check alone), the sentence a
// rule reads as, outcome labels, the save payload and who may flip a switch.
// Tested in node (TK_rulesLogic.test.js).
// ----------------------------------------------------------------------------

var TKRU_TRIGGERS = ["section_moved", "done", "overdue", "assigned"];
var TKRU_ACTIONS = ["assign", "set_due", "move_section", "comment", "follow_up"];

// Mirrors tk__rule_pair_ok in supabase/slateplus-rules.sql.
var TKRU_PAIRS = {
  section_moved: ["assign", "set_due", "comment", "follow_up"],
  done: ["move_section", "comment", "follow_up"],
  overdue: ["assign", "move_section", "comment"],
  assigned: ["set_due", "move_section", "comment"],
};

var TKRU_TRIGGER_LABELS = {
  section_moved: "A task moves to a section",
  done: "A task is marked done",
  overdue: "A task becomes overdue",
  assigned: "A task is assigned",
};

var TKRU_ACTION_LABELS = {
  assign: "Assign it to someone",
  set_due: "Set the due date",
  move_section: "Move it to a section",
  comment: "Post a System comment",
  follow_up: "Add a follow-up task",
};

var TKRU_RUN_LABELS = { ok: "Done", noop: "No change needed", skipped: "Skipped", error: "Error", pending: "Running" };
var TKRU_DRY_LABELS = { do: "Would change", noop: "Already set", skipped: "Skipped" };

function TKRU_pairOk(trigger, action) {
  var list = TKRU_PAIRS[trigger];
  return !!list && list.indexOf(action) >= 0;
}

function TKRU_actionsFor(trigger) {
  return (TKRU_PAIRS[trigger] || []).slice();
}

function TKRU__str(v) {
  return v == null ? "" : String(v).trim();
}

function TKRU__int(v) {
  if (v === "" || v == null || typeof v === "boolean") return null;
  var n = Number(v);
  return isFinite(n) && Math.floor(n) === n ? n : null;
}

// A blank draft for the New rule form.
function TKRU_blankDraft() {
  return {
    id: null,
    name: "",
    scope_kind: "project",
    project_id: "",
    client_id: "",
    trigger_kind: "section_moved",
    trigger_section: "",
    trigger_email: "",
    action_kind: "assign",
    assign_email: "",
    due_days: "3",
    due_business: true,
    move_section: "",
    comment_text: "",
    follow_title: "",
    follow_days: "",
    follow_assignee: "same",
  };
}

// A saved tk_rules row -> form draft.
function TKRU_draftFromRule(rule) {
  var d = TKRU_blankDraft();
  if (!rule) return d;
  var t = rule.trigger_config || {};
  var a = rule.action_config || {};
  d.id = rule.id || null;
  d.name = rule.name || "";
  d.scope_kind = rule.scope_kind === "client" ? "client" : "project";
  d.project_id = rule.project_id || "";
  d.client_id = rule.client_id != null ? String(rule.client_id) : "";
  d.trigger_kind = rule.trigger_kind || "section_moved";
  d.trigger_section = t.section || "";
  d.trigger_email = t.email || "";
  d.action_kind = rule.action_kind || "assign";
  if (d.action_kind === "assign") d.assign_email = a.email || "";
  if (d.action_kind === "set_due") {
    d.due_days = a.days != null ? String(a.days) : "";
    d.due_business = a.business === true;
  }
  if (d.action_kind === "move_section") d.move_section = a.section || "";
  if (d.action_kind === "comment") d.comment_text = a.text || "";
  if (d.action_kind === "follow_up") {
    d.follow_title = a.title || "";
    d.follow_days = a.days != null ? String(a.days) : "";
    d.follow_assignee = a.assignee || "same";
  }
  return d;
}

// Form draft -> the jsonb tk_rule_save and tk_rule_dry_run take. Only the keys
// the server reads (tk__rule_from_json); emails lowercased.
function TKRU_payload(d) {
  var x = d || {};
  var scope = x.scope_kind === "client" ? "client" : "project";
  var out = {
    name: TKRU__str(x.name),
    scope_kind: scope,
    project_id: scope === "project" ? TKRU__str(x.project_id) || null : null,
    client_id: scope === "client" ? TKRU__str(x.client_id) || null : null,
    trigger_kind: TKRU__str(x.trigger_kind),
    trigger_config: {},
    action_kind: TKRU__str(x.action_kind),
    action_config: {},
  };
  if (x.id) out.id = x.id;
  if (out.trigger_kind === "section_moved") out.trigger_config = { section: TKRU__str(x.trigger_section) || null };
  if (out.trigger_kind === "assigned" && TKRU__str(x.trigger_email)) out.trigger_config = { email: TKRU__str(x.trigger_email).toLowerCase() };
  var k = out.action_kind;
  if (k === "assign") out.action_config = { email: TKRU__str(x.assign_email).toLowerCase() || null };
  else if (k === "set_due") out.action_config = { days: TKRU__int(TKRU__str(x.due_days)), business: x.due_business === true };
  else if (k === "move_section") out.action_config = { section: TKRU__str(x.move_section) || null };
  else if (k === "comment") out.action_config = { text: TKRU__str(x.comment_text) || null };
  else if (k === "follow_up") {
    var fd = TKRU__str(x.follow_days);
    out.action_config = {
      title: TKRU__str(x.follow_title) || null,
      days: fd === "" ? null : TKRU__int(fd),
      assignee: TKRU__str(x.follow_assignee).toLowerCase() || "same",
    };
  }
  return out;
}

// What the page can check before it asks the server. Same words as
// tk__rule_problem. ctx (optional): { project: {sections, trashed_at} } and
// { staffEmails: [...] } (active staff). The server still checks everything,
// including who can open a client. Returns null when nothing is wrong.
function TKRU_validate(d, ctx) {
  var c = ctx || {};
  var p = TKRU_payload(d);
  if (!p.name || p.name.length > 80) return "Give the rule a name (up to 80 characters).";
  var project = c.project || null;
  if (p.scope_kind === "project") {
    if (!p.project_id || (c.hasOwnProperty("project") && !project)) return "Pick a project.";
    if (project && project.trashed_at) return "That project is in the trash.";
  } else if (!p.client_id) {
    return "Pick a client.";
  }
  if (TKRU_TRIGGERS.indexOf(p.trigger_kind) < 0) return "Pick when the rule runs.";
  if (TKRU_ACTIONS.indexOf(p.action_kind) < 0) return "Pick what the rule does.";
  if (!TKRU_pairOk(p.trigger_kind, p.action_kind)) return "That action does not go with that trigger.";
  var sections = project && Array.isArray(project.sections) ? project.sections : null;
  var hasSection = function (s) {
    return !!s && (!sections || sections.indexOf(s) >= 0);
  };
  var active = Array.isArray(c.staffEmails)
    ? c.staffEmails.map(function (e) {
        return String(e || "").toLowerCase();
      })
    : null;
  var isActive = function (e) {
    return !!e && (!active || active.indexOf(e) >= 0);
  };
  if (p.trigger_kind === "section_moved") {
    if (p.scope_kind !== "project") return "Section rules need a project.";
    if (!hasSection(p.trigger_config.section)) return "Pick a section of the project.";
  }
  if (p.trigger_kind === "assigned" && p.trigger_config.email && !isActive(p.trigger_config.email)) return "Pick an active teammate (or anyone).";
  var a = p.action_config;
  if (p.action_kind === "assign") {
    if (!isActive(a.email)) return "Pick an active teammate to assign.";
  } else if (p.action_kind === "set_due") {
    if (a.days == null || a.days < 0 || a.days > 365) return "Days must be 0 to 365.";
  } else if (p.action_kind === "move_section") {
    if (p.scope_kind !== "project") return "Moving to a section needs a project.";
    if (!hasSection(a.section)) return "Pick a section of the project.";
  } else if (p.action_kind === "comment") {
    if (!a.text || a.text.length > 1000) return "Write the comment (up to 1000 characters).";
  } else if (p.action_kind === "follow_up") {
    if (!a.title || a.title.length > 200) return "Write the follow-up title (up to 200 characters).";
    if (TKRU__str(d && d.follow_days) !== "" && (a.days == null || a.days < 0 || a.days > 365)) return "Days must be 0 to 365.";
    if (a.assignee !== "same" && !isActive(a.assignee)) return "Pick an active teammate for the follow-up.";
  }
  return null;
}

// Mirrors the loop guard in tk__rule_fire: a rule never runs at depth 2 or
// more, and never twice for the same change.
function TKRU_loopDecision(depth, fired, ruleId) {
  var n = Number(depth) || 0;
  if (n >= 2) return { run: false, reason: "Loop guard: too many rules in a row." };
  var list = Array.isArray(fired) ? fired : [];
  if (ruleId && list.indexOf(String(ruleId)) >= 0) return { run: false, reason: "Loop guard: this rule already ran for this change." };
  return { run: true, reason: "" };
}

function TKRU__days(n, business) {
  var k = Number(n) || 0;
  if (k === 0) return "today";
  return k + (business ? (k === 1 ? " business day" : " business days") : k === 1 ? " day" : " days") + " later";
}

// "When a task moves to Review in Onboarding: Acme, assign it to Jane."
// ctx: { projectName(id), clientName(id), staffName(email) }.
function TKRU_describe(rule, ctx) {
  var c = ctx || {};
  var r = rule || {};
  var t = r.trigger_config || {};
  var a = r.action_config || {};
  var who = function (e) {
    if (!e) return "";
    var n = typeof c.staffName === "function" ? c.staffName(e) : "";
    return n || e;
  };
  var where = "";
  if (r.scope_kind === "project") {
    var pn = typeof c.projectName === "function" ? c.projectName(r.project_id) : "";
    where = " in " + (pn || "a project");
  } else if (r.scope_kind === "client") {
    var cn = typeof c.clientName === "function" ? c.clientName(r.client_id) : "";
    where = " for " + (cn || "a client");
  }
  var when;
  if (r.trigger_kind === "section_moved") when = "When a task moves to " + (t.section || "a section");
  else if (r.trigger_kind === "done") when = "When a task is marked done";
  else if (r.trigger_kind === "overdue") when = "When a task becomes overdue";
  else if (r.trigger_kind === "assigned") when = t.email ? "When a task is assigned to " + who(t.email) : "When a task is assigned";
  else when = "When something happens";
  var then;
  if (r.action_kind === "assign") then = "assign it to " + (who(a.email) || "someone");
  else if (r.action_kind === "set_due") then = "set the due date " + TKRU__days(a.days, a.business === true);
  else if (r.action_kind === "move_section") then = "move it to " + (a.section || "a section");
  else if (r.action_kind === "comment") then = "post a System comment";
  else if (r.action_kind === "follow_up") {
    var fa = a.assignee && a.assignee !== "same" ? who(a.assignee) : "the same person";
    then = 'add a follow-up "' + (a.title || "") + '" for ' + fa + (a.days != null && a.days !== "" ? ", due " + TKRU__days(a.days, false) : "");
  } else then = "do nothing";
  return when + where + ", " + then + ".";
}

// Owner-only on; any full admin may switch a rule off. Archived rules stay off.
function TKRU_canToggle(staffUser, rule, turnOn) {
  var u = staffUser || {};
  if (!(u.role === "admin")) return false;
  if (rule && rule.archived_at) return false;
  if (turnOn) return u.isInternalOwner === true;
  return true;
}

function TKRU_runLabel(outcome) {
  return TKRU_RUN_LABELS[outcome] || "Unknown";
}

function TKRU_dryLabel(outcome) {
  return TKRU_DRY_LABELS[outcome] || "Unknown";
}

// The note at the top of the page. live = firm switch on.
function TKRU_gateNote(live) {
  if (live) return "Rules run for rules that are switched on.";
  return "Rules are not running: Slate plus is off for the firm. Use Dry run to see what a rule would do.";
}

// Friendly text for a thrown RPC error.
function TKRU_errorText(err) {
  var why = err && (err.reason || err.code) ? String(err.reason || err.code) : "";
  if (why === "tk_forbidden") return "Only admins can manage rules.";
  if (why === "tk_not_found") return "That rule is gone. Reload the page.";
  if (why === "tk_offline") return "You're offline. Try again when you're back online.";
  return "Couldn't do that. Try again.";
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    TKRU_TRIGGERS: TKRU_TRIGGERS,
    TKRU_ACTIONS: TKRU_ACTIONS,
    TKRU_PAIRS: TKRU_PAIRS,
    TKRU_TRIGGER_LABELS: TKRU_TRIGGER_LABELS,
    TKRU_ACTION_LABELS: TKRU_ACTION_LABELS,
    TKRU_pairOk: TKRU_pairOk,
    TKRU_actionsFor: TKRU_actionsFor,
    TKRU_blankDraft: TKRU_blankDraft,
    TKRU_draftFromRule: TKRU_draftFromRule,
    TKRU_payload: TKRU_payload,
    TKRU_validate: TKRU_validate,
    TKRU_loopDecision: TKRU_loopDecision,
    TKRU_describe: TKRU_describe,
    TKRU_canToggle: TKRU_canToggle,
    TKRU_runLabel: TKRU_runLabel,
    TKRU_dryLabel: TKRU_dryLabel,
    TKRU_gateNote: TKRU_gateNote,
    TKRU_errorText: TKRU_errorText,
  };
}
