// ----------------------------------------------------------------------------
// TK_customFields: Slate plus custom fields on tasks, hidden preview.
// Spec: docs/slateplus-customfields-spec.md. Data: supabase/slateplus-customfields.sql.
//
// Gate: TKP_on() (components/tasks/TK_slatePlus.js). While it is false every
// runtime helper here answers "nothing" (empty list / null) and makes no
// network call, so rows and the drawer render exactly as before.
//
// Pure rules (node tests in TK_customFields.test.js):
//   TKCF_nameCheck(name, fields, selfId)     1-40 chars, unique in the list (any case)
//   TKCF_normalizeOptions(list)              dropdown options for a save
//   TKCF_parseOptionsText(text, old)         one per line -> options (keeps ids by label)
//   TKCF_validateValue(field, raw)           browser mirror of the server trigger
//   TKCF_format(field, value, staff)         display text
//   TKCF_isFilled(field, value)              shows a chip
//   TKCF_indexFields(rows)                   { byId, byTarget: { "p:<id>" | "c:<id>": [active, sorted] } }
//   TKCF_indexValues(rows)                   { taskId: { fieldId: { value, updated_by, updated_at } } }
//   TKCF_fieldsForTask(task, fidx)           project fields first, then client fields
//   TKCF_chips(fields, vals, staff, max)     { chips: [...], more, moreTitle }
//   TKCF_compare(field, a, b)                sort two values (empty last)
//   TKCF_reorder(ids, from, to)              ids with one moved
//   TKCF_errText(e)                          plain words for a refusal
//
// Runtime (browser): TKCF_load, TKCF_loadTask, TKCF_ready, TKCF_fieldsOf,
// TKCF_listFor, TKCF_valuesOf, TKCF_setValue, TKCF_saveField, TKCF_archiveField,
// TKCF_orderFields, TKCF_useFields. Plain JS (no JSX).
// ----------------------------------------------------------------------------

var TKCF_EVENT = "mgb:tkcf";
var TKCF_MAX_FIELDS = 15;
var TKCF_MAX_OPTIONS = 20;
var TKCF_NAME_MAX = 40;
var TKCF_TEXT_MAX = 500;
var TKCF_CHIP_MAX = 3;
var TKCF_TYPES = [
  { id: "text", label: "Text" },
  { id: "number", label: "Number" },
  { id: "dropdown", label: "Dropdown" },
  { id: "date", label: "Date" },
  { id: "checkbox", label: "Checkbox" },
  { id: "person", label: "Person" },
];
var TKCF_CAP_TEXT = "15 fields is the most for one list. Archive one to add another.";

function TKCF__lc(v) {
  return v == null ? "" : String(v).trim().toLowerCase();
}

function TKCF__clean(v) {
  return v == null ? "" : String(v).replace(/\s+/g, " ").trim();
}

function TKCF_typeLabel(type) {
  for (var i = 0; i < TKCF_TYPES.length; i++) if (TKCF_TYPES[i].id === type) return TKCF_TYPES[i].label;
  return "Field";
}

function TKCF_isType(type) {
  for (var i = 0; i < TKCF_TYPES.length; i++) if (TKCF_TYPES[i].id === type) return true;
  return false;
}

// fields: the list's active fields (any shape with id + name). selfId: the
// field being renamed (it does not clash with itself).
function TKCF_nameCheck(name, fields, selfId) {
  var n = TKCF__clean(name);
  if (!n) return { ok: false, name: n, error: "Give the field a name." };
  if (n.length > TKCF_NAME_MAX) return { ok: false, name: n, error: "A field name is 40 characters at most." };
  var lc = n.toLowerCase();
  var list = Array.isArray(fields) ? fields : [];
  for (var i = 0; i < list.length; i++) {
    var f = list[i];
    if (!f || f.archived_at) continue;
    if (selfId != null && String(f.id) === String(selfId)) continue;
    if (TKCF__lc(f.name) === lc) return { ok: false, name: n, error: "This list already has a field called " + f.name + "." };
  }
  return { ok: true, name: n, error: "" };
}

