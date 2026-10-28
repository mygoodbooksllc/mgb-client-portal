// ----------------------------------------------------------------------------
// WB_layout: the pure rules behind the L1 left sidebar (spec-l1-sidebar.md).
// No React, no DOM, no storage, so `node components/workbench/WB_layout.test.js`
// can check all of it.
//
// A layout "profile" for one bar is { order, on, detail, width }, always
// complete and valid. It is resolved per field: the person's own choice, then
// the role default (tk_settings.layout_defaults), then the built-in. Saving
// only the differences from the role default (WB_layoutDiff) means a later
// change to the role default still reaches people who never touched that field.
//
// Only the "left" bar is wired in L1. The "rail" and "bar" ids are known to the
// engine and wait for R4.
//
// Also here, pure: the gate (SS_navIsOn) and the recents filter
// (SS_filterRecents). Browser file; loads after WB_store.js. Globals only.
// ----------------------------------------------------------------------------

var WB_LAYOUT_SCHEMA = 1;
var WB_LAYOUT_MAX_BYTES = 8192; // 8 KB cap on anything parsed or saved
var WB_LAYOUT_WIDTH_MIN = 220;
var WB_LAYOUT_WIDTH_MAX = 320;
var WB_LAYOUT_WIDTH_NARROW_MAX = 260; // cap below a 1100px window
var WB_LAYOUT_NARROW_VIEWPORT = 1100;
var WB_LAYOUT_RECENT_MAX = 5;
var WB_LAYOUT_DETAILS = ["off", "compact", "full"];
var WB_LAYOUT_ROLES = ["admin", "am", "bookkeeper", "tempAdmin"];
var WB_LAYOUT_BARS = ["left", "rail", "bar"];

// Built-in item ids by bar (in the built-in order). rail and bar are listed
// but unused in L1.
var WB_LAYOUT_ITEMS = {
  left: ["places", "pinned", "recent", "alerts"],
  rail: ["tabs", "actions"],
  bar: ["info", "actions"],
};
// Items that cannot be switched off.
var WB_LAYOUT_LOCKED = { left: ["places"], rail: [], bar: [] };

function WB__lHas(o, k) {
  return !!o && typeof o === "object" && Object.prototype.hasOwnProperty.call(o, k);
}
function WB__lIsObj(o) {
  return !!o && typeof o === "object" && !Array.isArray(o);
}
function WB__lBar(bar) {
  return WB_LAYOUT_BARS.indexOf(bar) >= 0 ? bar : "left";
}

// Built-in default for a bar: { order, on, detail, width }.
function WB_layoutBuiltin(bar) {
  var b = WB__lBar(bar);
  var ids = WB_LAYOUT_ITEMS[b];
  var on = {};
  var detail = {};
  ids.forEach(function (id) {
    on[id] = true;
    detail[id] = id === "recent" ? "compact" : "full";
  });
  return { order: ids.slice(), on: on, detail: detail, width: WB_LAYOUT_WIDTH_MIN };
}

// Width clamped to 220-320; anything that is not a finite number is null.
function WB__lWidth(w) {
  if (typeof w !== "number" || !isFinite(w)) return null;
  return Math.max(WB_LAYOUT_WIDTH_MIN, Math.min(WB_LAYOUT_WIDTH_MAX, Math.round(w)));
}
// The width actually used in a window `viewport` px wide (cap 260 below 1100).
function WB_layoutWidthFor(width, viewport) {
  var w = WB__lWidth(width);
  if (w == null) w = WB_LAYOUT_WIDTH_MIN;
  var v = Number(viewport);
  if (isFinite(v) && v > 0 && v < WB_LAYOUT_NARROW_VIEWPORT) w = Math.min(w, WB_LAYOUT_WIDTH_NARROW_MAX);
  return w;
}

// One bar's partial settings, sanitized. Unknown or retired ids are dropped,
// duplicates removed, bad values ignored. Returns an object with only the
// fields that were valid (possibly empty).
function WB__lPartial(bar, raw) {
  var out = {};
  if (!WB__lIsObj(raw)) return out;
  var ids = WB_LAYOUT_ITEMS[bar];
  if (Array.isArray(raw.order)) {
    var seen = [];
    raw.order.forEach(function (id) {
      if (typeof id === "string" && ids.indexOf(id) >= 0 && seen.indexOf(id) < 0) seen.push(id);
    });
    if (seen.length) out.order = seen;
  }
  if (WB__lIsObj(raw.on)) {
    var on = {};
    var nOn = 0;
    ids.forEach(function (id) {
      if (WB__lHas(raw.on, id) && typeof raw.on[id] === "boolean") {
        on[id] = raw.on[id];
        nOn++;
      }
    });
    if (nOn) out.on = on;
  }
  if (WB__lIsObj(raw.detail)) {
    var det = {};
    var nDet = 0;
    ids.forEach(function (id) {
      if (WB__lHas(raw.detail, id) && WB_LAYOUT_DETAILS.indexOf(raw.detail[id]) >= 0) {
        det[id] = raw.detail[id];
        nDet++;
      }
    });
    if (nDet) out.detail = det;
  }
  var w = WB__lWidth(raw.width);
  if (w != null) out.width = w;
  return out;
}

