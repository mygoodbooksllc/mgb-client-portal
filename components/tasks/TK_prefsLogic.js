// ----------------------------------------------------------------------------
// TK_prefsLogic.js — pure rules for the Slate app's Settings page (per person).
//
// No React, no DOM, no window or localStorage at load. Browser globals (the
// file loads through window.__SOURCE_ORDER) and exported for node tests.
// Stored per person, this browser only, in mgb_tk_prefs_v1:<email>:
//   { quickKeys, density, openIn, showOlder }
// The default view lives in mgb_tk_slate_view_v1:<email> and Show done in
// mgb_tk_view_v1 (both already there); this file only reads and writes them
// through a storage object ({ getItem, setItem, removeItem }) the caller passes.
// ----------------------------------------------------------------------------

var TK_PREFS_KEY = "mgb_tk_prefs_v1";
var TK_PREFS_DENSITIES = ["comfortable", "compact"];
var TK_PREFS_OPEN_IN = ["window", "desk"];

function TK_prefsKey(email) {
  return TK_PREFS_KEY + ":" + String(email == null ? "" : email).trim().toLowerCase();
}

function TK_prefsDefaults() {
  return { quickKeys: true, density: "comfortable", openIn: "window", showOlder: false };
}

// Any value in, a valid prefs object out. Unknown keys are dropped.
function TK_prefsNormalize(raw) {
  var r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  var d = TK_prefsDefaults();
  return {
    quickKeys: r.quickKeys === false ? false : d.quickKeys,
    density: TK_PREFS_DENSITIES.indexOf(r.density) >= 0 ? r.density : d.density,
    openIn: TK_PREFS_OPEN_IN.indexOf(r.openIn) >= 0 ? r.openIn : d.openIn,
    showOlder: r.showOlder === true,
  };
}

// Never throws: blocked storage or bad JSON gives the defaults.
function TK_prefsRead(storage, email) {
  try {
    var raw = storage ? storage.getItem(TK_prefsKey(email)) : null;
    return TK_prefsNormalize(raw == null ? null : JSON.parse(raw));
  } catch (e) {
    return TK_prefsNormalize(null);
  }
}

// Merges patch into the saved prefs and saves. Returns the new prefs (saved or
// not: a blocked storage still returns the merged value for this page view).
function TK_prefsWrite(storage, email, patch) {
  var next = TK_prefsNormalize(Object.assign({}, TK_prefsRead(storage, email), patch || {}));
  try {
    if (storage) storage.setItem(TK_prefsKey(email), JSON.stringify(next));
  } catch (e) {}
  return next;
}

// Show done (mgb_tk_view_v1 { todayGroup, showDone }): on unless saved false.
function TK_prefsShowDoneRead(storage, key) {
  try {
    var v = JSON.parse(storage.getItem(key || "mgb_tk_view_v1") || "null");
    return !(v && typeof v === "object" && v.showDone === false);
  } catch (e) {
    return true;
  }
}

// Writes showDone and keeps the other saved view options (todayGroup).
function TK_prefsShowDoneWrite(storage, on, key) {
  var k = key || "mgb_tk_view_v1";
  var cur = {};
  try {
    var v = JSON.parse(storage.getItem(k) || "null");
    if (v && typeof v === "object" && !Array.isArray(v)) cur = v;
  } catch (e) {}
  cur.showDone = !!on;
  try {
    storage.setItem(k, JSON.stringify(cur));
  } catch (e) {}
  return !!on;
}

// Row density class for the Slate app's list rows ("" for the default).
function TK_prefsDensityClass(prefs) {
  return TK_prefsNormalize(prefs).density === "compact" ? "tk-dens-compact" : "";
}

// Are the list keys (j k x s a q …) off for this person?
function TK_prefsKeysOff(prefs) {
  return TK_prefsNormalize(prefs).quickKeys === false;
}

// The notification switches Slate links to (Settings › Notifications). Every
// entry names the existing user_settings.settings.notify keys; none is new.
// email: notify.email.<key> (Settings.jsx ST_STAFF_EMAIL_PREFS); bell:
// notify.bell.<key> (ST_BELL_PREFS) or "" when that kind has no bell switch.
var TK_PREFS_NOTIFY = [
  { label: "Assigned to me", email: "task_assigned", bell: "tasks" },
  { label: "@mentioned", email: "task_mention", bell: "mentions" },
  { label: "Due today", email: "task_due", bell: "" },
  { label: "Waiting-on-client replies", email: "task_client_answered", bell: "" },
];

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    TK_PREFS_KEY: TK_PREFS_KEY,
    TK_PREFS_DENSITIES: TK_PREFS_DENSITIES,
    TK_PREFS_OPEN_IN: TK_PREFS_OPEN_IN,
    TK_PREFS_NOTIFY: TK_PREFS_NOTIFY,
    TK_prefsKey: TK_prefsKey,
    TK_prefsDefaults: TK_prefsDefaults,
    TK_prefsNormalize: TK_prefsNormalize,
    TK_prefsRead: TK_prefsRead,
    TK_prefsWrite: TK_prefsWrite,
    TK_prefsShowDoneRead: TK_prefsShowDoneRead,
    TK_prefsShowDoneWrite: TK_prefsShowDoneWrite,
    TK_prefsDensityClass: TK_prefsDensityClass,
    TK_prefsKeysOff: TK_prefsKeysOff,
  };
}
