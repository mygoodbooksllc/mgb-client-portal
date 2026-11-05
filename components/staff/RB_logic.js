// ----------------------------------------------------------------------------
// RB_logic: pure logic for the Review board, the Deadline digest and the email
// draft extras (docs/review-board-spec.md sections 3b, 4b and 5). No React, no
// network, no window: everything here is node-tested in RB_logic.test.js.
//
//   Parts      RB_PARTS, RB_partOf(sourceRef), RB_partLabel(key, rhythm),
//              RB_currentPart(rhythm, today, period)
//   Chips      RB_chipFor(task, ctx), RB_chipRank(state)
//   Rows       RB_rowModel(rpcRow, client, closeStatus, ctx),
//              RB_sortRows(rows, key, dir), RB_filterRows(rows, f),
//              RB_counts(rows, part), RB_topLine(rows, part, rhythm)
//   Digest     RB_digestTitle(part, counts, rhythm, period)
//   Periods    RB_periodOptions(focus), RB_periodFromHash(hash, options)
//   Email      RB_recipientChips(data, me), RB_mailto(m), RB_draftText(m),
//              RB_sentLine(sent, me)
//
// Dates: due dates are "YYYY-MM-DD" (no time zone); timestamps (completed_at,
// marked sent) are shown in Chicago time, like the rest of the firm's dates.
// The assignee is never the row owner (S8b rule): no assignee = "Unassigned".
// ----------------------------------------------------------------------------

var RB_PARTS = ["check_in", "reports", "follow_up"];
var RB_PART_REFS = {
  "month_rhythm:2_check_in": "check_in",
  "month_rhythm:6_reports": "reports",
  "month_rhythm:7_follow_up": "follow_up",
};
// Same defaults as TK_RHYTHM_DEFAULT (TK_rhythmLogic.js), used when the
// month_rhythm setting is missing or has no such part.
var RB_PART_DEFAULT = {
  check_in: { label: "Check in", day: 4 },
  reports: { label: "Send reports", day: 14 },
  follow_up: { label: "Follow up", day: 24 },
};
var RB_TZ = "America/Chicago";
var RB_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
var RB_MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
var RB_OPEN_STATUSES = ["todo", "in_progress", "waiting_client"];
// Worst first: the order a chip column sorts in.
var RB_CHIP_RANK = { late: 0, open: 1, review: 2, none: 3, done: 4, notneeded: 5 };
// Chip tone -> the Close tracker's status colors (ct-s-* in staff-ops.css).
var RB_CHIP_TONE = { late: "late", open: "in_progress", review: "review", none: "not_started", done: "done", notneeded: "na" };
var RB_CLOSE_ORDER = { not_started: 0, in_progress: 1, review: 2, done: 3, na: 4 };
var RB_MAILTO_MAX = 1800;
// Simple on purpose: no ?, &, comma, space or % anywhere, one @, a dot after it.
var RB_EMAIL_RE = /^[^\s@?&,%#<>"]+@[^\s@?&,%#<>"]+\.[^\s@?&,%#<>"]+$/;

function RB__str(v) {
  return v == null ? "" : String(v);
}
function RB__email(v) {
  return RB__str(v).trim().toLowerCase();
}

function RB_ordinal(n) {
  var x = Number(n);
  if (!isFinite(x)) return RB__str(n);
  var m100 = x % 100;
  var m10 = x % 10;
  var suf = m100 >= 11 && m100 <= 13 ? "th" : m10 === 1 ? "st" : m10 === 2 ? "nd" : m10 === 3 ? "rd" : "th";
  return x + suf;
}

// "Jesse Smith" -> "Jesse S."; "Jesse" -> "Jesse"; no name -> the email's
// local part; nothing -> "".
function RB_shortName(name, email) {
  var parts = RB__str(name).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0];
  if (parts.length > 1) return parts[0] + " " + parts[parts.length - 1].charAt(0).toUpperCase() + ".";
  var e = RB__str(email).trim();
  return e ? e.split("@")[0] : "";
}

