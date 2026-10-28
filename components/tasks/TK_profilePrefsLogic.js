// ----------------------------------------------------------------------------
// Slate plus profile 2: profile customization, pure logic
// (docs/slateplus-profile2-spec.md §4, §12.3). Rows come from
// tk_profile_card() / tk_staff_profile_prefs. Browser file, shared global
// scope: every name carries a TKP2_ prefix. Node tests:
// components/tasks/TK_profilePrefsLogic.test.js.
//
// The validation rules mirror the tk_staff_profile_prefs_guard trigger, so the
// UI can stop a bad save before the server does; the server stays the rule.
// ----------------------------------------------------------------------------

var TKP2_FIRM_ZONE = "America/Chicago";

// Default order. hideable false = always shown. selfOnly = never rendered for
// anyone else.
var TKP2_SECTIONS = [
  { key: "header", title: "", hideable: false },
  { key: "pins", title: "Pinned", hideable: true },
  { key: "glance", title: "This week at a glance", hideable: false },
  { key: "load", title: "Team load", hideable: false },
  { key: "org", title: "Manager and team", hideable: true },
  { key: "focus", title: "Focus this quarter", hideable: true },
  { key: "tasks", title: "Their tasks", hideable: false },
  { key: "ooo", title: "Out of office", hideable: true },
  { key: "about", title: "About me", hideable: true },
  { key: "favorites", title: "Favorites", hideable: true },
  { key: "covers", title: "Clients they cover", hideable: true },
  { key: "collab", title: "Works most with", hideable: true },
  { key: "recent", title: "Recent work", hideable: true },
  { key: "shoutouts", title: "Shout-outs", hideable: true },
  { key: "defaultview", title: "Default view", hideable: false, selfOnly: true },
];
var TKP2_SECTION_KEYS = TKP2_SECTIONS.map(function (s) {
  return s.key;
});
var TKP2_FIXED = TKP2_SECTIONS.filter(function (s) {
  return !s.hideable;
}).map(function (s) {
  return s.key;
});

var TKP2_SHARE_KEYS = ["status", "about", "focus", "pins", "favorites", "time"];
var TKP2_SHARE_DEFAULTS = { status: true, about: true, focus: false, pins: false, favorites: false, time: true };

var TKP2_LIMITS = {
  status: 140,
  goals: 3,
  goal: 120,
  bio: 600,
  skills: 12,
  skill: 40,
  hours: 120,
  pins: 12,
  favorites: 20,
  label: 80,
  sections: 16,
};

