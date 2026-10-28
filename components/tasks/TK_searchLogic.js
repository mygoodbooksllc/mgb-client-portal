// ----------------------------------------------------------------------------
// Slate plus unified search: pure logic (docs/slateplus-profile2-spec.md §2).
// Browser file, shared global scope: every name carries a TKS_ prefix. Node
// tests: components/tasks/TK_searchLogic.test.js.
//
//   TKS_norm(s)              lowercase; every run of chars other than a-z0-9
//                            becomes one space; trimmed (no accent folding).
//   TKS_terms(q)             normalized, de-duplicated terms (max 6, each cut
//                            to 40). A 1-char term is kept only when another
//                            term has 2+ chars, or when it is the only term
//                            (1-char groups such as People). Over 200 chars: [].
//   TKS_wordPrefix(hay, t)   every term starts a word somewhere in hay (a
//                            string or a list of strings). "recon" finds
//                            "Bank Reconcile"; "con" does not.
//   TKS_escapeLike(s)        \ % _ escaped (mirrors tk_search_prefix).
//   TKS_rank(row)            0 title starts with the query, 1 word prefix in
//                            title, 2 client name, 3 notes, 4 comment,
//                            5 substring only (SOP/Help re-rank), 9 no match.
//   TKS_compare(a, b)        rank, then due date (none last), then name.
//   TKS_matchItems(list, q, fieldsOf)  local group: matched + ranked items.
//   TKS_cap(groups, caps)    each group cut to its cap; `more` = hidden count.
//   TKS_flatten(groups)      option rows in keyboard order (headers skipped).
//   TKS_step(i, delta, n)    arrow-key move with wrap; Home/End via ±Infinity.
//   TKS_routeFor(item)       where a row goes (person = 16-hex key, never @).
//   TKS_seq()                stale-response guard for server groups.
// ----------------------------------------------------------------------------

var TKS_MAX_Q = 200;
var TKS_MAX_TERMS = 6;
var TKS_MAX_TERM = 40;

// Group order in the list (the filter row is the top row when shown).
var TKS_GROUP_ORDER = ["filter", "people", "clients", "projects", "tasks", "notes", "sops", "help", "pages", "actions"];
var TKS_CAPS = { filter: 1, people: 5, clients: 5, projects: 5, tasks: 8, notes: 5, sops: 5, help: 5, pages: 4, actions: 3 };
// Fewest characters (of the trimmed query) before a group searches.
var TKS_MIN = { filter: 1, people: 1, clients: 1, projects: 2, tasks: 2, notes: 2, sops: 2, help: 2, pages: 1, actions: 1 };
var TKS_LABELS = {
  filter: "",
  people: "People",
  clients: "Clients",
  projects: "Projects",
  tasks: "Tasks",
  notes: "Notes",
  sops: "SOPs",
  help: "Help",
  pages: "Pages",
  actions: "Actions",
};

