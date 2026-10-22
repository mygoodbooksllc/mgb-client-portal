// Launch announcements: pure rules for who sees which notice and when
// (announcements.js is the registry, Announcements.jsx the notice and store,
// announcementsLogic.test.js the node test). No React, no Supabase.
//
// Queue order, so "at most one notice" is predictable: of the announcements
// this person is still owed, the newest by date comes first (ties: the one
// listed first in the registry). Only that one shows, once per page load;
// whatever is left waits for the next visit.

var ANN_STATUSES = ["seen", "later", "toured", "dismissed"];
var ANN_ROLES = ["admin", "tempAdmin", "bookkeeper", "accountManager", "client"];
var ANN_LATER_MAX = 3; // the third "Later" counts as Skip
var ANN_CAP_DAYS = 60; // an announcement stops showing this long after its date

// Which registry roles this person has. ctx is the staff tour ctx
// (TOUR_staffCtx): isAdmin is a real admin only, tempAdmin a bookkeeper with
// a temporary admin grant (still a bookkeeper), accountManager = amCount > 0.
// "client" is never produced here: the notice is staff-side only today.
function ANN_roleSet(ctx) {
  var c = ctx || {};
  var out = [];
  if (c.isAdmin) out.push("admin");
  if (c.tempAdmin) out.push("tempAdmin");
  if (c.isBookkeeper) out.push("bookkeeper");
  if (c.amCount > 0) out.push("accountManager");
  return out;
}

// Is the entry listed at all yet? An entry may carry visible(ctx) -> boolean
// (the Slate app launch: nothing about it shows anywhere, not the notice, not
// What's new's Launches list, not the ? menu tour, until the owner has turned
// the firm switch on and this person is not on the Classic option). Without
// one it is always visible. A visible() that throws counts as not visible.
function ANN_listed(entry, ctx) {
  if (!entry || typeof entry.visible !== "function") return true;
  try {
    return !!entry.visible(ctx || {});
  } catch (e) {
    return false;
  }
}

// The announcements aimed at this person, in registry order. Entries that are
// not visible yet (see ANN_listed) are left out, so every list and the notice
// itself hide them together.
function ANN_audience(registry, ctx) {
  var mine = ANN_roleSet(ctx);
  return (registry || []).filter(function (a) {
    return a && Array.isArray(a.roles) && ANN_listed(a, ctx) && a.roles.some(function (r) { return mine.indexOf(r) !== -1; });
  });
}

// The row's answer as the rest of the rules see it: Later at its limit is
// Skip. Anything else unknown reads as no answer.
function ANN_effectiveStatus(row) {
  if (!row || ANN_STATUSES.indexOf(row.status) === -1) return null;
  if (row.status === "later" && Number(row.later_count) >= ANN_LATER_MAX) return "dismissed";
  return row.status;
}

// What a button does to the row. action: "show" (first time on screen),
// "later", "skip" (the notice's Skip), "tour" (the tour was finished or
// skipped). Returns { status, later_count }.
function ANN_apply(row, action) {
  var count = row && Number(row.later_count) > 0 ? Math.min(Number(row.later_count), ANN_LATER_MAX) : 0;
  var status = ANN_effectiveStatus(row);
  if (action === "tour") return { status: "toured", later_count: count };
  if (action === "skip") return { status: "dismissed", later_count: count };
  if (action === "later") {
    count = Math.min(count + 1, ANN_LATER_MAX);
    return { status: count >= ANN_LATER_MAX ? "dismissed" : "later", later_count: count };
  }
  // "show": keep whatever answer is there, else seen.
  return { status: status || "seen", later_count: count };
}

// Two copies of one row (the saved cache and the database's): the stronger
// answer wins, toured > dismissed > later > seen, and the Later count is the
// higher of the two. Mirrors the database guard, so a stale copy can't take
// an answer back. Either side may be missing.
function ANN_merge(a, b) {
  if (!a || !b) return a || b || null;
  var rank = { seen: 0, later: 1, dismissed: 2, toured: 3 };
  var ra = rank[ANN_effectiveStatus(a)];
  var rb = rank[ANN_effectiveStatus(b)];
  var count = Math.min(Math.max(Number(a.later_count) || 0, Number(b.later_count) || 0), ANN_LATER_MAX);
  var win = (rb === undefined ? -1 : rb) > (ra === undefined ? -1 : ra) ? b : a;
  if (!ANN_effectiveStatus(win)) return null;
  return { status: win.status, later_count: count };
}

// YYYY-MM-DD of an ISO timestamp or date, or "" when it isn't one.
function ANN_day(v) {
  var m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v == null ? "" : v));
  return m ? m[1] : "";
}

function ANN_daysBetween(fromDay, toDay) {
  return Math.round((Date.parse(toDay + "T00:00:00Z") - Date.parse(fromDay + "T00:00:00Z")) / 86400000);
}

// True when nothing may show right now: a tour or Tips-style overlay is on
// screen or about to start (busy), Today's first sign-in profile prompt is
// open, or this isn't the person themselves (View as, Preview as).
function ANN_blocked(ctx) {
  var c = ctx || {};
  return !!(c.busy || c.profileOpen || c.impersonating || c.previewing);
}