// Same rule as the trigger: ^https://[^\s<>"']{3,500}$ (after trimming).
var TKP2_URL_RE = /^https:\/\/[^\s<>"']{3,500}$/;
var TKP2_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var TKP2_QUARTER_RE = /^[0-9]{4}-Q[1-4]$/;
// Same shape rule as tk__tz_ok (the server also checks pg_timezone_names).
var TKP2_ZONE_RE = /^[A-Za-z]+(\/[A-Za-z0-9_+-]+)+$/;
var TKP2_ZONE_BAD_RE = /^(Etc|posix|right|SystemV)\//;

// Common US zones first in the picker (labels are zone names, never a city).
var TKP2_US_ZONES = [
  { id: "America/New_York", label: "Eastern" },
  { id: "America/Chicago", label: "Central" },
  { id: "America/Denver", label: "Mountain" },
  { id: "America/Phoenix", label: "Arizona" },
  { id: "America/Los_Angeles", label: "Pacific" },
  { id: "America/Anchorage", label: "Alaska" },
  { id: "Pacific/Honolulu", label: "Hawaii" },
];

function TKP2__arr(v) {
  return Array.isArray(v) ? v : [];
}

function TKP2__str(v) {
  if (v == null) return null;
  var s = String(v).trim();
  return s ? s : null;
}

function TKP2_shareOf(share) {
  var src = share && typeof share === "object" && !Array.isArray(share) ? share : {};
  var out = {};
  TKP2_SHARE_KEYS.forEach(function (k) {
    out[k] = typeof src[k] === "boolean" ? src[k] : TKP2_SHARE_DEFAULTS[k];
  });
  return out;
}

// A stored row, a tk_profile_card result, or null -> one clean object. Fields
// another person did not share come back null from the card and stay null
// here (never a default filled in for someone else).
function TKP2_normalize(row) {
  var r = row && typeof row === "object" ? row : {};
  return {
    email: TKP2__str(r.email || r.owner_email) ? String(r.email || r.owner_email).trim().toLowerCase() : null,
    isSelf: r.is_self === true,
    hasRow: r.has_row === true,
    status_line: TKP2__str(r.status_line),
    status_set_at: r.status_set_at || null,
    focus_quarter: TKP2__str(r.focus_quarter),
    focus_goals: r.focus_goals == null ? (row && "focus_goals" in r ? null : []) : TKP2_cleanGoals(r.focus_goals),
    bio: TKP2__str(r.bio),
    skills: r.skills == null ? (row && "skills" in r ? null : []) : TKP2_cleanSkills(r.skills),
    working_hours: TKP2__str(r.working_hours),
    pinned_client_ids: r.pinned_client_ids == null ? (row && "pinned_client_ids" in r ? null : []) : TKP2__arr(r.pinned_client_ids).map(String),
    pinned_project_ids: r.pinned_project_ids == null ? (row && "pinned_project_ids" in r ? null : []) : TKP2__arr(r.pinned_project_ids).map(String),
    favorites: r.favorites == null ? (row && "favorites" in r ? null : []) : TKP2__arr(r.favorites).filter(TKP2_favoriteOk),
    section_order: TKP2_mergeOrder(r.section_order),
    hidden_sections: TKP2_hiddenFilter(r.hidden_sections),
    time_zone: TKP2__str(r.time_zone),
    share: TKP2_shareOf(r.share),
    org: {
      manager: r.org && r.org.manager && r.org.manager.email ? { email: String(r.org.manager.email), name: String(r.org.manager.name || "") } : null,
      reports: TKP2__arr(r.org && r.org.reports).filter(function (p) {
        return p && p.email;
      }),
    },
    teams: TKP2__arr(r.teams).filter(function (x) {
      return x && x.id && x.name;
    }),
    updated_at: r.updated_at || null,
  };
}

// Stored order -> full key list: unknown keys dropped, duplicates dropped,
// header always first, keys added later appended in default order.
function TKP2_mergeOrder(stored) {
  var seen = { header: 1 };
  var out = ["header"];
  TKP2__arr(stored).forEach(function (k) {
    if (TKP2_SECTION_KEYS.indexOf(k) === -1 || seen[k]) return;
    seen[k] = 1;
    out.push(k);
  });
  TKP2_SECTION_KEYS.forEach(function (k) {
    if (!seen[k]) {
      seen[k] = 1;
      out.push(k);
    }
  });
  return out;
}

function TKP2_canHide(key) {
  return TKP2_SECTION_KEYS.indexOf(key) !== -1 && TKP2_FIXED.indexOf(key) === -1;
}

// Hidden list kept to hideable, known, unique keys.
function TKP2_hiddenFilter(list) {
  var seen = {};
  return TKP2__arr(list).filter(function (k) {
    if (!TKP2_canHide(k) || seen[k]) return false;
    seen[k] = 1;
    return true;
  });
}

// Sections to render, in order: hidden ones out (fixed ones never), and the
// self-only ones out for anyone else.
function TKP2_visibleSections(order, hidden, isSelf) {
  var h = TKP2_hiddenFilter(hidden);
  return TKP2_mergeOrder(order).filter(function (k) {
    if (h.indexOf(k) !== -1) return false;
    if (!isSelf && k === "defaultview") return false;
    return true;
  });
}

// Move a key up (-1) or down (+1) in a full order list; header stays first.
function TKP2_move(order, key, delta) {
  var list = TKP2_mergeOrder(order);
  var i = list.indexOf(key);
  var j = i + delta;
  if (i <= 0 || j <= 0 || j >= list.length) return list;
  var tmp = list[i];
  list[i] = list[j];
  list[j] = tmp;
  return list;
}

function TKP2_urlOk(url) {
  return typeof url === "string" && TKP2_URL_RE.test(url.trim());
}

function TKP2_favoriteOk(f) {
  if (!f || typeof f !== "object") return false;
  var label = String(f.label == null ? "" : f.label).trim();
  if (label.length < 1 || label.length > TKP2_LIMITS.label) return false;
  if (f.kind === "sop") return TKP2_UUID_RE.test(String(f.sop_id || "")) && !!String(f.client_id || "").trim();
  if (f.kind === "link") return TKP2_urlOk(f.url);
  return false;
}

function TKP2_cleanGoals(list) {
  return TKP2__arr(list)
    .filter(function (g) {
      return g && typeof g.text === "string" && g.text.trim();
    })
    .map(function (g) {
      return { text: g.text.trim(), done: g.done === true };
    });
}

// Trimmed, empty dropped, de-duplicated ignoring case (first spelling kept).
function TKP2_cleanSkills(list) {
  var seen = {};
  var out = [];
  TKP2__arr(list).forEach(function (s) {
    var v = String(s == null ? "" : s).trim();
    if (!v) return;
    var k = v.toLowerCase();
    if (seen[k]) return;
    seen[k] = 1;
    out.push(v);
  });
  return out;
}

// First problem with a save patch, as a plain sentence, or "" when it is
// fine. Mirrors the trigger (which raises 22023 with the same rules).
function TKP2_validate(patch) {
  var p = patch || {};
  var has = function (k) {
    return Object.prototype.hasOwnProperty.call(p, k);
  };
  if (has("status_line") && p.status_line != null && String(p.status_line).trim().length > TKP2_LIMITS.status) {
    return "A status is at most 140 characters.";
  }
  if (has("focus_quarter") && TKP2__str(p.focus_quarter) && !TKP2_QUARTER_RE.test(String(p.focus_quarter).trim())) {
    return "The quarter looks like 2026-Q4.";
  }
  if (has("focus_goals")) {
    var goals = TKP2__arr(p.focus_goals);
    if (goals.length > TKP2_LIMITS.goals) return "At most 3 focus goals.";
    for (var i = 0; i < goals.length; i++) {
      var g = goals[i];
      var tx = g && typeof g.text === "string" ? g.text.trim() : "";
      if (tx.length < 1 || tx.length > TKP2_LIMITS.goal) return "A goal is 1 to 120 characters.";
    }
  }
  if (has("bio") && p.bio != null && String(p.bio).trim().length > TKP2_LIMITS.bio) return "About me is at most 600 characters.";
  if (has("working_hours") && p.working_hours != null && String(p.working_hours).trim().length > TKP2_LIMITS.hours) {
    return "Working hours are at most 120 characters.";
  }
  if (has("skills")) {
    var sk = TKP2_cleanSkills(p.skills);
    if (sk.some(function (s) { return s.length > TKP2_LIMITS.skill; })) return "A skill is at most 40 characters.";
    if (sk.length > TKP2_LIMITS.skills) return "At most 12 skills.";
  }
  if (has("pinned_client_ids") && TKP2_cleanSkills(p.pinned_client_ids).length > TKP2_LIMITS.pins) return "At most 12 pinned clients.";
  if (has("pinned_project_ids") && TKP2_cleanSkills(p.pinned_project_ids).length > TKP2_LIMITS.pins) return "At most 12 pinned projects.";
  if (has("favorites")) {
    var fav = TKP2__arr(p.favorites);
    if (fav.length > TKP2_LIMITS.favorites) return "At most 20 favorites.";
    for (var j = 0; j < fav.length; j++) {
      var f = fav[j] || {};
      if (f.kind === "link" && !TKP2_urlOk(f.url)) return "Links must start with https://";
      if (!TKP2_favoriteOk(f)) return "Each favorite needs a label (1 to 80 characters) and an SOP or a link.";
    }
  }
  var sectionCheck = function (list, hidden) {
    var l = TKP2__arr(list);
    for (var x = 0; x < l.length; x++) {
      if (TKP2_SECTION_KEYS.indexOf(l[x]) === -1) return "Unknown section " + l[x] + ".";
      if (hidden && !TKP2_canHide(l[x])) return "That section cannot be hidden.";
    }
    return "";
  };
  if (has("section_order")) {
    var e1 = sectionCheck(p.section_order, false);
    if (e1) return e1;
  }
  if (has("hidden_sections")) {
    var e2 = sectionCheck(p.hidden_sections, true);
    if (e2) return e2;
  }
  if (has("time_zone") && TKP2__str(p.time_zone) && !TKP2_zoneOk(String(p.time_zone).trim())) {
    return "Pick a time zone from the list.";
  }
  if (has("share") && p.share != null) {
    if (typeof p.share !== "object" || Array.isArray(p.share)) return "Bad sharing choices.";
    for (var k in p.share) {
      if (TKP2_SHARE_KEYS.indexOf(k) !== -1 && typeof p.share[k] !== "boolean") return "Sharing choices are on or off.";
    }
  }
  return "";
}

// ---- Quarters (America/Chicago) --------------------------------------------

function TKP2__ymdIn(instant, zone) {
  try {
    var d = instant instanceof Date ? instant : new Date(instant == null ? Date.now() : instant);
    if (isNaN(d.getTime())) return null;
    var parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "numeric", day: "numeric" }).formatToParts(d);
    var o = {};
    parts.forEach(function (x) {
      o[x.type] = x.value;
    });
    return { y: Number(o.year), m: Number(o.month), d: Number(o.day) };
  } catch (e) {
    return null;
  }
}