// A "YYYY-MM-DD" date as is, or a timestamp -> its Chicago date. "" when bad.
function RB_ymd(v) {
  var s = RB__str(v).trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  var d = new Date(s);
  if (isNaN(d.getTime())) return "";
  try {
    var parts = new Intl.DateTimeFormat("en-US", { timeZone: RB_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
    var get = function (t) {
      for (var i = 0; i < parts.length; i++) if (parts[i].type === t) return parts[i].value;
      return "";
    };
    return get("year") + "-" + get("month") + "-" + get("day");
  } catch (e) {
    return d.toISOString().slice(0, 10);
  }
}

// "2026-11-14" (or a timestamp) -> "Nov 14".
function RB_dayLabel(v) {
  var ymd = RB_ymd(v);
  if (!ymd) return "";
  var m = Number(ymd.slice(5, 7));
  return RB_MONTHS[m - 1] + " " + Number(ymd.slice(8, 10));
}

// A timestamp -> "2:14 pm" in Chicago time.
function RB_timeLabel(v) {
  var d = new Date(RB__str(v));
  if (!v || isNaN(d.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: RB_TZ, hour: "numeric", minute: "2-digit" }).format(d).replace(/\s?AM$/, " am").replace(/\s?PM$/, " pm");
  } catch (e) {
    return "";
  }
}

// The email draft's "marked sent" line: who (you, or a short name) and when.
// sent = { by, byName, at }; me = my email. "" when nothing is marked.
function RB_sentLine(sent, me) {
  if (!sent || !sent.at) return "";
  var by = RB__str(sent.by).trim().toLowerCase();
  var mine = by && by === RB__str(me).trim().toLowerCase();
  var who = mine ? "you" : RB_shortName(sent.byName, sent.by) || "someone";
  var when = [RB_dayLabel(sent.at), RB_timeLabel(sent.at)].filter(Boolean).join(", ");
  return "Marked sent by " + who + (when ? " · " + when : "");
}

// "2026-10-01" or "2026-10" -> "October".
function RB_monthName(period) {
  var m = Number(RB__str(period).slice(5, 7));
  return m >= 1 && m <= 12 ? RB_MONTHS_LONG[m - 1] : "";
}

// ---- Parts ----

function RB_partOf(sourceRef) {
  return Object.prototype.hasOwnProperty.call(RB_PART_REFS, sourceRef) ? RB_PART_REFS[sourceRef] : null;
}

// { label, day } for a part from the firm rhythm, else the default.
function RB_partInfo(partKey, rhythm) {
  var def = RB_PART_DEFAULT[partKey] || { label: RB__str(partKey), day: null };
  var parts = rhythm && Array.isArray(rhythm.parts) ? rhythm.parts : [];
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i];
    if (p && p.key === partKey) {
      var label = typeof p.label === "string" && p.label.trim() ? p.label.trim() : def.label;
      var day = Number(p.day) >= 1 && Number(p.day) <= 31 ? Number(p.day) : def.day;
      return { label: label, day: day };
    }
  }
  return { label: def.label, day: def.day };
}

// "4th · Check in"
function RB_partLabel(partKey, rhythm) {
  var info = RB_partInfo(partKey, rhythm);
  return info.day ? RB_ordinal(info.day) + " · " + info.label : info.label;
}

// The part the top line counts: in the month after P, the last part whose day
// has come (Check in before the first day); after that month, Follow up.
function RB_currentPart(rhythm, today, period) {
  var t = RB_ymd(today);
  var p = RB__str(period).slice(0, 7);
  if (!t || !/^\d{4}-\d{2}$/.test(p)) return RB_PARTS[0];
  var y = Number(p.slice(0, 4));
  var m = Number(p.slice(5, 7));
  var next = m === 12 ? y + 1 + "-01" : y + "-" + (m + 1 < 10 ? "0" : "") + (m + 1);
  if (t.slice(0, 7) < next) return RB_PARTS[0];
  if (t.slice(0, 7) > next) return RB_PARTS[RB_PARTS.length - 1];
  var dayNow = Number(t.slice(8, 10));
  var out = RB_PARTS[0];
  RB_PARTS.forEach(function (k) {
    var d = RB_partInfo(k, rhythm).day;
    if (d && dayNow >= d) out = k;
  });
  return out;
}

// ---- Chips (spec 3b; the rules run in this order) ----

function RB__assignee(task) {
  return task.assignee ? RB_shortName(task.assignee_name, task.assignee) : "Unassigned";
}

