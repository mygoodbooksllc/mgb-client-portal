// Lost clients (supabase/lost-clients.sql): clients.lost_at is the first day an
// organization is no longer a MyGoodBooks client. Pure rules, no React, no DOM,
// no Supabase. The roster loader (index.html) maps lost_at to c.lostAt.
//
//   empty              a current client, exactly as before
//   a future date      still a current client until that day ("Leaving")
//   today or earlier   lost: left out of current-client lists, counts, alerts
//                      and pickers; history (hours, tasks, messages, documents,
//                      audit) stays reachable, and its QuickBooks Time hours
//                      keep counting in firm hours and pay cost.
//
// lost_at NEVER changes who may sign in or open anything: RLS, routes and the
// portal ignore it. Setting or clearing it is admin-only (the clients update
// policy) and every change writes a client.lost_set / client.lost_cleared
// audit row (audit_row_change).
//
//   LC_today(now)            local YYYY-MM-DD
//   LC_lostAt(c)             the date string or null (camelCase or the raw row)
//   LC_isLost(c, today)      lost on or before today
//   LC_isLeaving(c, today)   has a lost date that hasn't come yet
//   LC_split(list, today)    { current, lost }
//   LC_checkDate(s)          null when valid, else the message to show
//   LC_fmt(ymd)              "Oct 30, 2026"
//   LC_status(c, today)      "Lost Oct 30, 2026" | "Leaving Nov 15, 2026" | ""
//
// Loads before ClientFlags.jsx (LC_ prefix, shared global scope).
// Node test: `node components/staff/lostClientLogic.test.js`.

function LC__pad(n) {
  return String(n).padStart(2, "0");
}

function LC_today(now) {
  const d = now instanceof Date ? now : new Date();
  return d.getFullYear() + "-" + LC__pad(d.getMonth() + 1) + "-" + LC__pad(d.getDate());
}

function LC_lostAt(c) {
  if (!c) return null;
  const v = c.lostAt != null ? c.lostAt : c.lost_at;
  if (!v) return null;
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function LC_isLost(c, today) {
  const d = LC_lostAt(c);
  return !!d && d <= (today || LC_today());
}

function LC_isLeaving(c, today) {
  const d = LC_lostAt(c);
  return !!d && d > (today || LC_today());
}

function LC_split(list, today) {
  const t = today || LC_today();
  const current = [];
  const lost = [];
  (list || []).forEach((c) => {
    if (!c) return;
    (LC_isLost(c, t) ? lost : current).push(c);
  });
  return { current, lost };
}

// The database refuses dates before 2000 (clients_lost_at_sane); anything that
// isn't a real calendar day is refused here first.
function LC_checkDate(s) {
  const v = String(s || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return "Pick the date they stopped being a client.";
  const [y, m, d] = v.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return "That isn't a real date.";
  if (v < "2000-01-01") return "The date must be in 2000 or later.";
  return null;
}

const LC__MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function LC_fmt(ymd) {
  const s = String(ymd || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "";
  const [y, m, d] = s.split("-").map(Number);
  return LC__MONTHS[m - 1] + " " + d + ", " + y;
}

function LC_status(c, today) {
  const d = LC_lostAt(c);
  if (!d) return "";
  return (LC_isLost(c, today) ? "Lost " : "Leaving ") + LC_fmt(d);
}

if (typeof window !== "undefined") {
  window.LC_isLost = LC_isLost;
  window.LC_today = LC_today;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { LC_today, LC_lostAt, LC_isLost, LC_isLeaving, LC_split, LC_checkDate, LC_fmt, LC_status };
}