// "2026-Q4" for the firm's calendar (Central time) at that instant.
function TKP2_quarterOf(instant) {
  var p = TKP2__ymdIn(instant, TKP2_FIRM_ZONE);
  if (!p) return null;
  return p.y + "-Q" + (Math.floor((p.m - 1) / 3) + 1);
}

// "2026-Q4" -> "Q4 2026"; anything else -> "".
function TKP2_quarterLabel(q) {
  var s = String(q || "");
  if (!TKP2_QUARTER_RE.test(s)) return "";
  return s.slice(5) + " " + s.slice(0, 4);
}

// True when a stored quarter is set and earlier than the current one.
function TKP2_quarterIsOld(stored, instant) {
  if (!TKP2_QUARTER_RE.test(String(stored || ""))) return false;
  var now = TKP2_quarterOf(instant);
  return !!now && String(stored) < now;
}

// ---- Time zones ------------------------------------------------------------

function TKP2__intlZoneOk(z) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: z }).format(0);
    return true;
  } catch (e) {
    return false;
  }
}

// IANA name rule (same shape rule as the server); abbreviations like CST and
// offsets like +05:00 fail. The browser must also know the zone.
function TKP2_zoneOk(z) {
  if (typeof z !== "string" || !z) return false;
  if (z !== "UTC" && (!TKP2_ZONE_RE.test(z) || TKP2_ZONE_BAD_RE.test(z))) return false;
  return TKP2__intlZoneOk(z);
}

