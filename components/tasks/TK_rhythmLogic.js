// ----------------------------------------------------------------------------
// TK_rhythmLogic: the firm's month rhythm (Slate month rhythm, slice 1).
// Spec: docs/slate-rhythm-slice-1.md, docs/slate-month-rhythm.md.
//
// tk_settings key "month_rhythm":
//   { parts: [ { key: "check_in",  label: "Check in",     day: 4 },
//              { key: "reports",   label: "Send reports", day: 14 },
//              { key: "follow_up", label: "Follow up",    day: 24 } ],
//     roll: "next" }
// Missing row = that default. The same rules run in SQL
// (tk_month_rhythm_problem in supabase/slate-rhythm-1-settings.sql) with
// shared vectors in TK_rhythm.fixtures.js.
//
// The firm switch tk_settings.month_rhythm_enabled (owner-only, never set by
// code) and the per-person preview checkbox mgb_rhythm_preview are read by ONE
// helper, TK_rhythmEnabled(). Later slices gate on it; slice 1 gates nothing.
//
// Pure functions first (node-tested). The browser helpers at the bottom only
// touch window/localStorage/TK_api when called.
// ----------------------------------------------------------------------------

var TK_RHYTHM_KEY = "month_rhythm";
var TK_RHYTHM_SWITCH_KEY = "month_rhythm_enabled";
var TK_RHYTHM_PREVIEW_KEY = "mgb_rhythm_preview";
var TK_RHYTHM_PART_KEYS = ["check_in", "reports", "follow_up"];
var TK_RHYTHM_ROLLS = ["next", "prev", "none"];
var TK_RHYTHM_DAY_MIN = 1;
var TK_RHYTHM_DAY_MAX = 28;
var TK_RHYTHM_LABEL_MAX = 40;
// Blank label characters. Same explicit set as v_blank in
// tk_month_rhythm_problem (supabase/slate-rhythm-1b-label-parity.sql), so JS
// and SQL agree (String.trim() and the SQL \s class differ on a few).
var TK_RHYTHM_BLANK_RE = /^[\t\n\x0b\f\r \u0085\u00a0\u1680\u2000-\u200b\u2028\u2029\u202f\u205f\u3000\ufeff]*$/;
// Label length in code points, like SQL char_length (an emoji counts once).
function TK_rh__len(s) {
  return Array.from(s).length;
}
var TK_RHYTHM_DEFAULT = {
  parts: [
    { key: "check_in", label: "Check in", day: 4 },
    { key: "reports", label: "Send reports", day: 14 },
    { key: "follow_up", label: "Follow up", day: 24 },
  ],
  roll: "next",
};
var TK_RHYTHM_ROLL_LABELS = {
  next: "Move to the next business day",
  prev: "Move to the business day before",
  none: "Keep the date",
};
var TK_RHYTHM_ROLL_SHORT = {
  next: "next business day",
  prev: "business day before",
  none: "date kept",
};
var TK_RHYTHM_PROBLEM_TEXT = {
  not_object: "The saved rhythm is not in the expected shape.",
  parts_missing: "The saved rhythm has no list of parts.",
  parts_count: "The rhythm needs exactly three parts: Check in, Send reports and Follow up.",
  part_key: "The parts must be Check in, Send reports and Follow up, in that order.",
  part_day: "Each day must be a whole number from 1 to 28.",
  day_order: "Each date must come after the one before it: Check in, then Send reports, then Follow up.",
  label: "Each part name must be 1 to 40 characters.",
  roll: "Choose what happens when a date falls on a weekend or firm holiday.",
};

function TK_rhythmDefault() {
  return JSON.parse(JSON.stringify(TK_RHYTHM_DEFAULT));
}

