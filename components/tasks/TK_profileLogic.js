// ----------------------------------------------------------------------------
// TK_profileLogic: pure helpers for the Slate plus person profile
// (TK_Profile.jsx, docs/slateplus-profile-spec.md). No network, no React.
// Every input is something the viewer could already read (RLS-scoped rows,
// the viewer's own client list); these helpers only count and sort it.
// Node tests: components/tasks/TK_profileLogic.test.js.
// ----------------------------------------------------------------------------

function TKP__low(v) {
  return String(v == null ? "" : v).trim().toLowerCase();
}

function TKP__ymdAdd(ymd, days) {
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || ""));
  if (!m) return "";
  var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + days));
  return d.toISOString().slice(0, 10);
}

// The directory row for a profile key, or null. dir: [{ email, name, role }].
// keyOf: TKP_personKey (passed in so this stays pure).
function TKP_findByKey(dir, key, keyOf) {
  if (!key || typeof keyOf !== "function") return null;
  var list = Array.isArray(dir) ? dir : [];
  for (var i = 0; i < list.length; i++) {
    var r = list[i];
    if (r && r.email && keyOf(r.email) === key) return { email: TKP__low(r.email), name: r.name || "", role: r.role || "" };
  }
  return null;
}

// Groups from TK_groupMyTasks -> the profile's sections. Late is a plain group
// (grace period: no score, no red count).
function TKP_sections(g) {
  var x = g || {};
  var arr = function (v) {
    return Array.isArray(v) ? v : [];
  };
  return [
    { key: "late", label: "Late", tasks: arr(x.overdue) },
    { key: "week", label: "This week", tasks: arr(x.today).concat(arr(x.week)) },
    { key: "later", label: "Later", tasks: arr(x.later) },
    { key: "waiting", label: "Waiting on client", tasks: arr(x.waiting) },
  ];
}

// This week at a glance: { open, week, late, waiting }.
function TKP_glance(g) {
  var s = TKP_sections(g);
  var n = function (k) {
    for (var i = 0; i < s.length; i++) if (s[i].key === k) return s[i].tasks.length;
    return 0;
  };
  return { open: n("late") + n("week") + n("later") + n("waiting"), week: n("week"), late: n("late"), waiting: n("waiting") };
}