// list: [{ id?, label }] (active options only; the server keeps any removed
// option that tasks still use, as retired). Returns the cleaned list to send.
function TKCF_normalizeOptions(list) {
  var out = [];
  var seen = {};
  var ids = {};
  var src = Array.isArray(list) ? list : [];
  for (var i = 0; i < src.length; i++) {
    var o = src[i];
    if (!o) continue;
    if (o.retired) continue;
    var label = TKCF__clean(o.label);
    if (!label) continue;
    if (label.length > TKCF_NAME_MAX) return { ok: false, options: [], error: "An option is 40 characters at most." };
    var lc = label.toLowerCase();
    if (seen[lc]) return { ok: false, options: [], error: "Two options are called " + label + "." };
    seen[lc] = true;
    var item = { label: label };
    if (o.id && /^[A-Za-z0-9_-]{1,40}$/.test(String(o.id)) && !ids[o.id]) {
      item.id = String(o.id);
      ids[o.id] = true;
    }
    out.push(item);
  }
  if (!out.length) return { ok: false, options: [], error: "Add at least one option." };
  if (out.length > TKCF_MAX_OPTIONS) return { ok: false, options: [], error: "20 options is the most for one dropdown." };
  return { ok: true, options: out, error: "" };
}

// The panel edits options as text, one per line. A line whose label matches an
// existing (active or retired) option keeps that option's id, so tasks that use
// it keep it. Renaming in place is done per option (the rows editor), not here.
function TKCF_parseOptionsText(text, oldOptions) {
  var byLabel = {};
  (Array.isArray(oldOptions) ? oldOptions : []).forEach(function (o) {
    if (o && o.id && o.label != null) byLabel[TKCF__lc(o.label)] = o.id;
  });
  var lines = String(text == null ? "" : text).split(/\r?\n/);
  var list = [];
  lines.forEach(function (l) {
    var label = TKCF__clean(l);
    if (!label) return;
    var o = { label: label };
    var id = byLabel[label.toLowerCase()];
    if (id) o.id = id;
    list.push(o);
  });
  return TKCF_normalizeOptions(list);
}

function TKCF__option(field, id) {
  var opts = field && Array.isArray(field.options) ? field.options : [];
  for (var i = 0; i < opts.length; i++) if (opts[i] && String(opts[i].id) === String(id)) return opts[i];
  return null;
}

function TKCF_activeOptions(field) {
  var opts = field && Array.isArray(field.options) ? field.options : [];
  return opts.filter(function (o) {
    return o && !o.retired;
  });
}

function TKCF__isYmd(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  var y = +s.slice(0, 4);
  var m = +s.slice(5, 7);
  var d = +s.slice(8, 10);
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1) return false;
  var dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d <= dim;
}

// raw: what an editor gave (string from an input, boolean from a box). Returns
// { ok, value, error }; value null clears. Mirrors tk_custom_field_values_check
// so most mistakes never reach the server.
function TKCF_validateValue(field, raw) {
  var type = field && field.type;
  if (raw == null) return { ok: true, value: null, error: "" };
  if (type === "checkbox") {
    if (typeof raw !== "boolean") return { ok: false, value: null, error: "Tick or untick the box." };
    return { ok: true, value: raw, error: "" };
  }
  var s = typeof raw === "string" ? raw.trim() : raw;
  if (s === "") return { ok: true, value: null, error: "" };
  if (type === "text") {
    s = String(s);
    if (s.length > TKCF_TEXT_MAX) return { ok: false, value: null, error: "500 characters is the most." };
    return { ok: true, value: s, error: "" };
  }
  if (type === "number") {
    var str = String(s).replace(/,/g, "");
    if (!/^-?(\d+\.?\d*|\.\d+)$/.test(str)) return { ok: false, value: null, error: "Enter a number." };
    var n = Number(str);
    if (!isFinite(n) || Math.abs(n) >= 1e12) return { ok: false, value: null, error: "That number is too big." };
    var dec = str.indexOf(".") >= 0 ? str.split(".")[1].length : 0;
    if (dec > 6) return { ok: false, value: null, error: "Use 6 decimal places at most." };
    return { ok: true, value: n, error: "" };
  }
  if (type === "date") {
    if (!TKCF__isYmd(String(s))) return { ok: false, value: null, error: "Pick a real date." };
    return { ok: true, value: String(s), error: "" };
  }
  if (type === "dropdown") {
    var o = TKCF__option(field, s);
    if (!o) return { ok: false, value: null, error: "Pick one of the options." };
    if (o.retired) return { ok: false, value: null, error: "That option was removed. Pick another." };
    return { ok: true, value: String(o.id), error: "" };
  }
  if (type === "person") {
    var e = TKCF__lc(s);
    if (!/^[^@\s]+@[^@\s]+$/.test(e)) return { ok: false, value: null, error: "Pick a person." };
    return { ok: true, value: e, error: "" };
  }
  return { ok: false, value: null, error: "This field can't be changed here." };
}