function TK_rh__isObj(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

// The first problem code with a value, or null when it is valid. Same order of
// checks as the SQL twin, so both name the same problem.
function TK_rhythmProblem(v) {
  if (!TK_rh__isObj(v)) return "not_object";
  if (!Array.isArray(v.parts)) return "parts_missing";
  if (v.parts.length !== TK_RHYTHM_PART_KEYS.length) return "parts_count";
  var prev = 0;
  for (var i = 0; i < v.parts.length; i++) {
    var p = v.parts[i];
    if (!TK_rh__isObj(p) || p.key !== TK_RHYTHM_PART_KEYS[i]) return "part_key";
    var d = p.day;
    if (typeof d !== "number" || !isFinite(d) || Math.floor(d) !== d || d < TK_RHYTHM_DAY_MIN || d > TK_RHYTHM_DAY_MAX) return "part_day";
    if (d <= prev) return "day_order";
    prev = d;
    if (p.label !== undefined) {
      if (typeof p.label !== "string" || TK_RHYTHM_BLANK_RE.test(p.label) || TK_rh__len(p.label) > TK_RHYTHM_LABEL_MAX) return "label";
    }
  }
  if (TK_RHYTHM_ROLLS.indexOf(v.roll) < 0) return "roll";
  return null;
}

function TK_rhythmValid(v) {
  return TK_rhythmProblem(v) === null;
}

function TK_rhythmProblemText(code) {
  return code ? TK_RHYTHM_PROBLEM_TEXT[code] || "The rhythm is not valid." : "";
}

// A valid value -> a clean copy (default labels filled in, other fields dropped).
function TK_rhythmNormalize(v) {
  if (!TK_rhythmValid(v)) return null;
  return {
    parts: v.parts.map(function (p, i) {
      return {
        key: p.key,
        label: p.label !== undefined ? p.label.trim() : TK_RHYTHM_DEFAULT.parts[i].label,
        day: p.day,
      };
    }),
    roll: v.roll,
  };
}

// The stored setting -> what the app uses.
//   undefined (no row)  -> the default, source "default"
//   a valid value       -> that value, source "firm"
//   anything else       -> rhythm null, source "invalid" (fail closed)
function TK_rhythmResolve(stored) {
  if (stored === undefined) return { rhythm: TK_rhythmDefault(), source: "default", problem: null };
  var problem = TK_rhythmProblem(stored);
  if (problem) return { rhythm: null, source: "invalid", problem: problem };
  return { rhythm: TK_rhythmNormalize(stored), source: "firm", problem: null };
}

// { check_in: 4, reports: 14, follow_up: 24 } from a rhythm.
function TK_rhythmDays(r) {
  var out = {};
  if (!r || !Array.isArray(r.parts)) return out;
  r.parts.forEach(function (p) {
    if (p && p.key) out[p.key] = p.day;
  });
  return out;
}

// The part with that key, or null.
function TK_rhythmPart(r, key) {
  if (!r || !Array.isArray(r.parts)) return null;
  for (var i = 0; i < r.parts.length; i++) if (r.parts[i] && r.parts[i].key === key) return r.parts[i];
  return null;
}

function TK_rhythmOrdinal(n) {
  var x = Number(n);
  if (!isFinite(x)) return String(n);
  var m100 = x % 100;
  var m10 = x % 10;
  var suf = m100 >= 11 && m100 <= 13 ? "th" : m10 === 1 ? "st" : m10 === 2 ? "nd" : m10 === 3 ? "rd" : "th";
  return x + suf;
}

// "4th, 14th, 24th · next business day"
function TK_rhythmSummary(v) {
  var r = TK_rhythmNormalize(v);
  if (!r) return "Not valid";
  return r.parts.map(function (p) { return TK_rhythmOrdinal(p.day); }).join(", ") + " · " + TK_RHYTHM_ROLL_SHORT[r.roll];
}

// The editor's form: { check_in, reports, follow_up, roll } as typed (numbers
// or strings). Returns { value, errors } where errors maps a field to text.
// value is null while there are errors. Labels always come from the default
// (they are final copy) unless keepLabels gives the stored rhythm's labels.
function TK_rhythmFromForm(form, keepLabels) {
  var f = form || {};
  var errors = {};
  var labels = {};
  var base = TK_rhythmNormalize(keepLabels) || TK_rhythmDefault();
  base.parts.forEach(function (p) { labels[p.key] = p.label; });
  var days = {};
  TK_RHYTHM_PART_KEYS.forEach(function (k) {
    var raw = f[k];
    var s = typeof raw === "number" ? String(raw) : String(raw == null ? "" : raw).trim();
    if (!/^\d{1,2}$/.test(s) || Number(s) < TK_RHYTHM_DAY_MIN || Number(s) > TK_RHYTHM_DAY_MAX) {
      errors[k] = "Pick a day from 1 to 28.";
      return;
    }
    days[k] = Number(s);
  });
  if (!errors.check_in && !errors.reports && days.reports <= days.check_in) {
    errors.reports = "Must be after the Check in day.";
  }
  if (!errors.reports && !errors.follow_up && days.follow_up <= days.reports) {
    errors.follow_up = "Must be after the Send reports day.";
  } else if (!errors.check_in && !errors.follow_up && errors.reports && days.follow_up <= days.check_in) {
    errors.follow_up = "Must be after the Check in day.";
  }
  if (TK_RHYTHM_ROLLS.indexOf(f.roll) < 0) errors.roll = TK_RHYTHM_PROBLEM_TEXT.roll;
  if (Object.keys(errors).length) return { value: null, errors: errors };
  var value = {
    parts: TK_RHYTHM_PART_KEYS.map(function (k) {
      return { key: k, label: labels[k], day: days[k] };
    }),
    roll: f.roll,
  };
  // Belt and braces: the form rules are the same as TK_rhythmProblem.
  var problem = TK_rhythmProblem(value);
  if (problem) return { value: null, errors: { form: TK_rhythmProblemText(problem) } };
  return { value: value, errors: {} };
}

// A rhythm -> the form's starting values.
function TK_rhythmToForm(r) {
  var n = TK_rhythmNormalize(r) || TK_rhythmDefault();
  var d = TK_rhythmDays(n);
  return { check_in: d.check_in, reports: d.reports, follow_up: d.follow_up, roll: n.roll };
}

// True when two rhythms set the same days and roll (labels ignored).
function TK_rhythmSame(a, b) {
  var x = TK_rhythmNormalize(a);
  var y = TK_rhythmNormalize(b);
  if (!x || !y) return false;
  var dx = TK_rhythmDays(x);
  var dy = TK_rhythmDays(y);
  return x.roll === y.roll && TK_RHYTHM_PART_KEYS.every(function (k) { return dx[k] === dy[k]; });
}

// Same reading as WB_flagValueOn: true, "true", 1 or { on: true }.
function TK_rhythmFlagValueOn(v) {
  return v === true || v === "true" || v === 1 || (!!v && typeof v === "object" && v.on === true);
}

// The gate: the person's preview, or the firm switch. (A Classic opt-out can
// be added at launch; it would win over both.)
function TK_rhythmIsOn(settingValue, previewOn) {
  return !!previewOn || TK_rhythmFlagValueOn(settingValue);
}

// ---- Slice 5: a client's own rhythm (client_profile.rhythm) --------------------
// Spec: docs/slate-rhythm-slice-5.md. The override is only the three days: an
// array [{ key, day }] x3 in part order (labels tolerated, ignored). Labels and
// the weekend or holiday roll always come from the firm setting. SQL twins:
// tk_client_rhythm_problem / tk_month_rhythm_merge
// (supabase/slate-rhythm-5-client-override.sql); shared vectors in
// TK_rhythmClient.fixtures.js.

// null for no override (null / undefined) or a valid one; else the problem code,
// checked with the firm validator (roll is not part of an override).
function TK_clientRhythmProblem(v) {
  if (v === null || v === undefined) return null;
  return TK_rhythmProblem({ parts: v, roll: "next" });
}

// The rhythm a client's firm_part tasks use: client, then firm, then fail closed.
//   firm missing or invalid -> null
//   no override             -> the firm value as given
//   invalid override        -> null (never quietly the firm days)
//   otherwise               -> firm labels and roll with the client's three days
// This is the merged value TK_resolveDue's 5th argument expects.
function TK_rhythmForClient(firmRhythm, clientRhythm) {
  if (TK_rhythmProblem(firmRhythm) !== null) return null;
  if (clientRhythm === null || clientRhythm === undefined) return firmRhythm;
  if (TK_clientRhythmProblem(clientRhythm) !== null) return null;
  return {
    parts: firmRhythm.parts.map(function (fp, i) {
      var out = { key: fp.key };
      if (fp.label !== undefined) out.label = fp.label;
      out.day = clientRhythm[i].day;
      return out;
    }),
    roll: firmRhythm.roll,
  };
}

// The editor's three days -> { value: [{key, day}] x3 | null, errors }.
// Same rules and messages as the firm form (TK_rhythmFromForm).
function TK_clientRhythmFromForm(form) {
  var f = Object.assign({}, form || {}, { roll: "next" });
  var built = TK_rhythmFromForm(f, null);
  if (!built.value) return { value: null, errors: built.errors };
  return {
    value: built.value.parts.map(function (p) { return { key: p.key, day: p.day }; }),
    errors: {},
  };
}

// "5th, 15th, 25th" from an override (or a merged rhythm); "" when not valid.
function TK_clientRhythmDaysText(v) {
  var parts = Array.isArray(v) ? v : v && Array.isArray(v.parts) ? v.parts : null;
  if (!parts || TK_clientRhythmProblem(parts) !== null) return "";
  return parts.map(function (p) { return TK_rhythmOrdinal(p.day); }).join(", ");
}

// The client Settings tab line.
//   no override -> "Uses the firm rhythm (4th, 14th, 24th)"
//   override    -> "Own rhythm: 5th, 15th, 25th"
//   bad value   -> a plain warning (the generator skips this client's rhythm tasks)
function TK_clientRhythmSummary(firmRhythm, clientRhythm) {
  if (clientRhythm === null || clientRhythm === undefined) {
    var firmDays = TK_clientRhythmDaysText(firmRhythm);
    return firmDays ? "Uses the firm rhythm (" + firmDays + ")" : "Uses the firm rhythm";
  }
  // An override must be the bare array (what the server merges); any other
  // shape fails closed there, so it is reported as not valid here too.
  var own = TK_clientRhythmProblem(clientRhythm) === null ? TK_clientRhythmDaysText(clientRhythm) : "";
  if (!own) return "This client's own rhythm is not valid, so its month rhythm tasks are not made. An admin can save it again or switch back to the firm rhythm.";
  return "Own rhythm: " + own;
}

// ---- Browser helpers (not used by node tests) ----

var TK_rhythmState = { loaded: false, switchValue: undefined, stored: undefined, promise: null };

function TK_rhythmPreviewOn() {
  try {
    return window.localStorage.getItem(TK_RHYTHM_PREVIEW_KEY) === "1";
  } catch (e) {
    return false;
  }
}

// The firm switch as index.html's inline script last read it (mgb_rhythm_cache,
// "1" only while month_rhythm_enabled is on; the same single tk_settings read as
// Brand colors, Hover menus and the Slate app). It lets every page see the
// launched month rhythm without first opening Settings or Recurring.
var TK_RHYTHM_CACHE_KEY = "mgb_rhythm_cache";
function TK_rhythmCacheOn() {
  try {
    return window.localStorage.getItem(TK_RHYTHM_CACHE_KEY) === "1";
  } catch (e) {
    return false;
  }
}

// THE one check every later slice calls. Once TK_rhythmLoad() has read the
// switch, that answer wins. Before then it answers from the cached firm
// switch (mgb_rhythm_cache, above) or the person's preview; with no cache the
// switch counts as off, the safe default.
function TK_rhythmEnabled() {
  var sw = TK_rhythmState.loaded ? TK_rhythmState.switchValue : TK_rhythmCacheOn() ? true : undefined;
  return TK_rhythmIsOn(sw, TK_rhythmPreviewOn());
}

// Reads month_rhythm and month_rhythm_enabled once (pass force to re-read).
// Resolves { enabled, rhythm, source, problem }. Never rejects: a failed read
// keeps the switch off and the rhythm at the default.
function TK_rhythmLoad(force) {
  if (TK_rhythmState.promise && !force) return TK_rhythmState.promise;
  var p = Promise.resolve()
    .then(function () {
      return typeof TK_api !== "undefined" && TK_api.getSettings ? TK_api.getSettings() : {};
    })
    .catch(function () { return {}; })
    .then(function (all) {
      var s = all || {};
      TK_rhythmState.loaded = true;
      TK_rhythmState.switchValue = s[TK_RHYTHM_SWITCH_KEY];
      TK_rhythmState.stored = s[TK_RHYTHM_KEY];
      var res = TK_rhythmResolve(s[TK_RHYTHM_KEY]);
      return { enabled: TK_rhythmEnabled(), rhythm: res.rhythm, source: res.source, problem: res.problem };
    });
  TK_rhythmState.promise = p;
  return p;
}

// ---- Slice 4: report state (rows 6, 7, 8) ------------------------------------
// Rhythm rows are found by task_templates.source_ref, never by title or id.
var TK_RHYTHM_ROW_REFS = {
  "month_rhythm:6_reports": "reports",
  "month_rhythm:7_follow_up": "follow_7",
  "month_rhythm:8_follow_up": "follow_8",
};
var TK_REPORT_MISSING_MAX = 30;
var TK_REPORT_LABEL_MAX = 200;
var TK__RH_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August",
  "September", "October", "November", "December"];