function RB_chipFor(task, ctx) {
  var today = RB_ymd(ctx && ctx.today);
  if (!task) return { state: "none", label: "No task yet", tone: RB_CHIP_TONE.none, by: null, at: null, due: null, id: null, sent: null };
  var out = { state: "", label: "", tone: "", by: null, at: null, due: task.due || null, id: task.id || null, sent: null };
  var status = RB__str(task.status);
  if (status === "done") {
    out.at = task.completed_at || null;
    var day = RB_dayLabel(task.completed_at);
    if (task.auto) {
      out.state = "notneeded";
      out.label = "Not needed · nothing outstanding" + (day ? " · " + day : "");
    } else if (task.by) {
      out.state = "done";
      out.by = task.by;
      out.label = "Done · " + RB_shortName(task.by_name, task.by) + (day ? " · " + day : "");
    } else {
      out.state = "done";
      out.label = day ? "Done · " + day : "Done";
    }
  } else if (status === "ready_for_review") {
    out.state = "review";
    out.label = "Ready for review · " + RB__assignee(task);
  } else if (!task.excused && task.due && today && RB_ymd(task.due) < today) {
    out.state = "late";
    out.label = "Late · due " + RB_dayLabel(task.due) + " · " + RB__assignee(task);
  } else if (task.excused) {
    out.state = "open";
    out.label = task.waiting ? "Open · waiting on client" : "Open · preliminary month";
  } else {
    out.state = "open";
    out.label = task.due ? "Open · due " + RB_dayLabel(task.due) + " · " + RB__assignee(task) : "Open · " + RB__assignee(task);
  }
  out.tone = RB_CHIP_TONE[out.state];
  if (task.sent && task.sent.at) {
    var who = RB_shortName(task.sent.by_name, task.sent.by);
    out.sent = "Email marked sent" + (who ? " · " + who : "") + " · " + RB_dayLabel(task.sent.at);
  }
  return out;
}

function RB_chipRank(state) {
  return Object.prototype.hasOwnProperty.call(RB_CHIP_RANK, state) ? RB_CHIP_RANK[state] : 9;
}

// ---- Rows ----

// One board row from the rb_board client row, the app's client (may be null
// when the app list lacks it), the Close status { status, late, signedOff }
// and ctx { today, bk: { name, key } (from CT_bookkeeperOf/Key), names }.
function RB_rowModel(rpcRow, client, closeStatus, ctx) {
  var r = rpcRow || {};
  var c = client || null;
  var x = ctx || {};
  var people = Array.isArray(r.people) ? r.people : [];
  var find = function (role) {
    for (var i = 0; i < people.length; i++) if (people[i] && people[i].role === role) return people[i];
    return null;
  };
  var rpcBk = find("bookkeeper");
  var backup = find("backup");
  var bk = x.bk && (x.bk.name || x.bk.key) ? x.bk : rpcBk ? { name: rpcBk.name || RB_shortName(null, rpcBk.email), key: rpcBk.email ? "email:" + RB__email(rpcBk.email) : "" } : { name: "", key: "" };
  var tasks = {};
  (Array.isArray(r.tasks) ? r.tasks : []).forEach(function (t) {
    if (t && RB_PARTS.indexOf(t.part) >= 0 && !tasks[t.part]) tasks[t.part] = t;
  });
  var chips = {};
  RB_PARTS.forEach(function (k) {
    chips[k] = RB_chipFor(tasks[k] || null, x);
  });
  var contact = r.contact && (r.contact.name || r.contact.email || r.contact.phone) ? r.contact : null;
  var logins = (Array.isArray(r.logins) ? r.logins.slice() : []).filter(Boolean);
  logins.sort(function (a, b) {
    if (!!a.active !== !!b.active) return a.active ? -1 : 1;
    return RB__str(a.name || a.email).localeCompare(RB__str(b.name || b.email));
  });
  var cs = closeStatus || {};
  var out = {
    id: r.client_id || (c && c.id) || "",
    name: RB__str((c && c.name) || r.name || r.client_id),
    test: !!r.test_only || !!(c && c.test_only),
    internal: !!r.is_internal || !!(c && c.is_internal),
    bkName: RB__str(bk.name),
    bkKey: RB__str(bk.key),
    backupName: backup ? RB__str(backup.name || RB_shortName(null, backup.email)) : "",
    contact: contact,
    contactName: contact ? RB__str(contact.name || contact.email) : "",
    logins: logins,
    prelim: r.report_state === "preliminary",
    tasks: tasks,
    chips: chips,
    close: { status: cs.status || "not_started", late: !!cs.late, signedOff: cs.signedOff || null },
  };
  // Client contacts gate (ctx.contactsOn = OPC_isOn()): the one people list
  // from cc__people. Off, or an older server without the key: today's row.
  if (x.contactsOn && Array.isArray(r.contact_list)) {
    out.contactList = r.contact_list.filter(function (k) {
      return k && (k.name || k.email || k.phone);
    });
  }
  return out;
}