function TKCF_isFilled(field, value) {
  if (value == null || !field) return false;
  if (field.type === "checkbox") return value === true;
  if (field.type === "text") return String(value).trim() !== "";
  // An option id the loaded field doesn't list (an options edit raced a
  // value save) shows nothing rather than a raw id.
  if (field.type === "dropdown") {
    var opts = Array.isArray(field.options) ? field.options : [];
    for (var i = 0; i < opts.length; i++) if (opts[i] && opts[i].id === value) return true;
    return false;
  }
  return true;
}

function TKCF__staffName(email, staff) {
  var e = TKCF__lc(email);
  var list = Array.isArray(staff) ? staff : [];
  for (var i = 0; i < list.length; i++) {
    if (list[i] && TKCF__lc(list[i].email) === e) return TKCF__clean(list[i].name) || list[i].email;
  }
  return email ? String(email) : "";
}

var TKCF__MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function TKCF__fmtNumber(n) {
  var x = Number(n);
  if (!isFinite(x)) return String(n);
  var neg = x < 0;
  var parts = String(Math.abs(x)).split(".");
  if (/e/i.test(parts[0])) return String(x);
  var int = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (neg ? "-" : "") + int + (parts[1] ? "." + parts[1] : "");
}

// Display text for a value ("" when empty). Dates read "Mar 3, 2026"; a
// retired option still shows its label; a person shows their name.
function TKCF_format(field, value, staff) {
  if (!field || value == null) return "";
  var t = field.type;
  if (t === "checkbox") return value === true ? "Yes" : "";
  if (t === "number") return TKCF__fmtNumber(value);
  if (t === "date") {
    var s = String(value);
    if (!TKCF__isYmd(s)) return s;
    return TKCF__MONTHS[+s.slice(5, 7) - 1] + " " + +s.slice(8, 10) + ", " + s.slice(0, 4);
  }
  if (t === "dropdown") {
    var o = TKCF__option(field, value);
    return o ? TKCF__clean(o.label) : "";
  }
  if (t === "person") return TKCF__staffName(value, staff);
  return TKCF__clean(value);
}

function TKCF__key(scope, target) {
  return (scope === "client" ? "c:" : "p:") + String(target);
}

function TKCF__sortFields(a, b) {
  var pa = Number(a.position) || 0;
  var pb = Number(b.position) || 0;
  if (pa !== pb) return pa - pb;
  return String(a.created_at || "").localeCompare(String(b.created_at || ""));
}

// rows: tk_custom_fields rows (active and archived). byTarget holds active
// fields only, sorted; archived ones are in byId and archivedByTarget.
function TKCF_indexFields(rows) {
  var byId = {};
  var byTarget = {};
  var archivedByTarget = {};
  (Array.isArray(rows) ? rows : []).forEach(function (r) {
    if (!r || !r.id || !TKCF_isType(r.type)) return;
    var target = r.scope === "client" ? r.client_id : r.project_id;
    if (target == null) return;
    var f = Object.assign({}, r, { options: Array.isArray(r.options) ? r.options : [] });
    byId[String(r.id)] = f;
    var k = TKCF__key(r.scope, target);
    var bucket = f.archived_at ? archivedByTarget : byTarget;
    (bucket[k] = bucket[k] || []).push(f);
  });
  Object.keys(byTarget).forEach(function (k) {
    byTarget[k].sort(TKCF__sortFields);
  });
  Object.keys(archivedByTarget).forEach(function (k) {
    archivedByTarget[k].sort(function (a, b) {
      return String(b.archived_at || "").localeCompare(String(a.archived_at || ""));
    });
  });
  return { byId: byId, byTarget: byTarget, archivedByTarget: archivedByTarget };
}