// "reports" | "follow_7" | "follow_8" | null, from a template row (or its source_ref).
function TK_rhythmRowOf(tpl) {
  var ref = tpl && typeof tpl === "object" ? tpl.source_ref : tpl;
  return (ref && TK_RHYTHM_ROW_REFS[String(ref)]) || null;
}

// The task's books month as "YYYY-MM-01", only for month-period tasks.
function TK_reportPeriodOf(task) {
  if (!task || task.period_kind !== "month" || !task.period_start) return null;
  var m = String(task.period_start).slice(0, 7);
  return /^\d{4}-\d{2}$/.test(m) ? m + "-01" : null;
}

// Row 6 needs the picker: rhythm on, a reports-row task with a client and a month.
function TK_reportPickerNeeded(task, tpl, enabled) {
  if (!enabled || !task || !task.client_id) return false;
  if (TK_rhythmRowOf(tpl) !== "reports") return false;
  return !!TK_reportPeriodOf(task);
}

function TK_rh__label(v) {
  var s = String(v == null ? "" : v).replace(/\s+/g, " ").trim();
  return s.length > TK_REPORT_LABEL_MAX ? s.slice(0, TK_REPORT_LABEL_MAX) : s;
}

// Prefill for a preliminary send: the client's open Ask client requests
// (never legacy document requests), newest first as the server lists them.
function TK_reportMissingPrefill(requests) {
  var out = [];
  var list = Array.isArray(requests) ? requests : [];
  for (var i = 0; i < list.length && out.length < TK_REPORT_MISSING_MAX; i++) {
    var r = list[i];
    if (!r || r.status !== "open" || r.legacy || r.deleted_at) continue;
    var label = TK_rh__label(r.title);
    if (!label) continue;
    out.push({ label: label, request_id: r.id || null });
  }
  return out;
}