// Picker list: { common: US zones, other: every other valid zone, sorted }.
// supported: optional function returning zone names (default
// Intl.supportedValuesOf("timeZone")); when unavailable, other is [] (the US
// list only).
function TKP2_zoneList(supported) {
  var names = [];
  try {
    if (typeof supported === "function") names = supported() || [];
    else if (typeof Intl !== "undefined" && typeof Intl.supportedValuesOf === "function") names = Intl.supportedValuesOf("timeZone") || [];
  } catch (e) {
    names = [];
  }
  var common = TKP2_US_ZONES.map(function (z) {
    return { id: z.id, label: z.label };
  });
  var skip = {};
  common.forEach(function (z) {
    skip[z.id] = 1;
  });
  var other = [];
  TKP2__arr(names).forEach(function (n) {
    if (typeof n !== "string" || skip[n] || !TKP2_zoneOk(n)) return;
    skip[n] = 1;
    other.push({ id: n, label: TKP2_zoneLabel(n) });
  });
  other.sort(function (a, b) {
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return { common: common, other: other };
}

// "Central" for a common US zone, else the zone name with spaces.
function TKP2_zoneLabel(z) {
  if (!z) return "";
  for (var i = 0; i < TKP2_US_ZONES.length; i++) {
    if (TKP2_US_ZONES[i].id === z) return TKP2_US_ZONES[i].label;
  }
  return String(z).replace(/_/g, " ");
}

// "3:42 PM" at that instant in that zone; null when the zone is missing or
// invalid (never the browser's own zone).
function TKP2_localTime(instant, zone) {
  if (!zone || !TKP2_zoneOk(zone)) return null;
  try {
    var d = instant instanceof Date ? instant : new Date(instant == null ? Date.now() : instant);
    if (isNaN(d.getTime())) return null;
    return new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit", hour12: true }).format(d);
  } catch (e) {
    return null;
  }
}

// "Local time 3:42 PM · Central", or null.
function TKP2_localTimeLine(instant, zone) {
  var t = TKP2_localTime(instant, zone);
  return t ? "Local time " + t + " · " + TKP2_zoneLabel(zone) : null;
}

// Minutes the zone is ahead of UTC at that instant (Chicago in October: -300).
function TKP2_offsetMinutes(instant, zone) {
  if (!zone || !TKP2_zoneOk(zone)) return null;
  try {
    var d = instant instanceof Date ? instant : new Date(instant == null ? Date.now() : instant);
    if (isNaN(d.getTime())) return null;
    var parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    }).formatToParts(d);
    var o = {};
    parts.forEach(function (x) {
      o[x.type] = Number(x.value);
    });
    var asUtc = Date.UTC(o.year, o.month - 1, o.day, o.hour === 24 ? 0 : o.hour, o.minute, o.second);
    var base = Math.floor(d.getTime() / 1000) * 1000;
    return Math.round((asUtc - base) / 60000);
  } catch (e) {
    return null;
  }
}