// Saved text (or an already-parsed value, such as a jsonb column) in, a clean
// object out: { v:1, left?, rail?, bar? } for a person's prefs, or
// { v:1, roles:{ admin:{left:{...}}, ... } } for role defaults (both keys can
// be present). Never throws. Returns null for a wrong schema version, a value
// that is not an object, or anything over 8 KB.
function WB_layoutParse(raw) {
  var text = null;
  var obj = raw;
  try {
    if (typeof raw === "string") {
      if (raw.length > WB_LAYOUT_MAX_BYTES) return null;
      obj = JSON.parse(raw);
    } else {
      text = JSON.stringify(raw);
      if (typeof text !== "string" || text.length > WB_LAYOUT_MAX_BYTES) return null;
    }
  } catch (e) {
    return null;
  }
  if (!WB__lIsObj(obj) || obj.v !== WB_LAYOUT_SCHEMA) return null;
  var out = { v: WB_LAYOUT_SCHEMA };
  WB_LAYOUT_BARS.forEach(function (bar) {
    if (WB__lHas(obj, bar)) {
      var p = WB__lPartial(bar, obj[bar]);
      if (Object.keys(p).length) out[bar] = p;
    }
  });
  if (WB__lHas(obj, "roles") && WB__lIsObj(obj.roles)) {
    var roles = {};
    WB_LAYOUT_ROLES.forEach(function (rk) {
      if (!WB__lHas(obj.roles, rk) || !WB__lIsObj(obj.roles[rk])) return;
      var one = {};
      WB_LAYOUT_BARS.forEach(function (bar) {
        if (WB__lHas(obj.roles[rk], bar)) {
          var p = WB__lPartial(bar, obj.roles[rk][bar]);
          if (Object.keys(p).length) one[bar] = p;
        }
      });
      if (Object.keys(one).length) roles[rk] = one;
    });
    if (Object.keys(roles).length) out.roles = roles;
  }
  return out;
}

// Which role default a person gets. Precedence: admin > tempAdmin > am >
// bookkeeper. role is the staff table role of the person on screen.
function WB_layoutRoleKey(info) {
  var i = info || {};
  if (i.role === "admin" || i.isAdmin === true) return "admin";
  if (i.hasTempAdminAccess === true) return "tempAdmin";
  if (Number(i.amCount) > 0) return "am";
  return "bookkeeper";
}

// The complete, valid profile for one bar. roleDefaults and personPrefs are
// raw or parsed layout JSON (either may be null).
function WB_layoutProfile(opts) {
  var o = opts || {};
  var bar = WB__lBar(o.bar);
  var base = WB_layoutBuiltin(bar);
  var rd = o.roleDefaults == null ? null : WB_layoutParse(o.roleDefaults);
  var pp = o.personPrefs == null ? null : WB_layoutParse(o.personPrefs);
  var roleLayer =
    rd && rd.roles && WB_LAYOUT_ROLES.indexOf(o.roleKey) >= 0 && rd.roles[o.roleKey] ? rd.roles[o.roleKey][bar] || null : null;
  var personLayer = pp && pp[bar] ? pp[bar] : null;
  var layers = [roleLayer, personLayer]; // later wins, per field
  var order = base.order.slice();
  // L2: admins' Alerts section sits right after the places by default.
  if (bar === "left" && o.roleKey === "admin") order = ["places", "alerts", "pinned", "recent"];
  var on = Object.assign({}, base.on);
  var detail = Object.assign({}, base.detail);
  var width = base.width;
  layers.forEach(function (l) {
    if (!l) return;
    if (l.order) order = l.order.slice();
    if (l.on) Object.keys(l.on).forEach(function (k) { on[k] = l.on[k]; });
    if (l.detail) Object.keys(l.detail).forEach(function (k) { detail[k] = l.detail[k]; });
    if (l.width != null) width = l.width;
  });
  // Missing ids are appended in built-in order. Locked items stay first and on.
  WB_LAYOUT_ITEMS[bar].forEach(function (id) {
    if (order.indexOf(id) < 0) order.push(id);
  });
  var locked = WB_LAYOUT_LOCKED[bar];
  locked.forEach(function (id) {
    on[id] = true;
  });
  order = locked.filter(function (id) { return order.indexOf(id) >= 0; }).concat(
    order.filter(function (id) { return locked.indexOf(id) < 0; }),
  );
  return { order: order, on: on, detail: detail, width: width };
}