// What the RPC gets: trimmed labels, blanks dropped, at most 30.
function TK_reportMissingClean(items) {
  var out = [];
  var list = Array.isArray(items) ? items : [];
  for (var i = 0; i < list.length && out.length < TK_REPORT_MISSING_MAX; i++) {
    var it = list[i];
    var label = TK_rh__label(it && typeof it === "object" ? it.label : it);
    if (!label) continue;
    out.push({ label: label, request_id: (it && typeof it === "object" && it.request_id) || null });
  }
  return out;
}

// null when the picker can save; else a plain message.
function TK_reportPickerProblem(state, items) {
  if (state !== "full" && state !== "preliminary") return "Pick Full or Preliminary.";
  if (state === "preliminary" && TK_reportMissingClean(items).length === 0) {
    return "List at least one item that is still missing.";
  }
  return null;
}

// "October 2026" from "2026-10-01".
function TK_reportMonthLabel(period) {
  var m = /^(\d{4})-(\d{2})/.exec(String(period || ""));
  if (!m) return "";
  var idx = Number(m[2]) - 1;
  return idx >= 0 && idx < 12 ? TK__RH_MONTHS[idx] + " " + m[1] : "";
}

// Client portal: preliminary rows only, newest month first, plain labels.
function TK_clientReportBadges(rows) {
  var out = [];
  var list = Array.isArray(rows) ? rows : [];
  for (var i = 0; i < list.length; i++) {
    var r = list[i];
    if (!r || r.state !== "preliminary" || !r.period) continue;
    var month = TK_reportMonthLabel(r.period);
    if (!month) continue;
    var missing = [];
    var items = Array.isArray(r.missing) ? r.missing : [];
    for (var j = 0; j < items.length; j++) {
      var label = TK_rh__label(items[j] && items[j].label);
      if (label) missing.push({ label: label, request_id: (items[j] && items[j].request_id) || null });
    }
    out.push({ period: String(r.period).slice(0, 10), month: month, missing: missing });
  }
  out.sort(function (a, b) { return a.period < b.period ? 1 : a.period > b.period ? -1 : 0; });
  return out;
}

