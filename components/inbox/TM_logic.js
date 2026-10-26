// ----------------------------------------------------------------------------
// TM_logic: pure rules for the client message thread menu
// (docs/thread-menu-spec.md sections 4-5). No React, no network, no DOM.
//
// A thread = (client_id, participant_email). Its staff-only state lives in
// public.client_thread_state (one row per thread, written only through the
// thread_* RPCs). Everything here works on that row plus the thread summary
// StaffInbox already builds (an "entry").
//
// Wake rule (spec 4): Hide, Done and Snooze all end when the client writes
// again (a client message newer than the stamp), worked out here in the
// browser; nothing in the database changes when it wakes.
//
// Browser file (plain JS); loads before StaffInbox.jsx. WB_snoozeUntil,
// WB_today and WB_addDays (components/workbench/WB_logic.js) are used at call
// time only. Node tests: components/inbox/TM_logic.test.js.
// ----------------------------------------------------------------------------

var TM_COLS =
  "client_id, participant_email, label, hidden_at, hidden_by, done_at, done_by, done_marker_id, " +
  "snoozed_until, snoozed_at, snoozed_by, pinned_at, pinned_by, assignee_email, updated_at, updated_by";
var TM_LABEL_MAX = 80;
var TM_TASK_MAX = 140;
var TM_TICK_MS = 60000;
var TM_TZ = "America/Chicago";
var TM_FILTERS = ["done", "snoozed", "hidden"];

function TM__ms(ts) {
  if (ts == null || ts === "") return NaN;
  var ms = typeof ts === "number" ? ts : Date.parse(ts);
  return isNaN(ms) ? NaN : ms;
}
function TM__lower(s) {
  return String(s == null ? "" : s).trim().toLowerCase();
}

// The two extra fields an entry gets while the gate is on, from the rows
// loadRecent already has (newest first): the newest public client message
// time, and the newest message id (for links and tasks).
function TM_entryExtras(newestFirst) {
  var rows = Array.isArray(newestFirst) ? newestFirst : [];
  var lastClient = null;
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (r && r.author_kind === "client" && !r.internal) {
      lastClient = r;
      break;
    }
  }
  return {
    lastClientAt: lastClient ? lastClient.created_at : null,
    lastId: rows[0] && rows[0].id ? String(rows[0].id) : null,
  };
}

// True when the client wrote after ts.
function TM_clientAfter(lastClientAt, ts) {
  var a = TM__ms(lastClientAt);
  var b = TM__ms(ts);
  return !isNaN(a) && !isNaN(b) && a > b;
}

// First name for a tag: the staff list's name, else the email's local part.
function TM_firstName(email, names) {
  var k = TM__lower(email);
  if (!k) return "";
  var full = names && names[k] ? String(names[k]) : "";
  var first = full.trim().split(/\s+/)[0];
  if (first) return first;
  var local = k.split("@")[0].split(/[._-]/)[0] || k;
  return local.charAt(0).toUpperCase() + local.slice(1);
}

