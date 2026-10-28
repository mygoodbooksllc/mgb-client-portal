// ----------------------------------------------------------------------------
// TK_railLogic: pure rules for the Slate plus icon sidebar (hidden preview,
// docs/slateplus-sidebar-spec.md). The view is TK_SlateRail.jsx. Browser file,
// shared global scope: every name carries a TKR_ prefix. Node tests:
// components/tasks/TK_railLogic.test.js.
// ----------------------------------------------------------------------------

var TKR_SECTIONS = ["people", "projects", "clients"];
var TKR_PREFS_PREFIX = "mgb_tkrail_v1:";
var TKR_W_RAIL = 64;
var TKR_W_GAP = 8;
var TKR_W_PANEL = 248;

// The panel section a route belongs to (its rail button shows active), or null.
function TKR_sectionOf(route) {
  var v = route && route.view;
  if (v === "profile" || v === "person") return "people";
  if (v === "project" || v === "manage") return "projects";
  if (v === "client") return "clients";
  return null;
}

// The rail item a route lights up: my | review | waiting | templates | search,
// or a section name. Unknown views light nothing.
function TKR_activeItem(route) {
  var v = route && route.view;
  if (v === "my" || v === "review" || v === "waiting" || v === "templates" || v === "search") return v;
  return TKR_sectionOf(route);
}

function TKR_isSection(s) {
  return TKR_SECTIONS.indexOf(s) >= 0;
}

// Stored prefs -> { pinned, section }. Junk, wrong types or a bad section fall
// back to unpinned with no section.
function TKR_parsePrefs(raw) {
  var out = { pinned: false, section: null };
  if (raw == null || raw === "") return out;
  var v = raw;
  if (typeof raw === "string") {
    try {
      v = JSON.parse(raw);
    } catch (e) {
      return out;
    }
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return out;
  out.pinned = v.pinned === true;
  out.section = TKR_isSection(v.section) ? v.section : null;
  if (out.pinned && !out.section) out.section = "clients";
  return out;
}

function TKR_serializePrefs(p) {
  var c = TKR_parsePrefs(p || {});
  return JSON.stringify({ pinned: c.pinned, section: c.section });
}

// The localStorage key for one person: the opaque person key (keyFn, normally
// TKP_personKey), never the email. "" when there is no email or no key.
function TKR_prefsKey(email, keyFn) {
  var e = String(email == null ? "" : email).trim().toLowerCase();
  if (!e || typeof keyFn !== "function") return "";
  var k = keyFn(e);
  return typeof k === "string" && /^[0-9a-f]{16}$/.test(k) ? TKR_PREFS_PREFIX + k : "";
}

// Pinned rows in the pin order, only those present in rows (what the viewer
// can see), each id once, at most max (default 12).
function TKR_pinnedRows(ids, rows, max) {
  var cap = typeof max === "number" && max > 0 ? max : 12;
  var byId = {};
  (Array.isArray(rows) ? rows : []).forEach(function (r) {
    if (r && r.id != null) byId[String(r.id)] = r;
  });
  var seen = {};
  var out = [];
  (Array.isArray(ids) ? ids : []).forEach(function (id) {
    var k = id == null ? "" : String(id);
    if (!k || seen[k] || !byId[k] || out.length >= cap) return;
    seen[k] = true;
    out.push(byId[k]);
  });
  return out;
}

// Badge text: "" for none, "99+" above 99.
function TKR_badgeText(n) {
  var x = Number(n) || 0;
  if (x <= 0) return "";
  return x > 99 ? "99+" : String(Math.floor(x));
}

// The rail item's accessible name: "Review, 3 waiting" (noun: "open" for
// Waiting on client, so it never says waiting twice).
function TKR_itemLabel(label, count, noun) {
  var t = TKR_badgeText(count);
  return t ? label + ", " + t + " " + (noun || "waiting") : label;
}

// Arrow keys between rail items: the next index, or -1 to ignore the key.
function TKR_nextIndex(i, n, key) {
  if (!(n > 0)) return -1;
  var cur = typeof i === "number" && i >= 0 && i < n ? i : -1;
  if (key === "ArrowDown") return cur < 0 ? 0 : (cur + 1) % n;
  if (key === "ArrowUp") return cur < 0 ? n - 1 : (cur - 1 + n) % n;
  if (key === "Home") return 0;
  if (key === "End") return n - 1;
  return -1;
}

// The width the list makes room for (--tkr-w in tk-views.css): the rail,
// plus the gap and panel while pinned (a floating panel overlaps the list).
function TKR_width(pinned, section) {
  return pinned && TKR_isSection(section) ? TKR_W_RAIL + TKR_W_GAP + TKR_W_PANEL : TKR_W_RAIL;
}

// Clients for the panel: name filter, then name order, then the caller's
// CF_sort (test and internal last), the same order as the old sidebar.
function TKR_filterClients(clients, filter, sortFn) {
  var f = String(filter || "").trim().toLowerCase();
  var out = (Array.isArray(clients) ? clients : [])
    .filter(function (c) {
      return c && c.id != null && (!f || String(c.name || c.id).toLowerCase().indexOf(f) >= 0);
    })
    .slice()
    .sort(function (a, b) {
      var x = String(a.name || a.id).toLowerCase();
      var y = String(b.name || b.id).toLowerCase();
      return x < y ? -1 : x > y ? 1 : 0;
    });
  return typeof sortFn === "function" ? sortFn(out) : out;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    TKR_SECTIONS: TKR_SECTIONS,
    TKR_PREFS_PREFIX: TKR_PREFS_PREFIX,
    TKR_W_RAIL: TKR_W_RAIL,
    TKR_W_GAP: TKR_W_GAP,
    TKR_W_PANEL: TKR_W_PANEL,
    TKR_sectionOf: TKR_sectionOf,
    TKR_activeItem: TKR_activeItem,
    TKR_isSection: TKR_isSection,
    TKR_parsePrefs: TKR_parsePrefs,
    TKR_serializePrefs: TKR_serializePrefs,
    TKR_prefsKey: TKR_prefsKey,
    TKR_pinnedRows: TKR_pinnedRows,
    TKR_badgeText: TKR_badgeText,
    TKR_itemLabel: TKR_itemLabel,
    TKR_nextIndex: TKR_nextIndex,
    TKR_width: TKR_width,
    TKR_filterClients: TKR_filterClients,
  };
}
