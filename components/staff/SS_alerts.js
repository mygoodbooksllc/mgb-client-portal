// ----------------------------------------------------------------------------
// SS_alerts: the pure rules behind the L2 admin alerts in the left sidebar
// (spec-l2-admin-alerts.md). No React, no DOM, no storage, so
// `node components/staff/SS_alerts.test.js` can check all of it.
//
// SS_alertRules turns data the app already reads (qbo_usage_status, open
// ops_alert_state rows, recent client_email_log errors, staff_time_off) into a
// short list of alerts. Nothing here fetches. Browser file; loads right before
// StaffSidebar.jsx. Globals only (OPS_outUntil is used when it exists).
// ----------------------------------------------------------------------------

var SS_ALERT_MAX_ROWS = 5;
var SS_ALERT_QBO_COLLAPSE_OVER = 3; // more than this many clients collapse into one row
var SS_ALERT_EMAIL_WINDOW_MS = 24 * 60 * 60 * 1000;
var SS_ALERT_PRIORITY = { usage: 1, qbo: 2, email: 3, drive: 4, generic: 5, out: 6 };
var SS_ALERT_SEVERITY_RANK = { danger: 0, warning: 1, info: 2 };
var SS_ALERT_KINDS = ["usage", "qbo", "email", "drive", "generic", "out"];

// The exact strings and hover text of the top bar badge (TopBar.jsx,
// TB_ThrottleBadge). Keep the two in step.
var SS_USAGE_TEXT = { stopped: "QuickBooks syncs stopped", throttled: "QuickBooks syncs slowed" };
var SS_USAGE_TITLE = {
  stopped: "This month's QuickBooks API calls are near Intuit's limit, so scheduled syncs are paused until the 1st. Sync now still works.",
  throttled: "This month's QuickBooks API calls are running high, so Pro clients sync less often. Open Team › Hours for details.",
};

var SS_ALERT_SETTINGS_HREF = "#/settings";
var SS_ALERT_QBO_KINDS = ["qbo_reconnect", "sync_errors", "sync_overdue"];
var SS_ALERT_QBO_RANK = { qbo_reconnect: 0, sync_errors: 1, sync_overdue: 2 };
var SS_ALERT_KNOWN_KEYS = [
  "qbo_sync_cron",
  "qbo_usage_stopped",
  "email_failures",
  "drive_upload_failures",
  "drive_not_connected",
];

// "qbo_reconnect:<clientId>" -> { kind: "qbo_reconnect", clientId: "<clientId>" }.
// A key with no colon is all kind. Never throws.
function SS_parseOpsKey(key) {
  var s = key == null ? "" : String(key);
  var i = s.indexOf(":");
  if (i < 0) return { kind: s, clientId: null };
  var id = s.slice(i + 1);
  return { kind: s.slice(0, i), clientId: id ? id : null };
}

function SS__sev(a, b) {
  return SS_ALERT_SEVERITY_RANK[a] <= SS_ALERT_SEVERITY_RANK[b] ? a : b;
}

function SS__clientLookup(clientsById, id) {
  if (!clientsById || id == null) return null;
  var c = clientsById[String(id)];
  return c && typeof c === "object" ? c : null;
}
function SS__isTest(c) {
  return !!c && (c.testOnly === true || c.test_only === true);
}
// excluded: ids of test or internal clients taken from the FULL roster (the
// in-memory clients list hides test clients unless "show test clients" is on).
function SS__isExcluded(excluded, clientsById, id) {
  if (id == null) return false;
  if (excluded && excluded.indexOf(String(id)) >= 0) return true;
  return SS__isTest(SS__clientLookup(clientsById, id));
}
function SS__clientHref(id) {
  return "#/client/" + encodeURIComponent(String(id)) + "/settings/client";
}
function SS__str(v) {
  return typeof v === "string" ? v.trim() : "";
}

function SS__usageAlert(usage, opsRows) {
  var mode = usage && typeof usage === "object" ? usage.mode : typeof usage === "string" ? usage : null;
  var opsStopped = (opsRows || []).some(function (r) {
    return r && r.key === "qbo_usage_stopped";
  });
  if (opsStopped && mode !== "stopped") mode = "stopped"; // stopped wins; one alert, never two
  if (mode !== "stopped" && mode !== "throttled") return null;
  return {
    id: "usage",
    kind: "usage",
    severity: mode === "stopped" ? "danger" : "warning",
    text: SS_USAGE_TEXT[mode],
    detail: SS_USAGE_TITLE[mode],
    href: "#/team/hours",
    count: 1,
  };
}