// Is this announcement still owed to the person? state.rows is
// { [announcement_id]: { status, later_count } }, state.accountStart the
// staff row's created_at (null/unknown: nothing is owed), now a Date or ms.
// Only announcements dated on or after the day the account was made count, so
// a new hire never gets launches from before they started.
function ANN_owed(entry, state, now) {
  var st = state || {};
  var status = ANN_effectiveStatus((st.rows || {})[entry.id]);
  if (status === "toured" || status === "dismissed") return false;
  var start = ANN_day(st.accountStart);
  var day = ANN_day(entry.date);
  if (!start || !day || day < start) return false;
  var today = new Date(now == null ? Date.now() : now).toISOString().slice(0, 10);
  if (ANN_daysBetween(day, today) > ANN_CAP_DAYS) return false;
  return true;
}

// Has the entry's own precondition been met? An entry may carry
// ready(ctx) -> boolean (for example "has seen an Unassigned task"); without
// one it is always ready. A ready() that throws counts as not ready yet.
// Only the notice waits for it: What's new and the ? menu list it anyway.
function ANN_ready(entry, ctx) {
  if (!entry || typeof entry.ready !== "function") return true;
  try {
    return !!entry.ready(ctx || {});
  } catch (e) {
    return false;
  }
}

// An entry may carry supersedes: ["older-id", ...], the launches it replaces
// (a combined launch notice). Once the person has been shown the superseding
// entry (it has any answer row), the ones it covers are no longer owed, so
// they do not trickle out one visit at a time behind it.
function ANN_superseded(registry, entry, state) {
  var rows = (state && state.rows) || {};
  return (registry || []).some(function (y) {
    return y && Array.isArray(y.supersedes) && y.supersedes.indexOf(entry.id) !== -1 && !!ANN_effectiveStatus(rows[y.id]);
  });
}

// The one announcement to show now, or null. ctx has the staff tour ctx
// fields (isAdmin, tempAdmin, isBookkeeper, amCount) plus busy, profileOpen,
// impersonating, previewing. state.hidden lists ids put away this page load
// (Later or Skip pressed), so a Later never reappears before the next visit.
function ANN_pickNext(registry, state, ctx, now) {
  if (ANN_blocked(ctx)) return null;
  var hidden = (state && state.hidden) || [];
  var owed = ANN_audience(registry, ctx)
    .map(function (a, i) { return { a: a, i: i }; })
    .filter(function (x) { return hidden.indexOf(x.a.id) === -1 && ANN_owed(x.a, state, now) && !ANN_superseded(registry, x.a, state) && ANN_ready(x.a, ctx); })
    .sort(function (x, y) {
      if (x.a.date !== y.a.date) return x.a.date < y.a.date ? 1 : -1;
      return x.i - y.i;
    });
  return owed.length ? owed[0].a : null;
}

// Admin report, per registry entry. data is the staff_announcement_report()
// rows (one per staffer per announcement they answered, or one with a null
// announcement_id for a staffer with none). Counts are over the audience: an
// active staffer whose role (admin / bookkeeper) is one the entry names, or
// who already has a row for it (temporary admins and account managers can't
// be told apart from the staff table, so they count once they have answered),
// and whose account was made on or before the entry's date.
// Returns [{ id, seen, toured, dismissed, notYet, names: { seen, toured,
// dismissed, notYet } }]. A "later" row counts as seen, an exhausted Later
// as dismissed.
function ANN_report(registry, data) {
  var staff = {};
  var byKey = {};
  (data || []).forEach(function (r) {
    var e = String(r.staff_email || "").toLowerCase();
    if (!e) return;
    staff[e] = { email: e, name: r.staff_name || e, role: r.staff_role, created: ANN_day(r.staff_created_at) };
    if (r.announcement_id) byKey[e + "|" + r.announcement_id] = r;
  });
  return (registry || []).map(function (a) {
    var out = { id: a.id, seen: 0, toured: 0, dismissed: 0, notYet: 0, names: { seen: [], toured: [], dismissed: [], notYet: [] } };
    Object.keys(staff).sort(function (x, y) { return staff[x].name < staff[y].name ? -1 : staff[x].name > staff[y].name ? 1 : 0; }).forEach(function (e) {
      var s = staff[e];
      var row = byKey[e + "|" + a.id];
      var inRoles = (s.role === "admin" && a.roles.indexOf("admin") !== -1) || (s.role === "bookkeeper" && a.roles.indexOf("bookkeeper") !== -1);
      // An account made after the launch isn't owed it, so isn't "not yet".
      var owedAccount = !s.created || s.created <= ANN_day(a.date);
      if (!row && !(inRoles && owedAccount)) return;
      var status = ANN_effectiveStatus(row);
      var key = status === "toured" ? "toured" : status === "dismissed" ? "dismissed" : status ? "seen" : "notYet";
      out[key]++;
      out.names[key].push(s.name);
    });
    return out;
  });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    ANN_STATUSES: ANN_STATUSES, ANN_ROLES: ANN_ROLES, ANN_LATER_MAX: ANN_LATER_MAX, ANN_CAP_DAYS: ANN_CAP_DAYS,
    ANN_roleSet: ANN_roleSet, ANN_audience: ANN_audience, ANN_effectiveStatus: ANN_effectiveStatus,
    ANN_apply: ANN_apply, ANN_merge: ANN_merge, ANN_day: ANN_day, ANN_blocked: ANN_blocked, ANN_owed: ANN_owed,
    ANN_pickNext: ANN_pickNext, ANN_report: ANN_report, ANN_ready: ANN_ready, ANN_superseded: ANN_superseded,
    ANN_listed: ANN_listed,
  };
}