function WB__lSameArr(a, b) {
  return a.length === b.length && a.every(function (v, i) { return v === b[i]; });
}

// The smallest person prefs for one bar that turn `base` into `profile`
// (both complete profiles). {} when nothing differs.
function WB_layoutDiff(profile, base) {
  var p = profile || {};
  var b = base || {};
  var out = {};
  if (Array.isArray(p.order) && Array.isArray(b.order) && !WB__lSameArr(p.order, b.order)) out.order = p.order.slice();
  ["on", "detail"].forEach(function (f) {
    var pv = p[f] || {};
    var bv = b[f] || {};
    var d = {};
    var n = 0;
    Object.keys(pv).forEach(function (k) {
      if (pv[k] !== bv[k]) {
        d[k] = pv[k];
        n++;
      }
    });
    if (n) out[f] = d;
  });
  if (p.width != null && p.width !== b.width) out.width = p.width;
  return out;
}

// ---- Gate (pure) ----
// Same value rules as WB_flagValueOn (WB_logic.js): true, "true", 1 or {on:true}.
function SS__flagValueOn(v) {
  if (typeof WB_flagValueOn === "function") return WB_flagValueOn(v);
  return v === true || v === "true" || v === 1 || (!!v && typeof v === "object" && v.on === true);
}
// The firm switch tk_settings.nav_enabled. (The per-person preview checkbox was
// retired 2026-10-25 and the Classic sidebar opt-out 2026-10-28, once the switch
// was on for everyone.)
function SS_navIsOn(settingValue) {
  return SS__flagValueOn(settingValue);
}

// ---- Recents (pure) ----
// Recent client ids (newest first) minus anything pinned and the client being
// viewed now, de-duplicated, at most `cap` (default 5), order kept.
function SS_filterRecents(recents, pins, currentId, cap) {
  var max = cap == null ? WB_LAYOUT_RECENT_MAX : Math.max(0, Math.floor(Number(cap)) || 0);
  var pinned = Array.isArray(pins) ? pins.map(String) : [];
  var cur = currentId == null || currentId === "" ? null : String(currentId);
  var out = [];
  (Array.isArray(recents) ? recents : []).forEach(function (r) {
    var id = typeof r === "number" && isFinite(r) ? String(r) : r;
    if (typeof id !== "string" || !id) return;
    if (pinned.indexOf(id) >= 0 || id === cur || out.indexOf(id) >= 0) return;
    if (out.length < max) out.push(id);
  });
  return out;
}

// Two letters for a client chip: "Acme Roofing" -> "AR", "Acme" -> "AC".
function SS_initials(name) {
  var words = String(name == null ? "" : name)
    .replace(/[^A-Za-z0-9 ]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    WB_LAYOUT_SCHEMA: WB_LAYOUT_SCHEMA,
    WB_LAYOUT_MAX_BYTES: WB_LAYOUT_MAX_BYTES,
    WB_LAYOUT_WIDTH_MIN: WB_LAYOUT_WIDTH_MIN,
    WB_LAYOUT_WIDTH_MAX: WB_LAYOUT_WIDTH_MAX,
    WB_LAYOUT_WIDTH_NARROW_MAX: WB_LAYOUT_WIDTH_NARROW_MAX,
    WB_LAYOUT_ITEMS: WB_LAYOUT_ITEMS,
    WB_LAYOUT_ROLES: WB_LAYOUT_ROLES,
    WB_layoutBuiltin: WB_layoutBuiltin,
    WB_layoutParse: WB_layoutParse,
    WB_layoutRoleKey: WB_layoutRoleKey,
    WB_layoutProfile: WB_layoutProfile,
    WB_layoutDiff: WB_layoutDiff,
    WB_layoutWidthFor: WB_layoutWidthFor,
    SS_navIsOn: SS_navIsOn,
    SS_filterRecents: SS_filterRecents,
    SS_initials: SS_initials,
  };
}