function SS__qboAlerts(opsRows, clientsById, excluded) {
  var out = [];
  var byClient = {};
  var order = [];
  (opsRows || []).forEach(function (r) {
    if (!r) return;
    var p = SS_parseOpsKey(r.key);
    if (p.kind === "qbo_sync_cron") {
      out.push({
        id: "qbo-cron",
        kind: "qbo",
        severity: "danger",
        text: "QuickBooks auto-sync isn't running",
        detail: SS__str(r.detail) || SS__str(r.title),
        href: SS_ALERT_SETTINGS_HREF,
        count: 1,
      });
      return;
    }
    if (SS_ALERT_QBO_KINDS.indexOf(p.kind) < 0 || !p.clientId) return;
    var c = SS__clientLookup(clientsById, p.clientId);
    if (SS__isExcluded(excluded, clientsById, p.clientId)) return;
    var cur = byClient[p.clientId];
    if (!cur) {
      cur = byClient[p.clientId] = { id: p.clientId, kind: p.kind, title: SS__str(r.title) };
      order.push(p.clientId);
    } else if (SS_ALERT_QBO_RANK[p.kind] < SS_ALERT_QBO_RANK[cur.kind]) {
      cur.kind = p.kind;
      cur.title = SS__str(r.title);
    }
  });
  var haveClients = !!clientsById && Object.keys(clientsById).length > 0;
  var rows = order.map(function (id) {
    var g = byClient[id];
    var c = SS__clientLookup(clientsById, id);
    var sev = g.kind === "sync_overdue" ? "warning" : "danger";
    var name = c && SS__str(c.name);
    var text;
    var known = !!c || !haveClients;
    if (!known) text = "A client needs QuickBooks attention"; // deleted or hidden client: never print a uuid
    else text = g.title || (name ? name + ": reconnect QuickBooks" : "A client needs QuickBooks attention");
    return { id: "qbo:" + id, kind: "qbo", severity: sev, text: text, href: known ? SS__clientHref(id) : SS_ALERT_SETTINGS_HREF, to: known ? { clientId: id, tab: "settings", sub: "client", item: "setup:details.quickbooks" } : null, count: 1 };
  });
  if (rows.length > SS_ALERT_QBO_COLLAPSE_OVER) {
    var sev = "warning";
    rows.forEach(function (r) {
      sev = SS__sev(sev, r.severity);
    });
    out.push({ id: "qbo:many", kind: "qbo", severity: sev, text: "QuickBooks: " + rows.length + " clients need attention", href: SS_ALERT_SETTINGS_HREF, count: rows.length });
  } else {
    out = out.concat(rows);
  }
  return out;
}

function SS__emailAlert(emailErrors, opsRows, clientsById, nowMs, excluded) {
  var ops = null;
  (opsRows || []).forEach(function (r) {
    if (r && r.key === "email_failures") ops = r;
  });
  var from = nowMs - SS_ALERT_EMAIL_WINDOW_MS;
  var n = 0;
  (emailErrors || []).forEach(function (r) {
    if (!r) return;
    if (r.status != null && r.status !== "error") return;
    if (r.trigger === "preview") return;
    var t = Date.parse(r.created_at);
    if (!isFinite(t) || t < from) return;
    if (SS__isExcluded(excluded, clientsById, r.client_id)) return;
    n++;
  });
  if (n === 0 && !ops) return null;
  if (n === 0) {
    // Only the server row is open; it may describe a setup problem, so its title is shown as is.
    return { id: "email", kind: "email", severity: "danger", text: SS__str(ops.title) || "Client emails are failing", detail: SS__str(ops.detail), href: "#/emails", count: 1 };
  }
  return {
    id: "email",
    kind: "email",
    severity: ops ? "danger" : "warning",
    text: n + (n === 1 ? " client email failed" : " client emails failed") + " in the last day",
    detail: ops ? SS__str(ops.detail) : "",
    href: "#/emails",
    count: n,
  };
}

function SS__driveAlerts(opsRows) {
  var out = [];
  (opsRows || []).forEach(function (r) {
    if (!r) return;
    if (r.key === "drive_upload_failures" || r.key === "drive_not_connected") {
      out.push({
        id: "drive:" + r.key,
        kind: "drive",
        severity: r.key === "drive_upload_failures" ? "danger" : "warning",
        text: SS__str(r.title) || (r.key === "drive_upload_failures" ? "Google Drive uploads are failing" : "Google Drive file storage isn't connected"),
        detail: SS__str(r.detail),
        href: SS_ALERT_SETTINGS_HREF,
        count: 1,
      });
    }
  });
  return out;
}

function SS__genericAlerts(opsRows) {
  var out = [];
  (opsRows || []).forEach(function (r) {
    if (!r || r.key == null) return;
    var p = SS_parseOpsKey(r.key);
    if (SS_ALERT_KNOWN_KEYS.indexOf(p.kind) >= 0 || SS_ALERT_QBO_KINDS.indexOf(p.kind) >= 0) return;
    out.push({ id: "generic:" + String(r.key), kind: "generic", severity: "warning", text: SS__str(r.title) || "A problem needs attention", detail: SS__str(r.detail), href: SS_ALERT_SETTINGS_HREF, count: 1 });
  });
  return out;
}

