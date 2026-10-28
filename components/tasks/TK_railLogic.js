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

// ---- Hover menus (the portal's HoverNav pattern, components/staff/HoverNav.jsx) ----
// HoverNav opens its flyout the moment the pointer enters an icon (no intent
// delay), keeps it open 200ms after the pointer leaves the icon or the flyout
// (the grace that lets the pointer cross the 6px gap), and closes on Escape.
// Same numbers here.
var TKR_HOVER_OPEN_MS = 0;
var TKR_HOVER_CLOSE_MS = 200;
var TKR_FLY_GAP = 6;
var TKR_FLY_CAP = 500; // every row; the menu scrolls (owner liked scrolling the hover menu)
var TKR_FLY_ROW_H = 34;

// May a hover or focus flyout open for this section right now?
//   o.enabled      HN_on(): the portal's hover-menu switch
//   o.source       "mouse" | "pen" | "key" (touch and anything else: no, a tap keeps today's click behavior)
//   o.section      the rail section
//   o.pinned / o.pinnedSection   the panel is pinned open for that section: the panel is already there
//   o.floatSec     a floating panel is open (click mode): no flyouts until it closes
function TKR_hoverOK(o) {
  if (!o || o.enabled !== true) return false;
  if (o.source !== "mouse" && o.source !== "pen" && o.source !== "key") return false;
  if (!TKR_isSection(o.section)) return false;
  if (o.pinned === true && o.pinnedSection === o.section) return false;
  if (o.floatSec) return false;
  return true;
}

// The pointer type from a pointer event: "mouse" | "pen" | "touch" | "" (unknown).
function TKR_pointerSource(type) {
  return type === "mouse" || type === "pen" ? type : type === "touch" ? "touch" : "";
}

// What the flyout shows for one section, from the same rows the click panel
// shows. d: { isAdmin, isRoleAdmin, myRoute, myName, people, personRoute(s),
// pinnedProjects, projects, projectRoute(p), pinnedClients, clients,
// clientRoute(c), noTeam, clientTotal, current(route) }. Returns
// { title, groups: [{ key, title, items: [{ key, label, tag, dot, route,
// action, current }] }] }. An item has a route (a real link) or an action
// ("newProject" | "panel"). Long lists stop at cap rows and end with an
// "All ...". / "Find a client..." action that opens the full panel.
function TKR_flyModel(section, d, cap) {
  var n = typeof cap === "number" && cap > 0 ? cap : TKR_FLY_CAP;
  d = d || {};
  var cur = typeof d.current === "function" ? d.current : function () { return false; };
  var arr = function (v) { return Array.isArray(v) ? v : []; };
  var groups = [];
  var add = function (key, title, items) {
    if (items.length) groups.push({ key: key, title: title || "", items: items });
  };
  var link = function (key, label, route, extra) {
    var it = { key: key, label: label, route: route, current: !!cur(route) };
    if (extra) for (var k in extra) it[k] = extra[k];
    return it;
  };
  var title = "";
  if (section === "people") {
    title = "People";
    var me = [];
    if (d.myRoute) me.push(link("me", "My profile", d.myRoute));
    add("me", "", me);
    if (d.isAdmin) {
      var people = arr(d.people);
      var pi = [];
      people.slice(0, n).forEach(function (s, i) {
        var r = typeof d.personRoute === "function" ? d.personRoute(s) : null;
        if (r) pi.push(link("p" + (s.id != null ? s.id : i), s.name || "Staff member", r));
      });
      if (people.length > n) pi.push({ key: "more", label: "All people...", action: "panel", tag: String(people.length) });
      add("everyone", "Everyone", pi);
    }
  } else if (section === "projects") {
    title = "Projects";
    var pr = function (prefix, p) {
      var r = typeof d.projectRoute === "function" ? d.projectRoute(p) : null;
      return r ? link(prefix + p.id, p.name || "Project", r, { dot: p.color || null, tag: typeof TKP_projectTag === "function" ? TKP_projectTag(p, true) : p.kind === "onboarding" ? "Onboarding" : null }) : null;
    };
    add("pinned", "Pinned", arr(d.pinnedProjects).map(function (p) { return pr("pin-", p); }).filter(Boolean));
    var projects = arr(d.projects);
    var ai = projects.slice(0, n).map(function (p) { return pr("", p); }).filter(Boolean);
    if (projects.length > n) ai.push({ key: "more", label: "All projects...", action: "panel", tag: String(projects.length) });
    add("all", "All projects", ai);
    var ex = [{ key: "new", label: "New project", action: "newProject" }];
    if (d.isRoleAdmin) ex.push(link("manage", "Manage projects", { view: "manage" }));
    add("actions", "", ex);
  } else if (section === "clients") {
    title = "Clients";
    var cl = function (prefix, c) {
      var r = typeof d.clientRoute === "function" ? d.clientRoute(c) : null;
      return r ? link(prefix + c.id, c.name || String(c.id), r, { tag: c.tag || null }) : null;
    };
    if (d.isAdmin) {
      add(
        "noteam",
        "No team yet",
        arr(d.noTeam)
          .map(function (c) {
            var r = { view: "client", clientId: String(c.client_id) };
            var k = Number(c.open_tasks) || 0;
            return link("nt-" + c.client_id, c.client_name || String(c.client_id), r, { tag: k + (k === 1 ? " task" : " tasks") });
          })
          .filter(Boolean),
      );
    }
    add("pinned", "Pinned", arr(d.pinnedClients).map(function (c) { return cl("pin-", c); }).filter(Boolean));
    var clients = arr(d.clients);
    var ci = clients.slice(0, n).map(function (c) { return cl("", c); }).filter(Boolean);
    var total = typeof d.clientTotal === "number" ? d.clientTotal : clients.length;
    if (total > 8) ci.push({ key: "find", label: "Find a client...", action: "panel", tag: String(total) });
    add("all", "All clients", ci);
  }
  // A lone "All projects" / "All clients" heading only repeats the flyout's own title.
  var titled = groups.filter(function (g) { return g.title; });
  if (titled.length === 1 && titled[0].key === "all") titled[0].title = "";
  return { title: title, groups: groups };
}