// "Tue 8am" / "Tue 8:30am" in Chicago.
function TM_shortWhen(ts) {
  var ms = TM__ms(ts);
  if (isNaN(ms)) return "";
  try {
    var parts = {};
    new Intl.DateTimeFormat("en-US", {
      timeZone: TM_TZ,
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
      .formatToParts(new Date(ms))
      .forEach(function (p) {
        parts[p.type] = p.value;
      });
    var mins = parts.minute && parts.minute !== "00" ? ":" + parts.minute : "";
    return parts.weekday + " " + parts.hour + mins + String(parts.dayPeriod || "").toLowerCase();
  } catch (e) {
    return "";
  }
}

// The thread's view right now. state: a client_thread_state row or null.
// names: { email: "Full Name" } for the Assigned tag (optional).
function TM_threadView(entry, state, now, isAdmin, names) {
  var s = state || null;
  var e = entry || {};
  var nowMs = now == null ? Date.now() : TM__ms(now);
  var lc = e.lastClientAt;
  var v = {
    hidden: false,
    wokeHidden: false,
    hiddenSet: false,
    done: false,
    snoozed: false,
    snoozedUntil: null,
    pinned: false,
    pinnedAt: null,
    label: null,
    assignee: null,
    tags: [],
  };
  if (!s) return v;
  if (s.hidden_at) {
    v.hiddenSet = true;
    if (TM_clientAfter(lc, s.hidden_at)) v.wokeHidden = true;
    else v.hidden = true;
  }
  v.done = !!s.done_at && !TM_clientAfter(lc, s.done_at);
  var until = TM__ms(s.snoozed_until);
  v.snoozed = !isNaN(until) && until > nowMs && !TM_clientAfter(lc, s.snoozed_at);
  if (v.snoozed) v.snoozedUntil = s.snoozed_until;
  v.pinned = !!s.pinned_at;
  v.pinnedAt = s.pinned_at || null;
  v.label = s.label ? String(s.label) : null;
  v.assignee = s.assignee_email ? TM__lower(s.assignee_email) : null;
  if (v.pinned) v.tags.push({ id: "pinned", text: "Pinned" });
  if (v.snoozed) {
    var when = TM_shortWhen(s.snoozed_until);
    v.tags.push({ id: "snoozed", text: when ? "Snoozed until " + when : "Snoozed" });
  }
  if (v.done) v.tags.push({ id: "done", text: "Done" });
  if (v.hidden || v.wokeHidden) v.tags.push({ id: "hidden", text: "Hidden" });
  if (v.assignee) v.tags.push({ id: "assigned", text: "Assigned: " + TM_firstName(v.assignee, names) });
  return v;
}

// Views for every client entry: { key: view }.
function TM_views(entries, states, now, isAdmin, names) {
  var out = {};
  (entries || []).forEach(function (e) {
    if (e && e.kind === "client") out[e.key] = TM_threadView(e, states ? states[e.key] : null, now, isAdmin, names);
  });
  return out;
}

function TM__byRecent(a, b) {
  return (
    new Date(b.lastAt || 0) - new Date(a.lastAt || 0) || String(a.name).localeCompare(String(b.name))
  );
}

// Does this client entry show in the default list (All / Clients)?
function TM_inDefault(view, searching, isAdmin) {
  if (!view) return true;
  if (view.hidden) return searching && !!isAdmin;
  if (view.done || view.snoozed) return !!searching;
  return true;
}

// The full Messages page list while the gate is on. clientList and teamList
// are already scoped and searched (StaffInbox's matches / inClientScope).
// filter: all | clients | team | done | snoozed | hidden.
function TM_filterSort(clientList, teamList, filter, views, needle, isAdmin, byRecent) {
  var cmp = typeof byRecent === "function" ? byRecent : TM__byRecent;
  var vs = views || {};
  var searching = !!(needle && String(needle).trim());
  var team = (teamList || []).slice();
  if (filter === "team") return team.sort(cmp);
  if (filter === "done" || filter === "snoozed" || filter === "hidden") {
    if (filter === "hidden" && !isAdmin) return [];
    return (clientList || [])
      .filter(function (e) {
        var v = vs[e.key];
        if (!v) return false;
        return filter === "done" ? v.done : filter === "snoozed" ? v.snoozed : v.hidden;
      })
      .sort(cmp);
  }
  var clients = (clientList || []).filter(function (e) {
    return TM_inDefault(vs[e.key], searching, isAdmin);
  });
  var pinned = clients.filter(function (e) {
    return vs[e.key] && vs[e.key].pinned;
  });
  var rest = clients.filter(function (e) {
    return !(vs[e.key] && vs[e.key].pinned);
  });
  pinned.sort(function (a, b) {
    return TM__ms(vs[b.key].pinnedAt) - TM__ms(vs[a.key].pinnedAt) || cmp(a, b);
  });
  var tail = filter === "clients" ? rest : rest.concat(team);
  return pinned.concat(tail.sort(cmp));
}

// Chip counts while the gate is on.
function TM_counts(clientList, teamList, views, needle, isAdmin) {
  var vs = views || {};
  var searching = !!(needle && String(needle).trim());
  var c = { all: 0, clients: 0, team: (teamList || []).length, done: 0, snoozed: 0, hidden: 0 };
  (clientList || []).forEach(function (e) {
    var v = vs[e.key];
    if (TM_inDefault(v, searching, isAdmin)) c.clients++;
    if (v && v.done) c.done++;
    if (v && v.snoozed) c.snoozed++;
    if (v && v.hidden) c.hidden++;
  });
  c.all = c.clients + c.team;
  if (!isAdmin) c.hidden = 0;
  return c;
}

// The chips after Team (Hidden for admins only).
function TM_extraChips(isAdmin) {
  var out = [
    ["done", "Done"],
    ["snoozed", "Snoozed"],
  ];
  if (isAdmin) out.push(["hidden", "Hidden"]);
  return out;
}

// Does this entry get a menu at all?
function TM_hasMenu(entry, mode) {
  return !!(entry && entry.kind === "client" && entry.lastAt != null && mode !== "sample" && entry.lastId);
}

// Menu items. surface: "messages" | "desk". "-" = separator.
// Snooze ("snooze") opens its own list: TM_snoozeItems(view).
function TM_menuItems(view, surface, isAdmin) {
  var v = view || {};
  var desk = surface === "desk";
  var out = ["rename"];
  if (!desk) out.push(v.pinned ? "unpin" : "pin");
  out.push(v.done ? "reopen" : "done");
  if (!desk) out.push("snooze");
  out.push("-", "assign", "task", "-", "copy");
  var tail = [];
  if (!v.hidden) tail.push("hide");
  if (isAdmin && v.hiddenSet) tail.push("restore");
  if (tail.length) out = out.concat(["-"], tail);
  return out;
}
function TM_snoozeItems(view) {
  var out = ["snooze:tomorrow", "snooze:monday", "snooze:date"];
  if (view && view.snoozed) out.push("unsnooze");
  return out;
}
function TM_itemLabel(id) {
  switch (id) {
    case "rename": return "Rename…";
    case "pin": return "Pin to top";
    case "unpin": return "Unpin";
    case "done": return "Mark done";
    case "reopen": return "Reopen";
    case "snooze": return "Snooze";
    case "snooze:tomorrow": return "Tomorrow 8am";
    case "snooze:monday": return "Next Monday 8am";
    case "snooze:date": return "Pick a date…";
    case "unsnooze": return "Unsnooze";
    case "assign": return "Reassign…";
    case "task": return "Create task";
    case "copy": return "Copy link";
    case "hide": return "Hide";
    case "restore": return "Restore";
    default: return id;
  }
}

// Snooze preset -> ISO instant (Chicago 8am, at most 30 days), or null.
function TM_snoozeAt(preset, now, pick) {
  if (typeof WB_snoozeUntil !== "function") return null;
  return WB_snoozeUntil(preset, now, pick);
}
// The Pick a date bounds: { min: tomorrow, max: today + 30 } in Chicago.
function TM_dateBounds(now) {
  if (typeof WB_today !== "function" || typeof WB_addDays !== "function") return { min: "", max: "" };
  var today = WB_today(now == null ? Date.now() : now);
  return { min: WB_addDays(today, 1), max: WB_addDays(today, 30) };
}

// Delay to the next wake check: the earliest future snoozed_until, at most
// one tick (60s). null when nothing is snoozed.
function TM_nextWakeMs(states, now) {
  var nowMs = now == null ? Date.now() : TM__ms(now);
  var best = Infinity;
  Object.keys(states || {}).forEach(function (k) {
    var s = states[k];
    var u = s ? TM__ms(s.snoozed_until) : NaN;
    if (!isNaN(u) && u > nowMs && u < best) best = u;
  });
  if (best === Infinity) return null;
  return Math.max(1000, Math.min(TM_TICK_MS, best - nowMs + 250));
}

// Same cleanup as thread_set_label: control characters to spaces, runs of
// space collapsed, trimmed; "" means clear. ok:false when over 80.
function TM_cleanLabel(s) {
  var t = String(s == null ? "" : s)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return { ok: true, value: null };
  // Count characters the way Postgres char_length does (code points, not UTF-16 units).
  if (Array.from(t).length > TM_LABEL_MAX) return { ok: false, value: t };
  return { ok: true, value: t };
}

// "Reply to <label or name> (<client>)", at most 140 characters.
function TM_taskText(label, name, clientName) {
  var who = String(label || name || "client").trim();
  var t = "Reply to " + who + (clientName ? " (" + String(clientName).trim() + ")" : "");
  return t.length > TM_TASK_MAX ? t.slice(0, TM_TASK_MAX - 1) + "…" : t;
}

// The staff-side link to a thread: the newest message, never an email.
// hrefOf: LK_href (DeepLink.jsx).
function TM_copyLink(origin, pathname, clientId, msgId, hrefOf) {
  if (!clientId || !msgId || typeof hrefOf !== "function") return "";
  return String(origin || "") + String(pathname || "/") + hrefOf({ clientId: clientId, tab: "messages", item: "msg:" + msgId });
}

// After a row leaves the list: the next row, else the previous, else null.
function TM_focusAfter(keys, removed) {
  var list = keys || [];
  var i = list.indexOf(removed);
  if (i < 0) return null;
  if (i + 1 < list.length) return list[i + 1];
  if (i > 0) return list[i - 1];
  return null;
}

// Does this action take the row out of the default list?
function TM_removesRow(action) {
  return action === "hide" || action === "done" || /^snooze:/.test(String(action || ""));
}

// Plain words for an RPC error.
function TM_errorText(err) {
  var m = String((err && (err.message || err.code)) || "");
  if (/not_staff|no_client_access/.test(m)) return "You don't have access to this client's messages.";
  if (/admin_only/.test(m)) return "Only an admin can restore a hidden thread.";
  if (/bad_label/.test(m)) return "Thread names can be up to 80 characters.";
  if (/bad_snooze/.test(m)) return "Pick a time within the next 30 days.";
  if (/bad_assignee/.test(m)) return "That person can't be assigned to this client.";
  if (/no_thread/.test(m)) return "That conversation is gone.";
  if (/bad_task/.test(m)) return "The task was made, but couldn't be linked to the thread.";
  return "Couldn't save that. Try again.";
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    TM_COLS: TM_COLS,
    TM_LABEL_MAX: TM_LABEL_MAX,
    TM_TASK_MAX: TM_TASK_MAX,
    TM_FILTERS: TM_FILTERS,
    TM_entryExtras: TM_entryExtras,
    TM_clientAfter: TM_clientAfter,
    TM_firstName: TM_firstName,
    TM_shortWhen: TM_shortWhen,
    TM_threadView: TM_threadView,
    TM_views: TM_views,
    TM_inDefault: TM_inDefault,
    TM_filterSort: TM_filterSort,
    TM_counts: TM_counts,
    TM_extraChips: TM_extraChips,
    TM_hasMenu: TM_hasMenu,
    TM_menuItems: TM_menuItems,
    TM_snoozeItems: TM_snoozeItems,
    TM_itemLabel: TM_itemLabel,
    TM_snoozeAt: TM_snoozeAt,
    TM_dateBounds: TM_dateBounds,
    TM_nextWakeMs: TM_nextWakeMs,
    TM_cleanLabel: TM_cleanLabel,
    TM_taskText: TM_taskText,
    TM_copyLink: TM_copyLink,
    TM_focusAfter: TM_focusAfter,
    TM_removesRow: TM_removesRow,
    TM_errorText: TM_errorText,
  };
}