function SS__firstName(directory, email) {
  var e = String(email || "").toLowerCase();
  var name = "";
  (directory || []).forEach(function (d) {
    if (d && String(d.email || "").toLowerCase() === e && SS__str(d.name)) name = SS__str(d.name);
  });
  if (name) return name.split(/\s+/)[0];
  var local = e.split("@")[0];
  return local ? local.charAt(0).toUpperCase() + local.slice(1) : "Someone";
}

function SS__outAlert(timeOff, directory, today) {
  if (!today) return null;
  var emails = [];
  (timeOff || []).forEach(function (r) {
    if (!r || r.cancelled_at) return;
    if (!(r.starts_on <= today && r.ends_on >= today)) return;
    var e = String(r.staff_email || "").toLowerCase();
    if (e && emails.indexOf(e) < 0) emails.push(e);
  });
  if (!emails.length) return null;
  var names = emails.map(function (e) {
    return SS__firstName(directory, e);
  });
  var shown = names.slice(0, 3).join(", ") + (names.length > 3 ? " +" + (names.length - 3) : "");
  var detail = "";
  if (typeof OPS_outUntil === "function") {
    detail = emails
      .map(function (e, i) {
        var until = OPS_outUntil(timeOff, e, today);
        return until ? names[i] + " is out through " + until : "";
      })
      .filter(Boolean)
      .join(". ");
  }
  return { id: "out", kind: "out", severity: "info", text: "Out today: " + shown, detail: detail, href: "#/team/people", count: emails.length };
}

// Everything optional; all null or undefined gives []. now: ms since epoch
// (defaults to the clock). today: the viewer's LOCAL "YYYY-MM-DD".
function SS_alertRules(input) {
  var o = input || {};
  var nowMs = typeof o.now === "number" && isFinite(o.now) ? o.now : o.now instanceof Date ? o.now.getTime() : Date.now();
  var opsRows = Array.isArray(o.opsRows) ? o.opsRows : [];
  var excluded = (Array.isArray(o.excludedIds) ? o.excludedIds : o.excludedIds && typeof o.excludedIds.forEach === "function" ? Array.from(o.excludedIds) : []).map(String);
  var out = [];
  var add = function (a) {
    if (a) out.push(a);
  };
  try {
    add(SS__usageAlert(o.usage, opsRows));
    SS__qboAlerts(opsRows, o.clientsById, excluded).forEach(add);
    add(SS__emailAlert(Array.isArray(o.emailErrors) ? o.emailErrors : [], opsRows, o.clientsById, nowMs, excluded));
    SS__driveAlerts(opsRows).forEach(add);
    SS__genericAlerts(opsRows).forEach(add);
    add(SS__outAlert(Array.isArray(o.timeOff) ? o.timeOff : [], Array.isArray(o.directory) ? o.directory : [], o.today));
  } catch (e) {
    // A bad row never takes the sidebar down; whatever was built stands.
  }
  return out
    .map(function (a, i) {
      return { a: a, i: i };
    })
    .sort(function (x, y) {
      var p = SS_ALERT_PRIORITY[x.a.kind] - SS_ALERT_PRIORITY[y.a.kind];
      if (p) return p;
      var s = SS_ALERT_SEVERITY_RANK[x.a.severity] - SS_ALERT_SEVERITY_RANK[y.a.severity];
      return s || x.i - y.i;
    })
    .map(function (x) {
      return x.a;
    });
}

// The number on the badge: alerts that are not info.
function SS_alertBadgeCount(alerts) {
  return (Array.isArray(alerts) ? alerts : []).filter(function (a) {
    return a && a.severity !== "info";
  }).length;
}

// { shown, more, info }: at most max counted rows, how many are left, and the
// muted info lines (never counted, never capped).
function SS_alertSplit(alerts, max) {
  var cap = typeof max === "number" && max > 0 ? max : SS_ALERT_MAX_ROWS;
  var list = Array.isArray(alerts) ? alerts : [];
  var counted = list.filter(function (a) {
    return a && a.severity !== "info";
  });
  var info = list.filter(function (a) {
    return a && a.severity === "info";
  });
  return { shown: counted.slice(0, cap), more: Math.max(0, counted.length - cap), info: info };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    SS_parseOpsKey: SS_parseOpsKey,
    SS_alertRules: SS_alertRules,
    SS_alertBadgeCount: SS_alertBadgeCount,
    SS_alertSplit: SS_alertSplit,
    SS_USAGE_TEXT: SS_USAGE_TEXT,
    SS_ALERT_KINDS: SS_ALERT_KINDS,
  };
}
