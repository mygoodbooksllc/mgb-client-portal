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

// ---- Browser helpers (not used by node tests) ----

var TK_rhythmState = { loaded: false, switchValue: undefined, stored: undefined, promise: null };

function TK_rhythmPreviewOn() {
  try {
    return window.localStorage.getItem(TK_RHYTHM_PREVIEW_KEY) === "1";
  } catch (e) {
    return false;
  }
}

// THE one check every later slice calls. Until TK_rhythmLoad() has read the
// switch, it answers from the person's preview alone (the switch is off by
// default, so that is the safe answer).
function TK_rhythmEnabled() {
  return TK_rhythmIsOn(TK_rhythmState.switchValue, TK_rhythmPreviewOn());
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

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    TK_RHYTHM_KEY: TK_RHYTHM_KEY,
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
    TK_rhythmState: TK_rhythmState,
  };
}