function RB__cmpText(a, b) {
  return RB__str(a).localeCompare(RB__str(b), "en", { sensitivity: "base" });
}

// The sort value for a column, or null when empty (empties sort last both ways).
function RB__sortVal(row, key) {
  if (key === "client") return row.name || null;
  if (key === "bookkeeper") return row.bkName || null;
  if (key === "backup") return row.backupName || null;
  if (key === "contact") return row.contactName || null;
  if (RB_PARTS.indexOf(key) >= 0) {
    var ch = row.chips && row.chips[key];
    return ch ? [RB_chipRank(ch.state), ch.due ? RB_ymd(ch.due) : "9999-99-99"] : null;
  }
  if (key === "close") {
    var cl = row.close || {};
    var o = Object.prototype.hasOwnProperty.call(RB_CLOSE_ORDER, cl.status) ? RB_CLOSE_ORDER[cl.status] : 0;
    return [cl.late ? 0 : 1, o];
  }
  return null;
}

var RB_SORT_KEYS = ["client", "bookkeeper", "backup", "contact", "check_in", "reports", "follow_up", "close"];

// A stable sort; dir "asc" | "desc". Empty values last both ways; ties by client name a-z.
function RB_sortRows(rows, key, dir) {
  var k = RB_SORT_KEYS.indexOf(key) >= 0 ? key : "client";
  var sign = dir === "desc" ? -1 : 1;
  var list = (rows || []).map(function (r, i) {
    return { r: r, i: i, v: RB__sortVal(r, k) };
  });
  list.sort(function (a, b) {
    var av = a.v;
    var bv = b.v;
    if (av == null && bv != null) return 1;
    if (bv == null && av != null) return -1;
    var c = 0;
    if (av != null && bv != null) {
      if (Array.isArray(av)) {
        for (var j = 0; j < av.length && !c; j++) c = av[j] < bv[j] ? -1 : av[j] > bv[j] ? 1 : 0;
      } else c = RB__cmpText(av, bv);
      c *= sign;
    }
    if (!c && k !== "client") c = RB__cmpText(a.r.name, b.r.name);
    return c || a.i - b.i;
  });
  return list.map(function (x) {
    return x.r;
  });
}

var RB_STATUS_FILTERS = [
  { key: "all", label: "All" },
  { key: "late", label: "Has late" },
  { key: "open", label: "Any open" },
  { key: "done3", label: "All three done" },
  { key: "none", label: "No task yet" },
  { key: "close_open", label: "Close not done" },
  { key: "prelim", label: "Preliminary reports" },
];

function RB__anyChip(row, states) {
  return RB_PARTS.some(function (k) {
    return row.chips && row.chips[k] && states.indexOf(row.chips[k].state) >= 0;
  });
}

// f = { bk: "all" | "unassigned" | a CT_bookkeeperKey, status: a RB_STATUS_FILTERS key, showTest }.
function RB_filterRows(rows, f) {
  var o = f || {};
  var bk = o.bk || "all";
  var st = o.status || "all";
  return (rows || []).filter(function (row) {
    if (!o.showTest && (row.test || row.internal)) return false;
    if (bk === "unassigned" && row.bkKey) return false;
    if (bk !== "all" && bk !== "unassigned" && row.bkKey !== bk) return false;
    if (st === "late") return RB__anyChip(row, ["late"]);
    if (st === "open") return RB__anyChip(row, ["late", "open", "review"]);
    if (st === "done3")
      return RB_PARTS.every(function (k) {
        var s = row.chips && row.chips[k] && row.chips[k].state;
        return s === "done" || s === "notneeded";
      });
    if (st === "none") return RB__anyChip(row, ["none"]);
    if (st === "close_open") return !(row.close && (row.close.status === "done" || row.close.status === "na"));
    if (st === "prelim") return !!row.prelim;
    return true;
  });
}

// { total, done, notneeded, open } for one part over the rows given. done
// includes not needed (the digest's rule); rows with no task are not counted.
function RB_counts(rows, part) {
  var out = { total: 0, done: 0, notneeded: 0, open: 0 };
  (rows || []).forEach(function (row) {
    var ch = row.chips && row.chips[part];
    if (!ch || ch.state === "none") return;
    out.total += 1;
    if (ch.state === "done" || ch.state === "notneeded") out.done += 1;
    if (ch.state === "notneeded") out.notneeded += 1;
  });
  out.open = out.total - out.done;
  return out;
}