function TKCF_indexValues(rows, into) {
  var out = into || {};
  (Array.isArray(rows) ? rows : []).forEach(function (r) {
    if (!r || !r.task_id || !r.field_id) return;
    var t = String(r.task_id);
    out[t] = out[t] || {};
    out[t][String(r.field_id)] = { value: r.value == null ? null : r.value, updated_by: r.updated_by || "", updated_at: r.updated_at || "" };
  });
  return out;
}

// The fields that apply to a task: its project's, then its client's. A task
// with neither (personal) has none.
function TKCF_fieldsForTask(task, fidx) {
  if (!task || !fidx || !fidx.byTarget) return [];
  var out = [];
  if (task.project_id) out = out.concat(fidx.byTarget[TKCF__key("project", task.project_id)] || []);
  if (task.client_id) out = out.concat(fidx.byTarget[TKCF__key("client", task.client_id)] || []);
  return out;
}

// fields: TKCF_fieldsForTask. vals: { fieldId: { value } } for that task.
function TKCF_chips(fields, vals, staff, max) {
  var lim = typeof max === "number" && max >= 0 ? max : TKCF_CHIP_MAX;
  var all = [];
  (Array.isArray(fields) ? fields : []).forEach(function (f) {
    var v = vals && vals[String(f.id)] ? vals[String(f.id)].value : null;
    if (!TKCF_isFilled(f, v)) return;
    var name = TKCF__clean(f.name);
    var text = f.type === "checkbox" ? name : name + ": " + TKCF_format(f, v, staff);
    all.push({ key: String(f.id), text: text, check: f.type === "checkbox" });
  });
  var shown = all.slice(0, lim);
  var rest = all.slice(lim);
  return {
    chips: shown,
    more: rest.length,
    moreTitle: rest
      .map(function (c) {
        return c.text;
      })
      .join("\n"),
  };
}