// ---- Before flip (b): bulk complete asks Full or Preliminary too -------------
// rows: the Send reports tasks the bulk bar is about to complete (only those
// that need the picker). names: { client_id: name }. Sorted by client, then month.
function TK_bulkReportRows(tasks, names) {
  var out = [];
  var seen = {};
  var map = names && typeof names === "object" ? names : {};
  var list = Array.isArray(tasks) ? tasks : [];
  for (var i = 0; i < list.length; i++) {
    var t = list[i];
    if (!t || !t.id || seen[t.id] || !t.client_id) continue;
    var period = TK_reportPeriodOf(t);
    if (!period) continue;
    seen[t.id] = true;
    var cid = String(t.client_id);
    out.push({
      id: t.id,
      client_id: cid,
      clientName: String(map[cid] || t.client_name || cid),
      period: period,
      month: TK_reportMonthLabel(period),
    });
  }
  out.sort(function (a, b) {
    var x = a.clientName.toLowerCase();
    var y = b.clientName.toLowerCase();
    if (x !== y) return x < y ? -1 : 1;
    return a.period < b.period ? -1 : a.period > b.period ? 1 : 0;
  });
  return out;
}

// choices: { task id: { state, items } }. null when every row can save, else
// { id, text } for the first row that cannot.
function TK_bulkReportProblem(rows, choices) {
  var list = Array.isArray(rows) ? rows : [];
  var c = choices && typeof choices === "object" ? choices : {};
  if (!list.length) return { id: null, text: "Nothing to save." };
  for (var i = 0; i < list.length; i++) {
    var ch = c[list[i].id] || {};
    var problem = TK_reportPickerProblem(ch.state, ch.items);
    if (problem) {
      var who = list[i].clientName + (list[i].month ? ", " + list[i].month : "");
      return { id: list[i].id, text: who + ": " + problem };
    }
  }
  return null;
}