// True when their zone shows the same clock time as mine right now (mine
// unset = firm time). False when theirs is unset/invalid.
function TKP2_sameAsYou(theirZone, myZone, instant) {
  var a = TKP2_offsetMinutes(instant, theirZone);
  var b = TKP2_offsetMinutes(instant, myZone && TKP2_zoneOk(myZone) ? myZone : TKP2_FIRM_ZONE);
  return a != null && b != null && a === b;
}

function TKP2__span(min) {
  var h = Math.floor(min / 60);
  var m = min % 60;
  var parts = [];
  if (h) parts.push(h + (h === 1 ? " hour" : " hours"));
  if (m) parts.push(m + (m === 1 ? " minute" : " minutes"));
  return parts.join(" ");
}

// "(1 hour behind you)" text without the brackets, or "" when the same, unset
// or invalid.
function TKP2_offsetText(theirZone, myZone, instant) {
  var a = TKP2_offsetMinutes(instant, theirZone);
  var b = TKP2_offsetMinutes(instant, myZone && TKP2_zoneOk(myZone) ? myZone : TKP2_FIRM_ZONE);
  if (a == null || b == null || a === b) return "";
  var diff = a - b;
  return TKP2__span(Math.abs(diff)) + (diff < 0 ? " behind you" : " ahead of you");
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    TKP2_FIRM_ZONE: TKP2_FIRM_ZONE,
    TKP2_SECTIONS: TKP2_SECTIONS,
    TKP2_SECTION_KEYS: TKP2_SECTION_KEYS,
    TKP2_FIXED: TKP2_FIXED,
    TKP2_SHARE_KEYS: TKP2_SHARE_KEYS,
    TKP2_SHARE_DEFAULTS: TKP2_SHARE_DEFAULTS,
    TKP2_LIMITS: TKP2_LIMITS,
    TKP2_URL_RE: TKP2_URL_RE,
    TKP2_US_ZONES: TKP2_US_ZONES,
    TKP2_shareOf: TKP2_shareOf,
    TKP2_normalize: TKP2_normalize,
    TKP2_mergeOrder: TKP2_mergeOrder,
    TKP2_canHide: TKP2_canHide,
    TKP2_hiddenFilter: TKP2_hiddenFilter,
    TKP2_visibleSections: TKP2_visibleSections,
    TKP2_move: TKP2_move,
    TKP2_urlOk: TKP2_urlOk,
    TKP2_favoriteOk: TKP2_favoriteOk,
    TKP2_cleanGoals: TKP2_cleanGoals,
    TKP2_cleanSkills: TKP2_cleanSkills,
    TKP2_validate: TKP2_validate,
    TKP2_quarterOf: TKP2_quarterOf,
    TKP2_quarterLabel: TKP2_quarterLabel,
    TKP2_quarterIsOld: TKP2_quarterIsOld,
    TKP2_zoneOk: TKP2_zoneOk,
    TKP2_zoneList: TKP2_zoneList,
    TKP2_zoneLabel: TKP2_zoneLabel,
    TKP2_localTime: TKP2_localTime,
    TKP2_localTimeLine: TKP2_localTimeLine,
    TKP2_offsetMinutes: TKP2_offsetMinutes,
    TKP2_sameAsYou: TKP2_sameAsYou,
    TKP2_offsetText: TKP2_offsetText,
  };
}