var TKS_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function TKS_norm(s) {
  return String(s == null ? "" : s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function TKS_terms(q) {
  var raw = String(q == null ? "" : q);
  if (raw.length > TKS_MAX_Q) return [];
  var n = TKS_norm(raw);
  if (!n) return [];
  var seen = {};
  var out = [];
  n.split(" ").forEach(function (w) {
    if (!w || out.length >= TKS_MAX_TERMS) return;
    var t = w.slice(0, TKS_MAX_TERM);
    if (seen[t]) return;
    seen[t] = 1;
    out.push(t);
  });
  if (out.length < 2) return out;
  var hasLong = out.some(function (t) {
    return t.length >= 2;
  });
  return hasLong ? out : [];
}

// True when term t starts a word of the normalized field.
function TKS__hit(field, t) {
  return (" " + TKS_norm(field)).indexOf(" " + t) !== -1;
}

function TKS_wordPrefix(hay, terms) {
  var list = Array.isArray(terms) ? terms : [];
  if (!list.length) return false;
  var fields = Array.isArray(hay) ? hay : [hay];
  return list.every(function (t) {
    return fields.some(function (f) {
      return f != null && f !== "" && TKS__hit(f, t);
    });
  });
}

function TKS_escapeLike(s) {
  return String(s == null ? "" : s)
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_");
}

var TKS__MATCH_RANK = { title: 1, client: 2, notes: 3, comment: 4 };

// row: { title|name, client, notes, comment, terms } for a local row, or a
// server row carrying `match` (and `task_text`). With terms, the rank comes
// from the fields; without, from `match`.
function TKS_rank(row) {
  if (!row) return 9;
  var title = row.title != null ? row.title : row.name != null ? row.name : row.task_text;
  var terms = Array.isArray(row.terms) ? row.terms : null;
  if (terms && terms.length) {
    var nt = TKS_norm(title);
    var joined = terms.join(" ");
    if (nt && (nt === joined || nt.indexOf(joined) === 0)) return 0;
    if (TKS_wordPrefix([title], terms)) return 1;
    if (row.client && TKS_wordPrefix([title, row.client], terms)) return 2;
    if (TKS_wordPrefix([title, row.client, row.notes], terms)) return 3;
    if (row.comment && TKS_wordPrefix([row.comment], terms)) return 4;
    if (row.allowSubstring) {
      var hay = TKS_norm([title, row.client, row.notes].join(" "));
      var all = terms.every(function (t) {
        return hay.indexOf(t) !== -1;
      });
      if (all) return 5;
    }
    return 9;
  }
  if (row.match && TKS__MATCH_RANK[row.match]) {
    if (row.match === "title" && row.q != null) {
      var j = TKS_terms(row.q).join(" ");
      if (j && TKS_norm(title).indexOf(j) === 0) return 0;
    }
    return TKS__MATCH_RANK[row.match];
  }
  return 9;
}

function TKS_compare(a, b) {
  var ra = a && a.rank != null ? a.rank : 9;
  var rb = b && b.rank != null ? b.rank : 9;
  if (ra !== rb) return ra - rb;
  var da = (a && a.due) || "";
  var db = (b && b.due) || "";
  if (da !== db) {
    if (!da) return 1;
    if (!db) return -1;
    return da < db ? -1 : 1;
  }
  var na = String((a && (a.title || a.name)) || "").toLowerCase();
  var nb = String((b && (b.title || b.name)) || "").toLowerCase();
  return na < nb ? -1 : na > nb ? 1 : 0;
}

// Local group search. fieldsOf(item) -> { title, client?, notes?, due?,
// allowSubstring? }. Returns [{ item, rank, title, due }] sorted, rank < 9.
function TKS_matchItems(list, q, fieldsOf) {
  var terms = Array.isArray(q) ? q : TKS_terms(q);
  if (!terms.length) return [];
  var out = [];
  (Array.isArray(list) ? list : []).forEach(function (it) {
    if (!it) return;
    var f = (fieldsOf ? fieldsOf(it) : it) || {};
    var rank = TKS_rank({
      title: f.title,
      client: f.client,
      notes: f.notes,
      comment: f.comment,
      allowSubstring: f.allowSubstring === true,
      terms: terms,
    });
    if (rank < 9) out.push({ item: it, rank: rank, title: String(f.title || ""), due: f.due || "" });
  });
  out.sort(TKS_compare);
  return out;
}

// groups: [{ key, items, footer? }]. Returns the same groups in TKS_GROUP_ORDER
// (unknown keys after), each cut to caps[key] (default TKS_CAPS), with
// `total` and `more`; empty groups dropped.
function TKS_cap(groups, caps) {
  var c = caps || TKS_CAPS;
  var list = (Array.isArray(groups) ? groups : []).filter(function (g) {
    return g && g.key && Array.isArray(g.items) && g.items.length;
  });
  var pos = function (k) {
    var i = TKS_GROUP_ORDER.indexOf(k);
    return i === -1 ? TKS_GROUP_ORDER.length : i;
  };
  list = list.slice().sort(function (a, b) {
    return pos(a.key) - pos(b.key);
  });
  return list.map(function (g) {
    var cap = c[g.key] != null ? c[g.key] : TKS_CAPS[g.key] != null ? TKS_CAPS[g.key] : 5;
    var shown = g.items.slice(0, cap);
    return Object.assign({}, g, {
      label: g.label != null ? g.label : TKS_LABELS[g.key] || "",
      items: shown,
      total: g.items.length,
      more: Math.max(0, g.items.length - shown.length),
    });
  });
}

// Option rows in keyboard order: [{ id, group, index, item, footer }].
// Headers are never options. A group's footer (e.g. "See all task matches")
// comes after its items.
function TKS_flatten(groups) {
  var out = [];
  (Array.isArray(groups) ? groups : []).forEach(function (g) {
    if (!g) return;
    (g.items || []).forEach(function (it, i) {
      out.push({ id: "tks-opt-" + out.length, group: g.key, index: i, item: it, footer: false });
    });
    if (g.footer) out.push({ id: "tks-opt-" + out.length, group: g.key, index: -1, item: g.footer, footer: true });
  });
  return out;
}

// Next active index. delta: +1 / -1 (wraps), Infinity = End, -Infinity =
// Home. cur -1 (nothing active) + down -> 0; + up -> last.
function TKS_step(cur, delta, n) {
  if (!n || n < 1) return -1;
  if (delta === Infinity) return n - 1;
  if (delta === -Infinity) return 0;
  if (cur == null || cur < 0 || cur >= n) return delta < 0 ? n - 1 : 0;
  return (((cur + delta) % n) + n) % n;
}

function TKS__personKey(email) {
  try {
    if (typeof TKP_personKey === "function") return TKP_personKey(email);
  } catch (e) {}
  try {
    if (typeof require === "function") return require("./TK_personLink.js").TKP_personKey(email);
  } catch (e) {}
  return "";
}

// item.type: person | client | project | task | note | sop | help | page |
// action | filter | seeAll. Returns a plain descriptor the box acts on, or
// null when the row has nothing valid to open:
//   { kind: "person", key, hash }        (TKP_openPerson(email) in the UI)
//   { kind: "client", id, nav }          (tb: TB_go(TB_clientHash(id)))
//   { kind: "project", id, nav }
//   { kind: "task", id }                 (TK_openTask(id))
//   { kind: "sop", clientId }            (TB_go(TB_clientHash(clientId, "sop")))
//   { kind: "help", hash }
//   { kind: "go", go }                   (page / action rows: their go())
//   { kind: "filter", q }                (window event tks:filter-list)
//   { kind: "searchPage", hash, q }
function TKS_routeFor(item) {
  if (!item || !item.type) return null;
  switch (item.type) {
    case "person": {
      var key = TKS__personKey(item.email);
      if (!/^[0-9a-f]{16}$/.test(key)) return null;
      return { kind: "person", key: key, hash: "#/tasks/person/" + key };
    }
    case "client":
      if (!item.id) return null;
      return { kind: "client", id: String(item.id), nav: { view: "client", id: String(item.id) } };
    case "project":
      if (!TKS_UUID_RE.test(String(item.id || ""))) return null;
      return { kind: "project", id: String(item.id), nav: { view: "project", id: String(item.id) } };
    case "task":
    case "note":
      if (!TKS_UUID_RE.test(String(item.id || ""))) return null;
      return { kind: "task", id: String(item.id) };
    case "sop":
      if (!item.clientId) return null;
      return { kind: "sop", clientId: String(item.clientId) };
    case "help":
      if (!item.slug) return null;
      return { kind: "help", hash: "#/help/" + encodeURIComponent(String(item.slug)) };
    case "page":
    case "action":
      return typeof item.go === "function" ? { kind: "go", go: item.go } : null;
    case "filter":
      return { kind: "filter", q: String(item.q || "") };
    case "seeAll":
      return { kind: "searchPage", hash: "#/tasks/search", q: String(item.q || "") };
    default:
      return null;
  }
}

// const s = TKS_seq(); const n = s.next(); ...later: if (!s.current(n)) drop.
function TKS_seq() {
  var last = 0;
  return {
    next: function () {
      last += 1;
      return last;
    },
    current: function (n) {
      return n === last;
    },
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    TKS_norm: TKS_norm,
    TKS_terms: TKS_terms,
    TKS_wordPrefix: TKS_wordPrefix,
    TKS_escapeLike: TKS_escapeLike,
    TKS_rank: TKS_rank,
    TKS_compare: TKS_compare,
    TKS_matchItems: TKS_matchItems,
    TKS_cap: TKS_cap,
    TKS_flatten: TKS_flatten,
    TKS_step: TKS_step,
    TKS_routeFor: TKS_routeFor,
    TKS_seq: TKS_seq,
    TKS_GROUP_ORDER: TKS_GROUP_ORDER,
    TKS_CAPS: TKS_CAPS,
    TKS_MIN: TKS_MIN,
    TKS_LABELS: TKS_LABELS,
  };
}