// "62 clients · 14th: 41 done, 21 open"
function RB_topLine(rows, part, rhythm) {
  var n = (rows || []).length;
  var c = RB_counts(rows, part);
  var day = RB_partInfo(part, rhythm).day;
  return n + (n === 1 ? " client" : " clients") + " · " + (day ? RB_ordinal(day) : RB_partInfo(part, rhythm).label) + ": " + c.done + " done, " + c.open + " open";
}

// ---- Digest (bell) ----

// "14th · Send reports for October: 41 of 62 done, 21 open", with
// "Test clients · " in front while the counts are for test clients.
function RB_digestTitle(part, counts, rhythm, period) {
  var c = counts || {};
  var total = Number(c.total) || 0;
  var done = Number(c.done) || 0;
  var open = c.open != null ? Number(c.open) || 0 : Math.max(total - done, 0);
  var month = RB_monthName(period);
  var title = RB_partLabel(part, rhythm) + (month ? " for " + month : "") + ": " + done + " of " + total + " done, " + open + " open";
  return (c.test ? "Test clients · " : "") + title;
}

// ---- Periods ----

// "2026-10-01" -> ["2026-10-01", "2026-09-01", "2026-08-01"]: the focus month
// and the two before it.
function RB_periodOptions(focus) {
  var p = RB__str(focus).slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(p)) return [];
  var y = Number(p.slice(0, 4));
  var m = Number(p.slice(5, 7));
  var out = [];
  for (var i = 0; i < 3; i++) {
    var mm = m - i;
    var yy = y;
    while (mm < 1) {
      mm += 12;
      yy -= 1;
    }
    out.push(yy + "-" + (mm < 10 ? "0" : "") + mm + "-01");
  }
  return out;
}

// "#/work/review?period=2026-09" -> "2026-09-01" when it is one of the
// options, else null.
function RB_periodFromHash(hash, options) {
  var m = /[?&]period=(\d{4}-\d{2})(?:-01)?(?:&|$)/.exec(RB__str(hash));
  if (!m) return null;
  var p = m[1] + "-01";
  return (options || []).indexOf(p) >= 0 ? p : null;
}

// ---- Email draft extras ----

function RB_emailOk(email) {
  return RB_EMAIL_RE.test(RB__str(email).trim());
}

// data = rb_draft_recipients' answer; me = my email; opts.contactsOn =
// OPC_isOn() (client contacts gate). With the gate on and data.contact_list
// present, To comes from that one list through OPC_toChips (opts.toChips in
// node tests): main + monthly on, never anyone opted out; opted-out logins
// skipped; first not-opted-out chip on when none is. Otherwise today's path:
// -> { to: [{ email, name, on, source }], cc: [...] }, de-duplicated by
// lowercase email (To first, so a contact who is also staff stays a To chip).
// To: the main contact (on), then contacts (can_answer first; off), then
// active logins that have not opted out (off). With no main contact the first
// chip is on. Cc: the bookkeeper and the account manager, on unless it is me.
function RB_recipientChips(data, me, opts) {
  var d = data || {};
  var o = opts || {};
  var mine = RB__email(me);
  var seen = {};
  var to = [];
  var cc = [];
  var add = function (list, p, source, on) {
    var email = RB__email(p && p.email);
    if (!email || seen[email] || !RB_emailOk(email)) return;
    seen[email] = true;
    list.push({ email: email, name: RB__str(p.name).trim(), on: !!on, source: source });
  };
  var toChips = o.toChips || (typeof OPC_toChips === "function" ? OPC_toChips : null);
  if (o.contactsOn && Array.isArray(d.contact_list) && toChips) {
    toChips(d.contact_list, seen).forEach(function (x) {
      if (RB_emailOk(x.email)) to.push(x);
    });
    var staffList = Array.isArray(d.staff) ? d.staff : [];
    ["bookkeeper", "account_manager"].forEach(function (role) {
      staffList.forEach(function (s) {
        if (s && s.role === role) add(cc, s, role, RB__email(s.email) !== mine);
      });
    });
    return { to: to, cc: cc };
  }
  if (d.contact) add(to, d.contact, "contact", true);
  var contacts = (Array.isArray(d.contacts) ? d.contacts.slice() : []).filter(Boolean);
  contacts.sort(function (a, b) {
    return (b.can_answer ? 1 : 0) - (a.can_answer ? 1 : 0);
  });
  contacts.forEach(function (k) {
    add(to, k, "contact_list", false);
  });
  (Array.isArray(d.logins) ? d.logins : []).forEach(function (u) {
    if (u && !u.opted_out && u.active !== false) add(to, u, "login", false);
  });
  if (to.length && !to.some(function (x) {
    return x.on;
  }))
    to[0].on = true;
  var staff = Array.isArray(d.staff) ? d.staff : [];
  ["bookkeeper", "account_manager"].forEach(function (role) {
    staff.forEach(function (s) {
      if (s && s.role === role) add(cc, s, role, RB__email(s.email) !== mine);
    });
  });
  return { to: to, cc: cc };
}