// Sort helper for a column / sort by field (follow-up). Empty values last.
function TKCF_compare(field, a, b) {
  var ea = !TKCF_isFilled(field, a);
  var eb = !TKCF_isFilled(field, b);
  if (ea || eb) return ea === eb ? 0 : ea ? 1 : -1;
  var t = field && field.type;
  if (t === "number") return Number(a) - Number(b);
  if (t === "checkbox") return 0;
  if (t === "dropdown") {
    var opts = (field && field.options) || [];
    var ia = -1;
    var ib = -1;
    for (var i = 0; i < opts.length; i++) {
      if (String(opts[i].id) === String(a)) ia = i;
      if (String(opts[i].id) === String(b)) ib = i;
    }
    return ia - ib;
  }
  var sa = t === "person" ? TKCF__lc(a) : String(a).toLowerCase();
  var sb = t === "person" ? TKCF__lc(b) : String(b).toLowerCase();
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

function TKCF_reorder(ids, from, to) {
  var list = Array.isArray(ids) ? ids.slice() : [];
  if (from < 0 || from >= list.length || to < 0 || to >= list.length || from === to) return list;
  var x = list.splice(from, 1)[0];
  list.splice(to, 0, x);
  return list;
}

function TKCF_errText(e) {
  var r = (e && (e.reason || e.code)) || "";
  var m = String((e && e.message) || "");
  var has = function (code) {
    return r === code || m.indexOf(code) >= 0;
  };
  if (has("tk_cf_limit")) return TKCF_CAP_TEXT;
  if (has("tk_cf_name_taken")) return "This list already has a field with that name.";
  if (has("tk_cf_bad_name")) return "A field name is 1 to 40 characters.";
  if (has("tk_cf_type_locked")) return "A field's type can't change. Make a new field instead.";
  if (has("tk_cf_bad_type")) return "Pick a field type.";
  if (has("tk_cf_bad_options")) {
    var mm = m.match(/tk_cf_bad_options: ([^\n]+)/);
    return mm ? mm[1].charAt(0).toUpperCase() + mm[1].slice(1) + "." : "Check the dropdown options.";
  }
  if (has("tk_cf_bad_order")) return "The field list changed. Close and open Fields again.";
  if (has("tk_cf_archived")) return "That field is archived.";
  if (has("tk_cf_wrong_scope")) return "That field isn't on this task's list any more.";
  if (has("tk_cf_not_found")) return "That field was removed.";
  if (has("tk_cf_bad_value")) {
    var vm = m.match(/tk_cf_bad_value: ([^\n]+)/);
    return vm ? vm[1].charAt(0).toUpperCase() + vm[1].slice(1) + "." : "That value isn't allowed.";
  }
  if (has("tk_task_in_trash")) return "That task is in the trash.";
  if (has("tk_project_archived")) return "That project is archived.";
  if (has("tk_project_trashed")) return "That project is in the trash.";
  if (has("tk_forbidden")) return "You can't change that.";
  return typeof TK_vErrText === "function" ? TK_vErrText(e) : "Couldn't save that change. Try again.";
}

// ---- Runtime (browser) -------------------------------------------------------

var TKCF__s = { fidx: TKCF_indexFields([]), vals: {}, loaded: false, loading: null, again: null, at: 0, ver: 0, fails: 0 };
var TKCF__FRESH_MS = 60000;

function TKCF_on() {
  try {
    return typeof TKP_on === "function" && TKP_on() === true;
  } catch (e) {
    return false;
  }
}

function TKCF__emit() {
  TKCF__s.ver += 1;
  try {
    window.dispatchEvent(new Event(TKCF_EVENT));
  } catch (e) {}
}

function TKCF__api(name) {
  return typeof TK_api !== "undefined" && TK_api && typeof TK_api[name] === "function";
}

// Loads every field the person can see (active and archived) and the values
// of open tasks they can read. One call in flight; fresh for a minute unless
// forced. Gate off: nothing.
function TKCF_load(force) {
  if (!TKCF_on() || !TKCF__api("cfFields") || !TKCF__api("cfValues")) return Promise.resolve(null);
  if (TKCF__s.loading) {
    if (!force) return TKCF__s.loading;
    if (!TKCF__s.again) {
      TKCF__s.again = TKCF__s.loading.then(function () {
        TKCF__s.again = null;
        return TKCF_load(true);
      });
    }
    return TKCF__s.again;
  }
  if (!force && TKCF__s.loaded && Date.now() - TKCF__s.at < TKCF__FRESH_MS) return Promise.resolve(TKCF__s.fidx);
  if (!force && TKCF__s.fails >= 3 && Date.now() - TKCF__s.at < 5 * TKCF__FRESH_MS) return Promise.resolve(null);
  var p = Promise.all([TK_api.cfFields(), TK_api.cfValues(null)]).then(
    function (res) {
      TKCF__s.fidx = TKCF_indexFields(res[0]);
      // Keep values loaded one task at a time (done tasks opened in the drawer).
      var keep = {};
      Object.keys(TKCF__s.vals).forEach(function (k) {
        if (TKCF__s.vals[k] && TKCF__s.vals[k]._single) keep[k] = TKCF__s.vals[k];
      });
      TKCF__s.vals = TKCF_indexValues(res[1], keep);
      TKCF__s.loaded = true;
      TKCF__s.fails = 0;
      TKCF__s.at = Date.now();
      TKCF__s.loading = null;
      TKCF__emit();
      return TKCF__s.fidx;
    },
    function () {
      TKCF__s.fails += 1;
      TKCF__s.at = Date.now();
      TKCF__s.loading = null;
      return null;
    },
  );
  TKCF__s.loading = p;
  return p;
}

// A fresh read of one task's values (the drawer, also for done tasks).
function TKCF_loadTask(taskId) {
  if (!TKCF_on() || taskId == null || !TKCF__api("cfValues")) return Promise.resolve(null);
  var id = String(taskId);
  return TK_api.cfValues([id]).then(
    function (rows) {
      var one = TKCF_indexValues(rows, {})[id] || {};
      Object.defineProperty(one, "_single", { value: true, enumerable: false });
      TKCF__s.vals[id] = one;
      TKCF__emit();
      return one;
    },
    function () {
      return null;
    },
  );
}

function TKCF_ready() {
  return TKCF__s.loaded && TKCF_on();
}

function TKCF__staff() {
  try {
    var st = typeof TK_store !== "undefined" && TK_store ? TK_store.getState() : null;
    return (st && Array.isArray(st.staff) && st.staff) || [];
  } catch (e) {
    return [];
  }
}

// Active fields that apply to a task, or [] while off / not loaded.
function TKCF_fieldsOf(task) {
  if (!task || !TKCF_ready()) return [];
  return TKCF_fieldsForTask(task, TKCF__s.fidx);
}

// The panel's list for one project or client: { active, archived }.
function TKCF_listFor(scope, target) {
  if (!TKCF_ready() || target == null || target === "") return { active: [], archived: [] };
  var k = TKCF__key(scope, target);
  return { active: TKCF__s.fidx.byTarget[k] || [], archived: TKCF__s.fidx.archivedByTarget[k] || [] };
}

function TKCF_valuesOf(taskId) {
  if (taskId == null || !TKCF_ready()) return {};
  return TKCF__s.vals[String(taskId)] || {};
}

function TKCF_chipsFor(task) {
  if (!task || !TKCF_ready()) return null;
  var fields = TKCF_fieldsOf(task);
  if (!fields.length) return null;
  var c = TKCF_chips(fields, TKCF_valuesOf(task.id), TKCF__staff(), TKCF_CHIP_MAX);
  return c.chips.length ? c : null;
}

function TKCF__me() {
  try {
    var st = typeof TK_store !== "undefined" && TK_store ? TK_store.getState() : null;
    return TKCF__lc(st && st.me);
  } catch (e) {
    return "";
  }
}

// Saves one value (optimistic). Resolves { ok, value } or { ok: false, error }.
function TKCF_setValue(field, task, raw) {
  if (!TKCF_on() || !field || !task || task.id == null || !TKCF__api("cfValueSet")) {
    return Promise.resolve({ ok: false, error: "" });
  }
  var chk = TKCF_validateValue(field, raw);
  if (!chk.ok) return Promise.resolve({ ok: false, error: chk.error });
  var tid = String(task.id);
  var fid = String(field.id);
  var bucket = (TKCF__s.vals[tid] = TKCF__s.vals[tid] || {});
  var before = bucket[fid];
  var prevVal = before ? before.value : null;
  if (JSON.stringify(prevVal) === JSON.stringify(chk.value)) return Promise.resolve({ ok: true, value: chk.value, same: true });
  var mine = { value: chk.value, updated_by: TKCF__me(), updated_at: new Date().toISOString() };
  bucket[fid] = mine;
  TKCF__emit();
  // A load may replace the task's bucket while the call is out: re-read it.
  var cur = function () {
    return (TKCF__s.vals[tid] = TKCF__s.vals[tid] || {});
  };
  return TK_api.cfValueSet(fid, tid, chk.value).then(
    function (res) {
      var v = res && Object.prototype.hasOwnProperty.call(res, "value") ? res.value : chk.value;
      // Only touch the entry if a newer save (or a reload) hasn't replaced it.
      var b = cur();
      if (b[fid] === mine) {
        b[fid] = { value: v == null ? null : v, updated_by: TKCF__me(), updated_at: new Date().toISOString() };
        TKCF__emit();
      }
      return { ok: true, value: v };
    },
    function (e) {
      var b = cur();
      if (b[fid] === mine) {
        if (before) b[fid] = before;
        else delete b[fid];
        TKCF__emit();
      }
      return { ok: false, error: TKCF_errText(e) };
    },
  );
}

function TKCF__after(p) {
  return p.then(
    function (res) {
      return TKCF_load(true).then(function () {
        return { ok: true, field: res };
      });
    },
    function (e) {
      return { ok: false, error: TKCF_errText(e) };
    },
  );
}

// Create (id null) or edit name / options. options: TKCF_normalizeOptions list.
function TKCF_saveField(id, scope, target, name, type, options) {
  if (!TKCF_on() || !TKCF__api("cfFieldSave")) return Promise.resolve({ ok: false, error: "" });
  return TKCF__after(TK_api.cfFieldSave(id || null, id ? null : scope, id ? null : String(target), name, id ? null : type, options || null));
}

function TKCF_archiveField(id, archive) {
  if (!TKCF_on() || !TKCF__api("cfFieldArchive")) return Promise.resolve({ ok: false, error: "" });
  return TKCF__after(TK_api.cfFieldArchive(id, archive !== false));
}

function TKCF_orderFields(ids) {
  if (!TKCF_on() || !TKCF__api("cfFieldOrder")) return Promise.resolve({ ok: false, error: "" });
  return TKCF__after(TK_api.cfFieldOrder(ids));
}

// The hook: `TKCF_useFields();` Re-renders when fields or values load or the
// gate changes; starts a load while on. Refreshes on window focus (at most
// once a minute). Off: no network, returns 0.
function TKCF_useFields() {
  var on = typeof TKP_useOn === "function" ? TKP_useOn() : false;
  var s = React.useState(0);
  var bump = s[1];
  React.useEffect(
    function () {
      if (!on) return undefined;
      var hit = function () {
        bump(function (n) {
          return n + 1;
        });
      };
      var onFocus = function () {
        TKCF_load(false);
      };
      window.addEventListener(TKCF_EVENT, hit);
      window.addEventListener("focus", onFocus);
      TKCF_load(false);
      return function () {
        window.removeEventListener(TKCF_EVENT, hit);
        window.removeEventListener("focus", onFocus);
      };
    },
    [on],
  );
  return on ? TKCF__s.ver : 0;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    TKCF_EVENT: TKCF_EVENT,
    TKCF_MAX_FIELDS: TKCF_MAX_FIELDS,
    TKCF_MAX_OPTIONS: TKCF_MAX_OPTIONS,
    TKCF_TYPES: TKCF_TYPES,
    TKCF_CAP_TEXT: TKCF_CAP_TEXT,
    TKCF_typeLabel: TKCF_typeLabel,
    TKCF_nameCheck: TKCF_nameCheck,
    TKCF_normalizeOptions: TKCF_normalizeOptions,
    TKCF_parseOptionsText: TKCF_parseOptionsText,
    TKCF_activeOptions: TKCF_activeOptions,
    TKCF_validateValue: TKCF_validateValue,
    TKCF_isFilled: TKCF_isFilled,
    TKCF_format: TKCF_format,
    TKCF_indexFields: TKCF_indexFields,
    TKCF_indexValues: TKCF_indexValues,
    TKCF_fieldsForTask: TKCF_fieldsForTask,
    TKCF_chips: TKCF_chips,
    TKCF_compare: TKCF_compare,
    TKCF_reorder: TKCF_reorder,
    TKCF_errText: TKCF_errText,
    TKCF_on: TKCF_on,
    TKCF_ready: TKCF_ready,
    TKCF_load: TKCF_load,
    TKCF_loadTask: TKCF_loadTask,
    TKCF_fieldsOf: TKCF_fieldsOf,
    TKCF_listFor: TKCF_listFor,
    TKCF_valuesOf: TKCF_valuesOf,
    TKCF_chipsFor: TKCF_chipsFor,
    TKCF_setValue: TKCF_setValue,
    TKCF_saveField: TKCF_saveField,
    TKCF_archiveField: TKCF_archiveField,
    TKCF_orderFields: TKCF_orderFields,
  };
}