// All items of a model, in display order (the arrow-key order).
function TKR_flyItems(model) {
  var out = [];
  ((model && model.groups) || []).forEach(function (g) {
    g.items.forEach(function (it) {
      out.push(it);
    });
  });
  return out;
}

// Like HoverNav, a flyout needs at least two items (one item is only a label).
function TKR_flyOpens(model) {
  return TKR_flyItems(model).length >= 2;
}

// Where the flyout sits (position: fixed): just right of the rail, top level
// with the icon, pulled up so it fits the window (HoverNav's clamp, with
// groups counted). rowH/headH estimate the height before it is measured.
function TKR_flyPos(railRight, triggerTop, model, viewH) {
  var items = TKR_flyItems(model).length;
  var groups = ((model && model.groups) || []).filter(function (g) { return g.title; }).length;
  var est = 44 + items * TKR_FLY_ROW_H + groups * 26;
  var vh = Number(viewH) || 0;
  var h = Math.min(est, Math.max(0, vh - 16));
  var top = Math.max(8, Math.min(Number(triggerTop) || 0, vh - h - 8));
  return { left: Math.round((Number(railRight) || 0) + TKR_FLY_GAP), top: Math.round(top) };
}

// Keys on a rail section button while its flyout is open: "enter" (ArrowRight
// moves into the menu), "close" (Escape), or "" (the rail handles the rest).
function TKR_triggerKey(key, isOpen) {
  if (!isOpen) return "";
  if (key === "ArrowRight") return "enter";
  if (key === "Escape") return "close";
  return "";
}

// Keys inside the flyout: { move: next index or -1, close: bool }. Left arrow and
// Escape close and hand focus back to the icon. Space picks the item, like
// Enter ({ activate: true }), instead of scrolling the page (which closes it).
function TKR_flyKey(key, i, n) {
  if (key === "Escape" || key === "ArrowLeft") return { move: -1, close: true };
  if (key === " " || key === "Spacebar") return { move: -1, close: false, activate: true };
  return { move: TKR_nextIndex(i, n, key), close: false };
}

// The flyout's top once its real height h is measured: level with the icon
// when it fits, pulled up so its bottom stays 8px inside the window, never
// above 8px (TKR_flyPos only estimates the height before it renders).
function TKR_flyClampTop(top, h, viewH) {
  var t = Number(top) || 0;
  var hh = Math.max(0, Number(h) || 0);
  var vh = Number(viewH) || 0;
  return Math.round(Math.max(8, Math.min(t, vh - hh - 8)));
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
    TKR_HOVER_OPEN_MS: TKR_HOVER_OPEN_MS,
    TKR_HOVER_CLOSE_MS: TKR_HOVER_CLOSE_MS,
    TKR_FLY_GAP: TKR_FLY_GAP,
    TKR_FLY_CAP: TKR_FLY_CAP,
    TKR_hoverOK: TKR_hoverOK,
    TKR_pointerSource: TKR_pointerSource,
    TKR_flyModel: TKR_flyModel,
    TKR_flyItems: TKR_flyItems,
    TKR_flyOpens: TKR_flyOpens,
    TKR_flyPos: TKR_flyPos,
    TKR_triggerKey: TKR_triggerKey,
    TKR_flyKey: TKR_flyKey,
    TKR_flyClampTop: TKR_flyClampTop,
  };
}