function RB__addrList(list) {
  var out = [];
  var seen = {};
  (list || []).forEach(function (a) {
    var e = RB__str(a && typeof a === "object" ? a.email : a).trim();
    if (!e || !RB_emailOk(e) || seen[e.toLowerCase()]) return;
    seen[e.toLowerCase()] = true;
    out.push(e);
  });
  return out;
}

function RB__crlf(s) {
  return RB__str(s).replace(/\r\n|\r|\n/g, "\r\n");
}

// m = { to: [emails], cc: [emails], subject, body }
// -> { href, full, bodyLeftOut }. Addresses are checked and inserted
// unencoded (an encoded @ breaks some mail apps); subject and body get CRLF
// line ends and encodeURIComponent. Over RB_MAILTO_MAX characters the body is
// left out (bodyLeftOut true): the caller copies it and says so.
function RB_mailto(m) {
  var o = m || {};
  var to = RB__addrList(o.to);
  var cc = RB__addrList(o.cc);
  var build = function (withBody) {
    var q = [];
    if (cc.length) q.push("cc=" + cc.join(","));
    var subject = RB__crlf(o.subject);
    if (subject) q.push("subject=" + encodeURIComponent(subject));
    var body = RB__crlf(o.body);
    if (withBody && body) q.push("body=" + encodeURIComponent(body));
    return "mailto:" + to.join(",") + (q.length ? "?" + q.join("&") : "");
  };
  var full = build(true);
  if (full.length <= RB_MAILTO_MAX) return { href: full, full: true, bodyLeftOut: false };
  return { href: build(false), full: false, bodyLeftOut: !!RB__str(o.body) };
}

// The whole draft as text for "Copy draft": To/Cc lines (only when set), the
// subject, a blank line, the body.
function RB_draftText(m) {
  var o = m || {};
  var lines = [];
  var to = RB__addrList(o.to);
  var cc = RB__addrList(o.cc);
  if (to.length) lines.push("To: " + to.join(", "));
  if (cc.length) lines.push("Cc: " + cc.join(", "));
  lines.push("Subject: " + RB__str(o.subject));
  return lines.join("\n") + "\n\n" + RB__str(o.body);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    RB_PARTS: RB_PARTS,
    RB_PART_REFS: RB_PART_REFS,
    RB_PART_DEFAULT: RB_PART_DEFAULT,
    RB_CHIP_RANK: RB_CHIP_RANK,
    RB_CHIP_TONE: RB_CHIP_TONE,
    RB_MAILTO_MAX: RB_MAILTO_MAX,
    RB_SORT_KEYS: RB_SORT_KEYS,
    RB_STATUS_FILTERS: RB_STATUS_FILTERS,
    RB_ordinal: RB_ordinal,
    RB_shortName: RB_shortName,
    RB_ymd: RB_ymd,
    RB_dayLabel: RB_dayLabel,
    RB_timeLabel: RB_timeLabel,
    RB_sentLine: RB_sentLine,
    RB_monthName: RB_monthName,
    RB_partOf: RB_partOf,
    RB_partInfo: RB_partInfo,
    RB_partLabel: RB_partLabel,
    RB_currentPart: RB_currentPart,
    RB_chipFor: RB_chipFor,
    RB_chipRank: RB_chipRank,
    RB_rowModel: RB_rowModel,
    RB_sortRows: RB_sortRows,
    RB_filterRows: RB_filterRows,
    RB_counts: RB_counts,
    RB_topLine: RB_topLine,
    RB_digestTitle: RB_digestTitle,
    RB_periodOptions: RB_periodOptions,
    RB_periodFromHash: RB_periodFromHash,
    RB_EMAIL_RE: RB_EMAIL_RE,
    RB_emailOk: RB_emailOk,
    RB_recipientChips: RB_recipientChips,
    RB_mailto: RB_mailto,
    RB_draftText: RB_draftText,
  };
}