// Clients they cover, from the VIEWER's client list only (never a wider one).
// Internal and test-only clients are left out. -> [{ id, name, roles: [] }]
function TKP_coveredClients(clients, email) {
  var me = TKP__low(email);
  var out = [];
  if (!me) return out;
  (Array.isArray(clients) ? clients : []).forEach(function (c) {
    if (!c || c.id == null || c.isInternal || c.testOnly) return;
    var roles = [];
    if (c.assignedBookkeeper && TKP__low(c.assignedBookkeeper.email) === me) roles.push("Bookkeeper");
    if (c.accountManager && TKP__low(c.accountManager.email) === me) roles.push("Account manager");
    if (roles.length) out.push({ id: String(c.id), name: c.name || "", roles: roles });
  });
  out.sort(function (a, b) {
    return a.name.localeCompare(b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  });
  return out;
}

// The backup who covers most of their clients. backups: { clientId: email }
// (client_profile rows the viewer could read). -> { email, count, total, unset }
// or null when nothing was readable.
function TKP_backupSummary(backups, clientIds, personEmail) {
  var me = TKP__low(personEmail);
  var ids = Array.isArray(clientIds) ? clientIds : [];
  var b = backups || {};
  var counts = {};
  var unset = 0;
  var seen = 0;
  ids.forEach(function (id) {
    if (!Object.prototype.hasOwnProperty.call(b, String(id))) return;
    seen += 1;
    var e = TKP__low(b[String(id)]);
    if (!e || e === me) unset += 1;
    else counts[e] = (counts[e] || 0) + 1;
  });
  if (!seen) return null;
  var best = "";
  Object.keys(counts).forEach(function (e) {
    if (!best || counts[e] > counts[best] || (counts[e] === counts[best] && e < best)) best = e;
  });
  return { email: best, count: best ? counts[best] : 0, total: seen, unset: unset };
}

// Their current or next time off within `days` (default 30), same window as
// Team › Who's out. -> { row, now } or null.
function TKP_timeOff(rows, email, today, days) {
  var me = TKP__low(email);
  var to = TKP__ymdAdd(today, days == null ? 30 : days);
  var hit = null;
  (Array.isArray(rows) ? rows : []).forEach(function (r) {
    if (!r || r.cancelled_at || TKP__low(r.staff_email) !== me) return;
    if (!(String(r.ends_on) >= today && String(r.starts_on) <= to)) return;
    if (!hit || String(r.starts_on) < String(hit.starts_on)) hit = r;
  });
  return hit ? { row: hit, now: String(hit.starts_on) <= today } : null;
}

// Everyone else on the same tasks (assignee, creator, reviewer), counted once
// per task. tasks: any mix of the profile's reads, duplicates allowed.
// -> [{ email, count }] top `limit` (default 6).
function TKP_collaborators(person, tasks, limit) {
  var me = TKP__low(person);
  var seenTask = {};
  var counts = {};
  (Array.isArray(tasks) ? tasks : []).forEach(function (t) {
    if (!t || t.id == null || t.deleted_at || seenTask[t.id]) return;
    seenTask[t.id] = true;
    var who = {};
    [t.assignee_email, t.staff_email, t.reviewer_email].forEach(function (e) {
      var x = TKP__low(e);
      if (x && x !== me && x.indexOf("@") > 0) who[x] = true;
    });
    // Only tasks the person is actually on count.
    var on = TKP__low(t.assignee_email) === me || TKP__low(t.staff_email) === me || TKP__low(t.reviewer_email) === me || t.__commented === true;
    if (!on) return;
    Object.keys(who).forEach(function (x) {
      counts[x] = (counts[x] || 0) + 1;
    });
  });
  var out = Object.keys(counts).map(function (e) {
    return { email: e, count: counts[e] };
  });
  out.sort(function (a, b) {
    return b.count - a.count || (a.email < b.email ? -1 : a.email > b.email ? 1 : 0);
  });
  return out.slice(0, limit == null ? 6 : limit);
}

function TKP__at(t) {
  var best = "";
  [t.updated_at, t.completed_at, t.created_at, t.__touched_at].forEach(function (v) {
    var s = v ? String(v) : "";
    if (s > best) best = s;
  });
  return best;
}

// Recent clients and projects they touched, newest first. Names come only from
// the viewer's own lookups: an id with no name is dropped (never shown raw).
// opts: { clientName(id) -> "", projectName(id) -> "", limit }
// -> { clients: [{ id, name, at }], projects: [{ id, name, at }] }
function TKP_recent(tasks, opts) {
  var o = opts || {};
  var lim = o.limit == null ? 5 : o.limit;
  var cName = typeof o.clientName === "function" ? o.clientName : function () {
    return "";
  };
  var pName = typeof o.projectName === "function" ? o.projectName : function () {
    return "";
  };
  var cl = {};
  var pr = {};
  (Array.isArray(tasks) ? tasks : []).forEach(function (t) {
    if (!t || t.deleted_at) return;
    var at = TKP__at(t);
    if (t.client_id != null && t.client_id !== "") {
      var cid = String(t.client_id);
      if (!cl[cid] || at > cl[cid]) cl[cid] = at;
    }
    if (t.project_id) {
      var pid = String(t.project_id);
      if (!pr[pid] || at > pr[pid]) pr[pid] = at;
    }
  });
  var pack = function (m, nameOf) {
    var out = [];
    Object.keys(m).forEach(function (id) {
      var n = nameOf(id);
      if (n) out.push({ id: id, name: n, at: m[id] });
    });
    out.sort(function (a, b) {
      return a.at < b.at ? 1 : a.at > b.at ? -1 : a.name.localeCompare(b.name);
    });
    return out.slice(0, lim);
  };
  return { clients: pack(cl, cName), projects: pack(pr, pName) };
}

// Shout-outs they received, newest first, hidden ones left out.
function TKP_shoutoutsFor(rows, email, limit) {
  var me = TKP__low(email);
  var out = (Array.isArray(rows) ? rows : []).filter(function (r) {
    return r && !r.hidden_at && TKP__low(r.to_email) === me;
  });
  out.sort(function (a, b) {
    return String(a.created_at) < String(b.created_at) ? 1 : String(a.created_at) > String(b.created_at) ? -1 : 0;
  });
  return out.slice(0, limit == null ? 5 : limit);
}

// Last seen line from staff_last_seen's answer (admins only).
function TKP_lastSeenAt(d) {
  if (!d || typeof d !== "object") return "";
  var v = d.last_view && d.last_view.occurred_at ? String(d.last_view.occurred_at) : "";
  var a = d.last_action_at ? String(d.last_action_at) : "";
  return v > a ? v : a;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    TKP_findByKey: TKP_findByKey,
    TKP_sections: TKP_sections,
    TKP_glance: TKP_glance,
    TKP_coveredClients: TKP_coveredClients,
    TKP_backupSummary: TKP_backupSummary,
    TKP_timeOff: TKP_timeOff,
    TKP_collaborators: TKP_collaborators,
    TKP_recent: TKP_recent,
    TKP_shoutoutsFor: TKP_shoutoutsFor,
    TKP_lastSeenAt: TKP_lastSeenAt,
  };
}