// What to save, one entry per row: { id, client_id, period, state, missing }.
function TK_bulkReportPlan(rows, choices) {
  var list = Array.isArray(rows) ? rows : [];
  var c = choices && typeof choices === "object" ? choices : {};
  var out = [];
  for (var i = 0; i < list.length; i++) {
    var ch = c[list[i].id] || {};
    if (ch.state !== "full" && ch.state !== "preliminary") continue;
    out.push({
      id: list[i].id,
      client_id: list[i].client_id,
      period: list[i].period,
      state: ch.state,
      missing: ch.state === "preliminary" ? TK_reportMissingClean(ch.items) : [],
    });
  }
  return out;
}

// After the saves: the ids to complete (every selected id except a row whose
// save failed) and the toast for the failures ("" when none failed).
function TK_bulkReportAfter(ids, failedIds) {
  var failed = {};
  (Array.isArray(failedIds) ? failedIds : []).forEach(function (id) { failed[id] = true; });
  var keep = (Array.isArray(ids) ? ids : []).filter(function (id) { return !failed[id]; });
  var n = Object.keys(failed).length;
  var text = !n ? "" : n === 1
    ? "One Send reports task could not save Full or Preliminary, so it was left open."
    : n + " Send reports tasks could not save Full or Preliminary, so they were left open.";
  return { ids: keep, text: text };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    TK_RHYTHM_KEY: TK_RHYTHM_KEY,
    TK_bulkReportRows: TK_bulkReportRows,
    TK_bulkReportProblem: TK_bulkReportProblem,
    TK_bulkReportPlan: TK_bulkReportPlan,
    TK_bulkReportAfter: TK_bulkReportAfter,
    TK_RHYTHM_SWITCH_KEY: TK_RHYTHM_SWITCH_KEY,
    TK_RHYTHM_PREVIEW_KEY: TK_RHYTHM_PREVIEW_KEY,
    TK_RHYTHM_PART_KEYS: TK_RHYTHM_PART_KEYS,
    TK_RHYTHM_ROLLS: TK_RHYTHM_ROLLS,
    TK_RHYTHM_BLANK_RE: TK_RHYTHM_BLANK_RE,
    TK_RHYTHM_DEFAULT: TK_RHYTHM_DEFAULT,
    TK_RHYTHM_ROLL_LABELS: TK_RHYTHM_ROLL_LABELS,
    TK_RHYTHM_PROBLEM_TEXT: TK_RHYTHM_PROBLEM_TEXT,
    TK_rhythmDefault: TK_rhythmDefault,
    TK_rhythmProblem: TK_rhythmProblem,
    TK_rhythmValid: TK_rhythmValid,
    TK_rhythmProblemText: TK_rhythmProblemText,
    TK_rhythmNormalize: TK_rhythmNormalize,
    TK_rhythmResolve: TK_rhythmResolve,
    TK_rhythmDays: TK_rhythmDays,
    TK_rhythmPart: TK_rhythmPart,
    TK_rhythmOrdinal: TK_rhythmOrdinal,
    TK_rhythmSummary: TK_rhythmSummary,
    TK_rhythmFromForm: TK_rhythmFromForm,
    TK_rhythmToForm: TK_rhythmToForm,
    TK_rhythmSame: TK_rhythmSame,
    TK_rhythmFlagValueOn: TK_rhythmFlagValueOn,
    TK_rhythmIsOn: TK_rhythmIsOn,
    TK_rhythmEnabled: TK_rhythmEnabled,
    TK_RHYTHM_CACHE_KEY: TK_RHYTHM_CACHE_KEY,
    TK_rhythmCacheOn: TK_rhythmCacheOn,
    TK_rhythmState: TK_rhythmState,
    TK_clientRhythmProblem: TK_clientRhythmProblem,
    TK_rhythmForClient: TK_rhythmForClient,
    TK_clientRhythmFromForm: TK_clientRhythmFromForm,
    TK_clientRhythmDaysText: TK_clientRhythmDaysText,
    TK_clientRhythmSummary: TK_clientRhythmSummary,
    TK_RHYTHM_ROW_REFS: TK_RHYTHM_ROW_REFS,
    TK_REPORT_MISSING_MAX: TK_REPORT_MISSING_MAX,
    TK_rhythmRowOf: TK_rhythmRowOf,
    TK_reportPeriodOf: TK_reportPeriodOf,
    TK_reportPickerNeeded: TK_reportPickerNeeded,
    TK_reportMissingPrefill: TK_reportMissingPrefill,
    TK_reportMissingClean: TK_reportMissingClean,
    TK_reportPickerProblem: TK_reportPickerProblem,
    TK_reportMonthLabel: TK_reportMonthLabel,
    TK_clientReportBadges: TK_clientReportBadges,
  };
}
